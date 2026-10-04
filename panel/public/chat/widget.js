/*! Pulsecar — AI-czat na stronę. Wstawka przed </body>:
 * <script src="https://panel.pulsecar.tech/chat/widget.js" defer></script>
 * Opcjonalnie: data-lang="pl|en|uk|ru|be" (inaczej z adresu /pl /en /ua /ru /by lub <html lang>), data-position="left".
 * Przycisk na stronie może otworzyć czat: PulseCarChat.open('Umów wizytę')
 */
(function () {
  'use strict';
  if (window.__pulsecarChat) return;
  window.__pulsecarChat = true;

  var script = document.currentScript || document.querySelector('script[src*="/chat/widget.js"]');
  var SERVER = script ? new URL(script.src, location.href).origin : '';
  var SIDE = script && script.getAttribute('data-position') === 'left' ? 'left' : 'right';

  function detectLang() {
    var map = { pl: 'pl', en: 'en', uk: 'uk', ua: 'uk', ru: 'ru', be: 'be', by: 'be' };
    var x = script && script.getAttribute('data-lang');
    if (x && map[x.toLowerCase()]) return map[x.toLowerCase()];
    var seg = (location.pathname.split('/')[1] || '').toLowerCase();
    if (map[seg]) return map[seg];
    var h = (document.documentElement.lang || '').slice(0, 2).toLowerCase();
    return map[h] || 'pl';
  }
  var LANG = detectLang();

  var TXT = {
    pl: { title: 'Asystent Pulsecar', sub: 'Odpowiada od razu', hello: 'Dzień dobry! 👋 Jestem asystentem warsztatu Pulsecar. Pomogę umówić wizytę, podpowiem ceny i wolne terminy. W czym mogę pomóc?', ph: 'Napisz wiadomość…', open: 'Czat z warsztatem', chips: ['Umów wizytę', 'Ile kosztuje diagnostyka?', 'Wolne terminy', 'Zadzwońcie do mnie'], note: 'Asystent AI może się mylić. Rozmowa jest zapisywana, aby obsłużyć zgłoszenie.', err: 'Brak połączenia. Spróbuj ponownie.', booked: 'Zgłoszenie przyjęte', call: 'Zadzwoń', reset: 'Nowa rozmowa', close: 'Zamknij', send: 'Wyślij', bubble: 'Masz pytanie o auto? Napisz!' },
    en: { title: 'Pulsecar Assistant', sub: 'Replies instantly', hello: 'Hi! 👋 I\'m the Pulsecar workshop assistant. I can book a visit, give prices and free time slots. How can I help?', ph: 'Type a message…', open: 'Chat with the workshop', chips: ['Book a visit', 'How much is diagnostics?', 'Free time slots', 'Call me back'], note: 'AI assistant can make mistakes. The chat is saved to handle your request.', err: 'Connection problem. Please try again.', booked: 'Request received', call: 'Call', reset: 'New chat', close: 'Close', send: 'Send', bubble: 'Questions about your car? Ask us!' },
    uk: { title: 'Асистент Pulsecar', sub: 'Відповідає одразу', hello: 'Вітаю! 👋 Я асистент автосервісу Pulsecar. Допоможу записатися, підкажу ціни та вільні години. Чим можу допомогти?', ph: 'Напишіть повідомлення…', open: 'Чат з автосервісом', chips: ['Записатися', 'Скільки коштує діагностика?', 'Вільні години', 'Передзвоніть мені'], note: 'AI-асистент може помилятися. Розмова зберігається, щоб обробити ваш запит.', err: 'Немає з\'єднання. Спробуйте ще раз.', booked: 'Заявку прийнято', call: 'Дзвонити', reset: 'Нова розмова', close: 'Закрити', send: 'Надіслати', bubble: 'Питання щодо авто? Напишіть!' },
    ru: { title: 'Ассистент Pulsecar', sub: 'Отвечает сразу', hello: 'Здравствуйте! 👋 Я ассистент автосервиса Pulsecar. Помогу записаться, подскажу цены и свободное время. Чем могу помочь?', ph: 'Напишите сообщение…', open: 'Чат с автосервисом', chips: ['Записаться', 'Сколько стоит диагностика?', 'Свободное время', 'Перезвоните мне'], note: 'AI-ассистент может ошибаться. Переписка сохраняется, чтобы обработать запрос.', err: 'Нет соединения. Попробуйте ещё раз.', booked: 'Заявка принята', call: 'Позвонить', reset: 'Новый чат', close: 'Закрыть', send: 'Отправить', bubble: 'Вопрос по машине? Напишите!' },
    be: { title: 'Асістэнт Pulsecar', sub: 'Адказвае адразу', hello: 'Вітаю! 👋 Я асістэнт аўтасэрвісу Pulsecar. Дапамагу запісацца, падкажу цэны і вольны час. Чым магу дапамагчы?', ph: 'Напішыце паведамленне…', open: 'Чат з аўтасэрвісам', chips: ['Запісацца', 'Колькі каштуе дыягностыка?', 'Вольны час', 'Перазваніце мне'], note: 'AI-асістэнт можа памыляцца. Перапіска захоўваецца, каб апрацаваць запыт.', err: 'Няма злучэння. Паспрабуйце яшчэ раз.', booked: 'Заяўка прынята', call: 'Патэлефанаваць', reset: 'Новы чат', close: 'Закрыць', send: 'Адправіць', bubble: 'Пытанне па машыне? Напішыце!' },
  };
  var T = TXT[LANG];

  var KEY = 'pulsecar_chat_v1';
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  var state = load();
  if (!state || Date.now() - (state.updated || 0) > 24 * 3600 * 1000) state = { sessionId: uuid(), messages: [], open: false, updated: Date.now() };

  // Czat pokazuje się tylko, gdy jest włączony w CRM (Ustawienia → Integracje)
  fetch(SERVER + '/chat-api/config').then(function (r) { return r.json(); }).then(function (cfg) {
    if (cfg && cfg.enabled) mount(cfg);
  }).catch(function () {});

  function mount(cfg) {
    var host = document.createElement('div');
    host.id = 'pulsecar-chat';
    document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var S = SIDE, O = SIDE === 'right' ? 'left' : 'right';

    var css = ':host{all:initial}' +
      '*{box-sizing:border-box;font-family:Poppins,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}' +
      '.w{--g:#1BF372;--bg:#101113;--s1:#17181A;--s2:#1F2023;--ln:#292A2E;--tx:#F2F2F2;--mu:#9A9CA3;position:fixed;' + S + ':24px;bottom:24px;z-index:2147483000;color:var(--tx)}' +
      '.fab{position:relative;width:60px;height:60px;border-radius:50%;border:none;background:var(--g);color:#000;cursor:pointer;display:grid;place-items:center;box-shadow:0 0 0 0 rgba(27,243,114,.55),0 10px 30px rgba(0,0,0,.45);transition:transform .15s ease;animation:pulse 2.6s ease-out 3}' +
      '.fab:hover{transform:scale(1.06)}.fab svg{width:27px;height:27px}' +
      '@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(27,243,114,.55),0 10px 30px rgba(0,0,0,.45)}70%{box-shadow:0 0 0 16px rgba(27,243,114,0),0 10px 30px rgba(0,0,0,.45)}100%{box-shadow:0 0 0 0 rgba(27,243,114,0),0 10px 30px rgba(0,0,0,.45)}}' +
      '.tip{position:absolute;bottom:72px;' + S + ':0;white-space:nowrap;background:var(--s1);border:1px solid var(--ln);border-radius:12px;padding:10px 14px;font-size:13px;font-weight:500;box-shadow:0 10px 30px rgba(0,0,0,.4);cursor:pointer;opacity:0;transform:translateY(6px);transition:all .25s ease;pointer-events:none}' +
      '.tip.on{opacity:1;transform:none;pointer-events:auto}' +
      '.pn{position:absolute;bottom:76px;' + S + ':0;width:380px;height:min(620px,calc(100vh - 120px));background:var(--bg);border:1px solid var(--ln);border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.6);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(12px) scale(.98);transform-origin:bottom ' + S + ';pointer-events:none;transition:opacity .18s ease,transform .18s ease}' +
      '.pn.on{opacity:1;transform:none;pointer-events:auto}' +
      '.hd{padding:14px 12px 14px 16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--ln);background:var(--s1)}' +
      '.lg{width:44px;height:44px;border-radius:12px;background:#000;border:1px solid var(--ln);display:grid;place-items:center;flex:none;overflow:hidden}.lg img{width:36px;height:auto;display:block}' +
      '.ht{flex:1;min-width:0}.ht b{display:block;font-size:15px;font-weight:700;letter-spacing:-.01em}' +
      '.ht span{font-size:12px;color:var(--mu);display:flex;align-items:center;gap:6px}.ht span:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--g);box-shadow:0 0 8px var(--g)}' +
      '.hb{background:transparent;border:1px solid var(--ln);color:var(--tx);border-radius:8px;width:34px;height:34px;cursor:pointer;display:grid;place-items:center;text-decoration:none;flex:none}' +
      '.hb:hover{border-color:var(--g);color:var(--g)}.hb svg{width:16px;height:16px}' +
      '.ms{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;scrollbar-width:thin;scrollbar-color:var(--ln) transparent}' +
      '.m{max-width:86%;padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}' +
      '.m.b{background:var(--s1);border:1px solid var(--ln);border-bottom-' + 'left-radius:4px;align-self:flex-start}' +
      '.m.u{background:var(--g);color:#000;font-weight:500;border-bottom-right-radius:4px;align-self:flex-end}' +
      '.m a{color:var(--g)}.m.u a{color:#000}' +
      '.cd{align-self:stretch;border:1px solid rgba(27,243,114,.45);background:rgba(27,243,114,.08);border-radius:12px;padding:12px 14px;font-size:13px;color:var(--tx)}' +
      '.cd b{display:block;font-size:14px;color:var(--g);margin-bottom:2px}' +
      '.ty{align-self:flex-start;background:var(--s1);border:1px solid var(--ln);border-radius:14px;padding:13px 15px;display:flex;gap:5px}' +
      '.ty i{width:6px;height:6px;border-radius:50%;background:var(--g);animation:bo 1s infinite}.ty i:nth-child(2){animation-delay:.15s}.ty i:nth-child(3){animation-delay:.3s}' +
      '@keyframes bo{0%,60%,100%{transform:none;opacity:.35}30%{transform:translateY(-4px);opacity:1}}' +
      '.ch{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 12px}' +
      '.c{border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.5);color:var(--tx);border-radius:8px;padding:8px 12px;font-size:13px;font-weight:500;cursor:pointer;transition:border-color .15s,color .15s}' +
      '.c:hover{border-color:var(--g);color:var(--g)}' +
      '.ft{border-top:1px solid var(--ln);padding:12px;background:var(--s1)}' +
      '.rw{display:flex;gap:8px;align-items:flex-end}' +
      'textarea{flex:1;resize:none;border:1px solid var(--ln);border-radius:10px;padding:11px 12px;font-size:15px;line-height:1.35;max-height:110px;outline:none;color:var(--tx);background:var(--bg)}' +
      'textarea::placeholder{color:var(--mu)}textarea:focus{border-color:var(--g)}' +
      '.sd{width:44px;height:44px;border-radius:10px;border:none;background:var(--g);color:#000;cursor:pointer;display:grid;place-items:center;flex:none}' +
      '.sd:disabled{opacity:.35;cursor:default}.sd svg{width:19px;height:19px}' +
      '.nt{font-size:11px;color:var(--mu);margin-top:8px;text-align:center;line-height:1.35}' +
      '@media (max-width:480px){.w{' + S + ':16px;bottom:16px}.pn{position:fixed;inset:0;width:100%;height:100%;border-radius:0;border:none}.pn.on~.fab,.pn.on~.tip{display:none}.tip{' + S + ':0}}';

    var I = {
      chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/></svg>',
      x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
      send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
      phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
      reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    };
    var phone = (cfg.phone || '').replace(/\s/g, '');

    root.innerHTML = '<style>' + css + '</style><div class="w">' +
      '<div class="pn" role="dialog" aria-label="' + T.title + '">' +
      '<div class="hd"><div class="lg"><img src="' + SERVER + '/chat/logo.png" alt="Pulsecar"></div><div class="ht"><b>' + T.title + '</b><span>' + T.sub + '</span></div>' +
      (phone ? '<a class="hb" href="tel:' + phone + '" title="' + T.call + '" aria-label="' + T.call + '">' + I.phone + '</a>' : '') +
      '<button class="hb rs" title="' + T.reset + '" aria-label="' + T.reset + '">' + I.reset + '</button>' +
      '<button class="hb cl" title="' + T.close + '" aria-label="' + T.close + '">' + I.x + '</button></div>' +
      '<div class="ms" aria-live="polite"></div><div class="ch"></div>' +
      '<div class="ft"><div class="rw"><textarea rows="1" maxlength="1500" placeholder="' + T.ph + '" aria-label="' + T.ph + '"></textarea>' +
      '<button class="sd" aria-label="' + T.send + '" disabled>' + I.send + '</button></div><div class="nt">' + T.note + '</div></div></div>' +
      '<div class="tip">' + T.bubble + '</div>' +
      '<button class="fab" aria-label="' + T.open + '">' + I.chat + '</button></div>';

    var $ = function (s) { return root.querySelector(s); };
    var pn = $('.pn'), fab = $('.fab'), ms = $('.ms'), ch = $('.ch'), inp = $('textarea'), sd = $('.sd'), tip = $('.tip');
    var busy = false;

    function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function fmt(t) {
      return esc(t)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
        .replace(/(\+\d{2}[\s-]?)?\b\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g, function (m) { return '<a href="tel:' + m.replace(/[\s-]/g, '') + '">' + m + '</a>'; });
    }
    function bubble(m) {
      var el = document.createElement('div');
      if (m.type === 'card') { el.className = 'cd'; el.innerHTML = '<b>✓ ' + esc(T.booked) + ' #' + esc(m.id) + '</b>' + esc(m.slot); }
      else { el.className = 'm ' + (m.role === 'user' ? 'u' : 'b'); el.innerHTML = fmt(m.text); }
      ms.appendChild(el); ms.scrollTop = ms.scrollHeight;
    }
    function chips() {
      ch.innerHTML = '';
      ch.style.display = state.messages.length ? 'none' : 'flex';
      if (state.messages.length) return;
      T.chips.forEach(function (c) { var b = document.createElement('button'); b.className = 'c'; b.textContent = c; b.onclick = function () { send(c); }; ch.appendChild(b); });
    }
    function renderAll() { ms.innerHTML = ''; bubble({ role: 'assistant', text: T.hello }); state.messages.forEach(bubble); chips(); }
    function typing(on) {
      var t = $('.ty');
      if (on && !t) { t = document.createElement('div'); t.className = 'ty'; t.innerHTML = '<i></i><i></i><i></i>'; ms.appendChild(t); ms.scrollTop = ms.scrollHeight; }
      if (!on && t) t.remove();
    }
    function setOpen(on) {
      state.open = on; save();
      pn.classList.toggle('on', on); tip.classList.remove('on');
      fab.innerHTML = on ? I.x : I.chat;
      fab.setAttribute('aria-label', on ? T.close : T.open);
      if (on) { try { sessionStorage.setItem('pulsecar_chat_tip', '1'); } catch (e) {} setTimeout(function () { if (window.innerWidth > 480) inp.focus(); }, 150); ms.scrollTop = ms.scrollHeight; }
    }
    fab.onclick = function () { setOpen(!pn.classList.contains('on')); };
    tip.onclick = function () { setOpen(true); };
    $('.cl').onclick = function () { setOpen(false); };
    $('.rs').onclick = function () { state = { sessionId: uuid(), messages: [], open: true, updated: Date.now() }; save(); renderAll(); };
    inp.addEventListener('input', function () { sd.disabled = !inp.value.trim() || busy; inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 110) + 'px'; });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(inp.value); } });
    sd.onclick = function () { send(inp.value); };

    function push(m) { state.messages.push(m); if (state.messages.length > 100) state.messages.shift(); state.updated = Date.now(); save(); bubble(m); }
    function track(name, data) {
      try { if (typeof window.gtag === 'function') window.gtag('event', name, data || {}); } catch (e) {}
      try { if (window.ttq && typeof window.ttq.track === 'function' && name === 'chat_booking') window.ttq.track('SubmitForm'); } catch (e) {}
    }
    function send(text) {
      text = (text || '').trim();
      if (!text || busy) return;
      busy = true; sd.disabled = true; inp.value = ''; inp.style.height = 'auto'; ch.style.display = 'none';
      if (!state.messages.length) track('chat_start');
      push({ role: 'user', text: text });
      typing(true);
      fetch(SERVER + '/chat-api/message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId, message: text, lang: LANG, page: location.pathname }),
      }).then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          typing(false);
          if (d.sessionId) state.sessionId = d.sessionId;
          push({ role: 'assistant', text: d.reply || T.err });
          if (d.booking && d.booking.ok) { push({ type: 'card', id: d.booking.booking_id, slot: d.booking.slot }); track('chat_booking', { booking_id: d.booking.booking_id }); }
        })
        .catch(function () { typing(false); push({ role: 'assistant', text: T.err }); })
        .then(function () { busy = false; sd.disabled = !inp.value.trim(); });
    }

    window.PulseCarChat = { open: function (msg) { setOpen(true); if (msg) send(msg); }, close: function () { setOpen(false); } };
    renderAll();
    if (state.open) setOpen(true);
    else {
      var seen = false; try { seen = sessionStorage.getItem('pulsecar_chat_tip') === '1'; } catch (e) {}
      if (!seen && !state.messages.length) setTimeout(function () { if (!pn.classList.contains('on')) { tip.classList.add('on'); setTimeout(function () { tip.classList.remove('on'); }, 8000); } try { sessionStorage.setItem('pulsecar_chat_tip', '1'); } catch (e) {} }, 6000);
    }
  }
})();
