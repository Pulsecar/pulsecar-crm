// Модуль «ИИ-запчастист» (отдельный сервис pulsecar-ai-parts): токены CRM → сервис, сохранение
// подобранных позиций в wycenę / zlecenie, выгрузка истории для обучения, перенос ключей.
// Сервис в базу CRM не пишет: позиции сохраняет CRM (виджет вызывает onAddItems → POST сюда).
import crypto from 'node:crypto';
import { config } from './config.js';
import { all, one, insert, getSetting, setSetting } from './db.js';
import { HttpError, round2 } from './util.js';
import { curBranch, branchName } from './branches.js';
import { addItem, recalc, getOrder } from './orders.js';
import { cfg } from './integrations/index.js';
import { can } from './perms.js';

const C = () => config.aiPartsSvc;
/** Модуль подключён: есть адрес и секрет в .env, и он не выключен в настройках */
export const svcOn = () => !!(C().url && C().secret) && getSetting('ai_svc_on', '1') === '1';
const ws = () => curBranch() || 'main';

/** Токен для сервиса: base64url(JSON) + '.' + base64url(HMAC-SHA256) */
export function svcToken(payload, secret = C().secret) {
  const part = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(part).digest('base64url');
  return `${part}.${sig}`;
}
const exp = (sec = 900) => Math.floor(Date.now() / 1000) + sec;
const systemToken = () => svcToken({ ws: ws(), wsName: branchName(ws()), uid: 'crm', role: 'system', exp: exp(600) });
const adminToken = (uid = 'crm') => svcToken({ ws: ws(), wsName: branchName(ws()), uid: String(uid), role: 'admin', exp: exp(900) });

