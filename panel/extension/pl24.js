// Работа с вашим аккаунтом partslink24 для ИИ-запчастиста (только по кнопке менеджера в CRM).
// Расширение НЕ хранит и не передаёт логин / пароль partslink24: работает во вкладке, где менеджер уже вошёл.
// Человеческий темп (пауза 1–3 с), одна вкладка, один VIN на один ремонт. Берём только OE-номера, названия и количество
// для запрошенных деталей — без картинок и без копирования каталога. Капча / вход / непонятный экран → стоп, показываем менеджеру.
const PL24 = 'https://www.partslink24.com';
const pause = () => new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function tabUrl(tabId) { return (await chrome.tabs.get(tabId)).url || ''; }
async function waitLoad(tabId, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const t = await chrome.tabs.get(tabId); if (t.status === 'complete') return; await wait(300); }
}
async function run(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r?.result;
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
function readList(onlyNumber) {
  // элементы списка partslink24: колонки «подпись — значение»; неактивные (_inactive) — не подходят к этому VIN
  const rows = [];
  for (const it of document.querySelectorAll('[class*="_listItem_"]')) {
    if ([...it.classList].some((c) => /_inactive/.test(c))) continue;
    const r = {};
    for (const col of it.querySelectorAll('[class*="_listItemColumn_"]')) {
      const lab = col.querySelector('[class*="_listItemLabel_"]')?.innerText.trim() || '';
      const val = col.innerText.replace(lab, '').replace(/\s+/g, ' ').trim();
      if (lab) r[lab.toLowerCase()] = val;
    }
    const num = r['numer czesci'] || r['numer części'] || r['part number'] || r['teilenummer'];
    if (!num) continue;
    if (onlyNumber && num.replace(/\W/g, '') !== onlyNumber.replace(/\W/g, '')) continue;
    rows.push({ number: num, name: r['nazwa'] || r['name'] || r['benennung'] || '', note: r['oznaczenie'] || r['bemerkung'] || '', qty: r['szt.'] || r['qty'] || r['menge'] || '',
      model: r['podanie modelu'] || r['modellangabe'] || '', group: [r['gr gl.'], r['pg'], r['nr rysunku']].filter(Boolean).join('/'), el: null });
  }
  return rows.slice(0, 40);
}
function clickBest(q) {
  // строка, где в названии больше всего слов запроса (а не первая попавшаяся)
  const words = String(q).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter((w) => w.length > 2).map((w) => w.slice(0, 5));
  let best = null, score = -1;
  for (const it of document.querySelectorAll('[class*="_listItem_"]')) {
    if ([...it.classList].some((c) => /_inactive/.test(c))) continue;
    const name = it.innerText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const sc = words.filter((w) => name.includes(w)).length - name.length / 1000;
    if (sc > score) { score = sc; best = it; }
  }
  if (!best) return null;
  const num = [...best.querySelectorAll('[class*="_listItemColumn_"]')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()).find((t) => /^Numer cz/i.test(t))?.replace(/^Numer cz\S*\s*/i, '') || null;
  best.click();
  return num;
}

/** Главный сценарий: VIN → поиск каждой детали → активные строки (+ количество из иллюстрации) */
globalThis.pl24Run = async function pl24Run({ vin, terms }, progress) {
  vin = String(vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  terms = (terms || []).slice(0, 12);
  if (vin.length !== 17 || !terms.length) return { ok: false, error: 'Нет VIN или списка деталей' };
  // уже открытое авто с этим VIN в partslink24 — работаем в той вкладке
  const open = (await chrome.tabs.query({ url: PL24 + '/*' })).find((t) => (t.url || '').includes('/' + vin + '/'));
  let tab = open || await chrome.tabs.create({ url: PL24 + '/portal-ui', active: true });
  let tabId = tab.id;
  await waitLoad(tabId);
  await wait(1500);
  let st = await run(tabId, pageState);
  if (st !== 'ok') return { ok: false, stop: st, error: st === 'login' ? 'Войдите в partslink24 в открытой вкладке и нажмите ещё раз' : 'partslink24 показал проверку (капча) — пройдите её сами и нажмите ещё раз' };
  let slug = /\/pl24-app\/([^/]+)\/([A-Z0-9]{17})\//.exec(await tabUrl(tabId));
  if (!slug || slug[2] !== vin) {
    progress('Открываю авто по VIN…');
    await run(tabId, enterVin, [vin]);
    const until = Date.now() + 15000;
    while (Date.now() < until && !(slug = /\/pl24-app\/([^/]+)\/([A-Z0-9]{17})\//.exec(await tabUrl(tabId)))) await wait(500);
    if (!slug) return { ok: false, stop: 'vin', error: 'partslink24 не открыл авто по VIN. Откройте авто вручную в этой вкладке и нажмите ещё раз.' };
  }
  const service = slug[1];
  const out = [];
  for (const [i, t] of terms.entries()) {
    await pause();
    progress(`Ищу «${t.q}» (${i + 1} из ${terms.length})…`);
    await chrome.tabs.update(tabId, { url: `${PL24}/pl24-app/${service}/${vin}/0/search?q=${encodeURIComponent(t.q)}` });
    await waitLoad(tabId);
    let rows = [];
    for (let k = 0; k < 16 && !rows.length; k++) { await wait(500); rows = (await run(tabId, readList)) || []; }
    st = await run(tabId, pageState);
    if (st !== 'ok') return { ok: false, stop: st, rows: out, error: 'partslink24 остановил работу (вход / капча) — продолжите вручную' };
    // количество и примечания — из иллюстрации первой подходящей строки (один клик)
    if (rows.length) {
      await pause();
      const num = await run(tabId, clickBest, [t.q]);
      await wait(2500);
      const i0 = Math.max(0, rows.findIndex((r) => num && r.number.replace(/\W/g, '') === num.replace(/\W/g, '')));
      const bom = (await run(tabId, readList, [rows[i0].number])) || [];
      const withQty = bom.find((b) => b.qty);
      if (withQty) Object.assign(rows[i0], { qty: withQty.qty, note: withQty.note || rows[i0].note, model: withQty.model || rows[i0].model, best: true });
      rows.unshift(...rows.splice(i0, 1));
    }
    out.push({ key: t.key, q: t.q, rows: rows.slice(0, 8).map(({ el, ...r }) => r) });
  }
  return { ok: true, service, results: out };
}
