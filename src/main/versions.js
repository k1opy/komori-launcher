'use strict';
// Версии Minecraft: список с серверов Mojang, установка (json, клиент, библиотеки, нативные, ассеты).
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { fetchJson, downloadAll } = require('./net');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const LIBRARIES_URL = 'https://libraries.minecraft.net/';
const RESOURCES_URL = 'https://resources.download.minecraft.net/';

let manifestCache = null;

async function getManifest(root, force = false) {
  const cachePath = path.join(root, 'versions', 'version_manifest_v2.json');
  if (manifestCache && !force) return manifestCache;
  try {
    manifestCache = await fetchJson(MANIFEST_URL);
    await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.promises.writeFile(cachePath, JSON.stringify(manifestCache));
  } catch (e) {
    // Нет интернета — берём сохранённый список.
    try { manifestCache = JSON.parse(await fs.promises.readFile(cachePath, 'utf8')); } catch { throw e; }
  }
  return manifestCache;
}

// Короткий список для интерфейса.
async function listVersions(root) {
  const m = await getManifest(root);
  const installed = new Set(await installedVersions(root));
  return {
    latest: m.latest,
    versions: m.versions.map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime, installed: installed.has(v.id) }))
  };
}

async function installedVersions(root) {
  const dir = path.join(root, 'versions');
  try {
    const names = await fs.promises.readdir(dir);
    return names.filter(n => fs.existsSync(path.join(dir, n, n + '.json')));
  } catch { return []; }
}

async function resolveId(root, id) {
  if (id === 'latest-release' || id === 'latest-snapshot') {
    const m = await getManifest(root);
    return id === 'latest-release' ? m.latest.release : m.latest.snapshot;
  }
  return id;
}

// ---------- правила (rules) ----------
function archName() { return process.arch === 'ia32' ? 'x86' : process.arch; }

function rulesAllow(rules, features = {}) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const r of rules) {
    let match = true;
    if (r.os) {
      if (r.os.name && r.os.name !== 'windows') match = false;
      if (r.os.arch && r.os.arch !== archName()) match = false;
    }
    if (r.features) {
      for (const k of Object.keys(r.features)) if (!!features[k] !== !!r.features[k]) match = false;
    }
    if (match) allowed = r.action === 'allow';
  }
  return allowed;
}

