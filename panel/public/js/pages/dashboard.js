// Главная: у каждого сотрудника своя. «Настроить главную» → добавить / убрать блоки, поменять порядок (перетаскиванием
// или стрелками) и размер. Блоки — только из данных, к которым у сотрудника есть доступ.
import { html, useState, useEffect, useRef, useData, api, act, Loading, ErrorBox, zl, num, fdate, carName, Badge, Icon, Modal, useApp, toast } from '../lib.js';
import { Columns } from '../charts.js';

const SIZE = { s: 'Узкий', m: 'Половина', l: 'Во всю ширину' };
const fmtV = (v, f) => (f === 'zl' ? zl(v) : f === 'num2' ? num(v, 2) : num(v));
const go = (h) => () => (location.hash = h);
let seq = 0;
const newId = () => 'w' + Date.now().toString(36) + (seq++);

export default function Dashboard() {
  const { data: d, loading, error, reload } = useData('dashboard');
  const app = useApp();
  const [layout, setLayout] = useState(null);
  const [extra, setExtra] = useState({});      // данные блоков, добавленных во время настройки
  const [edit, setEdit] = useState(false);
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState(null);
  const saveT = useRef(null);
  useEffect(() => { if (d) setLayout(d.layout); }, [d]);
  if (loading && !d) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!layout) return html`<${Loading} />`;
  const data = { ...d.data, ...extra };
  const titleOf = Object.fromEntries(d.catalog.map((w) => [w.type, w.title]));

  const persist = (next) => {
    setLayout(next);
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => api('me/dashboard', { method: 'PUT', body: { widgets: next } }).catch((e) => toast(e.message, 'error')), 400);
  };
  const move = (i, j) => { if (j < 0 || j >= layout.length) return; const n = [...layout]; const [w] = n.splice(i, 1); n.splice(j, 0, w); persist(n); };
  const patch = (i, p) => persist(layout.map((w, k) => (k === i ? { ...w, ...p } : w)));
  const remove = (i) => persist(layout.filter((_, k) => k !== i));
  const add = async (cat) => {
    if (!data[cat.type] && !['shortcuts', 'note'].includes(cat.type)) { const v = await api('dashboard/widget/' + cat.type).catch(() => null); setExtra((x) => ({ ...x, [cat.type]: v })); }
    persist([...layout, { id: newId(), type: cat.type, size: cat.size, ...(cat.type === 'note' ? { text: '' } : {}) }]);
    toast(`Добавлено: ${cat.title}`);
  };
  const reset = async () => { await act(() => api('me/dashboard', { method: 'PUT', body: { widgets: null } }), 'Главная — как по умолчанию'); setExtra({}); reload(); };

  return html`
    <div class="page-head"><h1>Добрый день, ${app.user.name.split(' ')[0]}</h1>
      <div class="actions">
        ${d.canEdit && html`<button class=${'btn' + (edit ? ' primary' : '')} onClick=${() => { setEdit(!edit); if (edit) toast('Главная сохранена'); }}><${Icon} n=${edit ? 'check' : 'sliders'} />${edit ? 'Готово' : 'Настроить главную'}</button>`}
        ${!edit && html`<a class="btn" data-ui="dash.btn.calendar" href="#/calendar"><${Icon} n="cal" />Терминарз</a><a class="btn primary" data-ui="dash.btn.neworder" href="#/orders/new"><${Icon} n="plus" />Новый заказ</a>`}
      </div></div>
    ${edit && html`<div class="card dash-editbar">
      <span class="grow small">Перетаскивайте блоки мышкой или стрелками, меняйте ширину, убирайте лишнее. Всё сохраняется сразу и только для вас.</span>
      <button class="btn primary sm" onClick=${() => setAdding(true)}><${Icon} n="plus" />Добавить блок</button>
      <button class="btn ghost sm" onClick=${reset}>Как по умолчанию</button></div>`}
    <div class=${'dash-grid' + (edit ? ' editing' : '')}>
      ${layout.map((w, i) => html`<div key=${w.id} class=${'dw dw-' + w.size + (drag === i ? ' dragging' : '')}
          draggable=${edit} onDragStart=${() => setDrag(i)} onDragEnd=${() => setDrag(null)}
          onDragOver=${(e) => { if (edit && drag !== null) e.preventDefault(); }} onDrop=${(e) => { e.preventDefault(); if (drag !== null && drag !== i) move(drag, i); setDrag(null); }}>
        ${edit && html`<div class="dw-tools">
          <span class="dw-grip" title=${'Перетащите: ' + (w.title || titleOf[w.type] || w.type)}><${Icon} n="grip" /></span><span class="grow"></span>
          <button class="icon-btn" title="Раньше" disabled=${i === 0} onClick=${() => move(i, i - 1)}><${Icon} n="left" /></button>
          <button class="icon-btn" title="Позже" disabled=${i === layout.length - 1} onClick=${() => move(i, i + 1)}><${Icon} n="right" /></button>
          <select class="inline-input" style="width:auto" value=${w.size} onChange=${(e) => patch(i, { size: e.target.value })}>${Object.entries(SIZE).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
          <button class="icon-btn" title="Убрать с главной" onClick=${() => remove(i)}><${Icon} n="x" /></button></div>`}
        <${Widget} w=${w} v=${data[w.type]} title=${w.title || titleOf[w.type]} edit=${edit} app=${app} onText=${(t) => patch(i, { text: t })} />
      </div>`)}
      ${!layout.length && html`<div class="card empty dw dw-l">Главная пустая — нажмите «Настроить главную» → «Добавить блок».</div>`}
    </div>
    ${adding && html`<${AddWidget} catalog=${d.catalog} have=${layout.map((w) => w.type)} onAdd=${add} onClose=${() => setAdding(false)} />`}`;
}

