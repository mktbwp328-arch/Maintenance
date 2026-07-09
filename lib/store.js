// Storage layer with two backends:
//   - Postgres / Supabase  (when DATABASE_URL or PGHOST+PGPASSWORD are set)
//   - JSON file            (fallback, runs out of the box)
// All functions are async and always return camelCase objects so the
// API/front-end is identical regardless of backend.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const EQUIP_FILE = path.join(DATA_DIR, 'equipment.json');

export const STATUSES = ['แจ้งซ่อม', 'ดำเนินการ', 'ส่งซ่อม / รออะไหล่', 'สำเร็จ', 'ยกเลิก'];
export const PRIORITIES = ['ปกติ', 'เร่งด่วน', 'วิกฤต (หยุดการผลิต)'];
// อนุญาตเปลี่ยนสถานะแบบเดินหน้าเท่านั้น
export const TRANSITIONS = {
  'แจ้งซ่อม': ['ดำเนินการ', 'ส่งซ่อม / รออะไหล่', 'สำเร็จ', 'ยกเลิก'],
  'ดำเนินการ': ['ส่งซ่อม / รออะไหล่', 'สำเร็จ', 'ยกเลิก'],
  'ส่งซ่อม / รออะไหล่': ['สำเร็จ', 'ยกเลิก'],
  'สำเร็จ': [],
  'ยกเลิก': [],
};
export const PM_TYPES = ['ตรวจเช็คตามวาระ', 'ทำความสะอาด', 'หล่อลื่น', 'เปลี่ยนอะไหล่', 'สอบเทียบ', 'อื่นๆ'];

export const usingSupabase = db.enabled;

// Equipment is static reference data — read from the JSON file (fast, sync).
export function getEquipment() {
  return JSON.parse(fs.readFileSync(EQUIP_FILE, 'utf8').replace(/^﻿/, ''));
}
const equipById = (id) => getEquipment().find((e) => e.id === id) || {};

// An "asset" can be a machine (equipment) OR a building/place (id = "BLD::<name>")
const BLD_PREFIX = 'BLD::';
export const isBuildingAsset = (id) => typeof id === 'string' && id.startsWith(BLD_PREFIX);
export const buildingOfAsset = (id) => (isBuildingAsset(id) ? id.slice(BLD_PREFIX.length) : null);
function assetInfo(id) {
  if (isBuildingAsset(id)) {
    const name = id.slice(BLD_PREFIX.length);
    return { id, name, type: 'อาคาร / สถานที่', dept: 'งานอาคาร', location: name, building: name };
  }
  if (id === 'OTHER') return { id, name: 'อื่นๆ', type: 'อื่นๆ', dept: '', location: '', building: '' };
  return equipById(id);
}

// เพิ่มเครื่องจักรใหม่ (บันทึกลงทั้งไฟล์ equipment.json และตาราง equipment)
export async function createEquipment(input) {
  const id = (input.id || '').trim();
  if (!id || !(input.name || '').trim()) throw new Error('กรุณากรอกรหัสและชื่อเครื่องจักร');
  const list = getEquipment();
  if (list.some((e) => e.id === id)) throw new Error('มีรหัสเครื่องจักรนี้แล้ว');
  const eq = {
    id, sn: (input.sn || '-').trim(), name: input.name.trim(), type: (input.type || 'อื่นๆ').trim(),
    dept: (input.dept || '').trim(), location: (input.location || '').trim(), building: (input.building || '').trim(),
  };
  list.push(eq);
  // write to the seed file when possible (ignored on read-only serverless FS)
  try { fs.writeFileSync(EQUIP_FILE, '[\n' + list.map((e) => '  ' + JSON.stringify(e)).join(',\n') + '\n]\n'); }
  catch (err) { console.warn('equipment.json write skipped:', err.message); }
  if (db.enabled) await db.q(
    `insert into equipment(id,sn,name,type,dept,location,building) values($1,$2,$3,$4,$5,$6,$7)
     on conflict(id) do update set sn=excluded.sn,name=excluded.name,type=excluded.type,dept=excluded.dept,location=excluded.location,building=excluded.building`,
    [eq.id, eq.sn, eq.name, eq.type, eq.dept, eq.location, eq.building]);
  return eq;
}

