// Все настройки берутся из переменных окружения (.env), здесь — значения по умолчанию.
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const num = (k, d) => Number(env(k, d));

export const config = {
  port: num('PORT', 3100),
  dbPath: env('DB_PATH', './data/pulsecar.db'),
  sessionSecret: env('SESSION_SECRET', 'change-me-please-to-a-long-random-string'),
  publicUrl: env('PUBLIC_URL', 'https://panel.pulsecar.tech'),

  // первый администратор панели (создаётся при первом запуске, если сотрудников ещё нет)
  adminLogin: env('ADMIN_LOGIN', 'admin'),
  adminPassword: env('ADMIN_PASSWORD', ''),

  // SMS для входа клиентов: 'smsapi' (SMSAPI.pl) или 'console' (код пишется в лог — только для тестов)
  smsProvider: env('SMS_PROVIDER', 'console'),
  smsapiToken: env('SMSAPI_TOKEN', ''),
  smsSender: env('SMS_SENDER', 'Pulsecar'),
  // тестовый вход для проверки App Store / Google Play (без SMS)
  reviewPhone: env('REVIEW_PHONE', ''),
  reviewCode: env('REVIEW_CODE', ''),

  // раздел «Маркетинг»: адрес текущей панели бота (Instagram/TikTok)
  marketingUrl: env('MARKETING_URL', ''),

  // фактуры VAT через Fakturownia.pl (они отправляют в KSeF)
  fakturownia: {
    domain: env('FAKTUROWNIA_DOMAIN', ''), // например pulsecar → pulsecar.fakturownia.pl
    token: env('FAKTUROWNIA_TOKEN', ''),
  },

  // SMS клиенту при смене статуса заказа (для статусов с галочкой «уведомлять»)
  smsOnStatus: env('SMS_ON_STATUS', '1') === '1',

  loyalty: {
    name: 'Pulse Points',
    // уровни: from — сумма оплат за последние 12 месяцев (zł), rate — баллов за 1 zł
    tiers: [
      { id: 'start', name: 'Start', from: 0, rate: num('RATE_START', 0.5) },
      { id: 'silver', name: 'Silver', from: num('SILVER_FROM', 3000), rate: num('RATE_SILVER', 0.6) },
      { id: 'gold', name: 'Gold', from: num('GOLD_FROM', 8000), rate: num('RATE_GOLD', 0.75) },
    ],
    pointValuePln: num('POINT_VALUE_PLN', 0.1), // 1 балл = 0,10 zł скидки
    minRedeem: num('MIN_REDEEM', 100), // списывать можно от 100 баллов
    maxRedeemShare: num('MAX_REDEEM_SHARE', 0.3), // баллами можно оплатить до 30% заказа
    welcomeBonus: num('WELCOME_BONUS', 50), // бонус за регистрацию в приложении
    // начислять баллы по данным из CRM за заказы, которые не отсканировали на кассе
    autoEarnFromCrm: env('AUTO_EARN_FROM_CRM', '1') === '1',
  },

  qr: {
    stepSeconds: 30, // QR меняется каждые 30 секунд
    window: 2, // принимаем код ±2 шага (±60 с) на случай неточных часов телефона
    ticketMinutes: 10, // сколько минут после сканирования можно провести оплату
  },
};
