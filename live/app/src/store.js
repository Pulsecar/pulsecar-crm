'use strict';
// Хранилище — один JSON-файл с атомарной записью. Для десятков камер и тысяч ссылок достаточно.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const FILE = path.join(DATA_DIR, 'db.json');
const WORKSHOP = {
  mon: ['08:00', '18:00'], tue: ['08:00', '18:00'], wed: ['08:00', '18:00'],
  thu: ['08:00', '18:00'], fri: ['08:00', '18:00'], sat: ['09:00', '14:00'], sun: null,
};

const DEFAULT = () => ({
  version: 2,
  cameras: [],
  links: [],
  settings: { workshopHours: WORKSHOP, closedDates: [], contactPhone: '', maxViewersPerLink: 3 },
});

let db;
function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) {
    if (fs.existsSync(FILE)) { console.error('db.json повреждён — создаю резервную копию и новую базу'); fs.copyFileSync(FILE, FILE + '.broken-' + Date.now()); }
    db = DEFAULT(); save();
  }
  const d = DEFAULT();
  db.cameras ||= []; db.links ||= []; db.settings = { ...d.settings, ...(db.settings || {}) };
  return db;
}
function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

module.exports = { load, save, get db() { return db; } };
