// Реестр интеграций: настройки хранятся в базе (Настройки → Интеграции), .env — запасной вариант
import { one, run } from '../db.js';

/**
 * Каждая интеграция: поля (secret — маскируется и не отдаётся в браузер), описание, где взять токен.
 * Логика подключения — в соседних файлах; проверка связи — через TESTS.
 */
export const DEFS = [
  {
    key: 'intercars', group: 'Поставщики', title: 'Inter Cars (IC API)',
    about: 'Поставки и фактуры Inter Cars → приход на склад одной кнопкой. Поиск цен и наличия по индексу прямо из заказа, заказ деталей в IC.',
    howto: 'ClientId и ClientSecret выдаёт Inter Cars (icapi@intercars.eu) — это те же данные, что сейчас вписаны в Motowarsztat → Integracje → Hurtownie → InterCars.',
    fields: [
      { k: 'clientId', label: 'ClientId', required: true },
      { k: 'clientSecret', label: 'ClientSecret', secret: true, required: true },
      { k: 'source', label: 'Что загружать', type: 'select', options: [['delivery', 'Поставки / WZ (рекомендуется)'], ['invoice', 'Фактуры']], def: 'delivery' },
      { k: 'autoSync', label: 'Проверять новые документы автоматически (каждые 30 мин)', type: 'bool', def: true },
      { k: 'autoReceive', label: 'Сразу приходовать на склад без подтверждения', type: 'bool', def: false },
      { k: 'markup', label: 'Наценка для цены продажи, % (если IC не даёт розничную)', type: 'number', def: 40 },
      { k: 'useRetail', label: 'Брать розничную цену Inter Cars как цену продажи', type: 'bool', def: true },
      { k: 'shipTo', label: 'shipTo (только для мастер-аккаунтов)', advanced: true },
      { k: 'baseUrl', label: 'Адрес API', advanced: true, def: 'https://api.webapi.intercars.eu' },
      { k: 'tokenUrl', label: 'Адрес токена', advanced: true, def: 'https://is.webapi.intercars.eu/oauth2/token' },
    ],
  },
  {
    key: 'hart', group: 'Поставщики', title: 'Hart (Hart API)',
    about: 'Фактуры или WZ из Hart → приход на склад или сразу в заказ одной кнопкой. Цена и наличие по коду Hart, заказ в Hart из CRM.',
    howto: 'Логин и пароль к Hart REST API выдаёт ваш торговый представитель Hart (или api@hartphp.com.pl). Это не пароль от сайта hartphp.com.pl.',
    fields: [
      { k: 'username', label: 'Логин API', required: true },
      { k: 'password', label: 'Пароль API', secret: true, required: true },
      { k: 'source', label: 'Что загружать', type: 'select', options: [['delivery', 'WZ (документы выдачи)'], ['invoice', 'Фактуры']], def: 'invoice' },
      { k: 'autoSync', label: 'Проверять новые документы автоматически (каждые 30 мин)', type: 'bool', def: true },
      { k: 'autoReceive', label: 'Сразу приходовать на склад', type: 'bool', def: false },
      { k: 'markup', label: 'Наценка для цены продажи, %', type: 'number', def: 40 },
      { k: 'branchId', label: 'Филиал Hart (BranchId), если несколько', advanced: true },
      { k: 'baseUrl', label: 'Адрес API', advanced: true, def: 'https://restapi.hartphp.com.pl' },
    ],
  },
  {
    key: 'mailbox', group: 'Поставщики', title: 'Почтовый ящик для документов поставщиков',
    about: 'Любой поставщик (Auto Partner, Inter-Team, Moto-Profil, Gordon…) может присылать фактуры и WZ файлом CSV/XLSX на отдельный ящик — CRM сама забирает их каждые 30 минут и кладёт в Склад → Поставщики.',
    howto: 'Создайте ящик, например dostawy@pulsecar.pl (Hostinger → Почта). В B2B каждого поставщика включите отправку документов в CSV/XLSX на этот адрес. IMAP Hostinger: imap.hostinger.com, порт 993.',
    fields: [
      { k: 'host', label: 'IMAP сервер', required: true, def: 'imap.hostinger.com' },
      { k: 'port', label: 'Порт', type: 'number', def: 993 },
      { k: 'user', label: 'Логин (адрес ящика)', required: true },
      { k: 'pass', label: 'Пароль', secret: true, required: true },
      { k: 'folder', label: 'Папка', def: 'INBOX', advanced: true },
      { k: 'rules', label: 'Какой адрес = какой поставщик (строки вида «autopartner.pl = autopartner»)', advanced: true },
    ],
  },
  {
    key: 'fakturownia', group: 'Бухгалтерия', title: 'Fakturownia.pl',
    about: 'Фактуры VAT из заказа одной кнопкой. Fakturownia сама отправляет их в KSeF и формирует JPK.',
    howto: 'В Fakturownia: Ustawienia → Ustawienia konta → Integracja → Kod autoryzacyjny API. Домен — первая часть адреса: pulsecar.fakturownia.pl → pulsecar.',
    fields: [
      { k: 'domain', label: 'Домен (часть до .fakturownia.pl; не нужен, если токен с префиксом)' },
      { k: 'token', label: 'API токен', secret: true, required: true },
      { k: 'autoInvoiceNip', label: 'Автоматически выставлять фактуру, когда заказ фирмы (с NIP) завершён и оплачен', type: 'bool', def: false },
    ],
  },
  {
    key: 'smsgate', group: 'SMS клиентам', title: 'Свой телефон с SIM — SMS Gateway for Android',
    about: 'SMS уходят с вашего номера через Android-телефон в сервисе (обычный тариф оператора, клиенты видят ваш номер и могут ответить). Все SMS CRM: коды входа, статусы, напоминания, карта заказа, смета.',
    howto: 'Установите на телефон приложение «SMS Gateway for Android» (sms-gate.app), включите «Cloud server» — приложение покажет логин и пароль. Адрес оставьте как есть. Для работы в локальной сети впишите http://IP-телефона:8080.',
    fields: [
      { k: 'user', label: 'Логин (Username)', required: true },
      { k: 'pass', label: 'Пароль', secret: true, required: true },
      { k: 'url', label: 'Адрес API', def: 'https://api.sms-gate.app/3rdparty/v1', advanced: true },
      { k: 'simNumber', label: 'Номер SIM (1 или 2), если в телефоне две', advanced: true },
    ],
  },
  {
    key: 'smsapi', group: 'SMS клиентам', title: 'SMSAPI.pl',
    about: 'Польский SMS-шлюз: отправка с именем «Pulsecar» вместо номера.',
    howto: 'smsapi.pl → Ustawienia API → Tokeny API (OAuth) → создать токен с доступом к SMS. Имя отправителя нужно подтвердить в SMSAPI.',
    fields: [
      { k: 'token', label: 'Токен OAuth', secret: true, required: true },
      { k: 'sender', label: 'Имя отправителя', def: 'Pulsecar' },
    ],
  },
  {
    key: 'serwersms', group: 'SMS клиентам', title: 'SerwerSMS.pl',
    about: 'Польский SMS-шлюз (SMS ECO и FULL с именем отправителя).',
    howto: 'panel serwersms.pl → Ustawienia interfejsów → HTTPS API → Tokeny API → Dodaj token. Имя отправителя (для FULL) подтверждается в панели.',
    fields: [
      { k: 'token', label: 'Токен API', secret: true, required: true },
      { k: 'sender', label: 'Имя отправителя (пусто = SMS ECO)' },
    ],
  },
  {
    key: 'smsplanet', group: 'SMS клиентам', title: 'SMSPLANET.pl',
    about: 'Польский SMS-шлюз.',
    howto: 'panel.smsplanet.pl → API → токен (Bearer). Имя отправителя подтверждается в панели.',
    fields: [
      { k: 'token', label: 'Токен API', secret: true, required: true },
      { k: 'sender', label: 'Имя отправителя', def: 'Pulsecar' },
    ],
  },
  {
    key: 'twilio', group: 'SMS клиентам', title: 'Twilio',
    about: 'Международный шлюз: SMS с купленного номера Twilio или с имени отправителя.',
    howto: 'console.twilio.com → Account Info: Account SID и Auth Token. «От кого» — номер Twilio (+48…), имя отправителя или Messaging Service SID (MG…).',
    fields: [
      { k: 'sid', label: 'Account SID', required: true },
      { k: 'token', label: 'Auth Token', secret: true, required: true },
      { k: 'from', label: 'От кого (номер, имя или MG…)', required: true },
    ],
  },
  {
    key: 'smshttp', group: 'SMS клиентам', title: 'Другой SMS-шлюз / телефония (HTTP)',
    about: 'Любой сервис, который отправляет SMS по HTTP-запросу (виртуальная АТС, ваш оператор, Zadarma, свой сервер). В адрес и тело подставляются {phone}, {phone_digits} и {text}.',
    howto: 'Пример GET: https://example.pl/send?login=…&to={phone_digits}&text={text}. Пример JSON-тела: {"to":"{phone}","message":"{text}"}. Заголовки — JSON, например {"Authorization":"Bearer …"}.',
    fields: [
      { k: 'url', label: 'Адрес (URL)', required: true },
      { k: 'method', label: 'Метод', type: 'select', options: [['POST', 'POST'], ['GET', 'GET']], def: 'POST' },
      { k: 'body', label: 'Тело запроса (для POST)' },
      { k: 'headers', label: 'Заголовки (JSON), например с токеном', secret: true },
      { k: 'testPhone', label: 'Номер для тестового SMS' },
    ],
  },
  {
    key: 'email', group: 'Связь с клиентами', title: 'Почта (SMTP)',
    about: 'Отправка клиенту карты заказа, сметы и фактуры PDF по e-mail прямо из заказа. Подходит Gmail, WP, o2, Interia, домашняя почта Hostinger.',
    howto: 'Hostinger: host smtp.hostinger.com, порт 465, логин — адрес ящика. Gmail: smtp.gmail.com, 465, пароль приложения (не обычный пароль).',
    fields: [
      { k: 'host', label: 'SMTP сервер', required: true, def: 'smtp.hostinger.com' },
      { k: 'port', label: 'Порт', type: 'number', def: 465 },
      { k: 'user', label: 'Логин (адрес)', required: true, def: 'admin@pulsecar.pl' },
      { k: 'pass', label: 'Пароль', secret: true, required: true },
      { k: 'from', label: 'Отправитель', def: 'Pulsecar <admin@pulsecar.pl>' },
    ],
  },
  {
    key: 'tpay', group: 'Оплата', title: 'Tpay — онлайн-оплата',
    about: 'Ссылка на оплату заказа (BLIK, карта, перевод) — отправляется клиенту SMS/e-mail, оплата отмечается в заказе автоматически.',
    howto: 'panel.tpay.com → Integracje → API → Open API: Client ID и Secret. Для проверки можно включить Sandbox.',
    fields: [
      { k: 'clientId', label: 'Client ID', required: true },
      { k: 'clientSecret', label: 'Client Secret', secret: true, required: true },
      { k: 'sandbox', label: 'Тестовый режим (Sandbox)', type: 'bool', def: false },
    ],
  },
  {
    key: 'telegram', group: 'Уведомления команде', title: 'Telegram — уведомления',
    about: 'Сообщения в ваш чат: новая заявка из приложения, оплата, заказ готов, закончился товар, ошибки интеграций.',
    howto: 'Создайте бота у @BotFather → токен. Добавьте бота в чат команды, напишите в чат сообщение и нажмите «Проверить» — ID чата подставится сам.',
    fields: [
      { k: 'botToken', label: 'Токен бота', secret: true, required: true },
      { k: 'chatId', label: 'ID чата' },
      { k: 'events', label: 'События', type: 'multi', options: [['booking', 'Заявка из приложения'], ['payment', 'Оплата'], ['status', 'Смена статуса'], ['stock', 'Мало на складе'], ['supplier', 'Новые документы поставщиков']], def: ['booking', 'payment', 'supplier'] },
    ],
  },
  {
    key: 'webhook', group: 'Уведомления команде', title: 'Вебхук (n8n, Make, ваш бот)',
    about: 'CRM отправляет JSON на ваш адрес при событиях: заявка, новый заказ, смена статуса, оплата. Удобно связать с ботом Instagram/TikTok.',
    howto: 'Укажите URL. В заголовке X-Pulsecar-Signature приходит HMAC-SHA256 тела с вашим секретом.',
    fields: [
      { k: 'url', label: 'URL', required: true },
      { k: 'secret', label: 'Секрет для подписи', secret: true },
    ],
  },
  {
    key: 'calendar', group: 'Календарь', title: 'Google Calendar / Apple iCloud',
    about: 'Терминарз как календарь-подписка: записи появляются в Google Календаре и на iPhone. Отдельная ссылка для каждого поста или общая.',
    howto: 'Включите и скопируйте ссылку. Google Календарь → «Другие календари» → «+» → «Добавить по URL». iPhone: Настройки → Календарь → Учётные записи → Подписной календарь.',
    fields: [{ k: 'feedToken', label: 'Секрет ссылки', secret: true, auto: true }],
  },
  {
    key: 'vin', group: 'Данные авто', title: 'Расшифровка VIN',
    about: 'Кнопка «Расшифровать VIN» в карточке авто заполняет марку, модель, год и двигатель. Бесплатная база NHTSA работает без ключа; для европейских авто точнее платные сервисы.',
    howto: 'Без ключа работает сразу. Для платного сервиса (например vindecoder.eu) укажите ключ и секрет.',
    fields: [
      { k: 'vindecoderKey', label: 'vindecoder.eu API key (необязательно)' },
      { k: 'vindecoderSecret', label: 'vindecoder.eu secret', secret: true },
    ],
  },
  {
    key: 'plate', group: 'Данные авто', title: 'Данные авто по номеру',
    about: 'Кнопка поиска рядом с номером в карточке авто: марка, модель, год, VIN, объём, мощность, топливо, дата первой регистрации. Затем по VIN подтягивается остальное. Бесплатно данные даёт скан кода Aztec с техпаспорта — он работает без ключа.',
    howto: 'RegCheck / tablicarejestracyjnaapi.pl: зарегистрируйтесь, купите пакет запросов (≈0,82 zł за запрос), логин впишите сюда. Или укажите свой сервис: адрес с {plate}, ответ в JSON.',
    fields: [
      { k: 'provider', label: 'Сервис', type: 'select', options: [['regcheck', 'RegCheck (tablicarejestracyjnaapi.pl)'], ['custom', 'Свой сервис (URL)']], def: 'regcheck' },
      { k: 'username', label: 'Логин RegCheck' },
      { k: 'url', label: 'Свой сервис: адрес с {plate}', advanced: true },
      { k: 'headers', label: 'Свой сервис: заголовки (JSON)', secret: true, advanced: true },
      { k: 'testPlate', label: 'Номер для проверки связи', def: 'WX1234A' },
    ],
  },
  {
    key: 'marketing', group: 'Маркетинг', title: 'Панель бота Instagram / TikTok',
    about: 'Вкладка «Маркетинг» открывает панель бота внутри CRM. Вход общий: без входа в CRM панель бота не откроется.',
    howto: 'Адрес панели: https://marketing.pulsecar.tech (настройка прокси — в README, раздел «Маркетинг»).',
    fields: [{ k: 'url', label: 'Адрес панели', def: 'https://marketing.pulsecar.tech' }],
  },
];

