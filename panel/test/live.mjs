// «Kamery na żywo» (Pulsecar Live): одноразовая ссылка входа только после входа в CRM, ключ API уходит только с сервера,
// next — только пути панели модуля; активные ссылки заказа. Модуль подменён маленьким HTTP-сервером.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const PORT = 3195, LIVE = 3194, BASE = `http://localhost:${PORT}`, KEY = 'k'.repeat(64);
const DB = './data/test-live.db';
for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
const calls = [];
const ORDER = { id: '' };
const fake = createServer((rq, rs) => {
  let b = '';
  rq.on('data', (d) => (b += d));
  rq.on('end', () => {
    calls.push({ path: rq.url, auth: rq.headers.authorization, body: b ? JSON.parse(b) : null });
    rs.setHeader('Content-Type', 'application/json');
    if (rq.headers.authorization !== 'Bearer ' + KEY) { rs.statusCode = 401; return rs.end('{"error":"Brak dostępu"}'); }
    if (rq.url === '/api/v1/embed-sessions') return rs.end(JSON.stringify({ url: 'https://live.example/embed/start?t=abc', expiresIn: 120 }));
    if (rq.url === '/api/v1/links/l1' && rq.method === 'GET') return rs.end(JSON.stringify({ id: 'l1', plate: 'WA 1234X', phone: '', orderId: ORDER.id, state: 'live', smsText: 'Dzień dobry! Podgląd: https://live.example/v/x' }));
    if (rq.url === '/api/v1/links/l1' && rq.method === 'PATCH') return rs.end('{}');
    if (rq.url === '/api/v1/cameras') return rs.end(JSON.stringify([{ id: 'c1', name: 'Podnośnik 1', enabled: true }, { id: 'c2', name: 'Stary', enabled: false }]));
    if (rq.url === '/api/v1/links' && rq.method === 'POST') return rs.end(JSON.stringify({ id: 'l9', url: 'https://live.example/v/new', smsText: 'x' }));
    if (rq.url.startsWith('/api/v1/links?orderId=' + ORDER.id + '&')) return rs.end('[]');
    if (rq.url.startsWith('/api/v1/links?')) return rs.end(JSON.stringify([{ id: 'l1', url: 'https://live.example/v/x', state: 'live', orderId: '1' }]));
    rs.statusCode = 404; rs.end('{}');
  });
}).listen(LIVE);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, PORT, DB_PATH: DB, ADMIN_PASSWORD: 'test-pass-123', SESSION_SECRET: 'x'.repeat(40), SMS_PROVIDER: 'console',
    PULSECAR_LIVE_URL: `http://localhost:${LIVE}`, PULSECAR_LIVE_API_KEY: KEY, PULSECAR_LIVE_PUBLIC: 'https://live.example' },
});
srv.stderr.on('data', (d) => process.stderr.write(d));
for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
let jar = '';
async function req(path, { body, method } = {}) {
  const r = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(jar ? { Cookie: jar } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jar = sc.split(';')[0];
  return { status: r.status, j: await r.json().catch(() => null) };
}
try {
  assert.equal((await req('/crm-api/live-cameras/embed-url', { body: { next: '/admin' } })).status, 401, 'без входа в CRM — нельзя');
  await req('/crm-api/login', { body: { login: 'admin', password: 'test-pass-123' } });
  const me = (await req('/crm-api/me')).j;
  assert.equal(me.features.live.origin, 'https://live.example');
  const e = await req('/crm-api/live-cameras/embed-url', { body: { next: '/admin/new?plate=WA1&orderId=1' } });
  assert.equal(e.status, 200); assert.equal(e.j.url, 'https://live.example/embed/start?t=abc');
  const c = calls.find((x) => x.path === '/api/v1/embed-sessions');
  assert.equal(c.auth, 'Bearer ' + KEY); assert.equal(c.body.next, '/admin/new?plate=WA1&orderId=1'); assert.equal(c.body.user.id, String(me.id ?? me.user?.id ?? c.body.user.id)); assert.ok(c.body.user.name);
  await req('/crm-api/live-cameras/embed-url', { body: { next: 'https://evil.example/' } });
  assert.equal(calls.filter((x) => x.path === '/api/v1/embed-sessions').at(-1).body.next, '/admin', 'чужой адрес → /admin');
  assert.ok(!JSON.stringify(me).includes(KEY), 'ключ модуля не уходит в браузер');
  const o = (await req('/crm-api/orders', { body: { kind: 'order', items: [{ kind: 'labor', name: 'Test', price: 10 }] } })).j;
  const l = await req('/crm-api/live-cameras/order/' + o.id);
  assert.equal(l.status, 200); assert.equal(l.j[0].state, 'live');
  assert.ok(calls.some((x) => x.path === `/api/v1/links?orderId=${o.id}&active=1`));
  // поиск в базе CRM для формы модуля: машина + клиент + открытое zlecenie
  const cust = (await req('/crm-api/customers', { body: { name: 'Jan Live', phone: '600700800' } })).j;
  const car = (await req('/crm-api/cars', { body: { plate: 'WA 1234X', make: 'Opel', model: 'Astra', customer_id: cust.id } })).j;
  const o2 = (await req('/crm-api/orders', { body: { kind: 'order', customer_id: cust.id, car_id: car.id, items: [] } })).j;
  ORDER.id = String(o2.id);
  const sr = (await req('/crm-api/live-cameras/search?q=wa1234')).j;
  assert.equal(sr[0].plate.replace(/\s/g, ''), 'WA1234X'); assert.equal(sr[0].client, 'Jan Live'); assert.equal(sr[0].phone, '+48600700800'); assert.equal(sr[0].orderId, String(o2.id));
  assert.equal((await req('/crm-api/live-cameras/search?q=Jan%20Li')).j.length, 1);
  // SMS: телефона в ссылке нет → номер клиента из zlecenia
  const sm = await req('/crm-api/live-cameras/sms', { body: { linkId: 'l1' } });
  assert.equal(sm.status, 200, JSON.stringify(sm.j)); assert.equal(sm.j.phone, '+48600700800');
  const sm2 = await req('/crm-api/live-cameras/sms', { body: { linkId: 'l1', phone: '511222333' } });
  assert.equal(sm2.j.phone, '+48511222333'); assert.ok(calls.some((x) => x.path === '/api/v1/links/l1' && x.body?.phone === '+48511222333'));
  // окно статуса «в работе»: камеры и ссылка для заказа одним действием
  const cams = (await req('/crm-api/live-cameras/cameras')).j;
  assert.deepEqual(cams.map((c) => c.id), ['c1']);
  const lk = await req('/crm-api/live-cameras/order/' + o2.id + '/link', { body: { cameraId: 'c1', days: 3 } });
  assert.equal(lk.status, 200, JSON.stringify(lk.j)); assert.equal(lk.j.url, 'https://live.example/v/new'); assert.equal(lk.j.reused, false);
  const pc = calls.filter((x) => x.path === '/api/v1/links' && x.body).at(-1).body;
  assert.equal(pc.cameraId, 'c1'); assert.equal(pc.orderId, String(o2.id)); assert.equal(pc.phone, '+48600700800'); assert.equal(pc.scheduleMode, 'workshop');
  assert.ok(new Date(pc.validTo) - Date.now() > 2.5 * 864e5);
  const lk2 = await req('/crm-api/live-cameras/order/' + o.id + '/link', { body: { cameraId: '' } });
  assert.equal(lk2.j.reused, true, 'есть активная ссылка — отправляем её же');
  console.log('✓ Kamery na żywo: вход в модуль только из CRM, ключ только на сервере, ссылки заказа, поиск в базе CRM, SMS клиенту, ссылка из окна статуса');
} finally {
  srv.kill(); fake.close();
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
}
