// Pulsecar: фон расширения — запросы к CRM с ключом сотрудника (без CORS), проверка обновлений,
// сайты поставщиков, включённые пользователем, и меню по правому клику.
const DEF_PANEL = 'https://panel.pulsecar.tech';
const VERSION = chrome.runtime.getManifest().version;

async function conf() {
  const c = await chrome.storage.sync.get(['panel', 'token']);
  return { panel: (c.panel || DEF_PANEL).replace(/\/+$/, ''), token: c.token || '' };
}

async function api(path, { method = 'GET', body, anon = false } = {}) {
  const c = await conf();
  if (!c.token && !anon) return { error: 'Расширение не подключено к CRM: откройте CRM → Склад → Поставщики → «Подключить расширение».', needSetup: true };
  try {
    const r = await fetch(`${c.panel}/crm-api/${path}`, {
      method,
      headers: { ...(c.token && !anon ? { Authorization: 'Bearer ' + c.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Pulsecar-Ext': VERSION },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: j.error || `Ошибка ${r.status}`, status: r.status, needSetup: r.status === 401 };
    return { data: j, panel: c.panel };
  } catch (e) {
    return { error: 'CRM недоступна: ' + e.message, offline: true };
  }
}

// ── проверка обновлений (как в Motowarsztat: версия, последняя версия, дата проверки) ──
const newer = (a, b) => {
  const x = String(a || '').split('.').map(Number), y = String(b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
};
async function check() {
  const c = await conf();
  const [ver, hello] = await Promise.all([api('ext/version', { anon: true }), c.token ? api('ext/hello') : Promise.resolve({ error: 'нет ключа', needSetup: true })]);
  const st = {
    checkedAt: new Date().toISOString(), panel: c.panel, version: VERSION,
    latest: ver.data?.version || hello.data?.latest || null,
    connected: !!hello.data, user: hello.data?.name || null, role: hello.data?.role || null,
    company: hello.data?.company || hello.data?.brand || null, nip: hello.data?.nip || null,
    error: hello.data ? null : hello.error || ver.error || null, needSetup: !!hello.needSetup,
  };
  st.update = !!(st.latest && newer(st.latest, VERSION));
  await chrome.storage.local.set({ status: st });
  chrome.action.setBadgeBackgroundColor({ color: st.connected ? '#f0b429' : '#e34948' });
  chrome.action.setBadgeText({ text: !st.connected ? '!' : st.update ? '↑' : '' });
  return st;
}

// ── сайты, где пользователь включил кнопку сам (любой поставщик, которого нет в списке) ──
async function syncSites() {
  const { sites = [] } = await chrome.storage.sync.get('sites');
  const reg = await chrome.scripting.getRegisteredContentScripts({ ids: ['pulsecar-sites'] }).catch(() => []);
  if (reg.length) await chrome.scripting.unregisterContentScripts({ ids: ['pulsecar-sites'] }).catch(() => {});
  const granted = [];
  for (const o of sites) if (await chrome.permissions.contains({ origins: [o + '/*'] })) granted.push(o + '/*');
  if (granted.length) {
    await chrome.scripting.registerContentScripts([{ id: 'pulsecar-sites', matches: granted, js: ['content.js'], runAt: 'document_idle', persistAcrossSessions: true }])
      .catch((e) => console.warn('Pulsecar:', e.message));
  }
}

async function inject(tabId, mode) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'pulsecar-capture', mode });
    return { ok: true };
  } catch (e) { return { error: 'На этой странице кнопку не запустить: ' + e.message }; }
}


// ── Фискальная касса Novitus (NoviAPI) в сети сервиса: CRM готовит чек, расширение печатает ──
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)|^localhost$|\.local$|\.lan$/i;
function printerOrigin(url) {
  let u; try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !PRIVATE.test(u.hostname)) return null;
  return u.origin;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function novi(origin, method, path, { body, auth = true, timeout = 15000 } = {}) {
  const tok = auth ? await noviToken(origin) : null;
  const go = (t) => fetch(`${origin}/api/v1${path}`, {
    method, signal: AbortSignal.timeout(timeout),
    headers: { ...(t ? { Authorization: 'Bearer ' + t } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let r = await go(tok);
  if (r.status === 401 && auth) r = await go(await noviToken(origin, true));
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}
async function noviToken(origin, renew = false) {
  const key = 'novi:' + origin;
  const { [key]: c } = await chrome.storage.local.get(key);
  if (!renew && c?.token && Date.parse(c.expiration_date) - Date.now() > 60_000) return c.token;
  const save = async (j) => { await chrome.storage.local.set({ [key]: { token: j.token, expiration_date: j.expiration_date } }); return j.token; };
  if (c?.token) {
    const r = await fetch(`${origin}/api/v1/token`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'text/plain' }, body: '', signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (r?.ok) return save(await r.json());
  }
  const r = await fetch(`${origin}/api/v1/token`, { signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 429 ? `Касса ограничила выдачу токенов, повторите после ${j.exception?.allowed_refresh_date || 'часа'}` : `Касса не выдала токен (${j.exception?.description || r.status})`);
  return save(j);
}
const errText = (x) => (x ? `${x.description || 'ошибка'}${x.code !== undefined ? ` (код ${x.code})` : ''}` : '');
async function fiscal(job) {
  const origin = printerOrigin(job?.url);
  if (!origin) return { ok: false, error: 'Адрес кассы должен быть в локальной сети, например http://192.168.1.50:8888 (Настройки → Интеграции → Фискальная касса)' };
  if (!(await chrome.permissions.contains({ origins: [origin + '/*'] }))) return { ok: false, needPermission: origin, error: 'Расширению нужно разрешение на доступ к кассе' };
  try {
    if (job.resource === 'ping') {
      const r = await fetch(`${origin}/api/v1`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return { ok: false, error: `Касса ответила ${r.status}` };
      const q = await novi(origin, 'GET', '/queue');
      return { ok: q.status === 200, queue: q.j.requests_in_queue, error: q.status === 200 ? null : errText(q.j.exception) || `Ошибка ${q.status}` };
    }
    if (!['receipt', 'daily_report', 'nf_printout'].includes(job.resource)) return { ok: false, error: 'Неизвестная команда' };
    const sent = await novi(origin, 'POST', '/' + job.resource, { body: job.body });
    if (sent.status !== 201) return { ok: false, error: `Касса не приняла документ: ${errText(sent.j.exception) || sent.status}${sent.j.exception?.errors ? ' — ' + sent.j.exception.errors.join('; ') : ''}` };
    const id = sent.j.request?.id;
    const conf = await novi(origin, 'PUT', `/${job.resource}/${id}`);
    if (conf.status === 409) return { ok: false, error: 'Касса ждёт дневной отчёт (raport dobowy) — сделайте его и повторите' };
    if (conf.status !== 200) return { ok: false, error: `Касса не подтвердила печать: ${errText(conf.j.exception) || conf.status}` };
    let last = null;
    const until = Date.now() + 90_000;
    while (Date.now() < until) {
      const c = await novi(origin, 'GET', `/${job.resource}/${id}?timeout=5000`, { timeout: 15000 });
      last = c.j;
      const st = c.j.request?.status;
      if (st === 'DONE') return { ok: true, id, jpkid: c.j.request.jpkid ?? null, eDocument: c.j.request.e_document?.status || null };
      if (st === 'ERROR' || st === 'UNKNOWN') return { ok: false, id, error: 'Касса: ' + (errText(c.j.request.error) || errText(c.j.device?.error) || st) };
      await sleep(300);
    }
    return { ok: false, pending: true, id, error: 'Касса ещё не напечатала' + (last?.device?.error ? ': ' + errText(last.device.error) : ' (проверьте бумагу)') + '. Чек напечатается сам, когда касса будет готова.' };
  } catch (e) {
    return { ok: false, error: 'Касса не отвечает: ' + (e.name === 'TimeoutError' ? 'нет ответа' : e.message) + '. Проверьте, что касса включена и компьютер в той же сети.' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === 'api') { api(msg.path, msg).then(reply); return true; }
  if (msg?.type === 'check') { check().then(reply); return true; }
  if (msg?.type === 'capture') { inject(msg.tabId, msg.mode || 'page').then(reply); return true; }
  if (msg?.type === 'sites-changed') { syncSites().then(() => reply({ ok: true })); return true; }
  if (msg?.type === 'options') { chrome.runtime.openOptionsPage(); return false; }
  if (msg?.type === 'open') { conf().then((c) => chrome.tabs.create({ url: c.panel + (msg.hash || '') })); return false; }
  // CRM передаёт ключ кнопкой «Подключить расширение» — принимаем только со страницы самой CRM (connect.js)
  if (msg?.type === 'connect' && sender.origin && /^pcx_[A-Za-z0-9_-]{20,}$/.test(msg.token || '')) {
    (async () => {
      await chrome.storage.sync.set({ panel: sender.origin.replace(/\/+$/, ''), token: msg.token });
      reply(await check());
    })();
    return true;
  }
  // печать на кассе — только по просьбе страницы самой CRM (connect.js)
  if (msg?.type === 'fiscal') {
    conf().then(async (c) => {
      if (!sender.origin || sender.origin.replace(/\/+$/, '') !== c.panel) return reply({ ok: false, error: 'Касса доступна только из CRM ' + c.panel });
      reply(await fiscal(msg.job));
    });
    return true;
  }
  if (msg?.type === 'fiscal-allow') {
    const origin = printerOrigin(msg.url);
    if (origin) chrome.tabs.create({ url: chrome.runtime.getURL('options.html') + '#fiscal=' + encodeURIComponent(origin) });
    reply({ ok: !!origin, error: origin ? null : 'Адрес кассы должен быть в локальной сети' });
    return false;
  }
  if (msg?.type === 'whoami') { chrome.storage.local.get('status').then(({ status }) => reply({ version: VERSION, connected: !!status?.connected, user: status?.user || null, panel: status?.panel || null })); return true; }
  return false;
});

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'pulsecar-selection', title: 'Отправить выделенное в Pulsecar', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'pulsecar-page', title: 'Забрать позиции с этой страницы в Pulsecar', contexts: ['page'] });
  });
  chrome.alarms.create('pulsecar-check', { periodInMinutes: 360 });
  await syncSites();
  await check();
});
chrome.runtime.onStartup.addListener(() => { check(); syncSites(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'pulsecar-check') check(); });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'pulsecar-selection') inject(tab.id, 'selection');
  if (info.menuItemId === 'pulsecar-page') inject(tab.id, 'page');
});
