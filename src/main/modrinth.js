'use strict';
// Modrinth: поиск, установка с зависимостями, список установленного, вкл/выкл, удаление, обновления.
const fs = require('fs');
const path = require('path');
const { downloadAll, sha1File } = require('./net');

const API = 'https://api.modrinth.com/v2';
const MR_UA = 'komori/KomoriLauncher/0.4.0 (mc.komori.fun)';
const FOLDERS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const EXT = { mod: /\.jar(\.disabled)?$/i, resourcepack: /\.zip(\.disabled)?$/i, shader: /\.zip(\.disabled)?$/i };

async function api(url, opts = {}) {
  const res = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ 'User-Agent': MR_UA }, opts.headers || {}) }));
  if (res.status === 429) throw new Error('Modrinth просит подождать: слишком много запросов');
  if (!res.ok) throw new Error(`Modrinth ответил ${res.status}`);
  return res.json();
}

// Какие загрузчики подходят профилю: Quilt запускает и Fabric-моды.
function loadersFor(loader) {
  if (loader === 'quilt') return ['quilt', 'fabric'];
  if (loader === 'vanilla' || !loader) return [];
  return [loader];
}

// ctx: { loader, mc }
async function search({ query, type, sort, offset }, ctx) {
  const facets = [[`project_type:${type}`]];
  if (type !== 'modpack') facets.push([`versions:${ctx.mc}`]);
  if (type === 'mod') facets.push(loadersFor(ctx.loader).map(l => `categories:${l}`));
  const params = new URLSearchParams({
    query: query || '', facets: JSON.stringify(facets),
    index: ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(sort) ? sort : 'relevance',
    offset: String(Math.max(0, offset | 0)), limit: '20'
  });
  const r = await api(`${API}/search?${params}`);
  return {
    total: r.total_hits,
    hits: r.hits.map(h => ({
      id: h.project_id, slug: h.slug, title: h.title, description: h.description,
      icon: h.icon_url || '', author: h.author, downloads: h.downloads, type: h.project_type
    }))
  };
}

async function bestVersion(projectId, type, ctx) {
  const params = new URLSearchParams({ game_versions: JSON.stringify([ctx.mc]) });
  if (type === 'mod') params.set('loaders', JSON.stringify(loadersFor(ctx.loader)));
  const list = await api(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`);
  if (!list.length) return null;
  return list.find(v => v.version_type === 'release') || list[0];
}

// ---------- учёт установленного ----------
function metaPath(dir) { return path.join(dir, 'komori-content.json'); }
function readMeta(dir) { try { return JSON.parse(fs.readFileSync(metaPath(dir), 'utf8')); } catch { return { items: {} }; } }
function writeMeta(dir, m) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(metaPath(dir), JSON.stringify(m, null, 2)); }
function safeName(name) {
  const base = path.basename(String(name || ''));
  if (!base || base.startsWith('.') || /[<>:"|?*\\/]/.test(base)) throw new Error('Недопустимое имя файла: ' + name);
  return base;
}
function primaryFile(version) { return version.files.find(f => f.primary) || version.files[0]; }

async function downloadVersionFile(dir, type, version) {
  const f = primaryFile(version);
  if (!f || !/^https:\/\/cdn\.modrinth\.com\//.test(f.url)) throw new Error('У этой версии нет файла для скачивания с Modrinth');
  const file = safeName(f.filename);
  const dest = path.join(dir, FOLDERS[type], file);
  await downloadAll([{ url: f.url, dest, sha1: f.hashes && f.hashes.sha1, size: f.size, verify: true }]);
  return { file, sha1: f.hashes && f.hashes.sha1 };
}

// Установка проекта с обязательными зависимостями. Возвращает список установленных названий.
async function install(dir, projectId, type, ctx, onStep) {
  const meta = readMeta(dir);
  const installed = [];
  const visiting = new Set();

  async function one(pid, versionId, depth) {
    if (visiting.has(pid) || depth > 6) return;
    visiting.add(pid);
    if (Object.values(meta.items).some(x => x.projectId === pid)) return;
    const version = versionId ? await api(`${API}/version/${encodeURIComponent(versionId)}`) : await bestVersion(pid, type, ctx);
    if (!version) {
      if (depth === 0) throw new Error(`Нет версии для ${ctx.loader === 'vanilla' ? 'Minecraft' : ctx.loader} ${ctx.mc}`);
      return;
    }
    const project = await api(`${API}/project/${encodeURIComponent(pid)}`).catch(() => ({ title: pid }));
    onStep && onStep(project.title);
    const { file, sha1 } = await downloadVersionFile(dir, type, version);
    meta.items[`${type}/${file}`] = {
      source: 'modrinth', projectId: pid, versionId: version.id, versionNumber: version.version_number, file, type, sha1,
      title: project.title || file, icon: project.icon_url || '', slug: project.slug || ''
    };
    writeMeta(dir, meta);
    installed.push(project.title || file);
    if (type === 'mod') {
      for (const dep of version.dependencies || []) {
        if (dep.dependency_type !== 'required' || !dep.project_id) continue;
        await one(dep.project_id, dep.version_id || null, depth + 1);
      }
    }
  }

  await one(projectId, null, 0);
  return installed;
}

// Всё, что лежит в папках профиля (в том числе положенное вручную).
function list(dir) {
  const meta = readMeta(dir);
  const out = [];
  for (const [type, folder] of Object.entries(FOLDERS)) {
    let names = [];
    try { names = fs.readdirSync(path.join(dir, folder)); } catch {}
    for (const name of names) {
      if (!EXT[type].test(name)) continue;
      const enabled = !name.endsWith('.disabled');
      const base = enabled ? name : name.slice(0, -'.disabled'.length);
      const m = meta.items[`${type}/${base}`] || {};
      out.push({
        key: `${type}/${base}`, type, file: name, enabled,
        title: m.title || base.replace(/\.(jar|zip)$/i, ''), icon: m.icon || '', version: m.versionNumber || '',
        projectId: m.projectId ? String(m.projectId) : '', slug: m.slug || '',
        source: m.projectId ? (m.source || 'modrinth') : 'manual', fromModrinth: !!m.projectId && m.source !== 'curseforge'
      });
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

function resolveItem(dir, key) {
  const [type, base] = String(key).split('/');
  if (!FOLDERS[type]) throw new Error('Неизвестный тип');
  const file = safeName(base);
  const folder = path.join(dir, FOLDERS[type]);
  return { type, base: file, on: path.join(folder, file), off: path.join(folder, file + '.disabled') };
}

function toggle(dir, key) {
  const it = resolveItem(dir, key);
  if (fs.existsSync(it.on)) fs.renameSync(it.on, it.off);
  else if (fs.existsSync(it.off)) fs.renameSync(it.off, it.on);
  return list(dir);
}

function remove(dir, key) {
  const it = resolveItem(dir, key);
  for (const p of [it.on, it.off]) if (fs.existsSync(p)) fs.unlinkSync(p);
  const meta = readMeta(dir);
  delete meta.items[key];
  writeMeta(dir, meta);
  return list(dir);
}

// Обновления модов: Modrinth сам находит по SHA-1 файла и подбирает новую версию под ядро и Minecraft.
async function checkUpdates(dir, ctx) {
  const items = list(dir).filter(x => x.type === 'mod' && x.enabled && x.source !== 'curseforge');
  const byHash = {};
  for (const it of items) byHash[await sha1File(path.join(dir, FOLDERS.mod, it.file))] = it;
  const hashes = Object.keys(byHash);
  if (!hashes.length) return [];
  const res = await api(`${API}/version_files/update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes, algorithm: 'sha1', loaders: loadersFor(ctx.loader), game_versions: [ctx.mc] })
  });
  const updates = [];
  for (const [hash, version] of Object.entries(res)) {
    const f = primaryFile(version);
    if (f && f.hashes && f.hashes.sha1 !== hash) {
      const it = byHash[hash];
      updates.push({ key: it.key, title: it.title, from: it.version, to: version.version_number, versionId: version.id, projectId: version.project_id });
    }
  }
  return updates;
}

