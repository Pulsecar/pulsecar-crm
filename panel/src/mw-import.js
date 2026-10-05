// Перенос данных из Motowarsztat (app.motowarsztat.pl) в CRM.
// Данные читает скрипт tools/mw-export.js во вкладке Motowarsztat (только GET к их API) и присылает пакетами сюда.
// Каждая запись хранит mw_id («ro:123», «c:45»…), поэтому перенос можно повторять: новое добавится, изменённое обновится, дублей не будет.
import express from 'express';
import crypto from 'node:crypto';
import { all, one, run, insert, tx, getSetting, setSetting, mainDb, withDb } from './db.js';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { config } from './config.js';
import { HttpError, newCardNo, normPhone, normPlate, normVin, round2 } from './util.js';
import { recalc } from './orders.js';

const ORIGIN = 'https://app.motowarsztat.pl';
// ── доступ: одноразовый ключ, который владелец создаёт в CRM (действует 12 часов) ──
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export function newImportToken() {
  const token = crypto.randomBytes(24).toString('base64url');
  setSetting('mw_import_token', JSON.stringify({ h: sha(token), exp: Date.now() + 12 * 3600_000 }));
  return token;
}
function checkToken(req) {
  let t = null;
  try { t = JSON.parse(getSetting('mw_import_token', 'null')); } catch { /* ignore */ }
  const got = String(req.headers['x-import-token'] || '');
  if (!t || !got || t.exp < Date.now() || sha(got) !== t.h) throw new HttpError(401, 'Ключ импорта неверный или истёк — создайте новый в CRM');
}

