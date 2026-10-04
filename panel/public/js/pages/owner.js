// Общий дашборд владельца: все сервисы (филиалы) на одном экране + управление сервисами
import { html, useState, useData, api, act, useApp, Loading, ErrorBox, Icon, Modal, zl, num, fdate } from '../lib.js';
import { MultiLine, HBars, SERIES } from '../charts.js';
import { range, PRESETS } from './finance.js';

/** Переключиться в сервис и открыть его главную (или нужную страницу) */
export async function switchBranch(code, to = '/') {
  await act(() => api('branches/switch', { body: { code } }));
  location.hash = '#' + to;
  location.reload();
}

const sum = (rows, f) => rows.reduce((s, r) => s + (Number(f(r)) || 0), 0);

export default function Owner({ manage: manage0 }) {
  const app = useApp();
  const [preset, setPreset] = useState('month');
  const [[from, to], setRange] = useState(range('month'));
  const [manage, setManage] = useState(!!manage0);
  const [editB, setEditB] = useState(null);
  const { data, error, loading, reload } = useData(`owner/dashboard?from=${from}&to=${to}`, [from, to]);
  if (!app.owner) return html`<div class="card err">Общий дашборд доступен только владельцу.</div>`;
  if (error) return html`<${ErrorBox} error=${error} />`;
  const rows = (data?.rows || []).filter((r) => !r.error);
  const color = (i) => SERIES[i % SERIES.length];
  // все дни периода — чтобы линии не «прыгали» через дни без оплат
  const days = [];
  for (let d = new Date(from + 'T12:00:00'), e = new Date(to + 'T12:00:00'); d <= e && days.length < 400; d.setDate(d.getDate() + 1)) days.push(d.toISOString().slice(0, 10));
  const series = rows.map((r, i) => { const m = Object.fromEntries(r.byDay.map((x) => [x.d, x.s])); return { name: r.name, color: color(i), values: days.map((d) => m[d] || 0) }; });
  const T = {
    income: sum(rows, (r) => r.income), out: sum(rows, (r) => r.out), purchases: sum(rows, (r) => r.purchases),
    closedN: sum(rows, (r) => r.closed.n), closedS: sum(rows, (r) => r.closed.s), openN: sum(rows, (r) => r.open.n), openS: sum(rows, (r) => r.open.s),
    debtN: sum(rows, (r) => r.debt.n), debtS: sum(rows, (r) => r.debt.s), todayIncome: sum(rows, (r) => r.today.income), visits: sum(rows, (r) => r.visits),
    requests: sum(rows, (r) => r.requests), newCust: sum(rows, (r) => r.newCust), quotesN: sum(rows, (r) => r.quotes.n),
  };
  return html`
    <div class="page-head"><h1>Все сервисы</h1><span class="muted">${fdate(from)} — ${fdate(to)}</span>
      <div class="actions"><button class="btn" onClick=${() => setManage(true)}><${Icon} n="gear" />Сервисы (${(data?.rows || []).length})</button></div></div>
    <div class="card" style="margin-bottom:14px">
      <div class="row wrap">${PRESETS.filter(([k]) => k !== 'all').map(([k, l]) => html`<button class=${'btn sm ' + (preset === k ? 'primary' : 'ghost')} onClick=${() => { setPreset(k); setRange(range(k)); }}>${l}</button>`)}</div>
      <div class="row wrap end" style="margin-top:8px">
        <label class="f" style="width:150px">С<input type="date" value=${from} onInput=${(e) => { setPreset(''); setRange([e.target.value, to]); }} /></label>
        <label class="f" style="width:150px">По<input type="date" value=${to} onInput=${(e) => { setPreset(''); setRange([from, e.target.value]); }} /></label>
        ${loading ? html`<span class="muted small">Обновляю…</span>` : ''}</div>
    </div>
    ${!data ? html`<${Loading} />` : html`
    <div class="grid g4" style="margin-bottom:14px">
      <div class="stat accent"><b>${zl(T.income)}</b><span>Поступило за период · все сервисы</span></div>
      <div class="stat"><b>${zl(T.todayIncome)}</b><span>Поступило сегодня</span></div>
      <div class="stat"><b>${num(T.closedN)}</b><span>Закрыто заказов · ${zl(T.closedS)}</span></div>
      <div class="stat"><b>${zl(T.closedN ? T.closedS / T.closedN : 0)}</b><span>Средний чек</span></div>
      <div class="stat"><b>${num(T.openN)}</b><span>Заказов в работе · ${zl(T.openS)}</span></div>
      <div class="stat"><b class=${T.debtS > 0.01 ? 'neg' : ''}>${zl(T.debtS)}</b><span>Долги клиентов · ${num(T.debtN)} заказов</span></div>
      <div class="stat"><b>${zl(T.out + T.purchases)}</b><span>Расходы из кассы и закупки</span></div>
      <div class="stat"><b>${num(T.visits)}</b><span>Визитов сегодня${T.requests ? ` · ${T.requests} новых заявок` : ''}</span></div>
    </div>

    <div class="card" style="margin-bottom:14px"><h2>Поступления по дням</h2>
      <${MultiLine} days=${days} series=${series} fmt=${zl} /></div>

    <div class="card tight" style="margin-bottom:14px"><div class="tbl-wrap"><table class="tbl owner-tbl" data-cols="owner">
      <thead><tr><th data-c="name">Сервис</th><th data-c="income" class="r">Поступило</th><th data-c="today" class="r">Сегодня</th><th data-c="closed" class="r">Закрыто заказов</th><th data-c="avg" class="r">Средний чек</th>
        <th data-c="labor" class="r">Работы</th><th data-c="open" class="r">В работе</th><th data-c="debt" class="r">Долги</th><th data-c="spend" class="r">Расходы</th><th data-c="quotes" class="r">Выцены</th><th data-c="cust" class="r">Новые клиенты</th><th data-c="visits" class="r">Визиты сегодня</th><th></th></tr></thead>
      <tbody>${(data.rows || []).map((r, i) => r.error ? html`<tr><td><b>${r.name}</b></td><td colspan="12" class="neg small">${r.error}</td></tr>` : html`<tr>
        <td class="nowrap"><i class="dot" style=${'background:' + color(rows.indexOf(r))}></i> <b>${r.name}</b>${r.code === data.current ? html`<div class="sub">вы сейчас здесь</div>` : ''}</td>
        <td class="r num"><b>${zl(r.income)}</b><div class="sub">${num(r.payments)} оплат</div></td><td class="r num">${zl(r.today.income)}</td>
        <td class="r num">${num(r.closed.n)}<div class="sub">${zl(r.closed.s)}</div></td><td class="r num">${zl(r.avg)}</td><td class="r num">${zl(r.labor)}</td>
        <td class="r num">${num(r.open.n)}<div class="sub">${zl(r.open.s)}</div></td><td class=${'r num' + (r.debt.s > 0.01 ? ' neg' : '')}>${zl(r.debt.s)}<div class="sub">${num(r.debt.n)} заказов</div></td>
        <td class="r num">${zl(r.out + r.purchases)}</td><td class="r num">${num(r.quotes.n)}<div class="sub">${zl(r.quotes.s)}</div></td><td class="r num">${num(r.newCust)}</td>
        <td class="r num">${num(r.visits)}${r.requests ? html`<div class="sub warn">${r.requests} заявок</div>` : ''}</td>
        <td class="r nowrap"><button class="btn sm ghost" title="Изменить данные сервиса" onClick=${() => setEditB(r.code)}><${Icon} n="edit" /></button> <button class="btn sm" onClick=${() => switchBranch(r.code)}>Открыть</button></td></tr>`)}
      </tbody>
      ${rows.length > 1 ? html`<tfoot><tr class="sum-row"><td><b>Итого</b></td><td class="r num"><b>${zl(T.income)}</b></td><td class="r num">${zl(T.todayIncome)}</td><td class="r num">${num(T.closedN)}<div class="sub">${zl(T.closedS)}</div></td>
        <td class="r num">${zl(T.closedN ? T.closedS / T.closedN : 0)}</td><td class="r num">${zl(sum(rows, (r) => r.labor))}</td><td class="r num">${num(T.openN)}</td><td class="r num">${zl(T.debtS)}</td><td class="r num">${zl(T.out + T.purchases)}</td>
        <td class="r num">${num(T.quotesN)}</td><td class="r num">${num(T.newCust)}</td><td class="r num">${num(T.visits)}</td><td></td></tr></tfoot>` : ''}
    </table></div></div>

    ${rows.length > 1 ? html`<div class="grid g2">
      <div class="card"><h2>Доля поступлений</h2><${HBars} rows=${rows} value=${(r) => r.income} label=${(r) => r.name} fmt=${(v) => `${zl(v)} · ${num(T.income ? (v / T.income) * 100 : 0, 1)}%`} /></div>
      <div class="card"><h2>Средний чек</h2><${HBars} rows=${rows} value=${(r) => r.avg} label=${(r) => r.name} fmt=${zl} color=${SERIES[2]} /></div>
    </div>` : html`<div class="card muted small">Добавьте второй сервис кнопкой «Сервисы» — здесь появится сравнение сервисов между собой.</div>`}`}
    ${editB && html`<${BranchEdit} code=${editB} onClose=${(saved) => { setEditB(null); if (saved) reload(); }} />`}
    ${manage && html`<${ManageBranches} onClose=${() => { setManage(false); reload(); app.reload(); }} />`}`;
}

