import {
  html, useState, useEffect, useData, api, act, go, qs, useApp, Loading, ErrorBox, Badge, Icon, Modal, Field, Pager, Picker,
  ConfirmButton, useDebounced, zl, num, fdate, fdt, carName, METHOD, PAY_KINDS, toast,
} from '../lib.js';
import { SupplierParts } from './suppliers.js';
import { uiOn } from '../ui.js';
import { useSel, SelHead, SelCell, BulkBar } from '../bulk.js';
import { DocsMenu, SalesDocs, Intake } from './order-docs.js';
import { OrderMain, ItemsMW } from './order-form.js';
import { AztecButton, PlateButton, mergeCar } from '../vehicle.js';
import { CustomerEditor } from './customers.js';
import { CarEditor } from './cars.js';
import { ScanBox } from '../scan.js';
import { ReceiptBox } from '../fiscal.js';
import { ObjectHistory } from './audit.js';
import { OrderSlots } from './calendar.js';
import { Recommendations } from './recs.js';


// ── Выцены: обзвон клиента (статус, причина отказа, когда перезвонить) ─────────
export const FOLLOWUP = { new: ['Новая', '#5B8DEF'], call_back: ['Перезвонить', '#F0B429'], no_answer: ['Не отвечает', '#E8833A'], thinking: ['Думает', '#A97BE8'],
  scheduled: ['Записан', '#1BF372'], accepted: ['Согласился', '#1BF372'], declined: ['Отказался', '#E34948'] };
const REASONS = ['Дорого', 'Сделает сам', 'Сделал в другом сервисе', 'Нет времени', 'Продал авто', 'Передумал', 'Другое'];
const FuBadge = ({ k }) => (FOLLOWUP[k] ? html`<${Badge} color=${FOLLOWUP[k][1]}>${FOLLOWUP[k][0]}</${Badge}>` : html`<span class="faint">—</span>`);

