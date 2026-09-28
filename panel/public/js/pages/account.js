// Меню профиля (как в Motowarsztat): мой аккаунт, запланированные напоминания, история изменений, настройки экрана и тема
import { html, useState, useEffect, useData, api, act, useApp, Loading, ErrorBox, Icon, Modal, fdt, toast } from '../lib.js';

const ROLE = { admin: 'Администратор', staff: 'Сотрудник', mechanic: 'Механик' };

export function MyAccount() {
  const app = useApp();
  const u = app.user;
  const [f, set] = useState({ name: u.name || '', phone: u.phone || '', email: u.email || '' });
  const [pw, setPw] = useState({ current_password: '', new_password: '', repeat: '' });
  const saveData = async (e) => { e.preventDefault(); await act(() => api('me', { method: 'PUT', body: f }), 'Сохранено'); app.reload(); };
  const savePw = async (e) => {
    e.preventDefault();
    if (pw.new_password !== pw.repeat) return toast('Пароли не совпадают', 'error');
    await act(() => api('me', { method: 'PUT', body: { current_password: pw.current_password, new_password: pw.new_password } }), 'Пароль изменён');
    setPw({ current_password: '', new_password: '', repeat: '' });
  };
  return html`<div class="page-head"><h1>Мой аккаунт</h1></div>
    <div class="grid g2">
      <form class="card stack" onSubmit=${saveData}>
        <h2>Мои данные</h2>
        <div class="muted small">Логин: <b>${u.login || '—'}</b> · роль: ${ROLE[u.role] || u.role}${u.last_login ? ' · последний вход ' + fdt(u.last_login) : ''}</div>
        <label class="f">Имя и фамилия<input value=${f.name} onInput=${(e) => set({ ...f, name: e.target.value })} required /></label>
        <div class="grid g2"><label class="f">Телефон<input type="tel" value=${f.phone} onInput=${(e) => set({ ...f, phone: e.target.value })} /></label>
          <label class="f">E-mail<input type="email" value=${f.email} onInput=${(e) => set({ ...f, email: e.target.value })} /></label></div>
        <div class="row"><button class="btn primary" style="margin-left:auto">Сохранить</button></div>
      </form>
      <form class="card stack" onSubmit=${savePw}>
        <h2>Сменить пароль</h2>
        <label class="f">Текущий пароль<input type="password" autocomplete="current-password" value=${pw.current_password} onInput=${(e) => setPw({ ...pw, current_password: e.target.value })} required /></label>
        <div class="grid g2"><label class="f">Новый пароль (мин. 8 символов)<input type="password" autocomplete="new-password" minlength="8" value=${pw.new_password} onInput=${(e) => setPw({ ...pw, new_password: e.target.value })} required /></label>
          <label class="f">Повторите пароль<input type="password" autocomplete="new-password" value=${pw.repeat} onInput=${(e) => setPw({ ...pw, repeat: e.target.value })} required /></label></div>
        <div class="row"><button class="btn primary" style="margin-left:auto">Сменить пароль</button></div>
      </form>
    </div>`;
}

const ST = { planned: ['запланировано', 'var(--info)'], sent: ['отправлено', 'var(--accent)'], off: ['напоминания выключены', 'var(--muted)'], no_phone: ['нет телефона', 'var(--warn)'], request: ['заявка — не подтверждена', 'var(--warn)'] };
export function Reminders() {
  const app = useApp();
  const { data, error } = useData('reminders');
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data) return html`<${Loading} />`;
  return html`<div class="page-head"><h1>Запланированные напоминания</h1>
      ${app.perms['settings.manage'] && html`<div class="actions"><a class="btn" href="#/settings/messages"><${Icon} n="sliders" />Шаблон и время напоминания</a></div>`}</div>
    <div class="card small" style="margin-bottom:12px">${data.on
      ? html`SMS-напоминание уходит клиенту за <b>${data.hours} ч</b> до визита из терминарза.${!app.features.sms ? html` <span style="color:var(--warn)">SMS-шлюз не подключён — сообщения попадут только в журнал.</span>` : ''}`
      : html`<span style="color:var(--warn)">Напоминания о визите выключены.</span> Включить: Настройки → SMS и шаблоны.`}</div>
    <div class="card tight"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Визит</th><th>Клиент</th><th>Авто</th><th>Пост</th><th>Отправка SMS</th><th>Статус</th></tr></thead>
      <tbody>${data.rows.map((a) => html`<tr>
        <td class="nowrap"><b>${fdt(a.start_at)}</b>${a.order_no ? html`<div class="sub"><a href=${'#/orders/' + a.order_id}>${a.order_no}</a></div>` : ''}</td>
        <td>${a.customer_id ? html`<a href=${'#/customers/' + a.customer_id}>${a.kind === 'company' && a.company ? a.company : a.cname || '—'}</a>` : a.a_name || '—'}<div class="sub">${a.phone || ''}</div></td>
        <td>${[a.make, a.model].filter(Boolean).join(' ')} ${a.plate ? html`<span class="plate">${a.plate}</span>` : ''}</td>
        <td class="sub">${a.station || ''}</td><td class="nowrap">${a.state === 'sent' ? '—' : fdt(a.send_at)}</td>
        <td><span class="badge" style=${`border-color:${ST[a.state][1]};color:${ST[a.state][1]}`}>${ST[a.state][0]}</span></td></tr>`)}</tbody></table></div>
      ${!data.rows.length ? html`<div class="empty">Ближайших визитов в терминарзе нет</div>` : ''}</div>
    ${data.sent.length ? html`<div class="card tight" style="margin-top:14px"><div class="row" style="padding:12px 14px"><h2 style="margin:0">Последние отправленные</h2></div>
      <table class="tbl"><tbody>${data.sent.map((m) => html`<tr><td class="nowrap sub">${fdt(m.created_at)}</td><td class="nowrap">${m.phone}</td><td style="white-space:pre-wrap">${m.text}</td>
        <td class="sub">${{ sent: 'отправлено', failed: 'ошибка', logged: 'без шлюза' }[m.status] || m.status}</td></tr>`)}</tbody></table></div>` : ''}`;
}

