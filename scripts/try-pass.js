import pg from 'pg';
const host = 'aws-1-ap-southeast-1.pooler.supabase.com';
const user = 'postgres.gnzopjcnlqcyixutieum';
const candidates = ['Bestworld@32806', 'Bestworld@328'];
for (let attempt = 1; attempt <= 3; attempt++) {
  for (const pass of candidates) {
    const c = new pg.Client({ host, port: 5432, user, password: pass, database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 12000 });
    try {
      await c.connect();
      await c.query('select 1');
      console.log('OK_PASSWORD=[' + pass + ']');
      await c.end();
      process.exit(0);
    } catch (e) {
      console.log(`a${attempt} [${pass}] : ${e.message.slice(0, 55)}`);
      try { await c.end(); } catch {}
    }
  }
}
process.exit(2);
