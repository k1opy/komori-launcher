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
  newsAdmins: ['510376731157200898', '1475195925902393424'] // владелец и роль «Админ»
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
  if (m === 'GET' && p === '/auth/login') return login(url, env, 'I', safeNext(url.searchParams.get('next')));
  if (m === 'GET' && p === '/auth/callback') return callback(req, url, env);
  if (m === 'POST' && p === '/auth/logout') return logout(req, env);

  // ----- API -----
  const acc = await accRoutes(req, env, ctx, url, p, m);
  if (acc) return acc;
  let r;
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
  // ----- ник и аватарка по Discord ID (для колеса розыгрышей) -----
  r = p.match(/^\/wheel\/user\/(\d{15,21})$/);
  if (r && m === 'GET') return wheelUser(env, ctx, r[1], req);
  if (p.startsWith('/wheel/') && m === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET' } });

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
  const pages = { '/': 'main', '/news': 'news', '/rules': 'rules', '/wiki': 'wiki', '/map': 'map', '/profile': 'profile', '/login': 'login', '/admin': 'admin', '/admin/pack': 'pack', '/admin/accounts': 'accounts' };
  let page = pages[p] || (/^\/u\/[A-Za-z0-9_]{3,16}$/.test(p) ? 'profile' : /^\/news\/[a-z0-9]{6,20}$/.test(p) ? 'news' : null);
  if (page && m === 'GET') {
    const me = await currentUser(req, env, ctx);
    const meAcc = await currentAccount(req, env);
    const flash = { denied: 'Вход отменён.', error: 'Не получилось связаться с Discord, попробуй ещё раз.',
      nolink: 'Этот Discord не привязан ни к одному аккаунту Komori. Войди по логину и паролю и привяжи Discord в профиле.',
      taken: 'Этот Discord уже привязан к другому аккаунту Komori.', linked: 'Discord привязан. Если начинал из лаунчера — можно вернуться в него.' }[url.searchParams.get('login')] || '';
    const site = await siteCfg(env);
    const boot = { me: meAcc ? { id: meAcc.id, name: meAcc.login, avatar: accAvatarUrl(meAcc), admin: isNewsAdmin(me, env) }
      : me ? { id: me.id, name: displayName(me), avatar: avatarUrl(me), admin: isNewsAdmin(me, env), legacy: true } : null, page, flash,
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
// mode: 'I' — войти в аккаунт Komori через привязанный Discord, 'L<state>' — привязать Discord к аккаунту
async function login(url, env, mode, next) {
  const state = randomHex(16);
  next = safeNext(next);
  const redirect = url.origin + '/auth/callback';
  const q = new URLSearchParams({ client_id: CFG.clientId, response_type: 'code', redirect_uri: redirect, scope: 'identify', state, prompt: 'none' });
  const h = new Headers({ location: 'https://discord.com/oauth2/authorize?' + q });
  h.append('set-cookie', cookie('ks_state', state + '|' + next + '|' + mode, 600));
  return new Response(null, { status: 302, headers: h });
}

async function callback(req, url, env) {
  const cookies = parseCookies(req);
  const [state, next, mode] = String(cookies.ks_state || '').split('|');
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
  // 3. бот берёт роли на сервере Komori (для значков и прав админа)
  const member = await guildMember(env, du.id).catch(() => null);
  const old = await env.SITE.get('u:' + du.id, { type: 'json' });
  const user = Object.assign({ since: Date.now() }, old || {}, {
    id: du.id, username: du.username, globalName: du.global_name || null, avatar: du.avatar || null,
    nick: member ? member.nick || null : null, roles: member ? member.roles || [] : [], rolesAt: Date.now()
  });
  await env.SITE.put('u:' + du.id, JSON.stringify(user));
  const clear = cookie('ks_state', '', 0);

  // 4а. привязка Discord к аккаунту Komori
  if (mode && mode[0] === 'L') {
    const s = mode.slice(1);
    const accId = /^[0-9a-f]{32}$/.test(s) ? await env.SITE.get('kls:' + s) : null;
    if (!accId) return back('error');
    await env.SITE.delete('kls:' + s);
    const owner = await env.SITE.get('kd:' + du.id);
    if (owner && owner !== accId) return back('taken');
    const a = await accGet(env, accId);
    if (!a) return back('error');
    if (a.discord && a.discord.id !== du.id) await env.SITE.delete('kd:' + a.discord.id);
    a.discord = { id: du.id, name: du.global_name || du.username, username: du.username };
    await env.SITE.put('kd:' + du.id, a.id);
    await accPut(env, a);
    return redirect('/profile?login=linked', [clear]);
  }
  // 4б. вход: только если этот Discord привязан к аккаунту Komori
  const accId = await env.SITE.get('kd:' + du.id);
  if (!accId) return back('nolink');
  const t = await newSession(env, accId);
  return redirect(next || '/', [clear, accCookie(t)]);
}

async function logout(req, env) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const sid = parseCookies(req).ks;
  if (sid) await env.SITE.delete('s:' + await sha256hex(sid));
  const tk = accToken(req);
  if (tk) await env.SITE.delete('kt:' + await sha256hex(tk.t));
  const h = new Headers({ 'set-cookie': cookie('ks', '', 0) });
  h.append('set-cookie', accCookie(''));
  return new Response(null, { status: 204, headers: h });
}

async function guildMember(env, userId) {
  const r = await fetch(`https://discord.com/api/v10/guilds/${CFG.guildId}/members/${userId}`, { headers: { authorization: 'Bot ' + env.DISCORD_BOT_TOKEN } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Discord API ' + r.status);
  return r.json();
}

// Discord-запись текущего посетителя (для прав админа): через аккаунт Komori с привязанным Discord
// или по старой сессии входа через Discord
async function currentUser(req, env, ctx) {
  const sid = parseCookies(req).ks;
  if (!sid || !/^[0-9a-f]{64}$/.test(sid)) return linkedDiscordUser(env, ctx, await currentAccount(req, env));
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

// ===== колесо розыгрышей: ник и аватарка пользователя Discord через бота сайта =====
const WHEEL_HITS = new Map();
async function wheelUser(env, ctx, id, req) {
  const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8' };
  const cache = caches.default, key = new Request('https://komori.fun/wheel/user/' + id);
  const c = await cache.match(key);
  if (c) return new Response(c.body, { headers: Object.assign({}, cors, { 'cache-control': 'public, max-age=3600' }) });
  const ip = req.headers.get('cf-connecting-ip') || 'x', now = Date.now();
  const hit = WHEEL_HITS.get(ip) || { n: 0, t: now };
  if (now - hit.t > 60000) { hit.n = 0; hit.t = now; }
  if (++hit.n > 120) return new Response(JSON.stringify({ error: 'Слишком много запросов' }), { status: 429, headers: cors });
  WHEEL_HITS.set(ip, hit); if (WHEEL_HITS.size > 5000) WHEEL_HITS.clear();
  const r = await fetch('https://discord.com/api/v10/users/' + id, { headers: { authorization: 'Bot ' + env.DISCORD_BOT_TOKEN } });
  if (r.status === 429) return new Response(JSON.stringify({ error: 'Discord просит подождать' }), { status: 429, headers: cors });
  if (!r.ok) return new Response(JSON.stringify({ error: 'Не найден' }), { status: r.status === 404 ? 404 : 502, headers: cors });
  const u = await r.json();
  const out = JSON.stringify({ id: u.id, name: u.global_name || u.username, username: u.username,
    avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith('a_') ? 'gif' : 'png'}?size=128` : null });
  ctx.waitUntil(cache.put(key, new Response(out, { headers: Object.assign({}, cors, { 'cache-control': 'public, max-age=3600' }) })));
  return new Response(out, { headers: Object.assign({}, cors, { 'cache-control': 'public, max-age=3600' }) });
}

// ===== CurseForge =====
// Пропускаем только то, что нужно лаунчеру и странице сборки: поиск, мод, файлы, отпечатки.
const CF_ROUTES = [
  ['GET', /^\/mods\/search$/], ['GET', /^\/categories$/], ['GET', /^\/mods\/\d{1,10}$/], ['GET', /^\/mods\/\d{1,10}\/files$/], ['GET', /^\/mods\/\d{1,10}\/files\/\d{1,12}$/],
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
// ===== аккаунты Komori (свой логин и пароль, без почты и телефона) =====
// KV: ka:<id> — аккаунт, kl:<логин> → id, kd:<Discord id> → id, kt:<sha256 токена> → id (сессия, 90 дней),
//     kai:<id> — своя аватарка, kab:<id> — баннер, kr:<id> — код восстановления, kls:<state> → id (привязка Discord),
//     rl:* — счётчики против перебора
const ACC_DAYS = 90;
const ACC_COLORS = { graphite: '#C9CDD3', beige: '#E3D3B4', blue: '#3B82F6', violet: '#8B5CF6', green: '#22C55E', red: '#EF4444', pink: '#EC4899', yellow: '#EAB308', orange: '#F97316' };
const LOGIN_RE = /^[A-Za-z0-9_]{3,16}$/;
const RESERVED = ['admin', 'administrator', 'komori', 'moderator', 'support', 'system', 'server', 'root', 'console'];

function ip(req) { return req.headers.get('cf-connecting-ip') || 'x'; }
async function rateHit(env, key, limit, ttl) {
  const n = Number(await env.SITE.get('rl:' + key)) || 0;
  if (n >= limit) return false;
  await env.SITE.put('rl:' + key, String(n + 1), { expirationTtl: Math.max(60, ttl) });
  return true;
}
async function rateClear(env, key) { await env.SITE.delete('rl:' + key); }

async function pbkdf2(password, saltHex, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16)));
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256)));
}
async function hashPassword(pw) { const s = randomHex(16), i = 100000; return { s, i, h: await pbkdf2(pw, s, i) }; }
async function checkPassword(pw, rec) {
  if (!rec || !rec.s) return false;
  const h = await pbkdf2(pw, rec.s, rec.i || 100000);
  let d = h.length ^ rec.h.length;
  for (let i = 0; i < h.length && i < rec.h.length; i++) d |= h.charCodeAt(i) ^ rec.h.charCodeAt(i);
  return d === 0;
}
function pwProblem(pw, login) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Пароль — минимум 8 символов';
  if (pw.length > 72) return 'Пароль слишком длинный (до 72 символов)';
  if (login && pw.toLowerCase() === String(login).toLowerCase()) return 'Пароль не должен совпадать с логином';
  return '';
}

async function accGet(env, id) { return id ? env.SITE.get('ka:' + id, { type: 'json' }) : null; }
async function accPut(env, a) { a.updated = Date.now(); await env.SITE.put('ka:' + a.id, JSON.stringify(a)); }
async function accByLogin(env, login) { const id = await env.SITE.get('kl:' + String(login || '').toLowerCase()); return accGet(env, id); }

// Токен: из заголовка Authorization (лаунчер) или из cookie ka (сайт)
function accToken(req) {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer ([0-9a-f]{64})$/.exec(h);
  if (m) return { t: m[1], cookie: false };
  const c = parseCookies(req).ka;
  return c && /^[0-9a-f]{64}$/.test(c) ? { t: c, cookie: true } : null;
}
async function currentAccount(req, env) {
  const tk = accToken(req);
  if (!tk) return null;
  const id = await env.SITE.get('kt:' + await sha256hex(tk.t));
  return accGet(env, id);
}
async function newSession(env, id) {
  const t = randomHex(32);
  await env.SITE.put('kt:' + await sha256hex(t), id, { expirationTtl: ACC_DAYS * 86400 });
  return t;
}
function accCookie(t) { return cookie('ka', t, t ? ACC_DAYS * 86400 : 0); }

function accAvatarUrl(a) { return '/acc-av/' + a.id + '?v=' + (a.avatar && a.avatar.v || 0) + (a.avatar && a.avatar.c || ''); }
function accLevel(sec) { const xp = Math.floor((sec || 0) / 60); let L = 1; while (15 * (L + 1) * L <= xp) L++; return L; }
function accPublic(a, own, du) {
  const st = a.stats || {};
  const out = {
    id: a.id, login: a.login, avatar: accAvatarUrl(a), avatarType: a.avatar ? a.avatar.t : 'd', avatarColor: a.avatar && a.avatar.c || 'violet',
    banner: a.banner ? '/acc-ban/' + a.id + '?v=' + a.banner : null,
    status: a.status || '', bio: a.bio || '', links: a.links || {},
    since: new Date(a.created).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
    stats: { total: st.total || 0, komori: st.komori || 0, launches: st.launches || 0, level: accLevel(st.total) },
    badges: du ? badges(du) : [],
    discord: a.discord && (own || a.showDiscord) ? { name: a.discord.name } : null
  };
  if (own) { out.age = a.age; out.showDiscord = !!a.showDiscord; out.discordLinked = !!a.discord; out.created = a.created; }
  return out;
}

// Discord-запись (роли для значков и прав админа) привязанного аккаунта
async function linkedDiscordUser(env, ctx, a) {
  if (!a || !a.discord) return null;
  const u = await env.SITE.get('u:' + a.discord.id, { type: 'json' });
  if (u && env.DISCORD_BOT_TOKEN && Date.now() - (u.rolesAt || 0) > ROLE_REFRESH_MS) {
    ctx.waitUntil(guildMember(env, u.id).then(mem => {
      u.rolesAt = Date.now();
      if (mem) { u.roles = mem.roles || []; u.nick = mem.nick || null; } else u.roles = [];
      return env.SITE.put('u:' + u.id, JSON.stringify(u));
    }).catch(() => {}));
  }
  return u;
}

async function readJson(req) { try { return await req.json(); } catch { return null; } }

async function accRegister(req, env) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const b = await readJson(req);
  if (!b) return json({ error: 'Неверные данные' }, 400);
  const login = String(b.login || '').trim(), age = Number(b.age);
  if (!LOGIN_RE.test(login)) return json({ error: 'Логин: 3–16 символов, латиница, цифры и _' }, 400);
  if (RESERVED.includes(login.toLowerCase())) return json({ error: 'Этот логин занят' }, 400);
  const pe = pwProblem(b.password, login);
  if (pe) return json({ error: pe }, 400);
  if (!Number.isInteger(age) || age < 5 || age > 100) return json({ error: 'Укажи возраст числом' }, 400);
  if (!await rateHit(env, 'reg:' + ip(req), 5, 3600)) return json({ error: 'Слишком много регистраций с этого адреса, попробуй через час' }, 429);
  if (await env.SITE.get('kl:' + login.toLowerCase())) return json({ error: 'Этот логин занят' }, 409);
  const colors = Object.keys(ACC_COLORS);
  const a = { id: Date.now().toString(36) + randomHex(4), login, pass: await hashPassword(b.password), age, created: Date.now(),
    avatar: { t: 'd', c: colors[crypto.getRandomValues(new Uint8Array(1))[0] % colors.length], v: 1 }, banner: 0, status: '', bio: '', links: {}, discord: null, showDiscord: false, stats: null };
  await env.SITE.put('kl:' + login.toLowerCase(), a.id);
  await accPut(env, a);
  const t = await newSession(env, a.id);
  return json({ token: t, account: accPublic(a, true) }, 200, { 'set-cookie': accCookie(t) });
}

async function accLogin(req, env) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const b = await readJson(req);
  if (!b) return json({ error: 'Неверные данные' }, 400);
  const login = String(b.login || '').trim().toLowerCase();
  const rk = 'login:' + ip(req) + ':' + login;
  if (!await rateHit(env, rk, 10, 900)) return json({ error: 'Слишком много попыток. Подожди 15 минут' }, 429);
  const a = LOGIN_RE.test(login) ? await accByLogin(env, login) : null;
  if (!a || !await checkPassword(String(b.password || ''), a.pass)) return json({ error: 'Неверный логин или пароль' }, 401);
  await rateClear(env, rk);
  const t = await newSession(env, a.id);
  return json({ token: t, account: accPublic(a, true) }, 200, { 'set-cookie': accCookie(t) });
}

async function accLogout(req, env) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const tk = accToken(req);
  if (tk) await env.SITE.delete('kt:' + await sha256hex(tk.t));
  return new Response(null, { status: 204, headers: { 'set-cookie': accCookie('') } });
}

// Общая обёртка для изменений своего аккаунта
async function accAuthed(req, env, fn) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const a = await currentAccount(req, env);
  if (!a) return json({ error: 'Войди в аккаунт Komori' }, 401);
  return fn(a);
}

async function accSaveMe(req, env) {
  return accAuthed(req, env, async a => {
    const b = await readJson(req);
    if (!b) return json({ error: 'Неверные данные' }, 400);
    const clean = (s, n) => cleanStr(s, n).trim();
    if (b.status !== undefined) a.status = clean(b.status, 60);
    if (b.bio !== undefined) a.bio = clean(b.bio, 300);
    if (b.showDiscord !== undefined) a.showDiscord = !!b.showDiscord;
    if (b.links) {
      const links = {};
      for (const k of Object.keys(LINK_HOSTS)) {
        const v = clean(b.links[k], 200);
        if (!v) continue;
        let x;
        try { x = new URL(v); } catch { return json({ error: `Ссылка ${k} должна начинаться с https://` }, 400); }
        if (x.protocol !== 'https:' || !LINK_HOSTS[k].includes(x.hostname)) return json({ error: `Ссылка ${k} должна вести на ${LINK_HOSTS[k][0]}` }, 400);
        links[k] = x.href;
      }
      a.links = links;
    }
    await accPut(env, a);
    return json(accPublic(a, true));
  });
}

const IMG_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
async function accAvatar(req, env) {
  return accAuthed(req, env, async a => {
    const b = await readJson(req);
    if (!b) return json({ error: 'Неверные данные' }, 400);
    if (b.type === 'default') {
      if (!ACC_COLORS[b.color]) return json({ error: 'Нет такого цвета' }, 400);
      a.avatar = { t: 'd', c: b.color, v: Date.now() };
      await env.SITE.delete('kai:' + a.id);
    } else if (b.type === 'image' || b.type === 'skin') {
      const m = IMG_RE.exec(String(b.data || ''));
      if (!m) return json({ error: 'Аватарка должна быть PNG, JPG или WEBP' }, 400);
      if (m[2].length > 1400000) return json({ error: 'Аватарка больше 1 МБ' }, 400);
      await env.SITE.put('kai:' + a.id, JSON.stringify({ type: m[1], b64: m[2] }));
      a.avatar = { t: b.type === 'skin' ? 's' : 'i', c: a.avatar && a.avatar.c || 'violet', v: Date.now() };
    } else return json({ error: 'Неверные данные' }, 400);
    await accPut(env, a);
    return json(accPublic(a, true));
  });
}
async function accBanner(req, env) {
  return accAuthed(req, env, async a => {
    const b = await readJson(req);
    if (!b) return json({ error: 'Неверные данные' }, 400);
    if (b.data === null) { a.banner = 0; await env.SITE.delete('kab:' + a.id); }
    else {
      const m = IMG_RE.exec(String(b.data || ''));
      if (!m) return json({ error: 'Баннер должен быть PNG, JPG или WEBP' }, 400);
      if (m[2].length > 4200000) return json({ error: 'Баннер больше 3 МБ' }, 400);
      await env.SITE.put('kab:' + a.id, JSON.stringify({ type: m[1], b64: m[2] }));
      a.banner = Date.now();
    }
    await accPut(env, a);
    return json(accPublic(a, true));
  });
}
async function accPassword(req, env) {
  return accAuthed(req, env, async a => {
    const b = await readJson(req);
    if (!b) return json({ error: 'Неверные данные' }, 400);
    if (!await rateHit(env, 'pw:' + a.id, 10, 900)) return json({ error: 'Слишком много попыток, подожди 15 минут' }, 429);
    if (!await checkPassword(String(b.old || ''), a.pass)) return json({ error: 'Старый пароль неверный' }, 400);
    const pe = pwProblem(b.password, a.login);
    if (pe) return json({ error: pe }, 400);
    a.pass = await hashPassword(b.password);
    await accPut(env, a);
    return json({ ok: true });
  });
}
// Время в игре присылает лаунчер — для уровня и цифр в профиле на сайте
async function accStats(req, env) {
  return accAuthed(req, env, async a => {
    const b = await readJson(req);
    const num = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    if (!b) return json({ error: 'Неверные данные' }, 400);
    a.stats = { total: num(b.total, 3.2e8), komori: num(b.komori, 3.2e8), launches: num(b.launches, 1e7), at: Date.now() };
    await accPut(env, a);
    return json({ ok: true });
  });
}

// Базовая аватарка: цвет + знак Komori. Своя — картинка из KV
const LOGO_PATH = 'M16 14 L39 39.5 L39.5 58 L50 62 L60.5 58 L61 39.5 L84 14 L84 58 L64 72.5 L66.5 76.5 L50 93 L33.5 76.5 L36 72.5 L16 58 Z';
function defaultAvatarSvg(color) {
  const c = ACC_COLORS[color] || ACC_COLORS.violet;
  const n = parseInt(c.slice(1), 16), l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  const fg = l > 0.62 ? '#14161A' : '#FFFFFF';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="${c}"/><g transform="translate(22 20) scale(.76)"><path d="${LOGO_PATH}" fill="${fg}" fill-opacity=".92"/><path d="M16 58 L50 62 L84 58 L64 72.5 L66.5 76.5 L50 93 L33.5 76.5 L36 72.5 Z" fill="${c}" fill-opacity=".25"/></g></svg>`;
}
async function accImage(env, id, kind) {
  if (kind === 'av') {
    const a = await accGet(env, id);
    if (!a) return text('not found', 404);
    if (!a.avatar || a.avatar.t === 'd') return new Response(defaultAvatarSvg(a.avatar && a.avatar.c), { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
  }
  return newsImage(env, id, kind === 'av' ? 'kai:' : 'kab:');
}

// ----- привязка Discord: состояние на 10 минут (из лаунчера или с сайта) -----
async function accDiscordStart(req, env, url) {
  return accAuthed(req, env, async a => {
    const s = randomHex(16);
    await env.SITE.put('kls:' + s, a.id, { expirationTtl: 600 });
    return json({ url: url.origin + '/auth/link?s=' + s });
  });
}
async function accDiscordUnlink(req, env) {
  return accAuthed(req, env, async a => {
    if (a.discord) await env.SITE.delete('kd:' + a.discord.id);
    a.discord = null; a.showDiscord = false;
    await accPut(env, a);
    return json(accPublic(a, true));
  });
}

// ----- забыл пароль: код в личку Discord от бота -----
async function accRecoverStart(req, env) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const b = await readJson(req);
  const a = b && LOGIN_RE.test(String(b.login || '')) ? await accByLogin(env, b.login) : null;
  if (!a) return json({ error: 'Такого аккаунта нет' }, 404);
  if (!a.discord) return json({ error: 'К аккаунту не привязан Discord. Напиши админу в Discord — он сбросит пароль.' }, 400);
  if (!await rateHit(env, 'rec:' + a.id, 3, 900)) return json({ error: 'Код уже отправлен. Новый можно запросить через 15 минут' }, 429);
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  await env.SITE.put('kr:' + a.id, JSON.stringify({ h: await sha256hex(code), tries: 0 }), { expirationTtl: 900 });
  const ch = await fetch('https://discord.com/api/v10/users/@me/channels', { method: 'POST', headers: { authorization: 'Bot ' + env.DISCORD_BOT_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ recipient_id: a.discord.id }) });
  const chj = ch.ok ? await ch.json() : null;
  const msg = chj && await fetch(`https://discord.com/api/v10/channels/${chj.id}/messages`, { method: 'POST', headers: { authorization: 'Bot ' + env.DISCORD_BOT_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ content: `Код для смены пароля аккаунта Komori **${a.login}**: **${code}**\nДействует 15 минут. Если ты его не запрашивал, просто ничего не делай.` }) });
  if (!msg || !msg.ok) return json({ error: 'Бот не смог написать тебе в личку. Открой личные сообщения от участников сервера Komori в Discord и попробуй снова.' }, 502);
  return json({ ok: true, discord: a.discord.name });
}
async function accRecoverFinish(req, env) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const b = await readJson(req);
  const a = b && LOGIN_RE.test(String(b.login || '')) ? await accByLogin(env, b.login) : null;
  if (!a) return json({ error: 'Такого аккаунта нет' }, 404);
  const r = await env.SITE.get('kr:' + a.id, { type: 'json' });
  if (!r) return json({ error: 'Код истёк — запроси новый' }, 400);
  if (r.tries >= 5) { await env.SITE.delete('kr:' + a.id); return json({ error: 'Слишком много ошибок — запроси новый код' }, 429); }
  if (await sha256hex(String(b.code || '').trim()) !== r.h) {
    r.tries++; await env.SITE.put('kr:' + a.id, JSON.stringify(r), { expirationTtl: 900 });
    return json({ error: 'Неверный код' }, 400);
  }
  const pe = pwProblem(b.password, a.login);
  if (pe) return json({ error: pe }, 400);
  a.pass = await hashPassword(b.password);
  await accPut(env, a);
  await env.SITE.delete('kr:' + a.id);
  const t = await newSession(env, a.id);
  return json({ token: t, account: accPublic(a, true) }, 200, { 'set-cookie': accCookie(t) });
}

// ----- для админов: найти аккаунт, сбросить пароль, убрать картинки -----
async function accAdmin(req, env, ctx, action, url) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const u = await currentUser(req, env, ctx);
  if (!isNewsAdmin(u, env)) return json({ error: 'Нет прав' }, 403);
  if (action === 'find') {
    const a = await accByLogin(env, url.searchParams.get('login'));
    if (!a) return json({ error: 'Аккаунт не найден' }, 404);
    return json(Object.assign(accPublic(a, true), { discordName: a.discord ? a.discord.name : null }));
  }
  const b = await readJson(req);
  const a = b && await accGet(env, String(b.id || ''));
  if (!a) return json({ error: 'Аккаунт не найден' }, 404);
  if (action === 'reset') {
    const tmp = randomHex(5);
    a.pass = await hashPassword(tmp);
    await accPut(env, a);
    return json({ password: tmp });
  }
  if (action === 'clear') {
    a.avatar = { t: 'd', c: a.avatar && a.avatar.c || 'violet', v: Date.now() }; a.banner = 0; a.status = ''; a.bio = '';
    await env.SITE.delete('kai:' + a.id); await env.SITE.delete('kab:' + a.id);
    await accPut(env, a);
    return json(accPublic(a, true));
  }
  return json({ error: 'Неизвестное действие' }, 400);
}

