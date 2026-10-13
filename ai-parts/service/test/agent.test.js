// Тесты без внешних сервисов: Claude, NHTSA и Inter Cars подменены.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.MASTER_KEY = crypto.randomBytes(32).toString('base64');
process.env.CRM_SHARED_SECRET = crypto.randomBytes(32).toString('hex');
process.env.DB_PATH = ':memory:';
process.env.PL24_WAIT_SECONDS = '6';

const { openMemoryDb, ensureWorkshop } = await import('../src/db.js');
const { signToken, verifyToken, encryptSecret, decryptSecret } = await import('../src/crypto.js');
const { validateVin, modelYearFromVin, decodeVin } = await import('../src/providers/vin.js');
const ic = await import('../src/providers/intercars.js');
const { saveIntegration, getIntegration, listIntegrationsPublic } = await import('../src/integrations.js');
const { setClientFactory } = await import('../src/agent/llm.js');
const { runAgent } = await import('../src/agent/runAgent.js');
const { importHistory, searchHistory } = await import('../src/providers/history.js');
const { createApp } = await import('../src/server.js');

openMemoryDb();
const WS = 'pulsecar';
ensureWorkshop(WS, 'Pulsecar');

test('VIN: контрольная цифра и год', () => {
  const v = validateVin('WBS43AY07PFP64494');
  assert.equal(v.ok, true);
  assert.equal(v.checkDigitValid, true);
  assert.equal(modelYearFromVin('WBS43AY07PFP64494'), 2023);
  assert.equal(validateVin('ABC').ok, false);
});

test('шифрование ключей и токены CRM', () => {
  const enc = encryptSecret('sk-test-1234');
  assert.notEqual(enc, 'sk-test-1234');
  assert.equal(decryptSecret(enc), 'sk-test-1234');
  const t = signToken({ ws: WS, uid: 'u1', role: 'manager', exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal(verifyToken(t).ws, WS);
  assert.equal(verifyToken(t + 'x'), null);
  const expired = signToken({ ws: WS, role: 'manager', exp: 1 });
  assert.equal(verifyToken(expired), null);
});

test('интеграции: секреты маской', () => {
  saveIntegration(WS, 'anthropic', { enabled: true, fields: { api_key: 'sk-ant-secret-ABCD' } });
  const pub = listIntegrationsPublic(WS).find((x) => x.service === 'anthropic');
  assert.equal(pub.fields.find((f) => f.key === 'api_key').value, '••••ABCD');
  assert.equal(getIntegration(WS, 'anthropic').values.api_key, 'sk-ant-secret-ABCD');
  // пустая строка не стирает секрет
  saveIntegration(WS, 'anthropic', { fields: { api_key: '' } });
  assert.equal(getIntegration(WS, 'anthropic').values.api_key, 'sk-ant-secret-ABCD');
});

test('каталог Inter Cars: импорт CSV и поиск по номеру', () => {
  const csv = [
    'TOW_KOD;IC_INDEX;TEC_DOC;TEC_DOC_PROD;ARTICLE_NUMBER;MANUFACTURER;SHORT_DESCRIPTION;DESCRIPTION;BARCODES;PACKAGE_WEIGHT;PACKAGE_LENGTH;PACKAGE_WIDTH;PACKAGE_HEIGHT;CUSTOM_CODE;BLOCKED_RETURN',
    'SKU1;JUR573000;573000J;12;573000J;JURID;"Klocki hamulcowe przód";"Klocki; komplet";;1;1;1;1;1;false',
    'SKU2;BMW34108093705;;;34108093705;BMW;Klocki przód OE;;;1;1;1;1;1;false',
  ];
  assert.equal(ic.importProductInformation(WS, csv), 2);
  const m = ic.findInCatalog(WS, [{ number: '34 10 8 093 705' }]);
  assert.equal(m[0].sku, 'SKU2');
  assert.equal(ic.parseCsvLine('a;"b;c";"d""e"')[1], 'b;c');
});

test('история: поиск по VIN и предупреждения о возвратах', () => {
  importHistory(WS, [
    { source_id: 'h1', vin: 'WBS43AY07PFP64494', make: 'BMW', model: 'M3', part_name: 'Колодки тормозные передние', oe_number: '34108093705', verified: 1 },
    { source_id: 'h2', vin: 'WBS43AY07PFP64494', make: 'BMW', model: 'M3', part_name: 'Колодки тормозные передние', oe_number: '34107884975', returned: 1 },
  ]);
  const r = searchHistory(WS, { vin: 'WBS43AY07PFP64494', part_query: 'колодки' });
  assert.equal(r.sameVin.length, 2);
  assert.equal(r.sameVin[0].verified, 1);
});

// --- Агент со сценарием: decode_vin → ask_manager → (ответ) → intercars_offers → submit_result
function scriptedClient(script) {
  let i = 0;
  return {
    messages: {
      create: async (req) => {
        assert.ok(req.tools.find((t) => t.name === 'submit_result'));
        const step = script[i++];
        if (!step) throw new Error('сценарий закончился');
        return { stop_reason: step.stop || 'tool_use', content: step.content, usage: { input_tokens: 10, output_tokens: 5 } };
      },
    },
  };
}

test('по умолчанию ассистент не задаёт вопросов: ask_manager не передаётся модели', async () => {
  let seen = null;
  setClientFactory(() => ({ messages: { create: async (req) => { seen = req.tools.map((t) => t.name); return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'z', name: 'submit_result', input: { vehicle: { summary: 'x' }, items: [{ group: 'Тормоза', name: 'Колодки', quantity: 1, unit: 'компл', status: 'check', confidence: 'medium', orderBoth: true, variants: [{ condition: 'синие суппорты', oeNumber: 'A' }, { condition: 'красные', oeNumber: 'B' }], evidence: [], offers: { middle: { brand: 'X', articleNumber: '1', purchaseNet: 10 } } }] } }], usage: {} }; } } }));
  const out = await runAgent({ workshopId: WS, jobId: 'j0', input: { vehicle: { vin: 'WBS43AY07PFP64494' }, text: 'колодки' } });
  assert.ok(!seen.includes('ask_manager'));
  assert.equal(out.result.items[0].orderable, true);
});

