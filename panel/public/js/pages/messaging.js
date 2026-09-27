// Настройки → SMS и шаблоны: шлюз, напоминания, шаблоны SMS/e-mail, электронная карта заказа, онлайн-запись
import { html, useState, useRef, useData, api, act, useApp, Loading, ErrorBox, toast } from '../lib.js';
import { SmsCounter } from './orders.js';

/** Поле шаблона с кнопками вставки [[полей]] как в Motowarsztat */
export function TplField({ label, value, onInput, fields, rows = 4, sms = true, hint }) {
  const ref = useRef(null);
  const [showF, setShowF] = useState(false);
  const insert = (k) => {
    const el = ref.current;
    const tag = `[[${k}]]`;
    const s = el?.selectionStart ?? value.length;
    const e = el?.selectionEnd ?? value.length;
    onInput(value.slice(0, s) + tag + value.slice(e));
    setTimeout(() => { el?.focus(); el?.setSelectionRange(s + tag.length, s + tag.length); }, 0);
  };
  return html`<div class="stack" style="gap:4px">
    <label class="f">${label}<textarea ref=${ref} rows=${rows} value=${value} onInput=${(e) => onInput(e.target.value)}></textarea></label>
    <div class="row" style="justify-content:space-between">${sms ? html`<${SmsCounter} text=${value.replace(/\[\[[^\]]+\]\]/g, 'xxxxxxxxxx')} />` : html`<span></span>`}
      <a href="#" class="small" onClick=${(e) => { e.preventDefault(); setShowF(!showF); }}>${showF ? 'Скрыть поля' : 'Вставить поле'}</a></div>
    ${showF && html`<div class="tpl-fields">${fields.map(([k, l]) => html`<button type="button" title=${'[[' + k + ']]'} onClick=${() => insert(k)}>${l}</button>`)}</div>`}
    ${hint && html`<div class="muted small">${hint}</div>`}
  </div>`;
}

