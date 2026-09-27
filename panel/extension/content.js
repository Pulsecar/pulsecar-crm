// Pulsecar в хуртовне: кнопка у каждой детали (Inter Cars и др.) + сбор таблицы/выделения с любой страницы.
// Окно «Pobierz do Pulsecar»: товар в картотеку, приход на склад, в заказ или смету — цена продажи = рекомендованная хуртовней.
(() => {
  if (window.__pulsecar) return;
  window.__pulsecar = true;

  const host = location.hostname;
  const SUPPLIER = /intercars/.test(host) ? 'intercars' : /hartphp/.test(host) ? 'hart' : /autopartner|apcat/.test(host) ? 'autopartner'
    : /inter-team/.test(host) ? 'interteam' : /motoprofil|profiauto/.test(host) ? 'motoprofil' : /gordon/.test(host) ? 'gordon' : /motorol/.test(host) ? 'motorol'
    : /rodon/.test(host) ? 'rodon' : /arge/.test(host) ? 'arge-krakow' : /elit/.test(host) ? 'elit' : /autoland/.test(host) ? 'autoland' : 'other';
  const api = (path, opts = {}) => new Promise((ok) => chrome.runtime.sendMessage({ type: 'api', path, ...opts }, ok));
  const T = (e) => (e?.innerText || e?.textContent || '').replace(/ /g, ' ').trim();
  const MONEY = /(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,2})|\d+(?:[,.]\d{1,2})?)\s*(?:PLN|zł|zl)\b/gi;
  const toNum = (s) => { const n = parseFloat(String(s).replace(/[ .](?=\d{3}\b)/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const round2 = (n) => Math.round(n * 100) / 100;
  const pageGross = () => /(z VAT|brutto|вкл\.?\s*НДС|с НДС|incl\.?\s*VAT|with VAT)/i.test(T(document.body).slice(0, 20000));

  // ── Inter Cars: карточки деталей по «Kod Inter Cars: XXXX» ─────────────────
  const IC_CODE = /(?:Kod Inter Cars|Код Inter Cars|Inter Cars code|Kód Inter Cars|Kod IC|Код IC)\s*:?\s*([A-Z0-9]{4,14})/i;
  const REC = /rekomend|sugerow|detaliczn|katalogow|рекоменд|розничн|recommend|retail|list price/i;

  function icCards() {
    const labels = [...document.querySelectorAll('body *')].filter((el) => el.childElementCount <= 4 && el.textContent.length < 400 && IC_CODE.test(el.textContent)
      && ![...el.children].some((c) => IC_CODE.test(c.textContent)));
    const cards = new Set();
    for (const l of labels) {
      let c = l;
      for (let i = 0; i < 14 && c.parentElement; i++) {
        c = c.parentElement;
        const txt = c.textContent;
        const codes = txt.match(new RegExp(IC_CODE.source, 'gi')) || [];
        if (codes.length > 1) { c = null; break; }
        if ((txt.match(MONEY) || []).length && c.querySelector('button, input, a')) break;
      }
      if (c && c !== document.body) cards.add(c);
    }
    return [...cards];
  }

  function parseIcCard(card) {
    const text = T(card);
    const sku = (IC_CODE.exec(text) || [])[1] || null;
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    const codeLike = (s) => /^[A-Z0-9][A-Z0-9 .\-/]{2,34}$/i.test(s) && /\d/.test(s) && s !== sku;
    const link = [...card.querySelectorAll('a, h1, h2, h3, h4, strong, b')].map(T).find(codeLike);
    const code = link || lines.find(codeLike) || sku;
    const li = lines.indexOf(code);
    const name = lines.slice(li + 1).find((s) => s.length > 2 && !/^\d/.test(s) && !s.match(MONEY) && !/актуальн|aktualn|сейчас|teraz|jutro|завтра|kod|код|wzo|filia|филиал/i.test(s)) || code;
    MONEY.lastIndex = 0;
    const brandImg = [...card.querySelectorAll('img')].map((i) => (i.alt || i.title || '').trim()).find((a) => a && a.length < 30 && a !== name);
    let rec = 0, client = 0;
    lines.forEach((s, i) => {
      const m = [...s.matchAll(MONEY)].map((x) => toNum(x[1]));
      if (!m.length) return;
      const isRec = REC.test(s) || (i > 0 && REC.test(lines[i - 1]) && !lines[i - 1].match(MONEY));
      if (isRec) rec = rec || m[m.length - 1]; else if (!client) client = m[0];
    });
    const qtyInput = [...card.querySelectorAll('input')].find((i) => /^\d+([.,]\d+)?$/.test(i.value || ''));
    const gross = pageGross();
    return {
      supplier: SUPPLIER, sku, code, name, brand: brandImg || null, qty: qtyInput ? toNum(qtyInput.value) || 1 : 1, vat: 23,
      price_net: client ? round2(gross ? client / 1.23 : client) : 0, sell_gross: rec ? round2(gross ? rec : rec * 1.23) : 0,
    };
  }

  function makeBtn(onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pulsecar-btn';
    b.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#1bf372;margin-right:6px"></span>Pulsecar';
    b.style.cssText = 'all:initial;display:inline-flex;align-items:center;justify-content:center;gap:0;font:600 13px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff;background:#111;border:1px solid #1bf372;border-radius:6px;padding:8px 12px;margin:4px 0 0 6px;cursor:pointer;white-space:nowrap';
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return b;
  }

  function decorateIc() {
    for (const card of icCards()) {
      if (card.querySelector('.pulsecar-btn') || card.closest('.pulsecar-host')) continue;
      const btns = [...card.querySelectorAll('button')];
      const anchor = btns.length ? btns[btns.length - 1] : null;
      const b = makeBtn(() => openModal([parseIcCard(card)]));
      if (anchor?.parentElement) anchor.parentElement.appendChild(b); else card.appendChild(b);
    }
  }

  // ── Любая страница: таблица или выделение → разбор на сервере CRM ─────────
  function capture(mode) {
    const sel = String(window.getSelection() || '');
    if (mode === 'selection' || sel.length > 15) return sel;
    let best = null, score = 0;
    document.querySelectorAll('table').forEach((tb) => {
      const rs = tb.querySelectorAll('tr');
      if (rs.length < 2 || !tb.offsetParent) return;
      const h = T(tb.querySelector('thead') || rs[0]).toLowerCase();
      const s = rs.length + (/indeks|kod|nazwa|ilo|cena|netto|symbol|numer|artyku|код|назв|цена/.test(h) ? 100 : 0);
      if (s > score) { score = s; best = tb; }
    });
    if (best) {
      const rs = [...best.querySelectorAll('tr')];
      return rs.map((r) => [...r.querySelectorAll('th,td')].map((c) => T(c).replace(/\n/g, ' ')).join('\t')).filter((l) => l.replace(/\t/g, '').trim()).join('\n');
    }
    return [...document.querySelectorAll('[role=row]')].map((r) => [...r.querySelectorAll('[role=cell],[role=gridcell],[role=columnheader]')].map((c) => T(c)).join('\t')).filter(Boolean).join('\n');
  }
  async function captureAndOpen(mode) {
    if (SUPPLIER === 'intercars' && mode !== 'selection') {
      const cards = icCards();
      if (cards.length) return openModal(cards.map(parseIcCard));
    }
    const text = capture(mode);
    if (!text) return toast('Pulsecar: не нашёл таблицу. Выделите строки мышкой и нажмите ещё раз.');
    const r = await api('suppliers/parse', { method: 'POST', body: { text } });
    if (r.error) return r.needSetup ? setupNeeded(r.error) : toast(r.error);
    openModal(r.data.lines.map((l) => ({ supplier: SUPPLIER, code: l.code, name: l.name, brand: l.brand, qty: l.qty, vat: l.vat, price_net: l.price_net, sell_gross: 0, ean: l.ean })));
  }
  chrome.runtime.onMessage.addListener((m) => { if (m?.type === 'pulsecar-capture') captureAndOpen(m.mode); });

  // ── Окно «Pobierz do Pulsecar» (в Shadow DOM, стили сайта не мешают) ───────
  function toast(msg) {
    const d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;background:#111;color:#fff;border:1px solid #1bf372;border-radius:10px;padding:12px 16px;font:14px system-ui,sans-serif;max-width:420px;box-shadow:0 10px 30px rgba(0,0,0,.4)';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 6000);
  }
  function setupNeeded(msg) {
    toast(msg);
    chrome.runtime.sendMessage({ type: 'options' });
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function openModal(rawItems) {
    const hello = await api('ext/hello');
    if (hello.error) return hello.needSetup ? setupNeeded(hello.error) : toast(hello.error);
    const [prep, docs] = await Promise.all([api('ext/prepare', { method: 'POST', body: { items: rawItems } }), api('ext/orders')]);
    const items = prep.data?.items || rawItems;
    const can = hello.data.can;
    const orders = docs.data?.orders || [], quotes = docs.data?.quotes || [];
    const last = await chrome.storage.local.get(['lastOrder', 'lastQuote']);
    const markup = hello.data.markup || 0;
    for (const it of items) if (!it.sell_gross && it.price_net) it.sell_gross = round2(it.price_net * 1.23 * (1 + markup / 100));

    const host = document.createElement('div');
    host.className = 'pulsecar-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    const optList = (list, sel) => list.map((o) => `<option value="${o.id}" ${String(o.id) === String(sel) ? 'selected' : ''}>${esc(o.number)} · ${esc(o.cname || '')} ${esc([o.make, o.model, o.plate].filter(Boolean).join(' '))}</option>`).join('');
    root.innerHTML = `<style>
      *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
      .bg{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center}
      .m{background:#fff;color:#1b1c1f;border-radius:14px;width:min(1060px,96vw);max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.4)}
      .h{padding:18px 24px;border-bottom:1px solid #e6e6e9;display:flex;align-items:baseline;gap:10px}
      .h b{font-size:20px}.h span{color:#6b6e75;font-size:13px}
      .b{padding:18px 24px}.opts{border:1px solid #e6e6e9;border-radius:10px}
      .opt{display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid #eee;background:#f7f7f8}.opt:last-child{border-bottom:0}
      .opt label{display:flex;align-items:center;gap:10px;font-size:15px;min-width:280px;cursor:pointer}
      .opt input[type=checkbox]{width:18px;height:18px;accent-color:#0a8f45}
      select,input.i{font:inherit;font-size:14px;border:1px solid #d5d6da;border-radius:8px;padding:7px 9px;background:#fff;color:#1b1c1f}
      select{flex:1;min-width:0}
      .warn{margin:14px 0;border:1px solid #f0b429;background:#fff8e6;color:#8a5a00;border-radius:10px;padding:10px 14px;font-size:14px}
      .ok{margin:14px 0;border:1px solid #1bb86a;background:#eafaf1;color:#0b6b3a;border-radius:10px;padding:10px 14px;font-size:14px}
      .ok a{color:#0b6b3a;font-weight:600}
      h3{text-align:center;margin:16px 0 8px;font-size:18px}
      table{width:100%;border-collapse:collapse;font-size:14px}th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b6e75;text-align:left;padding:8px;border-bottom:2px solid #e6e6e9}
      td{padding:6px 8px;border-bottom:1px solid #eee}td.r,th.r{text-align:right}input.i{width:100%}input.n{width:90px;text-align:right}
      input.bad{border-color:#e34948;background:#fdecec}.sub{color:#8a8d94;font-size:12px}
      .f{padding:14px 24px;border-top:1px solid #e6e6e9;display:flex;justify-content:flex-end;gap:10px}
      button{font:600 14px system-ui,sans-serif;border-radius:8px;padding:10px 18px;cursor:pointer;border:0}
      .c{background:#8a8d94;color:#fff}.p{background:#111;color:#fff;display:flex;align-items:center;gap:8px}.p i{width:10px;height:10px;border-radius:50%;background:#1bf372;display:inline-block}
      button:disabled{opacity:.5;cursor:default}
    </style>
    <div class="bg"><div class="m">
      <div class="h"><b>Pobierz do Pulsecar</b><span>(${esc(hello.data.brand)} · ${esc(hello.data.name)})</span></div>
      <div class="b">
        <div class="opts">
          <div class="opt"><label><input type="checkbox" id="product" checked ${can.product || can.stock ? '' : 'disabled'}>Создать товар в картотеке</label><span class="sub">цена продажи = рекомендованная хуртовни</span></div>
          <div class="opt"><label><input type="checkbox" id="stock" ${can.stock ? '' : 'disabled'}>Оприходовать на склад (PZ)</label><span class="sub">когда деталь уже приехала</span></div>
          <div class="opt"><label><input type="checkbox" id="toOrder" ${can.order && orders.length ? '' : 'disabled'}>Добавить в заказ</label><select id="order">${optList(orders, last.lastOrder) || '<option value="">нет открытых заказов</option>'}</select></div>
          <div class="opt"><label><input type="checkbox" id="toQuote" ${can.quote && quotes.length ? '' : 'disabled'}>Добавить в смету</label><select id="quote">${optList(quotes, last.lastQuote) || '<option value="">нет открытых смет</option>'}</select></div>
        </div>
        <div id="msg"></div>
        <h3>Список товаров</h3>
        <table><thead><tr><th>#</th><th>Название</th><th>Код товара</th><th>Производитель</th><th class="r">Кол-во</th><th class="r">Закупка нетто</th><th class="r">Продажа брутто</th></tr></thead><tbody>
        ${items.map((it, n) => `<tr><td>${n + 1}</td><td><input class="i" data-n="${n}" data-k="name" value="${esc(it.name)}">${it.product ? `<div class="sub">уже есть на складе: ${it.product.stock} шт.</div>` : ''}${it.source === 'api' ? '<div class="sub">цены из API Inter Cars</div>' : ''}</td>
          <td><input class="i" data-n="${n}" data-k="code" value="${esc(it.code)}"></td><td><input class="i" data-n="${n}" data-k="brand" value="${esc(it.brand || '')}"></td>
          <td class="r"><input class="i n" type="number" step="1" min="1" data-n="${n}" data-k="qty" value="${it.qty || 1}"></td>
          <td class="r"><input class="i n" type="number" step="0.01" data-n="${n}" data-k="price_net" value="${it.price_net || 0}"></td>
          <td class="r"><input class="i n" type="number" step="0.01" data-n="${n}" data-k="sell_gross" value="${it.sell_gross || 0}"></td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="f"><button class="c" id="cancel">Anuluj</button><button class="p" id="go"><i></i>Pobierz do Pulsecar</button></div>
    </div></div>`;
    document.documentElement.appendChild(host);
    const $ = (id) => root.getElementById(id);
    const close = () => host.remove();
    $('cancel').onclick = close;
    root.querySelector('.bg').addEventListener('click', (e) => { if (e.target.classList.contains('bg')) close(); });
    root.querySelectorAll('input.i').forEach((inp) => inp.addEventListener('input', () => {
      const it = items[Number(inp.dataset.n)];
      it[inp.dataset.k] = inp.type === 'number' ? Number(inp.value) : inp.value;
      validate();
    }));
    $('stock').addEventListener('change', () => { if ($('stock').checked) $('product').checked = true; validate(); });
    $('order').addEventListener('change', () => { $('toOrder').checked = true; });
    $('quote').addEventListener('change', () => { $('toQuote').checked = true; });
    function validate() {
      const bad = items.filter((i) => !(i.price_net > 0));
      root.querySelectorAll('input[data-k=price_net]').forEach((inp) => inp.classList.toggle('bad', !(items[Number(inp.dataset.n)].price_net > 0)));
      $('msg').innerHTML = bad.length && ($('stock').checked || $('product').checked)
        ? `<div class="warn">Поправьте данные:<br>${bad.map((i) => `${esc(i.code || i.name)}: цена закупки должна быть больше 0`).join('<br>')}</div>` : '';
      return !($('stock').checked && bad.length);
    }
    validate();
    $('go').onclick = async () => {
      if (!validate()) return;
      const body = {
        supplier: SUPPLIER, items, product: $('product').checked, stock: $('stock').checked,
        order_id: $('toOrder').checked ? $('order').value || null : null, quote_id: $('toQuote').checked ? $('quote').value || null : null,
      };
      if (!body.product && !body.stock && !body.order_id && !body.quote_id) { $('msg').innerHTML = '<div class="warn">Отметьте, куда добавить: склад, заказ или смета.</div>'; return; }
      $('go').disabled = true;
      const r = await api('ext/pick', { method: 'POST', body });
      $('go').disabled = false;
      if (r.error) { $('msg').innerHTML = `<div class="warn">${esc(r.error)}</div>`; return; }
      chrome.storage.local.set({ lastOrder: body.order_id || last.lastOrder || '', lastQuote: body.quote_id || last.lastQuote || '' });
      const d = r.data;
      const link = (hash, label) => `<a href="${r.panel}/#${hash}" target="_blank">${esc(label)}</a>`;
      $('msg').innerHTML = `<div class="ok">Готово: ${[d.products ? `товаров в картотеке: ${d.products}` : '', d.stock ? `приход ${esc(d.stock)}` : '',
        d.order ? `в заказе ${link('/orders/' + body.order_id, d.order)}` : '', d.quote ? `в смете ${link('/quotes/' + body.quote_id, d.quote)}` : ''].filter(Boolean).join(' · ')}</div>`;
      $('go').textContent = 'Добавлено ✓';
      $('go').disabled = true;
      setTimeout(close, 5000);
    };
  }

  // ── запуск: кнопки у деталей Inter Cars (страницы меняются без перезагрузки) ──
  if (SUPPLIER === 'intercars') {
    let t = null;
    const run = () => { clearTimeout(t); t = setTimeout(decorateIc, 400); };
    run();
    new MutationObserver((muts) => { if (muts.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && !n.classList?.contains('pulsecar-btn') && !n.classList?.contains('pulsecar-host')))) run(); })
      .observe(document.body, { childList: true, subtree: true });
  } else {
    // на других хуртовнях — плавающая кнопка: забрать таблицу (корзина, WZ, фактура) или выделенные строки
    const fab = makeBtn(() => captureAndOpen('page'));
    fab.style.cssText += ';position:fixed;right:18px;bottom:18px;z-index:2147483646;box-shadow:0 6px 20px rgba(0,0,0,.35)';
    fab.title = 'Забрать позиции с этой страницы в Pulsecar (или выделите строки мышкой)';
    document.body.appendChild(fab);
  }
})();