// ── помощники ──
const s = (v, max = 2000) => { const x = v == null ? '' : String(v).trim(); return x ? x.slice(0, max) : null; };
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const d10 = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : null);
const dt = (v) => (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(String(v || '')) ? String(v).replace('T', ' ').slice(0, 19) : d10(v));
const idOf = (table, mw) => (mw ? one(`SELECT id FROM ${table} WHERE mw_id = ?`, String(mw))?.id ?? null : null);
const cols = new Map();
const colsOf = (t) => { if (!cols.has(t)) cols.set(t, new Set(all(`PRAGMA table_info(${t})`).map((c) => c.name))); return cols.get(t); };
/** вставка/обновление по mw_id; неизвестные колонки отбрасываются */
function upsert(table, mw, data) {
  const c = colsOf(table);
  const row = Object.fromEntries(Object.entries(data).filter(([k, v]) => c.has(k) && v !== undefined));
  const ex = one(`SELECT id FROM ${table} WHERE mw_id = ?`, String(mw));
  if (ex) {
    const keys = Object.keys(row);
    if (keys.length) run(`UPDATE ${table} SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map((k) => row[k]), ex.id);
    return { id: ex.id, created: false };
  }
  return { id: insert(table, { ...row, mw_id: String(mw) }), created: true };
}
const PAY = { 1: 'cash', 2: 'transfer', 3: 'card', 4: 'transfer', 5: 'blik', 6: 'card', 7: 'transfer' };
const payMethod = (v) => PAY[Number(v)] || (typeof v === 'string' && /cash|got/i.test(v) ? 'cash' : 'card');

// статусы MW → наши: по польскому названию (client_label), по словарю, иначе создаём
const STATUS_DICT = {
  'nowe zlecenie': 'Новый заказ', 'nowe': 'Новый заказ', 'w trakcie': 'В ремонте', 'w naprawie': 'В ремонте', 'w realizacji': 'В ремонте',
  'zakończone': 'Завершено', 'zakonczone': 'Завершено', 'gotowy do odbioru': 'Готов к выдаче', 'do odbioru': 'Готов к выдаче',
  'oczekuje na części': 'Ожидание запчастей', 'czeka na części': 'Ожидание запчастей', 'uzgodnienie z klientem': 'Согласование с клиентом',
  'do wyceny': 'Ожидает оценки', 'czeka na ocenę': 'Ожидает оценки', 'gotowy do przyjęcia': 'Готов к приёму', 'prace zakończone': 'Работы выполнены',
};
function statusId(st) {
  if (!st?.name) return null;
  const by = idOf('order_statuses', 'st:' + st.id);
  if (by) return by;
  const n = st.name.trim().toLowerCase();
  const ours = all('SELECT id, name, client_label FROM order_statuses');
  const hit = ours.find((x) => (x.client_label || '').trim().toLowerCase() === n || x.name.trim().toLowerCase() === n || (STATUS_DICT[n] && x.name === STATUS_DICT[n]));
  if (hit) { run('UPDATE order_statuses SET mw_id = COALESCE(mw_id, ?) WHERE id = ?', 'st:' + st.id, hit.id); return hit.id; }
  return insert('order_statuses', { name: st.name.trim(), color: st.color || '#888888', pos: 100 + (Number(st.position) || 0), is_final: st.finished ? 1 : 0,
    lock_edit: st.editBlocked ? 1 : 0, client_label: st.name.trim(), mw_id: 'st:' + st.id });
}
/** наш пост для поста MW: то же название, тот же номер в начале («1 Подьемник» = «1 Подъёмник / развал») или кондиционер */
function sameStation(name, except = 0) {
  const n = String(name || '').trim().toLowerCase();
  const list = all('SELECT id, name, mw_id FROM stations WHERE active = 1 AND id <> ? ORDER BY pos, id', except);
  const digit = n.match(/^\d+/)?.[0];
  const isAc = (x) => /klim|кондиц|a\/c/i.test(x);
  return list.find((x) => x.name.trim().toLowerCase() === n)
    || (digit && list.find((x) => x.name.trim().match(/^\d+/)?.[0] === digit && !String(x.mw_id || '').startsWith('wp:')))
    || (isAc(n) && list.find((x) => isAc(x.name) && !String(x.mw_id || '').startsWith('wp:'))) || null;
}
function stationId(w) {
  if (!w?.id) return null;
  const mine = one('SELECT id, pos FROM stations WHERE mw_id = ?', 'wp:' + w.id);
  // пост, созданный первым переносом как дубль, — сливаем с нашим (записи графика переносятся)
  if (mine && mine.pos === 50) {
    run('UPDATE stations SET mw_id = NULL WHERE id = ?', mine.id);
    const hit = sameStation(w.name, mine.id);
    if (hit && hit.id !== mine.id) {
      run('UPDATE appointments SET station_id = ? WHERE station_id = ?', hit.id, mine.id);
      run('DELETE FROM stations WHERE id = ?', mine.id);
      run('UPDATE stations SET mw_id = ? WHERE id = ?', 'wp:' + w.id, hit.id);
      return hit.id;
    }
    run('UPDATE stations SET mw_id = ?, pos = 51 WHERE id = ?', 'wp:' + w.id, mine.id);
    return mine.id;
  }
  if (mine) return mine.id;
  const hit = sameStation(w.name);
  if (hit) { run('UPDATE stations SET mw_id = ? WHERE id = ?', 'wp:' + w.id, hit.id); return hit.id; }
  return insert('stations', { name: s(w.name, 80) || 'Stanowisko', color: w.color || null, pos: 51, active: 1, mw_id: 'wp:' + w.id });
}
function staffId(w) {
  if (!w?.id) return null;
  const by = idOf('staff', 'w:' + w.id);
  if (by) return by;
  const name = [w.firstname, w.lastname].filter(Boolean).join(' ').trim() || w.name || 'Pracownik';
  const hit = one('SELECT id FROM staff WHERE lower(name) = lower(?)', name);
  if (hit) { run('UPDATE staff SET mw_id = ? WHERE id = ?', 'w:' + w.id, hit.id); return hit.id; }
  return insert('staff', { name, role: 'mechanic', is_mechanic: 1, active: w.enabled === false ? 0 : 1, color: w.color || null, hourly_rate: num(w.manHourCost), mw_id: 'w:' + w.id });
}
function typeId(k) {
  if (!k?.id) return null;
  const by = idOf('order_types', 'k:' + k.id);
  if (by) return by;
  const hit = k.name && one('SELECT id FROM order_types WHERE lower(name) = lower(?)', k.name.trim());
  if (hit) { run('UPDATE order_types SET mw_id = ? WHERE id = ?', 'k:' + k.id, hit.id); return hit.id; }
  return insert('order_types', { name: s(k.name, 80), pos: 50, mw_id: 'k:' + k.id });
}
function registerId(box) {
  if (!box?.id) return null;
  const by = idOf('cash_registers', 'cb:' + box.id);
  if (by) return by;
  const hit = box.name && one('SELECT id FROM cash_registers WHERE lower(name) = lower(?)', box.name.trim());
  if (hit) { run('UPDATE cash_registers SET mw_id = ? WHERE id = ?', 'cb:' + box.id, hit.id); return hit.id; }
  return insert('cash_registers', { name: s(box.name, 80) || 'Kasa', kind: 'cash', opening: 0, active: 1, pos: 10, mw_id: 'cb:' + box.id });
}
const vatOf = (v) => (v && typeof v === 'object' ? (v.exempt || v.notSubject ? 0 : num(v.value)) : v == null ? 23 : num(v));

// ── сущности ──
function importCustomer(c) {
  const company = c.type === 'company' ? s(c.name, 200) : null;
  const person = [c.firstname, c.lastname].filter(Boolean).join(' ').trim();
  let phone = c.phoneNumber?.number ? normPhone((c.phoneNumber.countryCode === 'PL' || !c.phoneNumber.countryCode ? '' : '') + c.phoneNumber.number) : null;
  const mine = idOf('customers', 'c:' + c.id);
  if (phone) { const other = one('SELECT id FROM customers WHERE phone = ?', phone); if (other && other.id !== mine) phone = null; }
  const data = {
    kind: company ? 'company' : 'person', name: person || company || null, first_name: s(c.firstname, 80), last_name: s(c.lastname, 80), company,
    nip: s(c.nip, 20), email: s(c.email, 120), street: s(c.street, 160), postcode: s(c.postalCode, 12), city: s(c.city, 80), country: s(c.countryCode, 2) || 'PL',
    notes: s(c.description), discount_labor: num(c.discountJobs), discount_parts: num(c.discountParts), marketing_consent: c.marketingAgreement === false ? 0 : 1,
    payment_method: c.paymentMethod ? payMethod(c.paymentMethod) : null, payment_term_days: c.paymentDays ? Number(c.paymentDays) : null,
    created_at: dt(c.createdAt) || undefined,
  };
  if (phone || !mine) data.phone = phone;
  if (!mine) data.card_no = newCardNo();
  return upsert('customers', 'c:' + c.id, data);
}
function importCar(v, ownerMw) {
  const vin = normVin(v.vin) || null, plate = normPlate(v.registrationNumber) || null;
  const customerId = idOf('customers', 'c:' + (ownerMw || v.currentOwner?.id || v.client?.id || ''));
  const r = upsert('cars', 'v:' + v.id, {
    customer_id: customerId ?? undefined, car_key: vin || plate || 'MW' + v.id, plate, vin, make: s(v.brand || v.carMake?.name, 60), model: s(v.model || v.carModel?.name, 80),
    year: v.productionDate ? String(v.productionDate).slice(0, 4) : null, capacity: v.capacity ? Math.round(num(v.capacity)) || null : null,
    fuel: s(v.engine, 30), engine_no: s(v.engineCode, 40), power_kw: v.enginePower ? Math.round(num(v.enginePower) * (/km|hp/i.test(v.enginePowerUnit || '') ? 0.7355 : 1)) || null : null,
    color: s(v.color, 40), paint_code: s(v.paintCode, 30), key_no: s(v.keyNumber, 30), inspection_until: d10(v.technicalInspectionEnd), insurance_until: d10(v.insuranceEnd),
    first_reg: d10(v.firstRegistration), notes: s(v.description), vehicle_type: s(v.carType?.name, 60), mileage_unit: /mi/i.test(v.mileageUnit || '') ? 'mi' : 'km',
    created_at: dt(v.createdAt) || undefined,
  });
  if (customerId) run('UPDATE customers SET default_car_id = COALESCE(default_car_id, ?) WHERE id = ?', r.id, customerId);
  return r;
}
function importProduct(wp) {
  const p = wp.product || wp;
  const count = num(wp.count);
  const pg = (p.priceGroups || []).find((g) => g.workshopProductPriceGroup?.default) || (p.priceGroups || [])[0];
  return upsert('products', 'p:' + p.id, {
    name: s(p.name, 200) || 'Towar', code: s(p.code, 60), manufacturer: s(p.manufacturer?.name, 80), unit: s(p.unit, 12) || 'szt.', vat: vatOf(p.vat),
    stock: wp.product ? count : undefined, min_stock: num(wp.thresholdCountMin), purchase_price: wp.product && count > 0 ? round2(num(wp.value) / count) : round2(num(p.priceNet)),
    sell_price: round2(num(pg?.priceGross ?? pg?.price ?? p.priceGross)), location: s(p.localization, 60), ean: s((p.eanCodes || [])[0]?.ean, 40),
    gtu: s(p.gtu, 10), created_at: dt(p.createdAt) || undefined, active: 1,
  });
}
function importCatalog(j) {
  return upsert('service_catalog', 'jt:' + j.id, {
    name: s(j.name, 200) || 'Usługa', category: s(j.jobCategory?.name, 80), unit: Number(j.unitWork) === 1 ? 'rbh' : 'oper',
    qty: num(j.quantityEstimated) || 1, price: round2(num(j.price) * 1.23), vat: 23, source: 'motowarsztat', active: 1,
  });
}

/** Заказ (repair order) или выцена (quotation) со всеми позициями и записью в графике */
function importOrder(o, kind) {
  const pre = kind === 'quote' ? 'q:' : 'ro:';
  const customerId = idOf('customers', 'c:' + (o.client?.id || ''));
  const carId = idOf('cars', 'v:' + (o.vehicle?.id || ''));
  let number = s(o.number, 40) || `${kind === 'quote' ? 'WY' : 'ZL'} MW-${o.id}`;
  const clash = one('SELECT id, mw_id FROM orders WHERE number = ?', number);
  if (clash && clash.mw_id !== pre + o.id) number = `${number} (MW)`;
  const st = kind === 'order' ? statusId(o.status) : null;
  const closed = closedAt(o, kind);
  const data = {
    kind, number, customer_id: customerId, car_id: carId, status_id: st ?? undefined, type_id: typeId(o.kind) ?? undefined,
    mechanic_id: staffId(o.workerDefault) ?? undefined, mileage: o.mileage ? Math.round(num(o.mileage)) : null, fuel_level: o.fuelLevel != null ? String(o.fuelLevel) : null,
    complaint: s(o.description), internal_note: s(o.internalDescription), mechanic_note: s(o.descriptionForMechanic), faults: s(o.detectedFaults),
    damages_note: s(o.damagesDescription), after_notes: s(o.remarksAfterEnd), contact_person: s(o.contactPerson, 120),
    contact_phone: o.contactPhone?.number ? normPhone(o.contactPhone.number) : null, pickup_at: dt(o.deadlineDate), external_no: s(o.externalNumber, 60),
    notes: kind === 'quote' ? s(o.comments) : undefined, source: 'motowarsztat', created_by: 'Motowarsztat',
    created_at: dt(o.date || o.createdAt) || undefined, closed_at: closed,
    flags: kind === 'order' ? JSON.stringify({ return_parts: !!o.recoverPartsToClient, reg_doc: !!o.vehicleRegistrationLeft, test_drive: !!o.testDrive, fluids: !!o.operatingFluids, lights: !!o.improveLighting }) : undefined,
  };
  if (kind === 'quote' && !idOf('orders', pre + o.id)) data.status_id = one(`SELECT id FROM order_statuses WHERE name LIKE 'Ожидает оценки%' ORDER BY pos LIMIT 1`)?.id ?? null;
  const r = upsert('orders', pre + o.id, data);
  // позиции: пересобираем целиком (MW — источник правды)
  run('DELETE FROM order_items WHERE order_id = ?', r.id);
  let pos = 0;
  const jobIds = new Map();
  for (const j of o.jobs || []) {
    const qty = num(j.quantityFinal ?? j.quantityEstimated ?? j.quantity) || 1;
    const gross = j.totalGross != null && qty ? round2(num(j.totalGross) / qty / (1 - num(j.discount) / 100 || 1)) : round2(num(j.price) * (1 + vatOf(j.vat) / 100));
    const id = insert('order_items', { order_id: r.id, kind: 'labor', name: s(j.name, 300) || 'Usługa', qty, unit: Number(j.unitWork) === 1 ? 'rbh' : 'oper',
      price: gross, discount: num(j.discount), vat: vatOf(j.vat), done: kind === 'order' && Number(j.status) === 99 ? 1 : 0, pos: ++pos,
      mechanic_id: staffId(j.jobWorkers?.[0]?.worker) });
    jobIds.set(j.id, id);
  }
  for (const p of o.parts || []) {
    const qty = num(p.count ?? p.quantity) || 1;
    // «price» в MW бывает и нетто, и брутто (настройка заказа) — надёжна только сумма строки: цена до скидки = сумма / кол-во / (1 − скидка)
    const disc = num(p.discount);
    const gross = p.totalGross != null ? round2(num(p.totalGross) / qty / ((1 - disc / 100) || 1)) : p.priceGross != null ? round2(num(p.priceGross)) : round2(num(p.price) * (1 + vatOf(p.vat) / 100));
    const prod = p.warehouseProduct?.product?.id || p.product?.id || p.warehouseProduct?.productId;
    insert('order_items', { order_id: r.id, kind: 'part', name: s(p.name, 300) || 'Część', code: s(p.code, 60), qty, unit: s(p.unit, 12) || 'szt.',
      price: gross, discount: num(p.discount), vat: vatOf(p.vat), cost: round2(num(p.costNet)), pos: ++pos, product_id: prod ? idOf('products', 'p:' + prod) : null,
      task_id: p.job ? jobIds.get(typeof p.job === 'object' ? p.job.id : Number(String(p.job).split('/').pop())) ?? null : null });
  }
  recalc(r.id);
  // запись в графике (терминарз): пост + дата приёма
  if (kind === 'order' && o.workplace?.id && o.dateAdmission) {
    const start = dt(o.dateAdmission).slice(0, 16);
    const end = dt(o.dateFinish);
    let dur = end && end.slice(0, 10) === start.slice(0, 10) ? Math.round((new Date(end.replace(' ', 'T')) - new Date(start.replace(' ', 'T'))) / 60000) : 0;
    if (!(dur > 0)) dur = Math.round(Math.max(0.5, (o.jobs || []).reduce((a, j) => a + (Number(j.unitWork) === 1 ? num(j.quantityEstimated) : 0), 0) || 1) * 60);
    upsert('appointments', 'ap:' + o.id, { order_id: r.id, station_id: stationId(o.workplace), customer_id: customerId, car_id: carId, title: number,
      start_at: start, duration_min: Math.min(dur, 16 * 60), status: o.status?.finished ? 'arrived' : 'planned', source: 'motowarsztat' });
  }
  if (kind === 'quote' && o.comments && String(o.comments).trim()) upsert('order_comments', 'qc:' + o.id, { order_id: r.id, staff: 'Motowarsztat', text: s(o.comments), at: dt(o.updatedAt) || undefined });
  // «Opis wewnętrzny» — это комментарии сотрудников в MW (колонка в списках выцен / заказов) → комментарий в CRM
  if (s(o.internalDescription)) upsert('order_comments', 'ic:' + pre + o.id, { order_id: r.id, staff: 'Motowarsztat', text: s(o.internalDescription), at: dt(o.updatedAt) || dt(o.date || o.createdAt) || undefined });
  else run('DELETE FROM order_comments WHERE mw_id = ?', 'ic:' + pre + o.id);
  return r;
}

/** Дата завершения заказа: фактическая (dateFinish). dateCompletion в MW — ПЛАНОВАЯ дата готовности, её брать нельзя */
function closedAt(o, kind = 'order') {
  return kind === 'order' && o.status?.finished ? dt(o.dateFinish || o.updatedAt) : null;
}
/** Только поправить дату завершения уже перенесённого заказа (позиции, статусы и правки в CRM не трогаем) */
function fixOrderDates(o) {
  const id = idOf('orders', 'ro:' + o.id);
  if (!id) return { skipped: true };
  run('UPDATE orders SET closed_at = ? WHERE id = ?', closedAt(o), id);
  return { id };
}

function importSale(d) {
  const orderMw = (d.repairOrders || [])[0]?.id;
  const orderId = orderMw ? idOf('orders', 'ro:' + orderMw) : null;
  const items = (d.items || []).map((i) => {
    const v = vatOf(i.vat), qty = num(i.count) || 1, net = round2(num(i.totalNet)), gross = round2(num(i.totalGross));
    return { name: s(i.name, 300), code: null, kind: i.repairOrderPartId || i.warehouseProduct ? 'part' : 'labor', qty, unit: s(i.unit, 12) || 'szt.',
      unit_net: round2(num(i.price)), discount: num(i.discount), vat: v, net, vat_amt: round2(gross - net), gross };
  });
  const cd = d.clientDetails || {};
  const buyer = { name: s(cd.name, 200) || 'Klient detaliczny', nip: (cd.nip || '').replace(/[^\dA-Z]/gi, ''), street: cd.street || '', postcode: cd.postalCode || '', city: cd.city || '' };
  const paid = round2(num(d.paidTotal));
  if (d.type === 'receiptFiscal' || /receipt|paragon/i.test(d.type || '')) {
    const r = upsert('receipts', 'sd:' + d.id, { order_id: orderId, number: s(d.number, 40), nip: buyer.nip || null, total: round2(num(d.totalGross)),
      payment_method: payMethod(d.paymentMethod), items: JSON.stringify({ lines: items }), status: 'printed', printer: 'motowarsztat', staff: 'Motowarsztat',
      created_at: dt(d.date || d.createdAt) || undefined, printed_at: dt(d.date || d.createdAt) });
    if (orderId && d.number) run(`UPDATE orders SET receipt_no = COALESCE(receipt_no, ?) WHERE id = ?`, String(d.number), orderId);
    importSalePayments(d, orderId);
    return r;
  }
  const kind = /correct|koryg/i.test(d.type || '') ? 'correction' : /proforma|pro-forma|pro_forma/i.test(d.type || '') ? 'proforma' : 'vat';
  const net = round2(num(d.totalNet)), gross = round2(num(d.totalGross));
  const r = upsert('sales_docs', 'sd:' + d.id, {
    kind, number: s(d.number, 60) || 'MW-' + d.id, order_id: orderId, issue_date: d10(d.date || d.createdAt) || d10(new Date().toISOString()),
    sale_date: d10(d.dateDisposal) || d10(d.date), due_date: d10(d.datePayment), payment_method: payMethod(d.paymentMethod), paid: kind === 'proforma' ? 0 : paid,
    buyer: JSON.stringify(buyer), items: JSON.stringify(items), total_net: net, total_vat: round2(gross - net), total_gross: gross, notes: s(d.description),
    ext_id: d.fakturowniaId ? String(d.fakturowniaId) : null, ksef: 0, ksef_status: d.ksefNumber ? 'accepted' : null, ksef_number: s(d.ksefNumber, 60),
    created_by: 'Motowarsztat', created_at: dt(d.createdAt) || undefined,
  });
  if (orderId && kind === 'vat' && d.number) run('UPDATE orders SET invoice_no = COALESCE(invoice_no, ?) WHERE id = ?', String(d.number), orderId);
  if (kind !== 'proforma') importSalePayments(d, orderId);
  return r;
}
/** оплаты документа продажи → оплаты заказа (касса / терминал / перевод) */
function importSalePayments(d, orderId) {
  const customerId = idOf('customers', 'c:' + (d.client?.id || ''));
  for (const p of d.payments || []) {
    const v = round2(num(p.value));
    const method = payMethod(p.paymentMethod);
    // отрицательная оплата = возврат клиенту (корректа): KW из кассы / возврат на карту. Наличный «возврат» без документа KW в кассе MW не проводился — пропускаем
    if (!v || (v < 0 && method === 'cash' && !p.cashBoxDocumentNumber)) { run('DELETE FROM payments WHERE mw_id = ?', 'sp:' + p.id); continue; }
    upsert('payments', 'sp:' + p.id, { number: s(p.cashBoxDocumentNumber, 40), direction: v < 0 ? 'out' : 'in', method, amount: Math.abs(v), order_id: v < 0 ? null : orderId, customer_id: customerId,
      note: `${v < 0 ? 'Zwrot · ' : ''}${d.number || ''} (Motowarsztat)`.trim(), staff: 'Motowarsztat', created_at: dt(p.date) || dt(d.date) || undefined,
      register_id: p.cashBoxId ? registerId({ id: p.cashBoxId, name: p.cashBoxName }) : undefined });
  }
  if (orderId) recalc(orderId);
}
/** документы кассы: KP без документа продажи (прочий приход) и KW (расход) */
function importCash(c) {
  const items = c.items || [];
  if (items.length && items.every((i) => i.saleDocumentId)) return { skipped: true }; // уже учтено как оплата документа продажи
  const out = /^KW/i.test(c.number || '') || num(c.total) < 0;
  return upsert('payments', 'cb:' + c.id, { number: s(c.number, 40), direction: out ? 'out' : 'in', method: 'cash', amount: Math.abs(round2(num(c.total))),
    customer_id: idOf('customers', 'c:' + (c.client?.id || '')), note: s(items.map((i) => i.name).filter(Boolean).join('; ') || c.description, 500),
    staff: 'Motowarsztat', created_at: dt(c.date || c.createdAt) || undefined, register_id: registerId(c.cashBox) ?? undefined });
}
function importSms(m) {
  const phone = m.phoneNumber?.number ? normPhone(m.phoneNumber.number) : null;
  if (!phone || !m.content) return { skipped: true };
  return upsert('sms_log', 'sms:' + m.id, { phone, customer_id: idOf('customers', 'c:' + (m.client?.id || '')), order_id: m.repairOrderId ? idOf('orders', 'ro:' + m.repairOrderId) : null,
    kind: s(m.reminderType, 30) || 'motowarsztat', text: String(m.content).slice(0, 2000), provider: 'motowarsztat',
    status: /err|fail/i.test(m.status || '') || m.errorMessage ? 'failed' : 'sent', error: s(m.errorMessage, 300), staff: 'Motowarsztat',
    created_at: dt(m.sendAt || m.createdAt) || undefined });
}
const WD_TYPE = { pz: 'PZ', wz: 'WZ', rw: 'RW', pw: 'PW', mm: 'MM', inw: 'PW', zw: 'PZ' };
/** складские документы — только история (остатки берутся из карточек товаров MW и не пересчитываются) */
function importStockDoc(w) {
  const t = String(w.type || w.number || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 3);
  const type = WD_TYPE[t] || WD_TYPE[t.slice(0, 2)] || (String(w.number || '').match(/^[A-Z]{2}/)?.[0]) || 'PZ';
  let number = s(w.number, 60) || 'MW-' + w.id;
  const clash = one('SELECT mw_id FROM stock_docs WHERE number = ?', number);
  if (clash && clash.mw_id !== 'wd:' + w.id) number += ' (MW)';
  const r = upsert('stock_docs', 'wd:' + w.id, { type, number, ext_number: s(w.externalDocumentNumber, 60), counterparty: s(w.clientDetails?.name, 200),
    doc_date: d10(w.date || w.createdAt) || d10(new Date().toISOString()), note: s(w.description), total_net: round2(num(w.totalNet)), created_by: 'Motowarsztat',
    created_at: dt(w.createdAt) || undefined });
  run('DELETE FROM stock_doc_items WHERE doc_id = ?', r.id);
  for (const i of w.items || []) {
    const pid = idOf('products', 'p:' + (i.warehouseProduct?.product?.id || i.warehouseProduct?.productId || ''));
    if (pid) insert('stock_doc_items', { doc_id: r.id, product_id: pid, qty: num(i.count), price_net: round2(num(i.price)) });
  }
  return r;
}

const HANDLERS = {
  workers: (x) => ({ id: staffId(x) }),
  workplaces: (x) => ({ id: stationId(x) }),
  clients: importCustomer,
  vehicles: (x) => importCar(x),
  products: importProduct,
  'job-templates': importCatalog,
  'repair-orders': (x) => importOrder(x, 'order'),
  'repair-order-dates': fixOrderDates,
  quotations: (x) => importOrder(x, 'quote'),
  'sale-documents': importSale,
  'cash-box-documents': importCash,
  'sms-messages': importSms,
  'warehouse-documents': importStockDoc,
};

/** Сохранить копию базы и удалить тестовые данные (клиенты, авто, заказы, склад, документы). Настройки, сотрудники, статусы, посты остаются. */
export function wipeForImport() {
  const dir = join(dirname(config.dbPath), 'backups');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `before-mw-import-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`);
  mainDb.exec(`VACUUM INTO '${file}'`);
  const t = ['order_comments', 'order_checklists', 'order_signatures', 'order_files', 'order_items', 'car_recommendations', 'appointments', 'receipts', 'sales_docs', 'payments',
    'stock_doc_items', 'stock_docs', 'storage', 'transactions', 'sessions', 'sms_log', 'orders', 'cars', 'customers', 'products'];
  tx(() => {
    run('PRAGMA defer_foreign_keys = ON');
    for (const x of t) { try { run(`DELETE FROM ${x}`); } catch { /* таблицы может не быть */ } }
  });
  return { backup: file };
}

export const mwImport = express.Router();
mwImport.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Import-Token');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
mwImport.use(express.json({ limit: '25mb' }));
mwImport.post('/:entity', (req, res) => {
  withDb(mainDb, () => {
    checkToken(req);
    const h = HANDLERS[req.params.entity];
    if (!h) throw new HttpError(404, 'Неизвестный раздел');
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    let created = 0, updated = 0, skipped = 0;
    const errors = [];
    for (const x of items) {
      try {
        const r = tx(() => h(x));
        if (r?.skipped) skipped++; else if (r?.created) created++; else updated++;
      } catch (e) { errors.push({ id: x?.id, error: String(e.message).slice(0, 200) }); }
    }
    res.json({ created, updated, skipped, errors: errors.slice(0, 20), failed: errors.length });
  });
});
