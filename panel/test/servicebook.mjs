// Сервисная книжка: рекомендации в CRM → клиент видит их через API (pulsecar.pl/moje-auto),
// файлы и фактура только свои, автозакрытие рекомендации при завершении заказа, SMS-напоминания.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const PORT = 3197;
const BASE = `http://localhost:${PORT}`;
const DB = './data/test-sb.db';
for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });

let out = '';
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, PORT, DB_PATH: DB, ADMIN_PASSWORD: 'test-pass-123', SMS_PROVIDER: 'console', SESSION_SECRET: 'y'.repeat(40), PUBLIC_URL: 'http://localhost', NODE_ENV: 'test' },
});
srv.stdout.on('data', (d) => (out += d));
srv.stderr.on('data', (d) => process.stderr.write(d));
for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/health'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

let jar = '';
async function req(path, { body, form, token, method } = {}) {
  const r = await fetch(BASE + path, {
    method: method || (body || form ? 'POST' : 'GET'),
    headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), ...(jar && !token ? { Cookie: jar } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const sc = r.headers.get('set-cookie');
  if (sc && !token) jar = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, j: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers };
}
const ok = (x, msg) => { assert.ok(x.status < 300, `${msg}: ${x.status} ${JSON.stringify(x.j).slice(0, 300)}`); return x.j; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function login(phone) {
  ok(await req('/api/auth/request', { body: { phone, lang: 'ua' } }), 'otp');
  await wait(200);
  const m = [...out.matchAll(new RegExp(`\\+48${phone}\\] .*?(\\d{6})`, 'g'))].pop();
  assert.ok(m, 'SMS с кодом не найдено');
  assert.match(m[0], /ваш код входу/, 'код для сайта на украинском (ua → uk)');
  return ok(await req('/api/auth/verify', { body: { phone, code: m[1] } }), 'verify').token;
}

try {
  ok(await req('/crm-api/login', { body: { login: 'admin', password: 'test-pass-123' } }), 'admin login');
  const me = ok(await req('/crm-api/me'), 'me');
  const done = me.statuses.find((s) => s.is_final && s.lock_edit && (s.scope || 'all') !== 'quote');

  const cust = ok(await req('/crm-api/customers', { body: { first_name: 'Ewa', last_name: 'Test', phone: '600 222 333' } }), 'customer');
  const car = ok(await req('/crm-api/cars', { body: { customer_id: cust.id, plate: 'WI 12345', make: 'Skoda', model: 'Octavia', last_mileage: 120000, inspection_until: day(10) } }), 'car');
  const other = ok(await req('/crm-api/customers', { body: { first_name: 'Obcy', phone: '600 999 111' } }), 'other');
  const ocar = ok(await req('/crm-api/cars', { body: { customer_id: other.id, plate: 'WX 99999', make: 'Fiat' } }), 'other car');

  // заказ 1: масло, рекомендации, файл, чек-лист
  const o1 = ok(await req('/crm-api/orders', { body: { customer_id: cust.id, car_id: car.id, complaint: 'Przegląd', mileage: 120500 } }), 'order1');
  ok(await req(`/crm-api/orders/${o1.id}/items`, { body: { kind: 'labor', name: 'Wymiana oleju silnikowego', qty: 1, price: 150 } }), 'labor');
  ok(await req(`/crm-api/orders/${o1.id}`, { method: 'PUT', body: { after_notes: 'Klocki przód 3 mm.' } }), 'after notes');
  const presets = ok(await req('/crm-api/recommendations/presets'), 'presets').presets;
  assert.ok(presets.length > 5);
  const r1 = ok(await req('/crm-api/recommendations', { body: { car_id: car.id, order_id: o1.id, title: 'Wymiana klocków hamulcowych przód', note: 'Klocki 3 mm', priority: 'urgent', due_date: day(5), est_price: '350,50' } }), 'rec1');
  ok(await req('/crm-api/recommendations', { body: { car_id: car.id, order_id: o1.id, title: 'Wymiana rozrządu', priority: 'later', due_km: 125000 } }), 'rec2');
  const bad = await req('/crm-api/recommendations', { body: { car_id: car.id, title: '  ' } });
  assert.equal(bad.status, 400);
  // чек-лист → рекомендации без дублей
  const cl = ok(await req('/crm-api/dict/checklists', { body: { name: 'Przegląd SB', items: ['Wymiana klocków hamulcowych przód', 'Amortyzatory tył', 'Oświetlenie'] } }), 'checklist tpl').checklists.find((x) => x.name === 'Przegląd SB');
  ok(await req(`/crm-api/orders/${o1.id}/checklists`, { body: { checklist_id: cl.id } }), 'add checklist');
  const filled = ok(await req(`/crm-api/orders/${o1.id}/checklists`), 'checklists').filled[0];
  ok(await req(`/crm-api/orders/${o1.id}/checklists`, { body: { id: filled.id, results: [{ item: 'Wymiana klocków hamulcowych przód', state: 'bad' }, { item: 'Amortyzatory tył', state: 'warn', note: 'lekki wyciek' }, { item: 'Oświetlenie', state: 'ok' }] } }), 'fill');
  const fc = ok(await req(`/crm-api/orders/${o1.id}/recommendations/from-checklists`, { body: {} }), 'from checklist');
  assert.equal(fc.added, 1, 'только амортизаторы: тормоза уже есть, освещение OK');
  let ord = ok(await req('/crm-api/orders/' + o1.id), 'order get');
  assert.equal(ord.recommendations.filter((r) => r.status === 'open').length, 3);
  // файл: видно клиенту и скрытый
  const fd = new FormData(); fd.append('files', new Blob(['JPEGDATA'], { type: 'image/jpeg' }), 'klocki.jpg');
  ok(await req(`/crm-api/orders/${o1.id}/files`, { form: fd }), 'upload');
  const fd2 = new FormData(); fd2.append('files', new Blob(['secret'], { type: 'image/jpeg' }), 'wewn.jpg'); fd2.append('client_visible', '0');
  ok(await req(`/crm-api/orders/${o1.id}/files`, { form: fd2 }), 'upload hidden');
  ok(await req(`/crm-api/orders/${o1.id}/status`, { body: { status_id: done.id } }), 'close1');
  // файл чужого клиента
  const o3 = ok(await req('/crm-api/orders', { body: { customer_id: other.id, car_id: ocar.id } }), 'other order');
  const fd3 = new FormData(); fd3.append('files', new Blob(['other'], { type: 'image/jpeg' }), 'obcy.jpg');
  ok(await req(`/crm-api/orders/${o3.id}/files`, { form: fd3 }), 'upload other');
  const otherFile = ok(await req('/crm-api/orders/' + o3.id), 'o3').files[0];
  console.log('✓ CRM: рекомендации вручную, из чек-листа без дублей, файлы');

  // клиент на сайте: вход по SMS → сервисная книжка
  const token = await login('600222333');
  let my = ok(await req('/api/me', { token }), 'me');
  const c = my.cars.find((x) => x.plate === 'WI12345' || x.plate === 'WI 12345');
  assert.ok(c, 'авто клиента');
  assert.equal(c.inspectionUntil, day(10));
  assert.equal(c.recommendations.length, 3);
  const brakes = c.recommendations.find((r) => /klocków/.test(r.title));
  assert.equal(brakes.priority, 'urgent'); assert.equal(brakes.estPrice, 350.5); assert.equal(brakes.urgency, 'soon'); assert.equal(brakes.orderNo, ord.number);
  assert.equal(c.recommendations.find((r) => /rozrządu/.test(r.title)).urgency, 'later', 'до 125000 km ещё 4500 km');
  const v1 = c.visits[0];
  assert.equal(v1.afterNotes, 'Klocki przód 3 mm.');
  assert.equal(v1.files.length, 1, 'скрытый файл не виден'); assert.equal(v1.files[0].name, 'klocki.jpg');
  assert.ok(v1.warrantyUntil > day(150), 'гарантия 6 мес. на работы');
  assert.equal(v1.invoice, null);
  const f = await req('/api/files/' + v1.files[0].id, { token });
  assert.equal(f.status, 200); assert.equal(f.j, 'JPEGDATA');
  assert.equal((await req('/api/files/' + otherFile.id, { token })).status, 404, 'чужой файл не отдаётся');
  assert.equal((await req('/api/files/' + v1.files[0].id)).status, 401, 'без входа нельзя');
  assert.equal((await req(`/api/orders/${o1.id}/invoice.pdf`, { token })).status, 404);
  assert.equal((await req('/api/me', { token: 'x'.repeat(64) })).status, 401);
  console.log('✓ сайт: вход по SMS (ua), авто, рекомендации, гарантия, файлы только свои и видимые');

  // заказ 2 с заменой колодок → рекомендация закрывается сама
  const o2 = ok(await req('/crm-api/orders', { body: { customer_id: cust.id, car_id: car.id } }), 'order2');
  ok(await req(`/crm-api/orders/${o2.id}/items`, { body: { kind: 'labor', name: 'Klocki hamulcowe przednie - wymiana', qty: 1, price: 200 } }), 'brakes');
  ok(await req(`/crm-api/orders/${o2.id}/status`, { body: { status_id: done.id } }), 'close2');
  const carFull = ok(await req('/crm-api/cars/' + car.id), 'car get');
  const closedR = carFull.recommendations.find((r) => r.id === r1.id);
  assert.equal(closedR.status, 'done'); assert.equal(closedR.closed_order_no, carFull.orders.find((x) => x.id === o2.id).number);
  my = ok(await req('/api/me', { token }), 'me2');
  const c2 = my.cars.find((x) => x.id === c.id);
  assert.equal(c2.recommendations.length, 2); assert.ok(c2.done.some((d) => /klocków/.test(d.title)));
  // изменить / отклонить / снова открыть
  const am = carFull.recommendations.find((r) => /Amortyzatory/.test(r.title));
  ok(await req('/crm-api/recommendations/' + am.id, { method: 'PUT', body: { status: 'dismissed' } }), 'dismiss');
  assert.equal(ok(await req('/api/me', { token }), 'me3').cars.find((x) => x.id === c.id).recommendations.length, 1);
  ok(await req('/crm-api/recommendations/' + am.id, { method: 'PUT', body: { status: 'open', due_date: day(3) } }), 'reopen');
  assert.equal((await req('/crm-api/recommendations/' + am.id, { method: 'PUT', body: { due_date: '3.10.2026' } })).status, 400);
  console.log('✓ рекомендация закрылась сама при завершении заказа с этой работой; отклонить и вернуть');

  // SMS-напоминания: рекомендация со сроком через 3 дня и техосмотр через 10 дней, по одному разу
  const before = (out.match(/\[SMS → \+48600222333\]/g) || []).length;
  ok(await req('/crm-api/_jobs', { body: {} }), 'jobs');
  await wait(300);
  const sms = out.split('\n').filter((l) => l.includes('[SMS → +48600222333]'));
  assert.equal(sms.length - before, 2, 'две SMS: амортизаторы + техосмотр');
  assert.ok(sms.some((l) => /Amortyzatory tyl dla Skoda/.test(l) && /moje-auto/.test(l)), 'текст рекомендации');
  assert.ok(sms.some((l) => /Przeglad techniczny Skoda/.test(l)), 'текст техосмотра');
  ok(await req('/crm-api/_jobs', { body: {} }), 'jobs again');
  await wait(300);
  assert.equal((out.match(/\[SMS → \+48600222333\]/g) || []).length - before, 2, 'повторно не шлём');
  console.log('✓ SMS-напоминания о рекомендации и техосмотре, без повторов');

  // удаление
  ok(await req('/crm-api/recommendations/' + am.id, { method: 'DELETE' }), 'delete');
  console.log('\nСЕРВИСНАЯ КНИЖКА: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
} catch (e) {
  console.error('✗', e.message);
  console.error(out.slice(-2000));
  process.exitCode = 1;
} finally {
  srv.kill();
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
}
