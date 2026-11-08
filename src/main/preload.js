'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const h = (e, data) => cb(data);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('komori', {
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
    onState: on('win:state')
  },
  info: () => ipcRenderer.invoke('app:info'),
  openLink: (id) => ipcRenderer.invoke('link:open', id),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    openGameDir: () => ipcRenderer.invoke('settings:openGameDir')
  },
  profiles: {
    get: () => ipcRenderer.invoke('profiles:get'),
    save: (p) => ipcRenderer.invoke('profiles:save', p),
    remove: (id) => ipcRenderer.invoke('profiles:delete', id),
    select: (id) => ipcRenderer.invoke('profiles:select', id),
    openDir: (id) => ipcRenderer.invoke('profiles:openDir', id)
  },
  versions: {
    list: () => ipcRenderer.invoke('versions:list'),
    install: (id) => ipcRenderer.invoke('versions:install', id)
  },
  accounts: {
    get: () => ipcRenderer.invoke('accounts:get'),
    select: (id) => ipcRenderer.invoke('accounts:select', id),
    remove: (id) => ipcRenderer.invoke('accounts:remove', id),
    dev: (name) => ipcRenderer.invoke('accounts:dev', name),
    ygg: (login, password, serverUrl) => ipcRenderer.invoke('accounts:ygg', { login, password, serverUrl }),
    rename: (id, name) => ipcRenderer.invoke('accounts:rename', { id, name }),
    msStart: () => ipcRenderer.invoke('auth:ms:start'),
    msCancel: () => ipcRenderer.invoke('auth:ms:cancel'),
    openCodePage: (url) => ipcRenderer.invoke('shell:openCodePage', url),
    skinGet: (id) => ipcRenderer.invoke('skin:get', id),
    skinUpload: (id, variant) => ipcRenderer.invoke('skin:upload', { id, variant }),
    skinReset: (id) => ipcRenderer.invoke('skin:reset', id),
    capeSet: (id, capeId) => ipcRenderer.invoke('skin:cape', { id, capeId }),
    offSkinGet: (id) => ipcRenderer.invoke('skin:offline:get', id),
    offSkinUpload: (id, variant) => ipcRenderer.invoke('skin:offline:upload', { id, variant }),
    offSkinVariant: (id, variant) => ipcRenderer.invoke('skin:offline:variant', { id, variant }),
    offSkinReset: (id) => ipcRenderer.invoke('skin:offline:reset', id),
    onMsDone: on('auth:ms:done'),
    onMsError: on('auth:ms:error')
  },
  loaders: {
    list: (loader, mcVersion) => ipcRenderer.invoke('loaders:list', { loader, mcVersion })
  },
  mods: {
    search: (q) => ipcRenderer.invoke('catalog:search', q),
    install: (source, profileId, projectId, type) => ipcRenderer.invoke('catalog:install', { source, profileId, projectId, type }),
    open: (source, slug, type, url) => ipcRenderer.invoke('catalog:open', { source, slug, type, url }),
    installPack: (source, projectId, title) => ipcRenderer.invoke('modpack:install', { source, projectId, title }),
    importPack: () => ipcRenderer.invoke('modpack:import'),
    list: (profileId) => ipcRenderer.invoke('mods:list', profileId),
    toggle: (profileId, key) => ipcRenderer.invoke('mods:toggle', { profileId, key }),
    remove: (profileId, key) => ipcRenderer.invoke('mods:remove', { profileId, key }),
    updates: (profileId) => ipcRenderer.invoke('mods:updates', profileId),
    update: (profileId, key, versionId, source) => ipcRenderer.invoke('mods:update', { profileId, key, versionId, source }),
    openFolder: (profileId, type) => ipcRenderer.invoke('mods:openFolder', { profileId, type }),
    onStep: on('mods:step')
  },
  manual: {
    pending: (profileId) => ipcRenderer.invoke('manual:pending', profileId),
    scan: (profileId) => ipcRenderer.invoke('manual:scan', profileId),
    pickFolder: (profileId) => ipcRenderer.invoke('manual:pickFolder', profileId),
    open: (url) => ipcRenderer.invoke('manual:open', url)
  },
  server: {
    ping: () => ipcRenderer.invoke('server:ping'),
    status: () => ipcRenderer.invoke('server:status'),
    build: (profileId) => ipcRenderer.invoke('server:build', profileId),
    save: (manifest) => ipcRenderer.invoke('server:save', manifest),
    onBlocked: on('server:blocked')
  },
  crash: {
    send: (note) => ipcRenderer.invoke('crash:send', note),
    openLog: () => ipcRenderer.invoke('crash:openLog')
  },
  stats: () => ipcRenderer.invoke('stats:get'),
  news: {
    minecraft: (force) => ipcRenderer.invoke('news:mc', force),
    komori: (force) => ipcRenderer.invoke('news:komori', force),
    open: (id) => ipcRenderer.invoke('news:open', id)
  },
  kacc: {
    me: () => ipcRenderer.invoke('kacc:me'),
    login: (login, password) => ipcRenderer.invoke('kacc:login', { login, password }),
    register: (login, password, age) => ipcRenderer.invoke('kacc:register', { login, password, age }),
    logout: () => ipcRenderer.invoke('kacc:logout'),
    recover: (login) => ipcRenderer.invoke('kacc:recover', { login }),
    recoverFinish: (login, code, password) => ipcRenderer.invoke('kacc:recoverFinish', { login, code, password }),
    update: (patch) => ipcRenderer.invoke('kacc:update', patch),
    password: (old, password) => ipcRenderer.invoke('kacc:password', { old, password }),
    avatarDefault: (color) => ipcRenderer.invoke('kacc:avatarDefault', { color }),
    avatarPick: () => ipcRenderer.invoke('kacc:avatarPick'),
    avatarSkin: (data) => ipcRenderer.invoke('kacc:avatarSkin', { data }),
    bannerPick: () => ipcRenderer.invoke('kacc:bannerPick'),
    bannerReset: () => ipcRenderer.invoke('kacc:bannerReset'),
    discordLink: () => ipcRenderer.invoke('kacc:discordLink'),
    discordUnlink: () => ipcRenderer.invoke('kacc:discordUnlink'),
    openProfile: () => ipcRenderer.invoke('kacc:openProfile')
  },
  look: {
    get: () => ipcRenderer.invoke('look:get'),
    pick: (kind) => ipcRenderer.invoke('look:pick', kind),
    reset: (kind) => ipcRenderer.invoke('look:reset', kind)
  },
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: on('update:state')
  },
  game: {
    launch: (profileId, join) => ipcRenderer.invoke('game:launch', { profileId, join }),
    stop: (profileId) => ipcRenderer.invoke('game:stop', profileId),
    openLog: () => ipcRenderer.invoke('game:openLog'),
    lastLog: () => ipcRenderer.invoke('game:lastLog'),
    running: () => ipcRenderer.invoke('game:running'),
    onRunning: on('game:running'),
    onProgress: on('game:progress'),
    onLog: on('game:log'),
    onExit: on('game:exit')
  }
});
