'use strict';
// Pulsecar Live — модуль трансляций для CRM Pulsecar.
// Клиент никогда не получает адрес камеры: видео идёт только через этот сервер,
// и он проверяет ссылку при подключении и каждые 15 секунд.
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const store = require('./store');
const sch = require('./schedule');
const auth = require('./auth');
const cams = require('./cameras');
const links = require('./links');

store.load();
const db = () => store.db;
const G2R = new URL(cfg.GO2RTC_URL);
const PUB = path.join(__dirname, '..', 'public');
const TOKEN_RE = /^[A-Za-z0-9_-]{10,40}$/;

// ---------- HTTP-утилиты ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const ancestors = `'self'${cfg.CRM_ORIGIN ? ' ' + cfg.CRM_ORIGIN : ''}`;
const HTML_CSP = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self'; frame-ancestors ${ancestors}; base-uri 'none'; form-action 'self'`;
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };

function send(res, code, body, type = 'text/plain; charset=utf-8', extra = {}) {
  if (res.headersSent) return;
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SEC, ...extra });
  res.end(body);
}
const json = (res, code, obj, extra) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8', extra);
const err = (res, code, message) => json(res, code, { error: message });
const redirect = (res, to, extra = {}) => send(res, 302, '', undefined, { Location: to, ...extra });
function file(res, name, extra = {}) {
  const p = path.normalize(path.join(PUB, name));
  if (!p.startsWith(PUB + path.sep)) return send(res, 404, 'Not found');
  fs.readFile(p, (e, buf) => {
    if (e) return send(res, 404, 'Not found');
    const type = TYPES[path.extname(p)] || 'application/octet-stream';
    send(res, 200, buf, type, type.startsWith('text/html') ? { 'Content-Security-Policy': HTML_CSP, ...extra } : extra);
  });
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((ok, fail) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { fail(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if ((req.headers['content-type'] || '').includes('application/json')) { try { ok(JSON.parse(raw || '{}')); } catch { fail(new Error('bad json')); } }
      else ok(Object.fromEntries(new URLSearchParams(raw)));
    });
    req.on('error', fail);
  });
}
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
// Запросы из браузера разрешены только с адреса модуля и из CRM.
function originOk(req) {
  const o = req.headers.origin;
  return !o || o === cfg.PUBLIC_ORIGIN || (cfg.CRM_ORIGIN && o === cfg.CRM_ORIGIN);
}

