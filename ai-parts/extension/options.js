const $ = (id) => document.getElementById(id);
chrome.storage.local.get(['serviceUrl', 'key']).then((s) => {
  $('url').value = s.serviceUrl || '';
  $('key').value = s.key || '';
});
$('save').onclick = async () => {
  const serviceUrl = $('url').value.trim().replace(/\/$/, '');
  const key = $('key').value.trim();
  await chrome.storage.local.set({ serviceUrl, key });
  $('st').textContent = 'Проверяю…';
  try {
    const r = await fetch(serviceUrl + '/ext/v1/ping', { headers: { 'X-Extension-Key': key } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    $('st').textContent = 'Подключено (' + (j.label || 'ключ принят') + '). Задачи будут забираться автоматически.';
    chrome.runtime.sendMessage({ type: 'poll-now' });
  } catch (e) {
    $('st').textContent = 'Не удалось подключиться: ' + e.message;
  }
};