// ---------------- JSON fallback helpers ----------------
function jsonLoad() {
  if (!fs.existsSync(DB_FILE)) {
    const seed = { tickets: [], pm: [], seq: {} };
    try { fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2)); } catch { /* read-only FS */ }
    return seed;
  }
  const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8').replace(/^﻿/, ''));
  if (!d.pm) d.pm = [];
  return d;
}
function jsonSave(d) { try { fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); } catch { /* read-only FS */ } }

// ---------------- mappers (snake_case row <-> camelCase) ----------------
const rowToTicket = (r) => ({
  id: r.id, no: r.no, reporter: r.reporter, phone: r.phone, email: r.email, dept: r.dept,
  reqDept: r.req_dept || '',
  equipmentId: r.equipment_id, equipmentName: r.equipment_name, location: r.location,
  problemType: r.problem_type, priority: r.priority, detail: r.detail, status: r.status,
  assignee: r.assignee, solution: r.solution, history: r.history || [],
  photo: r.photo || '',
  createdBy: r.created_by || '',
  createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  closedAt: r.closed_at instanceof Date ? r.closed_at.toISOString() : r.closed_at,
});
const rowToPm = (r) => ({
  id: r.id, no: r.no, equipmentId: r.equipment_id, equipmentName: r.equipment_name, dept: r.dept,
  type: r.type, date: typeof r.date === 'string' ? r.date : (r.date ? new Date(r.date).toISOString().slice(0, 10) : ''),
  performedBy: r.performed_by, detail: r.detail, result: r.result,
  nextDue: r.next_due ? (typeof r.next_due === 'string' ? r.next_due : new Date(r.next_due).toISOString().slice(0, 10)) : '',
  createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
});

// ---------------- document numbers ----------------
async function nextTicketNo() {
  const now = new Date();
  const key = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (db.enabled) return `MTD-${key}${String(await db.nextSeq(key)).padStart(4, '0')}`;
  const d = jsonLoad();
  d.seq[key] = (d.seq[key] || 0) + 1; jsonSave(d);
  return `MTD-${key}${String(d.seq[key]).padStart(4, '0')}`;
}
const genId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ==================== TICKETS ====================
// คอลัมน์ของ list (ไม่ดึง photo base64 ก้อนใหญ่ — ส่งแค่ has_photo) เพื่อความเร็ว
const LIST_COLS = "id,no,reporter,phone,email,dept,req_dept,equipment_id,equipment_name,location,problem_type,priority,detail,status,assignee,solution,history,created_at,updated_at,closed_at,created_by,(photo is not null and photo <> '') as has_photo";

export async function listTickets(filter = {}) {
  let rows;
  if (db.enabled) {
    rows = (await db.q(`select ${LIST_COLS} from tickets order by created_at desc`)).map((r) => {
      const t = rowToTicket(r); delete t.photo; t.hasPhoto = r.has_photo; return t;
    });
  } else {
    rows = [...jsonLoad().tickets].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ photo, ...r }) => ({ ...r, hasPhoto: Boolean(photo) }));
  }
  if (filter.createdBy) rows = rows.filter((t) => t.createdBy === filter.createdBy);
  if (filter.status) rows = rows.filter((t) => t.status === filter.status);
  if (filter.q) {
    const qq = filter.q.toLowerCase();
    rows = rows.filter((t) => [t.no, t.reporter, t.equipmentId, t.equipmentName, t.detail, t.problemType]
      .filter(Boolean).some((v) => v.toLowerCase().includes(qq)));
  }
  return rows;
}

export async function getTicket(id) {
  if (db.enabled) {
    const rows = await db.q('select * from tickets where id=$1 or no=$1 limit 1', [id]);
    return rows[0] ? rowToTicket(rows[0]) : null;
  }
  return jsonLoad().tickets.find((t) => t.id === id || t.no === id) || null;
}

