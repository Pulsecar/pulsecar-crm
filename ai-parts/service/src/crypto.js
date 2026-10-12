// Шифрование ключей интеграций (AES-256-GCM) и проверка токенов от CRM (HMAC-SHA256).
import crypto from 'node:crypto';
import { config } from './config.js';

function key() {
  return Buffer.from(config.masterKey, 'base64');
}

export function encryptSecret(plain) {
  if (plain === undefined || plain === null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(blob) {
  if (!blob) return null;
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function mask(plain) {
  if (!plain) return '';
  const s = String(plain);
  return '••••' + s.slice(-4);
}

// ---------- Токены CRM ----------
// Формат: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payloadPart, CRM_SHARED_SECRET))
// payload: { ws: workshopId, uid: userId, role: "manager"|"admin", wid?: wycenaId, exp: unixSeconds }
// CRM выпускает токен на сервере и отдаёт в виджет. Пример — в README.

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload, secret = config.crmSharedSecret) {
  const part = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(part).digest('base64url');
  return `${part}.${sig}`;
}

export function verifyToken(token, secret = config.crmSharedSecret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [part, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(part).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.ws || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// Ключ расширения partslink24: случайная строка, хранится хэшем.
export function newExtensionKey() {
  return 'pl24_' + crypto.randomBytes(24).toString('base64url');
}
export function hashKey(k) {
  return crypto.createHash('sha256').update(k).digest('hex');
}
