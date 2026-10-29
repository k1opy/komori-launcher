'use strict';
// Сборка сервера Komori: манифест (komori-server.json) — его собирают админы на komori.fun/admin/pack.
// Игроку: скачать манифест -> поставить версию и ядро -> докачать файлы -> убрать снятые -> отключить лишние моды -> зайти на сервер.
// Файлы настроек бывают «один раз» (mode: once — ставится, если нет; обновляется, только если игрок свой не менял)
// и «закреплённые» (force — всегда как у сервера). Свои моды игрок может ставить только из списка allowed.
// Админу (DEV): собрать манифест из своего профиля.
const fs = require('fs');
const path = require('path');
const { fetchJson, downloadAll, sha1File } = require('./net');
const mr = require('./modrinth');
const cf = require('./curseforge');
const loaders = require('./loaders');

const SERVER_PROFILE_ID = 'f00d00000001';
const FORMAT = 1;
const DEFAULT_HOSTS = ['cdn.modrinth.com', 'edge.forgecdn.net', 'mediafilez.forgecdn.net', 'komori.fun'];
const ALLOWED_DIRS = ['mods/', 'resourcepacks/', 'shaderpacks/', 'config/'];
const ROOT_FILES = ['options.txt'];
const MR_API = 'https://api.modrinth.com/v2';
const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'];

function hostAllowed(url, extraHosts) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  return DEFAULT_HOSTS.concat(extraHosts || []).includes(u.hostname);
}

function checkPath(rel) {
  const p = String(rel || '').replace(/\\/g, '/');
  if (ROOT_FILES.includes(p)) return p;
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
    const mode = !p.startsWith('mods/') && f.mode === 'once' ? 'once' : 'force';
    const projectId = /^[A-Za-z0-9]{1,16}$/.test(String(f.projectId || '')) ? String(f.projectId) : undefined;
    files.push({ path: p, url: f.url, sha1: f.sha1, size: Number(f.size) || undefined, title: String(f.title || path.basename(p)).slice(0, 100), mode, projectId });
  }
  // Что игрокам можно поставить сверху (null — старая сборка без списка: свои моды не трогаем)
  const allowed = Array.isArray(m.allowed) ? m.allowed.filter(a => a && /^[A-Za-z0-9]{1,16}$/.test(String(a.projectId))).slice(0, 300).map(a => ({
    projectId: String(a.projectId), title: String(a.title || a.projectId).slice(0, 100), slug: String(a.slug || '').replace(/[^\w-]/g, '').slice(0, 80),
    type: ['mod', 'resourcepack', 'shader'].includes(a.type) ? a.type : 'mod', icon: /^https:\/\/cdn\.modrinth\.com\//.test(String(a.icon || '')) ? a.icon : '', dep: !!a.dep
  })) : null;
  return {
    format: FORMAT, name: String(m.name || 'Komori').slice(0, 32), updated: String(m.updated || ''),
    minecraft: String(m.minecraft), loader: m.loader, loaderVersion: String(m.loaderVersion || '').replace(/[^A-Za-z0-9._+\-]/g, ''),
    ram: Math.max(0, Math.min(32, Number(m.ram) || 0)),
    server: m.server && /^[A-Za-z0-9.\-]{1,253}$/.test(m.server.host || '') ? { host: m.server.host, port: Number(m.server.port) || 25565 } : null,
    files, allowed
  };
}

// Сначала komori.fun, если сайт недоступен — запасной адрес (GitHub), если и он — последняя скачанная копия
async function fetchManifest(url, root, extraHosts, fallback) {
  const cache = path.join(root, 'versions', 'komori-server.json');
  let raw, firstErr;
  for (const u of [url, fallback].filter(Boolean)) {
    try {
      raw = await fetchJson(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
      validate(raw, extraHosts);
      break;
    } catch (e) { raw = null; firstErr = firstErr || e; }
  }
  if (raw) {
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, JSON.stringify(raw, null, 2));
  } else {
    try { raw = JSON.parse(fs.readFileSync(cache, 'utf8')); } catch { throw new Error('Не удалось скачать сборку сервера: ' + (firstErr ? firstErr.message : 'нет адреса')); }
  }
  return validate(raw, extraHosts);
}

