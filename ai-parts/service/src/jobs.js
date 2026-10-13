// Задачи подбора: создание, асинхронный запуск, пауза на вопрос, продолжение, статус.
import { getDb, newId, bumpUsage, monthUsage } from './db.js';
import { runAgent } from './agent/runAgent.js';
import { getIntegration } from './integrations.js';

const running = new Set();

function update(id, fields) {
  const keys = Object.keys(fields);
  const sql = `UPDATE jobs SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`;
  getDb().prepare(sql).run({ ...fields, id });
}

export function getJob(id, workshopId) {
  const r = getDb().prepare('SELECT * FROM jobs WHERE id = ? AND workshop_id = ?').get(id, workshopId);
  if (!r) return null;
  return {
    id: r.id,
    wycenaId: r.wycena_id,
    status: r.status,
    input: JSON.parse(r.input_json),
    steps: JSON.parse(r.steps_json),
    question: r.question_json ? JSON.parse(r.question_json) : null,
    result: r.result_json ? JSON.parse(r.result_json) : null,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listJobsForWycena(workshopId, wycenaId) {
  return getDb()
    .prepare(`SELECT id, status, input_json, created_at, user_id FROM jobs WHERE workshop_id = ? AND wycena_id = ? ORDER BY created_at DESC LIMIT 20`)
    .all(workshopId, wycenaId)
    .map((r) => {
      const inp = JSON.parse(r.input_json);
      return { id: r.id, status: r.status, text: inp.text, createdAt: r.created_at, userId: r.user_id };
    });
}

function addStep(id, text) {
  const r = getDb().prepare('SELECT steps_json FROM jobs WHERE id = ?').get(id);
  if (!r) return;
  const steps = JSON.parse(r.steps_json);
  steps.push({ at: new Date().toISOString(), text });
  update(id, { steps_json: JSON.stringify(steps.slice(-200)) });
}

export function createJob(workshopId, userId, input) {
  const ws = getDb().prepare('SELECT * FROM workshops WHERE id = ?').get(workshopId);
  if (ws && !ws.enabled) throw Object.assign(new Error('Модуль выключен для этого автосервиса'), { status: 403 });
  const usage = monthUsage(workshopId);
  if (ws && usage.jobs >= ws.monthly_limit)
    throw Object.assign(new Error(`Достигнут месячный лимит подборов (${ws.monthly_limit})`), { status: 429 });
  if (!input?.vehicle?.vin) throw Object.assign(new Error('В wycenie нет VIN — добавьте VIN'), { status: 400 });
  if (!input.text || !String(input.text).trim()) throw Object.assign(new Error('Опишите, что нужно подобрать'), { status: 400 });
  const id = newId('job');
  getDb()
    .prepare('INSERT INTO jobs (id, workshop_id, wycena_id, user_id, input_json) VALUES (?, ?, ?, ?, ?)')
    .run(id, workshopId, input.wycenaId || null, userId || null, JSON.stringify(input));
  bumpUsage(workshopId, { jobs: 1 });
  return id;
}

export function startJob(workshopId, id, { answer = null, fetchImpl } = {}) {
  if (running.has(id)) return;
  running.add(id);
  (async () => {
    const r = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    const input = JSON.parse(r.input_json);
    const saved = r.messages_json ? JSON.parse(r.messages_json) : null;
    update(id, { status: 'running', error: null });
    addStep(id, answer ? 'Продолжаю с ответом менеджера' : 'Начинаю подбор');
    try {
      const out = await runAgent({
        workshopId,
        jobId: id,
        input,
        messages: saved?.messages || [],
        pending: answer !== null ? saved?.pending : null,
        answer,
        step: (t) => addStep(id, t),
        fetchImpl,
      });
      const now = getDb().prepare('SELECT status FROM jobs WHERE id = ?').get(id);
      if (now?.status === 'cancelled') return;
      if (out.status === 'done') {
        update(id, { status: 'done', result_json: JSON.stringify(out.result), messages_json: null, question_json: null });
        addStep(id, `Готово: позиций — ${out.result.items.length}`);
        notifyTelegram(workshopId, `ИИ-запчастист: подбор для wyceny ${input.wycenaId || ''} готов (${out.result.items.length} поз.)`);
      } else if (out.status === 'needs_input') {
        update(id, {
          status: 'needs_input',
          question_json: JSON.stringify(out.question),
          messages_json: JSON.stringify({ messages: out.messages, pending: out.pending }),
        });
        notifyTelegram(workshopId, `ИИ-запчастист ждёт ответа по wycenie ${input.wycenaId || ''}: ${out.question.question}`);
      }
    } catch (e) {
      update(id, { status: 'error', error: String(e.message || e) });
      addStep(id, 'Ошибка: ' + (e.message || e));
    } finally {
      running.delete(id);
    }
  })();
}

export function answerJob(workshopId, id, answer) {
  const job = getJob(id, workshopId);
  if (!job) throw Object.assign(new Error('Задача не найдена'), { status: 404 });
  if (job.status !== 'needs_input') throw Object.assign(new Error('Задача не ждёт ответа'), { status: 409 });
  update(id, { question_json: null });
  startJob(workshopId, id, { answer: String(answer) });
}

export function cancelJob(workshopId, id) {
  const job = getJob(id, workshopId);
  if (!job) throw Object.assign(new Error('Задача не найдена'), { status: 404 });
  update(id, { status: 'cancelled' });
}

async function notifyTelegram(workshopId, text) {
  try {
    const tg = getIntegration(workshopId, 'telegram');
    if (!tg.enabled || !tg.values.bot_token || !tg.values.chat_id) return;
    await fetch(`https://api.telegram.org/bot${tg.values.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tg.values.chat_id, text }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    /* уведомления не критичны */
  }
}

// Вход для дополнительного подбора: то же авто, уже подобранное не повторять, только то, что следует из ответа менеджера
export function followupInput(prev, answer) {
  const r = prev.result || {};
  const done = (r.items || []).map((it) => {
    const o = it.offers?.[it.chosenLevel];
    return `- ${it.name} × ${it.quantity} ${it.unit || ''}${it.oeNumber ? ' (OE ' + it.oeNumber + ')' : ''}${o ? ' — ' + o.brand + ' ' + o.articleNumber : ''}`;
  });
  const text = `Дополнение к уже сделанному подбору для этого же авто.
Исходный запрос: ${prev.input.text}
Уже подобрано (НЕ повторять):
${done.join('\n') || '—'}
${r.questions?.length ? 'Оставались вопросы: ' + r.questions.join(' · ') + '\n' : ''}Ответ менеджера: ${answer}

Подбери ТОЛЬКО дополнительные позиции, которые следуют из ответа менеджера (масло, фильтры, прокладки, крепёж и т. п.), по тем же правилам.`;
  return {
    ...prev.input,
    text,
    note: [r.vehicle?.summary ? 'Авто уже определено в прошлом подборе: ' + r.vehicle.summary : '', prev.input.note || ''].filter(Boolean).join('\n') || undefined,
    existingItems: [...(prev.input.existingItems || []), ...(r.items || []).map((it) => ({ name: it.name, oeNumber: it.oeNumber || null }))],
    followupOf: prev.id,
  };
}

