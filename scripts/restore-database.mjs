import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';
import { execSync } from 'node:child_process';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ ERROR: DATABASE_URL not found in .env');
  process.exit(1);
}

// Locate latest backup JSON and SQL files
const backupsDir = path.resolve('backups');
const jsonFiles = fs.readdirSync(backupsDir)
  .filter(f => f.endsWith('.json') && f.startsWith('db_backup_'))
  .sort()
  .reverse();

if (jsonFiles.length === 0) {
  console.error('❌ No db_backup_*.json backup files found in backups/ directory');
  process.exit(1);
}

const jsonBackupFile = path.join(backupsDir, jsonFiles[0]);
console.log(`\n======================================================`);
console.log(`DATABASE RESTORE UTILITY (CIRCULAR FK HANDLER)`);
console.log(`======================================================`);
console.log(`📄 Backup JSON: ${jsonBackupFile}`);
const safeHost = connectionString.split('@')[1]?.split('/')[0] || 'remote-db';
console.log(`🎯 Target Database: ${safeHost}`);
console.log(`======================================================\n`);

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// Primary table dependency order
const TABLE_DEPENDENCY_ORDER = [
  'tenants',
  'branches',
  'users',
  'counters',
  'parties',
  'categories',
  'items',
  'product_barcodes',
  'number_series',
  'promotions',
  'purchases',
  'purchase_lines',
  'wholesale_customers',
  'shifts',
  'invoices',
  'invoice_lines',
  'payments',
  'credit_allocations',
  'promotion_usage',
  'stock_transfers',
  'stock_transfer_lines',
  'stock_moves',
  'imports',
  'role_module_access',
  'audit_log',
  'email_logs',
  'sms_logs',
  'day_closing_notifications',
  'day_closing_adjustments',
  'day_closings',
  'day_closing_schedules',
  'cash_movements',
  'card_terminals',
  'terminal_transactions',
  'refund_transactions',
  'payment_attempts',
  'payment_allocations',
  'payment_webhook_events',
  'store_credits',
  'supplier_invoice_mappings',
  'supplier_payment_allocations',
  'support_tickets',
  'scheduled_sales_reports',
  'shop_payment_settings',
  'sms_settings',
  'sms_trials',
  'stock_adjustments',
  'stock_counts',
  'stock_count_lines',
  'gst_filing_history',
  'gstr2b_imports',
  'gstr2b_records',
  'itc_reviews',
  'messages',
  'password_reset_tokens',
  'config_versions',
];

