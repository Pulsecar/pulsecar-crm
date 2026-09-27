// Права сотрудников (как «Uprawnienia» в Motowarsztat): роль задаёт набор по умолчанию, галочки его уточняют
export const PERM_GROUPS = [
  ['Клиенты', [['clients.view', 'Видеть клиентов'], ['clients.create', 'Добавлять клиентов'], ['clients.edit', 'Изменять клиентов'], ['clients.contact', 'Видеть телефоны и e-mail']]],
  ['Автомобили', [['cars.view', 'Видеть авто'], ['cars.create', 'Добавлять авто'], ['cars.edit', 'Изменять авто']]],
  ['Заказы', [
    ['orders.view', 'Видеть заказы'], ['orders.only_assigned', 'Только заказы, где он механик'], ['orders.only_my_jobs', 'Видеть только свои работы и запчасти к ним'], ['orders.create', 'Создавать заказы'],
    ['orders.edit', 'Изменять данные заказа (клиент, авто, описание)'], ['orders.status', 'Менять статус'], ['orders.jobs', 'Добавлять и удалять работы и запчасти'],
    ['orders.prices', 'Видеть цены и суммы (работы и запчасти)'], ['orders.price_edit', 'Менять цены и скидки'], ['orders.mileage', 'Вносить пробег'],
    ['orders.payments', 'Принимать оплату'], ['orders.contact', 'Писать клиенту (SMS, e-mail, карта заказа)'], ['orders.delete', 'Удалять заказы']]],
  ['Выцены', [['quotes.manage', 'Создавать и изменять выцены']]],
  ['Терминарз', [['calendar.view', 'Видеть терминарз'], ['calendar.edit', 'Записывать и переносить визиты']]],
  ['Документы и деньги', [['invoices.create', 'Выставлять фактуры'], ['cash.view', 'Видеть кассу'], ['cash.edit', 'Приходы и расходы в кассе'],
    ['purchases.view', 'Видеть закупки и расходы'], ['purchases.edit', 'Добавлять закупки и расходы'], ['loyalty.use', 'Pulse Points: сканировать QR, списывать баллы']]],
  ['Склад', [['products.view', 'Видеть товары'], ['products.prices', 'Видеть закупочные цены'], ['products.create', 'Добавлять и изменять товары'],
    ['stock.docs', 'Приход, списание, инвентаризация'], ['suppliers.receive', 'Принимать поставки от поставщиков'], ['suppliers.order', 'Заказывать у поставщиков']]],
  ['Прочее', [['storage.view', 'Хранение шин: видеть'], ['storage.edit', 'Хранение шин: принимать и выдавать'], ['sms.view', 'Журнал SMS'], ['sms.send', 'Отправлять SMS'],
    ['reports.view', 'Отчёты и зарплаты'], ['catalog.edit', 'Менять прайс работ'], ['marketing.view', 'Маркетинг (панель бота)'], ['settings.manage', 'Настройки, сотрудники, интеграции']]],
];
export const ALL_PERMS = PERM_GROUPS.flatMap(([, list]) => list.map(([k]) => k));

const except = (...no) => Object.fromEntries(ALL_PERMS.map((k) => [k, !no.includes(k)]));
export const PRESETS = {
  admin: except('orders.only_assigned', 'orders.only_my_jobs'),
  staff: except('orders.only_assigned', 'orders.only_my_jobs', 'orders.delete', 'reports.view', 'settings.manage', 'catalog.edit'),
  mechanic: Object.fromEntries(ALL_PERMS.map((k) => [k, ['cars.view', 'orders.view', 'orders.only_my_jobs', 'orders.status', 'orders.mileage', 'calendar.view', 'products.view'].includes(k)])),
};

/** Итоговые права сотрудника: набор роли + его галочки. Администратор может всё. */
export function permsOf(s) {
  if (!s) return {};
  if (s.role === 'admin') return { ...PRESETS.admin, 'orders.only_assigned': false, 'orders.only_my_jobs': false };
  let own = {};
  try { own = s.permissions ? JSON.parse(s.permissions) : {}; } catch {}
  const base = PRESETS[s.role] || PRESETS.mechanic;
  return Object.fromEntries(ALL_PERMS.map((k) => [k, own[k] !== undefined ? !!own[k] : !!base[k]]));
}
export const can = (s, perm) => !!permsOf(s)[perm];
