// Логика заказов: пересчёт сумм, статусы, выдача со склада, баллы, уведомления
import { all, one, run, tx, insert, update, log } from './db.js';
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

const ITEM_FIELDS = ['kind', 'name', 'code', 'product_id', 'mechanic_id', 'qty', 'unit', 'price', 'cost', 'discount', 'vat', 'done', 'pos'];
export function addItem(orderId, it) {
  if (!it.name) throw new HttpError(400, 'Название позиции обязательно');
  const row = {};
  for (const k of ITEM_FIELDS) if (it[k] !== undefined) row[k] = it[k];
  row.order_id = orderId;
  row.kind = it.kind === 'part' ? 'part' : 'labor';
  row.qty = Number(it.qty ?? 1);
  row.price = Number(it.price ?? 0);
  if (it.product_id && it.cost === undefined) {
    const p = one('SELECT purchase_price, code, unit, vat FROM products WHERE id = ?', it.product_id);
    if (p) { row.cost = p.purchase_price; row.code ??= p.code; row.unit ??= p.unit; row.vat ??= p.vat; }
  }
  row.pos ??= (one('SELECT COALESCE(MAX(pos),0)+1 n FROM order_items WHERE order_id = ?', orderId).n);
  const id = insert('order_items', row);
  return id;
}

export function updateItem(itemId, it) {
  const row = {};
  for (const k of ITEM_FIELDS) if (it[k] !== undefined && k !== 'kind') row[k] = it[k];
  update('order_items', itemId, row);
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
    doc_date: new Date().toISOString().slice(0, 10), note: `Заказ ${order.number}`, created_by: staffName,
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

/** Смета → заказ (копия позиций) */
export function quoteToOrder(quoteId, staffName) {
  const q = getOrder(quoteId);
  if (q.kind !== 'quote') throw new HttpError(400, 'Это не смета');
  const items = all('SELECT * FROM order_items WHERE order_id = ? ORDER BY pos', q.id);
  return tx(() => {
    const id = createOrder({ ...q, kind: 'order', status_id: null, items: items.map(({ id: _i, order_id: _o, ...it }) => it) }, staffName);
    run('UPDATE orders SET quote_id = ? WHERE id = ?', q.id, id);
    const fin = one('SELECT id FROM order_statuses WHERE is_final = 1 ORDER BY pos LIMIT 1');
    if (fin) run('UPDATE orders SET status_id = ?, closed_at = datetime(\'now\') WHERE id = ?', fin.id, q.id);
    log('order', q.id, 'to_order', { orderId: id }, staffName);
    return id;
  });
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
    appointments: all(`SELECT a.*, st.name station_name FROM appointments a LEFT JOIN stations st ON st.id = a.station_id WHERE order_id = ? ORDER BY start_at`, id),
    activity: all(`SELECT * FROM activity WHERE entity = 'order' AND entity_id = ? ORDER BY id DESC LIMIT 50`, id),
    loyalty: o.customer_id ? all(`SELECT * FROM transactions WHERE order_no = ?`, o.number) : [],
  };
}
