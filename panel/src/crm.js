// API панели panel.pulsecar.tech (CRM для сотрудников)
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import multer from 'multer';
import { all, one, run, tx, insert, update, log, getSetting, setSetting, mainDb, withDb, curDb as curDbRef } from './db.js';
import { MAIN, listBranches, branchDb, allDbs, curBranch, createBranch, updateBranch, ownerIn, branchName, branchSettings, saveBranchSettings } from './branches.js';
import { config } from './config.js';
import {
  HttpError, currentNumber, checkPassword, hashPassword, normPhone, normPlate, normVin, newCardNo, nextNumber, parseCookies, readSession,
  signSession, round2, today,
} from './util.js';
import {
  checkout, issueTicket, loyaltySummary, quote, verifyManual, verifyQrPayload, redeemLimits, redeemForOrder,
} from './loyalty.js';
import { importRows, readRows, TEMPLATE_CSV } from './importer.js';
import { addItem, copyOrder, createOrder, getOrder, orderFull, quoteToExistingOrder, quoteToOrder, recalc, setStatus, updateItem } from './orders.js';
import { invoicesEnabled, invoicePdf, issueInvoice, testFakturownia } from './invoices.js';
import { createStockDoc, findOrCreateProduct } from './stock.js';
import { publicList, save as saveIntegration, cfg, setState, def as integrationDef } from './integrations/index.js';
import * as IC from './integrations/intercars.js';
import * as RMI from './integrations/tecrmi.js';
import * as DASH from './dashboard.js';
import * as SEXP from './sales-export.js';
import * as SUP from './integrations/suppliers.js';
import { polishNames, glossaryPl, hasCyr } from './pl-names.js';
import { notify, testTelegram } from './integrations/notify.js';
import { balances, setManual } from './balances.js';
import { sendMail, testEmail, testTpay, createPayLink, checkPayment, decodeVin, ensureFeedToken } from './integrations/services.js';
import { can, permsOf, PERM_GROUPS, PRESETS } from './perms.js';
import { SETTINGS_SCHEMA, SETTINGS_KEYS } from './settings-schema.js';
import * as FIN from './finance.js';
import * as DOC from './documents.js';
import * as RPT from './reports.js';
import { setActor, listAudit, entityList } from './audit.js';
import * as FISCAL from './fiscal.js';
import * as KSEF from './integrations/ksef.js';
import { lookupNip } from './integrations/nip.js';
import path from 'node:path';
import { sendSms, testSms, testSerwersms, testSmsplanet, testTwilio, testSmsgate, testSmshttp, activeProvider, smsParts, translit } from './sms.js';
import { FIELDS as TPL_FIELDS, render, orderContext, cardUrl, textToHtml } from './messaging.js';
import { decodeAztec, lookupPlate, testPlate } from './vehicle.js';
import * as REC from './recommendations.js';
/** Способы оплаты (платёж): наличные, карта, BLIK, перевод. «mixed» — только как способ в документах/настройках */
const PAY_METHODS = ['cash', 'card', 'blik', 'transfer'];

export const crm = express.Router();
crm.use(express.json({ limit: '1mb' }));

// ── Сервис (филиал): запрос работает с базой того сервиса, куда вошёл сотрудник ──
const sessOf = (req) => (req._sess !== undefined ? req._sess : (req._sess = readSession(parseCookies(req.headers.cookie).pcs)));
crm.use((req, _res, next) => {
  const bearer = /^Bearer (pcx_[A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization || '')?.[1];
  if (bearer) {
    const h = sha(bearer);
    const d = allDbs().find((x) => x.prepare('SELECT 1 FROM staff WHERE ext_token = ? AND active = 1').get(h));
    return withDb(d || mainDb, next);
  }
  const sess = sessOf(req);
  if (sess?.b && sess.b !== MAIN) {
    const d = branchDb(sess.b);
    if (!d) { req._sess = null; return withDb(mainDb, next); } // сервис отключён — нужно войти заново
    return withDb(d, next);
  }
  withDb(mainDb, next);
});
const cookieOpts = () => `HttpOnly; Path=/; SameSite=Lax; Max-Age=${14 * 86400}${config.publicUrl.startsWith('https') ? '; Secure' : ''}${process.env.COOKIE_DOMAIN ? '; Domain=' + process.env.COOKIE_DOMAIN : ''}`;
const setSess = (res, obj) => res.setHeader('Set-Cookie', `pcs=${signSession({ ...obj, exp: Date.now() + 14 * 86400_000 })}; ${cookieOpts()}`);
/** Владелец: администратор главного сервиса (в филиале — вошедший через переключатель) */
function ownerOf(req) {
  const sess = sessOf(req);
  if (!sess) return null;
  const mid = sess.o || ((!sess.b || sess.b === MAIN) ? sess.id : null);
  return mid ? mainDb.prepare(`SELECT * FROM staff WHERE id = ? AND role = 'admin' AND active = 1`).get(mid) || null : null;
}
function owner(req) {
  who(req);
  const o = ownerOf(req);
  if (!o) throw new HttpError(403, 'Только для владельца (администратор главного сервиса).');
  return o;
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// первый администратор
if (!one('SELECT 1 FROM staff WHERE pass_hash IS NOT NULL') && config.adminPassword) {
  run(`INSERT INTO staff (login, name, pass_hash, role) VALUES (?, 'Администратор', ?, 'admin')`, config.adminLogin, hashPassword(config.adminPassword));
  console.log(`Создан администратор панели: ${config.adminLogin}`);
}

// ── Авторизация ────────────────────────────────────────────────────────────
const loginHits = new Map();
crm.post('/login', (req, res) => {
  const n = (loginHits.get(req.ip) || []).filter((t) => t > Date.now() - 15 * 60_000);
  if (n.length >= 10) throw new HttpError(429, 'Слишком много попыток входа. Подождите 15 минут.');
  // логин ищем в главном сервисе, потом в филиалах (у каждого сервиса свои сотрудники)
  const login = String(req.body?.login || '').trim(), pass = String(req.body?.password || '');
  let s = null, code = MAIN;
  for (const b of listBranches()) {
    const d = branchDb(b.code);
    const r = d && d.prepare('SELECT * FROM staff WHERE login = ? AND active = 1 AND pass_hash IS NOT NULL').get(login);
    if (r && checkPassword(pass, r.pass_hash)) { s = r; code = b.code; break; }
  }
  if (!s) {
    n.push(Date.now()); loginHits.set(req.ip, n);
    throw new HttpError(401, 'Неверный логин или пароль.');
  }
  setSess(res, { id: s.id, b: code });
  withDb(branchDb(code), () => run("UPDATE staff SET last_login = datetime('now') WHERE id = ?", s.id));
  res.json({ ok: true });
});
crm.post('/logout', (_req, res) => { res.setHeader('Set-Cookie', `pcs=; Path=/; Max-Age=0${process.env.COOKIE_DOMAIN ? '; Domain=' + process.env.COOKIE_DOMAIN : ''}`); res.json({ ok: true }); });

// Общий вход для панели бота (marketing.pulsecar.tech): прокси спрашивает здесь, вошёл ли сотрудник
crm.get('/auth-check', (req, res) => {
  const sess = readSession(parseCookies(req.headers.cookie).pcs);
  const s = sess && one('SELECT role, permissions FROM staff WHERE id = ? AND active = 1', sess.id);
  if (!s || !can(s, 'marketing.view')) {
    // браузер без входа → на страницу входа CRM
    if (req.query.redirect) return res.redirect(302, `${config.publicUrl}/#/marketing`);
    return res.status(401).send('login required');
  }
  res.setHeader('X-Pulsecar-User', String(sess.id));
  res.status(200).send('ok');
});

const RANK = { mechanic: 1, staff: 2, admin: 3 };
const PERM_LABELS = Object.fromEntries(PERM_GROUPS.flatMap(([, l]) => l));
const permLabel = (k) => `«${PERM_LABELS[k] || k}»`;
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function who(req, min = 'mechanic') {
  const bearer = /^Bearer (pcx_[A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization || '')?.[1];
  const sess = bearer ? null : sessOf(req);
  if (sess?.o && !mainDb.prepare(`SELECT 1 FROM staff WHERE id = ? AND role = 'admin' AND active = 1`).get(sess.o)) throw new HttpError(401, 'Войдите в панель.');
  const s = bearer ? one('SELECT * FROM staff WHERE ext_token = ? AND active = 1', sha(bearer)) : sess && one('SELECT * FROM staff WHERE id = ? AND active = 1', sess.id);
  if (!s) throw new HttpError(401, 'Войдите в панель.');
  if (min.includes('.')) { if (!can(s, min)) throw new HttpError(403, 'Недостаточно прав: ' + permLabel(min)); }
  else if ((RANK[s.role] || 0) < RANK[min]) throw new HttpError(403, 'Недостаточно прав.');
  setActor(s, bearer ? 'extension' : 'crm');
  return s;
}

const lists = () => ({
  statuses: all('SELECT * FROM order_statuses ORDER BY pos'),
  expenses: all('SELECT * FROM expense_categories ORDER BY pos, name'),
  price_groups: all('SELECT * FROM price_groups ORDER BY pos, name'),
  checklists: all('SELECT * FROM checklists ORDER BY pos, name').map((c) => ({ ...c, items: JSON.parse(c.items || '[]') })),
  templates: all('SELECT * FROM order_templates ORDER BY pos, name').map((t) => ({ ...t, items: JSON.parse(t.items || '[]') })),
  types: all('SELECT * FROM order_types ORDER BY pos'),
  stations: all('SELECT * FROM stations WHERE active = 1 ORDER BY pos'),
  staff: all('SELECT id, name, role, color, is_mechanic, active, hourly_rate, commission_pct FROM staff ORDER BY name'),
});

crm.get('/me', (req, res) => {
  const s = who(req);
  res.json({
    user: { id: s.id, name: s.name, role: s.role, login: s.login, phone: s.phone, email: s.email, last_login: s.last_login },
    perms: permsOf(s),
    ui: uiOf(s),
    branch: { code: curBranch(), name: branchName(curBranch()) },
    owner: !!ownerOf(req),
    branches: ownerOf(req) ? listBranches().map(({ code, name }) => ({ code, name })) : [],
    ...lists(),
    settings: Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value])),
    loyalty: loyaltySummary(0).rules,
    features: {
      invoices: invoicesEnabled(), ksef: KSEF.ksefEnabled(), fiscal: (() => { const c = FISCAL.fiscalCfg(); return c ? { driver: c.driver, url: c.url, autoOnPay: c.autoOnPay } : null; })(), marketingUrl: cfg('marketing')?.url || config.marketingUrl, autoEarnFromCrm: config.loyalty.autoEarnFromCrm,
      intercars: !!cfg('intercars'), tecrmi: RMI.tecrmiOn() ? { auto: cfg('tecrmi').auto !== false } : null, tpay: !!cfg('tpay'), email: !!cfg('email'), sms: !!activeProvider(), smsProvider: activeProvider(), plate: !!cfg('plate'),
    },
  });
});

