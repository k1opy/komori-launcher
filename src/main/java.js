'use strict';
// Java: скачивание официальных сборок Java от Mojang под нужную версию игры.
const fs = require('fs');
const path = require('path');
const { fetchJson, downloadAll } = require('./net');

const RUNTIME_INDEX = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

function platformKey() {
  if (process.arch === 'ia32') return 'windows-x86';
  if (process.arch === 'arm64') return 'windows-arm64';
  return 'windows-x64';
}

// Какая Java нужна версии: из javaVersion в json, иначе Java 8 (jre-legacy).
function componentFor(version) {
  return (version.javaVersion && version.javaVersion.component) || 'jre-legacy';
}

async function ensureJava(root, component, onProgress) {
  const dir = path.join(root, 'runtime', component);
  const javaw = path.join(dir, 'bin', 'javaw.exe');
  const java = path.join(dir, 'bin', 'java.exe');
  const marker = path.join(dir, '.komori-ok');
  if (fs.existsSync(marker) && fs.existsSync(javaw)) return { javaw, java };

  const index = await fetchJson(RUNTIME_INDEX);
  const plat = index[platformKey()] || {};
  const list = plat[component];
  if (!list || !list.length) throw new Error(`Mojang не даёт Java «${component}» для ${platformKey()}`);
  const manifest = await fetchJson(list[0].manifest.url);

  const tasks = [];
  for (const [rel, f] of Object.entries(manifest.files || {})) {
    const p = path.join(dir, rel);
    if (f.type === 'directory') { fs.mkdirSync(p, { recursive: true }); continue; }
    if (f.type === 'file' && f.downloads && f.downloads.raw) {
      tasks.push({ url: f.downloads.raw.url, dest: p, sha1: f.downloads.raw.sha1, size: f.downloads.raw.size });
    }
  }
  await downloadAll(tasks, onProgress, 12);
  if (!fs.existsSync(javaw)) throw new Error('Java скачалась, но javaw.exe не найден');
  fs.writeFileSync(marker, String(Date.now()));
  return { javaw, java };
}

module.exports = { ensureJava, componentFor };
