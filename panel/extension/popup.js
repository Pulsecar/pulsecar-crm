// Окно расширения: состояние подключения, версия и обновления, поставщик на текущей вкладке
const $ = (id) => document.getElementById(id);
const send = (m) => new Promise((ok) => chrome.runtime.sendMessage(m, ok));
const BUILTIN = chrome.runtime.getManifest().content_scripts.find((c) => c.js.includes('content.js')).matches;
const NAMES = [[/intercars/, 'Inter Cars'], [/hartphp/, 'Hart'], [/autopartner|apcat/, 'Auto Partner'], [/inter-team/, 'Inter-Team'], [/motoprofil|profiauto/, 'Moto-Profil'],
  [/gordon/, 'Gordon'], [/motorol/, 'Motorol'], [/rodon/, 'Rodon'], [/arge/, 'Arge'], [/elit/, 'Elit'], [/autoland/, 'Auto Land'], [/allegro/, 'Allegro']];
const ROLE = { admin: 'администратор', staff: 'сотрудник', mechanic: 'механик' };
let lastSt = null;
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('pl-PL') : '—');
const globMatch = (pat, url) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(url);

function render(st) {
  lastSt = st;
  $('v').textContent = chrome.runtime.getManifest().version;
  $('latest').textContent = st?.latest || '—';
  $('checked').textContent = fmt(st?.checkedAt);
  $('panel').textContent = st?.panel || '—';
  $('user').textContent = st?.user ? `${st.user}${st.role ? ' · ' + pcT(ROLE[st.role] || st.role) : ''}` : '—';
  $('company').textContent = [st?.company, st?.nip ? 'NIP ' + st.nip : ''].filter(Boolean).join(' · ') || '—';
  const chip = $('chip');
  const note = $('note');
  note.innerHTML = '';
  if (!st?.connected) {
    chip.className = 'bad'; chip.textContent = pcT('Не подключено');
    note.innerHTML = `<div class="msg bad">${pcT(st?.needSetup ? 'Откройте CRM → Склад → Поставщики и нажмите «Подключить расширение».' : (st?.error || 'CRM не отвечает.'))}</div>`;
  } else if (st.update) {
    chip.className = 'warn'; chip.textContent = pcT('Есть обновление');
    note.innerHTML = `<div class="msg warn">${pcT('Вышла версия {v}.', { v: st.latest })} <a class="btn" style="display:inline-block;padding:3px 8px;margin-left:4px" href="${st.panel}/pulsecar-extension.zip" target="_blank">${pcT('Скачать')}</a></div>`;
  } else { chip.className = 'ok'; chip.textContent = pcT('Подключено'); }
}

async function tabInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    $('tabname').textContent = pcT('Эта вкладка — не сайт'); $('capture').disabled = true; return;
  }
  const u = new URL(tab.url);
  const origin = u.origin;
  const builtin = BUILTIN.some((p) => globMatch(p, tab.url));
  const { sites = [] } = await chrome.storage.sync.get('sites');
  const own = sites.includes(origin);
  const name = (NAMES.find(([re]) => re.test(u.hostname)) || [])[1];
  $('tabdot').className = builtin || own ? 'on' : '';
  $('tabname').textContent = pcT(builtin ? `${name || u.hostname}: кнопка работает` : own ? `${u.hostname}: кнопка включена вами` : `${u.hostname}: поставщика нет в списке`);
  $('capture').onclick = async () => {
    $('capture').disabled = true;
    const r = await send({ type: 'capture', tabId: tab.id, mode: 'page' });
    if (r?.error) { $('tabname').textContent = pcT(r.error); $('capture').disabled = false; } else window.close();
  };
  if (!builtin && !/pulsecar\.tech$|localhost/.test(u.hostname)) {
    const b = $('site');
    b.hidden = false;
    b.textContent = pcT(own ? 'Убрать кнопку с этого сайта' : 'Показывать кнопку на этом сайте');
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

const paintLang = () => { pcTr(document.body); document.querySelectorAll('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.l === pcLang())); document.documentElement.lang = pcLang(); };
document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', async () => { await pcSetLang(b.dataset.l); paintLang(); if (lastSt) render(lastSt); tabInfo(); }));
pcI18nReady.then(() => {
  paintLang();
  chrome.storage.local.get('status').then(({ status }) => render(status));
  send({ type: 'check' }).then(render);
  tabInfo();
});
$('recheck').onclick = async () => { $('chip').textContent = '…'; render(await send({ type: 'check' })); };
$('open').onclick = () => { send({ type: 'open', hash: '/#/stock/suppliers' }); window.close(); };
$('opts').onclick = () => { chrome.runtime.openOptionsPage(); window.close(); };