export async function createTicket(input) {
  const now = new Date().toISOString();
  const eq = assetInfo(input.equipmentId);
  const t = {
    id: genId('T'), no: await nextTicketNo(),
    reporter: input.reporter || '', phone: input.phone || '', email: input.email || '',
    dept: eq.dept || input.dept || '', reqDept: input.reqDept || '',
    equipmentId: input.equipmentId || '', equipmentName: eq.name || input.equipmentName || '', location: eq.location || '',
    problemType: input.problemType || '',
    priority: PRIORITIES.includes(input.priority) ? input.priority : 'ปกติ',
    detail: input.detail || '', status: 'แจ้งซ่อม', assignee: '', solution: '',
    photo: input.photo || '',
    createdBy: input.createdBy || '',
    history: [{ at: now, status: 'แจ้งซ่อม', note: 'สร้างใบแจ้งซ่อม' }],
    createdAt: now, updatedAt: now, closedAt: null,
  };
  if (db.enabled) {
    await db.q(
      `insert into tickets(id,no,reporter,phone,email,dept,req_dept,equipment_id,equipment_name,location,problem_type,priority,detail,status,assignee,solution,history,created_at,updated_at,closed_at,created_by,photo)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [t.id, t.no, t.reporter, t.phone, t.email, t.dept, t.reqDept, t.equipmentId, t.equipmentName, t.location,
       t.problemType, t.priority, t.detail, t.status, t.assignee, t.solution, JSON.stringify(t.history), t.createdAt, t.updatedAt, t.closedAt, t.createdBy, t.photo]
    );
  } else { const d = jsonLoad(); d.tickets.push(t); jsonSave(d); }
  return t;
}

export async function updateTicket(id, patch) {
  const t = await getTicket(id);
  if (!t) return null;
  const now = new Date().toISOString();
  const statusChanged = patch.status && patch.status !== t.status;
  if (statusChanged && !(TRANSITIONS[t.status] || []).includes(patch.status))
    throw new Error(`เปลี่ยนสถานะจาก "${t.status}" เป็น "${patch.status}" ไม่ได้`);
  ['assignee', 'solution', 'detail', 'priority', 'problemType', 'reporter', 'phone', 'email', 'reqDept'].forEach((k) => { if (patch[k] !== undefined) t[k] = patch[k]; });
  // เปลี่ยนเครื่องจักร/อาคาร -> ดึงข้อมูลใหม่
  if (patch.equipmentId !== undefined && patch.equipmentId && patch.equipmentId !== t.equipmentId) {
    const eq = assetInfo(patch.equipmentId);
    t.equipmentId = patch.equipmentId;
    t.equipmentName = eq.name || '';
    t.dept = eq.dept || '';
    t.location = eq.location || '';
  }
  if (statusChanged) {
    t.status = patch.status;
    t.history = [...t.history, { at: now, status: patch.status, note: patch.note || '' }];
    if (patch.status === 'สำเร็จ' || patch.status === 'ยกเลิก') {
      // ใช้วันที่ที่ผู้ใช้เลือก (YYYY-MM-DD, อิงเวลาไทยเที่ยงวันกันวันเพี้ยน) ถ้าไม่ได้เลือกใช้เวลาปัจจุบัน
      t.closedAt = /^\d{4}-\d{2}-\d{2}$/.test(patch.closedDate || '')
        ? new Date(`${patch.closedDate}T12:00:00+07:00`).toISOString()
        : now;
    }
  }
  t.updatedAt = now;
  if (db.enabled) {
    await db.q(
      `update tickets set reporter=$2,phone=$3,email=$4,dept=$5,req_dept=$6,equipment_id=$7,equipment_name=$8,location=$9,problem_type=$10,priority=$11,detail=$12,assignee=$13,solution=$14,status=$15,history=$16,updated_at=$17,closed_at=$18 where id=$1`,
      [t.id, t.reporter, t.phone, t.email, t.dept, t.reqDept, t.equipmentId, t.equipmentName, t.location, t.problemType, t.priority, t.detail, t.assignee, t.solution, t.status, JSON.stringify(t.history), t.updatedAt, t.closedAt]
    );
  } else { const d = jsonLoad(); d.tickets[d.tickets.findIndex((x) => x.id === t.id)] = t; jsonSave(d); }
  return { ticket: t, statusChanged };
}

export async function deleteTicket(id) {
  if (db.enabled) { const r = await db.q('delete from tickets where id=$1 or no=$1 returning id', [id]); return r.length > 0; }
  const d = jsonLoad(); const before = d.tickets.length;
  d.tickets = d.tickets.filter((t) => t.id !== id && t.no !== id); jsonSave(d);
  return d.tickets.length < before;
}

// ==================== PM ====================
export async function listPM(filter = {}) {
  let rows;
  if (db.enabled) rows = (await db.q('select * from pm order by date desc')).map(rowToPm);
  else rows = [...jsonLoad().pm].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (filter.equipmentId) rows = rows.filter((p) => p.equipmentId === filter.equipmentId);
  if (filter.q) {
    const qq = filter.q.toLowerCase();
    rows = rows.filter((p) => [p.no, p.equipmentId, p.equipmentName, p.type, p.detail, p.performedBy]
      .filter(Boolean).some((v) => v.toLowerCase().includes(qq)));
  }
  return rows;
}

export async function createPM(input) {
  const now = new Date().toISOString();
  const eq = assetInfo(input.equipmentId);
  let seq;
  if (db.enabled) seq = await db.nextSeq('PM');
  else { const d = jsonLoad(); d.seq.PM = (d.seq.PM || 0) + 1; jsonSave(d); seq = d.seq.PM; }
  const rec = {
    id: genId('PM'), no: 'PM-' + String(seq).padStart(5, '0'),
    equipmentId: input.equipmentId || '', equipmentName: eq.name || '', dept: eq.dept || '',
    type: input.type || 'ตรวจเช็คตามวาระ', date: input.date || now.slice(0, 10),
    performedBy: input.performedBy || '', detail: input.detail || '',
    result: input.result || 'ปกติ', nextDue: input.nextDue || '', createdAt: now,
  };
  if (db.enabled) {
    await db.q(
      `insert into pm(id,no,equipment_id,equipment_name,dept,type,date,performed_by,detail,result,next_due,created_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [rec.id, rec.no, rec.equipmentId, rec.equipmentName, rec.dept, rec.type, rec.date, rec.performedBy, rec.detail, rec.result, rec.nextDue || null, rec.createdAt]
    );
  } else { const d = jsonLoad(); d.pm.push(rec); jsonSave(d); }
  return rec;
}

export async function deletePM(id) {
  if (db.enabled) { const r = await db.q('delete from pm where id=$1 returning id', [id]); return r.length > 0; }
  const d = jsonLoad(); const before = d.pm.length;
  d.pm = d.pm.filter((p) => p.id !== id); jsonSave(d);
  return d.pm.length < before;
}

export async function pmDue(withinDays = 30) {
  const today = new Date().toISOString().slice(0, 10);
  const limit = new Date(Date.now() + withinDays * 86400000).toISOString().slice(0, 10);
  const all = await listPM();
  return all.filter((p) => p.nextDue && p.nextDue <= limit)
    .map((p) => ({ ...p, overdue: p.nextDue < today }))
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue));
}

