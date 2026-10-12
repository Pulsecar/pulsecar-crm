/*
 * Пример бэкенда CRM (Node.js / Express) для Pulsecar Live.
 * Если CRM на другом стеке (PHP, Python…), повторите ту же логику: это 2 HTTP-запроса к модулю.
 *
 * Переменные окружения CRM:
 *   PULSECAR_LIVE_URL=http://127.0.0.1:3010      (модуль на том же сервере — запросы не выходят в интернет)
 *   PULSECAR_LIVE_API_KEY=<тот же CRM_API_KEY, что в .env модуля>
 */
const LIVE = process.env.PULSECAR_LIVE_URL || 'http://127.0.0.1:3010';
const KEY = process.env.PULSECAR_LIVE_API_KEY;

async function live(path, method = 'GET', body) {
  const r = await fetch(LIVE + '/api/v1' + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `Pulsecar Live ${r.status}`); e.status = r.status; throw e; }
  return j;
}

module.exports = function mountPulsecarLive(app, requireLogin) {
  // 1) Одноразовая ссылка входа в модуль для текущего пользователя CRM.
  //    Вызывается из pulsecar-live-embed.js. Обязательно за проверкой входа в CRM!
  app.post('/api/live-cameras/embed-url', requireLogin, async (req, res) => {
    try {
      const next = typeof req.body?.next === 'string' ? req.body.next : '/admin';
      const user = { id: String(req.user.id), name: req.user.name };   // ← поля пользователя вашей CRM
      res.json(await live('/embed-sessions', 'POST', { user, next }));
    } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });

  // 2) (необязательно) Активные ссылки по заказу — показать в карточке zlecenia.
  app.get('/api/live-cameras/order/:orderId', requireLogin, async (req, res) => {
    try { res.json(await live(`/links?orderId=${encodeURIComponent(req.params.orderId)}&active=1`)); }
    catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });
};

/* То же на PHP (без фреймворка):
 *
 * $ch = curl_init(getenv('PULSECAR_LIVE_URL') . '/api/v1/embed-sessions');
 * curl_setopt_array($ch, [
 *   CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
 *   CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . getenv('PULSECAR_LIVE_API_KEY'), 'Content-Type: application/json'],
 *   CURLOPT_POSTFIELDS => json_encode(['user' => ['id' => $user->id, 'name' => $user->name], 'next' => $next]),
 * ]);
 * header('Content-Type: application/json'); echo curl_exec($ch);
 */
