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

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)|^localhost$|\.local$|\.lan$/i;
const fOrigin = () => { try { const u = new URL($('furl').value.trim()); return /^https?:$/.test(u.protocol) && PRIVATE.test(u.hostname) ? u.origin : null; } catch { return null; } };
const fsay = (t, ok) => { $('fst').className = ok ? 'ok' : 'err'; $('fst').textContent = t; };
const h = new URLSearchParams(location.hash.slice(1));
chrome.storage.local.get('fiscalUrl', ({ fiscalUrl }) => { $('furl').value = h.get('fiscal') || fiscalUrl || ''; if (h.get('fiscal')) $('fiscal').scrollIntoView(); });
$('fallow').onclick = async () => {
  const o = fOrigin();
  if (!o) return fsay('Адрес должен быть в локальной сети, например http://192.168.1.50:8888', false);
  const ok = await chrome.permissions.request({ origins: [o + '/*'] });
  await chrome.storage.local.set({ fiscalUrl: o });
  fsay(ok ? 'Доступ разрешён. Теперь CRM может печатать чеки на этой кассе.' : 'Доступ не разрешён', ok);
};
$('ftest').onclick = async () => {
  const o = fOrigin();
  if (!o) return fsay('Впишите адрес кассы', false);
  fsay('Проверяю…', true);
  try {
    const r = await fetch(o + '/api/v1', { signal: AbortSignal.timeout(8000) });
    fsay(r.ok ? 'Касса отвечает (NoviAPI) ✓' : 'Касса ответила ' + r.status, r.ok);
  } catch (e) { fsay('Касса не отвечает: ' + e.message + (e.message.includes('permission') ? '' : '. Нажмите «Разрешить доступ», проверьте IP и что NoviAPI включён.'), false); }
};
