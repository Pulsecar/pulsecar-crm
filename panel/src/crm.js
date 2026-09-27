// API панели panel.pulsecar.tech (CRM для сотрудников)
import express from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { all, one, run, tx, insert, update, log, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import {
  HttpError, currentNumber, checkPassword, hashPassword, normPhone, normPlate, normVin, newCardNo, nextNumber, parseCookies, readSession,
  signSession, round2, today,
} from './util.js';
import {
  checkout, issueTicket, loyaltySummary, quote, verifyManual, verifyQrPayload, redeemLimits, redeemForOrder,
} from './loyalty.js';
import { importRows, readRows, TEMPLATE_CSV } from './importer.js';
import { addItem, createOrder, getOrder, orderFull, quoteToOrder, recalc, setStatus, updateItem } from './orders.js';
import { invoicesEnabled, invoicePdf, issueInvoice, testFakturownia } from './invoices.js';
import { createStockDoc, findOrCreateProduct } from './stock.js';
import { publicList, save as saveIntegration, cfg, setState, def as integrationDef } from './integrations/index.js';
import * as IC from './integrations/intercars.js';
import * as SUP from './integrations/suppliers.js';
import { notify, testTelegram } from './integrations/notify.js';
import { sendMail, testEmail, testTpay, createPayLink, checkPayment, decodeVin, ensureFeedToken } from './integrations/services.js';
import { can, permsOf, PERM_GROUPS, PRESETS } from './perms.js';
import { SETTINGS_SCHEMA, SETTINGS_KEYS } from './settings-schema.js';
import * as FIN from './finance.js';
import { sendSms, testSms, testSerwersms, testSmsplanet, testTwilio, testSmsgate, testSmshttp, activeProvider, smsParts, translit } from './sms.js';
import { FIELDS as TPL_FIELDS, render, orderContext, cardUrl, textToHtml } from './messaging.js';
import { decodeAztec, lookupPlate, testPlate } from './vehicle.js';

export const crm = express.Router();
crm.use(express.json({ limit: '1mb' }));
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
  const s = one('SELECT * FROM staff WHERE login = ? AND active = 1 AND pass_hash IS NOT NULL', String(req.body?.login || '').trim());
  if (!s || !checkPassword(String(req.body?.password || ''), s.pass_hash)) {
    n.push(Date.now()); loginHits.set(req.ip, n);
    throw new HttpError(401, 'Неверный логин или пароль.');
  }
  const token = signSession({ id: s.id, exp: Date.now() + 14 * 86400_000 });
  res.setHeader('Set-Cookie', `pcs=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${14 * 86400}${config.publicUrl.startsWith('https') ? '; Secure' : ''}${process.env.COOKIE_DOMAIN ? '; Domain=' + process.env.COOKIE_DOMAIN : ''}`);
  run("UPDATE staff SET last_login = datetime('now') WHERE id = ?", s.id);
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
  const sess = bearer ? null : readSession(parseCookies(req.headers.cookie).pcs);
  const s = bearer ? one('SELECT * FROM staff WHERE ext_token = ? AND active = 1', sha(bearer)) : sess && one('SELECT * FROM staff WHERE id = ? AND active = 1', sess.id);
  if (!s) throw new HttpError(401, 'Войдите в панель.');
  if (min.includes('.')) { if (!can(s, min)) throw new HttpError(403, 'Недостаточно прав: ' + permLabel(min)); }
  else if ((RANK[s.role] || 0) < RANK[min]) throw new HttpError(403, 'Недостаточно прав.');
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
    user: { id: s.id, name: s.name, role: s.role },
    perms: permsOf(s),
    ...lists(),
    settings: Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value])),
    loyalty: loyaltySummary(0).rules,
    features: {
      invoices: invoicesEnabled(), marketingUrl: cfg('marketing')?.url || config.marketingUrl, autoEarnFromCrm: config.loyalty.autoEarnFromCrm,
      intercars: !!cfg('intercars'), tpay: !!cfg('tpay'), email: !!cfg('email'), sms: !!activeProvider(), smsProvider: activeProvider(), plate: !!cfg('plate'),
    },
  });
});

