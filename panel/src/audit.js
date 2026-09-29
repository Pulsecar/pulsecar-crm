// Журнал изменений: кто, когда и что создал / изменил / удалил, с «было → стало».
// Пишут триггеры SQLite на каждой рабочей таблице — поэтому в журнал попадает любое изменение,
// каким бы путём оно ни прошло (форма, импорт, расширение, электронная карта, фоновые задачи).
// Кто действует — хранится для каждого запроса в AsyncLocalStorage и отдаётся SQL-функции audit_actor().
import { db, all, one } from './db.js';
import { actorStore as als } from './actor.js';

/** Middleware: у каждого запроса свой «автор изменений» */
export function auditContext(req, _res, next) {
  const p = req.path || '';
  const store = { name: null, id: null, source: p.startsWith('/api') ? 'app' : p.startsWith('/k/') ? 'card' : p.startsWith('/crm-api') ? 'crm' : 'web' };
  if (store.source === 'app') store.name = 'Клиент (приложение)';
  if (store.source === 'card') store.name = 'Клиент (карта заказа)';
  als.run(store, next);
}
/** Вызывается при входе сотрудника в запрос (who) */
export function setActor(staff, source) {
  const st = als.getStore();
  if (st && staff) { st.name = staff.name; st.id = staff.id; if (source) st.source = source; }
}
/** Для фоновых задач: выполнить fn от имени системы / сотрудника */
export const asActor = (name, fn) => als.run({ name, id: null, source: 'system' }, fn);

// Какие таблицы пишем. ignore — поля-«шум» (пересчёт сумм, служебные): не создают запись и не показываются;
// exclude — не храним совсем (большие или секретные); parent — к чему относится (для истории заказа).
export const TABLES = {
  customers: { label: 'Клиент', ignore: ['welcome_given', 'registered_at'] },
  cars: { label: 'Автомобиль' },
  orders: { label: 'Заказ', ignore: ['total', 'total_net', 'cost', 'paid', 'review_sent', 'card_token', 'accept_code', 'accept_code_exp', 'pay_link', 'pay_ext_id'] },
  order_items: { label: 'Позиция заказа', parent: "'orders:' || X.order_id" },
  payments: { label: 'Оплата / касса', parent: "CASE WHEN X.order_id IS NOT NULL THEN 'orders:' || X.order_id END" },
  appointments: { label: 'Визит (терминарз)', ignore: ['reminded'], parent: "CASE WHEN X.order_id IS NOT NULL THEN 'orders:' || X.order_id END" },
  sales_docs: { label: 'Документ продажи', exclude: ['ksef_xml', 'ksef_session', 'ksef_hash', 'ksef_ref', 'items'], parent: "CASE WHEN X.order_id IS NOT NULL THEN 'orders:' || X.order_id END" },
  receipts: { label: 'Чек (paragon)', exclude: ['items'], parent: "CASE WHEN X.order_id IS NOT NULL THEN 'orders:' || X.order_id END" },
  order_files: { label: 'Файл заказа', exclude: ['path'], parent: "'orders:' || X.order_id" },
  order_signatures: { label: 'Подпись клиента', exclude: ['image', 'snapshot'], parent: "'orders:' || X.order_id" },
  order_checklists: { label: 'Чек-лист заказа', exclude: ['results'], ignore: ['updated_at'], parent: "'orders:' || X.order_id" },
  products: { label: 'Товар', ignore: ['stock'] },
  stock_docs: { label: 'Складской документ', parent: "CASE WHEN X.order_id IS NOT NULL THEN 'orders:' || X.order_id END" },
  stock_doc_items: { label: 'Позиция склад. документа', parent: "'stock_docs:' || X.doc_id" },
  storage: { label: 'Хранение шин / парковка' },
  order_comments: { label: 'Комментарий', parent: "'orders:' || X.order_id" },
  purchases: { label: 'Закупка / расход' },
  transactions: { label: 'Pulse Points', parent: "'customers:' || X.customer_id" },
  staff: { label: 'Сотрудник', exclude: ['pass_hash', 'ext_token'], ignore: ['last_login'] },
  stations: { label: 'Пост' },
  order_statuses: { label: 'Статус заказа' },
  order_types: { label: 'Источник заказа' },
  cash_registers: { label: 'Касса' },
  service_catalog: { label: 'Прайс работ' },
  checklists: { label: 'Чек-лист' },
  order_templates: { label: 'Шаблон заказа' },
  expense_categories: { label: 'Статья расходов' },
  price_groups: { label: 'Ценовая группа' },
  doc_numbering: { label: 'Нумерация', key: 'key' },
  settings: { label: 'Настройка', key: 'key', skipSystem: true },
  integrations: { label: 'Интеграция', key: 'key', ignore: ['state', 'updated_at'], secret: ['config'], skipSystem: true },
  suppliers: { label: 'Поставщик', ignore: ['state', 'updated_at'], secret: ['config'] },
};

