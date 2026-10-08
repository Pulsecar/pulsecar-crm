// ИИ-запчастист: подбор запчастей по тексту менеджера → позиции «Черновик ИИ» в выцене / заказе.
// Модуль включается флагом ai_parts_enabled в настройках сервиса (у каждого сервиса — своя база, данные не пересекаются).
// Ассистент только подбирает и добавляет позиции в выцену — НИЧЕГО не заказывает и ничего не отправляет клиенту.
import express from 'express';
import { all, one, run, insert, getSetting, log } from '../db.js';
import { HttpError, round2 } from '../util.js';
import { addItem, recalc, getOrder } from '../orders.js';
import { mockPick } from './mock.js';
import { STEPS, startPick, carSig } from './pipeline.js';
import { aiModel, DEFAULT_MODEL, callTool } from './claude.js';
import { icOn } from './ic.js';
import { getRules, saveRules, suggestFromHistory, GROUPS } from './rules.js';
import { trainOnHistory, trainedStat, kitDraftsFromHistory, jobKey, laborPrice, historyPriceList } from './history.js';
import { startDistill, distillState } from './knowledge.js';
import { minMargin } from './pricing.js';
import { cfg } from '../integrations/index.js';

export const aiParts = express.Router();
export const aiEnabled = () => getSetting('ai_parts_enabled') === '1' || process.env.AI_PARTS_MOCK === '1';

const LEVELS = { eco: 'Эконом', mid: 'Средний', oe: 'OE' };
const J = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const ev = (kind, data, x = {}) => insert('ai_events', { kind, data: JSON.stringify(data ?? null), ...x });

