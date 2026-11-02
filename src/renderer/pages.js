'use strict';
/* Komori Launcher — разделы Главная (новости Minecraft), Komori, Профиль и «Внешний вид» в настройках. */

const NEWS_FILTERS = [['all', 'Все'], ['java', 'Java'], ['snap', 'Снапшоты'], ['other', 'Другое']];
function fmtDate(d) {
  const t = new Date(d);
  if (isNaN(t)) return '';
  return t.getDate() + ' ' + MONTHS_GEN[t.getMonth()] + (t.getFullYear() !== new Date().getFullYear() ? ' ' + t.getFullYear() : '');
}

// ---------- загрузка данных ----------
async function loadMcNews(force) {
  const N = S.news;
  if (N.mcLoading || (N.mc && !force)) return;
  N.mcLoading = true; N.mcError = null; if (S.screen === 'home') render();
  try { N.mc = await K.news.minecraft(!!force); } catch (e) { N.mcError = errText(e); }
  N.mcLoading = false; if (S.screen === 'home') render();
}
async function loadKomoriNews(force) {
  const N = S.news;
  if (N.koLoading || (N.ko && !force)) return;
  N.koLoading = true; N.koError = null; if (S.screen === 'komori') render();
  try { N.ko = await K.news.komori(!!force); } catch (e) { N.koError = errText(e); }
  N.koLoading = false; if (S.screen === 'komori') render();
}
async function loadStats() {
  try { S.stats = await K.stats(); } catch { S.stats = S.stats || { total: 0, komori: 0, launches: 0, days: {}, hours: {}, profiles: {} }; }
  if (S.screen === 'profile') render();
}
async function loadLook() {
  try { S.look = await K.look.get(); } catch { S.look = { banner: null, avatarBg: null }; }
  refreshAvatar();
}

// Скин для аватарки берём у выбранного аккаунта (Microsoft или офлайн), рисуем 3D и кэшируем
async function refreshAvatar() {
  const a = selectedAccount();
  if (!a) { S.avatar = null; renderSide(); return; }
  let skin = S.skin.forId === a.id && S.skin.info ? S.skin.info.skinData : null;
  if (!skin && a.type !== 'yggdrasil' && !(S.skin.forId === a.id && S.skin.info)) {
    try {
      const info = a.type === 'microsoft' ? await K.accounts.skinGet(a.id) : await K.accounts.offSkinGet(a.id);
      if (!S.skin.info || S.skin.forId !== a.id) S.skin = { loading: false, info, error: null, forId: a.id, busy: false };
      skin = info && info.skinData;
    } catch {}
  }
  const st = S.settings || {};
  const o = { pose: st.avatarPose || 'bust', light: st.avatarLight || 'studio', bg: st.avatarBg || 'glow', color: accentHex(st.avatarColor || st.accent || 'violet', true), bgImage: S.look && S.look.avatarBg };
  if (o.bg === 'image' && !o.bgImage) o.bg = 'glow';
  const keyStr = [a.id, skin ? skin.length + skin.slice(-40) : '', o.pose, o.light, o.bg, o.color, o.bgImage ? o.bgImage.length : 0].join('|');
  if (S.avatar && S.avatar.key === keyStr) return;
  if (!skin) { S.avatar = { key: keyStr, url: null }; renderSide(); if (['profile', 'settings'].includes(S.screen)) render(); return; }
  try { S.avatar = { key: keyStr, url: await renderAvatar(skin, o) }; }
  catch { S.avatar = { key: keyStr, url: null }; }
  renderSide();
  if (['profile', 'settings'].includes(S.screen)) render();
}
function avatarHtml(cls) {
  const a = selectedAccount();
  if (S.avatar && S.avatar.url) return `<span class="${cls}"><img src="${S.avatar.url}" alt=""></span>`;
  return `<span class="${cls} letter">${esc(a ? a.name.charAt(0).toUpperCase() : '?')}</span>`;
}

