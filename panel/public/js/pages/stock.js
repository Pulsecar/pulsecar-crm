import { html, useState, useEffect, useData, api, act, go, qs, useApp, Loading, ErrorBox, Icon, Modal, Pager, Picker, ConfirmButton, useDebounced, zl, num, fdate, fdt, todayStr, toast } from '../lib.js';

const DOC = { PZ: 'Приход (PZ)', WZ: 'Выдача в заказ (WZ)', RW: 'Списание (RW)', PW: 'Оприходование (PW)' };

export default function Stock({ sub, id }) {
  const tab = ['docs', 'receive', 'writeoff', 'intercars', 'file'].includes(sub) ? sub : 'products';
  return html`
    <div class="page-head"><h1>Склад</h1>
      <div class="actions"><a class="btn" href="#/stock/writeoff">Списание</a><a class="btn" href="#/stock/receive"><${Icon} n="plus" />Приход вручную</a>
        <a class="btn primary" href="#/stock/intercars"><${Icon} n="upload" />Inter Cars</a></div></div>
    <div class="pill-tabs" style="margin-bottom:14px">
      <button class=${tab === 'products' ? 'on' : ''} onClick=${() => go('/stock')}>Товары</button>
      <button class=${tab === 'docs' ? 'on' : ''} onClick=${() => go('/stock/docs')}>Документы</button>
      <button class=${tab === 'receive' ? 'on' : ''} onClick=${() => go('/stock/receive')}>Приход (PZ)</button>
      <button class=${tab === 'writeoff' ? 'on' : ''} onClick=${() => go('/stock/writeoff')}>Списание (RW)</button>
      <button class=${tab === 'intercars' ? 'on' : ''} onClick=${() => go('/stock/intercars')}>Inter Cars</button>
      <button class=${tab === 'file' ? 'on' : ''} onClick=${() => go('/stock/file')}>Из файла поставщика</button>
    </div>
    ${tab === 'products' && html`<${Products} openId=${sub === 'product' ? id : null} />`}
    ${tab === 'docs' && html`<${Docs} openId=${id} />`}
    ${tab === 'receive' && html`<${DocForm} type="PZ" />`}
    ${tab === 'writeoff' && html`<${DocForm} type="RW" />`}
    ${tab === 'intercars' && html`<${InterCars} />`}
    ${tab === 'file' && html`<${FromFile} />`}`;
}

