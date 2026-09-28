// Работы в заказе / выцене — как «Zadania» в Motowarsztat:
// «+ Добавить» (новая строка с поиском по прайсу прямо в названии), «Прайс работ» (окно выбора из списка с отметками),
// «Удалить выбранные», поиск по работам, перетаскивание за ≡, статус «выполнено» в конце строки.
import { html, useState, useEffect, useRef, api, act, useApp, Icon, Modal, zl, num, toast } from '../lib.js';

// ── прайс работ: грузим один раз, держим в памяти ────────────────────────────
let CAT = null, CAT_AT = 0, CAT_P = null;
function loadCatalog(force) {
  if (!force && CAT && Date.now() - CAT_AT < 5 * 60 * 1000) return Promise.resolve(CAT);
  if (!CAT_P) CAT_P = api('catalog').then((r) => { CAT = (r || []).filter((c) => c.active !== 0); CAT_AT = Date.now(); CAT_P = null; return CAT; }, (e) => { CAT_P = null; throw e; });
  return CAT_P;
}
function useCatalog(on) {
  const [c, setC] = useState(CAT);
  useEffect(() => { if (on) loadCatalog().then(setC, () => setC([])); }, [on]);
  return c;
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
function matchCat(list, q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((c) => { const t = norm(c.name + ' ' + (c.category || '')); return words.every((w) => t.includes(w)); });
}

/** Название работы с поиском по прайсу (как в Motowarsztat: пишешь — ниже подсказки по категориям) */
export function TaskCombo({ value = '', disabled, autoFocus, onPick, onText, onCancel }) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(!!autoFocus);
  const [hi, setHi] = useState(0);
  const [box, setBox] = useState(null);
  const inp = useRef(null);
  const picked = useRef(false);
  const cat = useCatalog(open);
  useEffect(() => { setQ(value); }, [value]);
  useEffect(() => { if (autoFocus && inp.current) inp.current.focus(); }, []);
  const place = () => { const r = inp.current?.getBoundingClientRect(); if (r) setBox({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 460), up: r.bottom + 360 > innerHeight && r.top > 380, bottom: innerHeight - r.top + 2 }); };
  useEffect(() => { if (!open) return; place(); const f = () => place(); addEventListener('scroll', f, true); addEventListener('resize', f); return () => { removeEventListener('scroll', f, true); removeEventListener('resize', f); }; }, [open]);
  const typed = q.trim();
  const found = open && cat ? matchCat(cat, typed === value.trim() && !autoFocus ? '' : typed).slice(0, 80) : [];
  const flat = [...(typed ? [{ free: true, name: typed }] : []), ...found];
  const choose = (x) => {
    picked.current = true;
    setOpen(false);
    if (x.free) { if (x.name !== value) onText?.(x.name); else onCancel?.(); } else { setQ(x.name); onPick?.(x); }
    inp.current?.blur();
  };
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(flat.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[hi]) choose(flat[hi]); else if (!typed) { picked.current = true; setOpen(false); onCancel?.(); } }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); picked.current = true; setQ(value); setOpen(false); onCancel?.(); inp.current?.blur(); }
  };
  const blur = () => setTimeout(() => {
    setOpen(false);
    if (picked.current) { picked.current = false; return; }
    if (typed && typed !== value.trim()) onText?.(typed); else if (!typed) { setQ(value); onCancel?.(); }
  }, 160);
  let lastCat = null;
  return html`<div class="tcombo">
    <span class="tcombo-ico"><${Icon} n="search" /></span>
    <input ref=${inp} class="inline-input iname" value=${q} disabled=${disabled} placeholder="Начните писать название работы…"
      onFocus=${() => { picked.current = false; setHi(0); setOpen(true); }} onBlur=${blur} onKeyDown=${key}
      onInput=${(e) => { setQ(e.target.value); setHi(0); setOpen(true); }} />
    ${open && box && html`<div class="tcombo-list" style=${`left:${box.left}px;width:${box.width}px;` + (box.up ? `bottom:${box.bottom}px` : `top:${box.top}px`)} onMouseDown=${(e) => e.preventDefault()}>
      ${typed ? html`<div class=${'tc-item free' + (hi === 0 ? ' hi' : '')} onClick=${() => choose(flat[0])}><${Icon} n="edit" /><span class="grow">${typed}</span><span class="faint small">своя работа</span></div>` : ''}
      ${!cat ? html`<div class="tc-item muted">Загружаю прайс…</div>` : found.map((c, i) => {
        const n = i + (typed ? 1 : 0);
        const head = (c.category || 'Без категории') !== lastCat ? (lastCat = c.category || 'Без категории') : null;
        return html`${head ? html`<div class="tc-cat">${head}</div>` : ''}<div class=${'tc-item' + (hi === n ? ' hi' : '')} onMouseEnter=${() => setHi(n)} onClick=${() => choose(c)}>
          <span class="grow">${c.name}</span><span class="faint small nowrap">${num(c.qty, 2)} ${c.unit || ''}${c.price ? ' · ' + zl(c.price) : ''}</span></div>`;
      })}
      ${cat && !found.length ? html`<div class="tc-item muted">В прайсе не найдено — Enter добавит «${typed}» как свою работу</div>` : ''}
    </div>`}
  </div>`;
}

