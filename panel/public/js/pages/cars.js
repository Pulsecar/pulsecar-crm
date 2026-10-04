// Автомобили как в Motowarsztat: карточка с вкладками (Данные авто, Файлы, История заказов, История работ, Пробеги, Хранение),
// форма: слева Aztec, тип, марка/модель/цвет, номер, год, владелец; справа первая регистрация, топливо, VIN, двигатель, объём, мощность kW/KM, пробег, описание.
import { html, useState, useEffect, useData, go, qs, Loading, ErrorBox, Badge, Icon, Pager, useDebounced, zl, num, fdate, carName, Picker, api, act, toast } from '../lib.js';
import { AztecButton, PlateButton, mergeCar } from '../vehicle.js';
import { ObjectHistory } from './audit.js';
import { useSel, SelHead, SelCell, BulkBar } from '../bulk.js';
import { useApp } from '../lib.js';

export const VEHICLE_TYPES = [['Samochód osobowy', 'Легковой автомобиль'], ['Samochód dostawczy', 'Фургон / доставка'], ['Samochód ciężarowy', 'Грузовик'], ['Motocykl', 'Мотоцикл'],
  ['Motorower', 'Мопед'], ['Autobus', 'Автобус'], ['Ciągnik', 'Трактор'], ['Przyczepa', 'Прицеп'], ['Kamper', 'Кемпер'], ['Inny', 'Другой']];
export const FUELS = [['benzyna', 'Бензин'], ['diesel', 'Дизель'], ['benzyna + LPG', 'Бензин + газ (LPG)'], ['hybryda', 'Гибрид'], ['hybryda plug-in', 'Гибрид plug-in'], ['elektryczny', 'Электро'], ['CNG', 'Газ CNG'], ['LPG', 'Газ LPG'], ['wodór', 'Водород']];
const KM = 0.73549875; // 1 KM (л. с.) = 0.7355 kW

