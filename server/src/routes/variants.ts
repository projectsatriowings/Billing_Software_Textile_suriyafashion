import { requirePerm } from '../auth.ts';
import { bad, conflict, notFound, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { audit } from '../audit.ts';

export function formatVariant(r: any) {
  return {
    id: r.id,
    tenantId: r.tenantId ?? r.tenant_id,
    productId: r.productId ?? r.product_id,
    size: r.size ?? null,
    colour: r.colour ?? null,
    pattern: r.pattern ?? null,
    sku: r.sku ?? null,
    barcode: r.barcode ?? null,
    priceMinor: Number(r.priceMinor ?? r.price_minor ?? 0),
    mrpMinor: r.mrpMinor != null || r.mrp_minor != null ? Number(r.mrpMinor ?? r.mrp_minor) : null,
    costMinor: Number(r.costMinor ?? r.cost_minor ?? 0),
    stockMilli: Number(r.stockMilli ?? r.stock_milli ?? 0),
    reorderLevelMilli: Number(r.reorderLevelMilli ?? r.reorder_level_milli ?? 0),
    active: Boolean(r.active ?? true),
    createdAt: r.createdAt ?? r.created_at,
    updatedAt: r.updatedAt ?? r.updated_at,
  };
}

export function registerVariants(r: Router) {
  // 1. List all variants for a product
  r.get('/api/items/:id/variants', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const productId = ctx.params.id;

    const rows = await ctx.db.query(
      `SELECT * FROM variants WHERE tenant_id = ? AND product_id = ? ORDER BY size ASC, colour ASC, created_at ASC`,
      [tenantId, productId],
    );

    return { variants: rows.map(formatVariant) };
  });

  // 2. Batch create/update variants for a product (Variant Matrix)
  r.post('/api/items/:id/variants', requirePerm('items.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const productId = ctx.params.id;
    const b = ctx.body ?? {};

    const item = await ctx.db.one('SELECT * FROM items WHERE id = ? AND tenant_id = ?', [productId, tenantId]);
    if (!item) throw notFound('Product');

    const variantsList = V.arr(b.variants, 'Variants list', { min: 1 });

    return ctx.db.tx(async (q) => {
      // Ensure product is marked as item_type = 'variant'
      await q.exec(`UPDATE items SET item_type = 'variant', updated_at = now() WHERE id = ? AND tenant_id = ?`, [productId, tenantId]);

      const savedVariants: any[] = [];

      for (let i = 0; i < variantsList.length; i++) {
        const v = variantsList[i];
        const size = V.optStr(v.size, 'Size', 40) || null;
        const colour = V.optStr(v.colour, 'Colour', 40) || null;
        const pattern = V.optStr(v.pattern, 'Pattern', 50) || null;
        const priceMinor = V.int(v.priceMinor ?? item.price_minor ?? 0, 'Price', { min: 0 });
        const mrpMinor = v.mrpMinor != null ? V.int(v.mrpMinor, 'MRP', { min: 0 }) : (item.mrp_minor || null);
        const costMinor = V.int(v.costMinor ?? item.cost_minor ?? 0, 'Cost', { min: 0 });
        const stockMilli = V.int(v.stockMilli ?? 0, 'Stock', { min: 0 });
        const reorderLevelMilli = V.int(v.reorderLevelMilli ?? item.reorder_milli ?? 0, 'Reorder level', { min: 0 });
        const active = v.active !== false;

        // Auto-generate variant SKU if not provided: parentSku-SIZE-COLOUR or P-SIZE-COLOUR
        let sku = V.optStr(v.sku, 'SKU', 60);
        if (!sku) {
          const parentSku = (item.sku || item.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6)).toUpperCase();
          const sTag = size ? `-${size.replace(/\s+/g, '')}` : '';
          const cTag = colour ? `-${colour.replace(/\s+/g, '')}` : '';
          sku = `${parentSku}${sTag}${cTag}`;
        }

        // Auto-generate barcode if not provided
        let barcode = V.optStr(v.barcode, 'Barcode', 60);
        if (!barcode) {
          const rnd = Math.floor(10000000000 + Math.random() * 90000000000);
          barcode = `29${rnd}`; // 13-digit internal EAN format
        }

        let variantId = V.optStr(v.id, 'Variant ID', 60);
        if (variantId) {
          const existing = await q.one('SELECT id FROM variants WHERE id = ? AND tenant_id = ?', [variantId, tenantId]);
          if (existing) {
            await q.exec(
              `UPDATE variants SET
                size = ?, colour = ?, pattern = ?, sku = ?, barcode = ?,
                price_minor = ?, mrp_minor = ?, cost_minor = ?, stock_milli = ?, reorder_level_milli = ?,
                active = ?, updated_at = now()
               WHERE id = ? AND tenant_id = ?`,
              [size, colour, pattern, sku, barcode, priceMinor, mrpMinor, costMinor, stockMilli, reorderLevelMilli, active, variantId, tenantId],
            );
            savedVariants.push(await q.one('SELECT * FROM variants WHERE id = ?', [variantId]));
            continue;
          }
        }

        variantId = newId('var');
        await q.exec(
          `INSERT INTO variants (
            id, tenant_id, product_id, size, colour, pattern, sku, barcode,
            price_minor, mrp_minor, cost_minor, stock_milli, reorder_level_milli, active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [variantId, tenantId, productId, size, colour, pattern, sku, barcode, priceMinor, mrpMinor, costMinor, stockMilli, reorderLevelMilli, active],
        );

        savedVariants.push(await q.one('SELECT * FROM variants WHERE id = ?', [variantId]));
      }

      // Update parent product stock to sum of all variant stocks
      const totalStockRow = await q.one<{ total: string }>(
        `SELECT COALESCE(SUM(stock_milli), 0) AS total FROM variants WHERE tenant_id = ? AND product_id = ? AND active = TRUE`,
        [tenantId, productId],
      );
      const totalStockMilli = Number(totalStockRow?.total || 0);
      if (item.track_stock && totalStockMilli > 0) {
        await q.exec(`UPDATE items SET active = TRUE, deactivation_reason = NULL, updated_at = now() WHERE id = ?`, [productId]);
      }

      await audit(q, ctx, { action: 'product.variants.save', entity: 'product', entityId: productId, detail: { count: savedVariants.length } });
      return { variants: savedVariants.map(formatVariant) };
    });
  });

  // 3. Update a single variant
  r.put('/api/variants/:variantId', requirePerm('items.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const variantId = ctx.params.variantId;
    const b = ctx.body ?? {};

    const cur = await ctx.db.one('SELECT * FROM variants WHERE id = ? AND tenant_id = ?', [variantId, tenantId]);
    if (!cur) throw notFound('Variant');

    const size = V.optStr(b.size, 'Size', 40) ?? cur.size;
    const colour = V.optStr(b.colour, 'Colour', 40) ?? cur.colour;
    const pattern = V.optStr(b.pattern, 'Pattern', 50) ?? cur.pattern;
    const sku = V.optStr(b.sku, 'SKU', 60) ?? cur.sku;
    const barcode = V.optStr(b.barcode, 'Barcode', 60) ?? cur.barcode;
    const priceMinor = b.priceMinor !== undefined ? V.int(b.priceMinor, 'Price', { min: 0 }) : Number(cur.price_minor);
    const mrpMinor = b.mrpMinor !== undefined ? (b.mrpMinor != null ? V.int(b.mrpMinor, 'MRP', { min: 0 }) : null) : (cur.mrp_minor ? Number(cur.mrp_minor) : null);
    const costMinor = b.costMinor !== undefined ? V.int(b.costMinor, 'Cost', { min: 0 }) : Number(cur.cost_minor);
    const stockMilli = b.stockMilli !== undefined ? V.int(b.stockMilli, 'Stock', { min: 0 }) : Number(cur.stock_milli);
    const reorderLevelMilli = b.reorderLevelMilli !== undefined ? V.int(b.reorderLevelMilli, 'Reorder Level', { min: 0 }) : Number(cur.reorder_level_milli);
    const active = b.active !== undefined ? Boolean(b.active) : Boolean(cur.active);

    await ctx.db.exec(
      `UPDATE variants SET
        size = ?, colour = ?, pattern = ?, sku = ?, barcode = ?,
        price_minor = ?, mrp_minor = ?, cost_minor = ?, stock_milli = ?, reorder_level_milli = ?,
        active = ?, updated_at = now()
       WHERE id = ? AND tenant_id = ?`,
      [size, colour, pattern, sku, barcode, priceMinor, mrpMinor, costMinor, stockMilli, reorderLevelMilli, active, variantId, tenantId],
    );

    const updated = await ctx.db.one('SELECT * FROM variants WHERE id = ?', [variantId]);
    return { variant: formatVariant(updated) };
  });

  // 4. Delete or deactivate variant
  r.delete('/api/variants/:variantId', requirePerm('items.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const variantId = ctx.params.variantId;

    const cur = await ctx.db.one('SELECT * FROM variants WHERE id = ? AND tenant_id = ?', [variantId, tenantId]);
    if (!cur) throw notFound('Variant');

    // Check if variant has been used in sales
    const usedInSales = await ctx.db.one('SELECT 1 AS x FROM invoice_lines WHERE variant_id = ? LIMIT 1', [variantId]);
    if (usedInSales) {
      // Soft-delete by marking inactive
      await ctx.db.exec('UPDATE variants SET active = FALSE, updated_at = now() WHERE id = ?', [variantId]);
    } else {
      await ctx.db.exec('DELETE FROM variants WHERE id = ?', [variantId]);
    }

    return { ok: true };
  });

  // 5. Fast scanner / search lookup by barcode or SKU for POS
  r.get('/api/variants/lookup', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const q = (ctx.query.q ?? '').trim();
    if (!q) return { matches: [] };

    const rows = await ctx.db.query(
      `SELECT v.*, i.name AS product_name, i.category_id, i.subcategory_id, i.tax_rate_bp
       FROM variants v
       JOIN items i ON i.id = v.product_id AND i.tenant_id = v.tenant_id
       WHERE v.tenant_id = ? AND v.active = TRUE AND (
         v.barcode = ? OR lower(v.sku) = lower(?) OR lower(v.size) = lower(?)
       )
       LIMIT 10`,
      [tenantId, q, q, q],
    );

    return {
      matches: rows.map((r: any) => ({
        ...formatVariant(r),
        productName: r.product_name,
        categoryId: r.category_id,
        subcategoryId: r.subcategory_id,
        taxRateBp: Number(r.tax_rate_bp || 0),
      })),
    };
  });

  // 6. Attributes Master (Sizes, Colours, Patterns)
  r.get('/api/attributes', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const rows = await ctx.db.query('SELECT * FROM attributes WHERE tenant_id = ? ORDER BY type ASC, name ASC', [tenantId]);

    // Provide default sizes and colours if empty
    const defaults = [
      { id: 'def-size', type: 'size', name: 'Standard Sizes', values: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', 'Free Size', '28', '30', '32', '34', '36', '38', '40', '42'] },
      { id: 'def-colour', type: 'colour', name: 'Standard Colours', values: ['Red', 'Blue', 'Navy', 'Black', 'White', 'Green', 'Yellow', 'Pink', 'Maroon', 'Grey', 'Orange', 'Beige', 'Multicolour'] },
      { id: 'def-pattern', type: 'pattern', name: 'Patterns', values: ['Plain', 'Printed', 'Floral', 'Striped', 'Checked', 'Embroidered', 'Polka Dot'] },
    ];

    if (!rows.length) {
      return { attributes: defaults };
    }

    return {
      attributes: rows.map((r: any) => ({
        id: r.id,
        type: r.type,
        name: r.name,
        values: typeof r.values === 'string' ? JSON.parse(r.values) : (r.values ?? []),
      })),
    };
  });

  r.post('/api/attributes', requirePerm('items.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};
    const type = V.oneOf(b.type, 'Type', ['size', 'colour', 'pattern'] as const);
    const name = V.str(b.name, 'Name', { required: true, max: 80 });
    const values = V.arr(b.values, 'Values');

    const id = b.id || newId('attr');
    await ctx.db.exec(
      `INSERT INTO attributes (id, tenant_id, name, type, values)
       VALUES (?, ?, ?, ?, ?::jsonb)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, values = EXCLUDED.values`,
      [id, tenantId, name, type, JSON.stringify(values)],
    );

    return { ok: true, id };
  });
}
