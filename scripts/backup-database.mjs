import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ ERROR: DATABASE_URL not found in .env');
  process.exit(1);
}

const safeHost = connectionString.split('@')[1]?.split('/')[0] || 'remote-db';
console.log(`Connecting to database at ${safeHost}...`);

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log(' Connected to PostgreSQL database successfully!\n');

  // 1. Fetch all public tables
  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name ASC;
  `);

  const tables = tablesRes.rows.map(r => r.table_name);
  console.log(`Found ${tables.length} tables in database:`);

  // Ensure backups directory exists
  const backupsDir = path.resolve('backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sqlBackupPath = path.join(backupsDir, `db_backup_${timestamp}.sql`);
  const jsonBackupPath = path.join(backupsDir, `db_backup_${timestamp}.json`);

  const sqlStream = fs.createWriteStream(sqlBackupPath, { encoding: 'utf8' });
  const fullJsonData = {};
  const manifest = {
    timestamp: now.toISOString(),
    databaseHost: safeHost,
    totalTables: tables.length,
    tableRowCounts: {},
    totalRows: 0,
  };

  // Write SQL Header
  sqlStream.write(`-- ====================================================================\n`);
  sqlStream.write(`-- DATABASE BACKUP: ${safeHost}\n`);
  sqlStream.write(`-- CREATED AT: ${now.toISOString()}\n`);
  sqlStream.write(`-- ====================================================================\n\n`);
  sqlStream.write(`BEGIN;\n`);
  sqlStream.write(`SET client_encoding = 'UTF8';\n`);
  sqlStream.write(`SET standard_conforming_strings = on;\n`);
  sqlStream.write(`SET check_function_bodies = false;\n\n`);

  for (const table of tables) {
    process.stdout.write(` Backing up table "${table}"... `);

    // Get table columns
    const colsRes = await client.query(`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position ASC;
    `, [table]);

    const columns = colsRes.rows.map(c => c.column_name);
    const colTypes = Object.fromEntries(colsRes.rows.map(c => [c.column_name, c.udt_name]));

    // Fetch all rows
    const dataRes = await client.query(`SELECT * FROM "${table}"`);
    const rowCount = dataRes.rows.length;
    manifest.tableRowCounts[table] = rowCount;
    manifest.totalRows += rowCount;
    fullJsonData[table] = dataRes.rows;

    console.log(`${rowCount} rows`);

    if (rowCount > 0) {
      sqlStream.write(`\n-- Table: "${table}" (${rowCount} rows)\n`);
      const colListStr = columns.map(c => `"${c}"`).join(', ');

      for (const row of dataRes.rows) {
        const valListStr = columns.map(c => {
          const val = row[c];
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
          if (typeof val === 'number') return String(val);
          if (typeof val === 'bigint') return String(val);
          if (val instanceof Date) return `'${val.toISOString()}'`;
          if (typeof val === 'object') {
            const jsonStr = JSON.stringify(val).replace(/'/g, "''");
            return `'${jsonStr}'::jsonb`;
          }
          // String escaping
          const escaped = String(val).replace(/'/g, "''");
          return `'${escaped}'`;
        }).join(', ');

        sqlStream.write(`INSERT INTO "${table}" (${colListStr}) VALUES (${valListStr});\n`);
      }
    }
  }

  sqlStream.write(`\nCOMMIT;\n`);
  sqlStream.write(`-- ====================================================================\n`);
  sqlStream.write(`-- BACKUP COMPLETED: ${manifest.totalRows} rows across ${tables.length} tables\n`);
  sqlStream.write(`-- ====================================================================\n`);
  sqlStream.end();

  // Save JSON format as well
  fs.writeFileSync(jsonBackupPath, JSON.stringify(fullJsonData, null, 2), 'utf8');

  // Summary file
  const summaryPath = path.join(backupsDir, `backup_manifest_${timestamp}.json`);
  manifest.sqlFile = path.basename(sqlBackupPath);
  manifest.jsonFile = path.basename(jsonBackupPath);
  manifest.sqlSizeBytes = fs.statSync(sqlBackupPath).size;
  manifest.jsonSizeBytes = fs.statSync(jsonBackupPath).size;
  fs.writeFileSync(summaryPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log('\n======================================================');
  console.log('✅ DATABASE BACKUP COMPLETED SUCCESSFULLY!');
  console.log('======================================================');
  console.log(`📊 Total Tables: ${manifest.totalTables}`);
  console.log(`📈 Total Records: ${manifest.totalRows}`);
  console.log(`📄 SQL Backup: ${sqlBackupPath} (${(manifest.sqlSizeBytes / 1024).toFixed(2)} KB)`);
  console.log(`📄 JSON Backup: ${jsonBackupPath} (${(manifest.jsonSizeBytes / 1024).toFixed(2)} KB)`);
  console.log(`📋 Manifest: ${summaryPath}`);
  console.log('======================================================\n');

} catch (err) {
  console.error('\n❌ Backup failed with error:', err);
  process.exit(1);
} finally {
  await client.end();
}
