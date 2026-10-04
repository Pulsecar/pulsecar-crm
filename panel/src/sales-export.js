// Пакет документов продажи за период — для бухгалтера в конце месяца:
// ZIP: rejestr sprzedaży (Excel), каждая фактура (HTML для печати/PDF), XML KSeF (это и есть юридическая e-фактура).
// Печать одним файлом: все фактуры подряд на одной странице → «Сохранить как PDF» в браузере.
import XLSX from 'xlsx';
import { all, one } from './db.js';
import { config } from './config.js';
import { saleDocHtml, settingsMap } from './documents.js';
import { zip } from './zip.js';

const KIND_PL = { vat: 'Faktura VAT', correction: 'Faktura korygująca', proforma: 'Pro forma' };
const PAY_PL = { cash: 'gotówka', card: 'karta', blik: 'BLIK', transfer: 'przelew', mixed: 'mieszana', points: 'punkty' };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const json = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const fileName = (s) => String(s || 'dokument').replace(/[\/\\]+/g, '-').replace(/[^\p{L}\p{N} ._-]+/gu, '_').trim();
const RATES = ['23', '8', '5', '0', 'zw'];
const rateKey = (v) => (v === 'zw' || v === 'np' || v == null || v === '' || Number(v) < 0 ? 'zw' : String(Number(v)));

/** Документы продажи за период (или выбранные id) */
export function pickDocs({ from, to, kinds = ['vat', 'correction'], ids }) {
  if (ids?.length) return all(`SELECT * FROM sales_docs WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY issue_date, id`, ...ids);
  const k = kinds.filter((x) => KIND_PL[x]);
  if (!k.length) return [];
  return all(`SELECT * FROM sales_docs WHERE issue_date BETWEEN ? AND ? AND kind IN (${k.map(() => '?').join(',')}) AND status <> 'cancelled' ORDER BY issue_date, id`, from, to, ...k);
}

function byRate(lines) {
  const out = Object.fromEntries(RATES.map((r) => [r, { net: 0, vat: 0 }]));
  for (const l of lines || []) {
    const k = rateKey(l.vat);
    const net = Number(l.net) || 0, gross = Number(l.gross) || 0;
    const vat = l.vat_amt != null ? Number(l.vat_amt) : gross - net;
    out[k] ||= { net: 0, vat: 0 };
    out[k].net += net; out[k].vat += vat;
  }
  return out;
}

