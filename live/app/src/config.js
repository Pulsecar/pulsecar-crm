'use strict';
// Все настройки модуля берутся из переменных окружения (.env).
const path = require('path');

const env = process.env;
const PUBLIC_URL = (env.PUBLIC_URL || 'http://localhost:3010').replace(/\/$/, '');
const CRM_ORIGIN = (env.CRM_ORIGIN || '').replace(/\/$/, '');

const cfg = {
  PORT: Number(env.PORT) || 3010,
  HOST: env.HOST || '127.0.0.1',
  PUBLIC_URL,
  PUBLIC_ORIGIN: new URL(PUBLIC_URL).origin,
  CRM_ORIGIN,                                   // https://panel.pulsecar.tech — откуда разрешено встраивание
  GO2RTC_URL: (env.GO2RTC_URL || 'http://127.0.0.1:11984').replace(/\/$/, ''),
  DATA_DIR: env.DATA_DIR || path.join(__dirname, '..', 'data'),
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || '',
  SESSION_SECRET: env.SESSION_SECRET || '',
  CRM_API_KEY: env.CRM_API_KEY || '',
  COOKIE_SAMESITE: env.COOKIE_SAMESITE || 'Lax',
  SECURE: PUBLIC_URL.startsWith('https://'),
  MAX_LINK_DAYS: Number(env.MAX_LINK_DAYS) || 90,
};

const problems = [];
if (cfg.SESSION_SECRET.length < 32) problems.push('SESSION_SECRET (минимум 32 символа)');
if (cfg.ADMIN_PASSWORD.length < 10) problems.push('ADMIN_PASSWORD (минимум 10 символов)');
if (cfg.CRM_API_KEY && cfg.CRM_API_KEY.length < 32) problems.push('CRM_API_KEY (минимум 32 символа или пусто)');
if (problems.length) {
  console.error('Pulsecar Live: заполните в .env: ' + problems.join(', '));
  process.exit(1);
}

module.exports = cfg;
