import { PDFDocument, StandardFonts, rgb, RGB } from 'pdf-lib';
import type { PrintableBill } from '../../../shared/bill.ts';
import { moneyInWords, fmtQty, bpToPct } from '../../../shared/money.ts';
import { stateName } from '../../../shared/states.ts';

const money = (minor: number = 0) => (Number(minor || 0) / 100).toFixed(2);

const PAGE_WIDTH = 595.28; // Standard A4 width in pt (210mm)
const PAGE_HEIGHT = 841.89; // Standard A4 height in pt (297mm)
const MARGIN_X = 28;
const MARGIN_Y = 28;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X; // 539.28
const CONTENT_HEIGHT = PAGE_HEIGHT - 2 * MARGIN_Y; // 785.89
const TOP_Y = PAGE_HEIGHT - MARGIN_Y; // 813.89
const BOTTOM_Y = MARGIN_Y; // 28.00

const BLACK = rgb(0, 0, 0);
const GRAY_BG = rgb(0.97, 0.97, 0.97);
const LIGHT_BORDER = rgb(0.8, 0.8, 0.8);
const DARK_GRAY = rgb(0.2, 0.2, 0.2);

/**
 * Sanitize string to standard printable ASCII characters for WinAnsi PDF encoding.
 */
function cleanAscii(str: string): string {
  if (!str) return '';
  return str
    .replace(/₹/g, 'Rs. ')
    .replace(/[–-]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E]/g, ' ');
}

/**
 * Truncate text to fit within specified maximum width in points.
 */
function fitText(text: string, font: any, size: number, maxWidth: number): string {
  if (!text) return '';
  const sanitized = cleanAscii(text);
  if (font.widthOfTextAtSize(sanitized, size) <= maxWidth) return sanitized;
  let cur = sanitized;
  while (cur.length > 0 && font.widthOfTextAtSize(cur + '...', size) > maxWidth) {
    cur = cur.slice(0, -1);
  }
  return cur ? cur + '...' : '';
}

/**
 * Generate a traditional A4 B2B Tax Invoice PDF matching the Indian GST standard layout.
 */
