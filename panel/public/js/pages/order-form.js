// Заказ и выцена как в Motowarsztat: вкладка «Основное» (Pojazd · Klient · Zlecenie · Uszkodzenia),
// «Работы и товары» — отдельные таблицы Zadania и Towary, переключатель NETTO/BRUTTO, себестоимость (koszt) только в CRM.
import { html, useState, useEffect, useRef, api, act, go, useApp, Icon, Picker, ConfirmButton, zl, num, toast, carName } from '../lib.js';
import { CustomerCarPicker } from './orders.js';
import { SupplierParts } from './suppliers.js';
import { CarDiagram, DMG } from './order-docs.js';
import { detectBody, BODY_TYPES } from '../car-shapes.js';
import { LaborBlock } from './labor.js';

export const FLAGS = [['return_parts', 'Возврат деталей клиенту'], ['reg_doc', 'Техпаспорт'], ['test_drive', 'Согласие на тест-драйв'], ['fluids', 'Долить жидкости'], ['lights', 'Проверить освещение']];
export const FUEL = ['', 'резерв', '1/4', '1/2', '3/4', 'полный'];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const lineGross = (i) => r2((Number(i.qty) || 0) * (Number(i.price) || 0) * (1 - (Number(i.discount) || 0) / 100));
const net = (g, v) => r2(g / (1 + (Number(v ?? 23)) / 100));
const load = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// ── Переключатель NETTO / BRUTTO (как в Motowarsztat) ───────────────────────
function NetGross({ value, set }) {
  return html`<div class="seg">${[['net', 'NETTO'], ['gross', 'BRUTTO']].map(([k, l]) => html`<button class=${value === k ? 'on' : ''} onClick=${() => set(k)}>${l}</button>`)}</div>`;
}

