// Складские документы (PZ/RW/PW) — общая логика для панели и интеграций поставщиков
import { one, run, tx, insert } from './db.js';
import { HttpError, nextNumber, round2, today } from './util.js';

/**
 * items: [{ product_id? | name, code, manufacturer, unit, supplier_sku, ean, supplier }, qty, price_net, sell_price? ]
 */
export function createStockDoc({ type, counterparty, ext_number, doc_date, note, items }, staffName) {
  if (!['PZ', 'RW', 'PW'].includes(type)) throw new HttpError(400, 'Тип документа: PZ, RW или PW');
  const rows = (items || []).filter((i) => Number(i.qty) > 0);
  if (!rows.length) throw new HttpError(400, 'Добавьте хотя бы одну позицию');
  return tx(() => {
    const docId = insert('stock_docs', {
      type, number: nextNumber(type), ext_number: ext_number || null, counterparty: counterparty || null,
      doc_date: doc_date || today(), note: note || null, created_by: staffName,
    });
    let net = 0;
    for (const it of rows) {
      const pid = Number(it.product_id) || findOrCreateProduct(it);
      const qty = Number(it.qty);
      const price = Number(it.price_net) || 0;
      run('INSERT INTO stock_doc_items (doc_id, product_id, qty, price_net) VALUES (?, ?, ?, ?)', docId, pid, qty, price);
      run('UPDATE products SET stock = stock + ? WHERE id = ?', (type === 'RW' ? -1 : 1) * qty, pid);
      if (type === 'PZ' && price > 0) run('UPDATE products SET purchase_price = ? WHERE id = ?', price, pid);
      // от поставщика: цену продажи ставим только если её ещё нет (свою цену не перетираем)
      if (type === 'PZ' && Number(it.sell_price) > 0) run(`UPDATE products SET sell_price = ? WHERE id = ? ${it.keep_sell ? 'AND sell_price <= 0' : ''}`, round2(it.sell_price), pid);
      net += qty * price;
    }
    run('UPDATE stock_docs SET total_net = ? WHERE id = ?', round2(net), docId);
    return docId;
  });
}

const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Ищем товар по SKU поставщика → EAN → индексу (без пробелов/точек); не нашли — создаём */
export function findOrCreateProduct(it) {
  if (it.supplier_sku) {
    const p = one('SELECT id FROM products WHERE supplier_sku = ?', it.supplier_sku);
    if (p) return p.id;
  }
  if (it.ean) {
    const p = one('SELECT id FROM products WHERE ean = ?', it.ean);
    if (p) { if (it.supplier_sku) run('UPDATE products SET supplier_sku = COALESCE(supplier_sku, ?) WHERE id = ?', it.supplier_sku, p.id); return p.id; }
  }
  const code = normCode(it.code);
  if (code) {
    const p = one(`SELECT id FROM products WHERE upper(replace(replace(replace(replace(code,' ',''),'.',''),'-',''),'/','')) = ?`, code);
    if (p) {
      run('UPDATE products SET supplier_sku = COALESCE(supplier_sku, ?), ean = COALESCE(ean, ?) WHERE id = ?', it.supplier_sku || null, it.ean || null, p.id);
      return p.id;
    }
  }
  if (!it.name) throw new HttpError(400, 'Для нового товара нужно название');
  return insert('products', {
    name: it.name, code: it.code || null, manufacturer: it.manufacturer || null, unit: it.unit || 'szt.',
    sell_price: round2(it.sell_price) || 0, purchase_price: round2(it.price_net) || 0,
    supplier_sku: it.supplier_sku || null, ean: it.ean || null, supplier: it.supplier || null,
  });
}
