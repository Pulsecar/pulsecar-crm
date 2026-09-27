// Фоновые задачи интеграций: напоминания о визите, просьба об отзыве, проверка онлайн-оплат, мало на складе
import { startKsefPoller } from './ksef.js';
import { all, one, run, ilog, getSetting, setSetting } from '../db.js';
import { cfg } from './index.js';
import { sendSms } from '../sms.js';
import { checkPayment } from './services.js';
import { notify } from './notify.js';
import { recalc } from '../orders.js';
import { render, orderContext } from '../messaging.js';
import { startIntercarsSync } from './intercars.js';
import { startSupplierSync } from './suppliers.js';

const warsaw = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, stamp: localShift(0) };
};
/** Время по Варшаве через N минут в формате 'YYYY-MM-DD HH:MM' (как start_at в терминарзе) */
export function localShift(min) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(Date.now() + min * 60_000)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}`;
}

export async function runJobs() {
  const now = warsaw();
  const S = (k, d) => getSetting(k, d);

  // 1. Напоминание о визите за N часов (как в Motowarsztat — за сутки, в то же время)
  if (S('sms_remind_on', '1') === '1' && S('sms_tpl_reminder')) {
    const hours = Number(S('sms_remind_hours', '24')) || 24;
    const until = localShift(hours * 60);
    for (const a of all(`SELECT a.*, c.phone FROM appointments a LEFT JOIN customers c ON c.id = a.customer_id
        WHERE a.status = 'planned' AND a.reminded = 0 AND a.start_at IS NOT NULL AND a.start_at > ? AND a.start_at <= ?
        AND a.created_at <= datetime('now', ?)`, now.stamp, until, process.env.NODE_ENV === 'test' ? '+1 minute' : '-30 minutes')) {
      const phone = a.phone || a.contact_phone;
      run('UPDATE appointments SET reminded = 1 WHERE id = ?', a.id);
      if (!phone) continue;
      const text = render(S('sms_tpl_reminder'), orderContext(a.order_id, { appointment: a }));
      sendSms(phone, text, { kind: 'reminder', customer_id: a.customer_id, order_id: a.order_id })
        .catch((e) => ilog('sms', 'error', 'Напоминание: ' + e.message));
    }
  }

  // 2. Отдельная просьба об отзыве через 2 часа после завершения (если не отправляется в SMS статуса), 9:00–20:00
  if (S('sms_review_delayed', '0') === '1' && S('sms_tpl_review') && now.hour >= 9 && now.hour < 20) {
    for (const o of all(`SELECT o.id, o.customer_id, c.phone, c.marketing_consent FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.kind = 'order' AND o.review_sent = 0 AND o.source <> 'import' AND o.closed_at IS NOT NULL
        AND o.closed_at <= datetime('now','-2 hours') AND o.closed_at >= datetime('now','-3 days')`)) {
      run('UPDATE orders SET review_sent = 1 WHERE id = ?', o.id);
      if (!o.phone || !o.marketing_consent) continue;
      sendSms(o.phone, render(S('sms_tpl_review'), orderContext(o.id)), { kind: 'review', customer_id: o.customer_id, order_id: o.id })
        .catch((e) => ilog('sms', 'error', 'Отзыв: ' + e.message));
    }
  }

  // 3. Онлайн-оплаты Tpay, по которым ещё нет денег
  if (cfg('tpay')) {
    for (const o of all(`SELECT * FROM orders WHERE pay_ext_id IS NOT NULL AND paid < total - 0.01 AND created_at >= datetime('now','-30 days')`)) {
      try {
        const r = await checkPayment(o);
        if (r.justPaid) { recalc(o.id); notify('payment', `Онлайн-оплата ${o.number}: ${r.amount} zł`, { order: o.number, amount: r.amount }); }
      } catch (e) { ilog('tpay', 'error', e.message); }
    }
  }

  // 4. Раз в день — что заканчивается на складе
  if (now.hour >= 8 && getSetting('low_stock_notified') !== now.date) {
    setSetting('low_stock_notified', now.date);
    const low = all('SELECT name, stock, min_stock FROM products WHERE active = 1 AND min_stock > 0 AND stock <= min_stock LIMIT 30');
    if (low.length) notify('stock', `Заканчивается на складе (${low.length}):\n` + low.map((p) => `• ${p.name}: ${p.stock}`).join('\n'));
  }
}

export function startJobs() {
  startIntercarsSync();
  startSupplierSync();
  startKsefPoller();
  setInterval(() => runJobs().catch((e) => console.error('jobs:', e.message)), 10 * 60_000);
  setTimeout(() => runJobs().catch(() => {}), 20_000);
}