/** Rejestr sprzedaży VAT: строка на документ, корректа — разница к исходной */
function registerRows(docs) {
  return docs.map((d, n) => {
    const b = json(d.buyer, {});
    let rates = byRate(json(d.items, []));
    let net = d.total_net, vat = d.total_vat, gross = d.total_gross, ref = '';
    if (d.kind === 'correction' && d.corrects_id) {
      const o = one('SELECT * FROM sales_docs WHERE id = ?', d.corrects_id);
      if (o) {
        const before = byRate(json(o.items, []));
        for (const k of Object.keys(rates)) { rates[k] = { net: rates[k].net - (before[k]?.net || 0), vat: rates[k].vat - (before[k]?.vat || 0) }; }
        net -= o.total_net; vat -= o.total_vat; gross -= o.total_gross; ref = o.number;
      }
    }
    const row = {
      'Lp.': n + 1, 'Rodzaj': KIND_PL[d.kind] || d.kind, 'Numer': d.number, 'Dotyczy faktury': ref, 'Data wystawienia': d.issue_date, 'Data sprzedaży': d.sale_date || d.issue_date,
      'Nabywca': b.name || '', 'NIP nabywcy': b.nip || '', 'Adres nabywcy': [b.street, [b.postcode, b.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    };
    for (const k of RATES) { row[`Netto ${k === 'zw' ? 'zw.' : k + '%'}`] = r2(rates[k]?.net); if (k !== 'zw' && k !== '0') row[`VAT ${k}%`] = r2(rates[k]?.vat); }
    Object.assign(row, {
      'Razem netto': r2(net), 'Razem VAT': r2(vat), 'Razem brutto': r2(gross), 'Sposób płatności': PAY_PL[d.payment_method] || d.payment_method || '',
      'Zapłacono': r2(d.paid), 'Termin płatności': d.due_date || '', 'Numer KSeF': d.ksef_number || '', 'Status KSeF': d.ksef_status || (d.ext_url ? 'Fakturownia' : ''),
    });
    return row;
  });
}

function receiptRows(from, to) {
  const rows = [
    ...all(`SELECT r.number, substr(r.created_at,1,10) date, r.total, r.payment_method, r.nip, r.status, o.number order_no FROM receipts r LEFT JOIN orders o ON o.id = r.order_id
      WHERE substr(r.created_at,1,10) BETWEEN ? AND ? AND r.status <> 'error' ORDER BY r.created_at`, from, to),
    ...all(`SELECT o.receipt_no number, substr(COALESCE(o.closed_at, o.created_at),1,10) date, o.total, NULL payment_method, c.nip, 'manual' status, o.number order_no FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id WHERE COALESCE(o.receipt_no,'') <> '' AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.order_id = o.id)
      AND substr(COALESCE(o.closed_at, o.created_at),1,10) BETWEEN ? AND ?`, from, to),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return rows.map((r, n) => ({ 'Lp.': n + 1, 'Numer paragonu': r.number || '', 'Data': r.date, 'Zlecenie': r.order_no || '', 'NIP nabywcy': r.nip || '', 'Brutto': r2(r.total), 'Płatność': PAY_PL[r.payment_method] || '' }));
}

export function registerXlsx(docs, { from, to, receipts }) {
  const wb = XLSX.utils.book_new();
  const reg = registerRows(docs.filter((d) => d.kind !== 'proforma'));
  const sheet = (rows, empty) => XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': empty }]);
  const ws = sheet(reg, 'Brak faktur w okresie');
  if (reg.length) {
    const sum = Object.fromEntries(Object.keys(reg[0]).map((k) => [k, typeof reg[0][k] === 'number' && !['Lp.'].includes(k) ? r2(reg.reduce((a, r) => a + (r[k] || 0), 0)) : '']));
    sum['Rodzaj'] = 'RAZEM'; XLSX.utils.sheet_add_json(ws, [sum], { skipHeader: true, origin: -1 });
  }
  ws['!cols'] = Object.keys(reg[0] || { a: 1 }).map((k) => ({ wch: Math.max(10, Math.min(40, k.length + 2)) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Rejestr sprzedaży');
  const pf = docs.filter((d) => d.kind === 'proforma');
  if (pf.length) XLSX.utils.book_append_sheet(wb, sheet(pf.map((d, n) => ({ 'Lp.': n + 1, 'Numer': d.number, 'Data': d.issue_date, 'Nabywca': json(d.buyer, {}).name || '', 'Brutto': r2(d.total_gross) })), ''), 'Pro forma');
  if (receipts) XLSX.utils.book_append_sheet(wb, sheet(receiptRows(from, to), 'Brak paragonów w okresie'), 'Paragony');
  const S = settingsMap();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Sprzedawca', S.company_legal_name || S.company_name || ''], ['NIP', S.company_nip || ''], ['Okres', `${from} — ${to}`],
    ['Liczba faktur i korekt', reg.length], ['Wygenerowano', new Date().toISOString().slice(0, 16).replace('T', ' ')],
  ]), 'Informacje');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** HTML документа без панели, с абсолютными ссылками (открывается из ZIP) */
const standalone = (d, S) => saleDocHtml(d.id, { S, bar: false }).replace(/(src|href)="\/(?!\/)/g, `$1="${config.publicUrl.replace(/\/$/, '')}/`);

export function exportZip({ from, to, kinds, ids, receipts = true, html = true, xml = true }) {
  const docs = pickDocs({ from, to, kinds, ids });
  const S = settingsMap();
  const period = ids?.length ? 'wybrane' : from.slice(0, 7) === to.slice(0, 7) ? from.slice(0, 7) : `${from}_${to}`;
  const files = [{ name: `Rejestr_sprzedazy_${period}.xlsx`, data: registerXlsx(docs, { from, to, receipts }) }];
  for (const d of docs) {
    const base = fileName(`${d.number} ${d.issue_date}`);
    const dir = d.kind === 'proforma' ? 'Pro forma' : d.kind === 'correction' ? 'Korekty' : 'Faktury';
    if (html) files.push({ name: `${dir}/${base}.html`, data: standalone(d, S) });
    if (xml && d.ksef_xml) files.push({ name: `KSeF XML/${base}.xml`, data: d.ksef_xml });
  }
  files.push({ name: 'CZYTAJ.txt', data: [
    `Dokumenty sprzedaży ${S.company_legal_name || S.company_name || ''} (NIP ${S.company_nip || ''}), okres: ${from} — ${to}.`, '',
    '• Rejestr_sprzedazy_*.xlsx — zestawienie faktur, korekt (różnice), Pro forma i paragonów z podziałem na stawki VAT.',
    '• Faktury / Korekty / Pro forma — każdy dokument jako plik HTML: otwórz w przeglądarce → Drukuj → Zapisz jako PDF.',
    '• KSeF XML — faktury ustrukturyzowane przesłane do KSeF (FA(3)); to one są fakturami w rozumieniu ustawy.', '',
  ].join('\r\n') });
  return { buffer: zip(files), name: `Sprzedaz_${period}.zip`, count: docs.length };
}

/** Все документы одной страницей для печати / одного PDF */
export function printAll({ from, to, kinds, ids }) {
  const docs = pickDocs({ from, to, kinds, ids });
  const S = settingsMap();
  if (!docs.length) return `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px">Brak dokumentów w okresie ${from} — ${to}.</body>`;
  let head = '';
  const bodies = docs.map((d, i) => {
    const h = saleDocHtml(d.id, { S, bar: false });
    if (!i) head = h.slice(0, h.indexOf('<body>'));
    return h.slice(h.indexOf('<body>') + 6, h.lastIndexOf('</body>'));
  });
  return `${head.replace(/<title>[^<]*<\/title>/, `<title>Faktury ${from} — ${to}</title>`)}<style>.sheet{break-after:page}.sheet:last-of-type{break-after:auto}
.allbar{position:sticky;top:0;z-index:5;background:#15171a;color:#fff;padding:10px 16px;font:14px system-ui;display:flex;gap:12px;align-items:center}.allbar button{font:inherit;padding:6px 12px;border-radius:6px;border:0;background:#1BF372;cursor:pointer}
@media print{.allbar{display:none}}</style><body><div class="allbar"><b>${docs.length} dokument(ów) · ${from} — ${to}</b><button onclick="print()">Drukuj / zapisz jako jeden PDF</button></div>${bodies.join('\n')}</body></html>`;
}
