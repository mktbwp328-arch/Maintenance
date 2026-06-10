import pg from 'pg';
const c = new pg.Client({ host: process.env.PGHOST, port: 5432, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query("update tickets set status='แจ้งซ่อม' where status='รอตรวจสอบ' returning no");
console.log('ย้ายใบที่เป็นรอตรวจสอบ →แจ้งซ่อม:', r.rows.map((x) => x.no).join(', ') || '(ไม่มี)');
const s = await c.query('select status,count(*) c from tickets group by status order by 2 desc');
s.rows.forEach((x) => console.log('  ' + x.status.padEnd(22), x.c));
await c.end();
