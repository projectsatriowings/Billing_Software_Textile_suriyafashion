import { requirePerm } from '../auth.ts';
import { type Router } from '../http.ts';

export function registerTextileReports(r: Router) {
  // 1. Size-wise & colour-wise sales and current stock report
  r.get('/api/reports/variants/sales-stock', requirePerm('reports'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;

    const rows = await ctx.db.query(
      `SELECT
        v.id AS variant_id,
        v.product_id,
        i.name AS product_name,
        COALESCE(c.name, 'Uncategorized') AS category_name,
        COALESCE(v.size, 'Standard') AS size,
        COALESCE(v.colour, 'Standard') AS colour,
        COALESCE(v.pattern, '') AS pattern,
        v.sku,
        v.barcode,
        v.price_minor,
        v.cost_minor,
        v.stock_milli,
        COALESCE(SUM(il.qty_milli), 0) AS sold_qty_milli,
        COALESCE(SUM(il.total_minor), 0) AS total_revenue_minor
       FROM variants v
       JOIN items i ON i.id = v.product_id AND i.tenant_id = v.tenant_id
       LEFT JOIN categories c ON c.id = i.category_id
       LEFT JOIN invoice_lines il ON il.variant_id = v.id AND il.tenant_id = v.tenant_id
       WHERE v.tenant_id = ? AND v.active = TRUE
       GROUP BY v.id, v.product_id, i.name, c.name, v.size, v.colour, v.pattern, v.sku, v.barcode, v.price_minor, v.cost_minor, v.stock_milli
       ORDER BY i.name ASC, v.size ASC, v.colour ASC`,
      [tenantId],
    );

    return {
      report: rows.map((r: any) => ({
        variantId: r.variant_id,
        productId: r.product_id,
        productName: r.product_name,
        categoryName: r.category_name,
        size: r.size,
        colour: r.colour,
        pattern: r.pattern,
        sku: r.sku,
        barcode: r.barcode,
        priceMinor: Number(r.price_minor),
        costMinor: Number(r.cost_minor),
        stockMilli: Number(r.stock_milli),
        soldQtyMilli: Number(r.sold_qty_milli),
        totalRevenueMinor: Number(r.total_revenue_minor),
      })),
    };
  });

  // 2. Dead-stock ageing by variant (stock > 0 and no sales in N days)
  r.get('/api/reports/variants/dead-stock', requirePerm('reports'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const days = Number(ctx.query.days || 30);

    const rows = await ctx.db.query(
      `SELECT
        v.id AS variant_id,
        v.product_id,
        i.name AS product_name,
        v.size,
        v.colour,
        v.sku,
        v.barcode,
        v.price_minor,
        v.cost_minor,
        v.stock_milli,
        (v.stock_milli * v.cost_minor / 1000)::bigint AS stock_value_minor,
        MAX(inv.created_at) AS last_sold_at,
        v.created_at AS variant_created_at
       FROM variants v
       JOIN items i ON i.id = v.product_id AND i.tenant_id = v.tenant_id
       LEFT JOIN invoice_lines il ON il.variant_id = v.id AND il.tenant_id = v.tenant_id
       LEFT JOIN invoices inv ON inv.id = il.invoice_id AND inv.tenant_id = v.tenant_id
       WHERE v.tenant_id = ? AND v.active = TRUE AND v.stock_milli > 0
       GROUP BY v.id, v.product_id, i.name, v.size, v.colour, v.sku, v.barcode, v.price_minor, v.cost_minor, v.stock_milli, v.created_at
       HAVING MAX(inv.created_at) IS NULL OR MAX(inv.created_at) < (now() - (? || ' days')::interval)
       ORDER BY v.stock_milli DESC`,
      [tenantId, days.toString()],
    );

    return {
      report: rows.map((r: any) => ({
        variantId: r.variant_id,
        productId: r.product_id,
        productName: r.product_name,
        size: r.size,
        colour: r.colour,
        sku: r.sku,
        barcode: r.barcode,
        priceMinor: Number(r.price_minor),
        costMinor: Number(r.cost_minor),
        stockMilli: Number(r.stock_milli),
        stockValueMinor: Number(r.stock_value_minor || 0),
        lastSoldAt: r.last_sold_at,
        variantCreatedAt: r.variant_created_at,
      })),
    };
  });

  // 3. Pending Stitching Report
  r.get('/api/reports/tailoring/pending', requirePerm('reports'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;

    const rows = await ctx.db.query(
      `SELECT
        tlo.*,
        m.chest, m.waist, m.length, m.shoulder
       FROM tailoring_orders tlo
       LEFT JOIN measurements m ON m.id = tlo.measurement_id
       WHERE tlo.tenant_id = ? AND tlo.status IN ('pending', 'in_progress')
       ORDER BY tlo.due_date ASC`,
      [tenantId],
    );

    return {
      report: rows.map((r: any) => ({
        id: r.id,
        orderNumber: r.order_number,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        serviceType: r.service_type,
        description: r.description,
        dueDate: r.due_date,
        status: r.status,
        totalMinor: Number(r.total_minor),
        advancePaidMinor: Number(r.advance_paid_minor),
        balanceMinor: Number(r.balance_minor),
        chest: r.chest,
        waist: r.waist,
        length: r.length,
        shoulder: r.shoulder,
      })),
    };
  });
}
