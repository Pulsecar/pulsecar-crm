// Дубли авто: объединение существующих и запрет новых
import { rmSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const DB = './data/test-cars-dedup.db';
mkdirSync('./data', { recursive: true });
rmSync(DB, { force: true });
process.env.DB_PATH = DB;
const { one, all, run, insert } = await import('../src/db.js');
const { dedupAllCars, findDupCar } = await import('../src/car-dedup.js');
const { createCar } = await import('../src/crm.js');

const cust = insert('customers', { name: 'Maksym', phone: '+48730509577', card_no: 'T1' });
const V = 'WVGZZZ5NZKM062837';
const a = insert('cars', { car_key: V, vin: V, make: 'Volkswagen', model: 'Tiguan', year: '2019' });
const b = insert('cars', { car_key: V, vin: V, plate: 'WWL8162X', make: 'VOLKSWAGEN', model: 'Tiguan Allspace 2.0 TDI', capacity: 1968, fuel: 'Diesel', power_kw: 110, customer_id: cust });
const c = insert('cars', { car_key: V, vin: V, plate: 'WWL8162X', make: 'Volkswagen', model: 'Tiguan', capacity: 2, last_mileage: 150000, customer_id: cust });
const p1 = insert('cars', { car_key: 'WA12345', plate: 'WA12345', make: 'Audi' });
const p2 = insert('cars', { car_key: 'WA12345', plate: 'WA12345', vin: 'WAUZZZ8V0KA000001', make: 'Audi', model: 'A3' });
const x1 = insert('cars', { car_key: 'WB1', plate: 'WB1', vin: 'AAAAAAAAAAAAAAAA1' });
const x2 = insert('cars', { car_key: 'WB1', plate: 'WB1', vin: 'AAAAAAAAAAAAAAAA2' }); // другой VIN под тем же номером — не дубль
const o1 = insert('orders', { kind: 'order', number: 'ZL T/1', car_id: a, customer_id: cust });
const o2 = insert('orders', { kind: 'order', number: 'ZL T/2', car_id: c, customer_id: cust });

const removed = dedupAllCars('test');
assert.equal(removed, 3);
const vw = all('SELECT * FROM cars WHERE vin = ?', V);
assert.equal(vw.length, 1);
assert.equal(vw[0].id, b, 'остаётся самая полная карточка с владельцем');
assert.equal(vw[0].last_mileage, 150000, 'пробег взят с дубля');
assert.equal(one('SELECT car_id FROM orders WHERE id = ?', o1).car_id, b);
assert.equal(one('SELECT car_id FROM orders WHERE id = ?', o2).car_id, b);
const audi = all("SELECT * FROM cars WHERE plate = 'WA12345'");
assert.equal(audi.length, 1); assert.equal(audi[0].vin, 'WAUZZZ8V0KA000001'); assert.equal(audi[0].model, 'A3');
assert.equal(all("SELECT id FROM cars WHERE plate = 'WB1'").length, 2);
assert.ok(one("SELECT 1 FROM activity WHERE entity = 'car' AND action = 'merge' AND entity_id = ?", b));

// новые дубли не создаются
assert.equal(findDupCar({ vin: V }).id, b);
assert.equal(findDupCar({ plate: 'WWL8162X' }).id, b);
assert.equal(findDupCar({ plate: 'WWL8162X', vin: 'ZZZZZZZZZZZZZZZZ1' }), null, 'тот же номер, другой VIN');
assert.equal(createCar({ vin: V.toLowerCase() }), b, 'внутренние вызовы получают существующую карточку');
assert.throws(() => createCar({ plate: 'wwl 8162x' }, { strict: true }), (e) => e.status === 409 && e.data.car_id === b);
run('DELETE FROM orders');
rmSync(DB, { force: true });
console.log('✓ дубли авто: объединение по VIN и номеру, заказы перенесены, новые дубли запрещены');
process.exit(0);
