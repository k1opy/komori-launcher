/* Общие значения для шапки и подвала всех страниц ({{K.*}}).
 * window.KOMORI приходит от сервера: { me, page, cfg: { discord, launcher, map }, flash }. */
(function () {
  'use strict';
  var NAV = [
    { id: 'main', label: 'Главная', href: '/' },
    { id: 'news', label: 'Новости', href: '/news' },
    { id: 'rules', label: 'Правила', href: '/rules' },
    { id: 'wiki', label: 'Вики', href: '/wiki' },
    { id: 'map', label: 'Карта', href: '/map' }
  ];
  window.KomoriBase = function () {
    var k = window.KOMORI || {}, me = k.me, cfg = k.cfg || {}, b = (k.site && k.site.banner) || {};
    return {
      site: k.site || {}, mdHelp: window.KomoriMDHelp,
      banner: !!(b.on && b.text), bannerHtml: b.text ? window.KomoriInline(b.text) : '', bannerLink: b.link || '', bannerTone: 'k-banner ' + (b.tone || 'accent'),
      bannerHasLink: !!(b.on && b.text && b.link),
      loggedIn: !!me, loggedOut: !me, admin: !!(me && me.admin),
      name: me ? me.name : '',
      avatar: me ? me.avatar : '',
      loginUrl: '/auth/login?next=' + encodeURIComponent(location.pathname),
      logout: function () {
        fetch('/auth/logout', { method: 'POST' }).finally(function () { location.href = '/'; });
      },
      nav: NAV.map(function (n) {
        var on = n.id === k.page;
        return { label: n.label, href: n.href, current: on ? 'page' : 'false', bg: on ? '#8B3DFF' : 'transparent', color: on ? '#FFFFFF' : '#C7BBE6' };
      }),
      discord: cfg.discord, launcher: cfg.launcher, map: cfg.map, social: cfg.social || [],
      flash: k.flash || '', flashJoin: k.flash === 'Сначала зайди на наш сервер Discord, потом войди на сайт.'
    };
  };
})();

/* Текст в разметке Discord (+ немного своей) → безопасный HTML. Весь текст сначала экранируется.
 * Блоки: # ## ### заголовки · списки «• », «- » · «1.1 текст» — пункт правил · «+ Заголовок | текст» — карточка
 *        «> текст» — заметка · таблицы | a | b | · ![](картинка) · --- линия
 * В строке: **жирный**, *курсив*, __подчёркнутый__, ~~зачёркнутый~~, `код`, ||спойлер||, [текст](ссылка), ссылки https://
 * Пинги ролей <@&id> скрываются. */
