// Конвейер подбора: VIN → похожие прошлые выцены → Claude (позиции, количество, OE-номера, аналоги) → Inter Cars (наличие товара,
// закупка, рекомендуемая цена продажи, наличие) → варианты Эконом / Средний / OE по цене продажи → черновики в выцене.
import { all, one, run, withDb, curDb, insert, getSetting } from '../db.js';
import { round2 } from '../util.js';
import { recalc } from '../orders.js';
import { decodeVin } from '../integrations/services.js';
import { callTool } from './claude.js';
import { findByArticle, quote, normBrand, norm, whenText, icOn } from './ic.js';
import { addAiLine } from './index.js';
import { preferredBrands, blacklist } from './rules.js';
import { similarJobs, jobKnowledge, trainOnHistory, trainedStat } from './history.js';

export const STEPS = [
  ['vin', 'Расшифровка VIN'],
  ['history', 'Похожие прошлые выцены'],
  ['parse', 'Разбор запроса и OE-номера (ИИ)'],
  ['prices', 'Аналоги, цены и наличие (Inter Cars)'],
  ['add', 'Добавление в выцену'],
];

// не больше двух подборов одновременно на сервер
let running = 0;
const waiters = [];
const slot = () => (running < 2 ? (running++, Promise.resolve()) : new Promise((r) => waiters.push(r)).then(() => { running++; }));
const free = () => { running--; waiters.shift()?.(); };

const US = /^[1-5]/;
const jt2 = (terms) => terms.filter((t) => /\s/.test(t) || t.length > 5); // 1,4,5 — США, 2 — Канада, 3 — Мексика
export const carSig = (k) => [normBrand(k.make), norm(String(k.model || '').split(/\s+/)[0]), k.capacity || '', String(k.fuel || '').slice(0, 3).toLowerCase()].join('|');

