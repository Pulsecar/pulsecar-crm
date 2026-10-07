// Inter Cars e-Catalog для ИИ-запчастиста: аналоги по OE-номеру в вашей вкладке e-Catalog (ваш вход), только чтение.
// Без корзины и заказов: открываем страницу поиска по номеру и читаем список товаров (код IC, индекс, название, производитель).
// Человеческий темп (пауза 1–3 с), одна вкладка. Вход / капча / непонятная страница → стоп.
(() => {
  const pause = () => new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitLoad(tabId, timeout = 20000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const t = await chrome.tabs.get(tabId); if (t.status === 'complete') return; await wait(300); }
  }
  async function run(tabId, func, args = []) {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return r?.result;
  }
  function pageState() {
    const txt = (document.body?.innerText || '').slice(0, 4000);
    if (document.querySelector('input[type=password]')) return 'login';
    if (/captcha|nie jestem robotem|i'm not a robot/i.test(txt) || document.querySelector('iframe[src*="captcha"]')) return 'captcha';
    return 'ok';
  }
  function readEcat(limit) {
    const out = [];
    for (const it of document.querySelectorAll('tbody.listingcollapsed__item')) {
      const code = it.dataset.productCode;
      const a = it.querySelector('a.activenumber');
      if (!code || !a) continue;
      const lines = (a.closest('td')?.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
      const tds = [...it.querySelectorAll('tr:first-child > td')];
      const bc = tds[3];
      const brand = (bc?.querySelector('img[title]')?.title || bc?.innerText || '').trim();
      const price = (it.innerText.match(/Cena detal\.\s*([\d\s ]+,\d{2})/) || [])[1] || '';
      out.push({ code, index: a.textContent.trim(), name: lines[1] || '', brand, retail: price.replace(/\s| /g, '') });
      if (out.length >= limit) break;
    }
    const total = Number((document.body.innerText.match(/WSZYSTKIE \((\d+)\)/) || [])[1] || out.length);
    const empty = /Nie znaleziono|Brak wyników|0 wyników/i.test(document.body.innerText.slice(0, 20000));
    return { items: out, total, empty };
  }

  globalThis.ecatRun = async function ecatRun({ oes, host }, progress) {
    oes = [...new Set((oes || []).map((x) => String(x).toUpperCase().replace(/[^A-Z0-9]/g, '')).filter((x) => x.length >= 5))].slice(0, 15);
    if (!oes.length) return { ok: true, results: [] };
    const tabs = await chrome.tabs.query({ url: 'https://*.e-cat.intercars.eu/*' });
    const base = host && /^[a-z]{2}\.e-cat\.intercars\.eu$/.test(host) ? 'https://' + host : tabs[0] ? new URL(tabs[0].url).origin : 'https://pl.e-cat.intercars.eu';
    const tab = tabs[0] || await chrome.tabs.create({ url: base + '/pl/', active: false });
    const tabId = tab.id;
    const results = [];
    for (const [i, oe] of oes.entries()) {
      if (i) await pause();
      progress(`Inter Cars: аналоги для OE ${oe} (${i + 1} из ${oes.length})…`);
      await chrome.tabs.update(tabId, { url: `${base}/pl/Pe%C5%82na-oferta/c/tecdoc?q=${encodeURIComponent(oe)}%3Adefault&initialSearch=true` });
      await waitLoad(tabId);
      let r = { items: [] };
      for (let k = 0; k < 16; k++) {
        await wait(500);
        const st = await run(tabId, pageState);
        if (st !== 'ok') return { ok: false, stop: st, results, error: st === 'login' ? 'Войдите в Inter Cars e-Catalog в открытой вкладке и запустите подбор ещё раз' : 'e-Catalog показал проверку (капча) — пройдите её и запустите ещё раз' };
        r = (await run(tabId, readEcat, [25])) || { items: [] };
        if (r.items.length || r.empty) break;
      }
      results.push({ oe, total: r.total || 0, items: r.items || [] });
    }
    return { ok: true, results };
  };
})();
