import { html, useData, go, Badge, zl, fdate, carName } from '../lib.js';

export default function Search({ q }) {
  const e = encodeURIComponent(q);
  const { data: c } = useData('customers?q=' + e);
  const { data: k } = useData('cars?q=' + e);
  const { data: o } = useData('orders?status=&q=' + e);
  return html`<div class="page-head"><h1>Поиск: «${q}»</h1></div>
    <div class="grid g2">
      <div class="card tight"><div style="padding:12px 14px"><h2 style="margin:0">Клиенты ${c ? `(${c.total})` : ''}</h2></div>
        <table class="tbl"><tbody>${(c?.rows || []).slice(0, 15).map((x) => html`<tr class="click" onClick=${() => go('/customers/' + x.id)}><td><b>${x.name || '—'}</b><div class="sub">${x.cars || ''}</div></td><td class="nowrap">${x.phone || ''}</td></tr>`)}</tbody></table>
        ${c && !c.rows.length ? html`<div class="empty">Нет</div>` : ''}</div>
      <div class="card tight"><div style="padding:12px 14px"><h2 style="margin:0">Автомобили ${k ? `(${k.total})` : ''}</h2></div>
        <table class="tbl"><tbody>${(k?.rows || []).slice(0, 15).map((x) => html`<tr class="click" onClick=${() => go('/cars/' + x.id)}><td><b>${carName(x)}</b> ${x.plate ? html`<span class="plate">${x.plate}</span>` : ''}<div class="sub">${x.vin || ''}</div></td><td>${x.owner_name || ''}</td></tr>`)}</tbody></table>
        ${k && !k.rows.length ? html`<div class="empty">Нет</div>` : ''}</div>
    </div>
    <div class="card tight" style="margin-top:14px"><div style="padding:12px 14px"><h2 style="margin:0">Заказы ${o ? `(${o.total})` : ''}</h2></div>
      <table class="tbl"><tbody>${(o?.rows || []).slice(0, 20).map((x) => html`<tr class="click" onClick=${() => go('/orders/' + x.id)}><td><b>${x.number}</b></td><td>${fdate(x.created_at)}</td>
        <td><${Badge} color=${x.status_color}>${x.status_name}</${Badge}></td><td>${x.customer_name || ''}</td><td>${carName(x)} ${x.plate || ''}</td><td class="r">${zl(x.total)}</td></tr>`)}</tbody></table>
      ${o && !o.rows.length ? html`<div class="empty">Нет</div>` : ''}</div>`;
}
