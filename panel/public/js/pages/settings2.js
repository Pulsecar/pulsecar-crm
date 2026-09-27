// Настройки как в Motowarsztat: параметры, нумерация, сотрудники и доступы, прайс работ, шаблоны заказов, чек-листы, справочники
import { html, useState, useData, api, act, useApp, Loading, ErrorBox, Icon, Modal, ConfirmButton, Badge, zl, num, fdt, toast } from '../lib.js';

// ── Параметры (строятся по описанию с сервера) ─────────────────────────────
const DAYS = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']];
export function Params() {
  const app = useApp();
  const { data, error } = useData('settings/schema');
  const [tab, setTab] = useState('general');
  const [v, setV] = useState(null);
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data) return html`<${Loading} />`;
  const vals = v || data.values;
  const set = (k, x) => setV({ ...vals, [k]: x });
  const t = data.schema.find((x) => x.id === tab) || data.schema[0];
  const field = (f) => {
    const val = vals[f.k] ?? '';
    if (f.type === 'bool') return html`<label class="check"><input type="checkbox" checked=${val === '1'} onChange=${(e) => set(f.k, e.target.checked ? '1' : '0')} />${f.label}${f.hint ? html` <span class="muted small">— ${f.hint}</span>` : ''}</label>`;
    if (f.type === 'select') return html`<label class="f">${f.label}<select value=${val} onChange=${(e) => set(f.k, e.target.value)}>${f.options.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>`;
    if (f.type === 'status') return html`<label class="f">${f.label}<select value=${val} onChange=${(e) => set(f.k, e.target.value)}><option value="">— не менять —</option>${app.statuses.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>`;
    if (f.type === 'hours') {
      let h = {};
      try { h = JSON.parse(val || '{}'); } catch {}
      const setDay = (d, x) => set(f.k, JSON.stringify({ ...h, [d]: x }));
      return html`<div class="stack" style="gap:6px"><b class="small">${f.label}</b>${DAYS.map(([d, l]) => html`<div class="row" style="gap:8px">
        <label class="check" style="width:90px"><input type="checkbox" checked=${!!h[d]} onChange=${(e) => setDay(d, e.target.checked ? ['09:00', '18:00'] : null)} />${l}</label>
        ${h[d] ? html`<input type="time" style="width:120px" value=${h[d][0]} onInput=${(e) => setDay(d, [e.target.value, h[d][1]])} />—<input type="time" style="width:120px" value=${h[d][1]} onInput=${(e) => setDay(d, [h[d][0], e.target.value])} />` : html`<span class="muted small">выходной</span>`}</div>`)}</div>`;
    }
    if (f.multiline) return html`<label class="f">${f.label}<textarea rows="3" value=${val} onInput=${(e) => set(f.k, e.target.value)}></textarea>${f.hint ? html`<span class="muted small">${f.hint}</span>` : ''}</label>`;
    return html`<label class="f">${f.label}<input type=${f.input || (f.type === 'number' ? 'number' : 'text')} value=${val} onInput=${(e) => set(f.k, e.target.value)} />${f.hint ? html`<span class="muted small">${f.hint}</span>` : ''}</label>`;
  };
  return html`<div class="stack">
    <div class="pill-tabs">${data.schema.map((x) => html`<button class=${x.id === t.id ? 'on' : ''} onClick=${() => setTab(x.id)}>${x.title}</button>`)}</div>
    ${t.sections.map((sec) => html`<div class="card stack"><h2>${sec.title}</h2>
      <div class=${sec.fields.every((f) => f.type === 'bool') ? 'stack' : 'grid g2'}>${sec.fields.map(field)}</div></div>`)}
    <div class="row" style="position:sticky;bottom:0;padding:10px 0;background:var(--bg)"><button class="btn primary lg" disabled=${!v}
      onClick=${async () => { await act(() => api('settings', { method: 'PUT', body: v }), 'Сохранено'); setV(null); app.reload(); }}>Сохранить</button>${v && html`<span class="muted small">Есть несохранённые изменения</span>`}</div>
  </div>`;
}

