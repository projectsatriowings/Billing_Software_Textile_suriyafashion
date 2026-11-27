import { requirePerm } from '../auth.ts';
import { resolveBranchScope } from '../branchScope.ts';
import { bad, conflict, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { audit } from '../audit.ts';
import { generateUniqueShortSku, generateUniqueInternalBarcode, parseImportNumeric } from '../../../shared/bulkImport.ts';
import { syncItemStockStatus } from '../services/stockStatus.ts';

// ── Supported GST rates (basis points) ──────────────────────────────────────
const VALID_GST_RATES_BP = new Set([0, 250, 500, 1200, 1800, 2800]);

export interface AdditionalBarcode {
  barcode: string;
  barcodeType?: 'INTERNAL' | 'MANUFACTURER' | null;
}

export interface BulkImportRow {
  name: string;
  sku?: string | null;
  barcode?: string | null;
  barcodeType?: 'INTERNAL' | 'MANUFACTURER' | null;
  additionalBarcodes?: (string | AdditionalBarcode)[] | null;
  productNature?: 'BRANDED' | 'SHOP_PRODUCT' | null;
  productType?: 'retail' | 'wholesale' | 'Retail' | 'Wholesale' | string | null;
  size?: string | null;
  colour?: string | null;
  purchaseDate?: string | null;
  material?: string | null;
  designPattern?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  hsn?: string | null;
  unit?: string | null;
  categoryId?: string | null;
  category?: string | null;
  subcategoryId?: string | null;
  subcategory?: string | null;
  priceMinor: number;          // selling price in paise
  costMinor?: number | null;
  mrpMinor?: number | null;
  offerPercentage?: number | null;
  supplierId?: string | null;
  supplier?: string | null;
  taxRateBp?: number | null;
  taxInclusive?: boolean | null;
  openingQtyMilli?: number | null; // quantity supplied in this import
  reorderMilli?: number | null;
  reorderLevel?: number | null;
  parentProductId?: string | null;

  // Restock & matching fields
  isRestock?: boolean;
  matchedItemId?: string | null;
  updatePrices?: boolean;
}

interface ValidatedRow extends Omit<BulkImportRow, 'additionalBarcodes'> {
  _rowIndex: number;            // 1-based
  additionalBarcodes?: { barcode: string; barcodeType: 'INTERNAL' | 'MANUFACTURER' }[];
  imageUrl?: string | null;
  reorderMilli?: number | null;
}

interface RowResult {
  rowIndex: number;
  status: 'created' | 'restocked' | 'skipped';
  name?: string;
  itemId?: string;
  reason?: string;
}

/** Coerce a value to number or null (handles direct numbers, formatted strings with commas/lakhs, etc.). */
function toNum(v: unknown): number | null {
  return parseImportNumeric(v);
}

/** Trim string or return null. */
function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Validate a single raw row from the payload.
 * Returns { errors } when invalid, or { row } when valid.
 */
function validateRow(raw: Record<string, unknown>, rowIndex: number): { errors: string[] } | { row: ValidatedRow } {
  const errors: string[] = [];

  const name = toStr(raw.name);
  if (!name) errors.push('Product name is required');
  else if (name.length > 120) errors.push('Product name is too long (max 120 characters)');

  const priceRaw = toNum(raw.priceMinor);
  if (priceRaw === null) errors.push('Selling price is required and must be a number');
  else if (priceRaw < 0) errors.push('Selling price cannot be negative');

  const costRaw = toNum(raw.costMinor);
  if (costRaw !== null && costRaw < 0) errors.push('Cost price cannot be negative');

  const openingQtyRaw = toNum(raw.openingQtyMilli ?? raw.openingStockMilli);
  if (openingQtyRaw !== null && openingQtyRaw < 0) errors.push('Stock quantity cannot be negative');

  const reorderRaw = toNum(raw.reorderMilli ?? raw.reorderLevel);
  if (reorderRaw !== null && reorderRaw < 0) errors.push('Reorder level cannot be negative');

  const taxRateBpRaw = toNum(raw.taxRateBp);
  if (taxRateBpRaw !== null && !VALID_GST_RATES_BP.has(taxRateBpRaw)) {
    errors.push(`GST rate ${(taxRateBpRaw / 100).toFixed(1)}% is not a supported rate (valid: 0%, 2.5%, 5%, 12%, 18%, 28%)`);
  }

  const sku = toStr(raw.sku);
  if (sku && sku.length > 60) errors.push('SKU is too long (max 60 characters)');

  let barcode = toStr(raw.barcode);
  let imageUrl = toStr(raw.imageUrl);

  // If barcode is a Drive link or web URL, move it to imageUrl and clear barcode
  if (barcode && (/^https?:\/\//i.test(barcode) || /drive\.google\.com/i.test(barcode) || /googleusercontent\.com/i.test(barcode))) {
    if (!imageUrl) imageUrl = barcode;
    barcode = null;
  }
  if (barcode && barcode.length > 60) errors.push('Barcode is too long (max 60 characters)');

  const rawBarcodeType = toStr(raw.barcodeType);
  const barcodeType: 'INTERNAL' | 'MANUFACTURER' | null =
    rawBarcodeType === 'INTERNAL' || rawBarcodeType === 'MANUFACTURER'
      ? rawBarcodeType
      : null;

  const SCIENTIFIC_NOTATION_RE = /^[0-9]+(\.[0-9]+)?[eE]\+[0-9]+$/;
  if (barcode && SCIENTIFIC_NOTATION_RE.test(barcode)) {
    errors.push('Barcode looks like Excel scientific notation (e.g. 8.9E+12). Format the column as Text and re-export.');
  }
  if (sku && SCIENTIFIC_NOTATION_RE.test(sku)) {
    errors.push('SKU looks like Excel scientific notation. Format the column as Text and re-export.');
  }

  const hsn = toStr(raw.hsn);
  if (hsn && hsn.length > 20) errors.push('HSN code is too long (max 20 characters)');

  const categoryId = toStr(raw.categoryId);
  const category = toStr(raw.category);
  if (category && category.length > 60) errors.push('Category name is too long (max 60 characters)');

  const unit = toStr(raw.unit) || 'pcs';
  if (unit.length > 20) errors.push('Unit is too long (max 20 characters)');

  const isRestock = Boolean(raw.isRestock || raw.matchedItemId);
  const matchedItemId = toStr(raw.matchedItemId);
  if (isRestock && !matchedItemId) {
    errors.push('Matched product ID is required for restock');
  }

  const additionalBarcodes: { barcode: string; barcodeType: 'INTERNAL' | 'MANUFACTURER' }[] = [];
  if (Array.isArray(raw.additionalBarcodes)) {
    for (const item of raw.additionalBarcodes) {
      if (!item) continue;
      const bStr = typeof item === 'string' ? toStr(item) : toStr((item as any).barcode);
      if (!bStr) continue;
      if (bStr.length > 60) {
        errors.push(`Additional barcode "${bStr}" is too long (max 60 characters)`);
      }
      const bTypeStr = typeof item === 'object' && item !== null ? toStr((item as any).barcodeType) : null;
      const bType: 'INTERNAL' | 'MANUFACTURER' =
        bTypeStr === 'INTERNAL' || bTypeStr === 'MANUFACTURER'
          ? bTypeStr
          : (bStr.startsWith('20') && bStr.length === 13 ? 'INTERNAL' : 'MANUFACTURER');
      additionalBarcodes.push({ barcode: bStr, barcodeType: bType });
    }
  }

  const rawNature = toStr(raw.productNature);
  const productNature: 'BRANDED' | 'SHOP_PRODUCT' | null =
    rawNature === 'BRANDED' || rawNature === 'SHOP_PRODUCT' ? rawNature : null;

  const rawProductType = toStr(raw.productType);
  const productType = rawProductType && rawProductType.toLowerCase() === 'wholesale' ? 'wholesale' : 'retail';
  const size = toStr(raw.size);
  const colour = toStr(raw.colour ?? (raw as any).color);
  const material = toStr(raw.material);
  const designPattern = toStr(raw.designPattern ?? raw.design_pattern);
  const description = toStr(raw.description);
  const mrpRaw = toNum(raw.mrpMinor ?? raw.mrp);
  const mrpMinor = mrpRaw !== null && mrpRaw >= 0 ? Math.round(mrpRaw) : Math.round(priceRaw!);
  const offerRaw = toNum(raw.offerPercentage ?? raw.offer_percentage ?? raw.offer);
  const offerPercentage = offerRaw !== null ? Math.max(0, Math.min(100, offerRaw)) : 0;
  const subcategoryId = toStr(raw.subcategoryId);
  const subcategory = toStr(raw.subcategory);
  const supplierId = toStr(raw.supplierId ?? raw.supplier_id);
  const supplier = toStr(raw.supplier ?? raw.supplierName);
  const parentProductId = toStr(raw.parentProductId ?? raw.parent_product_id);
  const purchaseDate = toStr(raw.purchaseDate ?? raw.purchase_date);

  if (errors.length > 0) return { errors };

  return {
    row: {
      _rowIndex: rowIndex,
      name: name!,
      sku,
      barcode,
      barcodeType,
      additionalBarcodes,
      productNature,
      productType,
      size,
      colour: colour || null,
      material,
      designPattern,
      description,
      mrpMinor,
      offerPercentage,
      subcategoryId,
      subcategory,
      supplierId,
      supplier,
      parentProductId,
      purchaseDate: purchaseDate || null,
      hsn,
      unit,
      categoryId,
      category,
      priceMinor: Math.round(priceRaw!),
      costMinor: costRaw !== null ? Math.round(costRaw) : 0,
      taxRateBp: taxRateBpRaw ?? 0,
      taxInclusive: false,
      openingQtyMilli: openingQtyRaw !== null ? Math.round(openingQtyRaw) : 0,
      reorderMilli: reorderRaw !== null ? Math.round(reorderRaw) : null,
      isRestock,
      matchedItemId,
      updatePrices: Boolean(raw.updatePrices),
      imageUrl: imageUrl || null,
    },
  };
}

export function registerItemsBulk(r: Router) {
  /**
   * POST /api/items/bulk-import
   *
   * Body: {
   *   importBatchId?: string,
   *   rows: BulkImportRow[]
   * }
   * Returns: { importId, totalRows, created, restocked, skipped: results.filter((r) => r.status === 'skipped').length, results: RowResult[] }
   *
   * Each row is processed inside a single shared transaction.
   * New products receive unique SKUs & internal barcodes if not provided.
   * Restocks add incoming quantity to existing stock and reuse existing product IDs & SKUs.
   * Missing categories are created safely.
   */
  r.post('/api/items/bulk-import', requirePerm('items.write'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const rawBranch = (typeof b.branchId === 'string' && b.branchId.trim()) ? b.branchId.trim() : scope.branchId;
    let branchId = scope.branchId;
    if (rawBranch && rawBranch.toLowerCase() !== 'all') {
      const br = await ctx.db.one<{ id: string }>(
        'SELECT id FROM branches WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND deleted_at IS NULL LIMIT 1',
        [tenantId, rawBranch, rawBranch],
      );
      if (br) branchId = br.id;
    }
    if (!branchId) {
      const fallbackBr = await ctx.db.one<{ id: string }>(
        "SELECT id FROM branches WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY (code = 'MAIN') DESC, created_at ASC LIMIT 1",
        [tenantId],
      );
      branchId = fallbackBr?.id || null;
    }
    if (!branchId) throw bad('Branch is required for bulk product import', 'BRANCH_REQUIRED');

    if (!Array.isArray(b.rows)) throw bad('rows must be an array', 'VALIDATION', { field: 'rows' });
    if (b.rows.length === 0) throw bad('rows array is empty', 'VALIDATION', { field: 'rows' });
    if (b.rows.length > 500) throw bad('Cannot import more than 500 products at a time', 'VALIDATION', { field: 'rows' });

    // ── Supplier validation (Optional) ────────
    const supplierId = toStr(b.supplierId || b.partyId);
    let supplier: { id: string; name: string; type: string; active: boolean; gstin: string | null } | null = null;
    if (supplierId) {
      supplier = (await ctx.db.one<{ id: string; name: string; type: string; active: boolean; gstin: string | null }>(
        `SELECT id, name, type, active, gstin FROM parties WHERE id = ? AND tenant_id = ? AND type = 'supplier'`,
        [supplierId, tenantId],
      )) ?? null;
      if (!supplier) {
        throw bad('Selected supplier was not found or is invalid', 'VALIDATION', { field: 'supplierId' });
      }
      if (!supplier.active) {
        throw bad(`Supplier "${supplier.name}" is deactivated. Please select an active supplier.`, 'VALIDATION', { field: 'supplierId' });
      }
    }

    // ── Idempotency check ───────────────────────────────────────────────────
    const importBatchId = b.importBatchId ? String(b.importBatchId).trim() : null;
    if (importBatchId) {
      const existingImport = await ctx.db.one<{ id: string; status: string }>(
        `SELECT id, status FROM imports WHERE id = ? AND tenant_id = ? AND status = 'committed'`,
        [importBatchId, tenantId],
      );
      if (existingImport) {
        throw conflict('This import batch has already been processed and committed.', 'CONFLICT', { importBatchId });
      }
    }
    const importId = importBatchId || newId('imp');

    // ── Step 1: Validate all rows up-front ──────────────────────────────────
    const validRows: ValidatedRow[] = [];
    const results: RowResult[] = [];

    for (let i = 0; i < b.rows.length; i++) {
      const raw = b.rows[i];
      if (typeof raw !== 'object' || raw === null) {
        results.push({ rowIndex: i + 1, status: 'skipped', reason: 'Row is not a valid object' });
        continue;
      }
      const validated = validateRow(raw as Record<string, unknown>, i + 1);
      if ('errors' in validated) {
        results.push({ rowIndex: i + 1, status: 'skipped', name: toStr((raw as any).name) ?? undefined, reason: validated.errors.join('; ') });
      } else {
        validRows.push(validated.row);
      }
    }

    // ── Step 2: Category Resolution & Subcategory Auto-Mapping ──────────────
    const categoryIds = [...new Set(validRows.map((r) => r.categoryId).filter(Boolean))] as string[];
    const categoryNames = [...new Set(validRows.map((r) => r.category).filter(Boolean))] as string[];
    const catById = new Map<string, { id: string; name: string; active: boolean }>();
    const catByName = new Map<string, { id: string; name: string; active: boolean }>();

    if (categoryIds.length > 0) {
      const placeholders = categoryIds.map(() => '?').join(', ');
      const cats = await ctx.db.query<{ id: string; name: string; active: boolean }>(
        `SELECT id, name, active FROM categories WHERE tenant_id = ? AND id IN (${placeholders})`,
        [tenantId, ...categoryIds],
      );
      for (const c of cats) {
        catById.set(c.id, c);
        catByName.set(c.name.toLowerCase(), c);
      }
    }

    if (categoryNames.length > 0) {
      const placeholders = categoryNames.map(() => '?').join(', ');
      const cats = await ctx.db.query<{ id: string; name: string; active: boolean }>(
        `SELECT id, name, active FROM categories WHERE tenant_id = ? AND lower(name) IN (${placeholders})`,
        [tenantId, ...categoryNames.map((c) => c.toLowerCase())],
      );
      for (const c of cats) {
        catById.set(c.id, c);
        catByName.set(c.name.toLowerCase(), c);
      }
    }

    const rowsReady: ValidatedRow[] = [];
    for (const row of validRows) {
      if (row.categoryId) {
        const resolved = catById.get(row.categoryId);
        if (resolved && resolved.active) {
          row.categoryId = resolved.id;
          row.category = resolved.name;
        }
      } else if (row.category) {
        const resolved = catByName.get(row.category.toLowerCase());
        if (resolved && resolved.active) {
          row.categoryId = resolved.id;
          row.category = resolved.name;
        } else {
          const catName = row.category.trim();
          const newCatId = newId('cat');
          try {
            const existingCat = await ctx.db.one<{ id: string; name: string; active: boolean }>(
              'SELECT id, name, active FROM categories WHERE tenant_id = ? AND branch_id = ? AND lower(name) = lower(?)',
              [tenantId, branchId, catName],
            );
            if (existingCat) {
              row.categoryId = existingCat.id;
              row.category = existingCat.name;
              catById.set(existingCat.id, existingCat);
              catByName.set(catName.toLowerCase(), existingCat);
            } else {
              await ctx.db.exec(
                'INSERT INTO categories (id, tenant_id, branch_id, name, active) VALUES (?, ?, ?, ?, true)',
                [newCatId, tenantId, branchId, catName],
              );
              const createdCat = { id: newCatId, name: catName, active: true };
              catById.set(newCatId, createdCat);
              catByName.set(catName.toLowerCase(), createdCat);
              row.categoryId = newCatId;
              row.category = catName;
            }
          } catch {
            // ignore
          }
        }
      }
      rowsReady.push(row);
    }

    // ── Step 3: Intra-batch Barcode & Variant Duplicate Checks ────────────────
    const barcodesInPayload = new Map<string, number>();
    const variantsInPayload = new Map<string, number>(); // normName:normSize -> rowIndex
    const deduplicatedRows: ValidatedRow[] = [];

    for (const row of rowsReady) {
      const normName = row.name.trim().toLowerCase();
      const normSize = (row.size || '').trim().toLowerCase() || 'free size';
      const varKey = `${normName}:${normSize}`;

      if (variantsInPayload.has(varKey)) {
        const first = variantsInPayload.get(varKey)!;
        results.push({
          rowIndex: row._rowIndex,
          status: 'skipped',
          name: row.name,
          reason: `Duplicate variant "${row.size || 'Free Size'}" for product "${row.name}" — already present in row ${first}`,
        });
        continue;
      }
      variantsInPayload.set(varKey, row._rowIndex);

      if (row.barcode) {
        const bc = row.barcode.trim();
        if (barcodesInPayload.has(bc)) {
          const first = barcodesInPayload.get(bc)!;
          results.push({
            rowIndex: row._rowIndex,
            status: 'skipped',
            name: row.name,
            reason: `Duplicate barcode "${bc}" — already present in row ${first}`,
          });
          continue;
        }
        barcodesInPayload.set(bc, row._rowIndex);
      }
      deduplicatedRows.push(row);
    }

    // ── Step 4: Get warehouse location & setup collision checkers ─────────────
    let firstLocation = 'MAIN';
    const shop = await ctx.db.one<{ locations: unknown }>('SELECT locations FROM tenants WHERE id = ?', [tenantId]);
    if (shop?.locations) {
      const locs = typeof shop.locations === 'string' ? JSON.parse(shop.locations) : shop.locations;
      if (Array.isArray(locs) && locs.length > 0 && typeof locs[0] === 'string' && locs[0].trim()) {
        firstLocation = locs[0].trim();
      }
    }

    const allBranchSkus = new Set(
      (await ctx.db.query<{ sku: string }>('SELECT lower(sku) as sku FROM items WHERE tenant_id = ? AND branch_id = ? AND sku IS NOT NULL', [tenantId, branchId]))
        .map((r) => r.sku)
    );
    const seenImportSkus = new Set<string>();

    const allBranchBarcodes = new Set(
      (await ctx.db.query<{ barcode: string }>(
        `SELECT barcode FROM items WHERE tenant_id = ? AND branch_id = ? AND barcode IS NOT NULL AND (barcode LIKE '20%' OR length(barcode) = 13)
         UNION
         SELECT barcode FROM product_barcodes WHERE tenant_id = ? AND branch_id = ? AND (barcode_type = 'INTERNAL' OR (barcode LIKE '20%' OR length(barcode) = 13))
         UNION
         SELECT barcode FROM variants WHERE tenant_id = ? AND barcode IS NOT NULL AND (barcode LIKE '20%' OR length(barcode) = 13)`,
        [tenantId, branchId, tenantId, branchId, tenantId],
      )).map((r) => r.barcode)
    );
    const seenImportBarcodes = new Set<string>();

    // ── Step 5: Atomic transaction for Parent Products & Variant Matrix ───────
    let created = 0;
    let restocked = 0;
    let barcodesSaved = 0;
    let purchaseId: string | null = null;
    let purchaseNumber: string | null = null;
    let purchaseSubtotal = 0;
    let purchaseTaxable = 0;
    let purchaseTax = 0;
    let purchaseCgst = 0;
    let purchaseSgst = 0;
    let purchaseTotal = 0;
    let purchaseLinesCount = 0;

    await ctx.db.tx(async (q) => {
      // Create purchase header if supplier selected
      if (supplier) {
        purchaseId = newId('pur');
        const countRow = await q.one<{ count: string }>('SELECT count(*)::text as count FROM purchases WHERE tenant_id = ?', [tenantId]);
        const nextNum = (parseInt(countRow?.count || '0', 10) + 1).toString().padStart(4, '0');
        purchaseNumber = `PO-IMP-${nextNum}`;
        const todayStr = new Date().toISOString().slice(0, 10);
        await q.exec(
          `INSERT INTO purchases (
            id, tenant_id, branch_id, purchase_number, supplier_id,
            supplier_invoice_number, bdate, purchase_date, status,
            subtotal_minor, taxable_minor, tax_minor, cgst_minor, sgst_minor, igst_minor,
            total_minor, paid_minor, balance_minor, note, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', 0, 0, 0, 0, 0, 0, 0, 0, 0, 'Generated from Bulk Product Import', ?)`,
          [purchaseId, tenantId, branchId, purchaseNumber, supplier.id, importId, todayStr, todayStr, ctx.user!.id],
        );
      }

      // In-memory cache for Parent Products within this transaction:
      // key: normalized parent product name -> { id, sku, isNew }
      const resolvedParents = new Map<string, { id: string; name: string; sku: string; isNew: boolean }>();
      const affectedParentIds = new Set<string>();

      for (const row of deduplicatedRows) {
        await q.exec('SAVEPOINT sp_bulk_variant_row');
        try {
          const normParentName = row.name.trim().toLowerCase();
          const normSize = (row.size || '').trim() || 'Free Size';

          // 1. Resolve or Create Parent Product in `items` table
          let parentInfo = resolvedParents.get(normParentName);
          if (!parentInfo) {
            // Check if matching parent product already exists in database:
            let existingParent = await q.one<{ id: string; name: string; sku: string | null }>(
              'SELECT id, name, sku FROM items WHERE tenant_id = ? AND lower(trim(name)) = ? LIMIT 1',
              [tenantId, normParentName],
            );

            // If not found by name, check if barcode matches an existing variant or item
            if (!existingParent && row.barcode) {
              const byBc = await q.one<{ product_id: string }>(
                'SELECT product_id FROM variants WHERE tenant_id = ? AND barcode = ? LIMIT 1',
                [tenantId, row.barcode.trim()],
              );
              if (byBc) {
                existingParent = await q.one<{ id: string; name: string; sku: string | null }>(
                  'SELECT id, name, sku FROM items WHERE tenant_id = ? AND id = ? LIMIT 1',
                  [tenantId, byBc.product_id],
                );
              }
            }

            if (existingParent) {
              const parentId = existingParent.id;
              // Ensure parent product is marked as variant type and update common metadata if provided
              await q.exec(
                `UPDATE items
                 SET item_type = 'variant',
                     category_id = COALESCE(?, category_id),
                     subcategory_id = COALESCE(?, subcategory_id),
                     product_type = COALESCE(NULLIF(?, ''), product_type),
                     material = COALESCE(NULLIF(?, ''), material),
                     design_pattern = COALESCE(NULLIF(?, ''), design_pattern),
                     description = COALESCE(NULLIF(?, ''), description),
                     image_url = COALESCE(NULLIF(?, ''), image_url),
                     preferred_supplier_id = COALESCE(preferred_supplier_id, ?),
                     updated_at = now()
                 WHERE id = ? AND tenant_id = ?`,
                [
                  row.categoryId || null,
                  row.subcategoryId || null,
                  row.productType || null,
                  row.material || null,
                  row.designPattern || null,
                  row.description || null,
                  row.imageUrl || null,
                  supplierId || null,
                  parentId,
                  tenantId,
                ],
              );
              parentInfo = { id: parentId, name: existingParent.name, sku: existingParent.sku || '', isNew: false };
            } else {
              // Create NEW Parent Product in `items` table
              const parentId = newId('item');
              let parentSku = row.sku && row.sku.trim() ? row.sku.trim() : generateUniqueShortSku(row.name, allBranchSkus, seenImportSkus);
              allBranchSkus.add(parentSku.toLowerCase());
              seenImportSkus.add(parentSku);

              await q.exec(
                `INSERT INTO items (
                  id, tenant_id, branch_id, name, sku, category_id, subcategory_id,
                  product_type, material, design_pattern, description, item_type,
                  price_minor, cost_minor, mrp_minor, offer_percentage, tax_rate_bp,
                  tax_inclusive, track_stock, reorder_milli, preferred_supplier_id,
                  active, image_url, purchase_date, imported_date, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'variant', ?, ?, ?, ?, ?, false, true, ?, ?, true, ?, ?, now(), now(), now())`,
                [
                  parentId,
                  tenantId,
                  branchId,
                  row.name.trim(),
                  parentSku,
                  row.categoryId || null,
                  row.subcategoryId || null,
                  row.productType || 'Retail',
                  row.material || null,
                  row.designPattern || null,
                  row.description || null,
                  row.priceMinor,
                  row.costMinor ?? 0,
                  row.mrpMinor ?? row.priceMinor,
                  row.offerPercentage ?? 0,
                  row.taxRateBp ?? 0,
                  row.reorderMilli ?? 0,
                  supplierId || null,
                  row.imageUrl || null,
                  row.purchaseDate || new Date().toISOString().slice(0, 10),
                ],
              );
              parentInfo = { id: parentId, name: row.name.trim(), sku: parentSku, isNew: true };
            }
            resolvedParents.set(normParentName, parentInfo);
          }

          const parentId = parentInfo.id;
          affectedParentIds.add(parentId);

          // 2. Check if Variant exists under this Parent Product in `variants` table
          const existingVariant = await q.one<{
            id: string;
            sku: string | null;
            barcode: string | null;
            stock_milli: string | number;
            cost_minor: number;
            price_minor: number;
            mrp_minor: number | null;
          }>(
            `SELECT id, sku, barcode, stock_milli, cost_minor, price_minor, mrp_minor
             FROM variants
             WHERE tenant_id = ? AND product_id = ? AND lower(trim(COALESCE(size, ''))) = lower(trim(?))
             LIMIT 1`,
            [tenantId, parentId, normSize],
          );

          const qtyMilli = row.openingQtyMilli ?? 0;
          const costMinor = row.costMinor ?? 0;
          const taxRateBp = row.taxRateBp ?? 0;

          if (existingVariant) {
            // ── Case A: Restock existing variant ──────────────────────────────
            const variantId = existingVariant.id;
            let finalVariantBarcode = existingVariant.barcode || (row.barcode ? row.barcode.trim() : null);

            if (row.updatePrices) {
              await q.exec(
                `UPDATE variants
                 SET cost_minor = ?, price_minor = ?, mrp_minor = COALESCE(?, mrp_minor),
                     offer_percentage = COALESCE(?, offer_percentage),
                     purchase_date = COALESCE(?, (CASE WHEN (?::bigint) > 0 THEN now()::text ELSE purchase_date END)),
                     stock_milli = stock_milli + ?,
                     barcode = COALESCE(barcode, ?),
                     active = true,
                     updated_at = now()
                 WHERE id = ? AND tenant_id = ?`,
                [
                  row.priceMinor,
                  costMinor,
                  row.mrpMinor ?? null,
                  row.offerPercentage ?? null,
                  row.purchaseDate || null,
                  qtyMilli,
                  qtyMilli,
                  finalVariantBarcode,
                  variantId,
                  tenantId,
                ],
              );
            } else {
              await q.exec(
                `UPDATE variants
                 SET purchase_date = COALESCE(?, (CASE WHEN (?::bigint) > 0 THEN now()::text ELSE purchase_date END)),
                     stock_milli = stock_milli + ?,
                     barcode = COALESCE(barcode, ?),
                     active = true,
                     updated_at = now()
                 WHERE id = ? AND tenant_id = ?`,
                [row.purchaseDate || null, qtyMilli, qtyMilli, finalVariantBarcode, variantId, tenantId],
              );
            }

            // Record stock move & purchase line
            if (qtyMilli > 0) {
              let lineId: string | null = null;
              if (purchaseId) {
                lineId = newId('prl');
                const lineSubtotal = Math.round((costMinor * qtyMilli) / 1000);
                let lineTaxable = lineSubtotal;
                let lineTax = 0;
                if (taxRateBp > 0) {
                  lineTaxable = lineSubtotal;
                  lineTax = Math.round((lineTaxable * taxRateBp) / 10000);
                }
                const lineTotal = lineTaxable + lineTax;
                const lineCgst = Math.round(lineTax / 2);
                const lineSgst = lineTax - lineCgst;

                await q.exec(
                  `INSERT INTO purchase_lines (
                    id, tenant_id, branch_id, purchase_id, item_id, variant_id, name, hsn, unit,
                    qty_milli, billed_qty_milli, received_qty_milli,
                    cost_minor, discount_minor, tax_rate_bp,
                    taxable_minor, tax_minor, cgst_minor, sgst_minor, igst_minor, total_minor
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?)`,
                  [
                    lineId, tenantId, branchId, purchaseId, parentId, variantId,
                    `${row.name} (${normSize})`, row.hsn || null, row.unit || 'pcs',
                    qtyMilli, qtyMilli, qtyMilli, costMinor, taxRateBp,
                    lineTaxable, lineTax, lineCgst, lineSgst, lineTotal,
                  ],
                );
                purchaseSubtotal += lineSubtotal;
                purchaseTaxable += lineTaxable;
                purchaseTax += lineTax;
                purchaseCgst += lineCgst;
                purchaseSgst += lineSgst;
                purchaseTotal += lineTotal;
                purchaseLinesCount++;
              }

              await q.exec(
                `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, variant_id, location, qty_milli, kind, ref_type, ref_id, ref_line_id, unit_cost_minor, reason, notes, user_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'purchase', 'purchase', ?, ?, ?, 'Bulk import restock shipment', ?, ?)`,
                [newId('sm'), tenantId, branchId, parentId, variantId, firstLocation, qtyMilli, purchaseId || importId, lineId, costMinor, supplier ? `Supplier: ${supplier.name}` : 'Direct Stock Import', ctx.user!.id],
              );
            }

            await q.exec('RELEASE SAVEPOINT sp_bulk_variant_row');
            results.push({ rowIndex: row._rowIndex, status: 'restocked', name: `${row.name} (${normSize})`, itemId: parentId });
            restocked++;
          } else {
            // ── Case B: Create new variant under Parent Product ───────────────
            const variantId = newId('var');
            const cleanBase = (parentInfo.sku || row.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 5)).toUpperCase();
            const cleanSize = normSize.toUpperCase().replace(/[^A-Za-z0-9]/g, '').slice(0, 4) || 'FS';
            const variantSku = `${cleanBase}-${cleanSize}`;

            let finalBarcode = row.barcode ? row.barcode.trim() : '';
            let barcodeType: 'INTERNAL' | 'MANUFACTURER' = 'INTERNAL';
            if (!finalBarcode) {
              finalBarcode = generateUniqueInternalBarcode(allBranchBarcodes, seenImportBarcodes);
              seenImportBarcodes.add(finalBarcode);
            } else {
              barcodeType = row.barcodeType || (finalBarcode.startsWith('20') && finalBarcode.length === 13 ? 'INTERNAL' : 'MANUFACTURER');
              seenImportBarcodes.add(finalBarcode);
            }

            await q.exec(
              `INSERT INTO variants (
                id, tenant_id, product_id, size, colour, pattern, sku, barcode,
                price_minor, cost_minor, mrp_minor, offer_percentage, stock_milli,
                reorder_level_milli, purchase_date, uom, active, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, now(), now())`,
              [
                variantId,
                tenantId,
                parentId,
                normSize,
                null,
                row.designPattern || null,
                variantSku,
                finalBarcode,
                row.priceMinor,
                costMinor,
                row.mrpMinor ?? row.priceMinor,
                row.offerPercentage ?? 0,
                qtyMilli,
                row.reorderMilli ?? 0,
                row.purchaseDate || new Date().toISOString().slice(0, 10),
                row.unit || 'pcs',
              ],
            );

            // Register barcode in product_barcodes
            if (finalBarcode) {
              const existingPb = await q.one<{ id: string }>('SELECT id FROM product_barcodes WHERE tenant_id = ? AND branch_id = ? AND barcode = ?', [tenantId, branchId, finalBarcode]);
              if (existingPb) {
                await q.exec('UPDATE product_barcodes SET product_id = ?, barcode_type = ? WHERE id = ?', [parentId, barcodeType, existingPb.id]);
              } else {
                await q.exec(
                  'INSERT INTO product_barcodes (id, tenant_id, branch_id, product_id, barcode, barcode_type) VALUES (?, ?, ?, ?, ?, ?)',
                  [newId('bc'), tenantId, branchId, parentId, finalBarcode, barcodeType],
                );
              }
              barcodesSaved++;
            }

            // Record opening stock move & purchase line
            if (qtyMilli > 0) {
              let lineId: string | null = null;
              if (purchaseId) {
                lineId = newId('prl');
                const lineSubtotal = Math.round((costMinor * qtyMilli) / 1000);
                let lineTaxable = lineSubtotal;
                let lineTax = 0;
                if (taxRateBp > 0) {
                  lineTaxable = lineSubtotal;
                  lineTax = Math.round((lineTaxable * taxRateBp) / 10000);
                }
                const lineTotal = lineTaxable + lineTax;
                const lineCgst = Math.round(lineTax / 2);
                const lineSgst = lineTax - lineCgst;

                await q.exec(
                  `INSERT INTO purchase_lines (
                    id, tenant_id, branch_id, purchase_id, item_id, variant_id, name, hsn, unit,
                    qty_milli, billed_qty_milli, received_qty_milli,
                    cost_minor, discount_minor, tax_rate_bp,
                    taxable_minor, tax_minor, cgst_minor, sgst_minor, igst_minor, total_minor
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?)`,
                  [
                    lineId, tenantId, branchId, purchaseId, parentId, variantId,
                    `${row.name} (${normSize})`, row.hsn || null, row.unit || 'pcs',
                    qtyMilli, qtyMilli, qtyMilli, costMinor, taxRateBp,
                    lineTaxable, lineTax, lineCgst, lineSgst, lineTotal,
                  ],
                );
                purchaseSubtotal += lineSubtotal;
                purchaseTaxable += lineTaxable;
                purchaseTax += lineTax;
                purchaseCgst += lineCgst;
                purchaseSgst += lineSgst;
                purchaseTotal += lineTotal;
                purchaseLinesCount++;
              }

              await q.exec(
                `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, variant_id, location, qty_milli, kind, ref_type, ref_id, ref_line_id, unit_cost_minor, reason, notes, user_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'opening', 'purchase', ?, ?, ?, 'Bulk import opening stock', ?, ?)`,
                [newId('sm'), tenantId, branchId, parentId, variantId, firstLocation, qtyMilli, purchaseId || importId, lineId, costMinor, supplier ? `Supplier: ${supplier.name}` : 'Direct Stock Import', ctx.user!.id],
              );
            }

            await q.exec('RELEASE SAVEPOINT sp_bulk_variant_row');
            results.push({ rowIndex: row._rowIndex, status: 'created', name: `${row.name} (${normSize})`, itemId: parentId });
            created++;
          }
        } catch (err: any) {
          await q.exec('ROLLBACK TO SAVEPOINT sp_bulk_variant_row');
          console.error(`[bulk-import] Row ${row._rowIndex} failed:`, err?.message || err);
          results.push({
            rowIndex: row._rowIndex,
            status: 'skipped',
            name: row.name,
            reason: err?.code === '23505' ? 'Barcode or variant collision' : (err?.message || 'Insertion failed'),
          });
        }
      }

      // Synchronize parent items active status
      for (const parentId of affectedParentIds) {
        await q.exec(
          `UPDATE items
           SET active = true, updated_at = now()
           WHERE id = ? AND tenant_id = ?`,
          [parentId, tenantId],
        );
      }

      // Finalize purchase header if created
      if (purchaseId) {
        if (purchaseLinesCount > 0) {
          await q.exec(
            `UPDATE purchases
             SET subtotal_minor = ?, taxable_minor = ?, tax_minor = ?,
                 cgst_minor = ?, sgst_minor = ?, total_minor = ?, balance_minor = ?
             WHERE id = ?`,
            [purchaseSubtotal, purchaseTaxable, purchaseTax, purchaseCgst, purchaseSgst, purchaseTotal, purchaseTotal, purchaseId],
          );
        } else {
          await q.exec('DELETE FROM purchases WHERE id = ?', [purchaseId]);
          purchaseId = null;
          purchaseNumber = null;
        }
      }

      // Record in imports audit
      const totalSkipped = b.rows.length - (created + restocked);
      await q.exec(
        `INSERT INTO imports (id, tenant_id, kind, total_rows, accepted, rejected, status, created_by)
         VALUES (?, ?, 'items', ?, ?, ?, 'committed', ?)`,
        [importId, tenantId, b.rows.length, created + restocked, totalSkipped, ctx.user!.id],
      );

      // Audit log
      await audit(q, ctx, {
        action: 'item.bulk_import',
        entity: 'item',
        entityId: importId,
        detail: {
          totalRows: b.rows.length,
          createdVariants: created,
          restockedVariants: restocked,
          skippedVariants: totalSkipped,
          purchaseId,
          supplierId,
        },
      });
    });

    return {
      importId,
      purchaseId,
      purchaseNumber,
      supplierId,
      supplierName: supplier?.name || null,
      totalRows: b.rows.length,
      created,
      restocked,
      skipped: results.filter((r) => r.status === 'skipped').length,
      barcodesSaved,
      results,
    };
  });
}
