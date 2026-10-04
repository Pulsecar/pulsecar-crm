// Главная (дашборд): у каждого сотрудника своя — набор блоков, порядок и размер.
// Блоки показываются только те, на данные которых у сотрудника есть права.
import { all, one } from './db.js';
import { today } from './util.js';

const sum = (sql, ...p) => one(sql, ...p)?.s || 0;
const PAY = `method <> 'points' AND transfer_id IS NULL`;
const month = () => today().slice(0, 7);
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

// size: s — четверть ширины, m — половина, l — вся ширина
export const WIDGETS = [
  { type: 'kpi_today', title: 'Поступило сегодня', perm: 'cash.view', size: 's', group: 'Цифры' },
  { type: 'kpi_month', title: 'Поступило за месяц', perm: 'cash.view', size: 's', group: 'Цифры' },
  { type: 'kpi_closed', title: 'Закрыто заказов за месяц', perm: 'orders.prices', size: 's', group: 'Цифры' },
  { type: 'kpi_inwork', title: 'Заказов в работе', perm: 'orders.view', size: 's', group: 'Цифры' },
  { type: 'kpi_avg', title: 'Средний чек за месяц', perm: 'orders.prices', size: 's', group: 'Цифры' },
  { type: 'kpi_debt', title: 'Долги клиентов', perm: 'orders.prices', size: 's', group: 'Цифры' },
  { type: 'kpi_my_hours', title: 'Мои нормо-часы за месяц', perm: 'orders.view', size: 's', group: 'Цифры' },
  { type: 'kpi_visits', title: 'Визитов сегодня', perm: 'calendar.view', size: 's', group: 'Цифры' },
  { type: 'statuses', title: 'Заказы по статусам', perm: 'orders.view', size: 'l', group: 'Заказы' },
  { type: 'my_orders', title: 'Мои заказы в работе', perm: 'orders.view', size: 'm', group: 'Заказы' },
  { type: 'my_jobs', title: 'Мои невыполненные работы', perm: 'orders.view', size: 'm', group: 'Заказы' },
  { type: 'pickup', title: 'Выдача авто сегодня и завтра', perm: 'orders.view', size: 'm', group: 'Заказы' },
  { type: 'recent', title: 'Последние заказы', perm: 'orders.view', size: 'm', group: 'Заказы' },
  { type: 'unpaid', title: 'Завершены, но не оплачены', perm: 'orders.prices', size: 'm', group: 'Заказы' },
  { type: 'followup', title: 'Выцены: пора связаться', perm: 'quotes.manage', size: 'm', group: 'Заказы' },
  { type: 'today', title: 'Сегодня в терминарзе', perm: 'calendar.view', size: 'm', group: 'Терминарз' },
  { type: 'requests', title: 'Новые заявки', perm: 'calendar.view', size: 'm', group: 'Терминарз' },
  { type: 'cash', title: 'Кассы: остатки', perm: 'cash.view', size: 'm', group: 'Деньги' },
  { type: 'revenue30', title: 'Поступления за 30 дней (график)', perm: 'cash.view', size: 'l', group: 'Деньги' },
  { type: 'attention', title: 'Склад и хранение: требует внимания', perm: 'products.view', size: 'm', group: 'Склад' },
  { type: 'shortcuts', title: 'Быстрые действия', perm: null, size: 'm', group: 'Личное' },
  { type: 'note', title: 'Моя заметка', perm: null, size: 'm', group: 'Личное' },
];
const BY = Object.fromEntries(WIDGETS.map((w) => [w.type, w]));

export const allowedWidgets = (P) => WIDGETS.filter((w) => !w.perm || P[w.perm]);

/** Раскладка по умолчанию (зависит от роли и прав) */
export function defaultLayout(s, P) {
  const mech = s.role === 'mechanic' || P['orders.only_assigned'] || P['orders.only_my_jobs'];
  const types = mech
    ? ['kpi_my_hours', 'kpi_inwork', 'my_jobs', 'my_orders', 'today', 'shortcuts']
    : ['kpi_today', 'kpi_month', 'kpi_closed', 'kpi_inwork', 'statuses', 'today', 'requests', 'unpaid', 'attention'];
  return types.filter((t) => !BY[t].perm || P[BY[t].perm]).map((t, i) => ({ id: `w${i + 1}`, type: t, size: BY[t].size }));
}

