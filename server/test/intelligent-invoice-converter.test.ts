import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import XLSX from 'xlsx';
import { createApp } from '../src/app.ts';
import { connectDb, migrate, type DB } from '../src/db/index.ts';
import { signToken, hashPassword, passwordStamp } from '../src/security.ts';
import { validateAiExtractionPayload } from '../src/modules/invoice-converter/schemas/invoice.schema.ts';
import { resolveDittoMarks } from '../src/modules/invoice-converter/services/ai-extractor.ts';
import { validateExtractedInvoice } from '../src/modules/invoice-converter/services/data-validator.ts';
import { reconcileInvoice } from '../src/modules/invoice-converter/services/invoice-reconciler.ts';
import { matchProductsWithCatalog } from '../src/modules/invoice-converter/services/product-matcher.ts';
import { calculateSellingPriceFromRule } from '../src/modules/invoice-converter/services/product-mapper.ts';
import { generateTemplateExcel } from '../src/modules/invoice-converter/services/excel-generator.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-long-enough-32-chars-at-least';
const TEST_TENANT = 't_iic_test_' + Date.now();
const BRANCH_ID = 'b_iic_main_' + Date.now();

let db: DB;
let server: http.Server;
let base = '';
let ownerToken = '';

async function api(method: string, path: string, body?: any, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-branch-id': BRANCH_ID,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

before(async () => {
  db = await connectDb();
  await migrate(db);

  await db.exec('INSERT INTO tenants (id, name, business_type) VALUES (?, ?, ?)', [
    TEST_TENANT,
    'Surya Textiles Test',
    'retail',
  ]);
  await db.exec('INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, ?, ?, true)', [
    BRANCH_ID,
    TEST_TENANT,
    'Main Branch',
    'MAIN',
  ]);

  const pHash = hashPassword('OwnerPass123!');
  const pStamp = passwordStamp(pHash);
  const ownerId = 'u_iic_owner_' + Date.now();
  await db.exec(
    'INSERT INTO users (id, tenant_id, role, name, email, password_hash, active, branch_id) VALUES (?, ?, ?, ?, ?, ?, true, ?)',
    [ownerId, TEST_TENANT, 'owner', 'Owner Test', 'owner@iic.example.com', pHash, BRANCH_ID]
  );
  ownerToken = signToken(
    { sub: ownerId, tid: TEST_TENANT, role: 'owner', ph: pStamp, branchId: BRANCH_ID },
    JWT_SECRET,
    3600
  );

  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, sku, hsn, unit, price_minor, cost_minor, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
    ['itm_anand_80', TEST_TENANT, BRANCH_ID, 'ANAND TRUNK 80', 'AT80', '6107', 'PCS', 18000, 13500]
  );

  const app = createApp(db, { secret: JWT_SECRET });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (db) {
    await db.exec('DELETE FROM supplier_invoice_corrections WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM supplier_invoice_items WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM supplier_invoice_jobs WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM stock_moves WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM items WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM users WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM branches WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM tenants WHERE id = ?', [TEST_TENANT]);
    await db.close();
  }
  setTimeout(() => process.exit(0), 100).unref();
});

test('1. Ditto marks resolve from previous row context', () => {
  const resolved = resolveDittoMarks([
    { productName: 'ANAND TRUNK', hsnCode: '6107', sizeWeightVolume: '80', quantity: 20, unitPurchaseRate: 135, lineItemAmount: 2700 },
    { productName: '"', hsnCode: null, sizeWeightVolume: '90', quantity: 20, unitPurchaseRate: 149, lineItemAmount: 2980, isDitto: true },
    { productName: 'do', hsnCode: null, sizeWeightVolume: '95', quantity: 20, unitPurchaseRate: 167, lineItemAmount: 3340 },
  ]);
  assert.equal(resolved[0].productName, 'ANAND TRUNK');
  assert.equal(resolved[1].productName, 'ANAND TRUNK');
  assert.equal(resolved[1].hsnCode, '6107');
  assert.equal(resolved[1].isDitto, true);
  assert.equal(resolved[2].productName, 'ANAND TRUNK');
  assert.equal(resolved[2].isDitto, true);
});

