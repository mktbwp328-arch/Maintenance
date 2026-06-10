// Authentication & roles. Users live in Supabase (app_users) when configured,
// otherwise in data/users.json. Passwords hashed with scrypt (no deps).
// Sessions are in-memory tokens (fine for a single-process LAN tool).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

export const ROLES = { admin: 'ผู้ดูแลระบบ', technician: 'ช่างซ่อม', reporter: 'ผู้แจ้ง' };

// Stateless sessions via signed token (works on serverless / multiple instances).
const SECRET = process.env.SESSION_SECRET || 'mtd-dev-secret-change-me-in-production';
const SESSION_DAYS = 7;
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function unsignToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}

function hash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verify(password, stored) {
  const [salt, key] = stored.split(':');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derived, 'hex'));
}
const publicUser = (u) => ({ username: u.username, name: u.name, role: u.role, roleLabel: ROLES[u.role], email: u.email || '' });

const DEFAULTS = [
  { username: 'admin', name: 'ผู้ดูแลระบบ', role: 'admin', email: '', password: 'admin123' },
  { username: 'tech', name: 'ช่างเทคนิค', role: 'technician', email: '', password: 'tech123' },
  { username: 'user', name: 'พนักงานทั่วไป', role: 'reporter', email: '', password: 'user123' },
];

// ---------------- backend access ----------------
async function allUsers() {
  if (db.enabled) return db.q('select username,name,role,email,pass from app_users order by created_at');
  if (!fs.existsSync(USERS_FILE)) {
    const seed = DEFAULTS.map((d) => ({ username: d.username, name: d.name, role: d.role, email: d.email, pass: hash(d.password) }));
    fs.writeFileSync(USERS_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8').replace(/^﻿/, ''));
}
async function findUser(username) {
  if (db.enabled) {
    const rows = await db.q('select username,name,role,email,pass from app_users where username=$1 limit 1', [username]);
    return rows[0] || null;
  }
  return (await allUsers()).find((u) => u.username === username) || null;
}
async function insertUser(u) {
  if (db.enabled) return db.q('insert into app_users(username,name,role,email,pass) values($1,$2,$3,$4,$5)', [u.username, u.name, u.role, u.email, u.pass]);
  const users = await allUsers(); users.push(u);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Seed default accounts on first run
export async function seedUsers() {
  if (!db.enabled) { await allUsers(); return; } // touch file to seed JSON
  const existing = await db.q('select username from app_users limit 1');
  if (!existing.length) {
    for (const d of DEFAULTS) await insertUser({ username: d.username, name: d.name, role: d.role, email: d.email, pass: hash(d.password) });
    console.log('   ↳ seed บัญชีผู้ใช้เริ่มต้นลง Postgres แล้ว');
  }
}

// ---------------- public API ----------------
export async function login(username, password) {
  const u = await findUser(username);
  if (!u || !verify(password, u.pass)) return null;
  const token = signToken({ u: username, exp: Date.now() + SESSION_DAYS * 86400000 });
  return { token, user: publicUser(u) };
}
export function logout() { /* stateless — client just drops the token */ }

export async function userFromToken(token) {
  const p = unsignToken(token);
  if (!p) return null;
  const u = await findUser(p.u);
  return u ? publicUser(u) : null;
}

export async function listUsers() { return (await allUsers()).map(publicUser); }

export async function createUser({ username, name, role, email, password }) {
  if (await findUser(username)) throw new Error('มีชื่อผู้ใช้นี้แล้ว');
  if (!ROLES[role]) throw new Error('บทบาทไม่ถูกต้อง');
  if (!username || !password) throw new Error('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  const u = { username, name, role, email: email || '', pass: hash(password) };
  await insertUser(u);
  return publicUser(u);
}

export async function deleteUser(username) {
  const users = await allUsers();
  const target = users.find((u) => u.username === username);
  if (target?.role === 'admin' && users.filter((u) => u.role === 'admin').length <= 1)
    throw new Error('ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน');
  if (db.enabled) await db.q('delete from app_users where username=$1', [username]);
  else fs.writeFileSync(USERS_FILE, JSON.stringify(users.filter((u) => u.username !== username), null, 2));
}

export async function resetPassword(username, password) {
  if (!password) throw new Error('กรุณากรอกรหัสผ่าน');
  const u = await findUser(username);
  if (!u) throw new Error('ไม่พบผู้ใช้');
  const newPass = hash(password);
  if (db.enabled) await db.q('update app_users set pass=$2 where username=$1', [username, newPass]);
  else {
    const users = await allUsers();
    users.find((x) => x.username === username).pass = newPass;
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  }
}

// ---------------- Express middleware ----------------
export async function authRequired(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const user = await userFromToken(token);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  req.user = user;
  next();
}
export function roleRequired(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role))
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ดำเนินการ' });
    next();
  };
}
