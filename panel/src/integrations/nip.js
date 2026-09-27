// Поиск фирмы по NIP: «Biała lista podatników VAT» Минфина (wl-api.mf.gov.pl) — бесплатно, без ключа.
// Отдаёт полное название, адрес, REGON, KRS, статус VAT и счета из белого списка.
import { HttpError } from '../util.js';
import { validNip } from './ksef.js';

const BASE = () => process.env.NIP_API_BASE || 'https://wl-api.mf.gov.pl';
const cap = (s) => String(s || '').toLowerCase().replace(/(^|[\s\-/.(„"])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(Ul|Al|Pl|Os)\.? /g, (m) => m.toLowerCase()).replace(/\bSp\. Z O\.o\./gi, 'sp. z o.o.').replace(/\bS\.a\./g, 'S.A.');

/** «UL. RODZINY HISZPAŃSKICH 8, 02-685 WARSZAWA» → { street, postcode, city } */
export function parseAddress(a) {
  const s = String(a || '').trim();
  const m = /^(.*?),?\s*(\d{2}-\d{3})\s+(.+)$/.exec(s);
  if (!m) return { street: cap(s), postcode: '', city: '' };
  return { street: cap(m[1].replace(/,\s*$/, '')), postcode: m[2], city: cap(m[3]) };
}

export async function lookupNip(nipRaw) {
  const nip = String(nipRaw || '').replace(/\D/g, '');
  if (!validNip(nip)) throw new HttpError(400, 'Неверный NIP — проверьте 10 цифр');
  const date = new Date().toISOString().slice(0, 10);
  let r;
  try { r = await fetch(`${BASE()}/api/search/nip/${nip}?date=${date}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) }); }
  catch { throw new HttpError(502, 'Реестр Минфина не отвечает, попробуйте позже'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(r.status === 400 ? 400 : 502, 'Реестр Минфина: ' + (j.message || r.status));
  const s = j.result?.subject;
  if (!s) throw new HttpError(404, 'Фирма с таким NIP не найдена в реестре VAT (Biała lista)');
  const addr = parseAddress(s.workingAddress || s.residenceAddress);
  return {
    nip, name: s.name, company: s.name, regon: s.regon || '', krs: s.krs || '', statusVat: s.statusVat || '',
    ...addr, address: s.workingAddress || s.residenceAddress || '', accounts: s.accountNumbers || [],
    registered: s.registrationLegalDate || null, source: 'Biała lista MF · ' + (j.result.requestDateTime || date),
  };
}