const CHANGES = [
  ['2026-09-28', ['Меню профиля справа вверху: мой аккаунт, настройки, интеграции, SMS, напоминания, тёмный/светлый режим, язык, настройки экрана', 'Слева — только то, что нужно в работе каждый день',
    'В выцене и заказе «Новый клиент» и «Новое авто» открывают полные формы; клиент и авто связываются автоматически', 'Формы клиента и авто как в Motowarsztat, карточки с вкладками',
    'CRM на четырёх языках: PL / EN / UA / RU', 'Фискальная касса Novitus (NoviAPI) через расширение 1.2', 'Рапорты с выгрузкой в CSV / Excel / печать, расчёт зарплаты механиков']],
  ['2026-09-27', ['KSeF 2.0 напрямую: номер KSeF, UPO, QR на фактуре', 'Шаблоны документов: фактура, Pro forma, корректа, протоколы, kosztorys, PZ/WZ, KP/KW', 'Электронная карта заказа с подписью клиента',
    'Продажи, несколько касс и переводы между ними', 'Расширение Chrome для поставщиков (Inter Cars и др.)', 'Поиск фирмы по NIP (Biała lista MF)']],
];
export function Changelog() {
  return html`<div class="page-head"><h1>История изменений</h1></div>
    <div class="stack">${CHANGES.map(([d, list]) => html`<div class="card"><h2>${d.split('-').reverse().join('.')}</h2>
      <ul class="changes">${list.map((x) => html`<li>${x}</li>`)}</ul></div>`)}</div>`;
}

// ── Тема и масштаб (сохраняются на этом компьютере) ─────────────────────────
const get = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
export function applyScreen() {
  const root = document.documentElement;
  root.dataset.theme = get('pc_theme', 'dark');
  root.style.zoom = get('pc_zoom', '1');
  root.classList.toggle('compact', get('pc_compact', '0') === '1');
  root.classList.toggle('side-mini', get('pc_side', 'full') === 'mini');
  const logo = root.dataset.theme === 'light' ? '/logo-dark.png' : '/logo.png';
  document.querySelectorAll('img[data-logo]').forEach((i) => { i.src = logo; });
}
export const isDark = () => get('pc_theme', 'dark') !== 'light';
export function setTheme(dark) { put('pc_theme', dark ? 'dark' : 'light'); applyScreen(); }

export function ScreenSettings({ onClose }) {
  const [s, setS] = useState({ zoom: get('pc_zoom', '1'), compact: get('pc_compact', '0') === '1', side: get('pc_side', 'full'), dark: isDark() });
  const upd = (patch) => {
    const n = { ...s, ...patch };
    setS(n);
    put('pc_zoom', n.zoom); put('pc_compact', n.compact ? '1' : '0'); put('pc_side', n.side); put('pc_theme', n.dark ? 'dark' : 'light');
    applyScreen();
  };
  return html`<${Modal} title="Настройки экрана" onClose=${onClose} foot=${html`<button class="btn primary" onClick=${onClose}>Готово</button>`}>
    <label class="f">Масштаб<div class="seg sel">${[['0.9', '90%'], ['1', '100%'], ['1.1', '110%'], ['1.25', '125%']].map(([v, l]) => html`<button type="button" class=${s.zoom === v ? 'on' : ''} onClick=${() => upd({ zoom: v })}>${l}</button>`)}</div></label>
    <label class="f">Левое меню<div class="seg sel">${[['full', 'С подписями'], ['mini', 'Только иконки']].map(([v, l]) => html`<button type="button" class=${s.side === v ? 'on' : ''} onClick=${() => upd({ side: v })}>${l}</button>`)}</div></label>
    <label class="toggle"><input type="checkbox" checked=${s.compact} onChange=${(e) => upd({ compact: e.target.checked })} /><i></i><span>Компактные таблицы (больше строк на экране)</span></label>
    <label class="toggle"><input type="checkbox" checked=${s.dark} onChange=${(e) => upd({ dark: e.target.checked })} /><i></i><span>Тёмный режим</span></label>
    <div class="muted small">Настройки сохраняются на этом компьютере.</div>
  </${Modal}>`;
}