/** Скрытые элементы интерфейса сотрудника (Сотрудники → Интерфейс) */
function uiOf(s) {
  const r = one('SELECT ui FROM staff WHERE id = ?', s.id);
  try { const v = JSON.parse(r?.ui || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}

// ── Сервисы (филиалы) и общий дашборд владельца ───────────────────────────
crm.get('/branches', (req, res) => {
  owner(req);
  res.json({ current: curBranch(), rows: listBranches({ withInactive: true }) });
});
crm.post('/branches', (req, res) => {
  const o = owner(req);
  const r = createBranch(req.body || {}, o);
  res.json({ ok: true, ...r });
});
crm.put('/branches/:code', (req, res) => {
  owner(req);
  if (req.params.code === MAIN && req.body?.active === false) throw new HttpError(400, 'Главный сервис отключить нельзя');
  updateBranch(req.params.code, req.body || {});
  res.json({ ok: true });
});
/** Данные сервиса (адрес, телефон, часы, счёт, реквизиты) — владелец меняет любой сервис без переключения */
crm.get('/branches/:code/settings', (req, res) => {
  owner(req);
  const { db: _d, ...r } = branchSettings(req.params.code);
  res.json(r);
});
crm.put('/branches/:code/settings', (req, res) => {
  owner(req);
  res.json(saveBranchSettings(req.params.code, req.body || {}));
});
/** Переключиться в другой сервис (только владелец) */
crm.post('/branches/switch', (req, res) => {
  const o = owner(req);
  const code = String(req.body?.code || MAIN);
  if (code === MAIN) setSess(res, { id: o.id, b: MAIN });
  else setSess(res, { id: ownerIn(code, o), b: code, o: o.id });
  res.json({ ok: true, code });
});

/** Сводка одного сервиса за период */
function branchSummary(from, to) {
  const P = `method <> 'points' AND transfer_id IS NULL AND substr(created_at,1,10) BETWEEN ? AND ?`;
  const inc = one(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM payments WHERE direction='in' AND ${P}`, from, to);
  const out = one(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE direction='out' AND ${P}`, from, to).s;
  const purch = one(`SELECT COALESCE(SUM(gross),0) s FROM purchases WHERE substr(COALESCE(doc_date, created_at),1,10) BETWEEN ? AND ?`, from, to)?.s || 0;
  const closed = one(`SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE kind='order' AND substr(closed_at,1,10) BETWEEN ? AND ?`, from, to);
  const created = one(`SELECT COUNT(*) n FROM orders WHERE kind='order' AND substr(created_at,1,10) BETWEEN ? AND ?`, from, to).n;
  const open = one(`SELECT COUNT(*) n, COALESCE(SUM(o.total),0) s FROM orders o JOIN order_statuses st ON st.id = o.status_id WHERE o.kind='order' AND st.is_final = 0`);
  const debt = one(`SELECT COUNT(*) n, COALESCE(SUM(o.total - o.paid),0) s FROM orders o JOIN order_statuses st ON st.id = o.status_id
    WHERE o.kind='order' AND st.is_final = 1 AND o.paid < o.total - 0.01 AND o.source <> 'import'`);
  const quotes = one(`SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE kind='quote' AND substr(created_at,1,10) BETWEEN ? AND ?`, from, to);
  const newCust = one(`SELECT COUNT(*) n FROM customers WHERE substr(created_at,1,10) BETWEEN ? AND ?`, from, to).n;
  const d = today();
  const visits = one(`SELECT COUNT(*) n FROM appointments WHERE substr(start_at,1,10) = ? AND status <> 'cancelled'`, d).n;
  const requests = one(`SELECT COUNT(*) n FROM appointments WHERE status = 'request'`).n;
  const labor = one(`SELECT COALESCE(SUM(i.price * i.qty * (1 - COALESCE(i.discount,0)/100.0)),0) s FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.kind='order' AND i.kind = 'labor' AND substr(o.closed_at,1,10) BETWEEN ? AND ?`, from, to).s;
  const byDay = all(`SELECT substr(created_at,1,10) d, ROUND(SUM(amount),2) s FROM payments WHERE direction='in' AND ${P} GROUP BY d ORDER BY d`, from, to);
  const staff = one(`SELECT COUNT(*) n FROM staff WHERE active = 1 AND login IS NOT NULL`).n;
  return { income: inc.s, payments: inc.n, out, purchases: purch, closed, created, open, debt, quotes, newCust, visits, requests, labor,
    avg: closed.n ? closed.s / closed.n : 0, byDay, staff };
}
crm.get('/owner/dashboard', (req, res) => {
  owner(req);
  const d = today();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : d.slice(0, 8) + '01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : d;
  const rows = listBranches().map((b) => {
    const db_ = branchDb(b.code);
    if (!db_) return null;
    return withDb(db_, () => { try { return { code: b.code, name: b.name, ...branchSummary(from, to), today: branchSummary(d, d) }; } catch (e) { return { code: b.code, name: b.name, error: e.message }; } });
  }).filter(Boolean);
  res.json({ from, to, current: curBranch(), rows });
});

// ── Главная ────────────────────────────────────────────────────────────────
crm.get('/dashboard', (req, res) => {
  const me = who(req);
  const P = permsOf(me);
  const layout = DASH.layoutOf(me, P);
  res.json({
    layout, catalog: DASH.allowedWidgets(P), canEdit: !!P['dashboard.edit'] || me.role === 'admin', custom: !!me.dash,
    data: DASH.widgetData(me, P, layout.map((w) => w.type)),
  });
});
/** Данные для одного блока (при добавлении на главную) */
crm.get('/dashboard/widget/:type', (req, res) => {
  const me = who(req);
  res.json(DASH.widgetData(me, permsOf(me), [req.params.type])[req.params.type] ?? null);
});
/** Своя главная: сохранить раскладку / сбросить (widgets: null) */
crm.put('/me/dashboard', (req, res) => {
  const me = who(req);
  const P = permsOf(me);
  if (!P['dashboard.edit'] && me.role !== 'admin') throw new HttpError(403, 'Менять главную вам не разрешено — обратитесь к администратору');
  const w = req.body?.widgets;
  run('UPDATE staff SET dash = ? WHERE id = ?', w === null ? null : JSON.stringify({ v: 1, widgets: DASH.cleanLayout(w, P) }), me.id);
  res.json({ ok: true });
});
/** Главная сотрудника — администратор настраивает её в карточке сотрудника */
crm.get('/staff/:id/dashboard', (req, res) => {
  who(req, 'settings.manage');
  const s = one('SELECT * FROM staff WHERE id = ?', Number(req.params.id));
  if (!s) throw new HttpError(404, 'Сотрудник не найден');
  const P = permsOf(s);
  res.json({ layout: DASH.layoutOf(s, P), catalog: DASH.allowedWidgets(P), custom: !!s.dash });
});
crm.put('/staff/:id/dashboard', (req, res) => {
  who(req, 'settings.manage');
  const s = one('SELECT * FROM staff WHERE id = ?', Number(req.params.id));
  if (!s) throw new HttpError(404, 'Сотрудник не найден');
  const w = req.body?.widgets;
  run('UPDATE staff SET dash = ? WHERE id = ?', w === null ? null : JSON.stringify({ v: 1, widgets: DASH.cleanLayout(w, permsOf(s)) }), s.id);
  res.json({ ok: true });
});

// ── Клиенты ────────────────────────────────────────────────────────────────
const PAGE = 50;
const like = (q) => `%${String(q || '').trim().replace(/\s+/g, '%')}%`;

crm.get('/customers', (req, res) => {
  who(req, 'clients.view');
  const q = String(req.query.q || '').trim();
  const page = Math.max(0, Number(req.query.page) || 0);
  const phone = normPhone(q);
  const plate = normPlate(q);
  const where = q
    ? `WHERE c.name LIKE ? OR c.phone LIKE ? OR c.card_no LIKE ? OR c.company LIKE ? OR c.nip LIKE ? OR c.email LIKE ?
       OR c.id IN (SELECT customer_id FROM cars WHERE plate LIKE ? OR vin LIKE ?) ${phone ? 'OR c.phone = ?' : ''}`
    : '';
  const params = q ? [like(q), like(q.replace(/\D/g, '') || q), like(q), like(q), like(q), like(q), `%${plate}%`, `%${plate}%`, ...(phone ? [phone] : [])] : [];
  const total = one(`SELECT COUNT(*) n FROM customers c ${where}`, ...params).n;
  const rows = all(
    `SELECT c.*, (SELECT GROUP_CONCAT(COALESCE(plate, make), ', ') FROM cars WHERE customer_id = c.id) cars,
      (SELECT COUNT(*) FROM orders WHERE customer_id = c.id AND kind = 'order') orders_count,
      (SELECT MAX(created_at) FROM orders WHERE customer_id = c.id) last_order,
      (SELECT COALESCE(SUM(points),0) FROM transactions WHERE customer_id = c.id) points
     FROM customers c ${where} ORDER BY c.id DESC LIMIT ${PAGE} OFFSET ${page * PAGE}`, ...params,
  );
  res.json({ rows, total, pageSize: PAGE });
});

crm.get('/customers/:id', (req, res) => {
  who(req, 'clients.view');
  const c = one('SELECT * FROM customers WHERE id = ?', Number(req.params.id));
  if (!c) throw new HttpError(404, 'Клиент не найден');
  res.json({
    ...c,
    cars: all('SELECT * FROM cars WHERE customer_id = ? ORDER BY id', c.id),
    orders: all(`SELECT o.*, st.name status_name, st.color status_color, k.plate, k.make, k.model FROM orders o
      LEFT JOIN order_statuses st ON st.id = o.status_id LEFT JOIN cars k ON k.id = o.car_id WHERE o.customer_id = ? ORDER BY o.created_at DESC`, c.id),
    loyalty: loyaltySummary(c.id),
    transactions: all('SELECT * FROM transactions WHERE customer_id = ? ORDER BY id DESC LIMIT 100', c.id),
    storage: all('SELECT * FROM storage WHERE customer_id = ? ORDER BY id DESC', c.id),
    sales: all(`SELECT d.id, d.kind, d.number, d.issue_date, d.total_gross, d.paid, d.ksef_status, d.ksef_number, o.number order_no, o.id order_id FROM sales_docs d
      LEFT JOIN orders o ON o.id = d.order_id WHERE o.customer_id = ? ${c.nip ? "OR json_extract(d.buyer, '$.nip') = ?" : ''} ORDER BY d.issue_date DESC, d.id DESC`, c.id, ...(c.nip ? [c.nip] : [])),
    receipts: all(`SELECT r.id, r.number, r.total, r.status, r.created_at, o.number order_no, o.id order_id FROM receipts r JOIN orders o ON o.id = r.order_id WHERE o.customer_id = ? ORDER BY r.id DESC`, c.id),
    sms: all('SELECT id, phone, kind, text, status, created_at, staff FROM sms_log WHERE customer_id = ? ORDER BY id DESC LIMIT 200', c.id),
  });
});

const CUST_FIELDS = ['name', 'company', 'nip', 'email', 'street', 'postcode', 'city', 'notes', 'discount_labor', 'discount_parts', 'marketing_consent',
  'kind', 'first_name', 'last_name', 'country', 'default_car_id', 'payment_method', 'payment_term_days'];
function custData(b) {
  const o = {};
  for (const k of CUST_FIELDS) if (b[k] !== undefined) o[k] = b[k] === '' ? null : b[k];
  if (o.kind !== undefined) o.kind = o.kind === 'company' ? 'company' : 'person';
  if (o.kind === 'person') { o.company = null; o.nip = null; }
  if (o.country !== undefined) o.country = String(o.country || 'PL').toUpperCase().slice(0, 2) || 'PL';
  if (o.payment_method !== undefined && !['cash', 'card', 'blik', 'transfer', 'mixed', null].includes(o.payment_method)) o.payment_method = null;
  if (o.payment_term_days !== undefined && o.payment_term_days !== null) o.payment_term_days = Math.max(0, Math.min(365, Math.trunc(Number(o.payment_term_days)) || 0));
  if (o.nip) o.nip = String(o.nip).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  // имя для списков: «Имя Фамилия», у фирмы без контактного лица — название фирмы
  if (b.first_name !== undefined || b.last_name !== undefined) {
    const full = [b.first_name, b.last_name].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
    o.name = full || (o.kind === 'company' ? String(b.company || '').trim() || null : null);
  }
  if (b.phone !== undefined) {
    o.phone = b.phone ? normPhone(b.phone) : null;
    if (b.phone && !o.phone) throw new HttpError(400, 'Неверный номер телефона');
  }
  return o;
}
export function createCustomer(b) {
  const d = custData(b);
  if (!d.name && !d.phone) throw new HttpError(400, 'Нужно имя или телефон');
  if (d.phone && one('SELECT 1 FROM customers WHERE phone = ?', d.phone)) throw new HttpError(409, 'Клиент с таким телефоном уже есть');
  return insert('customers', { ...d, card_no: newCardNo() });
}
crm.post('/customers', (req, res) => {
  const s = who(req, 'clients.create');
  const id = createCustomer(req.body || {});
  log('customer', id, 'create', null, s.name);
  res.json({ id });
});
crm.put('/customers/:id', (req, res) => {
  const s = who(req, 'clients.edit');
  const d = custData(req.body || {});
  if (d.phone && one('SELECT 1 FROM customers WHERE phone = ? AND id <> ?', d.phone, Number(req.params.id))) throw new HttpError(409, 'Этот телефон у другого клиента');
  update('customers', Number(req.params.id), d);
  log('customer', Number(req.params.id), 'update', null, s.name);
  res.json({ ok: true });
});
crm.post('/customers/:id/adjust', (req, res) => {
  const s = who(req, 'admin');
  const pts = Math.trunc(Number(req.body?.points));
  const note = String(req.body?.note || '').trim();
  if (!pts || !note) throw new HttpError(400, 'Укажите количество баллов и причину.');
  run(`INSERT INTO transactions (customer_id, type, points, source, staff, note) VALUES (?, 'adjust', ?, 'admin', ?, ?)`, Number(req.params.id), pts, s.name, note);
  res.json({ ok: true });
});

// ── Автомобили ─────────────────────────────────────────────────────────────
crm.get('/cars', (req, res) => {
  who(req, 'cars.view');
  const q = String(req.query.q || '').trim();
  const page = Math.max(0, Number(req.query.page) || 0);
  const pl = normPlate(q);
  const where = q ? `WHERE k.plate LIKE ? OR k.vin LIKE ? OR k.make LIKE ? OR k.model LIKE ? OR c.name LIKE ? OR c.phone LIKE ?` : '';
  const params = q ? [`%${pl}%`, `%${pl}%`, like(q), like(q), like(q), like(q.replace(/\D/g, '') || q)] : [];
  const total = one(`SELECT COUNT(*) n FROM cars k LEFT JOIN customers c ON c.id = k.customer_id ${where}`, ...params).n;
  const rows = all(`SELECT k.*, c.name owner_name, c.phone owner_phone,
      (SELECT MAX(created_at) FROM orders WHERE car_id = k.id) last_order
    FROM cars k LEFT JOIN customers c ON c.id = k.customer_id ${where} ORDER BY k.id DESC LIMIT ${PAGE} OFFSET ${page * PAGE}`, ...params);
  res.json({ rows, total, pageSize: PAGE });
});
crm.get('/cars/:id', (req, res) => {
  who(req, 'cars.view');
  const k = one('SELECT * FROM cars WHERE id = ?', Number(req.params.id));
  if (!k) throw new HttpError(404, 'Авто не найдено');
  const orders = all(`SELECT o.*, st.name status_name, st.color status_color FROM orders o LEFT JOIN order_statuses st ON st.id = o.status_id
    WHERE o.car_id = ? ORDER BY o.created_at DESC`, k.id);
  const items = all(`SELECT i.* FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.car_id = ? ORDER BY i.pos`, k.id);
  res.json({
    ...k,
    owner: k.customer_id ? one('SELECT * FROM customers WHERE id = ?', k.customer_id) : null,
    orders: orders.map((o) => ({ ...o, items: items.filter((i) => i.order_id === o.id) })),
    storage: all('SELECT * FROM storage WHERE car_id = ? ORDER BY id DESC', k.id),
    files: all(`SELECT f.id, f.name, f.mime, f.size, f.created_at, o.id order_id, o.number order_no FROM order_files f JOIN orders o ON o.id = f.order_id WHERE o.car_id = ? ORDER BY f.id DESC`, k.id),
    recommendations: REC.listForCar(k.id),
  });
});
const CAR_FIELDS = ['customer_id', 'make', 'model', 'year', 'engine', 'capacity', 'power_kw', 'fuel', 'color', 'last_mileage', 'notes', 'mileage_unit',
  'first_reg', 'engine_no', 'category', 'mass_kg', 'seats', 'reg_doc', 'inspection_until', 'insurance_until', 'key_no', 'paint_code', 'vehicle_type', 'body_type'];
function carData(b) {
  const o = {};
  for (const k of CAR_FIELDS) if (b[k] !== undefined) o[k] = b[k] === '' ? null : b[k];
  if (o.mileage_unit !== undefined) o.mileage_unit = o.mileage_unit === 'mi' ? 'mi' : 'km';
  if (b.plate !== undefined) o.plate = normPlate(b.plate) || null;
  if (b.vin !== undefined) {
    o.vin = String(b.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
    if (o.vin && o.vin.length !== 17) throw new HttpError(400, 'VIN — 17 символов');
  }
  return o;
}
export function createCar(b) {
  const d = carData(b);
  if (!d.plate && !d.vin && !d.make) throw new HttpError(400, 'Укажите номер, VIN или марку');
  return insert('cars', { ...d, car_key: normVin(d.vin) || d.plate || `ID${Date.now()}` });
}
crm.post('/cars', (req, res) => {
  const s = who(req, 'cars.create');
  const id = createCar(req.body || {});
  log('car', id, 'create', null, s.name);
  res.json({ id });
});
crm.put('/cars/:id', (req, res) => {
  who(req, 'cars.edit');
  const d = carData(req.body || {});
  if (d.vin || d.plate) d.car_key = d.vin || d.plate;
  update('cars', Number(req.params.id), d);
  res.json({ ok: true });
});

// ── Заказы и выцены ─────────────────────────────────────────────────────────
crm.get('/orders', (req, res) => {
  const me = who(req, req.query.kind === 'quote' ? 'quotes.manage' : 'orders.view');
  const P = permsOf(me);
  const kind = req.query.kind === 'quote' ? 'quote' : req.query.kind === 'all' ? 'all' : 'order';
  const q = String(req.query.q || '').trim();
  const page = Math.max(0, Number(req.query.page) || 0);
  const cond = kind === 'all' ? [P['quotes.manage'] ? '1=1' : "o.kind = 'order'"] : ['o.kind = ?'];
  const params = kind === 'all' ? [] : [kind];
  if (req.query.status === 'open') cond.push('st.is_final = 0');
  else if (req.query.status) { cond.push('o.status_id = ?'); params.push(Number(req.query.status)); }
  if (req.query.from) { cond.push('substr(o.created_at,1,10) >= ?'); params.push(req.query.from); }
  if (req.query.to) { cond.push('substr(o.created_at,1,10) <= ?'); params.push(req.query.to); }
  if (req.query.followup === 'none') cond.push("COALESCE(o.followup,'') = ''");
  else if (req.query.followup === 'due') { cond.push("o.followup_at IS NOT NULL AND o.followup_at <= ? AND COALESCE(o.followup,'') NOT IN ('scheduled','declined')"); params.push(today()); }
  else if (req.query.followup) { cond.push('o.followup = ?'); params.push(String(req.query.followup)); }
  if (P['orders.only_assigned']) { cond.push('(o.mechanic_id = ? OR o.id IN (SELECT order_id FROM order_items WHERE mechanic_id = ?))'); params.push(me.id, me.id); }
  if (req.query.mechanic) { cond.push('(o.mechanic_id = ? OR o.id IN (SELECT order_id FROM order_items WHERE mechanic_id = ?))'); params.push(Number(req.query.mechanic), Number(req.query.mechanic)); }
  if (q) {
    const pl = normPlate(q);
    cond.push('(o.number LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR k.plate LIKE ? OR k.vin LIKE ? OR k.make LIKE ? OR k.model LIKE ?)');
    params.push(like(q), like(q), like(q.replace(/\D/g, '') || q), `%${pl}%`, `%${pl}%`, like(q), like(q));
  }
  const from = `FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN cars k ON k.id = o.car_id
    LEFT JOIN order_statuses st ON st.id = o.status_id LEFT JOIN order_types t ON t.id = o.type_id WHERE ${cond.join(' AND ')}`;
  const agg = one(`SELECT COUNT(*) n, COALESCE(SUM(o.total),0) s ${from}`, ...params);
  const rows = all(`SELECT o.*, c.name customer_name, c.phone customer_phone, k.plate, k.make, k.model, st.name status_name, st.color status_color,
      st.is_final, t.name type_name,
      (SELECT MIN(start_at) FROM appointments WHERE order_id = o.id AND status <> 'cancelled') planned_at,
      (SELECT text FROM order_comments WHERE order_id = o.id AND COALESCE(text,'') <> '' ORDER BY id DESC LIMIT 1) last_comment
    ${from} ORDER BY o.id DESC LIMIT ${PAGE} OFFSET ${page * PAGE}`, ...params);
  res.json({ rows: rows.map((o) => hideFor(P, o)), total: agg.n, sum: P['orders.prices'] ? agg.s : null, pageSize: PAGE });
});

/** Скрываем цены и контакты, если у сотрудника нет таких прав */
function hideFor(P, o, me) {
  if (P['orders.only_my_jobs'] && me && o.items) {
    const mine = new Set(o.items.filter((i) => i.kind === 'labor' && i.mechanic_id === me.id).map((i) => i.id));
    o.items = o.items.filter((i) => mine.has(i.id) || (i.kind === 'part' && mine.has(i.task_id)));
    o.only_my_jobs = true;
  }
  if (!P['orders.prices']) for (const k of ['total', 'total_net', 'paid', 'cost']) o[k] = null;
  if (!P['clients.contact']) { o.customer_phone = null; if (o.customer) o.customer = { ...o.customer, phone: null, email: null }; }
  if (!P['orders.prices'] && o.items) o.items = o.items.map((i) => ({ ...i, price: null, cost: null, discount: null }));
  if (!P['orders.prices'] && o.payments) o.payments = [];
  return o;
}
function assertAssigned(me, o) {
  if (!permsOf(me)['orders.only_assigned']) return;
  if (o.mechanic_id !== me.id && !one('SELECT 1 FROM order_items WHERE order_id = ? AND mechanic_id = ?', o.id, me.id)) throw new HttpError(403, 'Этот заказ назначен другому механику');
}

/** Авто без владельца (или только что созданные) привязываем к клиенту заказа / выцены; первое авто клиента — «по умолчанию» */
export function linkCar(carId, customerId) {
  if (!carId || !customerId) return;
  run('UPDATE cars SET customer_id = ? WHERE id = ? AND customer_id IS NULL', customerId, carId);
  run('UPDATE customers SET default_car_id = ? WHERE id = ? AND default_car_id IS NULL AND EXISTS (SELECT 1 FROM cars WHERE id = ? AND customer_id = ?)', carId, customerId, carId, customerId);
}
crm.post('/orders', (req, res) => {
  const b = req.body || {};
  const s = who(req, b.kind === 'quote' ? 'quotes.manage' : 'orders.create');
  const id = tx(() => {
    let customerId = b.customer_id || null;
    if (!customerId && b.new_customer && (b.new_customer.name || b.new_customer.phone)) {
      const ph = normPhone(b.new_customer.phone);
      customerId = (ph && one('SELECT id FROM customers WHERE phone = ?', ph)?.id) || createCustomer(b.new_customer);
    }
    let carId = b.car_id || null;
    if (!carId && b.new_car && (b.new_car.plate || b.new_car.vin || b.new_car.make)) {
      // тот же авто уже есть в базе (по номеру / VIN) — берём его, а не создаём дубль
      const vin = normVin(b.new_car.vin), plate = normPlate(b.new_car.plate);
      carId = (vin && one('SELECT id FROM cars WHERE vin = ?', vin)?.id) || (plate && one('SELECT id FROM cars WHERE plate = ?', plate)?.id) || createCar({ ...b.new_car, customer_id: customerId });
    }
    // клиент без выбранного авто, но машина одна или отмечена «по умолчанию» — подставляем её
    if (!carId && customerId && !b.no_car) {
      const c = one('SELECT default_car_id FROM customers WHERE id = ?', customerId);
      carId = c?.default_car_id || (one('SELECT COUNT(*) n FROM cars WHERE customer_id = ?', customerId).n === 1 ? one('SELECT id FROM cars WHERE customer_id = ?', customerId).id : null);
    }
    if (carId && !customerId) customerId = one('SELECT customer_id FROM cars WHERE id = ?', carId)?.customer_id || null;
    linkCar(carId, customerId);
    const oid = createOrder({ ...b, customer_id: customerId, car_id: carId }, s.name);
    // заказ сразу в терминарз (как в Motowarsztat): пост, время, длительность
    if (b.appointment && (b.appointment.start_at || b.appointment.station_id)) {
      if (!can(s, 'calendar.edit')) throw new HttpError(403, 'Недостаточно прав: ' + permLabel('calendar.edit'));
      const o = one('SELECT number, complaint FROM orders WHERE id = ?', oid);
      const d = apptData({ ...b.appointment, order_id: oid, customer_id: customerId, car_id: carId, mechanic_id: b.appointment.mechanic_id || b.mechanic_id || null,
        title: b.appointment.title || o.complaint?.slice(0, 120) || o.number });
      d.status = d.station_id && d.start_at ? 'planned' : 'request';
      d.source = 'crm';
      if (b.appointment_id) { checkOverlap(d, Number(b.appointment_id)); update('appointments', Number(b.appointment_id), d); }
      else { checkOverlap(d); insert('appointments', d); }
    }
    return oid;
  });
  if (b.appointment_id) run('UPDATE appointments SET order_id = ?, customer_id = COALESCE(customer_id, (SELECT customer_id FROM orders WHERE id = ?)), car_id = COALESCE(car_id, (SELECT car_id FROM orders WHERE id = ?)), status = CASE WHEN status = \'request\' THEN \'planned\' ELSE status END WHERE id = ?', id, id, id, Number(b.appointment_id));
  res.json({ id });
});

crm.get('/orders/:id', (req, res) => {
  const me = who(req, 'orders.view');
  const o = orderFull(Number(req.params.id));
  assertAssigned(me, o);
  hideFor(permsOf(me), o, me);
  o.damages = (() => { try { return JSON.parse(o.damages || '[]'); } catch { return []; } })();
  o.sales_docs = all('SELECT id, kind, number, issue_date, total_gross, paid, ksef, ext_url, corrects_id, created_by, ksef_status, ksef_number, ksef_error FROM sales_docs WHERE order_id = ? ORDER BY id', o.id);
  o.signatures = all('SELECT id, doc, method, signer_name, phone, signed_at, ip FROM order_signatures WHERE order_id = ? ORDER BY id', o.id);
  o.files = all('SELECT id, name, mime, size, client_visible, staff, created_at FROM order_files WHERE order_id = ? ORDER BY id', o.id);
  o.comments = all('SELECT * FROM order_comments WHERE order_id = ? ORDER BY id DESC', o.id);
  o.recommendations = o.car_id ? REC.listForCar(o.car_id) : [];
  if (o.customer_id) o.redeem = redeemLimits(o.customer_id, o.total, o.payments.filter((p) => p.method === 'points').reduce((a, p) => a + p.amount, 0));
  res.json(o);
});

const ORDER_FIELDS = ['customer_id', 'car_id', 'type_id', 'mechanic_id', 'mileage', 'fuel_level', 'complaint', 'internal_note', 'mechanic_note', 'pickup_at', 'receipt_no', 'external_no', 'faults', 'after_notes', 'damages_note', 'contact_person', 'contact_phone', 'notes'];
function assertEditable(o, s) {
  const st = one('SELECT lock_edit FROM order_statuses WHERE id = ?', o.status_id);
  if (st?.lock_edit && s.role !== 'admin') throw new HttpError(423, 'Заказ завершён и закрыт для изменений. Смените статус или обратитесь к администратору.');
}
crm.put('/orders/:id', (req, res) => {
  const s = who(req, 'orders.edit');
  const o = getOrder(Number(req.params.id));
  assertEditable(o, s);
  const b = req.body || {};
  const d = {};
  for (const k of ORDER_FIELDS) if (b[k] !== undefined) d[k] = b[k] === '' ? null : b[k];
  if (b.flags !== undefined) d.flags = JSON.stringify(b.flags || {});
  if (b.damages !== undefined) {
    const marks = (Array.isArray(b.damages) ? b.damages : []).slice(0, 60).map((m) => ({ x: Math.max(0, Math.min(100, Number(m.x) || 0)), y: Math.max(0, Math.min(100, Number(m.y) || 0)),
      type: String(m.type || 'inne').slice(0, 20), note: String(m.note || '').slice(0, 300) }));
    d.damages = JSON.stringify(marks);
  }
  update('orders', o.id, d);
  if (d.mileage && (d.car_id || o.car_id)) run('UPDATE cars SET last_mileage = MAX(COALESCE(last_mileage,0), ?) WHERE id = ?', d.mileage, d.car_id || o.car_id);
  linkCar(d.car_id || o.car_id, d.customer_id || o.customer_id);
  log('order', o.id, 'update', Object.keys(d), s.name);
  res.json({ ok: true });
});

crm.post('/orders/:id/status', (req, res) => {
  const s = who(req, 'orders.status');
  const r = setStatus(Number(req.params.id), Number(req.body?.status_id), s.name);
  const o = getOrder(Number(req.params.id));
  const st = one('SELECT * FROM order_statuses WHERE id = ?', o.status_id);
  notify('status', `${o.number}: ${st?.name}`, { order: o.number, status: st?.name });
  // автофактура для фирм (NIP), если заказ завершён и оплачен
  const fk = cfg('fakturownia');
  const c = o.customer_id ? one('SELECT nip FROM customers WHERE id = ?', o.customer_id) : null;
  if (fk?.autoInvoiceNip && st?.is_final && c?.nip && !o.invoice_ext_id && o.paid >= o.total - 0.01 && o.total > 0)
    issueInvoice(o.id, {}).then((i) => log('order', o.id, 'invoice', i.number, 'авто')).catch((e) => log('order', o.id, 'invoice_error', e.message, 'авто'));
  res.json(r);
});

crm.post('/orders/:id/items', (req, res) => {
  const s = who(req, 'orders.jobs');
  const o = getOrder(Number(req.params.id));
  assertEditable(o, s);
  const itemId = addItem(o.id, req.body || {});
  recalc(o.id);
  res.json({ id: itemId });
});
crm.put('/orders/:id/items/:itemId', (req, res) => {
  const s = who(req, 'orders.view');
  const o = getOrder(Number(req.params.id));
  assertAssigned(s, o);
  const P = permsOf(s);
  // без права на работы — только отметка «выполнено»; без права на цены — цены не меняются
  let b = req.body || {};
  if (!P['orders.jobs']) b = { done: b.done };
  else {
    assertEditable(o, s);
    if (!P['orders.price_edit']) { const { price: _p, discount: _d, cost: _c, ...rest } = b; b = rest; }
  }
  updateItem(Number(req.params.itemId), b, s);
  recalc(o.id);
  res.json({ ok: true });
});
crm.delete('/orders/:id/items/:itemId', (req, res) => {
  const s = who(req, 'orders.jobs');
  const o = getOrder(Number(req.params.id));
  assertEditable(o, s);
  run('DELETE FROM order_items WHERE id = ? AND order_id = ?', Number(req.params.itemId), o.id);
  recalc(o.id);
  res.json({ ok: true });
});

/** Порядок работ / товаров (перетаскивание за ≡, как в Motowarsztat) */
crm.post('/orders/:id/items/reorder', (req, res) => {
  const s = who(req, 'orders.jobs');
  const o = getOrder(Number(req.params.id));
  assertEditable(o, s);
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  tx(() => ids.forEach((id, i) => run('UPDATE order_items SET pos = ? WHERE id = ? AND order_id = ?', i + 1, id, o.id)));
  res.json({ ok: true });
});
/** Механик отмечает: фото/видео «до и после» сделаны и загружены в систему */
crm.post('/orders/:id/media', (req, res) => {
  const s = who(req, 'orders.view');
  const o = getOrder(Number(req.params.id));
  assertAssigned(s, o);
  const done = req.body?.done ? 1 : 0;
  run(`UPDATE orders SET media_done = ?, media_done_by = ?, media_done_at = CASE WHEN ? THEN datetime('now','localtime') END WHERE id = ?`, done, done ? s.name : null, done, o.id);
  res.json({ ok: true, media_done: done, media_done_by: done ? s.name : null });
});
/** Выцена: статус обзвона (перезвонить / записан / отказался…), причина, дата следующего контакта и комментарий */
const FOLLOWUP = ['', 'new', 'call_back', 'thinking', 'scheduled', 'accepted', 'declined', 'no_answer'];
crm.post('/orders/:id/followup', (req, res) => {
  const s = who(req, 'orders.view');
  const o = getOrder(Number(req.params.id));
  const P = permsOf(s);
  if (!(P[o.kind === 'quote' ? 'quotes.manage' : 'orders.edit'])) throw new HttpError(403, 'Нет доступа');
  const b = req.body || {};
  const fu = b.followup === undefined ? o.followup || '' : String(b.followup || '');
  if (!FOLLOWUP.includes(fu)) throw new HttpError(400, 'Неизвестный статус');
  const reason = b.reason === undefined ? o.followup_reason : String(b.reason || '').trim() || null;
  if (fu === 'declined' && !reason) throw new HttpError(400, 'Укажите причину отказа');
  const at = b.followup_at === undefined ? o.followup_at : b.followup_at || null;
  const text = String(b.text || '').trim().slice(0, 2000);
  run('UPDATE orders SET followup = ?, followup_reason = ?, followup_at = ? WHERE id = ?', fu || null, fu === 'declined' ? reason : reason && fu ? reason : null, at, o.id);
  if (text || fu !== (o.followup || '') || at !== o.followup_at) insert('order_comments', { order_id: o.id, staff: s.name, text: text || null, followup: fu || null, reason: fu === 'declined' ? reason : null, followup_at: at });
  res.json({ ok: true });
});
crm.delete('/orders/:id/comments/:cid', (req, res) => {
  const s = who(req, 'orders.view');
  const c = one('SELECT * FROM order_comments WHERE id = ? AND order_id = ?', Number(req.params.cid), Number(req.params.id));
  if (!c) throw new HttpError(404, 'Нет комментария');
  if (c.staff !== s.name && !permsOf(s)['settings.manage']) throw new HttpError(403, 'Удалить можно только свой комментарий');
  run('DELETE FROM order_comments WHERE id = ?', c.id);
  res.json({ ok: true });
});

crm.post('/orders/:id/payments', (req, res) => {
  const s = who(req, 'orders.payments');
  const o = getOrder(Number(req.params.id));
  // смешанная оплата: split = [{method, amount}, …] — каждая часть отдельным платежом (наличные → KP в кассе, карта/BLIK → терминал)
  const parts = Array.isArray(req.body?.split)
    ? req.body.split.map((x) => ({ method: PAY_METHODS.includes(x?.method) ? x.method : null, amount: round2(x?.amount) })).filter((x) => x.method && x.amount > 0)
    : [{ method: PAY_METHODS.includes(req.body?.method) ? req.body.method : null, amount: round2(req.body?.amount) }];
  if (!parts.length || parts.some((x) => !x.method || !(x.amount > 0))) throw new HttpError(400, 'Укажите способ и сумму оплаты');
  const mixed = parts.length > 1;
  tx(() => {
    for (const { method, amount } of parts) insert('payments', {
      number: method === 'cash' ? nextNumber('KP') : null, direction: 'in', method, amount, order_id: o.id, customer_id: o.customer_id,
      note: String(req.body?.note || '') || `Płatność ${o.number}${mixed ? ' (płatność mieszana)' : ''}`, staff: s.name,
    });
  });
  recalc(o.id);
  const amount = round2(parts.reduce((a, x) => a + x.amount, 0)), method = mixed ? parts.map((x) => `${x.method} ${x.amount}`).join(' + ') : parts[0].method;
  log('order', o.id, 'payment', { method, amount }, s.name);
  notify('payment', `Оплата ${o.number}: ${amount} zł (${method})`, { order: o.number, amount, method });
  res.json({ ok: true });
});
crm.delete('/orders/:id/payments/:pid', (req, res) => {
  const s = who(req, 'admin');
  const p = one('SELECT * FROM payments WHERE id = ? AND order_id = ?', Number(req.params.pid), Number(req.params.id));
  if (!p) throw new HttpError(404, 'Платёж не найден');
  if (p.method === 'points') throw new HttpError(400, 'Списание баллов отменяется корректировкой баллов у клиента');
  run('DELETE FROM payments WHERE id = ?', p.id);
  recalc(p.order_id);
  log('order', p.order_id, 'payment_delete', { amount: p.amount }, s.name);
  res.json({ ok: true });
});

// баллы в заказе: скан QR клиента → списание
crm.post('/orders/:id/scan', (req, res) => {
  const s = who(req, 'loyalty.use');
  const o = getOrder(Number(req.params.id));
  const c = req.body?.qr ? verifyQrPayload(req.body.qr) : verifyManual(req.body?.who, req.body?.code);
  if (!o.customer_id) run('UPDATE orders SET customer_id = ? WHERE id = ?', c.id, o.id);
  else if (o.customer_id !== c.id) throw new HttpError(409, `QR клиента ${c.name || c.phone}, а заказ на другого клиента.`);
  const already = one(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE order_id = ? AND method = 'points'`, o.id).s;
  res.json({ ticket: issueTicket(c.id, s.name), limits: redeemLimits(c.id, o.total, already), client: { name: c.name, cardNo: c.card_no } });
});
crm.post('/orders/:id/redeem', (req, res) => {
  const s = who(req, 'loyalty.use');
  const o = getOrder(Number(req.params.id));
  const r = redeemForOrder(req.body?.ticket, o, req.body?.points, s.name);
  recalc(o.id);
  log('order', o.id, 'redeem', r, s.name);
  res.json(r);
});

crm.post('/orders/:id/invoice', async (req, res) => {
  const s = who(req, 'invoices.create');
  const r = await issueInvoice(Number(req.params.id), req.body || {});
  log('order', Number(req.params.id), 'invoice', r.number, s.name);
  const target = Number(getSetting('status_on_sale_doc', '')) || null;
  if (target) try { setStatus(Number(req.params.id), target, s.name); } catch (e) { log('order', Number(req.params.id), 'invoice_error', 'Статус после фактуры: ' + e.message, s.name); }
  res.json(r);
});
crm.get('/orders/:id/invoice.pdf', async (req, res) => {
  who(req);
  const pdf = await invoicePdf(Number(req.params.id));
  res.setHeader('Content-Type', 'application/pdf');
  res.send(pdf);
});

crm.post('/orders/:id/to-order', (req, res) => {
  const s = who(req, 'orders.create');
  res.json({ id: quoteToOrder(Number(req.params.id), s.name) });
});
crm.post('/orders/:id/add-to-order', (req, res) => {
  const s = who(req, 'orders.edit');
  res.json(quoteToExistingOrder(Number(req.params.id), Number(req.body?.order_id), s.name));
});
crm.post('/orders/:id/copy', (req, res) => {
  const src = getOrder(Number(req.params.id));
  const s = who(req, src.kind === 'quote' ? 'quotes.manage' : 'orders.create');
  res.json({ id: copyOrder(src.id, s.name) });
});
/** Открытые заказы для «Добавить в заказ»: сначала этого же клиента / авто */
crm.get('/orders/:id/merge-targets', (req, res) => {
  who(req, 'orders.view');
  const q = getOrder(Number(req.params.id));
  res.json(all(`SELECT o.id, o.number, o.created_at, o.total, st.name status_name, st.color status_color, COALESCE(CASE WHEN c.kind = 'company' THEN c.company END, c.name) customer_name, k.make, k.model, k.plate,
      (o.customer_id = ? OR o.car_id = ?) same
    FROM orders o LEFT JOIN order_statuses st ON st.id = o.status_id LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN cars k ON k.id = o.car_id
    WHERE o.kind = 'order' AND COALESCE(st.is_final, 0) = 0 ORDER BY same DESC, o.id DESC LIMIT 60`, q.customer_id || -1, q.car_id || -1));
});

crm.delete('/orders/:id', (req, res) => {
  const s = who(req, 'orders.delete');
  const o = getOrder(Number(req.params.id));
  if (one('SELECT 1 FROM payments WHERE order_id = ?', o.id)) throw new HttpError(400, 'В заказе есть оплаты — сначала удалите их');
  if (one(`SELECT 1 FROM stock_docs WHERE order_id = ?`, o.id)) throw new HttpError(400, 'По заказу выданы запчасти со склада — сначала верните статус');
  tx(() => { run('DELETE FROM appointments WHERE order_id = ?', o.id); run('DELETE FROM orders WHERE id = ?', o.id); }); // запись заказа в графике удаляется вместе с ним
  log('order', o.id, 'delete', o.number, s.name);
  res.json({ ok: true });
});

// ── Массовые действия в списках (выделенные строки) ─────────────────────────
crm.post('/bulk/:entity', (req, res) => {
  const b = req.body || {};
  const ids = [...new Set((b.ids || []).map(Number).filter((x) => x > 0))].slice(0, 1000);
  if (!ids.length) throw new HttpError(400, 'Ничего не выбрано');
  const v = b.value;
  let done = 0; const skipped = [];
  const each = (rows, label, fn) => {
    for (const r of rows) {
      try { if (fn(r) === false) continue; done++; } catch (e) { skipped.push({ id: r.id, label: label(r), reason: e.message }); }
    }
  };
  const q = `(${ids.map(() => '?').join(',')})`;
  const E = req.params.entity, A = b.action;
  if (E === 'orders') {
    const need = { delete: 'orders.delete', status: 'orders.status', mechanic: 'orders.edit', followup: 'quotes.manage' }[A];
    if (!need) throw new HttpError(400, 'Неизвестное действие');
    const s = who(req, need);
    const rows = all(`SELECT * FROM orders WHERE id IN ${q}`, ...ids);
    const lbl = (o) => o.number;
    if (A === 'delete') each(rows, lbl, (o) => {
      if (one('SELECT 1 FROM payments WHERE order_id = ?', o.id)) throw new HttpError(400, 'есть оплаты — сначала удалите их');
      if (one('SELECT 1 FROM stock_docs WHERE order_id = ?', o.id)) throw new HttpError(400, 'выданы запчасти со склада');
      if (one('SELECT 1 FROM sales_docs WHERE order_id = ?', o.id)) throw new HttpError(400, 'есть фактура / документ продажи');
      tx(() => { run('DELETE FROM appointments WHERE order_id = ?', o.id); run('DELETE FROM orders WHERE id = ?', o.id); log('order', o.id, 'delete', o.number + ' (массово)', s.name); });
    });
    if (A === 'status') {
      const st = one('SELECT * FROM order_statuses WHERE id = ?', Number(v));
      if (!st) throw new HttpError(400, 'Выберите статус');
      each(rows, lbl, (o) => {
        if (o.status_id === st.id) return false;
        if ((st.scope || 'all') !== 'all' && st.scope !== o.kind) throw new HttpError(400, 'этот статус не для ' + (o.kind === 'quote' ? 'выцен' : 'заказов'));
        setStatus(o.id, st.id, s.name);
      });
    }
    if (A === 'mechanic') {
      const m = v ? one('SELECT id FROM staff WHERE id = ? AND active = 1', Number(v)) : null;
      if (v && !m) throw new HttpError(400, 'Сотрудник не найден');
      each(rows, lbl, (o) => { if (o.kind !== 'order') throw new HttpError(400, 'это выцена'); run('UPDATE orders SET mechanic_id = ? WHERE id = ?', m?.id ?? null, o.id); });
    }
    if (A === 'followup') each(rows, lbl, (o) => { if (o.kind !== 'quote') throw new HttpError(400, 'это заказ'); run('UPDATE orders SET followup = ? WHERE id = ?', String(v || '') || null, o.id); });
  } else if (E === 'products') {
    const s = who(req, 'products.create');
    const rows = all(`SELECT * FROM products WHERE id IN ${q}`, ...ids);
    const lbl = (p) => p.name + (p.code ? ' · ' + p.code : '');
    if (A === 'archive') each(rows, lbl, (p) => run('UPDATE products SET active = 0 WHERE id = ?', p.id));
    else if (A === 'restore') each(rows, lbl, (p) => run('UPDATE products SET active = 1 WHERE id = ?', p.id));
    else if (A === 'delete') each(rows, lbl, (p) => {
      if (Math.abs(Number(p.stock) || 0) > 0.0001) throw new HttpError(400, 'есть остаток на складе');
      if (one('SELECT 1 FROM order_items WHERE product_id = ?', p.id) || one('SELECT 1 FROM stock_doc_items WHERE product_id = ?', p.id)) throw new HttpError(400, 'есть движения по складу или в заказах — используйте «В архив»');
      run('DELETE FROM products WHERE id = ?', p.id);
    });
    else if (A === 'location') each(rows, lbl, (p) => run('UPDATE products SET location = ? WHERE id = ?', String(v || '').trim().slice(0, 80) || null, p.id));
    else if (A === 'min_stock') { const n = Number(v); if (!(n >= 0)) throw new HttpError(400, 'Минимум — число ≥ 0'); each(rows, lbl, (p) => run('UPDATE products SET min_stock = ? WHERE id = ?', n, p.id)); }
    else if (A === 'price_pct') {
      const pct = Number(v); if (!Number.isFinite(pct) || pct <= -100 || pct > 1000) throw new HttpError(400, 'Процент от -99 до 1000');
      each(rows, lbl, (p) => run('UPDATE products SET sell_price = ? WHERE id = ?', round2((Number(p.sell_price) || 0) * (1 + pct / 100)), p.id));
    }
    else if (A === 'price_group') each(rows, lbl, (p) => run('UPDATE products SET price_group_id = ? WHERE id = ?', Number(v) || null, p.id));
    else throw new HttpError(400, 'Неизвестное действие');
    log('product', 0, 'bulk', `${A}: ${done} поз.`, s.name);
  } else if (E === 'customers') {
    const s = who(req, A === 'delete' ? 'clients.edit' : 'clients.edit');
    const rows = all(`SELECT * FROM customers WHERE id IN ${q}`, ...ids);
    const lbl = (c) => c.name || c.company || c.phone || '#' + c.id;
    if (A === 'delete') each(rows, lbl, (c) => {
      if (one('SELECT 1 FROM orders WHERE customer_id = ?', c.id)) throw new HttpError(400, 'есть заказы или выцены');
      if (one('SELECT 1 FROM transactions WHERE customer_id = ?', c.id)) throw new HttpError(400, 'есть история Pulse Points');
      if (c.registered_at) throw new HttpError(400, 'клиент зарегистрирован в приложении');
      if (one('SELECT 1 FROM payments WHERE customer_id = ?', c.id)) throw new HttpError(400, 'есть платежи');
      tx(() => { run('UPDATE cars SET customer_id = NULL WHERE customer_id = ?', c.id); run('DELETE FROM customers WHERE id = ?', c.id); log('customer', c.id, 'delete', lbl(c) + ' (массово)', s.name); });
    });
    else if (A === 'discount_labor' || A === 'discount_parts') { const n = Number(v); if (!(n >= 0 && n <= 100)) throw new HttpError(400, 'Скидка 0–100%'); each(rows, lbl, (c) => run(`UPDATE customers SET ${A} = ? WHERE id = ?`, n, c.id)); }
    else if (A === 'consent_on' || A === 'consent_off') each(rows, lbl, (c) => run('UPDATE customers SET marketing_consent = ? WHERE id = ?', A === 'consent_on' ? 1 : 0, c.id));
    else throw new HttpError(400, 'Неизвестное действие');
  } else if (E === 'cars') {
    const s = who(req, 'cars.edit');
    const rows = all(`SELECT * FROM cars WHERE id IN ${q}`, ...ids);
    const lbl = (k) => [k.make, k.model, k.plate].filter(Boolean).join(' ') || '#' + k.id;
    if (A === 'delete') each(rows, lbl, (k) => {
      if (one('SELECT 1 FROM orders WHERE car_id = ?', k.id)) throw new HttpError(400, 'есть заказы или выцены');
      run('DELETE FROM cars WHERE id = ?', k.id); log('car', k.id, 'delete', lbl(k) + ' (массово)', s.name);
    });
    else throw new HttpError(400, 'Неизвестное действие');
  } else throw new HttpError(404, 'Нет такого списка');
  res.json({ ok: true, done, skipped });
});

// ── Терминарз ──────────────────────────────────────────────────────────────
/** Часы работ заказа: работы в нормо-часах (не «szt/usł») */
const LABOR_H = `SUM(CASE WHEN i.kind = 'labor' AND lower(COALESCE(i.unit,'')) NOT GLOB '*szt*' AND lower(COALESCE(i.unit,'')) NOT GLOB '*us*' THEN i.qty ELSE 0 END)`;
function orderJobs(ids) {
  if (!ids.length) return {};
  const out = {};
  for (const i of all(`SELECT order_id, name, qty, unit, kind, done FROM order_items WHERE kind = 'labor' AND order_id IN (${ids.map(() => '?').join(',')}) ORDER BY pos, id`, ...ids)) (out[i.order_id] ||= []).push(i);
  return out;
}
crm.get('/appointments', (req, res) => {
  who(req, 'calendar.view');
  const from = String(req.query.from || today());
  const to = String(req.query.to || from);
  const base = `SELECT a.*, COALESCE(CASE WHEN c.kind = 'company' THEN c.company END, c.name) customer_name, c.phone customer_phone, k.make, k.model, k.plate, o.number order_number, o.kind order_kind, o.complaint order_complaint, o.total order_total, o.status_id order_status_id, o.media_done,
      st.name status_name, st.color status_color, s.name mechanic_name,
      (SELECT COUNT(*) FROM appointments x WHERE x.order_id = a.order_id AND a.order_id IS NOT NULL AND x.status NOT IN ('cancelled') AND x.start_at IS NOT NULL) part_total,
      (SELECT COUNT(*) FROM appointments x WHERE x.order_id = a.order_id AND a.order_id IS NOT NULL AND x.status NOT IN ('cancelled') AND x.start_at IS NOT NULL AND (x.start_at < a.start_at OR (x.start_at = a.start_at AND x.id <= a.id))) part_no
      , q.number quote_number, (SELECT z.id FROM orders z WHERE z.kind = 'order' AND (z.quote_id = q.id OR z.id = q.merged_into) LIMIT 1) quote_order_id
    FROM appointments a LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN cars k ON k.id = a.car_id
    LEFT JOIN orders o ON o.id = a.order_id LEFT JOIN order_statuses st ON st.id = o.status_id LEFT JOIN staff s ON s.id = a.mechanic_id
    LEFT JOIN orders q ON q.id = a.quote_id AND q.kind = 'quote'`;
  const rows = all(`${base} WHERE a.start_at IS NOT NULL AND a.station_id IS NOT NULL AND substr(a.start_at,1,10) BETWEEN ? AND ? AND a.status <> 'cancelled' ORDER BY a.start_at`, from, to);
  const unassigned = all(`${base} WHERE (a.station_id IS NULL OR a.start_at IS NULL) AND a.status IN ('request','planned') ORDER BY a.id DESC LIMIT 100`);
  // «Неназначенные элементы» как в Motowarsztat: открытые заказы, которые ещё не (полностью) в графике
  const orders = all(`SELECT o.id, o.number, o.complaint, o.created_at, o.pickup_at, o.customer_id, o.car_id, o.mechanic_id, st.name status_name, st.color status_color,
      COALESCE(CASE WHEN c.kind = 'company' THEN c.company END, c.name) customer_name, c.phone customer_phone, k.make, k.model, k.plate,
      (SELECT ${LABOR_H} FROM order_items i WHERE i.order_id = o.id) hours,
      (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id AND i.kind = 'labor') jobs,
      (SELECT COALESCE(SUM(duration_min),0) FROM appointments a WHERE a.order_id = o.id AND a.status NOT IN ('cancelled','no_show') AND a.start_at IS NOT NULL AND a.station_id IS NOT NULL) planned_min
    FROM orders o LEFT JOIN order_statuses st ON st.id = o.status_id LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN cars k ON k.id = o.car_id
    WHERE o.kind = 'order' AND COALESCE(st.is_final, 0) = 0 ORDER BY o.id DESC LIMIT 300`)
    .map((o) => ({ ...o, hours: Math.round((o.hours || 0) * 100) / 100 }))
    // заказ в графике (хоть одна часть) из «Неназначенных» уходит; ещё пост/время — кнопкой в карточке записи
    .filter((o) => o.planned_min === 0);
  const jobs = orderJobs([...new Set([...rows, ...unassigned].map((a) => a.order_id).filter(Boolean).concat(orders.map((o) => o.id)))]);
  res.json({
    rows: rows.map((a) => ({ ...a, jobs: jobs[a.order_id] || [] })),
    unassigned: unassigned.map((a) => ({ ...a, jobs: jobs[a.order_id] || [] })),
    orders: orders.map((o) => ({ ...o, jobs: jobs[o.id] || [] })),
  });
});
const APPT_FIELDS = ['station_id', 'order_id', 'customer_id', 'car_id', 'mechanic_id', 'title', 'note', 'start_at', 'duration_min', 'status', 'contact_name', 'contact_phone', 'preferred'];
function apptData(b) {
  const o = {};
  for (const k of APPT_FIELDS) if (b[k] !== undefined) o[k] = b[k] === '' ? null : b[k];
  if (o.start_at && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(o.start_at)) throw new HttpError(400, 'Время в формате ГГГГ-ММ-ДД ЧЧ:ММ');
  if (o.contact_phone) o.contact_phone = normPhone(o.contact_phone) || o.contact_phone;
  return o;
}
function checkOverlap(a, ignoreId) {
  if (!a.station_id || !a.start_at) return;
  const end = `datetime(?, '+' || ? || ' minutes')`;
  const clash = one(
    `SELECT a.id, a.title, a.start_at FROM appointments a WHERE a.station_id = ? AND a.status NOT IN ('cancelled','no_show') AND a.id <> ?
     AND a.start_at IS NOT NULL AND datetime(a.start_at) < ${end} AND datetime(a.start_at, '+' || a.duration_min || ' minutes') > datetime(?)`,
    a.station_id, ignoreId || 0, a.start_at, a.duration_min || 60, a.start_at,
  );
  if (clash) throw new HttpError(409, `На этом посту уже занято: ${clash.title || 'запись'} в ${clash.start_at.slice(11)}`);
}
crm.post('/appointments', (req, res) => {
  const s = who(req, 'calendar.edit');
  const d = apptData(req.body || {});
  // заказ перетащили в график: клиент, авто и длительность — из заказа (оставшиеся часы работ)
  if (d.order_id) {
    const o = one(`SELECT o.*, (SELECT ${LABOR_H} FROM order_items i WHERE i.order_id = o.id) hours,
        (SELECT COALESCE(SUM(duration_min),0) FROM appointments a WHERE a.order_id = o.id AND a.status NOT IN ('cancelled','no_show') AND a.start_at IS NOT NULL) planned FROM orders o WHERE o.id = ?`, Number(d.order_id));
    if (!o) throw new HttpError(404, 'Заказ не найден');
    d.customer_id ??= o.customer_id; d.car_id ??= o.car_id; d.mechanic_id ??= o.mechanic_id; d.title ??= o.number;
    if (!d.duration_min) {
      const rest = Math.round((o.hours || 0) * 60) - (o.planned || 0);
      const step = Number(getSetting('slot_min', '30')) || 30;
      d.duration_min = Math.min(8 * 60, Math.max(step, Math.ceil((rest > 0 ? rest : 60) / step) * step));
    }
  }
  d.status ||= d.station_id && d.start_at ? 'planned' : 'request';
  d.source ||= 'crm';
  checkOverlap(d);
  const id = insert('appointments', d);
  log('appointment', id, 'create', null, s.name);
  res.json({ id });
});
crm.put('/appointments/:id', (req, res) => {
  const s = who(req, 'calendar.edit');
  const cur = one('SELECT * FROM appointments WHERE id = ?', Number(req.params.id));
  if (!cur) throw new HttpError(404, 'Запись не найдена');
  const d = apptData(req.body || {});
  if (cur.status === 'request' && (d.station_id ?? cur.station_id) && (d.start_at ?? cur.start_at) && !d.status) d.status = 'planned';
  checkOverlap({ ...cur, ...d }, cur.id);
  update('appointments', cur.id, d);
  log('appointment', cur.id, 'update', Object.keys(d), s.name);
  res.json({ ok: true });
});
crm.delete('/appointments/:id', (req, res) => {
  who(req, 'calendar.edit');
  run(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`, Number(req.params.id));
  res.json({ ok: true });
});

// ── Прайс работ ────────────────────────────────────────────────────────────
crm.get('/catalog', (req, res) => {
  who(req);
  const q = String(req.query.q || '').trim();
  res.json(q ? all('SELECT * FROM service_catalog WHERE active = 1 AND (name LIKE ? OR category LIKE ?) ORDER BY price > 0 DESC, category, name LIMIT 50', like(q), like(q))
    : all('SELECT * FROM service_catalog ORDER BY category, name LIMIT 5000'));
});
crm.post('/catalog', (req, res) => {
  who(req, 'catalog.edit');
  const b = req.body || {};
  if (!b.name) throw new HttpError(400, 'Название обязательно');
  const d = { category: b.category || null, name: b.name, unit: b.unit || 'oper', qty: Number(b.qty) || 1, price: Number(b.price) || 0, vat: Number(b.vat ?? 23),
    active: b.active === undefined ? 1 : b.active ? 1 : 0, norm_hours: b.norm_hours === '' || b.norm_hours == null ? null : Number(b.norm_hours) };
  if (b.id) update('service_catalog', Number(b.id), d); else d.id = insert('service_catalog', d);
  res.json({ ok: true });
});
/** Массово: переименовать категорию или поставить цену всем работам категории без цены */
crm.post('/catalog/bulk', (req, res) => {
  who(req, 'catalog.edit');
  const b = req.body || {};
  if (b.rename && b.category) run('UPDATE service_catalog SET category = ? WHERE category = ?', String(b.rename).trim(), b.category);
  if (b.price !== undefined && b.category) run(`UPDATE service_catalog SET price = ? WHERE category = ? AND ${b.onlyEmpty ? 'price = 0' : '1=1'}`, Number(b.price) || 0, b.category);
  if (b.active !== undefined && b.category) run('UPDATE service_catalog SET active = ? WHERE category = ?', b.active ? 1 : 0, b.category);
  res.json({ ok: true });
});
crm.delete('/catalog/:id', (req, res) => { who(req, 'catalog.edit'); run('DELETE FROM service_catalog WHERE id = ?', Number(req.params.id)); res.json({ ok: true }); });

// ── Склад ──────────────────────────────────────────────────────────────────
const reservedSql = `(SELECT COALESCE(SUM(i.qty),0) FROM order_items i JOIN orders o ON o.id = i.order_id JOIN order_statuses st ON st.id = o.status_id
  WHERE i.product_id = p.id AND st.is_final = 0 AND o.kind = 'order')`;
crm.get('/products', (req, res) => {
  who(req, 'products.view');
  const q = String(req.query.q || '').trim();
  const page = Math.max(0, Number(req.query.page) || 0);
  const cond = [req.query.archived === '1' ? 'p.active = 0' : 'p.active = 1'];
  const params = [];
  if (q) { cond.push('(p.name LIKE ? OR p.code LIKE ? OR p.manufacturer LIKE ?)'); params.push(like(q), like(q), like(q)); }
  if (req.query.low === '1') cond.push('p.min_stock > 0 AND p.stock <= p.min_stock');
  const where = `WHERE ${cond.join(' AND ')}`;
  const agg = one(`SELECT COUNT(*) n, COALESCE(SUM(stock * purchase_price),0) v FROM products p ${where}`, ...params);
  const rows = all(`SELECT p.*, ${reservedSql} reserved FROM products p ${where} ORDER BY p.name LIMIT ${PAGE} OFFSET ${page * PAGE}`, ...params);
  res.json({ rows, total: agg.n, stockValue: round2(agg.v), pageSize: PAGE });
});
const PROD_FIELDS = ['name', 'code', 'manufacturer', 'unit', 'min_stock', 'purchase_price', 'sell_price', 'vat', 'location', 'active'];
crm.post('/products', (req, res) => {
  who(req, 'products.create');
  const b = req.body || {};
  if (!b.name) throw new HttpError(400, 'Название обязательно');
  const d = {};
  for (const k of PROD_FIELDS) if (b[k] !== undefined) d[k] = b[k] === '' ? null : b[k];
  if (b.id) update('products', Number(b.id), d); else d.id = insert('products', d);
  res.json({ id: b.id || d.id });
});
crm.get('/products/:id', (req, res) => {
  who(req, 'products.view');
  const p = one(`SELECT p.*, ${reservedSql} reserved FROM products p WHERE p.id = ?`, Number(req.params.id));
  if (!p) throw new HttpError(404, 'Товар не найден');
  res.json({
    ...p,
    moves: all(`SELECT d.type, d.number, d.doc_date, d.counterparty, i.qty, i.price_net FROM stock_doc_items i JOIN stock_docs d ON d.id = i.doc_id
      WHERE i.product_id = ? ORDER BY d.id DESC LIMIT 100`, p.id),
    reservations: all(`SELECT o.id, o.number, i.qty FROM order_items i JOIN orders o ON o.id = i.order_id JOIN order_statuses st ON st.id = o.status_id
      WHERE i.product_id = ? AND st.is_final = 0 AND o.kind = 'order'`, p.id),
  });
});

crm.get('/stock-docs', (req, res) => {
  who(req, 'products.view');
  const page = Math.max(0, Number(req.query.page) || 0);
  const q = String(req.query.q || '').trim();
  const where = q ? 'WHERE number LIKE ? OR ext_number LIKE ? OR counterparty LIKE ?' : '';
  const params = q ? [like(q), like(q), like(q)] : [];
  res.json({
    rows: all(`SELECT * FROM stock_docs ${where} ORDER BY id DESC LIMIT ${PAGE} OFFSET ${page * PAGE}`, ...params),
    total: one(`SELECT COUNT(*) n FROM stock_docs ${where}`, ...params).n, pageSize: PAGE,
  });
});
crm.get('/stock-docs/:id', (req, res) => {
  who(req, 'products.view');
  const d = one('SELECT * FROM stock_docs WHERE id = ?', Number(req.params.id));
  if (!d) throw new HttpError(404, 'Документ не найден');
  res.json({ ...d, items: all('SELECT i.*, p.name, p.code, p.unit FROM stock_doc_items i JOIN products p ON p.id = i.product_id WHERE doc_id = ?', d.id) });
});
// PZ — приход от поставщика, RW — списание, PW — оприходование (излишки)
crm.post('/stock-docs', (req, res) => {
  const s = who(req, 'stock.docs');
  res.json({ id: createStockDoc(req.body || {}, s.name) });
});

// приход из файла любого поставщика (Auto Partner, Inter Team, Hart…): разбор CSV/XLSX → позиции для проверки
crm.post('/stock-docs/parse-file', upload.single('file'), (req, res) => {
  who(req, 'stock.docs');
  if (!req.file) throw new HttpError(400, 'Выберите файл');
  const rows = readRows(req.file.buffer);
  if (!rows.length) throw new HttpError(400, 'Файл пустой');
  if (req.query.generic) return res.json(SUP.rowsToLines(rows));
  const H = Object.keys(rows[0]);
  const find = (...names) => H.find((h) => names.some((n) => h.toLowerCase().replace(/\s+/g, ' ').trim() === n));
  const col = {
    code: find('indeks', 'index', 'kod', 'kod towaru', 'numer katalogowy', 'nr katalogowy', 'symbol', 'артикул', 'индекс'),
    name: find('nazwa', 'nazwa towaru', 'towar', 'opis', 'name', 'название', 'товар'),
    qty: find('ilość', 'ilosc', 'ilość sztuk', 'szt', 'qty', 'quantity', 'кол-во', 'количество'),
    price: find('cena netto', 'cena jedn. netto', 'cena jednostkowa netto', 'cena', 'netto', 'price', 'цена'),
    ean: find('ean', 'kod ean', 'ean13'),
    brand: find('producent', 'marka', 'brand', 'производитель'),
  };
  if (!col.name && !col.code) throw new HttpError(400, 'Не нашёл колонки с названием или индексом товара. Колонки в файле: ' + H.join(', '));
  const num = (v) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const items = rows.map((r) => {
    const code = String(r[col.code] ?? '').trim() || null;
    const ex = code ? one(`SELECT id, name, sell_price FROM products WHERE code = ?`, code) : null;
    return {
      product_id: ex?.id || null, name: String(r[col.name] ?? '').trim() || ex?.name || code, code, ean: col.ean ? String(r[col.ean] ?? '').trim() || null : null,
      manufacturer: col.brand ? String(r[col.brand] ?? '').trim() || null : null, qty: col.qty ? num(r[col.qty]) : 1, price_net: col.price ? num(r[col.price]) : 0,
      sell_price: ex?.sell_price || 0, isNew: !ex,
    };
  }).filter((i) => i.name && i.qty > 0);
  res.json({ items, columns: col });
});

// инвентаризация одного товара: фактический остаток → документ PW/RW на разницу
crm.post('/products/:id/inventory', (req, res) => {
  const s = who(req, 'stock.docs');
  const p = one('SELECT * FROM products WHERE id = ?', Number(req.params.id));
  if (!p) throw new HttpError(404, 'Товар не найден');
  const counted = Number(req.body?.counted);
  if (!(counted >= 0)) throw new HttpError(400, 'Укажите фактическое количество');
  const diff = round2(counted - p.stock);
  if (!diff) return res.json({ ok: true, diff: 0 });
  const type = diff > 0 ? 'PW' : 'RW';
  tx(() => {
    const docId = insert('stock_docs', { type, number: nextNumber(type), doc_date: today(), note: 'Inwentaryzacja', created_by: s.name, total_net: round2(Math.abs(diff) * p.purchase_price) });
    run('INSERT INTO stock_doc_items (doc_id, product_id, qty, price_net) VALUES (?, ?, ?, ?)', docId, p.id, Math.abs(diff), p.purchase_price);
    run('UPDATE products SET stock = ? WHERE id = ?', counted, p.id);
  });
  res.json({ ok: true, diff });
});

// ── Закупки ────────────────────────────────────────────────────────────────
crm.get('/purchases', (req, res) => {
  who(req, 'purchases.view');
  const q = String(req.query.q || '').trim();
  const where = q ? 'WHERE supplier LIKE ? OR number LIKE ? OR category LIKE ?' : '';
  const params = q ? [like(q), like(q), like(q)] : [];
  res.json({
    rows: all(`SELECT * FROM purchases ${where} ORDER BY COALESCE(doc_date, created_at) DESC, id DESC LIMIT 200`, ...params),
    totals: one(`SELECT COALESCE(SUM(gross),0) gross, COALESCE(SUM(gross - paid),0) due FROM purchases ${where}`, ...params),
  });
});
crm.post('/purchases', (req, res) => {
  who(req, 'purchases.edit');
  const b = req.body || {};
  if (!b.supplier) throw new HttpError(400, 'Укажите поставщика');
  const d = {
    supplier: b.supplier, number: b.number || null, category: b.category || null, description: b.description || null,
    doc_date: b.doc_date || today(), due_date: b.due_date || null, net: round2(b.net), gross: round2(b.gross || b.net * 1.23), paid: round2(b.paid),
  };
  if (b.id) update('purchases', Number(b.id), d); else insert('purchases', d);
  res.json({ ok: true });
});
crm.delete('/purchases/:id', (req, res) => { who(req, 'purchases.edit'); run('DELETE FROM purchases WHERE id = ?', Number(req.params.id)); res.json({ ok: true }); });

// ── Хранение шин ───────────────────────────────────────────────────────────
crm.get('/storage', (req, res) => {
  who(req, 'storage.view');
  const q = String(req.query.q || '').trim();
  const cond = [req.query.all === '1' ? '1=1' : 's.date_out IS NULL'];
  const params = [];
  if (q) { const pl = normPlate(q); cond.push('(s.number LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR k.plate LIKE ? OR s.description LIKE ? OR s.location LIKE ?)'); params.push(like(q), like(q), like(q.replace(/\D/g, '') || q), `%${pl}%`, like(q), like(q)); }
  res.json(all(`SELECT s.*, c.name customer_name, c.phone customer_phone, k.plate, k.make, k.model FROM storage s
    LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN cars k ON k.id = s.car_id WHERE ${cond.join(' AND ')} ORDER BY s.id DESC LIMIT 300`, ...params));
});
crm.post('/storage', (req, res) => {
  const s = who(req, 'storage.edit');
  const b = req.body || {};
  const d = {
    customer_id: b.customer_id || null, car_id: b.car_id || null, kind: b.kind || 'opony', description: b.description || null,
    qty: Number(b.qty) || 4, location: b.location || null, date_in: b.date_in || today(), date_until: b.date_until || null,
    price: round2(b.price), note: b.note || null,
  };
  if (!['opony', 'koła', 'parking'].includes(d.kind)) d.kind = 'opony';
  if (d.kind === 'parking') d.qty = 1;
  if (!d.customer_id) throw new HttpError(400, 'Выберите клиента');
  let id = Number(b.id);
  if (id) update('storage', id, d); else id = insert('storage', { ...d, number: nextNumber('PR', new Date(), true) });
  log('storage', id, b.id ? 'update' : 'create', null, s.name);
  res.json({ id });
});
/** Оплата хранения / парковки: приход в кассу (KP) и отметка на записи */
crm.post('/storage/:id/pay', (req, res) => {
  const s = who(req, 'storage.edit');
  const st = one('SELECT * FROM storage WHERE id = ?', Number(req.params.id));
  if (!st) throw new HttpError(404, 'Запись не найдена');
  const amount = round2(req.body?.amount);
  if (!(amount > 0)) throw new HttpError(400, 'Укажите сумму');
  const method = PAY_METHODS.includes(req.body?.method) ? req.body.method : 'cash';
  const what = st.kind === 'parking' ? 'Parking' : 'Przechowanie opon';
  tx(() => {
    insert('payments', { number: method === 'cash' ? nextNumber('KP') : null, direction: 'in', method, amount, note: `${what} ${st.number}`, staff: s.name, customer_id: st.customer_id || null });
    run('UPDATE storage SET paid = ROUND(COALESCE(paid,0) + ?, 2) WHERE id = ?', amount, st.id);
  });
  log('storage', st.id, 'payment', `${amount} ${method}`, s.name);
  res.json({ ok: true });
});
crm.post('/storage/:id/release', (req, res) => {
  const s = who(req, 'storage.edit');
  run('UPDATE storage SET date_out = ? WHERE id = ?', req.body?.date || today(), Number(req.params.id));
  log('storage', Number(req.params.id), 'release', null, s.name);
  res.json({ ok: true });
});

// ── Касса ──────────────────────────────────────────────────────────────────
const registers = () => all(`SELECT r.*, ROUND(r.opening + COALESCE((SELECT SUM(CASE WHEN direction='in' THEN amount ELSE -amount END) FROM payments p WHERE p.register_id = r.id),0),2) balance
  FROM cash_registers r ORDER BY r.active DESC, r.pos, r.id`);
crm.get('/cash', (req, res) => {
  who(req, 'cash.view');
  const from = String(req.query.from || today().slice(0, 8) + '01');
  const to = String(req.query.to || today());
  const reg = Number(req.query.register) || null;
  const rows = all(`SELECT p.*, o.number order_number, c.name customer_name, r.name register_name FROM payments p LEFT JOIN orders o ON o.id = p.order_id
    LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN cash_registers r ON r.id = p.register_id
    WHERE substr(p.created_at,1,10) BETWEEN ? AND ? ${reg ? 'AND p.register_id = ?' : ''} ORDER BY p.id DESC LIMIT 2000`, ...[from, to, ...(reg ? [reg] : [])]);
  const sum = (dir, method) => one(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE direction = ? AND transfer_id IS NULL ${method ? 'AND method = ?' : ''} AND substr(created_at,1,10) BETWEEN ? AND ?`,
    ...[dir, ...(method ? [method] : []), from, to]).s;
  const regs = registers();
  res.json({
    rows, registers: regs,
    cashBalance: round2(regs.filter((r) => r.kind === 'cash').reduce((a, r) => a + r.balance, 0)),
    period: { cashIn: sum('in', 'cash'), cashOut: sum('out', 'cash'), card: sum('in', 'card'), blik: sum('in', 'blik'), transfer: sum('in', 'transfer'), points: sum('in', 'points') },
  });
});
crm.post('/cash', (req, res) => {
  const s = who(req, 'cash.edit');
  const direction = req.body?.direction === 'out' ? 'out' : 'in';
  const amount = round2(req.body?.amount);
  if (!(amount > 0)) throw new HttpError(400, 'Укажите сумму');
  const note = String(req.body?.note || '').trim();
  if (!note) throw new HttpError(400, 'Укажите назначение');
  const r = req.body?.register_id ? one('SELECT * FROM cash_registers WHERE id = ? AND active = 1', Number(req.body.register_id)) : one(`SELECT * FROM cash_registers WHERE kind = 'cash' AND active = 1 ORDER BY is_default DESC, pos LIMIT 1`);
  if (!r) throw new HttpError(400, 'Касса не найдена');
  const method = r.kind === 'cash' ? 'cash' : r.kind === 'card' ? 'card' : 'transfer';
  insert('payments', { number: nextNumber(direction === 'in' ? 'KP' : 'KW'), direction, method, amount, note, staff: s.name, customer_id: req.body?.customer_id || null, register_id: r.id });
  res.json({ ok: true });
});
/** Перенос денег между кассами: KW в одной, KP в другой (не выручка и не расход) */
crm.post('/cash/transfer', (req, res) => {
  const s = who(req, 'cash.edit');
  const b = req.body || {};
  const amount = round2(b.amount);
  const from = one('SELECT * FROM cash_registers WHERE id = ? AND active = 1', Number(b.from));
  const to = one('SELECT * FROM cash_registers WHERE id = ? AND active = 1', Number(b.to));
  if (!from || !to || from.id === to.id) throw new HttpError(400, 'Выберите две разные кассы');
  if (!(amount > 0)) throw new HttpError(400, 'Укажите сумму');
  const m = (r) => (r.kind === 'cash' ? 'cash' : r.kind === 'card' ? 'card' : 'transfer');
  const note = String(b.note || '').trim() || `Przeniesienie: ${from.name} → ${to.name}`;
  const out = tx(() => {
    const idOut = insert('payments', { number: nextNumber('KW'), direction: 'out', method: m(from), amount, note, staff: s.name, register_id: from.id });
    const idIn = insert('payments', { number: nextNumber('KP'), direction: 'in', method: m(to), amount, note, staff: s.name, register_id: to.id, transfer_id: idOut });
    run('UPDATE payments SET transfer_id = ? WHERE id = ?', idIn, idOut);
    return { out: idOut, in: idIn };
  });
  res.json({ ok: true, ...out });
});
crm.get('/cash/registers', (req, res) => { who(req, 'cash.view'); res.json(registers()); });
/** Документ кассы (KP / KW / оплата картой): откуда деньги, комментарий, печать, удаление */
crm.get('/cash/:id', (req, res) => {
  who(req, 'cash.view');
  const p = one(`SELECT p.*, r.name register_name, r.kind register_kind, c.name customer_name, c.phone customer_phone, o.number order_number, o.kind order_kind,
      st.name order_status, st.is_final order_final, t.number pair_number, tr.name pair_register
    FROM payments p LEFT JOIN cash_registers r ON r.id = p.register_id LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN orders o ON o.id = p.order_id
    LEFT JOIN order_statuses st ON st.id = o.status_id LEFT JOIN payments t ON t.id = p.transfer_id LEFT JOIN cash_registers tr ON tr.id = t.register_id WHERE p.id = ?`, Number(req.params.id));
  if (!p) throw new HttpError(404, 'Документ не найден');
  const storage = /^(Парковка|Хранение шин|Parking|Przechowanie opon) (\S+)/.exec(p.note || '');
  const st = storage ? one('SELECT id, number, kind FROM storage WHERE number = ?', storage[2]) : null;
  const source = p.transfer_id ? 'transfer' : p.order_id ? 'order' : st ? 'storage' : p.direction === 'in' ? 'income' : 'expense';
  res.json({ ...p, source, storage: st });
});
crm.put('/cash/:id', (req, res) => {
  const s = who(req, 'cash.edit');
  const p = one('SELECT * FROM payments WHERE id = ?', Number(req.params.id));
  if (!p) throw new HttpError(404, 'Документ не найден');
  const note = String(req.body?.note ?? '').trim().slice(0, 500);
  if (!note) throw new HttpError(400, 'Напишите назначение / комментарий');
  run('UPDATE payments SET note = ? WHERE id = ?', note, p.id);
  log('payment', p.id, 'update', { note }, s.name);
  res.json({ ok: true });
});
/** Удалить документ кассы (только администратор): оплата заказа — сумма заказа пересчитывается, перенос — удаляются обе части */
crm.delete('/cash/:id', (req, res) => {
  const s = who(req, 'admin');
  const p = one('SELECT * FROM payments WHERE id = ?', Number(req.params.id));
  if (!p) throw new HttpError(404, 'Документ не найден');
  if (p.method === 'points') throw new HttpError(400, 'Списание баллов отменяется корректировкой баллов у клиента');
  const storage = /^(Парковка|Хранение шин|Parking|Przechowanie opon) (\S+)/.exec(p.note || '');
  tx(() => {
    run('DELETE FROM payments WHERE id = ? OR (id = ? AND ? IS NOT NULL)', p.id, p.transfer_id || -1, p.transfer_id);
    if (p.order_id) recalc(p.order_id);
    if (storage && p.direction === 'in') run('UPDATE storage SET paid = MAX(0, ROUND(COALESCE(paid,0) - ?, 2)) WHERE number = ?', p.amount, storage[2]);
  });
  if (p.order_id) log('order', p.order_id, 'payment_delete', { amount: p.amount, number: p.number }, s.name);
  log('payment', p.id, 'delete', { number: p.number, amount: p.amount, direction: p.direction, note: p.note }, s.name);
  res.json({ ok: true });
});
crm.post('/cash/registers', (req, res) => {
  who(req, 'settings.manage');
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) throw new HttpError(400, 'Название кассы обязательно');
  const kind = ['cash', 'card', 'bank'].includes(b.kind) ? b.kind : 'cash';
  const row = { name, kind, opening: round2(b.opening || 0), active: b.active === false || b.active === 0 ? 0 : 1, pos: Number(b.pos) || 0 };
  let id = Number(b.id) || null;
  if (id) update('cash_registers', id, row); else id = insert('cash_registers', row);
  if (b.is_default) { run('UPDATE cash_registers SET is_default = 0 WHERE kind = ?', kind); run('UPDATE cash_registers SET is_default = 1 WHERE id = ?', id); }
  res.json({ ok: true, id });
});

// ── Фискальная касса: чек из заказа → задание для расширения → результат ─────
crm.post('/orders/:id/receipt', (req, res) => {
  const s = who(req, 'orders.payments');
  const o = getOrder(Number(req.params.id));
  const method = PAY_METHODS.includes(req.body?.method) ? req.body.method : null;
  const nip = String(req.body?.nip || '').replace(/\D/g, '');
  if (nip && nip.length !== 10) throw new HttpError(400, 'NIP — 10 цифр');
  const r = FISCAL.createReceipt(o, { nip: nip || null, method }, s.name);
  log('order', o.id, 'receipt', { id: r.receipt.id, total: r.receipt.total }, s.name);
  res.json(r);
});
crm.get('/receipts/:id/job', (req, res) => {
  who(req, 'orders.payments');
  const r = one('SELECT * FROM receipts WHERE id = ?', Number(req.params.id));
  if (!r) throw new HttpError(404, 'Чек не найден');
  res.json({ receipt: FISCAL.publicReceipt(r), job: r.status === 'printed' ? null : FISCAL.jobFor(r) });
});
crm.post('/receipts/:id/result', (req, res) => {
  const s = who(req, 'orders.payments');
  const r = FISCAL.saveResult(Number(req.params.id), req.body || {});
  if (r.order_id) log('order', r.order_id, r.status === 'printed' ? 'receipt_printed' : 'receipt_error', { number: r.number, error: r.error }, s.name);
  res.json({ receipt: r });
});
crm.post('/receipts/:id/manual', (req, res) => {
  const s = who(req, 'orders.payments');
  const r = FISCAL.setManual(Number(req.params.id), req.body?.number);
  if (r.order_id) log('order', r.order_id, 'receipt_printed', { number: r.number, manual: true }, s.name);
  res.json({ receipt: r });
});
crm.get('/fiscal/daily-job', (req, res) => { who(req, 'cash.edit'); res.json({ job: FISCAL.dailyJob(String(req.query.date || '')) }); });
crm.get('/fiscal/ping-job', (req, res) => {
  who(req, 'orders.payments');
  const c = FISCAL.fiscalCfg();
  if (!c || c.driver !== 'novitus') throw new HttpError(400, 'Касса Novitus не настроена');
  res.json({ job: { driver: 'novitus', url: c.url, resource: 'ping' } });
});

// ── Рапорты (как Raporty в Motowarsztat) ─────────────────────────────────────
crm.get('/reports/list', (req, res) => { who(req, 'reports.view'); res.json({ reports: RPT.reportList() }); });
crm.get('/reports/run/:id', (req, res) => {
  who(req, 'reports.view');
  const rep = RPT.localize(RPT.runReport(req.params.id, req.query), req.query.format ? String(req.query.lang || '') : '');
  const fname = `raport-${req.params.id}-${req.query.from || ''}_${req.query.to || ''}`.replace(/[^\w.-]+/g, '_').replace(/_+$/, '');
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.csv"`);
    return res.send(RPT.toCsv(rep));
  }
  if (req.query.format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.xlsx"`);
    return res.send(RPT.toXlsx(rep));
  }
  if (req.query.format === 'print') return res.type('html').send(RPT.toHtml(rep, DOC.settingsMap(), req.query));
  res.json(rep);
});

// ── Отчёты ─────────────────────────────────────────────────────────────────
crm.get('/reports', (req, res) => {
  who(req, 'reports.view');
  const from = String(req.query.from || today().slice(0, 8) + '01');
  const to = String(req.query.to || today());
  const closed = `o.kind = 'order' AND o.closed_at IS NOT NULL AND substr(o.closed_at,1,10) BETWEEN ? AND ?`;
  const summary = one(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) revenue, COALESCE(SUM(total_net),0) net, COALESCE(SUM(cost),0) parts_cost FROM orders o WHERE ${closed}`, from, to);
  const labor = one(`SELECT COALESCE(SUM(i.qty*i.price*(1-i.discount/100.0)),0) s FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.kind='labor' AND ${closed}`, from, to).s;
  const parts = one(`SELECT COALESCE(SUM(i.qty*i.price*(1-i.discount/100.0)),0) s FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.kind='part' AND ${closed}`, from, to).s;
  res.json({
    from, to,
    summary: { ...summary, labor: round2(labor), parts: round2(parts), partsMargin: round2(parts / 1.23 - summary.parts_cost), avgOrder: summary.orders ? round2(summary.revenue / summary.orders) : 0 },
    byDay: all(`SELECT substr(o.closed_at,1,10) day, COUNT(*) n, ROUND(SUM(total),2) revenue FROM orders o WHERE ${closed} GROUP BY day ORDER BY day`, from, to),
    // зарплата механиков: % от работ (нетто), где механик указан в позиции (или по заказу)
    mechanics: all(`SELECT s.id, s.name, s.commission_pct, s.hourly_rate, COUNT(DISTINCT o.id) orders,
        ROUND(SUM(i.qty*i.price*(1-i.discount/100.0)/(1+i.vat/100.0)),2) labor_net, ROUND(SUM(i.qty),2) hours
      FROM order_items i JOIN orders o ON o.id = i.order_id JOIN staff s ON s.id = COALESCE(i.mechanic_id, o.mechanic_id)
      WHERE i.kind = 'labor' AND ${closed} GROUP BY s.id ORDER BY labor_net DESC`, from, to)
      .map((m) => ({ ...m, commission: round2(m.labor_net * m.commission_pct / 100) })),
    bySource: all(`SELECT COALESCE(t.name, '— не указан') source, COUNT(*) n, ROUND(SUM(o.total),2) revenue FROM orders o LEFT JOIN order_types t ON t.id = o.type_id
      WHERE ${closed} GROUP BY t.id ORDER BY revenue DESC`, from, to),
    topServices: all(`SELECT i.name, COUNT(*) n, ROUND(SUM(i.qty*i.price*(1-i.discount/100.0)),2) revenue FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE i.kind='labor' AND ${closed} GROUP BY lower(i.name) ORDER BY revenue DESC LIMIT 15`, from, to),
    payments: all(`SELECT method, direction, ROUND(SUM(amount),2) s FROM payments WHERE substr(created_at,1,10) BETWEEN ? AND ? GROUP BY method, direction`, from, to),
    newCustomers: one(`SELECT COUNT(*) n FROM customers WHERE substr(created_at,1,10) BETWEEN ? AND ?`, from, to).n,
    appUsers: one('SELECT COUNT(*) n FROM customers WHERE registered_at IS NOT NULL').n,
    purchases: one(`SELECT COALESCE(SUM(net),0) net, COALESCE(SUM(gross),0) gross FROM purchases WHERE doc_date BETWEEN ? AND ?`, from, to),
  });
});

// ── Расширение Chrome «Pulsecar для поставщиков» ──────────────────────────────
// ── Мой аккаунт: свои данные и пароль ───────────────────────────────────────
crm.put('/me', (req, res) => {
  const s = who(req);
  const b = req.body || {};
  const d = {};
  if (b.name !== undefined) { if (!String(b.name).trim()) throw new HttpError(400, 'Имя обязательно'); d.name = String(b.name).trim().slice(0, 80); }
  if (b.phone !== undefined) d.phone = String(b.phone || '').trim() || null;
  if (b.email !== undefined) d.email = String(b.email || '').trim() || null;
  if (b.new_password) {
    const me = one('SELECT pass_hash FROM staff WHERE id = ?', s.id);
    if (me.pass_hash && !checkPassword(String(b.current_password || ''), me.pass_hash)) throw new HttpError(400, 'Текущий пароль неверный');
    if (String(b.new_password).length < 8) throw new HttpError(400, 'Пароль — минимум 8 символов');
    d.pass_hash = hashPassword(String(b.new_password));
  }
  if (Object.keys(d).length) update('staff', s.id, d);
  log('staff', s.id, 'self_update', Object.keys(d).filter((k) => k !== 'pass_hash').concat(d.pass_hash ? ['password'] : []), s.name);
  res.json({ ok: true });
});
// ── Журнал изменений ────────────────────────────────────────────────────────
crm.get('/audit', (req, res) => {
  const me = who(req);
  // своя история объекта (заказ, клиент, авто) доступна всем, кто видит объект; общий журнал — по праву audit.view
  const own = req.query.entity && req.query.id && ['orders', 'customers', 'cars'].includes(req.query.entity);
  if (!own && !can(me, 'audit.view')) throw new HttpError(403, 'Недостаточно прав: журнал изменений');
  res.json({ ...listAudit(req.query), entities: entityList(), staff: all('SELECT id, name FROM staff ORDER BY name') });
});

// ── Запланированные напоминания (SMS о визите) ──────────────────────────────
crm.get('/reminders', (req, res) => {
  who(req, 'sms.view');
  const S = (k, d) => getSetting(k, d);
  const on = S('sms_remind_on', '1') === '1' && !!S('sms_tpl_reminder');
  const hours = Number(S('sms_remind_hours', '24')) || 24;
  const rows = all(`SELECT a.id, a.start_at, a.status, a.reminded, a.order_id, a.customer_id, a.title, a.contact_phone a_phone, a.contact_name a_name, c.name cname, c.company, c.kind, c.phone cphone,
      k.plate, k.make, k.model, o.number order_no, st.name station
    FROM appointments a LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN cars k ON k.id = a.car_id LEFT JOIN orders o ON o.id = a.order_id LEFT JOIN stations st ON st.id = a.station_id
    WHERE a.start_at IS NOT NULL AND a.start_at >= datetime('now', 'localtime', '-2 days') AND a.status IN ('planned', 'request') ORDER BY a.start_at LIMIT 300`)
    .map((a) => {
      const phone = a.cphone || a.a_phone || null;
      const at = new Date(new Date(a.start_at.replace(' ', 'T')).getTime() - hours * 3600e3);
      const sendAt = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
      const state = a.reminded ? 'sent' : !on ? 'off' : !phone ? 'no_phone' : a.status !== 'planned' ? 'request' : 'planned';
      return { ...a, phone, send_at: sendAt, state };
    });
  const sent = all(`SELECT id, phone, text, status, created_at, customer_id, order_id FROM sms_log WHERE kind = 'reminder' ORDER BY id DESC LIMIT 50`);
  res.json({ on, hours, rows, sent });
});

crm.post('/me/ext-token', (req, res) => {
  const s = who(req);
  const token = 'pcx_' + crypto.randomBytes(24).toString('base64url');
  run('UPDATE staff SET ext_token = ? WHERE id = ?', sha(token), s.id);
  res.json({ token, panel: config.publicUrl });
});
crm.delete('/me/ext-token', (req, res) => { const s = who(req); run('UPDATE staff SET ext_token = NULL WHERE id = ?', s.id); res.json({ ok: true }); });
// версия расширения, которую раздаёт CRM (файл пишет tools/pack-extension.py вместе с архивом)
let extInfo = { at: 0 };
function extLatest() {
  if (Date.now() - extInfo.at > 60_000) {
    try { extInfo = { ...JSON.parse(fs.readFileSync(new URL('../public/pulsecar-extension.json', import.meta.url), 'utf8')), at: Date.now() }; }
    catch { extInfo = { version: null, at: Date.now() }; }
  }
  return extInfo.version;
}
/** Без входа: какая версия расширения последняя (окно расширения проверяет обновления) */
crm.get('/ext/version', (_req, res) => res.json({ version: extLatest(), download: '/pulsecar-extension.zip' }));
crm.get('/ext/hello', (req, res) => {
  const s = who(req);
  const P = permsOf(s);
  res.json({
    name: s.name, role: s.role, brand: getSetting('company_brand', 'Pulsecar'), company: getSetting('company_name', ''), nip: getSetting('company_nip', ''),
    latest: extLatest(), panel: config.publicUrl,
    can: { stock: P['stock.docs'] || P['suppliers.receive'], product: P['products.create'], order: P['orders.jobs'], quote: P['quotes.manage'], docs: P['suppliers.receive'] || P['stock.docs'] },
    markup: Number(getSetting('default_markup', '40')) || 0,
  });
});
/** Открытые заказы и выцены для выпадающих списков расширения */
crm.get('/ext/orders', (req, res) => {
  const s = who(req, 'orders.view');
  const P = permsOf(s);
  const rows = all(`SELECT o.id, o.kind, o.number, c.name cname, k.make, k.model, k.plate FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN cars k ON k.id = o.car_id LEFT JOIN order_statuses st ON st.id = o.status_id WHERE COALESCE(st.is_final,0) = 0 ORDER BY o.id DESC LIMIT 300`);
  res.json({ orders: rows.filter((r) => r.kind === 'order'), quotes: P['quotes.manage'] ? rows.filter((r) => r.kind === 'quote') : [] });
});
/** Уточнить цены через API поставщика (Inter Cars: ваша цена и рекомендованная розничная) и найти товар на складе */
crm.post('/ext/prepare', async (req, res) => {
  who(req, 'products.view');
  const items = (req.body?.items || []).slice(0, 100);
  const out = [];
  for (const it of items) {
    const x = { ...it };
    if (it.supplier === 'intercars' && cfg('intercars') && (it.code || it.sku)) {
      try {
        const r = (await IC.search(it.code || it.sku)).find((z) => !it.sku || z.sku === it.sku) || null;
        if (r) { x.price_net = r.priceNet || x.price_net; x.sell_gross = r.listGross || x.sell_gross || r.sellSuggested; x.sku = r.sku; x.ean ??= r.ean; x.source = 'api'; }
      } catch {}
    }
    const code = String(x.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    x.product = (x.sku && one('SELECT id, name, stock, sell_price, purchase_price FROM products WHERE supplier_sku = ?', x.sku))
      || (code && one(`SELECT id, name, stock, sell_price, purchase_price FROM products WHERE upper(replace(replace(replace(replace(code,' ',''),'.',''),'-',''),'/','')) = ?`, code)) || null;
    out.push(x);
  }
  res.json({ items: out });
});
/** «Pobierz do Pulsecar»: товар в картотеку, приход на склад, в заказ, в выцену — одной кнопкой */
crm.post('/ext/pick', async (req, res) => {
  const s = who(req, 'products.view');
  const P = permsOf(s);
  const b = req.body || {};
  const sup = SUP.wholesaler(b.supplier || 'other');
  const items = (b.items || []).map((i) => ({
    name: String(i.name || i.code || '').trim().slice(0, 250), code: i.code ? String(i.code).trim().slice(0, 60) : null, brand: i.brand ? String(i.brand).slice(0, 80) : null,
    sku: i.sku || null, ean: i.ean || null, qty: Math.max(0.01, Number(i.qty) || 1), price_net: round2(Number(i.price_net) || 0), sell_gross: round2(Number(i.sell_gross) || 0), vat: Number(i.vat ?? 23),
  })).filter((i) => i.name);
  if (!items.length) throw new HttpError(400, 'Нет товаров');
  if (!b.product && !b.stock && !b.order_id && !b.quote_id) throw new HttpError(400, 'Выберите, куда добавить: склад, заказ или выцена');
  // товар уже есть в картотеке — берём его цены, если со страницы они не прочитались
  for (const i of items) {
    if (i.price_net > 0 && i.sell_gross > 0) continue;
    const p = (i.sku && one('SELECT purchase_price, sell_price FROM products WHERE supplier_sku = ?', i.sku)) || (i.code && one('SELECT purchase_price, sell_price FROM products WHERE code = ?', i.code));
    if (p) { i.price_net ||= Number(p.purchase_price) || 0; i.sell_gross ||= Number(p.sell_price) || 0; }
  }
  const ver = String(req.headers['x-pulsecar-ext'] || '0');
  const old = ver.split('.').map(Number).reduce((a, n, k) => a + (n || 0) * [10000, 100, 1][k], 0) < 10201;
  if ((b.order_id || b.quote_id) && items.every((i) => !(i.price_net > 0) && !(i.sell_gross > 0))) {
    throw new HttpError(400, old
      ? `Цены со страницы не прочитались — у вас старая версия расширения (${ver === '0' ? 'до 1.1' : ver}). Обновите до 1.2.1: CRM → Склад → Поставщики → «Скачать расширение», распакуйте поверх старой папки и нажмите ⟳ в chrome://extensions.`
      : 'Цены со страницы не прочитались — впишите закупку и продажу в окне вручную.');
  }
  if (b.stock && !(P['stock.docs'] || P['suppliers.receive'])) throw new HttpError(403, 'Нет права на приход на склад');
  if (b.order_id && !P['orders.jobs']) throw new HttpError(403, 'Нет права добавлять запчасти в заказ');
  if (b.quote_id && !P['quotes.manage']) throw new HttpError(403, 'Нет права менять выцены');
  const bad = items.filter((i) => (b.stock || b.product) && i.price_net <= 0);
  if (bad.length && b.stock) throw new HttpError(400, `Цена закупки должна быть больше 0: ${bad.map((i) => i.code || i.name).join(', ')}`);
  await polishNames(items, sup.key);
  const done = { products: 0, stock: null, order: null, quote: null };
  tx(() => {
    const pids = items.map((i) => {
      if (!(b.product || b.stock || b.order_id)) return null;
      const pid = findOrCreateProduct({ name: i.name, code: i.code, manufacturer: i.brand, supplier_sku: i.sku, ean: i.ean, supplier: sup.name, sell_price: i.sell_gross, price_net: i.price_net });
      // цена продажи = рекомендованная поставщиком, закупка = цена для сервиса
      if (i.sell_gross > 0) run('UPDATE products SET sell_price = ? WHERE id = ?', i.sell_gross, pid);
      if (i.price_net > 0) run('UPDATE products SET purchase_price = ? WHERE id = ?', i.price_net, pid);
      done.products++;
      return pid;
    });
    if (b.stock) {
      const docId = createStockDoc({ type: 'PZ', counterparty: sup.name, ext_number: b.ext_number || null, note: `${sup.name}: dodano przyciskiem na stronie dostawcy`,
        items: items.map((i, n) => ({ product_id: pids[n], qty: i.qty, price_net: i.price_net })) }, s.name);
      done.stock = one('SELECT number FROM stock_docs WHERE id = ?', docId).number;
    }
    for (const [key, id] of [['order', b.order_id], ['quote', b.quote_id]]) {
      if (!id) continue;
      const o = getOrder(Number(id));
      if ((key === 'order') !== (o.kind === 'order')) throw new HttpError(400, 'Выбран не тот документ');
      assertEditable(o, s);
      items.forEach((i, n) => addItem(o.id, { kind: 'part', name: i.name, code: i.code, product_id: key === 'order' ? pids[n] || undefined : undefined, qty: i.qty,
        price: i.sell_gross || SUP.sellFrom({ price_net: i.price_net, vat: i.vat }), cost: i.price_net, vat: i.vat, unit: 'szt.' }));
      recalc(o.id);
      log('order', o.id, 'update', `Из ${sup.name}: ${items.map((i) => i.code || i.name).join(', ')}`, s.name);
      done[key] = o.number;
    }
  });
  res.json({ ok: true, ...done });
});

