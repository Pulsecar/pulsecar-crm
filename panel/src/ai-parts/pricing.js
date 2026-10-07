// Цена продажи клиенту (брутто) для позиций ИИ-запчастиста.
// Inter Cars: рекомендуемая цена IC, но не ниже закупки брутто + минимальная маржа (по умолчанию 30 %); выше — не трогаем.
// Allegro: закупка брутто + 30–50 % — чем дешевле деталь, тем больше наценка.
import { getSetting } from '../db.js';
import { round2 } from '../util.js';

export const minMargin = () => { const v = Number(getSetting('ai_parts_min_margin') ?? 30); return Number.isFinite(v) && v >= 0 ? v : 30; };

/** Inter Cars: { sellGross, src: 'ic' | 'min' | 'markup' } */
export function icSell(priceNet, listGross, vat = 23) {
  const buyGross = priceNet * (1 + vat / 100);
  const floor = round2(buyGross * (1 + minMargin() / 100));
  if (listGross > 0) return listGross >= floor ? { sellGross: round2(listGross), src: 'ic' } : { sellGross: floor, src: 'min' };
  const markup = Math.max(Number(getSetting('ai_parts_markup') || 40), minMargin());
  return { sellGross: round2(buyGross * (1 + markup / 100)), src: 'markup' };
}

/** Наценка Allegro по цене закупки брутто (zł) */
export function allegroMarkup(buyGross) {
  const lo = Math.max(30, minMargin());
  const steps = [[100, 50], [250, 45], [500, 40], [1000, 35]];
  for (const [lim, pct] of steps) if (buyGross < lim) return Math.max(pct, lo);
  return lo;
}
export const allegroSell = (buyGross) => round2(buyGross * (1 + allegroMarkup(buyGross) / 100));
