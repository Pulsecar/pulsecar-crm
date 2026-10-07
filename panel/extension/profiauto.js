// ProfiAuto (online.profiauto.com) для ИИ-запчастиста: поиск по OE / артикулу в вашей вкладке ProfiAuto (ваш вход), только чтение.
// Без корзины и заказов: открываем страницу поиска и читаем строки товаров (индекс, производитель, наличие по складам, закупка, цена детальная).
// Человеческий темп (пауза 1,5–3 с), одна вкладка. Вход / капча → стоп.
(() => {
  const pause = () => new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const within = (p, ms, dflt) => Promise.race([p, new Promise((r) => setTimeout(() => r(dflt), ms))]);
  async function waitLoad(tabId, timeout = 25000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const t = await within(chrome.tabs.get(tabId).catch(() => null), 3000, null); if (!t || t.status === 'complete') return; await wait(300); }
  }
  async function run(tabId, func, args = []) {
    const res = await within(chrome.scripting.executeScript({ target: { tabId }, func, args }).catch(() => null), 10000, null);
    return res?.[0]?.result;
  }
  function pageState() {
    const txt = (document.body?.innerText || '').slice(0, 4000);
    if (document.querySelector('input[type=password]') || /\/login|\/auth/.test(location.pathname)) return 'login';
    if (/captcha|nie jestem robotem|i'm not a robot/i.test(txt)) return 'captcha';
    return 'ok';
  }
  function readPa(limit) {
    const T = (e) => (e?.innerText || '').replace(/ /g, ' ').trim();
    const num = (s) => Number(String(s || '').replace(/[\s ]/g, '').replace(',', '.')) || 0;
    const out = [];
    for (const r of document.querySelectorAll('app-article-list-row')) {
      const brand = T(r.querySelector('.article-title-index-brand'));
      const index = T(r.querySelector('.article-title-index')).split('\n')[0].replace(brand, '').replace(/\|/g, '').trim();
      if (!index) continue;
      const name = T(r.querySelector('.article-description-container')).split('\n')[0];
      const badge = T(r.querySelector('.article-badge.price-container, .price-container'));
      const retailNet = num((badge.match(/([\d\s ]+,\d{2})\s*PLN\s*netto/) || [])[1]);
      const retailGross = num((badge.match(/([\d\s ]+,\d{2})\s*PLN\s*brutto/) || [])[1]);
      const pv = [...r.querySelectorAll('.article-price-value-container')].map(T);
      const net = num((pv.find((x) => /netto/i.test(x)) || '').match(/([\d\s ]+,\d{2})/)?.[1]);
      const gross = num((pv.find((x) => /brutto/i.test(x)) || '').match(/([\d\s ]+,\d{2})/)?.[1]);
      const stock = [...r.querySelectorAll('.warehouse-item-container')].map((w) => {
        const name = T(w.querySelector('.warehouse-name')) || T(w).split('\n')[0];
        const v = T(w.querySelector('.warehouse-value')) || T(w).split('\n').pop();
        return { name, qty: /^>/.test(v) ? num(v.slice(1)) + 1 : num(v) };
      }).filter((w) => w.name);
      const link = r.querySelector('a[href*="/main-article/detail"]')?.href || null;
      const replacedBy = (T(r).match(/Zastąpiony przez:?\s*([^\n]+)/) || [])[1] || null;
      out.push({ index, brand, name: name.slice(0, 160), net, gross, retailNet, retailGross, stock, total: stock.reduce((s, w) => s + w.qty, 0), link, replacedBy });
      if (out.length >= limit) break;
    }
    const empty = /Brak wyników|Nie znaleziono|0 wyników/i.test(document.body.innerText.slice(0, 8000));
    return { items: out, empty, loading: !out.length && !!document.querySelector('mat-spinner, .spinner, [class*=loader]') };
  }

  globalThis.paRun = async function paRun({ queries }, progress) {
    queries = (queries || []).map((q) => ({ key: String(q.key || ''), q: String(q.q || '').trim().slice(0, 80) })).filter((q) => q.q.length >= 3).slice(0, 20);
    if (!queries.length) return { ok: true, results: [] };
    const tabs = await chrome.tabs.query({ url: 'https://online.profiauto.com/*' });
    const tab = tabs[0] || await chrome.tabs.create({ url: 'https://online.profiauto.com/', active: false });
    const tabId = tab.id;
    const results = [];
    for (const [i, x] of queries.entries()) {
      if (i) await pause();
      progress(`ProfiAuto: ${x.q} (${i + 1} из ${queries.length})…`, results);
      await chrome.tabs.update(tabId, { url: `https://online.profiauto.com/main-article/list?text=${encodeURIComponent(x.q)}&groups=-1` });
      await waitLoad(tabId);
      let r = { items: [] };
      for (let k = 0; k < 20; k++) {
        await wait(600);
        const st = await run(tabId, pageState);
        if (st && st !== 'ok') return { ok: false, stop: st, results, error: st === 'login' ? 'Войдите в ProfiAuto в открытой вкладке и запустите подбор ещё раз' : 'ProfiAuto показал проверку — пройдите её и запустите ещё раз' };
        r = (await run(tabId, readPa, [30])) || { items: [] };
        if (r.items.length || (r.empty && !r.loading)) break;
      }
      results.push({ key: x.key, q: x.q, items: r.items || [] });
    }
    return { ok: true, results };
  };
})();
