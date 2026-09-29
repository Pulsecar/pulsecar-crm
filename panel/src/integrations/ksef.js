// KSeF 2.0 напрямую (без Fakturownia): вход токеном KSeF, интерактивная сессия, отправка FA(3), номер KSeF, UPO, QR «KOD I».
// Документация Минфина: github.com/CIRFMF/ksef-docs (API v2), схема FA(3) — crd.gov.pl/wzor/2025/06/25/13775/
import crypto from 'node:crypto';
import { one, all, run, getSetting } from '../db.js';
import { cfg, getState, setState } from './index.js';
import { HttpError, round2 } from '../util.js';

export const KSEF_ENVS = {
  prod: { api: 'https://api.ksef.mf.gov.pl/v2', qr: 'https://qr.ksef.mf.gov.pl', app: 'https://ap.ksef.mf.gov.pl' },
  demo: { api: 'https://api-demo.ksef.mf.gov.pl/v2', qr: 'https://qr-demo.ksef.mf.gov.pl', app: 'https://ap-demo.ksef.mf.gov.pl' },
  test: { api: 'https://api-test.ksef.mf.gov.pl/v2', qr: 'https://qr-test.ksef.mf.gov.pl', app: 'https://ap-test.ksef.mf.gov.pl' },
};
const KEY = 'ksef';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const digits = (s) => String(s || '').replace(/\D/g, '');

export function ksefEnabled() { try { return !!cfg(KEY); } catch { return false; } }
function conf({ any = false } = {}) {
  const c = cfg(KEY, { ignoreEnabled: any });
  if (!c) throw new HttpError(400, 'KSeF не подключён: Настройки → Интеграции → KSeF.');
  const nip = digits(c.nip || getSetting('company_nip'));
  if (!c.token) throw new HttpError(400, 'Вставьте токен KSeF (Настройки → Интеграции → KSeF).');
  if (!validNip(nip)) throw new HttpError(400, 'Неверный NIP фирмы для KSeF — проверьте Настройки → Фирма.');
  const env = KSEF_ENVS[c.env] ? c.env : 'prod';
  return { ...c, nip, env, base: process.env.KSEF_BASE || KSEF_ENVS[env].api, qr: KSEF_ENVS[env].qr };
}

export function validNip(nip) {
  const d = digits(nip);
  if (d.length !== 10) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = w.reduce((s, x, i) => s + x * Number(d[i]), 0) % 11;
  return sum !== 10 && sum === Number(d[9]);
}

