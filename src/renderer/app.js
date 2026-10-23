'use strict';
/* Komori Launcher — интерфейс. Без фреймворков: состояние + render(). */
const K = window.komori;

const S = {
  info: { dev: false, version: '', server: { host: 'mc.komori.fun', port: 25565 } },
  settings: null, profiles: { list: [], selected: null }, accounts: { list: [], selected: null },
  versions: null, versionsError: null,
  screen: 'home', menuOpen: false,
  busy: false, prog: null, inGame: false,
  vType: 'release', vSearch: '', vInstalling: null,
  sTab: 'general', renaming: null, msCode: null, devName: '',
  log: '', form: null,
  skin: { loading: false, info: null, error: null, forId: null, busy: false },
  update: null, crash: null,
  srv: { status: null, loading: false, built: null, warnings: [], profileId: null, busy: false },
  manual: null,
  mods: { profileId: null, source: 'modrinth', tab: 'catalog', type: 'mod', query: '', sort: 'relevance', hits: [], total: 0, offset: 0,
    loading: false, error: null, needLoader: false, mc: '', loader: '', items: [], updates: null, checking: false, busy: {} }
};

// ---------- утилиты ----------
const $ = (sel) => document.querySelector(sel);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function iconSrc(name) { return 'assets/icons/' + encodeURIComponent(name || 'grass') + '.png'; }
function errText(e) { return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
const LOADER_NAMES = { vanilla: 'Vanilla', fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' };
const TYPE_NAMES = { release: 'Релиз', snapshot: 'Снапшот', old_beta: 'Бета', old_alpha: 'Альфа' };
const TYPE_COLORS = { release: 'var(--ok)', snapshot: 'var(--warn)', old_beta: 'var(--t-beta)', old_alpha: 'var(--t-alpha)' };
const TYPE_ICONS = { release: 'grass', snapshot: 'potion', old_beta: 'pickaxe', old_alpha: 'chest' };
const ICONS = ['pickaxe', 'sword', 'fish', 'bat', 'orb', 'grass', 'diamond', 'heart', 'star', 'crown', 'chest', 'potion', 'book',
  'axe', 'bow', 'skull', 'mushroom', 'tree', 'flame', 'snow', 'moon', 'amethyst', 'shield', 'compass', 'rod', 'portal'];

function mcLabel(v) { return v === 'latest-release' ? 'последний релиз' : v === 'latest-snapshot' ? 'последний снапшот' : v; }
function profMeta(p) { return (p.loader === 'vanilla' ? 'Vanilla' : LOADER_NAMES[p.loader] + (p.loaderVersion ? ' ' + p.loaderVersion : '')) + ' · ' + mcLabel(p.mcVersion); }
function selectedProfile() { return S.profiles.list.find(p => p.id === S.profiles.selected) || S.profiles.list[0]; }
function selectedAccount() { return S.accounts.list.find(a => a.id === S.accounts.selected); }
function ago(ts) {
  if (!ts) return 'ещё не запускался';
  const d = Math.floor((Date.now() - ts) / 86400000);
  return d <= 0 ? 'Сегодня' : d === 1 ? 'Вчера' : d + ' дн. назад';
}

let toastTimer = null;
function toast(msg, ok) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (ok ? ' ok' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 6000);
}

// ---------- иконки меню ----------
const NAV = [
  ['home', 'Главная', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/></svg>'],
  ['profiles', 'Профили', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>'],
  ['versions', 'Версии', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/></svg>'],
  ['mods', 'Моды', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 3h4v3a2 2 0 1 0 0 0h4v4h-3a2 2 0 1 1 0 4h3v4h-4v-3a2 2 0 1 0-4 0v3H6v-4h3a2 2 0 1 0 0-4H6V6h4z"/></svg>'],
  ['settings', 'Настройки', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>']
];
const PLAY_SVG = '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M6 4l15 8-15 8z" fill="currentColor"/></svg>';
const CHEVRON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>';
const SEARCH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
const MS_LOGO = '<svg width="17" height="17" viewBox="0 0 24 24"><rect x="2" y="2" width="9" height="9" fill="#F25022"/><rect x="13" y="2" width="9" height="9" fill="#7FBA00"/><rect x="2" y="13" width="9" height="9" fill="#00A4EF"/><rect x="13" y="13" width="9" height="9" fill="#FFB900"/></svg>';

// ===== Тема лаунчера (п.3) =====
// settings.theme: 'system' | 'dark' | 'light'. «Системная» следит за Windows через matchMedia.
const darkMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  const mode = (S.settings && S.settings.theme) || 'system';
  const dark = mode === 'dark' || (mode === 'system' && (!darkMq || darkMq.matches));
  document.body.classList.toggle('theme-dark', dark);
  document.body.classList.toggle('theme-light', !dark);
}
if (darkMq && darkMq.addEventListener) darkMq.addEventListener('change', applyTheme);
const THEME_NAMES = [['light', 'Светлая'], ['dark', 'Тёмная'], ['system', 'Системная']];

// ===== Ссылки: Discord (п.4), сайт (п.5), соцсети (п.6) =====
// Адреса знает только main-процесс; здесь только id, название и иконка из renderer/icons/.
function linkIcon(icon, cls) { return `<img class="${cls || ''}" src="icons/${encodeURIComponent(icon || 'link')}.svg" alt="" width="18" height="18">`; }
function links() { return (S.info && S.info.links) || { discord: null, website: null, social: [] }; }
function socialBlock() {
  const soc = links().social;
  if (!soc.length) return '';
  return `<div class="panel" style="padding:16px;gap:12px"><b style="color:var(--title)">Соцсети</b><div class="social">${soc.map(l =>
    `<button type="button" data-act="openLink" data-id="${esc(l.id)}">${linkIcon(l.icon, 'ico')}${esc(l.name)}</button>`).join('')}</div></div>`;
}

// ---------- отрисовка ----------
function renderSide() {
  $('#nav').innerHTML = NAV.map(([id, label, svg]) =>
    `<button type="button" data-act="nav" data-id="${id}" class="${S.screen === id ? 'on' : ''}" ${S.screen === id ? 'aria-current="page"' : ''}>${svg}${label}</button>`).join('');
  const a = selectedAccount();
  $('#accChip').innerHTML = a
    ? `<span class="avatar">${esc(a.name.charAt(0).toUpperCase())}</span><span class="meta"><b>${esc(a.name)}</b><span>● ${a.type === 'dev' ? 'DEV-вход' : a.type === 'offline' ? 'Офлайн' : 'Microsoft'}</span></span>`
    : `<span class="avatar">?</span><span class="meta"><b>Нет аккаунта</b><span class="none">Нажми, чтобы войти</span></span>`;
  $('#devBadge').classList.toggle('hidden', !S.info.dev);
  // п.4–5: кнопки Discord и «Сайт» в боковой панели, скрыты если ссылки пустые
  const L = links(), sl = $('#sideLinks');
  const sideBtns = [L.discord, L.website].filter(Boolean);
  sl.innerHTML = sideBtns.map(l => `<button type="button" data-act="openLink" data-id="${esc(l.id)}">${linkIcon(l.icon, 'ico')}${esc(l.name)}</button>`).join('');
  sl.classList.toggle('hidden', !sideBtns.length);
  const u = S.update || {};
  const ub = $('#updBanner');
  if (u.state === 'ready') { ub.innerHTML = `<b>Обновление ${esc(u.version)} готово</b><button type="button" class="btn" data-act="updInstall">Перезапустить</button>`; ub.classList.remove('hidden'); }
  else if (u.state === 'downloading') { ub.innerHTML = `<span>Скачиваю обновление ${esc(u.version)}… ${u.percent || 0}%</span><div class="bar"><div style="width:${u.percent || 0}%"></div></div>`; ub.classList.remove('hidden'); }
  else ub.classList.add('hidden');
}

function playState() {
  if (S.inGame) return { cls: 'ingame', label: 'В игре' };
  if (S.busy) return { cls: 'busy', label: 'Запуск…' };
  return { cls: '', label: 'Играть' };
}

function progressHtml() {
  if (!S.busy && !S.prog) return '';
  const p = S.prog || { stage: 'Подготовка', done: 0, total: 0 };
  const pct = p.total ? Math.floor(p.done / p.total * 100) : 0;
  const txt = p.total ? `${p.stage}: ${p.done} из ${p.total}` : p.stage + '…';
  return `<div class="progress"><div class="row"><b>${esc(txt)}</b><span>${pct}%</span></div><div class="bar"><div style="width:${pct}%"></div></div></div>`;
}

function viewHome() {
  const p = selectedProfile();
  const ps = playState();
  const menu = S.menuOpen ? `<div class="pmenu">${S.profiles.list.map(x =>
    `<button type="button" data-act="pickProfile" data-id="${esc(x.id)}" class="${x.id === (p && p.id) ? 'on' : ''}"><img class="pix" src="${iconSrc(x.icon)}" alt="" width="28" height="28"><span class="t"><b>${esc(x.name)}</b><span>${esc(profMeta(x))}</span></span></button>`).join('')}
    <button type="button" data-act="newProfile"><span class="t"><b>+ Новый профиль</b></span></button></div>` : '';
  return `<section class="hero">
    <img class="hero-img" src="assets/hero.jpg" alt="">
    <div class="hero-fade"></div>
    <div class="hero-body">
      <h1><span class="k">K</span>omori</h1>
      <p>Любая версия Minecraft.<br>Твои профили.</p>
      <div class="play-row">
        <button type="button" class="play ${ps.cls}" data-act="play">${PLAY_SVG}${ps.label}</button>
        <button type="button" class="play-more" data-act="toggleMenu" aria-label="Выбрать профиль">${CHEVRON}</button>
      </div>
      ${p ? `<button type="button" class="pselect" data-act="toggleMenu"><img class="pix" src="${iconSrc(p.icon)}" alt="" width="34" height="34"><span class="t"><b>${esc(p.name)}</b><span>${esc(profMeta(p))}</span></span>${CHEVRON}</button>` : ''}
      ${menu}
      ${progressHtml()}
    </div>
    <div class="server-pill"><span class="dot"></span><b>${esc(S.info.server.host)}</b><button type="button" data-act="playServer">Играть на Komori</button></div>
    ${links().social.length ? `<div class="social-home">${links().social.map(l => `<button type="button" data-act="openLink" data-id="${esc(l.id)}" title="${esc(l.name)}" aria-label="${esc(l.name)}">${linkIcon(l.icon)}</button>`).join('')}</div>` : ''}
  </section>`;
}

function viewProfiles() {
  const cards = S.profiles.list.map(p => `<div class="pcard ${p.id === S.profiles.selected ? 'on' : ''}">
    <img class="pix" src="${iconSrc(p.icon)}" alt="" width="52" height="52">
    <div class="t"><b>${esc(p.name)}${p.managed ? ' <span class="tag ok">Сервер</span>' : ''}</b><span>${esc(profMeta(p))}</span><small>${p.managed ? 'Сборку задают админы, обновляется сама' : 'Последний запуск: ' + esc(ago(p.lastPlayed))}</small></div>
    ${p.managed ? '' : `<button type="button" class="icon-btn" data-act="editProfile" data-id="${esc(p.id)}" aria-label="Изменить"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>`}
    <button type="button" class="icon-btn" data-act="openProfileDir" data-id="${esc(p.id)}" aria-label="Открыть папку"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 6h6l2 2h10v11H3z"/></svg></button>
    <button type="button" class="icon-btn primary" data-act="playProfile" data-id="${esc(p.id)}" aria-label="Играть"><svg width="15" height="15" viewBox="0 0 24 24"><path d="M6 4l15 8-15 8z" fill="currentColor"/></svg></button>
  </div>`).join('');
  return `<section class="page"><div class="page-head"><h1>Профили</h1><button type="button" class="btn" data-act="newProfile">+ Новый профиль</button></div><div class="grid3">${cards}</div></section>`;
}

function versionsFiltered() {
  if (!S.versions) return [];
  const q = S.vSearch.trim().toLowerCase();
  return S.versions.versions.filter(v => v.type === S.vType && (!q || v.id.toLowerCase().includes(q)));
}

function viewVersions() {
  let body;
  if (S.versionsError) body = `<div class="empty">Не удалось загрузить список версий: ${esc(S.versionsError)}<br><br><button type="button" class="btn2" data-act="reloadVersions">Повторить</button></div>`;
  else if (!S.versions) body = `<div class="empty">Загружаю список версий…</div>`;
  else {
    const list = versionsFiltered();
    body = list.length ? list.slice(0, 400).map((v, i) => {
      const installing = S.vInstalling === v.id;
      return `<div class="vrow"><img class="pix" src="${iconSrc(TYPE_ICONS[v.type])}" alt="" width="30" height="30">
        <span class="t"><b>${esc(v.id)}</b><span style="color:${TYPE_COLORS[v.type]}">${TYPE_NAMES[v.type]}${i === 0 && !S.vSearch ? ' · последняя' : ''} · ${esc((v.releaseTime || '').slice(0, 10))}</span></span>
        <span class="st">${v.installed ? 'Установлена' : ''}</span>
        <button type="button" class="btn2" data-act="installVersion" data-id="${esc(v.id)}" ${S.busy ? 'disabled' : ''}>${installing ? 'Скачиваю…' : v.installed ? 'Проверить' : 'Скачать'}</button>
        <button type="button" class="btn" data-act="profileFromVersion" data-id="${esc(v.id)}" data-type="${esc(v.type)}">Профиль</button></div>`;
    }).join('') : `<div class="empty">Ничего не найдено</div>`;
  }
  const counts = t => (S.versions ? S.versions.versions.filter(v => v.type === t).length : '');
  const chips = Object.keys(TYPE_NAMES).map(t => `<button type="button" class="chip ${S.vType === t ? 'on' : ''}" data-act="vType" data-id="${t}">${t === 'release' ? 'Релизы' : t === 'snapshot' ? 'Снапшоты' : TYPE_NAMES[t]} <span class="n">${counts(t)}</span></button>`).join('');
  return `<section class="page" style="overflow:hidden"><h1>Версии</h1>
    <div class="search">${SEARCH}<input type="search" id="vSearch" placeholder="Поиск версии…" value="${esc(S.vSearch)}" aria-label="Поиск версии"></div>
    <div class="chips">${chips}</div>
    ${S.vInstalling ? progressHtml() : ''}
    <div class="list">${body}</div></section>`;
}

const MTYPES = { mod: 'Моды', resourcepack: 'Ресурспаки', shader: 'Шейдеры', modpack: 'Сборки' };
const SOURCE_NAMES = { modrinth: 'Modrinth', curseforge: 'CurseForge', manual: 'вручную' };
const MTYPE_ONE = { mod: 'Мод', resourcepack: 'Ресурспак', shader: 'Шейдер' };
function fmtNum(n) { return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n); }
function modIcon(url, title) {
  return url && /^https:\/\/(cdn\.modrinth\.com|media\.forgecdn\.net)\//.test(url)
    ? `<img class="micon" src="${esc(url)}" alt="" loading="lazy">`
    : `<span class="micon letter">${esc((title || '?').charAt(0).toUpperCase())}</span>`;
}
function modsProfile() { return S.profiles.list.find(p => p.id === S.mods.profileId) || selectedProfile(); }

function viewMods() {
  const M = S.mods;
  const p = modsProfile();
  if (!p) return `<section class="page"><h1>Моды</h1><div class="soon">Сначала создай профиль.</div></section>`;
  const options = S.profiles.list.map(x => `<option value="${esc(x.id)}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)} — ${esc(profMeta(x))}</option>`).join('');
  const installedKeys = new Set(M.items.filter(i => i.projectId).map(i => i.projectId));
  const tabs = `<div class="tabs" role="tablist">
    <button type="button" role="tab" aria-selected="${M.tab === 'catalog'}" class="${M.tab === 'catalog' ? 'on' : ''}" data-act="mTab" data-id="catalog">Каталог Modrinth</button>
    <button type="button" role="tab" aria-selected="${M.tab === 'installed'}" class="${M.tab === 'installed' ? 'on' : ''}" data-act="mTab" data-id="installed">Установленные (${M.items.length})</button></div>`;
  let body;
  if (M.tab === 'catalog') {
    const chips = Object.keys(MTYPES).map(t => `<button type="button" class="chip ${M.type === t ? 'on' : ''}" data-act="mType" data-id="${t}">${MTYPES[t]}</button>`).join('');
    const srcSeg = `<div class="src-seg">${['modrinth', 'curseforge'].map(s => `<button type="button" class="${M.source === s ? 'on' : ''}" data-act="mSource" data-id="${s}">${SOURCE_NAMES[s]}</button>`).join('')}</div>`;
    const isPack = M.type === 'modpack';
    let list;
    if (M.needKey) {
      list = `<div class="empty">Каталог CurseForge ещё не настроен.<br>Получи бесплатный ключ API на console.curseforge.com и впиши его в komori.config.json → curseforgeApiKey.</div>`;
    } else if (M.needLoader && !isPack) {
      list = `<div class="empty">У профиля «${esc(p.name)}» нет ядра, а моды работают только с ним.<br>Создай профиль с Fabric, Forge, NeoForge или Quilt.<br><br><button type="button" class="btn" data-act="newProfile">+ Новый профиль</button></div>`;
    } else if (M.error) {
      list = `<div class="empty">${esc(M.error)}<br><br><button type="button" class="btn2" data-act="mRetry">Повторить</button></div>`;
    } else if (!M.hits.length) {
      list = `<div class="empty">${M.loading ? 'Ищу на Modrinth…' : 'Ничего не найдено'}</div>`;
    } else {
      list = M.hits.map(h => {
        const inst = !isPack && installedKeys.has(h.id);
        const busy = M.busy[h.id];
        const label = inst ? 'Установлен' : busy ? esc(busy) : isPack ? 'Установить сборку' : 'Установить';
        return `<div class="mrow">${modIcon(h.icon, h.title)}
          <div class="t"><button type="button" class="mtitle" data-act="mOpen" data-id="${esc(h.slug)}" data-type="${esc(h.type)}" data-url="${esc(h.website || '')}">${esc(h.title)}</button>
          <span class="mby">${esc(h.author)} · ${fmtNum(h.downloads)} загрузок</span>
          <span class="mdesc">${esc(h.description)}</span></div>
          <button type="button" class="${inst ? 'btn-inst' : 'btn'}" data-act="mInstall" data-id="${esc(h.id)}" data-title="${esc(h.title)}" ${inst || busy || (isPack && S.busy) ? 'disabled' : ''}>${label}</button></div>`;
      }).join('') + (M.hits.length < M.total ? `<div style="padding:14px;text-align:center"><button type="button" class="btn2" data-act="mMore" ${M.loading ? 'disabled' : ''}>${M.loading ? 'Загружаю…' : 'Показать ещё'}</button></div>` : '');
    }
    const forWhat = M.type === 'mod' ? `${LOADER_NAMES[p.loader]} ${M.mc}` : `Minecraft ${M.mc}`;
    const hint = isPack
      ? `<span class="note">Сборка ставится в новый профиль со своим ядром и версией.</span>`
      : (M.mc ? `<span class="note">Показаны только подходящие для ${esc(forWhat)}. Зависимости ставятся сами.</span>` : '');
    body = `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">${srcSeg}<div class="chips">${chips}</div><span class="grow"></span>
        ${isPack ? `<button type="button" class="btn2" data-act="mImport" ${S.busy ? 'disabled' : ''}>Импорт из файла</button>` : ''}</div>
      ${isPack && S.busy ? progressHtml() : ''}
      <div style="display:flex;gap:10px"><div class="search" style="flex:1">${SEARCH}<input type="search" id="modsQuery" placeholder="Поиск на Modrinth…" value="${esc(M.query)}" aria-label="Поиск на Modrinth"></div>
      <select id="modsSort" class="input" aria-label="Сортировка">${[['relevance', 'По совпадению'], ['downloads', 'Популярные'], ['follows', 'Избранные'], ['newest', 'Новые'], ['updated', 'Обновлённые']].map(([v, l]) => `<option value="${v}" ${M.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${hint}
      <div class="list">${list}</div>`;
  } else {
    const upd = M.updates || [];
    const updMap = {}; upd.forEach(u => { updMap[u.key] = u; });
    const rows = M.items.length ? M.items.map(it => {
      const u = updMap[it.key];
      const busy = M.busy[it.key];
      return `<div class="mrow ${it.enabled ? '' : 'off'}">${modIcon(it.icon, it.title)}
        <div class="t"><b class="mtitle-static">${esc(it.title)}</b><span class="mby">${esc(MTYPE_ONE[it.type])}${it.version ? ' · ' + esc(it.version) : ''} · ${esc(SOURCE_NAMES[it.source] || 'вручную')}</span><span class="mdesc">${esc(it.file)}</span></div>
        ${u ? `<button type="button" class="btn" data-act="mUpdate" data-id="${esc(it.key)}" ${busy ? 'disabled' : ''}>${busy ? 'Обновляю…' : 'Обновить до ' + esc(u.to)}</button>` : ''}
        ${sw(it.enabled, 'mToggle').replace('data-act="mToggle"', `data-act="mToggle" data-id="${esc(it.key)}" aria-label="Включён"`)}
        <button type="button" class="icon-btn" data-act="mRemove" data-id="${esc(it.key)}" aria-label="Удалить"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--danger-text)" stroke-width="2.2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button></div>`;
    }).join('') : `<div class="empty">Пока ничего не установлено. Найди моды во вкладке «Каталог Modrinth».</div>`;
    body = `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn2" data-act="mCheck" ${M.checking ? 'disabled' : ''}>${M.checking ? 'Проверяю…' : 'Проверить обновления'}</button>
        ${upd.length ? `<button type="button" class="btn" data-act="mUpdateAll">Обновить всё (${upd.length})</button>` : M.updates ? '<span class="note">Все моды актуальны</span>' : ''}
        <span class="grow"></span>
        <button type="button" class="btn2" data-act="mFolder" data-id="mod">Папка mods</button>
        <button type="button" class="btn2" data-act="mFolder" data-id="resourcepack">Ресурспаки</button>
        <button type="button" class="btn2" data-act="mFolder" data-id="shader">Шейдеры</button></div>
      <div class="list">${rows}</div>`;
  }
  return `<section class="page" style="overflow:hidden">
    <div class="page-head"><h1>Моды</h1><select id="modsProfile" class="input" aria-label="Профиль" style="max-width:420px">${options}</select></div>
    ${tabs}${body}</section>`;
}

let modsSearchTimer = null;
async function modsSearch(reset) {
  const M = S.mods;
  const p = modsProfile();
  if (!p) return;
  M.profileId = p.id;
  if (reset) { M.offset = 0; M.hits = []; }
  M.loading = true; M.error = null; render();
  try {
    const r = await K.mods.search({ source: M.source, profileId: p.id, query: M.query, type: M.type, sort: M.sort, offset: M.offset });
    M.needLoader = !!r.needLoader; M.needKey = !!r.needKey; M.mc = r.mc || M.mc; M.total = r.total;
    M.hits = reset ? r.hits : M.hits.concat(r.hits);
  } catch (e) { M.error = errText(e); }
  M.loading = false;
  if (S.screen === 'mods') render();
}
// Установка сборки: новый профиль, прогресс в каталоге, список ручных загрузок при необходимости.
async function installPack(run, busyId) {
  if (S.busy) return;
  S.busy = true; S.prog = { stage: 'Скачиваю сборку', done: 0, total: 0 };
  if (busyId) S.mods.busy[busyId] = 'Устанавливаю…';
  render();
  try {
    const r = await run();
    if (r) {
      S.profiles = r.profiles;
      S.mods.profileId = r.profileId;
      toast('Сборка «' + r.name + '» установлена — новый профиль выбран', true);
      if (r.manual && r.manual.length) S.manual = { title: 'Эти файлы автор разрешил скачивать только с сайта', items: r.manual, profileId: r.profileId };
      modsLoadInstalled();
    }
  } catch (e) { toast(errText(e)); }
  S.busy = false; S.prog = null;
  if (busyId) delete S.mods.busy[busyId];
  render(); renderManual();
}

function renderManual() {
  const m = $('#manual');
  if (!S.manual) { m.classList.add('hidden'); m.innerHTML = ''; return; }
  m.innerHTML = `<div class="dialog" role="dialog" aria-label="Ручная загрузка" style="width:640px">
    <div class="dialog-head"><h2>${esc(S.manual.title)}</h2><button type="button" class="icon-btn" data-act="manualClose" aria-label="Закрыть"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6"/></svg></button></div>
    <p class="note" style="margin:0">Автор запретил скачивание этих файлов в сторонних лаунчерах. Открой страницу, скачай файл и положи его в папку mods профиля.</p>
    <div class="list" style="max-height:320px">${S.manual.items.map((it, i) => `<div class="mrow"><div class="t"><b class="mtitle-static">${esc(it.title)}</b></div>${it.url ? `<button type="button" class="btn2" data-act="manualOpen" data-id="${i}">Открыть страницу</button>` : ''}</div>`).join('')}</div>
    <div class="dialog-foot"><button type="button" class="btn2" data-act="manualFolder">Открыть папку mods</button><button type="button" class="btn" data-act="manualClose">Готово</button></div></div>`;
  m.classList.remove('hidden');
}

async function modsLoadInstalled() {
  const p = modsProfile();
  if (!p) return;
  try { S.mods.items = await K.mods.list(p.id); } catch (e) { toast(errText(e)); }
  if (S.screen === 'mods') render();
}

function sw(on, act) { return `<button type="button" role="switch" aria-checked="${on}" class="switch ${on ? 'on' : ''}" data-act="${act}"></button>`; }

function viewSettings() {
  const st = S.settings || {};
  const tabList = [['general', 'Общие'], ['java', 'Java и память'], ['account', 'Аккаунт']];
  if (S.info.dev) tabList.push(['server', 'Сервер (админ)']);
  const tabs = tabList.map(([id, l]) =>
    `<button type="button" role="tab" aria-selected="${S.sTab === id}" class="${S.sTab === id ? 'on' : ''}" data-act="sTab" data-id="${id}">${l}</button>`).join('');
  let body = '';
  if (S.sTab === 'general') {
    body = `<div class="panel">
      <div class="prow"><span>Тема</span><div class="theme-seg" role="radiogroup" aria-label="Тема">${THEME_NAMES.map(([id, l]) =>
        `<button type="button" role="radio" aria-checked="${(st.theme || 'system') === id}" class="${(st.theme || 'system') === id ? 'on' : ''}" data-act="setTheme" data-id="${id}">${l}</button>`).join('')}</div></div>
      <div class="prow"><span>Сворачивать лаунчер при запуске игры</span>${sw(!!st.minimizeOnLaunch, 'toggleMinimize')}</div>
      <div class="prow"><span>Показывать консоль игры</span>${sw(!!st.showConsole, 'toggleConsole')}</div>
      <div class="prow"><span>Папка игры</span><span style="display:flex;gap:10px;align-items:center"><code>${esc(st.gameDir)}</code><button type="button" class="btn2" data-act="openGameDir">Открыть</button></span></div>
      <div class="prow"><span>Версия лаунчера</span><span>${esc(S.info.version)}${S.info.dev ? ' · DEV' : ''}</span></div>
      <div class="prow"><span>Обновления</span><span style="display:flex;gap:10px;align-items:center"><span class="note">${esc(updText())}</span>${S.update && S.update.state !== 'off' ? `<button type="button" class="btn2" data-act="updCheck">Проверить</button>` : ''}${S.update && S.update.state === 'ready' ? `<button type="button" class="btn" data-act="updInstall">Установить</button>` : ''}</span></div>
    </div>
    ${socialBlock()}
    ${st.showConsole ? `<div class="console" id="console">${esc(S.log || 'Здесь появится вывод игры после запуска.')}</div>` : ''}`;
  } else if (S.sTab === 'java') {
    body = `<div class="panel">
      <div class="prow" style="flex-direction:column;align-items:stretch;gap:10px"><div style="display:flex;justify-content:space-between"><span>Память для игры</span><b class="disp" id="ramLabel">${st.ram} ГБ</b></div>
      <input type="range" id="ram" min="1" max="16" step="1" value="${st.ram}" aria-label="Память"></div>
      <div class="prow"><span>Java скачивается автоматически</span><span class="tag ok">Вкл</span></div>
      <div class="prow note">Лаунчер сам берёт у Mojang нужную Java: Java 8 для альф, бет и старых версий, Java 17 для 1.17–1.20.4, Java 21+ для новых.</div>
    </div>`;
  } else if (S.sTab === 'server' && S.info.dev) {
    body = viewServerAdmin();
  } else {
    const rows = S.accounts.list.map(a => {
      const on = a.id === S.accounts.selected;
      const renaming = S.renaming === a.id;
      return `<div class="acc-row ${on ? 'on' : ''}">
        <span class="avatar">${esc(a.name.charAt(0).toUpperCase())}</span>
        <span class="t"><b>${esc(a.name)}</b><span>${a.type === 'dev' ? 'Тестовый вход (только DEV-сборка)' : a.type === 'offline' ? 'Офлайн-аккаунт (работает при входе Microsoft)' : 'Аккаунт Microsoft'}</span></span>
        ${a.type === 'dev' ? '<span class="tag dev">DEV</span>' : ''}
        ${on ? '<span class="tag ok">Активный</span>' : `<button type="button" class="btn" data-act="useAccount" data-id="${esc(a.id)}">Использовать</button>`}
        <button type="button" class="btn2" data-act="renameStart" data-id="${esc(a.id)}">Сменить ник</button>
        <button type="button" class="btn-ghost" data-act="removeAccount" data-id="${esc(a.id)}">Удалить</button>
      </div>${renaming ? `<div class="codebox"><div class="field"><label for="newNick">Новый ник</label><input class="input" id="newNick" maxlength="16" value="${esc(a.name)}"></div>
        <span class="note">${a.type === 'microsoft' ? 'Ник Microsoft-аккаунта меняется в Mojang, не чаще раза в 30 дней.' : '3–16 символов: латиница, цифры и _.'}</span>
        <div style="display:flex;gap:8px"><button type="button" class="btn" data-act="renameSave" data-id="${esc(a.id)}">Сохранить</button><button type="button" class="btn2" data-act="renameCancel">Отмена</button></div></div>` : ''}`;
    }).join('');
    const code = S.msCode ? `<div class="codebox"><span>Открой страницу входа Microsoft и введи код:</span><span class="code">${esc(S.msCode.userCode)}</span>
      <div style="display:flex;gap:8px;align-items:center"><button type="button" class="btn2" data-act="msOpen">Открыть страницу</button><button type="button" class="btn2" data-act="msCopy">Скопировать код</button><button type="button" class="btn-ghost" data-act="msCancel">Отмена</button><span class="note">Жду подтверждения…</span></div></div>` : '';
    const hasMs = S.accounts.list.some(x => x.type === 'microsoft');
    const dev = (hasMs || S.info.dev) ? `<div class="codebox" style="border-color:${hasMs ? 'var(--line4)' : '#8A6A2A'}"><div class="field"><label for="devName">${hasMs ? 'Офлайн-аккаунт' : 'DEV: тестовый вход'}</label><input class="input" id="devName" maxlength="16" placeholder="${hasMs ? 'Ник для офлайн-аккаунта' : 'Ник для теста'}" value="${esc(S.devName)}"></div>
      <div style="display:flex;gap:8px;align-items:center"><button type="button" class="${hasMs ? 'btn2' : 'btn-dev'}" data-act="devLogin">${hasMs ? '+ Добавить офлайн-аккаунт' : 'Войти для теста'}</button><span class="note">${hasMs ? 'Доступно, потому что ты вошёл через Microsoft с купленной игрой.' : 'Есть только в тестовой сборке.'}</span></div></div>`
      : `<span class="note">Офлайн-аккаунты можно добавить после входа через Microsoft.</span>`;
    body = `<div style="display:flex;flex-direction:column;gap:12px">${rows || '<div class="note">Аккаунтов пока нет.</div>'}
      ${skinPanel()}
      ${code}
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn-ms" data-act="msLogin">${MS_LOGO}Войти через Microsoft</button></div>
      ${S.info.hasMsClient ? '' : '<span class="note">Вход Microsoft заработает, когда в komori.config.json будет указан msClientId и Mojang одобрит доступ к API.</span>'}
      ${dev}</div>`;
  }
  return `<section class="page"><h1>Настройки</h1><div class="tabs" role="tablist">${tabs}</div>${body}</section>`;
}

// ---------- обновления и вылеты ----------
function updText() {
  const u = S.update;
  if (!u || u.state === 'off') return S.info.dev ? 'В DEV-сборке автообновление выключено' : 'Работает в установленной версии лаунчера';
  return { checking: 'Проверяю…', latest: 'Установлена последняя версия', downloading: 'Скачиваю ' + (u.version || '') + '… ' + (u.percent || 0) + '%', ready: 'Версия ' + u.version + ' скачана — установится при перезапуске', error: 'Ошибка: ' + (u.error || '') }[u.state] || '';
}

function renderCrash() {
  const m = $('#crash');
  const c = S.crash;
  if (!c) { m.classList.add('hidden'); m.innerHTML = ''; return; }
  const title = c.error ? 'Игра не запустилась' : 'Игра вылетела';
  m.innerHTML = `<div class="dialog" role="dialog" aria-label="${title}" style="width:600px">
    <div class="dialog-head"><h2>${title}</h2><button type="button" class="icon-btn" data-act="crashClose" aria-label="Закрыть"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6"/></svg></button></div>
    <div class="panel" style="padding:14px;gap:6px"><span class="note">Код выхода: ${esc(c.code)}</span><b style="color:var(--title);user-select:text">${esc(c.error || c.reason || 'Причина не определена — подробности в логе')}</b></div>
    ${c.sent ? `<div class="codebox" style="border-color:#2E7D4F"><b style="color:var(--ok)">Отчёт отправлен админам</b><span class="note">Спасибо! Админы посмотрят лог в Discord.</span></div>`
      : c.canReport ? `<div class="field"><label for="crashNote">Что ты делал перед вылетом? (необязательно)</label><textarea id="crashNote" class="input" rows="3" maxlength="1000" placeholder="Например: зашёл в Незер, открыл сундук…">${esc(c.note)}</textarea></div>
        <span class="note">Админам уйдут: ник, профиль, версия, ядро, список модов и логи игры. Пароли и токены не отправляются.</span>`
      : `<span class="note">Отправка отчётов не настроена. Открой лог и отправь его админам в Discord вручную.</span>`}
    <div class="dialog-foot"><button type="button" class="btn2" data-act="crashLog">Открыть лог</button>
      <div style="display:flex;gap:8px"><button type="button" class="btn2" data-act="crashClose">Закрыть</button>
      ${c.canReport && !c.sent ? `<button type="button" class="btn" data-act="crashSend" ${c.sending ? 'disabled' : ''}>${c.sending ? 'Отправляю…' : 'Отправить админам'}</button>` : ''}</div></div></div>`;
  m.classList.remove('hidden');
}

// ---------- сборка сервера (админ, DEV) ----------
function manifestSummary(m) {
  return `${esc(m.name)} · ${esc(LOADER_NAMES[m.loader] || m.loader)}${m.loaderVersion ? ' ' + esc(m.loaderVersion) : ''} · Minecraft ${esc(m.minecraft)} · файлов: ${m.files.length}`;
}

function viewServerAdmin() {
  const V = S.srv;
  const own = S.profiles.list.filter(p => !p.managed);
  const pid = V.profileId && own.some(p => p.id === V.profileId) ? V.profileId : (own[0] && own[0].id);
  const status = V.loading ? '<span class="note">Проверяю…</span>'
    : !V.status ? '' : !V.status.url
      ? `<span class="note">Ссылка на сборку не задана: впиши serverManifestUrl в komori.config.json. Пока её нет, «Играть на Komori» запускает выбранный профиль.</span>`
      : V.status.error ? `<span class="note">${esc(V.status.url)}<br>Ошибка: ${esc(V.status.error)}</span>`
        : `<span class="note">${esc(V.status.url)}</span><b style="color:var(--title)">${manifestSummary(V.status.manifest)}</b><span class="note">Обновлена: ${esc((V.status.manifest.updated || '').replace('T', ' ').slice(0, 16))}</span>`;
  const built = V.built ? `<div class="panel" style="padding:16px;gap:10px">
      <b style="color:var(--title)">${manifestSummary(V.built)}</b>
      ${V.warnings.length ? `<div class="codebox" style="border-color:#8A6A2A"><b style="color:var(--warn)">Не попало в сборку (${V.warnings.length})</b>${V.warnings.map(w => `<span class="note">${esc(w)}</span>`).join('')}</div>` : ''}
      <div class="list" style="max-height:220px">${V.built.files.map(f => `<div class="mrow"><div class="t"><b class="mtitle-static">${esc(f.title)}</b><span class="mdesc">${esc(f.path)}</span></div></div>`).join('') || '<div class="empty">Без модов</div>'}</div>
      <div style="display:flex;gap:8px"><button type="button" class="btn" data-act="srvSave">Сохранить komori-server.json</button></div>
      <span class="note">Загрузи файл по ссылке из serverManifestUrl (сайт, GitHub и т. п.) — у всех игроков сборка обновится при следующем «Играть на Komori».</span></div>` : '';
  return `<div style="display:flex;flex-direction:column;gap:14px">
    <div class="panel" style="padding:16px;gap:6px"><b style="color:var(--title)">Сборка сервера сейчас</b>${status}
      <button type="button" class="btn2" data-act="srvLoad" style="align-self:flex-start;margin-top:6px">Обновить</button></div>
    <div class="panel" style="padding:16px;gap:10px"><b style="color:var(--title)">Собрать новую из профиля</b>
      <span class="note">Настрой обычный профиль: версия, ядро, моды и ресурспаки из каталога. Выключенные моды в сборку не попадут.</span>
      <div style="display:flex;gap:10px;align-items:center"><select id="srvProfile" class="input" aria-label="Профиль" style="flex:1">${own.map(p => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)} — ${esc(profMeta(p))}</option>`).join('')}</select>
      <button type="button" class="btn" data-act="srvBuild" data-id="${esc(pid || '')}" ${V.busy || !pid ? 'disabled' : ''}>${V.busy ? 'Собираю…' : 'Собрать'}</button></div></div>
    ${built}</div>`;
}

async function srvLoad() {
  S.srv.loading = true; render();
  try { S.srv.status = await K.server.status(); } catch (e) { S.srv.status = { url: '?', error: errText(e) }; }
  S.srv.loading = false; render();
}

// ---------- скин ----------
function skinPanel() {
  const a = selectedAccount();
  if (!a) return '';
  if (a.type !== 'microsoft') return `<div class="panel" style="padding:16px"><b style="color:var(--title)">Скин</b><span class="note">Скины для офлайн-аккаунтов появятся в следующей версии.</span></div>`;
  const sk = S.skin;
  if (sk.forId !== a.id || sk.loading) return `<div class="panel" style="padding:16px"><span class="note">Загружаю скин…</span></div>`;
  if (sk.error) return `<div class="panel" style="padding:16px;gap:8px"><span class="note">${esc(sk.error)}</span><button type="button" class="btn2" data-act="skinReload" style="align-self:flex-start">Повторить</button></div>`;
  const info = sk.info || {};
  const variant = sk.variant || (info.skin && info.skin.variant) || 'classic';
  const capes = info.capes || [];
  const active = capes.find(c => c.active);
  return `<div class="skinbox">
    <canvas id="skinCanvas" width="128" height="256" aria-label="Скин игрока ${esc(a.name)}"></canvas>
    <div style="flex:1;display:flex;flex-direction:column;gap:12px">
      <b style="color:var(--title);font-size:17px">Скин ${esc(info.name || a.name)}</b>
      <div class="field"><label>Модель рук</label><div class="chips">
        <button type="button" class="chip ${variant === 'classic' ? 'on' : ''}" data-act="skinVariant" data-id="classic">Классическая (4 px)</button>
        <button type="button" class="chip ${variant === 'slim' ? 'on' : ''}" data-act="skinVariant" data-id="slim">Тонкая (3 px)</button></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn" data-act="skinUpload" data-id="${variant}" ${sk.busy ? 'disabled' : ''}>${sk.busy ? 'Загружаю…' : 'Загрузить PNG'}</button>
        <button type="button" class="btn2" data-act="skinReset" ${sk.busy ? 'disabled' : ''}>Сбросить на стандартный</button></div>
      <span class="note">PNG 64×64 (или старый 64×32). Новый скин виден в игре после перезахода.</span>
      ${capes.length ? `<div class="field"><label for="capeSel">Плащ</label><select id="capeSel" class="input" ${sk.busy ? 'disabled' : ''}>
        <option value="">Без плаща</option>${capes.map(c => `<option value="${esc(c.id)}" ${active && active.id === c.id ? 'selected' : ''}>${esc(c.alias || c.id)}</option>`).join('')}</select></div>` : '<span class="note">Плащей на аккаунте нет.</span>'}
    </div></div>`;
}

async function loadSkin(force) {
  const a = selectedAccount();
  if (!a || a.type !== 'microsoft') return;
  if (!force && S.skin.forId === a.id && S.skin.info) return;
  S.skin = { loading: true, info: null, error: null, forId: a.id, busy: false };
  render();
  try { S.skin.info = await K.accounts.skinGet(a.id); }
  catch (e) { S.skin.error = errText(e); }
  S.skin.loading = false;
  render();
}

async function skinAction(run) {
  S.skin.busy = true; render();
  try { const info = await run(); if (info) { S.skin.info = info; toast('Готово', true); } }
  catch (e) { toast(errText(e)); }
  S.skin.busy = false; render();
}

// Вид спереди: голова, тело, руки, ноги + второй слой.
function drawSkin(canvas, dataUrl, slim) {
  if (!canvas || !canvas.getContext || !dataUrl) return;
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    const s = 8;
    const modern = img.height === 64;
    const aw = slim ? 3 : 4;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const part = (sx, sy, w, h, dx, dy, mirror) => {
      if (mirror) {
        ctx.save(); ctx.scale(-1, 1);
        ctx.drawImage(img, sx, sy, w, h, -(dx + w) * s, dy * s, w * s, h * s);
        ctx.restore();
      } else ctx.drawImage(img, sx, sy, w, h, dx * s, dy * s, w * s, h * s);
    };
    const ax = 4 - aw;
    part(8, 8, 8, 8, 4, 0);                       // голова
    part(20, 20, 8, 12, 4, 8);                    // тело
    part(44, 20, aw, 12, ax, 8);                  // правая рука
    if (modern) part(36, 52, aw, 12, 12, 8); else part(44, 20, aw, 12, 12, 8, true);
    part(4, 20, 4, 12, 4, 20);                    // правая нога
    if (modern) part(20, 52, 4, 12, 8, 20); else part(4, 20, 4, 12, 8, 20, true);
    part(40, 8, 8, 8, 4, 0);                      // шапка
    if (modern) {
      part(20, 36, 8, 12, 4, 8);                  // куртка
      part(44, 36, aw, 12, ax, 8);
      part(52, 52, aw, 12, 12, 8);
      part(4, 36, 4, 12, 4, 20);
      part(4, 52, 4, 12, 8, 20);
    }
  };
  img.src = dataUrl;
}

function render() {
  renderSide();
  const v = { home: viewHome, profiles: viewProfiles, versions: viewVersions, mods: viewMods, settings: viewSettings }[S.screen] || viewHome;
  const focused = document.activeElement && document.activeElement.id;
  const caret = focused && document.activeElement.selectionStart;
  $('#view').innerHTML = v();
  if (focused) {
    const el = document.getElementById(focused);
    if (el) { el.focus(); try { if (caret != null) el.setSelectionRange(caret, caret); } catch {} }
  }
  const c = $('#console');
  if (c) c.scrollTop = c.scrollHeight;
  const cv = document.getElementById('skinCanvas');
  if (cv && S.skin.info && S.skin.info.skinData) drawSkin(cv, S.skin.info.skinData, S.skin.info.skin && S.skin.info.skin.variant === 'slim');
}

// ---------- модальное окно профиля ----------
function openForm(profile, preset) {
  const p = profile || {};
  let mcType = 'release';
  const mc = p.mcVersion || (preset && preset.mcVersion) || 'latest-release';
  if (preset && preset.type) mcType = preset.type;
  else if (S.versions) { const f = S.versions.versions.find(v => v.id === mc); if (f) mcType = f.type; }
  S.form = { id: p.id || null, name: p.name || (preset ? 'Minecraft ' + preset.mcVersion : 'Новый профиль'), icon: p.icon || 'orb', loader: p.loader || 'vanilla', loaderVersion: p.loaderVersion || '', mcVersion: mc, mcType, ram: p.ram || 0, lv: null };
  if (!S.versions) loadVersions();
  renderForm();
  loadLoaderVersions();
}

// Версии ядра для выбранной версии Minecraft.
let lvRequest = 0;
async function loadLoaderVersions() {
  const f = S.form;
  if (!f || f.loader === 'vanilla' || !f.mcVersion) { if (f) { f.lv = null; renderForm(); } return; }
  const my = ++lvRequest;
  f.lv = { loading: true, list: [], error: null };
  renderForm();
  try {
    const r = await K.loaders.list(f.loader, f.mcVersion);
    if (my !== lvRequest || !S.form) return;
    S.form.lv = { loading: false, list: r.list, error: null, mc: r.mc };
    if (S.form.loaderVersion && !r.list.some(x => x.id === S.form.loaderVersion)) S.form.loaderVersion = '';
  } catch (e) {
    if (my !== lvRequest || !S.form) return;
    S.form.lv = { loading: false, list: [], error: errText(e) };
  }
  renderForm();
}

function renderForm() {
  const f = S.form;
  const m = $('#modal');
  if (!f) { m.classList.add('hidden'); m.innerHTML = ''; return; }
  const icons = ICONS.map(i => `<button type="button" class="${f.icon === i ? 'on' : ''}" data-act="fIcon" data-id="${i}" aria-label="${i}"><img class="pix" src="${iconSrc(i)}" alt=""></button>`).join('');
  const loaders = Object.keys(LOADER_NAMES).map(l => `<button type="button" class="${f.loader === l ? 'on' : ''}" data-act="fLoader" data-id="${l}">${LOADER_NAMES[l]}</button>`).join('');
  let lvBox;
  if (f.loader === 'vanilla') lvBox = `<div class="pick-list empty" style="display:flex;align-items:center;justify-content:center">Чистый Minecraft — ядро не нужно</div>`;
  else if (!f.lv || f.lv.loading) lvBox = `<div class="pick-list empty">Загружаю версии ${esc(LOADER_NAMES[f.loader])}…</div>`;
  else if (f.lv.error) lvBox = `<div class="pick-list empty">${esc(f.lv.error)}</div>`;
  else if (!f.lv.list.length) lvBox = `<div class="pick-list empty">${esc(LOADER_NAMES[f.loader])} нет для Minecraft ${esc(f.lv.mc || f.mcVersion)}</div>`;
  else lvBox = `<div class="pick-list"><button type="button" class="${!f.loaderVersion ? 'on' : ''}" data-act="fLv" data-id=""><span>Авто — рекомендуемая</span></button>${f.lv.list.slice(0, 300).map(v =>
    `<button type="button" class="${f.loaderVersion === v.id ? 'on' : ''}" data-act="fLv" data-id="${esc(v.id)}"><span>${esc(v.id)}</span><span style="font-size:12px;color:var(--ok)">${esc(v.tag)}</span></button>`).join('')}</div>`;
  const types = Object.keys(TYPE_NAMES).map(t => `<button type="button" class="chip ${f.mcType === t ? 'on' : ''}" data-act="fType" data-id="${t}">${t === 'release' ? 'Релизы' : t === 'snapshot' ? 'Снапшоты' : TYPE_NAMES[t]}</button>`).join('');
  let vers = '<div class="empty">Загружаю…</div>';
  if (S.versions) {
    const latest = f.mcType === 'release' ? [{ id: 'latest-release', label: 'Всегда последний релиз' }] : f.mcType === 'snapshot' ? [{ id: 'latest-snapshot', label: 'Всегда последний снапшот' }] : [];
    const list = latest.concat(S.versions.versions.filter(v => v.type === f.mcType).map(v => ({ id: v.id, label: v.id })));
    vers = list.map(v => `<button type="button" class="${f.mcVersion === v.id ? 'on' : ''}" data-act="fVersion" data-id="${esc(v.id)}"><span>${esc(v.label)}</span></button>`).join('');
  } else if (S.versionsError) vers = `<div class="empty">${esc(S.versionsError)}</div>`;
  m.innerHTML = `<div class="dialog" role="dialog" aria-label="${f.id ? 'Изменить профиль' : 'Новый профиль'}">
    <div class="dialog-head"><h2>${f.id ? 'Изменить профиль' : 'Новый профиль'}</h2><button type="button" class="icon-btn" data-act="fClose" aria-label="Закрыть"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6"/></svg></button></div>
    <div style="display:flex;gap:14px;align-items:flex-end"><img class="pix" src="${iconSrc(f.icon)}" alt="" width="64" height="64" style="padding:6px;border-radius:12px;background:var(--side);border:2px solid #8B3DFF">
      <div class="field" style="flex:1"><label for="fName">Название</label><input class="input" id="fName" maxlength="32" value="${esc(f.name)}"></div></div>
    <div class="field"><label>Иконка</label><div class="icon-grid">${icons}</div></div>
    <div class="field"><label>Ядро</label><div class="seg">${loaders}</div></div>
    <div class="two">
      <div class="field"><label>Версия Minecraft</label><div class="chips">${types}</div><div class="pick-list">${vers}</div></div>
      <div class="field"><label>Версия ${esc(LOADER_NAMES[f.loader])}</label><div class="chips" style="min-height:36px"></div>${lvBox}</div>
    </div>
    <div style="display:flex;gap:16px;align-items:center">
      <div class="field" style="flex:1"><label for="fRam" id="fRamLabel">Память профиля: ${f.ram ? f.ram + ' ГБ' : 'как в настройках (' + ((S.settings && S.settings.ram) || 4) + ' ГБ)'}</label>
        <input type="range" id="fRam" min="0" max="16" step="1" value="${f.ram || 0}" aria-label="Память профиля"></div>
      ${f.id ? `<button type="button" class="btn-ghost" data-act="fDelete">Удалить профиль</button>` : ''}
    </div>
    <div class="dialog-foot"><span style="color:var(--text2)">${esc(LOADER_NAMES[f.loader])}${f.loader !== 'vanilla' ? ' ' + esc(f.loaderVersion || '(авто)') : ''} · ${esc(mcLabel(f.mcVersion))}</span>
      <div style="display:flex;gap:8px"><button type="button" class="btn2" data-act="fClose">Отмена</button><button type="button" class="btn" data-act="fSave">${f.id ? 'Сохранить' : 'Создать'}</button></div></div>
  </div>`;
  m.classList.remove('hidden');
  const nameEl = $('#fName');
  if (nameEl && !f._focused) { nameEl.focus(); f._focused = true; }
}

// ---------- действия ----------
async function loadVersions() {
  S.versionsError = null;
  try { S.versions = await K.versions.list(); }
  catch (e) { S.versionsError = errText(e); }
  render(); if (S.form) renderForm();
}

async function launch(profileId, join) {
  if (S.busy || S.inGame) return;
  S.busy = true; S.prog = { stage: 'Подготовка', done: 0, total: 0 }; S.menuOpen = false; S.log = '';
  render();
  try {
    if (profileId) S.profiles = await K.profiles.select(profileId);
    await K.game.launch(profileId || S.profiles.selected, !!join);
    S.inGame = true;
    S.profiles = await K.profiles.get();
  } catch (e) {
    toast(errText(e));
  } finally {
    S.busy = false; S.prog = null; render();
  }
}

const ACTIONS = {
  // п.3: смена темы — сохраняется в settings.json и применяется сразу
  setTheme: async (id) => { S.settings = await K.settings.set({ theme: id }); applyTheme(); render(); },
  // п.4–6: открыть ссылку из конфига во внешнем браузере
  openLink: (id) => { K.openLink(id); },
  nav: (id) => {
    S.screen = id; S.menuOpen = false;
    if (id === 'versions' && !S.versions) loadVersions();
    if (id === 'mods') { S.mods.profileId = S.mods.profileId || S.profiles.selected; S.mods.updates = null; modsLoadInstalled(); modsSearch(true); }
    render();
  },
  mTab: (id) => { S.mods.tab = id; if (id === 'installed') modsLoadInstalled(); render(); },
  mType: (id) => { S.mods.type = id; modsSearch(true); },
  mRetry: () => modsSearch(true),
  mMore: () => { S.mods.offset = S.mods.hits.length; modsSearch(false); },
  mSource: (id) => { S.mods.source = id; modsSearch(true); },
  mOpen: (slug, el) => K.mods.open(S.mods.source, slug, el.dataset.type, el.dataset.url),
  mInstall: async (projectId, el) => {
    const M = S.mods;
    if (M.type === 'modpack') return installPack(() => K.mods.installPack(M.source, projectId, el.dataset.title), projectId);
    M.busy[projectId] = 'Скачиваю…'; render();
    try {
      const r = await K.mods.install(M.source, M.profileId, projectId, M.type);
      M.items = r.items;
      if (r.installed.length > 1) toast('Установлено: ' + r.installed.join(', '), true);
      else if (r.installed.length === 1) toast('Установлен «' + r.installed[0] + '»', true);
      if (r.manual && r.manual.length) S.manual = { title: 'Скачай вручную', items: r.manual, profileId: M.profileId };
    } catch (e) { toast(errText(e)); }
    delete M.busy[projectId]; render(); renderManual();
  },
  mImport: () => installPack(() => K.mods.importPack(), null),
  manualOpen: (i) => { const it = S.manual && S.manual.items[Number(i)]; if (it && it.url) K.mods.open('curseforge', '', '', it.url); },
  manualFolder: () => S.manual && K.mods.openFolder(S.manual.profileId, 'mod'),
  manualClose: () => { S.manual = null; renderManual(); },
  mToggle: async (key) => { try { S.mods.items = await K.mods.toggle(S.mods.profileId, key); } catch (e) { toast(errText(e)); } render(); },
  mRemove: async (key) => {
    try { S.mods.items = await K.mods.remove(S.mods.profileId, key); if (S.mods.updates) S.mods.updates = S.mods.updates.filter(u => u.key !== key); }
    catch (e) { toast(errText(e)); }
    render();
  },
  mCheck: async () => {
    S.mods.checking = true; render();
    try { S.mods.updates = await K.mods.updates(S.mods.profileId); } catch (e) { toast(errText(e)); }
    S.mods.checking = false; render();
  },
  mUpdate: async (key) => {
    const M = S.mods;
    const u = (M.updates || []).find(x => x.key === key);
    if (!u) return;
    M.busy[key] = true; render();
    try { M.items = await K.mods.update(M.profileId, key, u.versionId, u.source); M.updates = M.updates.filter(x => x.key !== key); }
    catch (e) { toast(errText(e)); }
    delete M.busy[key]; render();
  },
  mUpdateAll: async () => { for (const u of (S.mods.updates || []).slice()) await ACTIONS.mUpdate(u.key); toast('Моды обновлены', true); },
  mFolder: (type) => K.mods.openFolder(S.mods.profileId, type),
  toggleMenu: () => { S.menuOpen = !S.menuOpen; render(); },
  pickProfile: async (id) => { S.profiles = await K.profiles.select(id); S.menuOpen = false; render(); },
  play: () => launch(null, false),
  playServer: () => launch(null, true),
  playProfile: (id) => { S.screen = 'home'; if (S.info.serverManifest && id === S.info.serverProfileId) launch(null, true); else launch(id, false); },
  newProfile: () => { S.menuOpen = false; openForm(null); },
  editProfile: (id) => openForm(S.profiles.list.find(p => p.id === id)),
  openProfileDir: (id) => K.profiles.openDir(id),
  profileFromVersion: (id, el) => openForm(null, { mcVersion: id, type: el.dataset.type }),
  reloadVersions: () => loadVersions(),
  vType: (id) => { S.vType = id; render(); },
  installVersion: async (id) => {
    if (S.busy) return;
    S.busy = true; S.vInstalling = id; S.prog = { stage: 'Подготовка', done: 0, total: 0 }; render();
    try { await K.versions.install(id); toast('Версия ' + id + ' скачана', true); S.versions = await K.versions.list(); }
    catch (e) { toast(errText(e)); }
    finally { S.busy = false; S.vInstalling = null; S.prog = null; render(); }
  },
  sTab: (id) => { S.sTab = id; render(); if (id === 'account') loadSkin(); if (id === 'server' && !S.srv.status) srvLoad(); },
  srvLoad: () => srvLoad(),
  updCheck: async () => { try { S.update = await K.update.check(); } catch (e) { toast(errText(e)); } render(); },
  updInstall: async () => { try { await K.update.install(); } catch (e) { toast(errText(e)); } },
  crashClose: () => { S.crash = null; renderCrash(); },
  crashLog: () => K.crash.openLog(),
  crashSend: async () => {
    const c = S.crash; if (!c) return;
    const t = $('#crashNote'); if (t) c.note = t.value;
    c.sending = true; renderCrash();
    try { await K.crash.send(c.note); c.sent = true; } catch (e) { toast(errText(e)); }
    c.sending = false; renderCrash();
  },
  srvBuild: async (pid) => {
    const sel = $('#srvProfile');
    const id = (sel && sel.value) || pid;
    S.srv.profileId = id; S.srv.busy = true; S.srv.built = null; render();
    try { const r = await K.server.build(id); S.srv.built = r.manifest; S.srv.warnings = r.warnings; }
    catch (e) { toast(errText(e)); }
    S.srv.busy = false; render();
  },
  srvSave: async () => {
    try { const p = await K.server.save(S.srv.built); if (p) toast('Сохранено: ' + p, true); }
    catch (e) { toast(errText(e)); }
  },
  skinReload: () => loadSkin(true),
  skinVariant: (id) => { S.skin.variant = id; render(); },
  skinUpload: (variant) => { const a = selectedAccount(); if (a) skinAction(() => K.accounts.skinUpload(a.id, variant)).then(() => { S.skin.variant = null; render(); }); },
  skinReset: () => { const a = selectedAccount(); if (a) skinAction(() => K.accounts.skinReset(a.id)); },
  toggleMinimize: async () => { S.settings = await K.settings.set({ minimizeOnLaunch: !S.settings.minimizeOnLaunch }); render(); },
  toggleConsole: async () => { S.settings = await K.settings.set({ showConsole: !S.settings.showConsole }); render(); },
  openGameDir: () => K.settings.openGameDir(),
  useAccount: async (id) => { S.accounts = await K.accounts.select(id); render(); loadSkin(); },
  removeAccount: async (id) => { S.accounts = await K.accounts.remove(id); render(); },
  renameStart: (id) => { S.renaming = id; render(); },
  renameCancel: () => { S.renaming = null; render(); },
  renameSave: async (id) => {
    const name = ($('#newNick') || {}).value || '';
    try { S.accounts = await K.accounts.rename(id, name.trim()); S.renaming = null; toast('Ник изменён', true); }
    catch (e) { toast(errText(e)); }
    render();
  },
  devLogin: async () => {
    try { S.accounts = await K.accounts.dev(S.devName.trim()); S.devName = ''; toast('Аккаунт добавлен', true); }
    catch (e) { toast(errText(e)); }
    render();
  },
  msLogin: async () => {
    try { S.msCode = await K.accounts.msStart(); }
    catch (e) { toast(errText(e)); }
    render();
  },
  msOpen: () => S.msCode && K.accounts.openCodePage(S.msCode.url),
  msCopy: () => { if (S.msCode) { navigator.clipboard.writeText(S.msCode.userCode); toast('Код скопирован', true); } },
  msCancel: async () => { await K.accounts.msCancel(); S.msCode = null; render(); },
  fClose: () => { S.form = null; renderForm(); },
  fIcon: (id) => { S.form.icon = id; renderForm(); },
  fLoader: (id) => { S.form.loader = id; S.form.loaderVersion = ''; loadLoaderVersions(); },
  fLv: (id) => { S.form.loaderVersion = id || ''; renderForm(); },
  fType: (id) => { S.form.mcType = id; S.form.mcVersion = id === 'release' ? 'latest-release' : id === 'snapshot' ? 'latest-snapshot' : ((S.versions && (S.versions.versions.find(v => v.type === id) || {}).id) || ''); S.form.loaderVersion = ''; loadLoaderVersions(); },
  fVersion: (id) => { S.form.mcVersion = id; S.form.loaderVersion = ''; loadLoaderVersions(); },
  fSave: async () => {
    const f = S.form;
    if (!f.mcVersion) { toast('Выбери версию Minecraft'); return; }
    try {
      if (f.loader !== 'vanilla' && f.lv && !f.lv.loading && !f.lv.error && !f.lv.list.length) { toast(LOADER_NAMES[f.loader] + ' нет для этой версии Minecraft'); return; }
      S.profiles = await K.profiles.save({ id: f.id, name: f.name, icon: f.icon, loader: f.loader, loaderVersion: f.loader === 'vanilla' ? '' : f.loaderVersion, mcVersion: f.mcVersion, ram: f.ram });
      S.form = null; renderForm(); render();
    } catch (e) { toast(errText(e)); }
  },
  fDelete: async () => {
    if (!S.form || !S.form.id) return;
    S.profiles = await K.profiles.remove(S.form.id); S.form = null; renderForm(); render();
  }
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) {
    if (S.menuOpen && !ev.target.closest('.pmenu')) { S.menuOpen = false; render(); }
    return;
  }
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(el.dataset.id, el);
});
$('#accChip').dataset.act = 'goAccount';
ACTIONS.goAccount = () => { S.screen = 'settings'; S.sTab = 'account'; render(); loadSkin(); };

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'vSearch') { S.vSearch = t.value; render(); }
  else if (t.id === 'modsQuery') { S.mods.query = t.value; clearTimeout(modsSearchTimer); modsSearchTimer = setTimeout(() => modsSearch(true), 400); }
  else if (t.id === 'devName') { S.devName = t.value; }
  else if (t.id === 'fName' && S.form) { S.form.name = t.value; }
  else if (t.id === 'fRam' && S.form) {
    S.form.ram = Number(t.value);
    const l = $('#fRamLabel');
    if (l) l.textContent = 'Память профиля: ' + (S.form.ram ? S.form.ram + ' ГБ' : 'как в настройках (' + ((S.settings && S.settings.ram) || 4) + ' ГБ)');
  }
  else if (t.id === 'ram') { const l = $('#ramLabel'); if (l) l.textContent = t.value + ' ГБ'; }
});
document.addEventListener('change', async (ev) => {
  if (ev.target.id === 'ram') { S.settings = await K.settings.set({ ram: Number(ev.target.value) }); }
  if (ev.target.id === 'modsProfile') { S.mods.profileId = ev.target.value; S.mods.updates = null; modsLoadInstalled(); modsSearch(true); }
  if (ev.target.id === 'modsSort') { S.mods.sort = ev.target.value; modsSearch(true); }
  if (ev.target.id === 'srvProfile') { S.srv.profileId = ev.target.value; S.srv.built = null; render(); }
  if (ev.target.id === 'capeSel') { const a = selectedAccount(); const v = ev.target.value; if (a) skinAction(() => K.accounts.capeSet(a.id, v)); }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && S.form) { S.form = null; renderForm(); }
  if (ev.key === 'Enter' && ev.target.id === 'devName') ACTIONS.devLogin();
  if (ev.key === 'Enter' && ev.target.id === 'newNick' && S.renaming) ACTIONS.renameSave(S.renaming);
});

