'use strict';
// Камеры: адрес потока, регистрация в go2rtc, проверка подключения, снимок.
const net = require('net');
const crypto = require('crypto');
const cfg = require('./config');
const store = require('./store');

const G = cfg.GO2RTC_URL;
const enc = encodeURIComponent;

// RTSP-адрес камеры. Tapo: rtsp://login:hasło@IP:554/stream1 (stream2 — низкое качество).
function rtspUrl(c) {
  if (c.type === 'tapo') return `rtsp://${enc(c.user)}:${enc(c.pass)}@${c.host}:${c.port || 554}/${c.stream || 'stream1'}`;
  return c.url;
}
// Источник для go2rtc. #video=copy — берём только видео, звук отбрасывается ещё на сервере.
const source = (c) => `ffmpeg:${rtspUrl(c)}#video=copy`;

// Проверка и нормализация данных камеры из формы/API. Возвращает {value} или {error}.
const HOST = /^[a-zA-Z0-9.-]{1,253}$/;
function parse(b, prev = {}) {
  const c = { ...prev };
  const s = (v, n = 120) => String(v ?? '').trim().slice(0, n);
  if (b.name !== undefined) c.name = s(b.name, 60);
  if (!c.name) return { error: 'Podaj nazwę kamery, np. „Stanowisko 1”' };
  if (b.type !== undefined) c.type = b.type === 'rtsp' ? 'rtsp' : 'tapo';
  c.type ||= 'tapo';
  if (b.enabled !== undefined) c.enabled = !!b.enabled;
  if (c.enabled === undefined) c.enabled = true;
  if (c.type === 'tapo') {
    if (b.host !== undefined) c.host = s(b.host, 253);
    if (b.port !== undefined) c.port = Number(b.port) || 554;
    if (b.user !== undefined) c.user = s(b.user, 64);
    if (b.pass !== undefined && b.pass !== '') c.pass = String(b.pass).slice(0, 128);   // пустое поле при редактировании = не менять
    if (b.stream !== undefined) c.stream = b.stream === 'stream2' ? 'stream2' : 'stream1';
    c.stream ||= 'stream1'; c.port ||= 554;
    if (!c.host || !HOST.test(c.host)) return { error: 'Podaj adres IP kamery, np. 192.168.3.20' };
    if (!(c.port > 0 && c.port < 65536)) return { error: 'Nieprawidłowy port' };
    if (!c.user || !c.pass) return { error: 'Podaj login i hasło konta kamery (Tapo → Ustawienia zaawansowane → Konto kamery)' };
    delete c.url;
  } else {
    if (b.url !== undefined && b.url !== '') c.url = s(b.url, 500);
    let u; try { u = new URL(c.url); } catch { return { error: 'Podaj pełny adres rtsp://…' }; }
    if (!/^rtsps?:$/.test(u.protocol)) return { error: 'Adres musi zaczynać się od rtsp:// lub rtsps://' };
    delete c.host; delete c.port; delete c.user; delete c.pass; delete c.stream;
  }
  return { value: c };
}

// Что отдаём наружу: без пароля.
function view(c) {
  const { pass, url, ...rest } = c;
  const out = { ...rest, hasPassword: !!pass };
  if (c.type === 'rtsp' && url) { try { const u = new URL(url); if (u.password) u.password = '***'; out.url = u.toString(); } catch { out.url = ''; } }
  out.address = c.type === 'tapo' ? `${c.host}:${c.port || 554}/${c.stream}` : out.url;
  return out;
}

// ---------- go2rtc ----------
async function g2r(method, path, timeout = 8000) {
  return fetch(G + path, { method, signal: AbortSignal.timeout(timeout) });
}
async function register(c) {
  if (!c.enabled) return unregister(c.id);
  const r = await g2r('PUT', `/api/streams?name=${enc(c.id)}&src=${enc(source(c))}`);
  if (!r.ok) throw new Error('go2rtc: ' + (await r.text()).trim());
}
async function unregister(id) {
  await g2r('DELETE', `/api/streams?src=${enc(id)}`).catch(() => {});
}
// Держим go2rtc в соответствии с базой (на случай перезапуска go2rtc).
async function sync() {
  try {
    const r = await g2r('GET', '/api/streams');
    const have = await r.json();
    for (const c of store.db.cameras) if (c.enabled && !have[c.id]) await register(c);
    for (const name of Object.keys(have)) {
      const c = store.db.cameras.find((x) => x.id === name);
      if ((name.startsWith('c_') && (!c || !c.enabled)) || name.startsWith('t_')) await unregister(name);
    }
    return true;
  } catch (e) { console.error('go2rtc недоступен:', e.message); return false; }
}

// Снимок с камеры (JPEG) или null. Кэш 10 секунд, чтобы не дёргать камеру.
const snaps = new Map();
async function snapshot(id, timeout = 15000) {
  const hit = snaps.get(id);
  if (hit && Date.now() - hit.at < 10e3) return hit.buf;
  try {
    const r = await g2r('GET', `/api/frame.jpeg?src=${enc(id)}`, timeout);
    const buf = Buffer.from(await r.arrayBuffer());
    const ok = r.ok && buf.length > 1000 && buf[0] === 0xff && buf[1] === 0xd8;
    if (ok) snaps.set(id, { at: Date.now(), buf });
    return ok ? buf : null;
  } catch { return null; }
}

