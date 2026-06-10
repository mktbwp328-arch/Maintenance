// Seed mock data straight into Postgres (Supabase) via the pg driver.
// Uses PG* env vars. Idempotent: clears tickets/pm then re-inserts; upserts equipment/users.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const equipment = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'equipment.json'), 'utf8').replace(/^﻿/, ''));
const byId = Object.fromEntries(equipment.map((e) => [e.id, e]));

const hash = (pw) => { const s = crypto.randomBytes(16).toString('hex'); return `${s}:${crypto.scryptSync(pw, s, 64).toString('hex')}`; };
const iso = (y, m, d, hh = 9, mm = 0) => new Date(Date.UTC(y, m - 1, d, hh - 7, mm)).toISOString(); // Thailand local -> UTC
const genId = (p, i) => `${p}${i.toString(36).padStart(6, '0')}${Math.random().toString(36).slice(2, 5)}`;

// ---- users ----
const users = [
  { username: 'admin', name: 'ผู้ดูแลระบบ', role: 'admin', email: '', pw: 'admin123' },
  { username: 'tech', name: 'ช่างเทคนิค', role: 'technician', email: '', pw: 'tech123' },
  { username: 'user', name: 'พนักงานทั่วไป', role: 'reporter', email: '', pw: 'user123' },
  { username: 'jadsada', name: 'เจษฎาภรณ์ กลับหมอ', role: 'technician', email: '', pw: 'mtd123' },
  { username: 'pathom', name: 'ปฐมพงษ์ อินจันทร์', role: 'technician', email: '', pw: 'mtd123' },
  { username: 'sathit', name: 'สาธิตพงษ์ สุขขี', role: 'technician', email: '', pw: 'mtd123' },
  { username: 'phattara', name: 'ภัทรพร ประกอบกิจ', role: 'reporter', email: '', pw: 'mtd123' },
];

const TECHS = ['เจษฎาภรณ์ กลับหมอ', 'ปฐมพงษ์ อินจันทร์', 'สาธิตพงษ์ สุขขี', 'จุฬีพงษ์ สันป่านาง้าว', 'เทิดศักดิ์ มณฑี'];