const cols = (t) => all(`PRAGMA table_info(${t})`).map((c) => c.name);
const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
/** json_array(json_object(...50 полей), json_object(...)) — у SQLite ограничение на число аргументов функции */
const jsonOf = (alias, list) => `json_array(${chunk(list, 50).map((c) => `json_object(${c.map((k) => `'${k}', ${alias}.${k}`).join(', ')})`).join(', ')})`;

export function initAudit() {
  db.exec(`CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    staff TEXT, staff_id INTEGER, source TEXT, entity TEXT NOT NULL, entity_id TEXT, action TEXT NOT NULL, parent TEXT, old TEXT, new TEXT
  );
  CREATE INDEX IF NOT EXISTS audit_at ON audit(at);
  CREATE INDEX IF NOT EXISTS audit_entity ON audit(entity, entity_id);
  CREATE INDEX IF NOT EXISTS audit_parent ON audit(parent);
  CREATE INDEX IF NOT EXISTS audit_staff ON audit(staff_id, at);`);
  for (const [t, c] of Object.entries(TABLES)) {
    const all_ = cols(t);
    if (!all_.length) continue;
    const key = c.key || 'id';
    const keep = all_.filter((k) => !(c.exclude || []).includes(k));
    const watch = keep.filter((k) => !(c.ignore || []).includes(k));
    const parent = (alias) => (c.parent ? c.parent.replace(/X\./g, alias + '.') : 'NULL');
    const sys = c.skipSystem ? ' WHEN audit_actor() IS NOT NULL' : '';
    const head = `INSERT INTO audit (staff, staff_id, source, entity, entity_id, action, parent, old, new) VALUES (audit_actor(), audit_actor_id(), audit_source(), '${t}'`;
    db.exec(`DROP TRIGGER IF EXISTS audit_${t}_i; DROP TRIGGER IF EXISTS audit_${t}_u; DROP TRIGGER IF EXISTS audit_${t}_d;
      CREATE TRIGGER audit_${t}_i AFTER INSERT ON ${t}${sys} BEGIN ${head}, NEW.${key}, 'create', ${parent('NEW')}, NULL, ${jsonOf('NEW', keep)}); END;
      CREATE TRIGGER audit_${t}_u AFTER UPDATE ON ${t} WHEN ${c.skipSystem ? 'audit_actor() IS NOT NULL AND ' : ''}${jsonOf('OLD', watch)} IS NOT ${jsonOf('NEW', watch)}
        BEGIN ${head}, NEW.${key}, 'update', ${parent('NEW')}, ${jsonOf('OLD', keep)}, ${jsonOf('NEW', keep)}); END;
      CREATE TRIGGER audit_${t}_d AFTER DELETE ON ${t}${sys} BEGIN ${head}, OLD.${key}, 'delete', ${parent('OLD')}, ${jsonOf('OLD', keep)}, NULL); END;`);
  }
}

