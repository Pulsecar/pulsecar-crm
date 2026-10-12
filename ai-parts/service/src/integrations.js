// Раздел «Интеграции»: описание сервисов, хранение ключей (зашифрованно), статусы.
import { getDb } from './db.js';
import { encryptSecret, decryptSecret, mask } from './crypto.js';
import { config } from './config.js';

// type: 'text' — показывается как есть; 'secret' — шифруется и показывается маской.
export const SERVICES = {
  anthropic: {
    title: 'Anthropic (Claude)',
    purpose: 'Мозг ассистента: разбор запроса, исследование номеров, проверка, решения',
    required: true,
    fields: [
      { key: 'api_key', label: 'API key', type: 'secret' },
      { key: 'model', label: 'Модель', type: 'text', default: 'claude-sonnet-5-5' },
    ],
  },
  intercars: {
    title: 'Inter Cars WebAPI',
    purpose: 'Аналоги по номерам, цены, наличие, заказ',
    required: true,
    fields: [
      { key: 'api_base', label: 'API base URL', type: 'text', default: 'https://api.webapi.intercars.eu' },
      { key: 'token_url', label: 'OAuth2 token URL', type: 'text', default: 'https://is.webapi.intercars.eu/oauth2/token' },
      { key: 'client_id', label: 'Client ID', type: 'secret' },
      { key: 'client_secret', label: 'Client Secret', type: 'secret' },
      { key: 'scope', label: 'OAuth2 scope (у Inter Cars — allinone; «-» — без scope)', type: 'text', default: 'allinone' },
      { key: 'static_token', label: 'Готовый Bearer-токен (если CRM уже умеет его получать — необязательно)', type: 'secret' },
      { key: 'ship_to', label: 'shipTo (номер получателя, необязательно)', type: 'text' },
      { key: 'locations', label: 'Склады через запятую (необязательно)', type: 'text' },
      { key: 'csv_url', label: 'URL файлов CSV', type: 'text', default: 'https://data.webapi.intercars.eu/customer' },
      { key: 'csv_login', label: 'Логин CSV (BasicAuth)', type: 'secret' },
      { key: 'csv_password', label: 'Пароль CSV (BasicAuth)', type: 'secret' },
    ],
  },
  partslink24: {
    title: 'partslink24 (через расширение Chrome)',
    purpose: 'Оригинальные номера по VIN с учётом заводских опций. Работает в аккаунте менеджера, пароли не хранятся',
    required: false,
    fields: [],
  },
  nhtsa: {
    title: 'NHTSA vPIC',
    purpose: 'Бесплатная расшифровка VIN (особенно авто из США/Канады)',
    required: false,
    defaultEnabled: true,
    fields: [],
  },
  web_research: {
    title: 'Поиск в интернете (форумы, каталоги)',
    purpose: 'Агент ищет номера на форумах и сайтах производителей, перепроверяет их',
    required: false,
    defaultEnabled: true,
    fields: [
      { key: 'blocked_domains', label: 'Запрещённые сайты через запятую (необязательно)', type: 'text' },
    ],
  },
  dat: {
    title: 'DAT (VIN-запрос комплектации)',
    purpose: 'Точная заводская комплектация по VIN. Подключается после договора с DAT',
    required: false,
    fields: [
      { key: 'endpoint', label: 'Endpoint', type: 'text' },
      { key: 'customer_number', label: 'Номер клиента', type: 'text' },
      { key: 'login', label: 'Логин', type: 'secret' },
      { key: 'password', label: 'Пароль', type: 'secret' },
    ],
    stub: true,
  },
  tecdoc: {
    title: 'TecDoc Web Service (TecAlliance)',
    purpose: 'Кроссы OE → аналоги. Подключается после договора с TecAlliance',
    required: false,
    fields: [
      { key: 'provider_id', label: 'Provider ID', type: 'text' },
      { key: 'api_key', label: 'API key', type: 'secret' },
    ],
    stub: true,
  },
  tecrmi: {
    title: 'TecRMI (нормочасы, ТО)',
    purpose: 'Нормочасы и регламенты. Подключается после договора с TecAlliance',
    required: false,
    fields: [
      { key: 'api_key', label: 'API key', type: 'secret' },
    ],
    stub: true,
  },
  profiauto: {
    title: 'ProfiAuto (Moto-Profil)',
    purpose: 'Аналоги, цены, наличие. API — по запросу в Moto-Profil (wdrozenia@moto-profil.pl)',
    required: false,
    fields: [
      { key: 'endpoint', label: 'Endpoint', type: 'text' },
      { key: 'login', label: 'Логин', type: 'secret' },
      { key: 'password', label: 'Пароль / ключ', type: 'secret' },
    ],
    stub: true,
  },
  allegro: {
    title: 'Allegro REST API',
    purpose: 'Сравнение цен и редкие детали. Поиск объявлений — только для верифицированного приложения',
    required: false,
    fields: [
      { key: 'client_id', label: 'Client ID', type: 'secret' },
      { key: 'client_secret', label: 'Client Secret', type: 'secret' },
    ],
    stub: true,
  },
  telegram: {
    title: 'Telegram-бот',
    purpose: 'Уведомления менеджерам: подбор готов, нужен ответ',
    required: false,
    fields: [
      { key: 'bot_token', label: 'Bot token', type: 'secret' },
      { key: 'chat_id', label: 'ID чата менеджеров', type: 'text' },
    ],
  },
};

