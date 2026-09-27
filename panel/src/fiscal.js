// Фискальная касса (drukarka fiskalna online). CRM на сервере не видит кассу в сети сервиса,
// поэтому чек печатает расширение Pulsecar в Chrome на компьютере у кассы: CRM готовит задание
// (JSON по протоколу NoviAPI — Novitus POINT / HD II Online / Deon Online / Bono Online / INFIS),
// расширение отправляет его на кассу в локальной сети и возвращает номер (JPKID) или ошибку.
// Режим «вручную»: чек пробивается на кассе, в CRM вписывается его номер.
import { all, one, run, insert, update } from './db.js';
import { cfg } from './integrations/index.js';
import { HttpError, round2 } from './util.js';

export const DRIVERS = { novitus: 'Novitus NoviAPI (POINT, HD II Online, Deon Online, Bono Online, INFIS)', manual: 'Вручную: чек на кассе, номер в CRM' };

export function fiscalCfg() {
  const c = cfg('fiscal');
  if (!c) return null;
  return {
    driver: DRIVERS[c.driver] ? c.driver : 'novitus',
    url: String(c.url || '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/, ''),
    cashier: String(c.cashier || '').slice(0, 32),
    cashNumber: String(c.cashNumber || '1').slice(0, 8),
    ptu: parsePtu(c.ptu),
    autoOnPay: !!c.autoOnPay,
    drawer: c.drawer !== false,
  };
}

/** «23:A, 8:B, 5:C, 0:D» → { 23: 'A', … } — буквы PTU, как они запрограммированы в кассе */
export function parsePtu(s) {
  const m = { 23: 'A', 8: 'B', 5: 'C', 0: 'D' };
  for (const part of String(s || '').split(/[,;\s]+/)) {
    const [k, v] = part.split(/[:=]/);
    if (k !== undefined && /^[A-G]$/i.test(v || '') && !Number.isNaN(Number(k))) m[Number(k)] = v.toUpperCase();
  }
  return m;
}

const clean = (s, n) => String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, n) || 'Usługa';
const money = (n) => round2(n).toFixed(2);
const qtyStr = (n) => String(Math.round(Number(n) * 1e6) / 1e6);

/** Позиции заказа → позиции чека (цены брутто после скидки). */
export function receiptLines(orderId) {
  return all('SELECT * FROM order_items WHERE order_id = ? ORDER BY kind DESC, pos, id', orderId)
    .filter((i) => Number(i.qty) > 0 && Number(i.price) > 0)
    .map((i) => {
      const qty = Number(i.qty);
      const gross = round2(qty * i.price * (1 - (Number(i.discount) || 0) / 100));
      let price = round2(gross / qty);
      let q = qty;
      // касса проверяет цена × количество = сумма: если копейки не сходятся — 1 × сумма
      if (round2(price * q) !== gross) { price = gross; q = 1; }
      return { name: clean(i.name, 60), qty: q, price, value: gross, vat: Number(i.vat), unit: i.unit ? clean(i.unit, 4) : null };
    });
}

/** Задание для NoviAPI: POST /api/v1/receipt { receipt } */
export function noviReceipt(lines, { nip, payments, cfg: c, systemNumber }) {
  const total = round2(lines.reduce((a, l) => a + l.value, 0));
  const letter = (v) => {
    const L = c.ptu[v];
    if (!L) throw new HttpError(400, `Для ставки VAT ${v}% не задана буква PTU кассы (Интеграции → Фискальная касса)`);
    return L;
  };
  const pays = [];
  let rest = total;
  for (const p of payments) {
    const v = Math.min(round2(p.amount), rest);
    if (!(v > 0)) continue;
    rest = round2(rest - v);
    if (p.method === 'cash') pays.push({ cash: { value: money(v) } });
    else if (p.method === 'card') pays.push({ card: { name: 'Karta', value: money(v) } });
    else if (p.method === 'transfer') pays.push({ transfer: { name: 'Przelew', value: money(v) } });
    else if (p.method === 'points') pays.push({ voucher: { name: 'Pulse Points', value: money(v) } });
  }
  if (rest > 0) pays.push({ cash: { value: money(rest) } });
  const receipt = {
    items: lines.map((l) => ({ article: { name: l.name, ptu: letter(l.vat), quantity: qtyStr(l.qty), price: money(l.price), value: money(l.value), ...(l.unit ? { unit: l.unit } : {}) } })),
    payments: pays,
    summary: { total: money(total), pay_in: money(total) },
    system_info: { ...(c.cashier ? { cashier_name: c.cashier } : {}), cash_number: c.cashNumber, ...(systemNumber ? { system_number: { print_as: 'text', value: String(systemNumber).slice(0, 512) } } : {}) },
    device_control: { open_drawer: c.drawer && pays.some((p) => p.cash), paper_cut: 'full' },
  };
  if (nip) receipt.buyer = { nip: String(nip).replace(/\D/g, '').slice(0, 16) };
  return { total, body: { receipt } };
}