/** who — функция проверки прав из crm.js (передаётся при подключении, чтобы не было циклических импортов) */
export function mountAiParts(crm, who) {
  const gate = (req, perm = 'orders.view') => {
    if (!aiEnabled()) throw new HttpError(404, 'Модуль «ИИ-запчастист» выключен');
    return who(req, perm);
  };
  const lineView = (l) => ({ ...l, oe: J(l.oe, []), variants: J(l.variants, {}) });
  const jobView = (j) => ({ ...j, request: J(j.request, {}), steps: J(j.steps, []), result: J(j.result, null) });

  /** Состояние подбора в заказе: история подборов и позиции ИИ */
  crm.get('/ai-parts/orders/:id', (req, res) => {
    gate(req);
    const o = getOrder(Number(req.params.id));
    // позиции, которые менеджер удалил из выцены вручную, — «удалены» (это тоже данные для обучения)
    for (const l of all("SELECT l.id, l.job_id FROM ai_lines l WHERE l.order_id = ? AND l.status <> 'removed' AND l.order_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.id = l.order_item_id)", o.id)) {
      run("UPDATE ai_lines SET status = 'removed', updated_at = datetime('now') WHERE id = ?", l.id);
      ev('deleted_by_manager', null, { line_id: l.id, job_id: l.job_id, order_id: o.id });
    }
    const car = o.car_id ? one('SELECT make, model, vin, engine, capacity, power_kw, fuel, year, last_mileage FROM cars WHERE id = ?', o.car_id) : null;
    res.json({
      mock: process.env.AI_PARTS_MOCK === '1',
      car: car && { ...car, mileage: o.mileage || car.last_mileage },
      defaultLevel: 'mid', // TODO: уровень по умолчанию из карточки клиента
      jobs: all('SELECT * FROM ai_jobs WHERE order_id = ? AND kind = ? ORDER BY id DESC', o.id, 'pick').map(jobView),
      lines: all("SELECT * FROM ai_lines WHERE order_id = ? AND status <> 'removed' ORDER BY id", o.id).map(lineView),
      steps: STEPS.map(([key, label]) => ({ key, label })),
    });
  });

  /** Новый подбор (задача в очереди). Нет VIN — нельзя. */
  crm.post('/ai-parts/orders/:id/jobs', (req, res) => {
    const s = gate(req, 'orders.edit');
    const o = getOrder(Number(req.params.id));
    const car = o.car_id ? one('SELECT * FROM cars WHERE id = ?', o.car_id) : null;
    if (!car?.vin || car.vin.length !== 17) throw new HttpError(400, 'Добавьте VIN в выцену');
    const b = req.body || {};
    const text = String(b.text || '').trim().slice(0, 3000);
    if (!text) throw new HttpError(400, 'Напишите, что нужно подобрать');
    const limit = Number(getSetting('ai_parts_limit') || 0);
    if (limit && one("SELECT COUNT(*) n FROM ai_jobs WHERE kind = 'pick' AND substr(created_at,1,7) = strftime('%Y-%m','now')").n >= limit)
      throw new HttpError(429, `Лимит подборов в этом месяце исчерпан (${limit}). Увеличить: Настройки → ИИ-запчастист.`);
    const request = { text, level: LEVELS[b.level] ? b.level : 'mid', urgency: ['today', 'tomorrow', 'any'].includes(b.urgency) ? b.urgency : 'any',
      comment: String(b.comment || '').slice(0, 1000), paste: String(b.paste || '').slice(0, 20000), ext: !!b.ext, extAllegro: !!b.extAllegro, extV: Math.max(0, Math.round(Number(b.extV) || 0)) };
    const id = insert('ai_jobs', { order_id: o.id, request: JSON.stringify(request), created_by: s.name,
      steps: JSON.stringify(STEPS.map(([key]) => ({ key, state: 'wait' }))) });
    ev('job', request, { job_id: id, order_id: o.id, staff: s.name });
    if (process.env.AI_PARTS_MOCK === '1') mockPick(id);
    else startPick(id);
    res.json({ id });
  });

  /** Что искать в partslink24: польские названия деталей из каталога (для расширения) */
  crm.post('/ai-parts/orders/:id/pl24-terms', async (req, res) => {
    gate(req, 'orders.edit');
    const o = getOrder(Number(req.params.id));
    const car = o.car_id ? one('SELECT make, model, year, engine, capacity, fuel, vin FROM cars WHERE id = ?', o.car_id) : null;
    if (!car?.vin || car.vin.length !== 17) throw new HttpError(400, 'Добавьте VIN в выцену');
    const text = String(req.body?.text || '').trim().slice(0, 2000);
    if (!text) throw new HttpError(400, 'Напишите, что нужно подобрать');
    const { data, usage } = await callTool({
      system: 'You prepare search phrases for the partslink24 parts catalogue (Polish UI). LANGUAGE: catalogues of Toyota, Lexus, Nissan, Infiniti, Mitsubishi, Subaru, Suzuki, Hyundai, Kia, Jaguar and Land Rover list part names in ENGLISH, uppercase, maker style (Toyota: "DISC, REAR", "PAD KIT, DISC BRAKE, REAR", "SHOE KIT, PARKING BRAKE", "SPRING KIT, PARKING BRAKE", "FILTER SUB-ASSY, OIL") — for these makes write "q" in ENGLISH using 2–3 key words with the axle/side ("disc rear", "pad kit disc brake rear", "parking brake shoe") and put one Polish name in "alt"; for all other makes write "q" in Polish and one English name in "alt". For each MAIN part / assembly of the job give ONE short catalogue search phrase as THIS make\'s catalogue names it, plus up to 2 alternative names in "alt" (catalogues differ: BMW ETK calls the intake manifold "instalacja ssąca" or "rura ssąca", VAG "rura ssąca", others "kolektor ssący"/"kolektor dolotowy"; exhaust manifold "kolektor wydechowy"; water pump "pompa płynu chłodzącego"/"pompa wody"). The tool opens the drawing of the main part and reads ALL parts of that assembly (gaskets, seals, bolts), so do NOT add separate phrases for gaskets/bolts of the same assembly — only for parts from OTHER assemblies that must be replaced too. Expand jobs into parts (timing belt job → pasek zębaty / zestaw, rolka napinająca, pompa płynu chłodzącego if belt-driven). Max 8 phrases. No oils/fluids.',
      user: JSON.stringify({ vehicle: { make: car.make, model: car.model, year: car.year, engine: car.engine, capacity: car.capacity, fuel: car.fuel }, request: text }),
      tool: { name: 'pl24_terms', description: 'Search phrases', input_schema: { type: 'object', properties: { terms: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, q: { type: 'string' }, alt: { type: 'array', items: { type: 'string' } } }, required: ['key', 'q'] } } }, required: ['terms'] } },
      maxTokens: 1200, timeout: 60_000,
    });
    insert('ai_events', { kind: 'pl24_terms', order_id: o.id, data: JSON.stringify({ n: (data.terms || []).length, tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0) }) });
    res.json({ vin: car.vin, terms: (data.terms || []).slice(0, 8).map((t) => ({ key: String(t.key || ''), q: String(t.q || ''), alt: (Array.isArray(t.alt) ? t.alt : []).map(String).slice(0, 2) })) });
  });

  /** Ответ страницы: аналоги по OE из Inter Cars e-Catalog (собраны расширением во вкладке менеджера) */
  crm.post('/ai-parts/jobs/:id/ecat', (req, res) => {
    gate(req, 'orders.edit');
    const j = one('SELECT * FROM ai_jobs WHERE id = ?', Number(req.params.id));
    if (!j) throw new HttpError(404, 'Нет такого подбора');
    if (j.status !== 'waiting' || J(j.result, {})?.wait !== 'ecat') return res.json({ ok: false, late: true });
    const s2 = (v, n) => String(v ?? '').slice(0, n);
    const results = (Array.isArray(req.body?.results) ? req.body.results : []).slice(0, 15).map((r) => ({
      oe: s2(r.oe, 40), items: (Array.isArray(r.items) ? r.items : []).slice(0, 40).filter((it) => /^[A-Z0-9]{3,12}$/.test(String(it.code || '')))
        .map((it) => ({ code: s2(it.code, 12), index: s2(it.index, 60), name: s2(it.name, 120), brand: s2(it.brand, 40) })),
    }));
    const cur = J(j.result, {}) || {};
    run('UPDATE ai_jobs SET result = ? WHERE id = ?', JSON.stringify({ ...cur, ecat: results.length ? results : [{ oe: '', items: [] }], ecatError: req.body?.error ? s2(req.body.error, 300) : null }), j.id);
    res.json({ ok: true });
  });

  /** Ответ страницы: строки каталога ProfiAuto для деталей, которых нет в наличии в Inter Cars (собраны расширением, только чтение) */
  crm.post('/ai-parts/jobs/:id/profiauto', (req, res) => {
    gate(req, 'orders.edit');
    const j = one('SELECT * FROM ai_jobs WHERE id = ?', Number(req.params.id));
    if (!j) throw new HttpError(404, 'Нет такого подбора');
    if (j.status !== 'waiting' || J(j.result, {})?.wait !== 'profiauto') return res.json({ ok: false, late: true });
    const s2 = (v, n) => String(v ?? '').slice(0, n);
    const n2 = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 && x < 1e6 ? Math.round(x * 100) / 100 : 0; };
    const okLink = (u) => (/^https:\/\/online\.profiauto\.com\/main-article\/detail/.test(String(u || '')) ? s2(u, 300) : null);
    const results = (Array.isArray(req.body?.results) ? req.body.results : []).slice(0, 20).map((r) => ({
      key: s2(r.key, 60), q: s2(r.q, 80),
      items: (Array.isArray(r.items) ? r.items : []).slice(0, 30).filter((it) => String(it.index || '').trim())
        .map((it) => ({ index: s2(it.index, 40).trim(), brand: s2(it.brand, 40).trim(), name: s2(it.name, 160), net: n2(it.net), gross: n2(it.gross), retailNet: n2(it.retailNet), retailGross: n2(it.retailGross),
          stock: (Array.isArray(it.stock) ? it.stock : []).slice(0, 10).map((w) => ({ name: s2(w.name, 20), qty: Math.max(0, Math.min(9999, Math.round(Number(w.qty) || 0))) })),
          total: Math.max(0, Math.min(99999, Math.round(Number(it.total) || 0))), link: okLink(it.link) })),
    }));
    const cur = J(j.result, {}) || {};
    run('UPDATE ai_jobs SET result = ? WHERE id = ?', JSON.stringify({ ...cur, profiauto: results.length ? results : [{ key: '', items: [] }], profiautoError: req.body?.error ? s2(req.body.error, 300) : null }), j.id);
    res.json({ ok: true });
  });

  /** Ответ страницы: предложения Allegro для деталей, которых нет в наличии в Inter Cars (собраны расширением, только чтение) */
  crm.post('/ai-parts/jobs/:id/allegro', (req, res) => {
    gate(req, 'orders.edit');
    const j = one('SELECT * FROM ai_jobs WHERE id = ?', Number(req.params.id));
    if (!j) throw new HttpError(404, 'Нет такого подбора');
    if (j.status !== 'waiting' || J(j.result, {})?.wait !== 'allegro') return res.json({ ok: false, late: true });
    const s2 = (v, n) => String(v ?? '').slice(0, n);
    const n2 = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 && x < 1e6 ? Math.round(x * 100) / 100 : 0; };
    const results = (Array.isArray(req.body?.results) ? req.body.results : []).slice(0, 12).map((r) => ({
      key: s2(r.key, 60), q: s2(r.q, 120),
      items: (Array.isArray(r.items) ? r.items : []).slice(0, 30).filter((it) => /^\d{8,12}$/.test(String(it.offerId || '')) && n2(it.gross))
        .map((it) => ({ offerId: String(it.offerId), url: 'https://allegro.pl/oferta/' + it.offerId, title: s2(it.title, 160), brand: s2(it.brand, 40), article: s2(it.article, 40),
          gross: n2(it.gross), net: n2(it.net), withDelivery: n2(it.withDelivery), delivery: s2(it.delivery, 40), company: !!it.company })),
    }));
    const cur = J(j.result, {}) || {};
    run('UPDATE ai_jobs SET result = ? WHERE id = ?', JSON.stringify({ ...cur, allegro: results.length ? results : [{ key: '', items: [] }], allegroError: req.body?.error ? s2(req.body.error, 300) : null }), j.id);
    res.json({ ok: true });
  });

  crm.get('/ai-parts/jobs/:id/events', (req, res) => { who(req, 'settings.manage'); res.json(all('SELECT id, kind, created_at, data FROM ai_events WHERE job_id = ? ORDER BY id', Number(req.params.id))); });
  crm.get('/ai-parts/jobs/:id', (req, res) => {
    gate(req);
    const j = one('SELECT * FROM ai_jobs WHERE id = ?', Number(req.params.id));
    if (!j) throw new HttpError(404, 'Нет такого подбора');
    res.json(jobView(j));
  });

  /** Позиция ИИ: сменить вариант (eco/mid/oe), принять, сменить статус, удалить */
  crm.post('/ai-parts/lines/:id', (req, res) => {
    const s = gate(req, 'orders.edit');
    const l = one('SELECT * FROM ai_lines WHERE id = ?', Number(req.params.id));
    if (!l) throw new HttpError(404, 'Нет такой позиции');
    const b = req.body || {};
    if (b.variant) {
      const v = J(l.variants, {})[b.variant];
      if (!v) throw new HttpError(400, 'Нет такого варианта');
      if (l.order_item_id) {
        const it = one('SELECT note FROM order_items WHERE id = ?', l.order_item_id);
        const note = withLink(it?.note, l.link, v.url, v.supplier);
        run('UPDATE order_items SET name = ?, code = ?, price = ?, cost = ?, note = ? WHERE id = ?', itemName(l.title, v), v.article || null, v.sellGross, v.priceNet, note, l.order_item_id);
        recalc(l.order_id);
      }
      if ((l.link || null) !== (v.url || null)) {
        dropOrderLink(l.order_id, l.link);
        if (v.url) addOrderLink(l.order_id, l.title, v);
      }
      run("UPDATE ai_lines SET chosen = ?, link = ?, updated_at = datetime('now') WHERE id = ?", b.variant, v.url || null, l.id);
      ev('variant', { from: l.chosen, to: b.variant }, { line_id: l.id, order_id: l.order_id, staff: s.name });
    }
    if (b.status) {
      const ST = ['draft', 'accepted', 'ordered', 'delivered', 'checked', 'installed', 'returned'];
      if (!ST.includes(b.status)) throw new HttpError(400, 'Неизвестный статус');
      run("UPDATE ai_lines SET status = ?, updated_at = datetime('now') WHERE id = ?", b.status, l.id);
      ev('status', { from: l.status, to: b.status }, { line_id: l.id, order_id: l.order_id, staff: s.name });
      if (b.status === 'accepted' && l.status === 'draft') learn([l.id]);
    }
    res.json({ ok: true });
  });

  /** Принять все черновики заказа */
  crm.post('/ai-parts/orders/:id/accept-all', (req, res) => {
    const s = gate(req, 'orders.edit');
    const ids = all("SELECT id FROM ai_lines WHERE order_id = ? AND status = 'draft'", Number(req.params.id)).map((x) => x.id);
    const n = run("UPDATE ai_lines SET status = 'accepted', updated_at = datetime('now') WHERE order_id = ? AND status = 'draft'", Number(req.params.id)).changes;
    learn(ids);
    ev('accept_all', { n }, { order_id: Number(req.params.id), staff: s.name });
    res.json({ ok: true, n });
  });

  /** Отменить подбор: удалить из выцены черновики этого подбора (принятые не трогаем) */
  crm.post('/ai-parts/jobs/:id/undo', (req, res) => {
    const s = gate(req, 'orders.edit');
    const j = one('SELECT * FROM ai_jobs WHERE id = ?', Number(req.params.id));
    if (!j) throw new HttpError(404, 'Нет такого подбора');
    const lines = all("SELECT * FROM ai_lines WHERE job_id = ? AND status = 'draft'", j.id);
    for (const l of lines) {
      if (l.order_item_id) run('DELETE FROM order_items WHERE id = ? AND order_id = ?', l.order_item_id, j.order_id);
      if (l.link) dropOrderLink(j.order_id, l.link);
      run("UPDATE ai_lines SET status = 'removed', updated_at = datetime('now') WHERE id = ?", l.id);
    }
    dropJobNote(j.order_id, j.id);
    recalc(j.order_id);
    run("UPDATE ai_jobs SET status = CASE WHEN status IN ('queued','running','waiting') THEN 'cancelled' ELSE status END WHERE id = ?", j.id);
    ev('undo', { n: lines.length }, { job_id: j.id, order_id: j.order_id, staff: s.name });
    log('order', j.order_id, 'update', `ИИ-подбор отменён: удалено позиций ${lines.length}`, s.name);
    res.json({ ok: true, n: lines.length });
  });

  /** Проверка каталога Inter Cars по артикулу (админ): что IC возвращает для «бренд + артикул», цены и наличие */
  crm.get('/ai-parts/ic-probe', async (req, res) => {
    who(req, 'settings.manage');
    const { findByArticle, quote } = await import('./ic.js');
    if (req.query.raw && /^\/ic\/catalog\/[\w/.-]*$/.test(String(req.query.path || '/ic/catalog/products'))) { const { icRead } = await import('../integrations/intercars.js'); return res.json(await icRead(String(req.query.path || '/ic/catalog/products'), { query: req.query.sku ? {} : { index: String(req.query.article || ''), pageSize: 5 } }).catch((e) => ({ error: e.message }))); }
    const found = await findByArticle(String(req.query.article || ''), req.query.brand ? String(req.query.brand) : null, new Map());
    const q = await quote(found.map((f) => f.sku));
    res.json(found.map((f) => ({ ...f, ...(q.get(f.sku) || {}) })));
  });

  /** Правила подбора (админ) */
  crm.get('/ai-parts/rules', (req, res) => { who(req, 'settings.manage'); res.json({ ...getRules(), groups: GROUPS }); });
  crm.put('/ai-parts/rules', (req, res) => { who(req, 'settings.manage'); saveRules(req.body || {}); res.json({ ok: true }); });
  crm.get('/ai-parts/rules/suggest', (req, res) => { who(req, 'settings.manage'); res.json({ brands: suggestFromHistory() }); });

  /** Обучение на истории выцен и заказов сервиса (админ) */
  crm.post('/ai-parts/train', (req, res) => {
    who(req, 'settings.manage');
    const st = trainOnHistory();
    // deep — ИИ проходит типовые работы и пишет знания по узлам (прокладки, уплотнения, что разбирается); идёт в фоне
    res.json({ ...st, distill: req.body?.deep ? startDistill() : distillState() });
  });
  /** Прайс из истории выцен и заказов + сравнение с «Прайсом работ» */
  crm.get('/ai-parts/price-list', (req, res) => { who(req, 'settings.manage'); if (!trainedStat()) trainOnHistory(); res.json({ rows: historyPriceList() }); });
  /** Перенести цены из истории в «Прайс работ»: новые работы добавить, у существующих — обновить цену (только выбранные) */
  crm.post('/ai-parts/price-list/apply', (req, res) => {
    const s = who(req, 'catalog.edit');
    const keys = new Set((Array.isArray(req.body?.keys) ? req.body.keys : []).map(String).slice(0, 2000));
    const useRecent = req.body?.recent !== false;
    let added = 0, updated = 0;
    for (const r of historyPriceList(5000)) {
      if (!keys.has(r.job_key)) continue;
      const price = Math.round((useRecent && r.recent ? r.recent : r.price) * 100) / 100;
      if (r.catalog) { run('UPDATE service_catalog SET price = ? WHERE id = ?', price, r.catalog.id); updated++; }
      else { insert('service_catalog', { category: r.category, name: r.job_name, unit: r.unit === 'rbh' ? 'rbh' : 'oper', qty: r.unit === 'rbh' ? (r.qty || 1) : 1, price, vat: 23, active: 1, source: 'history' }); added++; }
    }
    log('settings', 0, 'update', `Прайс работ из истории: добавлено ${added}, обновлено цен ${updated}`, s.name);
    res.json({ ok: true, added, updated });
  });
  crm.get('/ai-parts/kit-drafts', (req, res) => { who(req, 'settings.manage'); if (!trainedStat()) trainOnHistory(); res.json({ kits: kitDraftsFromHistory() }); });

  /** Настройки модуля (только администратор сервиса) */
  crm.get('/ai-parts/settings', (req, res) => {
    who(req, 'settings.manage');
    const month = one("SELECT COUNT(*) n, COALESCE(SUM(tokens_in),0) ti, COALESCE(SUM(tokens_out),0) tout FROM ai_jobs WHERE kind = 'pick' AND substr(created_at,1,7) = strftime('%Y-%m','now')");
    res.json({
      enabled: getSetting('ai_parts_enabled') === '1', limit: Number(getSetting('ai_parts_limit') || 0), model: aiModel(), defaultModel: DEFAULT_MODEL,
      markup: Number(getSetting('ai_parts_markup') || 40), minMargin: minMargin(),
      ready: { claude: !!cfg('assistant', { ignoreEnabled: true })?.apiKey, intercars: icOn() },
      month: { jobs: month.n, tokensIn: month.ti, tokensOut: month.tout }, trained: trainedStat(), distill: distillState(),
      kpi: kpi(),
    });
  });
  crm.put('/ai-parts/settings', (req, res) => {
    who(req, 'settings.manage');
    const b = req.body || {};
    const set = (k, v) => run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v));
    if (b.enabled !== undefined) set('ai_parts_enabled', b.enabled ? '1' : '0');
    if (b.limit !== undefined) set('ai_parts_limit', Math.max(0, Math.round(Number(b.limit) || 0)));
    if (b.markup !== undefined) set('ai_parts_markup', Math.max(0, Number(b.markup) || 0));
    if (b.minMargin !== undefined) set('ai_parts_min_margin', Math.max(0, Math.min(300, Number(b.minMargin) || 0)));
    if (b.model !== undefined) set('ai_parts_model', String(b.model || DEFAULT_MODEL).trim().slice(0, 80));
    res.json({ ok: true });
  });
}

