import { html, useState, useData, api, act, qs, ErrorBox, Icon, Modal, Picker, ConfirmButton, useDebounced, zl, fdate, todayStr, carName } from '../lib.js';

export default function Storage() {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [edit, setEdit] = useState(null);
  const dq = useDebounced(q);
  const { data, error, reload } = useData('storage?' + qs({ q: dq, all: all ? 1 : '' }));
  const active = (data || []).filter((s) => !s.date_out);
  return html`
    <div class="page-head"><h1>Хранение шин</h1><span class="muted">${active.length} комплектов на хранении</span>
      <div class="actions"><button class="btn primary" onClick=${() => setEdit({})}><${Icon} n="plus" />Принять на хранение</button></div></div>
    <div class="card" style="margin-bottom:12px"><div class="row">
      <input class="grow" type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Номер, клиент, телефон, номер авто, размер, место…" />
      <label class="check"><input type="checkbox" checked=${all} onChange=${(e) => setAll(e.target.checked)} />Показать выданные</label></div></div>
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Номер</th><th>Клиент</th><th>Авто</th><th>Что</th><th class="r">Шт.</th><th>Место</th><th>Принято</th><th>Хранить до</th><th class="r">Цена</th><th></th></tr></thead>
      <tbody>${(data || []).map((s) => html`<tr class="click" onClick=${() => setEdit(s)} style=${s.date_out ? 'opacity:.5' : ''}>
        <td><b>${s.number}</b></td><td>${s.customer_name || ''}<div class="sub">${s.customer_phone || ''}</div></td>
        <td>${carName(s)} ${s.plate ? html`<span class="plate">${s.plate}</span>` : ''}</td><td>${s.kind === 'koła' ? 'Колёса' : 'Шины'}<div class="sub">${s.description || ''}</div></td>
        <td class="r">${s.qty}</td><td>${s.location || ''}</td><td class="nowrap">${fdate(s.date_in)}</td>
        <td class=${'nowrap ' + (!s.date_out && s.date_until && s.date_until < todayStr() ? 'neg' : '')}>${s.date_out ? 'выдано ' + fdate(s.date_out) : fdate(s.date_until)}</td>
        <td class="r">${s.price ? zl(s.price) : ''}</td>
        <td class="act" onClick=${(e) => e.stopPropagation()}>${!s.date_out && html`<${ConfirmButton} cls="btn sm" label="Выдать?" onConfirm=${async () => { await act(() => api(`storage/${s.id}/release`, { body: {} }), 'Выдано клиенту'); reload(); }}>Выдать</${ConfirmButton}>`}</td></tr>`)}</tbody></table></div>
      ${!data?.length ? html`<div class="empty">Пусто</div>` : ''}</div>`}
    ${edit && html`<${StorageForm} s=${edit} onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); reload(); }} />`}`;
}

function StorageForm({ s, onClose, onSaved }) {
  const inHalfYear = () => { const d = new Date(); d.setMonth(d.getMonth() + 6); return d.toISOString().slice(0, 10); };
  const [f, set] = useState({ id: s.id, customer_id: s.customer_id || null, car_id: s.car_id || null, kind: s.kind || 'opony', description: s.description || '', qty: s.qty || 4,
    location: s.location || '', date_in: s.date_in || todayStr(), date_until: s.date_until || inHalfYear(), price: s.price ?? 200, note: s.note || '' });
  const [cust, setCust] = useState(s.customer_id ? { id: s.customer_id, name: s.customer_name, phone: s.customer_phone } : null);
  const { data: cd } = useData(cust?.id ? 'customers/' + cust.id : null, [cust?.id]);
  const inp = (k, l, t = 'text') => html`<label class="f">${l}<input type=${t} value=${f[k]} onInput=${(e) => set({ ...f, [k]: e.target.value })} /></label>`;
  return html`<${Modal} title=${s.id ? s.number : 'Принять на хранение'} onClose=${onClose} wide foot=${html`<button class="btn" onClick=${onClose}>Отмена</button>
      <button class="btn primary" onClick=${async () => { await act(() => api('storage', { body: { ...f, customer_id: cust?.id } }), 'Сохранено'); onSaved(); }}>Сохранить</button>`}>
    <div class="grid g2">
      <div class="stack"><h3>Клиент</h3>${cust ? html`<div class="row"><b class="grow">${cust.name} <span class="muted">${cust.phone || ''}</span></b><button class="btn sm" onClick=${() => setCust(null)}>Сменить</button></div>`
        : html`<${Picker} placeholder="Клиент…" path=${(q) => 'customers?q=' + encodeURIComponent(q)} render=${(c) => html`<b>${c.name || '—'}</b> <span class="sub">${c.phone || ''}</span>`} onPick=${setCust} />`}
        ${cd?.cars?.length ? html`<label class="f">Авто<select value=${f.car_id || ''} onChange=${(e) => set({ ...f, car_id: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>
          ${cd.cars.map((k) => html`<option value=${k.id}>${carName(k)} ${k.plate || ''}</option>`)}</select></label>` : ''}</div>
      <div class="stack"><h3>Что храним</h3>
        <div class="grid g2"><label class="f">Тип<select value=${f.kind} onChange=${(e) => set({ ...f, kind: e.target.value })}><option value="opony">Шины</option><option value="koła">Колёса в сборе</option></select></label>${inp('qty', 'Штук', 'number')}</div>
        ${inp('description', 'Размер, марка, DOT, состояние')}</div>
    </div>
    <div class="grid g4">${inp('location', 'Место (стеллаж/полка)')}${inp('date_in', 'Принято', 'date')}${inp('date_until', 'Хранить до', 'date')}${inp('price', 'Цена за сезон, zł', 'number')}</div>
    ${inp('note', 'Заметка')}
  </${Modal}>`;
}
