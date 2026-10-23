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
    rename: (id, name) => ipcRenderer.invoke('accounts:rename', { id, name }),
    msStart: () => ipcRenderer.invoke('auth:ms:start'),
    msCancel: () => ipcRenderer.invoke('auth:ms:cancel'),
    openCodePage: (url) => ipcRenderer.invoke('shell:openCodePage', url),
    skinGet: (id) => ipcRenderer.invoke('skin:get', id),
    skinUpload: (id, variant) => ipcRenderer.invoke('skin:upload', { id, variant }),
    skinReset: (id) => ipcRenderer.invoke('skin:reset', id),
    capeSet: (id, capeId) => ipcRenderer.invoke('skin:cape', { id, capeId }),
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
  server: {
    status: () => ipcRenderer.invoke('server:status'),
    build: (profileId) => ipcRenderer.invoke('server:build', profileId),
    save: (manifest) => ipcRenderer.invoke('server:save', manifest)
  },
  game: {
    launch: (profileId, join) => ipcRenderer.invoke('game:launch', { profileId, join }),
    openLog: () => ipcRenderer.invoke('game:openLog'),
    onProgress: on('game:progress'),
    onLog: on('game:log'),
    onExit: on('game:exit')
  }
});
