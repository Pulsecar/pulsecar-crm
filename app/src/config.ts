// Адрес сервера (панель + API). Меняется через переменную EXPO_PUBLIC_API_URL при сборке.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://panel.pulsecar.tech').replace(/\/$/, '');

// Кнопка «Демо» на экране входа — только для превью/презентаций, в магазинную сборку не включать.
export const DEMO_ENABLED = process.env.EXPO_PUBLIC_DEMO === '1';

export const QR_STEP_SECONDS = 30;