export const def = (key) => DEFS.find((d) => d.key === key);

// .env как запасной источник (чтобы старые настройки продолжали работать)
const ENV = {
  fakturownia: { domain: 'FAKTUROWNIA_DOMAIN', token: 'FAKTUROWNIA_TOKEN' },
  smsapi: { token: 'SMSAPI_TOKEN', sender: 'SMS_SENDER' },
  smsgate: { user: 'SMSGATE_USER', pass: 'SMSGATE_PASS', url: 'SMSGATE_URL' },
  marketing: { url: 'MARKETING_URL' },
  intercars: { clientId: 'IC_CLIENT_ID', clientSecret: 'IC_CLIENT_SECRET', baseUrl: 'IC_BASE_URL', tokenUrl: 'IC_TOKEN_URL' },
};

/** Настройки интеграции: база → .env → значения по умолчанию. enabled=false → null */
export function cfg(key, { ignoreEnabled = false } = {}) {
  const d = def(key);
  const row = one('SELECT * FROM integrations WHERE key = ?', key);
  const c = row ? JSON.parse(row.config) : {};
  const out = {};
  for (const f of d.fields) {
    const envName = ENV[key]?.[f.k];
    out[f.k] = c[f.k] !== undefined && c[f.k] !== '' ? c[f.k] : envName && process.env[envName] ? process.env[envName] : f.def;
  }
  const envOn = ENV[key] && d.fields.filter((f) => f.required).every((f) => ENV[key][f.k] && process.env[ENV[key][f.k]]);
  const enabled = row ? !!row.enabled : !!envOn;
  if (!enabled && !ignoreEnabled) return null;
  return out;
}

