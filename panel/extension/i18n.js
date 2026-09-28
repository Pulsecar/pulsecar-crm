// Pulsecar: язык расширения (RU / PL). Тексты в коде — на русском, здесь перевод на польский.
// Строки с {x} — шаблоны: переменная часть переносится как есть.
// Используется в content-скриптах, popup, options и в фоне (importScripts).
(() => {
  const g = globalThis;
  if (g.pcT) return;
  const PL = {
    // окно «Pobierz do Pulsecar»
    'Фактура': 'Faktura', 'Корзина': 'Koszyk', 'Заказ у поставщика': 'Zamówienie u dostawcy', 'Отмена': 'Anuluj',
    'Документ поставщика': 'Dokument dostawcy', 'номер документа': 'numer dokumentu',
    'Создать товар в картотеке': 'Utwórz towar w kartotece',
    'цена оферты Allegro = закупка, продажа = закупка + наценка % (меняйте в колонке «Наценка»)': 'cena oferty Allegro = zakup, sprzedaż = zakup + narzut % (zmień w kolumnie „Narzut”)',
    'цена продажи = рекомендованная цена поставщика': 'cena sprzedaży = cena detaliczna dostawcy',
    'Оприходовать на склад (PZ)': 'Przyjmij na magazyn (PZ)', 'когда деталь уже приехала': 'gdy część już dotarła',
    'Добавить в заказ': 'Dodaj do zlecenia', 'нет открытых заказов': 'brak otwartych zleceń',
    'Добавить в выцену': 'Dodaj do wyceny', 'нет открытых выцен': 'brak otwartych wycen',
    'Список товаров': 'Lista towarów', 'Название': 'Nazwa', 'Код товара': 'Kod towaru', 'Производитель': 'Producent', 'Кол-во': 'Ilość',
    'Закупка нетто': 'Zakup netto', 'Закупка брутто': 'Zakup brutto', 'Продажа нетто': 'Sprzedaż netto', 'Продажа брутто': 'Sprzedaż brutto', 'Наценка %': 'Narzut %',
    'Наценка на закупку: (продажа − закупка) / закупка': 'Narzut na zakup: (sprzedaż − zakup) / zakup',
    'уже есть на складе: {n} шт.': 'już na magazynie: {n} szt.', 'цены из API Inter Cars': 'ceny z API Inter Cars',
    'Меняйте любое поле: нетто ↔ брутто пересчитываются по VAT, наценка % пересчитывает цену продажи, а новая цена продажи — наценку.':
      'Zmień dowolne pole: netto ↔ brutto przeliczają się wg VAT, narzut % przelicza cenę sprzedaży, a nowa cena sprzedaży – narzut.',
    'Поправьте данные:': 'Popraw dane:', '{x}: цена закупки должна быть больше 0': '{x}: cena zakupu musi być większa od 0',
    'Готово:': 'Gotowe:', 'сохранён(а) —': 'zapisano –', 'Склад → Поставщики': 'Magazyn → Dostawcy', 'товаров в картотеке: {n}': 'towarów w kartotece: {n}',
    'приход {x}': 'przyjęcie {x}', 'в заказе': 'w zleceniu', 'в выцене': 'w wycenie', 'Добавлено ✓': 'Dodano ✓',
    'Всё равно добавить позиции': 'Dodaj pozycje mimo to', 'Отметьте, куда добавить: склад, заказ или выцена.': 'Zaznacz, gdzie dodać: magazyn, zlecenie lub wycena.',
    'Забрать позиции с этой страницы в Pulsecar: корзину, фактуру, WZ, список деталей (или выделите строки мышкой)':
      'Zabierz pozycje z tej strony do Pulsecar: koszyk, fakturę, WZ, listę części (lub zaznacz wiersze myszką)',
    'Pulsecar: не нашёл таблицу. Выделите строки мышкой и нажмите ещё раз.': 'Pulsecar: nie znaleziono tabeli. Zaznacz wiersze myszką i kliknij ponownie.',
    'Язык': 'Język',
    // окно расширения (popup)
    'администратор': 'administrator', 'сотрудник': 'pracownik', 'механик': 'mechanik',
    'Не подключено': 'Nie połączono', 'Подключено': 'Połączono', 'Есть обновление': 'Dostępna aktualizacja', 'Скачать': 'Pobierz',
    'Откройте CRM → Склад → Поставщики и нажмите «Подключить расширение».': 'Otwórz CRM → Magazyn → Dostawcy i kliknij „Połącz rozszerzenie”.',
    'CRM не отвечает.': 'CRM nie odpowiada.', 'Вышла версия {v}.': 'Dostępna jest wersja {v}.',
    'Эта вкладка — не сайт': 'Ta karta nie jest stroną WWW', '{x}: кнопка работает': '{x}: przycisk działa',
    '{x}: кнопка включена вами': '{x}: przycisk włączony przez Ciebie', '{x}: поставщика нет в списке': '{x}: dostawcy nie ma na liście',
    'Убрать кнопку с этого сайта': 'Usuń przycisk z tej strony', 'Показывать кнопку на этом сайте': 'Pokazuj przycisk na tej stronie',
    'Проверяю вкладку…': 'Sprawdzam kartę…', 'Забрать позиции с этой страницы': 'Zabierz pozycje z tej strony', 'О расширении': 'O rozszerzeniu',
    'Версия расширения': 'Wersja rozszerzenia', 'Последняя версия': 'Najnowsza wersja', 'Дата последней проверки': 'Data ostatniego sprawdzenia',
    'Адрес CRM': 'Adres CRM', 'Сотрудник': 'Pracownik', 'Сервис': 'Serwis', 'Открыть CRM': 'Otwórz CRM', 'Проверить': 'Sprawdź', 'Настройки': 'Ustawienia',
    // настройки (options)
    'Pulsecar — настройки расширения': 'Pulsecar – ustawienia rozszerzenia', 'Pulsecar для поставщиков': 'Pulsecar – strony dostawców',
    'Кнопка «Pulsecar» у каждой детали в Inter Cars и на Allegro и кнопка в углу на сайтах поставщиков: запчасть сразу в заказ, выцену или на склад, фактура или WZ — в приход.':
      'Przycisk „Pulsecar” przy każdej części w Inter Cars i na Allegro oraz przycisk w rogu na stronach dostawców: część od razu do zlecenia, wyceny lub na magazyn, faktura lub WZ – do przyjęcia.',
    'Проще всего: откройте CRM → Склад → Поставщики и нажмите «Подключить расширение» — ключ передастся сам.':
      'Najprościej: otwórz CRM → Magazyn → Dostawcy i kliknij „Połącz rozszerzenie” – klucz przekaże się sam.',
    'Или вручную: там же «Получить ключ», вставьте его ниже и нажмите «Сохранить и проверить».':
      'Lub ręcznie: tam „Pobierz klucz”, wklej go poniżej i kliknij „Zapisz i sprawdź”.',
    'Поставщика нет в списке? Откройте его сайт, нажмите значок Pulsecar на панели Chrome → «Показывать кнопку на этом сайте».':
      'Dostawcy nie ma na liście? Otwórz jego stronę, kliknij ikonę Pulsecar na pasku Chrome → „Pokazuj przycisk na tej stronie”.',
    'Ключ сотрудника': 'Klucz pracownika', 'Сохранить и проверить': 'Zapisz i sprawdź', 'Фискальная касса': 'Kasa fiskalna',
    'Касса Novitus (NoviAPI) в сети сервиса: CRM печатает чеки через это расширение. Разрешите доступ к адресу кассы один раз на этом компьютере.':
      'Kasa Novitus (NoviAPI) w sieci warsztatu: CRM drukuje paragony przez to rozszerzenie. Zezwól na dostęp do adresu kasy raz na tym komputerze.',
    'Адрес кассы': 'Adres kasy', 'Разрешить доступ к кассе': 'Zezwól na dostęp do kasy', 'Проверить кассу': 'Sprawdź kasę',
    'Проверяю…': 'Sprawdzam…', 'Нет ответа от CRM': 'Brak odpowiedzi z CRM',
    'Подключено: {x}. Откройте каталог Inter Cars или Allegro — у деталей появится кнопка «Pulsecar».': 'Połączono: {x}. Otwórz katalog Inter Cars lub Allegro – przy częściach pojawi się przycisk „Pulsecar”.',
    'Адрес должен быть в локальной сети, например http://192.168.1.50:8888': 'Adres musi być w sieci lokalnej, np. http://192.168.1.50:8888',
    'Доступ разрешён. Теперь CRM может печатать чеки на этой кассе.': 'Dostęp przyznany. CRM może teraz drukować paragony na tej kasie.',
    'Доступ не разрешён': 'Dostęp nie został przyznany', 'Впишите адрес кассы': 'Wpisz adres kasy', 'Касса отвечает (NoviAPI) ✓': 'Kasa odpowiada (NoviAPI) ✓',
    'Касса ответила {x}': 'Kasa odpowiedziała {x}',
    'Касса не отвечает: {x}. Нажмите «Разрешить доступ к кассе», проверьте IP и что NoviAPI включён.': 'Kasa nie odpowiada: {x}. Kliknij „Zezwól na dostęp do kasy”, sprawdź IP i czy NoviAPI jest włączone.',
    // фон: ошибки, меню, касса
    'Расширение не подключено к CRM: откройте CRM → Склад → Поставщики → «Подключить расширение».': 'Rozszerzenie nie jest połączone z CRM: otwórz CRM → Magazyn → Dostawcy → „Połącz rozszerzenie”.',
    'Ошибка {x}': 'Błąd {x}', 'CRM недоступна: {x}': 'CRM niedostępny: {x}', 'нет ключа': 'brak klucza',
    'На этой странице кнопку не запустить: {x}': 'Na tej stronie nie można uruchomić przycisku: {x}',
    'Отправить выделенное в Pulsecar': 'Wyślij zaznaczenie do Pulsecar', 'Забрать позиции с этой страницы в Pulsecar': 'Zabierz pozycje z tej strony do Pulsecar',
    'Касса ограничила выдачу токенов, повторите после {x}': 'Kasa ograniczyła wydawanie tokenów, spróbuj ponownie po {x}', 'часа': 'godzinie',
    'Касса не выдала токен ({x})': 'Kasa nie wydała tokenu ({x})', 'ошибка': 'błąd', '{x} (код {c})': '{x} (kod {c})',
    'Адрес кассы должен быть в локальной сети, например http://192.168.1.50:8888 (Настройки → Интеграции → Фискальная касса)':
      'Adres kasy musi być w sieci lokalnej, np. http://192.168.1.50:8888 (Ustawienia → Integracje → Kasa fiskalna)',
    'Расширению нужно разрешение на доступ к кассе': 'Rozszerzenie potrzebuje zgody na dostęp do kasy', 'Неизвестная команда': 'Nieznane polecenie',
    'Касса не приняла документ: {x}': 'Kasa nie przyjęła dokumentu: {x}',
    'Касса ждёт дневной отчёт (raport dobowy) — сделайте его и повторите': 'Kasa czeka na raport dobowy – wykonaj go i spróbuj ponownie',
    'Касса не подтвердила печать: {x}': 'Kasa nie potwierdziła wydruku: {x}', 'Касса: {x}': 'Kasa: {x}',
    'Касса ещё не напечатала: {x}. Чек напечатается сам, когда касса будет готова.': 'Kasa jeszcze nie wydrukowała: {x}. Paragon wydrukuje się sam, gdy kasa będzie gotowa.',
    'Касса ещё не напечатала (проверьте бумагу). Чек напечатается сам, когда касса будет готова.': 'Kasa jeszcze nie wydrukowała (sprawdź papier). Paragon wydrukuje się sam, gdy kasa będzie gotowa.',
    'Касса не отвечает: {x}. Проверьте, что касса включена и компьютер в той же сети.': 'Kasa nie odpowiada: {x}. Sprawdź, czy kasa jest włączona, a komputer w tej samej sieci.',
    'нет ответа': 'brak odpowiedzi', 'Касса доступна только из CRM {x}': 'Kasa jest dostępna tylko z CRM {x}',
    'Адрес кассы должен быть в локальной сети': 'Adres kasy musi być w sieci lokalnej',
    'Касса не отвечает: {x}': 'Kasa nie odpowiada: {x}',
  };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const PATS = Object.entries(PL).filter(([k]) => /\{\w+\}/.test(k)).map(([k, v]) => {
    const names = [...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    return [new RegExp('^' + k.split(/\{\w+\}/).map(esc).join('([\\s\\S]+?)') + '$'), names, v];
  });
  let SRV = {}; // переводы сообщений самой CRM (panel/i18n/pl.json)
  let lang = /^(ru|uk|be)/i.test(g.navigator?.language || '') ? 'ru' : 'pl';

  /** Перевести строку (с подстановкой {x}) на текущий язык */
  function t(s, vars) {
    let out = s;
    if (lang === 'pl' && s) {
      const k = String(s).trim();
      if (PL[k] !== undefined) out = PL[k];
      else if (SRV[k] !== undefined) out = SRV[k];
      else for (const [re, names, v] of PATS) {
        const m = k.match(re);
        if (m) { out = names.reduce((a, n, i) => a.replace('{' + n + '}', t(m[i + 1])), v); break; }
      }
    }
    if (vars) for (const [n, v] of Object.entries(vars)) out = out.split('{' + n + '}').join(v);
    return out;
  }
  /** Перевести DOM (тексты, placeholder, title). Исходный русский текст запоминается — можно переключать туда-обратно */
  function tr(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      if (n.parentElement && /^(SCRIPT|STYLE)$/.test(n.parentElement.tagName)) continue;
      if (n.__pcOrig === undefined) { if (!/[А-Яа-яЁё]/.test(n.nodeValue)) continue; n.__pcOrig = n.nodeValue; }
      const o = n.__pcOrig, core = o.trim();
      const v = lang === 'pl' ? o.replace(core, t(core)) : o;
      if (n.nodeValue !== v) n.nodeValue = v;
    }
    for (const el of root.querySelectorAll ? root.querySelectorAll('[placeholder],[title]') : []) {
      for (const a of ['placeholder', 'title']) {
        if (!el.hasAttribute(a)) continue;
        const key = 'pcOrig' + a;
        if (el.dataset[key] === undefined) { if (!/[А-Яа-яЁё]/.test(el.getAttribute(a))) continue; el.dataset[key] = el.getAttribute(a); }
        el.setAttribute(a, t(el.dataset[key]));
      }
    }
  }
  const listeners = new Set();
  const ready = (async () => {
    try {
      const { lang: l } = await chrome.storage.sync.get('lang');
      if (l === 'ru' || l === 'pl') lang = l;
      const { srvI18n } = await chrome.storage.local.get('srvI18n');
      if (srvI18n && typeof srvI18n === 'object') SRV = srvI18n;
    } catch {}
  })();
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'sync' && ch.lang && (ch.lang.newValue === 'ru' || ch.lang.newValue === 'pl')) { lang = ch.lang.newValue; listeners.forEach((f) => f(lang)); }
      if (area === 'local' && ch.srvI18n?.newValue) SRV = ch.srvI18n.newValue;
    });
  } catch {}
  g.pcT = t;
  g.pcTr = tr;
  g.pcLang = () => lang;
  g.pcI18nReady = ready;
  g.pcSetLang = (l) => { lang = l; listeners.forEach((f) => f(lang)); return chrome.storage.sync.set({ lang: l }); };
  g.pcOnLang = (f) => listeners.add(f);
})();
