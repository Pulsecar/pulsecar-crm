// Касса Pulse Points без заказа: быстрая продажа, начисление и списание баллов
import { html, useState, useApp, api, act, toast, Icon, zl, num } from '../lib.js';
import { ScanBox } from '../scan.js';

export default function Pos() {
  const app = useApp();
  const R = app.loyalty;
  const [cur, setCur] = useState(null);
  const [f, set] = useState({ total: '', order: '', redeem: false, pts: '' });
  const [done, setDone] = useState(null);
  const onScan = async (data) => {
    try { const r = await api('pos/scan', { body: data }); setCur(r); setDone(null); set({ total: '', order: '', redeem: false, pts: '' }); }
    catch (e) { toast(e.message, 'error'); }
  };
  const L = cur?.client.loyalty;
  const total = Number(f.total) || 0;
  const maxByShare = Math.floor((total * R.maxRedeemShare) / R.pointValuePln);
  const maxRedeem = L && L.balance >= R.minRedeem ? Math.min(L.balance, maxByShare) : 0;
  const redeem = f.redeem ? Math.max(0, Math.floor(Number(f.pts) || 0)) : 0;
  const discount = Math.round(redeem * R.pointValuePln * 100) / 100;
  const paid = Math.round((total - discount) * 100) / 100;
  const earn = L ? Math.floor(paid * L.tier.rate) : 0;
  const pay = async () => {
    const r = await act(() => api('pos/checkout', { body: { ticket: cur.ticket, orderTotal: total, orderNo: f.order, redeemPoints: redeem } }));
    setDone({ ...r, name: cur.client.name || cur.client.cardNo }); setCur(null);
  };
  return html`
    <div class="page-head"><h1>Pulse Points — касса</h1><span class="muted">для продаж без заказа. В заказе баллы списываются во вкладке «Оплата», а начисляются сами при завершении.</span></div>
    <div class="grid g2">
      <div class="card"><h2>1. QR клиента</h2><${ScanBox} onResult=${onScan} /></div>
      <div class="card"><h2>2. Оплата и баллы</h2>
        ${done ? html`<div class="stack c">
            <div class="muted">${done.name}</div><div class="bigpts">+${num(done.earn)}</div>
            <div>${done.redeem ? `списано ${num(done.redeem)} баллов (−${zl(done.discount)}) · ` : ''}к оплате <b>${zl(done.paid)}</b></div>
            <div class="muted">Новый баланс: ${num(done.balanceAfter)}</div>
            <button class="btn primary" onClick=${() => setDone(null)}>Следующий клиент</button></div>`
        : !cur ? html`<div class="muted">Отсканируйте QR в приложении клиента или введите телефон и 6 цифр.</div>`
        : html`<div class="stack">
            <div class="row"><div class="grow"><b style="font-size:18px">${cur.client.name || 'Клиент'}</b> <span class="badge" style="background:var(--accent);color:#000">${L.tier.name}</span>
              <div class="muted small">${cur.client.phone || ''} · ${cur.client.cardNo} · ${L.tier.rate} балла за 1 zł</div></div>
              <div class="c"><div class="bigpts">${num(L.balance)}</div><div class="muted small">баллов</div></div></div>
            <div class="row">${cur.client.cars.map((k) => html`<span class="chip">${[k.plate, k.make, k.model].filter(Boolean).join(' ')}</span>`)}</div>
            <div class="grid g2"><label class="f">Сумма, zł<input type="number" step="0.01" value=${f.total} onInput=${(e) => set({ ...f, total: e.target.value })} autofocus /></label>
              <label class="f">Номер заказа / чека${app.features.autoEarnFromCrm ? ' *' : ''}<input value=${f.order} onInput=${(e) => set({ ...f, order: e.target.value })} /></label></div>
            <label class="check"><input type="checkbox" disabled=${!maxRedeem && !f.redeem} checked=${f.redeem} onChange=${(e) => set({ ...f, redeem: e.target.checked, pts: e.target.checked ? String(maxRedeem || '') : '' })} />
              ${L.balance >= R.minRedeem ? 'Клиент хочет списать баллы' : `Списать нельзя — нужно минимум ${R.minRedeem}`}</label>
            ${f.redeem && html`<label class="f" style="width:200px">Списать баллов (до ${num(maxRedeem)})<input type="number" value=${f.pts} onInput=${(e) => set({ ...f, pts: e.target.value })} /></label>`}
            <div class="sum-box"><div><span>Сумма</span><span>${zl(total)}</span></div>
              ${redeem ? html`<div><span>Скидка баллами (−${num(redeem)})</span><span class="neg">−${zl(discount)}</span></div>` : ''}
              <div class="total"><span>К оплате</span><span>${zl(paid)}</span></div><div class="pos"><span>Будет начислено</span><span>+${num(earn)}</span></div></div>
            <button class="btn primary lg" disabled=${!(total > 0)} onClick=${pay}>Подтвердить</button></div>`}
      </div>
    </div>
    <div class="card" style="margin-top:14px"><h2>Правила</h2>
      <div class="row">${R.tiers.map((t) => html`<div class="stat" style="min-width:160px"><b>${t.name}</b><span>${String(t.rate).replace('.', ',')} балла за 1 zł · ${t.from ? 'от ' + zl(t.from) + ' за 12 мес.' : 'сразу'}</span></div>`)}</div>
      <p class="muted small">1 балл = ${zl(R.pointValuePln)} · списание от ${R.minRedeem} баллов · до ${Math.round(R.maxRedeemShare * 100)}% суммы · +${R.welcomeBonus} за регистрацию. QR меняется каждые 30 секунд и принимается один раз.</p></div>`;
}
