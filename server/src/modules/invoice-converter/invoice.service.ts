import type { DB } from '../../db/index.ts';
import { j } from '../../db/index.ts';
import { env } from '../../env.ts';
import { newId } from '../../security.ts';
import { audit } from '../../audit.ts';
import type { Ctx } from '../../http.ts';
import {
  generateUniqueInternalBarcode,
  generateUniqueShortSku,
  parseImportNumeric,
} from '../../../../shared/bulkImport.ts';
import { syncItemStockStatus } from '../../services/stockStatus.ts';
import {
  detectTableColumns,
  isValidProductRow,
  parseInvoiceMetadata,
  parseLineItems,
  type ColumnMapping,
} from '../../services/supplierInvoiceParser.ts';
import type {
  AiRawInvoicePayload,
  ExtractedInvoiceHeader,
  ExtractedProductRecord,
  InvoiceAnalysisSummary,
  ProcessingCapabilities,
  ReconciliationReport,
  ValidationIssue,
} from './schemas/invoice.schema.ts';
import { preprocessInvoiceBuffer } from './services/image-preprocessor.ts';
import {
  GoogleDocumentAiOcrProvider,
  LocalTesseractOcrProvider,
  type OcrExtractionOutput,
} from './services/document-ocr.ts';
import { GeminiVisionExtractor, resolveDittoMarks } from './services/ai-extractor.ts';
import { validateExtractedInvoice } from './services/data-validator.ts';
import { reconcileInvoice } from './services/invoice-reconciler.ts';
import { matchProductsWithCatalog, type CatalogItemRow } from './services/product-matcher.ts';
import {
  applySupplierLearningSuggestions,
  normalizeCorrectionKey,
  type SupplierCorrectionRule,
} from './services/product-mapper.ts';
import { generateTemplateExcel } from './services/excel-generator.ts';

// Temporary in-memory file buffer store with automatic retention cleanup
const tempFileStore = new Map<string, { buffer: Buffer; mimeType: string; fileName: string; expiresAt: number }>();
const TEMP_TTL_MS = 60 * 60 * 1000; // 1 hour in-memory retention for extraction/preview

function cleanupExpiredTempFiles() {
  const now = Date.now();
  for (const [k, v] of tempFileStore.entries()) {
    if (v.expiresAt <= now) tempFileStore.delete(k);
  }
}

export function getProcessingCapabilities(): ProcessingCapabilities {
  const docAi = new GoogleDocumentAiOcrProvider();
  const gemini = new GeminiVisionExtractor();
  return {
    localPreprocessing: true,
    localOcrEngine: 'tesseract.js+pdf-parse',
    cloudOcrProvider: docAi.isConfigured() ? 'google-document-ai' : 'none',
    cloudOcrConfigured: docAi.isConfigured(),
    aiProvider: gemini.isConfigured() ? 'gemini-vision' : 'none',
    aiConfigured: gemini.isConfigured(),
  };
}

function buildAnalysisSummary(
  pageCount: number,
  items: ExtractedProductRecord[],
  reconciliation: ReconciliationReport
): InvoiceAnalysisSummary {
  const totalProductRows = items.length;
  const verifiedProducts = items.filter((i) => i.reviewStatus === 'verified').length;
  const productsRequiringReview = totalProductRows - verifiedProducts;
  const missingMandatoryFields = items.filter(
    (i) => !i.name.trim() || !i.sellingPrice.trim() || !i.costPrice.trim()
  ).length;

  let filledSlots = 0;
  const totalSlots = totalProductRows * 8;
  for (const i of items) {
    if (i.name.trim()) filledSlots++;
    if (i.uom.trim()) filledSlots++;
    if (i.sellingPrice.trim()) filledSlots++;
    if (i.costPrice.trim()) filledSlots++;
    if (i.hsn.trim()) filledSlots++;
    if (i.gstRate.trim()) filledSlots++;
    if (i.priceInclusive) filledSlots++;
    if (i.openingStock.trim()) filledSlots++;
  }
  const extractionCompletenessPct = totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;

  return {
    totalPagesProcessed: pageCount,
    totalProductRows,
    verifiedProducts,
    productsRequiringReview,
    missingMandatoryFields,
    extractionCompletenessPct,
    invoiceTotal: reconciliation.invoiceGrandTotal,
    extractedLineItemTotal: reconciliation.extractedLineSum,
    reconciliationDifference: reconciliation.grandTotalDifference,
  };
}

