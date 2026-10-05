// Перенос из Motowarsztat: пакеты в формате их API → клиенты, авто, заказы, выцены, склад, документы, касса, SMS; повтор без дублей
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const PORT = 3196;
const BASE = `http://localhost:${PORT}`;
const DB = './data/test-mw.db';
for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
let out = '';
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, PORT, DB_PATH: DB, ADMIN_PASSWORD: 'test-pass-123', SMS_PROVIDER: 'console', SESSION_SECRET: 'y'.repeat(40), PUBLIC_URL: 'http://localhost', NODE_ENV: 'test' },
});
srv.stdout.on('data', (d) => (out += d));
srv.stderr.on('data', (d) => process.stderr.write(d));
for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/health'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

let jar = '';
async function req(path, { body, method, headers } = {}) {
  const r = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(jar ? { Cookie: jar } : {}), ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jar = sc.split(';')[0];
  return { status: r.status, j: await r.json().catch(() => null), headers: r.headers };
}
const ok = (x, m) => { assert.ok(x.status < 300, `${m}: ${x.status} ${JSON.stringify(x.j).slice(0, 300)}`); return x.j; };

const vat23 = { id: 1, value: 23, exempt: false, notSubject: false };
const client = { id: 501, type: 'person', firstname: 'Jan', lastname: 'Nowak', phoneNumber: { countryCode: 'PL', number: '601111222' }, email: 'jan@x.pl', city: 'Warszawa', postalCode: '01-001', createdAt: '2025-12-01 10:00:00' };
const company = { id: 502, type: 'company', name: 'AUTO SP. Z O.O.', nip: '5214141930', firstname: 'Anna', lastname: 'Kowal', phoneNumber: { number: '601111333' } };
const veh = { id: 901, currentOwner: { id: 501 }, vin: 'WBA8E9C50GK644411', registrationNumber: 'WA 12345', brand: 'BMW', model: '320d', productionDate: 2016, capacity: '1995', engine: 'D', color: 'Czarny', technicalInspectionEnd: '2026-12-01', carType: { name: 'Samochód osobowy' } };
const wp = { id: 7001, count: 4, value: 160, thresholdCountMin: 1, product: { id: 7101, name: 'Filtr oleju', code: 'OC 90', manufacturer: { name: 'KNECHT' }, unit: 'szt.', vat: vat23, priceNet: 30, priceGross: 55, eanCodes: [{ ean: '123' }], priceGroups: [{ priceGross: 59.99, workshopProductPriceGroup: { default: true } }] } };
const worker = { id: 31, firstname: 'Andrzej', lastname: 'Mechanik', enabled: true, color: '#00f' };
const status = { id: 165438, name: 'Zakończone', position: 7, color: '#212529', finished: true, editBlocked: true };
const ro = {
  id: 2000154, number: 'ZL 5/01/2026', date: '2026-01-06 09:00:00', dateAdmission: '2026-01-06 10:00:00', dateFinish: '2026-01-06 12:00:00', dateCompletion: '2026-01-06 16:00:00',
  client: { id: 501 }, vehicle: { id: 901 }, status, workplace: { id: 153617, name: '1 Подьемник/+развал' }, kind: { id: 79190, name: 'Lid site' }, workerDefault: worker,
  mileage: 210000, description: 'Wymiana oleju', internalDescription: 'tylko oryginał', detectedFaults: 'Luz na wahaczu', recoverPartsToClient: true,
  jobs: [{ id: 1, name: 'Wymiana oleju i filtra oleju', price: 81.3, totalNet: 81.3, totalGross: 100, quantityEstimated: 1, quantityFinal: 1, unitWork: 2, discount: 0, vat: vat23, status: 99, jobWorkers: [{ worker }] },
    { id: 2, name: 'Diagnostyka', price: 100, totalNet: 150, totalGross: 184.5, quantityEstimated: 1.5, quantityFinal: 1.5, unitWork: 1, discount: 0, vat: vat23, status: 0, jobWorkers: [] }],
  parts: [{ id: 11, name: 'Filtr oleju', code: 'OC 90', count: 1, price: 48.77, priceGross: 59.99, totalGross: 59.99, costNet: 40, unit: 'szt.', vat: vat23, discount: 0, warehouseProduct: { id: 7001, product: { id: 7101 } }, job: { id: 1 } }],
};
const quote = { id: 777, number: 'WYC 3/01/2026', date: '2026-01-04 12:00:00', client: { id: 502 }, vehicle: null, comments: 'Klient oddzwoni w piątek',
  jobs: [{ id: 5, name: 'Wymiana sprzęgła', quantity: 1, price: 800, totalGross: 984, vat: vat23, discount: 0, unitWork: 2 }],
  parts: [{ id: 6, name: 'Sprzęgło kpl', quantity: 2, price: 182.64, totalNet: 296.98, totalGross: 365.28, vat: vat23, discount: 0 },
    { id: 7, name: 'Łożysko', quantity: 1, price: 164.83, priceGross: 148.35, totalGross: 148.35, vat: vat23, discount: 10 }] };
