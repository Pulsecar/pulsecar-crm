// KSeF 2.0 напрямую: вход токеном (RSA-OAEP), сессия (AES-256-CBC), отправка FA(3), номер KSeF, UPO, корректа, QR на фактуре.
// Имитация сервера Минфина с настоящей криптографией: сертификат создаётся через openssl.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const PORT = 3183, MOCK = 3182;
const BASE = `http://localhost:${PORT}`;
const DB = './data/test-ksef.db';
for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
const TOKEN = '20260928-EC-1DCE3E3000-12ECB5B36E-45|nip-5214141930|919f70aa';

// сертификат «Минфина»
const dir = mkdtempSync(join(tmpdir(), 'ksef-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '30', '-subj', '/CN=KSeF test'], { stdio: 'ignore' });
const priv = crypto.createPrivateKey(readFileSync(join(dir, 'k.pem')));
const certDer = new crypto.X509Certificate(readFileSync(join(dir, 'c.pem'))).raw.toString('base64');
const rsaDec = (b64) => crypto.privateDecrypt({ key: priv, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(b64, 'base64'));
const now = Date.now();
const certs = [{ certificate: certDer, publicKeyId: 'pk-token', validFrom: new Date(now - 86400000).toISOString(), validTo: new Date(now + 86400000 * 30).toISOString(), usage: ['KsefTokenEncryption'] },
  { certificate: certDer, publicKeyId: 'pk-sym', validFrom: new Date(now - 86400000).toISOString(), validTo: new Date(now + 86400000 * 30).toISOString(), usage: ['SymmetricKeyEncryption'] }];

const state = { challenge: null, sessions: {}, invoices: {}, n: 0, xml: [] };
const mock = createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const b = body ? JSON.parse(body) : {};
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/v2/, '');
  const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
  const auth = req.headers.authorization || '';
  if (p.startsWith('/api/search/nip/')) return p.endsWith('7010000005') ? json(200, { result: { subject: { name: 'FIRMA TESTOWA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', nip: '7010000005', statusVat: 'Czynny', regon: '123456785', krs: '0000999999',
    workingAddress: 'UL. TESTOWA 5/2, 02-222 WARSZAWA', accountNumbers: ['61109010140000071219812874'] }, requestDateTime: '28-09-2026 10:00:00' } }) : json(200, { result: { subject: null } });
  if (p === '/security/public-key-certificates') return json(200, certs);
  if (p === '/auth/challenge') { state.challenge = { challenge: '20260928-CR-AAAAAAAAAA-BBBBBBBBBB-11', timestampMs: Date.now() }; return json(200, state.challenge); }
  if (p === '/auth/ksef-token') {
    assert.equal(b.contextIdentifier.type, 'Nip'); assert.equal(b.contextIdentifier.value, '5214141930'); assert.equal(b.publicKeyId, 'pk-token');
    const plain = rsaDec(b.encryptedToken).toString('utf8');
    assert.equal(plain, `${TOKEN}|${state.challenge.timestampMs}`, 'токен|timestampMs');
    return json(202, { referenceNumber: 'AU-1', authenticationToken: { token: 'authtok', validUntil: new Date(Date.now() + 600000).toISOString() } });
  }
  if (p === '/auth/AU-1') { assert.equal(auth, 'Bearer authtok'); return json(200, { status: { code: 200, description: 'OK' } }); }
  if (p === '/auth/token/redeem') { assert.equal(auth, 'Bearer authtok'); return json(200, { accessToken: { token: 'acc', validUntil: new Date(Date.now() + 900000).toISOString() }, refreshToken: { token: 'ref', validUntil: new Date(Date.now() + 86400000).toISOString() } }); }
  if (auth !== 'Bearer acc') return json(401, { exception: { exceptionDetailList: [{ exceptionCode: 21301, exceptionDescription: 'Brak autoryzacji' }] } });
  if (p === '/sessions/online' && req.method === 'POST') {
    assert.deepEqual(b.formCode, { systemCode: 'FA (3)', schemaVersion: '1-0E', value: 'FA' }); assert.equal(b.encryption.publicKeyId, 'pk-sym');
    const ref = 'SO-' + (Object.keys(state.sessions).length + 1);
    state.sessions[ref] = { key: rsaDec(b.encryption.encryptedSymmetricKey), iv: Buffer.from(b.encryption.initializationVector, 'base64') };
    return json(201, { referenceNumber: ref, validUntil: new Date(Date.now() + 12 * 3600000).toISOString() });
  }
  let m = /^\/sessions\/online\/(SO-\d+)\/invoices$/.exec(p);
  if (m) {
    const s = state.sessions[m[1]];
    const enc = Buffer.from(b.encryptedInvoiceContent, 'base64');
    assert.equal(crypto.createHash('sha256').update(enc).digest('base64'), b.encryptedInvoiceHash); assert.equal(enc.length, b.encryptedInvoiceSize);
    const d = crypto.createDecipheriv('aes-256-cbc', s.key, s.iv); const xml = Buffer.concat([d.update(enc), d.final()]);
    assert.equal(crypto.createHash('sha256').update(xml).digest('base64'), b.invoiceHash); assert.equal(xml.length, b.invoiceSize);
    const txt = xml.toString('utf8'); state.xml.push(txt);
    assert.ok(txt.startsWith('<?xml') && txt.includes('<KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>'));
    const ref = 'EE-' + (++state.n);
    const bad = txt.includes('ODRZUC');
    state.invoices[ref] = { polls: 0, bad, ksef: `5214141930-20260928-0100${String(state.n).padStart(8, '0')}-2${state.n}` };
    return json(202, { referenceNumber: ref });
  }
  m = /^\/sessions\/(SO-\d+)\/invoices\/(EE-\d+)(\/upo)?$/.exec(p);
  if (m) {
    const inv = state.invoices[m[2]];
    if (m[3]) { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(`<UPO><NumerKSeFDokumentu>${inv.ksef}</NumerKSeFDokumentu></UPO>`); }
    inv.polls++;
    if (inv.polls < 2) return json(200, { status: { code: 150, description: 'Trwa przetwarzanie' } });
    if (inv.bad) return json(200, { status: { code: 450, description: 'Błąd weryfikacji semantyki dokumentu faktury', details: ['Nieprawidłowa nazwa'] } });
    return json(200, { ksefNumber: inv.ksef, status: { code: 200, description: 'Sukces' } });
  }
  json(404, {});
});
await new Promise((r) => mock.listen(MOCK, r));

