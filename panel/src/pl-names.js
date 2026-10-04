// Названия товаров, импортированных со страниц поставщиков, всегда на польском.
// Если сайт поставщика открыт на RU/UA, расширение прочитает кириллицу — тогда:
// 1) берём польское название уже существующего товара (по SKU / коду);
// 2) Inter Cars — спрашиваем IC API (Accept-Language: pl);
// 3) переводим по словарю автозапчастей;
// 4) если кириллица осталась — «Część {бренд} {код}».
import { one } from './db.js';
import { cfg } from './integrations/index.js';
import * as IC from './integrations/intercars.js';

export const hasCyr = (s) => /[Ѐ-ӿ]/.test(String(s || ''));

// длинные фразы раньше коротких; ключи — нижний регистр, RU и UK
const GLOSSARY = [
  ['фильтр масляный', 'Filtr oleju'], ['масляный фильтр', 'Filtr oleju'], ['фільтр масляний', 'Filtr oleju'], ['масляний фільтр', 'Filtr oleju'],
  ['фильтр воздушный', 'Filtr powietrza'], ['воздушный фильтр', 'Filtr powietrza'], ['фільтр повітряний', 'Filtr powietrza'], ['повітряний фільтр', 'Filtr powietrza'],
  ['фильтр салона', 'Filtr kabinowy'], ['салонный фильтр', 'Filtr kabinowy'], ['фильтр салонный', 'Filtr kabinowy'], ['фільтр салону', 'Filtr kabinowy'], ['салонний фільтр', 'Filtr kabinowy'],
  ['фильтр топливный', 'Filtr paliwa'], ['топливный фильтр', 'Filtr paliwa'], ['фільтр паливний', 'Filtr paliwa'], ['паливний фільтр', 'Filtr paliwa'],
  ['тормозные колодки', 'Klocki hamulcowe'], ['колодки тормозные', 'Klocki hamulcowe'], ['гальмівні колодки', 'Klocki hamulcowe'], ['колодки гальмівні', 'Klocki hamulcowe'],
  ['тормозной диск', 'Tarcza hamulcowa'], ['диск тормозной', 'Tarcza hamulcowa'], ['тормозные диски', 'Tarcze hamulcowe'], ['гальмівний диск', 'Tarcza hamulcowa'], ['диск гальмівний', 'Tarcza hamulcowa'],
  ['тормозная жидкость', 'Płyn hamulcowy'], ['гальмівна рідина', 'Płyn hamulcowy'], ['тормозной суппорт', 'Zacisk hamulcowy'], ['суппорт', 'Zacisk hamulcowy'], ['супорт', 'Zacisk hamulcowy'],
  ['свеча зажигания', 'Świeca zapłonowa'], ['свечи зажигания', 'Świece zapłonowe'], ['свічка запалювання', 'Świeca zapłonowa'], ['свеча накаливания', 'Świeca żarowa'], ['свічка розжарювання', 'Świeca żarowa'],
  ['катушка зажигания', 'Cewka zapłonowa'], ['котушка запалювання', 'Cewka zapłonowa'],
  ['моторное масло', 'Olej silnikowy'], ['масло моторное', 'Olej silnikowy'], ['моторна олива', 'Olej silnikowy'], ['моторне масло', 'Olej silnikowy'], ['трансмиссионное масло', 'Olej przekładniowy'], ['трансмісійна олива', 'Olej przekładniowy'],
  ['охлаждающая жидкость', 'Płyn chłodniczy'], ['антифриз', 'Płyn chłodniczy'], ['охолоджувальна рідина', 'Płyn chłodniczy'],
  ['ремень грм', 'Pasek rozrządu'], ['ремінь грм', 'Pasek rozrządu'], ['комплект грм', 'Zestaw rozrządu'], ['ремень поликлиновой', 'Pasek wielorowkowy'], ['поликлиновой ремень', 'Pasek wielorowkowy'], ['ремень', 'Pasek'], ['ремінь', 'Pasek'],
  ['водяной насос', 'Pompa wody'], ['помпа', 'Pompa wody'], ['водяна помпа', 'Pompa wody'], ['натяжной ролик', 'Rolka napinacza'], ['натяжний ролик', 'Rolka napinacza'], ['ролик', 'Rolka'],
  ['амортизатор', 'Amortyzator'], ['пружина подвески', 'Sprężyna zawieszenia'], ['пружина', 'Sprężyna'], ['опора амортизатора', 'Mocowanie amortyzatora'],
  ['шаровая опора', 'Sworzeń wahacza'], ['кульова опора', 'Sworzeń wahacza'], ['рулевой наконечник', 'Końcówka drążka kierowniczego'], ['наконечник рулевой тяги', 'Końcówka drążka kierowniczego'], ['рулевая тяга', 'Drążek kierowniczy'], ['кермова тяга', 'Drążek kierowniczy'],
  ['стойка стабилизатора', 'Łącznik stabilizatora'], ['тяга стабилизатора', 'Łącznik stabilizatora'], ['стійка стабілізатора', 'Łącznik stabilizatora'], ['втулка стабилизатора', 'Tuleja stabilizatora'],
  ['сайлентблок', 'Tuleja wahacza'], ['рычаг подвески', 'Wahacz'], ['рычаг', 'Wahacz'], ['важіль', 'Wahacz'],
  ['ступичный подшипник', 'Łożysko koła'], ['подшипник ступицы', 'Łożysko koła'], ['підшипник маточини', 'Łożysko koła'], ['подшипник', 'Łożysko'], ['підшипник', 'Łożysko'], ['ступица', 'Piasta'],
  ['комплект сцепления', 'Zestaw sprzęgła'], ['сцепление', 'Sprzęgło'], ['зчеплення', 'Sprzęgło'], ['маховик', 'Koło dwumasowe'],
  ['шрус', 'Przegub napędowy'], ['пыльник', 'Osłona'], ['пильовик', 'Osłona'], ['привод', 'Półoś napędowa'],
  ['аккумулятор', 'Akumulator'], ['акумулятор', 'Akumulator'], ['стартер', 'Rozrusznik'], ['генератор', 'Alternator'], ['лампа', 'Żarówka'], ['лампочка', 'Żarówka'],
  ['щетка стеклоочистителя', 'Pióro wycieraczki'], ['щетки стеклоочистителя', 'Pióra wycieraczek'], ['дворник', 'Pióro wycieraczki'], ['щітка склоочисника', 'Pióro wycieraczki'],
  ['датчик', 'Czujnik'], ['лямбда-зонд', 'Sonda lambda'], ['термостат', 'Termostat'], ['радиатор', 'Chłodnica'], ['радіатор', 'Chłodnica'], ['прокладка', 'Uszczelka'], ['сальник', 'Uszczelniacz'],
  ['глушитель', 'Tłumik'], ['глушник', 'Tłumik'], ['выхлопная труба', 'Rura wydechowa'], ['катализатор', 'Katalizator'], ['сажевый фильтр', 'Filtr cząstek stałych DPF'],
  ['шина', 'Opona'], ['шины', 'Opony'], ['диск колесный', 'Felga'], ['колесный диск', 'Felga'], ['болт колесный', 'Śruba koła'], ['гайка', 'Nakrętka'], ['болт', 'Śruba'],
  ['фильтр', 'Filtr'], ['фільтр', 'Filtr'], ['колодки', 'Klocki'], ['диск', 'Tarcza'], ['свеча', 'Świeca'], ['масло', 'Olej'], ['олива', 'Olej'], ['жидкость', 'Płyn'], ['рідина', 'Płyn'],
  ['комплект', 'Zestaw'], ['набор', 'Zestaw'], ['ремкомплект', 'Zestaw naprawczy'], ['насос', 'Pompa'], ['трос', 'Linka'], ['шланг', 'Przewód'], ['патрубок', 'Przewód'],
  ['передний', 'przedni'], ['передняя', 'przednia'], ['передние', 'przednie'], ['передній', 'przedni'], ['задний', 'tylny'], ['задняя', 'tylna'], ['задние', 'tylne'], ['задній', 'tylny'],
  ['левый', 'lewy'], ['левая', 'lewa'], ['лівий', 'lewy'], ['правый', 'prawy'], ['правая', 'prawa'], ['правий', 'prawy'],
  ['верхний', 'górny'], ['нижний', 'dolny'], ['верхній', 'górny'], ['нижній', 'dolny'], ['ось', 'oś'], ['вісь', 'oś'], ['оригинал', 'oryginał'], ['комплект из', 'zestaw'],
  ['шт', 'szt.'], [' и ', ' i '], [' для ', ' do '], [' с ', ' z '], [' з ', ' z '],
].sort((a, b) => b[0].length - a[0].length);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RE = new RegExp(GLOSSARY.map(([k]) => /^\s|\s$/.test(k) ? esc(k) : `(?<![\\u0400-\\u04FF])${esc(k)}(?![\\u0400-\\u04FF])`).join('|'), 'giu');
const MAP = new Map(GLOSSARY.map(([k, v]) => [k, v]));

