// Публичные страницы для клиентов: электронная карта заказа / выцены (/k/<токен>) и онлайн-запись (/rezerwacja)
import express from 'express';
import crypto from 'node:crypto';
import { all, one, run, insert, log, getSetting } from './db.js';
import { normPhone, normPlate } from './util.js';
import { sendSms } from './sms.js';
import { render, orderContext } from './messaging.js';
import { notify } from './integrations/notify.js';
import { invoicePdf } from './invoices.js';
import { localShift } from './integrations/jobs.js';
import * as DOC from './documents.js';
import { lineGross } from './orders.js';
import { createPayLink } from './integrations/services.js';
import { config } from './config.js';
import { cfg } from './integrations/index.js';
import { CARD_LANG_BAR, CARD_LANG_CSS, CARD_LANG_JS } from './card-i18n.js';
import { curBranch, MAIN } from './branches.js';

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
  if (!/^([A-Z0-9]{2,8}~)?[A-Za-z0-9_-]{8,40}$/.test(String(token))) return null;
  return one('SELECT * FROM orders WHERE card_token = ?', token);
}

// ── Электронная карта заказа (как Elektroniczna karta zlecenia в Motowarsztat) ─────────────────
// Протокол приёма → кosztorys → протокол выдачи, подпись клиента (кнопка, код SMS или от руки), файлы, фактуры, история подписей.
const methodsFor = (s, doc) => {
  const key = doc === 'intake' ? 'card_intake_accept' : doc === 'release' ? 'card_release_accept' : 'card_estimate_accept';
  const list = String(s[key] ?? (s.card_accept === 'none' ? '' : s.card_accept || 'button')).split(',').map((x) => x.trim()).filter((x) => x === 'button' || x === 'sms');
  if (s.card_drawn_signature === '1' && list.length) list.push('drawn');
  return list;
};
const lastSig = (o, doc) => one('SELECT * FROM order_signatures WHERE order_id = ? AND doc = ? ORDER BY id DESC LIMIT 1', o.id, doc);

