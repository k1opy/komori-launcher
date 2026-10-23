'use strict';
// ===== authlib-injector для скинов офлайн-аккаунтов (п.2) =====
// Java-агент, который заставляет игру брать скины игроков с сервера скинов Komori, а не с Mojang.
// Работает на любой версии/загрузчике, моды не нужны. В лаунчер не встраивается (лицензия AGPL):
// скачивается с официального сайта при первом запуске и проверяется по SHA-256.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { UA } = require('./net');

const LATEST = 'https://authlib-injector.yushi.moe/artifact/latest.json';
const HOST = 'authlib-injector.yushi.moe';
const RECHECK_MS = 24 * 3600 * 1000;

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// Возвращает путь к jar или null (если скачать не удалось и копии нет — игра запустится без скинов).
async function ensure(root, log) {
  const dir = path.join(root, 'authlib-injector');
  const metaFile = path.join(dir, 'latest.json');
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch {}
  const have = meta && fs.existsSync(path.join(dir, meta.file)) ? path.join(dir, meta.file) : null;
  if (have && Date.now() - (meta.checked || 0) < RECHECK_MS) return have;

  try {
    const res = await fetch(LATEST, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const u = new URL(j.download_url);
    const want = String(j.checksums && j.checksums.sha256 || '').toLowerCase();
    if (u.protocol !== 'https:' || u.hostname !== HOST || !/^[0-9a-f]{64}$/.test(want)) throw new Error('неожиданный ответ');
    const file = path.basename(u.pathname).replace(/[^A-Za-z0-9._-]/g, '_');
    const dest = path.join(dir, file);
    if (!(fs.existsSync(dest) && sha256(fs.readFileSync(dest)) === want)) {
      const r = await fetch(u.href, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (sha256(buf) !== want) throw new Error('контрольная сумма не совпала');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dest + '.tmp', buf);
      fs.renameSync(dest + '.tmp', dest);
    }
    fs.writeFileSync(metaFile, JSON.stringify({ file, sha256: want, checked: Date.now() }));
    return dest;
  } catch (e) {
    if (log) log(`[Komori] authlib-injector: ${e.message}${have ? ', используем сохранённую копию' : ', скины офлайн-игроков в этот раз не загрузятся'}\n`);
    return have;
  }
}

module.exports = { ensure };
