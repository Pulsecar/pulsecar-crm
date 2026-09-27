// Уведомления команде: Telegram и вебхук
import crypto from 'node:crypto';
import { ilog } from '../db.js';
import { cfg, setState } from './index.js';

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
  const t = cfg('telegram');
  if (t && (t.events || []).includes(event)) telegramSend(text, t).catch((e) => { ilog('telegram', 'error', e.message); setState('telegram', { lastError: e.message }); });
  if (cfg('webhook')) webhookSend(event, { text, ...data }).catch((e) => { ilog('webhook', 'error', e.message); setState('webhook', { lastError: e.message }); });
}
