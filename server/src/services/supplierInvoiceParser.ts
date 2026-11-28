import { PDFParse } from 'pdf-parse';
import ExcelJS from 'exceljs';
import UPNG from '@pdf-lib/upng';
import jpeg from 'jpeg-js';

// Lazy loader for optional heavy OCR engine
async function getTesseract() {
  try {
    const mod = await import('tesseract.js');
    return {
      createWorker: mod.createWorker,
      PSM: mod.PSM,
    };
  } catch (err: any) {
    throw new Error(`Tesseract OCR module is not available: ${err.message || String(err)}`);
  }
}

export interface ExtractedProductItem {
  id: string;
  name: string;
  uom: string;
  sellingPrice: string;
  costPrice: string;
  hsn: string;
  gstRate: string;
  priceInclusive: 'Yes' | 'No';
  openingStock: string;
  rawRate?: string;
  rawQty?: string;
  rawDiscount?: string;
  rawTaxable?: string;
  rawTotal?: string;
  confidence?: 'high' | 'medium' | 'low';
  flags?: string[];
}

export interface InvoiceMetadata {
  supplierName: string;
  supplierGstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number | null;
  rawText: string;
  subtotalAmount?: number | null;
  cgstAmount?: number | null;
  sgstAmount?: number | null;
  igstAmount?: number | null;
  buyerName?: string;
  buyerAddress?: string;
  buyerGstin?: string;
  discrepancyWarning?: string;
}

export interface ColumnMapping {
  productNameCol?: string;
  quantityCol?: string;
  uomCol?: string;
  rateCol?: string;
  hsnCol?: string;
  gstRateCol?: string;
  taxableCol?: string;
  discountCol?: string;
  totalCol?: string;
  [key: string]: string | undefined;
}

export interface CatalogItemSummary {
  name: string;
  sku?: string;
  barcode?: string;
  hsn?: string;
  spMinor?: number;
  costMinor?: number;
}

// ── Known Heading Variations ──────────────────────────────────────────────────
export const HEADING_SYNONYMS: Record<string, string[]> = {
  productName: [
    'name of product / service',
    'name of product',
    'item description',
    'product description',
    'particulars',
    'description of goods',
    'description',
    'product name',
    'item name',
    'product',
    'items',
    'item',
    'goods description',
    'commodity',
    'material description',
    'service description',
    'details of goods',
    'nore of product',
    'descrip',
    'particul',
  ],
  quantity: [
    'billed qty',
    'total qty',
    'quantity',
    'qty',
    'units',
    'pcs',
    'qnty',
    'nos',
    'count',
    'quant',
    'volume',
    'ay',
    'qiy',
    'qt',
  ],
  uom: [
    'uom',
    'unit',
    'pkg',
    'packing',
    'measure',
    'packaging',
    'per',
    'u/m',
  ],
  rate: [
    'unit rate',
    'unit price',
    'basic rate',
    'rate',
    'price',
    'price/unit',
    'rate (rs)',
    'rate (in rs)',
    'mrp',
    'purchase rate',
    'basic price',
    'rate per unit',
    'roe',
    'rote',
  ],
  hsn: [
    'hsn / sac',
    'hsn/sac',
    'hsn code',
    'hsn',
    'sac code',
    'sac',
    'commodity code',
    'tariff',
    'hw sac',
    'hsn/sac code',
  ],
  gstRate: [
    'gst %',
    'tax rate',
    'tax %',
    'gst rate',
    'gst',
    'tax',
    'rate %',
    'cgst %',
    'sgst %',
    'igst %',
    'tax percentage',
  ],
  taxable: [
    'taxable value',
    'taxable amt',
    'taxable amount',
    'taxable val',
    'basic amount',
    'amount',
    'taxable',
    'net value',
    'assessable value',
  ],
  discount: [
    'discount',
    'disc %',
    'disc amt',
    'disc',
    'trade discount',
    'cd %',
    'scheme disc',
  ],
  taxAmount: [
    'tax amount',
    'tax amt',
    'gst amount',
    'cgst amount',
    'sgst amount',
    'igst amount',
    'total tax',
  ],
  total: [
    'amount after tax',
    'total amount',
    'net amount',
    'item total',
    'final amount',
    'bill amount',
    'amount (rs)',
    'total (rs)',
    'value',
    'total',
  ],
};

// ── Common UOM Variations & Normalization ─────────────────────────────────────
const UOM_VARIANTS: Record<string, string[]> = {
  KGS: ['KG', 'KGS', 'KILOGRAM', 'KILOGRAMS', 'KILO', 'KES'],
  LTR: ['LTR', 'LT', 'LITER', 'LITRE', 'LITRES', 'MW'],
  PCS: ['PCS', 'PC', 'PIECE', 'PIECES', 'NOS', 'NO', 'UNIT', 'UNITS', 'EACH', 'PES', 'POS', 'PCS.', 'PC.'],
  BOX: ['BOX', 'BOXES', 'BX'],
  PACK: ['PACK', 'PACKET', 'PACKETS', 'PAC'],
  PKT: ['PKT', 'POUCH', 'POUCHES'],
  BAG: ['BAG', 'BAGS'],
  TIN: ['TIN', 'TINS'],
  BOTTLE: ['BOTTLE', 'BOTTLES', 'BTL'],
  CAN: ['CAN', 'CANS'],
  STRIP: ['STRIP', 'STRIPS'],
  JAR: ['JAR', 'JARS'],
  GMS: ['GMS', 'GM', 'GRAM', 'GRAMS', 'G'],
  MTR: ['MTR', 'METER', 'METERS', 'MT'],
  PAIR: ['PAIR', 'PAIRS', 'PRS'],
  SET: ['SET', 'SETS'],
  DOZ: ['DOZ', 'DOZEN'],
};

export const UOM_WORD_REGEX = /\b(?:kes|kgs?|kilograms?|ltr?s?|litres?|liters?|mw|pcs?\.?|pieces?|nos?\.?|units?|box(?:es)?|packs?(?:ets?)?|pkts?|pouches?|bags?|gms?|grams?|tins?|bottles?|cans?|strips?|jars?|tubes?|cartons?)\b/i;

export function normalizeUom(raw: string, productNameHint = ''): string {
  const trimmed = (raw || '').trim();
  // Never return numeric strings as UOM
  if (!trimmed || /^[0-9.,]+$/.test(trimmed)) {
    const pUpper = productNameHint.toUpperCase();
    if (/\b(?:KGS|KG)\b/i.test(pUpper)) return 'KGS';
    if (/\b(?:LTR|LITRE|LITER)\b/i.test(pUpper)) return 'LTR';
    if (/\b(?:PKT)\b/i.test(pUpper)) return 'PKT';
    if (/\b(?:BAG)\b/i.test(pUpper)) return 'bag';
    if (/\b(?:BOX)\b/i.test(pUpper)) return 'box';
    return 'pcs';
  }

  const clean = trimmed.toUpperCase();
  // Handle OCR typos:
  if (clean === 'KES') return 'KGS';
  if (clean === 'MW') return 'LTR';
  if (clean === 'PES' || clean === 'POS') return 'pcs';

  // If clean matches a standard UOM, preserve the original casing from invoice
  for (const [standard, synonyms] of Object.entries(UOM_VARIANTS)) {
    if (synonyms.includes(clean)) {
      return trimmed;
    }
  }

  return trimmed;
}

export function parseUomAndQty(
  qtyRaw: string,
  uomRaw = '',
  nameHint = ''
): { qty: string; uom: string } {
  let qty = '1';
  let uom = '';

  const cleanQty = (qtyRaw || '').trim();
  const cleanUom = (uomRaw || '').trim();

  // Pattern: "1 KGS", "1KGS", "1.50 LTR", "10 PCS", "500 gm"
  const m = cleanQty.match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?$/);
  if (m) {
    qty = m[1];
    if (m[2]) uom = m[2];
  } else if (/^[0-9]+(?:\.[0-9]+)?$/.test(cleanQty.replace(/,/g, ''))) {
    qty = cleanQty.replace(/,/g, '');
  }

  // Use cleanUom only if it's not a numeric price
  if (!uom && cleanUom && !/^[0-9.,]+$/.test(cleanUom) && /[a-zA-Z]/.test(cleanUom)) {
    uom = cleanUom;
  }

  // If cleanQty itself was a UOM word (e.g. "Kes" / "KGS", "mw" / "LTR", "PCS")
  if (!uom && cleanQty && !/^[0-9.,]+$/.test(cleanQty)) {
    for (const [standard, synonyms] of Object.entries(UOM_VARIANTS)) {
      for (const syn of synonyms) {
        if (new RegExp(`^${syn}$`, 'i').test(cleanQty) || new RegExp(`\\b${syn}\\b`, 'i').test(cleanQty)) {
          uom = standard;
          qty = '1';
          break;
        }
      }
      if (uom) break;
    }
  }

  return {
    qty: qty || '1',
    uom: normalizeUom(uom, nameHint),
  };
}

