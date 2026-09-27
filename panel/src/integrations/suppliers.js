// Хуртовни запчастей: каталог польских поставщиков, документы от любого из них → склад (PZ) или сразу в заказ / смету.
// Способы получения: API (Inter Cars, Hart), кнопка «В Pulsecar» на сайте хуртовни, вставка из буфера, файл, почтовый ящик.
import { all, one, run, insert, tx, ilog, getSetting } from '../db.js';
import { HttpError, round2, today } from '../util.js';
import { cfg, getState, setState } from './index.js';
import { createStockDoc, findOrCreateProduct } from '../stock.js';
import { addItem, recalc, getOrder } from '../orders.js';
import { notify } from './notify.js';

/** Польские хуртовни (список как в Motowarsztat + популярные сети). api — есть прямое подключение */
export const WHOLESALERS = [
  ['intercars', 'Inter Cars', 'intercars.com.pl', 'intercars'], ['hart', 'Hart', 'hartphp.com.pl', 'hart'], ['autopartner', 'Auto Partner', 'autopartner.com'],
  ['interteam', 'Inter-Team', 'inter-team.com.pl'], ['autoland', 'Auto Land', 'autoland.pl'], ['mekonomen', 'Mekonomen', 'mekonomen.pl'],
  ['motoprofil', 'Moto-Profil (ProfiAuto)', 'motoprofil.pl'], ['gordon', 'Gordon', 'gordon.com.pl'], ['autobim', 'Autobim', ''],
  ['autopartner-gdansk', 'Auto-Partner (Gdańsk)', 'autopartner.pl'], ['carex', 'Carex', 'carex.pl'], ['jarofiltr', 'Jaro-Filtr', 'jarofiltr.pl'],
  ['autozatoka', 'Auto-Zatoka', 'auto-zatoka.pl'], ['autoeuro', 'Auto Euro', 'autoeuro.pl'], ['mmot', 'M-MOT', 'm-mot.pl'], ['darma', 'Darma', 'darma.pl'],
  ['abakmoto', 'Abak Moto', 'abakmoto.pl'], ['motoart-wloszczowa', 'MotoArt Włoszczowa', 'motoart.pl'], ['motoart-kielce', 'MotoArt Kielce', 'motoart.pl'],
  ['interparts', 'Inter Parts', 'interparts.pl'], ['motorol', 'Motorol', 'motorol.pl'], ['amibo', 'Amibo', 'amibo.pl'], ['skopol', 'Skopol', 'skopol.pl'],
  ['motores', 'Motores', 'motores.pl'], ['vanking', 'Van King', 'vanking.pl'], ['rodon', 'Rodon', 'rodon.pl'], ['jadar', 'Jadar Auto', 'jadar-auto.pl'],
  ['lipiec', 'Lipiec Auto Centrum', 'lipiec.pl'], ['tmparts', 'TM Parts', 'tmparts.pl'], ['xtech', 'X-Tech Team', 'xtech.pl'], ['siemieniec', 'Siemieniec', 'siemieniec.pl'],
  ['motogama', 'Motogama', 'motogama.pl'], ['ktd', 'KTD', 'ktd.pl'], ['polamel', 'Polamel', 'polamel.pl'], ['td-kedzierzyn', 'TD Kędzierzyn', 'td-auto.pl'],
  ['td-opole', 'TD Opole', 'td-auto.pl'], ['autocentrum', 'Auto Centrum', ''], ['gowest', 'Go West', 'gowest.pl'], ['autoparts-ab', 'Autoparts AB', ''],
  ['dancar', 'Dan-Car', 'dan-car.pl'], ['arge-krakow', 'Arge Kraków', 'arge.pl'], ['arge-krosno', 'Arge Krosno', 'arge.pl'], ['wojdyla', 'Auto Wojdyła', 'wojdyla.pl'],
  ['wazcar', 'Wazcar', 'wazcar.pl'], ['exact', 'Exact Rotating Electrics', ''], ['automar', 'Auto-Mar', ''], ['partsteam', 'Parts Team', ''], ['europarts', 'Euro Parts', ''],
  ['edpol', 'Edpol', 'edpol.pl'], ['dynex', 'Dynex', 'dynex.pl'], ['arisauto', 'Aris Auto', ''], ['tomala', 'Tomala', 'tomala.pl'], ['temot', 'Temot', 'temot.pl'],
  ['motomax', 'Moto Max', ''], ['jarcar', 'JarCar', ''], ['motocar', 'MotoCar', ''], ['elit', 'Elit (LKQ)', 'elit.pl'], ['other', 'Другой поставщик', ''],
].map(([key, name, site, api]) => ({ key, name, site, api: api || null }));
export const wholesaler = (key) => WHOLESALERS.find((w) => w.key === key) || { key, name: key, api: null };