// ── Главная ────────────────────────────────────────────────────────────────
crm.get('/dashboard', (req, res) => {
  who(req);
  const d = today();
  const month = d.slice(0, 7);
  res.json({
    byStatus: all(`SELECT st.id, st.name, st.color, COUNT(o.id) n FROM order_statuses st LEFT JOIN orders o ON o.status_id = st.id AND o.kind = 'order'
      WHERE st.is_final = 0 GROUP BY st.id ORDER BY st.pos`),
    todayAppointments: all(`SELECT a.*, st.name station_name, c.name customer_name, k.make, k.model, k.plate, o.number order_number
      FROM appointments a LEFT JOIN stations st ON st.id = a.station_id LEFT JOIN customers c ON c.id = a.customer_id
      LEFT JOIN cars k ON k.id = a.car_id LEFT JOIN orders o ON o.id = a.order_id
      WHERE substr(a.start_at,1,10) = ? AND a.status <> 'cancelled' ORDER BY a.start_at`, d),
    requests: all(`SELECT a.*, c.name customer_name FROM appointments a LEFT JOIN customers c ON c.id = a.customer_id
      WHERE a.status = 'request' ORDER BY a.id DESC LIMIT 20`),
    revenue: {
      today: one(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE direction='in' AND method <> 'points' AND substr(created_at,1,10) = ?`, d).s,
      month: one(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE direction='in' AND method <> 'points' AND substr(created_at,1,7) = ?`, month).s,
      closedMonth: one(`SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE kind='order' AND substr(closed_at,1,7) = ?`, month),
    },
    unpaid: all(`SELECT o.id, o.number, o.total, o.paid, c.name customer_name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
      JOIN order_statuses st ON st.id = o.status_id WHERE o.kind='order' AND st.is_final = 1 AND o.paid < o.total - 0.01 AND o.source <> 'import'
      ORDER BY o.closed_at DESC LIMIT 10`),
    lowStock: all('SELECT id, name, code, stock, min_stock FROM products WHERE active = 1 AND min_stock > 0 AND stock <= min_stock ORDER BY name LIMIT 10'),
    storageDue: all(`SELECT s.*, c.name customer_name FROM storage s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.date_out IS NULL AND s.date_until IS NOT NULL AND s.date_until <= date('now','+14 days') ORDER BY s.date_until LIMIT 10`),
  });
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
  });
});

const CUST_FIELDS = ['name', 'company', 'nip', 'email', 'street', 'postcode', 'city', 'notes', 'discount_labor', 'discount_parts', 'marketing_consent'];
function custData(b) {
  const o = {};
  for (const k of CUST_FIELDS) if (b[k] !== undefined) o[k] = b[k] === '' ? null : b[k];
  if (b.phone !== undefined) {
    o.phone = b.phone ? normPhone(b.phone) : null;
    if (b.phone && !o.phone) throw new HttpError(400, 'Неверный номер телефона');
  }
  return o;
}
function createCustomer(b) {
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
  });
});
const CAR_FIELDS = ['customer_id', 'make', 'model', 'year', 'engine', 'capacity', 'power_kw', 'fuel', 'color', 'last_mileage', 'notes',
  'first_reg', 'engine_no', 'category', 'mass_kg', 'seats', 'reg_doc', 'inspection_until', 'insurance_until', 'key_no', 'paint_code', 'vehicle_type'];
