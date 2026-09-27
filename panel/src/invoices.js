// Фактуры VAT через Fakturownia.pl — они же отправляют документ в KSeF.
// Документация API: https://app.fakturownia.pl/api
import { all, one, run } from './db.js';
import { cfg } from './integrations/index.js';
import { HttpError, round2 } from './util.js';
import { lineGross } from './orders.js';

// токен «с префиксом» выглядит как XXXX/pulsecar — домен можно не вводить отдельно
function F(any = false) {
  const c = cfg('fakturownia', { ignoreEnabled: any }) || {};
  let domain = String(c.domain || '').trim().replace(/^https?:\/\//, '').replace(/\.fakturownia\.pl.*$/, '');
  const token = String(c.token || '').trim();
  if (!domain && token.includes('/')) domain = token.split('/').pop();
  return { domain, token };
}
export const invoicesEnabled = () => { const f = F(); return !!(f.domain && f.token); };
const base = (any = false) => process.env.FAKTUROWNIA_BASE || `https://${F(any).domain}.fakturownia.pl`;

const PAY = { cash: 'cash', card: 'card', transfer: 'transfer', points: 'other' };

export async function issueInvoice(orderId, { kind = 'vat', buyer = {} } = {}) {
  if (!invoicesEnabled()) throw new HttpError(400, 'Fakturownia не подключена: Настройки → Интеграции → Fakturownia.');
  const o = one('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  if (o.invoice_ext_id) throw new HttpError(409, `Фактура уже выставлена: ${o.invoice_no}`);
  const c = o.customer_id ? one('SELECT * FROM customers WHERE id = ?', o.customer_id) : {};
  const items = all('SELECT * FROM order_items WHERE order_id = ? ORDER BY pos', o.id);
  if (!items.length) throw new HttpError(400, 'В заказе нет позиций');
  const car = o.car_id ? one('SELECT make, model, plate, vin FROM cars WHERE id = ?', o.car_id) : null;
  const pay = one(`SELECT method FROM payments WHERE order_id = ? AND method <> 'points' ORDER BY amount DESC LIMIT 1`, o.id);

  const nip = (buyer.nip ?? c.nip ?? '').replace(/\D/g, '');
  const invoice = {
    kind, // vat — фактура; для частных лиц без NIP тоже vat (faktura imienna)
    sell_date: (o.closed_at || new Date().toISOString()).slice(0, 10),
    issue_date: new Date().toISOString().slice(0, 10),
    payment_type: PAY[pay?.method] || 'cash',
    status: o.paid >= o.total ? 'paid' : 'issued',
    buyer_name: buyer.name || c.company || c.name || 'Klient detaliczny',
    buyer_tax_no: nip || undefined,
    buyer_company: nip ? 1 : 0,
    buyer_street: buyer.street ?? c.street ?? undefined,
    buyer_post_code: buyer.postcode ?? c.postcode ?? undefined,
    buyer_city: buyer.city ?? c.city ?? undefined,
    buyer_email: c.email || undefined,
    description: [`Zlecenie ${o.number}`, car && [car.make, car.model, car.plate, car.vin].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
    positions: items.map((i) => ({
      name: i.name, quantity: i.qty, quantity_unit: i.unit || (i.kind === 'labor' ? 'usł.' : 'szt.'),
      total_price_gross: lineGross(i), tax: i.vat ?? 23,
    })),
  };
  const r = await fetch(`${base()}/invoices.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_token: F().token, invoice }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw new HttpError(502, 'Fakturownia: ' + (j.message ? JSON.stringify(j.message) : r.status));
  run('UPDATE orders SET invoice_no = ?, invoice_ext_id = ?, invoice_url = ? WHERE id = ?', j.number, String(j.id), j.view_url || null, o.id);
  return { number: j.number, id: j.id, url: j.view_url, total: round2(j.price_gross) };
}

/** PDF фактуры (проксируем, чтобы токен не попадал в браузер) */
export async function invoicePdf(orderId) {
  const o = one('SELECT invoice_ext_id FROM orders WHERE id = ?', orderId);
  if (!o?.invoice_ext_id || !invoicesEnabled()) throw new HttpError(404, 'Фактуры нет');
  const r = await fetch(`${base()}/invoices/${o.invoice_ext_id}.pdf?api_token=${encodeURIComponent(F().token)}`);
  if (!r.ok) throw new HttpError(502, 'Fakturownia: не удалось получить PDF');
  return Buffer.from(await r.arrayBuffer());
}

export async function testFakturownia() {
  const f = F(true);
  if (!f.domain || !f.token) throw new Error('Укажите домен и токен');
  const r = await fetch(`${base(true)}/account.json?api_token=${encodeURIComponent(f.token)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.code === 'error') throw new Error('Fakturownia: токен или домен не подходят (' + r.status + ')');
  return `Konto ${j.prefix || f.domain}${j.name ? ' · ' + j.name : ''}`;
}
