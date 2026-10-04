import { MW_SERVICES } from './data/services-mw.js';
import { DatabaseSync } from 'node:sqlite';
import { registerActorFunctions } from './actor.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
registerActorFunctions(db);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Клиенты и авто ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  phone TEXT UNIQUE,
  crm_id TEXT UNIQUE,              -- ID во внешней системе (Motowarsztat и т. п.)
  name TEXT,
  company TEXT, nip TEXT,
  email TEXT,
  street TEXT, postcode TEXT, city TEXT,
  notes TEXT,
  discount_labor REAL NOT NULL DEFAULT 0,
  discount_parts REAL NOT NULL DEFAULT 0,
  marketing_consent INTEGER NOT NULL DEFAULT 1,
  card_no TEXT UNIQUE NOT NULL,
  registered_at TEXT,              -- когда клиент впервые вошёл в приложение
  welcome_given INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cars (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  car_key TEXT NOT NULL,           -- VIN или номер без пробелов
  plate TEXT, vin TEXT, make TEXT, model TEXT, year TEXT,
  engine TEXT, capacity INTEGER, power_kw INTEGER, fuel TEXT, color TEXT,
  last_mileage INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS cars_customer ON cars(customer_id);
CREATE INDEX IF NOT EXISTS cars_key ON cars(car_key);

-- ── Справочники мастерской ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY,
  login TEXT UNIQUE,
  name TEXT NOT NULL,
  pass_hash TEXT,
  role TEXT NOT NULL DEFAULT 'staff',   -- admin | staff | mechanic
  color TEXT,
  hourly_rate REAL NOT NULL DEFAULT 0,  -- ставка за нормо-час (RH)
  commission_pct REAL NOT NULL DEFAULT 0, -- % от работ в заказах
  is_mechanic INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stations (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT, pos INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS order_statuses (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT, pos INTEGER NOT NULL DEFAULT 0,
  is_final INTEGER NOT NULL DEFAULT 0,       -- заказ завершён
  lock_edit INTEGER NOT NULL DEFAULT 0,
  notify_client INTEGER NOT NULL DEFAULT 0,  -- SMS + push в приложении
  client_label TEXT                          -- как статус видит клиент в приложении и SMS (по-польски)
);

CREATE TABLE IF NOT EXISTS order_types (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS service_catalog (
  id INTEGER PRIMARY KEY, category TEXT, name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'oper',
  qty REAL NOT NULL DEFAULT 1, price REAL NOT NULL DEFAULT 0, vat REAL NOT NULL DEFAULT 23
);

CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

-- ── Заказы и сметы ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'order',     -- order | quote
  number TEXT UNIQUE NOT NULL,            -- ZL 12/09/2026, WY 3/09/2026 или номер из импорта
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  car_id INTEGER REFERENCES cars(id) ON DELETE SET NULL,
  status_id INTEGER REFERENCES order_statuses(id),
  type_id INTEGER REFERENCES order_types(id),
  mechanic_id INTEGER REFERENCES staff(id),
  mileage INTEGER,
  fuel_level TEXT,
  complaint TEXT,                         -- описание от клиента
  internal_note TEXT,
  mechanic_note TEXT,
  flags TEXT,                             -- JSON: return_parts, reg_doc, test_drive ...
  pickup_at TEXT,
  total REAL NOT NULL DEFAULT 0,          -- брутто
  total_net REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,           -- себестоимость запчастей
  paid REAL NOT NULL DEFAULT 0,
  source TEXT,                            -- crm | app | import
  quote_id INTEGER REFERENCES orders(id), -- смета, из которой создан заказ
  invoice_no TEXT, invoice_ext_id TEXT, invoice_url TEXT, receipt_no TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS orders_car ON orders(car_id);
CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                     -- labor | part
  name TEXT NOT NULL,
  code TEXT,
  product_id INTEGER REFERENCES products(id),
  mechanic_id INTEGER REFERENCES staff(id),
  qty REAL NOT NULL DEFAULT 1,
  unit TEXT,
  price REAL NOT NULL DEFAULT 0,          -- цена за единицу, брутто
  cost REAL NOT NULL DEFAULT 0,           -- закупочная, за единицу
  discount REAL NOT NULL DEFAULT 0,       -- %
  vat REAL NOT NULL DEFAULT 23,
  done INTEGER NOT NULL DEFAULT 0,
  pos INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS items_order ON order_items(order_id);

-- ── Терминарз ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  station_id INTEGER REFERENCES stations(id) ON DELETE SET NULL,  -- NULL = не распределено
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  car_id INTEGER REFERENCES cars(id) ON DELETE SET NULL,
  mechanic_id INTEGER REFERENCES staff(id),
  title TEXT,
  note TEXT,
  start_at TEXT,                          -- 'YYYY-MM-DD HH:MM', NULL для заявок без времени
  duration_min INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'planned', -- request | planned | arrived | no_show | cancelled
  source TEXT,                            -- crm | app | site | phone
  contact_name TEXT, contact_phone TEXT,  -- для заявок от новых людей
  preferred TEXT,                         -- пожелание по времени из заявки
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS appt_start ON appointments(start_at);

-- ── Склад ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,                              -- индекс / артикул
  manufacturer TEXT,
  unit TEXT NOT NULL DEFAULT 'szt.',
  stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  purchase_price REAL NOT NULL DEFAULT 0, -- нетто, последняя закупка
  sell_price REAL NOT NULL DEFAULT 0,     -- брутто
  vat REAL NOT NULL DEFAULT 23,
  location TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS products_code ON products(code);

CREATE TABLE IF NOT EXISTS stock_docs (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,                     -- PZ приход | WZ выдача | RW списание | PW оприходование
  number TEXT UNIQUE NOT NULL,
  ext_number TEXT,                        -- номер документа поставщика
  counterparty TEXT,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  doc_date TEXT NOT NULL,
  note TEXT,
  total_net REAL NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stock_doc_items (
  id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES stock_docs(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  price_net REAL NOT NULL DEFAULT 0
);

-- ── Закупки (фактуры поставщиков) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  supplier TEXT NOT NULL, number TEXT, category TEXT, description TEXT,
  doc_date TEXT, due_date TEXT,
  net REAL NOT NULL DEFAULT 0, gross REAL NOT NULL DEFAULT 0, paid REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Касса и оплаты ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  number TEXT,                            -- KP/KW для наличных
  direction TEXT NOT NULL DEFAULT 'in',   -- in | out
  method TEXT NOT NULL,                   -- cash | card | transfer | points
  amount REAL NOT NULL,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  note TEXT,
  staff TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Хранение шин ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS storage (
  id INTEGER PRIMARY KEY,
  number TEXT UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  car_id INTEGER REFERENCES cars(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'opony',     -- opony | koła
  description TEXT,                       -- размер, марка, DOT, состояние
  qty INTEGER NOT NULL DEFAULT 4,
  location TEXT,
  date_in TEXT NOT NULL,
  date_until TEXT,
  date_out TEXT,
  price REAL NOT NULL DEFAULT 0,
  note TEXT
);

-- ── Приложение и лояльность ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  qr_secret TEXT NOT NULL,
  device TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS otp (
  phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,          -- earn | redeem | bonus | adjust
  points INTEGER NOT NULL,
  amount_pln REAL,
  order_no TEXT,
  source TEXT,                 -- scan | crm | order | app | admin
  staff TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS tx_earn_order ON transactions(order_no) WHERE type = 'earn' AND order_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS tx_customer ON transactions(customer_id);

CREATE TABLE IF NOT EXISTS used_qr (
  card_no TEXT NOT NULL, step INTEGER NOT NULL, used_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (card_no, step)
);

-- ── Служебное ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY, filename TEXT, staff TEXT, stats TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY, entity TEXT, entity_id INTEGER, action TEXT, details TEXT, staff TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS activity_entity ON activity(entity, entity_id);
`);

/** Выполнить функцию в транзакции (вложенные вызовы — без повторного BEGIN) */
let depth = 0;
export function tx(fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
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


// ── Интеграции и миграции (безопасно для уже работающей базы) ────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS integrations (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT '{}',        -- служебное: токены доступа, время последней синхронизации
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS supplier_docs (
  id INTEGER PRIMARY KEY,
  supplier TEXT NOT NULL,                  -- intercars | file
  kind TEXT NOT NULL,                      -- delivery | invoice | order | file
  ext_id TEXT NOT NULL,
  doc_date TEXT,
  total_net REAL, total_gross REAL,
  lines_count INTEGER,
  raw TEXT,                                -- JSON документа поставщика
  stock_doc_id INTEGER REFERENCES stock_docs(id) ON DELETE SET NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (supplier, kind, ext_id)
);
CREATE TABLE IF NOT EXISTS integration_log (
  id INTEGER PRIMARY KEY, key TEXT, level TEXT, message TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
function addColumn(table, col, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('staff', 'ui', 'TEXT');                // что сотрудник видит на экране: JSON-список скрытых элементов
addColumn('products', 'supplier_sku', 'TEXT');       // SKU Inter Cars (например ADDFFF)
addColumn('products', 'ean', 'TEXT');
addColumn('products', 'supplier', 'TEXT');
addColumn('orders', 'pay_link', 'TEXT');
addColumn('orders', 'pay_ext_id', 'TEXT');
addColumn('orders', 'review_sent', 'INTEGER NOT NULL DEFAULT 0');
addColumn('appointments', 'reminded', 'INTEGER NOT NULL DEFAULT 0');
// SMS/e-mail по статусам (как в Motowarsztat: при смене статуса — окно с готовой SMS)
addColumn('order_statuses', 'sms_mode', "TEXT NOT NULL DEFAULT 'off'");   // off | ask | auto
addColumn('order_statuses', 'sms_template', 'TEXT');
addColumn('order_statuses', 'email_mode', "TEXT NOT NULL DEFAULT 'off'");
addColumn('order_statuses', 'email_template', 'TEXT');
// Электронная карта заказа (ссылка для клиента с кнопкой «Akceptuję»)
addColumn('orders', 'card_token', 'TEXT');
addColumn('orders', 'accepted_at', 'TEXT');
addColumn('orders', 'accepted_via', 'TEXT');
addColumn('orders', 'accept_code', 'TEXT');
addColumn('orders', 'accept_code_exp', 'INTEGER');
addColumn('orders', 'accept_doc', 'TEXT');           // какой документ подписывается кодом SMS
// Данные авто из техпаспорта (Aztec) и по номеру
for (const [c, t] of [['first_reg', 'TEXT'], ['engine_no', 'TEXT'], ['category', 'TEXT'], ['mass_kg', 'INTEGER'], ['seats', 'INTEGER'],
  ['reg_doc', 'TEXT'], ['inspection_until', 'TEXT'], ['insurance_until', 'TEXT'], ['key_no', 'TEXT'], ['paint_code', 'TEXT'], ['vehicle_type', 'TEXT']]) addColumn('cars', c, t);
// Карточка клиента и авто как в Motowarsztat: osoba prywatna / firma, имя и фамилия отдельно, страна,
// авто по умолчанию, способ и срок оплаты; у авто — единица пробега (km / mi)
for (const [c, t] of [['kind', "TEXT NOT NULL DEFAULT 'person'"], ['first_name', 'TEXT'], ['last_name', 'TEXT'], ['country', "TEXT NOT NULL DEFAULT 'PL'"],
  ['default_car_id', 'INTEGER'], ['payment_method', 'TEXT'], ['payment_term_days', 'INTEGER']]) addColumn('customers', c, t);
addColumn('cars', 'mileage_unit', "TEXT NOT NULL DEFAULT 'km'");
if (!getSetting('customers_kind_migrated')) {
  run("UPDATE customers SET kind = 'company' WHERE COALESCE(company,'') <> '' OR COALESCE(nip,'') <> ''");
  setSetting('customers_kind_migrated', '1');
}
db.exec(`CREATE TABLE IF NOT EXISTS sms_log (
  id INTEGER PRIMARY KEY, phone TEXT NOT NULL, customer_id INTEGER, order_id INTEGER,
  kind TEXT, text TEXT NOT NULL, provider TEXT, status TEXT NOT NULL,   -- sent | failed | logged (нет провайдера)
  ext_id TEXT, error TEXT, staff TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec('CREATE INDEX IF NOT EXISTS sms_log_created ON sms_log(created_at)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS orders_card_token ON orders(card_token)');
// ── Настройки как в Motowarsztat ─────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS doc_numbering (
  key TEXT PRIMARY KEY, label TEXT NOT NULL, pattern TEXT NOT NULL,
  reset TEXT NOT NULL DEFAULT 'month',   -- month | year | never
  start INTEGER NOT NULL DEFAULT 1, pos INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS order_templates (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, icon TEXT, items TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, pos INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS checklists (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, items TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, pos INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS order_checklists (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, checklist_id INTEGER, name TEXT,
  results TEXT NOT NULL DEFAULT '[]', staff TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS expense_categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS price_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, markup_pct REAL NOT NULL DEFAULT 0, pos INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}', state TEXT NOT NULL DEFAULT '{}', updated_at TEXT
);
`);
addColumn('service_catalog', 'source', 'TEXT');
addColumn('service_catalog', 'active', 'INTEGER NOT NULL DEFAULT 1');
addColumn('service_catalog', 'norm_hours', 'REAL');
addColumn('staff', 'permissions', 'TEXT');          // JSON: права как в Motowarsztat
addColumn('staff', 'stations', 'TEXT');             // JSON: посты, которые видит сотрудник
addColumn('staff', 'phone', 'TEXT');
addColumn('staff', 'email', 'TEXT');
addColumn('staff', 'last_login', 'TEXT');
addColumn('staff', 'ext_token', 'TEXT');          // sha256 ключа для расширения Chrome
addColumn('staff', 'parts_pct', 'REAL NOT NULL DEFAULT 0');   // % от маржи на запчастях к его работам
addColumn('staff', 'pay_mode', "TEXT NOT NULL DEFAULT 'pct'");   // pct | hourly | both
addColumn('staff', 'pay_base', "TEXT NOT NULL DEFAULT 'net'");   // % считается от нетто или брутто
addColumn('orders', 'external_no', 'TEXT');
addColumn('orders', 'faults', 'TEXT');              // wykryte usterki
addColumn('orders', 'after_notes', 'TEXT');         // uwagi po wykonaniu zlecenia
addColumn('orders', 'damages', 'TEXT');             // JSON: отметки повреждений на схеме {x,y,type,note}
addColumn('orders', 'damages_note', 'TEXT');        // Ogólny opis uszkodzeń pojazdu
addColumn('orders', 'contact_person', 'TEXT');      // Osoba kontaktowa
addColumn('orders', 'contact_phone', 'TEXT');
addColumn('orders', 'notes', 'TEXT');               // Uwagi (видит клиент, для выцен)
addColumn('order_items', 'task_id', 'INTEGER');     // запчасть к работе (Nazwa zadania в Motowarsztat)
// фото/видео «до и после» сделаны и загружены (отмечает механик)
addColumn('orders', 'media_done', 'INTEGER NOT NULL DEFAULT 0');
addColumn('orders', 'media_done_by', 'TEXT');
addColumn('orders', 'media_done_at', 'TEXT');
// выцены: обзвон — статус, причина отказа, когда связаться снова; комментарии — в order_comments
addColumn('orders', 'followup', 'TEXT');
addColumn('orders', 'followup_reason', 'TEXT');
addColumn('orders', 'followup_at', 'TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS order_comments (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now','localtime')), staff TEXT, text TEXT, followup TEXT, reason TEXT, followup_at TEXT)`);
// хранение: парковка авто (цена за сутки) и оплата хранения / парковки
addColumn('storage', 'paid', 'REAL NOT NULL DEFAULT 0');
// модели, сохранённые с кодом варианта из CEPiK («540i            MR`16 E») — убираем хвост
for (const k of all("SELECT id, model FROM cars WHERE model LIKE '%   %' OR model LIKE '% MR`%' OR model LIKE '% MR''%'")) {
  const m = String(k.model).trim().split(/\s{3,}|\t/)[0].replace(/\s+MR[`'´]?\d{2}.*$/i, '').replace(/\s+/g, ' ').trim();
  if (m && m !== k.model) run('UPDATE cars SET model = ? WHERE id = ?', m, k.id);
}
// ── Несколько касс (Kasy): наличные, терминал, счёт; перенос денег между ними ──
db.exec(`CREATE TABLE IF NOT EXISTS cash_registers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'cash', -- cash | card | bank
  opening REAL NOT NULL DEFAULT 0, is_default INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, pos INTEGER NOT NULL DEFAULT 0
)`);
addColumn('payments', 'register_id', 'INTEGER');
addColumn('payments', 'transfer_id', 'INTEGER');    // пара KW/KP при переносе между кассами (не выручка)
// чеки (paragony) с фискального кассового аппарата
db.exec(`CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL, number TEXT, nip TEXT,
  total REAL NOT NULL DEFAULT 0, payment_method TEXT, items TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending', -- pending | printed | error | manual
  printer TEXT, error TEXT, staff TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), printed_at TEXT
)`);
if (!one('SELECT 1 FROM cash_registers')) {
  run(`INSERT INTO cash_registers (name, kind, opening, is_default, pos) VALUES ('Kasa główna', 'cash', ?, 1, 1), ('Terminal płatniczy', 'card', 0, 1, 2), ('Rachunek bankowy', 'bank', 0, 1, 3)`,
    Number(one(`SELECT value FROM settings WHERE key = 'cash_opening'`)?.value || 0) || 0);
  run(`UPDATE payments SET register_id = (SELECT id FROM cash_registers WHERE kind = CASE payments.method WHEN 'cash' THEN 'cash' WHEN 'card' THEN 'card' WHEN 'transfer' THEN 'bank' END ORDER BY is_default DESC, pos LIMIT 1) WHERE register_id IS NULL`);
}
// BLIK проходит через платёжный терминал — попадает в кассу «карта»
db.exec(`DROP TRIGGER IF EXISTS payments_register; CREATE TRIGGER payments_register AFTER INSERT ON payments WHEN NEW.register_id IS NULL AND NEW.method <> 'points' BEGIN
  UPDATE payments SET register_id = (SELECT id FROM cash_registers WHERE active = 1 AND kind = CASE NEW.method WHEN 'cash' THEN 'cash' WHEN 'card' THEN 'card' WHEN 'blik' THEN 'card' WHEN 'transfer' THEN 'bank' END ORDER BY is_default DESC, pos LIMIT 1) WHERE id = NEW.id;
END`);
// ── Документы продажи, подписи клиента, файлы заказа ─────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS sales_docs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,                     -- vat | proforma | correction
  number TEXT NOT NULL,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  corrects_id INTEGER REFERENCES sales_docs(id),
  issue_date TEXT NOT NULL, sale_date TEXT, due_date TEXT, place TEXT,
  payment_method TEXT, paid REAL NOT NULL DEFAULT 0,
  buyer TEXT NOT NULL DEFAULT '{}', items TEXT NOT NULL DEFAULT '[]',
  total_net REAL NOT NULL DEFAULT 0, total_vat REAL NOT NULL DEFAULT 0, total_gross REAL NOT NULL DEFAULT 0,
  notes TEXT, reason TEXT, status TEXT NOT NULL DEFAULT 'issued',
  ext_id TEXT, ext_url TEXT, ksef INTEGER NOT NULL DEFAULT 0,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sales_docs_order ON sales_docs(order_id);
CREATE TABLE IF NOT EXISTS order_signatures (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  doc TEXT NOT NULL,                      -- intake | estimate | quote | release
  method TEXT NOT NULL,                   -- button | sms | drawn | paper
  signer_name TEXT, phone TEXT, image TEXT, ip TEXT, snapshot TEXT,
  signed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS order_signatures_order ON order_signatures(order_id);
CREATE TABLE IF NOT EXISTS order_files (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  name TEXT NOT NULL, path TEXT NOT NULL, mime TEXT, size INTEGER,
  client_visible INTEGER NOT NULL DEFAULT 1, staff TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
for (const [c, t] of [['ksef_status', 'TEXT'], ['ksef_number', 'TEXT'], ['ksef_ref', 'TEXT'], ['ksef_session', 'TEXT'], ['ksef_hash', 'TEXT'], ['ksef_xml', 'TEXT'], ['ksef_env', 'TEXT'], ['ksef_error', 'TEXT'], ['ksef_sent_at', 'TEXT']]) addColumn('sales_docs', c, t);
// фактура без заказа: данные автомобиля и раздел оплаты (нал / безнал / BLIK) — JSON
addColumn('sales_docs', 'car', 'TEXT');
addColumn('sales_docs', 'pay_split', 'TEXT');
addColumn('sales_docs', 'proforma_id', 'INTEGER');
addColumn('orders', 'merged_into', 'INTEGER'); // выцена, позиции которой добавлены в уже существующий заказ // фактура VAT, выставленная на основании Pro forma
// статус выцены «Создан заказ» (зелёный, финальный, только для выцен): ставится сам, когда по выцене создан / дополнен заказ
addColumn('order_statuses', 'scope', "TEXT NOT NULL DEFAULT 'all'"); // all | order | quote
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
addColumn('products', 'price_group_id', 'INTEGER');
addColumn('products', 'gtu', 'TEXT');
addColumn('stations', 'slot_min', 'INTEGER');
addColumn('stations', 'max_hours_day', 'REAL');

db.exec('CREATE INDEX IF NOT EXISTS products_sku ON products(supplier_sku)');
db.exec('CREATE INDEX IF NOT EXISTS products_ean ON products(ean)');

export function ilog(key, level, message) {
  run('INSERT INTO integration_log (key, level, message) VALUES (?, ?, ?)', key, level, String(message).slice(0, 1000));
  run(`DELETE FROM integration_log WHERE id < (SELECT MAX(id) - 500 FROM integration_log)`);
}

// ── Начальные данные (как настроено сейчас в мастерской) ───────────────────
function seed() {
  if (!one('SELECT 1 FROM order_statuses')) {
    const st = [
      ['Новый заказ', '#9A9CA3', 0, 0, 0, 'Przyjęte'],
      ['Согласование с клиентом', '#F5C451', 0, 0, 1, 'Czekamy na Twoją akceptację'],
      ['Готов к приёму', '#1BF372', 0, 0, 0, 'Czekamy na Ciebie'],
      ['В ремонте', '#FF9F43', 0, 0, 1, 'W naprawie'],
      ['Работы выполнены', '#7BD88F', 0, 0, 0, 'Prace wykonane'],
      ['Ожидает оценки', '#E8C547', 0, 0, 0, 'Przygotowujemy wycenę'],
      ['Готов к выдаче', '#5BA8FF', 0, 0, 1, 'Gotowe do odbioru'],
      ['Завершён', '#8A8D94', 1, 1, 0, 'Zakończone'],
      ['Клиент не приехал', '#FF5A5A', 1, 0, 0, 'Anulowane'],
    ];
    st.forEach(([name, color, fin, lock, notify, label], i) =>
      run('INSERT INTO order_statuses (name, color, pos, is_final, lock_edit, notify_client, client_label) VALUES (?, ?, ?, ?, ?, ?, ?)', name, color, i + 1, fin, lock, notify, label));
  }
  if (!one('SELECT 1 FROM order_types')) {
    ['Sarafanka', 'Facebook', 'Lid site', 'Telegram', 'Instagram', 'Stały', 'Lid', 'Приложение'].forEach((n, i) => run('INSERT INTO order_types (name, pos) VALUES (?, ?)', n, i + 1));
  }
  if (!one('SELECT 1 FROM staff WHERE is_mechanic = 1')) {
    // механики из Motowarsztat: ставка за н/ч и 40% от работ
    [['Dima Stagor', 250, 1], ['Aleksey Pril', 250, 1], ['Andrei Prikota', 200, 1], ['Владислав (ст. механик)', 250, 1], ['Виталик (стажёр)', 250, 0]]
      .forEach(([n, rate, act]) => run(`INSERT INTO staff (name, role, hourly_rate, commission_pct, is_mechanic, active) VALUES (?, 'mechanic', ?, 40, 1, ?)`, n, rate, act));
  }
  if (!one('SELECT 1 FROM stations')) {
    [['1 Подъёмник / развал', '#1BF372'], ['2 Подъёмник', '#5BA8FF'], ['3 Подъёмник', '#F5C451'], ['4 Подъёмник', '#FF9F43'], ['Кондиционер', '#B388FF']]
      .forEach(([n, c], i) => run('INSERT INTO stations (name, color, pos) VALUES (?, ?, ?)', n, c, i + 1));
  }
  if (!one('SELECT 1 FROM service_catalog')) {
    // прайс с pulsecar.pl (цены «от»)
    [
      ["Diagnostyka", "Diagnostyka komputerowa", 100],
      ["Diagnostyka", "Diagnostyka zawieszenia", 100],
      ["Diagnostyka", "Przegląd przed zakupem", 300],
      ["Diagnostyka", "Przegląd rozszerzony", 250],
      ["Geometria kół", "Ustawienie geometrii — 1 oś", 150],
      ["Geometria kół", "Ustawienie geometrii — 2 osie", 300],
      ["Wulkanizacja", "Wymiana opon R14", 180],
      ["Wulkanizacja", "Wymiana opon R15", 200],
      ["Wulkanizacja", "Wymiana opon R16", 220],
      ["Wulkanizacja", "Wymiana opon R17", 240],
      ["Wulkanizacja", "Wymiana opon R18", 260],
      ["Wulkanizacja", "Wymiana opon R19", 280],
      ["Wulkanizacja", "Wymiana opon R20", 300],
      ["Wulkanizacja", "Wymiana opon R21", 320],
      ["Wulkanizacja", "Przechowywanie opon — 1 sezon", 200],
      ["Klimatyzacja", "Napełnianie klimatyzacji i sprawdzanie próżni", 199],
      ["Klimatyzacja", "Freon 100 g — R134a", 40],
      ["Klimatyzacja", "Freon 100 g — R1234yf", 40],
      ["Serwis", "Wymiana oleju i filtra oleju", 120],
      ["Serwis", "Wymiana filtra powietrznego", 40],
      ["Serwis", "Wymiana filtra kabinowego", 40],
      ["Serwis", "Wymiana filtra paliwa", 40],
      ["Serwis", "Wymiana żarówki", 30],
      ["Hamulce", "Wymiana klocków hamulcowych (przód)", 200],
      ["Hamulce", "Wymiana klocków hamulcowych (tył)", 250],
      ["Hamulce", "Wymiana klocków i tarcz (przód)", 300],
      ["Hamulce", "Wymiana klocków i tarcz (tył)", 350],
      ["Hamulce", "Wymiana płynu hamulcowego", 200],
      ["Serwis", "Wymiana płynu chłodzącego", 200],
      ["Zawieszenie", "Wymiana łącznika stabilizatora", 100],
      ["Zawieszenie", "Wymiana amortyzatora (przód)", 200],
      ["Zawieszenie", "Wymiana wahacza", 200],
      ["Układ kierowniczy", "Wymiana końcówki drążka kierowniczego", 150],
      ["Silnik", "Wymiana poduszki silnika", 150],
      ["Napęd", "Wymiana półosi", 250],
      ["Skrzynia biegów", "Wymiana oleju w skrzyni automatycznej", 400],
      ["Skrzynia biegów", "Wymiana oleju w skrzyni manualnej", 200],
      ["Skrzynia biegów", "Wymiana sprzęgła", 600],
      ["Skrzynia biegów", "Wymiana skrzyni automatycznej", 800],
      ["Silnik", "Wymiana turbosprężarki", 600],
      ["Silnik", "Wymiana paska rozrządu", 600],
      ["Silnik", "Wymiana łańcucha rozrządu", 1000],
      ["Silnik", "Wymiana uszczelki głowicy", 1000],
      ["Silnik", "Wymiana silnika", 2000],
      ["Silnik", "Diagnostyka endoskopowa silnika", 300],
      ["Silnik", "Czyszczenie kanałów dolotowych (łupina orzecha)", 0],
    ].forEach(([c, n, p]) => run('INSERT INTO service_catalog (category, name, price) VALUES (?, ?, ?)', c, n, p));
  }
  if (!one('SELECT 1 FROM settings')) {
    const s = {
      company_name: 'AI CARS sp. z o.o.', company_brand: 'Pulsecar', company_address: 'ul. Arkuszowa 176, 01-935 Warszawa',
      company_phone: '+48 571 058 591', company_email: 'admin@pulsecar.pl', company_nip: '',
      hours_start: '09:00', hours_end: '18:00', slot_min: '30', default_vat: '23', labor_unit: 'oper',
    };
    for (const [k, v] of Object.entries(s)) setSetting(k, v);
  }
}
seed();
quoteConvertedStatus();
seedMessaging();
seedMotowarsztat();

// Нумерация, прайс работ, статьи расходов, шаблоны — как настроено в Motowarsztat
function seedMotowarsztat() {
  if (!one('SELECT 1 FROM doc_numbering')) {
    [['ZL', 'Заказ (zlecenie naprawy)', 'ZL [numer]/[miesiac]/[rok]', 'month'], ['WY', 'Выцена (wycena)', 'WYC [numer]/[miesiac]/[rok]', 'month'],
      ['PZ', 'Приход от поставщика (PZ)', 'PZ [numer]/[miesiac]/[rok]', 'month'], ['WZ', 'Выдача в заказ (WZ)', 'WZ [numer]/[miesiac]/[rok]', 'month'],
      ['RW', 'Списание (RW)', 'RW [numer]/[miesiac]/[rok]', 'month'], ['PW', 'Внутренний приход (PW)', 'PW [numer]/[miesiac]/[rok]', 'month'],
      ['KP', 'Касса: приход (KP)', 'KP [numer]/[miesiac]/[rok]', 'month'], ['KW', 'Касса: расход (KW)', 'KW [numer]/[miesiac]/[rok]', 'month'],
      ['PR', 'Хранение шин (przechowalnia)', 'P [numer]/[rok]', 'year']]
      .forEach(([k, l, p, r], i) => run('INSERT INTO doc_numbering (key, label, pattern, reset, pos) VALUES (?, ?, ?, ?, ?)', k, l, p, r, i));
  }
  run(`UPDATE doc_numbering SET label = 'Выцена (wycena)' WHERE key = 'WY' AND label LIKE 'Смета%'`);
  [['FV', 'Фактура VAT', 'FV [numer]/[miesiac]/[rok]', 'month', 20], ['PRO', 'Фактура Pro forma', 'PRO [numer]/[miesiac]/[rok]', 'month', 21], ['FK', 'Фактура корректирующая', 'FK [numer]/[miesiac]/[rok]', 'month', 22]]
    .forEach(([k, l, p, r, i]) => run('INSERT OR IGNORE INTO doc_numbering (key, label, pattern, reset, pos) VALUES (?, ?, ?, ?, ?)', k, l, p, r, i));
  if (!getSetting('mw_services_seeded')) {
    const site = new Set(all(`SELECT lower(name) n FROM service_catalog WHERE COALESCE(source, '') <> 'motowarsztat'`).map((r) => r.n));
    const have = new Set(all('SELECT lower(category) || \'|\' || lower(name) k FROM service_catalog').map((r) => r.k));
    for (const [cat, name, price] of MW_SERVICES) {
      const k = cat.toLowerCase() + '|' + name.toLowerCase();
      if (site.has(name.toLowerCase()) || have.has(k)) continue; // своя цена с сайта важнее
      have.add(k);
      run(`INSERT INTO service_catalog (category, name, price, unit, source) VALUES (?, ?, ?, 'oper', 'motowarsztat')`, cat, name, price);
    }
    setSetting('mw_services_seeded', '1');
  }
  if (!one('SELECT 1 FROM expense_categories')) {
    ['Energia elektryczna', 'Ogrzewanie', 'Czynsz', 'Paliwo', 'Materiały biurowe', 'Transport', 'Usługi', 'Inne', 'Części i materiały']
      .forEach((n, i) => run('INSERT INTO expense_categories (name, pos) VALUES (?, ?)', n, i));
  }
  if (!one('SELECT 1 FROM price_groups')) {
    [['Detal', 40], ['Stały klient', 30], ['Firmy / flota', 20]].forEach(([n, m], i) => run('INSERT INTO price_groups (name, markup_pct, pos) VALUES (?, ?, ?)', n, m, i));
  }
  if (!one('SELECT 1 FROM checklists')) {
    run('INSERT INTO checklists (name, items) VALUES (?, ?)', 'Przyjęcie pojazdu', JSON.stringify(['Stan paliwa', 'Uszkodzenia nadwozia', 'Stan opon', 'Kontrolki na desce', 'Rzeczy wartościowe w aucie', 'Dowód rejestracyjny', 'Kluczyki / karta']));
    run('INSERT INTO checklists (name, items) VALUES (?, ?)', 'Przegląd okresowy', JSON.stringify(['Poziom oleju', 'Płyn hamulcowy', 'Płyn chłodniczy', 'Klocki i tarcze', 'Zawieszenie i luzy', 'Oświetlenie', 'Wycieraczki i spryskiwacze', 'Akumulator', 'Opony i ciśnienie', 'Błędy w sterownikach']));
  }
  if (!one('SELECT 1 FROM order_templates')) {
    const pick = (names) => names.map((n) => one('SELECT id, name, price, unit, vat FROM service_catalog WHERE name = ?', n)).filter(Boolean)
      .map((c) => ({ kind: 'labor', catalog_id: c.id, name: c.name, qty: 1, price: c.price, unit: c.unit, vat: c.vat }));
    run('INSERT INTO order_templates (name, icon, items, pos) VALUES (?, ?, ?, ?)', 'Wulkanizacja', 'tire', JSON.stringify(pick(['Wymiana opon R16', 'Felga z czujnikiem'])), 1);
    run('INSERT INTO order_templates (name, icon, items, pos) VALUES (?, ?, ?, ?)', 'Wymiana oleju', 'wrench', JSON.stringify(pick(['Wymiana oleju i filtra oleju', 'Wymiana filtra powietrznego', 'Wymiana filtra kabinowego'])), 2);
    run('INSERT INTO order_templates (name, icon, items, pos) VALUES (?, ?, ?, ?)', 'Klimatyzacja', 'wrench', JSON.stringify(pick(['Napełnianie klimatyzacji i sprawdzanie próżni', 'Odgrzybianie klimatyzacji ozonem'])), 3);
  }
  const W = {
    show_amounts: 'gross', vat_rates: '23,8,5,0', payment_term_days: '0', payment_method_default: 'cash', discounts_on: '1', proforma_on: '1',
    rbh_rate: '250', rbh_cost: '0', max_job_hours: '0', mileage_unit: 'km', power_unit: 'kW', labor_units: 'oper,rbh', labor_unit_default: 'oper',
    only_assigned_finish: '0', require_time_before_finish: '0', require_mechanic_all: '0', require_mechanic_job: '0', block_finish_open_jobs: '0',
    save_owner_from_aztec: '1', order_type_on: '1', field_internal: '1', field_mechanic: '1', field_faults: '1', field_after: '1', field_external_no: '0',
    parts_to_jobs: '0', show_cost_column: '1', free_code: '1', pickup_format: 'datetime', pickup_warn_orange: '2', pickup_warn_red: '0',
    status_on_first_job: '', status_on_all_jobs: '', status_on_sale_doc: '', vehicle_types: 'Samochód osobowy,Bus,Motocykl',
    car_field_inspection: '1', car_field_insurance: '1', car_field_tacho: '0', car_field_key: '1', car_field_axle: '0', car_field_hsn: '0', car_field_paint: '1',
    client_require_phone: '0', client_marketing_default: '1', calendar_scale_day: '15', calendar_scale_week: '15', calendar_auto_jobs: '1',
    work_hours: JSON.stringify({ 1: ['09:00', '18:00'], 2: ['09:00', '18:00'], 3: ['09:00', '18:00'], 4: ['09:00', '18:00'], 5: ['09:00', '18:00'], 6: ['10:00', '14:00'], 0: null }),
    stock_negative: '1', stock_reserve_on_order: '1', default_markup: '40', storage_months: '6', storage_price: '200', doc_show_logo: '1', doc_show_signatures: '1', doc_footer: '',
    // Wygląd dokumentów — как в Motowarsztat
    company_legal_name: 'AI CARS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', company_street: 'ul. Rodziny Hiszpańskich 8', company_postcode: '02-685', company_city: 'Warszawa',
    doc_code_in_name: '0', doc_place: 'Warszawa', company_legal_address: 'ul. Rodziny Hiszpańskich 8, 02-685 Warszawa', quote_valid_days: '14',
    est_net: '0', est_gross: '1', est_labor_net: '0', est_labor_gross: '1', est_parts_code: '0', est_parts_brand: '1', est_parts_net: '0', est_parts_gross: '1', est_extra: '',
    spec_qty: '1', spec_parts_code: '0', spec_after_notes: '1', spec_labor_gross: '1', spec_parts_gross: '1', spec_parts_brand: '1',
    mech_contact: '1', mech_basic: '1', mech_station: '1', mech_code: '1', mech_vehicle_end: '1', mech_extra_labor: '3', mech_extra_parts: '3',
    sale_code: '0', sale_gtu: '0', sale_discount: '1', sale_order_line: '1', sale_mpp: '1', sale_footer: '', sale_person: '', invoice_mode: 'auto',
    stock_code: '1', stock_location: '0', wz_cost_col: '0', release_terms: '', intake_terms: '',
    storage_terms: 'Firma [[firma]] przechowuje koła / opony letnie w okresie zimowym, koła / opony zimowe w okresie letnim. Koła / opony przechowywane są zgodnie z wymaganiami Polskiej Normy PN-C-94300-7. Firma [[firma]] gwarantuje zabezpieczenie przed kradzieżą oraz wykona bezpłatny przegląd opon i kontrolę ciśnienia w kołach. Odbiór kół / opon jest możliwy w każdy dzień roboczy, jednak nie później niż:\n– koła / opony letnie: do dnia 01 czerwca\n– koła / opony zimowe: do dnia 01 grudnia\nKoła / opony przechowywane po ww. datach podlegają opłaceniu kolejnego depozytu wg aktualnego cennika, lecz nie dłużej niż 100 dni od niezapłacenia depozytu. Koła / opony nieodebrane i niezapłacone w terminie 100 dni od wyznaczonych dat zostaną zagospodarowane jako odpad. Zapoznałem się z warunkami przechowalni kół / opon i wyrażam zgodę na ich stosowanie.',
    // Elektroniczna karta zlecenia
    card_files: '1', card_intake_on: '1', card_intake_accept: 'button,sms', card_intake_desc: '1', card_intake_tasks: '1', card_intake_damage: '1',
    card_estimate_on: '1', card_estimate_accept: 'button,sms', card_labor_net: '0', card_labor_gross: '1', card_parts_code: '0', card_parts_brand: '1', card_parts_net: '0', card_parts_gross: '1',
    card_pay_online: '1', card_release_on: '0', card_release_accept: 'button', card_drawn_signature: '1',
  };
  for (const [k, v] of Object.entries(W)) if (getSetting(k) === null) setSetting(k, v);
  if (!getSetting('company_nip')) setSetting('company_nip', '5214141930'); // NIP AI CARS sp. z o.o. (как в Motowarsztat)
}

// Шаблоны SMS и e-mail — перенесены из Motowarsztat (Ustawienia → Zlecenia, Wyceny, Statusy zleceń, Szablony e-mail)
function seedMessaging() {
  if (getSetting('messaging_seeded')) return;
  const byPos = {
    2: 'Witaj,\n\nZarezerwowalismy termin wizyty na [[zlecenie.dataPrzyjecia]] o [[zlecenie.godzinaPrzyjecia]] Arkuszowa 176\n\nPozdrawiam PulseCar Service.',
    4: 'Ponizej karta zlecenia dla [[pojazd.marka]] [[pojazd.nrRejestracyjny]]\n\n[[zlecenie.kartaZlecenia]]\n\nCzekamy na potwierdzenie',
    7: 'Witaj,\n\nPojazd [[pojazd.marka]] [[pojazd.model]] jest gotowy do odbioru. Kosztorys - [[zlecenie.kartaZlecenia]]\n\nPozdrawiamy,\nPulseCar Service.',
    8: 'Dziekujemy za wizyte!\nJesli sa Panstwo zadowoleni z uslugi, prosimy o opinie: https://g.page/r/CdP6wLn_Tf1mEBM/review\nDziekujemy! PulseCar',
    9: 'Dzien dobry!\nMiales dzis wizyte.\nProsze o kontakt: +48571058591, aby ustalic nowy termin.',
  };
  for (const [pos, t] of Object.entries(byPos)) {
    run(`UPDATE order_statuses SET sms_template = ?, sms_mode = 'ask' WHERE pos = ? AND (sms_template IS NULL OR sms_template = '')`, t, Number(pos));
  }
  const S = {
    sms_tpl_reminder: 'Przypominamy o wizycie dnia [[zlecenie.dataPrzyjecia]] o [[zlecenie.godzinaPrzyjecia]] Arkuszowa 176\n\nPozdrawiam PulseCar Service.',
    sms_tpl_card: 'Witaj,\n\nKarta zlecenia dla [[pojazd.marka]] [[pojazd.nrRejestracyjny]]\n\n[[zlecenie.kartaZlecenia]]\n\nPozdrawiam PulseCar Service',
    sms_tpl_quote: 'Witaj,\n\nPonizej wycena dla [[pojazd.marka]] [[pojazd.nrRejestracyjny]]\n\n[[wycena.link]]\n\nCzekamy na potwierdzenie\n\nPozdrawiam PulseCar Service.',
    sms_tpl_paylink: 'Link do platnosci za zlecenie [[zlecenie.numer]] ([[zlecenie.doZaplaty]] zl): [[link.platnosc]]\nPulseCar Service',
    sms_tpl_code: 'Kod potwierdzenia: [[kod]]. PulseCar Service',
    sms_tpl_booking: '',
    sms_tpl_review: 'Dziekujemy za wizyte! Jesli sa Panstwo zadowoleni z uslugi, prosimy o opinie: [[link.opinia]] Dziekujemy! PulseCar',
    sms_remind_on: '1', sms_remind_hours: '24', sms_translit: '1', sms_review_delayed: '0',
    review_url: 'https://g.page/r/CdP6wLn_Tf1mEBM/review',
    doc_description_tpl: 'Marka: [[pojazd.marka]], Model: [[pojazd.model]], Numer rejestracyjny: [[pojazd.rejestracja]], VIN: [[pojazd.vin]], przebieg: [[zlecenie.przebieg]]',
    mail_invoice_subject: 'Faktura [[dokument.numer]] — PulseCar Service', mail_invoice_body: 'Dzień dobry,\n\nW załączniku przesyłam fakturę za wykonaną usługę.\n\nPozdrawiam',
    mail_receipt_subject: 'Paragon — PulseCar Service', mail_receipt_body: 'Dzień dobry,\n\nW załączniku przesyłam paragon za wykonaną usługę.\n\nPozdrawiam',
    mail_storage_subject: 'Dokument przechowania — PulseCar Service', mail_storage_body: 'Dzień dobry,\n\nW załączniku przesyłam dokument przechowania.\n\nPozdrawiam',
    mail_quote_subject: 'Wycena [[zlecenie.numer]] — PulseCar Service', mail_quote_body: 'Dzień dobry,\n\nW załączniku przesyłam wycenę.\n\n[[wycena.link]]\n\nPozdrawiam',
    mail_order_subject: 'Zlecenie [[zlecenie.numer]] — PulseCar Service', mail_order_body: 'Dzień dobry,\n\nPoniżej karta zlecenia dla [[pojazd.marka]] [[pojazd.nrRejestracyjny]]:\n[[zlecenie.kartaZlecenia]]\n\nPozdrawiam',
    card_accept: 'button', card_show_status: '1', card_show_net: '1', card_show_company: '1', card_show_bank: '0', card_show_invoice: '1',
    card_quote_after_protocol: '0', card_accept_status_id: '', card_rodo: '', card_extra: '',
    booking_widget: '1', booking_color: '#1BF372',
  };
  for (const [k, v] of Object.entries(S)) if (getSetting(k) === null) setSetting(k, v);
  setSetting('messaging_seeded', '1');
}
