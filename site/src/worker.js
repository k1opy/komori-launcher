// Komori — сайт сервера на Cloudflare Workers.
// Страницы, вход через Discord (OAuth2 + проверка ботом, что игрок есть на сервере Komori),
// профили игроков в KV, статистика онлайна.
//
// Нужно в настройках Worker'а:
//   KV-привязка  SITE                    — хранилище пользователей и сессий
//   Секреты      DISCORD_CLIENT_SECRET   — OAuth2 → Client Secret приложения
//                DISCORD_BOT_TOKEN       — Bot → Token
//                CURSEFORGE_API_KEY      — ключ CurseForge (лаунчер и сборка сервера ходят в CurseForge через /api/cf)
//   (необязательно) ROLE_BADGES — JSON {"<id роли>":{"label":"VIP","color":"#FFC857"}, ...}

import { PAGES, ASSETS, RUNTIME, CONTENT } from './bundle.js';

// ===== настройки (не секретные) =====
const CFG = {
  clientId: '1522381201648914473',
  guildId: '1443520605210152974',
  discordInvite: 'https://discord.gg/cQDMCZvUgp',
  launcher: 'https://github.com/k1opy/komori-launcher/releases/latest/download/Komori-Launcher-Setup.exe',
  map: 'https://map.komori.fun/',
  mcHost: 'mc.komori.fun',
  // Кто может управлять сайтом (новости, тексты, правила, вики): Discord ID людей или ID ролей.
  // Можно дополнить переменной NEWS_ADMINS (через запятую)
  newsAdmins: ['510376731157200898']
};

