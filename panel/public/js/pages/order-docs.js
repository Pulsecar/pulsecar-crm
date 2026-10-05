// Документы заказа: печать (протоколы, спецификация, карта механика, kosztorys), фактуры VAT / Pro forma / корректы,
// приём авто (схема повреждений, фото и файлы, подписи клиента)
import { CorrectionModal } from './sales.js';
import { printReceipt } from '../fiscal.js';
import { html, useState, useRef, api, act, go, useApp, Icon, Modal, ConfirmButton, zl, num, fdt, toast, METHOD } from '../lib.js';
import { carShapeSvg, detectBody, BODY_TYPES } from '../car-shapes.js';

const PRINTS = [['intake', 'Протокол приёма', 'Protokół przyjęcia'], ['estimate', 'Kosztorys / выцена', 'Kosztorys'], ['spec', 'Спецификация заказа', 'Specyfikacja'],
  ['mechanic', 'Карта для механика', 'Karta dla mechanika'], ['release', 'Протокол выдачи', 'Protokół wydania']];

export function DocsMenu({ o }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const list = o.kind === 'quote' ? [['estimate', 'Wycena (выцена)']] : PRINTS.filter(([k]) => app.perms['orders.prices'] || k === 'mechanic' || k === 'intake');
  return html`<div class="menu-wrap" onMouseLeave=${() => setOpen(false)}>
    <button class="btn" onClick=${() => setOpen(!open)} aria-expanded=${open}><${Icon} n="print" />Документы ▾</button>
    ${open && html`<div class="menu">${list.map(([k, l]) => html`<a href=${`/crm-api/print/${k}/${o.id}`} target="_blank" rel="noopener" onClick=${() => setOpen(false)}>${l}</a>`)}
      ${o.sales_docs?.map((d) => html`<a href=${'/crm-api/print/sale/' + d.id} target="_blank" rel="noopener">${d.number}</a>`)}</div>`}
  </div>`;
}

const KIND = { vat: 'Фактура VAT', proforma: 'Pro forma', correction: 'Корректа' };
const PAYM = [['cash', 'Наличные'], ['card', 'Карта'], ['blik', 'BLIK'], ['transfer', 'Перевод'], ['mixed', 'Смешанная оплата']];

const KS = { accepted: ['Przyjęty', 'var(--accent)'], sent: ['Wysłano, ждём номер', 'var(--warn)'], rejected: ['Odrzucony', 'var(--danger)'], error: ['Ошибка отправки', 'var(--danger)'] };
function KsefChip({ d }) {
  if (!d.ksef_status) return d.ext_url ? html`<div class="sub">KSeF через Fakturownia</div>` : html`<div class="sub">не в KSeF</div>`;
  const [l, c] = KS[d.ksef_status] || [d.ksef_status, 'var(--muted)'];
  return html`<div class="small"><span class="badge" style=${`border-color:${c};color:${c}`}>KSeF · ${l}</span> ${d.ksef_number ? html`<span class="sub mono">${d.ksef_number}</span>` : ''}
    ${d.ksef_error ? html`<div class="sub" style="color:var(--danger)">${d.ksef_error}</div>` : ''}</div>`;
}

