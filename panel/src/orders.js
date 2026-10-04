// Логика заказов: пересчёт сумм, статусы, выдача со склада, баллы, уведомления
import { all, one, run, tx, insert, update, log, getSetting, quoteConvertedStatus } from './db.js';
import { HttpError, nextNumber, round2 } from './util.js';
import { earnForOrder } from './loyalty.js';
import { sendSms } from './sms.js';
import { statusSmsPreview, statusEmailPreview, textToHtml } from './messaging.js';
import { sendMail } from './integrations/services.js';

export const lineGross = (i) => round2(i.qty * i.price * (1 - (i.discount || 0) / 100));
export const lineNet = (i) => round2(lineGross(i) / (1 + (i.vat ?? 23) / 100));

export function recalc(orderId) {
  const items = all('SELECT * FROM order_items WHERE order_id = ?', orderId);
  const total = round2(items.reduce((s, i) => s + lineGross(i), 0));
  const net = round2(items.reduce((s, i) => s + lineNet(i), 0));
  const cost = round2(items.filter((i) => i.kind === 'part').reduce((s, i) => s + i.qty * (i.cost || 0), 0));
  const paid = round2(one(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) s FROM payments WHERE order_id = ?`, orderId).s);
  run('UPDATE orders SET total = ?, total_net = ?, cost = ?, paid = ? WHERE id = ?', total, net, cost, paid, orderId);
  return { total, net, cost, paid };
}

export const getOrder = (id) => {
  const o = one('SELECT * FROM orders WHERE id = ?', id);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  return o;
};

export function createOrder(data, staffName) {
  const kind = data.kind === 'quote' ? 'quote' : 'order';
  const firstStatus = one(kind === 'quote'
    ? `SELECT id FROM order_statuses WHERE name LIKE 'Ожидает оценки%' ORDER BY pos LIMIT 1`
    : 'SELECT id FROM order_statuses ORDER BY pos LIMIT 1');
  return tx(() => {
    const id = insert('orders', {
      kind,
      number: nextNumber(kind === 'quote' ? 'WY' : 'ZL'),
      customer_id: data.customer_id || null,
      car_id: data.car_id || null,
      status_id: data.status_id || firstStatus?.id || null,
      type_id: data.type_id || null,
      mechanic_id: data.mechanic_id || null,
      mileage: data.mileage || null,
      complaint: data.complaint || null,
      internal_note: data.internal_note || null,
      mechanic_note: data.mechanic_note || null,
      notes: data.notes || null,
      contact_person: data.contact_person || null,
      contact_phone: data.contact_phone || null,
      pickup_at: data.pickup_at || null,
      flags: data.flags ? JSON.stringify(data.flags) : null,
      damages: Array.isArray(data.damages) ? JSON.stringify(data.damages.slice(0, 60)) : null,
      damages_note: data.damages_note || null,
      fuel_level: data.fuel_level || null,
      external_no: data.external_no || null,
      source: data.source || 'crm',
      created_by: staffName,
    });
    if (data.car_id && data.customer_id) run('UPDATE cars SET customer_id = COALESCE(customer_id, ?) WHERE id = ?', data.customer_id, data.car_id);
    for (const it of data.items || []) addItem(id, it);
    recalc(id);
    log('order', id, 'create', { kind }, staffName);
    return id;
  });
}

const ITEM_FIELDS = ['kind', 'name', 'code', 'product_id', 'mechanic_id', 'qty', 'unit', 'price', 'cost', 'discount', 'vat', 'done', 'pos', 'task_id'];
export function addItem(orderId, it) {
  if (!it.name) throw new HttpError(400, 'Название позиции обязательно');
  const row = {};
  for (const k of ITEM_FIELDS) if (it[k] !== undefined) row[k] = it[k];
  row.order_id = orderId;
  row.kind = it.kind === 'part' ? 'part' : 'labor';
  row.qty = Number(it.qty ?? 1);
  // работа в нормо-часах без цены — по ставке RBH из настроек (нетто → брутто)
  if (row.kind === 'labor' && (it.price === undefined || it.price === null || it.price === '') && String(it.unit || '').toLowerCase() === 'rbh') {
    it.price = round2((Number(getSetting('rbh_rate', '0')) || 0) * (1 + Number(it.vat ?? getSetting('default_vat', '23')) / 100));
  }
  row.price = Number(it.price ?? 0);
  if (it.product_id && it.cost === undefined) {
    const p = one('SELECT purchase_price, code, unit, vat FROM products WHERE id = ?', it.product_id);
    if (p) { row.cost = p.purchase_price; row.code ??= p.code; row.unit ??= p.unit; row.vat ??= p.vat; }
  }
  row.pos ??= (one('SELECT COALESCE(MAX(pos),0)+1 n FROM order_items WHERE order_id = ?', orderId).n);
  const id = insert('order_items', row);
  return id;
}

export function updateItem(itemId, it, staff) {
  const cur = one('SELECT * FROM order_items WHERE id = ?', itemId);
  if (!cur) throw new HttpError(404, 'Позиция не найдена');
  const row = {};
  for (const k of ITEM_FIELDS) if (it[k] !== undefined && k !== 'kind') row[k] = it[k];
  if (row.done && !cur.done && cur.kind === 'labor') {
    const mech = row.mechanic_id ?? cur.mechanic_id;
    if (getSetting('require_mechanic_job') === '1' && !mech) throw new HttpError(400, 'Сначала выберите механика для этой работы');
    if (getSetting('only_assigned_finish') === '1' && staff && staff.role !== 'admin' && mech && mech !== staff.id) throw new HttpError(403, 'Отметить работу может только назначенный механик');
  }
  update('order_items', itemId, row);
  if (row.done !== undefined && !!row.done !== !!cur.done && cur.kind === 'labor') autoStatusOnJobs(cur.order_id, staff?.name);
}

/** Статус сам меняется, когда начата первая работа / выполнены все работы (Настройки → Мастерская) */
function autoStatusOnJobs(orderId, staffName) {
  const o = getOrder(orderId);
  if (o.kind !== 'order' || isFinal(o.status_id)) return;
  const jobs = all(`SELECT done FROM order_items WHERE order_id = ? AND kind = 'labor'`, orderId);
  const doneN = jobs.filter((j) => j.done).length;
  const target = jobs.length && doneN === jobs.length ? getSetting('status_on_all_jobs') : doneN >= 1 ? getSetting('status_on_first_job') : null;
  if (target && Number(target) !== o.status_id && one('SELECT 1 FROM order_statuses WHERE id = ?', Number(target))) setStatus(orderId, Number(target), staffName || 'авто');
}

function isFinal(statusId) {
  return !!one('SELECT is_final FROM order_statuses WHERE id = ?', statusId)?.is_final;
}

/** Выдача запчастей со склада (WZ) при завершении заказа */
function issueStock(order, staffName) {
  const parts = all('SELECT * FROM order_items WHERE order_id = ? AND kind = ? AND product_id IS NOT NULL', order.id, 'part');
  if (!parts.length || one(`SELECT 1 FROM stock_docs WHERE order_id = ? AND type = 'WZ'`, order.id)) return;
  const c = order.customer_id ? one('SELECT name FROM customers WHERE id = ?', order.customer_id) : null;
  const docId = insert('stock_docs', {
    type: 'WZ', number: nextNumber('WZ'), counterparty: c?.name || null, order_id: order.id,
    doc_date: new Date().toISOString().slice(0, 10), note: `Zlecenie ${order.number}`, created_by: staffName,
  });
  let net = 0;
  for (const p of parts) {
    run('INSERT INTO stock_doc_items (doc_id, product_id, qty, price_net) VALUES (?, ?, ?, ?)', docId, p.product_id, p.qty, p.cost || 0);
    run('UPDATE products SET stock = stock - ? WHERE id = ?', p.qty, p.product_id);
    net += p.qty * (p.cost || 0);
  }
  run('UPDATE stock_docs SET total_net = ? WHERE id = ?', round2(net), docId);
}

function reverseStock(order) {
  const doc = one(`SELECT * FROM stock_docs WHERE order_id = ? AND type = 'WZ'`, order.id);
  if (!doc) return;
  for (const i of all('SELECT * FROM stock_doc_items WHERE doc_id = ?', doc.id)) run('UPDATE products SET stock = stock + ? WHERE id = ?', i.qty, i.product_id);
  run('DELETE FROM stock_docs WHERE id = ?', doc.id);
}

export function setStatus(orderId, statusId, staffName) {
  const o = getOrder(orderId);
  const st = one('SELECT * FROM order_statuses WHERE id = ?', statusId);
  if (!st) throw new HttpError(400, 'Нет такого статуса');
  if (o.status_id === st.id) return { earned: 0 };
  const wasFinal = isFinal(o.status_id);
  if (st.is_final && !wasFinal && o.kind === 'order') {
    const jobs = all(`SELECT * FROM order_items WHERE order_id = ? AND kind = 'labor'`, o.id);
    if (getSetting('block_finish_open_jobs') === '1' && jobs.some((j) => !j.done)) throw new HttpError(400, 'Нельзя завершить заказ: есть невыполненные работы');
    if (getSetting('require_mechanic_all') === '1' && jobs.some((j) => !j.mechanic_id)) throw new HttpError(400, 'Нельзя завершить заказ: не во всех работах выбран механик');
    if (getSetting('stock_negative', '1') !== '1') {
      const short = all(`SELECT i.name, i.qty, p.stock FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = ? AND i.kind = 'part' AND p.stock < i.qty`, o.id);
      if (short.length && !one(`SELECT 1 FROM stock_docs WHERE order_id = ? AND type = 'WZ'`, o.id)) throw new HttpError(400, `Не хватает на складе: ${short.map((x) => `${x.name} (есть ${x.stock}, нужно ${x.qty})`).join(', ')}. Сделайте приход или разрешите минусовой остаток в настройках.`);
    }
  }
  let earned = 0;
  tx(() => {
    run('UPDATE orders SET status_id = ?, closed_at = ? WHERE id = ?', st.id, st.is_final ? (o.closed_at || new Date().toISOString().slice(0, 19).replace('T', ' ')) : null, o.id);
    if (o.kind === 'order') {
      if (st.is_final && !wasFinal) {
        issueStock(o, staffName);
        const fresh = getOrder(o.id);
        earned = earnForOrder(fresh);
      }
      if (!st.is_final && wasFinal) reverseStock(o);
    }
    log('order', o.id, 'status', st.name, staffName);
  });
  // SMS/e-mail по шаблону статуса: 'auto' — сразу, 'ask' — окно в панели с готовым текстом
  const sms = statusSmsPreview(o.id, st.id);
  const email = statusEmailPreview(o.id, st.id);
  if (sms?.mode === 'auto') sendSms(sms.phone, sms.text, { kind: 'status', order_id: o.id, customer_id: o.customer_id, staff: staffName })
    .then(() => log('order', o.id, 'sms', sms.text, staffName)).catch((e) => console.error('SMS status:', e.message));
  if (email?.mode === 'auto') sendMail({ to: email.to, subject: email.subject, html: textToHtml(email.text) })
    .then(() => log('order', o.id, 'email', email.to, staffName)).catch((e) => console.error('E-mail status:', e.message));
  return { earned, sms: sms?.mode === 'ask' ? sms : null, email: email?.mode === 'ask' ? email : null };
}

/** Выцена → заказ (копия позиций) */
export function quoteToOrder(quoteId, staffName) {
  const q = getOrder(quoteId);
  if (q.kind !== 'quote') throw new HttpError(400, 'Это не выцена');
  const items = all('SELECT * FROM order_items WHERE order_id = ? ORDER BY pos', q.id);
  return tx(() => {
    const id = createOrder({ ...q, kind: 'order', status_id: null, items: items.map(({ id: _i, order_id: _o, ...it }) => it) }, staffName);
    run('UPDATE orders SET quote_id = ? WHERE id = ?', q.id, id);
    closeQuote(q.id);
    log('order', q.id, 'to_order', { orderId: id }, staffName);
    return id;
  });
}
/** Выцена отработана (стала заказом / добавлена в заказ): статус «завершено», обзвон — «записан» */
function closeQuote(qid) {
  run(`UPDATE orders SET status_id = ?, closed_at = COALESCE(closed_at, datetime('now')) WHERE id = ?`, quoteConvertedStatus(), qid);
  run(`UPDATE orders SET followup = 'accepted' WHERE id = ? AND COALESCE(followup,'') IN ('', 'new', 'call_back', 'thinking', 'scheduled', 'no_answer')`, qid);
}
const itemCopy = ({ id: _i, order_id: _o, pos: _p, done: _d, ...it }) => it;
/** Позиции выцены — в уже существующий заказ (как «Dodaj do zlecenia» в Motowarsztat) */
export function quoteToExistingOrder(quoteId, orderId, staffName) {
  const q = getOrder(quoteId), o = getOrder(orderId);
  if (q.kind !== 'quote') throw new HttpError(400, 'Это не выцена');
  if (o.kind !== 'order') throw new HttpError(400, 'Выберите заказ');
  const st = o.status_id ? one('SELECT is_final FROM order_statuses WHERE id = ?', o.status_id) : null;
  if (st?.is_final) throw new HttpError(400, 'Заказ уже закрыт');
  const items = all('SELECT * FROM order_items WHERE order_id = ? ORDER BY pos, id', q.id);
  if (!items.length) throw new HttpError(400, 'В выцене нет позиций');
  return tx(() => {
    let pos = one('SELECT COALESCE(MAX(pos),0) m FROM order_items WHERE order_id = ?', o.id).m;
    for (const it of items) addItem(o.id, { ...itemCopy(it), pos: ++pos });
    recalc(o.id);
    run('UPDATE orders SET merged_into = ? WHERE id = ?', o.id, q.id);
    if (!o.quote_id) run('UPDATE orders SET quote_id = ? WHERE id = ?', q.id, o.id);
    closeQuote(q.id);
    log('order', q.id, 'to_order', { orderId: o.id, merged: true }, staffName);
    log('order', o.id, 'update', `Добавлены позиции из выцены ${q.number} (${items.length})`, staffName);
    return { id: o.id, added: items.length };
  });
}
/** Копия заказа / выцены: те же клиент, авто, описание и позиции, новый номер */
export function copyOrder(id, staffName) {
  const src = getOrder(id);
  const items = all('SELECT * FROM order_items WHERE order_id = ? ORDER BY pos, id', src.id);
  const flags = src.flags ? JSON.parse(src.flags) : null;
  const damages = src.damages ? JSON.parse(src.damages) : null;
  const nid = createOrder({ ...src, status_id: null, flags, damages, mileage: src.mileage, items: items.map((it, i) => ({ ...itemCopy(it), pos: i + 1 })) }, staffName);
  log('order', nid, 'update', `Копия ${src.number}`, staffName);
  return nid;
}

/** Полная карточка заказа для панели */
export function orderFull(id) {
  const o = getOrder(id);
  return {
    ...o,
    flags: o.flags ? JSON.parse(o.flags) : {},
    customer: o.customer_id ? one('SELECT * FROM customers WHERE id = ?', o.customer_id) : null,
    car: o.car_id ? one('SELECT * FROM cars WHERE id = ?', o.car_id) : null,
    status: o.status_id ? one('SELECT * FROM order_statuses WHERE id = ?', o.status_id) : null,
    items: all(`SELECT i.*, s.name mechanic_name, p.stock product_stock FROM order_items i
      LEFT JOIN staff s ON s.id = i.mechanic_id LEFT JOIN products p ON p.id = i.product_id WHERE order_id = ? ORDER BY pos, id`, id),
    payments: all('SELECT * FROM payments WHERE order_id = ? ORDER BY id', id),
    receipts: all('SELECT id, number, nip, total, status, printer, error, created_at, printed_at FROM receipts WHERE order_id = ? ORDER BY id DESC', id),
    appointments: all(`SELECT a.*, st.name station_name FROM appointments a LEFT JOIN stations st ON st.id = a.station_id WHERE order_id = ? ORDER BY start_at`, id),
    activity: all(`SELECT * FROM activity WHERE entity = 'order' AND entity_id = ? ORDER BY id DESC LIMIT 50`, id),
    loyalty: o.customer_id ? all(`SELECT * FROM transactions WHERE order_no = ?`, o.number) : [],
    // связи выцена ↔ заказ (как фактура ↔ Pro forma)
    linked_orders: o.kind === 'quote' ? all(`SELECT id, number, created_at, CASE WHEN id = ? THEN 'merged' ELSE 'created' END how FROM orders WHERE kind = 'order' AND (quote_id = ? OR id = ?) ORDER BY id`, o.merged_into || -1, o.id, o.merged_into || -1) : [],
    linked_quotes: o.kind === 'order' ? all(`SELECT id, number, created_at FROM orders WHERE kind = 'quote' AND (id = ? OR merged_into = ?) ORDER BY id`, o.quote_id || -1, o.id) : [],
  };
}
