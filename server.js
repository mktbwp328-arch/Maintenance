import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Minimal .env loader (no dependency) — must run BEFORE importing modules that read env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const {
  STATUSES, PRIORITIES, PM_TYPES, getEquipment, usingSupabase, seedSupabase,
  listTickets, getTicket, createTicket, updateTicket, deleteTicket, stats,
  listPM, createPM, deletePM, pmDue,
  equipmentHistory, problemSummary, equipmentOverview, createEquipment,
  listBuildings, createBuilding, deleteBuilding, buildingOverview, buildingHistory, seedBuildings,
  listKB, createKB, deleteKB, seedKB,
  getSetting, setSetting,
} = await import('./lib/store.js');
const { notifyNew, notifyStatus, channelStatus, replyLine } = await import('./lib/notify.js');
const { verifyLineIdToken, liffConfigured, liffId } = await import('./lib/line.js');
const {
  ROLES, login, logout, listUsers, createUser, deleteUser, resetPassword,
  authRequired, roleRequired, seedUsers,
} = await import('./lib/auth.js');

const app = express();
app.use(express.json({ limit: '8mb' })); // รองรับรูปภาพ base64
// ไม่ cache ไฟล์หน้าเว็บ เพื่อให้เห็นการอัปเดตทันทีทุกครั้งที่รีเฟรช
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store, must-revalidate'),
}));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e); res.status(500).json({ error: e.message || 'server error' });
});

// ---------- Auth ----------
app.post('/api/login', wrap(async (req, res) => {
  const { username, password } = req.body;
  const result = await login(username, password);
  if (!result) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  res.json(result);
}));
app.post('/api/logout', authRequired, (req, res) => {
  logout((req.headers.authorization || '').replace(/^Bearer /, ''));
  res.json({ ok: true });
});
app.get('/api/me', authRequired, (req, res) => res.json(req.user));

// ---------- Meta (public read) ----------
app.get('/api/meta', (req, res) => {
  res.json({ statuses: STATUSES, priorities: PRIORITIES, pmTypes: PM_TYPES, roles: ROLES, equipment: getEquipment(), channels: channelStatus() });
});

// ---------- LINE / LIFF (public — สำหรับแจ้งซ่อมผ่านไลน์) ----------
app.get('/api/line/config', (req, res) => res.json({ liffId: liffId(), configured: liffConfigured() }));

// Webhook: ลงทะเบียนกลุ่ม "เฉพาะ" เมื่อพิมพ์คำสั่ง (บอทไม่ตอบการสนทนาทั่วไป)
// - พิมพ์ "ลงทะเบียนกลุ่ม" ในกลุ่ม -> ตั้งกลุ่มนี้รับแจ้งซ่อม
// - พิมพ์ "myid" ในแชตส่วนตัว    -> บอทบอก User ID
// หมายเหตุ: บน serverless ต้อง await งานให้เสร็จ "ก่อน" ตอบ response (ไม่งั้นถูกตัดทิ้ง)
const REGISTER_CMD = 'ลงทะเบียนกลุ่ม';
app.post('/api/line/webhook', async (req, res) => {
  try {
    for (const ev of (req.body?.events || [])) {
      // สนใจเฉพาะข้อความตัวอักษรเท่านั้น — เหตุการณ์อื่น (เข้า/ออกกลุ่ม, สติกเกอร์ ฯลฯ) ข้ามไป
      if (ev.type !== 'message' || ev.message?.type !== 'text') continue;
      const text = (ev.message.text || '').trim();
      const src = ev.source || {};
      const gid = src.groupId || src.roomId;
      if (gid) {
        // อยู่ในกลุ่ม: ตอบ "เฉพาะ" เมื่อพิมพ์คำสั่งลงทะเบียน — นอกนั้นเงียบสนิท
        if (text === REGISTER_CMD) {
          await setSetting('line_group_id', gid);
          if (ev.replyToken) await replyLine(ev.replyToken, '✅ ตั้งกลุ่มนี้ให้รับแจ้งซ่อมแล้ว\nต่อจากนี้ใบแจ้งซ่อมใหม่จะส่งเข้ากลุ่มนี้อัตโนมัติ');
        }
      } else if (src.userId && text.toLowerCase() === 'myid') {
        // แชตส่วนตัว: บอก User ID เฉพาะเมื่อพิมพ์ "myid"
        if (ev.replyToken) await replyLine(ev.replyToken, `User ID ของคุณ:\n${src.userId}`);
      }
    }
  } catch (e) { console.error('webhook error', e.message); }
  res.sendStatus(200);
});
app.post('/api/line/ticket', wrap(async (req, res) => {
  const { idToken, equipmentId, detail } = req.body;
  let lineName = '', lineSub = '';
  try {
    const profile = await verifyLineIdToken(idToken); // null if not configured
    if (profile) { lineName = profile.name || ''; lineSub = profile.sub || ''; }
  } catch (e) { return res.status(401).json({ error: e.message }); }
  const reporter = (req.body.reporter || lineName || '').trim();
  if (!reporter || !equipmentId || !detail) return res.status(400).json({ error: 'กรุณากรอก ผู้แจ้ง, เครื่องจักร และอาการ' });
  const t = await createTicket({ ...req.body, reporter, createdBy: lineSub ? 'line:' + lineSub : 'line' });
  await notifyNew(t).catch((e) => console.error('notify error', e));
  res.status(201).json({ no: t.no, status: t.status, equipmentName: t.equipmentName });
}));

