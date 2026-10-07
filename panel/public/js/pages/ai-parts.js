// ИИ-запчастист в выцене / заказе: кнопка, форма подбора с ходом работы, баннер «ИИ добавил N позиций», варианты Эконом / Средний / OE у позиций.
import { html, useState, useEffect, api, act, Icon, Modal, zl, fdt, toast, useData, Loading, ErrorBox } from '../lib.js';

const LEVELS = [['eco', 'Эконом'], ['mid', 'Средний'], ['oe', 'OE']];
const URG = [['today', 'Сегодня'], ['tomorrow', 'Завтра'], ['any', 'Не важно']];
export const AI_STATUS = { draft: 'Черновик ИИ', accepted: 'Принято', ordered: 'Заказано', delivered: 'Доставлено', checked: 'Проверено', installed: 'Установлено', returned: 'Возврат' };

/** Данные подбора для заказа (позиции ИИ по id позиции заказа) */
export function useAi(o, on) {
  const [d, setD] = useState(null);
  const load = async () => { if (on && o?.id) try { setD(await api(`ai-parts/orders/${o.id}`)); } catch { setD(null); } };
  useEffect(() => { load(); }, [o?.id, on, (o?.items || []).map((i) => `${i.id}:${i.code}:${i.price}`).join()]);
  const byItem = Object.fromEntries((d?.lines || []).map((l) => [l.order_item_id, l]));
  return { d, byItem, load };
}

export function AiButton({ ai, onClick }) {
  const again = ai.d?.jobs?.some((j) => j.status === 'done');
  return html`<button class="btn sm ai-btn" onClick=${onClick}><${Icon} n="spark" />${again ? 'Подобрать ещё (ИИ)' : 'Подбор запчастей (ИИ)'}</button>`;
}

/** Баннер над товарами: сколько добавил ИИ и сколько нужно проверить */
export function AiBanner({ ai, reload }) {
  const drafts = (ai.d?.lines || []).filter((l) => l.status === 'draft');
  if (!drafts.length) return null;
  const check = drafts.filter((l) => l.confidence === 'check').length;
  const lastJob = ai.d.jobs.find((j) => drafts.some((l) => l.job_id === j.id));
  const acceptAll = async () => { await act(() => api(`ai-parts/orders/${ai.d.lines[0].order_id}/accept-all`, { method: 'POST' }), 'Позиции приняты'); ai.load(); };
  const undo = async () => { if (!lastJob) return; await act(() => api(`ai-parts/jobs/${lastJob.id}/undo`, { method: 'POST' }), 'Подбор отменён'); reload(); };
  return html`<div class="ai-banner"><${Icon} n="spark" />
    <div class="grow"><b>ИИ добавил ${drafts.length} ${plural(drafts.length, 'позицию', 'позиции', 'позиций')}</b>${check ? html`, <span class="ai-warn">${check} ${plural(check, 'требует', 'требуют', 'требуют')} проверки</span>` : ''}
      <div class="sub">Проверьте варианты и нажмите «Принять все». Заказ у поставщика ассистент не делает.</div></div>
    <button class="btn sm primary" onClick=${acceptAll}><${Icon} n="check" />Принять все</button>
    <button class="btn sm" onClick=${undo}><${Icon} n="x" />Отменить подбор</button></div>`;
}

