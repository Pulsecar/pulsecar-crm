import {
  html, useState, useEffect, useData, api, act, go, qs, useApp, Loading, ErrorBox, Badge, Icon, Modal, Pager, useDebounced,
  zl, num, fdate, fdt, carName, toast,
} from '../lib.js';
import { AztecButton, PlateButton, mergeCar } from '../vehicle.js';

export function CustomersList() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(q);
  useEffect(() => setPage(0), [dq]);
  const { data, loading, error } = useData('customers?' + qs({ q: dq, page }));
  return html`
    <div class="page-head"><h1>Клиенты</h1><span class="muted">${data ? num(data.total) : ''}</span>
      <div class="actions"><button class="btn primary" onClick=${() => setAdding(true)}><${Icon} n="plus" />Новый клиент</button></div></div>
    <div class="card" style="margin-bottom:12px"><input type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Имя, телефон, номер авто, VIN, NIP, e-mail, карта PC…" aria-label="Поиск клиентов" /></div>
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Клиент</th><th>Телефон</th><th>Авто</th><th class="r">Заказов</th><th>Последний</th><th>Приложение</th><th class="r">Баллы</th></tr></thead>
      <tbody>${(data?.rows || []).map((c) => html`<tr class="click" onClick=${() => go('/customers/' + c.id)}>
        <td><b>${c.name || '—'}</b>${c.company ? html`<div class="sub">${c.company}${c.nip ? ' · NIP ' + c.nip : ''}</div>` : ''}</td>
        <td class="nowrap">${c.phone || ''}</td><td class="sub">${c.cars || ''}</td>
        <td class="r">${c.orders_count || ''}</td><td class="sub nowrap">${fdate(c.last_order)}</td>
        <td>${c.registered_at ? html`<span class="pos">✓ ${c.card_no}</span>` : html`<span class="faint">—</span>`}</td>
        <td class="r">${c.points ? num(c.points) : ''}</td></tr>`)}</tbody></table></div>
      ${!loading && !data?.rows?.length ? html`<div class="empty">Никого не нашли</div>` : ''}
      ${data && html`<${Pager} page=${page} total=${data.total} size=${data.pageSize} onPage=${setPage} />`}</div>`}
    ${adding && html`<${CustomerForm} onClose=${() => setAdding(false)} onSaved=${(id) => go('/customers/' + id)} />`}`;
}

export function CustomerForm({ c = {}, onClose, onSaved }) {
  const [f, set] = useState({
    name: c.name || '', phone: c.phone || '', email: c.email || '', company: c.company || '', nip: c.nip || '',
    street: c.street || '', postcode: c.postcode || '', city: c.city || '', notes: c.notes || '',
    discount_labor: c.discount_labor || 0, discount_parts: c.discount_parts || 0, marketing_consent: c.marketing_consent ?? 1,
  });
  const save = async () => {
    const r = await act(() => (c.id ? api('customers/' + c.id, { method: 'PUT', body: f }) : api('customers', { body: f })), 'Сохранено');
    onSaved(c.id || r.id);
  };
  const inp = (k, l, t = 'text') => html`<label class="f">${l}<input type=${t} value=${f[k]} onInput=${(e) => set({ ...f, [k]: t === 'number' ? Number(e.target.value) : e.target.value })} /></label>`;
  return html`<${Modal} title=${c.id ? 'Данные клиента' : 'Новый клиент'} onClose=${onClose} wide foot=${html`<button class="btn" onClick=${onClose}>Отмена</button><button class="btn primary" onClick=${save}>Сохранить</button>`}>
    <div class="grid g3">${inp('name', 'Имя и фамилия')}${inp('phone', 'Телефон')}${inp('email', 'E-mail', 'email')}</div>
    <div class="grid g3">${inp('company', 'Фирма')}<label class="f">NIP<div class="row" style="gap:6px;flex-wrap:nowrap"><input value=${f.nip} onInput=${(e) => set({ ...f, nip: e.target.value })} placeholder="10 цифр" />
        <button class="btn" type="button" title="Найти фирму в реестре Минфина" onClick=${async () => { const r = await act(() => api('nip/' + encodeURIComponent(f.nip))); set({ ...f, company: r.name, street: r.street, postcode: r.postcode, city: r.city, nip: r.nip }); toast(`${r.name} · VAT: ${r.statusVat}`); }}><${Icon} n="search" />Найти</button></div></label>${inp('street', 'Улица')}</div>
    <div class="grid g4">${inp('postcode', 'Индекс')}${inp('city', 'Город')}${inp('discount_labor', 'Скидка на работы, %', 'number')}${inp('discount_parts', 'Скидка на запчасти, %', 'number')}</div>
    <label class="f">Заметка о клиенте<textarea rows="2" value=${f.notes} onInput=${(e) => set({ ...f, notes: e.target.value })}></textarea></label>
    <label class="check"><input type="checkbox" checked=${!!f.marketing_consent} onChange=${(e) => set({ ...f, marketing_consent: e.target.checked ? 1 : 0 })} />Согласие на маркетинговые сообщения</label>
  </${Modal}>`;
}

export function CustomerPage({ id }) {
  const app = useApp();
  const { data: c, loading, error, reload } = useData('customers/' + id);
  const [edit, setEdit] = useState(false);
  const [adj, setAdj] = useState(null);
  const [carAdd, setCarAdd] = useState(false);
  if (loading && !c) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} />`;
  const spent = c.orders.filter((o) => o.kind === 'order').reduce((s, o) => s + o.total, 0);
  return html`
    <div class="crumbs"><a href="#/customers">Клиенты</a></div>
    <div class="page-head"><h1>${c.name || c.phone || 'Клиент'}</h1>${c.registered_at ? html`<span class="badge" style="background:var(--accent);color:#000">в приложении</span>` : ''}
      <div class="actions">
        <button class="btn" onClick=${() => setEdit(true)}><${Icon} n="edit" />Изменить</button>
        <a class="btn primary" href=${`#/orders/new?customer_id=${c.id}`}><${Icon} n="plus" />Заказ</a></div></div>
    <div class="grid g4" style="margin-bottom:14px">
      <div class="stat"><b>${c.phone ? html`<a href=${'tel:' + c.phone}>${c.phone}</a>` : '—'}</b><span>${c.email || 'без e-mail'}</span></div>
      <div class="stat"><b>${zl(spent)}</b><span>Всего за ${c.orders.filter((o) => o.kind === 'order').length} заказов</span></div>
      <div class="stat accent"><b>${num(c.loyalty.balance)}</b><span>Pulse Points · ${c.loyalty.tier.name} · карта ${c.card_no}</span></div>
      <div class="stat"><b>${c.discount_labor || 0}% / ${c.discount_parts || 0}%</b><span>Скидка работы / запчасти</span></div>
    </div>
    ${c.company || c.nip || c.street || c.notes ? html`<div class="card small" style="margin-bottom:14px">
      ${c.company ? html`<div><span class="muted">Фирма:</span> ${c.company} ${c.nip ? '· NIP ' + c.nip : ''}</div>` : ''}
      ${c.street ? html`<div><span class="muted">Адрес:</span> ${c.street}, ${c.postcode || ''} ${c.city || ''}</div>` : ''}
      ${c.notes ? html`<div><span class="muted">Заметка:</span> ${c.notes}</div>` : ''}</div>` : ''}

    <div class="grid g2">
      <div class="card">
        <div class="row" style="margin-bottom:8px"><h2 style="margin:0">Автомобили</h2><button class="btn sm" style="margin-left:auto" onClick=${() => setCarAdd(true)}><${Icon} n="plus" />Авто</button></div>
        ${c.cars.length ? html`<table class="tbl"><tbody>${c.cars.map((k) => html`<tr class="click" onClick=${() => go('/cars/' + k.id)}>
          <td><b>${carName(k)}</b> ${k.year || ''}<div class="sub">${k.vin || ''}</div></td><td>${k.plate ? html`<span class="plate">${k.plate}</span>` : ''}</td>
          <td class="r sub">${k.last_mileage ? num(k.last_mileage) + ' km' : ''}</td></tr>`)}</tbody></table>` : html`<div class="muted">Авто не добавлены</div>`}
      </div>
      <div class="card">
        <div class="row" style="margin-bottom:8px"><h2 style="margin:0">Pulse Points</h2>
          ${app.user.role === 'admin' && html`<button class="btn sm" style="margin-left:auto" onClick=${() => setAdj({ points: '', note: '' })}>Корректировка</button>`}</div>
        ${c.transactions.length ? html`<table class="tbl"><tbody>${c.transactions.slice(0, 12).map((t) => html`<tr>
          <td class="sub nowrap">${fdate(t.created_at)}</td><td>${{ earn: 'Начисление', redeem: 'Списание', bonus: 'Бонус', adjust: 'Корректировка' }[t.type]} <span class="sub">${t.order_no || t.note || ''}</span></td>
          <td class="r ${t.points < 0 ? 'neg' : 'pos'}">${t.points > 0 ? '+' : ''}${num(t.points)}</td></tr>`)}</tbody></table>`
          : html`<div class="muted">${c.registered_at ? 'Операций пока нет' : 'Клиент ещё не установил приложение — предложите: баллы 0,5 за 1 zł и +50 за регистрацию.'}</div>`}
      </div>
    </div>

    <div class="card tight" style="margin-top:14px">
      <div class="row" style="padding:12px 14px"><h2 style="margin:0">Заказы и сметы</h2></div>
      ${c.orders.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Номер</th><th>Дата</th><th>Статус</th><th>Авто</th><th class="r">Сумма</th><th class="r">Оплачено</th></tr></thead>
        <tbody>${c.orders.map((o) => html`<tr class="click" onClick=${() => go((o.kind === 'quote' ? '/quotes/' : '/orders/') + o.id)}>
          <td><b>${o.number}</b>${o.kind === 'quote' ? html` <span class="chip">смета</span>` : ''}</td><td class="nowrap">${fdate(o.created_at)}</td>
          <td><${Badge} color=${o.status_color}>${o.status_name}</${Badge}></td><td>${carName(o)} ${o.plate ? html`<span class="plate">${o.plate}</span>` : ''}</td>
          <td class="r nowrap">${zl(o.total)}</td><td class="r nowrap">${o.paid ? zl(o.paid) : '—'}</td></tr>`)}</tbody></table></div>`
        : html`<div class="empty">Заказов нет</div>`}
    </div>

    ${c.storage.length ? html`<div class="card" style="margin-top:14px"><h2>Хранение шин</h2><table class="tbl"><tbody>${c.storage.map((s) => html`<tr>
      <td><b>${s.number}</b></td><td>${s.description || s.kind}</td><td>${s.location || ''}</td><td class="sub">с ${fdate(s.date_in)}${s.date_out ? ' · выдано ' + fdate(s.date_out) : ''}</td></tr>`)}</tbody></table></div>` : ''}

    ${edit && html`<${CustomerForm} c=${c} onClose=${() => setEdit(false)} onSaved=${() => { setEdit(false); reload(); }} />`}
    ${carAdd && html`<${CarForm} k=${{ customer_id: c.id }} onClose=${() => setCarAdd(false)} onSaved=${() => { setCarAdd(false); reload(); }} />`}
    ${adj && html`<${Modal} title="Корректировка баллов" onClose=${() => setAdj(null)} foot=${html`<button class="btn primary" onClick=${async () => { await act(() => api(`customers/${c.id}/adjust`, { body: adj }), 'Готово'); setAdj(null); reload(); }}>Сохранить</button>`}>
      <label class="f">Баллы (+ начислить, − списать)<input type="number" value=${adj.points} onInput=${(e) => setAdj({ ...adj, points: e.target.value })} /></label>
      <label class="f">Причина<input value=${adj.note} onInput=${(e) => setAdj({ ...adj, note: e.target.value })} /></label></${Modal}>`}`;
}

