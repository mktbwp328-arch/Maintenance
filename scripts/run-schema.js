// One-time migration runner: applies supabase_schema.sql to a Postgres database.
// Usage:
//   node scripts/run-schema.js "postgresql://user:pass@host:port/postgres"
// or set DATABASE_URL in the environment and run:
//   node scripts/run-schema.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const conn = process.argv[2] || process.env.DATABASE_URL;
// If no URL given, fall back to PG* env vars (PGHOST/PGUSER/PGPASSWORD/PGPORT/PGDATABASE).
// Passing the password via env avoids URL-encoding issues with special chars like '@'.
const clientConfig = conn
  ? { connectionString: conn, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT) || 5432,
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE || 'postgres',
      ssl: { rejectUnauthorized: false },
    };
if (!conn && !process.env.PGHOST) {
  console.error('❌ กรุณาระบุ connection string เป็น argument หรือ env PGHOST/PGPASSWORD');
  process.exit(1);
}

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase_schema.sql'), 'utf8');
const client = new pg.Client(clientConfig);

try {
  await client.connect();
  console.log('🔌 เชื่อมต่อฐานข้อมูลสำเร็จ');
  await client.query(sql);
  console.log('✅ รัน schema สำเร็จ — สร้างตารางและฟังก์ชันเรียบร้อย');
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema='public' order by table_name"
  );
  console.log('   ตารางในschema public:', rows.map((r) => r.table_name).join(', '));
} catch (e) {
  console.error('❌ เกิดข้อผิดพลาด:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
