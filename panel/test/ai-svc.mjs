// Модуль «ИИ-запчастист» (сервис): токены CRM, сохранение позиций в wycenę, запрет заказа «проверьте»,
// выгрузка истории без персональных данных, перенос ключей. Сервис подменён маленьким HTTP-сервером.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const PORT = 3197, SVC = 3196, BASE = `http://localhost:${PORT}`, SECRET = 's'.repeat(48);
const DB = './data/test-ai-svc.db';
for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });

// поддельный сервис: проверяет подпись токена и запоминает вызовы
const calls = [];
const verify = (t) => {
  const [part, sig] = String(t || '').split('.');
  const good = crypto.createHmac('sha256', SECRET).update(part).digest('base64url');
  return sig === good ? JSON.parse(Buffer.from(part, 'base64url').toString()) : null;
};
const fake = createServer((rq, rs) => {
  let b = '';
  rq.on('data', (d) => (b += d));
  rq.on('end', () => {
    const p = verify((rq.headers.authorization || '').slice(7));
    calls.push({ path: rq.url, method: rq.method, auth: p, body: b ? JSON.parse(b) : null });
    rs.setHeader('Content-Type', 'application/json');
    if (!p) { rs.statusCode = 401; return rs.end('{"error":"bad token"}'); }
    if (rq.url === '/api/history/import') return rs.end(JSON.stringify({ imported: JSON.parse(b).rows.length }));
    rs.end('{"ok":true}');
  });
}).listen(SVC);

const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, PORT, DB_PATH: DB, ADMIN_PASSWORD: 'test-pass-123', SESSION_SECRET: 'x'.repeat(40), SMS_PROVIDER: 'console',
    AI_PARTS_URL: 'https://ai-parts.example', AI_PARTS_INTERNAL_URL: `http://localhost:${SVC}`, AI_PARTS_SECRET: SECRET },
});
srv.stderr.on('data', (d) => process.stderr.write(d));
for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