test('2. Strict AI JSON schema validator rejects malformed output', () => {
  assert.equal(validateAiExtractionPayload(null).ok, false);
  assert.equal(validateAiExtractionPayload({ header: {} }).ok, false);
  const valid = validateAiExtractionPayload({
    header: { supplierName: 'ABHISHEK GARMENTS', finalInvoiceAmount: 17131 },
    items: [{ productName: 'ANAND', quantity: 20, unitPurchaseRate: 135, lineItemAmount: 2700 }],
  });
  assert.equal(valid.ok, true);
});

test('3. Selling price intelligence distinguishes markup % vs profit margin %', () => {
  assert.equal(calculateSellingPriceFromRule(100, 'markup', 25), 125);
  assert.equal(calculateSellingPriceFromRule(100, 'margin', 20), 125);
  assert.equal(calculateSellingPriceFromRule(100, 'margin', 100), null);
});

test('4. Product matcher identifies exact match vs new product', () => {
  const matched = matchProductsWithCatalog(
    [
      {
        id: '1', rowOrder: 1, name: 'ANAND TRUNK 80', uom: 'PCS', sellingPrice: '', costPrice: '135',
        hsn: '6107', gstRate: '5%', priceInclusive: 'Yes', openingStock: '20',
        brand: null, description: null, variant: null, sizeWeightVolume: '80',
        quantity: 20, boxCartonQty: null, piecesPerBox: null, unitPurchaseRate: 135, lineItemAmount: 2700,
        discountAmount: null, gstPercentage: 5, gstAmount: null, isDittoInherited: false,
        originalOcrText: null, sourcePage: 1, sourceBbox: null, fieldConfidence: {},
        reviewStatus: 'needs_review', warningMessages: [], validationErrors: [], flags: [],
        matchType: 'new_product', matchedItemId: null, matchedItemName: null, matchCandidates: [], userApproved: false,
      },
      {
        id: '2', rowOrder: 2, name: 'SAND PACK TRUNK 115', uom: 'PCS', sellingPrice: '', costPrice: '231',
        hsn: '6107', gstRate: '5%', priceInclusive: 'Yes', openingStock: '5',
        brand: null, description: null, variant: null, sizeWeightVolume: '115',
        quantity: 5, boxCartonQty: null, piecesPerBox: null, unitPurchaseRate: 231, lineItemAmount: 1155,
        discountAmount: null, gstPercentage: 5, gstAmount: null, isDittoInherited: false,
        originalOcrText: null, sourcePage: 1, sourceBbox: null, fieldConfidence: {},
        reviewStatus: 'needs_review', warningMessages: [], validationErrors: [], flags: [],
        matchType: 'new_product', matchedItemId: null, matchedItemName: null, matchCandidates: [], userApproved: false,
      },
    ],
    [{ id: 'itm_anand_80', name: 'ANAND TRUNK 80', sku: 'AT80', hsn: '6107', unit: 'PCS', priceMinor: 18000, costMinor: 13500 }]
  );
  assert.equal(matched[0].matchType, 'exact_match');
  assert.equal(matched[0].matchedItemId, 'itm_anand_80');
  assert.equal(matched[0].sellingPrice, '180.00');
  assert.equal(matched[1].matchType, 'new_product');
});

