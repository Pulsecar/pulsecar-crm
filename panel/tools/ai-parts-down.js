// Откат модуля «ИИ-запчастист» в базе: выключить модуль и удалить только его таблицы ai_* во всех сервисах.
// Позиции, которые ИИ уже добавил в выцены, остаются обычными позициями. Перед запуском — бэкап базы.
//   docker compose exec -T panel node tools/ai-parts-down.js --yes
import { forEachDb } from '../src/branches.js';
import { db, run } from '../src/db.js';
if (!process.argv.includes('--yes')) { console.error('Удалит таблицы ai_* (история подборов, правила). Запустите с --yes'); process.exit(1); }
await forEachDb(() => {
  run("UPDATE settings SET value = '0' WHERE key = 'ai_parts_enabled'");
  for (const t of ['ai_history_fts', 'ai_history', 'ai_verified', 'ai_events', 'ai_lines', 'ai_jobs', 'ai_rules', 'ai_kits']) db.exec(`DROP TABLE IF EXISTS ${t}`);
});
console.log('Таблицы ai_* удалены, модуль выключен. Чтобы они не создались снова — откатите код (git revert) и выполните deploy/update.sh');
