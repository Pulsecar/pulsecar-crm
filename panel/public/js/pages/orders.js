import {
  html, useState, useEffect, useData, api, act, go, qs, useApp, Loading, ErrorBox, Badge, Icon, Modal, Field, Pager, Picker,
  ConfirmButton, useDebounced, zl, num, fdate, fdt, carName, METHOD, toast,
} from '../lib.js';
import { SupplierParts } from './suppliers.js';
import { DocsMenu, SalesDocs, Intake } from './order-docs.js';
import { OrderMain, ItemsMW } from './order-form.js';
import { AztecButton, PlateButton, mergeCar } from '../vehicle.js';
import { ScanBox } from '../scan.js';


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
    <div class="page-head"><h1>${kind === 'quote' ? 'Выцены' : 'Заказы'}</h1>
      <div class="actions"><a class="btn primary" href=${'#' + base + '/new'}><${Icon} n="plus" />${kind === 'quote' ? 'Новая выцена' : 'Новый заказ'}</a></div></div>
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
export function CustomerCarPicker({ value, onChange, only }) {
  const { customer, car } = value;
  const [newC, setNewC] = useState(null);
  const [newCar, setNewCar] = useState(null);
  const { data: cust } = useData(customer?.id ? 'customers/' + customer.id : null, [customer?.id]);
  const custCol = only === 'car' ? '' : html`<div class="stack">
      ${!only && html`<h3>Клиент</h3>`}
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
    </div>`;
  const carCol = only === 'customer' ? '' : html`<div class="stack">
      ${!only && html`<h3>Автомобиль</h3>`}
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
    </div>`;
  return only ? (only === 'car' ? carCol : custCol) : html`<div class="grid g2">${custCol}${carCol}</div>`;
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
    ...(isQuote ? [] : [...(app.perms['orders.prices'] ? [['pay', 'Оплата и документы' + (due > 0.01 && o.total > 0 ? ' · ' + zl(due) : '')]] : []), ['plan', 'Терминарз'], ['check', 'Чек-листы']]), ['log', 'История']];
  return html`
    <div class="crumbs"><a href=${isQuote ? '#/quotes' : '#/orders'}>${isQuote ? 'Выцены' : 'Заказы'}</a></div>
    <div class="order-head">
      <div class="title grow">
        <h1>${o.number}
          <select class="status-select" value=${o.status_id} onChange=${(e) => setStatus(e.target.value)} style=${`border-color:${o.status?.color};color:${o.status?.color}`}>
            ${app.statuses.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></h1>
        <div class="muted">
          ${o.customer ? html`<a href=${'#/customers/' + o.customer.id}>${o.customer.name || o.customer.phone}</a> · <a href=${'tel:' + o.customer.phone}>${o.customer.phone || ''}</a>` : 'Клиент не выбран'}
          ${o.car ? html` · <a href=${'#/cars/' + o.car.id}>${carName(o.car)}</a> <span class="plate">${o.car.plate || ''}</span>` : ''}
          · создан ${fdt(o.created_at)}${o.created_by ? ' · ' + o.created_by : ''}${o.source === 'app' ? ' · из приложения' : ''}${o.quote_id ? html` · <a href=${'#/quotes/' + o.quote_id}>из выцены</a>` : ''}
        </div>
      </div>
      <div class="row">
        <${DocsMenu} o=${o} />
        ${isQuote && html`<button class="btn primary" onClick=${async () => { const r = await act(() => api(`orders/${o.id}/to-order`, { body: {} }), 'Заказ создан'); go('/orders/' + r.id); }}>Превратить в заказ</button>`}
        ${app.perms['orders.delete'] && html`<${ConfirmButton} cls="btn danger" onConfirm=${async () => { await act(() => api('orders/' + o.id, { method: 'DELETE' }), 'Удалено'); go(isQuote ? '/quotes' : '/orders'); }}><${Icon} n="trash" /></${ConfirmButton}>`}
      </div>
    </div>
    ${app.perms['orders.prices'] && html`<div class="totals" style="margin-bottom:14px">
      <div><span>Итого брутто</span><b>${zl(o.total)}</b></div>
      <div><span>Нетто</span><b>${zl(o.total_net)}</b></div>
      ${!isQuote && html`<div class=${o.total > 0 && due < 0.01 ? 'ok' : ''}><span>Оплачено</span><b>${zl(o.paid)}</b></div>`}
      ${!isQuote && html`<div class=${due > 0.01 ? 'due' : 'ok'}><span>К оплате</span><b>${zl(due)}</b></div>`}
      ${app.perms['products.prices'] && html`<div><span>Маржа на запчастях</span><b>${zl(o.items.filter((i) => i.kind === 'part').reduce((s, i) => s + (i.qty * i.price * (1 - i.discount / 100)) / (1 + i.vat / 100) - i.qty * i.cost, 0))}</b></div>`}
    </div>`}
    <div class="pill-tabs" style="margin-bottom:14px">${tabs.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}</div>
    ${o.accepted_at && html`<div class="card ok-card small" style="margin-bottom:14px">✓ Клиент подтвердил ${isQuote ? 'выцену' : 'заказ'} по электронной карте ${fdt(o.accepted_at)}${o.accepted_via === 'sms' ? ' (кодом SMS)' : ''}</div>`}
    ${notice && html`<${StatusNotice} o=${o} n=${notice} set=${setNotice} reload=${reload} />`}
    ${tab === 'items' && html`<${ItemsMW} o=${o} reload=${reload} />`}
    ${tab === 'items' && isQuote && html`<div style="margin-top:14px"><${Contact} o=${o} reload=${reload} /></div>`}
    ${tab === 'main' && html`<${OrderMain} o=${o} reload=${reload} />`}
    ${tab === 'files' && html`<${Intake} o=${o} reload=${reload} />`}
    ${tab === 'pay' && html`<${Payments} o=${o} reload=${reload} />`}
    ${tab === 'plan' && html`<${Plan} o=${o} />`}
    ${tab === 'check' && html`<${Checklists} o=${o} />`}
    ${tab === 'log' && html`<div class="card"><table class="tbl"><tbody>${o.activity.map((a) => html`<tr><td class="nowrap sub">${fdt(a.created_at)}</td><td>${ACTION[a.action] || a.action} ${a.action === 'status' ? html`<b>${JSON.parse(a.details || '""')}</b>` : ''}</td><td class="sub">${a.staff || ''}</td></tr>`)}</tbody></table></div>`}`;
}
const ACTION = { sms: 'SMS клиенту', email: 'E-mail клиенту', paylink: 'Ссылка на оплату', ic_order: 'Заказ в Inter Cars', invoice_error: 'Ошибка автофактуры', create: 'Создан', update: 'Изменены данные', status: 'Статус →', payment: 'Оплата', payment_delete: 'Удалена оплата', redeem: 'Списаны баллы', invoice: 'Выставлена фактура', proforma: 'Выставлена Pro forma', to_order: 'Создан заказ из выцены', accepted: 'Клиент подтвердил по ссылке', accept_reset: 'Сброшено подтверждение клиента' };

// ── Оплата, баллы, фактура ─────────────────────────────────────────────────
function Payments({ o, reload }) {
  const app = useApp();
  const due = Math.max(0, Math.round((o.total - o.paid) * 100) / 100);
  const [p, setP] = useState({ method: 'card', amount: due || '' });
  const [scan, setScan] = useState(null); // {ticket, limits, client}
  const [scanOpen, setScanOpen] = useState(false);
  const [pts, setPts] = useState('');
  const addPay = async () => { await act(() => api(`orders/${o.id}/payments`, { body: p }), 'Оплата добавлена'); setP({ ...p, amount: '' }); reload(); };
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
      ${app.perms['invoices.create'] ? html`<${SalesDocs} o=${o} reload=${reload} />` : ''}
        </div>

    ${scanOpen && html`<${Modal} title="QR клиента" onClose=${() => setScanOpen(false)}><${ScanBox} onResult=${onScan} /></${Modal}>`}

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
