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
    if (m.type === 'connect' && typeof m.token === 'string') {
      chrome.runtime.sendMessage({ type: 'connect', token: m.token }, (st) => say({ type: 'connected', ok: !!st?.connected, user: st?.user || null, error: st?.error || null, version: V }));
    }
  });
  hello();
})();
