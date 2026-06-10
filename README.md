# 🔧 ระบบแจ้งซ่อมออนไลน์ MTD

ระบบแจ้งซ่อม/บำรุงรักษาเครื่องจักรแบบอินเทอร์แอกทีฟ ทันสมัย ใช้งานง่าย
พร้อม **แจ้งเตือนอัตโนมัติทางอีเมลและ LINE** เมื่อมีการแจ้งซ่อมใหม่หรือเปลี่ยนสถานะงาน

อ้างอิงโครงสร้างข้อมูลและรายการเครื่องจักรจากระบบเดิม "ระบบแจ้งซ่อม BWP"
(เครื่องจักร ~60 รายการ: Blowing, Chiller, Printing, Slitter, Rewinding, Transformer,
Air Conditioner, MDB ฯลฯ ใน 2 แผนก: Blowing Production และ Printing Production)

## ✨ คุณสมบัติ
- **เข้าสู่ระบบ + สิทธิ์ผู้ใช้ (3 บทบาท)**
  - `ผู้ดูแลระบบ (admin)` — ใช้งานได้ทุกอย่าง + จัดการผู้ใช้
  - `ช่างซ่อม (technician)` — รับงาน เปลี่ยนสถานะ บันทึกวิธีแก้ไข และบันทึก PM
  - `ผู้แจ้ง (reporter)` — แจ้งซ่อมและติดตามสถานะ (แก้ไขงานไม่ได้)
- **แดชบอร์ด** — สรุปจำนวนงานตามสถานะ, กราฟวงกลม, กราฟตามประเภทเครื่องจักร, แจ้งเตือนงาน PM ใกล้ครบกำหนด/เกินกำหนด
- **แจ้งซ่อม** — ฟอร์มเลือกเครื่องจักร (จัดกลุ่มอัตโนมัติ), ระดับความเร่งด่วน, หมวดปัญหา
- **ติดตามงาน** — ค้นหา/กรองตามสถานะ, ดูไทม์ไลน์ประวัติ, บันทึกผู้ดำเนินการและวิธีแก้ไข, เปลี่ยนสถานะ
- **ประวัติ PM (บำรุงรักษาเชิงป้องกัน)** — บันทึกการ PM ต่อเครื่องจักร, ประเภทงาน, ผลการตรวจ, กำหนด PM ครั้งถัดไป + เตือนเมื่อใกล้/เกินกำหนด
- **ทะเบียนเครื่องจักร** — ค้นหาเครื่องจักรทั้งหมด
- **เลขที่อัตโนมัติ** ใบแจ้งซ่อม `MTD-YYMM####`, ใบ PM `PM-#####`
- **แจ้งเตือน** ทางอีเมล (SMTP) และ LINE (Messaging API) — ทำงานได้แม้ยังไม่ตั้งค่า (จะข้ามช่องที่ไม่ได้ตั้งค่า)

## 👤 บัญชีเริ่มต้น (เปลี่ยนรหัสผ่านหลังติดตั้ง)
| ชื่อผู้ใช้ | รหัสผ่าน | บทบาท |
|---|---|---|
| `admin` | `admin123` | ผู้ดูแลระบบ |
| `tech` | `tech123` | ช่างซ่อม |
| `user` | `user123` | ผู้แจ้ง |

> บัญชีถูกสร้างอัตโนมัติครั้งแรกที่รัน เก็บใน `data/users.json` (รหัสผ่านเข้ารหัสด้วย scrypt)

## 🚀 วิธีติดตั้งและรัน
```bash
npm install
copy .env.example .env   # แล้วแก้ไขค่า SMTP / LINE (ไม่บังคับ)
npm start
```
เปิดเบราว์เซอร์ที่ http://localhost:3000

> รันได้ทันทีโดยไม่ต้องตั้งค่าแจ้งเตือน — ระบบจะทำงานเต็มรูปแบบ เพียงแต่ยังไม่ส่งอีเมล/LINE จนกว่าจะกรอก `.env`

## 🗄️ ใช้ฐานข้อมูล Supabase (ไม่บังคับ)
ค่าเริ่มต้นระบบเก็บข้อมูลเป็นไฟล์ JSON ในเครื่อง ถ้าต้องการใช้ Supabase Postgres:

1. เปิด **Supabase Dashboard → SQL Editor → New query** วางเนื้อหาไฟล์ [supabase_schema.sql](supabase_schema.sql) แล้วกด **Run**
   (สร้างตาราง `equipment`, `tickets`, `pm`, `app_users`, ฟังก์ชันออกเลขที่ และเปิด RLS แบบล็อกให้เฉพาะ server เข้าถึง)
   *หรือรันผ่านสคริปต์:* `node scripts/run-schema.js "<connection string>"`
2. กดปุ่ม **Connect** (แถบบน) → เลือก **Session Pooler** (เครือข่าย IPv4) → คัดลอก URI
3. ใส่ใน `.env` (URL-encode รหัสผ่าน เช่น `@` → `%40`):
   ```
   DATABASE_URL=postgresql://postgres.xxxx:PASSWORD@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```
4. `npm start` — ระบบจะ seed เครื่องจักรและบัญชีผู้ใช้ให้อัตโนมัติครั้งแรก
   ตอนบูตจะขึ้นว่า `ฐานข้อมูล: Supabase Postgres ✅`

