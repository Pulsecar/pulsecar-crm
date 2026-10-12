// Кнопка модуля «ИИ-запчастист» (отдельный сервис): виджет сервиса в wycenie / zleceniu.
// Токен выпускает бэкенд CRM (секрет в браузер не попадает) и обновляет его каждые 12 минут.
import { html, useEffect, useRef, api, toast } from './lib.js';

let loading = null;
function loadWidget(url) {
  if (window.AiParts) return Promise.resolve();
  if (!loading) loading = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = url.replace(/\/$/, '') + '/widget.js';
    s.onload = () => ok(); s.onerror = () => { loading = null; fail(new Error('Модуль «ИИ-запчастист» недоступен')); };
    document.head.appendChild(s);
  });
  return loading;
}

export function AiSvcButton({ o, url, reload }) {
  const box = useRef(null);
  useEffect(() => {
    let alive = true, timer = null, token = '';
    const el = document.createElement('span');
    box.current?.appendChild(el);
    (async () => {
      try {
        const d = await api('ai-svc/token?orderId=' + o.id);
        token = d.token;
        await loadWidget(url);
        if (!alive) return;
        timer = setInterval(() => api('ai-svc/token?orderId=' + o.id).then((x) => { token = x.token; }).catch(() => {}), 12 * 60_000);
        window.AiParts.mount(el, {
          serviceUrl: url, token: () => token, wycenaId: d.wycenaId, vehicle: d.vehicle, defaultLevel: d.defaultLevel, existingItems: d.existingItems,
          onAddItems: async (items) => {
            const r = await api(`orders/${o.id}/ai-svc-items`, { body: { items } });
            toast(`Добавлено позиций: ${r.added}${r.skipped?.length ? ` · уже были: ${r.skipped.length}` : ''}`);
            reload();
          },
        });
      } catch (e) { if (alive) el.textContent = e.message; }
    })();
    return () => { alive = false; clearInterval(timer); el.remove(); };
  }, [o.id, url]);
  return html`<span class="ai-svc" ref=${box}></span>`;
}
