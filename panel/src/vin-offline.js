// Бесплатная расшифровка VIN без внешних сервисов: производитель по WMI (первые 3 знака),
// год выпуска по 10-му знаку (где производитель его ставит) и модель по коду модели для VAG и Mercedes-Benz.
// Для точных данных (двигатель, мощность) — скан Aztec техпаспорта или платный vindecoder.eu.

const WMI = {
  // VAG
  WVW: 'Volkswagen', WV1: 'Volkswagen', WV2: 'Volkswagen', WV3: 'Volkswagen', WVG: 'Volkswagen', '1VW': 'Volkswagen', '3VW': 'Volkswagen', '9BW': 'Volkswagen',
  WAU: 'Audi', WA1: 'Audi', WUA: 'Audi', TRU: 'Audi', TMB: 'Škoda', TMP: 'Škoda', VSS: 'Seat', VS6: 'Seat', WP0: 'Porsche', WP1: 'Porsche',
  // BMW / Mini
  WBA: 'BMW', WBS: 'BMW', WBX: 'BMW', WBY: 'BMW', WB1: 'BMW', WB3: 'BMW', '4US': 'BMW', '5UX': 'BMW', '5YM': 'BMW', WMW: 'Mini', WMZ: 'Mini',
  // Mercedes
  WDB: 'Mercedes-Benz', WDC: 'Mercedes-Benz', WDD: 'Mercedes-Benz', WDF: 'Mercedes-Benz', W1K: 'Mercedes-Benz', W1N: 'Mercedes-Benz', W1V: 'Mercedes-Benz', W1W: 'Mercedes-Benz', W1T: 'Mercedes-Benz', WMX: 'Mercedes-AMG', '4JG': 'Mercedes-Benz', '55S': 'Mercedes-Benz', WME: 'Smart',
  // Opel / Stellantis
  W0L: 'Opel', W0V: 'Opel', WOL: 'Opel', VXK: 'Opel', VF3: 'Peugeot', VR3: 'Peugeot', VF7: 'Citroën', VR7: 'Citroën', VR1: 'DS', ZFA: 'Fiat', ZFC: 'Fiat', ZAR: 'Alfa Romeo', ZLA: 'Lancia', ZAC: 'Jeep', '1C4': 'Jeep', '1J4': 'Jeep', '1J8': 'Jeep',
  // Ford
  WF0: 'Ford', WF1: 'Ford', '1FA': 'Ford', '1FM': 'Ford', '1FT': 'Ford', '2FM': 'Ford', '3FA': 'Ford', NM0: 'Ford',
  // Renault group
  VF1: 'Renault', VF2: 'Renault', VF6: 'Renault', UU1: 'Dacia', UU3: 'Dacia', VF8: 'Renault',
  // Japan
  JT: 'Toyota', JTD: 'Toyota', JTE: 'Toyota', JTN: 'Toyota', JTM: 'Toyota', SB1: 'Toyota', NMT: 'Toyota', VNK: 'Toyota', YAR: 'Toyota', TW1: 'Toyota', JTH: 'Lexus',
  JN1: 'Nissan', JN8: 'Nissan', SJN: 'Nissan', VSK: 'Nissan', VNV: 'Nissan', JHM: 'Honda', SHH: 'Honda', SHS: 'Honda', JMZ: 'Mazda', JM1: 'Mazda', JMB: 'Mitsubishi', JA3: 'Mitsubishi', JA4: 'Mitsubishi',
  JS1: 'Suzuki', JSA: 'Suzuki', TSM: 'Suzuki', JF1: 'Subaru', JF2: 'Subaru', JAA: 'Isuzu',
  // Korea
  KMH: 'Hyundai', KMJ: 'Hyundai', TMA: 'Hyundai', NLH: 'Hyundai', KNA: 'Kia', KNE: 'Kia', KND: 'Kia', U5Y: 'Kia', U6Y: 'Kia', KPT: 'SsangYong', KL1: 'Chevrolet',
  // Sweden, UK, other
  YV1: 'Volvo', YV4: 'Volvo', LVY: 'Volvo', YS3: 'Saab', SAL: 'Land Rover', SAJ: 'Jaguar', SCC: 'Lotus', SCF: 'Aston Martin', SCB: 'Bentley', SCA: 'Rolls-Royce',
  ZHW: 'Lamborghini', ZFF: 'Ferrari', ZAM: 'Maserati', '5YJ': 'Tesla', LRW: 'Tesla', XP7: 'Tesla', LSJ: 'MG', SDB: 'MG', LJC: 'JAC', LVS: 'Ford', LGX: 'BYD', LC0: 'BYD',
  '1G1': 'Chevrolet', '1GC': 'Chevrolet', '1GN': 'Chevrolet', '2G1': 'Chevrolet', '1G4': 'Buick', '1G6': 'Cadillac', '1C3': 'Chrysler', '2C3': 'Chrysler', '1D7': 'Dodge', '2D3': 'Dodge', '3D7': 'RAM',
  XTA: 'Lada', X7L: 'Renault', SUU: 'Solaris', TK9: 'SOR', VNE: 'Iveco', ZCF: 'Iveco', WMA: 'MAN', YS2: 'Scania', XLR: 'DAF', WKK: 'Setra', VLU: 'Scania',
};

