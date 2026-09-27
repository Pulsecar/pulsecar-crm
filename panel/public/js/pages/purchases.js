import { html, useState, useData, api, act, qs, useApp, ErrorBox, Icon, Modal, ConfirmButton, useDebounced, zl, fdate, todayStr } from '../lib.js';

const CATS = ['Запчасти', 'Расходники', 'Инструмент', 'Аренда', 'Коммунальные', 'Реклама', 'Зарплата', 'Прочее'];

export default function Purchases() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const dq = useDebounced(q);
  const { data, error, reload } = useData('purchases?' + qs({ q: dq }));
  return html`
    <div class="page-head"><h1>Закупки и расходы</h1>
      <div class="actions"><button class="btn primary" onClick=${() => setEdit({})}><${Icon} n="plus" />Фактура поставщика</button></div></div>
    <div class="grid g3" style="margin-bottom:12px">
      <div class="stat"><b>${zl(data?.totals.gross)}</b><span>Всего брутто (по фильтру)</span></div>
      <div class="stat"><b class=${data?.totals.due > 0 ? 'neg' : ''}>${zl(data?.totals.due)}</b><span>Не оплачено поставщикам</span></div>
      <div class="card small muted">Фактуры поставщиков можно будет подтягивать из KSeF автоматически, когда подключим интеграцию. Пока — вручную.</div>
    </div>
    <div class="card" style="margin-bottom:12px"><input type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Поставщик, номер, категория…" /></div>
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Дата</th><th>Номер</th><th>Поставщик</th><th>Категория</th><th>Срок оплаты</th><th class="r">Нетто</th><th class="r">Брутто</th><th class="r">Оплачено</th><th></th></tr></thead>
      <tbody>${(data?.rows || []).map((p) => html`<tr class="click" onClick=${() => setEdit(p)}>
        <td class="nowrap">${fdate(p.doc_date)}</td><td>${p.number || ''}</td><td><b>${p.supplier}</b><div class="sub">${p.description || ''}</div></td><td class="sub">${p.category || ''}</td>
        <td class=${'nowrap ' + (p.paid < p.gross && p.due_date && p.due_date < todayStr() ? 'neg' : '')}>${fdate(p.due_date)}</td>
        <td class="r">${zl(p.net)}</td><td class="r">${zl(p.gross)}</td><td class=${'r ' + (p.paid >= p.gross ? 'pos' : '')}>${zl(p.paid)}</td>
        <td class="act" onClick=${(e) => e.stopPropagation()}>${app.user.role === 'admin' && html`<${ConfirmButton} cls="icon-btn" onConfirm=${async () => { await act(() => api('purchases/' + p.id, { method: 'DELETE' })); reload(); }}><${Icon} n="trash" /></${ConfirmButton}>`}</td></tr>`)}</tbody></table></div>
      ${!data?.rows?.length ? html`<div class="empty">Пока пусто</div>` : ''}</div>`}
    ${edit && html`<${PurchaseForm} p=${edit} onClose=${() => setEdit(null)} onSaved=${() => { setEdit(null); reload(); }} />`}`;
}

function PurchaseForm({ p, onClose, onSaved }) {
  const [f, set] = useState({ id: p.id, supplier: p.supplier || '', number: p.number || '', category: p.category || 'Запчасти', description: p.description || '',
    doc_date: p.doc_date || todayStr(), due_date: p.due_date || '', net: p.net || '', gross: p.gross || '', paid: p.paid || 0 });
  const inp = (k, l, t = 'text') => html`<label class="f">${l}<input type=${t} step="0.01" value=${f[k]} onInput=${(e) => set({ ...f, [k]: e.target.value })} /></label>`;
  return html`<${Modal} title=${p.id ? 'Фактура поставщика' : 'Новая фактура поставщика'} onClose=${onClose} foot=${html`<button class="btn" onClick=${onClose}>Отмена</button>
      <button class="btn primary" onClick=${async () => { await act(() => api('purchases', { body: { ...f, net: Number(f.net), gross: Number(f.gross) || Number(f.net) * 1.23, paid: Number(f.paid) } }), 'Сохранено'); onSaved(); }}>Сохранить</button>`}>
    <div class="grid g2">${inp('supplier', 'Поставщик')}${inp('number', 'Номер фактуры')}</div>
    <div class="grid g3"><label class="f">Категория<select value=${f.category} onChange=${(e) => set({ ...f, category: e.target.value })}>${CATS.map((c) => html`<option>${c}</option>`)}</select></label>
      ${inp('doc_date', 'Дата', 'date')}${inp('due_date', 'Оплатить до', 'date')}</div>
    <div class="grid g3">${inp('net', 'Нетто', 'number')}${inp('gross', 'Брутто', 'number')}${inp('paid', 'Оплачено', 'number')}</div>
    ${inp('description', 'Описание')}
    <div class="row"><button class="btn sm" onClick=${() => set({ ...f, gross: (Number(f.net) * 1.23).toFixed(2) })}>Брутто = нетто + 23%</button>
      <button class="btn sm" onClick=${() => set({ ...f, paid: f.gross })}>Оплачено полностью</button></div>
  </${Modal}>`;
}
