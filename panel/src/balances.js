// Остатки в шапке CRM (как в Motowarsztat): сколько SMS осталось и сколько авто можно найти по номеру.
// Где у сервиса есть API баланса — берём оттуда (SMSAPI, SerwerSMS); где нет (RegCheck и др.) —
// считаем сами: остаток, который вписали вручную, минус использовано с того момента.
import { all, one, run, getSetting, setSetting } from './db.js';
import { cfg } from './integrations/index.js';
import { activeProvider, smsParts } from './sms.js';

let cache = null, cacheAt = 0;
export const resetBalances = () => { cache = null; };

db_init();
function db_init() {
  run(`CREATE TABLE IF NOT EXISTS usage_log (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))`);
}
/** Отметить расход (например, поиск авто по номеру в RegCheck) */
export const logUsage = (kind, ref) => run('INSERT INTO usage_log (kind, ref) VALUES (?, ?)', kind, ref || null);

function manual(kind) {
  const n = getSetting(`bal_${kind}`, '');
  if (n === '' || n === null) return null;
  const at = getSetting(`bal_${kind}_at`, '1970-01-01 00:00:00');
  let used = 0;
  if (kind === 'sms') for (const r of all(`SELECT text FROM sms_log WHERE status = 'sent' AND created_at >= ?`, at)) used += smsParts(r.text);
  else used = one('SELECT COUNT(*) n FROM usage_log WHERE kind = ? AND at >= ?', kind, at).n;
  return { count: Math.max(0, Number(n) - used), used, since: at, manual: true };
}
export function setManual(kind, count) {
  if (!['sms', 'plate'].includes(kind)) return;
  setSetting(`bal_${kind}`, count === '' || count === null || count === undefined ? '' : String(Math.max(0, Math.round(Number(count) || 0))));
  setSetting(`bal_${kind}_at`, new Date().toISOString().slice(0, 19).replace('T', ' '));
  cache = null;
}

async function smsBalance() {
  const p = activeProvider();
  if (!p) return null;
  const c = cfg(p) || {};
  const base = { provider: p };
  try {
    if (p === 'smsgate') return { ...base, unlimited: true, note: 'SMS с вашей SIM — по тарифу оператора' };
    if (p === 'smsapi') {
      const r = await fetch(process.env.SMSAPI_PROFILE || 'https://api.smsapi.pl/profile', { headers: { Authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(8000) });
      const b = await r.json();
      if (r.ok && b.points !== undefined) {
        const price = Number(String(getSetting('sms_price', '0.17')).replace(',', '.')) || 0.17;
        return { ...base, count: Math.floor(Number(b.points) / price), points: Number(b.points), note: `${Number(b.points).toFixed(2)} pkt ÷ ${price} за SMS` };
      }
    }
    if (p === 'serwersms') {
      const r = await fetch((process.env.SERWERSMS_BASE || 'https://api2.serwersms.pl') + '/account/limits.json', {
        method: 'POST', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(8000) });
      const b = await r.json();
      const items = b.items || [];
      const it = items.find((i) => (c.sender ? /full/i : /eco/i).test(i.type)) || items[0];
      if (r.ok && it) return { ...base, count: Math.floor(Number(it.value) || 0), note: items.map((i) => `${i.type}: ${i.value}`).join(', ') };
    }
  } catch {}
  const m = manual('sms');
  return m ? { ...base, ...m } : { ...base, unknown: true };
}

function plateBalance() {
  const c = cfg('plate');
  if (!c) return null;
  const m = manual('plate');
  const empty = getSetting('bal_plate_empty', '') === '1';
  if (m) return { provider: c.provider || 'regcheck', ...m, ...(empty ? { count: 0 } : {}) };
  return { provider: c.provider || 'regcheck', unknown: true, used30: one(`SELECT COUNT(*) n FROM usage_log WHERE kind = 'plate' AND at >= datetime('now','-30 days')`).n };
}

export async function balances(force) {
  if (!force && cache && Date.now() - cacheAt < 5 * 60 * 1000) return { ...cache, plate: plateBalance() };
  cache = { sms: await smsBalance(), plate: plateBalance(), at: new Date().toISOString() };
  cacheAt = Date.now();
  return cache;
}