// Скрипт плеера берём у go2rtc и кэшируем.
let playerJs = null;
async function player(res) {
  try {
    if (!playerJs) {
      const r = await fetch(cfg.GO2RTC_URL + '/video-rtc.js', { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error();
      playerJs = Buffer.from(await r.arrayBuffer());
    }
    send(res, 200, playerJs, TYPES['.js'], { 'Cache-Control': 'public, max-age=3600' });
  } catch { send(res, 502, 'player unavailable'); }
}

// ---------- зрители ----------
const viewers = new Map();       // token -> Set<conn>
const adminConns = new Set();
const viewerCount = (token) => (viewers.get(token) || new Set()).size;
const linkView = (l) => links.view(l, viewerCount(l.token));
const camView = (c) => ({ ...cams.view(c), activeLinks: db().links.filter((l) => l.cameraId === c.id && ['live', 'closed', 'not_started'].includes(links.access(l).state)).length, watching: db().links.filter((l) => l.cameraId === c.id).reduce((a, l) => a + viewerCount(l.token), 0) });

function enforce() {
  for (const [token, set] of viewers) {
    const l = db().links.find((x) => x.token === token);
    const ok = l && links.access(l).state === 'live';
    for (const c of [...set]) if (!ok || c.cam !== l.cameraId) c.kill();
  }
  for (const c of [...adminConns]) { const cam = db().cameras.find((x) => x.id === c.cam); if (!cam || !cam.enabled) c.kill(); }
}
function dropCamera(id) {
  for (const set of viewers.values()) for (const c of [...set]) if (c.cam === id) c.kill();
  for (const c of [...adminConns]) if (c.cam === id) c.kill();
}
setInterval(enforce, 15000).unref();

// ---------- HLS (старые iPhone без MSE) ----------
function hls(req, res, file, search) {
  const up = http.get(new URL(`/api/hls/${file}${search}`, G2R), (r) => {
    res.writeHead(r.statusCode, { 'Content-Type': r.headers['content-type'] || 'application/octet-stream', 'Cache-Control': 'no-store', ...SEC });
    r.pipe(res);
  });
  up.on('error', () => send(res, 502, 'stream unavailable'));
}

// ---------- API для панели и бэкенда CRM ----------
async function api(req, res, p, u, user) {
  const m = req.method;
  const seg = p.split('/').slice(3);    // /api/v1/<seg0>/<seg1>/<seg2>
  if (m !== 'GET' && m !== 'DELETE' && !(req.headers['content-type'] || '').includes('application/json')) return err(res, 415, 'Wymagany Content-Type: application/json');
  if (m !== 'GET' && user.via === 'session' && !originOk(req)) return err(res, 403, 'Niedozwolone źródło żądania');
  const body = m === 'POST' || m === 'PATCH' || m === 'PUT' ? await readBody(req) : {};

  if (seg[0] === 'me' && m === 'GET') return json(res, 200, { user: user.name, crmOrigin: cfg.CRM_ORIGIN, publicUrl: cfg.PUBLIC_URL });

  // --- кто входит в панель из CRM: одноразовая ссылка (только по API-ключу) ---
  if (seg[0] === 'embed-sessions' && m === 'POST') {
    if (user.via !== 'apikey') return err(res, 403, 'Tylko dla backendu CRM (klucz API)');
    let next = String(body.next || '/admin');
    if (!/^\/admin(\/new)?(\?[^#]*)?(#[\w-]*)?$/.test(next)) return err(res, 400, 'next musi wskazywać na /admin lub /admin/new');
    const u2 = body.user || {};
    const t = auth.createEmbed({ name: String(u2.name || 'CRM').slice(0, 60), id: String(u2.id || '').slice(0, 60) }, next);
    return json(res, 200, { url: `${cfg.PUBLIC_URL}/embed/start?t=${t}`, expiresIn: 120 });
  }

  // --- камеры ---
  if (seg[0] === 'cameras') {
    if (!seg[1] && m === 'GET') return json(res, 200, db().cameras.map(camView));
    if (seg[1] === 'test' && m === 'POST') {
      const prev = body.id ? db().cameras.find((c) => c.id === body.id) : undefined;
      const r = cams.parse(body, prev || {});
      if (r.error) return err(res, 400, r.error);
      return json(res, 200, await cams.test(r.value));
    }
    if (!seg[1] && m === 'POST') {
      const r = cams.parse(body, {});
      if (r.error) return err(res, 400, r.error);
      const c = { ...r.value, id: 'c_' + crypto.randomBytes(5).toString('hex'), createdAt: new Date().toISOString() };
      db().cameras.push(c); store.save();
      try { await cams.register(c); } catch (e) { console.error(e.message); }
      return json(res, 201, camView(c));
    }
    const cam = db().cameras.find((c) => c.id === seg[1]);
    if (!cam) return err(res, 404, 'Nie znaleziono kamery');
    if (!seg[2] && m === 'GET') return json(res, 200, camView(cam));
    if (!seg[2] && m === 'PATCH') {
      const r = cams.parse(body, cam);
      if (r.error) return err(res, 400, r.error);
      Object.assign(cam, r.value); store.save();
      dropCamera(cam.id);
      try { await cams.register(cam); } catch (e) { console.error(e.message); }
      return json(res, 200, camView(cam));
    }
    if (!seg[2] && m === 'DELETE') {
      const active = db().links.filter((l) => l.cameraId === cam.id && ['live', 'closed', 'not_started'].includes(links.access(l).state)).length;
      if (active) return err(res, 409, `Kamera ma aktywne linki (${active}). Przenieś je na inną kamerę lub unieważnij.`);
      db().cameras = db().cameras.filter((c) => c !== cam); store.save();
      dropCamera(cam.id); await cams.unregister(cam.id);
      return json(res, 200, { ok: true });
    }
    if (seg[2] === 'snapshot.jpg' && m === 'GET') {
      if (!cam.enabled) return send(res, 404, 'disabled');
      const buf = await cams.snapshot(cam.id);
      return buf ? send(res, 200, buf, 'image/jpeg') : send(res, 504, 'no frame');
    }
    if (seg[2] === 'hls' && seg[3] && m === 'GET' && user.via === 'session') return hls(req, res, seg[3], u.search);
    return err(res, 404, 'Nie znaleziono');
  }

  // --- ссылки ---
  if (seg[0] === 'links') {
    if (!seg[1] && m === 'GET') {
      const q = u.searchParams;
      let list = [...db().links];
      if (q.get('orderId')) list = list.filter((l) => l.orderId === q.get('orderId'));
      if (q.get('cameraId')) list = list.filter((l) => l.cameraId === q.get('cameraId'));
      if (q.get('plate')) { const pl = q.get('plate').toUpperCase().replace(/\s/g, ''); list = list.filter((l) => l.plate.replace(/\s/g, '').includes(pl)); }
      if (q.get('active') === '1') list = list.filter((l) => ['live', 'closed', 'not_started'].includes(links.access(l).state));
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const limit = Math.min(Number(q.get('limit')) || 200, 1000);
      return json(res, 200, list.slice(0, limit).map(linkView));
    }
    if (!seg[1] && m === 'POST') {
      const r = links.create(body, user);
      if (r.error) return err(res, 400, r.error);
      return json(res, 201, linkView(r.value));
    }
    const l = db().links.find((x) => x.id === seg[1]);
    if (!l) return err(res, 404, 'Nie znaleziono linku');
    if (m === 'GET') return json(res, 200, linkView(l));
    if (m === 'PATCH') {
      if (l.revoked) return err(res, 409, 'Link jest unieważniony — utwórz nowy');
      const r = links.parse(body, l);
      if (r.error) return err(res, 400, r.error);
      Object.assign(l, r.value); l.updatedAt = new Date().toISOString(); l.updatedBy = user.name; store.save();
      enforce();
      return json(res, 200, linkView(l));
    }
    return err(res, 405, 'Metoda niedozwolona');
  }

  // --- настройки ---
  if (seg[0] === 'settings') {
    const st = db().settings;
    if (m === 'GET') return json(res, 200, { ...st, workshopHoursText: sch.text(st.workshopHours) });
    if (m === 'PUT' || m === 'PATCH') {
      if (body.workshopHours !== undefined) {
        const w = sch.parseWeekly(body.workshopHours);
        if (w.error) return err(res, 400, w.error);
        if (!w.value) return err(res, 400, 'Podaj godziny pracy warsztatu');
        st.workshopHours = w.value;
      }
      if (body.closedDates !== undefined) {
        if (!Array.isArray(body.closedDates) || body.closedDates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) return err(res, 400, 'Dni zamknięte w formacie RRRR-MM-DD');
        st.closedDates = [...new Set(body.closedDates)].sort().slice(0, 200);
      }
      if (body.contactPhone !== undefined) st.contactPhone = String(body.contactPhone).trim().slice(0, 30);
      if (body.maxViewersPerLink !== undefined) {
        const n = Number(body.maxViewersPerLink);
        if (!(n >= 1 && n <= 20)) return err(res, 400, 'Limit urządzeń: od 1 do 20');
        st.maxViewersPerLink = n;
      }
      store.save(); enforce();
      return json(res, 200, { ...st, workshopHoursText: sch.text(st.workshopHours) });
    }
  }
  return err(res, 404, 'Nie znaleziono');
}

// ---------- маршруты ----------
async function route(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const m = req.method;

  if (p.startsWith('/api/v1/')) {
    const user = auth.who(req);
    if (!user) return err(res, 401, 'Wymagane logowanie');
    return api(req, res, p, u, user);
  }

  if (m === 'GET' && p === '/') return redirect(res, '/admin');
  if (m === 'GET' && p === '/healthz') {
    const g = await fetch(cfg.GO2RTC_URL + '/api', { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
    return json(res, g ? 200 : 503, { ok: g, go2rtc: g, cameras: db().cameras.length });
  }
  if (m === 'GET' && p === '/player/video-rtc.js') return player(res);
  if (m === 'GET' && p.startsWith('/static/')) return file(res, p.slice(8), { 'Cache-Control': 'public, max-age=300' });

  // --- панель ---
  if (m === 'GET' && (p === '/admin' || p === '/admin/new')) return file(res, auth.session(req) ? 'admin.html' : 'login.html');
  if (m === 'POST' && p === '/admin/login') {
    if (!originOk(req)) return send(res, 403, 'Forbidden');
    if (!auth.allowAttempt(clientIp(req))) return redirect(res, '/admin?e=limit');
    const b = await readBody(req);
    if (!auth.checkPassword(b.password || '')) return redirect(res, '/admin?e=1');
    return redirect(res, '/admin', { 'Set-Cookie': auth.makeCookie({ name: 'admin' }) });
  }
  if (m === 'POST' && p === '/admin/logout') return redirect(res, '/admin', { 'Set-Cookie': auth.clearCookie() });
  if (m === 'GET' && p === '/embed/start') {
    const e = auth.useEmbed(u.searchParams.get('t') || '');
    if (!e) return send(res, 403, 'Link logowania wygasł. Odśwież stronę w CRM.');
    return redirect(res, e.next, { 'Set-Cookie': auth.makeCookie(e.user) });
  }

  // --- диагностика плеера клиента (что не сработало на телефоне) → в лог контейнера ---
  const dg = p.match(/^\/v\/([A-Za-z0-9_-]+)\/diag$/);
  if (m === 'POST' && dg && TOKEN_RE.test(dg[1])) {
    let b = {};
    try { b = await readBody(req, 2048); } catch { /* ignore */ }
    console.log('[client]', dg[1].slice(0, 6), JSON.stringify(b).slice(0, 600));
    return send(res, 204, '');
  }

  // --- страница клиента ---
  const v = p.match(/^\/v\/([A-Za-z0-9_-]+)(?:\/(info|hls\/([\w.-]+)))?$/);
  if (m === 'GET' && v) {
    if (!v[2]) return file(res, 'client.html');
    const l = TOKEN_RE.test(v[1]) ? db().links.find((x) => x.token === v[1]) : null;
    const a = links.access(l);
    if (v[3]) return a.state === 'live' ? hls(req, res, v[3], u.search) : send(res, 403, 'Forbidden');
    if (!l) return json(res, 404, a);
    const cam = db().cameras.find((c) => c.id === l.cameraId);
    return json(res, 200, {
      ...a, plate: l.plate, car: l.car, orderNo: l.orderNo, camera: cam ? cam.name : '',
      validFrom: l.validFrom, validTo: l.validTo, scheduleText: sch.text(links.weekly(l)),
      contactPhone: db().settings.contactPhone,
    });
  }

  send(res, 404, 'Not found');
}

// ---------- видео: проверка + проксирование WebSocket в go2rtc ----------
function pipe(req, socket, head, cam, onClose) {
  let closed = false;
  const up = net.connect(Number(G2R.port) || 80, G2R.hostname);
  const conn = { cam, kill() { if (closed) return; closed = true; up.destroy(); socket.destroy(); onClose(conn); } };
  up.on('connect', () => {
    const lines = [`GET /api/ws?src=${encodeURIComponent(cam)} HTTP/1.1`, `Host: ${G2R.host}`, 'Upgrade: websocket', 'Connection: Upgrade'];
    for (const h of ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions', 'sec-websocket-protocol']) if (req.headers[h]) lines.push(`${h}: ${req.headers[h]}`);
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  for (const s of [up, socket]) { s.on('error', conn.kill); s.on('close', conn.kill); }
  return conn;
}
const deny = (socket, code, text) => socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);

function onUpgrade(req, socket, head) {
  const p = new URL(req.url, 'http://x').pathname;

  const a = p.match(/^\/api\/v1\/cameras\/([\w-]+)\/ws$/);
  if (a) {
    if (!auth.session(req) || !originOk(req)) return deny(socket, 401, 'Unauthorized');
    const cam = db().cameras.find((c) => c.id === a[1]);
    if (!cam || !cam.enabled) return deny(socket, 404, 'Not Found');
    adminConns.add(pipe(req, socket, head, cam.id, (x) => adminConns.delete(x)));
    return;
  }

  const m = p.match(/^\/v\/([A-Za-z0-9_-]+)\/ws$/);
  if (!m || !TOKEN_RE.test(m[1])) return deny(socket, 404, 'Not Found');
  const l = db().links.find((x) => x.token === m[1]);
  if (links.access(l).state !== 'live') return deny(socket, 403, 'Forbidden');
  const set = viewers.get(l.token) || new Set();
  if (set.size >= db().settings.maxViewersPerLink) return deny(socket, 429, 'Too Many Requests');
  const c = pipe(req, socket, head, l.cameraId, (x) => { set.delete(x); if (!set.size) viewers.delete(l.token); });
  set.add(c); viewers.set(l.token, set);
  l.views++; l.lastViewAt = new Date().toISOString(); store.save();
}

// ---------- запуск ----------
const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    console.error(e);
    if (e.message === 'bad json' || e.message === 'too large') err(res, 400, 'Nieprawidłowe dane');
    else err(res, 500, 'Błąd serwera');
  });
});
server.on('upgrade', onUpgrade);
server.listen(cfg.PORT, cfg.HOST, () => console.log(`Pulsecar Live: ${cfg.HOST}:${cfg.PORT} → ${cfg.PUBLIC_URL}`));
cams.sync();
setInterval(cams.sync, 60e3).unref();
