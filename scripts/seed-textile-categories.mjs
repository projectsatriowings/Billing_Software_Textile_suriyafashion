import pg from 'pg';
import crypto from 'node:crypto';

try { process.loadEnvFile('.env'); } catch {}

const url = String(process.env.DATABASE_URL || '').replace(/&?channel_binding=require/, '');
const client = new pg.Client({ connectionString: url });
await client.connect();

const TEXTILE_CATEGORIES = [
  {
    name: "Men's Wear",
    description: "Men's clothing and apparel",
    subcategories: ['Shirts', 'T-Shirts', 'Trousers', 'Jeans'],
  },
  {
    name: "Women's Wear",
    description: "Women's clothing and ethnic wear",
    subcategories: ['Dresses', 'Kurtis', 'Sarees', 'Leggings'],
  },
  {
    name: "Boys' Wear",
    description: "Boys' clothing and outfits",
    subcategories: ['Shirts', 'T-Shirts', 'Shorts'],
  },
  {
    name: "Girls' Wear",
    description: "Girls' clothing and dresses",
    subcategories: ['Dresses', 'Tops', 'Leggings'],
  },
  {
    name: 'Footwear',
    description: 'Slippers, shoes, and footwear',
    subcategories: ["Men's Slippers", "Women's Slippers", "Kids' Footwear"],
  },
  {
    name: 'Household',
    description: 'Containers, kitchen items, and home goods',
    subcategories: ['Containers', 'Kitchen Items'],
  },
  {
    name: 'Accessories',
    description: 'Hair and fashion accessories',
    subcategories: ['Hair Accessories', 'Fashion Accessories'],
  },
  {
    name: 'Other Products',
    description: 'General retail products and other items',
    subcategories: ['General Items'],
  },
];

function newId(prefix = 'cat') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

try {
  await client.query('BEGIN');

  const tenantsRes = await client.query('SELECT id, name FROM tenants');
  console.log(`Seeding categories for ${tenantsRes.rows.length} tenant(s)...`);

  const parentRows = [];
  const subRows = [];

  for (const tenant of tenantsRes.rows) {
    const tenantId = tenant.id;
    const branchesRes = await client.query('SELECT id FROM branches WHERE tenant_id = $1', [tenantId]);
    const branchIds = branchesRes.rows.length > 0 ? branchesRes.rows.map(b => b.id) : [null];

    for (const branchId of branchIds) {
      for (const catDef of TEXTILE_CATEGORIES) {
        const parentId = newId('cat');
        parentRows.push({
          id: parentId,
          tenantId,
          branchId,
          name: catDef.name,
          description: catDef.description,
        });

        for (const subName of catDef.subcategories) {
          const subId = newId('cat');
          subRows.push({
            id: subId,
            tenantId,
            branchId,
            name: subName,
            description: `${catDef.name} - ${subName}`,
            parentId,
          });
        }
      }
    }
  }

  // Batch insert parents
  if (parentRows.length > 0) {
    const CHUNK_SIZE = 50;
    for (let i = 0; i < parentRows.length; i += CHUNK_SIZE) {
      const chunk = parentRows.slice(i, i + CHUNK_SIZE);
      const values = [];
      const placeholders = [];
      let idx = 1;
      for (const row of chunk) {
        placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, true, NULL, now(), now())`);
        values.push(row.id, row.tenantId, row.branchId, row.name, row.description);
        idx += 5;
      }
      await client.query(
        `INSERT INTO categories (id, tenant_id, branch_id, name, description, active, parent_id, created_at, updated_at)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (tenant_id, COALESCE(branch_id, ''), COALESCE(parent_id, ''), lower(name)) DO NOTHING`,
        values
      );
    }
  }

  // Batch insert subcategories
  if (subRows.length > 0) {
    const CHUNK_SIZE = 50;
    for (let i = 0; i < subRows.length; i += CHUNK_SIZE) {
      const chunk = subRows.slice(i, i + CHUNK_SIZE);
      const values = [];
      const placeholders = [];
      let idx = 1;
      for (const row of chunk) {
        placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, true, $${idx+5}, now(), now())`);
        values.push(row.id, row.tenantId, row.branchId, row.name, row.description, row.parentId);
        idx += 6;
      }
      await client.query(
        `INSERT INTO categories (id, tenant_id, branch_id, name, description, active, parent_id, created_at, updated_at)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (tenant_id, COALESCE(branch_id, ''), COALESCE(parent_id, ''), lower(name)) DO NOTHING`,
        values
      );
    }
  }

  await client.query('COMMIT');
  console.log('Successfully batch-seeded categories!');

  const countRes = await client.query('SELECT count(*)::int as total FROM categories');
  const parentCount = await client.query('SELECT count(*)::int as parents FROM categories WHERE parent_id IS NULL');
  const subCount = await client.query('SELECT count(*)::int as subs FROM categories WHERE parent_id IS NOT NULL');
  console.log(`Categories count: ${countRes.rows[0].total} (Parents: ${parentCount.rows[0].parents}, Subcategories: ${subCount.rows[0].subs})`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error('Batch seeding failed:', err);
  process.exitCode = 1;
} finally {
  await client.end();
}
