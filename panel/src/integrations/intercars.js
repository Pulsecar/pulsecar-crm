// Inter Cars IC API (https://docs.webapi.intercars.eu/ic-api/contracts/api)
// Токен: POST https://is.webapi.intercars.eu/oauth2/token, Basic base64(ClientId:ClientSecret), grant_type=client_credentials, scope=allinone
// API:   https://api.webapi.intercars.eu/ic/...
import { all, one, run, ilog } from '../db.js';
import { HttpError, round2, today } from '../util.js';
import { cfg, getState, setState } from './index.js';
import { createStockDoc } from '../stock.js';
import { notify } from './notify.js';
import { forEachDb } from '../branches.js';

const KEY = 'intercars';
const conf = () => {
  const c = cfg(KEY);
  if (!c) throw new HttpError(400, 'Inter Cars не подключён: Настройки → Интеграции → Inter Cars.');
  if (!c.clientId || !c.clientSecret) throw new HttpError(400, 'Заполните ClientId и ClientSecret Inter Cars.');
  return c;
};

async function token(c, force = false) {
  const st = getState(KEY);
  if (!force && st.token && st.tokenExp > Date.now() + 60_000 && st.tokenFor === c.clientId) return st.token;
  const r = await fetch(c.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials&scope=allinone',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new HttpError(502, `Inter Cars: не удалось войти (${r.status}${j.error_description ? ' — ' + j.error_description : ''}). Проверьте ClientId/ClientSecret.`);
  setState(KEY, { token: j.access_token, tokenExp: Date.now() + (Number(j.expires_in) || 3600) * 1000, tokenFor: c.clientId });
  return j.access_token;
}

async function ic(path, { method = 'GET', body, query } = {}, retry = true) {
  const c = conf();
  const t = await token(c);
  const q = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  const r = await fetch(c.baseUrl.replace(/\/$/, '') + path + q, {
    method,
    headers: { Accept: 'application/json', 'Accept-Language': 'pl', Authorization: 'Bearer ' + t, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && retry) { await token(c, true); return ic(path, { method, body, query }, false); }
  if (r.status === 404) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new HttpError(502, `Inter Cars ${path}: ${r.status} ${j?.message || j?.error || ''}`.trim());
  return j;
}

const d2s = (d) => d.toISOString().slice(0, 10);

/** Проверка связи: данные клиента и финансы */
export async function testIntercars() {
  const cust = await ic('/ic/customer');
  const fin = await ic('/ic/customer/finances').catch(() => null);
  const info = `${cust?.name || 'OK'}${fin ? ` · лимит ${fin.availableCreditLimit ?? '—'} ${fin.currencyCode || ''} · баллы VIP ${fin.vipPoints ?? '—'}` : ''}`;
  setState(KEY, { info, lastError: null });
  return info;
}

/** Загрузка новых документов за последние N дней (API разрешает окна по 2 дня) */
export async function fetchDocs(daysBack = 7) {
  const c = conf();
  const kind = c.source === 'invoice' ? 'invoice' : 'delivery';
  let created = 0;
  const end = new Date();
  for (let back = daysBack; back > 0; back -= 2) {
    const from = new Date(end); from.setDate(end.getDate() - back);
    const to = new Date(end); to.setDate(end.getDate() - Math.max(0, back - 2));
    const range = kind === 'delivery' ? { creationDateFrom: d2s(from), creationDateTo: d2s(to) } : { issueDateFrom: d2s(from), issueDateTo: d2s(to) };
    const limit = kind === 'delivery' ? 50 : 200;
    for (let offset = 1; offset < 10_000; offset += limit) {
      const list = (await ic(`/ic/${kind}`, { query: { ...range, offset, limit, shipTo: c.shipTo } })) || [];
      for (const d of list) {
        if (one('SELECT 1 FROM supplier_docs WHERE supplier = ? AND kind = ? AND ext_id = ?', KEY, kind, d.id)) continue;
        const full = kind === 'invoice' ? ((await ic(`/ic/invoice/${encodeURIComponent(d.id)}`)) || [d])[0] || d : d;
        const lines = full.lines || [];
        const totalNet = full.totalNet ?? lines.reduce((s, l) => s + (l.totalNet ?? (l.unitPriceNet || 0) * qtyOf(l, kind)), 0);
        const totalGross = full.totalGross ?? lines.reduce((s, l) => s + (l.totalGross ?? (l.unitPriceGross || (l.unitPriceNet || 0) * (1 + (l.vatPercentage ?? 23) / 100)) * qtyOf(l, kind)), 0);
        run(`INSERT INTO supplier_docs (supplier, kind, ext_id, doc_date, total_net, total_gross, lines_count, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          KEY, kind, full.id, String(full.creationDate || full.issueDate || '').slice(0, 10) || today(), round2(totalNet), round2(totalGross), lines.length, JSON.stringify(full));
        created++;
      }
      if (list.length < limit) break;
    }
  }
  setState(KEY, { lastSync: new Date().toISOString(), lastError: null });
  if (created) notify('supplier', `Inter Cars: ${created} новых документов — Склад → Inter Cars`);
  if (created && c.autoReceive) await receiveAll('авто');
  return { created, kind };
}

const qtyOf = (l, kind) => (kind === 'invoice' ? Number(l.quantity) || 0 : (Number(l.shippedQuantity) || 0) - (Number(l.returnedQuantity) || 0));

/** Один документ поставщика → приход PZ на склад */
export function receiveDoc(docId, staffName) {
  const d = one('SELECT * FROM supplier_docs WHERE id = ?', docId);
  if (!d) throw new HttpError(404, 'Документ не найден');
  if (d.stock_doc_id) throw new HttpError(409, 'Этот документ уже принят на склад');
  const c = cfg(KEY, { ignoreEnabled: true }) || {};
  const raw = JSON.parse(d.raw);
  const items = (raw.lines || []).map((l) => {
    const qty = qtyOf(l, d.kind);
    const net = Number(l.unitPriceNet) || 0;
    const vat = Number(l.vatPercentage ?? 23);
    const retail = Number(l.retailPrice?.priceGross) || 0;
    const sell = c.useRetail !== false && retail > 0 ? retail : round2(net * (1 + vat / 100) * (1 + (Number(c.markup) || 0) / 100));
    return {
      name: l.name || l.index || l.sku, code: l.index || null, manufacturer: l.brandReference?.name || null, supplier_sku: l.sku || null,
      ean: (l.eans || [])[0] || null, supplier: 'Inter Cars', qty, price_net: net, sell_price: sell, keep_sell: true,
    };
  }).filter((i) => i.qty > 0);
  if (!items.length) throw new HttpError(400, 'В документе нет позиций к приходу (всё возвращено или пусто)');
  const stockId = createStockDoc({
    type: 'PZ', counterparty: 'INTER CARS S.A.', ext_number: d.ext_id, doc_date: d.doc_date,
    note: `${d.kind === 'invoice' ? 'Faktura' : 'Dostawa'} Inter Cars ${d.ext_id}${raw.orderId ? ' · zamówienie ' + raw.orderId : ''}`, items,
  }, staffName);
  run('UPDATE supplier_docs SET stock_doc_id = ? WHERE id = ?', stockId, d.id);
  return { stockDocId: stockId, lines: items.length };
}

export async function receiveAll(staffName) {
  const docs = all(`SELECT id FROM supplier_docs WHERE supplier = ? AND stock_doc_id IS NULL ORDER BY doc_date, id`, KEY);
  let ok = 0; const errors = [];
  for (const d of docs) {
    try { receiveDoc(d.id, staffName); ok++; } catch (e) { errors.push(e.message); }
  }
  return { received: ok, errors };
}

/** Поиск цены и наличия в IC по индексу (номеру детали) */
export async function search(q) {
  const idx = String(q || '').trim();
  if (!idx) return [];
  const c = conf();
  const [prices, stock] = await Promise.all([
    ic('/ic/pricing/quote', { method: 'POST', body: { ...(c.shipTo ? { shipTo: c.shipTo } : {}), lines: [{ index: idx, quantity: 1 }] } }).catch((e) => { ilog(KEY, 'warn', e.message); return null; }),
    ic('/ic/inventory/stock', { query: { index: idx, shipTo: c.shipTo } }).catch(() => []),
  ]);
  const lines = prices?.lines || [];
  return lines.map((l) => {
    const avail = (stock || []).filter((s) => s.sku === l.sku);
    const vat = Number(l.price?.vatPercentage ?? 23);
    const net = Number(l.price?.customerPriceNet) || 0;
    return {
      sku: l.sku, index: l.index, name: l.name, description: l.description, ean: (l.eans || [])[0] || null,
      priceNet: net, priceGross: Number(l.price?.customerPriceGross) || round2(net * (1 + vat / 100)),
      listGross: Number(l.price?.listPriceGross) || null, vat,
      sellSuggested: round2(net * (1 + vat / 100) * (1 + (Number(c.markup) || 0) / 100)),
      availability: avail.reduce((s, a) => s + (Number(a.availability) || 0), 0),
      locations: avail.filter((a) => a.availability > 0).map((a) => `${a.location}: ${a.availability}`),
      deliveryBy: avail.find((a) => a.customerRouteStartDateTime)?.customerRouteStartDateTime || null,
    };
  });
}

/** Заказ деталей в Inter Cars (requisition + подтверждение) */
export async function placeOrder({ lines, customNumber, comments }) {
  if (!lines?.length) throw new HttpError(400, 'Нет позиций для заказа');
  const c = conf();
  const res = await ic('/ic/sales/requisition', {
    method: 'POST',
    body: {
      customNumber: customNumber || undefined, comments: comments || undefined, ...(c.shipTo ? { shipTo: c.shipTo } : {}),
      lines: lines.map((l) => ({ sku: l.sku, requiredQuantity: Number(l.qty) || 1, unitPriceNet: l.priceNet, unitPriceGross: l.priceGross })),
    },
  });
  const r = Array.isArray(res) ? res[0] : res;
  let confirmed = r;
  if (r?.requisitionId && r.phaseCode === 'ACCEPTED') {
    confirmed = ((await ic(`/ic/sales/requisition/${encodeURIComponent(r.requisitionId)}/confirm`, { method: 'POST', query: { shipTo: c.shipTo } }).catch((e) => { ilog(KEY, 'warn', e.message); return null; })) || [r])[0];
  }
  ilog(KEY, 'info', `Заказ IC ${r?.requisitionId || r?.id}: ${lines.length} поз.`);
  return { requisitionId: r?.requisitionId, id: r?.id, phase: confirmed?.phaseCode, totalGross: r?.totalGross };
}

/** Автосинхронизация */
let timer = null;
export function startIntercarsSync() {
  if (timer) return;
  timer = setInterval(() => forEachDb(async () => {
    const c = cfg(KEY);
    if (!c?.autoSync || !c.clientId) return;
    try { await fetchDocs(3); } catch (e) { setState(KEY, { lastError: e.message }); ilog(KEY, 'error', e.message); }
  }), 30 * 60_000);
}
