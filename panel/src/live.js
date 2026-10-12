// Модуль «Pulsecar Live» (live.pulsecar.tech): трансляция с камеры поста для клиента.
// Модуль — отдельный сервис; CRM выдаёт сотруднику одноразовую ссылку входа (ключ CRM_API_KEY только здесь, на сервере)
// и показывает панель модуля во фрейме: пункт меню «Kamery na żywo» и кнопка «Udostępnij podgląd na żywo» в заказе.
import { config } from './config.js';
import { one } from './db.js';
import { HttpError } from './util.js';

const C = () => config.live;
export const liveOn = () => !!(C().url && C().key);

async function live(path, method = 'GET', body) {
  const r = await fetch(C().url.replace(/\/$/, '') + '/api/v1' + path, {
    method, headers: { Authorization: 'Bearer ' + C().key, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  }).catch((e) => { throw new HttpError(502, 'Pulsecar Live недоступен: ' + e.message); });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(r.status >= 500 ? 502 : r.status, j.error || 'Pulsecar Live: ошибка ' + r.status);
  return j;
}

/** who — проверка прав из crm.js */
export function mountLive(crm, who) {
  const gate = (req, perm) => {
    if (!liveOn()) throw new HttpError(404, 'Модуль «Kamery na żywo» не подключён');
    return who(req, perm);
  };
  // одноразовая ссылка входа в модуль для текущего сотрудника: вся панель (/admin) или форма новой ссылки (/admin/new?…)
  crm.post('/live-cameras/embed-url', async (req, res) => {
    const next = typeof req.body?.next === 'string' && /^\/admin(\/new)?([?#][^\s]*)?$/.test(req.body.next) ? req.body.next : '/admin';
    const s = gate(req, next.startsWith('/admin/new') ? 'orders.view' : 'orders.edit');
    res.json(await live('/embed-sessions', 'POST', { user: { id: String(s.id), name: s.name || s.login || 'CRM' }, next }));
  });
  // активные ссылки по заказу — в карточке заказа
  crm.get('/live-cameras/order/:id', async (req, res) => {
    gate(req, 'orders.view');
    const o = one('SELECT id FROM orders WHERE id = ?', Number(req.params.id));
    if (!o) throw new HttpError(404, 'Заказ не найден');
    res.json(await live(`/links?orderId=${encodeURIComponent(String(o.id))}&active=1`));
  });
}