// ── Разбор строк из файла, буфера или сайта ────────────────────────────────
const lc = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const COLS = {
  code: ['indeks', 'index', 'numer katalogowy', 'nr katalogowy', 'nr kat', 'kod towaru', 'kod', 'symbol', 'artykuł', 'artikel', 'numer części', 'part number', 'sku', 'артикул', 'индекс', 'код'],
  name: ['nazwa towaru', 'nazwa', 'towar', 'opis', 'description', 'name', 'название', 'товар', 'наименование'],
  qty: ['ilość', 'ilosc', 'il.', 'szt', 'qty', 'quantity', 'кол-во', 'количество'],
  price: ['cena netto', 'cena jedn. netto', 'cena jednostkowa netto', 'netto/szt', 'cena zakupu', 'cena', 'netto', 'price', 'цена'],
  gross: ['cena brutto', 'brutto/szt', 'brutto'],
  ean: ['ean', 'kod ean', 'ean13', 'kod kreskowy'],
  brand: ['producent', 'marka', 'brand', 'manufacturer', 'производитель', 'бренд'],
  vat: ['vat', 'stawka vat', '% vat'],
};
export const toNum = (v) => { const s = String(v ?? '').replace(/\s|zł|pln|szt\.?/gi, '').replace(',', '.'); const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };

/** Строки с заголовками (из CSV/XLSX или таблицы на сайте) → позиции документа */
export function rowsToLines(rows) {
  if (!rows?.length) return { lines: [], columns: {} };
  const H = Object.keys(rows[0]);
  const find = (names, not = []) => {
    for (const n of names) { const h = H.find((x) => lc(x) === n); if (h) return h; }
    for (const n of names) { const h = H.find((x) => lc(x).includes(n) && !not.some((z) => lc(x).includes(z))); if (h) return h; }
    return null;
  };
  const col = {
    code: find(COLS.code, ['ean']), name: find(COLS.name), qty: find(COLS.qty), price: find(COLS.price, ['brutto', 'wartość', 'wartosc', 'razem']),
    gross: find(COLS.gross, ['wartość', 'wartosc', 'razem']), ean: find(COLS.ean), brand: find(COLS.brand), vat: find(COLS.vat, ['wartość', 'kwota']),
  };
  if (!col.name && !col.code) throw new HttpError(400, 'Не нашёл колонки с названием или индексом. Колонки: ' + H.join(', '));
  const lines = rows.map((r) => {
    const vat = col.vat ? toNum(r[col.vat]) || 23 : 23;
    let net = col.price ? toNum(r[col.price]) : 0;
    if (!net && col.gross) net = round2(toNum(r[col.gross]) / (1 + vat / 100));
    return {
      code: String(r[col.code] ?? '').trim() || null, name: String(r[col.name] ?? '').trim() || String(r[col.code] ?? '').trim(),
      qty: col.qty ? toNum(r[col.qty]) : 1, price_net: net, vat, ean: col.ean ? String(r[col.ean] ?? '').replace(/\D/g, '') || null : null,
      brand: col.brand ? String(r[col.brand] ?? '').trim() || null : null,
    };
  }).filter((l) => l.name && l.qty > 0);
  return { lines, columns: col };
}

