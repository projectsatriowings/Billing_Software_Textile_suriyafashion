import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanInvoiceProductName,
  detectTableColumns,
  isValidProductRow,
  parseLineItems,
  parseQtyRateAmountRow,
} from '../src/services/supplierInvoiceParser.ts';
import { normalizeAiLineItems, resolveDittoMarks } from '../src/modules/invoice-converter/services/ai-extractor.ts';
import { suggestCategory } from '../../shared/bulkImport.ts';

// OCR text of a handwritten garment invoice (SL | PARTICULARS | HSN / CODE | SIZE | BOX | PCS | RATE | AMOUNT)
// with a header line OCR could not read and a footnote section after the table.
const GARMENT_OCR = `ITEM DETAILS
Transcribed from the handwritten supplier invoice
[0 ewemcuans HSN / cope see Joon fees | RATE) | AMOUNT (0)
1 ANAND Unclear in source 80 2 20 135 2,700
2 ANAND (ditto) Ditto / unclear 90 2 20 149 2,980
3 ANAND (ditto) Ditto / unclear 95 2 20 167 3,340
4 ANAND VEST “Raw colour”* 80 1 10 96 960
5 ANAND VEST (ditto) Ditto / unclear 85 2 20 110 2,200
6 Possibly “Shiva Pack Tom” * Unclear 85 2 20 149 2,980
7 Possibly “Shiva Pack Tom”* Unclear 115 1 5 231 1,155
NOTES SUBTOTAL %16,315.00
* Product / HSN handwriting is unclear in places; verify against original SGST 2.50% 3408.00
Amounts and quantities are transcribed as visible on the source invoice.
CGST 2.50% 408.00`;

function fourCols(items: { name: string; size?: string; costPrice: string; openingStock: string }[]) {
  return items.map((p) => [p.name, p.size || '', p.costPrice, p.openingStock]);
}

test('Local parser: SIZE / BOX / PCS / RATE garment rows map to Product Name, Size, Cost, Stock', () => {
  const { headers, columnMap, dataLines } = detectTableColumns(GARMENT_OCR.split('\n'));
  const items = parseLineItems(dataLines, columnMap, headers).filter(isValidProductRow);
  assert.deepEqual(fourCols(items), [
    ['ANAND', '80', '135.00', '20'],
    ['ANAND', '90', '149.00', '20'],
    ['ANAND', '95', '167.00', '20'],
    ['ANAND VEST', '80', '96.00', '10'],
    ['ANAND VEST', '85', '110.00', '20'],
    ['Shiva Pack Tom', '85', '149.00', '20'],
    ['Shiva Pack Tom', '115', '231.00', '5'],
  ]);
});

test('Local parser: letter sizes, Free Size and ditto quote marks', () => {
  const lines = [
    'SL PARTICULARS SIZE BOX PCS RATE AMOUNT',
    '1 Cotton Shirt M 2 20 150 3000',
    '2 " XL 1 10 160 1,600',
    '3 Kids Frock Free Size 1 12 99 1188',
    '4 Track Pant 30 1 8 210 1680',
    '5 Kids Top 8 1 10 90 900',
  ];
  const { headers, columnMap, dataLines } = detectTableColumns(lines);
  const items = parseLineItems(dataLines, columnMap, headers).filter(isValidProductRow);
  assert.deepEqual(fourCols(items), [
    ['Cotton Shirt', 'M', '150.00', '20'],
    ['Cotton Shirt', 'XL', '160.00', '10'],
    ['Kids Frock', 'Free Size', '99.00', '12'],
    ['Track Pant', '30', '210.00', '8'],
    ['Kids Top', '8', '90.00', '10'],
  ]);
});

test('parseQtyRateAmountRow leaves plain qty / rate / amount rows to the generic parser', () => {
  assert.equal(parseQtyRateAmountRow('Aashirvaad Atta 5kg 1006 20 bag 235.00 4700.00'), null);
  assert.equal(parseQtyRateAmountRow('Shirt 20 135 2700'), null);
  assert.equal(parseQtyRateAmountRow('* Product / HSN handwriting is unclear 2 3 6'), null);
});

test('cleanInvoiceProductName strips HSN-column notes, ditto markers and footnote quotes', () => {
  assert.equal(cleanInvoiceProductName('ANAND Unclear in source'), 'ANAND');
  assert.equal(cleanInvoiceProductName('ANAND (ditto) Ditto / unclear'), 'ANAND');
  assert.equal(cleanInvoiceProductName('ANAND VEST “Raw colour”*'), 'ANAND VEST');
  assert.equal(cleanInvoiceProductName('Possibly “Shiva Pack Tom” * Unclear'), 'Shiva Pack Tom');
});

