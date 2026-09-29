// Данные авto: код Aztec с польского техпаспорта (dowód rejestracyjny) и поиск по номеру
import { logUsage } from './balances.js';
import { setSetting } from './db.js';
import { HttpError } from './util.js';
import { cfg } from './integrations/index.js';

/**
 * Распаковка NRV2E (вариант с 8-битным буфером), которой сжаты данные в коде Aztec техпаспорта.
 * Своя реализация по описанию формата UCL: литералы и пары (смещение, длина) с управляющими битами.
 */
export function nrv2eDecompress(src, outLen) {
  const out = new Uint8Array(outLen);
  let ip = 0, op = 0, bb = 0, lastOff = 1;
  const bit = () => {
    if ((bb & 0x7f) === 0) { if (ip >= src.length) throw new Error('Данные обрываются'); bb = src[ip++] * 2 + 1; } else bb *= 2;
    return (bb >> 8) & 1;
  };
  const byte = () => { if (ip >= src.length) throw new Error('Данные обрываются'); return src[ip++]; };
  for (;;) {
    while (bit()) { if (op >= outLen) throw new Error('Длина не совпадает'); out[op++] = byte(); }
    let off = 1;
    for (;;) {
      off = off * 2 + bit();
      if (bit()) break;
      off = (off - 1) * 2 + bit();
    }
    let len;
    if (off === 2) { off = lastOff; len = bit(); } else {
      off = ((off - 3) * 256 + byte()) >>> 0;
      if (off === 0xffffffff) break; // конец данных
      len = (off ^ 0xffffffff) & 1;
      off = (off >>> 1) + 1;
      lastOff = off;
    }
    if (len) len = 1 + bit();
    else if (bit()) len = 3 + bit();
    else { len++; do { len = len * 2 + bit(); } while (!bit()); len += 3; }
    if (off > 0x500) len++;
    if (off > op) throw new Error('Неверное смещение');
    for (let i = 0; i <= len; i++) { if (op >= outLen) throw new Error('Длина не совпадает'); out[op] = out[op - off]; op++; }
  }
  return out.subarray(0, op);
}

/** Текст из сканера (Base64) → поля техпаспорта */
export function decodeAztec(raw) {
  const b64 = String(raw || '').replace(/\s+/g, '');
  if (b64.length < 20) throw new HttpError(400, 'Слишком короткий код — отсканируйте Aztec на техпаспорте ещё раз');
  let bin;
  try { bin = Buffer.from(b64, 'base64'); } catch { throw new HttpError(400, 'Это не код техпаспорта'); }
  if (bin.length < 8) throw new HttpError(400, 'Это не код техпаспорта');
  const len = bin.readUInt32LE(0);
  if (!len || len > 100_000) throw new HttpError(400, 'Это не код техпаспорта (неверная длина)');
  let text;
  try { text = Buffer.from(nrv2eDecompress(bin.subarray(4), len)).toString('utf16le'); } catch (e) { throw new HttpError(400, 'Не удалось прочитать код: ' + e.message); }
  return parseRegFields(text.split('|'));
}

