// Фоновая часть расширения: забирает задачи у сервиса и выполняет их в partslink24
// в сессии менеджера, в человеческом темпе. Пароли не хранит и не читает.

const PL24_START = 'https://www.partslink24.com/';
let busy = false;

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('poll', { periodInMinutes: 0.5 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('poll', { periodInMinutes: 0.5 }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'poll') poll(); });
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m?.type === 'poll-now') { poll().then(() => reply({ ok: true })); return true; }
});

async function settings() {
  const s = await chrome.storage.local.get(['serviceUrl', 'key']);
  return { serviceUrl: (s.serviceUrl || '').replace(/\/$/, ''), key: s.key || '' };
}

async function api(path, body) {
  const { serviceUrl, key } = await settings();
  const r = await fetch(serviceUrl + path, {
    method: 'POST',
    headers: { 'X-Extension-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error('Сервис: HTTP ' + r.status);
  return r.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const humanPause = () => sleep(1500 + Math.random() * 1500);

async function badge(text, color) {
  await chrome.action.setBadgeText({ text });
  if (color) await chrome.action.setBadgeBackgroundColor({ color });
}

async function poll() {
  if (busy) return;
  const { serviceUrl, key } = await settings();
  if (!serviceUrl || !key) return;
  let task;
  try {
    task = await api('/ext/v1/tasks/next');
  } catch (e) {
    await badge('!', '#b42318');
    return;
  }
  if (!task) { await badge(''); return; }
  busy = true;
  try {
    await runTask(task);
  } finally {
    busy = false;
    await badge('');
  }
}

function waitForLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(); }, timeoutMs);
    function fn(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(t);
        chrome.tabs.onUpdated.removeListener(fn);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

async function runTask(task) {
  await badge('…', '#1f55c4');
  // Отдельная неактивная вкладка в окне менеджера: используется его сессия partslink24.
  const tab = await chrome.tabs.create({ url: PL24_START, active: false });
  let ended = false;
  try {
    await waitForLoad(tab.id);
    await humanPause();
    for (let i = 0; i < (task.maxSteps || 45); i++) {
      const snap = await snapshot(tab.id);
      const action = await api(`/ext/v1/tasks/${task.id}/step`, { snapshot: snap });
      if (!action) break;
      if (action.action === 'done' || action.action === 'fail') { ended = true; break; }
      if (action.action === 'continue') continue;
      await perform(tab.id, action);
      await humanPause();
      // после клика страница может перезагрузиться
      const t = await chrome.tabs.get(tab.id);
      if (t.status !== 'complete') await waitForLoad(tab.id);
    }
  } catch (e) {
    ended = true;
    await api(`/ext/v1/tasks/${task.id}/finish`, { error: String(e.message || e) }).catch(() => {});
  } finally {
    if (!ended) await api(`/ext/v1/tasks/${task.id}/finish`, { error: 'max_steps' }).catch(() => {});
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// ---------- Снимок страницы (во всех фреймах) ----------
function pageSnapshot() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const sel = 'a,button,input,select,textarea,[role=button],[role=link],[role=tab],[role=treeitem],[onclick],li[class*=item],td[onclick],span[onclick]';
  const els = Array.from(document.querySelectorAll(sel)).filter(visible).slice(0, 450);
  let n = 0;
  const lines = [];
  for (const el of els) {
    const id = String(++n);
    el.setAttribute('data-aip', id);
    const tag = el.tagName.toLowerCase();
    let label = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'password') { lines.push(`[${id}] password-field`); continue; }
      label = `input(${type}) placeholder="${el.getAttribute('placeholder') || ''}" name="${el.getAttribute('name') || ''}" value="${(el.value || '').slice(0, 40)}"`;
    }
    if (tag === 'select') label = 'select: ' + Array.from(el.options).slice(0, 30).map((o) => o.text.trim()).join(' | ');
    if (!label) continue;
    lines.push(`[${id}] ${tag} "${label}"`);
  }
  const tables = Array.from(document.querySelectorAll('table')).filter(visible).slice(0, 8)
    .map((t) => t.innerText.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').slice(0, 5000));
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,.title,.header')).filter(visible).slice(0, 15).map((h) => h.innerText.trim()).filter(Boolean);
  const bodyText = (document.body?.innerText || '').toLowerCase();
  return {
    url: location.href,
    title: document.title,
    hasPassword: !!document.querySelector('input[type=password]'),
    captcha: /captcha|recaptcha|nie jestem robotem|i'm not a robot/.test(bodyText) || !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"]'),
    text: [headings.length ? 'Заголовки: ' + headings.join(' / ') : '', 'Элементы:', ...lines, tables.length ? 'Таблицы:\n' + tables.join('\n---\n') : ''].join('\n'),
  };
}

async function snapshot(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const parts = [];
  let main = null;
  for (const f of frames || [{ frameId: 0 }]) {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [f.frameId] }, func: pageSnapshot });
      const s = res?.result;
      if (!s) continue;
      if (f.frameId === 0) main = s;
      // id элементов с префиксом фрейма: "<frameId>:<n>"
      const text = s.text.replace(/^\[(\d+)\]/gm, `[${f.frameId}:$1]`);
      parts.push(`=== фрейм ${f.frameId} (${s.url}) ===\n${text}`);
      if (s.hasPassword) parts.push('ВНИМАНИЕ: на странице форма входа (поле пароля).');
      if (s.captcha) parts.push('ВНИМАНИЕ: на странице капча.');
    } catch {
      /* фрейм другого домена без доступа — пропускаем */
    }
  }
  return { url: main?.url || '', title: main?.title || '', text: parts.join('\n\n').slice(0, 60000) };
}

// ---------- Действия ----------
function pageAct(id, action, text, submit) {
  const el = document.querySelector(`[data-aip="${id}"]`);
  if (!el) return { ok: false, error: 'element_not_found' };
  el.scrollIntoView({ block: 'center' });
  if (action === 'click') {
    el.click();
    return { ok: true };
  }
  if (action === 'type') {
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (submit) {
      for (const type of ['keydown', 'keypress', 'keyup'])
        el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      if (el.form && typeof el.form.requestSubmit === 'function') {
        try { el.form.requestSubmit(); } catch { /* форма может обрабатываться скриптом */ }
      }
    }
    return { ok: true };
  }
  return { ok: false, error: 'unknown_action' };
}

async function perform(tabId, a) {
  if (a.action === 'back') { await chrome.tabs.goBack(tabId).catch(() => {}); return; }
  if (!a.id) return;
  const [frame, n] = String(a.id).includes(':') ? String(a.id).split(':') : ['0', String(a.id)];
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [Number(frame)] },
    func: pageAct,
    args: [n, a.action, a.text || '', !!a.submit],
  });
}