// ---------- быстрый запуск (на Главной) ----------
function quickLaunch() {
  const p = selectedProfile();
  const ps = playState();
  const menu = homeMenu(p);
  return `<section class="quick card" aria-label="Быстрый запуск">
    ${p ? profIcon(p.icon, 48) : '<span class="q-empty"></span>'}
    <div class="q-t"><span class="lbl">Выбранная сборка</span><b>${esc(p ? p.name : 'Сборок пока нет')}</b><span>${p ? esc(profMeta(p)) + (p.lastPlayed ? ' · играл ' + esc(ago(p.lastPlayed).toLowerCase()) : '') : 'Создай первую сборку'}</span></div>
    <div class="play-row qrow ${S.menuOpen ? 'open' : ''}">
      ${p ? `<button type="button" class="btn2 psq" data-act="toggleMenu" aria-expanded="${S.menuOpen}">Сменить сборку</button>
      <div class="qmenu plist" role="listbox" aria-label="Сборки">${menu.html}</div>` : ''}
      <button type="button" class="play ${ps.cls}" data-act="${p ? 'play' : 'newProfile'}">${PLAY_SVG}<span>${p ? ps.label : 'Создать'}</span></button>
    </div>
    ${progressHtml()}
  </section>`;
}

// ---------- Главная: новости Minecraft ----------
function viewHome() {
  const N = S.news;
  const list = (N.mc || []).filter(n => N.filter === 'all' || n.kind === N.filter || (N.filter === 'other' && n.kind === 'bedrock'));
  const chips = NEWS_FILTERS.map(([id, l]) => `<button type="button" class="seg-b ${N.filter === id ? 'on' : ''}" aria-pressed="${N.filter === id}" data-act="newsFilter" data-id="${id}">${l}</button>`).join('');
  let grid;
  if (N.mcLoading && !N.mc) grid = '<div class="news-grid">' + Array.from({ length: 5 }, (_, i) => `<div class="ncard sk ${i === 0 ? 'big' : ''}"><div class="nimg"></div><div class="nbody"><span class="skl w40"></span><span class="skl w80"></span></div></div>`).join('') + '</div>';
  else if (N.mcError && !N.mc) grid = `<div class="empty-box"><b>Не получилось загрузить новости Minecraft</b><span class="note">${esc(N.mcError)}</span><button type="button" class="btn2" data-act="newsReload">Повторить</button></div>`;
  else if (!list.length) grid = `<div class="empty-box"><span class="note">В этой рубрике новостей нет.</span></div>`;
  else {
    const card = (n, i) => `<button type="button" class="ncard ${i === 0 ? 'big' : ''}" data-act="newsOpen" data-id="${esc(n.id)}">
      <div class="nimg">${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy">` : ''}</div>
      <div class="nbody"><div class="nmeta"><span class="ntag">${esc(n.tag)}</span><span>${esc(fmtDate(n.date))}</span></div><b>${esc(n.title)}</b>${i === 0 && n.text ? `<p>${esc(n.text)}</p>` : ''}</div>
    </button>`;
    grid = '<div class="news-grid">' + list.slice(0, 5).map(card).join('') + '</div>' +
      (list.length > 5 ? '<div class="news-more">' + list.slice(5, 11).map((n, i) => card(n, i + 5)).join('') + '</div>' : '');
  }
  return `<section class="page2">
    ${quickLaunch()}
    <div class="sec-head"><h1>Новости Minecraft</h1><div class="seg2" role="group" aria-label="Рубрика">${chips}</div>
      <button type="button" class="icon-btn ghost" data-act="newsReload" aria-label="Обновить новости" title="Обновить">${REFRESH_SVG}</button></div>
    ${grid}
  </section>`;
}

// ---------- Komori: сервер, новости проекта, логи ----------
function viewKomori() {
  const N = S.news, pg = S.ping;
  const ps = playState();
  const srvRunning = S.running.includes(S.info.serverProfileId);
  const status = !pg ? 'Проверяю…' : pg.online ? `Онлайн · ${pg.players} из ${pg.max}` : 'Сервер офлайн';
  let news;
  if (N.koLoading && !N.ko) news = '<div class="kn-list">' + Array.from({ length: 3 }, () => `<div class="kn sk"><div class="kimg"></div><div class="kt"><span class="skl w40"></span><span class="skl w80"></span></div></div>`).join('') + '</div>';
  else if (N.koError && !N.ko) news = `<div class="empty-box"><b>Новости Komori не загрузились</b><span class="note">${esc(N.koError)}</span><button type="button" class="btn2" data-act="koReload">Повторить</button></div>`;
  else if (!(N.ko || []).length) news = `<div class="empty-box"><span class="note">Новостей пока нет.</span></div>`;
  else news = '<div class="kn-list">' + N.ko.slice(0, 6).map(n => `<button type="button" class="kn" data-act="newsOpen" data-id="${esc(n.id)}">
      <div class="kimg">${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy">` : '<img src="assets/logo.svg" alt="" class="klogo">'}</div>
      <div class="kt"><div class="nmeta"><span class="ntag">${esc(n.tag)}</span>${n.pinned ? '<span class="ntag pin">Закреплено</span>' : ''}<span>${esc(fmtDate(n.date))}</span></div><b>${esc(n.title)}</b>${n.text ? `<p>${esc(n.text)}</p>` : ''}</div>
    </button>`).join('') + '</div>';
  const L = links();
  const linkBtns = [L.discord, L.website].concat(L.social || []).filter(Boolean)
    .map(l => `<button type="button" data-act="openLink" data-id="${esc(l.id)}">${linkIcon(l.icon, 'ico')}${esc(l.name)}</button>`).join('');
  const names = pg && pg.online && pg.names && pg.names.length ? `<div class="srv-heads">${pg.names.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : '<span class="note">' + (pg && pg.online ? 'Список игроков скрыт или никого нет' : 'Когда сервер в сети, здесь видно, кто играет') + '</span>';
  return `<section class="page2">
    <section class="kh card">
      <img class="kh-logo" src="assets/logo.svg" alt="">
      <div class="kh-t"><h1>${esc(S.info.server.name || 'Komori')}</h1>
        <div class="kh-s"><span class="dot ${!pg ? 'wait' : pg.online ? '' : 'off'}"></span>${esc(status)}<span class="sep">·</span><code>${esc(S.info.server.host)}</code></div></div>
      <div class="kh-play">
        <button type="button" class="play ${srvRunning ? 'ingame' : S.busy ? 'busy' : ''}" data-act="playServer">${PLAY_SVG}<span>${srvRunning ? 'В игре' : S.busy ? 'Запуск…' : 'Играть на Komori'}</span></button>
        ${progressHtml()}
      </div>
    </section>
    <div class="k-cols">
      <div class="k-main"><div class="sec-head"><h2>Новости Komori</h2><button type="button" class="icon-btn ghost" data-act="koReload" aria-label="Обновить" title="Обновить">${REFRESH_SVG}</button></div>${news}</div>
      <div class="k-side">
        <div class="card pad"><div class="card-h"><h2>Сейчас на сервере</h2><button type="button" class="icon-btn ghost sm" data-act="pingNow" aria-label="Обновить статус" title="Обновить">${REFRESH_SVG}</button></div>${names}</div>
        ${linkBtns ? `<div class="card pad"><h2>Ссылки</h2><div class="k-links">${linkBtns}</div></div>` : ''}
        <div class="card pad klogs ${S.running.length ? 'live' : ''}"><div class="card-h"><h2>${S.running.length ? '<span class="dot"></span>' : ''}Логи Minecraft</h2><button type="button" class="icon-btn ghost sm" data-act="openLog" aria-label="Открыть лог" title="Открыть лог"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg></button></div>
          <div class="logbox" id="logbox">${logLines(8) || '<span class="empty-log">Здесь появятся последние строки игры после запуска.</span>'}</div></div>
      </div>
    </div>
  </section>`;
}

// ---------- Профиль ----------
function viewProfile() {
  const a = selectedAccount();
  const st = S.stats || { total: 0, komori: 0, launches: 0, days: {}, hours: {}, profiles: {} };
  const lv = levelInfo(st.total), sk = streaks(st.days || {});
  const bd = badges(st, lv, sk);
  const played = Object.keys(st.profiles || {}).filter(k => st.profiles[k] > 0).length;
  const since = st.since ? new Date(st.since) : null;
  const tiles = [
    ['Всего в игре', fmtHours(st.total), since ? 'с ' + since.getDate() + ' ' + MONTHS_GEN[since.getMonth()] + ' ' + since.getFullYear() : ''],
    ['На Komori', fmtHours(st.komori), st.total ? Math.round(st.komori / st.total * 100) + '% времени' : 'ещё не играл'],
    ['Запусков', String(st.launches || 0), played ? 'в ' + played + ' ' + plural(played, 'сборке', 'сборках', 'сборках') : 'пока ни одного'],
    ['Серия дней', String(sk.cur), 'рекорд — ' + sk.best]
  ];
  const recent = S.profiles.list.slice().sort((x, y) => (y.lastPlayed || 0) - (x.lastPlayed || 0)).slice(0, 4);
  const periods = PERIODS.map(([id, l]) => `<button type="button" class="seg-b ${S.actPeriod === id ? 'on' : ''}" aria-pressed="${S.actPeriod === id}" data-act="actPeriod" data-id="${id}">${l}</button>`).join('');
  const banner = S.look && S.look.banner;
  return `<section class="page2 prof">
    <section class="card ph" aria-label="Шапка профиля">
      <div class="ph-banner ${banner ? '' : 'empty'}" ${banner ? `style="background-image:url('${banner}')"` : ''}>${banner ? '' : '<button type="button" class="ph-set" data-act="goLook">Поставить баннер</button>'}</div>
      <div class="ph-row">
        ${avatarHtml('ph-av')}
        <div class="ph-t">
          <div class="ph-name"><h1>${esc(a ? a.name : 'Без аккаунта')}</h1><span class="lvl">УР. ${lv.level}</span></div>
          <div class="ph-xp"><div class="xpbar"><div style="width:${lv.pct}%"></div></div><span>${lv.xp.toLocaleString('ru-RU')} / ${lv.need.toLocaleString('ru-RU')} опыта до ${lv.level + 1} уровня</span></div>
        </div>
        <button type="button" class="btn2" data-act="goLook">Изменить профиль</button>
      </div>
      <div class="ph-badges" aria-label="Значки">${bd.map(b => `<span class="bdg ${b.got ? 'got' : ''}" title="${esc(b.t)}${b.got ? '' : ' — ещё не получен'}">${esc(b.n)}</span>`).join('')}<span class="note">1 минута в игре = 1 опыт</span></div>
    </section>
    <div class="tiles">${tiles.map(t => `<div class="card tile"><span class="lbl">${t[0]}</span><b>${esc(t[1])}</b><small>${esc(t[2])}</small></div>`).join('')}</div>
    <div class="prof-grid">
      <section class="card pad act" aria-label="Активность">
        <div class="card-h"><h2>Активность</h2><div class="seg2" role="group" aria-label="Период">${periods}</div></div>
        ${activityChart(st, S.actPeriod)}
      </section>
      <section class="card pad" aria-label="Недавние сборки">
        <div class="card-h"><h2>Недавние сборки</h2><button type="button" class="link-btn" data-act="nav" data-id="profiles">Все</button></div>
        <div class="rlist">${recent.map(p => `<div class="rrow">${profIcon(p.icon, 34)}<div class="t"><b>${esc(p.name)}</b><span>${esc(LOADER_NAMES[p.loader] || '')} ${esc(mcLabel(p.mcVersion))} · ${p.lastPlayed ? esc(ago(p.lastPlayed)) : 'не запускалась'}${st.profiles && st.profiles[p.id] ? ' · ' + esc(fmtHours(st.profiles[p.id])) : ''}</span></div>
          <button type="button" class="icon-btn sm" data-act="playProfile" data-id="${esc(p.id)}" aria-label="Играть в ${esc(p.name)}"><svg width="12" height="12" viewBox="0 0 24 24"><path d="M6 4l15 8-15 8z" fill="currentColor"/></svg></button></div>`).join('') || '<span class="note">Сборок пока нет.</span>'}</div>
      </section>
    </div>
  </section>`;
}
function plural(n, one, few, many) { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many; }

// ---------- Настройки → Внешний вид ----------
function lookTab() {
  const st = S.settings || {};
  const seg = (list, cur, act) => `<div class="seg2" role="radiogroup">${list.map(([id, l]) => `<button type="button" role="radio" class="seg-b ${cur === id ? 'on' : ''}" aria-checked="${cur === id}" data-act="${act}" data-id="${id}">${l}</button>`).join('')}</div>`;
  const swatches = (cur, act) => `<div class="swatches">${ACCENTS.map(([id, name]) => `<button type="button" class="swatch ${cur === id ? 'on' : ''}" style="--c:${accentHex(id, act === 'setAvColor' ? true : undefined)}" aria-label="${name}" title="${name}" aria-pressed="${cur === id}" data-act="${act}" data-id="${id}"></button>`).join('')}</div>`;
  const banner = S.look && S.look.banner;
  const bg = st.avatarBg || 'glow';
  return `<div class="look">
    <div class="panel">
      <div class="prow"><span>Тема</span>${seg(THEME_NAMES, st.theme || 'system', 'setTheme')}</div>
      <div class="prow"><span>Цвет акцента<br><span class="note">Кнопки, выделение, график, уровень</span></span>${swatches(st.accent || 'violet', 'setAccent')}</div>
    </div>
    <div class="panel av-panel">
      <div class="av-prev">${avatarHtml('av-big')}<span class="note">Аватарка собирается из твоего скина</span></div>
      <div class="av-opts">
        <div class="prow"><span>Поза</span>${seg(AV_POSES, st.avatarPose || 'bust', 'setAvPose')}</div>
        <div class="prow"><span>Свет</span>${seg(AV_LIGHTS, st.avatarLight || 'studio', 'setAvLight')}</div>
        <div class="prow"><span>Фон</span>${seg(AV_BGS, bg, 'setAvBg')}</div>
        ${bg === 'glow' || bg === 'solid' ? `<div class="prow"><span>Цвет фона</span>${swatches(st.avatarColor || st.accent || 'violet', 'setAvColor')}</div>` : ''}
        ${bg === 'image' ? `<div class="prow"><span>Картинка фона</span><span class="row-btns"><button type="button" class="btn2" data-act="lookPick" data-id="avatarBg">${S.look && S.look.avatarBg ? 'Заменить' : 'Выбрать картинку'}</button>${S.look && S.look.avatarBg ? '<button type="button" class="btn-ghost" data-act="lookReset" data-id="avatarBg">Убрать</button>' : ''}</span></div>` : ''}
        ${!(S.skin.info && S.skin.info.skinData) ? '<div class="prow note">Скин не найден — пока вместо аватарки буква ника. Скин ставится в Настройки → Аккаунт.</div>' : ''}
      </div>
    </div>
    <div class="panel">
      <div class="prow"><span>Баннер профиля<br><span class="note">2560×1440, как обложка YouTube. Лишнее обрежется по центру.</span></span>
        <span class="row-btns">${banner ? `<span class="ban-prev" style="background-image:url('${banner}')"></span>` : ''}<button type="button" class="btn2" data-act="lookPick" data-id="banner">${banner ? 'Заменить' : 'Загрузить картинку'}</button>${banner ? '<button type="button" class="btn-ghost" data-act="lookReset" data-id="banner">Убрать</button>' : ''}</span></div>
    </div>
  </div>`;
}

// ---------- вкладки раздела «Сборки» ----------
function buildsTabs() {
  const t = [['profiles', 'Мои сборки'], ['mods', 'Каталог модов'], ['versions', 'Версии Minecraft']];
  return `<div class="tabs sub" role="tablist">${t.map(([id, l]) => `<button type="button" role="tab" aria-selected="${S.screen === id}" class="${S.screen === id ? 'on' : ''}" data-act="nav" data-id="${id}">${l}</button>`).join('')}</div>`;
}

const REFRESH_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg>';

// Действия новых разделов (подмешиваются в ACTIONS из app.js)
const PAGE_ACTIONS = {
  newsFilter: (id) => { S.news.filter = id; render(); },
  newsReload: () => loadMcNews(true),
  koReload: () => loadKomoriNews(true),
  newsOpen: (id) => K.news.open(id),
  actPeriod: (id) => { S.actPeriod = id; render(); },
  goLook: () => { S.screen = 'settings'; S.sTab = 'look'; render(); },
  setAccent: async (id) => { S.settings = await K.settings.set({ accent: id }); applyAccent(); render(); },
  setAvPose: async (id) => { S.settings = await K.settings.set({ avatarPose: id }); refreshAvatar(); },
  setAvLight: async (id) => { S.settings = await K.settings.set({ avatarLight: id }); refreshAvatar(); },
  setAvBg: async (id) => {
    S.settings = await K.settings.set({ avatarBg: id }); render();
    if (id === 'image' && !(S.look && S.look.avatarBg)) return PAGE_ACTIONS.lookPick('avatarBg');
    refreshAvatar();
  },
  setAvColor: async (id) => { S.settings = await K.settings.set({ avatarColor: id }); render(); refreshAvatar(); },
  lookPick: async (kind) => {
    try { const d = await K.look.pick(kind); if (d) { S.look[kind] = d; render(); refreshAvatar(); } }
    catch (e) { toast(errText(e)); }
  },
  lookReset: async (kind) => { await K.look.reset(kind); S.look[kind] = null; render(); refreshAvatar(); }
};
