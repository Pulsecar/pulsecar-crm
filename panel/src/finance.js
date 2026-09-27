// Финансовая аналитика: любые периоды, сравнение, прибыль и убытки, конструктор отчётов, деньги, долги, НДС
import { all, one, getSetting } from './db.js';
import { HttpError, round2 } from './util.js';

const r2 = (n) => round2(n || 0);
const pct = (a, b) => (b ? round2((a / b) * 100) : null);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/** Категории закупок, которые являются товаром (запчасти), а не расходом */
const INVENTORY_CAT = /części|czesci|materiał|material|towar|запчаст|расходник|parts/i;

// строковые выражения (время храним в UTC, считаем по местному времени сервера — TZ=Europe/Warsaw в Docker)
const LOCAL = (col) => `date(${col}, 'localtime')`;

/** Дата, по которой заказ попадает в период: завершение (по умолчанию) или создание */
function dateCol(basis) {
  return basis === 'created' ? LOCAL('o.created_at') : LOCAL('o.closed_at');
}

/** Фильтры по заказам (из запроса) → SQL */
export function orderFilter(q) {
  const basis = q.basis === 'created' ? 'created' : 'closed';
  if (!isDate(q.from) || !isDate(q.to)) throw new HttpError(400, 'Укажите период: from и to в формате ГГГГ-ММ-ДД');
  const cond = [`o.kind = 'order'`, `${dateCol(basis)} BETWEEN ? AND ?`];
  const p = [q.from, q.to];
  if (basis === 'closed') cond.push('o.closed_at IS NOT NULL');
  if (q.include_import !== '1') cond.push(`COALESCE(o.source, '') <> 'import'`);
  if (q.source) { cond.push('o.type_id = ?'); p.push(Number(q.source)); }
  if (q.status) { cond.push('o.status_id = ?'); p.push(Number(q.status)); }
  if (q.customer) { cond.push('o.customer_id = ?'); p.push(Number(q.customer)); }
  if (q.make) { cond.push('lower(k.make) = lower(?)'); p.push(String(q.make)); }
  if (q.mechanic) { cond.push('(o.mechanic_id = ? OR EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = o.id AND x.mechanic_id = ?))'); p.push(Number(q.mechanic), Number(q.mechanic)); }
  if (q.client_type === 'company') cond.push(`COALESCE(c.nip, '') <> ''`);
  if (q.client_type === 'private') cond.push(`COALESCE(c.nip, '') = ''`);
  return { where: cond.join(' AND '), params: p, basis };
}

/** Позиции заказов периода: одна строка — одна работа или запчасть, со всеми измерениями */
function itemsSql(f) {
  return `SELECT i.*, o.id oid, o.number, ${dateCol(f.basis)} d, o.type_id, o.customer_id, o.status_id, o.total o_total,
      COALESCE(i.mechanic_id, o.mechanic_id) mech, k.make, k.model, c.name cname, c.nip,
      i.qty * i.price * (1 - COALESCE(i.discount,0) / 100.0) gross,
      i.qty * i.price * (1 - COALESCE(i.discount,0) / 100.0) / (1 + COALESCE(i.vat,23) / 100.0) net,
      i.qty * i.price * COALESCE(i.discount,0) / 100.0 disc,
      CASE WHEN i.kind = 'part' THEN i.qty * COALESCE(i.cost,0) ELSE 0 END cogs,
      COALESCE((SELECT sc.category FROM service_catalog sc WHERE lower(sc.name) = lower(i.name) LIMIT 1), CASE WHEN i.kind = 'part' THEN 'Запчасти' ELSE 'Прочие работы' END) cat
    FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN cars k ON k.id = o.car_id LEFT JOIN customers c ON c.id = o.customer_id
    WHERE ${f.where}`;
}

const staffPct = () => Object.fromEntries(all('SELECT id, commission_pct FROM staff').map((s) => [s.id, s.commission_pct || 0]));

