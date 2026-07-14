// Notification layer: Email (SMTP) + LINE Messaging API (push/reply).
// - แจ้งซ่อมใหม่     -> ส่งเข้ากลุ่ม (groupId เก็บอัตโนมัติจาก webhook หรือ LINE_TO)
// - เปลี่ยนสถานะ     -> ส่งเข้ากลุ่ม + แจ้งผู้ที่แจ้งผ่านไลน์ (โดยตรง)
import nodemailer from 'nodemailer';
import { getSetting, setSetting } from './store.js';

const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, NOTIFY_EMAIL_TO,
  LINE_CHANNEL_ACCESS_TOKEN, LINE_TO, LINE_CHANNEL_ID, LINE_CHANNEL_SECRET,
} = process.env;

let transporter = null;
if (SMTP_HOST && SMTP_USER) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

const priorityEmoji = { 'ปกติ': '🟢', 'เร่งด่วน': '🟠', 'วิกฤต (หยุดการผลิต)': '🔴' };
// URL ฐานสำหรับลิงก์รูปภาพให้ LINE ดึง (ตั้ง PUBLIC_BASE_URL บน Vercel ได้ ถ้าโดเมนเปลี่ยน)
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || 'https://maintenance-gamma-tan.vercel.app').replace(/\/$/, '');

function ticketText(t, headline) {
  return [
    headline,
    `เลขที่: ${t.no}`,
    `เครื่องจักร: ${t.equipmentId} ${t.equipmentName}`.trim(),
    t.reqDept ? `แผนกผู้แจ้ง: ${t.reqDept}` : null,
    `แผนก: ${t.dept || '-'}`,
    `ความเร่งด่วน: ${priorityEmoji[t.priority] || ''} ${t.priority}`,
    `สถานะ: ${t.status}`,
    `ผู้แจ้ง: ${t.reporter || '-'}${t.phone ? ' (' + t.phone + ')' : ''}`,
    `อาการ: ${t.detail || '-'}`,
    t.assignee ? `ผู้ซ่อม: ${t.assignee}` : null,
    t.solution ? `รายละเอียดการซ่อม: ${t.solution}` : null,
    t.status === 'สำเร็จ' && t.closedAt ? `วันที่สำเร็จ: ${fmtDateTime(t.closedAt)}` : null,
  ].filter(Boolean).join('\n');
}

// วันที่/เวลาแบบไทย เช่น "16 มิ.ย. 2569 14:30 น."
function fmtDateTime(iso) {
  try {
    return new Date(iso).toLocaleString('th-TH', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
    }) + ' น.';
  } catch { return String(iso || '-'); }
}

// สี badge ตามสถานะ
const STATUS_COLOR = {
  'แจ้งซ่อม': '#f59e0b', 'ดำเนินการ': '#3b82f6',
  'ส่งซ่อม / รออะไหล่': '#8b5cf6', 'สำเร็จ': '#22c55e', 'ยกเลิก': '#ef4444',
};

