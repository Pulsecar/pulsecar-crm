// Демо-сервис с вымышленными данными — для проверки приложения «Pulsecar CRM» в App Store / Google Play
// (рецензенты входят в отдельный сервис-филиал и не видят настоящих клиентов).
// Запуск на сервере: docker compose exec -T panel node tools/seed-demo.js DEMO
//   — создаёт сервис DEMO (если его нет) и заполняет его заказами, выценами и записями в терминарзе на ближайшие дни.
//   Повторный запуск обновляет даты (удаляются только записи, созданные этим скриптом: mw_id «demo:…»).
// Сотрудника для рецензентов создайте в CRM: Владелец → сервис DEMO → Сотрудники (логин и пароль задаёте вы).
import { mainDb, withDb, one, all, run, insert } from '../src/db.js';
import { branchDb, createBranch } from '../src/branches.js';
import { createOrder, addItem, recalc } from '../src/orders.js';
import { hashPassword, newCardNo } from '../src/util.js';

const code = String(process.argv[2] || '').toUpperCase();
if (!/^DEMO[A-Z0-9]{0,4}$/.test(code)) { console.error('Код демо-сервиса должен начинаться с DEMO (например DEMO)'); process.exit(1); }
// --staff login:password — только для локальной проверки (на сервере сотрудника создают в CRM)
const staffArg = process.argv.find((a) => a.startsWith('--staff='))?.slice(8);

if (!mainDb.prepare('SELECT 1 FROM branches WHERE code = ?').get(code)) {
  const owner = mainDb.prepare("SELECT * FROM staff WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1").get();
  createBranch({ name: 'Pulsecar Demo', code, address: 'ul. Przykładowa 1, Warszawa' }, owner);
  console.log('Создан сервис', code);
}
const d = branchDb(code);
const pad = (n) => String(n).padStart(2, '0');
const day = (off) => { const x = new Date(); x.setDate(x.getDate() + off); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };

withDb(d, () => {
  // убираем прежние демо-данные (только созданные этим скриптом)
  for (const t of ['appointments', 'order_comments', 'order_items', 'payments', 'orders', 'cars', 'customers'])
    run(`DELETE FROM ${t} WHERE mw_id LIKE 'demo:%'` + (t === 'order_items' || t === 'order_comments' || t === 'payments' ? ` OR order_id IN (SELECT id FROM orders WHERE mw_id LIKE 'demo:%')` : ''));
  run("DELETE FROM appointments WHERE order_id IN (SELECT id FROM orders WHERE mw_id LIKE 'demo:%')");

  if (staffArg) {
    const [login, pass] = staffArg.split(':');
    const ex = one('SELECT id FROM staff WHERE login = ?', login);
    if (ex) run('UPDATE staff SET pass_hash = ?, active = 1 WHERE id = ?', hashPassword(pass), ex.id);
    else insert('staff', { login, name: 'Demo Kierownik', role: 'admin', pass_hash: hashPassword(pass) });
  }
  const mech = all("SELECT id FROM staff WHERE active = 1 ORDER BY id").map((s) => s.id);
  const stations = all('SELECT id FROM stations WHERE active = 1 ORDER BY pos, id').map((s) => s.id);
  const stOrder = all("SELECT id, name, is_final FROM order_statuses WHERE COALESCE(scope,'all') IN ('order','all') ORDER BY pos");
  const stOpen = stOrder.filter((s) => !s.is_final);

  const people = [
    ['Jan Kowalski', '+48 600 100 201', 'Volkswagen', 'Golf VII 1.4 TSI', 'WE 4K21A', 2016, 'WVWZZZAUZGW123456', 148200],
    ['Anna Nowak', '+48 601 220 311', 'Toyota', 'Corolla 1.8 Hybrid', 'WB 7731M', 2020, 'SB1Z93BE10E012345', 61300],
    ['Piotr Wiśniewski', '+48 602 330 412', 'Skoda', 'Octavia III 2.0 TDI', 'WX 55210', 2017, 'TMBJJ7NE6H0123456', 231900],
    ['Katarzyna Wójcik', '+48 603 440 513', 'BMW', '320d F31', 'WI 9083K', 2015, 'WBA8G11000K123456', 189400],
    ['Tomasz Kamiński', '+48 604 550 614', 'Ford', 'Focus 1.5 EcoBoost', 'WN 3312P', 2018, 'WF0NXXGCHNJ123456', 97600],
    ['Magdalena Lewandowska', '+48 605 660 715', 'Opel', 'Astra K 1.6 CDTI', 'WY 2471C', 2019, 'W0VBD6EN1KG123456', 112800],
    ['Firma Transbud Sp. z o.o.', '+48 22 100 20 30', 'Renault', 'Master 2.3 dCi', 'WZ 8820T', 2021, 'VF1MA000065123456', 176300],
    ['Michał Zieliński', '+48 606 770 816', 'Audi', 'A4 B9 2.0 TFSI', 'WE 1H770', 2019, 'WAUZZZF41KA123456', 84100],
  ];
  const jobs = [
    { complaint: 'Wymiana oleju i filtrów, przegląd przed wyjazdem.', items: [['labor', 'Wymiana oleju silnikowego z filtrem', 1, 120], ['labor', 'Wymiana filtra powietrza i kabinowego', 1, 60], ['part', 'Olej 5W-30 Castrol Edge', 5, 49], ['part', 'Filtr oleju MANN W 712/95', 1, 39]] },
    { complaint: 'Stuki z przodu na nierównościach, ściąga w prawo.', items: [['labor', 'Diagnostyka zawieszenia', 1, 100], ['labor', 'Wymiana łączników stabilizatora (2 szt.)', 1, 140], ['labor', 'Ustawienie geometrii kół', 1, 180], ['part', 'Łącznik stabilizatora Lemförder', 2, 85]] },
    { complaint: 'Klimatyzacja słabo chłodzi.', items: [['labor', 'Serwis klimatyzacji z odgrzybianiem', 1, 250], ['part', 'Czynnik R1234yf', 0.5, 320]] },
    { complaint: 'Piszczą hamulce, pulsuje pedał.', items: [['labor', 'Wymiana tarcz i klocków – oś przednia', 1, 220], ['part', 'Tarcza hamulcowa Brembo', 2, 210], ['part', 'Klocki hamulcowe Brembo', 1, 180]] },
    { complaint: 'Kontrolka silnika, nierówna praca na zimnym.', items: [['labor', 'Diagnostyka komputerowa', 1, 150], ['labor', 'Wymiana świec zapłonowych', 1, 160], ['part', 'Świeca NGK Laser Platinum', 4, 59]] },
    { complaint: 'Wymiana rozrządu wg przebiegu.', items: [['labor', 'Wymiana kompletu rozrządu z pompą wody', 1, 900], ['part', 'Zestaw rozrządu z pompą Contitech', 1, 1150]] },
    { complaint: 'Przegląd floty – auto dostawcze.', items: [['labor', 'Przegląd okresowy', 1, 300], ['labor', 'Wymiana oleju skrzyni biegów', 1, 180], ['part', 'Olej przekładniowy 75W-80', 3, 65]] },
    { complaint: 'Wymiana opon na zimowe + wyważenie.', items: [['labor', 'Wymiana kół z wyważeniem (4 szt.)', 1, 160], ['labor', 'Przechowanie opon – sezon', 1, 120]] },
  ];
  const comments = ['Klient prosi o telefon przed wymianą dodatkowych części.', 'Części zamówione, dostawa jutro rano.', 'Auto do odbioru po 16:00.', 'Klient czeka na miejscu.'];

  people.forEach(([name, phone, make, model, plate, year, vin, km], i) => {
    const c = insert('customers', { card_no: newCardNo(), name, phone: phone.replace(/\s/g, ''), mw_id: `demo:c${i}`, ...(name.startsWith('Firma') ? { kind: 'company', company: name } : {}) });
    const car = insert('cars', { car_key: vin, customer_id: c, make, model, plate: plate.replace(/\s/g, ''), year, vin, last_mileage: km, mw_id: `demo:v${i}` });
    const j = jobs[i % jobs.length];
    const st = stOpen[Math.min(i % 3, stOpen.length - 1)];
    const id = createOrder({ customer_id: c, car_id: car, mileage: km, complaint: j.complaint, status_id: st?.id, mechanic_id: mech[i % mech.length] }, 'Demo');
    run('UPDATE orders SET mw_id = ? WHERE id = ?', `demo:o${i}`, id);
    j.items.forEach(([k, n, q, p], x) => addItem(id, { kind: k, name: n, qty: q, price: p, done: i < 2 && k === 'labor' && x === 0 ? 1 : 0 }));
    recalc(id);
    if (i % 2 === 0) insert('order_comments', { order_id: id, staff: 'Demo Kierownik', text: comments[(i / 2) % comments.length] });
    // терминарз: сегодня и ближайшие дни
    const off = i < 5 ? 0 : i - 4;
    const hh = 8 + (i % 5) * 2;
    insert('appointments', { order_id: id, customer_id: c, car_id: car, station_id: stations[i % Math.max(1, stations.length)], start_at: `${day(off)} ${pad(hh)}:00`, duration_min: 90 + (i % 3) * 30, status: 'planned', title: `${make} ${model}`, mw_id: `demo:a${i}` });
  });
  // две выцены
  [0, 3].forEach((i, k) => {
    const id = createOrder({ kind: 'quote', customer_id: one('SELECT id FROM customers WHERE mw_id = ?', `demo:c${i}`).id, car_id: one('SELECT id FROM cars WHERE mw_id = ?', `demo:v${i}`).id, complaint: k ? 'Wycena naprawy sprzęgła' : 'Wycena wymiany amortyzatorów' }, 'Demo');
    run('UPDATE orders SET mw_id = ? WHERE id = ?', `demo:q${k}`, id);
    (k ? [['labor', 'Wymiana sprzęgła z kołem dwumasowym', 1, 1200], ['part', 'Zestaw sprzęgła LuK z kołem dwumasowym', 1, 2890]] : [['labor', 'Wymiana amortyzatorów – oś tylna', 1, 260], ['part', 'Amortyzator Bilstein B4', 2, 340]])
      .forEach(([kk, n, q, p]) => addItem(id, { kind: kk, name: n, qty: q, price: p }));
    recalc(id);
  });
  console.log('Демо-данные готовы:', one("SELECT COUNT(*) n FROM orders WHERE mw_id LIKE 'demo:%'").n, 'заказов/выцен,', one("SELECT COUNT(*) n FROM appointments WHERE mw_id LIKE 'demo:%'").n, 'записей');
});
