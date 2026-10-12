#!/usr/bin/env bash
# Установка / обновление модуля «ИИ-запчастист» на VPS рядом с CRM.
#   https://ai-parts.pulsecar.tech → контейнер pulsecar-ai-parts:3200 (через общий Caddy autoservice-smm-bot)
# Запуск:  bash /root/pulsecar-crm/ai-parts/deploy/install.sh
# Откат:   cd /root/pulsecar-crm/ai-parts/service && docker compose down
#          + вернуть Caddyfile из копии (Caddyfile.bak-…) и выключить «ИИ-запчастист (сервис)» в настройках CRM
set -euo pipefail
SVC="$(cd "$(dirname "$0")/../service" && pwd)"
CRM_ENV="$(cd "$(dirname "$0")/../.." && pwd)/panel/.env"
CADDYFILE=/root/autoservice-smm-bot/Caddyfile
CADDY=$(docker ps --format '{{.Names}}' | grep -m1 'autoservice-smm-bot-caddy') || { echo "Не найден контейнер Caddy"; exit 1; }
TS=$(date +%Y%m%d%H%M%S)
gen() { openssl rand -base64 32 | tr -d '\n'; }
cd "$SVC"

# 1. .env модуля — только при первой установке; секреты генерируются здесь и в git не попадают
if [ ! -f .env ]; then
  SECRET=$(openssl rand -hex 32)
  cat > .env <<EOF
PORT=3200
DB_PATH=/app/data/ai-parts.db
MASTER_KEY=$(gen)
CRM_SHARED_SECRET=$SECRET
CORS_ORIGINS=https://panel.pulsecar.tech
ANTHROPIC_API_KEY=
EOF
  chmod 600 .env
  echo "Создан .env модуля (секреты сгенерированы)."
fi
SECRET=$(grep '^CRM_SHARED_SECRET=' .env | cut -d= -f2-)

# 2. CRM: адрес модуля и тот же секрет токенов (если ещё нет)
if ! grep -q '^AI_PARTS_SECRET=' "$CRM_ENV"; then
  cp -p "$CRM_ENV" "$CRM_ENV.bak-$TS"
  printf '\n# ИИ-запчастист (сервис)\nAI_PARTS_URL=https://ai-parts.pulsecar.tech\nAI_PARTS_INTERNAL_URL=http://pulsecar-ai-parts:3200\nAI_PARTS_SECRET=%s\n' "$SECRET" >> "$CRM_ENV"
  echo "В .env CRM добавлены AI_PARTS_* (копия: $CRM_ENV.bak-$TS)."
fi

# 3. docker-compose.yml: как в примере + общая сеть с Caddy и CRM
cat > docker-compose.yml <<'EOF'
services:
  ai-parts:
    build: .
    container_name: pulsecar-ai-parts
    restart: unless-stopped
    env_file: .env
    environment:
      DB_PATH: /app/data/ai-parts.db
    ports:
      - "127.0.0.1:3200:3200"
    volumes:
      - ai-parts-data:/app/data
    networks: [default, edge]
volumes:
  ai-parts-data:
networks:
  edge:
    external: true
    name: autoservice-smm-bot_default
EOF
docker compose up -d --build
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:3200/health >/dev/null 2>&1 && break
  sleep 2
  [ "$i" = 30 ] && { echo "Модуль не отвечает:"; docker logs --tail 40 pulsecar-ai-parts; exit 1; }
done
echo "Модуль запущен: $(curl -fsS http://127.0.0.1:3200/health)"

# 4. Caddy: домен модуля (один раз, с копией и проверкой)
if grep -q 'pulsecar-ai-parts:3200' "$CADDYFILE"; then
  echo "Caddyfile уже настроен."
else
  cp -p "$CADDYFILE" "$CADDYFILE.bak-$TS"
  echo "Копия Caddyfile: $CADDYFILE.bak-$TS"
  printf '\n# ИИ-запчастист (модуль CRM)\nai-parts.pulsecar.tech {\n\treverse_proxy pulsecar-ai-parts:3200\n}\n' >> "$CADDYFILE"
  if ! docker exec "$CADDY" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    echo "Ошибка в Caddyfile — возвращаю копию."
    cat "$CADDYFILE.bak-$TS" > "$CADDYFILE"
    exit 1
  fi
  docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  echo "Caddy перезагружен."
fi
echo "Готово: https://ai-parts.pulsecar.tech/health"
echo "Каталог Inter Cars (CSV) — когда будут логин/пароль: cron 45 5 * * * docker exec pulsecar-ai-parts node scripts/import-ic-csv.js --ws main --url <URL>"
