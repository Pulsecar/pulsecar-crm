// Рапорты (как Raporty в Motowarsztat): заказы, продажи, клиенты, сотрудники (зарплата механиков), касса, авто, затраты, склад, хранение.
// Каждый рапорт: параметры → { columns, rows, totals }; выгрузка CSV / XLSX и печать делаются из этого же ответа.
import XLSX from 'xlsx';
import fs from 'node:fs';
import { all, one } from './db.js';
import { HttpError, round2 } from './util.js';

const r2 = (n) => round2(n || 0);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const L = (col) => `date(${col}, 'localtime')`;
const money = 'money', num = 'num', pct = 'pct', date = 'date', text = 'text';

/** Фильтр заказов периода: по дате завершения (как «Daty zakończenia zlecenia») или создания */
function ordersWhere(q, { alias = 'o' } = {}) {
  if (!isDate(q.from) || !isDate(q.to)) throw new HttpError(400, 'Выберите период');
  const basis = q.basis === 'created' ? 'created' : 'closed';
  const col = basis === 'created' ? L(`${alias}.created_at`) : L(`${alias}.closed_at`);
  const w = [`${alias}.kind = 'order'`, `${col} BETWEEN ? AND ?`], p = [q.from, q.to];
  if (basis === 'closed') w.push(`${alias}.closed_at IS NOT NULL`);
  if (q.include_import !== '1') w.push(`COALESCE(${alias}.source,'') <> 'import'`);
  if (q.status) { w.push(`${alias}.status_id = ?`); p.push(Number(q.status)); }
  if (q.type) { w.push(`${alias}.type_id = ?`); p.push(Number(q.type)); }
  if (q.customer) { w.push(`${alias}.customer_id = ?`); p.push(Number(q.customer)); }
  if (q.car) { w.push(`${alias}.car_id = ?`); p.push(Number(q.car)); }
  return { where: w.join(' AND '), params: p, col };
}
const lineG = `(i.qty * i.price * (1 - COALESCE(i.discount,0) / 100.0))`;
const lineN = `(${lineG} / (1 + COALESCE(i.vat,23) / 100.0))`;
const vg = (q, n, g) => (q.prices === 'gross' ? g : n);

/** Как считается заработок сотрудника (карточка сотрудника или % из параметров рапорта) */
function payRule(s, q) {
  const override = q.pct !== undefined && q.pct !== '' ? Number(q.pct) : null;
  return {
    pct: override ?? (s.pay_mode === 'hourly' ? 0 : Number(s.commission_pct) || 0),
    partsPct: Number(s.parts_pct) || 0,
    hourly: q.pct !== undefined && q.pct !== '' ? 0 : Number(s.pay_mode === 'hourly' || s.pay_mode === 'both' ? s.hourly_rate : 0) || 0,
    base: q.pay_base === 'gross' || (!q.pay_base && s.pay_base === 'gross') ? 'gross' : 'net',
    fixed: Number(s.base_salary) || 0,
  };
}
function staffLines(q) {
  const f = ordersWhere(q);
  const extra = [], p = [...f.params];
  if (q.staff) { extra.push('COALESCE(i.mechanic_id, o.mechanic_id) = ?'); p.push(Number(q.staff)); }
  return all(`SELECT i.*, o.id oid, o.number, ${f.col} d, COALESCE(i.mechanic_id, o.mechanic_id) mech, k.make, k.model, k.plate, c.name cname,
      ${lineG} gross, ${lineN} net, CASE WHEN i.kind = 'part' THEN ${lineN} - i.qty * COALESCE(i.cost,0) ELSE 0 END margin
    FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN cars k ON k.id = o.car_id LEFT JOIN customers c ON c.id = o.customer_id
    WHERE ${f.where} ${extra.length ? 'AND ' + extra.join(' AND ') : ''} ORDER BY d, o.id, i.pos`, ...p);
}
/** работа в нормо-часах: единица rbh/h/godz или не указана (не «szt/usł») */
const isHours = (l) => l.kind === 'labor' && !/szt|шт|us[lł]|kpl|компл/i.test(l.unit || '');
const partsOfJob = (lines) => {
  const byTask = {};
  for (const l of lines) if (l.kind === 'part' && l.task_id) (byTask[l.task_id] ||= []).push(l);
  return byTask;
};

