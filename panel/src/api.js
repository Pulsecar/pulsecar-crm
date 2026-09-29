import express from 'express';
import crypto from 'node:crypto';
import { all, one, run, tx, insert } from './db.js';
import { config } from './config.js';
import { HttpError, newCardNo, normPhone, randomHex, safeEqual, sha256 } from './util.js';
import { sendSms } from './sms.js';
import { loyaltySummary, welcomeBonus } from './loyalty.js';
import { notify } from './integrations/notify.js';
import { cardUrl } from './messaging.js';

export const api = express.Router();
api.use(express.json({ limit: '50kb' }));

// простое ограничение частоты по IP
const hits = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => t > now - windowMs);
  if (arr.length >= max) throw new HttpError(429, 'Слишком много попыток. Попробуйте позже.');
  arr.push(now);
  hits.set(key, arr);
}

const isReview = (phone) => config.reviewPhone && normPhone(config.reviewPhone) === phone && config.reviewCode;

// ── Вход по номеру телефона ────────────────────────────────────────────────
api.post('/auth/request', async (req, res) => {
  const phone = normPhone(req.body?.phone);
  if (!phone) throw new HttpError(400, 'Неверный номер телефона.');
  limit('ip:' + req.ip, 20, 3600_000);
  limit('ph:' + phone, 5, 3600_000);
  const prev = one('SELECT sent_at FROM otp WHERE phone = ?', phone);
  if (prev && Date.now() - prev.sent_at < 60_000) throw new HttpError(429, 'Код уже отправлен. Повторить можно через минуту.');
  if (isReview(phone)) return res.json({ ok: true });

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  run(
    'INSERT OR REPLACE INTO otp (phone, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)',
    phone, sha256(phone + code), Date.now() + 10 * 60_000, Date.now(),
  );
  const lang = String(req.body?.lang || 'pl');
  const text = {
    pl: `Pulsecar: Twój kod logowania to ${code}`,
    en: `Pulsecar: your login code is ${code}`,
    uk: `Pulsecar: ваш код входу ${code}`,
    ru: `Pulsecar: ваш код входа ${code}`,
  }[lang] || `Pulsecar: ${code}`;
  await sendSms(phone, text, { kind: 'code' });
  res.json({ ok: true });
});

api.post('/auth/verify', (req, res) => {
  const phone = normPhone(req.body?.phone);
  const code = String(req.body?.code || '').replace(/\D/g, '');
  if (!phone || code.length !== 6) throw new HttpError(400, 'Введите 6 цифр из SMS.');
  limit('v:' + req.ip, 30, 3600_000);

  if (!(isReview(phone) && safeEqual(code, config.reviewCode))) {
    const o = one('SELECT * FROM otp WHERE phone = ?', phone);
    if (!o || o.expires_at < Date.now()) throw new HttpError(400, 'Код истёк. Запросите новый.');
    if (o.attempts >= 5) throw new HttpError(429, 'Слишком много попыток. Запросите новый код.');
    if (!safeEqual(o.code_hash, sha256(phone + code))) {
      run('UPDATE otp SET attempts = attempts + 1 WHERE phone = ?', phone);
      throw new HttpError(400, 'Неверный код.');
    }
    run('DELETE FROM otp WHERE phone = ?', phone);
  }

  const token = randomHex(32);
  const qrSecret = randomHex(32);
  const customer = tx(() => {
    let c = one('SELECT * FROM customers WHERE phone = ?', phone);
    if (!c) {
      run('INSERT INTO customers (phone, card_no) VALUES (?, ?)', phone, newCardNo());
      c = one('SELECT * FROM customers WHERE id = last_insert_rowid()');
    }
    if (!c.registered_at) {
      run(`UPDATE customers SET registered_at = datetime('now') WHERE id = ?`, c.id);
      welcomeBonus(c.id);
    }
    run('INSERT INTO sessions (customer_id, token_hash, qr_secret, device) VALUES (?, ?, ?, ?)', c.id, sha256(token), qrSecret, String(req.body?.device || '').slice(0, 80));
    return c;
  });
  res.json({ token, qrSecret, cardNo: customer.card_no });
});