export default function Messaging() {
  const app = useApp();
  const { data, loading, error, reload } = useData('messaging');
  const [f, setF] = useState(null);
  if (loading && !data) return html`<${Loading} />`;
  if (error) return html`<${ErrorBox} error=${error} />`;
  const v = f || data.values;
  const set = (k, val) => setF({ ...v, [k]: val });
  const on = (k) => v[k] === '1';
  const chk = (k, l) => html`<label class="check"><input type="checkbox" checked=${on(k)} onChange=${(e) => set(k, e.target.checked ? '1' : '0')} />${l}</label>`;
  const tpl = (k, l, hint, rows) => html`<${TplField} label=${l} value=${v[k] || ''} onInput=${(x) => set(k, x)} fields=${data.fields} hint=${hint} rows=${rows} />`;
  const save = async () => { await act(() => api('messaging', { method: 'PUT', body: v }), 'Сохранено'); setF(null); reload(); app.reload(); };
  const enabled = data.providers.filter((p) => p.enabled);
  return html`<div class="stack">
    <div class="card stack">
      <h2>SMS-шлюз</h2>
      ${enabled.length ? html`<label class="f" style="max-width:420px">Через что отправлять SMS<select value=${v.sms_provider} onChange=${(e) => set('sms_provider', e.target.value)}>
          <option value="">Первый включённый (${data.provider ? data.providers.find((p) => p.key === data.provider)?.title : '—'})</option>
          ${enabled.map((p) => html`<option value=${p.key}>${p.title}</option>`)}</select></label>`
        : html`<div class="muted">Шлюз не подключён: SMS пишутся только в журнал. Подключите свой телефон с SIM или SMS-сервис в <a href="#/settings/integrations">Интеграциях</a> (группа «SMS клиентам»).</div>`}
      ${chk('sms_translit', 'Заменять польские буквы (ą→a, ł→l…) — SMS вмещает 160 знаков вместо 70, как в Motowarsztat')}
    </div>

    <div class="card stack">
      <h2>Напоминание о визите</h2>
      <div class="row">${chk('sms_remind_on', 'Отправлять напоминание о записи в терминарзе')}
        <label class="f" style="width:170px">За сколько часов<input type="number" min="1" max="72" value=${v.sms_remind_hours} onInput=${(e) => set('sms_remind_hours', e.target.value)} /></label></div>
      ${tpl('sms_tpl_reminder', 'Текст напоминания', 'Дата и время берутся из записи в терминарзе.')}
    </div>

    <div class="card stack">
      <h2>Шаблоны SMS</h2>
      <div class="muted small">SMS при смене статуса настраиваются в каждом статусе: Настройки → Статусы заказов.</div>
      <div class="grid g2">
        ${tpl('sms_tpl_card', 'Ссылка на карту заказа', 'Кнопка «SMS с картой заказа» в заказе.')}
        ${tpl('sms_tpl_quote', 'Ссылка на выцену', 'Кнопка «SMS со выценой».')}
        ${tpl('sms_tpl_paylink', 'Ссылка на онлайн-оплату (Tpay)')}
        ${tpl('sms_tpl_booking', 'Ответ на онлайн-запись с сайта', 'Пусто — не отправлять.')}
        ${tpl('sms_tpl_code', 'Код подтверждения карты заказа', 'Поле [[kod]] — сам код.', 2)}
        <div class="stack">${tpl('sms_tpl_review', 'Просьба об отзыве (отдельная)')}
          ${chk('sms_review_delayed', 'Отправлять через 2 часа после завершения заказа (если отзыв не просится в SMS статуса «Завершён»)')}
          <label class="f">Ссылка на отзыв Google — поле [[link.opinia]]<input value=${v.review_url} onInput=${(e) => set('review_url', e.target.value)} /></label></div>
      </div>
    </div>

    <div class="card stack">
      <h2>Электронная карта заказа</h2>
      <div class="muted small">Протокол приёма, kosztorys, протокол выдачи, способы подписи, фото и тексты карты настраиваются в <a href="#/settings/params">Настройки → Параметры → Электронная карта</a>.</div>
    </div>

    <div class="card stack">
      <h2>Шаблоны e-mail</h2>
      <div class="grid g2">
        ${[['order', 'Карта заказа'], ['quote', 'Выцена'], ['invoice', 'Фактура'], ['receipt', 'Чек (paragon)'], ['storage', 'Документ хранения']].map(([k, l]) => html`<div class="stack" style="gap:4px">
          <label class="f">${l}: тема<input value=${v[`mail_${k}_subject`]} onInput=${(e) => set(`mail_${k}_subject`, e.target.value)} /></label>
          <${TplField} label="Текст" value=${v[`mail_${k}_body`] || ''} onInput=${(x) => set(`mail_${k}_body`, x)} fields=${data.fields} sms=${false} rows=${4} /></div>`)}
      </div>
    </div>

    <div class="card stack">
      <h2>Онлайн-запись для сайта</h2>
      ${chk('booking_widget', 'Включить форму записи')}
      ${on('booking_widget') && html`
        <div class="muted small">Заявки падают в Терминарз → «Не распределено», команде уходит уведомление в Telegram.</div>
        <label class="f">Прямая ссылка (Instagram, Google, SMS)<div class="row"><pre class="code grow">${data.widget.url}</pre><button class="btn sm" onClick=${() => navigator.clipboard?.writeText(data.widget.url).then(() => toast('Скопировано'))}>Копировать</button></div></label>
        <label class="f">Код для вставки на pulsecar.pl<div class="row"><pre class="code grow">${data.widget.script}</pre><button class="btn sm" onClick=${() => navigator.clipboard?.writeText(data.widget.script).then(() => toast('Скопировано'))}>Копировать</button></div></label>
        <label class="f" style="width:200px">Цвет кнопки<input type="color" value=${v.booking_color || '#1BF372'} onInput=${(e) => set('booking_color', e.target.value)} /></label>
        <a class="btn ghost sm" style="align-self:flex-start" href=${data.widget.url} target="_blank" rel="noopener">Открыть форму</a>`}
    </div>

    <div class="row" style="position:sticky;bottom:0;padding:10px 0;background:var(--bg)"><button class="btn primary lg" disabled=${!f} onClick=${save}>Сохранить</button>${f && html`<span class="muted small">Есть несохранённые изменения</span>`}</div>
  </div>`;
}
