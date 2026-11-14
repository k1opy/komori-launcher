'use strict';
// CurseForge (Core API): поиск, установка с зависимостями, обновления, данные для сборок.
// Ключ API хранится на сайте komori.fun: лаунчер ходит через посредника (curseforgeProxy), сам ключ игрокам не попадает.
// Для разработки можно вписать свой ключ в komori.config.json -> curseforgeApiKey — тогда запросы идут напрямую.
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
let proxy = '';
function setKey(k) { apiKey = String(k || '').trim(); }
function setProxy(u) { proxy = /^https:\/\/[^\s]+$/.test(String(u || '')) ? String(u).replace(/\/+$/, '') : ''; }
function hasKey() { return !!(apiKey || proxy); }

async function api(pathAndQuery, opts = {}) {
  if (!apiKey && !proxy) throw new Error('Каталог CurseForge не настроен');
  const headers = Object.assign({ Accept: 'application/json', 'User-Agent': mr.MR_UA }, apiKey ? { 'x-api-key': apiKey } : {}, opts.headers || {});
  const res = await fetch((apiKey ? API : proxy) + pathAndQuery, Object.assign({}, opts, { headers }));
  if (res.status === 403) throw new Error(apiKey ? 'CurseForge отклонил ключ API' : 'CurseForge сейчас недоступен через komori.fun');
  if (res.status === 503) throw new Error('Каталог CurseForge на сайте ещё не настроен');
  if (res.status === 429) throw new Error('Слишком много запросов к CurseForge, подожди пару минут');
  if (!res.ok) throw new Error(`CurseForge ответил ${res.status}`);
  return res.json();
}

// Отпечаток файла CurseForge (MurmurHash2, seed 1, без пробельных байтов) — чтобы узнать мод по файлу
function fingerprint(buf) {
  const b = buf.filter(x => x !== 9 && x !== 10 && x !== 13 && x !== 32);
  const m = 0x5bd1e995, len = b.length;
  let h = (1 ^ len) >>> 0, i = 0;
  while (len - i >= 4) {
    let k = (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
    k = Math.imul(k, m) >>> 0; k = (k ^ (k >>> 24)) >>> 0; k = Math.imul(k, m) >>> 0;
    h = (Math.imul(h, m) ^ k) >>> 0; i += 4;
  }
  switch (len - i) {
    case 3: h = (h ^ (b[i + 2] << 16)) >>> 0; // fallthrough
    case 2: h = (h ^ (b[i + 1] << 8)) >>> 0; // fallthrough
    case 1: h = (h ^ b[i]) >>> 0; h = Math.imul(h, m) >>> 0;
  }
  h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, m) >>> 0; h = (h ^ (h >>> 15)) >>> 0;
  return h;
}
// { отпечаток: modId } для найденных на CurseForge
async function identify(prints) {
  if (!prints.length || !hasKey()) return {};
  const r = await post('/fingerprints/432', { fingerprints: prints });
  const out = {};
  for (const x of (r.data && r.data.exactMatches) || []) if (x.file) out[x.file.fileFingerprint] = String(x.id);
  return out;
}
const post = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const CF_LOADER_NAME = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' };
const PACK_LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };   // для сборок Quilt — отдельное ядро
function mapMod(m) {
  const files = m.latestFilesIndexes || [];
  const key = v => String(v).split('.').map(n => n.padStart(4, '0')).join('.');
  const mcs = [...new Set(files.map(f => f.gameVersion).filter(v => /^\d+\.\d+(\.\d+)?$/.test(v || '')))].sort((a, b) => key(b).localeCompare(key(a)));
  return {
    id: String(m.id), slug: m.slug, title: m.name, description: m.summary || '',
    icon: (m.logo && (m.logo.thumbnailUrl || m.logo.url)) || '', author: (m.authors && m.authors[0] && m.authors[0].name) || '',
    downloads: m.downloadCount || 0, type: CLASS_TO_TYPE[m.classId] || (m.classId === CLASS.modpack ? 'modpack' : 'mod'),
    website: (m.links && m.links.websiteUrl) || '',
    // Теги: у модов — наши ключи (как в фильтре), у остального — названия категорий CurseForge
    tags: (m.categories || []).map(c => (m.classId === CLASS.mod ? CF_KEY_BY_ID[c.id] || CF_KEY_BY_NAME[norm(c.name)] : c.name)).filter(Boolean),
    loaders: [...new Set(files.map(f => CF_LOADER_NAME[f.modLoader]).filter(Boolean))],
    mcv: mcs[0] || '', image: (m.screenshots && m.screenshots[0] && (m.screenshots[0].thumbnailUrl || m.screenshots[0].url)) || '',
    updated: m.dateModified || ''
  };
}