// ── TecRMI: нормы времени на работы для авто заказа ─────────────────────────
const rmiCar = (orderId) => {
  const o = getOrder(Number(orderId));
  const car = o.car_id && one('SELECT * FROM cars WHERE id = ?', o.car_id);
  if (!car) throw new HttpError(400, 'В заказе не выбран автомобиль');
  return { o, car };
};
/** Тип авто в TecRMI: сохранённый или варианты для выбора (один вариант — сохраняем сразу) */
crm.get('/tecrmi/vehicle', async (req, res) => {
  who(req, 'orders.view');
  const { car } = rmiCar(req.query.order_id);
  if (car.tecrmi_type_id && req.query.reset !== '1') return res.json({ type: { TypeId: car.tecrmi_type_id, name: car.tecrmi_type_name }, car: { id: car.id, make: car.make, model: car.model, year: car.year, power_kw: car.power_kw, vin: car.vin } });
  const r = await RMI.vehicleCandidates(car);
  if (r.candidates.length === 1 && req.query.reset !== '1') {
    run('UPDATE cars SET tecrmi_type_id = ?, tecrmi_type_name = ? WHERE id = ?', r.candidates[0].TypeId, r.candidates[0].name, car.id);
    return res.json({ type: r.candidates[0], auto: true });
  }
  res.json({ ...r, car: { id: car.id, make: car.make, model: car.model, year: car.year, power_kw: car.power_kw, capacity: car.capacity, engine: car.engine, vin: car.vin } });
});
crm.get('/tecrmi/ranges/:makeId', async (req, res) => { who(req, 'orders.view'); res.json(await RMI.ranges(req.params.makeId)); });
crm.get('/tecrmi/types/:rangeId', async (req, res) => { who(req, 'orders.view'); res.json(await RMI.types(req.params.rangeId, req.query.make || '', req.query.range || '')); });
crm.post('/tecrmi/vehicle', (req, res) => {
  who(req, 'orders.jobs');
  const { car } = rmiCar(req.body?.order_id);
  const id = Number(req.body?.TypeId);
  if (!id) throw new HttpError(400, 'Выберите тип авто');
  run('UPDATE cars SET tecrmi_type_id = ?, tecrmi_type_name = ? WHERE id = ?', id, String(req.body?.name || '').slice(0, 200) || null, car.id);
  res.json({ ok: true });
});
/** Поиск работы TecRMI для авто заказа */
crm.get('/tecrmi/works', async (req, res) => {
  who(req, 'orders.view');
  const { car } = rmiCar(req.query.order_id);
  if (!car.tecrmi_type_id) throw new HttpError(400, 'Сначала выберите тип авто в TecRMI');
  // каталог TecRMI польский: «Замена генератора» → ищем «Alternator» (узел без глагола)
  const q0 = String(req.query.q || '').trim();
  let q = hasCyr(q0) ? glossaryPl(q0).split(/\s+/).filter((w) => !hasCyr(w)).join(' ') : q0;
  q = q.replace(/\b(wymiana|naprawa|demontaż|montaż|regulacja|sprawdzenie|replace|replacement)\b/gi, '').replace(/\s+/g, ' ').trim() || q0;
  const r = await RMI.searchWorks(car.tecrmi_type_id, q);
  if (!r.works.length && q !== q0) Object.assign(r, await RMI.searchWorks(car.tecrmi_type_id, q0));
  res.json({ ...r, query: q });
});
/** Применить норму к работе заказа: кол-во = часы, ед. rbh, цена = ставка нормо-часа. Соответствие запоминается */
async function applyNorm(o, car, item, w, staff) {
  const t = await RMI.workTime(car.tecrmi_type_id, w.ItemMpId, w.KorId);
  if (!(t.hours > 0)) throw new HttpError(404, 'TecRMI не дал времени на эту работу для этого авто');
  const vat = Number(item.vat ?? getSetting('default_vat', '23'));
  const rate = round2((Number(getSetting('rbh_rate', '0')) || 0) * (1 + vat / 100));
  updateItem(item.id, { qty: t.hours, unit: 'rbh', ...(rate > 0 ? { price: rate } : {}), norm_src: `TecRMI ${String(t.hours).replace('.', ',')} h · ${(w.text || t.text).slice(0, 120)}` }, staff);
  recalc(o.id);
  log('order', o.id, 'update', `Норма TecRMI: ${item.name} — ${t.hours} ч`, staff.name);
  return { ...t, rate, total: round2(t.hours * rate) };
}
crm.post('/tecrmi/apply', async (req, res) => {
  const s = who(req, 'orders.jobs');
  const b = req.body || {};
  const { o, car } = rmiCar(b.order_id);
  assertEditable(o, s);
  if (!car.tecrmi_type_id) throw new HttpError(400, 'Сначала выберите тип авто в TecRMI');
  const item = one(`SELECT * FROM order_items WHERE id = ? AND order_id = ? AND kind = 'labor'`, Number(b.item_id), o.id);
  if (!item) throw new HttpError(404, 'Работа не найдена');
  const w = { ItemMpId: Number(b.ItemMpId), KorId: Number(b.KorId), text: b.text || '' };
  const r = await applyNorm(o, car, item, w, s);
  if (b.remember !== false) RMI.remember(item.name, w);
  res.json({ ok: true, ...r });
});
/** Сразу после выбора работы: если работа знакома и тип авто известен — ставим норму без вопросов */
crm.post('/tecrmi/auto', async (req, res) => {
  const s = who(req, 'orders.jobs');
  const b = req.body || {};
  const { o, car } = rmiCar(b.order_id);
  const item = one(`SELECT * FROM order_items WHERE id = ? AND order_id = ? AND kind = 'labor'`, Number(b.item_id), o.id);
  if (!item) throw new HttpError(404, 'Работа не найдена');
  if (!car.tecrmi_type_id) return res.json({ need: 'vehicle' });
  const m = RMI.mapping(item.name);
  if (!m) return res.json({ need: 'work' });
  assertEditable(o, s);
  const r = await applyNorm(o, car, item, { ItemMpId: m.item_mp_id, KorId: m.kor_id, text: m.text }, s);
  res.json({ ok: true, applied: true, ...r });
});

