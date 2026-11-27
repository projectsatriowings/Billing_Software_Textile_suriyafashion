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

// Find the latest backup file or use argument
const backupsDir = path.resolve('backups');
let backupFile = process.argv[2];

if (!backupFile) {
  const files = fs.readdirSync(backupsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .reverse();
  if (files.length === 0) {
    console.error('❌ No .sql backup files found in backups/ directory');
    process.exit(1);
  }
  backupFile = path.join(backupsDir, files[0]);
} else if (!path.isAbsolute(backupFile)) {
  backupFile = path.resolve(backupFile);
}

console.log(`\n======================================================`);
console.log(`DATABASE RESTORE UTILITY`);
console.log(`======================================================`);
console.log(`📄 Backup File: ${backupFile}`);
const safeHost = connectionString.split('@')[1]?.split('/')[0] || 'remote-db';
console.log(`🎯 Target Database: ${safeHost}`);
console.log(`======================================================\n`);

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  console.log('1. Connecting to target database...');
  await client.connect();
  console.log('   Connected successfully!');

  // Check if tables exist. If empty, run migrations first
  const tableCheck = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);
  
  if (tableCheck.rows.length === 0) {
    console.log('\n2. Target database is empty. Running schema migrations...');
    await client.end();
    execSync('node --import tsx server/src/migrate.ts', { stdio: 'inherit' });
    console.log('   Migrations completed successfully!');
    await client.connect();
  } else {
    console.log(`\n2. Found ${tableCheck.rows.length} existing tables in target database.`);
  }

  console.log('\n3. Restoring data from SQL backup (disabling constraints during insert)...');
  let sql = fs.readFileSync(backupFile, 'utf8');

  // Ensure replication role disables FK checks during load
  await client.query("SET session_replication_role = 'replica';");
  await client.query(sql);
  await client.query("SET session_replication_role = 'origin';");

  // Verify record count
  const verifyRes = await client.query(`
    SELECT count(*)::int as count FROM users
  `);
  const branchCount = await client.query(`
    SELECT count(*)::int as count FROM branches
  `);

  console.log('\n======================================================');
  console.log('✅ DATABASE RESTORE COMPLETED SUCCESSFULLY!');
  console.log('======================================================');
  console.log(`📊 Users Restored: ${verifyRes.rows[0].count}`);
  console.log(`🏢 Branches Restored: ${branchCount.rows[0].count}`);
  console.log('======================================================\n');
} catch (err) {
  console.error('\n❌ Restore failed with error:', err);
  process.exit(1);
} finally {
  try { await client.end(); } catch {}
}
