import pg from 'pg';
const c = new pg.Client({ host: 'aws-1-ap-southeast-2.pooler.supabase.com', port: 5432, user: 'postgres.ucvmtenyaxhedgvhdywa', password: process.env.NEWPASS, database: 'postgres', ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('alter table tickets add column if not exists photo text');
const r = await c.query("select column_name from information_schema.columns where table_name='tickets' and column_name='photo'");
console.log('photo column:', JSON.stringify(r.rows));
await c.end();
