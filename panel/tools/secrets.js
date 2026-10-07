// Ключи интеграций: зашифровать / расшифровать во всех сервисах.
//   docker compose exec -T panel node tools/secrets.js encrypt   — зашифровать (нужен SECRETS_KEY в .env)
//   docker compose exec -T panel node tools/secrets.js decrypt   — откат: вернуть открытый вид (после этого можно убрать SECRETS_KEY)
import { forEachDb } from '../src/branches.js';
import { encryptStoredSecrets, decryptStoredSecrets } from '../src/integrations/index.js';
const mode = process.argv[2];
if (!['encrypt', 'decrypt'].includes(mode)) { console.error('Укажите encrypt или decrypt'); process.exit(1); }
let n = 0;
await forEachDb(() => { n += mode === 'encrypt' ? encryptStoredSecrets() : decryptStoredSecrets(); });
console.log(mode === 'encrypt' ? 'Зашифровано полей:' : 'Расшифровано полей:', n);
