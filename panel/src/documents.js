// Шаблоны документов (A4, печать и «Сохранить как PDF» в браузере), по образцу Motowarsztat → Wygląd dokumentów:
// фактура VAT, Pro forma, корректа, протокол приёма, спецификация заказа, карта для механика, смета (kosztorys / wycena),
// протокол выдачи, складские PZ/WZ/RW/PW, кассовые KP/KW и депозит шин. Документы на польском — их получает клиент.
import { all, one, run, insert, getSetting } from './db.js';
import { orderFull, lineGross } from './orders.js';
import { HttpError, nextNumber, round2, today } from './util.js';
import { config } from './config.js';
import { KSEF_ENVS } from './integrations/ksef.js';
import fs from 'node:fs';
import path from 'node:path';

// файлы заказов (фото, видео, PDF) лежат рядом с базой: data/files/<id заказа>/
export const FILES_DIR = path.join(path.dirname(path.resolve(config.dbPath)), 'files');
export function sendOrderFile(res, f, download = false) {
  const p = path.resolve(FILES_DIR, f.path);
  if (!p.startsWith(FILES_DIR + path.sep) || !fs.existsSync(p)) throw new HttpError(404, 'Файл не найден');
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(p).pipe(res);
}

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const zl = (n) => (Number(n) || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n) => (Number(n) || 0).toLocaleString('pl-PL', { maximumFractionDigits: 3 });
const d10 = (s) => String(s || '').slice(0, 10);
const on = (S, k, def = '1') => (S[k] ?? def) === '1';
export const settingsMap = () => Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
const FUEL_PL = { 'резерв': 'rezerwa', 'полный': 'pełny', '1/4': '1/4', '1/2': '1/2', '3/4': '3/4' };
export const fuelPl = (f) => FUEL_PL[f] || f || '—';
const FUEL_PCT = { 'резерв': 5, '1/4': 25, '1/2': 50, '3/4': 75, 'полный': 100 };
export const fuelPct = (f) => FUEL_PCT[f] ?? null;
export const PAY_PL = { cash: 'gotówka', card: 'karta płatnicza', blik: 'BLIK', transfer: 'przelew', points: 'punkty', mixed: 'mieszana' };

// ── Кwota słownie (для фактур и KP/KW) ─────────────────────────────────────
const U = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];
const TEEN = ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
const TENS = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
const HUND = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];
const GROUPS = [['', '', ''], ['tysiąc', 'tysiące', 'tysięcy'], ['milion', 'miliony', 'milionów'], ['miliard', 'miliardy', 'miliardów']];
const form = (n) => (n === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 1 : 2);
function tri(n) {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
  return [HUND[h], t === 1 ? TEEN[u] : TENS[t], t === 1 ? '' : U[u]].filter(Boolean).join(' ');
}
export function slownie(amount) {
  const grosze = Math.round(Math.abs(Number(amount) || 0) * 100);
  let zlote = Math.floor(grosze / 100);
  const gr = String(grosze % 100).padStart(2, '0');
  if (!zlote) return `zero złotych ${gr}/100`;
  const words = [];
  const zForm = form(zlote);
  for (let g = 0; zlote > 0; g++, zlote = Math.floor(zlote / 1000)) {
    const n = zlote % 1000;
    if (!n) continue;
    const w = g && n === 1 ? GROUPS[g][0] : [tri(n), g ? GROUPS[g][form(n)] : ''].filter(Boolean).join(' ');
    words.unshift(w);
  }
  return `${(Number(amount) < 0 ? 'minus ' : '') + words.join(' ')} ${['złoty', 'złote', 'złotych'][zForm]} ${gr}/100`;
}

// ── Общий макет A4 ─────────────────────────────────────────────────────────
const CSS = `
@font-face{font-family:'Pulsecar Sans';src:url('/fonts/PulsecarSans-Regular.woff2') format('woff2');font-weight:400}
@font-face{font-family:'Pulsecar Sans';src:url('/fonts/PulsecarSans-SemiBold.woff2') format('woff2');font-weight:600}
@font-face{font-family:'Pulsecar Sans';src:url('/fonts/PulsecarSans-Bold.woff2') format('woff2');font-weight:700}
@page{size:A4;margin:12mm 12mm 14mm}
*{box-sizing:border-box}
html{background:#e9eaec}
body{font:10.5px/1.45 'Pulsecar Sans',Arial,Helvetica,sans-serif;color:#15171a;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{background:#fff;width:210mm;min-height:297mm;margin:16px auto;padding:12mm;box-shadow:0 4px 24px rgba(0,0,0,.12)}
.bar{position:sticky;top:0;z-index:5;display:flex;gap:8px;justify-content:center;align-items:center;padding:10px;background:#15171a;color:#fff;font:600 13px system-ui,sans-serif}
.bar button,.bar a{font:600 13px system-ui,sans-serif;background:#1bf372;color:#0b0c0e;border:0;border-radius:8px;padding:8px 16px;cursor:pointer;text-decoration:none}
.bar a.alt{background:#2a2c31;color:#fff}
.head{display:grid;grid-template-columns:auto 1fr auto;gap:18px;align-items:start;padding-bottom:10px;border-bottom:2px solid #15171a}
.logo{height:40px;display:block}
.co{font-size:9.5px;color:#3c4047}.co .adm{font-size:8px;color:#6b7078}.co b{font-size:12.5px;color:#15171a;display:block;line-height:1.25}
.doc{text-align:right}.doc h1{font-size:17px;margin:0;letter-spacing:.01em}.doc .no{font-size:15px;font-weight:700;margin-top:1px}
.doc .meta{margin-top:4px;color:#3c4047}.doc .meta div{white-space:nowrap}
.orig{display:inline-block;margin-top:4px;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border:1px solid #15171a;border-radius:3px;padding:1px 6px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}
.box{border:1px solid #cfd2d6;border-radius:6px;padding:8px 10px;break-inside:avoid}
.box h3,.sec h3{font-size:8.5px;text-transform:uppercase;letter-spacing:.08em;color:#6b7078;margin:0 0 5px}
.box .n{font-size:12px;font-weight:700}
.kv{display:grid;grid-template-columns:auto 1fr;gap:1px 10px}.kv span{color:#6b7078}
.sec{margin:12px 0;break-inside:avoid}
table{width:100%;border-collapse:collapse}
th{font-size:8.5px;text-transform:uppercase;letter-spacing:.05em;color:#3c4047;text-align:left;background:#f1f2f4;border-top:1px solid #cfd2d6;border-bottom:1px solid #cfd2d6;padding:5px 6px}
td{border-bottom:1px solid #e3e5e8;padding:5px 6px;vertical-align:top}
.r{text-align:right;white-space:nowrap}.c{text-align:center}.mono{font-variant-numeric:tabular-nums}
.sub{color:#6b7078;font-size:9px}
tr.sum td{font-weight:700;border-bottom:0;border-top:1px solid #15171a}
tr.empty td{height:22px}
.totals{display:grid;grid-template-columns:1fr 280px;gap:14px;margin-top:10px;align-items:start}
.pay{border:1px solid #cfd2d6;border-radius:6px;overflow:hidden}
.pay div{display:flex;justify-content:space-between;padding:5px 10px;border-bottom:1px solid #e3e5e8}.pay div:last-child{border-bottom:0}
.pay .due{background:#15171a;color:#fff;font-size:13px;font-weight:700}
.words{margin-top:6px;font-size:10px}
.note{white-space:pre-wrap;font-size:9.5px;color:#3c4047}
.chk{display:inline-block;width:10px;height:10px;border:1px solid #15171a;border-radius:2px;vertical-align:-1px;margin-right:4px;text-align:center;line-height:8px;font-size:9px}
.flags{display:flex;flex-wrap:wrap;gap:4px 16px}
.sig{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:38px;break-inside:avoid}
.sig div{border-top:1px dotted #15171a;text-align:center;padding-top:4px;font-size:8.5px;color:#3c4047}
.sig .who{font-size:10px;color:#15171a;margin-bottom:2px}
.esig{margin-top:14px;border:1px solid #1bb86a;background:#f0fbf5;border-radius:6px;padding:7px 10px;font-size:9.5px;break-inside:avoid}
.esig img{height:48px;display:block;margin-top:4px}
.ksef{display:flex;gap:14px;align-items:center;margin-top:14px;border:1px solid #cfd2d6;border-radius:6px;padding:10px;break-inside:avoid}.ksef .qr svg{width:110px;height:110px;display:block}.ksef .kl{font-size:8.5px;text-transform:uppercase;letter-spacing:.08em;color:#6b7078}.ksef .kn{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;margin:2px 0 4px}
.foot{margin-top:18px;padding-top:6px;border-top:1px solid #cfd2d6;font-size:8px;color:#6b7078;white-space:pre-wrap}
.dmg{display:grid;grid-template-columns:230px 1fr;gap:12px;align-items:start}
.gauge{display:inline-block;width:70px;height:7px;border:1px solid #15171a;border-radius:4px;vertical-align:middle;margin-left:4px;overflow:hidden}.gauge i{display:block;height:100%;background:#15171a}
@media print{html{background:#fff}.sheet{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}.bar{display:none}}
@media screen and (max-width:820px){.sheet{width:auto;margin:0;padding:14px}.head{grid-template-columns:1fr}.doc{text-align:left}.cols,.totals,.dmg{grid-template-columns:1fr}}
`;

