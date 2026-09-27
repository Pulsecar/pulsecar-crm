import { html, useState, useData, api, act, go, useApp, Icon, Modal, ConfirmButton, Badge, zl, num, fdt } from '../lib.js';
import Integrations from './integrations.js';
import Messaging, { TplField } from './messaging.js';

const TABS = [['integrations', 'Интеграции'], ['messages', 'SMS и шаблоны'], ['company', 'Фирма'], ['statuses', 'Статусы заказов'], ['types', 'Источники'], ['stations', 'Посты'], ['staff', 'Сотрудники'], ['catalog', 'Прайс работ'], ['import', 'Импорт данных']];

export default function Settings({ sub }) {
  const tab = TABS.some(([k]) => k === sub) ? sub : 'integrations';
  return html`<div class="page-head"><h1>Настройки</h1></div>
    <div class="pill-tabs" style="margin-bottom:14px">${TABS.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => go('/settings/' + k)}>${l}</button>`)}</div>
    ${tab === 'integrations' && html`<${Integrations} />`}
    ${tab === 'messages' && html`<${Messaging} />`}
    ${tab === 'company' && html`<${Company} />`}
    ${tab === 'statuses' && html`<${Dict} name="statuses" />`}
    ${tab === 'types' && html`<${Dict} name="types" />`}
    ${tab === 'stations' && html`<${Dict} name="stations" />`}
    ${tab === 'staff' && html`<${Staff} />`}
    ${tab === 'catalog' && html`<${Catalog} />`}
    ${tab === 'import' && html`<${Import} />`}`;
}

function Company() {
  const app = useApp();
  const [f, set] = useState({ ...app.settings });
  const inp = (k, l, t = 'text') => html`<label class="f">${l}<input type=${t} value=${f[k] || ''} onInput=${(e) => set({ ...f, [k]: e.target.value })} /></label>`;
  return html`<div class="card stack">
    <div class="grid g3">${inp('company_name', 'Юр. название (для печати)')}${inp('company_brand', 'Бренд')}${inp('company_nip', 'NIP')}</div>
    <div class="grid g3">${inp('company_address', 'Адрес')}${inp('company_phone', 'Телефон')}${inp('company_email', 'E-mail')}</div>
    <div class="grid g3">${inp('company_bank', 'Номер счёта (для перевода на карте заказа)')}</div>
    <div class="grid g4">${inp('hours_start', 'Терминарз с', 'time')}${inp('hours_end', 'Терминарз до', 'time')}
      <label class="f">Шаг сетки<select value=${f.slot_min} onChange=${(e) => set({ ...f, slot_min: e.target.value })}><option value="15">15 мин</option><option value="30">30 мин</option><option value="60">60 мин</option></select></label>
      ${inp('cash_opening', 'Наличные в кассе на старте, zł', 'number')}</div>
    <label class="f">Условия на карте заказа (печатаются внизу)<textarea rows="4" value=${f.order_terms || ''} onInput=${(e) => set({ ...f, order_terms: e.target.value })}
      placeholder="Np. Warsztat nie odpowiada za rzeczy pozostawione w pojeździe. Części wymienione zwracamy na życzenie klienta…"></textarea></label>
    <div class="row"><button class="btn primary" onClick=${async () => { await act(() => api('settings', { method: 'PUT', body: f }), 'Сохранено'); app.reload(); }}>Сохранить</button></div>
    <div class="muted small">Токены SMS, Fakturownia, Inter Cars и других сервисов — во вкладке «Интеграции». Шаблоны SMS и e-mail — во вкладке «SMS и шаблоны». Правила Pulse Points — в файле .env на сервере.</div>
  </div>`;
}

const DICT = {
  statuses: { title: 'Статус', cols: [['name', 'Название'], ['color', 'Цвет', 'color'], ['client_label', 'Как видит клиент в приложении'], ['is_final', 'Завершает заказ', 'bool'], ['lock_edit', 'Блокирует изменения', 'bool'], ['sms_mode', 'SMS клиенту', 'sms'], ['pos', 'Порядок', 'number']] },
  types: { title: 'Источник', cols: [['name', 'Название'], ['pos', 'Порядок', 'number']] },
  stations: { title: 'Пост', cols: [['name', 'Название'], ['color', 'Цвет', 'color'], ['pos', 'Порядок', 'number'], ['active', 'Активен', 'bool']] },
};
const SMS_MODE = { off: '', ask: 'SMS (спросить)', auto: 'SMS (сразу)' };
/** SMS и e-mail клиенту при смене на этот статус — как «SMS do klienta» в Motowarsztat */
function StatusMessages({ edit, setEdit }) {
  const { data } = useData('messaging');
  const fields = data?.fields || [];
  const modeSel = (k) => html`<select value=${edit[k] || 'off'} onChange=${(e) => setEdit({ ...edit, [k]: e.target.value })}>
    <option value="off">Не отправлять</option><option value="ask">Показать окно с готовым текстом (отправить или нет)</option><option value="auto">Отправлять сразу, без вопроса</option></select>`;
  return html`<div class="card" style="background:var(--surface2);margin:8px 0">
    <label class="f">SMS клиенту при смене на этот статус${modeSel('sms_mode')}</label>
    ${edit.sms_mode && edit.sms_mode !== 'off' && html`<${TplField} label="Шаблон SMS" value=${edit.sms_template || ''} onInput=${(x) => setEdit({ ...edit, sms_template: x })} fields=${fields} rows=${5} />`}
    <label class="f" style="margin-top:10px">E-mail клиенту${modeSel('email_mode')}</label>
    ${edit.email_mode && edit.email_mode !== 'off' && html`<${TplField} label="Текст письма" value=${edit.email_template || ''} onInput=${(x) => setEdit({ ...edit, email_template: x })} fields=${fields} rows=${5} sms=${false} />`}
  </div>`;
}

function Dict({ name }) {
  const app = useApp();
  const cfg = DICT[name];
  const rows = name === 'statuses' ? app.statuses : name === 'types' ? app.types : app.stations;
  const [edit, setEdit] = useState(null);
  const save = async () => { await act(() => api('dict/' + name, { body: edit }), 'Сохранено'); setEdit(null); app.reload(); };
  const del = async (r) => { await act(() => api(`dict/${name}/${r.id}`, { method: 'DELETE' }), 'Удалено'); app.reload(); };
  return html`<div class="card tight">
    <div class="row" style="padding:12px 14px"><button class="btn primary sm" style="margin-left:auto" onClick=${() => setEdit({ pos: rows.length + 1, active: 1 })}><${Icon} n="plus" />Добавить</button></div>
    <table class="tbl"><thead><tr>${cfg.cols.map(([, l]) => html`<th>${l}</th>`)}<th></th></tr></thead>
      <tbody>${rows.map((r) => html`<tr class="click" onClick=${() => setEdit({ ...r })}>${cfg.cols.map(([k, , t]) => html`<td>${t === 'bool' ? (r[k] ? '✓' : '') : t === 'sms' ? (SMS_MODE[r[k]] || '') + (r.email_mode && r.email_mode !== 'off' ? ' + e-mail' : '') : t === 'color' ? html`<${Badge} color=${r[k]}>${r[k] || ''}</${Badge}>` : r[k]}</td>`)}
        <td class="act" onClick=${(e) => e.stopPropagation()}><${ConfirmButton} cls="icon-btn" onConfirm=${() => del(r)}><${Icon} n="trash" /></${ConfirmButton}></td></tr>`)}</tbody></table>
    ${edit && html`<${Modal} title=${cfg.title} onClose=${() => setEdit(null)} foot=${html`<button class="btn primary" onClick=${save}>Сохранить</button>`}>
      ${cfg.cols.map(([k, l, t]) => t === 'sms' ? html`<${StatusMessages} edit=${edit} setEdit=${setEdit} />` : t === 'bool' ? html`<label class="check"><input type="checkbox" checked=${!!edit[k]} onChange=${(e) => setEdit({ ...edit, [k]: e.target.checked ? 1 : 0 })} />${l}</label>`
        : html`<label class="f">${l}<input type=${t || 'text'} value=${edit[k] ?? (t === 'color' ? '#1BF372' : '')} onInput=${(e) => setEdit({ ...edit, [k]: t === 'number' ? Number(e.target.value) : e.target.value })} /></label>`)}
    </${Modal}>`}
  </div>`;
}

function Staff() {
  const app = useApp();
  const [edit, setEdit] = useState(null);
  const save = async () => { await act(() => api('staff', { body: edit }), 'Сохранено'); setEdit(null); app.reload(); };
  const ROLE = { admin: 'Администратор', staff: 'Приёмщик / менеджер', mechanic: 'Механик' };
  return html`<div class="card tight">
    <div class="row" style="padding:12px 14px"><span class="muted small">Механик видит заказы и терминарз и отмечает работы. Приёмщик — всё, кроме отчётов и настроек.</span>
      <button class="btn primary sm" style="margin-left:auto" onClick=${() => setEdit({ role: 'mechanic', is_mechanic: 1, commission_pct: 40, hourly_rate: 250, active: 1 })}><${Icon} n="plus" />Сотрудник</button></div>
    <table class="tbl"><thead><tr><th>Имя</th><th>Логин</th><th>Роль</th><th class="r">Ставка н/ч</th><th class="r">% от работ</th><th>Активен</th></tr></thead>
      <tbody>${app.staff.map((s) => html`<tr class="click" onClick=${() => setEdit({ ...s, password: '' })}><td><b>${s.name}</b></td><td class="sub">${s.login || '—'}</td><td>${ROLE[s.role]}</td>
        <td class="r">${zl(s.hourly_rate)}</td><td class="r">${s.commission_pct}%</td><td>${s.active ? '✓' : html`<span class="faint">отключён</span>`}</td></tr>`)}</tbody></table>
    ${edit && html`<${Modal} title="Сотрудник" onClose=${() => setEdit(null)} foot=${html`<button class="btn primary" onClick=${save}>Сохранить</button>`}>
      <div class="grid g2"><label class="f">Имя<input value=${edit.name || ''} onInput=${(e) => setEdit({ ...edit, name: e.target.value })} /></label>
        <label class="f">Роль<select value=${edit.role} onChange=${(e) => setEdit({ ...edit, role: e.target.value })}>${Object.entries(ROLE).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label></div>
      <div class="grid g2"><label class="f">Ставка за нормо-час, zł<input type="number" value=${edit.hourly_rate} onInput=${(e) => setEdit({ ...edit, hourly_rate: e.target.value })} /></label>
        <label class="f">% от работ в заказах<input type="number" value=${edit.commission_pct} onInput=${(e) => setEdit({ ...edit, commission_pct: e.target.value })} /></label></div>
      <div class="grid g2"><label class="f">Логин для входа (можно пусто)<input value=${edit.login || ''} autocomplete="off" onInput=${(e) => setEdit({ ...edit, login: e.target.value })} /></label>
        <label class="f">${edit.id ? 'Новый пароль (оставьте пустым)' : 'Пароль'}<input type="password" autocomplete="new-password" value=${edit.password || ''} onInput=${(e) => setEdit({ ...edit, password: e.target.value })} /></label></div>
      <label class="check"><input type="checkbox" checked=${!!edit.active} onChange=${(e) => setEdit({ ...edit, active: e.target.checked })} />Активен</label>
    </${Modal}>`}
  </div>`;
}

function Catalog() {
  const { data, reload } = useData('catalog');
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const rows = (data || []).filter((r) => !q || (r.name + ' ' + (r.category || '')).toLowerCase().includes(q.toLowerCase()));
  return html`<div class="card tight">
    <div class="row" style="padding:12px 14px"><input class="grow" type="search" placeholder="Поиск по прайсу…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <button class="btn primary sm" onClick=${() => setEdit({ unit: 'oper', qty: 1, price: 0, vat: 23 })}><${Icon} n="plus" />Работа</button></div>
    <table class="tbl"><thead><tr><th>Категория</th><th>Работа</th><th class="r">Кол-во</th><th>Ед.</th><th class="r">Цена брутто</th><th></th></tr></thead>
      <tbody>${rows.map((r) => html`<tr class="click" onClick=${() => setEdit({ ...r })}><td class="sub">${r.category || ''}</td><td>${r.name}</td><td class="r">${r.qty}</td><td>${r.unit}</td><td class="r">${zl(r.price)}</td>
        <td class="act" onClick=${(e) => e.stopPropagation()}><${ConfirmButton} cls="icon-btn" onConfirm=${async () => { await act(() => api('catalog/' + r.id, { method: 'DELETE' })); reload(); }}><${Icon} n="trash" /></${ConfirmButton}></td></tr>`)}</tbody></table>
    ${!rows.length ? html`<div class="empty">Прайс пуст — при импорте его можно загрузить из файла, а на сайте уже есть 45 позиций цен.</div>` : ''}
    ${edit && html`<${Modal} title="Работа из прайса" onClose=${() => setEdit(null)} foot=${html`<button class="btn primary" onClick=${async () => { await act(() => api('catalog', { body: edit }), 'Сохранено'); setEdit(null); reload(); }}>Сохранить</button>`}>
      <label class="f">Категория<input value=${edit.category || ''} onInput=${(e) => setEdit({ ...edit, category: e.target.value })} /></label>
      <label class="f">Название<input value=${edit.name || ''} onInput=${(e) => setEdit({ ...edit, name: e.target.value })} /></label>
      <div class="grid g3"><label class="f">Кол-во (н/ч)<input type="number" step="0.1" value=${edit.qty} onInput=${(e) => setEdit({ ...edit, qty: e.target.value })} /></label>
        <label class="f">Ед.<input value=${edit.unit} onInput=${(e) => setEdit({ ...edit, unit: e.target.value })} /></label>
        <label class="f">Цена брутто<input type="number" step="0.01" value=${edit.price} onInput=${(e) => setEdit({ ...edit, price: e.target.value })} /></label></div>
    </${Modal}>`}
  </div>`;
}

function Import() {
  const { data: hist, reload } = useData('imports');
  const [res, setRes] = useState(null);
  const [type, setType] = useState('');
  const [busy, setBusy] = useState(false);
  const upload = async (e) => {
    e.preventDefault();
    const file = e.target.querySelector('input[type=file]').files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    if (type) fd.append('type', type);
    setBusy(true);
    try { setRes(await act(() => api('import', { form: fd }), 'Импорт завершён')); reload(); } catch {} finally { setBusy(false); }
  };
  const TYPE = { orders: 'заказы', cars: 'автомобили', customers: 'клиенты', products: 'товары' };
  return html`<div class="card stack">
    <h2>Загрузка из Motowarsztat и других систем</h2>
    <p class="muted" style="margin:0">CSV или Excel. Тип файла определяется по колонкам: клиенты (телефон, имя), авто (номер, VIN, марка), заказы (номер заказа + позиции), товары (название, индекс, цена, остаток).
      Колонки понимаются на польском, русском и английском. Повторная загрузка ничего не дублирует — клиенты ищутся по телефону, авто — по VIN/номеру, заказы — по номеру.</p>
    <p class="muted small" style="margin:0">Рекомендуемый порядок из Motowarsztat: 1) Raporty → Klienci, 2) Raporty → Pojazdy, 3) Raporty → Zlecenia → Szczegółowe zestawienie, 4) Towary.</p>
    <form class="row end" onSubmit=${upload}>
      <label class="f grow">Файл<input type="file" accept=".csv,.xlsx,.xls" required /></label>
      <label class="f" style="width:200px">Что в файле<select value=${type} onChange=${(e) => setType(e.target.value)}><option value="">Определить автоматически</option>${Object.entries(TYPE).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
      <button class="btn primary" disabled=${busy}><${Icon} n="upload" />${busy ? 'Загружаю…' : 'Загрузить'}</button>
      <a class="btn" href="/crm-api/template.csv">Шаблон</a>
    </form>
    ${res && html`<div class="card" style="background:var(--surface2)">
      <b class="pos">Готово: ${TYPE[res.type]}.</b> Строк ${res.rows} · клиентов ${res.customers} (новых ${res.newCustomers}) · авто ${res.cars} · заказов ${res.visits} · позиций ${res.items} · товаров ${res.products} · баллов ${res.pointsAwarded}
      ${res.warnings?.length ? html`<ul class="small" style="color:var(--warn)">${res.warnings.map((w) => html`<li>${w}</li>`)}</ul>` : ''}
      <div class="muted small" style="margin-top:6px">Колонки: ${Object.entries(res.columns || {}).map(([k, v]) => `${k} ← «${v}»`).join(', ')}</div></div>`}
    <h3 style="margin-top:8px">История</h3>
    <table class="tbl"><tbody>${(hist || []).map((i) => html`<tr><td class="sub nowrap">${fdt(i.created_at)}</td><td>${i.filename}</td><td>${TYPE[i.stats.type] || ''}</td><td class="sub">${i.staff}</td>
      <td class="r">${num(i.stats.rows)} строк</td></tr>`)}</tbody></table>
  </div>`;
}
