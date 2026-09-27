import XLSX from 'xlsx';
import { one, run, tx, insert } from './db.js';
import { newCardNo, normPhone, normPlate, normVin, parseDate, parseNum } from './util.js';
import { earnFromCrm } from './loyalty.js';

/**
 * Универсальный импорт CSV/XLSX: тип файла определяется по колонкам.
 *  • заказы  — есть номер заказа/позиция (одна строка = одна позиция заказа)
 *  • авто    — есть номер/VIN, но нет позиций
 *  • клиенты — есть телефон/имя
 *  • товары  — есть название/индекс товара и цена, но нет телефона
 * Названия колонок: PL / RU / EN. Если в выгрузке колонка называется иначе — допишите в список.
 */
export const COLUMNS = {
  client_id: ['client_id', 'id klienta', 'klient id', 'id клиента', 'customer id'],
  phone: ['phone', 'telefon', 'tel', 'nr telefonu', 'numer telefonu', 'телефон', 'mobile', 'telefon komórkowy'],
  name: ['name', 'client', 'klient', 'imię i nazwisko', 'imie i nazwisko', 'nazwa klienta', 'dane klienta', 'właściciel', 'wlasciciel', 'клиент', 'имя', 'фио'],
  first_name: ['imię', 'imie', 'first name'],
  last_name: ['nazwisko', 'last name', 'фамилия'],
  company: ['firma', 'nazwa firmy', 'company'],
  nip: ['nip', 'tax id'],
  email: ['email', 'e-mail', 'mail', 'почта'],
  street: ['ulica', 'adres', 'street', 'address', 'адрес'],
  postcode: ['kod pocztowy', 'postcode', 'zip', 'индекс'],
  city: ['miasto', 'miejscowość', 'city', 'город'],
  plate: ['plate', 'nr rejestracyjny', 'numer rejestracyjny', 'rejestracja', 'госномер', 'номер авто'],
  vin: ['vin', 'nr vin'],
  make: ['make', 'marka', 'марка', 'marka / model', 'marka/model'],
  model: ['model', 'модель'],
  year: ['year', 'rok', 'rok produkcji', 'rok prod.', 'год'],
  capacity: ['pojemność', 'pojemnosc', 'объём', 'capacity'],
  fuel: ['silnik', 'paliwo', 'rodzaj paliwa', 'топливо', 'fuel'],
  power: ['moc', 'moc silnika', 'мощность', 'power'],
  order_no: ['order_no', 'nr zlecenia', 'numer zlecenia', 'zlecenie', 'nr dokumentu', 'номер заказа', 'заказ', 'заказ-наряд', 'order'],
  date: ['date', 'data', 'data zlecenia', 'data utworzenia', 'дата'],
  mileage: ['mileage', 'przebieg', 'пробег', 'km'],
  item: ['item', 'usługa', 'usluga', 'pozycja', 'opis', 'работа', 'позиция', 'услуга', 'description', 'nazwa zadania'],
  item_type: ['item_type', 'typ', 'rodzaj', 'тип'],
  mechanic: ['pracownik', 'mechanik', 'механик', 'mechanic'],
  qty: ['qty', 'ilość', 'ilosc', 'кол-во', 'количество', 'quantity'],
  price: ['price', 'cena', 'cena jedn.', 'wartość', 'wartosc', 'kwota', 'цена', 'сумма позиции', 'line total', 'przychód', 'cena sprzedaży'],
  cost: ['koszt', 'cena zakupu', 'себестоимость'],
  order_total: ['order_total', 'suma', 'razem', 'suma zlecenia', 'do zapłaty', 'итого', 'сумма заказа', 'total', 'razem brutto'],
  product: ['towar', 'nazwa towaru', 'product', 'товар'],
  product_code: ['kod towaru', 'indeks', 'index', 'kod', 'артикул', 'sku'],
  stock: ['stan', 'dostępne / stan', 'ilość na stanie', 'остаток', 'stock'],
  manufacturer: ['producent', 'производитель', 'manufacturer'],
};