// ── HTTP ───────────────────────────────────────────────────────────────────
function errText(j, status) {
  const list = j?.exception?.exceptionDetailList;
  if (list?.length) return list.map((e) => [e.exceptionCode, e.exceptionDescription, ...(e.details || [])].filter(Boolean).join(' ')).join('; ');
  if (j?.title || j?.detail) return [j.title, j.detail, ...(j.errors ? Object.values(j.errors).flat() : [])].filter(Boolean).join(' ');
  if (j?.status?.description) return `${j.status.code} ${j.status.description} ${(j.status.details || []).join(' ')}`;
  return `HTTP ${status}`;
}
async function call(c, method, path, { body, token, accept = 'application/json', raw = false } = {}) {
  const r = await fetch(c.base + path, {
    method,
    headers: { Accept: accept, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw && r.ok) return r;
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { j = { text }; }
  if (!r.ok) {
    const e = new HttpError(r.status === 429 ? 429 : 502, `KSeF: ${errText(j, r.status)}`);
    e.ksefStatus = r.status;
    e.ksefCodes = (j?.exception?.exceptionDetailList || []).map((x) => x.exceptionCode);
    throw e;
  }
  return j;
}

// ── Ключи Минфина (шифрование токена и ключа сессии) ───────────────────────
async function mfKey(c, usage) {
  let st = getState(KEY);
  if (!st.keys || st.keysEnv !== c.env || Date.now() - (st.keysAt || 0) > 24 * 3600_000) {
    const list = await call(c, 'GET', '/security/public-key-certificates');
    st = setState(KEY, { keys: list, keysAt: Date.now(), keysEnv: c.env });
  }
  const now = Date.now();
  const cand = st.keys.filter((k) => (k.usage || []).includes(usage) && Date.parse(k.validFrom) <= now && Date.parse(k.validTo) > now)
    .sort((a, b) => Date.parse(b.validFrom) - Date.parse(a.validFrom));
  if (!cand.length) throw new HttpError(502, `KSeF: нет действующего ключа ${usage}`);
  const x509 = new crypto.X509Certificate(Buffer.from(cand[0].certificate, 'base64'));
  return { key: x509.publicKey, publicKeyId: cand[0].publicKeyId };
}
const rsaOaep = (key, buf) => crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, buf).toString('base64');

// ── Вход токеном KSeF → accessToken ────────────────────────────────────────
async function accessToken(c) {
  const st = getState(KEY);
  const fresh = (t) => t && Date.parse(t.validUntil) > Date.now() + 60_000;
  if (st.authFor === c.nip + c.env && fresh(st.access)) return st.access.token;
  if (st.authFor === c.nip + c.env && fresh(st.refresh)) {
    try {
      const r = await call(c, 'POST', '/auth/token/refresh', { token: st.refresh.token });
      setState(KEY, { access: r.accessToken });
      return r.accessToken.token;
    } catch { /* пройдём вход заново */ }
  }
  const ch = await call(c, 'POST', '/auth/challenge');
  const { key, publicKeyId } = await mfKey(c, 'KsefTokenEncryption');
  const enc = rsaOaep(key, Buffer.from(`${String(c.token).trim()}|${ch.timestampMs}`, 'utf8'));
  let a;
  try {
    a = await call(c, 'POST', '/auth/ksef-token', { body: { challenge: ch.challenge, contextIdentifier: { type: 'Nip', value: c.nip }, encryptedToken: enc, publicKeyId } });
  } catch (e) {
    if (e.ksefCodes?.includes(21470)) setState(KEY, { keysAt: 0 });
    throw e;
  }
  const authTok = a.authenticationToken.token;
  for (let i = 0; i < 30; i++) {
    const s = await call(c, 'GET', `/auth/${a.referenceNumber}`, { token: authTok });
    if (s.status?.code === 200) break;
    if (s.status?.code >= 400) throw new HttpError(502, `KSeF: вход не удался — ${s.status.code} ${s.status.description || ''} ${(s.status.details || []).join(' ')}`.trim());
    await sleep(1000);
    if (i === 29) throw new HttpError(504, 'KSeF: вход не завершился за 30 секунд, попробуйте позже');
  }
  const t = await call(c, 'POST', '/auth/token/redeem', { token: authTok });
  setState(KEY, { access: t.accessToken, refresh: t.refreshToken, authFor: c.nip + c.env, info: `Вход OK · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}` });
  return t.accessToken.token;
}

// ── Интерактивная сессия (одна открытая на 12 ч, переиспользуем) ────────────
async function session(c, token, { renew = false } = {}) {
  const st = getState(KEY);
  const s = st.session;
  if (!renew && s && s.env === c.env && s.nip === c.nip && Date.parse(s.validUntil) > Date.now() + 15 * 60_000) return s;
  const { key, publicKeyId } = await mfKey(c, 'SymmetricKeyEncryption');
  const aes = crypto.randomBytes(32), iv = crypto.randomBytes(16);
  const r = await call(c, 'POST', '/sessions/online', {
    token, body: { formCode: { systemCode: 'FA (3)', schemaVersion: '1-0E', value: 'FA' }, encryption: { encryptedSymmetricKey: rsaOaep(key, aes), initializationVector: iv.toString('base64'), publicKeyId } },
  });
  const ns = { ref: r.referenceNumber, validUntil: r.validUntil, key: aes.toString('base64'), iv: iv.toString('base64'), env: c.env, nip: c.nip };
  setState(KEY, { session: ns });
  return ns;
}

// ── FA(3) XML ──────────────────────────────────────────────────────────────
const x = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
const amt = (n) => { const v = round2(n); return (Object.is(v, -0) || v === 0 ? 0 : v).toFixed(2); };
const price = (n) => { const v = Math.round((Number(n) || 0) * 10000) / 10000; return String(v === 0 ? 0 : v); };
const qty = (n) => String(Math.round((Number(n) || 0) * 1e6) / 1e6);
const PAY = { cash: 1, card: 2, blik: 7, transfer: 6, points: 3 };
const SPLIT_PL = { cash: 'gotówka', card: 'karta', blik: 'BLIK', transfer: 'przelew' };
const RATE_FIELD = { 23: ['P_13_1', 'P_14_1'], 22: ['P_13_1', 'P_14_1'], 8: ['P_13_2', 'P_14_2'], 7: ['P_13_2', 'P_14_2'], 5: ['P_13_3', 'P_14_3'], 0: ['P_13_6_1', null] };
function splitAddr(a) {
  const s = String(a || '').trim();
  const i = s.lastIndexOf(',');
  return i > 0 ? [s.slice(0, i).trim(), s.slice(i + 1).trim()] : [s || '-', ''];
}
const addrXml = (l1, l2) => `<Adres><KodKraju>PL</KodKraju><AdresL1>${x(l1 || '-')}</AdresL1>${l2 ? `<AdresL2>${x(l2)}</AdresL2>` : ''}</Adres>`;
function sums(lines) {
  const by = {};
  for (const l of lines) { const r = (by[l.vat] ||= { net: 0, vat: 0, gross: 0 }); r.net += l.net; r.vat += l.vat_amt; r.gross += l.gross; }
  return by;
}
function ratesXml(by) {
  const order = ['P_13_1', 'P_14_1', 'P_13_2', 'P_14_2', 'P_13_3', 'P_14_3', 'P_13_6_1'];
  const vals = {};
  for (const [rate, s] of Object.entries(by)) {
    const f = RATE_FIELD[Number(rate)];
    if (!f) throw new HttpError(400, `KSeF: ставка VAT ${rate}% не поддерживается в CRM — используйте 23, 8, 5 или 0`);
    vals[f[0]] = (vals[f[0]] || 0) + s.net;
    if (f[1]) vals[f[1]] = (vals[f[1]] || 0) + s.vat;
  }
  return order.filter((k) => vals[k] !== undefined).map((k) => `<${k}>${amt(vals[k])}</${k}>`).join('');
}
const lineXml = (l, n, before = false) => `<FaWiersz><NrWierszaFa>${n}</NrWierszaFa><P_7>${x(String(l.name).slice(0, 512))}</P_7><P_8A>${x(l.unit || 'szt.')}</P_8A><P_8B>${qty(l.qty)}</P_8B>`
  + `<P_9B>${price(l.qty ? l.gross / l.qty : 0)}</P_9B><P_11A>${amt(l.gross)}</P_11A><P_12>${RATE_FIELD[Number(l.vat)] ? String(Number(l.vat)) : x(l.vat)}</P_12>${before ? '<StanPrzed>1</StanPrzed>' : ''}</FaWiersz>`;

/** XML фактуры FA(3) из документа продажи CRM (метод «от брутто» — как считаются цены в заказе) */
export function buildFa3(d, S = Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value]))) {
  const b = JSON.parse(d.buyer || '{}');
  const L = JSON.parse(d.items || '[]');
  const nip = digits(S.company_nip);
  const [s1, s2] = S.company_street ? [S.company_street, [S.company_postcode, S.company_city].filter(Boolean).join(' ')] : splitAddr(S.company_legal_address || S.company_address);
  const bNip = digits(b.nip);
  const buyerId = bNip && validNip(bNip) ? `<NIP>${bNip}</NIP>` : '<BrakID>1</BrakID>';
  const bAddr = b.street || b.city ? addrXml(b.street, [b.postcode, b.city].filter(Boolean).join(' ')) : '';
  let rows, totals, kor = '';
  if (d.kind === 'correction') {
    const orig = one('SELECT * FROM sales_docs WHERE id = ?', d.corrects_id);
    if (!orig) throw new HttpError(400, 'Нет исходной фактуры для корректы');
    const OL = JSON.parse(orig.items || '[]');
    const diff = {};
    const add = (arr, sign) => { for (const [r, s] of Object.entries(sums(arr))) { const t = (diff[r] ||= { net: 0, vat: 0, gross: 0 }); t.net += sign * s.net; t.vat += sign * s.vat; t.gross += sign * s.gross; } };
    add(L, 1); add(OL, -1);
    totals = { rates: ratesXml(diff), gross: Object.values(diff).reduce((s, v) => s + v.gross, 0) };
    rows = [...OL.map((l, i) => lineXml(l, i + 1, true)), ...L.map((l, i) => lineXml(l, OL.length + i + 1))].join('');
    kor = `<PrzyczynaKorekty>${x(d.reason || 'Korekta')}</PrzyczynaKorekty><TypKorekty>2</TypKorekty><DaneFaKorygowanej><DataWystFaKorygowanej>${orig.issue_date}</DataWystFaKorygowanej>`
      + `<NrFaKorygowanej>${x(orig.number)}</NrFaKorygowanej>${orig.ksef_number ? `<NrKSeF>1</NrKSeF><NrKSeFFaKorygowanej>${x(orig.ksef_number)}</NrKSeFFaKorygowanej>` : '<NrKSeFN>1</NrKSeFN>'}</DaneFaKorygowanej>`;
    // корректа данных покупателя: в Podmiot2K — данные с исходной фактуры, в Podmiot2 — исправленные
    const ob = JSON.parse(orig.buyer || '{}');
    if (['name', 'nip', 'street', 'postcode', 'city'].some((k) => String(ob[k] || '').trim() !== String(b[k] || '').trim())) {
      const oNip = digits(ob.nip);
      kor += `<Podmiot2K><DaneIdentyfikacyjne>${oNip && validNip(oNip) ? `<NIP>${oNip}</NIP>` : '<BrakID>1</BrakID>'}<Nazwa>${x(ob.name || 'Klient detaliczny')}</Nazwa></DaneIdentyfikacyjne>`
        + `${ob.street || ob.city ? addrXml(ob.street, [ob.postcode, ob.city].filter(Boolean).join(' ')) : ''}</Podmiot2K>`;
    }
  } else {
    const by = sums(L);
    totals = { rates: ratesXml(by), gross: Object.values(by).reduce((s, v) => s + v.gross, 0) };
    rows = L.map((l, i) => lineXml(l, i + 1)).join('');
  }
  const paid = d.kind !== 'correction' && d.paid >= d.total_gross - 0.005 && d.total_gross > 0;
  const js = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
  const split = js(d.pay_split) || [];
  // данные автомобиля — в «Dodatkowy opis» фактуры (klucz → wartość)
  const car = js(d.car);
  const opis = car ? [['Pojazd', [car.make, car.model, car.year].filter(Boolean).join(' ')], ['Nr rejestracyjny', car.plate], ['VIN', car.vin], ['Przebieg', car.mileage && `${car.mileage} km`], ['Silnik', car.engine]]
    .filter(([, v]) => v).map(([k, v]) => `<DodatkowyOpis><Klucz>${x(k)}</Klucz><Wartosc>${x(String(v).slice(0, 256))}</Wartosc></DodatkowyOpis>`).join('') : '';
  const bank = digits(S.company_bank).length >= 10 ? `<RachunekBankowy><NrRB>${digits(S.company_bank)}</NrRB>${S.company_bank_name ? `<NazwaBanku>${x(S.company_bank_name)}</NazwaBanku>` : ''}</RachunekBankowy>` : '';
  const platnosc = d.kind === 'correction' ? '' : `<Platnosc>${paid ? `<Zaplacono>1</Zaplacono><DataZaplaty>${d.issue_date}</DataZaplaty>` : `<TerminPlatnosci><Termin>${d.due_date || d.issue_date}</Termin></TerminPlatnosci>`}`
    + (d.payment_method === 'mixed' ? `<PlatnoscInna>1</PlatnoscInna><OpisPlatnosci>${x(('Płatność mieszana' + (split.length ? ': ' + split.map((p) => `${SPLIT_PL[p.method] || p.method} ${amt(p.amount)} zł`).join(', ') : '')).slice(0, 256))}</OpisPlatnosci>` : `<FormaPlatnosci>${PAY[d.payment_method] || 1}</FormaPlatnosci>`)
    + `${d.payment_method === 'transfer' || d.payment_method === 'mixed' ? bank : ''}</Platnosc>`;
  const contact = S.company_email || S.company_phone ? `<DaneKontaktowe>${S.company_email ? `<Email>${x(S.company_email)}</Email>` : ''}${S.company_phone ? `<Telefon>${x(digits(S.company_phone).slice(-16))}</Telefon>` : ''}</DaneKontaktowe>` : '';
  const stopka = [S.company_krs && `KRS: ${S.company_krs}`, S.company_regon && `REGON: ${S.company_regon}`, S.company_bdo && `BDO: ${S.company_bdo}`, S.company_capital && `Kapitał zakładowy: ${S.company_capital}`].filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"><Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza><WariantFormularza>3</WariantFormularza>`
    + `<DataWytworzeniaFa>${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</DataWytworzeniaFa><SystemInfo>Pulsecar CRM</SystemInfo></Naglowek>`
    + `<Podmiot1><DaneIdentyfikacyjne><NIP>${nip}</NIP><Nazwa>${x(S.company_legal_name || S.company_name)}</Nazwa></DaneIdentyfikacyjne>${addrXml(s1, s2)}${contact}</Podmiot1>`
    + `<Podmiot2><DaneIdentyfikacyjne>${buyerId}<Nazwa>${x(b.name || 'Klient detaliczny')}</Nazwa></DaneIdentyfikacyjne>${bAddr}<JST>2</JST><GV>2</GV></Podmiot2>`
    + `<Fa><KodWaluty>PLN</KodWaluty><P_1>${d.issue_date}</P_1>${d.place ? `<P_1M>${x(d.place)}</P_1M>` : ''}<P_2>${x(d.number)}</P_2>`
    + `${d.kind !== 'correction' && d.sale_date && d.sale_date !== d.issue_date ? `<P_6>${d.sale_date}</P_6>` : ''}${totals.rates}<P_15>${amt(totals.gross)}</P_15>`
    + '<Adnotacje><P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A><Zwolnienie><P_19N>1</P_19N></Zwolnienie><NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu><P_23>2</P_23><PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy></Adnotacje>'
    + `<RodzajFaktury>${d.kind === 'correction' ? 'KOR' : 'VAT'}</RodzajFaktury>${kor}${opis}${rows}${platnosc}</Fa>`
    + (stopka.length ? `<Stopka><Rejestry>${S.company_krs ? `<KRS>${digits(S.company_krs)}</KRS>` : ''}${S.company_regon ? `<REGON>${digits(S.company_regon)}</REGON>` : ''}${S.company_bdo ? `<BDO>${digits(S.company_bdo)}</BDO>` : ''}</Rejestry></Stopka>` : '')
    + '</Faktura>';
}