const sale = { id: 628251, type: 'invoice', number: 'FS 1/01/2026', date: '2026-01-06', datePayment: '2026-01-20', paymentMethod: 3, totalNet: 237.06, totalGross: 291.58, paidTotal: 291.58,
  repairOrders: [{ id: 2000154 }], client: { id: 501 }, clientDetails: { name: 'Jan Nowak', postalCode: '01-001', city: 'Warszawa' },
  items: [{ name: 'Wymiana oleju i filtra oleju', count: 1, price: 81.3, totalNet: 81.3, totalGross: 100, vat: vat23, unit: 'usł.' }],
  payments: [{ id: 99, date: '2026-01-06', value: '291.58', paymentMethod: 3, cashBoxId: null }] };
const receipt = { id: 628252, type: 'receiptFiscal', number: '1234', date: '2026-01-07', paymentMethod: 1, totalGross: 50, paidTotal: 50, repairOrders: [], items: [],
  payments: [{ id: 100, date: '2026-01-07', value: '50.00', paymentMethod: 1, cashBoxId: 2475, cashBoxName: 'Основная касса', cashBoxDocumentNumber: 'KP 2/01/2026' }] };
// корректа с возвратом: наличными через KW и «возврат» без KW (в кассе MW не проведён — не переносим)
const corr = { id: 628253, type: 'correctionInvoice', number: 'FK 1/01/2026', date: '2026-01-09', paymentMethod: 1, totalNet: -40.65, totalGross: -50, paidTotal: -50, repairOrders: [], items: [],
  payments: [{ id: 101, date: '2026-01-09', value: '-50.00', paymentMethod: 1, cashBoxId: 2475, cashBoxName: 'Основная касса', cashBoxDocumentNumber: 'KW 2/01/2026' },
    { id: 102, date: '2026-01-09', value: '-50.00', paymentMethod: 1, cashBoxId: null, cashBoxDocumentNumber: null }] };
const kp = { id: 4001, number: 'KP 2/01/2026', total: 50, date: '2026-01-07', cashBox: { id: 2475, name: 'Основная касса' }, items: [{ name: 'Płatność do dokumentu sprzedaży', saleDocumentId: 628252 }] };
const kw = { id: 4002, number: 'KW 1/01/2026', total: 814.12, date: '2026-01-08', cashBox: { id: 2475, name: 'Основная касса' }, items: [{ name: 'Закупка в кастораме' }] };
const sms = { id: 55, client: { id: 501 }, phoneNumber: { number: '601111222' }, content: 'Auto gotowe do odbioru', status: 'sent', sendAt: '2026-01-06 15:00:00', repairOrderId: 2000154 };
const wd = { id: 8001, type: 'pz', number: 'PZ 1/01/2026', date: '2026-01-02', externalDocumentNumber: 'FV/IC/123', clientDetails: { name: 'Inter Cars' }, totalNet: 160,
  items: [{ count: 4, price: 40, warehouseProduct: { product: { id: 7101 } } }] };
const evs = [
  { id: 'ro-2000154', type: 'repair_order', workplaceId: 153617, start: '2026-01-06 10:00', end: '2026-01-06 12:30', estimatedHours: 2.5, data: { repairOrderId: 2000154, statusName: 'Zakończone' } },
  { id: 'job-9001', type: 'repair_order_job', workplaceId: 172943, start: '2026-01-07 15:00', end: '2026-01-08 11:00', estimatedHours: 4, dayAllocation: { '2026-01-07': 2, '2026-01-08': 2 },
    data: { jobId: 9001, jobName: 'Wymiana rozrządu', repairOrderId: 2000154, statusName: 'W trakcie naprawy' } },
  { id: 'tb-abc-1', type: 'time_block', workplaceId: 153617, start: '2026-01-09 13:30', end: '2026-01-09 17:00', title: 'кадилак', data: { reason: 'кадилак', blocksEntireDay: false } },
  { id: 'ro-404', type: 'repair_order', workplaceId: 153617, start: '2026-01-09 09:00', end: '2026-01-09 10:00', data: { repairOrderId: 404 } }];
