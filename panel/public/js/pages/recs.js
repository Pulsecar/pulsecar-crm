// Сервисная книжка: рекомендации «что пора сделать» по авто. Используется в заказе (вкладка «Рекомендации»)
// и в карточке авто. Клиент видит открытые рекомендации на pulsecar.pl/moje-auto и в приложении.
import { html, useState, useEffect, api, act, toast, fdate, zl, num, addDays, todayStr, Icon, ConfirmButton } from '../lib.js';

export const PRIO = { urgent: ['Срочно', '#E34948'], soon: ['Скоро', '#F0B429'], later: ['Планово', '#5B8DEF'] };
const STATUS = { open: 'Открыта', done: 'Сделано', dismissed: 'Отклонена' };
let presetsCache = null;

function addMonths(n) { const d = new Date(todayStr() + 'T12:00:00'); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); }
const empty = { title: '', note: '', priority: 'soon', due_date: '', due_km: '', est_price: '' };

/** Список рекомендаций + форма добавления. car — авто ({id, last_mileage}), orderId — заказ, в котором выявлено (может быть пустым). */
export function Recommendations({ car, orderId, recs, reload, fromChecklist }) {
  const [f, setF] = useState(empty);
  const [presets, setPresets] = useState(presetsCache || []);
  const [edit, setEdit] = useState(null);
  const [showClosed, setShowClosed] = useState(false);
  useEffect(() => { if (!presetsCache) api('recommendations/presets').then((r) => { presetsCache = r.presets; setPresets(r.presets); }).catch(() => {}); }, []);
  if (!car?.id) return html`<div class="card muted">Сначала выберите автомобиль в заказе — рекомендации привязываются к авто.</div>`;
  const mileage = Number(car.last_mileage) || 0;
  const usePreset = (p) => setF({ ...f, title: p.title, priority: p.priority || 'soon', due_date: p.months ? addMonths(p.months) : '', due_km: p.km && mileage ? String(mileage + p.km) : '' });
  const save = async () => {
    if (!f.title.trim()) return toast('Напишите, что рекомендуется', 'error');
    await act(() => api('recommendations', { body: { ...f, car_id: car.id, order_id: orderId || null } }), 'Рекомендация добавлена');
    setF(empty); reload();
  };
  const upd = async (r, body, msg) => { await act(() => api('recommendations/' + r.id, { method: 'PUT', body }), msg); setEdit(null); reload(); };
  const open = recs.filter((r) => r.status === 'open');
  const closed = recs.filter((r) => r.status !== 'open');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const due = (r) => [r.due_date && `до ${fdate(r.due_date)}`, r.due_km && `при ${num(r.due_km)} km`].filter(Boolean).join(' или ');
  const overdue = (r) => (r.due_date && r.due_date < todayStr()) || (r.due_km && mileage && r.due_km <= mileage);

  return html`<div class="stack">
    <div class="card stack">
      <div class="row"><h2 class="grow" style="margin:0">Что рекомендовать клиенту</h2>
        ${fromChecklist && html`<button class="btn sm" title="Пункты чек-листа с «Внимание» и «Заменить»" onClick=${fromChecklist}><${Icon} n="list" />Из чек-листа</button>`}</div>
      <div class="muted small">Клиент увидит это в сервисной книжке на pulsecar.pl/moje-auto и в приложении, с кнопкой «Записаться». Перед сроком клиенту придёт SMS-напоминание (Настройки → SMS и шаблоны).</div>
      ${presets.length > 0 && html`<div class="row" style="flex-wrap:wrap;gap:6px">${presets.map((p) => html`<button class="btn sm ghost" onClick=${() => usePreset(p)}>${p.title}</button>`)}</div>`}
      <div class="grid g3">
        <label class="f" style="grid-column:span 2">Что сделать<input value=${f.title} onInput=${set('title')} placeholder="напр. Wymiana klocków hamulcowych przód" maxlength="160" /></label>
        <label class="f">Важность<select value=${f.priority} onChange=${set('priority')}>${Object.entries(PRIO).map(([k, [l]]) => html`<option value=${k}>${l}</option>`)}</select></label>
        <label class="f">Срок (дата)<input type="date" value=${f.due_date} onInput=${set('due_date')} /></label>
        <label class="f">или при пробеге, km${mileage ? html` <span class="faint">(сейчас ${num(mileage)})</span>` : ''}<input type="number" min="0" step="500" value=${f.due_km} onInput=${set('due_km')} /></label>
        <label class="f">Ориентировочная цена, zł<input inputmode="decimal" value=${f.est_price} onInput=${set('est_price')} placeholder="необязательно" /></label>
      </div>
      <label class="f">Пояснение для клиента<textarea rows="2" value=${f.note} onInput=${set('note')} placeholder="напр. Klocki 3 mm, tarcze jeszcze OK. Zalecamy wymianę w ciągu 2–3 miesięcy." maxlength="1000"></textarea></label>
      <div class="row"><span class="grow"></span><button class="btn primary" onClick=${save}><${Icon} n="plus" />Добавить рекомендацию</button></div>
    </div>

    <div class="card tight">
      <div class="row" style="padding:12px 14px"><h2 class="grow" style="margin:0">Открытые рекомендации по авто · ${open.length}</h2>
        ${closed.length > 0 && html`<button class="btn sm ghost" onClick=${() => setShowClosed(!showClosed)}>${showClosed ? 'Скрыть' : 'Показать'} закрытые (${closed.length})</button>`}</div>
      ${open.length === 0 && html`<div class="empty">Открытых рекомендаций нет</div>`}
      <table class="tbl"><tbody>
        ${[...open, ...(showClosed ? closed : [])].map((r) => edit === r.id ? html`<tr><td colspan="4"><${EditRow} r=${r} onSave=${(b) => upd(r, b, 'Сохранено')} onCancel=${() => setEdit(null)} /></td></tr>` : html`<tr style=${r.status !== 'open' ? 'opacity:.55' : ''}>
          <td style="width:90px"><span class="chip" style=${`background:${PRIO[r.priority]?.[1]}26;color:${PRIO[r.priority]?.[1]}`}>${PRIO[r.priority]?.[0]}</span></td>
          <td><b>${r.title}</b>${r.note ? html`<div class="sub">${r.note}</div>` : ''}
            <div class="sub">${due(r) ? html`<span class=${overdue(r) && r.status === 'open' ? 'neg' : ''}>${due(r)}</span> · ` : ''}${r.est_price ? zl(r.est_price) + ' · ' : ''}выявлено ${fdate(r.created_at)}${r.order_no ? ' в ' + r.order_no : ''}${r.staff ? ' · ' + r.staff : ''}${r.reminded_at ? ' · SMS ' + fdate(r.reminded_at) : ''}
            ${r.status !== 'open' ? html` · <b>${STATUS[r.status]}</b>${r.closed_order_no ? ' в ' + r.closed_order_no : ''} ${fdate(r.closed_at)}` : ''}</div></td>
          <td class="nowrap r">${r.status === 'open'
            ? html`<button class="btn sm pos" title="Сделано" onClick=${() => upd(r, { status: 'done' }, 'Отмечено как сделанное')}><${Icon} n="check" /></button>
              <button class="btn sm ghost" title="Изменить" onClick=${() => setEdit(r.id)}><${Icon} n="edit" /></button>
              <button class="btn sm ghost" title="Клиент отказался / неактуально" onClick=${() => upd(r, { status: 'dismissed' }, 'Рекомендация закрыта')}><${Icon} n="x" /></button>`
            : html`<button class="btn sm ghost" onClick=${() => upd(r, { status: 'open' }, 'Рекомендация снова открыта')}>Открыть</button>`}
            <${ConfirmButton} cls="btn sm ghost" onConfirm=${async () => { await act(() => api('recommendations/' + r.id, { method: 'DELETE' }), 'Удалено'); reload(); }}><${Icon} n="trash" /></${ConfirmButton}></td></tr>`)}
      </tbody></table>
      <div class="muted small" style="padding:10px 14px">Когда заказ с такой работой завершается, рекомендация закрывается сама.</div>
    </div>
  </div>`;
}

function EditRow({ r, onSave, onCancel }) {
  const [f, setF] = useState({ title: r.title, note: r.note || '', priority: r.priority, due_date: r.due_date || '', due_km: r.due_km ?? '', est_price: r.est_price ?? '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return html`<div class="stack">
    <div class="grid g3">
      <label class="f" style="grid-column:span 2">Что сделать<input value=${f.title} onInput=${set('title')} /></label>
      <label class="f">Важность<select value=${f.priority} onChange=${set('priority')}>${Object.entries(PRIO).map(([k, [l]]) => html`<option value=${k}>${l}</option>`)}</select></label>
      <label class="f">Срок<input type="date" value=${f.due_date} onInput=${set('due_date')} /></label>
      <label class="f">При пробеге, km<input type="number" value=${f.due_km} onInput=${set('due_km')} /></label>
      <label class="f">Цена, zł<input value=${f.est_price} onInput=${set('est_price')} /></label>
    </div>
    <label class="f">Пояснение<textarea rows="2" value=${f.note} onInput=${set('note')}></textarea></label>
    <div class="row"><span class="grow"></span><button class="btn" onClick=${onCancel}>Отмена</button><button class="btn primary" onClick=${() => onSave(f)}>Сохранить</button></div>
  </div>`;
}
