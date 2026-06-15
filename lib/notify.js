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

// push ข้อความไปยังปลายทาง (userId / groupId / roomId)
async function pushLine(to, text) {
  const token = await lineToken();
  if (!token || !to) return { channel: 'line', skipped: true };
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
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
  return Promise.all([
    sendEmail(`[แจ้งซ่อม] ${t.no} - ${t.equipmentName}`, text),
    pushLine(group, text),
  ]);
}

export async function notifyStatus(t) {
  const text = ticketText(t, `📌 อัปเดตสถานะงานซ่อม → ${t.status}`);
  const group = await groupTarget();
  const tasks = [
    sendEmail(`[อัปเดต ${t.status}] ${t.no} - ${t.equipmentName}`, text),
    pushLine(group, text),
  ];
  // แจ้งกลับไปยังผู้ที่แจ้งผ่านไลน์โดยตรง
  const user = lineUserOf(t);
  if (user) tasks.push(pushLine(user, ticketText(t, `🔔 อัปเดตงานที่คุณแจ้ง → ${t.status}`)));
  return Promise.all(tasks);
}

export function channelStatus() {
  return {
    email: Boolean(transporter && NOTIFY_EMAIL_TO),
    line: Boolean(LINE_CHANNEL_ACCESS_TOKEN),
  };
}
