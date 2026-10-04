// Массовые действия в списках: галочки в строках + панель внизу «Выбрано N: удалить / статус / экспорт …»
import { html, useState, api, act, Modal, Icon, toast } from './lib.js';

/** Выбор строк (сохраняется при переходе по страницам) */
export function useSel() {
  const [ids, setIds] = useState(() => new Map()); // id → строка (для экспорта)
  return {
    ids, size: ids.size,
    has: (id) => ids.has(id),
    toggle: (row) => setIds((m) => { const n = new Map(m); n.has(row.id) ? n.delete(row.id) : n.set(row.id, row); return n; }),
    page: (rows, on) => setIds((m) => { const n = new Map(m); rows.forEach((r) => (on ? n.set(r.id, r) : n.delete(r.id))); return n; }),
    clear: () => setIds(new Map()),
  };
}
export const SelHead = ({ sel, rows }) => {
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id));
  return html`<th class="sel-col" data-c="sel" onClick=${(e) => e.stopPropagation()}><input type="checkbox" aria-label="Выбрать все на странице" checked=${all} onChange=${(e) => sel.page(rows, e.target.checked)} /></th>`;
};
export const SelCell = ({ sel, row }) => html`<td class="sel-col" onClick=${(e) => e.stopPropagation()}><input type="checkbox" aria-label="Выбрать" checked=${sel.has(row.id)} onChange=${() => sel.toggle(row)} /></td>`;

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function downloadCsv(name, cols, rows) {
  const text = '﻿' + [cols.map(([, l]) => l).join(';'), ...rows.map((r) => cols.map(([k]) => csvCell(typeof k === 'function' ? k(r) : r[k])).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/**
 * Панель массовых действий.
 * actions: [{ key, label, icon, danger, confirm: 'текст', input: { label, type: 'select'|'number'|'text', options: [[v,l]] } }]
 * entity — для POST /crm-api/bulk/<entity>; csv — [[ключ|функция, заголовок]] для «Экспорт в Excel (CSV)»
 */
export function BulkBar({ sel, entity, actions = [], csv, csvName, onDone, extra = [] }) {
  const [ask, setAsk] = useState(null);
  const [val, setVal] = useState('');
  const [report, setReport] = useState(null);
  if (!sel.size) return null;
  const run = async (a, value) => {
    const r = await act(() => api('bulk/' + entity, { body: { ids: [...sel.ids.keys()], action: a.key, value } }));
    setAsk(null); setVal('');
    if (r.skipped?.length) setReport({ a, ...r }); else toast(`${a.label}: готово (${r.done})`);
    sel.clear(); onDone?.();
  };
  const start = (a) => { if (a.input || a.confirm) { setVal(a.input?.options?.[0]?.[0] ?? ''); setAsk(a); } else run(a); };
  return html`<div class="bulk-bar">
    <b>Выбрано: ${sel.size}</b>
    <button class="btn ghost sm" onClick=${sel.clear}>Снять выбор</button>
    <span class="grow"></span>
    ${actions.map((a) => html`<button class=${'btn sm' + (a.danger ? ' danger' : '')} onClick=${() => start(a)}>${a.icon ? html`<${Icon} n=${a.icon} />` : ''}${a.label}</button>`)}
    ${extra.map((x) => html`<button class="btn sm" onClick=${() => x.onClick([...sel.ids.keys()], [...sel.ids.values()])}>${x.icon ? html`<${Icon} n=${x.icon} />` : ''}${x.label}</button>`)}
    ${csv && html`<button class="btn sm" onClick=${() => downloadCsv(csvName || entity, csv, [...sel.ids.values()])}><${Icon} n="download" />Экспорт в Excel (CSV)</button>`}
    ${ask && html`<${Modal} title=${`${ask.label} · выбрано ${sel.size}`} onClose=${() => setAsk(null)} foot=${html`
        <button class="btn" onClick=${() => setAsk(null)}>Отмена</button>
        <button class=${'btn ' + (ask.danger ? 'danger' : 'primary')} style="margin-left:auto" onClick=${() => run(ask, ask.input?.type === 'number' ? Number(val) : val)}>${ask.label}</button>`}>
      ${ask.confirm ? html`<p style="margin-top:0">${ask.confirm}</p>` : ''}
      ${ask.input && html`<label class="f">${ask.input.label}${ask.input.type === 'select'
        ? html`<select value=${val} onChange=${(e) => setVal(e.target.value)}>${ask.input.options.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>`
        : html`<input type=${ask.input.type} value=${val} step="any" onInput=${(e) => setVal(e.target.value)} placeholder=${ask.input.placeholder || ''} />`}</label>`}
      ${ask.input?.hint ? html`<div class="muted small">${ask.input.hint}</div>` : ''}
    </${Modal}>`}
    ${report && html`<${Modal} title=${report.a.label} onClose=${() => setReport(null)} foot=${html`<button class="btn primary" style="margin-left:auto" onClick=${() => setReport(null)}>Понятно</button>`}>
      <p style="margin-top:0">Готово: <b>${report.done}</b>. Пропущено: <b>${report.skipped.length}</b></p>
      <table class="tbl"><tbody>${report.skipped.map((x) => html`<tr><td><b>${x.label}</b></td><td class="sub">${x.reason}</td></tr>`)}</tbody></table>
    </${Modal}>`}
  </div>`;
}