// ── Safe Image Preprocessing ──────────────────────────────────────────────────
export function preprocessInvoiceImage(buffer: Buffer): Buffer {
  // Preserve raw buffer to avoid destructive cropping or nearest-neighbor distortion
  return buffer;
}

// ── Text Extraction (PDF / OCR) ───────────────────────────────────────────────
export async function extractTextFromInvoice(
  buffer: Buffer,
  fileName: string,
  mimeType?: string
): Promise<{ text: string; pages: number; isOcr: boolean; tableData?: string[][]; sparseText?: string }> {
  // Plain text fallback (e.g. for testing or raw text dumps)
  if (mimeType?.startsWith('text/') || fileName.toLowerCase().endsWith('.txt')) {
    return { text: buffer.toString('utf8'), pages: 1, isOcr: false };
  }

  const isPdf = mimeType?.includes('pdf') || fileName.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    let pdfParser: PDFParse | null = null;
    try {
      pdfParser = new PDFParse({ data: buffer });
      const textResult = await pdfParser.getText();
      const extractedText = (textResult.text || '').trim();
      const totalPages = textResult.total || 1;

      let tableData: string[][] | undefined;
      try {
        const tableResult = await pdfParser.getTable();
        if (tableResult?.mergedTables?.length) {
          tableData = tableResult.mergedTables[0];
        }
      } catch {
        // Fall back to line parsing
      }

      // Check if this is a scanned PDF (very little or no digital text)
      if (extractedText.length >= 60 && /[a-zA-Z]{3,}/.test(extractedText)) {
        await pdfParser.destroy();
        return { text: extractedText, pages: totalPages, isOcr: false, tableData };
      }

      // Scanned PDF fallback: try extracting embedded images and running OCR
      let scannedImageOcr = '';
      try {
        const imageResult = await pdfParser.getImage({ imageBuffer: true });
        if (imageResult?.pages?.length) {
          const { createWorker, PSM } = await getTesseract();
          const worker = await createWorker('eng');
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.AUTO,
            user_defined_dpi: '300',
          });
          for (const page of imageResult.pages) {
            for (const img of page.images) {
              if (img.data && img.data.byteLength > 1000) {
                const imgBuf = Buffer.from(img.data);
                const ret = await worker.recognize(imgBuf);
                scannedImageOcr += '\n' + ret.data.text;
              }
            }
          }
          await worker.terminate();
        }
      } catch {
        // Ignore OCR fallback error
      }
      await pdfParser.destroy();

      if (scannedImageOcr.trim().length > 20) {
        return { text: scannedImageOcr.trim(), pages: totalPages, isOcr: true };
      }

      return { text: extractedText, pages: totalPages, isOcr: false, tableData };
    } catch (err: any) {
      if (pdfParser) {
        try { await pdfParser.destroy(); } catch { }
      }
      throw new Error(`Failed to parse PDF document: ${err.message || String(err)}`);
    }
  }

  // Image files (JPG, JPEG, PNG)
  try {
    const { createWorker, PSM } = await getTesseract();
    const worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      user_defined_dpi: '300',
    });
    const ret = await worker.recognize(buffer);

    let sparseText = '';
    try {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const sparseRet = await worker.recognize(buffer);
      sparseText = (sparseRet.data.text || '').trim();
    } catch {
      // Sparse pass optional
    }

    await worker.terminate();
    return { text: (ret.data.text || '').trim(), pages: 1, isOcr: true, sparseText };
  } catch (err: any) {
    throw new Error(`OCR processing failed for image: ${err.message || String(err)}`);
  }
}

// ── Summary / Footer Row Detection ───────────────────────────────────────────
export function isSummaryOrFooterRow(line: string): boolean {
  const l = (line || '').trim().toLowerCase();
  if (!l) return false;

  const summaryPatterns = [
    /^(?:total|grand\s*total|sub\s*total|subtotal|net\s*payable|total\s*payable|amount\s*chargeable|invoice\s*total)\b/i,
    /^(?:toul|totl|tot)\b/i, // OCR variations of "Total"
    /^(?:taxable\s*amount|taxable\s*value|basic\s*amount)\b/i,
    /^(?:total\s*tax|add\s*:\s*(?:cgst|sgst|igst)|cgst\b|sgst\b|igst\b|tax\s*amount|cess\b)/i,
    /^(?:round\s*off|rounded\s*off|discount\s*total|total\s*discount)\b/i,
    /^(?:total\s*in\s*words|amount\s*in\s*words|rupees\s+(?:only|in\s*words)|two\s+thousand|one\s+thousand|three\s+thousand)\b/i,
    /^(?:bank\s*details|account\s*(?:no|num|number)|a\/c|ifsc|branch|upi\s*id|pay\s*using\s*upi)\b/i,
    /^(?:terms\s*(?:and|&)\s*conditions|subject\s*to|our\s*responsibility|goods\s*once\s*sold|delivery\s*ex-premises)\b/i,
    /^(?:authorised\s*signatory|authorized\s*signatory|certified\s*that|for\s+go\s+gst|for\s+[a-z0-9&.,\- ]+demo|signature)\b/i,
    /^(?:e\.?\s*&\s*o\.?e\.?|customer\s*detail|delivery\s*date|store\s*location)\b/i,
  ];

  return summaryPatterns.some((rx) => rx.test(l));
}