// ── Отправка фактуры и статус ──────────────────────────────────────────────
export const qrUrl = (d, c) => {
  const [y, m, dd] = d.issue_date.split('-');
  return `${c.qr}/invoice/${c.nip}/${dd}-${m}-${y}/${Buffer.from(d.ksef_hash, 'base64').toString('base64url')}`;
};

export async function sendToKsef(docId) {
  const c = conf();
  const d = one('SELECT * FROM sales_docs WHERE id = ?', docId);
  if (!d) throw new HttpError(404, 'Документ не найден');
  if (d.kind === 'proforma') throw new HttpError(400, 'Pro forma в KSeF не отправляется');
  if (d.ksef_number) return statusOf(d);
  const xml = d.ksef_xml || buildFa3(d);
  const buf = Buffer.from(xml, 'utf8');
  const token = await accessToken(c);
  let s = await session(c, token);
  const send = async (ss) => {
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ss.key, 'base64'), Buffer.from(ss.iv, 'base64'));
    const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
    return call(c, 'POST', `/sessions/online/${ss.ref}/invoices`, {
      token, body: { invoiceHash: crypto.createHash('sha256').update(buf).digest('base64'), invoiceSize: buf.length, encryptedInvoiceHash: crypto.createHash('sha256').update(enc).digest('base64'),
        encryptedInvoiceSize: enc.length, encryptedInvoiceContent: enc.toString('base64'), offlineMode: false },
    });
  };
  let r;
  try { r = await send(s); } catch (e) {
    if (!e.ksefCodes?.some((k) => [21173, 21180, 21184].includes(k))) throw e;
    s = await session(c, token, { renew: true });
    r = await send(s);
  }
  run(`UPDATE sales_docs SET ksef_status = 'sent', ksef_ref = ?, ksef_session = ?, ksef_hash = ?, ksef_xml = ?, ksef_env = ?, ksef_error = NULL, ksef_sent_at = datetime('now','localtime') WHERE id = ?`,
    r.referenceNumber, s.ref, crypto.createHash('sha256').update(buf).digest('base64'), xml, c.env, d.id);
  for (let i = 0; i < 12; i++) {
    await sleep(i < 4 ? 1000 : 2500);
    const st = await refreshStatus(d.id, { c, token });
    if (st.ksef_status !== 'sent') return st;
  }
  return statusOf(one('SELECT * FROM sales_docs WHERE id = ?', d.id));
}

