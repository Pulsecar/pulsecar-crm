import {
  html, useState, useEffect, useData, api, act, go, qs, useApp, Loading, ErrorBox, Badge, Icon, Modal, Field, Pager, Picker,
  ConfirmButton, useDebounced, zl, num, fdate, fdt, carName, METHOD, toast,
} from '../lib.js';
import { AztecButton, PlateButton, mergeCar } from '../vehicle.js';
import { ScanBox } from '../scan.js';

const FLAGS = [['return_parts', 'Вернуть детали клиенту'], ['reg_doc', 'Техпаспорт оставлен'], ['test_drive', 'Согласие на тест-драйв'], ['fluids', 'Долить жидкости'], ['lights', 'Проверить освещение']];
const FUEL = ['', 'резерв', '1/4', '1/2', '3/4', 'полный'];

// ── Список ────────────────────────────────────────────────────────────────
export function OrdersList({ kind, query }) {
  const app = useApp();
  const [q, setQ] = useState(query.q || '');
  const [status, setStatus] = useState(query.status || (kind === 'order' ? 'open' : ''));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const dq = useDebounced(q);
  useEffect(() => setPage(0), [dq, status, from, to]);
  const { data, loading, error } = useData('orders?' + qs({ kind, q: dq, status, from, to, page }));
  const base = kind === 'quote' ? '/quotes' : '/orders';
  return html`
    <div class="page-head"><h1>${kind === 'quote' ? 'Сметы' : 'Заказы'}</h1>
      <div class="actions"><a class="btn primary" href=${'#' + base + '/new'}><${Icon} n="plus" />${kind === 'quote' ? 'Новая смета' : 'Новый заказ'}</a></div></div>
    <div class="card" style="margin-bottom:12px"><div class="row end">
      <label class="f grow">Поиск<input type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Номер, клиент, телефон, авто, VIN" /></label>
      <label class="f" style="width:220px">Статус<select value=${status} onChange=${(e) => setStatus(e.target.value)}>
        <option value="">Все</option>${kind === 'order' && html`<option value="open">Все открытые</option>`}
        ${app.statuses.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>
      <label class="f" style="width:150px">С<input type="date" value=${from} onInput=${(e) => setFrom(e.target.value)} /></label>
      <label class="f" style="width:150px">По<input type="date" value=${to} onInput=${(e) => setTo(e.target.value)} /></label>
    </div></div>
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Номер</th><th>Создан</th><th>Статус</th><th>Клиент</th><th>Авто</th><th>Приём</th><th>Источник</th><th class="r">Сумма</th><th class="r">Оплачено</th></tr></thead>
      <tbody>${(data?.rows || []).map((o) => html`<tr class="click" onClick=${() => go(base + '/' + o.id)}>
        <td class="nowrap"><b>${o.number}</b>${o.source === 'app' ? html` <span class="chip">app</span>` : ''}</td>
        <td class="nowrap">${fdate(o.created_at)}</td>
        <td><${Badge} color=${o.status_color}>${o.status_name || '—'}</${Badge}></td>
        <td>${o.customer_name || '—'}<div class="sub">${o.customer_phone || ''}</div></td>
        <td>${carName(o)}${o.plate ? html` <span class="plate">${o.plate}</span>` : ''}</td>
        <td class="nowrap sub">${fdt(o.planned_at)}</td>
        <td class="sub">${o.type_name || ''}</td>
        <td class="r nowrap"><b>${zl(o.total)}</b></td>
        <td class="r nowrap ${o.total > 0 && o.paid >= o.total - 0.01 ? 'pos' : o.paid > 0 ? '' : 'faint'}">${o.paid > 0 ? zl(o.paid) : '—'}</td>
      </tr>`)}</tbody>
      ${data?.rows?.length ? html`<tfoot><tr><td colspan="7">Итого по фильтру: ${num(data.total)}</td><td class="r nowrap">${zl(data.sum)}</td><td></td></tr></tfoot>` : ''}
    </table></div>
    ${!loading && !data?.rows?.length ? html`<div class="empty">Ничего не найдено</div>` : ''}
    ${data && html`<${Pager} page=${page} total=${data.total} size=${data.pageSize} onPage=${setPage} />`}</div>`}`;
}

// ── Выбор клиента и авто (используется и в новом заказе, и в карточке) ─────────
export function CustomerCarPicker({ value, onChange }) {
  const { customer, car } = value;
  const [newC, setNewC] = useState(null);
  const [newCar, setNewCar] = useState(null);
  const { data: cust } = useData(customer?.id ? 'customers/' + customer.id : null, [customer?.id]);
  return html`<div class="grid g2">
    <div class="stack">
      <h3>Клиент</h3>
      ${customer ? html`<div class="row"><div class="grow"><b>${customer.name || '—'}</b><div class="muted small">${customer.phone || ''}</div></div>
          <button class="btn sm" onClick=${() => onChange({ customer: null, car: null })}>Сменить</button></div>`
        : newC ? html`<div class="stack">
            <div class="grid g2"><label class="f">Имя и фамилия<input value=${newC.name} onInput=${(e) => { const n = { ...newC, name: e.target.value }; setNewC(n); onChange({ ...value, newCustomer: n }); }} /></label>
            <label class="f">Телефон<input value=${newC.phone} onInput=${(e) => { const n = { ...newC, phone: e.target.value }; setNewC(n); onChange({ ...value, newCustomer: n }); }} placeholder="+48" /></label></div>
            <button class="btn ghost sm" style="align-self:flex-start" onClick=${() => { setNewC(null); onChange({ ...value, newCustomer: null }); }}>Отмена — выбрать из базы</button></div>`
        : html`<${Picker} placeholder="Имя, телефон, номер авто…" path=${(q) => 'customers?q=' + encodeURIComponent(q)}
            render=${(c) => html`<b>${c.name || '—'}</b> <span class="sub">${c.phone || ''}${c.cars ? ' · ' + c.cars : ''}</span>`}
            onPick=${(c) => onChange({ customer: c, car: null })}
            extra=${{ label: 'Новый клиент', onClick: (q) => { const n = /\d{6,}/.test(q) ? { name: '', phone: q } : { name: q, phone: '' }; setNewC(n); onChange({ ...value, newCustomer: n }); } }} />`}
    </div>
    <div class="stack">
      <h3>Автомобиль</h3>
      ${car ? html`<div class="row"><div class="grow"><b>${carName(car)}</b> ${car.plate ? html`<span class="plate">${car.plate}</span>` : ''}<div class="muted small">${car.vin || ''}</div></div>
          <button class="btn sm" onClick=${() => onChange({ ...value, car: null })}>Сменить</button></div>`
        : newCar ? html`<div class="grid g2">
            ${[['plate', 'Номер'], ['vin', 'VIN'], ['make', 'Марка'], ['model', 'Модель'], ['year', 'Год']].map(([k, l]) => html`<div class="row end" style="gap:6px"><label class="f grow">${l}<input value=${newCar[k] || ''} onInput=${(e) => { const n = { ...newCar, [k]: e.target.value }; setNewCar(n); onChange({ ...value, newCar: n }); }} /></label>
              ${k === 'plate' && html`<${PlateButton} plate=${newCar.plate} onData=${(r) => { const n = mergeCar(newCar, r); setNewCar(n); onChange({ ...value, newCar: n }); }} />`}</div>`)}
            <button class="btn ghost sm" style="align-self:end" onClick=${() => { setNewCar(null); onChange({ ...value, newCar: null }); }}>Отмена</button></div>`
        : html`<div class="stack">
            ${cust?.cars?.length ? html`<div class="row">${cust.cars.map((k) => html`<button class="btn sm" onClick=${() => onChange({ ...value, car: k })}>${carName(k)} ${k.plate || ''}</button>`)}</div>` : ''}
            <div class="row">
              <div class="grow"><${Picker} placeholder="Найти авто: номер, VIN" path=${(q) => 'cars?q=' + encodeURIComponent(q)}
                render=${(k) => html`<b>${carName(k)}</b> <span class="plate">${k.plate || ''}</span> <span class="sub">${k.owner_name || ''}</span>`}
                onPick=${(k) => onChange({ ...value, car: k })} /></div>
              <button class="btn sm" onClick=${() => setNewCar({ plate: '', vin: '', make: '', model: '', year: '' })}><${Icon} n="plus" />Новое авто</button>
              <${AztecButton} label="Техпаспорт" onData=${async (r) => {
                if (r.existing) {
                  const k = await api('cars/' + r.existing.id);
                  const patch = { ...value, car: k };
                  if (!customer && k.owner) patch.customer = await api('customers/' + k.owner.id);
                  onChange(patch);
                  return;
                }
                const n = mergeCar({}, r.car);
                setNewCar(n);
                const patch = { ...value, newCar: n };
                if (!customer && !newC && r.owner?.name) { const nc = { name: r.owner.name, phone: '', street: r.owner.street, postcode: r.owner.postcode, city: r.owner.city }; setNewC(nc); patch.newCustomer = nc; }
                onChange(patch);
              }} />
            </div></div>`}
    </div></div>`;
}

// ── Новый заказ / смета ────────────────────────────────────────────────────
export function NewOrder({ kind, query }) {
  const app = useApp();
  const [cc, setCc] = useState({ customer: null, car: null });
  const [f, set] = useState({ complaint: query.note || '', type_id: '', mechanic_id: '', mileage: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (query.customer_id) api('customers/' + query.customer_id).then((c) => setCc((v) => ({ ...v, customer: c, car: query.car_id ? c.cars.find((k) => String(k.id) === query.car_id) || null : null })));
    else if (query.name || query.phone) setCc((v) => ({ ...v, newCustomer: { name: query.name || '', phone: query.phone || '' } }));
  }, []);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await act(() => api('orders', { body: {
        kind, customer_id: cc.customer?.id, car_id: cc.car?.id, new_customer: cc.customer ? null : cc.newCustomer, new_car: cc.car ? null : cc.newCar,
        complaint: f.complaint, type_id: f.type_id || null, mechanic_id: f.mechanic_id || null, mileage: f.mileage || null,
        appointment_id: query.appointment_id || null, source: query.appointment_id ? undefined : 'crm',
      } }));
      go((kind === 'quote' ? '/quotes/' : '/orders/') + r.id);
    } finally { setBusy(false); }
  };
  return html`
    <div class="crumbs"><a href=${kind === 'quote' ? '#/quotes' : '#/orders'}>${kind === 'quote' ? 'Сметы' : 'Заказы'}</a></div>
    <div class="page-head"><h1>${kind === 'quote' ? 'Новая смета' : 'Новый заказ'}</h1></div>
    <div class="card"><${CustomerCarPicker} value=${cc} onChange=${setCc} /></div>
    <div class="card"><div class="grid g4">
      <label class="f">Пробег, км<input type="number" value=${f.mileage} onInput=${(e) => set({ ...f, mileage: e.target.value })} /></label>
      <label class="f">Источник<select value=${f.type_id} onChange=${(e) => set({ ...f, type_id: e.target.value })}><option value="">—</option>${app.types.map((t) => html`<option value=${t.id}>${t.name}</option>`)}</select></label>
      <label class="f">Механик<select value=${f.mechanic_id} onChange=${(e) => set({ ...f, mechanic_id: e.target.value })}><option value="">—</option>${app.staff.filter((s) => s.active).map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>
    </div>
    <label class="f" style="margin-top:12px">Что беспокоит клиента / что сделать<textarea rows="3" value=${f.complaint} onInput=${(e) => set({ ...f, complaint: e.target.value })}></textarea></label>
    <div class="row" style="margin-top:14px"><button class="btn primary lg" disabled=${busy} onClick=${submit}>Создать ${kind === 'quote' ? 'смету' : 'заказ'}</button>
      <span class="muted small">Работы и запчасти добавите на следующем шаге</span></div></div>`;
}

// ── Карточка заказа ────────────────────────────────────────────────────────
export function OrderPage({ id }) {
  const app = useApp();
  const { data: o, loading, error, reload } = useData('orders/' + id);
  const [tab, setTab] = useState('items');
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
  const tabs = [['items', 'Работы и запчасти'], ['main', 'Данные заказа'], ...(isQuote ? [] : [['pay', 'Оплата' + (due > 0.01 && o.total > 0 ? ' · ' + zl(due) : '')], ['plan', 'Терминарз']]), ['log', 'История']];
  return html`
    <div class="crumbs"><a href=${isQuote ? '#/quotes' : '#/orders'}>${isQuote ? 'Сметы' : 'Заказы'}</a></div>
    <div class="order-head">
      <div class="title grow">
        <h1>${o.number}
          <select class="status-select" value=${o.status_id} onChange=${(e) => setStatus(e.target.value)} style=${`border-color:${o.status?.color};color:${o.status?.color}`}>
            ${app.statuses.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></h1>
        <div class="muted">
          ${o.customer ? html`<a href=${'#/customers/' + o.customer.id}>${o.customer.name || o.customer.phone}</a> · <a href=${'tel:' + o.customer.phone}>${o.customer.phone || ''}</a>` : 'Клиент не выбран'}
          ${o.car ? html` · <a href=${'#/cars/' + o.car.id}>${carName(o.car)}</a> <span class="plate">${o.car.plate || ''}</span>` : ''}
          · создан ${fdt(o.created_at)}${o.created_by ? ' · ' + o.created_by : ''}${o.source === 'app' ? ' · из приложения' : ''}${o.quote_id ? html` · <a href=${'#/quotes/' + o.quote_id}>из сметы</a>` : ''}
        </div>
      </div>
      <div class="row">
        <a class="btn" href=${'/crm-api/print/order/' + o.id} target="_blank" rel="noopener"><${Icon} n="print" />Печать</a>
        ${isQuote && html`<button class="btn primary" onClick=${async () => { const r = await act(() => api(`orders/${o.id}/to-order`, { body: {} }), 'Заказ создан'); go('/orders/' + r.id); }}>Превратить в заказ</button>`}
        ${app.user.role === 'admin' && html`<${ConfirmButton} cls="btn danger" onConfirm=${async () => { await act(() => api('orders/' + o.id, { method: 'DELETE' }), 'Удалено'); go(isQuote ? '/quotes' : '/orders'); }}><${Icon} n="trash" /></${ConfirmButton}>`}
      </div>
    </div>
    <div class="totals" style="margin-bottom:14px">
      <div><span>Итого брутто</span><b>${zl(o.total)}</b></div>
      <div><span>Нетто</span><b>${zl(o.total_net)}</b></div>
      ${!isQuote && html`<div class=${o.total > 0 && due < 0.01 ? 'ok' : ''}><span>Оплачено</span><b>${zl(o.paid)}</b></div>`}
      ${!isQuote && html`<div class=${due > 0.01 ? 'due' : 'ok'}><span>К оплате</span><b>${zl(due)}</b></div>`}
      ${app.user.role !== 'mechanic' && html`<div><span>Маржа на запчастях</span><b>${zl(o.items.filter((i) => i.kind === 'part').reduce((s, i) => s + (i.qty * i.price * (1 - i.discount / 100)) / (1 + i.vat / 100) - i.qty * i.cost, 0))}</b></div>`}
    </div>
    <div class="pill-tabs" style="margin-bottom:14px">${tabs.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}</div>
    ${o.accepted_at && html`<div class="card ok-card small" style="margin-bottom:14px">✓ Клиент подтвердил ${isQuote ? 'смету' : 'заказ'} по электронной карте ${fdt(o.accepted_at)}${o.accepted_via === 'sms' ? ' (кодом SMS)' : ''}</div>`}
    ${notice && html`<${StatusNotice} o=${o} n=${notice} set=${setNotice} reload=${reload} />`}
    ${tab === 'items' && html`<${Items} o=${o} reload=${reload} />`}
    ${tab === 'items' && isQuote && html`<div style="margin-top:14px"><${Contact} o=${o} reload=${reload} /></div>`}
    ${tab === 'main' && html`<${MainData} o=${o} reload=${reload} />`}
    ${tab === 'pay' && html`<${Payments} o=${o} reload=${reload} />`}
    ${tab === 'plan' && html`<${Plan} o=${o} />`}
    ${tab === 'log' && html`<div class="card"><table class="tbl"><tbody>${o.activity.map((a) => html`<tr><td class="nowrap sub">${fdt(a.created_at)}</td><td>${ACTION[a.action] || a.action} ${a.action === 'status' ? html`<b>${JSON.parse(a.details || '""')}</b>` : ''}</td><td class="sub">${a.staff || ''}</td></tr>`)}</tbody></table></div>`}`;
}
const ACTION = { sms: 'SMS клиенту', email: 'E-mail клиенту', paylink: 'Ссылка на оплату', ic_order: 'Заказ в Inter Cars', invoice_error: 'Ошибка автофактуры', create: 'Создан', update: 'Изменены данные', status: 'Статус →', payment: 'Оплата', payment_delete: 'Удалена оплата', redeem: 'Списаны баллы', invoice: 'Выставлена фактура', to_order: 'Создан заказ из сметы', accepted: 'Клиент подтвердил по ссылке', accept_reset: 'Сброшено подтверждение клиента' };

// ── Позиции ────────────────────────────────────────────────────────────────
function Items({ o, reload }) {
  const app = useApp();
  const [ic, setIc] = useState(false);
  const mech = app.user.role === 'mechanic';
  const labor = o.items.filter((i) => i.kind === 'labor');
  const parts = o.items.filter((i) => i.kind === 'part');
  const add = async (it) => { await act(() => api(`orders/${o.id}/items`, { body: it })); reload(); };
  const save = async (it, patch) => { await act(() => api(`orders/${o.id}/items/${it.id}`, { method: 'PUT', body: patch })); reload(); };
  const del = async (it) => { await act(() => api(`orders/${o.id}/items/${it.id}`, { method: 'DELETE' })); reload(); };
  const discL = o.customer?.discount_labor || 0;
  const discP = o.customer?.discount_parts || 0;
  return html`
    <div class="card tight">
      <div class="row" style="padding:12px 14px"><h2 style="margin:0">Работы</h2><span class="muted small">${num(labor.reduce((s, i) => s + i.qty, 0), 2)} н/ч</span>
        ${!mech && html`<div class="grow" style="max-width:520px;margin-left:auto"><${Picker} placeholder="+ Добавить работу из прайса или новую…" path=${(q) => 'catalog?q=' + encodeURIComponent(q)}
          render=${(c) => html`<b>${c.name}</b> <span class="sub">${c.category || ''} · ${c.qty} ${c.unit} · ${zl(c.price)}</span>`}
          onPick=${(c) => add({ kind: 'labor', name: c.name, qty: c.qty, unit: c.unit, price: c.price, vat: c.vat, discount: discL, mechanic_id: o.mechanic_id })}
          extra=${{ label: 'Новая работа', onClick: (q) => q && add({ kind: 'labor', name: q, qty: 1, unit: 'oper', price: 0, discount: discL, mechanic_id: o.mechanic_id }) }} /></div>`}
      </div>
      <${ItemTable} rows=${labor} kind="labor" save=${save} del=${del} mech=${mech} staff=${app.staff} />
    </div>
    <div class="card tight">
      <div class="row" style="padding:12px 14px"><h2 style="margin:0">Запчасти</h2>
        ${!mech && app.features.intercars && html`<button class="btn sm" style="margin-left:auto" onClick=${() => setIc(true)}>Искать в Inter Cars</button>`}
        ${!mech && html`<div class="grow" style=${'max-width:520px;' + (app.features.intercars ? '' : 'margin-left:auto')}><${Picker} placeholder="+ Со склада (название, индекс) или новая позиция…" path=${(q) => 'products?q=' + encodeURIComponent(q)}
          render=${(p) => html`<b>${p.name}</b> <span class="sub">${p.code || ''} · в наличии ${num(p.stock - p.reserved, 2)} ${p.unit} · ${zl(p.sell_price)}</span>`}
          onPick=${(p) => add({ kind: 'part', product_id: p.id, name: p.name, code: p.code, qty: 1, unit: p.unit, price: p.sell_price, vat: p.vat, discount: discP })}
          extra=${{ label: 'Без склада (заказать / свою)', onClick: (q) => q && add({ kind: 'part', name: q, qty: 1, unit: 'szt.', price: 0, discount: discP }) }} /></div>`}
      </div>
      <${ItemTable} rows=${parts} kind="part" save=${save} del=${del} mech=${mech} staff=${app.staff} />
    </div>
    ${ic && html`<${ICSearch} o=${o} onClose=${() => setIc(false)} onAdd=${async (it) => { await add(it); }} />`}
    <div class="card"><label class="f">Заметка для механика<textarea rows="2" value=${o.mechanic_note || ''} disabled=${mech}
      onChange=${async (e) => { await act(() => api('orders/' + o.id, { method: 'PUT', body: { mechanic_note: e.target.value } }), 'Сохранено'); }}></textarea></label>
      ${o.complaint && html`<div class="small" style="margin-top:8px"><span class="muted">Жалоба клиента:</span> ${o.complaint}</div>`}</div>`;
}

function ItemTable({ rows, kind, save, del, mech, staff }) {
  if (!rows.length) return html`<div class="empty" style="padding:16px">Пока пусто</div>`;
  const cell = (it, k, cls, step = '0.01') => html`<input class=${'inline-input num ' + cls} type="number" step=${step} value=${it[k]} disabled=${mech}
    onChange=${(e) => save(it, { [k]: Number(e.target.value) })} />`;
  return html`<div class="tbl-wrap"><table class="tbl items"><thead><tr>
      <th style="width:30px">${kind === 'labor' ? '✓' : ''}</th><th>${kind === 'labor' ? 'Работа' : 'Запчасть'}</th>${kind === 'labor' ? html`<th>Механик</th>` : html`<th>Индекс</th>`}
      <th class="r">Кол-во</th><th class="r">Цена брутто</th>${kind === 'part' && !mech ? html`<th class="r">Закупка нетто</th>` : ''}<th class="r">Скидка %</th><th class="r">Сумма</th><th></th></tr></thead>
    <tbody>${rows.map((it) => html`<tr>
      <td>${kind === 'labor' ? html`<input type="checkbox" class="done-toggle" checked=${!!it.done} onChange=${(e) => save(it, { done: e.target.checked ? 1 : 0 })} title="Выполнено" />` : ''}</td>
      <td><input class="inline-input" value=${it.name} disabled=${mech} onChange=${(e) => save(it, { name: e.target.value })} />
        ${kind === 'part' && it.product_id && it.product_stock !== null && it.product_stock < it.qty ? html`<div class="stock-warn">на складе ${num(it.product_stock, 2)} — нужно заказать</div>` : ''}
        ${kind === 'part' && !it.product_id ? html`<div class="sub">без склада</div>` : ''}</td>
      ${kind === 'labor' ? html`<td><select class="inline-input" value=${it.mechanic_id || ''} disabled=${mech} onChange=${(e) => save(it, { mechanic_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">—</option>${staff.filter((s) => s.active).map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></td>`
        : html`<td><input class="inline-input" style="width:130px" value=${it.code || ''} disabled=${mech} onChange=${(e) => save(it, { code: e.target.value })} /></td>`}
      <td class="r">${cell(it, 'qty', 'qty', '0.1')}</td>
      <td class="r">${cell(it, 'price', 'price')}</td>
      ${kind === 'part' && !mech ? html`<td class="r">${cell(it, 'cost', 'price')}</td>` : ''}
      <td class="r">${cell(it, 'discount', 'disc', '1')}</td>
      <td class="r nowrap"><b>${zl(it.qty * it.price * (1 - it.discount / 100))}</b></td>
      <td class="act">${!mech && html`<button class="icon-btn" title="Удалить" onClick=${() => del(it)}><${Icon} n="trash" /></button>`}</td>
    </tr>`)}</tbody></table></div>`;
}

// ── Данные заказа ──────────────────────────────────────────────────────────
function MainData({ o, reload }) {
  const app = useApp();
  const [f, set] = useState({
    mileage: o.mileage ?? '', fuel_level: o.fuel_level || '', complaint: o.complaint || '', internal_note: o.internal_note || '',
    type_id: o.type_id || '', mechanic_id: o.mechanic_id || '', pickup_at: o.pickup_at || '', flags: o.flags || {},
  });
  const [cc, setCc] = useState({ customer: o.customer, car: o.car });
  const save = async () => {
    let customer_id = cc.customer?.id ?? null;
    let car_id = cc.car?.id ?? null;
    if (!customer_id && (cc.newCustomer?.phone || cc.newCustomer?.name)) customer_id = (await act(() => api('customers', { body: cc.newCustomer }))).id;
    if (!car_id && (cc.newCar?.plate || cc.newCar?.vin || cc.newCar?.make)) car_id = (await act(() => api('cars', { body: { ...cc.newCar, customer_id } }))).id;
    await act(() => api('orders/' + o.id, { method: 'PUT', body: { ...f, customer_id, car_id, mileage: f.mileage || null, type_id: f.type_id || null, mechanic_id: f.mechanic_id || null } }), 'Сохранено');
    reload();
  };
  return html`
    <div class="card"><${CustomerCarPicker} value=${cc} onChange=${setCc} /></div>
    <div class="card"><div class="grid g4">
      <label class="f">Пробег, км<input type="number" value=${f.mileage} onInput=${(e) => set({ ...f, mileage: e.target.value })} /></label>
      <label class="f">Уровень топлива<select value=${f.fuel_level} onChange=${(e) => set({ ...f, fuel_level: e.target.value })}>${FUEL.map((x) => html`<option value=${x}>${x || '—'}</option>`)}</select></label>
      <label class="f">Источник заказа<select value=${f.type_id} onChange=${(e) => set({ ...f, type_id: e.target.value })}><option value="">—</option>${app.types.map((t) => html`<option value=${t.id}>${t.name}</option>`)}</select></label>
      <label class="f">Ответственный механик<select value=${f.mechanic_id} onChange=${(e) => set({ ...f, mechanic_id: e.target.value })}><option value="">—</option>${app.staff.filter((s) => s.active).map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>
      <label class="f">Срок выдачи<input type="datetime-local" value=${(f.pickup_at || '').replace(' ', 'T')} onInput=${(e) => set({ ...f, pickup_at: e.target.value.replace('T', ' ') })} /></label>
    </div>
    <div class="grid g2" style="margin-top:12px">
      <label class="f">Описание от клиента (попадает в печать)<textarea rows="4" value=${f.complaint} onInput=${(e) => set({ ...f, complaint: e.target.value })}></textarea></label>
      <label class="f">Внутренняя заметка (клиент не видит)<textarea rows="4" value=${f.internal_note} onInput=${(e) => set({ ...f, internal_note: e.target.value })}></textarea></label>
    </div>
    <div class="row" style="margin-top:12px;gap:18px">${FLAGS.map(([k, l]) => html`<label class="check"><input type="checkbox" checked=${!!f.flags[k]} onChange=${(e) => set({ ...f, flags: { ...f.flags, [k]: e.target.checked } })} />${l}</label>`)}</div>
    <div class="row" style="margin-top:14px"><button class="btn primary" onClick=${save}>Сохранить</button></div></div>`;
}

// ── Оплата, баллы, фактура ─────────────────────────────────────────────────
function Payments({ o, reload }) {
  const app = useApp();
  const due = Math.max(0, Math.round((o.total - o.paid) * 100) / 100);
  const [p, setP] = useState({ method: 'card', amount: due || '' });
  const [scan, setScan] = useState(null); // {ticket, limits, client}
  const [scanOpen, setScanOpen] = useState(false);
  const [pts, setPts] = useState('');
  const [inv, setInv] = useState(null);
  const addPay = async () => { await act(() => api(`orders/${o.id}/payments`, { body: p }), 'Оплата добавлена'); setP({ ...p, amount: '' }); reload(); };
  const onScan = async (data) => {
    try {
      const r = await api(`orders/${o.id}/scan`, { body: data });
      setScan(r); setScanOpen(false); setPts(r.limits.max ? String(r.limits.max) : '');
    } catch (e) { toast(e.message, 'error'); }
  };
  const redeem = async () => { await act(() => api(`orders/${o.id}/redeem`, { body: { ticket: scan.ticket, points: Number(pts) } }), 'Баллы списаны'); setScan(null); reload(); };
  const issue = async () => { const r = await act(() => api(`orders/${o.id}/invoice`, { body: inv }), 'Фактура выставлена'); setInv(null); reload(); return r; };
  return html`<div class="grid g2">
    <div class="card">
      <h2>Оплаты</h2>
      ${o.payments.length ? html`<table class="tbl"><tbody>${o.payments.map((x) => html`<tr>
        <td class="nowrap sub">${fdt(x.created_at)}</td><td>${METHOD[x.method]}${x.number ? html` <span class="sub">${x.number}</span>` : ''}<div class="sub">${x.note || ''}</div></td>
        <td class="r nowrap"><b>${zl(x.amount)}</b></td>
        <td class="act">${app.user.role === 'admin' && x.method !== 'points' ? html`<${ConfirmButton} cls="icon-btn" onConfirm=${async () => { await act(() => api(`orders/${o.id}/payments/${x.id}`, { method: 'DELETE' })); reload(); }}><${Icon} n="trash" /></${ConfirmButton}>` : ''}</td></tr>`)}</tbody></table>`
        : html`<div class="muted">Оплат пока нет</div>`}
      <div class="row end" style="margin-top:14px">
        <label class="f">Способ<select value=${p.method} onChange=${(e) => setP({ ...p, method: e.target.value })}><option value="card">Карта</option><option value="cash">Наличные</option><option value="transfer">Перевод</option></select></label>
        <label class="f" style="width:140px">Сумма<input type="number" step="0.01" value=${p.amount} onInput=${(e) => setP({ ...p, amount: e.target.value })} /></label>
        <button class="btn primary" onClick=${addPay} disabled=${!(Number(p.amount) > 0)}>Принять оплату</button>
      </div>
      <label class="f" style="margin-top:14px;max-width:260px">Номер чека с кассового аппарата<input value=${o.receipt_no || ''} onChange=${async (e) => { await act(() => api('orders/' + o.id, { method: 'PUT', body: { receipt_no: e.target.value } }), 'Сохранено'); }} placeholder="например 000123" /></label>
    </div>

    <div class="stack">
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

      <${Contact} o=${o} reload=${reload} />
      <div class="card">
        <h2>Фактура VAT</h2>
        ${o.invoice_no ? html`<div class="row"><b>${o.invoice_no}</b><a class="btn sm" href=${'/crm-api/orders/' + o.id + '/invoice.pdf'} target="_blank" rel="noopener">PDF</a>${o.invoice_url && html`<a class="btn sm" href=${o.invoice_url} target="_blank" rel="noopener">В Fakturownia <${Icon} n="external" /></a>`}</div>`
          : !app.features.invoices ? html`<div class="muted small">Подключите Fakturownia в <a href="#/settings/integrations">Настройки → Интеграции</a>, чтобы выставлять фактуры отсюда — они сами отправятся в KSeF.</div>`
          : html`<button class="btn" onClick=${() => setInv({ name: o.customer?.company || o.customer?.name || '', nip: o.customer?.nip || '', street: o.customer?.street || '', postcode: o.customer?.postcode || '', city: o.customer?.city || '' })} disabled=${!o.items.length}>Выставить фактуру</button>`}
      </div>
    </div>

    ${scanOpen && html`<${Modal} title="QR клиента" onClose=${() => setScanOpen(false)}><${ScanBox} onResult=${onScan} /></${Modal}>`}
    ${inv && html`<${Modal} title="Фактура VAT" onClose=${() => setInv(null)} foot=${html`<button class="btn" onClick=${() => setInv(null)}>Отмена</button><button class="btn primary" onClick=${issue}>Выставить на ${zl(o.total)}</button>`}>
      <div class="grid g2">${[['name', 'Покупатель'], ['nip', 'NIP (для фирмы)'], ['street', 'Улица'], ['postcode', 'Индекс'], ['city', 'Город']].map(([k, l]) => html`<label class="f">${l}<input value=${inv[k]} onInput=${(e) => setInv({ ...inv, [k]: e.target.value })} /></label>`)}</div>
      <div class="muted small">Позиции заказа и оплата перенесутся автоматически. Фактура появится в Fakturownia и уйдёт в KSeF по их настройкам.</div>
    </${Modal}>`}
  </div>`;
}

// ── Записи в терминарз для заказа ──────────────────────────────────────────
function Plan({ o }) {
  return html`<div class="card">
    <div class="row" style="margin-bottom:10px"><h2 style="margin:0">Записи на посты</h2>
      <a class="btn primary sm" style="margin-left:auto" href=${`#/calendar?order=${o.id}`}><${Icon} n="cal" />Запланировать в терминарзе</a></div>
    ${o.appointments.length ? html`<table class="tbl"><tbody>${o.appointments.map((a) => html`<tr><td class="nowrap"><b>${fdt(a.start_at) || 'без времени'}</b></td><td>${a.station_name || 'не распределено'}</td><td class="sub">${a.duration_min} мин</td><td class="sub">${a.status}</td>
      <td class="act"><a class="btn sm" href=${'#/calendar?date=' + (a.start_at || '').slice(0, 10)}>Открыть</a></td></tr>`)}</tbody></table>`
      : html`<div class="muted">Заказ ещё не поставлен в терминарз</div>`}
  </div>`;
}

// ── Поиск детали в Inter Cars: цена, наличие, добавить в заказ, заказать в IC ─
function ICSearch({ o, onClose, onAdd }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cart, setCart] = useState([]);
  const search = async (e) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try { setRows(await api('intercars/search?q=' + encodeURIComponent(q.trim()))); } catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  const addToOrder = async (r) => {
    await onAdd({ kind: 'part', name: `${r.name} ${r.index || ''}`.trim(), code: r.index, qty: 1, unit: 'szt.', price: r.sellSuggested, cost: r.priceNet, vat: r.vat });
    setCart((c) => (c.some((x) => x.sku === r.sku) ? c : [...c, { ...r, qty: 1 }]));
    toast('Добавлено в заказ');
  };
  const orderIC = async () => {
    const r = await act(() => api('intercars/order', { body: { order_id: o.id, customNumber: o.number, lines: cart } }));
    toast(`Заказ в Inter Cars отправлен: ${r.requisitionId || r.id} (${r.phase || 'принят'})`);
    setCart([]);
  };
  return html`<${Modal} title="Inter Cars — поиск детали" wide onClose=${onClose} foot=${cart.length ? html`
      <span class="muted small" style="margin-right:auto">К заказу в IC: ${cart.map((c) => c.index).join(', ')}</span>
      <${ConfirmButton} cls="btn primary" label=${'Точно заказать ' + cart.length + ' поз.?'} onConfirm=${orderIC}>Заказать в Inter Cars</${ConfirmButton}>` : null}>
    <form class="row" onSubmit=${search}><input class="grow" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Номер детали / индекс, например OP 520, GDB1330" autofocus />
      <button class="btn primary" disabled=${busy}>${busy ? 'Ищу…' : 'Найти'}</button></form>
    ${rows && (rows.length ? html`<table class="tbl"><thead><tr><th>Деталь</th><th class="r">Ваша цена нетто</th><th class="r">Продажа (с наценкой)</th><th class="r">Наличие</th><th></th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td><b>${r.index}</b> ${r.name}<div class="sub">${r.sku}${r.ean ? ' · EAN ' + r.ean : ''}</div></td>
        <td class="r nowrap">${zl(r.priceNet)}</td><td class="r nowrap"><b>${zl(r.sellSuggested)}</b>${r.listGross ? html`<div class="sub">каталог ${zl(r.listGross)}</div>` : ''}</td>
        <td class="r nowrap ${r.availability ? 'pos' : 'neg'}">${r.availability} шт.<div class="sub">${r.locations.slice(0, 3).join(', ')}</div>${r.deliveryBy ? html`<div class="sub">рейс ${fdt(r.deliveryBy.replace('T', ' '))}</div>` : ''}</td>
        <td class="act"><button class="btn sm" onClick=${() => addToOrder(r)}>В заказ</button></td></tr>`)}</tbody></table>`
      : html`<div class="empty">Inter Cars ничего не нашёл по «${q}»</div>`)}
    <div class="muted small">«В заказ» добавляет деталь в этот заказ клиента (закупка = ваша цена IC). «Заказать в Inter Cars» отправляет заказ поставщику — деталь приедет рейсом, а поставка сама появится в Склад → Inter Cars.</div>
  </${Modal}>`;
}

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
      <button class="btn" onClick=${async () => { const u = link || await getLink(); navigator.clipboard?.writeText(u).then(() => toast('Ссылка скопирована')).catch(() => {}); }}><${Icon} n="file" />${isQuote ? 'Ссылка на смету' : 'Электронная карта заказа'}</button>
      ${link && html`<a class="btn ghost" href=${link} target="_blank" rel="noopener"><${Icon} n="external" />Открыть</a>`}
      ${o.customer?.phone && html`<button class="btn" onClick=${() => smsTpl(isQuote ? 'quote' : 'card')}>SMS ${isQuote ? 'со сметой' : 'с картой заказа'}</button>`}
      ${o.customer?.phone && html`<button class="btn ghost" onClick=${() => setSms('')}>SMS клиенту</button>`}
      ${f.tpay && due > 0 && !isQuote && html`<button class="btn" onClick=${async () => { const r = await act(() => api(`orders/${o.id}/paylink`, { body: { sms: f.sms } }), f.sms ? 'Ссылка на оплату отправлена SMS' : 'Ссылка создана'); reload(); if (r?.url) navigator.clipboard?.writeText(r.url).catch(() => {}); }}>Ссылка на оплату ${zl(due)}</button>`}
      ${o.pay_link && html`<button class="btn ghost" onClick=${async () => { const r = await act(() => api(`orders/${o.id}/paylink/check`, { body: {} })); toast(r.status === 'paid' ? 'Оплачено онлайн' : 'Пока не оплачено'); reload(); }}>Проверить оплату</button>`}
      ${f.email && html`<button class="btn" onClick=${mailTpl}>E-mail клиенту</button>`}
    </div>
    ${o.accepted_at ? html`<div class="small" style="margin-top:8px">✓ Подтверждено клиентом ${fdt(o.accepted_at)} · <a href="#" onClick=${async (e) => { e.preventDefault(); await act(() => api(`orders/${o.id}/accept-reset`, { body: {} }), 'Подтверждение сброшено'); reload(); }}>сбросить (если смета изменилась)</a></div>`
      : html`<div class="muted small" style="margin-top:8px">Клиент открывает карту по ссылке, видит работы и цены и нажимает «Akceptuję».</div>`}
    ${o.pay_link && html`<div class="small muted" style="margin-top:8px">Ссылка на оплату: <code style="user-select:all;word-break:break-all">${o.pay_link}</code></div>`}
    ${!f.sms && html`<div class="muted small" style="margin-top:6px">SMS-шлюз не подключён: сообщения попадут только в журнал. <a href="#/settings/integrations">Подключить</a></div>`}
    ${sms !== null && html`<${Modal} title="SMS клиенту" onClose=${() => setSms(null)} foot=${html`<button class="btn primary" disabled=${!sms.trim()} onClick=${async () => { await act(() => api(`orders/${o.id}/sms`, { body: { text: sms } }), 'SMS отправлено'); setSms(null); reload(); }}>Отправить на ${o.customer.phone}</button>`}>
      <div class="row" style="margin-bottom:6px"><span class="muted small">Шаблон:</span>
        ${[['card', 'Карта заказа'], ['quote', 'Смета'], ...(o.pay_link ? [['paylink', 'Оплата']] : []), ['review', 'Отзыв']].map(([k, l]) => html`<button class="btn ghost sm" onClick=${() => smsTpl(k)}>${l}</button>`)}
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