export function companyBlock(S, { legal = false } = {}) {
  const addr = legal && S.company_legal_address ? S.company_legal_address : S.company_address;
  return `<div class="co">${legal ? '' : '<div class="adm">Administratorem danych osobowych jest:</div>'}<b>${esc(S.company_name || S.company_brand || '')}</b>
    ${esc(addr || '')}<br>${S.company_nip ? 'NIP: ' + esc(S.company_nip) + ' · ' : ''}${S.company_phone ? 'tel. ' + esc(S.company_phone) : ''}${S.company_email ? ' · ' + esc(S.company_email) : ''}
    ${legal && S.company_bank ? `<br>Nr konta: <b style="display:inline;font-size:10px">${esc(S.company_bank)}</b>${S.company_bank_name ? ' (' + esc(S.company_bank_name) + ')' : ''}` : ''}</div>`;
}

export function page({ S, title, number, meta = [], body, badge = '', legal = false, bar = true, back = '' }) {
  const logo = on(S, 'doc_show_logo') ? `<img class="logo" src="/logo-dark.png" alt="${esc(S.company_brand || 'Pulsecar')}">` : '<div></div>';
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} ${esc(number || '')}</title><link rel="icon" href="/favicon.png"><style>${CSS}</style></head><body>
${bar ? `<div class="bar">${back ? `<a class="alt" href="${esc(back)}">← Wróć</a>` : ''}<button onclick="print()">Drukuj / zapisz PDF</button></div>` : ''}
<div class="sheet">
<div class="head">${logo}${companyBlock(S, { legal })}
  <div class="doc"><h1>${esc(title)}</h1>${number ? `<div class="no">${esc(number)}</div>` : ''}
    <div class="meta">${meta.filter(Boolean).map(([k, v]) => `<div>${esc(k)}: <b>${esc(v)}</b></div>`).join('')}</div>${badge}</div>
</div>
${body}
${S.doc_footer ? `<div class="foot">${esc(S.doc_footer)}</div>` : ''}
</div></body></html>`;
}

const signer = (S, key, fallback) => (S[key + '_mode'] === 'default' && S[key + '_person']) ? S[key + '_person'] : (S[key + '_person'] || fallback || '');
const sigBlock = (left, right, leftName = '', rightName = '') => `<div class="sig"><div><div class="who">${esc(leftName)}</div>${esc(left)}</div><div><div class="who">${esc(rightName)}</div>${esc(right)}</div></div>`;

function partiesWorkshop(o, S, { contact = true } = {}) {
  const c = o.customer || {}, k = o.car || {};
  const addr = [c.street, [c.postcode, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const pct = fuelPct(o.fuel_level);
  return `<div class="cols">
    <div class="box"><h3>Dane klienta</h3><div class="n">${esc(c.company || c.name || '—')}</div>
      <div class="kv">${c.company && c.name ? `<span>Osoba</span><b>${esc(c.name)}</b>` : ''}${contact && c.phone ? `<span>Telefon</span><b>${esc(c.phone)}</b>` : ''}${contact && c.email ? `<span>E-mail</span><b>${esc(c.email)}</b>` : ''}
      ${c.nip ? `<span>NIP</span><b>${esc(c.nip)}</b>` : ''}${contact && addr ? `<span>Adres</span><b>${esc(addr)}</b>` : ''}</div></div>
    <div class="box"><h3>Dane pojazdu</h3><div class="n">${esc([k.make, k.model].filter(Boolean).join(' ') || '—')}${k.year ? ` <span class="sub">${esc(Math.trunc(Number(k.year)) || k.year)}</span>` : ''}</div>
      <div class="kv"><span>Nr rejestracyjny</span><b>${esc(k.plate || '—')}</b><span>VIN</span><b class="mono">${esc(k.vin || '—')}</b>
      ${o.mileage ? `<span>Przebieg</span><b>${esc(Number(o.mileage).toLocaleString('pl-PL'))} ${esc(S.mileage_unit === 'mi' ? 'mil' : S.mileage_unit === 'mth' ? 'mth' : 'km')}</b>` : ''}
      ${o.fuel_level ? `<span>Poziom paliwa</span><b>${esc(fuelPl(o.fuel_level))}${pct != null ? `<span class="gauge"><i style="width:${pct}%"></i></span>` : ''}</b>` : ''}
      ${k.engine ? `<span>Silnik</span><b>${esc(k.engine)}</b>` : ''}</div></div>
  </div>`;
}

const FLAG_PL = { return_parts: 'Zwrot wymienionych części', reg_doc: 'Pozostawiono dowód rejestracyjny', test_drive: 'Zgoda na jazdę próbną', fluids: 'Uzupełnić płyny', lights: 'Sprawdzić oświetlenie' };
const flagsBlock = (f = {}) => `<div class="flags">${Object.entries(FLAG_PL).map(([k, l]) => `<span><span class="chk">${f[k] ? '✓' : ''}</span>${esc(l)}</span>`).join('')}</div>`;

// ── Схема повреждений (своя векторная машина, вид сверху) ─────────────────
export const DAMAGE_TYPES = { rysa: 'Rysa', wgniecenie: 'Wgniecenie', odprysk: 'Odprysk', pekniecie: 'Pęknięcie', korozja: 'Korozja', brak: 'Brak elementu', inne: 'Inne' };
export function carSvg(marks = [], { w = 220 } = {}) {
  const pins = marks.map((m, i) => `<g><circle cx="${Number(m.x) * 2}" cy="${Number(m.y) * 4}" r="9" fill="#e34948" stroke="#fff" stroke-width="2"/><text x="${Number(m.x) * 2}" y="${Number(m.y) * 4 + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff" font-family="Arial">${i + 1}</text></g>`).join('');
  return `<svg viewBox="0 0 200 400" width="${w}" style="max-width:100%;height:auto;display:block" role="img" aria-label="Schemat pojazdu">
  <text x="100" y="12" text-anchor="middle" font-size="10" fill="#6b7078" font-family="Arial">PRZÓD</text>
  <text x="100" y="396" text-anchor="middle" font-size="10" fill="#6b7078" font-family="Arial">TYŁ</text>
  <path d="M60 40 Q100 18 140 40 L152 90 L156 170 L156 300 L150 350 Q100 378 50 350 L44 300 L44 170 L48 90 Z" fill="#f4f5f7" stroke="#15171a" stroke-width="2"/>
  <path d="M62 96 Q100 80 138 96 L132 132 Q100 124 68 132 Z" fill="#dfe2e6" stroke="#15171a" stroke-width="1.5"/>
  <path d="M68 262 Q100 270 132 262 L138 300 Q100 312 62 300 Z" fill="#dfe2e6" stroke="#15171a" stroke-width="1.5"/>
  <rect x="68" y="138" width="64" height="118" rx="10" fill="#fff" stroke="#15171a" stroke-width="1.2"/>
  <path d="M44 150 L34 150 L34 170 L44 170 M156 150 L166 150 L166 170 L156 170" fill="none" stroke="#15171a" stroke-width="1.5"/>
  <rect x="30" y="70" width="14" height="44" rx="4" fill="#15171a"/><rect x="156" y="70" width="14" height="44" rx="4" fill="#15171a"/>
  <rect x="30" y="286" width="14" height="44" rx="4" fill="#15171a"/><rect x="156" y="286" width="14" height="44" rx="4" fill="#15171a"/>
  <line x1="46" y1="190" x2="154" y2="190" stroke="#cfd2d6" stroke-width="1"/>
  ${pins}</svg>`;
}
export const damageList = (marks = []) => marks.length
  ? `<table><thead><tr><th style="width:24px">#</th><th>Rodzaj</th><th>Opis</th></tr></thead><tbody>${marks.map((m, i) => `<tr><td>${i + 1}</td><td>${esc(DAMAGE_TYPES[m.type] || m.type || '')}</td><td>${esc(m.note || '')}</td></tr>`).join('')}</tbody></table>`
  : '<div class="sub">Brak adnotacji o uszkodzeniach</div>';