// ── Список ────────────────────────────────────────────────────────────────
const TEXT_SORT = new Set(['customer', 'car', 'source', 'status']);
export function OrdersList({ kind, query }) {
  const app = useApp();
  const [q, setQ] = useState(query.q || '');
  const [status, setStatus] = useState(query.status || (kind === 'order' ? 'open' : ''));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fu, setFu] = useState(query.followup || '');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState(() => { try { return JSON.parse(localStorage.getItem('sort.' + kind)) || { k: '', d: 'desc' }; } catch { return { k: '', d: 'desc' }; } });
  const sortBy = (k) => {
    const n = sort.k === k ? { k, d: sort.d === 'asc' ? 'desc' : 'asc' } : { k, d: TEXT_SORT.has(k) ? 'asc' : 'desc' };
    setSort(n); try { localStorage.setItem('sort.' + kind, JSON.stringify(n)); } catch {}
  };
  const dq = useDebounced(q);
  useEffect(() => setPage(0), [dq, status, from, to, fu, sort.k, sort.d]);
  const { data, loading, error, reload } = useData('orders?' + qs({ kind, q: dq, status, from, to, page, followup: kind === 'quote' ? fu : '', sort: sort.k, dir: sort.k ? sort.d : '' }));
  const Th = ({ k, c, r, children }) => html`<th data-c=${c || k} class=${'sortable' + (r ? ' r' : '') + (sort.k === k ? ' sorted' : '')} title="Сортировать" onClick=${() => sortBy(k)}>${children}<span class="sort-ar">${sort.k === k ? (sort.d === 'asc' ? '▲' : '▼') : '↕'}</span></th>`;
  const sel = useSel();
  const P = app.perms || {};
  const [notice, setNotice] = useState(null); // { o, n } — SMS / письмо клиенту после смены статуса прямо из списка
  const quickStatus = async (o, sid) => {
    const r = await act(() => api(`orders/${o.id}/status`, { body: { status_id: Number(sid) } }), 'Статус изменён');
    if (r.earned) toast(`Клиенту начислено ${r.earned} баллов Pulse Points`);
    if (r.sms || r.email) setNotice({ o, n: { sms: r.sms, email: r.email, sendSms: !!r.sms, sendEmail: !!r.email } });
    reload();
  };
  const [fuOpen, setFuOpen] = useState(null); // окно «Обзвон и комментарии» прямо из списка
  const [decline, setDecline] = useState(null); // выцена, для которой выбрали «Отказался» — нужна причина
  const quickFu = async (o, k, reason) => {
    if (k === 'declined' && !reason) return setDecline({ o, reason: '', custom: '' });
    const d = new Date(); d.setDate(d.getDate() + (k === 'call_back' || k === 'no_answer' ? 1 : k === 'thinking' ? 3 : 0));
    const at = ['call_back', 'no_answer', 'thinking'].includes(k) ? d.toISOString().slice(0, 10) : ['scheduled', 'declined', 'accepted', ''].includes(k) ? null : o.followup_at || null;
    await act(() => api(`orders/${o.id}/followup`, { body: { followup: k, followup_at: at, ...(reason ? { reason } : {}) } }), 'Сохранено');
    setDecline(null); reload();
  };
  const statusOpts = (o) => app.statuses.filter((s) => s.id === o.status_id || (s.scope || 'all') === 'all' || s.scope === kind);
  const bulkActions = [
    P['orders.status'] && { key: 'status', label: 'Сменить статус', icon: 'arrows', input: { label: 'Новый статус', type: 'select', options: app.statuses.filter((s) => (s.scope || 'all') === 'all' || s.scope === kind).map((s) => [s.id, s.name]) }, },
    kind === 'order' && P['orders.edit'] && { key: 'mechanic', label: 'Назначить механика', icon: 'wrench', input: { label: 'Механик', type: 'select', options: [['', '— без механика'], ...app.staff.filter((s) => s.active && s.is_mechanic).map((s) => [s.id, s.name])] } },
    kind === 'quote' && P['quotes.manage'] && { key: 'followup', label: 'Статус обзвона', icon: 'phone', input: { label: 'Обзвон', type: 'select', options: [['', '— без статуса'], ...Object.entries(FOLLOWUP).map(([k, [l]]) => [k, l])] } },
    P['orders.delete'] && { key: 'delete', label: 'Удалить', icon: 'trash', danger: true, confirm: kind === 'quote' ? 'Удалить выбранные выцены?' : 'Удалить выбранные заказы? Заказы с оплатами, выданными со склада запчастями или фактурами будут пропущены.' },
  ].filter(Boolean);
  const csv = [['number', 'Номер'], [(o) => (o.created_at || '').slice(0, 10), 'Создан'], ['status_name', 'Статус'], ['customer_name', 'Клиент'], ['customer_phone', 'Телефон'], [(o) => carName(o), 'Авто'], ['plate', 'Номер авто'], ['total', 'Сумма'], ['paid', 'Оплачено']];
  const base = kind === 'quote' ? '/quotes' : '/orders';
  return html`
    <div class="page-head"><h1>${kind === 'quote' ? 'Выцены' : 'Заказы'}</h1>
      <div class="actions"><a class="btn primary" data-ui="orders.btn.new" href=${'#' + base + '/new'}><${Icon} n="plus" />${kind === 'quote' ? 'Новая выцена' : 'Новый заказ'}</a></div></div>
    <div class="card" style="margin-bottom:12px"><div class="row end">
      <label class="f grow">Поиск<input type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Номер, клиент, телефон, авто, VIN" /></label>
      <label class="f" style="width:220px">Статус<select value=${status} onChange=${(e) => setStatus(e.target.value)}>
        <option value="">Все</option>${kind === 'order' && html`<option value="open">Все открытые</option>`}
        ${app.statuses.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>
      ${kind === 'quote' && html`<label class="f" style="width:190px">Обзвон<select value=${fu} onChange=${(e) => setFu(e.target.value)}><option value="">Все</option><option value="due">Пора связаться (сегодня)</option><option value="none">Без статуса</option>
        ${Object.entries(FOLLOWUP).map(([k, [l]]) => html`<option value=${k}>${l}</option>`)}</select></label>`}
      <label class="f" style="width:150px">С<input type="date" value=${from} onInput=${(e) => setFrom(e.target.value)} /></label>
      <label class="f" style="width:150px">По<input type="date" value=${to} onInput=${(e) => setTo(e.target.value)} /></label>
    </div></div>
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl" data-cols="orders">
      <thead><tr><${SelHead} sel=${sel} rows=${data?.rows || []} /><${Th} k="number">Номер</${Th}><${Th} k="created">Создан</${Th}><${Th} k="status">Статус</${Th}>${kind === 'quote' && html`<${Th} k="followup">Обзвон</${Th}>`}<${Th} k="customer">Клиент</${Th}><${Th} k="car">Авто</${Th}>${kind === 'quote' ? html`<${Th} k="comment" c="intake">Комментарий</${Th}>` : html`<${Th} k="planned" c="intake">Приём</${Th}><${Th} k="comment">Комментарий</${Th}>`}<${Th} k="source">Источник</${Th}>${kind === 'quote' && html`<${Th} k="labor_sum" r=${1}>Работы</${Th}><${Th} k="parts_sum" r=${1}>Запчасти</${Th}>`}<${Th} k="total" r=${1}>${kind === 'quote' ? 'Итого' : 'Сумма'}</${Th}><${Th} k="paid" r=${1}>Оплачено</${Th}></tr></thead>
      <tbody>${(data?.rows || []).map((o) => html`<tr class=${'click' + (sel.has(o.id) ? ' on' : '')} onClick=${() => go(base + '/' + o.id)}>
        <${SelCell} sel=${sel} row=${o} /><td class="nowrap"><b>${o.number}</b>${o.source === 'app' ? html` <span class="chip">app</span>` : ''}</td>
        <td class="nowrap">${fdate(o.created_at)}</td>
        <td onClick=${(e) => e.stopPropagation()}>${P['orders.status'] && !o.locked
          ? html`<select class="status-select list-status" title="Сменить статус" value=${o.status_id || ''} style=${`border-color:${o.status_color || 'var(--border2)'};color:${o.status_color || 'var(--text)'}`}
              onChange=${(e) => quickStatus(o, e.target.value)}>${!o.status_id ? html`<option value="">—</option>` : ''}${statusOpts(o).map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select>`
          : html`<${Badge} color=${o.status_color}>${o.status_name || '—'}</${Badge}>`}</td>
        ${kind === 'quote' && html`<td class="nowrap" onClick=${(e) => e.stopPropagation()}>${P['quotes.manage']
          ? html`<select class="status-select list-status" title="Статус обзвона" value=${o.followup || ''} style=${`border-color:${FOLLOWUP[o.followup]?.[1] || 'var(--border2)'};color:${FOLLOWUP[o.followup]?.[1] || 'var(--muted)'}`}
              onChange=${(e) => quickFu(o, e.target.value)}><option value="">—</option>${Object.entries(FOLLOWUP).map(([k, [l]]) => html`<option value=${k}>${l}</option>`)}</select>`
          : html`<${FuBadge} k=${o.followup} />`}${o.followup_at && !['scheduled', 'declined', 'accepted'].includes(o.followup) ? html`<div class=${'sub ' + (o.followup_at <= new Date().toISOString().slice(0, 10) ? 'neg' : '')}>связаться ${fdate(o.followup_at)}</div>` : ''}${o.followup === 'declined' && o.followup_reason ? html`<div class="sub">${o.followup_reason}</div>` : ''}</td>`}
        <td>${o.customer_name || '—'}<div class="sub">${o.customer_phone || ''}</div></td>
        <td>${carName(o)}${o.plate ? html` <span class="plate">${o.plate}</span>` : ''}</td>
        ${kind === 'quote' ? '' : html`<td class="nowrap sub">${fdt(o.planned_at)}</td>`}
        <td class="sub list-comment" style="max-width:260px" title=${kind === 'quote' ? 'Комментарии и обзвон' : 'Комментарии'} onClick=${(e) => { e.stopPropagation(); setFuOpen(o); }}>
            ${o.last_comment ? html`<span>${o.last_comment}</span>` : html`<span class="faint">+ комментарий</span>`}</td>
        <td class="sub">${o.type_name || ''}</td>
        ${kind === 'quote' && html`<td class="r nowrap">${o.labor_total == null ? '' : zl(o.labor_total)}</td><td class="r nowrap">${o.parts_total == null ? '' : zl(o.parts_total)}</td>`}
        <td class="r nowrap"><b>${zl(o.total)}</b></td>
        <td class="r nowrap ${o.total > 0 && o.paid >= o.total - 0.01 ? 'pos' : o.paid > 0 ? '' : 'faint'}">${o.paid > 0 ? zl(o.paid) : '—'}</td>
      </tr>`)}</tbody>
      ${data?.rows?.length ? html`<tfoot><tr><td colspan=9>Итого по фильтру: ${num(data.total)}</td>${kind === 'quote' && html`<td class="r nowrap" data-c="labor_sum">${data.sumLabor == null ? '' : zl(data.sumLabor)}</td><td class="r nowrap" data-c="parts_sum">${data.sumParts == null ? '' : zl(data.sumParts)}</td>`}<td class="r nowrap">${zl(data.sum)}</td><td></td></tr></tfoot>` : ''}
    </table></div>
    ${!loading && !data?.rows?.length ? html`<div class="empty">Ничего не найдено</div>` : ''}
    ${data && html`<${Pager} page=${page} total=${data.total} size=${data.pageSize} onPage=${setPage} />`}</div>`}
    <${BulkBar} sel=${sel} entity="orders" actions=${bulkActions} csv=${csv} csvName=${kind === 'quote' ? 'wyceny' : 'zlecenia'} onDone=${reload} />
    ${fuOpen && html`<${FollowUpModal} id=${fuOpen.id} number=${fuOpen.number} kind=${kind} onClose=${() => { setFuOpen(null); reload(); }} />`}
    ${decline && html`<${Modal} title=${'Отказался · ' + decline.o.number} onClose=${() => setDecline(null)} foot=${html`
        <button class="btn" onClick=${() => setDecline(null)}>Отмена</button>
        <button class="btn primary" style="margin-left:auto" disabled=${!(decline.reason === 'Другое' ? decline.custom.trim() : decline.reason)} onClick=${() => quickFu(decline.o, 'declined', decline.reason === 'Другое' ? decline.custom.trim() : decline.reason)}>Сохранить</button>`}>
      <label class="f">Причина отказа<select value=${decline.reason} onChange=${(e) => setDecline({ ...decline, reason: e.target.value })}><option value="">— выберите</option>${REASONS.map((r) => html`<option value=${r}>${r}</option>`)}</select></label>
      ${decline.reason === 'Другое' && html`<label class="f">Своя причина<input value=${decline.custom} onInput=${(e) => setDecline({ ...decline, custom: e.target.value })} placeholder="Почему отказался" /></label>`}
    </${Modal}>`}
    ${notice && html`<${StatusNotice} o=${notice.o} n=${notice.n} set=${(n) => setNotice(n ? { ...notice, n } : null)} reload=${reload} />`}`;
}

// ── Выбор клиента и авто (используется и в новом заказе, и в карточке) ─────────
export function CustomerCarPicker({ value, onChange, only }) {
  // onChange принимает функцию от текущего значения — обе половины (авто и клиент) работают с одним состоянием
  const { customer, car } = value;
  const [modal, setModal] = useState(null); // 'customer' | 'car'
  const { data: cust } = useData(customer?.id ? 'customers/' + customer.id : null, [customer?.id]);
  const cname = (c) => (c?.kind === 'company' && c.company ? c.company : c?.name || c?.phone || '—');
  const pickCustomer = async (c) => {
    const full = await api('customers/' + c.id).catch(() => c);
    onChange((v) => {
      let k = v.car;
      // авто ещё не выбрано — берём авто клиента по умолчанию или единственное
      if (!k && full.cars?.length) k = full.cars.find((x) => x.id === full.default_car_id) || (full.cars.length === 1 ? full.cars[0] : null);
      // выбранное авто принадлежит другому клиенту — снимаем его
      if (k && k.customer_id && k.customer_id !== full.id) k = null;
      return { ...v, customer: full, newCustomer: null, car: k || null };
    });
  };
  const pickCar = async (k) => {
    const full = await api('cars/' + k.id).catch(() => k);
    onChange((v) => ({ ...v, car: full, newCar: null, customer: v.customer || full.owner || null }));
  };
  const newCustomerSaved = async (id) => {
    setModal(null);
    const c = await api('customers/' + id);
    const k = value.car;
    // авто уже выбрано и без владельца — сразу привязываем к новому клиенту
    if (k?.id && !k.customer_id) { await api('cars/' + k.id, { method: 'PUT', body: { customer_id: id } }).catch(() => {}); k.customer_id = id; }
    onChange((v) => ({ ...v, customer: c, newCustomer: null, car: v.car || (c.cars?.length === 1 ? c.cars[0] : null) }));
    toast('Клиент добавлен' + (k?.id && k.customer_id === id ? ' и связан с авто' : ''));
  };
  const newCarSaved = async (id) => {
    setModal(null);
    const k = await api('cars/' + id);
    onChange((v) => ({ ...v, car: k, newCar: null, customer: v.customer || k.owner || null }));
    toast('Авто добавлено' + (k.customer_id ? ' и связано с клиентом' : ''));
  };
  const custCol = only === 'car' ? '' : html`<div class="stack">
      ${!only && html`<h3>Клиент</h3>`}
      ${customer ? html`<div class="row"><div class="grow"><b>${cname(customer)}</b>${customer.kind === 'company' && customer.name && customer.name !== customer.company ? html` <span class="sub">${customer.name}</span>` : ''}
            <div class="muted small">${[customer.phone, customer.nip && 'NIP ' + customer.nip].filter(Boolean).join(' · ')}</div></div>
          <a class="btn sm ghost" href=${'#/customers/' + customer.id} target="_blank" title="Открыть карточку клиента"><${Icon} n="users" /></a>
          <button class="btn sm" onClick=${() => onChange((v) => ({ ...v, customer: null, car: v.car && v.car.customer_id === customer.id ? null : v.car }))}>Сменить</button></div>`
        : html`<div class="stack">
            ${value.newCustomer && (value.newCustomer.name || value.newCustomer.phone) ? html`<div class="row small"><span class="grow">Новый клиент: <b>${value.newCustomer.name || ''}</b> ${value.newCustomer.phone || ''}</span>
              <button class="btn sm" onClick=${() => setModal('customer')}>Заполнить карточку</button></div>` : ''}
            <${Picker} placeholder="Имя, телефон, NIP, номер авто…" path=${(q) => 'customers?q=' + encodeURIComponent(q)}
              render=${(c) => html`<b>${cname(c)}</b> <span class="sub">${c.phone || ''}${c.cars ? ' · ' + c.cars : ''}</span>`}
              onPick=${pickCustomer}
              extra=${{ label: 'Новый клиент', onClick: (q) => { onChange((v) => ({ ...v, newCustomer: /\d{6,}/.test(q) ? { name: '', phone: q } : { name: q, phone: '' } })); setModal('customer'); } }} />
            <button class="btn sm" style="align-self:flex-start" onClick=${() => setModal('customer')}><${Icon} n="plus" />Новый клиент</button></div>`}
    </div>`;
  const carCol = only === 'customer' ? '' : html`<div class="stack">
      ${!only && html`<h3>Автомобиль</h3>`}
      ${car ? html`<div class="row"><div class="grow"><b>${carName(car)}</b> ${car.plate ? html`<span class="plate">${car.plate}</span>` : ''}<div class="muted small">${car.vin || ''}</div></div>
          <a class="btn sm ghost" href=${'#/cars/' + car.id} target="_blank" title="Открыть карточку авто"><${Icon} n="car" /></a>
          <button class="btn sm" onClick=${() => onChange((v) => ({ ...v, car: null }))}>Сменить</button></div>`
        : html`<div class="stack">
            ${cust?.cars?.length ? html`<div class="row">${cust.cars.map((k) => html`<button class="btn sm" onClick=${() => onChange((v) => ({ ...v, car: k }))}>${carName(k)} ${k.plate || ''}</button>`)}</div>` : ''}
            <div class="row">
              <div class="grow"><${Picker} placeholder="Найти авто: номер, VIN" path=${(q) => 'cars?q=' + encodeURIComponent(q)}
                render=${(k) => html`<b>${carName(k)}</b> <span class="plate">${k.plate || ''}</span> <span class="sub">${k.owner_name || ''}</span>`}
                onPick=${pickCar} /></div>
              <button class="btn sm" onClick=${() => setModal('car')}><${Icon} n="plus" />Новое авто</button>
            </div></div>`}
    </div>`;
  const modals = html`
    ${modal === 'customer' && html`<${Modal} xl title="Новый клиент" onClose=${() => setModal(null)}>
      <${CustomerEditor} c=${value.newCustomer || {}} onSaved=${newCustomerSaved} onCancel=${() => setModal(null)} /></${Modal}>`}
    ${modal === 'car' && html`<${Modal} xl title=${customer ? 'Новое авто клиента ' + cname(customer) : 'Новый автомобиль'} onClose=${() => setModal(null)}>
      <${CarEditor} k=${{ customer_id: customer?.id || null }} owner0=${customer} onSaved=${newCarSaved} onCancel=${() => setModal(null)} /></${Modal}>`}`;
  return only ? html`${only === 'car' ? carCol : custCol}${modals}` : html`<div class="grid g2">${custCol}${carCol}</div>${modals}`;
}

// ── Новый заказ / выцена ────────────────────────────────────────────────────
export function NewOrder({ kind, query }) {
  return html`
    <div class="crumbs"><a href=${kind === 'quote' ? '#/quotes' : '#/orders'}>${kind === 'quote' ? 'Выцены' : 'Заказы'}</a></div>
    <div class="page-head"><h1>${kind === 'quote' ? 'Новая выцена' : 'Новый заказ'}</h1></div>
    <${OrderMain} isNew kind=${kind} query=${query} onCreate=${(id) => go((kind === 'quote' ? '/quotes/' : '/orders/') + id)} />`;
}

// ── Карточка заказа ────────────────────────────────────────────────────────
export function OrderPage({ id }) {
  const app = useApp();
  const { data: o, loading, error, reload } = useData('orders/' + id);
  const [tab, setTab] = useState('items');
  useEffect(() => { if (location.hash.endsWith('?new=1')) setTab('items'); }, []);
  if (loading && !o) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} />`;
  const isQuote = o.kind === 'quote';
  const due = Math.max(0, o.total - o.paid);
  const [notice, setNotice] = useState(null); // окно с готовой SMS / письмом после смены статуса (как в Motowarsztat)
  const setStatus = async (sid) => {
    const r = await act(() => api(`orders/${o.id}/status`, { body: { status_id: Number(sid) } }), 'Статус изменён');
    if (r.earned) toast(`Клиенту начислено ${r.earned} баллов Pulse Points`);
    if (r.sms || r.email) setNotice({ sms: r.sms, email: r.email, sendSms: !!r.sms, sendEmail: !!r.email });
    reload();
  };
  const tabs = [['main', 'Основное'], ['items', 'Работы и товары'], ['files', 'Файлы и подписи' + (o.files?.length ? ' · ' + o.files.length : '')],
    ...(isQuote ? [] : [...(app.perms['orders.prices'] ? [['pay', 'Оплата и документы' + (due > 0.01 && o.total > 0 ? ' · ' + zl(due) : '')]] : []), ['contact', 'Связь с клиентом'], ['plan', 'Терминарз'], ['check', 'Чек-листы']]),
    ['recs', 'Рекомендации' + ((o.recommendations || []).filter((r) => r.status === 'open').length ? ' · ' + o.recommendations.filter((r) => r.status === 'open').length : '')], ['log', 'История']];
  const vis = tabs.filter(([k]) => uiOn('order.tab.' + k));
  if (vis.length && !vis.some(([k]) => k === tab)) setTimeout(() => setTab(vis[0][0]));
  return html`
    <div class="crumbs"><a href=${isQuote ? '#/quotes' : '#/orders'}>${isQuote ? 'Выцены' : 'Заказы'}</a></div>
    <div class="order-head">
      <div class="title grow">
        <h1>${o.number}
          <select class="status-select" value=${o.status_id} onChange=${(e) => setStatus(e.target.value)} style=${`border-color:${o.status?.color};color:${o.status?.color}`}>
            ${app.statuses.filter((s) => s.id === o.status_id || (s.scope || 'all') === 'all' || s.scope === (isQuote ? 'quote' : 'order')).map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select>${isQuote && o.followup ? html` <${FuBadge} k=${o.followup} />` : ''}</h1>
        <div class="muted">
          ${o.customer ? html`<a href=${'#/customers/' + o.customer.id}>${o.customer.name || o.customer.phone}</a> · <a href=${'tel:' + o.customer.phone}>${o.customer.phone || ''}</a>` : 'Клиент не выбран'}
          ${o.car ? html` · <a href=${'#/cars/' + o.car.id}>${carName(o.car)}</a> <span class="plate">${o.car.plate || ''}</span>` : ''}
          · создан ${fdt(o.created_at)}${o.created_by ? ' · ' + o.created_by : ''}${o.source === 'app' ? ' · из приложения' : ''}${o.quote_id ? html` · <a href=${'#/quotes/' + o.quote_id}>из выцены</a>` : ''}
        </div>
      </div>
      <div class="row">
        <button class="btn" data-ui="order.btn.card" title="Открыть электронную карту (ссылка копируется для клиента)" onClick=${async () => {
          const w = window.open('', '_blank');
          try { const r = await api(`orders/${o.id}/card`, { body: {} }); navigator.clipboard?.writeText(r.url).catch(() => {}); if (w) w.location = r.url; else location.href = r.url; toast('Ссылка на карту скопирована'); }
          catch (e) { w?.close(); toast(e.message, 'error'); } }}><${Icon} n="file" />${isQuote ? 'Электронная выцена' : 'Электронная карта заказа'}</button>
        <span data-ui="order.btn.docs" style="display:contents"><${DocsMenu} o=${o} /></span>
        <button class="btn" data-ui="order.btn.copy" title="Копия с теми же клиентом, авто и позициями" onClick=${async () => { const r = await act(() => api(`orders/${o.id}/copy`, { body: {} }), isQuote ? 'Выцена скопирована' : 'Заказ скопирован'); go((isQuote ? '/quotes/' : '/orders/') + r.id); }}><${Icon} n="file" />Копировать</button>
        ${isQuote && !o.linked_orders?.length && html`<span data-ui="order.btn.toorder" style="display:contents"><${QuoteToOrder} o=${o} /></span>`}
        ${app.perms['orders.delete'] && uiOn('order.btn.delete') && html`<${ConfirmButton} cls="btn danger" onConfirm=${async () => { await act(() => api('orders/' + o.id, { method: 'DELETE' }), 'Удалено'); go(isQuote ? '/quotes' : '/orders'); }}><${Icon} n="trash" /></${ConfirmButton}>`}
      </div>
    </div>
    ${isQuote && o.linked_orders?.length ? html`<div class="card ok-card small" style="margin-bottom:14px">✓ По этой выцене: ${o.linked_orders.map((x, i) => html`${i ? ', ' : ''}${x.how === 'merged' ? 'позиции добавлены в заказ ' : 'создан заказ '}<a href=${'#/orders/' + x.id}><b>${x.number}</b></a>`)} — выцена завершена</div>` : ''}
    ${!isQuote && o.linked_quotes?.length ? html`<div class="muted small" style="margin:-6px 0 12px">Из выцены: ${o.linked_quotes.map((x, i) => html`${i ? ', ' : ''}<a href=${'#/quotes/' + x.id}>${x.number}</a>`)}</div>` : ''}
    <div class="pill-tabs" style="margin-bottom:14px">${vis.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}</div>
    ${app.perms['orders.prices'] && (isQuote ? tab === 'items' : tab === 'pay') && html`<div class="totals" style="margin-bottom:14px">
      <div><span>Итого брутто</span><b>${zl(o.total)}</b></div>
      <div><span>Нетто</span><b>${zl(o.total_net)}</b></div>
      ${!isQuote && html`<div class=${o.total > 0 && due < 0.01 ? 'ok' : ''}><span>Оплачено</span><b>${zl(o.paid)}</b></div>`}
      ${!isQuote && html`<div class=${due > 0.01 ? 'due' : 'ok'}><span>К оплате</span><b>${zl(due)}</b></div>`}
      ${app.perms['products.prices'] && html`<div><span>Маржа на запчастях</span><b>${zl(o.items.filter((i) => i.kind === 'part').reduce((s, i) => s + (i.qty * i.price * (1 - i.discount / 100)) / (1 + i.vat / 100) - i.qty * i.cost, 0))}</b></div>`}
    </div>`}
    ${o.accepted_at && html`<div class="card ok-card small" style="margin-bottom:14px">✓ Клиент подтвердил ${isQuote ? 'выцену' : 'заказ'} по электронной карте ${fdt(o.accepted_at)}${o.accepted_via === 'sms' ? ' (кодом SMS)' : ''}</div>`}
    ${notice && html`<${StatusNotice} o=${o} n=${notice} set=${setNotice} reload=${reload} />`}
    ${tab === 'items' && html`<${ItemsMW} o=${o} reload=${reload} />`}
    ${tab === 'items' && html`<div style="margin-top:14px"><${FollowUp} o=${o} reload=${reload} /></div>`}
    ${tab === 'items' && isQuote && html`<div style="margin-top:14px"><${Contact} o=${o} reload=${reload} /></div>`}
    ${tab === 'main' && html`<${OrderMain} o=${o} reload=${reload} />`}
    ${tab === 'files' && html`<${Intake} o=${o} reload=${reload} />`}
    ${tab === 'pay' && html`<${Payments} o=${o} reload=${reload} />`}
    ${tab === 'plan' && html`<${Plan} o=${o} />`}
    ${tab === 'contact' && html`<${Contact} o=${o} reload=${reload} /><${ContactLog} o=${o} />`}
    ${tab === 'check' && html`<${Checklists} o=${o} />`}
    ${tab === 'recs' && html`<${Recommendations} car=${o.car} orderId=${o.id} recs=${o.recommendations || []} reload=${reload}
      fromChecklist=${isQuote ? null : async () => { const r = await act(() => api(`orders/${o.id}/recommendations/from-checklists`, { body: {} })); toast(r.added ? `Добавлено из чек-листа: ${r.added}` : 'В чек-листах нет пунктов «Внимание» / «Заменить»'); reload(); }} />`}
    ${tab === 'log' && html`<div class="card"><${ObjectHistory} entity="orders" id=${o.id} /></div>`}`;
}
const ACTION = { sms: 'SMS клиенту', email: 'E-mail клиенту', paylink: 'Ссылка на оплату', ic_order: 'Заказ в Inter Cars', invoice_error: 'Ошибка автофактуры', create: 'Создан', update: 'Изменены данные', status: 'Статус →', payment: 'Оплата', payment_delete: 'Удалена оплата', redeem: 'Списаны баллы', invoice: 'Выставлена фактура', proforma: 'Выставлена Pro forma', to_order: 'Создан заказ из выцены', accepted: 'Клиент подтвердил по ссылке', accept_reset: 'Сброшено подтверждение клиента' };