const CARD_CSS = `
:root{--acc:#0a8f45;--dot:#1bf372;--bg:#f3f4f6;--card:#fff;--t:#15171a;--m:#5f646c;--line:#e2e4e8;--soft:#f7f8f9;--warn:#8a5a00;--warnbg:#fff6df}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;font:15px/1.5 'Pulsecar Sans',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:var(--t)}
@font-face{font-family:'Pulsecar Sans';src:url('/fonts/PulsecarSans-Regular.woff2') format('woff2');font-weight:400}
@font-face{font-family:'Pulsecar Sans';src:url('/fonts/PulsecarSans-SemiBold.woff2') format('woff2');font-weight:600}
@font-face{font-family:'Pulsecar Sans';src:url('/fonts/PulsecarSans-Bold.woff2') format('woff2');font-weight:700}
.wrap{max-width:980px;margin:0 auto;padding:16px}
.top{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;display:grid;grid-template-columns:auto 1fr auto;gap:20px;align-items:center}
.top img{height:46px;display:block}.co{font-size:13px;color:var(--m)}.co .adm{font-size:11px}.co b{display:block;font-size:17px;color:var(--t);line-height:1.25}
.num{text-align:right}.num h1{font-size:22px;margin:0}.num div{font-size:13px;color:var(--m)}
.chip{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;border:1px solid;margin-top:4px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:12px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:var(--m);margin:0 0 8px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:3px 14px;font-size:14px}.kv span{color:var(--m)}
.gauge{display:inline-block;width:90px;height:8px;border-radius:5px;background:var(--line);vertical-align:middle;margin-left:6px;overflow:hidden}.gauge i{display:block;height:100%;background:var(--acc)}
details.sec{background:var(--card);border:1px solid var(--line);border-radius:14px;margin-bottom:12px;overflow:hidden}
details.sec>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--soft);font-weight:700;font-size:16px}
details.sec>summary::-webkit-details-marker{display:none}
details.sec>summary .ico{width:32px;height:32px;border-radius:9px;background:#15171a;color:var(--dot);display:grid;place-items:center;flex:none}
details.sec>summary .tt{flex:1}
details.sec>summary .st{font-size:12px;font-weight:700;border-radius:999px;padding:3px 10px;background:var(--line);color:var(--m)}
details.sec>summary .st.ok{background:#e4f7ec;color:var(--acc)}details.sec>summary .st.wait{background:var(--warnbg);color:var(--warn)}
details.sec>summary::after{content:"";width:9px;height:9px;border-right:2px solid var(--m);border-bottom:2px solid var(--m);transform:rotate(45deg);margin:0 4px 4px 6px}
details.sec[open]>summary::after{transform:rotate(-135deg);margin-bottom:-4px}
.body{padding:16px}
.dmg{display:grid;grid-template-columns:220px 1fr;gap:18px;align-items:start}
table{width:100%;border-collapse:collapse;font-size:14px}th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--m);text-align:left;padding:7px 8px;border-bottom:2px solid var(--line)}
td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}.r{text-align:right;white-space:nowrap}.sub{color:var(--m);font-size:12px}
.tbl{overflow-x:auto;margin-bottom:10px}
.sum{display:grid;gap:4px;max-width:360px;margin-left:auto;margin-top:10px}.sum div{display:flex;justify-content:space-between}.sum .big{font-size:20px;font-weight:700;border-top:1px solid var(--line);padding-top:6px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:#15171a;color:#fff;border:0;border-radius:10px;padding:12px 18px;font:700 15px inherit;font-family:inherit;cursor:pointer;text-decoration:none}
.btn::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--dot)}.btn.alt{background:#fff;color:var(--t);border:1px solid var(--line)}.btn.alt::before{display:none}
.btn.pay{background:var(--acc)}.btn.pay::before{background:#fff}
.signbox{border-top:1px solid var(--line);margin-top:14px;padding-top:14px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
.signbox form{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin:0}
input{font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;min-width:0}
label{font-size:13px;color:var(--m);display:grid;gap:4px}
.ok{border:1px solid #bfe9cf;background:#effaf3;color:#0b6b3a;border-radius:10px;padding:10px 14px}
.err{border:1px solid #f3c4c4;background:#fdeeee;color:#9b1c1c;border-radius:10px;padding:10px 14px;margin-bottom:12px}
.info{border:1px solid var(--line);background:var(--soft);border-radius:10px;padding:10px 14px;color:var(--m)}
.pad{border:1px dashed #9aa0a8;border-radius:10px;background:#fff;touch-action:none;width:100%;max-width:520px;height:170px;display:block}
.files{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.files a{display:block;border:1px solid var(--line);border-radius:10px;overflow:hidden;color:var(--t);text-decoration:none;font-size:12px}
.files img,.files video{width:100%;height:120px;object-fit:cover;display:block;background:#000}.files span{display:block;padding:6px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.note{white-space:pre-wrap;font-size:13px;color:var(--m)}
footer{text-align:center;color:var(--m);font-size:12px;padding:14px 16px 30px}
@media(max-width:720px){.top{grid-template-columns:1fr;text-align:left}.num{text-align:left}.two,.dmg{grid-template-columns:1fr}}
/* Premium */
@font-face{font-family:'Inter';font-display:swap;font-weight:100 900;src:url('/fonts/inter-latin-wght-normal.woff2') format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212}
@font-face{font-family:'Inter';font-display:swap;font-weight:100 900;src:url('/fonts/inter-latin-ext-wght-normal.woff2') format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+20A0-20AB,U+20AD-20C0,U+A720-A7FF}
@font-face{font-family:'Inter';font-display:swap;font-weight:100 900;src:url('/fonts/inter-cyrillic-wght-normal.woff2') format('woff2');unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:'Inter';font-display:swap;font-weight:100 900;src:url('/fonts/inter-cyrillic-ext-wght-normal.woff2') format('woff2');unicode-range:U+0460-052F,U+1C80-1C8A,U+20B4,U+A640-A69F}
:root{--acc:#0b8f47;--bg:#f4f4f2;--card:#fff;--t:#131417;--m:#6a6d74;--line:#e7e7e3;--soft:#fafaf9;--ink:#111214}
body{font:14.5px/1.55 'Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;letter-spacing:-.005em;-webkit-font-smoothing:antialiased;font-feature-settings:'cv11'}
td,.sum,.kv b,.top .meta b{font-feature-settings:'cv11','tnum'}
.wrap{max-width:940px;padding:20px 16px}
.top{background:var(--ink);border-color:var(--ink);border-radius:12px;padding:22px 24px;color:#fff}
.top img{height:40px}.co{color:#9a9da4}.co b{color:#fff;font-weight:600;letter-spacing:-.01em}
.num h1{font-size:24px;font-weight:650;letter-spacing:-.025em;color:#fff}.num div{color:#9a9da4}.num div b{color:#fff;font-weight:600}
.top .chip{border-color:rgba(255,255,255,.22)!important;color:#fff!important;background:rgba(255,255,255,.06)!important;border-radius:4px;font-weight:600;letter-spacing:.03em}
.card,details.sec{border-radius:12px;border-color:var(--line);box-shadow:0 1px 2px rgba(17,18,20,.04)}
.card{padding:20px 22px}
h2{font-size:10.5px;font-weight:600;letter-spacing:.1em;color:var(--m);margin-bottom:12px}
.kv{font-size:14px;gap:6px 18px}.kv b{font-weight:600}
details.sec>summary{background:#fff;padding:16px 20px;font-weight:600;font-size:15px;letter-spacing:-.01em;border-bottom:1px solid transparent}
details.sec[open]>summary{border-bottom-color:var(--line)}
details.sec>summary .ico{width:30px;height:30px;border-radius:7px;background:var(--ink)}
details.sec>summary .st{border-radius:4px;font-size:11px;font-weight:600;letter-spacing:.03em;padding:3px 8px}
details.sec>summary::after{width:7px;height:7px;border-width:1.5px}
.body{padding:20px 22px}
th{font-size:10.5px;font-weight:600;letter-spacing:.08em;border-bottom:1px solid var(--t);padding:8px}
td{border-bottom-color:var(--line);padding:10px 8px}td.r b,td b{font-weight:600}
.sum .big{font-size:19px;font-weight:650;letter-spacing:-.02em;border-top:1px solid var(--t);padding-top:8px;margin-top:4px}
.btn{border-radius:8px;padding:11px 18px;font-weight:600;font-size:14px;letter-spacing:-.005em;background:var(--ink)}
.btn::before{width:7px;height:7px}.btn.alt{border-color:#d9d9d4}.btn.alt:hover{border-color:var(--t)}
input{border-radius:8px;border-color:#d9d9d4}input:focus{outline:none;border-color:var(--t);box-shadow:0 0 0 3px rgba(17,18,20,.08)}
.info,.ok,.err{border-radius:8px}.pad{border-radius:8px}
footer{font-size:11.5px;letter-spacing:.02em}
.top{display:block;padding:0;overflow:hidden;background:var(--ink);border:0;border-radius:14px;color:#fff;position:relative}
.top::before{content:"";position:absolute;inset:0 0 auto 0;height:2px;background:linear-gradient(90deg,#1bf372,rgba(27,243,114,0) 60%)}
.top-a{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:22px 28px 0}
.top-a img{height:34px;display:block}
.stc{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:500;letter-spacing:.02em;color:#e9eaec;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);border-radius:999px;padding:5px 12px 5px 10px}
.stc i{width:7px;height:7px;border-radius:50%;display:block}
.top-b{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;padding:26px 28px 24px}
.top .num{text-align:left}.top .num .lbl{font-size:10.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#7d8189;margin-bottom:6px}
.top .num h1{font-size:34px;line-height:1;font-weight:600;letter-spacing:-.035em;color:#fff;margin:0}
.top .meta{display:flex;gap:28px;text-align:right}.top .meta div{display:grid;gap:3px}
.top .meta span{font-size:10.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#7d8189}
.top .meta b{font-size:15px;font-weight:500;color:#fff;letter-spacing:-.01em}
.top .co{border-top:1px solid rgba(255,255,255,.08);padding:13px 28px;font-size:12px;line-height:1.5;color:#8b8f97;background:rgba(255,255,255,.02)}
.top .co b{display:inline;font-size:12px;font-weight:600;color:#d6d8db}
.top .co a{color:#d6d8db;text-decoration:none;border-bottom:1px solid rgba(255,255,255,.2)}.top .co a:hover{color:#fff;border-bottom-color:#fff}
@media(max-width:720px){.top-a{padding:18px 18px 0}.top-b{padding:20px 18px 18px;align-items:flex-start;flex-direction:column}.top .meta{text-align:left;gap:20px}.top .num h1{font-size:28px}.top .co{padding:12px 18px}}
`;
const ICO = {
  intake: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13 7l4 4"/></svg>',
  estimate: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  release: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l4 4L19 6"/></svg>',
  files: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 17l-5-5-8 7"/></svg>',
  docs: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/></svg>',
  sign: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17c3-4 5-4 6-1s3 3 5-1 4-3 7 0"/></svg>',
};
const PAD_JS = `document.querySelectorAll('canvas.pad').forEach(function(c){var f=c.closest('form'),x=c.getContext('2d'),dr=false,has=false,r=window.devicePixelRatio||1;
var fitted=false;function fit(){if(fitted||!c.clientWidth)return;fitted=true;var w=c.clientWidth,h=c.clientHeight;c.width=w*r;c.height=h*r;x.scale(r,r);x.lineWidth=2.2;x.lineCap='round';x.strokeStyle='#15171a'}fit();
function p(e){var b=c.getBoundingClientRect();return[e.clientX-b.left,e.clientY-b.top]}
c.addEventListener('pointerdown',function(e){fit();dr=true;has=true;c.setPointerCapture(e.pointerId);var q=p(e);x.beginPath();x.moveTo(q[0],q[1])});
c.addEventListener('pointermove',function(e){if(!dr)return;var q=p(e);x.lineTo(q[0],q[1]);x.stroke()});
c.addEventListener('pointerup',function(){dr=false;f.signature.value=has?c.toDataURL('image/png'):''});
f.querySelector('.clear').onclick=function(){x.clearRect(0,0,c.width,c.height);has=false;f.signature.value=''};
f.addEventListener('submit',function(e){if(!has){e.preventDefault();alert('Proszę złożyć podpis w polu.')}})});`;