// ---- tickets: [eqId, reporter, phone, problemType, priority, detail, status, assignee, solution, y, m, d] ----
const P = { N: 'ปกติ', U: 'เร่งด่วน', C: 'วิกฤต (หยุดการผลิต)' };
const S = { NEW: 'แจ้งซ่อม', DO: 'ดำเนินการ', WAIT: 'ส่งซ่อม / รออะไหล่', DONE: 'สำเร็จ', CANCEL: 'ยกเลิก' };
const T = [
  ['BL-PRO-01', 'ภัทรพร ประกอบกิจ', '0945566604', 'เครื่องกล', P.U, 'สายพานลำเลียงหย่อน เครื่องสั่นผิดปกติ', S.DONE, 'เจษฎาภรณ์ กลับหมอ', 'ปรับความตึงสายพานและเปลี่ยนลูกปืนตัวกลาง ทดสอบเดินเครื่องปกติ', 2026, 1, 8],
  ['BL-PRO-03', 'สมบูรณ์ ปานพิญใจ', '0812345671', 'หน้าจอควบคุม', P.U, 'หน้าจอ HMI ดับ กดปุ่มไม่ตอบสนอง', S.DONE, 'ปฐมพงษ์ อินจันทร์', 'เปลี่ยนสาย flat cable หน้าจอและรีเซ็ต PLC ใช้งานได้ปกติ', 2026, 1, 15],
  ['PT-PRO-01', 'ภัทรพร ประกอบกิจ', '0945566604', 'ไฟฟ้า', P.C, 'เครื่องพิมพ์ไฟไม่เข้า เบรกเกอร์ตัด', S.DONE, 'สาธิตพงษ์ สุขขี', 'พบไฟฟ้าลัดที่มอเตอร์หลัก เปลี่ยนมอเตอร์ใหม่ 220VAC ทดสอบผ่าน', 2026, 2, 3],
  ['CL-PRO-02', 'สมหญิง ทองดี', '0823456712', 'ระบบทำความเย็น', P.U, 'Chiller ทำความเย็นไม่ลง อุณหภูมิสูงกว่าปกติ', S.DONE, 'เจษฎาภรณ์ กลับหมอ', 'เติมน้ำยา R22 และล้างคอนเดนเซอร์ อุณหภูมิกลับสู่ค่าปกติ', 2026, 2, 12],
  ['OAC-BPP-08', 'วิภาวี ศรีสุข', '0834567123', 'ระบบทำความเย็น', P.N, 'แอร์ห้อง Printing Production ไม่เย็น มีน้ำหยด', S.DONE, 'จุฬีพงษ์ สันป่านาง้าว', 'ล้างแผงคอยล์เย็นและทำความสะอาดท่อน้ำทิ้ง', 2026, 2, 20],
  ['MX-PRO-02', 'อนุชา ใจกล้า', '0845678123', 'เครื่องกล', P.U, 'เครื่องผสมเม็ดมีเสียงดังผิดปกติที่ชุดเกียร์', S.DONE, 'เทิดศักดิ์ มณฑี', 'เปลี่ยนน้ำมันเกียร์และซีลกันรั่ว เสียงเงียบลงปกติ', 2026, 3, 5],
  ['BL-PRO-07', 'สมบูรณ์ ปานพิญใจ', '0812345671', 'ระบบลม', P.U, 'ลมรั่วที่ชุดวาล์ว แรงดันลมตก', S.DONE, 'ปฐมพงษ์ อินจันทร์', 'เปลี่ยนชุด solenoid valve และซ่อมข้อต่อลม', 2026, 3, 14],
  ['SL-PRO-02', 'ภัทรพร ประกอบกิจ', '0945566604', 'ไฟฟ้า', P.N, 'เครื่องกรอม้วน Slitter หยุดทำงานเป็นช่วง ๆ', S.DONE, 'สาธิตพงษ์ สุขขี', 'พบขั้วต่อหลวมที่ตู้ควบคุม ขันแน่นและเปลี่ยน relay', 2026, 3, 22],
  ['TFM-MTD-01', 'ช่างไฟ ส่วนกลาง', '0856789123', 'ไฟฟ้า', P.C, 'หม้อแปลงมีเสียงครางและความร้อนสูง', S.DONE, 'สาธิตพงษ์ สุขขี', 'ตรวจวัดโหลดและขันแน่น busbar เพิ่มการระบายอากาศ', 2026, 4, 2],
  ['RW-PRO-05', 'สมหญิง ทองดี', '0823456712', 'เครื่องกล', P.N, 'เครื่องกรอฟิล์มยืดม้วนไม่ตรง ขอบฟิล์มย่น', S.DONE, 'เจษฎาภรณ์ กลับหมอ', 'ปรับตั้งศูนย์ลูกกลิ้งและเซนเซอร์ EPC', 2026, 4, 10],
  ['AD-PRO-01', 'อนุชา ใจกล้า', '0845678123', 'ระบบลม', P.N, 'Air Dryer ความชื้นลมสูง จุดน้ำค้างไม่ผ่าน', S.DONE, 'ปฐมพงษ์ อินจันทร์', 'เปลี่ยนไส้กรองและสารดูดความชื้น', 2026, 4, 18],
  ['BL-PRO-09', 'สมบูรณ์ ปานพิญใจ', '0812345671', 'หน้าจอควบคุม', P.U, 'ค่าอุณหภูมิหัวดายผิดเพี้ยน อ่านค่าไม่นิ่ง', S.DONE, 'เทิดศักดิ์ มณฑี', 'เปลี่ยน thermocouple และสอบเทียบ controller', 2026, 5, 6],
  ['OAC-BPP-02', 'เลขา ผู้บริหาร', '0867891234', 'ระบบทำความเย็น', P.N, 'แอร์ห้อง MD ไม่เย็น คอมเพรสเซอร์ไม่ทำงาน', S.WAIT, 'จุฬีพงษ์ สันป่านาง้าว', 'พบคอมเพรสเซอร์ชำรุด สั่งอะไหล่ทดแทน รออะไหล่เข้า', 2026, 5, 21],
  ['BL-PRO-11', 'ภัทรพร ประกอบกิจ', '0945566604', 'หน้าจอควบคุม', P.U, 'หน้าจอควบคุมค้าง รีสตาร์ทเองเป็นระยะ', S.WAIT, 'ปฐมพงษ์ อินจันทร์', 'คาดว่าบอร์ดจ่ายไฟเสีย สั่งบอร์ดใหม่จากตัวแทน', 2026, 5, 28],
  ['CL-PRO-04', 'อนุชา ใจกล้า', '0845678123', 'ระบบทำความเย็น', P.U, 'Chiller Ample cool แจ้ง error แรงดันสูง', S.DO, 'เจษฎาภรณ์ กลับหมอ', '', 2026, 6, 2],
  ['PT-PRO-03', 'สมหญิง ทองดี', '0823456712', 'เครื่องกล', P.U, 'ลูกกลิ้งพิมพ์มีรอย หมึกพิมพ์ไม่สม่ำเสมอ', S.DO, 'สาธิตพงษ์ สุขขี', '', 2026, 6, 3],
  ['MX-PRO-04', 'สมบูรณ์ ปานพิญใจ', '0812345671', 'ไฟฟ้า', P.C, 'เครื่องผสมเม็ดไฟตัด สตาร์ทไม่ได้', S.DO, 'เทิดศักดิ์ มณฑี', '', 2026, 6, 4],
  ['SF-PRO-01', 'วิภาวี ศรีสุข', '0834567123', 'เครื่องกล', P.N, 'เครื่องนำฟิล์มยืด ฟิล์มขาดบ่อย', S.NEW, '', '', 2026, 6, 5],
  ['OAC-BPP-13', 'แม่ครัว โรงอาหาร', '0878912345', 'ระบบทำความเย็น', P.N, 'แอร์โรงอาหาร 1 ไม่เย็น มีกลิ่นอับ', S.NEW, '', '', 2026, 6, 5],
  ['BL-PRO-05', 'ภัทรพร ประกอบกิจ', '0945566604', 'เครื่องกล', P.U, 'สายพานขาด ต้องเปลี่ยนด่วน', S.NEW, '', '', 2026, 6, 6],
  ['RW-PRO-02', 'อนุชา ใจกล้า', '0845678123', 'ไฟฟ้า', P.N, 'เครื่องกรอม้วนหมุนช้ากว่าปกติ', S.NEW, '', '', 2026, 6, 6],
  ['MDB-MTD-02', 'ช่างไฟ ส่วนกลาง', '0856789123', 'ไฟฟ้า', P.U, 'ตู้ MDB มีกลิ่นไหม้เล็กน้อยที่เบรกเกอร์', S.NEW, '', '', 2026, 6, 6],
  ['OAC-BPP-05', 'สมศักดิ์ ฝ่ายผลิต', '0889123456', 'ระบบทำความเย็น', P.N, 'แอร์ชั้น 2 Hall 1 เสียงดัง', S.CANCEL, '', 'ผู้แจ้งยกเลิก แจ้งซ้ำกับใบเดิม', 2026, 5, 12],
  ['CL-PRO-01', 'สมหญิง ทองดี', '0823456712', 'ระบบทำความเย็น', P.N, 'ตรวจสอบเสียง Chiller D.I.T 01', S.CANCEL, '', 'ตรวจแล้วเป็นปกติ ไม่ต้องซ่อม', 2026, 4, 25],
];

