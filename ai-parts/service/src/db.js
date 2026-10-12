// SQLite: собственная база модуля. В базу CRM модуль не пишет — позиции в wycenę
// добавляет сама CRM (через колбэк виджета), историю CRM присылает сюда по API.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

let db;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function openMemoryDb() {
  db = new Database(':memory:');
  migrate(db);
  return db;
}

function migrate(d) {
  d.exec(`
  CREATE TABLE IF NOT EXISTS workshops (
    id TEXT PRIMARY KEY,
    name TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    monthly_limit INTEGER NOT NULL DEFAULT 500,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS integrations (
    workshop_id TEXT NOT NULL,
    service TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    fields_enc TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'off',
    status_note TEXT,
    checked_at TEXT,
    PRIMARY KEY (workshop_id, service)
  );

  CREATE TABLE IF NOT EXISTS rules (
    workshop_id TEXT PRIMARY KEY,
    json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    workshop_id TEXT NOT NULL,
    wycena_id TEXT,
    user_id TEXT,
    input_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    steps_json TEXT NOT NULL DEFAULT '[]',
    question_json TEXT,
    result_json TEXT,
    messages_json TEXT,
    usage_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS jobs_wycena ON jobs(workshop_id, wycena_id);

  CREATE TABLE IF NOT EXISTS pl24_tasks (
    id TEXT PRIMARY KEY,
    workshop_id TEXT NOT NULL,
    job_id TEXT,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result_json TEXT,
    log_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    taken_at TEXT,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS extension_keys (
    id TEXT PRIMARY KEY,
    workshop_id TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workshop_id TEXT NOT NULL,
    source_id TEXT,
    wycena_id TEXT,
    vin TEXT,
    make TEXT,
    model TEXT,
    engine_code TEXT,
    year INTEGER,
    job_text TEXT,
    part_name TEXT,
    oe_number TEXT,
    oe_norm TEXT,
    brand TEXT,
    article_number TEXT,
    article_norm TEXT,
    supplier TEXT,
    price_net REAL,
    sale_net REAL,
    verified INTEGER NOT NULL DEFAULT 0,
    returned INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    search_text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (workshop_id, source_id)
  );
  CREATE INDEX IF NOT EXISTS history_vin ON history(workshop_id, vin);
  CREATE INDEX IF NOT EXISTS history_engine ON history(workshop_id, engine_code);
  CREATE INDEX IF NOT EXISTS history_oe ON history(workshop_id, oe_norm);
  CREATE INDEX IF NOT EXISTS history_art ON history(workshop_id, article_norm);

  CREATE TABLE IF NOT EXISTS ic_products (
    workshop_id TEXT NOT NULL,
    tow_kod TEXT NOT NULL,
    ic_index TEXT,
    tec_doc TEXT,
    tec_doc_norm TEXT,
    tec_doc_prod INTEGER,
    article_number TEXT,
    article_norm TEXT,
    manufacturer TEXT,
    short_description TEXT,
    description TEXT,
    blocked_return INTEGER,
    PRIMARY KEY (workshop_id, tow_kod)
  );
  CREATE INDEX IF NOT EXISTS ic_art ON ic_products(workshop_id, article_norm);
  CREATE INDEX IF NOT EXISTS ic_tecdoc ON ic_products(workshop_id, tec_doc_norm);

  CREATE TABLE IF NOT EXISTS usage (
    workshop_id TEXT NOT NULL,
    month TEXT NOT NULL,
    jobs INTEGER NOT NULL DEFAULT 0,
    web_searches INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (workshop_id, month)
  );
  `);
}

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;

// Нормализация номеров: только A-Z0-9, без пробелов/точек/дефисов.
export const normNumber = (s) => (s ? String(s).toUpperCase().replace(/[^A-Z0-9]/g, '') : '');

export function ensureWorkshop(id, name) {
  const d = getDb();
  d.prepare('INSERT OR IGNORE INTO workshops (id, name) VALUES (?, ?)').run(id, name || id);
  return d.prepare('SELECT * FROM workshops WHERE id = ?').get(id);
}

export function bumpUsage(workshopId, { jobs = 0, webSearches = 0, inputTokens = 0, outputTokens = 0 }) {
  const month = new Date().toISOString().slice(0, 7);
  getDb()
    .prepare(
      `INSERT INTO usage (workshop_id, month, jobs, web_searches, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workshop_id, month) DO UPDATE SET
         jobs = jobs + excluded.jobs,
         web_searches = web_searches + excluded.web_searches,
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens`
    )
    .run(workshopId, month, jobs, webSearches, inputTokens, outputTokens);
}

export function monthUsage(workshopId) {
  const month = new Date().toISOString().slice(0, 7);
  return (
    getDb().prepare('SELECT * FROM usage WHERE workshop_id = ? AND month = ?').get(workshopId, month) || {
      jobs: 0,
      web_searches: 0,
      input_tokens: 0,
      output_tokens: 0,
    }
  );
}
