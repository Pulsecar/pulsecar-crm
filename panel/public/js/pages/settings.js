import { html, useState, useData, api, act, go, useApp, Icon, Modal, ConfirmButton, Badge, zl, num, fdt, toast } from '../lib.js';
import Integrations from './integrations.js';
import Messaging, { TplField } from './messaging.js';
import { Params, Numbering, StaffAccess, CatalogFull, Templates, ChecklistsSettings, Lists } from './settings2.js';

const TABS = [['integrations', 'Интеграции'], ['staff', 'Сотрудники и доступы'], ['params', 'Параметры'], ['messages', 'SMS и шаблоны'], ['company', 'Фирма'], ['numbering', 'Нумерация'], ['statuses', 'Статусы заказов'], ['qstatuses', 'Статусы выцен'], ['catalog', 'Прайс работ'], ['templates', 'Шаблоны заказов'], ['checklists', 'Чек-листы'], ['types', 'Источники'], ['stations', 'Посты'], ['lists', 'Справочники'], ['import', 'Импорт данных']];

export default function Settings({ sub }) {
  const tab = TABS.some(([k]) => k === sub) ? sub : 'integrations';
  return html`<div class="page-head"><h1>Настройки</h1></div>
    <div class="pill-tabs" style="margin-bottom:14px">${TABS.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => go('/settings/' + k)}>${l}</button>`)}</div>
    ${tab === 'integrations' && html`<${Integrations} />`}
    ${tab === 'messages' && html`<${Messaging} />`}
    ${tab === 'company' && html`<${Company} />`}
    ${tab === 'statuses' && html`<${Dict} name="statuses" scope="order" key="so" />`}
    ${tab === 'qstatuses' && html`<${Dict} name="statuses" scope="quote" key="sq" />`}
    ${tab === 'types' && html`<${Dict} name="types" />`}
    ${tab === 'stations' && html`<${Dict} name="stations" />`}
    ${tab === 'staff' && html`<${StaffAccess} />`}
    ${tab === 'catalog' && html`<${CatalogFull} />`}
    ${tab === 'params' && html`<${Params} />`}
    ${tab === 'numbering' && html`<${Numbering} />`}
    ${tab === 'templates' && html`<${Templates} />`}
    ${tab === 'checklists' && html`<${ChecklistsSettings} />`}
    ${tab === 'lists' && html`<${Lists} />`}
    ${tab === 'import' && html`<${Import} />`}`;
}

function Company() {
  const app = useApp();
  const [f, set] = useState({ ...app.settings });
  const [busy, setBusy] = useState(false);
  const inp = (k, l, t = 'text', ph = '') => html`<label class="f">${l}<input type=${t} value=${f[k] || ''} placeholder=${ph} onInput=${(e) => set({ ...f, [k]: e.target.value })} /></label>`;
  const find = async () => {
    setBusy(true);
    try {
      const r = await act(() => api('nip/' + encodeURIComponent(f.company_nip || '')));
      set({ ...f, company_legal_name: r.name, company_street: r.street, company_postcode: r.postcode, company_city: r.city, company_regon: r.regon || f.company_regon, company_krs: r.krs || f.company_krs,
        company_bank: f.company_bank || (r.accounts[0] ? r.accounts[0].replace(/(\d{2})(\d{4})(\d{4})(\d{4})(\d{4})(\d{4})(\d{4})/, '$1 $2 $3 $4 $5 $6 $7') : '') });
      toast(`Найдено: ${r.name} · VAT: ${r.statusVat}`);
    } finally { setBusy(false); }
  };
  return html`<div class="stack">
    <div class="card stack"><h2>Реквизиты для фактур и KSeF</h2>
      <div class="grid g3">${inp('company_nip', 'NIP', 'text', '5214141930')}
        <div class="f" style="align-self:end"><button class="btn" onClick=${find} disabled=${busy}><${Icon} n="search" />${busy ? 'Ищу…' : 'Заполнить по NIP (реестр Минфина)'}</button></div>
        ${inp('company_vat_eu', 'NIP UE (VAT-UE)', 'text', 'PL5214141930')}</div>
      <div class="grid g2">${inp('company_legal_name', 'Полное название (на фактуре и в KSeF)', 'text', 'AI CARS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ')}${inp('company_name', 'Короткое название (на документах)')}</div>
      <div class="grid g3">${inp('company_street', 'Юр. адрес: улица и номер')}${inp('company_postcode', 'Индекс')}${inp('company_city', 'Город')}</div>
      <div class="grid g4">${inp('company_regon', 'REGON')}${inp('company_krs', 'KRS')}${inp('company_bdo', 'Номер BDO', 'text', '000123456')}${inp('company_capital', 'Уставный капитал', 'text', '5 000,00 zł')}</div>
      <div class="grid g2">${inp('company_court', 'Суд регистрации (Sąd Rejonowy…)', 'text', 'Sąd Rejonowy dla m.st. Warszawy, XIII Wydział Gospodarczy KRS')}${inp('company_pkd', 'PKD', 'text', '45.20.Z')}</div>
      <div class="grid g3">${inp('company_bank', 'Номер счёта (IBAN)')}${inp('company_bank_name', 'Банк')}${inp('company_swift', 'SWIFT')}</div>
      <div class="muted small">Всё это печатается на фактуре (NIP, REGON, KRS, BDO, капитал, счёт) и уходит в KSeF. BDO обязателен на фактурах, если вы продаёте масла, аккумуляторы, шины и т. п. и зарегистрированы в BDO.</div>
    </div>
    <div class="card stack"><h2>Сервис</h2>
      <div class="grid g3">${inp('company_brand', 'Бренд')}${inp('company_address', 'Адрес сервиса (на карте заказа и протоколах)')}${inp('company_www', 'Сайт')}</div>
      <div class="grid g3">${inp('company_phone', 'Телефон')}${inp('company_email', 'E-mail')}</div>
      <div class="grid g4">${inp('hours_start', 'Терминарз с', 'time')}${inp('hours_end', 'Терминарз до', 'time')}
        <label class="f">Шаг сетки<select value=${f.slot_min} onChange=${(e) => set({ ...f, slot_min: e.target.value })}><option value="15">15 мин</option><option value="30">30 мин</option><option value="60">60 мин</option></select></label>
        ${inp('cash_opening', 'Наличные в кассе на старте, zł', 'number')}</div>
      <label class="f">Условия на карте заказа (печатаются внизу)<textarea rows="4" value=${f.order_terms || ''} onInput=${(e) => set({ ...f, order_terms: e.target.value })}
        placeholder="Np. Warsztat nie odpowiada za rzeczy pozostawione w pojeździe. Części wymienione zwracamy na życzenie klienta…"></textarea></label>
    </div>
    <div class="row"><button class="btn primary" onClick=${async () => { await act(() => api('settings', { method: 'PUT', body: f }), 'Сохранено'); app.reload(); }}>Сохранить</button></div>
    <div class="muted small">Токены SMS, KSeF, Inter Cars и других сервисов — во вкладке «Интеграции». Шаблоны SMS и e-mail — во вкладке «SMS и шаблоны».</div>
  </div>`;
}

const DICT = {
  statuses: { title: 'Статус', cols: [['name', 'Название'], ['color', 'Цвет', 'color'], ['client_label', 'Как видит клиент в приложении'], ['is_final', 'Завершает заказ', 'bool'], ['lock_edit', 'Блокирует изменения', 'bool'], ['sms_mode', 'SMS клиенту', 'sms'], ['pos', 'Порядок', 'number']] },
  types: { title: 'Источник', cols: [['name', 'Название'], ['pos', 'Порядок', 'number']] },
  stations: { title: 'Пост', cols: [['name', 'Название'], ['color', 'Цвет', 'color'], ['max_hours_day', 'Макс. часов в день', 'number'], ['parallel', 'Заказов одновременно', 'number'], ['pos', 'Порядок', 'number'], ['active', 'Активен', 'bool']] },
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

function Dict({ name, scope }) {
  const app = useApp();
  const cfg = name === 'statuses' && scope === 'quote' ? { ...DICT.statuses, title: 'Статус выцены', cols: DICT.statuses.cols.map((c) => (c[0] === 'is_final' ? ['is_final', 'Завершает выцену', 'bool'] : c)) } : DICT[name];
  // статусы заказов и выцен — раздельно (scope order / quote); «общие» (старые) видны в обоих
  const rows = name === 'statuses' ? app.statuses.filter((s) => !scope || (s.scope || 'all') === 'all' || s.scope === scope) : name === 'types' ? app.types : app.stations;
  const [edit, setEdit] = useState(null);
  const save = async () => { await act(() => api('dict/' + name, { body: edit }), 'Сохранено'); setEdit(null); app.reload(); };
  const del = async (r) => { await act(() => api(`dict/${name}/${r.id}`, { method: 'DELETE' }), 'Удалено'); app.reload(); };
  return html`<div class="card tight">
    <div class="row" style="padding:12px 14px"><button class="btn primary sm" style="margin-left:auto" onClick=${() => setEdit({ pos: rows.length + 1, active: 1, ...(scope ? { scope } : {}) })}><${Icon} n="plus" />Добавить</button></div>
    ${name === 'statuses' && html`<div class="muted small" style="padding:0 14px 10px">${scope === 'quote' ? 'Эти статусы видны только в выценах.' : 'Эти статусы видны только в заказах.'}</div>`}
    <table class="tbl"><thead><tr>${cfg.cols.map(([, l]) => html`<th>${l}</th>`)}<th></th></tr></thead>
      <tbody>${rows.map((r) => html`<tr class="click" onClick=${() => setEdit({ ...r })}>${cfg.cols.map(([k, , t]) => html`<td>${t === 'bool' ? (r[k] ? '✓' : '') : t === 'sms' ? (SMS_MODE[r[k]] || '') + (r.email_mode && r.email_mode !== 'off' ? ' + e-mail' : '') : t === 'color' ? html`<${Badge} color=${r[k]}>${r[k] || ''}</${Badge}>` : r[k]}</td>`)}
        <td class="act" onClick=${(e) => e.stopPropagation()}><${ConfirmButton} cls="icon-btn" onConfirm=${() => del(r)}><${Icon} n="trash" /></${ConfirmButton}></td></tr>`)}</tbody></table>
    ${edit && html`<${Modal} title=${cfg.title} onClose=${() => setEdit(null)} foot=${html`<button class="btn primary" onClick=${save}>Сохранить</button>`}>
      ${cfg.cols.map(([k, l, t]) => t === 'sms' ? html`<${StatusMessages} edit=${edit} setEdit=${setEdit} />` : t === 'bool' ? html`<label class="check"><input type="checkbox" checked=${!!edit[k]} onChange=${(e) => setEdit({ ...edit, [k]: e.target.checked ? 1 : 0 })} />${l}</label>`
        : html`<label class="f">${l}<input type=${t || 'text'} value=${edit[k] ?? (t === 'color' ? '#1BF372' : '')} onInput=${(e) => setEdit({ ...edit, [k]: t === 'number' ? Number(e.target.value) : e.target.value })} /></label>`)}
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
