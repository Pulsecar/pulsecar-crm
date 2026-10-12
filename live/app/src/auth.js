'use strict';
// Доступ к панели:
//  1) из CRM — одноразовая ссылка входа (embed session), CRM получает её по API-ключу;
//  2) напрямую — пароль ADMIN_PASSWORD (запасной вход).
// API для бэкенда CRM — заголовок Authorization: Bearer CRM_API_KEY.
const crypto = require('crypto');
const cfg = require('./config');

const NAME = 'pl_live';
const TTL = 12 * 3600;            // сессия панели — 12 часов
const EMBED_TTL = 120 * 1000;     // одноразовая ссылка входа — 2 минуты

const hmac = (s) => crypto.createHmac('sha256', cfg.SESSION_SECRET).update(s).digest('base64url');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function cookieAttrs(maxAge) {
  return `Path=/; HttpOnly; SameSite=${cfg.COOKIE_SAMESITE}; Max-Age=${maxAge}${cfg.SECURE ? '; Secure' : ''}`;
}
function makeCookie(user) {
  const payload = Buffer.from(JSON.stringify({ n: String(user.name || 'admin').slice(0, 60), id: String(user.id || '').slice(0, 60), exp: Math.floor(Date.now() / 1000) + TTL })).toString('base64url');
  return `${NAME}=${payload}.${hmac(payload)}; ${cookieAttrs(TTL)}`;
}
const clearCookie = () => `${NAME}=; ${cookieAttrs(0)}`;

function session(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${NAME}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(hmac(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return s.exp > Date.now() / 1000 ? { name: s.n, id: s.id, via: 'session' } : null;
  } catch { return null; }
}

function apiKey(req) {
  if (!cfg.CRM_API_KEY) return null;
  const m = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return m && same(m[1].trim(), cfg.CRM_API_KEY) ? { name: 'CRM', id: 'crm', via: 'apikey' } : null;
}

// Кто делает запрос: пользователь панели, бэкенд CRM или никто.
function who(req) { return apiKey(req) || session(req); }

const checkPassword = (p) => !!cfg.ADMIN_PASSWORD && same(p, cfg.ADMIN_PASSWORD);

// --- одноразовые ссылки входа для встраивания в CRM ---
const embeds = new Map();
function createEmbed(user, next) {
  const t = crypto.randomBytes(24).toString('base64url');
  embeds.set(t, { user, next, exp: Date.now() + EMBED_TTL });
  return t;
}
function useEmbed(t) {
  const e = embeds.get(t);
  embeds.delete(t);
  return e && e.exp > Date.now() ? e : null;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of embeds) if (v.exp < now) embeds.delete(k); }, 60e3).unref();

// --- защита от подбора пароля: 8 попыток за 15 минут с IP ---
const tries = new Map();
function allowAttempt(ip) {
  const now = Date.now(), t = tries.get(ip) || { n: 0, since: now };
  if (now - t.since > 15 * 60e3) { t.n = 0; t.since = now; }
  t.n++; tries.set(ip, t);
  return t.n <= 8;
}

module.exports = { makeCookie, clearCookie, session, apiKey, who, checkPassword, createEmbed, useEmbed, allowAttempt };