/** Документ со страницы поставщика (фактура, WZ, корзина, заказ) → документ поставщика; сразу приход и/или в заказ/выцену */
crm.post('/ext/doc', async (req, res) => {
  const s = who(req, 'products.view');
  const P = permsOf(s);
  const b = req.body || {};
  const KINDS = { invoice: 'Фактура', wz: 'WZ', cart: 'Корзина', order: 'Заказ у поставщика' };
  const kind = KINDS[b.kind] ? b.kind : 'invoice';
  if (!(P['suppliers.receive'] || P['stock.docs'])) throw new HttpError(403, 'Нет права принимать документы поставщиков');
  if (b.receive && !P['suppliers.receive']) throw new HttpError(403, 'Нет права на приход на склад');
  if (b.order_id && !P['orders.jobs']) throw new HttpError(403, 'Нет права добавлять запчасти в заказ');
  if (b.quote_id && !P['quotes.manage']) throw new HttpError(403, 'Нет права менять выцены');
  const lines = (b.lines || b.items || []).map((l) => ({
    code: l.code ? String(l.code).trim().slice(0, 60) : null, name: String(l.name || l.code || '').trim().slice(0, 250), brand: l.brand ? String(l.brand).slice(0, 80) : null,
    sku: l.sku || null, ean: l.ean || null, qty: Number(l.qty) || 0, price_net: round2(Number(l.price_net) || 0), vat: Number(l.vat ?? 23),
    retail_gross: round2(Number(l.sell_gross) || 0) || undefined,
  })).filter((l) => l.name && l.qty > 0);
  if (!lines.length) throw new HttpError(400, 'В документе нет позиций');
  if (b.receive) {
    const bad = lines.filter((l) => l.price_net <= 0);
    if (bad.length) throw new HttpError(400, `Цена закупки должна быть больше 0: ${bad.map((l) => l.code || l.name).join(', ')}`);
  }
  const number = String(b.number || '').trim().slice(0, 80);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : undefined;
  const sup = SUP.wholesaler(b.supplier || 'other');
  await polishNames(lines, sup.key);
  const out = { id: null, duplicate: false, stock: null, order: null, quote: null, kind: KINDS[kind], number: number || null };
  tx(() => {
    const r = SUP.saveDoc({ supplier: sup.key || 'other', kind, ext_id: number || `${KINDS[kind]} ${s.name} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, doc_date: date, lines, meta: { url: b.url || null, by: s.name } });
    out.id = r.id; out.duplicate = r.duplicate;
    if (r.duplicate && !b.force) throw new HttpError(409, `Документ ${number} уже загружен в CRM (Склад → Поставщики). Повторно не добавляю.`);
    const d = one('SELECT stock_doc_id FROM supplier_docs WHERE id = ?', r.id);
    if (b.receive && !d.stock_doc_id) {
      const rr = SUP.receiveGeneric(r.id, s.name);
      out.stock = one('SELECT number FROM stock_docs WHERE id = ?', rr.stockDocId)?.number || null;
    }
    for (const [key, id] of [['order', b.order_id], ['quote', b.quote_id]]) {
      if (!id) continue;
      const o = getOrder(Number(id));
      if ((key === 'order') !== (o.kind === 'order')) throw new HttpError(400, 'Выбран не тот документ');
      assertEditable(o, s);
      out[key] = SUP.addDocToOrder(r.id, o.id, { toStock: !!b.receive, staffName: s.name }).order;
      log('order', o.id, 'update', `${KINDS[kind]} ${number || ''} от ${sup.name}: ${lines.length} поз.`, s.name);
    }
  });
  res.json({ ok: true, ...out });
});

// ── Финансы: обзор, конструктор, прибыль и убытки, деньги ───────────────────
crm.get('/finance/overview', (req, res) => { who(req, 'reports.view'); res.json(FIN.overview(req.query)); });
crm.get('/finance/pivot', (req, res) => {
  who(req, 'reports.view');
  const piv = FIN.pivot(req.query);
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pulsecar-${piv.group}-${req.query.from}_${req.query.to}.csv"`);
    return res.send(FIN.toCsv(piv));
  }
  res.json(piv);
});
crm.get('/finance/pnl', (req, res) => { who(req, 'reports.view'); res.json(FIN.pnl(req.query)); });
crm.get('/finance/cash', (req, res) => { who(req, 'reports.view'); res.json(FIN.cash(req.query)); });
/** Заказы, из которых сложилась цифра (клик по строке отчёта) */
crm.get('/finance/orders', (req, res) => {
  who(req, 'reports.view');
  const f = FIN.orderFilter(req.query);
  res.json(all(`SELECT o.id, o.number, o.total, o.total_net, o.cost, o.paid, date(COALESCE(o.closed_at, o.created_at),'localtime') d, c.name cname, k.make, k.model, k.plate, t.name source
    FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN cars k ON k.id = o.car_id LEFT JOIN order_types t ON t.id = o.type_id
    WHERE ${f.where} ORDER BY o.total DESC LIMIT 300`, ...f.params));
});

/** Данные фирмы по NIP из «Białej listy» Минфина (для клиентов B2B и настроек фирмы) */
crm.get('/nip/:nip', async (req, res) => { who(req); res.json(await lookupNip(req.params.nip)); });

// ── Настройки ──────────────────────────────────────────────────────────────
crm.put('/settings', (req, res) => {
  who(req, 'settings.manage');
  const allowed = ['company_name', 'company_brand', 'company_address', 'company_phone', 'company_email', 'company_nip', 'company_bank',
    'company_legal_name', 'company_street', 'company_postcode', 'company_city', 'company_legal_address', 'company_regon', 'company_krs', 'company_court', 'company_capital',
    'company_bdo', 'company_vat_eu', 'company_bank_name', 'company_swift', 'company_www', 'company_pkd',
    'hours_start', 'hours_end', 'slot_min', 'default_vat', 'cash_opening', 'order_terms', 'cal_color_request', 'cal_color_planned', 'cal_color_arrived', 'cal_color_no_show', 'cal_color_block', ...SETTINGS_KEYS];
  for (const [k, v] of Object.entries(req.body || {})) if (allowed.includes(k)) setSetting(k, String(v ?? ''));
  const b = req.body || {};
  if (b.company_street !== undefined || b.company_city !== undefined) {
    const st = getSetting('company_street', ''), pc = getSetting('company_postcode', ''), city = getSetting('company_city', '');
    if (st || city) setSetting('company_legal_address', [st, [pc, city].filter(Boolean).join(' ')].filter(Boolean).join(', '));
  }
  res.json({ ok: true });
});

crm.get('/settings/schema', (req, res) => {
  who(req, 'settings.manage');
  res.json({ schema: SETTINGS_SCHEMA, values: Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value])) });
});