/** Главные показатели за период */
export function kpis(q) {
  const f = orderFilter(q);
  const items = all(itemsSql(f), ...f.params);
  const pctOf = staffPct();
  const orders = one(`SELECT COUNT(*) n, COALESCE(SUM(o.total),0) gross, COALESCE(SUM(o.total_net),0) net, COUNT(DISTINCT o.customer_id) clients,
      COALESCE(SUM(o.paid),0) paid FROM orders o LEFT JOIN cars k ON k.id = o.car_id LEFT JOIN customers c ON c.id = o.customer_id WHERE ${f.where}`, ...f.params);
  const sum = (fn, filter = () => true) => items.filter(filter).reduce((s, i) => s + fn(i), 0);
  const labor = (i) => i.kind === 'labor';
  const part = (i) => i.kind === 'part';
  const laborNet = sum((i) => i.net, labor);
  const payroll = sum((i) => (i.mech ? i.net * (pctOf[i.mech] || 0) / 100 : 0), labor);
  const partsNet = sum((i) => i.net, part);
  const cogs = sum((i) => i.cogs, part);
  const rbhCost = Number(getSetting('rbh_cost', '0')) || 0;
  const hours = sum((i) => (String(i.unit || '').toLowerCase() === 'rbh' ? i.qty : 0), labor);
  const exp = expenses(q);
  const grossProfit = orders.net - cogs - payroll;
  const firstOrders = one(`SELECT COUNT(*) n FROM (SELECT o.customer_id, MIN(${dateCol(f.basis)}) first FROM orders o WHERE o.kind = 'order' AND o.customer_id IS NOT NULL
      ${f.basis === 'closed' ? 'AND o.closed_at IS NOT NULL' : ''} GROUP BY o.customer_id) WHERE first BETWEEN ? AND ?`, q.from, q.to).n;
  return {
    orders: orders.n, clients: orders.clients, newClients: firstOrders, returning: Math.max(0, orders.clients - firstOrders),
    revenue: r2(orders.gross), revenueNet: r2(orders.net), vatOut: r2(orders.gross - orders.net),
    labor: r2(sum((i) => i.gross, labor)), laborNet: r2(laborNet), parts: r2(sum((i) => i.gross, part)), partsNet: r2(partsNet),
    cogs: r2(cogs), partsMargin: r2(partsNet - cogs), partsMarginPct: pct(partsNet - cogs, partsNet), markupPct: pct(partsNet - cogs, cogs),
    discounts: r2(sum((i) => i.disc)), payroll: r2(payroll), laborAfterPayroll: r2(laborNet - payroll), hours: r2(hours), hoursCost: r2(hours * rbhCost),
    grossProfit: r2(grossProfit), grossMarginPct: pct(grossProfit, orders.net),
    opex: exp.opex, inventoryPurchases: exp.inventory, operatingProfit: r2(grossProfit - exp.opex), operatingMarginPct: pct(grossProfit - exp.opex, orders.net),
    avgCheck: orders.n ? r2(orders.gross / orders.n) : 0, laborShare: pct(sum((i) => i.gross, labor), orders.gross),
    unpaid: r2(orders.gross - orders.paid),
  };
}

/** Закупки и расходы (по дате документа), делятся на товар (запчасти) и операционные расходы */
export function expenses(q) {
  const rows = all(`SELECT COALESCE(category, 'Без категории') category, COALESCE(SUM(net),0) net, COALESCE(SUM(gross),0) gross, COUNT(*) n, COALESCE(SUM(gross - paid),0) debt
      FROM purchases WHERE doc_date BETWEEN ? AND ? GROUP BY category ORDER BY net DESC`, q.from, q.to);
  const inv = rows.filter((r) => INVENTORY_CAT.test(r.category));
  const opex = rows.filter((r) => !INVENTORY_CAT.test(r.category));
  const pz = all(`SELECT COALESCE(counterparty, '—') supplier, COUNT(*) n, COALESCE(SUM(total_net),0) net FROM stock_docs
      WHERE type = 'PZ' AND doc_date BETWEEN ? AND ? GROUP BY counterparty ORDER BY net DESC`, q.from, q.to);
  return {
    byCategory: rows.map((r) => ({ ...r, net: r2(r.net), gross: r2(r.gross), debt: r2(r.debt), inventory: INVENTORY_CAT.test(r.category) })),
    opex: r2(opex.reduce((s, r) => s + r.net, 0)), inventory: r2(inv.reduce((s, r) => s + r.net, 0)),
    vatIn: r2(rows.reduce((s, r) => s + r.gross - r.net, 0)), supplierDebt: r2(rows.reduce((s, r) => s + r.debt, 0)),
    bySupplier: pz.map((r) => ({ ...r, net: r2(r.net) })),
  };
}

