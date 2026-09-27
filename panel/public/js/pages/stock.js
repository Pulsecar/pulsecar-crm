import { html, useState, useEffect, useData, api, act, go, qs, useApp, Loading, ErrorBox, Icon, Modal, Pager, Picker, ConfirmButton, useDebounced, zl, num, fdate, fdt, todayStr, toast } from '../lib.js';
import { SuppliersPage } from './suppliers.js';

const DOC = { PZ: 'Приход (PZ)', WZ: 'Выдача в заказ (WZ)', RW: 'Списание (RW)', PW: 'Оприходование (PW)' };

export default function Stock({ sub, id }) {
  const tab = ['intercars', 'file', 'suppliers'].includes(sub) ? 'suppliers' : ['docs', 'receive', 'writeoff'].includes(sub) ? sub : 'products';
  return html`
    <div class="page-head"><h1>Склад</h1>
      <div class="actions"><a class="btn" href="#/stock/writeoff">Списание</a><a class="btn" href="#/stock/receive"><${Icon} n="plus" />Приход вручную</a>
        <a class="btn primary" href="#/stock/suppliers"><${Icon} n="upload" />От хуртовен</a></div></div>
    <div class="pill-tabs" style="margin-bottom:14px">
      <button class=${tab === 'products' ? 'on' : ''} onClick=${() => go('/stock')}>Товары</button>
      <button class=${tab === 'docs' ? 'on' : ''} onClick=${() => go('/stock/docs')}>Документы</button>
      <button class=${tab === 'receive' ? 'on' : ''} onClick=${() => go('/stock/receive')}>Приход (PZ)</button>
      <button class=${tab === 'writeoff' ? 'on' : ''} onClick=${() => go('/stock/writeoff')}>Списание (RW)</button>
      <button class=${tab === 'suppliers' ? 'on' : ''} onClick=${() => go('/stock/suppliers')}>Хуртовни</button>
    </div>
    ${tab === 'products' && html`<${Products} openId=${sub === 'product' ? id : null} />`}
    ${tab === 'docs' && html`<${Docs} openId=${id} />`}
    ${tab === 'receive' && html`<${DocForm} type="PZ" />`}
    ${tab === 'writeoff' && html`<${DocForm} type="RW" />`}
    ${tab === 'suppliers' && html`<${SuppliersPage} />`}`;
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