/** Список сервисов: добавить, переименовать, отключить */
function ManageBranches({ onClose }) {
  const { data, reload } = useData('branches');
  const [f, setF] = useState({ name: '', code: '', address: '' });
  const [ren, setRen] = useState({});
  const [edit, setEdit] = useState(null);
  const add = async () => {
    const r = await act(() => api('branches', { body: f }), 'Сервис создан');
    setF({ name: '', code: '', address: '' }); reload();
    return r;
  };
  return html`<${Modal} wide title="Сервисы" onClose=${onClose} foot=${html`<button class="btn primary" style="margin-left:auto" onClick=${onClose}>Готово</button>`}>
    <div class="muted small" style="margin-bottom:10px">У каждого сервиса своя база: клиенты, авто, склад, касса, терминарз, сотрудники и их логины. Реквизиты фирмы, KSeF, интеграции, прайс работ, статусы и шаблоны новый сервис получает копией из главного — потом их можно менять в нём отдельно. Номера документов нового сервиса получают его код (FV 1/10/2026/W2), чтобы не совпадать с главным.</div>
    ${!data ? html`<${Loading} />` : html`<table class="tbl"><thead><tr><th>Сервис</th><th>Код</th><th>Адрес</th><th class="c">Работает</th><th></th></tr></thead><tbody>
      ${data.rows.map((b) => html`<tr class=${b.active ? '' : 'faint'}>
        <td><input class="inline-input" value=${ren[b.code] ?? b.name} onInput=${(e) => setRen({ ...ren, [b.code]: e.target.value })} /></td>
        <td><span class="chip">${b.main ? 'главный' : b.code}</span></td>
        <td class="small">${b.address || '—'}</td>
        <td class="c">${b.main ? '—' : html`<label class="toggle"><input type="checkbox" checked=${!!b.active} onChange=${async (e) => { await act(() => api('branches/' + b.code, { method: 'PUT', body: { active: e.target.checked } }), e.target.checked ? 'Сервис включён' : 'Сервис отключён — его сотрудники не смогут войти'); reload(); }} /><i></i></label>`}</td>
        <td class="r">${ren[b.code] !== undefined && ren[b.code] !== b.name ? html`<button class="btn sm primary" onClick=${async () => { await act(() => api('branches/' + b.code, { method: 'PUT', body: { name: ren[b.code] } }), 'Сохранено'); setRen({ ...ren, [b.code]: undefined }); reload(); }}>Сохранить</button>`
          : html`<div class="row" style="justify-content:flex-end;gap:6px"><button class="btn sm" onClick=${() => setEdit(b.code)}><${Icon} n="edit" />Изменить</button>${b.active ? html`<button class="btn sm" onClick=${() => switchBranch(b.code)}>Открыть</button>` : ''}</div>`}</td></tr>`)}
    </tbody></table>`}
    <div class="card" style="background:var(--surface2);margin-top:14px"><b>Новый сервис</b>
      <div class="grid g3" style="margin-top:6px">
        <label class="f">Название<input value=${f.name} placeholder="Pulsecar Mokotów" onInput=${(e) => setF({ ...f, name: e.target.value })} /></label>
        <label class="f">Код (2–8 латинских букв / цифр)<input value=${f.code} placeholder="W2" maxlength="8" onInput=${(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} /></label>
        <label class="f">Адрес<input value=${f.address} placeholder="ul. …, Warszawa" onInput=${(e) => setF({ ...f, address: e.target.value })} /></label>
      </div>
      <div class="row" style="margin-top:8px"><span class="muted small">После создания откройте сервис и добавьте в нём сотрудников с их логинами (Сотрудники и доступы).</span>
        <button class="btn primary" style="margin-left:auto" disabled=${!f.name || f.code.length < 2} onClick=${add}><${Icon} n="plus" />Создать сервис</button></div>
    </div>
    ${edit && html`<${BranchEdit} code=${edit} onClose=${(saved) => { setEdit(null); if (saved) reload(); }} />`}
  </${Modal}>`;
}

