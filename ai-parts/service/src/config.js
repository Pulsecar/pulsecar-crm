// Служебные настройки из окружения. Ключи интеграций — в БД (раздел «Интеграции»).
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv() {
  const p = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

export const config = {
  port: Number(process.env.PORT || 3200),
  dbPath: process.env.DB_PATH || './data/ai-parts.db',
  masterKey: process.env.MASTER_KEY || '',
  crmSharedSecret: process.env.CRM_SHARED_SECRET || '',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  defaultAnthropicKey: process.env.ANTHROPIC_API_KEY || '',
  // Лимиты агента
  agent: {
    maxTurns: Number(process.env.AGENT_MAX_TURNS || 40),
    maxWebSearches: Number(process.env.AGENT_MAX_WEB_SEARCHES || 25),
    maxWebFetches: Number(process.env.AGENT_MAX_WEB_FETCHES || 30),
    pl24WaitSeconds: Number(process.env.PL24_WAIT_SECONDS || 180),
  },
};

export function assertConfig() {
  const problems = [];
  if (!config.masterKey || Buffer.from(config.masterKey, 'base64').length !== 32)
    problems.push('MASTER_KEY должен быть 32 байта в base64');
  if (!config.crmSharedSecret || config.crmSharedSecret.length < 32)
    problems.push('CRM_SHARED_SECRET должен быть длиной не менее 32 символов');
  if (problems.length) {
    throw new Error('Ошибка конфигурации:\n- ' + problems.join('\n- '));
  }
}