function Products({ openId }) {
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState(null);
  const [open, setOpen] = useState(openId);
  const dq = useDebounced(q);
  useEffect(() => setPage(0), [dq, low]);
  const { data, loading, error, reload } = useData('products?' + qs({ q: dq, low: low ? 1 : '', page }));
  return html`
    <div class="card" style="margin-bottom:12px"><div class="row">
      <input class="grow" type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Название, индекс, производитель…" aria-label="Поиск товаров" />
      <label class="check"><input type="checkbox" checked=${low} onChange=${(e) => setLow(e.target.checked)} />Только заканчивающиеся</label>
      <button class="btn" onClick=${() => setEdit({})}><${Icon} n="plus" />Товар</button>
      ${data && html`<span class="muted small">Склад по закупке: <b>${zl(data.stockValue)}</b> нетто</span>`}
    </div></div>
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Товар</th><th>Индекс</th><th>Производитель</th><th class="r">Остаток</th><th class="r">В резерве</th><th class="r">Доступно</th><th class="r">Закупка нетто</th><th class="r">Продажа брутто</th><th>Место</th></tr></thead>
      <tbody>${(data?.rows || []).map((p) => {
        const avail = p.stock - p.reserved;
        return html`<tr class="click" onClick=${() => setOpen(p.id)}>
          <td><b>${p.name}</b></td><td class="sub">${p.code || ''}</td><td class="sub">${p.manufacturer || ''}</td>
          <td class=${'r ' + (p.min_stock && p.stock <= p.min_stock ? 'neg' : '')}>${num(p.stock, 2)} ${p.unit}</td>
          <td class="r sub">${p.reserved ? num(p.reserved, 2) : ''}</td><td class=${'r ' + (avail < 0 ? 'neg' : '')}><b>${num(avail, 2)}</b></td>
          <td class="r">${zl(p.purchase_price)}</td><td class="r">${zl(p.sell_price)}</td><td class="sub">${p.location || ''}</td></tr>`;
      })}</tbody></table></div>
      ${!loading && !data?.rows?.length ? html`<div class="empty">Товаров нет — добавьте через «Приход товара» или импорт</div>` : ''}
      ${data && html`<${Pager} page=${page} total=${data.total} size=${data.pageSize} onPage=${setPage} />`}</div>`}
    ${edit && html`<${ProductForm} p=${edit} onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); reload(); }} />`}
    ${open && html`<${ProductCard} id=${open} onClose=${() => { setOpen(null); reload(); }} onEdit=${(p) => { setOpen(null); setEdit(p); }} />`}`;
}

function ProductForm({ p, onClose, onSaved }) {
  const [f, set] = useState({ name: p.name || '', code: p.code || '', manufacturer: p.manufacturer || '', unit: p.unit || 'szt.', min_stock: p.min_stock || 0,
    purchase_price: p.purchase_price || 0, sell_price: p.sell_price || 0, vat: p.vat ?? 23, location: p.location || '' });
  const inp = (k, l, t = 'text') => html`<label class="f">${l}<input type=${t} step="0.01" value=${f[k]} onInput=${(e) => set({ ...f, [k]: t === 'number' ? Number(e.target.value) : e.target.value })} /></label>`;
  const margin = f.purchase_price ? Math.round(((f.sell_price / (1 + f.vat / 100)) / f.purchase_price - 1) * 100) : null;
  return html`<${Modal} title=${p.id ? 'Товар' : 'Новый товар'} onClose=${onClose} foot=${html`<button class="btn" onClick=${onClose}>Отмена</button>
      <button class="btn primary" onClick=${async () => { await act(() => api('products', { body: { ...f, id: p.id } }), 'Сохранено'); onSaved(); }}>Сохранить</button>`}>
    ${inp('name', 'Название')}
    <div class="grid g3">${inp('code', 'Индекс')}${inp('manufacturer', 'Производитель')}${inp('unit', 'Ед.')}</div>
    <div class="grid g4">${inp('purchase_price', 'Закупка нетто', 'number')}${inp('sell_price', 'Продажа брутто', 'number')}${inp('vat', 'VAT %', 'number')}${inp('min_stock', 'Мин. остаток', 'number')}</div>
    ${inp('location', 'Место на складе')}
    ${margin !== null && html`<div class="muted small">Наценка: ${margin}%</div>`}
  </${Modal}>`;
}

function ProductCard({ id, onClose, onEdit }) {
  const { data: p, reload } = useData('products/' + id);
  const [cnt, setCnt] = useState('');
  if (!p) return null;
  return html`<${Modal} title=${p.name} wide onClose=${onClose} foot=${html`<button class="btn" onClick=${() => onEdit(p)}><${Icon} n="edit" />Изменить</button>`}>
    <div class="grid g4">
      <div class="stat"><b>${num(p.stock, 2)}</b><span>Остаток, ${p.unit}</span></div>
      <div class="stat"><b>${num(p.reserved, 2)}</b><span>В резерве (открытые заказы)</span></div>
      <div class="stat"><b>${zl(p.purchase_price)}</b><span>Закупка нетто</span></div>
      <div class="stat"><b>${zl(p.sell_price)}</b><span>Продажа брутто</span></div>
    </div>
    <div class="row end"><label class="f" style="width:200px">Инвентаризация: факт<input type="number" step="0.01" value=${cnt} onInput=${(e) => setCnt(e.target.value)} /></label>
      <button class="btn" disabled=${cnt === ''} onClick=${async () => { const r = await act(() => api(`products/${p.id}/inventory`, { body: { counted: Number(cnt) } })); setCnt(''); reload(); if (r) act(async () => r, r.diff ? `Разница ${r.diff > 0 ? '+' : ''}${r.diff} оформлена документом` : 'Остаток совпадает'); }}>Записать</button></div>
    ${p.reservations.length ? html`<div><h3>Резерв</h3>${p.reservations.map((r) => html`<a class="chip" style="margin-right:6px" href=${'#/orders/' + r.id} onClick=${onClose}>${r.number} × ${r.qty}</a>`)}</div>` : ''}
    <h3>Движение</h3>
    ${p.moves.length ? html`<table class="tbl"><tbody>${p.moves.map((m) => html`<tr><td class="nowrap">${fdate(m.doc_date)}</td><td>${m.number}</td><td class="sub">${m.counterparty || ''}</td>
      <td class=${'r ' + (m.type === 'WZ' || m.type === 'RW' ? 'neg' : 'pos')}>${m.type === 'WZ' || m.type === 'RW' ? '−' : '+'}${num(m.qty, 2)}</td><td class="r sub">${zl(m.price_net)}</td></tr>`)}</tbody></table>` : html`<div class="muted">Движений нет</div>`}
  </${Modal}>`;
}

function Docs({ openId }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(openId || null);
  const dq = useDebounced(q);
  const { data, error } = useData('stock-docs?' + qs({ q: dq, page }));
  return html`
    <div class="card" style="margin-bottom:12px"><input type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Номер, номер поставщика, контрагент…" /></div>
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><table class="tbl">
      <thead><tr><th>Номер</th><th>Тип</th><th>Номер поставщика</th><th>Дата</th><th>Контрагент</th><th class="r">Сумма нетто</th></tr></thead>
      <tbody>${(data?.rows || []).map((d) => html`<tr class="click" onClick=${() => setOpen(d.id)}>
        <td><b>${d.number}</b></td><td class="sub">${DOC[d.type]}</td><td class="sub">${d.ext_number || ''}</td><td class="nowrap">${fdate(d.doc_date)}</td>
        <td>${d.counterparty || ''}${d.order_id ? html` <a href=${'#/orders/' + d.order_id} onClick=${(e) => e.stopPropagation()} class="small">заказ</a>` : ''}</td><td class="r">${zl(d.total_net)}</td></tr>`)}</tbody></table>
      ${data && html`<${Pager} page=${page} total=${data.total} size=${data.pageSize} onPage=${setPage} />`}</div>`}
    ${open && html`<${DocView} id=${open} onClose=${() => setOpen(null)} />`}`;
}