/** Сохранённая раскладка сотрудника (или по умолчанию). Блоки без прав отбрасываются */
export function layoutOf(s, P) {
  let saved = null;
  try { saved = s.dash ? JSON.parse(s.dash) : null; } catch {}
  const list = Array.isArray(saved?.widgets) ? saved.widgets : defaultLayout(s, P);
  return list.filter((w) => BY[w.type] && (!BY[w.type].perm || P[BY[w.type].perm]));
}
export function cleanLayout(widgets, P) {
  if (!Array.isArray(widgets)) return [];
  return widgets.slice(0, 40).filter((w) => BY[w?.type] && (!BY[w.type].perm || P[BY[w.type].perm])).map((w, i) => ({
    id: String(w.id || `w${i + 1}`).slice(0, 20), type: w.type, size: ['s', 'm', 'l'].includes(w.size) ? w.size : BY[w.type].size,
    ...(w.title ? { title: String(w.title).slice(0, 60) } : {}), ...(w.type === 'note' ? { text: String(w.text || '').slice(0, 2000) } : {}),
  }));
}

/** Данные для блоков раскладки */
export function widgetData(s, P, types) {
  const d = today();
  const mineCond = `(o.mechanic_id = ${Number(s.id)} OR o.id IN (SELECT order_id FROM order_items WHERE mechanic_id = ${Number(s.id)}))`;
  const scope = P['orders.only_assigned'] ? ` AND ${mineCond}` : '';
  const out = {};
  const F = {
    kpi_today: () => ({ value: sum(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE direction='in' AND ${PAY} AND substr(created_at,1,10) = ?`, d), fmt: 'zl' }),
    kpi_month: () => ({ value: sum(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE direction='in' AND ${PAY} AND substr(created_at,1,7) = ?`, month()), fmt: 'zl' }),
    kpi_closed: () => { const r = one(`SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE kind='order' AND substr(closed_at,1,7) = ?`, month()); return { value: r.n, fmt: 'num', sub: r.s, subFmt: 'zl' }; },
    kpi_inwork: () => ({ value: one(`SELECT COUNT(*) n FROM orders o JOIN order_statuses st ON st.id = o.status_id WHERE o.kind='order' AND st.is_final = 0${scope}`).n, fmt: 'num', link: '#/orders?status=open' }),
    kpi_avg: () => { const r = one(`SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE kind='order' AND substr(closed_at,1,7) = ?`, month()); return { value: r.n ? r.s / r.n : 0, fmt: 'zl' }; },
    kpi_debt: () => { const r = one(`SELECT COUNT(*) n, COALESCE(SUM(o.total - o.paid),0) s FROM orders o JOIN order_statuses st ON st.id = o.status_id WHERE o.kind='order' AND st.is_final = 1 AND o.paid < o.total - 0.01 AND o.source <> 'import'`); return { value: r.s, fmt: 'zl', sub: r.n, subFmt: 'num', bad: r.s > 0.01 }; },
    kpi_my_hours: () => ({ value: sum(`SELECT COALESCE(SUM(i.qty),0) s FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.kind='labor' AND i.mechanic_id = ? AND i.done = 1 AND lower(COALESCE(i.unit,'')) IN ('rbh','h','godz','godz.') AND substr(COALESCE(o.closed_at, o.created_at),1,7) = ?`, s.id, month()), fmt: 'num2', unit: 'ч' }),
    kpi_visits: () => ({ value: one(`SELECT COUNT(*) n FROM appointments WHERE substr(start_at,1,10) = ? AND status <> 'cancelled'`, d).n, fmt: 'num', link: '#/calendar' }),
    statuses: () => all(`SELECT st.id, st.name, st.color, COUNT(o.id) n FROM order_statuses st LEFT JOIN orders o ON o.status_id = st.id AND o.kind = 'order'${scope}
      WHERE st.is_final = 0 AND COALESCE(st.scope,'all') <> 'quote' GROUP BY st.id ORDER BY st.pos`),
    my_orders: () => all(`SELECT o.id, o.number, o.pickup_at, st.name status_name, st.color status_color, c.name customer_name, k.make, k.model, k.plate FROM orders o
      JOIN order_statuses st ON st.id = o.status_id LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN cars k ON k.id = o.car_id
      WHERE o.kind = 'order' AND st.is_final = 0 AND ${mineCond} ORDER BY o.id DESC LIMIT 15`),
    my_jobs: () => all(`SELECT i.id, i.name, i.qty, i.unit, o.id order_id, o.number, k.make, k.model, k.plate FROM order_items i JOIN orders o ON o.id = i.order_id
      JOIN order_statuses st ON st.id = o.status_id LEFT JOIN cars k ON k.id = o.car_id
      WHERE i.kind = 'labor' AND i.done = 0 AND i.mechanic_id = ? AND o.kind = 'order' AND st.is_final = 0 ORDER BY o.id, i.pos, i.id LIMIT 30`, s.id),
    pickup: () => all(`SELECT o.id, o.number, o.pickup_at, o.total, o.paid, st.name status_name, st.color status_color, c.name customer_name, c.phone, k.make, k.model, k.plate FROM orders o
      JOIN order_statuses st ON st.id = o.status_id LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN cars k ON k.id = o.car_id
      WHERE o.kind = 'order' AND st.is_final = 0 AND substr(o.pickup_at,1,10) BETWEEN ? AND ?${scope} ORDER BY o.pickup_at LIMIT 20`, d, addDays(d, 1)),
    recent: () => all(`SELECT o.id, o.number, o.created_at, o.total, st.name status_name, st.color status_color, c.name customer_name, k.make, k.model, k.plate FROM orders o
      JOIN order_statuses st ON st.id = o.status_id LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN cars k ON k.id = o.car_id
      WHERE o.kind = 'order'${scope} ORDER BY o.id DESC LIMIT 10`),
    unpaid: () => all(`SELECT o.id, o.number, o.total, o.paid, c.name customer_name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
      JOIN order_statuses st ON st.id = o.status_id WHERE o.kind='order' AND st.is_final = 1 AND o.paid < o.total - 0.01 AND o.source <> 'import' ORDER BY o.closed_at DESC LIMIT 10`),
    followup: () => all(`SELECT o.id, o.number, o.total, o.followup, o.followup_at, c.name customer_name, c.phone FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
      JOIN order_statuses st ON st.id = o.status_id WHERE o.kind = 'quote' AND st.is_final = 0 AND o.followup_at IS NOT NULL AND o.followup_at <= ?
      AND COALESCE(o.followup,'') NOT IN ('scheduled','declined') ORDER BY o.followup_at LIMIT 15`, d),
    today: () => all(`SELECT a.*, st.name station_name, c.name customer_name, k.make, k.model, k.plate, o.number order_number
      FROM appointments a LEFT JOIN stations st ON st.id = a.station_id LEFT JOIN customers c ON c.id = a.customer_id
      LEFT JOIN cars k ON k.id = a.car_id LEFT JOIN orders o ON o.id = a.order_id
      WHERE substr(a.start_at,1,10) = ? AND a.status <> 'cancelled' ORDER BY a.start_at`, d),
    requests: () => all(`SELECT a.*, c.name customer_name FROM appointments a LEFT JOIN customers c ON c.id = a.customer_id WHERE a.status = 'request' ORDER BY a.id DESC LIMIT 20`),
    cash: () => all(`SELECT r.id, r.name, r.kind, ROUND(r.opening + COALESCE((SELECT SUM(CASE WHEN direction='in' THEN amount ELSE -amount END) FROM payments p WHERE p.register_id = r.id),0),2) balance
      FROM cash_registers r WHERE r.active = 1 ORDER BY r.pos, r.id`),
    revenue30: () => {
      const from = addDays(d, -29);
      const rows = Object.fromEntries(all(`SELECT substr(created_at,1,10) d, ROUND(SUM(amount),2) s FROM payments WHERE direction='in' AND ${PAY} AND substr(created_at,1,10) >= ? GROUP BY d`, from).map((r) => [r.d, r.s]));
      return Array.from({ length: 30 }, (_, i) => { const x = addDays(from, i); return { d: x, s: rows[x] || 0 }; });
    },
    attention: () => ({
      lowStock: all('SELECT id, name, code, stock, min_stock FROM products WHERE active = 1 AND min_stock > 0 AND stock <= min_stock ORDER BY name LIMIT 10'),
      storageDue: P['storage.view'] ? all(`SELECT s.*, c.name customer_name FROM storage s LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.date_out IS NULL AND s.date_until IS NOT NULL AND s.date_until <= date('now','+14 days') ORDER BY s.date_until LIMIT 10`) : [],
    }),
    shortcuts: () => null,
    note: () => null,
  };
  for (const t of new Set(types)) {
    const w = BY[t];
    if (!w || (w.perm && !P[w.perm])) continue;
    try { out[t] = F[t](); } catch (e) { out[t] = { error: e.message }; }
  }
  return out;
}