// ── Оплата, баллы, фактура ─────────────────────────────────────────────────
function Payments({ o, reload }) {
  const app = useApp();
  const due = Math.max(0, Math.round((o.total - o.paid) * 100) / 100);
  const [p, setP] = useState({ method: 'card', amount: due || '' });
  const [split, setSplit] = useState({ cash: '', card: '', blik: '', transfer: '' });
  const mixed = p.method === 'mixed';
  const splitSum = Math.round(PAY_KINDS.reduce((a, k) => a + (Number(split[k]) || 0), 0) * 100) / 100;
  const [scan, setScan] = useState(null); // {ticket, limits, client}
  const [scanOpen, setScanOpen] = useState(false);
  const [pts, setPts] = useState('');
  const [askReceipt, setAskReceipt] = useState(0);
  const addPay = async () => {
    const body = mixed ? { split: PAY_KINDS.map((k) => ({ method: k, amount: Number(split[k]) || 0 })).filter((x) => x.amount > 0) } : p;
    const r = await act(() => api(`orders/${o.id}/payments`, { body }), 'Оплата добавлена');
    setP({ ...p, amount: '' }); setSplit({ cash: '', card: '', blik: '', transfer: '' }); reload();
    if (r && app.features.fiscal?.autoOnPay && !(o.receipts || []).some((x) => x.status === 'printed')) setAskReceipt(Date.now());
  };
  const onScan = async (data) => {
    try {
      const r = await api(`orders/${o.id}/scan`, { body: data });
      setScan(r); setScanOpen(false); setPts(r.limits.max ? String(r.limits.max) : '');
    } catch (e) { toast(e.message, 'error'); }
  };
  const redeem = async () => { await act(() => api(`orders/${o.id}/redeem`, { body: { ticket: scan.ticket, points: Number(pts) } }), 'Баллы списаны'); setScan(null); reload(); };
  return html`<div class="grid g2">
    <div class="card">
      <h2>Оплаты</h2>
      ${o.payments.length ? html`<table class="tbl"><tbody>${o.payments.map((x) => html`<tr>
        <td class="nowrap sub">${fdt(x.created_at)}</td><td>${METHOD[x.method]}${x.number ? html` <span class="sub">${x.number}</span>` : ''}<div class="sub">${x.note || ''}</div></td>
        <td class="r nowrap"><b>${zl(x.amount)}</b></td>
        <td class="act">${app.user.role === 'admin' && x.method !== 'points' ? html`<${ConfirmButton} cls="icon-btn" onConfirm=${async () => { await act(() => api(`orders/${o.id}/payments/${x.id}`, { method: 'DELETE' })); reload(); }}><${Icon} n="trash" /></${ConfirmButton}>` : ''}</td></tr>`)}</tbody></table>`
        : html`<div class="muted">Оплат пока нет</div>`}
      <div class="row end" style="margin-top:14px">
        <label class="f">Способ<select value=${p.method} onChange=${(e) => setP({ ...p, method: e.target.value })}>
          ${['card', 'cash', 'blik', 'transfer', 'mixed'].map((k) => html`<option value=${k}>${METHOD[k]}</option>`)}</select></label>
        ${!mixed && html`<label class="f" style="width:140px">Сумма<input type="number" step="0.01" value=${p.amount} onInput=${(e) => setP({ ...p, amount: e.target.value })} /></label>`}
        <button class="btn primary" onClick=${addPay} disabled=${mixed ? !(splitSum > 0) : !(Number(p.amount) > 0)}>Принять оплату${mixed && splitSum > 0 ? ' ' + zl(splitSum) : ''}</button>
      </div>
      ${mixed && html`<div class="pay-split">
        ${PAY_KINDS.map((k) => html`<label class="f">${METHOD[k]}<input type="number" step="0.01" min="0" value=${split[k]} placeholder="0,00"
          onInput=${(e) => setSplit({ ...split, [k]: e.target.value })} /></label>`)}
        <div class="small ${Math.abs(splitSum - due) < 0.01 ? 'pos' : 'muted'}">Итого ${zl(splitSum)} из ${zl(due)}${due - splitSum > 0.01 ? html` · <a href="#" onClick=${(e) => { e.preventDefault(); const k = PAY_KINDS.find((x) => !(Number(split[x]) > 0)) || 'card'; setSplit({ ...split, [k]: String(Math.round((due - splitSum + (Number(split[k]) || 0)) * 100) / 100) }); }}>дополнить остаток</a>` : ''}</div>
      </div>`}
      <${ReceiptBox} o=${o} reload=${reload} ask=${askReceipt} />
      ${!app.features.fiscal && html`<label class="f" style="margin-top:14px;max-width:260px">Номер чека с кассового аппарата<input value=${o.receipt_no || ''} onChange=${async (e) => { await act(() => api('orders/' + o.id, { method: 'PUT', body: { receipt_no: e.target.value } }), 'Сохранено'); }} placeholder="например 000123" /></label>`}
    </div>

    <div class="stack">
      ${app.perms['invoices.create'] ? html`<${SalesDocs} o=${o} reload=${reload} />` : ''}
      <div class="card">
        <h2>Pulse Points</h2>
        ${o.loyalty.length ? html`<div class="stack small" style="margin-bottom:10px">${o.loyalty.map((t) => html`<div>${t.type === 'earn' ? 'Начислено' : t.type === 'redeem' ? 'Списано' : t.type}: <b class=${t.points < 0 ? 'neg' : 'pos'}>${t.points > 0 ? '+' : ''}${t.points}</b> ${t.amount_pln ? '· ' + zl(t.amount_pln) : ''}</div>`)}</div>` : ''}
        ${o.redeem ? html`<div class="muted small" style="margin-bottom:10px">Баланс клиента: <b>${num(o.redeem.balance)}</b> баллов (${o.redeem.tier.name}, ${o.redeem.tier.rate} за 1 zł).
            ${o.customer?.registered_at ? ' При завершении заказа баллы начислятся автоматически.' : ' Клиент ещё не в приложении — баллы не начисляются.'}</div>` : ''}
        ${scan ? html`<div class="stack">
            <div>Клиент подтверждён: <b>${scan.client.name || scan.client.cardNo}</b> · можно списать до <b>${num(scan.limits.max)}</b> баллов (= ${zl(scan.limits.max * scan.limits.pointValuePln)})</div>
            ${scan.limits.max ? html`<div class="row end"><label class="f" style="width:160px">Списать баллов<input type="number" value=${pts} onInput=${(e) => setPts(e.target.value)} min=${scan.limits.min} max=${scan.limits.max} /></label>
              <button class="btn primary" onClick=${redeem}>Списать = ${zl(Number(pts || 0) * scan.limits.pointValuePln)}</button><button class="btn ghost" onClick=${() => setScan(null)}>Отмена</button></div>`
              : html`<div class="muted">Недостаточно баллов (минимум ${scan.limits.min}).</div>`}</div>`
          : html`<button class="btn" onClick=${() => setScanOpen(true)} disabled=${!(o.total > 0)}><${Icon} n="qr" />Оплатить баллами — сканировать QR клиента</button>`}
      </div>

        </div>

    ${scanOpen && html`<${Modal} title="QR клиента" onClose=${() => setScanOpen(false)}><${ScanBox} onResult=${onScan} /></${Modal}>`}

  </div>`;
}