/** Под названием позиции: OE, вариант, поставщик и срок, «Проверьте» */
export function AiItemInfo({ line, reload, ai }) {
  if (!line) return null;
  const setSt0 = async (st) => { await act(() => api(`ai-parts/lines/${line.id}`, { body: { status: st } })); ai.load(); };
  if (line.kind === 'labor') return html`<div class="ai-info"><div class="ai-tags"><span class=${'ai-tag ' + (line.status === 'draft' ? 'draft' : 'ok')}><${Icon} n="spark" />${AI_STATUS[line.status] || line.status}</span>
    <span class="sub">работа · ~${String(line.hours).replace('.', ',')} h</span>${line.confidence === 'check' && html`<span class="ai-tag chk" title=${line.reason || ''}>Проверьте часы</span>`}</div></div>`;
  const v = line.variants[line.chosen] || {};
  const margin = (x) => (x.buyGross > 0 ? Math.round((x.sellGross / x.buyGross - 1) * 100) : null);
  const pick = async (k) => { if (k === line.chosen) return; await act(() => api(`ai-parts/lines/${line.id}`, { body: { variant: k } })); reload(); };
  const setSt = setSt0;
  return html`<div class="ai-info">
    <div class="ai-tags"><span class=${'ai-tag ' + (line.status === 'draft' ? 'draft' : 'ok')}><${Icon} n="spark" />${AI_STATUS[line.status] || line.status}</span>
      ${line.confidence === 'check' && html`<span class="ai-tag chk" title=${line.reason || ''}>Проверьте</span>`}
      ${line.oe?.length ? html`<span class="sub">OE ${line.oe.map((x) => x.number).join(', ')} · ${line.oe[0].source}</span>` : html`<span class="sub">без OE</span>`}</div>
    ${line.confidence === 'check' && line.reason && html`<div class="ai-reason">${line.reason}</div>`}
    <div class="ai-variants">${LEVELS.filter(([k]) => line.variants[k]).map(([k, label]) => {
      const x = line.variants[k];
      return html`<button class=${'ai-var' + (k === line.chosen ? ' on' : '')} onClick=${() => pick(k)} title=${`${x.supplier === 'Allegro' ? x.title + ' · ' : ''}${x.brand} ${x.article} · закупка ${zl(x.buyGross || x.priceNet)} брутто${margin(x) != null ? ' · маржа ' + margin(x) + '%' : ''} · ${x.supplier}${x.supplier === 'Inter Cars' ? ' · в наличии ' + x.availability : ''}`}>
        <span>${label}${x.supplier === 'Allegro' ? ' · Allegro' : ''}</span><b>${x.brand || 'без марки'}</b><span>${zl(x.sellGross)}</span></button>`;
    })}</div>
    <div class="sub">${v.brand} ${v.article} · ${v.supplier === 'Allegro' ? html`<a href=${v.url} target="_blank" rel="noopener">Allegro — открыть предложение</a>` : v.supplier === 'ProfiAuto' && v.url ? html`<a href=${v.url} target="_blank" rel="noopener">ProfiAuto — открыть товар</a>` : v.supplier || 'не найдено'}${v.delivery ? ', ' + v.delivery : ''}${v.supplier === 'Inter Cars' ? ` · в наличии ${v.availability}` : ''}${margin(v) != null ? ` · маржа ${margin(v)}%` : ''}${line.qty_note ? ' · ' + line.qty_note : ''}
      · <select class="ai-st" value=${line.status} onChange=${(e) => setSt(e.target.value)}>${Object.entries(AI_STATUS).map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></div>
  </div>`;
}

