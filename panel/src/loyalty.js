import crypto from 'node:crypto';
import { all, one, run, tx } from './db.js';
import { config } from './config.js';
import { HttpError, randomHex, normPhone } from './util.js';

const L = config.loyalty;
const round2 = (n) => Math.round(n * 100) / 100;

// ── Баланс и уровень ────────────────────────────────────────────────────────
export const balanceOf = (customerId) =>
  one('SELECT COALESCE(SUM(points),0) AS b FROM transactions WHERE customer_id = ?', customerId).b;

export const spend12m = (customerId) =>
  one(
    `SELECT COALESCE(SUM(amount_pln),0) AS s FROM transactions
     WHERE customer_id = ? AND type = 'earn' AND created_at >= datetime('now','-365 days')`,
    customerId,
  ).s;

export function tierFor(spend) {
  const tiers = [...L.tiers].sort((a, b) => a.from - b.from);
  const cur = [...tiers].reverse().find((t) => spend >= t.from) ?? tiers[0];
  const next = tiers.find((t) => t.from > spend) ?? null;
  return { tier: cur, next };
}

export function loyaltySummary(customerId) {
  const balance = balanceOf(customerId);
  const spend = round2(spend12m(customerId));
  const { tier, next } = tierFor(spend);
  return {
    name: L.name,
    balance,
    valuePln: round2(balance * L.pointValuePln),
    spend12m: spend,
    tier: { id: tier.id, name: tier.name, rate: tier.rate },
    next: next ? { id: next.id, name: next.name, rate: next.rate, from: next.from, remaining: round2(next.from - spend) } : null,
    rules: {
      tiers: L.tiers.map(({ id, name, from, rate }) => ({ id, name, from, rate })),
      pointValuePln: L.pointValuePln,
      minRedeem: L.minRedeem,
      maxRedeemShare: L.maxRedeemShare,
      welcomeBonus: L.welcomeBonus,
    },
  };
}

export function welcomeBonus(customerId) {
  // бонус выдаётся один раз на клиента (даже если он удалит аккаунт и зарегистрируется снова)
  if (L.welcomeBonus > 0 && !one('SELECT welcome_given FROM customers WHERE id = ?', customerId).welcome_given) {
    run(`INSERT INTO transactions (customer_id, type, points, source, note) VALUES (?, 'bonus', ?, 'app', 'welcome')`, customerId, L.welcomeBonus);
    run('UPDATE customers SET welcome_given = 1 WHERE id = ?', customerId);
  }
}

