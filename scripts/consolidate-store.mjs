import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const tenantId = 't_demo_supermarket';
  const mainBranchId = 'br_main_store';

  console.log('Inspecting categories and items in non-main branches...');
  const catRows = await pool.query(
    `SELECT id, name, branch_id FROM categories WHERE tenant_id = $1 AND branch_id != $2`,
    [tenantId, mainBranchId]
  );
  console.log('Categories in non-main branches:', catRows.rows);

  const itemRows = await pool.query(
    `SELECT id, name, branch_id, category_id FROM items WHERE tenant_id = $1 AND branch_id != $2`,
    [tenantId, mainBranchId]
  );
  console.log('Items in non-main branches:', itemRows.rows);

  // If items in other branches exist, reassign them to matching category or main branch
  // Check if items reference any of those categories
  const nonMainCatIds = catRows.rows.map(c => c.id);
  if (nonMainCatIds.length > 0) {
    const itemsUsingNonMainCats = await pool.query(
      `SELECT id, name, category_id FROM items WHERE category_id = ANY($1)`,
      [nonMainCatIds]
    );
    console.log('Items using non-main categories:', itemsUsingNonMainCats.rows);

    // If no items use them or if we re-point them to main store categories:
    // First map non-main categories to main categories by name if possible
    const mainCats = await pool.query(
      `SELECT id, name FROM categories WHERE tenant_id = $1 AND branch_id = $2`,
      [tenantId, mainBranchId]
    );
    const mainCatMap = new Map(mainCats.rows.map(c => [c.name.toLowerCase(), c.id]));

    for (const nonMainCat of catRows.rows) {
      const match = mainCatMap.get(nonMainCat.name.toLowerCase());
      if (match) {
        await pool.query(
          `UPDATE items SET category_id = $1 WHERE category_id = $2`,
          [match, nonMainCat.id]
        );
      }
    }

    // Now delete unused categories in other branches
    await pool.query(
      `DELETE FROM categories WHERE tenant_id = $1 AND branch_id != $2`,
      [tenantId, mainBranchId]
    );
    console.log('Deleted non-main categories.');
  }

  // Now delete extra branches
  const delRes = await pool.query(
    `DELETE FROM branches WHERE tenant_id = $1 AND id != $2`,
    [tenantId, mainBranchId]
  );
  console.log(`Deleted ${delRes.rowCount} extra branches.`);

  // Set branch name
  await pool.query(
    `UPDATE branches SET name = 'Main Supermarket Store', code = 'MAIN' WHERE id = $1`,
    [mainBranchId]
  );

  const branches = await pool.query(
    `SELECT id, name, code, tenant_id FROM branches WHERE tenant_id = $1`,
    [tenantId]
  );
  console.log('Remaining branches for supermarket:', branches.rows);

  await pool.end();
}

main().catch((err) => {
  console.error('Consolidation error:', err);
  process.exit(1);
});
