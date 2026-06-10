import pg from 'pg';
const c = new pg.Client({ host: process.env.PGHOST, port: 5432, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false } });
await c.connect();
// realign each MTD-YYMM counter to the highest existing ticket number that month
const rows = await c.query("select substring(no from 5 for 4) as key, max(substring(no from 9 for 4))::int as mx from tickets where no like 'MTD-%' group by 1");
for (const r of rows.rows) {
  await c.query('insert into counters(key,val) values($1,$2) on conflict(key) do update set val=excluded.val', [r.key, r.mx]);
  console.log('counter', r.key, '=', r.mx);
}
await c.end();