/** Принятые позиции → проверенные пары «авто → OE → артикул» (на них опираются следующие подборы) */
function learn(ids) {
  for (const id of ids) {
    const l = one('SELECT l.*, o.car_id FROM ai_lines l JOIN orders o ON o.id = l.order_id WHERE l.id = ?', id);
    const car = l?.car_id ? one('SELECT * FROM cars WHERE id = ?', l.car_id) : null;
    const v = l && J(l.variants, {})[l.chosen];
    if (!car || !v) continue;
    const oe = J(l.oe, []).map((x) => x.number).join(', ');
    insert('ai_verified', { car_sig: carSig(car), group_key: l.group_key, oe, brand: v.brand, article: v.article, sku: v.sku, name: l.title, weight: 2, source: 'accepted' });
  }
}

/** KPI модуля за 30 дней */
function kpi() {
  const jobs = one(`SELECT COUNT(*) n, SUM(status = 'done') done, SUM(status = 'error') err,
    AVG(CASE WHEN status = 'done' THEN (julianday(finished_at) - julianday(created_at)) * 86400 END) sec FROM ai_jobs WHERE kind = 'pick' AND created_at >= datetime('now','-30 days')`);
  const lines = one(`SELECT COUNT(*) n, SUM(status NOT IN ('draft','removed')) accepted, SUM(status = 'removed') removed, SUM(status = 'returned') returned FROM ai_lines WHERE created_at >= datetime('now','-30 days')`);
  const edited = one(`SELECT COUNT(DISTINCT line_id) n FROM ai_events WHERE kind = 'variant' AND at >= datetime('now','-30 days')`).n;
  return { jobs: jobs.n, done: jobs.done || 0, errors: jobs.err || 0, avgSec: jobs.sec ? Math.round(jobs.sec) : null,
    lines: lines.n, accepted: lines.accepted || 0, removed: lines.removed || 0, returned: lines.returned || 0, edited };
}

