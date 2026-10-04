import { html, useState, useData, api, act, qs, ErrorBox, Icon, Modal, Picker, ConfirmButton, useDebounced, zl, fdate, todayStr, carName, METHOD } from '../lib.js';

const KIND = { opony: 'Шины', 'koła': 'Колёса', parking: 'Парковка' };
const daysBetween = (a, b) => Math.max(1, Math.round((new Date((b || todayStr()) + 'T12:00') - new Date(a + 'T12:00')) / 86400000) + 1);
/** Сколько к оплате: хранение — цена за сезон, парковка — сутки × цена (по день выдачи или сегодня) */
export const storageDue = (s) => (s.kind === 'parking' ? Math.round(daysBetween(s.date_in, s.date_out || todayStr()) * (Number(s.price) || 0) * 100) / 100 : Number(s.price) || 0);

export default function Storage() {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [kind, setKind] = useState('');
  const [edit, setEdit] = useState(null);
  const [pay, setPay] = useState(null);
  const dq = useDebounced(q);
  const { data, error, reload } = useData('storage?' + qs({ q: dq, all: all ? 1 : '' }));
  const rows = (data || []).filter((s) => !kind || (kind === 'parking' ? s.kind === 'parking' : s.kind !== 'parking'));
  const active = (data || []).filter((s) => !s.date_out);
  const tires = active.filter((s) => s.kind !== 'parking').length, cars = active.filter((s) => s.kind === 'parking').length;
  const debt = active.reduce((t, s) => t + Math.max(0, storageDue(s) - (s.paid || 0)), 0);
  return html`
    <div class="page-head"><h1>Хранение шин и парковка</h1><span class="muted">${tires} компл. шин · ${cars} авто на парковке${debt > 0.01 ? html` · <span class="neg">к оплате ${zl(debt)}</span>` : ''}</span>
      <div class="actions"><button class="btn" onClick=${() => setEdit({ kind: 'parking' })}><${Icon} n="car" />Поставить на парковку</button>
        <button class="btn primary" onClick=${() => setEdit({})}><${Icon} n="plus" />Принять шины на хранение</button></div></div>
    <div class="card" style="margin-bottom:12px"><div class="row">
      <div class="seg sel">${[['', 'Всё'], ['tires', 'Шины / колёса'], ['parking', 'Парковка']].map(([k, l]) => html`<button class=${kind === k ? 'on' : ''} onClick=${() => setKind(k)}>${l}</button>`)}</div>
      <input class="grow" type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Номер, клиент, телефон, номер авто, размер, место…" />
      <label class="check"><input type="checkbox" checked=${all} onChange=${(e) => setAll(e.target.checked)} />Показать выданные</label></div></div>
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Номер</th><th>Клиент</th><th>Авто</th><th>Что</th><th class="r">Шт.</th><th>Место</th><th>Принято</th><th>До / выдано</th><th class="r">Сумма</th><th class="r">Оплачено</th><th></th></tr></thead>
      <tbody>${rows.map((s) => {
        const due = storageDue(s), left = Math.round((due - (s.paid || 0)) * 100) / 100;
        return html`<tr class="click" onClick=${() => setEdit(s)} style=${s.date_out ? 'opacity:.5' : ''}>
        <td><b>${s.number}</b></td><td>${s.customer_name || ''}<div class="sub">${s.customer_phone || ''}</div></td>
        <td>${carName(s)} ${s.plate ? html`<span class="plate">${s.plate}</span>` : ''}</td>
        <td>${s.kind === 'parking' ? html`<span class="chip">Парковка</span>` : KIND[s.kind] || 'Шины'}<div class="sub">${s.description || ''}</div></td>
        <td class="r">${s.kind === 'parking' ? '' : s.qty}</td><td>${s.location || ''}</td><td class="nowrap">${fdate(s.date_in)}</td>
        <td class=${'nowrap ' + (!s.date_out && s.date_until && s.date_until < todayStr() ? 'neg' : '')}>${s.date_out ? 'выдано ' + fdate(s.date_out) : fdate(s.date_until)}</td>
        <td class="r nowrap">${due ? zl(due) : ''}${s.kind === 'parking' && s.price ? html`<div class="sub">${daysBetween(s.date_in, s.date_out)} сут. × ${zl(s.price)}</div>` : ''}</td>
        <td class=${'r nowrap ' + (due > 0 && left <= 0.01 ? 'pos' : left > 0.01 && s.paid ? '' : 'faint')}>${s.paid ? zl(s.paid) : '—'}${left > 0.01 && s.paid ? html`<div class="sub neg">долг ${zl(left)}</div>` : ''}</td>
        <td class="act nowrap" onClick=${(e) => e.stopPropagation()}>
          ${left > 0.01 && html`<button class="btn sm" onClick=${() => setPay({ s, amount: left, method: 'cash' })}><${Icon} n="cash" />Оплата</button>`}
          ${!s.date_out && html`<${ConfirmButton} cls="btn sm" label="Выдать?" onConfirm=${async () => { await act(() => api(`storage/${s.id}/release`, { body: {} }), s.kind === 'parking' ? 'Авто выдано' : 'Выдано клиенту'); reload(); }}>Выдать</${ConfirmButton}>`}</td></tr>`;
      })}</tbody></table></div>
      ${!rows.length ? html`<div class="empty">Пусто</div>` : ''}</div>`}
    ${edit && html`<${StorageForm} s=${edit} onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); reload(); }} />`}
    ${pay && html`<${Modal} title=${`Оплата ${pay.s.kind === 'parking' ? 'парковки' : 'хранения'} · ${pay.s.number}`} onClose=${() => setPay(null)} foot=${html`<button class="btn" onClick=${() => setPay(null)}>Отмена</button>
        <button class="btn primary" onClick=${async () => { await act(() => api(`storage/${pay.s.id}/pay`, { body: { amount: pay.amount, method: pay.method } }), 'Оплата принята — приход в кассе'); setPay(null); reload(); }}>Принять ${zl(pay.amount)}</button>`}>
      <div class="muted small" style="margin-bottom:8px">${pay.s.customer_name || ''} · к оплате ${zl(storageDue(pay.s))}${pay.s.paid ? ` · уже оплачено ${zl(pay.s.paid)}` : ''}</div>
      <div class="grid g2"><label class="f">Сумма, zł<input type="number" step="0.01" value=${pay.amount} onInput=${(e) => setPay({ ...pay, amount: Number(e.target.value) })} /></label>
        <label class="f">Способ<select value=${pay.method} onChange=${(e) => setPay({ ...pay, method: e.target.value })}>${['cash', 'card', 'blik', 'transfer'].map((m) => html`<option value=${m}>${METHOD[m]}</option>`)}</select></label></div>
      <div class="muted small">Оплата попадёт в кассу как приход (KP) с пометкой ${pay.s.kind === 'parking' ? '«Parking»' : '«Przechowanie opon»'} и номером ${pay.s.number}.</div></${Modal}>`}`;
}

function StorageForm({ s, onClose, onSaved }) {
  const parking0 = s.kind === 'parking';
  const inHalfYear = () => { const d = new Date(); d.setMonth(d.getMonth() + 6); return d.toISOString().slice(0, 10); };
  const [f, set] = useState({ id: s.id, customer_id: s.customer_id || null, car_id: s.car_id || null, kind: s.kind || 'opony', description: s.description || '', qty: s.qty || 4,
    location: s.location || '', date_in: s.date_in || todayStr(), date_until: s.date_until || (parking0 ? '' : inHalfYear()), price: s.price ?? (parking0 ? 30 : 200), note: s.note || '' });
  const [cust, setCust] = useState(s.customer_id ? { id: s.customer_id, name: s.customer_name, phone: s.customer_phone } : null);
  const { data: cd } = useData(cust?.id ? 'customers/' + cust.id : null, [cust?.id]);
  const parking = f.kind === 'parking';
  const inp = (k, l, t = 'text') => html`<label class="f">${l}<input type=${t} value=${f[k]} onInput=${(e) => set({ ...f, [k]: e.target.value })} /></label>`;
  const due = storageDue({ ...f, date_out: s.date_out });
  return html`<${Modal} title=${s.id ? s.number : parking ? 'Поставить авто на парковку' : 'Принять на хранение'} onClose=${onClose} wide foot=${html`<button class="btn" onClick=${onClose}>Отмена</button>
      <button class="btn primary" onClick=${async () => { await act(() => api('storage', { body: { ...f, customer_id: cust?.id } }), 'Сохранено'); onSaved(); }}>Сохранить</button>`}>
    <div class="grid g2">
      <div class="stack"><h3>Клиент</h3>${cust ? html`<div class="row"><b class="grow">${cust.name} <span class="muted">${cust.phone || ''}</span></b><button class="btn sm" onClick=${() => setCust(null)}>Сменить</button></div>`
        : html`<${Picker} placeholder="Клиент…" path=${(q) => 'customers?q=' + encodeURIComponent(q)} render=${(c) => html`<b>${c.name || '—'}</b> <span class="sub">${c.phone || ''}</span>`} onPick=${setCust} />`}
        ${cd?.cars?.length ? html`<label class="f">Авто<select value=${f.car_id || ''} onChange=${(e) => set({ ...f, car_id: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>
          ${cd.cars.map((k) => html`<option value=${k.id}>${carName(k)} ${k.plate || ''}</option>`)}</select></label>` : ''}</div>
      <div class="stack"><h3>${parking ? 'Парковка' : 'Что храним'}</h3>
        <div class="grid g2"><label class="f">Тип<select value=${f.kind} onChange=${(e) => set({ ...f, kind: e.target.value, price: e.target.value === 'parking' ? (f.kind === 'parking' ? f.price : 30) : f.kind === 'parking' ? 200 : f.price })}>
          <option value="opony">Шины</option><option value="koła">Колёса в сборе</option><option value="parking">Парковка авто</option></select></label>${parking ? '' : inp('qty', 'Штук', 'number')}</div>
        ${inp('description', parking ? 'Описание (ключи, документы, состояние)' : 'Размер, марка, DOT, состояние')}</div>
    </div>
    <div class="grid g4">${inp('location', parking ? 'Место на парковке' : 'Место (стеллаж/полка)')}${inp('date_in', parking ? 'С (дата)' : 'Принято', 'date')}${inp('date_until', parking ? 'Плановая выдача' : 'Хранить до', 'date')}${inp('price', parking ? 'Цена за сутки, zł' : 'Цена за сезон, zł', 'number')}</div>
    <div class="row small" style="margin:-4px 0 10px"><span class="muted">К оплате:</span> <b>${zl(due)}</b>${parking ? html`<span class="muted">(${daysBetween(f.date_in, s.date_out)} сут. по ${zl(f.price)}${s.date_out ? '' : ', по сегодня'})</span>` : ''}${s.paid ? html`<span class="muted">· оплачено ${zl(s.paid)}</span>` : ''}</div>
    ${inp('note', 'Заметка')}
  </${Modal}>`;
}
