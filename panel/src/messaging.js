// Шаблоны SMS/e-mail с полями как в Motowarsztat: [[pojazd.marka]], [[zlecenie.kartaZlecenia]] и т. д.
import crypto from 'node:crypto';
import { all, one, run, getSetting } from './db.js';
import { config } from './config.js';
import { HttpError } from './util.js';

/** Список полей для подсказки в настройках */
export const FIELDS = [
  ['klient.imie', 'Имя клиента'], ['klient.nazwa', 'Имя / фирма клиента'], ['klient.telefon', 'Телефон клиента'],
  ['pojazd.marka', 'Марка'], ['pojazd.model', 'Модель'], ['pojazd.nrRejestracyjny', 'Номер'], ['pojazd.rejestracja', 'Номер (то же)'], ['pojazd.vin', 'VIN'],
  ['zlecenie.numer', 'Номер заказа'], ['zlecenie.dataPrzyjecia', 'Дата приёма / визита'], ['zlecenie.godzinaPrzyjecia', 'Время приёма / визита'],
  ['zlecenie.dataOdbioru', 'Дата выдачи'], ['zlecenie.przebieg', 'Пробег'], ['zlecenie.status', 'Статус (для клиента)'],
  ['zlecenie.kwota', 'Сумма брутто'], ['zlecenie.doZaplaty', 'К оплате'], ['zlecenie.kartaZlecenia', 'Ссылка на электронную карту заказа'],
  ['wycena.link', 'Ссылка на смету'], ['link.platnosc', 'Ссылка на онлайн-оплату'], ['link.opinia', 'Ссылка на отзыв Google'],
  ['firma.nazwa', 'Название сервиса'], ['firma.telefon', 'Телефон сервиса'], ['firma.adres', 'Адрес сервиса'],
];

const zl = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',');
const S = () => Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));

/** Постоянная ссылка на электронную карту заказа / сметы */
export function cardToken(orderId) {
  const o = one('SELECT card_token FROM orders WHERE id = ?', orderId);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  if (o.card_token) return o.card_token;
  const t = crypto.randomBytes(9).toString('base64url');
  run('UPDATE orders SET card_token = ? WHERE id = ?', t, orderId);
  return t;
}
export const cardUrl = (orderId) => `${config.publicUrl.replace(/\/$/, '')}/k/${cardToken(orderId)}`;

/** Данные для шаблона по заказу (и/или записи в терминарзе) */
export function orderContext(orderId, { appointment } = {}) {
  const s = S();
  const o = orderId ? one('SELECT * FROM orders WHERE id = ?', orderId) : null;
  const c = (o?.customer_id || appointment?.customer_id) ? one('SELECT * FROM customers WHERE id = ?', o?.customer_id || appointment.customer_id) : null;
  const car = (o?.car_id || appointment?.car_id) ? one('SELECT * FROM cars WHERE id = ?', o?.car_id || appointment.car_id) : null;
  const st = o?.status_id ? one('SELECT * FROM order_statuses WHERE id = ?', o.status_id) : null;
  const ap = appointment || (o ? one(`SELECT * FROM appointments WHERE order_id = ? AND status <> 'cancelled' ORDER BY start_at LIMIT 1`, o.id) : null);
  const when = ap?.start_at || o?.created_at || '';
  const plate = car?.plate || appointment?.plate || '';
  const firstName = String(c?.name || appointment?.contact_name || '').trim().split(/\s+/)[0] || '';
  const lazy = {}; // ссылки создаём только если они есть в шаблоне
  return {
    'klient.imie': firstName, 'klient.nazwa': c?.company || c?.name || appointment?.contact_name || '', 'klient.telefon': c?.phone || appointment?.contact_phone || '',
    'pojazd.marka': car?.make || '', 'pojazd.model': car?.model || '', 'pojazd.nrRejestracyjny': plate, 'pojazd.rejestracja': plate, 'pojazd.vin': car?.vin || '',
    'zlecenie.numer': o?.number || '', 'zlecenie.dataPrzyjecia': when.slice(0, 10), 'zlecenie.godzinaPrzyjecia': when.slice(11, 16),
    'zlecenie.dataOdbioru': (o?.pickup_at || '').slice(0, 16).replace('T', ' '), 'zlecenie.przebieg': o?.mileage ? `${o.mileage} km` : '',
    'zlecenie.status': st?.client_label || st?.name || '', 'zlecenie.kwota': o ? zl(o.total) : '', 'zlecenie.doZaplaty': o ? zl(Math.max(0, o.total - o.paid)) : '',
    get 'zlecenie.kartaZlecenia'() { return o ? (lazy.card ??= cardUrl(o.id)) : ''; },
    get 'wycena.link'() { return o ? (lazy.card ??= cardUrl(o.id)) : ''; },
    'link.platnosc': o?.pay_link || '', 'link.opinia': s.review_url || '',
    'firma.nazwa': s.company_brand || s.company_name || '', 'firma.telefon': s.company_phone || '', 'firma.adres': s.company_address || '',
    'dokument.numer': o?.invoice_no || o?.receipt_no || '',
  };
}

/** [[pole]] → значение; неизвестные поля оставляются пустыми */
export function render(tpl, ctx) {
  return String(tpl || '').replace(/\[\[\s*([a-zA-Z.]+)\s*\]\]/g, (_, k) => (k in ctx ? String(ctx[k] ?? '') : ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function renderTemplate(settingKey, orderId, extra = {}) {
  const tpl = getSetting(settingKey, '');
  if (!tpl) return '';
  return render(tpl, { ...orderContext(orderId, extra), ...(extra.vars || {}) });
}

/** Готовая SMS для статуса (окно «отправить / не отправлять») */
export function statusSmsPreview(orderId, statusId) {
  const st = one('SELECT * FROM order_statuses WHERE id = ?', statusId);
  if (!st || st.sms_mode === 'off' || !st.sms_template) return null;
  const o = one('SELECT customer_id FROM orders WHERE id = ?', orderId);
  const c = o?.customer_id ? one('SELECT phone FROM customers WHERE id = ?', o.customer_id) : null;
  if (!c?.phone) return null;
  return { mode: st.sms_mode, phone: c.phone, text: render(st.sms_template, orderContext(orderId)), status: st.name };
}

export function statusEmailPreview(orderId, statusId) {
  const st = one('SELECT * FROM order_statuses WHERE id = ?', statusId);
  if (!st || st.email_mode === 'off' || !st.email_template) return null;
  const o = one('SELECT customer_id, number FROM orders WHERE id = ?', orderId);
  const c = o?.customer_id ? one('SELECT email FROM customers WHERE id = ?', o.customer_id) : null;
  if (!c?.email) return null;
  return { mode: st.email_mode, to: c.email, subject: `Zlecenie ${o.number} — ${st.client_label || st.name}`, text: render(st.email_template, orderContext(orderId)) };
}

/** Текст → простое письмо HTML */
export const textToHtml = (t) => `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${String(t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>')}</div>`;
