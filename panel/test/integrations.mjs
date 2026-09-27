// Тест интеграций с имитацией серверов Inter Cars, Fakturownia, Tpay, SMSAPI и вебхука. Запуск: npm run test:integrations
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const PORT = 3197, MOCK = 3196;
const BASE = `http://localhost:${PORT}`, M = `http://localhost:${MOCK}`;
const DB = './data/test-int.db';
for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });

// ── имитация внешних сервисов ──
const calls = [];
let paid = false;
const today = new Date().toISOString().slice(0, 10);
const mock = createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const u = new URL(req.url, M);
  calls.push(`${req.method} ${u.pathname}`);
  const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  // Inter Cars
  if (u.pathname === '/ic-token') {
    const ok = req.headers.authorization === 'Basic ' + Buffer.from('cid:csecret').toString('base64') && body.includes('grant_type=client_credentials') && body.includes('scope=allinone');
    return ok ? json(200, { access_token: 'ictok', expires_in: 3600 }) : json(401, { error_description: 'bad client' });
  }
  if (u.pathname.startsWith('/ic/')) {
    if (req.headers.authorization !== 'Bearer ictok') return json(401, {});
    if (u.pathname === '/ic/customer') return json(200, { name: 'AI CARS SP. Z O.O.', status: 'ACTIVE' });
    if (u.pathname === '/ic/customer/finances') return json(200, { availableCreditLimit: 5000, vipPoints: 120, currencyCode: 'PLN' });
    if (u.pathname === '/ic/delivery') {
      assert.ok(u.searchParams.get('creationDateFrom') && u.searchParams.get('creationDateTo'));
      if (u.searchParams.get('creationDateTo') !== today) return json(200, []);
      return json(200, [{
        id: '172072/1/WZO/2026', orderId: 'KOM/26/555', shipFrom: 'KOM', deliveryMethod: 'TRASA', creationDate: today + 'T09:12:00',
        lines: [
          { sku: 'ADDFFF', index: 'OP 520', name: 'Filtr oleju', eans: ['5904608005205'], shippedQuantity: 4, returnedQuantity: 0, unitPriceNet: 12.75, unitPriceGross: 15.68, vatPercentage: 23, brandReference: { name: 'FILTRON' }, retailPrice: { priceNet: 22, priceGross: 27.06 } },
          { sku: 'BRK123', index: 'GDB1330', name: 'Klocki hamulcowe przód', eans: [], shippedQuantity: 1, returnedQuantity: 0, unitPriceNet: 110, unitPriceGross: 135.3, vatPercentage: 23, brandReference: { name: 'TRW' } },
          { sku: 'RET1', index: 'X1', name: 'Zwrot', shippedQuantity: 1, returnedQuantity: 1, unitPriceNet: 5, vatPercentage: 23 },
        ],
      }]);
    }
    if (u.pathname === '/ic/pricing/quote') {
      const b = JSON.parse(body);
      assert.equal(b.lines[0].index, 'OP 520');
      return json(200, { lines: [{ sku: 'ADDFFF', index: 'OP 520', name: 'Filtr oleju', eans: [], price: { listPriceGross: 30, customerPriceNet: 12.75, customerPriceGross: 15.68, vatPercentage: 23 } }] });
    }
    if (u.pathname === '/ic/inventory/stock') return json(200, [{ sku: 'ADDFFF', location: 'KOM', availability: 7, customerRouteStartDateTime: today + 'T14:30:00' }, { sku: 'ADDFFF', location: 'HZA', availability: 3 }]);
    if (u.pathname === '/ic/sales/requisition' && req.method === 'POST') {
      const b = JSON.parse(body); assert.equal(b.lines[0].sku, 'ADDFFF'); assert.equal(b.customNumber, 'ZL 1/' + today.slice(5, 7) + '/' + today.slice(0, 4));
      return json(200, [{ id: 'KOM/26/777', requisitionId: 'IC/26/777', phaseCode: 'ACCEPTED', totalGross: 15.68 }]);
    }
    if (u.pathname === '/ic/sales/requisition/IC%2F26%2F777/confirm') return json(200, [{ requisitionId: 'IC/26/777', phaseCode: 'CONFIRMED' }]);
    return json(404, {});
  }
  // Fakturownia
  if (u.pathname === '/account.json') return u.searchParams.get('api_token') === 'fk/pulsecar' ? json(200, { prefix: 'pulsecar', name: 'AI CARS' }) : json(401, { code: 'error' });
  if (u.pathname === '/invoices.json') {
    const b = JSON.parse(body); assert.equal(b.api_token, 'fk/pulsecar'); assert.equal(b.invoice.buyer_tax_no, '5213000000');
    return json(201, { id: 991, number: 'FV 1/09/2026', view_url: 'https://pulsecar.fakturownia.pl/invoice/991', price_gross: b.invoice.positions.reduce((s, p) => s + p.total_price_gross, 0) });
  }
  if (u.pathname === '/invoices/991.pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end('%PDF-1.4 test'); }
  // Tpay
  if (u.pathname === '/oauth/auth') return body.includes('client_id=tp') ? json(200, { access_token: 'tptok', expires_in: 7200 }) : json(401, {});
  if (u.pathname === '/transactions' && req.method === 'POST') { const b = JSON.parse(body); return json(200, { result: 'success', transactionId: 'TR-1', transactionPaymentUrl: 'https://secure.tpay.com/?title=TR-1', amount: b.amount }); }
  if (u.pathname === '/transactions/TR-1') return json(200, { status: paid ? 'correct' : 'pending', amount: 90, amountPaid: paid ? 90 : 0 });
  // SMSAPI
  if (u.pathname === '/sms.do') return json(200, { count: 1 });
  if (u.pathname === '/profile') return json(200, { username: 'pulsecar', points: 42 });
  // вебхук
  if (u.pathname === '/hook') {
    const sig = createHmac('sha256', 'whsec').update(body).digest('hex');
    assert.equal(req.headers['x-pulsecar-signature'], sig);
    calls.push('HOOK ' + JSON.parse(body).event);
    return json(200, { ok: true });
  }
  json(404, {});
});
await new Promise((r) => mock.listen(MOCK, r));