(function () {
  'use strict';
  var RANK = { D: '#A9A2C0', C: '#7BD88F', B: '#6FA8FF', A: '#C99BFF', S: '#FFC857', SS: '#FF7EDB' };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { u = u.replace(/&amp;/g, '&'); return /^(https:\/\/|\/(?!\/))[^\s"'<>]*$/.test(u) ? esc(u) : ''; }
  function inline(t) {
    var codes = [];
    t = t.replace(/`([^`]+)`/g, function (_, c) { codes.push('<code>' + c + '</code>'); return '\u0000' + (codes.length - 1) + '\u0000'; });
    t = t
      .replace(/\|\|([\s\S]+?)\|\|/g, '<span class="md-spoiler" tabindex="0">$1</span>')
      .replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>')
      .replace(/__([\s\S]+?)__/g, '<u>$1</u>')
      .replace(/~~([\s\S]+?)~~/g, '<s>$1</s>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
        var u = safeUrl(url); if (!u) return m;
        return '<a href="' + u + '"' + (u.charAt(0) === '/' ? '' : ' target="_blank" rel="noopener"') + '>' + label + '</a>';
      })
      .replace(/(^|[\s(>])(https:\/\/[^\s<]+[^\s<.,;:!?)])/g, function (m, pre, url) { return pre + '<a href="' + url + '" target="_blank" rel="noopener">' + url + '</a>'; });
    return t.replace(/\u0000(\d+)\u0000/g, function (_, i) { return codes[+i]; });
  }
  function cell(c) {
    c = c.trim();
    if (RANK[c]) return '<span class="md-rank" style="--c:' + RANK[c] + '">' + c + '</span>';
    return inline(c);
  }
  function splitRow(t) { return t.replace(/^\|/, '').replace(/\|$/, '').split('|'); }
  // В постах Discord весь текст жирный — на сайте целиком жирные строки показываем обычным шрифтом
  function unboldAll(t) { var m = /^\*\*([\s\S]*)\*\*$/.exec(t); return m && m[1].indexOf('**') < 0 ? m[1] : t; }
  function prepare(src) {
    return esc(String(src || '').replace(/\r/g, ''))
      .replace(/\|\|\s*&lt;@&amp;\d+&gt;\s*\|\|/g, '')   // пинг роли в спойлере
      .replace(/&lt;@&amp;\d+&gt;/g, '')                    // просто пинг роли
      .replace(/&lt;#\d+&gt;/g, '');                        // ссылка на канал
  }
  window.KomoriMD = function (src, title) {
    var lines = prepare(src).split('\n'), out = [], para = [], boldOpen = false, open = '';
    function flushPara() { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } }
    function close() { if (open) { out.push({ ul: '</ul>', cards: '</div>', rules: '</div>' }[open]); open = ''; } }
    function begin(kind) { flushPara(); if (open !== kind) { close(); out.push({ ul: '<ul>', cards: '<div class="md-cards">', rules: '<div class="md-rules">' }[kind]); open = kind; } }
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      // жирный, растянутый на несколько строк, разбиваем по строкам, чтобы не ломать заголовки и списки
      var cnt = (raw.match(/\*\*/g) || []).length;
      var line = (boldOpen ? '**' : '') + raw;
      if ((cnt % 2) === 1) boldOpen = !boldOpen;
      if (boldOpen) line += '**';
      var t = line.trim(), m;
      if (!t || t === '****') { flushPara(); close(); continue; }
      if ((m = /^(\*\*)?\s*(#{1,3})\s+(.*?)(\*\*)?$/.exec(t))) {
        var ht = m[3].replace(/\*\*/g, '');
        // первый заголовок, совпадающий с заголовком новости, не повторяем
        if (title && !out.length && ht.trim().toLowerCase() === String(title).trim().toLowerCase()) continue;
        flushPara(); close(); var lv = Math.min(m[2].length + 1, 4); out.push('<h' + lv + '>' + inline(ht) + '</h' + lv + '>'); continue;
      }
      if (/^-{3,}$/.test(t)) { flushPara(); close(); out.push('<hr>'); continue; }
      if ((m = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(t))) {
        var u = safeUrl(m[2]); flushPara(); close();
        if (u) out.push('<img class="md-img" src="' + u + '" alt="' + m[1] + '" loading="lazy">');
        continue;
      }
      if (/^\|.*\|$/.test(t) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) {
        flushPara(); close();
        var head = splitRow(t), rows = [];
        i += 2;
        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { rows.push(splitRow(lines[i].trim())); i++; }
        i--;
        out.push('<div class="md-table"><table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c.trim()) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + cell(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
        continue;
      }
      if ((m = /^&gt;\s?(.*)$/.exec(t))) {
        flushPara(); close();
        var note = [inline(m[1])];
        while (i + 1 < lines.length && (m = /^&gt;\s?(.*)$/.exec(lines[i + 1].trim()))) { note.push(inline(m[1])); i++; }
        out.push('<div class="md-note">' + note.join('<br>') + '</div>');
        continue;
      }
      if ((m = /^\+\s+(.*)$/.exec(t))) {
        begin('cards');
        var parts = m[1].split(' | '), head2 = parts.shift();
        out.push('<div class="md-card"><b>' + inline(head2) + '</b>' + (parts.length ? '<span>' + inline(parts.join(' | ')) + '</span>' : '') + '</div>');
        continue;
      }
      if ((m = /^(\d+(?:\.\d+)+)\.?\s+(.*)$/.exec(t))) {
        begin('rules');
        out.push('<div class="md-rule"><span>' + m[1] + '</span><span>' + inline(m[2]) + '</span></div>');
        continue;
      }
      if ((m = /^(\*\*)?\s*(?:•|-|\*)\s+(.*)$/.exec(t))) { begin('ul'); out.push('<li>' + inline(unboldAll((m[1] || '') + m[2])) + '</li>'); continue; }
      close(); para.push(inline(unboldAll(t)));
    }
    flushPara(); close();
    return out.join('\n');
  };
  // Одна строка (заголовки, тексты карточек на главной): только оформление внутри строки, без блоков
  window.KomoriInline = function (src) { return inline(prepare(src)).replace(/\n/g, '<br>'); };
  window.KomoriPlain = function (src, n) {
    var t = String(src || '').replace(/\|\|\s*<@&\d+>\s*\|\|/g, '').replace(/<[@#]&?\d+>/g, '')
      .replace(/^#{1,3}\s+/gm, '').replace(/[*_~`|]/g, '').replace(/\s+/g, ' ').trim();
    return n && t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t;
  };
})();

