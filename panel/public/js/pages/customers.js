// Клиенты как в Motowarsztat: карточка с вкладками (Данные клиента, Автомобили, Заказы, Выцены, Продажи, Хранение, SMS),
// форма «Osoba prywatna / Firma»: слева контакты и адрес, справа авто по умолчанию, оплата, скидки, описание, согласие.
import {
  html, useState, useEffect, useData, api, act, go, qs, useApp, Loading, ErrorBox, Badge, Icon, Modal, Pager, useDebounced,
  zl, num, fdate, fdt, carName, toast,
} from '../lib.js';

export const COUNTRIES = [['PL', '🇵🇱', 'Польша'], ['UA', '🇺🇦', 'Украина'], ['DE', '🇩🇪', 'Германия'], ['LT', '🇱🇹', 'Литва'], ['CZ', '🇨🇿', 'Чехия'], ['SK', '🇸🇰', 'Словакия'],
  ['BY', '🇧🇾', 'Беларусь'], ['GB', '🇬🇧', 'Великобритания'], ['NL', '🇳🇱', 'Нидерланды'], ['FR', '🇫🇷', 'Франция'], ['IT', '🇮🇹', 'Италия'], ['ES', '🇪🇸', 'Испания']];
const PREFIXES = ['+48', '+380', '+49', '+370', '+420', '+421', '+375', '+44', '+31', '+33', '+39', '+34', '+1'];
export const PAY_METHODS = [['cash', 'Наличные'], ['card', 'Карта'], ['transfer', 'Перевод']];
export const PAY_TERMS = [[0, 'Сразу'], [3, '3 дня'], [7, '7 дней'], [14, '14 дней'], [21, '21 день'], [30, '30 дней'], [45, '45 дней'], [60, '60 дней']];

export function CustomersList() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const dq = useDebounced(q);
  useEffect(() => setPage(0), [dq]);
  const { data, loading, error } = useData('customers?' + qs({ q: dq, page }));
  return html`
    <div class="page-head"><h1>Клиенты</h1><span class="muted">${data ? num(data.total) : ''}</span>
      <div class="actions"><a class="btn primary" href="#/customers/new"><${Icon} n="plus" />Новый клиент</a></div></div>
    <div class="card" style="margin-bottom:12px"><input type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Имя, телефон, номер авто, VIN, NIP, e-mail, карта PC…" aria-label="Поиск клиентов" /></div>
    ${error ? html`<${ErrorBox} error=${error} />` : html`<div class="card tight"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Данные клиента</th><th>NIP</th><th>Телефон</th><th>E-mail</th><th>Адрес</th><th>Авто</th><th class="r">Заказов</th><th>Приложение</th><th>Согласие</th></tr></thead>
      <tbody>${(data?.rows || []).map((c) => html`<tr class="click" onClick=${() => go('/customers/' + c.id)}>
        <td><b>${c.kind === 'company' && c.company ? c.company : c.name || '—'}</b>${c.kind === 'company' && c.company && c.name && c.name !== c.company ? html`<div class="sub">${c.name}</div>` : ''}</td>
        <td class="nowrap sub">${c.nip || ''}</td><td class="nowrap">${c.phone || ''}</td><td class="sub">${c.email || ''}</td>
        <td class="sub">${[c.street, [c.postcode, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</td>
        <td class="sub">${c.cars || ''}</td><td class="r">${c.orders_count || ''}</td>
        <td>${c.registered_at ? html`<span class="pos">✓ ${num(c.points)}</span>` : html`<span class="faint">—</span>`}</td>
        <td>${c.marketing_consent ? html`<span class="pos">✓</span>` : html`<span class="faint">—</span>`}</td></tr>`)}</tbody></table></div>
      ${!loading && !data?.rows?.length ? html`<div class="empty">Никого не нашли</div>` : ''}
      ${data && html`<${Pager} page=${page} total=${data.total} size=${data.pageSize} onPage=${setPage} />`}</div>`}`;
}