/** Изменить данные сервиса: название, адрес, контакты, часы терминарза, счёт, реквизиты фирмы */
export function BranchEdit({ code, onClose }) {
  const app = useApp();
  const { data } = useData('branches/' + code + '/settings');
  const [f, setF] = useState(null);
  const [toAll, setToAll] = useState(false);
  if (data && !f) { setF({ name: data.name, service: { ...data.service }, firm: { ...data.firm } }); return null; }
  const S = (k, l, t = 'text', ph = '') => html`<label class="f">${l}<input type=${t} value=${f.service[k] || ''} placeholder=${ph} onInput=${(e) => setF({ ...f, service: { ...f.service, [k]: e.target.value } })} /></label>`;
  const F = (k, l, ph = '') => html`<label class="f">${l}<input value=${f.firm[k] || ''} placeholder=${ph} onInput=${(e) => setF({ ...f, firm: { ...f.firm, [k]: e.target.value } })} /></label>`;
  const save = async () => {
    await act(() => api(`branches/${code}/settings`, { method: 'PUT', body: { ...f, firmToAll: toAll } }), toAll ? 'Сохранено · реквизиты фирмы обновлены во всех сервисах' : 'Сохранено');
    app.reload(); onClose(true);
  };
  return html`<${Modal} wide title=${data ? `Сервис: ${data.name}` : 'Сервис'} onClose=${() => onClose(false)} foot=${f && html`<button class="btn" onClick=${() => onClose(false)}>Отмена</button><button class="btn primary" style="margin-left:auto" onClick=${save}>Сохранить</button>`}>
    ${!f ? html`<${Loading} />` : html`<div class="stack">
      <div class="card stack" style="background:var(--surface2)"><h3 style="margin:0">Сервис</h3>
        <div class="grid g3"><label class="f">Название (в CRM и переключателе)<input value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /></label>
          <label class="f">Код<input value=${data.main ? 'главный' : data.code} disabled /></label>${S('company_brand', 'Бренд (на карте заказа)', 'text', 'Pulsecar')}</div>
        <div class="grid g3">${S('company_address', 'Адрес сервиса', 'text', 'ul. Arkuszowa 176, Warszawa')}${S('company_phone', 'Телефон', 'tel', '+48 …')}${S('company_email', 'E-mail')}</div>
        <div class="grid g4">${S('company_www', 'Сайт')}${S('hours_start', 'Терминарз с', 'time')}${S('hours_end', 'Терминарз до', 'time')}
          <label class="f">Шаг сетки<select value=${f.service.slot_min || '30'} onChange=${(e) => setF({ ...f, service: { ...f.service, slot_min: e.target.value } })}><option value="15">15 мин</option><option value="30">30 мин</option><option value="60">60 мин</option></select></label></div>
        <div class="grid g3">${S('company_bank', 'Счёт сервиса (IBAN)')}${S('company_bank_name', 'Банк')}${S('review_url', 'Ссылка на отзывы Google', 'url', 'https://g.page/r/…/review')}</div>
        <label class="f">Условия на карте заказа (печатаются внизу)<textarea rows="3" value=${f.service.order_terms || ''} onInput=${(e) => setF({ ...f, service: { ...f.service, order_terms: e.target.value } })}></textarea></label>
      </div>
      <div class="card stack" style="background:var(--surface2)"><h3 style="margin:0">Реквизиты фирмы (фактуры, KSeF)</h3>
        <div class="grid g3">${F('company_nip', 'NIP')}${F('company_vat_eu', 'NIP UE')}${F('company_name', 'Короткое название')}</div>
        ${F('company_legal_name', 'Полное название (на фактуре и в KSeF)')}
        <div class="grid g3">${F('company_street', 'Юр. адрес: улица и номер')}${F('company_postcode', 'Индекс')}${F('company_city', 'Город')}</div>
        <div class="grid g4">${F('company_regon', 'REGON')}${F('company_krs', 'KRS')}${F('company_bdo', 'BDO')}${F('company_capital', 'Уставный капитал')}</div>
        <div class="grid g3">${F('company_court', 'Суд регистрации')}${F('company_pkd', 'PKD')}${F('company_swift', 'SWIFT')}</div>
        <label class="check"><input type="checkbox" checked=${toAll} onChange=${(e) => setToAll(e.target.checked)} />Записать эти реквизиты фирмы во все сервисы (одна фирма — один NIP)</label>
      </div>
      <div class="muted small">Остальное (кассы, посты, нумерация, SMS-шаблоны, интеграции) меняется внутри сервиса: «Открыть» → Настройки.</div>
    </div>`}
  </${Modal}>`;
}
