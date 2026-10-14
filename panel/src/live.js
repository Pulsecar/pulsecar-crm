// Модуль «Pulsecar Live» (live.pulsecar.tech): трансляция с камеры поста для клиента.
// Модуль — отдельный сервис; CRM выдаёт сотруднику одноразовую ссылку входа (ключ CRM_API_KEY только здесь, на сервере)
// и показывает панель модуля во фрейме: пункт меню «Kamery na żywo» и кнопка «Udostępnij podgląd na żywo» в заказе.
import { config } from './config.js';
import { one, all, log } from './db.js';
import { HttpError, normPhone } from './util.js';
import { sendSms } from './sms.js';

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
  // Поиск в базе CRM из формы «Nowy link»: машина + клиент + открытое zlecenie → данные подставляются в форму
  crm.get('/live-cameras/search', (req, res) => {
    gate(req, 'orders.view');
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const plate = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const digits = q.replace(/\D/g, '');
    const like = '%' + q.toLowerCase() + '%';
    const rows = all(`SELECT c.id car_id, c.plate, c.make, c.model, c.year, k.id customer_id, k.name, k.company, k.phone
      FROM cars c LEFT JOIN customers k ON k.id = c.customer_id
      WHERE (? <> '' AND REPLACE(REPLACE(UPPER(COALESCE(c.plate, '')), ' ', ''), '-', '') LIKE ?)
         OR LOWER(COALESCE(k.name, '')) LIKE ? OR LOWER(COALESCE(k.company, '')) LIKE ?
         OR (LENGTH(?) >= 5 AND REPLACE(COALESCE(k.phone, ''), ' ', '') LIKE ?)
      ORDER BY c.id DESC LIMIT 12`, plate, '%' + plate + '%', like, like, digits, '%' + digits + '%');
    res.json(rows.map((r) => {
      const o = one(`SELECT o.id, o.number FROM orders o LEFT JOIN order_statuses s ON s.id = o.status_id
        WHERE o.car_id = ? AND o.kind = 'order' AND o.closed_at IS NULL AND COALESCE(s.is_final, 0) = 0 ORDER BY o.id DESC LIMIT 1`, r.car_id);
      return {
        plate: r.plate || '', car: [r.make, r.model, r.year].filter(Boolean).join(' '),
        client: r.company || r.name || '', phone: r.phone || '', orderId: o ? String(o.id) : '', orderNo: o ? o.number : '',
      };
    }));
  });

  // SMS klientowi z linkiem — tekst z modułu, wysyłka przez SMS CRM. Numer: wpisany → z linku → z zlecenia → właściciel auta
  crm.post('/live-cameras/sms', async (req, res) => {
    const s = gate(req, 'orders.contact');
    const id = String(req.body?.linkId || '');
    if (!/^[\w-]{1,64}$/.test(id)) throw new HttpError(400, 'Brak linku');
    const l = await live('/links/' + encodeURIComponent(id));
    if (l.revoked || l.state === 'expired') throw new HttpError(400, 'Link jest nieaktywny — utwórz nowy');
    const order = /^\d+$/.test(String(l.orderId || '')) ? one('SELECT id, customer_id FROM orders WHERE id = ?', Number(l.orderId)) : null;
    const owner = l.plate ? one(`SELECT k.id, k.phone FROM cars c JOIN customers k ON k.id = c.customer_id
      WHERE REPLACE(REPLACE(UPPER(c.plate), ' ', ''), '-', '') = ? ORDER BY c.id DESC LIMIT 1`, String(l.plate).toUpperCase().replace(/[^A-Z0-9]/g, '')) : null;
    const typed = normPhone(req.body?.phone);
    const phone = typed || normPhone(l.phone) || (order?.customer_id ? one('SELECT phone FROM customers WHERE id = ?', order.customer_id)?.phone : null) || owner?.phone;
    if (!phone) throw new HttpError(400, 'Brak numeru telefonu klienta — wpisz numer');
    const r = await sendSms(phone, l.smsText, { kind: 'live', order_id: order?.id || null, customer_id: order?.customer_id || owner?.id || null, staff: s.name });
    if (order) log('order', order.id, 'sms', l.smsText, s.name);
    if (typed && typed !== normPhone(l.phone)) await live('/links/' + encodeURIComponent(id), 'PATCH', { phone: typed }).catch(() => {});
    res.json({ ok: true, phone, ...r });
  });

  // активные ссылки по заказу — в карточке заказа
  crm.get('/live-cameras/order/:id', async (req, res) => {
    gate(req, 'orders.view');
    const o = one('SELECT id FROM orders WHERE id = ?', Number(req.params.id));
    if (!o) throw new HttpError(404, 'Заказ не найден');
    res.json(await live(`/links?orderId=${encodeURIComponent(String(o.id))}&active=1`));
  });
}