// ===== Друзья и «в сети» =====
// KV: kf:<id> → { f: [id], i: [id входящих заявок], o: [id исходящих] }; kp:<id> → { at, game } (где сейчас игрок, видят только друзья)
const FR_MAX = 200, FR_PENDING = 50, PRESENCE_ONLINE_MS = 4 * 60 * 1000;
async function frGet(env, id) { const d = await env.SITE.get('kf:' + id, { type: 'json' }); return { f: (d && d.f) || [], i: (d && d.i) || [], o: (d && d.o) || [] }; }
async function frPut(env, id, d) { await env.SITE.put('kf:' + id, JSON.stringify(d)); }
const frWithout = (arr, id) => arr.filter(x => x !== id);
function frCard(a) { return { login: a.login, avatar: accAvatarUrl(a), level: accLevel((a.stats || {}).total), status: a.status || '' }; }
async function frList(env, a) {
  const d = await frGet(env, a.id);
  const load = ids => Promise.all(ids.slice(0, FR_MAX).map(id => accGet(env, id)));
  const [fa, ia, oa] = await Promise.all([load(d.f), load(d.i), load(d.o)]);
  const pres = await Promise.all(d.f.slice(0, FR_MAX).map(id => env.SITE.get('kp:' + id, { type: 'json' })));
  const now = Date.now();
  const friends = fa.map((x, n) => {
    if (!x) return null;
    const pr = pres[n] || null, online = !!(pr && !pr.off && now - pr.at < PRESENCE_ONLINE_MS);
    return Object.assign(frCard(x), { online, game: online && pr.game ? pr.game : null, seen: pr ? pr.at : null });
  }).filter(Boolean).sort((x, y) => (y.online - x.online) || (!!y.game - !!x.game) || ((y.seen || 0) - (x.seen || 0)) || x.login.localeCompare(y.login));
  return { friends, incoming: ia.filter(Boolean).map(frCard), outgoing: oa.filter(Boolean).map(frCard) };
}
async function accFriends(req, env, action) {
  return accAuthed(req, env, async a => {
    if (action === 'list') return json(await frList(env, a));
    const b = await readJson(req);
    const login = String((b && b.login) || '').trim();
    if (!LOGIN_RE.test(login)) return json({ error: 'Неверный логин' }, 400);
    const t = await accByLogin(env, login);
    if (!t) return json({ error: 'Игрока с логином «' + login + '» нет' }, 404);
    if (t.id === a.id) return json({ error: 'Себя добавить нельзя' }, 400);
    const [me, them] = await Promise.all([frGet(env, a.id), frGet(env, t.id)]);
    if (action === 'add') {
      if (!await rateHit(env, 'fr:' + a.id, 30, 3600)) return json({ error: 'Слишком много заявок, подожди час' }, 429);
      if (me.f.includes(t.id)) return json({ error: t.login + ' уже у тебя в друзьях' }, 400);
      if (me.i.includes(t.id)) action = 'accept';   // он уже звал — просто дружим
      else {
        if (me.o.includes(t.id)) return json({ error: 'Заявка уже отправлена' }, 400);
        if (me.f.length >= FR_MAX || me.o.length >= FR_PENDING) return json({ error: 'Слишком много друзей и заявок' }, 400);
        if (them.i.length >= FR_PENDING) return json({ error: 'У игрока слишком много заявок, попробуй позже' }, 400);
        me.o.push(t.id); them.i.push(a.id);
        await Promise.all([frPut(env, a.id, me), frPut(env, t.id, them)]);
        return json(Object.assign({ ok: 'Заявка отправлена ' + t.login }, await frList(env, a)));
      }
    }
    if (action === 'accept') {
      if (!me.i.includes(t.id)) return json({ error: 'Заявки от ' + t.login + ' нет' }, 400);
      if (me.f.length >= FR_MAX || them.f.length >= FR_MAX) return json({ error: 'Слишком много друзей' }, 400);
      me.i = frWithout(me.i, t.id); me.o = frWithout(me.o, t.id); them.o = frWithout(them.o, a.id); them.i = frWithout(them.i, a.id);
      if (!me.f.includes(t.id)) me.f.push(t.id);
      if (!them.f.includes(a.id)) them.f.push(a.id);
      await Promise.all([frPut(env, a.id, me), frPut(env, t.id, them)]);
      return json(Object.assign({ ok: t.login + ' теперь в друзьях' }, await frList(env, a)));
    }
    if (action === 'remove') {   // убрать из друзей, отклонить или отменить заявку
      me.f = frWithout(me.f, t.id); me.i = frWithout(me.i, t.id); me.o = frWithout(me.o, t.id);
      them.f = frWithout(them.f, a.id); them.i = frWithout(them.i, a.id); them.o = frWithout(them.o, a.id);
      await Promise.all([frPut(env, a.id, me), frPut(env, t.id, them)]);
      return json(await frList(env, a));
    }
    return json({ error: 'Неизвестное действие' }, 400);
  });
}
// Лаунчер раз в пару минут сообщает, что игрок в сети и во что играет
async function accPresence(req, env) {
  return accAuthed(req, env, async a => {
    const b = await readJson(req) || {};
    const game = typeof b.game === 'string' ? b.game.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) : '';
    // offline — лаунчер закрылся: время запоминаем как «был в сети», но уже не в сети
    await env.SITE.put('kp:' + a.id, JSON.stringify(b.offline ? { at: Date.now(), off: 1 } : { at: Date.now(), game }), { expirationTtl: 60 * 86400 });
    return json({ ok: true });
  });
}

