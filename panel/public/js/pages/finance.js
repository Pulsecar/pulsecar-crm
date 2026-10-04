// Финансы: обзор с сравнением периодов, прибыль и убытки, конструктор отчётов, деньги и долги, расходы, механики
import { html, useState, useData, api, qs, useApp, Loading, ErrorBox, Modal, zl, num, fdate, todayStr, METHOD } from '../lib.js';
import { Columns, HBars, InOut, SERIES } from '../charts.js';

const d2s = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
export function range(p) {
  const n = new Date();
  const y = n.getFullYear(), m = n.getMonth();
  switch (p) {
    case 'today': return [d2s(n), d2s(n)];
    case 'yesterday': { const a = new Date(n); a.setDate(a.getDate() - 1); return [d2s(a), d2s(a)]; }
    case 'week': { const a = new Date(n); a.setDate(a.getDate() - ((a.getDay() + 6) % 7)); return [d2s(a), d2s(n)]; }
    case 'month': return [d2s(new Date(y, m, 1)), d2s(n)];
    case 'lastmonth': return [d2s(new Date(y, m - 1, 1)), d2s(new Date(y, m, 0))];
    case 'quarter': return [d2s(new Date(y, Math.floor(m / 3) * 3, 1)), d2s(n)];
    case '90': { const a = new Date(n); a.setDate(a.getDate() - 89); return [d2s(a), d2s(n)]; }
    case 'year': return [`${y}-01-01`, d2s(n)];
    case 'lastyear': return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    case '12m': return [d2s(new Date(y, m - 11, 1)), d2s(n)];
    case 'all': return ['2015-01-01', d2s(n)];
    default: return null;
  }
}
export const PRESETS = [['today', 'Сегодня'], ['yesterday', 'Вчера'], ['week', 'Неделя'], ['month', 'Этот месяц'], ['lastmonth', 'Прошлый месяц'], ['quarter', 'Квартал'], ['90', '90 дней'], ['year', 'Этот год'], ['lastyear', 'Прошлый год'], ['12m', '12 месяцев'], ['all', 'Всё время']];
const pctf = (v) => (v == null ? '—' : `${num(v, 1)}%`);

/** Плитка показателя с изменением к прошлому периоду (цвет = направление × хорошо ли рост) */
function Kpi({ label, value, prev, fmt = zl, goodUp = true, hint, hero }) {
  const has = prev != null && Number.isFinite(prev);
  const diff = has ? value - prev : 0;
  const rel = has && prev !== 0 ? (diff / Math.abs(prev)) * 100 : null;
  const good = diff === 0 ? null : (diff > 0) === goodUp;
  return html`<div class=${'stat kpi' + (hero ? ' accent' : '')} title=${hint || ''}>
    <b>${fmt(value)}</b><span>${label}</span>
    ${has ? html`<em class=${good === null ? 'muted' : good ? 'pos' : 'neg'}>${diff > 0 ? '▲' : diff < 0 ? '▼' : '='} ${rel == null ? fmt(Math.abs(diff)) : num(Math.abs(rel), 1) + '%'} <small class="muted">было ${fmt(prev)}</small></em>` : ''}
  </div>`;
}

