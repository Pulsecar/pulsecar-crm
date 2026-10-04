// TecRMI: подбор типа авто, поиск работы, норма времени → цена работы; знакомая работа ставится сама. Сервер TecRMI — заглушка.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const PORT = 3194, MOCK = 3193, BASE = `http://localhost:${PORT}`, DB = './data/test-rmi.db';
for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
const calls = [];
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const p = u.pathname.toLowerCase(); calls.push(p);
    const send = (j, h = {}) => { res.writeHead(200, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(j)); };
    if (p === '/auth/login') { const b = JSON.parse(body || '{}'); if (b.Company === 'PC' && b.Account === 'acc' && b.Password === 'secret') return send({}, { 'X-AuthToken': 'tok1' }); res.writeHead(401); return res.end(); }
    if (req.headers.authorization !== 'TecRMI tok1') { res.writeHead(401); return res.end(); }
    if (p === '/rest/vehicletree/makelist') return send([{ MakeId: 10, MakeName: 'OPEL' }, { MakeId: 11, MakeName: 'AUDI' }]);
    if (p === '/rest/vehicletree/rangelist') return send([{ RangeId: 100, RangeName: 'ASTRA J (P10)', ClassId: 1 }]);
    if (p === '/rest/vehicletree/typelist') return send([{ TypeId: 5555, TypeName: '1.4 Turbo', TypeDetails: [{ AddInfoKeyName: 'Rok produkcji', AddInfoKeyValue: '2009-2015' }, { AddInfoKeyName: 'kW', AddInfoKeyValue: '103' }] }]);
    if (p === '/rest/times/bodiesfortimes') return send([{ QualColId: 7, QualColText: 'Hatchback' }]);
    if (p === '/rest/times/worklist') return send([{ MainGroupId: 1, MainGroupName: 'Instalacja elektryczna', SubGroups: [{ SubGroupId: 2, SubGroupName: 'Alternator', ItemMps: [{ ItemMpId: 300, ItemMpText: 'Alternator', KorId: 4, KorText: 'wymontować i zamontować' }] }] }]);
    if (p === '/rest/times/worksteps') { assert.equal(u.searchParams.get('TypeId'), '5555'); return send([{ WorkId: 1, ItemMpId: 300, KorId: 4, ItemMpText: 'Alternator', KorText: 'wymontować i zamontować', WorkTime: 2.4, IsOnlyForReference: false }]); }
    res.writeHead(404); res.end();
  });
}).listen(MOCK);
let out = '';
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], { env: { ...process.env, PORT, DB_PATH: DB, ADMIN_PASSWORD: 'test-pass-123', SMS_PROVIDER: 'console', SESSION_SECRET: 'z'.repeat(40), PUBLIC_URL: 'http://localhost', NODE_ENV: 'test' } });
srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/health'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
let cookie = '';
const req = async (p, { body, method } = {}) => { const r = await fetch(BASE + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j: j ?? t }; };
const ok = (r, w) => { assert.ok(r.status < 300, `${w}: ${r.status} ${JSON.stringify(r.j).slice(0, 300)}`); return r.j; };
try {
  ok(await req('/crm-api/login', { body: { login: 'admin', password: 'test-pass-123' } }), 'login');
  ok(await req('/crm-api/settings', { method: 'PUT', body: { rbh_rate: '250' } }), 'rate');
  ok(await req('/crm-api/integrations/tecrmi', { method: 'PUT', body: { enabled: true, values: { company: 'PC', account: 'acc', password: 'secret', baseUrl: `http://localhost:${MOCK}` } } }), 'save integ');
  assert.match(ok(await req('/crm-api/integrations/tecrmi/test', { body: {} }), 'test').info || '', /Вход успешен/);
  assert.ok(ok(await req('/crm-api/me'), 'me').features.tecrmi, 'фича включена');
  const cust = ok(await req('/crm-api/customers', { body: { name: 'Jan', phone: '+48600700800' } }), 'cust');
  const car = ok(await req('/crm-api/cars', { body: { customer_id: cust.id, plate: 'WA1234X', make: 'Opel', model: 'Astra J', year: '2012', power_kw: 103, vin: 'W0LPD6ED8EG012345' } }), 'car');
  const o = ok(await req('/crm-api/orders', { body: { kind: 'order', customer_id: cust.id, car_id: car.id } }), 'order');
  const it = ok(await req(`/crm-api/orders/${o.id}/items`, { body: { kind: 'labor', name: 'Замена генератора', qty: 1, unit: 'oper', price: 0, vat: 23 } }), 'item');
  // 1-й раз: тип авто подбирается сам (один вариант), работа ещё незнакома → окно выбора
  const v = ok(await req(`/crm-api/tecrmi/vehicle?order_id=${o.id}`), 'vehicle');
  assert.equal(v.type.TypeId, 5555); assert.ok(v.auto);
  assert.equal(ok(await req('/crm-api/tecrmi/auto', { body: { order_id: o.id, item_id: it.id } }), 'auto1').need, 'work');
  const w = ok(await req(`/crm-api/tecrmi/works?order_id=${o.id}&q=alternator`), 'works');
  assert.equal(w.works[0].ItemMpId, 300);
  const ap = ok(await req('/crm-api/tecrmi/apply', { body: { order_id: o.id, item_id: it.id, ...w.works[0] } }), 'apply');
  assert.equal(ap.hours, 2.4); assert.equal(ap.rate, 307.5);
  let full = ok(await req('/crm-api/orders/' + o.id), 'order full');
  let line = full.items.find((x) => x.id === it.id);
  assert.equal(line.qty, 2.4); assert.equal(line.unit, 'rbh'); assert.equal(line.price, 307.5); assert.match(line.norm_src, /TecRMI 2,4 h/);
  assert.equal(full.total, 738, '2,4 ч × 307,50 = 738 zł брутто');
  // 2-й раз та же работа в другом заказе — норма ставится сама
  const o2 = ok(await req('/crm-api/orders', { body: { kind: 'order', customer_id: cust.id, car_id: car.id } }), 'order2');
  const it2 = ok(await req(`/crm-api/orders/${o2.id}/items`, { body: { kind: 'labor', name: 'Замена генератора', qty: 1, unit: 'oper', price: 0, vat: 23 } }), 'item2');
  const a2 = ok(await req('/crm-api/tecrmi/auto', { body: { order_id: o2.id, item_id: it2.id } }), 'auto2');
  assert.ok(a2.applied); assert.equal(a2.total, 738);
  console.log('✓ TecRMI: тип авто по марке/модели/kW, поиск работы, норма 2,4 ч × ставка RBH → цена, знакомая работа ставится сама');
  console.log('\nВСЕ ПРОВЕРКИ TecRMI ПРОЙДЕНЫ');
} catch (e) { console.error('✗', e.message); console.error(out.slice(-1500)); process.exitCode = 1; } finally { srv.kill(); mock.close(); }