// ==================== STATS ====================
export async function stats(range = {}) {
  let tickets = await listTickets();
  if (range.createdBy) tickets = tickets.filter((t) => t.createdBy === range.createdBy);
  if (range.from) tickets = tickets.filter((t) => (t.createdAt || '').slice(0, 10) >= range.from);
  if (range.to) tickets = tickets.filter((t) => (t.createdAt || '').slice(0, 10) <= range.to);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const byType = {};
  for (const t of tickets) {
    counts[t.status] = (counts[t.status] || 0) + 1;
    const type = isBuildingAsset(t.equipmentId) ? 'อาคาร / สถานที่' : (equipById(t.equipmentId).type || 'อื่นๆ');
    byType[type] = (byType[type] || 0) + 1;
  }
  return { total: tickets.length, counts, byType };
}

// ==================== EQUIPMENT HISTORY ====================
const OPEN_STATUSES = new Set(['แจ้งซ่อม', 'ดำเนินการ', 'ส่งซ่อม / รออะไหล่']);

export async function equipmentHistory(equipmentId) {
  const eq = equipById(equipmentId);
  const [allT, allP] = [await listTickets(), await listPM()];
  const tickets = allT.filter((t) => t.equipmentId === equipmentId);
  const pm = allP.filter((p) => p.equipmentId === equipmentId);
  const lastPm = pm[0] || null; // listPM is sorted by date desc
  const openCount = tickets.filter((t) => OPEN_STATUSES.has(t.status)).length;
  return {
    equipment: { id: equipmentId, ...eq },
    summary: { repairs: tickets.length, openRepairs: openCount, pmCount: pm.length, lastPm: lastPm?.date || null, nextDue: lastPm?.nextDue || null },
    tickets, pm,
  };
}