function DocView({ id, onClose }) {
  const { data: d } = useData('stock-docs/' + id);
  if (!d) return null;
  return html`<${Modal} title=${d.number + ' · ' + DOC[d.type]} wide onClose=${onClose}>
    <div class="muted">${fdate(d.doc_date)} · ${d.counterparty || ''} ${d.ext_number ? '· ' + d.ext_number : ''} ${d.created_by ? '· ' + d.created_by : ''}</div>
    <table class="tbl"><thead><tr><th>Товар</th><th>Индекс</th><th class="r">Кол-во</th><th class="r">Цена нетто</th><th class="r">Сумма</th></tr></thead>
      <tbody>${d.items.map((i) => html`<tr><td>${i.name}</td><td class="sub">${i.code || ''}</td><td class="r">${num(i.qty, 2)} ${i.unit}</td><td class="r">${zl(i.price_net)}</td><td class="r">${zl(i.qty * i.price_net)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="4">Итого нетто</td><td class="r">${zl(d.total_net)}</td></tr></tfoot></table>
    ${d.note ? html`<div class="muted">${d.note}</div>` : ''}
  </${Modal}>`;
}

function DocForm({ type, initialItems = [], initialHead = {} }) {
  const [h, setH] = useState({ counterparty: type === 'PZ' ? '' : '', ext_number: '', doc_date: todayStr(), note: '', ...initialHead });
  const [items, setItems] = useState(initialItems);
  const add = (p) => setItems([...items, p.id ? { product_id: p.id, name: p.name, code: p.code, qty: 1, price_net: p.purchase_price, sell_price: p.sell_price, unit: p.unit }
    : { name: p.name, code: '', qty: 1, price_net: 0, sell_price: 0, unit: 'szt.', isNew: true }]);
  const upd = (i, patch) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const total = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price_net) || 0), 0);
  const save = async () => {
    const r = await act(() => api('stock-docs', { body: { type, ...h, items } }), 'Документ проведён');
    go('/stock/docs/' + r.id);
  };
  return html`<div class="card">
    <div class="grid g4">
      <label class="f">${type === 'PZ' ? 'Поставщик' : 'Причина / кому'}<input value=${h.counterparty} onInput=${(e) => setH({ ...h, counterparty: e.target.value })} /></label>
      ${type === 'PZ' && html`<label class="f">Номер документа поставщика<input value=${h.ext_number} onInput=${(e) => setH({ ...h, ext_number: e.target.value })} placeholder="171998/1/WZO/2026" /></label>`}
      <label class="f">Дата<input type="date" value=${h.doc_date} onInput=${(e) => setH({ ...h, doc_date: e.target.value })} /></label>
      <label class="f">Заметка<input value=${h.note} onInput=${(e) => setH({ ...h, note: e.target.value })} /></label>
    </div>
    <div style="margin:14px 0"><${Picker} placeholder="+ Товар со склада (название, индекс) или новый…" path=${(q) => 'products?q=' + encodeURIComponent(q)}
      render=${(p) => html`<b>${p.name}</b> <span class="sub">${p.code || ''} · остаток ${num(p.stock, 2)}</span>`} onPick=${add}
      extra=${type === 'PZ' ? { label: 'Новый товар', onClick: (q) => q && add({ name: q }) } : null} /></div>
    ${items.length ? html`<div class="tbl-wrap"><table class="tbl items"><thead><tr><th>Товар</th><th>Индекс</th><th class="r">Кол-во</th><th class="r">Цена нетто</th>${type === 'PZ' ? html`<th class="r">Продажа брутто</th>` : ''}<th class="r">Сумма</th><th></th></tr></thead>
      <tbody>${items.map((i, n) => html`<tr>
        <td>${i.isNew ? html`<input value=${i.name} onInput=${(e) => upd(n, { name: e.target.value })} /><div class="sub pos">новый товар</div>` : html`<b>${i.name}</b>`}</td>
        <td>${i.isNew ? html`<input style="width:140px" value=${i.code} onInput=${(e) => upd(n, { code: e.target.value })} />` : html`<span class="sub">${i.code || ''}</span>`}</td>
        <td class="r"><input class="qty num" type="number" step="0.01" value=${i.qty} onInput=${(e) => upd(n, { qty: e.target.value })} /></td>
        <td class="r"><input class="price num" type="number" step="0.01" value=${i.price_net} onInput=${(e) => upd(n, { price_net: e.target.value })} /></td>
        ${type === 'PZ' ? html`<td class="r"><input class="price num" type="number" step="0.01" value=${i.sell_price} onInput=${(e) => upd(n, { sell_price: e.target.value })} /></td>` : ''}
        <td class="r nowrap">${zl((Number(i.qty) || 0) * (Number(i.price_net) || 0))}</td>
        <td class="act"><button class="icon-btn" onClick=${() => setItems(items.filter((_, j) => j !== n))}><${Icon} n="trash" /></button></td></tr>`)}</tbody>
      <tfoot><tr><td colspan=${type === 'PZ' ? 5 : 4}>Итого нетто</td><td class="r">${zl(total)}</td><td></td></tr></tfoot></table></div>` : html`<div class="empty">Добавьте позиции</div>`}
    <div class="row" style="margin-top:14px"><button class="btn primary lg" disabled=${!items.length} onClick=${save}>Провести ${type === 'PZ' ? 'приход' : 'списание'}</button></div>
  </div>`;
}

// ── Inter Cars: документы → склад одной кнопкой ─────────────────────────────
function InterCars() {
  const [all, setAll] = useState(false);
  const { data, reload } = useData('intercars/docs' + (all ? '?all=1' : ''));
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  if (!data) return html`<${Loading} />`;
  if (!data.enabled) return html`<div class="card">Inter Cars не подключён. Откройте <a href="#/settings/integrations">Настройки → Интеграции → Inter Cars</a> и вставьте ClientId и ClientSecret (те же, что в Motowarsztat).</div>`;
  const fresh = data.rows.filter((d) => !d.stock_doc_id);
  const sync = async (days) => {
    setBusy(true);
    try { const r = await api('intercars/sync', { body: { days } }); toast(r.created ? `Загружено новых документов: ${r.created}` : 'Новых документов нет'); reload(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const receiveAll = async () => {
    setBusy(true);
    try { const r = await api('intercars/receive-all', { body: {} }); toast(`Принято на склад: ${r.received}` + (r.errors.length ? ` · ошибок ${r.errors.length}` : '')); if (r.errors.length) toast(r.errors[0], 'error'); reload(); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return html`
    <div class="card" style="margin-bottom:12px"><div class="row">
      <button class="btn primary lg" disabled=${busy} onClick=${receiveAll}><${Icon} n="upload" />Принять всё новое на склад${fresh.length ? ` (${fresh.length})` : ''}</button>
      <button class="btn" disabled=${busy} onClick=${() => sync(7)}>${busy ? 'Загружаю…' : 'Проверить Inter Cars'}</button>
      <button class="btn ghost" disabled=${busy} onClick=${() => sync(30)}>за 30 дней</button>
      <label class="check" style="margin-left:auto"><input type="checkbox" checked=${all} onChange=${(e) => setAll(e.target.checked)} />Показать все</label>
    </div>
    <div class="muted small" style="margin-top:8px">${data.state.lastSync ? 'Последняя проверка: ' + fdt(data.state.lastSync.replace('T', ' ')) : 'Ещё не проверяли'}. Новые поставки проверяются автоматически каждые 30 минут.
      Товары сопоставляются по SKU Inter Cars, EAN и индексу; новые создаются сами с ценой закупки и продажи.
      ${data.state.lastError ? html`<span class="err"> Ошибка: ${data.state.lastError}</span>` : ''}</div></div>
    <div class="card tight"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Документ Inter Cars</th><th>Тип</th><th>Дата</th><th class="r">Позиций</th><th class="r">Нетто</th><th class="r">Брутто</th><th>Склад</th><th></th></tr></thead>
      <tbody>${data.rows.map((d) => html`<tr class="click" onClick=${() => setView(d.id)}>
        <td><b>${d.ext_id}</b></td><td class="sub">${d.kind === 'invoice' ? 'Фактура' : 'Поставка'}</td><td class="nowrap">${fdate(d.doc_date)}</td>
        <td class="r">${d.lines_count}</td><td class="r">${zl(d.total_net)}</td><td class="r">${zl(d.total_gross)}</td>
        <td>${d.stock_doc_id ? html`<a href=${'#/stock/docs/' + d.stock_doc_id} onClick=${(e) => e.stopPropagation()} class="pos">✓ ${d.stock_number}</a>` : html`<span class="badge" style="border-color:var(--warn);color:var(--warn)">новый</span>`}</td>
        <td class="act" onClick=${(e) => e.stopPropagation()}>${!d.stock_doc_id && html`<button class="btn primary sm" onClick=${async () => { await act(() => api(`intercars/docs/${d.id}/receive`, { body: {} }), 'Принято на склад'); reload(); }}>Принять</button>`}</td></tr>`)}</tbody></table></div>
      ${!data.rows.length ? html`<div class="empty">Документов пока нет — нажмите «Проверить Inter Cars»</div>` : ''}</div>
    ${view && html`<${ICDoc} id=${view} onClose=${() => setView(null)} />`}`;
}

function ICDoc({ id, onClose }) {
  const { data: d } = useData('intercars/docs/' + id);
  if (!d) return null;
  const lines = d.raw.lines || [];
  return html`<${Modal} title=${'Inter Cars ' + d.ext_id} wide onClose=${onClose}>
    <div class="muted">${fdate(d.doc_date)} · ${d.raw.shipFrom || d.raw.issueFrom || ''} ${d.raw.deliveryMethod ? '· ' + d.raw.deliveryMethod : ''} ${d.raw.orderId ? '· заказ ' + d.raw.orderId : ''} ${d.raw.ksefNumber ? '· KSeF ' + d.raw.ksefNumber : ''}</div>
    <table class="tbl"><thead><tr><th>Индекс</th><th>Название</th><th>Бренд</th><th class="r">Кол-во</th><th class="r">Цена нетто</th><th class="r">Розница брутто</th></tr></thead>
      <tbody>${lines.map((l) => html`<tr><td class="nowrap"><b>${l.index || ''}</b><div class="sub">${l.sku || ''}</div></td><td>${l.name}</td><td class="sub">${l.brandReference?.name || ''}</td>
        <td class="r">${l.quantity ?? ((l.shippedQuantity || 0) - (l.returnedQuantity || 0))}</td><td class="r">${zl(l.unitPriceNet)}</td><td class="r">${l.retailPrice ? zl(l.retailPrice.priceGross) : '—'}</td></tr>`)}</tbody></table>
  </${Modal}>`;
}

// ── Любой поставщик: приход из файла CSV/XLSX ───────────────────────────────
function FromFile() {
  const [parsed, setParsed] = useState(null);
  const [supplier, setSupplier] = useState('AUTO PARTNER S.A.');
  const [busy, setBusy] = useState(false);
  const upload = async (e) => {
    e.preventDefault();
    const f = e.target.querySelector('input[type=file]').files[0];
    if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    setBusy(true);
    try { setParsed(await api('stock-docs/parse-file', { form: fd })); } catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  if (parsed) return html`<div class="stack"><div class="card small">Распознано позиций: <b>${parsed.items.length}</b> (новых товаров: ${parsed.items.filter((i) => i.isNew).length}). Проверьте цены и количество, затем проведите приход.
      <a href="#" onClick=${(e) => { e.preventDefault(); setParsed(null); }}>Другой файл</a></div>
    <${DocForm} type="PZ" initialItems=${parsed.items} initialHead=${{ counterparty: supplier }} /></div>`;
  return html`<div class="card stack">
    <h2>Приход из файла поставщика</h2>
    <p class="muted" style="margin:0">Для Auto Partner, Inter Team, Hart, Gordon и любых других оптовиков: скачайте документ (WZ или фактуру) из их интернет-магазина в CSV или Excel и загрузите сюда.
      Колонки распознаются автоматически: индекс / название / количество / цена нетто / EAN / производитель.</p>
    <form class="row end" onSubmit=${upload}>
      <label class="f" style="width:240px">Поставщик<input value=${supplier} onInput=${(e) => setSupplier(e.target.value)} list="suppliers" /></label>
      <datalist id="suppliers">${['AUTO PARTNER S.A.', 'INTER CARS S.A.', 'INTER-TEAM', 'HART', 'GORDON', 'MOTO-PROFIL (ProfiAuto)', 'AUTO-ZATOKA', 'CAREX', 'JARO-FILTR', 'MOTORES'].map((x) => html`<option value=${x} />`)}</datalist>
      <label class="f grow">Файл<input type="file" accept=".csv,.xlsx,.xls" required /></label>
      <button class="btn primary" disabled=${busy}><${Icon} n="upload" />${busy ? 'Читаю…' : 'Загрузить'}</button>
    </form></div>`;
}
