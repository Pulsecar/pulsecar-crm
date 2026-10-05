// Свободные окна для онлайн-записи из сервисной книжки (pulsecar.pl/moje-auto):
// работа длиной N минут (время из рекомендации) ставится на любой свободный пост в часы работы сервиса.
import { all, one, getSetting } from './db.js';
import { cfg } from './integrations/index.js';
import { localShift } from './integrations/jobs.js';

const STEP = 30; // шаг начала записи, минут
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const weekday = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const addMin = (stamp, n) => { const [d, t] = stamp.split(' '); const m = toMin(t) + n; return `${addDays(d, Math.floor(m / 1440))} ${toTime(((m % 1440) + 1440) % 1440)}`; };

function workHours() { try { return JSON.parse(getSetting('work_hours', '') || '{}'); } catch { return {}; } }
function options() {
  const a = cfg('assistant') || {};
  return {
    minHoursAhead: Math.max(0, Number(a.minHoursAhead ?? 2)),
    daysAhead: Math.min(60, Math.max(1, Number(a.daysAhead) || 14)),
    closed: String(a.closedDates || '').split(/[,\s]+/).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
  };
}

/** Посты для работы: кондиционер — только на посту кондиционера, остальное — на подъёмниках */
export function stationsFor(title) {
  const list = all('SELECT id, name FROM stations WHERE active = 1 ORDER BY pos, id');
  const isAc = (s) => /кондиц|klima|a\/c|ac\b/i.test(s);
  const want = isAc(String(title || '')) ? list.filter((s) => isAc(s.name)) : list.filter((s) => !isAc(s.name));
  return want.length ? want : list;
}

/** Пост свободен на [start, start+duration): нет пересекающихся записей на нём (и общих блокировок без поста) */
function stationFree(stationId, start, duration) {
  const end = addMin(start, duration);
  return !one(`SELECT 1 FROM appointments WHERE start_at IS NOT NULL AND status NOT IN ('cancelled','no_show')
    AND (station_id = ? OR station_id IS NULL) AND start_at < ? AND datetime(start_at, '+' || duration_min || ' minutes') > datetime(?) LIMIT 1`, stationId, end, start);
}

function dayStarts(ymd, duration, o) {
  if (o.closed.includes(ymd)) return [];
  const h = workHours()[String(weekday(ymd))];
  if (!Array.isArray(h) || !h[0] || !h[1]) return [];
  const out = [];
  for (let t = toMin(h[0]); t + duration <= toMin(h[1]); t += STEP) out.push(toTime(t));
  return out;
}

/** Окна по дням: [{ date, times: ['09:00', …] }] — только те, где есть свободный пост на всё время работы */
export function freeWindows(durationMin, title, { days } = {}) {
  const o = options();
  const duration = Math.max(15, Number(durationMin) || 60);
  const stations = stationsFor(title);
  const today = localShift(0).slice(0, 10);
  const minStamp = localShift(o.minHoursAhead * 60);
  const out = [];
  const n = Math.min(Number(days) || o.daysAhead, o.daysAhead);
  for (let i = 0; i <= n; i++) {
    const d = addDays(today, i);
    const times = dayStarts(d, duration, o).filter((t) => `${d} ${t}` >= minStamp && stations.some((s) => stationFree(s.id, `${d} ${t}`, duration)));
    if (times.length) out.push({ date: d, weekday: weekday(d), times });
  }
  return out;
}

/** Свободный пост на конкретное время (или null, если окно уже занято / вне часов работы) */
export function pickStation(durationMin, title, start) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(start || '')) return null;
  const o = options();
  const duration = Math.max(15, Number(durationMin) || 60);
  const [d, t] = start.split(' ');
  if (d > addDays(localShift(0).slice(0, 10), o.daysAhead) || start < localShift(o.minHoursAhead * 60)) return null;
  if (!dayStarts(d, duration, o).includes(t)) return null;
  return stationsFor(title).find((s) => stationFree(s.id, start, duration)) || null;
}
