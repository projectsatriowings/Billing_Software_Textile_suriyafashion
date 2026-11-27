import { env } from '../../../env.ts';
import {
  validateAiExtractionPayload,
  type AiRawInvoicePayload,
  type AiRawLineItem,
} from '../schemas/invoice.schema.ts';
import {
  cleanInvoiceProductName,
  isDittoProductName,
  isSummaryOrFooterRow,
} from '../../../services/supplierInvoiceParser.ts';

export interface AiExtractionResult {
  provider: 'gemini-vision' | 'none';
  configured: boolean;
  payload: AiRawInvoicePayload | null;
  warnings: string[];
}

export interface AiInvoiceExtractor {
  readonly name: string;
  isConfigured(): boolean;
  extract(input: {
    originalBuffer: Buffer;
    mimeType: string;
    ocrText: string;
  }): Promise<AiExtractionResult>;
}

const EXTRACTION_SYSTEM_PROMPT = `You are an expert Indian GST & Textile/Supermarket Supplier Invoice Extraction Engine.
Analyze the attached invoice document (printed, handwritten, thermal, scanned, or mobile photo) and the OCR text.
Return STRICT JSON matching this exact structure (no markdown fences, no commentary):
{
  "header": {
    "supplierName": string | null,
    "supplierGstin": string | null,
    "supplierAddress": string | null,
    "invoiceNumber": string | null,
    "invoiceDate": string | null,
    "purchaseOrderNumber": string | null,
    "deliveryOrLrNumber": string | null,
    "billingAddress": string | null,
    "shippingAddress": string | null,
    "subtotal": number | null,
    "discount": number | null,
    "sgst": number | null,
    "cgst": number | null,
    "igst": number | null,
    "otherCharges": number | null,
    "roundOff": number | null,
    "finalInvoiceAmount": number | null
  },
  "items": [
    {
      "productName": string | null,
      "brand": string | null,
      "description": string | null,
      "variant": string | null,
      "sizeWeightVolume": string | null,
      "hsnCode": string | null,
      "quantity": number | null,
      "uom": string | null,
      "boxCartonQty": number | null,
      "piecesPerBox": number | null,
      "unitPurchaseRate": number | null,
      "lineItemAmount": number | null,
      "discount": number | null,
      "gstPercentage": number | null,
      "gstAmount": number | null,
      "priceInclusiveOfGst": boolean | null,
      "isDitto": boolean,
      "originalText": string | null,
      "sourcePage": number | null,
      "confidence": number | null
    }
  ]
}
CRITICAL RULES:
1. Preserve the exact original product row order. One JSON item per product row of the item table only.
2. "productName" = ONLY the text of the PARTICULARS / DESCRIPTION / ITEM column. Never append text from the HSN / CODE column, notes such as "Unclear in source", "Ditto / unclear", "Possibly", quote marks or footnote asterisks (*), and never append the size.
3. "sizeWeightVolume" = the SIZE column value exactly as written. Sizes can be numbers ("80", "90", "95", "30", "8") or letters/words ("S", "M", "L", "XL", "Free Size"). A number in the SIZE column is a size, NEVER a quantity.
4. Typical garment layout: SL | PARTICULARS | HSN/CODE | SIZE | BOX | PCS | RATE | AMOUNT.
   - "boxCartonQty" = BOX column, "quantity" = PCS / QTY column (total pieces billed), "unitPurchaseRate" = RATE column exactly as printed, "lineItemAmount" = AMOUNT column.
   - Always check quantity * unitPurchaseRate = lineItemAmount (e.g. 20 * 135 = 2700). If it does not hold, you mapped the columns wrongly: fix them. Never compute the rate as amount / size.
   Example row "1 | ANAND | Unclear in source | 80 | 2 | 20 | 135 | 2,700" →
   {"productName":"ANAND","hsnCode":null,"sizeWeightVolume":"80","boxCartonQty":2,"quantity":20,"unitPurchaseRate":135,"lineItemAmount":2700}
5. Handle handwritten ditto marks (", ,, do, ditto, (ditto)) by inheriting the productName/brand from the previous row and setting "isDitto": true.
6. "hsnCode" must be digits only (4-8 digits) or null; text like "Unclear" or "Raw colour" is NOT an HSN code.
7. Skip footnotes and notes (lines starting with "*", "NOTES", remarks), subtotal / tax / total rows, bank and signature lines.
8. NEVER invent or guess missing values. Use null for unreadable or absent fields.
9. "confidence" must be 0..1 or null if uncertain.`;

