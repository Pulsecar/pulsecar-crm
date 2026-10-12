// HTTP API модуля «ИИ-запчастист».
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, assertConfig } from './config.js';
import { getDb, ensureWorkshop, newId, monthUsage } from './db.js';
import { verifyToken, newExtensionKey, hashKey } from './crypto.js';
import { createJob, startJob, getJob, answerJob, cancelJob, listJobsForWycena } from './jobs.js';
import { listIntegrationsPublic, saveIntegration, getIntegration, setIntegrationStatus, SERVICES } from './integrations.js';
import { getRules, saveRules } from './rules.js';
import { importHistory, historyStats } from './providers/history.js';
import * as ic from './providers/intercars.js';
import * as pl24 from './providers/partslink24.js';
import { decodeVin } from './providers/vin.js';
import { llmFor } from './agent/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20mb' }));

  // CORS: виджет на страницах CRM; расширение — с chrome-extension://
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const isExt = req.path.startsWith('/ext/');
    if (origin && (isExt || config.corsOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Extension-Key');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/widget.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'widget.js')));
  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));

  // ---------- авторизация CRM ----------
  const auth = (roles) => (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
    const p = verifyToken(token);
    if (!p) return res.status(401).json({ error: 'Нет доступа (токен CRM недействителен или истёк)' });
    if (roles && !roles.includes(p.role)) return res.status(403).json({ error: 'Недостаточно прав' });
    ensureWorkshop(p.ws, p.wsName);
    req.auth = p;
    next();
  };
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      res.status(e.status || 500).json({ error: String(e.message || e) });
    }
  };

  // ---------- подбор ----------
  app.post('/api/jobs', auth(['manager', 'admin']), wrap(async (req, res) => {
    const b = req.body || {};
    const input = {
      wycenaId: b.wycenaId ?? req.auth.wid ?? null,
      vehicle: b.vehicle || {},
      text: b.text,
      level: b.level,
      urgency: b.urgency,
      note: b.note,
      pastedCatalogText: b.pastedCatalogText,
      knownOptions: b.knownOptions,
      existingItems: b.existingItems,
    };
    if (req.auth.wid && String(req.auth.wid) !== String(input.wycenaId))
      return res.status(403).json({ error: 'Токен выдан для другой wyceny' });
    const id = createJob(req.auth.ws, req.auth.uid, input);
    startJob(req.auth.ws, id);
    res.status(202).json({ id });
  }));

  app.get('/api/jobs/:id', auth(['manager', 'admin']), wrap(async (req, res) => {
    const j = getJob(req.params.id, req.auth.ws);
    if (!j) return res.status(404).json({ error: 'Не найдено' });
    res.json(j);
  }));

  app.get('/api/wyceny/:wid/jobs', auth(['manager', 'admin']), wrap(async (req, res) => {
    res.json(listJobsForWycena(req.auth.ws, req.params.wid));
  }));

  app.post('/api/jobs/:id/answer', auth(['manager', 'admin']), wrap(async (req, res) => {
    answerJob(req.auth.ws, req.params.id, req.body?.answer ?? '');
    res.json({ ok: true });
  }));

  app.post('/api/jobs/:id/cancel', auth(['manager', 'admin']), wrap(async (req, res) => {
    cancelJob(req.auth.ws, req.params.id);
    res.json({ ok: true });
  }));

  // ---------- Интеграции (админ) ----------
  app.get('/api/integrations', auth(['admin']), wrap(async (req, res) => {
    res.json(listIntegrationsPublic(req.auth.ws));
  }));

  app.put('/api/integrations/:service', auth(['admin']), wrap(async (req, res) => {
    saveIntegration(req.auth.ws, req.params.service, req.body || {});
    res.json({ ok: true });
  }));

  app.post('/api/integrations/:service/test', auth(['admin']), wrap(async (req, res) => {
    const ws = req.auth.ws;
    const s = req.params.service;
    if (!SERVICES[s]) return res.status(404).json({ error: 'Нет такого сервиса' });
    try {
      let note;
      if (s === 'anthropic') {
        const { client, model } = llmFor(ws);
        await client.messages.create({ model, max_tokens: 5, messages: [{ role: 'user', content: 'ok' }] });
        note = 'Подключено, модель ' + model;
      } else if (s === 'intercars') {
        note = await ic.testConnection(ws, getIntegration(ws, 'intercars').values);
        note += `; товаров в локальном каталоге: ${ic.catalogSize(ws)}`;
      } else if (s === 'nhtsa') {
        const r = await decodeVin('1FTFW1E50MFA00000');
        if (!r.nhtsa) throw new Error(r.nhtsaError || 'нет ответа');
        note = 'Подключено';
      } else if (s === 'partslink24') {
        const k = getDb().prepare('SELECT MAX(last_seen) AS ls FROM extension_keys WHERE workshop_id = ?').get(ws);
        if (!k?.ls) throw new Error('Расширение ещё ни разу не подключалось');
        note = 'Расширение было на связи: ' + k.ls;
      } else if (s === 'telegram') {
        const t = getIntegration(ws, 'telegram').values;
        const r = await fetch(`https://api.telegram.org/bot${t.bot_token}/getMe`);
        if (!r.ok) throw new Error('Telegram HTTP ' + r.status);
        note = 'Подключено';
      } else if (s === 'web_research') {
        note = 'Работает через Claude (поиск и чтение страниц)';
      } else {
        throw new Error('Проверка появится после подключения API (договор с поставщиком данных)');
      }
      setIntegrationStatus(ws, s, 'ok', note);
      res.json({ ok: true, note });
    } catch (e) {
      setIntegrationStatus(ws, s, 'error', String(e.message || e));
      res.json({ ok: false, note: String(e.message || e) });
    }
  }));

  // ---------- Правила подбора (админ) ----------
  app.get('/api/rules', auth(['admin']), wrap(async (req, res) => res.json(getRules(req.auth.ws))));
  app.put('/api/rules', auth(['admin']), wrap(async (req, res) => {
    saveRules(req.auth.ws, req.body || {});
    res.json({ ok: true });
  }));

  // ---------- Ключи расширения partslink24 (админ) ----------
  app.get('/api/extension-keys', auth(['admin']), wrap(async (req, res) => {
    res.json(getDb().prepare('SELECT id, label, created_at, last_seen FROM extension_keys WHERE workshop_id = ?').all(req.auth.ws));
  }));
  app.post('/api/extension-keys', auth(['admin']), wrap(async (req, res) => {
    const key = newExtensionKey();
    const id = newId('ek');
    getDb()
      .prepare('INSERT INTO extension_keys (id, workshop_id, key_hash, label) VALUES (?, ?, ?, ?)')
      .run(id, req.auth.ws, hashKey(key), req.body?.label || 'Менеджер');
    res.json({ id, key, note: 'Ключ показывается один раз — вставьте его в настройки расширения.' });
  }));
  app.delete('/api/extension-keys/:id', auth(['admin']), wrap(async (req, res) => {
    getDb().prepare('DELETE FROM extension_keys WHERE id = ? AND workshop_id = ?').run(req.params.id, req.auth.ws);
    res.json({ ok: true });
  }));

  // ---------- История (CRM → модуль) ----------
  // Роль 'system' — серверный токен CRM для фоновой выгрузки.
  app.post('/api/history/import', auth(['admin', 'system']), wrap(async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    res.json({ imported: importHistory(req.auth.ws, rows) });
  }));
  app.get('/api/stats', auth(['admin']), wrap(async (req, res) => {
    res.json({ usage: monthUsage(req.auth.ws), history: historyStats(req.auth.ws), icCatalog: ic.catalogSize(req.auth.ws) });
  }));

  // ---------- Расширение partslink24 ----------
  const extAuth = (req, res, next) => {
    const k = req.headers['x-extension-key'];
    if (!k) return res.status(401).json({ error: 'Нет ключа расширения' });
    const row = getDb().prepare('SELECT * FROM extension_keys WHERE key_hash = ?').get(hashKey(String(k)));
    if (!row) return res.status(401).json({ error: 'Ключ расширения недействителен' });
    getDb().prepare(`UPDATE extension_keys SET last_seen = datetime('now') WHERE id = ?`).run(row.id);
    req.ext = row;
    next();
  };

  app.get('/ext/v1/ping', extAuth, (req, res) => res.json({ ok: true, label: req.ext.label }));

  app.post('/ext/v1/tasks/next', extAuth, wrap(async (req, res) => {
    const t = pl24.claimNext(req.ext.workshop_id);
    if (!t) return res.status(204).end();
    res.json({ id: t.id, vin: t.payload.vin, make: t.payload.make, parts: t.payload.parts, maxSteps: pl24.PL24_MAX_STEPS });
  }));

  app.post('/ext/v1/tasks/:id/step', extAuth, wrap(async (req, res) => {
    const t = pl24.getTask(req.params.id);
    if (!t || t.workshop_id !== req.ext.workshop_id) return res.status(404).json({ error: 'Нет задачи' });
    if (t.status !== 'taken') return res.json({ action: 'done', why: 'Задача уже завершена' });
    const actions = t.log.filter((l) => l.kind === 'action').length;
    if (actions >= pl24.PL24_MAX_STEPS) {
      finishWithFound(t, 'Достигнут лимит шагов');
      return res.json({ action: 'done', why: 'Лимит шагов' });
    }
    const snapshot = req.body?.snapshot || {};
    const { client, model } = llmFor(t.workshop_id);
    const resp = await client.messages.create({
      model,
      max_tokens: 3000,
      system: pl24.NAVIGATOR_SYSTEM,
      messages: [{ role: 'user', content: pl24.buildNavigatorUserMessage(t, snapshot) }],
    });
    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const a = pl24.parseNavigatorAnswer(text);
    if (a.action === 'extract') {
      pl24.appendLog(t.id, { kind: 'extract', rows: a.rows || [], vehicle: a.vehicle || null, url: snapshot.url });
      // после extract — продолжаем поиск остальных деталей
      return res.json({ action: 'continue', why: 'Строки сохранены' });
    }
    if (a.action === 'done') {
      finishWithFound(pl24.getTask(t.id), a.why);
      return res.json(a);
    }
    if (a.action === 'fail') {
      pl24.appendLog(t.id, { kind: 'fail', reason: a.reason, why: a.why });
      const found = collectFound(pl24.getTask(t.id));
      pl24.finishTask(t.id, found.rows.length ? 'done' : 'failed', { ...found, error: a.reason, why: a.why });
      return res.json(a);
    }
    pl24.appendLog(t.id, { kind: 'action', action: a.action, id: a.id, text: a.text, why: a.why });
    res.json(a);
  }));

  app.post('/ext/v1/tasks/:id/finish', extAuth, wrap(async (req, res) => {
    const t = pl24.getTask(req.params.id);
    if (!t || t.workshop_id !== req.ext.workshop_id) return res.status(404).json({ error: 'Нет задачи' });
    if (t.status === 'taken') {
      const found = collectFound(t);
      pl24.finishTask(t.id, found.rows.length ? 'done' : 'failed', { ...found, error: req.body?.error || 'stopped_by_extension' });
    }
    res.json({ ok: true });
  }));

  function collectFound(t) {
    const ex = t.log.filter((l) => l.kind === 'extract');
    const rows = ex.flatMap((l) => (l.rows || []).map((r) => ({ ...r, sourceUrl: l.url })));
    const options = [...new Set(ex.flatMap((l) => l.vehicle?.options || []))];
    const model = ex.map((l) => l.vehicle?.model).find(Boolean) || null;
    return { rows, vehicle: { model, options } };
  }
  function finishWithFound(t, why) {
    const found = collectFound(t);
    pl24.finishTask(t.id, found.rows.length ? 'done' : 'failed', { ...found, why, ...(found.rows.length ? {} : { error: 'not_found' }) });
  }

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertConfig();
  getDb()
    .prepare(`UPDATE jobs SET status='error', error='Сервис был перезапущен во время подбора — запустите подбор снова' WHERE status='running'`)
    .run();
  createApp().listen(config.port, () => console.log(`ИИ-запчастист слушает порт ${config.port}`));
}
