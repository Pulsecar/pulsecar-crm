// Простые графики на SVG без библиотек: столбцы с подсказкой, горизонтальные полосы, линия притока/оттока
import { html, useState } from './lib.js';

// категориальная палитра для тёмной темы (проверена валидатором: CVD ΔE ≥ 8.4, контраст ≥ 3:1 на #17181b)
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];
export const ACCENT = 'var(--accent)';

const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = [1, 2, 2.5, 5, 10].find((x) => x * p >= v);
  return m * p;
};
const compact = (n) => (Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' млн' : Math.abs(n) >= 1e4 ? Math.round(n / 1e3) + ' тыс' : Math.round(n).toLocaleString('pl-PL'));

/** Столбцы по периоду: основная серия + (необязательно) линия прошлого периода; подсказка при наведении */
export function Columns({ rows, value, label, fmt, color = ACCENT, prev, prevLabel = 'Прошлый период', height = 220, tip }) {
  const [hover, setHover] = useState(null);
  if (!rows.length) return html`<div class="empty">Нет данных за период</div>`;
  const W = Math.max(1000, rows.length * 34), H = height, padL = 58, padB = 26, padT = 10;
  const vals = rows.map(value);
  const pv = prev ? rows.map((_, i) => prev[i] ?? null) : null;
  const max = niceMax(Math.max(...vals, ...(pv || []).filter((x) => x != null), 0));
  const min = Math.min(0, ...vals);
  const span = max - min || 1;
  const y = (v) => padT + (H - padT - padB) * (1 - (v - min) / span);
  const band = (W - padL - 8) / rows.length;
  const bw = Math.min(24, band * 0.62);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + span * t);
  const every = Math.ceil(rows.length / Math.floor((W - padL) / 70));
  return html`<div class="chart-wrap" onMouseLeave=${() => setHover(null)}>
    ${prev ? html`<div class="legend"><span><i style=${'background:' + color}></i>Текущий период</span><span><i class="line" style="background:#9a9ca3"></i>${prevLabel}</span></div>` : ''}
    <svg viewBox=${`0 0 ${W} ${H}`} style=${`width:100%;min-width:${Math.min(W, 640)}px;height:auto;max-height:${H * 1.4}px`} role="img" aria-label="График">
      ${ticks.map((t) => html`<g><line x1=${padL} x2=${W - 4} y1=${y(t)} y2=${y(t)} class="grid" /><text x=${padL - 6} y=${y(t) + 4} class="tick" text-anchor="end">${compact(t)}</text></g>`)}
      ${rows.map((r, i) => {
        const v = vals[i];
        const x = padL + band * i + (band - bw) / 2;
        const top = y(Math.max(v, 0)), bot = y(Math.min(v, 0));
        const h = Math.max(1, bot - top);
        const rr = Math.min(4, h / 2, bw / 2);
        const d = v >= 0 ? `M${x},${bot} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + bw - rr} Q${x + bw},${top} ${x + bw},${top + rr} V${bot} Z`
          : `M${x},${top} V${bot - rr} Q${x},${bot} ${x + rr},${bot} H${x + bw - rr} Q${x + bw},${bot} ${x + bw},${bot - rr} V${top} Z`;
        return html`<g onMouseEnter=${() => setHover(i)}>
          <rect x=${padL + band * i} y=${padT} width=${band} height=${H - padT - padB} fill="transparent" />
          <path d=${d} fill=${v < 0 ? 'var(--danger)' : color} opacity=${hover === null || hover === i ? 1 : 0.55} />
          ${i % every === 0 ? html`<text x=${padL + band * i + band / 2} y=${H - 8} class="tick" text-anchor="middle">${label(r, true)}</text>` : ''}</g>`;
      })}
      ${pv ? html`<polyline fill="none" stroke="#9a9ca3" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points=${pv.map((v, i) => (v == null ? '' : `${padL + band * i + band / 2},${y(v)}`)).filter(Boolean).join(' ')} />` : ''}
    </svg>
    ${hover !== null && html`<div class="chart-tip" style=${`left:${Math.min(88, ((padL + band * hover + band / 2) / W) * 100)}%`}>
      <b>${label(rows[hover])}</b><div>${fmt(vals[hover])}</div>${pv && pv[hover] != null ? html`<div class="muted">${prevLabel}: ${fmt(pv[hover])}</div>` : ''}${tip ? tip(rows[hover]) : ''}</div>`}
  </div>`;
}

/** Горизонтальные полосы (разрезы: источники, категории, марки) — значение у конца полосы, клик = детализация */
export function HBars({ rows, value, label, fmt, color = SERIES[0], onPick, sub }) {
  if (!rows.length) return html`<div class="muted small">Нет данных</div>`;
  const max = Math.max(1, ...rows.map((r) => Math.abs(value(r))));
  return html`<div class="hbars">${rows.map((r) => html`<div class=${'hbar' + (onPick ? ' click' : '')} onClick=${() => onPick?.(r)} title=${`${label(r)}: ${fmt(value(r))}`}>
    <span class="hbar-l">${label(r)}${sub ? html`<small>${sub(r)}</small>` : ''}</span>
    <span class="hbar-t"><i style=${`width:${(Math.abs(value(r)) / max) * 100}%;background:${value(r) < 0 ? 'var(--danger)' : color}`}></i></span>
    <span class="hbar-v">${fmt(value(r))}</span></div>`)}</div>`;
}

