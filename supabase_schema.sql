-- ============================================================
-- ระบบแจ้งซ่อม MTD — Supabase schema
-- รันสคริปต์นี้ครั้งเดียวใน Supabase Dashboard → SQL Editor → New query → Run
-- หลังรันเสร็จ ใส่ค่า SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน .env แล้ว npm start
-- ระบบจะ seed รายการเครื่องจักรและบัญชีผู้ใช้เริ่มต้นให้อัตโนมัติเมื่อรันครั้งแรก
-- ============================================================

-- ---------- ตารางเครื่องจักร ----------
create table if not exists public.equipment (
  id        text primary key,
  sn        text,
  name      text,
  type      text,
  dept      text,
  location  text,
  building  text
);

-- ---------- ตารางทะเบียนอาคาร ----------
create table if not exists public.buildings (
  name       text primary key,
  note       text default '',
  created_at timestamptz default now()
);

-- ---------- ตารางใบแจ้งซ่อม ----------
create table if not exists public.tickets (
  id             text primary key,
  no             text unique not null,
  reporter       text,
  phone          text,
  email          text,
  dept           text,
  req_dept       text,
  equipment_id   text,
  equipment_name text,
  location       text,
  problem_type   text,
  priority       text default 'ปกติ',
  detail         text,
  status         text default 'แจ้งซ่อม',
  assignee       text default '',
  solution       text default '',
  history        jsonb default '[]'::jsonb,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  closed_at      timestamptz,
  created_by     text
);
alter table public.tickets add column if not exists req_dept text;
create index if not exists tickets_status_idx on public.tickets(status);
create index if not exists tickets_created_idx on public.tickets(created_at desc);

-- ---------- ตารางประวัติ PM ----------
create table if not exists public.pm (
  id             text primary key,
  no             text not null,
  equipment_id   text,
  equipment_name text,
  dept           text,
  type           text,
  date           date,
  performed_by   text,
  detail         text,
  result         text default 'ปกติ',
  next_due       date,
  created_at     timestamptz default now()
);
create index if not exists pm_nextdue_idx on public.pm(next_due);

-- ---------- ตารางผู้ใช้งาน (รหัสผ่านเข้ารหัส scrypt ฝั่งแอป) ----------
create table if not exists public.app_users (
  username   text primary key,
  name       text,
  role       text,
  email      text default '',
  pass       text not null,
  created_at timestamptz default now()
);

-- ---------- คลังความรู้ ปัญหา & สาเหตุ ----------
create table if not exists public.problem_kb (
  id         text primary key,
  category   text,
  problem    text,
  cause      text,
  solution   text,
  created_at timestamptz default now()
);

-- ---------- การตั้งค่าทั่วไป (เช่น groupId ของไลน์) ----------
create table if not exists public.settings (
  key   text primary key,
  value text
);

-- ---------- ตัวนับสำหรับออกเลขที่เอกสารแบบอะตอมมิก ----------
create table if not exists public.counters (
  key text primary key,
  val bigint not null default 0
);

create or replace function public.next_seq(p_key text)
returns bigint language plpgsql as $$
declare v bigint;
begin
  insert into public.counters(key, val) values (p_key, 1)
  on conflict (key) do update set val = public.counters.val + 1
  returning val into v;
  return v;
end $$;

-- ============================================================
-- Row Level Security:
-- เปิด RLS โดยไม่สร้าง policy ใด ๆ → role 'anon'/'authenticated' เข้าไม่ได้เลย
-- มีเพียง service_role (ฝั่ง server) เท่านั้นที่เข้าถึงได้ (bypass RLS โดยปริยาย)
-- ปลอดภัยแม้ anon key จะเป็น public
-- ============================================================
alter table public.equipment enable row level security;
alter table public.buildings enable row level security;
alter table public.problem_kb enable row level security;
alter table public.tickets   enable row level security;
alter table public.pm        enable row level security;
alter table public.app_users enable row level security;
alter table public.counters  enable row level security;