/** Окно «Выбрать из прайса» — как «Wybierz z listy» в Motowarsztat */
export function CatalogModal({ onClose, onPick }) {
  const cat = useCatalog(true);
  const [q, setQ] = useState('');
  const [grp, setGrp] = useState('');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const [sel, setSel] = useState(new Set());
  const [keepOpen, setKeepOpen] = useState(() => { try { return localStorage.getItem('pc-cat-keep') === '1'; } catch { return false; } });
  useEffect(() => setPage(0), [q, grp, size]);
  const groups = cat ? [...new Set(cat.map((c) => c.category || 'Без категории'))] : [];
  const rows = cat ? matchCat(grp ? cat.filter((c) => (c.category || 'Без категории') === grp) : cat, q) : [];
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const view = rows.slice(page * size, page * size + size);
  const toggle = (id) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s); };
  const allOn = view.length && view.every((c) => sel.has(c.id));
  const pick = async (list) => {
    if (!list.length) return;
    await onPick(list);
    toast(list.length === 1 ? `Добавлено: ${list[0].name}` : `Добавлено работ: ${list.length}`);
    setSel(new Set());
    if (!keepOpen) onClose();
  };
  return html`<${Modal} xl title="Выбрать из прайса работ" onClose=${onClose} foot=${html`
      <label class="check" style="margin-right:auto"><input type="checkbox" checked=${keepOpen} onChange=${(e) => { setKeepOpen(e.target.checked); try { localStorage.setItem('pc-cat-keep', e.target.checked ? '1' : '0'); } catch {} }} />Не закрывать окно после выбора</label>
      <button class="btn" onClick=${onClose}>Закрыть</button>
      <button class="btn primary" disabled=${!sel.size} onClick=${() => pick(cat.filter((c) => sel.has(c.id)))}>Выбрать отмеченные${sel.size ? ` (${sel.size})` : ''}</button>`}>
    <div class="row" style="margin-bottom:10px">
      <select style="width:260px" value=${grp} onChange=${(e) => setGrp(e.target.value)}><option value="">Все категории</option>${groups.map((g) => html`<option value=${g}>${g}</option>`)}</select>
      <input class="grow" type="search" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Поиск по названию и категории…" autofocus />
      <a class="btn ghost" href="#/settings/catalog" onClick=${onClose}><${Icon} n="gear" />Редактировать прайс</a>
    </div>
    ${!cat ? html`<div class="empty">Загрузка…</div>` : html`<div class="tbl-wrap"><table class="tbl cat-pick">
      <thead><tr><th style="width:30px"><input type="checkbox" checked=${!!allOn} onChange=${() => { const s = new Set(sel); view.forEach((c) => (allOn ? s.delete(c.id) : s.add(c.id))); setSel(s); }} /></th>
        <th style="width:220px">Категория</th><th>Название работы</th><th></th><th>Ед.</th><th class="r">Кол-во</th><th class="r">Цена брутто</th></tr></thead>
      <tbody>${view.map((c) => html`<tr class=${'click' + (sel.has(c.id) ? ' on' : '')} onClick=${() => toggle(c.id)}>
        <td><input type="checkbox" checked=${sel.has(c.id)} onClick=${(e) => e.stopPropagation()} onChange=${() => toggle(c.id)} /></td>
        <td class="sub ellip">${c.category || ''}</td><td>${c.name}</td>
        <td class="r"><button class="btn sm soft pick-one" onClick=${(e) => { e.stopPropagation(); pick([c]); }}>Выбрать</button></td>
        <td class="sub">${c.unit || ''}</td><td class="r">${num(c.qty, 2)}</td><td class="r nowrap">${c.price ? zl(c.price) : html`<span class="faint">0,00</span>`}</td></tr>`)}</tbody></table></div>
      ${!rows.length ? html`<div class="empty">Ничего не найдено</div>` : ''}
      <div class="row" style="margin-top:10px">
        <select style="width:auto" value=${size} onChange=${(e) => setSize(Number(e.target.value))}>${[25, 50, 100].map((n) => html`<option value=${n}>${n}</option>`)}</select>
        <span class="muted small grow">${rows.length ? `${page * size + 1}–${Math.min(rows.length, page * size + size)} из ${rows.length}` : ''}</span>
        <div class="btn-group"><button class="btn sm" disabled=${page === 0} onClick=${() => setPage(page - 1)}><${Icon} n="left" /></button>
          <span class="btn sm" style="pointer-events:none">${page + 1} / ${pages}</span>
          <button class="btn sm" disabled=${page >= pages - 1} onClick=${() => setPage(page + 1)}><${Icon} n="right" /></button></div>
      </div>`}
  </${Modal}>`;
}

