import type { T } from './i18n';

// ── Контакты (с pulsecar.pl) ────────────────────────────────────────────────
export const CONTACT = {
  phone: '+48 571 058 591',
  phoneRaw: '+48571058591',
  email: 'admin@pulsecar.pl',
  address: 'ul. Arkuszowa 176, 01-935 Warszawa',
  maps: 'https://maps.google.com/?cid=7421173521704876755',
  mapsRoute: 'https://www.google.com/maps/dir/?api=1&destination=Arkuszowa+176,+01-935+Warszawa',
  review: 'https://search.google.com/local/writereview?placeid=ChIJQR41oq7LHkcR0_rAuf9N_WY',
  whatsapp: 'https://wa.me/48571058591',
  telegram: 'https://t.me/PulseCar_Warszaw',
  instagram: 'https://www.instagram.com/pulsecar.warszaw',
  facebook: 'https://www.facebook.com/people/PulseCar/61582946949275/',
  site: 'https://pulsecar.pl',
  privacy: 'https://pulsecar.pl/pl/privacy-policy',
};

// Часы работы: [день недели 0=вс..6=сб] → [открытие, закрытие] в часах
export const HOURS: Record<number, [number, number] | null> = {
  0: null,
  1: [9, 18],
  2: [9, 18],
  3: [9, 18],
  4: [9, 18],
  5: [9, 18],
  6: [9, 15],
};

// ── Услуги ──────────────────────────────────────────────────────────────────
export type Service = { id: string; icon: string; name: T; desc: T; url: string };

export const SERVICES: Service[] = [
  {
    id: 'general', icon: 'construct-outline', url: 'general-repair',
    name: ['Mechanika i serwis', 'Mechanics & service', 'Механіка та сервіс', 'Механика и сервис'],
    desc: ['Kompleksowy serwis i naprawy mechaniczne.', 'Complete servicing and mechanical repairs.', 'Комплексний сервіс і механічний ремонт.', 'Комплексное обслуживание и механический ремонт.'],
  },
  {
    id: 'electric', icon: 'flash-outline', url: 'auto-electrician',
    name: ['Autoelektryk', 'Auto electrician', 'Автоелектрик', 'Автоэлектрик'],
    desc: ['Profesjonalna diagnostyka i naprawa układów elektrycznych.', 'Professional diagnostics and repair of electrical systems.', 'Професійна діагностика та ремонт електросистем.', 'Профессиональная диагностика и ремонт электросистем.'],
  },
  {
    id: 'alignment', icon: 'git-compare-outline', url: 'wheel-alignment',
    name: ['Geometria kół', 'Wheel alignment', 'Розвал-сходження', 'Развал-схождение'],
    desc: ['Precyzyjna regulacja geometrii zawieszenia.', 'Precise suspension geometry adjustment.', 'Точне налаштування геометрії підвіски.', 'Точная настройка геометрии подвески.'],
  },
  {
    id: 'tires', icon: 'disc-outline', url: 'tire-service',
    name: ['Wymiana opon', 'Tyre service', 'Шиномонтаж', 'Шиномонтаж'],
    desc: ['Kompleksowa obsługa opon i felg.', 'Complete tyre and rim service.', 'Повне обслуговування шин і дисків.', 'Полное обслуживание шин и дисков.'],
  },
  {
    id: 'ac', icon: 'snow-outline', url: 'air-conditioning',
    name: ['Klimatyzacja', 'Air conditioning', 'Кондиціонер', 'Кондиционер'],
    desc: ['Serwis i naprawa systemów klimatyzacji.', 'A/C system service and repair.', 'Обслуговування та ремонт кондиціонерів.', 'Обслуживание и ремонт кондиционеров.'],
  },
  {
    id: 'engine', icon: 'cog-outline', url: 'engine-overhaul',
    name: ['Kapitalny remont silnika', 'Engine overhaul', 'Капремонт двигуна', 'Капремонт двигателя'],
    desc: ['Kompleksowy remont i regeneracja silników.', 'Complete engine overhaul and rebuild.', 'Комплексний ремонт і відновлення двигунів.', 'Комплексный ремонт и восстановление двигателей.'],
  },
  {
    id: 'chain', icon: 'link-outline', url: 'timing-chain',
    name: ['Wymiana łańcucha rozrządu', 'Timing chain replacement', 'Заміна ланцюга ГРМ', 'Замена цепи ГРМ'],
    desc: ['Najpierw mierzymy, ile łańcuch się wyciągnął.', 'First we measure how much the chain has stretched.', 'Спочатку вимірюємо, наскільки розтягнувся ланцюг.', 'Сначала измеряем, насколько растянулась цепь.'],
  },
  {
    id: 'intake', icon: 'leaf-outline', url: 'intake-cleaning',
    name: ['Czyszczenie kanałów dolotowych', 'Intake port cleaning', 'Чистка впускних каналів', 'Чистка впускных каналов'],
    desc: ['Nagar z kanałów usuwamy granulatem z łupiny orzecha włoskiego.', 'We remove carbon deposits with walnut-shell blasting.', 'Нагар прибираємо гранулятом із шкаралупи волоського горіха.', 'Нагар удаляем гранулятом из скорлупы грецкого ореха.'],
  },
  {
    id: 'gearbox', icon: 'options-outline', url: 'transmission-repair',
    name: ['Naprawa skrzyni biegów', 'Gearbox repair', 'Ремонт КПП', 'Ремонт КПП'],
    desc: ['Serwis i naprawa automatycznych i manualnych skrzyń biegów.', 'Service and repair of automatic and manual gearboxes.', 'Сервіс і ремонт автоматичних та механічних КПП.', 'Сервис и ремонт автоматических и механических КПП.'],
  },
  {
    id: 'inspection', icon: 'search-outline', url: 'pre-purchase-inspection',
    name: ['Sprawdzenie auta przed zakupem', 'Pre-purchase inspection', 'Перевірка авто перед покупкою', 'Проверка авто перед покупкой'],
    desc: ['Sprawdzimy auto na podnośniku i komputerem, zanim zapłacisz. 300 zł.', "We check the car on the lift and by computer before you pay. 300 zł.", 'Перевіримо авто на підйомнику та комп’ютером, перш ніж ви заплатите. 300 zł.', 'Проверим авто на подъёмнике и компьютером, прежде чем вы заплатите. 300 zł.'],
  },
];

