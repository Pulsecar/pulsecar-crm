// Сервисная книжка: рекомендации «что пора сделать» по автомобилю.
// Механик / приёмщик добавляет их в заказе (или переносит из чек-листа), клиент видит их
// на pulsecar.pl/moje-auto и в приложении, за N дней до срока уходит SMS-напоминание.
import { all, one, run, insert, getSetting } from './db.js';
import { HttpError } from './util.js';

export const PRIORITIES = ['urgent', 'soon', 'later'];

/** Готовые рекомендации: название, через сколько месяцев и/или км (для кнопок в заказе) */
export const PRESETS = [
  { title: 'Wymiana oleju silnikowego i filtrów', months: 12, km: 15000, priority: 'later', hours: 1 },
  { title: 'Wymiana płynu hamulcowego', months: 24, priority: 'later', hours: 1 },
  { title: 'Serwis klimatyzacji', months: 12, priority: 'later', hours: 1 },
  { title: 'Wymiana klocków hamulcowych', months: 3, priority: 'soon', hours: 1 },
  { title: 'Wymiana tarcz i klocków hamulcowych', months: 3, priority: 'soon', hours: 1.5 },
  { title: 'Wymiana rozrządu', km: 10000, priority: 'soon', hours: 4 },
  { title: 'Wymiana świec zapłonowych', km: 10000, priority: 'later', hours: 1 },
  { title: 'Wymiana filtra kabinowego', months: 12, priority: 'later', hours: 0.5 },
  { title: 'Wymiana opon na sezonowe', months: 6, priority: 'later', hours: 1 },
  { title: 'Geometria kół', months: 1, priority: 'soon', hours: 1 },
  { title: 'Wymiana akumulatora', months: 2, priority: 'soon', hours: 0.5 },
  { title: 'Naprawa zawieszenia (luzy)', months: 1, priority: 'urgent', hours: 2 },
];

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const today = () => new Date().toISOString().slice(0, 10);

function data(b, partial) {
  const o = {};
  if (!partial || b.title !== undefined) { o.title = clean(b.title, 160); if (!o.title) throw new HttpError(400, 'Напишите, что рекомендуется сделать'); }
  if (b.note !== undefined) o.note = clean(b.note, 1000) || null;
  if (!partial || b.priority !== undefined) o.priority = PRIORITIES.includes(b.priority) ? b.priority : 'soon';
  if (b.due_date !== undefined) { if (b.due_date && !isDate(b.due_date)) throw new HttpError(400, 'Дата в формате ГГГГ-ММ-ДД'); o.due_date = b.due_date || null; }
  if (b.due_km !== undefined) o.due_km = b.due_km === '' || b.due_km == null ? null : Math.max(0, Math.round(Number(b.due_km) || 0)) || null;
  if (b.duration_min !== undefined) o.duration_min = b.duration_min === '' || b.duration_min == null ? null : Math.min(16 * 60, Math.max(15, Math.round((Number(b.duration_min) || 0) / 15) * 15)) || null;
  if (b.est_price !== undefined) o.est_price = b.est_price === '' || b.est_price == null ? null : Math.max(0, Math.round(Number(String(b.est_price).replace(',', '.')) * 100) / 100) || null;
  return o;
}

export function listForCar(carId, { openOnly = false } = {}) {
  syncQuotes(carId);
  return all(`SELECT r.*, o.number order_no, z.number closed_order_no, a.start_at appt_start, a.status appt_status, q.number quote_no FROM car_recommendations r
    LEFT JOIN orders o ON o.id = r.order_id LEFT JOIN orders z ON z.id = r.closed_order_id
    LEFT JOIN appointments a ON a.id = r.appointment_id LEFT JOIN orders q ON q.id = r.quote_id
    WHERE r.car_id = ? ${openOnly ? "AND r.status = 'open'" : ''}
    ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, CASE r.priority WHEN 'urgent' THEN 0 WHEN 'soon' THEN 1 ELSE 2 END, COALESCE(r.due_date, '9999'), r.id DESC`, carId);
}

export function createRec(b, staffName) {
  const car = one('SELECT id FROM cars WHERE id = ?', Number(b.car_id));
  if (!car) throw new HttpError(400, 'Выберите авто');
  const order = b.order_id ? one('SELECT id, car_id FROM orders WHERE id = ?', Number(b.order_id)) : null;
  return insert('car_recommendations', { car_id: car.id, order_id: order?.id ?? null, ...data(b, false), staff: staffName || null });
}