export async function generateWholesaleInvoicePdf(bill: PrintableBill): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const wh = bill.wholesale || {};
  const t = bill.totals;
  const isInterstate = !bill.intra;

  const displayName = (
    wh.displayName ||
    (wh.legalName && wh.legalName !== bill.shop.name ? wh.legalName : '') ||
    bill.shop.name ||
    'WHOLESALE B2B TAX INVOICE'
  ).trim();
  const legalName = (wh.legalName || '').trim();
  const headOfficeAddress = (wh.address || bill.shop.address || '').trim();
  const phone = (wh.phone || bill.shop.phone || '').trim();
  const email = (wh.email || '').trim();
  const gstin = (wh.gstin || bill.shop.gstin || '').trim();

  const buyerName = bill.customer?.name || 'Cash Customer';
  const buyerContactPerson = wh.contactPerson || bill.customer?.contactPerson || '';
  const buyerAddress = wh.billingAddress || bill.customer?.address || '';
  const shippingAddress = wh.shippingAddress || bill.customer?.shippingAddress || buyerAddress;
  const buyerPhone = bill.customer?.phone || '';
  const buyerGstin = bill.customer?.gstin || '';
  const buyerStateCode = wh.customerStateCode || bill.customer?.stateCode || (buyerGstin && buyerGstin.length >= 2 ? buyerGstin.slice(0, 2) : '') || '';
  const buyerStateName = wh.customerState || bill.customer?.stateName || (buyerStateCode ? stateName(buyerStateCode) : '');

  // ── Outer Page Border ──
  page.drawRectangle({
    x: MARGIN_X,
    y: BOTTOM_Y,
    width: CONTENT_WIDTH,
    height: CONTENT_HEIGHT,
    borderColor: BLACK,
    borderWidth: 1,
  });

  // ── 1. Header Block (height ~84 pt) ──
  const headerHeight = 84;
  const headerBottomY = TOP_Y - headerHeight;
  page.drawLine({
    start: { x: MARGIN_X, y: headerBottomY },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: headerBottomY },
    thickness: 1,
    color: BLACK,
  });

  // Left column: "TAX INVOICE" (width: 105 pt)
  const colLeftW = 105;
  page.drawLine({
    start: { x: MARGIN_X + colLeftW, y: headerBottomY },
    end: { x: MARGIN_X + colLeftW, y: TOP_Y },
    thickness: 1,
    color: BLACK,
  });
  page.drawText('TAX INVOICE', {
    x: MARGIN_X + 14,
    y: TOP_Y - 46,
    size: 11,
    font: fontBold,
    color: BLACK,
  });

  // Right column: Copy tags (width: 85 pt)
  const colRightW = 85;
  const colRightX = MARGIN_X + CONTENT_WIDTH - colRightW;
  page.drawLine({
    start: { x: colRightX, y: headerBottomY },
    end: { x: colRightX, y: TOP_Y },
    thickness: 1,
    color: BLACK,
  });
  page.drawText('Original', { x: colRightX + 18, y: TOP_Y - 22, size: 8, font: fontBold, color: BLACK });
  page.drawText('Duplicate', { x: colRightX + 18, y: TOP_Y - 36, size: 8, font: fontRegular, color: DARK_GRAY });
  page.drawText('Triplicate', { x: colRightX + 18, y: TOP_Y - 50, size: 8, font: fontRegular, color: DARK_GRAY });
  page.drawText('Page 1 of 1', { x: colRightX + 18, y: TOP_Y - 68, size: 7.5, font: fontRegular, color: DARK_GRAY });

  // Center column: Business Name & Details
  const centerW = CONTENT_WIDTH - colLeftW - colRightW;
  const centerX = MARGIN_X + colLeftW;

  let curY = TOP_Y - 20;
  const dispNameText = fitText(displayName, fontBold, 15, centerW - 16);
  const dispNameW = fontBold.widthOfTextAtSize(dispNameText, 15);
  page.drawText(dispNameText, {
    x: centerX + (centerW - dispNameW) / 2,
    y: curY,
    size: 15,
    font: fontBold,
    color: BLACK,
  });

  if (legalName && legalName !== displayName) {
    curY -= 12;
    const legText = fitText(`(M/s ${legalName})`, fontBold, 8, centerW - 16);
    const legW = fontBold.widthOfTextAtSize(legText, 8);
    page.drawText(legText, { x: centerX + (centerW - legW) / 2, y: curY, size: 8, font: fontBold, color: DARK_GRAY });
  }

  if (headOfficeAddress) {
    curY -= 11;
    const addrText = fitText(`HEAD OFFICE : ${headOfficeAddress}`, fontRegular, 7.5, centerW - 16);
    const addrW = fontRegular.widthOfTextAtSize(addrText, 7.5);
    page.drawText(addrText, { x: centerX + (centerW - addrW) / 2, y: curY, size: 7.5, font: fontRegular, color: DARK_GRAY });
  }

  curY -= 11;
  const contactText = fitText(`PHONE : ${phone || '-'}${email ? `  Email : ${email}` : ''}`, fontRegular, 7.5, centerW - 16);
  const contactW = fontRegular.widthOfTextAtSize(contactText, 7.5);
  page.drawText(contactText, { x: centerX + (centerW - contactW) / 2, y: curY, size: 7.5, font: fontRegular, color: DARK_GRAY });

  curY -= 12;
  const gstinText = `GSTIN  ${gstin || 'Unregistered'}`;
  const gstinW = fontBold.widthOfTextAtSize(gstinText, 8.5);
  page.drawText(gstinText, { x: centerX + (centerW - gstinW) / 2, y: curY, size: 8.5, font: fontBold, color: BLACK });

  // ── 2. Buyer & Meta Block (height ~76 pt) ──
  const buyerBlockHeight = 76;
  const buyerBottomY = headerBottomY - buyerBlockHeight;
  page.drawLine({
    start: { x: MARGIN_X, y: buyerBottomY },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: buyerBottomY },
    thickness: 1,
    color: BLACK,
  });

  const buyerW = 275;
  const metaX = MARGIN_X + buyerW;
  page.drawLine({
    start: { x: metaX, y: buyerBottomY },
    end: { x: metaX, y: headerBottomY },
    thickness: 1,
    color: BLACK,
  });

  // Buyer Info (Left)
  let bY = headerBottomY - 14;
  page.drawText(fitText(`M/S,  ${buyerName}`, fontBold, 9.5, buyerW - 16), {
    x: MARGIN_X + 8,
    y: bY,
    size: 9.5,
    font: fontBold,
    color: BLACK,
  });

  bY -= 11;
  if (buyerContactPerson) {
    page.drawText(fitText(`Attn: ${buyerContactPerson}`, fontBold, 8, buyerW - 16), {
      x: MARGIN_X + 8,
      y: bY,
      size: 8,
      font: fontBold,
      color: DARK_GRAY,
    });
    bY -= 10;
  }

  const addrDisp = buyerAddress || 'Address not configured';
  page.drawText(fitText(addrDisp, fontRegular, 8, buyerW - 16), {
    x: MARGIN_X + 8,
    y: bY,
    size: 8,
    font: fontRegular,
    color: DARK_GRAY,
  });

  if (shippingAddress && shippingAddress !== buyerAddress) {
    bY -= 10;
    page.drawText(fitText(`Ship To: ${shippingAddress}`, fontRegular, 7.5, buyerW - 16), {
      x: MARGIN_X + 8,
      y: bY,
      size: 7.5,
      font: fontRegular,
      color: DARK_GRAY,
    });
  }

  bY -= 11;
  page.drawText(fitText(`Phone : ${buyerPhone || '-'}`, fontRegular, 8, buyerW - 16), {
    x: MARGIN_X + 8,
    y: bY,
    size: 8,
    font: fontRegular,
    color: BLACK,
  });

  bY -= 12;
  page.drawText(`GST NO. : ${buyerGstin || 'Unregistered'}`, {
    x: MARGIN_X + 8,
    y: bY,
    size: 8,
    font: fontBold,
    color: BLACK,
  });
  if (buyerStateName || buyerStateCode) {
    const stLabel = `${buyerStateName || ''}${buyerStateCode ? ` - ${buyerStateCode}` : ''}`;
    const stW = fontBold.widthOfTextAtSize(stLabel, 8);
    page.drawText(stLabel, {
      x: metaX - 8 - stW,
      y: bY,
      size: 8,
      font: fontBold,
      color: BLACK,
    });
  }

  // Invoice Meta Table (Right)
  const metaW = CONTENT_WIDTH - buyerW;
  const rowH = buyerBlockHeight / 4; // 19 pt per row
  const metaDividerX = metaX + metaW / 2;

  // Row 1 divider
  page.drawLine({
    start: { x: metaX, y: headerBottomY - rowH },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: headerBottomY - rowH },
    thickness: 0.5,
    color: BLACK,
  });
  // Row 1 vertical mid line
  page.drawLine({
    start: { x: metaDividerX, y: headerBottomY - rowH },
    end: { x: metaDividerX, y: headerBottomY },
    thickness: 0.5,
    color: BLACK,
  });
  page.drawText(`Invoice No :  ${bill.number}`, { x: metaX + 6, y: headerBottomY - 13, size: 8, font: fontBold, color: BLACK });
  page.drawText(`Date :  ${bill.dateText.split(',')[0] || bill.dateText}`, { x: metaDividerX + 6, y: headerBottomY - 13, size: 8, font: fontBold, color: BLACK });

  // Row 2: Place of Supply
  page.drawLine({
    start: { x: metaX, y: headerBottomY - rowH * 2 },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: headerBottomY - rowH * 2 },
    thickness: 0.5,
    color: BLACK,
  });
  const posText = buyerStateName ? `${buyerStateName}${buyerStateCode ? ` (${buyerStateCode})` : ''}` : 'As per Delivery Address';
  page.drawText(`Place of Supply :  ${posText}`, { x: metaX + 6, y: headerBottomY - rowH - 13, size: 8, font: fontRegular, color: BLACK });

  // Row 3: Reverse Charge & Payment Terms
  page.drawLine({
    start: { x: metaX, y: headerBottomY - rowH * 3 },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: headerBottomY - rowH * 3 },
    thickness: 0.5,
    color: BLACK,
  });
  page.drawLine({
    start: { x: metaDividerX, y: headerBottomY - rowH * 3 },
    end: { x: metaDividerX, y: headerBottomY - rowH * 2 },
    thickness: 0.5,
    color: BLACK,
  });
  page.drawText('Reverse Charge : No', { x: metaX + 6, y: headerBottomY - rowH * 2 - 13, size: 8, font: fontRegular, color: BLACK });
  page.drawText(fitText(`Payment Terms :  ${wh.paymentTerms || 'NEFT / RTGS'}`, fontRegular, 8, metaW / 2 - 10), {
    x: metaDividerX + 6,
    y: headerBottomY - rowH * 2 - 13,
    size: 8,
    font: fontRegular,
    color: BLACK,
  });

  // Row 4: Supply Type
  const supplyTypeText = isInterstate ? 'Supply Type :  Inter-State B2B Supply (IGST)' : 'Supply Type :  Intra-State B2B Supply (CGST + SGST)';
  page.drawText(supplyTypeText, { x: metaX + 6, y: headerBottomY - rowH * 3 - 13, size: 8, font: fontBold, color: BLACK });

  // ── 3. Product Items Table ──
  // Columns: SR.NO(28) | DESCRIPTION(192) | HSN CODE(58) | GST RATE(45) | QUANTITY(45) | RATE(60) | PER(36) | AMOUNT(75.28)
  const cols = [
    { label: 'SR.NO', w: 28, align: 'center' },
    { label: 'DESCRIPTION', w: 192, align: 'left' },
    { label: 'HSN CODE', w: 58, align: 'center' },
    { label: 'GST RATE', w: 45, align: 'center' },
    { label: 'QUANTITY', w: 45, align: 'center' },
    { label: 'RATE', w: 60, align: 'right' },
    { label: 'PER', w: 36, align: 'center' },
    { label: 'AMOUNT', w: 75.28, align: 'right' },
  ];

  const tableTopY = buyerBottomY;
  const thHeight = 18;
  const thBottomY = tableTopY - thHeight;

  // Header background fill
  page.drawRectangle({
    x: MARGIN_X,
    y: thBottomY,
    width: CONTENT_WIDTH,
    height: thHeight,
    color: GRAY_BG,
  });
  page.drawLine({
    start: { x: MARGIN_X, y: thBottomY },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: thBottomY },
    thickness: 1,
    color: BLACK,
  });

  // Draw table header text
  let curColX = MARGIN_X;
  for (const c of cols) {
    const textW = fontBold.widthOfTextAtSize(c.label, 7.5);
    let tx = curColX + 4;
    if (c.align === 'center') tx = curColX + (c.w - textW) / 2;
    else if (c.align === 'right') tx = curColX + c.w - textW - 4;
    page.drawText(c.label, { x: tx, y: tableTopY - 12, size: 7.5, font: fontBold, color: BLACK });
    curColX += c.w;
  }

  // Draw lines
  let totalQtyMilli = 0;
  let primaryUnit = 'Pcs';
  const itemRowH = 16;
  const minRows = 8;
  const rowCount = Math.max(minRows, bill.lines.length);
  const itemsTableHeight = thHeight + rowCount * itemRowH + 18; // 18 for total row
  const tableBottomY = tableTopY - itemsTableHeight;

  // Draw vertical column separators
  let xAcc = MARGIN_X;
  for (let i = 0; i < cols.length - 1; i++) {
    xAcc += cols[i].w;
    page.drawLine({
      start: { x: xAcc, y: tableBottomY },
      end: { x: xAcc, y: tableTopY },
      thickness: 0.5,
      color: BLACK,
    });
  }

  // Draw line items
  for (let i = 0; i < rowCount; i++) {
    const rowY = thBottomY - (i + 1) * itemRowH;
    const l = bill.lines[i];

    if (l) {
      totalQtyMilli += l.qtyMilli;
      const u = l.unit || 'Pcs';
      if (i === 0) primaryUnit = u;
      const amount = (l.taxableMinor + l.cgstMinor + l.sgstMinor + l.igstMinor) / 100;
      const gstRateStr = `${bpToPct(l.taxRateBp)}%`;

      // SR NO
      const srStr = String(i + 1);
      const srW = fontRegular.widthOfTextAtSize(srStr, 8);
      page.drawText(srStr, { x: MARGIN_X + (cols[0].w - srW) / 2, y: rowY + 5, size: 8, font: fontRegular, color: BLACK });

      // DESCRIPTION
      const descX = MARGIN_X + cols[0].w + 4;
      const descText = fitText(l.name, fontBold, 8, cols[1].w - 8);
      page.drawText(descText, { x: descX, y: rowY + 5, size: 8, font: fontBold, color: BLACK });

      // HSN
      const hsnX = MARGIN_X + cols[0].w + cols[1].w;
      const hsnStr = l.hsn || '-';
      const hsnW = fontRegular.widthOfTextAtSize(hsnStr, 8);
      page.drawText(hsnStr, { x: hsnX + (cols[2].w - hsnW) / 2, y: rowY + 5, size: 8, font: fontRegular, color: BLACK });

      // GST RATE
      const gstX = hsnX + cols[2].w;
      const gstW = fontRegular.widthOfTextAtSize(gstRateStr, 8);
      page.drawText(gstRateStr, { x: gstX + (cols[3].w - gstW) / 2, y: rowY + 5, size: 8, font: fontRegular, color: BLACK });

      // QUANTITY
      const qtyX = gstX + cols[3].w;
      const qtyStr = fmtQty(l.qtyMilli);
      const qtyW = fontRegular.widthOfTextAtSize(qtyStr, 8);
      page.drawText(qtyStr, { x: qtyX + (cols[4].w - qtyW) / 2, y: rowY + 5, size: 8, font: fontRegular, color: BLACK });

      // RATE
      const rateX = qtyX + cols[4].w;
      const rateStr = money(l.priceMinor);
      const rateW = fontRegular.widthOfTextAtSize(rateStr, 8);
      page.drawText(rateStr, { x: rateX + cols[5].w - rateW - 4, y: rowY + 5, size: 8, font: fontRegular, color: BLACK });

      // PER
      const perX = rateX + cols[5].w;
      const perW = fontRegular.widthOfTextAtSize(u, 8);
      page.drawText(u, { x: perX + (cols[6].w - perW) / 2, y: rowY + 5, size: 8, font: fontRegular, color: BLACK });

      // AMOUNT
      const amtX = perX + cols[6].w;
      const amtStr = amount.toFixed(2);
      const amtW = fontRegular.widthOfTextAtSize(amtStr, 8);
      page.drawText(amtStr, { x: amtX + cols[7].w - amtW - 4, y: rowY + 5, size: 8, font: fontRegular, color: BLACK });
    }
  }

  // Items Table Subtotal Row
  const totalRowY = tableBottomY;
  page.drawLine({
    start: { x: MARGIN_X, y: totalRowY + 18 },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: totalRowY + 18 },
    thickness: 1,
    color: BLACK,
  });
  page.drawLine({
    start: { x: MARGIN_X, y: totalRowY },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: totalRowY },
    thickness: 1,
    color: BLACK,
  });

  // Total label under HSN
  const totalLblX = MARGIN_X + cols[0].w + cols[1].w + cols[2].w + cols[3].w - 38;
  page.drawText('Total :-', { x: totalLblX, y: totalRowY + 6, size: 8.5, font: fontBold, color: BLACK });

  // Qty total
  const qtyTotX = MARGIN_X + cols[0].w + cols[1].w + cols[2].w + cols[3].w;
  const qtyTotStr = fmtQty(totalQtyMilli);
  const qtyTotW = fontBold.widthOfTextAtSize(qtyTotStr, 8.5);
  page.drawText(qtyTotStr, { x: qtyTotX + (cols[4].w - qtyTotW) / 2, y: totalRowY + 6, size: 8.5, font: fontBold, color: BLACK });

  // Subtotal amount
  const subTotStr = money(t.subtotalMinor);
  const subTotW = fontBold.widthOfTextAtSize(subTotStr, 8.5);
  page.drawText(subTotStr, {
    x: MARGIN_X + CONTENT_WIDTH - subTotW - 4,
    y: totalRowY + 6,
    size: 8.5,
    font: fontBold,
    color: BLACK,
  });

  // ── 4. Words & Totals Block (height ~75 pt) ──
  const totalsBlockHeight = 75;
  const totalsBottomY = tableBottomY - totalsBlockHeight;
  page.drawLine({
    start: { x: MARGIN_X, y: totalsBottomY },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: totalsBottomY },
    thickness: 1,
    color: BLACK,
  });

  const wordsColW = 310;
  const totX = MARGIN_X + wordsColW;
  page.drawLine({
    start: { x: totX, y: totalsBottomY },
    end: { x: totX, y: tableBottomY },
    thickness: 1,
    color: BLACK,
  });

  // Words (Left)
  let wY = tableBottomY - 14;
  page.drawText('Total Amount in Words :', { x: MARGIN_X + 8, y: wY, size: 8.5, font: fontBold, color: DARK_GRAY });
  wY -= 13;
  const wordsText = fitText(`Rs. ${moneyInWords(t.totalMinor)} Only`, fontBold, 9.5, wordsColW - 16);
  page.drawText(wordsText, { x: MARGIN_X + 8, y: wY, size: 9.5, font: fontBold, color: BLACK });

  wY -= 14;
  page.drawLine({
    start: { x: MARGIN_X + 8, y: wY + 6 },
    end: { x: totX - 8, y: wY + 6 },
    thickness: 0.5,
    color: LIGHT_BORDER,
  });
  page.drawText(
    fitText(
      'Certified that the particulars given in this tax invoice are true and correct, and the amount indicated',
      fontRegular,
      6.8,
      wordsColW - 16
    ),
    { x: MARGIN_X + 8, y: wY - 4, size: 6.8, font: fontRegular, color: DARK_GRAY }
  );
  page.drawText(
    fitText('represents the price actually charged.', fontRegular, 6.8, wordsColW - 16),
    { x: MARGIN_X + 8, y: wY - 13, size: 6.8, font: fontRegular, color: DARK_GRAY }
  );

  // Totals Table (Right)
  const totW = CONTENT_WIDTH - wordsColW;
  let totRowY = tableBottomY - 13;

  const drawTotalLine = (label: string, valStr: string, isBold = false) => {
    page.drawText(label, { x: totX + 8, y: totRowY, size: 8, font: isBold ? fontBold : fontRegular, color: BLACK });
    const vW = (isBold ? fontBold : fontRegular).widthOfTextAtSize(valStr, 8);
    page.drawText(valStr, { x: MARGIN_X + CONTENT_WIDTH - vW - 8, y: totRowY, size: 8, font: isBold ? fontBold : fontRegular, color: BLACK });
    totRowY -= 12;
  };

  if (t.discountMinor > 0) {
    drawTotalLine('DISCOUNT', `-Rs. ${money(t.discountMinor)}`);
  }
  drawTotalLine('Taxable Amount', money(t.taxableMinor));

  if (isInterstate) {
    drawTotalLine('IGST', money(t.igstMinor));
  } else {
    drawTotalLine('CGST', money(t.cgstMinor));
    drawTotalLine('SGST', money(t.sgstMinor));
  }

  if (t.roundOffMinor !== 0) {
    drawTotalLine('Round Off', `${t.roundOffMinor > 0 ? '+' : ''}${money(t.roundOffMinor)}`);
  }

  // Grand Total Bottom Strip (height 20 pt)
  const grandTotalStripY = totalsBottomY;
  page.drawLine({
    start: { x: totX, y: grandTotalStripY + 20 },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: grandTotalStripY + 20 },
    thickness: 1,
    color: BLACK,
  });

  const grandQtyStr = `Total :-  ${fmtQty(totalQtyMilli)} ${primaryUnit}`;
  page.drawText(grandQtyStr, { x: totX + 8, y: grandTotalStripY + 6, size: 9, font: fontBold, color: BLACK });

  const grandAmtStr = `RS.  ${money(t.totalMinor)}`;
  const grandAmtW = fontBold.widthOfTextAtSize(grandAmtStr, 11);
  page.drawText(grandAmtStr, {
    x: MARGIN_X + CONTENT_WIDTH - grandAmtW - 8,
    y: grandTotalStripY + 6,
    size: 11,
    font: fontBold,
    color: BLACK,
  });

  // ── 5. HSN Summary Table (height ~46 pt) ──
  const hsnBlockHeight = 46;
  const hsnBottomY = totalsBottomY - hsnBlockHeight;
  page.drawLine({
    start: { x: MARGIN_X, y: hsnBottomY },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: hsnBottomY },
    thickness: 1,
    color: BLACK,
  });

  // Group by HSN
  const hsnMap = new Map<string, { hsn: string; qtyMilli: number; taxableMinor: number; taxRateBp: number; taxMinor: number }>();
  for (const l of bill.lines) {
    const code = l.hsn || 'NON-GST';
    const entry = hsnMap.get(code) || { hsn: code, qtyMilli: 0, taxableMinor: 0, taxRateBp: l.taxRateBp, taxMinor: 0 };
    entry.qtyMilli += l.qtyMilli;
    entry.taxableMinor += l.taxableMinor;
    entry.taxMinor += l.cgstMinor + l.sgstMinor + l.igstMinor;
    hsnMap.set(code, entry);
  }

  const hsnCols = [
    { label: 'HSN CODE', w: 110, align: 'center' },
    { label: 'Quantity', w: 75, align: 'center' },
    { label: 'Taxable Amount', w: 115, align: 'right' },
    { label: isInterstate ? 'IGST Rate' : 'GST Rate', w: 85, align: 'center' },
    { label: 'Tax Amount', w: 154.28, align: 'right' },
  ];

  // HSN Table Header
  const hsnThY = totalsBottomY - 14;
  page.drawRectangle({
    x: MARGIN_X,
    y: hsnThY,
    width: CONTENT_WIDTH,
    height: 14,
    color: GRAY_BG,
  });
  page.drawLine({
    start: { x: MARGIN_X, y: hsnThY },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: hsnThY },
    thickness: 0.5,
    color: BLACK,
  });

  let hX = MARGIN_X;
  for (const c of hsnCols) {
    const tW = fontBold.widthOfTextAtSize(c.label, 7);
    let tx = hX + 4;
    if (c.align === 'center') tx = hX + (c.w - tW) / 2;
    else if (c.align === 'right') tx = hX + c.w - tW - 6;
    page.drawText(c.label, { x: tx, y: totalsBottomY - 10, size: 7, font: fontBold, color: BLACK });
    hX += c.w;
  }

  // Draw HSN rows (first 1-2 rows)
  let curHsnY = hsnThY - 12;
  for (const h of hsnMap.values()) {
    page.drawText(h.hsn, {
      x: MARGIN_X + (hsnCols[0].w - fontRegular.widthOfTextAtSize(h.hsn, 7.5)) / 2,
      y: curHsnY,
      size: 7.5,
      font: fontRegular,
      color: BLACK,
    });
    const qStr = fmtQty(h.qtyMilli);
    page.drawText(qStr, {
      x: MARGIN_X + hsnCols[0].w + (hsnCols[1].w - fontRegular.widthOfTextAtSize(qStr, 7.5)) / 2,
      y: curHsnY,
      size: 7.5,
      font: fontRegular,
      color: BLACK,
    });
    const taxAmtStr = money(h.taxableMinor);
    const taxAmtW = fontRegular.widthOfTextAtSize(taxAmtStr, 7.5);
    page.drawText(taxAmtStr, {
      x: MARGIN_X + hsnCols[0].w + hsnCols[1].w + hsnCols[2].w - taxAmtW - 6,
      y: curHsnY,
      size: 7.5,
      font: fontRegular,
      color: BLACK,
    });
    const rateStr = `${bpToPct(h.taxRateBp)}%`;
    const rateW = fontRegular.widthOfTextAtSize(rateStr, 7.5);
    page.drawText(rateStr, {
      x: MARGIN_X + hsnCols[0].w + hsnCols[1].w + hsnCols[2].w + (hsnCols[3].w - rateW) / 2,
      y: curHsnY,
      size: 7.5,
      font: fontRegular,
      color: BLACK,
    });
    const taxValStr = money(h.taxMinor);
    const taxValW = fontRegular.widthOfTextAtSize(taxValStr, 7.5);
    page.drawText(taxValStr, {
      x: MARGIN_X + CONTENT_WIDTH - taxValW - 6,
      y: curHsnY,
      size: 7.5,
      font: fontRegular,
      color: BLACK,
    });
    curHsnY -= 11;
    break; // Top row
  }

  // HSN Total row
  page.drawLine({
    start: { x: MARGIN_X, y: hsnBottomY + 12 },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: hsnBottomY + 12 },
    thickness: 0.5,
    color: BLACK,
  });
  page.drawText('Total :', { x: MARGIN_X + hsnCols[0].w - 32, y: hsnBottomY + 3.5, size: 7.5, font: fontBold, color: BLACK });
  const totHsnQty = fmtQty(totalQtyMilli);
  page.drawText(totHsnQty, {
    x: MARGIN_X + hsnCols[0].w + (hsnCols[1].w - fontBold.widthOfTextAtSize(totHsnQty, 7.5)) / 2,
    y: hsnBottomY + 3.5,
    size: 7.5,
    font: fontBold,
    color: BLACK,
  });
  const totTaxableStr = money(t.taxableMinor);
  page.drawText(totTaxableStr, {
    x: MARGIN_X + hsnCols[0].w + hsnCols[1].w + hsnCols[2].w - fontBold.widthOfTextAtSize(totTaxableStr, 7.5) - 6,
    y: hsnBottomY + 3.5,
    size: 7.5,
    font: fontBold,
    color: BLACK,
  });
  const totTaxStr = money(t.cgstMinor + t.sgstMinor + t.igstMinor);
  page.drawText(totTaxStr, {
    x: MARGIN_X + CONTENT_WIDTH - fontBold.widthOfTextAtSize(totTaxStr, 7.5) - 6,
    y: hsnBottomY + 3.5,
    size: 7.5,
    font: fontBold,
    color: BLACK,
  });

  // HSN vertical column dividers
  let hsnColAcc = MARGIN_X;
  for (let i = 0; i < hsnCols.length - 1; i++) {
    hsnColAcc += hsnCols[i].w;
    page.drawLine({
      start: { x: hsnColAcc, y: hsnBottomY },
      end: { x: hsnColAcc, y: totalsBottomY },
      thickness: 0.5,
      color: BLACK,
    });
  }

  // ── 6. Footer Terms & Signatures Block ──
  const footerTermsW = 310;
  const termsList = [
    "(1) Payments to be made by payee's A/c. Cheque, Draft or NEFT/RTGS.",
    '(2) Goods once sold and/or delivered will in no circumstances be taken back.',
    '(3) Any complaint for goods should be made within 7 days.',
    '(4) Interest @ 24% per annum will be charged after due date of the bill.',
    '(5) Subject to Chennai Jurisdiction.',
  ];

  page.drawText('TERMS & CONDITION -:', {
    x: MARGIN_X + 8,
    y: hsnBottomY - 12,
    size: 7,
    font: fontBold,
    color: BLACK,
  });

  let termY = hsnBottomY - 21;
  for (const term of termsList) {
    page.drawText(fitText(term, fontRegular, 6.2, footerTermsW - 16), {
      x: MARGIN_X + 8,
      y: termY,
      size: 6.2,
      font: fontRegular,
      color: DARK_GRAY,
    });
    termY -= 8;
  }

  page.drawText("Receiver's Signature", {
    x: MARGIN_X + 8,
    y: BOTTOM_Y + 8,
    size: 8,
    font: fontBold,
    color: BLACK,
  });

  // E. & O. E. (Center)
  page.drawText('E. & O. E.', {
    x: MARGIN_X + 325,
    y: BOTTOM_Y + 8,
    size: 8.5,
    font: fontBold,
    color: DARK_GRAY,
  });

  // Authorised Signatory (Right)
  const sigForText = fitText(`For -: ${displayName}`, fontBold, 9.5, 170);
  const sigForW = fontBold.widthOfTextAtSize(sigForText, 9.5);
  page.drawText(sigForText, {
    x: MARGIN_X + CONTENT_WIDTH - sigForW - 12,
    y: hsnBottomY - 14,
    size: 9.5,
    font: fontBold,
    color: BLACK,
  });

  const sigAuthText = 'Authorised Signatory';
  const sigAuthW = fontBold.widthOfTextAtSize(sigAuthText, 8.5);
  page.drawText(sigAuthText, {
    x: MARGIN_X + CONTENT_WIDTH - sigAuthW - 12,
    y: BOTTOM_Y + 8,
    size: 8.5,
    font: fontBold,
    color: BLACK,
  });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Generate a standard retail bill PDF (compact thermal/receipt representation on A4 page).
 */
