import express from 'express';
import { initAudit, auditContext } from './audit.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import './db.js';
import { api } from './api.js';
import { crm } from './crm.js';
import { pub } from './public.js';
import { icalFeed, checkPayment } from './integrations/services.js';
import { startJobs } from './integrations/jobs.js';
import { recalc } from './orders.js';
import { notify } from './integrations/notify.js';
import { all as dbAll } from './db.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Express 5 сам ловит ошибки async-обработчиков
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// журнал изменений: у каждого запроса свой автор
initAudit();
app.use(auditContext);

// Сервис (филиал) для публичных страниц: карта заказа /k/W2~токен, запись /rezerwacja?b=W2
import { withDb, mainDb } from './db.js';
import { branchDb, allDbs, forEachDb } from './branches.js';
app.use((req, _res, next) => {
  const code = /^\/k\/([A-Z0-9]{2,8})~/.exec(req.path)?.[1] || (req.path.startsWith('/rezerwacja') ? String(req.query.b || '').toUpperCase() : '');
  withDb((code && branchDb(code)) || mainDb, next);
});

// API мобильного приложения
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/api', api);

// API панели (CRM)
app.use('/crm-api', crm);

// Страницы для клиентов: электронная карта заказа /k/<токен>, онлайн-запись /rezerwacja
app.use(pub);

// Календарь-подписка (Google / iPhone): /ical/<секрет>.ics, отдельный пост — ?station=ID
app.get('/ical/:token.ics', (req, res) => {
  let body = null;
  for (const d of allDbs()) { body = withDb(d, () => icalFeed(req.params.token, Number(req.query.station) || null)); if (body) break; }
  if (!body) return res.status(404).send('not found');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.send(body);
});

// Уведомление Tpay: содержимому не доверяем — перепроверяем все ожидающие оплаты через API Tpay
app.post('/hooks/tpay', express.urlencoded({ extended: false }), async (req, res) => {
  res.type('text/plain').send('TRUE');
  await forEachDb(async () => {
    for (const o of dbAll(`SELECT * FROM orders WHERE pay_ext_id IS NOT NULL AND paid < total - 0.01`)) {
      try { const r = await checkPayment(o); if (r.justPaid) { recalc(o.id); notify('payment', `Онлайн-оплата ${o.number}: ${r.amount} zł`); } } catch {}
    }
  });
});

// статика панели и библиотеки без сборки
app.get('/vendor/preact-htm.js', (_req, res) => res.sendFile(join(root, 'node_modules/htm/preact/standalone.module.js')));
app.get('/vendor/html5-qrcode.min.js', (_req, res) => res.sendFile(join(root, 'node_modules/html5-qrcode/html5-qrcode.min.js')));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get(/^\/admin(\/.*)?$/, (_req, res) => res.redirect('/'));
// код панели (js/css/переводы) — всегда проверять свежесть (ETag), чтобы после обновления сразу была новая версия
app.use(express.static(join(root, 'public'), { index: 'index.html', maxAge: '1h',
  setHeaders: (res, path) => { if (/\.(js|mjs|css|json|html)$/.test(path) && !/[\\/]vendor[\\/]/.test(path)) res.setHeader('Cache-Control', 'no-cache'); } }));
// приложение для клиентов (веб-версия Expo): https://…/app/
app.get(/^\/app(\/[^.]*)?$/, (_req, res) => res.sendFile(join(root, 'public/app/index.html')));
// SPA: все остальные пути — index.html
app.get(/^\/(?!api|crm-api|vendor|ical|hooks|k\/|rezerwacja).*/, (_req, res) => res.sendFile(join(root, 'public/index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Ошибка сервера' : err.message });
});

app.listen(config.port, () => console.log(`Pulsecar panel: http://localhost:${config.port}`));
if (process.env.NODE_ENV !== 'test') startJobs();

// ── Ежедневная резервная копия базы: data/backups/pulsecar-ГГГГ-ММ-ДД.db (хранится 30 дней) ──
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { curBranch as curBranchCode } from './branches.js';
function backup() {
  // главный: pulsecar-ГГГГ-ММ-ДД.db, филиалы: pulsecar-КОД-ГГГГ-ММ-ДД.db — по 30 копий каждого
  const dir = join(dirname(config.dbPath), 'backups');
  mkdirSync(dir, { recursive: true });
  for (const d of allDbs()) {
    try {
      const code = withDb(d, () => curBranchCode());
      const pre = code === 'main' ? 'pulsecar-' : `pulsecar-${code}-`;
      const file = join(dir, `${pre}${new Date().toISOString().slice(0, 10)}.db`);
      if (!existsSync(file)) d.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const files = readdirSync(dir).filter((f) => f.startsWith(pre) && /^\d{4}-/.test(f.slice(pre.length))).sort();
      for (const f of files.slice(0, Math.max(0, files.length - 30))) rmSync(join(dir, f));
    } catch (e) { console.error('Бэкап не удался:', e.message); }
  }
}
setTimeout(backup, 10_000);
setInterval(backup, 6 * 3600_000);