export async function refreshStatus(docId, { c = conf({ any: true }), token } = {}) {
  const d = one('SELECT * FROM sales_docs WHERE id = ?', docId);
  if (!d?.ksef_ref || d.ksef_number) return statusOf(d);
  token ||= await accessToken(c);
  const r = await call(c, 'GET', `/sessions/${d.ksef_session}/invoices/${d.ksef_ref}`, { token });
  const code = r.status?.code;
  if (code === 200) run(`UPDATE sales_docs SET ksef_status = 'accepted', ksef_number = ?, ksef_error = NULL WHERE id = ?`, r.ksefNumber, d.id);
  else if (code === 440) run(`UPDATE sales_docs SET ksef_status = 'accepted', ksef_number = ?, ksef_error = ? WHERE id = ?`, r.status?.extensions?.originalKsefNumber || null, 'Дубликат — фактура уже была в KSeF', d.id);
  else if (code >= 400) run(`UPDATE sales_docs SET ksef_status = 'rejected', ksef_error = ? WHERE id = ?`, `${code} ${r.status.description || ''} ${(r.status.details || []).join(' ')}`.trim().slice(0, 1000), d.id);
  return statusOf(one('SELECT * FROM sales_docs WHERE id = ?', d.id));
}
const statusOf = (d) => ({ id: d.id, number: d.number, ksef_status: d.ksef_status || null, ksef_number: d.ksef_number || null, ksef_error: d.ksef_error || null });

