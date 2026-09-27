// Тест того, что перенесено из Motowarsztat: SMS-провайдеры и журнал, шаблоны статусов, напоминание за сутки,
// электронная карта заказа с акцептом (кнопка и код SMS), онлайн-запись, Aztec с техпаспорта, данные по номеру.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const PORT = 3195, MOCK = 3194;
const BASE = `http://localhost:${PORT}`, M = `http://localhost:${MOCK}`;
const DB = './data/test-msg.db';
for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });

const sent = []; // что ушло через имитацию шлюзов
const mock = createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const u = new URL(req.url, M);
  const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const basic = (user, pass) => req.headers.authorization === 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  // SMS Gateway for Android (облако)
  if (u.pathname === '/3rdparty/v1/devices') return basic('gw', 'gwpass') ? json(200, [{ id: 'd1', name: 'Samsung A15' }]) : json(401, { message: 'Unauthorized' });
  if (u.pathname === '/3rdparty/v1/message') {
    if (!basic('gw', 'gwpass')) return json(401, {});
    const b = JSON.parse(body); sent.push({ via: 'smsgate', to: b.phoneNumbers[0], text: b.textMessage.text }); return json(202, { id: 'm' + sent.length, state: 'Pending' });
  }
  // SerwerSMS
  if (u.pathname === '/messages/send_sms.json') {
    if (req.headers.authorization !== 'Bearer sstok') return json(401, { error: { message: 'Unauthorized' } });
    const b = JSON.parse(body); sent.push({ via: 'serwersms', to: b.phone, text: b.text }); return json(200, { success: true, queued: 1, items: [{ id: 'ss1' }] });
  }
  if (u.pathname === '/account/limits.json') return req.headers.authorization === 'Bearer sstok' ? json(200, { items: [{ type: 'eco', value: 100 }] }) : json(401, { error: { message: 'bad' } });
  // SMSPLANET
  if (u.pathname === '/sms') { const b = new URLSearchParams(body); sent.push({ via: 'smsplanet', to: b.get('to'), text: b.get('msg') }); return json(200, { messageId: '191919' }); }
  if (u.pathname === '/getBalance') return json(200, { balance: 251 });
  // Twilio
  if (u.pathname === '/2010-04-01/Accounts/AC1.json') return basic('AC1', 'twtok') ? json(200, { friendly_name: 'Pulsecar', status: 'active' }) : json(401, { message: 'Authenticate' });
  if (u.pathname === '/2010-04-01/Accounts/AC1/Messages.json') { const b = new URLSearchParams(body); sent.push({ via: 'twilio', to: b.get('To'), text: b.get('Body'), from: b.get('From') }); return json(201, { sid: 'SM1' }); }
  // свой шлюз по HTTP
  if (u.pathname === '/custom-sms') { const b = JSON.parse(body); assert.equal(req.headers['x-key'], 'k1'); sent.push({ via: 'smshttp', to: b.to, text: b.message }); return json(200, { ok: true }); }
  // RegCheck (данные по номеру)
  if (u.pathname === '/reg/CheckPoland') {
    if (u.searchParams.get('username') !== 'rcuser') return json(500, {});
    if (u.searchParams.get('RegistrationNumber') !== 'WE12345') { res.writeHead(500); return res.end('No vehicle found'); }
    const v = { Description: 'VOLKSWAGEN PASSAT', CarMake: { CurrentTextValue: 'VOLKSWAGEN' }, CarModel: { CurrentTextValue: 'PASSAT' }, RegistrationDate: '2011-03-15', ManufacturingYear: '2010', VehicleIdentificationNumber: 'WVWZZZ3CZBE123456', EngineSize: { CurrentTextValue: '1968' }, Power: '103', FuelType: { CurrentTextValue: 'Diesel' } };
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end(`<?xml version="1.0"?><Vehicle xmlns="http://regcheck.org.uk"><vehicleJson>${JSON.stringify(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}</vehicleJson><vehicleData/></Vehicle>`);
  }
  json(404, {});
});
await new Promise((r) => mock.listen(MOCK, r));

