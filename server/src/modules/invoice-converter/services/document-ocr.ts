import { PDFParse } from 'pdf-parse';
import { env } from '../../../env.ts';
import type { BoundingBox, FieldConfidence } from '../schemas/invoice.schema.ts';
import { MAX_INVOICE_PAGES } from './image-preprocessor.ts';

export interface OcrLineToken {
  text: string;
  page: number;
  confidence: FieldConfidence;
  bbox: BoundingBox | null;
}

export interface OcrExtractionOutput {
  provider: 'local-tesseract' | 'pdf-parse' | 'google-document-ai';
  text: string;
  sparseText: string;
  pages: number;
  isOcr: boolean;
  tableData?: string[][];
  lines: OcrLineToken[];
  averageConfidence: number | null;
}

export interface OcrProvider {
  readonly name: string;
  isConfigured(): boolean;
  extract(buffer: Buffer, fileName: string, mimeType: string): Promise<OcrExtractionOutput>;
}

async function getTesseract() {
  const mod = await import('tesseract.js');
  return { createWorker: mod.createWorker, PSM: mod.PSM };
}

/**
 * Local OCR & PDF provider using pdf-parse + tesseract.js.
 * Reports genuine Tesseract confidence (0..1) when available, or null when not scored.
 */
export class LocalTesseractOcrProvider implements OcrProvider {
  readonly name = 'local-tesseract';

  isConfigured(): boolean {
    return true;
  }

  async extract(buffer: Buffer, fileName: string, mimeType: string): Promise<OcrExtractionOutput> {
    if (mimeType.startsWith('text/') || fileName.toLowerCase().endsWith('.txt')) {
      const text = buffer.toString('utf8');
      return {
        provider: 'pdf-parse',
        text,
        sparseText: '',
        pages: 1,
        isOcr: false,
        lines: text.split(/\r?\n/).filter(Boolean).map((l) => ({
          text: l,
          page: 1,
          confidence: { score: null, status: 'unknown' },
          bbox: null,
        })),
        averageConfidence: null,
      };
    }

    if (mimeType.includes('pdf') || fileName.toLowerCase().endsWith('.pdf')) {
      let pdfParser: PDFParse | null = null;
      try {
        pdfParser = new PDFParse({ data: buffer });
        const textResult = await pdfParser.getText();
        const extractedText = (textResult.text || '').trim();
        const totalPages = Math.min(textResult.total || 1, MAX_INVOICE_PAGES);

        if ((textResult.total || 1) > MAX_INVOICE_PAGES) {
          throw new Error(`PDF has ${textResult.total} pages, exceeding the ${MAX_INVOICE_PAGES}-page limit.`);
        }

        let tableData: string[][] | undefined;
        try {
          const tableResult = await pdfParser.getTable();
          if (tableResult?.mergedTables?.length) {
            tableData = tableResult.mergedTables[0];
          }
        } catch {
          // Fall back to line parsing
        }

        if (extractedText.length >= 60 && /[a-zA-Z]{3,}/.test(extractedText)) {
          await pdfParser.destroy();
          return {
            provider: 'pdf-parse',
            text: extractedText,
            sparseText: '',
            pages: totalPages,
            isOcr: false,
            tableData,
            lines: extractedText.split(/\r?\n/).filter(Boolean).map((l) => ({
              text: l,
              page: 1,
              confidence: { score: null, status: 'unknown' },
              bbox: null,
            })),
            averageConfidence: null,
          };
        }

        // Scanned PDF fallback via embedded image OCR
        let scannedImageOcr = '';
        const ocrLines: OcrLineToken[] = [];
        const confScores: number[] = [];
        try {
          const imageResult = await pdfParser.getImage({ imageBuffer: true });
          if (imageResult?.pages?.length) {
            const { createWorker, PSM } = await getTesseract();
            const worker = await createWorker('eng');
            await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: '300' });
            for (let pIdx = 0; pIdx < Math.min(imageResult.pages.length, MAX_INVOICE_PAGES); pIdx++) {
              const page = imageResult.pages[pIdx];
              for (const img of page.images) {
                if (img.data && img.data.byteLength > 1000) {
                  const ret = await worker.recognize(Buffer.from(img.data));
                  scannedImageOcr += '\n' + (ret.data.text || '');
                  if (typeof ret.data.confidence === 'number' && ret.data.confidence > 0) {
                    confScores.push(ret.data.confidence / 100);
                  }
                  const rawLines = (ret.data as any).lines as Array<{ text: string; confidence?: number; bbox?: any }> | undefined;
                  if (Array.isArray(rawLines)) {
                    for (const ln of rawLines) {
                      if (!ln.text?.trim()) continue;
                      const score = typeof ln.confidence === 'number' ? Math.max(0, Math.min(1, ln.confidence / 100)) : null;
                      ocrLines.push({
                        text: ln.text.trim(),
                        page: pIdx + 1,
                        confidence: score !== null ? { score, status: 'scored' } : { score: null, status: 'unknown' },
                        bbox: ln.bbox
                          ? {
                              page: pIdx + 1,
                              x: ln.bbox.x0 ?? 0,
                              y: ln.bbox.y0 ?? 0,
                              width: (ln.bbox.x1 ?? 0) - (ln.bbox.x0 ?? 0),
                              height: (ln.bbox.y1 ?? 0) - (ln.bbox.y0 ?? 0),
                              unit: 'px',
                            }
                          : null,
                      });
                    }
                  }
                }
              }
            }
            await worker.terminate();
          }
        } catch {
          // Ignore embedded OCR fallback error
        }
        await pdfParser.destroy();

        const avgConf = confScores.length ? confScores.reduce((a, b) => a + b, 0) / confScores.length : null;
        if (scannedImageOcr.trim().length > 20) {
          return {
            provider: 'local-tesseract',
            text: scannedImageOcr.trim(),
            sparseText: '',
            pages: totalPages,
            isOcr: true,
            lines: ocrLines,
            averageConfidence: avgConf,
          };
        }

        return {
          provider: 'pdf-parse',
          text: extractedText,
          sparseText: '',
          pages: totalPages,
          isOcr: false,
          tableData,
          lines: [],
          averageConfidence: null,
        };
      } catch (err: any) {
        if (pdfParser) {
          try { await pdfParser.destroy(); } catch {}
        }
        throw new Error(`Failed to parse PDF document: ${err.message || String(err)}`);
      }
    }

    // Image OCR via Tesseract
    const { createWorker, PSM } = await getTesseract();
    const worker = await createWorker('eng');
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: '300' });
    const ret = await worker.recognize(buffer);

    const mainText = (ret.data.text || '').trim();
    let sparseText = '';
    if (mainText.length < 40) {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        const sparseRet = await worker.recognize(buffer);
        sparseText = (sparseRet.data.text || '').trim();
      } catch {
        // Sparse pass optional
      }
    }

    await worker.terminate();

    const ocrLines: OcrLineToken[] = [];
    const rawLines = (ret.data as any).lines as Array<{ text: string; confidence?: number; bbox?: any }> | undefined;
    if (Array.isArray(rawLines)) {
      for (const ln of rawLines) {
        if (!ln.text?.trim()) continue;
        const score = typeof ln.confidence === 'number' ? Math.max(0, Math.min(1, ln.confidence / 100)) : null;
        ocrLines.push({
          text: ln.text.trim(),
          page: 1,
          confidence: score !== null ? { score, status: 'scored' } : { score: null, status: 'unknown' },
          bbox: ln.bbox
            ? {
                page: 1,
                x: ln.bbox.x0 ?? 0,
                y: ln.bbox.y0 ?? 0,
                width: (ln.bbox.x1 ?? 0) - (ln.bbox.x0 ?? 0),
                height: (ln.bbox.y1 ?? 0) - (ln.bbox.y0 ?? 0),
                unit: 'px',
              }
            : null,
        });
      }
    }

    const avgConf = typeof ret.data.confidence === 'number' && ret.data.confidence > 0
      ? Math.max(0, Math.min(1, ret.data.confidence / 100))
      : null;

    return {
      provider: 'local-tesseract',
      text: (ret.data.text || '').trim(),
      sparseText,
      pages: 1,
      isOcr: true,
      lines: ocrLines,
      averageConfidence: avgConf,
    };
  }
}

