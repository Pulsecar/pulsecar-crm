# Задание: развернуть модуль «Pulsecar Live» и встроить его в CRM Pulsecar

Ты разворачиваешь готовый модуль трансляций для автосервиса Pulsecar (Варшава) и встраиваешь его в CRM `https://panel.pulsecar.tech`. Код модуля готов и проверен сквозным тестом (51 проверка). Менять его без необходимости не нужно, твоя задача — развёртывание и интеграция.

## Что делает модуль
- Сотрудник в CRM создаёт ссылку для клиента. В ссылке задаются **конкретная камера**, **период «от–до»** (дата и время) и **часы доступа** внутри периода: часы работы мастерской, круглосуточно или свои часы по дням недели.
- Клиент открывает `https://live.pulsecar.tech/v/<токен>` в браузере и видит **видео без звука**. Вне часов, до начала, после окончания и после отзыва ссылки видео не отдаётся, а уже идущая трансляция обрывается не позже чем через 15 секунд.
- **Камеры добавляются позже через интерфейс** (вкладка «Kamery»): IP, логин и пароль Tapo, кнопка «Sprawdź połączenie» со снимком или понятной ошибкой. Конфиги для камер руками не правятся.

## Архитектура
```
Камеры Tapo (сеть мастерской) ──Tailscale──▶ сервер: go2rtc (127.0.0.1:11984) ─▶ app (127.0.0.1:3010) ─▶ nginx ─▶ live.pulsecar.tech
                                                                                           ▲
CRM (panel.pulsecar.tech) ──API-ключ, server-to-server──────────────────────────────────────┘ + iframe /embed/start
```
- `app/` — Node.js 22 без npm-зависимостей. Хранилище — JSON-файл `data/db.json`.
- `go2rtc` — видеосервер. Звук отбрасывается источником `ffmpeg:…#video=copy`, без перекодирования.
- Все порты слушают только 127.0.0.1. Наружу смотрит только nginx.

## Жёсткие ограничения
- **Домен pulsecar.pl не трогать вообще.** Используется только поддомен `live.pulsecar.tech`. В DNS pulsecar.tech **добавить** одну запись, существующие записи (CRM) не менять.
- CRM уже работает в продакшене. Изменения в CRM делай аккуратно, в стиле её кода, с польскими подписями в интерфейсе.
- `CRM_API_KEY` хранится только на бэкенде CRM. Во фронтенд и в git его не класть.
- Перед действиями, которые нельзя отменить (перезапуск CRM, изменения в DNS), коротко скажи пользователю, что делаешь.

---

## Шаг 1. Осмотреть сервер
1. ОС, наличие `docker` и `docker compose`, какой обратный прокси стоит (nginx, Caddy, Traefik, панель Hostinger).
2. Свободны ли порты `3010`, `11984`, `18555` на 127.0.0.1. Если `3010` занят, поменяй `APP_PORT` в `.env` и в конфиге прокси.
3. Где лежит код CRM, на каком он стеке и как деплоится.
4. Тот же ли это сервер, где работает `panel.pulsecar.tech`. Если модуль будет на другом сервере, в CRM используй `PULSECAR_LIVE_URL=https://live.pulsecar.tech`.

## Шаг 2. Запустить модуль
```bash
sudo mkdir -p /opt/pulsecar-live && sudo cp -r ./* ./.env.example /opt/pulsecar-live/ && cd /opt/pulsecar-live
cp .env.example .env
# заполнить .env:
#   CRM_API_KEY=$(openssl rand -hex 32)
#   SESSION_SECRET=$(openssl rand -hex 32)
#   ADMIN_PASSWORD=<надёжный, сообщи пользователю — это запасной вход>
#   PUBLIC_URL=https://live.pulsecar.tech   CRM_ORIGIN=https://panel.pulsecar.tech
mkdir -p data && sudo chown 1000:1000 data      # контейнер app работает от пользователя node (uid 1000)
docker compose up -d --build
curl -s 127.0.0.1:3010/healthz                 # → {"ok":true,"go2rtc":true,...}
```

## Шаг 3. Самопроверка на тестовой камере (до подключения настоящих)
```bash
docker compose --profile demo up -d             # тестовая «камера» с картинкой и звуком на 127.0.0.1:18554
docker run --rm --network host -v "$PWD/app:/app" -w /app \
  -e BASE=http://127.0.0.1:3010 -e CRM_ORIGIN=https://panel.pulsecar.tech \
  -e CRM_API_KEY="$(grep ^CRM_API_KEY .env | cut -d= -f2)" -e ADMIN_PASSWORD="$(grep ^ADMIN_PASSWORD .env | cut -d= -f2-)" \
  node:22-alpine node test/e2e.mjs
```
Ожидается «Все проверки пройдены». Строка `SKIP неверный пароль камеры` нормальна: тестовая камера на localhost не проверяет пароль.
**После теста обязательно очистить тестовые данные:** `sh scripts/reset-after-test.sh`.

