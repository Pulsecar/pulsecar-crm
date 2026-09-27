import { html, useState, useData, api, act, useApp, Icon, fdt, toast } from '../lib.js';

export default function Integrations() {
  const { data, reload } = useData('integrations');
  const [open, setOpen] = useState(null);
  if (!data) return html`<div class="empty">Загрузка…</div>`;
  const groups = [...new Set(data.list.map((i) => i.group))];
  const on = data.list.filter((i) => i.enabled).length;
  return html`
    <div class="muted" style="margin-bottom:12px">Подключено ${on} из ${data.list.length}. Токены хранятся на вашем сервере и в браузер не передаются — после сохранения видны только последние 4 символа.</div>
    ${groups.map((g) => html`<h3 style="margin:18px 0 8px">${g}</h3>
      <div class="grid g2">${data.list.filter((i) => i.group === g).map((it) => html`<${Card} it=${it} open=${open === it.key} onToggle=${() => setOpen(open === it.key ? null : it.key)} reload=${reload} feed=${data.calendarFeed} stations=${data.stations} />`)}</div>`)}
    ${data.log.length ? html`<h3 style="margin:22px 0 8px">Журнал интеграций</h3><div class="card tight"><table class="tbl"><tbody>${data.log.slice(0, 20).map((l) => html`<tr>
      <td class="sub nowrap">${fdt(l.created_at)}</td><td class="nowrap">${l.key}</td><td class=${l.level === 'error' ? 'neg' : ''}>${l.message}</td></tr>`)}</tbody></table></div>` : ''}`;
}

function Card({ it, open, onToggle, reload, feed, stations }) {
  const app = useApp();
  const [vals, setVals] = useState({ ...it.values });
  const [enabled, setEnabled] = useState(it.enabled);
  const [adv, setAdv] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = it.enabled ? (it.lastError ? ['Ошибка', 'var(--danger)'] : ['Подключено', 'var(--accent)']) : it.configured ? ['Выключено', 'var(--muted)'] : ['Не настроено', 'var(--faint)'];
  const save = async (en = enabled) => { await act(() => api('integrations/' + it.key, { method: 'PUT', body: { enabled: en, values: vals } }), 'Сохранено'); reload(); app.reload(); };
  const test = async () => {
    setBusy(true);
    try { await api('integrations/' + it.key, { method: 'PUT', body: { enabled, values: vals } }); const r = await api(`integrations/${it.key}/test`, { body: {} }); toast('✓ ' + r.info); reload(); }
    catch (e) { toast(e.message, 'error'); reload(); } finally { setBusy(false); }
  };
  const field = (f) => {
    const v = vals[f.k];
    const set = (x) => setVals({ ...vals, [f.k]: x });
    if (f.type === 'bool') return html`<label class="check"><input type="checkbox" checked=${!!v} onChange=${(e) => set(e.target.checked)} />${f.label}</label>`;
    if (f.type === 'select') return html`<label class="f">${f.label}<select value=${v} onChange=${(e) => set(e.target.value)}>${f.options.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>`;
    if (f.type === 'multi') return html`<div class="f">${f.label}<div class="row" style="gap:12px">${f.options.map(([k, l]) => html`<label class="check"><input type="checkbox" checked=${(v || []).includes(k)}
      onChange=${(e) => set(e.target.checked ? [...(v || []), k] : (v || []).filter((x) => x !== k))} />${l}</label>`)}</div></div>`;
    if (f.auto) return '';
    return html`<label class="f">${f.label}${f.required ? ' *' : ''}<input type=${f.secret ? 'password' : f.type === 'number' ? 'number' : 'text'} value=${v ?? ''} autocomplete="off"
      placeholder=${f.secret && v ? 'сохранено — введите новый, чтобы заменить' : ''} onFocus=${(e) => f.secret && String(v || '').startsWith('••••') && (e.target.value = '', set(''))}
      onInput=${(e) => set(e.target.value)} /></label>`;
  };
  return html`<div class="card" style=${open ? 'grid-column:1/-1;border-color:var(--accent)' : ''}>
    <div class="row" style="cursor:pointer" onClick=${onToggle}>
      <div class="grow"><b style="font-size:15px">${it.title}</b><div class="muted small">${it.about}</div></div>
      <span class="badge" style=${`border-color:${status[1]};color:${status[1]}`}>${status[0]}</span>
    </div>
    ${it.info && it.enabled ? html`<div class="small pos" style="margin-top:6px">${it.info}</div>` : ''}
    ${it.lastError && it.enabled ? html`<div class="small err" style="margin-top:6px">${it.lastError}</div>` : ''}
    ${it.lastSync ? html`<div class="small faint">Последняя синхронизация: ${fdt(it.lastSync.replace('T', ' '))}</div>` : ''}
    ${open && html`<div class="stack" style="margin-top:14px">
      <div class="small" style="background:var(--surface2);border-radius:8px;padding:10px 12px"><b>Где взять:</b> ${it.howto}</div>
      <div class="grid g2">${it.fields.filter((f) => !f.advanced && f.type !== 'bool' && f.type !== 'multi').map(field)}</div>
      <div class="stack">${it.fields.filter((f) => !f.advanced && (f.type === 'bool' || f.type === 'multi')).map(field)}</div>
      ${it.fields.some((f) => f.advanced) ? html`<a href="#" class="small" onClick=${(e) => { e.preventDefault(); setAdv(!adv); }}>${adv ? 'Скрыть' : 'Дополнительно'}</a>
        ${adv && html`<div class="grid g2">${it.fields.filter((f) => f.advanced).map(field)}</div>`}` : ''}
      ${it.key === 'calendar' && html`<div class="stack small">
        <div>Общая ссылка: <code style="user-select:all;word-break:break-all">${feed}</code></div>
        ${stations.map((s) => html`<div>${s.name}: <code style="user-select:all;word-break:break-all">${feed}?station=${s.id}</code></div>`)}
        <div class="muted">Ссылка работает, только когда интеграция включена. Google обновляет подписку раз в несколько часов.</div></div>`}
      <div class="row">
        <label class="check" style="margin-right:auto"><input type="checkbox" checked=${enabled} onChange=${(e) => setEnabled(e.target.checked)} /><b>Включено</b></label>
        <button class="btn" disabled=${busy} onClick=${test}>${busy ? 'Проверяю…' : 'Проверить связь'}</button>
        <button class="btn primary" onClick=${() => save()}>Сохранить</button>
      </div>
    </div>`}
  </div>`;
}
