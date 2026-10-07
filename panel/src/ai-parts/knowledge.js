// Знания по узлам: ИИ один раз проходит типовые работы сервиса (статистика из истории + примеры заказов, без данных клиентов)
// и записывает для каждой работы: какие узлы разбираются, что меняется всегда, какие прокладки / уплотнения / одноразовые болты
// нужны из-за разборки, что часто добавляют, норма часов и цена из вашей истории. Подбор потом опирается на эти записи.
import { all, one, run, withDb, curDb, getSetting, setSetting } from '../db.js';
import { callTool } from './claude.js';
import { trainOnHistory } from './history.js';

const ST = 'ai_parts_distill';
export const distillState = () => { try { return JSON.parse(getSetting(ST) || 'null'); } catch { return null; } };
const save = (st) => setSetting(ST, JSON.stringify(st));

const TOOL = {
  name: 'job_knowledge', description: 'Workshop knowledge per job',
  input_schema: { type: 'object', properties: { jobs: { type: 'array', items: { type: 'object', properties: {
    key: { type: 'string', description: 'job key exactly as given' },
    assemblies: { type: 'array', items: { type: 'string' }, description: 'assemblies that are removed / opened during this job (Polish)' },
    always: { type: 'array', items: { type: 'string' }, description: 'parts always replaced for this job (Polish part names)' },
    seals: { type: 'array', items: { type: 'object', properties: { part: { type: 'string' }, why: { type: 'string' } }, required: ['part'] }, description: 'gaskets / seals / O-rings / one-time bolts / clips needed because of the disassembly, with the reason (Russian)' },
    often: { type: 'array', items: { type: 'string' }, description: 'parts often added (worn together, recommended)' },
    fluids: { type: 'array', items: { type: 'string' } },
    not_parts: { type: 'array', items: { type: 'string' }, description: 'things that are labour/services, never parts' },
    tips: { type: 'string', description: 'short Russian notes for the advisor (checks, variants by engine)' },
  }, required: ['key'] } } }, required: ['jobs'] },
};

const SYSTEM = `You are a senior master mechanic and parts specialist in a car workshop in Warsaw (Pulsecar). You get the workshop's OWN statistics for its typical jobs
(Polish job names from their repair orders, how often each part was replaced together with the job, median hours and price, and a few example orders).
For each job write the practical knowledge an advisor needs to quote it correctly:
- assemblies: which assemblies / covers / pipes are removed or opened to do the job;
- always: parts that are always replaced for this job;
- seals: gaskets, seals, O-rings, one-time (stretch) bolts, clips, crush washers that must be renewed BECAUSE of that disassembly, each with a short Russian reason ("снимается крышка клапанов — прокладка одноразовая");
- often: parts the workshop often adds (from the statistics: share >= 30%) or that are worn together;
- fluids: fluids drained / refilled;
- not_parts: services that must NOT be quoted as parts (cleaning, diagnostics, coding);
- tips: short Russian notes (engine variants, what to check before ordering).
Base it on the workshop statistics first and on solid general automotive knowledge second. Use Polish part names as on Polish invoices. Be concise. Never invent part numbers.`;

let running = false;
/** Выжимка знаний по всем типовым работам (≥ 2 раз в истории); идёт в фоне, состояние — в настройке ai_parts_distill */
export function startDistill({ min = 2, limit = 300 } = {}) {
  if (running) return distillState();
  const d = curDb();
  running = true;
  const st = { state: 'running', done: 0, total: 0, errors: 0, started: new Date().toISOString() };
  withDb(d, () => save(st));
  (async () => {
    try {
      await withDb(d, async () => {
        trainOnHistory();
        const jobs = all(`SELECT p.job_key, p.job_name, p.n, p.price, p.unit, h.hours FROM ai_job_prices p LEFT JOIN ai_job_hours h ON h.job_key = p.job_key
          WHERE p.n >= ? ORDER BY p.n DESC LIMIT ?`, min, limit);
        st.total = jobs.length; save(st);
        for (let i = 0; i < jobs.length; i += 12) {
          const batch = jobs.slice(i, i + 12).map((j) => ({
            key: j.job_key, job: j.job_name, times: j.n, median_hours: j.hours ?? null, median_price_gross: j.price, unit: j.unit,
            parts_with_share: all('SELECT part_name, n, jobs FROM ai_job_parts WHERE job_key = ? ORDER BY n DESC LIMIT 15', j.job_key).map((p) => `${p.part_name} ${Math.round((p.n / p.jobs) * 100)}%`),
            examples: exampleOrders(j.job_key, 3),
          }));
          try {
            const { data } = await callTool({ system: SYSTEM, user: JSON.stringify({ jobs: batch }), tool: TOOL, maxTokens: 8000, timeout: 180_000 });
            for (const k of data.jobs || []) {
              const src = batch.find((b) => b.key === k.key);
              if (!src) continue;
              const { key, ...rest } = k;
              run(`INSERT INTO ai_knowledge (job_key, job_name, data, updated_at) VALUES (?,?,?,datetime('now'))
                ON CONFLICT(job_key) DO UPDATE SET job_name = excluded.job_name, data = excluded.data, updated_at = excluded.updated_at`, key, src.job, JSON.stringify(rest));
            }
          } catch (e) { st.errors++; st.lastError = String(e.message || e).slice(0, 200); }
          st.done = Math.min(jobs.length, i + 12); save(st);
        }
        st.state = 'done'; st.finished = new Date().toISOString(); st.knowledge = one('SELECT COUNT(*) n FROM ai_knowledge').n; save(st);
      });
    } catch (e) {
      withDb(d, () => save({ ...st, state: 'error', lastError: String(e.message || e).slice(0, 200) }));
    } finally { running = false; }
  })();
  return st;
}

/** Примеры заказов с этой работой: только работы и детали (без клиентов, номеров, цен) */
function exampleOrders(jk, n) {
  const words = jk.split(' ').filter((w) => w.length > 4 && w !== 'wymiana').slice(0, 3);
  if (!words.length) return [];
  let rows = [];
  try {
    rows = all(`SELECT h.make, h.model, h.engine, h.items FROM ai_history_fts f JOIN ai_history h ON h.order_id = f.rowid
      WHERE ai_history_fts MATCH ? ORDER BY h.order_id DESC LIMIT ?`, words.map((w) => `work:${w.slice(0, 7)}*`).join(' AND '), n);
  } catch { return []; }
  return rows.map((r) => { const it = JSON.parse(r.items || '{}'); return { car: [r.make, r.model, r.engine].filter(Boolean).join(' '), work: (it.labor || []).map((l) => l[0]).slice(0, 6), parts: (it.parts || []).map((p) => p[0]).slice(0, 15) }; });
}
