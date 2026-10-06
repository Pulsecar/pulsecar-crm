// Уведомления команде: Telegram и вебхук
import crypto from 'node:crypto';
import { ilog, all, run } from '../db.js';
import { can } from '../perms.js';
import { cfg, setState } from './index.js';
import { curBranch, branchName, MAIN } from '../branches.js';

export async function telegramSend(text, c = cfg('telegram')) {
  if (!c?.botToken || !c.chatId) return false;
  const r = await fetch(`https://api.telegram.org/bot${c.botToken}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: c.chatId, text, disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error('Telegram: ' + r.status);
  return true;
}

/** Проверка Telegram: если ID чата пуст — берём последний чат, где писали боту */
export async function testTelegram() {
  const c = cfg('telegram', { ignoreEnabled: true });
  if (!c?.botToken) throw new Error('Укажите токен бота');
  const me = await fetch(`https://api.telegram.org/bot${c.botToken}/getMe`).then((r) => r.json());
  if (!me.ok) throw new Error('Токен бота неверный');
  let chatId = c.chatId;
  if (!chatId) {
    const up = await fetch(`https://api.telegram.org/bot${c.botToken}/getUpdates`).then((r) => r.json());
    const last = (up.result || []).reverse().find((u) => u.message?.chat?.id || u.my_chat_member?.chat?.id);
    chatId = last?.message?.chat?.id || last?.my_chat_member?.chat?.id;
    if (!chatId) throw new Error(`Бот @${me.result.username} работает. Добавьте его в чат, напишите любое сообщение и нажмите «Проверить» ещё раз.`);
  }
  await telegramSend('✅ Pulsecar CRM подключена к этому чату', { ...c, chatId });
  return { info: `@${me.result.username} → чат ${chatId}`, chatId: String(chatId) };
}

export async function webhookSend(event, data, c = cfg('webhook')) {
  if (!c?.url) return false;
  const body = JSON.stringify({ event, at: new Date().toISOString(), data });
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Pulsecar-CRM' };
  if (c.secret) headers['X-Pulsecar-Signature'] = crypto.createHmac('sha256', c.secret).update(body).digest('hex');
  const r = await fetch(c.url, { method: 'POST', headers, body });
  if (!r.ok) throw new Error('Вебхук: ' + r.status);
  return true;
}

/** Событие в CRM → Telegram (если событие выбрано) и вебхук. Ошибки не мешают работе. */
export function notify(event, text, data = {}) {
  // в филиале — с названием сервиса, чтобы в общем чате было видно, откуда событие
  if (curBranch() !== MAIN) { text = `[${branchName(curBranch())}] ${text}`; data = { ...data, branch: curBranch() }; }
  const t = cfg('telegram');
  if (t && (t.events || []).includes(event)) telegramSend(text, t).catch((e) => { ilog('telegram', 'error', e.message); setState('telegram', { lastError: e.message }); });
  if (cfg('webhook')) webhookSend(event, { text, ...data }).catch((e) => { ilog('webhook', 'error', e.message); setState('webhook', { lastError: e.message }); });
  pushEvent(event, text, data);
}

// ── Push-уведомления в мобильное приложение «Pulsecar CRM» (через сервис Expo Push) ──
const EVENT_PERM = { booking: 'calendar.view', status: 'orders.view', payment: 'orders.prices' };
const TITLE = { booking: 'Новая запись', status: 'Статус заказа', payment: 'Оплата', assigned: 'Вам назначен заказ' };
function devices(where, ...p) {
  try {
    return all(`SELECT d.id, d.push_token, d.events, s.id staff_id, s.role, s.permissions FROM mobile_devices d JOIN staff s ON s.id = d.staff_id
      WHERE d.push_token IS NOT NULL AND s.active = 1 AND ${where}`, ...p);
  } catch { return []; }
}
const wants = (d, ev) => { try { return JSON.parse(d.events || '[]').includes(ev); } catch { return false; } };
function pushEvent(event, text, data) {
  const list = devices('1=1').filter((d) => wants(d, event) && (!EVENT_PERM[event] || can(d, EVENT_PERM[event])));
  // в данных push — только номера (без телефонов и имён клиентов)
  const ref = Object.fromEntries(['order', 'order_id', 'appointment', 'branch'].filter((k) => data[k] != null).map((k) => [k, data[k]]));
  if (list.length) pushSend(list, TITLE[event] || 'Pulsecar CRM', text, { event, ...ref }).catch((e) => ilog('push', 'error', e.message));
}
/** Push конкретному сотруднику (например, ему назначили заказ) */
export function pushStaff(staffId, event, text, data = {}) {
  if (curBranch() !== MAIN) text = `[${branchName(curBranch())}] ${text}`;
  const list = devices('s.id = ?', staffId).filter((d) => wants(d, event));
  if (list.length) pushSend(list, TITLE[event] || 'Pulsecar CRM', text, { event, ...data }).catch((e) => ilog('push', 'error', e.message));
}
export async function pushSend(list, title, body, data) {
  for (let i = 0; i < list.length; i += 100) {
    const part = list.slice(i, i + 100);
    const r = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(part.map((d) => ({ to: d.push_token, title, body: String(body).replace(/\+?\d[\d\s-]{7,}\d/g, '•••').slice(0, 400), data, sound: 'default', channelId: 'default', priority: 'high' }))),
    });
    if (!r.ok) throw new Error('Expo push: ' + r.status);
    const j = await r.json();
    // приложение удалено / уведомления выключены — токен больше не действует
    (j.data || []).forEach((x, k) => { if (x?.details?.error === 'DeviceNotRegistered') run('UPDATE mobile_devices SET push_token = NULL WHERE id = ?', part[k].id); });
  }
}
