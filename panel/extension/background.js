// Pulsecar: фон расширения — запросы к CRM с ключом сотрудника (без CORS), кнопка на панели и меню по правому клику
const DEF_PANEL = 'https://panel.pulsecar.tech';

async function conf() {
  const c = await chrome.storage.sync.get(['panel', 'token']);
  return { panel: (c.panel || DEF_PANEL).replace(/\/+$/, ''), token: c.token || '' };
}

async function api(path, { method = 'GET', body } = {}) {
  const c = await conf();
  if (!c.token) return { error: 'Расширение не подключено к CRM: откройте настройки расширения и вставьте ключ из CRM (Склад → Хуртовни → Расширение Chrome).', needSetup: true };
  try {
    const r = await fetch(`${c.panel}/crm-api/${path}`, {
      method, headers: { Authorization: 'Bearer ' + c.token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: j.error || `Ошибка ${r.status}`, status: r.status, needSetup: r.status === 401 };
    return { data: j, panel: c.panel };
  } catch (e) {
    return { error: 'CRM недоступна: ' + e.message };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'api') { api(msg.path, msg).then(reply); return true; }
  if (msg?.type === 'options') { chrome.runtime.openOptionsPage(); return false; }
  if (msg?.type === 'open') { conf().then((c) => chrome.tabs.create({ url: c.panel + msg.hash })); return false; }
  return false;
});

async function inject(tabId, mode) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'pulsecar-capture', mode });
  } catch (e) { console.warn('Pulsecar:', e.message); }
}

// кнопка расширения на панели Chrome: забрать таблицу / выделение с любой страницы хуртовни
chrome.action.onClicked.addListener((tab) => tab.id && inject(tab.id, 'page'));

chrome.runtime.onInstalled.addListener(async (d) => {
  chrome.contextMenus.create({ id: 'pulsecar-selection', title: 'Отправить выделенное в Pulsecar', contexts: ['selection'] });
  if (d.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.contextMenus.onClicked.addListener((info, tab) => { if (info.menuItemId === 'pulsecar-selection' && tab?.id) inject(tab.id, 'selection'); });
