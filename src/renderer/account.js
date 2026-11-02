'use strict';
/* Komori Launcher — аккаунт Komori: вход и регистрация при запуске, настройки аккаунта. */

function kAcc() { return S.kacc && S.kacc.account; }
function siteUrl(p) { return ((S.info && S.info.site) || 'https://komori.fun') + p; }

async function loadKacc() {
  try { const r = await K.kacc.me(); S.kacc = { checked: true, account: r.account, offline: !!r.offline, error: r.error || '' }; }
  catch (e) { S.kacc = { checked: true, account: null, offline: true, error: errText(e) }; }
  renderGate(); render();
}

// ---------- экран входа ----------
function renderGate() {
  const g = $('#gate');
  if (!g) return;
  const need = S.kacc && S.kacc.checked && !kAcc() && !S.kacc.skip;
  g.classList.toggle('hidden', !need);
  if (!need) { g.innerHTML = ''; return; }
  const A = S.auth, rec = A.mode === 'rec', reg = A.mode === 'reg';
  const field = (id, label, type, val, extra, hint) => `<label class="g-f">${label}<input class="input" id="${id}" type="${type}" value="${esc(val)}" ${extra || ''}>${hint ? `<small>${hint}</small>` : ''}</label>`;
  g.innerHTML = `<div class="g-card" role="dialog" aria-modal="true" aria-labelledby="gTitle">
    <div class="g-brand"><img src="assets/logo.svg" alt=""><span>KOMORI</span></div>
    <h1 id="gTitle">${rec ? 'Восстановление пароля' : reg ? 'Создай аккаунт Komori' : 'Вход в Komori'}</h1>
    <p class="g-sub">${rec ? (A.sent ? 'Бот Komori прислал код в личные сообщения Discord.' : 'Код придёт от бота Komori в Discord, если он привязан к аккаунту.') : 'Один аккаунт для лаунчера и сайта komori.fun. Нужны только логин, пароль и возраст.'}</p>
    ${rec ? '' : `<div class="seg2 g-tabs" role="tablist"><button type="button" role="tab" class="seg-b ${!reg ? 'on' : ''}" aria-selected="${!reg}" data-act="gMode" data-id="in">Вход</button><button type="button" role="tab" class="seg-b ${reg ? 'on' : ''}" aria-selected="${reg}" data-act="gMode" data-id="reg">Регистрация</button></div>`}
    <form class="g-form" id="gForm" novalidate>
      ${field('gLogin', 'Логин', 'text', A.login, 'maxlength="16" autocomplete="username"', reg ? '3–16 символов: латиница, цифры и _' : '')}
      ${rec && A.sent ? field('gCode', 'Код из Discord', 'text', A.code, 'maxlength="6" inputmode="numeric" autocomplete="one-time-code"') : ''}
      ${!rec || A.sent ? field('gPass', rec ? 'Новый пароль' : 'Пароль', 'password', A.pass, `maxlength="72" autocomplete="${reg || rec ? 'new-password' : 'current-password'}"`, reg ? 'Минимум 8 символов. Почты нет — запиши пароль или привяжи потом Discord, через него его можно восстановить.' : '') : ''}
      ${reg || (rec && A.sent) ? field('gPass2', 'Повтори пароль', 'password', A.pass2, 'maxlength="72" autocomplete="new-password"') : ''}
      ${reg ? field('gAge', 'Возраст', 'number', A.age, 'min="5" max="100" inputmode="numeric"', 'Видят только админы') : ''}
      ${A.err ? `<div class="g-err" role="alert">${esc(A.err)}</div>` : ''}
      ${A.ok ? `<div class="g-ok" role="status">${esc(A.ok)}</div>` : ''}
      <button type="submit" class="btn g-go" ${A.busy ? 'disabled' : ''}>${A.busy ? 'Подожди…' : rec ? (A.sent ? 'Сменить пароль' : 'Прислать код') : reg ? 'Зарегистрироваться' : 'Войти'}</button>
    </form>
    <div class="g-foot">
      ${rec ? '<button type="button" class="link-btn" data-act="gMode" data-id="in">← Назад ко входу</button>' : !reg ? '<button type="button" class="link-btn" data-act="gMode" data-id="rec">Забыл пароль</button>' : '<span class="note">После регистрации в профиле можно привязать Discord, поставить аватарку и баннер.</span>'}
      ${S.kacc.offline ? `<button type="button" class="link-btn" data-act="gSkip">Нет связи с сайтом — продолжить без аккаунта</button>` : ''}
    </div>
  </div>`;
  const first = g.querySelector('input'); if (first && !g.contains(document.activeElement)) first.focus();
}

