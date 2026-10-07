// Касса: несколько касс (наличные, терминал, счёт), KP/KW, перенос денег между кассами
import { FiscalCard } from '../fiscal.js';
import { ObjectHistory } from './audit.js';
import { html, useState, useData, api, act, qs, useApp, ErrorBox, Icon, Modal, ConfirmButton, Loading, Picker, zl, fdt, todayStr, METHOD } from '../lib.js';

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
  const [cdoc, setCdoc] = useState(null);
  const [dicts, setDicts] = useState(null);
  const { data, error, reload } = useData('cash?' + qs({ from, to, register: reg }), [from, to, reg]);
  const regs = (data?.registers || []).filter((r) => r.active);
  const canEdit = app.perms['cash.edit'];
  return html`
    <div class="page-head"><h1>Касса</h1>
      <div class="actions">
        ${app.perms['settings.manage'] && html`<button class="btn" onClick=${() => setEdit({ name: '', kind: 'cash', opening: 0 })}><${Icon} n="plus" />Новая касса</button>`}
      ${canEdit && html`
        <button class="btn" onClick=${() => setTr({ from: regs.find((r) => r.kind === 'cash')?.id || '', to: regs.find((r) => r.kind === 'bank')?.id || '', amount: '', note: '' })}><${Icon} n="arrows" />Перенос между кассами</button>
        <button class="btn" onClick=${() => setDicts('counterparties')}><${Icon} n="team" />Справочники</button>
        <button class="btn" onClick=${() => setDoc('out')}>Расход KW</button>
        <button class="btn primary" onClick=${() => setDoc('in')}>Приход KP</button>`}</div></div>
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
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl" data-cols="cash">
      <thead><tr><th data-c="time">Время</th><th data-c="doc">Документ</th><th data-c="box">Касса</th><th data-c="method">Способ</th><th data-c="who">Получатель / статья</th><th data-c="order">Заказ</th><th data-c="staff">Кто</th><th data-c="in" class="r">Приход</th><th data-c="out" class="r">Расход</th><th></th></tr></thead>
      <tbody>${(data?.rows || []).map((p) => html`<tr class="click" onClick=${() => setCdoc(p.id)}>
        <td class="nowrap sub">${fdt(p.created_at)}</td><td><b>${p.number || html`<span class="sub">${p.direction === 'in' ? 'оплата ' + (METHOD[p.method] || '').toLowerCase() : 'расход'}</span>`}</b>${p.transfer_id ? html`<div class="sub">перенос</div>` : ''}</td><td class="sub">${p.register_name || '—'}</td><td>${METHOD[p.method]}</td>
        <td>${p.customer_name || p.counterparty_name || p.staff_party_name || ''}${p.article_name ? html`<div class="sub"><b>${p.article_code ? p.article_code + ' ' : ''}${p.article_name}</b></div>` : ''}${p.note && p.note !== p.article_name ? html`<div class="sub">${p.note}</div>` : ''}${p.report_month && p.report_month !== String(p.created_at).slice(0, 7) ? html`<div class="sub">в отчёт: ${p.report_month}</div>` : ''}</td>
        <td>${p.order_id ? html`<a href=${'#/orders/' + p.order_id}>${p.order_number}</a>` : ''}</td><td class="sub">${p.staff || ''}</td>
        <td class="r pos">${p.direction === 'in' ? zl(p.amount) : ''}</td><td class="r neg">${p.direction === 'out' ? zl(p.amount) : ''}</td>
        <td class="act" onClick=${(e) => e.stopPropagation()}>${p.number && html`<a class="icon-btn" href=${'/crm-api/print/cash/' + p.id} target="_blank" rel="noopener" title="Печать KP/KW"><${Icon} n="print" /></a>`}</td></tr>`)}</tbody></table></div>
      ${!data?.rows?.length ? html`<div class="empty">За период операций нет</div>` : ''}</div>`}
    ${doc && html`<${NewDoc} direction=${doc} regs=${regs} reg=${reg} onClose=${() => setDoc(null)} onDone=${() => { setDoc(null); reload(); }} />`}
    ${dicts && html`<${Dicts} tab=${dicts} setTab=${setDicts} onClose=${() => setDicts(null)} />`}
    ${tr && html`<${Modal} title="Перенос между кассами" onClose=${() => setTr(null)}
      foot=${html`<button class="btn primary" disabled=${!tr.from || !tr.to || tr.from == tr.to || !(Number(tr.amount) > 0)} onClick=${async () => { await act(() => api('cash/transfer', { body: tr }), 'Перенесено'); setTr(null); reload(); }}>Перенести</button>`}>
      <div class="grid g2"><label class="f">Из кассы<select value=${tr.from} onChange=${(e) => setTr({ ...tr, from: e.target.value })}><option value="">—</option>${regs.map((r) => html`<option value=${r.id}>${r.name} · ${zl(r.balance)}</option>`)}</select></label>
        <label class="f">В кассу<select value=${tr.to} onChange=${(e) => setTr({ ...tr, to: e.target.value })}><option value="">—</option>${regs.map((r) => html`<option value=${r.id}>${r.name} · ${zl(r.balance)}</option>`)}</select></label></div>
      <label class="f">Сумма, zł<input type="number" step="0.01" value=${tr.amount} onInput=${(e) => setTr({ ...tr, amount: e.target.value })} /></label>
      <label class="f">Примечание<input value=${tr.note} onInput=${(e) => setTr({ ...tr, note: e.target.value })} placeholder="Например: инкассация в банк" /></label>
      <div class="muted small">Создаются KW в первой кассе и KP во второй. В выручку и расходы перенос не попадает.</div>
    </${Modal}>`}
    ${cdoc && html`<${CashDoc} id=${cdoc} onClose=${() => setCdoc(null)} onChanged=${() => { setCdoc(null); reload(); }} />`}
    ${edit && html`<${Modal} title=${edit.id ? 'Касса: ' + edit.name : 'Новая касса'} onClose=${() => setEdit(null)}
      foot=${html`<button class="btn primary" onClick=${async () => { await act(() => api('cash/registers', { body: edit }), 'Сохранено'); setEdit(null); reload(); }}>Сохранить</button>`}>
      <label class="f">Название<input value=${edit.name} onInput=${(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Kasa główna, Kasa 2, Konto firmowe…" /></label>
      <div class="grid g2"><label class="f">Тип<select value=${edit.kind} onChange=${(e) => setEdit({ ...edit, kind: e.target.value })}>${Object.entries(KIND).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
        <label class="f">Остаток на старте, zł<input type="number" step="0.01" value=${edit.opening} onInput=${(e) => setEdit({ ...edit, opening: e.target.value })} /></label></div>
      <label class="check"><input type="checkbox" checked=${!!edit.is_default} onChange=${(e) => setEdit({ ...edit, is_default: e.target.checked })} />Основная для своего типа (сюда идут оплаты по заказам)</label>
      ${edit.id && html`<label class="check"><input type="checkbox" checked=${edit.active !== 0} onChange=${(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} />Касса используется</label>`}
    </${Modal}>`}`;
}

const SOURCE = { order: 'Оплата по заказу', storage: 'Оплата хранения / парковки', transfer: 'Перенос между кассами', income: 'Приход (прочий)', expense: 'Расход' };
const SECTION = { revenue: 'Выручка', cogs: 'Себестоимость', payroll: 'Зарплата', opex: 'Операционные расходы', tax: 'Налоги и сборы', owner: 'Собственник (вне P&L)', neutral: 'Вне P&L' };
const PARTY = [['counterparty', 'Контрагент'], ['client', 'Клиент'], ['staff', 'Сотрудник']];
const nowInput = () => { const d = new Date(); return `${todayStr()}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const methodFor = (r, want) => (!r ? null : r.kind === 'cash' ? 'cash' : r.kind === 'card' ? (want === 'blik' ? 'blik' : 'card') : 'transfer');

/** Поля документа KP / KW: дата операции и месяц в отчётности, статья, касса, способ (по кассе), получатель / плательщик, сумма, комментарий.
 *  lock — поля, которые менять нельзя (сумма, дата, касса — только администратор) */
function DocFields({ v, set, direction, regs, meta, onMeta, lock = {} }) {
  const app = useApp();
  const [ncp, setNcp] = useState(null);
  const arts = (meta?.articles || []).filter((a) => (a.active || a.id === Number(v.article_id)) && (a.kind === direction || a.kind === 'any'));
  const groups = Object.keys(SECTION).map((k) => [k, arts.filter((a) => a.section === k)]).filter(([, l]) => l.length);
  const reg = regs.find((r) => String(r.id) === String(v.register_id));
  const m = methodFor(reg, v.method);
  const cps = (meta?.counterparties || []).filter((c) => c.active || c.id === Number(v.counterparty_id));
  const setDate = (d) => set({ created_at: d, ...(v.report_month === String(v.created_at).slice(0, 7) && d ? { report_month: d.slice(0, 7) } : {}) });
  const addCp = async () => {
    const r = await act(() => api('cash/counterparties', { body: ncp }), 'Контрагент добавлен');
    if (r) { await onMeta(); set({ counterparty_id: r.id }); setNcp(null); }
  };
  return html`
    <div class="grid g2">
      <label class="f">Дата и время операции<input type="datetime-local" value=${v.created_at} disabled=${lock.date} onInput=${(e) => setDate(e.target.value)} /></label>
      <label class="f">Месяц в отчётности<input type="month" value=${v.report_month} onInput=${(e) => set({ report_month: e.target.value })} /></label>
    </div>
    <label class="f">Статья платежа<select value=${v.article_id || ''} onChange=${(e) => set({ article_id: e.target.value ? Number(e.target.value) : null })}>
      <option value="">— выберите статью —</option>
      ${groups.map(([k, l]) => html`<optgroup label=${SECTION[k]}>${l.map((a) => html`<option value=${a.id}>${a.code ? a.code + ' · ' : ''}${a.name}</option>`)}</optgroup>`)}</select></label>
    <div class="grid g2">
      <label class="f">Касса<select value=${v.register_id || ''} disabled=${lock.register} onChange=${(e) => set({ register_id: e.target.value })}>
        ${!v.register_id && html`<option value="">—</option>`}${regs.map((r) => html`<option value=${r.id}>${r.name}${r.balance !== undefined ? ' · ' + zl(r.balance) : ''}${r.active === 0 ? ' (не используется)' : ''}</option>`)}</select></label>
      <label class="f">Способ оплаты
        ${reg?.kind === 'card' && !lock.register
          ? html`<select value=${m} onChange=${(e) => set({ method: e.target.value })}><option value="card">${METHOD.card}</option><option value="blik">${METHOD.blik}</option></select>`
          : html`<input value=${m ? METHOD[m] : '—'} disabled title="Выбирается автоматически по кассе" />`}</label>
    </div>
    <div class="f">${direction === 'out' ? 'Получатель' : 'Плательщик'}
      <div class="row" style="gap:14px;margin:4px 0 6px">${PARTY.map(([k, l]) => html`<label class="check" style="margin:0"><input type="radio" name="party" checked=${v.party_type === k}
        onChange=${() => set({ party_type: k })} />${l}</label>`)}</div>
      ${v.party_type === 'client' && (v.customer_id
        ? html`<div class="row" style="gap:6px"><b class="grow">${v.customer_name || 'Клиент #' + v.customer_id}</b><button class="btn sm" onClick=${() => set({ customer_id: null, customer_name: '' })}>Изменить</button></div>`
        : html`<${Picker} placeholder="Клиент: имя, телефон, NIP, номер авто…" path=${(q) => 'customers?q=' + encodeURIComponent(q)}
            render=${(c) => html`<b>${c.name || '—'}</b> <span class="sub">${c.phone || ''}</span>`} onPick=${(c) => set({ customer_id: c.id, customer_name: c.name })} />`)}
      ${v.party_type === 'counterparty' && (ncp
        ? html`<div class="grid g2"><input autofocus value=${ncp.name} placeholder="Название контрагента" onInput=${(e) => setNcp({ ...ncp, name: e.target.value })} />
            <div class="row" style="gap:6px"><input class="grow" value=${ncp.nip} placeholder="NIP (необязательно)" onInput=${(e) => setNcp({ ...ncp, nip: e.target.value })} />
              <button class="btn sm primary" disabled=${!ncp.name.trim()} onClick=${addCp}>Добавить</button><button class="btn sm" onClick=${() => setNcp(null)}>Отмена</button></div></div>`
        : html`<div class="row" style="gap:6px"><select class="grow" value=${v.counterparty_id || ''} onChange=${(e) => set({ counterparty_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— выберите контрагента —</option>${cps.map((c) => html`<option value=${c.id}>${c.name}${c.nip ? ' · NIP ' + c.nip : ''}</option>`)}</select>
            <button class="btn sm" onClick=${() => setNcp({ name: '', nip: '' })}><${Icon} n="plus" />Новый</button></div>`)}
      ${v.party_type === 'staff' && html`<select value=${v.staff_id || ''} onChange=${(e) => set({ staff_id: e.target.value ? Number(e.target.value) : null })}>
        <option value="">— выберите сотрудника —</option>${(app.staff || []).filter((s) => s.active || s.id === Number(v.staff_id)).map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select>`}
    </div>
    <label class="f">Сумма, zł<input type="number" step="0.01" min="0.01" value=${v.amount} disabled=${lock.amount} onInput=${(e) => set({ amount: e.target.value })} /></label>
    <label class="f">Комментарий<textarea rows="2" value=${v.note} onInput=${(e) => set({ note: e.target.value })}
      placeholder=${direction === 'out' ? 'Например: аренда за октябрь, масло 5W30 для склада…' : 'Например: внесение в кассу, предоплата…'}></textarea></label>`;
}

const partyBody = (v) => ({ party_type: v.party_type, customer_id: v.party_type === 'client' ? v.customer_id || null : null,
  counterparty_id: v.party_type === 'counterparty' ? v.counterparty_id || null : null, staff_id: v.party_type === 'staff' ? v.staff_id || null : null });

/** Новый документ KP / KW */
function NewDoc({ direction, regs, reg, onClose, onDone }) {
  const { data: meta, reload } = useData('cash/meta');
  const now = nowInput();
  const [v, setV] = useState({ created_at: now, report_month: now.slice(0, 7), article_id: null, register_id: reg || regs.find((r) => r.kind === 'cash')?.id || '', method: null,
    party_type: direction === 'out' ? 'counterparty' : 'client', customer_id: null, customer_name: '', counterparty_id: null, staff_id: null, amount: '', note: '' });
  const set = (patch) => setV((x) => ({ ...x, ...patch }));
  const ok = Number(v.amount) > 0 && (v.article_id || v.note.trim()) && v.register_id;
  const save = async () => {
    const body = { direction, amount: Number(v.amount), note: v.note, article_id: v.article_id, register_id: v.register_id, method: v.method, report_month: v.report_month, ...partyBody(v) };
    if (v.created_at && v.created_at !== now) body.created_at = v.created_at.replace('T', ' ');
    const r = await act(() => api('cash', { body }), 'Проведено');
    if (r) onDone();
  };
  return html`<${Modal} title=${direction === 'in' ? 'Приход (KP)' : 'Расход (KW)'} onClose=${onClose}
    foot=${html`<button class="btn primary" disabled=${!ok} onClick=${save}>Провести</button>`}>
    ${!meta ? html`<${Loading} />` : html`<${DocFields} v=${v} set=${set} direction=${direction} regs=${regs} meta=${meta} onMeta=${reload} />`}
    ${meta && !ok && html`<div class="muted small">Нужны сумма и статья платежа (или комментарий).</div>`}
  </${Modal}>`;
}

/** Карточка документа кассы: откуда деньги / на что, правка (статья, месяц, получатель, комментарий — касса; сумма, дата, касса, заказ — админ), история, печать, удаление (админ) */
function CashDoc({ id, onClose, onChanged }) {
  const app = useApp();
  const { data: p } = useData('cash/' + id, [id]);
  const { data: regs } = useData('cash/registers');
  const { data: meta, reload: reloadMeta } = useData('cash/meta');
  const [f, setF] = useState(null);
  if (!p || !meta) return html`<${Modal} title="Документ кассы" onClose=${onClose}><${Loading} /></${Modal}>`;
  const canEdit = app.perms['cash.edit'];
  const isAdmin = app.user.role === 'admin';
  const full = isAdmin && p.method !== 'points';
  const dt = String(p.created_at || '').replace(' ', 'T').slice(0, 16);
  const init = { note: p.note || '', amount: p.amount, created_at: dt, report_month: p.report_month || dt.slice(0, 7), register_id: p.register_id || '', method: p.method,
    article_id: p.article_id || null, party_type: p.party_type || (p.customer_id ? 'client' : p.direction === 'out' ? 'counterparty' : 'client'),
    customer_id: p.customer_id || null, customer_name: p.customer_name || '', counterparty_id: p.counterparty_id || null, staff_id: p.staff_id || null, order_number: p.order_number || '' };
  const v = f || init;
  const set = (patch) => setF({ ...v, ...patch });
  const diff = {};
  if (v.note.trim() !== (p.note || '').trim()) diff.note = v.note;
  if ((v.article_id || null) !== (p.article_id || null)) diff.article_id = v.article_id;
  if (v.report_month !== init.report_month) diff.report_month = v.report_month;
  const pb = partyBody(v);
  if (pb.party_type !== (p.party_type || init.party_type) || ['customer_id', 'counterparty_id', 'staff_id'].some((k) => (pb[k] || null) !== (p[k] || null))) Object.assign(diff, pb);
  if (full) {
    if (Number(v.amount) !== p.amount) diff.amount = Number(v.amount);
    if (v.created_at !== init.created_at) diff.created_at = v.created_at.replace('T', ' ');
    if (String(v.register_id) !== String(init.register_id) && !p.transfer_id) diff.register_id = Number(v.register_id);
    if (v.method !== p.method && !p.transfer_id) diff.method = v.method;
    if (v.order_number.trim() !== (p.order_number || '') && !p.transfer_id) diff.order_number = v.order_number.trim();
  }
  const dirty = Object.keys(diff).length > 0 && (diff.note === undefined || diff.note.trim() || v.article_id);
  const save = async () => { const r = await act(() => api('cash/' + p.id, { method: 'PUT', body: diff }), 'Сохранено'); if (r) onChanged(); };
  const title = p.number || (p.direction === 'in' ? `Оплата: ${METHOD[p.method] || p.method}` : 'Расход');
  const lock = { amount: !full, date: !full, register: !full || !!p.transfer_id };
  return html`<${Modal} title=${`${title} · ${p.direction === 'in' ? 'приход' : 'расход'} ${zl(p.amount)}`} onClose=${onClose} foot=${html`
      ${isAdmin && p.method !== 'points' && html`<${ConfirmButton} cls="btn danger" label=${p.order_id ? 'Удалить? Оплата уйдёт из заказа' : p.transfer_id ? 'Удалить обе части переноса?' : 'Удалить документ?'}
        onConfirm=${async () => { await act(() => api('cash/' + p.id, { method: 'DELETE' }), 'Документ удалён'); onChanged(); }}><${Icon} n="trash" />Удалить</${ConfirmButton}>`}
      <span style="flex:1"></span>
      ${p.number && html`<a class="btn" href=${'/crm-api/print/cash/' + p.id} target="_blank" rel="noopener"><${Icon} n="print" />Печать ${p.number.slice(0, 2)}</a>`}
      ${canEdit && html`<button class="btn primary" disabled=${!dirty} onClick=${save}>Сохранить</button>`}`}>
    <div class="kv-list" style="margin-bottom:12px">
      <span>Откуда / на что</span><b>${SOURCE[p.source]}${p.source === 'order' ? html` — <a href=${'#/orders/' + p.order_id} onClick=${onClose}>${p.order_number}</a> <span class=${p.order_final ? 'pos' : 'muted'}>(${p.order_status || '—'}${p.order_final ? ', заказ закрыт' : ''})</span>` : ''}
        ${p.source === 'storage' && p.storage ? html` — <a href="#/storage" onClick=${onClose}>${p.storage.number}</a>` : ''}${p.source === 'transfer' ? html` — пара ${p.pair_number || ''} (${p.pair_register || ''})` : ''}</b>
      <span>Кто провёл</span><b>${p.staff || '—'}</b>
    </div>
    ${canEdit ? html`<${DocFields} v=${v} set=${set} direction=${p.direction} regs=${regs || []} meta=${meta} onMeta=${reloadMeta} lock=${lock} />
      ${full && !p.transfer_id && html`<label class="f">Заказ (номер)<input value=${v.order_number} onInput=${(e) => set({ order_number: e.target.value })} placeholder="напр. ZL 12/10/2026 — пусто, если не к заказу" /></label>`}
      ${p.transfer_id && html`<div class="muted small">Перенос между кассами: сумма и дата меняются у обеих частей, кассы — нет.</div>`}
      ${p.order_id && html`<div class="muted small">Оплата по заказу: после сохранения сумма оплаты в заказе пересчитается.</div>`}
      ${!isAdmin && html`<div class="muted small">Сумму, дату, кассу и заказ меняет и документ удаляет только администратор.</div>`}`
    : html`<div class="kv-list"><span>Статья</span><b>${p.article_name || '—'}</b><span>Касса</span><b>${p.register_name || '—'}</b><span>Способ</span><b>${METHOD[p.method] || p.method}</b>
      <span>Сумма</span><b>${zl(p.amount)}</b><span>Дата</span><b>${fdt(p.created_at)}</b><span>В отчётности</span><b>${p.report_month || String(p.created_at).slice(0, 7)}</b>
      <span>${p.direction === 'out' ? 'Получатель' : 'Плательщик'}</span><b>${p.customer_name || p.counterparty_name || p.staff_party_name || '—'}</b><span>Комментарий</span><b>${p.note || '—'}</b></div>`}
    <details style="margin-top:10px"><summary class="muted">История изменений</summary><div style="margin-top:6px"><${ObjectHistory} entity="payments" id=${p.id} /></div></details>
  </${Modal}>`;
}

/** Справочники кассы: контрагенты (касса) и статьи платежей (настройки) */
function Dicts({ tab, setTab, onClose }) {
  const app = useApp();
  const { data: meta, reload } = useData('cash/meta');
  const [e, setE] = useState(null);
  const canArt = app.perms['settings.manage'];
  const saveCp = async () => { if (await act(() => api('cash/counterparties', { body: e }), 'Сохранено')) { setE(null); reload(); } };
  const saveArt = async () => { if (await act(() => api('cash/articles', { body: e }), 'Сохранено')) { setE(null); reload(); } };
  return html`<${Modal} title="Справочники кассы" onClose=${onClose} foot=${html`<span style="flex:1"></span>
      ${(tab === 'counterparties' || canArt) && html`<button class="btn" onClick=${() => setE(tab === 'counterparties' ? { name: '', nip: '', phone: '', email: '', note: '' } : { code: '', name: '', kind: 'out', section: 'opex' })}><${Icon} n="plus" />Добавить</button>`}`}>
    <div class="row" style="gap:6px;margin-bottom:10px">
      <button class=${'btn sm' + (tab === 'counterparties' ? ' primary' : '')} onClick=${() => { setTab('counterparties'); setE(null); }}>Контрагенты</button>
      <button class=${'btn sm' + (tab === 'articles' ? ' primary' : '')} onClick=${() => { setTab('articles'); setE(null); }}>Статьи платежей</button></div>
    ${e && tab === 'counterparties' && html`<div class="card" style="margin-bottom:10px">
      <div class="grid g2"><label class="f">Название<input value=${e.name} onInput=${(x) => setE({ ...e, name: x.target.value })} /></label>
        <label class="f">NIP<input value=${e.nip || ''} onInput=${(x) => setE({ ...e, nip: x.target.value })} /></label>
        <label class="f">Телефон<input value=${e.phone || ''} onInput=${(x) => setE({ ...e, phone: x.target.value })} /></label>
        <label class="f">E-mail<input value=${e.email || ''} onInput=${(x) => setE({ ...e, email: x.target.value })} /></label></div>
      <label class="f">Примечание<input value=${e.note || ''} onInput=${(x) => setE({ ...e, note: x.target.value })} /></label>
      ${e.id && html`<label class="check"><input type="checkbox" checked=${e.active !== 0} onChange=${(x) => setE({ ...e, active: x.target.checked ? 1 : 0 })} />Используется</label>`}
      <div class="row" style="gap:6px"><button class="btn primary sm" disabled=${!e.name.trim()} onClick=${saveCp}>Сохранить</button><button class="btn sm" onClick=${() => setE(null)}>Отмена</button></div></div>`}
    ${e && tab === 'articles' && html`<div class="card" style="margin-bottom:10px">
      <div class="grid g2"><label class="f">Код<input value=${e.code || ''} onInput=${(x) => setE({ ...e, code: x.target.value })} placeholder="напр. 410" /></label>
        <label class="f">Название<input value=${e.name} onInput=${(x) => setE({ ...e, name: x.target.value })} /></label>
        <label class="f">Для<select value=${e.kind} onChange=${(x) => setE({ ...e, kind: x.target.value })}><option value="out">Расход (KW)</option><option value="in">Приход (KP)</option><option value="any">Приход и расход</option></select></label>
        <label class="f">Раздел P&L<select value=${e.section} onChange=${(x) => setE({ ...e, section: x.target.value })}>${Object.entries(SECTION).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label></div>
      ${e.id && html`<label class="check"><input type="checkbox" checked=${e.active !== 0} onChange=${(x) => setE({ ...e, active: x.target.checked ? 1 : 0 })} />Используется</label>`}
      <div class="row" style="gap:6px"><button class="btn primary sm" disabled=${!e.name.trim()} onClick=${saveArt}>Сохранить</button><button class="btn sm" onClick=${() => setE(null)}>Отмена</button></div></div>`}
    ${!meta ? html`<${Loading} />` : tab === 'counterparties' ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Контрагент</th><th>NIP</th><th>Телефон</th></tr></thead>
      <tbody>${meta.counterparties.map((c) => html`<tr class=${'click' + (c.active ? '' : ' muted')} onClick=${() => setE({ ...c })}><td><b>${c.name}</b>${c.note ? html`<div class="sub">${c.note}</div>` : ''}</td><td class="sub">${c.nip || ''}</td><td class="sub">${c.phone || ''}</td></tr>`)}</tbody></table></div>`
    : html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Код</th><th>Статья</th><th>Для</th><th>Раздел P&L</th></tr></thead>
      <tbody>${meta.articles.map((a) => html`<tr class=${(canArt ? 'click' : '') + (a.active ? '' : ' muted')} onClick=${() => canArt && setE({ ...a })}><td class="sub">${a.code || ''}</td><td><b>${a.name}</b></td>
        <td class="sub">${{ in: 'KP', out: 'KW', any: 'KP / KW' }[a.kind]}</td><td class="sub">${SECTION[a.section]}</td></tr>`)}</tbody></table></div>
      ${!canArt && html`<div class="muted small">Статьи меняет администратор (право «Настройки»).</div>`}`}
  </${Modal}>`;
}
