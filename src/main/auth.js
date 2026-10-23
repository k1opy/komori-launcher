'use strict';
// Авторизация: Microsoft (device code) -> Xbox Live -> XSTS -> Minecraft; DEV-вход для тестовой сборки.
const crypto = require('crypto');
const { UA } = require('./net');

const MS_DEVICE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';
const MS_TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const SCOPE = 'XboxLive.signin offline_access';

async function postForm(url, data) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams(data).toString()
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA }, headers),
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

// ---------- Microsoft ----------
async function startDeviceCode(clientId) {
  if (!clientId) throw new Error('Не задан msClientId в komori.config.json. Зарегистрируй приложение в Azure и впиши его ID.');
  const r = await postForm(MS_DEVICE, { client_id: clientId, scope: SCOPE });
  if (!r.ok) throw new Error('Microsoft не выдал код входа: ' + (r.json.error_description || r.status));
  return r.json; // user_code, device_code, verification_uri, interval, expires_in, message
}

async function pollDeviceCode(clientId, dc, isCancelled) {
  let interval = (dc.interval || 5) * 1000;
  const deadline = Date.now() + (dc.expires_in || 900) * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval));
    if (isCancelled && isCancelled()) throw new Error('Вход отменён');
    const r = await postForm(MS_TOKEN, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: dc.device_code
    });
    if (r.ok) return r.json;
    const err = r.json.error;
    if (err === 'authorization_pending') continue;
    if (err === 'slow_down') { interval += 5000; continue; }
    if (err === 'expired_token') throw new Error('Код входа истёк, попробуй ещё раз');
    if (err === 'authorization_declined') throw new Error('Вход отклонён');
    throw new Error('Ошибка входа Microsoft: ' + (r.json.error_description || err || r.status));
  }
  throw new Error('Время на вход истекло');
}

async function refreshMs(clientId, refreshToken) {
  const r = await postForm(MS_TOKEN, { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, scope: SCOPE });
  if (!r.ok) throw new Error('Сессия Microsoft истекла, войди заново');
  return r.json;
}

const XSTS_ERRORS = {
  2148916233: 'У этого аккаунта Microsoft нет профиля Xbox. Создай его на xbox.com и попробуй снова.',
  2148916235: 'Xbox Live недоступен в твоей стране.',
  2148916236: 'Аккаунту нужна проверка возраста на xbox.com.',
  2148916237: 'Аккаунту нужна проверка возраста на xbox.com.',
  2148916238: 'Это детский аккаунт: его нужно добавить в семью Microsoft.'
};