// Код модели VAG — 7-8 знаки VIN (WVWZZZ1KZ… → «1K»)
const VAG = {
  Volkswagen: { '1J': 'Golf IV', '1K': 'Golf V', '5K': 'Golf VI', AJ: 'Golf VI', '5G': 'Golf VII', AU: 'Golf VII', BQ: 'Golf VII', CD: 'Golf VIII', '5M': 'Golf Plus', '1T': 'Touran', '5T': 'Touran', '3B': 'Passat B5', '3C': 'Passat B6/B7', '36': 'Passat CC',
    '3G': 'Passat B8', CB: 'Arteon', '3H': 'Arteon', '6R': 'Polo V', '6C': 'Polo V', AW: 'Polo VI', '9N': 'Polo IV', '5N': 'Tiguan', AD: 'Tiguan II', AX: 'Tiguan II', '7L': 'Touareg', '7P': 'Touareg', CR: 'Touareg III',
    '7H': 'Transporter T5', '7J': 'Transporter T5', SG: 'Transporter T6', SH: 'Transporter T6', '2K': 'Caddy', SA: 'Caddy V', '2E': 'Crafter', SY: 'Crafter', SZ: 'Crafter', '1Z': 'Jetta', '16': 'Jetta', '5C': 'Beetle', '13': 'Scirocco',
    AA: 'up!', '12': 'up!', A1: 'T-Roc', D1: 'T-Roc', C1: 'T-Cross', CA: 'Taigo', E1: 'ID.3', E2: 'ID.4', '7N': 'Sharan', '1Q': 'Eos', '3D': 'Phaeton', '2H': 'Amarok' },
  Audi: { '8L': 'A3 8L', '8P': 'A3 8P', '8V': 'A3 8V', GY: 'A3 8Y', '8Y': 'A3 8Y', '8E': 'A4 B6/B7', '8K': 'A4 B8', '8W': 'A4 B9', '8F': 'A5 Cabrio', '8T': 'A5', F5: 'A5 F5', '4B': 'A6 C5', '4F': 'A6 C6', '4G': 'A6 C7', '4A': 'A6 C8',
    '4H': 'A8 D4', '4N': 'A8 D5', '4D': 'A8 D2', '4E': 'A8 D3', '8X': 'A1', GB: 'A1', '8U': 'Q3', F3: 'Q3', '8R': 'Q5', FY: 'Q5', '4L': 'Q7', '4M': 'Q7/Q8', '8J': 'TT', FV: 'TT', '42': 'R8', '4K': 'A6/A7 C8', '4S': 'R8', GE: 'e-tron' },
  'Škoda': { '1U': 'Octavia I', '1Z': 'Octavia II', '5E': 'Octavia III', NX: 'Octavia IV', '3U': 'Superb I', '3T': 'Superb II', '3V': 'Superb III', '6Y': 'Fabia I', '5J': 'Fabia II', NJ: 'Fabia III', PJ: 'Fabia IV', NH: 'Rapid', '5L': 'Yeti',
    NS: 'Kodiaq', NU: 'Karoq', NW: 'Kamiq', KJ: 'Scala', '1Y': 'Roomster', '5Y': 'Citigo', AA: 'Citigo', NY: 'Enyaq' },
  Seat: { '1M': 'Leon I', '1P': 'Leon II', '5F': 'Leon III', KL: 'Leon IV', '6L': 'Ibiza III', '6J': 'Ibiza IV', '6P': 'Ibiza IV', KJ: 'Ibiza V', '5P': 'Altea', '7N': 'Alhambra', KH: 'Arona', '5N': 'Ateca', KN: 'Tarraco', '3R': 'Exeo', '1S': 'Mii' },
};
// Mercedes-Benz: знаки 4-6 — кузов (W205 → C-Klasa)
const MB = {
  168: 'A-Klasa W168', 169: 'A-Klasa W169', 176: 'A-Klasa W176', 177: 'A-Klasa W177', 245: 'B-Klasa W245', 246: 'B-Klasa W246', 247: 'B-Klasa W247',
  202: 'C-Klasa W202', 203: 'C-Klasa W203', 204: 'C-Klasa W204', 205: 'C-Klasa W205', 206: 'C-Klasa W206', 210: 'E-Klasa W210', 211: 'E-Klasa W211', 212: 'E-Klasa W212', 213: 'E-Klasa W213', 214: 'E-Klasa W214',
  220: 'S-Klasa W220', 221: 'S-Klasa W221', 222: 'S-Klasa W222', 223: 'S-Klasa W223', 207: 'E-Klasa Coupé C207', 209: 'CLK C209', 218: 'CLS C218', 219: 'CLS C219', 257: 'CLS C257',
  117: 'CLA C117', 118: 'CLA C118', 156: 'GLA X156', 253: 'GLC X253', 254: 'GLC X254', 166: 'GLE/ML W166', 167: 'GLE W167', 164: 'ML W164', 163: 'ML W163', 292: 'GLE Coupé C292',
  463: 'G-Klasa W463', 639: 'Vito/Viano W639', 447: 'Vito/V-Klasa W447', 906: 'Sprinter W906', 907: 'Sprinter W907', 910: 'Sprinter W910', 901: 'Sprinter W901', 903: 'Sprinter W903', 415: 'Citan', 420: 'Citan II', 470: 'X-Klasa',
};
const YEAR = 'ABCDEFGHJKLMNPRSTVWXY123456789';
// в каких марках 10-й знак — модельный год (у Mercedes и многих европейских — нет)
const YEAR_OK = new Set(['Volkswagen', 'Audi', 'Škoda', 'Seat', 'Porsche', 'Volvo', 'Tesla', 'Hyundai', 'Kia', 'Chevrolet', 'Jeep', 'Chrysler', 'Dodge', 'RAM', 'Buick', 'Cadillac', 'Land Rover', 'Jaguar']);

export function decodeVinOffline(vin) {
  const v = String(vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (v.length !== 17) return null;
  const make = WMI[v.slice(0, 3)] || WMI[v.slice(0, 2)] || null;
  if (!make) return null;
  let model = null;
  if (VAG[make]) model = VAG[make][v.slice(6, 8)] || null;
  if (make === 'Mercedes-Benz') model = MB[v.slice(3, 6)] || null;
  let year = null;
  const i = YEAR.indexOf(v[9]);
  if (i >= 0 && YEAR_OK.has(make)) {
    // цикл 30 лет: берём последний год, который не больше следующего
    const now = new Date().getFullYear() + 1;
    let y = 1980 + i;
    while (y + 30 <= now) y += 30;
    year = String(y);
  }
  return { source: 'VIN (бесплатно, по коду производителя)', make, model, year, capacity: null, power_kw: null, fuel: null, engine: null, partial: true };
}