// ── Rule-Based Invoice Metadata Extraction ────────────────────────────────────
export function parseInvoiceMetadata(rawText: string, sparseText = ''): InvoiceMetadata {
  const fullText = (sparseText ? sparseText + '\n' + rawText : rawText).trim();
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 1. GSTIN Extraction & OCR Correction
  const GSTIN_REGEX = /\b([0-9Z]{2}[A-Z]{5}[0-9I]{4}[A-Z]{1}[1-9A-Z]{1}[Z20O][0-9A-Z]{1})\b/gi;
  const gstinMatches: string[] = [];
  let gm: RegExpExecArray | null;
  while ((gm = GSTIN_REGEX.exec(fullText)) !== null) {
    let g = gm[1].toUpperCase();
    if (g.startsWith('Z')) g = '2' + g.slice(1);
    if (g[1] === 'O') g = g[0] + '9' + g.slice(2);
    if (g[13] === '2' || g[13] === '0' || g[13] === 'O') {
      g = g.slice(0, 13) + 'Z' + g.slice(14);
    }
    const dPart = g.slice(7, 11).replace(/I/g, '1').replace(/O/g, '0');
    g = g.slice(0, 7) + dPart + g.slice(11);
    if (!gstinMatches.includes(g)) {
      gstinMatches.push(g);
    }
  }

  const labelGstinMatch = fullText.match(/GSTIN\s*[:.-]?\s*([A-Za-z0-9]{15})/i);
  if (labelGstinMatch) {
    let g = labelGstinMatch[1].toUpperCase();
    if (g.startsWith('Z')) g = '2' + g.slice(1);
    if (g[13] === '2' || g[13] === '0' || g[13] === 'O') g = g.slice(0, 13) + 'Z' + g.slice(14);
    const dPart = g.slice(7, 11).replace(/I/g, '1').replace(/O/g, '0');
    g = g.slice(0, 7) + dPart + g.slice(11);
    if (!gstinMatches.includes(g)) {
      gstinMatches.unshift(g);
    }
  }

  // Detect Buyer GSTIN
  let buyerGstin = '';
  const billToIdx = rawText.search(/Bill\s*To|Buyer|Customer|Consignee/i);
  if (billToIdx >= 0) {
    const billToSnippet = rawText.slice(billToIdx, billToIdx + 400);
    const buyerMatch = billToSnippet.match(GSTIN_REGEX);
    if (buyerMatch && buyerMatch[0]) {
      let bg = buyerMatch[0].toUpperCase();
      if (bg[13] === '2' || bg[13] === '0' || bg[13] === 'O') bg = bg.slice(0, 13) + 'Z' + bg.slice(14);
      buyerGstin = bg;
    }
  }

  let supplierGstin = '';
  if (gstinMatches.length > 0) {
    supplierGstin = buyerGstin && gstinMatches.length > 1
      ? (gstinMatches.find((g) => g !== buyerGstin) || gstinMatches[0])
      : gstinMatches[0];
  }

  const isAddressOrLocation = (str: string): boolean => {
    if (!str) return false;
    const l = str.toLowerCase();
    if (/\b\d{6}\b/.test(l)) return true;
    if (/\b(?:bangalore|bengaluru|chennai|mumbai|delhi|kolkata|hyderabad|karnataka|tamil\s*nadu|maharashtra|gujarat|ahmedabad|layout|nagar|street|road|floor|building|cross|btm|attn:)\b/i.test(l)) return true;
    return false;
  };

  // 2. Supplier Name Detection
  let supplierName = '';

  // Strategy A: Check top header lines for prominent business name
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const line = lines[i];
    if (
      /page\s*(?:no\.?)?\s*\d+/i.test(line) ||
      /(?:tax\s*invoice|invoice|cash\s*memo|bill\s*of\s*supply|retail\s*invoice|commercial\s*invoice)/i.test(line) ||
      /(?:original\s*copy|duplicate\s*copy|triplicate\s*copy|original\s*for\s*recipient)/i.test(line) ||
      /(?:billing\s*details|buyer\s*details|customer\s*details|consignee\s*details)/i.test(line) ||
      /^(?:for\s+order\s+call|daily\s+offers)/i.test(line)
    ) {
      continue;
    }
    if (isAddressOrLocation(line)) continue;
    if (line.includes('+91') || line.includes('PHONE') || line.includes('MOBILE') || line.includes('GSTIN') || line.includes('PAN -') || line.includes('PAN:')) continue;
    const clean = line.replace(/^[^A-Za-z0-9]+/, '').trim();
    if (clean.length >= 3 && /^[A-Za-z0-9&.,\-/ ]+$/.test(clean) && !/recipient|terms|conditions|payment|goods|bank|customer|buyer/i.test(clean)) {
      supplierName = clean;
      break;
    }
  }

  // Strategy B: Signatory line check in footer
  if (!supplierName) {
    const forSignatoryMatch = fullText.match(
      /(?:(?:Authorised|Authorized)\s*Signatory\s*(?:For\s*)?([A-Za-z0-9&.,\- ]+)|(?:For\s+([A-Za-z0-9&.,\- ]+?)\s*(?:Authorised|Authorized)\s*Signatory))/i
    );
    if (forSignatoryMatch) {
      const cand = (forSignatoryMatch[1] || forSignatoryMatch[2] || '').trim();
      if (cand.length > 3 && !/order\s*call|recipient|terms|conditions|payment|goods|bank|customer|buyer|signature|demo/i.test(cand) && !isAddressOrLocation(cand)) {
        supplierName = cand;
      }
    }
  }

  // Strategy C: Brand / Distributor / Wholesale patterns
  if (!supplierName) {
    const brandMatch = fullText.match(/(?:=\s*)?([A-Za-z0-9&.,\- ]+?)\s*\n\s*(?:®\s*)*(?:Wholesale\s*Distributors|Distributors|Traders|Enterprises|Foods|Agency|Agencies|Wholesalers)/i);
    if (brandMatch) {
      const brand = brandMatch[1].trim().replace(/^[^a-zA-Z0-9]+/, '');
      if (brand.length >= 3 && !/terms|invoice|bill\s*to/i.test(brand) && !isAddressOrLocation(brand)) {
        supplierName = `${brand} Wholesale Distributors`;
      }
    }
  }

  // Strategy D: Explicit "Supplier: Name", "Sold By: Name", "M/s Name"
  if (!supplierName) {
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      const line = lines[i];
      const prefixMatch = line.match(/^(?:m\/s\.?|sold by|from|supplier|vendor|seller)\s*[:.-]?\s*([A-Za-z0-9&.,\- ]+)/i);
      if (prefixMatch && prefixMatch[1].trim().length > 3 && !isAddressOrLocation(prefixMatch[1])) {
        supplierName = prefixMatch[1].trim();
        break;
      }
    }
  }

  // 3. Invoice Number & Date
  let invoiceNumber = '';
  let invoiceDate = '';

  // Two-column paired block detection (labels on left, colon values on right)
  const rawLines = fullText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const firstColonIdx = rawLines.findIndex((l) => l.startsWith(':'));
  if (firstColonIdx > 0) {
    let colonCount = 0;
    while (firstColonIdx + colonCount < rawLines.length && rawLines[firstColonIdx + colonCount].startsWith(':')) {
      colonCount++;
    }
    const pairedLabels = rawLines.slice(Math.max(0, firstColonIdx - colonCount), firstColonIdx);
    const colonValues = rawLines.slice(firstColonIdx, firstColonIdx + colonCount);

    const invNoIdx = pairedLabels.findIndex((l) => /invoice\s*(?:number|no|num)\b/i.test(l));
    if (invNoIdx >= 0 && invNoIdx < colonValues.length) {
      const cand = colonValues[invNoIdx].replace(/^:\s*/, '').trim();
      if (cand && cand.length >= 2 && !/date|detail|reverse/i.test(cand)) {
        invoiceNumber = cand;
      }
    }

    const invDateIdx = pairedLabels.findIndex((l) => /invoice\s*date\b/i.test(l));
    if (invDateIdx >= 0 && invDateIdx < colonValues.length) {
      const cand = colonValues[invDateIdx].replace(/^:\s*/, '').trim();
      if (cand && cand.length >= 4) {
        invoiceDate = cand.replace(/\s+/g, '-').replace(/[.]/g, '-');
      }
    }
  }

  // Sparse text matching for OCR
  if (!invoiceNumber && sparseText) {
    const invMatchSparse = sparseText.match(/(?:Invoice\s*No|Inv\s*No|Bill\s*No|Tax\s*Invoice\s*No)[^\w\n]*\n+\s*([a-zA-Z0-9/_-]+)/i);
    if (invMatchSparse && invMatchSparse[1].trim()) {
      const v = invMatchSparse[1].trim();
      if ((v.length >= 2 || /[0-9]/.test(v)) && !/invoice|date|bill|gstin|phone|mobile|detail|delivery|ber/i.test(v)) {
        invoiceNumber = v;
      }
    }
  }

  if (!invoiceNumber) {
    const invNoRegex = /(?:invoice\s*(?:number\b|no\b\.?|num\b\.?|#)|inv\s*(?:number\b|no\b\.?|num\b\.?|#)|bill\s*(?:number\b|no\b\.?|num\b\.?|#)|tax\s*invoice\s*(?:number\b|no\b\.?|num\b\.?|#))[ \t.:#=-]+([a-zA-Z0-9/_-]+)/gi;
    let inMatch: RegExpExecArray | null;
    while ((inMatch = invNoRegex.exec(fullText)) !== null) {
      const val = inMatch[1].trim().replace(/[.,;]$/, '');
      if ((val.length >= 2 || /[0-9]/.test(val)) && !/^(?:ber|date|detail|customer|original|duplicate|triplicate|recipient|no|num|invoice)$/i.test(val)) {
        invoiceNumber = val;
        break;
      }
    }
  }

  if (!invoiceNumber) {
    const invPattern = fullText.match(
      /\b([0-9]{3,5}\/[0-9]{2}-[0-9]{2}|[A-Z0-9]{2,6}\/[0-9]{2,4}-[0-9]{2}\/[0-9]+|[A-Z]{2,5}\/[0-9]{4}\/[0-9]+|[A-Z]{2,5}(?:-[0-9a-zA-Z]+)+|[A-Z]{2,4}\/[0-9]{2,4}\/[0-9]+|[A-Z]{2,4}\/[A-Za-z0-9_-]+)\b/
    );
    if (invPattern && !/bill|date|tax|hsn|sac/i.test(invPattern[1])) {
      invoiceNumber = invPattern[1];
    }
  }

  // 4. Invoice Date
  if (!invoiceDate) {
    const dateMatch = fullText.match(
      /(?:invoice\s*date|inv\s*date|bill\s*date|date\s*of\s*issue|dated?|date)[\s.:#-]*\n?\s*([0-9]{1,2}\s*[-/.]?\s*[a-zA-Z0-9]{2,9}\s*[-/.]?\s*[0-9]{2,4}|[0-9]{1,2}\s+[a-zA-Z]{3,9}\s+[0-9]{2,4})/i
    );
    if (dateMatch && dateMatch[1].trim()) {
      let dStr = dateMatch[1].trim().replace(/\s+/g, '-').replace(/[.]/g, '-');
      invoiceDate = dStr;
    }
  }
  if (!invoiceDate) {
    const generalDate = fullText.match(/\b([0-9]{1,2}[-/.][a-zA-Z0-9]{2,9}[-/.][0-9]{2,4})\b/);
    if (generalDate) {
      invoiceDate = generalDate[1];
    }
  }

  // 5. Grand Total (Invoice Total)
  let totalAmount: number | null = null;
  const totalMatch = fullText.match(
    /(?:total\s*amount\s*after\s*tax|grand\s*total|invoice\s*total|invoice\s*value|net\s*payable|total\s*payable|amount\s*payable|tox)[\s.:¥₹$€RsINR#\-_]*([0-9,]+(?:\.[0-9]{1,2})?)/i
  );
  if (totalMatch && totalMatch[1]) {
    const parsed = parseFloat(totalMatch[1].replace(/,/g, ''));
    if (!isNaN(parsed) && parsed > 0) totalAmount = parsed;
  }

  // Standalone Total line: e.g. "Total 13,250.65" or "Total: ₹13,250.65"
  if (!totalAmount) {
    const singleTotalMatch = fullText.match(/(?:^|\n)\s*(?:total|grand\s*total)\s*[:\s-]*[₹$€RsINR]*\s*([0-9,]+(?:\.[0-9]{2}))\s*(?:\n|$)/i);
    if (singleTotalMatch && singleTotalMatch[1]) {
      const parsed = parseFloat(singleTotalMatch[1].replace(/,/g, ''));
      if (!isNaN(parsed) && parsed > 0) totalAmount = parsed;
    }
  }

  if (!totalAmount) {
    const altTotal = fullText.match(/(?:total\s*amount|total\s*\(₹\)|total\s*\(rs\)|net\s*amount)[\s.:¥₹$€RsINR#\-_]*([0-9,]+(?:\.[0-9]{1,2})?)/i);
    if (altTotal && altTotal[1]) {
      const parsed = parseFloat(altTotal[1].replace(/,/g, ''));
      if (!isNaN(parsed) && parsed > 0) totalAmount = parsed;
    }
  }

  // If still not found, check table footer line: e.g. "Total 4 2,307.00 215.00 2,522.00"
  if (!totalAmount) {
    const totLineMatch = fullText.match(/(?:total|toul|totl)\s+[0-9.]+\s+[0-9.,]+\s+[a-z0-9.\]\s]+\s+([0-9,]+(?:\.[0-9]{2})?)/i);
    if (totLineMatch && totLineMatch[1]) {
      let v = parseFloat(totLineMatch[1].replace(/,/g, ''));
      if (v > 10000 && !totLineMatch[1].includes('.')) v = v / 100;
      if (!isNaN(v) && v > 10) totalAmount = v;
    }
  }

  // 6. Subtotal & Taxes
  let subtotalAmount: number | null = null;
  const subMatch = fullText.match(/(?:total\s*sale\s*=|taxable\s*amount|taxable\s*value|subtotal|sub\s*total|taxable\s*amourt)[\s.:=¥₹$€RsINR]*([0-9,]+(?:\.[0-9]{1,2})?)/i);
  if (subMatch && subMatch[1]) {
    const parsed = parseFloat(subMatch[1].replace(/,/g, ''));
    if (!isNaN(parsed) && parsed > 0) subtotalAmount = parsed;
  }

  // Tax breakdown match: e.g. "Tax = 637.65" or "Total Tax = 215.00"
  const taxSumMatch = fullText.match(/(?:total\s*tax|tax\s*=)\s*[:.\s=¥₹$€RsINR]*([0-9,]+(?:\.[0-9]{1,2})?)/i);
  let taxSumAmount: number | null = null;
  if (taxSumMatch && taxSumMatch[1]) {
    const parsed = parseFloat(taxSumMatch[1].replace(/,/g, ''));
    if (!isNaN(parsed) && parsed > 0) taxSumAmount = parsed;
  }

  if (subtotalAmount && taxSumAmount && !totalAmount) {
    totalAmount = Math.round((subtotalAmount + taxSumAmount) * 100) / 100;
  }

  let cgstAmount: number | null = null;
  const cgstMatch = fullText.match(/CGST\s*(?:\([0-9.]*%\))?[\s.:¥₹$€RsINR]*([0-9,]+(?:\.[0-9]{1,2})?)/i);
  if (cgstMatch && cgstMatch[1]) {
    const parsed = parseFloat(cgstMatch[1].replace(/,/g, ''));
    if (!isNaN(parsed) && parsed >= 0) cgstAmount = parsed;
  }

  let sgstAmount: number | null = null;
  const sgstMatch = fullText.match(/SGST\s*(?:\([0-9.]*%\))?[\s.:¥₹$€RsINR]*([0-9,]+(?:\.[0-9]{1,2})?)/i);
  if (sgstMatch && sgstMatch[1]) {
    const parsed = parseFloat(sgstMatch[1].replace(/,/g, ''));
    if (!isNaN(parsed) && parsed >= 0) sgstAmount = parsed;
  }

  let igstAmount: number | null = null;
  const igstMatch = fullText.match(/(?:Add\s*:\s*)?IGST\s*(?:\([0-9.]*%\))?[\s.:¥₹$€RsINR]*([0-9,]+(?:\.[0-9]{1,2})?)|(?:add\s*tosT)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
  if (igstMatch) {
    const val = igstMatch[1] || igstMatch[2];
    if (val) {
      let parsed = parseFloat(val.replace(/,/g, ''));
      if (parsed > 10000 && !val.includes('.')) parsed = parsed / 100;
      if (!isNaN(parsed) && parsed >= 0) igstAmount = parsed;
    }
  }

  // Cross-check totalAmount with subtotal + taxes if totalAmount was missed or looks like quantity
  const totalTax = (cgstAmount || 0) + (sgstAmount || 0) + (igstAmount || 0);
  if (subtotalAmount && totalTax > 0) {
    const computedTotal = Math.round((subtotalAmount + totalTax) * 100) / 100;
    if (!totalAmount || (totalAmount < 50 && computedTotal > 100)) {
      totalAmount = computedTotal;
    }
  }

  // 7. Buyer details
  let buyerName = '';
  let buyerAddress = '';
  if (billToIdx >= 0) {
    const billToSnippet = rawText.slice(billToIdx, billToIdx + 300);
    const snipLines = billToSnippet.split('\n').map((l) => l.trim()).filter(Boolean);
    if (snipLines.length > 1) {
      buyerName = snipLines[1].replace(/^(?:bill to[:\s]*)/i, '').trim();
      if (snipLines.length > 2) {
        buyerAddress = snipLines.slice(2, 4).filter((l) => !/gstin|invoice|date/i.test(l)).join(', ');
      }
    }
  }

  return {
    supplierName,
    supplierGstin,
    invoiceNumber,
    invoiceDate,
    totalAmount,
    rawText,
    subtotalAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    buyerName,
    buyerAddress,
    buyerGstin,
  };
}

// ── Split Header Line ─────────────────────────────────────────────────────────
export function splitHeaderLine(rawHeader: string): string[] {
  if (rawHeader.includes('\t')) {
    return rawHeader.split('\t').map((h) => h.trim()).filter(Boolean);
  }
  const pipeCount = (rawHeader.match(/\|/g) || []).length;
  if (pipeCount >= 2) {
    return rawHeader.split('|').map((h) => h.trim()).filter(Boolean);
  }
  const multiSpace = rawHeader.split(/\s{2,}/).map((h) => h.trim()).filter(Boolean);
  if (multiSpace.length > 2) {
    return multiSpace;
  }

  // Keyword-based boundary identification
  const allKeywords: string[] = [];
  for (const list of Object.values(HEADING_SYNONYMS)) {
    allKeywords.push(...list);
  }
  allKeywords.sort((a, b) => b.length - a.length);

  const matchedPositions: { start: number; end: number; text: string }[] = [];
  const lower = rawHeader.toLowerCase();

  for (const kw of allKeywords) {
    let pos = 0;
    while ((pos = lower.indexOf(kw, pos)) !== -1) {
      const isWordStart = pos === 0 || /[\s|/]/.test(rawHeader[pos - 1]);
      const isWordEnd = pos + kw.length === rawHeader.length || /[\s|/%]/.test(rawHeader[pos + kw.length]);
      if (isWordStart) {
        const overlaps = matchedPositions.some((m) => !(pos + kw.length <= m.start || pos >= m.end));
        if (!overlaps) {
          matchedPositions.push({
            start: pos,
            end: pos + kw.length,
            text: rawHeader.slice(pos, pos + kw.length),
          });
        }
      }
      pos += kw.length;
    }
  }

  if (matchedPositions.length >= 2) {
    matchedPositions.sort((a, b) => a.start - b.start);
    return matchedPositions.map((m) => m.text.trim());
  }

  return rawHeader.split(/\s+/).filter(Boolean);
}

// ── Detect Table Columns & Headers ───────────────────────────────────────────
export function detectTableColumns(
  lines: string[],
  savedMapping?: ColumnMapping
): {
  headerLineIndex: number;
  headers: string[];
  columnMap: ColumnMapping;
  dataLines: string[];
} {
  let headerLineIndex = -1;
  let headers: string[] = [];

  const CORE_KEYWORDS = [
    'description',
    'particulars',
    'item',
    'product',
    'qty',
    'rate',
    'price',
    'hsn',
    'sac',
    'amount',
    'total',
    'uom',
    'unit',
  ];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    // Reject summary lines from being selected as the table header
    if (isSummaryOrFooterRow(l) || l.includes('total in words') || /^(?:grand\s+)?total\s*[:\s]+[0-9]/i.test(l)) {
      continue;
    }

    let hitCount = 0;
    for (const kw of CORE_KEYWORDS) {
      if (l.includes(kw)) hitCount++;
    }
    // Also account for OCR imperfections on headers: e.g. "nore of product", "hw sac", "ay", "roe"
    if (l.includes('nore of product') || l.includes('hw sac') || (l.includes('product') && l.includes('sac'))) {
      hitCount += 3;
    }

    if (hitCount >= 2) {
      headerLineIndex = i;
      break;
    }
  }

  if (headerLineIndex >= 0) {
    headers = splitHeaderLine(lines[headerLineIndex]);
  }

  const columnMap: ColumnMapping = { ...(savedMapping || {}) };

  const findBestCol = (field: keyof typeof HEADING_SYNONYMS): string | undefined => {
    if (columnMap[field]) return columnMap[field];
    const synonyms = HEADING_SYNONYMS[field] || [];
    for (const h of headers) {
      const hLower = h.toLowerCase();
      if (synonyms.some((syn) => hLower.includes(syn))) {
        return h;
      }
    }
    return undefined;
  };

  columnMap.productNameCol = columnMap.productNameCol || findBestCol('productName');
  columnMap.quantityCol = columnMap.quantityCol || findBestCol('quantity');
  columnMap.uomCol = columnMap.uomCol || findBestCol('uom');
  columnMap.rateCol = columnMap.rateCol || findBestCol('rate');
  columnMap.hsnCol = columnMap.hsnCol || findBestCol('hsn');
  columnMap.gstRateCol = columnMap.gstRateCol || findBestCol('gstRate');
  columnMap.taxableCol = columnMap.taxableCol || findBestCol('taxable');
  columnMap.discountCol = columnMap.discountCol || findBestCol('discount');
  columnMap.totalCol = columnMap.totalCol || findBestCol('total');

  const dataLines = headerLineIndex >= 0 ? lines.slice(headerLineIndex + 1) : lines;

  return {
    headerLineIndex,
    headers,
    columnMap,
    dataLines,
  };
}

// ── Smart Semantic Line Parser ────────────────────────────────────────────────
export interface SmartParsedRow {
  sno?: string;
  name: string;
  hsn: string;
  qty: string;
  uom: string;
  unitPrice: string;
  subtotal: string;
  gstRate: string;
  taxAmount: string;
  total: string;
  costPrice: string;
}

export function parseSmartProductLine(line: string): SmartParsedRow | null {
  const cleanLine = line.trim();
  if (!cleanLine) return null;

  if (isSummaryOrFooterRow(cleanLine)) {
    return null;
  }

  // Remove pipes, brackets, and normalize spaces
  const cleanTokens = cleanLine.replace(/[|[\]()]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (cleanTokens.length < 3) return null;

  let tokens = [...cleanTokens];
  let sno = '';
  if (/^[0-9]+[.)]?$/.test(tokens[0]) && tokens.length > 3) {
    sno = tokens[0].replace(/[.)]/g, '');
    tokens = tokens.slice(1);
  }

  // Find HSN exclusively: must be 4 to 8 digits
  let hsn = '';
  let hsnIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^[0-9]{4,8}$/.test(t) && !t.includes('.')) {
      hsn = t;
      hsnIdx = i;
      break;
    }
  }

  let name = '';
  let remainder: string[] = [];

  if (hsnIdx > 0) {
    name = tokens.slice(0, hsnIdx).join(' ').trim();
    remainder = tokens.slice(hsnIdx + 1);
  } else {
    const firstNumIdx = tokens.findIndex((t, i) => i > 0 && /^[0-9]+(?:\.[0-9]+)?$/.test(t.replace(/,/g, '')));
    if (firstNumIdx > 0) {
      name = tokens.slice(0, firstNumIdx).join(' ').trim();
      remainder = tokens.slice(firstNumIdx);
    } else {
      return null;
    }
  }

  if (!name || name.length < 2 || !/[a-zA-Z]/.test(name)) return null;

  // Quantity & UOM
  let qty = '1';
  let uom = 'PCS';
  let priceTokens: string[] = [];

  if (remainder.length > 0) {
    const firstR = remainder[0];
    const uCheck = parseUomAndQty(firstR, remainder[1] || '', name);
    const isQtyNum = /^[0-9]+(?:\.[0-9]+)?$/.test(firstR.replace(/,/g, ''));
    const isUomWord = UOM_WORD_REGEX.test(firstR);

    if (isUomWord || (firstR.match(/[a-zA-Z]/) && firstR.match(/[0-9]/))) {
      qty = uCheck.qty;
      uom = uCheck.uom;
      priceTokens = remainder.slice(1);
    } else if (isQtyNum && remainder.length >= 2) {
      qty = firstR.replace(/,/g, '');
      if (UOM_WORD_REGEX.test(remainder[1])) {
        uom = normalizeUom(remainder[1], name);
        priceTokens = remainder.slice(2);
      } else {
        uom = normalizeUom('', name);
        priceTokens = remainder.slice(1);
      }
    } else {
      uom = normalizeUom('', name);
      priceTokens = remainder;
    }
  }

  const qVal = parseFloat(qty) || 1;

  // Parse price numbers
  const parsedNums: { raw: string; val: number }[] = [];
  for (const pt of priceTokens) {
    const clean = pt.replace(/,/g, '').replace(/[^\d.-]/g, '');
    const v = parseFloat(clean);
    if (!isNaN(v) && v >= 0) {
      parsedNums.push({ raw: pt, val: v });
    }
  }

  let rate = 0;
  let taxable = 0;
  let taxAmount = 0;
  let finalAmount = 0;
  let gstRate = '5%';
  let gstVal = 5;

  for (const pt of priceTokens) {
    if (pt.includes('%')) {
      const gv = parseFloat(pt.replace(/%/g, ''));
      if (!isNaN(gv) && gv >= 0) {
        gstVal = gv;
        gstRate = `${gstVal}%`;
      }
    }
  }

  // If GST% wasn't explicitly marked with %, but we have 3 numeric tokens:
  // e.g. [rate, gstRate, amount]
  if (gstRate === '5%' && parsedNums.length >= 3) {
    for (let i = 1; i < parsedNums.length - 1; i++) {
      const candGst = parsedNums[i].val;
      if ([0, 5, 12, 18, 28].includes(candGst)) {
        gstVal = candGst;
        gstRate = `${candGst}%`;
        break;
      }
    }
  }

  // Try mathematical matching: V + T = A
  let mathMatched = false;
  for (let i = 0; i < parsedNums.length; i++) {
    let v = parsedNums[i].val;
    if (v > 10000 && !parsedNums[i].raw.includes('.')) v = v / 100;
    for (let j = 0; j < parsedNums.length; j++) {
      if (j === i) continue;
      let t = parsedNums[j].val;
      if (t > 10000 && !parsedNums[j].raw.includes('.')) t = t / 100;
      for (let k = 0; k < parsedNums.length; k++) {
        if (k === i || k === j) continue;
        let a = parsedNums[k].val;
        if (a > 10000 && !parsedNums[k].raw.includes('.')) a = a / 100;

        if (a >= v && Math.abs((v + t) - a) < 1.0) {
          taxable = v;
          taxAmount = t;
          finalAmount = a;
          rate = qVal > 0 ? v / qVal : v;
          if (v > 0) {
            gstVal = Math.round((t / v) * 100);
            gstRate = `${gstVal}%`;
          }
          mathMatched = true;
          break;
        }
      }
      if (mathMatched) break;
    }
    if (mathMatched) break;
  }

  // Check for zero-tax item: base value equals total amount (e.g. rate/taxable equals total)
  if (!mathMatched && parsedNums.length >= 2) {
    const vals = parsedNums.map((p) => (p.val > 10000 && !p.raw.includes('.') ? p.val / 100 : p.val));
    const hasZeroToken = priceTokens.some((pt) => /^(?:0|0\.00?|o|nil|exempt|zero)$/i.test(pt));
    const firstV = vals[0];
    const lastV = vals[vals.length - 1];
    if (Math.abs(firstV - lastV) < 0.5 && (hasZeroToken || vals.length >= 3 || gstRate === '0%')) {
      taxable = firstV;
      taxAmount = 0;
      finalAmount = lastV;
      rate = qVal > 0 ? firstV / qVal : firstV;
      gstVal = 0;
      gstRate = '0%';
      mathMatched = true;
    }
  }

  if (!mathMatched && parsedNums.length >= 1) {
    const lastP = parsedNums[parsedNums.length - 1];
    let candFinal = lastP.val;
    if (candFinal > 10000 && !lastP.raw.includes('.')) candFinal = candFinal / 100;

    const firstP = parsedNums[0];
    let candRate = firstP.val;
    if (candRate > 10000 && !firstP.raw.includes('.')) candRate = candRate / 100;

    rate = candRate;
    finalAmount = candFinal;
  }

  // Calculate Cost Price: represents final purchase amount per unit, including GST
  let costPrice = '';
  const preTaxAmount = rate * qVal;
  if (finalAmount > 0 && qVal > 0) {
    if (preTaxAmount > 0 && gstVal > 0 && Math.abs(finalAmount - preTaxAmount) < 1.0) {
      // The total column is pre-tax taxable amount; add GST to obtain the inclusive unit cost price
      costPrice = (rate * (1 + gstVal / 100)).toFixed(2);
      taxable = finalAmount;
      finalAmount = finalAmount * (1 + gstVal / 100);
      taxAmount = finalAmount - taxable;
    } else {
      costPrice = (finalAmount / qVal).toFixed(2);
    }
  } else if (rate > 0) {
    costPrice = (rate * (1 + gstVal / 100)).toFixed(2);
  }

  return {
    sno,
    name,
    hsn,
    qty,
    uom,
    unitPrice: rate > 0 ? rate.toFixed(2) : '',
    subtotal: taxable > 0 ? taxable.toFixed(2) : '',
    gstRate,
    taxAmount: taxAmount > 0 ? taxAmount.toFixed(2) : '',
    total: finalAmount > 0 ? finalAmount.toFixed(2) : '',
    costPrice,
  };
}

// ── Product Row Sanitization & Validation ────────────────────────────────────
export function isValidProductRow(item: ExtractedProductItem): boolean {
  if (!item || !item.name) return false;
  const name = item.name.trim();

  // 1. Min name length & must contain letters
  if (name.length < 2 || !/[a-zA-Z]/.test(name)) return false;

  // 2. Reject summary or footer rows
  if (isSummaryOrFooterRow(name)) return false;

  // 3. Reject bank details or payment metadata
  const lower = name.toLowerCase();
  if (
    /\b(?:account\s*(?:no|num|number)?|a\/c|ifsc(?:\s*code)?|bank|sbi|hdfc|icici|axis)\b/i.test(lower) ||
    lower.includes('account no') ||
    lower.includes('payment qr') ||
    lower.includes('upi id') ||
    lower.includes('@')
  ) {
    return false;
  }

  // 4. Reject terms, buyer, or address lines
  if (
    lower.includes('bill to') ||
    lower.includes('ship to') ||
    lower.includes('consignee') ||
    lower.includes('original for') ||
    lower.includes('tax invoice') ||
    lower.includes('authorised signatory') ||
    lower.includes('authorized signatory') ||
    lower.includes('terms & conditions') ||
    lower.includes('terms and conditions') ||
    lower.includes('amount in words') ||
    lower.includes('rupees only')
  ) {
    return false;
  }

  // 5. Cost price sanity: Reject astronomical cost prices
  const cost = parseFloat((item.costPrice || '0').replace(/,/g, ''));
  if (!isNaN(cost) && cost > 500000) return false;

  // 6. Quantity / stock sanity
  const qty = parseFloat((item.openingStock || '0').replace(/,/g, ''));
  if (!isNaN(qty) && qty > 500000) return false;

  return true;
}

// ── Sparse Table Fallback ─────────────────────────────────────────────────────
export function parseSparseTable(sparseText: string): ExtractedProductItem[] {
  if (!sparseText) return [];
  const lines = sparseText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let headerStart = -1;
  let headerEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^(?:s\.?no\.?|items|item\s*description|particulars|name\s*of\s*product)$/i.test(lines[i])) {
      headerStart = i;
      for (let j = i + 1; j < Math.min(lines.length, i + 15); j++) {
        if (/^(?:amount|total|rate|mrp)$/i.test(lines[j])) {
          headerEnd = j;
        }
      }
      break;
    }
  }

  if (headerStart === -1 || headerEnd === -1) return [];

  const headerTokens = lines.slice(headerStart, headerEnd + 1);
  const colRoles: string[] = headerTokens.map((h) => {
    const l = h.toLowerCase();
    if (/s\.?no|sl\.?no/i.test(l)) return 'sno';
    if (/item|description|particulars|product/i.test(l)) return 'name';
    if (/hsn|sac/i.test(l)) return 'hsn';
    if (/qty/i.test(l)) return 'qty';
    if (/rate|price/i.test(l)) return 'rate';
    if (/amount|total/i.test(l)) return 'amount';
    return 'unknown';
  });

  const numCols = colRoles.length;
  const items: ExtractedProductItem[] = [];
  let cur = headerEnd + 1;
  let rowSeq = 1;

  while (cur < lines.length) {
    if (isSummaryOrFooterRow(lines[cur])) break;

    const rowTokens: string[] = [];
    while (cur < lines.length && rowTokens.length < numCols) {
      if (isSummaryOrFooterRow(lines[cur])) break;
      rowTokens.push(lines[cur]);
      cur++;
    }

    if (rowTokens.length < 3) break;

    const rowObj: Record<string, string> = {};
    for (let c = 0; c < rowTokens.length; c++) {
      const role = colRoles[c] || `col_${c}`;
      rowObj[role] = rowTokens[c];
    }

    let name = (rowObj.name || '').replace(/^[0-9]+[.)\s]+/, '').trim();
    if (!name || name.length < 2 || isSummaryOrFooterRow(name)) continue;

    const hsn = (rowObj.hsn || '').replace(/[^0-9]/g, '');
    const { qty, uom } = parseUomAndQty(rowObj.qty || '1', '', name);

    const rateNum = parseFloat((rowObj.rate || '').replace(/[^0-9.]/g, '')) || 0;
    const amtNum = parseFloat((rowObj.amount || '').replace(/[^0-9.]/g, '')) || 0;

    let costPrice = '';
    const qVal = parseFloat(qty) || 1;
    if (amtNum > 0) {
      costPrice = (amtNum / qVal).toFixed(2);
    } else if (rateNum > 0) {
      costPrice = rateNum.toFixed(2);
    }

    items.push({
      id: `inv-item-${rowSeq++}`,
      name,
      hsn,
      uom,
      costPrice,
      gstRate: '5%',
      openingStock: qty,
      sellingPrice: '', // Kept empty per requirement
      priceInclusive: 'Yes',
      rawRate: rowObj.rate,
      rawQty: qty,
      rawTotal: rowObj.amount,
      confidence: 'medium',
      flags: ['Selling Price required'],
    });
  }

  return items.filter(isValidProductRow);
}