function cardPage(title, body, s) {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="icon" href="/favicon.png"><style>${CARD_CSS}${CARD_LANG_CSS}</style></head><body><div class="wrap">${CARD_LANG_BAR}${body}</div>
<footer>${esc(s.company_name || '')} · ${esc(s.company_address || '')}${s.company_nip ? ' · NIP ' + esc(s.company_nip) : ''}</footer><script>${PAD_JS}</script><script>${CARD_LANG_JS}</script></body></html>`;
}

function signBox(s, o, doc, token, label) {
  const done = lastSig(o, doc);
  if (done) return `<div class="ok" style="margin-top:14px">✓ Podpisano ${esc(String(done.signed_at).slice(0, 16))} · ${esc(DOC.SIG_METHOD[done.method] || done.method)}${done.signer_name ? ' · ' + esc(done.signer_name) : ''}</div>`;
  const m = methodsFor(s, doc);
  if (!m.length) return '';
  const act = `/k/${esc(token)}/sign`;
  const codeSent = o.accept_code_exp > Date.now() && o.accept_doc === doc;
  return `<div class="signbox" id="sign-${doc}">
    <div style="flex-basis:100%;font-size:14px">${esc(label)}</div>
    ${m.includes('button') ? `<form method="post" action="${act}"><input type="hidden" name="doc" value="${doc}"><input type="hidden" name="method" value="button"><button class="btn">Akceptuję</button></form>` : ''}
    ${m.includes('sms') ? (codeSent
      ? `<form method="post" action="${act}"><input type="hidden" name="doc" value="${doc}"><input type="hidden" name="method" value="sms"><label>Kod z SMS<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required style="width:130px"></label><button class="btn">Podpisz kodem</button></form>
         <form method="post" action="/k/${esc(token)}/code"><input type="hidden" name="doc" value="${doc}"><button class="btn alt">Wyślij kod ponownie</button></form>`
      : `<form method="post" action="/k/${esc(token)}/code"><input type="hidden" name="doc" value="${doc}"><button class="btn alt">Podpisz kodem SMS</button></form>`) : ''}
    ${m.includes('drawn') ? `<details style="flex-basis:100%"><summary class="btn alt" style="list-style:none;display:inline-flex">Podpisz odręcznie</summary>
      <form method="post" action="${act}" style="display:grid;gap:8px;margin-top:10px"><input type="hidden" name="doc" value="${doc}"><input type="hidden" name="method" value="drawn"><input type="hidden" name="signature">
        <label>Imię i nazwisko<input name="name" maxlength="80" required></label><canvas class="pad"></canvas>
        <div style="display:flex;gap:8px"><button type="button" class="btn alt clear">Wyczyść</button><button class="btn">Podpisz dokument</button></div></form></details>` : ''}
  </div>`;
}

function itemsHtml(s, items) {
  const labor = items.filter((i) => i.kind === 'labor'), parts = items.filter((i) => i.kind === 'part');
  const cl = { lNet: s.card_labor_net === '1', lGross: s.card_labor_gross !== '0', pNet: s.card_parts_net === '1', pGross: s.card_parts_gross !== '0', code: s.card_parts_code === '1', brand: s.card_parts_brand !== '0' };
  const val = (i) => lineGross(i);
  const unitN = (i) => (i.qty ? val(i) / (1 + (i.vat ?? 23) / 100) / i.qty : 0);
  const unitG = (i) => (i.qty ? val(i) / i.qty : 0);
  const brand = (i) => (i.product_id ? one('SELECT manufacturer FROM products WHERE id = ?', i.product_id)?.manufacturer || '' : '');
  const lt = labor.length ? `<div class="tbl"><table><thead><tr><th>Usługa</th><th class="r">Ilość</th>${cl.lNet ? '<th class="r">Cena jedn. netto</th>' : ''}${cl.lGross ? '<th class="r">Cena jedn. brutto</th>' : ''}<th class="r">Wartość</th></tr></thead><tbody>
    ${labor.map((i) => `<tr><td>${esc(i.name)}${i.discount ? `<div class="sub">rabat ${esc(i.discount)}%</div>` : ''}</td><td class="r">${esc(i.qty)} ${esc(i.unit || '')}</td>${cl.lNet ? `<td class="r">${zl(unitN(i))} zł</td>` : ''}${cl.lGross ? `<td class="r">${zl(unitG(i))} zł</td>` : ''}<td class="r"><b>${zl(val(i))} zł</b></td></tr>`).join('')}</tbody></table></div>` : '';
  const pt = parts.length ? `<div class="tbl"><table><thead><tr><th>Część</th>${cl.code ? '<th>Kod</th>' : ''}${cl.brand ? '<th>Producent</th>' : ''}<th class="r">Ilość</th>${cl.pNet ? '<th class="r">Cena jedn. netto</th>' : ''}${cl.pGross ? '<th class="r">Cena jedn. brutto</th>' : ''}<th class="r">Wartość</th></tr></thead><tbody>
    ${parts.map((i) => `<tr><td>${esc(i.name)}${i.discount ? `<div class="sub">rabat ${esc(i.discount)}%</div>` : ''}</td>${cl.code ? `<td>${esc(i.code || '')}</td>` : ''}${cl.brand ? `<td>${esc(brand(i))}</td>` : ''}<td class="r">${esc(i.qty)} ${esc(i.unit || 'szt.')}</td>${cl.pNet ? `<td class="r">${zl(unitN(i))} zł</td>` : ''}${cl.pGross ? `<td class="r">${zl(unitG(i))} zł</td>` : ''}<td class="r"><b>${zl(val(i))} zł</b></td></tr>`).join('')}</tbody></table></div>` : '';
  return lt + pt;
}

pub.get('/k/:token', (req, res) => {
  const s = S();
  const o = findCard(req.params.token);
  res.setHeader('Cache-Control', 'no-store');
  if (!o) return res.status(404).send(cardPage('Nie znaleziono', '<div class="card"><h1>Nie znaleziono</h1><p class="sub">Link jest nieprawidłowy lub dokument został usunięty.</p></div>', s));
  const t = esc(req.params.token);
  const car = o.car_id ? one('SELECT * FROM cars WHERE id = ?', o.car_id) : {};
  const c = o.customer_id ? one('SELECT * FROM customers WHERE id = ?', o.customer_id) : {};
  const st = o.status_id ? one('SELECT * FROM order_statuses WHERE id = ?', o.status_id) : null;
  const items = all('SELECT * FROM order_items WHERE order_id = ? ORDER BY pos, id', o.id);
  const isQuote = o.kind === 'quote';
  const due = Math.max(0, Math.round((o.total - o.paid) * 100) / 100);
  const damages = (() => { try { return JSON.parse(o.damages || '[]'); } catch { return []; } })();
  const files = s.card_files !== '0' ? all('SELECT * FROM order_files WHERE order_id = ? AND client_visible = 1 ORDER BY id', o.id) : [];
  const sales = s.card_show_invoice !== '0' ? all('SELECT id, kind, number, issue_date, total_gross FROM sales_docs WHERE order_id = ? ORDER BY id', o.id) : [];
  const sigs = all('SELECT * FROM order_signatures WHERE order_id = ? ORDER BY id', o.id);
  const msg = { signed: ['ok', 'Dziękujemy! Dokument został podpisany.'], accepted: ['ok', 'Dziękujemy! Potwierdzenie zostało zapisane.'], code: ['ok', 'Wysłaliśmy SMS z kodem — wpisz go poniżej.'], badcode: ['err', 'Nieprawidłowy lub nieaktualny kod. Spróbuj ponownie.'], limit: ['err', 'Zbyt wiele prób. Spróbuj za kilka minut.'], nophone: ['err', 'Brak numeru telefonu — skontaktuj się z nami.'], nosig: ['err', 'Brak podpisu — narysuj podpis w polu.'], pay: ['err', 'Płatność online jest chwilowo niedostępna. Skorzystaj z przelewu lub zapłać w serwisie.'], locked: ['err', 'Najpierw podpisz protokół przyjęcia.'] }[req.query.m];
  const pct = DOC.fuelPct(o.fuel_level);
  const intakeOn = !isQuote && s.card_intake_on !== '0';
  const intakeSigned = !!lastSig(o, 'intake');
  const estLocked = !isQuote && intakeOn && s.card_quote_after_protocol === '1' && !intakeSigned;
  const estDoc = isQuote ? 'quote' : 'estimate';
  const estSigned = !!lastSig(o, estDoc) || !!o.accepted_at;
  const finished = !!o.closed_at || !!(st && st.is_final);
  const releaseOn = !isQuote && s.card_release_on === '1' && finished;
  const tag = (ok, txt, wait) => `<span class="st ${ok ? 'ok' : wait ? 'wait' : ''}">${txt}</span>`;

  const plDate = (v) => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}))?/); return m ? `${m[3]}.${m[2]}.${m[1]}${m[4] ? ' ' + m[4] : ''}` : ''; };
  const telHref = (s.company_phone || '').replace(/\s/g, '');
  const top = `<div class="top">
    <div class="top-a">${s.doc_show_logo !== '0' ? `<img src="/logo-dark.png" alt="${esc(s.company_brand || 'Pulsecar')}">` : '<span></span>'}
      ${s.card_show_status !== '0' && st && !isQuote ? `<span class="stc"><i style="background:${esc(st.color || '#1bf372')}"></i>${esc(st.client_label || st.name)}</span>` : ''}</div>
    <div class="top-b"><div class="num"><div class="lbl">${isQuote ? 'Wycena' : 'Zlecenie'}</div><h1>${esc(o.number)}</h1></div>
      <div class="meta"><div><span>${isQuote ? 'Data wyceny' : 'Data przyjęcia pojazdu'}</span><b>${esc(plDate(o.created_at))}</b></div>
        ${o.pickup_at && !isQuote ? `<div><span>Planowany odbiór</span><b>${esc(plDate(String(o.pickup_at)))}</b></div>` : ''}</div></div>
    ${s.card_show_company !== '0' ? `<div class="co">Administratorem danych osobowych jest <b>${esc(s.company_name || '')}</b>${[s.company_legal_address || s.company_address, s.company_nip ? 'NIP ' + s.company_nip : ''].filter(Boolean).map((x) => ' · ' + esc(x)).join('')}${s.company_phone ? ` · <a href="tel:${esc(telHref)}">${esc(s.company_phone)}</a>` : ''}</div>` : ''}</div>`;
  const people = `<div class="two"><div class="card" style="margin:0"><h2>Dane klienta</h2><div class="kv"><span>Imię i nazwisko</span><b>${esc(c.company || c.name || '—')}</b>${c.phone ? `<span>Telefon</span><b>${esc(c.phone)}</b>` : ''}${c.street || c.city ? `<span>Adres</span><b>${esc([c.street, [c.postcode, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</b>` : ''}</div></div>
    <div class="card" style="margin:0"><h2>Dane pojazdu</h2><div class="kv"><span>Marka i model</span><b>${esc([car.make, car.model].filter(Boolean).join(' ') || '—')}</b><span>Numer rejestracyjny</span><b>${esc(car.plate || '—')}</b><span>VIN</span><b>${esc(car.vin || '—')}</b>
      ${o.mileage ? `<span>Przebieg</span><b>${esc(Number(o.mileage).toLocaleString('pl-PL'))} km</b>` : ''}${!isQuote ? `<span>Poziom paliwa</span><b>${esc(DOC.fuelPl(o.fuel_level))}${pct != null ? `<span class="gauge"><i style="width:${pct}%"></i></span>` : ''}</b>` : ''}</div></div></div>`;

  const intake = intakeOn ? `<details class="sec" ${!intakeSigned ? 'open' : ''} id="intake"><summary><span class="ico">${ICO.intake}</span><span class="tt">Protokół przyjęcia</span>${methodsFor(s, 'intake').length ? tag(intakeSigned, intakeSigned ? 'Podpisany' : 'Do podpisu', !intakeSigned) : ''}</summary><div class="body">
    ${s.card_intake_desc !== '0' && o.complaint ? `<h2>Opis zlecenia</h2><div class="note" style="margin-bottom:12px">${esc(o.complaint)}</div>` : ''}
    ${s.card_intake_tasks !== '0' && items.some((i) => i.kind === 'labor') ? `<h2>Lista zadań</h2><ol style="margin:0 0 12px;padding-left:20px">${items.filter((i) => i.kind === 'labor').map((i) => `<li>${esc(i.name)}</li>`).join('')}</ol>` : ''}
    ${s.card_intake_damage !== '0' ? `<h2>Opis uszkodzeń</h2><div class="dmg">${DOC.carSvg(damages, { w: 200, car })}<div>${damages.length ? `<table><tbody>${damages.map((m, i) => `<tr><td style="width:28px"><b>${i + 1}</b></td><td>${esc(DOC.DAMAGE_TYPES[m.type] || m.type)}${m.note ? `<div class="sub">${esc(m.note)}</div>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="info">Brak adnotacji o uszkodzeniach</div>'}</div></div>` : ''}
    ${s.card_rodo ? `<div class="note" style="margin-top:12px">${esc(s.card_rodo)}</div>` : ''}${s.card_intake_extra ? `<div class="note" style="margin-top:8px">${esc(s.card_intake_extra)}</div>` : ''}
    <div style="margin-top:12px"><a class="btn alt" href="/k/${t}/doc/intake">Podgląd dokumentu</a></div>
    ${signBox(s, o, 'intake', req.params.token, 'Potwierdzam przekazanie pojazdu do serwisu na powyższych warunkach.')}</div></details>` : '';

  const payBtns = !isQuote && due > 0.01 ? `${s.card_pay_online !== '0' && (o.pay_link || tpayOn()) ? `<form method="post" action="/k/${t}/pay" style="display:inline"><button class="btn pay">Zapłać online ${zl(due)} zł · BLIK, karta</button></form>` : ''}
    ${s.card_show_bank === '1' && s.company_bank ? `<div class="info" style="margin-top:10px">Przelew: ${esc(s.company_name || '')} · <b style="user-select:all">${esc(s.company_bank)}</b> · tytuł: ${esc(o.number)}</div>` : ''}` : '';
  const estimate = (isQuote || s.card_estimate_on !== '0') ? `<details class="sec" open id="estimate"><summary><span class="ico">${ICO.estimate}</span><span class="tt">${isQuote ? 'Wycena' : 'Kosztorys'}</span>${methodsFor(s, estDoc).length && !estLocked ? tag(estSigned, estSigned ? 'Zaakceptowany' : 'Do akceptacji', !estSigned) : ''}</summary><div class="body">
    ${estLocked ? '<div class="info">Kosztorys będzie widoczny po podpisaniu protokołu przyjęcia.</div>' : `
    ${items.length ? itemsHtml(s, items) : '<div class="info">Kosztorys jest w przygotowaniu.</div>'}
    <div class="sum">${s.card_show_net !== '0' ? `<div><span>Razem netto</span><b>${zl(o.total_net)} zł</b></div>` : ''}<div class="big"><span>Razem brutto</span><span>${zl(o.total)} zł</span></div>
      ${!isQuote && o.paid > 0 ? `<div><span>Zapłacono</span><b>${zl(o.paid)} zł</b></div><div><b>Do zapłaty</b><b>${zl(due)} zł</b></div>` : ''}</div>
    ${s.card_estimate_extra ? `<div class="note" style="margin-top:10px">${esc(s.card_estimate_extra)}</div>` : ''}
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn alt" href="/k/${t}/doc/${isQuote ? 'estimate' : 'estimate'}">Podgląd dokumentu</a>${payBtns}</div>
    ${signBox(s, o, estDoc, req.params.token, isQuote ? 'Akceptuję wycenę i proszę o wykonanie prac.' : 'Akceptuję zakres prac i koszty z kosztorysu.')}`}</div></details>` : '';

  const release = releaseOn ? `<details class="sec" open id="release"><summary><span class="ico">${ICO.release}</span><span class="tt">Protokół wydania</span>${methodsFor(s, 'release').length ? tag(!!lastSig(o, 'release'), lastSig(o, 'release') ? 'Podpisany' : 'Do podpisu', !lastSig(o, 'release')) : ''}</summary><div class="body">
    <h2>Wykonane prace</h2><ol style="margin:0 0 10px;padding-left:20px">${items.filter((i) => i.kind === 'labor').map((i) => `<li>${esc(i.name)}</li>`).join('')}</ol>
    ${o.after_notes ? `<h2>Uwagi po wykonaniu</h2><div class="note">${esc(o.after_notes)}</div>` : ''}
    <div style="margin-top:12px"><a class="btn alt" href="/k/${t}/doc/release">Podgląd dokumentu</a></div>
    ${signBox(s, o, 'release', req.params.token, 'Potwierdzam odbiór pojazdu.')}</div></details>` : '';

  const filesSec = files.length ? `<details class="sec" open><summary><span class="ico">${ICO.files}</span><span class="tt">Zdjęcia i pliki</span><span class="st">${files.length}</span></summary><div class="body"><div class="files">
    ${files.map((f) => `<a href="/k/${t}/file/${f.id}" target="_blank" rel="noopener">${/^image\//.test(f.mime) ? `<img src="/k/${t}/file/${f.id}" alt="" loading="lazy">` : /^video\//.test(f.mime) ? `<video src="/k/${t}/file/${f.id}" preload="metadata" muted></video>` : '<div style="height:120px;display:grid;place-items:center;background:var(--soft);font-weight:700">PDF</div>'}<span>${esc(f.name)}</span></a>`).join('')}</div></div></details>` : '';
  const salesSec = sales.length ? `<details class="sec" open><summary><span class="ico">${ICO.docs}</span><span class="tt">Dokumenty sprzedaży</span></summary><div class="body"><table><tbody>
    ${sales.map((d) => `<tr><td>${esc(DOC.SALE_KIND[d.kind])} <b>${esc(d.number)}</b><div class="sub">${esc(d.issue_date)}</div></td><td class="r">${zl(d.total_gross)} zł</td><td class="r"><a class="btn alt" href="/k/${t}/sale/${d.id}">Otwórz</a></td></tr>`).join('')}
    ${o.invoice_ext_id && !sales.some((d) => d.kind === 'vat') ? `<tr><td>Faktura VAT <b>${esc(o.invoice_no || '')}</b></td><td></td><td class="r"><a class="btn alt" href="/k/${t}/faktura.pdf">PDF</a></td></tr>` : ''}</tbody></table></div></details>`
    : o.invoice_ext_id && s.card_show_invoice !== '0' ? `<div class="card"><a class="btn alt" href="/k/${t}/faktura.pdf">Faktura ${esc(o.invoice_no || '')} (PDF)</a></div>` : '';
  const history = `<details class="sec" ${sigs.length ? 'open' : ''}><summary><span class="ico">${ICO.sign}</span><span class="tt">Historia podpisów</span></summary><div class="body">
    <div class="tbl"><table><thead><tr><th>Rodzaj dokumentu</th><th>Data podpisu</th><th>Rodzaj podpisu</th><th>Podpisany dokument</th></tr></thead><tbody>
    ${sigs.length ? sigs.map((g) => `<tr><td>${esc(DOC.SIG_KIND[g.doc] || g.doc)}</td><td>${esc(String(g.signed_at).slice(0, 16))}</td><td>${esc(DOC.SIG_METHOD[g.method] || g.method)}</td><td><a href="/k/${t}/doc/${g.doc === 'quote' ? 'estimate' : g.doc}">Otwórz</a></td></tr>`).join('')
      : '<tr><td colspan="4" class="sub" style="text-align:center;font-style:italic">Brak podpisanych dokumentów</td></tr>'}</tbody></table></div></div></details>`;
  const body = `${msg ? `<div class="${msg[0]}" style="margin-bottom:12px">${esc(msg[1])}</div>` : ''}${top}${people}
    ${intake}${estimate}${release}${filesSec}${salesSec}${history}
    ${s.card_extra ? `<div class="card note">${esc(s.card_extra)}</div>` : ''}`;
  res.send(cardPage(`${isQuote ? 'Wycena' : 'Zlecenie'} ${o.number}`, body, s));
});

const tpayOn = () => { try { return !!cfg('tpay'); } catch { return false; } };

pub.post('/k/:token/code', async (req, res) => {
  const o = findCard(req.params.token);
  if (!o) return res.status(404).send('not found');
  const doc = ['intake', 'estimate', 'quote', 'release'].includes(req.body?.doc) ? req.body.doc : (o.kind === 'quote' ? 'quote' : 'estimate');
  const back = (m) => res.redirect(303, `/k/${req.params.token}?m=${m}#sign-${doc}`);
  if (limited(req, 'code', 5) || (o.accept_code_exp && o.accept_doc === doc && o.accept_code_exp - 9 * 60_000 > Date.now())) return back('limit');
  const c = o.customer_id ? one('SELECT phone FROM customers WHERE id = ?', o.customer_id) : null;
  if (!c?.phone) return back('nophone');
  const code = String(crypto.randomInt(100000, 1000000));
  run('UPDATE orders SET accept_code = ?, accept_code_exp = ?, accept_doc = ? WHERE id = ?', crypto.createHash('sha256').update(code + o.card_token).digest('hex'), Date.now() + 10 * 60_000, doc, o.id);
  const text = render(getSetting('sms_tpl_code', 'Kod potwierdzenia: [[kod]]'), { ...orderContext(o.id), kod: code });
  try { await sendSms(c.phone, text, { kind: 'code', order_id: o.id, customer_id: o.customer_id }); } catch { return back('limit'); }
  back('code');
});

function signOrder(req, res, doc, method) {
  const o = findCard(req.params.token);
  if (!o) return res.status(404).send('not found');
  const s = S();
  const back = (m) => res.redirect(303, `/k/${req.params.token}?m=${m}#${doc === 'quote' ? 'estimate' : doc}`);
  if (lastSig(o, doc)) return back('signed');
  if (!methodsFor(s, doc).includes(method)) return back('');
  if (limited(req, 'accept', 10)) return back('limit');
  if ((doc === 'estimate') && s.card_intake_on !== '0' && s.card_quote_after_protocol === '1' && !lastSig(o, 'intake')) return back('locked');
  const c = o.customer_id ? one('SELECT name, company, phone FROM customers WHERE id = ?', o.customer_id) : {};
  let image = null;
  if (method === 'sms') {
    const code = String(req.body?.code || '').replace(/\D/g, '');
    const ok = o.accept_code && o.accept_code_exp > Date.now() && o.accept_doc === doc
      && crypto.timingSafeEqual(Buffer.from(o.accept_code), Buffer.from(crypto.createHash('sha256').update(code + o.card_token).digest('hex')));
    if (!ok) return back('badcode');
  }
  if (method === 'drawn') {
    image = String(req.body?.signature || '');
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]{200,}$/.test(image) || image.length > 400_000) return back('nosig');
  }
  const snapshot = JSON.stringify({ total: o.total, total_net: o.total_net, items: all('SELECT name, code, qty, price, discount, vat FROM order_items WHERE order_id = ? ORDER BY pos, id', o.id) });
  insert('order_signatures', { order_id: o.id, doc, method, signer_name: String(req.body?.name || c?.name || c?.company || '').slice(0, 80) || null, phone: method === 'sms' ? c?.phone || null : null, image, ip: req.ip, snapshot, signed_at: localShift(0) });
  run('UPDATE orders SET accept_code = NULL, accept_code_exp = NULL WHERE id = ?', o.id);
  log('order', o.id, 'accepted', `${DOC.SIG_KIND[doc]} · ${DOC.SIG_METHOD[method]} · ${req.ip}`, 'klient');
  if (doc === 'estimate' || doc === 'quote') {
    run('UPDATE orders SET accepted_at = COALESCE(accepted_at, ?), accepted_via = COALESCE(accepted_via, ?) WHERE id = ?', localShift(0), method, o.id);
    const target = Number(getSetting('card_accept_status_id', '')) || null;
    const cur = o.status_id ? one('SELECT is_final FROM order_statuses WHERE id = ?', o.status_id) : null;
    if (target && o.kind === 'order' && !cur?.is_final && one('SELECT 1 FROM order_statuses WHERE id = ?', target)) {
      run('UPDATE orders SET status_id = ? WHERE id = ?', target, o.id);
      log('order', o.id, 'status', one('SELECT name FROM order_statuses WHERE id = ?', target).name, 'klient');
    }
  }
  notify('status', `✅ Клиент подписал: ${DOC.SIG_KIND[doc]} · ${o.number} (${DOC.SIG_METHOD[method]})`, { order: o.number, event: 'signed', doc });
  back('signed');
}
pub.post('/k/:token/sign', (req, res) => {
  const doc = ['intake', 'estimate', 'quote', 'release'].includes(req.body?.doc) ? req.body.doc : 'estimate';
  const o = findCard(req.params.token);
  signOrder(req, res, o?.kind === 'quote' && doc === 'estimate' ? 'quote' : doc, ['button', 'sms', 'drawn'].includes(req.body?.method) ? req.body.method : 'button');
});
// старая ссылка «Akceptuję» (до карты с протоколами)
pub.post('/k/:token/accept', (req, res) => {
  const o = findCard(req.params.token);
  signOrder(req, res, o?.kind === 'quote' ? 'quote' : 'estimate', req.body?.code ? 'sms' : 'button');
});

