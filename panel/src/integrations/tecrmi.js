// TecRMI (TecAlliance) — нормы времени на работы для конкретного авто.
// Документация: https://tecrmi-services.tecalliance.net/docs/ServiceRest.html
//   вход:      POST /auth/login {Company, Account, Password} → заголовок X-AuthToken → Authorization: "TecRMI <токен>"
//   авто:      POST /rest/VehicleTree/MakeList | RangeList | TypeList → TypeId (один раз на авто, сохраняем в карточке)
//   нормы:     GET  /rest/Times/BodiesForTimes → WorkList (поиск работы) → WorkSteps (время в часах)
import { one, run, all } from '../db.js';
import { HttpError, round2 } from '../util.js';
import { cfg, getState, setState } from './index.js';
import { config } from '../config.js';

const KEY = 'tecrmi';
const conf = () => {
  const c = cfg(KEY);
  if (!c) throw new HttpError(400, 'TecRMI не подключён: Настройки → Интеграции → TecRMI.');
  if (!c.company || !c.account || !c.password) throw new HttpError(400, 'Заполните Company, Account и пароль TecRMI.');
  return c;
};
export const tecrmiOn = () => { const c = cfg(KEY); return !!(c && c.company && c.account && c.password); };

const headers = (c) => ({ Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Pulsecar-CRM/1.0', UserAgent: 'Pulsecar-CRM/1.0', Origin: c.origin || config.publicUrl });

async function login(c) {
  const r = await fetch(c.baseUrl.replace(/\/$/, '') + '/auth/login', { method: 'POST', headers: headers(c), body: JSON.stringify({ Company: c.company, Account: c.account, Password: c.password }) });
  const t = r.headers.get('x-authtoken');
  if (!r.ok || !t) throw new HttpError(502, `TecRMI: вход не удался (${r.status}). Проверьте Company / Account / пароль.`);
  setState(KEY, { token: t, tokenFor: c.account, tokenAt: Date.now() });
  return t;
}
async function token(c, force) {
  const st = getState(KEY);
  // токен живёт ограниченно (срок не указан) — обновляем раз в 6 часов или при 401
  if (!force && st.token && st.tokenFor === c.account && Date.now() - (st.tokenAt || 0) < 6 * 3600_000) return st.token;
  return login(c);
}
async function rmi(path, { body, query } = {}, retry = true) {
  const c = conf();
  const t = await token(c);
  const q = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  const r = await fetch(c.baseUrl.replace(/\/$/, '') + path + q, { method: body ? 'POST' : 'GET', headers: { ...headers(c), Authorization: 'TecRMI ' + t }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && retry) { await token(c, true); return rmi(path, { body, query }, false); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new HttpError(502, `TecRMI ${path}: ${r.status} ${j?.Message || j?.message || ''}`.trim());
  return j;
}
const LC = () => { const c = conf(); return { CountryCode: c.country || 'PL', LanguageCode: c.language || 'pl' }; };

export async function testTecrmi() {
  const c = conf();
  await login(c);
  const makes = await rmi('/rest/VehicleTree/MakeList', { body: { ...LC(), ShowCar: true, ShowBike: false, ShowTruck: false, ModuleFilter: 'Lt' } });
  const info = `Вход успешен · марок с нормами времени: ${(makes || []).length}`;
  setState(KEY, { info, lastError: null });
  return info;
}

// ── Авто: подбор TecRMI TypeId по данным карточки ───────────────────────────────
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const detail = (t, re) => (t.TypeDetails || []).find((d) => re.test(d.AddInfoKeyName || ''))?.AddInfoKeyValue || '';
const typeLabel = (make, range, t) => {
  const yrs = detail(t, /(rok|year|baujahr|produk)/i), kw = detail(t, /kw/i), ccm = detail(t, /(ccm|cm3|pojemn|capacity)/i), eng = detail(t, /(silnik|engine|motor)/i);
  return { TypeId: t.TypeId, name: `${make} ${range} ${t.TypeName}`.replace(/\s+/g, ' ').trim(), info: [yrs, kw && kw + ' kW', ccm && ccm + ' ccm', eng].filter(Boolean).join(' · ') };
};

/** Варианты типа авто для TecRMI. Если вариант один — его можно сразу сохранить */
export async function vehicleCandidates(car) {
  const base = { ...LC(), ShowCar: true, ShowBike: false, ShowTruck: false, ModuleFilter: 'Lt', ComponentTypeIdFilter: null };
  const flt = [];
  if (car.power_kw) flt.push({ AddInfoKeyId: 5, AddInfoKeyFilterValue: String(car.power_kw) });
  const makes = await rmi('/rest/VehicleTree/MakeList', { body: base });
  const mk = norm(car.make);
  const make = (makes || []).find((m) => norm(m.MakeName) === mk) || (makes || []).find((m) => mk && (norm(m.MakeName).startsWith(mk) || mk.startsWith(norm(m.MakeName))));
  if (!make) return { makes: (makes || []).map((m) => ({ MakeId: m.MakeId, MakeName: m.MakeName })), candidates: [] };
  const model = String(car.model || '').trim().split(/\s+/)[0] || '';
  const ranges = await rmi('/rest/VehicleTree/RangeList', { body: { ...base, MakeId: make.MakeId, RangeNameFilter: model || null } });
  let list = ranges || [];
  if (!list.length && model) list = await rmi('/rest/VehicleTree/RangeList', { body: { ...base, MakeId: make.MakeId } }) || [];
  const out = [];
  for (const r of list.slice(0, 8)) {
    let types = await rmi('/rest/VehicleTree/TypeList', { body: { ...base, RangeId: r.RangeId, AddInfoKeyFilter: flt.length ? flt : null } }) || [];
    if (!types.length && flt.length) types = await rmi('/rest/VehicleTree/TypeList', { body: { ...base, RangeId: r.RangeId } }) || [];
    for (const t of types) out.push(typeLabel(make.MakeName, r.RangeName, t));
  }
  return { make: { MakeId: make.MakeId, MakeName: make.MakeName }, candidates: out.slice(0, 60) };
}
export async function ranges(makeId) { return rmi('/rest/VehicleTree/RangeList', { body: { ...LC(), ShowCar: true, ModuleFilter: 'Lt', MakeId: Number(makeId) } }); }
export async function types(rangeId, makeName = '', rangeName = '') {
  const t = await rmi('/rest/VehicleTree/TypeList', { body: { ...LC(), ShowCar: true, ModuleFilter: 'Lt', RangeId: Number(rangeId) } });
  return (t || []).map((x) => typeLabel(makeName, rangeName, x));
}

// ── Нормы времени ────────────────────────────────────────────────────────────
async function bodyId(typeId) {
  const b = await rmi('/rest/Times/BodiesForTimes', { query: { ...LC(), TypeId: typeId } });
  return (b || [])[0]?.QualColId ?? 0;
}

/** Поиск работы в каталоге TecRMI для авто: «alternator», «wymiana alternatora» */
export async function searchWorks(typeId, text) {
  const body = await bodyId(typeId);
  const res = await rmi('/rest/Times/WorkList', { query: { ...LC(), TypeId: typeId, BodyQualColId: body, SearchText: String(text || '').trim() || undefined, showPaint: false } });
  const out = [];
  for (const g of res || []) for (const s of g.SubGroups || []) for (const it of s.ItemMps || []) {
    out.push({ ItemMpId: it.ItemMpId, KorId: it.KorId, text: `${it.ItemMpText || ''} — ${it.KorText || ''}`.replace(/ — $/, ''), group: [g.MainGroupName, s.SubGroupName].filter(Boolean).join(' › ') });
  }
  return { body, works: out.slice(0, 100) };
}

/** Время работы (часы) для авто */
export async function workTime(typeId, itemMpId, korId, body) {
  if (body === undefined || body === null) body = await bodyId(typeId);
  const steps = await rmi('/rest/Times/WorkSteps', { query: { ...LC(), TypeId: typeId, BodyQualColId: body, ItemMpId: itemMpId, KorId: korId, KindOfWorkTime: 'DecimalWorkHours', ConsumerId: 'pulsecar' } });
  const list = steps || [];
  const main = list.find((s) => s.ItemMpId === Number(itemMpId) && s.KorId === Number(korId) && !s.IsOnlyForReference) || list.find((s) => !s.IsOnlyForReference) || list[0];
  if (!main) throw new HttpError(404, 'TecRMI не дал времени на эту работу для этого авто');
  return {
    hours: round2(Number(main.WorkTime) || 0), text: [main.ItemMpText, main.KorText].filter(Boolean).join(' — ') || main.WorkText || '',
    includes: (main.ExclusiveWorkPositions || []).map((x) => x.WorkText || x.ItemMpText).filter(Boolean).slice(0, 12),
  };
}

// ── Запоминаем, какая работа TecRMI соответствует нашей («Замена генератора» → alternator / wymiana) ──
export function mapping(name) {
  return one('SELECT * FROM tecrmi_map WHERE name_key = ?', nameKey(name));
}
export const nameKey = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function remember(name, w) {
  run(`INSERT INTO tecrmi_map (name_key, item_mp_id, kor_id, text) VALUES (?, ?, ?, ?)
    ON CONFLICT(name_key) DO UPDATE SET item_mp_id = excluded.item_mp_id, kor_id = excluded.kor_id, text = excluded.text, updated_at = datetime('now')`, nameKey(name), w.ItemMpId, w.KorId, w.text || null);
}
export const mappings = () => all('SELECT * FROM tecrmi_map ORDER BY name_key');