// ── Прайс ───────────────────────────────────────────────────────────────────
export type PriceItem = { name: T; price: number; from?: boolean };
export type PriceGroup = { id: string; title: T; items: PriceItem[] };

const tyre = (r: number, price: number): PriceItem => ({
  name: [`Wymiana opon R${r}`, `Tyre change R${r}`, `Шиномонтаж R${r}`, `Шиномонтаж R${r}`],
  price,
});

export const PRICES: PriceGroup[] = [
  {
    id: 'diag',
    title: ['Diagnostyka', 'Diagnostics', 'Діагностика', 'Диагностика'],
    items: [
      { name: ['Diagnostyka komputerowa', 'Computer diagnostics', 'Комп’ютерна діагностика', 'Компьютерная диагностика'], price: 100 },
      { name: ['Diagnostyka zawieszenia', 'Suspension diagnostics', 'Діагностика підвіски', 'Диагностика подвески'], price: 100 },
      { name: ['Przegląd przed zakupem', 'Pre-purchase inspection', 'Огляд перед покупкою', 'Осмотр перед покупкой'], price: 300 },
      { name: ['Przegląd rozszerzony', 'Extended inspection', 'Розширений огляд', 'Расширенный осмотр'], price: 250 },
    ],
  },
  {
    id: 'alignment',
    title: ['Geometria kół', 'Wheel alignment', 'Розвал-сходження', 'Развал-схождение'],
    items: [
      { name: ['Ustawienie geometrii — 1 oś', 'Alignment — 1 axle', 'Розвал-сходження — 1 вісь', 'Развал-схождение — 1 ось'], price: 150 },
      { name: ['Ustawienie geometrii — 2 osie', 'Alignment — 2 axles', 'Розвал-сходження — 2 осі', 'Развал-схождение — 2 оси'], price: 300 },
    ],
  },
  {
    id: 'tyres',
    title: ['Wulkanizacja', 'Tyres', 'Шиномонтаж', 'Шиномонтаж'],
    items: [
      tyre(14, 180), tyre(15, 200), tyre(16, 220), tyre(17, 240), tyre(18, 260), tyre(19, 280), tyre(20, 300), tyre(21, 320),
      { name: ['Przechowywanie opon — 1 sezon', 'Tyre storage — 1 season', 'Зберігання шин — 1 сезон', 'Хранение шин — 1 сезон'], price: 200 },
    ],
  },
  {
    id: 'ac',
    title: ['Klimatyzacja', 'Air conditioning', 'Кондиціонер', 'Кондиционер'],
    items: [
      { name: ['Napełnianie klimatyzacji i sprawdzanie próżni', 'A/C recharge and vacuum test', 'Заправка кондиціонера і перевірка вакууму', 'Заправка кондиционера и проверка вакуума'], price: 199, from: true },
      { name: ['Freon 100 g — R134a', 'Refrigerant 100 g — R134a', 'Фреон 100 г — R134a', 'Фреон 100 г — R134a'], price: 40 },
      { name: ['Freon 100 g — R1234yf', 'Refrigerant 100 g — R1234yf', 'Фреон 100 г — R1234yf', 'Фреон 100 г — R1234yf'], price: 40 },
    ],
  },
  {
    id: 'service',
    title: ['Serwis samochodów', 'Car service', 'Сервіс авто', 'Сервис авто'],
    items: [
      { name: ['Wymiana oleju i filtra oleju', 'Oil and oil filter change', 'Заміна оливи та масляного фільтра', 'Замена масла и масляного фильтра'], price: 120 },
      { name: ['Wymiana filtra powietrznego', 'Air filter replacement', 'Заміна повітряного фільтра', 'Замена воздушного фильтра'], price: 40 },
      { name: ['Wymiana filtra kabinowego', 'Cabin filter replacement', 'Заміна салонного фільтра', 'Замена салонного фильтра'], price: 40 },
      { name: ['Wymiana filtra paliwa', 'Fuel filter replacement', 'Заміна паливного фільтра', 'Замена топливного фильтра'], price: 40 },
      { name: ['Wymiana żarówki', 'Bulb replacement', 'Заміна лампи', 'Замена лампы'], price: 30, from: true },
      { name: ['Wymiana klocków hamulcowych (przód)', 'Brake pads (front)', 'Заміна гальмівних колодок (перед)', 'Замена тормозных колодок (перед)'], price: 200, from: true },
      { name: ['Wymiana klocków hamulcowych (tył)', 'Brake pads (rear)', 'Заміна гальмівних колодок (зад)', 'Замена тормозных колодок (зад)'], price: 250, from: true },
      { name: ['Wymiana klocków i tarcz (przód)', 'Pads and discs (front)', 'Заміна колодок і дисків (перед)', 'Замена колодок и дисков (перед)'], price: 300, from: true },
      { name: ['Wymiana klocków i tarcz (tył)', 'Pads and discs (rear)', 'Заміна колодок і дисків (зад)', 'Замена колодок и дисков (зад)'], price: 350, from: true },
      { name: ['Wymiana płynu hamulcowego', 'Brake fluid change', 'Заміна гальмівної рідини', 'Замена тормозной жидкости'], price: 200, from: true },
      { name: ['Wymiana płynu chłodzącego', 'Coolant change', 'Заміна охолоджувальної рідини', 'Замена охлаждающей жидкости'], price: 200, from: true },
      { name: ['Wymiana łącznika stabilizatora', 'Stabiliser link replacement', 'Заміна стійки стабілізатора', 'Замена стойки стабилизатора'], price: 100, from: true },
      { name: ['Wymiana amortyzatora (przód)', 'Shock absorber (front)', 'Заміна амортизатора (перед)', 'Замена амортизатора (перед)'], price: 200, from: true },
      { name: ['Wymiana wahacza', 'Control arm replacement', 'Заміна важеля', 'Замена рычага'], price: 200, from: true },
      { name: ['Wymiana końcówki drążka kierowniczego', 'Tie rod end replacement', 'Заміна рульового наконечника', 'Замена рулевого наконечника'], price: 150, from: true },
      { name: ['Wymiana poduszki silnika', 'Engine mount replacement', 'Заміна подушки двигуна', 'Замена подушки двигателя'], price: 150, from: true },
      { name: ['Wymiana półosi', 'Drive shaft replacement', 'Заміна півосі', 'Замена полуоси'], price: 250, from: true },
      { name: ['Wymiana oleju w skrzyni automatycznej', 'Automatic gearbox oil change', 'Заміна оливи в АКПП', 'Замена масла в АКПП'], price: 400, from: true },
      { name: ['Wymiana oleju w skrzyni manualnej', 'Manual gearbox oil change', 'Заміна оливи в МКПП', 'Замена масла в МКПП'], price: 200, from: true },
      { name: ['Wymiana sprzęgła', 'Clutch replacement', 'Заміна зчеплення', 'Замена сцепления'], price: 600, from: true },
      { name: ['Wymiana skrzyni automatycznej', 'Automatic gearbox replacement', 'Заміна АКПП', 'Замена АКПП'], price: 800, from: true },
      { name: ['Wymiana turbosprężarki', 'Turbocharger replacement', 'Заміна турбіни', 'Замена турбины'], price: 600, from: true },
      { name: ['Wymiana paska rozrządu', 'Timing belt replacement', 'Заміна ременя ГРМ', 'Замена ремня ГРМ'], price: 600, from: true },
      { name: ['Wymiana łańcucha rozrządu', 'Timing chain replacement', 'Заміна ланцюга ГРМ', 'Замена цепи ГРМ'], price: 1000, from: true },
      { name: ['Wymiana uszczelki głowicy', 'Head gasket replacement', 'Заміна прокладки ГБЦ', 'Замена прокладки ГБЦ'], price: 1000, from: true },
      { name: ['Wymiana silnika', 'Engine replacement', 'Заміна двигуна', 'Замена двигателя'], price: 2000, from: true },
      { name: ['Diagnostyka endoskopowa silnika', 'Engine endoscope inspection', 'Ендоскопія двигуна', 'Эндоскопия двигателя'], price: 300, from: true },
    ],
  },
];

