import { html, render, useState, useEffect, api, useRoute, go, AppCtx, Toasts, Icon, toast } from './lib.js';
import Dashboard from './pages/dashboard.js';
import { OrdersList, OrderPage, NewOrder } from './pages/orders.js';
import Calendar from './pages/calendar.js';
import { CustomersList, CustomerPage } from './pages/customers.js';
import { CarsList, CarPage } from './pages/cars.js';
import Stock from './pages/stock.js';
import Purchases from './pages/purchases.js';
import Storage from './pages/storage.js';
import Cash from './pages/cash.js';
import Sales from './pages/sales.js';
import Pos from './pages/pos.js';
import Finance from './pages/finance.js';
import Reports from './pages/reports.js';
import Settings from './pages/settings.js';
import Marketing from './pages/marketing.js';
import Search from './pages/search.js';
import Sms from './pages/sms.js';
import { ClipPage } from './pages/suppliers.js';

const NAV = [
  { to: '/', icon: 'home', label: 'Главная' },
  { to: '/orders', icon: 'wrench', label: 'Заказы', perm: 'orders.view' },
  { to: '/quotes', icon: 'file', label: 'Выцены', perm: 'quotes.manage' },
  { to: '/calendar', icon: 'cal', label: 'Терминарз', badge: 'requests', perm: 'calendar.view' },
  { to: '/customers', icon: 'users', label: 'Клиенты', perm: 'clients.view' },
  { to: '/cars', icon: 'car', label: 'Автомобили', perm: 'cars.view' },
  { to: '/sms', icon: 'chat', label: 'SMS', perm: 'sms.view' },
  { sep: true },
  { to: '/stock', icon: 'box', label: 'Склад', perm: 'products.view' },
  { to: '/purchases', icon: 'cart', label: 'Закупки', perm: 'purchases.view' },
  { to: '/storage', icon: 'tire', label: 'Хранение шин', perm: 'storage.view' },
  { to: '/sales', icon: 'file', label: 'Продажи', perm: 'invoices.create' },
  { to: '/cash', icon: 'cash', label: 'Касса', perm: 'cash.view' },
  { to: '/pos', icon: 'qr', label: 'Pulse Points', perm: 'loyalty.use' },
  { to: '/finance', icon: 'chart', label: 'Финансы', perm: 'reports.view' },
  { to: '/reports', icon: 'file', label: 'Рапорты', perm: 'reports.view' },
  { sep: true },
  { to: '/marketing', icon: 'megaphone', label: 'Маркетинг', perm: 'marketing.view' },
  { to: '/settings', icon: 'gear', label: 'Настройки', perm: 'settings.manage' },
];
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
    <img src="/logo.png" alt="Pulsecar" />
    <h1 class="c">Панель сервиса</h1>
    <label class="f">Логин<input id="login" autocomplete="username" value=${f.login} onInput=${(e) => set({ ...f, login: e.target.value })} required /></label>
    <label class="f">Пароль<input id="password" type="password" autocomplete="current-password" value=${f.password} onInput=${(e) => set({ ...f, password: e.target.value })} required /></label>
    <button class="btn primary lg" type="submit">Войти</button>
    ${err && html`<div class="err">${err}</div>`}
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
  else if (p0 === 'customers') page = p1 ? html`<${CustomerPage} id=${p1} key=${p1} />` : html`<${CustomersList} />`;
  else if (p0 === 'cars') page = p1 ? html`<${CarPage} id=${p1} key=${p1} />` : html`<${CarsList} />`;
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
  else if (p0 === 'search') page = html`<${Search} q=${route.query.q || ''} key=${route.query.q} />`;
  else page = html`<div class="empty">Страница не найдена</div>`;

  const active = (to) => (to === '/' ? route.path === '/' : route.path.startsWith(to));
  return html`<div class="shell">
    <aside class=${'side' + (menu ? ' open' : '')}>
      <div class="brand"><img src="/logo.png" alt="Pulsecar" /></div>
      ${NAV.filter((n) => n.sep || !n.perm || app.perms?.[n.perm]).map((n, i) => n.sep ? html`<div class="nav-sep" key=${'s' + i}></div>` : html`
        <a class=${'nav-item' + (active(n.to) ? ' on' : '')} href=${'#' + n.to} key=${n.to}>
          <${Icon} n=${n.icon} />${n.label}${n.badge && requests ? html`<span class="count">${requests}</span>` : ''}</a>`)}
      <div class="nav-foot">${app.settings.company_brand || 'Pulsecar'} · ${app.user.name}</div>
    </aside>
    <div class="main">
      <div class="top">
        <button class="icon-btn burger" onClick=${() => setMenu(!menu)} aria-label="Меню"><${Icon} n="menu" /></button>
        <form class="search" onSubmit=${(e) => { e.preventDefault(); if (q.trim()) go('/search?q=' + encodeURIComponent(q.trim())); }}>
          <input type="search" placeholder="Поиск: клиент, телефон, номер авто, VIN, заказ…" value=${q} onInput=${(e) => setQ(e.target.value)} aria-label="Поиск" />
        </form>
        <a class="btn primary" href="#/orders/new"><${Icon} n="plus" />Заказ</a>
        <div class="user"><span>${app.user.name}</span>
          <button class="icon-btn" title="Выйти" aria-label="Выйти" onClick=${async () => { await api('logout', { body: {} }).catch(() => {}); location.reload(); }}><${Icon} n="logout" /></button></div>
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

render(html`<${Root} />`, document.getElementById('root'));
window.addEventListener('unhandledrejection', (e) => { if (e.reason?.message) console.warn(e.reason.message); });
export { toast };
