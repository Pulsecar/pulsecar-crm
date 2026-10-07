// Мост «CRM ⇄ расширение» на страницах самой CRM: CRM видит, что расширение установлено,
// и передаёт ключ сотрудника кнопкой «Подключить расширение» (без копирования ключа руками).
(() => {
  const V = chrome.runtime.getManifest().version;
  const say = (m) => window.postMessage({ source: 'pulsecar-ext', ...m }, location.origin);
  document.documentElement.dataset.pulsecarExt = V;
  const hello = () => chrome.runtime.sendMessage({ type: 'whoami' }, (w) => say({ type: 'hello', version: V, ...(w || {}) }));
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const m = e.data;
    if (!m || m.source !== 'pulsecar-crm') return;
    if (m.type === 'ping') hello();
    if ((m.type === 'fiscal' || m.type === 'fiscal-allow') && m.reqId) {
      chrome.runtime.sendMessage({ type: m.type, job: m.job, url: m.url }, (r) => say({ type: m.type + '-result', reqId: m.reqId, ...(r || { ok: false, error: chrome.runtime.lastError?.message || 'Расширение не ответило' }) }));
    }
    if ((m.type === 'ecat' || m.type === 'allegro') && m.reqId) {
      chrome.runtime.sendMessage({ type: m.type, reqId: m.reqId, job: m.job }, (r) => say({ type: m.type + '-result', reqId: m.reqId, ...(r || { ok: false, error: chrome.runtime.lastError?.message || 'Расширение не ответило' }) }));
    }
    if (m.type === 'pl24' && m.reqId) {
      chrome.runtime.sendMessage({ type: 'pl24', reqId: m.reqId, job: m.job }, (r) => say({ type: 'pl24-result', reqId: m.reqId, ...(r || { ok: false, error: chrome.runtime.lastError?.message || 'Расширение не ответило' }) }));
    }
    if (m.type === 'connect' && typeof m.token === 'string') {
      chrome.runtime.sendMessage({ type: 'connect', token: m.token }, (st) => say({ type: 'connected', ok: !!st?.connected, user: st?.user || null, error: st?.error || null, version: V }));
    }
  });
  chrome.runtime.onMessage.addListener((m) => { if (m?.type === 'pl24-progress') say(m); });
  hello();
})();
