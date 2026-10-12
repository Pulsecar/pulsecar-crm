#!/bin/sh
# Сброс после самопроверки: удаляет тестовые камеры/ссылки и тестовую камеру.
# Запускать из папки модуля: sh scripts/reset-after-test.sh
set -e
cd "$(dirname "$0")/.."
docker compose --profile demo down
rm -f data/db.json data/db.json.tmp
cat > go2rtc/go2rtc.yaml <<'EOF'
# go2rtc — видеосервер модуля. Доступен только локально; камеры сюда добавляет модуль (раздел streams).
api:
  listen: "127.0.0.1:11984"
rtsp:
  listen: "127.0.0.1:18555"     # внутренний: через него ffmpeg передаёт видео без звука (наружу не открыт)
webrtc:
  listen: ""
# streams: — раздел добавит сам модуль при подключении камер
EOF
docker compose up -d
echo "Готово: база очищена, модуль запущен без тестовых данных."
