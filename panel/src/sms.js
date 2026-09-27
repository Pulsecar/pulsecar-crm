// SMS: несколько провайдеров на выбор (Настройки → Интеграции). Каждое SMS пишется в журнал (раздел «SMS»).
import { config } from './config.js';
import { cfg } from './integrations/index.js';
import { ilog, insert, getSetting } from './db.js';
import { HttpError } from './util.js';

export const SMS_PROVIDERS = ['smsgate', 'smsapi', 'serwersms', 'smsplanet', 'twilio', 'smshttp'];

/** Какой провайдер отправляет: выбранный в настройках или первый включённый */
export function activeProvider() {
  const pick = getSetting('sms_provider');
  if (pick && cfg(pick)) return pick;
  if (!pick && !SMS_PROVIDERS.some((k) => cfg(k)) && config.smsProvider === 'smsapi' && config.smsapiToken) return 'smsapi';
  return SMS_PROVIDERS.find((k) => cfg(k)) || null;
}

const PL = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z', Ą: 'A', Ć: 'C', Ę: 'E', Ł: 'L', Ń: 'N', Ó: 'O', Ś: 'S', Ź: 'Z', Ż: 'Z' };
/** Без польских букв SMS вмещает 160 знаков вместо 70 */
export const translit = (t) => String(t).replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (ch) => PL[ch]).replace(/[„”«»]/g, '"').replace(/[–—]/g, '-');

export function smsParts(text) {
  const gsm = /^[\x0A\x0D\x20-\x7E£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉÄÖÑÜ§¿äöñüà€]*$/.test(text);
  const n = text.length;
  if (gsm) return n <= 160 ? 1 : Math.ceil(n / 153);
  return n <= 70 ? 1 : Math.ceil(n / 67);
}

const e164 = (p) => { const d = String(p).replace(/[^\d+]/g, ''); return d.startsWith('+') ? d : d.length === 9 ? '+48' + d : '+' + d; };

async function j(r) { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t }; } }

