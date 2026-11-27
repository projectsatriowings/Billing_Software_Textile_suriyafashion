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
