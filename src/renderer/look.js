'use strict';
/* Komori Launcher — внешний вид: акцентные цвета, 3D-аватарка из скина, график активности, уровень. */

// ---------- акцент ----------
// Для каждой темы свой оттенок, чтобы цвет читался и на графите, и на бежевом фоне
const ACCENTS = [
  ['graphite', 'Графит', '#C9CDD3', '#3A3F47'],
  ['beige', 'Бежевый', '#E3D3B4', '#9C845A'],
  ['blue', 'Синий', '#3B82F6', '#2563EB'],
  ['violet', 'Фиолетовый', '#8B5CF6', '#7C3AED'],
  ['green', 'Зелёный', '#22C55E', '#16A34A'],
  ['red', 'Красный', '#EF4444', '#DC2626'],
  ['pink', 'Розовый', '#EC4899', '#DB2777'],
  ['yellow', 'Жёлтый', '#EAB308', '#CA8A04'],
  ['orange', 'Оранжевый', '#F97316', '#EA580C']
];
function isDark() { return document.body.classList.contains('theme-dark'); }
function accentHex(id, dark) {
  const a = ACCENTS.find(x => x[0] === id) || ACCENTS[3];
  return (dark === undefined ? isDark() : dark) ? a[2] : a[3];
}
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function applyAccent() {
  const id = (S.settings && S.settings.accent) || 'violet';
  const hex = accentHex(id);
  const st = document.body.style;
  st.setProperty('--accent', hex);
  st.setProperty('--accent2', hex);
  st.setProperty('--on-accent', contrast(hex, '#FFFFFF') >= contrast(hex, '#0B0D10') ? '#FFFFFF' : '#0B0D10');
  st.setProperty('--accent-text', hex);
}

// ---------- уровень и значки ----------
// Опыт = минуты в игре. С уровня L на L+1 нужно 30·L минут (1→2 — полчаса, 10→11 — 5 часов).
function levelInfo(totalSec) {
  const xp = Math.floor((totalSec || 0) / 60);
  let L = 1;
  while (15 * (L + 1) * L <= xp) L++;
  const base = 15 * L * (L - 1), need = 30 * L;
  return { level: L, xp: xp - base, need, pct: Math.min(100, Math.round((xp - base) / need * 100)) };
}
function dayKeyR(ts) { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function streaks(days) {
  const has = k => (days[k] || 0) >= 60;
  let cur = 0, t = Date.now();
  if (!has(dayKeyR(t))) t -= 864e5;            // сегодня ещё не играл — серия не сгорела
  while (has(dayKeyR(t))) { cur++; t -= 864e5; }
  const keys = Object.keys(days).filter(has).sort();
  let best = 0, run = 0, prev = 0;
  keys.forEach(k => { const ts = new Date(k + 'T12:00').getTime(); run = prev && Math.round((ts - prev) / 864e5) === 1 ? run + 1 : 1; prev = ts; best = Math.max(best, run); });
  return { cur, best: Math.max(best, cur) };
}
function badges(st, lv, sk) {
  const h = (st.total || 0) / 3600, kh = (st.komori || 0) / 3600;
  return [
    ['5', 'Уровень 5', lv.level >= 5], ['10', 'Уровень 10', lv.level >= 10], ['25', 'Уровень 25', lv.level >= 25], ['50', 'Уровень 50', lv.level >= 50],
    ['10ч', '10 часов в игре', h >= 10], ['100ч', '100 часов в игре', h >= 100], ['500ч', '500 часов в игре', h >= 500],
    ['7д', 'Играл 7 дней подряд', sk.best >= 7], ['K', '50 часов на Komori', kh >= 50]
  ].map(([n, t, got]) => ({ n, t, got }));
}
function fmtHours(sec) {
  const m = Math.round((sec || 0) / 60);
  if (m < 60) return m + ' мин';
  const h = Math.floor(m / 60), r = m % 60;
  return h >= 100 ? h.toLocaleString('ru-RU') + ' ч' : h + ' ч' + (r ? ' ' + r + ' мин' : '');
}

// ---------- график активности ----------
const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const WD_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const PERIODS = [['d', '24 ч'], ['w', '7 дней'], ['m', '30 дней'], ['y', 'Год']];

// Значения в секундах за текущий и прошлый период
function activitySeries(st, period) {
  const days = st.days || {}, hours = st.hours || {}, now = st.now || Date.now();
  const pts = [], prev = [];
  if (period === 'd') {
    const hourAt = ts => { const d = new Date(ts); const h = hours[dayKeyR(ts)]; return h ? h[d.getHours()] || 0 : 0; };
    for (let i = 23; i >= 0; i--) {
      const ts = now - i * 3600e3, d = new Date(ts);
      pts.push({ v: hourAt(ts), l: d.getHours() % 6 === 0 ? String(d.getHours()) : '', tip: String(d.getHours()).padStart(2, '0') + ':00' });
      prev.push(hourAt(ts - 864e5));
    }
  } else if (period === 'w' || period === 'm') {
    const n = period === 'w' ? 7 : 30;
    for (let i = n - 1; i >= 0; i--) {
      const ts = now - i * 864e5, d = new Date(ts);
      pts.push({ v: days[dayKeyR(ts)] || 0, l: period === 'w' ? WD[d.getDay()] : ((n - 1 - i) % 7 === 0 ? String(d.getDate()) : ''),
        tip: period === 'w' ? WD_FULL[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS_GEN[d.getMonth()] : d.getDate() + ' ' + MONTHS_GEN[d.getMonth()] });
      prev.push(days[dayKeyR(ts - n * 864e5)] || 0);
    }
  } else {
    const byMonth = {};
    Object.keys(days).forEach(k => { const m = k.slice(0, 7); byMonth[m] = (byMonth[m] || 0) + days[k]; });
    const d0 = new Date(now);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1), dp = new Date(d0.getFullYear(), d0.getMonth() - i - 12, 1);
      const key = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0');
      pts.push({ v: byMonth[key(d)] || 0, l: MONTHS[d.getMonth()], tip: MONTHS_FULL[d.getMonth()] + ' ' + d.getFullYear() });
      prev.push(byMonth[key(dp)] || 0);
    }
  }
  return { pts, sum: pts.reduce((s, p) => s + p.v, 0), prevSum: prev.reduce((s, v) => s + v, 0) };
}