// ── Записи в терминарз для заказа ──────────────────────────────────────────
/** «Создать заказ ▾ / Добавить в заказ» для выцены (как в Motowarsztat) */
function QuoteToOrder({ o }) {
  const [menu, setMenu] = useState(false);
  const [pick, setPick] = useState(false);
  const { data: targets } = useData(pick ? `orders/${o.id}/merge-targets` : null, [pick]);
  return html`<div class="split-btn">
    <button class="btn primary" onClick=${async () => { const r = await act(() => api(`orders/${o.id}/to-order`, { body: {} }), 'Заказ создан, выцена завершена'); go('/orders/' + r.id); }}><${Icon} n="wrench" />Создать заказ</button>
    <button class="btn primary caret" onClick=${() => setMenu(!menu)} aria-label="Ещё"><${Icon} n="down" /></button>
    ${menu && html`<div class="menu-pop"><button onClick=${() => { setMenu(false); setPick(true); }}><${Icon} n="plus" />Добавить в существующий заказ</button></div>`}
    ${pick && html`<${Modal} wide title=${'Добавить ' + o.number + ' в заказ'} onClose=${() => setPick(null)}>
      <div class="muted small" style="margin-bottom:8px">Позиции выцены (${o.items.length}) добавятся в выбранный открытый заказ, выцена станет «завершена» и будет ссылаться на заказ. Сначала — заказы этого клиента / авто.</div>
      ${!targets ? html`<${Loading} />` : !targets.length ? html`<div class="empty">Открытых заказов нет</div>` : html`<table class="tbl"><tbody>${targets.map((t) => html`<tr class="click" onClick=${async () => { const r = await act(() => api(`orders/${o.id}/add-to-order`, { body: { order_id: t.id } }), `Добавлено в ${t.number}: ${o.items.length} поз.`); go('/orders/' + r.id); }}>
        <td><b>${t.number}</b>${t.same ? html` <span class="chip">этот клиент</span>` : ''}<div class="sub">${fdt(t.created_at)}</div></td><td>${t.customer_name || ''}<div class="sub">${[t.make, t.model].filter(Boolean).join(' ')} ${t.plate || ''}</div></td>
        <td>${t.status_name && html`<span class="badge" style=${`border-color:${t.status_color};color:${t.status_color}`}>${t.status_name}</span>`}</td><td class="r nowrap">${zl(t.total)}</td></tr>`)}</tbody></table>`}
    </${Modal}>`}
  </div>`;
}

