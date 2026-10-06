# Pulsecar CRM — мобильное приложение для мастеров и менеджеров

Expo SDK 57 · React Native 0.86 · iOS 15.1+ / Android 7+ · пакет `pl.pulsecar.crm` (iOS и Android)

## Что внутри

| Экран | Что делает | Право в CRM |
|---|---|---|
| **Terminarz** | записи на день по постам, ← → по дням, нажатие открывает заказ | `calendar.view` |
| **Zlecenia / Wyceny** | список, поиск (номер, клиент, номер авто, VIN), «Открытые / Все», подгрузка страниц | `orders.view` / `quotes.manage` |
| **Карточка заказа** | статус (смена), клиент (звонок / SMS), авто, описание, работы (отметка «выполнено»), запчасти, суммы, **фото камерой / из галереи** (сжатие до 1920 px), «Фото приёмки сделаны», комментарии | как в панели |
| **Pełny CRM** | вся панель panel.pulsecar.tech внутри приложения, вход без пароля (одноразовый код 60 с) | все |
| **Profil** | push-уведомления по событиям, язык (PL/EN/UA/RU), политика конфиденциальности, удаление аккаунта, выход | — |

Права, цены и контакты клиента скрываются так же, как в панели: сервер отдаёт только то, что разрешено сотруднику.

**Сервер (panel/):**
* `POST /crm-api/mobile/login` → ключ устройства `pcm_…`. В базе хранится только его хеш, на телефоне он лежит в Keychain / Keystore.
* `GET|PUT /crm-api/mobile/device` — push-токен и события.
* `POST /crm-api/mobile/logout` удаляет устройство.
* `POST /crm-api/mobile/web` выдаёт код для «Полной CRM».

Push отправляется через Expo Push по событиям `booking`, `status`, `payment` (вместе с Telegram) и `assigned` (мастеру назначили заказ или работу). Телефоны клиентов в тексте push скрываются.

## Требования магазинов — что уже сделано

- [x] Значок 1024×1024 без прозрачности (iOS), adaptive icon + монохромный (Android 13+), иконка уведомлений
- [x] Тексты разрешений на 4 языках (камера, фото), Face ID-строка убрана — не используется
- [x] `ITSAppUsesNonExemptEncryption = false` (только HTTPS — экспортная декларация не нужна)
- [x] Privacy manifest iOS: без трекинга; собираются фото, ID пользователя и ID устройства — только для работы приложения
- [x] Android: только `CAMERA` (+ уведомления); доступ к галерее через системный Photo Picker. `READ_MEDIA_*`, `READ_EXTERNAL_STORAGE`, `RECORD_AUDIO` и `SYSTEM_ALERT_WINDOW` заблокированы — требование Google Play с 2025 г.
- [x] Target SDK — актуальный от Expo SDK 57 (требование Google Play)
- [x] Политика конфиденциальности: https://panel.pulsecar.tech/privacy-crm-app.html
- [x] Страница поддержки: https://panel.pulsecar.tech/support-crm-app.html
- [x] Удаление аккаунта: в приложении (Profil → Usunięcie konta) объяснено и есть кнопка запроса (Apple 5.1.1(v), Google Play). Аккаунты создаёт только администратор, регистрации нет.
- [x] Не «обёртка сайта» (Apple 4.2): основные экраны нативные, полная CRM — дополнительно
- [x] Скриншоты: `store/screenshots/ios-6.9` (1320×2868), `store/screenshots/android` (1080×2160), `store/feature-graphic-1024x500.png`, `store/play-icon-512.png`
- [x] Демо-сервис с вымышленными данными для рецензентов: `panel/tools/seed-demo.js`

## Публикация — шаги (делаете вы, в своих аккаунтах)

### 0. Один раз
1. Аккаунты: **Apple Developer Program** (99 $/год, лучше на фирму — нужен D-U-N-S) и **Google Play Console** (25 $ один раз; для аккаунта организации нет требования «12 тестировщиков 14 дней»).
2. `npm i -g eas-cli`, затем `cd staff && npm install && eas login && eas init` (впишет `extra.eas.projectId` в app.json — он нужен для push).
3. **Демо для рецензентов** — на VPS:
   ```
   cd /root/pulsecar-crm/panel && docker compose exec -T panel node tools/seed-demo.js DEMO
   ```
   Затем в CRM: **Владелец → сервис «Pulsecar Demo» → Сотрудники**. Добавьте сотрудника, например логин `appreview`, роль «Менеджер», и задайте пароль сами. Этот логин и пароль впишите в App Store Connect и Google Play. Перед отправкой на проверку повторите команду, чтобы даты в терминарзе были свежие.
4. **Push Android:** создайте проект Firebase и добавьте Android-приложение `pl.pulsecar.crm`. Скачайте `google-services.json` в `staff/` и добавьте в app.json `"android": { "googleServicesFile": "./google-services.json" }`. Ключ сервисного аккаунта FCM V1 загрузите командой `eas credentials` (Android → Push Notifications). **Push iOS:** ключ APNs EAS создаст сам при первой сборке.

### 1. Сборка
```
eas build --platform all --profile production
```
Получится `.aab` для Google Play и `.ipa` для App Store. Подпись и сертификаты EAS сделает сам.