const approxEqual = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);

/**
 * Cleans AI line items before ditto resolution:
 * drops footnote / summary rows, strips non-name text from productName, and repairs
 * column mix-ups using PCS × RATE = AMOUNT (so a numeric size is never used as the quantity
 * and the cost is never amount ÷ size).
 */
export function normalizeAiLineItems(items: AiRawLineItem[]): AiRawLineItem[] {
  const out: AiRawLineItem[] = [];
  for (const item of items) {
    const rawName = (item.productName || '').trim();
    if (/^\*/.test(rawName) || (rawName && isSummaryOrFooterRow(rawName))) continue;

    const amount = item.lineItemAmount ?? null;
    let rate = item.unitPurchaseRate ?? null;
    let qty = item.quantity ?? null;
    const box = item.boxCartonQty ?? null;
    const perBox = item.piecesPerBox ?? null;
    const sizeStr = (item.sizeWeightVolume || '').trim();
    const sizeNum = /^\d+(?:\.\d+)?$/.test(sizeStr) ? Number(sizeStr) : null;

    // Footnote-like rows with no numbers at all are not products
    if (!rawName && rate === null && amount === null && qty === null) continue;

    if (amount !== null && amount > 0) {
      const qtyCandidates = [qty, perBox, box !== null && perBox !== null ? box * perBox : null]
        .filter((v): v is number => v !== null && v > 0 && v !== sizeNum);
      if (rate !== null && rate > 0 && !(qty !== null && approxEqual(qty * rate, amount))) {
        // Rate is known: choose the quantity that satisfies qty × rate = amount
        const fit = qtyCandidates.find((q) => approxEqual(q * rate!, amount));
        if (fit !== undefined) qty = fit;
        else if (Number.isInteger(Math.round(amount / rate)) && approxEqual(Math.round(amount / rate) * rate, amount)) {
          qty = Math.round(amount / rate);
        }
      }
      // Quantity was the size (e.g. qty 80 / rate 33.75 = 2700/80): take the real PCS and the printed rate
      if (sizeNum !== null && qty === sizeNum && qtyCandidates.length > 0) {
        qty = qtyCandidates[0];
        rate = Number((amount / qty).toFixed(2));
      }
      if ((rate === null || rate <= 0) && qty !== null && qty > 0) {
        rate = Number((amount / qty).toFixed(2));
      }
    }

    const hsnDigits = (item.hsnCode || '').replace(/\s+/g, '');
    out.push({
      ...item,
      productName: cleanInvoiceProductName(rawName) || null,
      isDitto: Boolean(item.isDitto) || isDittoProductName(rawName),
      hsnCode: /^\d{4,8}$/.test(hsnDigits) ? hsnDigits : null,
      sizeWeightVolume: sizeStr || null,
      quantity: qty,
      unitPurchaseRate: rate,
    });
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolves handwritten ditto marks in extracted AI items using previous row context.
 */
export function resolveDittoMarks(items: AiRawLineItem[]): AiRawLineItem[] {
  let lastProductName: string | null = null;
  let lastBrand: string | null = null;
  let lastHsn: string | null = null;

  return items.map((item) => {
    const rawName = (item.productName || '').trim();
    const isDittoSymbol = /^["”'`,.\-\s]+$|^do\.?$/i.test(rawName);
    const shouldInherit = (item.isDitto || isDittoSymbol || !rawName) && Boolean(lastProductName);

    const resolvedName = shouldInherit ? lastProductName : (rawName || null);
    const resolvedBrand = item.brand || (shouldInherit ? lastBrand : null);
    const resolvedHsn = item.hsnCode || (shouldInherit ? lastHsn : null);

    if (resolvedName && !isDittoSymbol) lastProductName = resolvedName;
    if (resolvedBrand) lastBrand = resolvedBrand;
    if (resolvedHsn) lastHsn = resolvedHsn;

    return {
      ...item,
      productName: resolvedName,
      brand: resolvedBrand,
      hsnCode: resolvedHsn,
      isDitto: Boolean(shouldInherit),
    };
  });
}

export class GeminiVisionExtractor implements AiInvoiceExtractor {
  readonly name = 'gemini-vision';

  isConfigured(): boolean {
    return Boolean(env.ai.geminiApiKey && env.ai.geminiApiKey.trim().length > 0);
  }

  private async callGemini(parts: any[]): Promise<string> {
    const primary = env.ai.geminiModel || 'gemini-3.8-flash';
    const candidates = Array.from(new Set([primary, 'gemini-3.7-flash', 'gemini-flash-latest']));
    let lastError = 'Gemini API call failed';

    // Each model gets one retry after a short back-off on overload (503/429); a timeout moves on,
    // then the next fallback model is tried. Only after all fail does the caller fall back to local OCR.
    for (const model of candidates) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.ai.geminiApiKey)}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        let res: Response;
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(45000),
            body: JSON.stringify({
              contents: [{ role: 'user', parts }],
              generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json',
              },
            }),
          });
        } catch (err: any) {
          // Timeout / network error: move on to the next model instead of failing the whole extraction
          lastError = `Gemini (${model}) request failed: ${err?.message || 'network error'}`;
          break;
        }

        if (res.ok) {
          const data: any = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text && typeof text === 'string') {
            return text;
          }
          lastError = `Gemini (${model}) returned empty content`;
          break;
        }

        const errText = await res.text().catch(() => '');
        lastError = `Gemini API error (${res.status} on ${model}): ${errText.slice(0, 220)}`;
        if ((res.status === 503 || res.status === 429) && attempt === 0) {
          await sleep(2000);
          continue; // retry same model once
        }
        if (res.status === 503 || res.status === 429 || res.status === 404) {
          break; // try next fallback model
        }
        throw new Error(lastError);
      }
    }

    throw new Error(lastError);
  }

  async extract(input: {
    originalBuffer: Buffer;
    mimeType: string;
    ocrText: string;
  }): Promise<AiExtractionResult> {
    if (!this.isConfigured()) {
      return {
        provider: 'none',
        configured: false,
        payload: null,
        warnings: ['GEMINI_API_KEY is not configured. Running with local OCR + rule-based parser only.'],
      };
    }

    const parts: any[] = [{ text: EXTRACTION_SYSTEM_PROMPT }];
    const hasRichDigitalPdfText = input.mimeType === 'application/pdf' && input.ocrText.trim().length >= 80;
    if (!hasRichDigitalPdfText && (input.mimeType.startsWith('image/') || input.mimeType === 'application/pdf')) {
      parts.push({
        inlineData: {
          mimeType: input.mimeType,
          data: input.originalBuffer.toString('base64'),
        },
      });
    }
    if (input.ocrText.trim()) {
      parts.push({ text: `Invoice Text:\n${input.ocrText.slice(0, 15000)}` });
    }

    const warnings: string[] = [];
    let rawText = await this.callGemini(parts);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        const validated = validateAiExtractionPayload(parsed);
        if (validated.ok) {
          validated.data.items = resolveDittoMarks(normalizeAiLineItems(validated.data.items));
          return {
            provider: 'gemini-vision',
            configured: true,
            payload: validated.data,
            warnings,
          };
        }
        if (attempt === 0) {
          warnings.push(`AI schema validation retry: ${validated.error}`);
          rawText = await this.callGemini([
            { text: `Fix the following JSON so it strictly satisfies the schema (${validated.error}). Return ONLY valid JSON.\n\n${cleaned}` },
          ]);
          continue;
        }
        warnings.push(`AI output rejected by schema validator: ${validated.error}`);
      } catch (err: any) {
        if (attempt === 0) {
          warnings.push(`AI JSON parse retry: ${err.message}`);
          rawText = await this.callGemini([
            { text: `Convert this into valid JSON matching { "header": {...}, "items": [...] } with no markdown fences:\n\n${rawText}` },
          ]);
          continue;
        }
        warnings.push(`AI JSON parsing failed: ${err.message}`);
      }
    }

    return {
      provider: 'gemini-vision',
      configured: true,
      payload: null,
      warnings,
    };
  }
}