/** NHTSA vPIC — бесплатная расшифровка VIN авто из США / Канады / Мексики */
async function vpic(vin) {
  const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${vin}?format=json`, { signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  const x = j.Results?.[0] || {};
  if (!x.Make) throw new Error('vPIC не распознал VIN');
  return { source: 'NHTSA vPIC', make: x.Make, model: x.Model, year: x.ModelYear, capacity: x.DisplacementCC ? Math.round(Number(x.DisplacementCC)) : null,
    cylinders: x.EngineCylinders || null, fuel: x.FuelTypePrimary, engine: [x.EngineModel, x.EngineConfiguration].filter(Boolean).join(' '), drive: x.DriveType, body: x.BodyClass, trim: x.Trim };
}

export function startPick(jobId) {
  const d = curDb();
  (async () => {
    await slot();
    try { await withDb(d, () => pick(jobId)); } catch (e) {
      withDb(d, () => run("UPDATE ai_jobs SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?", String(e.message || e).slice(0, 500), jobId));
    } finally { free(); }
  })();
}

async function pick(jobId) {
  const d = curDb();
  const job = one('SELECT * FROM ai_jobs WHERE id = ?', jobId);
  const req = JSON.parse(job.request);
  const o = one('SELECT * FROM orders WHERE id = ?', job.order_id);
  const car = one('SELECT * FROM cars WHERE id = ?', o.car_id);
  let steps = JSON.parse(job.steps);
  const step = (key, state, info) => withDb(d, () => {
    steps = steps.map((s) => (s.key === key ? { ...s, state, info: info ?? s.info } : s));
    run('UPDATE ai_jobs SET steps = ? WHERE id = ?', JSON.stringify(steps), jobId);
  });
  const cancelled = () => withDb(d, () => one('SELECT status FROM ai_jobs WHERE id = ?', jobId)?.status === 'cancelled');
  run("UPDATE ai_jobs SET status = 'running', started_at = datetime('now') WHERE id = ?", jobId);
  if (!icOn()) throw new Error('Inter Cars не подключён: Настройки → Интеграции → Inter Cars');

  // 1. VIN
  step('vin', 'run');
  const vin = String(car.vin || '').toUpperCase();
  let dec = null;
  try { dec = US.test(vin) ? await vpic(vin) : await decodeVin(vin); } catch (e) { dec = { error: e.message }; }
  const vehicle = {
    vin, market: US.test(vin) ? 'USA/Canada/Mexico' : 'Europe', make: car.make || dec?.make, model: car.model || dec?.model, year: car.year || dec?.year,
    engine_code: car.engine || dec?.engine || null, capacity_ccm: car.capacity || dec?.capacity || null, power_kw: car.power_kw || dec?.power_kw || null,
    fuel: car.fuel || dec?.fuel || null, mileage: o.mileage || car.last_mileage || null, decoded: dec && !dec.error ? dec : null,
  };
  const vinWarn = dec?.make && car.make && normBrand(dec.make) !== normBrand(car.make) ? `VIN расшифрован как ${dec.make}, а в карточке ${car.make}` : null;
  step('vin', 'ok', [vehicle.make, vehicle.model, vehicle.engine_code, vehicle.capacity_ccm && vehicle.capacity_ccm + ' см³', vehicle.fuel, vehicle.year].filter(Boolean).join(' · ') + (dec?.source ? ` (${dec.source})` : '') + (vinWarn ? ' — ' + vinWarn : ''));
  if (cancelled()) return;

  // 2. История: что этот сервис ставил на такие же авто (без данных клиентов)
  step('history', 'run');
  if (!trainedStat()) { try { trainOnHistory(); } catch (e) { console.error('ai train', e.message); } }
  const sig = carSig(car);
  const verified = all('SELECT group_key, oe, brand, article, name, weight FROM ai_verified WHERE car_sig = ? ORDER BY weight DESC, id DESC LIMIT 60', sig);
  const model0 = String(car.model || '').split(/\s+/)[0];
  const past = car.make ? all(`SELECT o.id, o.created_at, k.capacity, k.fuel, k.engine,
      (SELECT group_concat(i.name || CASE WHEN i.code IS NOT NULL AND i.code <> '' THEN ' [' || i.code || ']' ELSE '' END, ' ; ') FROM order_items i WHERE i.order_id = o.id AND i.kind = 'part') parts
    FROM orders o JOIN cars k ON k.id = o.car_id
    WHERE o.id <> ? AND k.make = ? AND k.model LIKE ? AND EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.kind = 'part')
    ORDER BY (k.capacity = ?) DESC, o.id DESC LIMIT 25`, o.id, car.make, model0 + '%', car.capacity || -1) : [];
  // похожие работы по всей истории сервиса (любые авто): что разбирали, какие прокладки / уплотнения меняли, сколько часов
  let jobTerms = [];
  try {
    const { data: jt, usage: u0 } = await callTool({
      system: 'Translate the repair request into short POLISH workshop job names as used on Polish repair orders (e.g. "Wymiana rozrządu", "Wymiana uszczelki pokrywy zaworów", "Wymiana klocków hamulcowych przód") plus Polish part keywords. Max 8 job names, max 12 keywords.',
      user: JSON.stringify({ vehicle: { make: vehicle.make, model: vehicle.model, engine: vehicle.engine_code, fuel: vehicle.fuel }, request: req.text }),
      tool: { name: 'job_terms', description: 'Polish job names and keywords', input_schema: { type: 'object', properties: { jobs: { type: 'array', items: { type: 'string' } }, keywords: { type: 'array', items: { type: 'string' } } }, required: ['jobs'] } },
      maxTokens: 600, timeout: 45_000,
    });
    run('UPDATE ai_jobs SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ? WHERE id = ?', u0.input_tokens || 0, u0.output_tokens || 0, jobId);
    jobTerms = [...(jt.jobs || []), ...(jt.keywords || [])].slice(0, 20);
  } catch { jobTerms = [req.text]; }
  const similar = similarJobs(jobTerms, car, 15).filter((x) => x.work.length || x.parts.length);
  const know = jobKnowledge(jt2(jobTerms));
  step('history', 'ok', `похожих выцен на эту модель: ${past.length}, похожих работ в истории: ${similar.length}${know.parts.length ? `, связанных деталей: ${know.parts.length}` : ''}${verified.length ? `, проверенных номеров: ${verified.length}` : ''}`);
  if (cancelled()) return;

  // 3. Claude: позиции, количество, OE, кандидаты-аналоги
  step('parse', 'run');
  const kits = all('SELECT name, aliases, fuel, items FROM ai_kits WHERE draft = 0').map((k) => `${k.name}${k.aliases ? ' (' + k.aliases + ')' : ''}${k.fuel ? ' [' + k.fuel + ']' : ''}: ${k.items}`);
  const brandRules = all("SELECT kind, group_key, level, value FROM ai_rules WHERE draft = 0 AND kind IN ('brand','blacklist_brand')");
  const { data, usage } = await callTool({
    system: SYSTEM,
    user: JSON.stringify({
      vehicle, request: req.text, manager_comment: req.comment || null, workshop_rules_text: getSetting('ai_parts_notes') || null, wanted_level: req.level,
      partslink24_rows: req.paste ? req.paste.slice(0, 12000) : null,
      workshop_history_same_model: past.map((p) => ({ date: p.created_at?.slice(0, 10), engine: [p.engine, p.capacity, p.fuel].filter(Boolean).join(' '), parts: p.parts })).slice(0, 25),
      workshop_verified_numbers: verified,
      workshop_similar_jobs_any_car: similar,
      workshop_parts_usually_with_these_jobs: know.parts,
      workshop_labor_hours_median: know.hours,
      workshop_kits: kits, workshop_brand_rules: brandRules,
    }),
    tool: TOOL,
  });
  run('UPDATE ai_jobs SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ? WHERE id = ?', usage.input_tokens || 0, usage.output_tokens || 0, jobId);
  const parts = (data.parts || []).slice(0, 25);
  if (!parts.length) throw new Error(data.note || 'Не удалось разобрать запрос — уточните, какие детали нужны');
  step('parse', 'ok', `${parts.map((p) => p.name_pl).join(', ')} — ${parts.length} поз.${data.note ? ' · ' + data.note : ''}`);
  if (cancelled()) return;

  // 4. Inter Cars: проверяем кандидатов в каталоге, берём цены и наличие
  step('prices', 'run');
  const cache = new Map();
  const blackBrands = blacklist();
  const oeBrand = normBrand(vehicle.make);
  const found = [];
  let checked = 0, hits = 0;
  const pool = async (items, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } })); };
  // 4а. Аналоги по OE из Inter Cars e-Catalog (через расширение во вкладке менеджера): ждём ответа страницы до 150 с
  const ecatParts = new Set();
  const oeList = [...new Set(parts.flatMap((p) => (p.oe || []).map((x) => norm(x.number)).filter((x) => x.length >= 5)))].slice(0, 15);
  if (req.ext && oeList.length && !cancelled()) {
    step('prices', 'run', `ищу аналоги по ${oeList.length} OE-номерам в Inter Cars e-Catalog (окно подбора не закрывайте)…`);
    withDb(d, () => run("UPDATE ai_jobs SET status = 'waiting', result = ? WHERE id = ?", JSON.stringify({ need: oeList }), jobId));
    let ecat = null;
    for (let i = 0; i < 100 && !ecat; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const row = withDb(d, () => one('SELECT status, result FROM ai_jobs WHERE id = ?', jobId));
      if (row.status === 'cancelled') return;
      ecat = JSON.parse(row.result || '{}').ecat || null;
    }
    withDb(d, () => run("UPDATE ai_jobs SET status = 'running' WHERE id = ?", jobId));
    if (ecat?.length) {
      // какие товары из списка e-Catalog — именно та деталь, что нужна (комплект с помпой / без, фильтр, а не корпус…)
      const byOe = new Map(ecat.map((r) => [norm(r.oe), r.items || []]));
      const cand = parts.map((p, pi) => ({ pi, key: p.key, name_pl: p.name_pl, check: p.check || null,
        items: [...new Map((p.oe || []).flatMap((x) => byOe.get(norm(x.number)) || []).map((it) => [it.code, it])).values()].slice(0, 40) })).filter((c) => c.items.length);
      if (cand.length) {
        try {
          const { data: pk, usage: u3 } = await callTool({
            system: 'You match catalogue search results to the parts needed for a repair. For each part choose ONLY the items that are exactly that product type for this job (e.g. "timing belt kit WITH water pump" vs kit without pump vs single belt; oil filter, not housing/gasket). Prefer complete kits when the part is a kit. Return item codes. If several engine variants are possible, still return them and add a short Russian check note.',
            user: JSON.stringify({ vehicle, request: req.text, parts: cand.map((c) => ({ key: c.key, name_pl: c.name_pl, items: c.items.map((it) => ({ code: it.code, brand: it.brand || 'OE', index: it.index, name: it.name })) })) }),
            tool: { name: 'pick_items', description: 'Matching item codes per part', input_schema: { type: 'object', properties: { parts: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, codes: { type: 'array', items: { type: 'string' } }, check: { type: 'string' } }, required: ['key', 'codes'] } } }, required: ['parts'] } },
            maxTokens: 3000, timeout: 90_000,
          });
          run('UPDATE ai_jobs SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ? WHERE id = ?', u3.input_tokens || 0, u3.output_tokens || 0, jobId);
          const oeNums = new Set(parts.flatMap((p) => (p.oe || []).map((x) => norm(x.number))));
          for (const pp of pk.parts || []) {
            const c = cand.find((x) => x.key === pp.key);
            if (!c) continue;
            for (const code of pp.codes || []) {
              const it = c.items.find((x) => x.code === code);
              if (!it || blackBrands.has(normBrand(it.brand))) continue;
              const isOe = !it.brand || /^OE\b/i.test(it.brand) || oeNums.has(norm(it.index));
              found.push({ pi: c.pi, kind: isOe ? 'oe' : 'analog', brand: it.brand, article: it.index, src: 'ecat',
                prod: { sku: it.code, index: it.index, brand: isOe ? (it.brand && !/^OE\b/i.test(it.brand) ? it.brand : vehicle.make) : it.brand, articleNumber: it.index, name: it.name } });
              hits++;
            }
            if ((pp.codes || []).length) ecatParts.add(c.pi);
            if (pp.check && !parts[c.pi].check) parts[c.pi].check = pp.check;
          }
        } catch { /* без выбора — дальше обычным путём */ }
      }
    }
  }
  const tasks = [];
  parts.forEach((p, pi) => {
    if (ecatParts.has(pi)) return; // аналоги уже есть из e-Catalog
    for (const a of (p.analogs || []).slice(0, 10)) if (a.article && !blackBrands.has(normBrand(a.brand))) tasks.push({ pi, kind: 'analog', brand: a.brand, article: a.article });
    for (const x of (p.oe || []).slice(0, 3)) if (x.number) tasks.push({ pi, kind: 'oe', brand: null, article: x.number });
  });
  const tried = [];
  const lookup = async (t) => {
    const r = await findByArticle(t.article, t.brand, cache);
    checked++;
    tried.push({ pi: t.pi, kind: t.kind, brand: t.brand, article: t.article, found: r.length });
    for (const prod of r) {
      if (t.kind === 'oe' && prod.brand && normBrand(prod.brand) !== oeBrand) continue; // OE — только товар марки авто
      hits++;
      found.push({ ...t, prod });
    }
  };
  await pool(tasks, 4, lookup);
  // второй круг: по деталям без найденных аналогов просим у Claude другие артикулы (с учётом того, что не нашлось)
  const missing = parts.map((p, pi) => ({ p, pi })).filter(({ pi }) => !found.some((f) => f.pi === pi && f.kind === 'analog'));
  if (missing.length && !cancelled()) {
    step('prices', 'run', `не найдено в Inter Cars: ${missing.map((m) => m.p.name_pl).join(', ')} — ищу другие артикулы…`);
    try {
      const { data: more, usage: u2 } = await callTool({
        system: SYSTEM + '\n\nSECOND ROUND: the article numbers below were NOT found in the Inter Cars catalogue. Propose 6–10 OTHER real cross-references for each part (other manufacturers, exact article formatting as printed by the manufacturer incl. spaces, e.g. "W 712/95", "VKMA 01121", "530 0640 10"). Do not repeat failed numbers.',
        user: JSON.stringify({ vehicle, parts: missing.map(({ p }) => ({ key: p.key, name_pl: p.name_pl, oe: p.oe, failed: (p.analogs || []).map((a) => `${a.brand} ${a.article}`) })) }),
        tool: TOOL, maxTokens: 4000,
      });
      run('UPDATE ai_jobs SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ? WHERE id = ?', u2.input_tokens || 0, u2.output_tokens || 0, jobId);
      const t2 = [];
      for (const mp of more.parts || []) {
        const m = missing.find((x) => x.p.key === mp.key) || missing.find((x) => x.p.name_pl === mp.name_pl);
        if (!m) continue;
        for (const a of (mp.analogs || []).slice(0, 10)) if (a.article && !blackBrands.has(normBrand(a.brand))) t2.push({ pi: m.pi, kind: 'analog', brand: a.brand, article: a.article });
      }
      await pool(t2, 4, lookup);
    } catch { /* второй круг не обязателен */ }
  }
  withDb(d, () => run('UPDATE ai_jobs SET result = ? WHERE id = ?', JSON.stringify({ tried: tried.slice(0, 200), ecat: found.filter((f) => f.src === 'ecat').length }), jobId));
  const q = await quote(found.map((f) => f.prod.sku));
  step('prices', 'ok', `проверено артикулов: ${checked}, найдено в Inter Cars: ${hits}, с ценой: ${[...q.values()].filter((x) => x.priceNet > 0).length}`);
  if (cancelled()) return;

  // 5. Варианты и добавление
  step('add', 'run');
  const markup = Number(getSetting('ai_parts_markup') || 40);
  const variantOf = (f) => {
    const pr = q.get(f.prod.sku);
    if (!pr || !(pr.priceNet > 0)) return null;
    const sellSrc = pr.sellGross > 0 ? 'ic' : 'markup';
    const sellGross = pr.sellGross > 0 ? pr.sellGross : round2(pr.priceNet * (1 + markup / 100) * 1.23);
    return { brand: f.prod.brand || f.brand, article: f.prod.articleNumber || f.article, sku: f.prod.sku, index: f.prod.index, priceNet: round2(pr.priceNet), sellGross: round2(sellGross),
      sellNet: round2(sellGross / 1.23), sellSrc, availability: pr.availability, delivery: pr.availability > 0 ? whenText(pr.deliveryAt) : (pr.deliveryAt ? 'под заказ, ' + whenText(pr.deliveryAt) : 'нет в наличии'), supplier: 'Inter Cars' };
  };
  let added = 0, toCheck = 0;
  const hist = new Set(verified.map((v) => norm(v.oe)));
  const pasted = norm(req.paste || '');
  for (const [pi, p] of parts.entries()) {
    const mine = found.filter((f) => f.pi === pi);
    const vars = (arr) => arr.map(variantOf).filter(Boolean);
    // при срочности — только то, что есть в наличии (если есть хоть что-то)
    const stockFirst = (arr) => { if (req.urgency === 'any') return arr; const s2 = arr.filter((x) => x.availability > 0); return s2.length ? s2 : arr; };
    const oeVars = stockFirst(vars(mine.filter((f) => f.kind === 'oe'))).sort((a, b) => a.sellGross - b.sellGross);
    const seen = new Set();
    const analogs = stockFirst(vars(mine.filter((f) => f.kind === 'analog')).filter((v) => normBrand(v.brand) !== oeBrand && !seen.has(v.sku) && seen.add(v.sku)))
      .sort((a, b) => a.sellGross - b.sellGross);
    // уровни по цене продажи клиенту: Эконом — самый дешёвый аналог, Средний — средний по цене производитель, OE — оригинал
    const variants = {};
    // правила сервиса: если для уровня заданы бренды и среди найденных они есть — берём из них
    const prefer = (level) => { const pb = preferredBrands(level, p.key); const m = pb.length ? analogs.filter((v) => pb.includes(normBrand(v.brand))) : []; return m; };
    const ecoPref = prefer('eco'), midPref = prefer('mid');
    if (analogs.length) variants.eco = (ecoPref.length ? ecoPref : analogs)[0];
    if (midPref.length) variants.mid = midPref[Math.floor((midPref.length - 1) / 2)];
    else if (analogs.length >= 3) variants.mid = analogs[Math.floor(analogs.length / 2)];
    else if (analogs.length === 2) variants.mid = analogs[1];
    if (variants.mid && variants.eco && variants.mid.sku === variants.eco.sku && analogs.length > 1) variants.mid = analogs.find((v) => v.sku !== variants.eco.sku && v.sellGross >= variants.eco.sellGross) || variants.mid;
    if (oeVars.length) variants.oe = oeVars[0];
    const order = req.level === 'eco' ? ['eco', 'mid', 'oe'] : req.level === 'oe' ? ['oe', 'mid', 'eco'] : ['mid', 'eco', 'oe'];
    const chosen = order.find((k) => variants[k]) || null;
    const oe = (p.oe || []).filter((x) => x.number).map((x) => {
      const n = norm(x.number);
      const src = hist.has(n) ? 'история выцен' : pasted.includes(n) ? 'partslink24' : x.from === 'history' ? 'история выцен' : oeVars.some((v) => norm(v.article) === n) ? 'ИИ + каталог IC' : ecatParts.has(pi) ? 'ИИ + e-Catalog IC' : 'ИИ';
      return { number: x.number, source: src };
    });
    const reasons = [];
    if (p.check) reasons.push(p.check);
    if (!chosen) reasons.push('Не найдено в Inter Cars — подберите вручную');
    else if (!oe.length) reasons.push('Нет OE-номера — проверьте применимость');
    else if (oe.every((x) => x.source === 'ИИ') && !p.oe_sure) reasons.push('OE-номер от ИИ не подтверждён историей / partslink24 — проверьте применимость');
    if (chosen && variants[chosen].sellSrc === 'markup') reasons.push(`Inter Cars не дал рекомендуемую цену — цена продажи по наценке ${markup}%`);
    if (vinWarn) reasons.push(vinWarn);
    const line = {
      purpose: p.purpose || null, hours: Number(p.labor_hours) || null,
      note: [p.purpose, p.job ? `${p.job}${Number(p.labor_hours) ? ` ~${String(Math.round(Number(p.labor_hours) * 10) / 10).replace('.', ',')} h${p.hours_source === 'history' ? ' (история сервиса)' : ' (оценка ИИ)'}` : ''}` : null].filter(Boolean).join(' · ') || null,
      group_key: String(p.key || p.name_pl).toLowerCase().slice(0, 60), title: p.name_pl, qty: Number(p.qty) || 1, unit: p.unit || 'szt.', qty_note: p.qty_note || null,
      oe, variants, chosen, confidence: reasons.length ? 'check' : 'high', reason: reasons.join(' · ') || null,
    };
    if (!chosen) line.variants = {};
    const id = withDb(d, () => addAiLine(jobId, o.id, line));
    if (id) { added++; if (reasons.length) toCheck++; }
  }
  recalc(o.id);
  run("UPDATE ai_jobs SET status = 'done', added = ?, to_check = ?, finished_at = datetime('now'), result = ? WHERE id = ?", added, toCheck, JSON.stringify({ note: data.note || null, tried: tried.slice(0, 200) }), jobId);
  step('add', 'ok', added ? `добавлено ${added}, проверить ${toCheck}` : 'новых позиций нет — всё уже в выцене');
  insert('ai_events', { kind: 'job_done', job_id: jobId, order_id: o.id, data: JSON.stringify({ added, toCheck, parts: parts.length }) });
}

const SYSTEM = `You are an experienced auto-parts specialist (części samochodowe) in a car repair workshop in Warsaw, Poland.
A service advisor describes the job for a specific vehicle. Produce the list of PARTS (no labour) to put in the repair quote (wycena).

