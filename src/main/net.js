'use strict';
// Сеть: JSON-запросы и параллельная загрузка файлов с проверкой размера и SHA-1.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'KomoriLauncher/0.5';

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, Object.assign({ headers: { 'User-Agent': UA } }, opts));
  if (!res.ok) throw new Error(`HTTP ${res.status} при запросе ${url}`);
  return res.json();
}

function sha1File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(p).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

// Нужно ли качать файл: нет файла, другой размер или (если verify) другой SHA-1.
async function needsDownload(t) {
  try {
    const st = await fs.promises.stat(t.dest);
    if (t.size && st.size !== t.size) return true;
    if (t.verify && t.sha1) return (await sha1File(t.dest)) !== t.sha1;
    return false;
  } catch { return true; }
}

async function downloadOne(t, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(t.url, { headers: { 'User-Agent': UA } });
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
      lastErr = e;
      await new Promise(r => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

// tasks: [{ url, dest, sha1?, size?, verify? }]; onProgress(done, total)
async function downloadAll(tasks, onProgress, concurrency = 16) {
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
      const t = todo[next++];
      await downloadOne(t);
      done++;
      if (onProgress) onProgress(done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return total;
}

module.exports = { fetchJson, downloadAll, sha1File, UA };
