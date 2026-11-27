import { env } from '../../../env.ts';
import {
  validateAiExtractionPayload,
  type AiRawInvoicePayload,
  type AiRawLineItem,
} from '../schemas/invoice.schema.ts';

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
1. Preserve the exact original product row order.
2. Handle handwritten ditto marks (", ,, do) by inheriting the productName/brand/design from the previous row and setting "isDitto": true.
3. Combine size/variant/design into productName or variant/sizeWeightVolume cleanly when helpful (e.g. "ANAND TRUNK 80").
4. If quantity has BOX and PCS (e.g. 2 BOX x 20 PCS), extract boxCartonQty=2, piecesPerBox=20, and total quantity=20 (or the billed quantity matching rate * qty = lineItemAmount).
5. NEVER invent or guess missing values. Use null for unreadable or absent fields.
6. "confidence" must be 0..1 or null if uncertain.`;

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
    const model = env.ai.geminiModel || 'gemini-3.8-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.ai.geminiApiKey)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(35000),
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 220)}`);
    }

    const data: any = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text || typeof text !== 'string') {
      throw new Error('Gemini API returned empty content');
    }
    return text;
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
    if (input.mimeType.startsWith('image/') || input.mimeType === 'application/pdf') {
      parts.push({
        inlineData: {
          mimeType: input.mimeType,
          data: input.originalBuffer.toString('base64'),
        },
      });
    }
    if (input.ocrText.trim()) {
      parts.push({ text: `OCR Reference Text:\n${input.ocrText.slice(0, 15000)}` });
    }

    const warnings: string[] = [];
    let rawText = await this.callGemini(parts);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        const validated = validateAiExtractionPayload(parsed);
        if (validated.ok) {
          validated.data.items = resolveDittoMarks(validated.data.items);
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