function carData(b) {
  const o = {};
  for (const k of CAR_FIELDS) if (b[k] !== undefined) o[k] = b[k] === '' ? null : b[k];
  if (b.plate !== undefined) o.plate = normPlate(b.plate) || null;
  if (b.vin !== undefined) {
    o.vin = String(b.vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
    if (o.vin && o.vin.length !== 17) throw new HttpError(400, 'VIN — 17 символов');
  }
  return o;
}
function createCar(b) {
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

// ── Заказы и сметы ─────────────────────────────────────────────────────────
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
      (SELECT MIN(start_at) FROM appointments WHERE order_id = o.id AND status <> 'cancelled') planned_at
    ${from} ORDER BY o.id DESC LIMIT ${PAGE} OFFSET ${page * PAGE}`, ...params);
  res.json({ rows: rows.map((o) => hideFor(P, o)), total: agg.n, sum: P['orders.prices'] ? agg.s : null, pageSize: PAGE });
});

/** Скрываем цены и контакты, если у сотрудника нет таких прав */
function hideFor(P, o) {
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
    if (!carId && b.new_car && (b.new_car.plate || b.new_car.vin || b.new_car.make)) carId = createCar({ ...b.new_car, customer_id: customerId });
    return createOrder({ ...b, customer_id: customerId, car_id: carId }, s.name);
  });
  if (b.appointment_id) run('UPDATE appointments SET order_id = ?, customer_id = COALESCE(customer_id, (SELECT customer_id FROM orders WHERE id = ?)), car_id = COALESCE(car_id, (SELECT car_id FROM orders WHERE id = ?)), status = CASE WHEN status = \'request\' THEN \'planned\' ELSE status END WHERE id = ?', id, id, id, Number(b.appointment_id));
  res.json({ id });
});

crm.get('/orders/:id', (req, res) => {
  const me = who(req, 'orders.view');
  const o = orderFull(Number(req.params.id));
  assertAssigned(me, o);
  hideFor(permsOf(me), o);
  if (o.customer_id) o.redeem = redeemLimits(o.customer_id, o.total, o.payments.filter((p) => p.method === 'points').reduce((a, p) => a + p.amount, 0));
  res.json(o);
});

const ORDER_FIELDS = ['customer_id', 'car_id', 'type_id', 'mechanic_id', 'mileage', 'fuel_level', 'complaint', 'internal_note', 'mechanic_note', 'pickup_at', 'receipt_no', 'external_no', 'faults', 'after_notes'];
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
  update('orders', o.id, d);
  if (d.mileage && (d.car_id || o.car_id)) run('UPDATE cars SET last_mileage = MAX(COALESCE(last_mileage,0), ?) WHERE id = ?', d.mileage, d.car_id || o.car_id);
  if (d.car_id && (d.customer_id || o.customer_id)) run('UPDATE cars SET customer_id = COALESCE(customer_id, ?) WHERE id = ?', d.customer_id || o.customer_id, d.car_id);
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

crm.post('/orders/:id/payments', (req, res) => {
  const s = who(req, 'orders.payments');
  const o = getOrder(Number(req.params.id));
  const method = ['cash', 'card', 'transfer'].includes(req.body?.method) ? req.body.method : null;
  const amount = round2(req.body?.amount);
  if (!method || !(amount > 0)) throw new HttpError(400, 'Укажите способ и сумму оплаты');
  insert('payments', {
    number: method === 'cash' ? nextNumber('KP') : null, direction: 'in', method, amount, order_id: o.id, customer_id: o.customer_id,
    note: String(req.body?.note || '') || `Оплата ${o.number}`, staff: s.name,
  });
  recalc(o.id);
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

crm.delete('/orders/:id', (req, res) => {
  const s = who(req, 'orders.delete');
  const o = getOrder(Number(req.params.id));
  if (one('SELECT 1 FROM payments WHERE order_id = ?', o.id)) throw new HttpError(400, 'В заказе есть оплаты — сначала удалите их');
  if (one(`SELECT 1 FROM stock_docs WHERE order_id = ?`, o.id)) throw new HttpError(400, 'По заказу выданы запчасти со склада — сначала верните статус');
  run('DELETE FROM orders WHERE id = ?', o.id);
  log('order', o.id, 'delete', o.number, s.name);
  res.json({ ok: true });
});

// ── Терминарз ──────────────────────────────────────────────────────────────
crm.get('/appointments', (req, res) => {
  who(req, 'calendar.view');
  const from = String(req.query.from || today());
  const to = String(req.query.to || from);
  const base = `SELECT a.*, c.name customer_name, c.phone customer_phone, k.make, k.model, k.plate, o.number order_number,
      st.name status_name, st.color status_color, s.name mechanic_name
    FROM appointments a LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN cars k ON k.id = a.car_id
    LEFT JOIN orders o ON o.id = a.order_id LEFT JOIN order_statuses st ON st.id = o.status_id LEFT JOIN staff s ON s.id = a.mechanic_id`;
  res.json({
    rows: all(`${base} WHERE a.start_at IS NOT NULL AND a.station_id IS NOT NULL AND substr(a.start_at,1,10) BETWEEN ? AND ? AND a.status <> 'cancelled' ORDER BY a.start_at`, from, to),
    unassigned: all(`${base} WHERE (a.station_id IS NULL OR a.start_at IS NULL) AND a.status IN ('request','planned') ORDER BY a.id DESC LIMIT 100`),
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
  const cond = ['p.active = 1'];
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
    const docId = insert('stock_docs', { type, number: nextNumber(type), doc_date: today(), note: 'Инвентаризация', created_by: s.name, total_net: round2(Math.abs(diff) * p.purchase_price) });
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
  if (!d.customer_id) throw new HttpError(400, 'Выберите клиента');
  let id = Number(b.id);
  if (id) update('storage', id, d); else id = insert('storage', { ...d, number: nextNumber('PR', new Date(), true) });
  log('storage', id, b.id ? 'update' : 'create', null, s.name);
  res.json({ id });
});
crm.post('/storage/:id/release', (req, res) => {
  const s = who(req, 'storage.edit');
  run('UPDATE storage SET date_out = ? WHERE id = ?', req.body?.date || today(), Number(req.params.id));
  log('storage', Number(req.params.id), 'release', null, s.name);
  res.json({ ok: true });
});

// ── Касса ──────────────────────────────────────────────────────────────────
crm.get('/cash', (req, res) => {
  who(req, 'cash.view');
  const from = String(req.query.from || today().slice(0, 8) + '01');
  const to = String(req.query.to || today());
  const rows = all(`SELECT p.*, o.number order_number, c.name customer_name FROM payments p LEFT JOIN orders o ON o.id = p.order_id
    LEFT JOIN customers c ON c.id = p.customer_id WHERE substr(p.created_at,1,10) BETWEEN ? AND ? ORDER BY p.id DESC LIMIT 1000`, from, to);
  const sum = (dir, method) => one(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE direction = ? ${method ? 'AND method = ?' : ''} AND substr(created_at,1,10) BETWEEN ? AND ?`,
    ...[dir, ...(method ? [method] : []), from, to]).s;
  res.json({
    rows,
    cashBalance: round2(one(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) s FROM payments WHERE method = 'cash'`).s
      + Number(getSetting('cash_opening', '0'))),
    period: { cashIn: sum('in', 'cash'), cashOut: sum('out', 'cash'), card: sum('in', 'card'), transfer: sum('in', 'transfer'), points: sum('in', 'points') },
  });
});
// ручные KP (приход) / KW (расход) наличных
crm.post('/cash', (req, res) => {
  const s = who(req, 'cash.edit');
  const direction = req.body?.direction === 'out' ? 'out' : 'in';
  const amount = round2(req.body?.amount);
  if (!(amount > 0)) throw new HttpError(400, 'Укажите сумму');
  const note = String(req.body?.note || '').trim();
  if (!note) throw new HttpError(400, 'Укажите назначение');
  insert('payments', { number: nextNumber(direction === 'in' ? 'KP' : 'KW'), direction, method: 'cash', amount, note, staff: s.name, customer_id: req.body?.customer_id || null });
  res.json({ ok: true });
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

// ── Расширение Chrome «Pulsecar для хуртовен» ──────────────────────────────
crm.post('/me/ext-token', (req, res) => {
  const s = who(req);
  const token = 'pcx_' + crypto.randomBytes(24).toString('base64url');
  run('UPDATE staff SET ext_token = ? WHERE id = ?', sha(token), s.id);
  res.json({ token, panel: config.publicUrl });
});
crm.delete('/me/ext-token', (req, res) => { const s = who(req); run('UPDATE staff SET ext_token = NULL WHERE id = ?', s.id); res.json({ ok: true }); });
crm.get('/ext/hello', (req, res) => {
  const s = who(req);
  const P = permsOf(s);
  res.json({ name: s.name, brand: getSetting('company_brand', 'Pulsecar'), can: { stock: P['stock.docs'] || P['suppliers.receive'], product: P['products.create'], order: P['orders.jobs'], quote: P['quotes.manage'] }, markup: Number(getSetting('default_markup', '40')) || 0 });
});
/** Открытые заказы и сметы для выпадающих списков расширения */
crm.get('/ext/orders', (req, res) => {
  const s = who(req, 'orders.view');
  const P = permsOf(s);
  const rows = all(`SELECT o.id, o.kind, o.number, c.name cname, k.make, k.model, k.plate FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN cars k ON k.id = o.car_id LEFT JOIN order_statuses st ON st.id = o.status_id WHERE COALESCE(st.is_final,0) = 0 ORDER BY o.id DESC LIMIT 300`);
  res.json({ orders: rows.filter((r) => r.kind === 'order'), quotes: P['quotes.manage'] ? rows.filter((r) => r.kind === 'quote') : [] });
});
/** Уточнить цены через API хуртовни (Inter Cars: ваша цена и рекомендованная розничная) и найти товар на складе */
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
/** «Pobierz do Pulsecar»: товар в картотеку, приход на склад, в заказ, в смету — одной кнопкой */
crm.post('/ext/pick', (req, res) => {
  const s = who(req, 'products.view');
  const P = permsOf(s);
  const b = req.body || {};
  const sup = SUP.wholesaler(b.supplier || 'other');
  const items = (b.items || []).map((i) => ({
    name: String(i.name || i.code || '').trim().slice(0, 250), code: i.code ? String(i.code).trim().slice(0, 60) : null, brand: i.brand ? String(i.brand).slice(0, 80) : null,
    sku: i.sku || null, ean: i.ean || null, qty: Math.max(0.01, Number(i.qty) || 1), price_net: round2(Number(i.price_net) || 0), sell_gross: round2(Number(i.sell_gross) || 0), vat: Number(i.vat ?? 23),
  })).filter((i) => i.name);
  if (!items.length) throw new HttpError(400, 'Нет товаров');
  if (!b.product && !b.stock && !b.order_id && !b.quote_id) throw new HttpError(400, 'Выберите, куда добавить: склад, заказ или смета');
  if (b.stock && !(P['stock.docs'] || P['suppliers.receive'])) throw new HttpError(403, 'Нет права на приход на склад');
  if (b.order_id && !P['orders.jobs']) throw new HttpError(403, 'Нет права добавлять запчасти в заказ');
  if (b.quote_id && !P['quotes.manage']) throw new HttpError(403, 'Нет права менять сметы');
  const bad = items.filter((i) => (b.stock || b.product) && i.price_net <= 0);
  if (bad.length && b.stock) throw new HttpError(400, `Цена закупки должна быть больше 0: ${bad.map((i) => i.code || i.name).join(', ')}`);
  const done = { products: 0, stock: null, order: null, quote: null };
  tx(() => {
    const pids = items.map((i) => {
      if (!(b.product || b.stock || b.order_id)) return null;
      const pid = findOrCreateProduct({ name: i.name, code: i.code, manufacturer: i.brand, supplier_sku: i.sku, ean: i.ean, supplier: sup.name, sell_price: i.sell_gross, price_net: i.price_net });
      // цена продажи = рекомендованная хуртовней, закупка = цена для сервиса
      if (i.sell_gross > 0) run('UPDATE products SET sell_price = ? WHERE id = ?', i.sell_gross, pid);
      if (i.price_net > 0) run('UPDATE products SET purchase_price = ? WHERE id = ?', i.price_net, pid);
      done.products++;
      return pid;
    });
    if (b.stock) {
      const docId = createStockDoc({ type: 'PZ', counterparty: sup.name, ext_number: b.ext_number || null, note: `${sup.name}: кнопка в хуртовне`,
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

// ── Настройки ──────────────────────────────────────────────────────────────
crm.put('/settings', (req, res) => {
  who(req, 'settings.manage');
  const allowed = ['company_name', 'company_brand', 'company_address', 'company_phone', 'company_email', 'company_nip', 'company_bank',
    'hours_start', 'hours_end', 'slot_min', 'default_vat', 'cash_opening', 'order_terms', ...SETTINGS_KEYS];
  for (const [k, v] of Object.entries(req.body || {})) if (allowed.includes(k)) setSetting(k, String(v ?? ''));
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
    rows: all('SELECT id, login, name, role, color, hourly_rate, commission_pct, is_mechanic, active, phone, email, last_login, permissions, stations, (pass_hash IS NOT NULL) has_password FROM staff ORDER BY active DESC, name')
      .map((r) => ({ ...r, permissions: r.permissions ? JSON.parse(r.permissions) : {}, stations: r.stations ? JSON.parse(r.stations) : [], effective: permsOf(r) })),
    groups: PERM_GROUPS, presets: PRESETS,
  });
});
crm.post('/staff', (req, res) => {
  const me = who(req, 'settings.manage');
  const b = req.body || {};
  if (!b.name) throw new HttpError(400, 'Имя обязательно');
  const d = {
    name: b.name, role: ['admin', 'staff', 'mechanic'].includes(b.role) ? b.role : 'mechanic', color: b.color || null,
    hourly_rate: Number(b.hourly_rate) || 0, commission_pct: Number(b.commission_pct) || 0, is_mechanic: b.is_mechanic ? 1 : 0,
    active: b.active === undefined ? 1 : (b.active ? 1 : 0), login: b.login || null,
    phone: b.phone ?? undefined, email: b.email ?? undefined,
    permissions: b.permissions !== undefined ? JSON.stringify(b.permissions || {}) : undefined,
    stations: b.stations !== undefined ? JSON.stringify(b.stations || []) : undefined,
  };
  if (b.revoke) { d.login = null; d.pass_hash = null; }
  if (d.login && one('SELECT 1 FROM staff WHERE login = ? AND id <> ?', d.login, Number(b.id) || 0)) throw new HttpError(409, 'Такой логин уже есть');
  if (b.password) {
    if (String(b.password).length < 8) throw new HttpError(400, 'Пароль — минимум 8 символов');
    d.pass_hash = hashPassword(b.password);
  }
  if (Number(b.id) === me.id && (!d.active || d.role !== 'admin')) throw new HttpError(400, 'Нельзя отключить или понизить самого себя');
  if (b.id) update('staff', Number(b.id), d); else insert('staff', d);
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
  intercars: () => IC.testIntercars(), fakturownia: () => testFakturownia(), smsapi: () => testSms(), email: () => testEmail(), tpay: () => testTpay(),
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

// ── Хуртовни: документы от любых поставщиков → склад или заказ ─────────────
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
/** Поиск детали у всех хуртовен с API (Inter Cars — по индексу, Hart — по коду Hart) */
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
const MSG_KEYS = ['sms_tpl_reminder', 'sms_tpl_card', 'sms_tpl_quote', 'sms_tpl_paylink', 'sms_tpl_code', 'sms_tpl_booking', 'sms_tpl_review',
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

// ── Печать: карта заказа / смета ────────────────────────────────────────────
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const zl = (n) => (Number(n) || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
crm.get('/print/order/:id', (req, res) => {
  who(req);
  const o = orderFull(Number(req.params.id));
  const S = Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
  const title = o.kind === 'quote' ? 'Wycena' : 'Zlecenie naprawy';
  const row = (i, n) => {
    const gross = i.qty * i.price * (1 - (i.discount || 0) / 100);
    return `<tr><td>${n}</td><td>${esc(i.name)}${i.code ? `<div class="m">${esc(i.code)}</div>` : ''}</td><td class="r">${i.qty}</td><td>${esc(i.unit || (i.kind === 'labor' ? 'usł.' : 'szt.'))}</td><td class="r">${zl(i.price)}</td><td class="r">${i.discount ? i.discount + '%' : ''}</td><td class="r">${zl(gross)}</td></tr>`;
  };
  const labor = o.items.filter((i) => i.kind === 'labor');
  const parts = o.items.filter((i) => i.kind === 'part');
  const c = o.customer || {};
  const k = o.car || {};
  const f = o.flags || {};
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${esc(o.number)}</title>
<style>
 body{font:12px/1.45 Arial,Helvetica,sans-serif;color:#111;margin:24px;max-width:800px}
 h1{font-size:20px;margin:0}.top{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}
 .logo{height:42px}.m{color:#666;font-size:11px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
 .box{border:1px solid #bbb;border-radius:6px;padding:8px 10px}.box b{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#555;margin-bottom:4px}
 table{width:100%;border-collapse:collapse;margin:6px 0 12px}th,td{border-bottom:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top}
 th{font-size:10px;text-transform:uppercase;color:#555}.r{text-align:right}.tot{font-size:16px;font-weight:bold;text-align:right}
 .sig{display:flex;justify-content:space-between;margin-top:50px}.sig div{border-top:1px solid #111;width:40%;text-align:center;padding-top:4px;font-size:11px}
 .terms{font-size:10px;color:#444;margin-top:18px;white-space:pre-wrap}
 @media print{body{margin:0}.noprint{display:none}}
</style></head><body>
<p class="noprint"><button onclick="print()">Drukuj / Печать</button></p>
<div class="top"><div><img class="logo" src="/logo-dark.png" alt="Pulsecar"><div class="m">${esc(S.company_name)} · ${esc(S.company_address)}<br>${esc(S.company_phone)} · ${esc(S.company_email)}${S.company_nip ? ' · NIP ' + esc(S.company_nip) : ''}</div></div>
<div style="text-align:right"><h1>${title}</h1><div style="font-size:16px;font-weight:bold">${esc(o.number)}</div><div class="m">Data przyjęcia: ${esc(o.created_at?.slice(0, 16))}${o.pickup_at ? '<br>Termin odbioru: ' + esc(o.pickup_at) : ''}</div></div></div>
<div class="grid"><div class="box"><b>Klient</b>${esc(c.company || c.name || '—')}<br>${esc(c.phone || '')}${c.nip ? '<br>NIP ' + esc(c.nip) : ''}${c.street ? '<br>' + esc(c.street) + ', ' + esc(c.postcode || '') + ' ' + esc(c.city || '') : ''}</div>
<div class="box"><b>Pojazd</b>${esc([k.make, k.model, k.year].filter(Boolean).join(' ') || '—')}<br>Nr rej.: ${esc(k.plate || '—')} · VIN: ${esc(k.vin || '—')}<br>Przebieg: ${o.mileage ? esc(o.mileage) + ' km' : '—'}${o.fuel_level ? ' · Paliwo: ' + esc(o.fuel_level) : ''}</div></div>
${o.complaint ? `<div class="box" style="margin-bottom:12px"><b>Opis zgłoszenia</b>${esc(o.complaint)}</div>` : ''}
${labor.length ? `<table><thead><tr><th>#</th><th>Usługa</th><th class="r">Ilość</th><th>J.m.</th><th class="r">Cena</th><th class="r">Rabat</th><th class="r">Wartość brutto</th></tr></thead><tbody>${labor.map((i, n) => row(i, n + 1)).join('')}</tbody></table>` : ''}
${parts.length ? `<table><thead><tr><th>#</th><th>Części</th><th class="r">Ilość</th><th>J.m.</th><th class="r">Cena</th><th class="r">Rabat</th><th class="r">Wartość brutto</th></tr></thead><tbody>${parts.map((i, n) => row(i, n + 1)).join('')}</tbody></table>` : ''}
<div class="tot">Razem brutto: ${zl(o.total)} zł</div><div class="m" style="text-align:right">netto ${zl(o.total_net)} zł${o.paid ? ` · zapłacono ${zl(o.paid)} zł` : ''}</div>
<div class="grid" style="margin-top:12px"><div class="box"><b>Zgody / uwagi</b>Zwrot części: ${f.return_parts ? 'TAK' : 'NIE'} · Dowód rejestracyjny: ${f.reg_doc ? 'TAK' : 'NIE'} · Jazda próbna: ${f.test_drive ? 'TAK' : 'NIE'}</div>
<div class="box"><b>Gwarancja</b>6 miesięcy na usługę · części wg gwarancji producenta</div></div>
${S.order_terms ? `<div class="terms">${esc(S.order_terms)}</div>` : ''}
<div class="sig"><div>Podpis przyjmującego</div><div>Podpis klienta</div></div>
</body></html>`);
});