/** Телефон «+48600111222» → ['+48', '600111222'] */
function splitPhone(p) {
  const s = String(p || '').replace(/\s+/g, '');
  const pre = PREFIXES.slice().sort((a, b) => b.length - a.length).find((x) => s.startsWith(x));
  return pre ? [pre, s.slice(pre.length)] : ['+48', s.replace(/^\+/, '')];
}
function initial(c) {
  let first = c.first_name || '', last = c.last_name || '';
  if (!first && !last && c.name && c.name !== c.company) { const w = c.name.trim().split(/\s+/); first = w.shift() || ''; last = w.join(' '); }
  const [prefix, phone] = splitPhone(c.phone);
  return {
    kind: c.kind || (c.company || c.nip ? 'company' : 'person'), company: c.company || '', nip: c.nip || '', first_name: first, last_name: last,
    postcode: c.postcode || '', city: c.city || '', country: c.country || 'PL', street: c.street || '', prefix, phone, email: c.email || '',
    default_car_id: c.default_car_id || '', payment_method: c.payment_method || '', payment_term_days: c.payment_term_days ?? '',
    discount_labor: c.discount_labor || 0, discount_parts: c.discount_parts || 0, notes: c.notes || '', marketing_consent: c.marketing_consent ?? 1,
  };
}

/** Форма клиента как «Dane klienta» в Motowarsztat */
export function CustomerEditor({ c = {}, cars = [], onSaved, onCancel }) {
  const [f, setF] = useState(() => initial(c));
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((v) => ({ ...v, ...patch }));
  const company = f.kind === 'company';
  const findNip = async () => {
    const r = await act(() => api('nip/' + encodeURIComponent(f.nip)));
    set({ company: r.name, street: r.street || f.street, postcode: r.postcode || f.postcode, city: r.city || f.city, nip: r.nip, country: 'PL' });
    toast(`${r.name} · VAT: ${r.statusVat}`);
  };
  const save = async (e) => {
    e?.preventDefault();
    if (company && !f.company.trim()) return toast('Впишите название фирмы', 'error');
    if (!company && !f.first_name.trim() && !f.last_name.trim() && !f.phone.trim()) return toast('Впишите имя или телефон', 'error');
    const { prefix, phone, ...rest } = f;
    const body = { ...rest, phone: phone.trim() ? prefix + phone.replace(/\D/g, '') : '', company: company ? f.company : '', nip: company ? f.nip : '',
      default_car_id: f.default_car_id ? Number(f.default_car_id) : '', payment_term_days: f.payment_term_days === '' ? '' : Number(f.payment_term_days) };
    setBusy(true);
    try {
      const r = await act(() => (c.id ? api('customers/' + c.id, { method: 'PUT', body }) : api('customers', { body })), 'Сохранено');
      onSaved?.(c.id || r.id);
    } catch {} finally { setBusy(false); }
  };
  const inp = (k, l, attrs = {}) => html`<label class="f">${l}<input value=${f[k]} placeholder=${l} onInput=${(e) => set({ [k]: e.target.value })} ...${attrs} /></label>`;
  return html`<form class="mwf" onSubmit=${save}>
    <div class="mwf-kind"><div class="seg">
      <button type="button" class=${!company ? 'on' : ''} onClick=${() => set({ kind: 'person' })}>Частное лицо</button>
      <button type="button" class=${company ? 'on' : ''} onClick=${() => set({ kind: 'company' })}>Фирма</button></div></div>
    <div class="mwf-cols">
      <div class="mwf-col">
        ${company && html`<div class="g2">${inp('company', 'Название фирмы', { required: true })}
          <label class="f">NIP<div class="ig"><input value=${f.nip} placeholder="NIP фирмы" inputmode="numeric" onInput=${(e) => set({ nip: e.target.value })} />
            <button type="button" class="addon btn" title="Найти фирму по NIP (Biała lista MF)" disabled=${f.nip.replace(/\D/g, '').length !== 10} onClick=${findNip}><${Icon} n="search" /></button></div></label></div>`}
        <div class="g2">${inp('first_name', 'Имя', { autocomplete: 'off' })}${inp('last_name', 'Фамилия', { autocomplete: 'off' })}</div>
        <div class="g3">${inp('postcode', 'Индекс')}${inp('city', 'Город')}
          <label class="f">Страна<select value=${f.country} onChange=${(e) => set({ country: e.target.value })}>
            ${COUNTRIES.map(([k, flag, n]) => html`<option value=${k}>${flag} ${n}</option>`)}${!COUNTRIES.some(([k]) => k === f.country) && html`<option value=${f.country}>${f.country}</option>`}</select></label></div>
        ${inp('street', 'Улица')}
        <div class="g2">
          <label class="f">Номер телефона<div class="ig"><select class="addon" value=${f.prefix} onChange=${(e) => set({ prefix: e.target.value })}>${PREFIXES.map((p) => html`<option value=${p}>${p}</option>`)}</select>
            <input type="tel" value=${f.phone} placeholder="Номер телефона" onInput=${(e) => set({ phone: e.target.value })} /></div></label>
          <label class="f">E-mail<div class="ig"><span class="addon">@</span><input type="email" value=${f.email} placeholder="E-mail" onInput=${(e) => set({ email: e.target.value })} /></div></label></div>
      </div>
      <div class="mwf-col">
        <div class="g2">
          <label class="f">Авто по умолчанию<select value=${f.default_car_id} disabled=${!cars.length} onChange=${(e) => set({ default_car_id: e.target.value })}>
            <option value="">${cars.length ? '—' : c.id ? 'У клиента нет авто' : 'Добавьте авто после сохранения'}</option>${cars.map((k) => html`<option value=${k.id}>${[k.plate, carName(k)].filter(Boolean).join(' · ')}</option>`)}</select></label>
          <label class="f">Способ оплаты<select value=${f.payment_method} onChange=${(e) => set({ payment_method: e.target.value })}>
            <option value="">Выберите…</option>${PAY_METHODS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label></div>
        <div class="g2"><label class="f">Срок оплаты<select value=${String(f.payment_term_days)} onChange=${(e) => set({ payment_term_days: e.target.value })}>
            <option value="">Как в настройках</option>${PAY_TERMS.map(([k, l]) => html`<option value=${String(k)}>${l}</option>`)}</select></label><div></div></div>
        <div class="g2">
          <label class="f">% скидки на работы<div class="ig"><input type="number" min="0" max="100" step="0.5" class="r" value=${f.discount_labor} onInput=${(e) => set({ discount_labor: Number(e.target.value) })} /><span class="addon">% на работы</span></div></label>
          <label class="f">% скидки на товары<div class="ig"><input type="number" min="0" max="100" step="0.5" class="r" value=${f.discount_parts} onInput=${(e) => set({ discount_parts: Number(e.target.value) })} /><span class="addon">% на товары</span></div></label></div>
        <label class="f">Описание клиента<textarea rows="4" value=${f.notes} placeholder="Описание клиента" onInput=${(e) => set({ notes: e.target.value })}></textarea></label>
        <label class="toggle mwf-consent"><span>Согласие на маркетинговые сообщения</span><input type="checkbox" checked=${!!f.marketing_consent} onChange=${(e) => set({ marketing_consent: e.target.checked ? 1 : 0 })} /><i></i></label>
        <div class="mwf-foot">${onCancel && html`<button type="button" class="btn" onClick=${onCancel}>Отмена</button>`}<button class="btn primary" disabled=${busy}>${busy ? 'Сохраняю…' : 'Сохранить'}</button></div>
      </div>
    </div>
  </form>`;
}