function mapAiPayloadToRecords(
  payload: AiRawInvoicePayload,
  ocr: OcrExtractionOutput
): ExtractedProductRecord[] {
  return payload.items.map((item, idx) => {
    const qty = item.quantity ?? item.piecesPerBox ?? 1;
    const rate = item.unitPurchaseRate ?? null;
    const lineAmt = item.lineItemAmount ?? null;
    const gstPct = item.gstPercentage ?? 5;
    const priceIncl = item.priceInclusiveOfGst === false ? 'No' : 'Yes';

    // Prefer exact unitPurchaseRate from the bill when available
    let costPrice = '';
    if (rate !== null && rate > 0) {
      costPrice = rate.toFixed(2);
    } else if (lineAmt !== null && lineAmt > 0 && qty > 0) {
      costPrice = (lineAmt / qty).toFixed(2);
    }

    const displayName = (item.productName || '').trim();
    const sizeStr = (item.sizeWeightVolume || item.variant || '').trim();

    const confScore = item.confidence ?? ocr.averageConfidence ?? null;
    const matchedLine = item.originalText
      ? ocr.lines.find((l) => l.text.toLowerCase().includes(item.originalText!.toLowerCase().slice(0, 12)))
      : ocr.lines[idx];

    return {
      id: `inv-item-${idx + 1}`,
      rowOrder: idx + 1,
      name: displayName,
      size: sizeStr,
      uom: (item.uom || 'PCS').toUpperCase(),
      sellingPrice: '',
      costPrice,
      hsn: item.hsnCode || '',
      gstRate: `${gstPct}%`,
      priceInclusive: priceIncl,
      openingStock: String(qty),
      brand: item.brand ?? null,
      description: item.description ?? null,
      variant: item.variant ?? null,
      sizeWeightVolume: item.sizeWeightVolume ?? null,
      quantity: qty,
      boxCartonQty: item.boxCartonQty ?? null,
      piecesPerBox: item.piecesPerBox ?? null,
      unitPurchaseRate: rate ?? null,
      lineItemAmount: lineAmt ?? null,
      discountAmount: item.discount ?? null,
      gstPercentage: gstPct,
      gstAmount: item.gstAmount ?? null,
      isDittoInherited: Boolean(item.isDitto),
      originalOcrText: item.originalText ?? matchedLine?.text ?? null,
      sourcePage: item.sourcePage ?? matchedLine?.page ?? 1,
      sourceBbox: matchedLine?.bbox ?? null,
      fieldConfidence: {
        overall: confScore !== null ? { score: confScore, status: 'scored' } : { score: null, status: 'unknown' },
      },
      reviewStatus: 'needs_review',
      warningMessages: item.isDitto ? ['Product name inherited from previous row ditto mark.'] : [],
      validationErrors: [],
      flags: ['Selling Price required'],
      matchType: 'new_product',
      matchedItemId: null,
      matchedItemName: null,
      matchCandidates: [],
      userApproved: false,
      confidence: confScore === null ? undefined : confScore >= 0.8 ? 'high' : confScore >= 0.55 ? 'medium' : 'low',
    };
  });
}

export async function createUploadJob(
  db: DB,
  opts: {
    tenantId: string;
    branchId?: string | null;
    userId?: string | null;
    supplierId?: string | null;
    fileName: string;
    fileData: string;
    mimeType?: string;
  }
) {
  cleanupExpiredTempFiles();

  const cleanData = opts.fileData.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(cleanData, 'base64');
  const pre = preprocessInvoiceBuffer(buffer, opts.fileName, opts.mimeType);

  const jobId = newId('invjob');
  const expiresAt = new Date(Date.now() + env.invoiceRetentionDays * 86400 * 1000).toISOString();

  tempFileStore.set(jobId, {
    buffer: pre.originalBuffer,
    mimeType: pre.mimeType,
    fileName: opts.fileName,
    expiresAt: Date.now() + TEMP_TTL_MS,
  });

  await db.exec(
    `INSERT INTO supplier_invoice_jobs (
      id, tenant_id, branch_id, supplier_id, file_name, mime_type, file_size_bytes,
      status, processing_stage, created_by, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded', 'uploaded', ?, ?, now(), now())`,
    [
      jobId,
      opts.tenantId,
      opts.branchId ?? null,
      opts.supplierId ?? null,
      opts.fileName,
      pre.mimeType,
      pre.originalBuffer.byteLength,
      opts.userId ?? null,
      expiresAt,
    ]
  );

  return {
    jobId,
    fileName: opts.fileName,
    mimeType: pre.mimeType,
    fileSizeBytes: pre.originalBuffer.byteLength,
    appliedPreprocessing: pre.appliedSteps,
    capabilities: getProcessingCapabilities(),
  };
}