export const REPORTS = {
  // ── Сотрудники ──
  staff_pay: {
    group: 'Сотрудники', title: 'Расчёт сотрудников (зарплата)', about: 'Сколько заработал каждый сотрудник за период: % от работ (например 40%), ставка за нормо-час, % от маржи на запчастях.',
    params: ['period', 'basis', 'status', 'type', 'staff', 'car', 'customer', 'prices', 'pct', 'pay_base'],
    run(q) {
      const lines = staffLines(q);
      const staff = Object.fromEntries(all('SELECT * FROM staff').map((s) => [s.id, s]));
      const parts = partsOfJob(lines);
      const by = {};
      for (const l of lines.filter((x) => x.kind === 'labor' && x.mech)) {
        const s = staff[l.mech]; if (!s) continue;
        const R = payRule(s, q);
        const b = (by[l.mech] ||= { staff: s.name, rule: `${R.pct}% от работ ${R.base === 'gross' ? 'брутто' : 'нетто'}${R.hourly ? ` + ${R.hourly} zł/н-ч` : ''}${R.partsPct ? ` + ${R.partsPct}% маржи` : ''}`, orders: new Set(), jobs: 0, hours: 0, labor: 0, laborNet: 0, laborGross: 0, partsMargin: 0, pay: 0, R });
        b.orders.add(l.oid); b.jobs++;
        b.laborNet += l.net; b.laborGross += l.gross; b.labor += q.prices === 'gross' ? l.gross : l.net;
        if (isHours(l)) b.hours += l.qty;
        const m = (parts[l.id] || []).reduce((a, x) => a + x.margin, 0);
        b.partsMargin += m;
        b.pay += (R.base === 'gross' ? l.gross : l.net) * R.pct / 100 + (isHours(l) ? l.qty * R.hourly : 0) + m * R.partsPct / 100;
      }
      const rows = Object.values(by).map((b) => ({ staff: b.staff, rule: b.rule, orders: b.orders.size, jobs: b.jobs, hours: r2(b.hours), labor: r2(b.labor), partsMargin: r2(b.partsMargin), pay: r2(b.pay) }))
        .sort((a, b) => b.pay - a.pay);
      return {
        columns: [['staff', 'Сотрудник', text], ['rule', 'Условия', text], ['orders', 'Заказов', num], ['jobs', 'Работ', num], ['hours', 'Нормо-часов', num], ['labor', vg(q, 'Работы нетто', 'Работы брутто'), money], ['partsMargin', 'Маржа запчастей к его работам', money], ['pay', 'Заработал', money]],
        rows, totals: { orders: rows.reduce((a, r) => a + r.orders, 0), jobs: rows.reduce((a, r) => a + r.jobs, 0), hours: r2(rows.reduce((a, r) => a + r.hours, 0)), labor: r2(rows.reduce((a, r) => a + r.labor, 0)), partsMargin: r2(rows.reduce((a, r) => a + r.partsMargin, 0)), pay: r2(rows.reduce((a, r) => a + r.pay, 0)) },
      };
    },
  },
  staff_pay_detail: {
    group: 'Сотрудники', title: 'Подробный расчёт сотрудников', about: 'Каждая работа: заказ, авто, сумма и сколько за неё начислено сотруднику.',
    params: ['period', 'basis', 'status', 'type', 'staff', 'car', 'customer', 'prices', 'pct', 'pay_base'],
    run(q) {
      const lines = staffLines(q);
      const staff = Object.fromEntries(all('SELECT * FROM staff').map((s) => [s.id, s]));
      const parts = partsOfJob(lines);
      const rows = lines.filter((x) => x.kind === 'labor' && x.mech && staff[x.mech]).map((l) => {
        const R = payRule(staff[l.mech], q);
        const m = (parts[l.id] || []).reduce((a, x) => a + x.margin, 0);
        const pay = (R.base === 'gross' ? l.gross : l.net) * R.pct / 100 + (isHours(l) ? l.qty * R.hourly : 0) + m * R.partsPct / 100;
        return { d: l.d, staff: staff[l.mech].name, number: l.number, car: [l.make, l.model, l.plate].filter(Boolean).join(' '), job: l.name, qty: l.qty, unit: l.unit, value: r2(q.prices === 'gross' ? l.gross : l.net), pct: R.pct, pay: r2(pay), _order: l.oid };
      });
      return {
        columns: [['d', 'Дата', date], ['staff', 'Сотрудник', text], ['number', 'Заказ', text], ['car', 'Авто', text], ['job', 'Работа', text], ['qty', 'Кол-во', num], ['unit', 'Ед.', text], ['value', vg(q, 'Сумма нетто', 'Сумма брутто'), money], ['pct', '%', pct], ['pay', 'Начислено', money]],
        rows, totals: { value: r2(rows.reduce((a, r) => a + r.value, 0)), pay: r2(rows.reduce((a, r) => a + r.pay, 0)) },
      };
    },
  },
  staff_time: {
    group: 'Сотрудники', title: 'Нормо-часы сотрудников', about: 'Сколько нормо-часов (единицы rbh) и работ выполнил каждый сотрудник по дням.',
    params: ['period', 'basis', 'staff'],
    run(q) {
      const lines = staffLines(q).filter((x) => x.kind === 'labor' && x.mech);
      const staff = Object.fromEntries(all('SELECT id, name FROM staff').map((s) => [s.id, s.name]));
      const by = {};
      for (const l of lines) { const k = l.d + '|' + l.mech; const b = (by[k] ||= { d: l.d, staff: staff[l.mech] || '—', jobs: 0, hours: 0, done: 0 }); b.jobs++; if (isHours(l)) b.hours += l.qty; if (l.done) b.done++; }
      const rows = Object.values(by).sort((a, b) => a.d.localeCompare(b.d) || a.staff.localeCompare(b.staff)).map((r) => ({ ...r, hours: r2(r.hours) }));
      return { columns: [['d', 'Дата', date], ['staff', 'Сотрудник', text], ['jobs', 'Работ', num], ['done', 'Отмечено выполненными', num], ['hours', 'Нормо-часов', num]], rows, totals: { jobs: rows.reduce((a, r) => a + r.jobs, 0), hours: r2(rows.reduce((a, r) => a + r.hours, 0)) } };
    },
  },

  // ── Заказы ──
  orders_detail: {
    group: 'Заказы', title: 'Подробный список заказов', about: 'Заказы в таблице: работы, запчасти, себестоимость и прибыль.',
    params: ['period', 'basis', 'status', 'type', 'staff', 'car', 'customer', 'prices'],
    run(q) {
      const f = ordersWhere(q);
      const p = [...f.params]; let extra = '';
      if (q.staff) { extra = 'AND (o.mechanic_id = ? OR EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = o.id AND x.mechanic_id = ?))'; p.push(Number(q.staff), Number(q.staff)); }
      const rows = all(`SELECT o.id _order, o.number, ${f.col} d, st.name status, c.name cname, k.make || ' ' || COALESCE(k.model,'') || ' ' || COALESCE(k.plate,'') car,
          COALESCE((SELECT SUM(${vg(q, lineN, lineG)}) FROM order_items i WHERE i.order_id = o.id AND i.kind = 'labor'),0) labor,
          COALESCE((SELECT SUM(${vg(q, lineN, lineG)}) FROM order_items i WHERE i.order_id = o.id AND i.kind = 'part'),0) parts,
          COALESCE((SELECT SUM(i.qty * COALESCE(i.cost,0)) FROM order_items i WHERE i.order_id = o.id AND i.kind = 'part'),0) cogs,
          ${q.prices === 'gross' ? 'o.total' : 'o.total_net'} total, o.paid
        FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN cars k ON k.id = o.car_id LEFT JOIN order_statuses st ON st.id = o.status_id
        WHERE ${f.where} ${extra} ORDER BY d, o.id`, ...p).map((r) => ({ ...r, labor: r2(r.labor), parts: r2(r.parts), cogs: r2(r.cogs), profit: r2(r.labor + r.parts - r.cogs), total: r2(r.total) }));
      const s = (k) => r2(rows.reduce((a, r) => a + (r[k] || 0), 0));
      return { columns: [['number', 'Заказ', text], ['d', 'Дата', date], ['status', 'Статус', text], ['cname', 'Клиент', text], ['car', 'Авто', text], ['labor', 'Работы', money], ['parts', 'Запчасти', money], ['cogs', 'Себестоимость запчастей', money], ['profit', 'Прибыль', money], ['total', vg(q, 'Итого нетто', 'Итого брутто'), money], ['paid', 'Оплачено', money]],
        rows, totals: { labor: s('labor'), parts: s('parts'), cogs: s('cogs'), profit: s('profit'), total: s('total'), paid: s('paid') } };
    },
  },

  // ── Продажи ──
  sales_docs: {
    group: 'Продажи', title: 'Список документов продажи', about: 'Все фактуры VAT, корректы, Pro forma и чеки за период.',
    params: ['period'],
    run(q) {
      if (!isDate(q.from) || !isDate(q.to)) throw new HttpError(400, 'Выберите период');
      const K = { vat: 'Faktura VAT', proforma: 'Pro forma', correction: 'Korekta' };
      const rows = all(`SELECT d.number, d.kind, d.issue_date d, json_extract(d.buyer,'$.name') buyer, json_extract(d.buyer,'$.nip') nip, d.total_net net, d.total_vat vat, d.total_gross gross, d.ksef_number, o.number order_no
        FROM sales_docs d LEFT JOIN orders o ON o.id = d.order_id WHERE d.issue_date BETWEEN ? AND ? ORDER BY d.issue_date, d.id`, q.from, q.to).map((r) => ({ ...r, kind: K[r.kind] || r.kind }));
      const s = (k) => r2(rows.filter((r) => r.kind !== 'Pro forma').reduce((a, r) => a + (r[k] || 0), 0));
      return { columns: [['number', 'Номер', text], ['kind', 'Тип', text], ['d', 'Дата', date], ['buyer', 'Покупатель', text], ['nip', 'NIP', text], ['order_no', 'Заказ', text], ['net', 'Нетто', money], ['vat', 'VAT', money], ['gross', 'Брутто', money], ['ksef_number', 'Номер KSeF', text]],
        rows, totals: { net: s('net'), vat: s('vat'), gross: s('gross') }, note: 'Итоги без Pro forma.' };
    },
  },
  sales_detail: {
    group: 'Продажи', title: 'Подробные продажи с прибылью', about: 'Каждая проданная работа и запчасть: цена, себестоимость, прибыль.',
    params: ['period', 'basis', 'status', 'type', 'customer', 'prices'],
    run(q) {
      const f = ordersWhere(q);
      const rows = all(`SELECT o.id _order, o.number, ${f.col} d, i.kind, i.name, i.code, i.qty, ${vg(q, lineN, lineG)} value, CASE WHEN i.kind = 'part' THEN i.qty * COALESCE(i.cost,0) ELSE 0 END cogs
        FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${f.where} ORDER BY d, o.id, i.pos`, ...f.params)
        .map((r) => ({ ...r, kind: r.kind === 'part' ? 'Запчасть' : 'Работа', value: r2(r.value), cogs: r2(r.cogs), profit: r2(r.value - (q.prices === 'gross' ? r.cogs * 1.23 : r.cogs)) }));
      const s = (k) => r2(rows.reduce((a, r) => a + r[k], 0));
      return { columns: [['d', 'Дата', date], ['number', 'Заказ', text], ['kind', 'Тип', text], ['name', 'Позиция', text], ['code', 'Код', text], ['qty', 'Кол-во', num], ['value', vg(q, 'Продажа нетто', 'Продажа брутто'), money], ['cogs', 'Себестоимость', money], ['profit', 'Прибыль', money]],
        rows, totals: { value: s('value'), cogs: s('cogs'), profit: s('profit') } };
    },
  },
  sales_wz: {
    group: 'Продажи', title: 'Выдачи WZ к продажам', about: 'Документы WZ (запчасти со склада в заказы) и себестоимость товаров.',
    params: ['period'],
    run(q) {
      if (!isDate(q.from) || !isDate(q.to)) throw new HttpError(400, 'Выберите период');
      const rows = all(`SELECT d.number, d.doc_date d, o.number order_no, d.counterparty, d.total_net cost, (SELECT COUNT(*) FROM stock_doc_items x WHERE x.doc_id = d.id) positions
        FROM stock_docs d LEFT JOIN orders o ON o.id = d.order_id WHERE d.type = 'WZ' AND substr(d.doc_date,1,10) BETWEEN ? AND ? ORDER BY d.doc_date, d.id`, q.from, q.to);
      return { columns: [['number', 'WZ', text], ['d', 'Дата', date], ['order_no', 'Заказ', text], ['counterparty', 'Клиент', text], ['positions', 'Позиций', num], ['cost', 'Себестоимость нетто', money]], rows, totals: { cost: r2(rows.reduce((a, r) => a + r.cost, 0)) } };
    },
  },

  // ── Клиенты ──
  client_orders: {
    group: 'Клиенты', title: 'Заказы клиента', about: 'Все заказы выбранного клиента за период.',
    params: ['period', 'basis', 'customer', 'prices'],
    run(q) { if (!q.customer) throw new HttpError(400, 'Выберите клиента'); return REPORTS.orders_detail.run(q); },
  },
  top_clients: {
    group: 'Клиенты', title: 'Лучшие клиенты', about: 'Клиенты по сумме заказов за период: визиты, выручка, средний чек.',
    params: ['period', 'basis', 'prices'],
    run(q) {
      const f = ordersWhere(q);
      const rows = all(`SELECT c.name cname, c.phone, c.nip, COUNT(*) visits, SUM(${q.prices === 'gross' ? 'o.total' : 'o.total_net'}) total, MAX(${f.col}) last
        FROM orders o JOIN customers c ON c.id = o.customer_id WHERE ${f.where} GROUP BY c.id ORDER BY total DESC LIMIT 500`, ...f.params).map((r) => ({ ...r, total: r2(r.total), avg: r2(r.total / r.visits) }));
      return { columns: [['cname', 'Клиент', text], ['phone', 'Телефон', text], ['nip', 'NIP', text], ['visits', 'Заказов', num], ['total', vg(q, 'Сумма нетто', 'Сумма брутто'), money], ['avg', 'Средний чек', money], ['last', 'Последний', date]],
        rows, totals: { visits: rows.reduce((a, r) => a + r.visits, 0), total: r2(rows.reduce((a, r) => a + r.total, 0)) } };
    },
  },

  // ── Касса ──
  cash_docs: {
    group: 'Касса', title: 'Кассовый отчёт', about: 'Все KP/KW и оплаты за период по кассам: приход, расход, остаток.',
    params: ['period', 'register'],
    run(q) {
      if (!isDate(q.from) || !isDate(q.to)) throw new HttpError(400, 'Выберите период');
      const p = [q.from, q.to]; let w = '';
      if (q.register) { w = 'AND p.register_id = ?'; p.push(Number(q.register)); }
      const M = { cash: 'Наличные', card: 'Карта', transfer: 'Перевод', points: 'Баллы' };
      const rows = all(`SELECT p.created_at d, p.number, r.name register, p.method, COALESCE(c.name, p.note) who, o.number order_no, CASE WHEN p.direction = 'in' THEN p.amount ELSE 0 END income,
          CASE WHEN p.direction = 'out' THEN p.amount ELSE 0 END outcome, p.staff FROM payments p LEFT JOIN cash_registers r ON r.id = p.register_id LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN orders o ON o.id = p.order_id
        WHERE ${L('p.created_at')} BETWEEN ? AND ? ${w} ORDER BY p.created_at, p.id`, ...p).map((r) => ({ ...r, method: M[r.method] || r.method }));
      const inc = r2(rows.reduce((a, r) => a + r.income, 0)), out = r2(rows.reduce((a, r) => a + r.outcome, 0));
      return { columns: [['d', 'Дата', date], ['number', 'Документ', text], ['register', 'Касса', text], ['method', 'Способ', text], ['who', 'Клиент / назначение', text], ['order_no', 'Заказ', text], ['income', 'Приход', money], ['outcome', 'Расход', money], ['staff', 'Кто', text]],
        rows, totals: { income: inc, outcome: out }, note: `Сальдо за период: ${r2(inc - out)} zł` };
    },
  },
  cash_methods: {
    group: 'Касса', title: 'Оплаты по способам и дням', about: 'Сколько пришло наличными, картой и переводом по дням.',
    params: ['period'],
    run(q) {
      if (!isDate(q.from) || !isDate(q.to)) throw new HttpError(400, 'Выберите период');
      const rows = all(`SELECT ${L('created_at')} d, SUM(CASE WHEN method='cash' THEN amount ELSE 0 END) cash, SUM(CASE WHEN method='card' THEN amount ELSE 0 END) card,
          SUM(CASE WHEN method='transfer' THEN amount ELSE 0 END) transfer, SUM(CASE WHEN method='points' THEN amount ELSE 0 END) points, SUM(amount) total
        FROM payments WHERE direction = 'in' AND transfer_id IS NULL AND ${L('created_at')} BETWEEN ? AND ? GROUP BY d ORDER BY d`, q.from, q.to).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'd' ? v : r2(v)])));
      const s = (k) => r2(rows.reduce((a, r) => a + r[k], 0));
      return { columns: [['d', 'День', date], ['cash', 'Наличные', money], ['card', 'Карта', money], ['transfer', 'Перевод', money], ['points', 'Баллы', money], ['total', 'Всего', money]], rows, totals: { cash: s('cash'), card: s('card'), transfer: s('transfer'), points: s('points'), total: s('total') } };
    },
  },

  // ── Автомобили ──
  car_history: {
    group: 'Автомобили', title: 'История автомобиля', about: 'Все работы и запчасти по выбранному авто.',
    params: ['car'],
    run(q) {
      if (!q.car) throw new HttpError(400, 'Выберите автомобиль');
      const rows = all(`SELECT o.id _order, o.number, ${L('o.created_at')} d, o.mileage, i.kind, i.name, i.code, i.qty, i.unit, ${lineG} gross
        FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.car_id = ? AND o.kind = 'order' ORDER BY o.created_at, i.pos`, Number(q.car)).map((r) => ({ ...r, kind: r.kind === 'part' ? 'Запчасть' : 'Работа', gross: r2(r.gross) }));
      return { columns: [['d', 'Дата', date], ['number', 'Заказ', text], ['mileage', 'Пробег', num], ['kind', 'Тип', text], ['name', 'Позиция', text], ['code', 'Код', text], ['qty', 'Кол-во', num], ['gross', 'Сумма брутто', money]], rows, totals: { gross: r2(rows.reduce((a, r) => a + r.gross, 0)) } };
    },
  },

  // ── Затраты ──
  costs_docs: {
    group: 'Затраты', title: 'Документы затрат', about: 'Фактуры поставщиков и расходы за период.',
    params: ['period'],
    run(q) {
      if (!isDate(q.from) || !isDate(q.to)) throw new HttpError(400, 'Выберите период');
      const rows = all(`SELECT doc_date d, supplier, number, category, description, net, gross, paid, due_date FROM purchases WHERE substr(COALESCE(doc_date, created_at),1,10) BETWEEN ? AND ? ORDER BY doc_date`, q.from, q.to);
      const s = (k) => r2(rows.reduce((a, r) => a + (r[k] || 0), 0));
      return { columns: [['d', 'Дата', date], ['supplier', 'Поставщик', text], ['number', 'Номер', text], ['category', 'Категория', text], ['description', 'Описание', text], ['net', 'Нетто', money], ['gross', 'Брутто', money], ['paid', 'Оплачено', money], ['due_date', 'Срок', date]],
        rows, totals: { net: s('net'), gross: s('gross'), paid: s('paid') } };
    },
  },
  costs_by_cat: {
    group: 'Затраты', title: 'Затраты по категориям и месяцам', about: 'Помесячно: сколько ушло на аренду, зарплаты, запчасти и т. д.',
    params: ['period'],
    run(q) {
      if (!isDate(q.from) || !isDate(q.to)) throw new HttpError(400, 'Выберите период');
      const rows = all(`SELECT substr(COALESCE(doc_date, created_at),1,7) m, COALESCE(NULLIF(category,''),'Без категории') category, SUM(net) net, SUM(gross) gross, COUNT(*) docs
        FROM purchases WHERE substr(COALESCE(doc_date, created_at),1,10) BETWEEN ? AND ? GROUP BY m, category ORDER BY m, net DESC`, q.from, q.to).map((r) => ({ ...r, net: r2(r.net), gross: r2(r.gross) }));
      return { columns: [['m', 'Месяц', text], ['category', 'Категория', text], ['docs', 'Документов', num], ['net', 'Нетто', money], ['gross', 'Брутто', money]], rows, totals: { net: r2(rows.reduce((a, r) => a + r.net, 0)), gross: r2(rows.reduce((a, r) => a + r.gross, 0)) } };
    },
  },
  profit_monthly: {
    group: 'Затраты', title: 'Прибыль по месяцам', about: 'Выручка, себестоимость товаров, зарплата механиков, затраты и прибыль по месяцам.',
    params: ['period', 'basis'],
    run(q) {
      const f = ordersWhere(q);
      const staff = Object.fromEntries(all('SELECT id, commission_pct FROM staff').map((s) => [s.id, s.commission_pct || 0]));
      const lines = all(`SELECT substr(${f.col},1,7) m, i.kind, ${lineN} net, CASE WHEN i.kind='part' THEN i.qty * COALESCE(i.cost,0) ELSE 0 END cogs, COALESCE(i.mechanic_id, o.mechanic_id) mech
        FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${f.where}`, ...f.params);
      const by = {};
      for (const l of lines) { const b = (by[l.m] ||= { m: l.m, revenue: 0, cogs: 0, payroll: 0, costs: 0 }); b.revenue += l.net; b.cogs += l.cogs; if (l.kind === 'labor' && l.mech) b.payroll += l.net * (staff[l.mech] || 0) / 100; }
      for (const c of all(`SELECT substr(COALESCE(doc_date, created_at),1,7) m, SUM(net) net FROM purchases WHERE substr(COALESCE(doc_date, created_at),1,10) BETWEEN ? AND ?
          AND NOT (lower(COALESCE(category,'')) GLOB '*czesc*' OR lower(COALESCE(category,'')) GLOB '*części*' OR lower(COALESCE(category,'')) GLOB '*towar*' OR lower(COALESCE(category,'')) GLOB '*материал*' OR lower(COALESCE(category,'')) GLOB '*запчаст*') GROUP BY m`, q.from, q.to)) {
        (by[c.m] ||= { m: c.m, revenue: 0, cogs: 0, payroll: 0, costs: 0 }).costs += c.net;
      }
      const rows = Object.values(by).sort((a, b) => a.m.localeCompare(b.m)).map((b) => ({ m: b.m, revenue: r2(b.revenue), cogs: r2(b.cogs), payroll: r2(b.payroll), costs: r2(b.costs), profit: r2(b.revenue - b.cogs - b.payroll - b.costs) }));
      const s = (k) => r2(rows.reduce((a, r) => a + r[k], 0));
      return { columns: [['m', 'Месяц', text], ['revenue', 'Выручка нетто', money], ['cogs', 'Себестоимость товаров', money], ['payroll', 'Зарплата механиков', money], ['costs', 'Прочие затраты', money], ['profit', 'Прибыль', money]], rows, totals: { revenue: s('revenue'), cogs: s('cogs'), payroll: s('payroll'), costs: s('costs'), profit: s('profit') } };
    },
  },

  // ── Склад ──
  stock_state: {
    group: 'Склад', title: 'Состояние склада', about: 'Остатки с учётом резервов в открытых заказах и стоимость по закупке.',
    params: [],
    run() {
      const rows = all(`SELECT p.name, p.code, p.manufacturer, p.location, p.stock, (SELECT COALESCE(SUM(i.qty),0) FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN order_statuses st ON st.id = o.status_id
          WHERE i.product_id = p.id AND o.kind = 'order' AND COALESCE(st.is_final,0) = 0) reserved, p.unit, p.purchase_price, p.sell_price FROM products p WHERE p.active = 1 ORDER BY p.name`)
        .map((r) => ({ ...r, free: r2(r.stock - r.reserved), value: r2(r.stock * r.purchase_price) }));
      return { columns: [['name', 'Товар', text], ['code', 'Код', text], ['manufacturer', 'Производитель', text], ['location', 'Место', text], ['stock', 'На складе', num], ['reserved', 'В резерве', num], ['free', 'Свободно', num], ['unit', 'Ед.', text], ['purchase_price', 'Закупка нетто', money], ['sell_price', 'Продажа брутто', money], ['value', 'Стоимость запаса', money]],
        rows, totals: { value: r2(rows.reduce((a, r) => a + Math.max(0, r.value), 0)) } };
    },
  },
  stock_inventory: {
    group: 'Склад', title: 'Инвентаризация (spis z natury)', about: 'Лист для пересчёта: учётное количество и пустая колонка для факта.',
    params: [],
    run() {
      const rows = all(`SELECT name, code, location, unit, stock, purchase_price FROM products WHERE active = 1 ORDER BY COALESCE(location,''), name`).map((r) => ({ ...r, counted: '', value: r2(r.stock * r.purchase_price) }));
      return { columns: [['location', 'Место', text], ['name', 'Товар', text], ['code', 'Код', text], ['unit', 'Ед.', text], ['stock', 'По учёту', num], ['counted', 'Факт', text], ['purchase_price', 'Цена нетто', money], ['value', 'Стоимость', money]], rows, totals: { value: r2(rows.reduce((a, r) => a + Math.max(0, r.value), 0)) } };
    },
  },
  stock_moves: {
    group: 'Склад', title: 'Движения по складу', about: 'Все PZ, WZ, RW, PW за период по товарам.',
    params: ['period', 'doctype'],
    run(q) {
      if (!isDate(q.from) || !isDate(q.to)) throw new HttpError(400, 'Выберите период');
      const p = [q.from, q.to]; let w = '';
      if (q.doctype) { w = 'AND d.type = ?'; p.push(q.doctype); }
      const rows = all(`SELECT d.doc_date d, d.type, d.number, d.counterparty, p.name, p.code, i.qty, i.price_net, i.qty * i.price_net value FROM stock_doc_items i JOIN stock_docs d ON d.id = i.doc_id JOIN products p ON p.id = i.product_id
        WHERE substr(d.doc_date,1,10) BETWEEN ? AND ? ${w} ORDER BY d.doc_date, d.id`, ...p).map((r) => ({ ...r, value: r2(r.value), qty: ['WZ', 'RW'].includes(r.type) ? -r.qty : r.qty }));
      return { columns: [['d', 'Дата', date], ['type', 'Тип', text], ['number', 'Документ', text], ['counterparty', 'Контрагент', text], ['name', 'Товар', text], ['code', 'Код', text], ['qty', 'Кол-во (+ приход / − расход)', num], ['price_net', 'Цена нетто', money], ['value', 'Стоимость', money]],
        rows, totals: {} };
    },
  },
  stock_receipts: {
    group: 'Склад', title: 'Приходы товаров', about: 'Что и на какую сумму пришло на склад (PZ) за период.',
    params: ['period'],
    run(q) { return REPORTS.stock_moves.run({ ...q, doctype: 'PZ' }); },
  },
  stock_reserved: {
    group: 'Склад', title: 'Резервы товаров', about: 'Запчасти, зарезервированные в открытых заказах.',
    params: [],
    run() {
      const rows = all(`SELECT p.name, p.code, o.id _order, o.number, ${L('o.created_at')} d, i.qty, p.stock FROM order_items i JOIN products p ON p.id = i.product_id JOIN orders o ON o.id = i.order_id
        LEFT JOIN order_statuses st ON st.id = o.status_id WHERE o.kind = 'order' AND COALESCE(st.is_final,0) = 0 ORDER BY p.name`);
      return { columns: [['name', 'Товар', text], ['code', 'Код', text], ['number', 'Заказ', text], ['d', 'Дата заказа', date], ['qty', 'Резерв', num], ['stock', 'На складе', num]], rows, totals: {} };
    },
  },

  // ── Хранение шин ──
  storage_list: {
    group: 'Хранение шин', title: 'Хранение шин за период', about: 'Что принято и выдано на хранение, где лежит, сколько оплачено.',
    params: ['period'],
    run(q) {
      if (!isDate(q.from) || !isDate(q.to)) throw new HttpError(400, 'Выберите период');
      const rows = all(`SELECT s.number, s.date_in, s.date_until, s.date_out, c.name cname, c.phone, k.plate, s.kind, s.description, s.qty, s.location, s.price FROM storage s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN cars k ON k.id = s.car_id
        WHERE substr(s.date_in,1,10) <= ? AND (s.date_out IS NULL OR substr(s.date_out,1,10) >= ?) ORDER BY s.date_in`, q.to, q.from);
      return { columns: [['number', 'Номер', text], ['date_in', 'Принято', date], ['date_until', 'Хранить до', date], ['date_out', 'Выдано', date], ['cname', 'Клиент', text], ['phone', 'Телефон', text], ['plate', 'Авто', text], ['kind', 'Что', text], ['description', 'Описание', text], ['qty', 'Шт.', num], ['location', 'Место', text], ['price', 'Цена', money]],
        rows, totals: { qty: rows.reduce((a, r) => a + (r.qty || 0), 0), price: r2(rows.reduce((a, r) => a + (r.price || 0), 0)) } };
    },
  },
};

