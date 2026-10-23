'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');

const store = require('./store');
const versions = require('./versions');
const { ensureJava, componentFor } = require('./java');
const { buildArgs, launch } = require('./launch');
const auth = require('./auth');
const { downloadAll } = require('./net');
const loaders = require('./loaders');
const modrinth = require('./modrinth');
const curseforge = require('./curseforge');
const modpacks = require('./modpacks');
const serverpack = require('./serverpack');
const pkg = require('../../package.json');

// DEV-режим: в разработке — флаг --dev, в собранном виде — только сборка `npm run dist:dev`.
const DEV = app.isPackaged ? !!pkg.komoriDev : process.argv.includes('--dev');

function loadConfig() {
  const def = { msClientId: '', server: { name: 'Komori', host: 'mc.komori.fun', port: 25565 } };
  const candidates = [path.join(app.getPath('userData'), 'komori.config.json'), path.join(__dirname, '..', '..', 'komori.config.json')];
  for (const c of candidates) {
    try { return Object.assign(def, JSON.parse(fs.readFileSync(c, 'utf8'))); } catch {}
  }
  return def;
}
const CONFIG = loadConfig();
const updater = require('./updater');
const crash = require('./crash');
let lastCrash = null;
CONFIG.serverManifestUrl = /^https:\/\//.test(String(CONFIG.serverManifestUrl || '')) ? CONFIG.serverManifestUrl : '';
CONFIG.trustedHosts = Array.isArray(CONFIG.trustedHosts) ? CONFIG.trustedHosts.filter(h => /^[A-Za-z0-9.\-]+$/.test(String(h))) : [];
curseforge.setKey(CONFIG.curseforgeApiKey);

// ===== Ссылки: Discord (п.4), сайт (п.5), соцсети (п.6) =====
// Берутся только из komori.config.json, только https. В интерфейс уходят id/название/иконка,
// а открывает ссылку main-процесс по id — страница не может подсунуть свой адрес.
const LINK_ICONS = ['telegram', 'youtube', 'vk', 'x', 'discord', 'globe', 'link', 'twitch', 'tiktok', 'instagram'];
function httpsUrl(u) { try { const x = new URL(String(u || '')); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } }
const LINKS = {};
if (httpsUrl(CONFIG.discordUrl)) LINKS.discord = { name: 'Discord', icon: 'discord', url: httpsUrl(CONFIG.discordUrl) };
if (httpsUrl(CONFIG.websiteUrl)) LINKS.website = { name: 'Сайт', icon: 'globe', url: httpsUrl(CONFIG.websiteUrl) };
(Array.isArray(CONFIG.socialLinks) ? CONFIG.socialLinks : []).slice(0, 12).forEach((l, i) => {
  const url = httpsUrl(l && l.url);
  if (!url) return;
  const icon = LINK_ICONS.includes(String(l.icon || '').toLowerCase()) ? String(l.icon).toLowerCase() : 'link';
  LINKS['social' + i] = { name: String(l.name || 'Ссылка').slice(0, 24), icon, url };
});
function publicLinks() {
  const pick = (id) => LINKS[id] ? { id, name: LINKS[id].name, icon: LINKS[id].icon } : null;
  return { discord: pick('discord'), website: pick('website'), social: Object.keys(LINKS).filter(k => k.startsWith('social')).map(pick) };
}

let win = null;
let game = null; // запущенный процесс игры
let msLogin = null; // { cancelled }

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 760, minWidth: 1040, minHeight: 640,
    frame: false, backgroundColor: '#0E0A1A', show: false,
    title: DEV ? 'Komori Launcher DEV' : 'Komori Launcher',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('maximize', () => send('win:state', { maximized: true }));
  win.on('unmaximize', () => send('win:state', { maximized: false }));
}

app.whenReady().then(() => {
  createWindow();
  updater.init({
    enabled: app.isPackaged && !DEV,
    onState: s => send('update:state', s),
    isGameRunning: () => !!game
  });
});
app.on('window-all-closed', () => app.quit());

