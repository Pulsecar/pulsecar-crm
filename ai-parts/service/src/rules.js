// «Правила подбора» автосервиса: бренды по уровням, наценки, чёрный список, комплекты.
// Значения по умолчанию — стартовые, админ правит их в разделе «Правила подбора»
// (после обучения на истории wycen сюда подставляются фактические бренды и наценки).
import { getDb } from './db.js';

export const DEFAULT_RULES = {
  levels: {
    economy: { label: 'Эконом', note: 'Самый дешёвый вариант от проверенного производителя' },
    middle: { label: 'Средний', note: 'Качественный aftermarket, часто поставщик конвейера' },
    oe: { label: 'OE', note: 'Оригинал производителя авто' },
  },
  // Бренды по группам и уровням. Группа "*" — для всех остальных групп.
  brands: {
    '*': {
      economy: [],
      middle: [],
    },
  },
  blacklistBrands: [],
  // Наценка в % на закупку netto: по уровню и (необязательно) по группе.
  markup: { default: 30, byLevel: { economy: 35, middle: 30, oe: 20 }, byGroup: {} },
  vatPercent: 23,
  // Приоритет поставщиков (для выбора при равной цене) и правило срочности.
  suppliers: ['intercars', 'profiauto', 'allegro'],
  // Стандартные комплекты: агент раскрывает «ТО», «ГРМ» и т.п. в список деталей.
  kits: {
    'ТО': ['масло моторное (объём по двигателю, допуск производителя)', 'фильтр масляный', 'фильтр воздушный', 'фильтр салона', 'пробка/шайба сливная'],
    'ГРМ': ['комплект ГРМ (ремень/цепь, ролики, натяжитель)', 'помпа — если приводится ремнём ГРМ', 'антифриз (объём, допуск)', 'болты/крепёж одноразовые — если требует производитель'],
    'Тормоза перед': ['колодки передние', 'диски передние', 'датчик износа — если предусмотрен'],
    'Тормоза зад': ['колодки задние', 'диски задние', 'датчик износа — если предусмотрен'],
  },
  // Вариант детали определяется ТОЛЬКО по VIN (без вопросов менеджеру).
  // Если ни один источник по VIN не дал ответа:
  //   'both' — поставить в wycenę оба варианта: «заказать оба, лишний вернуть» (по умолчанию);
  //   'ask'  — разрешить ассистенту задать менеджеру один вопрос (askManager должен быть true).
  unresolvedVariantPolicy: 'both',
  askManager: false,
  defaultLevel: 'middle',
};

export function getRules(workshopId) {
  const r = getDb().prepare('SELECT json FROM rules WHERE workshop_id = ?').get(workshopId);
  if (!r) return structuredClone(DEFAULT_RULES);
  return { ...structuredClone(DEFAULT_RULES), ...JSON.parse(r.json) };
}

export function saveRules(workshopId, rules) {
  getDb()
    .prepare(
      `INSERT INTO rules (workshop_id, json) VALUES (?, ?)
       ON CONFLICT(workshop_id) DO UPDATE SET json = excluded.json`
    )
    .run(workshopId, JSON.stringify(rules));
}

export function markupFor(rules, level, group) {
  const m = rules.markup || {};
  if (group && m.byGroup && m.byGroup[group] !== undefined) return Number(m.byGroup[group]);
  if (m.byLevel && m.byLevel[level] !== undefined) return Number(m.byLevel[level]);
  return Number(m.default ?? 30);
}

export function clientPrice(rules, purchaseNet, level, group) {
  if (purchaseNet === null || purchaseNet === undefined) return null;
  const pct = markupFor(rules, level, group);
  const net = Math.round(purchaseNet * (1 + pct / 100) * 100) / 100;
  const gross = Math.round(net * (1 + (rules.vatPercent ?? 23) / 100) * 100) / 100;
  return { net, gross, markupPercent: pct };
}
