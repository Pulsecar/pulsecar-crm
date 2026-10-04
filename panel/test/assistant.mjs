// Тест AI-ассистента сайта с имитацией Claude API. Запуск: node test/assistant.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const PORT = 3187, MOCK = 3186;
const BASE = `http://localhost:${PORT}`;
const DB = './data/test-assistant.db';
for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });

// ── имитация Claude: «book» → окна → запись на первое окно; «human» → перезвон ──
const seen = [];
const mock = createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.headers['x-api-key'] === 'sk-usr' && req.headers['anthropic-workspace-id'] !== 'wrkspc_1') return json(400, { error: { message: 'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header' } });
  if (!['sk-test', 'sk-usr'].includes(req.headers['x-api-key'])) return json(401, { error: { message: 'invalid x-api-key' } });
  const b = JSON.parse(body);
  seen.push(b);
  if (b.max_tokens === 5) return json(200, { content: [{ type: 'text', text: 'pong' }], stop_reason: 'end_turn' });
  const last = b.messages.at(-1);
  const text = (t) => json(200, { content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });
  const tool = (name, input) => json(200, { content: [{ type: 'tool_use', id: 'tu_' + Math.random().toString(36).slice(2), name, input }], stop_reason: 'tool_use' });
  if (Array.isArray(last.content) && last.content[0].type === 'tool_result') {
    const r = JSON.parse(last.content[0].content);
    if (r.days) {
      const user = [...b.messages].reverse().find((m) => typeof m.content === 'string').content;
      if (/bookvin/.test(user)) return tool('create_booking', { name: 'Jan Test', phone: '+48 600-100-200', car: 'VW', vin: 'WVWZZZ1KZAW000001', problem: 'olej', quoted_price: '50–150 zł', slot: `${r.days[0].date} ${r.days[0].times[1]}`, consent: true });
      if (/book/.test(user)) return tool('create_booking', { name: 'Jan Test', phone: '600 100 200', car: 'Skoda Octavia 2016', plate: 'WX 12345', problem: 'stuk z przodu', quoted_price: 'od 10 zł', slot: `${r.days[0].date} ${r.days[0].times[0]}`, consent: true });
      return text('SLOTS ' + JSON.stringify(r.days));
    }
    return text('RESULT ' + last.content[0].content);
  }
  if (/price\+slots/.test(last.content)) return json(200, { content: [{ type: 'text', text: 'Diagnostyka od 100 zł.' }, { type: 'tool_use', id: 'tu_ps', name: 'get_available_slots', input: { days: 2 } }], stop_reason: 'tool_use' });
  if (/book|slots/.test(last.content)) return tool('get_available_slots', { days: 7 });
  if (/human/.test(last.content)) return tool('request_human', { name: 'Ola', phone: '+48 500 200 300', topic: 'laweta' });
  if (/noplate/.test(last.content)) return tool('create_booking', { name: 'B', phone: '600100201', car: 'Opel', problem: 'check', quoted_price: '50–150 zł', slot: '2099-01-01 10:00', consent: true });
  if (/noconsent/.test(last.content)) return tool('create_booking', { name: 'A', phone: '600100200', car: 'x', plate: 'WA1', problem: 'y', quoted_price: '50–150 zł', slot: '2099-01-01 10:00', consent: false });
  return text('Dzień dobry!');
});
await new Promise((r) => mock.listen(MOCK, r));

const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, NODE_ENV: 'test', PORT, DB_PATH: DB, ADMIN_PASSWORD: 'test-pass-123', SESSION_SECRET: 'x'.repeat(40), PUBLIC_URL: 'http://localhost', ANTHROPIC_BASE_URL: `http://localhost:${MOCK}` },
});
srv.stderr.on('data', (d) => process.stderr.write(d));
for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/health'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

let cookie = '';
async function req(path, { body, method, headers = {} } = {}) {
  const r = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, j: ct.includes('json') ? await r.json() : await r.text() };
}
const chat = (message, sessionId, origin = 'https://pulsecar.pl') => fetch(BASE + '/chat-api/message', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ message, sessionId, lang: 'ru', page: '/ru' }) });

