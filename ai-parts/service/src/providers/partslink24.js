// partslink24 через расширение Chrome менеджера.
//
// Принципы (обсуждены и согласованы):
//  - расширение работает в УЖЕ залогиненной сессии менеджера; логин/пароль не хранятся и не передаются;
//  - запуск только из подбора по кнопке в wycenie, один VIN — один конкретный ремонт;
//  - человеческий темп (паузы 1.5–3 с), одна вкладка, без массовых запросов;
//  - берём только OE-номера/количество для запрошенных деталей; каталог, схемы, картинки не сохраняем;
//  - капча / незнакомый экран / нет сессии — остановка и сообщение менеджеру.
//
// Схема: агент создаёт задачу → расширение забирает её (poll) → на каждом шаге присылает
// текстовый «снимок» страницы → сервис (Claude-навигатор) решает следующее действие →
// расширение выполняет → … → extract (найденные строки) → done.
import { getDb, newId } from '../db.js';

export const PL24_MAX_STEPS = 45;

export function createTask(workshopId, jobId, payload) {
  const id = newId('pl24');
  getDb()
    .prepare('INSERT INTO pl24_tasks (id, workshop_id, job_id, payload_json) VALUES (?, ?, ?, ?)')
    .run(id, workshopId, jobId, JSON.stringify(payload));
  return id;
}

export function getTask(id) {
  const r = getDb().prepare('SELECT * FROM pl24_tasks WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, payload: JSON.parse(r.payload_json), result: r.result_json ? JSON.parse(r.result_json) : null, log: JSON.parse(r.log_json) };
}

// Расширение забирает следующую задачу своего автосервиса.
export function claimNext(workshopId) {
  const d = getDb();
  // зависшие (>10 мин) задачи помечаем как проваленные
  d.prepare(
    `UPDATE pl24_tasks SET status='failed', result_json=?, finished_at=datetime('now')
     WHERE workshop_id=? AND status='taken' AND taken_at < datetime('now','-10 minutes')`
  ).run(JSON.stringify({ error: 'timeout_in_extension' }), workshopId);
  const r = d
    .prepare(`SELECT id FROM pl24_tasks WHERE workshop_id=? AND status='pending' ORDER BY created_at LIMIT 1`)
    .get(workshopId);
  if (!r) return null;
  const upd = d
    .prepare(`UPDATE pl24_tasks SET status='taken', taken_at=datetime('now') WHERE id=? AND status='pending'`)
    .run(r.id);
  if (!upd.changes) return null;
  return getTask(r.id);
}

export function appendLog(id, entry) {
  const t = getTask(id);
  if (!t) return;
  const log = t.log;
  log.push({ at: new Date().toISOString(), ...entry });
  getDb().prepare('UPDATE pl24_tasks SET log_json=? WHERE id=?').run(JSON.stringify(log.slice(-80)), id);
}

export function finishTask(id, status, result) {
  getDb()
    .prepare(`UPDATE pl24_tasks SET status=?, result_json=?, finished_at=datetime('now') WHERE id=?`)
    .run(status, JSON.stringify(result ?? null), id);
}

export async function waitForTask(id, timeoutSec, onTick) {
  const until = Date.now() + timeoutSec * 1000;
  let lastStatus = null;
  while (Date.now() < until) {
    const t = getTask(id);
    if (!t) return { status: 'missing' };
    if (t.status !== lastStatus) {
      lastStatus = t.status;
      onTick?.(t.status);
    }
    if (t.status === 'done' || t.status === 'failed') return { status: t.status, result: t.result };
    await new Promise((r) => setTimeout(r, 2000));
  }
  const t = getTask(id);
  if (t && t.status === 'pending') {
    finishTask(id, 'failed', { error: 'extension_not_connected' });
    return { status: 'failed', result: { error: 'extension_not_connected', hint: 'Расширение partslink24 не забрало задачу: не установлено, Chrome закрыт или менеджер не залогинен.' } };
  }
  return { status: 'timeout', result: t?.result || null };
}

// ---------- Навигатор: решает следующий шаг по снимку страницы ----------

export const NAVIGATOR_SYSTEM = `Ты управляешь браузером в каталоге partslink24 от имени менеджера автосервиса.
Цель: по VIN найти ОРИГИНАЛЬНЫЕ номера (OE) запрошенных деталей с учётом заводской комплектации этого VIN.

Тебе приходит текстовый снимок страницы: список элементов вида [id] тип "текст", поля ввода, фрагменты таблиц.
Ответь ОДНИМ JSON-объектом без пояснений:
{"action":"click","id":"<id>","why":"..."}
{"action":"type","id":"<id>","text":"...","submit":true|false,"why":"..."}
{"action":"extract","rows":[{"part":"<какая из запрошенных деталей>","oe":"<номер как в каталоге>","qty":"<кол-во>","name":"<название в каталоге>","note":"<применимость/примечание/коды опций>"}],"vehicle":{"model":"...","options":["коды опций, если видны"]},"why":"..."}
{"action":"back","why":"..."}
{"action":"done","why":"..."}
{"action":"fail","reason":"login_required|captcha|not_found|unknown_screen|other","why":"..."}

Правила:
- Сначала выбери марку (если нужно), введи VIN в поле поиска по VIN.
- Если каталог показывает данные автомобиля / список опций (SA-коды, PR-коды и т.п.) — выпиши их в extract.vehicle.options.
- Ищи нужные группы деталей по названиям (тормоза, ГРМ, фильтры, подвеска…), открывай схему/список, выписывай строки.
- Если на странице несколько вариантов детали — выпиши ВСЕ варианты с примечаниями о применимости; не выбирай наугад.
- Предпочитай варианты, которые каталог пометил как подходящие к этому VIN.
- Можно делать extract несколько раз (по мере нахождения деталей), затем done.
- Видишь форму входа — fail login_required. Видишь капчу — fail captcha. Ничего не понятно — fail unknown_screen.
- Не скачивай файлы, не заказывай, не меняй настройки аккаунта, не нажимай «купить/заказать/корзина».`;

export function buildNavigatorUserMessage(task, snapshot) {
  const p = task.payload;
  const recent = (task.log || []).filter((l) => l.kind === 'action').slice(-10).map((l) => `- ${l.action}${l.id ? ' ' + l.id : ''}${l.text ? ' "' + l.text + '"' : ''}${l.why ? ' (' + l.why + ')' : ''}`).join('\n');
  const found = (task.log || []).filter((l) => l.kind === 'extract').flatMap((l) => l.rows || []);
  return `VIN: ${p.vin}
Марка (подсказка): ${p.make || 'неизвестно'}
Нужно найти: ${p.parts.map((x) => `\n- ${x.name}${x.hint ? ' — ' + x.hint : ''}`).join('')}
Уже найдено строк: ${found.length ? found.map((r) => `${r.part}: ${r.oe}`).join('; ') : 'нет'}
Предыдущие шаги:\n${recent || '- нет'}

Снимок страницы (URL: ${snapshot.url}, заголовок: ${snapshot.title}):
${String(snapshot.text || '').slice(0, 24000)}`;
}

export function parseNavigatorAnswer(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return { action: 'fail', reason: 'other', why: 'Навигатор вернул не JSON' };
  try {
    const j = JSON.parse(m[0]);
    if (!j.action) return { action: 'fail', reason: 'other', why: 'Нет поля action' };
    return j;
  } catch {
    return { action: 'fail', reason: 'other', why: 'Ошибка разбора JSON' };
  }
}
