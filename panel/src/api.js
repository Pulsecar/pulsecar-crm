import express from 'express';
import crypto from 'node:crypto';
import { all, one, run, tx, insert } from './db.js';
import { config } from './config.js';
import { HttpError, newCardNo, normPhone, normPlate, normVin, randomHex, safeEqual, sha256 } from './util.js';
import { sendSms } from './sms.js';
import { loyaltySummary, welcomeBonus } from './loyalty.js';
import { notify } from './integrations/notify.js';
import { cardUrl } from './messaging.js';
import { getSetting } from './db.js';
import { listForCar, clientRec } from './recommendations.js';
import { sendOrderFile } from './documents.js';
import { invoicePdf } from './invoices.js';
import { freeWindows, pickStation } from './booking-slots.js';

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
async function sendLoginCode(phone, langIn) {
  const prev = one('SELECT sent_at FROM otp WHERE phone = ?', phone);
  if (prev && Date.now() - prev.sent_at < 60_000) throw new HttpError(429, 'Код уже отправлен. Повторить можно через минуту.');
  if (isReview(phone)) return;
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  run(
    'INSERT OR REPLACE INTO otp (phone, code_hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)',
    phone, sha256(phone + code), Date.now() + 10 * 60_000, Date.now(),
  );
  const lang = { ua: 'uk', by: 'ru' }[String(langIn || 'pl')] || String(langIn || 'pl');
  const text = {
    pl: `Pulsecar: Twój kod logowania to ${code}`,
    en: `Pulsecar: your login code is ${code}`,
    uk: `Pulsecar: ваш код входу ${code}`,
    ru: `Pulsecar: ваш код входа ${code}`,
  }[lang] || `Pulsecar: ${code}`;
  await sendSms(phone, text, { kind: 'code' });
}

api.post('/auth/request', async (req, res) => {
  const phone = normPhone(req.body?.phone);
  if (!phone) throw new HttpError(400, 'Неверный номер телефона.');
  limit('ip:' + req.ip, 20, 3600_000);
  limit('ph:' + phone, 5, 3600_000);
  await sendLoginCode(phone, req.body?.lang);
  res.json({ ok: true });
});

