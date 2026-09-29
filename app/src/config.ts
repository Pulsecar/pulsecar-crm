// Адрес сервера (панель + API). Меняется через переменную EXPO_PUBLIC_API_URL при сборке.
// Веб-версия, открытая с самой панели (https://panel.pulsecar.tech/app/), ходит в API того же сервера.
const sameOrigin = typeof window !== 'undefined' && typeof window.location?.pathname === 'string' && window.location.pathname.startsWith('/app')
  ? window.location.origin : '';
export const API_URL = (sameOrigin || process.env.EXPO_PUBLIC_API_URL || 'https://panel.pulsecar.tech').replace(/\/$/, '');

// Кнопка «Демо» на экране входа — только для превью/презентаций, в магазинную сборку не включать.
export const DEMO_ENABLED = process.env.EXPO_PUBLIC_DEMO === '1';

export const QR_STEP_SECONDS = 30;
