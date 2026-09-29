// Общие функции и компоненты панели (Preact + htm, без сборки)
import { html, render, useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } from '/vendor/preact-htm.js';
export { html, render, useState, useEffect, useRef, useMemo, useCallback, createContext, useContext };

// ── API ─────────────────────────────────────────────────────────────────────
export async function api(path, { method, body, form } = {}) {
  const r = await fetch('/crm-api/' + path.replace(/^\//, ''), {
    method: method || (body || form ? 'POST' : 'GET'),
    headers: form ? {} : { 'Content-Type': 'application/json' },
    body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    credentials: 'same-origin',
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.includes('login')) window.dispatchEvent(new Event('pc-logout'));
  if (!r.ok) throw new Error(j.error || 'Ошибка ' + r.status);
  return j;
}
export const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

/** Загрузка данных с перезапросом при изменении зависимостей */
export function useData(path, deps = []) {
  const [state, set] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!path) { set({ data: null, loading: false, error: null }); return; }
    set((s) => ({ ...s, loading: true }));
    api(path).then((data) => alive && set({ data, loading: false, error: null }), (e) => alive && set({ data: null, loading: false, error: e.message }));
    return () => { alive = false; };
  }, [path, tick, ...deps]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

// ── Маршрутизация по #/путь ────────────────────────────────────────────────
export function useRoute() {
  const parse = () => {
    const h = location.hash.replace(/^#/, '') || '/';
    const [p, q] = h.split('?');
    return { path: p, parts: p.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(q || '')) };
  };
  const [r, set] = useState(parse);
  useEffect(() => {
    const on = () => set(parse());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}
export const go = (path) => { location.hash = '#' + path; };

// ── Контекст приложения (пользователь, справочники) ──────────────────────────
export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// ── Форматирование ─────────────────────────────────────────────────────────
export const zl = (n) => `${(Number(n) || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
export const num = (n, d = 0) => (Number(n) || 0).toLocaleString('pl-PL', { maximumFractionDigits: d });
export const fdate = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
export const fdt = (s) => (s ? `${fdate(s)} ${s.slice(11, 16)}` : '');
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const carName = (k) => (k ? [k.make, k.model].filter(Boolean).join(' ') || k.plate || k.vin || '—' : '—');
export const METHOD = { cash: 'Наличные', card: 'Карта', blik: 'BLIK', transfer: 'Перевод', mixed: 'Смешанная оплата', points: 'Баллы' };
/** Способы, которыми принимаем деньги (платёж). «Смешанная» — это несколько платежей разными способами */
export const PAY_KINDS = ['cash', 'card', 'blik', 'transfer'];

// ── Тосты ──────────────────────────────────────────────────────────────────
let pushToast = () => {};
export const toast = (msg, type = 'ok') => pushToast({ msg, type, id: Math.random() });
export function Toasts() {
  const [list, set] = useState([]);
  pushToast = (t) => { set((l) => [...l, t]); setTimeout(() => set((l) => l.filter((x) => x.id !== t.id)), t.type === 'error' ? 6000 : 3000); };
  return html`<div class="toasts" role="status">${list.map((t) => html`<div class=${'toast ' + t.type} key=${t.id}>${t.msg}</div>`)}</div>`;
}
/** Выполнить действие с тостом ошибки */
export async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, 'error'); throw e; }
}

// ── Иконки (контурные, 24×24) ──────────────────────────────────────────────
const P = {
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  userc: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 13a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM6.2 19a7 7 0 0 1 11.6 0',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  team: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM1 21a8 8 0 0 1 16 0M17 3.1a4 4 0 0 1 0 7.8M23 21a8 8 0 0 0-5-7.4',
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7V21h3.3l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  car: 'M5 11l1.5-4a2 2 0 0 1 1.9-1.3h7.2a2 2 0 0 1 1.9 1.3L19 11M4 11h16a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1zM6.5 14.2h2M15.5 14.2h2M5.5 17.5v1.8M18.5 17.5v1.8',
  carsearch: 'M4 9.5l1.3-3.4A1.8 1.8 0 0 1 7 5h6.4a1.8 1.8 0 0 1 1.7 1.1l1.3 3.4M3 9.5h14.5a1 1 0 0 1 1 1v.8M3 9.5a1 1 0 0 0-1 1v4.2a1 1 0 0 0 1 1h8.3M4.6 12.4h1.8M10 12.4h1.8M3.8 15.7v1.8M17.3 20.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM19.9 19.2l2.4 2.4',
  box: 'M21 8l-9-5-9 5 9 5zM3 8v8l9 5 9-5V8M12 13v8',
  cart: 'M3 4h2l2.4 11h10.2L20 7H6.2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  tire: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  cash: 'M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v.01M18 14v.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z',
  arrows: 'M7 7h13l-4-4M17 17H4l4 4',
  download: 'M12 3v12m0 0l-5-5m5 5l5-5M4 21h16',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  menu: 'M3 6h18M3 12h18M3 18h18',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  check: 'M5 12l5 5 9-10',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM8 11h.01M12 11h.01M16 11h.01',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  play: 'M8 5.5v13l10-6.5z',
  grip: 'M4 8h16M4 12h16M4 16h16',
  camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  down: 'M6 9l6 6 6-6',
};
export const Icon = ({ n }) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${P[n] || ''} /></svg>`;

// ── Компоненты ─────────────────────────────────────────────────────────────
export function Badge({ color, children }) {
  const c = color || '#9A9CA3';
  return html`<span class="badge" style=${`background:${c}22;color:${light(c) ? c : '#f2f2f2'};border-color:${c}55`}><span class="dot" style=${`background:${c}`}></span>${children}</span>`;
}
function light(hex) {
  const h = hex.replace('#', '');
  if (h.length < 6) return true;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return r * 0.3 + g * 0.59 + b * 0.11 > 70;
}

export function Modal({ title, onClose, children, foot, wide, xl }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  return html`<div class="modal-bg" onMouseDown=${(e) => e.target === e.currentTarget && onClose?.()}>
    <div class=${'modal' + (xl ? ' xl' : wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="modal-head"><h2>${title}</h2><button class="icon-btn" onClick=${onClose} aria-label="Закрыть"><${Icon} n="x" /></button></div>
      <div class="modal-body">${children}</div>
      ${foot && html`<div class="modal-foot">${foot}</div>`}
    </div></div>`;
}

export function Field({ label, children, style }) {
  return html`<label class="f" style=${style}>${label}${children}</label>`;
}

/** Поле ввода, связанное с объектом формы */
export function Input({ form, set, k, type = 'text', ...rest }) {
  const v = form[k] ?? '';
  return html`<input type=${type} value=${v} onInput=${(e) => set({ ...form, [k]: type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })} ...${rest} />`;
}

export function Pager({ page, total, size, onPage }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return html`<div class="pager">${num(total)} записей</div>`;
  return html`<div class="pager">
    <span>${num(page * size + 1)}–${num(Math.min(total, (page + 1) * size))} из ${num(total)}</span>
    <button class="btn sm" disabled=${page <= 0} onClick=${() => onPage(page - 1)}><${Icon} n="left" /></button>
    <span>${page + 1} / ${pages}</span>
    <button class="btn sm" disabled=${page >= pages - 1} onClick=${() => onPage(page + 1)}><${Icon} n="right" /></button></div>`;
}

export function useDebounced(value, ms = 300) {
  const [v, set] = useState(value);
  useEffect(() => { const t = setTimeout(() => set(value), ms); return () => clearTimeout(t); }, [value]);
  return v;
}

export function SearchBox({ value, onInput, placeholder = 'Поиск…', autofocus }) {
  return html`<div class="ac" style="min-width:220px;flex:1;max-width:420px">
    <input type="search" placeholder=${placeholder} value=${value} onInput=${(e) => onInput(e.target.value)} autofocus=${autofocus} aria-label=${placeholder} /></div>`;
}

/** Автодополнение с запросом к API */
export function Picker({ path, placeholder, render: renderItem, onPick, initial = '', extra }) {
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const dq = useDebounced(q, 250);
  useEffect(() => {
    if (!open) return;
    api(path(dq)).then((r) => setItems(Array.isArray(r) ? r : r.rows || []), () => setItems([]));
  }, [dq, open]);
  return html`<div class="ac">
    <input value=${q} placeholder=${placeholder} onFocus=${() => setOpen(true)} onBlur=${() => setTimeout(() => setOpen(false), 180)}
      onInput=${(e) => { setQ(e.target.value); setOpen(true); }} />
    ${open && html`<div class="ac-list">
      ${items.slice(0, 30).map((it) => html`<div class="ac-item" onMouseDown=${(e) => { e.preventDefault(); onPick(it); setQ(''); setOpen(false); }}>${renderItem(it)}</div>`)}
      ${!items.length && html`<div class="ac-item muted">Ничего не найдено</div>`}
      ${extra && html`<div class="ac-item" onMouseDown=${(e) => { e.preventDefault(); extra.onClick(q); setQ(''); setOpen(false); }}><b class="pos">+ ${extra.label}${q ? ` «${q}»` : ''}</b></div>`}
    </div>`}
  </div>`;
}

export const Loading = () => html`<div class="empty">Загрузка…</div>`;
export const ErrorBox = ({ error }) => html`<div class="card err">${error}</div>`;

/** Кнопка подтверждения в два нажатия (браузерные confirm() не используем) */
export function ConfirmButton({ children, onConfirm, cls = 'btn danger sm', label = 'Точно?' }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (armed) { const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); } }, [armed]);
  return html`<button class=${cls} onClick=${() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>${armed ? label : children}</button>`;
}
