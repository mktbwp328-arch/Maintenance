import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'equipment.json');
const target = process.argv[2];
if (!target) { console.log('usage: node del-equip.js <id>'); process.exit(1); }
const list = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, '')).filter((e) => e.id !== target);
fs.writeFileSync(FILE, '[\n' + list.map((e) => '  ' + JSON.stringify(e)).join(',\n') + '\n]\n');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('delete from equipment where id=$1', [target]);
await c.end();
console.log('ลบ ' + target + ' แล้ว เหลือ ' + list.length + ' เครื่อง');
