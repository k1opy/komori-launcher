'use strict';
/* Komori Launcher — разделы Главная, Komori, Профиль и «Внешний вид» в настройках. */

function fmtDate(d) {
  const t = new Date(d);
  if (isNaN(t)) return '';
  return t.getDate() + ' ' + MONTHS_GEN[t.getMonth()] + (t.getFullYear() !== new Date().getFullYear() ? ' ' + t.getFullYear() : '');
}

// ---------- загрузка данных ----------
async function loadKomoriNews(force) {
  const N = S.news;
  if (N.koLoading || (N.ko && !force)) return;
  N.koLoading = true; N.koError = null; if (S.screen === 'komori') render();
  try { N.ko = await K.news.komori(!!force); } catch (e) { N.koError = errText(e); }
  N.koLoading = false; if (S.screen === 'komori' || S.screen === 'home') render();
}
async function loadStats() {
  try { S.stats = await K.stats(); } catch { S.stats = S.stats || { total: 0, komori: 0, launches: 0, days: {}, hours: {}, profiles: {} }; }
  if (S.screen === 'profile' || S.screen === 'home') render();
}
async function loadLook() {
  try { S.look = await K.look.get(); } catch { S.look = { avatarBg: null }; }
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
  const a = kAcc();
  if (a && a.avatar) return `<span class="${cls}"><img src="${esc(a.avatar)}" alt=""></span>`;
  return `<span class="${cls} letter">${esc(a ? a.login.charAt(0).toUpperCase() : '?')}</span>`;
}
// Превью 3D-аватарки из скина (в настройках); на аккаунт уходит только по кнопке
function avatar3dHtml(cls) {
  if (S.avatar && S.avatar.url) return `<span class="${cls}"><img src="${S.avatar.url}" alt="3D-аватарка из скина"></span>`;
  return `<span class="${cls} letter">${S.avatar ? '—' : '…'}</span>`;
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
      ${stopBtn(p && p.id)}
    </div>
    ${progressHtml()}
  </section>`;
}

// Кнопка рядом с «Играть»: «Отменить», пока идёт подготовка, и «Закрыть игру», когда игра запущена
function stopBtn(id) {
  if (S.busy && (!id || S.busyTarget === id || !S.busyTarget)) return '<button type="button" class="btn-ghost stop-btn" data-act="stopGame">Отменить</button>';
  if (id && S.running.includes(id)) return `<button type="button" class="btn-ghost stop-btn" data-act="stopGame" data-id="${esc(id)}" title="Игра закроется сразу, несохранённое с последнего автосохранения пропадёт">Закрыть игру</button>`;
  return '';
}

// ---------- Главная: сервер, твоя неделя, недавние сборки, сборки дня ----------
function viewHome() {
  return `<section class="page2">
    ${quickLaunch()}
    <div class="home-row">${homeServer()}${homeWeek()}${homeFriends()}</div>
    ${homeRecent()}
    ${homeDaily()}
  </section>`;
}
function homeLoad() { loadStats(); loadDaily(); loadFriends(); }

function homeServer() {
  const pg = S.ping, srvRunning = S.running.includes(S.info.serverProfileId);
  const status = !pg ? 'Проверяю…' : pg.online ? 'Онлайн' : 'Офлайн';
  return `<div class="card hcard hsrv">
    <div class="hc-h"><h2>Сервер Komori</h2><span class="hs-st ${!pg ? 'wait' : pg.online ? 'on' : 'off'}"><span class="dot ${!pg ? 'wait' : pg.online ? '' : 'off'}"></span>${status}</span></div>
    <div class="hs-big">${pg && pg.online ? `<b>${pg.players}</b><span>из ${pg.max} игроков</span>` : `<span class="note">${pg ? 'Сервер сейчас недоступен' : 'Смотрю, кто в сети…'}</span>`}</div>
    <code class="hs-host">${esc(S.info.server.host)}</code>
    <div class="hc-foot"><button type="button" class="btn" data-act="playServer" ${S.busy || srvRunning ? 'disabled' : ''}>${srvRunning ? 'В игре' : 'Играть'}</button>
      <button type="button" class="btn2" data-act="nav" data-id="komori">Подробнее</button></div>
  </div>`;
}

function homeWeek() {
  const st = S.stats;
  if (!st) return `<div class="card hcard"><div class="hc-h"><h2>Твоя неделя</h2></div><span class="skl w80"></span><span class="skl w40"></span></div>`;
  const lv = levelInfo(st.total), days = st.days || {};
  let week = 0; for (let i = 0; i < 7; i++) week += days[dayKeyR(Date.now() - i * 864e5)] || 0;
  const sk = streaks(days);
  const bars = Array.from({ length: 7 }, (_, i) => days[dayKeyR(Date.now() - (6 - i) * 864e5)] || 0);
  const mx = Math.max(3600, ...bars);
  return `<div class="card hcard">
    <div class="hc-h"><h2>Твоя неделя</h2><span class="hw-lv">ур. ${lv.level}</span></div>
    <div class="hw-nums"><div><b>${esc(fmtHours(week))}</b><span>в игре за 7 дней</span></div><div><b>${sk.cur}</b><span>${sk.cur === 1 ? 'день' : sk.cur > 1 && sk.cur < 5 ? 'дня' : 'дней'} подряд</span></div></div>
    <div class="hw-bars" aria-hidden="true">${bars.map((v, i) => `<span class="${i === 6 ? 'today' : ''}" style="height:${Math.max(6, Math.round(v / mx * 100))}%"></span>`).join('')}</div>
    <div class="hw-xp"><div class="bar"><div style="width:${lv.pct}%"></div></div><span>${lv.xp} / ${lv.need} XP до ур. ${lv.level + 1}</span></div>
  </div>`;
}

// Друзья: добавить по логину, входящие заявки, кто в сети и во что играет
function agoShort(ts) {
  if (!ts) return 'не в сети';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return 'был ' + Math.max(1, m) + ' мин назад';
  const h = Math.floor(m / 60);
  if (h < 24) return 'был ' + h + ' ч назад';
  const d = Math.floor(h / 24);
  return d === 1 ? 'был вчера' : 'был ' + d + ' дн. назад';
}
function frAvatar(f) { return `<span class="fr-av">${f.avatar ? `<img src="${esc(f.avatar)}" alt="" loading="lazy">` : esc(f.login.charAt(0).toUpperCase())}</span>`; }
const X_SVG = '<svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.8"/></svg>';
const OK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
function homeFriends() {
  const F = S.friends;
  if (!kAcc()) return `<div class="card hcard"><div class="hc-h"><h2>Друзья</h2></div><span class="note">Войди в аккаунт Komori — тогда можно добавлять друзей и видеть, кто во что играет.</span><div class="hc-foot"><button type="button" class="btn" data-act="gOpen">Войти</button></div></div>`;
  const d = F.data;
  const online = d ? d.friends.filter(f => f.online).length : 0;
  const add = `<div class="fr-add"><input id="frAdd" class="input" placeholder="Логин друга" maxlength="16" value="${esc(F.add)}" aria-label="Логин друга"><button type="button" class="btn2" data-act="frAdd" ${F.busy || !F.add.trim() ? 'disabled' : ''}>Добавить</button></div>`;
  let body = '';
  if (!d) body = F.error ? `<span class="note">${esc(F.error)}</span>` : '<span class="skl w80"></span><span class="skl w40"></span>';
  else {
    const inc = d.incoming.map(f => `<div class="fr fr-inc">${frAvatar(f)}<div class="t"><b>${esc(f.login)}</b><span>хочет дружить</span></div>
      <button type="button" class="fr-btn ok" data-act="frAccept" data-id="${esc(f.login)}" aria-label="Принять" title="Принять" ${F.busy ? 'disabled' : ''}>${OK_SVG}</button>
      <button type="button" class="fr-btn" data-act="frRemove" data-id="${esc(f.login)}" aria-label="Отклонить" title="Отклонить" ${F.busy ? 'disabled' : ''}>${X_SVG}</button></div>`).join('');
    const list = d.friends.map(f => `<div class="fr ${f.online ? 'on' : ''}">${frAvatar(f)}<div class="t"><b>${esc(f.login)} <span class="fr-lv">ур. ${f.level}</span></b>
      <span class="${f.game ? 'fr-game' : ''}">${f.game ? 'играет в ' + esc(f.game) : f.online ? 'в лаунчере' : esc(agoShort(f.seen))}</span></div>
      <button type="button" class="fr-btn fr-del" data-act="frRemove" data-id="${esc(f.login)}" aria-label="Убрать ${esc(f.login)} из друзей" title="Убрать из друзей" ${F.busy ? 'disabled' : ''}>${X_SVG}</button></div>`).join('');
    const out = d.outgoing.length ? `<div class="fr-out">Ждут ответа: ${d.outgoing.map(f => `<button type="button" class="fr-chip" data-act="frRemove" data-id="${esc(f.login)}" title="Отменить заявку">${esc(f.login)} ${X_SVG}</button>`).join('')}</div>` : '';
    body = (inc || list ? `<div class="fr-list">${inc}${list}</div>` : '<span class="note">Пока никого. Добавь друга по логину Komori.</span>') + out;
  }
  return `<div class="card hcard hfr"><div class="hc-h"><h2>Друзья</h2>${d && d.friends.length ? `<span class="fr-n">${online ? '<span class="dot"></span>' + online + ' в сети' : 'никого в сети'}</span>` : ''}</div>
    ${add}${F.msg ? `<span class="fr-msg ${F.msgErr ? 'err' : ''}">${esc(F.msg)}</span>` : ''}${body}</div>`;
}
async function loadFriends(quiet) {
  const F = S.friends;
  if (!kAcc() || F.loading) return;
  F.loading = true;
  try { F.data = await K.kacc.friends(); F.error = null; } catch (e) { if (!F.data) F.error = errText(e); }
  F.loading = false;
  if (S.screen === 'home' && !(quiet && document.activeElement && document.activeElement.id === 'frAdd')) render();
}
async function friendAct(action, login) {
  const F = S.friends;
  if (F.busy) return;
  F.busy = true; F.msg = ''; render();
  try {
    const r = await K.kacc.friend(action, login);
    F.data = r; F.msg = r.ok || ''; F.msgErr = false;
    if (action === 'add') F.add = '';
  } catch (e) { F.msg = errText(e); F.msgErr = true; }
  F.busy = false; render();
}
// Пока открыта главная, список друзей обновляется раз в минуту
setInterval(() => { if (S.screen === 'home' && !document.hidden) loadFriends(true); }, 60000);

function homeRecent() {
  const list = S.profiles.list.filter(p => p.lastPlayed).sort((x, y) => y.lastPlayed - x.lastPlayed).slice(0, 4);
  if (!list.length) return '';
  const st = S.stats || {};
  return `<div class="sec-head"><h2>Недавние сборки</h2><button type="button" class="link-btn" data-act="nav" data-id="profiles">Все сборки</button></div>
    <div class="hrecent">${list.map(p => `<div class="hr">${profIcon(p.icon, 40)}<div class="t"><b>${esc(p.name)}</b><span>${esc(profMeta(p))}</span><small>${esc(ago(p.lastPlayed))}${st.profiles && st.profiles[p.id] ? ' · ' + esc(fmtHours(st.profiles[p.id])) : ''}</small></div>
      <button type="button" class="icon-btn hr-play" data-act="playProfile" data-id="${esc(p.id)}" aria-label="Играть в ${esc(p.name)}" title="Играть" ${S.busy || S.running.includes(p.id) ? 'disabled' : ''}>${PLAY_SVG}</button></div>`).join('')}</div>`;
}

// Сборки дня: каждый день — свои 4 из популярных на Modrinth (как подборка в магазине)
function homeDaily() {
  const D = S.daily;
  let body;
  if (!D || D.loading) body = '<div class="dgrid">' + Array.from({ length: 4 }, () => '<div class="dcard sk"><div class="pc-img"></div><div class="pc-body"><span class="skl w80"></span><span class="skl w40"></span></div></div>').join('') + '</div>';
  else if (D.error) body = `<div class="empty-box"><span class="note">Подборка не загрузилась: ${esc(D.error)}</span><button type="button" class="btn2" data-act="dailyReload">Повторить</button></div>`;
  else body = '<div class="dgrid">' + D.hits.map(h => {
    const busy = S.mods.busy[h.id];
    const meta = [h.mcv, (h.loaders || []).filter(l => LOADER_NAMES[l]).map(loaderLabel).join(' / ')].filter(Boolean).join(' · ');
    return `<div class="dcard"><div class="pc-img">${h.image ? `<img src="${esc(h.image)}" alt="" loading="lazy">` : `<span class="pc-ph">${esc((h.title || '?').charAt(0))}</span>`}${meta ? `<span class="pc-meta">${esc(meta)}</span>` : ''}</div>
      <div class="pc-body"><div class="pc-head">${modIcon(h.icon, h.title)}<div class="t"><button type="button" class="mtitle" data-act="dailyOpen" data-id="${esc(h.slug)}">${esc(h.title)}</button><span class="mby">${fmtNum(h.downloads)} загрузок</span></div></div>
      <span class="pc-desc">${esc(h.description)}</span>
      <button type="button" class="btn2" data-act="dailyInstall" data-id="${esc(h.id)}" data-title="${esc(h.title)}" ${busy || S.busy ? 'disabled' : ''}>${busy ? esc(busy) : 'Установить'}</button></div></div>`;
  }).join('') + '</div>';
  return `<div class="sec-head"><h2>Сборки дня <span class="h-sub">новая подборка каждый день</span></h2><button type="button" class="link-btn" data-act="dailyAll">Все сборки</button></div>${S.busy && S.mods.busy && D && D.hits && D.hits.some(h => S.mods.busy[h.id]) ? progressHtml() : ''}${body}`;
}
async function loadDaily(force) {
  const day = dayKeyR(Date.now());
  if (!force && S.daily && (S.daily.loading || (S.daily.day === day && !S.daily.error))) return;
  S.daily = { loading: true, day, hits: [] }; if (S.screen === 'home') render();
  try {
    // День года выбирает страницу топа и 4 сборки из неё — у всех игроков подборка одна и та же
    const n = Math.floor(Date.now() / 864e5);
    const r = await K.mods.search({ source: 'modrinth', type: 'modpack', sort: 'follows', query: '', offset: (n % 8) * 20 });
    const hits = r.hits.slice(), out = [];
    let seed = n;
    while (out.length < 4 && hits.length) { seed = (seed * 9301 + 49297) % 233280; out.push(hits.splice(seed % hits.length, 1)[0]); }
    S.daily = { day, hits: out };
  } catch (e) { S.daily = { day, hits: [], error: errText(e) }; }
  if (S.screen === 'home') render();
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
        <div class="kh-btns"><button type="button" class="play ${srvRunning ? 'ingame' : S.busy ? 'busy' : ''}" data-act="playServer">${PLAY_SVG}<span>${srvRunning ? 'В игре' : S.busy ? 'Запуск…' : 'Играть на Komori'}</span></button>${stopBtn(S.info.serverProfileId)}</div>
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
  const ka = kAcc();
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
  const banner = ka && ka.banner;
  const srvBadges = (ka && ka.badges || []).map(b => `<span class="bdg got" style="color:${esc(b.color)};border-color:${esc(b.color)}">${esc(b.label)}</span>`).join('');
  return `<section class="page2 prof">
    <section class="card ph" aria-label="Шапка профиля">
      <div class="ph-banner ${banner ? '' : 'empty'}" ${banner ? `style="background-image:url('${esc(banner)}')"` : ''}>${banner ? '' : '<button type="button" class="ph-set" data-act="goLook">Поставить баннер</button>'}</div>
      <div class="ph-row">
        ${avatarHtml('ph-av')}
        <div class="ph-t">
          <div class="ph-name"><h1>${esc(ka ? ka.login : 'Без аккаунта')}</h1><span class="lvl">УР. ${lv.level}</span>${ka && ka.discordLinked && ka.discord ? `<span class="ph-ds">Discord · ${esc(ka.discord.name)}</span>` : ''}</div>
          ${ka && ka.status ? `<div class="ph-status">${esc(ka.status)}</div>` : ''}
          <div class="ph-xp"><div class="xpbar"><div style="width:${lv.pct}%"></div></div><span>${lv.xp.toLocaleString('ru-RU')} / ${lv.need.toLocaleString('ru-RU')} опыта до ${lv.level + 1} уровня</span></div>
        </div>
        <button type="button" class="btn2" data-act="goLook">Изменить профиль</button>
      </div>
      <div class="ph-badges" aria-label="Значки">${srvBadges}${bd.map(b => `<span class="bdg ${b.got ? 'got' : ''}" title="${esc(b.t)}${b.got ? '' : ' — ещё не получен'}">${esc(b.n)}</span>`).join('')}<span class="note">1 минута в игре = 1 опыт</span></div>
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
  const ka = kAcc(), banner = ka && ka.banner;
  const bg = st.avatarBg || 'glow';
  const curAv = ka ? (ka.avatarType === 'd' ? 'd:' + ka.avatarColor : ka.avatarType) : '';
  const hasSkin = !!(S.skin.info && S.skin.info.skinData);
  const accNote = ka ? '' : '<div class="prow note">Аватарка и баннер хранятся в аккаунте Komori — войди, чтобы их поменять.</div>';
  return `<div class="look">
    <div class="panel">
      <div class="prow"><span>Тема</span>${seg(THEME_NAMES, st.theme || 'system', 'setTheme')}</div>
      <div class="prow"><span>Цвет акцента<br><span class="note">Кнопки, выделение, график, уровень</span></span>${swatches(st.accent || 'violet', 'setAccent')}</div>
    </div>
    <div class="panel av-panel">
      <div class="av-prev">${avatarHtml('av-big')}<span class="note">Твоя аватарка сейчас — её видят в лаунчере и на сайте</span></div>
      <div class="av-opts">
        ${accNote}
        <div class="prow"><span>Базовая<br><span class="note">При регистрации выпала случайная</span></span><div class="av-defs">${ACCENTS.map(([id, name]) => `<button type="button" class="av-def ${curAv === 'd:' + id ? 'on' : ''}" aria-pressed="${curAv === 'd:' + id}" title="${name}" aria-label="Базовая аватарка: ${name}" data-act="kAvDefault" data-id="${id}" ${ka ? '' : 'disabled'}><img src="${esc(siteUrl('/acc-def/' + id))}" alt=""></button>`).join('')}</div></div>
        <div class="prow"><span>Своя картинка<br><span class="note">Обрежется в квадрат</span></span><button type="button" class="btn2" data-act="kAvPick" ${ka ? '' : 'disabled'}>${curAv === 'i' ? 'Заменить картинку' : 'Загрузить картинку'}</button></div>
      </div>
    </div>
    <div class="panel av-panel">
      <div class="av-prev">${avatar3dHtml('av-big')}<button type="button" class="btn" data-act="kAvSkin" ${ka && hasSkin && S.avatar && S.avatar.url ? '' : 'disabled'}>${curAv === 's' ? 'Обновить' : 'Поставить'}</button></div>
      <div class="av-opts">
        <div class="prow"><b style="font-weight:500">3D-аватарка из скина</b>${curAv === 's' ? '<span class="tag ok">Стоит сейчас</span>' : ''}</div>
        <div class="prow"><span>Поза</span>${seg(AV_POSES, st.avatarPose || 'bust', 'setAvPose')}</div>
        <div class="prow"><span>Свет</span>${seg(AV_LIGHTS, st.avatarLight || 'studio', 'setAvLight')}</div>
        <div class="prow"><span>Фон</span>${seg(AV_BGS, bg, 'setAvBg')}</div>
        ${bg === 'glow' || bg === 'solid' ? `<div class="prow"><span>Цвет фона</span>${swatches(st.avatarColor || st.accent || 'violet', 'setAvColor')}</div>` : ''}
        ${bg === 'image' ? `<div class="prow"><span>Картинка фона</span><span class="row-btns"><button type="button" class="btn2" data-act="lookPick" data-id="avatarBg">${S.look && S.look.avatarBg ? 'Заменить' : 'Выбрать картинку'}</button>${S.look && S.look.avatarBg ? '<button type="button" class="btn-ghost" data-act="lookReset" data-id="avatarBg">Убрать</button>' : ''}</span></div>` : ''}
        ${hasSkin ? '' : '<div class="prow note">Скин не найден. Он ставится в Настройки → Minecraft.</div>'}
      </div>
    </div>
    <div class="panel">
      <div class="prow"><span>Баннер профиля<br><span class="note">2560×1440, как обложка YouTube. Лишнее обрежется по центру.</span></span>
        <span class="row-btns">${banner ? `<span class="ban-prev" style="background-image:url('${esc(banner)}')"></span>` : ''}<button type="button" class="btn2" data-act="kBanPick" ${ka ? '' : 'disabled'}>${banner ? 'Заменить' : 'Загрузить картинку'}</button>${banner ? '<button type="button" class="btn-ghost" data-act="kBanReset">Убрать</button>' : ''}</span></div>
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
  dailyReload: () => loadDaily(true),
  frAdd: () => { const l = S.friends.add.trim(); if (l) friendAct('add', l); },
  frAccept: (login) => friendAct('accept', login),
  frRemove: (login) => friendAct('remove', login),
  dailyOpen: (slug) => K.mods.open('modrinth', slug, 'modpack', ''),
  dailyAll: () => { S.mods.type = 'modpack'; S.mods.source = 'modrinth'; S.mods.cats = []; ACTIONS.nav('mods'); },
  dailyInstall: (id, el) => installPack(() => K.mods.installPack('modrinth', id, el.dataset.title), id),
  playProfile: async (id) => {
    if (S.busy) return;
    if (S.profiles.selected !== id) S.profiles = await K.profiles.select(id);
    ACTIONS.play();
  },
  koReload: () => loadKomoriNews(true),
  newsOpen: (id) => K.news.open(id),
  actPeriod: (id) => { S.actPeriod = id; render(); },
  goLook: () => { S.screen = 'settings'; S.sTab = 'look'; render(); refreshAvatar(); },
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
    try { const d = await K.look.pick(kind); if (d) { S.look[kind] = d; refreshAvatar(); render(); } }
    catch (e) { toast(errText(e)); }
  },
  lookReset: async (kind) => { await K.look.reset(kind); S.look[kind] = null; render(); refreshAvatar(); }
};
