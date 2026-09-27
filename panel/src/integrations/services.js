// Почта (SMTP), онлайн-оплата Tpay, расшифровка VIN, календарь iCal
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { all, one, run, ilog } from '../db.js';
import { HttpError, round2 } from '../util.js';
import { cfg, getState, setState } from './index.js';

// ── E-mail ─────────────────────────────────────────────────────────────────
function transport(c) {
  return nodemailer.createTransport({ host: c.host, port: Number(c.port) || 465, secure: Number(c.port) === 465, auth: { user: c.user, pass: c.pass } });
}
export async function sendMail({ to, subject, html, attachments }) {
  const c = cfg('email');
  if (!c) throw new HttpError(400, 'Почта не подключена: Настройки → Интеграции → Почта (SMTP).');
  if (!to) throw new HttpError(400, 'У клиента нет e-mail');
  await transport(c).sendMail({ from: c.from || c.user, to, subject, html, attachments });
  ilog('email', 'info', `→ ${to}: ${subject}`);
}
export async function testEmail() {
  const c = cfg('email', { ignoreEnabled: true });
  if (!c?.host || !c.user || !c.pass) throw new Error('Заполните сервер, логин и пароль');
  await transport(c).verify();
  return `Вход на ${c.host} успешен`;
}

// ── Tpay Open API ──────────────────────────────────────────────────────────
const tpayBase = (c) => process.env.TPAY_BASE || (c.sandbox ? 'https://openapi.sandbox.tpay.com' : 'https://openapi.tpay.com');
async function tpayToken(c) {
  const st = getState('tpay');
  if (st.token && st.tokenExp > Date.now() + 60_000 && st.tokenFor === c.clientId + c.sandbox) return st.token;
  const r = await fetch(tpayBase(c) + '/oauth/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new HttpError(502, 'Tpay: не удалось войти — проверьте Client ID/Secret' + (c.sandbox ? ' (Sandbox)' : ''));
  setState('tpay', { token: j.access_token, tokenExp: Date.now() + (Number(j.expires_in) || 7200) * 1000, tokenFor: c.clientId + c.sandbox });
  return j.access_token;
}
async function tpay(path, opts = {}) {
  const c = cfg('tpay');
  if (!c) throw new HttpError(400, 'Tpay не подключён: Настройки → Интеграции → Tpay.');
  const t = await tpayToken(c);
  const r = await fetch(tpayBase(c) + path, {
    method: opts.body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, 'Tpay: ' + (j.errors?.[0]?.errorMessage || r.status));
  return j;
}
export async function testTpay() {
  const c = cfg('tpay', { ignoreEnabled: true });
  if (!c?.clientId || !c.clientSecret) throw new Error('Заполните Client ID и Secret');
  await tpayToken(c);
  return c.sandbox ? 'Вход в Tpay Sandbox успешен' : 'Вход в Tpay успешен';
}
/** Ссылка на оплату остатка по заказу */
export async function createPayLink(order, customer, publicUrl) {
  const due = round2(order.total - order.paid);
  if (!(due > 0)) throw new HttpError(400, 'По заказу нечего оплачивать');
  const j = await tpay('/transactions', {
    body: {
      amount: due,
      description: `Pulsecar — zlecenie ${order.number}`,
      hiddenDescription: `order:${order.id}`,
      lang: 'pl',
      payer: { email: customer?.email || 'admin@pulsecar.pl', name: customer?.name || customer?.company || 'Klient Pulsecar', ...(customer?.phone ? { phone: customer.phone } : {}) },
      callbacks: {
        payerUrls: { success: 'https://pulsecar.pl', error: 'https://pulsecar.pl' },
        notification: { url: `${publicUrl}/hooks/tpay` },
      },
    },
  });
  run('UPDATE orders SET pay_link = ?, pay_ext_id = ? WHERE id = ?', j.transactionPaymentUrl, j.transactionId, order.id);
  return { url: j.transactionPaymentUrl, id: j.transactionId, amount: due };
}
/** Статус платежа из Tpay (уведомлению не доверяем — всегда перепроверяем через API) */
export async function checkPayment(order) {
  if (!order.pay_ext_id) return { status: 'none' };
  const j = await tpay('/transactions/' + encodeURIComponent(order.pay_ext_id));
  const paid = ['correct', 'paid', 'success'].includes(String(j.status).toLowerCase());
  const amount = round2(j.amountPaid ?? j.amount);
  if (paid && !one(`SELECT 1 FROM payments WHERE order_id = ? AND note LIKE ?`, order.id, `%${order.pay_ext_id}%`)) {
    run(`INSERT INTO payments (direction, method, amount, order_id, customer_id, note, staff) VALUES ('in', 'transfer', ?, ?, ?, ?, 'Tpay')`,
      amount, order.id, order.customer_id, `Онлайн-оплата Tpay ${order.pay_ext_id}`);
    return { status: 'paid', amount, justPaid: true };
  }
  return { status: paid ? 'paid' : String(j.status || 'pending'), amount };
}

// ── VIN ────────────────────────────────────────────────────────────────────
export async function decodeVin(vin) {
  const v = String(vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (v.length !== 17) throw new HttpError(400, 'VIN — 17 символов');
  const c = cfg('vin', { ignoreEnabled: true }) || {};
  if (c.vindecoderKey && c.vindecoderSecret) {
    const sum = crypto.createHash('sha1').update(`${v}|decode|${c.vindecoderKey}|${c.vindecoderSecret}`).digest('hex').slice(0, 10);
    const r = await fetch(`https://api.vindecoder.eu/3.2/${c.vindecoderKey}/${sum}/decode/${v}.json`);
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.decode) {
      const g = (label) => j.decode.find((x) => x.label === label)?.value;
      return { source: 'vindecoder.eu', make: g('Make'), model: g('Model'), year: g('Model Year'), capacity: g('Engine Displacement (ccm)'), power_kw: g('Engine Power (kW)'), fuel: g('Fuel Type - Primary'), engine: g('Engine Code') };
    }
  }
  const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${v}?format=json`);
  const x = (await r.json().catch(() => ({})))?.Results?.[0] || {};
  if (!x.Make) throw new HttpError(404, 'Бесплатная база не знает этот VIN. Для европейских авто подключите vindecoder.eu в интеграциях.');
  return {
    source: 'NHTSA', make: x.Make ? x.Make[0] + x.Make.slice(1).toLowerCase() : null, model: x.Model || null, year: x.ModelYear || null,
    capacity: x.DisplacementCC ? Math.round(Number(x.DisplacementCC)) : null, power_kw: x.EngineKW ? Math.round(Number(x.EngineKW)) : null,
    fuel: x.FuelTypePrimary || null, engine: x.EngineModel || null,
  };
}

// ── Календарь iCal (подписка для Google / iPhone) ───────────────────────────
export function ensureFeedToken() {
  let c = cfg('calendar', { ignoreEnabled: true }) || {};
  if (!c.feedToken) {
    const row = one(`SELECT config FROM integrations WHERE key = 'calendar'`);
    const cur = row ? JSON.parse(row.config) : {};
    cur.feedToken = crypto.randomBytes(18).toString('base64url');
    run(`INSERT INTO integrations (key, enabled, config) VALUES ('calendar', ?, ?) ON CONFLICT(key) DO UPDATE SET config = excluded.config`, row ? 0 : 0, JSON.stringify(cur));
    c = cur;
  }
  return c.feedToken;
}
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);
export function icalFeed(token, stationId) {
  const c = cfg('calendar');
  if (!c || !c.feedToken || token !== c.feedToken) return null;
  const rows = all(`SELECT a.*, st.name station, c.name cname, c.phone cphone, k.make, k.model, k.plate, o.number
    FROM appointments a LEFT JOIN stations st ON st.id = a.station_id LEFT JOIN customers c ON c.id = a.customer_id
    LEFT JOIN cars k ON k.id = a.car_id LEFT JOIN orders o ON o.id = a.order_id
    WHERE a.start_at IS NOT NULL AND a.status NOT IN ('cancelled') AND a.start_at >= datetime('now','-30 days') ${stationId ? 'AND a.station_id = ?' : ''}
    ORDER BY a.start_at LIMIT 2000`, ...(stationId ? [stationId] : []));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pulsecar//CRM//PL', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Pulsecar' + (stationId && rows[0] ? ' — ' + rows[0].station : ''),
    'X-WR-TIMEZONE:Europe/Warsaw',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Warsaw', 'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'END:STANDARD',
    'BEGIN:DAYLIGHT', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'END:DAYLIGHT', 'END:VTIMEZONE'];
  for (const a of rows) {
    const start = new Date(a.start_at.replace(' ', 'T') + ':00');
    const end = new Date(start.getTime() + a.duration_min * 60000);
    const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
    const who = a.cname || a.contact_name || '';
    const car = [a.make, a.model, a.plate].filter(Boolean).join(' ');
    lines.push('BEGIN:VEVENT', `UID:appt-${a.id}@pulsecar`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART;TZID=Europe/Warsaw:${fmt(start)}`, `DTEND;TZID=Europe/Warsaw:${fmt(end)}`,
      `SUMMARY:${icsEsc([a.station, who, car].filter(Boolean).join(' · '))}`,
      `DESCRIPTION:${icsEsc([a.title, a.note, a.number && 'Заказ ' + a.number, a.cphone || a.contact_phone].filter(Boolean).join('\n'))}`,
      `LOCATION:${icsEsc(a.station || '')}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