Rules:
- Expand standard jobs into parts (e.g. "rozrząd/ГРМ" → timing belt kit (+ water pump if the engine's pump is driven by the belt), "ТО/service" → oil, oil filter, air filter, cabin filter, drain plug washer...). Use workshop_kits when given.
- Quantities from the engine: engine oil = factory capacity with filter in litres (unit "l"), spark plugs = number of cylinders, glow plugs for diesels instead of spark plugs (always with a check note). Explain each quantity in qty_note (Russian).
- OE numbers: take them from partslink24_rows, workshop_verified_numbers and workshop_history_same_model first (from: "partslink24" / "history"). Add OE numbers from your own knowledge only when you are reasonably sure for this exact engine/model (from: "knowledge"); set oe_sure=true only if you are certain. Never invent numbers.
- Analogs: for every part list 4–10 real aftermarket cross-references of that OE (exact catalogue article numbers as printed by the manufacturer / TecDoc) from DIFFERENT manufacturers and price tiers that are sold in Poland by Inter Cars (e.g. economy: Hepu, Filtron, Maxgear, Febi; middle: SKF, Gates, Contitech, Mann, Bosch, NGK, Mahle, TRW, Lemförder; premium: INA, LuK, Sachs, Brembo, Denso, Bilstein). Only numbers you actually know; they will be verified in the Inter Cars catalogue and non-existing ones dropped. Respect manager_comment and workshop_rules_text (e.g. "oil only Castrol" → only Castrol oils as analogs) and workshop_brand_rules (preferred brands per level eco/mid; never propose blacklisted brands).
- If a part depends on equipment the VIN may not distinguish (engine code variants, brake disc size, gearbox) or you are unsure — fill "check" with a short Russian explanation instead of guessing.
- name_pl: short Polish part name as on a Polish invoice (e.g. "Zestaw paska rozrządu z pompą wody", "Filtr oleju", "Olej silnikowy 5W-30 VW 504.00").
- key: short English snake_case group (timing_kit, water_pump, engine_oil, oil_filter, spark_plug, glow_plug, brake_pads_front, ...).
- Think like an experienced workshop: which ASSEMBLIES must be disassembled to do the requested job, and add the parts that must be renewed because of that disassembly — gaskets, seals, O-rings, one-time (stretch) bolts, clips, fluids that get drained (coolant when the cooling system is opened, oil when the sump comes off). Use workshop_similar_jobs_any_car and workshop_parts_usually_with_these_jobs (share = % of past jobs where this workshop also replaced that part) as the main guide. Do NOT add unrelated optional replacements (engine mounts, extra belts, "just in case" parts) — mention them in note as suggestions.
- For EVERY part fill "purpose": a short explanation in the SAME LANGUAGE as the manager's request — why this part is needed (e.g. "прокладка крышки клапанов — снимается при замене свечей" / "uszczelka pokrywy — demontaż przy wymianie świec"); fill "job" with the labour operation it belongs to (Polish name, as on a repair order) and "labor_hours" — hours for that operation on THIS vehicle: take workshop_labor_hours_median / hours in similar jobs when available (hours_source "history"), otherwise your estimate (hours_source "estimate"). Parts of the same job share the same job and hours.
- Do not duplicate parts. If the request is not about parts at all, return an empty list with a note.`;

const TOOL = {
  name: 'parts_plan',
  description: 'Parts for the quote with OE numbers and aftermarket cross-references to verify at Inter Cars',
  input_schema: {
    type: 'object',
    properties: {
      parts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' }, name_pl: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string', enum: ['szt.', 'l', 'kpl.', 'kg'] },
            qty_note: { type: 'string', description: 'Russian, why this quantity' },
            oe: { type: 'array', items: { type: 'object', properties: { number: { type: 'string' }, from: { type: 'string', enum: ['partslink24', 'history', 'knowledge'] } }, required: ['number', 'from'] } },
            oe_sure: { type: 'boolean' },
            analogs: { type: 'array', items: { type: 'object', properties: { brand: { type: 'string' }, article: { type: 'string' }, tier: { type: 'string', enum: ['economy', 'middle', 'premium'] } }, required: ['brand', 'article'] } },
            check: { type: 'string', description: 'Russian: why the manager must verify; empty if confident' },
            purpose: { type: 'string', description: 'why this part is needed (same language as request)' },
            job: { type: 'string', description: 'labour operation it belongs to (Polish)' },
            labor_hours: { type: 'number' }, hours_source: { type: 'string', enum: ['history', 'estimate'] },
          },
          required: ['key', 'name_pl', 'qty', 'unit', 'oe', 'analogs'],
        },
      },
      note: { type: 'string', description: 'Russian, short note for the manager (optional)' },
    },
    required: ['parts'],
  },
};
