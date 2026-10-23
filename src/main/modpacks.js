'use strict';
// Сборки: Modrinth (.mrpack) и CurseForge (zip с manifest.json). Создают новый профиль с нужным ядром.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { downloadAll } = require('./net');
const cf = require('./curseforge');
const mr = require('./modrinth');

// Разрешённые источники файлов в .mrpack (по спецификации Modrinth).
const MR_HOSTS = /^https:\/\/(cdn\.modrinth\.com|github\.com|raw\.githubusercontent\.com|gitlab\.com)\//;

// Путь внутри папки профиля без выхода наружу (защита от "../").
function safeJoin(dir, rel) {
  const clean = String(rel).replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || /^[A-Za-z]:/.test(clean)) throw new Error('Недопустимый путь в сборке: ' + rel);
  const full = path.resolve(dir, clean);
  const base = path.resolve(dir) + path.sep;
  if (!full.startsWith(base)) throw new Error('Недопустимый путь в сборке: ' + rel);
  return full;
}

function extractFolder(zip, prefix, dir) {
  let n = 0;
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const name = e.entryName.replace(/\\/g, '/');
    if (!name.startsWith(prefix + '/')) continue;
    const rel = name.slice(prefix.length + 1);
    if (!rel) continue;
    const dest = safeJoin(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.getData());
    n++;
  }
  return n;
}

function readEntry(zip, name) {
  const e = zip.getEntry(name);
  return e ? JSON.parse(e.getData().toString('utf8')) : null;
}

function loaderFromMrDeps(deps) {
  if (deps['fabric-loader']) return ['fabric', deps['fabric-loader']];
  if (deps['quilt-loader']) return ['quilt', deps['quilt-loader']];
  if (deps.neoforge) return ['neoforge', deps.neoforge];
  if (deps.forge) return ['forge', deps.forge];
  return ['vanilla', ''];
}

function loaderFromCf(modLoaders) {
  const ml = (modLoaders || []).find(x => x.primary) || (modLoaders || [])[0];
  if (!ml) return ['vanilla', ''];
  const id = String(ml.id);
  const i = id.indexOf('-');
  const name = (i < 0 ? id : id.slice(0, i)).toLowerCase();
  const ver = i < 0 ? '' : id.slice(i + 1);
  return [['forge', 'fabric', 'neoforge', 'quilt'].includes(name) ? name : 'vanilla', ver];
}

// deps: { root, saveProfile(p) -> profiles, progress(stage, done, total), icon? , nameHint? }
async function installFromFile(zipPath, deps) {
  const zip = new AdmZip(zipPath);
  const mrIndex = readEntry(zip, 'modrinth.index.json');
  if (mrIndex) return installMrpack(zip, mrIndex, deps);
  const manifest = readEntry(zip, 'manifest.json');
  if (manifest && manifest.minecraft) return installCfPack(zip, manifest, deps);
  throw new Error('Это не сборка Modrinth (.mrpack) и не сборка CurseForge (zip с manifest.json)');
}

function createProfile(deps, name, loader, loaderVersion, mc) {
  const data = deps.saveProfile({ name: String(name || 'Сборка').slice(0, 32), icon: deps.icon || 'chest', loader, loaderVersion, mcVersion: mc });
  const profile = data.list.find(p => p.id === data.selected);
  const dir = path.join(deps.root, 'instances', profile.id);
  fs.mkdirSync(dir, { recursive: true });
  return { profile, dir };
}

async function installMrpack(zip, idx, deps) {
  const mc = idx.dependencies && idx.dependencies.minecraft;
  if (!mc) throw new Error('В сборке не указана версия Minecraft');
  const [loader, lv] = loaderFromMrDeps(idx.dependencies);
  // Сначала проверяем все пути, чтобы при плохой сборке не остался пустой профиль.
  const probe = path.join(deps.root, 'instances', '_probe');
  const files = [];
  for (const f of idx.files || []) {
    if (f.env && f.env.client === 'unsupported') continue;
    const url = (f.downloads || []).find(u => MR_HOSTS.test(u));
    if (!url) continue;
    safeJoin(probe, f.path);
    files.push({ f, url });
  }
  const { profile, dir } = createProfile(deps, deps.nameHint || idx.name, loader, lv, mc);
  const tasks = files.map(({ f, url }) => ({ url, dest: safeJoin(dir, f.path), sha1: f.hashes && f.hashes.sha1, size: f.fileSize, verify: true }));
  await downloadAll(tasks, (d, t) => deps.progress('Файлы сборки', d, t), 8);
  extractFolder(zip, 'overrides', dir);
  extractFolder(zip, 'client-overrides', dir);
  return { profile, manual: [] };
}

async function installCfPack(zip, m, deps) {
  const mc = m.minecraft.version;
  const [loader, lv] = loaderFromCf(m.minecraft.modLoaders);
  const { profile, dir } = createProfile(deps, deps.nameHint || m.name, loader, lv, mc);

  const entries = (m.files || []).filter(f => f.required !== false && f.projectID && f.fileID);
  deps.progress('Список файлов CurseForge', 0, entries.length);
  const files = entries.length ? await cf.resolvePackFiles(entries) : [];
  const manual = [];
  const tasks = [];
  const meta = mr.readMeta(dir);
  for (const f of files) {
    if (!f.url) { manual.push({ title: f.title, url: f.website }); continue; }
    const name = mr.safeName(f.name);
    tasks.push({ url: f.url, dest: path.join(dir, mr.FOLDERS[f.type], name), sha1: f.sha1, size: f.size, verify: true });
    meta.items[`${f.type}/${name}`] = { source: 'curseforge', projectId: String(f.modId), versionId: String(f.fileId), versionNumber: name, file: name, type: f.type, sha1: f.sha1, title: f.title };
  }
  await downloadAll(tasks, (d, t) => deps.progress('Файлы сборки', d, t), 8);
  mr.writeMeta(dir, meta);
  extractFolder(zip, m.overrides || 'overrides', dir);
  return { profile, manual };
}

module.exports = { installFromFile, safeJoin, loaderFromCf, loaderFromMrDeps };
