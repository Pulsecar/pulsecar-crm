// Несколько сервисов (филиалов): отдельные базы, переключение владельца, общий дашборд, вход сотрудника филиала
import { spawn } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const PORT = 3196, BASE = `http://localhost:${PORT}`, DB = './data/test-br/main.db';
rmSync('./data/test-br', { recursive: true, force: true });
let out = '';
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, PORT, DB_PATH: DB, ADMIN_PASSWORD: 'test-pass-123', SMS_PROVIDER: 'console', SESSION_SECRET: 'y'.repeat(40), PUBLIC_URL: 'http://localhost', NODE_ENV: 'test' },
});
srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/health'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
const client = () => {
  let cookie = '';
  return async (p, { body, method } = {}) => {
    const r = await fetch(BASE + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, j: j ?? t };
  };
};
const ok = (r, what) => { assert.ok(r.status < 300, `${what}: ${r.status} ${JSON.stringify(r.j).slice(0, 200)}`); return r.j; };
try {
  const A = client();
  ok(await A('/crm-api/login', { body: { login: 'admin', password: 'test-pass-123' } }), 'login');
  let me = ok(await A('/crm-api/me'), 'me');
  assert.equal(me.owner, true); assert.equal(me.branch.code, 'main');
  ok(await A('/crm-api/customers', { body: { name: 'Main Client', phone: '+48600111222' } }), 'main customer');
  assert.equal((await A('/crm-api/branches', { body: { name: 'X', code: '1' } })).status, 400, 'короткий код');
  ok(await A('/crm-api/branches', { body: { name: 'Mokotów', code: 'mk' } }), 'create');
  assert.equal((await A('/crm-api/branches', { body: { name: 'Again', code: 'MK' } })).status, 409, 'код занят');
  assert.ok(existsSync('./data/test-br/branches/mk.db'), 'своя база');
  ok(await A('/crm-api/branches/switch', { body: { code: 'MK' } }), 'switch');
  me = ok(await A('/crm-api/me'), 'me MK');
  assert.equal(me.branch.code, 'MK'); assert.equal(me.owner, true); assert.ok(me.statuses.length >= 5, 'статусы скопированы');
  assert.equal(ok(await A('/crm-api/customers'), 'cust MK').total, 0, 'клиенты отдельные');
  const o = ok(await A('/crm-api/orders', { body: { kind: 'order', customer: { name: 'Branch Client', phone: '+48600333444' } } }), 'order MK');
  const full = ok(await A('/crm-api/orders/' + o.id), 'order');
  assert.match(full.number, /\/MK$/, 'номер с кодом сервиса');
  ok(await A(`/crm-api/orders/${o.id}/payments`, { body: { method: 'cash', amount: 250 } }), 'pay');
  const card = ok(await A(`/crm-api/orders/${o.id}/card`, { body: {} }), 'card');
  assert.match(card.url, /\/k\/MK~/);
  const cp = await fetch(card.url.replace('http://localhost', BASE));
  assert.equal(cp.status, 200); assert.ok((await cp.text()).includes(full.number), 'карта открывается из базы филиала');
  ok(await A('/crm-api/staff', { body: { name: 'Mech MK', login: 'mechmk', password: 'mechmk-pass', role: 'mechanic' } }), 'staff MK');
  assert.equal((await A('/crm-api/staff', { body: { name: 'Dup', login: 'admin', password: 'xxxxxxxxxx', role: 'mechanic' } })).status, 409, 'логин уникален во всех сервисах');
  const dash = ok(await A('/crm-api/owner/dashboard'), 'owner dash');
  assert.equal(dash.rows.length, 2);
  assert.equal(dash.rows.find((r) => r.code === 'MK').income, 250);
  assert.equal(dash.rows.find((r) => r.code === 'main').income, 0);
  ok(await A('/crm-api/branches/switch', { body: { code: 'main' } }), 'back');
  assert.equal(ok(await A('/crm-api/customers'), 'cust main').total, 1);
  // сотрудник филиала входит сразу в свой сервис и не видит другие
  const M = client();
  ok(await M('/crm-api/login', { body: { login: 'mechmk', password: 'mechmk-pass' } }), 'mech login');
  me = ok(await M('/crm-api/me'), 'mech me');
  assert.equal(me.branch.code, 'MK'); assert.equal(me.owner, false); assert.deepEqual(me.branches, []);
  assert.equal((await M('/crm-api/owner/dashboard')).status, 403);
  assert.equal((await M('/crm-api/branches/switch', { body: { code: 'main' } })).status, 403);
  // отключённый сервис: его сотрудник выкидывается
  ok(await A('/crm-api/branches/MK', { method: 'PUT', body: { active: false } }), 'off');
  assert.equal((await M('/crm-api/me')).status, 401);
  assert.equal((await M('/crm-api/login', { body: { login: 'mechmk', password: 'mechmk-pass' } })).status, 401);
  ok(await A('/crm-api/branches/MK', { method: 'PUT', body: { active: true, name: 'Mokotów 2' } }), 'on + rename');
  assert.equal(ok(await A('/crm-api/branches'), 'list').rows.find((b) => b.code === 'MK').name, 'Mokotów 2');
  console.log('✓ сервисы: отдельные базы, нумерация с кодом, карта /k/КОД~, переключение владельца, общий дашборд, сотрудник филиала, отключение');
  console.log('\nВСЕ ПРОВЕРКИ СЕРВИСОВ ПРОЙДЕНЫ');
} catch (e) {
  console.error('✗', e.message); console.error(out.slice(-1500)); process.exitCode = 1;
} finally { srv.kill(); }