/** Текст, скопированный с сайта хуртовни (Ctrl+C из таблицы) → позиции */
export function parsePasted(text) {
  const raw = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!raw.length) throw new HttpError(400, 'Вставьте строки из таблицы хуртовни');
  const split = (l) => (l.includes('\t') ? l.split('\t') : l.split(/\s{2,}|;/)).map((c) => c.trim());
  const first = split(raw[0]);
  const hasHeader = first.some((c) => Object.values(COLS).flat().some((n) => lc(c).includes(n))) && !first.some((c) => /\d+[.,]\d{2}/.test(c));
  if (hasHeader) {
    const H = first.map((h, i) => h || `col${i}`);
    return rowsToLines(raw.slice(1).map((l) => Object.fromEntries(split(l).map((c, i) => [H[i] || `col${i}`, c]))));
  }
  // без заголовков: индекс — первое «слово» с цифрами, цена — последнее число с копейками, количество — небольшое целое
  const lines = raw.map((l) => {
    const cells = split(l).filter(Boolean);
    const money = cells.filter((c) => /^\d{1,6}([.,]\d{2})\s*(zł|pln)?$/i.test(c));
    const qtyCell = cells.find((c) => /^\d{1,3}(\s*szt\.?)?$/i.test(c));
    const code = cells.find((c) => /[0-9]/.test(c) && /^[A-Z0-9][A-Z0-9 .\-/]{2,24}$/i.test(c) && !money.includes(c) && c !== qtyCell) || null;
    const name = cells.filter((c) => c !== code && !money.includes(c) && c !== qtyCell).sort((a, b) => b.length - a.length)[0] || code;
    return { code, name, qty: qtyCell ? toNum(qtyCell) : 1, price_net: money.length ? toNum(money[0]) : 0, vat: 23, ean: null, brand: null };
  }).filter((x) => x.name);
  return { lines, columns: { guessed: true } };
}

