import { requirePerm, requireUser } from '../auth.ts';
import { audit } from '../audit.ts';
import { bad, notFound, forbidden, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import type { Queryable } from '../db/index.ts';
import { syncItemStockStatus } from '../services/stockStatus.ts';
import { resolveBranchScope } from '../branchScope.ts';

// Sequential number generator using existing number_series table
async function getNextSeriesNumber(
  q: Queryable,
  tenantId: string,
  branchId: string,
  series: string,
  prefix: string,
  startOffset: number = 1000,
): Promise<string> {
  const seriesRow = await q.one<any>(
    `INSERT INTO number_series (tenant_id, branch_id, series, next_no)
     VALUES (?, ?, ?, 2)
     ON CONFLICT (tenant_id, branch_id, series) DO UPDATE SET next_no = number_series.next_no + 1
     RETURNING (next_no - 1) AS assigned_no`,
    [tenantId, branchId, series],
  );
  const seqNo = Number(seriesRow?.assignedNo ?? seriesRow?.assigned_no ?? 1);
  return `${prefix}-${startOffset + seqNo}`;
}

export function registerDamagedStock(r: Router): void {
  // ==========================================
  // 1. DAMAGED & DEFECTIVE STOCK ENDPOINTS
  // ==========================================

  // GET /api/inventory/damaged-stock
  r.get('/api/inventory/damaged-stock', requirePerm('stock.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const branchFilter = (!scope.isSuperAdminAll && scope.branchId) ? ' AND ds.branch_id = ?' : '';
    const branchParams = (!scope.isSuperAdminAll && scope.branchId) ? [scope.branchId] : [];

    const status = ctx.query?.status as string | undefined;
    const classification = ctx.query?.classification as string | undefined;
    const supplierId = ctx.query?.supplierId as string | undefined;
    const search = (ctx.query?.search as string | undefined)?.trim();
    const from = ctx.query?.from as string | undefined;
    const to = ctx.query?.to as string | undefined;

    let sql = `
      SELECT 
        ds.*,
        i.name AS current_item_name,
        i.sku AS current_sku,
        i.barcode AS current_barcode,
        p.name AS supplier_name,
        u.name AS reporter_name,
        pur.purchase_number AS original_purchase_number
      FROM damaged_stock ds
      LEFT JOIN items i ON i.id = ds.item_id AND i.tenant_id = ds.tenant_id
      LEFT JOIN parties p ON p.id = ds.supplier_id AND p.tenant_id = ds.tenant_id
      LEFT JOIN users u ON u.id = ds.reported_by AND u.tenant_id = ds.tenant_id
      LEFT JOIN purchases pur ON pur.id = ds.purchase_id AND pur.tenant_id = ds.tenant_id
      WHERE ds.tenant_id = ? ${branchFilter}
    `;
    const params: unknown[] = [tenantId, ...branchParams];

    if (status) {
      sql += ' AND ds.status = ?';
      params.push(status);
    }
    if (classification) {
      sql += ' AND ds.classification = ?';
      params.push(classification);
    }
    if (supplierId) {
      sql += ' AND ds.supplier_id = ?';
      params.push(supplierId);
    }
    if (search) {
      sql += ` AND (
        lower(ds.damage_number) LIKE ? OR 
        lower(ds.item_name) LIKE ? OR 
        lower(COALESCE(ds.sku, '')) LIKE ? OR 
        lower(COALESCE(ds.barcode, '')) LIKE ? OR 
        lower(COALESCE(ds.roll_no, '')) LIKE ? OR 
        lower(COALESCE(ds.batch_no, '')) LIKE ?
      )`;
      const wild = `%${search.toLowerCase()}%`;
      params.push(wild, wild, wild, wild, wild, wild);
    }
    if (from) {
      sql += ' AND ds.damage_date >= ?';
      params.push(from);
    }
    if (to) {
      sql += ' AND ds.damage_date <= ?';
      params.push(to);
    }

    sql += ' ORDER BY ds.created_at DESC LIMIT 200';

    const rows = await ctx.db.query(sql, params);
    return { damagedStock: rows };
  });

  // GET /api/inventory/damaged-stock/stats
  r.get('/api/inventory/damaged-stock/stats', requirePerm('stock.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const branchFilter = (!scope.isSuperAdminAll && scope.branchId) ? ' AND branch_id = ?' : '';
    const branchParams = (!scope.isSuperAdminAll && scope.branchId) ? [scope.branchId] : [];

    const stats = await ctx.db.one<any>(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'DAMAGED')::int AS damaged_count,
        COALESCE(SUM(qty_milli) FILTER (WHERE status = 'DAMAGED'), 0)::bigint AS damaged_qty_milli,

        COUNT(*) FILTER (WHERE status = 'DEFECTIVE')::int AS defective_count,
        COALESCE(SUM(qty_milli) FILTER (WHERE status = 'DEFECTIVE'), 0)::bigint AS defective_qty_milli,

        COUNT(*) FILTER (WHERE status = 'RETURN_PENDING')::int AS return_pending_count,
        COALESCE(SUM(qty_milli) FILTER (WHERE status = 'RETURN_PENDING'), 0)::bigint AS return_pending_qty_milli,

        COUNT(*) FILTER (WHERE status = 'SENT_TO_SUPPLIER')::int AS sent_to_supplier_count,
        COALESCE(SUM(qty_milli) FILTER (WHERE status = 'SENT_TO_SUPPLIER'), 0)::bigint AS sent_to_supplier_qty_milli,

        COUNT(*) FILTER (WHERE status = 'REPLACEMENT_PENDING')::int AS replacement_pending_count,
        COALESCE(SUM(qty_milli) FILTER (WHERE status = 'REPLACEMENT_PENDING'), 0)::bigint AS replacement_pending_qty_milli,

        COUNT(*) FILTER (WHERE status = 'SCRAPPED')::int AS scrapped_count,
        COALESCE(SUM(qty_milli) FILTER (WHERE status = 'SCRAPPED'), 0)::bigint AS scrapped_qty_milli,

        COUNT(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved_count,
        COALESCE(SUM(qty_milli) FILTER (WHERE status = 'RESOLVED'), 0)::bigint AS resolved_qty_milli,

        COUNT(*)::int AS total_records
      FROM damaged_stock
      WHERE tenant_id = ? ${branchFilter}`,
      [tenantId, ...branchParams],
    );

    return { stats: stats || {} };
  });

  // POST /api/inventory/damaged-stock
  r.post('/api/inventory/damaged-stock', requirePerm('stock.adjust'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const itemId = V.str(b.itemId, 'Item ID');
    const classification = (b.classification === 'DEFECTIVE') ? 'DEFECTIVE' : 'DAMAGED';
    const damageReason = V.str(b.damageReason, 'Damage / Defect Reason', 100);
    const customReason = V.optStr(b.customReason, 'Custom Reason', 255);
    const notes = V.optStr(b.notes, 'Notes', 500);
    const rollNo = V.optStr(b.rollNo, 'Roll Number', 100);
    const batchNo = V.optStr(b.batchNo, 'Batch Number', 100);
    const size = V.optStr(b.size, 'Size', 50);
    const colour = V.optStr(b.colour, 'Colour', 50);
    const design = V.optStr(b.design, 'Design', 100);
    const fabricType = V.optStr(b.fabricType, 'Fabric Type', 100);
    const purchaseId = V.optStr(b.purchaseId, 'Purchase ID', 64);
    const supplierId = V.optStr(b.supplierId, 'Supplier ID', 64);
    const damageDate = V.optStr(b.damageDate, 'Damage Date', 20) || new Date().toISOString().slice(0, 10);
    const photoUrl = V.optStr(b.photoUrl, 'Photo URL', 500);

    // Quantity validation (support units or milli-units)
    let qtyMilli: number;
    if (b.qtyMilli !== undefined) {
      qtyMilli = V.int(b.qtyMilli, 'Damage quantity (milli-units)', { min: 1 });
    } else {
      const units = Number(b.qty ?? b.quantity ?? 1);
      if (isNaN(units) || units <= 0) throw bad('Quantity must be greater than zero.');
      qtyMilli = Math.round(units * 1000);
    }

    return ctx.db.tx(async (q) => {
      // 1. Lock item row
      const item = await q.one<any>(
        `SELECT id, branch_id, name, sku, barcode, category, unit, cost_minor, track_stock
         FROM items 
         WHERE id = ? AND tenant_id = ? FOR UPDATE`,
        [itemId, tenantId],
      );
      if (!item) throw notFound('Item');

      const branchId = item.branch_id || (await resolveBranchScope(ctx)).branchId || 'MAIN';
      const itemCostMinor = Number(item.cost_minor ?? 0);
      const unit = b.unit || item.unit || 'pcs';

      // 2. Check current saleable stock
      const stockRow = await q.one<any>(
        `SELECT COALESCE(SUM(qty_milli), 0)::bigint AS current_stock_milli
         FROM stock_moves
         WHERE item_id = ? AND tenant_id = ? AND branch_id = ?`,
        [itemId, tenantId, branchId],
      );
      const currentStockMilli = Number(stockRow?.current_stock_milli ?? 0);

      // Verify stock availability
      if (currentStockMilli < qtyMilli) {
        throw bad(
          `Insufficient saleable stock. Current available: ${(currentStockMilli / 1000).toFixed(2)} ${unit}, requested: ${(qtyMilli / 1000).toFixed(2)} ${unit}.`,
          'INSUFFICIENT_STOCK',
        );
      }

      // 3. Generate sequential damage number (DMG-1001)
      const damageNumber = await getNextSeriesNumber(q, tenantId, branchId, 'DMG', 'DMG', 1000);
      const damageId = newId('dmg');
      const moveId = newId('sm');
      const now = new Date().toISOString();

      // 4. Insert into damaged_stock
      await q.exec(
        `INSERT INTO damaged_stock (
          id, tenant_id, branch_id, damage_number, item_id, item_name,
          category, sku, barcode, qty_milli, unit, roll_no, batch_no,
          size, colour, design, fabric_type, purchase_id, supplier_id,
          damage_date, damage_reason, custom_reason, notes, photo_url,
          status, classification, reported_by, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )`,
        [
          damageId, tenantId, branchId, damageNumber, itemId, item.name,
          item.category || null, item.sku || null, item.barcode || null, qtyMilli, unit, rollNo || null, batchNo || null,
          size || null, colour || null, design || null, fabricType || null, purchaseId || null, supplierId || null,
          damageDate, damageReason, customReason || null, notes || null, photoUrl || null,
          classification, classification, ctx.user!.id, now, now,
        ],
      );

      // 5. Post negative stock move to remove affected quantity from saleable inventory
      await q.exec(
        `INSERT INTO stock_moves (
          id, tenant_id, branch_id, item_id, location, qty_milli, kind,
          ref_type, ref_id, unit_cost_minor, reason, notes, user_id, created_at
        ) VALUES (
          ?, ?, ?, ?, 'MAIN', ?, 'adjust',
          'damaged_stock', ?, ?, ?, ?, ?, ?
        )`,
        [
          moveId, tenantId, branchId, itemId, -qtyMilli,
          damageId, itemCostMinor, damageReason,
          `Damaged Stock ${damageNumber}: ${damageReason}${notes ? ' - ' + notes : ''}`,
          ctx.user!.id, now,
        ],
      );

      // 6. Synchronize stock status so POS never sells damaged goods
      await syncItemStockStatus(q, tenantId, [itemId], branchId);

      // 7. Audit log
      await audit(q, {
        tenantId,
        userId: ctx.user!.id,
        action: 'stock.damaged',
        targetType: 'damaged_stock',
        targetId: damageId,
        details: { damageNumber, itemId, qtyMilli, classification, damageReason },
      });

      const created = await q.one('SELECT * FROM damaged_stock WHERE id = ?', [damageId]);
      return { success: true, damagedStock: created };
    });
  });

  // POST /api/inventory/damaged-stock/:id/scrap (Write-off)
  r.post('/api/inventory/damaged-stock/:id/scrap', requirePerm('stock.adjust'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const id = ctx.params.id;
    const reason = V.optStr(ctx.body?.reason, 'Scrap reason', 255) || 'Written off / Scrapped';

    return ctx.db.tx(async (q) => {
      const existing = await q.one<any>(
        'SELECT id, status, damage_number, item_id, branch_id FROM damaged_stock WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [id, tenantId],
      );
      if (!existing) throw notFound('Damaged stock record');
      if (existing.status === 'SCRAPPED' || existing.status === 'RESOLVED') {
        throw bad(`Cannot scrap record with status "${existing.status}".`);
      }

      await q.exec(
        `UPDATE damaged_stock 
         SET status = 'SCRAPPED', notes = COALESCE(notes || E'\\n', '') || ?, updated_at = now() 
         WHERE id = ? AND tenant_id = ?`,
        [`[Scrapped on ${new Date().toLocaleDateString()}]: ${reason}`, id, tenantId],
      );

      const dmgNum = existing.damageNumber ?? existing.damage_number;
      await audit(q, {
        tenantId,
        userId: ctx.user!.id,
        action: 'stock.scrapped',
        targetType: 'damaged_stock',
        targetId: id,
        details: { damageNumber: dmgNum, reason },
      });

      return { success: true, message: `Damaged stock ${dmgNum} successfully written off.` };
    });
  });

  // ==========================================
  // 2. SUPPLIER RETURNS ENDPOINTS
  // ==========================================

  // GET /api/inventory/supplier-returns
  r.get('/api/inventory/supplier-returns', requirePerm('stock.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const branchFilter = (!scope.isSuperAdminAll && scope.branchId) ? ' AND sr.branch_id = ?' : '';
    const branchParams = (!scope.isSuperAdminAll && scope.branchId) ? [scope.branchId] : [];

    const status = ctx.query?.status as string | undefined;
    const supplierId = ctx.query?.supplierId as string | undefined;
    const search = (ctx.query?.search as string | undefined)?.trim();

    let sql = `
      SELECT 
        sr.*,
        p.name AS supplier_name,
        p.gstin AS supplier_gstin,
        p.phone AS supplier_phone,
        u.name AS creator_name,
        app.name AS approver_name,
        pur.purchase_number AS original_purchase_number
      FROM supplier_returns sr
      LEFT JOIN parties p ON p.id = sr.supplier_id AND p.tenant_id = sr.tenant_id
      LEFT JOIN users u ON u.id = sr.created_by AND u.tenant_id = sr.tenant_id
      LEFT JOIN users app ON app.id = sr.approved_by AND app.tenant_id = sr.tenant_id
      LEFT JOIN purchases pur ON pur.id = sr.purchase_id AND pur.tenant_id = sr.tenant_id
      WHERE sr.tenant_id = ? ${branchFilter}
    `;
    const params: unknown[] = [tenantId, ...branchParams];

    if (status) {
      sql += ' AND sr.status = ?';
      params.push(status);
    }
    if (supplierId) {
      sql += ' AND sr.supplier_id = ?';
      params.push(supplierId);
    }
    if (search) {
      sql += ` AND (
        lower(sr.return_number) LIKE ? OR 
        lower(p.name) LIKE ? OR 
        lower(COALESCE(sr.dispatch_ref, '')) LIKE ?
      )`;
      const wild = `%${search.toLowerCase()}%`;
      params.push(wild, wild, wild);
    }

    sql += ' ORDER BY sr.created_at DESC LIMIT 100';

    const returns = await ctx.db.query(sql, params);

    // Fetch lines for each return
    const returnIds = returns.map((r: any) => r.id);
    let allLines: any[] = [];
    if (returnIds.length > 0) {
      const placeholders = returnIds.map(() => '?').join(',');
      allLines = await ctx.db.query(
        `SELECT srl.*, i.name AS current_item_name, i.sku AS current_sku, i.barcode AS current_barcode
         FROM supplier_return_lines srl
         LEFT JOIN items i ON i.id = srl.item_id AND i.tenant_id = srl.tenant_id
         WHERE srl.return_id IN (${placeholders}) AND srl.tenant_id = ?
         ORDER BY srl.created_at ASC`,
        [...returnIds, tenantId],
      );
    }

    const linesByReturn = new Map<string, any[]>();
    for (const line of allLines) {
      const retId = line.returnId ?? line.return_id;
      const arr = linesByReturn.get(retId) || [];
      arr.push(line);
      linesByReturn.set(retId, arr);
    }

    const result = returns.map((r: any) => ({
      ...r,
      lines: linesByReturn.get(r.id) || [],
    }));

    return { supplierReturns: result };
  });

  // POST /api/inventory/supplier-returns
  r.post('/api/inventory/supplier-returns', requirePerm('stock.adjust'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const supplierId = V.str(b.supplierId || b.supplier_id, 'Supplier ID');
    const purchaseId = V.optStr(b.purchaseId || b.purchase_id, 'Purchase ID', 64);
    const returnDate = V.optStr(b.returnDate || b.return_date, 'Return Date', 20) || new Date().toISOString().slice(0, 10);
    const returnType = ['REPLACEMENT', 'REFUND', 'CREDIT_NOTE', 'SCRAP'].includes(b.returnType || b.return_type) ? (b.returnType || b.return_type) : 'REPLACEMENT';
    const notes = V.optStr(b.notes, 'Notes', 500);
    const lines = Array.isArray(b.lines) ? b.lines : [];

    if (lines.length === 0) throw bad('At least one item line is required for a supplier return.');

    return ctx.db.tx(async (q) => {
      // 1. Verify supplier exists
      const supplier = await q.one('SELECT id, name FROM parties WHERE id = ? AND tenant_id = ?', [supplierId, tenantId]);
      if (!supplier) throw notFound('Supplier');

      const scope = await resolveBranchScope(ctx);
      const branchId = scope.branchId || 'MAIN';

      // 2. Generate sequential return number (SR-1001)
      const returnNumber = await getNextSeriesNumber(q, tenantId, branchId, 'SR', 'SR', 1000);
      const returnId = newId('sr');
      const now = new Date().toISOString();

      let totalItems = 0;
      let totalQtyMilli = 0;

      // 3. Process and validate all lines first
      const processedLines: any[] = [];
      for (const l of lines) {
        const itemId = V.str(l.itemId || l.item_id, 'Item ID in line');
        const damagedStockId = V.optStr(l.damagedStockId || l.damaged_stock_id, 'Damaged Stock ID', 64);
        const returnReason = V.str(l.returnReason || l.return_reason || l.damageReason || l.damage_reason || 'Damaged goods return', 'Return reason', 150);

        let qtyMilli: number;
        if (l.qtyMilli !== undefined || l.qty_milli !== undefined) {
          qtyMilli = V.int(l.qtyMilli ?? l.qty_milli, 'Return quantity (milli-units)', { min: 1 });
        } else {
          const units = Number(l.qty ?? 1);
          if (isNaN(units) || units <= 0) throw bad('Line quantity must be positive.');
          qtyMilli = Math.round(units * 1000);
        }

        // Fetch item details
        const item = await q.one<any>(
          'SELECT id, name, sku, barcode, cost_minor, unit FROM items WHERE id = ? AND tenant_id = ?',
          [itemId, tenantId],
        );
        if (!item) throw notFound(`Item ${itemId}`);

        // If linked to a damaged stock record, verify and check eligible quantity
        if (damagedStockId) {
          const dmg = await q.one<any>(
            'SELECT id, status, qty_milli FROM damaged_stock WHERE id = ? AND tenant_id = ? FOR UPDATE',
            [damagedStockId, tenantId],
          );
          if (!dmg) throw notFound(`Damaged stock ${damagedStockId}`);
          if (['RESOLVED', 'SCRAPPED', 'SENT_TO_SUPPLIER'].includes(dmg.status)) {
            throw bad(`Damaged stock item is already in ${dmg.status} status.`);
          }
          const dmgQty = Number(dmg.qtyMilli ?? dmg.qty_milli ?? 0);
          if (qtyMilli > dmgQty) {
            throw bad(`Return quantity cannot exceed damaged stock quantity.`);
          }
        }

        const lineId = newId('srl');
        const unitCostMinor = Number(l.unitCostMinor ?? item.costMinor ?? item.cost_minor ?? 0);

        processedLines.push({
          lineId,
          damagedStockId: damagedStockId || null,
          itemId,
          itemName: item.name,
          sku: item.sku || null,
          barcode: item.barcode || null,
          qtyMilli,
          unit: l.unit || item.unit || 'pcs',
          unitCostMinor,
          rollNo: l.rollNo || null,
          batchNo: l.batchNo || null,
          size: l.size || null,
          colour: l.colour || null,
          design: l.design || null,
          fabricType: l.fabricType || null,
          returnReason,
          notes: l.notes || null,
        });

        totalItems += 1;
        totalQtyMilli += qtyMilli;
      }

      // 4. Insert parent header record into supplier_returns FIRST (satisfies foreign key)
      await q.exec(
        `INSERT INTO supplier_returns (
          id, tenant_id, branch_id, return_number, supplier_id, purchase_id,
          return_date, status, return_type, total_items, total_qty_milli,
          notes, created_by, approved_by, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, 'APPROVED', ?, ?, ?,
          ?, ?, ?, ?, ?
        )`,
        [
          returnId, tenantId, branchId, returnNumber, supplierId, purchaseId || null,
          returnDate, returnType, totalItems, totalQtyMilli,
          notes || null, ctx.user!.id, ctx.user!.id, now, now,
        ],
      );

      // 5. Insert child lines into supplier_return_lines and update damaged_stock status
      for (const pl of processedLines) {
        await q.exec(
          `INSERT INTO supplier_return_lines (
            id, tenant_id, return_id, damaged_stock_id, item_id, item_name,
            sku, barcode, qty_milli, unit, unit_cost_minor,
            roll_no, batch_no, size, colour, design, fabric_type,
            return_reason, replaced_qty_milli, pending_qty_milli, notes, created_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, 0, ?, ?, ?
          )`,
          [
            pl.lineId, tenantId, returnId, pl.damagedStockId, pl.itemId, pl.itemName,
            pl.sku, pl.barcode, pl.qtyMilli, pl.unit, pl.unitCostMinor,
            pl.rollNo, pl.batchNo, pl.size, pl.colour, pl.design, pl.fabricType,
            pl.returnReason, pl.qtyMilli, pl.notes, now,
          ],
        );

        if (pl.damagedStockId) {
          await q.exec(
            `UPDATE damaged_stock SET status = 'RETURN_PENDING', updated_at = now() WHERE id = ? AND tenant_id = ?`,
            [pl.damagedStockId, tenantId],
          );
        }
      }

      // Audit log
      await audit(q, {
        tenantId,
        userId: ctx.user!.id,
        action: 'supplier_return.created',
        targetType: 'supplier_returns',
        targetId: returnId,
        details: { returnNumber, supplierId, totalItems, totalQtyMilli },
      });

      const created = await q.one('SELECT * FROM supplier_returns WHERE id = ?', [returnId]);
      return { success: true, supplierReturn: created };
    });
  });

  // POST /api/inventory/supplier-returns/:id/dispatch
  r.post('/api/inventory/supplier-returns/:id/dispatch', requirePerm('stock.adjust'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const id = ctx.params.id;
    const b = ctx.body ?? {};

    const dispatchDate = V.optStr(b.dispatchDate, 'Dispatch Date', 20) || new Date().toISOString().slice(0, 10);
    const dispatchRef = V.str(b.dispatchRef || b.challanNo || 'DISPATCH', 'Dispatch Reference / Challan', 100);
    const notes = V.optStr(b.notes, 'Notes', 255);

    return ctx.db.tx(async (q) => {
      const ret = await q.one<any>(
        'SELECT * FROM supplier_returns WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [id, tenantId],
      );
      if (!ret) throw notFound('Supplier return');
      if (ret.status === 'SENT_TO_SUPPLIER' || ret.status === 'FULLY_REPLACED' || ret.status === 'CLOSED') {
        throw bad(`Return is already in ${ret.status} status.`);
      }

      await q.exec(
        `UPDATE supplier_returns 
         SET status = 'SENT_TO_SUPPLIER', dispatch_date = ?, dispatch_ref = ?,
             notes = COALESCE(notes || E'\\n', '') || ?, updated_at = now()
         WHERE id = ? AND tenant_id = ?`,
        [dispatchDate, dispatchRef, notes ? `[Dispatched]: ${notes}` : `Dispatched on ${dispatchDate}`, id, tenantId],
      );

      // Also update linked damaged_stock records to SENT_TO_SUPPLIER
      await q.exec(
        `UPDATE damaged_stock ds
         SET status = 'SENT_TO_SUPPLIER', updated_at = now()
         FROM supplier_return_lines srl
         WHERE srl.return_id = ? AND srl.damaged_stock_id = ds.id AND ds.tenant_id = ?`,
        [id, tenantId],
      );

      await audit(q, {
        tenantId,
        userId: ctx.user!.id,
        action: 'supplier_return.dispatched',
        targetType: 'supplier_returns',
        targetId: id,
        details: { returnNumber: ret.return_number, dispatchDate, dispatchRef },
      });

      return { success: true, message: `Supplier return ${ret.return_number} marked as dispatched to supplier.` };
    });
  });

  // POST /api/inventory/supplier-returns/:id/reject
  r.post('/api/inventory/supplier-returns/:id/reject', requirePerm('stock.adjust'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const id = ctx.params.id;
    const reason = V.optStr(ctx.body?.reason, 'Rejection reason', 255) || 'Rejected by supplier';

    return ctx.db.tx(async (q) => {
      const ret = await q.one<any>(
        'SELECT * FROM supplier_returns WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [id, tenantId],
      );
      if (!ret) throw notFound('Supplier return');

      await q.exec(
        `UPDATE supplier_returns 
         SET status = 'REJECTED', notes = COALESCE(notes || E'\\n', '') || ?, updated_at = now()
         WHERE id = ? AND tenant_id = ?`,
        [`[Rejected by supplier]: ${reason}`, id, tenantId],
      );

      return { success: true, message: `Supplier return ${ret.return_number} marked as rejected.` };
    });
  });

  // ==========================================
  // 3. SUPPLIER REPLACEMENTS ENDPOINTS
  // ==========================================

  // GET /api/inventory/supplier-replacements
  r.get('/api/inventory/supplier-replacements', requirePerm('stock.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const branchFilter = (!scope.isSuperAdminAll && scope.branchId) ? ' AND srep.branch_id = ?' : '';
    const branchParams = (!scope.isSuperAdminAll && scope.branchId) ? [scope.branchId] : [];

    const returnId = ctx.query?.returnId as string | undefined;
    const search = (ctx.query?.search as string | undefined)?.trim();

    let sql = `
      SELECT 
        srep.*,
        p.name AS supplier_name,
        sr.return_number,
        orig_i.name AS original_item_name,
        orig_i.sku AS original_sku,
        rep_i.name AS replacement_item_name,
        rep_i.sku AS replacement_sku,
        u.name AS receiver_name
      FROM supplier_replacements srep
      JOIN supplier_returns sr ON sr.id = srep.return_id AND sr.tenant_id = srep.tenant_id
      LEFT JOIN parties p ON p.id = srep.supplier_id AND p.tenant_id = srep.tenant_id
      LEFT JOIN items orig_i ON orig_i.id = srep.original_item_id AND orig_i.tenant_id = srep.tenant_id
      LEFT JOIN items rep_i ON rep_i.id = srep.replacement_item_id AND rep_i.tenant_id = srep.tenant_id
      LEFT JOIN users u ON u.id = srep.received_by AND u.tenant_id = srep.tenant_id
      WHERE srep.tenant_id = ? ${branchFilter}
    `;
    const params: unknown[] = [tenantId, ...branchParams];

    if (returnId) {
      sql += ' AND srep.return_id = ?';
      params.push(returnId);
    }
    if (search) {
      sql += ` AND (
        lower(srep.replacement_number) LIKE ? OR 
        lower(sr.return_number) LIKE ? OR 
        lower(COALESCE(srep.challan_no, '')) LIKE ? OR 
        lower(rep_i.name) LIKE ?
      )`;
      const wild = `%${search.toLowerCase()}%`;
      params.push(wild, wild, wild, wild);
    }

    sql += ' ORDER BY srep.created_at DESC LIMIT 100';

    const replacements = await ctx.db.query(sql, params);
    return { supplierReplacements: replacements };
  });

  // POST /api/inventory/supplier-replacements
  r.post('/api/inventory/supplier-replacements', requirePerm('stock.adjust'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const returnId = V.str(b.returnId, 'Return ID');
    const returnLineId = V.str(b.returnLineId, 'Return Line ID');
    const condition = ['GOOD', 'DAMAGED', 'DEFECTIVE', 'SHORT_RECEIVED', 'WRONG_PRODUCT'].includes(b.condition)
      ? b.condition
      : 'GOOD';
    const challanNo = V.optStr(b.challanNo, 'Challan Number', 100);
    const receivedDate = V.optStr(b.receivedDate, 'Received Date', 20) || new Date().toISOString().slice(0, 10);
    const batchNo = V.optStr(b.batchNo, 'Batch Number', 100);
    const rollNo = V.optStr(b.rollNo, 'Roll Number', 100);
    const size = V.optStr(b.size, 'Size', 50);
    const colour = V.optStr(b.colour, 'Colour', 50);
    const design = V.optStr(b.design, 'Design', 100);
    const fabricType = V.optStr(b.fabricType, 'Fabric Type', 100);
    const notes = V.optStr(b.notes, 'Notes', 500);

    return ctx.db.tx(async (q) => {
      // 1. Lock return line
      const line = await q.one<any>(
        `SELECT srl.*, sr.return_number, sr.supplier_id, sr.branch_id
         FROM supplier_return_lines srl
         JOIN supplier_returns sr ON sr.id = srl.return_id AND sr.tenant_id = srl.tenant_id
         WHERE srl.id = ? AND srl.return_id = ? AND srl.tenant_id = ? FOR UPDATE`,
        [returnLineId, returnId, tenantId],
      );
      if (!line) throw notFound('Return line');

      const pendingQtyMilli = Number(line.pendingQtyMilli ?? line.pending_qty_milli ?? 0);
      if (pendingQtyMilli <= 0) {
        throw bad('This return line has already been fully replaced.');
      }

      // 2. Validate quantity
      let qtyMilli: number;
      if (b.qtyMilli !== undefined || b.qty_milli !== undefined) {
        qtyMilli = V.int(b.qtyMilli ?? b.qty_milli, 'Received quantity (milli-units)', { min: 1 });
      } else {
        const units = Number(b.qty ?? 1);
        if (isNaN(units) || units <= 0) throw bad('Received quantity must be positive.');
        qtyMilli = Math.round(units * 1000);
      }

      if (qtyMilli > pendingQtyMilli) {
        throw bad(
          `Received quantity (${(qtyMilli / 1000).toFixed(2)}) exceeds pending return quantity (${(pendingQtyMilli / 1000).toFixed(2)}).`,
        );
      }

      const branchId = line.branchId || line.branch_id || (await resolveBranchScope(ctx)).branchId || 'MAIN';
      const replacementItemId = (b.replacementItemId || b.replacement_item_id)
        ? V.str(b.replacementItemId || b.replacement_item_id, 'Replacement Item ID')
        : (line.itemId || line.item_id);

      // 3. Verify replacement item exists
      const repItem = await q.one<any>(
        'SELECT id, name, sku, barcode, cost_minor, unit FROM items WHERE id = ? AND tenant_id = ?',
        [replacementItemId, tenantId],
      );
      if (!repItem) throw notFound('Replacement item');

      // 4. Generate replacement number (SRP-1001)
      const replacementNumber = await getNextSeriesNumber(q, tenantId, branchId, 'SRP', 'SRP', 1000);
      const replacementId = newId('srp');
      const now = new Date().toISOString();

      const origItemId = line.itemId || line.item_id;
      const supplierId = line.supplierId || line.supplier_id;
      const retNum = line.returnNumber || line.return_number;
      const damagedStockId = line.damagedStockId || line.damaged_stock_id;

      // 5. Insert into supplier_replacements
      await q.exec(
        `INSERT INTO supplier_replacements (
          id, tenant_id, branch_id, replacement_number, return_id, return_line_id,
          supplier_id, challan_no, received_date, original_item_id, replacement_item_id,
          qty_milli, unit, condition, batch_no, roll_no, size, colour, design, fabric_type,
          notes, received_by, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?
        )`,
        [
          replacementId, tenantId, branchId, replacementNumber, returnId, returnLineId,
          supplierId, challanNo || null, receivedDate, origItemId, replacementItemId,
          qtyMilli, b.unit || line.unit || repItem.unit || 'pcs', condition, batchNo || null, rollNo || null,
          size || null, colour || null, design || null, fabricType || null,
          notes || null, ctx.user!.id, now,
        ],
      );

      // 6. Update supplier_return_lines replaced and pending quantities
      const newPendingMilli = pendingQtyMilli - qtyMilli;
      const newReplacedMilli = Number(line.replacedQtyMilli ?? line.replaced_qty_milli ?? 0) + qtyMilli;

      await q.exec(
        `UPDATE supplier_return_lines 
         SET replaced_qty_milli = ?, pending_qty_milli = ?
         WHERE id = ? AND tenant_id = ?`,
        [newReplacedMilli, newPendingMilli, returnLineId, tenantId],
      );

      // 7. STOCK BEHAVIOUR ACCORDING TO CONDITION:
      // If condition === 'GOOD':
      //   -> Add to saleable stock via append-only stock_moves
      //   -> NO new purchase invoice or duplicate payables/ITC created!
      if (condition === 'GOOD') {
        const moveId = newId('sm');
        await q.exec(
          `INSERT INTO stock_moves (
            id, tenant_id, branch_id, item_id, location, qty_milli, kind,
            ref_type, ref_id, unit_cost_minor, reason, notes, user_id, created_at
          ) VALUES (
            ?, ?, ?, ?, 'MAIN', ?, 'adjust',
            'supplier_replacement', ?, ?, 'Supplier Replacement Received', ?, ?, ?
          )`,
          [
            moveId, tenantId, branchId, replacementItemId, qtyMilli,
            replacementId, Number(line.unitCostMinor ?? line.unit_cost_minor ?? repItem.costMinor ?? repItem.cost_minor ?? 0),
            `Replacement ${replacementNumber} for Return ${retNum} (Challan: ${challanNo || 'N/A'})`,
            ctx.user!.id, now,
          ],
        );

        // Sync item stock status to enable in POS
        await syncItemStockStatus(q, tenantId, [replacementItemId], branchId);
      } else {
        // If replacement arrived damaged/defective:
        // Do NOT add to saleable stock. Record a new damaged_stock entry!
        const secDmgId = newId('dmg');
        const secDmgNum = await getNextSeriesNumber(q, tenantId, branchId, 'DMG', 'DMG', 1000);
        await q.exec(
          `INSERT INTO damaged_stock (
            id, tenant_id, branch_id, damage_number, item_id, item_name,
            category, sku, barcode, qty_milli, unit, roll_no, batch_no,
            size, colour, design, fabric_type, supplier_id,
            damage_date, damage_reason, custom_reason, notes,
            status, classification, reported_by, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, 'Replacement Goods Defective', ?, ?,
            'DEFECTIVE', 'DEFECTIVE', ?, ?, ?
          )`,
          [
            secDmgId, tenantId, branchId, secDmgNum, replacementItemId, repItem.name,
            repItem.category || null, repItem.sku || null, repItem.barcode || null, qtyMilli, b.unit || 'pcs', rollNo || null, batchNo || null,
            size || null, colour || null, design || null, fabricType || null, supplierId,
            receivedDate, `Condition: ${condition} on replacement arrival`,
            `Received in Replacement ${replacementNumber} for Return ${retNum}. Challan: ${challanNo || 'N/A'}`,
            ctx.user!.id, now, now,
          ],
        );
      }

      // 8. Check overall return status (all lines)
      const remainingLines = await q.query<any>(
        'SELECT pending_qty_milli FROM supplier_return_lines WHERE return_id = ? AND tenant_id = ?',
        [returnId, tenantId],
      );
      const totalRemainingMilli = remainingLines.reduce((acc, row) => acc + Number(row.pendingQtyMilli ?? row.pending_qty_milli ?? 0), 0);

      const nextReturnStatus = totalRemainingMilli === 0 ? 'FULLY_REPLACED' : 'PARTIALLY_REPLACED';
      await q.exec(
        `UPDATE supplier_returns SET status = ?, updated_at = now() WHERE id = ? AND tenant_id = ?`,
        [nextReturnStatus, returnId, tenantId],
      );

      // 9. Update original damaged stock status if applicable
      if (damagedStockId) {
        const nextDmgStatus = totalRemainingMilli === 0 ? 'RESOLVED' : 'REPLACEMENT_PENDING';
        await q.exec(
          `UPDATE damaged_stock SET status = ?, updated_at = now() WHERE id = ? AND tenant_id = ?`,
          [nextDmgStatus, damagedStockId, tenantId],
        );
      }

      // 10. Audit log
      await audit(q, {
        tenantId,
        userId: ctx.user!.id,
        action: 'supplier_replacement.received',
        targetType: 'supplier_replacements',
        targetId: replacementId,
        details: { replacementNumber, returnNumber: line.return_number, qtyMilli, condition },
      });

      const created = await q.one('SELECT * FROM supplier_replacements WHERE id = ?', [replacementId]);
      return { success: true, supplierReplacement: created, nextReturnStatus };
    });
  });
}
