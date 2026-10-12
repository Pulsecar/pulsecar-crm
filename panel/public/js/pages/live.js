// «Kamery na żywo» — модуль Pulsecar Live (live.pulsecar.tech) внутри CRM:
// страница с панелью модуля (ссылки, камеры, настройки) и кнопка «Udostępnij podgląd na żywo» в заказе / выцене.
// Вход в модуль — одноразовой ссылкой с бэкенда CRM (ключ API в браузер не попадает).
import { html, useState, useEffect, useRef, api, act, useApp, Icon, Modal, toast, carName, fdt } from '../lib.js';

let loading = null;
function lib(origin) {
  const ready = () => { window.PulsecarLive.configure({ embedUrlEndpoint: '/crm-api/live-cameras/embed-url', moduleOrigin: origin }); return window.PulsecarLive; };
  if (window.PulsecarLive) return Promise.resolve(ready());
  if (!loading) loading = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = '/js/pulsecar-live-embed.js';
    s.onload = () => ok(); s.onerror = () => { loading = null; fail(new Error('Не удалось загрузить модуль камер')); };
    document.head.appendChild(s);
  });
  return loading.then(ready);
}

/** Страница меню: вся панель модуля во фрейме */
export default function LivePage() {
  const app = useApp();
  const box = useRef(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!app.features.live) return;
    lib(app.features.live.origin).then((L) => L.mountPanel(box.current, { height: 'calc(100vh - 150px)' })).catch((e) => setErr(e.message));
  }, []);
  if (!app.features.live) return html`<div class="empty">Модуль камер не подключён</div>`;
  return html`<div class="page-head"><h1>Камеры онлайн</h1><span class="muted">ссылки для клиентов, камеры постов, часы работы</span></div>
    ${err ? html`<div class="card neg">${err}</div>` : ''}
    <div class="card tight" ref=${box} style="overflow:hidden"></div>`;
}

const STATE = { live: ['идёт трансляция', 'pos'], closed: ['вне часов', 'muted'], not_started: ['ещё не началась', 'muted'], expired: ['истекла', 'muted'], revoked: ['отозвана', 'muted'], no_camera: ['камера не выбрана', 'neg'] };

/** Кнопка в заказе / выцене: новая ссылка с данными заказа + список активных ссылок этого заказа */
export function LiveButton({ o }) {
  const app = useApp();
  const [links, setLinks] = useState(null);
  const [made, setMade] = useState(null);
  const [open, setOpen] = useState(false);
  const load = () => api('live-cameras/order/' + o.id).then((r) => setLinks(Array.isArray(r) ? r : r.links || r.rows || [])).catch(() => setLinks([]));
  useEffect(() => { if (app.features.live) load(); }, [o.id]);
  if (!app.features.live) return '';
  const create = async () => {
    try {
      const L = await lib(app.features.live.origin);
      await L.openNewLink({
        plate: o.car?.plate || '', client: o.customer ? (o.customer.kind === 'company' && o.customer.company) || o.customer.name || '' : '',
        car: o.car ? carName(o.car) : '', orderNo: o.number, orderId: String(o.id), phone: o.customer?.phone || '',
      }, { onCreated: (link) => { setMade(link); navigator.clipboard?.writeText(link.url).catch(() => {}); toast('Ссылка для клиента создана и скопирована'); load(); } });
    } catch (e) { toast(e.message, 'error'); }
  };
  const active = (links || []).filter((l) => !l.revoked && l.state !== 'expired');
  return html`<span style="display:contents">
    <button class="btn" title="Ссылка для клиента: видео с камеры поста без звука, в выбранные дни и часы" onClick=${create}><${Icon} n="camera" />Поделиться трансляцией</button>
    ${active.length ? html`<button class="btn" onClick=${() => setOpen(true)}><${Icon} n="camera" />Ссылки · ${active.length}</button>` : ''}
    ${(made || open) && html`<${Modal} title="Трансляция для клиента" onClose=${() => { setMade(null); setOpen(false); }}>
      ${made && html`<div class="stack">
        <label class="f">Ссылка<div class="ig"><input readonly value=${made.url} /><button class="addon btn" onClick=${() => navigator.clipboard?.writeText(made.url).then(() => toast('Скопировано'))}>Копировать</button></div></label>
        ${made.smsText && html`<label class="f">Текст SMS<textarea rows="4" readonly>${made.smsText}</textarea></label>
          <div class="row">${app.features.sms && (o.customer?.phone) && html`<button class="btn primary" onClick=${async () => { await act(() => api(`orders/${o.id}/sms`, { body: { text: made.smsText, kind: 'live' } }), 'SMS отправлена'); }}>Отправить SMS клиенту</button>`}
            <button class="btn" onClick=${() => navigator.clipboard?.writeText(made.smsText).then(() => toast('Скопировано'))}>Копировать текст</button></div>`}
      </div>`}
      ${active.length ? html`<h3 style="margin:16px 0 6px">Активные ссылки заказа</h3><table class="tbl"><tbody>${active.map((l) => html`<tr>
        <td><b>${l.cameraName || '—'}</b><div class="sub">${fdt(l.validFrom)} — ${fdt(l.validTo)}${l.scheduleText ? ' · ' + l.scheduleText : ''}</div></td>
        <td class=${(STATE[l.state] || [])[1] || ''}>${(STATE[l.state] || [l.state])[0]}<div class="sub">просмотров: ${l.views || 0}</div></td>
        <td class="act"><button class="btn sm" onClick=${() => navigator.clipboard?.writeText(l.url).then(() => toast('Ссылка скопирована'))}>Копировать</button></td></tr>`)}</tbody></table>` : ''}
    </${Modal}>`}
  </span>`;
}