// รูปแนบใบแจ้งซ่อม (สาธารณะ) — คืน base64 ที่เก็บไว้เป็นไฟล์ภาพจริง เพื่อให้ LINE ดึงไปแสดงในการ์ดได้
app.get('/api/tickets/:id/photo', wrap(async (req, res) => {
  const t = await getTicket(req.params.id);
  const m = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(t?.photo || '');
  if (!m) return res.status(404).send('no photo');
  res.setHeader('Content-Type', m[1]);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(m[2], 'base64'));
}));

// Everything below requires login
app.use('/api', authRequired);

// reporters only ever see their own data
const ownScope = (req) => (req.user.role === 'reporter' ? req.user.username : undefined);

// ตั้งค่า LINE token / group id ลง DB (แอดมินเท่านั้น) — ใช้ตั้งค่าบนเว็บ prod โดยไม่ต้องแก้ env
app.get('/api/line/settings', roleRequired('admin'), wrap(async (req, res) => {
  const tok = await getSetting('line_token');
  res.json({
    hasToken: Boolean(tok), tokenLen: tok ? tok.length : 0,
    groupId: (await getSetting('line_group_id')) || null,
    hasChannelId: Boolean((await getSetting('line_channel_id')) || process.env.LINE_CHANNEL_ID),
    hasChannelSecret: Boolean((await getSetting('line_channel_secret')) || process.env.LINE_CHANNEL_SECRET),
    tokenExp: (await getSetting('line_token_exp')) || null,
  });
}));
app.post('/api/line/settings', roleRequired('admin'), wrap(async (req, res) => {
  const { token, groupId, channelId, channelSecret } = req.body;
  if (token) await setSetting('line_token', String(token).trim());
  if (groupId) await setSetting('line_group_id', String(groupId).trim());
  if (channelId) await setSetting('line_channel_id', String(channelId).trim());
  if (channelSecret) await setSetting('line_channel_secret', String(channelSecret).trim());
  const tok = await getSetting('line_token');
  res.json({
    ok: true, hasToken: Boolean(tok), tokenLen: tok ? tok.length : 0,
    groupId: (await getSetting('line_group_id')) || null,
    hasChannelId: Boolean((await getSetting('line_channel_id')) || process.env.LINE_CHANNEL_ID),
    hasChannelSecret: Boolean((await getSetting('line_channel_secret')) || process.env.LINE_CHANNEL_SECRET),
  });
}));

