import { html, useData, Loading, ErrorBox, zl, num, fdate, carName, Badge, Icon, useApp } from '../lib.js';

export default function Dashboard() {
  const { data: d, loading, error } = useData('dashboard');
  const app = useApp();
  if (loading && !d) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} />`;
  const inWork = d.byStatus.reduce((s, x) => s + x.n, 0);
  return html`
    <div class="page-head"><h1>Добрый день, ${app.user.name.split(' ')[0]}</h1>
      <div class="actions"><a class="btn" href="#/calendar"><${Icon} n="cal" />Терминарз</a><a class="btn primary" href="#/orders/new"><${Icon} n="plus" />Новый заказ</a></div></div>

    <div class="grid g4" style="margin-bottom:14px">
      <div class="stat accent"><b>${zl(d.revenue.today)}</b><span>Поступило сегодня</span></div>
      <div class="stat"><b>${zl(d.revenue.month)}</b><span>Поступило за месяц</span></div>
      <div class="stat"><b>${num(d.revenue.closedMonth.n)}</b><span>Закрыто заказов за месяц · ${zl(d.revenue.closedMonth.s)}</span></div>
      <div class="stat"><b>${num(inWork)}</b><span>Заказов в работе</span></div>
    </div>

    <div class="status-strip" style="margin-bottom:18px">
      ${d.byStatus.map((s) => html`<a href=${'#/orders?status=' + s.id}><${Badge} color=${s.color}>${s.name}</${Badge}><b>${s.n}</b></a>`)}
    </div>

    <div class="grid g2">
      <div class="card">
        <div class="row" style="margin-bottom:10px"><h2 style="margin:0">Сегодня в терминарзе</h2><a class="btn sm" style="margin-left:auto" href="#/calendar">Открыть</a></div>
        ${d.todayAppointments.length ? html`<table class="tbl"><tbody>${d.todayAppointments.map((a) => html`
          <tr class="click" onClick=${() => (location.hash = a.order_id ? '#/orders/' + a.order_id : '#/calendar')}>
            <td class="nowrap num"><b>${a.start_at.slice(11)}</b></td>
            <td>${a.customer_name || a.contact_name || a.title}<div class="sub">${carName(a)} ${a.plate ? html`<span class="plate">${a.plate}</span>` : ''}</div></td>
            <td class="sub">${a.station_name}</td><td class="sub">${a.order_number || ''}</td></tr>`)}</tbody></table>`
          : html`<div class="empty">На сегодня записей нет</div>`}
      </div>

      <div class="card">
        <div class="row" style="margin-bottom:10px"><h2 style="margin:0">Новые заявки</h2>${d.requests.length ? html`<span class="badge" style="background:var(--warn);color:#000">${d.requests.length}</span>` : ''}
          <a class="btn sm" style="margin-left:auto" href="#/calendar">Распределить</a></div>
        ${d.requests.length ? html`<table class="tbl"><tbody>${d.requests.map((a) => html`
          <tr class="click" onClick=${() => (location.hash = '#/calendar')}>
            <td>${a.customer_name || a.contact_name}<div class="sub">${a.contact_phone || ''}</div></td>
            <td>${a.title}<div class="sub">${a.note || ''}${a.preferred ? ' · желаемо: ' + a.preferred : ''}</div></td>
            <td class="sub nowrap">${a.source === 'app' ? 'Приложение' : a.source}<br />${fdate(a.created_at)}</td></tr>`)}</tbody></table>`
          : html`<div class="empty">Заявок нет — сюда попадают записи из приложения</div>`}
      </div>

      <div class="card">
        <h2>Завершены, но не оплачены</h2>
        ${d.unpaid.length ? html`<table class="tbl"><tbody>${d.unpaid.map((o) => html`
          <tr class="click" onClick=${() => (location.hash = '#/orders/' + o.id)}><td><b>${o.number}</b><div class="sub">${o.customer_name || ''}</div></td>
          <td class="r num">${zl(o.total)}<div class="sub">долг ${zl(o.total - o.paid)}</div></td></tr>`)}</tbody></table>`
          : html`<div class="empty">Всё оплачено</div>`}
      </div>

      <div class="card">
        <h2>Требует внимания</h2>
        ${!d.lowStock.length && !d.storageDue.length ? html`<div class="empty">Всё в порядке</div>` : ''}
        ${d.lowStock.length ? html`<h3>Заканчивается на складе</h3><table class="tbl"><tbody>${d.lowStock.map((p) => html`
          <tr class="click" onClick=${() => (location.hash = '#/stock/product/' + p.id)}><td>${p.name}<div class="sub">${p.code || ''}</div></td><td class="r num neg">${num(p.stock, 2)} / мин. ${num(p.min_stock, 2)}</td></tr>`)}</tbody></table>` : ''}
        ${d.storageDue.length ? html`<h3 style="margin-top:12px">Хранение шин заканчивается</h3><table class="tbl"><tbody>${d.storageDue.map((s) => html`
          <tr class="click" onClick=${() => (location.hash = '#/storage')}><td>${s.number}<div class="sub">${s.customer_name || ''}</div></td><td class="r">${fdate(s.date_until)}</td></tr>`)}</tbody></table>` : ''}
      </div>
    </div>`;
}
