import { HOURS } from './data';

/** Текущее время в Варшаве: день недели (0=вс) и часы (дробные). */
function warsawNow(): { day: number; h: number } {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    const h = (parseInt(get('hour'), 10) % 24) + parseInt(get('minute'), 10) / 60;
    if (day >= 0 && !isNaN(h)) return { day, h };
  } catch {}
  return { day: now.getDay(), h: now.getHours() + now.getMinutes() / 60 };
}

export function openStatus(): { open: boolean; closesAt?: number } {
  const { day, h } = warsawNow();
  const hrs = HOURS[day];
  if (hrs && h >= hrs[0] && h < hrs[1]) return { open: true, closesAt: hrs[1] };
  return { open: false };
}

export const todayIndex = () => warsawNow().day;