// ── Вход на сайте pulsecar.pl/moje-auto: номер авто (или VIN) + телефон владельца из CRM ──
// Код уходит только если авто с таким номером/VIN числится за клиентом с этим телефоном.
// Ответ одинаковый для «нет такого авто» и «телефон не совпадает» — нельзя перебором узнать, чьё авто.
export function findOwnedCar(carInput, phone) {
  const raw = String(carInput || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length < 4) return null;
  const vin = normVin(raw);
  const plate = normPlate(raw);
  const cars = vin ? all('SELECT * FROM cars WHERE vin = ?', vin) : all('SELECT * FROM cars WHERE plate = ?', plate);
  for (const k of cars) {
    const owner = k.customer_id ? one('SELECT id, phone FROM customers WHERE id = ?', k.customer_id) : null;
    if (owner?.phone && normPhone(owner.phone) === phone) return k;
  }
  return null;
}
api.post('/auth/car-request', async (req, res) => {
  const phone = normPhone(req.body?.phone);
  const carRaw = String(req.body?.car || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!phone) throw new HttpError(400, 'Неверный номер телефона.');
  if (carRaw.length < 4) throw new HttpError(400, 'Укажите номер авто или VIN.');
  limit('cip:' + req.ip, 15, 3600_000);
  limit('cph:' + phone, 5, 3600_000);
  const car = findOwnedCar(carRaw, phone);
  if (!car) throw new HttpError(404, 'Авто с таким номером не найдено у клиента с этим телефоном.');
  await sendLoginCode(phone, req.body?.lang);
  res.json({ ok: true, carId: car.id });
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
  // сервисная книжка: файлы (фото, видео, документы), отмеченные «видно клиенту», и гарантия на работы
  const showFiles = getSetting('card_files', '1') !== '0';
  const showInvoice = getSetting('card_show_invoice', '1') === '1';
  const files = showFiles ? all(`SELECT f.id, f.order_id, f.name, f.mime, f.size, f.created_at FROM order_files f JOIN orders o ON o.id = f.order_id
    WHERE o.customer_id = ? AND f.client_visible = 1 ORDER BY f.id`, c.id) : [];
  const warrantyMonths = Number(getSetting('warranty_labor_months', '6')) || 6;
  const addMonths = (d, n) => { const x = new Date(d.slice(0, 10) + 'T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
  const visitOut = (v) => ({
    id: v.id, orderNo: v.number, date: (v.closed_at || v.created_at || '').slice(0, 10), mileage: v.mileage, total: v.total,
    complaint: v.complaint || null, afterNotes: v.after_notes || null,
    warrantyUntil: v.is_final && v.closed_at && items.some((i) => i.order_id === v.id && i.kind === 'labor') ? addMonths(v.closed_at, warrantyMonths) : null,
    invoice: showInvoice && v.invoice_ext_id ? { no: v.invoice_no || null } : null,
    files: files.filter((f) => f.order_id === v.id).map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size })),
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
      engine: car.engine || null, fuel: car.fuel || null, inspectionUntil: car.inspection_until || null, insuranceUntil: car.insurance_until || null,
      recommendations: listForCar(car.id, { openOnly: true }).map((r) => clientRec(r, car.last_mileage)),
      done: listForCar(car.id).filter((r) => r.status === 'done').slice(0, 20).map((r) => ({ title: r.title, closedAt: (r.closed_at || '').slice(0, 10), orderNo: r.closed_order_no || null })),
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
// Рекомендация из сервисной книжки — только по своим авто
function ownRec(customerId, recId) {
  const r = one(`SELECT r.*, k.plate, k.make, k.model, k.customer_id FROM car_recommendations r JOIN cars k ON k.id = r.car_id WHERE r.id = ?`, Number(recId));
  if (!r || r.customer_id !== customerId) throw new HttpError(404, 'Рекомендация не найдена');
  return r;
}

// Свободные окна для записи на работу из рекомендации (длительность — из поля «Время» в CRM)
api.get('/recommendations/:id/slots', (req, res) => {
  const s = auth(req);
  const r = ownRec(s.customer_id, req.params.id);
  if (!r.duration_min) return res.json({ durationMin: null, days: [] });
  res.json({ durationMin: r.duration_min, days: freeWindows(r.duration_min, r.title) });
});

api.post('/bookings', (req, res) => {
  limit('b:' + req.ip, 10, 3600_000);
  const b = req.body || {};
  const phone = normPhone(b.phone);
  const name = String(b.name || '').trim().slice(0, 80);
  if (!phone || !name) throw new HttpError(400, 'Имя и телефон обязательны.');
  // если клиент вошёл в приложение / на сайте — привязываем к его карточке
  const t = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const sess = t && one('SELECT customer_id FROM sessions WHERE token_hash = ? AND revoked = 0', sha256(t));
  const customer = sess ? one('SELECT * FROM customers WHERE id = ?', sess.customer_id) : one('SELECT * FROM customers WHERE phone = ?', phone);
  const rec = sess && b.rec_id ? ownRec(sess.customer_id, b.rec_id) : null;
  const src = b.source === 'site' ? 'site' : 'app';
  const where = src === 'site' ? 'с сайта (Моё авто)' : 'из приложения';
  const text = [b.service, b.car, b.problem].map((x) => String(x || '').trim()).filter(Boolean).join(' · ').slice(0, 1000);
  const carLine = rec ? [rec.make, rec.model].filter(Boolean).join(' ') + (rec.plate ? ' · ' + rec.plate : '') : '';

  // запись на конкретное окно (работа из рекомендации с известной длительностью)
  if (rec && b.start_at) {
    const duration = rec.duration_min || 60;
    const st = pickStation(duration, rec.title, String(b.start_at));
    if (!st) throw new HttpError(409, 'Это время уже занято. Выберите другое окно.');
    const id = tx(() => {
      const aid = insert('appointments', {
        station_id: st.id, customer_id: customer?.id ?? null, car_id: rec.car_id,
        title: `${rec.title}${rec.plate ? ' · ' + rec.plate : ''}`.slice(0, 120),
        note: [`Онлайн-запись ${where}`, rec.note, b.problem && String(b.problem).slice(0, 500)].filter(Boolean).join('\n'),
        start_at: String(b.start_at), duration_min: duration, status: 'planned', source: src, contact_name: name, contact_phone: phone,
      });
      run('UPDATE car_recommendations SET appointment_id = ? WHERE id = ?', aid, rec.id);
      return aid;
    });
    notify('booking', `📅 Онлайн-запись ${where}: ${name}, ${phone}\n🕒 ${b.start_at} (${duration} мин) · ${st.name}\n🔧 ${rec.title}\n🚗 ${carLine}${b.problem ? '\n📝 ' + String(b.problem).slice(0, 300) : ''}`, { name, phone, appointment: id });
    return res.json({ ok: true, id, start_at: String(b.start_at), duration_min: duration, station: st.name, booked: true });
  }

  const id = insert('appointments', {
    station_id: null, customer_id: customer?.id ?? null, car_id: rec?.car_id ?? null, title: String(rec?.title || b.service || 'Заявка из приложения').slice(0, 120),
    note: text, status: 'request', source: src, contact_name: name, contact_phone: phone,
    preferred: String(b.preferred || '').slice(0, 120) || null, duration_min: rec?.duration_min || 60,
  });
  if (rec) run('UPDATE car_recommendations SET appointment_id = ? WHERE id = ?', id, rec.id);
  notify('booking', `Новая заявка ${where}: ${name}, ${phone}\n${text}${b.preferred ? '\nКогда удобно: ' + b.preferred : ''}`, { name, phone, text });
  res.json({ ok: true, id });
});

// ── Сервисная книжка: файлы заказа и фактура — только свои и только «видно клиенту» ──
api.get('/files/:id', (req, res) => {
  const s = auth(req);
  if (getSetting('card_files', '1') === '0') throw new HttpError(404, 'Файл не найден');
  const f = one(`SELECT f.* FROM order_files f JOIN orders o ON o.id = f.order_id WHERE f.id = ? AND f.client_visible = 1 AND o.customer_id = ?`, Number(req.params.id), s.customer_id);
  if (!f) throw new HttpError(404, 'Файл не найден');
  sendOrderFile(res, f, req.query.download === '1');
});
api.get('/orders/:id/invoice.pdf', async (req, res) => {
  const s = auth(req);
  const o = one(`SELECT * FROM orders WHERE id = ? AND customer_id = ? AND kind = 'order'`, Number(req.params.id), s.customer_id);
  if (!o?.invoice_ext_id || getSetting('card_show_invoice', '1') !== '1') throw new HttpError(404, 'Фактура не найдена');
  const pdf = await invoicePdf(o.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Faktura-${String(o.invoice_no || o.id).replace(/[^\w-]/g, '-')}.pdf"`);
  res.send(pdf);
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