// Нумерация документов: шаблон, сброс, начальный и текущий номер (продолжить с Motowarsztat)
crm.get('/numbering', (req, res) => {
  who(req, 'settings.manage');
  res.json(all('SELECT * FROM doc_numbering ORDER BY pos').map((r) => ({ ...r, current: currentNumber(r.key).n })));
});
crm.put('/numbering/:key', (req, res) => {
  who(req, 'settings.manage');
  const r = one('SELECT * FROM doc_numbering WHERE key = ?', req.params.key);
  if (!r) throw new HttpError(404, 'Нет такого документа');
  const b = req.body || {};
  const pattern = String(b.pattern ?? r.pattern).trim();
  if (!/\[numer\]/i.test(pattern)) throw new HttpError(400, 'В шаблоне должно быть [numer]');
  const reset = ['month', 'year', 'never'].includes(b.reset) ? b.reset : r.reset;
  run('UPDATE doc_numbering SET pattern = ?, reset = ?, start = ? WHERE key = ?', pattern, reset, Math.max(1, Number(b.start ?? r.start) || 1), r.key);
  if (b.current !== undefined && b.current !== '' && b.current !== null) {
    const ck = currentNumber(r.key).counterKey;
    run('INSERT INTO counters (key, n) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET n = excluded.n', ck, Math.max(0, Math.trunc(Number(b.current))));
  }
  res.json({ ok: true, next: pattern.replace(/\[numer\]/gi, String(currentNumber(r.key).n + 1)).replace(/\[miesiac\]/gi, String(new Date().getMonth() + 1).padStart(2, '0')).replace(/\[rok\]/gi, String(new Date().getFullYear())) });
});

