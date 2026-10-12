// Имитация CRM для проверки встраивания: страница с кнопкой «Udostępnij podgląd» и бэкенд-эндпоинт.
// Запуск: LIVE=http://127.0.0.1:3010 KEY=... PORT=8099 node test/crm-sim.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const LIVE = process.env.LIVE || 'http://127.0.0.1:3010';
const KEY = process.env.KEY;
const PORT = Number(process.env.PORT) || 8099;
const embedJs = fs.readFileSync(path.join(dir, '../../crm-integration/pulsecar-live-embed.js'));

const page = `<!doctype html><meta charset="utf-8"><title>CRM</title>
<body style="font:14px system-ui;padding:20px"><h1>Zlecenie ZL/2026/1052</h1>
<button id="share">Udostępnij podgląd na żywo</button> <button id="panel">Moduł Kamery</button>
<pre id="log"></pre><div id="mount" style="margin-top:12px"></div>
<script src="/embed.js"></script>
<script>
PulsecarLive.configure({ embedUrlEndpoint: '/api/live-cameras/embed-url', moduleOrigin: '${new URL(LIVE).origin}' });
const log = (m) => { document.getElementById('log').textContent += m + '\\n'; };
document.getElementById('share').onclick = () => PulsecarLive.openNewLink(
  { plate: 'WE 3305P', client: 'Olga Petrenko', car: 'Kia Ceed', orderNo: 'ZL/2026/1052', orderId: '1052' },
  { onCreated: (l) => { window.__created = l; log('CREATED ' + l.url + ' order=' + l.orderId); }, onClose: () => { window.__closed = true; log('CLOSED'); } });
document.getElementById('panel').onclick = () => PulsecarLive.mountPanel(document.getElementById('mount'), { height: '700px' });
</script>`;

http.createServer(async (req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page); }
  if (req.url === '/embed.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(embedJs); }
  if (req.url === '/api/live-cameras/embed-url' && req.method === 'POST') {
    let b = ''; for await (const c of req) b += c;
    const { next } = JSON.parse(b || '{}');
    const r = await fetch(LIVE + '/api/v1/embed-sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ user: { id: '7', name: 'Ali (CRM)' }, next }) });
    res.writeHead(r.status, { 'content-type': 'application/json' }); return res.end(await r.text());
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => console.log('CRM sim on', PORT));
