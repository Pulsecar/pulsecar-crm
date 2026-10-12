#!/usr/bin/env bash
# Установка / обновление «Pulsecar Live» (Kamery na żywo) на VPS рядом с CRM — по CLAUDE_DEPLOY.md, с учётом этого сервера:
#   прокси — Caddy в контейнере autoservice-smm-bot-caddy, CRM — тоже в контейнере, поэтому модуль слушает не 127.0.0.1,
#   а адрес шлюза docker-сети autoservice-smm-bot_default (снаружи сервера он недоступен).
# Запуск:  bash /root/pulsecar-crm/live/deploy/install.sh        (повторный запуск = обновление, данные и .env сохраняются)
# Откат:   cd /opt/pulsecar-live && docker compose down; Caddyfile и .env CRM — из копий *.bak-<время>
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
CRM_ENV="$(cd "$SRC/.." && pwd)/panel/.env"
DST=/opt/pulsecar-live
NET=autoservice-smm-bot_default
CADDYFILE=/root/autoservice-smm-bot/Caddyfile
CADDY=$(docker ps --format '{{.Names}}' | grep -m1 'autoservice-smm-bot-caddy') || { echo "Не найден контейнер Caddy"; exit 1; }
TS=$(date +%Y%m%d%H%M%S)
hex() { openssl rand -hex 32; }

echo "== 1. Сервер"
. /etc/os-release && echo "ОС: $PRETTY_NAME"; docker --version; docker compose version
GW=$(docker network inspect "$NET" -f '{{(index .IPAM.Config 0).Gateway}}')
BR="br-$(docker network inspect "$NET" -f '{{.Id}}' | cut -c1-12)"
echo "Шлюз сети $NET: $GW ($BR)"
FIRST=1; [ -f "$DST/.env" ] && FIRST=0
if [ $FIRST = 1 ]; then
  for p in 3010 11984 18555; do ss -ltnH "sport = :$p" | grep -q . && { echo "Порт $p занят:"; ss -ltnp "sport = :$p"; exit 1; }; done
  echo "Порты 3010, 11984, 18555 свободны."
fi

echo "== 2. Модуль в $DST"
mkdir -p "$DST"
# код обновляем, а .env, data/ и go2rtc.yaml (туда модуль сам пишет камеры) не трогаем
tar -C "$SRC" --exclude=./.env --exclude=./data --exclude=./go2rtc/go2rtc.yaml --exclude=./selftest.log -cf - . | tar -C "$DST" -xf -
[ -f "$DST/go2rtc/go2rtc.yaml" ] || cp "$SRC/go2rtc/go2rtc.yaml" "$DST/go2rtc/go2rtc.yaml"
cd "$DST"
if [ $FIRST = 1 ]; then
  cp .env.example .env
  sed -i "s|^CRM_API_KEY=.*|CRM_API_KEY=$(hex)|; s|^SESSION_SECRET=.*|SESSION_SECRET=$(hex)|; s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | cut -c1-16)|" .env
  printf '\n# Адрес, на котором слушает модуль (шлюз docker-сети Caddy/CRM)\nAPP_HOST=%s\n' "$GW" >> .env
  chmod 600 .env
  echo "Создан .env (ключи сгенерированы)."
fi
APP_PORT=$(grep '^APP_PORT=' .env | cut -d= -f2); APP_PORT=${APP_PORT:-3010}
BASE="http://$GW:$APP_PORT"
mkdir -p data && chown 1000:1000 data
# контейнеры Caddy и CRM должны достучаться до модуля на хосте
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow in on "$BR" to "$GW" port "$APP_PORT" proto tcp >/dev/null && echo "ufw: разрешён $BR → $GW:$APP_PORT"
fi
docker compose up -d --build
for i in $(seq 1 40); do curl -fsS "$BASE/healthz" >/dev/null 2>&1 && break; sleep 2; [ "$i" = 40 ] && { docker compose logs --tail 40; exit 1; }; done
echo "Модуль: $(curl -fsS "$BASE/healthz")"
docker exec "$CADDY" wget -qO- "$BASE/healthz" >/dev/null && echo "Caddy видит модуль." || { echo "Caddy НЕ видит $BASE — проверь файрвол"; exit 1; }