// ── Авторизованные запросы ─────────────────────────────────────────────────
function auth(req) {
  const t = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const s = t && one('SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0', sha256(t));
  if (!s) throw new HttpError(401, 'Войдите заново.');
  run(`UPDATE sessions SET last_seen = datetime('now') WHERE id = ?`, s.id);
  return s;
}

api.get('/me', (req, res) => {
  const s = auth(req);
  const c = one('SELECT * FROM customers WHERE id = ?', s.customer_id);
  const cars = all('SELECT * FROM cars WHERE customer_id = ? ORDER BY id', c.id);
  // клиент видит заказы (не сметы): завершённые — как историю, открытые — со статусом
  const orders = all(
    `SELECT o.*, st.is_final, st.client_label, st.name status_name, st.color status_color FROM orders o
     LEFT JOIN order_statuses st ON st.id = o.status_id
     WHERE o.customer_id = ? AND o.kind = 'order' ORDER BY COALESCE(o.closed_at, o.created_at) DESC, o.id DESC`, c.id,
  );
  const items = all(
    `SELECT i.* FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.customer_id = ? AND o.kind IN ('order','quote') ORDER BY i.pos, i.id`, c.id,
  );
  const lastId = orders[0]?.id;
  const safeCard = (id) => { try { return cardUrl(id); } catch { return null; } };
  // выцены, которые ждут решения клиента (не завершены и ещё не стали заказом)
  const quotes = all(
    `SELECT o.*, st.is_final, k.make, k.model, k.plate FROM orders o LEFT JOIN order_statuses st ON st.id = o.status_id LEFT JOIN cars k ON k.id = o.car_id
     WHERE o.customer_id = ? AND o.kind = 'quote' AND COALESCE(st.is_final,0) = 0 AND o.total > 0
       AND NOT EXISTS (SELECT 1 FROM orders z WHERE z.quote_id = o.id) AND o.created_at >= datetime('now','-120 days')
     ORDER BY o.id DESC LIMIT 10`, c.id,
  );
  const storage = all(`SELECT s.*, k.make, k.model, k.plate FROM storage s LEFT JOIN cars k ON k.id = s.car_id WHERE s.customer_id = ? AND s.date_out IS NULL ORDER BY s.id DESC`, c.id);
  const days = (a) => Math.max(1, Math.round((Date.now() - new Date(a + 'T12:00:00').getTime()) / 86400000) + 1);
  const visitOut = (v) => ({
    orderNo: v.number, date: (v.closed_at || v.created_at || '').slice(0, 10), mileage: v.mileage, total: v.total,
    active: !v.is_final, status: v.client_label || v.status_name || null, statusColor: v.status_color || null,
    due: Math.max(0, Math.round(((v.total || 0) - (v.paid || 0)) * 100) / 100), payLink: v.pay_link || null,
    cardUrl: !v.is_final || v.id === lastId ? safeCard(v.id) : null,
    items: items.filter((i) => i.order_id === v.id).map((i) => ({ name: i.name, kind: i.kind === 'part' ? 'część' : 'usługa', qty: i.qty, price: i.price })),
  });
  const upcoming = all(
    `SELECT a.start_at, a.status, a.title, st.name station FROM appointments a LEFT JOIN stations st ON st.id = a.station_id
     WHERE a.customer_id = ? AND a.status IN ('planned','request') AND (a.start_at IS NULL OR a.start_at >= datetime('now','localtime','-2 hours'))
     ORDER BY a.start_at LIMIT 5`, c.id,
  );
  res.json({
    serverTime: Date.now(),
    customer: { name: c.name, phone: c.phone, email: c.email, cardNo: c.card_no, since: c.registered_at },
    loyalty: loyaltySummary(c.id),
    cars: cars.map((car) => ({
      id: car.id, plate: car.plate, vin: car.vin, make: car.make, model: car.model, year: car.year == null ? null : String(car.year).replace(/\.0+$/, ''), lastMileage: car.last_mileage,
      visits: orders.filter((v) => v.car_id === car.id).map(visitOut),
    })),
    otherVisits: orders.filter((v) => !v.car_id || !cars.some((k) => k.id === v.car_id)).map(visitOut),
    activeOrders: orders.filter((v) => !v.is_final).map(visitOut),
    appointments: upcoming.map((a) => ({ start: a.start_at, status: a.status, title: a.title })),
    quotes: quotes.map((q) => ({
      no: q.number, date: (q.created_at || '').slice(0, 10), total: q.total, accepted: !!q.accepted_at,
      car: [q.make, q.model].filter(Boolean).join(' ') || q.plate || null, plate: q.plate || null, cardUrl: safeCard(q.id),
      items: items.filter((i) => i.order_id === q.id).map((i) => ({ name: i.name, kind: i.kind === 'part' ? 'część' : 'usługa', qty: i.qty, price: i.price })),
    })),
    storage: storage.map((x) => {
      const due = x.kind === 'parking' ? Math.round(days(x.date_in) * (x.price || 0) * 100) / 100 : x.price || 0;
      return { no: x.number, kind: x.kind, description: x.description, qty: x.qty, since: x.date_in, until: x.date_until,
        car: [x.make, x.model].filter(Boolean).join(' ') || null, plate: x.plate || null, due, paid: x.paid || 0 };
    }),
    transactions: all('SELECT * FROM transactions WHERE customer_id = ? ORDER BY id DESC LIMIT 100', c.id).map((t) => ({
      type: t.type, points: t.points, amount: t.amount_pln, orderNo: t.order_no, date: t.created_at, note: t.note,
    })),
  });
});

