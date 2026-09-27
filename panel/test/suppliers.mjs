// Хуртовни (Hart API, вставка с сайта, документ → склад / заказ), нумерация, сметы, прайс из Motowarsztat,
// настройки мастерской, шаблоны, чек-листы, права сотрудников.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const PORT = 3193, MOCK = 3192;
const BASE = `http://localhost:${PORT}`, M = `http://localhost:${MOCK}`;
const DB = './data/test-sup.db';
for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
const today = new Date().toISOString().slice(0, 10);
const calls = [];

const mock = createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const u = new URL(req.url, M);
  calls.push(`${req.method} ${u.pathname}`);
  const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/v1/auth') { const b = JSON.parse(body); return b.username === 'hartuser' && b.password === 'hartpass' ? json(200, { access_token: 'htok', expires_in: 18000 }) : json(401, { message: 'bad' }); }
  if (req.headers.authorization !== 'Bearer htok') return json(401, {});
  if (u.pathname === '/v1/documents/invoices') {
    assert.ok(u.searchParams.get('DateFrom') && u.searchParams.get('DateTo'));
    if (u.searchParams.get('Size') === '1') return json(200, []);
    return json(200, [{
      header: { documentNr: 'FV/123/09/2026', createdDate: today + 'T10:00:00', amountNet: 300, amountGross: 369 },
      seller: { hartBranchName: 'Hart Warszawa' },
      positions: [
        { productCode: '123456', productName: 'Klocki hamulcowe TRW GDB1330', quantity: 2, priceNetto: 80, taxRate: 23 },
        { productCode: '654321', productName: 'Filtr oleju MANN W712/75', quantity: 1, priceNetto: 20, taxRate: 23 },
        { productCode: '999', productName: 'Zwrot', quantity: 0, priceNetto: 5, taxRate: 23 },
      ],
    }]);
  }
  if (u.pathname === '/v1/products') return json(200, [{ hartCode: '123456', name: 'Klocki hamulcowe', supplierCode: 'GDB1330', supplier: 'TRW', taxRate: 23, quantity: 5, sellingPrice: 79.5, isPriceForManyPieces: false }]);
  if (u.pathname === '/v1/products/availability') return json(200, [{ hartCode: '123456', availabilityPerBranch: [{ branchCode: 'WAW', quantity: 3 }, { branchCode: 'OPO', quantity: 2 }] }]);
  if (u.pathname === '/v1/basket' && req.method === 'POST') { const b = JSON.parse(body); assert.equal(b.orderPositions[0].hartCode, '123456'); return json(200, { successfulOrders: [{ orderBufferPositionId: 77, orderedQuantity: 1 }] }); }
  if (u.pathname === '/v1/orders' && req.method === 'POST') { assert.deepEqual(JSON.parse(body).basketPositionIds, [77]); return json(200, { isSuccess: true, value: [{ orderId: 'H-1', isSuccess: true }] }); }
  json(404, {});
});
await new Promise((r) => mock.listen(MOCK, r));

let out = '';
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, NODE_ENV: 'test', PORT, DB_PATH: DB, ADMIN_PASSWORD: 'test-pass-123', SESSION_SECRET: 'z'.repeat(40), PUBLIC_URL: BASE },
});
srv.stdout.on('data', (d) => (out += d));
srv.stderr.on('data', (d) => process.stderr.write(d));
await new Promise((r) => setTimeout(r, 1300));

