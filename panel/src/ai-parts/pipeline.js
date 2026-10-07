// Конвейер подбора: VIN → похожие прошлые выцены → Claude (позиции, количество, OE-номера, аналоги) → Inter Cars (наличие товара,
// закупка, рекомендуемая цена продажи, наличие) → варианты Эконом / Средний / OE по цене продажи → черновики в выцене.
import { all, one, run, withDb, curDb, insert, getSetting } from '../db.js';
import { round2 } from '../util.js';
import { recalc } from '../orders.js';
import { decodeVin } from '../integrations/services.js';
import { callTool } from './claude.js';
import { findByArticle, quote, normBrand, norm, whenText, icOn } from './ic.js';
import { addAiLine, addAiLabor, addJobNote } from './index.js';
import { icSell, allegroSell, allegroMarkup, minMargin } from './pricing.js';
import { preferredBrands, blacklist } from './rules.js';
import { similarJobs, jobKnowledge, trainOnHistory, trainedStat } from './history.js';

export const STEPS = [
  ['vin', 'Расшифровка VIN'],
  ['history', 'Похожие прошлые выцены'],
  ['parse', 'Разбор запроса и OE-номера (ИИ)'],
  ['prices', 'Аналоги, цены и наличие (Inter Cars)'],
  ['add', 'ProfiAuto / Allegro (чего нет в наличии) и добавление деталей и работ'],
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
  const planUser = JSON.stringify({
      vehicle, request: req.text, manager_comment: req.comment || null, workshop_rules_text: getSetting('ai_parts_notes') || null, wanted_level: req.level,
      partslink24_rows: req.paste ? req.paste.slice(0, 12000) : null,
      workshop_history_same_model: past.map((p) => ({ date: p.created_at?.slice(0, 10), engine: [p.engine, p.capacity, p.fuel].filter(Boolean).join(' '), parts: p.parts })).slice(0, 25),
      workshop_verified_numbers: verified,
      workshop_similar_jobs_any_car: similar,
      workshop_parts_usually_with_these_jobs: know.parts,
      workshop_labor_hours_median: know.hours,
      workshop_kits: kits, workshop_brand_rules: brandRules,
    });
  // Claude иногда отдаёт вложенный список строкой JSON или под другим ключом — приводим к виду; пусто → ещё одна попытка
  let data = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await callTool({ system: SYSTEM + (attempt ? '\n\nIMPORTANT: return "parts" as a JSON ARRAY of objects (not a string). The previous answer had no parts.' : ''), user: planUser, tool: TOOL });
    run('UPDATE ai_jobs SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ? WHERE id = ?', r.usage.input_tokens || 0, r.usage.output_tokens || 0, jobId);
    data = normPlan(r.data);
    if (data.parts.length || data.labor.length) break;
    insert('ai_events', { kind: 'parse_empty', job_id: jobId, order_id: o.id, data: JSON.stringify({ attempt, stop: r.stop || null, raw: JSON.stringify(r.data).slice(0, 6000) }) });
  }
  const parts = data.parts.slice(0, 25);
  if (!parts.length && !(data.labor || []).length) throw new Error(data.note || 'Не удалось разобрать запрос — уточните, какие детали нужны');
  step('parse', 'ok', `${parts.map((p) => p.name_pl).join(', ') || 'без деталей'} — ${parts.length} поз.${(data.labor || []).length ? `, работ ${data.labor.length}` : ''}${data.note ? ' · ' + data.note : ''}`);
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
  // OE — номер производителя (есть цифры, не название масла); масла и жидкости ищем по артикулам, не по OE
  const oeOk = (x) => x.length >= 5 && (x.match(/\d/g) || []).length >= 4 && !/\d+W\d+/.test(x);
  const oeList = [...new Set(parts.filter((p) => p.unit !== 'l').flatMap((p) => (p.oe || []).map((x) => norm(x.number)).filter(oeOk)))].slice(0, 15);
  // масла и жидкости — поиск в e-Catalog по названию (расширение 1.6.2+)
  const nameQ = (p) => String(p.name_pl || '').replace(/olej silnikowy|olej|płyn|syntetyczny|silnikowy/gi, ' ').replace(/\s+/g, ' ').trim();
  if ((req.extV || 0) >= 10602) for (const p of parts) if (p.unit === 'l' && nameQ(p).length >= 5 && oeList.length < 15) { p._q = nameQ(p); oeList.push({ q: p._q }); }
  if (req.ext && oeList.length && !cancelled()) {
    step('prices', 'run', `ищу аналоги по ${oeList.length} OE-номерам в Inter Cars e-Catalog (окно подбора не закрывайте)…`);
    withDb(d, () => run("UPDATE ai_jobs SET status = 'waiting', result = ? WHERE id = ? AND status = 'running'", JSON.stringify({ wait: 'ecat', need: oeList }), jobId));
    let ecat = null;
    for (let i = 0; i < 100 && !ecat; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const row = withDb(d, () => one('SELECT status, result FROM ai_jobs WHERE id = ?', jobId));
      if (row.status === 'cancelled') return;
      ecat = JSON.parse(row.result || '{}').ecat || null;
    }
    withDb(d, () => run("UPDATE ai_jobs SET status = 'running' WHERE id = ? AND status = 'waiting'", jobId));
    if (cancelled()) return;
    if (ecat?.length) {
      // какие товары из списка e-Catalog — именно та деталь, что нужна (комплект с помпой / без, фильтр, а не корпус…)
      const byOe = new Map(ecat.map((r) => [norm(r.oe), r.items || []]));
      for (const p of parts) if (p._q) p.oe = [...(p.oe || []), { number: p._q, from: 'search', hidden: true }];
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
          const oeNums = new Set(parts.flatMap((p) => (p.oe || []).filter((x) => !x.hidden).map((x) => norm(x.number))));
      for (const p of parts) if (p._q) p.oe = (p.oe || []).filter((x) => !x.hidden);
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
      for (const mp of normPlan(more).parts) {
        const m = missing.find((x) => x.p.key === mp.key) || missing.find((x) => x.p.name_pl === mp.name_pl);
        if (!m) continue;
        for (const a of (mp.analogs || []).slice(0, 10)) if (a.article && !blackBrands.has(normBrand(a.brand))) t2.push({ pi: m.pi, kind: 'analog', brand: a.brand, article: a.article });
      }
      await pool(t2, 4, lookup);
    } catch { /* второй круг не обязателен */ }
  }
  withDb(d, () => run('UPDATE ai_jobs SET result = ? WHERE id = ?', JSON.stringify({ tried: tried.slice(0, 200), ecat: found.filter((f) => f.src === 'ecat').length }), jobId));
  const q = await quote(found.map((f) => f.prod.sku));
  const inStock = [...q.values()].filter((x) => x.priceNet > 0 && x.availability > 0).length;
  step('prices', 'ok', `проверено артикулов: ${checked}, найдено в Inter Cars: ${hits}, в наличии с ценой: ${inStock}`);
  if (cancelled()) return;

  // 5. Варианты только из того, что есть в наличии в Inter Cars: Эконом / Средний / OE по цене продажи клиенту
  step('add', 'run');
  const variantOf = (f) => {
    const pr = q.get(f.prod.sku);
    if (!pr || !(pr.priceNet > 0) || !(pr.availability > 0)) return null;
    const { sellGross, src } = icSell(pr.priceNet, pr.sellGross, pr.vat || 23);
    return perLitre({ brand: f.prod.brand || f.brand, article: f.prod.articleNumber || f.article, sku: f.prod.sku, index: f.prod.index, priceNet: round2(pr.priceNet), buyGross: round2(pr.priceNet * 1.23),
      sellGross, sellNet: round2(sellGross / 1.23), sellSrc: src, availability: pr.availability, delivery: whenText(pr.deliveryAt), supplier: 'Inter Cars' }, parts[f.pi]?.unit, f.prod.index, f.prod.name, pr.name);
  };
  const tiers = (oeVars, analogs, key) => {
    const variants = {};
    // правила сервиса: если для уровня заданы бренды и среди найденных они есть — берём из них
    const prefer = (level) => { const pb = preferredBrands(level, key); return pb.length ? analogs.filter((v) => pb.includes(normBrand(v.brand))) : []; };
    const ecoPref = prefer('eco'), midPref = prefer('mid');
    if (analogs.length) variants.eco = (ecoPref.length ? ecoPref : analogs)[0];
    if (midPref.length) variants.mid = midPref[Math.floor((midPref.length - 1) / 2)];
    else if (analogs.length >= 3) variants.mid = analogs[Math.floor(analogs.length / 2)];
    else if (analogs.length === 2) variants.mid = analogs[1];
    if (variants.mid && variants.eco && variants.mid.sku === variants.eco.sku && analogs.length > 1) variants.mid = analogs.find((v) => v.sku !== variants.eco.sku && v.sellGross >= variants.eco.sellGross) || variants.mid;
    if (oeVars.length) variants.oe = oeVars[0];
    return variants;
  };
  const pickLevel = (variants) => (req.level === 'eco' ? ['eco', 'mid', 'oe'] : req.level === 'oe' ? ['oe', 'mid', 'eco'] : ['mid', 'eco', 'oe']).find((k) => variants[k]) || null;
  const per = parts.map((p, pi) => {
    const mine = found.filter((f) => f.pi === pi);
    const vars = (arr) => arr.map(variantOf).filter(Boolean);
    const oeVars = vars(mine.filter((f) => f.kind === 'oe')).sort((a, b) => a.sellGross - b.sellGross);
    const seen = new Set();
    const analogs = vars(mine.filter((f) => f.kind === 'analog')).filter((v) => normBrand(v.brand) !== oeBrand && !seen.has(v.sku) && seen.add(v.sku)).sort((a, b) => a.sellGross - b.sellGross);
    const variants = tiers(oeVars, analogs, p.key);
    return { variants, chosen: pickLevel(variants), oeVars, src: 'ic' };
  });

  // ожидание ответа расширения (страница CRM передаёт результаты из вкладки менеджера); null — отменено
  const waitExt = async (kind, need, rounds) => {
    const cur0 = withDb(d, () => JSON.parse(one('SELECT result FROM ai_jobs WHERE id = ?', jobId).result || '{}'));
    withDb(d, () => run("UPDATE ai_jobs SET status = 'waiting', result = ? WHERE id = ? AND status = 'running'", JSON.stringify({ ...cur0, wait: kind, [kind + 'Need']: need }), jobId));
    let res = null, err = null;
    for (let i = 0; i < rounds && !res; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const row = withDb(d, () => one('SELECT status, result FROM ai_jobs WHERE id = ?', jobId));
      if (row.status === 'cancelled') return null;
      const rr = JSON.parse(row.result || '{}');
      res = rr[kind] || null; err = rr[kind + 'Error'] || null;
    }
    withDb(d, () => run("UPDATE ai_jobs SET status = 'running' WHERE id = ? AND status = 'waiting'", jobId));
    if (cancelled()) return null;
    return { res: res || [], err };
  };

  // 5а. Нет в наличии в Inter Cars → ProfiAuto (каталог поставщика во вкладке менеджера, расширение 1.7+): только чтение
  let paNote = '', fromPa = 0;
  const noStockIc = per.map((x, pi) => ({ x, pi })).filter(({ x }) => !x.chosen);
  if (noStockIc.length && (req.extV || 0) >= 10700 && !cancelled()) {
    const queries = [];
    for (const { pi } of noStockIc) {
      const p = parts[pi];
      const oes = p.unit === 'l' ? [] : (p.oe || []).map((x) => norm(x.number)).filter(oeOk).slice(0, 2);
      const arts = (p.analogs || []).map((a) => String(a.article || '').trim()).filter((x) => x.length >= 3).slice(0, oes.length ? 1 : 3);
      const qs = [...oes, ...arts];
      if (!qs.length && p.unit === 'l') qs.push(nameQ(p));
      for (const q of qs) if (queries.length < 20) queries.push({ key: p.key, q });
    }
    if (queries.length) {
      step('add', 'run', `нет в наличии в Inter Cars: ${noStockIc.map(({ pi }) => parts[pi].name_pl).join(', ')} — ищу в ProfiAuto (окно подбора не закрывайте)…`);
      const w = await waitExt('profiauto', queries, 160);
      if (!w) return;
      if (w.err) paNote = w.err;
      const byKey = new Map();
      for (const r of w.res) for (const it of r.items || []) {
        if (!(it.total > 0) || !(it.net > 0 || it.gross > 0)) continue; // только в наличии и с ценой
        const arr = byKey.get(r.key) || byKey.set(r.key, []).get(r.key);
        if (!arr.some((x) => x.index === it.index && x.brand === it.brand)) arr.push(it);
      }
      const cand = noStockIc.map(({ pi }) => ({ pi, items: (byKey.get(parts[pi].key) || []).slice(0, 40) })).filter((c) => c.items.length);
      if (cand.length) {
        try {
          const { data: pk, usage: u5 } = await callTool({
            system: 'You match supplier catalogue rows (search by OE / article returns the original and cross-references) to the parts needed for a repair. For each part choose ONLY rows that are exactly that product for this vehicle/engine (right part type, complete kit when a kit is needed, not housings/brackets/other sizes). Return row ids, best first. Add a short Russian check note if fitment is uncertain.',
            user: JSON.stringify({ vehicle, request: req.text, parts: cand.map((c) => ({ key: parts[c.pi].key, name_pl: parts[c.pi].name_pl, oe: (parts[c.pi].oe || []).map((x) => x.number),
              rows: c.items.map((it, i) => ({ id: String(i), brand: it.brand, index: it.index, name: it.name })) })) }),
            tool: { name: 'pick_rows', description: 'Matching rows per part', input_schema: { type: 'object', properties: { parts: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, check: { type: 'string' } }, required: ['key', 'ids'] } } }, required: ['parts'] } },
            maxTokens: 3000, timeout: 90_000,
          });
          run('UPDATE ai_jobs SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ? WHERE id = ?', u5.input_tokens || 0, u5.output_tokens || 0, jobId);
          const whText = (stock) => { const w = (stock || []).find((x) => /WWA/i.test(x.name) && x.qty > 0) || (stock || []).find((x) => x.qty > 0); return w ? `склад ${w.name}` : ''; };
          for (const pp of pk.parts || []) {
            const c = cand.find((x) => parts[x.pi].key === pp.key);
            if (!c) continue;
            const rows = (pp.ids || []).map((i) => c.items[Number(i)]).filter((it) => it && !blackBrands.has(normBrand(it.brand)));
            const toV = (it) => {
              const net = it.net || round2(it.gross / 1.23);
              const { sellGross, src } = icSell(net, it.retailGross || 0);
              return perLitre({ brand: it.brand, article: it.index, sku: 'pa:' + it.brand + ':' + it.index, index: it.index, priceNet: round2(net), buyGross: round2(it.gross || net * 1.23),
                sellGross, sellNet: round2(sellGross / 1.23), sellSrc: src, availability: it.total, delivery: whText(it.stock), supplier: 'ProfiAuto', url: it.link || null }, parts[c.pi].unit, it.name, it.index);
            };
            const oeV = rows.filter((it) => normBrand(it.brand) === oeBrand).map(toV).sort((a, b) => a.sellGross - b.sellGross);
            const anV = rows.filter((it) => normBrand(it.brand) !== oeBrand).map(toV).sort((a, b) => a.sellGross - b.sellGross);
            const variants = tiers(oeV, anV, parts[c.pi].key);
            const chosen = pickLevel(variants);
            if (chosen) { per[c.pi] = { variants, chosen, oeVars: oeV, src: 'profiauto' }; fromPa++; }
            if (pp.check && !parts[c.pi].check) parts[c.pi].check = pp.check;
          }
        } catch { /* без ProfiAuto — дальше Allegro */ }
      }
    }
  }

  // 5б. Нет ни в Inter Cars, ни в ProfiAuto → Allegro (Biznes) через расширение во вкладке менеджера: только чтение, заказывает менеджер
  const noStock = per.map((x, pi) => ({ x, pi })).filter(({ x }) => !x.chosen);
  let allegroNote = '';
  if (noStock.length && req.extAllegro && !cancelled()) {
    const queries = noStock.slice(0, 12).map(({ pi }) => {
      const p = parts[pi];
      const oe = p.unit === 'l' ? null : (p.oe || []).map((x) => String(x.number || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).find(oeOk);
      return { key: p.key, q: oe || [p.name_pl, vehicle.make, String(vehicle.model || '').split(/\s+/)[0], vehicle.capacity_ccm && (Math.round(vehicle.capacity_ccm / 100) / 10).toFixed(1)].filter(Boolean).join(' ') };
    });
    step('add', 'run', `нет в наличии ${(req.extV || 0) >= 10700 ? 'в Inter Cars и ProfiAuto' : 'в Inter Cars'}: ${noStock.map(({ pi }) => parts[pi].name_pl).join(', ')} — ищу на Allegro (окно подбора не закрывайте)…`);
    const w = await waitExt('allegro', queries, 160);
    if (!w) return;
    const al = w.res, alErr = w.err;
    if (alErr) allegroNote = alErr;
    const cand = (al || []).map((r) => ({ r, pi: noStock.find(({ pi }) => parts[pi].key === r.key)?.pi })).filter((c) => c.pi != null && c.r.items?.length);
    if (cand.length) {
      try {
        const { data: pk, usage: u4 } = await callTool({
          system: 'You match Allegro offers to the parts needed for a repair. For each part choose ONLY offers that are exactly that product (same part type, NEW, fits this vehicle/engine per title or catalogue number, complete kit when a kit is needed; no used/regenerated parts, no single pieces instead of a kit, no "do wyboru" offers). Mark oe=true only for genuine original manufacturer parts (brand = vehicle make / OE packaging). Return up to 6 offer ids per part, best first. Add a short Russian check note if fitment is uncertain.',
          user: JSON.stringify({ vehicle, request: req.text, parts: cand.map(({ r, pi }) => ({ key: parts[pi].key, name_pl: parts[pi].name_pl, oe: (parts[pi].oe || []).map((x) => x.number),
            offers: r.items.map((it) => ({ id: it.offerId, title: it.title, brand: it.brand, article: it.article, price_gross: it.gross })) })) }),
          tool: { name: 'pick_offers', description: 'Matching offers per part', input_schema: { type: 'object', properties: { parts: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, offers: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, oe: { type: 'boolean' } }, required: ['id'] } }, check: { type: 'string' } }, required: ['key', 'offers'] } } }, required: ['parts'] } },
          maxTokens: 3000, timeout: 90_000,
        });
        run('UPDATE ai_jobs SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ? WHERE id = ?', u4.input_tokens || 0, u4.output_tokens || 0, jobId);
        for (const pp of pk.parts || []) {
          const c = cand.find((x) => parts[x.pi].key === pp.key);
          if (!c) continue;
          const toV = (it) => {
            const buy = round2(it.withDelivery || it.gross); // закупка брутто с доставкой
            const sell = allegroSell(buy);
            return perLitre({ brand: it.brand || '', article: it.article || '', sku: 'allegro:' + it.offerId, url: it.url, title: it.title, priceNet: round2(it.net ? it.net * (buy / it.gross) : buy / 1.23), buyGross: buy,
              sellGross: sell, sellNet: round2(sell / 1.23), sellSrc: 'allegro', markup: allegroMarkup(buy), availability: 1, delivery: it.delivery || '', supplier: 'Allegro' }, parts[c.pi].unit, it.title);
          };
          const chosenOffers = (pp.offers || []).map((x) => ({ it: c.r.items.find((y) => y.offerId === String(x.id)), oe: !!x.oe })).filter((x) => x.it && !blackBrands.has(normBrand(x.it.brand)));
          const oeV = chosenOffers.filter((x) => x.oe).map((x) => toV(x.it)).sort((a, b) => a.sellGross - b.sellGross);
          const anV = chosenOffers.filter((x) => !x.oe).map((x) => toV(x.it)).sort((a, b) => a.sellGross - b.sellGross);
          const variants = tiers(oeV, anV, parts[c.pi].key);
          const chosen = pickLevel(variants);
          if (chosen) per[c.pi] = { variants, chosen, oeVars: oeV, src: 'allegro' };
          if (pp.check && !parts[c.pi].check) parts[c.pi].check = pp.check;
        }
      } catch { /* без Allegro — позиции «подберите вручную» */ }
    }
  } else if (noStock.length && !req.extAllegro) allegroNote = 'Поиск на Allegro работает через расширение Pulsecar 1.6+ — установите его, чтобы ассистент искал то, чего нет в Inter Cars';

  if (cancelled()) return; // подбор отменён, пока ждали поставщиков — ничего не добавляем
  let added = 0, toCheck = 0, fromAllegro = 0;
  const notFound = [];
  const hist = new Set(verified.map((v) => norm(v.oe)));
  const pasted = norm(req.paste || '');
  for (const [pi, p] of parts.entries()) {
    const { variants, chosen, oeVars, src: supplierSrc } = per[pi];
    const oe = (p.oe || []).filter((x) => x.number).map((x) => {
      const n = norm(x.number);
      const src = hist.has(n) ? 'история выцен' : pasted.includes(n) ? 'partslink24' : x.from === 'history' ? 'история выцен' : oeVars.some((v) => norm(v.article) === n) ? 'ИИ + каталог IC' : ecatParts.has(pi) ? 'ИИ + e-Catalog IC' : 'ИИ';
      return { number: x.number, source: src };
    });
    const reasons = [];
    if (p.check) reasons.push(p.check);
    if (!chosen) reasons.push('Нет в наличии в Inter Cars' + (req.extAllegro ? ' и не найдено на Allegro' : '') + ' — подберите вручную');
    else if (!oe.length) reasons.push('Нет OE-номера — проверьте применимость');
    else if (oe.every((x) => x.source === 'ИИ') && !p.oe_sure) reasons.push('OE-номер от ИИ не подтверждён историей / partslink24 — проверьте применимость');
    if (chosen && supplierSrc === 'allegro') reasons.push(`С Allegro — закажите заранее по ссылке (наценка ${variants[chosen].markup}%)`);
    if (chosen && supplierSrc === 'profiauto') reasons.push(`Нет в наличии в Inter Cars — из ProfiAuto (${variants[chosen].delivery || 'в наличии'})`);
    if (chosen && variants[chosen].pack > 1) reasons.push(`Цена за 1 л (в упаковке ${String(variants[chosen].pack).replace('.', ',')} л по ${String(variants[chosen].packPrice).replace('.', ',')} zł) — закажите нужное число упаковок`);
    if (chosen && variants[chosen].packUnknown) reasons.push('Не удалось определить объём упаковки — проверьте, что цена указана за 1 л');
    if (chosen && variants[chosen].sellSrc === 'min') reasons.push(`Рекомендуемая цена Inter Cars ниже минимальной маржи — поднята до закупки брутто + ${minMargin()}%`);
    if (chosen && variants[chosen].sellSrc === 'markup') reasons.push('Inter Cars не дал рекомендуемую цену — цена продажи по наценке');
    if (vinWarn) reasons.push(vinWarn);
    const line = {
      purpose: p.purpose || null, hours: Number(p.labor_hours) || null,
      note: [p.purpose, p.job ? `${p.job}${Number(p.labor_hours) ? ` ~${String(Math.round(Number(p.labor_hours) * 10) / 10).replace('.', ',')} h${p.hours_source === 'history' ? ' (история сервиса)' : ' (оценка ИИ)'}` : ''}` : null].filter(Boolean).join(' · ') || null,
      group_key: String(p.key || p.name_pl).toLowerCase().slice(0, 60), title: p.name_pl, qty: Number(p.qty) || 1, unit: p.unit || 'szt.', qty_note: p.qty_note || null,
      oe, variants: chosen ? variants : {}, chosen, confidence: reasons.length ? 'check' : 'high', reason: reasons.join(' · ') || null,
    };
    if (!chosen) { notFound.push(`${p.name_pl}${oe.length ? ' (OE ' + oe.map((x) => x.number).join(', ') + ')' : ''}${p.check ? ' — ' + p.check : ''}`); continue; }
    const id = withDb(d, () => addAiLine(jobId, o.id, line));
    if (id) { added++; if (reasons.length) toCheck++; if (chosen && supplierSrc === 'allegro') fromAllegro++; }
  }

  // 6. Работы с нормой часов (из истории сервиса или оценка ИИ)
  const labor = (data.labor || []).filter((w) => w.job && Number(w.hours) > 0);
  if (!labor.length) for (const p of parts) if (p.job && Number(p.labor_hours) > 0 && !labor.some((w) => w.job === p.job)) labor.push({ job: p.job, hours: Number(p.labor_hours), source: p.hours_source, purpose: null });
  let laborAdded = 0;
  for (const w of labor.slice(0, 10)) {
    const id = withDb(d, () => addAiLabor(jobId, o.id, { title: String(w.job).slice(0, 200), hours: Number(w.hours), src: w.source === 'history' ? 'history' : 'estimate', purpose: w.purpose || null }));
    if (id) { laborAdded++; added++; }
  }
  if (notFound.length) withDb(d, () => addJobNote(o.id, jobId, `нет в наличии в ${['Inter Cars', (req.extV || 0) >= 10700 ? 'ProfiAuto' : null, req.extAllegro ? 'Allegro' : null].filter(Boolean).join(', ')} — подберите вручную: ${notFound.join('; ')}`));
  recalc(o.id);
  const note = [data.note, paNote, allegroNote, notFound.length ? `не найдено в наличии: ${notFound.length}` : null].filter(Boolean).join(' · ') || null;
  run("UPDATE ai_jobs SET status = 'done', added = ?, to_check = ?, finished_at = datetime('now'), result = ? WHERE id = ? AND status <> 'cancelled'", added, toCheck, JSON.stringify({ note, tried: tried.slice(0, 200), profiauto: fromPa, allegro: fromAllegro, labor: laborAdded }), jobId);
  step('add', 'ok', (added ? `добавлено ${added} (работ ${laborAdded}${fromPa ? `, из ProfiAuto ${fromPa}` : ''}${fromAllegro ? `, с Allegro ${fromAllegro}` : ''}), проверить ${toCheck}` : 'новых позиций нет — всё уже в выцене')
    + (notFound.length ? ` · нет в наличии (не добавлено, список во внутреннем описании): ${notFound.map((x) => x.split(' (')[0].split(' — ')[0]).join(', ')}` : '') + (paNote ? ' · ' + paNote : '') + (allegroNote ? ' · ' + allegroNote : ''));
  insert('ai_events', { kind: 'job_done', job_id: jobId, order_id: o.id, data: JSON.stringify({ added, toCheck, parts: parts.length, labor: laborAdded, allegro: fromAllegro }) });
}

