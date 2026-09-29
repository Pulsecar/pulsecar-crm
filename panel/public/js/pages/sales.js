// Продажи (как Sprzedaż в Motowarsztat): все фактуры VAT, корректы, Pro forma и чеки за период; фактура без заказа; статус KSeF
import { html, useState, useData, api, act, qs, go, useApp, ErrorBox, Icon, Modal, zl, fdate, toast, useDebounced, todayStr } from '../lib.js';

const TYPE = { vat: 'Фактура VAT', correction: 'Корректа', proforma: 'Pro forma', receipt: 'Чек (paragon)' };
const PAYM = { cash: 'Наличные', card: 'Карта', blik: 'BLIK', transfer: 'Перевод', mixed: 'Смешанная оплата', points: 'Баллы' };
const KS = { accepted: ['KSeF ✓', 'var(--accent)'], sent: ['KSeF: ждём номер', 'var(--warn)'], rejected: ['KSeF: отклонена', 'var(--danger)'], error: ['KSeF: ошибка', 'var(--danger)'] };
const RS = { printed: ['напечатан', 'var(--accent)'], pending: ['в очереди', 'var(--warn)'], error: ['ошибка кассы', 'var(--danger)'], manual: ['№ вручную', 'var(--muted)'] };

export default function Sales() {
  const app = useApp();
  const t = todayStr();
  const [from, setFrom] = useState(t.slice(0, 8) + '01');
  const [to, setTo] = useState(t);
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [inv, setInv] = useState(null);
  const { data, error, reload } = useData('sales?' + qs({ from, to, type, q: dq }), [from, to, type, dq]);
  const csv = () => {
    const rows = [['Тип', 'Номер', 'Дата', 'Покупатель', 'NIP', 'Заказ', 'Нетто', 'Брутто', 'Оплата', 'KSeF'], ...(data?.rows || []).map((r) => [TYPE[r.type], r.number || '', r.date, r.buyer || '', r.nip || '', r.order_no || '',
      r.net == null ? '' : String(r.net).replace('.', ','), String(r.gross ?? '').replace('.', ','), PAYM[r.payment_method] || '', r.ksef_number || r.ksef_status || ''])];
    const blob = new Blob(['﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `sprzedaz-${from}_${to}.csv`; a.click();
  };
  return html`
    <div class="page-head"><h1>Продажи</h1>
      <div class="actions"><button class="btn" onClick=${csv} disabled=${!data?.rows?.length}><${Icon} n="download" />CSV</button>
        <button class="btn" onClick=${() => setInv({ kind: 'proforma' })}>Pro forma</button>
        <button class="btn primary" onClick=${() => setInv({ kind: 'vat' })}><${Icon} n="plus" />Фактура без заказа</button></div></div>
    <div class="grid g4" style="margin-bottom:12px">
      <div class="stat accent"><b>${zl(data?.totals.all)}</b><span>Продажи за период (без Pro forma)</span></div>
      <div class="stat"><b>${zl(data?.totals.vat)}</b><span>Фактуры VAT${data?.totals.correction ? ' · корректы ' + zl(data.totals.correction) : ''}</span></div>
      <div class="stat"><b>${zl(data?.totals.receipt)}</b><span>Чеки (paragony)</span></div>
      <div class=${'stat' + (data?.ksefPending ? ' warn' : '')}><b>${data?.ksefPending || 0}</b><span>Фактур без номера KSeF</span></div>
    </div>
    <div class="card" style="margin-bottom:12px"><div class="row end">
      <label class="f grow">Поиск<input type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Номер, покупатель, заказ" /></label>
      <label class="f" style="width:190px">Тип<select value=${type} onChange=${(e) => setType(e.target.value)}><option value="">Все документы</option>${Object.entries(TYPE).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
      <label class="f" style="width:150px">С<input type="date" value=${from} onInput=${(e) => setFrom(e.target.value)} /></label>
      <label class="f" style="width:150px">По<input type="date" value=${to} onInput=${(e) => setTo(e.target.value)} /></label>
      <button class="btn sm" onClick=${() => { setFrom(t); setTo(t); }}>Сегодня</button></div></div>
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Документ</th><th>Дата</th><th>Покупатель</th><th>Заказ</th><th>Оплата</th><th class="r">Нетто</th><th class="r">Брутто</th><th>Статус</th><th></th></tr></thead>
      <tbody>${(data?.rows || []).map((r) => {
        const st = r.type === 'receipt' ? RS[r.receipt_status] : r.type !== 'proforma' ? KS[r.ksef_status] : null;
        const link = r.type === 'receipt' ? (r.order_id ? '#/orders/' + r.order_id : null) : '/crm-api/print/sale/' + r.id;
        return html`<tr>
          <td><b>${r.number || '—'}</b><div class="sub">${TYPE[r.type]}</div></td><td class="nowrap">${fdate(r.date)}</td>
          <td>${r.buyer || '—'}${r.nip ? html`<div class="sub">NIP ${r.nip}</div>` : ''}</td>
          <td>${r.order_id && r.order_no ? html`<a href=${'#/orders/' + r.order_id}>${r.order_no}</a>` : ''}</td><td class="sub">${PAYM[r.payment_method] || ''}</td>
          <td class="r nowrap">${r.net == null ? '' : zl(r.net)}</td><td class="r nowrap"><b>${zl(r.gross)}</b></td>
          <td>${st ? html`<span class="badge" style=${`border-color:${st[1]};color:${st[1]}`}>${st[0]}</span>` : r.type === 'vat' || r.type === 'correction' ? html`<span class="sub">${r.ext_url ? 'через Fakturownia' : 'не в KSeF'}</span>` : ''}
            ${r.ksef_number ? html`<div class="sub mono">${r.ksef_number}</div>` : ''}${r.ksef_error ? html`<div class="sub" style="color:var(--danger)">${r.ksef_error}</div>` : ''}</td>
          <td class="act nowrap">${link && html`<a class="btn sm" href=${link} target=${r.type === 'receipt' ? '' : '_blank'} rel="noopener">Открыть</a>`}
            ${(r.type === 'vat' || r.type === 'correction') && app.features.ksef && r.ksef_status !== 'accepted' && !r.ext_url && html`<button class="btn sm" onClick=${async () => { const x = await act(() => api(`sales-docs/${r.id}/ksef`, { body: {} })); toast(x.ksef_number ? 'KSeF: ' + x.ksef_number : 'Статус: ' + (x.ksef_status || '—'), x.ksef_status === 'rejected' ? 'error' : 'ok'); reload(); }}>В KSeF</button>`}
            ${r.ksef_number && html`<a class="btn sm" href=${'/crm-api/sales-docs/' + r.id + '/upo'}>UPO</a>`}</td></tr>`;
      })}</tbody></table></div>
      ${!data?.rows?.length ? html`<div class="empty">За период документов нет</div>` : ''}</div>`}
    ${inv && html`<${FreeInvoice} kind=${inv.kind} onClose=${() => setInv(null)} onDone=${() => { setInv(null); reload(); }} />`}`;
}

function FreeInvoice({ kind, onClose, onDone }) {
  const app = useApp();
  const vats = String(app.settings.vat_rates || '23,8,5,0').split(',').map((x) => Number(x.trim()));
  const [f, set] = useState({ buyer: { name: '', nip: '', street: '', postcode: '', city: '' }, payment_method: app.settings.payment_method_default || 'cash', due_days: app.settings.payment_term_days || 0, paid: true, notes: '', lines: [{ name: '', qty: 1, unit: 'szt.', unit_gross: '', vat: 23 }] });
  const setB = (k, v) => set({ ...f, buyer: { ...f.buyer, [k]: v } });
  const setL = (i, patch) => { const L = [...f.lines]; L[i] = { ...L[i], ...patch }; set({ ...f, lines: L }); };
  const total = f.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_gross) || 0), 0);
  const findNip = async () => { const r = await act(() => api('nip/' + encodeURIComponent(f.buyer.nip))); set({ ...f, buyer: { ...f.buyer, name: r.name, nip: r.nip, street: r.street, postcode: r.postcode, city: r.city } }); };
  const issue = async () => {
    const r = await act(() => api('sales-docs', { body: { ...f, kind } }));
    toast(`${r.number} выставлена${r.ksef_number ? ' · KSeF ' + r.ksef_number : ''}`); if (r.warning) toast(r.warning, 'error');
    window.open('/crm-api/print/sale/' + r.id, '_blank', 'noopener'); onDone();
  };
  return html`<${Modal} wide title=${(kind === 'vat' ? 'Фактура VAT' : 'Pro forma') + ' без заказа'} onClose=${onClose}
    foot=${html`<span class="muted small" style="margin-right:auto">Итого брутто: <b>${zl(total)}</b></span><button class="btn" onClick=${onClose}>Отмена</button><button class="btn primary" onClick=${issue}>Выставить</button>`}>
    <h3 class="small muted">Покупатель</h3>
    <div class="grid g3"><label class="f">NIP<div class="row" style="gap:6px;flex-wrap:nowrap"><input value=${f.buyer.nip} onInput=${(e) => setB('nip', e.target.value)} placeholder="10 цифр — для фирмы" /><button class="btn" onClick=${findNip}><${Icon} n="search" />Найти</button></div></label>
      <label class="f">Название / имя<input value=${f.buyer.name} onInput=${(e) => setB('name', e.target.value)} /></label><label class="f">Улица<input value=${f.buyer.street} onInput=${(e) => setB('street', e.target.value)} /></label></div>
    <div class="grid g4"><label class="f">Индекс<input value=${f.buyer.postcode} onInput=${(e) => setB('postcode', e.target.value)} /></label><label class="f">Город<input value=${f.buyer.city} onInput=${(e) => setB('city', e.target.value)} /></label>
      <label class="f">Оплата<select value=${f.payment_method} onChange=${(e) => set({ ...f, payment_method: e.target.value })}>${Object.entries(PAYM).filter(([k]) => k !== 'points').map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
      <label class="f">Срок оплаты, дней<input type="number" min="0" value=${f.due_days} onInput=${(e) => set({ ...f, due_days: e.target.value })} /></label></div>
    <label class="check" style="margin:6px 0"><input type="checkbox" checked=${f.paid} onChange=${(e) => set({ ...f, paid: e.target.checked })} />Уже оплачено</label>
    <table class="tbl" style="margin-top:8px"><thead><tr><th>Позиция</th><th class="r">Кол-во</th><th>Ед.</th><th class="r">Цена брутто</th><th>VAT</th><th class="r">Сумма</th><th></th></tr></thead><tbody>
      ${f.lines.map((l, i) => html`<tr><td><input class="inline-input" value=${l.name} placeholder="Название товара / услуги" onInput=${(e) => setL(i, { name: e.target.value })} /></td>
        <td class="r"><input class="inline-input num qty" type="number" step="0.01" value=${l.qty} onInput=${(e) => setL(i, { qty: e.target.value })} /></td>
        <td><input class="inline-input" style="width:60px" value=${l.unit} onInput=${(e) => setL(i, { unit: e.target.value })} /></td>
        <td class="r"><input class="inline-input num price" type="number" step="0.01" value=${l.unit_gross} onInput=${(e) => setL(i, { unit_gross: e.target.value })} /></td>
        <td><select class="inline-input" value=${l.vat} onChange=${(e) => setL(i, { vat: Number(e.target.value) })}>${vats.map((v) => html`<option value=${v}>${v}%</option>`)}</select></td>
        <td class="r nowrap">${zl((Number(l.qty) || 0) * (Number(l.unit_gross) || 0))}</td>
        <td class="act">${f.lines.length > 1 && html`<button class="icon-btn" onClick=${() => set({ ...f, lines: f.lines.filter((_, j) => j !== i) })}><${Icon} n="trash" /></button>`}</td></tr>`)}</tbody></table>
    <button class="btn sm" style="margin-top:8px" onClick=${() => set({ ...f, lines: [...f.lines, { name: '', qty: 1, unit: 'szt.', unit_gross: '', vat: 23 }] })}><${Icon} n="plus" />Позиция</button>
    <label class="f" style="margin-top:10px">Примечание<input value=${f.notes} onInput=${(e) => set({ ...f, notes: e.target.value })} /></label>
  </${Modal}>`;
}