// สร้าง Flex Message (การ์ด) สำหรับแจ้งเตือนทางไลน์
// opts.confirmButton = true -> ใส่ปุ่มให้ผู้แจ้งกดยืนยัน "ปิดงาน"
function ticketFlex(t, headline, accent, opts = {}) {
  const color = accent || STATUS_COLOR[t.status] || '#8b5cf6';
  const rows = [
    ['🔧 เครื่องจักร', `${t.equipmentId} ${t.equipmentName}`.trim() || '-'],
    ...(t.reqDept ? [['🏢 แผนกผู้แจ้ง', t.reqDept]] : []),
    ['🏭 แผนก', t.dept || '-'],
    ['⚡ ความเร่งด่วน', `${priorityEmoji[t.priority] || ''} ${t.priority}`],
    ['👤 ผู้แจ้ง', `${t.reporter || '-'}${t.phone ? ' (' + t.phone + ')' : ''}`],
    ['📝 อาการ', t.detail || '-'],
  ];
  const done = t.status === 'สำเร็จ';
  // ตอนสำเร็จ: แสดงผู้ซ่อม + รายละเอียดการซ่อม + วันที่สำเร็จ เสมอ
  if (t.assignee || done) rows.push(['🛠️ ผู้ซ่อม', t.assignee || '-']);
  if (t.solution || done) rows.push(['🔧 รายละเอียดการซ่อม', t.solution || '-']);
  if (done && t.closedAt) rows.push(['📅 วันที่สำเร็จ', fmtDateTime(t.closedAt)]);
  else if (t.status === 'ยกเลิก' && t.closedAt) rows.push(['📅 วันที่ยกเลิก', fmtDateTime(t.closedAt)]);
  // รูปแนบ: ใช้ URL สาธารณะที่เซิร์ฟเวอร์คืนจาก base64 (LINE ต้องการ https URL)
  const photoUrl = t.photo && t.id ? `${PUBLIC_BASE}/api/tickets/${t.id}/photo` : null;
  const line = (k, v) => ({
    type: 'box', layout: 'horizontal', spacing: 'sm',
    contents: [
      { type: 'text', text: k, color: '#8a8f99', size: 'sm', flex: 4, wrap: true },
      { type: 'text', text: String(v), color: '#222b45', size: 'sm', flex: 6, wrap: true, weight: 'bold' },
    ],
  });
  return {
    type: 'flex',
    altText: `${headline} ${t.no} (${t.status})`,
    contents: {
      type: 'bubble', size: 'mega',
      ...(photoUrl ? { hero: { type: 'image', url: photoUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' } } : {}),
      header: {
        type: 'box', layout: 'vertical', backgroundColor: color, paddingAll: '16px', spacing: 'xs',
        contents: [
          { type: 'text', text: headline, color: '#ffffff', weight: 'bold', size: 'md', wrap: true },
          { type: 'text', text: t.no, color: '#ffffff', size: 'xxl', weight: 'bold' },
          { type: 'box', layout: 'baseline', contents: [
            { type: 'text', text: '● ' + t.status, color: '#ffffff', size: 'sm', weight: 'bold' },
          ]},
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: rows.map(([k, v]) => line(k, v)),
      },
      ...(opts.confirmButton ? {
        footer: {
          type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
          contents: [
            { type: 'button', style: 'primary', color: '#22c55e', height: 'sm',
              action: { type: 'postback', label: '✅ ยืนยันว่าซ่อมสำเร็จ (ปิดงาน)', data: `action=confirm&id=${t.id}`, displayText: 'ยืนยันว่าซ่อมสำเร็จแล้ว' } },
          ],
        },
      } : {}),
    },
  };
}

async function sendEmail(subject, text) {
  if (!transporter || !NOTIFY_EMAIL_TO) return { channel: 'email', skipped: true };
  try {
    await transporter.sendMail({ from: SMTP_FROM || SMTP_USER, to: NOTIFY_EMAIL_TO, subject, text });
    return { channel: 'email', ok: true };
  } catch (e) { return { channel: 'email', error: e.message }; }
}

// Channel ID/Secret (ไม่มีวันหมดอายุ) — ใช้ออก access token ใหม่เองอัตโนมัติ
async function lineCreds() {
  const id = (await getSetting('line_channel_id')) || LINE_CHANNEL_ID || null;
  const secret = (await getSetting('line_channel_secret')) || LINE_CHANNEL_SECRET || null;
  return { id, secret };
}

// ขอ access token ใหม่จาก LINE ด้วย client_credentials (อายุ ~30 วัน) แล้วเก็บลง DB
async function issueLineToken() {
  const { id, secret } = await lineCreds();
  if (!id || !secret) return null;
  try {
    const res = await fetch('https://api.line.me/v2/oauth/accessToken', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: String(id), client_secret: String(secret) }),
    });
    if (!res.ok) { console.error('[line] ออก token ใหม่ล้มเหลว', res.status, await res.text()); return null; }
    const data = await res.json();
    const exp = Date.now() + (Number(data.expires_in) || 2592000) * 1000;
    await setSetting('line_token', data.access_token);
    await setSetting('line_token_exp', String(exp));
    console.log('[line] ออก access token ใหม่สำเร็จ หมดอายุ', new Date(exp).toISOString());
    return data.access_token;
  } catch (e) { console.error('[line] ออก token ใหม่ error', e.message); return null; }
}

// อ่าน token: ถ้ามี Channel ID/Secret จะออก/ต่ออายุเองอัตโนมัติ (ต่อก่อนหมด 1 วัน)
// ไม่งั้น fallback ไปใช้ line_token ใน DB หรือ env (แบบตั้งเอง)
async function lineToken(forceRefresh = false) {
  try {
    const { id, secret } = await lineCreds();
    if (id && secret) {
      const cached = await getSetting('line_token');
      const exp = Number(await getSetting('line_token_exp')) || 0;
      if (!forceRefresh && cached && Date.now() < exp - 86400000) return cached;
      return (await issueLineToken()) || cached || LINE_CHANNEL_ACCESS_TOKEN || null;
    }
    return (await getSetting('line_token')) || LINE_CHANNEL_ACCESS_TOKEN || null;
  } catch { return LINE_CHANNEL_ACCESS_TOKEN || null; }
}

// push ข้อความไปยังปลายทาง (userId / groupId / roomId) — รับได้ทั้ง text หรือ message object (Flex)
async function pushLine(to, message) {
  const token = await lineToken();
  if (!token || !to) {
    const reason = !token ? 'ไม่พบ LINE token (ตั้ง LINE_CHANNEL_ACCESS_TOKEN หรือ setting line_token)'
                          : 'ไม่พบปลายทางกลุ่ม (group id ยังไม่ถูกเก็บจาก webhook หรือยังไม่ตั้ง LINE_TO)';
    console.warn('[line] ข้ามการส่ง:', reason);
    return { channel: 'line', skipped: true, reason };
  }
  const msg = typeof message === 'string' ? { type: 'text', text: message } : message;
  const send = async (tok) => fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ to, messages: [msg] }),
  });
  try {
    let res = await send(token);
    // token ใช้ไม่ได้ (หมด/ถูกยกเลิก) -> ออกใหม่แล้วลองซ้ำ 1 ครั้ง
    if (res.status === 401) {
      const fresh = await lineToken(true);
      if (fresh && fresh !== token) res = await send(fresh);
    }
    if (!res.ok) return { channel: 'line', error: `HTTP ${res.status} ${await res.text()}` };
    return { channel: 'line', ok: true };
  } catch (e) { return { channel: 'line', error: e.message }; }
}

