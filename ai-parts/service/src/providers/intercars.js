// Inter Cars: локальный каталог из CSV ProductInformation + WebAPI для цен/наличия/заказа.
//
// ВАЖНО (по документации IC WebAPI): поиска по OE-номеру в API нет. Продукты ищутся по
// sku (TOW_KOD) или index (IC_INDEX). Поэтому:
//   1) раз в сутки импортируем CSV ProductInformation (TOW_KOD, IC_INDEX, TEC_DOC,
//      ARTICLE_NUMBER, MANUFACTURER…) в локальную таблицу ic_products;
//   2) агент находит номера (OE и номера производителей аналогов) в каталогах/на форумах;
//   3) здесь сопоставляем номера → TOW_KOD (sku) по нормализованному номеру;
//   4) цены — POST /ic/pricing/quote, наличие — GET /ic/inventory/stock.
// Документация: https://docs.webapi.intercars.eu/ic-api/
import { getDb, normNumber } from '../db.js';

const tokenCache = new Map(); // workshopId -> { token, exp }

export async function getToken(workshopId, cfg, fetchImpl = fetch) {
  if (cfg.static_token) return cfg.static_token;
  const cached = tokenCache.get(workshopId);
  if (cached && cached.exp > Date.now() + 30_000) return cached.token;
  if (!cfg.token_url || !cfg.client_id || !cfg.client_secret)
    throw new Error('Inter Cars: не заданы token_url / client_id / client_secret (или готовый токен)');
  // Inter Cars выдаёт токен только со scope (у CRM Pulsecar работает scope=allinone)
  const body = new URLSearchParams({ grant_type: 'client_credentials', ...(cfg.scope === '-' ? {} : { scope: cfg.scope || 'allinone' }) });
  const basic = Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString('base64');
  const res = await fetchImpl(cfg.token_url, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Inter Cars token HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const token = j.access_token;
  if (!token) throw new Error('Inter Cars: в ответе нет access_token');
  tokenCache.set(workshopId, { token, exp: Date.now() + (Number(j.expires_in || 300) * 1000) });
  return token;
}

async function icFetch(workshopId, cfg, pathAndQuery, { method = 'GET', body, fetchImpl = fetch } = {}) {
  const token = await getToken(workshopId, cfg, fetchImpl);
  const res = await fetchImpl(cfg.api_base.replace(/\/$/, '') + pathAndQuery, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Accept-Language': 'pl',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Inter Cars HTTP ${res.status} ${pathAndQuery}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

// ---------- Локальный каталог ----------

export function catalogSize(workshopId) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM ic_products WHERE workshop_id = ?').get(workshopId).n;
}

// Поиск по списку номеров (OE или номеров производителей). Возвращает совпадения.
export function findInCatalog(workshopId, numbers, limitPerNumber = 15) {
  const d = getDb();
  const byArt = d.prepare(
    `SELECT * FROM ic_products WHERE workshop_id = ? AND (article_norm = ? OR tec_doc_norm = ?) LIMIT ?`
  );
  const out = [];
  for (const raw of numbers) {
    const n = normNumber(typeof raw === 'string' ? raw : raw.number);
    if (!n || n.length < 4) continue;
    const brand = typeof raw === 'string' ? null : raw.brand;
    let rows = byArt.all(workshopId, n, n, limitPerNumber);
    if (brand) {
      const b = normNumber(brand);
      const filtered = rows.filter((r) => normNumber(r.manufacturer).includes(b) || b.includes(normNumber(r.manufacturer)));
      if (filtered.length) rows = filtered;
    }
    for (const r of rows)
      out.push({
        query: typeof raw === 'string' ? raw : raw.number,
        sku: r.tow_kod,
        index: r.ic_index,
        brand: r.manufacturer,
        articleNumber: r.article_number,
        tecDoc: r.tec_doc,
        name: r.short_description,
        description: r.description,
        blockedReturn: !!r.blocked_return,
      });
  }
  // убрать дубли по sku
  const seen = new Set();
  return out.filter((x) => (seen.has(x.sku) ? false : seen.add(x.sku)));
}

// Поиск по описанию (запасной вариант, когда номера аналога нет): LIKE по описанию + бренду.
export function searchCatalogText(workshopId, words, limit = 30) {
  const parts = words.filter(Boolean).slice(0, 5);
  if (!parts.length) return [];
  const where = parts.map(() => `(short_description LIKE ? OR description LIKE ?)`).join(' AND ');
  const params = parts.flatMap((w) => [`%${w}%`, `%${w}%`]);
  return getDb()
    .prepare(`SELECT * FROM ic_products WHERE workshop_id = ? AND ${where} LIMIT ?`)
    .all(workshopId, ...params, limit)
    .map((r) => ({ sku: r.tow_kod, index: r.ic_index, brand: r.manufacturer, articleNumber: r.article_number, name: r.short_description }));
}

// ---------- WebAPI ----------

export async function getProductBySkuOrIndex(workshopId, cfg, { sku, index }, fetchImpl) {
  const q = sku ? `sku=${encodeURIComponent(sku)}` : `index=${encodeURIComponent(index)}`;
  return icFetch(workshopId, cfg, `/ic/catalog/products?${q}&pageSize=25`, { fetchImpl });
}

export async function quotePrices(workshopId, cfg, skus, fetchImpl) {
  if (!skus.length) return [];
  const body = { lines: skus.slice(0, 100).map((sku) => ({ sku, quantity: 1 })) };
  if (cfg.ship_to) body.shipTo = cfg.ship_to;
  if (cfg.locations) body.location = cfg.locations.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
  const r = await icFetch(workshopId, cfg, '/ic/pricing/quote', { method: 'POST', body, fetchImpl });
  return (r?.lines || []).map((l) => ({
    sku: l.sku,
    name: l.name,
    index: l.index,
    currency: l.price?.currencyCode,
    purchaseNet: l.price?.customerPriceNet ?? null,
    purchaseGross: l.price?.customerPriceGross ?? null,
    listNet: l.price?.listPriceNet ?? null,
    refundableNet: l.price?.refundableAmountNet ?? null,
    blockedReturn: !!l.blockedReturn,
  }));
}

export async function stock(workshopId, cfg, skus, fetchImpl) {
  if (!skus.length) return [];
  const params = new URLSearchParams();
  for (const s of skus.slice(0, 100)) params.append('sku', s);
  if (cfg.ship_to) params.set('shipTo', cfg.ship_to);
  if (cfg.locations) for (const l of cfg.locations.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10)) params.append('location', l);
  const r = await icFetch(workshopId, cfg, `/ic/inventory/stock?${params}`, { fetchImpl });
  const list = Array.isArray(r) ? r : r?.items || r?.stock || [];
  return list.map((s) => ({
    sku: s.sku,
    location: s.location,
    availability: s.availability,
    latestDeliveryDate: s.latestDeliveryDate,
    orderBy: s.orderDateTimeTo,
    deliveryAt: s.shipToBusinessUnitDeliveryDateTime,
  }));
}

// Полный цикл для агента: номера → sku → цены + наличие.
// Запасной поиск без CSV-каталога: IC API ищет по индексу IC, а он у большинства товаров совпадает
// с номером производителя (так ищет встроенный подбор CRM Pulsecar). OE-номер так не найти — только аналоги.
export async function findByIndexApi(workshopId, cfg, raw, fetchImpl) {
  const number = typeof raw === 'string' ? raw : raw.number;
  const brand = typeof raw === 'string' ? null : raw.brand;
  const want = normNumber(number);
  if (!want || want.length < 4) return [];
  const out = [];
  const spaced = String(number).trim().replace(/([A-Za-z])(\d)/g, '$1 $2');
  for (const q of [...new Set([String(number).trim(), want, spaced])]) {
    let r = null;
    try { r = await getProductBySkuOrIndex(workshopId, cfg, { index: q }, fetchImpl); } catch { r = null; }
    for (const p of r?.products || []) {
      const ok = [p.articleNumber, p.index, p.tecDoc].some((x) => normNumber(x) === want) || normNumber(p.index).endsWith(want);
      if (!ok || out.some((x) => x.sku === p.sku)) continue;
      out.push({ query: number, sku: p.sku, index: p.index, brand: p.brand, articleNumber: p.articleNumber, tecDoc: p.tecDoc,
        name: p.shortDescription || '', description: String(p.description || '').slice(0, 300), blockedReturn: false, via: 'api' });
    }
    if (out.length) break;
  }
  if (brand) {
    const b = normNumber(brand);
    const f = out.filter((x) => { const m = normNumber(x.brand); return m && (m.includes(b) || b.includes(m)); });
    if (f.length) return f;
  }
  return out;
}

export async function offersForNumbers(workshopId, cfg, numbers, fetchImpl) {
  const matches = findInCatalog(workshopId, numbers);
  const result = { matches: [], warnings: [] };
  if (!catalogSize(workshopId))
    result.warnings.push('Локальный каталог Inter Cars пуст (CSV не импортирован): аналоги ищутся по номеру через API Inter Cars, OE-номер напрямую не находится.');
  // номера без совпадений в CSV-каталоге — через API (не больше 15 номеров за вызов)
  const found = new Set(matches.map((m) => normNumber(m.query)));
  const missing = numbers.filter((n) => !found.has(normNumber(typeof n === 'string' ? n : n.number))).slice(0, 15);
  for (const n of missing) {
    for (const m of await findByIndexApi(workshopId, cfg, n, fetchImpl)) if (!matches.some((x) => x.sku === m.sku)) matches.push(m);
  }
  if (!matches.length) return result;
  const skus = matches.map((m) => m.sku);
  let prices = [];
  let st = [];
  try {
    prices = await quotePrices(workshopId, cfg, skus, fetchImpl);
  } catch (e) {
    result.warnings.push('Цены не получены: ' + e.message);
  }
  try {
    st = await stock(workshopId, cfg, skus, fetchImpl);
  } catch (e) {
    result.warnings.push('Наличие не получено: ' + e.message);
  }
  for (const m of matches) {
    const p = prices.find((x) => x.sku === m.sku) || {};
    const s = st.filter((x) => x.sku === m.sku);
    result.matches.push({
      ...m,
      purchaseNet: p.purchaseNet ?? null,
      currency: p.currency || 'PLN',
      blockedReturn: p.blockedReturn ?? m.blockedReturn,
      stock: s,
    });
  }
  return result;
}

// Заказ (только по кнопке менеджера!): POST /ic/sales/requisition
export async function createRequisition(workshopId, cfg, lines, { comments, customNumber } = {}, fetchImpl) {
  const body = {
    lines: lines.map((l) => ({ sku: l.sku, requiredQuantity: String(l.quantity || 1) })),
  };
  if (cfg.ship_to) body.shipTo = cfg.ship_to;
  if (comments) body.comments = comments;
  if (customNumber) body.customNumber = customNumber;
  return icFetch(workshopId, cfg, '/ic/sales/requisition', { method: 'POST', body, fetchImpl });
}

export async function testConnection(workshopId, cfg, fetchImpl) {
  await getToken(workshopId, cfg, fetchImpl);
  await icFetch(workshopId, cfg, '/ic/customer', { fetchImpl });
  return 'Подключено';
}

// ---------- Импорт CSV ProductInformation ----------
// Разделитель ';', первая строка — заголовки, значения могут быть в кавычках.
export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function importProductInformation(workshopId, lines) {
  const d = getDb();
  let header = null;
  const ins = d.prepare(
    `INSERT INTO ic_products (workshop_id, tow_kod, ic_index, tec_doc, tec_doc_norm, tec_doc_prod, article_number, article_norm, manufacturer, short_description, description, blocked_return)
     VALUES (@ws, @TOW_KOD, @IC_INDEX, @TEC_DOC, @tec_doc_norm, @TEC_DOC_PROD, @ARTICLE_NUMBER, @article_norm, @MANUFACTURER, @SHORT_DESCRIPTION, @DESCRIPTION, @blocked)
     ON CONFLICT(workshop_id, tow_kod) DO UPDATE SET ic_index=excluded.ic_index, tec_doc=excluded.tec_doc, tec_doc_norm=excluded.tec_doc_norm,
       tec_doc_prod=excluded.tec_doc_prod, article_number=excluded.article_number, article_norm=excluded.article_norm,
       manufacturer=excluded.manufacturer, short_description=excluded.short_description, description=excluded.description, blocked_return=excluded.blocked_return`
  );
  let n = 0;
  const tx = d.transaction((batch) => {
    for (const rec of batch) ins.run(rec);
  });
  let batch = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!header) { header = cols.map((h) => h.trim().replace(/^﻿/, '')); continue; }
    const r = Object.fromEntries(header.map((h, i) => [h, cols[i] ?? '']));
    if (!r.TOW_KOD) continue;
    batch.push({
      ws: workshopId,
      TOW_KOD: r.TOW_KOD,
      IC_INDEX: r.IC_INDEX || null,
      TEC_DOC: r.TEC_DOC || null,
      tec_doc_norm: normNumber(r.TEC_DOC),
      TEC_DOC_PROD: r.TEC_DOC_PROD ? Number(r.TEC_DOC_PROD) : null,
      ARTICLE_NUMBER: r.ARTICLE_NUMBER || null,
      article_norm: normNumber(r.ARTICLE_NUMBER),
      MANUFACTURER: r.MANUFACTURER || null,
      SHORT_DESCRIPTION: r.SHORT_DESCRIPTION || null,
      DESCRIPTION: r.DESCRIPTION || null,
      blocked: /^(true|1|t|tak|y)$/i.test(r.BLOCKED_RETURN || '') ? 1 : 0,
    });
    if (batch.length >= 5000) { tx(batch); n += batch.length; batch = []; }
  }
  if (batch.length) { tx(batch); n += batch.length; }
  return n;
}
