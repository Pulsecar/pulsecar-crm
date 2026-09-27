// Расширение ⇄ касса Novitus: фон расширения (background.js) против эмулятора NoviAPI
import http from 'node:http';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const seen = [];
let mode = 'ok';
let polls = 0;
const srv = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    const send = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, 'http://x');
    seen.push(`${req.method} ${u.pathname}`);
    const authed = req.headers.authorization === 'Bearer T1' || req.headers.authorization === 'Bearer T2';
    if (u.pathname === '/api/v1') return send(200, {});
    if (u.pathname === '/api/v1/token' && req.method === 'GET') return send(200, { token: 'T1', expiration_date: new Date(Date.now() + 3600e3).toISOString() });
    if (u.pathname === '/api/v1/token' && req.method === 'PATCH') return send(200, { token: 'T2', expiration_date: new Date(Date.now() + 3600e3).toISOString() });
    if (!authed) return send(401, { exception: { code: 4, description: 'Token incorrect' } });
    if (u.pathname === '/api/v1/queue') return send(200, { requests_in_queue: 0 });
    if (u.pathname === '/api/v1/receipt' && req.method === 'POST') {
      const j = JSON.parse(b);
      if (!j.receipt?.items?.length || !j.receipt.summary) return send(400, { exception: { code: 8, description: 'JSON Validation Error', errors: ['receipt.items'] } });
      polls = 0;
      return send(201, { request: { id: 'a'.repeat(32), status: 'STORED' } });
    }
    if (u.pathname === `/api/v1/receipt/${'a'.repeat(32)}` && req.method === 'PUT') return send(200, { request: { id: 'a'.repeat(32), status: 'CONFIRMED' } });
    if (u.pathname === `/api/v1/receipt/${'a'.repeat(32)}` && req.method === 'GET') {
      polls++;
      if (mode === 'err') return send(200, { device: { status: 'OK' }, request: { status: 'ERROR', id: 'a'.repeat(32), error: { code: 1521, description: 'Błąd PTU' } } });
      if (polls < 2) return send(200, { device: { status: 'OK' }, request: { status: 'PENDING', id: 'a'.repeat(32) } });
      return send(200, { device: { status: 'OK' }, request: { status: 'DONE', id: 'a'.repeat(32), jpkid: 1279 } });
    }
    send(404, { exception: { code: 1, description: 'Not found' } });
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}`;

// заглушка chrome.* для фона расширения
const store = {};
let listener;
let granted = false;
const ev = () => ({ addListener: () => {} });
const chrome = {
  runtime: { getManifest: () => ({ version: '1.2.0' }), onMessage: { addListener: (f) => (listener = f) }, onInstalled: ev(), onStartup: ev(), getURL: (p) => 'chrome-extension://x/' + p },
  storage: {
    sync: { get: async () => ({ panel: 'https://panel.pulsecar.tech', token: 'pcx_x' }), set: async () => {} },
    local: { get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : {}), set: async (o) => Object.assign(store, o) },
  },
  permissions: { contains: async () => granted },
  alarms: { onAlarm: ev(), create: () => {} }, contextMenus: { onClicked: ev(), removeAll: () => {}, create: () => {} },
  action: { setBadgeBackgroundColor: () => {}, setBadgeText: () => {} }, scripting: {}, tabs: { create: () => {} },
};
vm.runInNewContext(fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8'), { chrome, fetch, URL, AbortSignal, setTimeout, console, Date, JSON, Promise, encodeURIComponent });
const ask = (msg, origin = 'https://panel.pulsecar.tech') => new Promise((r) => listener(msg, { origin }, r));
const job = { driver: 'novitus', url, resource: 'receipt', body: { receipt: { items: [{ article: { name: 'Olej', ptu: 'A', quantity: '1', price: '10.00', value: '10.00' } }], summary: { total: '10.00', pay_in: '10.00' } } } };

try {
  let r = await ask({ type: 'fiscal', job });
  assert.equal(r.ok, false); assert.equal(r.needPermission, url);
  granted = true;
  r = await ask({ type: 'fiscal', job }, 'https://evil.example');
  assert.equal(r.ok, false);
  r = await ask({ type: 'fiscal', job: { ...job, url: 'http://8.8.8.8:8888' } });
  assert.equal(r.ok, false); assert.match(r.error, /локальной сети/);
  r = await ask({ type: 'fiscal', job: { driver: 'novitus', url, resource: 'ping' } });
  assert.equal(r.ok, true, r.error);
  r = await ask({ type: 'fiscal', job });
  assert.equal(r.ok, true, r.error); assert.equal(r.jpkid, 1279);
  assert.ok(seen.includes('PUT /api/v1/receipt/' + 'a'.repeat(32)), 'confirm');
  mode = 'err';
  r = await ask({ type: 'fiscal', job });
  assert.equal(r.ok, false); assert.match(r.error, /Błąd PTU/);
  console.log('✓ расширение: разрешение, только из CRM, только локальная сеть, токен, отправка → подтверждение → JPKID, ошибка кассы');
  console.log('ВСЕ ПРОВЕРКИ КАССЫ ПРОЙДЕНЫ');
} catch (e) {
  console.error('✗', e.message, seen.slice(-10));
  process.exitCode = 1;
} finally { srv.close(); }
