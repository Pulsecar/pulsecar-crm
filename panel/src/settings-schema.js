// Все настройки CRM в одном месте (разделы как в Motowarsztat → Ustawienia). Панель строит формы по этому описанию.
const yes = (k, label, hint) => ({ k, label, type: 'bool', hint });
const txt = (k, label, hint, extra = {}) => ({ k, label, type: 'text', hint, ...extra });
const num = (k, label, hint, extra = {}) => ({ k, label, type: 'number', hint, ...extra });
const sel = (k, label, options, hint) => ({ k, label, type: 'select', options, hint });
const ACC = (k, label) => sel(k, label, [['button,sms', 'Кнопка «Akceptuję» или код SMS'], ['button', 'Только кнопка «Akceptuję»'], ['sms', 'Только код SMS'], ['', 'Без подписи']]);

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
  { id: 'orders', title: 'Заказы и выцены', icon: 'file', sections: [
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
  { id: 'documents', title: 'Вид документов', icon: 'file', sections: [
    { title: 'Общие', fields: [
      yes('doc_show_logo', 'Логотип на документах'),
      yes('doc_show_signatures', 'Места для подписей'),
      yes('doc_code_in_name', 'Код товара в начале названия (LMI19719 Końcówka drążka)'),
      txt('doc_place', 'Место выставления документов'),
      txt('doc_footer', 'Текст внизу каждого документа', '', { multiline: true }),
    ] },
    { title: 'Kosztorys / Wycena', fields: [
      txt('est_person', 'Подпись: кто выставляет (по умолчанию — автор заказа)'),
      num('quote_valid_days', 'Wycena действительна, дней'),
      yes('est_net', 'Итоговая стоимость нетто'), yes('est_gross', 'Итоговая стоимость брутто'),
      yes('est_labor_net', 'Работы: цена за единицу нетто'), yes('est_labor_gross', 'Работы: цена за единицу брутто'),
      yes('est_parts_code', 'Запчасти: код товара'), yes('est_parts_brand', 'Запчасти: производитель'),
      yes('est_parts_net', 'Запчасти: цена за единицу нетто'), yes('est_parts_gross', 'Запчасти: цена за единицу брутто'),
      txt('est_extra', 'Дополнительный текст', '', { multiline: true }),
    ] },
    { title: 'Karta dla mechanika', fields: [
      yes('mech_contact', 'Контакты клиента'), yes('mech_basic', 'Таблица с основными данными заказа'), yes('mech_station', 'Колонка с постом'),
      yes('mech_code', 'Код товара'), yes('mech_vehicle_end', 'Данные авто в конце'),
      num('mech_extra_labor', 'Пустых строк в списке работ'), num('mech_extra_parts', 'Пустых строк в списке запчастей'),
    ] },
    { title: 'Specyfikacja zlecenia', fields: [
      txt('spec_person', 'Подпись: кто выставляет'), yes('spec_after_notes', 'Поле «Uwagi po wykonaniu zlecenia»'), yes('spec_qty', 'Количество'), yes('spec_parts_code', 'Код товара'),
      yes('spec_labor_net', 'Работы: цена нетто'), yes('spec_labor_gross', 'Работы: цена брутто'), yes('spec_parts_net', 'Запчасти: цена нетто'), yes('spec_parts_gross', 'Запчасти: цена брутто'),
    ] },
    { title: 'Протоколы приёма и выдачи', fields: [
      txt('intake_person', 'Подпись в протоколе приёма'), txt('release_person', 'Подпись в протоколе выдачи'),
      txt('intake_terms', 'Условия в протоколе приёма', 'Если пусто — берётся «Условия внизу карты заказа»', { multiline: true }),
      txt('release_terms', 'Текст протокола выдачи', '', { multiline: true }),
    ] },
    { title: 'Документы продажи (фактуры)', fields: [
      sel('invoice_mode', 'Фактура VAT', [['auto', 'KSeF напрямую, если подключён (иначе Fakturownia, если подключена)'], ['fakturownia', 'Через Fakturownia'], ['local', 'Только в CRM (без KSeF)']]),
      txt('sale_person', 'Подпись: кто выставляет фактуры'),
      yes('sale_code', 'Код товара'), yes('sale_gtu', 'Код GTU'), yes('sale_discount', 'Показывать скидку'), yes('sale_order_line', 'Строка с заказом и авто (VIN, пробег)'),
      yes('sale_mpp', 'Надпись «Mechanizm podzielonej płatności» от 15 000 zł'),
      txt('sale_footer', 'Текст внизу фактуры', '', { multiline: true }),
    ] },
    { title: 'Склад, касса, хранение', fields: [
      txt('stock_person', 'Подпись на складских документах'), yes('stock_code', 'Код товара'), yes('stock_location', 'Место на складе'), yes('wz_cost_col', 'WZ: колонка «Koszt zakupu»'),
      txt('cash_person', 'Подпись на KP/KW'), txt('storage_person', 'Подпись на депозите шин'),
      txt('storage_terms', 'Условия хранения шин', '[[firma]] — название фирмы', { multiline: true }),
    ] },
  ] },
  { id: 'card', title: 'Электронная карта', icon: 'file', sections: [
    { title: 'Общее', fields: [
      yes('card_show_company', 'Данные сервиса в шапке карты'), yes('card_show_status', 'Текущий статус заказа'), yes('card_files', 'Фото и файлы из заказа'),
      yes('card_show_invoice', 'Документы продажи (фактуры) по ссылке'), yes('card_show_bank', 'Номер счёта для перевода'), yes('card_drawn_signature', 'Подпись от руки (пальцем на телефоне)'),
      { k: 'card_accept_status_id', label: 'После принятия выцены клиентом — статус', type: 'status' },
    ] },
    { title: 'Протокол приёма', fields: [
      yes('card_intake_on', 'Показывать протокол приёма'), ACC('card_intake_accept', 'Как клиент подписывает'),
      yes('card_intake_desc', 'Описание заказа'), yes('card_intake_tasks', 'Список работ'), yes('card_intake_damage', 'Повреждения авто (схема)'),
      txt('card_rodo', 'Текст RODO', '', { multiline: true }), txt('card_intake_extra', 'Дополнительный текст', '', { multiline: true }),
    ] },
    { title: 'Kosztorys', fields: [
      yes('card_estimate_on', 'Показывать kosztorys'), ACC('card_estimate_accept', 'Как клиент принимает'),
      yes('card_quote_after_protocol', 'Показывать kosztorys только после подписи протокола приёма'),
      yes('card_show_net', 'Сумма нетто'), yes('card_pay_online', 'Кнопка онлайн-оплаты (Tpay)'),
      yes('card_labor_net', 'Работы: цена нетто'), yes('card_labor_gross', 'Работы: цена брутто'),
      yes('card_parts_code', 'Запчасти: код'), yes('card_parts_brand', 'Запчасти: производитель'), yes('card_parts_net', 'Запчасти: цена нетто'), yes('card_parts_gross', 'Запчасти: цена брутто'),
      txt('card_estimate_extra', 'Дополнительный текст', '', { multiline: true }),
    ] },
    { title: 'Протокол выдачи', fields: [
      yes('card_release_on', 'Показывать протокол выдачи, когда заказ завершён'), ACC('card_release_accept', 'Как клиент подписывает'),
      txt('card_extra', 'Текст внизу карты', '', { multiline: true }),
    ] },
  ] },
  { id: 'cash', title: 'Касса', icon: 'cash', sections: [
    { title: 'Касса', fields: [num('cash_opening', 'Наличные в кассе на старте, zł')] },
  ] },
];

export const SETTINGS_KEYS = SETTINGS_SCHEMA.flatMap((t) => t.sections.flatMap((s) => s.fields.map((f) => f.k)));
