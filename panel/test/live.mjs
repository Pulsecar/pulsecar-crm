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
const fake = createServer((rq, rs) => {
  let b = '';
  rq.on('data', (d) => (b += d));
  rq.on('end', () => {
    calls.push({ path: rq.url, auth: rq.headers.authorization, body: b ? JSON.parse(b) : null });
    rs.setHeader('Content-Type', 'application/json');
    if (rq.headers.authorization !== 'Bearer ' + KEY) { rs.statusCode = 401; return rs.end('{"error":"Brak dostępu"}'); }
    if (rq.url === '/api/v1/embed-sessions') return rs.end(JSON.stringify({ url: 'https://live.example/embed/start?t=abc', expiresIn: 120 }));
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
  console.log('✓ Kamery na żywo: вход в модуль только из CRM, ключ только на сервере, ссылки заказа');
} finally {
  srv.kill(); fake.close();
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
}