// ---------- диагностика RTSP: понятная причина, почему камера не открывается ----------
function probe(url, timeout = 6000) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch { return resolve({ ok: false, code: 'bad_url' }); }
    if (u.protocol !== 'rtsp:') return resolve({ ok: true, code: 'skipped' });
    const user = decodeURIComponent(u.username), pass = decodeURIComponent(u.password);
    u.username = ''; u.password = '';
    const target = u.toString();
    const sock = net.connect(Number(u.port) || 554, u.hostname);
    let buf = '', cseq = 0, triedAuth = false, done = false;
    const finish = (r) => { if (done) return; done = true; sock.destroy(); resolve(r); };
    const send = (auth) => sock.write(`DESCRIBE ${target} RTSP/1.0\r\nCSeq: ${++cseq}\r\nAccept: application/sdp\r\nUser-Agent: PulsecarLive\r\n${auth ? 'Authorization: ' + auth + '\r\n' : ''}\r\n`);
    sock.setTimeout(timeout, () => finish({ ok: false, code: cseq ? 'no_answer' : 'timeout' }));
    sock.on('error', (e) => finish({ ok: false, code: e.code === 'ECONNREFUSED' ? 'refused' : (e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' || e.code === 'ETIMEDOUT') ? 'timeout' : 'net', detail: e.code }));
    sock.on('connect', () => send());
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const head = buf.slice(0, end); buf = '';
      const status = Number((head.match(/^RTSP\/1\.0 (\d{3})/) || [])[1]);
      if (status === 200) return finish({ ok: true, code: 'ok' });
      if (status === 401 && !triedAuth && user) {
        triedAuth = true;
        const wa = (head.match(/^WWW-Authenticate:\s*(Digest .+)$/im) || head.match(/^WWW-Authenticate:\s*(Basic.*)$/im) || [])[1] || '';
        if (/^Basic/i.test(wa)) return send('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
        const realm = (wa.match(/realm="([^"]*)"/) || [])[1], nonce = (wa.match(/nonce="([^"]*)"/) || [])[1];
        if (!nonce) return finish({ ok: false, code: 'auth' });
        const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
        const resp = md5(`${md5(`${user}:${realm}:${pass}`)}:${md5(`DESCRIBE:${target}`)}`);
        return send(`Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${target}", response="${resp}"`);
      }
      if (status === 401) return finish({ ok: false, code: 'auth' });
      if (status === 404) return finish({ ok: false, code: 'not_found' });
      finish({ ok: false, code: 'rtsp_' + status });
    });
  });
}

const MESSAGES = {
  auth: 'Kamera odrzuciła login lub hasło. Sprawdź „Konto kamery” w aplikacji Tapo (to nie jest hasło do konta Tapo) i włącz: Ja → Tapo Lab → Zgodność z rozwiązaniami innych firm. Po kilku błędnych próbach kamera blokuje logowanie na ok. 30 min.',
  timeout: 'Brak połączenia z kamerą pod tym adresem. Sprawdź adres IP i czy serwer ma dostęp do sieci warsztatu (Tailscale).',
  refused: 'Kamera odrzuca połączenie na tym porcie. Sprawdź port (Tapo: 554) i czy kamera nie jest w trybie prywatności.',
  no_answer: 'Urządzenie pod tym adresem nie odpowiada jak kamera RTSP.',
  not_found: 'Kamera nie ma takiego strumienia. Dla Tapo użyj stream1 lub stream2.',
  bad_url: 'Nieprawidłowy adres kamery.',
  net: 'Błąd sieci przy łączeniu z kamerą.',
  no_frame: 'Kamera odpowiada, ale nie wysłała obrazu. Sprawdź tryb prywatności w Tapo i spróbuj ponownie za chwilę.',
  go2rtc: 'Moduł wideo (go2rtc) nie działa. Sprawdź kontener go2rtc.',
};

// Полная проверка: RTSP-ответ + реальный кадр через go2rtc.
async function test(c) {
  const p = await probe(rtspUrl(c));
  if (!p.ok) return { ok: false, code: p.code, message: MESSAGES[p.code] || `Kamera zwróciła błąd (${p.code}).` };
  const tmp = 't_' + crypto.randomBytes(5).toString('hex');
  try {
    const r = await g2r('PUT', `/api/streams?name=${tmp}&src=${enc(source(c))}`);
    if (!r.ok) return { ok: false, code: 'go2rtc', message: MESSAGES.go2rtc };
  } catch { return { ok: false, code: 'go2rtc', message: MESSAGES.go2rtc }; }
  const buf = await snapshot(tmp, 20000);
  snaps.delete(tmp);
  await unregister(tmp);
  if (!buf) return { ok: false, code: 'no_frame', message: MESSAGES.no_frame };
  return { ok: true, snapshot: 'data:image/jpeg;base64,' + buf.toString('base64') };
}

module.exports = { parse, view, register, unregister, sync, snapshot, test, probe, source };
