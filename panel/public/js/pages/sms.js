// Журнал SMS (как «Wiadomości SMS» в Motowarsztat) и отправка SMS любому клиенту
import { html, useState, useEffect, useData, api, act, qs, useApp, Loading, ErrorBox, Modal, Icon, Pager, Picker, useDebounced, fdt } from '../lib.js';
import { SmsCounter } from './orders.js';

const KIND = { manual: 'вручную', status: 'статус', reminder: 'напоминание', code: 'код', paylink: 'оплата', review: 'отзыв', booking: 'запись' };
const ST = { sent: ['Отправлено', 'pos'], failed: ['Ошибка', 'neg'], logged: ['Не отправлено (нет шлюза)', 'faint'] };

export default function Sms() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [send, setSend] = useState(null);
  const dq = useDebounced(q);
  useEffect(() => setPage(0), [dq, status]);
  const { data, loading, error, reload } = useData('sms?' + qs({ q: dq, status, page }));
  return html`
    <div class="page-head"><h1>SMS</h1><span class="muted">${data ? `${data.month} отправлено в этом месяце` : ''}</span>
      <div class="actions"><button class="btn primary" onClick=${() => setSend({ customer: null, phone: '', text: '' })}><${Icon} n="plus" />Отправить SMS</button></div></div>
    ${data && !data.provider && html`<div class="card small" style="margin-bottom:12px">SMS-шлюз не подключён — сообщения сохраняются только здесь. ${app.user.role === 'admin' ? html`<a href="#/settings/integrations">Подключить телефон с SIM или SMS-сервис</a>` : 'Попросите администратора подключить шлюз.'}</div>`}
    <div class="card row" style="margin-bottom:12px"><input class="grow" type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Телефон, клиент, текст…" aria-label="Поиск SMS" />
      <select style="width:220px" value=${status} onChange=${(e) => setStatus(e.target.value)}><option value="">Все</option>${Object.entries(ST).map(([k, [l]]) => html`<option value=${k}>${l}</option>`)}</select></div>
    ${error ? html`<${ErrorBox} error=${error} />` : !data && loading ? html`<${Loading} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Дата</th><th>Клиент</th><th>Телефон</th><th>Текст</th><th>Тип</th><th>Статус</th></tr></thead>
      <tbody>${data.rows.map((r) => html`<tr>
        <td class="nowrap sub">${fdt(r.created_at)}</td>
        <td>${r.customer_id ? html`<a href=${'#/customers/' + r.customer_id}>${r.customer_name || '—'}</a>` : '—'}${r.order_number ? html`<div class="sub"><a href=${'#/orders/' + r.order_id}>${r.order_number}</a></div>` : ''}</td>
        <td class="nowrap">${r.phone}</td><td style="white-space:pre-wrap;max-width:460px" class="small">${r.text}</td>
        <td class="sub">${KIND[r.kind] || r.kind}${r.staff ? html`<div>${r.staff}</div>` : ''}</td>
        <td class=${'small ' + (ST[r.status]?.[1] || '')}>${ST[r.status]?.[0] || r.status}${r.error && r.status === 'failed' ? html`<div class="sub">${r.error}</div>` : ''}</td></tr>`)}</tbody></table></div>
      ${!data.rows.length ? html`<div class="empty">SMS ещё не отправлялись</div>` : ''}
      <${Pager} page=${page} total=${data.total} size=${data.pageSize} onPage=${setPage} /></div>`}
    ${send && html`<${Modal} title="Отправить SMS" onClose=${() => setSend(null)} foot=${html`<button class="btn primary" disabled=${!send.text.trim() || !(send.customer || send.phone)}
        onClick=${async () => { await act(() => api('sms', { body: { customer_id: send.customer?.id, phone: send.customer ? null : send.phone, text: send.text } }), 'SMS отправлено'); setSend(null); reload(); }}>Отправить</button>`}>
      ${send.customer ? html`<div class="row"><b>${send.customer.name || '—'}</b> <span class="muted">${send.customer.phone}</span><button class="btn ghost sm" onClick=${() => setSend({ ...send, customer: null })}>Сменить</button></div>`
        : html`<${Picker} placeholder="Клиент: имя, телефон, номер авто…" path=${(x) => 'customers?q=' + encodeURIComponent(x)} render=${(c) => html`<b>${c.name || '—'}</b> <span class="sub">${c.phone || ''}</span>`}
            onPick=${(c) => setSend({ ...send, customer: c })} />
          <label class="f">или номер телефона<input value=${send.phone} placeholder="+48" onInput=${(e) => setSend({ ...send, phone: e.target.value })} /></label>`}
      <label class="f">Текст<textarea rows="5" value=${send.text} onInput=${(e) => setSend({ ...send, text: e.target.value })}></textarea></label><${SmsCounter} text=${send.text} />
    </${Modal}>`}`;
}
