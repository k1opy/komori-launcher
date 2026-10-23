'use strict';
// CurseForge (Core API): поиск, установка с зависимостями, обновления, данные для сборок.
// Нужен ключ API (console.curseforge.com) в komori.config.json -> curseforgeApiKey.
const fs = require('fs');
const path = require('path');
const { downloadAll } = require('./net');
const mr = require('./modrinth');

const API = 'https://api.curseforge.com/v1';
const GAME_ID = 432; // Minecraft
const CLASS = { mod: 6, resourcepack: 12, shader: 6552, modpack: 4471 };
const CLASS_TO_TYPE = { 6: 'mod', 12: 'resourcepack', 6552: 'shader' };
const LOADER_TYPE = { forge: 1, fabric: 4, quilt: 4, neoforge: 6 }; // Quilt запускает Fabric-моды
const SORT = { relevance: 1, downloads: 6, follows: 2, newest: 11, updated: 3 };
const CDN = /^https:\/\/(edge|mediafilez)\.forgecdn\.net\//;

let apiKey = '';
function setKey(k) { apiKey = String(k || '').trim(); }
function hasKey() { return !!apiKey; }

async function api(pathAndQuery, opts = {}) {
  if (!apiKey) throw new Error('Каталог CurseForge не настроен: нужен curseforgeApiKey в komori.config.json');
  const res = await fetch(API + pathAndQuery, Object.assign({}, opts, {
    headers: Object.assign({ 'x-api-key': apiKey, Accept: 'application/json', 'User-Agent': mr.MR_UA }, opts.headers || {})
  }));
  if (res.status === 403) throw new Error('CurseForge отклонил ключ API');
  if (!res.ok) throw new Error(`CurseForge ответил ${res.status}`);
  return res.json();
}
const post = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function mapMod(m) {
  return {
    id: String(m.id), slug: m.slug, title: m.name, description: m.summary || '',
    icon: (m.logo && (m.logo.thumbnailUrl || m.logo.url)) || '', author: (m.authors && m.authors[0] && m.authors[0].name) || '',
    downloads: m.downloadCount || 0, type: CLASS_TO_TYPE[m.classId] || (m.classId === CLASS.modpack ? 'modpack' : 'mod'),
    website: (m.links && m.links.websiteUrl) || ''
  };
}

async function search({ query, type, sort, offset }, ctx) {
  const p = new URLSearchParams({
    gameId: String(GAME_ID), classId: String(CLASS[type] || CLASS.mod), searchFilter: query || '',
    sortField: String(SORT[sort] || SORT.relevance), sortOrder: 'desc',
    index: String(Math.max(0, Math.min(9950, offset | 0))), pageSize: '20'
  });
  if (type === 'mod' || type === 'resourcepack') p.set('gameVersion', ctx.mc);
  if (type === 'mod' && LOADER_TYPE[ctx.loader]) p.set('modLoaderType', String(LOADER_TYPE[ctx.loader]));
  const r = await api('/mods/search?' + p);
  return { total: Math.min(r.pagination ? r.pagination.totalCount : 0, 10000), hits: r.data.map(mapMod) };
}

function sha1Of(file) { const h = (file.hashes || []).find(x => x.algo === 1); return h ? h.value : undefined; }

// Лучший файл проекта под версию и ядро: сначала релизы, потом самые свежие.
async function bestFile(modId, type, ctx) {
  const p = new URLSearchParams({ pageSize: '50' });
  if (type !== 'shader') p.set('gameVersion', ctx.mc);
  if (type === 'mod' && LOADER_TYPE[ctx.loader]) p.set('modLoaderType', String(LOADER_TYPE[ctx.loader]));
  const r = await api(`/mods/${encodeURIComponent(modId)}/files?${p}`);
  const files = (r.data || []).sort((a, b) => (a.releaseType - b.releaseType) || (new Date(b.fileDate) - new Date(a.fileDate)));
  return files[0] || null;
}

async function getMod(modId) { return (await api(`/mods/${encodeURIComponent(modId)}`)).data; }

// Установка в профиль. Возвращает { installed: [названия], manual: [{ title, url }] }.
async function install(dir, modId, type, ctx, onStep) {
  const meta = mr.readMeta(dir);
  const installed = [];
  const manual = [];
  const seen = new Set();

  async function one(id, depth) {
    id = String(id);
    if (seen.has(id) || depth > 6) return;
    seen.add(id);
    if (Object.values(meta.items).some(x => String(x.projectId) === id && x.source === 'curseforge')) return;
    const [mod, file] = await Promise.all([getMod(id), bestFile(id, type, ctx)]);
    if (!file) {
      if (depth === 0) throw new Error(`Нет файла для ${ctx.loader === 'vanilla' ? 'Minecraft' : ctx.loader} ${ctx.mc}`);
      return;
    }
    const title = mod.name;
    onStep && onStep(title);
    if (!file.downloadUrl || !CDN.test(file.downloadUrl)) {
      manual.push({ title, url: (mod.links && mod.links.websiteUrl) || '' });
    } else {
      const name = mr.safeName(file.fileName);
      const folder = mr.FOLDERS[CLASS_TO_TYPE[mod.classId] || type];
      await downloadAll([{ url: file.downloadUrl, dest: path.join(dir, folder, name), sha1: sha1Of(file), size: file.fileLength, verify: true }]);
      const itemType = CLASS_TO_TYPE[mod.classId] || type;
      meta.items[`${itemType}/${name}`] = {
        source: 'curseforge', projectId: id, versionId: String(file.id), versionNumber: file.displayName || name,
        file: name, type: itemType, sha1: sha1Of(file), title, icon: (mod.logo && mod.logo.thumbnailUrl) || '', slug: mod.slug
      };
      mr.writeMeta(dir, meta);
      installed.push(title);
    }
    if (type === 'mod') for (const dep of file.dependencies || []) if (dep.relationType === 3) await one(dep.modId, depth + 1);
  }

  await one(modId, 0);
  return { installed, manual };
}