export async function runExtractionJob(
  db: DB,
  opts: {
    jobId: string;
    tenantId: string;
    supplierId?: string | null;
    fileData?: string;
    fileName?: string;
    mimeType?: string;
  }
) {
  const job = await db.one<any>(
    'SELECT * FROM supplier_invoice_jobs WHERE id = ? AND tenant_id = ?',
    [opts.jobId, opts.tenantId]
  );
  if (!job) throw new Error('Invoice extraction job not found');

  let rawBuffer: Buffer;
  let fileName = opts.fileName || job.file_name;
  let mimeType = opts.mimeType || job.mime_type || 'application/octet-stream';

  const cached = tempFileStore.get(opts.jobId);
  if (cached) {
    rawBuffer = cached.buffer;
    fileName = cached.fileName;
    mimeType = cached.mimeType;
  } else if (opts.fileData) {
    rawBuffer = Buffer.from(opts.fileData.replace(/^data:[^;]+;base64,/, ''), 'base64');
  } else {
    throw new Error('Invoice file buffer expired or unavailable. Please re-upload the invoice.');
  }

  await db.exec(
    `UPDATE supplier_invoice_jobs SET status = 'processing', processing_stage = 'preprocessing', updated_at = now() WHERE id = ?`,
    [opts.jobId]
  );

  const pre = preprocessInvoiceBuffer(rawBuffer, fileName, mimeType);

  await db.exec(
    `UPDATE supplier_invoice_jobs SET processing_stage = 'reading_document', updated_at = now() WHERE id = ?`,
    [opts.jobId]
  );

  const docAi = new GoogleDocumentAiOcrProvider();
  const localOcr = new LocalTesseractOcrProvider();
  const gemini = new GeminiVisionExtractor();

  let ocrResult: OcrExtractionOutput = {
    provider: 'local-tesseract',
    text: '',
    sparseText: '',
    pages: 1,
    isOcr: pre.fileType === 'image',
    lines: [],
    averageConfidence: null,
  };

  // For digital PDFs or when Cloud/Local OCR is needed (skip slow Tesseract on images if Gemini Vision is configured)
  const shouldRunOcrFirst = docAi.isConfigured() || pre.fileType !== 'image' || !gemini.isConfigured();
  if (shouldRunOcrFirst) {
    if (docAi.isConfigured()) {
      try {
        ocrResult = await docAi.extract(pre.processedBuffer, fileName, pre.mimeType);
      } catch {
        ocrResult = await localOcr.extract(pre.processedBuffer, fileName, pre.mimeType);
      }
    } else {
      ocrResult = await localOcr.extract(pre.processedBuffer, fileName, pre.mimeType);
    }
  }

  await db.exec(
    `UPDATE supplier_invoice_jobs SET processing_stage = 'ai_understanding', updated_at = now() WHERE id = ?`,
    [opts.jobId]
  );

  let aiResult;
  try {
    aiResult = await gemini.extract({
      originalBuffer: pre.originalBuffer,
      mimeType: pre.mimeType,
      ocrText: ocrResult.text,
    });
  } catch (aiErr: any) {
    aiResult = {
      provider: 'none' as const,
      configured: gemini.isConfigured(),
      payload: null,
      warnings: [`Gemini Vision unavailable (${aiErr?.message || 'API error'}). Fell back to local OCR + parser.`],
    };
  }

  // If Gemini didn't produce a payload and we skipped local OCR earlier, run local OCR now as fallback
  if (!aiResult.payload && !shouldRunOcrFirst) {
    ocrResult = await localOcr.extract(pre.processedBuffer, fileName, pre.mimeType);
  }

  if (!ocrResult.text.trim() && !aiResult.payload) {
    await db.exec(
      `UPDATE supplier_invoice_jobs SET status = 'failed', processing_stage = 'failed', error_message = ?, updated_at = now() WHERE id = ?`,
      ['Unable to recognize text from this invoice.', opts.jobId]
    );
    throw new Error('Unable to recognize text in this invoice. Please try a clearer scan.');
  }

  // Load saved supplier column mapping if any
  const effectiveSupplierId = opts.supplierId || job.supplier_id;
  let savedMappingRow: any = null;
  if (effectiveSupplierId) {
    savedMappingRow = await db.one(
      'SELECT * FROM supplier_invoice_mappings WHERE tenant_id = ? AND supplier_id = ? LIMIT 1',
      [opts.tenantId, effectiveSupplierId]
    );
  }

  const lines = ocrResult.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const initialMapping: ColumnMapping | undefined = savedMappingRow?.mapping
    ? typeof savedMappingRow.mapping === 'string'
      ? JSON.parse(savedMappingRow.mapping)
      : savedMappingRow.mapping
    : undefined;
  const { headers, columnMap, dataLines } = detectTableColumns(lines, initialMapping);

  let header: ExtractedInvoiceHeader;
  let items: ExtractedProductRecord[];

  if (aiResult.payload) {
    header = aiResult.payload.header;
    items = mapAiPayloadToRecords(aiResult.payload, ocrResult);
  } else {
    const legacyMeta = parseInvoiceMetadata(ocrResult.text, ocrResult.sparseText);
    header = {
      supplierName: legacyMeta.supplierName || null,
      supplierGstin: legacyMeta.supplierGstin || null,
      supplierAddress: null,
      invoiceNumber: legacyMeta.invoiceNumber || null,
      invoiceDate: legacyMeta.invoiceDate || null,
      purchaseOrderNumber: null,
      deliveryOrLrNumber: null,
      billingAddress: null,
      shippingAddress: legacyMeta.buyerAddress || null,
      subtotal: legacyMeta.subtotalAmount ?? null,
      discount: null,
      sgst: legacyMeta.sgstAmount ?? null,
      cgst: legacyMeta.cgstAmount ?? null,
      igst: legacyMeta.igstAmount ?? null,
      otherCharges: null,
      roundOff: null,
      finalInvoiceAmount: legacyMeta.totalAmount ?? null,
    };

    const rawProducts = parseLineItems(dataLines, columnMap, headers, ocrResult.sparseText, ocrResult.tableData).filter(
      isValidProductRow
    );
    const resolvedLocal = resolveDittoMarks(
      rawProducts.map((p) => ({
        productName: p.name,
        hsnCode: p.hsn || null,
        quantity: parseImportNumeric(p.openingStock),
        unitPurchaseRate: parseImportNumeric(p.costPrice),
      }))
    );
    items = rawProducts.map((p, idx) => {
      const qty = parseImportNumeric(p.openingStock) ?? 1;
      const cost = parseImportNumeric(p.costPrice);
      const gstNum = parseImportNumeric(p.gstRate ? p.gstRate.replace('%', '') : null) ?? 5;
      const ocrLine = ocrResult.lines[idx];
      const dittoInfo = resolvedLocal[idx];
      const { rawBox, isDitto, ...rest } = p;
      return {
        ...rest,
        name: dittoInfo?.productName || p.name,
        size: p.size || '',
        hsn: dittoInfo?.hsnCode || p.hsn,
        rowOrder: idx + 1,
        brand: null,
        description: null,
        variant: null,
        sizeWeightVolume: p.size || null,
        quantity: qty,
        boxCartonQty: parseImportNumeric(rawBox),
        piecesPerBox: null,
        unitPurchaseRate: parseImportNumeric(p.rawRate) ?? cost,
        lineItemAmount: parseImportNumeric(p.rawTotal) ?? (cost !== null ? cost * qty : null),
        discountAmount: parseImportNumeric(p.rawDiscount),
        gstPercentage: gstNum,
        gstAmount: null,
        isDittoInherited: Boolean(isDitto),
        originalOcrText: ocrLine?.text ?? null,
        sourcePage: ocrLine?.page ?? 1,
        sourceBbox: ocrLine?.bbox ?? null,
        fieldConfidence: {
          overall: ocrResult.averageConfidence !== null
            ? { score: ocrResult.averageConfidence, status: 'scored' }
            : { score: null, status: 'unknown' },
        },
        reviewStatus: 'needs_review',
        warningMessages: [...aiResult.warnings],
        validationErrors: [],
        flags: p.flags || [],
        matchType: 'new_product',
        matchedItemId: null,
        matchedItemName: null,
        matchCandidates: [],
        userApproved: false,
      };
    });
  }

  // Apply supplier learning corrections
  const corrections = await db.query<SupplierCorrectionRule>(
    `SELECT id, original_ocr_name as "originalOcrName", normalized_ocr_key as "normalizedOcrKey",
            corrected_name as "correctedName", preferred_uom as "preferredUom",
            preferred_hsn as "preferredHsn", preferred_gst_rate as "preferredGstRate",
            matched_item_id as "matchedItemId"
     FROM supplier_invoice_corrections
     WHERE tenant_id = ?
       AND (supplier_id = ? OR (supplier_gstin IS NOT NULL AND lower(supplier_gstin) = lower(?)))`,
    [opts.tenantId, effectiveSupplierId ?? '', header.supplierGstin ?? '']
  );
  items = applySupplierLearningSuggestions(items, corrections);

  // Match against existing catalog
  const catalogRows = await db.query<CatalogItemRow>(
    `SELECT id, name, sku, barcode, hsn, unit, price_minor as "priceMinor", cost_minor as "costMinor"
     FROM items WHERE tenant_id = ? AND active = true`,
    [opts.tenantId]
  );
  items = matchProductsWithCatalog(items, catalogRows);

  // Check duplicate invoice numbers
  const existingInvRows = await db.query<{ num: string }>(
    `SELECT supplier_invoice_number as num FROM purchases WHERE tenant_id = ? AND supplier_invoice_number IS NOT NULL`,
    [opts.tenantId]
  );
  const existingInvSet = new Set(existingInvRows.map((r) => r.num.trim().toLowerCase()));

  const validation = validateExtractedInvoice(header, items, existingInvSet);
  items = validation.items;
  const reconciliation = reconcileInvoice(header, items);
  const summary = buildAnalysisSummary(ocrResult.pages, items, reconciliation);

  // Persist job & items
  await db.exec(
    `UPDATE supplier_invoice_jobs
     SET status = 'ready', processing_stage = 'ready', page_count = ?, ocr_provider = ?, ai_provider = ?,
         is_ocr = ?, metadata = ?::jsonb, reconciliation = ?::jsonb, headers = ?, column_map = ?::jsonb,
         raw_text = ?, updated_at = now()
     WHERE id = ? AND tenant_id = ?`,
    [
      ocrResult.pages,
      ocrResult.provider,
      aiResult.provider === 'none' ? null : aiResult.provider,
      ocrResult.isOcr,
      j(header),
      j(reconciliation),
      headers,
      j(columnMap),
      ocrResult.text,
      opts.jobId,
      opts.tenantId,
    ]
  );

  await db.exec('DELETE FROM supplier_invoice_items WHERE job_id = ? AND tenant_id = ?', [opts.jobId, opts.tenantId]);
  for (const item of items) {
    await db.exec(
      `INSERT INTO supplier_invoice_items (id, job_id, tenant_id, row_order, data, review_status, matched_item_id, match_type, user_approved, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, now(), now())`,
      [
        newId('sii'),
        opts.jobId,
        opts.tenantId,
        item.rowOrder,
        j(item),
        item.reviewStatus,
        item.matchedItemId,
        item.matchType,
        item.userApproved,
      ]
    );
  }

  return {
    ok: true,
    jobId: opts.jobId,
    capabilities: getProcessingCapabilities(),
    appliedPreprocessing: pre.appliedSteps,
    ocrProvider: ocrResult.provider,
    aiProvider: aiResult.provider,
    warnings: aiResult.warnings,
    header,
    items,
    issues: validation.issues,
    reconciliation,
    summary,
    headers,
    columnMap,
  };
}

