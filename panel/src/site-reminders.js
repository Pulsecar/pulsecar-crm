// Напоминания с сайта (pulsecar.pl/przypomnienia): клиент сам подписывается на сезонную смену шин,
// кондиционер, замену масла и техосмотр — CRM сама отправляет SMS в нужный момент (через SMS-провайдера
// из «Интеграций»), по одной SMS на каждое событие, на языке клиента, со ссылкой для отписки.
import { all, one, run, insert, ilog } from './db.js';
import { sendSms } from './sms.js';
import { notify } from './integrations/notify.js';
import { normPhone, randomHex } from './util.js';

const LANGS = ['pl', 'en', 'ua', 'ru', 'by'];
const T = {
  pl: { hi: 'Pulsecar', tyresAutumn: 'czas na zmianę opon na zimowe', tyresSpring: 'czas na zmianę opon na letnie', ac: 'czas na serwis klimatyzacji przed latem', oil: 'zbliża się termin wymiany oleju', insp: (d) => `badanie techniczne auta do ${d}`, cta: (l) => `Umów wizytę: pulsecar.pl/${l}/booking lub tel. 571 058 591`, stop: 'Rezygnacja' },
  en: { hi: 'Pulsecar', tyresAutumn: 'time to switch to winter tyres', tyresSpring: 'time to switch to summer tyres', ac: 'time for an A/C service before summer', oil: 'your oil change is due soon', insp: (d) => `vehicle inspection due by ${d}`, cta: (l) => `Book: pulsecar.pl/${l}/booking or call 571 058 591`, stop: 'Unsubscribe' },
  ua: { hi: 'Pulsecar', tyresAutumn: 'час міняти шини на зимові', tyresSpring: 'час міняти шини на літні', ac: 'час обслужити кондиціонер перед літом', oil: 'наближається заміна оливи', insp: (d) => `техогляд авто до ${d}`, cta: (l) => `Запис: pulsecar.pl/${l}/booking або 571 058 591`, stop: 'Відписатися' },
  ru: { hi: 'Pulsecar', tyresAutumn: 'пора менять шины на зимние', tyresSpring: 'пора менять шины на летние', ac: 'пора обслужить кондиционер перед летом', oil: 'подходит срок замены масла', insp: (d) => `техосмотр авто до ${d}`, cta: (l) => `Запись: pulsecar.pl/${l}/booking или 571 058 591`, stop: 'Отписаться' },
  by: { hi: 'Pulsecar', tyresAutumn: 'час мяняць шыны на зімовыя', tyresSpring: 'час мяняць шыны на летнія', ac: 'час абслужыць кандыцыянер перад летам', oil: 'набліжаецца замена алею', insp: (d) => `тэхагляд аўто да ${d}`, cta: (l) => `Запіс: pulsecar.pl/${l}/booking або 571 058 591`, stop: 'Адпісацца' },
};
const PL_ITEM = { tyresAutumn: 'шины → зимние', tyresSpring: 'шины → летние', ac: 'кондиционер', oil: 'замена масла', insp: 'техосмотр' };

/** Подписка с сайта. Повторная подписка с того же номера обновляет существующую запись. */
export function subscribe(b, { quiet = false } = {}) {
  const phone = normPhone(b.phone);
  if (!phone) return { error: 'phone' };
  const lang = LANGS.includes(String(b.lang || b.language || '').toLowerCase()) ? String(b.lang || b.language).toLowerCase() : 'pl';
  const oil = /^\d{4}-\d{2}$/.test(String(b.oilMonth || b.oil_month || '')) ? String(b.oilMonth || b.oil_month) : null;
  const insp = /^\d{4}-\d{2}-\d{2}$/.test(String(b.inspectionDate || b.inspection_date || '')) ? String(b.inspectionDate || b.inspection_date) : null;
  const row = {
    name: String(b.name || '').trim().slice(0, 120) || null, phone, email: String(b.email || '').trim().slice(0, 160) || null,
    car: String(b.car || b.carMakeModel || '').trim().slice(0, 120) || null, lang,
    tyres: b.tyres ? 1 : 0, ac: b.ac ? 1 : 0, oil_month: oil, inspection_date: insp, source: String(b.source || 'site').slice(0, 30),
  };
  if (!row.tyres && !row.ac && !oil && !insp) return { error: 'empty' };
  const customer = one('SELECT id FROM customers WHERE phone = ?', phone);
  const prev = one('SELECT * FROM site_reminders WHERE phone = ? ORDER BY id DESC LIMIT 1', phone);
  let id; let token;
  if (prev) {
    token = prev.token; id = prev.id;
    run(`UPDATE site_reminders SET name = COALESCE(?, name), email = COALESCE(?, email), car = COALESCE(?, car), lang = ?, tyres = ?, ac = ?,
      oil_month = ?, inspection_date = ?, active = 1, customer_id = COALESCE(?, customer_id) WHERE id = ?`,
    row.name, row.email, row.car, lang, row.tyres, row.ac, oil, insp, customer?.id ?? null, id);
  } else {
    token = randomHex(8);
    id = insert('site_reminders', { ...row, token, customer_id: customer?.id ?? null });
  }
  if (!quiet) {
    const what = [row.tyres && 'шины (весна/осень)', row.ac && 'кондиционер (весна)', oil && 'масло: ' + oil, insp && 'техосмотр: ' + insp].filter(Boolean).join(', ');
    notify('booking', `🔔 Подписка на напоминания с сайта: ${row.name || '—'}, ${phone}${row.car ? ' · ' + row.car : ''}\n${what}\nSMS отправятся автоматически (${lang.toUpperCase()})`, { reminder: id });
  }
  return { id, token, updated: !!prev };
}