let out = '';
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, NODE_ENV: 'test', PORT, DB_PATH: DB, ADMIN_PASSWORD: 'test-pass-123', SESSION_SECRET: 'x'.repeat(40), PUBLIC_URL: 'http://localhost',
    FAKTUROWNIA_BASE: M, TPAY_BASE: M, SMSAPI_BASE: M + '/sms.do', SMSAPI_PROFILE: M + '/profile' },
});
srv.stdout.on('data', (d) => (out += d));
srv.stderr.on('data', (d) => process.stderr.write(d));
await new Promise((r) => setTimeout(r, 1300));

let cookie = '';
async function req(path, { body, form, method } = {}) {
  const r = await fetch(BASE + path, {
    method: method || (body || form ? 'POST' : 'GET'), redirect: 'manual',
    headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, j: ct.includes('json') ? await r.json() : await r.text() };
}
const ok = (x, msg) => { assert.ok(x.status < 300, `${msg}: ${x.status} ${JSON.stringify(x.j).slice(0, 300)}`); return x.j; };
const put = (key, enabled, values) => req('/crm-api/integrations/' + key, { method: 'PUT', body: { enabled, values } });

try {
  // без входа — доступ к маркетингу закрыт, браузер уходит на вход
  assert.equal((await req('/crm-api/auth-check')).status, 401);
  const rd = await req('/crm-api/auth-check?redirect=1');
  assert.equal(rd.status, 302); assert.match(rd.headers.get('location'), /#\/marketing$/);
  ok(await req('/crm-api/login', { body: { login: 'admin', password: 'test-pass-123' } }), 'login');
  assert.equal((await req('/crm-api/auth-check')).status, 200);
  console.log('✓ общий вход: панель бота открывается только после входа в CRM');

  let list = ok(await req('/crm-api/integrations'), 'list');
  assert.ok(list.list.length >= 10);
  console.log('✓ интеграций в настройках:', list.list.map((i) => i.key).join(', '));

  // ── Inter Cars ──
  ok(await put('intercars', true, { clientId: 'cid', clientSecret: 'wrong', baseUrl: M, tokenUrl: M + '/ic-token', markup: 40, useRetail: true, autoSync: false }), 'ic save');
  assert.equal((await req('/crm-api/integrations/intercars/test', { body: {} })).status, 400);
  ok(await put('intercars', true, { clientSecret: 'csecret' }), 'ic secret');
  list = ok(await req('/crm-api/integrations'), 'list2');
  const icv = list.list.find((i) => i.key === 'intercars').values;
  assert.equal(icv.clientSecret, '••••cret'); assert.equal(icv.clientId, 'cid');
  ok(await put('intercars', true, { clientSecret: '••••cret' }), 'masked kept');
  const t = ok(await req('/crm-api/integrations/intercars/test', { body: {} }), 'ic test');
  assert.match(t.info, /AI CARS/);
  console.log('✓ Inter Cars: неверный секрет отклонён, секрет скрыт в браузере, проверка:', t.info);

  const sync = ok(await req('/crm-api/intercars/sync', { body: { days: 7 } }), 'sync');
  assert.equal(sync.created, 1);
  assert.equal(ok(await req('/crm-api/intercars/sync', { body: { days: 7 } }), 'sync2').created, 0);
  let docs = ok(await req('/crm-api/intercars/docs'), 'docs');
  assert.equal(docs.rows.length, 1); assert.equal(docs.rows[0].ext_id, '172072/1/WZO/2026');
  // уже существующий товар с тем же индексом (другой формат) должен сопоставиться
  ok(await req('/crm-api/products', { body: { name: 'Klocki TRW', code: 'GDB 1330', sell_price: 260 } }), 'existing product');
  const rec = ok(await req('/crm-api/intercars/receive-all', { body: {} }), 'receive');
  assert.equal(rec.received, 1);
  assert.equal((await req(`/crm-api/intercars/docs/${docs.rows[0].id}/receive`, { body: {} })).status, 409);
  let prods = ok(await req('/crm-api/products'), 'products').rows;
  const filt = prods.find((p) => p.supplier_sku === 'ADDFFF');
  assert.equal(prods.length, 2, 'возвращённая позиция не приходуется, GDB1330 сопоставлен');
  assert.equal(filt.stock, 4); assert.equal(filt.purchase_price, 12.75); assert.equal(filt.sell_price, 27.06); assert.equal(filt.ean, '5904608005205'); assert.equal(filt.manufacturer, 'FILTRON');
  const brk = prods.find((p) => p.code === 'GDB 1330');
  assert.equal(brk.stock, 1); assert.equal(brk.supplier_sku, 'BRK123'); assert.equal(brk.sell_price, 260);
  console.log('✓ поставка IC → приход PZ одной кнопкой: новые товары созданы, существующий сопоставлен по индексу, розница IC как цена продажи');

  const found = ok(await req('/crm-api/intercars/search?q=' + encodeURIComponent('OP 520')), 'search');
  assert.equal(found[0].availability, 10); assert.equal(found[0].priceNet, 12.75); assert.equal(found[0].sellSuggested, Math.round(12.75 * 1.23 * 1.4 * 100) / 100);
  const cust = ok(await req('/crm-api/customers', { body: { name: 'Firma Test', phone: '600111222', nip: '5213000000', email: 'firma@example.com' } }), 'cust');
  const order = ok(await req('/crm-api/orders', { body: { customer_id: cust.id, items: [{ kind: 'labor', name: 'Wymiana oleju', price: 100 }] } }), 'order');
  const icOrder = ok(await req('/crm-api/intercars/order', { body: { order_id: order.id, customNumber: 'ZL 1/' + today.slice(5, 7) + '/' + today.slice(0, 4), lines: [{ sku: 'ADDFFF', qty: 1, priceNet: 12.75, priceGross: 15.68 }] } }), 'ic order');
  assert.equal(icOrder.phase, 'CONFIRMED');
  console.log('✓ поиск в IC: наличие 10 шт. на 2 складах, цена с наценкой; заказ в IC отправлен и подтверждён');

  // ── Fakturownia (токен с префиксом, без домена) ──
  ok(await put('fakturownia', true, { token: 'fk/pulsecar' }), 'fk save');
  assert.match(ok(await req('/crm-api/integrations/fakturownia/test', { body: {} }), 'fk test').info, /pulsecar/);
  const inv = ok(await req(`/crm-api/orders/${order.id}/invoice`, { body: {} }), 'invoice');
  assert.equal(inv.number, 'FV 1/09/2026');
  const pdf = await fetch(`${BASE}/crm-api/orders/${order.id}/invoice.pdf`, { headers: { Cookie: cookie } });
  assert.equal(pdf.status, 200); assert.ok((await pdf.text()).startsWith('%PDF'));
  console.log('✓ Fakturownia: домен взят из токена, фактура выставлена, PDF получен');

  // ── SMSAPI, вебхук ──
  ok(await put('smsapi', true, { token: 'smstok', sender: 'Pulsecar' }), 'sms');
  assert.match(ok(await req('/crm-api/integrations/smsapi/test', { body: {} }), 'sms test').info, /pulsecar/);
  ok(await req(`/crm-api/orders/${order.id}/sms`, { body: { text: 'Samochód gotowy' } }), 'sms send');
  assert.ok(calls.includes('POST /sms.do'));
  ok(await put('webhook', true, { url: M + '/hook', secret: 'whsec' }), 'hook');
  ok(await req('/crm-api/integrations/webhook/test', { body: {} }), 'hook test');
  ok(await req(`/crm-api/orders/${order.id}/payments`, { body: { method: 'card', amount: 10 } }), 'pay');
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(calls.includes('HOOK payment'));
  console.log('✓ SMSAPI: SMS клиенту; вебхук с подписью HMAC получает события (оплата)');

  // ── Tpay ──
  ok(await put('tpay', true, { clientId: 'tp', clientSecret: 'tps' }), 'tpay');
  ok(await req('/crm-api/integrations/tpay/test', { body: {} }), 'tpay test');
  const link = ok(await req(`/crm-api/orders/${order.id}/paylink`, { body: {} }), 'paylink');
  assert.equal(link.amount, 90); assert.match(link.url, /tpay/);
  assert.equal(ok(await req(`/crm-api/orders/${order.id}/paylink/check`, { body: {} }), 'check').status, 'pending');
  paid = true;
  await fetch(BASE + '/hooks/tpay', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'tr_status=TRUE&tr_crc=fake' });
  await new Promise((r) => setTimeout(r, 400));
  const o2 = ok(await req('/crm-api/orders/' + order.id), 'order2');
  assert.equal(o2.paid, 100);
  assert.equal(o2.payments.filter((p) => p.note?.includes('TR-1')).length, 1);
  console.log('✓ Tpay: ссылка на оплату остатка 90 zł; после уведомления оплата перепроверена через API и записана один раз');

  // ── Календарь ──
  ok(await put('calendar', true, {}), 'cal');
  list = ok(await req('/crm-api/integrations'), 'list3');
  ok(await req('/crm-api/appointments', { body: { station_id: 1, start_at: today + ' 10:00', duration_min: 90, title: 'Klimatyzacja', contact_name: 'Jan' } }), 'appt');
  const feedPath = new URL(list.calendarFeed).pathname;
  const ics = await fetch(BASE + feedPath).then((r) => r.text());
  assert.ok(ics.includes('BEGIN:VCALENDAR') && ics.includes('Klimatyzacja') && ics.includes('DTSTART;TZID=Europe/Warsaw:' + today.replace(/-/g, '') + 'T100000'));
  assert.equal((await fetch(BASE + '/ical/wrong.ics')).status, 404);
  console.log('✓ календарь-подписка iCal для Google / iPhone');

  console.log('\nВСЕ ПРОВЕРКИ ИНТЕГРАЦИЙ ПРОЙДЕНЫ');
} catch (e) {
  console.error('✗', e.message);
  console.error(out.slice(-1500));
  process.exitCode = 1;
} finally {
  srv.kill(); mock.close();
}