export function getState(key) {
  const row = one('SELECT state FROM integrations WHERE key = ?', key);
  return row ? JSON.parse(row.state) : {};
}
export function setState(key, patch) {
  const st = { ...getState(key), ...patch };
  run(`INSERT INTO integrations (key, state) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET state = excluded.state`, key, JSON.stringify(st));
  return st;
}

const mask = (v) => (v ? '••••' + String(v).slice(-4) : '');

/** Для браузера: секреты скрыты */
export function publicList() {
  return DEFS.map((d) => {
    const row = one('SELECT * FROM integrations WHERE key = ?', d.key);
    const c = cfg(d.key, { ignoreEnabled: true });
    const values = {};
    for (const f of d.fields) values[f.k] = f.secret ? mask(c[f.k]) : c[f.k];
    const st = row ? JSON.parse(row.state) : {};
    const configured = d.fields.filter((f) => f.required).every((f) => c[f.k]);
    return {
      key: d.key, group: d.group, title: d.title, about: d.about, howto: d.howto,
      fields: d.fields.map(({ k, label, type, options, secret, required, advanced, auto }) => ({ k, label, type, options, secret, required, advanced, auto })),
      values, enabled: !!cfg(d.key), configured, lastSync: st.lastSync || null, lastError: st.lastError || null, info: st.info || null,
    };
  });
}

/** Сохранение из браузера: пустое или замаскированное секретное поле не перезаписывает старое значение */
export function save(key, enabled, values = {}) {
  const d = def(key);
  if (!d) throw new Error('Нет такой интеграции');
  const row = one('SELECT * FROM integrations WHERE key = ?', key);
  const cur = row ? JSON.parse(row.config) : {};
  for (const f of d.fields) {
    if (!(f.k in values)) continue;
    const v = values[f.k];
    if (f.secret && (v === '' || v === null || String(v).startsWith('••••'))) continue;
    cur[f.k] = f.type === 'number' ? Number(v) : f.type === 'bool' ? !!v : v;
  }
  run(`INSERT INTO integrations (key, enabled, config, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, config = excluded.config, updated_at = excluded.updated_at`,
    key, enabled ? 1 : 0, JSON.stringify(cur));
}
