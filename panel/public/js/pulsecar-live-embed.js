/*
 * Pulsecar Live — подключение модуля во фронтенде CRM (panel.pulsecar.tech).
 * Без зависимостей. Требует на бэкенде CRM эндпоинт, который возвращает одноразовую ссылку входа:
 *   POST <embedUrlEndpoint>  body: {"next": "/admin" | "/admin/new?..."}  → {"url": "https://live.pulsecar.tech/embed/start?t=..."}
 * (см. backend-example.js). Ключ CRM_API_KEY хранится только на бэкенде.
 *
 * Использование:
 *   PulsecarLive.configure({ embedUrlEndpoint: '/api/live-cameras/embed-url', moduleOrigin: 'https://live.pulsecar.tech' });
 *   PulsecarLive.mountPanel(document.getElementById('kamery'));          // страница «Kamery» в меню
 *   PulsecarLive.openNewLink({ plate, client, car, orderNo, orderId, phone }, { onCreated(link) { ... } });  // кнопка в zleceniu
 */
(function (global) {
  'use strict';
  var cfg = { embedUrlEndpoint: '/api/live-cameras/embed-url', moduleOrigin: 'https://live.pulsecar.tech', fetchOptions: {} };

  function embedUrl(next) {
    var opt = Object.assign({ method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, cfg.fetchOptions);
    opt.headers = Object.assign({ 'Content-Type': 'application/json' }, cfg.fetchOptions.headers || {});
    opt.body = JSON.stringify({ next: next });
    return fetch(cfg.embedUrlEndpoint, opt).then(function (r) {
      if (!r.ok) throw new Error('Pulsecar Live: CRM nie zwrócił linku logowania (' + r.status + ')');
      return r.json();
    }).then(function (j) { return j.url; });
  }

  function iframe(src, height) {
    var f = document.createElement('iframe');
    f.src = src;
    f.title = 'Podgląd na żywo';
    f.style.cssText = 'width:100%;border:0;display:block;height:' + (height || '100%') + ';background:#f6f7f6';
    f.allow = 'fullscreen';
    return f;
  }

  // Полная панель модуля (ссылки, камеры, настройки) внутри страницы CRM.
  function mountPanel(el, opts) {
    opts = opts || {};
    el.innerHTML = '';
    return embedUrl('/admin' + (opts.tab ? '#' + opts.tab : '')).then(function (url) {
      var f = iframe(url, opts.height || 'calc(100vh - 120px)');
      el.appendChild(f);
      return f;
    });
  }

  // Окно «Nowy link dla klienta» с данными из zlecenia.
  function openNewLink(data, handlers) {
    handlers = handlers || {};
    var q = new URLSearchParams();
    ['plate', 'client', 'car', 'orderNo', 'orderId', 'phone', 'cameraId'].forEach(function (k) { if (data && data[k]) q.set(k, data[k]); });
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,24,22,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:12px';
    var box = document.createElement('div');
    box.style.cssText = 'width:min(760px,100%);height:min(820px,calc(100vh - 24px));background:#f6f7f6;border-radius:14px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.25)';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() {
      window.removeEventListener('message', onMsg);
      overlay.remove();
      if (handlers.onClose) handlers.onClose();
    }
    function onMsg(e) {
      if (e.origin !== cfg.moduleOrigin || !e.data || typeof e.data.type !== 'string') return;
      if (e.data.type === 'pulsecar-live:link-created' && handlers.onCreated) handlers.onCreated(e.data.link);
      if (e.data.type === 'pulsecar-live:close') close();
    }
    window.addEventListener('message', onMsg);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    return embedUrl('/admin/new?' + q.toString()).then(function (url) {
      box.appendChild(iframe(url, '100%'));
      return { close: close };
    }, function (err) { close(); throw err; });
  }

  global.PulsecarLive = {
    configure: function (o) { Object.assign(cfg, o || {}); },
    mountPanel: mountPanel,
    openNewLink: openNewLink,
  };
})(window);