export default function Finance() {
  const app = useApp();
  const [preset, setPreset] = useState('month');
  const [[from, to], setRange] = useState(range('month'));
  const [compare, setCompare] = useState('prev');
  const [basis, setBasis] = useState('closed');
  const [flt, setFlt] = useState({ source: '', mechanic: '', client_type: '', make: '' });
  const [tab, setTab] = useState('overview');
  const [drill, setDrill] = useState(null);
  const base = { from, to, basis, ...flt };
  const pick = (p) => { setPreset(p); setRange(range(p)); };
  const TABS = [['overview', 'Обзор'], ['pnl', 'Прибыль и убытки'], ['builder', 'Конструктор отчётов'], ['cash', 'Деньги и долги'], ['expenses', 'Расходы и закупки'], ['staff', 'Механики и зарплата']];
  return html`
    <div class="page-head"><h1>Финансы</h1><span class="muted">${fdate(from)} — ${fdate(to)}</span></div>
    <div class="card fin-filters">
      <div class="row wrap">${PRESETS.map(([k, l]) => html`<button class=${'btn sm ' + (preset === k ? 'primary' : 'ghost')} onClick=${() => pick(k)}>${l}</button>`)}</div>
      <div class="row wrap end" style="margin-top:8px">
        <label class="f" style="width:150px">С<input type="date" value=${from} onInput=${(e) => { setPreset(''); setRange([e.target.value, to]); }} /></label>
        <label class="f" style="width:150px">По<input type="date" value=${to} onInput=${(e) => { setPreset(''); setRange([from, e.target.value]); }} /></label>
        <label class="f" style="width:190px">Сравнить с<select value=${compare} onChange=${(e) => setCompare(e.target.value)}><option value="prev">Прошлым периодом</option><option value="year">Тем же периодом год назад</option><option value="none">Не сравнивать</option></select></label>
        <label class="f" style="width:170px">Считать по дате<select value=${basis} onChange=${(e) => setBasis(e.target.value)}><option value="closed">Завершения заказа</option><option value="created">Создания заказа</option></select></label>
        <label class="f" style="width:160px">Источник<select value=${flt.source} onChange=${(e) => setFlt({ ...flt, source: e.target.value })}><option value="">Все</option>${app.types.map((t) => html`<option value=${t.id}>${t.name}</option>`)}</select></label>
        <label class="f" style="width:170px">Механик<select value=${flt.mechanic} onChange=${(e) => setFlt({ ...flt, mechanic: e.target.value })}><option value="">Все</option>${app.staff.filter((s) => s.is_mechanic).map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>
        <label class="f" style="width:150px">Клиенты<select value=${flt.client_type} onChange=${(e) => setFlt({ ...flt, client_type: e.target.value })}><option value="">Все</option><option value="private">Частные</option><option value="company">Фирмы (NIP)</option></select></label>
        <label class="f" style="width:130px">Марка<input value=${flt.make} placeholder="любая" onChange=${(e) => setFlt({ ...flt, make: e.target.value.trim() })} /></label>
      </div></div>
    <div class="pill-tabs" style="margin:14px 0">${TABS.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}</div>
    ${tab === 'overview' && html`<${Overview} q=${{ ...base, compare }} setDrill=${setDrill} />`}
    ${tab === 'pnl' && html`<${Pnl} q=${base} />`}
    ${tab === 'builder' && html`<${Builder} q=${base} setDrill=${setDrill} />`}
    ${tab === 'cash' && html`<${Cash} q=${base} />`}
    ${tab === 'expenses' && html`<${Expenses} q=${{ ...base, compare }} />`}
    ${tab === 'staff' && html`<${Staff} q=${base} />`}
    ${drill && html`<${Drill} q=${{ ...base, ...drill.filter }} title=${drill.title} onClose=${() => setDrill(null)} />`}`;
}

