// Электронная карта заказа для клиента: по умолчанию по-польски, клиент может переключить язык (PL · EN · UA · RU).
// Официальные документы (протоколы, kosztorys, фактуры) остаются только на польском — переводится лишь сама карта.
// [польский текст на карте, en, uk, ru]
const ROWS = [
  ['Administratorem danych osobowych jest:', 'Personal data controller:', 'Адміністратор персональних даних:', 'Администратор персональных данных:'],
  ['Telefon:', 'Phone:', 'Телефон:', 'Телефон:'],
  ['Telefon', 'Phone', 'Телефон', 'Телефон'],
  ['PRZÓD', 'FRONT', 'ПЕРЕД', 'ПЕРЕД'], ['TYŁ', 'REAR', 'ЗАД', 'ЗАД'],
  ['Data wyceny', 'Quote date', 'Дата кошторису', 'Дата сметы'],
  ['Data przyjęcia pojazdu', 'Vehicle drop-off date', 'Дата прийому авто', 'Дата приёма авто'],
  ['Planowany odbiór', 'Planned pick-up', 'Плановане отримання', 'Плановая выдача'],
  ['Dane klienta', 'Customer details', 'Дані клієнта', 'Данные клиента'],
  ['Imię i nazwisko', 'Full name', 'Ім’я та прізвище', 'Имя и фамилия'],
  ['Adres', 'Address', 'Адреса', 'Адрес'],
  ['Dane pojazdu', 'Vehicle details', 'Дані авто', 'Данные автомобиля'],
  ['Marka i model', 'Make and model', 'Марка і модель', 'Марка и модель'],
  ['Numer rejestracyjny', 'Registration number', 'Реєстраційний номер', 'Госномер'],
  ['Przebieg', 'Mileage', 'Пробіг', 'Пробег'],
  ['Poziom paliwa', 'Fuel level', 'Рівень пального', 'Уровень топлива'],
  ['rezerwa', 'reserve', 'резерв', 'резерв'], ['pełny', 'full', 'повний', 'полный'],
  ['Protokół przyjęcia', 'Vehicle intake report', 'Протокол прийому', 'Протокол приёма'],
  ['Protokół wydania', 'Vehicle release report', 'Протокол видачі', 'Протокол выдачи'],
  ['Kosztorys', 'Cost estimate', 'Кошторис', 'Смета'],
  ['Wycena', 'Quote', 'Кошторис', 'Смета'],
  ['Podpisany', 'Signed', 'Підписано', 'Подписан'], ['Do podpisu', 'To sign', 'До підпису', 'Ожидает подписи'],
  ['Zaakceptowany', 'Accepted', 'Погоджено', 'Согласовано'], ['Do akceptacji', 'Awaiting approval', 'Очікує погодження', 'Ожидает согласования'],
  ['Opis zlecenia', 'Job description', 'Опис замовлення', 'Описание заказа'],
  ['Lista zadań', 'Task list', 'Список робіт', 'Список работ'],
  ['Opis uszkodzeń', 'Damage notes', 'Опис пошкоджень', 'Описание повреждений'],
  ['Brak adnotacji o uszkodzeniach', 'No damage noted', 'Пошкоджень не зазначено', 'Повреждений не отмечено'],
  ['Rysa', 'Scratch', 'Подряпина', 'Царапина'], ['Wgniecenie', 'Dent', 'Вм’ятина', 'Вмятина'], ['Odprysk', 'Chip', 'Скол', 'Скол'],
  ['Pęknięcie', 'Crack', 'Тріщина', 'Трещина'], ['Korozja', 'Corrosion', 'Корозія', 'Коррозия'], ['Brak elementu', 'Missing part', 'Відсутня деталь', 'Нет детали'], ['Inne', 'Other', 'Інше', 'Другое'],
  ['Podgląd dokumentu', 'View document (PL)', 'Переглянути документ (PL)', 'Открыть документ (PL)'],
  ['Potwierdzam przekazanie pojazdu do serwisu na powyższych warunkach.', 'I confirm handing over the vehicle to the service on the above terms.', 'Підтверджую передачу авто в сервіс на зазначених умовах.', 'Подтверждаю передачу автомобиля в сервис на указанных условиях.'],
  ['Akceptuję wycenę i proszę o wykonanie prac.', 'I accept the quote and ask for the work to be done.', 'Погоджую кошторис і прошу виконати роботи.', 'Согласен со сметой и прошу выполнить работы.'],
  ['Akceptuję zakres prac i koszty z kosztorysu.', 'I accept the scope of work and the costs in the estimate.', 'Погоджую обсяг робіт і вартість з кошторису.', 'Согласен с объёмом работ и стоимостью по смете.'],
  ['Potwierdzam odbiór pojazdu.', 'I confirm collecting the vehicle.', 'Підтверджую отримання авто.', 'Подтверждаю получение автомобиля.'],
  ['Akceptuję', 'I accept', 'Погоджую', 'Согласен'],
  ['Kod z SMS', 'SMS code', 'Код з SMS', 'Код из SMS'], ['Podpisz kodem', 'Sign with code', 'Підписати кодом', 'Подписать кодом'],
  ['Wyślij kod ponownie', 'Resend code', 'Надіслати код ще раз', 'Отправить код ещё раз'], ['Podpisz kodem SMS', 'Sign with SMS code', 'Підписати кодом з SMS', 'Подписать кодом из SMS'],
  ['Podpisz odręcznie', 'Sign by hand', 'Підписати від руки', 'Подписать от руки'], ['Wyczyść', 'Clear', 'Очистити', 'Очистить'], ['Podpisz dokument', 'Sign document', 'Підписати документ', 'Подписать документ'],
  ['Usługa', 'Service', 'Послуга', 'Работа'], ['Część', 'Part', 'Запчастина', 'Запчасть'], ['Kod', 'Code', 'Код', 'Код'], ['Producent', 'Manufacturer', 'Виробник', 'Производитель'],
  ['Ilość', 'Qty', 'Кількість', 'Кол-во'], ['Cena jedn. netto', 'Unit price net', 'Ціна за од. нетто', 'Цена за ед. нетто'], ['Cena jedn. brutto', 'Unit price gross', 'Ціна за од. брутто', 'Цена за ед. брутто'], ['Wartość', 'Amount', 'Сума', 'Сумма'],
  ['Razem netto', 'Total net', 'Разом нетто', 'Итого нетто'], ['Razem brutto', 'Total gross', 'Разом брутто', 'Итого брутто'],
  ['Zapłacono', 'Paid', 'Сплачено', 'Оплачено'], ['Do zapłaty', 'To pay', 'До сплати', 'К оплате'],
  ['Kosztorys jest w przygotowaniu.', 'The estimate is being prepared.', 'Кошторис готується.', 'Смета готовится.'],
  ['Kosztorys będzie widoczny po podpisaniu protokołu przyjęcia.', 'The estimate will be visible after signing the intake report.', 'Кошторис буде видно після підписання протоколу прийому.', 'Смета будет видна после подписания протокола приёма.'],
  ['Wykonane prace', 'Work performed', 'Виконані роботи', 'Выполненные работы'], ['Uwagi po wykonaniu', 'Notes after the work', 'Примітки після робіт', 'Замечания после работ'],
  ['Zdjęcia i pliki', 'Photos and files', 'Фото та файли', 'Фото и файлы'], ['Dokumenty sprzedaży', 'Sales documents', 'Документи продажу', 'Документы продажи'],
  ['Otwórz', 'Open', 'Відкрити', 'Открыть'], ['Historia podpisów', 'Signature history', 'Історія підписів', 'История подписей'],
  ['Rodzaj dokumentu', 'Document', 'Документ', 'Документ'], ['Data podpisu', 'Signed on', 'Дата підпису', 'Дата подписи'], ['Rodzaj podpisu', 'Signature type', 'Тип підпису', 'Тип подписи'], ['Podpisany dokument', 'Signed document', 'Підписаний документ', 'Подписанный документ'],
  ['Brak podpisanych dokumentów', 'No signed documents', 'Немає підписаних документів', 'Подписанных документов нет'],
  ['Przycisk „Akceptuję”', '“I accept” button', 'Кнопка «Погоджую»', 'Кнопка «Согласен»'], ['Kod SMS', 'SMS code', 'Код SMS', 'Код SMS'], ['Podpis odręczny', 'Handwritten signature', 'Підпис від руки', 'Подпись от руки'], ['Podpis na papierze', 'Signed on paper', 'Підпис на папері', 'Подпись на бумаге'],
  ['Faktura VAT', 'VAT invoice', 'Фактура VAT', 'Фактура VAT'], ['Faktura Pro forma', 'Pro forma invoice', 'Фактура Pro forma', 'Фактура Pro forma'], ['Faktura korygująca', 'Correction invoice', 'Коригувальна фактура', 'Корректирующая фактура'],
  ['Dziękujemy! Dokument został podpisany.', 'Thank you! The document has been signed.', 'Дякуємо! Документ підписано.', 'Спасибо! Документ подписан.'],
  ['Dziękujemy! Potwierdzenie zostało zapisane.', 'Thank you! Your confirmation has been saved.', 'Дякуємо! Підтвердження збережено.', 'Спасибо! Подтверждение сохранено.'],
  ['Wysłaliśmy SMS z kodem — wpisz go poniżej.', 'We sent you an SMS code — enter it below.', 'Ми надіслали SMS з кодом — введіть його нижче.', 'Мы отправили SMS с кодом — введите его ниже.'],
  ['Nieprawidłowy lub nieaktualny kod. Spróbuj ponownie.', 'Invalid or expired code. Please try again.', 'Неправильний або прострочений код. Спробуйте ще раз.', 'Неверный или устаревший код. Попробуйте ещё раз.'],
  ['Zbyt wiele prób. Spróbuj za kilka minut.', 'Too many attempts. Try again in a few minutes.', 'Забагато спроб. Спробуйте за кілька хвилин.', 'Слишком много попыток. Попробуйте через несколько минут.'],
  ['Brak numeru telefonu — skontaktuj się z nami.', 'No phone number — please contact us.', 'Немає номера телефону — зв’яжіться з нами.', 'Нет номера телефона — свяжитесь с нами.'],
  ['Brak podpisu — narysuj podpis w polu.', 'No signature — please draw it in the box.', 'Немає підпису — намалюйте підпис у полі.', 'Нет подписи — нарисуйте подпись в поле.'],
  ['Płatność online jest chwilowo niedostępna. Skorzystaj z przelewu lub zapłać w serwisie.', 'Online payment is temporarily unavailable. Please pay by bank transfer or at the service.', 'Онлайн-оплата тимчасово недоступна. Оплатіть переказом або в сервісі.', 'Онлайн-оплата временно недоступна. Оплатите переводом или в сервисе.'],
  ['Najpierw podpisz protokół przyjęcia.', 'Please sign the intake report first.', 'Спочатку підпишіть протокол прийому.', 'Сначала подпишите протокол приёма.'],
  ['Proszę złożyć podpis w polu.', 'Please sign in the box.', 'Будь ласка, поставте підпис у полі.', 'Пожалуйста, распишитесь в поле.'],
  ['Nie znaleziono', 'Not found', 'Не знайдено', 'Не найдено'], ['Link jest nieprawidłowy lub dokument został usunięty.', 'The link is invalid or the document was deleted.', 'Посилання недійсне або документ видалено.', 'Ссылка неверна или документ удалён.'],
  // статусы, которые видит клиент (client_label)
  ['Przyjęte', 'Received', 'Прийнято', 'Принят'], ['Czekamy na Twoją akceptację', 'Waiting for your approval', 'Чекаємо на ваше погодження', 'Ждём вашего согласия'], ['Czekamy na Ciebie', 'Waiting for you', 'Чекаємо на вас', 'Ждём вас'],
  ['W naprawie', 'In repair', 'У ремонті', 'В ремонте'], ['Prace wykonane', 'Work completed', 'Роботи виконано', 'Работы выполнены'], ['Przygotowujemy wycenę', 'Preparing the quote', 'Готуємо кошторис', 'Готовим смету'],
  ['Gotowe do odbioru', 'Ready for pick-up', 'Готово до видачі', 'Готово к выдаче'], ['Zakończone', 'Completed', 'Завершено', 'Завершено'], ['Anulowane', 'Cancelled', 'Скасовано', 'Отменено'], ['Zlecenie utworzone', 'Order created', 'Замовлення створено', 'Заказ создан'],
];
const IDX = { en: 1, uk: 2, ru: 3 };
const dict = Object.fromEntries(Object.keys(IDX).map((l) => [l, Object.fromEntries(ROWS.map((r) => [r[0], r[IDX[l]]]))]));
// фразы с числами: «Zapłać online 120,00 zł · BLIK, karta», «Przelew: …», «rabat 10%»
const PATTERNS = {
  en: [[' · Telefon:', ' · Phone:'], ['^Zapłać online (.+) · BLIK, karta$', 'Pay online $1 · BLIK, card'], ['^Przelew:', 'Bank transfer:'], ['tytuł:', 'reference:'], ['^rabat ', 'discount '], ['^Faktura (.*) \\(PDF\\)$', 'Invoice $1 (PDF)']],
  uk: [[' · Telefon:', ' · Телефон:'], ['^Zapłać online (.+) · BLIK, karta$', 'Оплатити онлайн $1 · BLIK, картка'], ['^Przelew:', 'Переказ:'], ['tytuł:', 'призначення:'], ['^rabat ', 'знижка '], ['^Faktura (.*) \\(PDF\\)$', 'Фактура $1 (PDF)']],
  ru: [[' · Telefon:', ' · Телефон:'], ['^Zapłać online (.+) · BLIK, karta$', 'Оплатить онлайн $1 · BLIK, карта'], ['^Przelew:', 'Перевод:'], ['tytuł:', 'назначение:'], ['^rabat ', 'скидка '], ['^Faktura (.*) \\(PDF\\)$', 'Фактура $1 (PDF)']],
};