async function gateSubmit() {
  const A = S.auth;
  if (A.busy) return;
  const login = A.login.trim();
  if (!login) { A.err = 'Введи логин'; return renderGate(); }
  if ((A.mode === 'reg' || (A.mode === 'rec' && A.sent)) && A.pass !== A.pass2) { A.err = 'Пароли не совпадают'; return renderGate(); }
  A.busy = true; A.err = ''; A.ok = ''; renderGate();
  try {
    let acc = null;
    if (A.mode === 'in') acc = await K.kacc.login(login, A.pass);
    else if (A.mode === 'reg') acc = await K.kacc.register(login, A.pass, Number(A.age));
    else if (!A.sent) { const r = await K.kacc.recover(login); A.sent = true; A.ok = 'Код отправлен в Discord ' + (r.discord || '') + '. Он действует 15 минут.'; }
    else acc = await K.kacc.recoverFinish(login, A.code.trim(), A.pass);
    if (acc) {
      S.kacc = { checked: true, account: acc, offline: false };
      S.auth = blankAuth();
      toast(A.mode === 'reg' ? 'Аккаунт создан. Аватарку и баннер можно поменять в Настройках' : 'Вход выполнен', true);
      render(); loadStats();
    }
  } catch (e) { A.err = errText(e); }
  A.busy = false; renderGate();
}
function blankAuth() { return { mode: 'in', login: '', pass: '', pass2: '', age: '', code: '', sent: false, busy: false, err: '', ok: '' }; }

// ---------- Настройки → Аккаунт Komori ----------
function komoriTab() {
  const a = kAcc();
  if (!a) return `<div class="panel"><div class="prow"><span>Ты не вошёл в аккаунт Komori</span><button type="button" class="btn" data-act="gOpen">Войти</button></div></div>`;
  const P = S.kpw;
  return `<div class="look">
    <div class="panel">
      <div class="prow"><span class="kt-who">${avatarHtml('avatar')}<span><b>${esc(a.login)}</b><br><span class="note">Аккаунт Komori${a.since ? ' · с ' + esc(a.since) : ''}</span></span></span>
        <span class="row-btns"><button type="button" class="btn2" data-act="openSiteProfile">Профиль на сайте</button><button type="button" class="btn-ghost" data-act="kLogout">Выйти</button></span></div>
      <div class="prow"><span>Статус<br><span class="note">Виден в профиле на сайте и в лаунчере</span></span><span class="row-btns"><input class="input" id="kStatus" maxlength="60" style="width:300px" value="${esc(S.kStatus == null ? a.status || '' : S.kStatus)}" aria-label="Статус"><button type="button" class="btn2" data-act="kSaveStatus">Сохранить</button></span></div>
    </div>
    <div class="panel">
      <div class="prow"><span>Discord<br><span class="note">${a.discordLinked ? 'Через него можно войти на сайт и восстановить пароль' : 'Привяжи, чтобы можно было восстановить пароль и получить значки ролей'}</span></span>
        <span class="row-btns">${a.discordLinked ? `<span class="tag ok">${esc(a.discord ? a.discord.name : 'привязан')}</span><button type="button" class="btn-ghost" data-act="kUnlink">Отвязать</button>` : `${S.kLinkWait ? '<span class="note">Жду подтверждения в браузере…</span>' : ''}<button type="button" class="btn" data-act="kLink">Привязать Discord</button>`}</span></div>
      ${a.discordLinked ? `<div class="prow"><span>Показывать Discord в профиле</span>${sw(!!a.showDiscord, 'kShowDiscord')}</div>` : ''}
    </div>
    <div class="panel">
      <div class="prow" style="flex-direction:column;align-items:stretch;gap:10px"><b style="font-weight:500">Сменить пароль</b>
        <div class="two" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          <input class="input" id="kpOld" type="password" placeholder="Старый пароль" autocomplete="current-password" value="${esc(P.old)}" aria-label="Старый пароль">
          <input class="input" id="kpNew" type="password" placeholder="Новый пароль" autocomplete="new-password" value="${esc(P.n1)}" aria-label="Новый пароль">
          <input class="input" id="kpNew2" type="password" placeholder="Повтори новый" autocomplete="new-password" value="${esc(P.n2)}" aria-label="Повтори новый пароль">
        </div>
        <button type="button" class="btn2" style="align-self:flex-start" data-act="kPassword">Сменить пароль</button></div>
    </div>
  </div>`;
}