### 2. Google Play (скрытое распространение)
1. Play Console → Создать приложение «Pulsecar CRM», язык PL, приложение, бесплатное.
2. **Тестирование → Внутреннее тестирование** (до 100 сотрудников по e-mail, без проверки в магазине, ставится по ссылке): загрузить .aab (`eas submit -p android` грузит в internal). Для постоянной работы — **Закрытое тестирование** со списком e-mail сотрудников. В поиске Play оно не видно — это и есть «скрытое» распространение. Либо Managed Google Play: «Частные приложения» только для своей организации.
3. Заполнить разделы «Содержание приложения»:
   - **Доступ к приложению:** «Всё или часть функций ограничено», логин и пароль демо + текст из раздела «Заметки для проверки».
   - **Реклама:** нет.
   - **Возрастной рейтинг:** анкета IARC, категория «Утилиты / производительность», всё «нет» → 3+.
   - **Целевая аудитория:** 18+.
   - **Безопасность данных:** см. таблицу ниже.
   - **Политика конфиденциальности:** ссылка выше.
   - **Финансы / здоровье / новости / госприложение:** нет.
4. Карточка магазина: тексты ниже, значок 512, графика 1024×500, скриншоты.

### 3. App Store (скрытое — Unlisted)
1. App Store Connect → Мои приложения → «+» → iOS, имя «Pulsecar CRM», Bundle ID `pl.pulsecar.crm`, SKU `pulsecar-crm`.
2. `eas submit -p ios` → сборка появится в TestFlight. Сотрудников можно сразу ставить через TestFlight (внутренние до 100, внешние — после короткой проверки).
3. Заполнить: категория **Business**, возраст (анкета, всё «нет» → 4+), цена «бесплатно», URL поддержки и политики. **App Privacy** — по таблице ниже, «Используется для отслеживания — нет».
4. **Sign-In Information:** демо логин и пароль + Notes (текст ниже). Отправить на проверку.
5. **После одобрения** подайте заявку на скрытое распространение: https://developer.apple.com/contact/request/unlisted-app/ (Apple ID приложения, причина: «internal tool for our workshop staff»). После подтверждения приложение доступно только по прямой ссылке и не ищется в App Store. До подтверждения не нажимайте «Выпустить» — выберите «Выпустить вручную».

## Безопасность данных / App Privacy (ответы)

| Данные | Собираются | Зачем | Передаются третьим лицам | Обязательно |
|---|---|---|---|---|
| Фото | да | функции приложения (фото авто в заказ) | нет | нет (по желанию) |
| ID пользователя (логин сотрудника) | да | функции, вход | нет | да |
| ID устройства (push-токен) | да | функции (уведомления) | нет* | нет |
| Имя, телефон клиентов (показываются из CRM) | обрабатываются | функции | нет | — |

\* Expo, APNs и FCM — обработчики (service providers), это не «передача» в смысле Google / Apple.

- Шифрование при передаче: **да** (HTTPS).
- Можно запросить удаление: **да**. Ссылка: https://panel.pulsecar.tech/support-crm-app.html или e-mail admin@pulsecar.pl.
- Трекинг и реклама: **нет**.

## Тексты карточки

**Название:** Pulsecar CRM
**Подзаголовок (iOS, ≤30):** Zlecenia i terminarz warsztatu
**Короткое описание (Play, ≤80):** Terminarz, zlecenia, wyceny i zdjęcia z przyjęcia dla zespołu warsztatu.

**Описание (PL):**
Pulsecar CRM to aplikacja dla mechaników i kierowników warsztatów korzystających z systemu Pulsecar.
• Terminarz na każdy dzień – wizyty według stanowisk i podnośników
• Zlecenia i wyceny – wyszukiwanie po numerze, kliencie, tablicy lub VIN
• Karta zlecenia – status, usługi do odhaczenia, części, kwoty, komentarze
• Zdjęcia z przyjęcia pojazdu prosto z aparatu do zlecenia
• Telefon i SMS do klienta jednym dotknięciem
• Powiadomienia o nowych rezerwacjach i przydzielonych zleceniach
• Pełny panel CRM zawsze pod ręką
Konto pracownika zakłada administrator warsztatu.

**Description (EN):**
Pulsecar CRM is the app for mechanics and managers of repair shops using the Pulsecar system: daily schedule by bay, repair orders and quotes, intake photos straight from the camera, one-tap call/SMS to customers, push notifications for new bookings and assigned jobs, and the full CRM panel. Staff accounts are created by the shop administrator.

**Ключевые слова (iOS):** warsztat,crm,zlecenia,terminarz,mechanik,serwis,wycena,naprawa,auto

## Заметки для проверки (App Review / Google Play app access)

```
This is an internal business app for staff (mechanics and managers) of car repair
shops using the Pulsecar CRM. There is no public sign-up: staff accounts are created
by the shop administrator in the CRM, so in-app account creation and deletion do not
apply. The Profile tab explains how an account is deleted and lets the user e-mail a
deletion request.

Demo account (a separate demo workshop with fictional data only):
  Login: <login>
  Password: <password>

What to try: Schedule (today's visits by bay) → tap a visit → order card →
change status, tick a job as done, add a comment, add a photo (camera / gallery).
"Full CRM" tab opens the complete web panel signed in automatically.
Camera is used only to attach vehicle photos to an order. Photos are picked with the
system photo picker. Push notifications inform about new bookings and assigned orders.
We plan to request Unlisted distribution after approval (internal tool).
```

## Новая версия
Поднимите `version` в app.json (например 1.0.1). Номер сборки EAS увеличит сам. Затем:
```
eas build -p all --profile production && eas submit -p all
```

## Локальная проверка
```
npm install && npx expo start      # Expo Go / dev build
npm run typecheck
```