function row(workshopId, service) {
  return getDb()
    .prepare('SELECT * FROM integrations WHERE workshop_id = ? AND service = ?')
    .get(workshopId, service);
}

// Значения для внутреннего использования (расшифрованные).
export function getIntegration(workshopId, service) {
  const def = SERVICES[service];
  if (!def) throw new Error('Неизвестный сервис: ' + service);
  const r = row(workshopId, service);
  const stored = r ? JSON.parse(r.fields_enc) : {};
  const values = {};
  for (const f of def.fields) {
    const v = stored[f.key];
    values[f.key] = f.type === 'secret' ? decryptSecret(v) : v;
    if ((values[f.key] === undefined || values[f.key] === null || values[f.key] === '') && f.default !== undefined)
      values[f.key] = f.default;
  }
  const enabled = r ? !!r.enabled : !!def.defaultEnabled;
  if (service === 'anthropic' && !values.api_key && config.defaultAnthropicKey) values.api_key = config.defaultAnthropicKey;
  return { enabled, values, status: r?.status || (enabled ? 'unknown' : 'off'), note: r?.status_note, checkedAt: r?.checked_at };
}

// Для UI: секреты маской.
export function listIntegrationsPublic(workshopId) {
  return Object.entries(SERVICES).map(([service, def]) => {
    const it = getIntegration(workshopId, service);
    return {
      service,
      title: def.title,
      purpose: def.purpose,
      required: def.required,
      stub: !!def.stub,
      enabled: it.enabled,
      status: it.status,
      note: it.note,
      checkedAt: it.checkedAt,
      fields: def.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        value: f.type === 'secret' ? mask(it.values[f.key]) : it.values[f.key] ?? '',
        isSet: !!it.values[f.key],
      })),
    };
  });
}

// Сохранение: пустая строка у секрета = не менять; null = удалить.
export function saveIntegration(workshopId, service, { enabled, fields = {} }) {
  const def = SERVICES[service];
  if (!def) throw new Error('Неизвестный сервис: ' + service);
  const r = row(workshopId, service);
  const stored = r ? JSON.parse(r.fields_enc) : {};
  for (const f of def.fields) {
    if (!(f.key in fields)) continue;
    const v = fields[f.key];
    if (v === null) delete stored[f.key];
    else if (f.type === 'secret') {
      if (v !== '' && !String(v).startsWith('••••')) stored[f.key] = encryptSecret(v);
    } else stored[f.key] = String(v);
  }
  const en = enabled === undefined ? (r ? r.enabled : def.defaultEnabled ? 1 : 0) : enabled ? 1 : 0;
  getDb()
    .prepare(
      `INSERT INTO integrations (workshop_id, service, enabled, fields_enc, status)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workshop_id, service) DO UPDATE SET enabled = excluded.enabled, fields_enc = excluded.fields_enc`
    )
    .run(workshopId, service, en, JSON.stringify(stored), en ? 'unknown' : 'off');
}

export function setIntegrationStatus(workshopId, service, status, note) {
  getDb()
    .prepare(
      `INSERT INTO integrations (workshop_id, service, status, status_note, checked_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(workshop_id, service) DO UPDATE SET status = excluded.status, status_note = excluded.status_note, checked_at = excluded.checked_at`
    )
    .run(workshopId, service, status, note || null);
}