// ── Конструктор: метрика × разрез ───────────────────────────────────────────
export const METRICS = {
  revenue: ['Выручка брутто', (i) => i.gross], revenueNet: ['Выручка нетто', (i) => i.net],
  labor: ['Работы брутто', (i) => (i.kind === 'labor' ? i.gross : 0)], parts: ['Запчасти брутто', (i) => (i.kind === 'part' ? i.gross : 0)],
  cogs: ['Себестоимость запчастей', (i) => i.cogs], partsMargin: ['Маржа на запчастях', (i) => (i.kind === 'part' ? i.net - i.cogs : 0)],
  payroll: ['Зарплата механиков', (i, p) => (i.kind === 'labor' && i.mech ? i.net * (p[i.mech] || 0) / 100 : 0)],
  grossProfit: ['Валовая прибыль', (i, p) => i.net - i.cogs - (i.kind === 'labor' && i.mech ? i.net * (p[i.mech] || 0) / 100 : 0)],
  discounts: ['Скидки', (i) => i.disc], qty: ['Количество (шт. / н/ч)', (i) => i.qty],
  orders: ['Заказов', null], avgCheck: ['Средний чек', null], clients: ['Клиентов', null],
};
const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const GROUPS = {
  day: 'День', week: 'Неделя', month: 'Месяц', quarter: 'Квартал', year: 'Год', weekday: 'День недели',
  source: 'Источник клиента', mechanic: 'Механик', category: 'Категория работ', kind: 'Работы / запчасти', item: 'Позиция (работа или деталь)',
  make: 'Марка авто', customer: 'Клиент', client_type: 'Частные / фирмы', status: 'Статус',
};
function weekKey(d) {
  const dt = new Date(d + 'T12:00:00Z');
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().slice(0, 10);
}
function keyOf(g, i, L) {
  switch (g) {
    case 'day': return [i.d, i.d];
    case 'week': { const w = weekKey(i.d); return [w, 'нед. с ' + w]; }
    case 'month': return [i.d.slice(0, 7), i.d.slice(0, 7)];
    case 'quarter': { const q = `${i.d.slice(0, 4)}-Q${Math.floor((Number(i.d.slice(5, 7)) - 1) / 3) + 1}`; return [q, q]; }
    case 'year': return [i.d.slice(0, 4), i.d.slice(0, 4)];
    case 'weekday': { const w = new Date(i.d + 'T12:00:00Z').getUTCDay(); return [String((w + 6) % 7), WEEKDAYS[w]]; }
    case 'source': return [String(i.type_id || 0), L.types[i.type_id] || '— не указан'];
    case 'mechanic': return [String(i.kind === 'labor' ? i.mech || 0 : 'parts'), i.kind === 'labor' ? L.staff[i.mech] || '— без механика' : 'Запчасти (без механика)'];
    case 'category': return [i.cat, i.cat];
    case 'kind': return [i.kind, i.kind === 'labor' ? 'Работы' : 'Запчасти'];
    case 'item': return [(i.code || i.name).toLowerCase(), i.code ? `${i.name} (${i.code})` : i.name];
    case 'make': return [(i.make || '—').toUpperCase(), i.make ? i.make.toUpperCase() : '— без авто'];
    case 'customer': return [String(i.customer_id || 0), i.cname || '— без клиента'];
    case 'client_type': return [i.nip ? 'company' : 'private', i.nip ? 'Фирмы (NIP)' : 'Частные клиенты'];
    case 'status': return [String(i.status_id || 0), L.statuses[i.status_id] || '—'];
    default: throw new HttpError(400, 'Неизвестный разрез');
  }
}

