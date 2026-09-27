import {
  html, useState, useEffect, useData, api, act, go, useApp, Icon, Modal, Picker, ConfirmButton, todayStr, addDays, fdate, fdt, carName, toast,
} from '../lib.js';

const SLOT_PX = 28;
const DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const STATUS = { request: 'Заявка', planned: 'Запланировано', arrived: 'Клиент приехал', no_show: 'Не приехал', cancelled: 'Отменено' };

export default function Calendar({ query }) {
  const app = useApp();
  const [date, setDate] = useState(query.date || todayStr());
  const [view, setView] = useState('day');
  const [edit, setEdit] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overSlot, setOverSlot] = useState(null);
  const linkOrder = query.order ? Number(query.order) : null;
  const { data: linked } = useData(linkOrder ? 'orders/' + linkOrder : null, [linkOrder]);
  const range = view === 'day' ? [date, date] : [weekStart(date), addDays(weekStart(date), 6)];
  const { data, reload } = useData(`appointments?from=${range[0]}&to=${range[1]}`);
  const start = toMin(app.settings.hours_start || '08:00');
  const end = toMin(app.settings.hours_end || '18:00');
  const step = Number(app.settings.slot_min || 30);
  const slots = [];
  for (let m = start; m < end; m += step) slots.push(m);
  const stations = app.stations;

  const move = async (id, stationId, time) => {
    await act(() => api('appointments/' + id, { method: 'PUT', body: { station_id: stationId, start_at: `${date} ${hhmm(time)}` } }), 'Перенесено');
    reload();
  };
  const newAt = (stationId, time) => setEdit({
    station_id: stationId, start_at: `${date} ${hhmm(time)}`, duration_min: 60, title: linked ? `${linked.number}` : '',
    order_id: linkOrder, customer_id: linked?.customer_id || null, car_id: linked?.car_id || null,
    _customer: linked?.customer || null, _car: linked?.car || null,
  });
  const d = new Date(date + 'T12:00:00');
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  return html`
    <div class="page-head"><h1>Терминарз</h1>
      <div class="actions"><div class="pill-tabs"><button class=${view === 'day' ? 'on' : ''} onClick=${() => setView('day')}>День</button><button class=${view === 'week' ? 'on' : ''} onClick=${() => setView('week')}>Неделя</button></div>
        <button class="btn primary" onClick=${() => setEdit({ station_id: null, start_at: null, duration_min: 60, title: '', status: 'request' })}><${Icon} n="plus" />Заявка без времени</button></div></div>
    ${linked && html`<div class="card" style="margin-bottom:12px;border-color:var(--accent)">Выберите пост и время для заказа <b>${linked.number}</b> (${linked.customer?.name || ''} · ${carName(linked.car)}) — нажмите на свободный слот. <a href="#/calendar">Отмена</a></div>`}

    ${data?.unassigned?.length ? html`<h3>Не распределено · перетащите на пост</h3><div class="unassigned">${data.unassigned.map((a) => html`
      <div class="u-card" draggable="true" onDragStart=${() => setDragId(a.id)} onDragEnd=${() => setDragId(null)} onClick=${() => setEdit(a)}>
        <b>${a.customer_name || a.contact_name || a.title || 'Заявка'}</b>
        <div class="muted">${a.contact_phone || a.customer_phone || ''}</div>
        <div>${a.title || ''}</div>${a.note ? html`<div class="muted">${a.note}</div>` : ''}
        ${a.preferred ? html`<div class="pos">Желаемо: ${a.preferred}</div>` : ''}
        <div class="faint">${a.source === 'app' ? 'из приложения' : a.source || ''} · ${fdate(a.created_at)}</div>
      </div>`)}</div>` : ''}

    <div class="cal-bar">
      <button class="btn" onClick=${() => setDate(addDays(date, view === 'day' ? -1 : -7))}><${Icon} n="left" /></button>
      <button class="btn" onClick=${() => setDate(todayStr())}>Сегодня</button>
      <button class="btn" onClick=${() => setDate(addDays(date, view === 'day' ? 1 : 7))}><${Icon} n="right" /></button>
      <div class="date">${view === 'day' ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} (${DAYS[d.getDay()]})` : `${fdate(range[0])} — ${fdate(range[1])}`}</div>
      <input type="date" value=${date} onInput=${(e) => e.target.value && setDate(e.target.value)} style="width:160px" aria-label="Дата" />
    </div>

    ${view === 'day' ? html`
    <div class="cal" style=${`grid-template-columns:56px repeat(${stations.length}, minmax(170px,1fr))`}>
      <div class="cal-col-head" style="left:0;position:sticky;z-index:4"></div>
      ${stations.map((s) => {
        const busy = (data?.rows || []).filter((a) => a.station_id === s.id).reduce((t, a) => t + a.duration_min, 0);
        return html`<div class="cal-col-head"><i style=${'background:' + (s.color || '#1BF372')}></i>${s.name}<span class="faint" style="margin-left:auto">${Math.round(busy / 6) / 10}/${(end - start) / 60} ч</span></div>`;
      })}
      <div class="cal-time">${slots.map((m) => html`<div style=${`height:${SLOT_PX}px;line-height:${SLOT_PX}px`}>${m % 60 === 0 ? hhmm(m) : ''}</div>`)}</div>
      ${stations.map((s) => html`<div class="cal-col">
        ${slots.map((m) => {
          const key = s.id + ':' + m;
          return html`<div class=${'cal-slot' + ((m + step) % 60 === 0 ? ' hour' : '') + (overSlot === key ? ' drop' : '')} style=${`height:${SLOT_PX}px`}
            onClick=${() => newAt(s.id, m)}
            onDragOver=${(e) => { e.preventDefault(); setOverSlot(key); }} onDragLeave=${() => setOverSlot(null)}
            onDrop=${(e) => { e.preventDefault(); setOverSlot(null); if (dragId) move(dragId, s.id, m); }} title=${hhmm(m)}></div>`;
        })}
        ${date === todayStr() && nowMin > start && nowMin < end ? html`<div class="cal-now" style=${`top:${((nowMin - start) / step) * SLOT_PX}px`}></div>` : ''}
        ${(data?.rows || []).filter((a) => a.station_id === s.id).map((a) => {
          const top = ((toMin(a.start_at.slice(11)) - start) / step) * SLOT_PX;
          const h = Math.max(SLOT_PX - 2, (a.duration_min / step) * SLOT_PX - 2);
          return html`<div class=${'cal-ev' + (a.status === 'request' ? ' request' : '')} draggable="true"
              onDragStart=${() => setDragId(a.id)} onDragEnd=${() => setDragId(null)} onClick=${() => setEdit(a)}
              style=${`top:${top}px;height:${h}px;border-left-color:${a.status_color || s.color || 'var(--accent)'};${a.status === 'arrived' ? 'background:#1d2a22' : ''}${a.status === 'no_show' ? 'opacity:.5' : ''}`}>
            <b>${a.start_at.slice(11)} ${a.customer_name || a.contact_name || a.title || ''}</b>
            <div>${carName(a)} ${a.plate || ''}</div>
            ${h > 50 ? html`<div class="muted">${a.order_number || ''} ${a.status_name ? '· ' + a.status_name : ''}</div>` : ''}
            ${h > 70 && a.title ? html`<div class="muted">${a.title}</div>` : ''}
          </div>`;
        })}
      </div>`)}
    </div>` : html`
    <div class="week">${[0, 1, 2, 3, 4, 5, 6].map((i) => {
      const day = addDays(range[0], i);
      const evs = (data?.rows || []).filter((a) => a.start_at.startsWith(day));
      return html`<div class=${'day' + (day === todayStr() ? ' today' : '')}>
        <h4><a href="#" onClick=${(e) => { e.preventDefault(); setDate(day); setView('day'); }}>${DAYS[new Date(day + 'T12:00').getDay()]} ${fdate(day).slice(0, 5)}</a> <span class="faint">${evs.length || ''}</span></h4>
        ${evs.map((a) => html`<div class="ev" style=${'border-left-color:' + (stations.find((s) => s.id === a.station_id)?.color || 'var(--accent)')} onClick=${() => setEdit(a)}>
          <b>${a.start_at.slice(11)}</b> ${a.customer_name || a.contact_name || a.title}<div class="muted">${carName(a)} ${a.plate || ''}</div></div>`)}
      </div>`;
    })}</div>`}

    ${edit && html`<${ApptModal} a=${edit} onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); reload(); if (linkOrder) go('/orders/' + linkOrder); }} />`}`;
}

function weekStart(s) {
  const d = new Date(s + 'T12:00:00');
  const dow = (d.getDay() + 6) % 7;
  return addDays(s, -dow);
}

function ApptModal({ a, onClose, onSaved }) {
  const app = useApp();
  const [f, set] = useState({
    id: a.id, station_id: a.station_id ?? '', date: (a.start_at || '').slice(0, 10), time: (a.start_at || '').slice(11, 16), duration_min: a.duration_min || 60,
    title: a.title || '', note: a.note || '', status: a.status || 'planned', mechanic_id: a.mechanic_id || '',
    customer_id: a.customer_id || null, car_id: a.car_id || null, order_id: a.order_id || null,
    contact_name: a.contact_name || '', contact_phone: a.contact_phone || '',
  });
  const [cust, setCust] = useState(a._customer || (a.customer_id ? { id: a.customer_id, name: a.customer_name, phone: a.customer_phone } : null));
  const { data: cdata } = useData(cust?.id ? 'customers/' + cust.id : null, [cust?.id]);
  const save = async () => {
    const body = {
      station_id: f.station_id ? Number(f.station_id) : null, start_at: f.date && f.time ? `${f.date} ${f.time}` : null, duration_min: Number(f.duration_min) || 60,
      title: f.title, note: f.note, status: f.status, mechanic_id: f.mechanic_id || null, customer_id: cust?.id || null, car_id: f.car_id || null,
      order_id: f.order_id || null, contact_name: f.contact_name || null, contact_phone: f.contact_phone || null,
    };
    if (body.station_id && body.start_at && body.status === 'request') body.status = 'planned';
    await act(() => (f.id ? api('appointments/' + f.id, { method: 'PUT', body }) : api('appointments', { body })), 'Сохранено');
    onSaved();
  };
  const toOrder = () => {
    const p = new URLSearchParams({ appointment_id: f.id, note: [f.title, f.note].filter(Boolean).join('. ') });
    if (cust?.id) p.set('customer_id', cust.id); else { p.set('name', f.contact_name); p.set('phone', f.contact_phone); }
    if (f.car_id) p.set('car_id', f.car_id);
    go('/orders/new?' + p.toString());
  };
  return html`<${Modal} title=${f.id ? 'Запись' : 'Новая запись'} onClose=${onClose} wide foot=${html`
      ${f.id && html`<${ConfirmButton} cls="btn danger" onConfirm=${async () => { await act(() => api('appointments/' + f.id, { method: 'DELETE' }), 'Отменено'); onSaved(); }}>Отменить запись</${ConfirmButton}>`}
      <span style="flex:1"></span>
      ${f.order_id ? html`<a class="btn" href=${'#/orders/' + f.order_id} onClick=${onClose}>Открыть заказ</a>` : f.id ? html`<button class="btn" onClick=${toOrder}>Создать заказ</button>` : ''}
      <button class="btn primary" onClick=${save}>Сохранить</button>`}>
    <div class="grid g4">
      <label class="f">Пост<select value=${f.station_id} onChange=${(e) => set({ ...f, station_id: e.target.value })}><option value="">Не распределено</option>${app.stations.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>
      <label class="f">Дата<input type="date" value=${f.date} onInput=${(e) => set({ ...f, date: e.target.value })} /></label>
      <label class="f">Время<input type="time" step="900" value=${f.time} onInput=${(e) => set({ ...f, time: e.target.value })} /></label>
      <label class="f">Длительность<select value=${f.duration_min} onChange=${(e) => set({ ...f, duration_min: Number(e.target.value) })}>${[30, 60, 90, 120, 180, 240, 300, 360, 480].map((m) => html`<option value=${m}>${m < 60 ? m + ' мин' : m / 60 + ' ч'}</option>`)}</select></label>
    </div>
    <div class="grid g2">
      <div class="stack"><h3>Клиент</h3>
        ${cust ? html`<div class="row"><b class="grow">${cust.name || ''} <span class="muted">${cust.phone || ''}</span></b><button class="btn sm" onClick=${() => setCust(null)}>Сменить</button></div>`
          : html`<${Picker} placeholder="Клиент из базы…" path=${(q) => 'customers?q=' + encodeURIComponent(q)} render=${(c) => html`<b>${c.name || '—'}</b> <span class="sub">${c.phone || ''}</span>`} onPick=${setCust} />
            <div class="grid g2"><label class="f">Или имя (новый)<input value=${f.contact_name} onInput=${(e) => set({ ...f, contact_name: e.target.value })} /></label>
            <label class="f">Телефон<input value=${f.contact_phone} onInput=${(e) => set({ ...f, contact_phone: e.target.value })} /></label></div>`}
        ${cdata?.cars?.length ? html`<label class="f">Автомобиль<select value=${f.car_id || ''} onChange=${(e) => set({ ...f, car_id: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>
          ${cdata.cars.map((k) => html`<option value=${k.id}>${carName(k)} ${k.plate || ''}</option>`)}</select></label>` : ''}
      </div>
      <div class="stack"><h3>Что делаем</h3>
        <label class="f">Кратко<input value=${f.title} onInput=${(e) => set({ ...f, title: e.target.value })} placeholder="Замена масла, диагностика…" /></label>
        <label class="f">Заметка<textarea rows="2" value=${f.note} onInput=${(e) => set({ ...f, note: e.target.value })}></textarea></label>
        <div class="grid g2">
          <label class="f">Механик<select value=${f.mechanic_id} onChange=${(e) => set({ ...f, mechanic_id: e.target.value })}><option value="">—</option>${app.staff.filter((s) => s.active).map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>
          <label class="f">Статус<select value=${f.status} onChange=${(e) => set({ ...f, status: e.target.value })}>${Object.entries(STATUS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
        </div>
      </div>
    </div>
    ${a.preferred ? html`<div class="pos small">Клиент просил: ${a.preferred}</div>` : ''}
    ${a.source === 'app' ? html`<div class="muted small">Заявка из приложения · ${fdt(a.created_at)}</div>` : ''}
  </${Modal}>`;
}
