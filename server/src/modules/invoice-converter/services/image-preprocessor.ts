import jpeg from 'jpeg-js';
import UPNGModule from '@pdf-lib/upng';

// Under ESM this CommonJS package arrives double-wrapped ({ default: { encode, decode, ... } }).
// Without unwrapping, UPNG.encode / UPNG.decode are undefined and preprocessing silently fell back
// to the raw image for every photo.
const UPNG: typeof UPNGModule = ((UPNGModule as any)?.encode ? UPNGModule : (UPNGModule as any)?.default) as typeof UPNGModule;

export const ALLOWED_INVOICE_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.txt'] as const;
export const MAX_INVOICE_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_INVOICE_PAGES = 25;

export interface PreprocessResult {
  originalBuffer: Buffer;
  processedBuffer: Buffer;
  mimeType: string;
  fileType: 'pdf' | 'image' | 'text';
  appliedSteps: string[];
  width?: number;
  height?: number;
}

export function validateInvoiceFile(
  buffer: Buffer,
  fileName: string,
  mimeType?: string
): { fileType: 'pdf' | 'image' | 'text'; normalizedMime: string } {
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('Uploaded file is empty (0 bytes)');
  }
  if (buffer.byteLength > MAX_INVOICE_FILE_BYTES) {
    throw new Error(`File size (${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB) exceeds maximum allowed 20 MB`);
  }

  const lower = fileName.toLowerCase();
  const isPdf = mimeType?.includes('pdf') || lower.endsWith('.pdf');
  const isText = mimeType?.startsWith('text/') || lower.endsWith('.txt');
  const isPng = mimeType?.includes('png') || lower.endsWith('.png');
  const isJpg = mimeType?.includes('jpeg') || mimeType?.includes('jpg') || lower.endsWith('.jpg') || lower.endsWith('.jpeg');

  if (!isPdf && !isText && !isPng && !isJpg) {
    throw new Error('Unsupported file format. Please upload PDF, JPG, JPEG, or PNG.');
  }

  if (isPdf) return { fileType: 'pdf', normalizedMime: 'application/pdf' };
  if (isText) return { fileType: 'text', normalizedMime: 'text/plain' };
  if (isPng) return { fileType: 'image', normalizedMime: 'image/png' };
  return { fileType: 'image', normalizedMime: 'image/jpeg' };
}

/**
 * Fast O(W*H) integral-image adaptive thresholding (Bradley-Roth).
 * Handles uneven mobile camera shadows, pink/yellow paper, and faded ink.
 */
/** Otsu's global threshold: the grey level that best separates dark ink from the page background. */
function otsuThreshold(luma: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < luma.length; i++) hist[luma[i]]++;
  const total = luma.length;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * hist[v];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestT = 128;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = v;
    }
  }
  return bestT;
}

function applyAdaptiveThreshold(
  luma: Uint8Array,
  width: number,
  height: number,
  windowRadius = 15,
  t = 0.12,
  globalDarkLimit = 255
): Uint8Array {
  const integral = new Float64Array((width + 1) * (height + 1));
  const stride = width + 1;

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += luma[y * width + x];
      integral[(y + 1) * stride + (x + 1)] = integral[y * stride + (x + 1)] + rowSum;
    }
  }

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - windowRadius);
    const y2 = Math.min(height - 1, y + windowRadius);
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - windowRadius);
      const x2 = Math.min(width - 1, x + windowRadius);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum =
        integral[(y2 + 1) * stride + (x2 + 1)] -
        integral[y1 * stride + (x2 + 1)] -
        integral[(y2 + 1) * stride + x1] +
        integral[y1 * stride + x1];
      const localMean = sum / count;
      const px = luma[y * width + x];
      // Keep soft anti-aliased dark ink while whitening paper background
      // Ink must be darker than its neighbourhood AND dark overall, so tinted or dotted
      // backgrounds (light blue paper with white dots) do not turn into black speckle.
      out[y * width + x] = px < localMean * (1 - t) && px <= globalDarkLimit ? Math.min(px, 60) : 255;
    }
  }
  return out;
}

/**
 * Bilinear 2x upscaling for low-resolution mobile photos so Tesseract sees crisp strokes.
 */
function upscale2xLuma(luma: Uint8Array, width: number, height: number): { data: Uint8Array; width: number; height: number } {
  const nw = width * 2;
  const nh = height * 2;
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(height - 1, y >> 1);
    const syNext = Math.min(height - 1, sy + 1);
    const fy = (y & 1) * 0.5;
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(width - 1, x >> 1);
      const sxNext = Math.min(width - 1, sx + 1);
      const fx = (x & 1) * 0.5;
      const v00 = luma[sy * width + sx];
      const v10 = luma[sy * width + sxNext];
      const v01 = luma[syNext * width + sx];
      const v11 = luma[syNext * width + sxNext];
      const top = v00 + (v10 - v00) * fx;
      const bot = v01 + (v11 - v01) * fx;
      out[y * nw + x] = Math.round(top + (bot - top) * fy);
    }
  }
  return { data: out, width: nw, height: nh };
}

