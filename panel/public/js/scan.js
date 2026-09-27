// Сканер QR карты Pulse Points (камера телефона/планшета) + ручной ввод кода
import { html, useState, useEffect, useRef, Icon } from './lib.js';

let seq = 0;
export function ScanBox({ onResult, busy }) {
  const idRef = useRef('reader-' + ++seq);
  const qrRef = useRef(null);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState('');
  const [m, setM] = useState({ who: '', code: '' });
  const fired = useRef(false);

  const stop = async () => {
    try { if (qrRef.current?.isScanning) await qrRef.current.stop(); } catch {}
    setOn(false);
  };
  const start = async () => {
    setErr('');
    fired.current = false;
    try {
      if (!window.Html5Qrcode) throw new Error('библиотека сканера не загрузилась');
      qrRef.current ||= new window.Html5Qrcode(idRef.current);
      await qrRef.current.start({ facingMode: 'environment' },
        { fps: 12, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.75); return { width: s, height: s }; } },
        async (text) => {
          if (fired.current) return;
          fired.current = true;
          await stop();
          if (navigator.vibrate) navigator.vibrate(80);
          onResult({ qr: text });
        }, () => {});
      setOn(true);
    } catch (e) {
      setErr('Камера недоступна: ' + (e?.message || e) + '. Панель должна открываться по https, и браузеру нужно разрешить камеру. Можно ввести код вручную.');
    }
  };
  useEffect(() => () => { stop(); }, []);

  return html`<div class="stack">
    <div id=${idRef.current} class="reader">${!on && html`<span class="muted">Камера выключена</span>`}</div>
    <div class="row">
      ${!on ? html`<button class="btn primary" onClick=${start} disabled=${busy}><${Icon} n="qr" />Сканировать QR</button>` : html`<button class="btn" onClick=${stop}>Остановить</button>`}
    </div>
    <form class="row end" onSubmit=${(e) => { e.preventDefault(); onResult({ who: m.who, code: m.code }); }}>
      <label class="f grow">Телефон или номер карты<input value=${m.who} onInput=${(e) => setM({ ...m, who: e.target.value })} placeholder="+48… или PC…" required /></label>
      <label class="f" style="width:130px">6 цифр под QR<input value=${m.code} inputmode="numeric" maxlength="7" onInput=${(e) => setM({ ...m, code: e.target.value })} required /></label>
      <button class="btn" disabled=${busy}>Проверить</button>
    </form>
    ${err && html`<div class="err small">${err}</div>`}
  </div>`;
}
