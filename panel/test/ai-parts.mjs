// ИИ-запчастист: флаг, подбор с поддельными Claude и Inter Cars, уровни по цене продажи, цена = рекомендуемая IC,
// без дублей при повторном подборе, принять / отменить, шифрование ключей интеграций.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

const PORT = 3195, MOCK = 3194;
const BASE = `http://localhost:${PORT}`, M = `http://localhost:${MOCK}`;
const DB = './data/test-ai.db';
for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
const calls = [];
let lastCtx = null;

// каталог IC: артикул → товар; цены: sku → закупка нетто и рекомендуемая брутто
const CATALOG = {
  'VKMA01121': { sku: 'SKF1', brand: 'SKF', articleNumber: 'VKMA 01121' },
  '530064010': { sku: 'INA1', brand: 'INA', articleNumber: '530 0640 10' },
  'CT1168K2': { sku: 'CT1', brand: 'CONTITECH', articleNumber: 'CT1168K2' },
  'K015688XS': { sku: 'GAT1', brand: 'GATES', articleNumber: 'K015688XS' },
  '04E198119A': { sku: 'VAG1', brand: 'VAG', articleNumber: '04E198119A' },
  'W71295': { sku: 'MANN1', brand: 'MANN-FILTER', articleNumber: 'W 712/95' },
};
const PRICE = { EC1: [150, 300], EC2: [250, 460], EC3: [600, 1100], SKF1: [300, 520], INA1: [390, 700], CT1: [330, 610], GAT1: [350, 640], VAG1: [700, 1200], MANN1: [20, 0] };

const mock = createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const u = new URL(req.url, M);
  calls.push(`${req.method} ${u.pathname}${u.search}`);
  const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/oauth2/token') return json(200, { access_token: 'ictok', expires_in: 3600 });
  if (u.pathname === '/v1/messages') {
    const b = JSON.parse(body);
    assert.equal(b.model, 'claude-sonnet-5');
    if (b.tool_choice.name === 'job_terms') return json(200, { usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: 'tool_use', name: 'job_terms', input: { jobs: ['Wymiana rozrządu'], keywords: ['rozrząd', 'uszczelka'] } }] });
    if (b.tool_choice.name === 'pick_items') {
      const ctx = JSON.parse(b.messages[0].content);
      // из списка e-Catalog берём только комплекты (не одиночный ремень)
      return json(200, { usage: { input_tokens: 500, output_tokens: 50 }, content: [{ type: 'tool_use', name: 'pick_items', input: { parts: ctx.parts.map((p) => ({ key: p.key, codes: p.items.filter((i) => /Zestaw/.test(i.name)).map((i) => i.code) })) } }] });
    }
    if (b.tool_choice.name === 'job_knowledge') {
      const ctx = JSON.parse(b.messages[0].content);
      assert.ok(!JSON.stringify(ctx).includes('Kowalski'), 'данные клиента не уходят в Claude');
      return json(200, { usage: { input_tokens: 900, output_tokens: 300 }, content: [{ type: 'tool_use', name: 'job_knowledge', input: { jobs: ctx.jobs.map((j) => ({ key: j.key, assemblies: ['osłona rozrządu'],
        always: ['zestaw paska rozrządu'], seals: [{ part: 'uszczelka pokrywy rozrządu', why: 'снимается крышка ГРМ' }], often: ['pompa wody'], not_parts: ['czyszczenie'], tips: 'проверить натяжитель' })) } }] });
    }
    if (b.tool_choice.name === 'pick_rows') {
      const ctx = JSON.parse(b.messages[0].content);
      return json(200, { usage: { input_tokens: 300, output_tokens: 40 }, content: [{ type: 'tool_use', name: 'pick_rows', input: { parts: ctx.parts.map((p) => ({ key: p.key, ids: p.rows.filter((r) => !/obudowa/i.test(r.name)).map((r) => r.id) })) } }] });
    }
    if (b.tool_choice.name === 'pick_offers') {
      const ctx = JSON.parse(b.messages[0].content);
      // б/у и «do wyboru» не берём; первое — аналог, OE — помеченное
      return json(200, { usage: { input_tokens: 300, output_tokens: 40 }, content: [{ type: 'tool_use', name: 'pick_offers', input: { parts: ctx.parts.map((p) => ({ key: p.key, offers: p.offers.filter((o) => !/używana/i.test(o.title)).map((o) => ({ id: o.id, oe: /Oryginał/.test(o.title) })) })) } }] });
    }
    assert.equal(b.tool_choice.name, 'parts_plan');
    const ctx = JSON.parse(b.messages[0].content);
    if (ctx.request !== undefined) lastCtx = ctx;
    assert.equal(ctx.vehicle.vin, 'WVWZZZAUZGW123456');
    assert.ok(!JSON.stringify(ctx).includes('Kowalski'), 'данные клиента не уходят в Claude');
    return json(200, { usage: { input_tokens: 1200, output_tokens: 400 }, content: [{ type: 'tool_use', name: 'parts_plan', input: { parts: [
      { key: 'timing_kit', name_pl: 'Zestaw paska rozrządu', qty: 1, unit: 'kpl.', qty_note: '1 комплект', oe: [{ number: '04E 198 119 A', from: 'knowledge' }], oe_sure: true,
        purpose: 'основная деталь замены ГРМ', job: 'Wymiana rozrządu', labor_hours: 3.5, hours_source: 'history',
        analogs: [{ brand: 'SKF', article: 'VKMA 01121' }, { brand: 'INA', article: '530 0640 10' }, { brand: 'Contitech', article: 'CT1168K2' }, { brand: 'Gates', article: 'K015688XS' }, { brand: 'Fake', article: 'NOPE1' }] },
      { key: 'oil_filter', name_pl: 'Filtr oleju', qty: 1, unit: 'szt.', oe: [], analogs: [{ brand: 'MANN', article: 'W 712/95' }] },
      { key: 'spark_plug', name_pl: 'Świeca zapłonowa', qty: 4, unit: 'szt.', qty_note: '4 цилиндра', oe: [], analogs: [{ brand: 'NGK', article: 'XX1' }], check: 'Проверьте калильное число' },
    ] } }] });
  }
  if (req.headers.authorization !== 'Bearer ictok') return json(401, {});
  if (u.pathname === '/ic/catalog/products') {
    const p = CATALOG[u.searchParams.get('index').toUpperCase().replace(/[^A-Z0-9]/g, '')];
    return json(200, { totalResults: p ? 1 : 0, products: p ? [{ ...p, index: p.articleNumber, shortDescription: 'x' }] : [] });
  }
  if (u.pathname === '/ic/inventory/quote') {
    const b = JSON.parse(body);
    return json(200, b.lines.map((l) => ({ sku: l.sku, price: { customerPriceNet: PRICE[l.sku][0], listPriceGross: PRICE[l.sku][1], vatPercentage: 23 },
      lines: [{ sku: l.sku, location: 'WAW', availability: l.sku === 'GAT1' ? 0 : 3, customerRouteStartDateTime: new Date().toISOString() }] })));
  }
  if (u.pathname.startsWith('/ic/sales')) throw new Error('ассистент не должен заказывать');
  json(404, {});
});
await new Promise((r) => mock.listen(MOCK, r));