const visit = { id: 31, number: 'WIZ 1/07/2026', problemDescription: 'Stuk z przodu', status: 'new', client: { id: 501 }, vehicle: null, repairOrderId: null, createdAt: '2026-07-01 10:00:00' };
const mail = { id: 71, client: { id: 501 }, subject: 'Wycena WYC 3/01/2026', emails: ['jan@x.pl'], content: '<p>Dzień dobry,<br>w załączniku wycena.</p>', sendAt: '2026-01-04 12:30:00' };
const jt = { id: 3001, name: 'Geometria kół', price: 162.6, unitWork: 2, quantityEstimated: 1, jobCategory: { name: 'Zawieszenie' } };

try {
  ok(await req('/crm-api/login', { body: { login: 'admin', password: 'test-pass-123' } }), 'login');
  // тестовые данные до переноса — будут удалены
  ok(await req('/crm-api/customers', { body: { first_name: 'Test', phone: '600000001' } }), 'test customer');
  assert.equal((await req('/crm-api/mw-import/wipe', { body: {} })).status, 400, 'без подтверждения не удаляет');
  const w = ok(await req('/crm-api/mw-import/wipe', { body: { confirm: 'USUŃ DANE TESTOWE' } }), 'wipe');
  assert.match(w.backup, /before-mw-import-/);
  assert.equal(ok(await req('/crm-api/customers'), 'list').total, 0);

  const { token } = ok(await req('/crm-api/mw-import/token', { body: {} }), 'token');
  const send = async (entity, items, t = token) => {
    const r = await fetch(`${BASE}/mw-import/${entity}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Token': t, Origin: 'https://app.motowarsztat.pl' }, body: JSON.stringify({ items }) });
    return { status: r.status, j: await r.json(), cors: r.headers.get('access-control-allow-origin') };
  };
  assert.equal((await send('clients', [client], 'zly')).status, 401, 'чужой ключ');
  const pre = await fetch(`${BASE}/mw-import/clients`, { method: 'OPTIONS', headers: { Origin: 'https://app.motowarsztat.pl' } });
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://app.motowarsztat.pl');

  const run = async () => {
    for (const [e, items] of [['workers', [worker]], ['workplaces', [{ id: 153617, name: '1 Подьемник/+развал' }, { id: 172943, name: 'Klimatizacja' }]], ['clients', [client, company]], ['vehicles', [veh]], ['products', [wp]], ['job-templates', [jt]], ['repair-orders', [ro]],
      ['quotations', [quote]], ['sale-documents', [sale, receipt, corr]], ['cash-box-documents', [kp, kw]], ['sms-messages', [sms]], ['warehouse-documents', [wd]], ['scheduler-events', evs], ['visits', [visit]], ['client-mails', [mail]]]) {
      const r = await send(e, items);
      assert.equal(r.status, 200, e + ' ' + JSON.stringify(r.j)); assert.equal(r.j.failed, 0, e + ' ' + JSON.stringify(r.j.errors));
    }
  };
  await run();
  await run(); // повтор — без дублей

  const cl = ok(await req('/crm-api/customers?q=Nowak'), 'customers');
  assert.equal(cl.total, 1);
  const c = ok(await req('/crm-api/customers/' + cl.rows[0].id), 'customer');
  assert.equal(c.phone, '+48601111222'); assert.equal(c.email, 'jan@x.pl');
  const co = ok(await req('/crm-api/customers?q=AUTO'), 'company').rows[0];
  assert.equal(co.kind, 'company'); assert.equal(co.nip, '5214141930');
  const car = ok(await req('/crm-api/cars/' + c.default_car_id), 'car');
  assert.equal(car.plate, 'WA12345'); assert.equal(car.vin, 'WBA8E9C50GK644411'); assert.equal(car.inspection_until, '2026-12-01');
  const orders = ok(await req('/crm-api/orders?kind=order&status='), 'orders');
  assert.equal(orders.total, 1);
  const o = ok(await req('/crm-api/orders/' + orders.rows[0].id), 'order');
  assert.equal(o.number, 'ZL 5/01/2026'); assert.equal(o.items.length, 3); assert.equal(o.total, 344.49);
  assert.equal(o.status.is_final, 1); assert.equal(o.faults, 'Luz na wahaczu');
  assert.equal(o.closed_at, '2026-01-06 12:00:00', 'дата завершения — фактическая (dateFinish), не плановая dateCompletion');
  { // режим «только даты»: правит closed_at, не трогая заказ
    const r = await send('repair-order-dates', [{ ...ro, dateFinish: '2026-01-07 18:00:00' }, { id: 1, status: { finished: true } }]);
    assert.equal(r.j.updated, 1); assert.equal(r.j.skipped, 1);
    const o2 = ok(await req('/crm-api/orders/' + o.id), 'order');
    assert.equal(o2.closed_at, '2026-01-07 18:00:00'); assert.equal(o2.items.length, 3);
    await send('repair-order-dates', [ro]);
  }
  { // терминарз MW: точное время заказа, многодневная работа по дням, блокировка; визит; письмо
    const ap = ok(await req('/crm-api/appointments?from=2026-01-01&to=2026-01-31'), 'appts').rows;
    const main = ap.filter((a) => a.order_id === o.id && /^ZL/.test(a.title || ''));
    assert.ok(main.some((a) => a.start_at === '2026-01-06 10:00' && a.duration_min === 150), 'время заказа как в терминарзе MW');
    const job = ap.filter((a) => /rozrządu/.test(a.title || '')).map((a) => a.start_at + '/' + a.duration_min).sort();
    assert.deepEqual(job, ['2026-01-07 15:00/120', '2026-01-08 08:00/120'], 'многодневная работа — по дням');
    assert.equal(ap.filter((a) => a.status === 'block' && a.title === 'кадилак').length, 1, 'блокировка');
    const req2 = ok(await req('/crm-api/appointments?from=2026-07-01'), 'cal').unassigned;
    assert.ok(JSON.stringify(req2).includes('WIZ 1/07/2026'), 'визит WIZ в нераспределённых');
    const cust = ok(await req('/crm-api/customers/' + o.customer_id), 'cust');
    assert.ok(cust.sms.some((x) => x.kind === 'email' && /w załączniku wycena/.test(x.text)), 'письмо в истории клиента');
  }
  { // возврат по корректе → расход из кассы (KW), без задвоения
    const cash = ok(await req('/crm-api/cash?from=2026-01-01&to=2026-01-31'), 'cash');
    const refunds = cash.rows.filter((p) => /Zwrot/.test(p.note || ''));
    assert.equal(refunds.length, 1, 'один возврат (KW), «возврат» без KW пропущен'); assert.equal(refunds[0].direction, 'out'); assert.equal(refunds[0].amount, 50);
  }
  const diag = o.items.find((i) => i.name === 'Diagnostyka');
  assert.equal(diag.unit, 'rbh'); assert.equal(diag.qty, 1.5); assert.equal(diag.price, 123);
  const part = o.items.find((i) => i.kind === 'part');
  assert.ok(part.product_id && part.task_id, 'запчасть связана с товаром и работой');
  assert.equal(o.paid, 291.58, 'оплата из фактуры'); assert.equal(o.invoice_no, 'FS 1/01/2026');
  assert.ok(o.sales_docs.some((d) => d.number === 'FS 1/01/2026'));
  assert.ok((o.appointments || []).some((a) => a.start_at === '2026-01-06 10:00' && a.duration_min === 150), 'запись в графике (время из терминарза MW)');
  const me = ok(await req('/crm-api/me'), 'me');
  const ap = o.appointments.find((a) => a.start_at === '2026-01-06 10:00');
  assert.match(me.stations.find((x) => x.id === ap.station_id).name, /^1/, 'пост MW сопоставлен с нашим «1 …»');
  assert.equal(me.stations.filter((x) => /^1/.test(x.name)).length, 1, 'без дублей постов');
  const q = ok(await req('/crm-api/orders?kind=quote'), 'quotes');
  assert.equal(q.total, 1); assert.equal(q.rows[0].total, 1497.63, 'брутто выцены как в MW (цена брутто, скидка не дважды)');
  const qd = ok(await req('/crm-api/orders/' + q.rows[0].id), 'quote');
  { const od = ok(await req('/crm-api/orders/' + o.id), 'order'); assert.equal(od.comments.filter((x) => x.text === 'tylko oryginał').length, 1, '«Opis wewnętrzny» → комментарий, без дублей'); }
  assert.ok(qd.comments.some((x) => /piątek/.test(x.text)));
  const pr = ok(await req('/crm-api/products?q=OC 90'), 'products').rows[0];
  assert.equal(pr.stock, 4); assert.equal(pr.purchase_price, 40); assert.equal(pr.sell_price, 59.99); assert.equal(pr.manufacturer, 'KNECHT');
  const sl = ok(await req('/crm-api/sales?from=2026-01-01&to=2026-01-31'), 'sales');
  assert.ok(sl.rows.some((r) => r.type === 'receipt' && r.number === '1234'), 'чек');
  console.log('✓ перенос из Motowarsztat: клиенты (лицо/фирма), авто, товары с остатком, заказ с работами (oper/rbh), запчастями, механиком, статусом и графиком, выцена с комментарием, фактура, чек, касса, SMS, PZ; повтор без дублей');
  console.log('\nПЕРЕНОС MOTOWARSZTAT: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
} catch (e) {
  console.error('✗', e.message);
  console.error(out.slice(-2000));
  process.exitCode = 1;
} finally {
  srv.kill();
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
}
