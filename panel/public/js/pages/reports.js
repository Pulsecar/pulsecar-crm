// Рапорты (как Raporty в Motowarsztat): слева группы и рапорты, справа параметры → таблица → CSV / Excel / печать
import { html, useState, useEffect, useData, api, qs, useApp, ErrorBox, Loading, Icon, Picker, zl, num, fdate, todayStr, addDays, carName } from '../lib.js';
import { getLang } from '../i18n.js';

const GROUP_ORDER = ['Сотрудники', 'Заказы', 'Продажи', 'Клиенты', 'Касса', 'Автомобили', 'Затраты', 'Склад', 'Хранение'];
const PERIODS = [
  ['Этот месяц', () => { const t = todayStr(); return [t.slice(0, 8) + '01', t]; }],
  ['Прошлый месяц', () => { const t = todayStr(); const e = addDays(t.slice(0, 8) + '01', -1); return [e.slice(0, 8) + '01', e]; }],
  ['7 дней', () => { const t = todayStr(); return [addDays(t, -6), t]; }],
  ['Этот год', () => { const t = todayStr(); return [t.slice(0, 4) + '-01-01', t]; }],
];
const DOCTYPES = { PZ: 'PZ — приход', WZ: 'WZ — расход', RW: 'RW — списание', PW: 'PW — внутренний приход', MM: 'MM — перемещение', INW: 'Инвентаризация' };

function cell(v, t) {
  if (v === null || v === undefined || v === '') return '';
  if (t === 'money') return zl(v);
  if (t === 'num') return num(v, 2);
  if (t === 'pct') return `${num(v, 1)}%`;
  if (t === 'date') return fdate(String(v));
  return String(v);
}

