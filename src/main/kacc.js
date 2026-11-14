'use strict';
// Аккаунт Komori в лаунчере: вход и регистрация на komori.fun, профиль, аватарка, баннер, привязка Discord.
// Токен хранится зашифрованным (safeStorage), в интерфейс не отдаётся.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const store = require('./store');

let BASE = 'https://komori.fun';
function setBase(u) { try { const x = new URL(u); if (x.protocol === 'https:') BASE = x.origin; } catch {} }
const FILE = () => path.join(app.getPath('userData'), 'komori-account.json');

function readFile() { try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return {}; } }
function writeFile(d) { const t = FILE() + '.tmp'; fs.writeFileSync(t, JSON.stringify(d), 'utf8'); fs.renameSync(t, FILE()); }
function token() { return store.dec(readFile().token || ''); }
function cached() { return readFile().account || null; }
function save(tok, account) {
  const d = readFile();
  if (tok !== undefined) d.token = tok ? store.enc(tok) : '';
  if (account !== undefined) d.account = account;
  writeFile(d);
}

class NetError extends Error {}
async function api(method, p, body, auth) {
  const headers = { 'content-type': 'application/json', 'user-agent': 'KomoriLauncher' };
  if (auth) { const t = token(); if (!t) throw new Error('Войди в аккаунт Komori'); headers.authorization = 'Bearer ' + t; }
  let r;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
  try { r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal }); }
  catch { throw new NetError('Нет связи с komori.fun. Проверь интернет и попробуй ещё раз.'); }
  finally { clearTimeout(timer); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && auth) { save('', null); const e = new Error(d.error || 'Сессия истекла — войди заново'); e.loggedOut = true; throw e; }
  if (!r.ok) throw new Error(d.error || 'Ошибка ' + r.status);
  return d;
}
function withAbs(a) {
  if (!a) return a;
  const abs = u => u && u.startsWith('/') ? BASE + u : u;
  return Object.assign({}, a, { avatar: abs(a.avatar), banner: abs(a.banner) });
}

// Состояние при запуске: есть ли вход; если сайт недоступен — последние сохранённые данные
async function me() {
  if (!token()) return { account: null };
  try { const a = withAbs(await api('GET', '/api/acc/me', undefined, true)); save(undefined, a); return { account: a }; }
  catch (e) { if (e.loggedOut) return { account: null, error: e.message }; return { account: cached(), offline: true, error: e.message }; }
}
async function login(login, password) { const d = await api('POST', '/api/acc/login', { login, password }); save(d.token, withAbs(d.account)); return withAbs(d.account); }
async function register(login, password, age) { const d = await api('POST', '/api/acc/register', { login, password, age }); save(d.token, withAbs(d.account)); return withAbs(d.account); }
async function logout() { try { await api('POST', '/api/acc/logout', undefined, true); } catch {} save('', null); return true; }
async function recover(login) { return api('POST', '/api/acc/recover', { login }); }
async function recoverFinish(login, code, password) { const d = await api('POST', '/api/acc/recover/finish', { login, code, password }); save(d.token, withAbs(d.account)); return withAbs(d.account); }
async function update(patch) { const a = withAbs(await api('PUT', '/api/acc/me', patch, true)); save(undefined, a); return a; }
async function avatar(body) { const a = withAbs(await api('POST', '/api/acc/avatar', body, true)); save(undefined, a); return a; }
async function banner(data) { const a = withAbs(await api('POST', '/api/acc/banner', { data }, true)); save(undefined, a); return a; }
async function password(old, pw) { return api('POST', '/api/acc/password', { old, password: pw }, true); }
async function discordStart() { return (await api('POST', '/api/acc/discord', undefined, true)).url; }
async function discordUnlink() { const a = withAbs(await api('DELETE', '/api/acc/discord', undefined, true)); save(undefined, a); return a; }
function profileUrl() { const a = cached(); return a ? BASE + '/u/' + encodeURIComponent(a.login) : BASE + '/profile'; }
async function syncStats(st) { if (!token()) return; try { await api('POST', '/api/acc/stats', { total: st.total, komori: st.komori, launches: st.launches }, true); } catch {} }

// Друзья: список, заявки, «в сети» и во что играют
function absFriends(d) {
  const abs = u => u && u.startsWith('/') ? BASE + u : u;
  const fix = l => (l || []).map(x => Object.assign({}, x, { avatar: abs(x.avatar) }));
  return { friends: fix(d.friends), incoming: fix(d.incoming), outgoing: fix(d.outgoing), ok: d.ok || '' };
}
async function friends() { return absFriends(await api('GET', '/api/acc/friends', undefined, true)); }
async function friendAct(action, login) { return absFriends(await api('POST', '/api/acc/friends/' + action, { login }, true)); }
async function presence(game, offline) { if (!token()) return; try { await api('POST', '/api/acc/presence', offline ? { offline: true } : { game: game || '' }, true); } catch {} }

module.exports = { friends, friendAct, presence, setBase, me, login, register, logout, recover, recoverFinish, update, avatar, banner, password, discordStart, discordUnlink, syncStats, profileUrl };
