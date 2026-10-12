// История wycen автосервиса — база знаний ассистента.
// CRM присылает сюда прошлые позиции (импорт) и подтверждения установки (verified),
// возвраты (returned). Персональные данные клиентов (имя, телефон) сюда НЕ передаются.
import { getDb, normNumber } from '../db.js';

export function importHistory(workshopId, rows) {
  const d = getDb();
  const ins = d.prepare(
    `INSERT INTO history (workshop_id, source_id, wycena_id, vin, make, model, engine_code, year, job_text, part_name,
       oe_number, oe_norm, brand, article_number, article_norm, supplier, price_net, sale_net, verified, returned, note, search_text, created_at)
     VALUES (@ws, @source_id, @wycena_id, @vin, @make, @model, @engine_code, @year, @job_text, @part_name,
       @oe_number, @oe_norm, @brand, @article_number, @article_norm, @supplier, @price_net, @sale_net, @verified, @returned, @note, @search_text,
       COALESCE(@created_at, datetime('now')))
     ON CONFLICT(workshop_id, source_id) DO UPDATE SET
       verified = MAX(history.verified, excluded.verified), returned = MAX(history.returned, excluded.returned),
       oe_number = COALESCE(excluded.oe_number, history.oe_number), oe_norm = COALESCE(excluded.oe_norm, history.oe_norm),
       note = COALESCE(excluded.note, history.note)`
  );
  const tx = d.transaction((list) => {
    for (const r of list)
      ins.run({
        ws: workshopId,
        source_id: r.source_id ?? null,
        wycena_id: r.wycena_id ?? null,
        vin: r.vin ? String(r.vin).toUpperCase().replace(/[^A-Z0-9]/g, '') : null,
        make: r.make ?? null,
        model: r.model ?? null,
        engine_code: r.engine_code ? String(r.engine_code).toUpperCase() : null,
        year: r.year ? Number(r.year) : null,
        job_text: r.job_text ?? null,
        part_name: r.part_name ?? null,
        oe_number: r.oe_number ?? null,
        oe_norm: normNumber(r.oe_number) || null,
        brand: r.brand ?? null,
        article_number: r.article_number ?? null,
        article_norm: normNumber(r.article_number) || null,
        supplier: r.supplier ?? null,
        price_net: r.price_net ?? null,
        sale_net: r.sale_net ?? null,
        verified: r.verified ? 1 : 0,
        returned: r.returned ? 1 : 0,
        note: r.note ?? null,
        search_text: `${r.part_name || ''} ${r.job_text || ''} ${r.brand || ''}`.toLowerCase(),
        created_at: r.created_at ?? null,
      });
  });
  tx(rows);
  return rows.length;
}

// Поиск похожего опыта: тот же VIN > тот же код двигателя/модель > совпадение по OE.
export function searchHistory(workshopId, { vin, engine_code, make, model, year, part_query, oe_number, limit = 40 }) {
  const d = getDb();
  const out = { sameVin: [], sameEngineOrModel: [], sameOe: [] };
  const words = String(part_query || '')
    .toLowerCase()
    .split(/[^a-zа-яё0-9ąćęłńóśźż]+/i)
    .filter((w) => w.length >= 3)
    .slice(0, 4);
  const textFilter = words.length ? ' AND (' + words.map(() => 'search_text LIKE ?').join(' OR ') + ')' : '';
  const textParams = words.map((w) => `%${w}%`);
  const cols = 'vin, make, model, engine_code, year, job_text, part_name, oe_number, brand, article_number, supplier, price_net, sale_net, verified, returned, note, created_at';

  if (vin) {
    out.sameVin = d
      .prepare(`SELECT ${cols} FROM history WHERE workshop_id = ? AND vin = ?${textFilter} ORDER BY verified DESC, created_at DESC LIMIT ?`)
      .all(workshopId, String(vin).toUpperCase(), ...textParams, limit);
  }
  if (engine_code || (make && model)) {
    const cond = engine_code ? 'engine_code = ?' : 'lower(make) = lower(?) AND lower(model) LIKE lower(?)';
    const p = engine_code ? [String(engine_code).toUpperCase()] : [make, `%${model}%`];
    const yearCond = year ? ' AND (year IS NULL OR ABS(year - ?) <= 3)' : '';
    const yp = year ? [Number(year)] : [];
    out.sameEngineOrModel = d
      .prepare(`SELECT ${cols} FROM history WHERE workshop_id = ? AND ${cond}${yearCond}${textFilter} ORDER BY verified DESC, returned ASC, created_at DESC LIMIT ?`)
      .all(workshopId, ...p, ...yp, ...textParams, limit);
  }
  if (oe_number) {
    out.sameOe = d
      .prepare(`SELECT ${cols} FROM history WHERE workshop_id = ? AND oe_norm = ? ORDER BY verified DESC, created_at DESC LIMIT ?`)
      .all(workshopId, normNumber(oe_number), limit);
  }
  out.legend = 'verified=1 — номер подтверждён установкой; returned=1 — деталь вернули (НЕ подошла), использовать как предупреждение.';
  return out;
}

export function historyStats(workshopId) {
  return getDb()
    .prepare('SELECT COUNT(*) AS rows, SUM(verified) AS verified, SUM(returned) AS returned, COUNT(DISTINCT vin) AS vins FROM history WHERE workshop_id = ?')
    .get(workshopId);
}