test('агент: полный цикл с вопросом менеджеру и ценами', async () => {
  const { saveRules, getRules } = await import('../src/rules.js');
  saveRules(WS, { ...getRules(WS), askManager: true, unresolvedVariantPolicy: 'ask' });
  saveIntegration(WS, 'intercars', { enabled: true, fields: { static_token: 'tok', api_base: 'https://ic.test' } });
  saveIntegration(WS, 'web_research', { enabled: false });
  const fakeFetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('vpic.nhtsa')) return new Response(JSON.stringify({ Results: [{ Make: 'BMW', Model: 'M3', ModelYear: '2023', ErrorCode: '0' }] }));
    if (u.includes('/ic/pricing/quote')) {
      const body = JSON.parse(opts.body);
      return new Response(JSON.stringify({ lines: body.lines.map((l) => ({ sku: l.sku, price: { currencyCode: 'PLN', customerPriceNet: l.sku === 'SKU1' ? 300 : 900 } })) }));
    }
    if (u.includes('/ic/inventory/stock')) return new Response(JSON.stringify([{ sku: 'SKU1', location: 'WAW', availability: 4 }]));
    return new Response('nf', { status: 404 });
  };
  const script = [
    { content: [{ type: 'tool_use', id: 't1', name: 'decode_vin', input: { vin: 'WBS43AY07PFP64494' } }] },
    { content: [{ type: 'tool_use', id: 't2', name: 'ask_manager', input: { question: 'Цвет суппортов?', why: 'Три тормозные системы', options: ['синий', 'красный', 'золотой'] } }] },
    { content: [{ type: 'tool_use', id: 't3', name: 'intercars_offers', input: { numbers: [{ number: '34108093705' }, { number: '573000J', brand: 'Jurid' }] } }] },
    {
      content: [
        {
          type: 'tool_use',
          id: 't4',
          name: 'submit_result',
          input: {
            vehicle: { summary: 'BMW M3 G80 2023' },
            items: [
              {
                group: 'Тормоза', name: 'Колодки тормозные передние', quantity: 1, unit: 'компл', oeNumber: '34108093705',
                status: 'confirmed', confidence: 'high',
                evidence: [{ type: 'history', detail: 'verified' }, { type: 'seller', detail: 'Pelican' }],
                offers: { middle: { sku: 'SKU1', brand: 'JURID', articleNumber: '573000J', purchaseNet: 300, supplier: 'intercars' }, oe: { sku: 'SKU2', brand: 'BMW', articleNumber: '34108093705', purchaseNet: 900, supplier: 'intercars' } },
              },
            ],
          },
        },
      ],
    },
  ];
  const client = scriptedClient(script);
  setClientFactory(() => client);
  const steps = [];
  const input = { wycenaId: 'W1', vehicle: { vin: 'WBS43AY07PFP64494' }, text: 'колодки передние', level: 'middle' };
  const first = await runAgent({ workshopId: WS, jobId: 'j1', input, step: (s) => steps.push(s), fetchImpl: fakeFetch });
  assert.equal(first.status, 'needs_input');
  assert.equal(first.question.question, 'Цвет суппортов?');
  const second = await runAgent({ workshopId: WS, jobId: 'j1', input, messages: first.messages, pending: first.pending, answer: 'синий', step: (s) => steps.push(s), fetchImpl: fakeFetch });
  assert.equal(second.status, 'done');
  const item = second.result.items[0];
  assert.equal(item.chosenLevel, 'middle');
  assert.equal(item.offers.middle.client.net, 390); // 300 + 30%
  assert.equal(item.orderable, true);
  assert.equal(second.result.totals.clientNet, 390);
  // ответ менеджера дошёл до агента как tool_result
  const answerMsg = second.messages.find((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_result' && String(c.content).includes('синий')));
  assert.ok(answerMsg);
  // intercars_offers вернул цены
  const offersMsg = second.messages.find((m) => Array.isArray(m.content) && m.content.some((c) => c.tool_use_id === 't3'));
  assert.match(offersMsg.content[0].content, /"purchaseNet":300/);
});