function Plan({ o }) {
  return html`<div class="card">
    <div class="row" style="margin-bottom:10px"><h2 style="margin:0">Записи на посты</h2>
      <a class="btn sm" style="margin-left:auto" href=${`#/calendar?order=${o.id}`}><${Icon} n="cal" />Открыть терминарз</a></div>
    <div class="muted small" style="margin-bottom:8px">Один заказ можно разбить на части: разные посты / подъёмники и разное время (например, диагностика утром на посту 1, ремонт после обеда на подъёмнике 2).</div>
    <${OrderSlots} orderId=${o.id} />
  </div>`;
}

// ── Поиск детали в Inter Cars: цена, наличие, добавить в заказ, заказать в IC ─
function StatusNotice({ o, n, set, reload }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      if (n.sms && n.sendSms) await act(() => api(`orders/${o.id}/sms`, { body: { text: n.sms.text, kind: 'status' } }), app.features.sms ? 'SMS отправлено' : 'SMS записано в журнал (шлюз не подключён)');
      if (n.email && n.sendEmail) await act(() => api(`orders/${o.id}/email`, { body: { to: n.email.to, subject: n.email.subject, message: n.email.text, plain: true } }), 'Письмо отправлено');
      set(null); reload();
    } finally { setBusy(false); }
  };
  return html`<${Modal} title=${'Сообщить клиенту: ' + (n.sms?.status || '')} onClose=${() => set(null)}
    foot=${html`<button class="btn" onClick=${() => set(null)}>Не отправлять</button><button class="btn primary" disabled=${busy || (!n.sendSms && !n.sendEmail)} onClick=${send}>Отправить</button>`}>
    ${n.sms && html`<label class="check"><input type="checkbox" checked=${n.sendSms} onChange=${(e) => set({ ...n, sendSms: e.target.checked })} />SMS на ${n.sms.phone}</label>
      <textarea rows="6" value=${n.sms.text} onInput=${(e) => set({ ...n, sms: { ...n.sms, text: e.target.value } })}></textarea>
      <${SmsCounter} text=${n.sms.text} />`}
    ${n.email && html`<label class="check" style="margin-top:10px"><input type="checkbox" checked=${n.sendEmail} onChange=${(e) => set({ ...n, sendEmail: e.target.checked })} />E-mail на ${n.email.to}</label>
      <input value=${n.email.subject} onInput=${(e) => set({ ...n, email: { ...n.email, subject: e.target.value } })} />
      <textarea rows="5" style="margin-top:6px" value=${n.email.text} onInput=${(e) => set({ ...n, email: { ...n.email, text: e.target.value } })}></textarea>`}
    ${!app.features.sms && n.sms && html`<div class="muted small">SMS-шлюз не подключён — сообщение попадёт только в журнал SMS. Подключите в Настройки → Интеграции.</div>`}
  </${Modal}>`;
}

/** Сколько SMS займёт текст (без польских букв — 160 знаков) */
export function SmsCounter({ text }) {
  const t = String(text || '').replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, 'a');
  const gsm = /^[\x0A\x0D\x20-\x7E]*$/.test(t);
  const parts = !t ? 0 : gsm ? (t.length <= 160 ? 1 : Math.ceil(t.length / 153)) : (t.length <= 70 ? 1 : Math.ceil(t.length / 67));
  return html`<div class="muted small">${t.length} знаков · ${parts} SMS${gsm ? '' : ' (есть спецсимволы — 70 знаков на SMS)'}</div>`;
}

/** История связи с клиентом по заказу: SMS (позже — WhatsApp, Telegram, Instagram, звонки) */
function ContactLog({ o }) {
  const app = useApp();
  const { data } = useData(app.perms['sms.view'] ? `sms?order=${o.id}&customer=${o.customer_id || ''}` : null, [o.id]);
  if (!app.perms['sms.view']) return '';
  const ST = { sent: ['отправлено', 'pos'], failed: ['ошибка', 'neg'], logged: ['только в журнале', 'muted'] };
  return html`<div class="card" style="margin-top:14px"><h2>История сообщений</h2>
    ${data?.rows?.length ? html`<table class="tbl"><tbody>${data.rows.map((m) => html`<tr><td class="nowrap sub">${fdt(m.created_at)}</td><td class="nowrap"><span class="chip">SMS</span></td>
      <td style="white-space:pre-wrap">${m.text}${m.error ? html`<div class="sub neg">${m.error}</div>` : ''}</td><td class="nowrap sub">${m.phone}</td><td class=${'nowrap small ' + (ST[m.status]?.[1] || '')}>${ST[m.status]?.[0] || m.status}</td><td class="sub nowrap">${m.staff || ''}</td></tr>`)}</tbody></table>`
      : html`<div class="muted small">По этому заказу сообщений ещё не было.</div>`}</div>`;
}
function Contact({ o, reload }) {
  const app = useApp();
  const [sms, setSms] = useState(null);
  const [mail, setMail] = useState(null);
  const [link, setLink] = useState('');
  const due = Math.max(0, Math.round((o.total - o.paid) * 100) / 100);
  const f = app.features;
  const isQuote = o.kind === 'quote';
  const getLink = async () => { const r = await act(() => api(`orders/${o.id}/card`, { body: {} })); setLink(r.url); return r.url; };
  const smsTpl = async (kind) => { const r = await act(() => api(`orders/${o.id}/template?kind=${kind}`)); setSms(r.text); };
  const mailTpl = async () => {
    const r = await act(() => api(`orders/${o.id}/template?kind=${isQuote ? 'mail_quote' : 'mail_order'}`));
    setMail({ to: o.customer?.email || '', subject: r.subject, message: r.text, invoice: !!o.invoice_ext_id });
  };
  return html`<div class="card">
    <h2>Связь с клиентом</h2>
    <div class="row">
      <button class="btn" onClick=${async () => { const u = link || await getLink(); navigator.clipboard?.writeText(u).then(() => toast('Ссылка скопирована')).catch(() => {}); }}><${Icon} n="file" />${isQuote ? 'Ссылка на выцену' : 'Электронная карта заказа'}</button>
      ${link && html`<a class="btn ghost" href=${link} target="_blank" rel="noopener"><${Icon} n="external" />Открыть</a>`}
      ${o.customer?.phone && html`<button class="btn" onClick=${() => smsTpl(isQuote ? 'quote' : 'card')}>SMS ${isQuote ? 'со выценой' : 'с картой заказа'}</button>`}
      ${o.customer?.phone && html`<button class="btn ghost" onClick=${() => setSms('')}>SMS клиенту</button>`}
      ${f.tpay && due > 0 && !isQuote && html`<button class="btn" onClick=${async () => { const r = await act(() => api(`orders/${o.id}/paylink`, { body: { sms: f.sms } }), f.sms ? 'Ссылка на оплату отправлена SMS' : 'Ссылка создана'); reload(); if (r?.url) navigator.clipboard?.writeText(r.url).catch(() => {}); }}>Ссылка на оплату ${zl(due)}</button>`}
      ${o.pay_link && html`<button class="btn ghost" onClick=${async () => { const r = await act(() => api(`orders/${o.id}/paylink/check`, { body: {} })); toast(r.status === 'paid' ? 'Оплачено онлайн' : 'Пока не оплачено'); reload(); }}>Проверить оплату</button>`}
      ${f.email && html`<button class="btn" onClick=${mailTpl}>E-mail клиенту</button>`}
    </div>
    ${o.accepted_at ? html`<div class="small" style="margin-top:8px">✓ Подтверждено клиентом ${fdt(o.accepted_at)} · <a href="#" onClick=${async (e) => { e.preventDefault(); await act(() => api(`orders/${o.id}/accept-reset`, { body: {} }), 'Подтверждение сброшено'); reload(); }}>сбросить (если выцена изменилась)</a></div>`
      : html`<div class="muted small" style="margin-top:8px">Клиент открывает карту по ссылке, видит работы и цены и нажимает «Akceptuję».</div>`}
    ${o.pay_link && html`<div class="small muted" style="margin-top:8px">Ссылка на оплату: <code style="user-select:all;word-break:break-all">${o.pay_link}</code></div>`}
    ${!f.sms && html`<div class="muted small" style="margin-top:6px">SMS-шлюз не подключён: сообщения попадут только в журнал. <a href="#/settings/integrations">Подключить</a></div>`}
    ${sms !== null && html`<${Modal} title="SMS клиенту" onClose=${() => setSms(null)} foot=${html`<button class="btn primary" disabled=${!sms.trim()} onClick=${async () => { await act(() => api(`orders/${o.id}/sms`, { body: { text: sms } }), 'SMS отправлено'); setSms(null); reload(); }}>Отправить на ${o.customer.phone}</button>`}>
      <div class="row" style="margin-bottom:6px"><span class="muted small">Шаблон:</span>
        ${[['card', 'Карта заказа'], ['quote', 'Выцена'], ...(o.pay_link ? [['paylink', 'Оплата']] : []), ['review', 'Отзыв']].map(([k, l]) => html`<button class="btn ghost sm" onClick=${() => smsTpl(k)}>${l}</button>`)}
        ${app.statuses.filter((st) => st.sms_template).map((st) => html`<button class="btn ghost sm" onClick=${() => smsTpl('status:' + st.id)}>${st.name}</button>`)}</div>
      <textarea rows="6" value=${sms} onInput=${(e) => setSms(e.target.value)}></textarea><${SmsCounter} text=${sms} /></${Modal}>`}
    ${mail && html`<${Modal} title="E-mail клиенту" onClose=${() => setMail(null)} foot=${html`<button class="btn primary" onClick=${async () => { await act(() => api(`orders/${o.id}/email`, { body: mail }), 'Письмо отправлено'); setMail(null); }}>Отправить</button>`}>
      <label class="f">Кому<input type="email" value=${mail.to} onInput=${(e) => setMail({ ...mail, to: e.target.value })} /></label>
      <label class="f">Тема<input value=${mail.subject} onInput=${(e) => setMail({ ...mail, subject: e.target.value })} /></label>
      <label class="f">Текст<textarea rows="6" value=${mail.message} onInput=${(e) => setMail({ ...mail, message: e.target.value })}></textarea></label>
      ${o.invoice_ext_id && html`<label class="check"><input type="checkbox" checked=${mail.invoice} onChange=${(e) => setMail({ ...mail, invoice: e.target.checked })} />Приложить фактуру ${o.invoice_no} (PDF)</label>`}
      <div class="muted small">Ниже текста в письме — список работ и запчастей и итоговая сумма.</div></${Modal}>`}
  </div>`;
}

// ── Чек-листы (Listy kontrolne): осмотр при приёме, ТО и т. д. ──────────────
function Checklists({ o }) {
  const { data, reload } = useData(`orders/${o.id}/checklists`);
  if (!data) return html`<${Loading} />`;
  const save = async (c, results) => { await act(() => api(`orders/${o.id}/checklists`, { body: { id: c.id, results } })); reload(); };
  const ST = [['ok', '✓ OK', 'pos'], ['warn', '! Внимание', 'warn'], ['bad', '✗ Заменить', 'neg']];
  return html`<div class="stack">
    <div class="card row"><span class="muted small">Добавить чек-лист:</span>
      ${data.templates.map((t) => html`<button class="btn sm" onClick=${async () => { await act(() => api(`orders/${o.id}/checklists`, { body: { checklist_id: t.id } })); reload(); }}>${t.name}</button>`)}
      ${!data.templates.length && html`<span class="muted small">Создайте чек-листы в Настройки → Чек-листы</span>`}</div>
    ${data.filled.map((c) => html`<div class="card tight"><div class="row" style="padding:12px 14px"><h2 style="margin:0">${c.name}</h2><span class="muted small">${c.staff || ''} ${fdt(c.updated_at)}</span></div>
      <table class="tbl"><tbody>${c.results.map((r, i) => html`<tr><td>${r.item}</td>
        <td class="nowrap">${ST.map(([k, l, cls]) => html`<button class=${'btn sm ' + (r.state === k ? cls + ' on-state' : 'ghost')} style="margin-right:4px" onClick=${() => save(c, c.results.map((x, j) => (j === i ? { ...x, state: x.state === k ? '' : k } : x)))}>${l}</button>`)}</td>
        <td><input class="inline-input" placeholder="Заметка" value=${r.note} onChange=${(e) => save(c, c.results.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} /></td></tr>`)}</tbody></table></div>`)}
  </div>`;
}

/** «Обзвон и комментарии» выцены в окне — из списка, не открывая выцену */
function FollowUpModal({ id, number, kind = 'quote', onClose }) {
  const { data: o, reload } = useData('orders/' + id, [id]);
  const q = kind === 'quote';
  return html`<${Modal} wide title=${(q ? 'Обзвон и комментарии · ' : 'Комментарии · ') + number} onClose=${onClose} foot=${html`
      <a class="btn ghost" href=${(q ? '#/quotes/' : '#/orders/') + id} onClick=${onClose}>${q ? 'Открыть выцену' : 'Открыть заказ'}</a><button class="btn" style="margin-left:auto" onClick=${onClose}>Закрыть</button>`}>
    ${o ? html`<div class="muted small">${o.customer?.name || ''}${o.customer?.phone ? html` · <a href=${'tel:' + o.customer.phone}>${o.customer.phone}</a>` : ''}${o.car ? ' · ' + carName(o.car) : ''} · ${zl(o.total)}</div>
      <${FollowUp} o=${o} reload=${reload} />` : html`<${Loading} />`}
  </${Modal}>`;
}

// ── Выцена: статус обзвона, причина, когда связаться и комментарии (история разговоров) ──
function FollowUp({ o, reload }) {
  const [f, set] = useState({ followup: o.followup || '', reason: o.followup_reason || '', followup_at: o.followup_at || '', text: '' });
  useEffect(() => set({ followup: o.followup || '', reason: o.followup_reason || '', followup_at: o.followup_at || '', text: '' }), [o.followup, o.followup_reason, o.followup_at, (o.comments || []).length]);
  const reasonPreset = REASONS.includes(f.reason) ? f.reason : f.reason ? 'Другое' : '';
  const changed = f.text.trim() || f.followup !== (o.followup || '') || f.reason !== (o.followup_reason || '') || (f.followup_at || '') !== (o.followup_at || '');
  const save = async () => {
    await act(() => api(`orders/${o.id}/followup`, { body: { ...f, followup_at: f.followup_at || null } }), 'Сохранено');
    reload();
  };
  const quick = (k) => { const d = new Date(); d.setDate(d.getDate() + (k === 'call_back' || k === 'no_answer' ? 1 : k === 'thinking' ? 3 : 0)); set({ ...f, followup: k, followup_at: ['call_back', 'no_answer', 'thinking'].includes(k) ? d.toISOString().slice(0, 10) : k === 'scheduled' || k === 'declined' || k === 'accepted' ? '' : f.followup_at }); };
  const plain = o.kind !== 'quote'; // у заказа — только комментарии, без статусов обзвона
  return html`<div class="card fu">
    <div class="row"><h2 class="grow" style="margin:0">${plain ? 'Комментарии' : 'Обзвон и комментарии'}</h2>${o.followup ? html`<${FuBadge} k=${o.followup} />` : ''}</div>
    ${!plain && html`<div class="fu-states">${Object.entries(FOLLOWUP).map(([k, [l, c]]) => html`<button class=${'fu-st' + (f.followup === k ? ' on' : '')} style=${f.followup === k ? `background:${c}26;border-color:${c};color:${c}` : ''} onClick=${() => quick(k)}><i style=${'background:' + c}></i>${l}</button>`)}</div>
    <div class="grid g3">
      ${f.followup === 'declined' ? html`<label class="f">Причина отказа<select value=${reasonPreset} onChange=${(e) => set({ ...f, reason: e.target.value === 'Другое' ? (REASONS.includes(f.reason) ? '' : f.reason) || ' ' : e.target.value })}>
          <option value="">— выберите</option>${REASONS.map((r) => html`<option value=${r}>${r}</option>`)}</select></label>
        ${reasonPreset === 'Другое' || (f.reason && !REASONS.includes(f.reason)) ? html`<label class="f">Своя причина<input value=${f.reason.trim()} onInput=${(e) => set({ ...f, reason: e.target.value })} placeholder="Почему отказался" /></label>` : html`<span></span>`}`
        : html`<label class="f">Когда связаться<input type="date" value=${f.followup_at || ''} onInput=${(e) => set({ ...f, followup_at: e.target.value })} /></label><span></span>`}
      <span></span>
    </div>`}
    <label class="f">Комментарий<textarea rows="2" value=${f.text} onInput=${(e) => set({ ...f, text: e.target.value })} placeholder="О чём договорились, что сказал клиент…"></textarea></label>
    <div class="row"><span class="grow"></span><button class="btn primary" disabled=${!changed} onClick=${save}>Сохранить</button></div>
    ${(o.comments || []).length ? html`<div class="fu-log">${o.comments.map((c) => html`<div class="fu-item">
      <div class="fu-meta"><b>${fdt(c.at)}</b> <span class="muted">${c.staff || ''}</span>${c.followup ? html` <${FuBadge} k=${c.followup} />` : ''}${c.reason ? html` <span class="small">${c.reason}</span>` : ''}${c.followup_at ? html` <span class="faint small">→ связаться ${fdate(c.followup_at)}</span>` : ''}
        <button class="icon-btn sm" title="Удалить" style="margin-left:auto" onClick=${async () => { await act(() => api(`orders/${o.id}/comments/${c.id}`, { method: 'DELETE' })); reload(); }}><${Icon} n="x" /></button></div>
      ${c.text ? html`<div class="fu-text">${c.text}</div>` : ''}</div>`)}</div>` : html`<div class="muted small">Комментариев пока нет</div>`}
  </div>`;
}
