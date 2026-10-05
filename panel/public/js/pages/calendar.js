// Терминарз как harmonogram в Motowarsztat: слева «Неназначенные» (заказы с часами работ и заявки),
// справа посты с загрузкой «4.5/9 ч»; заказы перетаскиваются на пост и время, карточки двигаются и растягиваются.
import {
  html, useState, useEffect, useRef, useData, api, act, go, useApp, Icon, Modal, Picker, ConfirmButton, todayStr, addDays, fdate, fdt, carName, toast, zl,
} from '../lib.js';
import { CustomerCarPicker } from './orders.js';
import { LineName } from './sales.js';

const SLOT_PX = 38; // высота 30-минутного слота — как в Motowarsztat, карточки читаются
const DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS1 = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const STATUS = { request: 'Заявка', planned: 'Запланировано', arrived: 'Клиент приехал', no_show: 'Не приехал', cancelled: 'Отменено', block: 'Блокировка' };
const h1 = (n) => `${Math.round(n * 100) / 100}`.replace('.', ',') + ' ч';
const store = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const isHours = (j) => !/szt|шт|us[lł]|kpl/i.test(j.unit || '');
// цвета записей без заказа (заявка, запланировано, приехал, не приехал) — меняются в легенде терминарза
const APPT_COLOR = { request: '#F0B429', planned: '#5B8DEF', arrived: '#1BF372', no_show: '#E34948', block: '#6B6E75' };
export const evColor = (a, S) => (a.status === 'block' ? S.cal_color_block || APPT_COLOR.block
  : a.order_id && a.status_color && a.status !== 'no_show' ? a.status_color : S['cal_color_' + a.status] || APPT_COLOR[a.status] || APPT_COLOR.planned);
const tint = (c) => `border-left-color:${c};`; // цвет статуса — только полоска слева, фон карточки нейтральный
/** Пересекающиеся по времени записи на одном посту — рядом, а не друг на друге */
function laneLayout(evs) {
  const out = new Map();
  const list = evs.map((a) => { const st = toMin(a.start_at.slice(11)); return { a, st, en: st + Math.max(15, a.duration_min || 0) }; }).sort((x, y) => x.st - y.st || y.en - x.en);
  let cluster = [], end = -1;
  const flush = () => { const ends = []; for (const e of cluster) { let i = ends.findIndex((x) => x <= e.st); if (i < 0) { i = ends.length; ends.push(0); } ends[i] = e.en; out.set(e.a.id, { i }); } for (const e of cluster) out.get(e.a.id).n = ends.length; cluster = []; };
  for (const e of list) { if (cluster.length && e.st >= end) { flush(); end = -1; } cluster.push(e); end = Math.max(end, e.en); }
  if (cluster.length) flush();
  return out;
}
const laneCss = (L) => (L && L.n > 1 ? `left:calc(${L.i} * 100% / ${L.n} + 3px);width:calc(100% / ${L.n} - 6px);right:auto;` : '');

