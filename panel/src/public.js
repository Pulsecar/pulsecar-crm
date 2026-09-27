// Публичные страницы для клиентов: электронная карта заказа / сметы (/k/<токен>) и онлайн-запись (/rezerwacja)
import express from 'express';
import crypto from 'node:crypto';
import { all, one, run, insert, log, getSetting } from './db.js';
import { normPhone, normPlate } from './util.js';
import { sendSms } from './sms.js';
import { render, orderContext } from './messaging.js';
import { notify } from './integrations/notify.js';
import { invoicePdf } from './invoices.js';
import { localShift } from './integrations/jobs.js';

export const pub = express.Router();
pub.use(express.urlencoded({ extended: false, limit: '20kb' }));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const zl = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',');
const S = () => Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
const on = (v) => v === '1' || v === 'true';

// простая защита от перебора и спама: не больше N запросов с одного IP за 10 минут
const hits = new Map();
function limited(req, key, max) {
  const k = key + ':' + req.ip;
  const now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < 600_000);
  arr.push(now);
  hits.set(k, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

const page = (title, body, s) => `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} — ${esc(s.company_brand || 'Pulsecar')}</title><link rel="icon" href="/favicon.png">
<style>
:root{--g:#12b85a;--bg:#f4f5f7;--card:#fff;--t:#14161a;--m:#6b7078;--line:#e4e6ea}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:var(--bg);color:var(--t)}
header{background:#0f1115;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
header img{height:34px}header a{color:#fff;text-decoration:none;font-weight:600;font-size:14px;border:1px solid #333;border-radius:999px;padding:6px 14px}
main{max-width:720px;margin:0 auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--m);margin:0 0 8px}
.m{color:var(--m);font-size:13px}.chip{display:inline-block;border-radius:999px;padding:3px 12px;font-size:13px;font-weight:600;border:1px solid}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}.grid .card{margin:0}@media(max-width:560px){.grid{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse}td{padding:8px 0;border-bottom:1px solid var(--line);vertical-align:top}td.r{text-align:right;white-space:nowrap;padding-left:12px}
.tot{display:flex;justify-content:space-between;font-size:20px;font-weight:700;margin-top:10px}.sub{display:flex;justify-content:space-between;color:var(--m);font-size:14px}
.btn{display:block;width:100%;text-align:center;background:var(--g);color:#fff;border:0;border-radius:12px;padding:14px;font-size:16px;font-weight:700;cursor:pointer;text-decoration:none;margin-top:10px}
.btn.alt{background:#fff;color:var(--t);border:1px solid var(--line)}input,select,textarea{width:100%;font:inherit;padding:12px;border:1px solid var(--line);border-radius:10px;background:#fff;margin-top:4px}
label{display:block;margin-top:10px;font-size:14px;color:var(--m)}.ok{background:#e9f9ef;border-color:#bfe9cf}.err{background:#fdeeee;border-color:#f3c4c4}
.small{font-size:12px;color:var(--m);white-space:pre-wrap}footer{text-align:center;color:var(--m);font-size:12px;padding:10px 16px 30px}
</style></head><body><header><img src="/logo.png" alt="${esc(s.company_brand || 'Pulsecar')}">${s.company_phone ? `<a href="tel:${esc(s.company_phone.replace(/\s/g, ''))}">📞 ${esc(s.company_phone)}</a>` : ''}</header>
<main>${body}</main><footer>${esc(s.company_name || '')} · ${esc(s.company_address || '')}${s.company_nip ? ' · NIP ' + esc(s.company_nip) : ''}</footer></body></html>`;

function findCard(token) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(String(token))) return null;
  return one('SELECT * FROM orders WHERE card_token = ?', token);
}