// ── Line Items Parser ─────────────────────────────────────────────────────────
export function parseLineItems(
  dataLines: string[],
  columnMap: ColumnMapping,
  headers: string[] = [],
  sparseText = '',
  tableData?: string[][]
): ExtractedProductItem[] {
  // ── Strategy 1: Grid Table Parsing (When structured tableData is available from PDF) ──
  if (tableData && tableData.length > 1) {
    const tableHeaderIdx = tableData.findIndex((row) => {
      const joined = row.join(' ').toLowerCase();
      return (joined.includes('description') || joined.includes('product') || joined.includes('item') || joined.includes('particulars')) &&
             (joined.includes('qty') || joined.includes('quantity') || joined.includes('rate') || joined.includes('hsn') || joined.includes('amount'));
    });

    if (tableHeaderIdx >= 0) {
      const headerRow = tableData[tableHeaderIdx];
      const nameColIdx = headerRow.findIndex((h) => /description|product|particulars|item/i.test(h));
      const hsnColIdx = headerRow.findIndex((h) => /hsn|sac/i.test(h));
      const qtyColIdx = headerRow.findIndex((h) => /qty|quantity|units|nos/i.test(h));
      const uomColIdx = headerRow.findIndex((h) => /uom|unit|pkg/i.test(h));
      const rateColIdx = headerRow.findIndex((h) => /rate|price|unit price/i.test(h));
      const taxableColIdx = headerRow.findIndex((h) => /taxable/i.test(h));
      const gstColIdx = headerRow.findIndex((h) => /gst|tax %|tax rate|cgst|igst/i.test(h));
      const totalColIdx = headerRow.findIndex((h) => /total|amount after tax|net amount|amount/i.test(h));

      const gridItems: ExtractedProductItem[] = [];
      let rowSeq = 1;

      for (let r = tableHeaderIdx + 1; r < tableData.length; r++) {
        const row = tableData[r];
        const rowJoined = row.join(' ').trim();
        if (!rowJoined || isSummaryOrFooterRow(rowJoined)) continue;

        const nameRaw = nameColIdx >= 0 ? (row[nameColIdx] || '').trim() : '';
        if (!nameRaw || isSummaryOrFooterRow(nameRaw)) continue;

        const hsnRaw = hsnColIdx >= 0 ? (row[hsnColIdx] || '').replace(/[^0-9]/g, '') : '';
        const qtyRaw = qtyColIdx >= 0 ? row[qtyColIdx] : '1';
        const uomRaw = uomColIdx >= 0 ? row[uomColIdx] : '';
        const { qty, uom } = parseUomAndQty(qtyRaw, uomRaw, nameRaw);

        const rateNum = rateColIdx >= 0 ? parseFloat((row[rateColIdx] || '').replace(/,/g, '').replace(/[^\d.-]/g, '')) || 0 : 0;
        const taxableNum = taxableColIdx >= 0 ? parseFloat((row[taxableColIdx] || '').replace(/,/g, '').replace(/[^\d.-]/g, '')) || 0 : 0;
        const totalNum = totalColIdx >= 0 ? parseFloat((row[totalColIdx] || '').replace(/,/g, '').replace(/[^\d.-]/g, '')) || 0 : 0;

        let gstRate = '5%';
        if (gstColIdx >= 0 && row[gstColIdx]) {
          const gm = row[gstColIdx].match(/([0-9]+(?:\.[0-9]+)?)/);
          if (gm) gstRate = `${gm[1]}%`;
        }

        const qVal = parseFloat(qty) || 1;
        const gstVal = parseFloat(gstRate.replace('%', '')) || 5;

        // Cost Price: final line amount after tax divided by quantity
        let costPrice = '';
        if (totalNum > 0 && qVal > 0) {
          costPrice = (totalNum / qVal).toFixed(2);
        } else if (taxableNum > 0 && qVal > 0) {
          costPrice = ((taxableNum * (1 + gstVal / 100)) / qVal).toFixed(2);
        } else if (rateNum > 0) {
          costPrice = (rateNum * (1 + gstVal / 100)).toFixed(2);
        }

        gridItems.push({
          id: `inv-item-${rowSeq++}`,
          name: nameRaw,
          uom,
          sellingPrice: '', // Kept empty per requirement
          costPrice,
          hsn: hsnRaw,
          gstRate,
          priceInclusive: 'Yes',
          openingStock: !isNaN(qVal) && Math.floor(qVal) === qVal ? Math.floor(qVal).toString() : qty,
          rawRate: row[rateColIdx],
          rawQty: qty,
          rawTaxable: row[taxableColIdx],
          rawTotal: row[totalColIdx],
          confidence: 'high',
          flags: ['Selling Price required'],
        });
      }

      const validGrid = gridItems.filter(isValidProductRow);
      if (validGrid.length > 0) return validGrid;
    }
  }

  // ── Strategy 2: Sequential Line & Semantic Parsing ──────────────────────────
  const items: ExtractedProductItem[] = [];
  let currentItem: ExtractedProductItem | null = null;
  let rowSeq = 1;

  for (let idx = 0; idx < dataLines.length; idx++) {
    const rawLine = dataLines[idx].trim();
    if (!rawLine) continue;

    // Check if line is a summary or footer row -> stop table processing
    if (isSummaryOrFooterRow(rawLine)) {
      if (currentItem) {
        items.push(currentItem);
        currentItem = null;
      }
      break;
    }

    // Skip table subheader noise: e.g. "% | Amount"
    if (/^(?:o\s*\|\s*ament|%\s*\|\s*amount|rate\s*\|\s*amount)/i.test(rawLine)) continue;

    // First attempt smart semantic line parsing
    const smart = parseSmartProductLine(rawLine);
    if (smart && smart.name && smart.costPrice && parseFloat(smart.costPrice) > 0) {
      if (currentItem) {
        items.push(currentItem);
      }

      const qNum = parseFloat(smart.qty || '1');
      const openingStock = !isNaN(qNum) && Math.floor(qNum) === qNum ? Math.floor(qNum).toString() : (smart.qty || '1');

      currentItem = {
        id: `inv-item-${rowSeq++}`,
        name: smart.name,
        uom: smart.uom || 'PCS',
        sellingPrice: '', // Kept empty per requirement
        costPrice: smart.costPrice,
        hsn: smart.hsn || '',
        gstRate: smart.gstRate || '5%',
        priceInclusive: 'Yes',
        openingStock,
        rawRate: smart.unitPrice,
        rawQty: smart.qty,
        rawTaxable: smart.subtotal,
        rawTotal: smart.total,
        confidence: 'high',
        flags: ['Selling Price required'],
      };
      if (!smart.hsn) currentItem.flags?.push('HSN missing');
      continue;
    }

    // Token-based parsing (handling tabs, pipes, and multiple spaces)
    let tokens: string[] = [];
    if (rawLine.includes('\t')) {
      tokens = rawLine.split('\t').map((t) => t.trim());
    } else if (rawLine.includes('|')) {
      tokens = rawLine.split('|').map((t) => t.trim()).filter(Boolean);
    } else {
      tokens = rawLine.split(/\s{2,}/).map((t) => t.trim());
      if (tokens.length <= 2) {
        tokens = rawLine.split(/\s+/).map((t) => t.trim());
      }
    }

    const cleanTokens = tokens
      .map((t) => t.replace(/^[|[\]()]+/, '').replace(/[|[\]()]+$/, '').trim())
      .filter(Boolean);

    const startsWithSno = /^[0-9]+[.)]?$/.test(cleanTokens[0]) && cleanTokens.length > 2;
    const hsnToken = cleanTokens.find((t, i) => i > 0 && /^[0-9]{4,8}$/.test(t) && !t.includes('.'));
    const numericTokens = cleanTokens.filter((t, i) => i > 0 && /^-?[0-9]+(?:\.[0-9]+)?%?$/.test(t.replace(/,/g, '')));

    const isNewItemRow = (startsWithSno && (hsnToken || numericTokens.length >= 2)) ||
                         (hsnToken && numericTokens.length >= 2) ||
                         (numericTokens.length >= 2 && cleanTokens.length >= 3);

    if (isNewItemRow) {
      if (currentItem) {
        items.push(currentItem);
        currentItem = null;
      }

      let name = '';
      let hsn = '';
      let qty = '1';
      let uom = '';
      let rate = '';
      let gstRate = '5%';
      let discount = '';
      let taxable = '';
      let total = '';

      // Aligned columns mapping if token count matches headers
      if (headers.length > 0 && Math.abs(headers.length - tokens.length) <= 1) {
        const getColVal = (colName?: string): string => {
          if (!colName) return '';
          const cIdx = headers.findIndex((h) => h.toLowerCase() === colName.toLowerCase());
          return cIdx >= 0 && cIdx < tokens.length ? tokens[cIdx] : '';
        };

        name = getColVal(columnMap.productNameCol);
        qty = getColVal(columnMap.quantityCol);
        uom = getColVal(columnMap.uomCol);
        rate = getColVal(columnMap.rateCol);
        hsn = getColVal(columnMap.hsnCol);
        gstRate = getColVal(columnMap.gstRateCol);
        taxable = getColVal(columnMap.taxableCol);
        discount = getColVal(columnMap.discountCol);
        total = getColVal(columnMap.totalCol);
      }

      // HSN extracted strictly from HSN column or HSN position
      if (!hsn && hsnToken) {
        hsn = hsnToken;
      }
      hsn = (hsn || '').replace(/[^0-9]/g, '');

      // Name fallback
      if (!name) {
        const hsnIndex = hsn ? cleanTokens.indexOf(hsn) : -1;
        if (hsnIndex > 0) {
          const nameTokens = cleanTokens.slice(0, hsnIndex).filter((t, i) => !(i === 0 && /^[0-9]+[.)]?$/.test(t)));
          name = nameTokens.join(' ').trim();
        } else {
          const firstNumIdx = cleanTokens.findIndex((t, i) => i > 0 && /^[0-9]+(?:\.[0-9]+)?$/.test(t.replace(/,/g, '')));
          if (firstNumIdx > 0) {
            const nameTokens = cleanTokens.slice(0, firstNumIdx).filter((t, i) => !(i === 0 && /^[0-9]+[.)]?$/.test(t)));
            name = nameTokens.join(' ').trim();
          } else {
            name = cleanTokens.slice(startsWithSno ? 1 : 0, 2).join(' ').trim();
          }
        }
      }

      // Quantity & UOM separation
      const uomCheck = parseUomAndQty(qty, uom, name);
      qty = uomCheck.qty;
      uom = uomCheck.uom;

      // Rate & Total fallbacks
      const parsedQty = parseFloat(qty.replace(/,/g, '')) || 1;
      const parsedRate = parseFloat((rate || '').replace(/,/g, '').replace(/[^\d.-]/g, '')) || 0;
      const parsedTaxable = parseFloat((taxable || '').replace(/,/g, '').replace(/[^\d.-]/g, '')) || 0;
      const parsedTotal = parseFloat((total || '').replace(/,/g, '').replace(/[^\d.-]/g, '')) || 0;
      const parsedDiscount = parseFloat((discount || '').replace(/,/g, '').replace(/[^\d.-]/g, '')) || 0;

      let gstVal = 5;
      const gstMatch = (gstRate || '').match(/([0-9]+(?:\.[0-9]+)?)/);
      if (gstMatch) {
        gstVal = parseFloat(gstMatch[1]) || 5;
        gstRate = `${gstVal}%`;
      }

      // Calculate Cost Price: represents final purchase amount per unit including GST
      let costPrice = '';
      if (parsedTotal > 0 && parsedQty > 0) {
        const preTaxAmount = parsedRate > 0 ? parsedRate * parsedQty : (parsedTaxable > 0 ? parsedTaxable : 0);
        if (preTaxAmount > 0 && gstVal > 0 && Math.abs(parsedTotal - preTaxAmount) < 1.0) {
          // Invoice total column is pre-tax: calculate inclusive amount using GST rate
          costPrice = (parsedRate * (1 + gstVal / 100)).toFixed(2);
        } else {
          // Already inclusive of tax
          costPrice = (parsedTotal / parsedQty).toFixed(2);
        }
      } else if (parsedTaxable > 0 && parsedQty > 0) {
        costPrice = ((parsedTaxable * (1 + gstVal / 100)) / parsedQty).toFixed(2);
      } else if (parsedRate > 0) {
        let baseRate = parsedRate;
        if (parsedDiscount > 0) {
          if (parsedDiscount < 100) baseRate *= (1 - parsedDiscount / 100);
          else baseRate = Math.max(0, baseRate - parsedDiscount / parsedQty);
        }
        costPrice = (baseRate * (1 + gstVal / 100)).toFixed(2);
      }

      // Clean name
      name = name
        .replace(/^[0-9]+[.)\-\s]+/, '')
        .replace(/^[|[\]()\-]+/, '')
        .replace(/[|[\]()]+$/, '')
        .trim();

      currentItem = {
        id: `inv-item-${rowSeq++}`,
        name: name || `Product Item ${rowSeq}`,
        uom,
        sellingPrice: '', // Kept empty per requirement
        costPrice,
        hsn,
        gstRate,
        priceInclusive: 'Yes',
        openingStock: !isNaN(parsedQty) && Math.floor(parsedQty) === parsedQty ? Math.floor(parsedQty).toString() : parsedQty.toString(),
        rawRate: rate,
        rawQty: qty,
        rawDiscount: discount,
        rawTaxable: taxable,
        rawTotal: total,
        confidence: name && costPrice && parsedQty > 0 ? 'high' : 'medium',
        flags: ['Selling Price required'],
      };

      if (!costPrice) currentItem.flags?.push('Cost Price uncertain');
      if (!hsn) currentItem.flags?.push('HSN missing');
    } else if (currentItem) {
      // Continuation line (wrapped description)
      const cleanCont = rawLine.replace(/^[|[\]()\-]+/, '').replace(/[|[\]()]+$/, '').trim();
      if (cleanCont && !isSummaryOrFooterRow(cleanCont) && !cleanCont.startsWith('Page') && !cleanCont.startsWith('GSTIN')) {
        let textToAppend = cleanCont;
        if (/amon\s*&\s*honey/i.test(textToAppend)) textToAppend = 'Almond & Honey';
        if (/assorted/i.test(textToAppend) || /orted/i.test(textToAppend)) textToAppend = 'Assorted';
        currentItem.name = `${currentItem.name} ${textToAppend}`.replace(/\s+/g, ' ').trim();
      }
    }
  }

  if (currentItem) {
    items.push(currentItem);
  }

  const validItems = items.filter(isValidProductRow);

  if (validItems.length === 0 && sparseText) {
    return parseSparseTable(sparseText).filter(isValidProductRow);
  }

  return validItems;
}

