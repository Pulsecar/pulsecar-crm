#!/usr/bin/env node
// Проверка агента без CRM: node scripts/try.js --vin WBS43AY07PFP64494 --text "колодки передние и задние" [--level middle] [--ws pulsecar]
// Нужен ANTHROPIC_API_KEY (в .env или в «Интеграциях» автосервиса --ws).
// partslink24 в этом режиме работает, только если запущен сервис и расширение подключено к той же базе.
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import '../src/config.js';
import { getDb, ensureWorkshop } from '../src/db.js';
import { runAgent } from '../src/agent/runAgent.js';
import { saveIntegration } from '../src/integrations.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith('--') ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), [])
);
if (!args.vin || !args.text) {
  console.log('Использование: node scripts/try.js --vin <VIN> --text "<что нужно>" [--level economy|middle|oe] [--ws <id>] [--no-pl24]');
  process.exit(1);
}
const ws = args.ws || 'try';
getDb();
ensureWorkshop(ws, ws);
if (args['no-pl24'] !== undefined || ws === 'try') saveIntegration(ws, 'partslink24', { enabled: false });

const input = { wycenaId: 'TEST', vehicle: { vin: args.vin, make: args.make, model: args.model, engine: args.engine, year: args.year }, text: args.text, level: args.level || 'middle' };
const rl = readline.createInterface({ input: stdin, output: stdout });
let state = { messages: [], pending: null, answer: null };
for (;;) {
  const out = await runAgent({ workshopId: ws, jobId: 'try', input, ...state, step: (t) => console.log('•', t) });
  if (out.status === 'done') {
    console.log('\n===== РЕЗУЛЬТАТ =====');
    console.log(JSON.stringify(out.result, null, 2));
    console.log(`\nТокены: вход ${out.usage.input}, выход ${out.usage.output}, поисков: ${out.usage.webSearches}`);
    break;
  }
  console.log('\n❓ ' + out.question.question + (out.question.options ? ' [' + out.question.options.join(' / ') + ']' : ''));
  const answer = await rl.question('Ответ: ');
  state = { messages: out.messages, pending: out.pending, answer };
}
rl.close();