export async function generateRetailInvoicePdf(bill: PrintableBill): Promise<Buffer> {
  const doc = await PDFDocument.create();
  // Standard receipt width: 280 pt, height: calculated or A4
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const t = bill.totals;
  const shopName = bill.shop.name || 'Store';
  const address = bill.shop.address || '';
  const phone = bill.shop.phone || '';
  const gstin = bill.shop.gstin || '';

  // Center receipt on page
  const receiptW = 280;
  const rx = (PAGE_WIDTH - receiptW) / 2;
  let ry = TOP_Y - 20;

  // Receipt box
  page.drawRectangle({
    x: rx,
    y: BOTTOM_Y + 20,
    width: receiptW,
    height: CONTENT_HEIGHT - 40,
    borderColor: BLACK,
    borderWidth: 1,
  });

  // Shop Header
  const nameW = fontBold.widthOfTextAtSize(shopName, 13);
  page.drawText(shopName, { x: rx + (receiptW - nameW) / 2, y: ry, size: 13, font: fontBold, color: BLACK });
  ry -= 14;

  if (address) {
    const addrW = fontRegular.widthOfTextAtSize(fitText(address, fontRegular, 8, receiptW - 20), 8);
    page.drawText(fitText(address, fontRegular, 8, receiptW - 20), { x: rx + (receiptW - addrW) / 2, y: ry, size: 8, font: fontRegular, color: DARK_GRAY });
    ry -= 12;
  }

  if (phone) {
    const phW = fontRegular.widthOfTextAtSize(`Ph: ${phone}`, 8);
    page.drawText(`Ph: ${phone}`, { x: rx + (receiptW - phW) / 2, y: ry, size: 8, font: fontRegular, color: DARK_GRAY });
    ry -= 12;
  }

  if (gstin) {
    const gstW = fontBold.widthOfTextAtSize(`GSTIN: ${gstin}`, 8.5);
    page.drawText(`GSTIN: ${gstin}`, { x: rx + (receiptW - gstW) / 2, y: ry, size: 8.5, font: fontBold, color: BLACK });
    ry -= 14;
  }

  // Divider
  page.drawLine({ start: { x: rx + 8, y: ry }, end: { x: rx + receiptW - 8, y: ry }, thickness: 0.5, color: BLACK });
  ry -= 14;

  // Invoice Meta
  page.drawText(`Bill No: ${bill.number}`, { x: rx + 10, y: ry, size: 8.5, font: fontBold, color: BLACK });
  const dtW = fontRegular.widthOfTextAtSize(bill.dateText, 8);
  page.drawText(bill.dateText, { x: rx + receiptW - dtW - 10, y: ry, size: 8, font: fontRegular, color: BLACK });
  ry -= 14;

  if (bill.customer?.name) {
    page.drawText(`Customer: ${bill.customer.name}`, { x: rx + 10, y: ry, size: 8, font: fontRegular, color: BLACK });
    if (bill.customer.phone) {
      const phW = fontRegular.widthOfTextAtSize(bill.customer.phone, 8);
      page.drawText(bill.customer.phone, { x: rx + receiptW - phW - 10, y: ry, size: 8, font: fontRegular, color: BLACK });
    }
    ry -= 14;
  }

  // Table Header
  page.drawLine({ start: { x: rx + 8, y: ry }, end: { x: rx + receiptW - 8, y: ry }, thickness: 0.5, color: BLACK });
  ry -= 12;
  page.drawText('ITEM', { x: rx + 10, y: ry, size: 8, font: fontBold, color: BLACK });
  page.drawText('QTY', { x: rx + 140, y: ry, size: 8, font: fontBold, color: BLACK });
  page.drawText('RATE', { x: rx + 185, y: ry, size: 8, font: fontBold, color: BLACK });
  page.drawText('AMT', { x: rx + receiptW - 35, y: ry, size: 8, font: fontBold, color: BLACK });
  ry -= 6;
  page.drawLine({ start: { x: rx + 8, y: ry }, end: { x: rx + receiptW - 8, y: ry }, thickness: 0.5, color: BLACK });
  ry -= 12;

  // Lines
  for (const l of bill.lines.slice(0, 25)) {
    page.drawText(fitText(l.name, fontRegular, 8, 125), { x: rx + 10, y: ry, size: 8, font: fontRegular, color: BLACK });
    page.drawText(fmtQty(l.qtyMilli), { x: rx + 140, y: ry, size: 8, font: fontRegular, color: BLACK });
    page.drawText(money(l.priceMinor), { x: rx + 185, y: ry, size: 8, font: fontRegular, color: BLACK });
    const amtStr = money(l.taxableMinor + l.cgstMinor + l.sgstMinor + l.igstMinor);
    const aW = fontRegular.widthOfTextAtSize(amtStr, 8);
    page.drawText(amtStr, { x: rx + receiptW - aW - 10, y: ry, size: 8, font: fontRegular, color: BLACK });
    ry -= 13;
  }

  // Divider
  page.drawLine({ start: { x: rx + 8, y: ry }, end: { x: rx + receiptW - 8, y: ry }, thickness: 0.5, color: BLACK });
  ry -= 14;

  // Subtotal & Taxes
  page.drawText('Taxable Amount', { x: rx + 10, y: ry, size: 8, font: fontRegular, color: BLACK });
  const txW = fontRegular.widthOfTextAtSize(money(t.taxableMinor), 8);
  page.drawText(money(t.taxableMinor), { x: rx + receiptW - txW - 10, y: ry, size: 8, font: fontRegular, color: BLACK });
  ry -= 12;

  const totalTax = t.cgstMinor + t.sgstMinor + t.igstMinor;
  if (totalTax > 0) {
    page.drawText('Total GST', { x: rx + 10, y: ry, size: 8, font: fontRegular, color: BLACK });
    const gstValW = fontRegular.widthOfTextAtSize(money(totalTax), 8);
    page.drawText(money(totalTax), { x: rx + receiptW - gstValW - 10, y: ry, size: 8, font: fontRegular, color: BLACK });
    ry -= 12;
  }

  // Grand Total
  page.drawLine({ start: { x: rx + 8, y: ry }, end: { x: rx + receiptW - 8, y: ry }, thickness: 1, color: BLACK });
  ry -= 14;
  page.drawText('GRAND TOTAL', { x: rx + 10, y: ry, size: 10, font: fontBold, color: BLACK });
  const gtStr = `Rs. ${money(t.totalMinor)}`;
  const gtW = fontBold.widthOfTextAtSize(gtStr, 11);
  page.drawText(gtStr, { x: rx + receiptW - gtW - 10, y: ry, size: 11, font: fontBold, color: BLACK });
  ry -= 15;

  // Payments / Tender breakdown
  if (bill.payments && bill.payments.length > 0) {
    const payStr = bill.payments.map((p) => `${cleanAscii(p.method).toUpperCase()}: Rs. ${money(p.amountMinor)}`).join(' | ');
    const payW = fontRegular.widthOfTextAtSize(payStr, 7.5);
    page.drawText(fitText(payStr, fontRegular, 7.5, receiptW - 20), { x: rx + 10, y: ry, size: 7.5, font: fontRegular, color: DARK_GRAY });
    ry -= 11;
  }

  if (bill.tender && bill.tender.changeReturnedMinor > 0) {
    const chgStr = `Change Returned: Rs. ${money(bill.tender.changeReturnedMinor)}`;
    page.drawText(chgStr, { x: rx + 10, y: ry, size: 7.5, font: fontBold, color: BLACK });
    ry -= 11;
  }

  if (t.balanceMinor > 0) {
    const balStr = `Balance Due: Rs. ${money(t.balanceMinor)}`;
    page.drawText(balStr, { x: rx + 10, y: ry, size: 8, font: fontBold, color: BLACK });
    ry -= 13;
  } else {
    page.drawText('Status: PAID', { x: rx + 10, y: ry, size: 8, font: fontBold, color: BLACK });
    ry -= 13;
  }

  // Footer Thanks
  const thanksStr = 'Thank you for shopping with us!';
  const thkW = fontRegular.widthOfTextAtSize(thanksStr, 8.5);
  page.drawText(thanksStr, { x: rx + (receiptW - thkW) / 2, y: ry, size: 8.5, font: fontRegular, color: DARK_GRAY });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Universal entry point to generate PDF for an invoice.
 */
export async function generateInvoicePdf(bill: PrintableBill): Promise<Buffer> {
  const isWholesale =
    bill.invoiceType === 'wholesale' ||
    (!bill.invoiceType && (bill.wholesale?.invoiceType === 'wholesale'));

  if (isWholesale) {
    return generateWholesaleInvoicePdf(bill);
  }
  return generateRetailInvoicePdf(bill);
}