// ---- generate extra historical repairs so some machines fail more often ----
const POOL = {
  'ไฟฟ้า': [['ไฟไม่เข้า เบรกเกอร์ทริป', 'ตรวจพบไฟรั่วที่คอนแทคเตอร์ เปลี่ยนแมกเนติกใหม่'], ['มอเตอร์ร้อนผิดปกติ', 'เปลี่ยนแบริ่งมอเตอร์และทำความสะอาดพัดลมระบายความร้อน'], ['เซนเซอร์ไม่อ่านค่า', 'เปลี่ยน proximity sensor และเดินสายใหม่']],
  'เครื่องกล': [['สายพานหย่อน เครื่องสั่น', 'เปลี่ยนสายพานและปรับความตึง สมดุลใหม่'], ['ชุดเกียร์มีเสียงดัง', 'เปลี่ยนน้ำมันเกียร์และซีลกันรั่ว'], ['ลูกปืนชำรุด', 'เปลี่ยนตลับลูกปืนชุดหลักและอัดจารบี']],
  'ระบบลม': [['ลมรั่ว แรงดันตก', 'เปลี่ยนชุด solenoid valve และซ่อมข้อต่อลม'], ['กระบอกลมไม่ทำงาน', 'เปลี่ยนชุดซีลกระบอกลม']],
  'ระบบทำความเย็น': [['ทำความเย็นไม่ลง', 'เติมน้ำยาและล้างคอนเดนเซอร์'], ['คอมเพรสเซอร์ตัดบ่อย', 'ตรวจแรงดันและล้างระบบระบายความร้อน']],
  'หน้าจอควบคุม': [['หน้าจอค้าง/ดับ', 'รีเซ็ต PLC และเปลี่ยนสายแพหน้าจอ'], ['ค่าอุณหภูมิอ่านผิดเพี้ยน', 'เปลี่ยน thermocouple และสอบเทียบ controller']],
};
const RPT = ['ภัทรพร ประกอบกิจ', 'สมบูรณ์ ปานพิญใจ', 'สมหญิง ทองดี', 'อนุชา ใจกล้า', 'วิภาวี ศรีสุข'];
const PHONE = ['0945566604', '0812345671', '0823456712', '0845678123', '0834567123'];
const FREQ = [ // [equipmentId, จำนวนครั้งซ่อมเพิ่ม, หมวดปัญหาหลัก]
  ['BL-PRO-01', 6, 'เครื่องกล'], ['CL-PRO-02', 5, 'ระบบทำความเย็น'], ['PT-PRO-01', 5, 'ไฟฟ้า'],
  ['BL-PRO-09', 4, 'หน้าจอควบคุม'], ['MX-PRO-02', 4, 'เครื่องกล'], ['OAC-BPP-08', 3, 'ระบบทำความเย็น'],
  ['SL-PRO-02', 3, 'ไฟฟ้า'], ['TFM-MTD-01', 3, 'ไฟฟ้า'], ['BL-PRO-07', 2, 'ระบบลม'], ['RW-PRO-05', 2, 'เครื่องกล'],
];
let rk = 7;
const rnd = (n) => { rk = (rk * 1103515245 + 12345) & 0x7fffffff; return rk % n; }; // deterministic
for (const [eqId, n, ptype] of FREQ) {
  for (let i = 0; i < n; i++) {
    const pt = i % 3 === 2 ? Object.keys(POOL)[rnd(5)] : ptype; // ส่วนใหญ่เป็นปัญหาหลัก ปนปัญหาอื่นบ้าง
    const [detail, solution] = POOL[pt][rnd(POOL[pt].length)];
    const m = 1 + rnd(5), d = 2 + rnd(24);
    const pr = rnd(5) === 0 ? P.U : P.N;
    T.push([eqId, RPT[rnd(RPT.length)], PHONE[rnd(PHONE.length)], pt, pr, detail, S.DONE, TECHS[rnd(TECHS.length)], solution, 2026, m, d]);
  }
}

