'use strict';
// Ссылки для клиентов: камера + период «от–до» + часы доступа.
const crypto = require('crypto');
const cfg = require('./config');
const store = require('./store');
const sch = require('./schedule');

const db = () => store.db;
const camera = (id) => db().cameras.find((c) => c.id === id);
const s = (v, n = 80) => String(v ?? '').trim().slice(0, n);

// Часы доступа ссылки:
//  mode 'workshop' — часы работы мастерской из настроек (меняются вместе с ними)
//  mode 'always'   — круглосуточно внутри периода
//  mode 'custom'   — свои часы по дням недели
function weekly(l) {
  if (l.scheduleMode === 'always') return null;
  if (l.scheduleMode === 'custom') return l.schedule;
  return db().settings.workshopHours;
}
const closed = (l) => (l.scheduleMode === 'always' ? [] : db().settings.closedDates);

function access(l, now = new Date()) {
  if (!l) return { state: 'not_found' };
  if (l.revoked) return { state: 'revoked' };
  const cam = camera(l.cameraId);
  if (!cam || !cam.enabled) return { state: 'no_camera' };
  if (now < new Date(l.validFrom)) return { state: 'not_started', nextOpen: sch.nextOpen(weekly(l), closed(l), new Date(l.validFrom), new Date(l.validTo))?.toISOString() || l.validFrom };
  if (now > new Date(l.validTo)) return { state: 'expired' };
  if (!sch.isOpen(weekly(l), closed(l), now)) {
    const n = sch.nextOpen(weekly(l), closed(l), now, new Date(l.validTo));
    return { state: 'closed', nextOpen: n ? n.toISOString() : null };
  }
  return { state: 'live' };
}

function smsText(l) {
  const hours = weekly(l) ? `, w godz. ${sch.text(weekly(l))}` : '';
  const phone = db().settings.contactPhone ? ` Tel.: ${db().settings.contactPhone}` : '';
  return `Dzień dobry! Tu warsztat Pulsecar. Naprawę auta ${l.plate} można oglądać na żywo: ${cfg.PUBLIC_URL}/v/${l.token}\n` +
    `Link działa od ${sch.dt(l.validFrom)} do ${sch.dt(l.validTo)}${hours}. Transmisja bez dźwięku.${phone}`;
}

function view(l, viewers = 0) {
  const a = access(l);
  const cam = camera(l.cameraId);
  return {
    id: l.id, url: `${cfg.PUBLIC_URL}/v/${l.token}`,
    cameraId: l.cameraId, cameraName: cam ? cam.name : '—',
    plate: l.plate, client: l.client, car: l.car, orderNo: l.orderNo, orderId: l.orderId, phone: l.phone,
    validFrom: l.validFrom, validTo: l.validTo,
    scheduleMode: l.scheduleMode, schedule: l.scheduleMode === 'custom' ? l.schedule : null, scheduleText: sch.text(weekly(l)),
    state: a.state, nextOpen: a.nextOpen || null, viewers,
    views: l.views, lastViewAt: l.lastViewAt, revoked: l.revoked,
    createdAt: l.createdAt, createdBy: l.createdBy, smsText: smsText(l),
  };
}

// Проверка полей из формы/API. Для создания prev = null.
function parse(b, prev) {
  const l = prev ? { ...prev } : {};
  if (b.cameraId !== undefined) l.cameraId = s(b.cameraId, 40);
  if (!camera(l.cameraId)) return { error: 'Wybierz kamerę' };
  for (const [k, n] of [['client', 80], ['car', 80], ['orderNo', 40], ['orderId', 64], ['phone', 20]]) if (b[k] !== undefined) l[k] = s(b[k], n);
  if (b.plate !== undefined) l.plate = s(b.plate, 16).toUpperCase();
  if (!l.plate) return { error: 'Podaj numer rejestracyjny' };

  const now = Date.now();
  if (b.validFrom !== undefined || !prev) {
    const f = b.validFrom ? new Date(b.validFrom) : new Date(now);
    if (isNaN(f)) return { error: 'Nieprawidłowa data „od”' };
    l.validFrom = f.toISOString();
  }
  if (b.validTo !== undefined || !prev) {
    const t = new Date(b.validTo);
    if (isNaN(t)) return { error: 'Podaj datę „do”' };
    l.validTo = t.toISOString();
  }
  if (new Date(l.validTo) <= new Date(l.validFrom)) return { error: 'Data „do” musi być później niż „od”' };
  if (new Date(l.validTo) <= now && (!prev || b.validTo !== undefined)) return { error: 'Data „do” musi być w przyszłości' };
  if (new Date(l.validTo) - Math.max(now, new Date(l.validFrom)) > cfg.MAX_LINK_DAYS * 864e5) return { error: `Maksymalny okres dostępu to ${cfg.MAX_LINK_DAYS} dni` };

  if (b.scheduleMode !== undefined || !prev) {
    const mode = ['workshop', 'always', 'custom'].includes(b.scheduleMode) ? b.scheduleMode : 'workshop';
    l.scheduleMode = mode;
    if (mode === 'custom') {
      const w = sch.parseWeekly(b.schedule);
      if (w.error) return w;
      if (!w.value) return { error: 'Podaj godziny dostępu' };
      l.schedule = w.value;
    } else delete l.schedule;
  }
  if (b.revoked === true) l.revoked = true;
  return { value: l };
}

function create(b, user) {
  const r = parse(b, null);
  if (r.error) return r;
  const l = {
    id: crypto.randomUUID(),
    token: crypto.randomBytes(12).toString('base64url'),
    client: '', car: '', orderNo: '', orderId: '', phone: '',
    ...r.value,
    revoked: false, views: 0, lastViewAt: null,
    createdAt: new Date().toISOString(), createdBy: user ? user.name : '',
  };
  db().links.push(l); store.save();
  return { value: l };
}

module.exports = { access, view, parse, create, weekly, smsText };