## Шаг 4. DNS и HTTPS
1. В Hostinger: hPanel → Домены → **pulsecar.tech** → DNS. Добавить `A`-запись `live` → IP этого сервера, TTL 3600. Остальные записи не трогать.
2. nginx: взять `deploy/nginx-live.pulsecar.tech.conf`. Сертификат: `certbot --nginx -d live.pulsecar.tech`. Для Caddy есть `deploy/Caddyfile.example`.
3. Важно для прокси: WebSocket upgrade, `proxy_buffering off`, таймаут чтения не меньше 1 часа, `X-Forwarded-For`.
4. Проверка: `https://live.pulsecar.tech/healthz` и `https://live.pulsecar.tech/admin` (вход по `ADMIN_PASSWORD`).

## Шаг 5. Интеграция в CRM
Готовые файлы лежат в `crm-integration/`, подробности API — в `API.md`.

**Бэкенд CRM:**
1. Переменные `PULSECAR_LIVE_URL=http://127.0.0.1:3010` и `PULSECAR_LIVE_API_KEY=<CRM_API_KEY>`.
2. Эндпоинт `POST /api/live-cameras/embed-url` **за авторизацией CRM**. Он вызывает `POST {PULSECAR_LIVE_URL}/api/v1/embed-sessions` с `{ user: {id, name} текущего пользователя, next }` и возвращает `{url}` (пример в `crm-integration/backend-example.js`, там же вариант на PHP).
3. Необязательно: `GET /api/live-cameras/order/:orderId` для списка активных ссылок по заказу.

**Фронтенд CRM** (подключить `crm-integration/pulsecar-live-embed.js` или переписать его логику в компонент фреймворка CRM):
1. **Пункт меню «Kamery na żywo»** (иконка камеры, рядом с «Przechowalnia i parking» или в конце блока) и страница с `PulsecarLive.mountPanel(el)`. Внутри iframe есть вкладки Linki / Kamery / Ustawienia.
2. **Кнопка «Udostępnij podgląd na żywo»** в карточке **Zlecenia**, и в **Wyceny**, если уместно. Она вызывает `PulsecarLive.openNewLink({ plate, client, car, orderNo, orderId, phone })` с данными из карточки. В `onCreated(link)` можно сохранить `link.url` в заказ, показать его или отправить SMS через CRM, если там есть SMS (`link.smsText`, текст на польском).
3. Необязательно: в карточке заказа список активных ссылок со статусом (`state`) и кнопкой «Kopiuj link».
4. `PulsecarLive.configure({ embedUrlEndpoint: '/api/live-cameras/embed-url', moduleOrigin: 'https://live.pulsecar.tech' })`.
5. Если у CRM есть Content-Security-Policy, добавь `frame-src https://live.pulsecar.tech`.

Почему вход работает внутри iframe: `panel.` и `live.pulsecar.tech` — один сайт, поэтому cookie `SameSite=Lax` передаётся. Если CRM окажется на другом домене, поставь `COOKIE_SAMESITE=None` в `.env` модуля.

Проверка интеграции: в CRM нажать кнопку в заказе → в окне подставлены номер и клиент → «Utwórz link» → CRM получает `link-created` → «Gotowe» закрывает окно. Страница «Kamery na żywo» открывается без повторного входа.

## Шаг 6. Сеть до камер (подготовить, подключать будет пользователь)
Камеры стоят в локальной сети мастерской (тестовая камера пользователя была `192.168.3.20`, сеть `192.168.3.0/24`, но в мастерской сеть может быть другой). Серверу нужен маршрут в эту сеть:
1. На сервере: `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --accept-routes --hostname=pulsecar-server`. Ссылку для входа отдай пользователю.
2. В мастерской нужен **subnet router** Tailscale. Варианты (выбирает пользователь):
   - роутер с поддержкой Tailscale или WireGuard;
   - маленький GL.iNet (Opal/Beryl) с включённым Tailscale;
   - любой постоянно включённый компьютер: `tailscale up --advertise-routes=<сеть мастерской>/24`.

   Затем подтвердить маршрут в админке Tailscale.
3. Проверка с сервера: `nc -vz <IP камеры> 554` должен ответить `succeeded`. После этого камера добавляется в панели и проверяется кнопкой «Sprawdź połączenie».

Если пользователь хочет протестировать раньше, можно временно пробросить порт одной камеры на роутере **только для IP сервера**. Предупреди о рисках и предложи Tailscale.

## Шаг 7. Эксплуатация
- Бэкап: cron раз в сутки копирует `/opt/pulsecar-live/data/db.json` (камеры, ссылки, настройки).
- Логи: `docker compose logs -f --tail=100 app go2rtc`.
- Обновление модуля: заменить файлы, затем `docker compose up -d --build`. Данные хранятся в `data/`.

## Итог для пользователя (кратко, по-русски)
Сообщи: адрес панели и где она в CRM, запасной пароль `ADMIN_PASSWORD`, что сделано по Tailscale и что осталось сделать ему, а также результат самопроверки.