test('HTTP: токен, создание задачи без VIN — 400, интеграции только админу', async () => {
  const app = createApp();
  const srv = app.listen(0);
  const port = srv.address().port;
  const mgr = signToken({ ws: WS, uid: 'u1', role: 'manager', exp: Math.floor(Date.now() / 1000) + 600 });
  const adm = signToken({ ws: WS, uid: 'a1', role: 'admin', exp: Math.floor(Date.now() / 1000) + 600 });
  try {
    let r = await fetch(`http://127.0.0.1:${port}/api/jobs`, { method: 'POST', headers: { Authorization: 'Bearer ' + mgr, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x', vehicle: {} }) });
    assert.equal(r.status, 400);
    r = await fetch(`http://127.0.0.1:${port}/api/integrations`, { headers: { Authorization: 'Bearer ' + mgr } });
    assert.equal(r.status, 403);
    r = await fetch(`http://127.0.0.1:${port}/api/integrations`, { headers: { Authorization: 'Bearer ' + adm } });
    assert.equal(r.status, 200);
    const list = await r.json();
    assert.ok(list.find((x) => x.service === 'intercars'));
    // ключ расширения и пустая очередь задач
    r = await fetch(`http://127.0.0.1:${port}/api/extension-keys`, { method: 'POST', headers: { Authorization: 'Bearer ' + adm, 'Content-Type': 'application/json' }, body: '{}' });
    const { key } = await r.json();
    r = await fetch(`http://127.0.0.1:${port}/ext/v1/tasks/next`, { method: 'POST', headers: { 'X-Extension-Key': key } });
    assert.equal(r.status, 204);
    r = await fetch(`http://127.0.0.1:${port}/ext/v1/tasks/next`, { method: 'POST', headers: { 'X-Extension-Key': 'bad' } });
    assert.equal(r.status, 401);
  } finally {
    srv.close();
  }
});

test('partslink24: задача → расширение → навигатор → строки', async () => {
  const pl24 = await import('../src/providers/partslink24.js');
  const { hashKey, newExtensionKey } = await import('../src/crypto.js');
  const { getDb } = await import('../src/db.js');
  const key = newExtensionKey();
  getDb().prepare('INSERT INTO extension_keys (id, workshop_id, key_hash, label) VALUES (?,?,?,?)').run('ek_t', WS, hashKey(key), 't');
  const answers = [
    '{"action":"type","id":"e1","text":"WBS43AY07PFP64494","submit":true,"why":"VIN"}',
    '{"action":"extract","rows":[{"part":"колодки передние","oe":"34 10 8 093 705","qty":"1"}],"vehicle":{"model":"M3 G80","options":["S2NKA нет"]}}',
    '{"action":"done","why":"всё найдено"}',
  ];
  let k = 0;
  setClientFactory(() => ({ messages: { create: async () => ({ content: [{ type: 'text', text: answers[k++] }], usage: {} }) } }));
  const id = pl24.createTask(WS, 'j2', { vin: 'WBS43AY07PFP64494', make: 'BMW', parts: [{ name: 'колодки передние' }] });
  const app = createApp();
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const h = { 'X-Extension-Key': key, 'Content-Type': 'application/json' };
  try {
    const t = await (await fetch(`${base}/ext/v1/tasks/next`, { method: 'POST', headers: h })).json();
    assert.equal(t.id, id);
    const snap = { snapshot: { url: 'https://www.partslink24.com/', title: 'pl24', text: '[e1] input "VIN"' } };
    let a = await (await fetch(`${base}/ext/v1/tasks/${id}/step`, { method: 'POST', headers: h, body: JSON.stringify(snap) })).json();
    assert.equal(a.action, 'type');
    a = await (await fetch(`${base}/ext/v1/tasks/${id}/step`, { method: 'POST', headers: h, body: JSON.stringify(snap) })).json();
    assert.equal(a.action, 'continue');
    a = await (await fetch(`${base}/ext/v1/tasks/${id}/step`, { method: 'POST', headers: h, body: JSON.stringify(snap) })).json();
    assert.equal(a.action, 'done');
    const r = await pl24.waitForTask(id, 5);
    assert.equal(r.status, 'done');
    assert.equal(r.result.rows[0].oe, '34 10 8 093 705');
  } finally {
    srv.close();
  }
});

test('Inter Cars: токен со scope=allinone и поиск по индексу через API, если номера нет в CSV', async () => {
  const calls = [];
  const fakeFetch = async (url, opt = {}) => {
    calls.push({ url: String(url), body: opt.body ? String(opt.body) : '' });
    const j = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
    if (String(url).includes('oauth2/token')) return j({ access_token: 'T', expires_in: 3600 });
    if (String(url).includes('/ic/catalog/products?index=')) return j({ products: [{ sku: 'API1', index: 'TRW DF6319', brand: 'TRW', articleNumber: 'DF6319', shortDescription: 'Tarcza' }] });
    if (String(url).includes('/ic/pricing/quote')) return j({ lines: [{ sku: 'API1', price: { customerPriceNet: 99.5, currencyCode: 'PLN' } }] });
    if (String(url).includes('/ic/inventory/stock')) return j([]);
    return j({});
  };
  const cfg = { api_base: 'https://api.example', token_url: 'https://is.example/oauth2/token', client_id: 'id', client_secret: 's' };
  const r = await ic.offersForNumbers('ws-api', cfg, [{ number: 'DF6319', brand: 'TRW' }], fakeFetch);
  assert.ok(calls.find((c) => c.url.includes('oauth2/token')).body.includes('scope=allinone'));
  assert.equal(r.matches[0].sku, 'API1'); assert.equal(r.matches[0].purchaseNet, 99.5);
});

test('цена клиенту: рекомендуемая цена Inter Cars, но не ниже закупки + минимальная маржа', async () => {
  const { clientPrice, DEFAULT_RULES } = await import('../src/rules.js');
  const r = structuredClone(DEFAULT_RULES);
  assert.deepEqual([clientPrice(r, 100, 'middle', null, 180).net, clientPrice(r, 100, 'middle', null, 180).source], [180, 'ic_list']);
  assert.equal(clientPrice(r, 100, 'middle', null, 110).net, 130); // рекомендуемая ниже минимума — минимум 30 %
  assert.equal(clientPrice(r, 100, 'middle', null, null).net, 130); // без цены IC — наценка уровня
  assert.equal(clientPrice({ ...r, priceMode: 'markup' }, 100, 'oe', null, 500).net, 120);
});

test('partslink24 напрямую: фразы под язык каталога → строки расширения → задача done', async () => {
  const pl24 = await import('../src/providers/partslink24.js');
  const { hashKey, newExtensionKey } = await import('../src/crypto.js');
  const { getDb } = await import('../src/db.js');
  const key = newExtensionKey();
  getDb().prepare('INSERT INTO extension_keys (id, workshop_id, key_hash, label) VALUES (?,?,?,?)').run('ek_d', WS, hashKey(key), 'd');
  let sys = '';
  setClientFactory(() => ({ messages: { create: async (p) => { sys = p.system; return { content: [{ type: 'tool_use', name: 'pl24_terms', input: { terms: [{ key: 'диск задний', q: 'disc rear', alt: ['tarcza hamulcowa tylna'] }] } }], usage: {} }; } } }));
  const id = pl24.createTask(WS, 'j3', { vin: 'JTDKB20U703123456', make: 'Toyota', parts: [{ name: 'диск задний' }] });
  const app = createApp();
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const h = { 'X-Extension-Key': key, 'Content-Type': 'application/json' };
  try {
    assert.equal((await (await fetch(`${base}/ext/v1/tasks/next`, { method: 'POST', headers: h })).json()).id, id);
    const tm = await (await fetch(`${base}/ext/v1/tasks/${id}/terms`, { method: 'POST', headers: h, body: '{}' })).json();
    assert.equal(tm.terms[0].q, 'disc rear'); assert.match(sys, /ENGLISH/);
    const body = { ok: true, service: 'toyota', results: [{ key: 'диск задний', q: 'disc rear', rows: [{ number: '42431-0F020', name: 'DISC, REAR', best: true, qty: '2' }], bom: [{ number: '90105-10446', name: 'BOLT', pos: '3', qty: '4' }] }] };
    const rr = await (await fetch(`${base}/ext/v1/tasks/${id}/result`, { method: 'POST', headers: h, body: JSON.stringify(body) })).json();
    assert.equal(rr.rows, 2);
    const r = await pl24.waitForTask(id, 5);
    assert.equal(r.status, 'done'); assert.equal(r.result.rows[0].oe, '42431-0F020'); assert.equal(r.result.rows[0].best, true); assert.equal(r.result.rows[1].bom, true);
    // вход не выполнен → задача failed с подсказкой
    const id2 = pl24.createTask(WS, 'j4', { vin: 'JTDKB20U703123456', make: 'Toyota', parts: [{ name: 'x' }] });
    await fetch(`${base}/ext/v1/tasks/next`, { method: 'POST', headers: h });
    await fetch(`${base}/ext/v1/tasks/${id2}/result`, { method: 'POST', headers: h, body: JSON.stringify({ ok: false, stop: 'login' }) });
    const r2 = await pl24.waitForTask(id2, 5);
    assert.equal(r2.status, 'failed'); assert.match(r2.result.hint, /не вошёл/);
  } finally {
    srv.close();
  }
});

test('цены: заглушка 0,01 zł и ошибочная цена Inter Cars — не цена, позиция «проверьте», не заказывается', async () => {
  const { postProcess, priceIssue } = await import('../src/agent/runAgent.js');
  const { getRules } = await import('../src/rules.js');
  assert.match(priceIssue({ purchaseNet: 0.01 }), /не получена/);
  assert.match(priceIssue({ purchaseNet: 43599.96 }), /ошибочной/);
  assert.match(priceIssue({ purchaseNet: 900, listNet: 120 }), /ошибочной/);
  assert.equal(priceIssue({ purchaseNet: 180, listNet: 260 }), null);
  const r = postProcess({ items: [
    { group: 'engine', name: 'Цепь ГРМ', quantity: 1, unit: 'шт', status: 'confirmed', offers: { oe: { brand: 'OE JAGUAR', articleNumber: 'JDE38677', purchaseNet: 0.01, supplier: 'intercars' } } },
    { group: 'engine', name: 'Натяжитель', quantity: 1, unit: 'шт', status: 'confirmed', offers: { oe: { brand: 'OE JAGUAR', articleNumber: 'JDE38696', purchaseNet: 43599.96, supplier: 'intercars' } } },
    { group: 'engine', name: 'Прокладка', quantity: 1, unit: 'шт', status: 'confirmed', offers: { middle: { brand: 'Elring', articleNumber: '123', purchaseNet: 40, supplier: 'intercars' } } },
  ] }, getRules(WS), 'middle');
  const [a, b, c] = r.items;
  assert.equal(a.status, 'check'); assert.equal(a.orderable, false); assert.equal(a.offers.oe.purchaseNet, null); assert.equal(a.offers.oe.client, null);
  assert.match(a.checkReason, /Цена не получена/);
  assert.equal(b.status, 'check'); assert.match(b.checkReason, /ошибочной/);
  assert.equal(c.status, 'confirmed'); assert.ok(c.offers.middle.client.net > 40);
  assert.equal(r.totals.purchaseNet, 40);
});

test('«Осталось уточнить» → дополнительный подбор: то же авто, уже подобранное не повторять', async () => {
  const { followupInput } = await import('../src/jobs.js');
  const prev = { id: 'job_1', input: { wycenaId: '2057', vehicle: { vin: 'SALVA2BX3JH295566' }, text: 'Wymiana rozrządu', level: 'oe' },
    result: { vehicle: { summary: 'Evoque 2.0 Ingenium' }, questions: ['Нужна ли замена масла и фильтра?'],
      items: [{ name: 'Цепь ГРМ', quantity: 1, unit: 'шт', oeNumber: 'LR091742', chosenLevel: 'oe', offers: { oe: { brand: 'OE JAGUAR', articleNumber: 'JDE38677' } } }] } };
  const inp = followupInput(prev, 'Нужна ли замена масла и фильтра? — ДА, добавить');
  assert.equal(inp.vehicle.vin, 'SALVA2BX3JH295566'); assert.equal(inp.level, 'oe'); assert.equal(inp.followupOf, 'job_1');
  assert.match(inp.text, /НЕ повторять[\s\S]*Цепь ГРМ/); assert.match(inp.text, /ДА, добавить/); assert.match(inp.note, /Evoque/);
  assert.deepEqual(inp.existingItems.map((x) => x.name), ['Цепь ГРМ']);
});