function payload(r) {
  try { return JSON.parse(r.items || '[]'); } catch { return []; }
}
export function jobFor(r, c = fiscalCfg()) {
  if (!c || c.driver !== 'novitus') return null;
  const p = payload(r);
  if (!p.body) return null;
  return { id: r.id, driver: 'novitus', url: c.url, resource: 'receipt', body: p.body };
}

/** Новый чек по заказу. Возвращает строку receipts и задание для расширения (или null для «вручную»). */
export function createReceipt(order, { nip, method } = {}, staff = '') {
  const c = fiscalCfg();
  if (!c) throw new HttpError(400, 'Фискальная касса не подключена: Настройки → Интеграции → Фискальная касса');
  const done = one("SELECT id, number FROM receipts WHERE order_id = ? AND status = 'printed'", order.id);
  if (done) throw new HttpError(409, `Чек по этому заказу уже напечатан (${done.number || '№ ' + done.id})`);
  const lines = receiptLines(order.id);
  if (!lines.length) throw new HttpError(400, 'В заказе нет позиций с ценой');
  const paid = all("SELECT method, SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END) amount FROM payments WHERE order_id = ? AND transfer_id IS NULL GROUP BY method", order.id);
  const payments = method ? [{ method, amount: 1e9 }] : paid.sort((a, b) => (a.method === 'points' ? -1 : b.method === 'points' ? 1 : 0));
  const job = noviReceipt(lines, { nip: nip || null, payments, cfg: c, systemNumber: order.number });
  // незавершённые задания по этому заказу больше не нужны
  run("UPDATE receipts SET status = 'error', error = 'Заменён новым чеком' WHERE order_id = ? AND status = 'pending'", order.id);
  const id = insert('receipts', {
    order_id: order.id, nip: nip || null, total: job.total, payment_method: method || paid.find((p) => p.method !== 'points')?.method || 'cash',
    items: JSON.stringify({ lines, body: job.body }), status: c.driver === 'manual' ? 'manual' : 'pending', printer: c.driver, staff,
  });
  const r = one('SELECT * FROM receipts WHERE id = ?', id);
  return { receipt: publicReceipt(r), job: jobFor(r, c) };
}

export const publicReceipt = (r) => (r ? { id: r.id, order_id: r.order_id, number: r.number, nip: r.nip, total: r.total, status: r.status, printer: r.printer, error: r.error, created_at: r.created_at, printed_at: r.printed_at } : null);

/** Результат от расширения: { ok, jpkid, error, eDocument } */
export function saveResult(id, res = {}) {
  const r = one('SELECT * FROM receipts WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Чек не найден');
  if (r.status === 'printed') return publicReceipt(r);
  if (res.ok) {
    const number = String(res.jpkid ?? res.number ?? '').slice(0, 40) || null;
    update('receipts', id, { status: 'printed', number, error: null, printed_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
    if (r.order_id && number) run("UPDATE orders SET receipt_no = ? WHERE id = ? AND COALESCE(receipt_no,'') = ''", number, r.order_id);
  } else {
    update('receipts', id, { status: res.pending ? 'pending' : 'error', error: String(res.error || 'Касса не ответила').slice(0, 300) });
  }
  return publicReceipt(one('SELECT * FROM receipts WHERE id = ?', id));
}

/** Чек пробит на кассе вручную — сохраняем номер */
export function setManual(id, number) {
  const r = one('SELECT * FROM receipts WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Чек не найден');
  if (!String(number || '').trim()) throw new HttpError(400, 'Впишите номер чека');
  update('receipts', id, { status: 'printed', number: String(number).trim().slice(0, 40), error: null, printed_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
  if (r.order_id) run('UPDATE orders SET receipt_no = ? WHERE id = ?', String(number).trim(), r.order_id);
  return publicReceipt(one('SELECT * FROM receipts WHERE id = ?', id));
}

/** Raport dobowy: POST /api/v1/daily_report, дата ДД/ММ/ГГГГ */
export function dailyJob(date) {
  const c = fiscalCfg();
  if (!c || c.driver !== 'novitus') throw new HttpError(400, 'Отчёт с кассы доступен для Novitus NoviAPI');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : new Date().toISOString().slice(0, 10);
  return { driver: 'novitus', url: c.url, resource: 'daily_report', body: { daily_report: { date: `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`, system_info: { ...(c.cashier ? { cashier_name: c.cashier } : {}), cash_number: c.cashNumber } } } };
}
