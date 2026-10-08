// Работа с вашим аккаунтом partslink24 для ИИ-запчастиста (только по кнопке менеджера в CRM).
// Расширение НЕ хранит и не передаёт логин / пароль partslink24: работает во вкладке, где менеджер уже вошёл.
// Человеческий темп (пауза 1–3 с), одна вкладка, один VIN на один ремонт. Берём только OE-номера, названия и количество
// для запрошенных деталей — без картинок и без копирования каталога. Капча / вход / непонятный экран → стоп, показываем менеджеру.
const PL24 = 'https://www.partslink24.com';
const pause = () => new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function tabUrl(tabId) { return (await chrome.tabs.get(tabId)).url || ''; }
const within = (p, ms, dflt) => Promise.race([p, new Promise((r) => setTimeout(() => r(dflt), ms))]);
async function waitLoad(tabId, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const t = await within(chrome.tabs.get(tabId).catch(() => null), 3000, null); if (!t || t.status === 'complete') return; await wait(300); }
}
async function run(tabId, func, args = []) {
  const res = await within(chrome.scripting.executeScript({ target: { tabId }, func, args }).catch(() => null), 10000, null);
  return res?.[0]?.result;
}

// ── функции, которые выполняются на странице partslink24 ──
function pageState() {
  const txt = (document.body?.innerText || '').slice(0, 4000);
  if (document.querySelector('input[type=password]')) return 'login';
  if (/captcha|recaptcha|nie jestem robotem|i'm not a robot|ich bin kein roboter/i.test(txt) || document.querySelector('iframe[src*="captcha"]')) return 'captcha';
  return 'ok';
}
function enterVin(vin) {
  const inp = [...document.querySelectorAll('input')].find((i) => /podwozia|vin|chassis|fahrgestell|bezpośrednie|direct/i.test(i.placeholder || '')) || document.querySelector('header input, input');
  if (!inp) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  inp.focus(); set.call(inp, vin); inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  inp.form?.requestSubmit?.();
  return true;
}
// VIN подходит к нескольким маркам («Dla tego nr VIN znaleziono wiele wpisów» — Hyundai / Kia): выбираем марку авто
function pickMake(make) {
  const opts = [...document.querySelectorAll('[class*="_inputMenu_"] [role="button"]')];
  if (!opts.length) return null;
  const m = String(make || '').toLowerCase().split(/\s+/)[0];
  const o = opts.find((x) => x.innerText.trim().toLowerCase().startsWith(m)) || (opts.length === 1 ? opts[0] : null);
  if (!o) return 'nomatch';
  o.click();
  return 'clicked';
}
// старый интерфейс partslink24 (Hyundai / Kia и др.: …/kia_parts/vin-group.action): окно «Szukaj» и таблица searchResultTable
function legacySearch(q) {
  let i = document.getElementById('searchTerm');
  if (!i) { const a = document.getElementById('search') || [...document.querySelectorAll('a')].find((x) => /^Szukaj$/i.test(x.innerText.trim())); a?.click(); i = document.getElementById('searchTerm'); }
  if (!i) return false;
  document.querySelectorAll('table.searchResultTable').forEach((t) => t.remove());
  i.value = q;
  (i.form?.querySelector('button, input[type=submit]') || i.nextElementSibling)?.click();
  return true;
}
function legacyRead(q) {
  const t = document.querySelector('table.searchResultTable');
  if (!t) return null;
  const trs = [...t.querySelectorAll('tr')];
  const head = [...(trs[0]?.children || [])].map((c) => c.innerText.trim().toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const ni = col(/numer/), nm = col(/nazwa|name/), gi = col(/rysun|illustr/), pi = col(/pnc|poz/);
  // поиск в старом каталоге ищет по любому слову — берём строки, где есть все значимые слова запроса
  const words = String(q).toLowerCase().split(/[\s,\-]+/).filter((w) => w.length > 2).map((w) => w.slice(0, 5));
  const rows = [];
  for (const tr of trs.slice(1)) {
    const c = [...tr.children].map((x) => x.innerText.replace(/\s+/g, ' ').trim());
    const name = c[nm] || '';
    if (!c[ni]) continue;
    const low = name.toLowerCase();
    if (words.length && !words.every((w) => low.includes(w))) continue;
    if (!rows.some((r) => r.number === c[ni])) rows.push({ number: c[ni], name, note: '', qty: '', model: '', group: c[gi] || '', pos: '', pnc: c[pi] || '' });
  }
  return rows.slice(0, 20);
}

function readList(onlyNumber) {
  // два вида списков partslink24: «карточки» (_listItem_ с подписями колонок — VW, BMW…) и таблицы (_headerRow_ + _row_ — Toyota и др.)
  // неактивные строки (_inactive / _disabled) не подходят к этому VIN
  const rows = [];
  const push = (r) => {
    const num = r['numer czesci'] || r['numer części'] || r['part number'] || r['teilenummer'];
    if (!num) return;
    if (onlyNumber && num.replace(/\W/g, '') !== onlyNumber.replace(/\W/g, '')) return;
    rows.push({ number: num, name: r['nazwa'] || r['name'] || r['benennung'] || '', note: [r['oznaczenie'] || r['bemerkung'], r['dodatek'] || r['zusatz'], r['od'] && 'od ' + r['od'], r['do'] && 'do ' + r['do']].filter(Boolean).join(', '),
      qty: r['szt.'] || r['ilosc'] || r['ilość'] || r['qty'] || r['menge'] || '', model: r['podanie modelu'] || r['modellangabe'] || r['więcej informacji'] || r['wiecej informacji'] || '',
      group: [r['gr gl.'], r['pg'], r['nr rysunku'], r['grupa']].filter(Boolean).join('/'), pos: r._bom ? (r['poz.'] || r['pos.'] || '') : (r._table ? '' : r['poz.'] || r['pos.'] || ''), el: null });
  };
  for (const it of document.querySelectorAll('[class*="_listItem_"]')) {
    if ([...it.classList].some((c) => /_inactive/.test(c))) continue;
    const r = {};
    for (const col of it.querySelectorAll('[class*="_listItemColumn_"]')) {
      const lab = col.querySelector('[class*="_listItemLabel_"]')?.innerText.trim() || '';
      const val = col.innerText.replace(lab, '').replace(/\s+/g, ' ').trim();
      if (lab) r[lab.toLowerCase()] = val;
    }
    push(r);
  }
  for (const h of document.querySelectorAll('[class*="_headerRow_"]')) {
    const labs = [...h.querySelectorAll('[class*="_headerContent_"]')].map((e) => e.innerText.trim().toLowerCase());
    const box = h.parentElement;
    const bom = labs.some((l) => /^(ilosc|ilość|szt\.?|qty|menge)$/.test(l)); // таблица рисунка узла (есть количество)
    for (const row of box.querySelectorAll('[class*="_row_"]')) {
      if (/_headerRow_/.test(row.className) || [...row.classList].some((c) => /_inactive|_disabled/.test(c))) continue;
      const fields = [...(row.querySelector('[class*="_fieldContainer_"]') || row).children].map((f) => f.innerText.replace(/\s+/g, ' ').trim());
      const r = { _table: true, _bom: bom };
      labs.forEach((l, i) => { if (l) r[l] = fields[i] || ''; });
      push(r);
    }
  }
  return rows.slice(0, 80);
}
function clickBest(q) {
  // строка, где в названии больше всего слов запроса (а не первая попавшаяся)
  const words = String(q).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[\s,]+/).filter((w) => w.length > 2).map((w) => w.slice(0, 5));
  let best = null, score = -1, hits = 0, num = null;
  const cands = [];
  for (const it of document.querySelectorAll('[class*="_listItem_"]')) {
    if ([...it.classList].some((c) => /_inactive/.test(c))) continue;
    const n = [...it.querySelectorAll('[class*="_listItemColumn_"]')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()).find((t) => /^Numer cz/i.test(t))?.replace(/^Numer cz\S*\s*/i, '') || null;
    cands.push({ el: it, text: it.innerText, num: n });
  }
  // таблица результатов поиска (без колонки количества)
  for (const h of document.querySelectorAll('[class*="_headerRow_"]')) {
    const labs = [...h.querySelectorAll('[class*="_headerContent_"]')].map((e) => e.innerText.trim().toLowerCase());
    const ni = labs.findIndex((l) => /^numer cz/.test(l)), nmi = labs.findIndex((l) => /^nazwa|^name/.test(l));
    if (ni < 0 || labs.some((l) => /^(ilosc|ilość|szt\.?)$/.test(l))) continue;
    for (const row of h.parentElement.querySelectorAll('[class*="_row_"]')) {
      if (/_headerRow_/.test(row.className) || [...row.classList].some((c) => /_inactive|_disabled/.test(c))) continue;
      const f = [...(row.querySelector('[class*="_fieldContainer_"]') || row).children].map((x) => x.innerText.replace(/\s+/g, ' ').trim());
      cands.push({ el: row, text: f[nmi] || row.innerText, num: f[ni] || null });
    }
  }
  for (const c of cands) {
    const name = String(c.text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const h = words.filter((w) => name.includes(w)).length;
    const sc = h - name.length / 1000;
    if (sc > score) { score = sc; best = c.el; hits = h; num = c.num; }
  }
  // все слова запроса должны быть в названии (иначе «kolektor ssący» откроет «kolektor wydechowy»)
  if (!best || hits < Math.min(words.length, 2) || !hits) return null; // ни одного слова запроса в названии — не открываем чужую деталь
  best.click();
  return num;
}

/** Главный сценарий: VIN → поиск каждой детали → активные строки (+ количество из иллюстрации) */
const LEGACY = /partslink24\.com\/[^/]+\/[a-z_]+_parts\/[a-z-]+\.action/;
/** Старый интерфейс partslink24: поиск каждой детали в окне «Szukaj» (каталог уже открыт по VIN), без рисунков узла */
async function legacyRun(tabId, terms, progress) {
  await waitLoad(tabId);
  await wait(1500);
  const out = [];
  for (const [i, t] of terms.entries()) {
    const qs = [t.q, ...(Array.isArray(t.alt) ? t.alt : [])].map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3);
    let rows = [], usedQ = t.q;
    for (const q of qs) {
      await pause();
      progress(`Ищу «${q}» (${i + 1} из ${terms.length})…`);
      const st = await run(tabId, pageState);
      if (st && st !== 'ok') return { ok: false, stop: st, results: out, error: 'partslink24 остановил работу (вход / капча) — продолжите вручную' };
      if (!(await run(tabId, legacySearch, [q]))) break;
      let r = null;
      for (let k = 0; k < 14 && !r; k++) { await wait(500); r = await run(tabId, legacyRead, [q]); }
      rows = r || [];
      usedQ = q;
      if (rows.length) break;
    }
    out.push({ key: t.key, q: usedQ, rows, bom: [] });
  }
  return { ok: true, service: 'legacy', results: out };
}

globalThis.pl24Run = async function pl24Run({ vin, terms, make }, progress) {
  vin = String(vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  terms = (terms || []).slice(0, 12);
  if (vin.length !== 17 || !terms.length) return { ok: false, error: 'Нет VIN или списка деталей' };
  // BMW / MINI в partslink24 открываются по 7 последним знакам VIN (номер кузова)
  const key = /^(WBA|WBS|WBY|WMW|WBX|4US|5UX|5YM)/.test(vin) ? vin.slice(-7) : vin;
  // уже открытое авто с этим VIN в partslink24 — работаем в той вкладке
  const open = (await chrome.tabs.query({ url: PL24 + '/*' })).find((t) => (t.url || '').includes('/' + key + '/'));
  let tab = open || await chrome.tabs.create({ url: PL24 + '/portal-ui', active: true });
  let tabId = tab.id;
  await waitLoad(tabId);
  await wait(1500);
  let st = await run(tabId, pageState);
  if (st !== 'ok') return { ok: false, stop: st, error: st === 'login' ? 'Войдите в partslink24 в открытой вкладке и нажмите ещё раз' : 'partslink24 показал проверку (капча) — пройдите её сами и нажмите ещё раз' };
  const SLUG = /\/pl24-app\/([^/]+)\/([A-Z0-9]{7,17})\//;
  if (open && LEGACY.test(open.url || '')) return legacyRun(tabId, terms, progress);
  let slug = SLUG.exec(await tabUrl(tabId));
  if (!slug || slug[2] !== key) {
    progress('Открываю авто по VIN…');
    await run(tabId, enterVin, [key]);
    const until = Date.now() + 15000;
    while (Date.now() < until && !((slug = SLUG.exec(await tabUrl(tabId))) && slug[2] === key)) {
      if (LEGACY.test(await tabUrl(tabId))) break;
      await wait(500);
      const pm = await run(tabId, pickMake, [make]);
      if (pm === 'clicked') await wait(1500);
    }
    if (LEGACY.test(await tabUrl(tabId))) return legacyRun(tabId, terms, progress);
    if (!slug || slug[2] !== key) {
      if (key !== vin) { // на всякий случай — полный VIN
        await run(tabId, enterVin, [vin]);
        const u2 = Date.now() + 15000;
        while (Date.now() < u2 && !((slug = SLUG.exec(await tabUrl(tabId))) && [vin, key].includes(slug[2]))) await wait(500);
      }
      if (!slug || ![vin, key].includes(slug[2])) return { ok: false, stop: 'vin', error: 'partslink24 не открыл авто по VIN. Откройте авто вручную в этой вкладке и нажмите ещё раз.' };
    }
  }
  const carKey = slug[2];
  const service = slug[1];
  const out = [];
  for (const [i, t] of terms.entries()) {
    await pause();
    progress(`Ищу «${t.q}» (${i + 1} из ${terms.length})…`);
    // основное название и запасные (у разных марок деталь называется по-разному: BMW «instalacja ssąca» вместо «kolektor ssący»)
    const qs = [t.q, ...(Array.isArray(t.alt) ? t.alt : [])].map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3);
    let rows = [], bom = [], usedQ = t.q, num = null;
    for (const [qi, q] of qs.entries()) {
      if (qi) { await pause(); progress(`Ищу «${q}» (${i + 1} из ${terms.length})…`); }
      await chrome.tabs.update(tabId, { url: `${PL24}/pl24-app/${service}/${carKey}/0/search?q=${encodeURIComponent(q)}` });
      await waitLoad(tabId);
      rows = [];
      for (let k = 0; k < 16 && !rows.length; k++) { await wait(500); rows = (await run(tabId, readList)) || []; }
      st = await run(tabId, pageState);
      if (st && st !== 'ok') return { ok: false, stop: st, rows: out, error: 'partslink24 остановил работу (вход / капча) — продолжите вручную' };
      if (!rows.length) continue;
      // открываем рисунок подходящей строки: количество, примечания и весь список деталей узла (прокладки, болты…)
      await pause();
      num = await run(tabId, clickBest, [q]);
      if (!num) { rows = []; continue; } // ни одна строка не похожа на запрос — пробуем другое название
      usedQ = q;
      await wait(3000);
      const all = (await run(tabId, readList)) || [];
      bom = all.filter((b) => b.pos);
      break;
    }
    if (rows.length && num) {
      const i0 = Math.max(0, rows.findIndex((r) => r.number.replace(/\W/g, '') === num.replace(/\W/g, '')));
      const me = bom.find((b) => b.number.replace(/\W/g, '') === rows[i0].number.replace(/\W/g, ''));
      if (me) Object.assign(rows[i0], { qty: me.qty, note: me.note || rows[i0].note, model: me.model || rows[i0].model });
      rows[i0].best = true;
      rows.unshift(...rows.splice(i0, 1));
      rows = rows.filter((r, k) => k === 0 || !bom.some((b) => b.number === r.number));
    }
    out.push({ key: t.key, q: usedQ, rows: rows.slice(0, 6).map(({ el, ...r }) => r), bom: bom.slice(0, 40).map(({ el, ...r }) => r) });
  }
  return { ok: true, service, results: out };
}
