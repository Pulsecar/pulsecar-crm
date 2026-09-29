// Касса: несколько касс (наличные, терминал, счёт), KP/KW, перенос денег между кассами
import { FiscalCard } from '../fiscal.js';
import { html, useState, useData, api, act, qs, useApp, ErrorBox, Icon, Modal, zl, fdt, todayStr, METHOD } from '../lib.js';

const KIND = { cash: 'Наличные', card: 'Терминал (карты)', bank: 'Банковский счёт' };

export default function Cash() {
  const app = useApp();
  const t = todayStr();
  const [from, setFrom] = useState(t.slice(0, 8) + '01');
  const [to, setTo] = useState(t);
  const [reg, setReg] = useState('');
  const [doc, setDoc] = useState(null);
  const [tr, setTr] = useState(null);
  const [edit, setEdit] = useState(null);
  const { data, error, reload } = useData('cash?' + qs({ from, to, register: reg }), [from, to, reg]);
  const regs = (data?.registers || []).filter((r) => r.active);
  const canEdit = app.perms['cash.edit'];
  return html`
    <div class="page-head"><h1>Касса</h1>
      <div class="actions">
        ${app.perms['settings.manage'] && html`<button class="btn" onClick=${() => setEdit({ name: '', kind: 'cash', opening: 0 })}><${Icon} n="plus" />Новая касса</button>`}
      ${canEdit && html`
        <button class="btn" onClick=${() => setTr({ from: regs.find((r) => r.kind === 'cash')?.id || '', to: regs.find((r) => r.kind === 'bank')?.id || '', amount: '', note: '' })}><${Icon} n="arrows" />Перенос между кассами</button>
        <button class="btn" onClick=${() => setDoc({ direction: 'out', amount: '', note: '', register_id: reg || regs.find((r) => r.kind === 'cash')?.id })}>Расход KW</button>
        <button class="btn primary" onClick=${() => setDoc({ direction: 'in', amount: '', note: '', register_id: reg || regs.find((r) => r.kind === 'cash')?.id })}>Приход KP</button>`}</div></div>
    <${FiscalCard} />
    <div class="reg-grid">
      ${regs.map((r) => html`<button class=${'reg' + (String(reg) === String(r.id) ? ' on' : '')} onClick=${() => setReg(String(reg) === String(r.id) ? '' : r.id)}>
        <span class="sub">${KIND[r.kind]}${r.is_default ? ' · основная' : ''}</span><b>${r.name}</b><span class="bal">${zl(r.balance)}</span></button>`)}
      ${app.perms['settings.manage'] && html`<button class="reg add" onClick=${() => setEdit({ name: '', kind: 'cash', opening: 0 })}><${Icon} n="plus" />Новая касса</button>`}
    </div>
    <div class="grid g4" style="margin:12px 0">
      <div class="stat accent"><b>${zl(data?.cashBalance)}</b><span>Наличных во всех кассах</span></div>
      <div class="stat"><b>${zl(data?.period.cashIn)}</b><span>Наличные за период · расход ${zl(data?.period.cashOut)}</span></div>
      <div class="stat"><b>${zl((data?.period.card || 0) + (data?.period.blik || 0))}</b><span>Картой за период${data?.period.blik ? html` · из них BLIK ${zl(data.period.blik)}` : ''}</span></div>
      <div class="stat"><b>${zl(data?.period.transfer)}</b><span>Переводом · баллами ${zl(data?.period.points)}</span></div>
    </div>
    <div class="card" style="margin-bottom:12px"><div class="row end">
      <label class="f" style="width:220px">Касса<select value=${reg} onChange=${(e) => setReg(e.target.value)}><option value="">Все кассы</option>${(data?.registers || []).map((r) => html`<option value=${r.id}>${r.name}</option>`)}</select></label>
      <label class="f" style="width:160px">С<input type="date" value=${from} onInput=${(e) => setFrom(e.target.value)} /></label>
      <label class="f" style="width:160px">По<input type="date" value=${to} onInput=${(e) => setTo(e.target.value)} /></label>
      <button class="btn sm" onClick=${() => { setFrom(t); setTo(t); }}>Сегодня</button>
      ${reg && app.perms['settings.manage'] && html`<button class="btn sm ghost" style="margin-left:auto" onClick=${() => setEdit({ ...data.registers.find((r) => String(r.id) === String(reg)) })}>Настроить кассу</button>`}</div></div>
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Время</th><th>Документ</th><th>Касса</th><th>Способ</th><th>Клиент / назначение</th><th>Заказ</th><th>Кто</th><th class="r">Приход</th><th class="r">Расход</th><th></th></tr></thead>
      <tbody>${(data?.rows || []).map((p) => html`<tr>
        <td class="nowrap sub">${fdt(p.created_at)}</td><td><b>${p.number || ''}</b>${p.transfer_id ? html`<div class="sub">перенос</div>` : ''}</td><td class="sub">${p.register_name || '—'}</td><td>${METHOD[p.method]}</td>
        <td>${p.customer_name || ''}<div class="sub">${p.note || ''}</div></td>
        <td>${p.order_id ? html`<a href=${'#/orders/' + p.order_id}>${p.order_number}</a>` : ''}</td><td class="sub">${p.staff || ''}</td>
        <td class="r pos">${p.direction === 'in' ? zl(p.amount) : ''}</td><td class="r neg">${p.direction === 'out' ? zl(p.amount) : ''}</td>
        <td class="act">${p.number && html`<a class="icon-btn" href=${'/crm-api/print/cash/' + p.id} target="_blank" rel="noopener" title="Печать KP/KW"><${Icon} n="print" /></a>`}</td></tr>`)}</tbody></table></div>
      ${!data?.rows?.length ? html`<div class="empty">За период операций нет</div>` : ''}</div>`}
    ${doc && html`<${Modal} title=${doc.direction === 'in' ? 'Приход (KP)' : 'Расход (KW)'} onClose=${() => setDoc(null)}
      foot=${html`<button class="btn primary" onClick=${async () => { await act(() => api('cash', { body: doc }), 'Проведено'); setDoc(null); reload(); }}>Провести</button>`}>
      <label class="f">Касса<select value=${doc.register_id} onChange=${(e) => setDoc({ ...doc, register_id: e.target.value })}>${regs.map((r) => html`<option value=${r.id}>${r.name} · ${zl(r.balance)}</option>`)}</select></label>
      <label class="f">Сумма, zł<input type="number" step="0.01" value=${doc.amount} onInput=${(e) => setDoc({ ...doc, amount: e.target.value })} /></label>
      <label class="f">Назначение<input value=${doc.note} onInput=${(e) => setDoc({ ...doc, note: e.target.value })} placeholder=${doc.direction === 'in' ? 'Внесение в кассу' : 'Инкассация, покупка расходников…'} /></label>
    </${Modal}>`}
    ${tr && html`<${Modal} title="Перенос между кассами" onClose=${() => setTr(null)}
      foot=${html`<button class="btn primary" disabled=${!tr.from || !tr.to || tr.from == tr.to || !(Number(tr.amount) > 0)} onClick=${async () => { await act(() => api('cash/transfer', { body: tr }), 'Перенесено'); setTr(null); reload(); }}>Перенести</button>`}>
      <div class="grid g2"><label class="f">Из кассы<select value=${tr.from} onChange=${(e) => setTr({ ...tr, from: e.target.value })}><option value="">—</option>${regs.map((r) => html`<option value=${r.id}>${r.name} · ${zl(r.balance)}</option>`)}</select></label>
        <label class="f">В кассу<select value=${tr.to} onChange=${(e) => setTr({ ...tr, to: e.target.value })}><option value="">—</option>${regs.map((r) => html`<option value=${r.id}>${r.name} · ${zl(r.balance)}</option>`)}</select></label></div>
      <label class="f">Сумма, zł<input type="number" step="0.01" value=${tr.amount} onInput=${(e) => setTr({ ...tr, amount: e.target.value })} /></label>
      <label class="f">Примечание<input value=${tr.note} onInput=${(e) => setTr({ ...tr, note: e.target.value })} placeholder="Например: инкассация в банк" /></label>
      <div class="muted small">Создаются KW в первой кассе и KP во второй. В выручку и расходы перенос не попадает.</div>
    </${Modal}>`}
    ${edit && html`<${Modal} title=${edit.id ? 'Касса: ' + edit.name : 'Новая касса'} onClose=${() => setEdit(null)}
      foot=${html`<button class="btn primary" onClick=${async () => { await act(() => api('cash/registers', { body: edit }), 'Сохранено'); setEdit(null); reload(); }}>Сохранить</button>`}>
      <label class="f">Название<input value=${edit.name} onInput=${(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Kasa główna, Kasa 2, Konto firmowe…" /></label>
      <div class="grid g2"><label class="f">Тип<select value=${edit.kind} onChange=${(e) => setEdit({ ...edit, kind: e.target.value })}>${Object.entries(KIND).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
        <label class="f">Остаток на старте, zł<input type="number" step="0.01" value=${edit.opening} onInput=${(e) => setEdit({ ...edit, opening: e.target.value })} /></label></div>
      <label class="check"><input type="checkbox" checked=${!!edit.is_default} onChange=${(e) => setEdit({ ...edit, is_default: e.target.checked })} />Основная для своего типа (сюда идут оплаты по заказам)</label>
      ${edit.id && html`<label class="check"><input type="checkbox" checked=${edit.active !== 0} onChange=${(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} />Касса используется</label>`}
    </${Modal}>`}`;
}
