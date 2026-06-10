// Notification layer: Email (SMTP via nodemailer) + LINE Messaging API push.
// All channels are optional — if env vars are missing the channel is skipped
// gracefully so the app still runs out-of-the-box.
import nodemailer from 'nodemailer';

const {
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM,
  NOTIFY_EMAIL_TO,
  LINE_CHANNEL_ACCESS_TOKEN, LINE_TO,
} = process.env;

let transporter = null;
if (SMTP_HOST && SMTP_USER) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

const priorityEmoji = { 'ปกติ': '🟢', 'เร่งด่วน': '🟠', 'วิกฤต (หยุดการผลิต)': '🔴' };

function ticketText(t, headline) {
  return [
    `${headline}`,
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
    await transporter.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to: NOTIFY_EMAIL_TO,
      subject,
      text,
    });
    return { channel: 'email', ok: true };
  } catch (e) {
    return { channel: 'email', error: e.message };
  }
}

async function sendLine(text) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_TO) return { channel: 'line', skipped: true };
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ to: LINE_TO, messages: [{ type: 'text', text }] }),
    });
    if (!res.ok) return { channel: 'line', error: `HTTP ${res.status} ${await res.text()}` };
    return { channel: 'line', ok: true };
  } catch (e) {
    return { channel: 'line', error: e.message };
  }
}

export async function notifyNew(t) {
  const text = ticketText(t, '🔧 มีการแจ้งซ่อมใหม่');
  const results = await Promise.all([
    sendEmail(`[แจ้งซ่อม] ${t.no} - ${t.equipmentName}`, text),
    sendLine(text),
  ]);
  return results;
}

export async function notifyStatus(t) {
  const text = ticketText(t, `📌 อัปเดตสถานะงานซ่อม → ${t.status}`);
  const results = await Promise.all([
    sendEmail(`[อัปเดต ${t.status}] ${t.no} - ${t.equipmentName}`, text),
    sendLine(text),
  ]);
  return results;
}

export function channelStatus() {
  return {
    email: Boolean(transporter && NOTIFY_EMAIL_TO),
    line: Boolean(LINE_CHANNEL_ACCESS_TOKEN && LINE_TO),
  };
}
