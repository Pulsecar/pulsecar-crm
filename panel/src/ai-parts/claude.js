// Claude для ИИ-запчастиста: тот же ключ, что у AI-ассистента сайта (Интеграции → AI-ассистент), модель — из настроек модуля.
import { getSetting } from '../db.js';
import { HttpError } from '../util.js';
import { cfg } from '../integrations/index.js';

const URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages';
export const DEFAULT_MODEL = 'claude-sonnet-5';
export const aiModel = () => getSetting('ai_parts_model') || DEFAULT_MODEL;

export function claudeConf() {
  const c = cfg('assistant', { ignoreEnabled: true });
  if (!c?.apiKey) throw new HttpError(400, 'Нет ключа Claude API: Настройки → Интеграции → AI-ассистент на сайте.');
  return c;
}

/** Один вызов с обязательным инструментом → структурированный ответ (input инструмента) + расход токенов */
export async function callTool({ system, user, tool, maxTokens = 8000, timeout = 150_000 }) {
  const c = claudeConf();
  const headers = { 'content-type': 'application/json', 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01',
    ...(String(c.workspaceId || '').trim() ? { 'anthropic-workspace-id': String(c.workspaceId).trim() } : {}) };
  let last;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(URL, {
        method: 'POST', headers, signal: AbortSignal.timeout(timeout),
        body: JSON.stringify({ model: aiModel(), max_tokens: maxTokens, system, tools: [tool], tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content: user }] }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 429 || r.status >= 500) { last = new Error(`Claude API ${r.status}`); await new Promise((x) => setTimeout(x, 3000 * (a + 1))); continue; }
      if (!r.ok) throw new HttpError(502, `Claude API ${r.status}: ${j.error?.message || 'ошибка'}`);
      const block = (j.content || []).find((b) => b.type === 'tool_use');
      if (!block) throw new HttpError(502, 'Claude не вернул результат');
      // модель иногда оборачивает ответ ещё раз: { <имя инструмента>: {...} } или кладёт его строкой JSON
      let data = block.input || {};
      const keys = Object.keys(data);
      if (keys.length === 1 && (keys[0] === tool.name || !(keys[0] in (tool.input_schema?.properties || {})))) {
        let v = data[keys[0]];
        if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
        if (v && typeof v === 'object' && !Array.isArray(v)) data = v;
      }
      return { data, usage: j.usage || {}, stop: j.stop_reason || null };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      last = e;
    }
  }
  throw new HttpError(502, 'Claude не ответил: ' + (last?.message || 'таймаут'));
}
