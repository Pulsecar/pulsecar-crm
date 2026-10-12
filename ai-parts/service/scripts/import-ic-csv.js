#!/usr/bin/env node
// Импорт каталога Inter Cars (CSV ProductInformation) в локальную базу модуля.
//   node scripts/import-ic-csv.js --ws pulsecar --file ./ProductInformation.csv
//   node scripts/import-ic-csv.js --ws pulsecar --url https://data.webapi.intercars.eu/customer/ProductInformation/<файл>.csv
// Для --url используются логин/пароль CSV из «Интеграций» (BasicAuth).
// Запускать раз в сутки (cron) после 05:30 — IC обновляет файлы около 04:00–05:30.
import fs from 'node:fs';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import '../src/config.js';
import { getDb, ensureWorkshop } from '../src/db.js';
import { getIntegration } from '../src/integrations.js';
import { importProductInformation, catalogSize } from '../src/providers/intercars.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => (cur.startsWith('--') ? [...acc, [cur.slice(2), arr[i + 1]]] : acc), [])
);
if (!args.ws || (!args.file && !args.url)) {
  console.log('Использование: --ws <workshopId> (--file <csv> | --url <csv url>)');
  process.exit(1);
}
getDb();
ensureWorkshop(args.ws);

let stream;
if (args.file) stream = fs.createReadStream(args.file, 'utf8');
else {
  const cfg = getIntegration(args.ws, 'intercars').values;
  const res = await fetch(args.url, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${cfg.csv_login}:${cfg.csv_password}`).toString('base64') },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  stream = Readable.fromWeb(res.body).setEncoding('utf8');
}

const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
const buf = [];
let header = null;
let total = 0;
for await (const line of rl) {
  if (!header) { header = line; continue; }
  buf.push(line);
  if (buf.length >= 20000) { total += importProductInformation(args.ws, [header, ...buf.splice(0)]); process.stdout.write(`\r${total} строк`); }
}
if (buf.length) total += importProductInformation(args.ws, [header, ...buf]);
console.log(`\nГотово: импортировано ${total}, всего в каталоге ${catalogSize(args.ws)}`);