// ตอบกลับข้อความในกลุ่ม/แชต (ใช้ใน webhook)
export async function replyLine(replyToken, text) {
  const token = await lineToken();
  if (!token || !replyToken) return;
  try {
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
    });
  } catch { /* ignore */ }
}

// ปลายทางกลุ่ม: ใช้ค่าที่ webhook เก็บไว้ ถ้าไม่มีใช้ LINE_TO จาก env
async function groupTarget() {
  try { return (await getSetting('line_group_id')) || LINE_TO || null; } catch { return LINE_TO || null; }
}
const lineUserOf = (t) => (t.createdBy && t.createdBy.startsWith('line:') ? t.createdBy.slice(5) : null);

export async function notifyNew(t) {
  const text = ticketText(t, '🔧 มีการแจ้งซ่อมใหม่');
  const group = await groupTarget();
  const tasks = [
    sendEmail(`[แจ้งซ่อม] ${t.no} - ${t.equipmentName}`, text),
    pushLine(group, ticketFlex(t, '🔧 มีการแจ้งซ่อมใหม่')),
  ];
  // ทักกลับผู้แจ้งผ่านไลน์โดยตรง — ยืนยันว่ารับเรื่องแล้ว
  const user = lineUserOf(t);
  if (user) tasks.push(pushLine(user, ticketFlex(t, '✅ รับแจ้งซ่อมของคุณแล้ว', '#22c55e')));
  else console.warn('[notifyNew]', t.no, 'ไม่มี userId ของผู้แจ้ง (createdBy=' + t.createdBy + ') — ข้ามการทักผู้แจ้ง');
  const results = await Promise.all(tasks);
  console.log('[notifyNew]', t.no, 'reporter=' + (user || '-'), JSON.stringify(results));
  return results;
}

export async function notifyStatus(t) {
  const text = ticketText(t, `📌 อัปเดตสถานะงานซ่อม → ${t.status}`);
  // อัปเดตสถานะ -> แจ้ง "เฉพาะผู้แจ้ง" โดยตรง (ไม่ส่งเข้ากลุ่ม)
  const tasks = [
    sendEmail(`[อัปเดต ${t.status}] ${t.no} - ${t.equipmentName}`, text),
  ];
  const user = lineUserOf(t);
  if (user) {
    // สถานะ "สำเร็จ" -> ใส่ปุ่มให้ผู้แจ้งกดยืนยันปิดงาน
    const confirmButton = t.status === 'สำเร็จ';
    tasks.push(pushLine(user, ticketFlex(t, `🔔 อัปเดตงานที่คุณแจ้ง → ${t.status}`, null, { confirmButton })));
  } else console.warn('[notifyStatus]', t.no, 'ไม่มี userId ของผู้แจ้ง (createdBy=' + t.createdBy + ') — ข้ามการแจ้งผู้แจ้ง');
  const results = await Promise.all(tasks);
  console.log('[notifyStatus]', t.no, '→', t.status, 'reporter=' + (user || '-'), JSON.stringify(results));
  return results;
}

// ผู้แจ้งกดยืนยันปิดงาน -> แจ้งเข้ากลุ่ม
export async function notifyConfirmed(t) {
  const group = await groupTarget();
  const r = await pushLine(group, ticketFlex(t, '✅ ผู้แจ้งยืนยันปิดงานแล้ว', '#16a34a'));
  console.log('[notifyConfirmed]', t.no, JSON.stringify(r));
  return r;
}

export function channelStatus() {
  return {
    email: Boolean(transporter && NOTIFY_EMAIL_TO),
    line: Boolean(LINE_CHANNEL_ACCESS_TOKEN),
  };
}
