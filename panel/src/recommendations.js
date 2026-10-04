// Сервисная книжка: рекомендации «что пора сделать» по автомобилю.
// Механик / приёмщик добавляет их в заказе (или переносит из чек-листа), клиент видит их
// на pulsecar.pl/moje-auto и в приложении, за N дней до срока уходит SMS-напоминание.
import { all, one, run, insert, getSetting } from './db.js';
import { HttpError } from './util.js';

export const PRIORITIES = ['urgent', 'soon', 'later'];

/** Готовые рекомендации: название, через сколько месяцев и/или км (для кнопок в заказе) */
export const PRESETS = [
  { title: 'Wymiana oleju silnikowego i filtrów', months: 12, km: 15000, priority: 'later' },
  { title: 'Wymiana płynu hamulcowego', months: 24, priority: 'later' },
  { title: 'Serwis klimatyzacji', months: 12, priority: 'later' },
  { title: 'Wymiana klocków hamulcowych', months: 3, priority: 'soon' },
  { title: 'Wymiana tarcz i klocków hamulcowych', months: 3, priority: 'soon' },
  { title: 'Wymiana rozrządu', km: 10000, priority: 'soon' },
  { title: 'Wymiana świec zapłonowych', km: 10000, priority: 'later' },
  { title: 'Wymiana filtra kabinowego', months: 12, priority: 'later' },
  { title: 'Wymiana opon na sezonowe', months: 6, priority: 'later' },
  { title: 'Geometria kół', months: 1, priority: 'soon' },
  { title: 'Wymiana akumulatora', months: 2, priority: 'soon' },
  { title: 'Naprawa zawieszenia (luzy)', months: 1, priority: 'urgent' },
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
  if (b.est_price !== undefined) o.est_price = b.est_price === '' || b.est_price == null ? null : Math.max(0, Math.round(Number(String(b.est_price).replace(',', '.')) * 100) / 100) || null;
  return o;
}

export function listForCar(carId, { openOnly = false } = {}) {
  return all(`SELECT r.*, o.number order_no, z.number closed_order_no FROM car_recommendations r
    LEFT JOIN orders o ON o.id = r.order_id LEFT JOIN orders z ON z.id = r.closed_order_id
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

/** Как рекомендацию видит клиент (без внутренних полей) */
export function clientRec(r, mileage) {
  return {
    id: r.id, title: r.title, note: r.note || null, priority: r.priority, dueDate: r.due_date || null, dueKm: r.due_km || null,
    estPrice: r.est_price || null, foundAt: (r.created_at || '').slice(0, 10), orderNo: r.order_no || null, urgency: urgency(r, mileage),
  };
}

export const myCarUrl = () => getSetting('my_car_url', 'https://pulsecar.pl/pl/moje-auto');