// Шаблоны заказов (набор работ одной кнопкой) и чек-листы
crm.post('/orders/:id/apply-template/:tid', (req, res) => {
  const s = who(req, 'orders.jobs');
  const o = getOrder(Number(req.params.id));
  assertEditable(o, s);
  const t = one('SELECT * FROM order_templates WHERE id = ?', Number(req.params.tid));
  if (!t) throw new HttpError(404, 'Шаблон не найден');
  const items = JSON.parse(t.items || '[]');
  tx(() => { for (const it of items) addItem(o.id, { ...it, id: undefined, catalog_id: undefined }); });
  recalc(o.id);
  log('order', o.id, 'update', `Шаблон: ${t.name}`, s.name);
  res.json({ ok: true, added: items.length });
});
crm.get('/orders/:id/checklists', (req, res) => {
  who(req, 'orders.view');
  res.json({
    filled: all('SELECT * FROM order_checklists WHERE order_id = ? ORDER BY id', Number(req.params.id)).map((c) => ({ ...c, results: JSON.parse(c.results) })),
    templates: all('SELECT * FROM checklists WHERE active = 1 ORDER BY pos, name').map((c) => ({ ...c, items: JSON.parse(c.items) })),
  });
});
// ── Сервисная книжка: рекомендации по авто («что пора сделать») ─────────────
crm.get('/recommendations/presets', (req, res) => { who(req, 'orders.view'); res.json({ presets: REC.PRESETS }); });
crm.post('/recommendations', (req, res) => {
  const s = who(req, 'orders.view');
  const id = REC.createRec(req.body || {}, s.name);
  log('car', Number(req.body?.car_id), 'recommendation', String(req.body?.title || '').slice(0, 160), s.name);
  res.json({ id });
});
crm.put('/recommendations/:id', (req, res) => {
  who(req, 'orders.view');
  res.json(REC.updateRec(Number(req.params.id), req.body || {}));
});
crm.delete('/recommendations/:id', (req, res) => {
  who(req, 'orders.edit');
  REC.deleteRec(Number(req.params.id));
  res.json({ ok: true });
});
// Рекомендация → выцена: клиент увидит точный состав и цену в Моё авто и запишется «по выцене»
crm.post('/recommendations/:id/quote', (req, res) => {
  const s = who(req, 'quotes.manage');
  res.json({ id: REC.recToQuote(Number(req.params.id), s.name, createOrder) });
});
// Запись клиента «по выцене» → заказ из позиций выцены, запись в графике привязывается к заказу
crm.post('/appointments/:id/order-from-quote', (req, res) => {
  const s = who(req, 'orders.create');
  const a = one('SELECT * FROM appointments WHERE id = ?', Number(req.params.id));
  if (!a) throw new HttpError(404, 'Запись не найдена');
  if (a.order_id) return res.json({ id: a.order_id });
  const q = a.quote_id && one(`SELECT id FROM orders WHERE id = ? AND kind = 'quote'`, a.quote_id);
  if (!q) throw new HttpError(400, 'У записи нет выцены');
  const done = one(`SELECT id FROM orders WHERE kind = 'order' AND (quote_id = ? OR id = (SELECT merged_into FROM orders WHERE id = ?)) LIMIT 1`, q.id, q.id);
  const id = done?.id || quoteToOrder(q.id, s.name);
  run(`UPDATE appointments SET order_id = ?, customer_id = COALESCE(customer_id, (SELECT customer_id FROM orders WHERE id = ?)), car_id = COALESCE(car_id, (SELECT car_id FROM orders WHERE id = ?)),
    status = CASE WHEN status = 'request' THEN 'planned' ELSE status END WHERE id = ?`, id, id, id, a.id);
  res.json({ id });
});
crm.post('/orders/:id/recommendations/from-checklists', (req, res) => {
  const s = who(req, 'orders.view');
  res.json({ added: REC.fromChecklists(Number(req.params.id), s.name) });
});

