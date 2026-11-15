'use strict';
// Сеть: JSON-запросы и параллельная загрузка файлов с проверкой размера и SHA-1.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'KomoriLauncher/0.8';

// ----- Зеркало для NeoForge и Forge -----
// У части игроков (например, из России) их сервер не открывается. Тогда качаем через komori.fun/mvn,
// который берёт файлы с того же официального сервера. Хэши SHA-1 при этом проверяются как обычно.
let mirrorBase = '';
const MIRRORED = { 'maven.neoforged.net': 'neoforged', 'maven.minecraftforge.net': 'forge' };
const badHosts = new Set();   // хосты, которые уже не открылись — дальше сразу через зеркало
function setMirrorBase(b) { mirrorBase = /^https:\/\/[^\s]+$/.test(String(b || '')) ? String(b).replace(/\/+$/, '') : ''; }
function mirrorUrl(url) {
  try {
    const u = new URL(url);
    const k = MIRRORED[u.hostname];
    return k && mirrorBase ? `${mirrorBase}/mvn/${k}${u.pathname}` : null;
  } catch { return null; }
}
// fetch с запасным путём: ждём ответа не дольше 20 с (заблокированный сервер обычно просто молчит),
// при ошибке сети, таймауте или 403/451/5xx пробуем зеркало
async function fetchSmart(url, opts = {}) {
  const alt = mirrorUrl(url);
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  const direct = async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, ac.signal]) : ac.signal;
    try { return await fetch(url, Object.assign({}, opts, { signal })); } finally { clearTimeout(timer); }
  };
  if (!alt) return fetch(url, opts);
  if (!badHosts.has(host)) {
    try {
      const r = await direct();
      if (r.ok || r.status === 404) return r;
      if (![403, 451].includes(r.status) && r.status < 500) return r;
    } catch (e) { if (opts.signal && opts.signal.aborted) throw e; }
    badHosts.add(host);
  }
  return fetch(alt, opts);
}

async function fetchJson(url, opts = {}) {
  const res = await fetchSmart(url, Object.assign({ headers: { 'User-Agent': UA } }, opts));
  if (!res.ok) throw new Error(`HTTP ${res.status} при запросе ${url}`);
  return res.json();
}

function sha1File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(p).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

// «Починить сборку»: на время проверки сверяем SHA-1 у всех файлов, а не только размер
let verifyAll = false;
function setVerifyAll(v) { verifyAll = !!v; }

// Нужно ли качать файл: нет файла, другой размер или (если verify) другой SHA-1.
async function needsDownload(t) {
  try {
    const st = await fs.promises.stat(t.dest);
    if (t.size && st.size !== t.size) return true;
    if ((t.verify || verifyAll) && t.sha1) return (await sha1File(t.dest)) !== t.sha1;
    return false;
  } catch { return true; }
}

function cancelled() { const e = new Error('Загрузка отменена'); e.cancelled = true; return e; }

// tok — необязательный { cancelled, ac: AbortController }: по «Остановить» загрузка рвётся сразу
async function downloadOne(t, tries = 3, tok) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    if (tok && tok.cancelled) throw cancelled();
    try {
      const res = await fetchSmart(t.url, { headers: { 'User-Agent': UA }, signal: tok && tok.ac ? tok.ac.signal : undefined });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${t.url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (t.sha1) {
        const got = crypto.createHash('sha1').update(buf).digest('hex');
        if (got !== t.sha1) throw new Error(`Повреждённый файл (SHA-1 не совпал): ${t.url}`);
      }
      await fs.promises.mkdir(path.dirname(t.dest), { recursive: true });
      const tmp = t.dest + '.part';
      await fs.promises.writeFile(tmp, buf);
      await fs.promises.rename(tmp, t.dest);
      return;
    } catch (e) {
      if (tok && tok.cancelled) throw cancelled();
      lastErr = e;
      await new Promise(r => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

// tasks: [{ url, dest, sha1?, size?, verify? }]; onProgress(done, total)
async function downloadAll(tasks, onProgress, concurrency = 16, tok) {
  const seen = new Set();
  const unique = tasks.filter(t => (seen.has(t.dest) ? false : (seen.add(t.dest), true)));
  const todo = [];
  for (const t of unique) if (await needsDownload(t)) todo.push(t);
  let done = 0;
  const total = todo.length;
  if (onProgress) onProgress(0, total);
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      if (tok && tok.cancelled) throw cancelled();
      const t = todo[next++];
      await downloadOne(t, 3, tok);
      done++;
      if (onProgress) onProgress(done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return total;
}

module.exports = { fetchJson, fetchSmart, setMirrorBase, downloadAll, sha1File, setVerifyAll, UA };