export default function Reports({ query }) {
  const app = useApp();
  const { data: list, error: le } = useData('reports/list', []);
  const [id, setId] = useState(query?.r || 'staff_pay');
  const t = todayStr();
  const [p, setP] = useState({ from: t.slice(0, 8) + '01', to: t, basis: 'closed', prices: 'net', status: '', type: '', staff: '', car: '', customer: '', pct: '', pay_base: '', register: '', doctype: '' });
  const [labels, setLabels] = useState({ car: '', customer: '' });
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [regs, setRegs] = useState([]);
  const cur = list?.reports.find((r) => r.id === id);
  const has = (k) => cur?.params.includes(k);
  const params = () => {
    const o = {};
    for (const k of cur?.params || []) {
      if (k === 'period') { o.from = p.from; o.to = p.to; } else if (p[k] !== '') o[k] = p[k];
    }
    return qs(o);
  };
  const runIt = async () => {
    if (!cur) return;
    setBusy(true); setErr('');
    try { setRep(await api(`reports/run/${id}?${params()}`)); } catch (e) { setErr(e.message); setRep(null); }
    setBusy(false);
  };
  useEffect(() => { if (has('register') && !regs.length) api('cash/registers').then((r) => setRegs(Array.isArray(r) ? r : []), () => {}); }, [id, list]);
  useEffect(() => { setRep(null); setErr(''); if (cur && !(has('car') && id === 'car_history') && !(id === 'client_orders')) runIt(); }, [id, list]);
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value });
  const url = (f) => `/crm-api/reports/run/${id}?${params()}&format=${f}&lang=${getLang()}`;

  if (le) return html`<${ErrorBox} error=${le} />`;
  if (!list) return html`<${Loading} />`;
  const groups = GROUP_ORDER.filter((g) => list.reports.some((r) => r.group === g)).concat([...new Set(list.reports.map((r) => r.group))].filter((g) => !GROUP_ORDER.includes(g)));

  return html`
    <div class="page-head"><h1>Рапорты</h1>
      <div class="actions">
        <a class=${'btn' + (rep ? '' : ' disabled')} href=${url('csv')}><${Icon} n="download" />CSV</a>
        <a class=${'btn' + (rep ? '' : ' disabled')} href=${url('xlsx')}><${Icon} n="download" />Excel</a>
        <a class=${'btn' + (rep ? '' : ' disabled')} href=${url('print')} target="_blank" rel="noopener"><${Icon} n="file" />Печать</a>
      </div></div>
    <div class="rpt">
      <aside class="card tight rpt-nav">
        ${groups.map((g) => html`<div class="rpt-g">${g}</div>
          ${list.reports.filter((r) => r.group === g).map((r) => html`<a href=${'#/reports?r=' + r.id} class=${'rpt-i' + (r.id === id ? ' on' : '')} onClick=${(e) => { e.preventDefault(); setId(r.id); history.replaceState(null, '', '#/reports?r=' + r.id); }}>${r.title}</a>`)}`)}
      </aside>
      <section>
        <div class="card" style="margin-bottom:12px">
          <h2 style="margin:0 0 4px">${cur?.title}</h2>
          ${cur?.about && html`<p class="sub" style="margin:0 0 10px">${cur.about}</p>`}
          <div class="row end wrap">
            ${has('period') && html`
              <label class="f" style="width:150px">С<input type="date" value=${p.from} onInput=${set('from')} /></label>
              <label class="f" style="width:150px">По<input type="date" value=${p.to} onInput=${set('to')} /></label>
              <div class="seg">${PERIODS.map(([l, fn]) => html`<button class="btn sm" onClick=${() => { const [from, to] = fn(); setP({ ...p, from, to }); }}>${l}</button>`)}</div>`}
          </div>
          <div class="row end wrap" style="margin-top:8px">
            ${has('basis') && html`<label class="f" style="width:210px">Брать заказы по дате<select value=${p.basis} onChange=${set('basis')}><option value="closed">завершения заказа</option><option value="created">создания заказа</option></select></label>`}
            ${has('status') && html`<label class="f" style="width:170px">Статус<select value=${p.status} onChange=${set('status')}><option value="">Все</option>${app.statuses.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>`}
            ${has('type') && html`<label class="f" style="width:170px">Вид заказа<select value=${p.type} onChange=${set('type')}><option value="">Все</option>${app.types.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>`}
            ${has('staff') && html`<label class="f" style="width:180px">Сотрудник<select value=${p.staff} onChange=${set('staff')}><option value="">Все</option>${app.staff.map((s) => html`<option value=${s.id}>${s.name}${s.active ? '' : ' (неактивен)'}</option>`)}</select></label>`}
            ${has('prices') && html`<label class="f" style="width:130px">Суммы<select value=${p.prices} onChange=${set('prices')}><option value="net">НЕТТО</option><option value="gross">БРУТТО</option></select></label>`}
            ${has('register') && html`<label class="f" style="width:180px">Касса<select value=${p.register} onChange=${set('register')}><option value="">Все кассы</option>${(Array.isArray(regs) ? regs : []).map((r) => html`<option value=${r.id}>${r.name}</option>`)}</select></label>`}
            ${has('doctype') && html`<label class="f" style="width:190px">Документ<select value=${p.doctype} onChange=${set('doctype')}><option value="">Все</option>${Object.entries(DOCTYPES).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>`}
          </div>
          ${(has('customer') || has('car')) && html`<div class="row end wrap" style="margin-top:8px">
            ${has('customer') && html`<div class="f" style="width:260px">Клиент${p.customer ? html`<div class="row"><b class="grow">${labels.customer}</b><button class="btn sm" onClick=${() => setP({ ...p, customer: '' })}>×</button></div>`
              : html`<${Picker} placeholder="Все клиенты — найти…" path=${(q) => 'customers?q=' + encodeURIComponent(q)} render=${(c) => html`<b>${c.name || '—'}</b> <span class="sub">${c.phone || ''}</span>`}
                  onPick=${(c) => { setP({ ...p, customer: String(c.id) }); setLabels({ ...labels, customer: c.name || c.phone }); }} />`}</div>`}
            ${has('car') && html`<div class="f" style="width:260px">Автомобиль${p.car ? html`<div class="row"><b class="grow">${labels.car}</b><button class="btn sm" onClick=${() => setP({ ...p, car: '' })}>×</button></div>`
              : html`<${Picker} placeholder="Все авто — номер, VIN…" path=${(q) => 'cars?q=' + encodeURIComponent(q)} render=${(k) => html`<b>${k.plate || '—'}</b> <span class="sub">${carName(k)}</span>`}
                  onPick=${(k) => { setP({ ...p, car: String(k.id) }); setLabels({ ...labels, car: `${k.plate || ''} ${carName(k)}` }); }} />`}</div>`}
          </div>`}
          ${has('pct') && html`<div class="row end wrap" style="margin-top:8px">
            <label class="f" style="width:200px">% от работ для всех<input type="number" min="0" max="100" step="0.5" placeholder="из карточки сотрудника" value=${p.pct} onInput=${set('pct')} /></label>
            <label class="f" style="width:200px">% считать от<select value=${p.pay_base} onChange=${set('pay_base')}><option value="">как в карточке</option><option value="net">нетто</option><option value="gross">брутто</option></select></label>
            <span class="sub" style="max-width:420px">Пусто — условия берутся из карточки сотрудника (Настройки → Сотрудники): % от работ, ставка за нормо-час, % маржи запчастей.</span>
          </div>`}
          <div class="row" style="margin-top:12px"><button class="btn primary" onClick=${runIt} disabled=${busy}>${busy ? 'Считаю…' : 'Сформировать'}</button></div>
        </div>
        ${err && html`<${ErrorBox} error=${err} />`}
        ${rep && html`<div class="card tight">
          ${rep.note && html`<div class="sub" style="padding:10px 12px 0">${rep.note}</div>`}
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr>${rep.columns.map(([, l, t]) => html`<th class=${t === 'text' || t === 'date' ? '' : 'r'}>${l}</th>`)}</tr></thead>
            <tbody>${rep.rows.map((r) => html`<tr>${rep.columns.map(([k, , t], i) => html`<td class=${t === 'text' || t === 'date' ? (t === 'date' ? 'nowrap' : '') : 'r nowrap'}>
              ${i === 0 && r._order ? html`<a href=${'#/orders/' + r._order}>${cell(r[k], t)}</a>` : cell(r[k], t)}</td>`)}</tr>`)}</tbody>
            ${Object.keys(rep.totals || {}).length ? html`<tfoot><tr>${rep.columns.map(([k, , t], i) => html`<td class=${t === 'text' || t === 'date' ? '' : 'r nowrap'}><b>${i === 0 ? 'Итого' : cell(rep.totals[k], t)}</b></td>`)}</tr></tfoot>` : ''}
          </table></div>
          ${!rep.rows.length && html`<div class="empty">Нет данных за выбранные параметры</div>`}
        </div>`}
      </section>
    </div>`;
}
