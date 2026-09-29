import { html, render, useState, useEffect, api, act, useRoute, go, AppCtx, Toasts, Icon, Modal, toast } from './lib.js';
import Dashboard from './pages/dashboard.js';
import { OrdersList, OrderPage, NewOrder } from './pages/orders.js';
import Calendar from './pages/calendar.js';
import { CustomersList, CustomerPage, CustomerNew } from './pages/customers.js';
import { CarsList, CarPage, CarNew } from './pages/cars.js';
import Stock from './pages/stock.js';
import Purchases from './pages/purchases.js';
import Storage from './pages/storage.js';
import Cash from './pages/cash.js';
import Sales from './pages/sales.js';
import Pos from './pages/pos.js';
import Finance from './pages/finance.js';
import Reports from './pages/reports.js';
import AuditPage from './pages/audit.js';
import Settings from './pages/settings.js';
import Marketing from './pages/marketing.js';
import Search from './pages/search.js';
import Sms from './pages/sms.js';
import { ClipPage } from './pages/suppliers.js';
import { initI18n, LangSwitch } from './i18n.js';
import { MyAccount, Reminders, Changelog, ScreenSettings, applyScreen, isDark, setTheme } from './pages/account.js';

const NAV = [
  { to: '/', icon: 'home', label: 'Главная' },
  { to: '/orders', icon: 'wrench', label: 'Заказы', perm: 'orders.view' },
  { to: '/quotes', icon: 'file', label: 'Выцены', perm: 'quotes.manage' },
  { to: '/calendar', icon: 'cal', label: 'Терминарз', badge: 'requests', perm: 'calendar.view' },
  { to: '/customers', icon: 'users', label: 'Клиенты', perm: 'clients.view' },
  { to: '/cars', icon: 'car', label: 'Автомобили', perm: 'cars.view' },
  { sep: true },
  { to: '/stock', icon: 'box', label: 'Склад', perm: 'products.view' },
  { to: '/purchases', icon: 'cart', label: 'Закупки', perm: 'purchases.view' },
  { to: '/storage', icon: 'tire', label: 'Хранение и парковка', perm: 'storage.view' },
  { to: '/sales', icon: 'file', label: 'Продажи', perm: 'invoices.create' },
  { to: '/cash', icon: 'cash', label: 'Касса', perm: 'cash.view' },
  { to: '/pos', icon: 'qr', label: 'Pulse Points', perm: 'loyalty.use' },
  { to: '/finance', icon: 'chart', label: 'Финансы', perm: 'reports.view' },
  { to: '/reports', icon: 'file', label: 'Рапорты', perm: 'reports.view' },
];
// Меню профиля справа вверху (как в Motowarsztat): настройки, интеграции, SMS и всё, что не нужно каждый день
const USER_MENU = [
  [{ to: '/account', icon: 'user', label: 'Мой аккаунт' },
    { to: '/settings/params', icon: 'gear', label: 'Настройки', perm: 'settings.manage' },
    { to: '/settings/integrations', icon: 'plug', label: 'Интеграции', perm: 'settings.manage' },
    { to: '/cash', icon: 'cash', label: 'Кассы (наличные, терминал, банк)', perm: 'settings.manage' },
    { to: '/stock/suppliers', icon: 'plug', label: 'Расширение Chrome и поставщики', perm: 'settings.manage' },
    { to: '/settings/staff', icon: 'team', label: 'Сотрудники и доступы', perm: 'settings.manage' },
    { to: '/audit', icon: 'history', label: 'Журнал изменений', perm: 'audit.view' },
    { to: '/sms', icon: 'chat', label: 'SMS', perm: 'sms.view' },
    { to: '/settings/messages', icon: 'mail', label: 'Шаблоны SMS и e-mail', perm: 'settings.manage' },
    { to: '/reminders', icon: 'bell', label: 'Запланированные напоминания', perm: 'sms.view' },
    { to: '/marketing', icon: 'megaphone', label: 'Маркетинг', perm: 'marketing.view' }],
  [{ to: '/changelog', icon: 'file', label: 'Что нового в CRM' }, { screen: true, icon: 'monitor', label: 'Настройки экрана' }],
];