app.get('/api/stats', wrap(async (req, res) => {
  const s = await stats({ from: req.query.from, to: req.query.to, createdBy: ownScope(req) });
  res.json({ ...s, pmDue: req.user.role === 'reporter' ? [] : await pmDue(30) });
}));
app.get('/api/summary', wrap(async (req, res) => res.json(await problemSummary({ from: req.query.from, to: req.query.to, createdBy: ownScope(req) }))));
app.get('/api/equipment-overview', wrap(async (req, res) => res.json(await equipmentOverview())));
app.post('/api/equipment', roleRequired('admin', 'technician'), wrap(async (req, res) => {
  try { res.status(201).json(await createEquipment(req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
}));

// ---------- Buildings ----------
app.get('/api/buildings', wrap(async (req, res) => res.json(await listBuildings())));
app.get('/api/building-overview', wrap(async (req, res) => res.json(await buildingOverview())));
app.get('/api/building/:name/history', wrap(async (req, res) => res.json(await buildingHistory(req.params.name))));

// ---------- Knowledge base (ปัญหา & สาเหตุ) ----------
app.get('/api/kb', wrap(async (req, res) => res.json(await listKB({ category: req.query.category, q: req.query.q }))));
app.post('/api/kb', roleRequired('admin', 'technician'), wrap(async (req, res) => {
  try { res.status(201).json(await createKB(req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
}));
app.delete('/api/kb/:id', roleRequired('admin', 'technician'), wrap(async (req, res) => res.json({ ok: await deleteKB(req.params.id) })));
app.post('/api/buildings', roleRequired('admin'), wrap(async (req, res) => {
  try { res.status(201).json(await createBuilding(req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
}));
app.delete('/api/buildings/:name', roleRequired('admin'), wrap(async (req, res) => {
  try { await deleteBuilding(req.params.name); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
}));
app.get('/api/equipment/:id/history', wrap(async (req, res) => res.json(await equipmentHistory(req.params.id))));

// ---------- Tickets ----------
app.get('/api/tickets', wrap(async (req, res) => res.json(await listTickets({ status: req.query.status, q: req.query.q, createdBy: ownScope(req) }))));
app.get('/api/tickets/:id', wrap(async (req, res) => {
  const t = await getTicket(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  if (req.user.role === 'reporter' && t.createdBy !== req.user.username)
    return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูใบนี้' });
  res.json(t);
}));
app.post('/api/tickets', wrap(async (req, res) => {
  const { reporter, equipmentId, detail } = req.body;
  if (!reporter || !equipmentId || !detail) return res.status(400).json({ error: 'กรุณากรอก ผู้แจ้ง, เครื่องจักร และอาการ' });
  const t = await createTicket({ ...req.body, createdBy: req.user.username });
  await notifyNew(t).catch((e) => console.error('notify error', e));
  res.status(201).json(t);
}));
app.patch('/api/tickets/:id', roleRequired('admin', 'technician'), wrap(async (req, res) => {
  const note = req.body.note || (req.body.status ? `โดย ${req.user.name}` : '');
  let result;
  try { result = await updateTicket(req.params.id, { ...req.body, note }); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  if (!result) return res.status(404).json({ error: 'not found' });
  if (result.statusChanged) await notifyStatus(result.ticket).catch((e) => console.error('notify error', e));
  res.json(result.ticket);
}));
app.delete('/api/tickets/:id', roleRequired('admin'), wrap(async (req, res) => {
  const ok = await deleteTicket(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
}));

// ---------- PM ----------
app.get('/api/pm', wrap(async (req, res) => res.json(await listPM({ equipmentId: req.query.equipmentId, q: req.query.q }))));
app.post('/api/pm', roleRequired('admin', 'technician'), wrap(async (req, res) => {
  if (!req.body.equipmentId) return res.status(400).json({ error: 'กรุณาเลือกเครื่องจักร' });
  const rec = await createPM({ ...req.body, performedBy: req.body.performedBy || req.user.name });
  res.status(201).json(rec);
}));
app.delete('/api/pm/:id', roleRequired('admin', 'technician'), wrap(async (req, res) => res.json({ ok: await deletePM(req.params.id) })));

// ---------- Users (admin only) ----------
app.get('/api/users', roleRequired('admin'), wrap(async (req, res) => res.json(await listUsers())));
app.post('/api/users', roleRequired('admin'), wrap(async (req, res) => {
  try { res.status(201).json(await createUser(req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
}));
app.delete('/api/users/:username', roleRequired('admin'), wrap(async (req, res) => {
  try { await deleteUser(req.params.username); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
}));
app.post('/api/users/:username/password', roleRequired('admin'), wrap(async (req, res) => {
  try { await resetPassword(req.params.username, req.body.password); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); }
}));

// ---------- boot ----------
const PORT = process.env.PORT || 3000;
try {
  if (!process.env.VERCEL) { // serverless: DB already seeded, skip to keep cold starts fast
    await seedSupabase();
    await seedUsers();
    await seedBuildings();
    await seedKB();
  }
} catch (e) {
  console.error('⚠️  seed/connect Supabase ล้มเหลว:', e.message);
}
// Local: run a persistent server. On Vercel (serverless) we just export the app.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    const ch = channelStatus();
    console.log(`\n🔧 ระบบแจ้งซ่อม MTD  →  http://localhost:${PORT}`);
    console.log(`   ฐานข้อมูล: ${usingSupabase ? 'Supabase Postgres ✅' : 'ไฟล์ JSON (ยังไม่ตั้งค่า Supabase)'}`);
    console.log(`   บัญชีเริ่มต้น: admin/admin123 · tech/tech123 · user/user123`);
    console.log(`   อีเมล: ${ch.email ? 'พร้อม ✅' : 'ยังไม่ตั้งค่า'} | LINE แจ้งเตือน: ${ch.line ? 'พร้อม ✅' : 'ยังไม่ตั้งค่า'}`);
    console.log(`   แจ้งซ่อมผ่านไลน์ (LIFF): ${liffConfigured() ? 'พร้อม ✅  →  /liff.html' : 'ยังไม่ตั้งค่า (ดู .env.example: LIFF_ID)'}\n`);
  });
}

export default app;