const norm = (h) => String(h).toLowerCase().replace(/\s+/g, ' ').replace(/\*$/, '').trim();

function mapHeaders(headers) {
  const map = {};
  for (const [key, aliases] of Object.entries(COLUMNS)) {
    const found = headers.find((h) => aliases.includes(norm(h)));
    if (found !== undefined) map[key] = found;
  }
  if (map.make && map.model === undefined && /\/\s*model/i.test(map.make)) map.make_model = map.make;
  return map;
}

export function readRows(buffer) {
  // CSV читаем как текст (иначе «560,00» превращается в 56000); числа и даты разбираем сами
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const isOldXls = buffer[0] === 0xd0 && buffer[1] === 0xcf;
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, codepage: 65001, raw: !isZip && !isOldXls });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
}

function detect(map) {
  if ((map.order_no || map.item) && (map.item || map.price || map.order_total)) return 'orders';
  if ((map.plate || map.vin) && !map.item) return 'cars';
  if (map.phone || map.name || map.first_name || map.client_id) return 'customers';
  if ((map.product || map.product_code) && (map.price || map.stock)) return 'products';
  return null;
}

const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());

function findOrCreateCustomer(get, r, stats) {
  const phone = normPhone(get(r, 'phone'));
  const crmId = txt(get(r, 'client_id')) || null;
  let name = txt(get(r, 'name')) || [txt(get(r, 'first_name')), txt(get(r, 'last_name'))].filter(Boolean).join(' ') || null;
  if (name && /^no name$/i.test(name)) name = null;
  let c = (phone && one('SELECT * FROM customers WHERE phone = ?', phone)) || (crmId && one('SELECT * FROM customers WHERE crm_id = ?', crmId));
  if (!c && !phone && !crmId && name) {
    const same = one('SELECT COUNT(*) n, MIN(id) id FROM customers WHERE name = ?', name);
    if (same.n === 1) c = one('SELECT * FROM customers WHERE id = ?', same.id);
  }
  const fields = {
    name, email: txt(get(r, 'email')) || null, company: txt(get(r, 'company')) || null, nip: txt(get(r, 'nip')) || null,
    street: txt(get(r, 'street')) || null, postcode: txt(get(r, 'postcode')) || null, city: txt(get(r, 'city')) || null,
  };
  if (!c) {
    if (!phone && !crmId && !name) return null;
    const id = insert('customers', { phone, crm_id: crmId, card_no: newCardNo(), ...fields });
    stats.newCustomers++;
    c = one('SELECT * FROM customers WHERE id = ?', id);
  } else {
    run(
      `UPDATE customers SET name = COALESCE(?, name), email = COALESCE(?, email), company = COALESCE(?, company), nip = COALESCE(?, nip),
       street = COALESCE(?, street), postcode = COALESCE(?, postcode), city = COALESCE(?, city), crm_id = COALESCE(crm_id, ?) WHERE id = ?`,
      fields.name, fields.email, fields.company, fields.nip, fields.street, fields.postcode, fields.city, crmId, c.id,
    );
  }
  return c;
}