function niceTop(v) {
  const steps = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500, 600, 800, 1000];
  return steps.find(x => x >= v) || Math.ceil(v / 100) * 100;
}
function activityChart(st, period) {
  const ser = activitySeries(st, period);
  const unitMin = period === 'd';
  const vals = ser.pts.map(p => unitMin ? p.v / 60 : p.v / 3600);
  const top = niceTop(Math.max.apply(null, vals.concat([unitMin ? 30 : 1])));
  const W = 600, H = 150, n = vals.length;
  const X = i => (i + 0.5) * W / n, Y = v => H - v / top * (H - 8);
  const P = vals.map((v, i) => [X(i), Y(v)]);
  let line = 'M' + P[0][0].toFixed(1) + ' ' + P[0][1].toFixed(1);
  for (let i = 0; i < n - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2, t = 0.18;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, Math.min(H, p1[1] + (p2[1] - p0[1]) * t)];
    const c2 = [p2[0] - (p3[0] - p1[0]) * t, Math.min(H, p2[1] - (p3[1] - p1[1]) * t)];
    line += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const area = line + ` L${P[n - 1][0].toFixed(1)} ${H} L${P[0][0].toFixed(1)} ${H}Z`;
  const avg = ser.sum / n, avgY = Y(unitMin ? avg / 60 : avg / 3600);
  const yl = [top, top / 2, 0].map(v => v ? (Number.isInteger(v) ? v : v.toFixed(1)) + (unitMin ? 'м' : 'ч') : '0');
  let delta = '';
  if (ser.prevSum > 0) { const d = Math.round((ser.sum - ser.prevSum) / ser.prevSum * 100); delta = `<span class="act-delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${Math.abs(d)}% к прошлому периоду</span>`; }
  else if (ser.sum > 0) delta = '<span class="act-delta up">Первый период с игрой</span>';
  const cols = ser.pts.map((p, i) => `<div class="act-col"><span class="act-dot" style="top:${(P[i][1] / H * 100).toFixed(2)}%"></span>
    <span class="act-tip" style="top:${(P[i][1] / H * 100).toFixed(2)}%">${esc(p.tip)} · ${esc(fmtHours(p.v))}</span></div>`).join('');
  return `<div class="act-sum"><b>${esc(fmtHours(ser.sum))}</b><span>в игре за период</span>${delta}</div>
    <div class="act-chart ${n <= 7 ? 'few' : ''}">
      <div class="act-y">${yl.map(v => `<span>${v}</span>`).join('')}</div>
      <div class="act-plot">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 0.5H${W}M0 ${H / 2}H${W}" class="g"/><path d="M0 ${H - 0.5}H${W}" class="g2"/>
          ${ser.sum ? `<path d="M0 ${avgY.toFixed(1)}H${W}" class="avg"/>` : ''}
          <path d="${area}" class="area"/><path d="${line}" class="ln"/>
        </svg>
        ${ser.sum ? `<span class="act-avg" style="top:${(avgY / H * 100).toFixed(2)}%">среднее ${esc(fmtHours(avg))}</span>` : '<span class="act-empty">Пока пусто — поиграй, и здесь появится график</span>'}
        <div class="act-cols">${cols}</div>
      </div>
    </div>
    <div class="act-x">${ser.pts.map(p => `<span>${esc(p.l)}</span>`).join('')}</div>`;
}

