import { requirePerm } from '../auth.ts';
import { bad, notFound, type Router } from '../http.ts';

export function registerTemporarySales(r: Router): void {
  // 1. Get pending unreconciled temporary sales
  r.get('/api/temporary-sales/pending', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const supplierInvoiceNumber = (ctx.query.supplierInvoiceNumber as string || '').trim().toUpperCase();

    let sql = `
      SELECT
        tps.id,
        tps.tenant_id,
        tps.branch_id,
        tps.invoice_id,
        i.number AS invoice_number,
        tps.invoice_line_id,
        tps.supplier_invoice_number,
        tps.product_name,
        tps.normalized_name,
        tps.selling_price_minor,
        tps.sold_quantity::float AS sold_quantity,
        tps.reconciled_quantity::float AS reconciled_quantity,
        tps.remaining_quantity::float AS remaining_quantity,
        tps.reconciliation_status,
        tps.matched_item_id,
        tps.matched_variant_id,
        tps.reconciled_purchase_id,
        tps.reconciled_at,
        tps.created_at,
        i.bdate AS sale_date,
        i.customer_name
      FROM temporary_product_sales tps
      JOIN invoices i ON tps.invoice_id = i.id
      WHERE tps.tenant_id = ?
        AND tps.reconciliation_status != 'reconciled'
    `;
    const params: unknown[] = [tenantId];

    if (supplierInvoiceNumber) {
      sql += ' AND upper(trim(tps.supplier_invoice_number)) = ?';
      params.push(supplierInvoiceNumber);
    }

    sql += ' ORDER BY tps.created_at DESC LIMIT 200';

    const rows = await ctx.db.query<any>(sql, params);

    return {
      ok: true,
      pendingSales: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId ?? r.tenant_id,
        branchId: r.branchId ?? r.branch_id,
        invoiceId: r.invoiceId ?? r.invoice_id,
        invoiceNumber: r.invoiceNumber ?? r.invoice_number ?? 'POS',
        invoiceLineId: r.invoiceLineId ?? r.invoice_line_id,
        supplierInvoiceNumber: r.supplierInvoiceNumber ?? r.supplier_invoice_number,
        productName: r.productName ?? r.product_name,
        normalizedName: r.normalizedName ?? r.normalized_name,
        sellingPriceMinor: Number(r.sellingPriceMinor ?? r.selling_price_minor ?? 0),
        soldQuantity: Number(r.soldQuantity ?? r.sold_quantity ?? 0),
        reconciledQuantity: Number(r.reconciledQuantity ?? r.reconciled_quantity ?? 0),
        remainingQuantity: Number(r.remainingQuantity ?? r.remaining_quantity ?? 0),
        reconciliationStatus: r.reconciliationStatus ?? r.reconciliation_status ?? 'pending',
        matchedItemId: r.matchedItemId ?? r.matched_item_id ?? null,
        matchedVariantId: r.matchedVariantId ?? r.matched_variant_id ?? null,
        reconciledPurchaseId: r.reconciledPurchaseId ?? r.reconciled_purchase_id ?? null,
        reconciledAt: r.reconciledAt ?? r.reconciled_at ?? null,
        createdAt: r.createdAt ?? r.created_at,
        saleDate: r.saleDate ?? r.sale_date,
        customerName: r.customerName ?? r.customer_name,
      })),
      count: rows.length,
    };
  });

  // 2. Check temporary sales matches for a specific supplier invoice
  r.get('/api/temporary-sales/match', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const supplierInvoiceNumber = (ctx.query.supplierInvoiceNumber as string || '').trim().toUpperCase();

    if (!supplierInvoiceNumber) {
      return {
        ok: true,
        supplierInvoiceNumber: '',
        matches: [],
        totalUnreconciledQty: 0,
        hasPendingSales: false,
      };
    }

    const rows = await ctx.db.query<any>(
      `SELECT
        tps.id,
        tps.tenant_id,
        tps.branch_id,
        tps.invoice_id,
        i.number AS invoice_number,
        tps.invoice_line_id,
        tps.supplier_invoice_number,
        tps.product_name,
        tps.normalized_name,
        tps.selling_price_minor,
        tps.sold_quantity::float AS sold_quantity,
        tps.reconciled_quantity::float AS reconciled_quantity,
        tps.remaining_quantity::float AS remaining_quantity,
        tps.reconciliation_status,
        tps.matched_item_id,
        tps.matched_variant_id,
        tps.reconciled_purchase_id,
        tps.reconciled_at,
        tps.created_at,
        i.bdate AS sale_date,
        i.customer_name
       FROM temporary_product_sales tps
       JOIN invoices i ON tps.invoice_id = i.id
       WHERE tps.tenant_id = ?
         AND upper(trim(tps.supplier_invoice_number)) = ?
         AND tps.reconciliation_status != 'reconciled'
       ORDER BY tps.created_at DESC`,
      [tenantId, supplierInvoiceNumber],
    );

    const matches = rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId ?? r.tenant_id,
      branchId: r.branchId ?? r.branch_id,
      invoiceId: r.invoiceId ?? r.invoice_id,
      invoiceNumber: r.invoiceNumber ?? r.invoice_number ?? 'POS',
      invoiceLineId: r.invoiceLineId ?? r.invoice_line_id,
      supplierInvoiceNumber: r.supplierInvoiceNumber ?? r.supplier_invoice_number,
      productName: r.productName ?? r.product_name,
      normalizedName: r.normalizedName ?? r.normalized_name,
      sellingPriceMinor: Number(r.sellingPriceMinor ?? r.selling_price_minor ?? 0),
      soldQuantity: Number(r.soldQuantity ?? r.sold_quantity ?? 0),
      reconciledQuantity: Number(r.reconciledQuantity ?? r.reconciled_quantity ?? 0),
      remainingQuantity: Number(r.remainingQuantity ?? r.remaining_quantity ?? 0),
      reconciliationStatus: r.reconciliationStatus ?? r.reconciliation_status ?? 'pending',
      matchedItemId: r.matchedItemId ?? r.matched_item_id ?? null,
      matchedVariantId: r.matchedVariantId ?? r.matched_variant_id ?? null,
      reconciledPurchaseId: r.reconciledPurchaseId ?? r.reconciled_purchase_id ?? null,
      reconciledAt: r.reconciledAt ?? r.reconciled_at ?? null,
      createdAt: r.createdAt ?? r.created_at,
      saleDate: r.saleDate ?? r.sale_date,
      customerName: r.customerName ?? r.customer_name,
    }));

    const totalUnreconciledQty = matches.reduce((sum, m) => sum + m.remainingQuantity, 0);

    return {
      ok: true,
      supplierInvoiceNumber,
      matches,
      totalUnreconciledQty,
      hasPendingSales: matches.length > 0,
    };
  });

  // 3. Manual reconciliation of a temporary sale row with an inventory product
  r.post('/api/temporary-sales/:id/reconcile-manual', requirePerm('items.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const id = ctx.params.id;
    const b = ctx.body || {};

    const itemId = String(b.itemId || '').trim();
    const variantId = String(b.variantId || '').trim();
    const purchaseId = b.purchaseId ? String(b.purchaseId).trim() : null;

    if (!itemId) throw bad('itemId is required for manual reconciliation', 'VALIDATION');
    if (!variantId) throw bad('variantId is required for manual reconciliation', 'VALIDATION');

    const sale = await ctx.db.one<any>(
      'SELECT * FROM temporary_product_sales WHERE id = ? AND tenant_id = ?',
      [id, tenantId],
    );
    if (!sale) throw notFound('Temporary product sale record not found');

    const item = await ctx.db.one<any>(
      'SELECT id, name FROM items WHERE id = ? AND tenant_id = ?',
      [itemId, tenantId],
    );
    if (!item) throw notFound('Item not found');

    const variant = await ctx.db.one<any>(
      'SELECT id, product_id, stock_milli FROM variants WHERE id = ? AND tenant_id = ?',
      [variantId, tenantId],
    );
    if (!variant) throw notFound('Variant not found');

    const remainingQty = Number(sale.remaining_quantity ?? sale.remainingQuantity ?? 0);

    await ctx.db.tx(async (q) => {
      await q.exec(
        `UPDATE temporary_product_sales
         SET reconciled_quantity = sold_quantity,
             remaining_quantity = 0,
             reconciliation_status = 'reconciled',
             matched_item_id = ?,
             matched_variant_id = ?,
             reconciled_purchase_id = COALESCE(?, reconciled_purchase_id),
             reconciled_at = now(),
             updated_at = now()
         WHERE id = ? AND tenant_id = ?`,
        [itemId, variantId, purchaseId, id, tenantId],
      );

      // Backfill invoice_lines with item_id and variant_id
      if (sale.invoice_line_id || sale.invoiceLineId) {
        await q.exec(
          `UPDATE invoice_lines
           SET item_id = COALESCE(item_id, ?),
               variant_id = COALESCE(variant_id, ?)
           WHERE id = ? AND tenant_id = ?`,
          [itemId, variantId, sale.invoice_line_id ?? sale.invoiceLineId, tenantId],
        );
      }
    });

    const updated = await ctx.db.one<any>(
      'SELECT * FROM temporary_product_sales WHERE id = ? AND tenant_id = ?',
      [id, tenantId],
    );

    return {
      ok: true,
      message: `Reconciled "${sale.product_name}" with product "${item.name}"`,
      sale: updated,
    };
  });
}