/** Выбор блока для главной: только то, к чему есть доступ */
export function AddWidget({ catalog, have, onAdd, onClose }) {
  const groups = [...new Set(catalog.map((c) => c.group))];
  return html`<${Modal} wide title="Добавить блок на главную" onClose=${onClose}>
    <div class="muted small" style="margin-bottom:10px">Показаны только данные, к которым у вас есть доступ. Один блок можно добавить и несколько раз (например, две заметки).</div>
    ${groups.map((g) => html`<h3 style="margin:12px 0 6px">${g}</h3><div class="dw-cat">${catalog.filter((c) => c.group === g).map((c) => html`
      <button class=${'dw-cat-item' + (have.includes(c.type) ? ' have' : '')} onClick=${() => onAdd(c)}>
        <b>${c.title}</b><span class="muted small">${SIZE[c.size]}${have.includes(c.type) ? ' · уже на главной' : ''}</span></button>`)}</div>`)}
  </${Modal}>`;
}

function Rows({ rows, empty, children }) {
  return rows?.length ? html`<table class="tbl"><tbody>${rows.map(children)}</tbody></table>` : html`<div class="empty">${empty}</div>`;
}

function Widget({ w, v, title, edit, app, onText }) {
  if (w.type.startsWith('kpi_')) {
    if (!v) return html`<div class="stat"><b>—</b><span>${title}</span></div>`;
    return html`<div class=${'stat' + (w.type === 'kpi_today' ? ' accent' : '') + (v.link && !edit ? ' click' : '')} onClick=${v.link && !edit ? go(v.link) : undefined}>
      <b class=${v.bad ? 'neg' : ''}>${fmtV(v.value, v.fmt)}${v.unit ? ' ' + v.unit : ''}</b><span>${title}${v.sub != null ? ' · ' + fmtV(v.sub, v.subFmt) : ''}</span></div>`;
  }
  const card = (body, action) => html`<div class="card dw-card"><div class="row" style="margin-bottom:10px"><h2 style="margin:0">${title}</h2>${action || ''}</div>${body}</div>`;
  const car = (r) => html`${carName(r)} ${r.plate ? html`<span class="plate">${r.plate}</span>` : ''}`;
  switch (w.type) {
    case 'statuses': return html`<div class="status-strip">${(v || []).map((s) => html`<a href=${'#/orders?status=' + s.id}><${Badge} color=${s.color}>${s.name}</${Badge}><b>${s.n}</b></a>`)}</div>`;
    case 'today': return card(html`<${Rows} rows=${v} empty="На сегодня записей нет">${(a) => html`<tr class="click" onClick=${go(a.order_id ? '#/orders/' + a.order_id : '#/calendar')}>
      <td class="nowrap num"><b>${a.start_at.slice(11)}</b></td><td>${a.customer_name || a.contact_name || a.title}<div class="sub">${car(a)}</div></td><td class="sub">${a.station_name || ''}</td><td class="sub">${a.order_number || ''}</td></tr>`}</${Rows}>`,
      html`<a class="btn sm" style="margin-left:auto" href="#/calendar">Открыть</a>`);
    case 'requests': return card(html`<${Rows} rows=${v} empty="Заявок нет — сюда попадают записи из приложения и с сайта">${(a) => html`<tr class="click" onClick=${go('#/calendar')}>
      <td>${a.customer_name || a.contact_name}<div class="sub">${a.contact_phone || ''}</div></td><td>${a.title}<div class="sub">${a.preferred ? 'желаемо: ' + a.preferred : ''}</div></td><td class="sub nowrap">${fdate(a.created_at)}</td></tr>`}</${Rows}>`,
      html`${v?.length ? html`<span class="badge" style="background:var(--warn);color:#000">${v.length}</span>` : ''}<a class="btn sm" style="margin-left:auto" href="#/calendar">Распределить</a>`);
    case 'unpaid': return card(html`<${Rows} rows=${v} empty="Всё оплачено">${(o) => html`<tr class="click" onClick=${go('#/orders/' + o.id)}><td><b>${o.number}</b><div class="sub">${o.customer_name || ''}</div></td>
      <td class="r num">${zl(o.total)}<div class="sub">долг ${zl(o.total - o.paid)}</div></td></tr>`}</${Rows}>`);
    case 'my_orders': case 'recent': return card(html`<${Rows} rows=${v} empty="Заказов нет">${(o) => html`<tr class="click" onClick=${go('#/orders/' + o.id)}>
      <td><b>${o.number}</b><div class="sub">${o.customer_name || ''}</div></td><td>${car(o)}</td><td><${Badge} color=${o.status_color}>${o.status_name}</${Badge}>${o.pickup_at ? html`<div class="sub">выдача <span>${o.pickup_at.slice(0, 16)}</span></div>` : ''}</td></tr>`}</${Rows}>`);
    case 'my_jobs': return card(html`<${Rows} rows=${v} empty="Все ваши работы выполнены">${(j) => html`<tr class="click" onClick=${go('#/orders/' + j.order_id)}>
      <td>${j.name}<div class="sub">${j.number} · ${car(j)}</div></td><td class="r num nowrap">${num(j.qty, 2)} ${j.unit || ''}</td></tr>`}</${Rows}>`);
    case 'pickup': return card(html`<${Rows} rows=${v} empty="Сегодня и завтра выдач нет">${(o) => html`<tr class="click" onClick=${go('#/orders/' + o.id)}>
      <td class="nowrap"><b>${fdate(o.pickup_at)}</b><div class="sub">${(o.pickup_at || '').slice(11, 16)}</div></td><td><b>${o.number}</b> ${car(o)}<div class="sub">${o.customer_name || ''} ${o.phone || ''}</div></td>
      <td><${Badge} color=${o.status_color}>${o.status_name}</${Badge}></td></tr>`}</${Rows}>`);
    case 'followup': return card(html`<${Rows} rows=${v} empty="Сегодня звонить некому">${(o) => html`<tr class="click" onClick=${go('#/quotes/' + o.id)}>
      <td><b>${o.number}</b><div class="sub">${o.customer_name || ''} ${o.phone || ''}</div></td><td class="r num">${zl(o.total)}<div class="sub">${fdate(o.followup_at)}</div></td></tr>`}</${Rows}>`,
      html`<a class="btn sm" style="margin-left:auto" href="#/quotes?followup=due">Все</a>`);
    case 'cash': return card(html`<${Rows} rows=${v} empty="Касс нет">${(r) => html`<tr class="click" onClick=${go('#/cash')}><td>${r.name}</td><td class=${'r num' + (r.balance < 0 ? ' neg' : '')}><b>${zl(r.balance)}</b></td></tr>`}</${Rows}>`);
    case 'revenue30': return card(html`<${Columns} rows=${v || []} value=${(r) => r.s} label=${(r, short) => (short ? r.d.slice(8, 10) + '.' + r.d.slice(5, 7) : fdate(r.d))} fmt=${zl} height=${180} />`);
    case 'attention': return card(html`${!v?.lowStock?.length && !v?.storageDue?.length ? html`<div class="empty">Всё в порядке</div>` : ''}
      ${v?.lowStock?.length ? html`<h3>Заканчивается на складе</h3><table class="tbl"><tbody>${v.lowStock.map((p) => html`<tr class="click" onClick=${go('#/stock/product/' + p.id)}><td>${p.name}<div class="sub">${p.code || ''}</div></td><td class="r num neg">${num(p.stock, 2)} / мин. ${num(p.min_stock, 2)}</td></tr>`)}</tbody></table>` : ''}
      ${v?.storageDue?.length ? html`<h3 style="margin-top:12px">Хранение шин заканчивается</h3><table class="tbl"><tbody>${v.storageDue.map((s) => html`<tr class="click" onClick=${go('#/storage')}><td>${s.number}<div class="sub">${s.customer_name || ''}</div></td><td class="r">${fdate(s.date_until)}</td></tr>`)}</tbody></table>` : ''}`);
    case 'shortcuts': {
      const P = app.perms || {};
      const items = [['#/orders/new', 'plus', 'Новый заказ', 'orders.create'], ['#/quotes/new', 'file', 'Новая выцена', 'quotes.manage'], ['#/calendar', 'cal', 'Терминарз', 'calendar.view'],
        ['#/customers/new', 'users', 'Новый клиент', 'clients.create'], ['#/cars/new', 'car', 'Новое авто', 'cars.create'], ['#/stock', 'box', 'Склад', 'products.view'], ['#/cash', 'cash', 'Касса', 'cash.view'], ['#/storage', 'tire', 'Хранение', 'storage.view']]
        .filter(([, , , p]) => P[p]);
      return card(html`<div class="dw-shortcuts">${items.map(([h, ic, l]) => html`<a class="btn" href=${h}><${Icon} n=${ic} />${l}</a>`)}</div>`);
    }
    case 'note': return card(edit
      ? html`<textarea rows="5" style="width:100%" placeholder="Ваши заметки, телефоны, напоминания — видите только вы" value=${w.text || ''} onInput=${(e) => onText(e.target.value)}></textarea>`
      : html`<div class="dw-note">${w.text || html`<span class="muted">Пусто — нажмите «Настроить главную», чтобы написать заметку</span>`}</div>`);
    default: return card(html`<div class="empty">—</div>`);
  }
}