/* Иконки для карточек на главной (Lucide, лицензия ISC) — выбираются в «Управлении» */
window.KomoriIcons = {
  fish: { c: '#5FD3F3', name: 'Рыба', d: '<path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z"/><path d="M18 12v.5"/><path d="M16 17.93a9.77 9.77 0 0 1 0-11.86"/><path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33"/>' },
  mountain: { c: '#7EDB8A', name: 'Горы', d: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>' },
  trophy: { c: '#FFC24D', name: 'Кубок', d: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>' },
  sparkles: { c: '#C99BFF', name: 'Магия', d: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>' },
  sword: { c: '#FF8A8A', name: 'Меч', d: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="M13 19l6-6M16 16l4 4M19 21l2-2"/>' },
  shield: { c: '#6FA8FF', name: 'Щит', d: '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/>' },
  map: { c: '#5FE0C8', name: 'Карта', d: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>' },
  users: { c: '#FF7EDB', name: 'Игроки', d: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>' },
  gift: { c: '#FFD15C', name: 'Подарок', d: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>' },
  pickaxe: { c: '#B9AED6', name: 'Кирка', d: '<path d="M14.5 5.5 4 16l4 4 10.5-10.5"/><path d="M3 9c4-4 10-6 18-6-1 8-3 14-6 18"/>' },
  coins: { c: '#9FE3B4', name: 'Монеты', d: '<circle cx="8" cy="8" r="6"/><path d="M18.1 10.4A6 6 0 1 1 10.3 18"/><path d="M7 6h1v4"/>' },
  star: { c: '#FFC857', name: 'Звезда', d: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>' }
};
window.KomoriIcon = function (id) {
  var ic = window.KomoriIcons[id]; if (!ic) return '';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ic.d + '</svg>';
};

/* Рубрики постов */
window.KomoriCats = [
  { id: 'news', label: 'Новости', c: '#C99BFF' },
  { id: 'update', label: 'Обновления', c: '#7BD88F' },
  { id: 'devblog', label: 'Девблог', c: '#6FA8FF' },
  { id: 'giveaway', label: 'Розыгрыш', c: '#FFC857' },
  { id: 'tech', label: 'Техработы', c: '#FF9FB8' },
  { id: 'fix', label: 'Исправления', c: '#5FE0C8' }
];
window.KomoriCat = function (id) { var l = window.KomoriCats; for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return l[0]; };

/* Картинка с компьютера: уменьшаем до 1600 px, сжимаем и отправляем на сайт. cb(ошибка, адрес) */
window.KomoriShrink = function (file, cb) {
  var img = new Image(), url = URL.createObjectURL(file);
  img.onload = function () {
    var k = Math.min(1, 1600 / img.width), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    var data = c.toDataURL('image/webp', 0.85);
    if (data.indexOf('data:image/webp') !== 0) data = c.toDataURL('image/jpeg', 0.85);
    URL.revokeObjectURL(url); cb(null, data);
  };
  img.onerror = function () { cb('Не получилось открыть картинку'); };
  img.src = url;
};
window.KomoriUploadImage = function (cb) {
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp,image/gif';
  inp.onchange = function () {
    var f = inp.files && inp.files[0]; if (!f) return;
    window.KomoriShrink(f, function (err, data) {
      if (err) return cb(err);
      fetch('/api/img', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: data }) })
        .then(function (r) { return r.json().then(function (d) { return r.ok ? cb(null, d.url) : cb(d.error || 'Ошибка'); }); })
        .catch(function () { cb('Нет связи с сайтом'); });
    });
  };
  inp.click();
};
/* Вставить текст в поле на место курсора (новой строкой) и вернуть новое значение */
window.KomoriInsertAt = function (id, text) {
  var el = document.getElementById(id); if (!el) return null;
  var a = el.selectionStart == null ? el.value.length : el.selectionStart, v = el.value;
  var before = v.slice(0, a), after = v.slice(a);
  var ins = (before && !/\n$/.test(before) ? '\n' : '') + text + '\n';
  return before + ins + after;
};
window.KomoriMDHelp = 'Разметка как в Discord: <code>## Заголовок</code> <code>**жирный**</code> <code>*курсив*</code> <code>• пункт</code> <code>||спойлер||</code> <code>[текст](ссылка)</code>. ' +
  'Ещё: <code>+ Название | описание</code> — карточка, <code>&gt; текст</code> — заметка, <code>| A | B |</code> — таблица, <code>1.1 текст</code> — пункт правил.';

/* Боковая панель редактирования (правила, вики): страница за ней сразу показывает, как будет.
 * o: { key, title, text, onText(v), fields:[{id,label,value,onInput}], actions:[{label,cls,fn}], data(), onSaved(resp) } */
window.KomoriDockVals = function (self, o) {
  var d = self.state.dock;
  if (!d) return { open: false };
  function patch(p) { self.setState({ dock: Object.assign({}, self.state.dock, p) }); }
  function when(ts) { return ts ? new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'стандартная версия'; }
  function send(method, url, body) {
    patch({ busy: true, err: '' });
    return fetch(url, { method: method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (x) { if (!r.ok) throw new Error(x.error || 'Ошибка'); return x; }); })
      .then(function (x) { self.setState({ dock: null }); o.onSaved(x); }, function (e) { patch({ busy: false, err: e.message === 'Failed to fetch' ? 'Нет связи с сайтом' : e.message }); });
  }
  return {
    open: true, title: o.title, text: o.text, help: window.KomoriMDHelp, err: d.err || '', busy: !!d.busy,
    fields: o.fields || [], hasFields: !!(o.fields && o.fields.length), actions: o.actions || [], hasActions: !!(o.actions && o.actions.length),
    hasText: o.text != null, note: o.note || '', hasNote: !!o.note,
    saveLabel: d.busy ? 'Сохраняю…' : 'Сохранить', insLabel: d.ins ? 'Загружаю…' : 'Вставить картинку',
    showHist: !!d.showHist, histLoading: d.showHist && !d.hist, histEmpty: !!(d.hist && !d.hist.length),
    resetLabel: d.sureReset ? 'Точно вернуть стандартную?' : 'Вернуть стандартную версию', resetCls: 'btn-s danger' + (d.sureReset ? ' sure' : ''),
    hist: (d.hist || []).map(function (h) {
      return { label: when(h.at), author: h.author || '', restore: function () { send('POST', '/api/content/' + o.key + '/restore', { i: h.i }); } };
    }),
    onText: function (e) { o.onText(e.target.value); },
    insertImage: function () {
      patch({ ins: true, err: '' });
      window.KomoriUploadImage(function (err, url) {
        patch({ ins: false, err: err || '' });
        if (!err) { var v = window.KomoriInsertAt('dockText', '![](' + url + ')'); o.onText(v == null ? o.text + '\n![](' + url + ')' : v); }
      });
    },
    cancel: function () { self.setState({ dock: null }); if (o.onCancel) o.onCancel(); },
    save: function () { send('PUT', '/api/content/' + o.key, { data: o.data() }); },
    toggleHist: function () {
      if (d.showHist) { patch({ showHist: false }); return; }
      patch({ showHist: true, hist: null });
      fetch('/api/content/' + o.key + '/history').then(function (r) { return r.json(); })
        .then(function (h) { patch({ hist: Array.isArray(h) ? h : [] }); }).catch(function () { patch({ hist: [] }); });
    },
    reset: function () {
      if (!self.state.dock.sureReset) { patch({ sureReset: true }); return; }
      send('DELETE', '/api/content/' + o.key);
    }
  };
};