test('5. Validation & reconciliation detect math mismatches without altering supplier totals', () => {
  const header = {
    supplierName: 'ABHISHEK GARMENTS', supplierGstin: '33AINPD3002A1Z9', supplierAddress: null,
    invoiceNumber: '513', invoiceDate: '25/11/26', purchaseOrderNumber: null, deliveryOrLrNumber: null,
    billingAddress: null, shippingAddress: null, subtotal: 16315, discount: null,
    sgst: 408, cgst: 408, igst: null, otherCharges: null, roundOff: null, finalInvoiceAmount: 17131,
  };
  const items = [
    {
      id: '1', rowOrder: 1, name: 'ANAND TRUNK 80', uom: 'PCS', sellingPrice: '180', costPrice: '135',
      hsn: '6107', gstRate: '5%', priceInclusive: 'No' as const, openingStock: '20',
      brand: null, description: null, variant: null, sizeWeightVolume: null,
      quantity: 20, boxCartonQty: null, piecesPerBox: null, unitPurchaseRate: 135, lineItemAmount: 3000,
      discountAmount: null, gstPercentage: 5, gstAmount: null, isDittoInherited: false,
      originalOcrText: null, sourcePage: 1, sourceBbox: null, fieldConfidence: {},
      reviewStatus: 'needs_review' as const, warningMessages: [], validationErrors: [], flags: [],
      matchType: 'exact_match' as const, matchedItemId: 'itm_anand_80', matchedItemName: 'ANAND TRUNK 80',
      matchCandidates: [], userApproved: true,
    },
  ];
  const val = validateExtractedInvoice(header, items, new Set(['513']));
  assert.ok(val.duplicateInvoiceWarning);
  assert.equal(val.items[0].reviewStatus, 'calculation_mismatch');

  const rec = reconcileInvoice(header, val.items);
  assert.equal(rec.invoiceGrandTotal, 17131); // Never silently altered
  assert.equal(rec.isReconciled, false);
});

test('6. Exact 8-column ExcelJS output includes Price Inclusive of GST', async () => {
  const buf = await generateTemplateExcel([
    { name: 'ANAND TRUNK 80', uom: 'PCS', sellingPrice: '180', costPrice: '135', hsn: '6107', gstRate: '5%', priceInclusive: 'No', openingStock: '20' },
  ]);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  assert.deepEqual(rows[0], [
    'Product Name', 'UOM', 'Selling Price', 'Cost Price', 'HSN', 'GST Rate', 'Price Inclusive of GST', 'Opening Stock',
  ]);
  assert.equal(rows[1][6], 'No');
  assert.equal(rows[1][7], 20);
});

test('7. End-to-end API pipeline: upload -> extract -> update -> export -> import -> history', async () => {
  const capRes = await api('GET', '/api/invoices/capabilities', undefined, ownerToken);
  assert.equal(capRes.status, 200);
  assert.equal(capRes.json.capabilities.localPreprocessing, true);

  const sampleTxt = [
    'TAX INVOICE',
    'ABHISHEK GARMENTS',
    'GSTIN: 33AINPD3002A1Z9',
    'Invoice No: 513 Date: 25/11/2026',
    'Description | HSN | Qty | Rate | Amount',
    'ANAND TRUNK 80 | 6107 | 20 | 135.00 | 2700.00',
    'Grand Total: 2700.00',
  ].join('\n');

  const upRes = await api(
    'POST',
    '/api/invoices/upload',
    {
      fileName: 'abhishek.txt',
      mimeType: 'text/plain',
      fileData: Buffer.from(sampleTxt, 'utf8').toString('base64'),
    },
    ownerToken
  );
  assert.equal(upRes.status, 200);
  const jobId = upRes.json.jobId;
  assert.ok(jobId);

  const extRes = await api('POST', `/api/invoices/${jobId}/extract`, {}, ownerToken);
  assert.equal(extRes.status, 200);
  assert.equal(extRes.json.ok, true);
  assert.ok(Array.isArray(extRes.json.items));

  const approvedItems = [
    {
      id: 'inv-item-1',
      rowOrder: 1,
      name: 'ANAND TRUNK 80',
      uom: 'PCS',
      sellingPrice: '180.00',
      costPrice: '135.00',
      hsn: '6107',
      gstRate: '5%',
      priceInclusive: 'Yes',
      openingStock: '20',
      userApproved: true,
      matchType: 'exact_match',
      matchedItemId: 'itm_anand_80',
    },
  ];
  const putRes = await api('PUT', `/api/invoices/${jobId}/items`, { items: approvedItems }, ownerToken);
  assert.equal(putRes.status, 200);

  const impRes = await api('POST', `/api/invoices/${jobId}/import`, { items: approvedItems }, ownerToken);
  assert.equal(impRes.status, 200);
  assert.equal(impRes.json.restocked, 1);

  const histRes = await api('GET', '/api/supplier-invoices/history', undefined, ownerToken);
  assert.equal(histRes.status, 200);
  assert.ok(histRes.json.jobs.length >= 1);
});