export function updateRec(id, b) {
  const r = one('SELECT * FROM car_recommendations WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Рекомендация не найдена');
  const o = data(b, true);
  // «по выцене»: состав, цену и время берём из выцены — здесь меняются только срок, важность и статус
  if (r.quote_id) for (const k of ['title', 'note', 'est_price', 'duration_min']) delete o[k];
  if (b.status !== undefined) {
    if (!['open', 'done', 'dismissed'].includes(b.status)) throw new HttpError(400, 'Неверный статус');
    o.status = b.status;
    o.closed_at = b.status === 'open' ? null : r.closed_at || new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (b.status === 'open') o.closed_order_id = null;
    if (b.status === 'open' && (o.due_date !== undefined || o.due_km !== undefined)) o.reminded_at = null;
  }
  if (o.due_date !== undefined && o.due_date !== r.due_date) o.reminded_at = null;
  const keys = Object.keys(o);
  if (keys.length) run(`UPDATE car_recommendations SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map((k) => o[k]), id);
  return one('SELECT * FROM car_recommendations WHERE id = ?', id);
}

export const deleteRec = (id) => run('DELETE FROM car_recommendations WHERE id = ?', id);

/** Пункты чек-листа заказа с «! Внимание» / «✗ Заменить» → рекомендации (без дублей) */
export function fromChecklists(orderId, staffName) {
  const o = one('SELECT id, car_id FROM orders WHERE id = ?', orderId);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  if (!o.car_id) throw new HttpError(400, 'В заказе не выбрано авто');
  const have = new Set(listForCar(o.car_id, { openOnly: true }).map((r) => norm(r.title)));
  let added = 0;
  for (const c of all('SELECT * FROM order_checklists WHERE order_id = ?', o.id)) {
    let results = [];
    try { results = JSON.parse(c.results || '[]'); } catch { /* ignore */ }
    for (const x of results) {
      if (x.state !== 'bad' && x.state !== 'warn') continue;
      const title = clean(x.item, 160);
      if (!title || have.has(norm(title))) continue;
      have.add(norm(title));
      insert('car_recommendations', { car_id: o.car_id, order_id: o.id, title, note: clean(x.note, 1000) || null, priority: x.state === 'bad' ? 'urgent' : 'soon', staff: staffName || null });
      added++;
    }
  }
  return added;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9а-яё]+/g, ' ').trim();
const STOP = new Set(['wymiana', 'naprawa', 'serwis', 'i', 'oraz', 'na', 'do', 'z', 'w', 'kpl', 'komplet', 'przod', 'tyl', 'przednich', 'tylnych', 'przednie', 'tylne', 'replace', 'the', 'and']);
const words = (s) => norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5));

/** Похоже ли название работы/запчасти в заказе на рекомендацию (по корням значимых слов) */
export function matches(recTitle, itemName) {
  const a = words(recTitle);
  if (!a.length) return false;
  const b = new Set(words(itemName));
  const hit = a.filter((w) => b.has(w)).length;
  return hit >= Math.min(2, a.length);
}

/** При завершении заказа: рекомендации по этому авто, которые сделаны в заказе, закрываются сами */
export function autoClose(orderId) {
  const o = one('SELECT id, car_id, closed_at FROM orders WHERE id = ?', orderId);
  if (!o?.car_id) return 0;
  const items = all(`SELECT name FROM order_items WHERE order_id = ?`, o.id).map((i) => i.name);
  let n = 0;
  for (const r of all(`SELECT * FROM car_recommendations WHERE car_id = ? AND status = 'open' AND COALESCE(order_id, 0) <> ?`, o.car_id, o.id)) {
    if (items.some((name) => matches(r.title, name))) {
      run(`UPDATE car_recommendations SET status = 'done', closed_order_id = ?, closed_at = COALESCE(?, datetime('now')) WHERE id = ?`, o.id, o.closed_at, r.id);
      n++;
    }
  }
  return n;
}

/** Срок рекомендации: просрочена / скоро / позже — по дате и/или пробегу */
export function urgency(r, mileage) {
  const d = r.due_date ? Math.round((new Date(r.due_date + 'T12:00:00Z') - new Date(today() + 'T12:00:00Z')) / 86400000) : null;
  const km = r.due_km && mileage ? r.due_km - mileage : null;
  if ((d !== null && d < 0) || (km !== null && km <= 0)) return 'overdue';
  if (r.priority === 'urgent' || (d !== null && d <= 30) || (km !== null && km <= 1500)) return 'soon';
  return 'later';
}

// ── Выцены в сервисной книжке ───────────────────────────────────────────────
const LABOR_HOURS = (i) => (i.kind === 'labor' && !/szt|us/i.test(String(i.unit || '')) ? Number(i.qty) || 0 : 0);
const fmtZl = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' zł';

/** Текст для клиента из позиций выцены: название (главные работы) и список позиций */
function quoteSummary(q, items) {
  const labor = items.filter((i) => i.kind === 'labor');
  const main = (labor.length ? labor : items).map((i) => i.name);
  let title = main.slice(0, 2).join(', ');
  if (main.length > 2) title += ` + ${main.length - 2}`;
  title = clean(`${title || 'Wycena'} (wycena ${q.number})`, 160);
  const lines = items.map((i) => `• ${i.name}${Number(i.qty) !== 1 ? ` — ${String(i.qty).replace('.', ',')} ${i.unit || ''}`.trimEnd() : ''}: ${fmtZl(i.price * i.qty * (1 - (Number(i.discount) || 0) / 100))}`);
  const hours = items.reduce((a, i) => a + LABOR_HOURS(i), 0);
  return {
    title, note: clean([q.complaint, lines.join('\n')].filter(Boolean).join('\n'), 1000) || null,
    est_price: Math.round((Number(q.total) || 0) * 100) / 100 || null,
    duration_min: hours > 0 ? Math.min(16 * 60, Math.max(30, Math.round((hours * 60) / 15) * 15)) : 60,
  };
}

/**
 * Выцены по авто → рекомендации «по выцене» (идемпотентно, вызывается при чтении):
 * открытая выцена с суммой — открытая рекомендация с тем же составом и ценой;
 * выцена стала заказом — рекомендация «сделано» (в этом заказе); отклонена / удалена — закрывается.
 */
export function syncQuotes(carId) {
  if (getSetting('servicebook_quotes', '1') === '0' || !carId) return;
  const quotes = all(`SELECT q.*, COALESCE(st.is_final, 0) is_final,
      (SELECT z.id FROM orders z WHERE z.kind = 'order' AND (z.quote_id = q.id OR z.id = q.merged_into) ORDER BY z.id LIMIT 1) to_order
    FROM orders q LEFT JOIN order_statuses st ON st.id = q.status_id WHERE q.kind = 'quote' AND q.car_id = ?`, carId);
  const recs = all('SELECT * FROM car_recommendations WHERE car_id = ? AND quote_id IS NOT NULL', carId);
  const byQuote = new Map(recs.map((r) => [r.quote_id, r]));
  for (const q of quotes) {
    const r = byQuote.get(q.id);
    byQuote.delete(q.id);
    if (q.to_order) {
      if (r && r.status === 'open') run(`UPDATE car_recommendations SET status = 'done', closed_order_id = ?, closed_at = datetime('now') WHERE id = ?`, q.to_order, r.id);
      continue;
    }
    const open = !q.is_final && Number(q.total) > 0;
    if (!open) {
      if (r && r.status === 'open') run(`UPDATE car_recommendations SET status = 'dismissed', closed_at = datetime('now') WHERE id = ?`, r.id);
      continue;
    }
    const items = all('SELECT * FROM order_items WHERE order_id = ? ORDER BY pos, id', q.id);
    if (!items.length) continue;
    const d = quoteSummary(q, items);
    if (!r) {
      insert('car_recommendations', { car_id: carId, quote_id: q.id, priority: 'soon', staff: q.created_by || null, ...d });
    } else if (r.status === 'open' && (r.title !== d.title || r.note !== d.note || r.est_price !== d.est_price || r.duration_min !== d.duration_min)) {
      run('UPDATE car_recommendations SET title = ?, note = ?, est_price = ?, duration_min = ? WHERE id = ?', d.title, d.note, d.est_price, d.duration_min, r.id);
    }
  }
  // выцену удалили или перенесли на другое авто
  for (const r of byQuote.values()) if (r.status === 'open') run('DELETE FROM car_recommendations WHERE id = ?', r.id);
}

/** Рекомендация → выцена (черновик с одной работой); дальше выцену дополняют в CRM, клиент видит её в Моё авто */
export function recToQuote(id, staffName, createOrder) {
  const r = one('SELECT r.*, k.customer_id FROM car_recommendations r JOIN cars k ON k.id = r.car_id WHERE r.id = ?', id);
  if (!r) throw new HttpError(404, 'Рекомендация не найдена');
  if (r.quote_id && one('SELECT 1 FROM orders WHERE id = ?', r.quote_id)) return r.quote_id;
  const hours = r.duration_min ? Math.round((r.duration_min / 60) * 100) / 100 : 1;
  const qid = createOrder({
    kind: 'quote', customer_id: r.customer_id, car_id: r.car_id, complaint: r.note ? `${r.title}. ${r.note}` : r.title,
    items: [{ kind: 'labor', name: r.title, qty: r.est_price ? 1 : hours, unit: r.est_price ? 'usł' : 'rbh', ...(r.est_price ? { price: r.est_price } : {}) }],
  }, staffName);
  // эта рекомендация теперь «по выцене» (старая запись заменяется)
  run('DELETE FROM car_recommendations WHERE quote_id = ? AND id <> ?', qid, r.id);
  run('UPDATE car_recommendations SET quote_id = ? WHERE id = ?', qid, r.id);
  return qid;
}

/** Как рекомендацию видит клиент (без внутренних полей) */
export function clientRec(r, mileage) {
  return {
    id: r.id, title: r.title, note: r.note || null, priority: r.priority, dueDate: r.due_date || null, dueKm: r.due_km || null,
    estPrice: r.est_price || null, foundAt: (r.created_at || '').slice(0, 10), orderNo: r.order_no || null, urgency: urgency(r, mileage),
    durationMin: r.duration_min || null, quoteNo: r.quote_no || null, kind: r.quote_id ? 'quote' : 'recommendation',
    booked: r.appointment_id && ['planned', 'request', 'arrived'].includes(r.appt_status) ? { start: r.appt_start || null, status: r.appt_status } : null,
  };
}

export const myCarUrl = () => getSetting('my_car_url', 'https://pulsecar.pl/pl/moje-auto');