// ==================== BUILDINGS (registry + dashboard) ====================
const DEFAULT_BUILDINGS = [
  { name: 'อาคาร 1', note: 'สายการผลิตเป่า (Blowing Production)' },
  { name: 'อาคาร 2', note: 'สายการผลิตพิมพ์ (Printing Production)' },
  { name: 'อาคาร 3', note: 'อาคารสำนักงาน (Office)' },
];

export async function listBuildings() {
  if (db.enabled) return db.q('select name, note from buildings order by name');
  const d = jsonLoad();
  return d.buildings || DEFAULT_BUILDINGS;
}

export async function createBuilding({ name, note }) {
  if (!name || !name.trim()) throw new Error('กรุณาระบุชื่ออาคาร');
  name = name.trim();
  if (db.enabled) {
    const exists = await db.q('select name from buildings where name=$1', [name]);
    if (exists.length) throw new Error('มีอาคารนี้แล้ว');
    await db.q('insert into buildings(name,note) values($1,$2)', [name, note || '']);
  } else {
    const d = jsonLoad(); d.buildings ||= [...DEFAULT_BUILDINGS];
    if (d.buildings.some((b) => b.name === name)) throw new Error('มีอาคารนี้แล้ว');
    d.buildings.push({ name, note: note || '' }); jsonSave(d);
  }
  return { name, note: note || '' };
}

export async function deleteBuilding(name) {
  if (db.enabled) await db.q('delete from buildings where name=$1', [name]);
  else { const d = jsonLoad(); d.buildings = (d.buildings || DEFAULT_BUILDINGS).filter((b) => b.name !== name); jsonSave(d); }
}

export async function seedBuildings() {
  if (!db.enabled) { const d = jsonLoad(); if (!d.buildings) { d.buildings = [...DEFAULT_BUILDINGS]; jsonSave(d); } return; }
  const rows = await db.q('select name from buildings limit 1');
  if (!rows.length) for (const b of DEFAULT_BUILDINGS) await db.q('insert into buildings(name,note) values($1,$2) on conflict(name) do nothing', [b.name, b.note]);
}

// ประวัติการซ่อม + PM ของอาคาร (รวมงานที่แจ้งกับอาคารเอง และเครื่องจักรในอาคาร)
export async function buildingHistory(name) {
  // นับเฉพาะใบที่แจ้งกับ "อาคารโดยตรง" (BLD::) — ไม่ผูกกับเครื่องจักรที่อยู่ในอาคาร
  const inBuilding = (id) => buildingOfAsset(id) === name;
  const tickets = (await listTickets()).filter((t) => inBuilding(t.equipmentId));
  const pm = (await listPM()).filter((p) => inBuilding(p.equipmentId));
  const openCount = tickets.filter((t) => OPEN_STATUSES.has(t.status)).length;
  return { name, repairs: tickets.length, openRepairs: openCount, pmCount: pm.length, tickets, pm };
}

export async function buildingOverview() {
  // นับเฉพาะใบที่แจ้งกับ "อาคารโดยตรง" (BLD::) — ไม่ผูกกับเครื่องจักร
  const buildings = await listBuildings();
  const [tickets, pm] = [await listTickets(), await listPM()];
  const today = new Date().toISOString().slice(0, 10);
  const map = {};
  for (const b of buildings) map[b.name] = { name: b.name, note: b.note || '', repairs: 0, open: 0, pmOverdue: 0 };
  for (const t of tickets) {
    if (!isBuildingAsset(t.equipmentId)) continue;
    const m = map[buildingOfAsset(t.equipmentId)]; if (!m) continue;
    m.repairs++; if (OPEN_STATUSES.has(t.status)) m.open++;
  }
  for (const p of pm) {
    if (!isBuildingAsset(p.equipmentId)) continue;
    const m = map[buildingOfAsset(p.equipmentId)]; if (!m) continue;
    if (p.nextDue && p.nextDue < today) m.pmOverdue++;
  }
  return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, 'th'));
}

