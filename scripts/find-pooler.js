import pg from 'pg';
const ref = 'gnzopjcnlqcyixutieum';
const pass = process.env.PGPASSWORD;
const regions = ['ap-southeast-1','ap-southeast-2','ap-south-1','ap-northeast-1','ap-northeast-2','us-east-1','us-east-2','us-west-1','eu-central-1'];
const prefixes = ['aws-0','aws-1'];
for (const pre of prefixes) for (const r of regions) {
  const host = `${pre}-${r}.pooler.supabase.com`;
  const c = new pg.Client({ host, port: 5432, user: `postgres.${ref}`, password: pass, database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 6000 });
  try {
    await c.connect();
    await c.query('select 1');
    console.log('FOUND ' + host);
    await c.end();
    process.exit(0);
  } catch (e) {
    console.log(`x ${host} : ${e.message.slice(0,60)}`);
    try { await c.end(); } catch {}
  }
}
console.log('NONE');
process.exit(2);