function Overview({ q, setDrill }) {
  const { data: d, error } = useData('finance/overview?' + qs(q));
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!d) return html`<${Loading} />`;
  const k = d.kpi, p = d.prev || {};
  const pv = (x) => (d.prev ? p[x] : null);
  const prevByIndex = d.prevSeries ? d.series.map((_, i) => d.prevSeries[i]?.revenue ?? null) : null;
  const GL = { day: 'по дням', week: 'по неделям', month: 'по месяцам', quarter: 'по кварталам' };
  const vat = k.vatOut - d.expenses.vatIn;
  return html`<div class="stack">
    <div class="grid g4">
      <${Kpi} hero label=${`Выручка брутто · ${num(k.orders)} заказов`} value=${k.revenue} prev=${pv('revenue')} />
      <${Kpi} label=${`Валовая прибыль · маржа ${pctf(k.grossMarginPct)}`} value=${k.grossProfit} prev=${pv('grossProfit')} hint="Выручка нетто − себестоимость запчастей − зарплата механиков (% от работ)" />
      <${Kpi} label=${`Операционная прибыль · ${pctf(k.operatingMarginPct)}`} value=${k.operatingProfit} prev=${pv('operatingProfit')} hint="Валовая прибыль − расходы (аренда, свет, топливо… без закупки запчастей)" />
      <${Kpi} label="Средний чек" value=${k.avgCheck} prev=${pv('avgCheck')} />
    </div>
    <div class="grid g4">
      <${Kpi} label=${`Работы брутто · ${pctf(k.laborShare)} выручки`} value=${k.labor} prev=${pv('labor')} />
      <${Kpi} label=${`Запчасти брутто · наценка ${pctf(k.markupPct)}`} value=${k.parts} prev=${pv('parts')} />
      <${Kpi} label=${`Маржа на запчастях нетто · ${pctf(k.partsMarginPct)}`} value=${k.partsMargin} prev=${pv('partsMargin')} />
      <${Kpi} label="Зарплата механиков (% от работ)" value=${k.payroll} prev=${pv('payroll')} goodUp=${false} />
    </div>
    <div class="grid g4">
      <${Kpi} label=${`Клиентов · новых ${k.newClients}, повторных ${k.returning}`} value=${k.clients} prev=${pv('clients')} fmt=${(x) => num(x)} />
      <${Kpi} label="Скидки клиентам" value=${k.discounts} prev=${pv('discounts')} goodUp=${false} />
      <${Kpi} label="Не оплачено по заказам периода" value=${k.unpaid} prev=${pv('unpaid')} goodUp=${false} />
      <${Kpi} label=${vat >= 0 ? 'НДС к уплате (оценка)' : 'НДС к возврату (оценка)'} value=${Math.abs(vat)} hint="НДС с продаж минус НДС из фактур закупок и расходов за период. Точную декларацию готовит бухгалтер." />
    </div>
    <div class="card"><div class="row"><h2 style="margin:0">Выручка ${GL[d.seriesGroup] || ''}</h2><span class="muted small">наведите на столбец</span></div>
      <${Columns} rows=${d.series} value=${(r) => r.revenue} label=${(r, short) => (d.seriesGroup === 'day' ? (short ? r.key.slice(8) + '.' + r.key.slice(5, 7) : fdate(r.key)) : d.seriesGroup === 'week' ? (short ? r.key.slice(8) + '.' + r.key.slice(5, 7) : r.label) : r.label)}
        fmt=${zl} prev=${prevByIndex} prevLabel=${d.compare ? `${fdate(d.compare.from)}—${fdate(d.compare.to)}` : ''}
        tip=${(r) => html`<div class="muted">Прибыль ${zl(r.grossProfit)} · ${r.orders} зак.</div><div class="muted">Работы ${zl(r.labor)} · запчасти ${zl(r.parts)}</div>`} /></div>
    <div class="grid g2">
      <div class="card"><h2>Источники клиентов</h2><${HBars} rows=${d.bySource} value=${(r) => r.revenue} label=${(r) => r.label} sub=${(r) => ` ${r.orders} зак. · прибыль ${zl(r.grossProfit)}`} fmt=${zl}
        onPick=${(r) => setDrill({ title: 'Источник: ' + r.label, filter: { source: r.key === '0' ? '' : r.key } })} /></div>
      <div class="card"><h2>Категории работ</h2><${HBars} rows=${d.byCategory} value=${(r) => r.revenue} label=${(r) => r.label} sub=${(r) => ` маржа ${pctf(r.marginPct)}`} fmt=${zl} color=${SERIES[2]} /></div>
      <div class="card"><h2>Марки автомобилей</h2><${HBars} rows=${d.byMake} value=${(r) => r.revenue} label=${(r) => r.label} sub=${(r) => ` ${r.orders} зак.`} fmt=${zl} color=${SERIES[5]}
        onPick=${(r) => r.key !== '—' && setDrill({ title: 'Марка: ' + r.label, filter: { make: r.key } })} /></div>
      <div class="card"><h2>Дни недели</h2><${HBars} rows=${d.byWeekday} value=${(r) => r.revenue} label=${(r) => r.label} sub=${(r) => ` ${r.orders} зак.`} fmt=${zl} color=${SERIES[3]} /></div>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Лучшие клиенты</h2>${d.topClients.length ? html`<table class="tbl"><thead><tr><th>Клиент</th><th class="r">Заказов</th><th class="r">Выручка</th><th class="r">Прибыль</th></tr></thead>
        <tbody>${d.topClients.map((r) => html`<tr class="click" onClick=${() => r.key !== '0' && setDrill({ title: r.label, filter: { customer: r.key } })}><td>${r.label}</td><td class="r">${r.orders}</td><td class="r">${zl(r.revenue)}</td><td class="r">${zl(r.grossProfit)}</td></tr>`)}</tbody></table>` : html`<div class="muted">Нет данных</div>`}</div>
      <div class="card"><h2>Самые выгодные запчасти</h2>${d.topParts.length ? html`<table class="tbl"><thead><tr><th>Деталь</th><th class="r">Шт.</th><th class="r">Продажи</th><th class="r">Маржа</th></tr></thead>
        <tbody>${d.topParts.map((r) => html`<tr><td>${r.label}</td><td class="r">${num(r.qty, 1)}</td><td class="r">${zl(r.parts)}</td><td class="r">${zl(r.partsMargin)}</td></tr>`)}</tbody></table>` : html`<div class="muted">Нет данных</div>`}</div>
    </div>
    <div class="grid g4">
      <div class="stat"><b>${pctf(d.extras.quotes.rate)}</b><span>Выцены → заказы: ${d.extras.quotes.converted} из ${d.extras.quotes.n} (${zl(d.extras.quotes.convertedSum)})</span></div>
      <div class="stat"><b>${zl(d.extras.stock.cost)}</b><span>Склад по закупке сейчас · в продаже ${zl(d.extras.stock.retail)}</span></div>
      <div class="stat"><b>${zl(d.cash.receivables.total)}</b><span>Клиенты должны (все завершённые заказы)</span></div>
      <div class="stat"><b>${num(d.extras.points.earned)} / ${num(d.extras.points.redeemed)}</b><span>Pulse Points начислено / списано</span></div>
    </div>
  </div>`;
}