pub.post('/k/:token/pay', async (req, res) => {
  const o = findCard(req.params.token);
  if (!o) return res.status(404).send('not found');
  if (getSetting('card_pay_online', '1') === '0' || limited(req, 'pay', 10)) return res.redirect(303, `/k/${req.params.token}?m=pay`);
  try {
    const c = o.customer_id ? one('SELECT * FROM customers WHERE id = ?', o.customer_id) : null;
    const r = await createPayLink(o, c, config.publicUrl);
    res.redirect(303, r.url);
  } catch { res.redirect(303, `/k/${req.params.token}?m=pay`); }
});

pub.get('/k/:token/doc/:type', (req, res) => {
  const o = findCard(req.params.token);
  if (!o || !['intake', 'estimate', 'release', 'spec'].includes(req.params.type)) return res.status(404).send('not found');
  const s = S();
  if (req.params.type === 'estimate' && o.kind !== 'quote' && s.card_intake_on !== '0' && s.card_quote_after_protocol === '1' && !lastSig(o, 'intake')) return res.redirect(303, `/k/${req.params.token}?m=locked`);
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(DOC.orderDoc(req.params.type, o.id, { S: s, back: `/k/${req.params.token}` }));
});
pub.get('/k/:token/sale/:id', (req, res) => {
  const o = findCard(req.params.token);
  const d = o && one('SELECT id FROM sales_docs WHERE id = ? AND order_id = ?', Number(req.params.id), o.id);
  if (!d || getSetting('card_show_invoice', '1') === '0') return res.status(404).send('not found');
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(DOC.saleDocHtml(d.id, { back: `/k/${req.params.token}` }));
});
pub.get('/k/:token/file/:id', (req, res) => {
  const o = findCard(req.params.token);
  const f = o && getSetting('card_files', '1') !== '0' && one('SELECT * FROM order_files WHERE id = ? AND order_id = ? AND client_visible = 1', Number(req.params.id), o.id);
  if (!f) return res.status(404).send('not found');
  DOC.sendOrderFile(res, f);
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
  <form method="post" action="/rezerwacja?${embed ? 'embed=1&' : ''}${curBranch() !== MAIN ? 'b=' + curBranch() : ''}">
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
var f=document.createElement('iframe');f.src=${JSON.stringify(base + '/rezerwacja?embed=1' + (curBranch() !== MAIN ? '&b=' + curBranch() : ''))};f.title='Rezerwacja';f.style.cssText='width:100%;border:0;min-height:980px;';f.loading='lazy';el.appendChild(f);})();`);
});