// ── Остатки в шапке (как в Motowarsztat): поиск авто по номеру и SMS ─────────
function Balances({ app }) {
  const [b, setB] = useState(null);
  const [open, setOpen] = useState(false);
  const load = (force) => api('balances' + (force ? '?force=1' : '')).then(setB, () => {});
  useEffect(() => { load(); const t = setInterval(() => load(), 5 * 60 * 1000); return () => clearInterval(t); }, []);
  if (!b || (!b.sms && !b.plate)) return null;
  const val = (x) => (!x ? null : x.unlimited ? '∞' : x.unknown ? '?' : x.count);
  const low = (x, n) => x && !x.unlimited && !x.unknown && x.count <= n;
  return html`<div class="bal">
    ${b.plate && html`<button class=${'bal-chip' + (low(b.plate, 5) ? ' low' : '')} title="Сколько авто ещё можно найти по номеру" onClick=${() => setOpen(true)}><${Icon} n="carsearch" /><b>${val(b.plate)}</b></button>`}
    ${b.sms && html`<button class=${'bal-chip' + (low(b.sms, 20) ? ' low' : '')} title="Сколько SMS осталось" onClick=${() => setOpen(true)}><${Icon} n="chat" /><b>${val(b.sms)}</b></button>`}
    ${open && html`<${BalanceModal} app=${app} b=${b} onClose=${() => setOpen(false)} reload=${() => load(true)} />`}
  </div>`;
}
function BalanceModal({ app, b, onClose, reload }) {
  const admin = app.perms['settings.manage'];
  const [plate, setPlate] = useState(b.plate?.manual ? String(b.plate.count) : '');
  const [sms, setSms] = useState(b.sms?.manual ? String(b.sms.count) : '');
  const [price, setPrice] = useState(app.settings.sms_price || '0.17');
  const put = async (body, msg) => { await act(() => api('balances', { method: 'PUT', body }), msg); await reload(); };
  const since = (x) => (x?.since ? ` · с ${new Date(x.since.replace(' ', 'T') + 'Z').toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} использовано ${x.used}` : '');
  return html`<${Modal} title="Остатки: поиск по номеру и SMS" onClose=${onClose} foot=${html`<button class="btn" onClick=${reload}><${Icon} n="history" />Обновить</button><button class="btn primary" onClick=${onClose}>Готово</button>`}>
    <div class="bal-m">${b.plate && html`<div class="card" style="margin-bottom:12px"><div class="row"><${Icon} n="carsearch" /><b class="grow">Поиск авто по номеру (RegCheck)</b><b style="font-size:20px">${b.plate.unknown ? '—' : b.plate.count}</b></div>
      <div class="muted small" style="margin:6px 0">${b.plate.unknown ? `RegCheck не сообщает остаток по API. Впишите, сколько запросов сейчас на счету — CRM будет вычитать каждый поиск.${b.plate.used30 ? ` За 30 дней поисков: ${b.plate.used30}.` : ''}` : 'Остаток считает CRM: вписанное число минус поиски' + since(b.plate)}</div>
      ${admin && html`<div class="row"><label class="f grow">Сейчас запросов на счету<input type="number" min="0" value=${plate} onInput=${(e) => setPlate(e.target.value)} placeholder="например 100" /></label>
        <button class="btn" onClick=${() => put({ kind: 'plate', count: plate }, 'Сохранено')}>Сохранить</button></div>
        <div class="faint small">Купили пакет — впишите новое число. Пополнить: tablicarejestracyjnaapi.pl → личный кабинет.</div>`}</div>`}
    ${b.sms && html`<div class="card"><div class="row"><${Icon} n="chat" /><b class="grow">SMS (${b.sms.provider})</b><b style="font-size:20px">${b.sms.unlimited ? '∞' : b.sms.unknown ? '—' : b.sms.count}</b></div>
      <div class="muted small" style="margin:6px 0">${b.sms.unlimited ? b.sms.note : b.sms.note ? 'Остаток из кабинета SMS-сервиса: ' + b.sms.note : b.sms.manual ? 'Остаток считает CRM: вписанное число минус отправленные SMS' + since(b.sms) : 'Этот SMS-сервис не сообщает остаток по API — впишите, сколько SMS в пакете.'}</div>
      ${admin && b.sms.provider === 'smsapi' && html`<div class="row"><label class="f grow">Цена одного SMS в SMSAPI, pkt<input value=${price} onInput=${(e) => setPrice(e.target.value)} /></label><button class="btn" onClick=${() => put({ sms_price: price }, 'Сохранено')}>Сохранить</button></div>`}
      ${admin && !b.sms.unlimited && !b.sms.note && html`<div class="row"><label class="f grow">Сейчас SMS в пакете<input type="number" min="0" value=${sms} onInput=${(e) => setSms(e.target.value)} /></label><button class="btn" onClick=${() => put({ kind: 'sms', count: sms }, 'Сохранено')}>Сохранить</button></div>`}
    </div>`}</div>
  </${Modal}>`;
}