export const CARD_LANG_CSS = `.langs{display:flex;gap:4px;justify-content:flex-end;margin:0 0 10px}.langs a{font:600 12px/1 system-ui,sans-serif;padding:6px 9px;border-radius:7px;border:1px solid #d9dce1;color:#444;text-decoration:none;background:#fff}.langs a.on{background:#15171a;color:#fff;border-color:#15171a}`;
export const CARD_LANG_BAR = `<nav class="langs" aria-label="Język / Language">${[['pl', 'PL'], ['en', 'EN'], ['uk', 'UA'], ['ru', 'RU']].map(([k, l]) => `<a href="?lang=${k}" data-lang="${k}">${l}</a>`).join('')}</nav>`;
export const CARD_LANG_JS = `(function(){var D=${JSON.stringify(dict)},P=${JSON.stringify(PATTERNS)};
var q=new URLSearchParams(location.search).get('lang'),L;try{if(q)localStorage.setItem('pc_card_lang',q);L=q||localStorage.getItem('pc_card_lang')||'pl'}catch(e){L=q||'pl'}
document.querySelectorAll('.langs a').forEach(function(a){if(a.dataset.lang===L)a.className='on';a.addEventListener('click',function(e){e.preventDefault();try{localStorage.setItem('pc_card_lang',a.dataset.lang)}catch(_){}var u=new URL(location.href);u.searchParams.delete('m');u.searchParams.set('lang',a.dataset.lang);location.href=u.toString()})});
if(L==='pl'||!D[L])return;document.documentElement.lang=L==='uk'?'uk':L;var d=D[L],pp=(P[L]||[]).map(function(x){return[new RegExp(x[0]),x[1]]});
function tr(s){var t=s.trim();if(!t)return s;if(d[t]!==undefined)return s.replace(t,d[t]);var b=t.replace(/[:.]$/,'');if(b!==t&&d[b]!==undefined)return s.replace(b,d[b]);var o=t;pp.forEach(function(r){o=o.replace(r[0],r[1])});return o!==t?s.replace(t,o):s}
var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),n,a=[];while(n=w.nextNode())a.push(n);a.forEach(function(n){if(n.parentNode&&/^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName))return;var v=tr(n.nodeValue);if(v!==n.nodeValue)n.nodeValue=v});
var oa=window.alert;window.alert=function(m){oa(tr(String(m)))};document.title=tr(document.title.replace(/^(Wycena|Zlecenie) /,function(x){return x}))})();`;
