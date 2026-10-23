'use strict';
// Сборка сервера Komori: манифест (komori-server.json) на хостинге админов.
// Игроку: скачать манифест -> поставить версию и ядро -> докачать файлы -> убрать снятые -> зайти на сервер.
// Админу (DEV): собрать манифест из своего профиля.
const fs = require('fs');
const path = require('path');
const { fetchJson, downloadAll } = require('./net');
const mr = require('./modrinth');
const cf = require('./curseforge');
const loaders = require('./loaders');

const SERVER_PROFILE_ID = 'f00d00000001';
const FORMAT = 1;
const DEFAULT_HOSTS = ['cdn.modrinth.com', 'edge.forgecdn.net', 'mediafilez.forgecdn.net'];
const ALLOWED_DIRS = ['mods/', 'resourcepacks/', 'shaderpacks/', 'config/'];
const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'];

function hostAllowed(url, extraHosts) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  return DEFAULT_HOSTS.concat(extraHosts || []).includes(u.hostname);
}

function checkPath(rel) {
  const p = String(rel || '').replace(/\\/g, '/');
  if (!ALLOWED_DIRS.some(d => p.startsWith(d))) throw new Error('Файл вне разрешённых папок: ' + rel);
  if (p.split('/').some(seg => seg === '..' || seg === '' || seg === '.')) throw new Error('Недопустимый путь: ' + rel);
  if (/[<>:"|?*]/.test(p)) throw new Error('Недопустимый путь: ' + rel);
  return p;
}

// Проверка манифеста: всё лишнее отбрасывается, ошибки — с понятным текстом.
function validate(m, extraHosts) {
  if (!m || m.format !== FORMAT) throw new Error('Неизвестный формат файла сборки сервера');
  if (!/^[A-Za-z0-9._\- ]{1,64}$/.test(String(m.minecraft || ''))) throw new Error('В сборке сервера не указана версия Minecraft');
  if (!LOADERS.includes(m.loader)) throw new Error('Неизвестное ядро в сборке сервера: ' + m.loader);
  const files = [];
  const seen = new Set();
  for (const f of m.files || []) {
    const p = checkPath(f.path);
    if (seen.has(p.toLowerCase())) continue;
    seen.add(p.toLowerCase());
    if (!hostAllowed(f.url, extraHosts)) throw new Error('Ссылка с неразрешённого сайта: ' + f.url);
    if (!/^[a-f0-9]{40}$/.test(String(f.sha1 || ''))) throw new Error('У файла нет SHA-1: ' + p);
    files.push({ path: p, url: f.url, sha1: f.sha1, size: Number(f.size) || undefined, title: String(f.title || path.basename(p)).slice(0, 100) });
  }
  return {
    format: FORMAT, name: String(m.name || 'Komori').slice(0, 32), updated: String(m.updated || ''),
    minecraft: String(m.minecraft), loader: m.loader, loaderVersion: String(m.loaderVersion || '').replace(/[^A-Za-z0-9._+\-]/g, ''),
    ram: Math.max(0, Math.min(32, Number(m.ram) || 0)),
    server: m.server && /^[A-Za-z0-9.\-]{1,253}$/.test(m.server.host || '') ? { host: m.server.host, port: Number(m.server.port) || 25565 } : null,
    files
  };
}

async function fetchManifest(url, root, extraHosts) {
  const cache = path.join(root, 'versions', 'komori-server.json');
  let raw;
  try {
    raw = await fetchJson(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, JSON.stringify(raw, null, 2));
  } catch (e) {
    try { raw = JSON.parse(fs.readFileSync(cache, 'utf8')); } catch { throw new Error('Не удалось скачать сборку сервера: ' + e.message); }
  }
  return validate(raw, extraHosts);
}

// Синхронизация папки профиля сервера с манифестом.
async function sync(root, m, progress) {
  const dir = path.join(root, 'instances', SERVER_PROFILE_ID);
  const statePath = path.join(dir, 'komori-server-state.json');
  let state = { managed: [] };
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}

  const wanted = new Set(m.files.map(f => f.path));
  // Убираем то, что ставили раньше, а админ снял из сборки.
  for (const old of state.managed || []) {
    if (wanted.has(old)) continue;
    try { checkPath(old); } catch { continue; }
    for (const p of [path.join(dir, old), path.join(dir, old + '.disabled')]) if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  // Если игрок выключил обязательный мод — включаем обратно.
  for (const f of m.files) {
    const on = path.join(dir, f.path);
    const off = on + '.disabled';
    if (!fs.existsSync(on) && fs.existsSync(off)) fs.renameSync(off, on);
  }
  const tasks = m.files.map(f => ({ url: f.url, dest: path.join(dir, f.path), sha1: f.sha1, size: f.size, verify: true }));
  await downloadAll(tasks, (d, t) => progress('Сборка сервера', d, t), 8);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ managed: [...wanted], updated: m.updated, synced: Date.now() }, null, 2));
  return dir;
}

// ---------- для админов: манифест из профиля ----------
// profile: { loader, loaderVersion, mcVersion }, mc: точная версия, dir: папка профиля
async function buildFromProfile({ profile, mc, dir, server }) {
  const warnings = [];
  let lv = profile.loaderVersion;
  if (profile.loader !== 'vanilla' && !lv) lv = loaders.pickDefault(profile.loader, await loaders.listLoaderVersions(profile.loader, mc)) || '';
  const meta = mr.readMeta(dir);
  const files = [];
  for (const it of mr.list(dir)) {
    if (!it.enabled) continue;
    const rec = meta.items[it.key] || {};
    const folder = mr.FOLDERS[it.type];
    let info = null;
    try {
      if (rec.source === 'curseforge' && rec.projectId && rec.versionId && cf.hasKey()) info = await cf.fileInfo(rec.projectId, rec.versionId);
      else if (rec.projectId && rec.versionId && rec.source !== 'curseforge') info = await mr.versionFile(rec.versionId);
    } catch (e) { warnings.push(`${it.title}: ${e.message}`); continue; }
    if (!info) {
      warnings.push(`${it.title} (${it.file}) — ${rec.projectId ? 'автор запретил скачивание в лаунчерах' : 'добавлен вручную'}: добавь в файл ссылку на свой хостинг`);
      continue;
    }
    files.push({ path: `${folder}/${info.filename}`, url: info.url, sha1: info.sha1, size: info.size, title: it.title });
  }
  return {
    manifest: {
      format: FORMAT, name: profile.name, updated: new Date().toISOString(),
      minecraft: mc, loader: profile.loader, loaderVersion: lv || '', ram: profile.ram || 0,
      server: server || null, files
    },
    warnings
  };
}

module.exports = { SERVER_PROFILE_ID, fetchManifest, sync, buildFromProfile, validate, checkPath, hostAllowed };