// ── Основное: Pojazd · Klient · Zlecenie · Uszkodzenia ──────────────────────
export function OrderMain({ o, reload, isNew = false, onCreate, kind = 'order', query = {} }) {
  const app = useApp();
  const S = app.settings;
  const [cc, setCc] = useState({ customer: o?.customer || null, car: o?.car || null });
  const [f, set] = useState({
    mileage: o?.mileage ?? '', fuel_level: o?.fuel_level || '', complaint: o?.complaint || query.note || '', internal_note: o?.internal_note || '', mechanic_note: o?.mechanic_note || '',
    type_id: o?.type_id || '', mechanic_id: o?.mechanic_id || '', pickup_at: o?.pickup_at || '', flags: o?.flags || {}, contact_person: o?.contact_person || '', contact_phone: o?.contact_phone || '',
    faults: o?.faults || '', after_notes: o?.after_notes || '', external_no: o?.external_no || '', damages: o?.damages || [], damages_note: o?.damages_note || '', status_id: o?.status_id || '',
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(null);
  const upd = (patch) => { set({ ...f, ...patch }); setDirty(true); };
  useEffect(() => {
    if (!isNew) return;
    if (query.customer_id) api('customers/' + query.customer_id).then((c) => setCc((v) => ({ ...v, customer: c, car: query.car_id ? c.cars.find((k) => String(k.id) === query.car_id) || null : null })));
    else if (query.name || query.phone) setCc((v) => ({ ...v, newCustomer: { name: query.name || '', phone: query.phone || '' } }));
  }, []);
  const on = (k) => S[k] !== '0';
  const canEdit = isNew || app.perms['orders.edit'];
  const save = async () => {
    setBusy(true);
    try {
      if (isNew) {
        const r = await act(() => api('orders', { body: {
          kind, customer_id: cc.customer?.id, car_id: cc.car?.id, new_customer: cc.customer ? null : cc.newCustomer, new_car: cc.car ? null : cc.newCar,
          ...f, type_id: f.type_id || null, mechanic_id: f.mechanic_id || null, mileage: f.mileage || null, status_id: f.status_id || null,
          appointment_id: query.appointment_id || null, source: query.appointment_id ? undefined : 'crm',
        } }));
        onCreate(r.id);
        return;
      }
      let customer_id = cc.customer?.id ?? null, car_id = cc.car?.id ?? null;
      if (!customer_id && (cc.newCustomer?.phone || cc.newCustomer?.name)) customer_id = (await act(() => api('customers', { body: cc.newCustomer }))).id;
      if (!car_id && (cc.newCar?.plate || cc.newCar?.vin || cc.newCar?.make)) car_id = (await act(() => api('cars', { body: { ...cc.newCar, customer_id } }))).id;
      const { status_id, ...rest } = f;
      await act(() => api('orders/' + o.id, { method: 'PUT', body: { ...rest, customer_id, car_id, mileage: f.mileage || null, type_id: f.type_id || null, mechanic_id: f.mechanic_id || null } }), 'Сохранено');
      setDirty(false); reload();
    } finally { setBusy(false); }
  };
  // автосохранение (как в Motowarsztat): через секунду после изменения и при уходе со вкладки
  const [saved, setSaved] = useState(null);
  const pending = useRef(null);
  const autoSave = async (ff, c) => {
    if (!c.customer?.id && (c.newCustomer?.phone || c.newCustomer?.name)) return; // новый клиент/авто — сохраняется кнопкой
    if (!c.car?.id && (c.newCar?.plate || c.newCar?.vin || c.newCar?.make)) return;
    const { status_id, ...rest } = ff;
    setSaved('saving');
    try {
      await api('orders/' + o.id, { method: 'PUT', body: { ...rest, customer_id: c.customer?.id ?? null, car_id: c.car?.id ?? null, mileage: ff.mileage || null, type_id: ff.type_id || null, mechanic_id: ff.mechanic_id || null } });
      setDirty(false); setSaved(new Date()); reload();
    } catch (e) { setSaved('error'); toast(e.message, 'error'); }
  };
  useEffect(() => {
    if (isNew || !dirty || !canEdit) return;
    pending.current = () => autoSave(f, cc);
    const t = setTimeout(() => { const fn = pending.current; pending.current = null; fn?.(); }, 900);
    return () => clearTimeout(t);
  }, [f, cc, dirty]);
  useEffect(() => () => { const fn = pending.current; pending.current = null; fn?.(); }, []);
  const needsButton = isNew || (!cc.customer?.id && (cc.newCustomer?.phone || cc.newCustomer?.name)) || (!cc.car?.id && (cc.newCar?.plate || cc.newCar?.vin || cc.newCar?.make));
  const quote = kind === 'quote' || o?.kind === 'quote';
  const staff = app.staff.filter((s) => s.active);
  return html`<div class="mw-form">
    <div class="grid g2 mw-top">
      <section class="mw-panel"><header>Автомобиль ${cc.car?.vin ? html`<span class="sub mono">${cc.car.vin}</span>` : ''}</header>
        <${CustomerCarPicker} only="car" value=${cc} onChange=${(v) => { setCc(v); setDirty(true); }} />
        ${!quote && html`<div class="grid g2" style="margin-top:10px">
          <label class="f">Пробег<div class="input-unit"><input type="number" value=${f.mileage} onInput=${(e) => upd({ mileage: e.target.value })} /><span>${S.mileage_unit === 'mi' ? 'mi' : S.mileage_unit === 'mth' ? 'mth' : 'km'}</span></div></label>
          <label class="f">Уровень топлива<select value=${f.fuel_level} onChange=${(e) => upd({ fuel_level: e.target.value })}>${FUEL.map((x) => html`<option value=${x}>${x || '—'}</option>`)}</select></label></div>`}
      </section>
      <section class="mw-panel"><header>Клиент</header>
        <${CustomerCarPicker} only="customer" value=${cc} onChange=${(v) => { setCc(v); setDirty(true); }} />
        ${!quote && html`<div class="grid g2" style="margin-top:10px">
          <label class="f">Контактное лицо<input value=${f.contact_person} onInput=${(e) => upd({ contact_person: e.target.value })} /></label>
          <label class="f">Телефон контакта<input value=${f.contact_phone} placeholder=${cc.customer?.phone || '+48'} onInput=${(e) => upd({ contact_phone: e.target.value })} /></label></div>`}
        <label class="f" style="margin-top:10px">${quote ? 'Описание (видит клиент)' : 'Описание заказа (видит клиент)'}<textarea rows="2" value=${f.complaint} onInput=${(e) => upd({ complaint: e.target.value })}></textarea></label>
        ${!quote && html`<div class="mw-flags">${FLAGS.map(([k, l]) => html`<label class="toggle"><input type="checkbox" checked=${!!f.flags[k]} onChange=${(e) => upd({ flags: { ...f.flags, [k]: e.target.checked } })} /><i></i><span>${l}</span></label>`)}</div>`}
      </section>
    </div>
    <section class="mw-panel"><header>${quote ? 'Выцена' : 'Заказ'}</header>
      <div class="grid g3">
        <div class="stack" style="gap:10px">
          ${isNew && !quote && html`<label class="f">Статус<select value=${f.status_id} onChange=${(e) => upd({ status_id: e.target.value })}><option value="">${app.statuses[0]?.name || '—'}</option>${app.statuses.slice(1).map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>`}
          ${on('order_type_on') && html`<label class="f">Вид заказа (источник)<select value=${f.type_id} onChange=${(e) => upd({ type_id: e.target.value })}><option value="">—</option>${app.types.map((t) => html`<option value=${t.id}>${t.name}</option>`)}</select></label>`}
          ${!quote && html`<label class="f">Срок выдачи${S.pickup_format === 'date'
            ? html`<input type="date" value=${(f.pickup_at || '').slice(0, 10)} onInput=${(e) => upd({ pickup_at: e.target.value })} />`
            : html`<input type="datetime-local" value=${(f.pickup_at || '').replace(' ', 'T')} onInput=${(e) => upd({ pickup_at: e.target.value.replace('T', ' ') })} />`}</label>`}
        </div>
        <div class="stack" style="gap:10px">
          <label class="f">Механик по умолчанию<select value=${f.mechanic_id} onChange=${(e) => upd({ mechanic_id: e.target.value })}><option value="">—</option>${staff.map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select></label>
          ${S.field_external_no === '1' && html`<label class="f">Внешний номер<input value=${f.external_no} onInput=${(e) => upd({ external_no: e.target.value })} /></label>`}
          <label class="f">Валюта<select disabled><option>(PLN) Польский злотый</option></select></label>
        </div>
        <div class="stack" style="gap:10px">
          ${on('field_internal') && html`<label class="f">Внутреннее описание (клиент не видит)<textarea rows="3" value=${f.internal_note} onInput=${(e) => upd({ internal_note: e.target.value })}></textarea></label>`}
          ${!quote && on('field_mechanic') && html`<label class="f">Описание для механика<textarea rows="2" value=${f.mechanic_note} onInput=${(e) => upd({ mechanic_note: e.target.value })}></textarea></label>`}
        </div>
      </div>
      ${!isNew && !quote && (on('field_faults') || on('field_after')) && html`<div class="grid g2" style="margin-top:10px">
        ${on('field_faults') && html`<label class="f">Обнаруженные неисправности<textarea rows="2" value=${f.faults} onInput=${(e) => upd({ faults: e.target.value })}></textarea></label>`}
        ${on('field_after') && html`<label class="f">Замечания после выполнения<textarea rows="2" value=${f.after_notes} onInput=${(e) => upd({ after_notes: e.target.value })}></textarea></label>`}</div>`}
    </section>
    ${!quote && html`<section class="mw-panel"><header>Повреждения автомобиля <span class="sub" style="margin-left:auto">видны клиенту в протоколе приёма</span></header>
      <div class="dmg-edit">
        <div class="stack" style="gap:6px">
        ${(() => {
          const carObj = cc.car || cc.newCar || {};
          const auto = detectBody({ ...carObj, body_type: null });
          const setBody = async (v) => {
            if (cc.car?.id) { await act(() => api('cars/' + cc.car.id, { method: 'PUT', body: { body_type: v || '' } }), 'Тип кузова сохранён в карточке авто'); setCc({ ...cc, car: { ...cc.car, body_type: v || null } }); }
            else setCc({ ...cc, newCar: { ...(cc.newCar || {}), body_type: v || null } });
          };
          return html`<label class="f small">Кузов<select value=${carObj.body_type || ''} disabled=${!canEdit} onChange=${(e) => setBody(e.target.value)}>
            <option value="">Авто по модели: ${BODY_TYPES.find(([k]) => k === auto)?.[1] || auto}</option>${BODY_TYPES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>`;
        })()}
        <${CarDiagram} body=${detectBody(cc.car || cc.newCar || {})} marks=${f.damages} sel=${sel} onPick=${setSel} onAdd=${(p) => { if (!canEdit) return; upd({ damages: [...f.damages, { ...p, type: 'rysa', note: '' }] }); setSel(f.damages.length); }} /></div>
        <div class="stack" style="gap:8px">
          <label class="f">Общее описание повреждений<textarea rows="2" value=${f.damages_note} onInput=${(e) => upd({ damages_note: e.target.value })}></textarea></label>
          <b class="small">Список повреждений</b>
          ${f.damages.length ? f.damages.map((m, i) => html`<div class=${'dmg-row' + (sel === i ? ' on' : '')} onClick=${() => setSel(i)}>
            <b>${i + 1}</b><select value=${m.type} onChange=${(e) => { const M = [...f.damages]; M[i] = { ...m, type: e.target.value }; upd({ damages: M }); }}>${DMG.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
            <button class="icon-btn" title="Удалить" onClick=${(e) => { e.stopPropagation(); upd({ damages: f.damages.filter((_, j) => j !== i) }); setSel(null); }}><${Icon} n="trash" /></button>
            <input value=${m.note} placeholder="Где и какое: левая передняя дверь…" onInput=${(e) => { const M = [...f.damages]; M[i] = { ...m, note: e.target.value }; upd({ damages: M }); }} /></div>`)
            : html`<div class="empty warn-bg">Повреждений нет — нажмите на схему, чтобы добавить</div>`}
        </div></div></section>`}
    ${canEdit && needsButton && html`<div class="row sticky-save"><button class="btn primary lg" disabled=${busy || (!isNew && !dirty)} onClick=${save}>${isNew ? (quote ? 'Создать выцену' : 'Создать заказ') : 'Сохранить'}</button>
      ${!isNew && dirty && html`<span class="muted small">Новый клиент или авто — нажмите «Сохранить»</span>`}${isNew && html`<span class="muted small">Работы и товары добавите на следующем шаге</span>`}</div>`}
    ${canEdit && !needsButton && html`<div class="autosave small ${saved === 'error' ? 'neg' : 'muted'}">${saved === 'saving' || (dirty && saved !== 'error') ? 'Сохраняю…' : saved === 'error' ? 'Не сохранено — проверьте данные' : saved ? '✓ Сохранено автоматически' : 'Изменения сохраняются автоматически'}</div>`}
  </div>`;
}

// ── Работы и товары ────────────────────────────────────────────────────────
export function ItemsMW({ o, reload }) {
  const app = useApp();
  const S = app.settings;
  const P = app.perms;
  const [ic, setIc] = useState(false);
  const [modeL, setModeL] = useState(load('pc-ng-labor', S.show_amounts === 'net' ? 'net' : 'gross'));
  const [modeP, setModeP] = useState(load('pc-ng-parts', S.show_amounts === 'net' ? 'net' : 'gross'));
  const quote = o.kind === 'quote';
  const mech = !P['orders.jobs'];
  const seePrice = P['orders.prices'] !== false && o.total !== null;
  const editPrice = !mech && P['orders.price_edit'] !== false;
  const showCost = seePrice && !mech && S.show_cost_column !== '0' && P['products.prices'] !== false;
  const showDisc = S.discounts_on !== '0';
  const units = String(S.labor_units || 'oper,rbh').split(',').map((x) => x.trim()).filter(Boolean);
  const vats = String(S.vat_rates || '23,8,5,0').split(',').map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x));
  const labor = o.items.filter((i) => i.kind === 'labor');
  const parts = o.items.filter((i) => i.kind === 'part');
  const add = async (it) => { await act(() => api(`orders/${o.id}/items`, { body: it })); reload(); };
  const save = async (it, patch) => { await act(() => api(`orders/${o.id}/items/${it.id}`, { method: 'PUT', body: patch })); reload(); };
  const del = async (it) => { await act(() => api(`orders/${o.id}/items/${it.id}`, { method: 'DELETE' })); reload(); };
  const discL = o.customer?.discount_labor || 0, discP = o.customer?.discount_parts || 0;
  const shown = (i, mode, k = 'price') => (k === 'cost' ? (mode === 'net' ? r2(i.cost) : r2(i.cost * (1 + (i.vat ?? 23) / 100))) : mode === 'net' ? net(i.price, i.vat) : r2(i.price));
  const setPrice = (i, mode, v, k = 'price') => save(i, { [k]: k === 'cost' ? (mode === 'net' ? r2(v) : net(v, i.vat)) : mode === 'net' ? r2(v * (1 + (i.vat ?? 23) / 100)) : r2(v) });
  const numIn = (i, k, cls, val, onSet, dis, step = '0.01') => html`<input class=${'inline-input num ' + cls} type="number" step=${step} value=${val} disabled=${dis} onChange=${(e) => onSet(Number(e.target.value))} />`;
  const sumRow = (rows, mode, span, tail) => html`<tr class="sum-row"><td colspan=${span}></td>
    <td class="r nowrap">${zl(rows.reduce((s, i) => s + net(lineGross(i), i.vat), 0))}<div class="sub">нетто</div></td><td class="r nowrap"><b>${zl(rows.reduce((s, i) => s + lineGross(i), 0))}</b><div class="sub">брутто</div></td>${tail}</tr>`;

  const partsHead = html`<tr><th data-c="lp" style="width:28px">Lp.</th><th data-c="name">Товар</th><th data-c="code">Код</th>${!quote ? html`<th data-c="job">Работа</th>` : ''}<th data-c="qty" class="r">Кол-во</th><th data-c="unit">Ед.</th>
    ${seePrice ? html`<th data-c="price" class="r">Цена ${modeP === 'net' ? 'нетто' : 'брутто'}</th>${showCost ? html`<th data-c="cost" class="r" title="Себестоимость (закупка) — видно только в CRM, клиенту не показывается">Себестоимость ${modeP === 'net' ? 'нетто' : 'брутто'}</th>` : ''}${showDisc ? html`<th data-c="disc" class="r">Скидка %</th>` : ''}<th data-c="vat">VAT</th><th data-c="net" class="r">Сумма нетто</th><th data-c="gross" class="r">Сумма брутто</th>` : ''}<th></th></tr>`;
  const vatSel = (i) => html`<select class="inline-input" style="width:64px" value=${i.vat} disabled=${!editPrice} onChange=${(e) => save(i, { vat: Number(e.target.value) })}>${[...new Set([...vats, i.vat])].map((v) => html`<option value=${v}>${v}%</option>`)}</select>`;

  return html`
    ${o.only_my_jobs && html`<div class="card small muted" style="margin-bottom:12px">Показаны только ваши работы и запчасти к ним.</div>`}
    ${!quote && html`<div data-ui="order.media"><${MediaCheck} o=${o} reload=${reload} /></div>`}
    <${LaborBlock} o=${o} reload=${reload} c=${{ quote, mech, seePrice, editPrice, showDisc, units, discL, modeL, S, shown, setPrice, numIn, vatSel, lineGross, net,
      NetGrossEl: html`<${NetGross} value=${modeL} set=${(v) => { setModeL(v); keep('pc-ng-labor', v); }} />` }} />

    <div class="card tight">
      <div class="mw-bar"><h2>Товары</h2>${seePrice && html`<${NetGross} value=${modeP} set=${(v) => { setModeP(v); keep('pc-ng-parts', v); }} />`}</div>
      ${parts.length ? html`<div class="tbl-wrap"><table class="tbl items mw-items" data-cols="parts"><thead>${partsHead}</thead><tbody>
        ${parts.map((it, n) => html`<tr><td class="sub">${n + 1}</td>
          <td><input class="inline-input iname" value=${it.name} disabled=${mech} onChange=${(e) => save(it, { name: e.target.value })} />
            ${it.product_id && it.product_stock !== null && it.product_stock < it.qty ? html`<div class="stock-warn">на складе ${num(it.product_stock, 2)} — нужно заказать</div>` : ''}${!it.product_id ? html`<div class="sub">без склада</div>` : ''}</td>
          <td><input class="inline-input" style="width:120px" value=${it.code || ''} disabled=${mech} onChange=${(e) => save(it, { code: e.target.value })} /></td>
          ${!quote && html`<td><select class="inline-input" style="max-width:170px" value=${it.task_id || ''} disabled=${mech} onChange=${(e) => save(it, { task_id: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>${labor.map((l) => html`<option value=${l.id}>${l.name}</option>`)}</select></td>`}
          <td class="r">${numIn(it, 'qty', 'qty', it.qty, (v) => save(it, { qty: v }), mech, '0.1')}</td><td class="sub">${it.unit || 'szt.'}</td>
          ${seePrice && html`<td class="r">${numIn(it, 'price', 'price', shown(it, modeP), (v) => setPrice(it, modeP, v), !editPrice)}</td>
            ${showCost && html`<td class="r">${numIn(it, 'cost', 'price cost', shown(it, modeP, 'cost'), (v) => setPrice(it, modeP, v, 'cost'), !editPrice)}${it.cost > 0 ? html`<div class="sub">маржа ${zl(net(lineGross(it), it.vat) - it.qty * it.cost)}</div>` : ''}</td>`}
            ${showDisc && html`<td class="r">${numIn(it, 'discount', 'disc', it.discount, (v) => save(it, { discount: v }), !editPrice, '1')}</td>`}<td>${vatSel(it)}</td>
            <td class="r nowrap">${zl(net(lineGross(it), it.vat))}</td><td class="r nowrap"><b>${zl(lineGross(it))}</b></td>`}
          <td class="act">${!mech && html`<button class="icon-btn" title="Удалить" onClick=${() => del(it)}><${Icon} n="trash" /></button>`}</td></tr>`)}
        ${seePrice && sumRow(parts, modeP, (quote ? 5 : 6) + 1 + (showCost ? 1 : 0) + (showDisc ? 1 : 0) + 1, html`<td></td>`)}</tbody></table></div>` : html`<div class="empty" style="padding:16px">Товаров пока нет</div>`}
      ${!mech && html`<div class="mw-actions" data-ui="order.btn.addpart">
        <div class="grow" style="max-width:480px"><${Picker} placeholder="+ Со склада: название, код, EAN…" path=${(q) => 'products?q=' + encodeURIComponent(q)}
          render=${(p) => html`<b>${p.name}</b> <span class="sub">${p.code || ''} · в наличии ${num(p.stock - p.reserved, 2)} ${p.unit} · ${zl(p.sell_price)}</span>`}
          onPick=${(p) => add({ kind: 'part', product_id: p.id, name: p.name, code: p.code, qty: 1, unit: p.unit, price: p.sell_price, vat: p.vat, discount: discP })}
          extra=${{ label: 'Без склада (заказать / своя)', onClick: (q) => q && add({ kind: 'part', name: q, qty: 1, unit: 'szt.', price: 0, discount: discP }) }} /></div>
        <button class="btn sm" onClick=${() => setIc(true)}><${Icon} n="box" />От поставщика</button>
        <button class="btn sm" onClick=${() => add({ kind: 'part', name: 'Nowy towar', qty: 1, unit: 'szt.', price: 0, discount: discP })}><${Icon} n="plus" />Добавить позицию</button></div>`}
    </div>
    ${seePrice && html`<div class="mw-total"><span>Итого нетто <b>${zl(o.total_net)}</b></span><span class="big">Итого брутто: ${zl(o.total)}</span></div>`}
    ${ic && html`<${SupplierParts} o=${o} onClose=${() => { setIc(false); reload(); }} onAdd=${async (it) => { await add(it); }} />`}
    <div class="card"><label class="f">Описание для механика<textarea rows="2" value=${o.mechanic_note || ''} disabled=${mech}
      onChange=${async (e) => { await act(() => api('orders/' + o.id, { method: 'PUT', body: { mechanic_note: e.target.value } }), 'Сохранено'); }}></textarea></label>
      ${o.complaint && html`<div class="small" style="margin-top:8px"><span class="muted">Описание заказа:</span> ${o.complaint}</div>`}</div>`;
}

// ── Фото/видео «до и после»: механик отмечает, что сделал и загрузил в систему ──
function MediaCheck({ o, reload }) {
  const n = (o.files || []).filter((f) => /^(image|video)\//.test(f.mime || '')).length;
  const set = async (done) => { await act(() => api(`orders/${o.id}/media`, { body: { done } }), done ? 'Отмечено: фото/видео загружены' : 'Отметка снята'); reload(); };
  return html`<label class=${'card media-check' + (o.media_done ? ' ok' : '')}>
    <input type="checkbox" checked=${!!o.media_done} onChange=${(e) => set(e.target.checked)} />
    <${Icon} n="camera" />
    <span class="grow"><b>Фото и видео «до / после» сделаны и загружены в систему</b>
      <span class="sub">${o.media_done ? `Отметил ${o.media_done_by || ''} · ${String(o.media_done_at || '').slice(0, 16).replace('T', ' ')}` : 'Механик отмечает после загрузки во вкладку «Файлы и подписи»'}${n ? ` · в заказе файлов фото/видео: ${n}` : ''}</span></span>
  </label>`;
}
