(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const TZ = 'Europe/Warsaw';
const DAYS = [['mon', 'Pon'], ['tue', 'Wt'], ['wed', 'Śr'], ['thu', 'Czw'], ['fri', 'Pt'], ['sat', 'Sob'], ['sun', 'Nd']];
const STATE = {
  live: 'Aktywny', closed: 'Poza godzinami', not_started: 'Zaplanowany',
  expired: 'Wygasł', revoked: 'Unieważniony', no_camera: 'Brak kamery',
};
const ACTIVE = ['live', 'closed', 'not_started'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => new Date(iso).toLocaleString('pl-PL', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
const S = { me: null, cameras: [], links: [], settings: null, filter: 'active' };
const embedded = window.self !== window.top || new URLSearchParams(location.search).has('embed');
if (embedded) document.body.classList.add('embed');

// ---------- утилиты ----------
async function api(path, method = 'GET', data) {
  const opt = { method, headers: {} };
  if (data !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(data); }
  const r = await fetch('/api/v1' + path, opt);
  if (r.status === 401) { location.reload(); throw new Error('Sesja wygasła'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Błąd serwera');
  return j;
}
let tt;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 2600); }
function copy(text, label = 'Skopiowano') {
  navigator.clipboard.writeText(text).then(() => toast(label), () => toast('Nie udało się skopiować — zaznacz tekst ręcznie'));
}
function notifyParent(msg) {
  if (window.parent === window || !S.me || !S.me.crmOrigin) return;
  window.parent.postMessage(msg, S.me.crmOrigin);
}
// datetime-local ↔ ISO (браузер в часовом поясе мастерской)
const pad = (n) => String(n).padStart(2, '0');
const toInput = (d) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromInput = (v) => (v ? new Date(v).toISOString() : '');
const endOfDay = (base, addDays) => { const d = new Date(base); d.setDate(d.getDate() + addDays); d.setHours(23, 59, 0, 0); return d; };
function confirmBtn(btn, label, fn) {
  if (btn.dataset.sure) return fn();
  const old = btn.textContent;
  btn.dataset.sure = '1'; btn.textContent = label; btn.classList.add('sure');
  setTimeout(() => { delete btn.dataset.sure; btn.textContent = old; btn.classList.remove('sure'); }, 4000);
}

// Сетка дней: галочка + время «от» и «до». Возвращает функцию, отдающую расписание.
function daysGrid(el, weekly, fallback) {
  el.innerHTML = '';
  for (const [d, n] of DAYS) {
    const w = weekly ? weekly[d] : null, fb = (fallback && fallback[d]) || ['08:00', '18:00'];
    el.insertAdjacentHTML('beforeend', `<label class="check"><input type="checkbox" data-d="${d}"${w ? ' checked' : ''}></label><b>${n}</b>
      <input type="time" data-d="${d}" data-k="0" value="${(w || fb)[0]}" aria-label="${n} od"><input type="time" data-d="${d}" data-k="1" value="${(w || fb)[1]}" aria-label="${n} do">`);
  }
  const sync = () => $$('input[type=checkbox]', el).forEach((c) => $$(`input[type=time][data-d="${c.dataset.d}"]`, el).forEach((t) => (t.disabled = !c.checked)));
  el.addEventListener('change', sync); sync();
  return () => Object.fromEntries(DAYS.map(([d]) => [d, $(`input[type=checkbox][data-d="${d}"]`, el).checked ? [$(`input[data-d="${d}"][data-k="0"]`, el).value, $(`input[data-d="${d}"][data-k="1"]`, el).value] : null]));
}

// ---------- форма ссылки ----------
function linkForm(host, link, prefill = {}) {
  host.innerHTML = '';
  host.appendChild($('#tpl-link-form').content.cloneNode(true));
  const f = $('form', host);
  const v = link || prefill;
  const sel = $('[name=cameraId]', f);
  const camsForSelect = S.cameras.filter((c) => c.enabled || (link && c.id === link.cameraId));
  sel.innerHTML = camsForSelect.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.enabled ? '' : ' (wyłączona)'}</option>`).join('');
  $('.no-cams', f).hidden = camsForSelect.length > 0;
  if (v.cameraId) sel.value = v.cameraId;
  for (const k of ['plate', 'client', 'car', 'orderNo', 'phone']) $(`[name=${k}]`, f).value = v[k] || '';
  const now = new Date(); now.setSeconds(0, 0);
  $('[name=validFrom]', f).value = toInput(link ? link.validFrom : (v.validFrom || now));
  $('[name=validTo]', f).value = toInput(link ? link.validTo : (v.validTo || endOfDay(now, 3)));
  $$('.chip', f).forEach((b) => (b.onclick = () => {
    const from = new Date($('[name=validFrom]', f).value || Date.now());
    $('[name=validTo]', f).value = toInput(endOfDay(from, Number(b.dataset.to)));
  }));
  let mode = (link && link.scheduleMode) || v.scheduleMode || 'workshop';
  const getDays = daysGrid($('.custom-days', f), link && link.schedule ? link.schedule : S.settings.workshopHours, S.settings.workshopHours);
  const setMode = (m) => {
    mode = m;
    $$('.mode button', f).forEach((b) => b.setAttribute('aria-pressed', b.dataset.m === m));
    $('.custom-days', f).hidden = m !== 'custom';
    $('.mode-hint', f).textContent = m === 'workshop' ? `Teraz: ${S.settings.workshopHoursText}. Poza tymi godzinami klient widzi „Warsztat jest zamknięty”.`
      : m === 'always' ? 'Obraz dostępny przez całą dobę w wybranym okresie.' : 'Zaznacz dni i godziny, w których klient może oglądać.';
  };
  $$('.mode button', f).forEach((b) => (b.onclick = () => setMode(b.dataset.m)));
  setMode(mode);
  f.addEventListener('submit', (e) => e.preventDefault());
  return {
    data() {
      const d = {
        cameraId: sel.value, plate: $('[name=plate]', f).value, client: $('[name=client]', f).value, car: $('[name=car]', f).value,
        orderNo: $('[name=orderNo]', f).value, phone: $('[name=phone]', f).value,
        validFrom: fromInput($('[name=validFrom]', f).value), validTo: fromInput($('[name=validTo]', f).value), scheduleMode: mode,
      };
      if (mode === 'custom') d.schedule = getDays();
      if (!link && prefill.orderId) d.orderId = prefill.orderId;
      return d;
    },
    error(m) { $('.form-err', f).textContent = m || ''; },
  };
}

function resultView(host, l) {
  host.innerHTML = `<div class="result">
    <div><span class="eyebrow">Link dla ${esc(l.plate)}</span><div class="hint">${esc(l.cameraName)} · ${fmt(l.validFrom)} – ${fmt(l.validTo)} · ${esc(l.scheduleText)}</div></div>
    <div class="url">${esc(l.url)}</div>
    <div class="actions"><button class="btn btn-primary btn-sm" data-a="url" type="button">Kopiuj link</button><a class="btn btn-outline btn-sm" href="${esc(l.url)}" target="_blank" rel="noopener">Otwórz jak klient</a></div>
    <div><span class="eyebrow">SMS dla klienta</span></div><div class="sms"></div>
    <div class="actions"><button class="btn btn-outline btn-sm" data-a="sms" type="button">Kopiuj SMS</button></div></div>`;
  $('.sms', host).textContent = l.smsText;
  $('[data-a=url]', host).onclick = () => copy(l.url, 'Link skopiowany');
  $('[data-a=sms]', host).onclick = () => copy(l.smsText, 'SMS skopiowany');
}

// ---------- окно ссылки (создание / редактирование) ----------
const dlgLink = $('#dlg-link');
function openLink(link) {
  if (!link && !S.cameras.some((c) => c.enabled)) { toast('Najpierw dodaj kamerę w zakładce „Kamery”'); switchTab('cameras'); return; }
  $('#dlg-link-title').textContent = link ? `Edycja linku · ${link.plate}` : 'Nowy link dla klienta';
  const foot = $('#dlg-link-foot');
  foot.innerHTML = `<button class="btn btn-outline" type="button" data-close>Anuluj</button><button class="btn btn-primary" type="button" id="dlg-link-save">${link ? 'Zapisz zmiany' : 'Utwórz link'}</button>`;
  const form = linkForm($('#dlg-link-body'), link);
  $('#dlg-link-save').onclick = async (e) => {
    e.target.disabled = true; form.error('');
    try {
      const l = link ? await api(`/links/${link.id}`, 'PATCH', form.data()) : await api('/links', 'POST', form.data());
      await loadLinks();
      if (link) { dlgLink.close(); toast('Zmiany zapisane'); return; }
      notifyParent({ type: 'pulsecar-live:link-created', link: l });
      resultView($('#dlg-link-body'), l);
      $('#dlg-link-title').textContent = 'Link gotowy';
      foot.innerHTML = '<button class="btn btn-primary" type="button" data-close>Gotowe</button>';
    } catch (err) { form.error(err.message); e.target.disabled = false; }
  };
  dlgLink.showModal();
}
document.addEventListener('click', (e) => { const d = e.target.closest('[data-close]'); if (d) d.closest('dialog').close(); });

// ---------- таблица ссылок ----------
function renderLinks() {
  $('#cnt-links').textContent = S.links.filter((l) => ACTIVE.includes(l.state)).length;
  const q = $('#q').value.trim().toLowerCase();
  let list = S.links.filter((l) => S.filter === 'all' || ACTIVE.includes(l.state));
  if (q) list = list.filter((l) => [l.plate, l.client, l.orderNo, l.car].join(' ').toLowerCase().replace(/\s/g, '').includes(q.replace(/\s/g, '')));
  const tb = $('#links');
  if (!list.length) {
    tb.innerHTML = `<tr><td colspan="7" class="empty"><b>${S.links.length ? 'Brak linków dla tego filtra' : 'Nie ma jeszcze linków'}</b>${S.links.length ? '' : 'Utwórz pierwszy link przyciskiem „+ Nowy link”. Klient dostanie adres do podglądu swojego stanowiska.'}</td></tr>`;
    return;
  }
  const order = { live: 0, closed: 1, not_started: 2, expired: 3, no_camera: 4, revoked: 5 };
  list.sort((a, b) => (order[a.state] - order[b.state]) || b.createdAt.localeCompare(a.createdAt));
  tb.innerHTML = '';
  for (const l of list) {
    const tr = document.createElement('tr');
    const when = l.state === 'closed' && l.nextOpen ? `<span class="sub">od ${fmt(l.nextOpen)}</span>` : l.state === 'not_started' ? `<span class="sub">od ${fmt(l.nextOpen || l.validFrom)}</span>` : '';
    tr.innerHTML = `<td><b class="mono">${esc(l.plate)}</b><span class="sub">${esc([l.client, l.car, l.orderNo && 'zl. ' + l.orderNo].filter(Boolean).join(' · ') || '—')}</span></td>
      <td>${esc(l.cameraName)}</td>
      <td class="mono">${fmt(l.validFrom)}<span class="sub">do ${fmt(l.validTo)}</span></td>
      <td>${esc(l.scheduleText)}</td>
      <td><span class="pill s-${l.state}">${STATE[l.state] || l.state}</span>${when}${l.viewers ? `<span class="sub">ogląda teraz: ${l.viewers}</span>` : ''}</td>
      <td class="mono">${l.views}${l.lastViewAt ? `<span class="sub">${fmt(l.lastViewAt)}</span>` : ''}</td>
      <td><div class="actions"></div></td>`;
    const a = $('.actions', tr);
    const btn = (t, fn, cls = 'btn-outline') => { const b = document.createElement('button'); b.type = 'button'; b.className = `btn btn-sm ${cls}`; b.textContent = t; b.onclick = () => fn(b); a.appendChild(b); };
    if (!l.revoked) {
      if (l.state !== 'expired') { btn('Kopiuj link', () => copy(l.url, 'Link skopiowany')); btn('SMS', () => copy(l.smsText, 'SMS skopiowany')); }
      btn(l.state === 'expired' ? 'Przedłuż' : 'Edytuj', () => openLink(l));
      if (l.state !== 'expired') btn('Unieważnij', (b) => confirmBtn(b, 'Na pewno?', async () => { try { await api(`/links/${l.id}`, 'PATCH', { revoked: true }); await loadLinks(); toast('Link unieważniony — transmisja zatrzymana'); } catch (e) { toast(e.message); } }), 'btn-danger');
    } else a.innerHTML = '<span class="hint">—</span>';
    tb.appendChild(tr);
  }
}
async function loadLinks() { S.links = await api('/links?limit=1000'); renderLinks(); }
$('#q').addEventListener('input', renderLinks);
$$('#filter button').forEach((b) => (b.onclick = () => { S.filter = b.dataset.f; $$('#filter button').forEach((x) => x.setAttribute('aria-pressed', x === b)); renderLinks(); }));
$('#btn-new-link').onclick = () => openLink(null);

// ---------- камеры ----------
const live = new Map();
function renderCams() {
  $('#cnt-cams').textContent = S.cameras.length;
  const box = $('#cams');
  for (const v of live.values()) v.remove();
  live.clear();
  if (!S.cameras.length) {
    box.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="empty" style="padding:12px 0 18px"><b>Nie dodano jeszcze kamer</b>Dodaj kamerę Tapo z warsztatu: potrzebny jest jej adres IP oraz login i hasło „Konta kamery”.</div>
      <div style="text-align:center"><button class="btn btn-primary" type="button" id="empty-add">+ Dodaj kamerę</button></div></div>`;
    $('#empty-add').onclick = () => openCam(null);
    return;
  }
  box.innerHTML = '';
  for (const c of S.cameras) {
    const el = document.createElement('div');
    el.className = 'cam';
    el.innerHTML = `<div class="screen">${c.enabled ? 'Pobieranie obrazu…' : 'Kamera wyłączona'}</div>
      <div class="body">
        <div class="row"><h3>${esc(c.name)}</h3><span class="pill ${c.enabled ? 's-live' : 's-off'}">${c.enabled ? 'Włączona' : 'Wyłączona'}</span></div>
        <div class="hint mono">${esc(c.address || '')}</div>
        <div class="hint">Aktywne linki: ${c.activeLinks} · ogląda teraz: ${c.watching}</div>
        <div class="actions"><button class="btn btn-outline btn-sm" data-a="live" type="button"${c.enabled ? '' : ' disabled'}>Podgląd na żywo</button><button class="btn btn-outline btn-sm" data-a="snap" type="button"${c.enabled ? '' : ' disabled'}>Odśwież obraz</button><button class="btn btn-outline btn-sm" data-a="edit" type="button">Edytuj</button></div>
      </div>`;
    const scr = $('.screen', el);
    const snap = () => {
      if (!c.enabled) return;
      const img = new Image();
      img.alt = c.name;
      img.onload = () => { scr.textContent = ''; scr.appendChild(img); };
      img.onerror = () => { scr.textContent = 'Brak obrazu. Kliknij „Edytuj” → „Sprawdź połączenie”, aby zobaczyć przyczynę.'; };
      img.src = `/api/v1/cameras/${c.id}/snapshot.jpg?t=${Date.now()}`;
    };
    $('[data-a=snap]', el).onclick = () => { scr.textContent = 'Pobieranie obrazu…'; snap(); };
    $('[data-a=edit]', el).onclick = () => openCam(c);
    $('[data-a=live]', el).onclick = (e) => {
      if (live.has(c.id)) { live.get(c.id).remove(); live.delete(c.id); e.target.textContent = 'Podgląd na żywo'; snap(); return; }
      scr.textContent = '';
      const v = document.createElement('video-live');
      v.mode = 'mse,hls';
      scr.appendChild(v);
      v.src = new URL(`/api/v1/cameras/${c.id}/ws`, location.href);
      live.set(c.id, v); e.target.textContent = 'Zatrzymaj podgląd';
    };
    box.appendChild(el);
    snap();
  }
}
async function loadCams() { S.cameras = await api('/cameras'); }

// окно камеры
const dlgCam = $('#dlg-cam');
let camEdit = null, camType = 'tapo', camStream = 'stream1';
const setSeg = (sel, attr, val) => $$(sel + ' button').forEach((b) => b.setAttribute('aria-pressed', b.dataset[attr] === val));
function setCamType(t) { camType = t; setSeg('#c-type', 't', t); $('#c-tapo').hidden = t !== 'tapo'; $('#c-rtsp').hidden = t !== 'rtsp'; }
$$('#c-type button').forEach((b) => (b.onclick = () => setCamType(b.dataset.t)));
$$('#c-stream button').forEach((b) => (b.onclick = () => { camStream = b.dataset.s; setSeg('#c-stream', 's', camStream); }));
function openCam(c) {
  camEdit = c;
  $('#dlg-cam-title').textContent = c ? `Edycja kamery · ${c.name}` : 'Nowa kamera';
  $('#c-name').value = c ? c.name : `Stanowisko ${S.cameras.length + 1}`;
  $('#c-host').value = c && c.host || '';
  $('#c-user').value = c && c.user || '';
  $('#c-pass').value = '';
  $('#c-pass').placeholder = c && c.hasPassword ? 'bez zmian' : '';
  $('#c-port').value = c && c.port || 554;
  $('#c-url').value = '';
  $('#c-url').placeholder = c && c.type === 'rtsp' ? (c.url || '') + ' (wpisz ponownie, aby zmienić)' : 'rtsp://login:hasło@192.168.3.30:554/ścieżka';
  $('#c-enabled').checked = c ? c.enabled : true;
  camStream = c && c.stream || 'stream1'; setSeg('#c-stream', 's', camStream);
  setCamType(c ? c.type : 'tapo');
  $('#c-test').innerHTML = ''; $('#c-err').textContent = '';
  $('#c-del').hidden = !c;
  dlgCam.showModal();
}
function camData() {
  const d = { name: $('#c-name').value, type: camType, enabled: $('#c-enabled').checked };
  if (camType === 'tapo') Object.assign(d, { host: $('#c-host').value, user: $('#c-user').value, pass: $('#c-pass').value, port: Number($('#c-port').value) || 554, stream: camStream });
  else d.url = $('#c-url').value;
  if (camEdit) d.id = camEdit.id;
  return d;
}
$('#c-test-btn').onclick = async (e) => {
  e.target.disabled = true; $('#c-err').textContent = '';
  $('#c-test').innerHTML = '<div class="test-result">Łączenie z kamerą… (do 20 s)</div>';
  try {
    const r = await api('/cameras/test', 'POST', camData());
    $('#c-test').innerHTML = r.ok ? `<div class="test-result ok"><b>Połączenie działa.</b> Tak będzie wyglądał obraz (bez dźwięku):<img alt="Podgląd" src="${r.snapshot}"></div>` : `<div class="test-result bad"><b>Nie udało się połączyć.</b> ${esc(r.message)}</div>`;
  } catch (err) { $('#c-test').innerHTML = ''; $('#c-err').textContent = err.message; }
  e.target.disabled = false;
};
$('#c-save').onclick = async (e) => {
  e.target.disabled = true; $('#c-err').textContent = '';
  try {
    const d = camData(); delete d.id;
    if (camEdit) await api(`/cameras/${camEdit.id}`, 'PATCH', d); else await api('/cameras', 'POST', d);
    dlgCam.close(); toast(camEdit ? 'Kamera zapisana' : 'Kamera dodana');
    await loadCams(); renderCams(); renderLinks();
  } catch (err) { $('#c-err').textContent = err.message; }
  e.target.disabled = false;
};
$('#c-del').onclick = (e) => confirmBtn(e.target, 'Na pewno usunąć?', async () => {
  try { await api(`/cameras/${camEdit.id}`, 'DELETE'); dlgCam.close(); toast('Kamera usunięta'); await loadCams(); renderCams(); }
  catch (err) { $('#c-err').textContent = err.message; }
});
$('#btn-new-cam').onclick = () => openCam(null);

// ---------- настройки ----------
let getHours = null;
function renderSettings() {
  const st = S.settings;
  getHours = daysGrid($('#set-hours'), st.workshopHours, st.workshopHours);
  $('#set-closed').value = (st.closedDates || []).join('\n');
  $('#set-phone').value = st.contactPhone || '';
  $('#set-max').value = st.maxViewersPerLink;
}
$('#set-save').onclick = async (e) => {
  e.target.disabled = true; $('#set-err').textContent = '';
  try {
    S.settings = await api('/settings', 'PUT', {
      workshopHours: getHours(),
      closedDates: $('#set-closed').value.split(/[\s,;]+/).filter(Boolean),
      contactPhone: $('#set-phone').value,
      maxViewersPerLink: Number($('#set-max').value),
    });
    renderSettings(); await loadLinks(); toast('Ustawienia zapisane');
  } catch (err) { $('#set-err').textContent = err.message; }
  e.target.disabled = false;
};

// ---------- вкладки ----------
function switchTab(id) {
  $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === id));
  for (const t of ['links', 'cameras', 'settings']) $('#tab-' + t).hidden = t !== id;
  if (id === 'cameras') loadCams().then(renderCams).catch((e) => toast(e.message));
  else { for (const v of live.values()) v.remove(); live.clear(); }
  history.replaceState(null, '', '#' + id);
}
$$('.tabs button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));

// ---------- запуск ----------
async function start() {
  [S.me, S.cameras, S.settings] = await Promise.all([api('/me'), api('/cameras'), api('/settings')]);
  $('#me').textContent = S.me.user;
  $('#cnt-cams').textContent = S.cameras.length;
  if (location.pathname === '/admin/new') {
    // Окно из zlecenia в CRM: только форма, данные подставлены из адреса.
    $('#page-new').hidden = false;
    const q = Object.fromEntries(new URLSearchParams(location.search));
    const host = $('#new-host');
    const render = () => {
      host.innerHTML = '<div id="nf"></div><div class="toolbar" style="margin:16px 0 0;justify-content:flex-end"><button class="btn btn-outline" type="button" id="nf-cancel">Anuluj</button><button class="btn btn-primary" type="button" id="nf-save">Utwórz link</button></div>';
      if (!S.cameras.some((c) => c.enabled)) { $('#nf').innerHTML = '<div class="note">Nie dodano jeszcze żadnej kamery. Dodaj kamery w module „Kamery” w CRM.</div>'; $('#nf-save').disabled = true; }
      const form = S.cameras.some((c) => c.enabled) ? linkForm($('#nf'), null, q) : null;
      $('#nf-cancel').onclick = () => notifyParent({ type: 'pulsecar-live:close' });
      $('#nf-save').onclick = async (e) => {
        e.target.disabled = true; form.error('');
        try {
          const l = await api('/links', 'POST', form.data());
          notifyParent({ type: 'pulsecar-live:link-created', link: l });
          resultView(host, l);
          host.insertAdjacentHTML('beforeend', '<div class="toolbar" style="margin:16px 0 0;justify-content:flex-end"><button class="btn btn-outline" type="button" id="nf-again">Utwórz kolejny</button><button class="btn btn-primary" type="button" id="nf-done">Gotowe</button></div>');
          $('#nf-again').onclick = render;
          $('#nf-done').onclick = () => notifyParent({ type: 'pulsecar-live:close' });
        } catch (err) { form.error(err.message); e.target.disabled = false; }
      };
    };
    render();
    return;
  }
  $('#page-main').hidden = false;
  renderSettings();
  await loadLinks();
  const tab = location.hash.slice(1);
  switchTab(['links', 'cameras', 'settings'].includes(tab) ? tab : 'links');
  setInterval(() => { if (!$('#tab-links').hidden && !dlgLink.open) loadLinks().catch(() => {}); }, 30000);
}
start().catch((e) => toast(e.message));
})();