// ── Документы поставщиков ──────────────────────────────────────────────────
/** Сохраняем документ любого поставщика (lines — уже в общем виде) */
export function saveDoc({ supplier, kind = 'manual', ext_id, doc_date, lines, meta = {} }) {
  if (!lines?.length) throw new HttpError(400, 'В документе нет позиций');
  const id = String(ext_id || `${kind}-${Date.now()}`).slice(0, 120);
  const ex = one('SELECT id FROM supplier_docs WHERE supplier = ? AND kind = ? AND ext_id = ?', supplier, kind, id);
  if (ex) return { id: ex.id, duplicate: true };
  const net = round2(lines.reduce((s, l) => s + l.qty * l.price_net, 0));
  const gross = round2(lines.reduce((s, l) => s + l.qty * l.price_net * (1 + (l.vat ?? 23) / 100), 0));
  const r = run(`INSERT INTO supplier_docs (supplier, kind, ext_id, doc_date, total_net, total_gross, lines_count, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    supplier, kind, id, doc_date || today(), net, gross, lines.length, JSON.stringify({ generic: true, lines, ...meta }));
  return { id: Number(r.lastInsertRowid), duplicate: false };
}

/** Позиции документа в общем виде (для Inter Cars — из их формата) */
export function docLines(d) {
  const raw = JSON.parse(d.raw || '{}');
  if (raw.generic) return raw.lines;
  if (d.supplier === 'intercars') {
    return (raw.lines || []).map((l) => ({
      code: l.index || null, name: l.name || l.index || l.sku, qty: d.kind === 'invoice' ? Number(l.quantity) || 0 : (Number(l.shippedQuantity) || 0) - (Number(l.returnedQuantity) || 0),
      price_net: Number(l.unitPriceNet) || 0, vat: Number(l.vatPercentage ?? 23), ean: (l.eans || [])[0] || null, brand: l.brandReference?.name || null, sku: l.sku || null,
      retail_gross: Number(l.retailPrice?.priceGross) || 0,
    })).filter((l) => l.qty > 0);
  }
  return raw.lines || [];
}

const markup = () => Number(getSetting('default_markup', '40')) || 0;
export const sellFrom = (l, mk = markup()) => (l.retail_gross > 0 ? round2(l.retail_gross) : round2(l.price_net * (1 + (l.vat ?? 23) / 100) * (1 + mk / 100)));

/** Документ → приход PZ на склад (одна кнопка) */
export function receiveGeneric(docId, staffName, pick) {
  const d = one('SELECT * FROM supplier_docs WHERE id = ?', docId);
  if (!d) throw new HttpError(404, 'Документ не найден');
  if (d.stock_doc_id) throw new HttpError(409, 'Этот документ уже принят на склад');
  const lines = docLines(d).filter((_, i) => !pick || pick.includes(i));
  if (!lines.length) throw new HttpError(400, 'Нет позиций к приходу');
  const w = wholesaler(d.supplier);
  const stockId = createStockDoc({
    type: 'PZ', counterparty: w.name, ext_number: d.ext_id, doc_date: d.doc_date, note: `${w.name}: ${d.ext_id}`,
    items: lines.map((l) => ({ name: l.name, code: l.code, manufacturer: l.brand, ean: l.ean, supplier_sku: l.sku || null, supplier: w.name, qty: l.qty, price_net: l.price_net, sell_price: sellFrom(l), keep_sell: true })),
  }, staffName);
  run('UPDATE supplier_docs SET stock_doc_id = ? WHERE id = ?', stockId, d.id);
  return { stockDocId: stockId, lines: lines.length };
}

/**
 * Позиции документа → сразу в заказ или смету (запчасти с закупочной ценой и ценой продажи с наценкой).
 * toStock=true: сначала оформить приход (товары на складе), потом добавить в заказ со склада.
 */
export function addDocToOrder(docId, orderId, { pick, toStock = false, staffName } = {}) {
  const d = one('SELECT * FROM supplier_docs WHERE id = ?', docId);
  if (!d) throw new HttpError(404, 'Документ не найден');
  const o = getOrder(orderId);
  const lines = docLines(d).filter((_, i) => !pick || pick.includes(i));
  if (!lines.length) throw new HttpError(400, 'Нет позиций');
  const w = wholesaler(d.supplier);
  tx(() => {
    if (toStock && !d.stock_doc_id && o.kind === 'order') receiveGeneric(d.id, staffName, pick);
    for (const l of lines) {
      const pid = toStock && o.kind === 'order' ? findOrCreateProduct({ name: l.name, code: l.code, ean: l.ean, supplier_sku: l.sku, manufacturer: l.brand, supplier: w.name, sell_price: sellFrom(l), price_net: l.price_net }) : null;
      addItem(o.id, { kind: 'part', name: l.name, code: l.code, product_id: pid || undefined, qty: l.qty, price: sellFrom(l), cost: l.price_net, vat: l.vat ?? 23, unit: 'szt.' });
    }
  });
  recalc(o.id);
  run(`UPDATE supplier_docs SET raw = json_set(raw, '$.usedIn', ?) WHERE id = ?`, o.number, d.id);
  return { added: lines.length, order: o.number };
}

// ── Hart (REST API: https://restapi.hartphp.com.pl, документация Hart v1.2) ─────
const HART = 'hart';
const hartConf = () => {
  const c = cfg(HART);
  if (!c) throw new HttpError(400, 'Hart не подключён: Настройки → Интеграции → Hart.');
  if (!c.username || !c.password) throw new HttpError(400, 'Заполните логин и пароль Hart API');
  return c;
};
async function hartToken(c, force) {
  const st = getState(HART);
  if (!force && st.token && st.tokenExp > Date.now() + 60_000 && st.tokenFor === c.username) return st.token;
  const r = await fetch(c.baseUrl.replace(/\/$/, '') + '/v1/auth', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ username: c.username, password: c.password }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new HttpError(502, `Hart: вход не удался (${r.status}). Проверьте логин и пароль API.`);
  setState(HART, { token: j.access_token, tokenExp: Date.now() + (Number(j.expires_in) || 18000) * 1000, tokenFor: c.username });
  return j.access_token;
}
async function hart(path, { method = 'GET', query, body } = {}, retry = true) {
  const c = hartConf();
  const t = await hartToken(c);
  const q = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '' && v !== null)).toString() : '';
  const r = await fetch(c.baseUrl.replace(/\/$/, '') + path + q, {
    method, headers: { Authorization: 'Bearer ' + t, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(c.branchId ? { BranchId: String(c.branchId) } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && retry) { await hartToken(c, true); return hart(path, { method, query, body }, false); }
  if (r.status === 404) return null;
  if (r.status === 429) throw new HttpError(429, 'Hart: лимит 50 запросов в минуту, попробуйте через минуту');
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new HttpError(502, `Hart ${path}: ${r.status} ${j?.message || j?.errorMessage || ''}`.trim());
  return j;
}
const list = (j) => (Array.isArray(j) ? j : j?.items || j?.data || j?.value || j?.results || j?.content || []);

export async function testHart() {
  const to = today();
  const j = await hart('/v1/documents/invoices', { query: { DateFrom: to, DateTo: to, Page: 1, Size: 1 } });
  setState(HART, { lastError: null });
  return `Вход в Hart API успешен${list(j).length ? ' · есть фактуры за сегодня' : ''}`;
}

export async function fetchHartDocs(daysBack = 7) {
  const c = hartConf();
  const kind = c.source === 'invoice' ? 'invoice' : 'delivery';
  const path = kind === 'invoice' ? '/v1/documents/invoices' : '/v1/documents/delivery-notes';
  const from = new Date(); from.setDate(from.getDate() - daysBack);
  let created = 0;
  for (let page = 1; page < 50; page++) {
    const docs = list(await hart(path, { query: { DateFrom: from.toISOString().slice(0, 10), DateTo: today(), Page: page, Size: 50 } }));
    for (const doc of docs) {
      const h = doc.header || {};
      const lines = (doc.positions || []).map((p) => ({ code: p.productCode || null, name: p.productName || p.productCode, qty: Number(p.quantity) || 0, price_net: Number(p.priceNetto) || 0, vat: Number(p.taxRate ?? 23), sku: p.productCode || null, ean: null, brand: null })).filter((l) => l.qty > 0);
      if (!h.documentNr || !lines.length) continue;
      const r = saveDoc({ supplier: HART, kind, ext_id: h.documentNr, doc_date: String(h.createdDate || h.soldDate || '').slice(0, 10), lines, meta: { header: h } });
      if (!r.duplicate) created++;
    }
    if (docs.length < 50) break;
  }
  setState(HART, { lastSync: new Date().toISOString(), lastError: null });
  if (created) notify('supplier', `Hart: ${created} новых документов — Склад → Хуртовни`);
  if (created && c.autoReceive) for (const d of all(`SELECT id FROM supplier_docs WHERE supplier = 'hart' AND stock_doc_id IS NULL`)) { try { receiveGeneric(d.id, 'авто'); } catch {} }
  return { created, kind };
}

/** Поиск в Hart по коду Hart (API не ищет по названию) */
export async function searchHart(q) {
  const code = String(q || '').trim();
  if (!code) return [];
  const [prod, avail] = await Promise.all([
    hart('/v1/products', { query: { HartCodes: code, Page: 1, Size: 20 } }).catch(() => null),
    hart('/v1/products/availability', { query: { HartCodes: code } }).catch(() => null),
  ]);
  const av = list(avail);
  const mk = Number(cfg(HART)?.markup ?? getSetting('default_markup', '40')) || 0;
  return list(prod).map((p) => {
    const a = av.find((x) => x.hartCode === p.hartCode);
    const per = p.isPriceForManyPieces && p.numberOfPiecesInPrice ? Number(p.numberOfPiecesInPrice) : 1;
    const net = round2((Number(p.sellingPrice) || 0) / per);
    const vat = Number(p.taxRate ?? 23);
    return {
      supplier: HART, sku: p.hartCode, index: p.supplierCode || p.hartCode, name: `${p.name || ''}${p.supplier ? ' · ' + p.supplier : ''}`.trim(), priceNet: net,
      priceGross: round2(net * (1 + vat / 100)), vat, sellSuggested: round2(net * (1 + vat / 100) * (1 + mk / 100)),
      availability: Number(p.quantity) || (a?.availabilityPerBranch || []).reduce((s, b) => s + (Number(b.quantity) || 0), 0),
      locations: (a?.availabilityPerBranch || []).filter((b) => b.quantity > 0).map((b) => `${b.branchCode}: ${b.quantity}`), deliveryBy: p.waitingTime || null,
    };
  });
}

/** Заказ в Hart: корзина → заказ */
export async function orderHart(lines) {
  const basket = await hart('/v1/basket', { method: 'POST', body: { orderPositions: lines.map((l) => ({ hartCode: l.sku, quantity: Number(l.qty) || 1 })) } });
  const ids = (basket?.successfulOrders || []).map((x) => x.orderBufferPositionId).filter(Boolean);
  if (!ids.length) throw new HttpError(502, 'Hart не принял позиции в корзину: ' + (basket?.information || 'нет в наличии'));
  const r = await hart('/v1/orders', { method: 'POST', body: { basketPositionIds: ids } });
  if (r && r.isSuccess === false) throw new HttpError(502, 'Hart: ' + (r.errorMessage || 'заказ не принят'));
  ilog(HART, 'info', `Заказ Hart: ${ids.length} поз.`);
  return { orders: (r?.value || []).map((v) => v.orderId), positions: ids.length };
}

// ── Почтовый ящик для документов (IMAP): вложения CSV/XLSX от любых хуртовен ────
export async function checkMailbox() {
  const c = cfg('mailbox');
  if (!c) return { created: 0 };
  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');
  const { readRows } = await import('../importer.js');
  const client = new ImapFlow({ host: c.host, port: Number(c.port) || 993, secure: Number(c.port || 993) === 993, auth: { user: c.user, pass: c.pass }, logger: false });
  await client.connect();
  let created = 0;
  const rules = String(c.rules || '').split('\n').map((l) => l.split('=').map((x) => x.trim())).filter(([a, b]) => a && b); // адрес/домен = ключ хуртовни
  try {
    const lock = await client.getMailboxLock(c.folder || 'INBOX');
    try {
      for await (const msg of client.fetch({ seen: false }, { source: true, uid: true })) {
        const mail = await simpleParser(msg.source);
        const from = (mail.from?.value?.[0]?.address || '').toLowerCase();
        const sup = rules.find(([m]) => from.endsWith(m.toLowerCase()))?.[1] || WHOLESALERS.find((w) => w.site && from.endsWith(w.site))?.key || 'other';
        for (const a of mail.attachments || []) {
          if (!/\.(csv|xlsx?|txt)$/i.test(a.filename || '')) continue;
          try {
            const { lines } = rowsToLines(readRows(a.content));
            if (!lines.length) continue;
            const r = saveDoc({ supplier: sup, kind: 'email', ext_id: `${mail.messageId || msg.uid}:${a.filename}`, doc_date: (mail.date || new Date()).toISOString().slice(0, 10), lines, meta: { file: a.filename, from, subject: mail.subject } });
            if (!r.duplicate) created++;
          } catch (e) { ilog('mailbox', 'warn', `${a.filename}: ${e.message}`); }
        }
        await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], { uid: true });
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  setState('mailbox', { lastSync: new Date().toISOString(), lastError: null });
  if (created) notify('supplier', `Почта: ${created} новых документов от хуртовен — Склад → Хуртовни`);
  return { created };
}
export async function testMailbox() {
  const c = cfg('mailbox', { ignoreEnabled: true });
  if (!c?.host || !c.user || !c.pass) throw new Error('Заполните сервер, логин и пароль');
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({ host: c.host, port: Number(c.port) || 993, secure: Number(c.port || 993) === 993, auth: { user: c.user, pass: c.pass }, logger: false });
  await client.connect();
  const st = await client.status(c.folder || 'INBOX', { unseen: true, messages: true });
  await client.logout();
  return `Вход успешен · писем ${st.messages}, непрочитанных ${st.unseen}`;
}

let timer = null;
export function startSupplierSync() {
  if (timer) return;
  timer = setInterval(async () => {
    const h = cfg(HART);
    if (h?.autoSync && h.username) { try { await fetchHartDocs(3); } catch (e) { setState(HART, { lastError: e.message }); ilog(HART, 'error', e.message); } }
    if (cfg('mailbox')) { try { await checkMailbox(); } catch (e) { setState('mailbox', { lastError: e.message }); ilog('mailbox', 'error', e.message); } }
  }, 30 * 60_000);
}
