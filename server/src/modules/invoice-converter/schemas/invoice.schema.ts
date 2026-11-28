/**
 * Strict Structured JSON Contracts & Runtime Validators for Supplier Invoice Processing.
 * Never fabricates confidence scores or missing values.
 */

export type ReviewStatus =
  | 'verified'
  | 'needs_review'
  | 'missing_information'
  | 'calculation_mismatch'
  | 'duplicate_product'
  | 'new_catalog_item';

export type ConfidenceStatus = 'scored' | 'unknown';

export interface FieldConfidence {
  score: number | null; // 0..1 when provided by OCR/AI model, null when unavailable
  status: ConfidenceStatus;
}

export interface BoundingBox {
  page: number;
  x: number;      // normalized 0..1 or pixel coordinate
  y: number;
  width: number;
  height: number;
  unit: 'normalized' | 'px';
}

export interface ExtractedInvoiceHeader {
  supplierName: string | null;
  supplierGstin: string | null;
  supplierAddress: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  purchaseOrderNumber: string | null;
  deliveryOrLrNumber: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  subtotal: number | null;
  discount: number | null;
  sgst: number | null;
  cgst: number | null;
  igst: number | null;
  otherCharges: number | null;
  roundOff: number | null;
  finalInvoiceAmount: number | null;
}

export interface ExtractedProductRecord {
  id: string;
  rowOrder: number;
  // Core export fields (kept compatible with UI & 4-column Excel template)
  name: string;
  size?: string;
  uom: string;
  sellingPrice: string;
  costPrice: string;
  hsn: string;
  gstRate: string;
  priceInclusive: 'Yes' | 'No';
  openingStock: string;

  // Extended intelligent extraction fields (null when unavailable)
  brand: string | null;
  description: string | null;
  variant: string | null;
  sizeWeightVolume: string | null;
  quantity: number | null;
  boxCartonQty: number | null;
  piecesPerBox: number | null;
  unitPurchaseRate: number | null;
  lineItemAmount: number | null;
  discountAmount: number | null;
  gstPercentage: number | null;
  gstAmount: number | null;
  isDittoInherited: boolean;

  // Provenance, confidence & validation
  originalOcrText: string | null;
  sourcePage: number;
  sourceBbox: BoundingBox | null;
  fieldConfidence: Record<string, FieldConfidence>;
  reviewStatus: ReviewStatus;
  warningMessages: string[];
  validationErrors: string[];
  flags: string[];

  // Product matching & approval
  matchType: 'exact_match' | 'potential_match' | 'ambiguous_match' | 'new_product';
  matchedItemId: string | null;
  matchedItemName: string | null;
  matchCandidates: ProductMatchCandidate[];
  userApproved: boolean;

  // Legacy raw fields for backward compatibility
  rawRate?: string;
  rawQty?: string;
  rawDiscount?: string;
  rawTaxable?: string;
  rawTotal?: string;
  confidence?: 'high' | 'medium' | 'low';
}

export interface ProductMatchCandidate {
  itemId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  hsn: string | null;
  unit: string | null;
  sellingPriceMinor: number;
  costPriceMinor: number;
  similarityScore: number; // 0..1 deterministic similarity
  matchReason: string;
}

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  rowId?: string;
  rowOrder?: number;
  field?: string;
  message: string;
}

export interface ReconciliationReport {
  invoiceSubtotal: number | null;
  extractedLineSum: number;
  subtotalDifference: number | null;
  invoiceTaxTotal: number | null;
  extractedTaxSum: number;
  taxDifference: number | null;
  invoiceGrandTotal: number | null;
  computedGrandTotal: number;
  grandTotalDifference: number | null;
  isReconciled: boolean;
  discrepancyMessages: string[];
}

export interface InvoiceAnalysisSummary {
  totalPagesProcessed: number;
  totalProductRows: number;
  verifiedProducts: number;
  productsRequiringReview: number;
  missingMandatoryFields: number;
  extractionCompletenessPct: number;
  invoiceTotal: number | null;
  extractedLineItemTotal: number;
  reconciliationDifference: number | null;
}

export interface ProcessingCapabilities {
  localPreprocessing: boolean;
  localOcrEngine: 'tesseract.js+pdf-parse';
  cloudOcrProvider: 'google-document-ai' | 'none';
  cloudOcrConfigured: boolean;
  aiProvider: 'gemini-vision' | 'none';
  aiConfigured: boolean;
}

