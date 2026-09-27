import { html, useState, useData, qs, ErrorBox, Loading, zl, num, fdate, todayStr, METHOD } from '../lib.js';

function Bars({ rows, label, value, fmt = zl }) {
  const max = Math.max(1, ...rows.map(value));
  return html`<div>${rows.map((r) => html`<div class="bar-row" title=${`${label(r)}: ${fmt(value(r))}`}>
    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label(r)}</span>
    <div class="bar"><i style=${`width:${(value(r) / max) * 100}%`}></i></div><span class="r num">${fmt(value(r))}</span></div>`)}</div>`;
}

export default function Reports() {
  const t = todayStr();
  const [from, setFrom] = useState(t.slice(0, 8) + '01');
  const [to, setTo] = useState(t);
  const { data: d, loading, error } = useData('reports?' + qs({ from, to }));
  const preset = (m) => {
    const now = new Date();
    const a = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const b = m === 0 ? now : new Date(now.getFullYear(), now.getMonth() - m + 1, 0);
    const f = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    setFrom(f(a)); setTo(f(b));
  };
  return html`
    <div class="page-head"><h1>Отчёты</h1></div>
    <div class="card" style="margin-bottom:14px"><div class="row end">
      <label class="f" style="width:160px">С<input type="date" value=${from} onInput=${(e) => setFrom(e.target.value)} /></label>
      <label class="f" style="width:160px">По<input type="date" value=${to} onInput=${(e) => setTo(e.target.value)} /></label>
      <button class="btn sm" onClick=${() => preset(0)}>Этот месяц</button><button class="btn sm" onClick=${() => preset(1)}>Прошлый месяц</button>
      <button class="btn sm" onClick=${() => { setFrom(t.slice(0, 4) + '-01-01'); setTo(t); }}>С начала года</button>
      <span class="muted small">По дате завершения заказа</span></div></div>
    ${error ? html`<${ErrorBox} error=${error} />` : !d ? html`<${Loading} />` : html`
    <div class="grid g4" style="margin-bottom:14px">
      <div class="stat accent"><b>${zl(d.summary.revenue)}</b><span>Выручка брутто · ${num(d.summary.orders)} заказов</span></div>
      <div class="stat"><b>${zl(d.summary.labor)}</b><span>Работы (брутто)</span></div>
      <div class="stat"><b>${zl(d.summary.parts)}</b><span>Запчасти (брутто) · маржа ${zl(d.summary.partsMargin)} нетто</span></div>
      <div class="stat"><b>${zl(d.summary.avgOrder)}</b><span>Средний чек · новых клиентов ${d.newCustomers}</span></div>
    </div>
    <div class="card" style="margin-bottom:14px"><h2>Выручка по дням</h2>
      ${d.byDay.length ? html`<div class="spark" role="img" aria-label="Выручка по дням">${(() => { const m = Math.max(1, ...d.byDay.map((x) => x.revenue)); return d.byDay.map((x) => html`<div style=${`height:${(x.revenue / m) * 100}%`} title=${`${fdate(x.day)}: ${zl(x.revenue)} · ${x.n} заказов`}></div>`); })()}</div>
        <div class="row small muted" style="justify-content:space-between"><span>${fdate(d.byDay[0].day)}</span><span>макс. ${zl(Math.max(...d.byDay.map((x) => x.revenue)))} в день</span><span>${fdate(d.byDay[d.byDay.length - 1].day)}</span></div>`
        : html`<div class="empty">Нет завершённых заказов за период</div>`}</div>
    <div class="grid g2">
      <div class="card"><h2>Механики: работы и зарплата</h2>
        ${d.mechanics.length ? html`<table class="tbl"><thead><tr><th>Механик</th><th class="r">Заказов</th><th class="r">Н/ч</th><th class="r">Работы нетто</th><th class="r">%</th><th class="r">К выплате</th></tr></thead>
          <tbody>${d.mechanics.map((m) => html`<tr><td>${m.name}</td><td class="r">${m.orders}</td><td class="r">${num(m.hours, 1)}</td><td class="r">${zl(m.labor_net)}</td><td class="r">${m.commission_pct}%</td><td class="r"><b>${zl(m.commission)}</b></td></tr>`)}</tbody></table>
          <div class="muted small" style="margin-top:8px">Процент берётся из настроек сотрудника (у вас 40% от работ). Механик — тот, кто указан в строке работы, иначе ответственный по заказу.</div>`
          : html`<div class="muted">Нет работ с назначенным механиком</div>`}</div>
      <div class="card"><h2>Откуда приходят клиенты</h2>
        ${d.bySource.length ? html`<${Bars} rows=${d.bySource} label=${(r) => `${r.source} (${r.n})`} value=${(r) => r.revenue} />` : html`<div class="muted">Нет данных</div>`}</div>
      <div class="card"><h2>Топ работ</h2>
        ${d.topServices.length ? html`<${Bars} rows=${d.topServices} label=${(r) => `${r.name} ×${r.n}`} value=${(r) => r.revenue} />` : html`<div class="muted">Нет данных</div>`}</div>
      <div class="card"><h2>Деньги</h2>
        <table class="tbl"><tbody>${d.payments.map((p) => html`<tr><td>${p.direction === 'in' ? 'Поступило' : 'Выдано'} — ${METHOD[p.method]}</td><td class="r">${zl(p.s)}</td></tr>`)}
          <tr><td>Закупки/расходы (брутто)</td><td class="r neg">${zl(d.purchases.gross)}</td></tr>
          <tr><td>Клиентов в приложении (всего)</td><td class="r">${num(d.appUsers)}</td></tr></tbody></table></div>
    </div>`}`;
}
