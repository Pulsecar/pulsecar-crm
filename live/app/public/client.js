(() => {
'use strict';
const $ = (s) => document.querySelector(s);
const TZ = 'Europe/Warsaw';
const token = location.pathname.split('/')[2] || '';
const fmt = (iso) => new Date(iso).toLocaleString('pl-PL', { timeZone: TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const fmtLong = (iso) => new Date(iso).toLocaleString('pl-PL', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

let player = null, state = null, watchdog = 0;

function overlay(title, text) {
  $('#ov').hidden = !title;
  $('#ov-h').textContent = title || '';
  $('#ov-p').textContent = text || '';
}
function startVideo() {
  if (player) return;
  overlay('Łączenie z kamerą…', '');
  player = document.createElement('video-live');
  player.mode = 'mse,hls';
  $('#player').appendChild(player);
  player.src = new URL(`/v/${token}/ws`, location.href);
  const tag = document.createElement('div');
  tag.className = 'live-tag'; tag.id = 'tag'; tag.textContent = 'NA ŻYWO'; tag.hidden = true;
  $('#player').appendChild(tag);
  let since = Date.now();
  clearInterval(watchdog);
  watchdog = setInterval(() => {
    const v = player && player.video;
    const playing = v && v.readyState >= 2 && !v.paused;
    $('#tag').hidden = !playing;
    if (playing) { since = Date.now(); overlay(null); }
    else if (Date.now() - since > 12000) overlay('Kamera chwilowo niedostępna', 'Próbujemy połączyć się ponownie automatycznie.');
  }, 1000);
}
function stopVideo() {
  clearInterval(watchdog);
  if (player) { player.remove(); player = null; }
  const t = $('#tag'); if (t) t.remove();
}

async function refresh() {
  let d;
  try { d = await (await fetch(`/v/${encodeURIComponent(token)}/info`, { cache: 'no-store' })).json(); }
  catch { return; }
  if (d.plate) {
    $('#plate').hidden = false; $('#plate-t').textContent = d.plate;
    $('#info').hidden = false; $('#foot').hidden = false;
    $('#i-car').textContent = [d.car, d.orderNo && 'zlecenie ' + d.orderNo].filter(Boolean).join(' · ') || '—';
    $('#i-cam').textContent = d.camera || '—';
    $('#i-when').textContent = `${fmt(d.validFrom)} – ${fmt(d.validTo)}`;
    $('#foot').textContent = `Transmisja bez dźwięku, tylko obraz z Twojego stanowiska. Godziny transmisji: ${d.scheduleText}.` + (d.contactPhone ? ` Kontakt z warsztatem: ${d.contactPhone}.` : '');
  }
  if (d.state === state) return;
  state = d.state;
  if (state === 'live') return startVideo();
  stopVideo();
  const msg = {
    closed: d.nextOpen ? ['Warsztat jest teraz zamknięty', `Transmisja wznowi się ${fmtLong(d.nextOpen)}.`] : ['Transmisja zakończona', 'Dostęp wygaśnie przed kolejnym otwarciem warsztatu.'],
    not_started: ['Transmisja jeszcze się nie rozpoczęła', d.nextOpen ? `Obraz będzie dostępny od ${fmtLong(d.nextOpen)}.` : ''],
    expired: ['Link wygasł', 'Jeśli potrzebujesz dostępu ponownie, skontaktuj się z warsztatem.'],
    revoked: ['Link jest nieaktywny', 'Skontaktuj się z warsztatem, jeśli to pomyłka.'],
    no_camera: ['Kamera jest niedostępna', 'Skontaktuj się z warsztatem.'],
    not_found: ['Nie znaleziono linku', 'Sprawdź, czy link został skopiowany w całości.'],
  }[state] || ['Transmisja niedostępna', ''];
  overlay(msg[0], msg[1]);
}
refresh();
setInterval(refresh, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
