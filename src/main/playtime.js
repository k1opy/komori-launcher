'use strict';
// Учёт времени в игре для профиля игрока: часы по дням, по часам (за последние 3 суток),
// по сборкам и отдельно на сервере Komori. Хранится локально в playtime.json.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE = () => path.join(app.getPath('userData'), 'playtime.json');
const sessions = new Map(); // profileId -> { last, komori }
let data = null;
let timer = null;

function blank() { return { v: 1, total: 0, komori: 0, launches: 0, since: Date.now(), days: {}, hours: {}, profiles: {} }; }
function load() {
  if (data) return data;
  try { data = Object.assign(blank(), JSON.parse(fs.readFileSync(FILE(), 'utf8'))); } catch { data = blank(); }
  return data;
}
function save() {
  try {
    const d = load();
    // Почасовая разбивка нужна только для графика «24 часа» и сравнения с прошлыми сутками
    const keep = new Set([0, 1, 2].map(i => dayKey(Date.now() - i * 864e5)));
    Object.keys(d.hours).forEach(k => { if (!keep.has(k)) delete d.hours[k]; });
    const tmp = FILE() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d), 'utf8');
    fs.renameSync(tmp, FILE());
  } catch {}
}

function pad(n) { return String(n).padStart(2, '0'); }
function dayKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

// Добавить отрезок [from, to) с разбивкой по часам
function addSpan(profileId, komori, from, to) {
  if (!(to > from)) return;
  const d = load();
  let t = from;
  while (t < to) {
    const dt = new Date(t);
    const hourEnd = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours() + 1).getTime();
    const end = Math.min(to, hourEnd);
    const sec = (end - t) / 1000;
    const k = dayKey(t);
    d.days[k] = (d.days[k] || 0) + sec;
    const h = d.hours[k] || (d.hours[k] = new Array(24).fill(0));
    h[dt.getHours()] += sec;
    t = end;
  }
  const sec = (to - from) / 1000;
  d.total += sec;
  if (komori) d.komori += sec;
  d.profiles[profileId] = (d.profiles[profileId] || 0) + sec;
}

function tick() {
  const now = Date.now();
  for (const [id, s] of sessions) { addSpan(id, s.komori, s.last, now); s.last = now; }
  save();
}

function start(profileId, komori) {
  load().launches++;
  sessions.set(profileId, { last: Date.now(), komori: !!komori });
  save();
  if (!timer) timer = setInterval(tick, 30000);
}
function stop(profileId) {
  const s = sessions.get(profileId);
  if (!s) return;
  addSpan(profileId, s.komori, s.last, Date.now());
  sessions.delete(profileId);
  save();
  if (!sessions.size && timer) { clearInterval(timer); timer = null; }
}
function flush() { if (sessions.size) tick(); }

// Для интерфейса: копия данных с учётом текущих сессий
function get() {
  flush();
  const d = load();
  return { total: d.total, komori: d.komori, launches: d.launches, since: d.since, days: d.days, hours: d.hours, profiles: d.profiles, now: Date.now() };
}

module.exports = { start, stop, flush, get };
