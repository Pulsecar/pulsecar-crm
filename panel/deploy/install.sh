#!/usr/bin/env bash
# Установка / обновление Pulsecar CRM на VPS.
#   panel.pulsecar.tech     → CRM
#   marketing.pulsecar.tech → панель бота (вход только через CRM)
# Запуск:  bash /root/pulsecar-crm/panel/deploy/install.sh
set -euo pipefail
PANEL="$(cd "$(dirname "$0")/.." && pwd)"
BOT_DIR=/root/autoservice-smm-bot
CADDYFILE="$BOT_DIR/Caddyfile"
CADDY=$(docker ps --format '{{.Names}}' | grep -m1 'autoservice-smm-bot-caddy') || { echo "Не найден контейнер Caddy"; exit 1; }
TS=$(date +%Y%m%d%H%M%S)
cd "$PANEL"

# 1. .env — только при первой установке (дальше не трогаем)
if [ ! -f .env ]; then
  cp .env.example .env
  PW=$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 16)
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|; s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$PW|" .env
  echo "MARKETING_URL=https://marketing.pulsecar.tech" >> .env
  chmod 600 .env
  echo "======================================================"
  echo " Первый вход: https://panel.pulsecar.tech"
  echo " Логин: admin   Пароль: $PW"
  echo " (смените пароль в Настройки → Сотрудники)"
  echo "======================================================"
fi
mkdir -p data

# 2. сборка и запуск
docker compose -f docker-compose.yml -f deploy/compose.vps.yml up -d --build
for i in $(seq 1 30); do
  curl -fsS -o /dev/null http://127.0.0.1:3100/ && break
  sleep 2
  [ "$i" = 30 ] && { echo "CRM не отвечает:"; docker logs --tail 40 pulsecar-panel; exit 1; }
done
echo "CRM запущена."

# 3. Caddy: добавить домены (один раз, с резервной копией)
if grep -q 'pulsecar-panel:3100' "$CADDYFILE"; then
  echo "Caddyfile уже настроен."
else
  cp -p "$CADDYFILE" "$CADDYFILE.bak-$TS"
  echo "Копия: $CADDYFILE.bak-$TS"
  python3 - "$CADDYFILE" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
new = '''panel.pulsecar.tech {
	# OAuth-возвраты YouTube/TikTok/Threads зарегистрированы на этом домене — они по-прежнему идут боту
	@oauth path_regexp oauth (?i)(callback|oauth)
	handle @oauth {
		reverse_proxy bot:8080
	}
	handle {
		reverse_proxy pulsecar-panel:3100
	}
}

# Маркетинговая панель (бот): открывается только после входа в CRM
marketing.pulsecar.tech {
	forward_auth pulsecar-panel:3100 {
		uri /crm-api/auth-check?redirect=1
		copy_headers X-Pulsecar-User
	}
	reverse_proxy bot:8080
	header -X-Frame-Options
	header Content-Security-Policy "frame-ancestors https://panel.pulsecar.tech"
}'''
s2, n = re.subn(r'\{\$ADMIN_PANEL_DOMAIN\}\s*\{\s*reverse_proxy bot:8080\s*\}', new, s, count=1)
if n != 1:
    s2 = s.rstrip() + '\n\n' + new + '\n'
with open(p, 'r+', encoding='utf-8') as f:   # пишем в тот же файл (он примонтирован в контейнер)
    f.seek(0); f.write(s2); f.truncate()
PY
  if ! docker exec "$CADDY" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    echo "Ошибка в Caddyfile — возвращаю копию."
    cat "$CADDYFILE.bak-$TS" > "$CADDYFILE"
    docker exec "$CADDY" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile || true
    exit 1
  fi
fi
docker exec "$CADDY" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
echo "Caddy перезагружен."

# 4. проверка
getent hosts marketing.pulsecar.tech >/dev/null || echo "ВНИМАНИЕ: нет DNS-записи marketing.pulsecar.tech → добавьте A-запись на $(curl -fsS -4 ifconfig.me 2>/dev/null || echo 'IP сервера')"
echo "Готово: https://panel.pulsecar.tech  и  https://marketing.pulsecar.tech"
