'use strict';
// Ядра: Fabric, Quilt (профиль json с их серверов), Forge, NeoForge (официальный установщик в тихом режиме).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { fetchJson, downloadAll, UA } = require('./net');
const versions = require('./versions');
const { ensureJava, componentFor } = require('./java');

const FABRIC_META = 'https://meta.fabricmc.net/v2';
const QUILT_META = 'https://meta.quiltmc.org/v3';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const NEO_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} при запросе ${url}`);
  return r.text();
}

function parseMavenVersions(xml) {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
}

function cmpNum(a, b) {
  const pa = a.split(/[.\-+]/).map(x => (isNaN(+x) ? x : +x));
  const pb = b.split(/[.\-+]/).map(x => (isNaN(+x) ? x : +x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i], y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

// Префикс версий NeoForge для версии Minecraft: 1.21.1 -> "21.1.", 1.21 -> "21.0.", 26.1 -> "26.1."
function neoPrefix(mc) {
  const m = /^1\.(\d+)(?:\.(\d+))?$/.exec(mc);
  if (m) return `${m[1]}.${m[2] || 0}.`;
  const y = /^(\d{2})\.(\d+)(?:\.(\d+))?$/.exec(mc);
  if (y) return y[3] ? `${y[1]}.${y[2]}.${y[3]}.` : `${y[1]}.${y[2]}.`;
  return null;
}

// Список версий ядра для версии Minecraft: [{ id, tag }], новые сверху.
async function listLoaderVersions(loader, mc) {
  if (loader === 'fabric') {
    const list = await fetchJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(mc)}`);
    return list.map(x => ({ id: x.loader.version, tag: x.loader.stable ? 'стабильная' : '' }));
  }
  if (loader === 'quilt') {
    const list = await fetchJson(`${QUILT_META}/versions/loader/${encodeURIComponent(mc)}`);
    return list.map(x => ({ id: x.loader.version, tag: /beta|pre|rc/i.test(x.loader.version) ? 'бета' : '' }));
  }
  if (loader === 'forge') {
    const [xml, promos] = await Promise.all([fetchText(`${FORGE_MAVEN}/maven-metadata.xml`), fetchJson(FORGE_PROMOS).catch(() => ({ promos: {} }))]);
    const rec = promos.promos[`${mc}-recommended`];
    const lat = promos.promos[`${mc}-latest`];
    return parseMavenVersions(xml)
      .filter(v => v.startsWith(mc + '-'))
      .map(v => v.slice(mc.length + 1))
      .filter(v => /^\d/.test(v))
      .sort((a, b) => cmpNum(b, a))
      .map(v => ({ id: v, tag: v === rec ? 'рекомендуемая' : v === lat ? 'последняя' : '' }));
  }
  if (loader === 'neoforge') {
    const prefix = neoPrefix(mc);
    if (!prefix) return [];
    const xml = await fetchText(`${NEO_MAVEN}/maven-metadata.xml`);
    return parseMavenVersions(xml)
      .filter(v => v.startsWith(prefix))
      .sort((a, b) => cmpNum(b, a))
      .map(v => ({ id: v, tag: /beta|alpha/i.test(v) ? 'бета' : '' }));
  }
  return [];
}

function pickDefault(loader, list) {
  if (!list.length) return null;
  if (loader === 'fabric') return (list.find(x => x.tag === 'стабильная') || list[0]).id;
  if (loader === 'forge') return (list.find(x => x.tag === 'рекомендуемая') || list[0]).id;
  return (list.find(x => !x.tag) || list[0]).id;
}

// ---------- установка ----------
function cachePath(root) { return path.join(root, 'versions', 'komori-loaders.json'); }
function readCache(root) { try { return JSON.parse(fs.readFileSync(cachePath(root), 'utf8')); } catch { return {}; } }
function writeCache(root, c) { fs.mkdirSync(path.dirname(cachePath(root)), { recursive: true }); fs.writeFileSync(cachePath(root), JSON.stringify(c, null, 2)); }
function hasVersion(root, id) { return !!id && fs.existsSync(path.join(root, 'versions', id, id + '.json')); }