// Категории модов CurseForge: id берём у CurseForge по названию, если не вышло — из запасного списка
const CF_CATS = { optimization: ['Performance', 6814], technology: ['Technology', 412], magic: ['Magic', 419], adventure: ['Adventure and RPG', 422],
  worldgen: ['World Gen', 406], equipment: ['Armor, Tools, and Weapons', 434], mobs: ['Mobs', 411], food: ['Food', 436], storage: ['Storage', 420],
  decoration: ['Cosmetic', 424], utility: ['Utility & QoL', 5191], transportation: ['Player Transport', 414], management: ['Server Utility', 435], library: ['API and Library', 421] };
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const CF_KEY_BY_ID = {}, CF_KEY_BY_NAME = {};
for (const [k, [name, id]] of Object.entries(CF_CATS)) { CF_KEY_BY_ID[id] = k; CF_KEY_BY_NAME[norm(name)] = k; }
const cfCats = {};
// Моды — наш ключ из CF_CATS; ресурспаки и шейдеры — название категории CurseForge
async function categoryId(type, key) {
  const c = type === 'mod' ? CF_CATS[key] : [key, null];
  if (!c) return null;
  // Список категорий запрашиваем один раз (несколько тегов ждут один и тот же запрос)
  if (!cfCats[type]) cfCats[type] = api('/categories?gameId=' + GAME_ID + '&classId=' + CLASS[type]).then(r => r.data || []).catch(() => { cfCats[type] = null; return []; });
  const f = (await cfCats[type]).find(x => norm(x.name) === norm(c[0]));
  return f ? f.id : c[1];
}

async function search({ query, type, sort, offset, categories, mc, loader }, ctx) {
  const p = new URLSearchParams({
    gameId: String(GAME_ID), classId: String(CLASS[type] || CLASS.mod), searchFilter: query || '',
    sortField: String(SORT[sort] || SORT.relevance), sortOrder: 'desc',
    index: String(Math.max(0, Math.min(9950, offset | 0))), pageSize: '20'
  });
  if (type === 'mod' || type === 'resourcepack') p.set('gameVersion', ctx.mc);
  if (type === 'mod' && LOADER_TYPE[ctx.loader]) p.set('modLoaderType', String(LOADER_TYPE[ctx.loader]));
  if (type === 'modpack') {
    if (mc) p.set('gameVersion', mc);
    if (PACK_LOADER[loader]) p.set('modLoaderType', String(PACK_LOADER[loader]));
  }
  if ((categories || []).length && CLASS[type]) {
    const ids = (await Promise.all(categories.map(c => categoryId(type, c)))).filter(Boolean);
    if (ids.length === 1) p.set('categoryId', String(ids[0]));
    else if (ids.length > 1) p.set('categoryIds', JSON.stringify(ids.slice(0, 10)));   // сборка должна подходить под все теги
  }
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
    if (depth > 0 && ctx.skip && ctx.skip.has('cf' + id)) return;   // уже есть в сборке сервера
    const [mod, file] = await Promise.all([getMod(id), bestFile(id, type, ctx)]);
    if (!file) {
      if (depth === 0) throw new Error(`Нет файла для ${ctx.loader === 'vanilla' ? 'Minecraft' : ctx.loader} ${ctx.mc}`);
      return;
    }
    const title = mod.name;
    onStep && onStep(title);
    if (!file.downloadUrl || !CDN.test(file.downloadUrl)) {
      const site = (mod.links && mod.links.websiteUrl) || '';
      manual.push({ title, url: site ? site.replace(/\/$/, '') + '/files/' + file.id : '', file: file.fileName, sha1: sha1Of(file), size: file.fileLength,
        type: CLASS_TO_TYPE[mod.classId] || type, modId: String(id), fileId: String(file.id) });
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
// pref = { mc, loader } — версия и ядро, выбранные в фильтре каталога
async function modpackFile(modId, fileId, pref) {
  let file;
  if (fileId) file = (await api(`/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}`)).data;
  else {
    if (pref && (pref.mc || pref.loader)) {
      const p = new URLSearchParams({ pageSize: '50' });
      if (pref.mc) p.set('gameVersion', pref.mc);
      if (PACK_LOADER[pref.loader]) p.set('modLoaderType', String(PACK_LOADER[pref.loader]));
      const r = await api(`/mods/${encodeURIComponent(modId)}/files?${p}`).catch(() => ({ data: [] }));
      const fs2 = (r.data || []).sort((a, b) => (a.releaseType - b.releaseType) || (new Date(b.fileDate) - new Date(a.fileDate)));
      file = fs2[0];
    }
    if (!file) {
      const mod = await getMod(modId);
      const latest = (mod.latestFiles || []).sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate));
      file = latest.find(f => f.releaseType === 1) || latest[0];
    }
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
        page: (m.links && m.links.websiteUrl) ? m.links.websiteUrl.replace(/\/$/, '') + '/files/' + f.id : '',
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

module.exports = { setKey, setProxy, fingerprint, identify, hasKey, search, install, checkUpdates, update, modpackFile, resolvePackFiles, getMod, mapMod, fileInfo };
