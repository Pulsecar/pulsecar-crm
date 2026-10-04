import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerActorFunctions } from './actor.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { migrate } from './schema.js';

// Несколько сервисов (филиалов): у каждого своя база SQLite. Какая база «текущая» — решает запрос
// (AsyncLocalStorage), по умолчанию — главная. Весь код работает через db / one / all / run и не знает о филиалах.
mkdirSync(dirname(config.dbPath), { recursive: true });
const dbStore = new AsyncLocalStorage();
export const mainDb = new DatabaseSync(config.dbPath);
registerActorFunctions(mainDb);
/** Текущая база (филиал) */
export const curDb = () => dbStore.getStore() || mainDb;
/** Выполнить fn на базе d (филиал). Вложенные вызовы и async-продолжения видят эту же базу */
export const withDb = (d, fn) => dbStore.run(d, fn);
export const db = new Proxy({}, { get(_t, k) { const d = curDb(); const v = d[k]; return typeof v === 'function' ? v.bind(d) : v; } });

/** Открыть базу филиала: схема, миграции и начальные данные — как у главной */
export function openDb(path, hooks = []) {
  mkdirSync(dirname(path), { recursive: true });
  const d = new DatabaseSync(path);
  registerActorFunctions(d);
  withDb(d, () => { migrate(); hooks.forEach((h) => h()); });
  return d;
}

/** Выполнить функцию в транзакции (вложенные вызовы — без повторного BEGIN) */
const depthOf = new WeakMap();
export function tx(fn) {
  const cur = curDb(), depth = depthOf.get(cur) || 0;
  if (depth > 0) return fn();
  depthOf.set(cur, 1);
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depthOf.set(cur, 0);
  }
}

export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export const insert = (table, obj) => {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  const r = run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => obj[k] ?? null));
  return Number(r.lastInsertRowid);
};
export const update = (table, id, obj) => {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => obj[k] ?? null), id);
};

export function log(entity, entityId, action, details, staff) {
  run('INSERT INTO activity (entity, entity_id, action, details, staff) VALUES (?, ?, ?, ?, ?)', entity, entityId, action,
    typeof details === 'string' ? details : JSON.stringify(details ?? null), staff ?? null);
}

export const getSetting = (k, d = null) => one('SELECT value FROM settings WHERE key = ?', k)?.value ?? d;
export const setSetting = (k, v) => run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v);

export function quoteConvertedStatus() {
  let st = one(`SELECT id FROM order_statuses WHERE id = (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'quote_converted_status')`);
  if (!st) {
    const pos = (one('SELECT MAX(pos) m FROM order_statuses')?.m || 0) + 1;
    const id = insert('order_statuses', { name: 'Создан заказ', color: '#1BF372', pos, is_final: 1, lock_edit: 1, notify_client: 0, client_label: 'Zlecenie utworzone', scope: 'quote' });
    run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('quote_converted_status', ?)`, String(id));
    st = { id };
    // выцены, по которым заказ уже создан раньше, — тоже в «Создан заказ»
    run(`UPDATE orders SET status_id = ? WHERE kind = 'quote' AND (merged_into IS NOT NULL OR EXISTS (SELECT 1 FROM orders z WHERE z.quote_id = orders.id AND z.kind = 'order'))`, id);
  }
  return st.id;
}

export function ilog(key, level, message) {
  run('INSERT INTO integration_log (key, level, message) VALUES (?, ?, ?)', key, level, String(message).slice(0, 1000));
  run(`DELETE FROM integration_log WHERE id < (SELECT MAX(id) - 500 FROM integration_log)`);
}

// схема главной базы
withDb(mainDb, migrate);