export interface AiRawLineItem {
  productName: string | null;
  brand?: string | null;
  description?: string | null;
  variant?: string | null;
  sizeWeightVolume?: string | null;
  hsnCode?: string | null;
  quantity?: number | null;
  uom?: string | null;
  boxCartonQty?: number | null;
  piecesPerBox?: number | null;
  unitPurchaseRate?: number | null;
  lineItemAmount?: number | null;
  discount?: number | null;
  gstPercentage?: number | null;
  gstAmount?: number | null;
  priceInclusiveOfGst?: boolean | null;
  isDitto?: boolean;
  originalText?: string | null;
  sourcePage?: number | null;
  confidence?: number | null;
}

export interface AiRawInvoicePayload {
  header: ExtractedInvoiceHeader;
  items: AiRawLineItem[];
}

function toNullableStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function toNullableNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/,/g, '').replace(/[₹$]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Strict runtime validator for AI-generated invoice JSON.
 * Rejects malformed payloads instead of silently accepting garbage.
 */
export function validateAiExtractionPayload(raw: unknown): { ok: true; data: AiRawInvoicePayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'AI output must be a JSON object with header and items' };
  }
  const obj = raw as Record<string, unknown>;
  if (!obj.header || typeof obj.header !== 'object' || Array.isArray(obj.header)) {
    return { ok: false, error: 'AI output missing valid "header" object' };
  }
  if (!Array.isArray(obj.items)) {
    return { ok: false, error: 'AI output missing "items" array' };
  }

  const h = obj.header as Record<string, unknown>;
  const header: ExtractedInvoiceHeader = {
    supplierName: toNullableStr(h.supplierName),
    supplierGstin: toNullableStr(h.supplierGstin),
    supplierAddress: toNullableStr(h.supplierAddress),
    invoiceNumber: toNullableStr(h.invoiceNumber),
    invoiceDate: toNullableStr(h.invoiceDate),
    purchaseOrderNumber: toNullableStr(h.purchaseOrderNumber),
    deliveryOrLrNumber: toNullableStr(h.deliveryOrLrNumber),
    billingAddress: toNullableStr(h.billingAddress),
    shippingAddress: toNullableStr(h.shippingAddress),
    subtotal: toNullableNum(h.subtotal),
    discount: toNullableNum(h.discount),
    sgst: toNullableNum(h.sgst),
    cgst: toNullableNum(h.cgst),
    igst: toNullableNum(h.igst),
    otherCharges: toNullableNum(h.otherCharges),
    roundOff: toNullableNum(h.roundOff),
    finalInvoiceAmount: toNullableNum(h.finalInvoiceAmount),
  };

  const items: AiRawLineItem[] = [];
  for (let i = 0; i < obj.items.length; i++) {
    const row = obj.items[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, error: `AI output item at index ${i} is not an object` };
    }
    const r = row as Record<string, unknown>;
    const conf = toNullableNum(r.confidence);
    items.push({
      productName: toNullableStr(r.productName),
      brand: toNullableStr(r.brand),
      description: toNullableStr(r.description),
      variant: toNullableStr(r.variant),
      sizeWeightVolume: toNullableStr(r.sizeWeightVolume),
      hsnCode: toNullableStr(r.hsnCode),
      quantity: toNullableNum(r.quantity),
      uom: toNullableStr(r.uom),
      boxCartonQty: toNullableNum(r.boxCartonQty),
      piecesPerBox: toNullableNum(r.piecesPerBox),
      unitPurchaseRate: toNullableNum(r.unitPurchaseRate),
      lineItemAmount: toNullableNum(r.lineItemAmount),
      discount: toNullableNum(r.discount),
      gstPercentage: toNullableNum(r.gstPercentage),
      gstAmount: toNullableNum(r.gstAmount),
      priceInclusiveOfGst: typeof r.priceInclusiveOfGst === 'boolean' ? r.priceInclusiveOfGst : null,
      isDitto: Boolean(r.isDitto),
      originalText: toNullableStr(r.originalText),
      sourcePage: toNullableNum(r.sourcePage),
      confidence: conf !== null && conf >= 0 && conf <= 1 ? conf : null,
    });
  }

  return { ok: true, data: { header, items } };
}
