// Веб-версия приложения для клиентов → panel/public/app (открывается на https://panel.pulsecar.tech/app/).
// Запуск: npm run build:web
import { execSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
const here = new URL('..', import.meta.url).pathname;
execSync('npx expo export --platform web --output-dir dist', { cwd: here, stdio: 'inherit' });
cpSync(here + 'web', here + 'dist', { recursive: true });
let html = readFileSync(here + 'dist/index.html', 'utf8');
html = html.replace('<html lang="en">', '<html lang="pl">').replace('httpEquiv=', 'http-equiv=').replace('<body>', '<body style="background:#101113">')
  .replace('<link rel="icon" href="/app/favicon.ico"/>', `<link rel="icon" href="/app/favicon.ico"/>
<link rel="manifest" href="/app/manifest.webmanifest"/>
<link rel="apple-touch-icon" href="/app/apple-touch-icon.png"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
<meta name="apple-mobile-web-app-title" content="Pulsecar"/>`);
writeFileSync(here + 'dist/index.html', html);
const out = here + '../panel/public/app';
if (existsSync(out)) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });
cpSync(here + 'dist', out, { recursive: true });
console.log('→ panel/public/app');
