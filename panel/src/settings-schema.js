// Все настройки CRM в одном месте (разделы как в Motowarsztat → Ustawienia). Панель строит формы по этому описанию.
const yes = (k, label, hint) => ({ k, label, type: 'bool', hint });
const txt = (k, label, hint, extra = {}) => ({ k, label, type: 'text', hint, ...extra });
const num = (k, label, hint, extra = {}) => ({ k, label, type: 'number', hint, ...extra });
const sel = (k, label, options, hint) => ({ k, label, type: 'select', options, hint });

export const SETTINGS_SCHEMA = [
  { id: 'general', title: 'Общие', icon: 'gear', sections: [
    { title: 'Суммы и налоги', fields: [
      sel('show_amounts', 'Показывать суммы по умолчанию', [['gross', 'Брутто'], ['net', 'Нетто']]),
      txt('vat_rates', 'Ставки НДС в заказах и на складе, %', 'Через запятую, например 23,8,5,0'),
      num('default_vat', 'НДС по умолчанию, %'),
      yes('discounts_on', 'Скидки в заказах'),
      yes('proforma_on', 'Фактуры Pro forma'),
    ] },
    { title: 'Оплата', fields: [
      sel('payment_method_default', 'Способ оплаты по умолчанию', [['cash', 'Наличные'], ['card', 'Карта'], ['transfer', 'Перевод']]),
      num('payment_term_days', 'Срок оплаты фактуры, дней'),
    ] },
    { title: 'Печать документов', fields: [
      yes('doc_show_logo', 'Логотип на документах'),
      yes('doc_show_signatures', 'Места для подписей на карте заказа'),
      txt('order_terms', 'Условия внизу карты заказа', '', { multiline: true }),
      txt('doc_description_tpl', 'Описание в фактуре из заказа', 'Поля: [[pojazd.marka]], [[pojazd.model]], [[pojazd.rejestracja]], [[pojazd.vin]], [[zlecenie.przebieg]]', { multiline: true }),
    ] },
  ] },
  { id: 'workshop', title: 'Мастерская', icon: 'wrench', sections: [
    { title: 'Ставки и единицы', fields: [
      num('rbh_rate', 'Ставка нормо-часа (RBH) нетто, zł', 'Подставляется в работы с единицей «rbh»'),
      num('rbh_cost', 'Себестоимость нормо-часа нетто, zł', 'Для расчёта маржи на работах'),
      txt('labor_units', 'Единицы работ', 'Через запятую: oper, rbh, szt.'),
      txt('labor_unit_default', 'Единица работ по умолчанию'),
      num('max_job_hours', 'Максимум часов, которые механик может записать в задачу (0 — без ограничения)'),
      sel('mileage_unit', 'Единица пробега', [['km', 'км'], ['mi', 'мили'], ['mth', 'моточасы']]),
      sel('power_unit', 'Единица мощности', [['kW', 'кВт'], ['KM', 'л.с. (KM)']]),
    ] },
    { title: 'Правила выполнения', fields: [
      yes('only_assigned_finish', 'Работу может отметить выполненной только назначенный механик'),
      yes('require_mechanic_job', 'Нельзя отметить работу выполненной без механика'),
      yes('require_mechanic_all', 'Нельзя завершить заказ, пока во всех работах не выбран механик'),
      yes('block_finish_open_jobs', 'Нельзя завершить заказ с невыполненными работами'),
      yes('save_owner_from_aztec', 'При скане техпаспорта предлагать создать клиента-владельца'),
    ] },
    { title: 'Автоматическая смена статуса', fields: [
      { k: 'status_on_first_job', label: 'Когда начата первая работа — статус', type: 'status' },
      { k: 'status_on_all_jobs', label: 'Когда все работы выполнены — статус', type: 'status' },
      { k: 'status_on_sale_doc', label: 'После выставления фактуры — статус', type: 'status' },
    ] },
  ] },
  { id: 'orders', title: 'Заказы и сметы', icon: 'file', sections: [
    { title: 'Поля в заказе', fields: [
      yes('order_type_on', 'Источник заказа (Sarafanka, Facebook…)'),
      yes('field_internal', 'Внутренняя заметка'),
      yes('field_mechanic', 'Заметка для механика'),
      yes('field_faults', 'Обнаруженные неисправности'),
      yes('field_after', 'Замечания после выполнения'),
      yes('field_external_no', 'Внешний номер заказа'),
      yes('show_cost_column', 'Колонка закупочной цены у запчастей'),
      yes('free_code', 'Код товара у запчасти не со склада'),
    ] },
    { title: 'Срок выдачи', fields: [
      sel('pickup_format', 'Срок выдачи в заказе', [['datetime', 'Дата и время'], ['date', 'Только дата']]),
      num('pickup_warn_orange', 'Оранжевый, если до срока осталось ≤ дней'),
      num('pickup_warn_red', 'Красный, если до срока осталось ≤ дней'),
    ] },
  ] },
  { id: 'vehicles', title: 'Авто и клиенты', icon: 'car', sections: [
    { title: 'Автомобили', fields: [
      txt('vehicle_types', 'Типы транспорта', 'Через запятую'),
      yes('car_field_inspection', 'Поле «Техосмотр до»'), yes('car_field_insurance', 'Поле «Страховка до»'),
      yes('car_field_key', 'Поле «Номер ключа»'), yes('car_field_paint', 'Поле «Код краски»'),
      yes('car_field_tacho', 'Поле «Тахограф до»'), yes('car_field_axle', 'Поле «Номер оси»'), yes('car_field_hsn', 'Поля HSN/TSN'),
    ] },
    { title: 'Клиенты', fields: [
      yes('client_require_phone', 'Телефон клиента обязателен'),
      yes('client_marketing_default', 'Согласие на рассылки отмечено по умолчанию'),
    ] },
  ] },
  { id: 'calendar', title: 'Терминарз', icon: 'cal', sections: [
    { title: 'Вид', fields: [
      txt('hours_start', 'Сетка с', '', { input: 'time' }), txt('hours_end', 'Сетка до', '', { input: 'time' }),
      sel('slot_min', 'Шаг сетки', [['15', '15 мин'], ['30', '30 мин'], ['60', '60 мин']]),
      yes('calendar_auto_jobs', 'Автоматически добавлять новые работы в запланированный визит'),
    ] },
    { title: 'Часы работы', fields: [{ k: 'work_hours', label: 'Часы работы по дням недели', type: 'hours' }] },
  ] },
  { id: 'stock', title: 'Склад и хранение', icon: 'box', sections: [
    { title: 'Склад', fields: [
      num('default_markup', 'Наценка на запчасти по умолчанию, %', 'Для товаров от поставщиков и из файлов'),
      yes('stock_reserve_on_order', 'Резервировать запчасти, добавленные в заказ'),
      yes('stock_negative', 'Разрешить минусовой остаток при выдаче в заказ'),
    ] },
    { title: 'Хранение шин', fields: [
      num('storage_months', 'Срок хранения по умолчанию, месяцев'),
      num('storage_price', 'Цена хранения за сезон, zł'),
    ] },
  ] },
  { id: 'cash', title: 'Касса', icon: 'cash', sections: [
    { title: 'Касса', fields: [num('cash_opening', 'Наличные в кассе на старте, zł')] },
  ] },
];

export const SETTINGS_KEYS = SETTINGS_SCHEMA.flatMap((t) => t.sections.flatMap((s) => s.fields.map((f) => f.k)));
