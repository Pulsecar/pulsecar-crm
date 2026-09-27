// Поставщики: документы от всех поставщиков → склад или заказ одной кнопкой; поиск деталей; кнопка «В Pulsecar» для сайтов поставщиков
import { html, useState, useEffect, useRef, useData, api, act, go, qs, useApp, Loading, ErrorBox, Icon, Modal, Picker, ConfirmButton, zl, num, fdate, fdt, toast } from '../lib.js';

// ── Кнопка-закладка для сайтов поставщиков (как wtyczka Motowarsztat, но без установки) ──
export function bookmarklet(base) {
  const code = `(function(){var P=${JSON.stringify(base)};function t(e){return(e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim()}
var best=null,sc=0;document.querySelectorAll('table').forEach(function(tb){var rs=tb.querySelectorAll('tr');if(rs.length<2||!tb.offsetParent)return;var h=t(tb.querySelector('thead')||rs[0]).toLowerCase();var s=rs.length+(/indeks|kod|nazwa|ilo|cena|netto|symbol|numer|artyku/.test(h)?100:0);if(s>sc){sc=s;best=tb}});
var sel=String(window.getSelection()||''),p;
if(sel.length>15){p={text:sel}}else if(best){var rs=[].slice.call(best.querySelectorAll('tr'));var hd=[].slice.call(rs[0].querySelectorAll('th,td')).map(t);var rows=rs.slice(1).map(function(r){return[].slice.call(r.querySelectorAll('td')).map(t)}).filter(function(c){return c.length>1&&c.join('')});p={text:[hd].concat(rows).map(function(c){return c.join('\\t')}).join('\\n')}}
else{var rr=[].slice.call(document.querySelectorAll('[role=row]')).map(function(r){return[].slice.call(r.querySelectorAll('[role=cell],[role=gridcell],[role=columnheader]')).map(t).join('\\t')}).filter(Boolean);p={text:rr.join('\\n')}}
if(!p.text){alert('Pulsecar: nie znaleziono tabeli. Zaznacz wiersze myszką i kliknij ponownie.');return}
var w=window.open(P+'/#/suppliers/clip','pulsecar_clip','width=1150,height=820');var m={type:'pulsecar-clip',host:location.hostname,url:location.href,title:document.title,text:p.text};
var n=0,iv=setInterval(function(){try{w.postMessage(m,P)}catch(e){}if(++n>60)clearInterval(iv)},400);window.addEventListener('message',function(e){if(e.origin===P&&e.data==='pulsecar-clip-ok')clearInterval(iv)})})();`;
  return 'javascript:' + encodeURIComponent(code.replace(/\n/g, ''));
}

const supplierByHost = (list, host) => list.find((w) => w.site && String(host || '').endsWith(w.site))?.key || 'other';

