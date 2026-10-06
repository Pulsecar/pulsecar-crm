// Настройка интерфейса для каждого сотрудника: какие виджеты главной, пункты меню, кнопки, вкладки и колонки он видит.
// Права (perms) решают, что сотрудник МОЖЕТ; здесь — что он ВИДИТ на экране (чтобы не мешало лишнее).
// Элемент помечается data-ui="ключ"; колонка таблицы — <table data-cols="таблица"> + <th data-c="колонка">.

export const UI_GROUPS = [
  ['Главная (кнопки вверху)', [['dash.btn.calendar', 'Кнопка «Терминарз»'], ['dash.btn.neworder', 'Кнопка «Новый заказ»']]],
  ['Левое меню', [
    ['menu.home', 'Главная'], ['menu.orders', 'Заказы'], ['menu.quotes', 'Выцены'], ['menu.calendar', 'Терминарз'], ['menu.customers', 'Клиенты'], ['menu.cars', 'Автомобили'],
    ['menu.stock', 'Склад'], ['menu.purchases', 'Закупки'], ['menu.storage', 'Хранение и парковка'], ['menu.sales', 'Продажи'], ['menu.cash', 'Касса'], ['menu.pos', 'Pulse Points'],
    ['menu.finance', 'Финансы'], ['menu.reports', 'Рапорты']]],
  ['Верхняя панель', [['top.search', 'Поиск'], ['top.neworder', 'Кнопка «+ Заказ»'], ['top.balances', 'Остатки (SMS, поиск по номеру)'], ['top.lang', 'Переключатель языка']]],
  ['Заказ — кнопки и вкладки', [
    ['order.btn.contact', 'Кнопки связи с клиентом (ссылка, SMS, e-mail)'], ['order.btn.card', 'Кнопка «Электронная карта заказа»'], ['order.btn.docs', 'Кнопка «Документы» (печать)'], ['order.btn.copy', 'Кнопка «Копировать»'], ['order.btn.toorder', 'Выцена → «Создать заказ»'], ['order.btn.delete', 'Кнопка «Удалить»'],
    ['order.tab.main', 'Вкладка «Основное»'], ['order.tab.items', 'Вкладка «Работы и товары»'], ['order.tab.files', 'Вкладка «Файлы и подписи»'], ['order.tab.pay', 'Вкладка «Оплата и документы»'],
    ['order.tab.contact', 'Вкладка «Связь с клиентом»'], ['order.tab.plan', 'Вкладка «Терминарз»'], ['order.tab.check', 'Вкладка «Чек-листы»'], ['order.tab.recs', 'Вкладка «Рекомендации»'], ['order.tab.log', 'Вкладка «История»'],
    ['order.media', 'Блок «Фото и видео для клиента»'], ['order.btn.catalog', 'Кнопка «Из прайса работ»'], ['order.btn.addpart', 'Кнопки добавления товаров']]],
  ['Заказ — колонки работ', [['labor.sel', 'Галочка выбора'], ['labor.lp', 'Lp.'], ['labor.name', 'Работа'], ['labor.mech', 'Механик'], ['labor.unit', 'Ед.'], ['labor.qty', 'Кол-во'], ['labor.price', 'Цена'],
    ['labor.disc', 'Скидка %'], ['labor.vat', 'VAT'], ['labor.net', 'Сумма нетто'], ['labor.gross', 'Сумма брутто'], ['labor.status', 'Статус']]],
  ['Заказ — колонки товаров', [['parts.lp', 'Lp.'], ['parts.name', 'Товар'], ['parts.code', 'Код'], ['parts.job', 'Работа'], ['parts.qty', 'Кол-во'], ['parts.unit', 'Ед.'], ['parts.price', 'Цена'],
    ['parts.cost', 'Себестоимость'], ['parts.disc', 'Скидка %'], ['parts.vat', 'VAT'], ['parts.net', 'Сумма нетто'], ['parts.gross', 'Сумма брутто']]],
  ['Список заказов и выцен — колонки', [['orders.number', 'Номер'], ['orders.created', 'Создан'], ['orders.status', 'Статус'], ['orders.followup', 'Обзвон (выцены)'], ['orders.customer', 'Клиент'], ['orders.car', 'Авто'],
    ['orders.intake', 'Приём / комментарий'], ['orders.comment', 'Комментарий (заказы)'], ['orders.source', 'Источник'], ['orders.labor_sum', 'Работы (выцены)'], ['orders.parts_sum', 'Запчасти (выцены)'], ['orders.total', 'Сумма'], ['orders.paid', 'Оплачено'], ['orders.btn.new', 'Кнопка «Новый заказ»']]],
  ['Клиенты — колонки', [['customers.name', 'Данные клиента'], ['customers.nip', 'NIP'], ['customers.phone', 'Телефон'], ['customers.email', 'E-mail'], ['customers.address', 'Адрес'], ['customers.cars', 'Авто'],
    ['customers.orders', 'Заказов'], ['customers.app', 'Приложение'], ['customers.consent', 'Согласие']]],
  ['Автомобили — колонки', [['cars.name', 'Марка / модель'], ['cars.plate', 'Номер'], ['cars.vin', 'VIN'], ['cars.owner', 'Владелец'], ['cars.year', 'Год'], ['cars.engine', 'Объём'], ['cars.fuel', 'Топливо'], ['cars.power', 'Мощность'], ['cars.mileage', 'Пробег']]],
  ['Склад — колонки', [['stock.name', 'Товар'], ['stock.code', 'Индекс'], ['stock.brand', 'Производитель'], ['stock.qty', 'Остаток'], ['stock.reserved', 'В резерве'], ['stock.free', 'Доступно'], ['stock.buy', 'Закупка нетто'], ['stock.sell', 'Продажа брутто'], ['stock.place', 'Место']]],
  ['Продажи — колонки', [['sales.doc', 'Документ'], ['sales.date', 'Дата'], ['sales.buyer', 'Покупатель'], ['sales.order', 'Заказ'], ['sales.pay', 'Оплата'], ['sales.net', 'Нетто'], ['sales.gross', 'Брутто'], ['sales.status', 'Статус']]],
  ['Касса — колонки', [['cash.time', 'Время'], ['cash.doc', 'Документ'], ['cash.box', 'Касса'], ['cash.method', 'Способ'], ['cash.who', 'Клиент / назначение'], ['cash.order', 'Заказ'], ['cash.staff', 'Кто'], ['cash.in', 'Приход'], ['cash.out', 'Расход']]],
  ['Закупки — колонки', [['purch.date', 'Дата'], ['purch.number', 'Номер'], ['purch.supplier', 'Поставщик'], ['purch.cat', 'Категория'], ['purch.due', 'Срок оплаты'], ['purch.net', 'Нетто'], ['purch.gross', 'Брутто'], ['purch.paid', 'Оплачено']]],
  ['Хранение — колонки', [['stor.number', 'Номер'], ['stor.customer', 'Клиент'], ['stor.car', 'Авто'], ['stor.what', 'Что'], ['stor.qty', 'Шт.'], ['stor.place', 'Место'], ['stor.from', 'Принято'], ['stor.until', 'До / выдано'], ['stor.total', 'Сумма'], ['stor.paid', 'Оплачено']]],
];
export const UI_KEYS = UI_GROUPS.flatMap(([, l]) => l.map(([k]) => k));