// ── Позиции заказа для документов ──────────────────────────────────────────
function itemLines(o, S) {
  const codeFirst = S.doc_code_in_name === '1';
  return o.items.map((i) => {
    const gross = lineGross(i);
    const v = Number(i.vat ?? 23);
    const net = round2(gross / (1 + v / 100));
    const unitGross = i.qty ? round2(gross / i.qty) : 0;
    const unitNet = i.qty ? round2(net / i.qty) : 0;
    const p = i.product_id ? one('SELECT manufacturer, location, gtu FROM products WHERE id = ?', i.product_id) : null;
    return { ...i, gross, net, vatAmt: round2(gross - net), unitGross, unitNet, v, brand: p?.manufacturer || null, location: p?.location || null, gtu: p?.gtu || null,
      label: codeFirst && i.code && i.kind === 'part' ? `${i.code} ${i.name}` : i.name };
  });
}

const orderMeta = (o) => [['Data przyjęcia', d10(o.created_at)], o.pickup_at ? ['Termin odbioru', String(o.pickup_at).replace('T', ' ').slice(0, 16)] : null, o.external_no ? ['Nr zewnętrzny', o.external_no] : null];

/** Таблица работ и запчастей с колонками по настройкам */
function itemsTables(L, S, { prefix, showQty = true, prices = true, emptyLabor = 0, emptyParts = 0, mechanicCol = false, stationCol = false, doneCol = false, gross = true, net = false, code, brand }) {
  const labor = L.filter((i) => i.kind === 'labor'), parts = L.filter((i) => i.kind === 'part');
  const uNet = prices && S[prefix + '_labor_net'] === '1', uGross = prices && S[prefix + '_labor_gross'] !== '0';
  const pNet = prices && S[prefix + '_parts_net'] === '1', pGross = prices && S[prefix + '_parts_gross'] !== '0';
  const pCode = code ?? S[prefix + '_parts_code'] === '1', pBrand = brand ?? S[prefix + '_parts_brand'] !== '0';
  const sumCols = (arr) => `${net && prices ? `<td class="r">${zl(arr.reduce((s, i) => s + i.net, 0))}</td>` : ''}${gross && prices ? `<td class="r">${zl(arr.reduce((s, i) => s + i.gross, 0))}</td>` : ''}`;
  const lt = labor.length || emptyLabor ? `<div class="sec"><h3>Usługi</h3><table><thead><tr>${doneCol ? '<th style="width:22px"></th>' : ''}<th style="width:22px">Lp.</th><th>Nazwa usługi</th>${mechanicCol ? '<th>Mechanik</th>' : ''}${stationCol ? '<th>Stanowisko</th>' : ''}
      ${showQty ? '<th class="r">Ilość</th><th>J.m.</th>' : ''}${uNet ? '<th class="r">Cena jedn. netto</th>' : ''}${uGross ? '<th class="r">Cena jedn. brutto</th>' : ''}${prices && S.discounts_on !== '0' && L.some((i) => i.discount) ? '<th class="r">Rabat</th>' : ''}${net && prices ? '<th class="r">Wartość netto</th>' : ''}${gross && prices ? '<th class="r">Wartość brutto</th>' : ''}</tr></thead><tbody>
    ${labor.map((i, n) => `<tr>${doneCol ? `<td><span class="chk">${i.done ? '✓' : ''}</span></td>` : ''}<td>${n + 1}</td><td>${esc(i.label)}</td>${mechanicCol ? `<td>${esc(i.mechanic_name || '')}</td>` : ''}${stationCol ? `<td>${esc(i.station_name || '')}</td>` : ''}
      ${showQty ? `<td class="r">${qtyFmt(i.qty)}</td><td>${esc(i.unit || 'usł.')}</td>` : ''}${uNet ? `<td class="r">${zl(i.unitNet)}</td>` : ''}${uGross ? `<td class="r">${zl(i.unitGross)}</td>` : ''}${prices && S.discounts_on !== '0' && L.some((x) => x.discount) ? `<td class="r">${i.discount ? i.discount + '%' : ''}</td>` : ''}${net && prices ? `<td class="r">${zl(i.net)}</td>` : ''}${gross && prices ? `<td class="r">${zl(i.gross)}</td>` : ''}</tr>`).join('')}
    ${Array.from({ length: emptyLabor }, () => `<tr class="empty"><td colspan="12"></td></tr>`).join('')}
    ${prices && labor.length ? `<tr class="sum"><td colspan="${1 + (doneCol ? 1 : 0) + 1 + (mechanicCol ? 1 : 0) + (stationCol ? 1 : 0) + (showQty ? 2 : 0) + (uNet ? 1 : 0) + (uGross ? 1 : 0) + (S.discounts_on !== '0' && L.some((x) => x.discount) ? 1 : 0)}" class="r">Razem usługi</td>${sumCols(labor)}</tr>` : ''}</tbody></table></div>` : '';
  const pt = parts.length || emptyParts ? `<div class="sec"><h3>Części i materiały</h3><table><thead><tr><th style="width:22px">Lp.</th><th>Nazwa towaru</th>${pCode ? '<th>Kod</th>' : ''}${pBrand ? '<th>Producent</th>' : ''}
      ${showQty ? '<th class="r">Ilość</th><th>J.m.</th>' : ''}${pNet ? '<th class="r">Cena jedn. netto</th>' : ''}${pGross ? '<th class="r">Cena jedn. brutto</th>' : ''}${prices && S.discounts_on !== '0' && L.some((i) => i.discount) ? '<th class="r">Rabat</th>' : ''}${net && prices ? '<th class="r">Wartość netto</th>' : ''}${gross && prices ? '<th class="r">Wartość brutto</th>' : ''}</tr></thead><tbody>
    ${parts.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.label)}</td>${pCode ? `<td class="mono">${esc(i.code || '')}</td>` : ''}${pBrand ? `<td>${esc(i.brand || '')}</td>` : ''}
      ${showQty ? `<td class="r">${qtyFmt(i.qty)}</td><td>${esc(i.unit || 'szt.')}</td>` : ''}${pNet ? `<td class="r">${zl(i.unitNet)}</td>` : ''}${pGross ? `<td class="r">${zl(i.unitGross)}</td>` : ''}${prices && S.discounts_on !== '0' && L.some((x) => x.discount) ? `<td class="r">${i.discount ? i.discount + '%' : ''}</td>` : ''}${net && prices ? `<td class="r">${zl(i.net)}</td>` : ''}${gross && prices ? `<td class="r">${zl(i.gross)}</td>` : ''}</tr>`).join('')}
    ${Array.from({ length: emptyParts }, () => `<tr class="empty"><td colspan="12"></td></tr>`).join('')}
    ${prices && parts.length ? `<tr class="sum"><td colspan="${1 + 1 + (pCode ? 1 : 0) + (pBrand ? 1 : 0) + (showQty ? 2 : 0) + (pNet ? 1 : 0) + (pGross ? 1 : 0) + (S.discounts_on !== '0' && L.some((x) => x.discount) ? 1 : 0)}" class="r">Razem części</td>${sumCols(parts)}</tr>` : ''}</tbody></table></div>` : '';
  return lt + pt;
}

function totalsBox(o, L, { paid = true } = {}) {
  const net = round2(L.reduce((s, i) => s + i.net, 0)), gross = round2(L.reduce((s, i) => s + i.gross, 0));
  const due = round2(gross - (o.paid || 0));
  return `<div class="pay"><div><span>Razem netto</span><b>${zl(net)} zł</b></div><div><span>VAT</span><b>${zl(gross - net)} zł</b></div><div><span>Razem brutto</span><b>${zl(gross)} zł</b></div>
    ${paid && o.paid > 0 ? `<div><span>Zapłacono</span><b>${zl(o.paid)} zł</b></div><div class="due"><span>Do zapłaty</span><span>${zl(Math.max(0, due))} zł</span></div>` : `<div class="due"><span>Do zapłaty</span><span>${zl(gross)} zł</span></div>`}</div>`;
}

export const SIG_KIND = { intake: 'Protokół przyjęcia', estimate: 'Kosztorys', quote: 'Wycena', release: 'Protokół wydania' };
export const SIG_METHOD = { button: 'Przycisk „Akceptuję”', sms: 'Kod SMS', drawn: 'Podpis odręczny', paper: 'Podpis na papierze' };
function esigNote(o, doc) {
  const s = one('SELECT * FROM order_signatures WHERE order_id = ? AND doc = ? ORDER BY id DESC LIMIT 1', o.id, doc);
  if (!s) return '';
  return `<div class="esig">✓ Dokument podpisany elektronicznie przez klienta ${esc(s.signer_name || '')} · ${esc(String(s.signed_at).slice(0, 16))} · ${esc(SIG_METHOD[s.method] || s.method)}${s.phone ? ' · tel. ' + esc(s.phone) : ''}${s.image ? `<img src="${esc(s.image)}" alt="Podpis klienta">` : ''}</div>`;
}

// ── Документы мастерской ───────────────────────────────────────────────────
export function orderDoc(type, orderId, { S = settingsMap(), bar = true, back = '' } = {}) {
  const o = orderFull(orderId);
  o.mechanic_name = o.mechanic_id ? one('SELECT name FROM staff WHERE id = ?', o.mechanic_id)?.name : '';
  const st = all(`SELECT a.order_id, st.name FROM appointments a JOIN stations st ON st.id = a.station_id WHERE a.order_id = ?`, o.id)[0]?.name || '';
  const L = itemLines(o, S).map((i) => ({ ...i, station_name: st }));
  const damages = safeJson(o.damages, []);
  const signerName = (k) => S[k + '_person'] || o.created_by || '';
  const quote = o.kind === 'quote';
  if (type === 'intake') {
    const tasks = L.filter((i) => i.kind === 'labor');
    const body = `${partiesWorkshop(o, S)}
      ${o.complaint ? `<div class="sec box"><h3>Opis zlecenia / zgłoszenie klienta</h3><div class="note">${esc(o.complaint)}</div></div>` : ''}
      ${S.card_intake_tasks !== '0' && tasks.length ? `<div class="sec"><h3>Zakres prac do wykonania</h3><table><tbody>${tasks.map((i, n) => `<tr><td style="width:22px">${n + 1}</td><td>${esc(i.name)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="sec"><h3>Stan pojazdu przy przyjęciu</h3><div class="dmg">${carSvg(damages)}<div>${damageList(damages)}</div></div></div>
      <div class="sec box"><h3>Ustalenia</h3>${flagsBlock(o.flags)}</div>
      ${S.card_rodo ? `<div class="sec note">${esc(S.card_rodo)}</div>` : ''}
      ${S.intake_terms || S.order_terms ? `<div class="sec note">${esc(S.intake_terms || S.order_terms)}</div>` : ''}
      ${esigNote(o, 'intake')}
      ${on(S, 'doc_show_signatures') ? sigBlock('Podpis osoby przyjmującej pojazd', 'Podpis klienta', signerName('intake')) : ''}`;
    return page({ S, title: 'Protokół przyjęcia pojazdu', number: o.number, meta: orderMeta(o), body, bar, back });
  }
  if (type === 'spec') {
    const body = `${partiesWorkshop(o, S)}
      ${o.complaint ? `<div class="sec box"><h3>Opis zlecenia</h3><div class="note">${esc(o.complaint)}</div></div>` : ''}
      ${itemsTables(L, S, { prefix: 'spec', showQty: S.spec_qty !== '0', code: S.spec_parts_code === '1', net: true })}
      <div class="totals"><div>${o.faults ? `<div class="box" style="margin-bottom:8px"><h3>Wykryte usterki</h3><div class="note">${esc(o.faults)}</div></div>` : ''}
        ${S.spec_after_notes !== '0' && o.after_notes ? `<div class="box"><h3>Uwagi po wykonaniu zlecenia</h3><div class="note">${esc(o.after_notes)}</div></div>` : ''}</div>${totalsBox(o, L)}</div>
      ${on(S, 'doc_show_signatures') ? sigBlock('Podpis osoby upoważnionej do wystawienia', 'Podpis klienta', signerName('spec')) : ''}`;
    return page({ S, title: 'Specyfikacja zlecenia', number: o.number, meta: orderMeta(o), body, bar, back });
  }
  if (type === 'mechanic') {
    const body = `${S.mech_contact !== '0' ? partiesWorkshop(o, S) : partiesWorkshop(o, S, { contact: false })}
      ${S.mech_basic !== '0' ? `<div class="cols"><div class="box kv"><span>Przyjął</span><b>${esc(o.created_by || '')}</b><span>Mechanik</span><b>${esc(o.mechanic_name || '')}</b><span>Termin</span><b>${esc(o.pickup_at || '—')}</b></div>
        <div class="box"><h3>Zgłoszenie klienta</h3><div class="note">${esc(o.complaint || '—')}</div></div></div>` : ''}
      ${o.mechanic_note ? `<div class="sec box"><h3>Uwagi dla mechanika</h3><div class="note">${esc(o.mechanic_note)}</div></div>` : ''}
      ${itemsTables(L, S, { prefix: 'mech', prices: false, doneCol: true, mechanicCol: true, stationCol: S.mech_station !== '0', code: S.mech_code !== '0', brand: true, emptyLabor: Number(S.mech_extra_labor ?? 3), emptyParts: Number(S.mech_extra_parts ?? 3) })}
      <div class="sec box"><h3>Wykryte usterki / zalecenia</h3><div style="height:70px"></div></div>
      ${S.mech_vehicle_end !== '0' ? `<div class="sec box kv"><span>Pojazd</span><b>${esc([o.car?.make, o.car?.model, o.car?.plate].filter(Boolean).join(' '))}</b><span>VIN</span><b class="mono">${esc(o.car?.vin || '')}</b><span>Przebieg</span><b>${o.mileage ? esc(o.mileage) + ' km' : '—'}</b></div>` : ''}
      ${sigBlock('Podpis mechanika', 'Kontrola jakości')}`;
    return page({ S, title: 'Karta dla mechanika', number: o.number, meta: orderMeta(o), body, bar, back });
  }
  if (type === 'estimate') {
    const validDays = Number(S.quote_valid_days || 14);
    const valid = new Date(Date.now() + validDays * 86400000).toISOString().slice(0, 10);
    const body = `${partiesWorkshop(o, S)}
      ${o.complaint ? `<div class="sec box"><h3>Opis</h3><div class="note">${esc(o.complaint)}</div></div>` : ''}
      ${itemsTables(L, S, { prefix: 'est', net: S.est_net === '1', gross: S.est_gross !== '0' })}
      <div class="totals"><div>${S.est_extra ? `<div class="note">${esc(S.est_extra)}</div>` : ''}${quote ? `<div class="sub" style="margin-top:6px">Wycena ważna do ${esc(valid)}. Ceny mogą ulec zmianie po weryfikacji dostępności części.</div>` : ''}</div>${totalsBox(o, L, { paid: !quote })}</div>
      ${esigNote(o, quote ? 'quote' : 'estimate')}
      ${on(S, 'doc_show_signatures') ? sigBlock('Podpis osoby upoważnionej do wystawienia', 'Akceptacja klienta', signerName('est')) : ''}`;
    return page({ S, title: quote ? 'Wycena' : 'Kosztorys naprawy', number: o.number, meta: [['Data', d10(o.created_at)], quote ? ['Ważna do', valid] : orderMeta(o)[1]], body, bar, back });
  }
  if (type === 'release') {
    const done = L.filter((i) => i.kind === 'labor' && (i.done || o.closed_at));
    const parts = L.filter((i) => i.kind === 'part');
    const body = `${partiesWorkshop(o, S)}
      <div class="sec"><h3>Wykonane prace</h3><table><tbody>${(done.length ? done : L.filter((i) => i.kind === 'labor')).map((i, n) => `<tr><td style="width:22px">${n + 1}</td><td>${esc(i.name)}</td></tr>`).join('') || '<tr><td class="sub">—</td></tr>'}</tbody></table></div>
      ${parts.length ? `<div class="sec"><h3>Wymienione części</h3><table><tbody>${parts.map((i, n) => `<tr><td style="width:22px">${n + 1}</td><td>${esc(i.name)}</td><td class="mono">${esc(i.code || '')}</td><td class="r">${qtyFmt(i.qty)} ${esc(i.unit || 'szt.')}</td></tr>`).join('')}</tbody></table>
        <div class="sub" style="margin-top:4px">Wymienione części ${o.flags?.return_parts ? 'zostały zwrócone klientowi' : 'pozostały w warsztacie do utylizacji'}.</div></div>` : ''}
      ${o.after_notes ? `<div class="sec box"><h3>Uwagi po wykonaniu zlecenia</h3><div class="note">${esc(o.after_notes)}</div></div>` : ''}
      ${o.faults ? `<div class="sec box"><h3>Zalecenia</h3><div class="note">${esc(o.faults)}</div></div>` : ''}
      <div class="sec box"><div class="kv"><span>Przebieg przy wydaniu</span><b>${o.mileage ? esc(o.mileage) + ' km' : '—'}</b><span>Data wydania</span><b>${esc(d10(o.closed_at) || today())}</b><span>Wartość zlecenia</span><b>${zl(o.total)} zł</b><span>Zapłacono</span><b>${zl(o.paid)} zł</b></div></div>
      <div class="sec note">${esc(S.release_terms || 'Klient potwierdza odbiór pojazdu wraz z dokumentami i kluczykami. Na wykonane usługi udzielana jest gwarancja zgodnie z warunkami warsztatu, na części — zgodnie z gwarancją producenta.')}</div>
      ${esigNote(o, 'release')}
      ${on(S, 'doc_show_signatures') ? sigBlock('Podpis osoby wydającej pojazd', 'Podpis klienta — odbiór pojazdu', signerName('release')) : ''}`;
    return page({ S, title: 'Protokół wydania pojazdu', number: o.number, meta: [['Data przyjęcia', d10(o.created_at)], ['Data wydania', d10(o.closed_at) || today()]], body, bar, back });
  }
  throw new HttpError(404, 'Нет такого документа');
}
function safeJson(s, d) { try { return s ? JSON.parse(s) : d; } catch { return d; } }

// ── Фактуры: VAT, Pro forma, корректа ──────────────────────────────────────
export const SALE_KIND = { vat: 'Faktura VAT', proforma: 'Faktura Pro forma', correction: 'Faktura korygująca' };
const NUM_KEY = { vat: 'FV', proforma: 'PRO', correction: 'FK' };

/** Позиции фактуры из заказа (снимок: цены не меняются задним числом) */
export function saleLinesFromOrder(o, S = settingsMap()) {
  const desc = S.sale_group_by_order === '1';
  return itemLines(o, S).map((i) => ({
    name: i.kind === 'part' && S.sale_code === '1' && i.code ? `${i.name} (${i.code})` : i.name, code: i.code || null, kind: i.kind, qty: i.qty, unit: i.unit || (i.kind === 'labor' ? 'usł.' : 'szt.'),
    unit_net: i.unitNet, discount: i.discount || 0, vat: i.v, net: i.net, vat_amt: i.vatAmt, gross: i.gross, gtu: i.gtu || null, group: desc ? o.number : null,
  }));
}
export const sumLines = (lines) => {
  const byRate = {};
  for (const l of lines) {
    const r = (byRate[l.vat] ||= { rate: l.vat, net: 0, vat: 0, gross: 0 });
    r.net = round2(r.net + l.net); r.vat = round2(r.vat + l.vat_amt); r.gross = round2(r.gross + l.gross);
  }
  const rates = Object.values(byRate).sort((a, b) => b.rate - a.rate);
  return { rates, net: round2(rates.reduce((s, r) => s + r.net, 0)), vat: round2(rates.reduce((s, r) => s + r.vat, 0)), gross: round2(rates.reduce((s, r) => s + r.gross, 0)) };
};

export function buyerFromCustomer(c = {}) {
  return { name: c.company || c.name || 'Klient detaliczny', nip: (c.nip || '').replace(/[^\dA-Z]/gi, ''), street: c.street || '', postcode: c.postcode || '', city: c.city || '', email: c.email || '', phone: c.phone || '' };
}

export function createSaleDoc({ kind, orderId, buyer, issue_date, sale_date, payment_method, due_days, notes, lines, ext, corrects_id, reason, paid }, staffName) {
  if (!SALE_KIND[kind]) throw new HttpError(400, 'Неизвестный тип документа');
  const S = settingsMap();
  const o = orderId ? orderFull(orderId) : null;
  const L = lines || (o ? saleLinesFromOrder(o, S) : []);
  if (!L.length) throw new HttpError(400, 'В документе нет позиций');
  const T = sumLines(L);
  const issue = /^\d{4}-\d{2}-\d{2}$/.test(issue_date || '') ? issue_date : today();
  const sale = /^\d{4}-\d{2}-\d{2}$/.test(sale_date || '') ? sale_date : d10(o?.closed_at) || issue;
  const days = Number(due_days ?? S.payment_term_days ?? 0) || 0;
  const due = new Date(new Date(issue).getTime() + days * 86400000).toISOString().slice(0, 10);
  // заказ оплачен несколькими способами (наличные + карта и т.п.) → «Płatność mieszana»
  const methods = o ? all(`SELECT DISTINCT method FROM payments WHERE order_id = ? AND direction = 'in' AND method <> 'points' ORDER BY amount DESC`, o.id).map((r) => r.method) : [];
  const pm = payment_method || (methods.length > 1 ? 'mixed' : methods[0]) || S.payment_method_default || 'cash';
  const paidAmt = kind === 'proforma' ? 0 : round2(paid ?? Math.min(T.gross, o?.paid || 0));
  const number = ext?.number || nextNumber(NUM_KEY[kind], new Date(issue));
  const id = insert('sales_docs', {
    kind, number, order_id: o?.id || null, corrects_id: corrects_id || null, issue_date: issue, sale_date: sale, due_date: due, place: S.doc_place || 'Warszawa',
    payment_method: pm, paid: paidAmt, buyer: JSON.stringify(buyer || buyerFromCustomer(o?.customer || {})), items: JSON.stringify(L),
    total_net: T.net, total_vat: T.vat, total_gross: T.gross, notes: notes || null, reason: reason || null,
    ext_id: ext?.id ? String(ext.id) : null, ext_url: ext?.url || null, ksef: ext ? 1 : 0, created_by: staffName || null,
  });
  // оплаты заказа → разбивка на фактуре (наличные / карта / BLIK / перевод), в пределах суммы документа
  if (o && kind === 'vat') {
    const by = all(`SELECT method, ROUND(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 2) amount FROM payments WHERE order_id = ? AND method <> 'points' AND transfer_id IS NULL GROUP BY method HAVING amount > 0 ORDER BY amount DESC`, o.id);
    let left = paidAmt; const split = [];
    for (const p of by) { const a = round2(Math.min(p.amount, left)); if (a > 0) { split.push({ method: p.method, amount: a }); left = round2(left - a); } }
    if (split.length > 1 || pm === 'mixed') run('UPDATE sales_docs SET pay_split = ? WHERE id = ?', JSON.stringify(split), id);
  }
  if (o && kind === 'vat') run('UPDATE orders SET invoice_no = COALESCE(invoice_no, ?) WHERE id = ?', number, o.id);
  return one('SELECT * FROM sales_docs WHERE id = ?', id);
}

export function saleDocHtml(id, { S = settingsMap(), bar = true, back = '' } = {}) {
  const d = one('SELECT * FROM sales_docs WHERE id = ?', id);
  if (!d) throw new HttpError(404, 'Документ не найден');
  const b = safeJson(d.buyer, {});
  const L = safeJson(d.items, []);
  const o = d.order_id ? one('SELECT o.number, c.make, c.model, c.plate, c.vin, o.mileage FROM orders o LEFT JOIN cars c ON c.id = o.car_id WHERE o.id = ?', d.order_id) : null;
  const orig = d.corrects_id ? one('SELECT * FROM sales_docs WHERE id = ?', d.corrects_id) : null;
  const showCode = S.sale_code === '1', showGtu = S.sale_gtu === '1', showDisc = S.sale_discount === '1' && L.some((l) => l.discount);
  const lineRows = (arr) => arr.map((l, n) => `<tr><td>${n + 1}</td><td>${esc(l.name)}${showGtu && l.gtu ? ` <span class="sub">${esc(l.gtu)}</span>` : ''}</td>${showCode ? `<td class="mono">${esc(l.code || '')}</td>` : ''}
    <td class="r">${qtyFmt(l.qty)}</td><td>${esc(l.unit)}</td><td class="r">${zl(l.unit_net)}</td>${showDisc ? `<td class="r">${l.discount ? l.discount + '%' : ''}</td>` : ''}<td class="r">${zl(l.net)}</td><td class="c">${l.vat}%</td><td class="r">${zl(l.vat_amt)}</td><td class="r">${zl(l.gross)}</td></tr>`).join('');
  const head = `<thead><tr><th style="width:22px">Lp.</th><th>Nazwa towaru / usługi</th>${showCode ? '<th>Kod</th>' : ''}<th class="r">Ilość</th><th>J.m.</th><th class="r">Cena netto</th>${showDisc ? '<th class="r">Rabat</th>' : ''}<th class="r">Wartość netto</th><th class="c">VAT</th><th class="r">Kwota VAT</th><th class="r">Wartość brutto</th></tr></thead>`;
  const T = { net: d.total_net, vat: d.total_vat, gross: d.total_gross, rates: sumLines(L).rates };
  const rateTable = (t, label = '') => `<table style="margin-top:6px"><thead><tr><th>${label || 'Stawka VAT'}</th><th class="r">Netto</th><th class="r">VAT</th><th class="r">Brutto</th></tr></thead><tbody>
    ${t.rates.map((r) => `<tr><td>${r.rate}%</td><td class="r">${zl(r.net)}</td><td class="r">${zl(r.vat)}</td><td class="r">${zl(r.gross)}</td></tr>`).join('')}
    <tr class="sum"><td>Razem</td><td class="r">${zl(t.net)}</td><td class="r">${zl(t.vat)}</td><td class="r">${zl(t.gross)}</td></tr></tbody></table>`;
  let items, totals, due;
  if (d.kind === 'correction' && orig) {
    const OL = safeJson(orig.items, []);
    const diff = round2(d.total_gross - orig.total_gross);
    items = `<div class="sec"><h3>Przed korektą</h3><table>${head}<tbody>${lineRows(OL)}</tbody></table></div>
      <div class="sec"><h3>Po korekcie</h3><table>${head}<tbody>${lineRows(L)}</tbody></table></div>`;
    due = diff;
    totals = `<div class="totals"><div>${rateTable({ ...T, rates: sumLines(L).rates }, 'Po korekcie')}<div class="words"><b>Przyczyna korekty:</b> ${esc(d.reason || '—')}</div></div>
      <div class="pay"><div><span>Wartość przed korektą</span><b>${zl(orig.total_gross)} zł</b></div><div><span>Wartość po korekcie</span><b>${zl(d.total_gross)} zł</b></div>
      <div class="due"><span>${diff < 0 ? 'Do zwrotu' : 'Do zapłaty'}</span><span>${zl(Math.abs(diff))} zł</span></div></div></div>
      <div class="words">Słownie: ${esc(slownie(Math.abs(diff)))}</div>`;
  } else {
    due = round2(d.total_gross - d.paid);
    items = `<div class="sec"><table>${head}<tbody>${lineRows(L)}</tbody></table></div>`;
    totals = `<div class="totals"><div>${rateTable(T)}</div>
      <div class="pay"><div><span>Razem netto</span><b>${zl(d.total_net)} zł</b></div><div><span>Razem VAT</span><b>${zl(d.total_vat)} zł</b></div><div><span>Razem brutto</span><b>${zl(d.total_gross)} zł</b></div>
      ${d.paid > 0 ? `<div><span>Zapłacono</span><b>${zl(d.paid)} zł</b></div>` : ''}<div class="due"><span>Do zapłaty</span><span>${zl(Math.max(0, due))} zł</span></div></div></div>
      <div class="words">Słownie: ${esc(slownie(Math.max(0, d.kind === 'proforma' ? d.total_gross : due) || d.total_gross))}</div>`;
  }
  const mpp = d.kind === 'vat' && d.total_gross >= 15000 && S.sale_mpp !== '0';
  // KSeF: QR «KOD I» (ссылка на проверку фактуры в Минфине) и номер KSeF под ним
  let ksefBox = '';
  if (d.ksef_hash) {
    const env = KSEF_ENVS[d.ksef_env] || KSEF_ENVS.prod;
    const [y, m, dd] = d.issue_date.split('-');
    const url = `${env.qr}/invoice/${String(S.company_nip || '').replace(/\D/g, '')}/${dd}-${m}-${y}/${Buffer.from(d.ksef_hash, 'base64').toString('base64url')}`;
    ksefBox = `<div class="ksef"><div class="qr" data-qr="${esc(url)}"></div><div><div class="kl">Numer KSeF</div><div class="kn">${esc(d.ksef_number || 'OFFLINE')}</div>
      <div class="sub">Faktura wystawiona w Krajowym Systemie e-Faktur. Zeskanuj kod, aby zweryfikować fakturę.</div></div></div>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
      <script>document.querySelectorAll('[data-qr]').forEach(function(el){try{var q=qrcode(0,'M');q.addData(el.dataset.qr);q.make();el.innerHTML=q.createSvgTag({cellSize:3,margin:0});}catch(e){el.textContent=el.dataset.qr}})</script>`;
  }
  const body = `<div class="cols">
      <div class="box"><h3>Sprzedawca</h3><div class="n">${esc(S.company_legal_name || S.company_name || '')}</div>${esc(S.company_legal_address || S.company_address || '')}<br>NIP: <b>${esc(S.company_nip || '—')}</b>${S.company_bank ? `<br>Nr konta: <b>${esc(S.company_bank)}</b>` : ''}</div>
      <div class="box"><h3>Nabywca</h3><div class="n">${esc(b.name || '')}</div>${esc([b.street, [b.postcode, b.city].filter(Boolean).join(' ')].filter(Boolean).join(', '))}${b.nip ? `<br>NIP: <b>${esc(b.nip)}</b>` : ''}</div>
    </div>
    ${d.proforma_id ? (() => { const pf = one('SELECT number, issue_date FROM sales_docs WHERE id = ?', d.proforma_id); return pf ? `<div class="sub" style="margin-bottom:6px">Wystawiona na podstawie faktury pro forma ${esc(pf.number)} z dnia ${esc(pf.issue_date)}</div>` : ''; })() : ''}
    ${d.kind === 'correction' && orig ? `<div class="sec box kv"><span>Dotyczy faktury</span><b>${esc(orig.number)} z dnia ${esc(orig.issue_date)}</b><span>Data sprzedaży</span><b>${esc(orig.sale_date)}</b></div>` : ''}
    ${(() => { const c = safeJson(d.car, null); if (!c) return ''; const t = [[c.make, c.model, c.year].filter(Boolean).join(' '), c.plate && `nr rej. ${c.plate}`, c.vin && `VIN ${c.vin}`, c.mileage && `przebieg ${c.mileage} km`, c.engine && `silnik ${c.engine}`].filter(Boolean);
      return t.length ? `<div class="sec box kv"><span>Pojazd</span><b>${esc(t.join(' · '))}</b></div>` : ''; })()}
    ${o && S.sale_order_line !== '0' ? `<div class="sub" style="margin-bottom:6px">Zlecenie ${esc(o.number)}${o.make ? ` · ${esc([o.make, o.model, o.plate].filter(Boolean).join(' '))}` : ''}${o.vin ? ` · VIN ${esc(o.vin)}` : ''}${o.mileage ? ` · przebieg ${esc(o.mileage)} km` : ''}</div>` : ''}
    ${items}${totals}
    <div class="cols" style="margin-top:10px"><div class="box kv"><span>Sposób płatności</span><b>${esc(PAY_PL[d.payment_method] || d.payment_method)}${(() => { const p = safeJson(d.pay_split, null); return p?.length ? `<br><span class="sub">${esc(p.map((x) => `${PAY_PL[x.method] || x.method}: ${zl(x.amount)} zł`).join(', '))}</span>` : ''; })()}</b><span>Termin płatności</span><b>${esc(d.due_date)}</b>${S.company_bank && d.payment_method === 'transfer' ? `<span>Rachunek</span><b>${esc(S.company_bank)}</b>` : ''}</div>
      ${(() => { const t = `${mpp ? '<b>Mechanizm podzielonej płatności</b><br>' : ''}${d.kind === 'proforma' ? '<b>Dokument nie jest fakturą VAT</b> i nie stanowi podstawy do odliczenia podatku.<br>' : ''}${d.ksef && d.ext_id ? 'Faktura przekazana do KSeF przez Fakturownia.<br>' : ''}${d.ksef_number ? 'Faktura przyjęta w KSeF.<br>' : ''}${esc(d.notes || '')}`; return t ? `<div class="box">${t}</div>` : '<div></div>'; })()}</div>
    ${ksefBox}
    ${[S.company_krs && `KRS ${S.company_krs}${S.company_court ? ', ' + S.company_court : ''}`, S.company_regon && `REGON ${S.company_regon}`, S.company_bdo && `BDO ${S.company_bdo}`, S.company_capital && `Kapitał zakładowy ${S.company_capital}`].filter(Boolean).length
      ? `<div class="sec sub">${esc([S.company_krs && `KRS ${S.company_krs}${S.company_court ? ', ' + S.company_court : ''}`, S.company_regon && `REGON ${S.company_regon}`, S.company_bdo && `Nr BDO ${S.company_bdo}`, S.company_capital && `Kapitał zakładowy ${S.company_capital}`].filter(Boolean).join(' · '))}</div>` : ''}
    ${S.sale_footer ? `<div class="sec note">${esc(S.sale_footer)}</div>` : ''}
    ${d.ksef_hash ? '' : sigBlock('Osoba upoważniona do wystawienia', 'Osoba upoważniona do odbioru', S.sale_person || d.created_by || '')}`;
  return page({
    S, title: SALE_KIND[d.kind], number: d.number, legal: true, bar, back,
    meta: [['Data wystawienia', d.issue_date], d.kind !== 'proforma' ? ['Data sprzedaży', d.sale_date] : null, ['Miejsce wystawienia', d.place || 'Warszawa']],
    badge: d.kind === 'proforma' ? '' : '<div class="orig">Oryginał</div>', body,
  });
}

// ── Склад, касса, хранение шин ─────────────────────────────────────────────
const STOCK_TITLE = { PZ: 'Przyjęcie zewnętrzne (PZ)', WZ: 'Wydanie zewnętrzne (WZ)', RW: 'Rozchód wewnętrzny (RW)', PW: 'Przychód wewnętrzny (PW)' };
export function stockDocHtml(id, { S = settingsMap(), bar = true } = {}) {
  const d = one('SELECT * FROM stock_docs WHERE id = ?', id);
  if (!d) throw new HttpError(404, 'Документ не найден');
  const items = all(`SELECT i.*, p.name, p.code, p.unit, p.location, p.manufacturer, p.purchase_price FROM stock_doc_items i JOIN products p ON p.id = i.product_id WHERE i.doc_id = ?`, id);
  const o = d.order_id ? one('SELECT number FROM orders WHERE id = ?', d.order_id) : null;
  const showCode = S.stock_code !== '0', showLoc = S.stock_location === '1', showCost = d.type === 'WZ' && S.wz_cost_col === '1';
  const total = round2(items.reduce((s, i) => s + i.qty * i.price_net, 0));
  const body = `<div class="cols"><div class="box kv"><span>${d.type === 'PZ' ? 'Dostawca' : 'Kontrahent'}</span><b>${esc(d.counterparty || '—')}</b>${d.ext_number ? `<span>Dokument dostawcy</span><b>${esc(d.ext_number)}</b>` : ''}${o ? `<span>Zlecenie</span><b>${esc(o.number)}</b>` : ''}</div>
      <div class="box kv"><span>Magazyn</span><b>Główny</b><span>Wystawił</span><b>${esc(d.created_by || '')}</b></div></div>
    <div class="sec"><table><thead><tr><th style="width:22px">Lp.</th><th>Nazwa</th>${showCode ? '<th>Kod</th>' : ''}${showLoc ? '<th>Lokalizacja</th>' : ''}<th class="r">Ilość</th><th>J.m.</th><th class="r">Cena netto</th>${showCost ? '<th class="r">Koszt zakupu</th>' : ''}<th class="r">Wartość netto</th></tr></thead><tbody>
      ${items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}${i.manufacturer ? ` <span class="sub">${esc(i.manufacturer)}</span>` : ''}</td>${showCode ? `<td class="mono">${esc(i.code || '')}</td>` : ''}${showLoc ? `<td>${esc(i.location || '')}</td>` : ''}<td class="r">${qtyFmt(i.qty)}</td><td>${esc(i.unit || 'szt.')}</td><td class="r">${zl(i.price_net)}</td>${showCost ? `<td class="r">${zl(i.purchase_price)}</td>` : ''}<td class="r">${zl(i.qty * i.price_net)}</td></tr>`).join('')}
      <tr class="sum"><td colspan="${5 + (showCode ? 1 : 0) + (showLoc ? 1 : 0) + (showCost ? 1 : 0)}" class="r">Razem netto</td><td class="r">${zl(total)}</td></tr></tbody></table></div>
    ${d.note ? `<div class="sec note">${esc(d.note)}</div>` : ''}
    ${sigBlock('Wystawił', d.type === 'PZ' ? 'Przyjął' : 'Odebrał', S.stock_person || d.created_by || '')}`;
  return page({ S, title: STOCK_TITLE[d.type] || d.type, number: d.number, meta: [['Data', d10(d.doc_date)]], body, bar });
}

export function cashDocHtml(id, { S = settingsMap(), bar = true } = {}) {
  const p = one('SELECT * FROM payments WHERE id = ?', id);
  if (!p) throw new HttpError(404, 'Документ не найден');
  const c = p.customer_id ? one('SELECT * FROM customers WHERE id = ?', p.customer_id) : null;
  const o = p.order_id ? one('SELECT number FROM orders WHERE id = ?', p.order_id) : null;
  const kp = p.direction !== 'out';
  const body = `<div class="cols"><div class="box"><h3>${kp ? 'Wpłacający' : 'Odbiorca'}</h3><div class="n">${esc(c?.company || c?.name || p.note || '—')}</div>${esc(c?.phone || '')}${c?.nip ? '<br>NIP ' + esc(c.nip) : ''}</div>
      <div class="box kv"><span>Forma</span><b>${esc(PAY_PL[p.method] || p.method)}</b><span>Kasa</span><b>Główna</b></div></div>
    <div class="sec"><table><thead><tr><th>Tytułem</th><th class="r">Kwota</th></tr></thead><tbody><tr><td>${esc(o ? `Zapłata za zlecenie ${o.number}` : p.note || '')}</td><td class="r">${zl(p.amount)} zł</td></tr>
      <tr class="sum"><td class="r">Razem</td><td class="r">${zl(p.amount)} zł</td></tr></tbody></table><div class="words">Słownie: ${esc(slownie(p.amount))}</div></div>
    ${sigBlock('Wystawił', kp ? 'Wpłacił' : 'Otrzymał', S.cash_person || p.staff || '')}`;
  return page({ S, title: kp ? 'Dowód wpłaty KP' : 'Dowód wypłaty KW', number: p.number || `#${p.id}`, meta: [['Data', d10(p.created_at)]], body, bar });
}

export function storageDocHtml(id, { S = settingsMap(), bar = true } = {}) {
  const r = one('SELECT * FROM storage WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Документ не найден');
  const c = r.customer_id ? one('SELECT * FROM customers WHERE id = ?', r.customer_id) : {};
  const k = r.car_id ? one('SELECT * FROM cars WHERE id = ?', r.car_id) : {};
  const terms = String(S.storage_terms || '').replace(/\[\[firma\]\]/g, S.company_name || '');
  const body = `${partiesWorkshop({ customer: c, car: k, flags: {} }, S)}
    <div class="sec"><table><thead><tr><th>Przedmiot przechowania</th><th class="r">Ilość</th><th>Lokalizacja</th><th>Przyjęto</th><th>Przechowanie do</th><th class="r">Opłata</th></tr></thead>
      <tbody><tr><td>${esc(r.kind === 'koła' ? 'Koła kompletne' : 'Opony')}${r.description ? `<div class="sub">${esc(r.description)}</div>` : ''}</td><td class="r">${esc(r.qty)} szt.</td><td>${esc(r.location || '')}</td><td>${esc(d10(r.date_in))}</td><td>${esc(d10(r.date_until) || '—')}</td><td class="r">${zl(r.price)} zł</td></tr></tbody></table></div>
    ${r.note ? `<div class="sec note">${esc(r.note)}</div>` : ''}
    ${terms ? `<div class="sec note">${esc(terms)}</div>` : ''}
    ${sigBlock('Podpis przyjmującego', 'Podpis klienta', S.storage_person || '')}`;
  return page({ S, title: 'Depozyt — przechowanie kół / opon', number: r.number, meta: [['Data przyjęcia', d10(r.date_in)], r.date_out ? ['Data wydania', d10(r.date_out)] : null], body, bar });
}