export async function upoXml(docId) {
  const c = conf({ any: true });
  const d = one('SELECT * FROM sales_docs WHERE id = ?', docId);
  if (!d?.ksef_number) throw new HttpError(400, 'Фактура ещё не принята KSeF');
  const token = await accessToken(c);
  const r = await call(c, 'GET', `/sessions/${d.ksef_session}/invoices/${d.ksef_ref}/upo`, { token, accept: 'application/xml', raw: true });
  return Buffer.from(await r.arrayBuffer());
}

export async function testKsef() {
  const c = conf({ any: true });
  setState(KEY, { access: null, refresh: null, session: null });
  await accessToken(c);
  return `Вход в KSeF (${c.env === 'prod' ? 'боевой' : c.env}) по NIP ${c.nip} — OK`;
}

/** Фоновая проверка: фактуры, у которых ещё нет номера KSeF */
export function startKsefPoller() {
  const tick = async () => {
    if (!ksefEnabled()) return;
    for (const d of all(`SELECT id FROM sales_docs WHERE ksef_status = 'sent' AND ksef_number IS NULL ORDER BY id LIMIT 20`)) {
      try { await refreshStatus(d.id); } catch { /* повторим позже */ }
    }
  };
  setInterval(() => tick().catch(() => {}), 120_000).unref();
}
