// Сквозная проверка модуля. Нужны запущенные app + go2rtc и тестовая камера (docker compose --profile demo up -d).
// Запуск: BASE=http://127.0.0.1:3010 ADMIN_PASSWORD=... CRM_API_KEY=... CRM_ORIGIN=https://panel.pulsecar.tech node test/e2e.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:3010';
const KEY = process.env.CRM_API_KEY;
const PASS = process.env.ADMIN_PASSWORD;
const CRM = process.env.CRM_ORIGIN || '';
const CAM = { host: process.env.FAKECAM_HOST || '127.0.0.1', port: Number(process.env.FAKECAM_PORT) || 18554, user: 'demo', pass: 'demo12345' };
let failed = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) failed++; };
const H = (extra = {}) => ({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...extra });
const call = async (path, method = 'GET', body, headers = H()) => {
  const r = await fetch(BASE + '/api/v1' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const H1 = 3600e3, D1 = 864e5;

function watch(path, ms = 6000, headers = {}) {
  return new Promise((res) => {
    const ws = new WebSocket(BASE.replace('http', 'ws') + path, { headers });
    let bytes = 0, codecs = null, opened = false;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { opened = true; ws.send(JSON.stringify({ type: 'mse', value: 'avc1.640029,avc1.64002A,avc1.640033,hvc1.1.6.L153.B0,mp4a.40.2,mp4a.40.5,flac,opus' })); };
    ws.onmessage = (e) => { if (typeof e.data === 'string') { const m = JSON.parse(e.data); if (m.type === 'mse') codecs = m.value; } else bytes += e.data.byteLength; };
    const done = (why) => res({ opened, bytes, codecs, why });
    ws.onclose = () => done('closed');
    ws.onerror = () => {};
    setTimeout(() => { done('timeout'); try { ws.close(); } catch {} }, ms);
  });
}

// --- доступ ---
let r = await fetch(BASE + '/healthz'); ok(r.status === 200, 'healthz: модуль и go2rtc работают');
ok((await call('/me', 'GET', undefined, {})).s === 401, 'API без ключа закрыт');
ok((await call('/me', 'GET', undefined, { Authorization: 'Bearer wrong' })).s === 401, 'неверный ключ отклонён');
ok((await call('/me')).j.user === 'CRM', 'API по ключу CRM');

// --- проверка камеры: понятные ошибки ---
let t;
if (/^127\.|^localhost$/.test(CAM.host)) console.log('SKIP неверный пароль камеры (go2rtc не проверяет пароль с localhost — проверка только для внешнего IP)');
else {
  t = await call('/cameras/test', 'POST', { name: 'X', type: 'tapo', ...CAM, pass: 'wrongpass' });
  ok(t.j.ok === false && t.j.code === 'auth', `неверный пароль камеры → «${(t.j.message || '').slice(0, 50)}…»`);
}
t = await call('/cameras/test', 'POST', { name: 'X', type: 'tapo', ...CAM, port: 1 });
ok(t.j.ok === false && t.j.code === 'refused', 'закрытый порт → понятная ошибка');
t = await call('/cameras/test', 'POST', { name: 'X', type: 'tapo', ...CAM, stream: 'stream1' });
ok(t.j.ok === true && t.j.snapshot?.startsWith('data:image/jpeg'), 'правильные данные → снимок с камеры');
ok((await call('/cameras', 'POST', { name: 'X', type: 'tapo', host: 'bad host!', user: 'a', pass: 'b' })).s === 400, 'неверный IP отклонён');

// --- добавление камер ---
let c = await call('/cameras', 'POST', { name: 'Stanowisko 1', type: 'tapo', ...CAM });
ok(c.s === 201 && c.j.id && !('pass' in c.j) && c.j.hasPassword, 'камера добавлена, пароль наружу не отдаётся');
const cam1 = c.j.id;
c = await call('/cameras', 'POST', { name: 'Stanowisko 2', type: 'rtsp', url: `rtsp://${CAM.user}:${CAM.pass}@${CAM.host}:${CAM.port}/stream2` });
ok(c.s === 201 && !c.j.url.includes(CAM.pass), 'камера RTSP добавлена, пароль в адресе скрыт');
const cam2 = c.j.id;
r = await fetch(`${BASE}/api/v1/cameras/${cam1}/snapshot.jpg`, { headers: H() });
ok(r.status === 200 && r.headers.get('content-type') === 'image/jpeg', 'снимок добавленной камеры');
ok((await call(`/cameras/${cam1}`, 'PATCH', { name: 'Stanowisko 1 (podnośnik)' })).j.name === 'Stanowisko 1 (podnośnik)', 'переименование камеры, пароль сохранён');

// --- вход из CRM (embed) ---
let e = await call('/embed-sessions', 'POST', { user: { id: '7', name: 'Ali Abdurakhmanov' }, next: '/admin/new?plate=WB1&orderId=Z-77' });
ok(e.s === 200 && e.j.url.includes('/embed/start?t='), 'CRM получает одноразовую ссылку входа');
ok((await call('/embed-sessions', 'POST', { next: 'https://evil.example' })).s === 400, 'next на чужой адрес запрещён');
const startPath = new URL(e.j.url).pathname + new URL(e.j.url).search;
r = await fetch(BASE + startPath, { redirect: 'manual' });
const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
ok(r.status === 302 && r.headers.get('location') === '/admin/new?plate=WB1&orderId=Z-77' && cookie.startsWith('pl_live='), 'ссылка входа → сессия + переход в форму');
ok((await fetch(BASE + startPath, { redirect: 'manual' })).status === 403, 'ссылка входа одноразовая');
const CH = (extra = {}) => ({ cookie, 'Content-Type': 'application/json', ...extra });
ok((await call('/me', 'GET', undefined, { cookie })).j.user === 'Ali Abdurakhmanov', 'сессия пользователя CRM');
ok((await call('/embed-sessions', 'POST', {}, CH())).s === 403, 'сессия не может выдавать ссылки входа');
r = await fetch(BASE + '/admin/new', { headers: { cookie } });
ok((r.headers.get('content-security-policy') || '').includes(`frame-ancestors 'self'${CRM ? ' ' + CRM : ''}`), 'встраивание разрешено только CRM (frame-ancestors)');

// --- ссылки ---
let l = await call('/links', 'POST', { cameraId: cam1, plate: 'wb 4721k', client: 'Marek Nowak', orderNo: 'ZL/1048', orderId: 'Z-77', validFrom: iso(-60e3), validTo: iso(2 * D1), scheduleMode: 'always' }, CH({ Origin: 'https://evil.example' }));
ok(l.s === 403, 'запрос с чужого сайта отклонён');
l = await call('/links', 'POST', { cameraId: cam1, plate: 'wb 4721k', client: 'Marek Nowak', orderNo: 'ZL/1048', orderId: 'Z-77', validFrom: iso(-60e3), validTo: iso(2 * D1), scheduleMode: 'always' }, CH(CRM ? { Origin: CRM } : {}));
ok(l.s === 201 && l.j.plate === 'WB 4721K' && l.j.state === 'live' && l.j.createdBy === 'Ali Abdurakhmanov', 'ссылка создана из CRM, статус live');
ok(l.j.smsText.includes(l.j.url) && l.j.smsText.includes('bez dźwięku'), 'SMS-текст содержит ссылку');
const L1 = l.j, tok1 = new URL(L1.url).pathname.split('/')[2];
ok((await call('/links?orderId=Z-77')).j.length === 1, 'поиск ссылок по заказу CRM');

let info = await (await fetch(`${BASE}/v/${tok1}/info`)).json();
ok(info.state === 'live' && !JSON.stringify(info).includes('rtsp') && !JSON.stringify(info).includes(CAM.pass), 'страница клиента: live, без адреса и пароля камеры');
let w = await watch(`/v/${tok1}/ws`);
ok(w.opened && w.bytes > 30000, `клиент получает видео (${Math.round(w.bytes / 1024)} КБ за 6 с)`);
ok(w.codecs && !/mp4a|opus|flac/.test(w.codecs), `звук отсечён (кодеки: ${w.codecs})`);
w = await watch(`/api/v1/cameras/${cam1}/ws`, 3000, { cookie });
ok(w.opened && w.bytes > 0, 'просмотр камеры в панели');
w = await watch(`/api/v1/cameras/${cam1}/ws`, 1500);
ok(!w.opened, 'просмотр камеры без входа закрыт');

// валидация
ok((await call('/links', 'POST', { cameraId: cam1, plate: 'A', validFrom: iso(D1), validTo: iso(H1) })).s === 400, '«до» раньше «от» → ошибка');
ok((await call('/links', 'POST', { cameraId: cam1, plate: 'A', validTo: iso(120 * D1) })).s === 400, 'срок больше 90 дней → ошибка');
ok((await call('/links', 'POST', { cameraId: cam1, validTo: iso(D1) })).s === 400, 'без номера авто → ошибка');
ok((await call('/links', 'POST', { cameraId: cam1, plate: 'A', validTo: iso(D1), scheduleMode: 'custom', schedule: { mon: ['18:00', '08:00'] } })).s === 400, 'часы «от» позже «до» → ошибка');

// дата «от» в будущем
l = await call('/links', 'POST', { cameraId: cam1, plate: 'WI 1', validFrom: iso(3 * H1), validTo: iso(D1), scheduleMode: 'always' });
ok(l.j.state === 'not_started' && l.j.nextOpen, `доступ ещё не начался, откроется ${l.j.nextOpen}`);
w = await watch(`/v/${new URL(l.j.url).pathname.split('/')[2]}/ws`, 1500);
ok(!w.opened, 'до даты «от» видео не отдаётся');

// свои часы: окно, в которое «сейчас» не попадает
const nowW = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
const hNow = Number(nowW.slice(0, 2));
const win = hNow < 12 ? ['13:00', '14:00'] : ['01:00', '02:00'];
const allDays = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, win]));
l = await call('/links', 'POST', { cameraId: cam1, plate: 'WX 2', validTo: iso(3 * D1), scheduleMode: 'custom', schedule: allDays });
ok(l.j.state === 'closed' && l.j.nextOpen && l.j.scheduleText === `pn–nd ${win[0]}–${win[1]}`, `вне часов ссылки: closed, откроется ${l.j.nextOpen}`);
w = await watch(`/v/${new URL(l.j.url).pathname.split('/')[2]}/ws`, 1500);
ok(!w.opened, 'вне часов видео не отдаётся');
info = await (await fetch(`${BASE}/v/${new URL(l.j.url).pathname.split('/')[2]}/info`)).json();
ok(info.state === 'closed' && info.scheduleText, 'клиент видит, когда трансляция возобновится');