let out = '';
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, NODE_ENV: 'test', PORT, DB_PATH: DB, ADMIN_PASSWORD: 'test-pass-123', SESSION_SECRET: 'y'.repeat(40), PUBLIC_URL: BASE,
    SERWERSMS_BASE: M, SMSPLANET_BASE: M, TWILIO_BASE: M, REGCHECK_BASE: M + '/reg' },
});
srv.stdout.on('data', (d) => (out += d));
srv.stderr.on('data', (d) => process.stderr.write(d));
await new Promise((r) => setTimeout(r, 1300));

let cookie = '';
async function req(path, { body, form, method, anon } = {}) {
  const r = await fetch(BASE + path, {
    method: method || (body || form ? 'POST' : 'GET'), redirect: 'manual',
    headers: { ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : { 'Content-Type': 'application/json' }), ...(cookie && !anon ? { Cookie: cookie } : {}) },
    body: form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get('set-cookie'); if (sc && !anon) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, j: ct.includes('json') ? await r.json() : await r.text() };
}
const ok = (x, msg) => { assert.ok(x.status < 300, `${msg}: ${x.status} ${JSON.stringify(x.j).slice(0, 300)}`); return x.j; };
const put = (key, enabled, values) => req('/crm-api/integrations/' + key, { method: 'PUT', body: { enabled, values } });
const warsaw = (min) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(Date.now() + min * 60_000)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}`;
};

try {
  ok(await req('/crm-api/login', { body: { login: 'admin', password: 'test-pass-123' } }), 'login');

  // ── 1. Шаблоны из Motowarsztat на месте ──
  const msg = ok(await req('/crm-api/messaging'), 'messaging');
  assert.match(msg.values.sms_tpl_reminder, /Przypominamy o wizycie dnia \[\[zlecenie\.dataPrzyjecia\]\] o \[\[zlecenie\.godzinaPrzyjecia\]\] Arkuszowa 176/);
  assert.match(msg.values.sms_tpl_quote, /\[\[wycena\.link\]\]/);
  const me = ok(await req('/crm-api/me'), 'me');
  const byPos = Object.fromEntries(me.statuses.map((s) => [s.pos, s]));
  assert.equal(byPos[7].sms_mode, 'ask'); assert.match(byPos[7].sms_template, /jest gotowy do odbioru/);
  assert.match(byPos[8].sms_template, /g\.page\/r\/CdP6wLn_Tf1mEBM\/review/);
  assert.match(byPos[9].sms_template, /Miales dzis wizyte/);
  assert.equal(byPos[1].sms_mode, 'off');
  console.log('✓ шаблоны SMS и e-mail перенесены из Motowarsztat (напоминание, карта, смета, 5 статусов с SMS)');

  // ── 2. Без провайдера SMS не теряется: пишется в журнал ──
  const cust = ok(await req('/crm-api/customers', { body: { name: 'Adam Nowak', phone: '600 700 800' } }), 'customer');
  const car = ok(await req('/crm-api/cars', { body: { customer_id: cust.id, plate: 'WE 12345', make: 'Volkswagen', model: 'Passat' } }), 'car');
  ok(await req('/crm-api/sms', { body: { customer_id: cust.id, text: 'Test bez bramki' } }), 'sms no provider');
  let log = ok(await req('/crm-api/sms'), 'sms log');
  assert.equal(log.rows[0].status, 'logged'); assert.equal(log.provider, null);

  // ── 3. Провайдеры: проверка связи и отправка ──
  ok(await put('smsgate', true, { user: 'gw', pass: 'wrong', url: M + '/3rdparty/v1' }), 'gw');
  assert.equal((await req('/crm-api/integrations/smsgate/test', { body: {} })).status, 400);
  ok(await put('smsgate', true, { pass: 'gwpass' }), 'gw pass');
  assert.match(ok(await req('/crm-api/integrations/smsgate/test', { body: {} }), 'gw test').info, /Samsung A15/);
  ok(await req('/crm-api/sms', { body: { customer_id: cust.id, text: 'Zażółć gęślą jaźń' } }), 'sms gw');
  assert.deepEqual(sent.at(-1), { via: 'smsgate', to: '+48600700800', text: 'Zazolc gesla jazn' }); // без польских букв — 160 знаков в SMS
  ok(await put('serwersms', true, { token: 'sstok', sender: 'Pulsecar' }), 'ss');
  assert.match(ok(await req('/crm-api/integrations/serwersms/test', { body: {} }), 'ss test').info, /eco: 100/);
  ok(await put('smsplanet', true, { token: 'sptok' }), 'sp');
  assert.match(ok(await req('/crm-api/integrations/smsplanet/test', { body: {} }), 'sp test').info, /251/);
  ok(await put('twilio', true, { sid: 'AC1', token: 'twtok', from: '+48500000000' }), 'tw');
  assert.match(ok(await req('/crm-api/integrations/twilio/test', { body: {} }), 'tw test').info, /Pulsecar/);
  ok(await put('smshttp', true, { url: M + '/custom-sms', method: 'POST', body: '{"to":"{phone}","message":"{text}"}', headers: '{"X-Key":"k1"}', testPhone: '600700800' }), 'http');
  assert.match(ok(await req('/crm-api/integrations/smshttp/test', { body: {} }), 'http test').info, /отправлено/);
  assert.deepEqual(sent.at(-1), { via: 'smshttp', to: '+48600700800', text: 'Pulsecar: test SMS' });
  for (const prov of ['serwersms', 'smsplanet', 'twilio']) {
    ok(await req('/crm-api/messaging', { method: 'PUT', body: { sms_provider: prov } }), 'pick ' + prov);
    ok(await req('/crm-api/sms', { body: { phone: '+48 600 700 800', text: 'Test "' + prov + '"\nlinia 2' } }), 'send ' + prov);
    assert.equal(sent.at(-1).via, prov); assert.equal(sent.at(-1).text, 'Test "' + prov + '"\nlinia 2');
  }
  ok(await req('/crm-api/messaging', { method: 'PUT', body: { sms_provider: 'smsgate' } }), 'back to gw');
  const icfg = ok(await req('/crm-api/integrations'), 'ints').list.find((i) => i.key === 'smsgate');
  assert.equal(icfg.values.pass, '••••pass');
  console.log('✓ SMS-шлюзы: свой телефон (SMS Gateway), SerwerSMS, SMSPLANET, Twilio, любой HTTP; выбор шлюза; журнал SMS');

  // ── 4. Заказ → статус с готовой SMS → электронная карта заказа ──
  const order = ok(await req('/crm-api/orders', { body: { customer_id: cust.id, car_id: car.id, complaint: 'Stuki z przodu', mileage: 185000 } }), 'order');
  ok(await req(`/crm-api/orders/${order.id}/items`, { body: { kind: 'labor', name: 'Wymiana wahacza', qty: 1, price: 200 } }), 'labor');
  ok(await req(`/crm-api/orders/${order.id}/items`, { body: { kind: 'part', name: 'Wahacz TRW', qty: 1, price: 350 } }), 'part');
  const ready = byPos[7];
  const st = ok(await req(`/crm-api/orders/${order.id}/status`, { body: { status_id: ready.id } }), 'status ready');
  assert.equal(st.sms.phone, '+48600700800');
  const link = st.sms.text.match(/https?:\/\/\S+\/k\/[\w-]+/)[0];
  assert.match(st.sms.text, /^Witaj,\n\nPojazd Volkswagen Passat jest gotowy do odbioru\. Kosztorys - http/);
  const n0 = sent.length;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(sent.length, n0, 'в режиме «спросить» SMS не должна уходить сама');
  ok(await req(`/crm-api/orders/${order.id}/sms`, { body: { text: st.sms.text, kind: 'status' } }), 'send status sms');
  assert.equal(sent.at(-1).via, 'smsgate'); assert.match(sent.at(-1).text, /gotowy do odbioru/);
  // шаблон карты заказа и сметы по кнопке
  const tpl = ok(await req(`/crm-api/orders/${order.id}/template?kind=card`), 'tpl card');
  assert.ok(tpl.text.includes(link) && tpl.text.includes('WE12345'));

  // страница карты для клиента — без входа
  const token = link.split('/k/')[1];
  let pg = await req('/k/' + token, { anon: true });
  assert.equal(pg.status, 200);
  for (const s of ['Protokół przyjęcia', 'Kosztorys', 'Historia podpisów', 'Wymiana wahacza', 'Wahacz TRW', '550,00 zł', 'Volkswagen Passat', 'WE12345', 'Stuki z przodu', 'Akceptuję']) assert.ok(pg.j.includes(s), 'на карте нет: ' + s);
  assert.equal((await req('/k/nieistnieje123', { anon: true })).status, 404);
  // акцепт кнопкой → статус «Согласование» не трогаем, но в заказе отметка и история
  let r = await req(`/k/${token}/accept`, { form: {}, anon: true });
  assert.equal(r.status, 303);
  pg = await req('/k/' + token + '?m=accepted', { anon: true });
  assert.ok(pg.j.includes('Zaakceptowany') && pg.j.includes('Dziękujemy') && pg.j.includes('Przycisk „Akceptuję”'));
  let o = ok(await req('/crm-api/orders/' + order.id), 'order after accept');
  assert.ok(o.accepted_at); assert.equal(o.accepted_via, 'button');
  assert.ok(o.activity.some((a) => a.action === 'accepted'));

  // акцепт кодом SMS на смете + смена статуса после акцепта
  const inRepair = byPos[4];
  ok(await req('/crm-api/settings', { method: 'PUT', body: { card_estimate_accept: 'sms', card_accept_status_id: String(inRepair.id) } }), 'accept sms');
  const q = ok(await req('/crm-api/orders', { body: { kind: 'order', customer_id: cust.id, car_id: car.id } }), 'order2');
  ok(await req(`/crm-api/orders/${q.id}/items`, { body: { kind: 'labor', name: 'Diagnostyka', qty: 1, price: 100 } }), 'labor2');
  const cardUrl = ok(await req(`/crm-api/orders/${q.id}/card`, { body: {} }), 'card url').url;
  const t2 = cardUrl.split('/k/')[1];
  pg = await req('/k/' + t2, { anon: true });
  assert.ok(pg.j.includes('Podpisz kodem SMS'));
  r = await req(`/k/${t2}/code`, { form: {}, anon: true });
  assert.equal(r.status, 303);
  const code = sent.at(-1).text.match(/(\d{6})/)[1];
  assert.match(sent.at(-1).text, /^Kod potwierdzenia: \d{6}\. PulseCar Service$/);
  r = await req(`/k/${t2}/accept`, { form: { code: '000000' === code ? '111111' : '000000' }, anon: true });
  assert.match(r.headers.get('location'), /m=badcode/);
  r = await req(`/k/${t2}/accept`, { form: { code }, anon: true });
  assert.match(r.headers.get('location'), /m=signed/);
  o = ok(await req('/crm-api/orders/' + q.id), 'order2 after');
  assert.equal(o.accepted_via, 'sms'); assert.equal(o.status_id, inRepair.id);
  console.log('✓ смена статуса → окно с готовой SMS; электронная карта заказа: акцепт кнопкой и кодом SMS, статус меняется сам');

  // ── 5. Напоминание о визите за сутки ──
  const at = warsaw(23 * 60);
  ok(await req('/crm-api/appointments', { body: { station_id: 1, start_at: at, duration_min: 60, customer_id: cust.id, car_id: car.id, title: 'Olej' } }), 'appt');
  ok(await req('/crm-api/appointments', { body: { station_id: 2, start_at: warsaw(3 * 24 * 60), duration_min: 60, customer_id: cust.id, title: 'Później' } }), 'appt later');
  const before = sent.length;
  ok(await req('/crm-api/_jobs', { body: {} }), 'jobs');
  await new Promise((r2) => setTimeout(r2, 300));
  const rem = sent.slice(before);
  assert.equal(rem.length, 1, 'одно напоминание (визит через 3 дня ещё рано)');
  assert.equal(rem[0].text, `Przypominamy o wizycie dnia ${at.slice(0, 10)} o ${at.slice(11, 16)} Arkuszowa 176\n\nPozdrawiam PulseCar Service.`);
  ok(await req('/crm-api/_jobs', { body: {} }), 'jobs again');
  await new Promise((r2) => setTimeout(r2, 200));
  assert.equal(sent.length, before + 1, 'повторно не напоминаем');
  console.log('✓ напоминание о визите за 24 ч по шаблону Motowarsztat, без повторов');

  // ── 6. Онлайн-запись с сайта ──
  pg = await req('/rezerwacja?embed=1', { anon: true });
  assert.equal(pg.status, 200); assert.ok(pg.j.includes('Umów wizytę'));
  assert.match((await req('/rezerwacja.js', { anon: true })).j, /rezerwacja\?embed=1/);
  r = await req('/rezerwacja', { anon: true, form: { name: 'Ewa', phone: '511 222 333', plate: 'wx 9999a', service: 'Klimatyzacja', date: at.slice(0, 10), time: '10:30', note: 'Nie chłodzi', consent: '1' } });
  assert.ok(r.j.includes('Dziękujemy'));
  const cal = ok(await req(`/crm-api/appointments?from=${at.slice(0, 10)}&to=${at.slice(0, 10)}`), 'cal');
  const site = cal.unassigned.find((a) => a.source === 'site');
  assert.ok(site && site.contact_phone === '+48511222333' && /WX9999A/.test(site.title) && site.preferred === `${at.slice(0, 10)} 10:30`);
  r = await req('/rezerwacja', { anon: true, form: { name: 'Bot', phone: '500000000', website: 'spam', consent: '1' } });
  assert.equal(ok(await req(`/crm-api/appointments?from=${at.slice(0, 10)}&to=${at.slice(0, 10)}`), 'cal2').unassigned.filter((a) => a.source === 'site').length, 1);
  console.log('✓ онлайн-запись для сайта (ссылка и код для вставки): заявка падает в «Не распределено», спам-боты отсеиваются');

  // ── 7. Техпаспорт: Aztec и поиск по номеру ──
  const raw = readFileSync('./test/aztec-sample.txt', 'utf8').trim();
  const az = ok(await req('/crm-api/vehicle/aztec', { body: { raw } }), 'aztec');
  assert.equal(az.car.vin, 'WVWZZZ3CZBE123456'); assert.equal(az.car.plate, 'WE12345'); assert.equal(az.car.make, 'VOLKSWAGEN');
  assert.equal(az.car.capacity, 1968); assert.equal(az.car.power_kw, 103); assert.equal(az.car.fuel, 'diesel'); assert.equal(az.car.first_reg, '2011-03-15');
  assert.equal(az.owner.name, 'Adam Nowak'); assert.equal(az.owner.street, 'Arkuszowa 176/5');
  assert.ok(!JSON.stringify(az).includes('00000000000'), 'PESEL не должен уходить в браузер');
  assert.equal(az.existing.id, car.id);
  assert.equal((await req('/crm-api/vehicle/aztec', { body: { raw: 'to nie jest kod' } })).status, 400);
  assert.equal((await req('/crm-api/vehicle/plate/WE12345')).status, 400); // не подключено
  ok(await put('plate', true, { provider: 'regcheck', username: 'rcuser', testPlate: 'WE12345' }), 'plate');
  assert.match(ok(await req('/crm-api/integrations/plate/test', { body: {} }), 'plate test').info, /VOLKSWAGEN PASSAT 2010/);
  const pl = ok(await req('/crm-api/vehicle/plate/we 12345'), 'plate lookup');
  assert.equal(pl.vin, 'WVWZZZ3CZBE123456'); assert.equal(pl.capacity, 1968); assert.equal(pl.power_kw, 103); assert.equal(pl.first_reg, '2011-03-15');
  assert.equal((await req('/crm-api/vehicle/plate/WX0000')).status, 404);
  ok(await req('/crm-api/cars/' + car.id, { method: 'PUT', body: { vin: pl.vin, first_reg: pl.first_reg, capacity: pl.capacity, inspection_until: '2027-03-01' } }), 'car save');
  const k = ok(await req('/crm-api/cars/' + car.id), 'car get');
  assert.equal(k.first_reg, '2011-03-15'); assert.equal(k.inspection_until, '2027-03-01');
  console.log('✓ техпаспорт: код Aztec расшифрован (VIN, номер, двигатель, владелец, без PESEL); данные по номеру через RegCheck');

  log = ok(await req('/crm-api/sms?q=Przypominamy'), 'log search');
  assert.equal(log.rows.length, 1); assert.equal(log.rows[0].kind, 'reminder');
  console.log('\nВСЕ ПРОВЕРКИ ШАБЛОНОВ, SMS И ДАННЫХ АВТО ПРОЙДЕНЫ');
} catch (e) {
  console.error('✗', e.message);
  console.error(out.slice(-2000));
  process.exitCode = 1;
} finally {
  srv.kill();
  mock.close();
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
}