const none = (v) => { const s = String(v ?? '').trim(); return !s || /^-+$/.test(s) ? '' : s; };
const num = (v) => { const n = parseFloat(none(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const FUEL = { P: 'benzyna', D: 'diesel', M: 'mieszanka', LPG: 'LPG', CNG: 'CNG', H: 'wodór', EE: 'elektryczny', '999': 'inne' };
const title = (s) => s.toLowerCase().replace(/(^|[\s-])\S/g, (m) => m.toUpperCase());

/** Порядок полей в коде Aztec (формат dowodu rejestracyjnego). PESEL/REGON не берём — это лишние персональные данные */
export function parseRegFields(f) {
  const fuelRaw = none(f[50]).split(/[\s/,]+/).filter(Boolean);
  const holderFull = none(f[16]);
  const owner = {
    name: none(f[17]) && none(f[18]) ? title(`${none(f[17])} ${none(f[18])}`) : holderFull ? title(holderFull) : '',
    first_name: title(none(f[17])), last_name: title(none(f[18])), company: none(f[19]) ? none(f[19]) : '',
    postcode: none(f[21]), city: title(none(f[22])),
    street: [title(none(f[24])), none(f[25]) + (none(f[26]) ? '/' + none(f[26]) : '')].filter(Boolean).join(' '),
  };
  const car = {
    plate: none(f[7]).replace(/\s+/g, ' ').toUpperCase(),
    make: cleanModel(none(f[8])), type: none(f[9]), variant: none(f[10]), version: none(f[11]), model: cleanModel(none(f[12])),
    vin: none(f[13]).toUpperCase(),
    reg_doc: none(f[1]), reg_doc_issued: none(f[14]),
    capacity: num(f[48]) ? Math.round(num(f[48])) : null,
    power_kw: num(f[49]) ? Math.round(num(f[49])) : null,
    fuel: fuelRaw.map((x) => FUEL[x] || x).join(' + '),
    first_reg: none(f[51]),
    year: none(f[56]) || none(f[51]).slice(0, 4),
    category: none(f[42]), vehicle_type: none(f[54]) ? title(none(f[54])) : '',
    mass_kg: num(f[39]) ? Math.round(num(f[39])) : null, seats: num(f[52]),
  };
  if (!car.vin && !car.plate) throw new HttpError(400, 'В коде нет номера и VIN — это не техпаспорт?');
  return { car, owner, fieldsCount: f.length };
}

// ── Поиск по номеру ─────────────────────────────────────────────────────────
const tv = (v) => (v && typeof v === 'object' ? v.CurrentTextValue ?? v.CurrentValue ?? '' : v ?? '');

export async function lookupPlate(plateRaw, opts = {}) {
  const c = opts.config || cfg('plate');
  if (!c) throw new HttpError(400, 'Поиск по номеру не подключён: Настройки → Интеграции → Данные авто по номеру. Бесплатно — отсканируйте Aztec с техпаспорта.');
  const plate = String(plateRaw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (plate.length < 4) throw new HttpError(400, 'Введите номер');
  if (c.provider === 'custom') {
    if (!c.url) throw new HttpError(400, 'Укажите адрес своего сервиса');
    let headers = {};
    try { headers = c.headers ? JSON.parse(c.headers) : {}; } catch { throw new HttpError(400, 'Заголовки — в формате JSON'); }
    const r = await fetch(c.url.replaceAll('{plate}', encodeURIComponent(plate)), { headers: { Accept: 'application/json', ...headers } });
    if (!r.ok) throw new HttpError(502, `Сервис ответил ${r.status}`);
    const j = await r.json();
    if (!opts.test) logUsage('plate', plate);
    const d = j.data || j.vehicle || j;
    return normalize({
      make: d.make || d.brand || d.marka, model: d.model, year: d.year || d.production_year || d.rok_produkcji, vin: d.vin,
      capacity: d.capacity || d.engine_capacity || d.pojemnosc, power_kw: d.power_kw || d.power || d.moc, fuel: d.fuel || d.fuel_type || d.paliwo,
      first_reg: d.first_registration || d.first_reg || d.data_pierwszej_rejestracji, color: d.color || d.kolor,
    }, plate);
  }
  if (!c.username) throw new HttpError(400, 'Укажите логин RegCheck');
  const base = process.env.REGCHECK_BASE || 'https://www.regcheck.org.uk/api/reg.asmx';
  const r = await fetch(`${base}/CheckPoland?RegistrationNumber=${encodeURIComponent(plate)}&username=${encodeURIComponent(c.username)}`);
  const t = await r.text();
  if (!r.ok && /credit|balance|insufficient|no lookups/i.test(t)) { setSetting('bal_plate_empty', '1'); throw new HttpError(402, 'RegCheck: закончились запросы — пополните пакет на tablicarejestracyjnaapi.pl'); }
  if (!r.ok) throw new HttpError(r.status === 500 && /not found|no vehicle/i.test(t) ? 404 : 502, /not found|no vehicle/i.test(t) ? 'Номер не найден в базе' : `RegCheck: ${t.replace(/<[^>]+>/g, ' ').trim().slice(0, 160) || r.status}`);
  const m = t.match(/<vehicleJson>([\s\S]*?)<\/vehicleJson>/);
  if (!m) throw new HttpError(404, 'Номер не найден в базе');
  const raw = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  let d;
  try { d = JSON.parse(raw); } catch { throw new HttpError(502, 'RegCheck: непонятный ответ'); }
  if (!opts.test) { logUsage('plate', plate); setSetting('bal_plate_empty', ''); }
  return normalize({
    make: tv(d.CarMake) || tv(d.MakeDescription), model: tv(d.CarModel) || tv(d.ModelDescription), year: d.ManufacturingYear || d.RegistrationYear,
    vin: d.VehicleIdentificationNumber, capacity: tv(d.EngineSize), power_kw: d.Power, fuel: tv(d.FuelType), first_reg: d.RegistrationDate, description: d.Description,
  }, plate);
}

/** Модель из CEPiK приходит с кодом варианта через кучу пробелов: «540i            MR`16 E» → «540i» */
export const cleanModel = (v) => String(v || '').replace(/\u00a0/g, ' ').trim().split(/\s{3,}|\t/)[0].replace(/\s+MR[`'´]?\d{2}.*$/i, '').replace(/\s+/g, ' ').trim();
function normalize(x, plate) {
  const n = (v) => { const k = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(k) && k > 0 ? Math.round(k) : null; };
  return {
    plate, make: cleanModel(x.make), model: cleanModel(x.model), year: String(x.year || '').slice(0, 4),
    vin: String(x.vin || '').toUpperCase().trim(), capacity: n(x.capacity), power_kw: n(x.power_kw), fuel: String(x.fuel || '').trim(),
    first_reg: String(x.first_reg || '').slice(0, 10), color: x.color || '', description: x.description || '',
  };
}

export async function testPlate() {
  const c = cfg('plate', { ignoreEnabled: true });
  const r = await lookupPlate(c?.testPlate || 'WX1234A', { config: c || {} });
  return `Найдено: ${[r.make, r.model, r.year].filter(Boolean).join(' ') || 'данные получены'}`;
}