// ── Нумерация документов ────────────────────────────────────────────────────
export function Numbering() {
  const { data, reload } = useData('numbering');
  const [edit, setEdit] = useState(null);
  if (!data) return html`<${Loading} />`;
  const RESET = { month: 'Каждый месяц', year: 'Каждый год', never: 'Никогда' };
  const preview = (p, n) => p.replace(/\[numer\]/gi, n).replace(/\[miesiac\]/gi, String(new Date().getMonth() + 1).padStart(2, '0')).replace(/\[rok\]/gi, new Date().getFullYear());
  return html`<div class="card tight">
    <div class="small muted" style="padding:12px 14px">Как в Motowarsztat: шаблон из полей [numer], [miesiac], [rok]. Чтобы продолжить нумерацию Motowarsztat, впишите «Текущий номер» — например, для заказов 298, для выцен 132 (сентябрь 2026). Следующий документ получит номер +1; номера, которые уже есть в базе после импорта, пропускаются.</div>
    <table class="tbl"><thead><tr><th>Документ</th><th>Шаблон</th><th>Сброс</th><th class="r">Текущий номер</th><th>Следующий</th></tr></thead>
      <tbody>${data.map((r) => html`<tr class="click" onClick=${() => setEdit({ ...r, current: r.current })}><td><b>${r.label}</b></td><td><code>${r.pattern}</code></td><td>${RESET[r.reset]}</td>
        <td class="r">${r.current}</td><td class="pos">${preview(r.pattern, r.current + 1)}</td></tr>`)}</tbody></table>
    ${edit && html`<${Modal} title=${edit.label} onClose=${() => setEdit(null)} foot=${html`<button class="btn primary" onClick=${async () => {
      const r = await act(() => api('numbering/' + edit.key, { method: 'PUT', body: edit }), 'Сохранено'); toast('Следующий номер: ' + r.next); setEdit(null); reload(); }}>Сохранить</button>`}>
      <label class="f">Шаблон номера<input value=${edit.pattern} onInput=${(e) => setEdit({ ...edit, pattern: e.target.value })} /></label>
      <div class="grid g3"><label class="f">Сброс номера<select value=${edit.reset} onChange=${(e) => setEdit({ ...edit, reset: e.target.value })}>${Object.entries(RESET).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
        <label class="f">Начальный номер<input type="number" min="1" value=${edit.start} onInput=${(e) => setEdit({ ...edit, start: e.target.value })} /></label>
        <label class="f">Текущий номер (этот период)<input type="number" min="0" value=${edit.current} onInput=${(e) => setEdit({ ...edit, current: e.target.value })} /></label></div>
      <div class="muted small">Следующий: <b>${preview(edit.pattern, Number(edit.current || 0) + 1)}</b></div></${Modal}>`}
  </div>`;
}

// ── Сотрудники и доступы ────────────────────────────────────────────────────
const ROLE = { admin: 'Администратор', staff: 'Приёмщик / менеджер', mechanic: 'Механик' };
export function StaffAccess() {
  const app = useApp();
  const { data, error, reload } = useData('staff');
  const [edit, setEdit] = useState(null);
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data) return html`<${Loading} />`;
  const eff = (e) => Object.fromEntries(Object.keys(data.presets.admin).map((k) => [k, e.role === 'admin' ? k !== 'orders.only_assigned' : e.permissions[k] !== undefined ? !!e.permissions[k] : !!data.presets[e.role]?.[k]]));
  const save = async () => {
    const body = { ...edit };
    delete body.effective;
    await act(() => api('staff', { body }), 'Сохранено');
    setEdit(null); reload(); app.reload();
  };
  const newStaff = () => setEdit({ role: 'mechanic', is_mechanic: 1, commission_pct: 40, hourly_rate: 250, pay_mode: 'pct', pay_base: 'net', parts_pct: 0, active: 1, permissions: {}, stations: [], password: '' });
  return html`<div class="card tight">
    <div class="row" style="padding:12px 14px"><span class="muted small">Выдайте каждому сотруднику свой логин и пароль. Права задаются ролью и уточняются галочками — как в Motowarsztat.</span>
      <button class="btn primary sm" style="margin-left:auto" onClick=${newStaff}><${Icon} n="plus" />Сотрудник</button></div>
    <table class="tbl"><thead><tr><th>Имя</th><th>Доступ в CRM</th><th>Роль</th><th class="r">Ставка н/ч</th><th class="r">% от работ</th><th>Последний вход</th></tr></thead>
      <tbody>${data.rows.map((s) => html`<tr class=${'click' + (s.active ? '' : ' faint')} onClick=${() => setEdit({ ...s, password: '' })}>
        <td><span class="dot" style=${'background:' + (s.color || '#666')}></span> <b>${s.name}</b>${s.active ? '' : html` <span class="chip">отключён</span>`}</td>
        <td>${s.login && s.has_password ? html`<span class="pos">✓ ${s.login}</span>` : html`<span class="muted">нет входа</span>`}</td><td>${ROLE[s.role]}</td>
        <td class="r">${zl(s.hourly_rate)}</td><td class="r">${s.commission_pct}%</td><td class="sub">${s.last_login ? fdt(s.last_login) : '—'}</td></tr>`)}</tbody></table>
    ${edit && html`<${Modal} wide title=${edit.id ? edit.name : 'Новый сотрудник'} onClose=${() => setEdit(null)} foot=${html`
        ${edit.id && edit.has_password ? html`<${ConfirmButton} cls="btn ghost danger" label="Забрать доступ в CRM?" onConfirm=${async () => { await act(() => api('staff', { body: { ...edit, effective: undefined, password: '', revoke: true } }), 'Доступ отключён'); setEdit(null); reload(); }}>Забрать доступ</${ConfirmButton}>` : ''}
        <button class="btn primary" style="margin-left:auto" onClick=${save}>Сохранить</button>`}>
      <div class="grid g3"><label class="f">Имя<input value=${edit.name || ''} onInput=${(e) => setEdit({ ...edit, name: e.target.value })} /></label>
        <label class="f">Телефон<input value=${edit.phone || ''} onInput=${(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
        <label class="f">Цвет в терминарзе<input type="color" value=${edit.color || '#1BF372'} onInput=${(e) => setEdit({ ...edit, color: e.target.value })} /></label></div>
      <div class="card" style="background:var(--surface2);margin:10px 0"><b>Доступ в CRM</b>
        <div class="grid g3" style="margin-top:6px"><label class="f">Логин<input value=${edit.login || ''} autocomplete="off" onInput=${(e) => setEdit({ ...edit, login: e.target.value })} placeholder="например dima" /></label>
          <label class="f">${edit.has_password ? 'Новый пароль (пусто — не менять)' : 'Пароль (минимум 8 символов)'}<input type="text" autocomplete="new-password" value=${edit.password || ''} onInput=${(e) => setEdit({ ...edit, password: e.target.value })} /></label>
          <div class="row end"><button class="btn sm" onClick=${() => setEdit({ ...edit, password: Math.random().toString(36).slice(2, 7) + Math.random().toString(36).slice(2, 7) })}>Придумать пароль</button></div></div>
        <div class="muted small">Сотрудник входит на ${location.host} со своим логином. Отправьте ему логин и пароль лично.</div></div>
      <div class="grid g4"><label class="f">Роль<select value=${edit.role} onChange=${(e) => setEdit({ ...edit, role: e.target.value, permissions: {} })}>${Object.entries(ROLE).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
        <label class="f">Ставка за н/ч, zł<input type="number" value=${edit.hourly_rate} onInput=${(e) => setEdit({ ...edit, hourly_rate: e.target.value })} /></label>
        <label class="f">% от работ<input type="number" value=${edit.commission_pct} onInput=${(e) => setEdit({ ...edit, commission_pct: e.target.value })} /></label>
        <div class="stack" style="gap:4px;justify-content:end"><label class="check"><input type="checkbox" checked=${!!edit.is_mechanic} onChange=${(e) => setEdit({ ...edit, is_mechanic: e.target.checked ? 1 : 0 })} />Механик (выбирается в работах)</label>
          <label class="check"><input type="checkbox" checked=${!!edit.active} onChange=${(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} />Работает</label></div></div>
      <div class="grid g4" style="margin-top:6px"><label class="f">Как платим<select value=${edit.pay_mode || 'pct'} onChange=${(e) => setEdit({ ...edit, pay_mode: e.target.value })}>
          <option value="pct">% от работ</option><option value="hourly">ставка × нормо-часы</option><option value="both">% от работ + ставка</option></select></label>
        <label class="f">% считать от<select value=${edit.pay_base || 'net'} onChange=${(e) => setEdit({ ...edit, pay_base: e.target.value })}><option value="net">нетто</option><option value="gross">брутто</option></select></label>
        <label class="f">% от маржи запчастей к его работам<input type="number" value=${edit.parts_pct || 0} onInput=${(e) => setEdit({ ...edit, parts_pct: e.target.value })} /></label>
        <div class="muted small" style="align-self:end">Эти условия считает рапорт «Расчёт сотрудников».</div></div>
      ${edit.role === 'admin' ? html`<div class="muted small" style="margin-top:10px">Администратор может всё.</div>` : html`
        <div class="row" style="margin-top:12px"><b>Права</b><span class="muted small">Галочки по умолчанию — от роли «${ROLE[edit.role]}».</span>
          <button class="btn ghost sm" style="margin-left:auto" onClick=${() => setEdit({ ...edit, permissions: {} })}>Сбросить к роли</button></div>
        <div class="perm-grid">${data.groups.map(([g, list]) => html`<div class="perm-group"><b>${g}</b>${list.map(([k, l]) => {
          const cur = eff(edit)[k];
          const changed = edit.permissions[k] !== undefined && !!edit.permissions[k] !== !!data.presets[edit.role]?.[k];
          return html`<label class="check small"><input type="checkbox" checked=${cur} onChange=${(e) => setEdit({ ...edit, permissions: { ...edit.permissions, [k]: e.target.checked } })} />${l}${changed ? html` <span class="warn">•</span>` : ''}</label>`;
        })}</div>`)}</div>
        ${app.stations.length ? html`<label class="f" style="margin-top:10px">Посты, которые видит в терминарзе (пусто — все)</label>
          <div class="row">${app.stations.map((st) => html`<label class="check small"><input type="checkbox" checked=${(edit.stations || []).includes(st.id)} onChange=${(e) => setEdit({ ...edit, stations: e.target.checked ? [...(edit.stations || []), st.id] : (edit.stations || []).filter((x) => x !== st.id) })} />${st.name}</label>`)}</div>` : ''}`}
    </${Modal}>`}
  </div>`;
}

// ── Прайс работ: 450+ позиций из Motowarsztat и сайта ───────────────────────
export function CatalogFull() {
  const app = useApp();
  const { data, reload } = useData('catalog');
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [bulk, setBulk] = useState(null);
  if (!data) return html`<${Loading} />`;
  const cats = [...new Set(data.map((r) => r.category || '—'))].sort();
  const rows = data.filter((r) => (!cat || (r.category || '—') === cat) && (!q || (r.name + ' ' + (r.category || '')).toLowerCase().includes(q.toLowerCase())));
  const units = String(app.settings.labor_units || 'oper,rbh').split(',').map((x) => x.trim()).filter(Boolean);
  return html`<div class="card tight">
    <div class="row" style="padding:12px 14px">
      <input class="grow" type="search" placeholder=${`Поиск по ${data.length} работам…`} value=${q} onInput=${(e) => setQ(e.target.value)} />
      <select style="width:240px" value=${cat} onChange=${(e) => setCat(e.target.value)}><option value="">Все категории (${cats.length})</option>${cats.map((c) => html`<option value=${c}>${c} (${data.filter((r) => (r.category || '—') === c).length})</option>`)}</select>
      ${cat && html`<button class="btn sm" onClick=${() => setBulk({ category: cat, rename: cat, price: '', onlyEmpty: true })}>Категория…</button>`}
      <button class="btn primary sm" onClick=${() => setEdit({ category: cat || '', unit: app.settings.labor_unit_default || 'oper', qty: 1, price: 0, vat: 23, active: 1 })}><${Icon} n="plus" />Работа</button></div>
    <div class="tbl-wrap" style="max-height:65vh;overflow:auto"><table class="tbl"><thead><tr><th>Категория</th><th>Работа</th><th class="r">Кол-во</th><th>Ед.</th><th class="r">Цена брутто</th><th></th></tr></thead>
      <tbody>${rows.slice(0, 600).map((r) => html`<tr class=${'click' + (r.active ? '' : ' faint')} onClick=${() => setEdit({ ...r })}><td class="sub">${r.category || ''}</td>
        <td>${r.name}${r.source === 'motowarsztat' ? html` <span class="chip">MW</span>` : ''}</td><td class="r">${r.qty}</td><td>${r.unit}</td><td class=${'r ' + (r.price ? '' : 'muted')}>${r.price ? zl(r.price) : 'без цены'}</td>
        <td class="act" onClick=${(e) => e.stopPropagation()}><${ConfirmButton} cls="icon-btn" onConfirm=${async () => { await act(() => api('catalog/' + r.id, { method: 'DELETE' })); reload(); }}><${Icon} n="trash" /></${ConfirmButton}></td></tr>`)}</tbody></table></div>
    <div class="muted small" style="padding:8px 14px">MW — перенесено из прайса Motowarsztat (там цены не были заданы). Поставьте цены отдельным работам или всей категории разом.</div>
    ${edit && html`<${Modal} title="Работа из прайса" onClose=${() => setEdit(null)} foot=${html`<button class="btn primary" onClick=${async () => { await act(() => api('catalog', { body: edit }), 'Сохранено'); setEdit(null); reload(); }}>Сохранить</button>`}>
      <label class="f">Категория<input list="cat-list" value=${edit.category || ''} onInput=${(e) => setEdit({ ...edit, category: e.target.value })} /><datalist id="cat-list">${cats.map((c) => html`<option value=${c} />`)}</datalist></label>
      <label class="f">Название<input value=${edit.name || ''} onInput=${(e) => setEdit({ ...edit, name: e.target.value })} /></label>
      <div class="grid g4"><label class="f">Кол-во (н/ч)<input type="number" step="0.1" value=${edit.qty} onInput=${(e) => setEdit({ ...edit, qty: e.target.value })} /></label>
        <label class="f">Ед.<select value=${edit.unit} onChange=${(e) => setEdit({ ...edit, unit: e.target.value })}>${[...new Set([...units, edit.unit])].map((u) => html`<option value=${u}>${u}</option>`)}</select></label>
        <label class="f">Цена брутто<input type="number" step="0.01" value=${edit.price} onInput=${(e) => setEdit({ ...edit, price: e.target.value })} /></label>
        <label class="f">НДС %<input type="number" value=${edit.vat} onInput=${(e) => setEdit({ ...edit, vat: e.target.value })} /></label></div>
      <label class="check"><input type="checkbox" checked=${!!edit.active} onChange=${(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} />Показывать при подборе в заказ</label>
    </${Modal}>`}
    ${bulk && html`<${Modal} title=${'Категория: ' + bulk.category} onClose=${() => setBulk(null)} foot=${html`<button class="btn primary" onClick=${async () => {
      await act(() => api('catalog/bulk', { body: { category: bulk.category, rename: bulk.rename !== bulk.category ? bulk.rename : undefined, price: bulk.price === '' ? undefined : bulk.price, onlyEmpty: bulk.onlyEmpty } }), 'Сохранено');
      setBulk(null); setCat(bulk.rename || bulk.category); reload(); }}>Применить</button>`}>
      <label class="f">Название категории<input value=${bulk.rename} onInput=${(e) => setBulk({ ...bulk, rename: e.target.value })} /></label>
      <label class="f">Поставить цену брутто всем работам категории<input type="number" step="0.01" value=${bulk.price} onInput=${(e) => setBulk({ ...bulk, price: e.target.value })} placeholder="не менять" /></label>
      <label class="check"><input type="checkbox" checked=${bulk.onlyEmpty} onChange=${(e) => setBulk({ ...bulk, onlyEmpty: e.target.checked })} />Только тем, у кого цены ещё нет</label></${Modal}>`}
  </div>`;
}

// ── Шаблоны заказов (Szablony tworzenia zleceń) ─────────────────────────────
export function Templates() {
  const app = useApp();
  const [edit, setEdit] = useState(null);
  const { data: catalog } = useData(edit ? 'catalog' : null);
  const save = async () => { await act(() => api('dict/templates', { body: edit }), 'Сохранено'); setEdit(null); app.reload(); };
  return html`<div class="card tight">
    <div class="row" style="padding:12px 14px"><span class="muted small">Набор работ, который добавляется в заказ одной кнопкой «+ Шаблон…» (например «Wulkanizacja», «Wymiana oleju»).</span>
      <button class="btn primary sm" style="margin-left:auto" onClick=${() => setEdit({ name: '', items: [], active: 1, pos: app.templates.length + 1 })}><${Icon} n="plus" />Шаблон</button></div>
    <table class="tbl"><tbody>${app.templates.map((t) => html`<tr class="click" onClick=${() => setEdit({ ...t })}><td><b>${t.name}</b>${t.active ? '' : html` <span class="chip">выкл.</span>`}</td>
      <td class="sub">${t.items.map((i) => i.name).join(' · ')}</td><td class="r nowrap">${zl(t.items.reduce((s, i) => s + i.qty * i.price, 0))}</td>
      <td class="act" onClick=${(e) => e.stopPropagation()}><${ConfirmButton} cls="icon-btn" onConfirm=${async () => { await act(() => api('dict/templates/' + t.id, { method: 'DELETE' })); app.reload(); }}><${Icon} n="trash" /></${ConfirmButton}></td></tr>`)}</tbody></table>
    ${edit && html`<${Modal} wide title="Шаблон заказа" onClose=${() => setEdit(null)} foot=${html`<button class="btn primary" onClick=${save}>Сохранить</button>`}>
      <div class="grid g2"><label class="f">Название<input value=${edit.name} onInput=${(e) => setEdit({ ...edit, name: e.target.value })} /></label>
        <label class="check" style="align-self:end"><input type="checkbox" checked=${!!edit.active} onChange=${(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} />Активен</label></div>
      <table class="tbl" style="margin-top:8px"><tbody>${edit.items.map((it, i) => html`<tr><td>${it.name}</td>
        <td style="width:90px"><input class="inline-input num" type="number" step="0.1" value=${it.qty} onInput=${(e) => setEdit({ ...edit, items: edit.items.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)) })} /></td>
        <td style="width:120px"><input class="inline-input num" type="number" step="0.01" value=${it.price} onInput=${(e) => setEdit({ ...edit, items: edit.items.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)) })} /></td>
        <td class="act"><button class="icon-btn" onClick=${() => setEdit({ ...edit, items: edit.items.filter((_, j) => j !== i) })}><${Icon} n="trash" /></button></td></tr>`)}</tbody></table>
      <select style="margin-top:8px" value="" onChange=${(e) => { const c = (catalog || []).find((x) => String(x.id) === e.target.value); if (c) setEdit({ ...edit, items: [...edit.items, { kind: 'labor', name: c.name, qty: c.qty, price: c.price, unit: c.unit, vat: c.vat }] }); }}>
        <option value="">+ Добавить работу из прайса…</option>${(catalog || []).filter((c) => c.active).map((c) => html`<option value=${c.id}>${c.category ? c.category + ' — ' : ''}${c.name}${c.price ? ' · ' + zl(c.price) : ''}</option>`)}</select>
    </${Modal}>`}
  </div>`;
}

// ── Чек-листы (Listy kontrolne) ─────────────────────────────────────────────
export function ChecklistsSettings() {
  const app = useApp();
  const [edit, setEdit] = useState(null);
  const save = async () => { await act(() => api('dict/checklists', { body: { ...edit, items: edit.text.split('\n').map((x) => x.trim()).filter(Boolean) } }), 'Сохранено'); setEdit(null); app.reload(); };
  return html`<div class="card tight">
    <div class="row" style="padding:12px 14px"><span class="muted small">Списки проверки для приёма авто, ТО, осмотра перед покупкой. В заказе — вкладка «Чек-листы».</span>
      <button class="btn primary sm" style="margin-left:auto" onClick=${() => setEdit({ name: '', text: '', active: 1 })}><${Icon} n="plus" />Чек-лист</button></div>
    <table class="tbl"><tbody>${app.checklists.map((c) => html`<tr class="click" onClick=${() => setEdit({ ...c, text: c.items.join('\n') })}><td><b>${c.name}</b></td><td class="sub">${c.items.length} пунктов: ${c.items.slice(0, 5).join(', ')}${c.items.length > 5 ? '…' : ''}</td>
      <td class="act" onClick=${(e) => e.stopPropagation()}><${ConfirmButton} cls="icon-btn" onConfirm=${async () => { await act(() => api('dict/checklists/' + c.id, { method: 'DELETE' })); app.reload(); }}><${Icon} n="trash" /></${ConfirmButton}></td></tr>`)}</tbody></table>
    ${edit && html`<${Modal} title="Чек-лист" onClose=${() => setEdit(null)} foot=${html`<button class="btn primary" onClick=${save}>Сохранить</button>`}>
      <label class="f">Название<input value=${edit.name} onInput=${(e) => setEdit({ ...edit, name: e.target.value })} /></label>
      <label class="f">Пункты — каждый с новой строки<textarea rows="10" value=${edit.text} onInput=${(e) => setEdit({ ...edit, text: e.target.value })}></textarea></label></${Modal}>`}
  </div>`;
}

// ── Справочники: статьи расходов, группы цен ────────────────────────────────
export function Lists() {
  const app = useApp();
  const [edit, setEdit] = useState(null);
  const save = async () => { await act(() => api('dict/' + edit.dict, { body: edit }), 'Сохранено'); setEdit(null); app.reload(); };
  const del = async (d, r) => { await act(() => api(`dict/${d}/${r.id}`, { method: 'DELETE' })); app.reload(); };
  const block = (d, title, rows, extra) => html`<div class="card tight"><div class="row" style="padding:12px 14px"><h2 style="margin:0">${title}</h2>
      <button class="btn primary sm" style="margin-left:auto" onClick=${() => setEdit({ dict: d, name: '', pos: rows.length + 1, markup_pct: 30 })}><${Icon} n="plus" />Добавить</button></div>
    <table class="tbl"><tbody>${rows.map((r) => html`<tr class="click" onClick=${() => setEdit({ ...r, dict: d })}><td>${r.name}</td>${extra ? html`<td class="r">${extra(r)}</td>` : ''}
      <td class="act" onClick=${(e) => e.stopPropagation()}><${ConfirmButton} cls="icon-btn" onConfirm=${() => del(d, r)}><${Icon} n="trash" /></${ConfirmButton}></td></tr>`)}</tbody></table></div>`;
  return html`<div class="grid g2">
    ${block('expenses', 'Статьи расходов (закупки)', app.expenses)}
    ${block('price_groups', 'Группы цен на запчасти', app.price_groups, (r) => `наценка ${r.markup_pct}%`)}
    ${edit && html`<${Modal} title=${edit.dict === 'expenses' ? 'Статья расходов' : 'Группа цен'} onClose=${() => setEdit(null)} foot=${html`<button class="btn primary" onClick=${save}>Сохранить</button>`}>
      <label class="f">Название<input value=${edit.name} onInput=${(e) => setEdit({ ...edit, name: e.target.value })} /></label>
      ${edit.dict === 'price_groups' && html`<label class="f">Наценка, %<input type="number" value=${edit.markup_pct} onInput=${(e) => setEdit({ ...edit, markup_pct: Number(e.target.value) })} /></label>`}</${Modal}>`}
  </div>`;
}