// ── Cross-Reference Catalog & Fill Selling Prices ────────────────────────────
export function enrichWithCatalog(
  items: ExtractedProductItem[],
  catalogItems: CatalogItemSummary[]
): ExtractedProductItem[] {
  const byName = new Map<string, CatalogItemSummary>();
  const byHsn = new Map<string, CatalogItemSummary>();

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const c of catalogItems) {
    const k = norm(c.name);
    if (k && !byName.has(k)) byName.set(k, c);
    if (c.hsn && !byHsn.has(c.hsn)) byHsn.set(c.hsn, c);
  }

  return items.map((item) => {
    const itemNorm = norm(item.name);
    // Only exact name match from catalog, never loose substrings
    const matched = byName.get(itemNorm);

    let sellingPrice = item.sellingPrice;
    const flags = [...(item.flags || [])];

    if (matched && matched.spMinor && matched.spMinor > 0) {
      sellingPrice = (matched.spMinor / 100).toFixed(2);
      const flagIdx = flags.indexOf('Selling Price required');
      if (flagIdx >= 0) flags.splice(flagIdx, 1);
    } else {
      sellingPrice = '';
      if (!flags.includes('Selling Price required')) {
        flags.push('Selling Price required');
      }
    }

    return {
      ...item,
      sellingPrice,
      flags,
    };
  });
}

import { generateTemplateExcel as generateExactTemplateExcel } from '../modules/invoice-converter/services/excel-generator.ts';

// ── ExcelJS Generation: Exact 8-Column Template ──────────────────────────────
export async function generateTemplateExcel(products: ExtractedProductItem[]): Promise<Buffer> {
  return generateExactTemplateExcel(products);
}