async function accRoutes(req, env, ctx, url, p, m) {
  if (p === '/api/acc/register' && m === 'POST') return accRegister(req, env);
  if (p === '/api/acc/login' && m === 'POST') return accLogin(req, env);
  if (p === '/api/acc/logout' && m === 'POST') return accLogout(req, env);
  if (p === '/api/acc/me' && m === 'GET') {
    const a = await currentAccount(req, env);
    return a ? json(accPublic(a, true, await linkedDiscordUser(env, ctx, a)), 200, { 'cache-control': 'no-store' }) : json({ error: 'Не выполнен вход' }, 401);
  }
  if (p === '/api/acc/me' && m === 'PUT') return accSaveMe(req, env);
  if (p === '/api/acc/avatar' && m === 'POST') return accAvatar(req, env);
  if (p === '/api/acc/banner' && m === 'POST') return accBanner(req, env);
  if (p === '/api/acc/password' && m === 'POST') return accPassword(req, env);
  if (p === '/api/acc/stats' && m === 'POST') return accStats(req, env);
  if (p === '/api/acc/discord' && m === 'POST') return accDiscordStart(req, env, url);
  if (p === '/api/acc/discord' && m === 'DELETE') return accDiscordUnlink(req, env);
  if (p === '/api/acc/recover' && m === 'POST') return accRecoverStart(req, env);
  if (p === '/api/acc/recover/finish' && m === 'POST') return accRecoverFinish(req, env);
  if (p === '/api/acc/friends' && m === 'GET') return accFriends(req, env, 'list');
  if (p === '/api/acc/presence' && m === 'POST') return accPresence(req, env);
  let r = p.match(/^\/api\/acc\/friends\/(add|accept|remove)$/);
  if (r && m === 'POST') return accFriends(req, env, r[1]);
  r = p.match(/^\/api\/acc\/admin\/(find|reset|clear)$/);
  if (r) return accAdmin(req, env, ctx, r[1], url);
  r = p.match(/^\/api\/acc\/u\/([A-Za-z0-9_]{3,16})$/);
  if (r && m === 'GET') {
    const a = await accByLogin(env, r[1]);
    return a ? json(accPublic(a, false, await linkedDiscordUser(env, ctx, a))) : json({ error: 'Не найден' }, 404);
  }
  r = p.match(/^\/acc-def\/([a-z]{3,10})$/);
  if (r && m === 'GET' && ACC_COLORS[r[1]]) return new Response(defaultAvatarSvg(r[1]), { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
  r = p.match(/^\/acc-(av|ban)\/([a-z0-9]{8,24})$/);
  if (r && m === 'GET') return accImage(env, r[2], r[1]);
  // Привязка Discord: /auth/link?s=<state> (из лаунчера) или /auth/link с входом на сайте
  if (p === '/auth/link' && m === 'GET') {
    let s = url.searchParams.get('s');
    if (!s || !/^[0-9a-f]{32}$/.test(s) || !await env.SITE.get('kls:' + s)) {
      const a = await currentAccount(req, env);
      if (!a) return redirect('/login?next=/profile');
      s = randomHex(16);
      await env.SITE.put('kls:' + s, a.id, { expirationTtl: 600 });
    }
    return login(url, env, 'L' + s, '/profile');
  }
  return null;
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
