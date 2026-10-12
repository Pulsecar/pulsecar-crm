'use strict';
// Расписание доступа. Время всегда по Варшаве, независимо от часового пояса сервера.
// weekly = { mon: ['08:00','18:00'], ..., sun: null }  или  null = круглосуточно.
const TZ = 'Europe/Warsaw';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const PL = { mon: 'pn', tue: 'wt', wed: 'śr', thu: 'czw', fri: 'pt', sat: 'sob', sun: 'nd' };
const WD = { Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun' };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const STEP = 5 * 60e3;

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
});
function local(d) {
  const o = {};
  for (const p of parts.formatToParts(d)) o[p.type] = p.value;
  return { date: `${o.year}-${o.month}-${o.day}`, day: WD[o.weekday], min: Number(o.hour) * 60 + Number(o.minute) };
}
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

function isOpen(weekly, closedDates, d = new Date()) {
  if (!weekly) return true;
  const l = local(d);
  if ((closedDates || []).includes(l.date)) return false;
  const w = weekly[l.day];
  return !!w && l.min >= toMin(w[0]) && l.min < toMin(w[1]);
}

// Ближайший момент, когда доступ откроется (шаг 5 минут), не позже limit.
function nextOpen(weekly, closedDates, from, limit) {
  let t = Math.ceil(from.getTime() / STEP) * STEP;
  const end = Math.min(limit ? limit.getTime() : Infinity, from.getTime() + 15 * 864e5);
  for (; t <= end; t += STEP) if (isOpen(weekly, closedDates, new Date(t))) return new Date(t);
  return null;
}

// Проверка и нормализация расписания из запроса. Возвращает {value} или {error}.
function parseWeekly(v) {
  if (v === null) return { value: null };
  if (!v || typeof v !== 'object') return { error: 'Nieprawidłowe godziny dostępu' };
  const out = {};
  let any = false;
  for (const d of DAYS) {
    const w = v[d];
    if (w === null || w === undefined || w === false) { out[d] = null; continue; }
    if (!Array.isArray(w) || !TIME.test(w[0]) || !TIME.test(w[1]) || w[0] >= w[1]) {
      return { error: `Godziny dla dnia „${PL[d]}”: podaj czas w formacie GG:MM, początek przed końcem` };
    }
    out[d] = [w[0], w[1]]; any = true;
  }
  if (!any) return { error: 'Wybierz co najmniej jeden dzień dostępu' };
  return { value: out };
}

// «pn–pt 08:00–18:00, sob 09:00–14:00»
function text(weekly) {
  if (!weekly) return 'całą dobę';
  const groups = [];
  DAYS.forEach((d, i) => {
    const w = weekly[d];
    if (!w) return;
    const v = `${w[0]}–${w[1]}`;
    const g = groups[groups.length - 1];
    if (g && g.v === v && g.last === i - 1) { g.to = d; g.last = i; } else groups.push({ from: d, to: d, v, last: i });
  });
  return groups.map((g) => `${g.from === g.to ? PL[g.from] : PL[g.from] + '–' + PL[g.to]} ${g.v}`).join(', ');
}

const fmtPL = new Intl.DateTimeFormat('pl-PL', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dt = (iso) => fmtPL.format(new Date(iso)).replace(',', '');

module.exports = { TZ, DAYS, isOpen, nextOpen, parseWeekly, text, dt };