/** Сводная таблица: разрез (и второй разрез) × все метрики */
export function pivot(q) {
  const f = orderFilter(q);
  const g = GROUPS[q.group] ? q.group : 'month';
  const g2 = GROUPS[q.group2] ? q.group2 : null;
  const items = all(itemsSql(f), ...f.params);
  const P = staffPct();
  const L = {
    types: Object.fromEntries(all('SELECT id, name FROM order_types').map((r) => [r.id, r.name])),
    staff: Object.fromEntries(all('SELECT id, name FROM staff').map((r) => [r.id, r.name])),
    statuses: Object.fromEntries(all('SELECT id, name FROM order_statuses').map((r) => [r.id, r.name])),
  };
  const map = new Map();
  for (const i of items) {
    const [k1, l1] = keyOf(g, i, L);
    const [k2, l2] = g2 ? keyOf(g2, i, L) : ['', ''];
    const key = k1 + '\u0001' + k2;
    if (!map.has(key)) map.set(key, { key: k1, label: l1, key2: k2 || undefined, label2: l2 || undefined, _orders: new Set(), _clients: new Set(), _ordersGross: new Map() });
    const row = map.get(key);
    for (const [m, [, fn]] of Object.entries(METRICS)) if (fn) row[m] = (row[m] || 0) + fn(i, P);
    row._orders.add(i.oid);
    if (i.customer_id) row._clients.add(i.customer_id);
  }
  // заказы без позиций тоже считаются в «Заказов»
  const rows = [...map.values()].map(({ _orders, _clients, _ordersGross, ...r }) => {
    const o = { ...r };
    for (const m of Object.keys(METRICS)) if (METRICS[m][1]) o[m] = r2(o[m] || 0);
    o.orders = _orders.size; o.clients = _clients.size; o.avgCheck = o.orders ? r2(o.revenue / o.orders) : 0;
    o.marginPct = pct(o.grossProfit, o.revenueNet);
    return o;
  });
  const timeGroups = ['day', 'week', 'month', 'quarter', 'year', 'weekday'];
  const sortBy = q.sort && METRICS[q.sort] ? q.sort : null;
  rows.sort((a, b) => (sortBy ? b[sortBy] - a[sortBy] : timeGroups.includes(g) ? String(a.key).localeCompare(String(b.key)) || String(a.key2 || '').localeCompare(String(b.key2 || '')) : b.revenue - a.revenue));
  const total = { label: 'Итого' };
  for (const m of Object.keys(METRICS)) if (METRICS[m][1]) total[m] = r2(rows.reduce((s, r) => s + (r[m] || 0), 0));
  total.orders = new Set(items.map((i) => i.oid)).size; total.clients = new Set(items.filter((i) => i.customer_id).map((i) => i.customer_id)).size;
  total.avgCheck = total.orders ? r2(total.revenue / total.orders) : 0; total.marginPct = pct(total.grossProfit, total.revenueNet);
  const limit = Math.min(1000, Number(q.limit) || (timeGroups.includes(g) ? 1000 : 100));
  return { group: g, group2: g2, rows: rows.slice(0, limit), more: Math.max(0, rows.length - limit), total, metrics: Object.fromEntries(Object.entries(METRICS).map(([k, [l]]) => [k, l])), groups: GROUPS };
}

/** Прибыль и убытки по месяцам */
export function pnl(q) {
  const piv = pivot({ ...q, group: 'month', group2: '' });
  const exp = all(`SELECT substr(doc_date,1,7) m, COALESCE(category,'') category, COALESCE(SUM(net),0) net FROM purchases WHERE doc_date BETWEEN ? AND ? GROUP BY m, category`, q.from, q.to);
  const months = [...new Set([...piv.rows.map((r) => r.key), ...exp.map((e) => e.m)])].sort();
  return months.map((m) => {
    const r = piv.rows.find((x) => x.key === m) || {};
    const opex = r2(exp.filter((e) => e.m === m && !INVENTORY_CAT.test(e.category)).reduce((s, e) => s + e.net, 0));
    const gp = r.grossProfit || 0;
    return { month: m, orders: r.orders || 0, revenue: r.revenue || 0, revenueNet: r.revenueNet || 0, labor: r.labor || 0, parts: r.parts || 0, cogs: r.cogs || 0,
      payroll: r.payroll || 0, grossProfit: r2(gp), opex, operatingProfit: r2(gp - opex), marginPct: pct(gp - opex, r.revenueNet) };
  });
}