// ── Тест симптомов ──────────────────────────────────────────────────────────
export type Variant = { q: T; causes: T[] };
export type Symptom = { id: string; icon: string; title: T; variants: Variant[]; service: T; price: string };

export const SYMPTOMS: Symptom[] = [
  {
    id: 'check', icon: 'warning-outline',
    title: ['Świeci kontrolka silnika', 'Check engine light is on', 'Горить лампа Check Engine', 'Горит Check Engine'],
    service: ['Diagnostyka komputerowa', 'Computer diagnostics', 'Комп’ютерна діагностика', 'Компьютерная диагностика'], price: '100 zł',
    variants: [
      {
        q: ['Świeci stale, auto jedzie normalnie', 'Steady light, car drives normally', 'Горить постійно, авто їде нормально', 'Горит постоянно, машина едет нормально'],
        causes: [
          ['Czujnik (sonda lambda, przepływomierz, temperatury)', 'A sensor (lambda, MAF, temperature)', 'Датчик (лямбда-зонд, витратомір, температури)', 'Датчик (лямбда-зонд, расходомер, температуры)'],
          ['Nieszczelność układu dolotowego lub EVAP', 'Intake or EVAP system leak', 'Негерметичність впуску або EVAP', 'Подсос во впуске или EVAP'],
          ['Zawór EGR, filtr DPF', 'EGR valve, DPF filter', 'Клапан EGR, фільтр DPF', 'Клапан EGR, фильтр DPF'],
        ],
      },
      {
        q: ['Miga, silnik nierówno pracuje', 'Flashing, engine runs rough', 'Блимає, двигун працює нерівно', 'Мигает, двигатель троит'],
        causes: [
          ['Wypadanie zapłonu: cewka, świeca, przewód', 'Misfire: coil, spark plug, lead', 'Пропуски запалювання: котушка, свічка, дріт', 'Пропуски зажигания: катушка, свеча, провод'],
          ['Wtryskiwacz', 'Injector', 'Форсунка', 'Форсунка'],
          ['Niespalone paliwo może uszkodzić katalizator', 'Unburnt fuel can damage the catalyst', 'Незгоріле паливо може пошкодити каталізатор', 'Несгоревшее топливо может повредить катализатор'],
        ],
      },
      {
        q: ['Auto straciło moc (tryb awaryjny)', 'Car lost power (limp mode)', 'Авто втратило потужність (аварійний режим)', 'Машина потеряла мощность (аварийный режим)'],
        causes: [
          ['Ciśnienie doładowania (turbo, nieszczelny wąż, zawór)', 'Boost pressure (turbo, leaking hose, valve)', 'Тиск наддуву (турбіна, негерметичний патрубок, клапан)', 'Давление наддува (турбина, негерметичный патрубок, клапан)'],
          ['Zapchany filtr DPF lub zawór EGR', 'Clogged DPF or EGR valve', 'Забитий DPF або клапан EGR', 'Забитый DPF или клапан EGR'],
          ['Czujnik lub przepustnica', 'Sensor or throttle body', 'Датчик або дросельна заслінка', 'Датчик или дроссельная заслонка'],
        ],
      },
    ],
  },
  {
    id: 'knock', icon: 'pulse-outline',
    title: ['Stuki na nierównościach', 'Knocking over bumps', 'Стуки на нерівностях', 'Стуки на неровностях'],
    service: ['Diagnostyka zawieszenia', 'Suspension diagnostics', 'Діагностика підвіски', 'Диагностика подвески'], price: '100 zł',
    variants: [
      {
        q: ['Na dziurach i progach zwalniających', 'Over potholes and speed bumps', 'На ямах і лежачих поліцейських', 'На ямах и лежачих полицейских'],
        causes: [
          ['Łączniki stabilizatora', 'Stabiliser links', 'Стійки стабілізатора', 'Стойки стабилизатора'],
          ['Tuleje lub sworznie wahaczy', 'Control arm bushes or ball joints', 'Сайлентблоки або кульові опори', 'Сайлентблоки или шаровые опоры'],
          ['Amortyzatory, poduszki kolumn', 'Shock absorbers, strut mounts', 'Амортизатори, опори стійок', 'Амортизаторы, опоры стоек'],
        ],
      },
      {
        q: ['Przy skręcaniu i ruszaniu', 'When turning and pulling away', 'При повороті та рушанні', 'При повороте и трогании'],
        causes: [
          ['Przegub półosi (klekotanie na skręcie)', 'CV joint (clicking on turns)', 'ШРУС (клацання в повороті)', 'ШРУС (щелчки в повороте)'],
          ['Końcówki drążków kierowniczych', 'Tie rod ends', 'Рульові наконечники', 'Рулевые наконечники'],
          ['Poduszka silnika', 'Engine mount', 'Подушка двигуна', 'Подушка двигателя'],
        ],
      },
    ],
  },
  {
    id: 'pull', icon: 'navigate-outline',
    title: ['Auto ściąga / krzywa kierownica', 'Car pulls / crooked wheel', 'Авто тягне / кривий руль', 'Машину тянет / кривой руль'],
    service: ['Geometria kół', 'Wheel alignment', 'Розвал-сходження', 'Развал-схождение'], price: '150–300 zł',
    variants: [
      {
        q: ['Nierówno zużyte opony', 'Uneven tyre wear', 'Нерівномірний знос шин', 'Неравномерный износ шин'],
        causes: [
          ['Rozregulowana geometria kół', 'Wheel alignment out of spec', 'Збитий розвал-сходження', 'Сбит развал-схождение'],
          ['Luzy w zawieszeniu', 'Play in the suspension', 'Люфти в підвісці', 'Люфты в подвеске'],
          ['Różne ciśnienie w oponach', 'Different tyre pressures', 'Різний тиск у шинах', 'Разное давление в шинах'],
        ],
      },
      {
        q: ['Po uderzeniu w krawężnik lub dziurę', 'After hitting a kerb or pothole', 'Після удару об бордюр або яму', 'После удара о бордюр или яму'],
        causes: [
          ['Geometria kół do ustawienia', 'Alignment needs setting', 'Потрібен розвал-сходження', 'Нужен развал-схождение'],
          ['Możliwe skrzywione elementy zawieszenia lub felga', 'Possibly bent suspension parts or rim', 'Можливо, погнуті деталі підвіски або диск', 'Возможно, погнуты детали подвески или диск'],
          ['Uszkodzona opona (wybrzuszenie)', 'Damaged tyre (bulge)', 'Пошкоджена шина (грижа)', 'Повреждённая шина (грыжа)'],
        ],
      },
    ],
  },
  {
    id: 'brakes', icon: 'stop-circle-outline',
    title: ['Problem z hamulcami', 'Brake problem', 'Проблема з гальмами', 'Проблема с тормозами'],
    service: ['Wymiana klocków hamulcowych', 'Brake pad replacement', 'Заміна гальмівних колодок', 'Замена тормозных колодок'], price: 'od 200 zł',
    variants: [
      {
        q: ['Pisk lub metaliczny zgrzyt', 'Squeal or metallic grinding', 'Писк або металевий скрегіт', 'Писк или металлический скрежет'],
        causes: [
          ['Zużyte klocki (wskaźnik zużycia)', 'Worn pads (wear indicator)', 'Зношені колодки (індикатор зносу)', 'Изношенные колодки (индикатор износа)'],
          ['Klocki starte do metalu niszczą tarcze', 'Pads worn to metal destroy the discs', 'Колодки, стерті до металу, руйнують диски', 'Колодки, стёртые до металла, разрушают диски'],
          ['Zapieczony zacisk lub prowadnice', 'Seized caliper or guide pins', 'Закислий супорт або направляючі', 'Закисший суппорт или направляющие'],
        ],
      },
      {
        q: ['Bicie kierownicy lub pedału', 'Steering wheel or pedal vibration', 'Биття руля або педалі', 'Биение руля или педали'],
        causes: [
          ['Zdeformowane tarcze hamulcowe', 'Warped brake discs', 'Деформовані гальмівні диски', 'Деформированные тормозные диски'],
          ['Nierówno zużyte klocki', 'Unevenly worn pads', 'Нерівномірно зношені колодки', 'Неравномерно изношенные колодки'],
          ['Rzadziej: luz w zawieszeniu', 'Less often: suspension play', 'Рідше: люфт у підвісці', 'Реже: люфт в подвеске'],
        ],
      },
      {
        q: ['Miękki pedał, zapada się', 'Soft pedal, sinks down', "М'яка педаль, провалюється", 'Мягкая педаль, проваливается'],
        causes: [
          ['Powietrze lub stary płyn w układzie', 'Air or old fluid in the system', 'Повітря або стара рідина в системі', 'Воздух или старая жидкость в системе'],
          ['Wyciek płynu hamulcowego', 'Brake fluid leak', 'Витік гальмівної рідини', 'Утечка тормозной жидкости'],
          ['Pompa hamulcowa', 'Brake master cylinder', 'Головний гальмівний циліндр', 'Главный тормозной цилиндр'],
        ],
      },
    ],
  },
  {
    id: 'ac', icon: 'snow-outline',
    title: ['Klimatyzacja nie chłodzi lub śmierdzi', "A/C doesn't cool or smells", 'Кондиціонер не холодить або смердить', 'Кондиционер не холодит или пахнет'],
    service: ['Serwis klimatyzacji', 'A/C service', 'Сервіс кондиціонера', 'Сервис кондиционера'], price: 'od 199 zł',
    variants: [
      {
        q: ['Słabo chłodzi lub dmucha ciepłym', 'Cools poorly or blows warm', 'Слабо холодить або дме теплим', 'Слабо холодит или дует тёплым'],
        causes: [
          ['Za mało czynnika (naturalny ubytek)', 'Low refrigerant (natural loss)', 'Мало фреону (природна втрата)', 'Мало фреона (естественная убыль)'],
          ['Nieszczelność układu', 'System leak', 'Негерметичність системи', 'Утечка в системе'],
          ['Sprężarka lub jej sprzęgło', 'Compressor or its clutch', 'Компресор або його муфта', 'Компрессор или его муфта'],
        ],
      },
      {
        q: ['Nieprzyjemny zapach z nawiewu', 'Unpleasant smell from vents', 'Неприємний запах з дефлекторів', 'Неприятный запах из дефлекторов'],
        causes: [
          ['Zużyty filtr kabinowy', 'Old cabin filter', 'Старий салонний фільтр', 'Старый салонный фильтр'],
          ['Bakterie i grzyby na parowniku', 'Bacteria and mould on the evaporator', 'Бактерії та грибок на випарнику', 'Бактерии и грибок на испарителе'],
          ['Zatkany odpływ skroplin', 'Blocked condensate drain', 'Забитий дренаж конденсату', 'Забит дренаж конденсата'],
        ],
      },
    ],
  },
  {
    id: 'nostart', icon: 'battery-dead-outline',
    title: ['Auto nie odpala', "Car won't start", 'Авто не заводиться', 'Машина не заводится'],
    service: ['Autoelektryk + diagnostyka', 'Auto electrician + diagnostics', 'Автоелектрик + діагностика', 'Автоэлектрик + диагностика'], price: 'od 100 zł',
    variants: [
      {
        q: ['Rozrusznik ledwo kręci lub klika', 'Starter barely cranks or clicks', 'Стартер ледве крутить або клацає', 'Стартер еле крутит или щёлкает'],
        causes: [
          ['Rozładowany lub zużyty akumulator', 'Flat or worn battery', 'Розряджений або зношений акумулятор', 'Разряженный или изношенный аккумулятор'],
          ['Alternator nie ładuje', 'Alternator not charging', 'Генератор не заряджає', 'Генератор не заряжает'],
          ['Rozrusznik, luźne lub skorodowane klemy', 'Starter, loose or corroded terminals', 'Стартер, слабкі або окислені клеми', 'Стартер, слабые или окисленные клеммы'],
        ],
      },
      {
        q: ['Kręci normalnie, ale nie zapala', "Cranks normally but won't fire", 'Крутить нормально, але не заводиться', 'Крутит нормально, но не заводится'],
        causes: [
          ['Brak paliwa lub ciśnienia (pompa, filtr)', 'No fuel or pressure (pump, filter)', 'Немає палива або тиску (насос, фільтр)', 'Нет топлива или давления (насос, фильтр)'],
          ['Czujnik położenia wału lub wałka', 'Crank or cam position sensor', 'Датчик колінвала або розподілвала', 'Датчик коленвала или распредвала'],
          ['Immobilizer, zapłon', 'Immobiliser, ignition', 'Іммобілайзер, запалювання', 'Иммобилайзер, зажигание'],
        ],
      },
    ],
  },
  {
    id: 'rattle', icon: 'volume-high-outline',
    title: ['Grzechotanie z silnika', 'Engine rattle', 'Брязкіт з двигуна', 'Дребезг из двигателя'],
    service: ['Wymiana łańcucha rozrządu', 'Timing chain replacement', 'Заміна ланцюга ГРМ', 'Замена цепи ГРМ'], price: 'od 1000 zł',
    variants: [
      {
        q: ['Kilka sekund po zimnym starcie', 'A few seconds after a cold start', 'Кілька секунд після холодного пуску', 'Несколько секунд после холодного пуска'],
        causes: [
          ['Rozciągnięty łańcuch rozrządu lub zużyty napinacz', 'Stretched timing chain or worn tensioner', 'Розтягнутий ланцюг ГРМ або зношений натягувач', 'Растянутая цепь ГРМ или изношенный натяжитель'],
          ['Niskie ciśnienie oleju przy starcie', 'Low oil pressure at start-up', 'Низький тиск оливи на старті', 'Низкое давление масла при старте'],
          ['Popychacze hydrauliczne', 'Hydraulic lifters', 'Гідрокомпенсатори', 'Гидрокомпенсаторы'],
        ],
      },
      {
        q: ['Cały czas lub coraz głośniej', 'All the time or getting louder', 'Постійно або дедалі гучніше', 'Постоянно или всё громче'],
        causes: [
          ['Mocno zużyty łańcuch rozrządu — ryzyko przeskoczenia', 'Badly worn chain — risk of jumping teeth', 'Сильно зношений ланцюг — ризик перескоку', 'Сильно изношенная цепь — риск перескока'],
          ['Uszkodzone prowadnice łańcucha', 'Damaged chain guides', 'Пошкоджені заспокоювачі ланцюга', 'Повреждённые успокоители цепи'],
          ['Rzadziej: osłona termiczna wydechu', 'Less often: exhaust heat shield', 'Рідше: термоекран вихлопу', 'Реже: термоэкран выхлопа'],
        ],
      },
    ],
  },
  {
    id: 'smoke', icon: 'cloud-outline',
    title: ['Dym z wydechu / spadek mocy', 'Exhaust smoke / power loss', 'Дим з вихлопу / втрата потужності', 'Дым из выхлопа / потеря мощности'],
    service: ['Diagnostyka endoskopowa silnika', 'Engine endoscope inspection', 'Ендоскопія двигуна', 'Эндоскопия двигателя'], price: 'od 300 zł',
    variants: [
      {
        q: ['Czarny, przy przyspieszaniu', 'Black, when accelerating', 'Чорний, при розгоні', 'Чёрный, при разгоне'],
        causes: [
          ['Zanieczyszczony dolot i zawór EGR', 'Dirty intake and EGR valve', 'Забруднений впуск і клапан EGR', 'Загрязнённый впуск и клапан EGR'],
          ['Wtryskiwacze', 'Injectors', 'Форсунки', 'Форсунки'],
          ['Nieszczelność doładowania lub przepływomierz', 'Boost leak or MAF sensor', 'Негерметичність наддуву або витратомір', 'Утечка наддува или расходомер'],
        ],
      },
      {
        q: ['Niebieskawy, auto bierze olej', 'Bluish, car burns oil', 'Синюватий, авто їсть оливу', 'Синеватый, машина ест масло'],
        causes: [
          ['Turbosprężarka', 'Turbocharger', 'Турбіна', 'Турбина'],
          ['Uszczelniacze zaworów', 'Valve stem seals', 'Маслознімні ковпачки', 'Маслосъёмные колпачки'],
          ['Zużyte pierścienie tłokowe — sprawdzimy endoskopem', 'Worn piston rings — we check with an endoscope', 'Зношені поршневі кільця — перевіримо ендоскопом', 'Изношенные поршневые кольца — проверим эндоскопом'],
        ],
      },
      {
        q: ['Gęsty biały, ubywa płynu chłodniczego', 'Thick white, coolant disappearing', 'Густий білий, зникає антифриз', 'Густой белый, уходит антифриз'],
        causes: [
          ['Uszczelka pod głowicą', 'Head gasket', 'Прокладка ГБЦ', 'Прокладка ГБЦ'],
          ['Pęknięta głowica', 'Cracked cylinder head', 'Тріснута ГБЦ', 'Треснувшая ГБЦ'],
          ['Przegrzanie silnika', 'Engine overheating', 'Перегрів двигуна', 'Перегрев двигателя'],
        ],
      },
    ],
  },
  {
    id: 'gearbox', icon: 'options-outline',
    title: ['Szarpie skrzynia lub sprzęgło', 'Jerky gearbox or clutch', 'Смикає коробка або зчеплення', 'Дёргает коробка или сцепление'],
    service: ['Naprawa skrzyni biegów', 'Gearbox repair', 'Ремонт КПП', 'Ремонт КПП'], price: 'od 200 zł',
    variants: [
      {
        q: ['Automat — szarpie lub się ślizga', 'Automatic — jerks or slips', 'Автомат — смикає або буксує', 'Автомат — дёргает или буксует'],
        causes: [
          ['Stary lub zużyty olej ATF', 'Old or worn ATF oil', 'Стара або зношена олива ATF', 'Старое или изношенное масло ATF'],
          ['Brak adaptacji skrzyni', 'Gearbox not adapted', 'Відсутня адаптація коробки', 'Нет адаптации коробки'],
          ['Mechatronika lub zawory', 'Mechatronics or valve body', 'Мехатроніка або клапани', 'Мехатроника или клапаны'],
        ],
      },
      {
        q: ['Manual — sprzęgło łapie wysoko / ślizga się', 'Manual — clutch bites high / slips', 'Механіка — зчеплення хапає високо / буксує', 'Механика — сцепление хватает высоко / буксует'],
        causes: [
          ['Zużyta tarcza sprzęgła', 'Worn clutch disc', 'Зношений диск зчеплення', 'Изношенный диск сцепления'],
          ['Koło dwumasowe', 'Dual-mass flywheel', 'Двомасовий маховик', 'Двухмассовый маховик'],
          ['Wysprzęglik lub siłownik', 'Release bearing or slave cylinder', 'Вижимний підшипник або робочий циліндр', 'Выжимной подшипник или рабочий цилиндр'],
        ],
      },
    ],
  },
];

