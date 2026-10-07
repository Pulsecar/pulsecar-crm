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
  const v = line.variants[line.chosen] || {};
  const pick = async (k) => { if (k === line.chosen) return; await act(() => api(`ai-parts/lines/${line.id}`, { body: { variant: k } })); reload(); };
  const setSt = async (st) => { await act(() => api(`ai-parts/lines/${line.id}`, { body: { status: st } })); ai.load(); };
  return html`<div class="ai-info">
    <div class="ai-tags"><span class=${'ai-tag ' + (line.status === 'draft' ? 'draft' : 'ok')}><${Icon} n="spark" />${AI_STATUS[line.status] || line.status}</span>
      ${line.confidence === 'check' && html`<span class="ai-tag chk" title=${line.reason || ''}>Проверьте</span>`}
      ${line.oe?.length ? html`<span class="sub">OE ${line.oe.map((x) => x.number).join(', ')} · ${line.oe[0].source}</span>` : html`<span class="sub">без OE</span>`}</div>
    ${line.confidence === 'check' && line.reason && html`<div class="ai-reason">${line.reason}</div>`}
    <div class="ai-variants">${LEVELS.filter(([k]) => line.variants[k]).map(([k, label]) => {
      const x = line.variants[k];
      return html`<button class=${'ai-var' + (k === line.chosen ? ' on' : '')} onClick=${() => pick(k)} title=${`${x.brand} ${x.article} · закупка ${zl(x.priceNet)} нетто · ${x.availability > 0 ? 'в наличии ' + x.availability : 'нет в наличии'}`}>
        <span>${label}</span><b>${x.brand}</b><span>${zl(x.sellGross)}</span></button>`;
    })}</div>
    <div class="sub">${v.brand} ${v.article} · ${v.supplier}${v.delivery ? ', ' + v.delivery : ''}${v.availability > 0 ? ` · в наличии ${v.availability}` : ' · нет в наличии'}${line.qty_note ? ' · ' + line.qty_note : ''}
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

  const start = async () => {
    const r = await act(() => api(`ai-parts/orders/${o.id}/jobs`, { body: f }));
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
        <button class="btn sm" onClick=${() => setShowPaste(!showPaste)}><${Icon} n="list" />Вставить список</button>
      </div>
      ${showPaste && html`<textarea rows="4" value=${f.paste} onInput=${set('paste')} placeholder="Скопируйте строки таблицы деталей из partslink24 и вставьте сюда"></textarea>`}
    ` : html`
      <div class="ai-req"><span class="sub">Запрос:</span> ${f.text}</div>
      <ol class="ai-steps">${(job.steps || []).map((s) => html`<li class=${s.state}>
        <span class="ai-dot">${s.state === 'ok' ? html`<${Icon} n="check" />` : s.state === 'error' ? html`<${Icon} n="x" />` : ''}</span>
        <div><b>${label[s.key]}</b>${s.info && html`<div class="sub">${s.info}</div>`}</div></li>`)}</ol>
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
  useEffect(() => { if (data) setF({ enabled: data.enabled, limit: data.limit, model: data.model, markup: data.markup }); }, [data]);
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data || !f) return html`<${Loading} />`;
  const save = async () => { await act(() => api('ai-parts/settings', { method: 'PUT', body: f }), 'Сохранено'); reload(); setTimeout(() => location.reload(), 400); };
  const k = data.kpi;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  return html`<div class="card" style="max-width:760px">
      <h2 style="margin-top:0">ИИ-запчастист</h2>
      <p class="sub">Подбирает запчасти по тексту менеджера под авто из выцены: OE-номер → аналоги в Inter Cars → варианты Эконом / Средний / OE по цене продажи клиенту (рекомендуемая цена Inter Cars). Добавляет позиции черновиком в выцену. <b>Ничего не заказывает и ничего не отправляет клиенту.</b></p>
      <div class="ai-ready">
        <span class=${data.ready.claude ? 'ok' : 'bad'}>${data.ready.claude ? '✓' : '✗'} Claude API (ключ AI-ассистента)</span>
        <span class=${data.ready.intercars ? 'ok' : 'bad'}>${data.ready.intercars ? '✓' : '✗'} Inter Cars API</span>
      </div>
      <label class="check" style="margin:12px 0"><input type="checkbox" checked=${f.enabled} onChange=${(e) => setF({ ...f, enabled: e.target.checked })} /> Включить модуль в этом сервисе</label>
      <div class="grid2">
        <label class="f">Лимит подборов в месяц (0 — без лимита)<input type="number" min="0" value=${f.limit} onInput=${(e) => setF({ ...f, limit: e.target.value })} /></label>
        <label class="f">Наценка, если Inter Cars не дал рекомендуемую цену, %<input type="number" min="0" value=${f.markup} onInput=${(e) => setF({ ...f, markup: e.target.value })} /></label>
      </div>
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
    </div>`;
}