export function glossaryPl(name) {
  let out = String(name || '').replace(RE, (m) => MAP.get(m.toLowerCase()) ?? m).replace(/\s{2,}/g, ' ').trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** items: [{name, code, brand, sku}] — меняет name на месте. supKey — ключ поставщика ('intercars', …). */
export async function polishNames(items, supKey) {
  for (const i of items) {
    if (!hasCyr(i.name)) continue;
    // 1) уже есть в картотеке на польском
    const p = (i.sku && one('SELECT name FROM products WHERE supplier_sku = ?', i.sku)) || (i.code && one('SELECT name FROM products WHERE code = ?', i.code));
    if (p?.name && !hasCyr(p.name)) { i.name = p.name; continue; }
    // 2) Inter Cars API отдаёт польские названия
    if (supKey === 'intercars' && (i.code || i.sku)) {
      try {
        const c = cfg('intercars');
        if (c?.clientId && c?.clientSecret) {
          const r = await IC.search(i.code || i.sku);
          const hit = r.find((x) => (i.sku && x.sku === i.sku) || (i.code && String(x.index).toUpperCase() === String(i.code).toUpperCase())) || r[0];
          if (hit?.name && !hasCyr(hit.name)) { i.name = hit.name.slice(0, 250); continue; }
        }
      } catch { /* API недоступен — идём дальше */ }
    }
    // 3) словарь; 4) запасной вариант
    const g = glossaryPl(i.name);
    i.name = (hasCyr(g) ? `Część ${[i.brand, i.code].filter(Boolean).join(' ')}`.trim() : g).slice(0, 250);
  }
  return items;
}