function UserMenu({ app }) {
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState(false);
  const [dark, setDark] = useState(isDark());
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!e.target.closest('.umenu')) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    setTimeout(() => addEventListener('click', close));
    addEventListener('keydown', esc);
    return () => { removeEventListener('click', close); removeEventListener('keydown', esc); };
  }, [open]);
  const item = (n) => n.screen
    ? html`<button class="um-item" onClick=${() => { setOpen(false); setScreen(true); }}><${Icon} n=${n.icon} />${n.label}</button>`
    : html`<a class="um-item" href=${'#' + n.to} onClick=${() => setOpen(false)}><${Icon} n=${n.icon} />${n.label}</a>`;
  const groups = USER_MENU.map((g) => g.filter((n) => !n.perm || app.perms?.[n.perm])).filter((g) => g.length);
  return html`<div class="umenu">
    <button class="um-btn" onClick=${() => setOpen(!open)} aria-haspopup="menu" aria-expanded=${open} title=${app.user.name}>
      <span class="um-name">${app.user.name}</span><${Icon} n="userc" /></button>
    ${open && html`<div class="um-drop" role="menu">
      <div class="um-head"><b>${app.user.name}</b><span class="muted small">${{ admin: 'Администратор', staff: 'Сотрудник', mechanic: 'Механик' }[app.user.role] || ''}</span></div>
      ${groups.map((g) => html`${g.map(item)}<div class="um-sep"></div>`)}
      <label class="um-item um-row"><${Icon} n="moon" /><span class="grow">Тёмный режим</span>
        <span class="toggle"><input type="checkbox" checked=${dark} onChange=${(e) => { setDark(e.target.checked); setTheme(e.target.checked); }} /><i></i></span></label>
      <div class="um-item um-row"><${Icon} n="globe" /><span class="grow">Язык</span><${LangSwitch} html=${html} compact /></div>
      <div class="um-sep"></div>
      <button class="um-item" onClick=${async () => { await api('logout', { body: {} }).catch(() => {}); location.reload(); }}><${Icon} n="logout" />Выйти</button>
    </div>`}
    ${screen && html`<${ScreenSettings} onClose=${() => { setScreen(false); setDark(isDark()); }} />`}
  </div>`;
}
const RANK = { mechanic: 1, staff: 2, admin: 3 };

function Login({ onDone }) {
  const [f, set] = useState({ login: '', password: '' });
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try { await api('login', { body: f }); onDone(); } catch (x) { setErr(x.message); }
  };
  return html`<div class="login"><form class="card" onSubmit=${submit}>
    <img data-logo src=${isDark() ? '/logo.png' : '/logo-dark.png'} alt="Pulsecar" />
    <h1 class="c">Панель сервиса</h1>
    <label class="f">Логин<input id="login" autocomplete="username" value=${f.login} onInput=${(e) => set({ ...f, login: e.target.value })} required /></label>
    <label class="f">Пароль<input id="password" type="password" autocomplete="current-password" value=${f.password} onInput=${(e) => set({ ...f, password: e.target.value })} required /></label>
    <button class="btn primary lg" type="submit">Войти</button>
    ${err && html`<div class="err">${err}</div>`}
    <div class="c" style="margin-top:12px"><${LangSwitch} html=${html} /></div>
  </form></div>`;
}