/** Форма подбора */
export function AiModal({ o, ai, onClose, reload }) {
  const d = ai.d;
  const car = d?.car;
  const [f, setF] = useState({ text: '', level: d?.defaultLevel || 'mid', urgency: 'any', comment: '', paste: '' });
  const [job, setJob] = useState(null);
  const [showPaste, setShowPaste] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const noVin = !car?.vin || car.vin.length !== 17;

  // подбор ждёт страницу: аналоги по OE ищем в Inter Cars e-Catalog через расширение (один раз на подбор)
  // …а то, чего нет в наличии в Inter Cars, — на Allegro (тоже через расширение, только чтение)
  const [ecatFor, setEcatFor] = useState(null);
  const [ecatMsg, setEcatMsg] = useState('');
  useEffect(() => {
    if (!job || job.status !== 'waiting') return;
    const kind = ['allegro', 'profiauto'].includes(job.result?.wait) ? job.result.wait : 'ecat';
    const payload = kind === 'ecat' ? job.result?.need && { oes: job.result.need } : job.result?.[kind + 'Need'] && { queries: job.result[kind + 'Need'] };
    const key = job.id + ':' + kind;
    if (!payload || ecatFor === key) return;
    setEcatFor(key);
    const reqId = Math.random().toString(36).slice(2);
    let partial = [], sent = false;
    const send = async (results, error) => {
      if (sent) return; sent = true; clearTimeout(timer); removeEventListener('message', onMsg);
      setEcatMsg(error || '');
      await api(`ai-parts/jobs/${job.id}/${kind}`, { body: { results, error } }).catch(() => {});
    };
    const onMsg = (e) => {
      const m = e.data;
      if (e.source !== window || m?.source !== 'pulsecar-ext' || m.reqId !== reqId) return;
      if (m.type === 'pl24-progress') { setEcatMsg(m.text); if (Array.isArray(m.partial)) partial = m.partial; }
      if (m.type === kind + '-result') send(m.results || partial, m.ok ? null : m.error);
    };
    // расширение не ответило вовремя — отдаём то, что успело найти, подбор идёт дальше
    const timer = setTimeout(() => send(partial, ({ allegro: 'Allegro', profiauto: 'ProfiAuto', ecat: 'e-Catalog' })[kind] + ' ответил не полностью — взято то, что успели найти'), kind === 'ecat' ? 140_000 : 225_000);
    addEventListener('message', onMsg);
    window.postMessage({ source: 'pulsecar-crm', type: kind, reqId, job: payload }, location.origin);
  }, [job]);

  useEffect(() => {
    if (!job || ['done', 'error', 'cancelled'].includes(job.status)) return;
    const t = setTimeout(async () => {
      try {
        const j = await api('ai-parts/jobs/' + job.id);
        setJob(j);
        if (j.status === 'done') { reload(); toast(`ИИ добавил ${j.added} ${plural(j.added, 'позицию', 'позиции', 'позиций')}`); }
      } catch {}
    }, 700);
    return () => clearTimeout(t);
  }, [job]);

  // partslink24 через расширение Pulsecar (вкладка менеджера, его вход, по одной детали с паузами)
  const extV = document.documentElement.dataset.pulsecarExt || '';
  const extN = extV ? extV.split('.').map(Number).reduce((a, x, i) => a + x * [10000, 100, 1][i], 0) : 0;
  const extOk = extN >= 10500, extAllegro = extN >= 10600, extPa = extN >= 10700;
  const [pl, setPl] = useState(null);
  const runPl24 = async () => {
    if (!f.text.trim()) return toast('Сначала напишите, что нужно', 'error');
    setPl({ busy: true, text: 'Готовлю список деталей для поиска…' });
    let job;
    try { job = await api(`ai-parts/orders/${o.id}/pl24-terms`, { body: { text: f.text } }); } catch (e) { setPl({ error: e.message }); return; }
    const reqId = Math.random().toString(36).slice(2);
    const onMsg = (e) => {
      const m = e.data;
      if (e.source !== window || m?.source !== 'pulsecar-ext' || m.reqId !== reqId) return;
      if (m.type === 'pl24-progress') setPl({ busy: true, text: m.text });
      if (m.type === 'pl24-result') {
        removeEventListener('message', onMsg);
        const fmt = (x) => [x.number, x.name, x.qty && 'szt. ' + x.qty, x.note, x.model, x.group].filter(Boolean).join(' | ');
        const lines = (m.results || m.rows || []).flatMap((r) => [`# ${r.q}`, ...(r.rows || []).map(fmt), ...(r.rows?.length ? [] : ['(nie znaleziono)']),
          ...(r.bom?.length ? [`## rysunek węzła (wszystkie części: uszczelki, śruby…)`, ...r.bom.map((x) => `${x.pos}. ${fmt(x)}`)] : [])]);
        if (lines.length) { setF((cur) => ({ ...cur, paste: [cur.paste, lines.join('\n')].filter(Boolean).join('\n') })); setShowPaste(true); }
        setPl(m.ok ? { done: true, text: `partslink24: найдено по ${(m.results || []).filter((r) => r.rows?.length).length} из ${(m.results || []).length} деталей${(m.results || []).some((r) => r.bom?.length) ? ', со списками деталей узлов' : ''}` } : { error: m.error, text: lines.length ? 'часть номеров получена' : '' });
      }
    };
    addEventListener('message', onMsg);
    window.postMessage({ source: 'pulsecar-crm', type: 'pl24', reqId, job: { vin: job.vin, terms: job.terms } }, location.origin);
  };

  const start = async () => {
    const r = await act(() => api(`ai-parts/orders/${o.id}/jobs`, { body: { ...f, ext: extOk, extAllegro, extV: extN } }));
    if (r) setJob({ id: r.id, status: 'queued', steps: d.steps.map((s) => ({ key: s.key, state: 'wait' })) });
  };
  const label = Object.fromEntries((d?.steps || []).map((s) => [s.key, s.label]));
  const running = job && !['done', 'error', 'cancelled'].includes(job.status);

  return html`<${Modal} wide title=${'Подбор запчастей (ИИ) — ' + o.number} onClose=${onClose}
    foot=${html`${job?.status === 'done' ? html`<button class="btn primary" onClick=${onClose}>Готово</button>` : html`
      <span class="sub grow">${running ? 'Можно закрыть окно — позиции появятся в выцене сами.' : ''}</span>
      <button class="btn" onClick=${onClose}>${running ? 'Закрыть' : 'Отмена'}</button>
      <button class="btn primary" disabled=${noVin || !f.text.trim() || running} title=${noVin ? 'Добавьте VIN в выцену' : ''} onClick=${start}><${Icon} n="spark" />Подобрать и добавить в выцену</button>`}`}>
    ${d?.mock && html`<div class="ai-mock">Предпросмотр: подбор идёт на демо-данных (без Claude и Inter Cars), номера деталей условные.</div>`}
    <div class="ai-car">
      ${[['Марка', car?.make], ['Модель', car?.model], ['VIN', car?.vin], ['Двигатель', [car?.engine, car?.capacity && car.capacity + ' см³', car?.power_kw && car.power_kw + ' kW', car?.fuel].filter(Boolean).join(' · ')], ['Год', car?.year && String(car.year).replace(/\.0$/, '')], ['Пробег', car?.mileage && car.mileage.toLocaleString('pl-PL') + ' km']]
        .map(([k, v]) => html`<div><span class="sub">${k}</span><b>${v || '—'}</b></div>`)}
    </div>
    ${noVin && html`<div class="card err small">Добавьте VIN в выцену — без него подбор недоступен.</div>`}
    ${!job ? html`
      <label class="f">Что нужно<textarea rows="4" value=${f.text} onInput=${set('text')} placeholder="напр. замена комплекта ГРМ + водяной насос + масло, масляный фильтр + замена свечей"></textarea></label>
      <div class="grid2">
        <div class="f">Уровень<div class="seg">${LEVELS.map(([k, t]) => html`<button class=${f.level === k ? 'on' : ''} onClick=${() => setF({ ...f, level: k })}>${t}</button>`)}</div></div>
        <div class="f">Срочность<div class="seg">${URG.map(([k, t]) => html`<button class=${f.urgency === k ? 'on' : ''} onClick=${() => setF({ ...f, urgency: k })}>${t}</button>`)}</div></div>
      </div>
      <label class="f">Комментарий для ассистента <span class="sub">(необязательно)</span><input value=${f.comment} onInput=${set('comment')} placeholder="напр. масло только Castrol" /></label>
      <div class="ai-pl24">
        <div class="grow"><b>OE-номера из partslink24</b> <span class="sub">(необязательно)</span>
          <div class="sub">Работает с вашим аккаунтом partslink24 через расширение Pulsecar — или вставьте строки вручную.</div></div>
        <div class="row-btns" style="margin:0">${extOk
          ? html`<button class="btn sm primary" disabled=${pl?.busy || noVin} onClick=${runPl24}><${Icon} n="search" />Найти в partslink24</button>`
          : ''}
          ${!extPa && html`<a class="btn sm" href="/pulsecar-extension.zip" title="Расширение Pulsecar 1.7 для Chrome: partslink24, e-Catalog Inter Cars, ProfiAuto и Allegro — поиск того, чего нет в наличии. Распакуйте и загрузите в chrome://extensions (режим разработчика)">Скачать расширение 1.7</a>`}
          <button class="btn sm" onClick=${() => setShowPaste(!showPaste)}><${Icon} n="list" />Вставить список</button></div>
      </div>
      ${pl && html`<div class=${'ai-pl24-st' + (pl.error ? ' err' : '')}>${pl.busy ? html`<span class="ai-dot run-dot"></span>` : ''}${pl.error ? pl.error + (pl.text ? ' — ' + pl.text : '') : pl.text}</div>`}
      ${showPaste && html`<textarea rows="4" value=${f.paste} onInput=${set('paste')} placeholder="Скопируйте строки таблицы деталей из partslink24 и вставьте сюда"></textarea>`}
    ` : html`
      <div class="ai-req"><span class="sub">Запрос:</span> ${f.text}</div>
      <ol class="ai-steps">${(job.steps || []).map((s) => html`<li class=${s.state}>
        <span class="ai-dot">${s.state === 'ok' ? html`<${Icon} n="check" />` : s.state === 'error' ? html`<${Icon} n="x" />` : ''}</span>
        <div><b>${label[s.key]}</b>${s.info && html`<div class="sub">${s.info}</div>`}</div></li>`)}</ol>
      ${ecatMsg && html`<div class="ai-pl24-st"><span class="ai-dot run-dot"></span>${ecatMsg}</div>`}
      ${job.status === 'error' && html`<div class="card err small">${job.error || 'Подбор не удался'} — позиции не добавлены.</div>`}
    `}
    ${!!d?.jobs?.length && html`<details class="ai-hist"><summary>История подборов (${d.jobs.length})</summary>
      <table class="tbl"><tbody>${d.jobs.map((j) => html`<tr><td class="nowrap">${fdt(j.created_at)}</td><td>${j.created_by || ''}</td><td>${j.request.text}</td>
        <td class="r nowrap">${j.status === 'done' ? `${j.added} поз.${j.to_check ? `, проверить ${j.to_check}` : ''}` : j.status === 'error' ? 'ошибка' : j.status === 'cancelled' ? 'отменён' : 'в работе'}</td></tr>`)}</tbody></table></details>`}
  </${Modal}>`;
}