export default function Calendar({ query }) {
  const app = useApp();
  const [date, setDate] = useState(query.date || todayStr());
  const [view, setView] = useState(store('pc_cal_view', 'day'));
  const [left, setLeft] = useState(store('pc_cal_left', '1') === '1');
  const [edit, setEdit] = useState(null);      // запись в графике
  const [create, setCreate] = useState(null);  // новый заказ в график
  const [choose, setChoose] = useState(null);  // клик по свободному окну → выбор: записать клиента / заказ / блокировка
  const [drag, setDrag] = useState(null);      // { type: 'appt' | 'order', id }
  const [over, setOver] = useState(null);
  const [q, setQ] = useState('');
  const linkOrder = query.order ? Number(query.order) : null;
  const range = view === 'day' ? [date, date] : view === 'week' ? [weekStart(date), addDays(weekStart(date), 6)] : monthRange(date);
  const { data, reload } = useData(`appointments?from=${range[0]}&to=${range[1]}`, [range[0], range[1]]);
  const start = toMin(app.settings.hours_start || '08:00');
  const end = toMin(app.settings.hours_end || '18:00');
  const step = Number(app.settings.slot_min || 30);
  const slots = [];
  for (let m = start; m < end; m += step) slots.push(m);
  const stations = app.stations;
  const canEdit = app.perms['calendar.edit'];
  useEffect(() => keep('pc_cal_view', view), [view]);
  useEffect(() => keep('pc_cal_left', left ? '1' : '0'), [left]);

  const put = async (id, body, msg) => { try { await act(() => api('appointments/' + id, { method: 'PUT', body }), msg); } finally { reload(); } };
  const dropOn = async (stationId, time, day = date) => {
    const d = drag; setDrag(null); setOver(null);
    if (!d || !canEdit) return;
    const at = `${day} ${hhmm(time)}`;
    if (d.type === 'appt') return put(d.id, { station_id: stationId, start_at: at }, 'Перенесено');
    try { await act(() => api('appointments', { body: { order_id: d.id, station_id: stationId, start_at: at } }), 'Заказ в графике'); } finally { reload(); }
  };
  const unschedule = async () => {
    const d = drag; setDrag(null); setOver(null);
    if (!d || d.type !== 'appt' || !canEdit) return;
    const a = [...(data?.rows || [])].find((x) => x.id === d.id);
    if (a?.order_id) { await act(() => api('appointments/' + a.id, { method: 'DELETE' }), 'Убрано из графика'); reload(); } else put(d.id, { station_id: null, start_at: null, status: 'request' }, 'Возвращено в неназначенные');
  };
  const newAt = (stationId, time, day = date) => {
    if (!canEdit) return;
    if (linkOrder) return (async () => { await act(() => api('appointments', { body: { order_id: linkOrder, station_id: stationId, start_at: `${day} ${hhmm(time)}` } }), 'Заказ в графике'); go('/orders/' + linkOrder); })();
    setChoose({ station_id: stationId, date: day, time: hhmm(time) }); // как в Motowarsztat: «Что добавить?» — визит / заказ / блокировка
  };
  // растягивание карточки за нижний край — меняем длительность
  const resize = (e, a) => {
    e.preventDefault(); e.stopPropagation();
    const y0 = e.clientY, d0 = a.duration_min, el = e.currentTarget.closest('.cal-ev');
    const was = el.draggable; el.draggable = false; el.classList.add('resizing');
    let dur = d0;
    const tip = document.createElement('div'); tip.className = 'hg-dur'; el.appendChild(tip);
    const show = () => { tip.textContent = `${h1(dur / 60)} · до ${hhmm(toMin(a.start_at.slice(11, 16)) + dur)}`; };
    show();
    const mv = (ev) => { dur = Math.max(step, Math.round((d0 + ((ev.clientY - y0) / SLOT_PX) * step) / step) * step); el.style.height = `${(dur / step) * SLOT_PX - 3}px`; show(); };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      tip.remove(); el.classList.remove('resizing'); el.draggable = was;
      el.dataset.justResized = '1'; setTimeout(() => { delete el.dataset.justResized; }, 250);
      if (dur !== d0) put(a.id, { duration_min: dur }, `Длительность: ${h1(dur / 60)}`);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };
  // клик по заказу в графике — сразу полный заказ (время/пост меняются перетаскиванием или во вкладке «Терминарз» заказа)
  const open = (e, a) => { if (e.currentTarget.dataset.justResized) return; if (a.order_id) return go('/orders/' + a.order_id); setEdit(a); };
  const [legend, setLegend] = useState(false);

  const d = new Date(date + 'T12:00:00');
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const shift = (n) => setDate(view === 'day' ? addDays(date, n) : view === 'week' ? addDays(date, 7 * n) : addMonths(date, n));
  const title = view === 'day' ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} (${DAYS_FULL[d.getDay()]})`
    : view === 'week' ? `${fdate(range[0])} — ${fdate(range[1])}` : `${MONTHS1[d.getMonth()]} ${d.getFullYear()}`;
  const rows = data?.rows || [];
  const ql = q.trim().toLowerCase();
  const match = (x) => !ql || [x.number, x.order_number, x.customer_name, x.contact_name, x.plate, x.make, x.model, x.title, x.complaint].some((v) => String(v || '').toLowerCase().includes(ql));
  const pending = [...(data?.orders || []).map((o) => ({ ...o, _t: 'order' })), ...(data?.unassigned || []).map((a) => ({ ...a, _t: 'appt' }))].filter(match);

  return html`
    <div class="page-head"><h1>Терминарз</h1></div>
    ${linkOrder && html`<div class="card" style="margin-bottom:12px;border-color:var(--accent)">Нажмите на свободное время на посту — заказ встанет в график. <a href="#/calendar">Отмена</a></div>`}
    <div class="hg-bar">
      <button class=${'btn' + (left ? ' on' : '')} onClick=${() => setLeft(!left)}>Неназначенные <span class="chip">${pending.length}</span><${Icon} n=${left ? 'left' : 'right'} /></button>
      <div class="btn-group"><button class="btn" onClick=${() => shift(-1)} aria-label="Назад"><${Icon} n="left" /></button>
        <button class="btn" onClick=${() => setDate(todayStr())}>Сегодня</button>
        <button class="btn" onClick=${() => shift(1)} aria-label="Вперёд"><${Icon} n="right" /></button></div>
      <button class="btn" title="Обновить" onClick=${reload}><${Icon} n="history" /></button>
      <input type="date" class="hg-date" value=${date} onInput=${(e) => e.target.value && setDate(e.target.value)} aria-label="Дата" />
      <div class="hg-title">${title}</div>
      <div class="btn-group">${[['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц']].map(([k, l]) => html`<button class=${'btn' + (view === k ? ' primary' : '')} onClick=${() => setView(k)}>${l}</button>`)}</div>
      ${canEdit && html`<button class="btn primary" onClick=${() => setChoose({ station_id: stations[0]?.id || '', date, time: '' })}><${Icon} n="plus" />Добавить</button>`}
      <button class=${'btn' + (legend ? ' on' : '')} onClick=${() => setLegend(!legend)} title="Цвета статусов">Цвета</button>
      ${app.perms['settings.manage'] && html`<a class="btn" href="#/settings/stations" title="Посты и часы работы"><${Icon} n="gear" /></a>`}
    </div>
    ${legend && html`<${Legend} app=${app} onChanged=${() => { app.reload(); reload(); }} />`}

    <div class=${'hg' + (left ? '' : ' no-left')}>
      ${left && html`<aside class=${'hg-left' + (drag?.type === 'appt' ? ' droppable' : '')} onDragOver=${(e) => drag?.type === 'appt' && e.preventDefault()} onDrop=${(e) => { e.preventDefault(); unschedule(); }}>
        <div class="hg-left-head"><b>Неназначенные элементы</b><span class="chip">${pending.length}</span></div>
        <input type="search" placeholder="Поиск: номер, клиент, авто…" value=${q} onInput=${(e) => setQ(e.target.value)} />
        ${drag?.type === 'appt' && html`<div class="hg-hint">Отпустите здесь, чтобы убрать из графика</div>`}
        <div class="hg-list">${pending.map((x) => x._t === 'order' ? html`
          <div class="hg-card" style=${x.status_color ? 'border-left:4px solid ' + x.status_color : ''} draggable=${canEdit} onDragStart=${(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag({ type: 'order', id: x.id }); }} onDragEnd=${() => { setDrag(null); setOver(null); }}>
            <div class="row"><${Icon} n="wrench" /><a href=${'#/orders/' + x.id} class="grow"><b>${x.number}</b></a>
              <span class="small">${h1(Math.max(0, (x.hours || 0) - x.planned_min / 60) || x.hours || 0)}</span>${x.jobs?.length ? html`<span class="chip">${x.jobs.length}</span>` : ''}
              ${canEdit && html`<button class="icon-btn sm" title="Поставить в график" onClick=${() => setCreate({ order: x, station_id: stations[0]?.id || '', date, time: '' })}><${Icon} n="cal" /></button>`}</div>
            ${x.customer_name && html`<div class="hg-line"><${Icon} n="user" />${x.customer_name}</div>`}
            ${(x.make || x.plate) && html`<div class="hg-line"><${Icon} n="car" />${carName(x)} ${x.plate ? html`<span class="plate">${x.plate}</span>` : ''}</div>`}
            ${x.status_name && html`<div class="hg-status"><i style=${'background:' + (x.status_color || 'var(--muted)')}></i>${x.status_name}${x.planned_min ? html` · <span class="muted">в графике ${h1(x.planned_min / 60)}</span>` : ''}</div>`}
          </div>` : html`
          <div class="hg-card req" draggable=${canEdit} onDragStart=${() => setDrag({ type: 'appt', id: x.id })} onDragEnd=${() => { setDrag(null); setOver(null); }} onClick=${() => setEdit(x)}>
            <div class="row"><${Icon} n="cal" /><b class="grow">${x.order_number || x.title || 'Заявка'}</b><span class="small">${h1((x.duration_min || 60) / 60)}</span></div>
            ${x.note && html`<div class="hg-note">${x.note}</div>`}
            ${(x.customer_name || x.contact_name) && html`<div class="hg-line"><${Icon} n="user" />${x.customer_name || x.contact_name} <span class="muted">${x.customer_phone || x.contact_phone || ''}</span></div>`}
            ${(x.make || x.plate) && html`<div class="hg-line"><${Icon} n="car" />${carName(x)} ${x.plate || ''}</div>`}
            ${x.preferred && html`<div class="hg-line pos">Желаемо: ${x.preferred}</div>`}
            <div class="faint small">${x.source === 'app' ? 'из приложения' : x.source === 'site' ? 'с сайта' : 'заявка'} · ${fdate(x.created_at)}</div>
          </div>`)}
          ${!pending.length ? html`<div class="empty small">${"Всё распределено"}</div>` : null}</div>
      </aside>`}

      ${!left && drag?.type === 'appt' && html`<div class="hg-drop-strip" onDragOver=${(e) => e.preventDefault()} onDrop=${(e) => { e.preventDefault(); unschedule(); }}>Отпустите здесь, чтобы убрать из графика</div>`}
      <div class="hg-main">
      ${view === 'day' ? html`
      <div class="cal" style=${`grid-template-columns:52px repeat(${stations.length}, minmax(230px,1fr))`}>
        <div class="cal-col-head corner"></div>
        ${stations.map((s, i) => {
          const busy = rows.filter((a) => a.station_id === s.id && a.status !== 'block').reduce((t, a) => t + a.duration_min, 0) / 60;
          const cap = Number(s.max_hours_day) || (end - start) / 60;
          const pct = Math.min(100, (busy / cap) * 100);
          const col = pct >= 100 ? 'var(--danger)' : pct >= 70 ? 'var(--warn)' : 'var(--accent)';
          return html`<div class="cal-col-head hg-head"><div class="row"><span class="hg-num" style=${'background:' + (s.color || 'var(--info)')}>${i + 1}</span><b class="grow hg-name" title=${s.name}>${s.name}</b>
            <span class="hg-load" style=${`color:${col};border-color:${col}`}>${String(Math.round(busy * 10) / 10).replace('.', ',')}/${String(cap).replace('.', ',')} ч</span></div>
            <div class="hg-bar-load"><i style=${`width:${pct}%;background:${col}`}></i></div></div>`;
        })}
        <div class="cal-time">${slots.map((m) => html`<div style=${`height:${SLOT_PX}px;line-height:${SLOT_PX}px`}>${m % 60 === 0 || step >= 60 ? hhmm(m) : hhmm(m)}</div>`)}</div>
        ${stations.map((s) => html`<div class="cal-col">
          ${slots.map((m) => {
            const key = s.id + ':' + m;
            return html`<div class=${'cal-slot' + ((m + step) % 60 === 0 ? ' hour' : '') + (over === key ? ' drop' : '')} style=${`height:${SLOT_PX}px`}
              onClick=${() => newAt(s.id, m)}
              onDragOver=${(e) => { if (!drag) return; e.preventDefault(); if (over !== key) setOver(key); }}
              onDrop=${(e) => { e.preventDefault(); dropOn(s.id, m); }} title=${hhmm(m)}></div>`;
          })}
          ${date === todayStr() && nowMin > start && nowMin < end ? html`<div class="cal-now" style=${`top:${((nowMin - start) / step) * SLOT_PX}px`}></div>` : ''}
          ${(() => { const sr = rows.filter((a) => a.station_id === s.id); const lanes = laneLayout(sr); return sr.map((a) => {
            const top = ((toMin(a.start_at.slice(11)) - start) / step) * SLOT_PX + 1;
            const h = Math.max(SLOT_PX - 3, (a.duration_min / step) * SLOT_PX - 3);
            const L = laneCss(lanes.get(a.id));
            if (a.status === 'block') return html`<div class="cal-ev block" style=${`top:${top}px;height:${h}px;${L}`} onClick=${() => setEdit(a)}>
              <b><${Icon} n="x" /> ${a.title || 'Занято'}</b>${canEdit && html`<i class="hg-resize" title="Потяните вниз или вверх, чтобы изменить время" onPointerDown=${(e) => resize(e, a)} onClick=${(e) => e.stopPropagation()}></i>`}</div>`;
            return html`<div class=${'cal-ev' + (a.status === 'request' ? ' request' : '') + (a.status === 'arrived' ? ' arrived' : '') + (a.status === 'no_show' ? ' noshow' : '') + (drag?.id === a.id && drag.type === 'appt' ? ' dragging' : '')}
                draggable=${canEdit} onDragStart=${(e) => { if (e.currentTarget.classList.contains('resizing')) { e.preventDefault(); return; } e.dataTransfer.effectAllowed = 'move'; setDrag({ type: 'appt', id: a.id }); }} onDragEnd=${() => { setDrag(null); setOver(null); }} onClick=${(e) => open(e, a)}
                style=${`top:${top}px;height:${h}px;${L}` + tint(evColor(a, app.settings))} title=${a.status_name ? 'Статус заказа: ' + a.status_name : STATUS[a.status] || ''}>
              <div class="row"><${Icon} n=${a.order_id ? 'wrench' : 'cal'} /><b class="grow">${a.order_number || a.title || 'Запись'}</b>
                ${a.part_total > 1 ? html`<span class="chip">${a.part_no}/${a.part_total}</span>` : ''}</div>
              ${(a.customer_name || a.contact_name) && html`<div class="hg-line"><${Icon} n="user" />${a.customer_name || a.contact_name}</div>`}
              ${(a.make || a.plate) && html`<div class="hg-line"><${Icon} n="car" />${carName(a)} ${a.plate || ''}</div>`}
              ${h > SLOT_PX * 1.5 ? html`<div class="hg-jobs">${(a.jobs || []).map((j) => html`<div class=${j.done ? 'done' : ''}><span class="grow">${j.name}</span>${isHours(j) ? html`<span>${h1(j.qty)}</span>` : ''}</div>`)}
                ${!a.jobs?.length && (a.order_complaint || a.note) ? html`<div class="muted">${a.order_complaint || a.note}</div>` : ''}</div>` : ''}
              ${a.status_name && h > SLOT_PX * 2.5 ? html`<div class="hg-st"><i style=${'background:' + evColor(a, app.settings)}></i>${a.status_name}${a.media_done ? ' · 📷' : ''}</div>` : ''}
              ${canEdit && html`<i class="hg-resize" title="Потяните вниз или вверх, чтобы изменить время" onPointerDown=${(e) => resize(e, a)} onClick=${(e) => e.stopPropagation()}></i>`}
            </div>`;
          }); })()}
        </div>`)}
      </div>` : view === 'week' ? html`
      <div class="week">${[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const day = addDays(range[0], i);
        const evs = rows.filter((a) => a.start_at.startsWith(day));
        const busy = evs.filter((a) => a.status !== 'block').reduce((t, a) => t + a.duration_min, 0) / 60;
        return html`<div class=${'day' + (day === todayStr() ? ' today' : '') + (over === 'w' + day ? ' drop' : '')}
            onDragOver=${(e) => { if (!drag) return; e.preventDefault(); setOver('w' + day); }} onDrop=${(e) => { e.preventDefault(); const s0 = stations[0]; if (s0) dropOn(drag?.type === 'appt' ? rows.find((x) => x.id === drag.id)?.station_id || s0.id : s0.id, drag?.type === 'appt' ? toMin(rows.find((x) => x.id === drag.id)?.start_at.slice(11) || hhmm(start)) : start, day); }}>
          <h4><a href="#" onClick=${(e) => { e.preventDefault(); setDate(day); setView('day'); }}>${DAYS[new Date(day + 'T12:00').getDay()]} ${fdate(day).slice(0, 5)}</a> <span class="faint">${busy ? h1(busy) : ''}</span></h4>
          ${evs.map((a) => html`<div class=${'ev' + (a.status === 'block' ? ' block' : '')} draggable=${canEdit} onDragStart=${() => setDrag({ type: 'appt', id: a.id })} onDragEnd=${() => { setDrag(null); setOver(null); }}
              style=${tint(evColor(a, app.settings))} onClick=${() => (a.order_id ? go('/orders/' + a.order_id) : setEdit(a))}>
            <b>${a.start_at.slice(11)}</b> ${a.order_number || a.title || ''}<div class="muted">${a.customer_name || a.contact_name || ''}</div><div class="muted">${carName(a)} ${a.plate || ''}</div></div>`)}
        </div>`;
      })}</div>` : html`
      <div class="month">${DAYS.slice(1).concat(DAYS[0]).map((n) => html`<div class="mh">${n}</div>`)}
        ${monthDays(date).map((day) => {
          const evs = rows.filter((a) => a.start_at.startsWith(day) && a.status !== 'block');
          const busy = evs.reduce((t, a) => t + a.duration_min, 0) / 60;
          const cap = stations.reduce((t, s) => t + (Number(s.max_hours_day) || (end - start) / 60), 0) || 1;
          return html`<div class=${'md' + (day.slice(0, 7) !== date.slice(0, 7) ? ' other' : '') + (day === todayStr() ? ' today' : '')} onClick=${() => { setDate(day); setView('day'); }}>
            <b>${Number(day.slice(8))}</b>${evs.length ? html`<div class="small">${evs.length} зак. · ${h1(busy)}</div><div class="hg-bar-load"><i style=${`width:${Math.min(100, (busy / cap) * 100)}%`}></i></div>` : ''}</div>`;
        })}</div>`}
      </div>
    </div>

    ${edit && html`<${ApptModal} a=${edit} onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); reload(); }} />`}
    ${choose && html`<${Modal} title="Что добавить?" onClose=${() => setChoose(null)}>
      <div class="add-choice">${[['visit', 'cal', 'Записать клиента', 'Запланировать визит клиента в сервис'], ['order', 'wrench', 'Создать заказ', 'Новый заказ на ремонт автомобиля'], ['block', 'x', 'Поставить блокировку', 'Заблокировать пост на выбранное время']]
        .map(([k, ic, t, d]) => html`<button type="button" class="add-opt" onClick=${() => { setCreate({ ...choose, mode: k }); setChoose(null); }}><span class="add-ico"><${Icon} n=${ic} /></span><span><b>${t}</b><span class="muted">${d}</span></span></button>`)}</div>
    </${Modal}>`}
    ${create && html`<${NewOrderModal} init=${create} onClose=${() => setCreate(null)} onSaved=${() => { setCreate(null); reload(); }} />`}`;
}

function weekStart(s) { const d = new Date(s + 'T12:00:00'); return addDays(s, -((d.getDay() + 6) % 7)); }
function addMonths(s, n) { const d = new Date(s + 'T12:00:00'); d.setDate(1); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }
function monthDays(s) { const first = s.slice(0, 8) + '01'; const st = weekStart(first); return Array.from({ length: 42 }, (_, i) => addDays(st, i)); }
function monthRange(s) { const days = monthDays(s); return [days[0], days[41]]; }

// ── Новый заказ сразу в график (или блокировка: отпуск, перерыв) ─────────────
function NewOrderModal({ init, onClose, onSaved }) {
  const app = useApp();
  const [mode, setMode] = useState(init.order ? 'existing' : init.mode || 'order');
  const [cc, setCc] = useState({ customer: null, car: null });
  const [f, setF] = useState({ station_id: init.station_id || '', date: init.date, time: init.time || app.settings.hours_start || '09:00', duration_min: init.order ? '' : 60, complaint: '', mechanic_id: '', title: '' });
  const [busy, setBusy] = useState(false);
  // работы и товары сразу при создании заказа (поиск по прайсу работ и складу)
  const LINE = () => ({ name: '', qty: 1, unit: 'oper', unit_gross: '', vat: 23, kind: 'labor' });
  const [lines, setLines] = useState([LINE()]);
  const setLn = (i, patch) => setLines((L) => L.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const lineSum = (l) => Math.round((Number(l.qty) || 0) * (Number(l.unit_gross) || 0) * 100) / 100;
  const total = lines.reduce((a, l) => a + lineSum(l), 0);
  const set = (p) => setF((v) => ({ ...v, ...p }));
  const slot = { station_id: f.station_id ? Number(f.station_id) : null, start_at: f.date && f.time ? `${f.date} ${f.time}` : null, duration_min: f.duration_min ? Number(f.duration_min) : undefined, mechanic_id: f.mechanic_id || null };
  const save = async (openAfter = true) => {
    setBusy(true);
    try {
      if (mode === 'visit') {
        if (!cc.customer && !cc.newCustomer?.name && !cc.newCustomer?.phone && !cc.car) return toast('Выберите клиента или авто', 'error');
        const who = cc.customer?.name || cc.newCustomer?.name || '';
        await act(() => api('appointments', { body: { ...slot, duration_min: Number(f.duration_min) || 60, status: 'planned', source: 'crm',
          customer_id: cc.customer?.id || null, car_id: cc.car?.id || null,
          contact_name: cc.customer ? null : cc.newCustomer?.name || null, contact_phone: cc.customer ? null : cc.newCustomer?.phone || null,
          title: (f.complaint.trim() || [carName(cc.car || {}), who].filter((x) => x && x !== '—').join(' · ') || 'Визит').slice(0, 120), note: f.note || null } }), 'Клиент записан');
      } else if (mode === 'block') {
        if (!f.title.trim()) return toast('Впишите причину: отпуск, перерыв…', 'error');
        await act(() => api('appointments', { body: { ...slot, duration_min: Number(f.duration_min) || 60, title: f.title, status: 'block' } }), 'Время заблокировано');
      } else if (mode === 'existing') {
        await act(() => api('appointments', { body: { ...slot, order_id: init.order.id } }), 'Заказ в графике');
      } else {
        if (!cc.customer && !cc.newCustomer?.name && !cc.newCustomer?.phone && !cc.car) return toast('Выберите клиента или авто', 'error');
        const items = lines.filter((l) => l.name.trim()).map((l) => ({ kind: l.kind === 'part' ? 'part' : 'labor', name: l.name.trim(), code: l.code || null, product_id: l.product_id || null,
          qty: Number(l.qty) || 1, unit: l.unit || (l.kind === 'part' ? 'szt.' : 'oper'), price: Number(l.unit_gross) || 0, vat: Number(l.vat ?? 23) }));
        const r = await act(() => api('orders', { body: { kind: 'order', customer_id: cc.customer?.id, car_id: cc.car?.id, new_customer: cc.customer ? null : cc.newCustomer,
          items, complaint: f.complaint, mechanic_id: f.mechanic_id || null, source: 'crm', appointment: { ...slot, duration_min: Number(f.duration_min) || 60, title: f.complaint.slice(0, 120) || undefined } } }), 'Заказ создан и поставлен в график');
        // как в Motowarsztat: сразу в заказ — добавлять работы и товары
        if (openAfter) { onClose(); go('/orders/' + r.id); return; }
      }
      onSaved();
    } catch {} finally { setBusy(false); }
  };
  return html`<${Modal} xl title=${mode === 'block' ? 'Блокировка времени' : mode === 'visit' ? 'Записать клиента' : mode === 'existing' ? 'Заказ ' + init.order.number + ' в график' : 'Новый заказ в терминарз'} onClose=${onClose}
    foot=${html`<button class="btn" style="margin-right:auto" onClick=${onClose}>Отмена</button>
      ${mode === 'order' && html`<button class="btn" disabled=${busy} onClick=${() => save(false)}>Только в график</button>`}
      <button class="btn primary" disabled=${busy} onClick=${() => save(true)}>${mode === 'block' ? 'Заблокировать' : mode === 'visit' ? 'Записать' : mode === 'existing' ? 'Поставить в график' : 'Создать и открыть заказ'}</button>`}>
    ${!init.order && html`<div class="seg sel">${[['visit', 'Записать клиента'], ['order', 'Заказ'], ['block', 'Блокировка (отпуск, перерыв)']].map(([k, l]) => html`<button type="button" class=${mode === k ? 'on' : ''} onClick=${() => setMode(k)}>${l}</button>`)}</div>`}
    <div class="grid g4">
      <label class="f">Пост<select value=${f.station_id} onChange=${(e) => set({ station_id: e.target.value })}><option value="">Не назначен</option>${app.stations.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>
      <label class="f">Дата<input type="date" value=${f.date} onInput=${(e) => set({ date: e.target.value })} /></label>
      <label class="f">Время<input type="time" step="900" value=${f.time} onInput=${(e) => set({ time: e.target.value })} /></label>
      <label class="f">Длительность<select value=${f.duration_min} onChange=${(e) => set({ duration_min: e.target.value })}>
        ${mode === 'existing' ? html`<option value="">По часам работ (${h1(Math.max(0.5, (init.order.hours || 1) - (init.order.planned_min || 0) / 60))})</option>` : ''}
        ${[30, 60, 90, 120, 180, 240, 300, 360, 480, 540].map((m) => html`<option value=${m}>${h1(m / 60)}</option>`)}</select></label>
    </div>
    ${mode === 'order' && html`<div class="grid g2 mw-top">
        <section class="mw-panel"><header>Автомобиль</header><${CustomerCarPicker} only="car" value=${cc} onChange=${setCc} /></section>
        <section class="mw-panel"><header>Клиент</header><${CustomerCarPicker} only="customer" value=${cc} onChange=${setCc} /></section></div>
      <div class="grid g2"><label class="f">Что делаем (видит клиент)<textarea rows="2" value=${f.complaint} placeholder="Замена масла, диагностика, геометрия…" onInput=${(e) => set({ complaint: e.target.value })}></textarea></label>
        <label class="f">Механик<select value=${f.mechanic_id} onChange=${(e) => set({ mechanic_id: e.target.value })}><option value="">—</option>${app.staff.filter((s) => s.active).map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label></div>
      <section class="mw-panel" style="margin-top:12px"><header>Работы и товары <span class="muted small" style="font-weight:400;text-transform:none">— начните печатать: поиск по прайсу работ и складу</span></header>
        <table class="tbl inv-lines"><thead><tr><th>Позиция</th><th>Тип</th><th class="r">Кол-во</th><th class="r">Цена брутто</th><th class="r">Сумма</th><th></th></tr></thead><tbody>
          ${lines.map((l, i) => html`<tr><td style="min-width:300px"><${LineName} rawUnit l=${l} onInput=${(v) => setLn(i, { name: v, product_id: null, catalog_id: null })} onPick=${(patch) => setLn(i, patch)} /></td>
            <td><select class="inline-input" style="width:100px" value=${l.kind} onChange=${(e) => setLn(i, { kind: e.target.value, unit: e.target.value === 'part' ? 'szt.' : 'oper' })}><option value="labor">Работа</option><option value="part">Товар</option></select></td>
            <td class="r"><input class="inline-input num qty" type="number" step="0.01" value=${l.qty} onInput=${(e) => setLn(i, { qty: e.target.value })} /></td>
            <td class="r"><input class="inline-input num price" type="number" step="0.01" placeholder="0,00" value=${l.unit_gross} onInput=${(e) => setLn(i, { unit_gross: e.target.value })} /></td>
            <td class="r nowrap">${zl(lineSum(l))}</td>
            <td class="act">${lines.length > 1 && html`<button class="icon-btn" onClick=${() => setLines(lines.filter((_, j) => j !== i))}><${Icon} n="trash" /></button>`}</td></tr>`)}</tbody></table>
        <div class="row" style="margin-top:8px"><button class="btn sm" onClick=${() => setLines([...lines, LINE()])}><${Icon} n="plus" />Позиция</button>
          <span class="grow"></span><span>Итого брутто: <b>${zl(total)}</b></span></div></section>
      <div class="muted small">Позиции можно не заполнять сейчас — после «Создать и открыть заказ» откроется заказ на вкладке «Работы и товары», там всё как обычно. Длительность в графике потом можно растянуть мышкой.</div>`}
    ${mode === 'visit' && html`<div class="grid g2 mw-top">
        <section class="mw-panel"><header>Автомобиль</header><${CustomerCarPicker} only="car" value=${cc} onChange=${setCc} /></section>
        <section class="mw-panel"><header>Клиент</header><${CustomerCarPicker} only="customer" value=${cc} onChange=${setCc} /></section></div>
      <div class="grid g2"><label class="f">Что делаем<input value=${f.complaint} placeholder="Замена масла, диагностика, шины…" onInput=${(e) => set({ complaint: e.target.value })} /></label>
        <label class="f">Механик<select value=${f.mechanic_id} onChange=${(e) => set({ mechanic_id: e.target.value })}><option value="">—</option>${app.staff.filter((s) => s.active).map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label></div>
      <label class="f">Заметка<textarea rows="2" value=${f.note || ''} onInput=${(e) => set({ note: e.target.value })}></textarea></label>
      <div class="muted small">Визит — запись без заказа. Когда клиент приедет, нажмите на визит в графике → «Создать заказ»: запись привяжется к заказу.</div>`}
    ${mode === 'block' && html`<label class="f">Причина<input value=${f.title} placeholder="Андрей — отпуск, обед, пост на ремонте…" onInput=${(e) => set({ title: e.target.value })} /></label>`}
    ${mode === 'existing' && html`<div class="card" style="background:var(--surface2)"><b>${init.order.number}</b> · ${init.order.customer_name || ''} · ${carName(init.order)} ${init.order.plate || ''}
      <div class="hg-jobs" style="margin-top:6px">${(init.order.jobs || []).map((j) => html`<div><span class="grow">${j.name}</span>${isHours(j) ? html`<span>${h1(j.qty)}</span>` : ''}</div>`)}</div></div>`}
  </${Modal}>`;
}

// ── Карточка записи в графике ───────────────────────────────────────────────
/** Части заказа в графике: один заказ можно поставить на разные посты / подъёмники и в разное время (как в Motowarsztat) */
export function OrderSlots({ orderId, currentId, onChanged, compact }) {
  const app = useApp();
  const canEdit = app.perms['calendar.edit'];
  const { data: o, reload } = useData(orderId ? 'orders/' + orderId : null, [orderId]);
  const [add, setAdd] = useState(null);
  const parts = (o?.appointments || []).filter((x) => x.status !== 'cancelled');
  const cur = parts.find((x) => x.id === currentId);
  const openAdd = () => {
    // по умолчанию — другой пост сразу после текущей части (одна машина не может стоять на двух подъёмниках одновременно)
    const base = cur || parts[parts.length - 1];
    const other = app.stations.find((s) => s.active !== 0 && s.id !== base?.station_id);
    const end = base?.start_at ? new Date(base.start_at.replace(' ', 'T')) : null;
    if (end) end.setMinutes(end.getMinutes() + (base.duration_min || 60));
    const pad = (n) => String(n).padStart(2, '0');
    setAdd({ station_id: other?.id || base?.station_id || app.stations[0]?.id || '', date: end ? `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}` : todayStr(),
      time: end ? `${pad(end.getHours())}:${pad(end.getMinutes())}` : (app.settings.hours_start || '08:00'), duration_min: 60 });
  };
  const save = async () => {
    await act(() => api('appointments', { body: { order_id: orderId, station_id: Number(add.station_id) || null, start_at: add.date && add.time ? `${add.date} ${add.time}` : null, duration_min: Number(add.duration_min) || 60 } }), 'Часть заказа добавлена в график');
    setAdd(null); reload(); onChanged?.();
  };
  const del = async (x) => { await act(() => api('appointments/' + x.id, { method: 'DELETE' }), 'Часть убрана из графика'); reload(); onChanged?.(); };
  if (!o) return '';
  const total = parts.reduce((a, x) => a + (x.duration_min || 0), 0);
  return html`<div class=${'slots' + (compact ? ' compact' : '')}>
    <div class="row" style="align-items:center;gap:8px"><b class="grow">Посты и время${parts.length > 1 ? ` · ${parts.length} части, всего ${h1(total / 60)}` : ''}</b>
      ${canEdit && !add && html`<button class="btn sm" onClick=${openAdd}><${Icon} n="plus" />Ещё пост / время</button>`}</div>
    ${parts.length ? html`<table class="tbl slots-tbl"><tbody>${parts.map((x, i) => html`<tr class=${x.id === currentId ? 'on' : ''}>
      <td class="sub">${i + 1}/${parts.length}</td><td class="nowrap"><b>${x.start_at ? fdt(x.start_at) : 'без времени'}</b></td><td>${x.station_name || 'не распределено'}</td><td class="sub nowrap">${h1((x.duration_min || 0) / 60)}</td>
      <td class="act nowrap">${x.id === currentId ? html`<span class="chip">эта запись</span>` : html`<a class="btn sm" href=${'#/calendar?date=' + (x.start_at || '').slice(0, 10)}>Показать</a>`}
        ${canEdit && x.id !== currentId && html`<${ConfirmButton} cls="icon-btn" label="Убрать эту часть?" onConfirm=${() => del(x)}><${Icon} n="trash" /></${ConfirmButton}>`}</td></tr>`)}</tbody></table>`
      : html`<div class="muted small">Заказ ещё не в графике</div>`}
    ${add && html`<div class="slot-add">
      <label class="f">Пост / подъёмник<select value=${add.station_id} onChange=${(e) => setAdd({ ...add, station_id: e.target.value })}>${app.stations.filter((s) => s.active !== 0).map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>
      <label class="f">Дата<input type="date" value=${add.date} onInput=${(e) => setAdd({ ...add, date: e.target.value })} /></label>
      <label class="f">Время<input type="time" step="900" value=${add.time} onInput=${(e) => setAdd({ ...add, time: e.target.value })} /></label>
      <label class="f">Длительность<select value=${add.duration_min} onChange=${(e) => setAdd({ ...add, duration_min: Number(e.target.value) })}>${[30, 60, 90, 120, 180, 240, 300, 360, 480].map((m) => html`<option value=${m}>${h1(m / 60)}</option>`)}</select></label>
      <div class="row" style="align-self:end;gap:6px"><button class="btn sm" onClick=${() => setAdd(null)}>Отмена</button><button class="btn primary sm" onClick=${save}>Добавить</button></div></div>`}
  </div>`;
}

function ApptModal({ a, onClose, onSaved }) {
  const app = useApp();
  const canEdit = app.perms['calendar.edit'];
  const [f, set] = useState({
    id: a.id, station_id: a.station_id ?? '', date: (a.start_at || '').slice(0, 10), time: (a.start_at || '').slice(11, 16), duration_min: a.duration_min || 60,
    title: a.title || '', note: a.note || '', status: a.status || 'planned', mechanic_id: a.mechanic_id || '',
    car_id: a.car_id || null, contact_name: a.contact_name || '', contact_phone: a.contact_phone || '',
  });
  const [cust, setCust] = useState(a.customer_id ? { id: a.customer_id, name: a.customer_name, phone: a.customer_phone } : null);
  const { data: cdata } = useData(cust?.id ? 'customers/' + cust.id : null, [cust?.id]);
  const body = () => {
    const b = { station_id: f.station_id ? Number(f.station_id) : null, start_at: f.date && f.time ? `${f.date} ${f.time}` : null, duration_min: Number(f.duration_min) || 60,
      title: f.title, note: f.note, status: f.status, mechanic_id: f.mechanic_id || null, customer_id: cust?.id || null, car_id: f.car_id || null,
      contact_name: f.contact_name || null, contact_phone: f.contact_phone || null };
    if (b.station_id && b.start_at && b.status === 'request') b.status = 'planned';
    return b;
  };
  const save = async () => { await act(() => api('appointments/' + f.id, { method: 'PUT', body: body() }), 'Сохранено'); onSaved(); };
  // заявка → полноценный заказ, запись остаётся в графике и привязывается к заказу
  const toOrder = async () => {
    await act(() => api('appointments/' + f.id, { method: 'PUT', body: body() }));
    const r = await act(() => api('orders', { body: { kind: 'order', appointment_id: f.id, customer_id: cust?.id || null, car_id: f.car_id || null,
      new_customer: cust ? null : (f.contact_name || f.contact_phone ? { name: f.contact_name, phone: f.contact_phone } : null),
      complaint: [f.title, f.note].filter(Boolean).join('. '), mechanic_id: f.mechanic_id || null } }), 'Заказ создан');
    onClose(); go('/orders/' + r.id);
  };
  const fromQuote = async () => {
    await act(() => api('appointments/' + f.id, { method: 'PUT', body: body() }));
    const r = await act(() => api('appointments/' + f.id + '/order-from-quote', { method: 'POST' }), 'Заказ создан из выцены ' + (a.quote_number || ''));
    onClose(); go('/orders/' + r.id);
  };
  const isBlock = a.status === 'block';
  return html`<${Modal} wide xl=${!!a.order_id} title=${isBlock ? 'Блокировка' : a.order_number ? 'Заказ ' + a.order_number : 'Заявка / запись'} onClose=${onClose} foot=${html`
      ${canEdit && html`<${ConfirmButton} cls="btn danger" label=${a.order_id ? 'Убрать из графика?' : 'Точно?'} onConfirm=${async () => { await act(() => api('appointments/' + f.id, { method: 'DELETE' }), a.order_id ? 'Убрано из графика — заказ в «Неназначенных»' : 'Удалено'); onSaved(); }}>${a.order_id ? 'Убрать из графика' : isBlock ? 'Удалить блокировку' : 'Отменить запись'}</${ConfirmButton}>`}
      <span style="flex:1"></span>
      ${a.order_id ? html`<a class="btn" href=${'#/orders/' + a.order_id} onClick=${onClose}>Открыть заказ</a>` : !isBlock && canEdit ? html`${a.quote_id && a.quote_number && html`<a class="btn ghost" href=${'#/quotes/' + a.quote_id} onClick=${onClose}>Выцена ${a.quote_number}</a>`}
        ${a.quote_id && a.quote_number
          ? html`<button class="btn" title="Позиции (работы и запчасти) берутся из выцены" onClick=${fromQuote}>${a.quote_order_id ? 'Открыть заказ по выцене' : 'Создать заказ из выцены'}</button>`
          : html`<button class="btn" onClick=${toOrder}>Создать заказ</button>`}` : ''}
      ${canEdit && html`<button class="btn primary" onClick=${save}>Сохранить</button>`}`}>
    <div class="grid g4">
      <label class="f">Пост<select value=${f.station_id} onChange=${(e) => set({ ...f, station_id: e.target.value })}><option value="">Не назначен</option>${app.stations.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>
      <label class="f">Дата<input type="date" value=${f.date} onInput=${(e) => set({ ...f, date: e.target.value })} /></label>
      <label class="f">Время<input type="time" step="900" value=${f.time} onInput=${(e) => set({ ...f, time: e.target.value })} /></label>
      <label class="f">Длительность<select value=${f.duration_min} onChange=${(e) => set({ ...f, duration_min: Number(e.target.value) })}>${[...new Set([30, 60, 90, 120, 180, 240, 300, 360, 480, 540, Number(f.duration_min)])].sort((x, y) => x - y).map((m) => html`<option value=${m}>${h1(m / 60)}</option>`)}</select></label>
    </div>
    ${isBlock ? html`<label class="f">Причина<input value=${f.title} onInput=${(e) => set({ ...f, title: e.target.value })} /></label>` : a.order_id ? html`
      <div class="card" style="background:var(--surface2)"><div class="row"><b class="grow">${a.order_number}</b>${a.status_name && html`<span class="badge st-c" style=${a.status_color ? '--st:' + a.status_color : ''}>${a.status_name}</span>`}</div>
        <div class="muted">${a.customer_name || ''} ${a.customer_phone || ''} · ${carName(a)} ${a.plate || ''}</div>
        ${a.order_complaint && html`<div style="margin-top:6px">${a.order_complaint}</div>`}
        <${OrderItems} a=${a} onStatus=${onSaved} /></div>
      ${!isBlock && html`<div class="card" style="background:var(--surface2);margin-top:10px"><${OrderSlots} orderId=${a.order_id} currentId=${a.id} onChanged=${onSaved} /></div>`}
      <div class="grid g2"><label class="f">Механик<select value=${f.mechanic_id} onChange=${(e) => set({ ...f, mechanic_id: e.target.value })}><option value="">—</option>${app.staff.filter((s) => s.active).map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>
        <label class="f">Статус записи<select value=${f.status} onChange=${(e) => set({ ...f, status: e.target.value })}>${['planned', 'arrived', 'no_show'].map((k) => html`<option value=${k}>${STATUS[k]}</option>`)}</select></label></div>` : html`
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
          <label class="f">Статус<select value=${f.status} onChange=${(e) => set({ ...f, status: e.target.value })}>${['request', 'planned', 'arrived', 'no_show'].map((k) => html`<option value=${k}>${STATUS[k]}</option>`)}</select></label>
        </div>
      </div>
    </div>
    ${a.preferred ? html`<div class="pos small">Клиент просил: ${a.preferred}</div>` : ''}
    ${a.source === 'app' ? html`<div class="muted small">Заявка из приложения · ${fdt(a.created_at)}</div>` : ''}
    <div class="muted small">«Создать заказ» превратит заявку в заказ — запись останется в графике и будет связана с заказом.</div>`}
  </${Modal}>`;
}

// ── Работы и товары заказа прямо в окне записи + смена статуса (цвет карточки) ──
function OrderItems({ a, onStatus }) {
  const app = useApp();
  const { data: o, error, reload } = useData(a.order_id ? 'orders/' + a.order_id : null, [a.order_id]);
  if (error) return a.jobs?.length ? html`<div class="hg-jobs" style="margin-top:6px">${a.jobs.map((j) => html`<div class=${j.done ? 'done' : ''}><span class="grow">${j.name}</span></div>`)}</div>` : '';
  if (!o) return html`<div class="muted small" style="margin-top:6px">Загружаю работы и товары…</div>`;
  const labor = o.items.filter((i) => i.kind === 'labor'), parts = o.items.filter((i) => i.kind === 'part');
  const toggle = async (it) => { await act(() => api(`orders/${o.id}/items/${it.id}`, { method: 'PUT', body: { done: it.done ? 0 : 1 } })); reload(); };
  const setStatus = async (sid) => { const r = await act(() => api(`orders/${o.id}/status`, { body: { status_id: Number(sid) } }), 'Статус изменён'); if (r?.sms || r?.email) toast('Уведомление клиенту — в карточке заказа'); onStatus(); };
  const sum = (x) => x.reduce((t, i) => t + (i.qty * i.price * (1 - (i.discount || 0) / 100)), 0);
  const money = (n) => (Number(n) || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł';
  return html`<div class="appt-order">
    ${app.perms['orders.status'] && html`<label class="f" style="max-width:320px">Статус заказа<select value=${o.status_id} onChange=${(e) => setStatus(e.target.value)} style=${`border-color:${o.status?.color || ''}`}>
      ${app.statuses.map((st) => html`<option value=${st.id}>${st.name}</option>`)}</select></label>`}
    <div class="grid g2" style="margin-top:8px">
      <div><h4 class="appt-h">Работы <span class="faint">${labor.length}</span></h4>
        ${labor.length ? html`<div class="appt-list">${labor.map((j) => html`<label class=${'appt-row' + (j.done ? ' done' : '')}>
          <input type="checkbox" checked=${!!j.done} onChange=${() => toggle(j)} /><span class="grow">${j.name}</span>
          <span class="faint nowrap">${Number(j.qty)} ${j.unit || ''}</span>${o.total !== null ? html`<span class="nowrap">${money(j.qty * j.price * (1 - (j.discount || 0) / 100))}</span>` : ''}</label>`)}</div>` : html`<div class="muted small">Работ нет</div>`}</div>
      <div><h4 class="appt-h">Товары <span class="faint">${parts.length}</span></h4>
        ${parts.length ? html`<div class="appt-list">${parts.map((p) => html`<div class="appt-row"><span class="grow">${p.name}${p.code ? html` <span class="faint small">${p.code}</span>` : ''}
          ${p.product_id && p.product_stock !== null && p.product_stock < p.qty ? html`<div class="stock-warn">нет на складе — заказать</div>` : ''}</span>
          <span class="faint nowrap">${Number(p.qty)} ${p.unit || 'szt.'}</span>${o.total !== null ? html`<span class="nowrap">${money(p.qty * p.price * (1 - (p.discount || 0) / 100))}</span>` : ''}</div>`)}</div>` : html`<div class="muted small">Товаров нет</div>`}</div>
    </div>
    ${o.total !== null ? html`<div class="row small" style="margin-top:6px;justify-content:flex-end"><span class="muted">Работы ${money(sum(labor))} · товары ${money(sum(parts))} ·</span><b>итого ${money(o.total)}</b></div>` : ''}
    ${o.mechanic_note ? html`<div class="small" style="margin-top:6px"><span class="muted">Для механика:</span> ${o.mechanic_note}</div>` : ''}
    ${o.media_done ? html`<div class="small pos" style="margin-top:4px">📷 Фото/видео до/после загружены (${o.media_done_by || ''})</div>` : ''}
  </div>`;
}

// ── Легенда цветов: статусы заказов и записи без заказа, цвет меняется прямо здесь ──
function Legend({ app, onChanged }) {
  const can = app.perms['settings.manage'];
  const S = app.settings;
  const setOrder = async (st, color) => { await act(() => api('dict/statuses', { body: { ...st, color } }), 'Цвет статуса сохранён'); onChanged(); };
  const setAppt = async (k, color) => { await act(() => api('settings', { method: 'PUT', body: { ['cal_color_' + k]: color } }), 'Цвет сохранён'); onChanged(); };
  const sw = (color, onPick) => can ? html`<input type="color" class="sw" value=${color} onChange=${(e) => onPick(e.target.value)} title="Изменить цвет" />` : html`<i class="sw" style=${'background:' + color}></i>`;
  return html`<div class="card hg-legend">
    <div class="row wrap"><b class="small">Заказ по статусу:</b>
      ${app.statuses.map((st) => html`<span class="lg">${sw(st.color || '#5B8DEF', (c) => setOrder(st, c))}${st.name}</span>`)}</div>
    <div class="row wrap"><b class="small">Записи без заказа:</b>
      ${['request', 'planned', 'arrived', 'no_show', 'block'].map((k) => html`<span class="lg">${sw(S['cal_color_' + k] || APPT_COLOR[k], (c) => setAppt(k, c))}${STATUS[k]}</span>`)}</div>
    <div class="muted small">${can ? 'Нажмите на цвет, чтобы поменять. ' : ''}Карточка в графике окрашивается по статусу заказа — поменяли статус, поменялся цвет.</div>
  </div>`;
}