// ── QR-код: подпись HMAC-SHA256, меняется каждые 30 с (как TOTP) ─────────────
// Формат: PCQ1.<номер карты>.<шаг времени>.<подпись 16 hex>
// Секрет выдаётся телефону при входе и хранится только на нём и на сервере,
// поэтому QR работает даже без интернета, а старый скриншот через минуту бесполезен.
export const qrStep = (ms = Date.now()) => Math.floor(ms / 1000 / config.qr.stepSeconds);
const mac = (secret, cardNo, step) => crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${cardNo}.${step}`).digest('hex');
export const qrSig = (secret, cardNo, step) => mac(secret, cardNo, step).slice(0, 16);
export const qrCode6 = (secret, cardNo, step) => String(parseInt(mac(secret, cardNo, step).slice(-8), 16) % 1_000_000).padStart(6, '0');

function activeSecrets(customerId) {
  return all('SELECT qr_secret FROM sessions WHERE customer_id = ? AND revoked = 0', customerId).map((r) => r.qr_secret);
}

function consumeStep(cardNo, step) {
  try {
    run('INSERT INTO used_qr (card_no, step) VALUES (?, ?)', cardNo, step);
  } catch {
    throw new HttpError(409, 'Этот код уже использован. Попросите клиента показать новый QR (обновляется каждые 30 секунд).');
  }
}

/** Проверка отсканированного QR. Возвращает клиента. */
export function verifyQrPayload(text) {
  const m = String(text || '').trim().match(/^PCQ1\.(PC\d{8})\.(\d+)\.([0-9a-f]{16})$/);
  if (!m) throw new HttpError(400, 'Это не QR-код Pulsecar.');
  const [, cardNo, stepStr, sig] = m;
  const step = Number(stepStr);
  const customer = one('SELECT * FROM customers WHERE card_no = ?', cardNo);
  if (!customer) throw new HttpError(404, 'Карта не найдена.');
  if (Math.abs(qrStep() - step) > config.qr.window)
    throw new HttpError(410, 'QR устарел. Попросите клиента открыть карту заново (проверьте время на телефоне клиента).');
  const ok = activeSecrets(customer.id).some((s) => crypto.timingSafeEqual(Buffer.from(qrSig(s, cardNo, step)), Buffer.from(sig)));
  if (!ok) throw new HttpError(403, 'Подпись QR неверна — код поддельный или клиент вышел из приложения.');
  consumeStep(cardNo, step);
  return customer;
}

/** Ручной ввод: телефон или номер карты + 6 цифр под QR */
export function verifyManual(who, code) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) throw new HttpError(400, 'Код — 6 цифр под QR в приложении клиента.');
  const w = String(who || '').trim().toUpperCase();
  const customer = /^PC\d{8}$/.test(w)
    ? one('SELECT * FROM customers WHERE card_no = ?', w)
    : one('SELECT * FROM customers WHERE phone = ?', normPhone(who));
  if (!customer) throw new HttpError(404, 'Клиент не найден.');
  const now = qrStep();
  for (let st = now - config.qr.window; st <= now + config.qr.window; st++) {
    for (const s of activeSecrets(customer.id)) {
      if (qrCode6(s, customer.card_no, st) === c) {
        consumeStep(customer.card_no, st);
        return customer;
      }
    }
  }
  throw new HttpError(403, 'Код не подходит или устарел.');
}

// ── Тикет: после сканирования у кассира есть 10 минут, чтобы провести оплату ──
const tickets = new Map();
export function issueTicket(customerId, staff) {
  const id = randomHex(16);
  tickets.set(id, { customerId, staff, exp: Date.now() + config.qr.ticketMinutes * 60_000 });
  for (const [k, v] of tickets) if (v.exp < Date.now()) tickets.delete(k);
  return id;
}

/** Расчёт до подтверждения (для экрана кассира) */
export function quote(customerId, orderTotal, redeemPoints = 0) {
  const s = loyaltySummary(customerId);
  const maxByShare = Math.floor((orderTotal * L.maxRedeemShare) / L.pointValuePln);
  const maxRedeem = s.balance >= L.minRedeem ? Math.min(s.balance, maxByShare) : 0;
  const redeem = Math.max(0, Math.floor(redeemPoints || 0));
  const discount = round2(redeem * L.pointValuePln);
  const paid = round2(orderTotal - discount);
  const earn = Math.floor(paid * s.tier.rate);
  return { balance: s.balance, tier: s.tier, maxRedeem, redeem, discount, paid, earn, balanceAfter: s.balance - redeem + earn };
}

/** Оплата: списание баллов (по желанию клиента) + начисление за оплаченную сумму */
export function checkout({ ticket, orderTotal, orderNo, redeemPoints }, staffName) {
  const t = tickets.get(ticket);
  if (!t || t.exp < Date.now()) throw new HttpError(410, 'Сканирование устарело — отсканируйте QR ещё раз.');
  const total = Number(orderTotal);
  if (!(total > 0) || total > 1_000_000) throw new HttpError(400, 'Укажите сумму заказа.');
  const order = String(orderNo || '').trim();
  if (L.autoEarnFromCrm && !order) throw new HttpError(400, 'Укажите номер заказа из CRM — по нему баллы не начислятся повторно при выгрузке.');
  if (order && one(`SELECT 1 FROM transactions WHERE type = 'earn' AND order_no = ?`, order))
    throw new HttpError(409, `За заказ ${order} баллы уже начислены.`);

  const q = quote(t.customerId, total, redeemPoints);
  if (q.redeem > 0) {
    if (q.redeem < L.minRedeem) throw new HttpError(400, `Списать можно от ${L.minRedeem} баллов.`);
    if (q.redeem > q.maxRedeem) throw new HttpError(400, `Максимум к списанию: ${q.maxRedeem} баллов.`);
  }

  tx(() => {
    if (q.redeem > 0)
      run(
        `INSERT INTO transactions (customer_id, type, points, amount_pln, order_no, source, staff) VALUES (?, 'redeem', ?, ?, ?, 'scan', ?)`,
        t.customerId, -q.redeem, q.discount, order || null, staffName,
      );
    run(
      `INSERT INTO transactions (customer_id, type, points, amount_pln, order_no, source, staff) VALUES (?, 'earn', ?, ?, ?, 'scan', ?)`,
      t.customerId, q.earn, q.paid, order || null, staffName,
    );
  });
  tickets.delete(ticket);
  return { ...q, balanceAfter: balanceOf(t.customerId) };
}

/** Начисление по выгрузке CRM за заказы, которые не прошли через сканер */
export function earnFromCrm(customerId, orderNo, total, date) {
  if (!L.autoEarnFromCrm || !(total > 0)) return 0;
  if (one(`SELECT 1 FROM transactions WHERE type = 'earn' AND order_no = ?`, orderNo)) return 0;
  const c = one('SELECT registered_at FROM customers WHERE id = ?', customerId);
  if (!c?.registered_at || (date && date < c.registered_at.slice(0, 10))) return 0; // только заказы после регистрации
  const { tier } = tierFor(spend12m(customerId));
  const pts = Math.floor(total * tier.rate);
  run(
    `INSERT INTO transactions (customer_id, type, points, amount_pln, order_no, source, note) VALUES (?, 'earn', ?, ?, ?, 'crm', ?)`,
    customerId, pts, total, orderNo, date ? `заказ от ${date}` : null,
  );
  return pts;
}

// ── Баллы внутри заказа CRM ────────────────────────────────────────────────
export function getTicket(ticket) {
  const t = tickets.get(ticket);
  if (!t || t.exp < Date.now()) throw new HttpError(410, 'Сканирование устарело — отсканируйте QR ещё раз.');
  return t;
}

/** Сколько баллов можно списать в этом заказе */
export function redeemLimits(customerId, orderTotal, alreadyRedeemedPln = 0) {
  const s = loyaltySummary(customerId);
  const maxPln = Math.max(0, orderTotal * L.maxRedeemShare - alreadyRedeemedPln);
  const maxByShare = Math.floor(maxPln / L.pointValuePln);
  const max = s.balance >= L.minRedeem ? Math.min(s.balance, maxByShare) : 0;
  return { balance: s.balance, max, min: L.minRedeem, pointValuePln: L.pointValuePln, tier: s.tier };
}

/** Списание баллов в оплату заказа (только после скана QR / кода клиента) */
export function redeemForOrder(ticketId, order, points, staffName) {
  const t = getTicket(ticketId);
  if (order.customer_id && t.customerId !== order.customer_id)
    throw new HttpError(409, 'QR принадлежит другому клиенту, не владельцу заказа.');
  const pts = Math.floor(Number(points) || 0);
  const already = one(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE order_id = ? AND method = 'points'`, order.id).s;
  const lim = redeemLimits(t.customerId, order.total, already);
  if (pts < L.minRedeem) throw new HttpError(400, `Списать можно от ${L.minRedeem} баллов.`);
  if (pts > lim.max) throw new HttpError(400, `Максимум к списанию: ${lim.max} баллов.`);
  const pln = round2(pts * L.pointValuePln);
  tx(() => {
    run(`INSERT INTO transactions (customer_id, type, points, amount_pln, order_no, source, staff) VALUES (?, 'redeem', ?, ?, ?, 'order', ?)`,
      t.customerId, -pts, pln, order.number, staffName);
    run(`INSERT INTO payments (direction, method, amount, order_id, customer_id, note, staff) VALUES ('in', 'points', ?, ?, ?, ?, ?)`,
      pln, order.id, t.customerId, `${pts} баллов Pulse Points`, staffName);
  });
  tickets.delete(ticketId);
  return { points: pts, pln };
}

/** Начисление при завершении заказа — клиентам, зарегистрированным в приложении.
 *  Считается от суммы, оплаченной деньгами (без части, оплаченной баллами). */
export function earnForOrder(order) {
  if (!order.customer_id || !(order.total > 0)) return 0;
  if (one(`SELECT 1 FROM transactions WHERE type = 'earn' AND order_no = ?`, order.number)) return 0;
  const c = one('SELECT registered_at FROM customers WHERE id = ?', order.customer_id);
  if (!c?.registered_at) return 0;
  const byPoints = one(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE order_id = ? AND method = 'points'`, order.id).s;
  const paidMoney = round2(order.total - byPoints);
  if (paidMoney <= 0) return 0;
  const { tier } = tierFor(spend12m(order.customer_id));
  const pts = Math.floor(paidMoney * tier.rate);
  run(`INSERT INTO transactions (customer_id, type, points, amount_pln, order_no, source) VALUES (?, 'earn', ?, ?, ?, 'order')`,
    order.customer_id, pts, paidMoney, order.number);
  return pts;
}