const plural = (n, one, few, many) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; };

/** Настройки → ИИ-запчастист: включение, лимит, модель, наценка (если Inter Cars не дал цену), KPI за 30 дней */
export function AiSettings() {
  const { data, error, reload } = useData('ai-parts/settings');
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF({ enabled: data.enabled, limit: data.limit, model: data.model, markup: data.markup, minMargin: data.minMargin }); }, [data]);
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data || !f) return html`<${Loading} />`;
  const save = async () => { await act(() => api('ai-parts/settings', { method: 'PUT', body: f }), 'Сохранено'); reload(); setTimeout(() => location.reload(), 400); };
  const k = data.kpi;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  return html`<div class="card" style="max-width:760px">
      <h2 style="margin-top:0">ИИ-запчастист</h2>
      <p class="sub">Подбирает запчасти и работы по тексту менеджера под авто из выцены: OE-номер → аналоги в наличии в Inter Cars (или на Allegro) → варианты Эконом / Средний / OE по цене продажи клиенту, плюс строки работ с нормой часов. Добавляет позиции черновиком в выцену. <b>Ничего не заказывает и ничего не отправляет клиенту.</b></p>
      <div class="ai-ready">
        <span class=${data.ready.claude ? 'ok' : 'bad'}>${data.ready.claude ? '✓' : '✗'} Claude API (ключ AI-ассистента)</span>
        <span class=${data.ready.intercars ? 'ok' : 'bad'}>${data.ready.intercars ? '✓' : '✗'} Inter Cars API</span>
      </div>
      <label class="check" style="margin:12px 0"><input type="checkbox" checked=${f.enabled} onChange=${(e) => setF({ ...f, enabled: e.target.checked })} /> Включить модуль в этом сервисе</label>
      <div class="grid2">
        <label class="f">Лимит подборов в месяц (0 — без лимита)<input type="number" min="0" value=${f.limit} onInput=${(e) => setF({ ...f, limit: e.target.value })} /></label>
        <label class="f">Наценка, если Inter Cars не дал рекомендуемую цену, %<input type="number" min="0" value=${f.markup} onInput=${(e) => setF({ ...f, markup: e.target.value })} /></label>
        <label class="f">Минимальная маржа на запчасти, % от закупки брутто<input type="number" min="0" value=${f.minMargin} onInput=${(e) => setF({ ...f, minMargin: e.target.value })} /></label>
      </div>
      <p class="sub">Inter Cars: берём рекомендуемую цену продажи IC; если она даёт меньше минимальной маржи — цена поднимается до закупки брутто + минимум. В подбор попадают только детали, которые есть в наличии. Чего нет в Inter Cars — ищется в ProfiAuto, затем на Allegro через расширение (наценка 50% до 100 zł, 45% до 250 zł, 40% до 500 zł, 35% до 1000 zł, дороже — 30%), ссылка на предложение пишется в пометку позиции и во «Внутреннее описание» выцены.</p>
      <label class="f" style="margin-top:10px">Модель Claude<input value=${f.model} onInput=${(e) => setF({ ...f, model: e.target.value })} placeholder=${data.defaultModel} /></label>
      <div style="margin-top:14px"><button class="btn primary" onClick=${save}>Сохранить</button></div>
    </div>
    <div class="card" style="max-width:760px">
      <h2 style="margin-top:0">Статистика за 30 дней</h2>
      <div class="ai-kpi">
        <div><b>${k.jobs}</b><span>подборов (ошибок ${k.errors})</span></div>
        <div><b>${k.avgSec != null ? (k.avgSec >= 60 ? Math.round(k.avgSec / 6) / 10 + ' мин' : k.avgSec + ' с') : '—'}</b><span>от запроса до позиций</span></div>
        <div><b>${pct(k.accepted - k.edited, k.accepted)}</b><span>принято без правок</span></div>
        <div><b>${k.removed}</b><span>позиций удалено менеджером</span></div>
        <div><b>${k.returned}</b><span>возвратов</span></div>
        <div><b>${data.month.jobs}${data.limit ? ' / ' + data.limit : ''}</b><span>подборов в этом месяце</span></div>
      </div>
      <p class="sub">Расход Claude в этом месяце: ${Math.round(data.month.tokensIn / 1000)}k входящих и ${Math.round(data.month.tokensOut / 1000)}k исходящих токенов.</p>
    </div>
    <${AiTrain} trained=${data.trained} />
    <${AiRules} />`;
}