/**
 * Modular Cloud OCR Provider: Google Cloud Document AI.
 * Requires GOOGLE_DOCUMENT_AI_PROJECT_ID, GOOGLE_DOCUMENT_AI_PROCESSOR_ID,
 * and GOOGLE_DOCUMENT_AI_ACCESS_TOKEN in environment.
 */
export class GoogleDocumentAiOcrProvider implements OcrProvider {
  readonly name = 'google-document-ai';

  isConfigured(): boolean {
    return Boolean(
      env.documentAi.projectId &&
      env.documentAi.processorId &&
      env.documentAi.accessToken
    );
  }

  async extract(buffer: Buffer, _fileName: string, mimeType: string): Promise<OcrExtractionOutput> {
    if (!this.isConfigured()) {
      throw new Error('Google Document AI credentials are not configured');
    }

    const endpoint = `https://${env.documentAi.location}-documentai.googleapis.com/v1/projects/${encodeURIComponent(env.documentAi.projectId)}/locations/${encodeURIComponent(env.documentAi.location)}/processors/${encodeURIComponent(env.documentAi.processorId)}:process`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.documentAi.accessToken}`,
      },
      body: JSON.stringify({
        rawDocument: {
          content: buffer.toString('base64'),
          mimeType,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Google Document AI error (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data: any = await res.json();
    const doc = data?.document || {};
    const text = String(doc.text || '');
    const pages = Array.isArray(doc.pages) ? doc.pages.length : 1;
    const lines: OcrLineToken[] = [];

    if (Array.isArray(doc.pages)) {
      for (let pIdx = 0; pIdx < doc.pages.length; pIdx++) {
        const page = doc.pages[pIdx];
        for (const ln of page.lines || []) {
          const segments = ln.layout?.textAnchor?.textSegments || [];
          const lineText = segments
            .map((s: any) => text.slice(Number(s.startIndex || 0), Number(s.endIndex || 0)))
            .join('')
            .trim();
          if (!lineText) continue;
          const conf = typeof ln.layout?.confidence === 'number' ? ln.layout.confidence : null;
          const verts = ln.layout?.boundingPoly?.normalizedVertices;
          let bbox: BoundingBox | null = null;
          if (Array.isArray(verts) && verts.length >= 3) {
            const xs = verts.map((v: any) => Number(v.x || 0));
            const ys = verts.map((v: any) => Number(v.y || 0));
            const minX = Math.min(...xs);
            const minY = Math.min(...ys);
            bbox = {
              page: pIdx + 1,
              x: minX,
              y: minY,
              width: Math.max(...xs) - minX,
              height: Math.max(...ys) - minY,
              unit: 'normalized',
            };
          }
          lines.push({
            text: lineText,
            page: pIdx + 1,
            confidence: conf !== null ? { score: conf, status: 'scored' } : { score: null, status: 'unknown' },
            bbox,
          });
        }
      }
    }

    const scored = lines.filter((l) => l.confidence.score !== null).map((l) => l.confidence.score as number);
    const avgConf = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;

    return {
      provider: 'google-document-ai',
      text,
      sparseText: '',
      pages,
      isOcr: true,
      lines,
      averageConfidence: avgConf,
    };
  }
}