let jar = '';
async function req(path, { body, method } = {}) {
  const r = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(jar ? { Cookie: jar } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jar = sc.split(';')[0];
  return { status: r.status, j: await r.json().catch(() => null) };
}
const ok = (x, m) => { assert.ok(x.status < 300, `${m}: ${x.status} ${JSON.stringify(x.j)}`); return x.j; };

try {
  ok(await req('/crm-api/login', { body: { login: 'admin', password: 'test-pass-123' } }), 'login');
  const me = ok(await req('/crm-api/me'), 'me');
  assert.equal(me.features.aiSvc, true); assert.equal(me.features.aiSvcUrl, 'https://ai-parts.example');
  const c = ok(await req('/crm-api/customers', { body: { first_name: 'Jan', last_name: 'Tajny', phone: '+48600700800', email: 'jan@example.com' } }), 'cust');
  const car = ok(await req('/crm-api/cars', { body: { customer_id: c.id, plate: 'WA 1234X', vin: 'WBS43AY07PFP64494', make: 'BMW', model: 'M3', engine: 'S58', year: '2023' } }), 'car');
  const q = ok(await req('/crm-api/orders', { body: { kind: 'quote', customer_id: c.id, car_id: car.id, items: [{ kind: 'labor', name: 'Wymiana klocków przód', price: 200 }] } }), 'quote');

  // токен: подпись, ws, роль, wid этой wyceny, срок ≤ 15 минут; данные авто — из этой wyceny
  const t = ok(await req('/crm-api/ai-svc/token?orderId=' + q.id), 'token');
  const p = verify(t.token);
  assert.ok(p); assert.equal(p.ws, 'main'); assert.equal(p.wid, String(q.id)); assert.equal(p.role, 'admin');
  assert.ok(p.exp - Date.now() / 1000 <= 900 && p.exp - Date.now() / 1000 > 800);
  assert.equal(t.vehicle.vin, 'WBS43AY07PFP64494'); assert.equal(t.vehicle.engine, 'S58'); assert.equal(t.defaultLevel, 'middle');
  assert.equal((await req('/crm-api/ai-svc/token?orderId=999999')).status, 404);

  // onAddItems: позиции → запчасти wyceny + строки ИИ; «проверьте» и «заказать оба»
  const offer = (brand, art, buy, net) => ({ brand, articleNumber: art, sku: 'SKU' + art, purchaseNet: buy, client: { net, gross: Math.round(net * 123) / 100 }, supplier: 'intercars', availability: 'Warszawa 2 szt.' });
  const items = [
    { aiJobId: 'job1', aiItemId: 'i1', status: 'ai_draft', needsCheck: false, name: 'Klocki hamulcowe przód', quantity: 1, unit: 'kpl', oeNumber: '34 10 8 093 705', level: 'middle',
      brand: 'TRW', articleNumber: 'GDB2140', supplier: 'intercars', supplierSku: 'SKUGDB2140', purchaseNet: 300, priceNet: 420, priceGross: 516.6,
      offers: { economy: offer('JURID', '573000J', 200, 280), middle: offer('TRW', 'GDB2140', 300, 420), oe: offer('BMW', '34108093705', 600, 800) }, evidence: [{ type: 'partslink24', ref: 'x' }] },
    { aiJobId: 'job1', aiItemId: 'i2', needsCheck: true, checkReason: 'Один источник', name: 'Czujnik zużycia klocków', quantity: 1, oeNumber: '34 35 6 890 789', level: null, offers: {} },
    { aiJobId: 'job1', aiItemId: 'i3', needsCheck: false, orderBothVariants: true, variants: [{ label: 'M Compound' }, { label: 'M Carbon' }], name: 'Tarcze przód', quantity: 2, oeNumber: '34 11 8 089 935', level: 'oe',
      offers: { oe: offer('BMW', '34118089935', 1000, 1300) } },
  ];
  const r1 = ok(await req(`/crm-api/orders/${q.id}/ai-svc-items`, { body: { items } }), 'add items');
  assert.equal(r1.added, 3);
  const r2 = ok(await req(`/crm-api/orders/${q.id}/ai-svc-items`, { body: { items } }), 'add again');
  assert.equal(r2.added, 0); assert.equal(r2.skipped.length, 3, 'повторный подбор не дублирует');
  const o = ok(await req('/crm-api/orders/' + q.id), 'order');
  const pad = o.items.find((i) => i.code === 'GDB2140');
  assert.ok(pad && pad.cost === 300 && Math.abs(pad.price - 516.6) < 0.01 && /TRW/.test(pad.name) && /OE 34 10 8 093 705/.test(pad.note));
  const ai = ok(await req('/crm-api/ai-parts/orders/' + q.id), 'ai lines');
  const lines = ai.lines || ai.rows || ai;
  const lPad = lines.find((l) => l.order_item_id === pad.id);
  assert.equal(lPad.chosen, 'mid'); assert.equal(lPad.variants.eco.article, '573000J'); assert.equal(lPad.variants.oe.sellGross, 984); assert.equal(lPad.status, 'draft');
  const lChk = lines.find((l) => l.title === 'Czujnik zużycia klocków');
  assert.equal(lChk.confidence, 'check');
  // «проверьте» нельзя заказать без подтверждения
  assert.equal((await req('/crm-api/ai-parts/lines/' + lChk.id, { body: { status: 'ordered' } })).status, 400);
  ok(await req('/crm-api/ai-parts/lines/' + lChk.id, { body: { status: 'accepted' } }), 'confirm');
  ok(await req('/crm-api/ai-parts/lines/' + lChk.id, { body: { status: 'ordered' } }), 'order after confirm');
  const lBoth = lines.find((l) => l.title === 'Tarcze przód');
  assert.equal(lBoth.confidence, 'high'); assert.match(lBoth.reason, /заказать оба/);
  ok(await req('/crm-api/ai-parts/lines/' + lBoth.id, { body: { status: 'ordered' } }), '«оба варианта» — заказ разрешён');

  // история: без имён, телефонов, e-mail (RODO)
  const h = ok(await req('/crm-api/ai-svc/history-export', { body: {} }), 'history');
  assert.equal(h.rows, 3); assert.equal(h.imported, 3);
  const imp = calls.filter((x) => x.path === '/api/history/import');
  assert.equal(imp[0].auth.role, 'system');
  const row = imp[0].body.rows.find((x) => x.article_number === 'GDB2140');
  assert.equal(row.vin, 'WBS43AY07PFP64494'); assert.equal(row.oe_number, '34 10 8 093 705'); assert.equal(row.brand, 'TRW'); assert.equal(row.price_net, 300); assert.equal(row.verified, 0);
  assert.match(row.job_text, /klocków/);
  const flat = JSON.stringify(imp[0].body);
  assert.ok(!/Tajny|600700800|jan@example/.test(flat), 'нет персональных данных');

  // закрытый zlecenie → строки уходят в историю с verified=1
  const zl = ok(await req('/crm-api/orders', { body: { kind: 'order', customer_id: c.id, car_id: car.id, items: [{ kind: 'labor', name: 'Wymiana klocków', price: 200 }] } }), 'order');
  ok(await req(`/crm-api/orders/${zl.id}/ai-svc-items`, { body: { items: [items[0]] } }), 'zl items');
  const fin = me.statuses.find((s) => s.is_final && s.lock_edit);
  ok(await req(`/crm-api/orders/${zl.id}/status`, { body: { status_id: fin.id } }), 'close');
  for (let i = 0; i < 20 && !calls.some((x) => x.path === '/api/history/import' && x.body.rows.some((r) => r.wycena_id === String(zl.id))); i++) await new Promise((r) => setTimeout(r, 100));
  const vr = calls.filter((x) => x.path === '/api/history/import').flatMap((x) => x.body.rows).find((r) => r.wycena_id === String(zl.id));
  assert.equal(vr?.verified, 1, 'закрытый заказ — verified=1');

  // перенос ключей: Claude и Inter Cars из CRM → модуль (роль admin)
  ok(await req('/crm-api/integrations/assistant', { method: 'PUT', body: { enabled: true, values: { apiKey: 'sk-ant-test-123' } } }), 'claude key');
  ok(await req('/crm-api/integrations/intercars', { method: 'PUT', body: { enabled: true, values: { clientId: 'cid', clientSecret: 'csec' } } }), 'ic keys');
  const sk = ok(await req('/crm-api/ai-svc/sync-keys', { body: {} }), 'sync keys');
  assert.deepEqual(sk.done, ['Claude', 'Inter Cars']);
  const icPut = calls.find((x) => x.path === '/api/integrations/intercars');
  assert.equal(icPut.auth.role, 'admin'); assert.equal(icPut.body.fields.client_id, 'cid'); assert.equal(icPut.body.fields.scope, 'allinone');
  assert.equal(calls.find((x) => x.path === '/api/integrations/anthropic').body.fields.api_key, 'sk-ant-test-123');

  // настройка «выключить» — кнопка и токены пропадают
  ok(await req('/crm-api/settings', { method: 'PUT', body: { ai_svc_on: '0' } }), 'off');
  assert.equal(ok(await req('/crm-api/me'), 'me2').features.aiSvc, false);
  assert.equal((await req('/crm-api/ai-svc/token?orderId=' + q.id)).status, 404);
  console.log('✓ ИИ-запчастист (сервис): токены, позиции в wycenę без дублей, «проверьте» не заказать, история без RODO-данных, перенос ключей');
} finally {
  srv.kill(); fake.close();
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
}
