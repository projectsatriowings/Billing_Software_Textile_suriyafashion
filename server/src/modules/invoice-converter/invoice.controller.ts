import { bad, notFound, FileResponse, V, type Ctx } from '../../http.ts';
import { resolveBranchScope } from '../../branchScope.ts';
import {
  createUploadJob,
  exportJobExcel,
  getJobResults,
  getProcessingCapabilities,
  importJobToInventory,
  runExtractionJob,
  updateJobItems,
} from './invoice.service.ts';
import { validateExtractedInvoice } from './services/data-validator.ts';
import { reconcileInvoice } from './services/invoice-reconciler.ts';
import { matchProductsWithCatalog, type CatalogItemRow } from './services/product-matcher.ts';
import { normalizeCorrectionKey } from './services/product-mapper.ts';
import { newId } from '../../security.ts';

export async function handleCapabilities(_ctx: Ctx) {
  return { ok: true, capabilities: getProcessingCapabilities() };
}

export async function handleUpload(ctx: Ctx) {
  const b = ctx.body || {};
  const fileName = V.str(b.fileName, 'File name', { required: true, max: 255 });
  if (typeof b.fileData !== 'string' || !b.fileData.trim()) {
    throw bad('File data is required', 'VALIDATION', { field: 'fileData' });
  }
  const result = await createUploadJob(ctx.db, {
    tenantId: ctx.user!.tenantId,
    branchId: ctx.user!.branchId,
    userId: ctx.user!.id,
    supplierId: typeof b.supplierId === 'string' ? b.supplierId : null,
    fileName,
    fileData: b.fileData.trim(),
    mimeType: typeof b.mimeType === 'string' ? b.mimeType : undefined,
  });
  return { ok: true, ...result };
}

export async function handleExtract(ctx: Ctx) {
  const b = ctx.body || {};
  const jobId = ctx.params.id;
  return await runExtractionJob(ctx.db, {
    jobId,
    tenantId: ctx.user!.tenantId,
    supplierId: typeof b.supplierId === 'string' ? b.supplierId : undefined,
    fileData: typeof b.fileData === 'string' ? b.fileData : undefined,
    fileName: typeof b.fileName === 'string' ? b.fileName : undefined,
    mimeType: typeof b.mimeType === 'string' ? b.mimeType : undefined,
  });
}

export async function handleGetResults(ctx: Ctx) {
  const res = await getJobResults(ctx.db, ctx.params.id, ctx.user!.tenantId);
  if (!res) throw notFound('Invoice extraction job');
  return res;
}

export async function handleUpdateItems(ctx: Ctx) {
  const b = ctx.body || {};
  if (!Array.isArray(b.items)) {
    throw bad('items array is required', 'VALIDATION');
  }
  return await updateJobItems(ctx.db, ctx.params.id, ctx.user!.tenantId, b.items);
}

export async function handleValidate(ctx: Ctx) {
  const res = await getJobResults(ctx.db, ctx.params.id, ctx.user!.tenantId);
  if (!res) throw notFound('Invoice extraction job');
  const b = ctx.body || {};
  const items = Array.isArray(b.items) ? b.items : res.items;
  const header = b.header || res.header;
  const validation = validateExtractedInvoice(header, items);
  const reconciliation = reconcileInvoice(header, validation.items);
  return { ok: true, items: validation.items, issues: validation.issues, reconciliation };
}

export async function handleMatchProducts(ctx: Ctx) {
  const res = await getJobResults(ctx.db, ctx.params.id, ctx.user!.tenantId);
  if (!res) throw notFound('Invoice extraction job');
  const b = ctx.body || {};
  const items = Array.isArray(b.items) ? b.items : res.items;
  const catalogRows = await ctx.db.query<CatalogItemRow>(
    `SELECT id, name, sku, barcode, hsn, unit, price_minor as "priceMinor", cost_minor as "costMinor"
     FROM items WHERE tenant_id = ? AND active = true`,
    [ctx.user!.tenantId]
  );
  const matched = matchProductsWithCatalog(items, catalogRows);
  return { ok: true, items: matched };
}

export async function handleExport(ctx: Ctx) {
  const { buffer, filename } = await exportJobExcel(ctx.db, ctx.params.id, ctx.user!.tenantId);
  return new FileResponse(
    buffer,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename
  );
}

export async function handleImport(ctx: Ctx) {
  const b = ctx.body || {};
  const res = await getJobResults(ctx.db, ctx.params.id, ctx.user!.tenantId);
  if (!res) throw notFound('Invoice extraction job');
  const scope = await resolveBranchScope(ctx);
  const items = Array.isArray(b.items) ? b.items : res.items;
  return await importJobToInventory(ctx.db, ctx, {
    jobId: ctx.params.id,
    tenantId: ctx.user!.tenantId,
    branchId: scope.branchId || ctx.user!.branchId || 'main',
    supplierId: typeof b.supplierId === 'string' ? b.supplierId : null,
    items,
  });
}

export async function handleHistory(ctx: Ctx) {
  const rows = await ctx.db.query(
    `SELECT id, file_name as "fileName", page_count as "pageCount", status, processing_stage as "processingStage",
            ocr_provider as "ocrProvider", ai_provider as "aiProvider", metadata, reconciliation,
            created_at as "createdAt", updated_at as "updatedAt"
     FROM supplier_invoice_jobs
     WHERE tenant_id = ?
     ORDER BY created_at DESC
     LIMIT 30`,
    [ctx.user!.tenantId]
  );
  return { ok: true, jobs: rows };
}

export async function handleSaveCorrection(ctx: Ctx) {
  const b = ctx.body || {};
  const originalOcrName = V.str(b.originalOcrName, 'Original OCR name', { required: true });
  const correctedName = V.str(b.correctedName, 'Corrected name', { required: true });
  const key = normalizeCorrectionKey(originalOcrName);
  const id = newId('sic');
  await ctx.db.exec(
    `INSERT INTO supplier_invoice_corrections
     (id, tenant_id, supplier_id, supplier_gstin, supplier_name, original_ocr_name, normalized_ocr_key,
      corrected_name, preferred_uom, preferred_hsn, preferred_gst_rate, matched_item_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      ctx.user!.tenantId,
      b.supplierId || null,
      b.supplierGstin || null,
      b.supplierName || null,
      originalOcrName,
      key,
      correctedName,
      b.preferredUom || null,
      b.preferredHsn || null,
      b.preferredGstRate || null,
      b.matchedItemId || null,
    ]
  );
  return { ok: true, id };
}