/** Ночное дообучение: раз в сутки пересобираем знания из истории (только где модуль включён) */
export function nightlyTrain() {
  if (getSetting('ai_parts_enabled') !== '1') return;
  const st = trainedStat();
  if (st && Date.now() - Date.parse(st.at) < 20 * 3600_000) return;
  try { trainOnHistory(); } catch (e) { console.error('ai train', e.message); }
}

/** После перезапуска сервера незавершённые подборы помечаем ошибкой */
export function resetStaleJobs() {
  run("UPDATE ai_jobs SET status = 'error', error = 'Подбор прерван перезапуском сервера — запустите ещё раз', finished_at = datetime('now') WHERE status IN ('queued','running')");
}

export const itemName = (title, v) => [title, v?.brand].filter(Boolean).join(' ');

/** Добавить позицию ИИ в заказ (без дублей: та же группа деталей уже есть и не удалена — пропускаем) */
export function addAiLine(jobId, orderId, line) {
  if (line.group_key && one(`SELECT 1 FROM ai_lines l WHERE l.order_id = ? AND l.group_key = ? AND l.status <> 'removed'
    AND EXISTS (SELECT 1 FROM order_items i WHERE i.id = l.order_item_id)`, orderId, line.group_key)) return null;
  const v = line.variants[line.chosen];
  if (v?.article && one('SELECT 1 FROM order_items WHERE order_id = ? AND kind = ? AND code = ?', orderId, 'part', v.article)) return null;
  const note = withLink(line.note ? String(line.note).slice(0, 500) : null, null, v?.url, v?.supplier);
  const itemId = addItem(orderId, { kind: 'part', name: itemName(line.title, v), code: v?.article || null, qty: line.qty, unit: line.unit || 'szt.',
    price: round2(v?.sellGross || 0), cost: round2(v?.priceNet || 0), vat: 23, note });
  if (v?.url) addOrderLink(orderId, line.title, v);
  return insert('ai_lines', {
    link: v?.url || null,
    job_id: jobId, order_id: orderId, order_item_id: itemId, group_key: line.group_key, title: line.title, qty: line.qty, qty_note: line.qty_note || null,
    oe: JSON.stringify(line.oe || []), variants: JSON.stringify(line.variants), chosen: line.chosen, confidence: line.confidence || 'high', reason: line.reason || null,
    purpose: line.purpose || null, hours: line.hours || null,
  });
}

