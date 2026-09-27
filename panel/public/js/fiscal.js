// Печать на фискальной кассе через расширение Pulsecar (касса — в локальной сети сервиса)
import { html, useState, useEffect, api, act, toast, zl, fdt, Modal, useApp } from './lib.js';

export const extVersion = () => document.documentElement.dataset.pulsecarExt || '';
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return true; };

function ext(type, extra, ms = 120000) {
  return new Promise((resolve) => {
    const reqId = Math.random().toString(36).slice(2);
    const t = setTimeout(() => { window.removeEventListener('message', on); resolve({ ok: false, error: 'Расширение не ответило' }); }, ms);
    function on(e) {
      const m = e.data;
      if (e.source !== window || !m || m.source !== 'pulsecar-ext' || m.type !== type + '-result' || m.reqId !== reqId) return;
      clearTimeout(t); window.removeEventListener('message', on); resolve(m);
    }
    window.addEventListener('message', on);
    window.postMessage({ source: 'pulsecar-crm', type, reqId, ...extra }, location.origin);
  });
}

/** Отправить задание на кассу; при отсутствии разрешения — открыть окно разрешения в расширении */
export async function runJob(job) {
  const v = extVersion();
  if (!v) return { ok: false, error: 'На этом компьютере нет расширения Pulsecar — установите его (Склад → Поставщики → Расширение Chrome) на компьютер у кассы.' };
  if (!newer(v, '1.2.0')) return { ok: false, error: `Обновите расширение Pulsecar до 1.2 (сейчас ${v}) — в нём печать на кассе.` };
  const r = await ext('fiscal', { job });
  if (r.needPermission) {
    await ext('fiscal-allow', { url: job.url }, 5000);
    return { ...r, error: 'Откроется окно расширения — нажмите «Разрешить доступ к кассе», затем повторите печать.' };
  }
  return r;
}

export async function printReceipt(orderId, opts) {
  const { receipt, job } = await api(`orders/${orderId}/receipt`, { body: opts });
  if (!job) return { receipt, manual: true };
  return sendJob(receipt.id, job);
}
export async function sendJob(receiptId, job) {
  const r = await runJob(job);
  const saved = await api(`receipts/${receiptId}/result`, { body: r });
  return { receipt: saved.receipt, result: r };
}

const ST = { printed: ['напечатан', 'var(--accent)'], pending: ['не напечатан', 'var(--warn)'], error: ['ошибка', 'var(--danger)'], manual: ['ждёт номер', 'var(--muted)'] };

/** Блок «Чек (paragon)» во вкладке оплаты заказа */
export function ReceiptBox({ o, reload, ask }) {
  const app = useApp();
  const f = app.features.fiscal;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nums, setNums] = useState({});
  const printed = (o.receipts || []).find((r) => r.status === 'printed');
  useEffect(() => { if (ask && !printed) setOpen(true); }, [ask]);
  const retry = async (r) => {
    setBusy(true);
    try {
      const { job } = await api(`receipts/${r.id}/job`);
      if (job) { const x = await sendJob(r.id, job); x.receipt.status === 'printed' ? toast('Чек напечатан' + (x.receipt.number ? ' · № ' + x.receipt.number : '')) : toast(x.receipt.error || 'Не напечатан', 'error'); }
    } catch (e) { toast(e.message, 'error'); }
    setBusy(false); reload();
  };
  if (!f) return html`<div class="muted small" style="margin-top:14px">Фискальная касса не подключена — ${app.perms?.['settings.manage'] ? html`<a href="#/settings/integrations">Настройки → Интеграции → Фискальная касса</a>` : 'попросите администратора подключить её'}.</div>`;
  return html`<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">
    <div class="row"><b class="grow">Чек (paragon)</b>
      ${!printed && html`<button class="btn primary sm" disabled=${busy || !o.items?.length} onClick=${() => setOpen(true)}>${f.driver === 'manual' ? 'Чек на кассе' : 'Пробить чек'}</button>`}</div>
    ${(o.receipts || []).slice(0, 4).map((r) => html`<div class="row small" style="margin-top:6px">
      <span class="grow">${fdt(r.printed_at || r.created_at)} · ${zl(r.total)}${r.nip ? ' · NIP ' + r.nip : ''}${r.number ? html` · № <b>${r.number}</b>` : ''}
        ${r.error && r.status !== 'printed' ? html`<div style="color:var(--danger)">${r.error}</div>` : ''}</span>
      <span class="badge" style=${`border-color:${ST[r.status]?.[1]};color:${ST[r.status]?.[1]}`}>${ST[r.status]?.[0] || r.status}</span>
      ${r.status !== 'printed' && r.printer === 'novitus' && !printed && html`<button class="btn sm" disabled=${busy} onClick=${() => retry(r)}>Повторить</button>`}
      ${r.status !== 'printed' && !printed && html`<input class="inline-input" style="width:110px" placeholder="№ с кассы" value=${nums[r.id] || ''} onInput=${(e) => setNums({ ...nums, [r.id]: e.target.value })} />
        <button class="btn sm" disabled=${!nums[r.id]} onClick=${async () => { await act(() => api(`receipts/${r.id}/manual`, { body: { number: nums[r.id] } }), 'Номер чека сохранён'); reload(); }}>OK</button>`}
    </div>`)}
    ${open && html`<${ReceiptModal} o=${o} onClose=${() => setOpen(false)} onDone=${() => { setOpen(false); reload(); }} />`}
  </div>`;
}

