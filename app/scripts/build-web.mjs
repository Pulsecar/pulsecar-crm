// Веб-версия приложения для клиентов → panel/public/app (открывается на https://panel.pulsecar.tech/app/).
// Запуск: npm run build:web
import { execSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
const here = new URL('..', import.meta.url).pathname;
execSync('npx expo export --platform web --output-dir dist', { cwd: here, stdio: 'inherit' });
cpSync(here + 'web', here + 'dist', { recursive: true });
// git игнорирует папки node_modules — шрифты иконок переносим в assets/vendor и правим пути в бандле.
// Нужен только Ionicons, остальные наборы иконок не используются.
const fontsDir = here + 'dist/assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/';
mkdirSync(here + 'dist/assets/vendor', { recursive: true });
for (const f of readdirSync(fontsDir)) if (f.startsWith('Ionicons.')) renameSync(fontsDir + f, here + 'dist/assets/vendor/' + f);
rmSync(here + 'dist/assets/node_modules', { recursive: true });
const jsDir = here + 'dist/_expo/static/js/web/';
for (const f of readdirSync(jsDir)) {
  const src = readFileSync(jsDir + f, 'utf8');
  writeFileSync(jsDir + f, src.replace(/\/assets\/node_modules\/@expo\/vector-icons\/build\/vendor\/react-native-vector-icons\/Fonts\//g, '/assets/vendor/'));
}
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
