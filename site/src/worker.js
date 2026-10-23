// Komori — сайт сервера на Cloudflare Workers.
// Страницы, вход через Discord (OAuth2 + проверка ботом, что игрок есть на сервере Komori),
// профили игроков в KV, статистика онлайна.
//
// Нужно в настройках Worker'а:
//   KV-привязка  SITE                    — хранилище пользователей и сессий
//   Секреты      DISCORD_CLIENT_SECRET   — OAuth2 → Client Secret приложения
//                DISCORD_BOT_TOKEN       — Bot → Token
//   (необязательно) ROLE_BADGES — JSON {"<id роли>":{"label":"VIP","color":"#FFC857"}, ...}

import { PAGES, ASSETS, RUNTIME } from './bundle.js';

// ===== настройки (не секретные) =====
const CFG = {
  clientId: '1522381201648914473',
  guildId: '1443520605210152974',
  discordInvite: 'https://discord.gg/cQDMCZvUgp',
  launcher: 'https://github.com/k1opy/komori-launcher/releases/latest/download/Komori-Launcher-Setup.exe',
  map: 'http://80.249.144.187:8197/',
  mcHost: 'mc.komori.fun',
  social: [
    { name: 'Telegram', url: 'https://t.me/komorifun' },
    { name: 'YouTube', url: 'https://www.youtube.com/@komorifun' },
    { name: 'TikTok', url: 'https://www.tiktok.com/@_k1opy_' }
  ]
};
const SESSION_DAYS = 30;
const ROLE_REFRESH_MS = 30 * 60 * 1000;
const ACCENTS = ['#B57BFF', '#FF7EDB', '#6FA8FF', '#5FE0C8', '#7BD88F', '#FFC857', '#FF8A6B'];
const LINK_HOSTS = { youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'], twitch: ['twitch.tv', 'www.twitch.tv'], tiktok: ['tiktok.com', 'www.tiktok.com'] };

export default {
  async fetch(req, env, ctx) {
    try { return await route(req, env, ctx); }
    catch (e) { return text('Ошибка сервера: ' + (e && e.message || e), 500); }
  }
};

let ROLE_MAP = {};
async function route(req, env, ctx) {
  try { ROLE_MAP = JSON.parse(env.ROLE_BADGES || '{}'); } catch { ROLE_MAP = {}; }
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;

  if (m === 'GET' && p === '/komori-dc.js') return new Response(RUNTIME, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  if (m === 'GET' && p.startsWith('/assets/')) return asset(p.slice(8));
  if (m === 'GET' && p === '/robots.txt') return text('User-agent: *\nAllow: /\n');

  // ----- вход через Discord -----
  if (m === 'GET' && p === '/auth/login') return login(url, env);
  if (m === 'GET' && p === '/auth/callback') return callback(req, url, env);
  if (m === 'POST' && p === '/auth/logout') return logout(req, env);

  // ----- API -----
  if (p === '/api/me' && m === 'GET') {
    const me = await currentUser(req, env, ctx);
    return me ? json(publicProfile(me, true)) : json({ error: 'Не выполнен вход' }, 401);
  }
  if (p === '/api/me' && m === 'PUT') return saveProfile(req, env, ctx);
  let r = p.match(/^\/api\/user\/(\d{5,25})$/);
  if (r && m === 'GET') {
    const u = await env.SITE.get('u:' + r[1], { type: 'json' });
    return u ? json(publicProfile(u, false)) : json({ error: 'Не найден' }, 404);
  }
  if (p === '/api/stats' && m === 'GET') return stats(ctx);

  // ----- страницы -----
  const pages = { '/': 'main', '/rules': 'rules', '/wiki': 'wiki', '/map': 'map', '/profile': 'profile' };
  let page = pages[p] || (/^\/u\/\d{5,25}$/.test(p) ? 'profile' : null);
  if (page && m === 'GET') {
    const me = await currentUser(req, env, ctx);
    const flash = { notmember: 'Сначала зайди на наш сервер Discord, потом войди на сайт.', denied: 'Вход отменён.', error: 'Не получилось войти через Discord, попробуй ещё раз.' }[url.searchParams.get('login')] || '';
    const boot = { me: me ? { id: me.id, name: displayName(me), avatar: avatarUrl(me) } : null, page, flash,
      cfg: { discord: CFG.discordInvite, launcher: CFG.launcher, map: CFG.map, social: CFG.social } };
    const html = PAGES[page].replace('<!--BOOT-->', '<script>window.KOMORI=' + JSON.stringify(boot).replace(/</g, '\\u003c') + ';</script>');
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY } });
  }
  return new Response(PAGES['main'].replace('<!--BOOT-->', '<script>window.KOMORI={page:"",cfg:' + JSON.stringify({ discord: CFG.discordInvite, launcher: CFG.launcher, map: CFG.map, social: CFG.social }) + '};</script>'), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY } });
}

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY'
};