// Обновления для модов, поставленных с CurseForge.
async function checkUpdates(dir, ctx) {
  const items = mr.list(dir).filter(x => x.source === 'curseforge' && x.enabled);
  const meta = mr.readMeta(dir);
  const out = [];
  for (const it of items) {
    const rec = meta.items[it.key];
    if (!rec) continue;
    try {
      const f = await bestFile(rec.projectId, rec.type, ctx);
      if (f && String(f.id) !== String(rec.versionId)) {
        out.push({ key: it.key, title: it.title, from: it.version, to: f.displayName || f.fileName, versionId: String(f.id), source: 'curseforge' });
      }
    } catch {}
  }
  return out;
}

async function update(dir, key, fileId) {
  const meta = mr.readMeta(dir);
  const rec = meta.items[key];
  if (!rec) throw new Error('Мод не найден');
  const file = (await api(`/mods/${encodeURIComponent(rec.projectId)}/files/${encodeURIComponent(fileId)}`)).data;
  if (!file.downloadUrl || !CDN.test(file.downloadUrl)) throw new Error('Автор запретил скачивание этого файла в лаунчерах — обнови его вручную на сайте CurseForge');
  const name = mr.safeName(file.fileName);
  const folder = mr.FOLDERS[rec.type];
  await downloadAll([{ url: file.downloadUrl, dest: path.join(dir, folder, name), sha1: sha1Of(file), size: file.fileLength, verify: true }]);
  if (name !== rec.file) for (const p of [path.join(dir, folder, rec.file), path.join(dir, folder, rec.file + '.disabled')]) if (fs.existsSync(p)) fs.unlinkSync(p);
  delete meta.items[key];
  meta.items[`${rec.type}/${name}`] = Object.assign({}, rec, { versionId: String(file.id), versionNumber: file.displayName || name, file: name, sha1: sha1Of(file) });
  mr.writeMeta(dir, meta);
  return mr.list(dir);
}

// ---------- для сборок ----------
async function modpackFile(modId, fileId) {
  let file;
  if (fileId) file = (await api(`/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}`)).data;
  else {
    const mod = await getMod(modId);
    const latest = (mod.latestFiles || []).sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate));
    file = latest.find(f => f.releaseType === 1) || latest[0];
  }
  if (!file) throw new Error('У сборки нет файлов');
  if (!file.downloadUrl || !CDN.test(file.downloadUrl)) throw new Error('Автор запретил скачивание сборки в сторонних лаунчерах. Скачай zip на сайте CurseForge и нажми «Импорт из файла».');
  return { url: file.downloadUrl, filename: mr.safeName(file.fileName), sha1: sha1Of(file), size: file.fileLength, versionNumber: file.displayName };
}

// Файлы сборки по id: [{ fileId, modId, name, url|null, sha1, size, type, website }]
async function resolvePackFiles(entries) {
  const out = [];
  for (let i = 0; i < entries.length; i += 400) {
    const chunk = entries.slice(i, i + 400);
    const files = (await post('/mods/files', { fileIds: chunk.map(e => e.fileID) })).data || [];
    const mods = (await post('/mods', { modIds: [...new Set(chunk.map(e => e.projectID))] })).data || [];
    const modMap = new Map(mods.map(m => [m.id, m]));
    for (const f of files) {
      const m = modMap.get(f.modId) || {};
      out.push({
        fileId: f.id, modId: f.modId, name: f.fileName, title: m.name || f.fileName,
        url: f.downloadUrl && CDN.test(f.downloadUrl) ? f.downloadUrl : null,
        sha1: sha1Of(f), size: f.fileLength, type: CLASS_TO_TYPE[m.classId] || 'mod', website: (m.links && m.links.websiteUrl) || ''
      });
    }
  }
  return out;
}

// Файл конкретной версии (для сборки сервера). null, если автор запретил скачивание в лаунчерах.
async function fileInfo(modId, fileId) {
  const f = (await api(`/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}`)).data;
  if (!f.downloadUrl || !CDN.test(f.downloadUrl)) return null;
  return { url: f.downloadUrl, sha1: sha1Of(f), size: f.fileLength, filename: mr.safeName(f.fileName) };
}

module.exports = { setKey, hasKey, search, install, checkUpdates, update, modpackFile, resolvePackFiles, getMod, mapMod, fileInfo };