// ── Электронная карта заказа / сметы ──────────────────────────────────────
pub.get('/k/:token', (req, res) => {
  const s = S();
  const o = findCard(req.params.token);
  res.setHeader('Cache-Control', 'no-store');
  if (!o) return res.status(404).send(page('Nie znaleziono', '<div class="card"><h1>Nie znaleziono</h1><p class="m">Link jest nieprawidłowy lub dokument został usunięty.</p></div>', s));
  const car = o.car_id ? one('SELECT * FROM cars WHERE id = ?', o.car_id) : {};
  const c = o.customer_id ? one('SELECT * FROM customers WHERE id = ?', o.customer_id) : {};
  const st = o.status_id ? one('SELECT * FROM order_statuses WHERE id = ?', o.status_id) : null;
  const items = all('SELECT * FROM order_items WHERE order_id = ? ORDER BY pos, id', o.id);
  const isQuote = o.kind === 'quote';
  const due = Math.max(0, o.total - o.paid);
  const msg = { accepted: ['ok', 'Dziękujemy! Potwierdzenie zostało zapisane.'], code: ['ok', 'Wysłaliśmy SMS z kodem potwierdzenia.'], badcode: ['err', 'Nieprawidłowy lub nieaktualny kod. Spróbuj ponownie.'], limit: ['err', 'Zbyt wiele prób. Spróbuj za kilka minut.'], nophone: ['err', 'Brak numeru telefonu — skontaktuj się z nami.'] }[req.query.m];
  const line = (i) => {
    const g = i.qty * i.price * (1 - (i.discount || 0) / 100);
    return `<tr><td>${esc(i.name)}${i.qty !== 1 ? `<div class="m">${esc(i.qty)} × ${zl(i.price)} zł</div>` : ''}${i.discount ? `<div class="m">rabat ${esc(i.discount)}%</div>` : ''}</td><td class="r">${zl(g)} zł</td></tr>`;
  };
  const labor = items.filter((i) => i.kind === 'labor');
  const parts = items.filter((i) => i.kind === 'part');
  const accept = s.card_accept || 'button';
  const done = !!o.accepted_at;
  const acceptBox = accept === 'none' ? '' : done
    ? `<div class="card ok"><b>✓ Zaakceptowano</b><div class="m">${esc(o.accepted_at.slice(0, 16))}${o.accepted_via === 'sms' ? ' · kodem SMS' : ''}</div></div>`
    : `<div class="card"><h2>Akceptacja</h2><p style="margin:0">Akceptuję zakres prac i koszty ${isQuote ? 'z wyceny' : 'z karty zlecenia'} ${esc(o.number)}.</p>
      ${accept === 'sms'
        ? (o.accept_code_exp > Date.now()
          ? `<form method="post" action="/k/${esc(req.params.token)}/accept"><label>Kod z SMS<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label><button class="btn">Akceptuję</button></form>
             <form method="post" action="/k/${esc(req.params.token)}/code"><button class="btn alt">Wyślij kod ponownie</button></form>`
          : `<form method="post" action="/k/${esc(req.params.token)}/code"><button class="btn">Wyślij kod SMS, aby zaakceptować</button></form>`)
        : `<form method="post" action="/k/${esc(req.params.token)}/accept"><button class="btn">Akceptuję</button></form>`}</div>`;
  const body = `
  ${msg ? `<div class="card ${msg[0]}">${esc(msg[1])}</div>` : ''}
  <div class="card"><div class="m">${isQuote ? 'Wycena' : 'Karta zlecenia'}</div><h1>${esc(o.number)}</h1>
    ${on(s.card_show_status) && st && !isQuote ? `<span class="chip" style="color:${esc(st.color || '#333')};border-color:${esc(st.color || '#333')}">${esc(st.client_label || st.name)}</span>` : ''}
    <div class="m" style="margin-top:6px">Data: ${esc((o.created_at || '').slice(0, 10))}${o.pickup_at ? ' · planowany odbiór: ' + esc(o.pickup_at.replace('T', ' ').slice(0, 16)) : ''}</div></div>
  <div class="grid">
    <div class="card"><h2>Pojazd</h2><b>${esc([car.make, car.model].filter(Boolean).join(' ') || '—')}</b><div class="m">${esc(car.plate || '')}${car.vin ? ' · VIN ' + esc(car.vin) : ''}${o.mileage ? '<br>Przebieg: ' + esc(Number(o.mileage).toLocaleString('pl-PL')) + ' km' : ''}</div></div>
    <div class="card"><h2>Klient</h2><b>${esc(c.company || c.name || '—')}</b><div class="m">${esc(c.phone || '')}</div></div>
  </div>
  ${o.complaint ? `<div class="card"><h2>Zgłoszenie</h2>${esc(o.complaint).replace(/\n/g, '<br>')}</div>` : ''}
  ${!isQuote && on(s.card_quote_after_protocol) && !done && accept !== 'none' ? '<div class="card"><h2>Kosztorys</h2><p class="m" style="margin:0">Kosztorys będzie widoczny po akceptacji przyjęcia pojazdu.</p></div>' : `
  <div class="card"><h2>${isQuote ? 'Wycena' : 'Kosztorys'}</h2>
    ${labor.length ? `<div class="m" style="margin-top:4px">Usługi</div><table>${labor.map(line).join('')}</table>` : ''}
    ${parts.length ? `<div class="m" style="margin-top:12px">Części</div><table>${parts.map(line).join('')}</table>` : ''}
    ${!items.length ? '<p class="m">Kosztorys jest w przygotowaniu.</p>' : ''}
    <div class="tot"><span>Razem brutto</span><span>${zl(o.total)} zł</span></div>
    ${on(s.card_show_net) ? `<div class="sub"><span>w tym netto</span><span>${zl(o.total_net)} zł</span></div>` : ''}
    ${!isQuote && o.paid > 0 ? `<div class="sub"><span>Zapłacono</span><span>${zl(o.paid)} zł</span></div><div class="sub"><b>Do zapłaty</b><b>${zl(due)} zł</b></div>` : ''}
  </div>`}
  ${acceptBox}
  ${!isQuote && due > 0.01 && o.pay_link ? `<a class="btn" href="${esc(o.pay_link)}" rel="noopener">Zapłać online ${zl(due)} zł (BLIK, karta)</a>` : ''}
  ${on(s.card_show_bank) && s.company_bank && !isQuote && due > 0.01 ? `<div class="card"><h2>Przelew</h2>${esc(s.company_name || '')}<br><b style="user-select:all">${esc(s.company_bank)}</b><div class="m">Tytuł: ${esc(o.number)}</div></div>` : ''}
  ${on(s.card_show_invoice) && o.invoice_ext_id ? `<a class="btn alt" href="/k/${esc(req.params.token)}/faktura.pdf">Faktura ${esc(o.invoice_no || '')} (PDF)</a>` : ''}
  ${s.card_extra ? `<div class="card small">${esc(s.card_extra)}</div>` : ''}
  ${s.card_rodo ? `<div class="card small">${esc(s.card_rodo)}</div>` : ''}`;
  res.send(page(`${isQuote ? 'Wycena' : 'Zlecenie'} ${o.number}`, body, s));
});

