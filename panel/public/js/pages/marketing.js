import { html, useState, useApp, Icon } from '../lib.js';

// Раздел «Маркетинг»: текущая панель бота Instagram/TikTok, встроенная в CRM
export default function Marketing() {
  const app = useApp();
  const url = app.features.marketingUrl;
  const [key, setKey] = useState(0);
  if (!url) return html`<div class="page-head"><h1>Маркетинг</h1></div>
    <div class="card">Адрес панели маркетинга не задан. Укажите его в .env сервера: <code>MARKETING_URL=https://panel.pulsecar.tech/marketing/</code> (инструкция — в README).</div>`;
  return html`
    <div class="page-head"><h1>Маркетинг</h1><span class="muted small">Автопостинг Instagram / TikTok</span>
      <div class="actions"><button class="btn" onClick=${() => setKey(key + 1)}>Обновить</button>
        <a class="btn" href=${url} target="_blank" rel="noopener">Открыть отдельно <${Icon} n="external" /></a></div></div>
    <div class="iframe-wrap"><iframe key=${key} src=${url} title="Маркетинг" allow="clipboard-write"></iframe></div>
    <div class="muted small" style="margin-top:8px">Если окно пустое — панель бота запрещает встраивание. Тогда нажмите «Открыть отдельно» или разрешите встраивание по инструкции из README.</div>`;
}