// Синхронизация папки профиля сервера с манифестом. Возвращает { dir, blocked: [названия отключённых модов] }
async function sync(root, m, progress) {
  const dir = path.join(root, 'instances', SERVER_PROFILE_ID);
  const statePath = path.join(dir, 'komori-server-state.json');
  let state = { managed: [] };
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}
  const applied = state.applied || {};   // какую версию файла «один раз» мы ставили последней

  const wanted = new Set(m.files.map(f => f.path));
  // Убираем моды, шейдеры и ресурспаки, которые админ снял из сборки. Настройки игрока не трогаем.
  for (const old of state.managed || []) {
    if (wanted.has(old) || old.startsWith('config/') || ROOT_FILES.includes(old)) continue;
    try { checkPath(old); } catch { continue; }
    for (const p of [path.join(dir, old), path.join(dir, old + '.disabled')]) if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  // Если игрок выключил обязательный мод — включаем обратно.
  for (const f of m.files) {
    const on = path.join(dir, f.path);
    const off = on + '.disabled';
    if (!fs.existsSync(on) && fs.existsSync(off)) fs.renameSync(off, on);
  }
  const tasks = [];
  for (const f of m.files) {
    const dest = path.join(dir, f.path);
    if (f.mode === 'once' && fs.existsSync(dest)) {
      // Файл уже есть. Обновляем, только если игрок его не менял (он совпадает с тем, что мы ставили раньше)
      const prev = applied[f.path];
      if (prev === f.sha1) continue;
      let local = null;
      try { local = await sha1File(dest); } catch {}
      if (local === f.sha1) { applied[f.path] = f.sha1; continue; }
      if (!prev || local !== prev) continue; // игрок настроил под себя — не трогаем
      try { fs.unlinkSync(dest); } catch {}
    }
    tasks.push({ url: f.url, dest, sha1: f.sha1, size: f.size, verify: true, path: f.path });
  }
  await downloadAll(tasks, (d, t) => progress('Сборка сервера', d, t), 8);
  for (const t of tasks) applied[t.path] = t.sha1;
  fs.mkdirSync(dir, { recursive: true });
  const blocked = m.allowed ? await enforceAllowed(dir, m, state) : [];
  fs.writeFileSync(statePath, JSON.stringify({ managed: [...wanted], applied, known: state.known || {}, updated: m.updated, synced: Date.now() }, null, 2));
  return { dir, blocked };
}

// Свои моды игрока: оставляем только разрешённые админами. Узнаём мод по SHA-1 через Modrinth.
async function enforceAllowed(dir, m, state) {
  const modsDir = path.join(dir, 'mods');
  let files = [];
  try { files = fs.readdirSync(modsDir).filter(f => /\.jar$/i.test(f)); } catch { return []; }
  const wanted = new Set(m.files.filter(f => f.path.startsWith('mods/')).map(f => f.path.slice(5).toLowerCase()));
  const extra = files.filter(f => !wanted.has(f.toLowerCase()));
  if (!extra.length) return [];
  const allowed = new Set(m.allowed.map(a => a.projectId));
  const known = state.known = state.known || {};   // sha1 -> projectId ('' — нет на Modrinth)
  const hashes = {};
  for (const f of extra) { try { hashes[f] = await sha1File(path.join(modsDir, f)); } catch {} }
  const unknown = Object.values(hashes).filter(h => !(h in known));
  if (unknown.length) {
    try {
      const res = await fetch(MR_API + '/version_files', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'komori/KomoriLauncher (mc.komori.fun)' }, body: JSON.stringify({ hashes: unknown, algorithm: 'sha1' }) });
      if (res.ok) { const r = await res.json(); for (const h of unknown) known[h] = r[h] ? r[h].project_id : ''; }
    } catch {}
  }
  // Нет на Modrinth — пробуем узнать на CurseForge по отпечатку файла
  const notMr = extra.filter(f => hashes[f] && known[hashes[f]] === '');
  if (notMr.length && cf.hasKey()) {
    try {
      const prints = {};
      for (const f of notMr) prints[f] = cf.fingerprint(fs.readFileSync(path.join(modsDir, f)));
      const found = await cf.identify(Object.values(prints));
      for (const f of notMr) if (found[prints[f]]) known[hashes[f]] = 'cf' + found[prints[f]];
    } catch {}
  }
  const blocked = [];
  for (const f of extra) {
    const h = hashes[f];
    if (!h || !(h in known)) continue;            // Modrinth недоступен — не наказываем игрока, проверим в следующий раз
    if (allowed.has(known[h])) continue;
    try { fs.renameSync(path.join(modsDir, f), path.join(modsDir, f + '.disabled')); blocked.push(f); } catch {}
  }
  return blocked;
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
