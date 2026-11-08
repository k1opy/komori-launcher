'use strict';
// Патчи сборок в формате Prism/MultiMC (папка patches/ внутри сборки).
// Так сделан, например, GT New Horizons для Java 17+: lwjgl3ify заменяет LWJGL 2 на LWJGL 3,
// меняет главный класс и добавляет аргументы Java. Без этих патчей сборка падает на старой Java 8.
const fs = require('fs');
const path = require('path');

const ORDER = ['net.minecraft.json', 'net.minecraftforge.json'];

function read(gameDir) {
  const dir = path.join(gameDir, 'patches');
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.json')); } catch { return []; }
  names.sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const out = [];
  for (const n of names) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      // Берём только настоящие патчи Prism, а не случайные json какого-нибудь мода в папке patches
      if (j && typeof j === 'object' && ['+libraries', '-libraries', '+jvmArgs', '+tweakers', 'mainClass'].some(k => k in j)) out.push(Object.assign({ _file: n }, j));
    } catch {}
  }
  return out;
}

function ga(name) { const p = String(name || '').split('@')[0].split(':'); return p[0] + ':' + p[1]; }
function gac(name) { const p = String(name || '').split('@')[0].split(':'); return p[0] + ':' + p[1] + (p[3] ? ':' + p[3] : ''); }

// Локальные библиотеки Prism лежат прямо в <сборка>/libraries/<artifact>-<version>[-classifier].jar
function localFile(gameDir, name) {
  const p = String(name || '').split('@')[0].split(':');
  if (p.length < 3) return null;
  const f = path.join(gameDir, 'libraries', `${p[1]}-${p[2]}${p[3] ? '-' + p[3] : ''}.jar`);
  return fs.existsSync(f) ? f : null;
}

// Нативные jar LWJGL 3 для других архитектур (x86, arm64) на 64-битной Windows не нужны
function otherArch(lib) {
  const n = String(lib.name || '');
  if (process.arch === 'x64') return /natives-windows-(x86|arm64)\b/.test(n);
  if (process.arch === 'arm64') return /natives-windows(-x86)?(:|$)/.test(n) && !/arm64/.test(n);
  return false;
}

function apply(v, gameDir, patches, rulesAllow) {
  v._extraJvm = v._extraJvm || [];
  v._tweakers = v._tweakers || [];
  let needsModernJava = false;
  for (const p of patches) {
    if (Array.isArray(p['-libraries'])) {
      const drop = new Set(p['-libraries'].map(ga));
      v.libraries = (v.libraries || []).filter(l => !drop.has(ga(l.name)));
    }
    if (Array.isArray(p['+libraries'])) {
      for (const lib of p['+libraries']) {
        if (!lib || !lib.name || otherArch(lib)) continue;
        if (lib.rules && !rulesAllow(lib.rules)) continue;
        const key = gac(lib.name);
        v.libraries = (v.libraries || []).filter(l => gac(l.name) !== key);
        const local = localFile(gameDir, lib.name);
        v.libraries.unshift(local ? { name: lib.name, localPath: local } : lib);
      }
    }
    if (Array.isArray(p['+jvmArgs'])) {
      for (const a of p['+jvmArgs']) {
        if (typeof a === 'string') v._extraJvm.push(a);
        else if (a && a.value && rulesAllow(a.rules)) [].concat(a.value).forEach(x => v._extraJvm.push(String(x)));
      }
      if (p['+jvmArgs'].some(a => typeof a === 'string' && a.startsWith('--add-opens'))) needsModernJava = true;
    }
    if (Array.isArray(p['+tweakers'])) v._tweakers.push(...p['+tweakers'].map(String));
    if (typeof p.mainClass === 'string' && p.mainClass) v.mainClass = p.mainClass;
    if (/lwjgl3ify/i.test(p._file)) needsModernJava = true;
  }
  // lwjgl3ify и --add-opens работают только на Java 17+: берём Java 21 от Mojang
  if (needsModernJava) v.javaVersion = { component: 'java-runtime-delta', majorVersion: 21 };
  return v;
}

module.exports = { read, apply };
