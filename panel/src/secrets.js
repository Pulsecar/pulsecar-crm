// Шифрование ключей интеграций в базе: AES-256-GCM, мастер-ключ — переменная окружения SECRETS_KEY (32 байта, base64).
// Формат значения: enc:v1:<iv b64>:<tag b64>:<данные b64>. Без SECRETS_KEY значения хранятся как раньше (открыто) — CRM работает.
// Сгенерировать ключ: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  → в .env: SECRETS_KEY=...
// ВАЖНО: ключ хранить и в резервной копии (.env), без него зашифрованные ключи интеграций не прочитать.
import crypto from 'node:crypto';

const PREFIX = 'enc:v1:';
let cached;
function masterKey() {
  if (cached !== undefined) return cached;
  const raw = process.env.SECRETS_KEY || '';
  const k = raw ? Buffer.from(raw, 'base64') : null;
  cached = k && k.length === 32 ? k : null;
  if (raw && !cached) console.error('SECRETS_KEY задан, но это не 32 байта в base64 — ключи интеграций не шифруются');
  return cached;
}
export const secretsOn = () => !!masterKey();
export const isEnc = (v) => typeof v === 'string' && v.startsWith(PREFIX);

export function encrypt(v) {
  const k = masterKey();
  if (!k || v === null || v === undefined || v === '' || isEnc(v)) return v;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([c.update(String(v), 'utf8'), c.final()]);
  return PREFIX + [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join(':');
}
export function decrypt(v) {
  if (!isEnc(v)) return v;
  const k = masterKey();
  if (!k) throw new Error('Ключи интеграций зашифрованы, а SECRETS_KEY не задан в .env');
  const [iv, tag, data] = v.slice(PREFIX.length).split(':').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', k, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}