// ---------- окно ----------
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:maximize', () => { if (!win) return; win.isMaximized() ? win.unmaximize() : win.maximize(); });
ipcMain.on('win:close', () => win && win.close());

ipcMain.handle('app:info', () => ({ dev: DEV, version: app.getVersion(), server: CONFIG.server, hasMsClient: !!CONFIG.msClientId, hasCurseforge: curseforge.hasKey(), serverManifest: !!CONFIG.serverManifestUrl, serverProfileId: serverpack.SERVER_PROFILE_ID, canReport: crash.validWebhook(CONFIG.crashWebhookUrl), packaged: app.isPackaged, links: publicLinks() }));

// ---------- настройки и профили ----------
ipcMain.handle('link:open', (e, id) => { const l = LINKS[String(id)]; if (l) shell.openExternal(l.url); return !!l; });
ipcMain.handle('settings:get', () => store.getSettings());
ipcMain.handle('settings:set', (e, patch) => store.setSettings(patch));
ipcMain.handle('settings:openGameDir', () => { const d = store.getSettings().gameDir; fs.mkdirSync(d, { recursive: true }); return shell.openPath(d); });

ipcMain.handle('profiles:get', () => store.getProfiles());
ipcMain.handle('profiles:save', (e, p) => store.saveProfile(p || {}));
ipcMain.handle('profiles:delete', (e, id) => store.deleteProfile(id));
ipcMain.handle('profiles:select', (e, id) => store.selectProfile(id));
ipcMain.handle('profiles:openDir', (e, id) => {
  const d = path.join(store.getSettings().gameDir, 'instances', String(id).replace(/[^a-f0-9]/g, ''));
  fs.mkdirSync(d, { recursive: true });
  return shell.openPath(d);
});

// ---------- версии ----------
ipcMain.handle('versions:list', async () => versions.listVersions(store.getSettings().gameDir));

// ---------- аккаунты ----------
ipcMain.handle('accounts:get', () => store.getAccounts());
ipcMain.handle('accounts:select', (e, id) => store.selectAccount(id));
ipcMain.handle('accounts:remove', (e, id) => store.removeAccount(id));

// Офлайн-аккаунт: в тестовой сборке — всегда, в обычной — только когда есть вход Microsoft (игра куплена).
function hasMicrosoft() { return store.getAccounts().list.some(a => a.type === 'microsoft'); }
function offlineAllowed() { return DEV || hasMicrosoft(); }

ipcMain.handle('accounts:dev', (e, name) => {
  if (!offlineAllowed()) throw new Error('Офлайн-аккаунт можно добавить только после входа через Microsoft');
  return store.upsertAccount(auth.devAccount(String(name || '').trim(), hasMicrosoft() ? 'offline' : 'dev'));
});

ipcMain.handle('accounts:rename', async (e, { id, name }) => {
  const acc = store.getAccountSecret(id);
  if (!acc) throw new Error('Аккаунт не найден');
  name = String(name || '').trim();
  if (!auth.NAME_RE.test(name)) throw new Error('Ник: 3–16 символов, латиница, цифры и _');
  if (acc.type === 'dev' || acc.type === 'offline') {
    if (acc.type === 'dev' && !DEV) throw new Error('DEV-вход доступен только в тестовой сборке');
    if (acc.type === 'offline' && !offlineAllowed()) throw new Error('Офлайн-аккаунт работает только при входе через Microsoft');
    store.removeAccount(id);
    return store.upsertAccount(auth.devAccount(name, acc.type));
  }
  const fresh = await auth.ensureFresh(CONFIG.msClientId, acc);
  const newName = await auth.changeMicrosoftName(fresh, name);
  return store.upsertAccount(Object.assign(fresh, { name: newName }));
});

