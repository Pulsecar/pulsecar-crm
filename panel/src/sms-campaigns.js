// SMS-рассылки (сезонные акции): только тем, кто дал согласие — подписчики напоминаний с сайта
// и клиенты CRM с отметкой «согласие на маркетинг». В каждой SMS ссылка для отписки.
// Отправка — сразу или по расписанию (фоновые задачи), с 9:00 до 20:00, по одной SMS с паузой.
import { all, one, run, insert, ilog } from './db.js';
import { sendSms } from './sms.js';
import { notify } from './integrations/notify.js';
import { randomHex, normPhone } from './util.js';
import { localShift } from './integrations/jobs.js';

export const AUDIENCES = {
  site: 'Подписчики напоминаний с сайта',
  consent: 'Клиенты CRM с согласием на маркетинг',
  both: 'Все с согласием (без повторов)',
};

/** Получатели: [{ phone, name, kind: 'site'|'customer', ref }] — без повторов по номеру */
export function audience(kind) {
  const out = new Map();
  if (kind === 'site' || kind === 'both') {
    for (const r of all('SELECT id, phone, name, token FROM site_reminders WHERE active = 1')) {
      const p = normPhone(r.phone);
      if (p && !out.has(p)) out.set(p, { phone: p, name: r.name || '', kind: 'site', ref: r.token });
    }
  }
  if (kind === 'consent' || kind === 'both') {
    for (const c of all(`SELECT id, phone, name, company, kind FROM customers WHERE marketing_consent = 1 AND phone IS NOT NULL AND TRIM(phone) <> ''`)) {
      const p = normPhone(c.phone);
      if (p && !out.has(p)) out.set(p, { phone: p, name: c.kind === 'company' ? '' : c.name || '', kind: 'customer', ref: String(c.id) });
    }
  }
  return [...out.values()];
}

/** Ссылка отписки: у подписчиков сайта — их токен, у клиентов CRM — отдельный токен (sms_stop) */
function stopToken(r) {
  if (r.kind === 'site') return r.ref;
  const ex = one('SELECT token FROM sms_stop WHERE customer_id = ?', Number(r.ref));
  if (ex) return ex.token;
  const token = randomHex(8);
  insert('sms_stop', { token, customer_id: Number(r.ref), phone: r.phone });
  return token;
}

export function render(text, r, base) {
  const first = String(r.name || '').trim().split(/\s+/)[0] || '';
  let t = String(text).replace(/\{imie\}|\{имя\}|\{name\}/gi, first).replace(/\s+([,.!?])/g, '$1').replace(/ {2,}/g, ' ').trim();
  return `${t} STOP: ${base}/r/${stopToken(r)}`;
}

/** Отписка по токену из SMS-рассылки (клиент CRM): снимаем согласие на маркетинг */
export function stopByToken(token) {
  const r = one('SELECT * FROM sms_stop WHERE token = ?', String(token || ''));
  if (!r) return false;
  run('UPDATE customers SET marketing_consent = 0 WHERE id = ?', r.customer_id);
  run('UPDATE site_reminders SET active = 0 WHERE phone = ?', r.phone);
  return true;
}

let running = false;
/** Отправить кампанию (в фоне). Повторный вызов для уже отправленной ничего не делает. */
export async function sendCampaign(id, base) {
  const c = one('SELECT * FROM sms_campaigns WHERE id = ?', id);
  if (!c || !['scheduled', 'sending'].includes(c.status) || running) return;
  running = true;
  try {
    run(`UPDATE sms_campaigns SET status = 'sending', started_at = datetime('now') WHERE id = ?`, id);
    const done = new Set(all('SELECT phone FROM sms_campaign_log WHERE campaign_id = ?', id).map((x) => x.phone));
    let sent = c.sent_count || 0; let failed = c.failed_count || 0;
    for (const r of audience(c.audience)) {
      if (done.has(r.phone)) continue;
      if (one('SELECT status FROM sms_campaigns WHERE id = ?', id)?.status === 'cancelled') break;
      const text = render(c.text, r, base);
      try {
        await sendSms(r.phone, text, { kind: 'campaign', customer_id: r.kind === 'customer' ? Number(r.ref) : null });
        insert('sms_campaign_log', { campaign_id: id, phone: r.phone, status: 'sent' }); sent++;
      } catch (e) {
        insert('sms_campaign_log', { campaign_id: id, phone: r.phone, status: 'failed', error: String(e.message || e).slice(0, 200) }); failed++;
      }
      run('UPDATE sms_campaigns SET sent_count = ?, failed_count = ? WHERE id = ?', sent, failed, id);
      if (process.env.NODE_ENV !== 'test') await new Promise((res) => setTimeout(res, 400));
    }
    if (one('SELECT status FROM sms_campaigns WHERE id = ?', id)?.status !== 'cancelled') {
      run(`UPDATE sms_campaigns SET status = 'sent', sent_at = datetime('now') WHERE id = ?`, id);
      notify('booking', `📣 SMS-рассылка «${c.title}» отправлена: ${sent}${failed ? `, ошибок: ${failed}` : ''}`);
    }
  } catch (e) {
    ilog('sms', 'error', 'Рассылка: ' + e.message);
  } finally { running = false; }
}

/** Из фоновых задач: запустить запланированные кампании, у которых подошло время (9:00–20:00) */
export function runDueCampaigns(base, hour) {
  if (!(hour >= 9 && hour < 20) && process.env.NODE_ENV !== 'test') return;
  const now = localShift(0);
  const c = one(`SELECT id FROM sms_campaigns WHERE status IN ('scheduled', 'sending') AND (scheduled_at IS NULL OR scheduled_at <= ?) ORDER BY id LIMIT 1`, now);
  if (c) sendCampaign(c.id, base);
}