async function installProfileJson(root, url) {
  const json = await fetchJson(url);
  const dir = path.join(root, 'versions', json.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, json.id + '.json'), JSON.stringify(json, null, 2));
  return json.id;
}

function runInstaller(java, jar, root, onLog) {
  return new Promise((resolve, reject) => {
    const child = spawn(java, ['-jar', jar, '--installClient', root], { cwd: root, windowsHide: true });
    let tail = '';
    const h = d => { const s = d.toString(); tail = (tail + s).slice(-4000); onLog && onLog(s); };
    child.stdout.on('data', h);
    child.stderr.on('data', h);
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error('Установщик ядра завершился с ошибкой (код ' + code + '):\n' + tail.split('\n').slice(-6).join('\n')))));
  });
}

// Возвращает id версии для запуска (для vanilla — сама версия Minecraft).
async function ensureLoader(root, loader, mc, loaderVersion, progress, onLog) {
  if (!loader || loader === 'vanilla') return mc;
  let lv = loaderVersion;
  if (!lv) {
    progress('Ядро: выбор версии', 0, 1);
    lv = pickDefault(loader, await listLoaderVersions(loader, mc));
    if (!lv) throw new Error(`Для Minecraft ${mc} нет версий ${loader}`);
  }

  if (loader === 'fabric') {
    const id = `fabric-loader-${lv}-${mc}`;
    if (hasVersion(root, id)) return id;
    progress('Ядро Fabric', 0, 1);
    return installProfileJson(root, `${FABRIC_META}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(lv)}/profile/json`);
  }
  if (loader === 'quilt') {
    const id = `quilt-loader-${lv}-${mc}`;
    if (hasVersion(root, id)) return id;
    progress('Ядро Quilt', 0, 1);
    return installProfileJson(root, `${QUILT_META}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(lv)}/profile/json`);
  }

  // Forge / NeoForge: официальный установщик
  const key = `${loader}:${mc}:${lv}`;
  const cache = readCache(root);
  if (hasVersion(root, cache[key])) return cache[key];

  const full = loader === 'forge' ? `${mc}-${lv}` : lv;
  const url = loader === 'forge'
    ? `${FORGE_MAVEN}/${full}/forge-${full}-installer.jar`
    : `${NEO_MAVEN}/${full}/neoforge-${full}-installer.jar`;
  const jar = path.join(root, 'cache', 'installers', path.basename(url));

  // Установщику нужна ванильная версия и файл профилей лаунчера.
  const vanilla = await versions.installVersion(root, mc, path.join(root, 'instances', '_downloads'), progress);
  const java = await ensureJava(root, componentFor(vanilla.version), (d, t) => progress('Java', d, t));
  const lp = path.join(root, 'launcher_profiles.json');
  if (!fs.existsSync(lp)) fs.writeFileSync(lp, JSON.stringify({ profiles: {}, settings: {}, version: 3 }));

  progress(loader === 'forge' ? 'Скачиваю Forge' : 'Скачиваю NeoForge', 0, 1);
  await downloadAll([{ url, dest: jar }]);

  const before = new Set(fs.readdirSync(path.join(root, 'versions')));
  progress(loader === 'forge' ? 'Устанавливаю Forge (до пары минут)' : 'Устанавливаю NeoForge (до пары минут)', 0, 0);
  await runInstaller(java.java, jar, root, onLog);

  const after = fs.readdirSync(path.join(root, 'versions')).filter(n => hasVersion(root, n));
  let id = after.find(n => !before.has(n) && n.toLowerCase().includes(loader === 'forge' ? 'forge' : 'neoforge'));
  if (!id) id = after.find(n => n.toLowerCase().includes(lv.toLowerCase()) && n.toLowerCase().includes(loader === 'forge' ? 'forge' : 'neoforge'));
  if (!id) throw new Error('Установщик отработал, но версия ядра не найдена в папке versions');
  cache[key] = id;
  writeCache(root, cache);
  return id;
}

module.exports = { listLoaderVersions, ensureLoader, neoPrefix, cmpNum, pickDefault };
