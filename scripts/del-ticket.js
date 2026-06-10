import pg from 'pg';
const id = process.env.DEL_ID;
const c = new pg.Client({ host: process.env.PGHOST, port: 5432, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('delete from tickets where id=$1', [id]);
const r = await c.query('select count(*) from tickets');
console.log('tickets after cleanup:', r.rows[0].count);
await c.end();