function ReceiptModal({ o, onClose, onDone }) {
  const app = useApp();
  const nip0 = (o.customer?.nip || '').replace(/\D/g, '');
  const [nip, setNip] = useState(nip0);
  const [withNip, setWithNip] = useState(!!nip0);
  const paidMethods = [...new Set((o.payments || []).filter((p) => p.direction === 'in' && p.method !== 'points').map((p) => p.method))];
  const [method, setMethod] = useState(paidMethods.length ? '' : 'card');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const x = await printReceipt(o.id, { nip: withNip ? nip : '', method: method || null });
      if (x.manual) toast('Чек создан — пробейте его на кассе и впишите номер');
      else if (x.receipt.status === 'printed') toast('Чек напечатан' + (x.receipt.number ? ' · № ' + x.receipt.number : ''));
      else toast(x.receipt.error || 'Чек не напечатан', 'error');
      onDone();
    } catch (e) { toast(e.message, 'error'); setBusy(false); }
  };
  return html`<${Modal} title="Чек (paragon)" onClose=${onClose} foot=${html`<button class="btn ghost" onClick=${onClose}>Отмена</button>
      <button class="btn primary" disabled=${busy || (withNip && nip.length !== 10)} onClick=${go}>${busy ? 'Печатаю…' : app.features.fiscal?.driver === 'manual' ? 'Создать чек' : 'Печатать на кассе'}</button>`}>
    <div class="stack">
      <div>Сумма: <b>${zl(o.total)}</b> · позиций: ${o.items.length}</div>
      <label class="f">Оплата на чеке<select value=${method} onChange=${(e) => setMethod(e.target.value)}>
        ${paidMethods.length ? html`<option value="">Как принято в заказе (${paidMethods.map((m) => ({ cash: 'наличные', card: 'карта', transfer: 'перевод' }[m])).join(' + ')})</option>` : ''}
        <option value="card">Карта</option><option value="cash">Наличные</option><option value="transfer">Перевод</option></select></label>
      <label class="check"><input type="checkbox" checked=${withNip} onChange=${(e) => setWithNip(e.target.checked)} />NIP покупателя на чеке</label>
      ${withNip && html`<label class="f">NIP<input value=${nip} inputmode="numeric" maxlength="13" onInput=${(e) => setNip(e.target.value.replace(/\D/g, ''))} /></label>`}
      <div class="muted small">Чек с NIP до 450 zł брутто заменяет фактуру (faktura uproszczona).</div>
    </div></${Modal}>`;
}

/** Карточка кассы на странице «Касса»: проверка связи и дневной отчёт */
export function FiscalCard() {
  const app = useApp();
  const f = app.features.fiscal;
  const [busy, setBusy] = useState('');
  if (!f || f.driver !== 'novitus') return null;
  const run = async (kind) => {
    setBusy(kind);
    try {
      const { job } = await api(kind === 'ping' ? 'fiscal/ping-job' : 'fiscal/daily-job');
      const r = await runJob(job);
      if (r.ok) toast(kind === 'ping' ? `Касса на связи ✓ · в очереди ${r.queue ?? 0}` : 'Дневной отчёт напечатан');
      else toast(r.error, 'error');
    } catch (e) { toast(e.message, 'error'); }
    setBusy('');
  };
  return html`<div class="card" style="margin-bottom:12px"><div class="row">
    <div class="grow"><b>Фискальная касса</b><div class="sub">Novitus · ${f.url || 'адрес не указан'} · печать через расширение Pulsecar ${extVersion() ? 'v' + extVersion() : '(не найдено на этом компьютере)'}</div></div>
    <button class="btn sm" disabled=${!!busy} onClick=${() => run('ping')}>${busy === 'ping' ? 'Проверяю…' : 'Проверить кассу'}</button>
    ${app.perms?.['cash.edit'] && html`<button class="btn sm" disabled=${!!busy} onClick=${() => { if (confirm('Напечатать дневной отчёт (raport dobowy) на кассе?')) run('daily'); }}>${busy === 'daily' ? 'Печатаю…' : 'Дневной отчёт'}</button>`}
  </div></div>`;
}