// часы мастерской + праздник сегодня
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
const s0 = (await call('/settings')).j;
await call('/settings', 'PUT', { workshopHours: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, ['00:00', '23:59']])), closedDates: [today] });
l = await call('/links', 'POST', { cameraId: cam1, plate: 'WE 3', validTo: iso(3 * D1), scheduleMode: 'workshop' });
ok(l.j.state === 'closed', 'праздник в настройках → ссылка «часы мастерской» закрыта');
await call('/settings', 'PUT', { closedDates: [] });
ok((await call(`/links/${l.j.id}`)).j.state === 'live', 'сняли праздник → ссылка снова активна');
await call('/settings', 'PUT', { workshopHours: s0.workshopHours });

// лимит устройств
const ws3 = [watch(`/v/${tok1}/ws`, 5000), watch(`/v/${tok1}/ws`, 5000), watch(`/v/${tok1}/ws`, 5000)];
await new Promise((x) => setTimeout(x, 1500));
w = await watch(`/v/${tok1}/ws`, 1500);
ok(!w.opened, '4-е устройство на одну ссылку не пускается');
await Promise.all(ws3);

// смена камеры и отзыв обрывают трансляцию
let running = watch(`/v/${tok1}/ws`, 30000);
await new Promise((x) => setTimeout(x, 2500));
ok((await call(`/links/${L1.id}`, 'PATCH', { cameraId: cam2 }, CH())).j.cameraId === cam2, 'машину перенесли на другой пост');
w = await running;
ok(w.why === 'closed', 'старая трансляция оборвана — клиент переподключится к новой камере');
w = await watch(`/v/${tok1}/ws`, 4000);
ok(w.opened && w.bytes > 5000, 'клиент смотрит новый пост по той же ссылке');
ok((await call(`/links/${L1.id}`, 'PATCH', { validTo: iso(5 * D1) })).s === 200, 'продление срока');
running = watch(`/v/${tok1}/ws`, 30000);
await new Promise((x) => setTimeout(x, 2500));
await call(`/links/${L1.id}`, 'PATCH', { revoked: true });
w = await running;
ok(w.why === 'closed', 'отзыв ссылки мгновенно обрывает трансляцию');
ok((await (await fetch(`${BASE}/v/${tok1}/info`)).json()).state === 'revoked', 'клиент видит «ссылка неактивна»');
ok((await call(`/links/${L1.id}`, 'PATCH', { validTo: iso(D1) })).s === 409, 'отозванную ссылку не вернуть');

// удаление камеры с активными ссылками
ok((await call(`/cameras/${cam1}`, 'DELETE')).s === 409, 'нельзя удалить камеру с активными ссылками');
const tmp = await call('/cameras', 'POST', { name: 'Tymczasowa', type: 'tapo', ...CAM });
ok((await call(`/cameras/${tmp.j.id}`, 'DELETE')).s === 200, 'камера без ссылок удаляется');

// вход по паролю
r = await fetch(BASE + '/admin/login', { method: 'POST', body: 'password=wrong', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
ok(r.headers.get('location') === '/admin?e=1', 'неверный пароль панели отклонён');
r = await fetch(BASE + '/admin/login', { method: 'POST', body: 'password=' + encodeURIComponent(PASS), headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
ok((r.headers.get('set-cookie') || '').startsWith('pl_live='), 'вход по паролю работает');

console.log(failed ? `\nНЕ ПРОШЛО: ${failed}` : '\nВсе проверки пройдены');
process.exit(failed ? 1 : 0);
