// Adds a `building` field (อาคาร 1/2/3) to every equipment, in both
// data/equipment.json and the Postgres equipment table.
//   อาคาร 1 = Blowing Production, อาคาร 2 = Printing Production,
//   อาคาร 3 = Office (เครื่องปรับอากาศสำนักงาน)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'equipment.json');
const equipment = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, ''));

const buildingOf = (e) =>
  e.type === 'Office Air Conditioner' ? 'อาคาร 3'
  : e.dept === 'Blowing Production' ? 'อาคาร 1'
  : 'อาคาร 2';

for (const e of equipment) e.building = buildingOf(e);

// write back, one object per line (keeps file readable)
const body = equipment.map((e) => '  ' + JSON.stringify(e)).join(',\n');
fs.writeFileSync(FILE, '[\n' + body + '\n]\n');
const counts = equipment.reduce((a, e) => ((a[e.building] = (a[e.building] || 0) + 1), a), {});
console.log('✅ equipment.json อัปเดตแล้ว:', counts);

// update database
const conn = process.env.DATABASE_URL;
const hasParts = process.env.PGHOST && process.env.PGPASSWORD;
if (!conn && !hasParts) { console.log('ℹ️ ไม่พบ DB env — ข้ามการอัปเดตฐานข้อมูล'); process.exit(0); }
const client = new pg.Client(conn
  ? { connectionString: conn, ssl: { rejectUnauthorized: false } }
  : { host: process.env.PGHOST, port: Number(process.env.PGPORT) || 5432, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE || 'postgres', ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('alter table equipment add column if not exists building text');
for (const e of equipment) await client.query('update equipment set building=$2 where id=$1', [e.id, e.building]);
console.log('✅ อัปเดตคอลัมน์ building ในฐานข้อมูลแล้ว (' + equipment.length + ' แถว)');
await client.end();