// ── Чтение: понятные названия полей и значений ──────────────────────────────
const F = {
  name: 'Название / имя', first_name: 'Имя', last_name: 'Фамилия', company: 'Фирма', nip: 'NIP', phone: 'Телефон', email: 'E-mail', street: 'Улица', postcode: 'Индекс', city: 'Город',
  country: 'Страна', notes: 'Описание', note: 'Заметка', kind: 'Тип', discount_labor: 'Скидка на работы %', discount_parts: 'Скидка на товары %', marketing_consent: 'Согласие на маркетинг',
  default_car_id: 'Авто по умолчанию', payment_method: 'Способ оплаты', payment_term_days: 'Срок оплаты, дней', card_no: 'Карта Pulse Points',
  customer_id: 'Клиент', car_id: 'Автомобиль', plate: 'Номер', vin: 'VIN', make: 'Марка', model: 'Модель', year: 'Год', engine: 'Двигатель', capacity: 'Объём', power_kw: 'Мощность, kW',
  fuel: 'Топливо', color: 'Цвет', last_mileage: 'Пробег', mileage_unit: 'Ед. пробега', first_reg: 'Первая регистрация', engine_no: 'Номер двигателя', inspection_until: 'Техосмотр до',
  insurance_until: 'Страховка до', key_no: 'Номер ключа', paint_code: 'Код краски', vehicle_type: 'Тип авто', reg_doc: 'Техпаспорт',
  number: 'Номер', status_id: 'Статус', type_id: 'Источник', mechanic_id: 'Механик', mileage: 'Пробег', fuel_level: 'Топливо', complaint: 'Описание (видит клиент)',
  internal_note: 'Внутреннее описание', mechanic_note: 'Для механика', flags: 'Отметки', pickup_at: 'Выдача', receipt_no: 'Номер чека', external_no: 'Внешний номер', faults: 'Неисправности',
  after_notes: 'После ремонта', damages: 'Повреждения', damages_note: 'Повреждения — описание', contact_person: 'Контактное лицо', contact_phone: 'Телефон контакта', closed_at: 'Завершён',
  accepted_at: 'Принят клиентом', accepted_via: 'Как принят', invoice_no: 'Фактура',
  media_done: 'Фото/видео до/после загружены', media_done_by: 'Фото/видео отметил', followup: 'Обзвон (выцена)', followup_reason: 'Причина', followup_at: 'Связаться',
  qty: 'Кол-во', unit: 'Ед.', price: 'Цена', cost: 'Себестоимость', discount: 'Скидка %', vat: 'VAT %', done: 'Выполнено', code: 'Код', product_id: 'Товар', task_id: 'К работе',
  amount: 'Сумма', method: 'Способ', direction: 'Направление', register_id: 'Касса',
  station_id: 'Пост', start_at: 'Начало', duration_min: 'Длительность, мин', title: 'Название', status: 'Статус', contact_name: 'Имя (заявка)',
  total_gross: 'Сумма брутто', total_net: 'Сумма нетто', paid: 'Оплачено', issue_date: 'Дата', buyer: 'Покупатель', ksef_status: 'Статус KSeF', ksef_number: 'Номер KSeF',
  stock: 'Остаток', purchase_price: 'Цена закупки', sell_price: 'Цена продажи', location: 'Место', active: 'Активен', role: 'Роль', permissions: 'Права', login: 'Логин',
  hourly_rate: 'Ставка за н/ч', commission_pct: '% от работ', value: 'Значение', enabled: 'Включена', config: 'Настройки', points: 'Баллы', description: 'Описание', date_in: 'Принято', date_out: 'Выдано', type: 'Тип', amount_pln: 'Сумма, zł', order_no: 'Заказ', staff: 'Сотрудник', order_id: 'Заказ',
  doc: 'Документ', signer_name: 'Подписал', signed_at: 'Подписано', printer: 'Касса', error: 'Ошибка', printed_at: 'Напечатан', total: 'Сумма', sale_date: 'Дата продажи', due_date: 'Срок оплаты',
  counterparty: 'Контрагент', doc_date: 'Дата документа', supplier: 'Поставщик', category: 'Категория', net: 'Нетто', gross: 'Брутто', date_until: 'Хранить до', ksef_error: 'Ошибка KSeF', reason: 'Причина', corrects_id: 'Корректирует', place: 'Место выставления', total_vat: 'VAT', paid_at: 'Оплачено',
};
const HIDE = new Set(['id', 'created_at', 'car_key', 'pos', 'crm_id', 'created_by', 'source', 'key']);
const lookups = () => {
  const m = (sql) => Object.fromEntries(all(sql).map((r) => [String(r.id), r.n]));
  return {
    customer_id: m("SELECT id, COALESCE(CASE WHEN kind = 'company' THEN company END, name, phone) n FROM customers"), car_id: m("SELECT id, TRIM(COALESCE(plate,'') || ' ' || COALESCE(make,'') || ' ' || COALESCE(model,'')) n FROM cars"),
    order_id: m('SELECT id, number n FROM orders'), default_car_id: null, status_id: m('SELECT id, name n FROM order_statuses'), type_id: m('SELECT id, name n FROM order_types'), mechanic_id: m('SELECT id, name n FROM staff'),
    station_id: m('SELECT id, name n FROM stations'), register_id: m('SELECT id, name n FROM cash_registers'), product_id: m('SELECT id, name n FROM products'),
  };
};
const DOCK = { vat: 'фактура VAT', proforma: 'Pro forma', correction: 'корректа', order: 'заказ', quote: 'выцена', labor: 'работа', part: 'товар' };
const STAT = { issued: 'выставлен', planned: 'запланирован', request: 'заявка', arrived: 'приехал', no_show: 'не приехал', cancelled: 'отменён', printed: 'напечатан', pending: 'в очереди', error: 'ошибка', manual: 'вручную' };
const METHOD = { cash: 'наличные', card: 'карта', blik: 'BLIK', transfer: 'перевод', mixed: 'смешанная', points: 'баллы' };
function fmt(k, v, L, secret) {
  if (secret) return v == null ? '—' : '••• (скрыто)';
  if (v === null || v === undefined || v === '') return '—';
  const map = L[k] || (k === 'default_car_id' ? L.car_id : null);
  if (map) return map[String(v)] || '#' + v;
  if (k === 'method' || k === 'payment_method') return METHOD[v] || v;
  if (k === 'direction') return v === 'in' ? 'приход' : 'расход';
  if (k === 'kind' && (v === 'company' || v === 'person')) return v === 'company' ? 'фирма' : 'частное лицо';
  if (['marketing_consent', 'done', 'active', 'enabled', 'is_mechanic'].includes(k)) return v ? 'да' : 'нет';
  if (k === 'buyer') { try { const b = JSON.parse(v); return [b.name, b.nip && 'NIP ' + b.nip].filter(Boolean).join(', ') || '—'; } catch { return v; } }
  if (k === 'kind' && DOCK[v]) return DOCK[v];
  if (k === 'status' && STAT[v]) return STAT[v];
  if (k === 'damages') { try { return `${JSON.parse(v).length} отметок`; } catch { return v; } }
  if (k === 'flags' || k === 'permissions') { try { const o = JSON.parse(v); return Object.entries(o).filter(([, x]) => x).map(([x]) => x).join(', ') || '—'; } catch { return v; } }
  const s = String(v);
  return s.length > 160 ? s.slice(0, 160) + '…' : s;
}
const merge = (j) => { try { return Object.assign({}, ...JSON.parse(j || '[]')); } catch { return {}; } };
function titleOf(t, r) {
  if (!r) return '';
  if (t === 'orders' || t === 'sales_docs' || t === 'stock_docs' || t === 'storage' || t === 'payments') return r.number || '';
  if (t === 'customers') return (r.kind === 'company' && r.company) || r.name || r.phone || '';
  if (t === 'cars') return [r.plate, r.make, r.model].filter(Boolean).join(' ');
  if (t === 'settings' || t === 'integrations' || t === 'doc_numbering') return r.key || '';
  return r.name || r.title || r.number || r.description || '';
}

