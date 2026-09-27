import { html, useState, useEffect, useData, go, qs, Loading, ErrorBox, Badge, Icon, Pager, useDebounced, zl, num, fdate, carName, Picker, api, act } from '../lib.js';
import { CarForm } from './customers.js';

export function CarsList() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(q);
  useEffect(() => setPage(0), [dq]);
  const { data, loading, error } = useData('cars?' + qs({ q: dq, page }));
  return html`
    <div class="page-head"><h1>Автомобили</h1><span class="muted">${data ? num(data.total) : ''}</span>
      <div class="actions"><button class="btn primary" onClick=${() => setAdding(true)}><${Icon} n="plus" />Новое авто</button></div></div>
    <div class="card" style="margin-bottom:12px"><input type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Номер, VIN, марка, модель, владелец…" aria-label="Поиск авто" /></div>
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Марка / модель</th><th>Номер</th><th>VIN</th><th>Владелец</th><th class="r">Год</th><th class="r">Объём</th><th>Топливо</th><th class="r">Мощность</th><th class="r">Пробег</th></tr></thead>
      <tbody>${(data?.rows || []).map((k) => html`<tr class="click" onClick=${() => go('/cars/' + k.id)}>
        <td><b>${carName(k)}</b></td><td>${k.plate ? html`<span class="plate">${k.plate}</span>` : ''}</td><td class="sub">${k.vin || ''}</td>
        <td>${k.owner_name || '—'}<div class="sub">${k.owner_phone || ''}</div></td><td class="r">${k.year || ''}</td><td class="r">${k.capacity || ''}</td>
        <td class="sub">${k.fuel || ''}</td><td class="r">${k.power_kw ? k.power_kw + ' kW' : ''}</td><td class="r">${k.last_mileage ? num(k.last_mileage) : ''}</td></tr>`)}</tbody></table></div>
      ${!loading && !data?.rows?.length ? html`<div class="empty">Ничего не найдено</div>` : ''}
      ${data && html`<${Pager} page=${page} total=${data.total} size=${data.pageSize} onPage=${setPage} />`}</div>`}
    ${adding && html`<${CarForm} onClose=${() => setAdding(false)} onSaved=${(id) => go('/cars/' + id)} />`}`;
}

export function CarPage({ id }) {
  const { data: k, loading, error, reload } = useData('cars/' + id);
  const [edit, setEdit] = useState(false);
  const [open, setOpen] = useState(null);
  const [owner, setOwner] = useState(false);
  if (loading && !k) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} />`;
  return html`
    <div class="crumbs"><a href="#/cars">Автомобили</a></div>
    <div class="page-head"><h1>${carName(k)} ${k.year || ''}</h1>${k.plate ? html`<span class="plate" style="font-size:15px">${k.plate}</span>` : ''}
      <div class="actions"><button class="btn" onClick=${() => setEdit(true)}><${Icon} n="edit" />Изменить</button>
        <a class="btn primary" href=${`#/orders/new?${k.customer_id ? 'customer_id=' + k.customer_id + '&' : ''}car_id=${k.id}`}><${Icon} n="plus" />Заказ</a></div></div>
    <div class="grid g4" style="margin-bottom:14px">
      <div class="stat"><b style="font-size:15px">${k.vin || '—'}</b><span>VIN</span></div>
      <div class="stat"><b>${k.last_mileage ? num(k.last_mileage) + ' km' : '—'}</b><span>Последний пробег</span></div>
      <div class="stat"><b style="font-size:15px">${[k.engine, k.capacity && k.capacity + ' см³', k.power_kw && k.power_kw + ' kW', k.fuel].filter(Boolean).join(' · ') || '—'}</b><span>Двигатель</span></div>
      <div class="stat"><b style="font-size:15px">${k.owner ? html`<a href=${'#/customers/' + k.owner.id}>${k.owner.name || k.owner.phone}</a>` : '—'}</b>
        <span>Владелец ${k.owner?.phone || ''} · <a href="#" onClick=${(e) => { e.preventDefault(); setOwner(true); }}>сменить</a></span></div>
    </div>
    ${owner && html`<div class="card" style="margin-bottom:14px"><${Picker} placeholder="Новый владелец…" path=${(q) => 'customers?q=' + encodeURIComponent(q)}
      render=${(c) => html`<b>${c.name || '—'}</b> <span class="sub">${c.phone || ''}</span>`}
      onPick=${async (c) => { await act(() => api('cars/' + k.id, { method: 'PUT', body: { customer_id: c.id } }), 'Владелец изменён'); setOwner(false); reload(); }} /></div>`}
    ${(k.first_reg || k.inspection_until || k.insurance_until || k.paint_code || k.key_no || k.color) ? html`<div class="card small row" style="margin-bottom:14px;gap:18px">
      ${[['Первая регистрация', fdate(k.first_reg)], ['Техосмотр до', fdate(k.inspection_until)], ['Страховка до', fdate(k.insurance_until)], ['Цвет', k.color], ['Код краски', k.paint_code], ['Ключ', k.key_no], ['Категория', k.category]]
        .filter(([, v]) => v).map(([l, v]) => html`<span><span class="muted">${l}:</span> <b class=${/до$/.test(l) && v && k[l === 'Техосмотр до' ? 'inspection_until' : 'insurance_until'] < new Date().toISOString().slice(0, 10) ? 'neg' : ''}>${v}</b></span>`)}</div>` : ''}
    ${k.notes ? html`<div class="card small" style="margin-bottom:14px">${k.notes}</div>` : ''}
    <div class="card tight"><div class="row" style="padding:12px 14px"><h2 style="margin:0">История обслуживания</h2><span class="muted">${k.orders.length}</span></div>
      ${k.orders.length ? html`<table class="tbl"><thead><tr><th>Дата</th><th>Заказ</th><th>Статус</th><th class="r">Пробег</th><th class="r">Сумма</th></tr></thead><tbody>
        ${k.orders.map((o) => html`
          <tr class="click" onClick=${() => setOpen(open === o.id ? null : o.id)}><td class="nowrap">${fdate(o.closed_at || o.created_at)}</td>
            <td><a href=${(o.kind === 'quote' ? '#/quotes/' : '#/orders/') + o.id} onClick=${(e) => e.stopPropagation()}><b>${o.number}</b></a></td>
            <td><${Badge} color=${o.status_color}>${o.status_name}</${Badge}></td><td class="r">${o.mileage ? num(o.mileage) : ''}</td><td class="r nowrap">${zl(o.total)}</td></tr>
          ${open === o.id && html`<tr><td colspan="5" style="background:var(--surface2)">${o.items.map((i) => html`<div class="row small" style="justify-content:space-between">
            <span><span class="chip">${i.kind === 'part' ? 'деталь' : 'работа'}</span> ${i.name} ${i.qty !== 1 ? '×' + i.qty : ''}</span><span class="muted">${zl(i.qty * i.price * (1 - i.discount / 100))}</span></div>`)}
            ${o.complaint ? html`<div class="muted small" style="margin-top:6px">${o.complaint}</div>` : ''}</td></tr>`}`)}
      </tbody></table>` : html`<div class="empty">Ещё не обслуживалось</div>`}</div>
    ${edit && html`<${CarForm} k=${k} onClose=${() => setEdit(false)} onSaved=${() => { setEdit(false); reload(); }} />`}`;
}
