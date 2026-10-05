// Продажи (как Sprzedaż в Motowarsztat): все фактуры VAT, корректы, Pro forma и чеки за период; фактура без заказа; статус KSeF
import { html, useState, useEffect, useData, api, act, qs, go, useApp, ErrorBox, Loading, Icon, Modal, Picker, ConfirmButton, zl, fdate, toast, useDebounced, todayStr } from '../lib.js';

/** Можно ли удалить документ: Pro forma — всегда; фактуру VAT / корректу — только владелец и только если её нет в KSeF / Fakturownia; чек — только владелец и только не пробитый на кассе */
export const canDeleteDoc = (app, d, type = d.kind || d.type) => type === 'proforma' || (app.owner && (type === 'receipt' ? ['pending', 'error'].includes(d.receipt_status ?? d.status) : !d.ksef_number && !['sent', 'accepted'].includes(d.ksef_status) && !d.ext_url && !d.ext_id));
import { AztecButton, PlateButton } from '../vehicle.js';
import { useSel, SelHead, SelCell, BulkBar } from '../bulk.js';

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
  const [pack, setPack] = useState(false);
  const sel = useSel();
  const { data, error, reload } = useData('sales?' + qs({ from, to, type, q: dq }), [from, to, type, dq]);
  const csv = () => {
    const rows = [['Тип', 'Номер', 'Дата', 'Покупатель', 'NIP', 'Заказ', 'Нетто', 'Брутто', 'Оплата', 'KSeF'], ...(data?.rows || []).map((r) => [TYPE[r.type], r.number || '', r.date, r.buyer || '', r.nip || '', r.order_no || '',
      r.net == null ? '' : String(r.net).replace('.', ','), String(r.gross ?? '').replace('.', ','), PAYM[r.payment_method] || '', r.ksef_number || r.ksef_status || ''])];
    const blob = new Blob(['﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `sprzedaz-${from}_${to}.csv`; a.click();
  };
  return html`
    <div class="page-head"><h1>Продажи</h1>
      <div class="actions"><button class="btn" onClick=${() => setPack(true)}><${Icon} n="download" />Пакет для бухгалтера</button><button class="btn" onClick=${csv} disabled=${!data?.rows?.length}><${Icon} n="download" />CSV</button>
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
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl" data-cols="sales">
      <thead><tr><${SelHead} sel=${sel} rows=${(data?.rows || []).filter((r) => r.type !== 'receipt')} /><th data-c="doc">Документ</th><th data-c="date">Дата</th><th data-c="buyer">Покупатель</th><th data-c="order">Заказ</th><th data-c="pay">Оплата</th><th data-c="net" class="r">Нетто</th><th data-c="gross" class="r">Брутто</th><th data-c="status">Статус</th><th></th></tr></thead>
      <tbody>${(data?.rows || []).map((r) => {
        const st = r.type === 'receipt' ? RS[r.receipt_status] : r.type !== 'proforma' ? KS[r.ksef_status] : null;
        const link = r.type === 'receipt' ? (r.order_id ? '#/orders/' + r.order_id : null) : '#/sales/' + r.id;
        return html`<tr class=${sel.has(r.id) && r.type !== 'receipt' ? 'on' : ''}>
          ${r.type === 'receipt' ? html`<td class="sel-col"></td>` : html`<${SelCell} sel=${sel} row=${r} />`}<td><b>${r.number || '—'}</b><div class="sub">${TYPE[r.type]}</div></td><td class="nowrap">${fdate(r.date)}</td>
          <td>${r.buyer || '—'}${r.nip ? html`<div class="sub">NIP ${r.nip}</div>` : ''}</td>
          <td>${r.order_id && r.order_no ? html`<a href=${'#/orders/' + r.order_id}>${r.order_no}</a>` : ''}</td><td class="sub">${PAYM[r.payment_method] || ''}</td>
          <td class="r nowrap">${r.net == null ? '' : zl(r.net)}</td><td class="r nowrap"><b>${zl(r.gross)}</b></td>
          <td>${st ? html`<span class="badge" style=${`border-color:${st[1]};color:${st[1]}`}>${st[0]}</span>` : r.type === 'vat' || r.type === 'correction' ? html`<span class="sub">${r.ext_url ? 'через Fakturownia' : 'не в KSeF'}</span>` : ''}
            ${r.ksef_number ? html`<div class="sub mono">${r.ksef_number}</div>` : ''}${r.ksef_error ? html`<div class="sub" style="color:var(--danger)">${r.ksef_error}</div>` : ''}</td>
          <td class="act nowrap">${link && html`<a class="btn sm" href=${link}>Открыть</a>${r.type !== 'receipt' ? html` <a class="icon-btn" title="Печать / PDF" href=${'/crm-api/print/sale/' + r.id} target="_blank" rel="noopener"><${Icon} n="print" /></a>` : ''}`}
            ${(r.type === 'vat' || r.type === 'correction') && app.features.ksef && r.ksef_status !== 'accepted' && !r.ext_url && html`<button class="btn sm" onClick=${async () => { const x = await act(() => api(`sales-docs/${r.id}/ksef`, { body: {} })); toast(x.ksef_number ? 'KSeF: ' + x.ksef_number : 'Статус: ' + (x.ksef_status || '—'), x.ksef_status === 'rejected' ? 'error' : 'ok'); reload(); }}>В KSeF</button>`}
            ${r.ksef_number && html`<a class="btn sm" href=${'/crm-api/sales-docs/' + r.id + '/upo'}>UPO</a>`}
            ${canDeleteDoc(app, r) && (r.type !== 'receipt' || r.receipt_status !== 'manual') && html`<${ConfirmButton} cls="icon-btn" label=${r.type === 'receipt' ? 'Удалить непробитый чек?' : `Удалить ${r.number}?`} onConfirm=${async () => { await act(() => api((r.type === 'receipt' ? 'receipts/' : 'sales-docs/') + r.id, { method: 'DELETE' }), 'Удалено'); reload(); }}><${Icon} n="trash" /></${ConfirmButton}>`}</td></tr>`;
      })}</tbody></table></div>
      ${!data?.rows?.length ? html`<div class="empty">За период документов нет</div>` : ''}</div>`}
    <${BulkBar} sel=${sel} entity="sales" extra=${[
      { label: 'Скачать ZIP', icon: 'download', onClick: (ids) => { location.href = '/crm-api/sales-docs/export.zip?' + qs({ ids: ids.join(','), receipts: 0 }); } },
      { label: 'Печать / один PDF', icon: 'print', onClick: (ids) => window.open('/crm-api/sales-docs/print-all?' + qs({ ids: ids.join(',') }), '_blank') },
    ]} />
    ${pack && html`<${AccountantPack} onClose=${() => setPack(false)} />`}
    ${inv && html`<${InvoiceForm} kind=${inv.kind} onClose=${() => setInv(null)} onDone=${(id) => { setInv(null); go('/sales/' + id); }} />`}`;
}

const LINE0 = () => ({ name: '', qty: 1, unit: 'szt.', unit_gross: '', unit_net: '', price_mode: 'gross', vat: 23 });
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CAT_UNIT = { oper: 'usł.', h: 'godz.', rbh: 'godz.' };
/** Строка позиции: название с поиском по прайсу работ и складу, цена нетто ⇄ брутто */
export function LineName({ l, onPick, onInput, rawUnit }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState([]);
  const dq = useDebounced(l.name, 220);
  useEffect(() => {
    const q = String(dq || '').trim();
    if (!open || q.length < 2) { setRes([]); return; }
    let live = true;
    Promise.all([
      api('catalog?q=' + encodeURIComponent(q)).catch(() => []),
      app.perms?.['products.view'] ? api('products?q=' + encodeURIComponent(q)).then((r) => r.rows || [], () => []) : Promise.resolve([]),
    ]).then(([cat, prod]) => { if (live) setRes([...prod.slice(0, 12).map((p) => ({ t: 'p', x: p })), ...(cat || []).slice(0, 20).map((c) => ({ t: 'c', x: c }))]); });
    return () => { live = false; };
  }, [dq, open]);
  const pick = (r) => {
    setOpen(false);
    if (r.t === 'p') onPick({ name: [r.x.name, r.x.manufacturer, r.x.code].filter(Boolean).join(' '), code: r.x.code || null, unit: r.x.unit || 'szt.', unit_gross: r.x.sell_price || '', price_mode: 'gross', vat: r.x.vat ?? 23, product_id: r.x.id, kind: 'part' });
    else onPick({ name: r.x.name, unit: rawUnit ? r.x.unit || 'oper' : CAT_UNIT[r.x.unit] || r.x.unit || 'usł.', qty: r.x.qty || 1, unit_gross: r.x.price || '', price_mode: 'gross', vat: r.x.vat ?? 23, catalog_id: r.x.id, kind: 'labor' });
  };
  return html`<div class="ac inv-ac">
    <input class="inline-input" value=${l.name} placeholder="Название или поиск по прайсу и складу…" onFocus=${() => setOpen(true)} onBlur=${() => setTimeout(() => setOpen(false), 180)}
      onInput=${(e) => { onInput(e.target.value); setOpen(true); }} />
    ${open && res.length > 0 && html`<div class="ac-list">${res.map((r) => html`<div class="ac-item" onMouseDown=${(e) => { e.preventDefault(); pick(r); }}>
      <span class="chip" style="margin-right:6px">${r.t === 'p' ? 'Склад' : 'Работа'}</span><b>${r.x.name}</b>
      <span class="sub">${r.t === 'p' ? [r.x.manufacturer, r.x.code, r.x.stock != null ? 'остаток ' + r.x.stock : ''].filter(Boolean).join(' · ') : r.x.category || ''}</span>
      <span class="faint small" style="margin-left:auto">${zl(r.t === 'p' ? r.x.sell_price : r.x.price)}</span></div>`)}</div>`}</div>`;
}

const EMPTY_CAR = { make: '', model: '', year: '', plate: '', vin: '', mileage: '', engine: '' };
/** Форма фактуры без заказа — новая и редактирование (doc) */
export function InvoiceForm({ kind, doc, onClose, onDone }) {
  const app = useApp();
  const vats = String(app.settings.vat_rates || '23,8,5,0').split(',').map((x) => Number(x.trim()));
  const [f, set] = useState(() => doc ? {
    buyer: { name: '', nip: '', street: '', postcode: '', city: '', ...doc.buyer }, payment_method: doc.payment_method || 'cash',
    due_days: Math.max(0, Math.round((new Date(doc.due_date) - new Date(doc.issue_date)) / 86400000)) || 0, paid: doc.paid >= doc.total_gross - 0.005, notes: doc.notes || '', sale_date: doc.sale_date,
    lines: (doc.items || []).map((l) => ({ ...l, unit_gross: l.qty ? r2(l.gross / l.qty) : 0, unit_net: l.unit_net, price_mode: l.price_mode || 'gross' })),
    car: doc.car ? { ...EMPTY_CAR, ...doc.car } : null,
    split: Object.fromEntries(['cash', 'card', 'blik', 'transfer'].map((k) => [k, String((doc.pay_split || []).find((x) => x.method === k)?.amount || '')])),
  } : { buyer: { name: '', nip: '', street: '', postcode: '', city: '' }, payment_method: app.settings.payment_method_default || 'cash', due_days: app.settings.payment_term_days || 0,
    paid: true, notes: '', lines: [LINE0()], car: null, save_car: true, split: { cash: '', card: '', blik: '', transfer: '' } });
  const [carQ, setCarQ] = useState(false);
  const setB = (k, v) => set({ ...f, buyer: { ...f.buyer, [k]: v } });
  const setC = (patch) => set({ ...f, car: { ...(f.car || EMPTY_CAR), ...patch } });
  const setL = (i, patch) => { const L = [...f.lines]; L[i] = { ...L[i], ...patch }; set({ ...f, lines: L }); };
  // цена: в зависимости от того, что вводили — нетто или брутто — второе считается
  const gross1 = (l) => l.price_mode === 'net' ? r2((Number(l.unit_net) || 0) * (1 + (Number(l.vat) || 0) / 100)) : Number(l.unit_gross) || 0;
  const net1 = (l) => l.price_mode === 'net' ? Number(l.unit_net) || 0 : r2((Number(l.unit_gross) || 0) / (1 + (Number(l.vat) || 0) / 100));
  const lineSum = (l) => l.price_mode === 'net' ? r2(r2((Number(l.qty) || 0) * (Number(l.unit_net) || 0)) * (1 + (Number(l.vat) || 0) / 100)) : r2((Number(l.qty) || 0) * (Number(l.unit_gross) || 0));
  const total = r2(f.lines.reduce((s, l) => s + lineSum(l), 0));
  const totalNet = r2(f.lines.reduce((s, l) => s + (l.price_mode === 'net' ? r2((Number(l.qty) || 0) * (Number(l.unit_net) || 0)) : r2(lineSum(l) / (1 + (Number(l.vat) || 0) / 100))), 0));
  const mixed = f.payment_method === 'mixed';
  const splitSum = r2(['cash', 'card', 'blik', 'transfer'].reduce((a, k) => a + (Number(f.split[k]) || 0), 0));
  const findNip = async () => { const r = await act(() => api('nip/' + encodeURIComponent(f.buyer.nip))); set({ ...f, buyer: { ...f.buyer, name: r.name, nip: r.nip, street: r.street, postcode: r.postcode, city: r.city } }); };
  const body = () => ({ ...f, kind, pay_split: mixed ? ['cash', 'card', 'blik', 'transfer'].map((k) => ({ method: k, amount: Number(f.split[k]) || 0 })).filter((x) => x.amount > 0) : null });
  const save = async () => {
    if (mixed && splitSum > total + 0.01) { toast('Сумма частей оплаты больше суммы фактуры', 'error'); return; }
    if (doc) { await act(() => api('sales-docs/' + doc.id, { method: 'PUT', body: body() }), 'Фактура изменена'); onDone(doc.id); return; }
    const r = await act(() => api('sales-docs', { body: body() }));
    toast(`${r.number} выставлена${r.ksef_number ? ' · KSeF ' + r.ksef_number : ''}`); if (r.warning) toast(r.warning, 'error');
    onDone(r.id);
  };
  const decodeVin = async () => { const r = await act(() => api('vin/' + encodeURIComponent(f.car.vin))); if (r) setC(Object.fromEntries(Object.entries({ make: r.make, model: r.model, year: r.year, engine: r.engine }).filter(([k, v]) => v && !f.car[k]))); };
  const carIn = (k, l, extra = {}) => html`<label class="f">${l}<input value=${f.car?.[k] ?? ''} onInput=${(e) => setC({ [k]: e.target.value })} ...${extra} /></label>`;
  return html`<${Modal} xl title=${doc ? `${doc.number} · редактирование` : (kind === 'vat' ? 'Фактура VAT' : 'Pro forma') + ' без заказа'} onClose=${onClose}
    foot=${html`<span class="muted small" style="margin-right:auto">Итого нетто: <b>${zl(totalNet)}</b> · брутто: <b>${zl(total)}</b></span><button class="btn" onClick=${onClose}>Отмена</button><button class="btn primary" onClick=${save}>${doc ? 'Сохранить' : 'Выставить'}</button>`}>
    <h3 class="small muted">Покупатель</h3>
    <div class="grid g3"><label class="f">NIP<div class="row" style="gap:6px;flex-wrap:nowrap"><input value=${f.buyer.nip} onInput=${(e) => setB('nip', e.target.value)} placeholder="10 цифр — для фирмы" /><button class="btn" onClick=${findNip}><${Icon} n="search" />Найти</button></div></label>
      <label class="f">Название / имя<input value=${f.buyer.name} onInput=${(e) => setB('name', e.target.value)} /></label><label class="f">Улица<input value=${f.buyer.street} onInput=${(e) => setB('street', e.target.value)} /></label></div>
    <div class="grid g4"><label class="f">Индекс<input value=${f.buyer.postcode} onInput=${(e) => setB('postcode', e.target.value)} /></label><label class="f">Город<input value=${f.buyer.city} onInput=${(e) => setB('city', e.target.value)} /></label>
      <label class="f">Оплата<select value=${f.payment_method} onChange=${(e) => set({ ...f, payment_method: e.target.value })}>${Object.entries(PAYM).filter(([k]) => k !== 'points').map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
      <label class="f">Срок оплаты, дней<input type="number" min="0" value=${f.due_days} onInput=${(e) => set({ ...f, due_days: e.target.value })} /></label></div>
    ${mixed ? html`<div class="pay-split"><div class="small muted" style="grid-column:1/-1">Оплата частями — сколько чем заплатил клиент (как в Motowarsztat). На фактуре будет «Płatność mieszana» с разбивкой.</div>
        ${['cash', 'card', 'blik', 'transfer'].map((k) => html`<label class="f">${PAYM[k]}<input type="number" step="0.01" min="0" placeholder="0,00" value=${f.split[k]} onInput=${(e) => set({ ...f, split: { ...f.split, [k]: e.target.value } })} /></label>`)}
        <div class=${'small ' + (Math.abs(splitSum - total) < 0.01 ? 'pos' : 'muted')}>Оплачено ${zl(splitSum)} из ${zl(total)}${total - splitSum > 0.01 ? html` · <a href="#" onClick=${(e) => { e.preventDefault(); const k = ['cash', 'card', 'blik', 'transfer'].find((x) => !(Number(f.split[x]) > 0)) || 'card'; set({ ...f, split: { ...f.split, [k]: String(r2(total - splitSum + (Number(f.split[k]) || 0))) } }); }}>дополнить остаток</a> · остаток ${zl(total - splitSum)} — к оплате` : ''}</div></div>`
      : html`<label class="check" style="margin:6px 0"><input type="checkbox" checked=${f.paid} onChange=${(e) => set({ ...f, paid: e.target.checked })} />Уже оплачено</label>`}

    <div class="row" style="margin-top:12px;align-items:center"><h3 class="small muted" style="margin:0">Автомобиль</h3>
      ${!f.car ? html`<button class="btn sm" onClick=${() => setC({})}><${Icon} n="plus" />Добавить авто</button>` : html`<button class="btn sm ghost" onClick=${() => set({ ...f, car: null })}><${Icon} n="x" />Убрать</button>`}</div>
    ${f.car && html`<div class="inv-car">
      <div class="row" style="gap:8px;margin-bottom:8px">
        ${carQ ? html`<div class="grow"><${Picker} placeholder="Номер, VIN, марка или владелец…" path=${(q) => 'cars?q=' + encodeURIComponent(q)}
            render=${(k) => html`<b>${[k.make, k.model].filter(Boolean).join(' ') || '—'}</b> <span class="plate">${k.plate || ''}</span> <span class="sub">${k.vin || ''} ${k.owner_name || ''}</span>`}
            onPick=${(k) => { setCarQ(false); set({ ...f, car: { ...EMPTY_CAR, car_id: k.id, make: k.make || '', model: k.model || '', year: k.year || '', plate: k.plate || '', vin: k.vin || '', mileage: k.last_mileage || '', engine: k.engine || '' } }); }} /></div>`
          : html`<button class="btn sm" onClick=${() => setCarQ(true)}><${Icon} n="car" />Выбрать из базы</button>`}
        <${AztecButton} onData=${(d) => setC(Object.fromEntries(Object.entries({ make: d.car?.make, model: d.car?.model, year: d.car?.year, plate: d.car?.plate, vin: d.car?.vin }).filter(([, v]) => v)))} />
        ${f.car.car_id ? html`<span class="chip">из базы CRM</span>` : ''}</div>
      <div class="grid g4">${carIn('plate', 'Nr rej.')}<label class="f">VIN<div class="ig"><input value=${f.car.vin} style="text-transform:uppercase" onInput=${(e) => setC({ vin: e.target.value })} maxlength="17" />
          <button type="button" class="addon btn" title="Расшифровать VIN" disabled=${String(f.car.vin).replace(/\W/g, '').length !== 17} onClick=${decodeVin}><${Icon} n="search" /></button></div></label>
        ${carIn('make', 'Марка')}${carIn('model', 'Модель')}</div>
      <div class="grid g4">${carIn('year', 'Год')}${carIn('mileage', 'Пробег, км', { type: 'number' })}${carIn('engine', 'Двигатель')}
        <div class="f" style="align-self:end">${f.car.plate && html`<${PlateButton} plate=${f.car.plate} onData=${(r) => setC(Object.fromEntries(Object.entries({ make: r.make, model: r.model, year: r.year, vin: r.vin }).filter(([k, v]) => v && !f.car[k])))} />`}
          ${!doc && !f.car.car_id && html`<label class="check" style="display:inline-flex;margin-left:8px"><input type="checkbox" checked=${f.save_car} onChange=${(e) => set({ ...f, save_car: e.target.checked })} />Сохранить авто в CRM</label>`}</div></div>
    </div>`}

    <table class="tbl inv-lines" style="margin-top:12px"><thead><tr><th>Позиция</th><th class="r">Кол-во</th><th>Ед.</th><th class="r">Цена нетто</th><th class="r">Цена брутто</th><th>VAT</th><th class="r">Сумма брутто</th><th></th></tr></thead><tbody>
      ${f.lines.map((l, i) => html`<tr><td style="min-width:260px"><${LineName} l=${l} onInput=${(v) => setL(i, { name: v, product_id: null, catalog_id: null })} onPick=${(patch) => setL(i, patch)} /></td>
        <td class="r"><input class="inline-input num qty" type="number" step="0.01" value=${l.qty} onInput=${(e) => setL(i, { qty: e.target.value })} /></td>
        <td><input class="inline-input" style="width:60px" value=${l.unit} onInput=${(e) => setL(i, { unit: e.target.value })} /></td>
        <td class="r"><input class=${'inline-input num price' + (l.price_mode === 'net' ? ' on' : '')} type="number" step="0.01" value=${l.price_mode === 'net' ? l.unit_net : (l.unit_gross === '' ? '' : net1(l))} onInput=${(e) => setL(i, { unit_net: e.target.value, price_mode: 'net' })} /></td>
        <td class="r"><input class=${'inline-input num price' + (l.price_mode !== 'net' ? ' on' : '')} type="number" step="0.01" value=${l.price_mode !== 'net' ? l.unit_gross : (l.unit_net === '' ? '' : gross1(l))} onInput=${(e) => setL(i, { unit_gross: e.target.value, price_mode: 'gross' })} /></td>
        <td><select class="inline-input" value=${l.vat} onChange=${(e) => setL(i, { vat: Number(e.target.value) })}>${vats.map((v) => html`<option value=${v}>${v}%</option>`)}</select></td>
        <td class="r nowrap">${zl(lineSum(l))}</td>
        <td class="act">${f.lines.length > 1 && html`<button class="icon-btn" onClick=${() => set({ ...f, lines: f.lines.filter((_, j) => j !== i) })}><${Icon} n="trash" /></button>`}</td></tr>`)}</tbody></table>
    <button class="btn sm" style="margin-top:8px" onClick=${() => set({ ...f, lines: [...f.lines, LINE0()] })}><${Icon} n="plus" />Позиция</button>
    <label class="f" style="margin-top:10px">Примечание<input value=${f.notes} onInput=${(e) => set({ ...f, notes: e.target.value })} /></label>
  </${Modal}>`;
}

const REASONS_K = ['Rabat udzielony po wystawieniu faktury', 'Zwrot towaru', 'Błędna cena', 'Błędna ilość', 'Błędne dane nabywcy', 'Pomyłka w pozycji'];
/** Корректа к фактуре VAT: позиции исходной фактуры (кол-во, цена брутто) и/или данные покупателя */
export function CorrectionModal({ docId, onClose, onDone }) {
  const { data: d } = useData('sales-docs/' + docId, [docId]);
  const [c, set] = useState(null);
  useEffect(() => { if (d && !c) set({ reason: '', lines: (d.items || []).map((l) => ({ name: l.name, qty: l.qty, unit_gross: l.qty ? r2(l.gross / l.qty) : 0, q0: l.qty, p0: l.qty ? r2(l.gross / l.qty) : 0 })), buyerOn: false, buyer: { name: '', nip: '', street: '', postcode: '', city: '', ...d.buyer } }); }, [d]);
  if (!d || !c) return html`<${Modal} title="Корректа" onClose=${onClose}><${Loading} /></${Modal}>`;
  const newTotal = r2(c.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_gross) || 0), 0));
  const linesChanged = c.lines.some((l) => Number(l.qty) !== Number(l.q0) || Math.abs(Number(l.unit_gross) - l.p0) > 0.001);
  const buyerChanged = c.buyerOn && ['name', 'nip', 'street', 'postcode', 'city'].some((k) => String(c.buyer[k] || '').trim() !== String(d.buyer?.[k] || '').trim());
  const why = !c.reason.trim() ? 'Укажите причину корректы (можно выбрать ниже)' : !linesChanged && !buyerChanged ? 'Ничего не изменено: поменяйте количество, цену или данные покупателя' : '';
  const setL = (i, patch) => { const L = [...c.lines]; L[i] = { ...L[i], ...patch }; set({ ...c, lines: L }); };
  const save = async () => {
    const r = await act(() => api(`sales-docs/${d.id}/correct`, { body: { reason: c.reason, lines: c.lines.map((l) => ({ qty: Number(l.qty), unit_gross: Number(l.unit_gross) })), buyer: buyerChanged ? c.buyer : undefined } }));
    toast(`Корректа ${r.number} выставлена${r.ksef_number ? ' · KSeF ' + r.ksef_number : ''}`); if (r.warning) toast(r.warning, 'error');
    onDone(r.id);
  };
  return html`<${Modal} wide title=${'Корректа к ' + d.number} onClose=${onClose} foot=${html`<span class="muted small" style="margin-right:auto">Было ${zl(d.total_gross)} → станет ${zl(newTotal)}${why ? html`<br /><span class="neg">${why}</span>` : ''}</span>
      <button class="btn" onClick=${onClose}>Отмена</button><button class="btn primary" onClick=${save} disabled=${!!why} title=${why}>Выставить корректу</button>`}>
    <label class="f">Причина корректы (обязательно)<input value=${c.reason} onInput=${(e) => set({ ...c, reason: e.target.value })} placeholder="np. Rabat udzielony po wystawieniu faktury / zwrot towaru" /></label>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin:6px 0 12px">${REASONS_K.map((t) => html`<button class=${'btn sm' + (c.reason === t ? ' primary' : '')} onClick=${() => set({ ...c, reason: t, buyerOn: t === 'Błędne dane nabywcy' ? true : c.buyerOn })}>${t}</button>`)}</div>
    <table class="tbl"><thead><tr><th>Позиция</th><th class="r">Было</th><th class="r">Кол-во</th><th class="r">Цена брутто за ед.</th><th class="r">Сумма</th></tr></thead><tbody>
      ${c.lines.map((l, i) => html`<tr class=${Number(l.qty) !== Number(l.q0) || Math.abs(Number(l.unit_gross) - l.p0) > 0.001 ? 'chg' : ''}><td>${l.name}</td><td class="r sub nowrap">${l.q0} × ${zl(l.p0)}</td>
        <td class="r"><input class="inline-input num qty" type="number" step="0.01" value=${l.qty} onInput=${(e) => setL(i, { qty: e.target.value })} /></td>
        <td class="r"><input class="inline-input num price" type="number" step="0.01" value=${l.unit_gross} onInput=${(e) => setL(i, { unit_gross: e.target.value })} /></td>
        <td class="r nowrap">${zl((Number(l.qty) || 0) * (Number(l.unit_gross) || 0))}</td></tr>`)}</tbody></table>
    <div class="row" style="margin-top:10px;gap:8px"><button class="btn sm" onClick=${() => set({ ...c, lines: c.lines.map((l) => ({ ...l, qty: 0 })) })}>Корректа до нуля</button>
      <button class="btn sm" onClick=${() => set({ ...c, lines: c.lines.map((l) => ({ ...l, qty: l.q0, unit_gross: l.p0 })) })}>Вернуть как было</button>
      <label class="check" style="margin-left:auto"><input type="checkbox" checked=${c.buyerOn} onChange=${(e) => set({ ...c, buyerOn: e.target.checked })} />Исправить данные покупателя</label></div>
    ${c.buyerOn && html`<div class="inv-car" style="margin-top:8px"><div class="grid g3">${[['name', 'Название / имя'], ['nip', 'NIP'], ['street', 'Улица'], ['postcode', 'Индекс'], ['city', 'Город']].map(([k, l]) => html`<label class="f">${l}<input value=${c.buyer[k] || ''} onInput=${(e) => set({ ...c, buyer: { ...c.buyer, [k]: e.target.value } })} /></label>`)}</div>
      <div class="muted small">Было: ${[d.buyer?.name, d.buyer?.nip && 'NIP ' + d.buyer.nip, d.buyer?.street, [d.buyer?.postcode, d.buyer?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</div></div>`}
  </${Modal}>`;
}

/** Карточка документа: просмотр, «Редактировать» (пока фактура не в KSeF), печать/PDF, отправка в KSeF */
export function SaleDocPage({ id }) {
  const app = useApp();
  const { data: d, error, reload } = useData('sales-docs/' + id, [id]);
  const [edit, setEdit] = useState(false);
  const [corr, setCorr] = useState(false);
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!d) return html`<${Loading} />`;
  const st = d.kind !== 'proforma' ? KS[d.ksef_status] : null;
  const b = d.buyer || {}, c = d.car;
  const due = Math.max(0, r2(d.total_gross - d.paid));
  return html`
    <div class="crumbs"><a href="#/sales">Продажи</a></div>
    <div class="page-head"><h1>${d.number}</h1><span class="chip">${TYPE[d.kind]}</span>
      ${st ? html`<span class="badge" style=${`border-color:${st[1]};color:${st[1]}`}>${st[0]}</span>` : d.kind !== 'proforma' ? html`<span class="sub">${d.ext_url ? 'через Fakturownia' : 'не в KSeF'}</span>` : ''}
      <div class="actions">
        ${d.editable && html`<button class="btn" onClick=${() => setEdit(true)}><${Icon} n="edit" />Редактировать</button>`}
        ${d.kind === 'vat' && !d.ext_id && html`<button class="btn" onClick=${() => setCorr(true)}>Корректа</button>`}
        ${d.kind === 'proforma' && !d.vat_id && !d.order_has_vat && html`<button class="btn primary" onClick=${async () => { const r = await act(() => api(`sales-docs/${d.id}/to-vat`, { body: {} })); toast(`${r.number} выставлена${r.ksef_number ? ' · KSeF ' + r.ksef_number : ''}`); if (r.warning) toast(r.warning, 'error'); go('/sales/' + r.id); }}><${Icon} n="file" />Выставить фактуру VAT</button>`}
        ${(d.kind === 'vat' || d.kind === 'correction') && app.features.ksef && d.ksef_status !== 'accepted' && !d.ext_url && html`<button class="btn" onClick=${async () => { const x = await act(() => api(`sales-docs/${d.id}/ksef`, { body: {} })); toast(x.ksef_number ? 'KSeF: ' + x.ksef_number : 'Статус: ' + (x.ksef_status || '—'), x.ksef_status === 'rejected' ? 'error' : 'ok'); reload(); }}>Отправить в KSeF</button>`}
        ${d.ksef_number && html`<a class="btn" href=${'/crm-api/sales-docs/' + d.id + '/upo'}>UPO</a>`}
        <a class="btn primary" href=${d.ext_url || '/crm-api/print/sale/' + d.id} target="_blank" rel="noopener"><${Icon} n="print" />Печать / PDF</a>
        ${canDeleteDoc(app, d) && html`<${ConfirmButton} cls="btn danger" label=${`Удалить ${d.number}?`} onConfirm=${async () => { await act(() => api('sales-docs/' + d.id, { method: 'DELETE' }), 'Удалено'); go('/sales'); }}><${Icon} n="trash" /></${ConfirmButton}>`}</div></div>
    ${d.vat_id ? html`<div class="small" style="margin:-8px 0 12px">На основании этой Pro forma выставлена <a href=${'#/sales/' + d.vat_id}>${d.vat_no}</a></div>` : ''}
    ${d.proforma_id ? html`<div class="small" style="margin:-8px 0 12px">Выставлена на основании <a href=${'#/sales/' + d.proforma_id}>${d.proforma_no}</a></div>` : ''}
    ${!d.editable && d.kind !== 'correction' && html`<div class="muted small" style="margin:-8px 0 12px">Фактура уже в KSeF${d.ext_id ? ' / Fakturownia' : ''} — изменить её можно только корректой (кнопка «Корректа» выше).</div>`}
    ${d.ksef_error && html`<div class="card" style="border-color:var(--danger);margin-bottom:12px"><b style="color:var(--danger)">KSeF:</b> ${d.ksef_error}</div>`}
    <div class="grid g3" style="margin-bottom:12px">
      <div class="card"><h3 class="small muted">Покупатель</h3><b>${b.name || '—'}</b><div>${[b.street, [b.postcode, b.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</div>${b.nip ? html`<div class="sub">NIP ${b.nip}</div>` : ''}</div>
      <div class="card"><h3 class="small muted">Даты и оплата</h3>
        <div class="kv-list"><span>Выставлена</span><b>${fdate(d.issue_date)}</b><span>Продажа</span><b>${fdate(d.sale_date)}</b><span>Срок оплаты</span><b>${fdate(d.due_date)}</b>
          <span>Оплата</span><b>${PAYM[d.payment_method] || d.payment_method || '—'}${d.pay_split?.length ? html`<div class="sub">${d.pay_split.map((x) => `${PAYM[x.method]} ${zl(x.amount)}`).join(' · ')}</div>` : ''}</b>
          <span>Оплачено</span><b class=${due > 0.01 ? 'neg' : 'pos'}>${zl(d.paid)}${due > 0.01 ? ` · к оплате ${zl(due)}` : ''}</b></div></div>
      <div class="card"><h3 class="small muted">${d.order_id ? 'Заказ' : 'Автомобиль'}</h3>
        ${d.order_id ? html`<a href=${'#/orders/' + d.order_id}>${d.order_no}</a>` : ''}
        ${c ? html`<div><b>${[c.make, c.model, c.year].filter(Boolean).join(' ') || '—'}</b> ${c.plate ? html`<span class="plate">${c.plate}</span>` : ''}</div>
          <div class="sub">${[c.vin && 'VIN ' + c.vin, c.mileage && c.mileage + ' km', c.engine].filter(Boolean).join(' · ')}</div>${c.car_id ? html`<a class="small" href=${'#/cars/' + c.car_id}>Карточка авто →</a>` : ''}`
          : !d.order_id ? html`<span class="muted">не указан</span>` : ''}</div></div>
    <div class="card tight"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Позиция</th><th class="r">Кол-во</th><th>Ед.</th><th class="r">Цена нетто</th><th class="r">Нетто</th><th class="c">VAT</th><th class="r">Брутто</th></tr></thead>
      <tbody>${(d.items || []).map((l, n) => html`<tr><td class="sub">${n + 1}</td><td>${l.name}${l.code ? html`<div class="sub">${l.code}</div>` : ''}</td><td class="r">${l.qty}</td><td>${l.unit}</td><td class="r nowrap">${zl(l.unit_net)}</td><td class="r nowrap">${zl(l.net)}</td><td class="c">${l.vat}%</td><td class="r nowrap"><b>${zl(l.gross)}</b></td></tr>`)}</tbody>
      <tfoot><tr><td colspan="5">Итого</td><td class="r nowrap">${zl(d.total_net)}</td><td class="c sub">${zl(d.total_vat)}</td><td class="r nowrap"><b>${zl(d.total_gross)}</b></td></tr></tfoot></table></div></div>
    ${d.notes && html`<div class="card" style="margin-top:12px"><span class="muted small">Примечание:</span> ${d.notes}</div>`}
    ${d.corrections?.length ? html`<div class="card" style="margin-top:12px"><h3 class="small muted">Корректы</h3>${d.corrections.map((x) => html`<div><a href=${'#/sales/' + x.id}>${x.number}</a> <span class="sub">${fdate(x.issue_date)} · ${zl(x.total_gross)}</span></div>`)}</div>` : ''}
    ${corr && html`<${CorrectionModal} docId=${d.id} onClose=${() => setCorr(false)} onDone=${(id) => { setCorr(false); go('/sales/' + id); }} />`}
    ${edit && html`<${InvoiceForm} kind=${d.kind} doc=${d} onClose=${() => setEdit(false)} onDone=${() => { setEdit(false); reload(); }} />`}`;
}

/** Пакет для бухгалтера: всё за месяц одним архивом или одним PDF */
function AccountantPack({ onClose }) {
  const d = new Date();
  const ym = (y, m) => { const a = new Date(y, m, 1), b = new Date(y, m + 1, 0); const f = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; return [f(a), f(b)]; };
  const [[from, to], setRange] = useState(ym(d.getFullYear(), d.getMonth() - 1));
  const [k, setK] = useState({ vat: true, correction: true, proforma: false, receipts: true, html: true, xml: true });
  const kinds = ['vat', 'correction', 'proforma'].filter((x) => k[x]).join(',');
  const q = qs({ from, to, kinds, receipts: k.receipts ? 1 : 0, html: k.html ? 1 : 0, xml: k.xml ? 1 : 0 });
  const box = (key, label) => html`<label class="check"><input type="checkbox" checked=${k[key]} onChange=${(e) => setK({ ...k, [key]: e.target.checked })} />${label}</label>`;
  return html`<${Modal} title="Пакет для бухгалтера" onClose=${onClose} foot=${html`
      <button class="btn" onClick=${() => window.open('/crm-api/sales-docs/print-all?' + qs({ from, to, kinds }), '_blank')}><${Icon} n="print" />Все фактуры одним PDF</button>
      <a class="btn primary" style="margin-left:auto" href=${'/crm-api/sales-docs/export.zip?' + q} onClick=${() => setTimeout(onClose, 300)}><${Icon} n="download" />Скачать ZIP</a>`}>
    <div class="row wrap" style="gap:6px;margin-bottom:10px">
      <button class="btn sm" onClick=${() => setRange(ym(d.getFullYear(), d.getMonth() - 1))}>Прошлый месяц</button>
      <button class="btn sm" onClick=${() => setRange(ym(d.getFullYear(), d.getMonth()))}>Этот месяц</button>
      <button class="btn sm" onClick=${() => { const q = Math.floor(d.getMonth() / 3); setRange([ym(d.getFullYear(), (q - 1) * 3)[0], ym(d.getFullYear(), q * 3 - 1)[1]]); }}>Прошлый квартал</button></div>
    <div class="grid g2"><label class="f">С<input type="date" value=${from} onInput=${(e) => setRange([e.target.value, to])} /></label><label class="f">По<input type="date" value=${to} onInput=${(e) => setRange([from, e.target.value])} /></label></div>
    <div class="stack" style="margin-top:10px;gap:4px"><b class="small">Какие документы</b>${box('vat', 'Фактуры VAT')}${box('correction', 'Фактуры корректирующие')}${box('proforma', 'Pro forma')}${box('receipts', 'Чеки (paragony) — в реестр Excel')}</div>
    <div class="stack" style="margin-top:10px;gap:4px"><b class="small">Что положить в архив</b>
      <div class="muted small">Всегда: реестр продаж Excel (по ставкам VAT, корректы — разницей, итоги).</div>
      ${box('html', 'Каждая фактура отдельным файлом (открыть → печать → PDF)')}${box('xml', 'XML из KSeF (юридическая e-фактура)')}</div>
    <div class="muted small" style="margin-top:10px">«Все фактуры одним PDF» откроет все документы подряд — нажмите «Drukuj / zapisz jako jeden PDF» и выберите «Сохранить как PDF».</div>
  </${Modal}>`;
}