test('AI normalizer repairs size-as-quantity and amount ÷ size cost, drops footnotes', () => {
  const items = resolveDittoMarks(
    normalizeAiLineItems([
      // Gemini mistakes: size 80 used as quantity, rate = 2700 / 80
      { productName: 'ANAND Unclear in source', sizeWeightVolume: '80', boxCartonQty: 2, piecesPerBox: 20, quantity: 80, unitPurchaseRate: 33.75, lineItemAmount: 2700 },
      // Correct rate, wrong quantity
      { productName: '"', sizeWeightVolume: '90', boxCartonQty: 2, quantity: 90, unitPurchaseRate: 149, lineItemAmount: 2980, isDitto: true },
      { productName: 'Cotton Shirt', sizeWeightVolume: 'M', quantity: 20, unitPurchaseRate: 150, lineItemAmount: 3000, hsnCode: 'Unclear' },
      { productName: '* Product / HSN handwriting is unclear in places', quantity: null, unitPurchaseRate: null, lineItemAmount: null },
    ])
  );
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((i) => [i.productName, i.sizeWeightVolume, i.unitPurchaseRate, i.quantity, i.hsnCode]),
    [
      ['ANAND', '80', 135, 20, null],
      ['ANAND', '90', 149, 20, null],
      ['Cotton Shirt', 'M', 150, 20, null],
    ]
  );
});

test('Local parser: separates HSN from product name for letter, numeric, and Free Size rows', () => {
  const lines = [
    'SL PARTICULARS HSN SIZE PCS RATE AMOUNT',
    "1 Men's Cotton Formal Shirt 6205 M 25 350.00 8750.00",
    '2 Boys Denim Shorts 6203 30 30 180.00 5400.00',
    '3 5L Plastic Storage Container 3924 Free Size 20 110.00 2200.00',
  ];
  const { headers, columnMap, dataLines } = detectTableColumns(lines);
  const items = parseLineItems(dataLines, columnMap, headers).filter(isValidProductRow);
  assert.deepEqual(
    items.map((p) => [p.name, p.hsn || '', p.size || '', p.costPrice, p.openingStock]),
    [
      ["Men's Cotton Formal Shirt", '6205', 'M', '350.00', '25'],
      ['Boys Denim Shorts', '6203', '30', '180.00', '30'],
      ['5L Plastic Storage Container', '3924', 'Free Size', '110.00', '20'],
    ]
  );
});

test('suggestCategory matches by first+last word, last word, and first word', () => {
  const cats = [
    { id: 'c1', name: "MEN'S WEAR" },
    { id: 'c2', name: 'SHORTS' },
    { id: 'c3', name: 'KURTIS' },
    { id: 'c4', name: 'SHIRTS' },
    { id: 'c5', name: "MEN'S SLIPPERS" },
    { id: 'c6', name: 'PLASTIC' },
  ];

  assert.equal(suggestCategory("Men's Cotton Formal Shirt", cats)?.name, 'SHIRTS');
  assert.equal(suggestCategory("Men's Rubber Slippers", cats)?.name, "MEN'S SLIPPERS");
  assert.equal(suggestCategory('Floral Printed Kurti', cats)?.name, 'KURTIS');
  assert.equal(suggestCategory('Boys Denim Shorts', cats)?.name, 'SHORTS');
  assert.equal(suggestCategory('5L Plastic Storage Container', cats)?.name, 'PLASTIC');
  assert.equal(suggestCategory("Men's Formal Blazer", cats)?.name, "MEN'S WEAR");

  // When both "SHIRTS" and "MEN'S SHIRTS" exist, first+last word picks "MEN'S SHIRTS"
  const withMensShirts = [...cats, { id: 'c7', name: "MEN'S SHIRTS" }];
  assert.equal(suggestCategory("Men's Cotton Formal Shirt", withMensShirts)?.name, "MEN'S SHIRTS");
});

function parseOcr(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const { headers, columnMap, dataLines } = detectTableColumns(lines);
  return parseLineItems(dataLines, columnMap, headers)
    .filter(isValidProductRow)
    .map((p) => [p.name, p.hsn, p.uom, p.costPrice, p.openingStock]);
}

test('Generic bill: unreadable header, "N/A" HSN, Rate before Qty, terms text never becomes a product', () => {
  // Tesseract output of a coloured "Textiles Invoice" (S No | Products | HSN | Units | Rate | Qty | Amount)
  const ocr = `Textiles Invoice
Billed By Bifling To Invoice No: 1ala/2026/0074
Elegant Textiles & Garments Pvt. Lid. Chittwa Date 1 18/06/2020
sales@elegantiextiles.com 1234507890
1 Premium Cotton Saree N/A pcs 2200 1 ¥ 2,200.00
Sub Total : ¥ 2,200.00
GST@18% ¥ 396.00
Invoice Total : ¥ 2,596.00
Account Number : 787097900754
- Terms ana conditons (T&Cs) sre 3 egal binding contract between = 5
For Elegant Textiles & Garmems Pvt. Ltd.
Thank You`;
  assert.deepEqual(parseOcr(ocr), [['Premium Cotton Saree', '', 'pcs', '2200.00', '1']]);
});

test('Generic bill: header with Qty before Rate, real HSN codes, several rows', () => {
  const ocr = `S.No Description HSN Qty Unit Rate Amount
1 Cotton Bag 6305 10 pcs 45.00 450.00
2 Silk Dupatta 5007 4 nos 350 1400
3 Linen Fabric 5309 12.5 mtr 220 2750
Total 4600`;
  assert.deepEqual(parseOcr(ocr), [
    ['Cotton Bag', '6305', 'pcs', '45.00', '10'],
    ['Silk Dupatta', '5007', 'nos', '350.00', '4'],
    ['Linen Fabric', '5309', 'mtr', '220.00', '12.5'],
  ]);
});