/** Таблица позиций с галочками (общая для документов, буфера и кнопки) */
function Lines({ lines, pick, setPick, editable, setLines, markup }) {
  const all = pick.length === lines.length;
  const upd = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const sell = (l) => l.sell ?? (l.retail_gross > 0 ? l.retail_gross : Math.round(l.price_net * (1 + (l.vat ?? 23) / 100) * (1 + (markup || 0) / 100) * 100) / 100);
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr>
      <th style="width:30px"><input type="checkbox" checked=${all} onChange=${() => setPick(all ? [] : lines.map((_, i) => i))} /></th>
      <th>Индекс</th><th>Название</th><th class="r">Кол-во</th><th class="r">Закупка нетто</th><th class="r">Продажа брутто</th><th>На складе</th></tr></thead>
    <tbody>${lines.map((l, i) => html`<tr>
      <td><input type="checkbox" checked=${pick.includes(i)} onChange=${(e) => setPick(e.target.checked ? [...pick, i] : pick.filter((x) => x !== i))} /></td>
      <td class="nowrap">${editable ? html`<input class="inline-input" style="width:120px" value=${l.code || ''} onInput=${(e) => upd(i, 'code', e.target.value)} />` : html`<b>${l.code || '—'}</b>`}${l.brand ? html`<div class="sub">${l.brand}</div>` : ''}</td>
      <td>${editable ? html`<input class="inline-input" style="min-width:240px" value=${l.name} onInput=${(e) => upd(i, 'name', e.target.value)} />` : l.name}</td>
      <td class="r">${editable ? html`<input class="inline-input num" type="number" step="0.1" value=${l.qty} onInput=${(e) => upd(i, 'qty', Number(e.target.value))} />` : num(l.qty, 2)}</td>
      <td class="r nowrap">${editable ? html`<input class="inline-input num" type="number" step="0.01" value=${l.price_net} onInput=${(e) => upd(i, 'price_net', Number(e.target.value))} />` : zl(l.price_net)}</td>
      <td class="r nowrap">${zl(sell(l))}</td>
      <td class="sub">${l.product ? html`есть · ${num(l.product.stock, 2)}` : 'новый товар'}</td></tr>`)}</tbody></table></div>`;
}

/** Выбор заказа или выцены, куда добавить запчасти */
function OrderPick({ value, onPick }) {
  return value ? html`<div class="row"><b>${value.number}</b> <span class="muted">${value.customer_name || ''} ${value.plate || ''}</span><button class="btn ghost sm" onClick=${() => onPick(null)}>Сменить</button></div>`
    : html`<${Picker} placeholder="Заказ или выцена: номер, клиент, авто…" path=${(q) => 'orders?' + qs({ q, status: 'open', kind: 'all' })}
        render=${(o) => html`<b>${o.number}</b> <span class="chip">${o.kind === 'quote' ? 'выцена' : 'заказ'}</span> <span class="sub">${o.customer_name || ''} · ${[o.make, o.model, o.plate].filter(Boolean).join(' ')}</span>`}
        onPick=${onPick} />`;
}

// ── Склад → Поставщики ────────────────────────────────────────────────────────
export function SuppliersPage() {
  const app = useApp();
  const [supplier, setSupplier] = useState('');
  const [state, setState] = useState('new');
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useData('suppliers?' + qs({ supplier, state }));
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data && loading) return html`<${Loading} />`;
  const sync = async () => {
    setBusy(true);
    try {
      const r = await act(() => api('suppliers/sync', { body: { days: 7 } }));
      const parts = Object.entries(r).map(([k, v]) => `${k === 'intercars' ? 'Inter Cars' : k === 'hart' ? 'Hart' : 'Почта'}: ${v.error ? 'ошибка — ' + v.error : `новых ${v.created}`}`);
      toast(parts.join(' · ') || 'Нет подключённых поставщиков с API или почты', parts.some((p) => p.includes('ошибка')) ? 'error' : 'ok');
      reload();
    } finally { setBusy(false); }
  };
  const anyAuto = data.api.intercars || data.api.hart || data.api.mailbox;
  return html`<div class="stack">
    <div class="card row">
      <select style="width:230px" value=${supplier} onChange=${(e) => setSupplier(e.target.value)}><option value="">Все поставщики</option>
        ${data.wholesalers.filter((w) => w.docs || w.connected).map((w) => html`<option value=${w.key}>${w.name}</option>`)}</select>
      <select style="width:200px" value=${state} onChange=${(e) => setState(e.target.value)}><option value="new">Не принятые на склад</option><option value="">Все документы</option></select>
      <div class="row" style="margin-left:auto">
        ${anyAuto && html`<button class="btn" disabled=${busy} onClick=${sync}>${busy ? 'Проверяю…' : 'Проверить новые'}</button>`}
        <button class="btn primary" onClick=${() => setAdding(true)}><${Icon} n="plus" />Добавить документ</button></div>
    </div>
    <div class="card tight">${data.docs.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Дата</th><th>Поставщик</th><th>Документ</th><th class="r">Позиций</th><th class="r">Нетто</th><th class="r">Брутто</th><th>Статус</th></tr></thead>
      <tbody>${data.docs.map((d) => html`<tr class="click" onClick=${() => setOpen(d.id)}><td class="nowrap">${fdate(d.doc_date)}</td><td><b>${d.supplier_name}</b><div class="sub">${KIND[d.kind] || d.kind}</div></td>
        <td>${d.ext_id}</td><td class="r">${d.lines_count}</td><td class="r nowrap">${zl(d.total_net)}</td><td class="r nowrap">${zl(d.total_gross)}</td>
        <td class="small">${d.stock_number ? html`<span class="pos">✓ на складе ${d.stock_number}</span>` : html`<span class="muted">новый</span>`}${d.used_in ? html`<div class="sub">в заказе ${d.used_in}</div>` : ''}</td></tr>`)}</tbody></table></div>`
      : html`<div class="empty">${state === 'new' ? 'Нет новых документов от поставщиков' : 'Документов пока нет'}</div>`}</div>
    <${Extension} />
    <${HowTo} data=${data} />
    ${open && html`<${DocModal} id=${open} markup=${data.markup} onClose=${() => { setOpen(null); reload(); }} />`}
    ${adding && html`<${AddDoc} wholesalers=${data.wholesalers} markup=${data.markup} onClose=${() => setAdding(false)} onSaved=${(id) => { setAdding(false); reload(); setOpen(id); }} />`}
  </div>`;
}
const KIND = { delivery: 'WZ / поставка', invoice: 'Фактура', email: 'Из почты', clip: 'С сайта поставщика', paste: 'Вставлено', file: 'Файл', manual: 'Вручную' };

/** Связь с расширением Chrome: connect.js на странице CRM отвечает на ping и принимает ключ */
function useExtension() {
  const [ext, setExt] = useState(() => (document.documentElement.dataset.pulsecarExt ? { version: document.documentElement.dataset.pulsecarExt } : null));
  useEffect(() => {
    const on = (e) => {
      if (e.source !== window || e.data?.source !== 'pulsecar-ext') return;
      if (e.data.type === 'hello') setExt((x) => ({ ...x, ...e.data }));
      if (e.data.type === 'connected') {
        setExt((x) => ({ ...x, connected: e.data.ok, user: e.data.user }));
        e.data.ok ? toast(`Расширение подключено: ${e.data.user}`) : toast(e.data.error || 'Не удалось подключить расширение', 'error');
      }
    };
    window.addEventListener('message', on);
    window.postMessage({ source: 'pulsecar-crm', type: 'ping' }, location.origin);
    return () => window.removeEventListener('message', on);
  }, []);
  return ext;
}

function Extension() {
  const [tok, setTok] = useState(null);
  const [latest, setLatest] = useState(null);
  const ext = useExtension();
  useEffect(() => { api('ext/version').then((r) => setLatest(r.version)).catch(() => {}); }, []);
  const outdated = ext?.version && latest && ext.version.localeCompare(latest, undefined, { numeric: true }) < 0;
  const connect = async () => {
    const r = await act(() => api('me/ext-token', { body: {} }));
    window.postMessage({ source: 'pulsecar-crm', type: 'connect', token: r.token }, location.origin);
  };
  return html`<div class="card stack" style="border-color:rgba(27,243,114,.45)">
    <div class="row" style="justify-content:space-between;align-items:baseline"><h2 style="margin:0">Расширение Chrome «Pulsecar» — кнопка прямо на сайте поставщика</h2>
      <span class="badge" style=${'border-color:' + (ext?.connected ? 'var(--accent)' : ext ? 'var(--warn)' : 'var(--border)') + ';color:' + (ext?.connected ? 'var(--accent)' : ext ? 'var(--warn)' : 'var(--muted)')}>${!ext ? 'не установлено в этом браузере' : ext.connected ? `подключено · ${ext.user} · v${ext.version}` : `установлено v${ext.version} · не подключено`}</span></div>
    <div class="grid g2">
      <div class="stack" style="gap:6px">
        <div class="small">У каждой детали в каталоге Inter Cars — кнопка <b>Pulsecar</b> рядом с «Do koszyka»: <b>товар в картотеку, приход на склад, в заказ или в выцену</b>. Цена закупки — ваша цена, цена продажи — рекомендованная розничная цена поставщика. Кнопка в углу на сайтах поставщиков забирает <b>корзину, фактуру или WZ</b> целиком: документ сохраняется в CRM (без дублей по номеру) и сразу приходуется на склад или уходит в заказ. Поставщики нет в списке — включите кнопку на её сайте из окна расширения.</div>
        ${!ext ? html`<ol class="small muted" style="margin:0;padding-left:18px"><li>Скачайте архив и распакуйте.</li><li>Chrome → <code>chrome://extensions</code> → «Режим разработчика» → «Загрузить распакованное» → папка <code>pulsecar-extension</code>.</li><li>Обновите эту страницу и нажмите «Подключить расширение».</li></ol>` : ''}
        ${outdated ? html`<div class="small" style="color:var(--warn)">Есть новая версия ${latest}: скачайте архив, распакуйте поверх старой папки и нажмите ⟳ у расширения в <code>chrome://extensions</code>.</div>` : ''}
        <div class="row"><a class=${'btn ' + (ext && !outdated ? '' : 'primary')} href="/pulsecar-extension.zip" download>Скачать расширение${latest ? ' v' + latest : ''}</a>
          ${ext ? html`<button class="btn primary" onClick=${connect}>${ext.connected ? 'Переподключить' : 'Подключить расширение'}</button>` : ''}</div></div>
      <div class="stack" style="gap:6px"><b class="small">Ключ вручную (если расширение в другом браузере)</b>
        ${tok ? html`<pre class="code">${tok}</pre><div class="row"><button class="btn sm" onClick=${() => navigator.clipboard?.writeText(tok).then(() => toast('Ключ скопирован'))}>Копировать</button><span class="muted small">Показывается один раз. Права — как у вашей учётной записи.</span></div>`
          : html`<div class="row"><button class="btn" onClick=${async () => { const r = await act(() => api('me/ext-token', { body: {} })); setTok(r.token); }}>Получить ключ</button>
            <${ConfirmButton} cls="btn ghost sm" label="Отключить ключ расширения?" onConfirm=${async () => { await act(() => api('me/ext-token', { method: 'DELETE' }), 'Ключ отключён'); }}>Отключить ключ</${ConfirmButton}></div>
            <div class="muted small">У каждого сотрудника свой ключ. Новый ключ заменяет старый — расширение с прежним ключом перестанет работать.</div>`}</div>
    </div></div>`;
}

function HowTo({ data }) {
  const base = location.origin;
  const withApi = data.wholesalers.filter((w) => w.api);
  return html`<div class="card stack">
    <h2>Как получать запчасти от поставщиков</h2>
    <div class="grid g2">
      <div class="stack" style="gap:6px"><b>1. Прямое подключение (API)</b>
        <div class="small">${withApi.map((w) => html`<div>${w.connected ? '✓' : '○'} ${w.name} ${w.connected ? html`<span class="pos">подключено</span>` : html`— <a href="#/settings/integrations">ввести ключи</a>`}</div>`)}</div>
        <div class="muted small">Поставки и фактуры приходят сами каждые 30 минут. Поиск цены и наличия и заказ — прямо из заказа клиента.</div></div>
      <div class="stack" style="gap:6px"><b>2. Кнопка «В Pulsecar» — для любого поставщика</b>
        <div class="row"><a class="btn primary" href=${bookmarklet(base)} onClick=${(e) => { e.preventDefault(); toast('Перетащите кнопку мышкой на панель закладок браузера'); }} draggable="true">⬆ В Pulsecar</a>
          <span class="muted small">Перетащите кнопку на панель закладок Chrome.</span></div>
        <div class="muted small">Откройте в B2B поставщика (Auto Partner, Inter-Team, Moto-Profil, Gordon, Motorol…) корзину, заказ, WZ или фактуру и нажмите закладку — позиции откроются в CRM. Если таблицу не видно, выделите строки мышкой и нажмите ещё раз.</div></div>
      <div class="stack" style="gap:6px"><b>3. Почтовый ящик</b>
        <div class="muted small">${data.api.mailbox ? html`<span class="pos">✓ подключён</span> — ` : html`<a href="#/settings/integrations">Подключить ящик</a> — `}поставщики присылают фактуры и WZ файлом CSV/XLSX на отдельный адрес, CRM забирает их сама.</div></div>
      <div class="stack" style="gap:6px"><b>4. Файл или копирование</b>
        <div class="muted small">«Добавить документ» → скопируйте таблицу с сайта (Ctrl+C) и вставьте, или загрузите CSV/XLSX, скачанный из B2B поставщика.</div></div>
    </div></div>`;
}

function DocModal({ id, markup, onClose }) {
  const app = useApp();
  const { data: d, loading, error, reload } = useData('suppliers/docs/' + id);
  const [pick, setPick] = useState(null);
  const [order, setOrder] = useState(null);
  const [toStock, setToStock] = useState(true);
  if (error) return html`<${Modal} title="Документ" onClose=${onClose}><${ErrorBox} error=${error} /></${Modal}>`;
  if (!d) return html`<${Modal} title="Документ" onClose=${onClose}><${Loading} /></${Modal}>`;
  const sel = pick ?? d.lines.map((_, i) => i);
  const partial = sel.length !== d.lines.length;
  const receive = async () => { const r = await act(() => api(`suppliers/docs/${d.id}/receive`, { body: { pick: partial ? sel : null } }), 'Принято на склад'); toast(`Приход оформлен: ${r.lines} поз.`); reload(); };
  const toOrder = async () => {
    const r = await act(() => api(`suppliers/docs/${d.id}/to-order`, { body: { order_id: order.id, pick: partial ? sel : null, toStock: toStock && order.kind !== 'quote' } }));
    toast(`Добавлено в ${r.order}: ${r.added} поз.`);
    go((order.kind === 'quote' ? '/quotes/' : '/orders/') + order.id);
  };
  return html`<${Modal} wide title=${`${d.supplier_name}: ${d.ext_id}`} onClose=${onClose} foot=${html`
      ${!d.stock_doc_id && app.perms['suppliers.receive'] && html`<${ConfirmButton} cls="btn ghost danger" label="Удалить документ?" onConfirm=${async () => { await act(() => api('suppliers/docs/' + d.id, { method: 'DELETE' }), 'Удалено'); onClose(); }}><${Icon} n="trash" /></${ConfirmButton}>`}
      <span style="margin-right:auto"></span>
      ${!d.stock_doc_id && app.perms['suppliers.receive'] && html`<button class="btn" disabled=${!sel.length} onClick=${receive}>Принять на склад${partial ? ` (${sel.length})` : ''}</button>`}`}>
    <div class="muted small" style="margin-bottom:8px">${fdate(d.doc_date)} · ${d.lines.length} поз. · нетто ${zl(d.total_net)} · брутто ${zl(d.total_gross)}
      ${d.stock_doc_id ? html` · <span class="pos">✓ принято на склад</span>` : ''}${d.used_in ? html` · в заказе ${d.used_in}` : ''}${d.meta?.file ? ' · файл ' + d.meta.file : ''}</div>
    <${Lines} lines=${d.lines} pick=${sel} setPick=${setPick} markup=${markup} />
    ${app.perms['orders.jobs'] && html`<div class="card" style="margin-top:12px;background:var(--surface2)">
      <b>Сразу в заказ или выцену клиента</b>
      <div class="row" style="margin-top:8px"><div class="grow"><${OrderPick} value=${order} onPick=${setOrder} /></div></div>
      ${order && html`<div class="row" style="margin-top:8px">
        ${order.kind !== 'quote' && !d.stock_doc_id && html`<label class="check"><input type="checkbox" checked=${toStock} onChange=${(e) => setToStock(e.target.checked)} />Заодно оприходовать на склад и выдать в заказ</label>`}
        <button class="btn primary" style="margin-left:auto" disabled=${!sel.length} onClick=${toOrder}>Добавить ${sel.length} поз. в ${order.number}</button></div>`}
    </div>`}
  </${Modal}>`;
}

/** Новый документ: вставка из буфера, файл, выбор поставщика */
function AddDoc({ wholesalers, markup, onClose, onSaved, preset }) {
  const [supplier, setSupplier] = useState(preset?.supplier || 'other');
  const [extId, setExtId] = useState(preset?.ext_id || '');
  const [text, setText] = useState(preset?.text || '');
  const [lines, setLines] = useState(null);
  const [pick, setPick] = useState([]);
  const parse = async (t = text) => { const r = await act(() => api('suppliers/parse', { body: { text: t } })); setLines(r.lines); setPick(r.lines.map((_, i) => i)); };
  useEffect(() => { if (preset?.text) parse(preset.text); }, []);
  const file = async (f) => {
    const fd = new FormData(); fd.append('file', f);
    const r = await act(() => api('suppliers/parse-file', { form: fd }));
    setLines(r.lines); setPick(r.lines.map((_, i) => i)); if (!extId) setExtId(f.name.replace(/\.[^.]+$/, ''));
  };
  const save = async () => {
    const r = await act(() => api('suppliers/docs', { body: { supplier, ext_id: extId || undefined, kind: preset ? 'clip' : 'paste', url: preset?.url, lines: lines.filter((_, i) => pick.includes(i)) } }), 'Документ сохранён');
    onSaved(r.id);
  };
  return html`<${Modal} wide title="Документ от поставщика" onClose=${onClose} foot=${lines && html`<button class="btn primary" disabled=${!pick.length} onClick=${save}>Сохранить (${pick.length} поз.) и выбрать: склад или заказ</button>`}>
    <div class="grid g2"><label class="f">Поставщик<select value=${supplier} onChange=${(e) => setSupplier(e.target.value)}>${wholesalers.map((w) => html`<option value=${w.key}>${w.name}</option>`)}</select></label>
      <label class="f">Номер документа (WZ, фактура, заказ)<input value=${extId} onInput=${(e) => setExtId(e.target.value)} placeholder="необязательно" /></label></div>
    ${!lines ? html`
      <label class="f" style="margin-top:10px">Скопируйте таблицу на сайте поставщика (выделить → Ctrl+C) и вставьте сюда<textarea rows="8" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Indeks	Nazwa	Ilość	Cena netto"></textarea></label>
      <div class="row"><button class="btn primary" disabled=${!text.trim()} onClick=${() => parse()}>Разобрать</button>
        <label class="btn"><${Icon} n="upload" />Файл CSV / XLSX<input type="file" accept=".csv,.xlsx,.xls,.txt" hidden onChange=${(e) => e.target.files[0] && file(e.target.files[0])} /></label></div>`
      : html`<div style="margin-top:10px"><div class="row" style="margin-bottom:6px"><span class="muted small">Проверьте позиции — всё можно поправить.</span><button class="btn ghost sm" style="margin-left:auto" onClick=${() => setLines(null)}>Назад</button></div>
          <${Lines} lines=${lines} pick=${pick} setPick=${setPick} editable setLines=${setLines} markup=${markup} /></div>`}
  </${Modal}>`;
}

/** Окно, которое открывает кнопка «В Pulsecar» с сайта поставщика */
export function ClipPage() {
  const { data } = useData('suppliers?state=new');
  const [msg, setMsg] = useState(null);
  const [saved, setSaved] = useState(null);
  useEffect(() => {
    const on = (e) => {
      if (!e.data || e.data.type !== 'pulsecar-clip' || typeof e.data.text !== 'string') return;
      try { e.source?.postMessage('pulsecar-clip-ok', e.origin); } catch {}
      setMsg((m) => m || { text: e.data.text.slice(0, 200000), host: String(e.data.host || '').slice(0, 100), url: String(e.data.url || '').slice(0, 500), title: String(e.data.title || '').slice(0, 200) });
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, []);
  if (!msg) return html`<div class="card stack"><h2>Жду данные с сайта поставщика…</h2><div class="muted small">Это окно открывает кнопка-закладка «В Pulsecar» (Склад → Поставщики). Если ничего не происходит, вернитесь на сайт поставщика и нажмите закладку ещё раз.</div></div>`;
  if (!data) return html`<${Loading} />`;
  if (saved) return html`<${DocModal} id=${saved} markup=${data.markup} onClose=${() => go('/stock/suppliers')} />`;
  return html`<div class="page-head"><h1>С сайта ${msg.host}</h1></div>
    <${AddDoc} wholesalers=${data.wholesalers} markup=${data.markup} preset=${{ text: msg.text, url: msg.url, supplier: supplierByHost(data.wholesalers, msg.host), ext_id: msg.title.slice(0, 60) }}
      onClose=${() => go('/stock/suppliers')} onSaved=${setSaved} />`;
}

// ── В заказе: «От поставщика» ─────────────────────────────────────────────────
export function SupplierParts({ o, onClose, onAdd }) {
  const app = useApp();
  const [tab, setTab] = useState('search');
  return html`<${Modal} wide title="Запчасти от поставщиков" onClose=${onClose}>
    <div class="pill-tabs" style="margin-bottom:12px">
      <button class=${tab === 'search' ? 'on' : ''} onClick=${() => setTab('search')}>Поиск цены и наличия</button>
      <button class=${tab === 'docs' ? 'on' : ''} onClick=${() => setTab('docs')}>Из поставки / фактуры</button>
      <button class=${tab === 'paste' ? 'on' : ''} onClick=${() => setTab('paste')}>Вставить с сайта</button>
    </div>
    ${tab === 'search' && html`<${Search} o=${o} onAdd=${onAdd} />`}
    ${tab === 'docs' && html`<${FromDocs} o=${o} done=${onClose} />`}
    ${tab === 'paste' && html`<${FromPaste} o=${o} done=${onClose} />`}
  </${Modal}>`;
}

function Search({ o, onAdd }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cart, setCart] = useState([]);
  const search = async (e) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try { setRes(await api('suppliers/search?q=' + encodeURIComponent(q.trim()))); } catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  const add = async (r) => {
    await onAdd({ kind: 'part', name: `${r.name} ${r.index || ''}`.trim(), code: r.index, qty: 1, unit: 'szt.', price: r.sellSuggested, cost: r.priceNet, vat: r.vat });
    setCart((c) => (c.some((x) => x.sku === r.sku && x.supplier === r.supplier) ? c : [...c, { ...r, qty: 1 }]));
    toast('Добавлено в ' + o.number);
  };
  const orderAt = async (sup) => {
    const lines = cart.filter((c) => c.supplier === sup);
    const r = await act(() => api('suppliers/order', { body: { supplier: sup, order_id: o.id, customNumber: o.number, lines } }));
    toast(`Заказ в ${sup === 'hart' ? 'Hart' : 'Inter Cars'} отправлен${r.requisitionId ? ': ' + r.requisitionId : ''}`);
    setCart(cart.filter((c) => c.supplier !== sup));
  };
  if (res && !res.connected.intercars && !res.connected.hart) return html`<div class="empty">Поиск работает с поставщиками, у которых есть API: Inter Cars и Hart. <a href="#/settings/integrations">Подключить</a>. Для остальных — вкладка «Вставить с сайта».</div>`;
  const sups = [...new Set(cart.map((c) => c.supplier))];
  return html`
    <form class="row" onSubmit=${search}><input class="grow" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Индекс детали (OP 520, GDB1330) или код Hart" autofocus />
      <button class="btn primary" disabled=${busy}>${busy ? 'Ищу…' : 'Найти у всех'}</button></form>
    ${res?.errors?.length ? html`<div class="err small" style="margin-top:6px">${res.errors.join(' · ')}</div>` : ''}
    ${res && (res.rows.length ? html`<table class="tbl" style="margin-top:8px"><thead><tr><th>Поставщик</th><th>Деталь</th><th class="r">Ваша цена нетто</th><th class="r">Продажа</th><th class="r">Наличие</th><th></th></tr></thead>
      <tbody>${res.rows.sort((a, b) => a.priceNet - b.priceNet).map((r) => html`<tr><td><b>${r.supplier === 'hart' ? 'Hart' : 'Inter Cars'}</b></td>
        <td><b>${r.index}</b> ${r.name}<div class="sub">${r.sku}</div></td><td class="r nowrap">${zl(r.priceNet)}</td><td class="r nowrap"><b>${zl(r.sellSuggested)}</b></td>
        <td class="r nowrap ${r.availability ? 'pos' : 'neg'}">${r.availability} шт.<div class="sub">${(r.locations || []).slice(0, 3).join(', ')}</div></td>
        <td class="act"><button class="btn sm" onClick=${() => add(r)}>В ${o.kind === 'quote' ? 'выцену' : 'заказ'}</button></td></tr>`)}</tbody></table>`
      : html`<div class="empty">Ничего не найдено по «${q}»</div>`)}
    ${sups.length ? html`<div class="row" style="margin-top:10px"><span class="muted small" style="margin-right:auto">Заказать у поставщика то, что добавили:</span>
      ${sups.map((sp) => html`<${ConfirmButton} cls="btn primary" label=${'Отправить заказ?'} onConfirm=${() => orderAt(sp)}>Заказать в ${sp === 'hart' ? 'Hart' : 'Inter Cars'} (${cart.filter((c) => c.supplier === sp).length})</${ConfirmButton}>`)}</div>` : ''}`;
}

function FromDocs({ o, done }) {
  const { data } = useData('suppliers?state=');
  const [id, setId] = useState(null);
  const { data: d } = useData(id ? 'suppliers/docs/' + id : null);
  const [pick, setPick] = useState(null);
  const [toStock, setToStock] = useState(true);
  if (!data) return html`<${Loading} />`;
  if (!id) return data.docs.length ? html`<table class="tbl"><tbody>${data.docs.slice(0, 40).map((x) => html`<tr class="click" onClick=${() => { setId(x.id); setPick(null); }}>
      <td class="nowrap">${fdate(x.doc_date)}</td><td><b>${x.supplier_name}</b></td><td>${x.ext_id}</td><td class="r">${x.lines_count} поз.</td><td class="r nowrap">${zl(x.total_net)}</td>
      <td class="small">${x.stock_number ? html`<span class="pos">на складе</span>` : 'новый'}${x.used_in ? html`<div class="sub">в ${x.used_in}</div>` : ''}</td></tr>`)}</tbody></table>`
    : html`<div class="empty">Документов от поставщиков пока нет. Они появятся из Inter Cars/Hart, почты или кнопки «В Pulsecar».</div>`;
  if (!d) return html`<${Loading} />`;
  const sel = pick ?? d.lines.map((_, i) => i);
  return html`<div class="row" style="margin-bottom:6px"><b>${d.supplier_name}: ${d.ext_id}</b><button class="btn ghost sm" style="margin-left:auto" onClick=${() => setId(null)}>Другой документ</button></div>
    <${Lines} lines=${d.lines} pick=${sel} setPick=${setPick} markup=${data.markup} />
    <div class="row" style="margin-top:10px">
      ${o.kind !== 'quote' && !d.stock_doc_id && html`<label class="check"><input type="checkbox" checked=${toStock} onChange=${(e) => setToStock(e.target.checked)} />Оприходовать на склад и выдать в заказ</label>`}
      <button class="btn primary" style="margin-left:auto" disabled=${!sel.length} onClick=${async () => {
        const r = await act(() => api(`suppliers/docs/${d.id}/to-order`, { body: { order_id: o.id, pick: sel.length === d.lines.length ? null : sel, toStock: toStock && o.kind !== 'quote' } }));
        toast(`Добавлено: ${r.added} поз.`); done();
      }}>Добавить ${sel.length} поз. в ${o.number}</button></div>`;
}

function FromPaste({ o, done }) {
  const { data } = useData('suppliers?state=new');
  const [supplier, setSupplier] = useState('other');
  const [text, setText] = useState('');
  const [lines, setLines] = useState(null);
  const [pick, setPick] = useState([]);
  if (!data) return html`<${Loading} />`;
  const go2 = async () => {
    const saved = await act(() => api('suppliers/docs', { body: { supplier, kind: 'paste', ext_id: `${o.number} · ${new Date().toLocaleString('pl-PL')}`, lines: lines.filter((_, i) => pick.includes(i)) } }));
    const r = await act(() => api(`suppliers/docs/${saved.id}/to-order`, { body: { order_id: o.id, toStock: false } }));
    toast(`Добавлено: ${r.added} поз.`); done();
  };
  return html`<div class="grid g2"><label class="f">Поставщик<select value=${supplier} onChange=${(e) => setSupplier(e.target.value)}>${data.wholesalers.map((w) => html`<option value=${w.key}>${w.name}</option>`)}</select></label></div>
    ${!lines ? html`<label class="f" style="margin-top:8px">Скопируйте строки корзины или результата поиска на сайте поставщика и вставьте<textarea rows="7" value=${text} onInput=${(e) => setText(e.target.value)}></textarea></label>
      <button class="btn primary" disabled=${!text.trim()} onClick=${async () => { const r = await act(() => api('suppliers/parse', { body: { text } })); setLines(r.lines); setPick(r.lines.map((_, i) => i)); }}>Разобрать</button>`
      : html`<div style="margin-top:8px"><${Lines} lines=${lines} pick=${pick} setPick=${setPick} editable setLines=${setLines} markup=${data.markup} />
        <div class="row" style="margin-top:10px"><button class="btn ghost" onClick=${() => setLines(null)}>Назад</button><button class="btn primary" style="margin-left:auto" disabled=${!pick.length} onClick=${go2}>Добавить ${pick.length} поз. в ${o.number}</button></div></div>`}`;
}
