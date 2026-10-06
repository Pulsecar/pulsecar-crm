// Перенос фото / файлов заказов Motowarsztat → Pulsecar CRM. Выполняется во вкладке app.motowarsztat.pl (вход выполнен).
// Только ЧТЕНИЕ из MW. Бережно: один поток, пауза между файлами, при ответе 403/429 от MW — сразу стоп (защита MW от перегрузки).
// Продолжает с места остановки: CRM сам говорит, каких файлов ещё нет (POST /mw-import/files/check).
// Ключ: открыть https://panel.pulsecar.tech/crm-api/mw-import/handoff (владелец) — вернёт во вкладку MW с #pc-import=<ключ>.
// Запуск: window.__mwFiles('<ключ импорта>')  → ход в window.__ph ; остановить: window.__ph.stop = true
(() => {
  const CRM = 'https://panel.pulsecar.tech/mw-import/';
  const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()); // в фоновой вкладке Chrome таймеры сильно тормозит — по умолчанию без пауз, темп задаёт сама загрузка (1 файл за раз)
  window.__mwFiles = async (T, { pause = 0 } = {}) => {
    const P = (window.__ph = { state: 'listing', total: 0, need: 0, done: 0, ok: 0, skip: 0, fail: 0, videos: 0, errs: [], stop: false });
    const guard = (r) => { if (r.status === 403 || r.status === 429) { P.stop = true; P.state = 'MW ' + r.status + ' — остановлено'; throw new Error('MW ' + r.status); } return r; };
    try {
      const H = { headers: { Accept: 'application/ld+json' } };
      const ids = [];
      for (const fin of ['', '1']) for (let p = 1; ; p++) {
        const j = await (guard(await fetch(`/api-v2/repair-order-lists?q=&page=${p}&itemsPerPage=100&showFinished=${fin}`, H))).json();
        const m = j['hydra:member'] || [];
        ids.push(...m.map((x) => x.id));
        if (m.length < 100) break;
        await sleep(pause);
      }
      const all = [];
      for (const id of [...new Set(ids)]) {
        if (P.stop) return P;
        const j = await (guard(await fetch(`/api/repair-orders/${id}/files?positionSort=asc`, { headers: { Accept: 'application/json' } }))).json();
        for (const f of j.files || []) all.push({ ...f, o: id });
        await sleep(pause);
      }
      P.total = all.length; P.state = 'check';
      const need = new Set();
      for (let k = 0; k < all.length; k += 1000) {
        const r = await (await fetch(CRM + 'files/check', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Import-Token': T }, body: JSON.stringify({ items: all.slice(k, k + 1000).map((f) => ({ id: f.id, o: f.o })) }) })).json();
        (r.need || []).forEach((x) => need.add(x));
      }
      const todo = all.filter((f) => need.has(f.id));
      P.need = todo.length; P.state = 'upload';
      // фото берём так же, как их показывает сам MW (картинкой), и уменьшаем до 1920 px — экономия места на сервере
      const loadImg = (u) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('img')); im.src = u; });
      const toJpeg = async (u) => {
        const im = await loadImg(u);
        const s = Math.min(1, 1920 / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      };
      let fails = 0;
      for (const f of todo) {
        if (P.stop) break;
        try {
          if (!/^image\//.test(f.mimeType)) { P.videos++; continue; }
          let blob;
          try { blob = await toJpeg(f.fileUrl); } catch {
            // картинка не грузится — проверим, не закрыл ли MW доступ (403/429), и тогда стоп
            guard(await fetch('/api-v2/configurator-statuses?page=1', H));
            throw new Error('нет картинки ' + f.fileUrl);
          }
          const fd = new FormData();
          fd.append('id', String(f.id)); fd.append('o', String(f.o)); fd.append('created_at', f.createdAt || '');
          fd.append('name', (f.originalName || 'zdjecie').replace(/\.[^.]+$/, '') + '.jpg'); fd.append('file', blob, 'f.jpg');
          const x = await fetch(CRM + 'file', { method: 'POST', headers: { 'X-Import-Token': T }, body: fd });
          if (x.status === 401) { P.state = 'ключ истёк'; break; }
          const r = await x.json();
          if (r.created) P.ok++; else P.skip++;
          fails = 0;
        } catch (e) {
          P.fail++; fails++;
          if (P.errs.length < 10) P.errs.push(String(e.message).slice(0, 100));
          if (fails >= 5) { P.stop = true; P.state = '5 ошибок подряд — остановлено'; }
        } finally { P.done++; }
        await sleep(pause);
      }
      if (P.state === 'upload') P.state = P.stop ? 'остановлено' : 'DONE';
    } catch (e) { if (!P.stop) P.state = 'ERR ' + e.message; }
    return P;
  };
})();