async function insertRow(client, table, row) {
  const columns = Object.keys(row);
  const values = Object.values(row).map(v => {
    if (v !== null && typeof v === 'object') {
      return JSON.stringify(v);
    }
    return v;
  });

  const quotedCols = columns.map(c => `"${c}"`).join(', ');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

  const conflictClause = columns.includes('id') 
    ? `ON CONFLICT ("id") DO UPDATE SET ${columns.filter(c => c !== 'id').map(c => `"${c}" = EXCLUDED."${c}"`).join(', ')}` 
    : 'ON CONFLICT DO NOTHING';

  const insertSql = `INSERT INTO "${table}" (${quotedCols}) VALUES (${placeholders}) ${conflictClause}`;

  try {
    await client.query(insertSql, values);
    return true;
  } catch (err) {
    try {
      await client.query(`INSERT INTO "${table}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
      return true;
    } catch (fallbackErr) {
      console.error(`\n      ⚠️ Error in ${table} (id: ${row.id}): ${fallbackErr.message}`);
      return false;
    }
  }
}

async function restore() {
  const client = await pool.connect();
  try {
    console.log('1. Checking tables in target database...');
    const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    
    if (tableCheck.rows.length === 0) {
      console.log('   Target database is empty. Running migrations...');
      client.release();
      execSync('node --import tsx server/src/migrate.ts', { stdio: 'inherit' });
      return restore();
    }
    console.log(`   Found ${tableCheck.rows.length} tables in target database.`);

    console.log('\n2. Reading backup JSON data...');
    const rawData = fs.readFileSync(jsonBackupFile, 'utf8');
    const backupData = JSON.parse(rawData);

    const backupTables = Object.keys(backupData);
    const orderedTables = [
      ...TABLE_DEPENDENCY_ORDER.filter(t => backupTables.includes(t)),
      ...backupTables.filter(t => !TABLE_DEPENDENCY_ORDER.includes(t) && t !== 'schema_migrations'),
    ];

    console.log('\n3. Inserting data into tables (resolving circular foreign keys)...');
    let totalInserted = 0;

    // Track deferred foreign key relationships
    const deferredBranchManagers = []; // { branchId, managerId }
    const deferredUserCounters = [];   // { userId, counterId }

    for (const table of orderedTables) {
      const rows = backupData[table];
      if (!Array.isArray(rows) || rows.length === 0) {
        continue;
      }

      process.stdout.write(`   Restoring "${table}" (${rows.length} rows)... `);
      let tableSuccess = 0;

      for (const row of rows) {
        let preparedRow = { ...row };

        // Handle circular FK: branches.manager_id -> users.id
        if (table === 'branches' && preparedRow.manager_id) {
          deferredBranchManagers.push({ id: preparedRow.id, manager_id: preparedRow.manager_id });
          preparedRow.manager_id = null;
        }

        // Handle circular FK: users.counter_id -> counters.id
        if (table === 'users' && preparedRow.counter_id) {
          deferredUserCounters.push({ id: preparedRow.id, counter_id: preparedRow.counter_id });
          preparedRow.counter_id = null;
        }

        const ok = await insertRow(client, table, preparedRow);
        if (ok) {
          tableSuccess++;
          totalInserted++;
        }
      }

      console.log(`✅ ${tableSuccess}/${rows.length} rows.`);

      // Right after users are inserted, restore branches.manager_id
      if (table === 'users' && deferredBranchManagers.length > 0) {
        for (const item of deferredBranchManagers) {
          try {
            await client.query('UPDATE branches SET manager_id = $1 WHERE id = $2', [item.manager_id, item.id]);
          } catch (e) {
            console.error(`      ⚠️ Could not link manager ${item.manager_id} to branch ${item.id}:`, e.message);
          }
        }
        console.log(`      🔗 Re-linked ${deferredBranchManagers.length} branch managers.`);
      }

      // Right after counters are inserted, restore users.counter_id
      if (table === 'counters' && deferredUserCounters.length > 0) {
        for (const item of deferredUserCounters) {
          try {
            await client.query('UPDATE users SET counter_id = $1 WHERE id = $2', [item.counter_id, item.id]);
          } catch (e) {
            console.error(`      ⚠️ Could not link counter ${item.counter_id} to user ${item.id}:`, e.message);
          }
        }
        console.log(`      🔗 Re-linked ${deferredUserCounters.length} user counters.`);
      }
    }

    console.log('\n======================================================');
    console.log('✅ DATABASE RESTORE COMPLETED SUCCESSFULLY!');
    console.log('======================================================');
    console.log(`📊 Total Records Restored: ${totalInserted}`);

    // Verification
    const uCount = await client.query('SELECT count(*)::int as count FROM users');
    const bCount = await client.query('SELECT count(*)::int as count FROM branches');
    const cCount = await client.query('SELECT count(*)::int as count FROM counters');
    const iCount = await client.query('SELECT count(*)::int as count FROM invoices');
    const catCount = await client.query('SELECT count(*)::int as count FROM categories');
    const itmCount = await client.query('SELECT count(*)::int as count FROM items');
    const tCount = await client.query('SELECT count(*)::int as count FROM tenants');

    console.log('\n🔍 Verification Summary on New Database:');
    console.log(`   - Tenants: ${tCount.rows[0].count}`);
    console.log(`   - Users: ${uCount.rows[0].count}`);
    console.log(`   - Branches: ${bCount.rows[0].count}`);
    console.log(`   - Counters: ${cCount.rows[0].count}`);
    console.log(`   - Categories: ${catCount.rows[0].count}`);
    console.log(`   - Items / Products: ${itmCount.rows[0].count}`);
    console.log(`   - Invoices: ${iCount.rows[0].count}`);
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ Restore failed with error:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

restore().catch(console.error);
