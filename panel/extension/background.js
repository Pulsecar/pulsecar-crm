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