echo "== 3. Самопроверка (один раз)"
if [ ! -f data/.selftest-ok ]; then
  docker compose --profile demo up -d
  sleep 3
  set +e
  docker run --rm --network host -v "$DST/app:/app" -w /app \
    -e BASE="$BASE" -e CRM_ORIGIN=https://panel.pulsecar.tech \
    -e CRM_API_KEY="$(grep ^CRM_API_KEY .env | cut -d= -f2)" -e ADMIN_PASSWORD="$(grep ^ADMIN_PASSWORD .env | cut -d= -f2-)" \
    node:22-alpine node test/e2e.mjs > selftest.log 2>&1
  RC=$?; set -e
  tail -5 selftest.log
  sh scripts/reset-after-test.sh
  for i in $(seq 1 30); do curl -fsS "$BASE/healthz" >/dev/null 2>&1 && break; sleep 2; done
  [ $RC = 0 ] || { echo "Самопроверка НЕ пройдена (полный лог: $DST/selftest.log)"; exit 1; }
  date > data/.selftest-ok; chown 1000:1000 data/.selftest-ok
  echo "Самопроверка пройдена, тестовые данные удалены."
else echo "Уже пройдена: $(cat data/.selftest-ok)"; fi

echo "== 4. Caddy: live.pulsecar.tech"
if grep -q '^live.pulsecar.tech' "$CADDYFILE"; then echo "Caddyfile уже настроен."; else
  cp -p "$CADDYFILE" "$CADDYFILE.bak-$TS"; echo "Копия Caddyfile: $CADDYFILE.bak-$TS"
  printf '\n# Pulsecar Live (Kamery na żywo)\nlive.pulsecar.tech {\n\treverse_proxy %s:%s {\n\t\theader_up X-Forwarded-For {remote_host}\n\t\tflush_interval -1\n\t}\n\theader Strict-Transport-Security "max-age=31536000"\n}\n' "$GW" "$APP_PORT" >> "$CADDYFILE"
  if ! docker exec "$CADDY" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    echo "Ошибка в Caddyfile — возвращаю копию."; cat "$CADDYFILE.bak-$TS" > "$CADDYFILE"; exit 1
  fi
  docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; echo "Caddy перезагружен."
fi

echo "== 5. CRM: адрес и ключ модуля (только в .env сервера)"
if ! grep -q '^PULSECAR_LIVE_API_KEY=' "$CRM_ENV"; then
  cp -p "$CRM_ENV" "$CRM_ENV.bak-$TS"
  printf '\n# Pulsecar Live (Kamery na żywo)\nPULSECAR_LIVE_URL=%s\nPULSECAR_LIVE_API_KEY=%s\nPULSECAR_LIVE_PUBLIC=https://live.pulsecar.tech\n' "$BASE" "$(grep ^CRM_API_KEY .env | cut -d= -f2)" >> "$CRM_ENV"
  echo "В .env CRM добавлены PULSECAR_LIVE_* (копия: $CRM_ENV.bak-$TS). Нужен перезапуск CRM: bash $(dirname "$CRM_ENV")/deploy/update.sh"
else echo "CRM уже настроена."; fi

echo "== 6. Бэкап db.json раз в сутки"
mkdir -p "$DST/backups"
cat > /etc/cron.d/pulsecar-live-backup <<EOF
# Pulsecar Live: копия камер/ссылок/настроек, хранится 30 дней
20 3 * * * root cp -p $DST/data/db.json $DST/backups/db-\$(date +\\%F).json 2>/dev/null; find $DST/backups -name 'db-*.json' -mtime +30 -delete
EOF
chmod 644 /etc/cron.d/pulsecar-live-backup
echo "Готово. Панель: https://live.pulsecar.tech/admin  (запасной пароль: grep ADMIN_PASSWORD $DST/.env)"
