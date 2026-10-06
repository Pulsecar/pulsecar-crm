import { createContext, useContext } from 'react';
import { getLocales } from 'expo-localization';

export type Lang = 'pl' | 'en' | 'uk' | 'ru';
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'pl', label: 'Polski' },
  { code: 'en', label: 'English' },
  { code: 'uk', label: 'Українська' },
  { code: 'ru', label: 'Русский' },
];

/** Перевод: [pl, en, uk, ru] */
type T = [string, string, string, string];
const IDX: Record<Lang, number> = { pl: 0, en: 1, uk: 2, ru: 3 };

const ui = {
  appName: ['Pulsecar CRM', 'Pulsecar CRM', 'Pulsecar CRM', 'Pulsecar CRM'],
  // вход
  loginTitle: ['Logowanie do CRM', 'Sign in to CRM', 'Вхід до CRM', 'Вход в CRM'],
  loginSub: ['Ten sam login i hasło co w panelu panel.pulsecar.tech', 'Same login and password as in panel.pulsecar.tech', 'Ті самі логін і пароль, що в панелі panel.pulsecar.tech', 'Тот же логин и пароль, что в панели panel.pulsecar.tech'],
  login: ['Login', 'Login', 'Логін', 'Логин'],
  password: ['Hasło', 'Password', 'Пароль', 'Пароль'],
  signIn: ['Zaloguj się', 'Sign in', 'Увійти', 'Войти'],
  noAccount: ['Konto pracownika zakłada administrator warsztatu.', 'Staff accounts are created by the shop administrator.', 'Обліковий запис працівника створює адміністратор сервісу.', 'Аккаунт сотрудника создаёт администратор сервиса.'],
  showPass: ['Pokaż hasło', 'Show password', 'Показати пароль', 'Показать пароль'],
  // вкладки
  tabSchedule: ['Terminarz', 'Schedule', 'Терміни', 'Терминарз'],
  tabOrders: ['Zlecenia', 'Orders', 'Замовлення', 'Злецения'],
  tabQuotes: ['Wyceny', 'Quotes', 'Оцінки', 'Выцены'],
  tabCrm: ['Pełny CRM', 'Full CRM', 'Повна CRM', 'Полная CRM'],
  tabMore: ['Profil', 'Profile', 'Профіль', 'Профиль'],
  // общие
  loading: ['Ładowanie…', 'Loading…', 'Завантаження…', 'Загрузка…'],
  retry: ['Spróbuj ponownie', 'Try again', 'Спробувати ще', 'Повторить'],
  offline: ['Brak połączenia z CRM', 'No connection to CRM', 'Немає зʼєднання з CRM', 'Нет связи с CRM'],
  cancel: ['Anuluj', 'Cancel', 'Скасувати', 'Отмена'],
  save: ['Zapisz', 'Save', 'Зберегти', 'Сохранить'],
  close: ['Zamknij', 'Close', 'Закрити', 'Закрыть'],
  back: ['Wstecz', 'Back', 'Назад', 'Назад'],
  empty: ['Nic tu nie ma', 'Nothing here', 'Тут порожньо', 'Здесь пусто'],
  search: ['Szukaj: numer, klient, tablica, VIN', 'Search: number, customer, plate, VIN', 'Пошук: номер, клієнт, номер авто, VIN', 'Поиск: номер, клиент, номер авто, VIN'],
  open: ['Otwarte', 'Open', 'Відкриті', 'Открытые'],
  all: ['Wszystkie', 'All', 'Усі', 'Все'],
  more: ['Pokaż więcej', 'Show more', 'Показати ще', 'Показать ещё'],
  // терминарз
  today: ['Dziś', 'Today', 'Сьогодні', 'Сегодня'],
  noVisits: ['Brak wizyt tego dnia', 'No visits this day', 'Немає візитів цього дня', 'Нет визитов в этот день'],
  minutes: ['min', 'min', 'хв', 'мин'],
  request: ['Prośba o termin', 'Booking request', 'Запит на запис', 'Заявка на запись'],
  // заказ
  status: ['Status', 'Status', 'Статус', 'Статус'],
  changeStatus: ['Zmień status', 'Change status', 'Змінити статус', 'Сменить статус'],
  customer: ['Klient', 'Customer', 'Клієнт', 'Клиент'],
  car: ['Pojazd', 'Vehicle', 'Авто', 'Авто'],
  mileage: ['Przebieg', 'Mileage', 'Пробіг', 'Пробег'],
  complaint: ['Opis klienta', 'Customer complaint', 'Опис клієнта', 'Описание клиента'],
  mechanicNote: ['Notatka mechanika', 'Mechanic note', 'Нотатка механіка', 'Заметка механика'],
  jobs: ['Usługi', 'Labour', 'Роботи', 'Работы'],
  parts: ['Części', 'Parts', 'Запчастини', 'Запчасти'],
  total: ['Razem', 'Total', 'Разом', 'Итого'],
  paid: ['Zapłacono', 'Paid', 'Сплачено', 'Оплачено'],
  comments: ['Komentarze', 'Comments', 'Коментарі', 'Комментарии'],
  addComment: ['Dodaj komentarz…', 'Add a comment…', 'Додати коментар…', 'Добавить комментарий…'],
  send: ['Wyślij', 'Send', 'Надіслати', 'Отправить'],
  photos: ['Zdjęcia i pliki', 'Photos and files', 'Фото і файли', 'Фото и файлы'],
  takePhoto: ['Zrób zdjęcie', 'Take photo', 'Зробити фото', 'Сделать фото'],
  pickPhoto: ['Z galerii', 'From gallery', 'З галереї', 'Из галереи'],
  uploading: ['Wysyłanie zdjęć…', 'Uploading photos…', 'Надсилання фото…', 'Отправка фото…'],
  uploaded: ['Zdjęcia dodane', 'Photos added', 'Фото додано', 'Фото добавлены'],
  intakeDone: ['Zdjęcia z przyjęcia zrobione', 'Intake photos done', 'Фото прийому зроблено', 'Фото приёмки сделаны'],
  call: ['Zadzwoń', 'Call', 'Подзвонити', 'Позвонить'],
  sms: ['SMS', 'SMS', 'SMS', 'SMS'],
  openInCrm: ['Otwórz w pełnym CRM', 'Open in full CRM', 'Відкрити в повній CRM', 'Открыть в полной CRM'],
  planned: ['Termin', 'Scheduled', 'Термін', 'Запланировано'],
  doneMark: ['Wykonane', 'Done', 'Виконано', 'Выполнено'],
  cameraDenied: ['Brak dostępu do aparatu. Włącz go w ustawieniach telefonu.', 'No camera access. Enable it in phone settings.', 'Немає доступу до камери. Увімкніть його в налаштуваннях телефону.', 'Нет доступа к камере. Включите его в настройках телефона.'],
  // профиль
  role_admin: ['Administrator', 'Administrator', 'Адміністратор', 'Администратор'],
  role_staff: ['Kierownik / doradca', 'Manager / advisor', 'Менеджер', 'Менеджер'],
  role_mechanic: ['Mechanik', 'Mechanic', 'Механік', 'Механик'],
  notifications: ['Powiadomienia', 'Notifications', 'Сповіщення', 'Уведомления'],
  ev_booking: ['Nowe rezerwacje i zgłoszenia', 'New bookings and requests', 'Нові записи і заявки', 'Новые записи и заявки'],
  ev_assigned: ['Przydzielone mi zlecenia', 'Orders assigned to me', 'Призначені мені замовлення', 'Назначенные мне заказы'],
  ev_status: ['Zmiany statusów zleceń', 'Order status changes', 'Зміни статусів замовлень', 'Смена статусов заказов'],
  ev_payment: ['Płatności', 'Payments', 'Оплати', 'Оплаты'],
  pushOff: ['Powiadomienia są wyłączone w ustawieniach telefonu.', 'Notifications are disabled in phone settings.', 'Сповіщення вимкнено в налаштуваннях телефону.', 'Уведомления выключены в настройках телефона.'],
  enablePush: ['Włącz powiadomienia', 'Enable notifications', 'Увімкнути сповіщення', 'Включить уведомления'],
  openSettings: ['Otwórz ustawienia', 'Open settings', 'Відкрити налаштування', 'Открыть настройки'],
  language: ['Język', 'Language', 'Мова', 'Язык'],
  privacy: ['Polityka prywatności', 'Privacy policy', 'Політика конфіденційності', 'Политика конфиденциальности'],
  support: ['Pomoc i kontakt', 'Help and contact', 'Допомога і контакти', 'Помощь и контакты'],
  deleteAccount: ['Usunięcie konta', 'Delete account', 'Видалення облікового запису', 'Удаление аккаунта'],
  deleteAccountText: [
    'Konto pracownika usuwa administrator warsztatu w CRM (Ustawienia → Pracownicy). Możesz też wysłać prośbę e-mailem — usuniemy konto i dane w ciągu 30 dni.',
    'Staff accounts are deleted by the shop administrator in the CRM (Settings → Staff). You can also request deletion by e-mail — we delete the account and data within 30 days.',
    'Обліковий запис працівника видаляє адміністратор сервісу в CRM (Налаштування → Працівники). Також можна надіслати запит e-mail — видалимо обліковий запис і дані протягом 30 днів.',
    'Аккаунт сотрудника удаляет администратор сервиса в CRM (Настройки → Сотрудники). Также можно отправить запрос по e-mail — удалим аккаунт и данные в течение 30 дней.',
  ],
  requestDeletion: ['Wyślij prośbę o usunięcie', 'Request deletion', 'Надіслати запит на видалення', 'Отправить запрос на удаление'],
  logout: ['Wyloguj się', 'Sign out', 'Вийти', 'Выйти'],
  logoutConfirm: ['Wylogować z tego urządzenia?', 'Sign out of this device?', 'Вийти на цьому пристрої?', 'Выйти на этом устройстве?'],
  version: ['Wersja', 'Version', 'Версія', 'Версия'],
  branch: ['Serwis', 'Workshop', 'Сервіс', 'Сервис'],
  sessionExpired: ['Sesja wygasła — zaloguj się ponownie', 'Session expired — please sign in again', 'Сесія завершилась — увійдіть знову', 'Сессия истекла — войдите снова'],
} satisfies Record<string, T>;

export type UIKey = keyof typeof ui;

export function detectLang(): Lang {
  const code = getLocales()[0]?.languageCode ?? 'pl';
  if (code === 'pl' || code === 'en' || code === 'uk' || code === 'ru') return code;
  if (code === 'be') return 'ru';
  return 'en';
}
export const LOCALE: Record<Lang, string> = { pl: 'pl-PL', en: 'en-GB', uk: 'uk-UA', ru: 'ru-RU' };

export const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'pl', setLang: () => {} });
export function useT() {
  const { lang } = useContext(LangContext);
  return (k: UIKey) => ui[k][IDX[lang]];
}
export const useLang = () => useContext(LangContext);
