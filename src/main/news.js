'use strict';
// Новости: Minecraft (лента официального лаунчера Mojang) и Komori (сайт komori.fun).
// В интерфейс уходят id, заголовок, картинка; ссылку открывает main-процесс по id —
// и только на minecraft.net / komori.fun.
const UA = 'KomoriLauncher';
const MOJANG = 'https://launchercontent.mojang.com';
const TTL = 20 * 60 * 1000;
const cache = { mc: null, komori: null };
const links = new Map(); // id -> url

function safeUrl(u, hosts) {
  try {
    const x = new URL(String(u || ''));
    if (x.protocol !== 'https:') return '';
    return hosts.some(h => x.hostname === h || x.hostname.endsWith('.' + h)) ? x.href : '';
  } catch { return ''; }
}

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

function kindOf(e) {
  const s = [e.category, e.tag].concat(e.newsType || []).join(' ').toLowerCase();
  if (/snapshot|снапшот|pre-release|release candidate/.test(String(e.title || '').toLowerCase())) return 'snap';
  if (/java/.test(s)) return 'java';
  if (/bedrock/.test(s)) return 'bedrock';
  return 'other';
}

async function minecraft(force) {
  if (!force && cache.mc && Date.now() - cache.mc.at < TTL) return cache.mc.list;
  const j = await getJson(MOJANG + '/v2/news.json');
  const list = (Array.isArray(j.entries) ? j.entries : [])
    .filter(e => e && e.title)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 24)
    .map((e, i) => {
      const id = 'mc' + i;
      const url = safeUrl(e.readMoreLink, ['minecraft.net']) || 'https://www.minecraft.net/ru-ru/articles';
      links.set(id, url);
      const img = e.newsPageImage || e.playPageImage || {};
      const src = img.url ? (String(img.url).startsWith('http') ? safeUrl(img.url, ['launchercontent.mojang.com']) : MOJANG + (String(img.url).startsWith('/') ? '' : '/') + img.url) : '';
      return { id, title: String(e.title).slice(0, 140), text: String(e.text || '').slice(0, 260), tag: String(e.tag || e.category || 'Minecraft').slice(0, 40), date: e.date || '', image: src, kind: kindOf(e) };
    });
  cache.mc = { at: Date.now(), list };
  return list;
}

async function komori(site, force) {
  const base = safeUrl(site, ['komori.fun']);
  if (!base) return [];
  if (!force && cache.komori && Date.now() - cache.komori.at < TTL) return cache.komori.list;
  const origin = new URL(base).origin;
  const j = await getJson(origin + '/api/news');
  const CATS = { news: 'Новости', devblog: 'Девблог', update: 'Обновление', giveaway: 'Розыгрыш', tech: 'Техработы', fix: 'Исправления' };
  const list = (Array.isArray(j) ? j : []).slice(0, 12).map(n => {
    const nid = String(n.id || '').replace(/[^a-z0-9]/g, '');
    const id = 'ko' + nid;
    links.set(id, origin + '/news#' + nid);
    return { id, title: String(n.title || '').slice(0, 140), text: String(n.excerpt || '').slice(0, 220), tag: CATS[n.category] || 'Новости', date: n.created || 0,
      pinned: !!n.pinned, image: n.image ? origin + '/news-img/' + nid : '' };
  });
  cache.komori = { at: Date.now(), list };
  return list;
}

function linkFor(id) { return links.get(String(id)) || ''; }

module.exports = { minecraft, komori, linkFor };
