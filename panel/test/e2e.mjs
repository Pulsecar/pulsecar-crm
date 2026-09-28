// Сквозной тест панели и API приложения. Запуск: npm test
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { sha256 } from 'js-sha256'; // та же библиотека, что и в мобильном приложении

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const DB = './data/test.db';
for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });

let out = '';
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, PORT, DB_PATH: DB, ADMIN_PASSWORD: 'test-pass-123', SMS_PROVIDER: 'console', SESSION_SECRET: 'x'.repeat(40), PUBLIC_URL: 'http://localhost', SMS_ON_STATUS: '1' },
});
srv.stdout.on('data', (d) => (out += d));
srv.stderr.on('data', (d) => process.stderr.write(d));
for (let i = 0; i < 60; i++) { try { await fetch(BASE + "/"); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

const jars = { admin: '', mech: '' };
let who = 'admin';
async function req(path, { body, form, token, method } = {}) {
  const r = await fetch(BASE + path, {
    method: method || (body || form ? 'POST' : 'GET'),
    headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), ...(jars[who] ? { Cookie: jars[who] } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const sc = r.headers.get('set-cookie');
  if (sc) jars[who] = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, j: ct.includes('json') ? await r.json() : await r.text() };
}
const ok = (x, msg) => { assert.ok(x.status < 300, `${msg}: ${x.status} ${JSON.stringify(x.j).slice(0, 300)}`); return x.j; };
const step = (ms = Date.now()) => Math.floor(ms / 30000);
const qrFor = (secret, card, st = step()) => `PCQ1.${card}.${st}.${sha256.hmac(secret, `${card}.${st}`).slice(0, 16)}`;
const code6 = (secret, card, st = step()) => String(parseInt(sha256.hmac(secret, `${card}.${st}`).slice(-8), 16) % 1e6).padStart(6, '0');
const upload = (name, content) => { const fd = new FormData(); fd.append('file', new Blob([content]), name); return fd; };

try {
  ok(await req('/crm-api/login', { body: { login: 'admin', password: 'test-pass-123' } }), 'admin login');
  const me = ok(await req('/crm-api/me'), 'me');
  assert.equal(me.statuses.length, 9); assert.equal(me.stations.length, 5);
  const done = me.statuses.find((s) => s.is_final && s.lock_edit);
  const inRepair = me.statuses.find((s) => s.name === 'В ремонте');
  console.log('✓ вход в панель, справочники: 9 статусов, 5 постов,', me.staff.length, 'сотрудников');

  // 1. импорт: клиенты, авто, заказы (польский CSV из Motowarsztat)
  let s = ok(await req('/crm-api/import', { form: upload('klienci.csv', 'Imię;Nazwisko;Numer telefonu;E-mail;NIP\nJan;Kowalski;600 111 222;jan@x.pl;\nAnna;Nowak;+48 511 000 999;;5213000000\n') }), 'import clients');
  assert.equal(s.type, 'customers'); assert.equal(s.newCustomers, 2);
  s = ok(await req('/crm-api/import', { form: upload('pojazdy.csv', "Marka / Model;Nr rejestracyjny;VIN;Właściciel;Rok prod.;Pojemność;Silnik;Moc silnika\nBMW 320d;WA 12345;WBA8E9C50GK123456;Jan Kowalski;2016;1995;diesel;140 kW\n") }), 'import cars');
  assert.equal(s.type, 'cars'); assert.equal(s.cars, 1);
  const csv = 'Telefon;Nr rejestracyjny;Nr zlecenia;Data;Przebieg;Usługa;Typ;Ilość;Cena;Suma\n'
    + '600111222;WA 12345;ZL 7/06/2026;11.06.2026;176 200;Wymiana klocków;usługa;1;300,00;1450,00\n'
    + '600111222;WA 12345;ZL 7/06/2026;11.06.2026;176 200;Tarcze ATE;towar;2;380,00;1450,00\n';
  s = ok(await req('/crm-api/import', { form: upload('zlecenia.csv', csv) }), 'import orders');
  assert.equal(s.type, 'orders'); assert.equal(s.visits, 1); assert.equal(s.items, 2);
  s = ok(await req('/crm-api/import', { form: upload('zlecenia.csv', csv) }), 'reimport');
  const custs = ok(await req('/crm-api/customers?q=Kowalski'), 'search');
  assert.equal(custs.total, 1);
  const jan = ok(await req('/crm-api/customers/' + custs.rows[0].id), 'customer');
  assert.equal(jan.cars.length, 1); assert.equal(jan.cars[0].power_kw, 140); assert.equal(jan.orders.length, 1); assert.equal(jan.orders[0].total, 1450);
  console.log('✓ импорт клиентов, авто и заказов; повторная загрузка без дублей');

  // 2. приход на склад
  const pz = ok(await req('/crm-api/stock-docs', { body: { type: 'PZ', counterparty: 'INTER CARS S.A.', items: [{ name: 'Filtr oleju', code: 'W712', qty: 10, price_net: 24.5, sell_price: 55 }] } }), 'PZ');
  const prod = ok(await req('/crm-api/products?q=W712'), 'products').rows[0];
  assert.equal(prod.stock, 10); assert.equal(prod.purchase_price, 24.5);
  console.log('✓ приход PZ: остаток 10, цена закупки обновлена');

  // 3. клиент регистрируется в приложении
  ok(await req('/api/auth/request', { body: { phone: '600111222', lang: 'pl' } }), 'otp');
  await new Promise((r) => setTimeout(r, 200));
  const code = out.match(/\+48600111222\] .*?(\d{6})/)[1];
  const sess = ok(await req('/api/auth/verify', { body: { phone: '600111222', code } }), 'verify');
  let appMe = ok(await req('/api/me', { token: sess.token }), 'app me');
  assert.equal(appMe.loyalty.balance, 50); assert.equal(appMe.cars[0].visits.length, 1);
  console.log('✓ приложение: вход, бонус 50, история из CRM видна');

  // 4. заявка из приложения → «не распределено»
  ok(await req('/api/bookings', { token: sess.token, body: { name: 'Jan', phone: '600111222', service: 'Klimatyzacja', preferred: 'wtorek' } }), 'booking');
  let cal = ok(await req('/crm-api/appointments?from=2026-01-01&to=2026-01-01'), 'appointments');
  const reqA = cal.unassigned.find((a) => a.source === 'app');
  assert.ok(reqA && reqA.customer_id === jan.id && reqA.status === 'request');
  ok(await req('/crm-api/appointments/' + reqA.id, { method: 'PUT', body: { station_id: 1, start_at: '2026-10-01 10:00', duration_min: 120 } }), 'plan');
  const clash = await req('/crm-api/appointments', { body: { station_id: 1, start_at: '2026-10-01 11:00', duration_min: 60, title: 'x' } });
  assert.equal(clash.status, 409);
  ok(await req('/crm-api/appointments', { body: { station_id: 1, start_at: '2026-10-01 12:00', duration_min: 60, title: 'после' } }), 'no clash');
  cal = ok(await req('/crm-api/appointments?from=2026-10-01&to=2026-10-01'), 'day');
  assert.equal(cal.rows.length, 2); assert.equal(cal.rows[0].status, 'planned');
  console.log('✓ заявка из приложения распределена на пост; пересечение по времени отклонено');

  // 5. заказ: работы + деталь со склада → оплата баллами → завершение
  const order = ok(await req('/crm-api/orders', { body: { customer_id: jan.id, car_id: jan.cars[0].id, complaint: 'Olej', appointment_id: reqA.id } }), 'order');
  let o = ok(await req('/crm-api/orders/' + order.id), 'order get');
  assert.match(o.number, /^ZL 1\/\d{2}\/\d{4}$/);
  ok(await req(`/crm-api/orders/${o.id}/items`, { body: { kind: 'labor', name: 'Wymiana oleju', qty: 1, price: 120, mechanic_id: me.staff.find((x) => x.is_mechanic).id } }), 'labor');
  ok(await req(`/crm-api/orders/${o.id}/items`, { body: { kind: 'part', product_id: prod.id, name: prod.name, qty: 2, price: 55 } }), 'part');
  ok(await req(`/crm-api/orders/${o.id}/items`, { body: { kind: 'part', name: 'Olej 5W30 5L', qty: 1, price: 1825 } }), 'free part');
  o = ok(await req('/crm-api/orders/' + order.id), 'order get2');
  assert.equal(o.total, 2055); assert.equal(o.cost, 49);
  let p = ok(await req('/crm-api/products/' + prod.id), 'prod'); assert.equal(p.reserved, 2);
  // статус с SMS
  const stRes = ok(await req(`/crm-api/orders/${o.id}/status`, { body: { status_id: inRepair.id } }), 'status');
  // как в Motowarsztat: окно с готовой SMS по шаблону статуса (со ссылкой на карту заказа)
  assert.ok(stRes.sms, 'нет готовой SMS для статуса');
  assert.match(stRes.sms.text, /karta zlecenia dla .*\n\nhttps?:\/\/[^\s]+\/k\/[\w-]+/i);
  ok(await req(`/crm-api/orders/${o.id}/sms`, { body: { text: stRes.sms.text, kind: 'status' } }), 'status sms');
  await new Promise((r) => setTimeout(r, 150));
  assert.match(out, /\[SMS → \+48600111222\] Ponizej karta zlecenia/);
  // скан QR клиента в заказе и списание
  const sc = ok(await req(`/crm-api/orders/${o.id}/scan`, { body: { qr: qrFor(sess.qrSecret, sess.cardNo) } }), 'scan');
  assert.equal(sc.limits.max, 0); // 50 баллов < минимума 100
  ok(await req(`/crm-api/customers/${jan.id}/adjust`, { body: { points: 250, note: 'тест' } }), 'adjust');
  const sc2 = ok(await req(`/crm-api/orders/${o.id}/scan`, { body: { who: '600111222', code: code6(sess.qrSecret, sess.cardNo, step() + 1) } }), 'scan2');
  assert.equal(sc2.limits.max, 300);
  ok(await req(`/crm-api/orders/${o.id}/redeem`, { body: { ticket: sc2.ticket, points: 300 } }), 'redeem');
  ok(await req(`/crm-api/orders/${o.id}/payments`, { body: { method: 'cash', amount: 2025 } }), 'pay');
  o = ok(await req('/crm-api/orders/' + order.id), 'order get3');
  assert.equal(o.paid, 2055); assert.match(o.payments.find((x) => x.method === 'cash').number, /^KP 1\//);
  const fin = ok(await req(`/crm-api/orders/${o.id}/status`, { body: { status_id: done.id } }), 'close');
  assert.equal(fin.earned, 1012); // (2055 − 30 баллами) × 0,5
  p = ok(await req('/crm-api/products/' + prod.id), 'prod2'); assert.equal(p.stock, 8); assert.equal(p.reserved, 0);
  appMe = ok(await req('/api/me', { token: sess.token }), 'app me2');
  assert.equal(appMe.loyalty.balance, 50 + 250 - 300 + 1012);
  assert.equal(appMe.cars[0].visits.length, 2);
  console.log('✓ заказ ZL: баллы −300 (=30 zł), оплата наличными KP, завершение → +1012 баллов, склад −2 (WZ)');
  // возврат статуса → склад восстановлен
  ok(await req(`/crm-api/orders/${o.id}/status`, { body: { status_id: inRepair.id } }), 'reopen');
  p = ok(await req('/crm-api/products/' + prod.id), 'prod3'); assert.equal(p.stock, 10);
  ok(await req(`/crm-api/orders/${o.id}/status`, { body: { status_id: done.id } }), 'close again');
  appMe = ok(await req('/api/me', { token: sess.token }), 'app me3');
  assert.equal(appMe.loyalty.balance, 1012, 'баллы не начисляются второй раз');
  console.log('✓ переоткрытие возвращает запчасти на склад; повторное завершение не даёт баллы дважды');

  // 6. смета → заказ, печать, фактура без настроек
  const q = ok(await req('/crm-api/orders', { body: { kind: 'quote', customer_id: jan.id, items: [{ kind: 'labor', name: 'Rozrząd', price: 1000 }] } }), 'quote');
  const qq = ok(await req('/crm-api/orders/' + q.id), 'quote get');
  assert.match(qq.number, /^WYC 1\//);
  const conv = ok(await req(`/crm-api/orders/${q.id}/to-order`, { body: {} }), 'to order');
  const co = ok(await req('/crm-api/orders/' + conv.id), 'conv get');
  assert.equal(co.total, 1000); assert.equal(co.kind, 'order'); assert.equal(co.quote_id, q.id);
  const pr = await req('/crm-api/print/order/' + o.id);
  assert.equal(pr.status, 200); assert.ok(pr.j.includes('Specyfikacja zlecenia') && pr.j.includes('Wymiana oleju'));
  for (const [t, title] of [['intake', 'Protokół przyjęcia'], ['mechanic', 'Karta dla mechanika'], ['estimate', 'Kosztorys'], ['release', 'Protokół wydania']]) {
    const d = await req(`/crm-api/print/${t}/${o.id}`); assert.equal(d.status, 200, t); assert.ok(d.j.includes(title), t);
  }
  const pf = ok(await req(`/crm-api/orders/${o.id}/sales-docs`, { body: { kind: 'proforma' } }), 'proforma');
  const fv = ok(await req(`/crm-api/orders/${o.id}/sales-docs`, { body: { kind: 'vat', payment_method: 'cash' } }), 'fv');
  assert.match(pf.number, /^PRO /); assert.match(fv.number, /^FV /);
  assert.equal((await req(`/crm-api/orders/${o.id}/sales-docs`, { body: { kind: 'vat' } })).status, 409, 'вторая фактура VAT — нельзя');
  const fvh = await req('/crm-api/print/sale/' + fv.id); assert.ok(fvh.j.includes('Faktura VAT') && fvh.j.includes('Słownie') && fvh.j.includes('Nabywca'));
  const fk = ok(await req(`/crm-api/sales-docs/${fv.id}/correct`, { body: { reason: 'Zwrot', lines: [{ qty: 0 }] } }), 'fk');
  assert.ok(fk.total_gross < fv.total_gross);
  console.log('✓ документы: протоколы, спецификация, карта механика, kosztorys, фактура VAT, Pro forma, корректа');
  assert.equal((await req(`/crm-api/orders/${co.id}/invoice`, { body: {} })).status, 400);
  console.log('✓ смета WY → заказ, печать карты заказа, фактура требует настройки Fakturownia');

  // 7. касса Pulse Points без заказа
  const ps = ok(await req('/crm-api/pos/scan', { body: { qr: qrFor(sess.qrSecret, sess.cardNo, step() - 1) } }), 'pos scan');
  const pc = ok(await req('/crm-api/pos/checkout', { body: { ticket: ps.ticket, orderTotal: 100, orderNo: 'PAR-1' } }), 'pos checkout');
  assert.equal(pc.earn, 50);
  assert.equal((await req('/crm-api/pos/scan', { body: { qr: qrFor(sess.qrSecret, sess.cardNo, step() - 1) } })).status, 409);
  console.log('✓ касса без заказа: +50; повторный QR отклонён');

  // 8. хранение шин, закупки, касса KW, отчёты
  ok(await req('/crm-api/storage', { body: { customer_id: jan.id, description: '205/55 R16', location: 'A-3' } }), 'storage');
  ok(await req('/crm-api/purchases', { body: { supplier: 'INTER CARS', net: 100, paid: 0 } }), 'purchase');
  ok(await req('/crm-api/cash', { body: { direction: 'out', amount: 500, note: 'Инкассация' } }), 'KW');
  const cash = ok(await req('/crm-api/cash'), 'cash');
  assert.equal(cash.cashBalance, 1525);
  const rep = ok(await req('/crm-api/reports?from=2026-01-01&to=2030-12-31'), 'reports');
  assert.ok(rep.summary.orders >= 2); assert.equal(rep.mechanics[0].commission, Math.round(120 / 1.23 * 0.4 * 100) / 100);
  console.log('✓ хранение, закупки, касса (остаток наличных 1525), отчёт: зарплата механика 40% от работ нетто');

  // 9. роль механика
  ok(await req('/crm-api/staff', { body: { name: 'Mech', login: 'mech', password: 'mechpass1', role: 'mechanic', commission_pct: 40 } }), 'add mech');
  who = 'mech';
  ok(await req('/crm-api/login', { body: { login: 'mech', password: 'mechpass1' } }), 'mech login');
  ok(await req('/crm-api/orders/' + co.id), 'mech sees order');
  assert.equal((await req('/crm-api/reports')).status, 403);
  assert.equal((await req(`/crm-api/orders/${co.id}/items`, { body: { kind: 'labor', name: 'x' } })).status, 403);
  const it = co.items[0];
  ok(await req(`/crm-api/orders/${co.id}/items/${it.id}`, { method: 'PUT', body: { done: 1, price: 1 } }), 'mech done');
  who = 'admin';
  const co2 = ok(await req('/crm-api/orders/' + co.id), 'check');
  assert.equal(co2.items[0].done, 1); assert.equal(co2.items[0].price, 1000);
  console.log('✓ механик: видит заказы, отмечает работы, но не меняет цены и не видит отчёты');

  // 9b. рапорты
  const rl = ok(await req('/crm-api/reports/list'), 'reports list');
  assert.ok(rl.reports.length >= 15);
  const td = '2030-12-31';
  for (const r of rl.reports) {
    const q = `from=2020-01-01&to=${td}&car=${co.car_id}&customer=${co.customer_id}`;
    const rep = ok(await req(`/crm-api/reports/run/${r.id}?${q}`), 'report ' + r.id);
    assert.ok(Array.isArray(rep.columns) && Array.isArray(rep.rows), r.id);
  }
  const pay = ok(await req(`/crm-api/reports/run/staff_pay?from=2020-01-01&to=${td}&pct=40`), 'staff pay');
  assert.equal(pay.rows[0]?.pay, 39.02);
  for (const f of ['csv', 'xlsx', 'print']) {
    const r = await fetch(`${BASE}/crm-api/reports/run/orders_detail?from=2020-01-01&to=${td}&format=${f}`, { headers: { Cookie: jars.admin } });
    assert.equal(r.status, 200, f); assert.ok((await r.arrayBuffer()).byteLength > 50, f);
  }
  const plCsv = await (await fetch(`${BASE}/crm-api/reports/run/staff_pay?from=2020-01-01&to=${td}&format=csv&lang=pl`, { headers: { Cookie: jars.admin } })).text();
  assert.ok(/Pracownik/.test(plCsv) && !/Сотрудник|Итого/.test(plCsv), plCsv.slice(0, 200));
  console.log('✓ рапорты: все считаются, зарплата 40%, CSV/XLSX/печать, выгрузка на польском');

  // 9c. фискальная касса (Novitus NoviAPI через расширение)
  assert.equal((await req(`/crm-api/orders/${co.id}/receipt`, { body: {} })).status, 400);
  ok(await req('/crm-api/integrations/fiscal', { method: 'PUT', body: { enabled: true, values: { driver: 'novitus', url: 'http://192.168.1.50:8888', cashier: 'Kasjer 1', ptu: '23:A, 8:B, 5:C, 0:D' } } }), 'fiscal on');
  const rc = ok(await req(`/crm-api/orders/${co.id}/receipt`, { body: { nip: '5214141930' } }), 'receipt');
  const rb = rc.job.body.receipt;
  assert.equal(rc.job.url, 'http://192.168.1.50:8888'); assert.equal(rb.buyer.nip, '5214141930');
  assert.ok(rb.items.every((i) => i.article.ptu === 'A' && Math.abs(Number(i.article.price) * Number(i.article.quantity) - Number(i.article.value)) < 0.005));
  assert.equal(Number(rb.summary.total).toFixed(2), rb.items.reduce((a, i) => a + Number(i.article.value), 0).toFixed(2));
  assert.equal(rb.payments.reduce((a, p) => a + Number(Object.values(p)[0].value), 0).toFixed(2), rb.summary.total);
  ok(await req(`/crm-api/receipts/${rc.receipt.id}/result`, { body: { ok: false, error: 'Brak papieru' } }), 'res err');
  const rr = ok(await req(`/crm-api/receipts/${rc.receipt.id}/result`, { body: { ok: true, jpkid: 1279 } }), 'res ok');
  assert.equal(rr.receipt.status, 'printed'); assert.equal(rr.receipt.number, '1279');
  assert.equal((await req(`/crm-api/orders/${co.id}/receipt`, { body: {} })).status, 409);
  const sl = ok(await req('/crm-api/sales?from=2020-01-01&to=2030-12-31&type=receipt'), 'sales');
  assert.ok(sl.rows.some((r) => r.number === '1279'));
  console.log('✓ фискальная касса: чек из заказа (PTU, NIP, оплаты), номер JPKID в заказе и в «Продажах»');

  // 9d. карточка клиента и авто как в Motowarsztat
  const nc = ok(await req('/crm-api/customers', { body: { kind: 'company', company: 'AI CARS SP. Z O.O.', nip: '521-414-19-30', first_name: 'Anna', last_name: 'Nowak', country: 'PL', payment_method: 'transfer', payment_term_days: 14, phone: '+48 600 999 888' } }), 'company');
  const ncar = ok(await req('/crm-api/cars', { body: { customer_id: nc.id, plate: 'wx 12345', vehicle_type: 'Samochód osobowy', mileage_unit: 'mi', power_kw: 110 } }), 'car');
  ok(await req('/crm-api/customers/' + nc.id, { method: 'PUT', body: { default_car_id: ncar.id, first_name: 'Anna', last_name: 'Kowalska' } }), 'upd');
  const ncd = ok(await req('/crm-api/customers/' + nc.id), 'get');
  assert.equal(ncd.kind, 'company'); assert.equal(ncd.nip, '5214141930'); assert.equal(ncd.name, 'Anna Kowalska'); assert.equal(ncd.payment_term_days, 14);
  assert.equal(ncd.default_car_id, ncar.id); assert.ok(Array.isArray(ncd.sales) && Array.isArray(ncd.sms));
  const nck = ok(await req('/crm-api/cars/' + ncar.id), 'car get');
  assert.equal(nck.mileage_unit, 'mi'); assert.equal(nck.plate, 'WX12345'); assert.ok(Array.isArray(nck.files));
  ok(await req('/crm-api/customers/' + nc.id, { method: 'PUT', body: { kind: 'person', first_name: 'Anna', last_name: 'Kowalska' } }), 'to person');
  assert.equal(ok(await req('/crm-api/customers/' + nc.id), 'get2').nip, null);
  // выцена: авто без владельца + клиент → авто привязывается; клиент с одним авто → авто подставляется
  const lone = ok(await req('/crm-api/cars', { body: { plate: 'WE 77777', make: 'Audi' } }), 'lone car');
  const q1 = ok(await req('/crm-api/orders', { body: { kind: 'quote', customer_id: nc.id, car_id: lone.id } }), 'quote link');
  assert.equal(ok(await req('/crm-api/cars/' + lone.id), 'lone').customer_id, nc.id);
  const solo = ok(await req('/crm-api/customers', { body: { first_name: 'Solo', phone: '600555444' } }), 'solo');
  const soloCar = ok(await req('/crm-api/cars', { body: { customer_id: solo.id, plate: 'WA 55555' } }), 'solo car');
  const q2 = ok(await req('/crm-api/orders', { body: { kind: 'quote', customer_id: solo.id } }), 'quote auto car');
  assert.equal(ok(await req('/crm-api/orders/' + q2.id), 'q2').car_id, soloCar.id);
  const q3 = ok(await req('/crm-api/orders', { body: { kind: 'quote', car_id: soloCar.id } }), 'quote owner from car');
  assert.equal(ok(await req('/crm-api/orders/' + q3.id), 'q3').customer_id, solo.id);
  assert.ok(q1.id);
  console.log('✓ клиент (частное лицо / фирма, имя и фамилия, срок оплаты, авто по умолчанию) и авто (km/mi) как в Motowarsztat');

  // 9f. терминарз как в Motowarsztat: неназначенные заказы → на пост, длительность из часов работ; заказ сразу в график
  const hg0 = ok(await req('/crm-api/appointments?from=2026-10-05&to=2026-10-05'), 'hg');
  const un = hg0.orders.find((o) => o.jobs.length);
  assert.ok(un, 'есть неназначенный заказ с работами');
  const ap = ok(await req('/crm-api/appointments', { body: { order_id: un.id, station_id: 2, start_at: '2026-10-05 09:00' } }), 'drop order');
  const hg1 = ok(await req('/crm-api/appointments?from=2026-10-05&to=2026-10-05'), 'hg1');
  const ev = hg1.rows.find((a) => a.id === ap.id);
  assert.equal(ev.order_id, un.id); assert.ok(ev.duration_min >= 30); assert.ok(ev.jobs.length && ev.order_number);
  assert.ok(!hg1.orders.some((o) => o.id === un.id), 'заказ ушёл из неназначенных');
  ok(await req('/crm-api/appointments/' + ap.id, { method: 'PUT', body: { duration_min: 150 } }), 'resize');
  const no = ok(await req('/crm-api/orders', { body: { kind: 'order', customer_id: nc.id, complaint: 'Geometria', appointment: { station_id: 3, start_at: '2026-10-05 10:00', duration_min: 60 } } }), 'order into schedule');
  const hg2 = ok(await req('/crm-api/appointments?from=2026-10-05&to=2026-10-05'), 'hg2');
  assert.ok(hg2.rows.some((a) => a.order_id === no.id && a.station_id === 3));
  assert.equal((await req('/crm-api/orders', { body: { kind: 'order', customer_id: nc.id, appointment: { station_id: 3, start_at: '2026-10-05 10:30', duration_min: 60 } } })).status, 409);
  ok(await req('/crm-api/appointments/' + ap.id, { method: 'DELETE' }), 'unschedule');
  assert.ok(ok(await req('/crm-api/appointments?from=2026-10-05&to=2026-10-05'), 'hg3').orders.some((o) => o.id === un.id));
  console.log('✓ терминарз: заказ из «Неназначенных» на пост (часы из работ), растягивание, заказ сразу в график, пересечение отклонено, снятие с графика');

  // 9e. меню профиля: мой аккаунт, напоминания
  ok(await req('/crm-api/me', { method: 'PUT', body: { name: 'Администратор', phone: '+48600000001', email: 'admin@pulsecar.pl' } }), 'me upd');
  assert.equal(ok(await req('/crm-api/me'), 'me').user.email, 'admin@pulsecar.pl');
  assert.equal((await req('/crm-api/me', { method: 'PUT', body: { current_password: 'wrong', new_password: 'newpass-123' } })).status, 400);
  ok(await req('/crm-api/me', { method: 'PUT', body: { current_password: 'test-pass-123', new_password: 'test-pass-123' } }), 'pw');
  const rem = ok(await req('/crm-api/reminders'), 'reminders');
  assert.ok(Array.isArray(rem.rows) && typeof rem.hours === 'number');
  // журнал изменений: кто, когда, было → стало
  const au = ok(await req(`/crm-api/audit?entity=customers&id=${nc.id}`), 'audit');
  const upd = au.rows.find((r) => r.action === 'update' && r.changes.some((c) => c.field === 'Фамилия' && c.from === 'Nowak' && c.to === 'Kowalska'));
  assert.ok(upd, JSON.stringify(au.rows.slice(0, 3)));
  assert.equal(upd.staff, 'Администратор');
  assert.ok(au.rows.some((r) => r.action === 'create'));
  const aall = ok(await req('/crm-api/audit?entity=orders&id=' + co.id), 'audit order');
  assert.ok(aall.rows.some((r) => r.entity === 'order_items') && aall.rows.some((r) => r.entity === 'receipts'));
  const st = ok(await req('/crm-api/audit?entity=staff'), 'audit staff');
  assert.ok(!JSON.stringify(st.rows).includes('pass_hash'));
  console.log('✓ журнал изменений: создание, «было → стало», автор, позиции и оплаты заказа, пароли не пишутся');
  console.log('✓ меню профиля: свои данные и пароль, запланированные напоминания');

  // 9b. работы как в Motowarsztat: порядок, фото/видео до/после, обзвон выцены, парковка с оплатой
  const wo = ok(await req('/crm-api/orders', { body: { customer_id: jan.id, items: [{ kind: 'labor', name: 'A', price: 10 }, { kind: 'labor', name: 'B', price: 20 }, { kind: 'labor', name: 'C', price: 30 }] } }), 'order for reorder');
  let wd = ok(await req('/crm-api/orders/' + wo.id), 'get');
  const ids = wd.items.filter((i) => i.kind === 'labor').map((i) => i.id);
  ok(await req(`/crm-api/orders/${wo.id}/items/reorder`, { body: { ids: [ids[2], ids[0], ids[1]] } }), 'reorder');
  wd = ok(await req('/crm-api/orders/' + wo.id), 'get2');
  assert.deepEqual(wd.items.filter((i) => i.kind === 'labor').map((i) => i.name), ['C', 'A', 'B']);
  ok(await req(`/crm-api/orders/${wo.id}/media`, { body: { done: true } }), 'media');
  wd = ok(await req('/crm-api/orders/' + wo.id), 'get3');
  assert.equal(wd.media_done, 1); assert.ok(wd.media_done_by && wd.media_done_at);
  const wq = ok(await req('/crm-api/orders', { body: { kind: 'quote', customer_id: jan.id, items: [{ kind: 'labor', name: 'Rozrząd', price: 900 }] } }), 'quote fu');
  assert.equal((await req(`/crm-api/orders/${wq.id}/followup`, { body: { followup: 'declined' } })).status, 400, 'отказ без причины');
  ok(await req(`/crm-api/orders/${wq.id}/followup`, { body: { followup: 'call_back', followup_at: '2020-01-01', text: 'Попросил перезвонить в пятницу' } }), 'fu call back');
  ok(await req(`/crm-api/orders/${wq.id}/followup`, { body: { followup: 'declined', reason: 'Дорого', text: 'Сделает у знакомого' } }), 'fu declined');
  const wqd = ok(await req('/crm-api/orders/' + wq.id), 'quote get');
  assert.equal(wqd.followup, 'declined'); assert.equal(wqd.followup_reason, 'Дорого'); assert.equal(wqd.comments.length, 2);
  const ql = ok(await req('/crm-api/orders?kind=quote&followup=declined'), 'quote list fu');
  assert.ok(ql.rows.some((r) => r.id === wq.id && r.last_comment === 'Сделает у знакомого'));
  const pk = ok(await req('/crm-api/storage', { body: { customer_id: jan.id, kind: 'parking', price: 30, date_in: '2026-01-01', description: 'ключи в сейфе' } }), 'parking');
  ok(await req(`/crm-api/storage/${pk.id}/pay`, { body: { amount: 90, method: 'card' } }), 'parking pay');
  const pkl = ok(await req('/crm-api/storage?q=' + encodeURIComponent('ключи')), 'storage list');
  const prow = pkl.find((x) => x.id === pk.id);
  assert.equal(prow.kind, 'parking'); assert.equal(prow.paid, 90); assert.equal(prow.qty, 1);
  const cash2 = ok(await req('/crm-api/cash?from=2000-01-01&to=2100-01-01'), 'cash');
  assert.ok(cash2.rows.some((r) => r.note === 'Парковка ' + prow.number && r.amount === 90 && r.method === 'card'));
  const aw = ok(await req('/crm-api/audit?entity=orders&id=' + wq.id), 'audit fu');
  assert.ok(aw.rows.some((r) => r.entity === 'order_comments'));
  console.log('✓ работы: порядок перетаскиванием, отметка фото/видео до/после, обзвон выцены с причиной и комментариями, парковка с оплатой в кассу');

  // 10. удаление аккаунта в приложении
  ok(await req('/api/me/delete', { body: {}, token: sess.token }), 'delete');
  assert.equal((await req('/api/me', { token: sess.token })).status, 401);
  console.log('✓ удаление аккаунта');
  console.log('\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
} catch (e) {
  console.error('✗', e.message);
  console.error(out.slice(-1500));
  process.exitCode = 1;
} finally {
  srv.kill();
}