> **ใส่ข้อมูลตัวอย่าง (mock):** ตั้ง `DATABASE_URL`/PG* env แล้วรัน `node scripts/seed-mock.js` — เพิ่มใบแจ้งซ่อม/PM หลายสถานะ
>
> **ความปลอดภัย:** connection string อยู่ใน `.env` ซึ่ง `.gitignore` แล้ว ไม่หลุดไปหน้าเว็บ; RLS เปิดล็อกให้ `anon key` (public) เข้าข้อมูลไม่ได้
> หากไม่ตั้งค่า ระบบจะกลับไปใช้ไฟล์ JSON อัตโนมัติ — โค้ดชุดเดียวรองรับทั้งสองแบบ

## 📱 แจ้งซ่อมผ่านไลน์ (LIFF)
ให้พนักงานเปิดฟอร์มแจ้งซ่อม **ในแอป LINE** ได้เลย (ผ่าน LIFF)

**ต้องมี public HTTPS URL** (LIFF ไม่รองรับ localhost) — ทดสอบใช้ `ngrok http 3000` หรือ deploy ขึ้นคลาวด์

**ขั้นตอน:**
1. ไป [LINE Developers Console](https://developers.line.biz/console/) → สร้าง **Messaging API channel**
2. แท็บ **LIFF** → Add → ตั้งค่า:
   - **Endpoint URL:** `https://<โดเมนของคุณ>/liff.html`
   - **Size:** Full · **Scopes:** `profile`, `openid`
3. คัดลอก **LIFF ID** และ **Channel ID** มาใส่ใน `.env`:
   ```
   LIFF_ID=1234567890-abcdEFGH
   LIFF_CHANNEL_ID=2001234567
   ```
4. (แนะนำ) สร้าง **Rich Menu** ในแชต Official Account ให้กดเปิด LIFF URL: `https://liff.line.me/<LIFF_ID>`
5. `npm start` → เปิด LINE กด Rich Menu → ฟอร์มแจ้งซ่อมเด้งขึ้นในไลน์ กรอกแล้วส่ง → เข้าระบบทันที

> ระบบยืนยันตัวตนผู้แจ้งด้วย **LINE ID token** (ตรวจสอบกับ LINE ฝั่ง server) — เฉพาะผู้ใช้ LINE จริงเท่านั้นที่ส่งได้
> ใบที่แจ้งผ่านไลน์จะมีชื่อผู้แจ้งเป็นชื่อ LINE และส่งแจ้งเตือนเข้าอีเมล/กลุ่มไลน์ตามปกติ

## 🔔 ตั้งค่าการแจ้งเตือน
ดูรายละเอียดในไฟล์ [.env.example](.env.example)
- **อีเมล**: ใช้ SMTP ใดก็ได้ (Gmail ต้องใช้ App Password)
- **LINE**: สร้าง Channel แบบ Messaging API ที่ developers.line.biz แล้วใส่ Channel access token และปลายทาง (`LINE_TO`)

## 🗂️ โครงสร้าง
```
server.js            Express API + เสิร์ฟไฟล์ static
lib/store.js         จัดเก็บข้อมูล (Supabase หรือ JSON อัตโนมัติ)
lib/supabase.js      ตัวเชื่อม Supabase REST (service_role)
lib/auth.js          ระบบ login + สิทธิ์ผู้ใช้
lib/notify.js        ส่งแจ้งเตือนอีเมล + LINE
supabase_schema.sql  SQL สร้างตาราง (รันใน Supabase ครั้งเดียว)
data/equipment.json  ทะเบียนเครื่องจักร (แหล่งข้อมูลอ้างอิง)
data/db.json         ข้อมูลใบแจ้งซ่อม/PM (โหมด JSON, สร้างอัตโนมัติ)
public/              หน้าเว็บ (HTML/CSS/JS + Chart.js)
```

## 🔌 API ย่อ
| Method | Endpoint | คำอธิบาย |
|---|---|---|
| POST | `/api/login` | เข้าสู่ระบบ → คืน token (ส่งเป็น `Authorization: Bearer <token>`) |
| GET | `/api/me` | ข้อมูลผู้ใช้ปัจจุบัน |
| GET | `/api/meta` | สถานะ, ความเร่งด่วน, ประเภท PM, บทบาท, รายการเครื่องจักร, ช่องแจ้งเตือน |
| GET | `/api/stats` | สรุปสถิติแดชบอร์ด + งาน PM ใกล้ครบกำหนด |
| GET | `/api/tickets?q=&status=` | รายการใบแจ้งซ่อม |
| POST | `/api/tickets` | สร้างใบแจ้งซ่อม (ส่งแจ้งเตือน) |
| PATCH | `/api/tickets/:id` | อัปเดต/เปลี่ยนสถานะ — *admin/ช่างเท่านั้น* (ส่งแจ้งเตือน) |
| GET/POST/DELETE | `/api/pm` | ประวัติ PM (POST/DELETE: admin/ช่างเท่านั้น) |
| GET/POST/DELETE | `/api/users` | จัดการผู้ใช้ — *admin เท่านั้น* |

> ทุก endpoint (ยกเว้น `/api/login` และ `/api/meta`) ต้องส่ง token
