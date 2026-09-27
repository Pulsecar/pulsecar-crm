const $ = (id) => document.getElementById(id);
chrome.storage.sync.get(['panel', 'token'], (c) => { $('panel').value = c.panel || 'https://panel.pulsecar.tech'; $('token').value = c.token || ''; });
$('save').onclick = async () => {
  const panel = $('panel').value.trim().replace(/\/+$/, '');
  const token = $('token').value.trim();
  await chrome.storage.sync.set({ panel, token });
  $('st').className = ''; $('st').textContent = 'Проверяю…';
  chrome.runtime.sendMessage({ type: 'api', path: 'ext/hello' }, (r) => {
    if (r?.data) { $('st').className = 'ok'; $('st').textContent = `Подключено: ${r.data.brand} · ${r.data.name}. Откройте каталог Inter Cars — у деталей появится кнопка «Pulsecar».`; }
    else { $('st').className = 'err'; $('st').textContent = r?.error || 'Нет ответа от CRM'; }
  });
};
