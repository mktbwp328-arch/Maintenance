// Creates a dedicated `buildings` registry table and seeds the 3 default buildings.
import pg from 'pg';
const conn = process.env.DATABASE_URL;
const client = new pg.Client(conn
  ? { connectionString: conn, ssl: { rejectUnauthorized: false } }
  : { host: process.env.PGHOST, port: Number(process.env.PGPORT) || 5432, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE || 'postgres', ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(`create table if not exists public.buildings (
  name text primary key, note text default '', created_at timestamptz default now()
)`);
await client.query('alter table public.buildings enable row level security');
const seed = [
  ['อาคาร 1', 'สายการผลิตเป่า (Blowing Production)'],
  ['อาคาร 2', 'สายการผลิตพิมพ์ (Printing Production)'],
  ['อาคาร 3', 'อาคารสำนักงาน (Office)'],
];
for (const [name, note] of seed)
  await client.query('insert into buildings(name,note) values($1,$2) on conflict(name) do update set note=excluded.note', [name, note]);
const r = await client.query('select name,note from buildings order by name');
console.log('✅ ตาราง buildings พร้อมใช้งาน:', r.rows.map((x) => x.name).join(', '));
await client.end();