/** Деньги: поступления и выплаты по дням / способам, касса, долги клиентов с возрастом */
export function cash(q) {
  if (!isDate(q.from) || !isDate(q.to)) throw new HttpError(400, 'Укажите период');
  const byMethod = all(`SELECT method, direction, COUNT(*) n, ROUND(SUM(amount),2) s FROM payments WHERE transfer_id IS NULL AND ${LOCAL('created_at')} BETWEEN ? AND ? GROUP BY method, direction ORDER BY s DESC`, q.from, q.to);
  const byDay = all(`SELECT ${LOCAL('created_at')} d, ROUND(SUM(CASE WHEN direction='in' AND method <> 'points' THEN amount ELSE 0 END),2) inflow,
      ROUND(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),2) outflow FROM payments WHERE transfer_id IS NULL AND ${LOCAL('created_at')} BETWEEN ? AND ? GROUP BY d ORDER BY d`, q.from, q.to);
  const cashBalance = r2(one(`SELECT COALESCE(SUM(r.opening),0) + COALESCE((SELECT SUM(CASE WHEN p.direction='in' THEN p.amount ELSE -p.amount END) FROM payments p JOIN cash_registers r2 ON r2.id = p.register_id WHERE r2.kind = 'cash'),0) s FROM cash_registers r WHERE r.kind = 'cash'`).s || 0);
  const debts = all(`SELECT o.id, o.number, o.total, o.paid, ROUND(o.total - o.paid,2) due, date(o.closed_at,'localtime') closed, c.name cname, c.phone,
      CAST(julianday('now') - julianday(o.closed_at) AS INTEGER) days
    FROM orders o JOIN order_statuses st ON st.id = o.status_id LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.kind='order' AND st.is_final = 1 AND o.paid < o.total - 0.01 AND COALESCE(o.source,'') <> 'import' ORDER BY days DESC`);
  const bucket = (a, b) => r2(debts.filter((d) => d.days >= a && d.days < b).reduce((s, d) => s + d.due, 0));
  const supplierDebt = all(`SELECT supplier, number, doc_date, due_date, ROUND(gross - paid,2) due FROM purchases WHERE paid < gross - 0.01 ORDER BY due_date`);
  const pointsRedeemed = one(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE method='points' AND ${LOCAL('created_at')} BETWEEN ? AND ?`, q.from, q.to).s;
  return {
    byMethod, byDay, cashBalance,
    inflow: r2(byDay.reduce((s, d) => s + d.inflow, 0)), outflow: r2(byDay.reduce((s, d) => s + d.outflow, 0)),
    receivables: { total: r2(debts.reduce((s, d) => s + d.due, 0)), aging: { d0_7: bucket(0, 8), d8_30: bucket(8, 31), d31_90: bucket(31, 91), d90: bucket(91, 1e9) }, list: debts.slice(0, 100) },
    payables: { total: r2(supplierDebt.reduce((s, d) => s + d.due, 0)), list: supplierDebt.slice(0, 50) },
    pointsRedeemed: r2(pointsRedeemed),
  };
}

/** Прочее для обзора: выцены → заказы, склад, лояльность, НДС */
export function extras(q) {
  const quotes = one(`SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE kind='quote' AND ${LOCAL('created_at')} BETWEEN ? AND ?`, q.from, q.to);
  const converted = one(`SELECT COUNT(*) n, COALESCE(SUM(o.total),0) s FROM orders q JOIN orders o ON o.quote_id = q.id WHERE q.kind='quote' AND ${LOCAL('q.created_at')} BETWEEN ? AND ?`, q.from, q.to);
  const stock = one('SELECT COALESCE(SUM(stock * purchase_price),0) cost, COALESCE(SUM(stock * sell_price),0) retail, COUNT(*) n FROM products WHERE active = 1 AND stock > 0');
  const points = one(`SELECT COALESCE(SUM(CASE WHEN type IN ('earn','bonus') THEN points ELSE 0 END),0) earned, COALESCE(SUM(CASE WHEN type = 'redeem' THEN -points ELSE 0 END),0) redeemed
      FROM transactions WHERE ${LOCAL('created_at')} BETWEEN ? AND ?`, q.from, q.to);
  return {
    quotes: { n: quotes.n, sum: r2(quotes.s), converted: converted.n, convertedSum: r2(converted.s), rate: pct(converted.n, quotes.n) },
    stock: { cost: r2(stock.cost), retail: r2(stock.retail), items: stock.n },
    points: { earned: points.earned, redeemed: points.redeemed },
  };
}

/** Предыдущий период такой же длины или тот же период год назад */
export function comparePeriod(from, to, mode) {
  const a = new Date(from + 'T12:00:00Z'), b = new Date(to + 'T12:00:00Z');
  if (mode === 'year') { a.setUTCFullYear(a.getUTCFullYear() - 1); b.setUTCFullYear(b.getUTCFullYear() - 1); }
  else { const days = Math.round((b - a) / 86400000) + 1; a.setUTCDate(a.getUTCDate() - days); b.setUTCDate(b.getUTCDate() - days); }
  return { from: a.toISOString().slice(0, 10), to: b.toISOString().slice(0, 10) };
}

/** Автоматическая детализация графика по длине периода */
export function autoGroup(from, to) {
  const days = (new Date(to) - new Date(from)) / 86400000;
  return days <= 45 ? 'day' : days <= 190 ? 'week' : days <= 1100 ? 'month' : 'quarter';
}

export function overview(q) {
  const cur = kpis(q);
  const cmp = q.compare && q.compare !== 'none' ? comparePeriod(q.from, q.to, q.compare) : null;
  const prev = cmp ? kpis({ ...q, ...cmp }) : null;
  const g = q.group && GROUPS[q.group] ? q.group : autoGroup(q.from, q.to);
  return {
    period: { from: q.from, to: q.to, basis: q.basis === 'created' ? 'created' : 'closed' }, compare: cmp, kpi: cur, prev,
    series: pivot({ ...q, group: g }).rows.map((r) => ({ key: r.key, label: r.label, revenue: r.revenue, grossProfit: r.grossProfit, labor: r.labor, parts: r.parts, orders: r.orders })),
    seriesGroup: g,
    prevSeries: cmp ? pivot({ ...q, ...cmp, group: g }).rows.map((r) => ({ key: r.key, revenue: r.revenue })) : null,
    bySource: pivot({ ...q, group: 'source', limit: 12 }).rows,
    byCategory: pivot({ ...q, group: 'category', limit: 15 }).rows,
    byMechanic: pivot({ ...q, group: 'mechanic', limit: 20 }).rows,
    byMake: pivot({ ...q, group: 'make', limit: 12 }).rows,
    topClients: pivot({ ...q, group: 'customer', limit: 10 }).rows,
    topParts: pivot({ ...q, group: 'item', limit: 500 }).rows.filter((r) => r.parts > 0).sort((a, b) => b.partsMargin - a.partsMargin).slice(0, 10),
    byWeekday: pivot({ ...q, group: 'weekday' }).rows,
    expenses: expenses(q), cash: cash(q), extras: extras(q), pnl: pnl(q),
  };
}

/** CSV для Excel (разделитель «;», запятая в дробях — как привыкли в Польше) */
export function toCsv(piv) {
  const cols = ['label', ...(piv.group2 ? ['label2'] : []), 'orders', 'clients', 'revenue', 'revenueNet', 'labor', 'parts', 'cogs', 'partsMargin', 'payroll', 'grossProfit', 'marginPct', 'discounts', 'avgCheck'];
  const head = [GROUPS[piv.group], ...(piv.group2 ? [GROUPS[piv.group2]] : []), ...cols.slice(piv.group2 ? 2 : 1).map((c) => piv.metrics[c] || (c === 'marginPct' ? 'Маржа, %' : c))];
  const val = (v) => (typeof v === 'number' ? String(v).replace('.', ',') : `"${String(v ?? '').replace(/"/g, '""')}"`);
  return '﻿' + [head.map(val).join(';'), ...[...piv.rows, piv.total].map((r) => cols.map((c) => val(r[c] ?? '')).join(';'))].join('\r\n');
}
