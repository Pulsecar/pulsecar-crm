import { sha256 } from 'js-sha256';
import { QR_STEP_SECONDS } from './config';

/**
 * Динамический QR карты Pulse Points (как TOTP).
 * PCQ1.<номер карты>.<шаг времени>.<первые 16 hex HMAC-SHA256>
 * Секрет выдаётся сервером при входе, код считается на телефоне — работает без интернета.
 * Сервер принимает код ±60 секунд и только один раз.
 */
export function makeQr(secret: string, cardNo: string, nowMs: number) {
  const step = Math.floor(nowMs / 1000 / QR_STEP_SECONDS);
  const mac = sha256.hmac(secret, `${cardNo}.${step}`);
  const code6 = String(parseInt(mac.slice(-8), 16) % 1_000_000).padStart(6, '0');
  const secondsLeft = QR_STEP_SECONDS - (Math.floor(nowMs / 1000) % QR_STEP_SECONDS);
  return { payload: `PCQ1.${cardNo}.${step}.${mac.slice(0, 16)}`, code6, secondsLeft, step };
}
