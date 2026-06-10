import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query('select created_by, count(*) c from tickets group by created_by order by 2 desc');
console.log('created_by distribution:');
r.rows.forEach((x) => console.log('  ' + (x.created_by || '(staff/none)') + ': ' + x.c));
const u = await c.query("select username,role from app_users where username in ('phattara','user') order by username");
console.log('reporter accounts:', u.rows.map((x) => x.username + '(' + x.role + ')').join(', '));
await c.end();