export async function getJobResults(db: DB, jobId: string, tenantId: string) {
  const job = await db.one<any>('SELECT * FROM supplier_invoice_jobs WHERE id = ? AND tenant_id = ?', [jobId, tenantId]);
  if (!job) return null;

  const itemRows = await db.query<any>(
    'SELECT data FROM supplier_invoice_items WHERE job_id = ? AND tenant_id = ? ORDER BY row_order ASC',
    [jobId, tenantId]
  );
  const items: ExtractedProductRecord[] = itemRows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
  const header: ExtractedInvoiceHeader = typeof job.metadata === 'string' ? JSON.parse(job.metadata) : job.metadata;
  const reconciliation: ReconciliationReport =
    typeof job.reconciliation === 'string' ? JSON.parse(job.reconciliation) : job.reconciliation;

  return {
    ok: true,
    jobId: job.id,
    fileName: job.file_name,
    status: job.status,
    processingStage: job.processing_stage,
    ocrProvider: job.ocr_provider,
    aiProvider: job.ai_provider || 'none',
    pageCount: job.page_count,
    header,
    items,
    reconciliation,
    summary: buildAnalysisSummary(job.page_count, items, reconciliation),
    headers: job.headers || [],
    columnMap: typeof job.column_map === 'string' ? JSON.parse(job.column_map) : job.column_map,
  };
}

