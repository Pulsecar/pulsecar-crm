// Журнал изменений: кто, когда, что создал / изменил / удалил и «было → стало»
import { html, useState, useEffect, useData, qs, useDebounced, ErrorBox, Loading, Pager, fdt, todayStr, addDays } from '../lib.js';

const ACT = { create: ['создал', 'var(--accent)'], update: ['изменил', 'var(--info)'], delete: ['удалил', 'var(--danger)'] };
const SRC = { app: 'приложение', card: 'карта заказа', extension: 'расширение Chrome', system: 'автоматически' };
const LINK = { orders: '#/orders/', customers: '#/customers/', cars: '#/cars/', storage: '#/storage', products: '#/stock', staff: '#/settings/staff', settings: '#/settings/params',
  integrations: '#/settings/integrations', cash_registers: '#/cash', purchases: '#/purchases', sales_docs: null, service_catalog: '#/settings/catalog', order_statuses: '#/settings/statuses', stations: '#/settings/stations' };
const href = (t, id) => (LINK[t] === undefined || LINK[t] === null ? null : LINK[t].endsWith('/') ? LINK[t] + id : LINK[t]);

/** Список записей журнала (используется и на отдельной странице, и во вкладках «История») */
export function AuditRows({ rows, compact }) {
  if (!rows.length) return html`<div class="empty">Изменений не найдено</div>`;
  return html`<div class="audit">${rows.map((r) => {
    const link = href(r.entity, r.entity_id);
    return html`<div class="audit-row">
      <div class="audit-meta"><b class="nowrap">${fdt(r.at)}</b><span>${r.staff}</span>${SRC[r.source] ? html`<span class="faint small">${SRC[r.source]}</span>` : ''}</div>
      <div class="audit-body">
        <div><span class="badge" style=${`border-color:${ACT[r.action][1]};color:${ACT[r.action][1]}`}>${ACT[r.action][0]}</span>
          <span class="muted">${r.entity_label}</span> ${link ? html`<a href=${link}><b>${r.title || '#' + r.entity_id}</b></a>` : html`<b>${r.title || '#' + r.entity_id}</b>`}
          ${!compact && r.parent ? html` <span class="muted">в</span> <a href=${href(r.parent.type, r.parent.id) || '#'}>${r.parent.title}</a>` : ''}</div>
        ${r.changes.length ? html`<table class="audit-ch"><tbody>${r.changes.map((c) => html`<tr><td class="muted">${c.field}</td>
          <td>${r.action === 'update' ? html`<span class="was">${c.from}</span> <span class="faint">→</span> <b>${c.to}</b>` : r.action === 'create' ? html`<b>${c.to}</b>` : html`<span class="was">${c.from}</span>`}</td></tr>`)}</tbody></table>` : ''}
      </div></div>`;
  })}</div>`;
}

/** История одного объекта (заказ, клиент, авто) — вкладка «История» */
export function ObjectHistory({ entity, id }) {
  const [page, setPage] = useState(0);
  const { data, error } = useData(`audit?${qs({ entity, id, page })}`, [entity, id, page]);
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data) return html`<${Loading} />`;
  return html`<${AuditRows} rows=${data.rows} compact />${data.total > data.pageSize ? html`<${Pager} page=${page} total=${data.total} size=${data.pageSize} onPage=${setPage} />` : ''}`;
}

export default function AuditPage({ query = {} }) {
  const t = todayStr();
  const [f, setF] = useState({ from: query.from || addDays(t, -6), to: query.to || t, staff: query.staff || '', entity: query.entity || '', id: query.id || '', action: '', q: '' });
  const [page, setPage] = useState(0);
  const dq = useDebounced(f.q);
  const params = { ...f, q: dq, page };
  useEffect(() => setPage(0), [f.from, f.to, f.staff, f.entity, f.action, dq]);
  const { data, error, loading } = useData('audit?' + qs(params), [JSON.stringify(params)]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value, ...(k === 'entity' ? { id: '' } : {}) });
  return html`<div class="page-head"><h1>Журнал изменений</h1><span class="muted">${data ? data.total : ''}</span></div>
    <div class="card" style="margin-bottom:12px"><div class="row end wrap">
      <label class="f" style="width:150px">С<input type="date" value=${f.from} onInput=${set('from')} /></label>
      <label class="f" style="width:150px">По<input type="date" value=${f.to} onInput=${set('to')} /></label>
      <label class="f" style="width:190px">Кто<select value=${f.staff} onChange=${set('staff')}><option value="">Все</option>
        ${(data?.staff || []).map((s) => html`<option value=${s.id}>${s.name}</option>`)}<option value="client">Клиенты (приложение, карта)</option><option value="system">Автоматически (система)</option></select></label>
      <label class="f" style="width:200px">Что<select value=${f.entity} onChange=${set('entity')}><option value="">Всё</option>
        ${(data?.entities || []).map((e) => html`<option value=${e.key}>${e.label}</option>`)}</select></label>
      <label class="f" style="width:150px">Действие<select value=${f.action} onChange=${set('action')}><option value="">Все</option><option value="create">Создание</option><option value="update">Изменение</option><option value="delete">Удаление</option></select></label>
      <label class="f grow" style="min-width:200px">Поиск<input type="search" value=${f.q} placeholder="Номер, имя, телефон, VIN…" onInput=${set('q')} /></label>
    </div>${f.id ? html`<div class="small" style="margin-top:8px">Показана история одного объекта #${f.id} · <a href="#" onClick=${(e) => { e.preventDefault(); setF({ ...f, id: '' }); }}>показать всё</a></div>` : ''}</div>
    ${error ? html`<${ErrorBox} error=${error} />` : !data && loading ? html`<${Loading} />` : html`<div class="card">
      <${AuditRows} rows=${data.rows} />
      ${data.total > data.pageSize ? html`<${Pager} page=${page} total=${data.total} size=${data.pageSize} onPage=${setPage} />` : ''}</div>`}`;
}
