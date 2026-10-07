// Allegro (в т.ч. Allegro Biznes) для ИИ-запчастиста: поиск запчасти, которой нет в наличии в Inter Cars, в вашей вкладке Allegro.
// Только чтение: открываем страницу поиска (новые, сортировка по релевантности) и читаем список предложений.
// Никаких кликов «в корзину» / «купить», рекламные (спонсорские) предложения пропускаем — по ним не переходим.
// Человеческий темп (пауза 2–4 с), одна вкладка. Вход / капча / проверка «я не робот» → стоп.
(() => {
  const pause = () => new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitLoad(tabId, timeout = 25000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const t = await chrome.tabs.get(tabId); if (t.status === 'complete') return; await wait(300); }
  }
  async function run(tabId, func, args = []) {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return r?.result;
  }
  function pageState() {
    const txt = (document.body?.innerText || '').slice(0, 4000);
    if (/captcha|nie jestem robotem|potwierdź, że jesteś człowiekiem|i'm not a robot/i.test(txt) || document.querySelector('iframe[src*="captcha"], iframe[src*="geo.captcha-delivery"]')) return 'captcha';
    return 'ok';
  }
  function readAllegro(limit) {
    const num = (s) => Number(String(s || '').replace(/[\s ]/g, '').replace(',', '.')) || 0;
    const out = [];
    for (const a of document.querySelectorAll('article')) {
      const t = a.innerText || '';
      if (/Sponsorowane/.test(t)) continue;
      const link = [...a.querySelectorAll('a[href]')].map((x) => { try { return new URL(x.href); } catch { return null; } })
        .find((u) => u && (u.searchParams.get('offerId') || /\/oferta\//.test(u.pathname)));
      if (!link) continue;
      const offerId = link.searchParams.get('offerId') || (link.pathname.match(/(\d{9,12})(?:$|[/?#])/) || [])[1];
      if (!offerId) continue;
      const title = (a.querySelector('h2')?.innerText || t.split('\n')[0] || '').trim();
      const cur = num((a.querySelector('[aria-label*="aktualna cena"]')?.getAttribute('aria-label') || '').match(/([\d\s ]+,\d{2})/)?.[1]);
      const gross = num((t.match(/([\d\s ]+,\d{2})\s*zł\s*z\s*\d+%\s*VAT/) || [])[1]) || cur;
      const net = /\n\s*netto\s*\n/.test(t) ? cur : 0;
      const withDelivery = num((t.match(/([\d\s ]+,\d{2})\s*zł\s*z dostawą/) || [])[1]);
      const brand = ((t.match(/(?:Producent części|Marka)\s+(.+?)\s+(?:Numer katalogowy|Numer części|Stan|$)/m) || [])[1] || '').trim();
      const article = ((t.match(/Numer katalogowy części\s+(.+?)(?:\n|$)/) || [])[1] || '').trim();
      const delivery = ((t.match(/\n(dostawa (?!za )[^\n]{2,30})/) || [])[1] || '').trim();
      if (!gross) continue;
      out.push({ offerId, url: 'https://allegro.pl/oferta/' + offerId, title: title.slice(0, 160), brand: /^bez marki$/i.test(brand) ? '' : brand.slice(0, 40),
        article: article.slice(0, 40), gross, net, withDelivery, delivery, company: /\nFirma\n/.test(t), smart: /Smart/.test(t) });
      if (out.length >= limit) break;
    }
    const empty = /Nie znaleźliśmy|Brak wyników|0 ofert/i.test(document.body.innerText.slice(0, 6000));
    return { items: out, empty };
  }

  globalThis.allegroRun = async function allegroRun({ queries }, progress) {
    queries = (queries || []).map((q) => ({ key: String(q.key || ''), q: String(q.q || '').trim().slice(0, 120) })).filter((q) => q.q).slice(0, 12);
    if (!queries.length) return { ok: true, results: [] };
    const tabs = await chrome.tabs.query({ url: ['https://allegro.pl/*', 'https://business.allegro.pl/*'] });
    const tab = tabs[0] || await chrome.tabs.create({ url: 'https://allegro.pl/', active: false });
    const tabId = tab.id;
    const results = [];
    for (const [i, x] of queries.entries()) {
      if (i) await pause();
      progress(`Allegro: ${x.q} (${i + 1} из ${queries.length})…`);
      await chrome.tabs.update(tabId, { url: `https://allegro.pl/listing?string=${encodeURIComponent(x.q)}&stan=nowe` });
      await waitLoad(tabId);
      let r = { items: [] };
      for (let k = 0; k < 16; k++) {
        await wait(600);
        const st = await run(tabId, pageState);
        if (st !== 'ok') return { ok: false, stop: st, results, error: 'Allegro показал проверку «я не робот» — пройдите её в открытой вкладке и запустите подбор ещё раз' };
        r = (await run(tabId, readAllegro, [30])) || { items: [] };
        if (r.items.length || r.empty) break;
      }
      results.push({ key: x.key, q: x.q, items: r.items || [] });
    }
    return { ok: true, results };
  };
})();
