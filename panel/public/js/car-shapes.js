// Схема авто для протокола повреждений (вид сверху, viewBox 0 0 200 400, перед — вверху).
// Форма зависит от типа кузова: седан, хэтчбек, универсал, купе, кабриолет, SUV, минивэн, бус, пикап, мотоцикл.
// Тип определяется по карточке авто (модель из VIN / техпаспорта) или выбирается вручную. Один файл — для CRM и для печати.

export const BODY_TYPES = [
  ['sedan', 'Седан', 'Sedan'], ['hatchback', 'Хэтчбек', 'Hatchback'], ['kombi', 'Универсал', 'Kombi'], ['coupe', 'Купе / лифтбек', 'Coupé'],
  ['cabrio', 'Кабриолет', 'Kabriolet'], ['suv', 'SUV / кроссовер', 'SUV'], ['minivan', 'Минивэн', 'Minivan'], ['van', 'Бус / фургон', 'Bus / dostawczy'],
  ['pickup', 'Пикап', 'Pickup'], ['moto', 'Мотоцикл', 'Motocykl'],
];

const W = (s) => s.split('|');
// границы слова с учётом польских/немецких букв (coupé, scénic)
const mk = (list) => new RegExp(`(?<![\\p{L}\\p{N}])(${list.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
const RX = {
  moto: /(?<![\p{L}])(motocykl|motorcycle|motorrad|skuter|scooter|quad|harley|ducati|kawasaki|yamaha (mt|r1|r6|xj|fz|tmax)|honda (cbr|cb|vfr|africa|nc)|ktm|triumph|vespa)(?![\p{L}])/iu,
  pickup: mk(W('amarok|hilux|ranger|navara|l200|triton|d-max|dmax|tundra|tacoma|f-150|f150|silverado|sierra|ram 1500|x-klasa|x-class|gladiator|pick-?up|cybertruck|frontier')),
  van: mk(W('transporter|multivan|caravelle|california|crafter|sprinter|vito|viano|v-klasa|v-class|citan|transit|tourneo|custom|ducato|jumper|boxer|master|trafic|movano|vivaro|kangoo|berlingo|partner|rifter|combo|doblo|dobl[oò]|proace|daily|expert|jumpy|nv200|nv300|nv400|primastar|interstar|talento|scudo|t5|t6|t6\\.1|t7|e-?transit|id\\.? ?buzz|caddy|bus|furgon|dostawczy|van')),
  minivan: mk(W('touran|sharan|alhambra|galaxy|s-max|c-max|zafira|scenic|sc[eé]nic|espace|picasso|spacetourer|meriva|verso|previa|sienna|carnival|b-klasa|b-class|active tourer|gran tourer|golf plus|golf sportsvan|roomster|odyssey|lodgy|xsara picasso|grand c4|carens|orlando')),
  cabrio: mk(W('cabrio|cabriolet|convertible|roadster|spider|spyder|z3|z4|mx-5|mx5|boxster|slk|slc|sl|eos|cc-cabrio|targa|volante|drophead')),
  kombi: mk(W('kombi|combi|touring|avant|variant|estate|wagon|sw|sports ?tourer|sportswagon|sports wagon|break|allroad|tourer|shooting ?brake|t-model|t-modell|sportbrake|syw|cross country|v40 cc|v50|v60|v70|v90|outback')),
  suv: mk(W('suv|x1|x2|x3|x4|x5|x6|x7|ix|ix1|ix3|xm|q2|q3|q4|q5|q7|q8|e-tron|sq5|sq7|sq8|tiguan|touareg|t-roc|t-cross|taigo|id\\.?4|id\\.?5|kodiaq|karoq|kamiq|enyaq|ateca|arona|tarraco|formentor|gla|glb|glc|gle|gls|ml|g-klasa|g-class|eqa|eqb|eqc|eqe suv|rav4|rav-4|c-hr|chr|land cruiser|highlander|yaris cross|corolla cross|bz4x|nx|rx|ux|qashqai|x-trail|juke|ariya|cr-v|crv|hr-v|hrv|zr-v|cx-3|cx-30|cx-5|cx-60|cx-7|cx-9|mx-30|outlander|asx|eclipse cross|vitara|grand vitara|s-cross|sx4|jimny|forester|xv|crosstrek|tucson|santa fe|kona|ix35|bayon|sportage|sorento|niro|stonic|xceed|ev6|ev9|xc40|xc60|xc90|ex30|ex90|kuga|puma|ecosport|explorer|edge|bronco|duster|bigster|captur|kadjar|koleos|arkana|austral|2008|3008|5008|c3 aircross|c5 aircross|c4 cactus|mokka|grandland|crossland|antara|frontera|range rover|discovery|evoque|velar|defender|freelander|macan|cayenne|model x|model y|compass|renegade|cherokee|wrangler|tonale|stelvio|f-pace|e-pace|i-pace|zs|hs|ehs|marvel|atto|tang|song|kodiak|x-cross|countryman|levante|urus|bentayga|cullinan|purosangue|dbx|jogger')),
  coupe: mk(W('coupe|coup[eé]|gran coupe|gran coup[eé]|i4|cla|cls|amg gt|tt|tts|ttrs|a5|a7|s5|s7|rs5|rs7|fastback|liftback|arteon|scirocco|mustang|camaro|challenger|brz|gt86|gr86|supra|rcz|86|m2|m4|m8|2er coupe|4er|6er|8er|911|cayman|taycan|panamera|model s|rc|lc|nissan 370z|370z|350z|gt-r|insignia grand sport|stinger|veloster|ds 9')),
  hatchback: mk(W('hatchback|hatch|golf|polo|up!?|up|lupo|id\\.?3|fabia|citigo|scala|ibiza|leon|mii|a1|a2|a3|1er|116|118|120|125|i3|mini|cooper|one|corsa|astra|adam|karl|focus|fiesta|ka|clio|megane|m[eé]gane|twingo|zoe|sandero|206|207|208|306|307|308|107|108|c1|c2|c3|c4|ds3|ds4|yaris|auris|aygo|iq|i10|i20|i30|getz|ceed|cee.d|picanto|rio|micra|note|leaf|swift|baleno|ignis|splash|alto|celerio|jazz|civic|mazda2|mazda 2|mazda3|mazda 3|space star|colt|500|panda|punto|tipo|bravo|mito|giulietta|a-klasa|a-class|v40|c30|i3|model 3 hatch|500e|cupra born|spring|fortwo|forfour')),
  sedan: mk(['sedan', 'limousine', 'limuzyna', 'saloon', 'berline', 'notchback']),
};

/** Тип кузова по данным авто: явный выбор → тип ТС → модель/марка */
export function detectBody(car = {}) {
  if (car.body_type && BODY_TYPES.some(([k]) => k === car.body_type)) return car.body_type;
  const vt = String(car.vehicle_type || car.category || '').toLowerCase();
  if (/motocykl|motorower|l[1-7]e?\b/.test(vt)) return 'moto';
  if (/ci[eę]żarow|dostawcz|\bbus\b|\bn1\b|\bn2\b/.test(vt)) return 'van';
  const name = `${car.make || ''} ${car.model || ''}`.replace(/\s+/g, ' ');
  for (const k of ['moto', 'pickup', 'cabrio', 'kombi', 'van', 'minivan', 'suv', 'coupe', 'sedan', 'hatchback']) if (RX[k].test(name)) return k;
  return 'sedan';
}

// ── Рисунки (все в одном масштабе: x 30..170, y 24..376) ─────────────────────
const wheels = (yf, yr, x1 = 30, x2 = 156, h = 44) => `<rect x="${x1}" y="${yf}" width="14" height="${h}" rx="4" class="w"/><rect x="${x2}" y="${yf}" width="14" height="${h}" rx="4" class="w"/>
  <rect x="${x1}" y="${yr}" width="14" height="${h}" rx="4" class="w"/><rect x="${x2}" y="${yr}" width="14" height="${h}" rx="4" class="w"/>`;
const mirrors = (y = 150) => `<path d="M44 ${y} L34 ${y} L34 ${y + 18} L44 ${y + 18} M156 ${y} L166 ${y} L166 ${y + 18} L156 ${y + 18}" class="l"/>`;
const SHAPES = {
  sedan: () => `${wheels(70, 286)}
    <path d="M60 40 Q100 18 140 40 L152 90 L156 170 L156 300 L150 350 Q100 376 50 350 L44 300 L44 170 L48 90 Z" class="b"/>
    <path d="M62 100 Q100 84 138 100 L132 136 Q100 128 68 136 Z" class="g"/>
    <rect x="68" y="140" width="64" height="104" rx="10" class="r"/>
    <path d="M68 248 Q100 254 132 248 L136 282 Q100 292 64 282 Z" class="g"/>
    <line x1="58" y1="300" x2="142" y2="300" class="t"/>${mirrors()}`,
  hatchback: () => `${wheels(66, 270)}
    <path d="M62 42 Q100 22 138 42 L150 88 L155 160 L155 300 Q152 334 100 340 Q48 334 45 300 L45 160 L50 88 Z" class="b"/>
    <path d="M63 96 Q100 80 137 96 L131 132 Q100 124 69 132 Z" class="g"/>
    <rect x="68" y="136" width="64" height="128" rx="10" class="r"/>
    <path d="M68 268 Q100 274 132 268 L138 304 Q100 316 62 304 Z" class="g"/>${mirrors(146)}`,
  kombi: () => `${wheels(70, 290)}
    <path d="M60 40 Q100 18 140 40 L152 90 L156 170 L156 340 Q154 360 100 362 Q46 360 44 340 L44 170 L48 90 Z" class="b"/>
    <path d="M62 100 Q100 84 138 100 L132 136 Q100 128 68 136 Z" class="g"/>
    <rect x="66" y="140" width="68" height="168" rx="10" class="r"/>
    <line x1="66" y1="160" x2="66" y2="300" class="t"/><line x1="134" y1="160" x2="134" y2="300" class="t"/>
    <path d="M68 312 Q100 316 132 312 L136 340 Q100 346 64 340 Z" class="g"/>${mirrors()}`,
  coupe: () => `${wheels(76, 290)}
    <path d="M64 36 Q100 18 136 36 L150 96 L156 180 L155 300 L148 348 Q100 374 52 348 L45 300 L44 180 L50 96 Z" class="b"/>
    <path d="M60 128 Q100 110 140 128 L132 166 Q100 158 68 166 Z" class="g"/>
    <rect x="70" y="170" width="60" height="70" rx="12" class="r"/>
    <path d="M70 244 Q100 250 130 244 L138 296 Q100 308 62 296 Z" class="g"/>
    <line x1="60" y1="312" x2="140" y2="312" class="t"/>${mirrors(172)}`,
  cabrio: () => `${wheels(72, 286)}
    <path d="M62 38 Q100 18 138 38 L152 92 L156 172 L156 300 L150 348 Q100 374 50 348 L44 300 L44 172 L48 92 Z" class="b"/>
    <path d="M62 118 Q100 102 138 118 L134 132 Q100 124 66 132 Z" class="g"/>
    <rect x="62" y="136" width="76" height="132" rx="14" class="i"/>
    <rect x="70" y="148" width="26" height="34" rx="6" class="s"/><rect x="104" y="148" width="26" height="34" rx="6" class="s"/>
    <rect x="70" y="210" width="60" height="30" rx="6" class="s"/>
    <path d="M62 272 Q100 280 138 272 L140 300 Q100 306 60 300 Z" class="r"/>${mirrors(142)}`,
  suv: () => `${wheels(70, 292, 26, 160, 50)}
    <path d="M52 34 Q100 22 148 34 L158 80 L160 170 L160 346 Q158 366 100 368 Q42 366 40 346 L40 170 L42 80 Z" class="b"/>
    <path d="M56 94 Q100 82 144 94 L138 132 Q100 126 62 132 Z" class="g"/>
    <rect x="62" y="136" width="76" height="180" rx="10" class="r"/>
    <line x1="58" y1="146" x2="58" y2="306" class="t"/><line x1="142" y1="146" x2="142" y2="306" class="t"/>
    <path d="M62 320 Q100 324 138 320 L142 346 Q100 352 58 346 Z" class="g"/>${mirrors(146).replace(/44/g, '40').replace(/156/g, '160').replace(/34/g, '30').replace(/166/g, '170')}`,
  minivan: () => `${wheels(64, 292)}
    <path d="M58 36 Q100 20 142 36 L154 76 L157 150 L157 346 Q155 366 100 368 Q45 366 43 346 L43 150 L46 76 Z" class="b"/>
    <path d="M56 80 Q100 66 144 80 L138 120 Q100 112 62 120 Z" class="g"/>
    <rect x="62" y="124" width="76" height="196" rx="10" class="r"/>
    <line x1="62" y1="196" x2="138" y2="196" class="t"/><line x1="62" y1="262" x2="138" y2="262" class="t"/>
    <path d="M62 324 Q100 328 138 324 L141 346 Q100 352 59 346 Z" class="g"/>${mirrors(126)}`,
  van: () => `${wheels(58, 300, 28, 158, 48)}
    <path d="M50 30 Q100 20 150 30 L158 56 L160 100 L160 370 L40 370 L40 100 L42 56 Z" class="b"/>
    <path d="M50 62 Q100 52 150 62 L146 96 Q100 90 54 96 Z" class="g"/>
    <rect x="48" y="104" width="104" height="260" rx="4" class="r"/>
    <line x1="48" y1="150" x2="152" y2="150" class="t"/><line x1="48" y1="200" x2="152" y2="200" class="t"/><line x1="48" y1="250" x2="152" y2="250" class="t"/><line x1="48" y1="300" x2="152" y2="300" class="t"/>
    <line x1="100" y1="330" x2="100" y2="370" class="t"/>
    <path d="M40 100 L30 100 L30 118 L40 118 M160 100 L170 100 L170 118 L160 118" class="l"/>`,
  pickup: () => `${wheels(66, 296, 28, 158, 48)}
    <path d="M54 32 Q100 20 146 32 L156 76 L158 160 L158 372 L42 372 L42 160 L44 76 Z" class="b"/>
    <path d="M56 92 Q100 80 144 92 L138 128 Q100 122 62 128 Z" class="g"/>
    <rect x="62" y="132" width="76" height="70" rx="8" class="r"/>
    <path d="M62 204 Q100 208 138 204 L138 214 L62 214 Z" class="g"/>
    <rect x="50" y="222" width="100" height="144" rx="4" class="i"/>
    <line x1="50" y1="270" x2="150" y2="270" class="t"/><line x1="50" y1="318" x2="150" y2="318" class="t"/>
    <path d="M42 140 L32 140 L32 158 L42 158 M158 140 L168 140 L168 158 L158 158" class="l"/>`,
  moto: () => `<rect x="88" y="34" width="24" height="70" rx="10" class="w"/><rect x="88" y="292" width="24" height="76" rx="11" class="w"/>
    <path d="M52 112 L148 112" class="l" style="stroke-width:5;stroke-linecap:round"/>
    <path d="M86 98 Q100 90 114 98 L118 140 Q100 146 82 140 Z" class="g"/>
    <path d="M78 140 Q100 132 122 140 L126 200 Q100 212 74 200 Z" class="b"/>
    <path d="M80 204 Q100 214 120 204 L118 282 Q100 292 82 282 Z" class="r"/>
    <path d="M70 236 L58 266 M130 236 L142 266" class="l"/>`,
};

/** SVG схемы. theme: 'print' — фиксированные цвета для печати; 'ui' — цвета темы CRM (currentColor) */
export function carShapeSvg(body = 'sedan', { theme = 'print', labels = ['PRZÓD', 'TYŁ'] } = {}) {
  const P = theme === 'print'
    ? { b: 'fill:#f4f5f7;stroke:#15171a;stroke-width:2', g: 'fill:#dfe2e6;stroke:#15171a;stroke-width:1.5', r: 'fill:#fff;stroke:#15171a;stroke-width:1.2',
      i: 'fill:#eceef1;stroke:#15171a;stroke-width:1.2', s: 'fill:#c9cdd3;stroke:#15171a;stroke-width:1', t: 'stroke:#cfd2d6;stroke-width:1;fill:none', l: 'fill:none;stroke:#15171a;stroke-width:1.5', w: 'fill:#15171a', txt: '#6b7078' }
    : { b: 'fill:var(--surface2);stroke:currentColor;stroke-width:2', g: 'fill:none;stroke:currentColor;stroke-width:1.5;opacity:.7', r: 'fill:none;stroke:currentColor;stroke-width:1.2;opacity:.6',
      i: 'fill:none;stroke:currentColor;stroke-width:1.2;opacity:.6', s: 'fill:currentColor;opacity:.25', t: 'stroke:currentColor;stroke-width:1;opacity:.3;fill:none', l: 'fill:none;stroke:currentColor;stroke-width:1.5', w: 'fill:currentColor', txt: 'currentColor' };
  const inner = (SHAPES[body] || SHAPES.sedan)().replace(/class="(\w+)"/g, (_, c) => `style="${P[c] || ''}"`);
  return `<text x="100" y="12" text-anchor="middle" font-size="10" fill="${P.txt}" ${theme === 'ui' ? 'opacity=".6"' : ''} font-family="Arial">${labels[0]}</text>
  <text x="100" y="396" text-anchor="middle" font-size="10" fill="${P.txt}" ${theme === 'ui' ? 'opacity=".6"' : ''} font-family="Arial">${labels[1]}</text>${inner}`;
}