let out = '';
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, NODE_ENV: 'test', PORT, DB_PATH: DB, ADMIN_PASSWORD: 'test-pass-123', SESSION_SECRET: 'k'.repeat(40), PUBLIC_URL: BASE, KSEF_BASE: `http://localhost:${MOCK}/v2`, NIP_API_BASE: `http://localhost:${MOCK}` },
});
srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => process.stderr.write(d));
for (let i = 0; i < 60; i++) { try { await fetch(BASE + "/"); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
let cookie = '';
async function req(path, { body, method } = {}) {
  const r = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, j: ct.includes('json') ? await r.json() : await r.text() };
}
const ok = (x, msg) => { assert.ok(x.status < 300, `${msg}: ${x.status} ${JSON.stringify(x.j).slice(0, 300)}`); return x.j; };

try {
  ok(await req('/crm-api/login', { body: { login: 'admin', password: 'test-pass-123' } }), 'login');
  ok(await req('/crm-api/integrations/ksef', { method: 'PUT', body: { enabled: true, values: { token: TOKEN, env: 'test', autoSend: true } } }), 'ksef on');
  const t = ok(await req('/crm-api/integrations/ksef/test', { body: {} }), 'ksef test');
  assert.match(JSON.stringify(t), /5214141930/);
  const cu = ok(await req('/crm-api/customers', { body: { name: 'Firma Testowa', company: 'Firma Testowa sp. z o.o.', phone: '+48600999888', nip: '7010000005', street: 'ul. Testowa 5', postcode: '02-222', city: 'Warszawa' } }), 'cust');
  const o = ok(await req('/crm-api/orders', { body: { customer_id: cu.id } }), 'order');
  ok(await req(`/crm-api/orders/${o.id}/items`, { body: { kind: 'labor', name: 'Wymiana oleju', qty: 1, price: 246, vat: 23 } }), 'i1');
  ok(await req(`/crm-api/orders/${o.id}/items`, { body: { kind: 'part', name: 'Filtr oleju', qty: 2, price: 61.5, vat: 23 } }), 'i2');
  const fv = ok(await req(`/crm-api/orders/${o.id}/sales-docs`, { body: { kind: 'vat', payment_method: 'transfer', due_days: 7 } }), 'fv');
  assert.equal(fv.ksef_status, 'accepted', JSON.stringify(fv)); assert.match(fv.ksef_number, /^5214141930-/);
  assert.ok(!fv.warning);
  const x1 = state.xml[0];
  for (const s of ['<NIP>5214141930</NIP>', '<NIP>7010000005</NIP>', '<JST>2</JST>', '<RodzajFaktury>VAT</RodzajFaktury>', '<P_15>369.00</P_15>', '<P_13_1>300.00</P_13_1>', '<P_14_1>69.00</P_14_1>', '<FormaPlatnosci>6</FormaPlatnosci>', '<P_9B>61.5</P_9B>'])
    assert.ok(x1.includes(s), 'в XML нет ' + s);
  // визуализация: QR KOD I и номер KSeF
  const html = await req('/crm-api/print/sale/' + fv.id);
  assert.ok(html.j.includes(fv.ksef_number) && html.j.includes('https://qr-test.ksef.mf.gov.pl/invoice/5214141930/'), 'QR/номер на фактуре');
  const upo = await req(`/crm-api/sales-docs/${fv.id}/upo`);
  assert.equal(upo.status, 200); assert.ok(String(upo.j).includes(fv.ksef_number));
  const xml = await req(`/crm-api/sales-docs/${fv.id}/xml`); assert.equal(xml.j, x1, 'XML совпадает с отправленным');
  // корректа уходит в KSeF со ссылкой на номер KSeF исходной
  const fk = ok(await req(`/crm-api/sales-docs/${fv.id}/correct`, { body: { reason: 'Zwrot filtra', lines: [{}, { qty: 1 }] } }), 'fk');
  assert.equal(fk.ksef_status, 'accepted');
  const x2 = state.xml[1];
  for (const s of ['<RodzajFaktury>KOR</RodzajFaktury>', `<NrKSeFFaKorygowanej>${fv.ksef_number}</NrKSeFFaKorygowanej>`, '<StanPrzed>1</StanPrzed>', '<P_15>-61.50</P_15>', '<PrzyczynaKorekty>Zwrot filtra</PrzyczynaKorekty>'])
    assert.ok(x2.includes(s), 'в корректе нет ' + s);
  assert.equal(Object.keys(state.sessions).length, 1, 'сессия переиспользуется');
  // отклонённая фактура: статус и причина, повторная отправка
  const o2 = ok(await req('/crm-api/orders', { body: { customer_id: cu.id } }), 'order2');
  ok(await req(`/crm-api/orders/${o2.id}/items`, { body: { kind: 'labor', name: 'ODRZUC test', qty: 1, price: 100, vat: 23 } }), 'bad item');
  const bad = ok(await req(`/crm-api/orders/${o2.id}/sales-docs`, { body: { kind: 'vat' } }), 'bad fv');
  assert.equal(bad.ksef_status, 'rejected'); assert.match(bad.warning, /450/);
  const ord = ok(await req('/crm-api/orders/' + o.id), 'order docs');
  assert.ok(ord.sales_docs.every((d) => d.ksef_status === 'accepted'));
  const f = ok(await req('/crm-api/nip/701-000-00-05'), 'nip lookup');
  assert.equal(f.street, 'ul. Testowa 5/2'); assert.equal(f.postcode, '02-222'); assert.equal(f.city, 'Warszawa'); assert.equal(f.statusVat, 'Czynny'); assert.equal(f.regon, '123456785');
  assert.equal((await req('/crm-api/nip/1234567890')).status, 400, 'неверная контрольная сумма NIP');
  assert.equal((await req('/crm-api/nip/5260250274')).status, 404);
  console.log('✓ поиск фирмы по NIP (Biała lista MF): название, адрес, REGON, KRS, статус VAT');
  console.log('✓ KSeF 2.0: вход токеном (RSA-OAEP), сессия AES-256, FA(3) → номер KSeF, UPO, XML, корректа KOR со ссылкой на номер KSeF, QR на фактуре, отказ с причиной');
  console.log('\nВСЕ ПРОВЕРКИ KSeF ПРОЙДЕНЫ');
} catch (e) {
  console.error('✗', e.message); console.error(out.slice(-1500)); process.exitCode = 1;
} finally { srv.kill(); mock.close(); rmSync(dir, { recursive: true, force: true }); }