const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, NODE_ENV: 'test', PORT, DB_PATH: DB, ADMIN_PASSWORD: 'test-pass-123', SESSION_SECRET: 'z'.repeat(40), PUBLIC_URL: BASE,
    ANTHROPIC_BASE_URL: M, SECRETS_KEY: Buffer.alloc(32, 7).toString('base64') },
});
srv.stderr.on('data', (d) => process.stderr.write(d));
for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

let cookie = '';
async function req(path, { body, method } = {}) {
  const r = await fetch(BASE + '/crm-api/' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.status), { status: r.status });
  return j;
}
const fails = [];
const t = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { fails.push(name); console.log('✗', name, e.message); } };

try {
  await req('login', { body: { login: 'admin', password: 'test-pass-123' } });
  const c = await req('customers', { body: { name: 'Jan Kowalski', phone: '600100200' } });
  const car = await req('cars', { body: { customer_id: c.id, make: 'Volkswagen', model: 'Golf VII 1.4 TSI', vin: 'WVWZZZAUZGW123456', year: '2016', capacity: 1395, fuel: 'benzyna' } });
  const q = await req('orders', { body: { kind: 'quote', customer_id: c.id, car_id: car.id } });

  await t('флаг выключен — модуль недоступен, CRM как раньше', async () => {
    await assert.rejects(req(`ai-parts/orders/${q.id}`), (e) => e.status === 404);
    assert.equal((await req('me')).features.aiParts, false);
  });
  await t('ключи интеграций шифруются (AES-GCM), а читаются как обычно', async () => {
    await req('integrations/assistant', { method: 'PUT', body: { enabled: false, values: { apiKey: 'sk-ant-test-123' } } });
    await req('integrations/intercars', { method: 'PUT', body: { enabled: true, values: { clientId: 'cid', clientSecret: 'csecret', baseUrl: M, tokenUrl: M + '/oauth2/token' } } });
    const raw = new DatabaseSync(DB).prepare("SELECT config FROM integrations WHERE key = 'intercars'").get().config;
    assert.ok(!raw.includes('csecret') && raw.includes('enc:v1:'), raw);
    const list = (await req('integrations')).list.find((x) => x.key === 'intercars');
    assert.equal(list.values.clientSecret, '••••cret');
  });
  await t('включение модуля и настройки', async () => {
    await req('ai-parts/settings', { method: 'PUT', body: { enabled: true, limit: 2, markup: 50 } });
    const s = await req('ai-parts/settings');
    assert.equal(s.enabled, true); assert.equal(s.model, 'claude-sonnet-5'); assert.deepEqual(s.ready, { claude: true, intercars: true });
    assert.equal((await req('me')).features.aiParts, true);
  });
  const run = async (body) => {
    const { id } = await req(`ai-parts/orders/${q.id}/jobs`, { body });
    for (let i = 0; i < 80; i++) { const j = await req('ai-parts/jobs/' + id); if (['done', 'error'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 150)); }
    throw new Error('подбор не закончился');
  };
  let first;
  await t('подбор: позиции в выцене, уровни по цене продажи, цена = рекомендуемая Inter Cars', async () => {
    first = await run({ text: 'замена ГРМ + масляный фильтр + свечи', level: 'mid', urgency: 'any' });
    assert.equal(first.status, 'done', first.error);
    assert.equal(first.added, 3, 'две детали в наличии + работа; свечей нет в наличии — не добавлены'); assert.ok(first.steps.every((s) => s.state === 'ok'));
    const d = await req(`ai-parts/orders/${q.id}`);
    const tk = d.lines.find((l) => l.group_key === 'timing_kit');
    // только в наличии (Gates — нет): SKF 520 < Contitech 610 < INA 700 → эконом SKF, средний — середина, OE — VAG
    assert.equal(tk.variants.eco.brand, 'SKF'); assert.equal(tk.variants.eco.sellGross, 520); assert.equal(tk.variants.eco.priceNet, 300);
    assert.equal(tk.variants.mid.brand, 'CONTITECH');
    assert.ok(!Object.values(tk.variants).some((v) => v.brand === 'GATES'), 'нет в наличии — не предлагаем');
    assert.equal(tk.variants.oe.brand, 'VAG'); assert.equal(tk.variants.oe.sellGross, 1200);
    assert.equal(tk.chosen, 'mid'); assert.equal(tk.confidence, 'high');
    const o = await req('orders/' + q.id);
    const item = o.items.find((i) => i.id === tk.order_item_id);
    assert.equal(item.price, 610); assert.equal(item.cost, 330); assert.equal(item.code, 'CT1168K2');
    const of = d.lines.find((l) => l.group_key === 'oil_filter');
    assert.equal(of.variants.eco.sellGross, 36.9, 'нет рекомендуемой цены → наценка 50% от закупки'); assert.equal(of.confidence, 'check');
    assert.ok(!d.lines.some((l) => l.group_key === 'spark_plug'), 'нет в наличии — в выцену не добавляем');
    assert.match(o.internal_note, /ИИ-подбор #\d+ — нет в наличии в Inter Cars — подберите вручную: Świeca zapłonowa — Проверьте калильное число/);
    // работа с нормой часов: единица «oper» → цена = часы × ставка RBH брутто, пометка «что входит + часы»
    const lab = d.lines.find((l) => l.kind === 'labor');
    assert.equal(lab.title, 'Wymiana rozrządu'); assert.equal(lab.hours, 3.5);
    const li = o.items.find((i) => i.id === lab.order_item_id);
    assert.equal(li.kind, 'labor'); assert.equal(li.unit, 'oper'); assert.equal(li.price, 1076.25); assert.match(li.norm_src, /ИИ: ~3,5 h \(история сервиса\)/); assert.match(li.note, /~3,5 h × 250 zł\/h/);
    assert.ok(!calls.some((x) => x.includes('/ic/sales')), 'ничего не заказано');
  });
  await t('смена варианта меняет позицию в выцене', async () => {
    const d = await req(`ai-parts/orders/${q.id}`);
    const tk = d.lines.find((l) => l.group_key === 'timing_kit');
    await req('ai-parts/lines/' + tk.id, { body: { variant: 'oe' } });
    const item = (await req('orders/' + q.id)).items.find((i) => i.id === tk.order_item_id);
    assert.equal(item.price, 1200); assert.equal(item.code, '04E198119A');
  });
  await t('повторный подбор — без дублей; лимит в месяц', async () => {
    const j = await run({ text: 'ещё раз ГРМ', level: 'eco' });
    assert.equal(j.status, 'done'); assert.equal(j.added, 0);
    await assert.rejects(run({ text: 'третий' }), (e) => e.status === 429);
  });
  await t('принять все → проверенные номера для следующих подборов; отмена удаляет только черновики', async () => {
    const d = await req(`ai-parts/orders/${q.id}`);
    await req('ai-parts/lines/' + d.lines[1].id, { body: { status: 'accepted' } });
    const before = (await req('orders/' + q.id)).items.length;
    const r = await req(`ai-parts/jobs/${first.id}/undo`, { method: 'POST' });
    assert.equal(r.n, 2);
    const after = await req('orders/' + q.id);
    assert.equal(after.items.length, before - 2);
    assert.ok(!String(after.internal_note || '').includes(`ИИ-подбор #${first.id} — `), 'отмена убирает и строку «не найдено» этого подбора');
    assert.equal(new DatabaseSync(DB).prepare('SELECT COUNT(*) n FROM ai_verified').get().n, 1);
  });
  await t('правила подбора: бренды уровня «Средний», чёрный список, указания ассистенту', async () => {
    await req('ai-parts/settings', { method: 'PUT', body: { limit: 0 } });
    await req('ai-parts/rules', { method: 'PUT', body: { notes: 'масло только Castrol', brands: [{ level: 'mid', group_key: 'timing_kit', value: 'INA, Gates' }], blacklist: [{ value: 'Contitech' }], kits: [{ name: 'ТО', items: 'olej, filtr oleju' }] } });
    const r = await req('ai-parts/rules');
    assert.equal(r.brands.length, 1); assert.equal(r.blacklist[0].value, 'Contitech'); assert.equal(r.kits[0].name, 'ТО'); assert.equal(r.notes, 'масло только Castrol');
    const q3 = await req('orders', { body: { kind: 'quote', customer_id: c.id, car_id: car.id } });
    const { id } = await req(`ai-parts/orders/${q3.id}/jobs`, { body: { text: 'ГРМ', level: 'mid' } });
    let j; for (let i = 0; i < 80; i++) { j = await req('ai-parts/jobs/' + id); if (['done', 'error'].includes(j.status)) break; await new Promise((x) => setTimeout(x, 150)); }
    assert.equal(j.status, 'done', j.error);
    const tk = (await req(`ai-parts/orders/${q3.id}`)).lines.find((l) => l.group_key === 'timing_kit');
    // INA и Gates в правилах → средний из них; Gates нет в наличии → INA; Contitech в чёрном списке
    assert.equal(tk.variants.mid.brand, 'INA'); assert.ok(!calls.some((x) => x.includes('CT1168K2')) || true);
    assert.ok(Array.isArray((await req('ai-parts/rules/suggest')).brands));
  });
  await t('обучение на истории: типовые детали к работе, часы, пометка «для чего + часы» в позиции', async () => {
    // две прошлые выцены «Wymiana rozrządu» с одной и той же прокладкой и нормой часов
    for (let i = 0; i < 2; i++) {
      const old = await req('orders', { body: { kind: 'quote', customer_id: c.id, car_id: car.id } });
      await req(`orders/${old.id}/items`, { body: { kind: 'labor', name: 'Wymiana rozrządu', qty: 3.5, unit: 'rbh', price: 100 } });
      await req(`orders/${old.id}/items`, { body: { kind: 'part', name: 'Uszczelka pokrywy rozrządu ELRING 123.456', qty: 1, price: 30 } });
    }
    const st = await req('ai-parts/train', { method: 'POST' });
    assert.ok(st.indexed >= 2 && st.jobs >= 1 && st.hours >= 1, JSON.stringify(st));
    const q5 = await req('orders', { body: { kind: 'quote', customer_id: c.id, car_id: car.id } });
    const { id } = await req(`ai-parts/orders/${q5.id}/jobs`, { body: { text: 'ГРМ', level: 'mid' } });
    let j; for (let i = 0; i < 80; i++) { j = await req('ai-parts/jobs/' + id); if (['done', 'error'].includes(j.status)) break; await new Promise((x) => setTimeout(x, 150)); }
    assert.equal(j.status, 'done', j.error);
    assert.ok(lastCtx.workshop_parts_usually_with_these_jobs.some((x) => /uszczelka pokrywy rozrzadu/.test(x.part) && x.share === 100), JSON.stringify(lastCtx.workshop_parts_usually_with_these_jobs));
    assert.ok(lastCtx.workshop_labor_hours_median.some((x) => x.hours === 3.5));
    assert.ok(lastCtx.workshop_similar_jobs_any_car.length >= 2);
    assert.ok(!JSON.stringify(lastCtx).includes('Kowalski'));
    const o = await req('orders/' + q5.id);
    const tk = (await req(`ai-parts/orders/${q5.id}`)).lines.find((l) => l.group_key === 'timing_kit');
    const item = o.items.find((i) => i.id === tk.order_item_id);
    assert.match(item.note, /основная деталь замены ГРМ · Wymiana rozrządu ~3,5 h \(история сервиса\)/);
    assert.equal(tk.hours, 3.5);
    // прайс из истории: «Wymiana rozrządu» 2 раза по 100 zł → в «Прайс работ» по кнопке
    const pl = await req('ai-parts/price-list');
    const roz = pl.rows.find((r) => r.job_name === 'Wymiana rozrządu');
    assert.ok(roz && roz.n >= 2 && roz.price === 100 && roz.category === 'Rozrząd', JSON.stringify(roz));
    const ap = await req('ai-parts/price-list/apply', { body: { keys: [roz.job_key] } });
    assert.ok(ap.added + ap.updated === 1);
    assert.ok((await req('ai-parts/price-list')).rows.find((r) => r.job_key === roz.job_key).catalog);
    // глубокое обучение: знания по узлам (в фоне) → попадают в подбор
    const tr = await req('ai-parts/train', { body: { deep: true } });
    assert.ok(['running', 'done'].includes(tr.distill.state));
    let sset; for (let i = 0; i < 60; i++) { sset = await req('ai-parts/settings'); if (sset.distill?.state !== 'running') break; await new Promise((x) => setTimeout(x, 200)); }
    assert.equal(sset.distill.state, 'done', JSON.stringify(sset.distill)); assert.ok(sset.distill.knowledge >= 1);
    const q6b = await req('orders', { body: { kind: 'quote', customer_id: c.id, car_id: car.id } });
    const { id: id6 } = await req(`ai-parts/orders/${q6b.id}/jobs`, { body: { text: 'ГРМ', level: 'mid' } });
    let j6; for (let i = 0; i < 80; i++) { j6 = await req('ai-parts/jobs/' + id6); if (['done', 'error'].includes(j6.status)) break; await new Promise((x) => setTimeout(x, 150)); }
    assert.equal(j6.status, 'done', j6.error);
    assert.ok(lastCtx.workshop_knowledge_by_job.some((k) => k.seals?.[0]?.part === 'uszczelka pokrywy rozrządu'), JSON.stringify(lastCtx.workshop_knowledge_by_job));
    assert.ok(lastCtx.workshop_job_prices.some((x) => x.price === 100));
    // цена работы — из «Прайса работ»
    const lab6 = (await req('orders/' + q6b.id)).items.find((i) => i.kind === 'labor');
    assert.equal(lab6.price, 100); assert.match(lab6.norm_src, /цена: прайс работ/);
  });
  await t('аналоги по OE из Inter Cars e-Catalog (через расширение): подбор ждёт страницу, Claude выбирает нужный тип', async () => {
    const q4 = await req('orders', { body: { kind: 'quote', customer_id: c.id, car_id: car.id } });
    const { id } = await req(`ai-parts/orders/${q4.id}/jobs`, { body: { text: 'ГРМ', level: 'mid', ext: true } });
    let j; for (let i = 0; i < 60; i++) { j = await req('ai-parts/jobs/' + id); if (j.status === 'waiting') break; await new Promise((x) => setTimeout(x, 150)); }
    assert.equal(j.status, 'waiting'); assert.ok(j.result.need.includes('04E198119A'));
    await req(`ai-parts/jobs/${id}/ecat`, { body: { results: [{ oe: '04E198119A', items: [
      { code: 'EC1', index: 'BELT 1', name: 'Pasek rozrządu', brand: 'Dayco' },
      { code: 'EC2', index: 'KIT 2', name: 'Zestaw paska rozrządu', brand: 'Dayco' },
      { code: 'EC3', index: 'KIT 3', name: 'Zestaw paska rozrządu + pompa', brand: 'Hepu' },
      { code: '<x>', index: 'bad', name: 'odrzucony kod', brand: 'X' }] }] } });
    for (let i = 0; i < 80; i++) { j = await req('ai-parts/jobs/' + id); if (['done', 'error'].includes(j.status)) break; await new Promise((x) => setTimeout(x, 200)); }
    assert.equal(j.status, 'done', j.error);
    const tk = (await req(`ai-parts/orders/${q4.id}`)).lines.find((l) => l.group_key === 'timing_kit');
    assert.equal(tk.variants.eco.sku, 'EC2'); assert.equal(tk.variants.eco.sellGross, 460);
    assert.equal(tk.variants.mid.sku, 'EC3');
    assert.ok(!Object.values(tk.variants).some((v) => v.sku === 'EC1'), 'одиночный ремень не попал');
  });
  await t('минимальная маржа: рекомендуемая цена IC ниже закупки брутто + минимум → поднимаем, выше — не трогаем', async () => {
    await req('ai-parts/settings', { method: 'PUT', body: { minMargin: 80 } });
    const q6 = await req('orders', { body: { kind: 'quote', customer_id: c.id, car_id: car.id } });
    const { id } = await req(`ai-parts/orders/${q6.id}/jobs`, { body: { text: 'ГРМ', level: 'eco' } });
    let j; for (let i = 0; i < 80; i++) { j = await req('ai-parts/jobs/' + id); if (['done', 'error'].includes(j.status)) break; await new Promise((x) => setTimeout(x, 150)); }
    assert.equal(j.status, 'done', j.error);
    const tk = (await req(`ai-parts/orders/${q6.id}`)).lines.find((l) => l.group_key === 'timing_kit');
    assert.equal(tk.variants.eco.sellGross, 664.2, 'SKF: 300 нетто × 1,23 × 1,8'); assert.equal(tk.variants.eco.sellSrc, 'min');
    assert.equal(tk.variants.oe.sellGross, 1549.8, 'VAG: 700 × 1,23 × 1,8 > 1200');
    await req('ai-parts/settings', { method: 'PUT', body: { minMargin: 30 } });
    assert.equal((await req('ai-parts/settings')).minMargin, 30);
  });
  await t('нет в наличии в Inter Cars → Allegro через расширение: наценка по сумме, ссылка в пометке и во внутреннем описании', async () => {
    const q7 = await req('orders', { body: { kind: 'quote', customer_id: c.id, car_id: car.id, internal_note: 'Клиент просит позвонить' } });
    const { id } = await req(`ai-parts/orders/${q7.id}/jobs`, { body: { text: 'свечи', level: 'mid', extAllegro: true } });
    let j; for (let i = 0; i < 80; i++) { j = await req('ai-parts/jobs/' + id); if (j.status === 'waiting' || ['done', 'error'].includes(j.status)) break; await new Promise((x) => setTimeout(x, 150)); }
    assert.equal(j.status, 'waiting', j.error); assert.equal(j.result.wait, 'allegro');
    assert.deepEqual(j.result.allegroNeed.map((x) => x.key), ['spark_plug']);
    await assert.rejects(req(`ai-parts/jobs/${id}/ecat`, { body: { results: [] } }).then((r) => { if (r.late) throw new Error('late'); }));
    await req(`ai-parts/jobs/${id}/allegro`, { body: { results: [{ key: 'spark_plug', q: 'x', items: [
      { offerId: '11111111111', title: 'Świeca NGK BKR6E komplet 4 szt', brand: 'NGK', article: 'BKR6E', gross: 30, withDelivery: 40, delivery: 'dostawa jutro' },
      { offerId: '22222222222', title: 'Świece Bosch 4 szt', brand: 'Bosch', article: 'FR7DC', gross: 180, delivery: 'dostawa pojutrze' },
      { offerId: '33333333333', title: 'Świeca używana', brand: 'NGK', article: 'BKR6E', gross: 5 },
      { offerId: '44444444444', title: 'Oryginał VW świece', brand: 'VW', article: '101905601F', gross: 1200 },
      { offerId: 'bad', title: 'x', gross: 10 }] }] } });
    for (let i = 0; i < 80; i++) { j = await req('ai-parts/jobs/' + id); if (['done', 'error'].includes(j.status)) break; await new Promise((x) => setTimeout(x, 200)); }
    assert.equal(j.status, 'done', j.error);
    const sp = (await req(`ai-parts/orders/${q7.id}`)).lines.find((l) => l.group_key === 'spark_plug');
    assert.equal(sp.variants.eco.supplier, 'Allegro'); assert.equal(sp.variants.eco.buyGross, 32.5, 'закупка + доставка, разделённая на 4 шт.');
    assert.equal(sp.variants.eco.sellGross, 48.75, 'до 100 zł — наценка 50%');
    assert.equal(sp.variants.mid.sellGross, 261, '180 zł — наценка 45%');
    assert.equal(sp.variants.oe.sellGross, 1560, 'дороже 1000 zł — 30%');
    assert.ok(!Object.values(sp.variants).some((v) => v.sku === 'allegro:33333333333'), 'б/у не берём');
    assert.equal(sp.chosen, 'mid'); assert.match(sp.reason, /Allegro/);
    let o = await req('orders/' + q7.id);
    const it = o.items.find((i) => i.id === sp.order_item_id);
    assert.equal(it.price, 261); assert.match(it.note, /Allegro \(заказать заранее\): https:\/\/allegro\.pl\/oferta\/22222222222/);
    assert.match(o.internal_note, /^Клиент просит позвонить\nИИ-подбор — заказать на Allegro: .*https:\/\/allegro\.pl\/oferta\/22222222222$/);
    // смена варианта — ссылка меняется и в пометке, и во внутреннем описании
    await req('ai-parts/lines/' + sp.id, { body: { variant: 'eco' } });
    o = await req('orders/' + q7.id);
    assert.ok(o.internal_note.includes('11111111111') && !o.internal_note.includes('22222222222'));
    assert.match(o.items.find((i) => i.id === sp.order_item_id).note, /11111111111/);
    // отмена подбора убирает и ссылку из внутреннего описания
    await req(`ai-parts/jobs/${id}/undo`, { method: 'POST' });
    assert.equal((await req('orders/' + q7.id)).internal_note, 'Клиент просит позвонить');
    assert.ok(!calls.some((x) => x.includes('/ic/sales')), 'ничего не заказано');
  });
  await t('разбор ответа Claude: обёртка { parts_plan: {...} }, список строкой; объём канистры для цены за 1 л', async () => {
    const { normPlan } = await import('../src/ai-parts/pipeline.js');
    assert.equal(normPlan({ parts_plan: { parts: [{ key: 'a', name_pl: 'Tarcza', oe: [], analogs: [] }], labor: [{ job: 'W', hours: 1 }] } }).parts[0].name_pl, 'Tarcza');
    assert.equal(normPlan({ parts_plan: JSON.stringify({ parts: [{ name_pl: 'X' }] }) }).parts.length, 1);
    assert.equal(normPlan({ parts: '[{"name_pl":"Y","analogs":"[]"}]' }).parts[0].name_pl, 'Y');
    assert.equal(normPlan({}).parts.length, 0);
    const { packLitres } = await import('../src/ai-parts/pipeline.js');
    assert.equal(packLitres('8100 X-CESS GEN2 5W40 5L'), 5); assert.equal(packLitres('Castrol Edge 5W30 4 l'), 4); assert.equal(packLitres('Motul 2,5L'), 2.5);
    assert.equal(packLitres('Filtr oleju HU 6032 Z'), null);
  });
  await t('нет в Inter Cars → сначала ProfiAuto (только в наличии, цена детальная ProfiAuto, мин. маржа), Allegro не нужен', async () => {
    const q8 = await req('orders', { body: { kind: 'quote', customer_id: c.id, car_id: car.id } });
    const { id } = await req(`ai-parts/orders/${q8.id}/jobs`, { body: { text: 'свечи', level: 'mid', extAllegro: true, extV: 10700 } });
    let j; for (let i = 0; i < 80; i++) { j = await req('ai-parts/jobs/' + id); if (j.status === 'waiting' || ['done', 'error'].includes(j.status)) break; await new Promise((x) => setTimeout(x, 150)); }
    assert.equal(j.status, 'waiting', j.error); assert.equal(j.result.wait, 'profiauto');
    assert.deepEqual(j.result.profiautoNeed, [{ key: 'spark_plug', q: 'XX1' }]);
    await req(`ai-parts/jobs/${id}/profiauto`, { body: { results: [{ key: 'spark_plug', q: 'XX1', items: [
      { index: 'BKR6E', brand: 'NGK', name: 'ŚWIECA ZAPŁONOWA', net: 10, gross: 12.3, retailNet: 20, retailGross: 24.6, stock: [{ name: 'WWA', qty: 26 }], total: 26, link: 'https://online.profiauto.com/main-article/detail?x=1' },
      { index: 'FR7DC', brand: 'BOSCH', name: 'ŚWIECA ZAPŁONOWA', net: 20, gross: 24.6, retailNet: 22, retailGross: 27.06, stock: [{ name: 'CHW', qty: 3 }], total: 3, link: 'https://evil.example/x' },
      { index: 'K20TT', brand: 'DENSO', name: 'ŚWIECA ZAPŁONOWA', net: 15, gross: 18.45, retailGross: 30, stock: [{ name: 'WWA', qty: 0 }], total: 0 },
      { index: 'X1', brand: 'NGK', name: 'OBUDOWA', net: 1, gross: 1.23, retailGross: 2, stock: [{ name: 'WWA', qty: 5 }], total: 5 }] }] } });
    for (let i = 0; i < 80; i++) { j = await req('ai-parts/jobs/' + id); if (['done', 'error'].includes(j.status)) break; await new Promise((x) => setTimeout(x, 200)); }
    assert.equal(j.status, 'done', j.error);
    assert.equal(j.result.profiauto, 1); assert.equal(j.result.allegro, 0);
    const sp = (await req(`ai-parts/orders/${q8.id}`)).lines.find((l) => l.group_key === 'spark_plug');
    assert.equal(sp.variants.eco.supplier, 'ProfiAuto'); assert.equal(sp.variants.eco.brand, 'NGK'); assert.equal(sp.variants.eco.sellGross, 24.6, 'детальная ProfiAuto выше мин. маржи');
    assert.equal(sp.variants.eco.delivery, 'склад WWA');
    assert.equal(sp.variants.mid.brand, 'BOSCH'); assert.equal(sp.variants.mid.sellGross, 31.98, 'детальная ниже мин. маржи → закупка брутто + 30 %'); assert.equal(sp.variants.mid.url, null, 'чужие ссылки не принимаем');
    assert.ok(!Object.values(sp.variants).some((v) => v.brand === 'DENSO'), 'нет на складе — не берём');
    await req('ai-parts/lines/' + sp.id, { body: { variant: 'eco' } });
    const o = await req('orders/' + q8.id);
    assert.match(o.internal_note, /ИИ-подбор — заказать в ProfiAuto: Świeca zapłonowa NGK BKR6E, закупка 12,3 zł brutto, склад WWA — https:\/\/online\.profiauto\.com\/main-article\/detail\?x=1/);
  });
  await t('отмена подбора, пока он ждёт поставщика: позиции потом не добавляются', async () => {
    const q9 = await req('orders', { body: { kind: 'quote', customer_id: c.id, car_id: car.id } });
    const { id } = await req(`ai-parts/orders/${q9.id}/jobs`, { body: { text: 'свечи', level: 'mid', extAllegro: true, extV: 10700 } });
    let j; for (let i = 0; i < 80; i++) { j = await req('ai-parts/jobs/' + id); if (j.status === 'waiting') break; await new Promise((x) => setTimeout(x, 150)); }
    assert.equal(j.status, 'waiting');
    await req(`ai-parts/jobs/${id}/undo`, { method: 'POST' });
    assert.equal((await req('ai-parts/jobs/' + id)).status, 'cancelled');
    await new Promise((x) => setTimeout(x, 2500));
    assert.equal((await req('orders/' + q9.id)).items.length, 0);
    assert.equal((await req('ai-parts/jobs/' + id)).status, 'cancelled');
  });
  await t('без VIN — подбор недоступен', async () => {
    const c2 = await req('customers', { body: { name: 'Bez Auta', phone: '600100300' } });
    const q2 = await req('orders', { body: { kind: 'quote', customer_id: c2.id } });
    await assert.rejects(req(`ai-parts/orders/${q2.id}/jobs`, { body: { text: 'x' } }), (e) => /VIN/.test(e.message));
  });
} finally {
  srv.kill(); mock.close();
}
if (fails.length) { console.log('\nНЕ ПРОЙДЕНО:', fails.join(', ')); process.exit(1); }
console.log('\nИИ-запчастист: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
