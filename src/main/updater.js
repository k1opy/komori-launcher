'use strict';
// Автообновление лаунчера: GitHub Releases (k1opy/komori-launcher) через electron-updater.
// Работает только в собранной обычной версии. В DEV-сборке и при `npm run dev` выключено,
// чтобы тестовая сборка случайно не заменилась обычной.

let autoUpdater = null;
let state = { state: 'off', version: '', percent: 0, error: '' };
let notify = () => {};

function set(patch) { state = Object.assign({}, state, patch); notify(state); }

function init({ enabled, onState, isGameRunning }) {
  notify = onState || notify;
  if (!enabled) { set({ state: 'off' }); return; }
  try { ({ autoUpdater } = require('electron-updater')); }
  catch (e) { set({ state: 'error', error: 'Модуль обновлений не найден: выполни npm install' }); return; }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: '' }));
  autoUpdater.on('update-not-available', () => set({ state: 'latest', percent: 0 }));
  autoUpdater.on('update-available', info => set({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', p => set({ state: 'downloading', percent: Math.floor(p.percent || 0) }));
  autoUpdater.on('update-downloaded', info => set({ state: 'ready', version: info.version, percent: 100 }));
  autoUpdater.on('error', err => set({ state: 'error', error: String((err && err.message) || err).split('\n')[0].slice(0, 200) }));
  init.isGameRunning = isGameRunning || (() => false);

  setTimeout(check, 4000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

function check() {
  if (!autoUpdater) return state;
  if (state.state === 'downloading' || state.state === 'ready') return state;
  autoUpdater.checkForUpdates().catch(err => set({ state: 'error', error: String(err.message || err).slice(0, 200) }));
  return state;
}

function install() {
  if (!autoUpdater || state.state !== 'ready') throw new Error('Обновление ещё не скачано');
  if (init.isGameRunning && init.isGameRunning()) throw new Error('Сначала закрой игру — лаунчер перезапустится для установки');
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}

function getState() { return state; }

module.exports = { init, check, install, getState };