// ===== вход =====
async function login(url, env) {
  const state = randomHex(16);
  const next = safeNext(url.searchParams.get('next'));
  const redirect = url.origin + '/auth/callback';
  const q = new URLSearchParams({ client_id: CFG.clientId, response_type: 'code', redirect_uri: redirect, scope: 'identify', state, prompt: 'none' });
  const h = new Headers({ location: 'https://discord.com/oauth2/authorize?' + q });
  h.append('set-cookie', cookie('ks_state', state + '|' + next, 600));
  return new Response(null, { status: 302, headers: h });
}

async function callback(req, url, env) {
  const cookies = parseCookies(req);
  const [state, next] = String(cookies.ks_state || '').split('|');
  const back = (code) => redirect((next || '/') + (code ? (String(next || '/').includes('?') ? '&' : '?') + 'login=' + code : ''), [cookie('ks_state', '', 0)]);
  if (url.searchParams.get('error')) return back('denied');
  if (!state || state !== url.searchParams.get('state')) return back('error');
  const code = url.searchParams.get('code');
  if (!code) return back('error');
  if (!env.DISCORD_CLIENT_SECRET || !env.DISCORD_BOT_TOKEN) return text('Вход через Discord ещё не настроен: нужны секреты DISCORD_CLIENT_SECRET и DISCORD_BOT_TOKEN.', 503);

  // 1. код → токен пользователя
  const tok = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CFG.clientId, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: url.origin + '/auth/callback' })
  });
  if (!tok.ok) return back('error');
  const { access_token } = await tok.json();
  // 2. кто это
  const ur = await fetch('https://discord.com/api/v10/users/@me', { headers: { authorization: 'Bearer ' + access_token } });
  if (!ur.ok) return back('error');
  const du = await ur.json();
  // 3. бот проверяет, что он есть на сервере Komori, и берёт роли
  const member = await guildMember(env, du.id);
  if (!member) return back('notmember');

  const old = await env.SITE.get('u:' + du.id, { type: 'json' });
  const user = Object.assign({ accent: ACCENTS[0], status: '', bio: '', links: {}, showDiscord: false, since: Date.now() }, old || {}, {
    id: du.id, username: du.username, globalName: du.global_name || null, avatar: du.avatar || null,
    nick: member.nick || null, roles: member.roles || [], rolesAt: Date.now()
  });
  await env.SITE.put('u:' + du.id, JSON.stringify(user));
  const sid = randomHex(32);
  await env.SITE.put('s:' + await sha256hex(sid), du.id, { expirationTtl: SESSION_DAYS * 86400 });
  return redirect(next || '/', [cookie('ks_state', '', 0), cookie('ks', sid, SESSION_DAYS * 86400)]);
}

async function logout(req, env) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const sid = parseCookies(req).ks;
  if (sid) await env.SITE.delete('s:' + await sha256hex(sid));
  return new Response(null, { status: 204, headers: { 'set-cookie': cookie('ks', '', 0) } });
}