// Всё, что админ меняет на сайте сам (раздел «Управление»). Это значения по умолчанию — сохранённое лежит в KV c:site
const SITE_DEFAULTS = {
  banner: { on: false, text: '', link: '', tone: 'accent' },
  links: { discord: 'https://discord.gg/cQDMCZvUgp', launcher: CFG.launcher, telegram: 'https://t.me/komorifun',
    youtube: 'https://www.youtube.com/@komorifun', tiktok: 'https://www.tiktok.com/@_k1opy_' },
  hero: { pill: 'ЗБТ', ru: 'mc.komori.fun', eu: 'eu.komori.fun', note: 'RU — для игроков из России, EU — из Украины и Европы · Minecraft 26.2' },
  features: { show: true, eyebrow: 'Что уже есть', title: 'Не ванилла — и это видно', lead: 'Выживание на 26.2 со своими механиками, которых нет на других серверах.', items: [
    { icon: 'fish', big: '', title: 'Своя рыбалка', text: 'Мини-игра на 5 шкал при поклёвке, ранги рыбака от D до SS, сокровища и улов, который зависит от биома.' },
    { icon: '', big: '73', title: 'своих зачарования', text: 'Метеор, Крылья, Гром, Бульдозер и ещё десятки — всё описано в [вики](/wiki).' },
    { icon: 'mountain', big: '', title: 'Новый мир', text: 'Своя генерация: высокие горы, снежные долины и десятки новых биомов.' },
    { icon: 'trophy', big: '', title: 'Топы игроков', text: 'Топ охотников, рыбаков и другие рейтинги сервера.' }] },
  soon: { show: true, eyebrow: 'Спойлеры', title: 'Что будет дальше', items: [
    { tag: 'Скоро', title: 'Незерит — это не конец', text: 'Новая ступень снаряжения выше незерита.' },
    { tag: 'В планах', title: 'Данжи и охота', text: 'Обновляемые подземелья и система охоты на животных.' }] },
  zbt: { show: true, eyebrow: 'Закрытый бета-тест', title: 'Попади в ЗБТ', ticket: 'Проходка', perks: ['Доступ к ЗБТ', 'VIP на 3 месяца в 1 сезоне'],
    prices: ['500 ₽', '280 ₴', '6.20 $'], how: 'Купить проходку — через Discord.', giveTitle: 'Розыгрыш проходок',
    giveText: 'Регулярно разыгрываем проходки в нашем Discord. Заходи, чтобы участвовать и следить за новостями.' },
  steps: { show: true, eyebrow: 'Как начать', title: 'Три шага до игры', items: [
    { title: 'Скачай Komori Launcher', text: 'Войди через Microsoft и нажми «Играть на Komori» — лаунчер сам поставит нужную версию и моды. [Скачать для Windows](/download)' },
    { title: 'Или зайди вручную', text: 'Minecraft 26.2 → Сетевая игра → Добавить сервер → **mc.komori.fun** (Россия) или **eu.komori.fun** (Украина и Европа).' },
    { title: 'Прими ресурспак', text: 'Без него не будут видны текстуры своих предметов и зачарований.' }] }
};
const NEWS_CATS = ['news', 'devblog', 'update', 'giveaway', 'tech', 'fix'];
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

  // Один адрес для всех: старый workers.dev и www перекидываем на komori.fun (иначе вход через Discord не сработает)
  if (m === 'GET' && (url.hostname.endsWith('.workers.dev') || url.hostname === 'www.komori.fun')) {
    return Response.redirect('https://komori.fun' + p + url.search, 301);
  }

  if (m === 'GET' && p === '/komori-dc.js') return new Response(RUNTIME, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  if (m === 'GET' && p.startsWith('/assets/')) return asset(p.slice(8));
  if (m === 'GET' && p === '/robots.txt') return text('User-agent: *\nAllow: /\n');
  if (m === 'GET' && p === '/download') return Response.redirect((await siteCfg(env)).links.launcher, 302);

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
  if (p === '/api/stats' && m === 'GET') return stats(ctx, env);

  // ----- новости -----
  if (p === '/api/news' && m === 'GET') return json(await newsIndex(env), 200, { 'cache-control': 'no-store' });
  if (p === '/api/news' && m === 'POST') return newsSave(req, env, ctx, null);
  r = p.match(/^\/api\/news\/([a-z0-9]{6,20})$/);
  if (r) {
    if (m === 'GET') { const n = await env.SITE.get('n:' + r[1], { type: 'json' }); return n ? json(n) : json({ error: 'Новость не найдена' }, 404); }
    if (m === 'PUT') return newsSave(req, env, ctx, r[1]);
    if (m === 'DELETE') return newsDelete(req, env, ctx, r[1]);
  }
  r = p.match(/^\/news-img\/([a-z0-9]{6,20})$/);
  if (r && m === 'GET') return newsImage(env, r[1]);

  // ----- управление сайтом: тексты главной, правила, вики, картинки -----
  // ----- CurseForge через сайт (ключ остаётся только здесь) -----
  r = p.match(/^\/api\/cf(\/[\w\/]*)$/);
  if (r) return cfProxy(req, env, ctx, r[1], url);

  // ----- сборка сервера для лаунчера -----
  if (m === 'GET' && p === '/komori-server.json') return packManifest(env, url);
  r = p.match(/^\/pack\/file\/([a-f0-9]{40})$/);
  if (r && m === 'GET') return packFile(env, r[1]);
  if (p === '/api/pack/files' && m === 'POST') return packUpload(req, env, ctx);

  r = p.match(/^\/api\/content\/(site|rules|wiki|pack)$/);
  if (r) {
    if (m === 'GET') return json(await contentGet(env, r[1]), 200, { 'cache-control': 'no-store' });
    if (m === 'PUT' || m === 'DELETE') return contentSave(req, env, ctx, r[1], m === 'DELETE');
  }
  r = p.match(/^\/api\/content\/(site|rules|wiki|pack)\/history$/);
  if (r && m === 'GET') return contentHistory(req, env, ctx, r[1]);
  r = p.match(/^\/api\/content\/(site|rules|wiki|pack)\/restore$/);
  if (r && m === 'POST') return contentRestore(req, env, ctx, r[1]);
  if (p === '/api/img' && m === 'POST') return imageUpload(req, env, ctx);
  r = p.match(/^\/img\/([a-z0-9]{6,24})$/);
  if (r && m === 'GET') return newsImage(env, r[1], 'img:');

  // ----- страницы -----
  const pages = { '/': 'main', '/news': 'news', '/rules': 'rules', '/wiki': 'wiki', '/map': 'map', '/profile': 'profile', '/admin': 'admin', '/admin/pack': 'pack' };
  let page = pages[p] || (/^\/u\/\d{5,25}$/.test(p) ? 'profile' : /^\/news\/[a-z0-9]{6,20}$/.test(p) ? 'news' : null);
  if (page && m === 'GET') {
    const me = await currentUser(req, env, ctx);
    const flash = { notmember: 'Сначала зайди на наш сервер Discord, потом войди на сайт.', denied: 'Вход отменён.', error: 'Не получилось войти через Discord, попробуй ещё раз.' }[url.searchParams.get('login')] || '';
    const site = await siteCfg(env);
    const boot = { me: me ? { id: me.id, name: displayName(me), avatar: avatarUrl(me), admin: isNewsAdmin(me, env) } : null, page, flash,
      cfg: publicCfg(site), site };
    if (page === 'rules' || page === 'wiki' || page === 'pack') boot.content = (await contentGet(env, page)).data;
    const html = PAGES[page].replace('<!--BOOT-->', '<script>window.KOMORI=' + JSON.stringify(boot).replace(/</g, '\\u003c') + ';</script>');
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY } });
  }
  const site = await siteCfg(env);
  return new Response(PAGES['main'].replace('<!--BOOT-->', '<script>window.KOMORI=' + JSON.stringify({ page: '', cfg: publicCfg(site), site }).replace(/</g, '\\u003c') + ';</script>'), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY } });
}

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN'
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
async function stats(ctx, env) {
  const key = new Request('https://cache.komori/stats');
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;
  const out = { mc: null, discord: null };
  await Promise.all([
    fetchRetry('https://api.mcsrvstat.us/3/' + CFG.mcHost, { headers: { 'user-agent': 'KomoriSite/1.0' } }).then(r => r.json()).then(d => {
      out.mc = { online: !!d.online, players: d.players ? d.players.online : 0, max: d.players ? d.players.max : 0,
        list: d.players && Array.isArray(d.players.list) ? d.players.list.map(x => String(x.name || x)).slice(0, 50) : [] };
    }).catch(() => {}),
    discordCounts(env).then(d => { out.discord = d; }).catch(() => {})
  ]);
  // mcsrvstat иногда не успевает ответить — берём последний ответ из KV, если ему меньше 10 минут
  if (out.mc) ctx.waitUntil(env.SITE.put('stats:mc', JSON.stringify({ at: Date.now(), mc: out.mc })));
  else {
    const last = await env.SITE.get('stats:mc', { type: 'json' }).catch(() => null);
    if (last && Date.now() - last.at < 600000) out.mc = last.mc;
  }
  // Discord иногда не отвечает Cloudflare — тогда показываем последнее удачное значение из KV
  if (out.discord) ctx.waitUntil(env.SITE.put('stats:discord', JSON.stringify(out.discord)));
  else out.discord = await env.SITE.get('stats:discord', { type: 'json' }).catch(() => null);
  const res = json(out, 200, { 'cache-control': 'public, max-age=60' });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// Повтор запроса один раз, если сервис статуса ответил ошибкой
async function fetchRetry(url, opt) {
  try { const r = await fetch(url, opt); if (r.ok) return r; } catch (e) {}
  return fetch(url, opt);
}

// Число участников: сначала через бота (у него свой лимит запросов), запасной путь — публичный инвайт
async function discordCounts(env) {
  if (env.DISCORD_BOT_TOKEN) {
    const r = await fetch(`https://discord.com/api/v10/guilds/${CFG.guildId}?with_counts=true`, { headers: { authorization: 'Bot ' + env.DISCORD_BOT_TOKEN } });
    if (r.ok) {
      const g = await r.json();
      if (g.approximate_member_count) return { members: g.approximate_member_count, online: g.approximate_presence_count };
    }
  }
  const r2 = await fetch('https://discord.com/api/v10/invites/' + CFG.discordInvite.split('/').pop() + '?with_counts=true');
  const d = await r2.json();
  if (d.approximate_member_count) return { members: d.approximate_member_count, online: d.approximate_presence_count };
  return null;
}

// ===== новости =====
// KV: n:index — список (без текста), n:<id> — новость целиком, ni:<id> — картинка (base64, до 2 МБ)
function isNewsAdmin(u, env) {
  if (!u) return false;
  const list = CFG.newsAdmins.concat(String(env.NEWS_ADMINS || '').split(',').map(x => x.trim()).filter(Boolean));
  return list.includes(u.id) || (u.roles || []).some(r => list.includes(r));
}
async function newsIndex(env) {
  const list = (await env.SITE.get('n:index', { type: 'json' })) || [];
  return list.sort((a, b) => (b.pinned - a.pinned) || (b.created - a.created));
}
async function newsSave(req, env, ctx, id) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const u = await currentUser(req, env, ctx);
  if (!isNewsAdmin(u, env)) return json({ error: 'Нет прав на публикацию новостей' }, 403);
  let b;
  try { b = await req.json(); } catch { return json({ error: 'Неверные данные' }, 400); }
  const clean = (s, n) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, n);
  const title = clean(b.title, 120), body = clean(b.body, 8000);
  if (!title) return json({ error: 'Нужен заголовок' }, 400);
  if (!body) return json({ error: 'Нужен текст новости' }, 400);
  const old = id ? await env.SITE.get('n:' + id, { type: 'json' }) : null;
  if (id && !old) return json({ error: 'Новость не найдена' }, 404);
  if (!id) id = Date.now().toString(36) + randomHex(3);
  const category = NEWS_CATS.includes(b.category) ? b.category : 'news';
  const n = { id, title, body, category, pinned: !!b.pinned, created: old ? old.created : Date.now(), updated: Date.now(),
    author: displayName(u), image: old ? old.image : false };
  if (b.image === null) { n.image = false; await env.SITE.delete('ni:' + id); }
  else if (typeof b.image === 'string') {
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(b.image);
    if (!m) return json({ error: 'Картинка должна быть PNG, JPG, WEBP или GIF' }, 400);
    if (m[2].length > 2800000) return json({ error: 'Картинка больше 2 МБ' }, 400);
    await env.SITE.put('ni:' + id, JSON.stringify({ type: m[1], b64: m[2] }));
    n.image = Date.now();
  }
  await env.SITE.put('n:' + id, JSON.stringify(n));
  const list = ((await env.SITE.get('n:index', { type: 'json' })) || []).filter(x => x.id !== id);
  list.push({ id, title, category, pinned: n.pinned, created: n.created, image: n.image, excerpt: plainExcerpt(body, 180) });
  await env.SITE.put('n:index', JSON.stringify(list));
  return json(n);
}
async function newsDelete(req, env, ctx, id) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const u = await currentUser(req, env, ctx);
  if (!isNewsAdmin(u, env)) return json({ error: 'Нет прав' }, 403);
  await env.SITE.delete('n:' + id);
  await env.SITE.delete('ni:' + id);
  const list = ((await env.SITE.get('n:index', { type: 'json' })) || []).filter(x => x.id !== id);
  await env.SITE.put('n:index', JSON.stringify(list));
  return json({ ok: true });
}
async function newsImage(env, id, prefix = 'ni:') {
  const a = await env.SITE.get(prefix + id, { type: 'json' });
  if (!a) return text('not found', 404);
  const bin = Uint8Array.from(atob(a.b64), c => c.charCodeAt(0));
  return new Response(bin, { headers: { 'content-type': a.type, 'cache-control': 'public, max-age=86400' } });
}
function plainExcerpt(src, n) {
  const t = String(src).replace(/\|\|\s*<@&\d+>\s*\|\|/g, '').replace(/<[@#]&?\d+>/g, '')
    .replace(/^\**\s*#{1,3}\s+.*$/gm, '').replace(/[*_~`|•]/g, '').replace(/^\s*-\s+/gm, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t;
}

// ===== управление сайтом =====
// KV: c:site / c:rules / c:wiki — сохранённая версия (если нет — берётся стандартная),
//     h:<ключ> — 15 прошлых версий, чтобы можно было откатить ошибку; img:<id> — картинки для правил и вики
const CONTENT_DEFAULTS = { site: SITE_DEFAULTS, rules: CONTENT.rules, wiki: CONTENT.wiki, pack: CONTENT.pack };
let SITE_CACHE = null;
async function siteCfg(env) {
  if (SITE_CACHE && SITE_CACHE.t > Date.now() - 2000) return SITE_CACHE.v;
  const saved = await env.SITE.get('c:site', { type: 'json' });
  const v = shapeLike(SITE_DEFAULTS, saved ? saved.data : null, true);
  SITE_CACHE = { t: Date.now(), v };
  return v;
}
function publicCfg(site) {
  const L = site.links;
  return { discord: L.discord, launcher: '/download', map: CFG.map,
    social: [['Telegram', L.telegram], ['YouTube', L.youtube], ['TikTok', L.tiktok]].filter(x => x[1]).map(x => ({ name: x[0], url: x[1] })) };
}
// Приводит присланные данные к форме образца: лишние поля выкидываются, строки обрезаются, ссылки проверяются.
// fill=true — пустые места заполняются значениями по умолчанию
function shapeLike(def, val, fill) {
  if (Array.isArray(def)) {
    if (!Array.isArray(val)) return fill ? def : [];
    const proto = def[0];
    return val.slice(0, 24).map(x => proto && typeof proto === 'object' ? shapeLike(proto, x, false) : cleanStr(x, 600));
  }
  if (def && typeof def === 'object') {
    const out = {};
    for (const k of Object.keys(def)) {
      const has = val && typeof val === 'object' && k in val;
      out[k] = has ? shapeLike(def[k], val[k], fill) : (fill ? def[k] : shapeLike(def[k], undefined, false));
      if (typeof def[k] === 'string' && /^(link|discord|launcher|telegram|youtube|tiktok)$/.test(k) && out[k] && !/^(https:\/\/|\/(?!\/))\S+$/.test(out[k])) out[k] = fill ? def[k] : '';
    }
    return out;
  }
  if (typeof def === 'boolean') return val === undefined ? def : !!val;
  return val === undefined || val === null ? (fill ? def : '') : cleanStr(val, 2000);
}
function cleanStr(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, n); }
async function contentGet(env, key) {
  if (key === 'site') { const saved = await env.SITE.get('c:site', { type: 'json' }); return { data: await siteCfg(env), custom: !!saved, updated: saved && saved.at, author: saved && saved.author, defaults: SITE_DEFAULTS }; }
  const saved = await env.SITE.get('c:' + key, { type: 'json' });
  return { data: saved ? saved.data : CONTENT_DEFAULTS[key], custom: !!saved, updated: saved && saved.at, author: saved && saved.author };
}
function validContent(key, d) {
  if (key === 'site') return shapeLike(SITE_DEFAULTS, d, true);
  if (key === 'rules') { const t = cleanStr(d, 60000).trim(); return t || null; }
  if (key === 'pack') return validPack(d);
  if (key === 'wiki') {
    if (!d || !Array.isArray(d.tabs) || !d.tabs.length) return null;
    const ids = new Set();
    const tabs = d.tabs.slice(0, 30).map(t => {
      let id = String(t.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) || 't' + randomHex(3);
      while (ids.has(id)) id += '-' + randomHex(1);
      ids.add(id);
      const o = { id, label: cleanStr(t.label, 60).trim() || 'Без названия', hint: cleanStr(t.hint, 80).trim(), body: cleanStr(t.body, 40000) };
      if (t.builtin === 'fishlist' || t.builtin === 'ench') o.builtin = t.builtin;
      if (t.hidden) o.hidden = true;
      return o;
    });
    return { intro: cleanStr(d.intro, 400).trim(), tabs };
  }
  return null;
}
async function pushHistory(env, key, u) {
  const cur = await env.SITE.get('c:' + key, { type: 'json' });
  const prev = cur || { data: CONTENT_DEFAULTS[key], at: 0, author: 'стандартная версия' };
  const hist = (await env.SITE.get('h:' + key, { type: 'json' })) || [];
  hist.unshift(prev);
  await env.SITE.put('h:' + key, JSON.stringify(hist.slice(0, 15)));
}
async function contentSave(req, env, ctx, key, reset) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const u = await currentUser(req, env, ctx);
  if (!isNewsAdmin(u, env)) return json({ error: 'Нет прав на изменение сайта' }, 403);
  let data = null;
  if (!reset) {
    let b; try { b = await req.json(); } catch { return json({ error: 'Неверные данные' }, 400); }
    data = validContent(key, b && b.data);
    if (!data) return json({ error: 'Пусто — нечего сохранять' }, 400);
  }
  await pushHistory(env, key, u);
  if (reset) await env.SITE.delete('c:' + key);
  else await env.SITE.put('c:' + key, JSON.stringify({ data, at: Date.now(), author: displayName(u) }));
  SITE_CACHE = null;
  return json(await contentGet(env, key));
}
async function contentHistory(req, env, ctx, key) {
  const u = await currentUser(req, env, ctx);
  if (!isNewsAdmin(u, env)) return json({ error: 'Нет прав' }, 403);
  const hist = (await env.SITE.get('h:' + key, { type: 'json' })) || [];
  return json(hist.map((h, i) => ({ i, at: h.at, author: h.author })), 200, { 'cache-control': 'no-store' });
}
async function contentRestore(req, env, ctx, key) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const u = await currentUser(req, env, ctx);
  if (!isNewsAdmin(u, env)) return json({ error: 'Нет прав' }, 403);
  let b; try { b = await req.json(); } catch { return json({ error: 'Неверные данные' }, 400); }
  const hist = (await env.SITE.get('h:' + key, { type: 'json' })) || [];
  const h = hist[b && b.i | 0];
  if (!h) return json({ error: 'Такой версии нет' }, 404);
  await pushHistory(env, key, u);
  await env.SITE.put('c:' + key, JSON.stringify({ data: h.data, at: Date.now(), author: displayName(u) + ' (возврат версии)' }));
  SITE_CACHE = null;
  return json(await contentGet(env, key));
}
async function imageUpload(req, env, ctx) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const u = await currentUser(req, env, ctx);
  if (!isNewsAdmin(u, env)) return json({ error: 'Нет прав' }, 403);
  let b; try { b = await req.json(); } catch { return json({ error: 'Неверные данные' }, 400); }
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(b && b.image || ''));
  if (!m) return json({ error: 'Картинка должна быть PNG, JPG, WEBP или GIF' }, 400);
  if (m[2].length > 2800000) return json({ error: 'Картинка больше 2 МБ' }, 400);
  const id = Date.now().toString(36) + randomHex(4);
  await env.SITE.put('img:' + id, JSON.stringify({ type: m[1], b64: m[2] }));
  return json({ url: '/img/' + id });
}