/** Запрос к сервису с сервера CRM (внутренний адрес в сети Docker) */
async function svc(path, { method = 'GET', body, token } = {}) {
  const base = (C().internalUrl || C().url).replace(/\/$/, '');
  const r = await fetch(base + path, {
    method, headers: { Authorization: 'Bearer ' + (token || systemToken()), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, `ИИ-запчастист: ${j.error || 'HTTP ' + r.status}`);
  return j;
}

const LV = { economy: 'eco', middle: 'mid', oe: 'oe' };
const SUP = { intercars: 'Inter Cars', profiauto: 'ProfiAuto', allegro: 'Allegro' };
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

/** Предложение модуля → вариант в формате CRM (как у встроенного подбора: eco / mid / oe) */
function variantOf(o) {
  if (!o) return null;
  return {
    brand: o.brand || '', article: o.articleNumber || '', sku: o.sku || null,
    priceNet: o.purchaseNet ?? null, sellNet: o.client?.net ?? null, sellGross: o.client?.gross ?? null,
    availability: o.availability || null, supplier: SUP[o.supplier] || o.supplier || 'Inter Cars',
  };
}

/** Данные для виджета: авто из ЭТОГО заказа, уже добавленные позиции (чтобы не дублировать) */
export function widgetData(orderId) {
  const o = getOrder(orderId);
  const car = o.car_id ? one('SELECT vin, make, model, engine, year FROM cars WHERE id = ?', o.car_id) : null;
  const oeBy = new Map(all("SELECT order_item_id, oe FROM ai_lines WHERE order_id = ? AND order_item_id IS NOT NULL AND status <> 'removed'", o.id)
    .map((l) => [l.order_item_id, (J(l.oe, [])[0] || {}).number || null]));
  return {
    wycenaId: String(o.id), number: o.number, kind: o.kind,
    vehicle: { vin: car?.vin || '', make: car?.make || '', model: car?.model || '', engine: car?.engine || '', year: car?.year || '', mileage: o.mileage || '' },
    defaultLevel: getSetting('ai_svc_level', 'middle'),
    existingItems: all("SELECT id, name, code FROM order_items WHERE order_id = ? AND kind = 'part'", o.id)
      .map((i) => ({ name: i.name, oeNumber: oeBy.get(i.id) || null, articleNumber: i.code || null })),
  };
}

/** onAddItems: позиции подбора → запчасти заказа + строки ИИ (статус «черновик ИИ»). Повтор не дублирует. */
export function saveItems(orderId, items, staffName) {
  const o = getOrder(orderId);
  const have = all("SELECT code FROM order_items WHERE order_id = ? AND kind = 'part'", o.id).map((x) => norm(x.code)).filter(Boolean);
  const haveOe = new Set(all(`SELECT l.oe FROM ai_lines l WHERE l.order_id = ? AND l.status <> 'removed'
    AND EXISTS (SELECT 1 FROM order_items i WHERE i.id = l.order_item_id)`, o.id).flatMap((l) => J(l.oe, []).map((x) => norm(x.number))).filter(Boolean));
  const added = [], skipped = [];
  for (const it of Array.isArray(items) ? items.slice(0, 200) : []) {
    const name = String(it.name || '').trim().slice(0, 300);
    if (!name) continue;
    const art = norm(it.articleNumber), oe = norm(it.oeNumber);
    if ((art && have.includes(art)) || (oe && haveOe.has(oe))) { skipped.push(name); continue; }
    const variants = {};
    for (const [k, v] of Object.entries(it.offers || {})) if (LV[k] && v) variants[LV[k]] = variantOf({ ...v, supplier: v.supplier || it.supplier });
    const chosen = LV[it.level] || null;
    const v = chosen ? variants[chosen] : null;
    const check = !!it.needsCheck;
    const both = !!it.orderBothVariants;
    const reason = check ? (it.checkReason || 'Номер не подтверждён двумя источниками — проверьте перед заказом')
      : both ? 'Вариант не определён по VIN — заказать оба, лишний вернуть' + ((it.variants || []).length ? ': ' + it.variants.map((x) => (typeof x === 'string' ? x : x.label || x.name || x.oeNumber || '')).filter(Boolean).join(' / ') : '') : null;
    const qty = Number(it.quantity) > 0 ? Number(it.quantity) : 1;
    const brand = it.brand || v?.brand || '';
    const note = [
      'ИИ-запчастист (сервис)' + (it.oeNumber ? ` · OE ${it.oeNumber}` : '') + (it.supplierSku ? ` · SKU ${it.supplierSku}` : ''),
      reason, it.availability ? 'Наличие: ' + it.availability : null,
    ].filter(Boolean).join('\n').slice(0, 900);
    const itemId = addItem(o.id, {
      kind: 'part', name: [name, brand].filter(Boolean).join(' ').slice(0, 300), code: it.articleNumber || null, qty, unit: it.unit || 'szt.',
      price: round2(Number(it.priceGross ?? v?.sellGross ?? 0) || 0), cost: round2(Number(it.purchaseNet ?? v?.priceNet ?? 0) || 0), vat: 23, note,
    });
    insert('ai_lines', {
      job_id: null, order_id: o.id, order_item_id: itemId, kind: 'part', src: 'svc',
      group_key: 'svc:' + (oe || art || norm(name)).slice(0, 60), title: name, qty,
      oe: JSON.stringify(it.oeNumber ? [{ number: it.oeNumber, source: 'ИИ-запчастист' }] : []),
      variants: JSON.stringify(variants), chosen, confidence: check ? 'check' : 'high', reason,
      ext_job_id: it.aiJobId ? String(it.aiJobId) : null, ext_item_id: it.aiItemId ? String(it.aiItemId) : null,
      evidence: it.evidence ? JSON.stringify(it.evidence).slice(0, 20000) : null, order_both: both ? 1 : 0,
      alt_variants: (it.variants || []).length ? JSON.stringify(it.variants).slice(0, 5000) : null,
    });
    if (art) have.push(art);
    if (oe) haveOe.add(oe);
    added.push(itemId);
  }
  if (added.length) recalc(o.id);
  if (added.length || skipped.length) insert('ai_events', { kind: 'svc_add', order_id: o.id, staff: staffName, data: JSON.stringify({ added: added.length, skipped }) });
  return { added: added.length, skipped };
}

// ── История для обучения (без имён, телефонов и e-mail клиентов — RODO) ─────────────────────
const HIST_SQL = `SELECT i.id, i.order_id, i.name, i.code, i.cost, i.price, i.vat, i.qty, o.kind, o.status_id, o.created_at, o.closed_at,
    k.vin, k.make, k.model, k.engine, k.year,
    (SELECT group_concat(x.name, '; ') FROM order_items x WHERE x.order_id = o.id AND x.kind = 'labor') jobs,
    (SELECT l.oe FROM ai_lines l WHERE l.order_item_id = i.id ORDER BY l.id DESC LIMIT 1) ai_oe,
    (SELECT l.variants FROM ai_lines l WHERE l.order_item_id = i.id ORDER BY l.id DESC LIMIT 1) ai_var,
    (SELECT l.chosen FROM ai_lines l WHERE l.order_item_id = i.id ORDER BY l.id DESC LIMIT 1) ai_chosen,
    (SELECT MAX(l.status = 'returned') FROM ai_lines l WHERE l.order_item_id = i.id) returned,
    p.manufacturer p_brand, p.supplier p_supplier, COALESCE(st.is_final, 0) fin
  FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN cars k ON k.id = o.car_id LEFT JOIN products p ON p.id = i.product_id
  LEFT JOIN order_statuses st ON st.id = o.status_id
  WHERE i.kind = 'part'`;
function histRow(r) {
  const v = J(r.ai_var, {})[r.ai_chosen] || {};
  const k = 1 + (Number(r.vat ?? 23) / 100);
  return {
    source_id: `${ws()}:${r.id}`, wycena_id: String(r.order_id), vin: r.vin || null, make: r.make || null, model: r.model || null,
    engine_code: r.engine || null, year: r.year ? Number(String(r.year).slice(0, 4)) || null : null, job_text: String(r.jobs || '').slice(0, 1000) || null,
    part_name: r.name, brand: v.brand || r.p_brand || null, article_number: r.code || v.article || null,
    oe_number: (J(r.ai_oe, [])[0] || {}).number || null, supplier: v.supplier || r.p_supplier || null,
    price_net: r.cost ? round2(r.cost) : null, sale_net: r.price ? round2(r.price / k) : null,
    verified: r.kind === 'order' && r.fin ? 1 : 0, returned: r.returned ? 1 : 0, created_at: r.closed_at || r.created_at,
  };
}
async function pushRows(rows) {
  let imported = 0;
  for (let i = 0; i < rows.length; i += 1000) imported += Number((await svc('/api/history/import', { method: 'POST', body: { rows: rows.slice(i, i + 1000) } })).imported) || 0;
  return imported;
}
/** Разовая выгрузка всей истории */
export async function exportAllHistory() {
  const rows = all(HIST_SQL + ' ORDER BY i.id').map(histRow);
  const imported = await pushRows(rows);
  setSetting('ai_svc_history_at', new Date().toISOString().slice(0, 19).replace('T', ' '));
  return { rows: rows.length, imported };
}
/** Изменённые строки заказа: при закрытии (verified) и при возврате детали (returned) */
export function pushOrderHistory(orderId) {
  if (!svcOn()) return;
  const rows = all(HIST_SQL + ' AND i.order_id = ?', orderId).map(histRow);
  if (rows.length) pushRows(rows).catch((e) => console.error('ai-svc history', e.message));
}

/** Перенос ключей из CRM в модуль: Claude (из «AI-ассистент») и Inter Cars (IC API) */
export async function syncKeys(uid) {
  const t = adminToken(uid);
  const done = [];
  const a = cfg('assistant', { ignoreEnabled: true });
  if (a?.apiKey) {
    await svc('/api/integrations/anthropic', { method: 'PUT', token: t, body: { enabled: true, fields: { api_key: a.apiKey, model: 'claude-sonnet-5' } } });
    done.push('Claude');
  }
  const ic = cfg('intercars', { ignoreEnabled: true });
  if (ic?.clientId && ic?.clientSecret) {
    await svc('/api/integrations/intercars', { method: 'PUT', token: t, body: { enabled: true, fields: {
      api_base: ic.baseUrl || 'https://api.webapi.intercars.eu', token_url: ic.tokenUrl || 'https://is.webapi.intercars.eu/oauth2/token',
      client_id: ic.clientId, client_secret: ic.clientSecret, scope: 'allinone' } } });
    done.push('Inter Cars');
  }
  return done;
}

/** Роуты CRM. who — проверка прав из crm.js */
export function mountAiSvc(crm, who) {
  const gate = (req, perm) => {
    if (!svcOn()) throw new HttpError(404, 'Модуль «ИИ-запчастист» (сервис) не подключён');
    return who(req, perm);
  };
  const orderPerm = (req, id) => {
    const o = one('SELECT kind FROM orders WHERE id = ?', id);
    if (!o) throw new HttpError(404, 'Заказ не найден');
    return gate(req, o.kind === 'quote' ? 'quotes.manage' : 'orders.edit');
  };
  crm.get('/ai-svc/config', (req, res) => { who(req); res.json({ on: svcOn(), url: svcOn() ? C().url : null }); });
  // токен для виджета: только для заказа, на который у пользователя есть права; 15 минут
  crm.get('/ai-svc/token', (req, res) => {
    const id = Number(req.query.orderId);
    const s = orderPerm(req, id);
    const admin = can(s, 'settings.manage');
    res.json({ token: svcToken({ ws: ws(), wsName: branchName(ws()), uid: String(s.id), role: admin ? 'admin' : 'manager', wid: String(id), exp: exp(900) }), exp: exp(900), ...widgetData(id) });
  });
  crm.get('/ai-svc/admin-token', (req, res) => {
    const s = gate(req, 'settings.manage');
    res.json({ token: adminToken(s.id), url: C().url });
  });
  crm.post('/orders/:id/ai-svc-items', (req, res) => {
    const id = Number(req.params.id);
    const s = orderPerm(req, id);
    res.json(saveItems(id, req.body?.items || [], s.name));
  });
  crm.post('/ai-svc/sync-keys', async (req, res) => {
    const s = gate(req, 'settings.manage');
    res.json({ done: await syncKeys(s.id) });
  });
  crm.post('/ai-svc/history-export', async (req, res) => {
    gate(req, 'settings.manage');
    res.json(await exportAllHistory());
  });
}