// готовые наборы — «скрыть» для типичных ролей (админ может поправить галочками)
export const UI_PRESETS = {
  'Всё видно': [],
  'Механик — только работа': ['dash.stat.today', 'dash.stat.month', 'dash.stat.closed', 'dash.unpaid', 'dash.requests', 'dash.btn.neworder', 'top.neworder', 'top.balances',
    'order.btn.copy', 'order.btn.delete', 'order.btn.docs', 'order.tab.contact', 'order.tab.plan', 'order.tab.log', 'labor.price', 'labor.disc', 'labor.vat', 'labor.net', 'labor.gross',
    'parts.price', 'parts.cost', 'parts.disc', 'parts.vat', 'parts.net', 'parts.gross', 'orders.total', 'orders.paid', 'orders.source', 'orders.labor_sum', 'orders.parts_sum'],
  'Приёмщик без финансов': ['dash.stat.month', 'dash.stat.closed', 'parts.cost', 'stock.buy', 'menu.finance', 'menu.reports'],
};

let hidden = new Set();
// блоки главной, которые можно переставлять (внутри своей группы: плитки — между собой, блоки — между собой)
export const DASH_TILES = ['dash.stat.today', 'dash.stat.month', 'dash.stat.closed', 'dash.stat.inwork'];
export const DASH_CARDS = ['dash.myorders', 'dash.calendar', 'dash.requests', 'dash.unpaid', 'dash.attention'];
export const DASH_OTHER = ['dash.btn.calendar', 'dash.btn.neworder', 'dash.statuses'];
/** Порядок из «@dash:…»; недостающие — в конце по умолчанию */
export function dashOrder(list) {
  const raw = (list || []).find((k) => k.startsWith('@dash:'));
  const saved = raw ? raw.slice(6).split(',').filter(Boolean) : [];
  return [...saved.filter((k) => DASH_TILES.includes(k) || DASH_CARDS.includes(k)), ...[...DASH_TILES, ...DASH_CARDS].filter((k) => !saved.includes(k))];
}
export const uiOn = (k) => !hidden.has(k);

let styleEl, obs, raf = 0;
export function applyUi(list) {
  const all = Array.isArray(list) ? list : [];
  hidden = new Set(all.filter((k) => !k.startsWith('@')));
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'ui-hide'; document.head.appendChild(styleEl); }
  // порядок блоков главной: элемент «@dash:ключ1,ключ2,…» → CSS order внутри своей сетки
  const order = dashOrder(all).map((k, i) => `[data-ui="${CSS.escape(k)}"]{order:${i + 1}}`).join('');
  styleEl.textContent = [...hidden].map((k) => `[data-ui="${CSS.escape(k)}"]`).join(',') + (hidden.size ? '{display:none!important}' : '') + '.ui-hc{display:none!important}' + order;
  if (!obs) {
    obs = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; hideCols(); }); });
    obs.observe(document.body, { childList: true, subtree: true });
  }
  hideCols();
}

/** Колонки: прячем th и ячейки той же позиции (с учётом colspan — строки итогов сужаются) */
function hideCols() {
  document.querySelectorAll('table[data-cols]').forEach((t) => {
    const name = t.dataset.cols;
    const head = t.tHead?.rows[t.tHead.rows.length - 1];
    if (!head) return;
    const off = new Set();
    let pos = 0;
    for (const th of head.cells) { if (th.dataset.c && hidden.has(name + '.' + th.dataset.c)) off.add(pos); pos += th.colSpan || 1; }
    for (const tr of t.rows) {
      let p = 0;
      for (const td of tr.cells) {
        const span = Number(td.dataset.cs || td.colSpan || 1);
        if (span > 1 && !td.dataset.cs) td.dataset.cs = String(span);
        let covered = 0;
        for (let x = p; x < p + span; x++) if (off.has(x)) covered++;
        if (span === 1) td.classList.toggle('ui-hc', covered === 1);
        else { const left = span - covered; td.classList.toggle('ui-hc', left <= 0); if (left > 0) td.colSpan = left; }
        p += span;
      }
    }
  });
}