// ── Заявка на визит из приложения → «Не распределено» в терминарзе CRM ─────
api.post('/bookings', (req, res) => {
  limit('b:' + req.ip, 10, 3600_000);
  const b = req.body || {};
  const phone = normPhone(b.phone);
  const name = String(b.name || '').trim().slice(0, 80);
  if (!phone || !name) throw new HttpError(400, 'Имя и телефон обязательны.');
  // если клиент вошёл в приложение — привязываем к его карточке
  const t = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const sess = t && one('SELECT customer_id FROM sessions WHERE token_hash = ? AND revoked = 0', sha256(t));
  const customer = sess ? one('SELECT * FROM customers WHERE id = ?', sess.customer_id) : one('SELECT * FROM customers WHERE phone = ?', phone);
  const text = [b.service, b.car, b.problem].map((x) => String(x || '').trim()).filter(Boolean).join(' · ').slice(0, 1000);
  const id = insert('appointments', {
    station_id: null, customer_id: customer?.id ?? null, title: String(b.service || 'Заявка из приложения').slice(0, 120),
    note: text, status: 'request', source: 'app', contact_name: name, contact_phone: phone,
    preferred: String(b.preferred || '').slice(0, 120) || null, duration_min: 60,
  });
  notify('booking', `Новая заявка из приложения: ${name}, ${phone}\n${text}${b.preferred ? '\nКогда удобно: ' + b.preferred : ''}`, { name, phone, text });
  res.json({ ok: true, id });
});

api.post('/auth/logout', (req, res) => {
  const s = auth(req);
  run('UPDATE sessions SET revoked = 1 WHERE id = ?', s.id);
  res.json({ ok: true });
});

// Удаление аккаунта в приложении (требование App Store / Google Play).
// История обслуживания из CRM остаётся у сервиса, удаляются вход, QR-ключи и баллы.
api.post('/me/delete', (req, res) => {
  const s = auth(req);
  tx(() => {
    run('UPDATE sessions SET revoked = 1 WHERE customer_id = ?', s.customer_id);
    run('DELETE FROM transactions WHERE customer_id = ?', s.customer_id);
    run('UPDATE customers SET registered_at = NULL WHERE id = ?', s.customer_id);
  });
  res.json({ ok: true });
});
