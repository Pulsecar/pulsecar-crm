import crypto from 'node:crypto';
import { one } from './db.js';
import { config } from './config.js';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomHex = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `${salt}:${h}`;
}
export function checkPassword(pw, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const test = crypto.scryptSync(pw, salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(h, 'hex'));
}

export function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

/** Нормализация телефона → +48XXXXXXXXX. Возвращает null, если номер непохож на телефон. */
export function normPhone(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;
  const plus = s.startsWith('+') || s.startsWith('00');
  let d = s.replace(/\D/g, '');
  if (s.startsWith('00')) d = d.slice(2);
  if (!plus && d.length === 9) d = '48' + d; // польский номер без кода страны
  if (d.length < 10 || d.length > 15) return null;
  return '+' + d;
}

export const normPlate = (s) => (s ? String(s).toUpperCase().replace(/[^A-Z0-9]/g, '') : '');
export const normVin = (s) => {
  const v = s ? String(s).toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  return v.length === 17 ? v : '';
};

/** Уникальный номер карты лояльности: PC + 8 цифр */
export function newCardNo() {
  for (;;) {
    const n = 'PC' + String(crypto.randomInt(10_000_000, 99_999_999));
    if (!one('SELECT 1 FROM customers WHERE card_no = ?', n)) return n;
  }
}

/** Разбор числа в польском/европейском формате: "1 234,50 zł" → 1234.5 */
export function parseNum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[\s ]/g, '').replace(/zł|pln|zl|kw|km|cm3|cm³|ccm/gi, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Даты: Date, 2026-09-27, 27.09.2026, 27/09/2026, excel-число → YYYY-MM-DD */
export function parseDate(v) {
  if (!v && v !== 0) return null;
  const pad = (n) => String(n).padStart(2, '0');
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}

// ── Подписанные cookie для панели сотрудников ────────────────────────────────
const b64u = (s) => Buffer.from(s).toString('base64url');
export function signSession(obj) {
  const body = b64u(JSON.stringify(obj));
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function readSession(token) {
  if (!token) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  if (!safeEqual(sig, expect)) return null;
  try {
    const obj = JSON.parse(Buffer.from(body, 'base64url').toString());
    return obj.exp > Date.now() ? obj : null;
  } catch {
    return null;
  }
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ── Нумерация документов: ZL 12/09/2026 (счётчик по месяцам) ──────────────────
import { db as _db } from './db.js';
export function nextNumber(prefix, date = new Date(), perYear = false) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const key = perYear ? `${prefix}-${y}` : `${prefix}-${y}-${m}`;
  _db.prepare('INSERT INTO counters (key, n) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET n = n + 1').run(key);
  const n = _db.prepare('SELECT n FROM counters WHERE key = ?').get(key).n;
  return perYear ? `${prefix} ${n}/${y}` : `${prefix} ${n}/${m}/${y}`;
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const today = () => new Date().toISOString().slice(0, 10);