const jars = {};
let who = 'admin';
async function req(path, { body, method, form } = {}) {
  const r = await fetch(BASE + path, {
    method: method || (body || form ? 'POST' : 'GET'), redirect: 'manual',
    headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), ...(jars[who] ? { Cookie: jars[who] } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const sc = r.headers.get('set-cookie'); if (sc && !sc.startsWith('pcs=;')) jars[who] = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, j: ct.includes('json') ? await r.json() : await r.text() };
}
const ok = (x, msg) => { assert.ok(x.status < 300, `${msg}: ${x.status} ${JSON.stringify(x.j).slice(0, 300)}`); return x.j; };
const mm = String(new Date().getMonth() + 1).padStart(2, '0'), yy = new Date().getFullYear();

try {
  ok(await req('/crm-api/login', { body: { login: 'admin', password: 'test-pass-123' } }), 'login');
  let me = ok(await req('/crm-api/me'), 'me');

  // ── 1. прайс работ из Motowarsztat и шаблоны ──
  const cat = ok(await req('/crm-api/catalog'), 'catalog');
  assert.ok(cat.length >= 460, 'в прайсе ' + cat.length);
  assert.equal(cat.filter((c) => c.source === 'motowarsztat').length >= 400, true);
  assert.equal(cat.find((c) => c.name === 'Felga z czujnikiem').price, 20);
  assert.ok(cat.some((c) => c.category === 'Układy wydechowe' && c.name === 'Wymiana tłumika końcowego'));
  assert.ok(me.templates.length >= 2 && me.checklists.length >= 1 && me.expenses.length >= 8);
  console.log(`✓ прайс работ: ${cat.length} позиций (из Motowarsztat и сайта), шаблоны заказов, чек-листы, статьи расходов`);

  // ── 2. нумерация как в Motowarsztat: продолжаем с 298 и 132 ──
  const num = ok(await req('/crm-api/numbering'), 'numbering');
  assert.equal(num.find((n) => n.key === 'WY').pattern, 'WYC [numer]/[miesiac]/[rok]');
  let r = ok(await req('/crm-api/numbering/ZL', { method: 'PUT', body: { current: 298 } }), 'zl');
  assert.equal(r.next, `ZL 299/${mm}/${yy}`);
  ok(await req('/crm-api/numbering/WY', { method: 'PUT', body: { current: 132 } }), 'wy');
  assert.equal((await req('/crm-api/numbering/ZL', { method: 'PUT', body: { pattern: 'ZL/[rok]' } })).status, 400);
  const c = ok(await req('/crm-api/customers', { body: { name: 'Jan Kowalski', phone: '600100200' } }), 'cust');
  const car = ok(await req('/crm-api/cars', { body: { customer_id: c.id, plate: 'WA 11111', make: 'Skoda', model: 'Octavia' } }), 'car');
  const o1 = ok(await req('/crm-api/orders', { body: { customer_id: c.id, car_id: car.id } }), 'order');
  let o = ok(await req('/crm-api/orders/' + o1.id), 'o');
  assert.equal(o.number, `ZL 299/${mm}/${yy}`);
  const q1 = ok(await req('/crm-api/orders', { body: { kind: 'quote', customer_id: c.id, car_id: car.id } }), 'quote');
  const q = ok(await req('/crm-api/orders/' + q1.id), 'q');
  assert.equal(q.number, `WYC 133/${mm}/${yy}`);
  console.log(`✓ нумерация продолжает Motowarsztat: ${o.number}, смета ${q.number}`);

  // ── 3. смета: работы из шаблона, запчасти из хуртовни, превращение в заказ ──
  const tpl = me.templates.find((t) => t.name === 'Wymiana oleju');
  r = ok(await req(`/crm-api/orders/${q.id}/apply-template/${tpl.id}`, { body: {} }), 'tpl');
  assert.equal(r.added, tpl.items.length);

  // ── 4. Hart API: подключение, фактуры → документы, поиск, заказ ──
  ok(await req('/crm-api/integrations/hart', { method: 'PUT', body: { enabled: true, values: { username: 'hartuser', password: 'wrong', baseUrl: M, autoSync: false, source: 'invoice', markup: 40 } } }), 'hart');
  assert.equal((await req('/crm-api/integrations/hart/test', { body: {} })).status, 400);
  ok(await req('/crm-api/integrations/hart', { method: 'PUT', body: { enabled: true, values: { password: 'hartpass' } } }), 'hart pass');
  assert.match(ok(await req('/crm-api/integrations/hart/test', { body: {} }), 'hart test').info, /Hart API/);
  r = ok(await req('/crm-api/suppliers/sync', { body: { days: 7 } }), 'sync');
  assert.equal(r.hart.created, 1);
  assert.equal(ok(await req('/crm-api/suppliers/sync', { body: {} }), 'sync2').hart.created, 0, 'повторно не дублируется');
  let sup = ok(await req('/crm-api/suppliers?state=new'), 'suppliers');
  assert.ok(sup.wholesalers.length >= 55 && sup.wholesalers.some((w) => w.name === 'Auto Partner') && sup.wholesalers.find((w) => w.key === 'hart').connected);
  const hdoc = sup.docs.find((d) => d.supplier === 'hart');
  assert.equal(hdoc.ext_id, 'FV/123/09/2026'); assert.equal(hdoc.lines_count, 2); assert.equal(hdoc.total_net, 180);
  const s1 = ok(await req('/crm-api/suppliers/search?q=123456'), 'search');
  assert.equal(s1.rows[0].supplier, 'hart'); assert.equal(s1.rows[0].availability, 5); assert.equal(s1.rows[0].sellSuggested, Math.round(79.5 * 1.23 * 1.4 * 100) / 100);
  r = ok(await req('/crm-api/suppliers/order', { body: { supplier: 'hart', order_id: o.id, lines: [{ sku: '123456', qty: 1 }] } }), 'hart order');
  assert.deepEqual(r.orders, ['H-1']);
  console.log('✓ Hart API: фактуры сами приходят в «Хуртовни», поиск цены и наличия, заказ в Hart (корзина → заказ)');

  // ── 5. документ → сразу в заказ клиента (с приходом на склад) ──
  r = ok(await req(`/crm-api/suppliers/docs/${hdoc.id}/to-order`, { body: { order_id: o.id, pick: [0], toStock: true } }), 'to order');
  assert.equal(r.added, 1);
  o = ok(await req('/crm-api/orders/' + o.id), 'o2');
  const part = o.items.find((i) => i.kind === 'part');
  assert.equal(part.name, 'Klocki hamulcowe TRW GDB1330'); assert.equal(part.qty, 2); assert.equal(part.cost, 80); assert.equal(part.price, Math.round(80 * 1.23 * 1.4 * 100) / 100);
  assert.ok(part.product_id, 'выдано со склада');
  const d1 = ok(await req('/crm-api/suppliers/docs/' + hdoc.id), 'doc');
  assert.ok(d1.stock_doc_id); assert.equal(d1.used_in, o.number);
  assert.equal((await req(`/crm-api/suppliers/docs/${hdoc.id}/receive`, { body: {} })).status, 409, 'второй раз на склад не принимается');
  console.log('✓ поставка Hart → одной кнопкой в заказ клиента: приход PZ, запчасть со склада, наценка 40%');

  // ── 6. любая хуртовня: вставка таблицы с сайта (кнопка «В Pulsecar» / Ctrl+C) ──
  const pasted = 'Indeks\tNazwa\tProducent\tIlość\tCena netto\tWartość netto\nOC 90\tFiltr oleju\tKNECHT\t2\t18,50\t37,00\nLX 1566\tFiltr powietrza\tMAHLE\t1\t42,10\t42,10';
  const p1 = ok(await req('/crm-api/suppliers/parse', { body: { text: pasted } }), 'parse');
  assert.deepEqual(p1.lines.map((l) => [l.code, l.qty, l.price_net, l.brand]), [['OC 90', 2, 18.5, 'KNECHT'], ['LX 1566', 1, 42.1, 'MAHLE']]);
  const p2 = ok(await req('/crm-api/suppliers/parse', { body: { text: 'GDB1330  Klocki hamulcowe przód TRW  1  95,00\nOP 520  Filtr oleju Filtron  2 szt.  14,20' } }), 'parse raw');
  assert.equal(p2.lines.length, 2); assert.equal(p2.lines[0].code, 'GDB1330'); assert.equal(p2.lines[0].price_net, 95); assert.equal(p2.lines[1].qty, 2);
  const ap = ok(await req('/crm-api/suppliers/docs', { body: { supplier: 'autopartner', kind: 'clip', ext_id: 'WZ AP/555', lines: p1.lines } }), 'ap doc');
  r = ok(await req(`/crm-api/suppliers/docs/${ap.id}/receive`, { body: { pick: [1] } }), 'ap receive');
  assert.equal(r.lines, 1);
  const prods = ok(await req('/crm-api/products?q=LX 1566'), 'prods');
  assert.equal(prods.rows[0].stock, 1); assert.equal(prods.rows[0].supplier, 'Auto Partner');
  // в смету — без склада
  ok(await req(`/crm-api/suppliers/docs/${ap.id}/to-order`, { body: { order_id: q.id, pick: [0] } }), 'ap to quote');
  const qq = ok(await req('/crm-api/orders/' + q.id), 'qq');
  assert.ok(qq.items.some((i) => i.code === 'OC 90' && !i.product_id));
  console.log('✓ Auto Partner и любые хуртовни: таблица с сайта разобрана (с заголовками и без), приход частично, запчасти в смету');

  // ── 7. настройки мастерской работают ──
  ok(await req('/crm-api/settings', { method: 'PUT', body: { block_finish_open_jobs: '1', rbh_rate: '200', status_on_all_jobs: String(me.statuses.find((s) => s.pos === 5).id) } }), 'settings');
  const sch = ok(await req('/crm-api/settings/schema'), 'schema');
  assert.ok(sch.schema.length >= 6 && sch.values.rbh_rate === '200');
  r = ok(await req(`/crm-api/orders/${o.id}/items`, { body: { kind: 'labor', name: 'Diagnostyka', qty: 1.5, unit: 'rbh' } }), 'rbh item');
  o = ok(await req('/crm-api/orders/' + o.id), 'o3');
  const lab = o.items.find((i) => i.name === 'Diagnostyka');
  assert.equal(lab.price, 246); // 200 нетто × 1,23
  const fin = me.statuses.find((s) => s.is_final);
  assert.equal((await req(`/crm-api/orders/${o.id}/status`, { body: { status_id: fin.id } })).status, 400, 'нельзя завершить с невыполненными работами');
  ok(await req(`/crm-api/orders/${o.id}/items/${lab.id}`, { method: 'PUT', body: { done: 1 } }), 'done');
  o = ok(await req('/crm-api/orders/' + o.id), 'o4');
  assert.equal(o.status_id, me.statuses.find((s) => s.pos === 5).id, 'статус сменился сам — все работы выполнены');
  // чек-лист
  const cl = me.checklists[0];
  ok(await req(`/crm-api/orders/${o.id}/checklists`, { body: { checklist_id: cl.id } }), 'cl add');
  let chk = ok(await req(`/crm-api/orders/${o.id}/checklists`), 'cl get');
  const f0 = chk.filled[0];
  ok(await req(`/crm-api/orders/${o.id}/checklists`, { body: { id: f0.id, results: f0.results.map((x, i) => ({ ...x, state: i === 0 ? 'bad' : 'ok', note: i === 0 ? 'Mało paliwa' : '' })) } }), 'cl save');
  chk = ok(await req(`/crm-api/orders/${o.id}/checklists`), 'cl get2');
  assert.equal(chk.filled[0].results[0].state, 'bad'); assert.equal(chk.filled[0].results[0].note, 'Mało paliwa');
  console.log('✓ настройки: ставка RBH, запрет завершения с открытыми работами, автостатус, чек-листы в заказе');

  // ── 8. доступы сотрудников ──
  const staff = ok(await req('/crm-api/staff'), 'staff');
  assert.ok(staff.groups.length >= 8 && staff.presets.mechanic['orders.view'] && !staff.presets.mechanic['orders.jobs']);
  ok(await req('/crm-api/staff', { body: { name: 'Anna (recepcja)', login: 'anna', password: 'annapass1', role: 'staff', permissions: { 'invoices.create': false } } }), 'anna');
  ok(await req('/crm-api/staff', { body: { name: 'Mechanik Piotr', login: 'piotr', password: 'piotrpass1', role: 'mechanic', is_mechanic: 1, permissions: { 'orders.only_assigned': true, 'orders.prices': false } } }), 'piotr');
  const piotr = ok(await req('/crm-api/staff'), 'staff2').rows.find((s) => s.login === 'piotr');
  ok(await req('/crm-api/orders/' + q.id, { method: 'PUT', body: {} }), 'noop');
  const o2 = ok(await req('/crm-api/orders', { body: { customer_id: c.id, car_id: car.id, mechanic_id: piotr.id } }), 'order piotr');
  who = 'anna';
  ok(await req('/crm-api/login', { body: { login: 'anna', password: 'annapass1' } }), 'anna login');
  me = ok(await req('/crm-api/me'), 'anna me');
  assert.equal(me.perms['invoices.create'], false); assert.equal(me.perms['orders.create'], true); assert.equal(me.perms['settings.manage'], false);
  assert.equal((await req('/crm-api/staff')).status, 403);
  assert.equal((await req(`/crm-api/orders/${o.id}/invoice`, { body: {} })).status, 403);
  ok(await req('/crm-api/orders', { body: { customer_id: c.id } }), 'anna creates order');
  who = 'piotr';
  ok(await req('/crm-api/login', { body: { login: 'piotr', password: 'piotrpass1' } }), 'piotr login');
  const list = ok(await req('/crm-api/orders'), 'piotr list');
  assert.deepEqual(list.rows.map((x) => x.id), [o2.id], 'механик видит только свои заказы');
  assert.equal(list.rows[0].total, null, 'цены скрыты');
  assert.equal((await req('/crm-api/orders/' + o.id)).status, 403);
  assert.equal((await req('/crm-api/customers')).status, 403);
  who = 'admin';
  ok(await req('/crm-api/staff', { body: { ...piotr, revoke: true } }), 'revoke');
  who = 'piotr2';
  assert.equal((await req('/crm-api/login', { body: { login: 'piotr', password: 'piotrpass1' } })).status, 401, 'после отключения доступа вход закрыт');
  who = 'admin';
  const after = ok(await req('/crm-api/staff'), 'staff3').rows.find((s) => s.id === piotr.id);
  assert.equal(after.hourly_rate, piotr.hourly_rate, 'ставка не сбросилась');
  console.log('✓ доступы: свой логин каждому, права как в Motowarsztat (только свои заказы, без цен, без фактур), отключение доступа');

  // ── 9. расширение Chrome: ключ сотрудника и кнопка «Pobierz do Pulsecar» ──
  const tk = ok(await req('/crm-api/me/ext-token', { body: {} }), 'token').token;
  assert.match(tk, /^pcx_/);
  const ext = async (path, body) => { const r = await fetch(BASE + '/crm-api/' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json() }; };
  assert.equal(ok(await ext('ext/hello'), 'hello').can.order, true);
  const eo = ok(await ext('ext/orders'), 'ext orders');
  assert.ok(eo.orders.length && eo.quotes.length);
  const item = { supplier: 'intercars', sku: 'G0XEXU', code: 'PUR-PC2015AG-2', name: 'Салонный фильтр', brand: 'PURRO', qty: 1, price_net: 31.29, sell_gross: 75.62 };
  assert.equal((await ext('ext/pick', { items: [{ ...item, price_net: 0 }], stock: true })).status, 400, 'цена закупки 0 — на склад нельзя');
  r = ok(await ext('ext/pick', { supplier: 'intercars', items: [item], product: true, stock: true, order_id: o2.id, quote_id: q.id }), 'pick');
  assert.equal(r.products, 1); assert.ok(r.stock.startsWith('PZ')); assert.equal(r.order, ok(await req('/crm-api/orders/' + o2.id), 'o2').number);
  const o2f = ok(await req('/crm-api/orders/' + o2.id), 'o2f');
  const fp = o2f.items.find((i) => i.code === 'PUR-PC2015AG-2');
  assert.equal(fp.price, 75.62); assert.equal(fp.cost, 31.29); assert.ok(fp.product_id);
  assert.ok(ok(await req('/crm-api/orders/' + q.id), 'qf').items.some((i) => i.code === 'PUR-PC2015AG-2' && i.price === 75.62));
  const prod = ok(await req('/crm-api/products?q=PUR-PC2015AG-2'), 'prod').rows[0];
  assert.equal(prod.sell_price, 75.62); assert.equal(prod.purchase_price, 31.29); assert.equal(prod.stock, 1); assert.equal(prod.supplier_sku, 'G0XEXU');
  const pre = ok(await ext('ext/prepare', { items: [item] }), 'prepare');
  assert.equal(pre.items[0].product.id, prod.id);
  // фактура со страницы хуртовни: документ поставщика, сразу приход и в заказ; повтор по номеру не создаёт дубль
  const vr = await (await fetch(BASE + '/crm-api/ext/version')).json();
  assert.match(vr.version, /^\d+\.\d+\.\d+$/, 'версия расширения доступна без входа');
  assert.equal(ok(await ext('ext/hello'), 'hello2').latest, vr.version);
  const inv = { supplier: 'autopartner', kind: 'invoice', number: 'FV/2026/09/777', date: '2026-09-27', url: 'https://b2b.autopartner.com/faktury/777',
    lines: [{ code: 'MAP-OF-11', name: 'Filtr oleju', brand: 'MAPCO', qty: 2, price_net: 12.5, vat: 23 }, { code: 'BOS-0986', name: 'Świeca zapłonowa', brand: 'BOSCH', qty: 4, price_net: 18, vat: 23, sell_gross: 39.9 }] };
  r = ok(await ext('ext/doc', { ...inv, receive: true, order_id: o2.id }), 'ext doc');
  assert.ok(r.id && r.stock.startsWith('PZ') && r.order, 'фактура → приход и в заказ');
  const dup = await ext('ext/doc', { ...inv, receive: true });
  assert.equal(dup.status, 409, 'та же фактура второй раз — отказ');
  const sd = ok(await req('/crm-api/suppliers/docs/' + r.id), 'supplier doc');
  assert.equal(sd.doc?.ext_id ?? sd.ext_id, 'FV/2026/09/777');
  const spark = ok(await req('/crm-api/products?q=BOS-0986'), 'spark').rows[0];
  assert.equal(spark.stock, 4 - (ok(await req('/crm-api/orders/' + o2.id), 'o2d').items.filter((i) => i.code === 'BOS-0986').reduce((a, i) => a + (i.stock_taken ? i.qty : 0), 0)));
  assert.equal(spark.sell_price, 39.9, 'цена продажи = розничная хуртовни');
  r = ok(await ext('ext/doc', { ...inv, kind: 'cart', number: '', quote_id: q.id }), 'cart → quote');
  assert.ok(r.quote && !r.stock);
  ok(await req('/crm-api/me/ext-token', { method: 'DELETE' }), 'revoke token');
  assert.equal((await ext('ext/hello')).status, 401);
  console.log('✓ расширение: фактура / WZ / корзина со страницы хуртовни → документ поставщика без дублей, приход PZ, в заказ и смету');
  console.log('✓ расширение Chrome: кнопка в Inter Cars → товар в картотеке, приход на склад, в заказ и смету; цена продажи = рекомендованная');

  // ── 10. финансы ──
  const f = { from: '2020-01-01', to: '2030-12-31', basis: 'created' };
  const ov = ok(await req('/crm-api/finance/overview?' + new URLSearchParams({ ...f, compare: 'prev' })), 'overview');
  assert.ok(ov.kpi.orders >= 1 && ov.kpi.revenue > 0 && ov.series.length && ov.pnl.length && ov.cash && ov.expenses);
  assert.equal(Math.round(ov.kpi.grossProfit * 100), Math.round((ov.kpi.revenueNet - ov.kpi.cogs - ov.kpi.payroll) * 100));
  const pv = ok(await req('/crm-api/finance/pivot?' + new URLSearchParams({ ...f, group: 'mechanic', group2: 'month' })), 'pivot');
  assert.equal(pv.total.revenue, ov.kpi.revenue, 'конструктор и обзор сходятся');
  for (const g of Object.keys(pv.groups)) ok(await req('/crm-api/finance/pivot?' + new URLSearchParams({ ...f, group: g })), 'group ' + g);
  const csvR = await fetch(BASE + '/crm-api/finance/pivot?' + new URLSearchParams({ ...f, group: 'source', format: 'csv' }), { headers: { Cookie: jars.admin } });
  assert.match(await csvR.text(), /Источник клиента";"Заказов"/);
  ok(await req('/crm-api/finance/cash?' + new URLSearchParams(f)), 'cash');
  assert.ok(ok(await req('/crm-api/finance/orders?' + new URLSearchParams({ ...f, customer: c.id })), 'drill').length >= 1);
  assert.equal((await req('/crm-api/finance/overview?from=x&to=y')).status, 400);
  console.log('✓ финансы: обзор с сравнением, валовая прибыль, конструктор по 15 разрезам, CSV, деньги и долги, детализация до заказов');

  console.log('\nВСЕ ПРОВЕРКИ ХУРТОВЕН, НАСТРОЕК И ДОСТУПОВ ПРОЙДЕНЫ');
} catch (e) {
  console.error('✗', e.message);
  console.error(e.stack?.split('\n').slice(1, 3).join('\n'));
  console.error(out.slice(-2000));
  process.exitCode = 1;
} finally {
  srv.kill();
  mock.close();
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
}