function findOrCreateCar(get, r, customerId) {
  const vin = normVin(get(r, 'vin'));
  const plate = normPlate(get(r, 'plate'));
  const key = vin || plate;
  if (!key) return null;
  let make = txt(get(r, 'make')) || null;
  let model = txt(get(r, 'model')) || null;
  if (make && !model && (/\//.test(make) || /\s/.test(make))) {
    // «AUDI Q7 TDI MR'08 E4 4L» → марка AUDI, модель — остальное
    const [m, ...rest] = make.split(/\s+/);
    make = m; model = rest.join(' ') || null;
  }
  const year = txt(get(r, 'year')).slice(0, 4) || null;
  const mileage = parseNum(get(r, 'mileage'));
  const power = parseNum(get(r, 'power'));
  const capacity = parseNum(get(r, 'capacity'));
  const fuel = txt(get(r, 'fuel')) || null;
  let car = one(
    `SELECT * FROM cars WHERE (car_key = ? OR (? <> '' AND vin = ?) OR (? <> '' AND plate = ?))
     ORDER BY (customer_id = ?) DESC, (vin = ?) DESC LIMIT 1`,
    key, vin, vin, plate, plate, customerId ?? -1, vin,
  );
  if (!car) {
    const id = insert('cars', {
      customer_id: customerId, car_key: key, plate: plate || null, vin: vin || null, make, model, year,
      last_mileage: mileage, power_kw: power, capacity, fuel,
    });
    return { id, created: true };
  }
  run(
    `UPDATE cars SET customer_id = COALESCE(?, customer_id), car_key = CASE WHEN ? <> '' THEN ? ELSE car_key END,
     plate = COALESCE(?, plate), vin = COALESCE(?, vin), make = COALESCE(?, make), model = COALESCE(?, model), year = COALESCE(?, year),
     power_kw = COALESCE(?, power_kw), capacity = COALESCE(?, capacity), fuel = COALESCE(?, fuel),
     last_mileage = MAX(COALESCE(last_mileage, 0), COALESCE(?, 0)) WHERE id = ?`,
    customerId, vin, vin, plate || null, vin || null, make, model, year, power, capacity, fuel, mileage, car.id,
  );
  return { id: car.id, created: false };
}

export function importRows(rows, forcedType = null) {
  const stats = { type: null, rows: rows.length, customers: 0, newCustomers: 0, cars: 0, visits: 0, items: 0, products: 0, pointsAwarded: 0, skipped: 0, warnings: [] };
  if (!rows.length) return { ...stats, warnings: ['Файл пустой'] };
  const map = mapHeaders(Object.keys(rows[0]));
  const type = forcedType || detect(map);
  stats.type = type;
  stats.columns = map;
  if (!type) throw new Error('Не удалось понять, что в файле: нужны колонки клиента (телефон/имя), авто (номер/VIN), заказа (номер заказа + позиция) или товара (название + цена).');
  const get = (r, k) => (map[k] !== undefined ? r[map[k]] : '');
  const warn = (m) => { stats.skipped++; if (stats.warnings.length < 20) stats.warnings.push(m); };

  const doneStatus = one('SELECT id FROM order_statuses WHERE is_final = 1 ORDER BY pos LIMIT 1')?.id;
  const seenC = new Set(), seenCar = new Set(), visits = new Map();

  tx(() => {
    rows.forEach((r, i) => {
      const line = i + 2;
      if (type === 'products') {
        const name = txt(get(r, 'product')) || txt(get(r, 'item')) || txt(get(r, 'name'));
        if (!name) return warn(`Строка ${line}: нет названия товара`);
        const code = txt(get(r, 'product_code')) || null;
        const ex = code ? one('SELECT id FROM products WHERE code = ?', code) : one('SELECT id FROM products WHERE name = ?', name);
        const data = { name, code, manufacturer: txt(get(r, 'manufacturer')) || null, sell_price: parseNum(get(r, 'price')) ?? 0, purchase_price: parseNum(get(r, 'cost')) ?? 0 };
        const stock = parseNum(get(r, 'stock'));
        if (ex) run('UPDATE products SET name = ?, manufacturer = COALESCE(?, manufacturer), sell_price = ?, purchase_price = ?, stock = COALESCE(?, stock) WHERE id = ?',
          data.name, data.manufacturer, data.sell_price, data.purchase_price, stock, ex.id);
        else insert('products', { ...data, stock: stock ?? 0 });
        stats.products++;
        return;
      }

      const c = findOrCreateCustomer(get, r, stats);
      if (type === 'customers') {
        if (!c) return warn(`Строка ${line}: нет телефона и имени — пропущена`);
        if (!seenC.has(c.id)) { seenC.add(c.id); stats.customers++; }
        return;
      }
      if (c && !seenC.has(c.id)) { seenC.add(c.id); stats.customers++; }
      const car = findOrCreateCar(get, r, c?.id ?? null);
      if (car && !seenCar.has(car.id)) { seenCar.add(car.id); stats.cars++; }
      if (type === 'cars') {
        if (!car) warn(`Строка ${line}: нет номера и VIN — пропущена`);
        return;
      }

      // ── заказы ──
      if (!c) return warn(`Строка ${line}: нет клиента — пропущена`);
      const date = parseDate(get(r, 'date'));
      const orderNo = txt(get(r, 'order_no')) || `IMP ${date || 'bez-daty'} ${car?.id || c.id}`;
      const mileage = parseNum(get(r, 'mileage'));
      let v = one('SELECT * FROM orders WHERE number = ?', orderNo);
      const orderTotal = parseNum(get(r, 'order_total'));
      if (!v) {
        const id = insert('orders', {
          kind: 'order', number: orderNo, customer_id: c.id, car_id: car?.id ?? null, status_id: doneStatus, mileage,
          source: 'import', created_at: date ? `${date} 09:00:00` : undefined, closed_at: date ? `${date} 18:00:00` : null,
        });
        v = one('SELECT * FROM orders WHERE id = ?', id);
      } else if (!visits.has(v.id) && v.source !== 'import') {
        // заказ уже ведётся в нашей CRM — позиции не трогаем
        visits.set(v.id, { skip: true });
      }
      if (!visits.has(v.id)) {
        run('DELETE FROM order_items WHERE order_id = ?', v.id); // повторная выгрузка не дублирует позиции
        run('UPDATE orders SET customer_id = ?, car_id = COALESCE(?, car_id), mileage = COALESCE(?, mileage) WHERE id = ?', c.id, car?.id ?? null, mileage, v.id);
        visits.set(v.id, { sum: 0, total: orderTotal, customerId: c.id, orderNo, date });
        stats.visits++;
      }
      const st = visits.get(v.id);
      if (st.skip) return;
      if (orderTotal !== null) st.total = orderTotal;
      const item = txt(get(r, 'item')) || txt(get(r, 'product'));
      if (item) {
        const qty = parseNum(get(r, 'qty')) ?? 1;
        const price = parseNum(get(r, 'price'));
        const kindRaw = txt(get(r, 'item_type')).toLowerCase();
        const kind = /tow|част|part|część|czesc/.test(kindRaw) || (!!txt(get(r, 'product_code')) && !/zadan|usł|рабо/.test(kindRaw)) ? 'part' : 'labor';
        const mech = txt(get(r, 'mechanic'));
        const mechanic = mech ? one('SELECT id FROM staff WHERE name = ?', mech)?.id : null;
        insert('order_items', {
          order_id: v.id, kind, name: item, code: txt(get(r, 'product_code')) || null, qty,
          price: price ?? 0, cost: parseNum(get(r, 'cost')) ?? 0, mechanic_id: mechanic ?? null,
        });
        if (price !== null) st.sum += price * qty;
        stats.items++;
      }
    });

    for (const [orderId, st] of visits) {
      if (st.skip) continue;
      const items = one('SELECT COALESCE(SUM(qty*price),0) s, COALESCE(SUM(CASE WHEN kind=\'part\' THEN qty*cost ELSE 0 END),0) c FROM order_items WHERE order_id = ?', orderId);
      const total = st.total ?? Math.round(items.s * 100) / 100;
      run('UPDATE orders SET total = ?, total_net = ROUND(? / 1.23, 2), cost = ?, paid = ? WHERE id = ?', total, total, items.c, total, orderId);
      stats.pointsAwarded += earnFromCrm(st.customerId, st.orderNo, total, st.date);
    }
  });
  return stats;
}

export const TEMPLATE_CSV =
  'phone;name;email;plate;vin;make;model;year;order_no;date;mileage;item;item_type;qty;price;order_total\n' +
  '+48600111222;Jan Kowalski;jan@example.com;WA 12345;WBA8E9C50GK123456;BMW;320d;2016;ZL/2026/0412;2026-09-20;184500;Wymiana oleju i filtra oleju;usługa;1;120;560\n' +
  '+48600111222;Jan Kowalski;jan@example.com;WA 12345;WBA8E9C50GK123456;BMW;320d;2016;ZL/2026/0412;2026-09-20;184500;Olej Castrol 5W30 5L;część;1;240;560\n';
