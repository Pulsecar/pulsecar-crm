// Дубли автомобилей: один VIN (или один номер без конфликта VIN) — одна карточка
import { one, all, run, log } from './db.js';

const FILL = ['customer_id', 'plate', 'vin', 'make', 'model', 'year', 'engine', 'capacity', 'power_kw', 'fuel', 'color', 'last_mileage', 'notes',
  'first_reg', 'engine_no', 'category', 'mass_kg', 'seats', 'reg_doc', 'inspection_until', 'insurance_until', 'key_no', 'paint_code', 'vehicle_type', 'body_type', 'mileage_unit'];

/** Карточка, которая уже есть в базе для такого VIN / номера (кроме selfId) */
export function findDupCar({ vin, plate }, selfId = 0) {
  const cols = 'id, plate, vin, make, model, customer_id';
  if (vin) {
    const r = one(`SELECT ${cols} FROM cars WHERE vin = ? AND id <> ? ORDER BY id LIMIT 1`, vin, selfId);
    if (r) return r;
  }
  if (plate) {
    // тот же номер, но другой VIN — это другая машина (перерегистрация), не дубль
    const r = one(`SELECT ${cols} FROM cars WHERE plate = ? AND id <> ? AND (? IS NULL OR vin IS NULL OR vin = ?) ORDER BY id LIMIT 1`, plate, selfId, vin || null, vin || null);
    if (r) return r;
  }
  return null;
}

export const carLabel = (r) => [[r.make, r.model].filter(Boolean).join(' '), r.plate, r.vin].filter(Boolean).join(' · ');

function carIdColumns() {
  const out = [];
  for (const { name } of all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")) {
    const cols = all(`PRAGMA table_info("${name}")`).map((c) => c.name);
    if (name !== 'cars' && cols.includes('car_id')) out.push([name, 'car_id']);
    if (cols.includes('default_car_id')) out.push([name, 'default_car_id']);
  }
  return out;
}

/** Переносит заказы, записи, хранение и т.д. с дублей на основную карточку, дополняет пустые поля и удаляет дубли */
export function mergeCars(keepId, dropIds, staff = 'system') {
  const drops = dropIds.filter((x) => x && x !== keepId);
  if (!drops.length) return;
  const keep = one('SELECT * FROM cars WHERE id = ?', keepId);
  const cols = new Set(all('PRAGMA table_info(cars)').map((c) => c.name));
  const patch = {};
  for (const id of drops) {
    const d = one('SELECT * FROM cars WHERE id = ?', id);
    if (!d) continue;
    for (const f of FILL) if (cols.has(f) && (keep[f] === null || keep[f] === '') && d[f] !== null && d[f] !== '' && patch[f] === undefined) patch[f] = d[f];
    if (cols.has('last_mileage') && Number(d.last_mileage) > Number(patch.last_mileage ?? keep.last_mileage ?? 0)) patch.last_mileage = d.last_mileage;
  }
  const ph = drops.map(() => '?').join(',');
  for (const [t, c] of carIdColumns()) run(`UPDATE OR IGNORE "${t}" SET ${c} = ? WHERE ${c} IN (${ph})`, keepId, ...drops);
  run(`DELETE FROM cars WHERE id IN (${ph})`, ...drops);
  const keys = Object.keys(patch);
  if (keys.length) run(`UPDATE cars SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map((k) => patch[k]), keepId);
  const k2 = one('SELECT vin, plate FROM cars WHERE id = ?', keepId);
  if (k2.vin || k2.plate) run('UPDATE cars SET car_key = ? WHERE id = ?', k2.vin || k2.plate, keepId);
  try { log('car', keepId, 'merge', 'Объединены дубли: ' + drops.map((x) => '#' + x).join(', '), staff); } catch {}
}

/** Находит группы дублей во всей базе и объединяет их. Возвращает число удалённых карточек. */
export function dedupAllCars(staff = 'system') {
  const cars = all('SELECT * FROM cars ORDER BY id');
  const parent = new Map(cars.map((c) => [c.id, c.id]));
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  const unite = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb)); };
  const by = (key) => { const m = new Map(); for (const c of cars) { const k = key(c); if (k) (m.get(k) || m.set(k, []).get(k)).push(c); } return m; };
  for (const g of by((c) => c.vin).values()) for (const c of g.slice(1)) unite(g[0].id, c.id);
  for (const g of by((c) => c.plate).values()) {
    const vins = new Set(g.map((c) => c.vin).filter(Boolean));
    if (vins.size > 1) { // разные VIN под одним номером: без VIN присоединяем, только если VIN один
      continue;
    }
    for (const c of g.slice(1)) unite(g[0].id, c.id);
  }
  const groups = new Map();
  for (const c of cars) { const r = find(c.id); (groups.get(r) || groups.set(r, []).get(r)).push(c); }
  let removed = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const score = (c) => (one('SELECT COUNT(*) n FROM orders WHERE car_id = ?', c.id)?.n || 0) * 0.5 + (c.customer_id ? 3 : 0)
      + FILL.filter((f) => c[f] !== null && c[f] !== undefined && c[f] !== '').length;
    const keep = g.slice().sort((a, b) => score(b) - score(a) || a.id - b.id)[0];
    mergeCars(keep.id, g.map((c) => c.id), staff);
    removed += g.length - 1;
  }
  return removed;
}