// ===== сборка сервера =====
// c:pack — { name, minecraft, loader, loaderVersion, ram, mods:[…], configs:[…], allowed:[…] }
// mods — файлы с Modrinth (моды, шейдеры, ресурспаки); configs — свои файлы (настройки модов), лежат в KV pf:<sha1>;
// allowed — что игроки могут поставить себе сверху. Лаунчер читает готовый /komori-server.json
const PACK_DIRS = ['mods', 'resourcepacks', 'shaderpacks'];
const PACK_CFG_DIRS = ['config/', 'resourcepacks/', 'shaderpacks/'];
function packPath(p) {
  p = String(p || '').replace(/\\/g, '/');
  if (p === 'options.txt') return p;
  if (!PACK_CFG_DIRS.some(d => p.startsWith(d)) || p.length > 200) return null;
  if (p.split('/').some(x => !x || x === '.' || x === '..') || /[<>:"|?*\u0000-\u001F]/.test(p)) return null;
  return p;
}
const ICON_RE = /^https:\/\/(cdn\.modrinth\.com|media\.forgecdn\.net)\/\S+$/;
function validPack(d) {
  if (!d || typeof d !== 'object') return null;
  const hex = x => /^[a-f0-9]{40}$/.test(String(x || ''));
  const id = x => String(x || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
  const seen = new Set();
  const mods = (Array.isArray(d.mods) ? d.mods : []).slice(0, 400).map(x => {
    const folder = PACK_DIRS.includes(x.folder) ? x.folder : 'mods';
    const filename = cleanStr(x.filename, 160).trim();
    if (!filename || /[\\/<>:"|?*]/.test(filename) || filename.startsWith('.')) return null;
    if (!/^https:\/\/(cdn\.modrinth\.com|edge\.forgecdn\.net|mediafilez\.forgecdn\.net)\/\S+$/.test(String(x.url || '')) || !hex(x.sha1)) return null;
    const key = (folder + '/' + filename).toLowerCase();
    if (seen.has(key)) return null; seen.add(key);
    return { projectId: id(x.projectId), versionId: id(x.versionId), title: cleanStr(x.title, 100) || filename, version: cleanStr(x.version, 60),
      filename, folder, url: x.url, sha1: x.sha1, size: Math.max(0, Number(x.size) || 0), enabled: x.enabled !== false,
      source: x.source === 'curseforge' ? 'curseforge' : 'modrinth', icon: ICON_RE.test(String(x.icon || '')) ? x.icon : '' };
  }).filter(Boolean);
  const cseen = new Set();
  const configs = (Array.isArray(d.configs) ? d.configs : []).slice(0, 600).map(x => {
    const path = packPath(x.path);
    if (!path || !hex(x.sha1) || cseen.has(path.toLowerCase())) return null;
    cseen.add(path.toLowerCase());
    return { path, sha1: x.sha1, size: Math.max(0, Number(x.size) || 0), mode: x.mode === 'force' ? 'force' : 'once' };
  }).filter(Boolean);
  const aseen = new Set();
  const allowed = (Array.isArray(d.allowed) ? d.allowed : []).slice(0, 300).map(x => {
    const pid = id(x.projectId);
    if (!pid || aseen.has(pid)) return null; aseen.add(pid);
    return { projectId: pid, title: cleanStr(x.title, 100) || pid, slug: cleanStr(x.slug, 80).replace(/[^\w-]/g, ''),
      type: ['mod', 'resourcepack', 'shader'].includes(x.type) ? x.type : 'mod', dep: !!x.dep,
      source: x.source === 'curseforge' ? 'curseforge' : 'modrinth', icon: ICON_RE.test(String(x.icon || '')) ? x.icon : '' };
  }).filter(Boolean);
  return {
    name: cleanStr(d.name, 32).trim() || 'Komori',
    minecraft: String(d.minecraft || '').replace(/[^A-Za-z0-9._\- ]/g, '').slice(0, 40) || '26.2',
    loader: ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].includes(d.loader) ? d.loader : 'fabric',
    loaderVersion: String(d.loaderVersion || '').replace(/[^A-Za-z0-9._+\-]/g, '').slice(0, 40),
    ram: Math.max(0, Math.min(32, Number(d.ram) || 0)), mods, configs, allowed
  };
}
async function packManifest(env, url) {
  const saved = await env.SITE.get('c:pack', { type: 'json' });
  const P = saved ? saved.data : CONTENT_DEFAULTS.pack;
  const base = url.origin;
  const out = {
    format: 1, name: P.name, updated: new Date(saved ? saved.at : 0).toISOString(),
    minecraft: P.minecraft, loader: P.loader, loaderVersion: P.loaderVersion, ram: P.ram,
    server: { host: CFG.mcHost, port: 25565 },
    files: P.mods.filter(x => x.enabled).map(x => ({ path: x.folder + '/' + x.filename, url: x.url, sha1: x.sha1, size: x.size || undefined, title: x.title, projectId: x.projectId || undefined }))
      .concat(P.configs.map(c => ({ path: c.path, url: base + '/pack/file/' + c.sha1, sha1: c.sha1, size: c.size || undefined, title: c.path.split('/').pop(), mode: c.mode }))),
    allowed: P.allowed.map(a => ({ projectId: a.projectId, title: a.title, type: a.type, slug: a.slug, icon: a.icon, dep: a.dep || undefined, source: a.source === 'curseforge' ? 'curseforge' : undefined }))
  };
  return new Response(JSON.stringify(out, null, 1), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30', 'access-control-allow-origin': '*' } });
}
async function packFile(env, sha1) {
  const a = await env.SITE.get('pf:' + sha1, { type: 'arrayBuffer' });
  if (!a) return text('not found', 404);
  return new Response(a, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' } });
}
// Загрузка файлов настроек: [{ b64 }] → [{ sha1, size }]. Файл хранится по своему SHA-1, поэтому одинаковые не дублируются
async function packUpload(req, env, ctx) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const u = await currentUser(req, env, ctx);
  if (!isNewsAdmin(u, env)) return json({ error: 'Нет прав' }, 403);
  let b; try { b = await req.json(); } catch { return json({ error: 'Слишком большой или неверный запрос' }, 400); }
  const files = Array.isArray(b && b.files) ? b.files.slice(0, 60) : [];
  const out = [];
  for (const f of files) {
    if (typeof f.b64 !== 'string' || !/^[A-Za-z0-9+/=]*$/.test(f.b64)) return json({ error: 'Неверный файл' }, 400);
    const bin = Uint8Array.from(atob(f.b64), c => c.charCodeAt(0));
    if (bin.length > 10 * 1024 * 1024) return json({ error: 'Файл больше 10 МБ' }, 400);
    const sha1 = hex(new Uint8Array(await crypto.subtle.digest('SHA-1', bin)));
    if (!(await env.SITE.get('pf:' + sha1, { type: 'arrayBuffer' }))) await env.SITE.put('pf:' + sha1, bin);
    out.push({ sha1, size: bin.length });
  }
  return json(out);
}

// ===== CurseForge =====
// Пропускаем только то, что нужно лаунчеру и странице сборки: поиск, мод, файлы, отпечатки.
const CF_ROUTES = [
  ['GET', /^\/mods\/search$/], ['GET', /^\/mods\/\d{1,10}$/], ['GET', /^\/mods\/\d{1,10}\/files$/], ['GET', /^\/mods\/\d{1,10}\/files\/\d{1,12}$/],
  ['POST', /^\/mods$/], ['POST', /^\/mods\/files$/], ['POST', /^\/fingerprints\/432$/]
];
const CF_HITS = new Map();   // простая защита от злоупотреблений: не больше 240 запросов за 5 минут с одного адреса
async function cfProxy(req, env, ctx, sub, url) {
  const m = req.method;
  if (m === 'OPTIONS') return new Response(null, { status: 204 });
  if (!env.CURSEFORGE_API_KEY) return json({ error: 'CurseForge на сайте ещё не настроен' }, 503);
  if (!CF_ROUTES.some(([mm, re]) => mm === m && re.test(sub))) return json({ error: 'Такой запрос к CurseForge не поддерживается' }, 404);
  const ua = req.headers.get('user-agent') || '';
  if (!/KomoriLauncher|komori\//.test(ua) && req.headers.get('sec-fetch-site') !== 'same-origin') return json({ error: 'forbidden' }, 403);
  const ip = req.headers.get('cf-connecting-ip') || 'x', now = Date.now();
  const hit = CF_HITS.get(ip) || { n: 0, t: now };
  if (now - hit.t > 300000) { hit.n = 0; hit.t = now; }
  if (++hit.n > 240) return json({ error: 'Слишком много запросов к CurseForge, подожди пару минут' }, 429);
  CF_HITS.set(ip, hit);
  if (CF_HITS.size > 5000) CF_HITS.clear();
  const q = new URLSearchParams(url.search);
  if (sub === '/mods/search') q.set('gameId', '432');
  const target = 'https://api.curseforge.com/v1' + sub + (q.toString() ? '?' + q : '');
  const headers = { 'x-api-key': env.CURSEFORGE_API_KEY, accept: 'application/json', 'user-agent': 'KomoriSite/1.0 (komori.fun)' };
  if (m === 'GET') {
    const cache = caches.default, key = new Request(target);
    const c = await cache.match(key);
    if (c) return c;
    const res = await fetch(target, { headers });
    const out = new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': res.ok ? 'public, max-age=600' : 'no-store' } });
    if (res.ok) ctx.waitUntil(cache.put(key, out.clone()));
    return out;
  }
  const body = await req.text();
  if (body.length > 65536) return json({ error: 'Слишком большой запрос' }, 400);
  const res = await fetch(target, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body });
  return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
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
