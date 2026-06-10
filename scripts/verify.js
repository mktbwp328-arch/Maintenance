import pg from 'pg';
const c = new pg.Client({ host: process.env.PGHOST, port: 5432, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false } });
await c.connect();
for (const t of ['equipment', 'app_users', 'tickets', 'pm']) {
  const r = await c.query(`select count(*) from ${t}`);
  console.log(t.padEnd(11), r.rows[0].count);
}
console.log('--- tickets by status ---');
for (const r of (await c.query('select status,count(*) c from tickets group by status order by 2 desc')).rows)
  console.log('  ' + r.status.padEnd(24), r.c);
const due = await c.query("select count(*) from pm where next_due <= '2026-07-06'");
console.log('PM ใกล้/เกินกำหนด (<=2026-07-06):', due.rows[0].count);
await c.end();
