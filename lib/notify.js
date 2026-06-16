// Notification layer: Email (SMTP) + LINE Messaging API (push/reply).
// - แจ้งซ่อมใหม่     -> ส่งเข้ากลุ่ม (groupId เก็บอัตโนมัติจาก webhook หรือ LINE_TO)
// - เปลี่ยนสถานะ     -> ส่งเข้ากลุ่ม + แจ้งผู้ที่แจ้งผ่านไลน์ (โดยตรง)
import nodemailer from 'nodemailer';
import { getSetting } from './store.js';

const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, NOTIFY_EMAIL_TO,
  LINE_CHANNEL_ACCESS_TOKEN, LINE_TO,
} = process.env;

let transporter = null;
if (SMTP_HOST && SMTP_USER) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

const priorityEmoji = { 'ปกติ': '🟢', 'เร่งด่วน': '🟠', 'วิกฤต (หยุดการผลิต)': '🔴' };

function ticketText(t, headline) {
  return [
    headline,
    `เลขที่: ${t.no}`,
    `เครื่องจักร: ${t.equipmentId} ${t.equipmentName}`.trim(),
    `แผนก: ${t.dept || '-'}`,
    `ความเร่งด่วน: ${priorityEmoji[t.priority] || ''} ${t.priority}`,
    `สถานะ: ${t.status}`,
    `ผู้แจ้ง: ${t.reporter || '-'}${t.phone ? ' (' + t.phone + ')' : ''}`,
    `อาการ: ${t.detail || '-'}`,
    t.assignee ? `ผู้ดำเนินการ: ${t.assignee}` : null,
    t.solution ? `การแก้ไข: ${t.solution}` : null,
  ].filter(Boolean).join('\n');
}

// สี badge ตามสถานะ
const STATUS_COLOR = {
  'แจ้งซ่อม': '#f59e0b', 'ดำเนินการ': '#3b82f6',
  'ส่งซ่อม / รออะไหล่': '#8b5cf6', 'สำเร็จ': '#22c55e', 'ยกเลิก': '#ef4444',
};

// สร้าง Flex Message (การ์ด) สำหรับแจ้งเตือนทางไลน์
function ticketFlex(t, headline, accent) {
  const color = accent || STATUS_COLOR[t.status] || '#8b5cf6';
  const rows = [
    ['🔧 เครื่องจักร', `${t.equipmentId} ${t.equipmentName}`.trim() || '-'],
    ['🏭 แผนก', t.dept || '-'],
    ['⚡ ความเร่งด่วน', `${priorityEmoji[t.priority] || ''} ${t.priority}`],
    ['👤 ผู้แจ้ง', `${t.reporter || '-'}${t.phone ? ' (' + t.phone + ')' : ''}`],
    ['📝 อาการ', t.detail || '-'],
  ];
  if (t.assignee) rows.push(['🛠️ ผู้ดำเนินการ', t.assignee]);
  if (t.solution) rows.push(['✅ การแก้ไข', t.solution]);
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

// อ่าน token จาก settings (DB) ก่อน ถ้าไม่มีใช้ env — เก็บใน DB ได้โดยไม่ต้องตั้ง Vercel env
async function lineToken() {
  try { return (await getSetting('line_token')) || LINE_CHANNEL_ACCESS_TOKEN || null; }
  catch { return LINE_CHANNEL_ACCESS_TOKEN || null; }
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
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [msg] }),
    });
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
  if (user) tasks.push(pushLine(user, ticketFlex(t, `🔔 อัปเดตงานที่คุณแจ้ง → ${t.status}`)));
  else console.warn('[notifyStatus]', t.no, 'ไม่มี userId ของผู้แจ้ง (createdBy=' + t.createdBy + ') — ข้ามการแจ้งผู้แจ้ง');
  const results = await Promise.all(tasks);
  console.log('[notifyStatus]', t.no, '→', t.status, 'reporter=' + (user || '-'), JSON.stringify(results));
  return results;
}

export function channelStatus() {
  return {
    email: Boolean(transporter && NOTIFY_EMAIL_TO),
    line: Boolean(LINE_CHANNEL_ACCESS_TOKEN),
  };
}