function Shell({ app }) {
  const route = useRoute();
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState('');
  const [requests, setRequests] = useState(0);
  const role = RANK[app.user.role] || 1;
  const [p0, p1] = route.parts;
  useEffect(() => setMenu(false), [route.path]);
  useEffect(() => {
    const load = () => api('appointments?from=2000-01-01&to=2000-01-01').then((r) => setRequests(r.unassigned.filter((a) => a.status === 'request').length), () => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [route.path]);

  let page;
  if (!p0) page = html`<${Dashboard} />`;
  else if (p0 === 'orders' || p0 === 'quotes') {
    const kind = p0 === 'quotes' ? 'quote' : 'order';
    page = p1 === 'new' ? html`<${NewOrder} kind=${kind} query=${route.query} />` : p1 ? html`<${OrderPage} id=${p1} key=${p1} />` : html`<${OrdersList} kind=${kind} query=${route.query} />`;
  } else if (p0 === 'calendar') page = html`<${Calendar} query=${route.query} />`;
  else if (p0 === 'customers') page = p1 === 'new' ? html`<${CustomerNew} />` : p1 ? html`<${CustomerPage} id=${p1} key=${p1 + (route.query.tab || '')} query=${route.query} />` : html`<${CustomersList} />`;
  else if (p0 === 'cars') page = p1 === 'new' ? html`<${CarNew} query=${route.query} key=${route.query.customer_id || 'new'} />` : p1 ? html`<${CarPage} id=${p1} key=${p1 + (route.query.tab || '')} query=${route.query} />` : html`<${CarsList} />`;
  else if (p0 === 'stock') page = html`<${Stock} sub=${p1} id=${route.parts[2]} />`;
  else if (p0 === 'purchases') page = html`<${Purchases} />`;
  else if (p0 === 'storage') page = html`<${Storage} />`;
  else if (p0 === 'cash') page = html`<${Cash} />`;
  else if (p0 === 'sales') page = html`<${Sales} />`;
  else if (p0 === 'pos') page = html`<${Pos} />`;
  else if (p0 === 'reports') page = html`<${Reports} query=${route.query} />`;
  else if (p0 === 'finance') page = html`<${Finance} />`;
  else if (p0 === 'settings') page = html`<${Settings} sub=${p1} />`;
  else if (p0 === 'sms') page = html`<${Sms} />`;
  else if (p0 === 'suppliers' && p1 === 'clip') page = html`<${ClipPage} />`;
  else if (p0 === 'marketing') page = html`<${Marketing} />`;
  else if (p0 === 'audit') page = html`<${AuditPage} query=${route.query} key=${JSON.stringify(route.query)} />`;
  else if (p0 === 'account') page = html`<${MyAccount} />`;
  else if (p0 === 'reminders') page = html`<${Reminders} />`;
  else if (p0 === 'changelog') page = html`<${Changelog} />`;
  else if (p0 === 'search') page = html`<${Search} q=${route.query.q || ''} key=${route.query.q} />`;
  else page = html`<div class="empty">Страница не найдена</div>`;

  const active = (to) => (to === '/' ? route.path === '/' : route.path.startsWith(to));
  return html`<div class="shell">
    <aside class=${'side' + (menu ? ' open' : '')}>
      <a class="brand" href="#/" title="На главную" onClick=${() => setMenu(false)}><img data-logo src=${isDark() ? '/logo.png' : '/logo-dark.png'} alt="Pulsecar — на главную" /></a>
      ${NAV.filter((n) => n.sep || !n.perm || app.perms?.[n.perm]).map((n, i) => n.sep ? html`<div class="nav-sep" key=${'s' + i}></div>` : html`
        <a class=${'nav-item' + (active(n.to) ? ' on' : '')} href=${'#' + n.to} key=${n.to} title=${n.label}>
          <${Icon} n=${n.icon} /><span class="nl">${n.label}</span>${n.badge && requests ? html`<span class="count">${requests}</span>` : ''}</a>`)}
      <div class="nav-foot">${app.settings.company_brand || 'Pulsecar'}</div>
    </aside>
    <div class="main">
      <div class="top">
        <button class="icon-btn burger" onClick=${() => setMenu(!menu)} aria-label="Меню"><${Icon} n="menu" /></button>
        <form class="search" onSubmit=${(e) => { e.preventDefault(); if (q.trim()) go('/search?q=' + encodeURIComponent(q.trim())); }}>
          <input type="search" placeholder="Поиск: клиент, телефон, номер авто, VIN, заказ…" value=${q} onInput=${(e) => setQ(e.target.value)} aria-label="Поиск" />
        </form>
        <a class="btn primary" href="#/orders/new"><${Icon} n="plus" />Заказ</a>
        <${Balances} app=${app} />
        <${UserMenu} app=${app} />
      </div>
      <main class="content">${page}</main>
    </div>
    ${menu && html`<div style="position:fixed;inset:0;z-index:80" onClick=${() => setMenu(false)}></div>`}
  </div>`;
}

function Root() {
  const [app, setApp] = useState(undefined);
  const load = () => api('me').then((me) => setApp({ ...me, reload: load }), () => setApp(null));
  useEffect(() => {
    load();
    const out = () => setApp(null);
    addEventListener('pc-logout', out);
    return () => removeEventListener('pc-logout', out);
  }, []);
  if (app === undefined) return html`<div class="empty">Загрузка…</div>`;
  return html`<${AppCtx.Provider} value=${app}>
    ${app ? html`<${Shell} app=${app} />` : html`<${Login} onDone=${load} />`}
    <${Toasts} />
  </${AppCtx.Provider}>`;
}

applyScreen();
initI18n().finally(() => render(html`<${Root} />`, document.getElementById('root')));
window.addEventListener('unhandledrejection', (e) => { if (e.reason?.message) console.warn(e.reason.message); });
export { toast };