export function describe(rows) {
  const L = lookups();
  return rows.map((a) => {
    const c = TABLES[a.entity] || {};
    const o = merge(a.old), n = merge(a.new);
    const ignore = new Set([...(c.ignore || []), ...HIDE]);
    const secret = new Set(c.secret || []);
    let changes = [];
    if (a.action === 'update') {
      changes = Object.keys(n).filter((k) => !ignore.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
        .map((k) => ({ field: F[k] || k, from: fmt(k, o[k], L, secret.has(k)), to: fmt(k, n[k], L, secret.has(k)) }));
    } else {
      const r = a.action === 'create' ? n : o;
      changes = Object.keys(r).filter((k) => !ignore.has(k) && r[k] !== null && r[k] !== '' && r[k] !== 0)
        .map((k) => ({ field: F[k] || k, [a.action === 'create' ? 'to' : 'from']: fmt(k, r[k], L, secret.has(k)) }));
    }
    const row = a.action === 'delete' ? o : n;
    let [pt, pid] = (a.parent || '').split(':');
    return {
      id: a.id, at: a.at, staff: a.staff || (a.source === 'system' ? 'Система' : '—'), source: a.source, action: a.action,
      entity: a.entity, entity_label: c.label || a.entity, entity_id: a.entity_id, title: titleOf(a.entity, row) || (a.entity === 'settings' ? a.entity_id : ''),
      parent: pt ? { type: pt, id: pid, title: pt === 'orders' ? one('SELECT number FROM orders WHERE id = ?', Number(pid))?.number || '#' + pid
        : pt === 'customers' ? L.customer_id[pid] || '#' + pid : pt === 'stock_docs' ? one('SELECT number FROM stock_docs WHERE id = ?', Number(pid))?.number || '#' + pid : '#' + pid } : null,
      changes,
    };
  });
}

/** Список для журнала: фильтры по периоду, сотруднику, объекту, действию и тексту */
export function listAudit(q = {}) {
  const w = ['1=1'], p = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { w.push('at >= ?'); p.push(q.from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { w.push('at < date(?, \'+1 day\')'); p.push(q.to); }
  if (q.staff === 'system') w.push('staff IS NULL');
  else if (q.staff === 'client') w.push("source IN ('app','card')");
  else if (q.staff) { w.push('staff_id = ?'); p.push(Number(q.staff)); }
  if (q.entity && TABLES[q.entity]) {
    if (q.id) { w.push('((entity = ? AND entity_id = ?) OR parent = ?)'); p.push(q.entity, String(q.id), `${q.entity}:${q.id}`); }
    else { w.push('entity = ?'); p.push(q.entity); }
  }
  if (['create', 'update', 'delete'].includes(q.action)) { w.push('action = ?'); p.push(q.action); }
  if (q.q) { w.push('(COALESCE(new,\'\') LIKE ? OR COALESCE(old,\'\') LIKE ? OR COALESCE(staff,\'\') LIKE ?)'); const s = `%${String(q.q).slice(0, 60)}%`; p.push(s, s, s); }
  const size = 100, page = Math.max(0, Number(q.page) || 0);
  const total = one(`SELECT COUNT(*) n FROM audit WHERE ${w.join(' AND ')}`, ...p).n;
  const rows = all(`SELECT * FROM audit WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT ${size} OFFSET ${page * size}`, ...p);
  return { total, pageSize: size, rows: describe(rows) };
}
export const entityList = () => Object.entries(TABLES).map(([k, v]) => ({ key: k, label: v.label }));