export async function updateJobItems(
  db: DB,
  jobId: string,
  tenantId: string,
  items: ExtractedProductRecord[]
) {
  const job = await db.one<any>('SELECT * FROM supplier_invoice_jobs WHERE id = ? AND tenant_id = ?', [jobId, tenantId]);
  if (!job) throw new Error('Invoice job not found');

  const header: ExtractedInvoiceHeader = typeof job.metadata === 'string' ? JSON.parse(job.metadata) : job.metadata;
  const validation = validateExtractedInvoice(header, items);
  const reconciliation = reconcileInvoice(header, validation.items);

  await db.exec('DELETE FROM supplier_invoice_items WHERE job_id = ? AND tenant_id = ?', [jobId, tenantId]);
  for (let i = 0; i < validation.items.length; i++) {
    const item = { ...validation.items[i], rowOrder: i + 1 };
    await db.exec(
      `INSERT INTO supplier_invoice_items (id, job_id, tenant_id, row_order, data, review_status, matched_item_id, match_type, user_approved, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, now(), now())`,
      [newId('sii'), jobId, tenantId, item.rowOrder, j(item), item.reviewStatus, item.matchedItemId, item.matchType, item.userApproved]
    );
  }

  await db.exec(
    `UPDATE supplier_invoice_jobs SET reconciliation = ?::jsonb, updated_at = now() WHERE id = ? AND tenant_id = ?`,
    [j(reconciliation), jobId, tenantId]
  );

  return {
    ok: true,
    items: validation.items,
    issues: validation.issues,
    reconciliation,
    summary: buildAnalysisSummary(job.page_count, validation.items, reconciliation),
  };
}