export function CarForm({ k = {}, onClose, onSaved }) {
  const keys = ['plate', 'vin', 'make', 'model', 'year', 'engine', 'capacity', 'power_kw', 'fuel', 'color', 'last_mileage', 'notes', 'first_reg', 'engine_no',
    'category', 'mass_kg', 'seats', 'reg_doc', 'inspection_until', 'insurance_until', 'key_no', 'paint_code', 'vehicle_type'];
  const [f, set] = useState({ ...Object.fromEntries(keys.map((x) => [x, k[x] ?? ''])), customer_id: k.customer_id || null });
  const [owner, setOwner] = useState(null); // владелец из техпаспорта — предложим создать клиента
  const [more, setMore] = useState(!!(k.first_reg || k.inspection_until || k.insurance_until || k.key_no || k.paint_code || k.engine_no));
  const save = async () => {
    const body = Object.fromEntries(Object.entries(f).map(([x, v]) => [x, v === '' ? null : v]));
    if (!body.customer_id && owner?.create && owner.name) {
      const c = await act(() => api('customers', { body: { name: owner.name, phone: owner.phone || null, street: owner.street, postcode: owner.postcode, city: owner.city, company: owner.company || null } }));
      body.customer_id = c.id;
    }
    const r = await act(() => (k.id ? api('cars/' + k.id, { method: 'PUT', body }) : api('cars', { body })), 'Сохранено');
    onSaved(k.id || r.id);
  };
  const inp = (key, l, t = 'text') => html`<label class="f">${l}<input type=${t} value=${f[key] ?? ''} onInput=${(e) => set({ ...f, [key]: e.target.value })} /></label>`;
  const onAztec = (r) => {
    if (r.existing && r.existing.id !== k.id) toast('Это авто уже есть в базе — откройте его карточку: Автомобили → поиск ' + (r.car.plate || r.car.vin), 'error');
    set((v) => mergeCar(v, r.car, true));
    setMore(true);
    if (!f.customer_id && r.owner?.name) setOwner({ ...r.owner, phone: '', create: true });
  };
  return html`<${Modal} title=${k.id ? 'Автомобиль' : 'Новый автомобиль'} onClose=${onClose} wide foot=${html`<button class="btn" onClick=${onClose}>Отмена</button><button class="btn primary" onClick=${save}>Сохранить</button>`}>
    <div class="row" style="margin-bottom:8px"><${AztecButton} onData=${onAztec} /><span class="muted small">или заполните вручную</span></div>
    <div class="grid g3"><div class="row end" style="gap:6px"><div class="grow">${inp('plate', 'Номер')}</div>
        <${PlateButton} plate=${f.plate} onData=${(r) => set((v) => mergeCar(v, r))} /></div>
      <div class="row end" style="gap:6px"><div class="grow">${inp('vin', 'VIN')}</div>
      <button class="btn sm" style="margin-bottom:2px" onClick=${async () => {
        try { const r = await api('vin/' + encodeURIComponent(f.vin)); set({ ...f, make: r.make || f.make, model: r.model || f.model, year: r.year || f.year, capacity: r.capacity || f.capacity, power_kw: r.power_kw || f.power_kw, engine: r.engine || f.engine, fuel: f.fuel });
          toast('Данные из VIN (' + r.source + ')'); } catch (e) { toast(e.message, 'error'); } }}>Расшифровать</button></div>${inp('make', 'Марка')}</div>
    <div class="grid g3">${inp('model', 'Модель')}${inp('year', 'Год выпуска')}${inp('engine', 'Двигатель / версия')}</div>
    <div class="grid g4">${inp('capacity', 'Объём, см³', 'number')}${inp('power_kw', 'Мощность, кВт', 'number')}
      <label class="f">Топливо<input list="fuel-list" value=${f.fuel} onInput=${(e) => set({ ...f, fuel: e.target.value })} /><datalist id="fuel-list">${['benzyna', 'diesel', 'hybryda', 'LPG', 'benzyna + LPG', 'elektryczny', 'CNG'].map((x) => html`<option value=${x} />`)}</datalist></label>
      ${inp('last_mileage', 'Пробег, км', 'number')}</div>
    ${more ? html`<div class="grid g4">${inp('first_reg', 'Первая регистрация', 'date')}${inp('inspection_until', 'Техосмотр до', 'date')}${inp('insurance_until', 'Страховка до', 'date')}${inp('color', 'Цвет')}</div>
      <div class="grid g4">${inp('paint_code', 'Код краски')}${inp('key_no', 'Номер ключа')}${inp('engine_no', 'Номер двигателя')}${inp('reg_doc', 'Серия техпаспорта')}</div>`
      : html`<button class="btn ghost sm" onClick=${() => setMore(true)}>+ Техосмотр, страховка, код краски, ключ…</button>`}
    ${owner && html`<div class="card" style="margin-top:10px;background:var(--surface2)"><label class="check"><input type="checkbox" checked=${owner.create} onChange=${(e) => setOwner({ ...owner, create: e.target.checked })} />
      Создать клиента из техпаспорта: <b>${owner.name}</b>${owner.company ? ' · ' + owner.company : ''} <span class="muted">${[owner.street, owner.postcode, owner.city].filter(Boolean).join(', ')}</span></label>
      ${owner.create && html`<label class="f" style="max-width:260px">Телефон клиента<input value=${owner.phone} placeholder="+48" onInput=${(e) => setOwner({ ...owner, phone: e.target.value })} /></label>`}</div>`}
    <label class="f">Заметка<textarea rows="2" value=${f.notes} onInput=${(e) => set({ ...f, notes: e.target.value })}></textarea></label>
  </${Modal}>`;
}