export function SalesDocs({ o, reload }) {
  const app = useApp();
  const [form, setForm] = useState(null);
  const [corr, setCorr] = useState(null);
  const [par, setPar] = useState(false);
  const hasVat = o.sales_docs?.some((d) => d.kind === 'vat');
  const open = (kind) => setForm({
    kind, payment_method: (() => { const m = [...new Set((o.payments || []).filter((p) => p.method !== 'points' && p.amount > 0).map((p) => p.method))]; return m.length > 1 ? 'mixed' : m[0]; })() || o.customer?.payment_method || app.settings.payment_method_default || 'cash', due_days: o.customer?.payment_term_days ?? app.settings.payment_term_days ?? 0,
    issue_date: new Date().toISOString().slice(0, 10), buyer: { name: o.customer?.company || o.customer?.name || '', nip: o.customer?.nip || '', street: o.customer?.street || '', postcode: o.customer?.postcode || '', city: o.customer?.city || '' }, notes: '',
  });
  const issue = async () => {
    const r = await act(() => api(`orders/${o.id}/sales-docs`, { body: form }));
    toast(`${KIND[r.kind]} ${r.number} выставлена`);
    if (r.warning) toast(r.warning, 'error');
    setForm(null); reload();
    window.open('/crm-api/print/sale/' + r.id, '_blank', 'noopener');
  };
  const startCorr = (d) => setCorr(d.id);
  return html`<div class="card">
    <h2>Документы продажи</h2>
    ${o.sales_docs?.length ? html`<table class="tbl" style="margin-bottom:10px"><tbody>${o.sales_docs.map((d) => html`<tr>
      <td><b>${d.number}</b><div class="sub">${KIND[d.kind]} · ${d.issue_date}</div>${d.kind !== 'proforma' ? html`<${KsefChip} d=${d} />` : ''}</td><td class="r nowrap">${zl(d.total_gross)}</td>
      <td class="act nowrap"><a class="btn sm" href=${'#/sales/' + d.id}>Открыть</a><a class="icon-btn" title="Печать / PDF" href=${'/crm-api/print/sale/' + d.id} target="_blank" rel="noopener"><${Icon} n="print" /></a>
        ${d.kind === 'proforma' && !hasVat && html`<button class="btn sm primary" onClick=${async () => { const r = await act(() => api(`sales-docs/${d.id}/to-vat`, { body: {} })); toast(`${r.number} выставлена из ${d.number}${r.ksef_number ? ' · KSeF ' + r.ksef_number : ''}`); if (r.warning) toast(r.warning, 'error'); go('/sales/' + r.id); }}>→ Фактура VAT</button>`}
        ${d.kind !== 'proforma' && !d.ext_url && app.features.ksef && d.ksef_status !== 'accepted' && html`<button class="btn sm" onClick=${async () => { const r = await act(() => api(`sales-docs/${d.id}/ksef`, { body: {} })); toast(r.ksef_number ? 'KSeF: ' + r.ksef_number : r.ksef_status === 'rejected' ? 'KSeF отклонил: ' + r.ksef_error : 'Отправлено, ждём номер KSeF', r.ksef_status === 'rejected' ? 'error' : 'ok'); reload(); }}>${d.ksef_status ? 'Проверить KSeF' : 'В KSeF'}</button>`}
        ${d.ksef_number && html`<a class="btn sm" href=${'/crm-api/sales-docs/' + d.id + '/upo'}>UPO</a>`}
        ${d.kind !== 'proforma' && html`<a class="btn sm" href=${'/crm-api/sales-docs/' + d.id + '/xml'} title="XML FA(3)">XML</a>`}
        ${d.ext_url && html`<a class="btn sm" href=${d.ext_url} target="_blank" rel="noopener">Fakturownia</a>`}
        ${d.kind === 'vat' && html`<button class="btn sm" onClick=${() => startCorr(d)}>Корректа</button>`}
        ${d.kind === 'proforma' && html`<${ConfirmButton} cls="icon-btn" onConfirm=${async () => { await act(() => api('sales-docs/' + d.id, { method: 'DELETE' }), 'Удалено'); reload(); }}><${Icon} n="trash" /></${ConfirmButton}>`}</td></tr>`)}</tbody></table>`
      : html`<div class="muted small" style="margin-bottom:10px">Фактур пока нет. ${app.features.ksef ? 'Фактура VAT сразу уйдёт в KSeF.' : app.features.invoices ? 'Фактура VAT уйдёт в Fakturownia и KSeF.' : html`Фактура VAT будет выставлена в CRM без KSeF — <a href="#/settings/integrations">подключить KSeF</a>.`}</div>`}
    ${(o.receipts?.length || o.receipt_no) ? html`<table class="tbl" style="margin-bottom:10px"><tbody>
      ${(o.receipts || []).map((r) => html`<tr><td><b>Чек (paragon)</b>${r.number ? html` <b>№ ${r.number}</b>` : ''}<div class="sub">${fdt(r.printed_at || r.created_at)}${r.nip ? ' · NIP ' + r.nip : ''} · ${r.status === 'printed' ? 'напечатан на кассе' : r.status === 'manual' ? 'номер вручную' : r.status === 'error' ? 'ошибка кассы' : 'ждёт кассы'}</div></td><td class="r nowrap">${zl(r.total)}</td><td></td></tr>`)}
      ${o.receipt_no && !(o.receipts || []).length ? html`<tr><td><b>Чек (paragon)</b> <b>№ ${o.receipt_no}</b><div class="sub">пробит на кассовом аппарате</div></td><td class="r nowrap">${zl(o.total)}</td><td></td></tr>` : ''}
      </tbody></table>` : ''}
    <div class="row"><button class=${'btn' + (hasVat ? '' : ' primary')} disabled=${!o.items.length} onClick=${() => setPar(true)}><${Icon} n="print" />Чек (paragon)</button>
      ${!hasVat && html`<button class="btn primary" disabled=${!o.items.length} onClick=${() => open('vat')}>Фактура VAT</button>`}
      ${app.settings.proforma_on !== '0' && html`<button class="btn" disabled=${!o.items.length} onClick=${() => open('proforma')}>Pro forma</button>`}</div>
    ${o.invoice_no && !o.sales_docs?.some((d) => d.kind === 'vat') ? html`<div class="small" style="margin-top:8px">Фактура из Fakturownia: <b>${o.invoice_no}</b> <a class="btn sm" href=${'/crm-api/orders/' + o.id + '/invoice.pdf'} target="_blank" rel="noopener">PDF</a></div>` : ''}

    ${form && html`<${Modal} wide title=${KIND[form.kind] + ' — ' + zl(o.total)} onClose=${() => setForm(null)} foot=${html`<button class="btn" onClick=${() => setForm(null)}>Отмена</button><button class="btn primary" onClick=${issue}>Выставить</button>`}>
      <h3 class="small muted">Покупатель (Nabywca)</h3>
      <div class="grid g3">${[['name', 'Название / имя'], ['nip', 'NIP'], ['street', 'Улица'], ['postcode', 'Индекс'], ['city', 'Город']].map(([k, l]) => html`<label class="f">${l}<input value=${form.buyer[k]} onInput=${(e) => setForm({ ...form, buyer: { ...form.buyer, [k]: e.target.value } })} /></label>`)}</div>
      <div class="grid g4" style="margin-top:10px">
        <label class="f">Дата выставления<input type="date" value=${form.issue_date} onInput=${(e) => setForm({ ...form, issue_date: e.target.value })} /></label>
        ${form.kind === 'vat' && html`<label class="f">Дата продажи<input type="date" value=${form.sale_date || form.issue_date} onInput=${(e) => setForm({ ...form, sale_date: e.target.value })} /></label>`}
        <label class="f">Оплата<select value=${form.payment_method} onChange=${(e) => setForm({ ...form, payment_method: e.target.value })}>${PAYM.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
        <label class="f">Срок оплаты, дней<input type="number" min="0" value=${form.due_days} onInput=${(e) => setForm({ ...form, due_days: e.target.value })} /></label></div>
      <label class="f" style="margin-top:10px">Примечание на документе<input value=${form.notes} onInput=${(e) => setForm({ ...form, notes: e.target.value })} placeholder="np. Zapłacono kartą" /></label>
      ${o.paid > 0 && html`<div class="small" style="margin-top:8px">Оплаты заказа попадут на фактуру: ${[...new Set(o.payments.filter((p) => p.method !== 'points').map((p) => METHOD[p.method] || p.method))].join(' + ')} · ${zl(Math.min(o.paid, o.total))}${o.paid > o.total + 0.01 ? html` <span class="neg">(оплачено больше суммы заказа на ${zl(o.paid - o.total)})</span>` : ''}</div>`}
      <div class="muted small" style="margin-top:8px">Позиции берутся из заказа: ${o.items.length} шт. Номер — по настройке нумерации (${form.kind === 'vat' ? 'FV' : 'PRO'}).</div>
    </${Modal}>`}

    ${par && html`<${ParagonModal} o=${o} onClose=${() => setPar(false)} onDone=${() => { setPar(false); reload(); }} />`}
    ${corr && html`<${CorrectionModal} docId=${corr} onClose=${() => setCorr(null)} onDone=${() => { setCorr(null); reload(); }} />`}
  </div>`;
}

// ── Приём авто: схема повреждений, фото, подписи ──────────────────────────
export const DMG = [['rysa', 'Царапина'], ['wgniecenie', 'Вмятина'], ['odprysk', 'Скол'], ['pekniecie', 'Трещина'], ['korozja', 'Коррозия'], ['brak', 'Нет детали'], ['inne', 'Другое']];
const DOCNAME = { intake: 'Протокол приёма', estimate: 'Kosztorys', quote: 'Выцена', release: 'Протокол выдачи' };
const SIGN = { button: 'кнопка «Akceptuję»', sms: 'код SMS', drawn: 'подпись от руки', paper: 'на бумаге' };

export function CarDiagram({ marks, onAdd, onPick, sel, body = 'sedan' }) {
  const ref = useRef(null);
  const click = (e) => {
    const r = ref.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 100), y = Math.round(((e.clientY - r.top) / r.height) * 100);
    if (y < 4 || y > 96) return;
    onAdd({ x, y });
  };
  return html`<svg ref=${ref} viewBox="0 0 200 400" class="car-diagram" onClick=${click} role="img" aria-label="Схема авто: нажмите, чтобы отметить повреждение">
    <g dangerouslySetInnerHTML=${{ __html: carShapeSvg(body, { theme: 'ui', labels: ['ПЕРЕД', 'ЗАД'] }) }} />
    ${marks.map((m, i) => html`<g onClick=${(e) => { e.stopPropagation(); onPick(i); }} style="cursor:pointer"><circle cx=${m.x * 2} cy=${m.y * 4} r=${sel === i ? 12 : 10} fill="#e34948" stroke="#fff" stroke-width="2" />
      <text x=${m.x * 2} y=${m.y * 4 + 4} text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${i + 1}</text></g>`)}
  </svg>`;
}