/**
 * Pure-JS local image preprocessing for OCR accuracy on mobile camera photos,
 * colored paper (e.g. pink/yellow carbon bills), handwritten ink, and thermal receipts.
 * Preserves originalBuffer untouched for UI preview and Vision AI.
 */
export function preprocessInvoiceBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType?: string
): PreprocessResult {
  const { fileType, normalizedMime } = validateInvoiceFile(buffer, fileName, mimeType);
  const appliedSteps: string[] = ['file_validated'];

  if (fileType !== 'image') {
    return {
      originalBuffer: buffer,
      processedBuffer: buffer,
      mimeType: normalizedMime,
      fileType,
      appliedSteps,
    };
  }

  try {
    let rgba: Uint8Array;
    let width: number;
    let height: number;

    if (normalizedMime === 'image/png') {
      const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
      const decoded = UPNG.decode(ab);
      width = decoded.width;
      height = decoded.height;
      rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
    } else {
      const decoded = jpeg.decode(buffer, { useTArray: true });
      width = decoded.width;
      height = decoded.height;
      rgba = decoded.data;
    }

    if (!width || !height || rgba.length < width * height * 4) {
      return { originalBuffer: buffer, processedBuffer: buffer, mimeType: normalizedMime, fileType, appliedSteps };
    }

    const totalPixels = width * height;

    // Sample average R/G/B to detect colored paper (e.g., pink/reddish or yellow bills)
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    const sampleStep = Math.max(1, Math.floor(totalPixels / 5000));
    let sampleCount = 0;
    for (let i = 0; i < totalPixels; i += sampleStep) {
      const idx = i * 4;
      sumR += rgba[idx];
      sumG += rgba[idx + 1];
      sumB += rgba[idx + 2];
      sampleCount++;
    }
    const avgR = sumR / sampleCount;
    const avgB = sumB / sampleCount;
    const isReddishPaper = avgR - avgB > 18;

    let luma: Uint8Array = new Uint8Array(totalPixels);
    let minLuma = 255;
    let maxLuma = 0;

    // 1. Ink-channel-aware luminance (suppresses pink/red paper tint so blue/black ink stands out)
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const y = isReddishPaper
        ? Math.round(0.15 * r + 0.45 * g + 0.40 * b)
        : Math.round(0.25 * r + 0.50 * g + 0.25 * b);
      luma[i] = y;
      if (y < minLuma) minLuma = y;
      if (y > maxLuma) maxLuma = y;
    }
    appliedSteps.push(isReddishPaper ? 'ink_channel_isolation' : 'luminance_grayscale');

    // 2. Contrast stretching
    const range = maxLuma - minLuma;
    if (range > 10 && range < 235) {
      const scale = 255 / range;
      for (let i = 0; i < totalPixels; i++) {
        luma[i] = Math.min(255, Math.max(0, Math.round((luma[i] - minLuma) * scale)));
      }
      appliedSteps.push('contrast_stretch');
    }

    // 3. 2x Upscale if image is smaller than 1600px on longest side
    if (Math.max(width, height) < 1600 && width * height <= 2_500_000) {
      const upscaled = upscale2xLuma(luma, width, height);
      luma = upscaled.data;
      width = upscaled.width;
      height = upscaled.height;
      appliedSteps.push('upscale_2x');
    }

    // 4. Adaptive local thresholding for uneven lighting & handwritten pen strokes,
    // gated by Otsu's global threshold (with headroom for faded ink / shadows)
    const otsu = otsuThreshold(luma);
    const globalDarkLimit = Math.min(255, Math.round(otsu + (255 - otsu) * 0.25));
    luma = applyAdaptiveThreshold(luma, width, height, 15, 0.11, globalDarkLimit);
    appliedSteps.push('adaptive_threshold');

    const finalPixels = width * height;
    const outRgba = new Uint8Array(finalPixels * 4);
    for (let i = 0; i < finalPixels; i++) {
      const idx = i * 4;
      const v = luma[i];
      outRgba[idx] = v;
      outRgba[idx + 1] = v;
      outRgba[idx + 2] = v;
      outRgba[idx + 3] = 255;
    }

    const pngArrayBuf = UPNG.encode([outRgba.buffer], width, height, 0);
    appliedSteps.push('lossless_png_encode');

    return {
      originalBuffer: buffer,
      processedBuffer: Buffer.from(pngArrayBuf),
      mimeType: normalizedMime,
      fileType,
      appliedSteps,
      width,
      height,
    };
  } catch {
    return {
      originalBuffer: buffer,
      processedBuffer: buffer,
      mimeType: normalizedMime,
      fileType,
      appliedSteps: [...appliedSteps, 'preprocess_fallback_original'],
    };
  }
}