async function update(dir, key, versionId) {
  const it = resolveItem(dir, key);
  const version = await api(`${API}/version/${encodeURIComponent(versionId)}`);
  const { file, sha1 } = await downloadVersionFile(dir, it.type, version);
  const meta = readMeta(dir);
  const old = meta.items[key] || {};
  if (file !== it.base) for (const p of [it.on, it.off]) if (fs.existsSync(p)) fs.unlinkSync(p);
  delete meta.items[key];
  meta.items[`${it.type}/${file}`] = Object.assign({}, old, { projectId: version.project_id, versionId: version.id, versionNumber: version.version_number, file, sha1, type: it.type });
  writeMeta(dir, meta);
  return list(dir);
}

// Сборка: файл .mrpack последней (или указанной) версии проекта.
async function modpackFile(projectId, versionId) {
  const version = versionId
    ? await api(`${API}/version/${encodeURIComponent(versionId)}`)
    : (await api(`${API}/project/${encodeURIComponent(projectId)}/version`))[0];
  if (!version) throw new Error('У сборки нет версий');
  const f = (version.files || []).find(x => /\.mrpack$/i.test(x.filename)) || primaryFile(version);
  if (!f || !/^https:\/\/cdn\.modrinth\.com\//.test(f.url)) throw new Error('У сборки нет файла .mrpack');
  return { url: f.url, filename: safeName(f.filename), sha1: f.hashes && f.hashes.sha1, size: f.size, versionNumber: version.version_number };
}

// Файл конкретной версии (для сборки сервера).
async function versionFile(versionId) {
  const v = await api(`${API}/version/${encodeURIComponent(versionId)}`);
  const f = primaryFile(v);
  if (!f || !/^https:\/\/cdn\.modrinth\.com\//.test(f.url)) return null;
  return { url: f.url, sha1: f.hashes && f.hashes.sha1, size: f.size, filename: safeName(f.filename) };
}

async function projectInfo(projectId) {
  const p = await api(`${API}/project/${encodeURIComponent(projectId)}`);
  return { title: p.title, icon: p.icon_url || '', slug: p.slug };
}

module.exports = { search, install, list, toggle, remove, checkUpdates, update, loadersFor, FOLDERS, readMeta, writeMeta, safeName, modpackFile, projectInfo, versionFile, MR_UA };