export function Intake({ o, reload }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const canEdit = !!app.perms['orders.edit'];
  const upload = async (files) => {
    if (!files?.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    setBusy(true);
    try { await act(() => api(`orders/${o.id}/files`, { form: fd }), 'Файлы загружены'); reload(); } finally { setBusy(false); }
  };
  return html`<div class="grid g2">
      <div class="card">
        <div class="row" style="margin-bottom:8px"><h2 style="margin:0">Фото и файлы</h2>
          ${canEdit && html`<label class="btn sm primary" style="margin-left:auto">${busy ? 'Загружаю…' : 'Добавить'}<input type="file" multiple accept="image/*,video/*,application/pdf" style="display:none" onChange=${(e) => upload(e.target.files)} /></label>`}</div>
        ${o.files?.length ? html`<div class="file-grid">${o.files.map((f) => html`<div class="file-tile">
            <a href=${'/crm-api/files/' + f.id} target="_blank" rel="noopener">${/^image\//.test(f.mime) ? html`<img src=${'/crm-api/files/' + f.id} alt="" loading="lazy" />` : html`<div class="file-ph">${/^video\//.test(f.mime) ? 'Видео' : 'PDF'}</div>`}</a>
            <div class="sub" title=${f.name}>${f.name}</div>
            <div class="row" style="gap:6px"><label class="check small"><input type="checkbox" checked=${!!f.client_visible} disabled=${!canEdit} onChange=${async (e) => { await act(() => api('files/' + f.id, { method: 'PUT', body: { client_visible: e.target.checked } })); reload(); }} />клиенту</label>
              ${canEdit && html`<${ConfirmButton} cls="icon-btn" onConfirm=${async () => { await act(() => api('files/' + f.id, { method: 'DELETE' }), 'Удалено'); reload(); }}><${Icon} n="trash" /></${ConfirmButton}>`}</div></div>`)}</div>`
          : html`<div class="muted small">Фото авто при приёме, видео диагностики, PDF — до 30 МБ на файл. Клиент увидит их в электронной карте.</div>`}
      </div>
      <div class="card">
        <h2>Подписи клиента</h2>
        ${o.signatures?.length ? html`<table class="tbl"><tbody>${o.signatures.map((g) => html`<tr><td>${DOCNAME[g.doc] || g.doc}</td><td class="sub">${fdt(g.signed_at)}</td><td class="sub">${SIGN[g.method] || g.method}${g.signer_name ? ' · ' + g.signer_name : ''}</td></tr>`)}</tbody></table>`
          : html`<div class="muted small">Клиент ещё ничего не подписал. Отправьте ссылку на электронную карту (SMS / e-mail) — он подпишет протокол и выцену с телефона.</div>`}
        ${canEdit && html`<div class="row" style="margin-top:10px">${['intake', o.kind === 'quote' ? 'quote' : 'estimate', 'release'].filter((d) => o.kind !== 'quote' || d === 'quote').map((d) => html`<button class="btn sm" onClick=${async () => { await act(() => api(`orders/${o.id}/signatures`, { body: { doc: d } }), 'Отмечено'); reload(); }}>${DOCNAME[d]}: подписан на бумаге</button>`)}</div>`}
      </div>
  </div>`;
}

/** Чек (paragon) по заказу за один шаг: принять оплату (в т.ч. смешанную) + чек на фискальной кассе или номер чека с кассового аппарата */
function ParagonModal({ o, onClose, onDone }) {
  const app = useApp();
  const fiscal = app.features.fiscal;
  const due = Math.max(0, Math.round((o.total - o.paid) * 100) / 100);
  const nip0 = (o.customer?.nip || '').replace(/\D/g, '');
  const [f, set] = useState({ method: 'card', amount: due, split: { cash: '', card: '', blik: '', transfer: '' }, nip: nip0, withNip: !!nip0, no: '' });
  const [busy, setBusy] = useState(false);
  const mixed = f.method === 'mixed';
  const splitSum = Math.round(['cash', 'card', 'blik', 'transfer'].reduce((a, k) => a + (Number(f.split[k]) || 0), 0) * 100) / 100;
  const payAmt = mixed ? splitSum : Number(f.amount) || 0;
  const go = async () => {
    setBusy(true);
    try {
      if (payAmt > 0) {
        const body = mixed ? { split: ['cash', 'card', 'blik', 'transfer'].map((k) => ({ method: k, amount: Number(f.split[k]) || 0 })).filter((x) => x.amount > 0) } : { method: f.method, amount: payAmt };
        await api(`orders/${o.id}/payments`, { body });
      }
      if (fiscal) {
        const x = await printReceipt(o.id, { nip: f.withNip ? f.nip : '', method: null });
        if (x.manual) toast('Оплата принята. Чек создан — пробейте его на кассе и впишите номер');
        else if (x.receipt?.status === 'printed') toast('Оплата принята, чек напечатан' + (x.receipt.number ? ' · № ' + x.receipt.number : ''));
        else toast(x.receipt?.error || 'Оплата принята, но чек не напечатан', 'error');
      } else {
        if (f.no.trim()) await api('orders/' + o.id, { method: 'PUT', body: { receipt_no: f.no.trim() } });
        toast(payAmt > 0 ? 'Оплата принята' + ' · ' + zl(payAmt) : 'Номер чека сохранён');
      }
      onDone();
    } catch (e) { toast(e.message, 'error'); setBusy(false); }
  };
  return html`<${Modal} title=${'Paragon · ' + zl(o.total)} onClose=${onClose} foot=${html`<button class="btn" onClick=${onClose}>Отмена</button>
      <button class="btn primary" disabled=${busy || (f.withNip && fiscal && f.nip.length !== 10) || (mixed && splitSum > due + 0.01)} onClick=${go}>${busy ? 'Провожу…' : payAmt > 0 ? (fiscal ? 'Принять оплату и пробить чек' : 'Принять оплату и закрыть чеком') : fiscal ? 'Пробить чек' : 'Сохранить'}${!busy && payAmt > 0 ? ' · ' + zl(payAmt) : ''}</button>`}>
    ${due > 0.01 ? html`<div class="grid g2">
        <label class="f">Способ оплаты<select value=${f.method} onChange=${(e) => set({ ...f, method: e.target.value })}>${['card', 'cash', 'blik', 'transfer', 'mixed'].map((k) => html`<option value=${k}>${METHOD[k]}</option>`)}</select></label>
        ${!mixed && html`<label class="f">Сумма, zł<input type="number" step="0.01" value=${f.amount} onInput=${(e) => set({ ...f, amount: e.target.value })} /></label>`}</div>
      ${mixed && html`<div class="pay-split">${['cash', 'card', 'blik', 'transfer'].map((k) => html`<label class="f">${METHOD[k]}<input type="number" step="0.01" min="0" placeholder="0,00" value=${f.split[k]} onInput=${(e) => set({ ...f, split: { ...f.split, [k]: e.target.value } })} /></label>`)}
        <div class=${'small ' + (Math.abs(splitSum - due) < 0.01 ? 'pos' : 'muted')}>Итого ${zl(splitSum)} из ${zl(due)}</div></div>`}`
      : html`<div class="muted small">${fiscal ? 'Заказ уже оплачен — остаётся пробить чек.' : 'Заказ уже оплачен — остаётся вписать номер чека.'}</div>`}
    ${fiscal ? html`<label class="check" style="margin-top:10px"><input type="checkbox" checked=${f.withNip} onChange=${(e) => set({ ...f, withNip: e.target.checked })} />NIP покупателя на чеке</label>
        ${f.withNip && html`<label class="f">NIP<input value=${f.nip} maxlength="13" onInput=${(e) => set({ ...f, nip: e.target.value.replace(/\D/g, '') })} /></label>`}`
      : html`<label class="f" style="margin-top:10px">Номер чека с кассового аппарата (необязательно)<input value=${f.no} placeholder="np. 000123" onInput=${(e) => set({ ...f, no: e.target.value })} /></label>
        <div class="muted small">Фискальная касса не подключена к CRM — пробейте чек на кассе как обычно и впишите его номер. Документ появится в «Продажах» как чек.</div>`}
  </${Modal}>`;
}