pub.post('/k/:token/code', async (req, res) => {
  const o = findCard(req.params.token);
  if (!o) return res.status(404).send('not found');
  const back = (m) => res.redirect(303, `/k/${req.params.token}?m=${m}`);
  if (limited(req, 'code', 5) || (o.accept_code_exp && o.accept_code_exp - 9 * 60_000 > Date.now())) return back('limit');
  const c = o.customer_id ? one('SELECT phone FROM customers WHERE id = ?', o.customer_id) : null;
  if (!c?.phone) return back('nophone');
  const code = String(crypto.randomInt(100000, 1000000));
  run('UPDATE orders SET accept_code = ?, accept_code_exp = ? WHERE id = ?', crypto.createHash('sha256').update(code + o.card_token).digest('hex'), Date.now() + 10 * 60_000, o.id);
  const text = render(getSetting('sms_tpl_code', 'Kod potwierdzenia: [[kod]]'), { ...orderContext(o.id), kod: code });
  try { await sendSms(c.phone, text, { kind: 'code', order_id: o.id, customer_id: o.customer_id }); } catch { return back('limit'); }
  back('code');
});

pub.post('/k/:token/accept', (req, res) => {
  const o = findCard(req.params.token);
  if (!o) return res.status(404).send('not found');
  const back = (m) => res.redirect(303, `/k/${req.params.token}?m=${m}`);
  if (o.accepted_at) return back('accepted');
  const mode = getSetting('card_accept', 'button');
  if (mode === 'none') return back('');
  if (limited(req, 'accept', 10)) return back('limit');
  if (mode === 'sms') {
    const code = String(req.body?.code || '').replace(/\D/g, '');
    const ok = o.accept_code && o.accept_code_exp > Date.now()
      && crypto.timingSafeEqual(Buffer.from(o.accept_code), Buffer.from(crypto.createHash('sha256').update(code + o.card_token).digest('hex')));
    if (!ok) return back('badcode');
  }
  run('UPDATE orders SET accepted_at = ?, accepted_via = ?, accept_code = NULL, accept_code_exp = NULL WHERE id = ?', localShift(0), mode, o.id);
  log('order', o.id, 'accepted', `${mode === 'sms' ? 'kod SMS' : 'przycisk'} · ${req.ip}`, 'klient');
  const target = Number(getSetting('card_accept_status_id', '')) || null;
  const cur = o.status_id ? one('SELECT is_final FROM order_statuses WHERE id = ?', o.status_id) : null;
  if (target && o.kind === 'order' && !cur?.is_final && one('SELECT 1 FROM order_statuses WHERE id = ?', target)) {
    run('UPDATE orders SET status_id = ? WHERE id = ?', target, o.id);
    log('order', o.id, 'status', one('SELECT name FROM order_statuses WHERE id = ?', target).name, 'klient');
  }
  notify('status', `✅ Клиент подтвердил ${o.kind === 'quote' ? 'смету' : 'заказ'} ${o.number}`, { order: o.number, event: 'accepted' });
  back('accepted');
});

