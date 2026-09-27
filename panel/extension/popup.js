// Окно расширения: состояние подключения, версия и обновления, поставщик на текущей вкладке
const $ = (id) => document.getElementById(id);
const send = (m) => new Promise((ok) => chrome.runtime.sendMessage(m, ok));
const BUILTIN = chrome.runtime.getManifest().content_scripts.find((c) => c.js.includes('content.js')).matches;
const NAMES = [[/intercars/, 'Inter Cars'], [/hartphp/, 'Hart'], [/autopartner|apcat/, 'Auto Partner'], [/inter-team/, 'Inter-Team'], [/motoprofil|profiauto/, 'Moto-Profil'],
  [/gordon/, 'Gordon'], [/motorol/, 'Motorol'], [/rodon/, 'Rodon'], [/arge/, 'Arge'], [/elit/, 'Elit'], [/autoland/, 'Auto Land']];
const ROLE = { admin: 'администратор', staff: 'сотрудник', mechanic: 'механик' };
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('pl-PL') : '—');
const globMatch = (pat, url) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(url);

function render(st) {
  $('v').textContent = chrome.runtime.getManifest().version;
  $('latest').textContent = st?.latest || '—';
  $('checked').textContent = fmt(st?.checkedAt);
  $('panel').textContent = st?.panel || '—';
  $('user').textContent = st?.user ? `${st.user}${st.role ? ' · ' + (ROLE[st.role] || st.role) : ''}` : '—';
  $('company').textContent = [st?.company, st?.nip ? 'NIP ' + st.nip : ''].filter(Boolean).join(' · ') || '—';
  const chip = $('chip');
  const note = $('note');
  note.innerHTML = '';
  if (!st?.connected) {
    chip.className = 'bad'; chip.textContent = 'Не подключено';
    note.innerHTML = `<div class="msg bad">${st?.needSetup ? 'Откройте CRM → Склад → Поставщики и нажмите «Подключить расширение».' : (st?.error || 'CRM не отвечает.')}</div>`;
  } else if (st.update) {
    chip.className = 'warn'; chip.textContent = 'Есть обновление';
    note.innerHTML = `<div class="msg warn">Вышла версия ${st.latest}. <a class="btn" style="display:inline-block;padding:3px 8px;margin-left:4px" href="${st.panel}/pulsecar-extension.zip" target="_blank">Скачать</a></div>`;
  } else { chip.className = 'ok'; chip.textContent = 'Подключено'; }
}

async function tabInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    $('tabname').textContent = 'Эта вкладка — не сайт'; $('capture').disabled = true; return;
  }
  const u = new URL(tab.url);
  const origin = u.origin;
  const builtin = BUILTIN.some((p) => globMatch(p, tab.url));
  const { sites = [] } = await chrome.storage.sync.get('sites');
  const own = sites.includes(origin);
  const name = (NAMES.find(([re]) => re.test(u.hostname)) || [])[1];
  $('tabdot').className = builtin || own ? 'on' : '';
  $('tabname').textContent = builtin ? `${name || u.hostname}: кнопка работает` : own ? `${u.hostname}: кнопка включена вами` : `${u.hostname}: поставщика нет в списке`;
  $('capture').onclick = async () => {
    $('capture').disabled = true;
    const r = await send({ type: 'capture', tabId: tab.id, mode: 'page' });
    if (r?.error) { $('tabname').textContent = r.error; $('capture').disabled = false; } else window.close();
  };
  if (!builtin && !/pulsecar\.tech$|localhost/.test(u.hostname)) {
    const b = $('site');
    b.hidden = false;
    b.textContent = own ? 'Убрать кнопку с этого сайта' : 'Показывать кнопку на этом сайте';
    b.onclick = async () => {
      if (own) {
        await chrome.storage.sync.set({ sites: sites.filter((s) => s !== origin) });
        await chrome.permissions.remove({ origins: [origin + '/*'] }).catch(() => {});
      } else {
        const ok = await chrome.permissions.request({ origins: [origin + '/*'] });
        if (!ok) return;
        await chrome.storage.sync.set({ sites: [...sites, origin] });
      }
      await send({ type: 'sites-changed' });
      if (!own) chrome.tabs.reload(tab.id);
      tabInfo();
    };
  }
}

chrome.storage.local.get('status').then(({ status }) => render(status));
send({ type: 'check' }).then(render);
tabInfo();
$('recheck').onclick = async () => { $('chip').textContent = '…'; render(await send({ type: 'check' })); };
$('open').onclick = () => { send({ type: 'open', hash: '/#/stock/suppliers' }); window.close(); };
$('opts').onclick = () => { chrome.runtime.openOptionsPage(); window.close(); };