export function CarsList() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const dq = useDebounced(q);
  useEffect(() => setPage(0), [dq]);
  const { data, loading, error, reload } = useData('cars?' + qs({ q: dq, page }));
  const app = useApp();
  const sel = useSel();
  const bulkActions = app.perms?.['cars.edit'] ? [{ key: 'delete', label: 'Удалить', icon: 'trash', danger: true, confirm: 'Удалить выбранные авто? Авто, по которым есть заказы или выцены, будут пропущены.' }] : [];
  const csv = [['make', 'Marka'], ['model', 'Model'], ['plate', 'Nr rejestracyjny'], ['vin', 'VIN'], ['year', 'Rok'], ['owner_name', 'Właściciel'], ['owner_phone', 'Telefon'], ['last_mileage', 'Przebieg']];
  return html`
    <div class="page-head"><h1>Автомобили</h1><span class="muted">${data ? num(data.total) : ''}</span>
      <div class="actions"><a class="btn primary" href="#/cars/new"><${Icon} n="plus" />Новое авто</a></div></div>
    <div class="card" style="margin-bottom:12px"><input type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Номер, VIN, марка, модель, владелец…" aria-label="Поиск авто" /></div>
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl" data-cols="cars">
      <thead><tr><${SelHead} sel=${sel} rows=${data?.rows || []} /><th data-c="name">Марка / модель</th><th data-c="plate">Номер</th><th data-c="vin">VIN</th><th data-c="owner">Владелец</th><th data-c="year" class="r">Год</th><th data-c="engine" class="r">Объём</th><th data-c="fuel">Топливо</th><th data-c="power" class="r">Мощность</th><th data-c="mileage" class="r">Пробег</th></tr></thead>
      <tbody>${(data?.rows || []).map((k) => html`<tr class=${'click' + (sel.has(k.id) ? ' on' : '')} onClick=${() => go('/cars/' + k.id)}>
        <${SelCell} sel=${sel} row=${k} /><td><b>${carName(k)}</b></td><td>${k.plate ? html`<span class="plate">${k.plate}</span>` : ''}</td><td class="sub">${k.vin || ''}</td>
        <td>${k.owner_name || '—'}<div class="sub">${k.owner_phone || ''}</div></td><td class="r">${k.year || ''}</td><td class="r">${k.capacity || ''}</td>
        <td class="sub">${k.fuel || ''}</td><td class="r">${k.power_kw ? k.power_kw + ' kW' : ''}</td><td class="r">${k.last_mileage ? num(k.last_mileage) + ' ' + (k.mileage_unit || 'km') : ''}</td></tr>`)}</tbody></table></div>
      ${!loading && !data?.rows?.length ? html`<div class="empty">Ничего не найдено</div>` : ''}
      ${data && html`<${Pager} page=${page} total=${data.total} size=${data.pageSize} onPage=${setPage} />`}</div>`}
    <${BulkBar} sel=${sel} entity="cars" actions=${bulkActions} csv=${csv} csvName="samochody" onDone=${reload} />`;
}

const KEYS = ['plate', 'vin', 'make', 'model', 'year', 'engine', 'capacity', 'power_kw', 'fuel', 'color', 'last_mileage', 'mileage_unit', 'notes', 'first_reg', 'engine_no',
  'category', 'mass_kg', 'seats', 'reg_doc', 'inspection_until', 'insurance_until', 'key_no', 'paint_code', 'vehicle_type'];
const normType = (v) => (v ? VEHICLE_TYPES.find(([k]) => k.toLowerCase() === String(v).toLowerCase())?.[0] || v : '');

/** Форма авто как «Dane pojazdu» в Motowarsztat */
export function CarEditor({ k = {}, owner0 = null, onSaved, onCancel }) {
  const [f, setF] = useState(() => ({ ...Object.fromEntries(KEYS.map((x) => [x, k[x] ?? ''])), vehicle_type: normType(k.vehicle_type) || 'Samochód osobowy', mileage_unit: k.mileage_unit || 'km', customer_id: k.customer_id || null }));
  const [ownerLabel, setOwnerLabel] = useState(owner0 ? (owner0.kind === 'company' && owner0.company) || owner0.name || owner0.phone : '');
  const [newOwner, setNewOwner] = useState(null); // владелец из техпаспорта — предложим создать клиента
  const [unit, setUnit] = useState('kW');
  const [more, setMore] = useState(!!(k.inspection_until || k.insurance_until || k.key_no || k.paint_code || k.reg_doc || k.engine));
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((v) => ({ ...v, ...patch }));
  const power = unit === 'kW' ? f.power_kw : f.power_kw ? Math.round(Number(f.power_kw) / KM) : '';
  const save = async (e) => {
    e?.preventDefault();
    const body = Object.fromEntries(Object.entries(f).map(([x, v]) => [x, v === '' ? null : v]));
    setBusy(true);
    try {
      if (!body.customer_id && newOwner?.create && newOwner.name) {
        const c = await act(() => api('customers', { body: { first_name: newOwner.name, phone: newOwner.phone || null, street: newOwner.street, postcode: newOwner.postcode, city: newOwner.city,
          ...(newOwner.company ? { kind: 'company', company: newOwner.company } : {}) } }));
        body.customer_id = c.id;
      }
      const r = await act(() => (k.id ? api('cars/' + k.id, { method: 'PUT', body }) : api('cars', { body })), 'Сохранено');
      onSaved?.(k.id || r.id);
    } catch {} finally { setBusy(false); }
  };
  const onAztec = (r) => {
    if (r.existing && r.existing.id !== k.id) toast('Это авто уже есть в базе: ' + (r.car.plate || r.car.vin), 'error');
    setF((v) => { const m = mergeCar(v, r.car, true); return { ...m, vehicle_type: normType(m.vehicle_type) || v.vehicle_type }; });
    setMore(true);
    if (!f.customer_id && r.owner?.name) setNewOwner({ ...r.owner, phone: '', create: true });
  };
  const decodeVin = async () => {
    try {
      const r = await api('vin/' + encodeURIComponent(f.vin));
      set({ make: r.make || f.make, model: r.model || f.model, year: r.year || f.year, capacity: r.capacity || f.capacity, power_kw: r.power_kw || f.power_kw, engine: r.engine || f.engine });
      toast(r.partial && !r.model ? `Из VIN: ${[r.make, r.year].filter(Boolean).join(', ')} — модель впишите вручную или отсканируйте Aztec техпаспорта` : 'Данные из VIN (' + r.source + ')');
    } catch (err) { toast(err.message, 'error'); }
  };
  const inp = (key, l, attrs = {}) => html`<label class="f">${l}<input value=${f[key] ?? ''} placeholder=${l} onInput=${(e) => set({ [key]: e.target.value })} ...${attrs} /></label>`;
  return html`<form class="mwf" onSubmit=${save}>
    <div class="mwf-cols">
      <div class="mwf-col">
        <div class="f">Код Aztec (техпаспорт)<div class="ig aztec"><span class="addon"><${Icon} n="qr" /></span>
          <${AztecButton} cls="aztec-btn" label="AZTEC — отсканировать техпаспорт" onData=${onAztec} /></div></div>
        <label class="f">Тип авто<select value=${f.vehicle_type} onChange=${(e) => set({ vehicle_type: e.target.value })}>
          ${VEHICLE_TYPES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}${f.vehicle_type && !VEHICLE_TYPES.some(([v]) => v === f.vehicle_type) && html`<option value=${f.vehicle_type}>${f.vehicle_type}</option>`}</select></label>
        <div class="g3">${inp('make', 'Марка')}${inp('model', 'Модель')}${inp('color', 'Цвет')}</div>
        <div class="g2">
          <label class="f">Регистрационный номер<div class="ig"><input value=${f.plate} placeholder="Регистрационный номер" style="text-transform:uppercase" onInput=${(e) => set({ plate: e.target.value })} />
            <${PlateButton} plate=${f.plate} onData=${(r) => setF((v) => mergeCar(v, r))} /></div></label>
          ${inp('year', 'Год выпуска', { inputmode: 'numeric', maxlength: 4 })}</div>
        <div class="f">Текущий владелец${f.customer_id ? html`<div class="ig"><div class="ig-val">${ownerLabel || 'Клиент #' + f.customer_id}</div>
            <a class="addon btn" href=${'#/customers/' + f.customer_id} title="Открыть клиента"><${Icon} n="users" /></a>
            <button type="button" class="addon btn" title="Сменить владельца" onClick=${() => { set({ customer_id: null }); setOwnerLabel(''); }}>×</button></div>`
          : html`<${Picker} placeholder="Текущий владелец — найти клиента…" path=${(q) => 'customers?q=' + encodeURIComponent(q)}
              render=${(c) => html`<b>${c.kind === 'company' && c.company ? c.company : c.name || '—'}</b> <span class="sub">${c.phone || ''}</span>`}
              onPick=${(c) => { set({ customer_id: c.id }); setOwnerLabel(c.kind === 'company' && c.company ? c.company : c.name || c.phone); setNewOwner(null); }} />`}</div>
        ${newOwner && !f.customer_id && html`<div class="card" style="background:var(--surface2)"><label class="check"><input type="checkbox" checked=${newOwner.create} onChange=${(e) => setNewOwner({ ...newOwner, create: e.target.checked })} />
          Создать клиента из техпаспорта: <b>${newOwner.name}</b>${newOwner.company ? ' · ' + newOwner.company : ''} <span class="muted">${[newOwner.street, newOwner.postcode, newOwner.city].filter(Boolean).join(', ')}</span></label>
          ${newOwner.create && html`<label class="f" style="max-width:260px">Телефон клиента<input value=${newOwner.phone} placeholder="+48" onInput=${(e) => setNewOwner({ ...newOwner, phone: e.target.value })} /></label>`}</div>`}
      </div>
      <div class="mwf-col">
        <div class="g2">
          <label class="f">Дата первой регистрации<div class="ig"><input type="date" value=${f.first_reg || ''} onInput=${(e) => set({ first_reg: e.target.value })} />
            ${f.first_reg && html`<button type="button" class="addon btn" title="Очистить" onClick=${() => set({ first_reg: '' })}>×</button>`}</div></label>
          <label class="f">Вид топлива<select value=${f.fuel} onChange=${(e) => set({ fuel: e.target.value })}><option value=""></option>
            ${FUELS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}${f.fuel && !FUELS.some(([v]) => v === f.fuel) && html`<option value=${f.fuel}>${f.fuel}</option>`}</select></label></div>
        <div class="g2">
          <label class="f">Номер VIN<div class="ig"><input value=${f.vin} placeholder="VIN" maxlength="17" style="text-transform:uppercase" onInput=${(e) => set({ vin: e.target.value })} />
            <button type="button" class="addon btn" title="Расшифровать VIN" disabled=${String(f.vin).replace(/\W/g, '').length !== 17} onClick=${decodeVin}><${Icon} n="search" /></button></div></label>
          ${inp('engine_no', 'Номер двигателя')}</div>
        <div class="g2">
          <label class="f">Объём<div class="ig"><input type="number" min="0" value=${f.capacity} placeholder="Объём" onInput=${(e) => set({ capacity: e.target.value })} /><span class="addon">cm³</span></div></label>
          <label class="f">Мощность двигателя<div class="ig"><input type="number" min="0" value=${power} placeholder="Мощность двигателя"
              onInput=${(e) => set({ power_kw: e.target.value === '' ? '' : unit === 'kW' ? e.target.value : String(Math.round(Number(e.target.value) * KM)) })} />
            <button type="button" class="addon btn primary" title="Переключить kW / KM (л. с.)" onClick=${() => setUnit(unit === 'kW' ? 'KM' : 'kW')}>${unit}</button></div></label></div>
        <div class="g2">
          <label class="f">Единица пробега<select value=${f.mileage_unit} onChange=${(e) => set({ mileage_unit: e.target.value })}><option value="km">km</option><option value="mi">mi</option></select></label>
          <label class="f">Последний пробег<div class="ig"><input type="number" min="0" value=${f.last_mileage} placeholder="Пробег" onInput=${(e) => set({ last_mileage: e.target.value })} /><span class="addon">${f.mileage_unit}</span></div></label></div>
        <label class="f">Описание авто<textarea rows="4" value=${f.notes} placeholder="Описание авто" onInput=${(e) => set({ notes: e.target.value })}></textarea></label>
        ${more ? html`<div class="g3">${inp('engine', 'Двигатель / версия')}${inp('paint_code', 'Код краски')}${inp('key_no', 'Номер ключа')}</div>
            <div class="g3"><label class="f">Техосмотр до<input type="date" value=${f.inspection_until || ''} onInput=${(e) => set({ inspection_until: e.target.value })} /></label>
              <label class="f">Страховка до<input type="date" value=${f.insurance_until || ''} onInput=${(e) => set({ insurance_until: e.target.value })} /></label>${inp('reg_doc', 'Серия техпаспорта')}</div>`
          : html`<button type="button" class="btn ghost sm" style="align-self:flex-start" onClick=${() => setMore(true)}>+ Техосмотр, страховка, код краски, ключ…</button>`}
        <div class="mwf-foot">${onCancel && html`<button type="button" class="btn" onClick=${onCancel}>Отмена</button>`}<button class="btn primary" disabled=${busy}>${busy ? 'Сохраняю…' : 'Сохранить'}</button></div>
      </div>
    </div>
  </form>`;
}

const TABS = [['data', 'Данные авто'], ['files', 'Файлы'], ['orders', 'История заказов'], ['jobs', 'История работ'], ['mileage', 'Пробеги'], ['storage', 'Хранение'], ['history', 'История изменений']];

export function CarNew({ query = {} }) {
  const cid = Number(query.customer_id) || null;
  const { data: owner } = useData(cid ? 'customers/' + cid : null, [cid]);
  return html`<div class="crumbs"><a href="#/cars">Автомобили</a>${owner ? html` · <a href=${'#/customers/' + cid}>${(owner.kind === 'company' && owner.company) || owner.name}</a>` : ''}</div>
    <div class="page-head"><h1>Новый автомобиль</h1></div>
    <div class="card"><div class="pill-tabs mwf-tabs">${TABS.map(([, l], i) => html`<button class=${i === 0 ? 'on' : ''} disabled=${i > 0}>${l}</button>`)}</div>
      ${(!cid || owner) && html`<${CarEditor} k=${{ customer_id: cid }} owner0=${owner} onSaved=${(id) => go(cid ? '/customers/' + cid + '?tab=cars' : '/cars/' + id)} onCancel=${() => history.back()} />`}</div>`;
}

export function CarPage({ id, query = {} }) {
  const { data: k, loading, error, reload } = useData('cars/' + id);
  const [tab, setTab] = useState(query.tab || 'data');
  const [open, setOpen] = useState(null);
  if (loading && !k) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} />`;
  const jobs = k.orders.flatMap((o) => o.items.map((i) => ({ ...i, o })));
  const miles = k.orders.filter((o) => o.mileage).map((o) => ({ d: o.closed_at || o.created_at, m: o.mileage, o })).sort((a, b) => (a.d < b.d ? 1 : -1));
  const expired = (d) => d && d < new Date().toISOString().slice(0, 10);
  const count = { files: k.files?.length, orders: k.orders.length, jobs: jobs.length, mileage: miles.length, storage: k.storage.length };
  return html`
    <div class="crumbs"><a href="#/cars">Автомобили</a></div>
    <div class="page-head"><h1>${carName(k)} ${k.year || ''}</h1>${k.plate ? html`<span class="plate" style="font-size:15px">${k.plate}</span>` : ''}
      <div class="actions"><a class="btn primary" href=${`#/orders/new?${k.customer_id ? 'customer_id=' + k.customer_id + '&' : ''}car_id=${k.id}`}><${Icon} n="plus" />Заказ</a></div></div>
    <div class="grid g4" style="margin-bottom:14px">
      <div class="stat"><b style="font-size:15px">${k.vin || '—'}</b><span>VIN</span></div>
      <div class="stat"><b>${k.last_mileage ? num(k.last_mileage) + ' ' + (k.mileage_unit || 'km') : '—'}</b><span>Последний пробег</span></div>
      <div class="stat"><b style="font-size:15px">${[k.capacity && k.capacity + ' cm³', k.power_kw && k.power_kw + ' kW', k.fuel].filter(Boolean).join(' · ') || '—'}</b><span>Двигатель</span></div>
      <div class="stat"><b style="font-size:15px">${k.owner ? html`<a href=${'#/customers/' + k.owner.id}>${k.owner.kind === 'company' && k.owner.company ? k.owner.company : k.owner.name || k.owner.phone}</a>` : '—'}</b>
        <span>Владелец ${k.owner?.phone || ''}${k.inspection_until ? html` · техосмотр до <b class=${expired(k.inspection_until) ? 'neg' : ''}>${fdate(k.inspection_until)}</b>` : ''}</span></div>
    </div>
    <div class="card">
      <div class="pill-tabs mwf-tabs">${TABS.map(([t, l]) => html`<button class=${tab === t ? 'on' : ''} onClick=${() => setTab(t)}>${l}${count[t] ? html` <span class="faint">${count[t]}</span>` : ''}</button>`)}</div>
      ${tab === 'data' && html`<${CarEditor} key=${k.id} k=${k} owner0=${k.owner} onSaved=${reload} />`}
      ${tab === 'files' && (k.files?.length ? html`<div class="file-grid">${k.files.map((f) => html`<div class="file-tile">
          <a href=${'/crm-api/files/' + f.id} target="_blank" rel="noopener">${/^image\//.test(f.mime) ? html`<img src=${'/crm-api/files/' + f.id} alt="" loading="lazy" />` : html`<div class="file-ph">${/^video\//.test(f.mime) ? 'Видео' : 'PDF'}</div>`}</a>
          <div class="sub">${fdate(f.created_at)} · <a href=${'#/orders/' + f.order_id}>${f.order_no}</a></div></div>`)}</div>` : html`<div class="empty">Файлов нет — фото и документы добавляются в заказе (вкладка «Файлы и подписи»)</div>`)}
      ${tab === 'orders' && (k.orders.length ? html`<table class="tbl"><thead><tr><th>Дата</th><th>Заказ</th><th>Статус</th><th class="r">Пробег</th><th class="r">Сумма</th></tr></thead><tbody>
        ${k.orders.map((o) => html`
          <tr class="click" onClick=${() => setOpen(open === o.id ? null : o.id)}><td class="nowrap">${fdate(o.closed_at || o.created_at)}</td>
            <td><a href=${(o.kind === 'quote' ? '#/quotes/' : '#/orders/') + o.id} onClick=${(e) => e.stopPropagation()}><b>${o.number}</b></a></td>
            <td><${Badge} color=${o.status_color}>${o.status_name}</${Badge}></td><td class="r">${o.mileage ? num(o.mileage) : ''}</td><td class="r nowrap">${zl(o.total)}</td></tr>
          ${open === o.id && html`<tr><td colspan="5" style="background:var(--surface2)">${o.items.map((i) => html`<div class="row small" style="justify-content:space-between">
            <span><span class="chip">${i.kind === 'part' ? 'товар' : 'работа'}</span> ${i.name} ${i.qty !== 1 ? '×' + i.qty : ''}</span><span class="muted">${zl(i.qty * i.price * (1 - i.discount / 100))}</span></div>`)}
            ${o.complaint ? html`<div class="muted small" style="margin-top:6px">${o.complaint}</div>` : ''}</td></tr>`}`)}
      </tbody></table>` : html`<div class="empty">Ещё не обслуживалось</div>`)}
      ${tab === 'jobs' && (jobs.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Дата</th><th>Заказ</th><th>Позиция</th><th class="r">Кол-во</th><th class="r">Пробег</th></tr></thead><tbody>
          ${jobs.map((i) => html`<tr><td class="nowrap sub">${fdate(i.o.closed_at || i.o.created_at)}</td><td><a href=${'#/orders/' + i.o.id}>${i.o.number}</a></td>
            <td><span class="chip">${i.kind === 'part' ? 'товар' : 'работа'}</span> ${i.name}${i.code ? html` <span class="sub">${i.code}</span>` : ''}</td><td class="r">${num(i.qty, 2)} ${i.unit || ''}</td><td class="r sub">${i.o.mileage ? num(i.o.mileage) : ''}</td></tr>`)}</tbody></table></div>`
        : html`<div class="empty">Работ пока нет</div>`)}
      ${tab === 'mileage' && (miles.length ? html`<table class="tbl"><thead><tr><th>Дата</th><th>Заказ</th><th class="r">Пробег</th><th class="r">С прошлого визита</th></tr></thead><tbody>
          ${miles.map((x, i) => html`<tr><td class="nowrap">${fdate(x.d)}</td><td><a href=${'#/orders/' + x.o.id}>${x.o.number}</a></td><td class="r"><b>${num(x.m)} ${k.mileage_unit || 'km'}</b></td>
            <td class="r sub">${miles[i + 1] ? '+' + num(x.m - miles[i + 1].m) : ''}</td></tr>`)}</tbody></table>` : html`<div class="empty">Пробег ещё не записывался</div>`)}
      ${tab === 'storage' && (k.storage.length ? html`<table class="tbl"><tbody>${k.storage.map((s) => html`<tr>
          <td><b>${s.number}</b></td><td>${s.description || s.kind}</td><td>${s.location || ''}</td><td class="sub">с ${fdate(s.date_in)}${s.date_out ? ' · выдано ' + fdate(s.date_out) : ''}</td></tr>`)}</tbody></table>` : html`<div class="empty">Шины этого авто не хранятся</div>`)}
      ${tab === 'history' && html`<${ObjectHistory} entity="cars" id=${k.id} />`}
    </div>`;
}
