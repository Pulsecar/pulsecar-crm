// Документы заказа: печать (протоколы, спецификация, карта механика, kosztorys), фактуры VAT / Pro forma / корректы,
// приём авто (схема повреждений, фото и файлы, подписи клиента)
import { html, useState, useRef, api, act, useApp, Icon, Modal, ConfirmButton, zl, num, fdt, toast } from '../lib.js';

const PRINTS = [['intake', 'Протокол приёма', 'Protokół przyjęcia'], ['estimate', 'Kosztorys / смета', 'Kosztorys'], ['spec', 'Спецификация заказа', 'Specyfikacja'],
  ['mechanic', 'Карта для механика', 'Karta dla mechanika'], ['release', 'Протокол выдачи', 'Protokół wydania']];

export function DocsMenu({ o }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const list = o.kind === 'quote' ? [['estimate', 'Wycena (смета)']] : PRINTS.filter(([k]) => app.perms['orders.prices'] || k === 'mechanic' || k === 'intake');
  return html`<div class="menu-wrap" onMouseLeave=${() => setOpen(false)}>
    <button class="btn" onClick=${() => setOpen(!open)} aria-expanded=${open}><${Icon} n="print" />Документы ▾</button>
    ${open && html`<div class="menu">${list.map(([k, l]) => html`<a href=${`/crm-api/print/${k}/${o.id}`} target="_blank" rel="noopener" onClick=${() => setOpen(false)}>${l}</a>`)}
      ${o.sales_docs?.map((d) => html`<a href=${'/crm-api/print/sale/' + d.id} target="_blank" rel="noopener">${d.number}</a>`)}</div>`}
  </div>`;
}

const KIND = { vat: 'Фактура VAT', proforma: 'Pro forma', correction: 'Корректа' };
const PAYM = [['cash', 'Наличные'], ['card', 'Карта'], ['transfer', 'Перевод']];