// ---------- 3D-аватарка из скина (three.js, без сети) ----------
const AV_POSES = [['bust', 'Бюст'], ['head', 'Голова 3D']];
const AV_LIGHTS = [['studio', 'Студия'], ['side', 'Сбоку'], ['soft', 'Мягкий'], ['rim', 'Контровой']];
const AV_BGS = [['glow', 'Пятно света'], ['solid', 'Цвет'], ['image', 'Картинка'], ['none', 'Без фона']];
const POSE_DEF = {
  bust: { cam: [0, 27, 40], look: [0, 25, 0], fov: 32, head: [0, 0, 0], rArm: [0, 0, 4], lArm: [0, 0, -4] },
  head: { cam: [16, 33, 22], look: [0, 28.5, 0], fov: 30, head: [-4, 0, 0], rArm: [0, 0, 3], lArm: [0, 0, -3] }
};
const LIGHT_DEF = {
  studio: { key: [-18, 40, 34], ki: 0.95, hemi: 0.55, rim: 0 },
  side: { key: [-40, 24, 10], ki: 1.2, hemi: 0.35, rim: 0 },
  soft: { key: [0, 40, 40], ki: 0.55, hemi: 0.85, rim: 0 },
  rim: { key: [-14, 36, 30], ki: 0.75, hemi: 0.45, rim: 1.1 }
};
let AV3 = null;
function av3Init() {
  if (AV3 || !window.THREE) return AV3;
  const T = window.THREE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  let renderer;
  try { renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch { return null; }
  renderer.setSize(512, 512, false);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputEncoding = T.sRGBEncoding;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(30, 1, 1, 500);
  const hemi = new T.HemisphereLight(0xffffff, 0x404050, 0.55); scene.add(hemi);
  const key = new T.DirectionalLight(0xffffff, 0.95);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0008; key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -30, right: 30, top: 40, bottom: -10, near: 1, far: 200 });
  scene.add(key); scene.add(key.target); key.target.position.set(0, 18, 0);
  const rim = new T.DirectionalLight(0xffffff, 0); rim.position.set(18, 30, -30); scene.add(rim); scene.add(rim.target); rim.target.position.set(0, 20, 0);
  const wall = new T.Mesh(new T.PlaneGeometry(400, 400), new T.ShadowMaterial({ opacity: 0.2 }));
  wall.position.z = -14; wall.receiveShadow = true; scene.add(wall);
  const player = new T.Group(); scene.add(player);
  AV3 = { T, renderer, canvas, scene, camera, hemi, key, rim, wall, player, rig: null, tex: null };
  return AV3;
}
function av3Build(img) {
  const { T, player } = AV3, S64 = 64;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  if (img.height === 32) { g.drawImage(img, 0, 0); g.drawImage(c, 0, 16, 16, 16, 16, 48, 16, 16); g.drawImage(c, 40, 16, 16, 16, 32, 48, 16, 16); }
  else g.drawImage(img, 0, 0, 64, 64);
  const slim = g.getImageData(54, 20, 1, 1).data[3] === 0;
  if (AV3.tex) AV3.tex.dispose();
  const tex = AV3.tex = new T.CanvasTexture(c);
  tex.magFilter = tex.minFilter = T.NearestFilter; tex.generateMipmaps = false; tex.encoding = T.sRGBEncoding;
  const mBase = new T.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, alphaTest: 0.5 });
  const mOver = new T.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, transparent: true, alphaTest: 0.5, side: T.DoubleSide });
  const uvBox = (geo, u, v, w, h, d) => {
    const f = [[u + d + w, v + d, d, h], [u, v + d, d, h], [u + d, v, w, d], [u + d + w, v, w, d], [u + d, v + d, w, h], [u + 2 * d + w, v + d, w, h]];
    const uv = geo.attributes.uv;
    f.forEach((q, i) => {
      const u0 = q[0] / S64, u1 = (q[0] + q[2]) / S64, vt = 1 - q[1] / S64, vb = 1 - (q[1] + q[3]) / S64;
      const pts = i === 3 ? [[u0, vb], [u1, vb], [u0, vt], [u1, vt]] : [[u0, vt], [u1, vt], [u0, vb], [u1, vb]];
      pts.forEach((p, k) => uv.setXY(i * 4 + k, p[0], p[1]));
    });
    uv.needsUpdate = true; return geo;
  };
  const part = (w, h, d, u, v, ou, ov, inf) => {
    const grp = new T.Group();
    const a = new T.Mesh(uvBox(new T.BoxGeometry(w, h, d), u, v, w, h, d), mBase);
    const b = new T.Mesh(uvBox(new T.BoxGeometry(w + inf * 2, h + inf * 2, d + inf * 2), ou, ov, w, h, d), mOver);
    [a, b].forEach(m => { m.castShadow = true; grp.add(m); });
    return grp;
  };
  while (player.children.length) player.remove(player.children[0]);
  const aw = slim ? 3 : 4;
  const body = part(8, 12, 4, 16, 16, 16, 32, 0.25); body.position.set(0, 18, 0);
  const head = new T.Group(); head.position.set(0, 24, 0);
  const hm = part(8, 8, 8, 0, 0, 32, 0, 0.5); hm.position.set(0, 4, 0); head.add(hm);
  const limb = (x, y, w, u, v, ou, ov, ox, oy) => { const p = new T.Group(); p.position.set(x, y, 0); const m = part(w, 12, 4, u, v, ou, ov, 0.25); m.position.set(ox, oy, 0); p.add(m); return p; };
  // Ось плеча на 5 px от центра, сама рука — на 6 px (тонкая — на 5,5), как в игре
  const off = aw === 4 ? 1 : 0.5;
  const rArm = limb(-5, 22, aw, 40, 16, 40, 32, -off, -4);
  const lArm = limb(5, 22, aw, 32, 48, 48, 48, off, -4);
  const rLeg = limb(-2, 12, 4, 0, 16, 0, 32, 0, -6), lLeg = limb(2, 12, 4, 16, 48, 0, 48, 0, -6);
  [body, head, rArm, lArm, rLeg, lLeg].forEach(o => player.add(o));
  AV3.rig = { head, rArm, lArm };
}
function shadeHex(hex, k) {
  const n = parseInt(hex.slice(1), 16), f = v => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function paintAvatarBg(ctx, w, o, bgImg) {
  ctx.clearRect(0, 0, w, w);
  if (o.bg === 'none') return;
  if (o.bg === 'image' && bgImg) { const s = Math.max(w / bgImg.width, w / bgImg.height); ctx.drawImage(bgImg, (w - bgImg.width * s) / 2, (w - bgImg.height * s) / 2, bgImg.width * s, bgImg.height * s); return; }
  const c = o.color;
  ctx.fillStyle = o.bg === 'glow' ? shadeHex(c, -0.35) : c; ctx.fillRect(0, 0, w, w);
  if (o.bg === 'glow') {
    const g = ctx.createRadialGradient(w * 0.28, w * 0.22, 0, w * 0.28, w * 0.22, w * 0.95);
    g.addColorStop(0, shadeHex(c, 0.35)); g.addColorStop(0.45, c); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
  }
}
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

// o: { pose, light, bg, color, bgImage } → dataURL 512×512
async function renderAvatar(skinData, o) {
  if (!av3Init()) throw new Error('WebGL недоступен');
  const { T, renderer, camera, key, hemi, rim, wall, player } = AV3;
  const img = await loadImg(skinData);
  av3Build(img);
  const D = Math.PI / 180, P = POSE_DEF[o.pose] || POSE_DEF.bust, L = LIGHT_DEF[o.light] || LIGHT_DEF.studio;
  ['head', 'rArm', 'lArm'].forEach(k => { const a = P[k]; AV3.rig[k].rotation.set(a[0] * D, a[1] * D, a[2] * D); });
  camera.position.set(...P.cam); camera.fov = P.fov; camera.lookAt(new T.Vector3(...P.look)); camera.updateProjectionMatrix();
  key.position.set(...L.key); key.intensity = L.ki; hemi.intensity = L.hemi;
  rim.intensity = L.rim; rim.color.set(o.bg === 'solid' || o.bg === 'glow' ? o.color : '#ffffff');
  wall.visible = o.bg !== 'none';
  renderer.render(AV3.scene, camera);
  const out = document.createElement('canvas'); out.width = out.height = 512;
  const ctx = out.getContext('2d');
  const bgImg = o.bg === 'image' && o.bgImage ? await loadImg(o.bgImage).catch(() => null) : null;
  paintAvatarBg(ctx, 512, o, bgImg);
  ctx.drawImage(AV3.canvas, 0, 0);
  return out.toDataURL('image/png');
}