$('#wMin').addEventListener('click', () => K.win.minimize());
$('#wMax').addEventListener('click', () => K.win.maximize());
$('#wClose').addEventListener('click', () => K.win.close());

K.game.onProgress((p) => { S.prog = p; if (S.screen === 'home' || S.screen === 'versions' || (S.screen === 'mods' && S.mods.type === 'modpack')) render(); });
K.game.onLog((text) => {
  S.log = (S.log + text).slice(-60000);
  const c = $('#console');
  if (c) { c.textContent = S.log; c.scrollTop = c.scrollHeight; }
});
K.game.onExit(({ code, error, crash }) => {
  S.inGame = false;
  if (crash) S.crash = { code: error ? -1 : code, error: error || '', reason: crash.reason, canReport: crash.canReport, hasCrashReport: crash.hasCrashReport, note: '', sending: false, sent: false };
  render(); renderCrash();
});
K.update.onState((st) => { S.update = st; renderSide(); if (S.screen === 'settings') render(); });
K.accounts.onMsDone((accs) => { S.accounts = accs; S.msCode = null; toast('Вход выполнен', true); render(); });
K.accounts.onMsError((msg) => { S.msCode = null; toast(msg); render(); });

(async function init() {
  try {
    S.info = await K.info();
    S.settings = await K.settings.get();
    applyTheme();
    S.profiles = await K.profiles.get();
    S.accounts = await K.accounts.get();
    S.update = await K.update.state();
  } catch (e) { toast(errText(e)); }
  render();
  loadVersions();
})();
