// Сборка сайта в ОДИН файл dist/worker.js (его можно целиком вставить в редактор Cloudflare).
// Запуск: node site/build.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => path.join(dir, 'src', p);

const partials = fs.readFileSync(src('partials.html'), 'utf8');
const part = (name) => { const m = partials.match(new RegExp(`<!--${name}-->\\n([\\s\\S]*?)\\n<!--`)); if (!m) throw new Error('нет блока ' + name); return m[1]; };
const HEAD = part('HEAD') + '\n<!--BOOT-->\n' + part('BOOT');

const PAGES = {};
for (const f of fs.readdirSync(src('pages'))) {
  if (!f.endsWith('.html')) continue;
  let html = fs.readFileSync(src('pages/' + f), 'utf8');
  for (const [mark, val] of [['<!--KOMORI_HEAD-->', HEAD], ['<!--KOMORI_HEADER-->', part('HEADER')], ['<!--KOMORI_FOOTER-->', part('FOOTER')]]) {
    if (!html.includes(mark)) throw new Error(f + ': нет ' + mark);
    html = html.replace(mark, val);
  }
  // Шаблон страницы прячем в <template>, чтобы браузер не грузил картинки с {{...}} до отрисовки,
  // а sc-for/sc-if сразу превращаем в <template data-sc> — их можно ставить даже внутри таблиц.
  html = html.replace(/<sc-for\b/g, '<template data-sc="for"').replace(/<\/sc-for>/g, '</template>')
    .replace(/<sc-if\b/g, '<template data-sc="if"').replace(/<\/sc-if>/g, '</template>')
    .replace('<x-dc>', '<template id="komori-tpl">').replace('</x-dc>', '</template><x-dc></x-dc>');
  PAGES[f.replace('.html', '')] = html;
}
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp' };
const ASSETS = {};
for (const f of fs.readdirSync(src('assets'))) ASSETS[f] = { type: TYPES[f.split('.').pop()] || 'application/octet-stream', b64: fs.readFileSync(src('assets/' + f)).toString('base64') };
const RUNTIME = fs.readFileSync(src('base.js'), 'utf8') + '\n' + fs.readFileSync(src('komori-dc.js'), 'utf8');

const worker = fs.readFileSync(src('worker.js'), 'utf8').replace(/^import .*bundle\.js';\n/m, '');
const out = `// Komori site — собранный файл, не редактировать вручную (исходники в site/src, сборка: node site/build.mjs)\n` +
  `const PAGES = ${JSON.stringify(PAGES)};\nconst ASSETS = ${JSON.stringify(ASSETS)};\nconst RUNTIME = ${JSON.stringify(RUNTIME)};\n` + worker;
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
fs.writeFileSync(path.join(dir, 'dist', 'worker.js'), out);
console.log('dist/worker.js', (out.length / 1024).toFixed(0) + ' КБ, страниц:', Object.keys(PAGES).join(', '));