export const reportList = () => Object.entries(REPORTS).map(([id, r]) => ({ id, group: r.group, title: r.title, about: r.about, params: r.params }));
export function runReport(id, q) {
  const r = REPORTS[id];
  if (!r) throw new HttpError(404, 'Нет такого рапорта');
  return { id, title: r.title, ...r.run(q || {}) };
}
export function toCsv(rep) {
  const cell = (v) => { const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [rep.columns.map((c) => cell(c[1])).join(';'), ...rep.rows.map((r) => rep.columns.map((c) => cell(r[c[0]])).join(';'))];
  if (Object.keys(rep.totals || {}).length) lines.push(rep.columns.map((c, i) => cell(i === 0 ? rep.total || 'Итого' : rep.totals[c[0]] ?? '')).join(';'));
  return '﻿' + lines.join('\r\n');
}

export function toXlsx(rep) {
  const head = rep.columns.map((c) => c[1]);
  const body = rep.rows.map((r) => rep.columns.map((c) => r[c[0]] ?? ''));
  if (Object.keys(rep.totals || {}).length) body.push(rep.columns.map((c, i) => (i === 0 ? rep.total || 'Итого' : rep.totals[c[0]] ?? '')));
  const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
  ws['!cols'] = rep.columns.map((c) => ({ wch: Math.min(40, Math.max(10, c[1].length + 2, c[2] === 'text' ? 22 : 12)) }));
  rep.columns.forEach((c, ci) => {
    if (c[2] !== 'money') return;
    for (let ri = 1; ri <= body.length; ri++) { const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })]; if (cell && typeof cell.v === 'number') cell.z = '#,##0.00'; }
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Raport');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, t) => (v === null || v === undefined || v === '' ? '' : t === 'money' ? Number(v).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : t === 'pct' ? `${v}%` : String(v));
export function toHtml(rep, S = {}, q = {}) {
  const right = (t) => (t === 'money' || t === 'num' || t === 'pct' ? ' class="r"' : '');
  const tot = Object.keys(rep.totals || {}).length
    ? `<tfoot><tr>${rep.columns.map((c, i) => `<td${right(c[2])}>${i === 0 ? `<b>${esc(rep.total || 'Итого')}</b>` : `<b>${esc(fmt(rep.totals[c[0]], c[2]))}</b>`}</td>`).join('')}</tr></tfoot>` : '';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(rep.title)}</title><style>
  body{font:12px/1.35 Arial,sans-serif;color:#111;margin:18px}h1{font-size:17px;margin:0 0 4px}.m{color:#555;margin-bottom:10px}
  table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:4px 6px;vertical-align:top}th{background:#f1f1f1;text-align:left}
  .r{text-align:right;white-space:nowrap}tfoot td{background:#fafafa}.bar{margin-bottom:12px}@media print{.bar{display:none}body{margin:0}}
  </style></head><body><div class="bar"><button onclick="print()">${esc(rep.printLabel || 'Печать')}</button></div>
  <h1>${esc(rep.title)}</h1><div class="m">${esc(S.company_legal_name || S.company_name || '')}${q.from ? ` · ${esc(q.from)} — ${esc(q.to)}` : ''}${rep.note ? ` · ${esc(rep.note)}` : ''}</div>
  <table><thead><tr>${rep.columns.map((c) => `<th${right(c[2])}>${esc(c[1])}</th>`).join('')}</tr></thead>
  <tbody>${rep.rows.map((r) => `<tr>${rep.columns.map((c) => `<td${right(c[2])}>${esc(fmt(r[c[0]], c[2]))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${rep.columns.length}">${esc(rep.emptyLabel || 'Нет данных')}</td></tr>`}</tbody>${tot}</table></body></html>`;
}

// Выгрузки на языке интерфейса: заголовки и названия колонок по словарю public/i18n/<lang>.json
const DICTS = {};
export function localize(rep, lang) {
  if (!['pl', 'en', 'uk'].includes(lang)) return rep;
  const d = (DICTS[lang] ||= (() => { try { return JSON.parse(fs.readFileSync(new URL(`../public/i18n/${lang}.json`, import.meta.url), 'utf8')); } catch { return {}; } })());
  const t = (x) => (typeof x === 'string' && d[x.trim()] !== undefined ? d[x.trim()] : x);
  return { ...rep, title: t(rep.title), note: t(rep.note), total: t('Итого'), printLabel: t('Печать'), emptyLabel: t('Нет данных'), columns: rep.columns.map(([k, l, ty]) => [k, t(l), ty]),
    rows: rep.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, t(v)]))) };
}