const LINK_RE = /^(Allegro|ProfiAuto) \(заказать заранее\): /;
/** Пометка позиции: ссылка на предложение (Allegro / ProfiAuto) отдельной строкой (при смене варианта — заменяется) */
function withLink(note, oldUrl, url, supplier = 'Allegro') {
  let n = String(note || '').split('\n').filter((x) => !(oldUrl && x.includes(oldUrl)) && !LINK_RE.test(x)).join('\n').trim();
  if (url) n = [n, `${supplier} (заказать заранее): ${url}`].filter(Boolean).join('\n');
  return n || null;
}
/** Внутреннее описание выцены (клиент не видит): строка для менеджера со ссылкой на запчасть с Allegro */
function addOrderLink(orderId, title, v) {
  const o = one('SELECT internal_note FROM orders WHERE id = ?', orderId);
  if (!o || String(o.internal_note || '').includes(v.url)) return;
  const row = `ИИ-подбор — заказать ${v.supplier === 'ProfiAuto' ? 'в ProfiAuto' : 'на Allegro'}: ${[title, v.brand, v.article].filter(Boolean).join(' ')}, закупка ${String(v.buyGross ?? v.sellGross).replace('.', ',')} zł brutto${v.delivery ? ', ' + v.delivery : ''} — ${v.url}`;
  run('UPDATE orders SET internal_note = ? WHERE id = ?', [o.internal_note, row].filter((x) => x && String(x).trim()).join('\n'), orderId);
}
/** Строка подбора во внутреннем описании (с номером подбора — уберётся при отмене) */
export function addJobNote(orderId, jobId, text) {
  const o = one('SELECT internal_note FROM orders WHERE id = ?', orderId);
  if (!o) return;
  run('UPDATE orders SET internal_note = ? WHERE id = ?', [o.internal_note, `ИИ-подбор #${jobId} — ${text}`].filter((x) => x && String(x).trim()).join('\n'), orderId);
}
function dropJobNote(orderId, jobId) {
  const o = one('SELECT internal_note FROM orders WHERE id = ?', orderId);
  if (!o?.internal_note?.includes(`ИИ-подбор #${jobId} — `)) return;
  run('UPDATE orders SET internal_note = ? WHERE id = ?', o.internal_note.split('\n').filter((x) => !x.startsWith(`ИИ-подбор #${jobId} — `)).join('\n').trim() || null, orderId);
}
function dropOrderLink(orderId, url) {
  if (!url) return;
  const o = one('SELECT internal_note FROM orders WHERE id = ?', orderId);
  if (!o?.internal_note?.includes(url)) return;
  run('UPDATE orders SET internal_note = ? WHERE id = ?', o.internal_note.split('\n').filter((x) => !x.includes(url)).join('\n').trim() || null, orderId);
}