// ── Как добраться ───────────────────────────────────────────────────────────
export const TRAVEL: { from: string; min: number; km: string }[] = [
  { from: 'Chomiczówka', min: 10, km: '4,4' },
  { from: 'Bielany — metro Słodowiec', min: 14, km: '6,5' },
  { from: 'Bemowo — ratusz', min: 18, km: '8,7' },
  { from: 'Łomianki — centrum', min: 18, km: '9,9' },
  { from: 'Żoliborz — pl. Wilsona', min: 22, km: '15,3' },
  { from: 'Wola — rondo Daszyńskiego', min: 25, km: '13,0' },
];

// ── Гарантия ────────────────────────────────────────────────────────────────
export const WARRANTY: { big: T; text: T }[] = [
  {
    big: ['6 miesięcy', '6 months', '6 місяців', '6 месяцев'],
    text: ['gwarancji na wykonaną usługę (robociznę) od dnia naprawy', 'warranty on labour from the repair date', 'гарантії на виконану роботу від дня ремонту', 'гарантии на выполненную работу со дня ремонта'],
  },
  {
    big: ['12–24 miesiące', '12–24 months', '12–24 місяці', '12–24 месяца'],
    text: ['na nowe części zamówione przez nas — zgodnie z gwarancją producenta', 'on new parts ordered by us — per manufacturer warranty', 'на нові запчастини, замовлені нами — за гарантією виробника', 'на новые запчасти, заказанные нами — по гарантии производителя'],
  },
  {
    big: ['Bez gwarancji', 'No warranty', 'Без гарантії', 'Без гарантии'],
    text: ['na części dostarczone przez klienta i naprawy tymczasowe „na dojazd”', 'on customer-supplied parts and temporary “get-you-home” repairs', 'на запчастини клієнта та тимчасові ремонти «щоб доїхати»', 'на запчасти клиента и временный ремонт «чтобы доехать»'],
  },
];

export const WHY: { icon: string; title: T; text: T }[] = [
  {
    icon: 'ribbon-outline',
    title: ['Doświadczenie', 'Experience', 'Досвід', 'Опыт'],
    text: ['Wieloletnie doświadczenie i niezbędne certyfikaty.', 'Years of experience and the right certifications.', 'Багаторічний досвід і необхідні сертифікати.', 'Многолетний опыт и необходимые сертификаты.'],
  },
  {
    icon: 'checkmark-done-outline',
    title: ['Jakość', 'Quality', 'Якість', 'Качество'],
    text: ['Części sprawdzonych producentów i nowoczesny sprzęt.', 'Parts from trusted makers and modern equipment.', 'Запчастини перевірених виробників і сучасне обладнання.', 'Запчасти проверенных производителей и современное оборудование.'],
  },
  {
    icon: 'shield-checkmark-outline',
    title: ['Niezawodność', 'Reliability', 'Надійність', 'Надёжность'],
    text: ['Gwarancja na wszystkie naprawy i usługi.', 'Warranty on all repairs and services.', 'Гарантія на всі ремонти та послуги.', 'Гарантия на все ремонты и услуги.'],
  },
];