export function unsubscribe(token) {
  if (!/^[a-f0-9]{8,64}$/i.test(String(token || ''))) return false;
  return run('UPDATE site_reminders SET active = 0 WHERE token = ?', String(token)).changes > 0;
}

const DAY = 86400000;
const ymdUTC = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +(s.slice(8, 10) || 1));

/** Какие события подошли на дату (YYYY-MM-DD, по Варшаве): [[ключ, вид, аргумент]] */
export function dueItems(r, date) {
  const y = +date.slice(0, 4);
  const md = +date.slice(5, 7) * 100 + +date.slice(8, 10);
  const today = ymdUTC(date);
  const due = [];
  if (r.tyres) {
    if (md >= 1015 && md <= 1130) due.push([`tyres-${y}-autumn`, 'tyresAutumn']);
    if (md >= 320 && md <= 430) due.push([`tyres-${y}-spring`, 'tyresSpring']);
  }
  if (r.ac && md >= 415 && md <= 531) due.push([`ac-${y}`, 'ac']);
  if (r.oil_month && today >= ymdUTC(r.oil_month) && today <= ymdUTC(r.oil_month) + 45 * DAY) due.push([`oil-${r.oil_month}`, 'oil']);
  if (r.inspection_date) {
    const t = ymdUTC(r.inspection_date);
    if (today >= t - 14 * DAY && today <= t + 30 * DAY) due.push([`insp-${r.inspection_date}`, 'insp', r.inspection_date.split('-').reverse().join('.')]);
  }
  let sent = {};
  try { sent = JSON.parse(r.sent || '{}') || {}; } catch { sent = {}; }
  return due.filter((d) => !sent[d[0]]);
}

export function smsText(r, items, stopBase) {
  const L = T[r.lang] || T.pl;
  const lines = items.map((d) => (d[1] === 'insp' ? L.insp(d[2]) : L[d[1]]));
  const first = String(r.name || '').split(' ')[0];
  return `${L.hi}${first ? ', ' + first : ''}: ${lines.join('; ')}. ${L.cta(r.lang)}. ${L.stop}: ${stopBase}/r/${r.token}`;
}

/** Ежедневная рассылка: вызывается из фоновых задач в рабочие часы. Возвращает число отправленных SMS. */
export function runSiteReminders(date, publicUrl) {
  const stopBase = String(publicUrl || 'https://panel.pulsecar.tech').replace(/\/$/, '');
  const done = [];
  for (const r of all('SELECT * FROM site_reminders WHERE active = 1')) {
    const fresh = dueItems(r, date);
    if (!fresh.length) continue;
    let sent = {};
    try { sent = JSON.parse(r.sent || '{}') || {}; } catch { sent = {}; }
    fresh.forEach((d) => { sent[d[0]] = new Date().toISOString(); });
    run('UPDATE site_reminders SET sent = ? WHERE id = ?', JSON.stringify(sent), r.id); // отмечаем до отправки — без повторов
    sendSms(r.phone, smsText(r, fresh, stopBase), { kind: 'site_reminder', customer_id: r.customer_id })
      .catch((e) => ilog('sms', 'error', 'Напоминание с сайта: ' + e.message));
    done.push(`• ${r.name || '—'} ${r.phone}: ${fresh.map((d) => PL_ITEM[d[1]] + (d[2] ? ' ' + d[2] : '')).join(', ')}`);
  }
  if (done.length) notify('booking', `📨 Отправлены SMS-напоминания (${done.length}):\n${done.slice(0, 40).join('\n')}`);
  return done.length;
}

/** Ближайшая SMS для подписчика: { date, items: ['шины → зимние', …] } или null */
export function nextPlan(r, date) {
  if (!r.active) return null;
  let t = ymdUTC(date);
  for (let i = 0; i < 400; i++, t += DAY) {
    const d = new Date(t).toISOString().slice(0, 10);
    const due = dueItems(r, d);
    if (due.length) return { date: d, items: due.map((x) => PL_ITEM[x[1]] + (x[2] ? ' ' + x[2] : '')) };
  }
  return null;
}
export const describe = (r) => [r.tyres && 'шины (весна/осень)', r.ac && 'кондиционер (весна)', r.oil_month && 'масло: ' + r.oil_month.split('-').reverse().join('.'),
  r.inspection_date && 'техосмотр: ' + r.inspection_date.split('-').reverse().join('.')].filter(Boolean).join(', ');
