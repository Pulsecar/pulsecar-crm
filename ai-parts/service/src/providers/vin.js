// Расшифровка VIN: локальные проверки + NHTSA vPIC (бесплатно, без ключа).
// Комплектацию (опции) VIN сам по себе не содержит — её даёт partslink24 / DAT / фото наклейки.

const TRANSLIT = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

export function normalizeVin(vin) {
  return String(vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function validateVin(vin) {
  const v = normalizeVin(vin);
  if (v.length !== 17) return { ok: false, reason: 'VIN должен содержать 17 символов' };
  if (/[IOQ]/.test(v)) return { ok: false, reason: 'VIN не может содержать I, O, Q' };
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = v[i];
    const n = /\d/.test(c) ? Number(c) : TRANSLIT[c];
    sum += n * WEIGHTS[i];
  }
  const check = sum % 11 === 10 ? 'X' : String(sum % 11);
  // Контрольная цифра обязательна для Северной Америки; в Европе часто не используется.
  return { ok: true, vin: v, checkDigitValid: v[8] === check };
}

export function marketFromVin(vin) {
  const c = normalizeVin(vin)[0];
  if (['1', '4', '5'].includes(c)) return 'US';
  if (c === '2') return 'CA';
  if (c === '3') return 'MX';
  if ('STUVWXYZ'.includes(c)) return 'EU';
  if ('JKLMNPR'.includes(c)) return 'ASIA';
  return 'OTHER';
}

// Модельный год по 10-му символу (циклы 30 лет; берём ближайший не в будущем).
export function modelYearFromVin(vin) {
  const c = normalizeVin(vin)[9];
  const idx = YEAR_CODES.indexOf(c);
  if (idx < 0) return null;
  const now = new Date().getFullYear() + 1;
  let year = 1980 + idx;
  while (year + 30 <= now) year += 30;
  return year;
}

export async function decodeNhtsa(vin, fetchImpl = fetch) {
  const v = normalizeVin(vin);
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${v}?format=json`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`NHTSA HTTP ${res.status}`);
  const data = await res.json();
  const r = data?.Results?.[0] || {};
  const pick = [
    'Make', 'Manufacturer', 'Model', 'ModelYear', 'Trim', 'Series', 'BodyClass', 'DriveType',
    'EngineModel', 'EngineCylinders', 'DisplacementL', 'FuelTypePrimary', 'EngineHP',
    'TransmissionStyle', 'TransmissionSpeeds', 'PlantCity', 'PlantCountry', 'BrakeSystemType',
    'ErrorCode', 'ErrorText',
  ];
  const out = {};
  for (const k of pick) if (r[k] !== undefined && r[k] !== null && r[k] !== '') out[k] = r[k];
  return out;
}

export async function decodeVin(vin, { nhtsaEnabled = true, fetchImpl = fetch } = {}) {
  const val = validateVin(vin);
  if (!val.ok) return { ok: false, error: val.reason };
  const result = {
    ok: true,
    vin: val.vin,
    // Первый символ — страна СБОРКИ, а не рынок (BMW для США тоже начинается с W).
    assemblyRegion: marketFromVin(val.vin),
    modelYearFromVin: modelYearFromVin(val.vin),
    checkDigitValid: val.checkDigitValid,
    note: 'VIN не содержит заводских опций (тормоза, подвеска и т.п.). Если у модели есть варианты деталей — подтвердить опции через partslink24/DAT или фото наклейки.',
  };
  if (nhtsaEnabled) {
    try {
      result.nhtsa = await decodeNhtsa(val.vin, fetchImpl);
    } catch (e) {
      result.nhtsaError = String(e.message || e);
    }
  }
  // Признак машины северо-американской спецификации (импорт из США/Канады):
  // правильная контрольная цифра + NHTSA расшифровал VIN без ошибок.
  const nhtsaClean = result.nhtsa && String(result.nhtsa.ErrorCode || '').split(',').map((s) => s.trim()).includes('0');
  result.likelyNorthAmericanSpec = !!(val.checkDigitValid && (['US', 'CA', 'MX'].includes(result.assemblyRegion) || nhtsaClean));
  return result;
}
