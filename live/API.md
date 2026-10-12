# Pulsecar Live — API

Базовый адрес: `https://live.pulsecar.tech/api/v1`. С сервера CRM лучше обращаться напрямую: `http://127.0.0.1:3010/api/v1`.

**Авторизация** (любой из вариантов):
- бэкенд CRM: `Authorization: Bearer <CRM_API_KEY>`;
- браузер внутри панели: cookie сессии (ставится после `/embed/start` или входа по паролю).

Все запросы с телом отправляются с `Content-Type: application/json`. Ошибки приходят в виде `{"error": "текст по-польски для пользователя"}` с кодом 400/401/403/404/409.

Даты передаются в ISO 8601 (`2026-10-15T16:00:00.000Z`). Часы доступа считаются по времени Варшавы.

---

## Вход в модуль из CRM

### `POST /embed-sessions` — только по API-ключу
Одноразовая ссылка входа для текущего пользователя CRM. Живёт 2 минуты.
```json
{ "user": { "id": "7", "name": "Ali Abdurakhmanov" }, "next": "/admin/new?plate=WB%204721K&orderNo=ZL%2F1048&orderId=1048" }
```
- `next` — `/admin` (вся панель; можно добавить `#links` / `#cameras` / `#settings`) или `/admin/new?…` (только форма новой ссылки).
- Параметры для `/admin/new`: `plate, client, car, orderNo, orderId, phone, cameraId` — все поля подставляются в форму.

Ответ: `{ "url": "https://live.pulsecar.tech/embed/start?t=…", "expiresIn": 120 }`. Этот `url` открывается в iframe.

### Сообщения из iframe (`window.postMessage`, только на `CRM_ORIGIN`)
| `type` | Когда | Данные |
|---|---|---|
| `pulsecar-live:link-created` | создана ссылка | `link` — объект ссылки (см. ниже) |
| `pulsecar-live:close` | нажато «Anuluj» или «Gotowe» в форме `/admin/new` | — |

---

## Камеры

| Метод | Путь | Описание |
|---|---|---|
| GET | `/cameras` | список камер |
| POST | `/cameras` | добавить камеру |
| GET | `/cameras/{id}` | одна камера |
| PATCH | `/cameras/{id}` | изменить. Пустой `pass` = оставить старый пароль |
| DELETE | `/cameras/{id}` | удалить. Если у камеры есть активные ссылки — `409` |
| POST | `/cameras/test` | проверить подключение без сохранения; с `id` проверяет сохранённую камеру с изменёнными полями |
| GET | `/cameras/{id}/snapshot.jpg` | текущий кадр (JPEG), кэш 10 с |

Тело для камеры Tapo:
```json
{ "name": "Stanowisko 1", "type": "tapo", "host": "192.168.3.20", "port": 554, "user": "pulsecar", "pass": "…", "stream": "stream1", "enabled": true }
```
Любая RTSP-камера: `{ "name": "…", "type": "rtsp", "url": "rtsp://login:hasło@IP:554/ścieżka" }`.

В ответе пароля нет: `{ id, name, type, host, port, user, stream, enabled, hasPassword, address, activeLinks, watching, createdAt }`.

Ответ `/cameras/test`:
- `{ ok: true, snapshot: "data:image/jpeg;base64,…" }`, если всё работает;
- `{ ok: false, code, message }`, если нет. Возможные `code`: `auth` (неверный логин или пароль), `timeout` (нет сети до камеры), `refused`, `not_found`, `no_frame`, `go2rtc`.

---

## Ссылки для клиентов

| Метод | Путь | Описание |
|---|---|---|
| GET | `/links?orderId=&plate=&cameraId=&active=1&limit=` | список, сначала новые |
| POST | `/links` | создать |
| GET | `/links/{id}` | одна ссылка |
| PATCH | `/links/{id}` | изменить: даты, часы, камеру, данные; `{ "revoked": true }` — отозвать (необратимо) |

Тело при создании:
```json
{
  "cameraId": "c_1a2b3c4d5e",
  "plate": "WB 4721K", "client": "Marek Nowak", "car": "Skoda Octavia III",
  "orderNo": "ZL/2026/1048", "orderId": "1048", "phone": "+48…",
  "validFrom": "2026-10-13T06:00:00.000Z",
  "validTo":   "2026-10-16T16:00:00.000Z",
  "scheduleMode": "workshop",
  "schedule": null
}
```
- `validFrom` — по умолчанию «сейчас». `validTo` обязателен. Период не больше `MAX_LINK_DAYS` (по умолчанию 90 дней).
- `scheduleMode` — в какие часы внутри периода виден поток:
  - `workshop` — часы работы мастерской из настроек, с учётом праздников;
  - `always` — круглосуточно;
  - `custom` — свои часы: `"schedule": { "mon": ["08:00","18:00"], …, "sun": null }`.

Объект ссылки в ответе:
```json
{
  "id": "…", "url": "https://live.pulsecar.tech/v/AbC…",
  "cameraId": "c_…", "cameraName": "Stanowisko 1",
  "plate": "WB 4721K", "client": "…", "car": "…", "orderNo": "…", "orderId": "1048", "phone": "…",
  "validFrom": "…", "validTo": "…", "scheduleMode": "workshop", "schedule": null, "scheduleText": "pn–pt 08:00–18:00, sob 09:00–14:00",
  "state": "live", "nextOpen": null, "viewers": 0, "views": 3, "lastViewAt": "…", "revoked": false,
  "createdAt": "…", "createdBy": "Ali Abdurakhmanov",
  "smsText": "Dzień dobry! Tu warsztat Pulsecar. …"
}
```
Значения `state`: `live` (поток идёт), `closed` (вне часов; `nextOpen` — когда откроется), `not_started` (до `validFrom`), `expired`, `revoked`, `no_camera`.

Готовый текст SMS на польском лежит в `smsText`. Если в CRM есть отправка SMS, используйте его как есть.

---

## Настройки
`GET /settings`, `PUT /settings`:
```json
{ "workshopHours": { "mon": ["08:00","18:00"], "…": "…", "sun": null }, "closedDates": ["2026-11-01","2026-11-11"], "contactPhone": "+48 …", "maxViewersPerLink": 3 }
```

## Служебное
- `GET /healthz` (без авторизации) возвращает `{ ok, go2rtc, cameras }`. Код 503, если видеосервер недоступен.
- Страница клиента: `GET /v/{token}`. Данные для неё: `GET /v/{token}/info`. Видео идёт по WebSocket `/v/{token}/ws`.