export function SalesDocs({ o, reload }) {
  const app = useApp();
  const [form, setForm] = useState(null);
  const [corr, setCorr] = useState(null);
  const hasVat = o.sales_docs?.some((d) => d.kind === 'vat');
  const open = (kind) => setForm({
    kind, payment_method: o.payments?.find((p) => p.method !== 'points')?.method || app.settings.payment_method_default || 'cash', due_days: app.settings.payment_term_days || 0,
    issue_date: new Date().toISOString().slice(0, 10), buyer: { name: o.customer?.company || o.customer?.name || '', nip: o.customer?.nip || '', street: o.customer?.street || '', postcode: o.customer?.postcode || '', city: o.customer?.city || '' }, notes: '',
  });
  const issue = async () => {
    const r = await act(() => api(`orders/${o.id}/sales-docs`, { body: form }));
    toast(`${KIND[r.kind]} ${r.number} выставлена`);
    if (r.warning) toast(r.warning, 'error');
    setForm(null); reload();
    window.open('/crm-api/print/sale/' + r.id, '_blank', 'noopener');
  };
  const correct = async () => {
    const r = await act(() => api(`sales-docs/${corr.id}/correct`, { body: { reason: corr.reason, lines: corr.lines.map((l) => ({ qty: Number(l.qty), unit_gross: Number(l.unit_gross) })) } }));
    toast(`Корректа ${r.number} выставлена`); if (r.warning) toast(r.warning, 'error');
    setCorr(null); reload();
  };
  const startCorr = async (d) => {
    const doc = await fetch('/crm-api/print/sale/' + d.id); // проверка доступа
    if (!doc.ok) return toast('Нет доступа', 'error');
    const r = await api('sales-docs?q=' + encodeURIComponent(d.number));
    const full = r.rows.find((x) => x.id === d.id);
    setCorr({ id: d.id, number: d.number, reason: '', lines: (o.items || []).map((i) => ({ name: i.name, qty: i.qty, unit_gross: Math.round(i.price * (1 - (i.discount || 0) / 100) * 100) / 100 })), total: full?.total_gross });
  };
  const newTotal = corr ? corr.lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unit_gross || 0), 0) : 0;
  return html`<div class="card">
    <h2>Документы продажи</h2>
    ${o.sales_docs?.length ? html`<table class="tbl" style="margin-bottom:10px"><tbody>${o.sales_docs.map((d) => html`<tr>
      <td><b>${d.number}</b><div class="sub">${KIND[d.kind]} · ${d.issue_date}${d.kind === 'vat' ? (d.ksef ? ' · KSeF ✓' : ' · не в KSeF') : ''}</div></td><td class="r nowrap">${zl(d.total_gross)}</td>
      <td class="act nowrap"><a class="btn sm" href=${'/crm-api/print/sale/' + d.id} target="_blank" rel="noopener">Открыть</a>
        ${d.ext_url && html`<a class="btn sm" href=${d.ext_url} target="_blank" rel="noopener">Fakturownia</a>`}
        ${d.kind === 'vat' && html`<button class="btn sm" onClick=${() => startCorr(d)}>Корректа</button>`}
        ${d.kind === 'proforma' && html`<${ConfirmButton} cls="icon-btn" onConfirm=${async () => { await act(() => api('sales-docs/' + d.id, { method: 'DELETE' }), 'Удалено'); reload(); }}><${Icon} n="trash" /></${ConfirmButton}>`}</td></tr>`)}</tbody></table>`
      : html`<div class="muted small" style="margin-bottom:10px">Фактур пока нет. ${app.features.invoices ? 'Фактура VAT уйдёт в Fakturownia и KSeF.' : html`Фактура VAT будет выставлена в CRM без KSeF — <a href="#/settings/integrations">подключить Fakturownia</a>.`}</div>`}
    <div class="row">${!hasVat && html`<button class="btn primary" disabled=${!o.items.length} onClick=${() => open('vat')}>Фактура VAT</button>`}
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
      <div class="muted small" style="margin-top:8px">Позиции берутся из заказа: ${o.items.length} шт. Номер — по настройке нумерации (${form.kind === 'vat' ? 'FV' : 'PRO'}).</div>
    </${Modal}>`}

    ${corr && html`<${Modal} wide title=${'Корректа к ' + corr.number} onClose=${() => setCorr(null)} foot=${html`<span class="muted small" style="margin-right:auto">Было ${zl(corr.total)} → станет ${zl(newTotal)}</span><button class="btn" onClick=${() => setCorr(null)}>Отмена</button><button class="btn primary" onClick=${correct} disabled=${!corr.reason.trim()}>Выставить корректу</button>`}>
      <table class="tbl"><thead><tr><th>Позиция</th><th class="r">Кол-во</th><th class="r">Цена брутто за ед.</th></tr></thead><tbody>
        ${corr.lines.map((l, i) => html`<tr><td>${l.name}</td>
          <td class="r"><input class="inline-input num qty" type="number" step="0.01" value=${l.qty} onInput=${(e) => { const L = [...corr.lines]; L[i] = { ...l, qty: e.target.value }; setCorr({ ...corr, lines: L }); }} /></td>
          <td class="r"><input class="inline-input num price" type="number" step="0.01" value=${l.unit_gross} onInput=${(e) => { const L = [...corr.lines]; L[i] = { ...l, unit_gross: e.target.value }; setCorr({ ...corr, lines: L }); }} /></td></tr>`)}</tbody></table>
      <div class="row" style="margin-top:10px"><button class="btn sm" onClick=${() => setCorr({ ...corr, lines: corr.lines.map((l) => ({ ...l, qty: 0 })) })}>Корректа до нуля</button></div>
      <label class="f" style="margin-top:10px">Причина корректы (обязательно)<input value=${corr.reason} onInput=${(e) => setCorr({ ...corr, reason: e.target.value })} placeholder="np. Rabat udzielony po wystawieniu faktury / zwrot towaru" /></label>
    </${Modal}>`}
  </div>`;
}

// ── Приём авто: схема повреждений, фото, подписи ──────────────────────────
const DMG = [['rysa', 'Царапина'], ['wgniecenie', 'Вмятина'], ['odprysk', 'Скол'], ['pekniecie', 'Трещина'], ['korozja', 'Коррозия'], ['brak', 'Нет детали'], ['inne', 'Другое']];
const DOCNAME = { intake: 'Протокол приёма', estimate: 'Kosztorys', quote: 'Смета', release: 'Протокол выдачи' };
const SIGN = { button: 'кнопка «Akceptuję»', sms: 'код SMS', drawn: 'подпись от руки', paper: 'на бумаге' };

function CarDiagram({ marks, onAdd, onPick, sel }) {
  const ref = useRef(null);
  const click = (e) => {
    const r = ref.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 100), y = Math.round(((e.clientY - r.top) / r.height) * 100);
    if (y < 4 || y > 96) return;
    onAdd({ x, y });
  };
  return html`<svg ref=${ref} viewBox="0 0 200 400" class="car-diagram" onClick=${click} role="img" aria-label="Схема авто: нажмите, чтобы отметить повреждение">
    <text x="100" y="12" text-anchor="middle" font-size="10" fill="currentColor" opacity=".6">ПЕРЕД</text><text x="100" y="396" text-anchor="middle" font-size="10" fill="currentColor" opacity=".6">ЗАД</text>
    <path d="M60 40 Q100 18 140 40 L152 90 L156 170 L156 300 L150 350 Q100 378 50 350 L44 300 L44 170 L48 90 Z" fill="var(--surface2)" stroke="currentColor" stroke-width="2"/>
    <path d="M62 96 Q100 80 138 96 L132 132 Q100 124 68 132 Z" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".7"/>
    <path d="M68 262 Q100 270 132 262 L138 300 Q100 312 62 300 Z" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".7"/>
    <rect x="68" y="138" width="64" height="118" rx="10" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".6"/>
    <rect x="30" y="70" width="14" height="44" rx="4" fill="currentColor"/><rect x="156" y="70" width="14" height="44" rx="4" fill="currentColor"/>
    <rect x="30" y="286" width="14" height="44" rx="4" fill="currentColor"/><rect x="156" y="286" width="14" height="44" rx="4" fill="currentColor"/>
    ${marks.map((m, i) => html`<g onClick=${(e) => { e.stopPropagation(); onPick(i); }} style="cursor:pointer"><circle cx=${m.x * 2} cy=${m.y * 4} r=${sel === i ? 12 : 10} fill="#e34948" stroke="#fff" stroke-width="2" />
      <text x=${m.x * 2} y=${m.y * 4 + 4} text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${i + 1}</text></g>`)}
  </svg>`;
}

export function Intake({ o, reload }) {
  const app = useApp();
  const [marks, setMarks] = useState(o.damages || []);
  const [sel, setSel] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const canEdit = !!app.perms['orders.edit'];
  const upd = (m) => { setMarks(m); setDirty(true); };
  const save = async () => { await act(() => api('orders/' + o.id, { method: 'PUT', body: { damages: marks } }), 'Повреждения сохранены'); setDirty(false); reload(); };
  const upload = async (files) => {
    if (!files?.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    setBusy(true);
    try { await act(() => api(`orders/${o.id}/files`, { form: fd }), 'Файлы загружены'); reload(); } finally { setBusy(false); }
  };
  return html`<div class="grid g2">
    <div class="card">
      <div class="row" style="margin-bottom:8px"><h2 style="margin:0">Повреждения при приёме</h2>
        ${dirty && html`<button class="btn primary sm" style="margin-left:auto" onClick=${save}>Сохранить</button>`}</div>
      <div class="muted small" style="margin-bottom:10px">${canEdit ? 'Нажмите на схему, чтобы отметить место. Отметки видны клиенту в электронной карте и в протоколе приёма.' : ''}</div>
      <div class="dmg-edit">
        <${CarDiagram} marks=${marks} sel=${sel} onPick=${setSel} onAdd=${(p) => { if (!canEdit) return; upd([...marks, { ...p, type: 'rysa', note: '' }]); setSel(marks.length); }} />
        <div class="stack" style="gap:8px">${marks.length ? marks.map((m, i) => html`<div class=${'dmg-row' + (sel === i ? ' on' : '')} onClick=${() => setSel(i)}>
            <b>${i + 1}</b><select value=${m.type} disabled=${!canEdit} onChange=${(e) => { const M = [...marks]; M[i] = { ...m, type: e.target.value }; upd(M); }}>${DMG.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
            <input value=${m.note} disabled=${!canEdit} placeholder="Где и какое, например: левая передняя дверь" onInput=${(e) => { const M = [...marks]; M[i] = { ...m, note: e.target.value }; upd(M); }} />
            ${canEdit && html`<button class="icon-btn" title="Удалить" onClick=${(e) => { e.stopPropagation(); upd(marks.filter((_, j) => j !== i)); setSel(null); }}><${Icon} n="trash" /></button>`}</div>`)
          : html`<div class="empty">Повреждений не отмечено</div>`}</div>
      </div>
    </div>
    <div class="stack">
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
          : html`<div class="muted small">Клиент ещё ничего не подписал. Отправьте ссылку на электронную карту (SMS / e-mail) — он подпишет протокол и смету с телефона.</div>`}
        ${canEdit && html`<div class="row" style="margin-top:10px">${['intake', o.kind === 'quote' ? 'quote' : 'estimate', 'release'].filter((d) => o.kind !== 'quote' || d === 'quote').map((d) => html`<button class="btn sm" onClick=${async () => { await act(() => api(`orders/${o.id}/signatures`, { body: { doc: d } }), 'Отмечено'); reload(); }}>${DOCNAME[d]}: подписан на бумаге</button>`)}</div>`}
      </div>
    </div>
  </div>`;
}