/** Редактор главной сотрудника для администратора (карточка сотрудника): список блоков */
export function StaffDashboard({ staffId }) {
  const { data, reload } = useData('staff/' + staffId + '/dashboard');
  const [adding, setAdding] = useState(false);
  if (!data) return html`<div class="muted small">Загрузка…</div>`;
  const L = data.layout;
  const title = Object.fromEntries(data.catalog.map((c) => [c.type, c.title]));
  const save = async (widgets, msg) => { await act(() => api(`staff/${staffId}/dashboard`, { method: 'PUT', body: { widgets } }), msg || 'Главная сотрудника сохранена'); reload(); };
  const move = (i, j) => { if (j < 0 || j >= L.length) return; const n = [...L]; const [w] = n.splice(i, 1); n.splice(j, 0, w); save(n); };
  return html`<div>
    <div class="dash-ed-list">${L.map((w, i) => html`<div class="dash-ed-row">
      <span class="grow">${w.title || title[w.type] || w.type}</span>
      <select class="inline-input" style="width:auto" value=${w.size} onChange=${(e) => save(L.map((x, k) => (k === i ? { ...x, size: e.target.value } : x)))}>${Object.entries(SIZE).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
      <button class="icon-btn" title="Выше" disabled=${i === 0} onClick=${() => move(i, i - 1)}>▲</button>
      <button class="icon-btn" title="Ниже" disabled=${i === L.length - 1} onClick=${() => move(i, i + 1)}>▼</button>
      <button class="icon-btn" title="Убрать" onClick=${() => save(L.filter((_, k) => k !== i))}><${Icon} n="x" /></button></div>`)}
      ${!L.length ? html`<div class="muted small">Блоков нет</div>` : ''}</div>
    <div class="row" style="margin-top:8px"><button class="btn sm" onClick=${() => setAdding(true)}><${Icon} n="plus" />Добавить блок</button>
      <button class="btn ghost sm" onClick=${() => save(null, 'Главная — как по умолчанию')}>Как по умолчанию</button>
      <span class="muted small" style="margin-left:auto">${data.custom ? 'настроена' : 'по умолчанию для роли'}</span></div>
    ${adding && html`<${AddWidget} catalog=${data.catalog} have=${L.map((w) => w.type)} onAdd=${(c) => { save([...L, { id: newId(), type: c.type, size: c.size }], `Добавлено: ${c.title}`); }} onClose=${() => setAdding(false)} />`}
  </div>`;
}
