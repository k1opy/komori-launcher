'use strict';
// Файлы, которые автор разрешил скачивать только с сайта (CurseForge): игрок скачивает их сам,
// лаунчер находит их в «Загрузках» (или в выбранной папке) по имени или SHA-1 и кладёт в сборку.
// Список ожидаемых файлов хранится в профиле: komori-manual.json
const fs = require('fs');
const path = require('path');
const { sha1File } = require('./net');
const mr = require('./modrinth');

function listPath(dir) { return path.join(dir, 'komori-manual.json'); }
function read(dir) { try { return JSON.parse(fs.readFileSync(listPath(dir), 'utf8')).items || []; } catch { return []; } }
function write(dir, items) {
  const p = listPath(dir);
  if (!items.length) { try { fs.unlinkSync(p); } catch {} return; }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ items }, null, 2));
}

// items: [{ title, url, file, sha1, size, type, modId, fileId }]
function add(dir, items) {
  const cur = read(dir);
  for (const it of items) if (it.file && !cur.some(x => x.file === it.file)) cur.push(it);
  write(dir, cur);
  return pending(dir);
}

// Что ещё не лежит в сборке
function pending(dir) {
  const items = read(dir);
  const left = items.filter(it => {
    const folder = mr.FOLDERS[it.type] || 'mods';
    const p = path.join(dir, folder, it.file);
    return !fs.existsSync(p) && !fs.existsSync(p + '.disabled');
  });
  if (left.length !== items.length) write(dir, left);
  return left;
}

// Ищем скачанные файлы в папках и копируем в сборку. Возвращает { found: [названия], pending: [...] }
async function scan(dir, folders) {
  const want = pending(dir);
  if (!want.length) return { found: [], pending: [] };
  const found = [];
  const bySize = new Map();
  for (const it of want) if (it.size) { const l = bySize.get(it.size) || []; l.push(it); bySize.set(it.size, l); }
  for (const folder of folders) {
    let names;
    try { names = fs.readdirSync(folder); } catch { continue; }
    for (const name of names) {
      if (!/\.(jar|zip)$/i.test(name)) continue;
      const full = path.join(folder, name);
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (!st.isFile()) continue;
      // Сначала по имени (браузер может дописать « (1)»), потом по размеру + SHA-1
      const clean = name.replace(/ \(\d+\)(?=\.(jar|zip)$)/i, '').toLowerCase();
      let cands = want.filter(it => !found.includes(it) && it.file.toLowerCase() === clean);
      if (!cands.length) cands = (bySize.get(st.size) || []).filter(it => !found.includes(it));
      if (!cands.length) continue;
      let hash = null;
      for (const it of cands) {
        if (it.sha1) { hash = hash || await sha1File(full).catch(() => null); if (hash !== it.sha1) continue; }
        else if (it.size && it.size !== st.size) continue;
        const destDir = path.join(dir, mr.FOLDERS[it.type] || 'mods');
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(full, path.join(destDir, mr.safeName(it.file)));
        const meta = mr.readMeta(dir);
        meta.items[`${it.type || 'mod'}/${mr.safeName(it.file)}`] = { source: 'curseforge', projectId: String(it.modId || ''), versionId: String(it.fileId || ''),
          versionNumber: it.file, file: mr.safeName(it.file), type: it.type || 'mod', sha1: it.sha1, title: it.title };
        mr.writeMeta(dir, meta);
        found.push(it);
        break;
      }
    }
  }
  return { found: found.map(x => x.title), pending: pending(dir) };
}

module.exports = { add, pending, scan, read };
