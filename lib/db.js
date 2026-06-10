// Direct Postgres (Supabase) backend via the pg driver.
// Activated when DATABASE_URL (or PGHOST + PGPASSWORD) is present in env.
import pg from 'pg';

const url = process.env.DATABASE_URL;
const hasParts = process.env.PGHOST && process.env.PGPASSWORD;
export const enabled = Boolean(url || hasParts);

let pool = null;
if (enabled) {
  pool = new pg.Pool(
    url
      ? { connectionString: url, ssl: { rejectUnauthorized: false }, max: 5 }
      : {
          host: process.env.PGHOST,
          port: Number(process.env.PGPORT) || 5432,
          user: process.env.PGUSER || 'postgres',
          password: process.env.PGPASSWORD,
          database: process.env.PGDATABASE || 'postgres',
          ssl: { rejectUnauthorized: false },
          max: 5,
        }
  );
  pool.on('error', (e) => console.error('pg pool error:', e.message));
}

export async function q(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

// Atomic document numbering via the next_seq() SQL function
export async function nextSeq(key) {
  const rows = await q('select public.next_seq($1) as v', [key]);
  return Number(rows[0].v);
}