// ==================== EQUIPMENT OVERVIEW (all machines) ====================
export async function equipmentOverview() {
  const [tickets, pm] = [await listTickets(), await listPM()];
  const today = new Date().toISOString().slice(0, 10);
  const map = {};
  for (const e of getEquipment())
    map[e.id] = { ...e, repairs: 0, open: 0, lastRepair: null, pmCount: 0, lastPm: null, nextDue: null };
  for (const t of tickets) {
    const m = map[t.equipmentId]; if (!m) continue;
    m.repairs++; if (OPEN_STATUSES.has(t.status)) m.open++;
    const d = (t.createdAt || '').slice(0, 10);
    if (d && (!m.lastRepair || d > m.lastRepair)) m.lastRepair = d;
  }
  for (const p of pm) {
    const m = map[p.equipmentId]; if (!m) continue;
    m.pmCount++;
    if (p.date && (!m.lastPm || p.date > m.lastPm)) m.lastPm = p.date;
    if (p.nextDue && (!m.nextDue || p.nextDue < m.nextDue)) m.nextDue = p.nextDue;
  }
  const list = Object.values(map).map((m) => {
    const pmOverdue = m.nextDue ? m.nextDue < today : false;
    const health = m.open > 0 ? 'repair' : pmOverdue ? 'pmdue' : m.repairs === 0 ? 'new' : 'ok';
    return { ...m, pmOverdue, health };
  });
  list.sort((a, b) => b.repairs - a.repairs || b.open - a.open);
  const kpi = {
    machines: list.length,
    withOpen: list.filter((m) => m.open > 0).length,
    pmOverdue: list.filter((m) => m.pmOverdue).length,
    neverRepaired: list.filter((m) => m.repairs === 0).length,
  };
  return { kpi, list };
}

// ==================== SETTINGS (key/value เช่น groupId ของไลน์) ====================
export async function getSetting(key) {
  if (db.enabled) { const r = await db.q('select value from settings where key=$1', [key]); return r[0]?.value || null; }
  return (jsonLoad().settings || {})[key] || null;
}
export async function setSetting(key, value) {
  if (db.enabled) await db.q('insert into settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value', [key, value]);
  else { const d = jsonLoad(); d.settings ||= {}; d.settings[key] = value; jsonSave(d); }
}

// ==================== KNOWLEDGE BASE (ปัญหา & สาเหตุ) ====================
const KB_DEFAULTS = [
  ['ไฟฟ้า', 'ไฟไม่เข้า เบรกเกอร์ทริป', 'ไฟฟ้าลัดวงจร หรือโหลดเกินพิกัด', 'ตรวจหาจุดลัดวงจร เปลี่ยนแมกเนติกคอนแทคเตอร์/เบรกเกอร์ และตรวจกระแสโหลด'],
  ['เครื่องกล', 'สายพานหย่อน/ขาด เครื่องสั่น', 'สายพานเสื่อมสภาพ หรือความตึงไม่เหมาะสม', 'เปลี่ยนสายพานและปรับความตึง สมดุลใหม่'],
  ['ระบบลม', 'ลมรั่ว แรงดันตก', 'ชุดวาล์วหรือข้อต่อลมรั่ว', 'เปลี่ยนชุด solenoid valve และซ่อม/เปลี่ยนข้อต่อลม'],
  ['ระบบทำความเย็น', 'ทำความเย็นไม่ลง', 'น้ำยาน้อย หรือคอนเดนเซอร์สกปรก', 'เติมน้ำยาและล้างคอนเดนเซอร์ ตรวจการรั่ว'],
  ['หน้าจอควบคุม', 'หน้าจอค้าง/ดับ', 'สายแพหลวม หรือ PLC ค้าง', 'รีเซ็ต PLC และเปลี่ยนสายแพหน้าจอ'],
  ['งานอาคาร', 'ไฟส่องสว่างดับ', 'หลอดไฟหรือบัลลาสต์เสีย', 'เปลี่ยนหลอดไฟ/บัลลาสต์ ตรวจสายและสวิตช์'],
];
const rowToKB = (r) => ({ id: r.id, category: r.category, problem: r.problem, cause: r.cause, solution: r.solution });

export async function listKB(filter = {}) {
  let rows;
  if (db.enabled) rows = (await db.q('select * from problem_kb order by category, problem')).map(rowToKB);
  else rows = jsonLoad().kb || [];
  if (filter.category) rows = rows.filter((k) => k.category === filter.category);
  if (filter.q) {
    const qq = filter.q.toLowerCase();
    rows = rows.filter((k) => [k.category, k.problem, k.cause, k.solution].filter(Boolean).some((v) => v.toLowerCase().includes(qq)));
  }
  return rows;
}