/** Приток и отток по дням: две серии, легенда + подсказка */
export function InOut({ rows, fmt }) {
  const [hover, setHover] = useState(null);
  if (!rows.length) return html`<div class="empty">Нет движения денег за период</div>`;
  const W = Math.max(1000, rows.length * 22), H = 200, padL = 58, padB = 24, padT = 10;
  const max = niceMax(Math.max(...rows.map((r) => Math.max(r.inflow, r.outflow)), 1));
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const band = (W - padL - 8) / rows.length;
  const bw = Math.min(10, band * 0.38);
  const every = Math.ceil(rows.length / Math.floor((W - padL) / 70));
  return html`<div class="chart-wrap" onMouseLeave=${() => setHover(null)}>
    <div class="legend"><span><i style=${'background:' + SERIES[2]}></i>Поступило</span><span><i style=${'background:' + SERIES[1]}></i>Выдано</span></div>
    <svg viewBox=${`0 0 ${W} ${H}`} style=${`width:100%;min-width:${Math.min(W, 640)}px;height:auto;max-height:${H * 1.4}px`} role="img" aria-label="Деньги по дням">
      ${[0, 0.5, 1].map((t) => html`<g><line x1=${padL} x2=${W - 4} y1=${y(max * t)} y2=${y(max * t)} class="grid" /><text x=${padL - 6} y=${y(max * t) + 4} class="tick" text-anchor="end">${compact(max * t)}</text></g>`)}
      ${rows.map((r, i) => {
        const x = padL + band * i + band / 2;
        return html`<g onMouseEnter=${() => setHover(i)}><rect x=${padL + band * i} y=${padT} width=${band} height=${H - padT - padB} fill="transparent" />
          <rect x=${x - bw - 1} y=${y(r.inflow)} width=${bw} height=${Math.max(0, y(0) - y(r.inflow))} rx="2" fill=${SERIES[2]} />
          <rect x=${x + 1} y=${y(r.outflow)} width=${bw} height=${Math.max(0, y(0) - y(r.outflow))} rx="2" fill=${SERIES[1]} />
          ${i % every === 0 ? html`<text x=${x} y=${H - 7} class="tick" text-anchor="middle">${r.d.slice(8, 10)}.${r.d.slice(5, 7)}</text>` : ''}</g>`;
      })}
    </svg>
    ${hover !== null && html`<div class="chart-tip" style=${`left:${Math.min(88, ((padL + band * hover) / W) * 100)}%`}><b>${rows[hover].d}</b><div>Поступило: ${fmt(rows[hover].inflow)}</div><div>Выдано: ${fmt(rows[hover].outflow)}</div></div>`}
  </div>`;
}

/** Несколько линий по дням (например, выручка каждого сервиса): легенда, перекрестие и подсказка со всеми сериями */
export function MultiLine({ days, series, fmt, height = 220 }) {
  const [hover, setHover] = useState(null);
  if (!days.length) return html`<div class="empty">Нет данных за период</div>`;
  const W = Math.max(1000, days.length * 26), H = height, padL = 58, padB = 26, padT = 12;
  const max = niceMax(Math.max(100, ...series.flatMap((s) => s.values))); // не меньше 100 — иначе шкала из одинаковых «1»
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const step = days.length > 1 ? (W - padL - 12) / (days.length - 1) : 0;
  const x = (i) => padL + (days.length > 1 ? step * i : (W - padL) / 2);
  const every = Math.ceil(days.length / Math.floor((W - padL) / 70));
  const near = (e) => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(days.length - 1, Math.round((px - padL) / (step || 1))))); };
  return html`<div class="chart-wrap" onMouseLeave=${() => setHover(null)}>
    ${series.length > 1 ? html`<div class="legend">${series.map((s) => html`<span><i class="line" style=${'background:' + s.color}></i>${s.name}</span>`)}</div>` : ''}
    <svg viewBox=${`0 0 ${W} ${H}`} style=${`width:100%;min-width:${Math.min(W, 640)}px;height:auto;max-height:${H * 1.4}px`} role="img" aria-label="График по дням" onMouseMove=${near}>
      ${[0, 0.25, 0.5, 0.75, 1].map((t) => html`<g><line x1=${padL} x2=${W - 4} y1=${y(max * t)} y2=${y(max * t)} class="grid" /><text x=${padL - 6} y=${y(max * t) + 4} class="tick" text-anchor="end">${compact(max * t)}</text></g>`)}
      ${days.map((d, i) => (i % every === 0 ? html`<text x=${x(i)} y=${H - 8} class="tick" text-anchor="middle">${d.slice(8, 10)}.${d.slice(5, 7)}</text>` : ''))}
      ${hover !== null && html`<line x1=${x(hover)} x2=${x(hover)} y1=${padT} y2=${H - padB} stroke="var(--muted, #9a9ca3)" stroke-width="1" stroke-dasharray="3 3" />`}
      ${series.map((s) => html`<g><polyline fill="none" stroke=${s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points=${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        ${hover !== null && html`<circle cx=${x(hover)} cy=${y(s.values[hover])} r="4" fill=${s.color} stroke="var(--surface, #17181b)" stroke-width="2" />`}</g>`)}
    </svg>
    ${hover !== null && html`<div class="chart-tip" style=${`left:${Math.min(80, (x(hover) / W) * 100)}%`}><b>${days[hover].slice(8, 10)}.${days[hover].slice(5, 7)}.${days[hover].slice(0, 4)}</b>
      ${series.map((s) => html`<div><i class="dot" style=${'background:' + s.color}></i> ${s.name}: <b>${fmt(s.values[hover])}</b></div>`)}</div>`}
  </div>`;
}
