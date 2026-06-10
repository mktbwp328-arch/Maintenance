// Adds created_by to tickets (the username who reported it) and backfills demo data.
import pg from 'pg';
const conn = process.env.DATABASE_URL;
const client = new pg.Client(conn
  ? { connectionString: conn, ssl: { rejectUnauthorized: false } }
  : { host: process.env.PGHOST, port: Number(process.env.PGPORT) || 5432, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE || 'postgres', ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('alter table tickets add column if not exists created_by text');
// backfill demo: map reporter names to the two demo reporter accounts
const r1 = await client.query("update tickets set created_by='phattara' where reporter='ภัทรพร ประกอบกิจ' and created_by is null returning id");
const r2 = await client.query("update tickets set created_by='user' where reporter='สมบูรณ์ ปานพิญใจ' and created_by is null returning id");
console.log(`✅ created_by เพิ่มแล้ว — phattara: ${r1.rowCount} ใบ, user: ${r2.rowCount} ใบ`);
await client.end();
