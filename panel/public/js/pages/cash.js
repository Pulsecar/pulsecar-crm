import { html, useState, useData, api, act, qs, ErrorBox, Icon, Modal, zl, fdt, todayStr, METHOD } from '../lib.js';

export default function Cash() {
  const t = todayStr();
  const [from, setFrom] = useState(t.slice(0, 8) + '01');
  const [to, setTo] = useState(t);
  const [doc, setDoc] = useState(null);
  const { data, error, reload } = useData('cash?' + qs({ from, to }));
  return html`
    <div class="page-head"><h1>Касса</h1>
      <div class="actions"><button class="btn" onClick=${() => setDoc({ direction: 'out', amount: '', note: '' })}>Расход KW</button>
        <button class="btn primary" onClick=${() => setDoc({ direction: 'in', amount: '', note: '' })}>Приход KP</button></div></div>
    <div class="grid g4" style="margin-bottom:12px">
      <div class="stat accent"><b>${zl(data?.cashBalance)}</b><span>Наличных в кассе сейчас</span></div>
      <div class="stat"><b>${zl(data?.period.cashIn)}</b><span>Наличные за период · расход ${zl(data?.period.cashOut)}</span></div>
      <div class="stat"><b>${zl(data?.period.card)}</b><span>Картой за период</span></div>
      <div class="stat"><b>${zl(data?.period.transfer)}</b><span>Переводом · баллами ${zl(data?.period.points)}</span></div>
    </div>
    <div class="card" style="margin-bottom:12px"><div class="row end">
      <label class="f" style="width:160px">С<input type="date" value=${from} onInput=${(e) => setFrom(e.target.value)} /></label>
      <label class="f" style="width:160px">По<input type="date" value=${to} onInput=${(e) => setTo(e.target.value)} /></label>
      <button class="btn sm" onClick=${() => { setFrom(t); setTo(t); }}>Сегодня</button></div></div>
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Время</th><th>Документ</th><th>Способ</th><th>Клиент / назначение</th><th>Заказ</th><th>Кто</th><th class="r">Приход</th><th class="r">Расход</th></tr></thead>
      <tbody>${(data?.rows || []).map((p) => html`<tr>
        <td class="nowrap sub">${fdt(p.created_at)}</td><td><b>${p.number || ''}</b></td><td>${METHOD[p.method]}</td>
        <td>${p.customer_name || ''}<div class="sub">${p.note || ''}</div></td>
        <td>${p.order_id ? html`<a href=${'#/orders/' + p.order_id}>${p.order_number}</a>` : ''}</td><td class="sub">${p.staff || ''}</td>
        <td class="r pos">${p.direction === 'in' ? zl(p.amount) : ''}</td><td class="r neg">${p.direction === 'out' ? zl(p.amount) : ''}</td></tr>`)}</tbody></table></div>
      ${!data?.rows?.length ? html`<div class="empty">За период операций нет</div>` : ''}</div>`}
    ${doc && html`<${Modal} title=${doc.direction === 'in' ? 'Приход наличных (KP)' : 'Расход наличных (KW)'} onClose=${() => setDoc(null)}
      foot=${html`<button class="btn primary" onClick=${async () => { await act(() => api('cash', { body: doc }), 'Проведено'); setDoc(null); reload(); }}>Провести</button>`}>
      <label class="f">Сумма, zł<input type="number" step="0.01" value=${doc.amount} onInput=${(e) => setDoc({ ...doc, amount: e.target.value })} /></label>
      <label class="f">Назначение<input value=${doc.note} onInput=${(e) => setDoc({ ...doc, note: e.target.value })} placeholder=${doc.direction === 'in' ? 'Внесение в кассу' : 'Инкассация, покупка расходников…'} /></label>
    </${Modal}>`}`;
}