/** Блок «Работы» заказа / выцены */
export function LaborBlock({ o, reload, c }) {
  const app = useApp();
  const { quote, mech, seePrice, editPrice, showDisc, units, discL, modeL, NetGrossEl, shown, setPrice, numIn, vatSel, lineGross, net, S } = c;
  const labor = o.items.filter((i) => i.kind === 'labor');
  const [sel, setSel] = useState(new Set());
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  useEffect(() => { if (!menu) return; const f = (e) => { if (!e.target.closest('.split')) setMenu(false); }; setTimeout(() => addEventListener('click', f)); return () => removeEventListener('click', f); }, [menu]);
  const base = { kind: 'labor', discount: discL, mechanic_id: o.mechanic_id };
  const fromCat = (x) => ({ ...base, name: x.name, qty: x.qty || 1, unit: x.unit || S.labor_unit_default || 'oper', price: x.price || 0, vat: x.vat ?? 23 });
  const add = async (it) => { await act(() => api(`orders/${o.id}/items`, { body: it })); };
  const save = async (it, patch) => { await act(() => api(`orders/${o.id}/items/${it.id}`, { method: 'PUT', body: patch })); reload(); };
  const ql = norm(q.trim());
  const rows = ql ? labor.filter((i) => norm(i.name).includes(ql)) : labor;
  const toggle = (id) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s); };
  const delSel = async () => {
    const ids = [...sel];
    for (const id of ids) await act(() => api(`orders/${o.id}/items/${id}`, { method: 'DELETE' }));
    toast(`Удалено работ: ${ids.length}`); setSel(new Set()); reload();
  };
  const drop = async (targetId) => {
    const from = dragId; setDragId(null); setOverId(null);
    if (!from || from === targetId) return;
    const ids = labor.map((i) => i.id).filter((id) => id !== from);
    const at = targetId ? ids.indexOf(targetId) : ids.length;
    ids.splice(at < 0 ? ids.length : at, 0, from);
    await act(() => api(`orders/${o.id}/items/reorder`, { body: { ids } })); reload();
  };
  const hours = labor.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const cols = 4 + (quote ? 0 : 1) + 2 + (seePrice ? 2 + (showDisc ? 1 : 0) + 2 : 0) + 1;
  return html`<div class="card tight">
    <div class="mw-bar"><h2>Работы</h2><span class="muted small">${num(hours, 2)} ${units[0] || 'ед.'}</span>${seePrice && NetGrossEl}</div>
    ${!mech && html`<div class="mw-tools">
      <div class="split">
        <button class="btn primary sm" onClick=${() => { setQ(''); setAdding(true); }}><${Icon} n="plus" />Добавить</button>
        <button class="btn primary sm split-arrow" aria-label="Ещё" onClick=${() => setMenu(!menu)}><${Icon} n="down" /></button>
        ${menu && html`<div class="menu-pop">
          ${(app.templates || []).filter((t) => t.active).map((t) => html`<button onClick=${async () => { setMenu(false); const r = await act(() => api(`orders/${o.id}/apply-template/${t.id}`, { body: {} })); toast(`Добавлено из шаблона «${t.name}»: ${r.added}`); reload(); }}><${Icon} n="file" />Шаблон: ${t.name}</button>`)}
          ${!(app.templates || []).some((t) => t.active) ? html`<div class="muted small" style="padding:8px 12px">Шаблонов нет — создайте в Настройки → Шаблоны заказов</div>` : ''}
          <a href="#/settings/templates" onClick=${() => setMenu(false)}><${Icon} n="gear" />Шаблоны заказов…</a></div>`}
      </div>
      <button class="btn sm soft" onClick=${() => setCatOpen(true)}><${Icon} n="list" />Прайс работ</button>
      <button class="btn sm danger-soft" disabled=${!sel.size} onClick=${delSel}><${Icon} n="trash" />Удалить выбранные${sel.size ? ` (${sel.size})` : ''}</button>
      <span class="grow"></span>
      <div class="mw-search"><${Icon} n="search" /><input type="search" placeholder="Поиск" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
    </div>`}
    <div class="tbl-wrap"><table class="tbl items mw-items labor-tbl"><thead><tr>
      <th style="width:28px">${!mech && html`<input type="checkbox" checked=${rows.length > 0 && rows.every((i) => sel.has(i.id))} onChange=${(e) => setSel(e.target.checked ? new Set(rows.map((i) => i.id)) : new Set())} aria-label="Выбрать все" />`}</th>
      <th style="width:30px">Lp.</th><th style="width:24px"></th><th class="nm">Работа</th>${!quote ? html`<th>Механик</th>` : ''}<th>Ед.</th><th class="r">Кол-во</th>
      ${seePrice ? html`<th class="r">Цена ${modeL === 'net' ? 'нетто' : 'брутто'}</th>${showDisc ? html`<th class="r">Скидка %</th>` : ''}<th>VAT</th><th class="r">Сумма нетто</th><th class="r">Сумма брутто</th>` : ''}
      <th class="c">${quote ? '' : 'Статус'}</th></tr></thead>
      <tbody onDragOver=${(e) => dragId && e.preventDefault()}>
      ${rows.map((it) => html`<tr class=${(sel.has(it.id) ? 'on ' : '') + (overId === it.id ? 'drop-above ' : '') + (dragId === it.id ? 'dragging ' : '') + (it.done ? 'is-done' : '')}
          onDragOver=${(e) => { if (!dragId) return; e.preventDefault(); if (overId !== it.id) setOverId(it.id); }} onDrop=${(e) => { e.preventDefault(); drop(it.id); }}>
        <td>${!mech && html`<input type="checkbox" checked=${sel.has(it.id)} onChange=${() => toggle(it.id)} aria-label="Выбрать" />`}</td>
        <td class="sub">${labor.indexOf(it) + 1}</td>
        <td class="grip">${!mech && !ql && html`<span draggable="true" title="Перетащите, чтобы поменять порядок" onDragStart=${(e) => { e.dataTransfer.effectAllowed = 'move'; setDragId(it.id); }} onDragEnd=${() => { setDragId(null); setOverId(null); }}><${Icon} n="grip" /></span>`}</td>
        <td class="nm">${mech ? html`<span class="iname-ro">${it.name}</span>` : html`<${TaskCombo} value=${it.name}
            onPick=${(x) => save(it, { name: x.name, unit: x.unit || it.unit, ...(it.price ? {} : { price: x.price || 0, vat: x.vat ?? it.vat }), ...(x.qty && Number(it.qty) === 1 ? { qty: x.qty } : {}) })}
            onText=${(t) => save(it, { name: t })} />`}</td>
        ${!quote && html`<td class="mech"><select class="inline-input" value=${it.mechanic_id || ''} disabled=${mech} onChange=${(e) => save(it, { mechanic_id: e.target.value ? Number(e.target.value) : null })}><option value="">— выбрать</option>${app.staff.filter((s) => s.active).map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></td>`}
        <td><select class="inline-input" style="width:74px" value=${it.unit || ''} disabled=${mech} onChange=${(e) => save(it, { unit: e.target.value })}>${[...new Set([...units, it.unit].filter(Boolean))].map((u) => html`<option value=${u}>${u}</option>`)}</select></td>
        <td class="r">${numIn(it, 'qty', 'qty', it.qty, (v) => save(it, { qty: v }), mech, '0.1')}</td>
        ${seePrice && html`<td class="r">${numIn(it, 'price', 'price', shown(it, modeL), (v) => setPrice(it, modeL, v), !editPrice)}</td>
          ${showDisc && html`<td class="r">${numIn(it, 'discount', 'disc', it.discount, (v) => save(it, { discount: v }), !editPrice, '1')}</td>`}<td>${vatSel(it)}</td>
          <td class="r nowrap">${zl(net(lineGross(it), it.vat))}</td><td class="r nowrap"><b>${zl(lineGross(it))}</b></td>`}
        <td class="c">${!quote && html`<button class=${'job-st' + (it.done ? ' done' : '')} title=${it.done ? 'Выполнено — нажмите, чтобы снять отметку' : 'Отметить выполненной'} onClick=${() => save(it, { done: it.done ? 0 : 1 })}><${Icon} n=${it.done ? 'check' : 'play'} /></button>`}</td>
      </tr>`)}
      ${adding && html`<tr class="new-row"><td></td><td class="sub">${labor.length + 1}</td><td></td>
        <td colspan=${cols - 3}><${TaskCombo} autoFocus value=""
          onPick=${async (x) => { await add(fromCat(x)); setAdding(false); reload(); }}
          onText=${async (t) => { await add({ ...base, name: t, qty: 1, unit: S.labor_unit_default || units[0] || 'oper', price: 0 }); setAdding(false); reload(); }}
          onCancel=${() => setAdding(false)} /></td></tr>`}
      ${dragId && html`<tr class=${'drop-end' + (overId === 'end' ? ' drop-above' : '')} onDragOver=${(e) => { e.preventDefault(); setOverId('end'); }} onDrop=${(e) => { e.preventDefault(); drop(null); }}><td colspan=${cols}></td></tr>`}
      ${!rows.length && !adding ? html`<tr><td colspan=${cols} class="empty" style="padding:16px">${q ? 'Ничего не найдено' : html`Работ пока нет${!mech ? html` — нажмите <b>«Добавить»</b> или <b>«Прайс работ»</b>` : ''}`}</td></tr>` : ''}
      ${seePrice && labor.length ? html`<tr class="sum-row"><td colspan=${cols - 3}></td>
        <td class="r nowrap">${zl(labor.reduce((s, i) => s + net(lineGross(i), i.vat), 0))}<div class="sub">нетто</div></td><td class="r nowrap"><b>${zl(labor.reduce((s, i) => s + lineGross(i), 0))}</b><div class="sub">брутто</div></td><td></td></tr>` : ''}
      </tbody></table></div>
    ${catOpen && html`<${CatalogModal} onClose=${() => { setCatOpen(false); reload(); }} onPick=${async (list) => { for (const x of list) await add(fromCat(x)); reload(); }} />`}
  </div>`;
}