function Pnl({ q }) {
  const { data, error } = useData('finance/pnl?' + qs(q));
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data) return html`<${Loading} />`;
  const tot = (k) => data.reduce((s, r) => s + (r[k] || 0), 0);
  const cols = [['orders', 'Заказов', (x) => num(x)], ['revenue', 'Выручка брутто'], ['revenueNet', 'Выручка нетто'], ['labor', 'Работы'], ['parts', 'Запчасти'], ['cogs', '− Себест. запчастей'], ['payroll', '− Зарплата механиков'], ['grossProfit', '= Валовая прибыль'], ['opex', '− Расходы'], ['operatingProfit', '= Операционная прибыль']];
  const revNet = tot('revenueNet');
  return html`<div class="card tight"><div class="tbl-wrap"><table class="tbl pnl"><thead><tr><th>Месяц</th>${cols.map(([, l]) => html`<th class="r">${l}</th>`)}<th class="r">Рентаб.</th></tr></thead>
    <tbody>${data.map((r) => html`<tr><td class="nowrap"><b>${r.month}</b></td>${cols.map(([k, , f]) => html`<td class=${'r nowrap' + (k.endsWith('Profit') ? (r[k] < 0 ? ' neg' : ' strong') : '')}>${(f || zl)(r[k])}</td>`)}<td class="r">${pctf(r.marginPct)}</td></tr>`)}</tbody>
    <tfoot><tr><td><b>Итого</b></td>${cols.map(([k, , f]) => html`<td class=${'r nowrap strong' + (k.endsWith('Profit') && tot(k) < 0 ? ' neg' : '')}>${(f || zl)(tot(k))}</td>`)}<td class="r">${pctf(revNet ? (tot('operatingProfit') / revNet) * 100 : null)}</td></tr></tfoot></table></div>
    <div class="muted small" style="padding:10px 14px">Суммы нетто, кроме «Выручка брутто». Себестоимость — закупочная цена запчастей в заказах. Зарплата — % от работ по настройкам сотрудников. Расходы — закупки и счета за период, кроме закупки запчастей (она уже в себестоимости).</div></div>`;
}

