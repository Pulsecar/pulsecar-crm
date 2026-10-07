// Inter Cars для подбора: найти товар по бренду + артикулу (каталог IC), затем цена закупки, рекомендуемая цена продажи и наличие.
// Только чтение каталога и расчёт цены (POST /ic/inventory/quote не создаёт заказ). Заказы ассистент не делает.
import { icRead } from '../integrations/intercars.js';
import { cfg } from '../integrations/index.js';
import { round2 } from '../util.js';

export const icOn = () => { const c = cfg('intercars'); return !!(c?.clientId && c.clientSecret); };
export const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// одинаковые бренды под разными названиями
const BRAND_ALIAS = { MANNFILTER: 'MANN', MANN: 'MANN', VAG: 'VAG', VW: 'VAG', VOLKSWAGEN: 'VAG', AUDI: 'VAG', SKODA: 'VAG', SEAT: 'VAG', BOSCH: 'BOSCH', ROBERTBOSCH: 'BOSCH',
  LEMFORDER: 'LEMFOERDER', LEMFOERDER: 'LEMFOERDER', TRW: 'TRW', TRWAUTOMOTIVE: 'TRW', SKF: 'SKF', INA: 'INA', LUK: 'LUK', FAG: 'FAG', SCHAEFFLER: 'INA', CONTITECH: 'CONTITECH', CONTINENTAL: 'CONTITECH',
  MERCEDES: 'MB', MERCEDESBENZ: 'MB', MB: 'MB', BMW: 'BMW', MINI: 'BMW', PSA: 'PSA', PEUGEOT: 'PSA', CITROEN: 'PSA', RENAULT: 'RENAULT', DACIA: 'RENAULT', OPEL: 'GM', GM: 'GM', TOYOTA: 'TOYOTA', LEXUS: 'TOYOTA',
  FORD: 'FORD', HYUNDAI: 'HYUNDAI', KIA: 'HYUNDAI', HYUNDAIKIA: 'HYUNDAI', FIAT: 'FIAT', NISSAN: 'NISSAN', HONDA: 'HONDA', MAZDA: 'MAZDA', VOLVO: 'VOLVO', NGK: 'NGK', NGKSPARKPLUG: 'NGK', DENSO: 'DENSO' };
export const normBrand = (b) => { const n = norm(b); return BRAND_ALIAS[n] || n; };

/** Поиск товара IC по артикулу (и бренду). Возвращает [{sku, index, brand, articleNumber, name}] */
export async function findByArticle(article, brand, cache) {
  const key = norm(brand) + '|' + norm(article);
  if (cache?.has(key)) return cache.get(key);
  const want = norm(article), wb = brand ? normBrand(brand) : null;
  const out = [];
  const spaced = String(article).trim().replace(/([A-Za-z])(\d)/g, '$1 $2');
  for (const q of [...new Set([String(article).trim(), want, spaced])]) {
    if (!q) continue;
    let r = null;
    try { r = await icRead('/ic/catalog/products', { query: { index: q, pageSize: 25 } }); } catch { r = null; }
    for (const p of r?.products || []) {
      const okArt = norm(p.articleNumber) === want || norm(p.index) === want || norm(p.index).endsWith(want) || norm(p.tecDoc) === want;
      if (!okArt) continue;
      if (wb && p.brand && normBrand(p.brand) !== wb) continue;
      if (!out.some((x) => x.sku === p.sku)) out.push({ sku: p.sku, index: p.index, brand: p.brand, articleNumber: p.articleNumber, name: p.shortDescription || p.description || '' });
    }
    if (out.length) break;
  }
  cache?.set(key, out);
  return out;
}

/** Цены и наличие по списку SKU (до 100 за запрос): закупка нетто, рекомендуемая IC цена продажи брутто, наличие и срок */
export async function quote(skus) {
  const res = new Map();
  const list = [...new Set(skus.filter(Boolean))];
  for (let i = 0; i < list.length; i += 100) {
    const part = list.slice(i, i + 100);
    let r = null;
    try { r = await icRead('/ic/inventory/quote', { body: { lines: part.map((sku) => ({ sku, quantity: 1 })) } }); } catch { r = null; }
    for (const l of Array.isArray(r) ? r : r?.lines || []) {
      const p = l.price || {};
      const vat = Number(p.vatPercentage ?? 23);
      const net = Number(p.customerPriceNet) || 0;
      const listGross = Number(p.listPriceGross) || (Number(p.listPriceNet) ? round2(Number(p.listPriceNet) * (1 + vat / 100)) : 0);
      const av = (l.lines || []).reduce((s, x) => s + (Number(x.availability) || 0), 0);
      const first = (l.lines || []).filter((x) => Number(x.availability) > 0).map((x) => x.customerRouteStartDateTime || x.latestDeliveryDate).filter(Boolean).sort()[0]
        || (l.lines || []).map((x) => x.latestDeliveryDate).filter(Boolean).sort()[0] || null;
      res.set(l.sku, { priceNet: net, sellGross: listGross, vat, availability: av, deliveryAt: first, name: l.name || l.description || '' });
    }
  }
  return res;
}

/** Срок доставки по-человечески: «сегодня 15:00», «завтра 9:30», «12.10» */
export function whenText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return String(iso).slice(0, 10);
  const day = (x) => new Date(x.toLocaleString('en-US', { timeZone: 'Europe/Warsaw' })).toDateString();
  const hm = d.toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });
  const now = new Date(), tm = new Date(Date.now() + 864e5);
  if (day(d) === day(now)) return 'сегодня ' + hm;
  if (day(d) === day(tm)) return 'завтра ' + hm;
  return d.toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit' });
}
