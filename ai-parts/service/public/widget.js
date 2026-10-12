/*
 * ИИ-запчастист — виджет для страницы wyceny / zlecenia CRM Pulsecar.
 *
 * Подключение на странице wyceny:
 *   <div id="ai-parts"></div>
 *   <script src="https://<адрес сервиса>/widget.js"></script>
 *   <script>
 *     AiParts.mount(document.getElementById('ai-parts'), {
 *       serviceUrl: 'https://<адрес сервиса>',
 *       token: '<токен, выпущенный бэкендом CRM для этой wyceny>',
 *       wycenaId: '123',
 *       vehicle: { vin, make, model, engine, year, mileage },   // из wyceny, только чтение
 *       defaultLevel: 'middle',                                // из карточки клиента
 *       onAddItems: async (items) => { ... сохранить позиции в wycenę ... }
 *     });
 *   </script>
 *
 * Виджет НЕ пишет в базу CRM сам: выбранные позиции передаются в onAddItems,
 * и CRM сохраняет их своим кодом (со статусом «Черновик ИИ»).
 */
(function () {
  'use strict';

  var LEVELS = [
    ['economy', 'Эконом'],
    ['middle', 'Средний'],
    ['oe', 'OE'],
  ];
  var URGENCY = [
    ['today', 'Сегодня'],
    ['tomorrow', 'Завтра'],
    ['any', 'Не важно'],
  ];
  var EVIDENCE_LABEL = {
    partslink24: 'partslink24',
    history: 'История wycen',
    catalog: 'Каталог',
    seller: 'Продавец оригинала',
    forum: 'Форум',
    web: 'Интернет',
    knowledge: 'Знания ИИ',
  };

  var CSS = '\
:host{all:initial;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1b1f27}\
*{box-sizing:border-box}\
button{font:inherit;cursor:pointer}\
.trigger{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:10px 16px;border-radius:8px;border:1px solid #1f55c4;background:#1f55c4;color:#fff;font-size:14px;font-weight:600}\
.trigger:hover{background:#18469f}\
.overlay{position:fixed;inset:0;background:rgba(15,19,27,.55);display:flex;align-items:flex-start;justify-content:center;padding:32px 12px;overflow-y:auto;z-index:2147483000}\
.dlg{width:100%;max-width:980px;background:#fff;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.25)}\
.hd{display:flex;justify-content:space-between;align-items:center;padding:16px 22px;border-bottom:1px solid #eef0f3}\
.hd h2{margin:0;font-size:18px}\
.x{border:0;background:transparent;font-size:20px;min-width:44px;min-height:44px;color:#4a5262}\
.car{padding:12px 22px;background:#f7f8fa;border-bottom:1px solid #eef0f3;display:flex;flex-wrap:wrap;gap:8px 24px;font-size:13px}\
.car b{display:block;font-size:12px;color:#5b6372;font-weight:500}\
.mono{font-family:ui-monospace,Menlo,monospace}\
.bd{padding:18px 22px;display:flex;flex-direction:column;gap:16px}\
label.l{font-weight:600;font-size:14px;display:block;margin-bottom:6px}\
textarea,input[type=text]{width:100%;font:inherit;font-size:15px;border:1px solid #cdd2da;border-radius:8px;padding:10px 12px}\
textarea{resize:vertical}\
.hint{font-size:12.5px;color:#5b6372;margin-top:4px}\
.pills{display:flex;gap:8px;flex-wrap:wrap}\
.pill{min-height:40px;padding:8px 14px;border:1px solid #d5d9e0;background:#fff;border-radius:999px;font-size:14px;color:#3b4252}\
.pill.on{background:#e8eefb;border-color:#1f55c4;color:#163f94;font-weight:600}\
.row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}\
.btn{min-height:44px;padding:10px 16px;border-radius:8px;border:1px solid #d5d9e0;background:#fff;font-size:14px;font-weight:500}\
.btn.p{background:#1f55c4;border-color:#1f55c4;color:#fff}\
.btn:disabled{opacity:.5;cursor:not-allowed}\
details summary{cursor:pointer;font-size:14px;color:#1f55c4}\
.steps{list-style:none;margin:0;padding:0;max-height:260px;overflow:auto;font-size:13.5px}\
.steps li{padding:5px 0;border-bottom:1px dashed #eef0f3}\
.steps li:last-child{font-weight:600}\
.spin{display:inline-block;width:16px;height:16px;border:2px solid #1f55c4;border-top-color:transparent;border-radius:50%;animation:s .8s linear infinite;vertical-align:-3px;margin-right:8px}\
@keyframes s{to{transform:rotate(360deg)}}\
.q{background:#fff6e0;border:1px solid #f0d58a;border-radius:10px;padding:14px}\
.q p{margin:0 0 10px}\
.err{background:#fde7e4;border:1px solid #f3b7ae;color:#8e2a1c;border-radius:10px;padding:12px}\
.note{background:#f3f0fd;border:1px solid #d9d1f6;border-radius:10px;padding:10px 14px;font-size:14px}\
.tw{overflow-x:auto}\
table{border-collapse:collapse;width:100%;min-width:860px;font-size:13.5px}\
th{font-size:12px;color:#5b6372;text-align:left;font-weight:500;padding:8px 6px;border-bottom:1px solid #e2e5ea}\
td{padding:10px 6px;border-bottom:1px solid #eef0f3;vertical-align:top}\
tr.check td{background:#fffbf0}\
.badge{display:inline-block;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap}\
.b-ok{background:#e3f2e8;color:#1d6436}\
.b-chk{background:#fff0c7;color:#6b4200}\
.b-opt{background:#eef0f3;color:#4a5262}\
.seg{display:flex}\
.seg button{min-height:32px;padding:4px 9px;border:1px solid #d5d9e0;background:#fff;font-size:12.5px}\
.seg button+button{margin-left:-1px}\
.seg button:first-child{border-radius:6px 0 0 6px}\
.seg button:last-child{border-radius:0 6px 6px 0}\
.seg button.on{background:#1f55c4;border-color:#1f55c4;color:#fff;position:relative}\
.seg button:disabled{opacity:.35}\
.why{font-size:12.5px;color:#6b4200;margin-top:4px}\
.ev{font-size:12px;color:#4a5262;margin:4px 0 0;padding-left:16px}\
.ev a{color:#1f55c4}\
.tot{display:flex;justify-content:flex-end;gap:24px;font-size:14px;font-weight:600;flex-wrap:wrap}\
.hist{font-size:13px;color:#5b6372}\
.ok{background:#eef7f1;border:1px solid #cbe6d4;border-radius:10px;padding:12px}\
';

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs)
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  function money(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł';
  }
  function safeUrl(u) {
    return /^https?:\/\//i.test(String(u || '')) ? u : null;
  }

  function Widget(root, opts) {
    this.o = opts;
    this.host = root;
    this.shadow = root.attachShadow ? root.attachShadow({ mode: 'open' }) : root;
    this.state = {
      open: false,
      phase: 'form',
      text: '',
      level: opts.defaultLevel || 'middle',
      urgency: 'any',
      note: '',
      pasted: '',
      job: null,
      jobId: null,
      error: null,
      sel: {},
      levelSel: {},
      added: false,
      history: [],
    };
    this.render();
  }

  Widget.prototype.api = function (path, method, body) {
    var o = this.o;
    return fetch(o.serviceUrl.replace(/\/$/, '') + path, {
      method: method || 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + (typeof o.token === 'function' ? o.token() : o.token) }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = t ? JSON.parse(t) : null;
        if (!r.ok) throw new Error((j && j.error) || 'Ошибка ' + r.status);
        return j;
      });
    });
  };

  Widget.prototype.set = function (patch) {
    Object.assign(this.state, patch);
    this.render();
  };

  Widget.prototype.openDlg = function () {
    var self = this;
    this.set({ open: true, error: null });
    if (this.o.wycenaId)
      this.api('/api/wyceny/' + encodeURIComponent(this.o.wycenaId) + '/jobs')
        .then(function (list) {
          self.set({ history: list || [] });
          var last = (list || [])[0];
          if (last && (last.status === 'running' || last.status === 'queued' || last.status === 'needs_input') && !self.state.jobId) self.follow(last.id);
        })
        .catch(function () {});
  };

  Widget.prototype.start = function () {
    var s = this.state;
    var self = this;
    if (!this.o.vehicle || !this.o.vehicle.vin) return this.set({ error: 'В wycenie нет VIN — добавьте VIN.' });
    if (!s.text.trim()) return this.set({ error: 'Опишите, что нужно подобрать.' });
    this.set({ phase: 'running', error: null, job: null, added: false, sel: {}, levelSel: {} });
    this.api('/api/jobs', 'POST', {
      wycenaId: this.o.wycenaId,
      vehicle: this.o.vehicle,
      text: s.text,
      level: s.level,
      urgency: s.urgency,
      note: s.note || undefined,
      pastedCatalogText: s.pasted || undefined,
      existingItems: this.o.existingItems || undefined,
    })
      .then(function (r) {
        self.follow(r.id);
      })
      .catch(function (e) {
        self.set({ phase: 'form', error: e.message });
      });
  };

  Widget.prototype.follow = function (id) {
    var self = this;
    this.state.jobId = id;
    clearTimeout(this.timer);
    var tick = function () {
      self
        .api('/api/jobs/' + id)
        .then(function (job) {
          var phase = job.status === 'done' ? 'done' : job.status === 'needs_input' ? 'question' : job.status === 'error' ? 'form' : job.status === 'cancelled' ? 'form' : 'running';
          var patch = { job: job, phase: phase };
          if (job.status === 'error') patch.error = job.error;
          if (job.status === 'done' && !Object.keys(self.state.sel).length) {
            var sel = {};
            var lv = {};
            (job.result.items || []).forEach(function (it) {
              sel[it.id] = !it.optional;
              lv[it.id] = it.chosenLevel;
            });
            patch.sel = sel;
            patch.levelSel = lv;
          }
          self.set(patch);
          if (phase === 'running') self.timer = setTimeout(tick, 2000);
        })
        .catch(function (e) {
          self.set({ error: e.message });
          self.timer = setTimeout(tick, 5000);
        });
    };
    tick();
  };

  Widget.prototype.answer = function (text) {
    var self = this;
    if (!String(text || '').trim()) return;
    this.set({ phase: 'running' });
    this.api('/api/jobs/' + this.state.jobId + '/answer', 'POST', { answer: text })
      .then(function () {
        self.follow(self.state.jobId);
      })
      .catch(function (e) {
        self.set({ phase: 'question', error: e.message });
      });
  };

  Widget.prototype.addToWycena = function () {
    var self = this;
    var s = this.state;
    var items = (s.job.result.items || [])
      .filter(function (it) {
        return s.sel[it.id];
      })
      .map(function (it) {
        var lvl = s.levelSel[it.id];
        var offer = lvl ? it.offers[lvl] : null;
        return {
          aiItemId: it.id,
          aiJobId: s.jobId,
          status: 'ai_draft',
          needsCheck: it.status !== 'confirmed' && !it.orderBoth,
          orderBothVariants: !!it.orderBoth,
          variants: it.variants || [],
          checkReason: it.checkReason || null,
          group: it.group,
          name: it.name,
          quantity: it.quantity,
          unit: it.unit,
          oeNumber: it.oeNumber || null,
          level: lvl || null,
          brand: offer ? offer.brand : null,
          articleNumber: offer ? offer.articleNumber : null,
          supplier: offer ? offer.supplier : null,
          supplierSku: offer ? offer.sku : null,
          purchaseNet: offer ? offer.purchaseNet : null,
          priceNet: offer && offer.client ? offer.client.net : null,
          priceGross: offer && offer.client ? offer.client.gross : null,
          availability: offer ? offer.availability : null,
          offers: it.offers,
          evidence: it.evidence,
        };
      });
    if (!items.length) return;
    Promise.resolve(this.o.onAddItems ? this.o.onAddItems(items) : null)
      .then(function () {
        self.set({ added: true });
      })
      .catch(function (e) {
        self.set({ error: 'CRM не сохранила позиции: ' + e.message });
      });
  };

  Widget.prototype.render = function () {
    var self = this;
    var s = this.state;
    var o = this.o;
    var sh = this.shadow;
    sh.innerHTML = '';
    sh.appendChild(h('style', { text: CSS }));
    sh.appendChild(
      h('button', { class: 'trigger', type: 'button', onclick: function () { self.openDlg(); } }, [
        s.history && s.history.length ? 'Подобрать ещё (ИИ)' : 'Подбор запчастей (ИИ)',
      ])
    );
    if (!s.open) return;
    var v = o.vehicle || {};

    var body = h('div', { class: 'bd' });
    if (s.error) body.appendChild(h('div', { class: 'err', role: 'alert', text: s.error }));

    if (s.phase === 'form') body.appendChild(this.renderForm());
    if (s.phase === 'running') body.appendChild(this.renderProgress());
    if (s.phase === 'question') body.appendChild(this.renderQuestion());
    if (s.phase === 'done') body.appendChild(this.renderResult());

    var dlg = h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Подбор запчастей (ИИ)' }, [
      h('div', { class: 'hd' }, [
        h('h2', { text: 'Подбор запчастей (ИИ)' }),
        h('button', { class: 'x', type: 'button', 'aria-label': 'Закрыть', onclick: function () { clearTimeout(self.timer); self.set({ open: false }); } }, ['✕']),
      ]),
      h('div', { class: 'car' }, [
        h('div', null, [h('b', { text: 'Wycena' }), String(o.wycenaId || '—')]),
        h('div', null, [h('b', { text: 'Авто' }), [v.make, v.model, v.year].filter(Boolean).join(' ') || '—']),
        h('div', null, [h('b', { text: 'Двигатель' }), v.engine || '—']),
        h('div', null, [h('b', { text: 'VIN' }), h('span', { class: 'mono', text: v.vin || 'нет VIN' })]),
        h('div', null, [h('b', { text: 'Пробег' }), v.mileage ? v.mileage + ' km' : '—']),
      ]),
      body,
    ]);
    sh.appendChild(h('div', { class: 'overlay', onclick: function (e) { if (e.target === e.currentTarget) { clearTimeout(self.timer); self.set({ open: false }); } } }, [dlg]));
  };

  Widget.prototype.renderForm = function () {
    var self = this;
    var s = this.state;
    var ta = h('textarea', { id: 'need', rows: '4', placeholder: 'например: замена комплекта ГРМ + водяной насос + масло, масляный фильтр + свечи' });
    ta.value = s.text;
    ta.addEventListener('input', function () { s.text = ta.value; });
    var note = h('input', { type: 'text', id: 'note', placeholder: 'например: масло только Castrol' });
    note.value = s.note;
    note.addEventListener('input', function () { s.note = note.value; });
    var pasted = h('textarea', { id: 'pasted', rows: '4', placeholder: 'Вставьте строки, скопированные из partslink24 / HaynesPro — ассистент учтёт номера' });
    pasted.value = s.pasted;
    pasted.addEventListener('input', function () { s.pasted = pasted.value; });
    var pills = function (list, key) {
      return h('div', { class: 'pills', role: 'group' }, list.map(function (p) {
        return h('button', { type: 'button', class: 'pill' + (s[key] === p[0] ? ' on' : ''), 'aria-pressed': s[key] === p[0] ? 'true' : 'false', onclick: function () { self.set(Object.fromEntries([[key, p[0]]])); } }, [p[1]]);
      }));
    };
    var noVin = !(this.o.vehicle && this.o.vehicle.vin);
    return h('div', { style: 'display:flex;flex-direction:column;gap:16px' }, [
      h('div', null, [h('label', { class: 'l', for: 'need', text: 'Что нужно' }), ta, h('div', { class: 'hint', text: 'Пишите как запчастисту: работы или детали через «+» или запятую.' })]),
      h('div', null, [h('div', { class: 'l', text: 'Уровень запчастей' }), pills(LEVELS, 'level')]),
      h('div', null, [h('div', { class: 'l', text: 'Срочность' }), pills(URGENCY, 'urgency')]),
      h('div', null, [h('label', { class: 'l', for: 'note' }, ['Комментарий для ассистента ', h('span', { style: 'font-weight:400;color:#5b6372', text: '— необязательно' })]), note]),
      h('details', s.pasted ? { open: true } : null, [h('summary', { text: 'Вставить из каталога (partslink24 / HaynesPro)' }), h('div', { style: 'margin-top:8px' }, [pasted])]),
      noVin ? h('div', { class: 'err', text: 'Добавьте VIN в wycenę — без VIN подбор невозможен.' }) : null,
      h('div', { class: 'row' }, [h('button', { type: 'button', class: 'btn p', disabled: noVin, onclick: function () { self.start(); } }, ['Подобрать и добавить в wycenę'])]),
      this.renderHistory(),
    ]);
  };

  Widget.prototype.renderHistory = function () {
    var self = this;
    var list = this.state.history || [];
    if (!list.length) return h('div', { class: 'hist', text: 'Подборов в этой wycenie ещё не было.' });
    return h('div', { class: 'hist' }, [h('div', { style: 'font-weight:600;color:#1b1f27;margin-bottom:6px', text: 'История подборов' })].concat(
      list.slice(0, 5).map(function (j) {
        return h('div', { style: 'padding:4px 0' }, [
          j.createdAt + ' · «' + (j.text || '').slice(0, 80) + '» · ' + j.status + ' ',
          j.status === 'done' ? h('button', { type: 'button', class: 'btn', style: 'min-height:30px;padding:2px 10px;font-size:12px', onclick: function () { self.set({ sel: {}, levelSel: {} }); self.follow(j.id); } }, ['Открыть']) : null,
        ]);
      })
    ));
  };

  Widget.prototype.renderProgress = function () {
    var self = this;
    var steps = (this.state.job && this.state.job.steps) || [];
    return h('div', null, [
      h('div', { style: 'font-weight:600;margin-bottom:10px' }, [h('span', { class: 'spin' }), 'Ассистент подбирает запчасти…']),
      h('ul', { class: 'steps' }, steps.map(function (st) { return h('li', { text: st.text }); })),
      h('div', { class: 'hint', text: 'Обычно 1–5 минут (поиск по каталогам и форумам, проверка номеров). Окно можно закрыть — результат сохранится.' }),
      h('div', { class: 'row' }, [h('button', { type: 'button', class: 'btn', onclick: function () { self.api('/api/jobs/' + self.state.jobId + '/cancel', 'POST', {}).finally(function () { clearTimeout(self.timer); self.set({ phase: 'form' }); }); } }, ['Остановить'])]),
    ]);
  };

  Widget.prototype.renderQuestion = function () {
    var self = this;
    var q = (this.state.job && this.state.job.question) || {};
    var inp = h('input', { type: 'text', id: 'ans', placeholder: 'Ваш ответ' });
    return h('div', { class: 'q' }, [
      h('p', null, [h('b', { text: 'Вопрос ассистента: ' }), q.question || '']),
      q.why ? h('p', { class: 'hint', text: 'Зачем: ' + q.why }) : null,
      q.canAskClient ? h('p', { class: 'hint', text: 'Этот вопрос можно переслать клиенту (например, попросить фото).' }) : null,
      q.options && q.options.length
        ? h('div', { class: 'pills', style: 'margin-bottom:10px' }, q.options.map(function (op) { return h('button', { type: 'button', class: 'pill', onclick: function () { self.answer(op); } }, [op]); }))
        : null,
      h('div', { style: 'display:flex;gap:8px' }, [inp, h('button', { type: 'button', class: 'btn p', onclick: function () { self.answer(inp.value); } }, ['Ответить'])]),
      h('div', { class: 'hint', text: 'Если ответа пока нет — закройте окно и вернитесь позже, подбор подождёт.' }),
    ]);
  };

  Widget.prototype.renderResult = function () {
    var self = this;
    var s = this.state;
    var r = s.job.result || { items: [] };
    var rows = (r.items || []).map(function (it) {
      var lv = s.levelSel[it.id];
      var offer = lv ? it.offers[lv] : null;
      var cb = h('input', { type: 'checkbox', 'aria-label': 'Добавить позицию ' + it.name });
      cb.checked = !!s.sel[it.id];
      cb.addEventListener('change', function () { s.sel[it.id] = cb.checked; self.render(); });
      var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Уровень' }, LEVELS.map(function (L) {
        var has = !!it.offers[L[0]];
        return h('button', { type: 'button', class: lv === L[0] ? 'on' : '', disabled: !has, title: has ? '' : 'Нет предложения', onclick: function () { s.levelSel[it.id] = L[0]; self.render(); } }, [L[1]]);
      }));
      var ev = h('details', null, [
        h('summary', { style: 'font-size:12px', text: 'Источники (' + (it.evidence || []).length + ')' }),
        h('ul', { class: 'ev' }, (it.evidence || []).map(function (e) {
          var url = safeUrl(e.url);
          return h('li', null, [(EVIDENCE_LABEL[e.type] || e.type) + ': ', url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: e.title || url }) : (e.title || ''), e.detail ? ' — ' + e.detail : '']);
        })),
      ]);
      var variants = it.variants && it.variants.length
        ? h('div', { class: 'why' }, ['Варианты: ' + it.variants.map(function (x) { return x.condition + ' → ' + x.oeNumber; }).join('; ')])
        : null;
      var badge = it.orderBoth
        ? h('span', { class: 'badge b-chk', text: 'заказать оба варианта' })
        : it.optional
        ? h('span', { class: 'badge b-opt', text: 'по необходимости' })
        : it.status === 'confirmed'
          ? h('span', { class: 'badge b-ok', text: 'подтверждено' })
          : h('span', { class: 'badge b-chk', text: 'проверьте' });
      return h('tr', { class: it.status === 'confirmed' ? '' : 'check' }, [
        h('td', null, [cb]),
        h('td', null, [
          h('div', { style: 'font-weight:600', text: it.name }),
          h('div', { class: 'hint', text: it.quantity + ' ' + it.unit + (it.oeNumber ? ' · OE ' + it.oeNumber : '') }),
          it.status !== 'confirmed' && it.checkReason ? h('div', { class: 'why', text: 'Проверьте: ' + it.checkReason }) : null,
          variants,
          ev,
        ]),
        h('td', null, [seg]),
        h('td', null, offer ? [h('div', { style: 'font-weight:500', text: offer.brand + ' ' + offer.articleNumber }), h('div', { class: 'hint', text: (offer.supplier || '') + (offer.availability ? ' · ' + offer.availability : '') })] : [h('span', { class: 'hint', text: 'нет предложения' })]),
        h('td', { style: 'text-align:right' , text: offer ? money(offer.purchaseNet) : '—' }),
        h('td', { style: 'text-align:right;font-weight:600', text: offer && offer.client ? money(offer.client.net) : '—' }),
        h('td', null, [badge]),
      ]);
    });

    var tot = { p: 0, n: 0, g: 0 };
    (r.items || []).forEach(function (it) {
      if (!s.sel[it.id]) return;
      var o = s.levelSel[it.id] ? it.offers[s.levelSel[it.id]] : null;
      if (!o) return;
      var q = Number(it.quantity || 1);
      tot.p += (o.purchaseNet || 0) * q;
      if (o.client) { tot.n += o.client.net * q; tot.g += o.client.gross * q; }
    });
    var selectedCount = Object.keys(s.sel).filter(function (k) { return s.sel[k]; }).length;

    return h('div', { style: 'display:flex;flex-direction:column;gap:14px' }, [
      h('div', { class: 'note' }, [h('b', { text: r.vehicle && r.vehicle.summary ? r.vehicle.summary : '' }), r.vehicle && r.vehicle.options && r.vehicle.options.length ? ' · опции: ' + r.vehicle.options.join(', ') : '', r.notes ? h('div', { style: 'margin-top:6px', text: r.notes }) : null]),
      r.questions && r.questions.length ? h('div', { class: 'q' }, [h('b', { text: 'Осталось уточнить: ' }), r.questions.join(' · ')]) : null,
      h('div', { class: 'tw' }, [
        h('table', null, [
          h('thead', null, [h('tr', null, ['', 'Позиция', 'Уровень', 'Бренд · поставщик', 'Закупка netto', 'Клиенту netto', 'Статус'].map(function (t) { return h('th', { text: t }); }))]),
          h('tbody', null, rows),
        ]),
      ]),
      h('div', { class: 'tot' }, [h('span', { text: 'Закупка: ' + money(tot.p) }), h('span', { text: 'Клиенту netto: ' + money(tot.n) }), h('span', { text: 'brutto: ' + money(tot.g) })]),
      s.added
        ? h('div', { class: 'ok', text: 'Позиции добавлены в wycenę со статусом «Черновик ИИ». Позиции «проверьте» не заказываются, пока не подтверждены.' })
        : h('div', { class: 'row' }, [
            h('button', { type: 'button', class: 'btn', onclick: function () { self.set({ phase: 'form', job: null, sel: {}, levelSel: {} }); } }, ['Новый подбор']),
            h('button', { type: 'button', class: 'btn p', disabled: !selectedCount, onclick: function () { self.addToWycena(); } }, ['Добавить в wycenę (' + selectedCount + ')']),
          ]),
    ]);
  };

  window.AiParts = {
    mount: function (el, opts) {
      if (!el) throw new Error('AiParts.mount: нет элемента');
      if (!opts || !opts.serviceUrl || !opts.token) throw new Error('AiParts.mount: нужны serviceUrl и token');
      return new Widget(el, opts);
    },
  };
})();