async function msToMinecraft(msAccessToken) {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccessToken },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT'
  });
  if (!xbl.ok) throw new Error('Не удалось войти в Xbox Live (' + xbl.status + ')');
  const uhs = xbl.json.DisplayClaims.xui[0].uhs;

  const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.json.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT'
  });
  if (!xsts.ok) throw new Error(XSTS_ERRORS[xsts.json.XErr] || ('Ошибка XSTS (' + xsts.status + ')'));
  const xuid = (xsts.json.DisplayClaims && xsts.json.DisplayClaims.xui && xsts.json.DisplayClaims.xui[0].xid) || '';

  const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xsts.json.Token}`
  });
  if (mc.status === 403) throw new Error('Mojang пока не одобрил доступ лаунчера к API Minecraft. Дождись одобрения заявки.');
  if (!mc.ok) throw new Error('Не удалось войти в Minecraft (' + mc.status + ')');

  const prof = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: 'Bearer ' + mc.json.access_token, 'User-Agent': UA }
  });
  if (prof.status === 404) throw new Error('На этом аккаунте нет купленной Minecraft: Java Edition.');
  if (!prof.ok) throw new Error('Не удалось получить профиль Minecraft (' + prof.status + ')');
  const p = await prof.json();
  return {
    mcToken: mc.json.access_token,
    mcExpires: Date.now() + (mc.json.expires_in || 86400) * 1000 - 60000,
    uuid: dashed(p.id), name: p.name, xuid
  };
}

// Полный вход по коду: возвращает аккаунт для хранилища.
async function loginMicrosoft(clientId, dc, isCancelled) {
  const ms = await pollDeviceCode(clientId, dc, isCancelled);
  const mc = await msToMinecraft(ms.access_token);
  return {
    id: 'ms-' + mc.uuid, type: 'microsoft', name: mc.name, uuid: mc.uuid, xuid: mc.xuid,
    refreshToken: ms.refresh_token, mcToken: mc.mcToken, mcExpires: mc.mcExpires
  };
}

// Перед запуском: обновить токен Minecraft, если истёк.
async function ensureFresh(clientId, acc) {
  if (acc.type !== 'microsoft') return acc;
  if (acc.mcToken && acc.mcExpires && acc.mcExpires > Date.now()) return acc;
  const ms = await refreshMs(clientId, acc.refreshToken);
  const mc = await msToMinecraft(ms.access_token);
  return Object.assign({}, acc, { refreshToken: ms.refresh_token || acc.refreshToken, mcToken: mc.mcToken, mcExpires: mc.mcExpires, name: mc.name, xuid: mc.xuid });
}

// Смена ника Microsoft-аккаунта (Mojang: раз в 30 дней).
async function changeMicrosoftName(acc, newName) {
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile/name/' + encodeURIComponent(newName), {
    method: 'PUT', headers: { Authorization: 'Bearer ' + acc.mcToken, 'User-Agent': UA }
  });
  if (res.ok) return (await res.json()).name;
  if (res.status === 400) throw new Error('Недопустимый ник');
  if (res.status === 403) throw new Error('Ник можно менять раз в 30 дней');
  if (res.status === 409 || res.status === 429) throw new Error('Этот ник занят или слишком много попыток');
  throw new Error('Не удалось сменить ник (' + res.status + ')');
}

// ---------- Скины и плащи (только Microsoft-аккаунты) ----------
const MC_PROFILE = 'https://api.minecraftservices.com/minecraft/profile';

async function mcGet(acc, url) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + acc.mcToken, 'User-Agent': UA } });
  if (!res.ok) throw new Error('Mojang ответил ' + res.status);
  return res.json();
}

async function toDataUrl(url) {
  if (!/^https?:\/\/textures\.minecraft\.net\//.test(url || '')) return '';
  const res = await fetch(url.replace(/^http:/, 'https:'), { headers: { 'User-Agent': UA } });
  if (!res.ok) return '';
  return 'data:image/png;base64,' + Buffer.from(await res.arrayBuffer()).toString('base64');
}

function describeProfile(p) {
  const skin = (p.skins || []).find(s => s.state === 'ACTIVE') || null;
  return {
    name: p.name,
    skin: skin ? { url: skin.url, variant: String(skin.variant || 'CLASSIC').toLowerCase() } : null,
    capes: (p.capes || []).map(c => ({ id: c.id, alias: c.alias, active: c.state === 'ACTIVE', url: c.url }))
  };
}

async function getSkinInfo(acc) {
  const info = describeProfile(await mcGet(acc, MC_PROFILE));
  info.skinData = info.skin ? await toDataUrl(info.skin.url) : '';
  return info;
}

// PNG 64x64 или 64x32 (старый формат), не больше 64 КБ.
function checkSkinPng(buf) {
  const sig = '89504e470d0a1a0a';
  if (buf.length < 24 || buf.slice(0, 8).toString('hex') !== sig) throw new Error('Это не PNG-файл');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (w !== 64 || (h !== 64 && h !== 32)) throw new Error(`Скин должен быть 64×64 или 64×32, а этот ${w}×${h}`);
  if (buf.length > 64 * 1024) throw new Error('Файл скина слишком большой');
}

async function uploadSkin(acc, buf, variant) {
  checkSkinPng(buf);
  const fd = new FormData();
  fd.append('variant', variant === 'slim' ? 'slim' : 'classic');
  fd.append('file', new Blob([buf], { type: 'image/png' }), 'skin.png');
  const res = await fetch(MC_PROFILE + '/skins', { method: 'POST', headers: { Authorization: 'Bearer ' + acc.mcToken, 'User-Agent': UA }, body: fd });
  if (res.status === 429) throw new Error('Слишком часто: подожди минуту и попробуй снова');
  if (!res.ok) throw new Error('Mojang не принял скин (' + res.status + ')');
  return getSkinInfo(acc);
}

async function resetSkin(acc) {
  const res = await fetch(MC_PROFILE + '/skins/active', { method: 'DELETE', headers: { Authorization: 'Bearer ' + acc.mcToken, 'User-Agent': UA } });
  if (!res.ok) throw new Error('Не удалось сбросить скин (' + res.status + ')');
  return getSkinInfo(acc);
}

async function setCape(acc, capeId) {
  const opts = capeId
    ? { method: 'PUT', headers: { Authorization: 'Bearer ' + acc.mcToken, 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ capeId }) }
    : { method: 'DELETE', headers: { Authorization: 'Bearer ' + acc.mcToken, 'User-Agent': UA } };
  const res = await fetch(MC_PROFILE + '/capes/active', opts);
  if (!res.ok) throw new Error('Не удалось сменить плащ (' + res.status + ')');
  return getSkinInfo(acc);
}

// ---------- DEV-вход (только тестовая сборка) ----------
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function offlineUuid(name) {
  // Как в Java: UUID.nameUUIDFromBytes("OfflinePlayer:" + name)
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  return dashed(h.toString('hex'));
}

// type: 'dev' (тестовая сборка) или 'offline' (после входа Microsoft с купленной игрой)
function devAccount(name, type = 'dev') {
  if (!NAME_RE.test(name || '')) throw new Error('Ник: 3–16 символов, латиница, цифры и _');
  return { id: type + '-' + name.toLowerCase(), type, name, uuid: offlineUuid(name), mcToken: '0' };
}

function dashed(hex) {
  const h = String(hex).replace(/-/g, '');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ===== Yggdrasil: сторонние серверы авторизации (LittleSkin, Ely.by и др.) =====
// Отдельный тип аккаунта рядом с Microsoft. Доступен только когда в лаунчере есть Microsoft-аккаунт
// с купленной игрой (проверка в main.js). Пароль нигде не сохраняется — только accessToken/clientToken.
const YGG_TIMEOUT = 10000;

function yggBase(serverUrl) {
  let u;
  try { u = new URL(String(serverUrl || '').trim()); } catch { throw new Error('Неверный URL сервера авторизации'); }
  if (u.protocol !== 'https:') throw new Error('URL сервера авторизации должен начинаться с https://');
  return u.href.replace(/\/+$/, '');
}

// Запрос к Yggdrasil с таймаутом и понятными ошибками
async function yggRequest(base, pathName, body) {
  let res;
  try {
    res = await fetch(base + pathName, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(YGG_TIMEOUT)
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new Error('Сервер авторизации не отвечает (10 секунд). Попробуй позже.');
    throw new Error('Сервер авторизации недоступен. Проверь URL и интернет.');
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = data && (data.errorMessage || data.error) || '';
    if (res.status === 401 || res.status === 403 || /Invalid credentials|ForbiddenOperation/i.test(msg)) {
      const e = new Error(pathName.includes('authenticate') ? 'Неверный логин или пароль' : 'Сессия истекла — войди заново');
      e.code = 'auth';
      throw e;
    }
    if (res.status === 429) throw new Error('Слишком много попыток входа, подожди минуту');
    throw new Error('Сервер авторизации ответил ошибкой ' + res.status + (msg ? ': ' + msg : ''));
  }
  if (!data || typeof data !== 'object') throw new Error('Сервер авторизации прислал непонятный ответ');
  return data;
}

// API Location Indication: сервер может указать настоящий адрес API в заголовке
async function yggResolve(serverUrl) {
  const base = yggBase(serverUrl);
  try {
    const res = await fetch(base, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(YGG_TIMEOUT) });
    const loc = res.headers.get('x-authlib-injector-api-location');
    if (loc) return yggBase(new URL(loc, base).href);
  } catch {}
  return base;
}

function dashedUuid(id) {
  const h = String(id || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) return null;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function authenticateYggdrasil(email, password, serverUrl) {
  email = String(email || '').trim();
  if (!email) throw new Error('Введи email или логин');
  if (!password) throw new Error('Введи пароль');
  const base = await yggResolve(serverUrl);
  const data = await yggRequest(base, '/authserver/authenticate', {
    username: email, password: String(password), clientToken: crypto.randomUUID().replace(/-/g, ''),
    agent: { name: 'Minecraft', version: 1 }, requestUser: false
  });
  const prof = data.selectedProfile || (Array.isArray(data.availableProfiles) && data.availableProfiles[0]);
  if (!data.accessToken || !data.clientToken) throw new Error('Сервер авторизации прислал неполный ответ');
  if (!prof) throw new Error('На этом аккаунте нет персонажа — создай его на сайте сервера авторизации');
  const uuid = dashedUuid(prof.id);
  if (!uuid || !prof.name) throw new Error('Сервер авторизации прислал неверный профиль');
  return {
    id: 'ygg-' + new URL(base).hostname + '-' + uuid.replace(/-/g, '').slice(0, 12),
    type: 'yggdrasil', name: String(prof.name).slice(0, 32), uuid,
    mcToken: data.accessToken, refreshToken: data.clientToken, serverUrl: base
  };
}

// Перед запуском: токен ещё действует? Если нет — обновляем (refresh).
async function refreshYggdrasil(acc) {
  const base = yggBase(acc.serverUrl);
  try {
    await yggRequest(base, '/authserver/validate', { accessToken: acc.mcToken, clientToken: acc.refreshToken });
    return acc;
  } catch (e) { if (e.code !== 'auth') throw e; }
  const data = await yggRequest(base, '/authserver/refresh', { accessToken: acc.mcToken, clientToken: acc.refreshToken });
  if (!data.accessToken) throw new Error('Сессия истекла — войди заново');
  return Object.assign({}, acc, { mcToken: data.accessToken, refreshToken: data.clientToken || acc.refreshToken,
    name: (data.selectedProfile && data.selectedProfile.name) || acc.name });
}

module.exports = { startDeviceCode, loginMicrosoft, ensureFresh, changeMicrosoftName, devAccount, offlineUuid, NAME_RE,
  getSkinInfo, uploadSkin, resetSkin, setCape, checkSkinPng, authenticateYggdrasil, refreshYggdrasil, yggBase };
