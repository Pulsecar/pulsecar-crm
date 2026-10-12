import { html, useState, useData, api, act, useApp, Loading, ErrorBox, Icon, fdt } from '../lib.js';

// SMS-рассылки: сезонные акции только тем, кто дал согласие (подписчики напоминаний с сайта и клиенты
// с отметкой «согласие на маркетинг»). Ссылку для отписки CRM добавляет в конец каждой SMS сама.
const TEMPLATES = [
  { title: 'Зима: шины + аккумулятор', text: 'Pulsecar: {imie}, zima tuż-tuż! Wymiana opon na zimowe i sprawdzenie akumulatora przed mrozami. Umów się: pulsecar.pl/pl/booking lub 571 058 591.' },
  { title: 'Весна: летние шины', text: 'Pulsecar: {imie}, czas na opony letnie. Umów wymianę bez czekania: pulsecar.pl/pl/booking lub 571 058 591.' },
  { title: 'Весна: кондиционер', text: 'Pulsecar: {imie}, przed upałami sprawdź klimatyzację — serwis i nabicie klimatyzacji. Umów się: pulsecar.pl/pl/booking lub 571 058 591.' },
  { title: 'Перед отпуском: проверка авто', text: 'Pulsecar: {imie}, jedziesz na urlop? Sprawdzimy hamulce, płyny, opony i klimatyzację przed trasą. pulsecar.pl/pl/booking lub 571 058 591.' },
];
const ST = { scheduled: ['запланирована', 'var(--info)'], sending: ['отправляется', 'var(--warn)'], sent: ['отправлена', 'var(--accent)'], cancelled: ['отменена', 'var(--muted)'] };
const PL = { 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z', 'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N', 'Ó': 'O', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z' };
function parts(text) {
  const t = text.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => PL[c]).replace(/\{imie\}/gi, 'Katarzyna') + ' STOP: https://panel.pulsecar.tech/r/0123456789abcdef';
  const gsm = /^[\x0A\x0D\x20-\x7E]*$/.test(t);
  const n = t.length;
  return { n, parts: gsm ? (n <= 160 ? 1 : Math.ceil(n / 153)) : (n <= 70 ? 1 : Math.ceil(n / 67)), gsm };
}

export default function Campaigns() {
  const app = useApp();
  const { data, error, reload } = useData('sms-campaigns');
  const [f, setF] = useState({ title: TEMPLATES[0].title, text: TEMPLATES[0].text, audience: 'both', when: 'now', at: '' });
  const [testPhone, setTestPhone] = useState('');
  if (error) return html`<${ErrorBox} error=${error} />`;
  if (!data) return html`<${Loading} />`;
  const p = parts(f.text);
  const n = data.counts[f.audience] || 0;
  const canSend = app.perms['sms.send'];
  const submit = async () => {
    if (f.when === 'later' && !f.at) return act(async () => { throw new Error('Укажите дату и время отправки'); });
    if (!confirm(`Отправить «${f.title}» — ${n} получателям (${p.parts} SMS на каждого)?`)) return;
    await act(() => api('sms-campaigns', { body: { title: f.title, text: f.text, audience: f.audience, scheduled_at: f.when === 'later' ? f.at : null } }),
      f.when === 'later' ? 'Рассылка запланирована' : 'Рассылка запущена');
    reload();
  };
  return html`<div class="page-head"><h1>SMS-рассылки</h1><span class="muted small">Только клиентам с согласием · ссылка для отписки добавляется автоматически</span></div>
    ${!app.features.sms ? html`<div class="card small" style="margin-bottom:12px;color:var(--warn)">SMS-шлюз не подключён — сообщения попадут только в журнал.</div>` : ''}
    <div class="grid g2" style="align-items:start">
      <div class="card">
        <h2>Новая рассылка</h2>
        <label class="f">Шаблон<div class="seg sel" style="flex-wrap:wrap">${TEMPLATES.map((t) => html`<button type="button" class=${f.title === t.title ? 'on' : ''} onClick=${() => setF({ ...f, title: t.title, text: t.text })}>${t.title}</button>`)}</div></label>
        <label class="f">Название (для себя)<input value=${f.title} maxlength="120" onInput=${(e) => setF({ ...f, title: e.target.value })} /></label>
        <label class="f">Текст SMS <span class="muted small">— {imie} заменится на имя клиента</span>
          <textarea rows="5" maxlength="600" value=${f.text} onInput=${(e) => setF({ ...f, text: e.target.value })}></textarea></label>
        <div class="muted small" style="margin:-4px 0 10px">${p.n} символов вместе со ссылкой отписки · ${p.parts} SMS на получателя${!p.gsm ? ' · есть символы вне латиницы — SMS короче (70 знаков)' : ''}</div>
        <label class="f">Кому<div class="seg sel" style="flex-wrap:wrap">${Object.entries(data.audiences).map(([k, l]) => html`<button type="button" class=${f.audience === k ? 'on' : ''} onClick=${() => setF({ ...f, audience: k })}>${l} · ${data.counts[k]}</button>`)}</div></label>
        <label class="f">Когда<div class="seg sel"><button type="button" class=${f.when === 'now' ? 'on' : ''} onClick=${() => setF({ ...f, when: 'now' })}>Сейчас</button>
          <button type="button" class=${f.when === 'later' ? 'on' : ''} onClick=${() => setF({ ...f, when: 'later' })}>Запланировать</button></div></label>
        ${f.when === 'later' ? html`<label class="f">Дата и время (отправка 9:00–20:00)<input type="datetime-local" value=${f.at} onInput=${(e) => setF({ ...f, at: e.target.value })} /></label>` : ''}
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">
          <input placeholder="Тестовый номер" style="max-width:180px" value=${testPhone} onInput=${(e) => setTestPhone(e.target.value)} />
          <button class="btn" disabled=${!canSend} onClick=${() => act(() => api('sms-campaigns/test', { body: { phone: testPhone, text: f.text } }), 'Тестовая SMS отправлена')}><${Icon} n="chat" />Тест себе</button>
          <button class="btn primary" style="margin-left:auto" disabled=${!canSend || !n} onClick=${submit}>${f.when === 'later' ? 'Запланировать' : 'Отправить'} · ${n}</button>
        </div>
      </div>
      <div class="card tight"><div class="row" style="padding:12px 14px"><h2 style="margin:0">Рассылки</h2></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Рассылка</th><th>Когда</th><th>Отправлено</th><th>Статус</th><th></th></tr></thead>
        <tbody>${data.rows.map((c) => html`<tr>
          <td><b>${c.title}</b><div class="sub" style="white-space:pre-wrap;max-width:320px">${c.text}</div></td>
          <td class="nowrap sub">${c.sent_at ? fdt(c.sent_at) : c.scheduled_at ? fdt(c.scheduled_at) : fdt(c.created_at)}</td>
          <td class="nowrap">${c.sent_count} / ${c.recipients || 0}${c.failed_count ? html`<div class="sub" style="color:var(--warn)">ошибок: ${c.failed_count}</div>` : ''}</td>
          <td><span class="badge" style=${`border-color:${ST[c.status][1]};color:${ST[c.status][1]}`}>${ST[c.status][0]}</span></td>
          <td>${['scheduled', 'sending'].includes(c.status) && canSend ? html`<button class="btn sm" onClick=${() => act(() => api(`sms-campaigns/${c.id}/cancel`, { body: {} }), 'Отменено').then(reload)}>Отменить</button>` : ''}</td></tr>`)}</tbody></table></div>
        ${!data.rows.length ? html`<div class="empty">Рассылок пока не было</div>` : ''}</div>
    </div>`;
}
