// Несколько сервисов (филиалов) одной фирмы. Каждый — отдельная база SQLite (свои клиенты, авто, склад, касса,
// сотрудники, нумерация). Реквизиты фирмы, KSeF, интеграции, прайс и статусы при создании копируются из главного.
// Владелец (администратор главного сервиса) переключается между сервисами и видит общий дашборд.
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { mainDb, curDb, withDb, openDb } from './db.js';
import { initAudit } from './audit.js';
import { HttpError } from './util.js';

mainDb.exec(`CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, address TEXT, file TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

export const MAIN = 'main';
// данные сервиса (у каждого свои) и реквизиты фирмы (одна фирма — обычно одинаковые во всех сервисах)
export const SERVICE_KEYS = ['company_brand', 'company_address', 'company_phone', 'company_email', 'company_www', 'company_bank', 'company_bank_name',
  'hours_start', 'hours_end', 'slot_min', 'review_url', 'order_terms'];
export const FIRM_KEYS = ['company_nip', 'company_vat_eu', 'company_legal_name', 'company_name', 'company_street', 'company_postcode', 'company_city',
  'company_regon', 'company_krs', 'company_bdo', 'company_capital', 'company_court', 'company_pkd', 'company_swift'];
const opened = new Map();          // code → DatabaseSync
const idle = new Map();         // отключённые сервисы, открытые только для правки данных
const codeOf = new WeakMap();      // DatabaseSync → code
codeOf.set(mainDb, MAIN);

const rows = () => mainDb.prepare('SELECT * FROM branches ORDER BY id').all();
const mainName = () => mainDb.prepare(`SELECT value FROM settings WHERE key = 'branch_name'`).get()?.value
  || mainDb.prepare(`SELECT value FROM settings WHERE key = 'company_brand'`).get()?.value || 'Główny serwis';

/** Все сервисы: главный + филиалы */
export function listBranches({ withInactive = false } = {}) {
  const mainAddr = mainDb.prepare(`SELECT value FROM settings WHERE key = 'company_address'`).get()?.value || null;
  return [{ code: MAIN, name: mainName(), address: mainAddr, active: 1, main: true },
    ...rows().filter((b) => withInactive || b.active).map((b) => ({ code: b.code, name: b.name, address: b.address, active: b.active, main: false, created_at: b.created_at }))];
}

/** База сервиса по коду (null — нет такого или отключён) */
export function branchDb(code) {
  if (!code || code === MAIN) return mainDb;
  if (opened.has(code)) return opened.get(code);
  const b = mainDb.prepare('SELECT * FROM branches WHERE code = ? AND active = 1').get(code);
  if (!b) return null;
  const d = openDb(join(dirname(config.dbPath), b.file), [initAudit]);
  opened.set(code, d); codeOf.set(d, code);
  return d;
}
export const curBranch = () => codeOf.get(curDb()) || MAIN;
export const branchName = (code) => listBranches({ withInactive: true }).find((b) => b.code === code)?.name || code;

/** Все базы (для фоновых задач, хуков оплаты, iCal) */
export function allDbs() {
  return [mainDb, ...rows().filter((b) => b.active).map((b) => branchDb(b.code)).filter(Boolean)];
}
/** Выполнить fn на каждой базе по очереди; ошибка одного сервиса не мешает остальным */
export async function forEachDb(fn) {
  for (const d of allDbs()) {
    try { await withDb(d, fn); } catch (e) { console.error(`[${codeOf.get(d)}]`, e.message); }
  }
}

// что копируем из главного сервиса в новый
const COPY_TABLES = ['order_statuses', 'order_types', 'service_catalog', 'expense_categories', 'price_groups', 'order_templates', 'checklists', 'integrations', 'doc_numbering', 'cash_registers'];
const SKIP_SETTINGS = /(_seeded|_migrated|^bal_|token|^branch_)/;

export function createBranch({ name, code, address }, ownerStaff) {
  name = String(name || '').trim().slice(0, 80);
  code = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (!name) throw new HttpError(400, 'Укажите название сервиса');
  if (!code || code.length < 2) throw new HttpError(400, 'Код сервиса — 2–8 латинских букв или цифр (например W2)');
  if (code === 'MAIN' || mainDb.prepare('SELECT 1 FROM branches WHERE code = ?').get(code)) throw new HttpError(409, 'Сервис с таким кодом уже есть');
  const file = `branches/${code.toLowerCase()}.db`;
  if (existsSync(join(dirname(config.dbPath), file))) throw new HttpError(409, 'Файл базы для этого кода уже существует');
  mainDb.prepare('INSERT INTO branches (code, name, address, file) VALUES (?, ?, ?, ?)').run(code, name, address || null, file);
  const d = branchDb(code);
  // настройки и справочники — как в главном
  const settings = mainDb.prepare('SELECT key, value FROM settings').all().filter((r) => !SKIP_SETTINGS.test(r.key));
  d.exec('BEGIN');
  try {
    const up = d.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const r of settings) up.run(r.key, r.value);
    up.run('branch_name', name);
    for (const t of COPY_TABLES) {
      const cols = d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      const src = mainDb.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name).filter((c) => cols.includes(c));
      if (!src.length) continue;
      d.exec(`DELETE FROM ${t}`);
      const ins = d.prepare(`INSERT INTO ${t} (${src.join(',')}) VALUES (${src.map(() => '?').join(',')})`);
      for (const r of mainDb.prepare(`SELECT ${src.join(',')} FROM ${t}`).all()) ins.run(...src.map((c) => r[c]));
    }
    // своя ссылка-подписка на календарь
    const cal = d.prepare(`SELECT config FROM integrations WHERE key = 'calendar'`).get();
    if (cal) { const c = JSON.parse(cal.config || '{}'); if (c.feedToken) { c.feedToken = randomBytes(18).toString('base64url'); d.prepare(`UPDATE integrations SET config = ? WHERE key = 'calendar'`).run(JSON.stringify(c)); } }
    // одна фирма (один NIP) — номера документов не должны совпадать с главным: добавляем код сервиса
    for (const n of d.prepare('SELECT key, pattern FROM doc_numbering').all()) {
      if (!n.pattern.includes('/' + code)) d.prepare('UPDATE doc_numbering SET pattern = ? WHERE key = ?').run(`${n.pattern}/${code}`, n.key);
    }
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  if (ownerStaff) ownerIn(code, ownerStaff);
  return { code, name };
}

export function updateBranch(code, { name, address, active }) {
  const b = mainDb.prepare('SELECT * FROM branches WHERE code = ?').get(code);
  if (!b) {
    if (code === MAIN && name) { mainDb.prepare(`INSERT INTO settings (key, value) VALUES ('branch_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(name).slice(0, 80)); return; }
    throw new HttpError(404, 'Сервис не найден');
  }
  mainDb.prepare('UPDATE branches SET name = COALESCE(?, name), address = COALESCE(?, address), active = COALESCE(?, active) WHERE code = ?')
    .run(name ? String(name).slice(0, 80) : null, address ?? null, active === undefined ? null : (active ? 1 : 0), code);
  if (active === false) { opened.delete(code); }
  if (name) { const d = branchDb(code); d?.prepare(`INSERT INTO settings (key, value) VALUES ('branch_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(name).slice(0, 80)); }
}

/** Учётная запись владельца в сервисе (создаётся при первом входе): чтобы его действия были подписаны его именем */
export function ownerIn(code, owner) {
  const d = branchDb(code);
  if (!d) throw new HttpError(404, 'Сервис не найден или отключён');
  if (d === mainDb) return owner.id;
  const key = `owner_staff_${owner.id}`;
  let id = Number(d.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value) || 0;
  const row = id && d.prepare('SELECT id FROM staff WHERE id = ?').get(id);
  if (!row) {
    id = Number(d.prepare(`INSERT INTO staff (name, role, is_mechanic, active, commission_pct, hourly_rate) VALUES (?, 'admin', 0, 1, 0, 0)`).run(owner.name).lastInsertRowid);
    d.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(id));
  } else {
    d.prepare(`UPDATE staff SET name = ?, role = 'admin', active = 1 WHERE id = ?`).run(owner.name, id);
  }
  return id;
}

const setIn = (d, k, v) => d.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v ?? ''));
const getIn = (d, k) => d.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value ?? '';

/** Данные сервиса для окна «Изменить сервис» (сервис может быть и отключён) */
export function branchSettings(code) {
  const b = listBranches({ withInactive: true }).find((x) => x.code === code);
  if (!b) throw new HttpError(404, 'Сервис не найден');
  let d = code === MAIN ? mainDb : opened.get(code);
  if (!d) d = branchDb(code) || idle.get(code);
  if (!d) { const r = mainDb.prepare('SELECT * FROM branches WHERE code = ?').get(code); d = openDb(join(dirname(config.dbPath), r.file), [initAudit]); idle.set(code, d); codeOf.set(d, code); }
  return { ...b, service: Object.fromEntries(SERVICE_KEYS.map((k) => [k, getIn(d, k)])), firm: Object.fromEntries(FIRM_KEYS.map((k) => [k, getIn(d, k)])), db: d };
}

/** Сохранить данные сервиса; firmToAll — реквизиты фирмы записать во все сервисы */
export function saveBranchSettings(code, { name, service = {}, firm = {}, firmToAll = false }) {
  const cur = branchSettings(code);
  if (name !== undefined && String(name).trim()) updateBranch(code, { name: String(name).trim() });
  for (const k of SERVICE_KEYS) if (service[k] !== undefined) setIn(cur.db, k, String(service[k]).slice(0, 4000));
  if (service.company_address !== undefined && code !== MAIN) mainDb.prepare('UPDATE branches SET address = ? WHERE code = ?').run(String(service.company_address).slice(0, 200) || null, code);
  const targets = firmToAll ? [mainDb, ...rows().map((r) => r.code === code ? cur.db : branchSettings(r.code).db)] : [cur.db];
  for (const d of targets) {
    for (const k of FIRM_KEYS) if (firm[k] !== undefined) setIn(d, k, String(firm[k]).slice(0, 400));
    const st = getIn(d, 'company_street'), pc = getIn(d, 'company_postcode'), city = getIn(d, 'company_city');
    if (st || city) setIn(d, 'company_legal_address', [st, [pc, city].filter(Boolean).join(' ')].filter(Boolean).join(', '));
  }
  return { ok: true, updated: targets.length };
}