export async function exportJobExcel(db: DB, jobId: string, tenantId: string) {
  const res = await getJobResults(db, jobId, tenantId);
  if (!res) throw new Error('Invoice job not found');
  if (!res.items.length) throw new Error('No product items to export');
  const buffer = await generateTemplateExcel(res.items);
  const inv = (res.header.invoiceNumber || 'INV').replace(/[^\w-]/g, '_');
  const filename = `Supplier_Product_Import_${inv}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return { buffer, filename };
}

export async function importJobToInventory(
  db: DB,
  ctx: Ctx,
  opts: {
    jobId: string;
    tenantId: string;
    branchId: string;
    supplierId?: string | null;
    items: ExtractedProductRecord[];
  }
) {
  // Only import explicitly user-approved or verified items with a valid product name
  const eligible = opts.items.filter((item) => {
    return (item.userApproved || item.reviewStatus === 'verified') && item.name.trim().length > 0;
  });

  if (eligible.length === 0) {
    throw new Error('No verified or user-approved items to import.');
  }

  const branchRow = await db.one<{ name: string }>('SELECT name FROM branches WHERE id = ? AND tenant_id = ?', [
    opts.branchId,
    opts.tenantId,
  ]);
  const location = branchRow?.name || 'Main';

  let created = 0;
  let restocked = 0;
  const importedIds: string[] = [];

  for (const row of eligible) {
    const spMinor = Math.round((parseImportNumeric(row.sellingPrice) || 0) * 100);
    const cpMinor = Math.round((parseImportNumeric(row.costPrice) || 0) * 100);
    const qtyMilli = Math.round((parseImportNumeric(row.openingStock) || 0) * 1000);
    const gstNum = parseImportNumeric(row.gstRate ? row.gstRate.replace('%', '') : null) ?? 5;
    const taxRateBp = Math.round(gstNum * 100);
    const taxInclusive = row.priceInclusive === 'Yes';

    if (row.matchedItemId && row.matchType !== 'new_product') {
      await db.exec(
        `UPDATE items SET price_minor = ?, cost_minor = ?, tax_rate_bp = ?, tax_inclusive = ?, updated_at = now()
         WHERE id = ? AND tenant_id = ?`,
        [spMinor, cpMinor, taxRateBp, taxInclusive, row.matchedItemId, opts.tenantId]
      );
      if (qtyMilli > 0) {
        await db.exec(
          `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, ref_type, ref_id, unit_cost_minor, reason, user_id)
           VALUES (?, ?, ?, ?, ?, ?, 'purchase', 'supplier_invoice_job', ?, ?, 'Supplier invoice direct import restock', ?)`,
          [newId('sm'), opts.tenantId, opts.branchId, row.matchedItemId, location, qtyMilli, opts.jobId, cpMinor, ctx.user!.id]
        );
        await syncItemStockStatus(db, opts.tenantId, row.matchedItemId);
      }
      restocked++;
      importedIds.push(row.matchedItemId);
    } else {
      const existingSkus = new Set(
        (await db.query<{ sku: string }>('SELECT sku FROM items WHERE tenant_id = ? AND sku IS NOT NULL', [opts.tenantId])).map((r) => r.sku.toLowerCase())
      );
      const seenSkus = new Set<string>();
      const existingBarcodes = new Set(
        (await db.query<{ barcode: string }>('SELECT barcode FROM items WHERE tenant_id = ? AND barcode IS NOT NULL', [opts.tenantId])).map((r) => r.barcode)
      );
      const sku = generateUniqueShortSku(row.name, existingSkus, seenSkus);
      const barcode = generateUniqueInternalBarcode(existingBarcodes);
      const itemId = newId('itm');

      await db.exec(
        `INSERT INTO items (
          id, tenant_id, branch_id, name, size, sku, barcode, barcode_type, hsn, unit,
          price_minor, cost_minor, tax_rate_bp, tax_inclusive, track_stock,
          preferred_supplier_id, active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INTERNAL', ?, ?, ?, ?, ?, ?, true, ?, true)`,
        [
          itemId,
          opts.tenantId,
          opts.branchId,
          row.name.trim(),
          (row.size || row.sizeWeightVolume || '').trim() || null,
          sku,
          barcode,
          row.hsn || null,
          row.uom || 'pcs',
          spMinor,
          cpMinor,
          taxRateBp,
          taxInclusive,
          opts.supplierId || null,
        ]
      );

      if (qtyMilli > 0) {
        await db.exec(
          `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, ref_type, ref_id, unit_cost_minor, reason, user_id)
           VALUES (?, ?, ?, ?, ?, ?, 'opening', 'supplier_invoice_job', ?, ?, 'Supplier invoice direct import', ?)`,
          [newId('sm'), opts.tenantId, opts.branchId, itemId, location, qtyMilli, opts.jobId, cpMinor, ctx.user!.id]
        );
      }
      created++;
      importedIds.push(itemId);
    }

    // Record supplier learning correction if original OCR text differs from confirmed name
    if (row.originalOcrText && row.originalOcrText.trim() !== row.name.trim()) {
      const key = normalizeCorrectionKey(row.originalOcrText);
      if (key) {
        await db.exec(
          `INSERT INTO supplier_invoice_corrections
           (id, tenant_id, supplier_id, original_ocr_name, normalized_ocr_key, corrected_name, preferred_uom, preferred_hsn, preferred_gst_rate, matched_item_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newId('sic'),
            opts.tenantId,
            opts.supplierId || null,
            row.originalOcrText.trim(),
            key,
            row.name.trim(),
            row.uom,
            row.hsn || null,
            row.gstRate,
            row.matchedItemId || null,
          ]
        );
      }
    }
  }

  await db.exec(
    `UPDATE supplier_invoice_jobs SET status = 'imported', updated_at = now() WHERE id = ? AND tenant_id = ?`,
    [opts.jobId, opts.tenantId]
  );

  await audit(db, ctx, {
    action: 'import_supplier_invoice_job',
    entity: 'supplier_invoice_jobs',
    entityId: opts.jobId,
    detail: { created, restocked, importedCount: eligible.length },
  });

  return { ok: true, created, restocked, importedIds };
}
