import type { Me } from './account';

// Пример данных для режима «Демо» (превью и презентации). Не реальные клиенты.
export const DEMO_SESSION = { token: 'demo', qrSecret: 'demo-secret-not-valid-in-service', cardNo: 'PC12345678', demo: true };

export const DEMO_ME: Me = {
  serverTime: Date.now(),
  customer: { name: 'Jan Kowalski (demo)', phone: '+48600000000', email: null, cardNo: 'PC12345678', since: '2026-03-02 10:00:00' },
  loyalty: {
    name: 'Pulse Points',
    balance: 1240,
    valuePln: 124,
    spend12m: 2310,
    tier: { id: 'start', name: 'Start', rate: 0.5 },
    next: { id: 'silver', name: 'Silver', rate: 0.6, from: 3000, remaining: 690 },
    rules: {
      tiers: [
        { id: 'start', name: 'Start', from: 0, rate: 0.5 },
        { id: 'silver', name: 'Silver', from: 3000, rate: 0.6 },
        { id: 'gold', name: 'Gold', from: 8000, rate: 0.75 },
      ],
      pointValuePln: 0.1,
      minRedeem: 100,
      maxRedeemShare: 0.3,
      welcomeBonus: 50,
    },
  },
  cars: [
    {
      id: 1, plate: 'WA12345', vin: 'WBA8E9C50GK123456', make: 'BMW', model: '320d', year: '2016', lastMileage: 184500,
      visits: [
        {
          orderNo: 'ZL/2026/0412', date: '2026-09-20', mileage: 184500, total: 560,
          items: [
            { name: 'Wymiana oleju i filtra oleju', kind: 'usługa', qty: 1, price: 120 },
            { name: 'Olej Castrol Edge 5W30 5L', kind: 'część', qty: 1, price: 240 },
            { name: 'Filtr oleju', kind: 'część', qty: 1, price: 60 },
            { name: 'Diagnostyka komputerowa', kind: 'usługa', qty: 1, price: 100 },
            { name: 'Wymiana filtra kabinowego', kind: 'usługa', qty: 1, price: 40 },
          ],
        },
        {
          orderNo: 'ZL/2026/0233', date: '2026-06-11', mileage: 176200, total: 1450,
          items: [
            { name: 'Wymiana klocków i tarcz (przód)', kind: 'usługa', qty: 1, price: 300 },
            { name: 'Tarcze hamulcowe ATE', kind: 'część', qty: 2, price: 380 },
            { name: 'Klocki hamulcowe ATE', kind: 'część', qty: 1, price: 240 },
            { name: 'Wymiana płynu hamulcowego', kind: 'usługa', qty: 1, price: 150 },
          ],
        },
      ],
    },
    {
      id: 2, plate: 'WX9K001', vin: null, make: 'Toyota', model: 'Corolla', year: '2019', lastMileage: 90000,
      visits: [
        {
          orderNo: 'ZL/2026/0119', date: '2026-03-02', mileage: 88400, total: 300,
          items: [{ name: 'Ustawienie geometrii — 2 osie', kind: 'usługa', qty: 1, price: 300 }],
        },
      ],
    },
  ],
  otherVisits: [],
  activeOrders: [
    {
      orderNo: 'ZL 296/09/2026', date: '2026-09-27', mileage: 186000, total: 610, active: true, status: 'W naprawie', statusColor: '#FF9F43', due: 610, cardUrl: 'https://panel.pulsecar.tech/app/',
      items: [
        { name: 'Wymiana łącznika stabilizatora', kind: 'usługa', qty: 1, price: 100 },
        { name: 'Łącznik stabilizatora Lemförder', kind: 'część', qty: 2, price: 130 },
        { name: 'Ustawienie geometrii — 2 osie', kind: 'usługa', qty: 1, price: 250 },
      ],
    },
  ],
  appointments: [{ start: '2026-10-06 10:00', status: 'planned', title: 'Klimatyzacja — serwis' }],
  quotes: [
    {
      no: 'WY 41/09/2026', date: '2026-09-27', total: 890, accepted: false, car: 'Škoda Octavia', plate: 'WX 12345', cardUrl: 'https://panel.pulsecar.tech/app/',
      items: [
        { name: 'Wymiana klocków i tarcz — przód', kind: 'usługa', qty: 1, price: 250 },
        { name: 'Tarcze + klocki TRW — komplet', kind: 'część', qty: 1, price: 640 },
      ],
    },
  ],
  storage: [
    { no: 'PR/2026/031', kind: 'opony', description: 'Michelin Alpin 6 205/55 R16, DOT 2223', qty: 4, since: '2026-04-12', until: '2026-11-15', car: 'Škoda Octavia', plate: 'WX 12345', due: 200, paid: 200 },
  ],
  transactions: [
    { type: 'earn', points: 280, amount: 560, orderNo: 'ZL/2026/0412', date: '2026-09-20 15:12:00', note: null },
    { type: 'earn', points: 725, amount: 1450, orderNo: 'ZL/2026/0233', date: '2026-06-11 17:40:00', note: null },
    { type: 'earn', points: 150, amount: 300, orderNo: 'ZL/2026/0119', date: '2026-03-02 12:05:00', note: null },
    { type: 'bonus', points: 50, amount: null, orderNo: null, date: '2026-03-02 10:00:00', note: 'welcome' },
    { type: 'bonus', points: 35, amount: null, orderNo: null, date: '2026-03-01 10:00:00', note: null },
  ],
};