const TABS = [['data', 'Данные клиента'], ['cars', 'Автомобили'], ['orders', 'Заказы'], ['quotes', 'Выцены'], ['sales', 'Продажи'], ['storage', 'Хранение'], ['sms', 'История SMS'], ['points', 'Pulse Points']];

export function CustomerNew() {
  return html`<div class="crumbs"><a href="#/customers">Клиенты</a></div>
    <div class="page-head"><h1>Новый клиент</h1></div>
    <div class="card"><div class="pill-tabs mwf-tabs">${TABS.map(([k, l], i) => html`<button class=${i === 0 ? 'on' : ''} disabled=${i > 0}>${l}</button>`)}</div>
      <${CustomerEditor} onSaved=${(id) => go('/customers/' + id)} onCancel=${() => history.back()} /></div>`;
}

const DOC = { vat: 'Фактура VAT', proforma: 'Pro forma', correction: 'Корректа' };

export function CustomerPage({ id, query = {} }) {
  const app = useApp();
  const { data: c, loading, error, reload } = useData('customers/' + id);
  const [tab, setTab] = useState(query.tab || 'data');
  const [adj, setAdj] = useState(null);
  if (loading && !c) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} />`;
  const orders = c.orders.filter((o) => o.kind === 'order'), quotes = c.orders.filter((o) => o.kind === 'quote');
  const spent = orders.reduce((s, o) => s + o.total, 0);
  const title = c.kind === 'company' && c.company ? c.company : c.name || c.phone || 'Клиент';
  const count = { cars: c.cars.length, orders: orders.length, quotes: quotes.length, sales: c.sales.length + c.receipts.length, storage: c.storage.length, sms: c.sms.length };
  const orderTable = (list) => list.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Номер</th><th>Дата</th><th>Статус</th><th>Авто</th><th class="r">Сумма</th><th class="r">Оплачено</th></tr></thead>
    <tbody>${list.map((o) => html`<tr class="click" onClick=${() => go((o.kind === 'quote' ? '/quotes/' : '/orders/') + o.id)}>
      <td><b>${o.number}</b></td><td class="nowrap">${fdate(o.created_at)}</td>
      <td><${Badge} color=${o.status_color}>${o.status_name}</${Badge}></td><td>${carName(o)} ${o.plate ? html`<span class="plate">${o.plate}</span>` : ''}</td>
      <td class="r nowrap">${zl(o.total)}</td><td class="r nowrap">${o.paid ? zl(o.paid) : '—'}</td></tr>`)}</tbody></table></div>` : html`<div class="empty">Пусто</div>`;
  return html`
    <div class="crumbs"><a href="#/customers">Клиенты</a></div>
    <div class="page-head"><h1>${title}</h1>${c.kind === 'company' ? html`<span class="chip">фирма${c.nip ? ' · NIP ' + c.nip : ''}</span>` : ''}
      ${c.registered_at ? html`<span class="badge" style="background:var(--accent);color:#000">в приложении</span>` : ''}
      <div class="actions">
        <a class="btn" href=${`#/quotes/new?customer_id=${c.id}`}><${Icon} n="file" />Выцена</a>
        <a class="btn primary" href=${`#/orders/new?customer_id=${c.id}${c.default_car_id ? '&car_id=' + c.default_car_id : ''}`}><${Icon} n="plus" />Заказ</a></div></div>
    <div class="grid g4" style="margin-bottom:14px">
      <div class="stat"><b>${c.phone ? html`<a href=${'tel:' + c.phone}>${c.phone}</a>` : '—'}</b><span>${c.email || 'без e-mail'}</span></div>
      <div class="stat"><b>${zl(spent)}</b><span>Всего за ${orders.length} заказов</span></div>
      <div class="stat accent"><b>${num(c.loyalty.balance)}</b><span>Pulse Points · ${c.loyalty.tier.name} · карта ${c.card_no}</span></div>
      <div class="stat"><b>${c.discount_labor || 0}% / ${c.discount_parts || 0}%</b><span>Скидка работы / товары</span></div>
    </div>
    <div class="card">
      <div class="pill-tabs mwf-tabs">${TABS.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}${count[k] ? html` <span class="faint">${count[k]}</span>` : ''}</button>`)}</div>
      ${tab === 'data' && html`<${CustomerEditor} key=${c.id} c=${c} cars=${c.cars} onSaved=${reload} />`}
      ${tab === 'cars' && html`<div class="row" style="margin-bottom:10px"><a class="btn sm primary" style="margin-left:auto" href=${'#/cars/new?customer_id=' + c.id}><${Icon} n="plus" />Добавить авто</a></div>
        ${c.cars.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Марка / модель</th><th>Номер</th><th>VIN</th><th class="r">Год</th><th class="r">Пробег</th><th></th></tr></thead><tbody>${c.cars.map((k) => html`<tr class="click" onClick=${() => go('/cars/' + k.id)}>
          <td><b>${carName(k)}</b></td><td>${k.plate ? html`<span class="plate">${k.plate}</span>` : ''}</td><td class="sub">${k.vin || ''}</td><td class="r">${k.year || ''}</td>
          <td class="r sub">${k.last_mileage ? num(k.last_mileage) + ' ' + (k.mileage_unit || 'km') : ''}</td><td>${k.id === c.default_car_id ? html`<span class="chip">по умолчанию</span>` : ''}</td></tr>`)}</tbody></table></div>` : html`<div class="empty">Авто не добавлены</div>`}`}
      ${tab === 'orders' && orderTable(orders)}
      ${tab === 'quotes' && orderTable(quotes)}
      ${tab === 'sales' && (c.sales.length || c.receipts.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Документ</th><th>Дата</th><th>Заказ</th><th class="r">Брутто</th><th>Статус</th><th></th></tr></thead><tbody>
          ${c.sales.map((d) => html`<tr><td><b>${d.number}</b><div class="sub">${DOC[d.kind] || d.kind}</div></td><td class="nowrap">${fdate(d.issue_date)}</td>
            <td>${d.order_id ? html`<a href=${'#/orders/' + d.order_id}>${d.order_no}</a>` : ''}</td><td class="r nowrap">${zl(d.total_gross)}</td>
            <td class="sub">${d.ksef_number || (d.ksef_status ? 'KSeF: ' + d.ksef_status : '')}</td><td class="act"><a class="btn sm" target="_blank" rel="noopener" href=${'/crm-api/print/sale/' + d.id}>Открыть</a></td></tr>`)}
          ${c.receipts.map((r) => html`<tr><td><b>${r.number || '—'}</b><div class="sub">Чек (paragon)</div></td><td class="nowrap">${fdate(r.created_at)}</td>
            <td><a href=${'#/orders/' + r.order_id}>${r.order_no}</a></td><td class="r nowrap">${zl(r.total)}</td><td class="sub">${r.status}</td><td></td></tr>`)}
        </tbody></table></div>` : html`<div class="empty">Документов продажи нет</div>`)}
      ${tab === 'storage' && (c.storage.length ? html`<table class="tbl"><tbody>${c.storage.map((s) => html`<tr>
          <td><b>${s.number}</b></td><td>${s.description || s.kind}</td><td>${s.location || ''}</td><td class="sub">с ${fdate(s.date_in)}${s.date_out ? ' · выдано ' + fdate(s.date_out) : ''}</td></tr>`)}</tbody></table>` : html`<div class="empty">Ничего не хранится</div>`)}
      ${tab === 'sms' && (c.sms.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Когда</th><th>Текст</th><th>Статус</th><th>Кто</th></tr></thead><tbody>${c.sms.map((m) => html`<tr>
          <td class="nowrap sub">${fdt(m.created_at)}</td><td style="white-space:pre-wrap">${m.text}</td><td class="sub">${{ sent: 'отправлено', failed: 'ошибка', logged: 'без шлюза' }[m.status] || m.status}</td><td class="sub">${m.staff || ''}</td></tr>`)}</tbody></table></div>` : html`<div class="empty">SMS клиенту не отправлялись</div>`)}
      ${tab === 'points' && html`<div class="row" style="margin-bottom:8px"><span class="muted">Баланс: <b>${num(c.loyalty.balance)}</b> · ${c.loyalty.tier.name} · карта ${c.card_no}</span>
          ${app.user.role === 'admin' && html`<button class="btn sm" style="margin-left:auto" onClick=${() => setAdj({ points: '', note: '' })}>Корректировка</button>`}</div>
        ${c.transactions.length ? html`<table class="tbl"><tbody>${c.transactions.map((t) => html`<tr>
          <td class="sub nowrap">${fdate(t.created_at)}</td><td>${{ earn: 'Начисление', redeem: 'Списание', bonus: 'Бонус', adjust: 'Корректировка' }[t.type]} <span class="sub">${t.order_no || t.note || ''}</span></td>
          <td class="r ${t.points < 0 ? 'neg' : 'pos'}">${t.points > 0 ? '+' : ''}${num(t.points)}</td></tr>`)}</tbody></table>`
          : html`<div class="muted">${c.registered_at ? 'Операций пока нет' : 'Клиент ещё не установил приложение — предложите: баллы 0,5 за 1 zł и +50 за регистрацию.'}</div>`}`}
    </div>
    ${adj && html`<${Modal} title="Корректировка баллов" onClose=${() => setAdj(null)} foot=${html`<button class="btn primary" onClick=${async () => { await act(() => api(`customers/${c.id}/adjust`, { body: adj }), 'Готово'); setAdj(null); reload(); }}>Сохранить</button>`}>
      <label class="f">Баллы (+ начислить, − списать)<input type="number" value=${adj.points} onInput=${(e) => setAdj({ ...adj, points: e.target.value })} /></label>
      <label class="f">Причина<input value=${adj.note} onInput=${(e) => setAdj({ ...adj, note: e.target.value })} /></label></${Modal}>`}`;
}
