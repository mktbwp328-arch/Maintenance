// Creates the problem_kb (knowledge base) table and seeds common problems/causes/solutions.
import pg from 'pg';
const conn = process.env.DATABASE_URL;
const client = new pg.Client(conn
  ? { connectionString: conn, ssl: { rejectUnauthorized: false } }
  : { host: process.env.PGHOST, port: Number(process.env.PGPORT) || 5432, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE || 'postgres', ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(`create table if not exists public.problem_kb (
  id text primary key, category text, problem text, cause text, solution text, created_at timestamptz default now()
)`);
await client.query('alter table public.problem_kb enable row level security');

const seed = [
  ['ไฟฟ้า', 'ไฟไม่เข้า เบรกเกอร์ทริป', 'ไฟฟ้าลัดวงจร หรือโหลดเกินพิกัด', 'ตรวจหาจุดลัดวงจร เปลี่ยนแมกเนติกคอนแทคเตอร์/เบรกเกอร์ และตรวจกระแสโหลด'],
  ['ไฟฟ้า', 'มอเตอร์ร้อนผิดปกติ', 'ลูกปืนสึก พัดลมระบายตัน หรือโหลดเกิน', 'เปลี่ยนแบริ่งมอเตอร์ ทำความสะอาดพัดลมระบายความร้อน วัดกระแส'],
  ['ไฟฟ้า', 'เซนเซอร์ไม่อ่านค่า', 'เซนเซอร์เสีย สายขาด หรือระยะตรวจจับผิด', 'เปลี่ยน proximity sensor เดินสายใหม่ และตั้งระยะตรวจจับ'],
  ['เครื่องกล', 'สายพานหย่อน/ขาด เครื่องสั่น', 'สายพานเสื่อมสภาพ หรือความตึงไม่เหมาะสม', 'เปลี่ยนสายพานและปรับความตึง สมดุลใหม่'],
  ['เครื่องกล', 'ชุดเกียร์มีเสียงดัง', 'น้ำมันเกียร์เสื่อม หรือซีลรั่ว', 'เปลี่ยนน้ำมันเกียร์และซีลกันรั่ว ตรวจระดับน้ำมัน'],
  ['เครื่องกล', 'ลูกปืนชำรุด', 'ขาดการหล่อลื่น หรือใช้งานนาน', 'เปลี่ยนตลับลูกปืนชุดหลักและอัดจารบีตามวาระ'],
  ['ระบบลม', 'ลมรั่ว แรงดันตก', 'ชุดวาล์วหรือข้อต่อลมรั่ว', 'เปลี่ยนชุด solenoid valve และซ่อม/เปลี่ยนข้อต่อลม'],
  ['ระบบลม', 'กระบอกลมไม่ทำงาน', 'ซีลกระบอกลมรั่ว หรือลมไม่พอ', 'เปลี่ยนชุดซีลกระบอกลม ตรวจแรงดันลมต้นทาง'],
  ['ระบบทำความเย็น', 'ทำความเย็นไม่ลง', 'น้ำยาน้อย หรือคอนเดนเซอร์สกปรก', 'เติมน้ำยาและล้างคอนเดนเซอร์ ตรวจการรั่ว'],
  ['ระบบทำความเย็น', 'คอมเพรสเซอร์ตัดบ่อย', 'แรงดันสูง หรือระบายความร้อนไม่ดี', 'ตรวจแรงดันและล้างระบบระบายความร้อน'],
  ['หน้าจอควบคุม', 'หน้าจอค้าง/ดับ', 'สายแพหลวม หรือ PLC ค้าง', 'รีเซ็ต PLC และเปลี่ยนสายแพหน้าจอ'],
  ['หน้าจอควบคุม', 'ค่าอุณหภูมิอ่านผิดเพี้ยน', 'thermocouple เสื่อมสภาพ', 'เปลี่ยน thermocouple และสอบเทียบ controller'],
  ['งานอาคาร', 'ไฟส่องสว่างดับ', 'หลอดไฟหรือบัลลาสต์เสีย', 'เปลี่ยนหลอดไฟ/บัลลาสต์ ตรวจสายและสวิตช์'],
  ['งานอาคาร', 'ประปารั่ว/ท่อตัน', 'ท่อชำรุด ข้อต่อรั่ว หรืออุดตัน', 'ซ่อม/เปลี่ยนท่อและข้อต่อ ลอกท่อที่อุดตัน'],
];
let n = 0;
for (const [category, problem, cause, solution] of seed) {
  n++;
  await client.query(
    'insert into problem_kb(id,category,problem,cause,solution) values($1,$2,$3,$4,$5) on conflict(id) do nothing',
    ['KB' + String(n).padStart(4, '0'), category, problem, cause, solution]
  );
}
console.log(`✅ problem_kb พร้อมใช้งาน — seed ${n} รายการ`);
await client.end();
