// Обучение на истории сервиса (без данных клиентов — RODO; непринятые черновики ИИ не учитываются): выцены и заказы → индекс работ и деталей,
// «какие детали ставят вместе с работой» (прокладки, уплотнения узлов, которые разбирают) и сколько часов занимает работа.
// Модель не переобучается: перед каждым подбором ассистент получает похожие прошлые работы как примеры.
import { all, one, run, tx, getSetting, setSetting } from '../db.js';

const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();
const STOP = new Set(['i', 'z', 'w', 'na', 'do', 'oraz', 'lub', 'kpl', 'szt', 'komplet', 'nowy', 'nowa', 'nowe', 'the', 'and', 'na', 'pod', 'przy', 'od', 'dla', 'x', 'l', 'p', 'lewy', 'prawy', 'lewa', 'prawa', 'przod', 'tyl', 'przedni', 'tylny', 'przednia', 'tylna']);
const BRANDS = /\b(bosch|mann|filtron|mahle|knecht|hengst|febi|swag|lemforder|trw|ate|brembo|ferodo|textar|zimmermann|delphi|bilstein|sachs|kyb|monroe|skf|ina|luk|fag|gates|contitech|dayco|ngk|denso|beru|valeo|hella|meyle|moog|maxgear|hepu|graf|elring|reinz|victor|ajusa|corteco|castrol|mobil|shell|motul|total|elf|liqui|moly|orlen|comma|vag|oe|oryginal|original|blue\s?print|japanparts|ridex|stark|febest|vaico|topran|optimal|ruville|nrf|nissens|pierburg|airtex|metelli|purflux|ufi|champion)\b/g;
/** «Wymiana uszczelki pokrywy zaworów 1.6» → «wymiana uszczelki pokrywy zaworow» */
export const jobKey = (name) => strip(name).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)).slice(0, 6).join(' ');
/** «Uszczelka pokrywy zaworów ELRING 123.456» → «uszczelka pokrywy zaworow» */
export const partKey = (name) => strip(name).replace(BRANDS, ' ').replace(/\S*\d\S*/g, ' ').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 4).join(' ');

// категория работы для прайса — по ключевым словам названия
const CATS = [ // порядок важен: сначала узкие категории, «Serwis olejowy» — последним из общих
  ['Klimatyzacja', /klima|klimat|r134|r1234|sprężark|sprezark|osuszacz|odgrzybian|ozonow/i],
  ['Diagnostyka', /diagno|kontrol|sprawdz|przegląd zawiesz|przeglad zawiesz|odczyt|test /i],
  ['Opony / koła', /opon|wyważ|wywaz|felg|koło zapas|kolo zapas|przekładka kół|przekladka kol/i],
  ['Rozrząd', /rozrz/i],
  ['Hamulce', /hamul|klock|tarcz|zacisk|bębn|bebn|szczęk|szczek|ręczn|reczn/i],
  ['Geometria / zawieszenie / układ kierowniczy', /geometr|zbieżn|zbiezn|wahacz|amortyz|sprężyn|sprezyn|łącznik|lacznik|drążk|drazk|końcówk|koncowk|sworzeń|sworzen|tulej|stabiliz|przekładni|przekladni|maglownic|łożysk|lozysk|piast/i],
  ['Układ chłodzenia', /chłodn|chlodn|termostat|pomp[ay] wod|płyn chł|plyn chl/i],
  ['Układ wydechowy / DPF / EGR', /wydech|tłumik|tlumik|dpf|fap|egr|katalizator|lambda|sonda/i],
  ['Sprzęgło / skrzynia', /sprzęg|sprzeg|skrzyn|dwumas|półoś|polos|przegub/i],
  ['Silnik', /silnik|uszczel|głowic|glowic|kolektor|turbo|wtrysk|świec|swiec|pokryw|miska|łańcuch|lancuch|pasek|napinacz|rolk/i],
  ['Elektryka', /akumul|alternator|rozrusznik|elektr|kodowan|programow|czujnik|żarów|zarow|oświetl|oswietl|żarów|lamp|reflektor/i],
  ['Nadwozie / szyby', /szyb|lusterk|zamek|drzwi|wycieracz|błotnik|blotnik|zderzak/i],
  ['Serwis olejowy / filtry', /olej|filtr|przegląd|przeglad|serwis/i],
];
const catOf = (name) => (CATS.find(([, re]) => re.test(name)) || ['Inne'])[0];
const stems = (key) => new Set(String(key || '').split(' ').filter((w) => w.length >= 5 && w !== 'wymiana').map((w) => w.slice(0, 5)));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

