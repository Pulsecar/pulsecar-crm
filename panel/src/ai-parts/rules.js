// Правила подбора сервиса: предпочитаемые бренды по уровням (и группам деталей), чёрный список брендов,
// стандартные комплекты работ, общие указания ассистенту. Хранятся в базе сервиса (у каждого сервиса свои).
import { all, one, run, insert, getSetting, setSetting, tx } from '../db.js';
import { normBrand } from './ic.js';

export const GROUPS = [
  ['timing_kit', 'Комплект ГРМ'], ['water_pump', 'Помпа'], ['engine_oil', 'Моторное масло'], ['oil_filter', 'Масляный фильтр'], ['air_filter', 'Воздушный фильтр'],
  ['cabin_filter', 'Салонный фильтр'], ['fuel_filter', 'Топливный фильтр'], ['spark_plug', 'Свечи зажигания'], ['glow_plug', 'Свечи накала'],
  ['brake_pads', 'Тормозные колодки'], ['brake_discs', 'Тормозные диски'], ['shock_absorber', 'Амортизаторы'], ['control_arm', 'Рычаги / сайлентблоки'],
  ['stabilizer_link', 'Стойки стабилизатора'], ['wheel_bearing', 'Ступичные подшипники'], ['clutch_kit', 'Сцепление'], ['aux_belt', 'Поликлиновый ремень'],
  ['battery', 'Аккумулятор'], ['wipers', 'Дворники'], ['bulbs', 'Лампы'],
];
export const LEVELS = ['eco', 'mid', 'oe'];

export function getRules() {
  return {
    brands: all("SELECT id, group_key, level, value, draft, source FROM ai_rules WHERE kind = 'brand' ORDER BY level, group_key, id"),
    blacklist: all("SELECT id, value, draft FROM ai_rules WHERE kind = 'blacklist_brand' ORDER BY value"),
    kits: all('SELECT id, name, aliases, fuel, items, draft, source FROM ai_kits ORDER BY name'),
    notes: getSetting('ai_parts_notes') || '',
  };
}

/** Сохранить все правила разом (что прислали — то и стало правилами) */
export function saveRules(b) {
  tx(() => {
    run("DELETE FROM ai_rules WHERE kind IN ('brand','blacklist_brand')");
    for (const r of (b.brands || []).slice(0, 300)) {
      const value = String(r.value || '').trim().slice(0, 300);
      if (!value || !LEVELS.includes(r.level)) continue;
      insert('ai_rules', { kind: 'brand', group_key: String(r.group_key || '').trim().slice(0, 60) || null, level: r.level, value, draft: r.draft ? 1 : 0, source: r.source || 'admin' });
    }
    for (const r of (b.blacklist || []).slice(0, 200)) {
      const value = String(r.value || '').trim().slice(0, 80);
      if (value) insert('ai_rules', { kind: 'blacklist_brand', value, draft: r.draft ? 1 : 0, source: 'admin' });
    }
    run('DELETE FROM ai_kits');
    for (const k of (b.kits || []).slice(0, 100)) {
      const name = String(k.name || '').trim().slice(0, 80);
      if (name) insert('ai_kits', { name, aliases: String(k.aliases || '').slice(0, 200) || null, fuel: ['petrol', 'diesel'].includes(k.fuel) ? k.fuel : null,
        items: String(k.items || '').slice(0, 1000), draft: k.draft ? 1 : 0, source: k.source || 'admin' });
    }
    if (b.notes !== undefined) setSetting('ai_parts_notes', String(b.notes || '').slice(0, 3000));
  });
}

/** Предпочитаемые бренды для уровня и группы (сначала правила группы, потом общие) */
export function preferredBrands(level, groupKey) {
  const rows = all("SELECT group_key, value FROM ai_rules WHERE kind = 'brand' AND draft = 0 AND level = ?", level);
  const pick = (g) => rows.filter((r) => (r.group_key || '') === g).flatMap((r) => r.value.split(/[,;]/)).map((x) => normBrand(x)).filter(Boolean);
  const own = groupKey ? pick(groupKey) : [];
  return own.length ? own : pick('');
}
export const blacklist = () => new Set(all("SELECT value FROM ai_rules WHERE kind = 'blacklist_brand' AND draft = 0").map((r) => normBrand(r.value)));

/** Подсказки из истории: какие бренды сервис реально ставил (по названиям и кодам позиций), сколько раз и по какой средней цене */
const KNOWN = ['Bosch', 'Mann', 'Mann-Filter', 'Filtron', 'Mahle', 'Knecht', 'Hengst', 'Purflux', 'UFI', 'Febi', 'Febi Bilstein', 'SWAG', 'Lemförder', 'Lemforder', 'TRW', 'ATE', 'Brembo', 'Ferodo',
  'Textar', 'Zimmermann', 'Delphi', 'Bilstein', 'Sachs', 'KYB', 'Kayaba', 'Monroe', 'SKF', 'INA', 'LuK', 'FAG', 'Gates', 'Contitech', 'Dayco', 'NGK', 'Denso', 'Beru', 'Champion', 'Valeo', 'Hella',
  'Meyle', 'Moog', 'Maxgear', 'Hepu', 'Graf', 'Aisin', 'Blue Print', 'Japanparts', 'Herth+Buss', 'Ridex', 'Stark', 'Castrol', 'Mobil', 'Shell', 'Motul', 'Total', 'Elf', 'Liqui Moly', 'Orlen', 'Comma',
  'Ravenol', 'Varta', 'Exide', 'Osram', 'Philips', 'Corteco', 'Elring', 'Victor Reinz', 'Ajusa', 'Nissens', 'NRF', 'Pierburg', 'Continental', 'Lucas', 'Remsa', 'Jurid', 'Pagid', 'Metelli', 'Cifam', 'Vaico', 'Topran', 'Febest', 'Optimal', 'Ruville', 'Dolz', 'Airtex', 'Magneti Marelli'];
export function suggestFromHistory() {
  const items = all("SELECT name, code, price FROM order_items WHERE kind = 'part' AND name IS NOT NULL ORDER BY id DESC LIMIT 20000");
  const cnt = new Map();
  for (const it of items) {
    const txt = ' ' + String(it.name).toUpperCase().replace(/[^A-Z0-9+ -]/g, ' ') + ' ';
    const b = KNOWN.find((k) => txt.includes(' ' + k.toUpperCase() + ' '));
    if (!b) continue;
    const key = normBrand(b);
    const c = cnt.get(key) || { brand: b, n: 0, sum: 0 };
    c.n++; c.sum += Number(it.price) || 0;
    cnt.set(key, c);
  }
  return [...cnt.values()].sort((a, b) => b.n - a.n).slice(0, 40).map((c) => ({ brand: c.brand, count: c.n, avgPrice: c.n ? Math.round(c.sum / c.n) : 0 }));
}