ipcMain.handle('auth:ms:start', async () => {
  if (msLogin) msLogin.cancelled = true;
  const dc = await auth.startDeviceCode(CONFIG.msClientId);
  const state = { cancelled: false };
  msLogin = state;
  if (/^https:\/\//.test(dc.verification_uri)) shell.openExternal(dc.verification_uri);
  auth.loginMicrosoft(CONFIG.msClientId, dc, () => state.cancelled)
    .then(acc => { if (!state.cancelled) send('auth:ms:done', store.upsertAccount(acc)); })
    .catch(err => { if (!state.cancelled) send('auth:ms:error', err.message); })
    .finally(() => { if (msLogin === state) msLogin = null; });
  return { userCode: dc.user_code, url: dc.verification_uri, expiresIn: dc.expires_in };
});
ipcMain.handle('auth:ms:cancel', () => { if (msLogin) msLogin.cancelled = true; msLogin = null; return true; });
ipcMain.handle('shell:openCodePage', (e, url) => { if (/^https:\/\/(www\.)?microsoft\.com\/link|^https:\/\/login\.microsoft/.test(url)) shell.openExternal(url); });

// ---------- установка и запуск ----------
function makeProgress() {
  let last = 0;
  return (stage, done, total) => {
    const now = Date.now();
    if (now - last < 80 && done !== total) return;
    last = now;
    send('game:progress', { stage, done, total });
  };
}

ipcMain.handle('versions:install', async (e, id) => {
  const root = store.getSettings().gameDir;
  const realId = await versions.resolveId(root, id);
  const progress = makeProgress();
  const install = await versions.installVersion(root, realId, path.join(root, 'instances', '_downloads'), progress);
  await ensureJava(root, componentFor(install.version), (d, t) => progress('Java', d, t));
  send('game:progress', { stage: 'Готово', done: 1, total: 1 });
  return { id: realId };
});

ipcMain.handle('game:launch', async (e, { profileId, join }) => {
  if (game) throw new Error('Игра уже запущена');
  const settings = store.getSettings();
  const root = settings.gameDir;

  const accs = store.getAccounts();
  let acc = accs.selected && store.getAccountSecret(accs.selected);
  if (!acc) throw new Error('Сначала добавь аккаунт в Настройках → Аккаунт');
  if (acc.type === 'dev' && !DEV) throw new Error('DEV-аккаунт работает только в тестовой сборке');
  if (acc.type === 'offline' && !offlineAllowed()) throw new Error('Офлайн-аккаунт работает только при входе через Microsoft. Войди через Microsoft заново.');
  if (acc.type === 'microsoft') {
    const fresh = await auth.ensureFresh(CONFIG.msClientId, acc);
    if (fresh !== acc) { store.upsertAccount(fresh); acc = fresh; }
  }

  const progress = makeProgress();
  let joinTarget = join ? { host: CONFIG.server.host, port: CONFIG.server.port } : null;
  let profile;
  if (join && CONFIG.serverManifestUrl) {
    // «Играть на Komori»: профиль сервера по сборке, которую задали админы.
    progress('Проверяю сборку сервера', 0, 0);
    const m = await serverpack.fetchManifest(CONFIG.serverManifestUrl, root, CONFIG.trustedHosts);
    profile = store.upsertManagedProfile(serverpack.SERVER_PROFILE_ID, {
      name: m.name, icon: 'bat', loader: m.loader, loaderVersion: m.loaderVersion, mcVersion: m.minecraft, ram: m.ram
    });
    store.selectProfile(profile.id);
    await serverpack.sync(root, m, progress);
    if (m.server) joinTarget = m.server;
  } else {
    const profiles = store.getProfiles();
    profile = profiles.list.find(p => p.id === (profileId || profiles.selected));
    if (!profile) throw new Error('Профиль не найден');
  }

  const mc = await versions.resolveId(root, profile.mcVersion);
  const gameDir = path.join(root, 'instances', profile.id);
  const id = await loaders.ensureLoader(root, profile.loader, mc, profile.loaderVersion, progress,
    text => { if (settings.showConsole) send('game:log', text); });
  const install = await versions.installVersion(root, id, gameDir, progress);

  let logConfigPath = null;
  const lc = install.version.logging && install.version.logging.client;
  if (lc && lc.file && lc.file.url) {
    logConfigPath = path.join(root, 'assets', 'log_configs', lc.file.id);
    await downloadAll([{ url: lc.file.url, dest: logConfigPath, sha1: lc.file.sha1, size: lc.file.size }]);
  }

  const java = await ensureJava(root, componentFor(install.version), (d, t) => progress('Java', d, t));
  const ramMb = (profile.ram || settings.ram) * 1024;
  const args = buildArgs({
    root, install, gameDir, ramMb, logConfigPath, launcherVersion: app.getVersion(),
    account: { name: acc.name, uuid: acc.uuid, accessToken: acc.mcToken || '0', type: acc.type, xuid: acc.xuid },
    join: joinTarget
  });

  send('game:progress', { stage: 'Запуск', done: 1, total: 1 });
  const launchTime = Date.now();
  game = launch(java.javaw, args, gameDir,
    text => { if (settings.showConsole) send('game:log', text); },
    (code, err) => {
      game = null;
      let crashInfo = null;
      if (err || (code !== 0 && code !== null)) {
        // Вылет: запоминаем всё для отчёта админам.
        lastCrash = { gameDir, launchTime, code: err ? -1 : code, profile, version: id, launcherVersion: app.getVersion(), playerName: acc.name, javaPath: java.javaw };
        const rep = crash.collect(lastCrash);
        crashInfo = { reason: rep.reason, hasCrashReport: !!rep.crashFile, canReport: crash.validWebhook(CONFIG.crashWebhookUrl) };
      }
      send('game:exit', { code, error: err || null, crash: crashInfo });
      if (win && !win.isDestroyed() && settings.minimizeOnLaunch) win.restore();
    });
  store.touchProfile(profile.id);
  if (settings.minimizeOnLaunch && win) setTimeout(() => win && !win.isDestroyed() && win.minimize(), 1500);
  return { ok: true, version: id };
});

// ---------- отчёт о вылете ----------
ipcMain.handle('crash:send', async (e, note) => {
  if (!lastCrash) throw new Error('Нет данных о последнем вылете');
  const report = crash.collect(lastCrash);
  await crash.send(CONFIG.crashWebhookUrl, lastCrash, report, String(note || '').slice(0, 1000));
  return true;
});
ipcMain.handle('crash:openLog', () => {
  if (!lastCrash) return null;
  const rep = crash.collect(lastCrash);
  const f = rep.crashFile || path.join(lastCrash.gameDir, 'logs', 'latest.log');
  return fs.existsSync(f) ? shell.openPath(f) : shell.openPath(lastCrash.gameDir);
});

// ---------- обновление лаунчера ----------
ipcMain.handle('update:state', () => updater.getState());
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:install', () => updater.install());

// ---------- ядра ----------
ipcMain.handle('loaders:list', async (e, { loader, mcVersion }) => {
  const mc = await versions.resolveId(store.getSettings().gameDir, mcVersion);
  return { mc, list: await loaders.listLoaderVersions(loader, mc) };
});

// ---------- Modrinth и содержимое профиля ----------
const TYPES = ['mod', 'resourcepack', 'shader'];

async function profileCtx(profileId) {
  const root = store.getSettings().gameDir;
  const profiles = store.getProfiles();
  const p = profiles.list.find(x => x.id === (profileId || profiles.selected));
  if (!p) throw new Error('Профиль не найден');
  const mc = await versions.resolveId(root, p.mcVersion);
  return { profile: p, dir: path.join(root, 'instances', p.id), loader: p.loader, mc };
}

function source(name) { return name === 'curseforge' ? curseforge : modrinth; }

ipcMain.handle('catalog:search', async (e, q) => {
  const src = q.source === 'curseforge' ? 'curseforge' : 'modrinth';
  const type = TYPES.includes(q.type) || q.type === 'modpack' ? q.type : 'mod';
  if (src === 'curseforge' && !curseforge.hasKey()) return { total: 0, hits: [], needKey: true };
  const ctx = type === 'modpack' ? { mc: '', loader: '' } : await profileCtx(q.profileId);
  if (type === 'mod' && ctx.loader === 'vanilla') return { total: 0, hits: [], needLoader: true, mc: ctx.mc };
  const r = await source(src).search({ query: String(q.query || '').slice(0, 100), type, sort: q.sort, offset: q.offset }, ctx);
  return Object.assign(r, { mc: ctx.mc, loader: ctx.loader });
});

ipcMain.handle('catalog:install', async (e, { source: src, profileId, projectId, type }) => {
  if (!/^[A-Za-z0-9]+$/.test(String(projectId))) throw new Error('Неверный проект');
  const ctx = await profileCtx(profileId);
  const t = TYPES.includes(type) ? type : 'mod';
  const step = title => send('mods:step', { projectId, title });
  if (src === 'curseforge') {
    const r = await curseforge.install(ctx.dir, projectId, t, ctx, step);
    return { installed: r.installed, manual: r.manual, items: modrinth.list(ctx.dir) };
  }
  const names = await modrinth.install(ctx.dir, projectId, t, ctx, step);
  return { installed: names, manual: [], items: modrinth.list(ctx.dir) };
});

ipcMain.handle('catalog:open', (e, { source: src, slug, type, url }) => {
  if (src === 'curseforge') {
    if (/^https:\/\/www\.curseforge\.com\//.test(String(url))) shell.openExternal(url);
    return;
  }
  if (/^[A-Za-z0-9_\-]+$/.test(String(slug)) && (TYPES.includes(type) || type === 'modpack')) shell.openExternal(`https://modrinth.com/${type}/${slug}`);
});

ipcMain.handle('mods:list', async (e, profileId) => modrinth.list((await profileCtx(profileId)).dir));
ipcMain.handle('mods:toggle', async (e, { profileId, key }) => modrinth.toggle((await profileCtx(profileId)).dir, key));
ipcMain.handle('mods:remove', async (e, { profileId, key }) => modrinth.remove((await profileCtx(profileId)).dir, key));
ipcMain.handle('mods:updates', async (e, profileId) => {
  const ctx = await profileCtx(profileId);
  const a = await modrinth.checkUpdates(ctx.dir, ctx);
  const b = curseforge.hasKey() ? await curseforge.checkUpdates(ctx.dir, ctx) : [];
  return a.map(x => Object.assign({ source: 'modrinth' }, x)).concat(b);
});
ipcMain.handle('mods:update', async (e, { profileId, key, versionId, source: src }) => {
  if (!/^[A-Za-z0-9]+$/.test(String(versionId))) throw new Error('Неверная версия');
  return source(src).update((await profileCtx(profileId)).dir, key, versionId);
});

// ---------- сборки ----------
async function installPackFile(file, extra) {
  const root = store.getSettings().gameDir;
  const progress = makeProgress();
  const r = await modpacks.installFromFile(file, Object.assign({ root, saveProfile: store.saveProfile, progress }, extra || {}));
  send('game:progress', { stage: 'Готово', done: 1, total: 1 });
  return { profiles: store.getProfiles(), profileId: r.profile.id, name: r.profile.name, manual: r.manual };
}

ipcMain.handle('modpack:install', async (e, { source: src, projectId, title }) => {
  if (!/^[A-Za-z0-9]+$/.test(String(projectId))) throw new Error('Неверная сборка');
  const root = store.getSettings().gameDir;
  const progress = makeProgress();
  progress('Скачиваю сборку', 0, 1);
  const f = src === 'curseforge' ? await curseforge.modpackFile(projectId) : await modrinth.modpackFile(projectId);
  const dest = path.join(root, 'cache', 'modpacks', f.filename);
  await downloadAll([{ url: f.url, dest, sha1: f.sha1, size: f.size, verify: true }]);
  return installPackFile(dest, { nameHint: title ? String(title).slice(0, 32) : '' });
});

ipcMain.handle('modpack:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Импорт сборки', properties: ['openFile'],
    filters: [{ name: 'Сборки Modrinth и CurseForge', extensions: ['mrpack', 'zip'] }]
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return installPackFile(r.filePaths[0]);
});

// ---------- сборка сервера (редактор только в DEV-сборке) ----------
ipcMain.handle('server:status', async () => {
  const url = CONFIG.serverManifestUrl || '';
  if (!url) return { url: '', manifest: null };
  try { return { url, manifest: await serverpack.fetchManifest(url, store.getSettings().gameDir, CONFIG.trustedHosts) }; }
  catch (e) { return { url, manifest: null, error: e.message }; }
});

ipcMain.handle('server:build', async (e, profileId) => {
  if (!DEV) throw new Error('Редактор сборки сервера есть только в DEV-сборке');
  const ctx = await profileCtx(profileId);
  return serverpack.buildFromProfile({ profile: ctx.profile, mc: ctx.mc, dir: ctx.dir, server: CONFIG.server });
});

ipcMain.handle('server:save', async (e, manifest) => {
  if (!DEV) throw new Error('Редактор сборки сервера есть только в DEV-сборке');
  const clean = serverpack.validate(manifest, CONFIG.trustedHosts);
  const r = await dialog.showSaveDialog(win, { title: 'Сохранить сборку сервера', defaultPath: 'komori-server.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(clean, null, 2), 'utf8');
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});

// ---------- скины (только Microsoft) ----------
async function msAccount(id) {
  const accs = store.getAccounts();
  let acc = store.getAccountSecret(id || accs.selected);
  if (!acc) throw new Error('Аккаунт не найден');
  if (acc.type !== 'microsoft') throw new Error('Скин меняется только у аккаунта Microsoft');
  const fresh = await auth.ensureFresh(CONFIG.msClientId, acc);
  if (fresh !== acc) store.upsertAccount(fresh);
  return fresh;
}
ipcMain.handle('skin:get', async (e, id) => auth.getSkinInfo(await msAccount(id)));
ipcMain.handle('skin:upload', async (e, { id, variant }) => {
  const acc = await msAccount(id);
  const r = await dialog.showOpenDialog(win, { title: 'Выбери скин (PNG 64×64)', properties: ['openFile'], filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return auth.uploadSkin(acc, fs.readFileSync(r.filePaths[0]), variant);
});
ipcMain.handle('skin:reset', async (e, id) => auth.resetSkin(await msAccount(id)));
ipcMain.handle('skin:cape', async (e, { id, capeId }) => {
  if (capeId && !/^[A-Za-z0-9\-]+$/.test(String(capeId))) throw new Error('Неверный плащ');
  return auth.setCape(await msAccount(id), capeId || null);
});
ipcMain.handle('mods:openFolder', async (e, { profileId, type }) => {
  const ctx = await profileCtx(profileId);
  const d = path.join(ctx.dir, modrinth.FOLDERS[TYPES.includes(type) ? type : 'mod']);
  fs.mkdirSync(d, { recursive: true });
  return shell.openPath(d);
});

ipcMain.handle('game:openLog', () => {
  const profiles = store.getProfiles();
  const d = path.join(store.getSettings().gameDir, 'instances', profiles.selected || '');
  const f = path.join(d, 'komori-launch.log');
  return fs.existsSync(f) ? shell.openPath(f) : shell.openPath(d);
});