const SENDERS = {
  async smsapi(c, to, text) {
    const token = c?.token || config.smsapiToken;
    const r = await fetch(process.env.SMSAPI_BASE || 'https://api.smsapi.pl/sms.do', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
      body: new URLSearchParams({ to: to.replace('+', ''), message: text, from: c?.sender || config.smsSender, format: 'json', encoding: 'utf-8' }),
    });
    const b = await j(r);
    if (!r.ok || b.error) throw new Error(`SMSAPI: ${b.message || r.status}`);
    return b.list?.[0]?.id;
  },
  async serwersms(c, to, text) {
    const r = await fetch((process.env.SERWERSMS_BASE || 'https://api2.serwersms.pl') + '/messages/send_sms.json', {
      method: 'POST', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: to, text, sender: c.sender || undefined, system: 'pulsecar' }),
    });
    const b = await j(r);
    if (!r.ok || b.success === false || b.error) throw new Error(`SerwerSMS: ${b.error?.message || b.message || r.status}`);
    return b.items?.[0]?.id;
  },
  async smsplanet(c, to, text) {
    const r = await fetch((process.env.SMSPLANET_BASE || 'https://api2.smsplanet.pl') + '/sms', {
      method: 'POST', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ from: c.sender || 'TEST', to, msg: text }),
    });
    const b = await j(r);
    if (!r.ok || b.errorMsg) throw new Error(`SMSPLANET: ${b.errorMsg || r.status}`);
    return b.messageId;
  },
  async twilio(c, to, text) {
    const r = await fetch(`${process.env.TWILIO_BASE || 'https://api.twilio.com'}/2010-04-01/Accounts/${encodeURIComponent(c.sid)}/Messages.json`, {
      method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${c.sid}:${c.token}`).toString('base64') },
      body: new URLSearchParams({ To: to, Body: text, ...(c.from?.startsWith('MG') ? { MessagingServiceSid: c.from } : { From: c.from }) }),
    });
    const b = await j(r);
    if (!r.ok) throw new Error(`Twilio: ${b.message || r.status}`);
    return b.sid;
  },
  /** Свой Android-телефон с SIM (приложение SMS Gateway for Android: облако api.sms-gate.app или локальный адрес) */
  async smsgate(c, to, text) {
    const url = (c.url || 'https://api.sms-gate.app/3rdparty/v1').replace(/\/$/, '') + '/message';
    const r = await fetch(url, {
      method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${c.user}:${c.pass}`).toString('base64'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ textMessage: { text }, phoneNumbers: [to], ...(c.simNumber ? { simNumber: Number(c.simNumber) } : {}) }),
    });
    const b = await j(r);
    if (!r.ok) throw new Error(`SMS Gateway: ${b.message || b.error || r.status}`);
    return b.id;
  },
  /** Любой шлюз по HTTP: {phone}, {phone_digits}, {text} подставляются в адрес и тело */
  async smshttp(c, to, text) {
    const sub = (s, enc) => String(s || '').replaceAll('{phone}', enc(to)).replaceAll('{phone_digits}', enc(to.replace('+', ''))).replaceAll('{text}', enc(text));
    const url = sub(c.url, encodeURIComponent);
    let headers = {};
    try { headers = c.headers ? JSON.parse(c.headers) : {}; } catch { throw new Error('Заголовки должны быть в формате JSON'); }
    const isJson = String(c.body || '').trim().startsWith('{');
    const body = c.method === 'GET' ? undefined : sub(c.body, isJson ? (v) => JSON.stringify(v).slice(1, -1) : encodeURIComponent);
    const r = await fetch(url, {
      method: c.method || 'POST',
      headers: { ...(body ? { 'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded' } : {}), ...headers }, body,
    });
    const b = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${b.slice(0, 200)}`);
    return null;
  },
};

/**
 * Отправка SMS. meta: { kind, customer_id, order_id, staff }. Без провайдера — текст пишется в журнал и консоль.
 * Ошибка провайдера пробрасывается (и тоже пишется в журнал).
 */
export async function sendSms(phone, text, meta = {}) {
  if (!phone) throw new HttpError(400, 'Нет номера телефона');
  let msg = String(text || '').trim();
  if (!msg) throw new HttpError(400, 'Пустое сообщение');
  if (getSetting('sms_translit', '1') === '1') msg = translit(msg);
  const to = e164(phone);
  const key = activeProvider();
  const row = { phone: to, customer_id: meta.customer_id || null, order_id: meta.order_id || null, kind: meta.kind || 'manual', text: msg, provider: key, staff: meta.staff || null };
  if (!key) {
    console.log(`[SMS → ${to}] ${msg}`);
    insert('sms_log', { ...row, status: 'logged', error: 'SMS-провайдер не подключён' });
    return { status: 'logged' };
  }
  try {
    const ext = await SENDERS[key](cfg(key) || {}, to, msg);
    insert('sms_log', { ...row, status: 'sent', ext_id: ext ? String(ext) : null });
    return { status: 'sent', provider: key };
  } catch (e) {
    insert('sms_log', { ...row, status: 'failed', error: e.message });
    ilog(key, 'error', e.message);
    throw new HttpError(502, e.message);
  }
}

// ── Проверка связи ─────────────────────────────────────────────────────────
export async function testSms() {
  const c = cfg('smsapi', { ignoreEnabled: true });
  if (!c?.token) throw new Error('Укажите токен');
  const r = await fetch(process.env.SMSAPI_PROFILE || 'https://api.smsapi.pl/profile', { headers: { Authorization: `Bearer ${c.token}` } });
  const b = await j(r);
  if (!r.ok) throw new Error('SMSAPI: токен не принят (' + r.status + ')');
  return `Аккаунт ${b.username || b.name || ''} · баланс ${b.points ?? '—'} pkt`;
}
export async function testSerwersms() {
  const c = cfg('serwersms', { ignoreEnabled: true });
  if (!c?.token) throw new Error('Укажите токен');
  const r = await fetch((process.env.SERWERSMS_BASE || 'https://api2.serwersms.pl') + '/account/limits.json', {
    method: 'POST', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' }, body: '{}',
  });
  const b = await j(r);
  if (!r.ok || b.error) throw new Error('SerwerSMS: токен не принят (' + (b.error?.message || r.status) + ')');
  const eco = (b.items || []).map((i) => `${i.type}: ${i.value}`).join(', ');
  return 'Связь есть' + (eco ? ' · ' + eco : '');
}
export async function testSmsplanet() {
  const c = cfg('smsplanet', { ignoreEnabled: true });
  if (!c?.token) throw new Error('Укажите токен');
  const r = await fetch((process.env.SMSPLANET_BASE || 'https://api2.smsplanet.pl') + '/getBalance', { method: 'POST', headers: { Authorization: 'Bearer ' + c.token } });
  const b = await j(r);
  if (!r.ok || b.errorMsg) throw new Error('SMSPLANET: ' + (b.errorMsg || r.status));
  return `Баланс: ${b.balance ?? '—'}`;
}
export async function testTwilio() {
  const c = cfg('twilio', { ignoreEnabled: true });
  if (!c?.sid || !c.token) throw new Error('Укажите Account SID и Auth Token');
  const r = await fetch(`${process.env.TWILIO_BASE || 'https://api.twilio.com'}/2010-04-01/Accounts/${encodeURIComponent(c.sid)}.json`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${c.sid}:${c.token}`).toString('base64') },
  });
  const b = await j(r);
  if (!r.ok) throw new Error('Twilio: ' + (b.message || r.status));
  return `Аккаунт ${b.friendly_name || c.sid} · ${b.status || ''}`;
}
export async function testSmsgate() {
  const c = cfg('smsgate', { ignoreEnabled: true });
  if (!c?.user || !c.pass) throw new Error('Укажите логин и пароль из приложения');
  const base = (c.url || 'https://api.sms-gate.app/3rdparty/v1').replace(/\/$/, '');
  // облако: список устройств; локальный режим: /health
  const isCloud = base.includes('/3rdparty/');
  const r = await fetch(base + (isCloud ? '/devices' : '/health'), { headers: { Authorization: 'Basic ' + Buffer.from(`${c.user}:${c.pass}`).toString('base64') } });
  const b = await j(r);
  if (!r.ok) throw new Error('SMS Gateway: ' + (r.status === 401 ? 'логин или пароль не приняты' : b.message || r.status));
  if (isCloud && Array.isArray(b)) return b.length ? `Телефонов подключено: ${b.length} (${b.map((d) => d.name).filter(Boolean).join(', ')})` : 'Вход есть, но телефон не подключён к облаку';
  return 'Телефон отвечает';
}
export async function testSmshttp() {
  const c = cfg('smshttp', { ignoreEnabled: true });
  if (!c?.url) throw new Error('Укажите адрес');
  if (!c.testPhone) throw new Error('Укажите номер для тестового SMS');
  await SENDERS.smshttp(c, e164(c.testPhone), 'Pulsecar: test SMS');
  return 'Тестовое SMS отправлено на ' + c.testPhone;
}