function Builder({ q, setDrill }) {
  const app = useApp();
  const [group, setGroup] = useState('month');
  const [group2, setGroup2] = useState('');
  const [metric, setMetric] = useState('revenue');
  const { data, error } = useData('finance/pivot?' + qs({ ...q, group, group2 }));
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data) return html`<${Loading} />`;
  const COLS = ['orders', 'revenue', 'revenueNet', 'labor', 'parts', 'cogs', 'partsMargin', 'payroll', 'grossProfit', 'discounts', 'avgCheck', 'qty'];
  const money = (k) => !['orders', 'clients', 'qty'].includes(k);
  const fmt = (k, v) => (money(k) ? zl(v) : num(v, k === 'qty' ? 1 : 0));
  const DRILL = { source: 'source', mechanic: 'mechanic', make: 'make', customer: 'customer', status: 'status', client_type: 'client_type' };
  const rows = [...data.rows].sort((a, b) => (group2 || !['day', 'week', 'month', 'quarter', 'year', 'weekday'].includes(group) ? b[metric] - a[metric] : 0));
  const csv = '/crm-api/finance/pivot?' + qs({ ...q, group, group2, format: 'csv' });
  return html`<div class="stack">
    <div class="card row wrap end">
      <label class="f" style="width:210px">Разрез<select value=${group} onChange=${(e) => setGroup(e.target.value)}>${Object.entries(data.groups).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
      <label class="f" style="width:210px">И ещё по<select value=${group2} onChange=${(e) => setGroup2(e.target.value)}><option value="">—</option>${Object.entries(data.groups).filter(([k]) => k !== group).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
      <label class="f" style="width:230px">Показатель на графике<select value=${metric} onChange=${(e) => setMetric(e.target.value)}>${COLS.map((k) => html`<option value=${k}>${data.metrics[k]}</option>`)}</select></label>
      <a class="btn" href=${csv} download>Скачать в Excel (CSV)</a>
      <span class="muted small">Примеры: «Механик» + «Месяц» — выработка каждого по месяцам; «Источник» — что приносит больше прибыли; «Позиция» — топ деталей и работ.</span>
    </div>
    ${!group2 && html`<div class="card"><h2>${data.metrics[metric]} — ${data.groups[group].toLowerCase()}</h2>
      ${['day', 'week', 'month', 'quarter', 'year', 'weekday'].includes(group)
        ? html`<${Columns} rows=${data.rows} value=${(r) => r[metric]} label=${(r) => r.label} fmt=${(v) => fmt(metric, v)} />`
        : html`<${HBars} rows=${rows.slice(0, 25)} value=${(r) => r[metric]} label=${(r) => r.label} fmt=${(v) => fmt(metric, v)} onPick=${DRILL[group] ? (r) => setDrill({ title: r.label, filter: { [DRILL[group]]: r.key } }) : null} />`}</div>`}
    <div class="card tight"><div class="tbl-wrap" style="max-height:70vh;overflow:auto"><table class="tbl"><thead><tr><th>${data.groups[group]}</th>${group2 ? html`<th>${data.groups[group2]}</th>` : ''}
      ${COLS.map((k) => html`<th class=${'r click' + (k === metric ? ' on' : '')} onClick=${() => setMetric(k)}>${data.metrics[k]}</th>`)}<th class="r">Маржа</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr class=${DRILL[group] ? 'click' : ''} onClick=${() => DRILL[group] && setDrill({ title: r.label, filter: { [DRILL[group]]: r.key } })}><td>${r.label}</td>${group2 ? html`<td>${r.label2}</td>` : ''}
        ${COLS.map((k) => html`<td class=${'r nowrap' + (k === metric ? ' strong' : '')}>${fmt(k, r[k])}</td>`)}<td class="r">${pctf(r.marginPct)}</td></tr>`)}</tbody>
      <tfoot><tr><td><b>Итого</b></td>${group2 ? html`<td></td>` : ''}${COLS.map((k) => html`<td class="r nowrap strong">${fmt(k, data.total[k])}</td>`)}<td class="r">${pctf(data.total.marginPct)}</td></tr></tfoot></table></div>
      ${data.more ? html`<div class="muted small" style="padding:8px 14px">И ещё ${data.more} строк — скачайте CSV.</div>` : ''}</div>
  </div>`;
}

function Cash({ q }) {
  const { data: d, error } = useData('finance/cash?' + qs(q));
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!d) return html`<${Loading} />`;
  const a = d.receivables.aging;
  return html`<div class="stack">
    <div class="grid g4">
      <div class="stat accent"><b>${zl(d.inflow)}</b><span>Поступило за период (без баллов)</span></div>
      <div class="stat"><b>${zl(d.outflow)}</b><span>Выдано из кассы за период</span></div>
      <div class="stat"><b>${zl(d.cashBalance)}</b><span>Наличные в кассе сейчас</span></div>
      <div class="stat"><b>${zl(d.pointsRedeemed)}</b><span>Оплачено баллами Pulse Points</span></div>
    </div>
    <div class="card"><h2>Движение денег по дням</h2><${InOut} rows=${d.byDay} fmt=${zl} /></div>
    <div class="grid g2">
      <div class="card"><h2>По способу оплаты</h2><table class="tbl"><tbody>${d.byMethod.map((m) => html`<tr><td>${m.direction === 'in' ? 'Поступило' : 'Выдано'} — ${METHOD[m.method] || m.method}</td><td class="r">${m.n}</td><td class="r nowrap"><b>${zl(m.s)}</b></td></tr>`)}</tbody></table></div>
      <div class="card"><h2>Кто сколько должен сервису · ${zl(d.receivables.total)}</h2>
        <div class="grid g4" style="margin-bottom:8px">${[['до 7 дн.', a.d0_7], ['8–30', a.d8_30], ['31–90', a.d31_90], ['> 90 дн.', a.d90]].map(([l, v]) => html`<div class="stat small-stat"><b class=${v && l.startsWith('>') ? 'neg' : ''}>${zl(v)}</b><span>${l}</span></div>`)}</div>
        ${d.receivables.list.length ? html`<table class="tbl"><tbody>${d.receivables.list.slice(0, 30).map((x) => html`<tr class="click" onClick=${() => (location.hash = '#/orders/' + x.id)}><td><b>${x.number}</b><div class="sub">${x.cname || ''} ${x.phone || ''}</div></td>
          <td class="sub nowrap">${x.days} дн.</td><td class="r nowrap neg">${zl(x.due)}</td></tr>`)}</tbody></table>` : html`<div class="muted">Долгов нет 👍</div>`}</div>
    </div>
    <div class="card"><h2>Мы должны поставщикам · ${zl(d.payables.total)}</h2>${d.payables.list.length ? html`<table class="tbl"><thead><tr><th>Поставщик</th><th>Документ</th><th>Дата</th><th>Срок</th><th class="r">Долг</th></tr></thead>
      <tbody>${d.payables.list.map((x) => html`<tr><td>${x.supplier}</td><td>${x.number || ''}</td><td>${fdate(x.doc_date)}</td><td class=${x.due_date && x.due_date < todayStr() ? 'neg' : ''}>${fdate(x.due_date) || '—'}</td><td class="r nowrap">${zl(x.due)}</td></tr>`)}</tbody></table>` : html`<div class="muted">Неоплаченных счетов нет</div>`}</div>
  </div>`;
}

function Expenses({ q }) {
  const { data, error } = useData('finance/overview?' + qs(q));
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data) return html`<${Loading} />`;
  const e = data.expenses;
  return html`<div class="stack">
    <div class="grid g4">
      <div class="stat"><b>${zl(e.opex)}</b><span>Расходы (аренда, свет, топливо…) нетто</span></div>
      <div class="stat"><b>${zl(e.inventory)}</b><span>Закупка запчастей по счетам нетто</span></div>
      <div class="stat"><b>${zl(e.vatIn)}</b><span>НДС в счетах (к вычету)</span></div>
      <div class="stat"><b>${zl(e.supplierDebt)}</b><span>Не оплачено поставщикам за период</span></div>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Статьи расходов</h2><${HBars} rows=${e.byCategory} value=${(r) => r.net} label=${(r) => r.category + (r.inventory ? ' (товар)' : '')} sub=${(r) => ` ${r.n} док.`} fmt=${zl} color=${SERIES[1]} /></div>
      <div class="card"><h2>Приходы от поставщиков (PZ)</h2><${HBars} rows=${e.bySupplier} value=${(r) => r.net} label=${(r) => r.supplier} sub=${(r) => ` ${r.n} док.`} fmt=${zl} color=${SERIES[0]} /></div>
    </div>
    <div class="muted small">Статьи — Настройки → Справочники. Статьи со словами «części», «materiały», «towar» считаются закупкой товара и не уменьшают прибыль второй раз (себестоимость запчастей уже учтена в заказах).</div>
  </div>`;
}

function Staff({ q }) {
  const { data, error } = useData('finance/pivot?' + qs({ ...q, group: 'mechanic' }));
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data) return html`<${Loading} />`;
  const rows = data.rows.filter((r) => r.key !== 'parts');
  return html`<div class="card tight"><table class="tbl"><thead><tr><th>Механик</th><th class="r">Заказов</th><th class="r">Работ, шт/н·ч</th><th class="r">Работы брутто</th><th class="r">Работы нетто</th><th class="r">К выплате</th><th class="r">Остаётся сервису</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr><td><b>${r.label}</b></td><td class="r">${r.orders}</td><td class="r">${num(r.qty, 1)}</td><td class="r">${zl(r.labor)}</td><td class="r">${zl(r.revenueNet)}</td><td class="r strong">${zl(r.payroll)}</td><td class="r">${zl(r.revenueNet - r.payroll)}</td></tr>`)}</tbody>
    <tfoot><tr><td><b>Итого</b></td><td></td><td class="r">${num(rows.reduce((s, r) => s + r.qty, 0), 1)}</td><td class="r">${zl(rows.reduce((s, r) => s + r.labor, 0))}</td><td class="r">${zl(rows.reduce((s, r) => s + r.revenueNet, 0))}</td><td class="r strong">${zl(rows.reduce((s, r) => s + r.payroll, 0))}</td><td></td></tr></tfoot></table>
    <div class="muted small" style="padding:10px 14px">Зарплата = % от работ нетто (Настройки → Сотрудники). Механик — тот, кто указан в строке работы, иначе ответственный по заказу. Разбивку по месяцам даст «Конструктор отчётов»: разрез «Механик» + «Месяц».</div></div>`;
}

function Drill({ q, title, onClose }) {
  const { data } = useData('finance/orders?' + qs(q));
  return html`<${Modal} wide title=${'Заказы: ' + title} onClose=${onClose}>
    ${!data ? html`<${Loading} />` : data.length ? html`<table class="tbl"><thead><tr><th>Дата</th><th>Заказ</th><th>Клиент</th><th>Авто</th><th class="r">Сумма</th><th class="r">Оплачено</th></tr></thead>
      <tbody>${data.map((o) => html`<tr class="click" onClick=${() => { location.hash = '#/orders/' + o.id; onClose(); }}><td class="nowrap">${fdate(o.d)}</td><td><b>${o.number}</b></td><td>${o.cname || '—'}</td><td>${[o.make, o.model, o.plate].filter(Boolean).join(' ')}</td>
        <td class="r nowrap">${zl(o.total)}</td><td class=${'r nowrap ' + (o.paid < o.total - 0.01 ? 'neg' : '')}>${zl(o.paid)}</td></tr>`)}</tbody></table>
      <div class="muted small" style="margin-top:6px">${data.length} заказов на ${zl(data.reduce((s, o) => s + o.total, 0))}</div>` : html`<div class="empty">Нет заказов</div>`}
  </${Modal}>`;
}