export async function createKB(input) {
  if (!input.category || !input.problem) throw new Error('กรุณากรอกหมวดและอาการ/ปัญหา');
  const rec = { id: genId('KB'), category: input.category.trim(), problem: input.problem.trim(), cause: input.cause || '', solution: input.solution || '' };
  if (db.enabled) await db.q('insert into problem_kb(id,category,problem,cause,solution) values($1,$2,$3,$4,$5)', [rec.id, rec.category, rec.problem, rec.cause, rec.solution]);
  else { const d = jsonLoad(); d.kb ||= []; d.kb.push(rec); jsonSave(d); }
  return rec;
}

export async function deleteKB(id) {
  if (db.enabled) { const r = await db.q('delete from problem_kb where id=$1 returning id', [id]); return r.length > 0; }
  const d = jsonLoad(); const before = (d.kb || []).length; d.kb = (d.kb || []).filter((k) => k.id !== id); jsonSave(d);
  return (d.kb || []).length < before;
}

export async function seedKB() {
  if (!db.enabled) { const d = jsonLoad(); if (!d.kb) { d.kb = KB_DEFAULTS.map((x, i) => ({ id: 'KB' + i, category: x[0], problem: x[1], cause: x[2], solution: x[3] })); jsonSave(d); } return; }
  const rows = await db.q('select id from problem_kb limit 1');
  if (!rows.length) for (let i = 0; i < KB_DEFAULTS.length; i++) {
    const x = KB_DEFAULTS[i];
    await db.q('insert into problem_kb(id,category,problem,cause,solution) values($1,$2,$3,$4,$5) on conflict(id) do nothing', ['KB' + String(i + 1).padStart(4, '0'), x[0], x[1], x[2], x[3]]);
  }
}

// ==================== PROBLEM SUMMARY ====================
export async function problemSummary(range = {}) {
  let tickets = await listTickets();
  if (range.createdBy) tickets = tickets.filter((t) => t.createdBy === range.createdBy);
  if (range.from) tickets = tickets.filter((t) => (t.createdAt || '').slice(0, 10) >= range.from);
  if (range.to) tickets = tickets.filter((t) => (t.createdAt || '').slice(0, 10) <= range.to);
  const byProblemType = {}, byPriority = {}, byDept = {}, byStatus = {};
  const eqMap = {};
  let open = 0, closed = 0, totalResolveMs = 0, resolvedCount = 0;
  for (const t of tickets) {
    const pt = t.problemType || 'ไม่ระบุ';
    byProblemType[pt] = (byProblemType[pt] || 0) + 1;
    byPriority[t.priority || 'ปกติ'] = (byPriority[t.priority || 'ปกติ'] || 0) + 1;
    byDept[t.dept || 'ไม่ระบุ'] = (byDept[t.dept || 'ไม่ระบุ'] || 0) + 1;
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    if (OPEN_STATUSES.has(t.status)) open++; else closed++;
    const e = (eqMap[t.equipmentId] ||= { equipmentId: t.equipmentId, equipmentName: t.equipmentName, type: isBuildingAsset(t.equipmentId) ? 'อาคาร / สถานที่' : (equipById(t.equipmentId).type || 'อื่นๆ'), count: 0, open: 0 });
    e.count++; if (OPEN_STATUSES.has(t.status)) e.open++;
    if (t.status === 'สำเร็จ' && t.closedAt && t.createdAt) {
      totalResolveMs += new Date(t.closedAt) - new Date(t.createdAt); resolvedCount++;
    }
  }
  const topEquipment = Object.values(eqMap).sort((a, b) => b.count - a.count).slice(0, 10);
  const avgResolveHours = resolvedCount ? +(totalResolveMs / resolvedCount / 3600000).toFixed(1) : 0;
  return { total: tickets.length, open, closed, resolvedCount, avgResolveHours, byProblemType, byPriority, byDept, byStatus, topEquipment };
}

// ==================== SEED (first run on Postgres) ====================
export async function seedSupabase() {
  if (!db.enabled) return;
  const rows = await db.q('select id from equipment limit 1');
  if (!rows.length) {
    const eq = getEquipment();
    for (const e of eq) {
      await db.q('insert into equipment(id,sn,name,type,dept,location,building) values($1,$2,$3,$4,$5,$6,$7) on conflict(id) do nothing',
        [e.id, e.sn, e.name, e.type, e.dept, e.location, e.building]);
    }
    console.log(`   ↳ seed เครื่องจักร ${eq.length} รายการลง Postgres แล้ว`);
  }
}