async function main() {
  const c = new pg.Client({
    host: process.env.PGHOST, port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE || 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  console.log('🔌 เชื่อมต่อสำเร็จ');

  // equipment (upsert)
  for (const e of equipment) {
    await c.query(
      `insert into equipment(id,sn,name,type,dept,location,building) values($1,$2,$3,$4,$5,$6,$7)
       on conflict(id) do update set sn=excluded.sn,name=excluded.name,type=excluded.type,dept=excluded.dept,location=excluded.location,building=excluded.building`,
      [e.id, e.sn, e.name, e.type, e.dept, e.location, e.building]
    );
  }
  console.log(`✅ equipment: ${equipment.length} รายการ`);

  // users (upsert)
  for (const u of users) {
    await c.query(
      `insert into app_users(username,name,role,email,pass) values($1,$2,$3,$4,$5)
       on conflict(username) do update set name=excluded.name,role=excluded.role,email=excluded.email`,
      [u.username, u.name, u.role, u.email, hash(u.pw)]
    );
  }
  console.log(`✅ app_users: ${users.length} บัญชี`);

  // clear & insert tickets
  await c.query('delete from tickets');
  const seqByMonth = {};
  let tCount = 0;
  for (const r of T) {
    const [eqId, reporter, phone, problemType, priority, detail, status, assignee, solution, y, m, d] = r;
    const eq = byId[eqId] || {};
    const key = `${String(y).slice(-2)}${String(m).padStart(2, '0')}`;
    seqByMonth[key] = (seqByMonth[key] || 0) + 1;
    const no = `MTD-${key}${String(seqByMonth[key]).padStart(4, '0')}`;
    const created = iso(y, m, d, 9, 30);
    // build history timeline
    const order = [S.NEW, S.DO, S.WAIT, S.DONE];
    const history = [{ at: created, status: S.NEW, note: 'สร้างใบแจ้งซ่อม' }];
    let updated = created, closed = null;
    if (status === S.CANCEL) {
      const at = iso(y, m, d + 1, 14, 0);
      history.push({ at, status: S.CANCEL, note: 'ยกเลิกรายการ' });
      updated = at; closed = at;
    } else {
      const idx = order.indexOf(status);
      for (let i = 1; i <= idx; i++) {
        const at = iso(y, m, d + i, 10 + i, 0);
        history.push({ at, status: order[i], note: `โดย ${assignee || TECHS[0]}` });
        updated = at;
        if (order[i] === S.DONE) closed = at;
      }
    }
    const createdBy = reporter === 'ภัทรพร ประกอบกิจ' ? 'phattara' : reporter === 'สมบูรณ์ ปานพิญใจ' ? 'user' : null;
    await c.query(
      `insert into tickets(id,no,reporter,phone,email,dept,equipment_id,equipment_name,location,problem_type,priority,detail,status,assignee,solution,history,created_at,updated_at,closed_at,created_by)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [genId('T', tCount), no, reporter, phone, '', eq.dept || '', eqId, eq.name || '', eq.location || '',
       problemType, priority, detail, status, assignee, solution, JSON.stringify(history), created, updated, closed, createdBy]
    );
    tCount++;
  }
  console.log(`✅ tickets: ${tCount} ใบ`);

  // PM records: [eqId, type, performedBy, detail, result, y,m,d, nextDue]
  const PM = [
    ['BL-PRO-01', 'ตรวจเช็คตามวาระ', 'เจษฎาภรณ์ กลับหมอ', 'ตรวจเช็คระบบหล่อลื่นและสายพานประจำเดือน', 'ปกติ', 2026, 5, 2, '2026-08-02'],
    ['BL-PRO-03', 'ทำความสะอาด', 'ปฐมพงษ์ อินจันทร์', 'ทำความสะอาดหัวดายและชุดทำความเย็น', 'ปกติ', 2026, 5, 5, '2026-08-05'],
    ['CL-PRO-01', 'ทำความสะอาด', 'เจษฎาภรณ์ กลับหมอ', 'ล้างคอนเดนเซอร์และตรวจน้ำยา', 'ปกติ', 2026, 5, 10, '2026-06-10'],
    ['CL-PRO-02', 'ตรวจเช็คตามวาระ', 'เจษฎาภรณ์ กลับหมอ', 'ตรวจแรงดันน้ำยาและกระแสคอมเพรสเซอร์', 'พบความผิดปกติ', 2026, 5, 11, '2026-06-08'],
    ['TFM-MTD-01', 'ตรวจเช็คตามวาระ', 'สาธิตพงษ์ สุขขี', 'วัดค่าฉนวนและอุณหภูมิหม้อแปลง', 'ปกติ', 2026, 4, 20, '2026-07-20'],
    ['TFM-MTD-02', 'ตรวจเช็คตามวาระ', 'สาธิตพงษ์ สุขขี', 'ตรวจ busbar และระบบระบายความร้อน', 'ปกติ', 2026, 4, 20, '2026-07-20'],
    ['MDB-MTD-01', 'ตรวจเช็คตามวาระ', 'สาธิตพงษ์ สุขขี', 'ตรวจขันแน่นจุดต่อและเทอร์โมสแกน', 'ต้องติดตาม', 2026, 5, 15, '2026-06-15'],
    ['AD-PRO-01', 'เปลี่ยนอะไหล่', 'ปฐมพงษ์ อินจันทร์', 'เปลี่ยนไส้กรองลมและสารดูดความชื้น', 'ปกติ', 2026, 4, 18, '2026-07-18'],
    ['PT-PRO-01', 'หล่อลื่น', 'สาธิตพงษ์ สุขขี', 'อัดจารบีตลับลูกปืนและตรวจลูกกลิ้ง', 'ปกติ', 2026, 5, 25, '2026-06-25'],
    ['MX-PRO-02', 'เปลี่ยนอะไหล่', 'เทิดศักดิ์ มณฑี', 'เปลี่ยนน้ำมันเกียร์และซีล', 'ปกติ', 2026, 3, 5, '2026-09-05'],
    ['OAC-BPP-08', 'ทำความสะอาด', 'จุฬีพงษ์ สันป่านาง้าว', 'ล้างแอร์และเปลี่ยนฟิลเตอร์', 'ปกติ', 2026, 5, 20, '2026-08-20'],
    ['OAC-BPP-02', 'ทำความสะอาด', 'จุฬีพงษ์ สันป่านาง้าว', 'ล้างแอร์ห้อง MD', 'แจ้งซ่อมต่อ', 2026, 5, 18, '2026-06-12'],
    ['SL-PRO-02', 'สอบเทียบ', 'สาธิตพงษ์ สุขขี', 'สอบเทียบเซนเซอร์ตัดและความเร็วม้วน', 'ปกติ', 2026, 5, 8, '2026-08-08'],
    ['BL-PRO-09', 'สอบเทียบ', 'เทิดศักดิ์ มณฑี', 'สอบเทียบ thermocouple หัวดาย', 'ปกติ', 2026, 5, 6, '2026-08-06'],
  ];
  await c.query('delete from pm');
  let pmCount = 0;
  for (const r of PM) {
    const [eqId, type, performedBy, detail, result, y, m, d, nextDue] = r;
    const eq = byId[eqId] || {};
    pmCount++;
    const no = 'PM-' + String(pmCount).padStart(5, '0');
    await c.query(
      `insert into pm(id,no,equipment_id,equipment_name,dept,type,date,performed_by,detail,result,next_due,created_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [genId('PM', pmCount), no, eqId, eq.name || '', eq.dept || '', type,
       `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`, performedBy, detail, result, nextDue, iso(y, m, d, 11, 0)]
    );
  }
  console.log(`✅ pm: ${pmCount} รายการ`);

  // counters
  for (const [k, v] of Object.entries(seqByMonth)) {
    await c.query(`insert into counters(key,val) values($1,$2) on conflict(key) do update set val=excluded.val`, [k, v]);
  }
  await c.query(`insert into counters(key,val) values('PM',$1) on conflict(key) do update set val=excluded.val`, [pmCount]);
  console.log('✅ counters อัปเดตแล้ว');

  await c.end();
  console.log('\n🎉 seed mock data ลง Supabase เสร็จสมบูรณ์');
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