/** Настройки → ИИ-запчастист → Правила подбора */
export function AiRules() {
  const { data, error, reload } = useData('ai-parts/rules');
  const [r, setR] = useState(null);
  const [sug, setSug] = useState(null);
  useEffect(() => {
    if (!data) return;
    setR({ notes: data.notes, brands: data.brands.map((b) => ({ ...b })), black: data.blacklist.map((b) => b.value).join(', '), kits: data.kits.map((k) => ({ ...k })) });
  }, [data]);
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data || !r) return html`<${Loading} />`;
  const G = data.groups;
  const upd = (k, i, patch) => setR({ ...r, [k]: r[k].map((x, n) => (n === i ? { ...x, ...patch } : x)) });
  const del = (k, i) => setR({ ...r, [k]: r[k].filter((_, n) => n !== i) });
  const save = async () => {
    await act(() => api('ai-parts/rules', { method: 'PUT', body: { notes: r.notes, brands: r.brands, kits: r.kits,
      blacklist: r.black.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).map((value) => ({ value })) } }), 'Правила сохранены');
    reload();
  };
  const suggest = async () => setSug((await act(() => api('ai-parts/rules/suggest'))).brands);
  const addBrand = (level, brand) => {
    const i = r.brands.findIndex((b) => b.level === level && !b.group_key);
    if (i >= 0) { const cur = r.brands[i].value.split(',').map((x) => x.trim()).filter(Boolean); if (!cur.includes(brand)) upd('brands', i, { value: [...cur, brand].join(', ') }); }
    else setR({ ...r, brands: [...r.brands, { level, group_key: '', value: brand }] });
  };
  return html`<div class="card" style="max-width:980px">
    <h2 style="margin-top:0">Правила подбора</h2>
    <p class="sub">Ассистент соблюдает эти правила при каждом подборе. Если для уровня указаны бренды и они есть в Inter Cars — вариант берётся из них, иначе — по цене продажи (Эконом — самый дешёвый, Средний — середина).</p>

    <label class="f">Указания ассистенту (как вы работаете)<textarea rows="3" value=${r.notes} onInput=${(e) => setR({ ...r, notes: e.target.value })}
      placeholder="напр. масло ставим только Castrol или Mobil; на ГРМ всегда комплект с помпой; колодки не дешевле TRW"></textarea></label>

    <h3 class="ai-h3">Бренды по уровням</h3>
    <table class="tbl ai-rules"><thead><tr><th style="width:130px">Уровень</th><th style="width:220px">Детали</th><th>Бренды (через запятую, по порядку)</th><th style="width:40px"></th></tr></thead><tbody>
      ${r.brands.map((b, i) => html`<tr class=${b.draft ? 'faint' : ''}>
        <td><select value=${b.level} onChange=${(e) => upd('brands', i, { level: e.target.value })}>${LEVELS.map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></td>
        <td><select value=${b.group_key || ''} onChange=${(e) => upd('brands', i, { group_key: e.target.value })}><option value="">Все детали</option>${G.map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></td>
        <td><input value=${b.value} onInput=${(e) => upd('brands', i, { value: e.target.value, draft: 0 })} placeholder="напр. Febi, Maxgear, Hepu" /></td>
        <td><button class="icon-btn" title="Удалить" onClick=${() => del('brands', i)}><${Icon} n="trash" /></button></td></tr>`)}
    </tbody></table>
    <div class="row-btns"><button class="btn sm" onClick=${() => setR({ ...r, brands: [...r.brands, { level: 'mid', group_key: '', value: '' }] })}><${Icon} n="plus" />Добавить правило</button>
      <button class="btn sm" onClick=${suggest}><${Icon} n="history" />Подсказать из истории выцен</button></div>
    ${sug && html`<div class="ai-sug"><div class="sub">Бренды, которые вы ставили (по названиям позиций): сколько раз и средняя цена. Нажмите уровень, чтобы добавить.</div>
      ${sug.length ? sug.map((s) => html`<span class="ai-sug-b"><b>${s.brand}</b> <span class="sub">${s.count}× · ~${zl(s.avgPrice)}</span>
        ${LEVELS.filter(([k]) => k !== 'oe').map(([k, t]) => html`<button class="btn xs" onClick=${() => addBrand(k, s.brand)}>${t}</button>`)}</span>`) : html`<span class="sub">В истории не найдено известных брендов.</span>`}</div>`}

    <h3 class="ai-h3">Не использовать бренды</h3>
    <input value=${r.black} onInput=${(e) => setR({ ...r, black: e.target.value })} placeholder="через запятую, напр. Stark, Ridex" style="width:100%" />

    <h3 class="ai-h3">Стандартные комплекты</h3>
    <p class="sub" style="margin-top:0">Как раскрывать короткие запросы. Например «ТО» → масло, масляный, воздушный и салонный фильтры, шайба сливной пробки.</p>
    ${r.kits.map((k, i) => html`<div class=${'ai-kit' + (k.draft ? ' draft' : '')}>
      <div class="grid3"><label class="f">Название<input value=${k.name} onInput=${(e) => upd('kits', i, { name: e.target.value })} placeholder="ТО" /></label>
        <label class="f">Другие названия<input value=${k.aliases || ''} onInput=${(e) => upd('kits', i, { aliases: e.target.value })} placeholder="przegląd, сервис, замена масла" /></label>
        <label class="f">Двигатель<select value=${k.fuel || ''} onChange=${(e) => upd('kits', i, { fuel: e.target.value })}><option value="">любой</option><option value="petrol">бензин</option><option value="diesel">дизель</option></select></label></div>
      <label class="f">Состав<textarea rows="2" value=${k.items || ''} onInput=${(e) => upd('kits', i, { items: e.target.value })} placeholder="olej silnikowy, filtr oleju, filtr powietrza, filtr kabinowy, podkładka korka spustowego"></textarea></label>
      <div class="row-btns" style="margin:0"><label class="check"><input type="checkbox" checked=${!k.draft} onChange=${(e) => upd('kits', i, { draft: e.target.checked ? 0 : 1 })} /> Использовать при подборе${k.source === 'history' ? ' (из истории)' : ''}</label>
      <button class="btn sm danger" onClick=${() => del('kits', i)}><${Icon} n="trash" />Удалить комплект</button></div></div>`)}
    <div class="row-btns"><button class="btn sm" onClick=${() => setR({ ...r, kits: [...r.kits, { name: '', aliases: '', fuel: '', items: '' }] })}><${Icon} n="plus" />Добавить комплект</button>
      <button class="btn sm" onClick=${async () => { const d = await act(() => api('ai-parts/kit-drafts')); if (!d) return; const have = new Set(r.kits.map((k) => k.name.toLowerCase()));
        const add = d.kits.filter((k) => !have.has(k.name.toLowerCase())).map((k) => ({ name: k.name, aliases: '', fuel: '', items: k.items, draft: 1, source: 'history' }));
        setR({ ...r, kits: [...r.kits, ...add] }); toast(add.length ? `Добавлено черновиков: ${add.length} — проверьте и отметьте «Использовать»` : 'Новых комплектов в истории не найдено'); }}><${Icon} n="history" />Черновики из истории выцен</button></div>

    <div style="margin-top:16px"><button class="btn primary" onClick=${save}>Сохранить правила</button></div>
  </div>`;
}

/** Обучение на выценах сервиса */
function AiTrain({ trained }) {
  const [st, setSt] = useState(trained);
  const [busy, setBusy] = useState(false);
  const train = async () => { setBusy(true); const r = await act(() => api('ai-parts/train', { method: 'POST' }), 'Обучение завершено'); if (r) setSt(r); setBusy(false); };
  return html`<div class="card" style="max-width:760px">
    <h2 style="margin-top:0">Обучение на ваших выценах</h2>
    <p class="sub">Ассистент изучает прошлые выцены и заказы сервиса: какие работы вы делали, какие детали меняли вместе с ними (прокладки и уплотнения узлов, которые разбираются), сколько часов занимала работа. Перед каждым подбором он опирается на похожие прошлые работы. Данные клиентов не используются. Знания обновляются автоматически раз в сутки.</p>
    ${st ? html`<div class="ai-kpi">
        <div><b>${st.indexed}</b><span>выцен и заказов изучено</span></div>
        <div><b>${st.jobs}</b><span>видов работ с типовыми деталями</span></div>
        <div><b>${st.hours}</b><span>работ с нормой часов</span></div></div>
      <p class="sub">Последнее обучение: ${fdt(st.at.replace('T', ' ').slice(0, 16))}</p>` : html`<p class="sub">Ещё не обучался.</p>`}
    <button class="btn primary" disabled=${busy} onClick=${train}><${Icon} n="spark" />${busy ? 'Обучаю…' : 'Обучить сейчас'}</button>
  </div>`;
}