crm.post('/orders/:id/checklists', (req, res) => {
  const s = who(req, 'orders.view');
  const o = getOrder(Number(req.params.id));
  const b = req.body || {};
  const results = JSON.stringify((b.results || []).map((r) => ({ item: String(r.item || '').slice(0, 200), state: ['ok', 'warn', 'bad', ''].includes(r.state) ? r.state : '', note: String(r.note || '').slice(0, 300) })));
  if (b.id) run(`UPDATE order_checklists SET results = ?, staff = ?, updated_at = datetime('now') WHERE id = ? AND order_id = ?`, results, s.name, Number(b.id), o.id);
  else {
    const t = one('SELECT * FROM checklists WHERE id = ?', Number(b.checklist_id));
    if (!t) throw new HttpError(404, 'Чек-лист не найден');
    insert('order_checklists', { order_id: o.id, checklist_id: t.id, name: t.name, results: JSON.stringify(JSON.parse(t.items).map((item) => ({ item, state: '', note: '' }))), staff: s.name, updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
  }
  res.json({ ok: true });
});

const dict = {
  expenses: { table: 'expense_categories', fields: ['name', 'pos'] },
  price_groups: { table: 'price_groups', fields: ['name', 'markup_pct', 'pos'] },
  checklists: { table: 'checklists', fields: ['name', 'items', 'active', 'pos'], json: ['items'] },
  templates: { table: 'order_templates', fields: ['name', 'icon', 'items', 'active', 'pos'], json: ['items'] },
  statuses: { table: 'order_statuses', fields: ['name', 'color', 'pos', 'is_final', 'lock_edit', 'notify_client', 'client_label', 'sms_mode', 'sms_template', 'email_mode', 'email_template'] },
  types: { table: 'order_types', fields: ['name', 'pos'] },
  stations: { table: 'stations', fields: ['name', 'color', 'pos', 'active', 'slot_min', 'max_hours_day'] },
};
crm.post('/dict/:name', (req, res) => {
  who(req, 'settings.manage');
  const d = dict[req.params.name];
  if (!d) throw new HttpError(404, 'Нет такого справочника');
  const b = req.body || {};
  if (!b.name) throw new HttpError(400, 'Название обязательно');
  const row = {};
  for (const f of d.fields) if (b[f] !== undefined) row[f] = d.json?.includes(f) && typeof b[f] !== 'string' ? JSON.stringify(b[f]) : b[f];
  if (b.id) update(d.table, Number(b.id), row); else insert(d.table, row);
  res.json({ ok: true, ...lists() });
});
crm.delete('/dict/:name/:id', (req, res) => {
  who(req, 'settings.manage');
  const d = dict[req.params.name];
  if (!d) throw new HttpError(404, 'Нет такого справочника');
  try { run(`DELETE FROM ${d.table} WHERE id = ?`, Number(req.params.id)); }
  catch { throw new HttpError(409, 'Используется в заказах — удалить нельзя (для постов можно отключить)'); }
  res.json({ ok: true, ...lists() });
});

/** Сотрудники с правами — только для администратора */
crm.get('/staff', (req, res) => {
  who(req, 'settings.manage');
  res.json({
    rows: all('SELECT id, login, name, role, color, hourly_rate, commission_pct, parts_pct, pay_mode, pay_base, is_mechanic, active, phone, email, last_login, permissions, stations, ui, (pass_hash IS NOT NULL) has_password FROM staff ORDER BY active DESC, name')
      .map((r) => ({ ...r, permissions: r.permissions ? JSON.parse(r.permissions) : {}, stations: r.stations ? JSON.parse(r.stations) : [], ui: r.ui ? JSON.parse(r.ui) : [], effective: permsOf(r) })),
    groups: PERM_GROUPS, presets: PRESETS,
  });
});
crm.post('/staff', (req, res) => {
  const me = who(req, 'settings.manage');
  const b = req.body || {};
  if (!b.name) throw new HttpError(400, 'Имя обязательно');
  const d = {
    name: b.name, role: ['admin', 'staff', 'mechanic'].includes(b.role) ? b.role : 'mechanic', color: b.color || null,
    hourly_rate: Number(b.hourly_rate) || 0, commission_pct: Number(b.commission_pct) || 0,
    parts_pct: Number(b.parts_pct) || 0, pay_mode: ['pct', 'hourly', 'both'].includes(b.pay_mode) ? b.pay_mode : 'pct', pay_base: b.pay_base === 'gross' ? 'gross' : 'net', is_mechanic: b.is_mechanic ? 1 : 0,
    active: b.active === undefined ? 1 : (b.active ? 1 : 0), login: b.login || null,
    phone: b.phone ?? undefined, email: b.email ?? undefined,
    permissions: b.permissions !== undefined ? JSON.stringify(b.permissions || {}) : undefined,
    stations: b.stations !== undefined ? JSON.stringify(b.stations || []) : undefined,
    ui: Array.isArray(b.ui) ? JSON.stringify([...new Set(b.ui.filter((x) => typeof x === 'string' && x.length < (x.startsWith('@') ? 600 : 60)))].slice(0, 500)) : undefined,
  };
  if (b.revoke) { d.login = null; d.pass_hash = null; }
  if (d.login && one('SELECT 1 FROM staff WHERE login = ? AND id <> ?', d.login, Number(b.id) || 0)) throw new HttpError(409, 'Такой логин уже есть');
  if (d.login && allDbs().some((x) => x !== curDbRef() && x.prepare('SELECT 1 FROM staff WHERE login = ?').get(d.login))) throw new HttpError(409, 'Такой логин уже занят в другом сервисе — логины должны быть разными во всех сервисах');
  if (b.password) {
    if (String(b.password).length < 8) throw new HttpError(400, 'Пароль — минимум 8 символов');
    d.pass_hash = hashPassword(b.password);
  }
  if (Number(b.id) === me.id && (!d.active || d.role !== 'admin')) throw new HttpError(400, 'Нельзя отключить или понизить самого себя');
  if (b.id) update('staff', Number(b.id), d); else insert('staff', d);
  res.json({ ok: true, ...lists() });
});

/** Быстро включить/выключить сотрудника (переключатель в списке). Выключенный не может войти в CRM и не предлагается в заказах */
crm.post('/staff/:id/active', (req, res) => {
  const me = who(req, 'settings.manage');
  const st = one('SELECT * FROM staff WHERE id = ?', Number(req.params.id));
  if (!st) throw new HttpError(404, 'Сотрудник не найден');
  const active = req.body?.active ? 1 : 0;
  if (st.id === me.id && !active) throw new HttpError(400, 'Нельзя отключить самого себя');
  update('staff', st.id, { active });
  res.json({ ok: true, ...lists() });
});

// ── Импорт ─────────────────────────────────────────────────────────────────
crm.post('/import', upload.single('file'), (req, res) => {
  const s = who(req, 'settings.manage');
  if (!req.file) throw new HttpError(400, 'Выберите файл CSV или XLSX.');
  let stats;
  try { stats = importRows(readRows(req.file.buffer), req.body?.type || null); }
  catch (e) { throw new HttpError(400, 'Ошибка импорта: ' + e.message); }
  run('INSERT INTO imports (filename, staff, stats) VALUES (?, ?, ?)', req.file.originalname, s.name, JSON.stringify(stats));
  res.json(stats);
});
crm.get('/imports', (req, res) => {
  who(req, 'settings.manage');
  res.json(all('SELECT * FROM imports ORDER BY id DESC LIMIT 30').map((i) => ({ ...i, stats: JSON.parse(i.stats) })));
});
crm.get('/template.csv', (req, res) => {
  who(req);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="pulsecar-import-szablon.csv"');
  res.send('﻿' + TEMPLATE_CSV);
});

// ── Интеграции ──────────────────────────────────────────────────────────────
crm.get('/integrations', (req, res) => {
  who(req, 'settings.manage');
  const token = ensureFeedToken();
  res.json({
    list: publicList(),
    calendarFeed: `${config.publicUrl}/ical/${token}.ics`,
    stations: all('SELECT id, name FROM stations WHERE active = 1 ORDER BY pos'),
    log: all('SELECT * FROM integration_log ORDER BY id DESC LIMIT 50'),
  });
});
crm.put('/integrations/:key', (req, res) => {
  who(req, 'settings.manage');
  if (!integrationDef(req.params.key)) throw new HttpError(404, 'Нет такой интеграции');
  saveIntegration(req.params.key, !!req.body?.enabled, req.body?.values || {});
  res.json({ ok: true });
});
const TESTS = {
  assistant: async () => (await import('./assistant.js')).testAssistant(),
  intercars: () => IC.testIntercars(), tecrmi: () => RMI.testTecrmi(), fakturownia: () => testFakturownia(), ksef: () => KSEF.testKsef(), smsapi: () => testSms(), email: () => testEmail(), tpay: () => testTpay(),
  hart: () => SUP.testHart(), mailbox: () => SUP.testMailbox(),
  smsgate: () => testSmsgate(), serwersms: () => testSerwersms(), smsplanet: () => testSmsplanet(), twilio: () => testTwilio(), smshttp: () => testSmshttp(), plate: () => testPlate(),
  telegram: async () => { const r = await testTelegram(); const row = one(`SELECT config FROM integrations WHERE key='telegram'`); const c = row ? JSON.parse(row.config) : {};
    if (!c.chatId) run(`UPDATE integrations SET config = ? WHERE key = 'telegram'`, JSON.stringify({ ...c, chatId: r.chatId })); return r.info; },
  webhook: async () => { const { webhookSend } = await import('./integrations/notify.js'); await webhookSend('test', { text: 'Проверка из Pulsecar CRM' }, cfg('webhook', { ignoreEnabled: true })); return 'Вебхук принял запрос'; },
  vin: async () => { const r = await decodeVin('1HGCM82633A004352'); return `Тестовый VIN → ${r.make} ${r.model} ${r.year} (${r.source})`; },
  calendar: async () => 'Ссылка на календарь работает, когда интеграция включена',
  marketing: async () => { const u = cfg('marketing', { ignoreEnabled: true })?.url; const r = await fetch(u, { method: 'GET', redirect: 'manual' }).catch(() => null); if (!r) throw new Error('Адрес не отвечает'); return `Отвечает (${r.status})`; },
};
crm.post('/integrations/:key/test', async (req, res) => {
  who(req, 'settings.manage');
  const t = TESTS[req.params.key];
  if (!t) throw new HttpError(404, 'Нет проверки');
  try {
    const info = await t();
    setState(req.params.key, { info: String(info), lastError: null, testedAt: new Date().toISOString() });
    res.json({ ok: true, info });
  } catch (e) {
    setState(req.params.key, { lastError: e.message });
    throw new HttpError(400, e.message);
  }
});

// ── Поставщики: документы от любых поставщиков → склад или заказ ─────────────
crm.get('/suppliers', (req, res) => {
  who(req, 'products.view');
  const q = String(req.query.q || '').trim();
  const cond = ['1=1'];
  const p = [];
  if (req.query.supplier) { cond.push('d.supplier = ?'); p.push(String(req.query.supplier)); }
  if (req.query.state === 'new') cond.push('d.stock_doc_id IS NULL');
  if (q) { cond.push('(d.ext_id LIKE ? OR d.raw LIKE ?)'); p.push(like(q), like(q)); }
  const docs = all(`SELECT d.id, d.supplier, d.kind, d.ext_id, d.doc_date, d.total_net, d.total_gross, d.lines_count, d.stock_doc_id, d.fetched_at, s.number stock_number,
      json_extract(d.raw, '$.usedIn') used_in FROM supplier_docs d LEFT JOIN stock_docs s ON s.id = d.stock_doc_id WHERE ${cond.join(' AND ')} ORDER BY d.doc_date DESC, d.id DESC LIMIT 200`, ...p)
    .map((d) => ({ ...d, supplier_name: SUP.wholesaler(d.supplier).name }));
  res.json({
    docs,
    wholesalers: SUP.WHOLESALERS.map((w) => ({ ...w, connected: w.api ? !!cfg(w.api) : false, docs: one('SELECT COUNT(*) n FROM supplier_docs WHERE supplier = ?', w.key).n })),
    api: { intercars: !!cfg('intercars'), hart: !!cfg('hart'), mailbox: !!cfg('mailbox') },
    markup: Number(getSetting('default_markup', '40')) || 0,
  });
});
crm.get('/suppliers/docs/:id', (req, res) => {
  who(req, 'products.view');
  const d = one('SELECT * FROM supplier_docs WHERE id = ?', Number(req.params.id));
  if (!d) throw new HttpError(404, 'Документ не найден');
  const lines = SUP.docLines(d).map((l) => {
    const ex = (l.sku && one('SELECT id, name, stock, sell_price FROM products WHERE supplier_sku = ?', l.sku)) || (l.ean && one('SELECT id, name, stock, sell_price FROM products WHERE ean = ?', l.ean))
      || (l.code && one(`SELECT id, name, stock, sell_price FROM products WHERE upper(replace(replace(replace(code,' ',''),'-',''),'.','')) = ?`, String(l.code).toUpperCase().replace(/[^A-Z0-9]/g, '')));
    return { ...l, sell: SUP.sellFrom(l), product: ex || null };
  });
  const raw = JSON.parse(d.raw || '{}');
  res.json({ ...d, raw: undefined, supplier_name: SUP.wholesaler(d.supplier).name, lines, used_in: raw.usedIn || null, meta: { file: raw.file, from: raw.from, url: raw.url } });
});
crm.post('/suppliers/parse', (req, res) => {
  who(req, 'products.view');
  res.json(SUP.parsePasted(req.body?.text));
});
crm.post('/suppliers/parse-file', upload.single('file'), (req, res) => {
  who(req, 'products.view');
  if (!req.file) throw new HttpError(400, 'Выберите файл');
  res.json(SUP.rowsToLines(readRows(req.file.buffer)));
});
/** Сохранить позиции (из кнопки «В Pulsecar», буфера или файла) как документ поставщика */
crm.post('/suppliers/docs', (req, res) => {
  const s = who(req, 'products.view');
  const b = req.body || {};
  const lines = (b.lines || []).map((l) => ({ code: l.code ? String(l.code).slice(0, 60) : null, name: String(l.name || l.code || '').slice(0, 250), qty: Number(l.qty) || 0, price_net: Number(l.price_net) || 0, vat: Number(l.vat ?? 23), ean: l.ean || null, brand: l.brand || null, sku: l.sku || null })).filter((l) => l.name && l.qty > 0);
  const r = SUP.saveDoc({ supplier: b.supplier || 'other', kind: b.kind || 'manual', ext_id: b.ext_id || `${s.name} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, doc_date: b.doc_date, lines, meta: { url: b.url || null } });
  res.json(r);
});
crm.post('/suppliers/docs/:id/receive', (req, res) => {
  const s = who(req, 'suppliers.receive');
  const d = one('SELECT supplier, raw FROM supplier_docs WHERE id = ?', Number(req.params.id));
  if (!d) throw new HttpError(404, 'Документ не найден');
  const generic = JSON.parse(d.raw || '{}').generic;
  res.json(d.supplier === 'intercars' && !generic && !req.body?.pick ? IC.receiveDoc(Number(req.params.id), s.name) : SUP.receiveGeneric(Number(req.params.id), s.name, req.body?.pick || null));
});
crm.post('/suppliers/docs/:id/to-order', (req, res) => {
  const s = who(req, 'orders.jobs');
  const b = req.body || {};
  const o = getOrder(Number(b.order_id));
  assertEditable(o, s);
  const r = SUP.addDocToOrder(Number(req.params.id), o.id, { pick: b.pick || null, toStock: !!b.toStock, staffName: s.name });
  log('order', o.id, 'update', `Запчасти от поставщика: ${r.added} поз.`, s.name);
  res.json(r);
});
crm.delete('/suppliers/docs/:id', (req, res) => {
  who(req, 'suppliers.receive');
  const d = one('SELECT stock_doc_id FROM supplier_docs WHERE id = ?', Number(req.params.id));
  if (d?.stock_doc_id) throw new HttpError(409, 'Документ уже принят на склад — удалить нельзя');
  run('DELETE FROM supplier_docs WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});
crm.post('/suppliers/sync', async (req, res) => {
  who(req, 'suppliers.receive');
  const out = {};
  const days = Math.min(30, Math.max(1, Number(req.body?.days) || 7));
  if (cfg('intercars')) try { out.intercars = await IC.fetchDocs(days); } catch (e) { out.intercars = { error: e.message }; }
  if (cfg('hart')) try { out.hart = await SUP.fetchHartDocs(days); } catch (e) { out.hart = { error: e.message }; }
  if (cfg('mailbox')) try { out.mailbox = await SUP.checkMailbox(); } catch (e) { out.mailbox = { error: e.message }; }
  res.json(out);
});
/** Поиск детали у всех поставщиков с API (Inter Cars — по индексу, Hart — по коду Hart) */
crm.get('/suppliers/search', async (req, res) => {
  who(req, 'products.view');
  const q = String(req.query.q || '').trim();
  const [ic, h] = await Promise.all([
    cfg('intercars') ? IC.search(q).then((r) => r.map((x) => ({ ...x, supplier: 'intercars' }))).catch((e) => [{ error: 'Inter Cars: ' + e.message }]) : [],
    cfg('hart') ? SUP.searchHart(q).catch((e) => [{ error: 'Hart: ' + e.message }]) : [],
  ]);
  const rows = [...ic, ...h];
  res.json({ rows: rows.filter((r) => !r.error), errors: rows.filter((r) => r.error).map((r) => r.error), connected: { intercars: !!cfg('intercars'), hart: !!cfg('hart') } });
});
crm.post('/suppliers/order', async (req, res) => {
  const s = who(req, 'suppliers.order');
  const b = req.body || {};
  const r = b.supplier === 'hart' ? await SUP.orderHart(b.lines || []) : await IC.placeOrder(b);
  if (b.order_id) log('order', Number(b.order_id), b.supplier === 'hart' ? 'hart_order' : 'ic_order', JSON.stringify(r), s.name);
  res.json(r);
});

// ── Inter Cars ──────────────────────────────────────────────────────────────
crm.get('/intercars/docs', (req, res) => {
  who(req, 'suppliers.receive');
  const rows = all(`SELECT d.id, d.kind, d.ext_id, d.doc_date, d.total_net, d.total_gross, d.lines_count, d.stock_doc_id, d.fetched_at, s.number stock_number
    FROM supplier_docs d LEFT JOIN stock_docs s ON s.id = d.stock_doc_id WHERE d.supplier = 'intercars' ${req.query.all === '1' ? '' : 'AND (d.stock_doc_id IS NULL OR d.fetched_at >= datetime(\'now\',\'-14 days\'))'}
    ORDER BY d.doc_date DESC, d.id DESC LIMIT 300`);
  const st = one(`SELECT state FROM integrations WHERE key = 'intercars'`);
  res.json({ rows, enabled: !!cfg('intercars'), state: st ? JSON.parse(st.state) : {} });
});
crm.get('/intercars/docs/:id', (req, res) => {
  who(req, 'suppliers.receive');
  const d = one(`SELECT * FROM supplier_docs WHERE id = ? AND supplier = 'intercars'`, Number(req.params.id));
  if (!d) throw new HttpError(404, 'Документ не найден');
  res.json({ ...d, raw: JSON.parse(d.raw) });
});
crm.post('/intercars/sync', async (req, res) => {
  who(req, 'suppliers.receive');
  try { res.json(await IC.fetchDocs(Math.min(30, Math.max(1, Number(req.body?.days) || 7)))); }
  catch (e) { setState('intercars', { lastError: e.message }); throw e; }
});
crm.post('/intercars/docs/:id/receive', (req, res) => {
  const s = who(req, 'suppliers.receive');
  res.json(IC.receiveDoc(Number(req.params.id), s.name));
});
crm.post('/intercars/receive-all', async (req, res) => {
  const s = who(req, 'suppliers.receive');
  res.json(await IC.receiveAll(s.name));
});
crm.get('/intercars/search', async (req, res) => {
  who(req, 'products.view');
  res.json(await IC.search(req.query.q));
});
crm.post('/intercars/order', async (req, res) => {
  const s = who(req, 'suppliers.order');
  const r = await IC.placeOrder(req.body || {});
  if (req.body?.order_id) log('order', Number(req.body.order_id), 'ic_order', r.requisitionId, s.name);
  res.json(r);
});

// ── Заказ: онлайн-оплата, e-mail, SMS клиенту ───────────────────────────────
crm.post('/orders/:id/paylink', async (req, res) => {
  const s = who(req, 'orders.contact');
  const o = getOrder(Number(req.params.id));
  const c = o.customer_id ? one('SELECT * FROM customers WHERE id = ?', o.customer_id) : null;
  const r = await createPayLink(o, c, config.publicUrl);
  log('order', o.id, 'paylink', r.amount, s.name);
  if (req.body?.sms && c?.phone) {
    const text = render(getSetting('sms_tpl_paylink') || 'Link do platnosci: [[link.platnosc]]', { ...orderContext(o.id), 'link.platnosc': r.url });
    await sendSms(c.phone, text, { kind: 'paylink', order_id: o.id, customer_id: o.customer_id, staff: s.name });
  }
  res.json(r);
});
crm.post('/orders/:id/paylink/check', async (req, res) => {
  who(req, 'orders.payments');
  const o = getOrder(Number(req.params.id));
  const r = await checkPayment(o);
  if (r.justPaid) { recalc(o.id); notify('payment', `Онлайн-оплата ${o.number}: ${r.amount} zł`); }
  res.json(r);
});
crm.post('/orders/:id/email', async (req, res) => {
  const s = who(req, 'orders.contact');
  const o = orderFull(Number(req.params.id));
  const to = String(req.body?.to || o.customer?.email || '').trim();
  const S = Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
  const rows = o.items.map((i) => `<tr><td>${esc(i.name)}</td><td style="text-align:right">${i.qty}</td><td style="text-align:right">${zl(i.qty * i.price * (1 - i.discount / 100))} zł</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px">
    <h2 style="margin:0">${o.kind === 'quote' ? 'Wycena' : 'Zlecenie'} ${esc(o.number)}</h2>
    <p>${esc(o.car ? [o.car.make, o.car.model, o.car.plate].filter(Boolean).join(' ') : '')}</p>
    <table style="width:100%;border-collapse:collapse" cellpadding="6" border="0">${rows}</table>
    <p style="font-size:18px"><b>Razem brutto: ${zl(o.total)} zł</b></p>
    ${req.body?.message ? textToHtml(req.body.message) : ''}
    <p style="color:#666;font-size:12px">${esc(S.company_name || '')} · ${esc(S.company_address || '')} · ${esc(S.company_phone || '')}</p></div>`;
  const attachments = [];
  if (req.body?.invoice && o.invoice_ext_id) attachments.push({ filename: `Faktura ${o.invoice_no}.pdf`.replace(/\//g, '-'), content: await invoicePdf(o.id) });
  const subject = String(req.body?.subject || '').trim() || `Pulsecar — ${o.kind === 'quote' ? 'wycena' : 'zlecenie'} ${o.number}`;
  await sendMail({ to, subject, html: req.body?.plain ? textToHtml(req.body.message || '') : html, attachments });
  log('order', o.id, 'email', to, s.name);
  res.json({ ok: true, to });
});
crm.post('/orders/:id/sms', async (req, res) => {
  const s = who(req, 'orders.contact');
  const o = getOrder(Number(req.params.id));
  const c = o.customer_id ? one('SELECT phone FROM customers WHERE id = ?', o.customer_id) : null;
  const text = String(req.body?.text || '').trim();
  const phone = normPhone(req.body?.phone) || c?.phone;
  if (!phone || !text) throw new HttpError(400, 'Нужен телефон клиента и текст');
  const r = await sendSms(phone, text, { kind: req.body?.kind || 'manual', order_id: o.id, customer_id: o.customer_id, staff: s.name });
  log('order', o.id, 'sms', text, s.name);
  res.json({ ok: true, ...r });
});
/** Готовый текст SMS/e-mail по шаблону: kind = card | quote | paylink | reminder | review | status:<id> */
crm.get('/orders/:id/template', (req, res) => {
  who(req, 'orders.contact');
  const o = getOrder(Number(req.params.id));
  const kind = String(req.query.kind || (o.kind === 'quote' ? 'quote' : 'card'));
  const ctx = orderContext(o.id);
  if (kind.startsWith('status:')) {
    const st = one('SELECT * FROM order_statuses WHERE id = ?', Number(kind.slice(7)));
    return res.json({ text: render(st?.sms_template || '', ctx) });
  }
  if (kind.startsWith('mail_')) {
    return res.json({ subject: render(getSetting(kind + '_subject', ''), ctx), text: render(getSetting(kind + '_body', ''), ctx) });
  }
  if (!['card', 'quote', 'paylink', 'reminder', 'review'].includes(kind)) throw new HttpError(400, 'Нет такого шаблона');
  res.json({ text: render(getSetting('sms_tpl_' + kind, ''), ctx) });
});
/** Ссылка на электронную карту заказа (создаётся один раз) */
crm.post('/orders/:id/card', (req, res) => {
  who(req, 'orders.contact');
  const o = getOrder(Number(req.params.id));
  res.json({ url: cardUrl(o.id) });
});
crm.post('/orders/:id/accept-reset', (req, res) => {
  const s = who(req, 'orders.edit');
  const o = getOrder(Number(req.params.id));
  run('UPDATE orders SET accepted_at = NULL, accepted_via = NULL WHERE id = ?', o.id);
  log('order', o.id, 'accept_reset', null, s.name);
  res.json({ ok: true });
});

// ── SMS: журнал, отправка любому клиенту, шаблоны ───────────────────────────
crm.get('/sms', (req, res) => {
  who(req, 'sms.view');
  const q = String(req.query.q || '').trim();
  const page = Math.max(0, Number(req.query.page) || 0);
  const cond = [];
  const p = [];
  if (q) { cond.push('(l.phone LIKE ? OR l.text LIKE ? OR c.name LIKE ?)'); p.push(like(q.replace(/[^\d+]/g, '') || q), like(q), like(q)); }
  if (req.query.status) { cond.push('l.status = ?'); p.push(String(req.query.status)); }
  if (req.query.order) { cond.push('(l.order_id = ? OR (l.customer_id = ? AND l.order_id IS NULL))'); p.push(Number(req.query.order), Number(req.query.customer) || -1); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const total = one(`SELECT COUNT(*) n FROM sms_log l LEFT JOIN customers c ON c.id = l.customer_id ${where}`, ...p).n;
  const rows = all(`SELECT l.*, c.name customer_name, o.number order_number FROM sms_log l LEFT JOIN customers c ON c.id = l.customer_id
    LEFT JOIN orders o ON o.id = l.order_id ${where} ORDER BY l.id DESC LIMIT ${PAGE} OFFSET ${page * PAGE}`, ...p);
  const month = one(`SELECT COUNT(*) n FROM sms_log WHERE status = 'sent' AND created_at >= datetime('now','start of month')`).n;
  res.json({ rows, total, pageSize: PAGE, month, provider: activeProvider() });
});
crm.post('/sms', async (req, res) => {
  const s = who(req, 'sms.send');
  const b = req.body || {};
  const c = b.customer_id ? one('SELECT id, phone FROM customers WHERE id = ?', Number(b.customer_id)) : null;
  const phone = normPhone(b.phone) || c?.phone;
  if (!phone) throw new HttpError(400, 'Укажите телефон');
  const r = await sendSms(phone, b.text, { kind: 'manual', customer_id: c?.id || one('SELECT id FROM customers WHERE phone = ?', phone)?.id, staff: s.name });
  res.json({ ok: true, ...r });
});
crm.post('/sms/preview', (req, res) => {
  who(req, 'sms.send');
  let t = String(req.body?.text || '');
  if (getSetting('sms_translit', '1') === '1') t = translit(t);
  res.json({ text: t, length: t.length, parts: t ? smsParts(t) : 0 });
});
const MSG_KEYS = ['sms_rec_on', 'sms_rec_days', 'sms_tpl_recommendation', 'sms_inspection_on', 'sms_tpl_inspection', 'my_car_url', 'sms_tpl_reminder', 'sms_tpl_card', 'sms_tpl_quote', 'sms_tpl_paylink', 'sms_tpl_code', 'sms_tpl_booking', 'sms_tpl_review',
  'sms_remind_on', 'sms_remind_hours', 'sms_translit', 'sms_review_delayed', 'sms_provider', 'review_url', 'doc_description_tpl',
  ...['invoice', 'receipt', 'storage', 'quote', 'order'].flatMap((k) => [`mail_${k}_subject`, `mail_${k}_body`]),
  'card_accept', 'card_show_status', 'card_show_net', 'card_show_bank', 'card_show_invoice', 'card_quote_after_protocol', 'card_accept_status_id', 'card_rodo', 'card_extra',
  'booking_widget', 'booking_color'];
crm.get('/messaging', (req, res) => {
  who(req, 'settings.manage');
  res.json({
    values: Object.fromEntries(MSG_KEYS.map((k) => [k, getSetting(k, '')])),
    fields: TPL_FIELDS, provider: activeProvider(),
    providers: ['smsgate', 'smsapi', 'serwersms', 'smsplanet', 'twilio', 'smshttp'].map((k) => ({ key: k, title: integrationDef(k).title, enabled: !!cfg(k) })),
    widget: { url: `${config.publicUrl}/rezerwacja`, script: `<div id="pulsecar-booking"></div>\n<script src="${config.publicUrl}/rezerwacja.js" async></script>` },
  });
});
crm.put('/messaging', (req, res) => {
  who(req, 'settings.manage');
  for (const [k, v] of Object.entries(req.body || {})) if (MSG_KEYS.includes(k)) setSetting(k, String(v ?? ''));
  res.json({ ok: true });
});

if (process.env.NODE_ENV === 'test') crm.post('/_jobs', async (req, res) => { who(req, 'admin'); const { runJobs } = await import('./integrations/jobs.js'); await runJobs(); res.json({ ok: true }); });

// ── Данные авто: код Aztec с техпаспорта и поиск по номеру ─────────────────
crm.post('/vehicle/aztec', (req, res) => {
  who(req, 'cars.view');
  const d = decodeAztec(req.body?.raw);
  const vin = normVin(d.car.vin);
  const plate = normPlate(d.car.plate);
  const car = (vin && one('SELECT id, customer_id FROM cars WHERE vin = ?', vin)) || (plate && one('SELECT id, customer_id FROM cars WHERE plate = ?', plate)) || null;
  res.json({ ...d, car: { ...d.car, plate }, existing: car });
});
crm.get('/vehicle/plate/:plate', async (req, res) => {
  who(req, 'cars.view');
  const r = await lookupPlate(req.params.plate);
  let vin = null;
  if (r.vin && (!r.make || !r.model)) vin = await decodeVin(r.vin).catch(() => null);
  res.json({ ...r, make: r.make || vin?.make || '', model: r.model || vin?.model || '', year: r.year || vin?.year || '' });
});
/** Остатки: SMS и поиск авто по номеру (чипы в шапке) */
crm.get('/balances', async (req, res) => { who(req); res.json(await balances(req.query.force === '1')); });
crm.put('/balances', (req, res) => {
  who(req, 'settings.manage');
  const b = req.body || {};
  if (b.sms_price !== undefined) setSetting('sms_price', String(b.sms_price));
  if (b.kind) setManual(b.kind, b.count);
  res.json({ ok: true });
});
crm.get('/vin/:vin', async (req, res) => {
  who(req, 'cars.view');
  res.json(await decodeVin(req.params.vin));
});

// ── Касса Pulse Points без заказа (быстрая продажа) ─────────────────────────
crm.post('/pos/scan', (req, res) => {
  const s = who(req, 'loyalty.use');
  const c = req.body?.qr ? verifyQrPayload(req.body.qr) : verifyManual(req.body?.who, req.body?.code);
  res.json({
    ticket: issueTicket(c.id, s.name),
    client: { id: c.id, name: c.name, phone: c.phone, cardNo: c.card_no, loyalty: loyaltySummary(c.id), cars: all('SELECT plate, make, model FROM cars WHERE customer_id = ?', c.id) },
  });
});
crm.post('/pos/quote', (req, res) => {
  who(req, 'loyalty.use');
  const c = one('SELECT id FROM customers WHERE card_no = ?', String(req.body?.cardNo || ''));
  if (!c) throw new HttpError(404, 'Клиент не найден');
  res.json(quote(c.id, Number(req.body?.orderTotal) || 0, Number(req.body?.redeemPoints) || 0));
});
crm.post('/pos/checkout', (req, res) => {
  const s = who(req, 'loyalty.use');
  res.json(checkout(req.body || {}, s.name));
});

// ── Печать документов (шаблоны в src/documents.js) ─────────────────────────
const sendHtml = (res, h) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.send(h); };
crm.get('/print/order/:id', (req, res) => {
  who(req, 'orders.view');
  const o = getOrder(Number(req.params.id));
  res.redirect(302, `/crm-api/print/${o.kind === 'quote' ? 'estimate' : 'spec'}/${o.id}`);
});
const ORDER_DOCS = ['intake', 'spec', 'mechanic', 'estimate', 'release'];
crm.get('/print/:type/:id', (req, res, next) => {
  const t = req.params.type;
  if (ORDER_DOCS.includes(t)) {
    const me = who(req, 'orders.view');
    const o = getOrder(Number(req.params.id));
    assertAssigned(me, o);
    if (t !== 'mechanic' && t !== 'intake' && !can(me, 'orders.prices')) throw new HttpError(403, 'Недостаточно прав: цены скрыты');
    return sendHtml(res, DOC.orderDoc(t, o.id));
  }
  if (t === 'sale') { who(req, 'orders.view'); return sendHtml(res, DOC.saleDocHtml(Number(req.params.id))); }
  if (t === 'stock') { who(req, 'products.view'); return sendHtml(res, DOC.stockDocHtml(Number(req.params.id))); }
  if (t === 'cash') { who(req, 'cash.view'); return sendHtml(res, DOC.cashDocHtml(Number(req.params.id))); }
  if (t === 'storage') { who(req, 'storage.view'); return sendHtml(res, DOC.storageDocHtml(Number(req.params.id))); }
  next();
});

// ── Документы продажи: фактура VAT (через Fakturownia → KSeF или своя), Pro forma, корректа ──
/** Документы продажи пакетом — для бухгалтера: ZIP (реестр Excel + фактуры + XML KSeF) или все фактуры одной страницей (PDF) */
const exportArgs = (q) => {
  const d = today();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : d.slice(0, 8) + '01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : d;
  const kinds = String(q.kinds || 'vat,correction').split(',').filter(Boolean);
  const ids = String(q.ids || '').split(',').map(Number).filter((x) => x > 0).slice(0, 2000);
  return { from, to, kinds, ids, receipts: q.receipts !== '0', html: q.html !== '0', xml: q.xml !== '0' };
};
crm.get('/sales-docs/export.zip', (req, res) => {
  const s = who(req, 'invoices.create');
  const r = SEXP.exportZip(exportArgs(req.query));
  log('sales', 0, 'export', `${r.name}: ${r.count} док.`, s.name);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${r.name}"; filename*=UTF-8''${encodeURIComponent(r.name)}`);
  res.send(r.buffer);
});
crm.get('/sales-docs/print-all', (req, res) => {
  who(req, 'invoices.create');
  res.type('html').send(SEXP.printAll(exportArgs(req.query)));
});
crm.get('/sales-docs', (req, res) => {
  who(req, 'invoices.create');
  const q = `%${String(req.query.q || '').trim()}%`;
  res.json({ rows: all(`SELECT d.id, d.kind, d.number, d.issue_date, d.total_gross, d.paid, d.ksef, d.order_id, o.number order_no, json_extract(d.buyer, '$.name') buyer
    FROM sales_docs d LEFT JOIN orders o ON o.id = d.order_id WHERE d.number LIKE ? OR json_extract(d.buyer, '$.name') LIKE ? OR o.number LIKE ? ORDER BY d.id DESC LIMIT 300`, q, q, q) });
});
crm.post('/orders/:id/sales-docs', async (req, res) => {
  const s = who(req, 'invoices.create');
  const o = getOrder(Number(req.params.id));
  const b = req.body || {};
  const kind = b.kind === 'proforma' ? 'proforma' : 'vat';
  if (kind === 'proforma' && getSetting('proforma_on', '1') === '0') throw new HttpError(400, 'Pro forma выключены в настройках');
  if (kind === 'vat' && one(`SELECT 1 FROM sales_docs WHERE order_id = ? AND kind = 'vat'`, o.id)) throw new HttpError(409, 'По заказу уже выставлена фактура VAT. Для изменений — фактура корректирующая.');
  const buyer = { ...DOC.buyerFromCustomer(o.customer_id ? one('SELECT * FROM customers WHERE id = ?', o.customer_id) : {}), ...(b.buyer || {}) };
  let ext = null;
  const mode = getSetting('invoice_mode', 'auto');
  const viaKsef = kind === 'vat' && mode === 'auto' && KSEF.ksefEnabled();
  const viaFakturownia = kind === 'vat' && !viaKsef && invoicesEnabled() && mode !== 'local';
  if (viaKsef) b.issue_date = today(); // KSeF: дата выставления = день отправки (иначе фактура считается офлайн)
  if (viaFakturownia) {
    const r = await issueInvoice(o.id, { buyer });
    ext = { id: r.id, number: r.number, url: r.url };
  }
  const d = DOC.createSaleDoc({ kind, orderId: o.id, buyer, issue_date: b.issue_date, sale_date: b.sale_date, payment_method: b.payment_method, due_days: b.due_days, notes: b.notes, ext }, s.name);
  log('order', o.id, kind === 'vat' ? 'invoice' : 'proforma', d.number, s.name);
  if (kind === 'vat') {
    const target = Number(getSetting('status_on_sale_doc', '')) || null;
    if (target) try { setStatus(o.id, target, s.name); } catch (e) { log('order', o.id, 'invoice_error', 'Статус после фактуры: ' + e.message, s.name); }
  }
  let ks = null, warning = null;
  if (viaKsef && (cfg('ksef')?.autoSend ?? true)) {
    try { ks = await KSEF.sendToKsef(d.id); } catch (e) { run('UPDATE sales_docs SET ksef_status = ?, ksef_error = ? WHERE id = ?', 'error', e.message, d.id); warning = e.message; }
    if (ks?.ksef_status === 'rejected') warning = 'KSeF отклонил фактуру: ' + ks.ksef_error;
  } else if (kind === 'vat' && !ext && !viaKsef) warning = 'Фактура выставлена в CRM, но не отправлена в KSeF. С 2026 года фактуры VAT нужно передавать в KSeF — подключите KSeF (Настройки → Интеграции).';
  res.json({ ...d, ...(ks || {}), ksef: !!ext, warning });
});
crm.post('/sales-docs/:id/correct', async (req, res) => {
  const s = who(req, 'invoices.create');
  const orig = one('SELECT * FROM sales_docs WHERE id = ?', Number(req.params.id));
  if (!orig || orig.kind !== 'vat') throw new HttpError(400, 'Корректировать можно только фактуру VAT');
  const b = req.body || {};
  if (!String(b.reason || '').trim()) throw new HttpError(400, 'Укажите причину корректы');
  const OL = JSON.parse(orig.items || '[]');
  const lines = OL.map((l, i) => {
    const c = (b.lines || [])[i] || {};
    const qty = c.qty === undefined ? l.qty : Number(c.qty) || 0;
    const unitGross = c.unit_gross === undefined ? (l.qty ? l.gross / l.qty : 0) : Number(c.unit_gross) || 0;
    const gross = round2(qty * unitGross);
    const net = round2(gross / (1 + l.vat / 100));
    return { ...l, qty, gross, net, vat_amt: round2(gross - net), unit_net: qty ? round2(net / qty) : 0 };
  });
  const nb = b.buyer && String(b.buyer.name || '').trim() ? { ...JSON.parse(orig.buyer || '{}'), ...b.buyer } : JSON.parse(orig.buyer || '{}');
  const d = DOC.createSaleDoc({ kind: 'correction', orderId: orig.order_id, buyer: nb, lines, corrects_id: orig.id, reason: String(b.reason).slice(0, 300), payment_method: orig.payment_method, paid: 0, notes: b.notes }, s.name);
  if (orig.order_id) log('order', orig.order_id, 'invoice', `${d.number} (korekta ${orig.number})`, s.name);
  let ks = null, warning = orig.ksef ? 'Исходная фактура в Fakturownia: корректу нужно также провести в Fakturownia.' : null;
  if (orig.ksef_status && KSEF.ksefEnabled() && (cfg('ksef')?.autoSend ?? true)) {
    try { ks = await KSEF.sendToKsef(d.id); } catch (e) { run('UPDATE sales_docs SET ksef_status = ?, ksef_error = ? WHERE id = ?', 'error', e.message, d.id); warning = e.message; }
    if (ks?.ksef_status === 'rejected') warning = 'KSeF отклонил корректу: ' + ks.ksef_error;
  }
  res.json({ ...d, ...(ks || {}), warning });
});
/** Продажи: все фактуры, Pro forma, корректы и чеки за период (как Sprzedaż в Motowarsztat) */
crm.get('/sales', (req, res) => {
  const me = who(req, 'invoices.create');
  const from = String(req.query.from || today().slice(0, 8) + '01'), to = String(req.query.to || today());
  const type = String(req.query.type || '');
  const q = `%${String(req.query.q || '').trim()}%`;
  const docs = type && type !== 'doc' && !['vat', 'proforma', 'correction'].includes(type) ? [] : all(`SELECT d.id, d.kind type, d.number, d.issue_date date,
      CASE WHEN d.kind = 'correction' THEN ROUND(d.total_net - COALESCE((SELECT x.total_net FROM sales_docs x WHERE x.id = d.corrects_id),0),2) ELSE d.total_net END net,
      CASE WHEN d.kind = 'correction' THEN ROUND(d.total_gross - COALESCE((SELECT x.total_gross FROM sales_docs x WHERE x.id = d.corrects_id),0),2) ELSE d.total_gross END gross, d.paid, d.payment_method,
      d.ksef_status, d.ksef_number, d.ksef_error, d.ext_url, d.order_id, o.number order_no, json_extract(d.buyer, '$.name') buyer, json_extract(d.buyer, '$.nip') nip, d.created_by staff
    FROM sales_docs d LEFT JOIN orders o ON o.id = d.order_id
    WHERE d.issue_date BETWEEN ? AND ? ${['vat', 'proforma', 'correction'].includes(type) ? 'AND d.kind = ?' : ''} AND (d.number LIKE ? OR COALESCE(json_extract(d.buyer, '$.name'),'') LIKE ? OR COALESCE(o.number,'') LIKE ?)
    ORDER BY d.issue_date DESC, d.id DESC LIMIT 2000`, ...[from, to, ...(['vat', 'proforma', 'correction'].includes(type) ? [type] : []), q, q, q]);
  const recs = type && type !== 'receipt' ? [] : [
    ...all(`SELECT r.id, 'receipt' type, r.number, substr(r.created_at,1,10) date, NULL net, r.total gross, r.total paid, r.payment_method, r.status receipt_status, r.error ksef_error,
        r.order_id, o.number order_no, COALESCE(c.company, c.name) buyer, r.nip, r.staff FROM receipts r LEFT JOIN orders o ON o.id = r.order_id LEFT JOIN customers c ON c.id = o.customer_id
      WHERE substr(r.created_at,1,10) BETWEEN ? AND ? AND (COALESCE(r.number,'') LIKE ? OR COALESCE(o.number,'') LIKE ? OR COALESCE(c.name,'') LIKE ?)`, from, to, q, q, q),
    ...all(`SELECT o.id, 'receipt' type, o.receipt_no number, substr(COALESCE(o.closed_at, o.created_at),1,10) date, o.total_net net, o.total gross, o.paid, NULL payment_method, 'manual' receipt_status,
        o.id order_id, o.number order_no, COALESCE(c.company, c.name) buyer, c.nip, NULL staff FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
      WHERE COALESCE(o.receipt_no,'') <> '' AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.order_id = o.id) AND substr(COALESCE(o.closed_at, o.created_at),1,10) BETWEEN ? AND ?
        AND (o.receipt_no LIKE ? OR o.number LIKE ? OR COALESCE(c.name,'') LIKE ?)`, from, to, q, q, q),
  ];
  const rows = [...docs, ...recs].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const sum = (t) => round2(rows.filter((r) => (t ? r.type === t : r.type !== 'proforma')).reduce((a, r) => a + (Number(r.gross) || 0), 0));
  res.json({ rows, totals: { all: sum(), vat: sum('vat'), correction: sum('correction'), receipt: sum('receipt'), proforma: sum('proforma') }, ksefPending: rows.filter((r) => r.type !== 'proforma' && r.type !== 'receipt' && r.ksef_status && r.ksef_status !== 'accepted').length });
});
/** Позиции фактуры без заказа: цену можно ввести нетто или брутто (price_mode), остальное считается */
function freeLines(arr) {
  return (arr || []).map((l) => {
    const qty = Number(l.qty) || 0, vat = Number(l.vat ?? 23);
    let gross, net;
    if (l.price_mode === 'net' && l.unit_net !== '' && l.unit_net != null) { net = round2(qty * (Number(l.unit_net) || 0)); gross = round2(net * (1 + vat / 100)); }
    else if ((l.unit_gross === undefined || l.unit_gross === '') && l.gross != null && Number(l.qty) === qty) { gross = round2(Number(l.gross)); net = round2(gross / (1 + vat / 100)); } // позиция, сохранённая ранее
    else { gross = round2(qty * (Number(l.unit_gross) || 0)); net = round2(gross / (1 + vat / 100)); }
    return { name: String(l.name || '').trim().slice(0, 250), code: l.code || null, kind: l.kind === 'labor' ? 'labor' : 'part', qty, unit: l.unit || 'szt.', unit_net: qty ? round2(net / qty) : 0, discount: 0, vat, net, vat_amt: round2(gross - net), gross, gtu: null,
      price_mode: l.price_mode === 'net' ? 'net' : 'gross', product_id: l.product_id || null, catalog_id: l.catalog_id || null };
  }).filter((l) => l.name && l.qty > 0);
}
const CAR_KEYS = ['car_id', 'make', 'model', 'year', 'plate', 'vin', 'mileage', 'engine', 'fuel'];
function freeCar(c, buyer, save) {
  if (!c) return null;
  const car = Object.fromEntries(CAR_KEYS.map((k) => [k, c[k] === '' || c[k] == null ? null : String(c[k]).trim()]).filter(([, v]) => v));
  if (car.plate) car.plate = normPlate(car.plate);
  if (car.vin) car.vin = car.vin.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!Object.keys(car).some((k) => k !== 'car_id')) return null;
  // «Сохранить авто в CRM»: новая машина попадает в базу (к клиенту с тем же NIP, если он есть)
  if (save && !car.car_id && (car.plate || car.vin)) {
    const ex = one('SELECT id FROM cars WHERE (plate = ? AND ? IS NOT NULL) OR (vin = ? AND ? IS NOT NULL)', car.plate || null, car.plate || null, car.vin || null, car.vin || null);
    const nip = String(buyer?.nip || '').replace(/\D/g, '');
    const cust = nip ? one("SELECT id FROM customers WHERE REPLACE(REPLACE(nip,'-',''),' ','') = ?", nip) : null;
    car.car_id = ex?.id || createCar({ plate: car.plate || '', vin: car.vin && car.vin.length === 17 ? car.vin : '', make: car.make || '', model: car.model || '', year: car.year || '',
      engine: car.engine || '', last_mileage: Number(car.mileage) || null, customer_id: cust?.id || null });
  }
  if (car.car_id) car.car_id = Number(car.car_id);
  return car;
}
function freeSplit(b, total) {
  if (b.payment_method !== 'mixed') return null;
  const parts = (b.pay_split || []).map((x) => ({ method: ['cash', 'card', 'blik', 'transfer'].includes(x?.method) ? x.method : null, amount: round2(x?.amount) })).filter((x) => x.method && x.amount > 0);
  if (!parts.length) return null;
  const sum = round2(parts.reduce((a, x) => a + x.amount, 0));
  if (sum > total + 0.01) throw new HttpError(400, `Сумма частей оплаты (${sum} zł) больше суммы фактуры (${total} zł)`);
  return parts;
}
/** Фактура без заказа (продажа запчастей, услуга): покупатель + свои позиции + авто + оплата частями */
crm.post('/sales-docs', async (req, res) => {
  const s = who(req, 'invoices.create');
  const b = req.body || {};
  const kind = b.kind === 'proforma' ? 'proforma' : 'vat';
  const lines = freeLines(b.lines);
  if (!lines.length) throw new HttpError(400, 'Добавьте хотя бы одну позицию');
  if (!String(b.buyer?.name || '').trim()) throw new HttpError(400, 'Укажите покупателя');
  const total = round2(lines.reduce((a, l) => a + l.gross, 0));
  const split = freeSplit(b, total);
  const car = freeCar(b.car, b.buyer, b.save_car);
  const viaKsef = kind === 'vat' && getSetting('invoice_mode', 'auto') === 'auto' && KSEF.ksefEnabled() && !b.draft;
  const paid = split ? round2(split.reduce((a, x) => a + x.amount, 0)) : b.paid ? total : 0;
  const d = DOC.createSaleDoc({ kind, buyer: b.buyer, lines, issue_date: viaKsef ? today() : b.issue_date, sale_date: b.sale_date, payment_method: b.payment_method, due_days: b.due_days, notes: b.notes, paid }, s.name);
  run('UPDATE sales_docs SET car = ?, pay_split = ? WHERE id = ?', car ? JSON.stringify(car) : null, split ? JSON.stringify(split) : null, d.id);
  let ks = null, warning = null;
  if (viaKsef && (cfg('ksef')?.autoSend ?? true)) {
    try { ks = await KSEF.sendToKsef(d.id); } catch (e) { run('UPDATE sales_docs SET ksef_status = ?, ksef_error = ? WHERE id = ?', 'error', e.message, d.id); warning = e.message; }
    if (ks?.ksef_status === 'rejected') warning = 'KSeF отклонил фактуру: ' + ks.ksef_error;
  }
  res.json({ ...d, ...(ks || {}), warning });
});
/** Фактура VAT на основании Pro forma: покупатель, позиции, авто и способ оплаты копируются */
crm.post('/sales-docs/:id/to-vat', async (req, res) => {
  const s = who(req, 'invoices.create');
  const pf = one('SELECT * FROM sales_docs WHERE id = ?', Number(req.params.id));
  if (!pf || pf.kind !== 'proforma') throw new HttpError(400, 'Фактуру VAT можно выставить только на основании Pro forma');
  const was = one(`SELECT number FROM sales_docs WHERE proforma_id = ? AND kind = 'vat'`, pf.id);
  if (was) throw new HttpError(409, `По этой Pro forma уже выставлена ${was.number}`);
  if (pf.order_id && one(`SELECT 1 FROM sales_docs WHERE order_id = ? AND kind = 'vat'`, pf.order_id)) throw new HttpError(409, 'По заказу уже выставлена фактура VAT');
  const b = req.body || {};
  const j = (v, def) => { try { return v ? JSON.parse(v) : def; } catch { return def; } };
  const lines = j(pf.items, []);
  const total = round2(lines.reduce((a, l) => a + (l.gross || 0), 0));
  const split = j(pf.pay_split, null);
  const viaKsef = getSetting('invoice_mode', 'auto') === 'auto' && KSEF.ksefEnabled();
  const days = Math.max(0, Math.round((new Date(pf.due_date) - new Date(pf.issue_date)) / 86400000)) || 0;
  // заказ: оплачено = оплаты заказа; без заказа — «уже оплачено» (по умолчанию да, иначе body.paid = false)
  const paid = pf.order_id ? undefined : split?.length ? round2(split.reduce((a, x) => a + x.amount, 0)) : b.paid === false ? 0 : total;
  const d = DOC.createSaleDoc({ kind: 'vat', orderId: pf.order_id || null, buyer: j(pf.buyer, {}), lines, issue_date: viaKsef ? today() : b.issue_date, sale_date: b.sale_date,
    payment_method: pf.payment_method, due_days: days, notes: pf.notes, paid }, s.name);
  run('UPDATE sales_docs SET proforma_id = ?, car = COALESCE(car, ?), pay_split = COALESCE(pay_split, ?) WHERE id = ?', pf.id, pf.car, pf.pay_split, d.id);
  if (pf.order_id) {
    log('order', pf.order_id, 'invoice', `${d.number} на основании ${pf.number}`, s.name);
    const target = Number(getSetting('status_on_sale_doc', '')) || null;
    if (target) try { setStatus(pf.order_id, target, s.name); } catch {}
  }
  let ks = null, warning = null;
  if (viaKsef && (cfg('ksef')?.autoSend ?? true)) {
    try { ks = await KSEF.sendToKsef(d.id); } catch (e) { run('UPDATE sales_docs SET ksef_status = ?, ksef_error = ? WHERE id = ?', 'error', e.message, d.id); warning = e.message; }
    if (ks?.ksef_status === 'rejected') warning = 'KSeF отклонил фактуру: ' + ks.ksef_error;
  }
  res.json({ ...one('SELECT id, number, kind, total_gross FROM sales_docs WHERE id = ?', d.id), ...(ks || {}), warning });
});
/** Карточка документа продажи (для просмотра и редактирования) */
const docEditable = (d) => d.kind !== 'correction' && !d.ext_id && !d.ksef_number && !['sent', 'accepted'].includes(d.ksef_status || '');
crm.get('/sales-docs/:id', (req, res) => {
  who(req, 'invoices.create');
  const d = one(`SELECT d.*, o.number order_no, x.number corrects_no, p.number proforma_no,
      (SELECT v.id FROM sales_docs v WHERE v.proforma_id = d.id AND v.kind = 'vat') vat_id, (SELECT v.number FROM sales_docs v WHERE v.proforma_id = d.id AND v.kind = 'vat') vat_no,
      (d.order_id IS NOT NULL AND EXISTS (SELECT 1 FROM sales_docs w WHERE w.order_id = d.order_id AND w.kind = 'vat')) order_has_vat
    FROM sales_docs d LEFT JOIN orders o ON o.id = d.order_id LEFT JOIN sales_docs x ON x.id = d.corrects_id LEFT JOIN sales_docs p ON p.id = d.proforma_id WHERE d.id = ?`, Number(req.params.id));
  if (!d) throw new HttpError(404, 'Документ не найден');
  const j = (v, def) => { try { return v ? JSON.parse(v) : def; } catch { return def; } };
  const { ksef_xml, ...rest } = d;
  res.json({ ...rest, buyer: j(d.buyer, {}), items: j(d.items, []), car: j(d.car, null), pay_split: j(d.pay_split, null), editable: docEditable(d),
    corrections: all('SELECT id, number, issue_date, total_gross FROM sales_docs WHERE corrects_id = ? ORDER BY id', d.id) });
});
/** Изменить фактуру, пока она не ушла в KSeF (номер и дата выставления сохраняются). После KSeF — только корректа */
crm.put('/sales-docs/:id', async (req, res) => {
  const s = who(req, 'invoices.create');
  const d = one('SELECT * FROM sales_docs WHERE id = ?', Number(req.params.id));
  if (!d) throw new HttpError(404, 'Документ не найден');
  if (!docEditable(d)) throw new HttpError(409, 'Фактура уже в KSeF — изменить можно только корректой');
  const b = req.body || {};
  const lines = d.order_id && !b.lines ? JSON.parse(d.items || '[]') : freeLines(b.lines);
  if (!lines.length) throw new HttpError(400, 'Добавьте хотя бы одну позицию');
  if (!String(b.buyer?.name || '').trim()) throw new HttpError(400, 'Укажите покупателя');
  const T = DOC.sumLines(lines);
  const split = freeSplit(b, T.gross);
  const car = freeCar(b.car, b.buyer, b.save_car);
  const days = Math.max(0, Number(b.due_days) || 0);
  const due = new Date(new Date(d.issue_date).getTime() + days * 86400000).toISOString().slice(0, 10);
  const pm = ['cash', 'card', 'blik', 'transfer', 'mixed'].includes(b.payment_method) ? b.payment_method : d.payment_method;
  const paid = d.kind === 'proforma' ? 0 : split ? round2(split.reduce((a, x) => a + x.amount, 0)) : b.paid ? T.gross : 0;
  update('sales_docs', d.id, { buyer: JSON.stringify(b.buyer), items: JSON.stringify(lines), total_net: T.net, total_vat: T.vat, total_gross: T.gross,
    payment_method: pm, paid, due_date: due, sale_date: /^\d{4}-\d{2}-\d{2}$/.test(b.sale_date || '') ? b.sale_date : d.sale_date, notes: b.notes || null,
    car: car ? JSON.stringify(car) : null, pay_split: split ? JSON.stringify(split) : null,
    ksef_status: null, ksef_error: null, ksef_xml: null, ksef_ref: null });
  if (d.order_id) log('order', d.order_id, 'invoice', `${d.number} изменена`, s.name);
  res.json({ ok: true, id: d.id });
});
/** KSeF: отправить (повторно), обновить статус, скачать UPO и XML FA(3) */
crm.post('/sales-docs/:id/ksef', async (req, res) => {
  const s = who(req, 'invoices.create');
  const d = one('SELECT * FROM sales_docs WHERE id = ?', Number(req.params.id));
  if (!d) throw new HttpError(404, 'Документ не найден');
  if (d.ksef_status === 'rejected' || d.ksef_status === 'error') run('UPDATE sales_docs SET ksef_xml = NULL, ksef_ref = NULL WHERE id = ?', d.id);
  const r = d.ksef_ref && !['rejected', 'error'].includes(d.ksef_status) ? await KSEF.refreshStatus(d.id) : await KSEF.sendToKsef(d.id).catch((e) => {
    run('UPDATE sales_docs SET ksef_status = ?, ksef_error = ? WHERE id = ?', 'error', e.message, d.id); throw e; });
  if (d.order_id) log('order', d.order_id, 'invoice', `${d.number} → KSeF: ${r.ksef_number || r.ksef_status}`, s.name);
  res.json(r);
});
crm.get('/sales-docs/:id/upo', async (req, res) => {
  who(req, 'invoices.create');
  const d = one('SELECT number FROM sales_docs WHERE id = ?', Number(req.params.id));
  const xml = await KSEF.upoXml(Number(req.params.id));
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="UPO-${String(d?.number || req.params.id).replace(/[^\w-]+/g, '-')}.xml"`);
  res.send(xml);
});
crm.get('/sales-docs/:id/xml', (req, res) => {
  who(req, 'invoices.create');
  const d = one('SELECT * FROM sales_docs WHERE id = ?', Number(req.params.id));
  if (!d || d.kind === 'proforma') throw new HttpError(404, 'Нет XML');
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="${String(d.number).replace(/[^\w-]+/g, '-')}.xml"`);
  res.send(d.ksef_xml || KSEF.buildFa3(d));
});
/** Почему фактуру VAT / корректу нельзя удалить (null — можно, только владельцу) */
function saleDocLock(d) {
  if (d.kind === 'proforma') return null;
  if (d.ksef_number || ['sent', 'accepted'].includes(d.ksef_status)) return 'Фактура уже в KSeF — удалить нельзя, только корректа.';
  if (d.ext_id) return 'Фактура выставлена через Fakturownia — удалите её там.';
  const c = one('SELECT number FROM sales_docs WHERE corrects_id = ? LIMIT 1', d.id);
  if (c) return `К фактуре есть корректа ${c.number} — сначала удалите её.`;
  return null;
}
crm.delete('/sales-docs/:id', (req, res) => {
  const s = who(req, 'invoices.create');
  const d = one('SELECT * FROM sales_docs WHERE id = ?', Number(req.params.id));
  if (!d) throw new HttpError(404, 'Документ не найден');
  if (d.kind !== 'proforma') {
    if (!ownerOf(req)) throw new HttpError(403, 'Удалять фактуры может только владелец.');
    const why = saleDocLock(d);
    if (why) throw new HttpError(400, why);
  }
  tx(() => {
    run('UPDATE sales_docs SET proforma_id = NULL WHERE proforma_id = ?', d.id);
    run('DELETE FROM sales_docs WHERE id = ?', d.id);
  });
  if (d.order_id) log('order', d.order_id, 'update', `Удалена ${d.number}${d.kind !== 'proforma' ? ` (${round2(d.total_gross)} zł, не была в KSeF)` : ''}`, s.name);
  log('sales_doc', d.id, 'delete', { number: d.number, kind: d.kind, total: d.total_gross, order_id: d.order_id }, s.name);
  res.json({ ok: true });
});
// Чек (paragon), который НЕ пробит на кассе (ждёт кассы / ошибка) — удалить может только владелец
crm.delete('/receipts/:id', (req, res) => {
  const s = who(req, 'orders.payments');
  if (!ownerOf(req)) throw new HttpError(403, 'Удалять чеки может только владелец.');
  const r = one('SELECT * FROM receipts WHERE id = ?', Number(req.params.id));
  if (!r) throw new HttpError(404, 'Чек не найден');
  if (!['pending', 'error'].includes(r.status)) throw new HttpError(400, 'Чек уже фискализирован (пробит на кассе) — удалить нельзя.');
  run('DELETE FROM receipts WHERE id = ?', r.id);
  if (r.order_id) log('order', r.order_id, 'update', `Удалён непробитый чек на ${round2(r.total)} zł`, s.name);
  log('receipt', r.id, 'delete', { total: r.total, order_id: r.order_id, status: r.status }, s.name);
  res.json({ ok: true });
});

// ── Файлы заказа (фото, видео, PDF) — видны клиенту в электронной карте ─────
const FILES_DIR = DOC.FILES_DIR;
const sendOrderFile = DOC.sendOrderFile;
crm.post('/orders/:id/files', upload.array('files', 20), (req, res) => {
  const s = who(req, 'orders.edit');
  const o = getOrder(Number(req.params.id));
  const sub = (curBranch() === MAIN ? '' : curBranch().toLowerCase() + '/') + o.id; // файлы филиала — в своей папке
  const dir = path.join(FILES_DIR, sub);
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  const OK = /^(image\/(jpeg|png|webp|heic|heif|gif)|video\/(mp4|quicktime|webm|3gpp)|application\/pdf)$/;
  const bad = (req.files || []).filter((f) => !OK.test(f.mimetype)).map((f) => f.originalname);
  if (bad.length) throw new HttpError(400, `Можно загружать фото, видео и PDF. Не подходит: ${bad.join(', ')}`);
  for (const f of req.files || []) {
    const safe = f.originalname.normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-80) || 'plik';
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}-${safe}`;
    fs.writeFileSync(path.join(dir, name), f.buffer);
    out.push(insert('order_files', { order_id: o.id, name: f.originalname.slice(0, 200), path: `${sub}/${name}`, mime: f.mimetype, size: f.size, client_visible: req.body?.client_visible === '0' ? 0 : 1, staff: s.name }));
  }
  log('order', o.id, 'update', `Файлы: ${out.length}`, s.name);
  res.json({ ok: true, ids: out });
});
crm.get('/files/:id', (req, res) => {
  who(req, 'orders.view');
  const f = one('SELECT * FROM order_files WHERE id = ?', Number(req.params.id));
  if (!f) throw new HttpError(404, 'Файл не найден');
  sendOrderFile(res, f, req.query.dl === '1');
});
crm.put('/files/:id', (req, res) => {
  who(req, 'orders.edit');
  run('UPDATE order_files SET client_visible = ? WHERE id = ?', req.body?.client_visible ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
});
crm.delete('/files/:id', (req, res) => {
  const s = who(req, 'orders.edit');
  const f = one('SELECT * FROM order_files WHERE id = ?', Number(req.params.id));
  if (!f) throw new HttpError(404, 'Файл не найден');
  try { fs.unlinkSync(path.join(FILES_DIR, f.path)); } catch {}
  run('DELETE FROM order_files WHERE id = ?', f.id);
  log('order', f.order_id, 'update', `Удалён файл ${f.name}`, s.name);
  res.json({ ok: true });
});
/** Подпись на бумаге: сотрудник отмечает, что клиент подписал документ в сервисе */
crm.post('/orders/:id/signatures', (req, res) => {
  const s = who(req, 'orders.edit');
  const o = getOrder(Number(req.params.id));
  const doc = ['intake', 'estimate', 'quote', 'release'].includes(req.body?.doc) ? req.body.doc : 'intake';
  insert('order_signatures', { order_id: o.id, doc, method: 'paper', signer_name: String(req.body?.signer_name || '').slice(0, 100) || null, ip: s.name });
  if ((doc === 'estimate' || doc === 'quote') && !o.accepted_at) run(`UPDATE orders SET accepted_at = datetime('now','localtime'), accepted_via = 'paper' WHERE id = ?`, o.id);
  log('order', o.id, 'accepted', `${DOC.SIG_KIND[doc]} — подпись на бумаге`, s.name);
  res.json({ ok: true });
});