/** Объём упаковки в литрах из названия («5W40 5L», «1 l», «4 ltr», «208L») — для масел и жидкостей, которые считаем в литрах */
export function packLitres(...texts) {
  for (const t of texts) {
    const m = String(t || '').match(/(?:^|[^\dA-Za-z.,])(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:l|L|ltr|litr(?:y|ów|a)?|liter)(?![A-Za-z])/);
    if (m) { const v = Number(m[1].replace(',', '.')); if (v > 0 && v <= 250) return v; }
  }
  return null;
}
/** Позиция в литрах, а товар — канистра: цены пересчитываем на 1 л (иначе 7 л × цена канистры) */
function perLitre(v, unit, ...texts) {
  if (!v || unit !== 'l') return v;
  const pack = packLitres(...texts);
  if (!pack) return { ...v, packUnknown: true };
  if (pack === 1) return { ...v, pack: 1 };
  const k = (x) => (x ? round2(x / pack) : x);
  return { ...v, pack, priceNet: k(v.priceNet), buyGross: k(v.buyGross), sellGross: k(v.sellGross), sellNet: k(v.sellNet), packPrice: v.sellGross };
}

/** Ответ parts_plan → { parts: [], labor: [], note } (строки JSON разбираем, массивы под другими ключами тоже берём) */
export function normPlan(d) {
  const arr = (v) => {
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { const m = v.match(/\[[\s\S]*\]/); try { v = m ? JSON.parse(m[0]) : []; } catch { v = []; } } }
    if (v && !Array.isArray(v) && typeof v === 'object') v = Array.isArray(v.parts) ? v.parts : Object.values(v).find(Array.isArray) || [];
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];
  };
  d = d && typeof d === 'object' ? d : {};
  // ответ, обёрнутый ещё раз: { parts_plan: { parts: [...] } } / { input: {...} } / строка JSON
  for (let i = 0; i < 3 && !d.parts && !d.labor; i++) {
    const inner = Object.values(d).map((v) => { if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } } return v; })
      .find((v) => v && typeof v === 'object' && !Array.isArray(v) && (v.parts || v.labor));
    if (!inner) break;
    d = inner;
  }
  let parts = arr(d.parts);
  if (!parts.length) for (const k of ['items', 'part_list', 'parts_list', 'positions']) if (d[k]) { parts = arr(d[k]); if (parts.length) break; }
  parts = parts.filter((p) => p.name_pl || p.name).map((p) => ({ ...p, name_pl: p.name_pl || p.name, key: p.key || String(p.name_pl || p.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40), oe: arr(p.oe), analogs: arr(p.analogs) }));
  return { ...d, parts, labor: arr(d.labor), note: typeof d.note === 'string' ? d.note : null };
}