/** Пересобрать индекс и знания из всех выцен и заказов сервиса */
export function trainOnHistory() {
  const orders = all(`SELECT o.id, o.kind, o.created_at, o.complaint, k.vin, k.make, k.model, k.engine, k.capacity, k.fuel, k.year
    FROM orders o LEFT JOIN cars k ON k.id = o.car_id
    WHERE EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id) ORDER BY o.id`);
  // часы работы: «rbh» — это и есть часы; «oper» (за операцию) — из стоимости строки по ставке нормо-часа сервиса
  const rate = Number(getSetting('rbh_rate', '250')) || 250;
  const laborHours = (l) => {
    const q = Number(l.qty) || 0;
    let h = 0;
    if (String(l.unit || '').toLowerCase() === 'rbh') h = q;
    else if (Number(l.price) > 0 && q > 0) h = (Number(l.price) * q * (1 - (Number(l.discount) || 0) / 100)) / (rate * (1 + (l.vat ?? 23) / 100));
    h = Math.round(h * 10) / 10;
    return h >= 0.1 && h < 40 ? h : 0;
  };
  const items = all(`SELECT order_id, kind, name, code, qty, unit, price, discount, vat FROM order_items WHERE name IS NOT NULL AND name <> ''
    AND id NOT IN (SELECT order_item_id FROM ai_lines WHERE status = 'draft' AND order_item_id IS NOT NULL) ORDER BY order_id, pos, id`);
  const byOrder = new Map();
  for (const it of items) (byOrder.get(it.order_id) || byOrder.set(it.order_id, []).get(it.order_id)).push(it);
  const co = new Map(), jobsCnt = new Map(), hours = new Map(), names = new Map(), prices = new Map();
  const since = new Date(Date.now() - 183 * 864e5).toISOString().slice(0, 10);
  let indexed = 0;
  tx(() => {
    run('DELETE FROM ai_history'); run('DELETE FROM ai_history_fts'); run('DELETE FROM ai_job_parts'); run('DELETE FROM ai_job_hours'); run('DELETE FROM ai_job_prices');
    for (const o of orders) {
      const its = byOrder.get(o.id) || [];
      const labor = its.filter((i) => i.kind === 'labor'), parts = its.filter((i) => i.kind === 'part');
      if (!labor.length && !parts.length) continue;
      const work = labor.map((l) => `${l.name}${String(l.unit || '').toLowerCase() === 'rbh' ? ` (${l.qty} h)` : ''}`).join(' ; ');
      const partsTxt = parts.map((p) => `${p.name}${p.code ? ' [' + p.code + ']' : ''}${p.qty && p.qty !== 1 ? ' x' + p.qty : ''}`).join(' ; ');
      const car = [o.make, o.model, o.engine, o.capacity, o.fuel, o.year].filter(Boolean).join(' ');
      run(`INSERT INTO ai_history (order_id, kind, vin, make, model, engine, capacity, fuel, year, work, items, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        o.id, o.kind, o.vin, o.make, o.model, o.engine, o.capacity, o.fuel, o.year, work, JSON.stringify({ labor: labor.map((l) => [l.name, l.qty, l.unit]), parts: parts.map((p) => [p.name, p.code, p.qty]) }), o.created_at);
      run('INSERT INTO ai_history_fts (rowid, car, work, parts) VALUES (?, ?, ?, ?)', o.id, car, work + ' ' + (o.complaint || ''), partsTxt);
      indexed++;
      // какие детали шли вместе с работой: в заказах с 1–3 работами — все детали заказа;
      // в больших заказах — только детали, у которых есть общий корень слова с работой («rozrząd» ↔ «zestaw rozrządu»)
      const pk = [...new Set(parts.map((p) => partKey(p.name)).filter(Boolean))];
      for (const l of labor) {
        const jk = jobKey(l.name);
        if (!jk) continue;
        names.set(jk, names.get(jk) || l.name);
        jobsCnt.set(jk, (jobsCnt.get(jk) || 0) + 1);
        const js = stems(jk);
        const mine = labor.length <= 3 ? pk : pk.filter((p) => [...stems(p)].some((x) => js.has(x)));
        for (const p of mine) { const k = jk + '|' + p; co.set(k, (co.get(k) || 0) + 1); names.set('p|' + p, names.get('p|' + p) || p); }
        // прайс: цена за единицу (брутто) как в выценах
        if (Number(l.price) > 0) {
          const e = prices.get(jk) || prices.set(jk, { names: new Map(), p: [], recent: [], qty: [], units: new Map(), orders: new Set(), last: '' }).get(jk);
          e.names.set(l.name, (e.names.get(l.name) || 0) + 1);
          e.p.push(Number(l.price)); e.qty.push(Number(l.qty) || 1);
          const u = String(l.unit || 'oper').toLowerCase(); e.units.set(u, (e.units.get(u) || 0) + 1);
          e.orders.add(o.id);
          const at = String(o.created_at || '').slice(0, 10);
          if (at >= since) e.recent.push(Number(l.price));
          if (at > e.last) e.last = at;
        }
      }
      for (const l of labor) {
        const h = laborHours(l);
        const jk = h ? jobKey(l.name) : '';
        if (jk) (hours.get(jk) || hours.set(jk, []).get(jk)).push(h);
      }
    }
    for (const [k, n] of co) {
      const [jk, p] = k.split('|');
      if (n >= 2) run('INSERT INTO ai_job_parts (job_key, job_name, part_name, n, jobs) VALUES (?,?,?,?,?)', jk, names.get(jk), p, n, jobsCnt.get(jk));
    }
    for (const [jk, e] of prices) {
      const name = [...e.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const unit = [...e.units.entries()].sort((a, b) => b[1] - a[1])[0][0];
      run(`INSERT INTO ai_job_prices (job_key, job_name, category, unit, qty, price, price_min, price_max, recent, n, orders, last_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        jk, name, catOf(name), unit, median(e.qty), Math.round(median(e.p) * 100) / 100, Math.min(...e.p), Math.max(...e.p),
        e.recent.length ? Math.round(median(e.recent) * 100) / 100 : null, e.p.length, e.orders.size, e.last || null);
    }
    for (const [jk, arr] of hours) {
      const s = arr.sort((a, b) => a - b);
      run('INSERT INTO ai_job_hours (job_key, job_name, hours, n) VALUES (?,?,?,?)', jk, names.get(jk) || jk, s[Math.floor(s.length / 2)], s.length);
    }
  });
  const stat = { indexed, orders: one("SELECT COUNT(*) n FROM ai_history WHERE kind = 'order'").n, quotes: one("SELECT COUNT(*) n FROM ai_history WHERE kind = 'quote'").n,
    jobs: one('SELECT COUNT(DISTINCT job_key) n FROM ai_job_parts').n, pairs: one('SELECT COUNT(*) n FROM ai_job_parts').n, hours: one('SELECT COUNT(*) n FROM ai_job_hours').n,
    prices: one('SELECT COUNT(*) n FROM ai_job_prices WHERE n >= 2').n, knowledge: one('SELECT COUNT(*) n FROM ai_knowledge').n, at: new Date().toISOString() };
  setSetting('ai_parts_trained', JSON.stringify(stat));
  return stat;
}
export const trainedStat = () => { try { return JSON.parse(getSetting('ai_parts_trained') || 'null'); } catch { return null; } };

/** Похожие прошлые работы по ключевым словам (польские названия работ / деталей), сначала — та же марка и модель */
export function similarJobs(keywords, car, limit = 15) {
  const words = [...new Set(keywords.flatMap((k) => strip(k).split(/[^a-z0-9]+/)).filter((w) => w.length > 3))].slice(0, 12);
  if (!words.length) return [];
  const q = words.map((w) => `work:${w.slice(0, 7)}*`).join(' OR ');
  let rows = [];
  try {
    rows = all(`SELECT h.order_id, h.make, h.model, h.engine, h.capacity, h.fuel, h.year, h.items, bm25(ai_history_fts) score
      FROM ai_history_fts f JOIN ai_history h ON h.order_id = f.rowid WHERE ai_history_fts MATCH ? ORDER BY score LIMIT 200`, q);
  } catch { return []; }
  const mk = strip(car?.make), md = strip(String(car?.model || '').split(/\s+/)[0]);
  const rank = (r) => r.score - (strip(r.make) === mk ? 3 : 0) - (md && strip(r.model).startsWith(md) ? 3 : 0) - (car?.capacity && r.capacity === car.capacity ? 2 : 0);
  return rows.sort((a, b) => rank(a) - rank(b)).slice(0, limit).map((r) => {
    const it = JSON.parse(r.items || '{}');
    return { car: [r.make, r.model, r.engine, r.capacity, r.fuel, r.year].filter(Boolean).join(' '),
      work: (it.labor || []).map(([n, q, u]) => `${n}${String(u || '').toLowerCase() === 'rbh' ? ` (${q} h)` : ''}`),
      parts: (it.parts || []).map(([n, c, q]) => `${n}${c ? ' [' + c + ']' : ''}${q && q !== 1 ? ' x' + q : ''}`) };
  });
}

/** Что сервис обычно ставит вместе с такими работами (доля заказов) и сколько часов они занимают */
export function jobKnowledge(keywords) {
  const keys = [...new Set(keywords.map(jobKey).filter(Boolean))];
  if (!keys.length) return { parts: [], hours: [], prices: [], knowledge: [] };
  const words = [...new Set(keys.flatMap((k) => k.split(' ')).filter((w) => w.length > 4 && w !== 'wymiana'))].slice(0, 10);
  if (!words.length) return { parts: [], hours: [], prices: [], knowledge: [] };
  const cond = words.map(() => 'job_key LIKE ?').join(' OR ');
  const args = words.map((w) => '%' + w.slice(0, 6) + '%');
  const parts = all(`SELECT job_name, part_name, n, jobs FROM ai_job_parts WHERE (${cond}) AND jobs >= 2 ORDER BY CAST(n AS REAL) / jobs DESC, n DESC LIMIT 60`, ...args)
    .map((r) => ({ job: r.job_name, part: r.part_name, share: Math.round((r.n / r.jobs) * 100), jobs: r.jobs }));
  const hours = all(`SELECT job_name, hours, n FROM ai_job_hours WHERE ${cond} ORDER BY n DESC LIMIT 15`, ...args);
  const prices = all(`SELECT job_name, unit, qty, price, recent, n FROM ai_job_prices WHERE (${cond}) AND n >= 2 ORDER BY n DESC LIMIT 12`, ...args);
  const knowledge = all(`SELECT job_name, data FROM ai_knowledge WHERE ${cond} LIMIT 8`, ...args).map((r) => { try { return { job: r.job_name, ...JSON.parse(r.data) }; } catch { return null; } }).filter(Boolean);
  return { parts, hours, prices, knowledge };
}

/** Черновики «Стандартных комплектов» из истории: детали, которые идут с работой в ≥ 40 % случаев */
export function kitDraftsFromHistory() {
  const top = all(`SELECT job_key, job_name, MAX(jobs) jobs FROM ai_job_parts WHERE jobs >= 4 GROUP BY job_key ORDER BY jobs DESC LIMIT 40`);
  const out = [];
  for (const j of top) {
    const ps = all('SELECT part_name, n FROM ai_job_parts WHERE job_key = ? AND CAST(n AS REAL) / jobs >= 0.4 ORDER BY n DESC LIMIT 12', j.job_key);
    if (ps.length) out.push({ name: j.job_name, items: ps.map((p) => p.part_name).join(', '), jobs: j.jobs });
  }
  return out;
}

/** Цена работы: ваш «Прайс работ» (то же название по смыслу) → медиана из истории (≥ 2 раз) → null */
export function laborPrice(name) {
  const jk = jobKey(name);
  if (!jk) return null;
  for (const c of all("SELECT name, price, unit, qty, norm_hours FROM service_catalog WHERE active = 1 AND price > 0")) {
    if (jobKey(c.name) === jk) return { price: c.price, unit: c.unit, qty: c.qty, hours: c.norm_hours, src: 'прайс работ' };
  }
  const h = one('SELECT price, recent, unit, qty, n FROM ai_job_prices WHERE job_key = ? AND n >= 2', jk);
  if (h) return { price: h.recent || h.price, unit: h.unit, qty: h.qty, src: `история выцен (${h.n}×)` };
  return null;
}

/** Прайс из истории для настроек: работы с ценой, сравнение с «Прайсом работ» */
export function historyPriceList(limit = 400) {
  const cat = all('SELECT id, name, price FROM service_catalog');
  const byKey = new Map(cat.map((c) => [jobKey(c.name), c]));
  return all('SELECT * FROM ai_job_prices WHERE n >= 2 ORDER BY n DESC, job_name LIMIT ?', limit).map((r) => {
    const c = byKey.get(r.job_key);
    return { ...r, catalog: c ? { id: c.id, name: c.name, price: c.price } : null };
  });
}
