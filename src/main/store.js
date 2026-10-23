'use strict';
// Хранение настроек, профилей и аккаунтов лаунчера (JSON в папке пользователя).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

const DATA_DIR = () => app.getPath('userData');
const DEFAULT_GAME_DIR = () => path.join(app.getPath('appData'), '.komori');

function file(name) { return path.join(DATA_DIR(), name); }

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}

function writeJson(name, data) {
  fs.mkdirSync(DATA_DIR(), { recursive: true });
  const target = file(name);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}

// ---------- настройки ----------
// theme (п.3): 'system' | 'dark' | 'light'; skinServerUrl (п.2): свой адрес сервера скинов, пусто = из komori.config.json
const DEFAULT_SETTINGS = { ram: 4, minimizeOnLaunch: true, showConsole: false, gameDir: '', theme: 'system', skinServerUrl: '' };
const THEMES = ['system', 'dark', 'light'];

function getSettings() {
  const s = Object.assign({}, DEFAULT_SETTINGS, readJson('settings.json', {}));
  if (!s.gameDir) s.gameDir = DEFAULT_GAME_DIR();
  return s;
}
function setSettings(patch) {
  const s = Object.assign(getSettings(), patch || {});
  s.ram = Math.max(1, Math.min(32, Math.round(Number(s.ram) || 4)));
  if (!THEMES.includes(s.theme)) s.theme = 'system';
  s.skinServerUrl = String(s.skinServerUrl || '').trim().replace(/\/+$/, '').slice(0, 200);
  writeJson('settings.json', s);
  return s;
}

// ---------- профили ----------
const ICONS = ['pickaxe', 'sword', 'fish', 'bat', 'orb', 'grass', 'diamond', 'heart', 'star', 'crown', 'chest', 'potion', 'book',
  'axe', 'bow', 'skull', 'mushroom', 'tree', 'flame', 'snow', 'moon', 'amethyst', 'shield', 'compass', 'rod', 'portal'];
const LOADERS = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'];

function newId() { return crypto.randomBytes(6).toString('hex'); }

function getProfiles() {
  const data = readJson('profiles.json', null);
  if (data && Array.isArray(data.list)) return data;
  const def = { list: [{ id: newId(), name: 'Последний релиз', icon: 'grass', loader: 'vanilla', loaderVersion: '', mcVersion: 'latest-release', created: Date.now(), lastPlayed: 0 }], selected: null };
  def.selected = def.list[0].id;
  writeJson('profiles.json', def);
  return def;
}

function cleanProfile(p) {
  const name = String(p.name || '').trim().slice(0, 32) || 'Новый профиль';
  const icon = ICONS.includes(p.icon) ? p.icon : 'grass';
  const loader = LOADERS.includes(p.loader) ? p.loader : 'vanilla';
  const mcVersion = String(p.mcVersion || '').replace(/[^A-Za-z0-9._\- ]/g, '').slice(0, 64) || 'latest-release';
  const loaderVersion = String(p.loaderVersion || '').replace(/[^A-Za-z0-9._+\-]/g, '').slice(0, 64);
  const ram = p.ram ? Math.max(1, Math.min(32, Math.round(Number(p.ram)))) : 0;
  return { name, icon, loader, mcVersion, loaderVersion, ram };
}

function saveProfile(p) {
  const data = getProfiles();
  const clean = cleanProfile(p);
  let existing = p.id && data.list.find(x => x.id === p.id);
  if (existing) Object.assign(existing, clean);
  else {
    existing = Object.assign({ id: newId(), created: Date.now(), lastPlayed: 0 }, clean);
    data.list.unshift(existing);
  }
  data.selected = existing.id;
  writeJson('profiles.json', data);
  return data;
}

// Профиль сервера Komori: создаётся и обновляется лаунчером по сборке сервера, id фиксирован.
function upsertManagedProfile(id, p) {
  const data = getProfiles();
  const clean = Object.assign(cleanProfile(p), { managed: true });
  let existing = data.list.find(x => x.id === id);
  if (existing) Object.assign(existing, clean);
  else { existing = Object.assign({ id, created: Date.now(), lastPlayed: 0 }, clean); data.list.unshift(existing); }
  writeJson('profiles.json', data);
  return existing;
}

function deleteProfile(id) {
  const data = getProfiles();
  data.list = data.list.filter(x => x.id !== id);
  if (!data.list.length) return getProfilesReset();
  if (data.selected === id) data.selected = data.list[0].id;
  writeJson('profiles.json', data);
  return data;
}
function getProfilesReset() { try { fs.unlinkSync(file('profiles.json')); } catch {} return getProfiles(); }

function selectProfile(id) {
  const data = getProfiles();
  if (data.list.some(x => x.id === id)) { data.selected = id; writeJson('profiles.json', data); }
  return data;
}
function touchProfile(id) {
  const data = getProfiles();
  const p = data.list.find(x => x.id === id);
  if (p) { p.lastPlayed = Date.now(); writeJson('profiles.json', data); }
}

// ---------- аккаунты (токены шифруются средствами Windows через safeStorage) ----------
function enc(str) {
  if (!str) return '';
  if (safeStorage.isEncryptionAvailable()) return 'e:' + safeStorage.encryptString(str).toString('base64');
  return 'p:' + Buffer.from(str, 'utf8').toString('base64');
}
function dec(str) {
  if (!str) return '';
  try {
    if (str.startsWith('e:')) return safeStorage.decryptString(Buffer.from(str.slice(2), 'base64'));
    if (str.startsWith('p:')) return Buffer.from(str.slice(2), 'base64').toString('utf8');
  } catch {}
  return '';
}

function rawAccounts() { return readJson('accounts.json', { list: [], selected: null }); }

// Публичный вид: без токенов.
function getAccounts() {
  const data = rawAccounts();
  return {
    selected: data.selected,
    // server — только для Yggdrasil-аккаунтов (адрес сервера авторизации), токены наружу не отдаём
    list: data.list.map(a => ({ id: a.id, type: a.type, name: a.name, uuid: a.uuid, server: a.type === 'yggdrasil' ? a.serverUrl : undefined }))
  };
}

function getAccountSecret(id) {
  const a = rawAccounts().list.find(x => x.id === id);
  if (!a) return null;
  return Object.assign({}, a, { refreshToken: dec(a.refreshToken), mcToken: dec(a.mcToken) });
}

function upsertAccount(acc) {
  const data = rawAccounts();
  const stored = Object.assign({}, acc, { refreshToken: enc(acc.refreshToken || ''), mcToken: enc(acc.mcToken || '') });
  const i = data.list.findIndex(x => x.id === acc.id);
  if (i >= 0) data.list[i] = stored; else data.list.push(stored);
  data.selected = acc.id;
  writeJson('accounts.json', data);
  return getAccounts();
}

function removeAccount(id) {
  const data = rawAccounts();
  data.list = data.list.filter(x => x.id !== id);
  if (data.selected === id) data.selected = data.list.length ? data.list[0].id : null;
  writeJson('accounts.json', data);
  return getAccounts();
}

function selectAccount(id) {
  const data = rawAccounts();
  if (data.list.some(x => x.id === id)) { data.selected = id; writeJson('accounts.json', data); }
  return getAccounts();
}

module.exports = {
  getSettings, setSettings,
  getProfiles, saveProfile, deleteProfile, selectProfile, touchProfile, upsertManagedProfile, ICONS, LOADERS,
  getAccounts, getAccountSecret, upsertAccount, removeAccount, selectAccount, enc, dec, DATA_DIR
};