async function kaccDo(run, okText) {
  try { const a = await run(); if (a && a.login) S.kacc.account = a; if (okText) toast(okText, true); }
  catch (e) { toast(errText(e)); if (/войди заново|Войди в аккаунт/i.test(errText(e))) { S.kacc.account = null; renderGate(); } }
  render();
}

const ACC_ACTIONS = {
  gMode: (id) => { const keep = S.auth.login; S.auth = blankAuth(); S.auth.mode = id; S.auth.login = keep; renderGate(); },
  gSkip: () => { S.kacc.skip = true; renderGate(); },
  gOpen: () => { S.kacc.skip = false; S.auth = blankAuth(); renderGate(); },
  kLogout: async () => { await K.kacc.logout(); S.kacc = { checked: true, account: null, offline: false }; S.auth = blankAuth(); S.screen = 'home'; render(); renderGate(); },
  openSiteProfile: () => K.kacc.openProfile(),
  kSaveStatus: () => { const el = $('#kStatus'); kaccDo(() => K.kacc.update({ status: el ? el.value : '' }), 'Статус сохранён').then(() => { S.kStatus = null; }); },
  kShowDiscord: () => { const a = kAcc(); kaccDo(() => K.kacc.update({ showDiscord: !(a && a.showDiscord) })); },
  kUnlink: () => kaccDo(() => K.kacc.discordUnlink(), 'Discord отвязан'),
  kLink: async () => {
    try { await K.kacc.discordLink(); } catch (e) { return toast(errText(e)); }
    S.kLinkWait = true; render();
    // Пока игрок подтверждает в браузере, раз в 4 секунды спрашиваем сайт (до 3 минут)
    let n = 0;
    clearInterval(S.kLinkTimer);
    S.kLinkTimer = setInterval(async () => {
      n++;
      const r = await K.kacc.me().catch(() => null);
      if ((r && r.account && r.account.discordLinked) || n > 45) {
        clearInterval(S.kLinkTimer); S.kLinkWait = false;
        if (r && r.account) S.kacc.account = r.account;
        if (r && r.account && r.account.discordLinked) toast('Discord привязан', true);
        render();
      }
    }, 4000);
  },
  kPassword: () => {
    const P = S.kpw;
    if (!P.old || !P.n1) return toast('Заполни старый и новый пароль');
    if (P.n1 !== P.n2) return toast('Новые пароли не совпадают');
    kaccDo(() => K.kacc.password(P.old, P.n1), 'Пароль изменён').then(() => { S.kpw = { old: '', n1: '', n2: '' }; render(); });
  },
  // Аватарка и баннер
  kAvDefault: (c) => kaccDo(() => K.kacc.avatarDefault(c), 'Аватарка обновлена'),
  kAvPick: () => kaccDo(() => K.kacc.avatarPick(), 'Аватарка обновлена'),
  kAvSkin: () => {
    if (!S.avatar || !S.avatar.url) return toast('Сначала нужен скин — его можно поставить в Настройки → Minecraft');
    kaccDo(() => K.kacc.avatarSkin(S.avatar.url), '3D-аватарка поставлена');
  },
  kBanPick: () => kaccDo(() => K.kacc.bannerPick(), 'Баннер обновлён'),
  kBanReset: () => kaccDo(() => K.kacc.bannerReset(), 'Баннер убран')
};

// Поля экрана входа и настроек аккаунта — без перерисовки на каждую букву
document.addEventListener('input', (ev) => {
  const t = ev.target, A = S.auth;
  const map = { gLogin: 'login', gPass: 'pass', gPass2: 'pass2', gAge: 'age', gCode: 'code' };
  if (map[t.id]) { A[map[t.id]] = t.value; if (A.err) { A.err = ''; const e = document.querySelector('.g-err'); if (e) e.remove(); } }
  const pm = { kpOld: 'old', kpNew: 'n1', kpNew2: 'n2' };
  if (pm[t.id]) S.kpw[pm[t.id]] = t.value;
  if (t.id === 'kStatus') S.kStatus = t.value;
});
document.addEventListener('submit', (ev) => { if (ev.target.id === 'gForm') { ev.preventDefault(); gateSubmit(); } });