// group:artifact:version[:classifier][@ext] -> путь в Maven
function mavenPath(name) {
  let ext = 'jar';
  let n = name;
  const at = n.indexOf('@');
  if (at >= 0) { ext = n.slice(at + 1); n = n.slice(0, at); }
  const [group, artifact, version, classifier] = n.split(':');
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.${ext}`;
  return [...group.split('.'), artifact, version, file].join('/');
}

// ---------- json версии ----------
function versionDir(root, id) { return path.join(root, 'versions', id); }

async function readLocalJson(root, id) {
  try { return JSON.parse(await fs.promises.readFile(path.join(versionDir(root, id), id + '.json'), 'utf8')); } catch { return null; }
}

async function fetchVersionJson(root, id) {
  const local = await readLocalJson(root, id);
  const m = await getManifest(root).catch(() => null);
  const entry = m && m.versions.find(v => v.id === id);
  if (local && (!entry || !entry.sha1)) return local;
  if (!entry) {
    if (local) return local;
    throw new Error(`Версия ${id} не найдена`);
  }
  const p = path.join(versionDir(root, id), id + '.json');
  await downloadAll([{ url: entry.url, dest: p, sha1: entry.sha1, verify: true }]);
  return JSON.parse(await fs.promises.readFile(p, 'utf8'));
}

// Склейка с родителем (для Fabric/Forge/Quilt профилей: inheritsFrom).
// Ключ библиотеки без версии: группа:артефакт[:классификатор]. Нужен, чтобы библиотека ядра заменяла ванильную.
function libKey(lib) {
  const parts = String(lib.name || '').split('@')[0].split(':');
  return parts.length >= 4 ? `${parts[0]}:${parts[1]}:${parts[3]}` : `${parts[0]}:${parts[1]}`;
}

function mergeVersion(child, parent) {
  const out = Object.assign({}, parent, child);
  const seen = new Set();
  out.libraries = [];
  for (const lib of [...(child.libraries || []), ...(parent.libraries || [])]) {
    // Сначала отбрасываем библиотеки других ОС, иначе дубль для macOS мог бы вытеснить нужный для Windows.
    if (!rulesAllow(lib.rules)) continue;
    const k = lib.name ? libKey(lib) + (lib.natives ? ':natives' : '') : JSON.stringify(lib);
    if (seen.has(k)) continue;
    seen.add(k);
    out.libraries.push(lib);
  }
  if (parent.arguments || child.arguments) {
    out.arguments = {
      game: [...((parent.arguments && parent.arguments.game) || []), ...((child.arguments && child.arguments.game) || [])],
      jvm: [...((parent.arguments && parent.arguments.jvm) || []), ...((child.arguments && child.arguments.jvm) || [])]
    };
  }
  if (child.minecraftArguments) out.minecraftArguments = child.minecraftArguments;
  out.downloads = parent.downloads;
  out.assetIndex = parent.assetIndex;
  out.assets = parent.assets;
  out.javaVersion = child.javaVersion || parent.javaVersion;
  out.jarId = parent.jarId || parent.id;
  delete out.inheritsFrom;
  return out;
}

async function resolveFull(root, id) {
  let v = await readLocalJson(root, id);
  if (!v) v = await fetchVersionJson(root, id);
  if (v.inheritsFrom) {
    const parent = await resolveFull(root, v.inheritsFrom);
    v = mergeVersion(v, parent);
  } else {
    v.jarId = v.jarId || v.id;
  }
  return v;
}

// ---------- библиотеки ----------
function collectLibraries(v, root) {
  const tasks = [];
  const classpath = [];
  const natives = [];
  const seenCp = new Set();
  for (const lib of v.libraries || []) {
    if (!rulesAllow(lib.rules)) continue;
    const dl = lib.downloads || {};
    const isNativeArtifact = /:natives-windows/.test(lib.name || '');

    if (dl.artifact) {
      const p = path.join(root, 'libraries', dl.artifact.path || mavenPath(lib.name));
      // Пустой url: файл создаёт установщик Forge/NeoForge, качать не нужно, но он нужен в classpath.
      if (dl.artifact.url) tasks.push({ url: dl.artifact.url, dest: p, sha1: dl.artifact.sha1, size: dl.artifact.size });
      if (lib.clientreq !== false && !seenCp.has(p) && (dl.artifact.url || fs.existsSync(p))) { seenCp.add(p); classpath.push(p); }
      if (isNativeArtifact && dl.artifact.url) natives.push({ path: p, exclude: ['META-INF/'] });
    } else if (!lib.natives && lib.name) {
      // Maven-библиотеки без блока downloads (Fabric, Quilt, старые версии).
      const rel = mavenPath(lib.name);
      const base = (lib.url || LIBRARIES_URL).replace(/\/?$/, '/');
      const p = path.join(root, 'libraries', rel);
      tasks.push({ url: base + rel, dest: p, sha1: lib.sha1, size: lib.size });
      if (!seenCp.has(p)) { seenCp.add(p); classpath.push(p); }
    }

    // Старый формат нативных библиотек (LWJGL 2 и ранний LWJGL 3).
    if (lib.natives && lib.natives.windows) {
      const key = lib.natives.windows.replace('${arch}', process.arch === 'ia32' ? '32' : '64');
      const c = dl.classifiers && dl.classifiers[key];
      if (c) {
        const p = path.join(root, 'libraries', c.path || mavenPath(lib.name + ':' + key));
        tasks.push({ url: c.url, dest: p, sha1: c.sha1, size: c.size });
        natives.push({ path: p, exclude: (lib.extract && lib.extract.exclude) || ['META-INF/'] });
      }
    }
  }
  return { tasks, classpath, natives };
}

function extractNatives(natives, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const n of natives) {
    const zip = new AdmZip(n.path);
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      if (n.exclude.some(x => e.entryName.startsWith(x))) continue;
      const name = path.basename(e.entryName);
      if (!/\.(dll|so|dylib|jnilib)$/i.test(name)) continue;
      fs.writeFileSync(path.join(dir, name), e.getData());
    }
  }
}

// ---------- ассеты ----------
async function installAssets(v, root, gameDir, onProgress) {
  if (!v.assetIndex) return { assetsRoot: path.join(root, 'assets'), gameAssets: path.join(root, 'assets'), index: v.assets || 'legacy' };
  const idx = v.assetIndex;
  const idxPath = path.join(root, 'assets', 'indexes', idx.id + '.json');
  await downloadAll([{ url: idx.url, dest: idxPath, sha1: idx.sha1, size: idx.size, verify: true }]);
  const data = JSON.parse(await fs.promises.readFile(idxPath, 'utf8'));
  const objects = Object.entries(data.objects || {});
  const tasks = objects.map(([, o]) => ({
    url: RESOURCES_URL + o.hash.slice(0, 2) + '/' + o.hash,
    dest: path.join(root, 'assets', 'objects', o.hash.slice(0, 2), o.hash),
    sha1: o.hash, size: o.size
  }));
  await downloadAll(tasks, onProgress, 24);

  const assetsRoot = path.join(root, 'assets');
  let gameAssets = assetsRoot;
  // Очень старые версии читают ассеты по обычным путям.
  if (data.map_to_resources || data.virtual) {
    const target = data.map_to_resources ? path.join(gameDir, 'resources') : path.join(root, 'assets', 'virtual', idx.id);
    for (const [name, o] of objects) {
      const dst = path.join(target, name);
      if (fs.existsSync(dst)) continue;
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(root, 'assets', 'objects', o.hash.slice(0, 2), o.hash), dst);
    }
    gameAssets = target;
  }
  return { assetsRoot, gameAssets, index: idx.id };
}

// ---------- полная установка ----------
// progress(stage, done, total)
async function installVersion(root, id, gameDir, progress) {
  progress('Версия', 0, 1);
  const v = await resolveFull(root, id);

  const tasks = [];
  const jarPath = path.join(versionDir(root, v.jarId), v.jarId + '.jar');
  if (v.downloads && v.downloads.client) {
    tasks.push({ url: v.downloads.client.url, dest: jarPath, sha1: v.downloads.client.sha1, size: v.downloads.client.size });
  }
  const libs = collectLibraries(v, root);
  tasks.push(...libs.tasks);
  await downloadAll(tasks, (d, t) => progress('Библиотеки', d, t));

  const nativesDir = path.join(versionDir(root, v.id), 'natives');
  extractNatives(libs.natives, nativesDir);

  const assets = await installAssets(v, root, gameDir, (d, t) => progress('Ресурсы', d, t));
  return { version: v, jarPath, classpath: libs.classpath, nativesDir, assets };
}

module.exports = { listVersions, installVersion, resolveId, rulesAllow, mavenPath, getManifest, readLocalJson, resolveFull, mergeVersion };