const SYSTEM = `You are an experienced auto-parts specialist (części samochodowe) in a car repair workshop in Warsaw, Poland.
A service advisor describes the job for a specific vehicle. Produce the list of PARTS to put in the repair quote (wycena) and the list of LABOUR operations (labor).

Rules:
- Expand standard jobs into parts (e.g. "rozrząd/ГРМ" → timing belt kit (+ water pump if the engine's pump is driven by the belt), "ТО/service" → oil, oil filter, air filter, cabin filter, drain plug washer...). Use workshop_kits when given.
- Oils and fluids (unit "l"): leave "oe" EMPTY unless there is a real OE part number of the fluid (e.g. "83 21 2 365 946"); never put a product name or viscosity there. List the oil products themselves in "analogs" with their exact manufacturer article numbers (e.g. MOTUL "109474" / "17603", CASTROL "15F0FB"), several package sizes when you know them.
- Quantities from the engine: engine oil = factory capacity with filter in litres (unit "l"), spark plugs = number of cylinders, glow plugs for diesels instead of spark plugs (always with a check note). Explain each quantity in qty_note (Russian).
- OE numbers: take them from partslink24_rows, workshop_verified_numbers and workshop_history_same_model first (from: "partslink24" / "history"). Add OE numbers from your own knowledge only when you are reasonably sure for this exact engine/model (from: "knowledge"); set oe_sure=true only if you are certain. Never invent numbers.
- Analogs: for every part list 4–10 real aftermarket cross-references of that OE (exact catalogue article numbers as printed by the manufacturer / TecDoc) from DIFFERENT manufacturers and price tiers that are sold in Poland by Inter Cars (e.g. economy: Hepu, Filtron, Maxgear, Febi; middle: SKF, Gates, Contitech, Mann, Bosch, NGK, Mahle, TRW, Lemförder; premium: INA, LuK, Sachs, Brembo, Denso, Bilstein). Only numbers you actually know; they will be verified in the Inter Cars catalogue and non-existing ones dropped. Respect manager_comment and workshop_rules_text (e.g. "oil only Castrol" → only Castrol oils as analogs) and workshop_brand_rules (preferred brands per level eco/mid; never propose blacklisted brands).
- If a part depends on equipment the VIN may not distinguish (engine code variants, brake disc size, gearbox) or you are unsure — fill "check" with a short Russian explanation instead of guessing.
- name_pl: short Polish part name as on a Polish invoice (e.g. "Zestaw paska rozrządu z pompą wody", "Filtr oleju", "Olej silnikowy 5W-30 VW 504.00").
- key: short English snake_case group (timing_kit, water_pump, engine_oil, oil_filter, spark_plug, glow_plug, brake_pads_front, ...).
- Think like an experienced workshop: which ASSEMBLIES must be disassembled to do the requested job, and add the parts that must be renewed because of that disassembly — gaskets, seals, O-rings, one-time (stretch) bolts, clips, fluids that get drained (coolant when the cooling system is opened, oil when the sump comes off). Use workshop_similar_jobs_any_car and workshop_parts_usually_with_these_jobs (share = % of past jobs where this workshop also replaced that part) as the main guide. Do NOT add unrelated optional replacements (engine mounts, extra belts, "just in case" parts) — mention them in note as suggestions.
- For EVERY part fill "purpose": a short explanation in the SAME LANGUAGE as the manager's request — why this part is needed (e.g. "прокладка крышки клапанов — снимается при замене свечей" / "uszczelka pokrywy — demontaż przy wymianie świec"); fill "job" with the labour operation it belongs to (Polish name, as on a repair order) and "labor_hours" — hours for that operation on THIS vehicle: take workshop_labor_hours_median / hours in similar jobs when available (hours_source "history"), otherwise your estimate (hours_source "estimate"). Parts of the same job share the same job and hours.
- labor: every labour operation the request needs, as ONE line per operation the way this workshop writes them on repair orders (Polish, e.g. "Wymiana rozrządu z pompą wody", "Wymiana świec zapłonowych", "Geometria kół"); include operations without parts (diagnostics, alignment, coolant bleeding) only if they are clearly part of the job. hours = time for THIS vehicle for the whole operation (all pieces, e.g. both sides); prefer workshop_labor_hours_median / similar jobs (source "history"), otherwise your estimate (source "estimate"). purpose: short note in the request's language what the operation includes. Do not split one job into many small operations; operations already done as part of another (e.g. removing the valve cover for spark plugs) are included in that operation, not separate.
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
      labor: { type: 'array', items: { type: 'object', properties: { job: { type: 'string', description: 'Polish operation name' }, hours: { type: 'number' }, source: { type: 'string', enum: ['history', 'estimate'] }, purpose: { type: 'string' } }, required: ['job', 'hours'] } },
      note: { type: 'string', description: 'Russian, short note for the manager (optional)' },
    },
    required: ['parts'],
  },
};
