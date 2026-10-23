'use strict';
// Отчёт о вылете: сбор логов профиля и отправка админам в Discord через вебхук.
const fs = require('fs');
const path = require('path');

const WEBHOOK_RE = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const MAX_FILE = 3 * 1024 * 1024; // каждый файл не больше 3 МБ (берём конец лога)
const COOLDOWN_MS = 60 * 1000;
let lastSent = 0;

function validWebhook(url) { return WEBHOOK_RE.test(String(url || '')); }

function readTail(file, max = MAX_FILE) {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    const len = Math.min(st.size, max);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    return buf;
  } catch { return null; }
}

// Самый свежий crash-report, созданный после запуска игры.
function findCrashReport(gameDir, since) {
  const dir = path.join(gameDir, 'crash-reports');
  let best = null;
  try {
    for (const n of fs.readdirSync(dir)) {
      if (!/\.txt$/i.test(n)) continue;
      const p = path.join(dir, n);
      const m = fs.statSync(p).mtimeMs;
      if (m >= since - 5000 && (!best || m > best.m)) best = { p, m };
    }
  } catch {}
  return best && best.p;
}

// Короткая причина: из crash-report (Description + первая строка исключения) или из лога.
function guessReason(text) {
  if (!text) return '';
  const s = text.toString('utf8');
  const desc = /Description:\s*(.+)/.exec(s);
  const exc = /^([\w.$]+(?:Exception|Error)[^\n]*)/m.exec(s);
  return [desc && desc[1].trim(), exc && exc[1].trim()].filter(Boolean).join(' — ').slice(0, 300);
}

function listMods(gameDir) {
  try { return fs.readdirSync(path.join(gameDir, 'mods')).filter(n => /\.jar$/i.test(n)).sort(); } catch { return []; }
}

// ctx: { gameDir, launchTime, code, profile, version, launcherVersion, playerName, javaPath }
function collect(ctx) {
  const crashFile = findCrashReport(ctx.gameDir, ctx.launchTime);
  const crashText = crashFile ? readTail(crashFile) : null;
  const launchLog = readTail(path.join(ctx.gameDir, 'komori-launch.log'));
  const latestLog = readTail(path.join(ctx.gameDir, 'logs', 'latest.log'));
  const mods = listMods(ctx.gameDir);
  const reason = guessReason(crashText) || guessReason(latestLog) || guessReason(launchLog);
  return { crashFile, crashText, launchLog, latestLog, mods, reason };
}

function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

async function send(webhook, ctx, report, note) {
  if (!validWebhook(webhook)) throw new Error('Отправка отчётов не настроена: нет crashWebhookUrl в komori.config.json');
  const wait = lastSent + COOLDOWN_MS - Date.now();
  if (wait > 0) throw new Error(`Отчёт уже отправлен. Подожди ${Math.ceil(wait / 1000)} сек.`);

  const p = ctx.profile || {};
  const embed = {
    title: 'Вылет игры',
    color: 0xE5484D,
    description: cut(note ? 'Комментарий игрока: ' + note : 'Без комментария', 1500),
    fields: [
      { name: 'Игрок', value: cut(ctx.playerName || '—', 100), inline: true },
      { name: 'Профиль', value: cut(p.name || '—', 100), inline: true },
      { name: 'Версия', value: cut(ctx.version || '—', 100), inline: true },
      { name: 'Ядро', value: cut((p.loader || 'vanilla') + (p.loaderVersion ? ' ' + p.loaderVersion : ''), 100), inline: true },
      { name: 'Код выхода', value: String(ctx.code), inline: true },
      { name: 'Модов', value: String(report.mods.length), inline: true },
      { name: 'Причина', value: cut(report.reason || 'не определена — см. файлы', 1000) },
      { name: 'Лаунчер', value: cut(ctx.launcherVersion || '—', 50), inline: true },
      { name: 'Java', value: cut(ctx.javaPath ? path.basename(path.dirname(path.dirname(ctx.javaPath))) : '—', 100), inline: true }
    ],
    timestamp: new Date().toISOString()
  };

  const fd = new FormData();
  fd.append('payload_json', JSON.stringify({ username: 'Komori Launcher', embeds: [embed], allowed_mentions: { parse: [] } }));
  let i = 0;
  const add = (buf, name) => { if (buf && buf.length) fd.append(`files[${i++}]`, new Blob([buf], { type: 'text/plain' }), name); };
  add(report.crashText, report.crashFile ? path.basename(report.crashFile) : 'crash-report.txt');
  add(report.latestLog, 'latest.log');
  add(report.launchLog, 'komori-launch.log');
  add(Buffer.from(report.mods.join('\n') || 'нет модов', 'utf8'), 'mods.txt');

  const res = await fetch(webhook + '?wait=true', { method: 'POST', body: fd });
  if (res.status === 429) throw new Error('Discord просит подождать: слишком много отчётов');
  if (!res.ok) throw new Error('Discord не принял отчёт (' + res.status + ')');
  lastSent = Date.now();
  return true;
}

module.exports = { collect, send, validWebhook, guessReason, findCrashReport };