pub.get('/k/:token/faktura.pdf', async (req, res) => {
  const o = findCard(req.params.token);
  if (!o?.invoice_ext_id || getSetting('card_show_invoice', '1') !== '1') return res.status(404).send('not found');
  const pdf = await invoicePdf(o.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Faktura-${String(o.invoice_no || o.id).replace(/[^\w-]/g, '-')}.pdf"`);
  res.send(pdf);
});

// ── Онлайн-запись для сайта (виджет, как «Widget rezerwacji» в Motowarsztat) ─────
const services = () => [...new Set(all('SELECT category FROM service_catalog ORDER BY category').map((r) => r.category).filter(Boolean))];

function bookingForm(s, embed, msg, v = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return `${msg ? `<div class="card ${msg[0]}">${esc(msg[1])}</div>` : ''}
  <div class="card"><h1>Umów wizytę</h1><p class="m" style="margin:0">Wybierz dogodny termin — potwierdzimy go SMS-em lub telefonicznie.</p>
  <form method="post" action="/rezerwacja${embed ? '?embed=1' : ''}">
    <label>Imię<input name="name" required maxlength="80" value="${esc(v.name)}" autocomplete="given-name"></label>
    <label>Telefon<input name="phone" required type="tel" maxlength="20" value="${esc(v.phone)}" autocomplete="tel" placeholder="+48 …"></label>
    <label>Numer rejestracyjny<input name="plate" maxlength="12" value="${esc(v.plate)}" style="text-transform:uppercase"></label>
    <label>Samochód (marka, model)<input name="car" maxlength="80" value="${esc(v.car)}"></label>
    <label>Usługa<select name="service"><option value="">— wybierz —</option>${services().map((c) => `<option ${v.service === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option ${v.service === 'Inne' ? 'selected' : ''}>Inne</option></select></label>
    <div class="grid"><label>Dzień<input name="date" type="date" min="${today}" value="${esc(v.date)}"></label>
      <label>Godzina<select name="time"><option value="">dowolna</option>${hours(s).map((h) => `<option ${v.time === h ? 'selected' : ''}>${h}</option>`).join('')}</select></label></div>
    <label>Opis problemu<textarea name="note" rows="3" maxlength="1000">${esc(v.note)}</textarea></label>
    <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-5000px" aria-hidden="true">
    <label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" name="consent" value="1" required style="width:auto;margin-top:3px"><span class="small">Wyrażam zgodę na kontakt w sprawie wizyty. Administratorem danych jest ${esc(s.company_name || '')}.</span></label>
    <button class="btn">Wyślij zgłoszenie</button></form></div>`;
}
function hours(s) {
  const [a] = String(s.hours_start || '09:00').split(':').map(Number);
  const [b] = String(s.hours_end || '18:00').split(':').map(Number);
  const out = [];
  for (let h = a; h < b; h++) { out.push(`${String(h).padStart(2, '0')}:00`); out.push(`${String(h).padStart(2, '0')}:30`); }
  return out;
}
const embedCss = (s) => `<style>header,footer{display:none}body{background:transparent}.btn{background:${esc(s.booking_color || '#12b85a')}}</style>`;

pub.get('/rezerwacja', (req, res) => {
  const s = S();
  if (s.booking_widget === '0') return res.status(404).send(page('Rezerwacja', '<div class="card">Rezerwacja online jest wyłączona. Zadzwoń do nas.</div>', s));
  const embed = req.query.embed === '1';
  let html = page('Rezerwacja wizyty', bookingForm(s, embed), s);
  if (embed) html = html.replace('</head>', embedCss(s) + '</head>');
  res.removeHeader('X-Frame-Options');
  res.send(html);
});

pub.post('/rezerwacja', (req, res) => {
  const s = S();
  const embed = req.query.embed === '1';
  const b = req.body || {};
  const send = (msg, v) => { let h = page('Rezerwacja wizyty', msg[0] === 'ok' ? `<div class="card ok"><h1>Dziękujemy!</h1><p style="margin:0">${esc(msg[1])}</p></div>` : bookingForm(s, embed, msg, v), s); if (embed) h = h.replace('</head>', embedCss(s) + '</head>'); res.send(h); };
  if (s.booking_widget === '0') return res.status(404).send('off');
  if (b.website) return send(['ok', 'Zgłoszenie przyjęte.']); // бот
  if (limited(req, 'booking', 5)) return send(['err', 'Zbyt wiele zgłoszeń. Zadzwoń do nas.'], b);
  const phone = normPhone(b.phone);
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name || !phone) return send(['err', 'Podaj imię i poprawny numer telefonu.'], b);
  const plate = normPlate(b.plate || '');
  const when = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? `${b.date}${/^\d{2}:\d{2}$/.test(b.time || '') ? ' ' + b.time : ''}` : '';
  const customer = one('SELECT id FROM customers WHERE phone = ?', phone);
  const car = plate ? one('SELECT id FROM cars WHERE plate = ? OR car_key = ?', plate, plate) : null;
  const note = [b.service && `Usługa: ${b.service}`, b.car && `Auto: ${b.car}`, plate && `Nr: ${plate}`, b.note && String(b.note).slice(0, 1000)].filter(Boolean).join('\n');
  const id = insert('appointments', {
    title: `${b.service || 'Wizyta'}${plate ? ' · ' + plate : ''}`, note, status: 'request', source: 'site',
    customer_id: customer?.id || null, car_id: car?.id || null, contact_name: name, contact_phone: phone, preferred: when || 'dowolny termin',
  });
  notify('booking', `🗓 Запись с сайта: ${name} ${phone}${when ? ' · ' + when : ''}${b.service ? ' · ' + b.service : ''}${plate ? ' · ' + plate : ''}`, { appointment: id, source: 'site' });
  const tpl = s.sms_tpl_booking;
  if (tpl) sendSms(phone, render(tpl, { ...orderContext(null, { appointment: { contact_name: name, contact_phone: phone, start_at: when, plate } }) }), { kind: 'booking', customer_id: customer?.id }).catch(() => {});
  send(['ok', 'Otrzymaliśmy zgłoszenie. Skontaktujemy się, aby potwierdzić termin.']);
});

/** Код для вставки на сайт: <div id="pulsecar-booking"></div><script src="…/rezerwacja.js"></script> */
pub.get('/rezerwacja.js', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.type('application/javascript').setHeader('Cache-Control', 'public, max-age=3600');
  res.send(`(function(){var el=document.getElementById('pulsecar-booking');if(!el){el=document.createElement('div');(document.currentScript&&document.currentScript.parentNode||document.body).appendChild(el);}
var f=document.createElement('iframe');f.src=${JSON.stringify(base + '/rezerwacja?embed=1')};f.title='Rezerwacja';f.style.cssText='width:100%;border:0;min-height:980px;';f.loading='lazy';el.appendChild(f);})();`);
});