async function guildMember(env, userId) {
  const r = await fetch(`https://discord.com/api/v10/guilds/${CFG.guildId}/members/${userId}`, { headers: { authorization: 'Bot ' + env.DISCORD_BOT_TOKEN } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Discord API ' + r.status);
  return r.json();
}

async function currentUser(req, env, ctx) {
  const sid = parseCookies(req).ks;
  if (!sid || !/^[0-9a-f]{64}$/.test(sid)) return null;
  const id = await env.SITE.get('s:' + await sha256hex(sid));
  if (!id) return null;
  const u = await env.SITE.get('u:' + id, { type: 'json' });
  // Раз в 30 минут обновляем роли (в фоне, чтобы не тормозить страницу)
  if (u && env.DISCORD_BOT_TOKEN && Date.now() - (u.rolesAt || 0) > ROLE_REFRESH_MS) {
    ctx.waitUntil(guildMember(env, u.id).then(mem => {
      u.rolesAt = Date.now();
      if (mem) { u.roles = mem.roles || []; u.nick = mem.nick || null; } else u.roles = [];
      return env.SITE.put('u:' + u.id, JSON.stringify(u));
    }).catch(() => {}));
  }
  return u;
}

// ===== профиль =====
function displayName(u) { return u.nick || u.globalName || u.username; }
function avatarUrl(u) {
  if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256`;
  const n = Number((BigInt(u.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${n}.png`;
}
function badges(u) {
  const map = ROLE_MAP;
  return (u.roles || []).filter(r => map[r]).map(r => ({ label: String(map[r].label).slice(0, 20), color: /^#[0-9a-fA-F]{6}$/.test(map[r].color) ? map[r].color : '#B57BFF' }));
}
function publicProfile(u, own) {
  return {
    id: u.id, name: displayName(u), avatar: avatarUrl(u), accent: u.accent, status: u.status, bio: u.bio,
    links: u.links || {}, badges: badges(u),
    since: new Date(u.since || Date.now()).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
    discordTag: own || u.showDiscord ? '@' + u.username : '',
    showDiscord: own ? !!u.showDiscord : undefined
  };
}

async function saveProfile(req, env, ctx) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const u = await currentUser(req, env, ctx);
  if (!u) return json({ error: 'Не выполнен вход' }, 401);
  let b;
  try { b = await req.json(); } catch { return json({ error: 'Неверные данные' }, 400); }
  const clean = (s, n) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, n);
  u.status = clean(b.status, 60);
  u.bio = clean(b.bio, 300);
  if (ACCENTS.includes(b.accent)) u.accent = b.accent;
  u.showDiscord = !!b.showDiscord;
  const links = {};
  for (const k of Object.keys(LINK_HOSTS)) {
    const v = clean(b.links && b.links[k], 200);
    if (!v) continue;
    let x;
    try { x = new URL(v); } catch { return json({ error: `Ссылка ${k} должна начинаться с https://` }, 400); }
    if (x.protocol !== 'https:' || !LINK_HOSTS[k].includes(x.hostname)) return json({ error: `Ссылка ${k} должна вести на ${LINK_HOSTS[k][0]}` }, 400);
    links[k] = x.href;
  }
  u.links = links;
  await env.SITE.put('u:' + u.id, JSON.stringify(u));
  return json(publicProfile(u, true));
}

// ===== онлайн сервера и Discord (кэш 60 сек) =====
async function stats(ctx) {
  const key = new Request('https://cache.komori/stats');
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;
  const out = { mc: null, discord: null };
  await Promise.all([
    fetch('https://api.mcsrvstat.us/3/' + CFG.mcHost, { headers: { 'user-agent': 'KomoriSite/1.0' } }).then(r => r.json()).then(d => {
      out.mc = { online: !!d.online, players: d.players ? d.players.online : 0, max: d.players ? d.players.max : 0,
        list: d.players && Array.isArray(d.players.list) ? d.players.list.map(x => String(x.name || x)).slice(0, 50) : [] };
    }).catch(() => {}),
    fetch('https://discord.com/api/v10/invites/' + CFG.discordInvite.split('/').pop() + '?with_counts=true').then(r => r.json()).then(d => {
      if (d.approximate_member_count) out.discord = { members: d.approximate_member_count, online: d.approximate_presence_count };
    }).catch(() => {})
  ]);
  const res = json(out, 200, { 'cache-control': 'public, max-age=60' });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// ===== утилиты =====
function asset(name) {
  const a = ASSETS[name];
  if (!a) return text('not found', 404);
  const bin = Uint8Array.from(atob(a.b64), c => c.charCodeAt(0));
  return new Response(bin, { headers: { 'content-type': a.type, 'cache-control': 'public, max-age=86400' } });
}
function json(o, status = 200, extra = {}) { return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } }); }
function text(s, status = 200) { return new Response(s, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } }); }
function redirect(to, cookies) {
  const h = new Headers({ location: to });
  for (const c of cookies || []) h.append('set-cookie', c);
  return new Response(null, { status: 302, headers: h });
}
function cookie(name, value, maxAge) { return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`; }
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(/;\s*/)) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i)] = part.slice(i + 1); }
  return out;
}
function safeNext(n) { return typeof n === 'string' && /^\/(?!\/)[\w\-/]*$/.test(n) ? n : '/'; }
function sameOrigin(req) { const o = req.headers.get('origin'); return !o || o === new URL(req.url).origin; }
function hex(u8) { return Array.from(u8, x => x.toString(16).padStart(2, '0')).join(''); }
function randomHex(n) { return hex(crypto.getRandomValues(new Uint8Array(n))); }
async function sha256hex(s) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))); }