/** Строка работы от ИИ: часы из истории сервиса или оценка ИИ; без дублей (такая работа уже есть в выцене — пропускаем) */
export function addAiLabor(jobId, orderId, w) {
  const jk = jobKey(w.title);
  if (!jk || !(w.hours > 0)) return null;
  const have = all("SELECT name FROM order_items WHERE order_id = ? AND kind = 'labor'", orderId).map((x) => jobKey(x.name));
  if (have.includes(jk)) return null;
  if (one("SELECT 1 FROM ai_lines l WHERE l.order_id = ? AND l.group_key = ? AND l.status <> 'removed' AND EXISTS (SELECT 1 FROM order_items i WHERE i.id = l.order_item_id)", orderId, 'job:' + jk)) return null;
  const hours = Math.round(w.hours * 10) / 10;
  const vat = Number(getSetting('default_vat', '23')) || 23;
  const rate = Number(getSetting('rbh_rate', '200')) || 0;
  const rbh = String(getSetting('labor_unit_default', 'oper') || 'oper').toLowerCase() === 'rbh';
  const hTxt = String(hours).replace('.', ',');
  // цена: ваш «Прайс работ» → цена этой работы в ваших прошлых выценах → часы × ставка
  const lp = laborPrice(w.title);
  const priced = lp && !(lp.unit === 'rbh' && rbh);
  const itemId = addItem(orderId, {
    kind: 'labor', name: w.title, vat,
    ...(priced ? { unit: lp.unit || 'oper', qty: lp.unit === 'rbh' ? (lp.qty || hours) : 1, price: round2(lp.price) }
      : rbh ? { unit: 'rbh', qty: hours } : { unit: 'oper', qty: 1, price: round2(hours * rate * (1 + vat / 100)) }),
    norm_src: `ИИ: ~${hTxt} h (${w.src === 'history' ? 'история сервиса' : 'оценка ИИ'})${priced ? ' · цена: ' + lp.src : ''}`,
    note: [w.purpose, `~${hTxt} h${priced ? ` · цена по: ${lp.src}` : rbh ? '' : ` × ${rate} zł/h нетто`} · ${w.src === 'history' ? 'по вашим прошлым выценам' : 'оценка ИИ — проверьте'}`].filter(Boolean).join(' · ').slice(0, 500),
  });
  return insert('ai_lines', { job_id: jobId, order_id: orderId, order_item_id: itemId, kind: 'labor', group_key: 'job:' + jk, title: w.title, qty: rbh ? hours : 1,
    oe: '[]', variants: '{}', chosen: null, confidence: w.src === 'history' ? 'high' : 'check', reason: w.src === 'history' ? null : 'Норма часов — оценка ИИ, проверьте', purpose: w.purpose || null, hours });
}
