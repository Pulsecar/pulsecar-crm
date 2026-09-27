// Данные авто: скан кода Aztec с техпаспорта (камера, фото или ручной сканер) и поиск по номеру
import { html, useState, useEffect, useRef, api, act, toast, Modal, Icon, useApp } from './lib.js';

const FIELDS = ['plate', 'vin', 'make', 'model', 'year', 'capacity', 'power_kw', 'fuel', 'first_reg', 'category', 'mass_kg', 'seats', 'reg_doc', 'vehicle_type', 'color'];
/** Заполняем пустые поля формы данными из техпаспорта / по номеру (заполненные вручную не трогаем, кроме пустых) */
export function mergeCar(f, d, overwrite = false) {
  const out = { ...f };
  for (const k of FIELDS) if (d[k] !== undefined && d[k] !== null && d[k] !== '' && (overwrite || !f[k])) out[k] = d[k];
  if (d.variant && !out.engine) out.engine = [d.type, d.variant].filter(Boolean).join(' ');
  return out;
}

/** Кнопка «Техпаспорт (Aztec)»: onData({ car, owner, existing }) */
export function AztecButton({ onData, cls = 'btn sm', label = 'Скан техпаспорта' }) {
  const [open, setOpen] = useState(false);
  return html`<button type="button" class=${cls} onClick=${() => setOpen(true)} title="Считать код Aztec с польского техпаспорта"><${Icon} n="qr" />${label}</button>
    ${open && html`<${AztecModal} onClose=${() => setOpen(false)} onData=${(d) => { setOpen(false); onData(d); }} />`}`;
}

let seq = 0;
function AztecModal({ onClose, onData }) {
  const vid = useRef(null);
  const boxId = useRef('aztec-' + ++seq);
  const stopper = useRef(null);
  const [mode, setMode] = useState('');
  const [err, setErr] = useState('');
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const done = useRef(false);

  const decode = async (text) => {
    if (done.current || !text) return;
    done.current = true;
    setBusy(true);
    try {
      const r = await api('vehicle/aztec', { body: { raw: text } });
      if (navigator.vibrate) navigator.vibrate(80);
      toast(`Техпаспорт считан: ${[r.car.make, r.car.model, r.car.plate].filter(Boolean).join(' ')}`);
      onData(r);
    } catch (e) { setErr(e.message); done.current = false; } finally { setBusy(false); }
  };
  const stop = async () => { try { await stopper.current?.(); } catch {} stopper.current = null; setMode(''); };

  const startCamera = async () => {
    setErr(''); done.current = false;
    try {
      // 1) встроенный распознаватель браузера (Chrome на Android) — быстрее и точнее для плотного Aztec
      if ('BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats?.())?.includes('aztec')) {
        const det = new window.BarcodeDetector({ formats: ['aztec'] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
        vid.current.srcObject = stream; await vid.current.play();
        let alive = true;
        stopper.current = async () => { alive = false; stream.getTracks().forEach((t) => t.stop()); };
        setMode('native');
        const tick = async () => {
          if (!alive || done.current) return;
          try { const c = await det.detect(vid.current); if (c[0]?.rawValue) { await stop(); return decode(c[0].rawValue); } } catch {}
          setTimeout(tick, 250);
        };
        tick();
        return;
      }
      // 2) библиотека html5-qrcode (ZXing) с форматом AZTEC
      if (!window.Html5Qrcode) throw new Error('библиотека сканера не загрузилась');
      const q = new window.Html5Qrcode(boxId.current, { formatsToSupport: [window.Html5QrcodeSupportedFormats.AZTEC], verbose: false });
      await q.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.85); return { width: s, height: s }; } },
        async (text) => { await stop(); decode(text); }, () => {});
      stopper.current = async () => { if (q.isScanning) await q.stop(); };
      setMode('zxing');
    } catch (e) {
      setErr('Камера недоступна: ' + (e?.message || e) + '. Нужен https и разрешение на камеру. Можно сфотографировать код или использовать ручной сканер.');
    }
  };
  const fromPhoto = async (file) => {
    if (!file) return;
    setErr(''); done.current = false;
    try {
      if ('BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats?.())?.includes('aztec')) {
        const bmp = await createImageBitmap(file);
        const c = await new window.BarcodeDetector({ formats: ['aztec'] }).detect(bmp);
        if (c[0]?.rawValue) return decode(c[0].rawValue);
      }
      const q = new window.Html5Qrcode(boxId.current, { formatsToSupport: [window.Html5QrcodeSupportedFormats.AZTEC], verbose: false });
      decode(await q.scanFile(file, false));
    } catch { setErr('На фото не найден код Aztec. Снимите код крупно, ровно и без бликов.'); }
  };
  useEffect(() => () => { stop(); }, []);

  return html`<${Modal} title="Техпаспорт: код Aztec" onClose=${() => { stop(); onClose(); }}>
    <div class="stack">
      <div class="reader" id=${boxId.current} style=${mode === 'native' ? 'display:none' : ''}>${!mode && html`<span class="muted">Код Aztec — квадрат на обороте техпаспорта</span>`}</div>
      <video ref=${vid} playsinline muted style=${mode === 'native' ? 'width:100%;border-radius:12px;background:#000' : 'display:none'}></video>
      <div class="row">
        ${!mode ? html`<button class="btn primary" onClick=${startCamera} disabled=${busy}><${Icon} n="qr" />Камера</button>` : html`<button class="btn" onClick=${stop}>Остановить</button>`}
        <label class="btn"><${Icon} n="upload" />Фото кода<input type="file" accept="image/*" capture="environment" hidden onChange=${(e) => fromPhoto(e.target.files[0])} /></label>
      </div>
      <form class="stack" onSubmit=${(e) => { e.preventDefault(); decode(raw.trim()); }}>
        <label class="f">Ручной сканер 2D: поставьте курсор сюда и отсканируйте<textarea rows="2" value=${raw} onInput=${(e) => setRaw(e.target.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter' && raw.trim().length > 50) { e.preventDefault(); decode(raw.trim()); } }} placeholder="Код появится здесь"></textarea></label>
        ${raw.trim().length > 50 && html`<button class="btn" disabled=${busy}>Прочитать</button>`}
      </form>
      ${busy && html`<div class="muted small">Читаю…</div>`}
      ${err && html`<div class="err small">${err}</div>`}
      <div class="muted small">Из кода берутся номер, VIN, марка, модель, двигатель, дата первой регистрации и данные владельца. PESEL не сохраняется.</div>
    </div></${Modal}>`;
}

/** Кнопка-лупа «данные по номеру» */
export function PlateButton({ plate, onData }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  if (!app.features.plate) return null;
  return html`<button type="button" class="btn sm" disabled=${busy || !plate} title="Найти данные авто по номеру" onClick=${async () => {
    setBusy(true);
    try { const r = await act(() => api('vehicle/plate/' + encodeURIComponent(plate))); if (r) { toast(`Найдено: ${[r.make, r.model, r.year].filter(Boolean).join(' ')}`); onData(r); } } finally { setBusy(false); }
  }}><${Icon} n="search" /></button>`;
}
