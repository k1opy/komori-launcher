'use strict';
// ===== Скин офлайн-аккаунта (п.2) =====
// Локальная копия: <userData>/skins/<uuid>.png и <uuid>.json ({ variant, token, synced }).
// Если задан сервер скинов (Cloudflare Worker из папки skin-server), скин загружается туда,
// и игроки с Komori Launcher видят его в игре через authlib-injector.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { checkSkinPng } = require('./auth');
const { UA } = require('./net');

const dir = () => path.join(store.DATA_DIR(), 'skins');
const pngPath = (uuid) => path.join(dir(), uuid + '.png');
const metaPath = (uuid) => path.join(dir(), uuid + '.json');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Адрес сервера скинов: https, либо http только на localhost (для проверки).
function validServerUrl(u) {
  try {
    const x = new URL(String(u || ''));
    if (x.protocol === 'https:' || (x.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(x.hostname))) return x.origin;
  } catch {}
  return '';
}

function readMeta(uuid) {
  try {
    const m = JSON.parse(fs.readFileSync(metaPath(uuid), 'utf8'));
    return { variant: m.variant === 'slim' ? 'slim' : 'classic', token: m.token ? store.dec(m.token) : '', synced: m.synced || '' };
  } catch { return { variant: 'classic', token: '', synced: '' }; }
}
function writeMeta(uuid, m) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(metaPath(uuid), JSON.stringify({ variant: m.variant, token: m.token ? store.enc(m.token) : '', synced: m.synced || '' }, null, 2));
}

function check(acc) {
  if (!acc || !UUID_RE.test(String(acc.uuid))) throw new Error('Аккаунт не найден');
  if (acc.type === 'microsoft') throw new Error('Скин Microsoft-аккаунта меняется через Mojang');
}

function info(acc, server) {
  check(acc);
  const m = readMeta(acc.uuid);
  let skinData = '';
  try { skinData = 'data:image/png;base64,' + fs.readFileSync(pngPath(acc.uuid)).toString('base64'); } catch {}
  return { name: acc.name, uuid: acc.uuid, offline: true, skinData, skin: { variant: m.variant },
    server: server || '', synced: !!(server && m.synced === server) };
}

async function remote(server, method, acc, token, body, variant) {
  const headers = { 'User-Agent': UA, 'X-Name': acc.name };
  if (token) headers['X-Token'] = token;
  if (variant) headers['X-Variant'] = variant;
  if (body) headers['Content-Type'] = 'image/png';
  let res;
  try { res = await fetch(server + '/komori/skin', { method, headers, body }); }
  catch { throw new Error('Сервер скинов недоступен. Скин сохранён в лаунчере, загрузим позже.'); }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || `Сервер скинов ответил ${res.status}`);
  return data;
}

// Сохранить скин локально и (если есть сервер) загрузить. Локальная копия сохраняется даже без сети.
async function save(acc, buf, variant, server) {
  check(acc);
  checkSkinPng(buf);
  const m = readMeta(acc.uuid);
  m.variant = variant === 'slim' ? 'slim' : 'classic';
  m.synced = '';
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(pngPath(acc.uuid), buf);
  writeMeta(acc.uuid, m);
  if (server) {
    const r = await remote(server, 'PUT', acc, m.token, buf, m.variant);
    if (r.token) m.token = r.token;
    m.synced = server;
    writeMeta(acc.uuid, m);
  }
  return info(acc, server);
}

// Сменить модель рук у уже сохранённого скина.
async function setVariant(acc, variant, server) {
  check(acc);
  let buf;
  try { buf = fs.readFileSync(pngPath(acc.uuid)); } catch { throw new Error('Сначала загрузи скин'); }
  return save(acc, buf, variant, server);
}

// Догрузить скин на сервер, если раньше не получилось (вызывается перед запуском игры).
async function syncIfNeeded(acc, server) {
  if (!server || acc.type === 'microsoft') return;
  const m = readMeta(acc.uuid);
  if (m.synced === server) return;
  let buf;
  try { buf = fs.readFileSync(pngPath(acc.uuid)); } catch { return; }
  try { await save(acc, buf, m.variant, server); } catch {}
}

async function reset(acc, server) {
  check(acc);
  const m = readMeta(acc.uuid);
  if (server && m.token) await remote(server, 'DELETE', acc, m.token).catch(e => { if (!/недоступен/.test(e.message)) throw e; });
  try { fs.unlinkSync(pngPath(acc.uuid)); } catch {}
  writeMeta(acc.uuid, { variant: m.variant, token: m.token, synced: '' });
  return info(acc, server);
}

module.exports = { info, save, setVariant, reset, syncIfNeeded, validServerUrl };