try {
  // выключено → виджет не показывается
  let cfgR = await (await fetch(BASE + '/chat-api/config')).json();
  assert.equal(cfgR.enabled, false);
  assert.equal((await chat('hi')).status, 503);
  const w = await fetch(BASE + '/chat/widget.js');
  assert.equal(w.status, 200); assert.match(w.headers.get('content-type'), /javascript/); assert.match(await w.text(), /chat-api\/message/);
  assert.equal((await fetch(BASE + '/chat/logo.png')).status, 200);

  assert.ok((await req('/crm-api/login', { body: { login: 'admin', password: 'test-pass-123' } })).status < 300);
  // проверка связи без ключа и с ключом
  assert.equal((await req('/crm-api/integrations/assistant', { method: 'PUT', body: { enabled: true, values: { apiKey: 'bad' } } })).status, 200);
  assert.equal((await req('/crm-api/integrations/assistant/test', { body: {} })).status, 400);
  // пользовательский ключ без рабочего пространства → понятная ошибка; с ID пространства → работает
  await req('/crm-api/integrations/assistant', { method: 'PUT', body: { enabled: true, values: { apiKey: 'sk-usr' } } });
  const wsErr = await req('/crm-api/integrations/assistant/test', { body: {} });
  assert.equal(wsErr.status, 400); assert.match(wsErr.j.error, /рабочему пространству/);
  await req('/crm-api/integrations/assistant', { method: 'PUT', body: { enabled: true, values: { workspaceId: 'wrkspc_1' } } });
  assert.equal((await req('/crm-api/integrations/assistant/test', { body: {} })).status, 200);
  await req('/crm-api/integrations/assistant', { method: 'PUT', body: { enabled: true, values: { workspaceId: '' } } });
  assert.equal((await req('/crm-api/integrations/assistant', { method: 'PUT', body: { enabled: true, values: { apiKey: 'sk-test', capacity: 1, minHoursAhead: 0, daysAhead: 14 } } })).status, 200);
  const t = await req('/crm-api/integrations/assistant/test', { body: {} });
  assert.equal(t.status, 200, JSON.stringify(t.j)); assert.match(t.j.info, /Claude отвечает/);
  const list = (await req('/crm-api/integrations')).j;
  const it = (list.items || list.integrations || list.list || Object.values(list).find(Array.isArray)).find((x) => x.key === 'assistant');
  assert.ok(it.values.apiKey.startsWith('••••'), 'ключ скрыт');
  console.log('✓ настройки и проверка связи');

  cfgR = await (await fetch(BASE + '/chat-api/config', { headers: { Origin: 'https://pulsecar.pl' } })).json();
  assert.equal(cfgR.enabled, true);

  // CORS
  let r = await chat('hello');
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://pulsecar.pl');
  let j = await r.json();
  assert.equal(j.reply, 'Dzień dobry!');
  const sid = j.sessionId;
  r = await chat('hello', undefined, 'https://evil.example');
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  const sys = seen.at(-1).system[0].text;
  assert.doesNotMatch(sys, /Diagnostyka komputerowa: od/, 'цена диагностики только из настроек чата');
  assert.match(sys, /Diagnostics \(any kind[^\n]*50–150 zł/);
  assert.match(sys, /: od \d+ zł/, 'прайс ремонта из CRM в инструкциях');
  assert.match(sys, /NEVER "ты"/);
  assert.match(sys, /Gwarancja: 6 miesięcy/);
  assert.equal(seen.at(-1).tools.length, 3);
  console.log('✓ чат, CORS, прайс из CRM');

  // окна → запись
  j = await (await chat('show slots', sid)).json();
  const days = JSON.parse(j.reply.replace('SLOTS ', ''));
  assert.ok(days.length > 0 && days[0].times.length > 0);
  for (const d of days) assert.notEqual(d.weekday, 'Sunday', 'в воскресенье закрыто');
  const first = `${days[0].date} ${days[0].times[0]}`;
  j = await (await chat('please book', sid)).json();
  assert.ok(j.booking?.ok, JSON.stringify(j));
  assert.equal(j.booking.slot, first);
  const appts = (await req(`/crm-api/appointments?from=${days[0].date}&to=${days[0].date}`)).j;
  const a = appts.unassigned.find((x) => x.id === j.booking.booking_id);
  assert.ok(a, 'заявка в «Не распределено»');
  assert.equal(a.status, 'request'); assert.equal(a.source, 'chat'); assert.equal(a.start_at, first);
  assert.equal(a.contact_phone, '+48600100200'); assert.match(a.note, /Nr: WX12345/); assert.match(a.note, /AI-czat \(RU\)/);
  assert.equal(a.duration_min, 30, 'диагностика 30 минут'); assert.match(a.title, /^Diagnostyka · stuk z przodu/);
  assert.match(a.note, /cena podana w czacie: od 30 zł/, 'цена не ниже минимальной');
  assert.equal(j.booking.sms_sent, false, 'без SMS-провайдера SMS только в журнале');
  const smsLog = JSON.stringify((await req('/crm-api/sms')).j);
  assert.match(smsLog, /podtverzhdaem vizit - diagnostika/, 'SMS-подтверждение на языке клиента в журнале SMS');
  const sysB = seen.find((x) => x.system)?.system[0].text;
  assert.match(sysB, /DIAGNOSTICS/); assert.match(sysB, /50–150 zł/); assert.match(sysB, /od 30 zł/);
  assert.ok(a.order_id, 'запись связана со злецением'); assert.ok(a.customer_id && a.car_id, 'запись связана с клиентом и авто');
  assert.match(j.booking.order_number, /^ZL /);
  const ord = (await req('/crm-api/orders/' + a.order_id)).j;
  const o = ord.order || ord;
  assert.equal(o.source, 'chat'); assert.match(o.complaint, /stuk z przodu/); assert.equal(o.customer_id, a.customer_id); assert.equal(o.car_id, a.car_id);
  const items = ord.items || o.items || [];
  assert.ok(items.some((i) => /^Diagnostyka/.test(i.name)), 'в злецении позиция «Diagnostyka»');
  const cust = (await req('/crm-api/customers/' + a.customer_id)).j;
  const cu = cust.customer || cust;
  assert.equal(cu.name, 'Jan Test'); assert.equal(cu.phone, '+48600100200');
  assert.ok(JSON.stringify(cust).includes('WX12345'), 'авто WX12345 в карточке клиента');
  console.log('✓ запись → клиент + авто + злецение', j.booking.order_number);
  const j2 = await (await chat('please bookvin', sid)).json();
  assert.ok(j2.booking?.ok, JSON.stringify(j2));
  const a2 = (await req(`/crm-api/appointments?from=${days[0].date}&to=${days[0].date}`)).j.unassigned.find((x) => x.id === j2.booking.booking_id);
  assert.equal(a2.customer_id, a.customer_id, 'тот же клиент по телефону — без дубля');
  assert.notEqual(a2.car_id, a.car_id, 'второе авто клиента по VIN');
  const cust2 = JSON.stringify((await req('/crm-api/customers/' + a.customer_id)).j);
  assert.ok(cust2.includes('WVWZZZ1KZAW000001') && cust2.includes('Volkswagen'), 'VIN расшифрован в марку');
  console.log('✓ повторный клиент без дубля, авто по VIN с маркой');
  console.log('✓ запись → Терминарз «Не распределено»', first);

  // ёмкость 1: окно занято → больше не предлагается; повторная запись на то же время — отказ
  j = await (await chat('show slots', sid)).json();
  const after = JSON.parse(j.reply.replace('SLOTS ', ''));
  assert.ok(!after.some((d) => d.date === days[0].date && d.times.includes(days[0].times[0])), 'занятое окно не предлагается');
  // запись на посту тоже занимает окно
  const second = `${after[0].date} ${after[0].times[0]}`;
  const stationId = (await req('/crm-api/integrations')).j.stations[0].id;
  const mk = await req('/crm-api/appointments', { body: { station_id: stationId, start_at: second, duration_min: 120, title: 'Klient z telefonu', status: 'planned' } });
  assert.ok(mk.status < 300, JSON.stringify(mk.j));
  j = await (await chat('show slots', sid)).json();
  const after2 = JSON.parse(j.reply.replace('SLOTS ', ''));
  const t2 = after2.find((d) => d.date === after[0].date)?.times || [];
  assert.ok(!t2.includes(after[0].times[0]), 'окно с записью на посту занято');
  console.log('✓ свободные окна учитывают Терминарз');

  // текст до вызова инструмента не теряется
  j = await (await chat('price+slots', sid)).json();
  assert.match(j.reply, /^Diagnostyka od 100 zł\.\n\nSLOTS /);
  console.log('✓ ответ из нескольких частей (цена + окна)');
  // без номера и VIN записи нет
  j = await (await chat('noplate', sid)).json();
  assert.match(j.reply, /plate_or_vin_required/);
  // согласие обязательно
  j = await (await chat('noconsent', sid)).json();
  assert.match(j.reply, /consent_required/);
  // перезвон
  j = await (await chat('human', sid)).json();
  assert.match(j.reply, /Staff notified/);
  const un = (await req(`/crm-api/appointments?from=${days[0].date}&to=${days[0].date}`)).j.unassigned;
  assert.ok(un.some((x) => x.title === 'Oddzwonić (AI-czat)' && x.contact_phone === '+48500200300'));
  console.log('✓ согласие и просьба перезвонить');

  // ошибка Claude → вежливый ответ, без падения
  await req('/crm-api/integrations/assistant', { method: 'PUT', body: { enabled: true, values: { apiKey: 'sk-wrong' } } });
  j = await (await chat('hello')).json();
  assert.match(j.reply, /\+48 571 058 591/);
  console.log('✓ сбой API → запасной ответ');
  console.log('\nAI-ассистент: все проверки пройдены');
} catch (e) {
  console.error('✗', e);
  process.exitCode = 1;
} finally {
  srv.kill(); mock.close();
  for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
}
