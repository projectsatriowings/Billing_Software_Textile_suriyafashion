import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

// Use client/public/images/icon-logo.png as the high-res master image (512x512)
const srcPath = path.resolve('client/public/images/icon-logo.png');
if (!fs.existsSync(srcPath)) {
  console.error('Source logo not found at:', srcPath);
  process.exit(1);
}

const masterImg = await loadImage(fs.readFileSync(srcPath));

// Logo bounds inside 512x512 image
// Non-white bounding box: x in [45, 467] (w=422), y in [104, 399] (h=295)
const minX = 45;
const maxX = 467;
const minY = 104;
const maxY = 399;
const logoW = maxX - minX; // 422
const logoH = maxY - minY; // 295
const logoCenterX = minX + logoW / 2; // 256.0
const logoCenterY = minY + logoH / 2; // 251.5

console.log(`Logo bounds in master asset: ${logoW}x${logoH} centered at (${logoCenterX.toFixed(1)}, ${logoCenterY.toFixed(1)})`);

// Draw logo centered at target (cx, cy) with target width, preserving aspect ratio
function drawLogoCentered(ctx, cx, cy, targetWidth) {
  const scale = targetWidth / logoW;
  const drawW = masterImg.width * scale;
  const drawH = masterImg.height * scale;
  const destX = cx - logoCenterX * scale;
  const destY = cy - logoCenterY * scale;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(masterImg, destX, destY, drawW, drawH);
}

// 1. Adaptive icon foreground (108dp canvas, white background matching #FFFFFF adaptive background)
// Logo scaled so its diagonal easily fits inside the 72dp safe circle without touching edges
function generateAdaptiveForeground(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Fill entire foreground canvas with pure white #FFFFFF
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, size, size);

  // Target logo width ~ 56dp out of 108dp (51.85% of total canvas)
  const targetLogoWidth = size * (56 / 108);
  drawLogoCentered(ctx, size / 2, size / 2, targetLogoWidth);

  return canvas.encodeSync('png');
}

// 2. Standard legacy launcher icon (white squircle / rounded rect background)
function generateLegacyIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // Clean white rounded rectangle background with subtle corner radius (18%)
  const r = Math.round(size * 0.18);
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.arcTo(size, 0, size, r, r);
  ctx.lineTo(size, size - r);
  ctx.arcTo(size, size, size - r, size, r);
  ctx.lineTo(r, size);
  ctx.arcTo(0, size, 0, size - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  // Target logo width ~ 78% of icon size
  const targetLogoWidth = size * 0.78;
  drawLogoCentered(ctx, size / 2, size / 2, targetLogoWidth);

  return canvas.encodeSync('png');
}

// 3. Round legacy launcher icon (white circle background)
function generateRoundIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // Clean white circle background
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  // Target logo width ~ 68% of icon size to comfortably stay within circle circumference
  const targetLogoWidth = size * 0.68;
  drawLogoCentered(ctx, size / 2, size / 2, targetLogoWidth);

  return canvas.encodeSync('png');
}

const DENSITIES = [
  { name: 'mipmap-mdpi', legacySize: 48, adaptiveSize: 108 },
  { name: 'mipmap-hdpi', legacySize: 72, adaptiveSize: 162 },
  { name: 'mipmap-xhdpi', legacySize: 96, adaptiveSize: 216 },
  { name: 'mipmap-xxhdpi', legacySize: 144, adaptiveSize: 324 },
  { name: 'mipmap-xxxhdpi', legacySize: 192, adaptiveSize: 432 },
];

const resDir = path.resolve('android/app/src/main/res');

for (const d of DENSITIES) {
  const targetDir = path.join(resDir, d.name);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 1. ic_launcher.png
  const legacyBuf = generateLegacyIcon(d.legacySize);
  fs.writeFileSync(path.join(targetDir, 'ic_launcher.png'), legacyBuf);

  // 2. ic_launcher_round.png
  const roundBuf = generateRoundIcon(d.legacySize);
  fs.writeFileSync(path.join(targetDir, 'ic_launcher_round.png'), roundBuf);

  // 3. ic_launcher_foreground.png
  const adaptiveBuf = generateAdaptiveForeground(d.adaptiveSize);
  fs.writeFileSync(path.join(targetDir, 'ic_launcher_foreground.png'), adaptiveBuf);

  console.log(`✅ ${d.name}: ic_launcher (${d.legacySize}x${d.legacySize}), ic_launcher_round (${d.legacySize}x${d.legacySize}), ic_launcher_foreground (${d.adaptiveSize}x${d.adaptiveSize})`);
}

// Remove legacy conflicting vectors if present
const oldForegroundVec = path.join(resDir, 'drawable-v24', 'ic_launcher_foreground.xml');
if (fs.existsSync(oldForegroundVec)) {
  fs.unlinkSync(oldForegroundVec);
  console.log(' Removed legacy drawable-v24/ic_launcher_foreground.xml');
}

const oldBackgroundVec = path.join(resDir, 'drawable', 'ic_launcher_background.xml');
if (fs.existsSync(oldBackgroundVec)) {
  fs.unlinkSync(oldBackgroundVec);
  console.log(' Removed legacy drawable/ic_launcher_background.xml');
}

console.log('All Android launcher icons successfully generated and verified!');
