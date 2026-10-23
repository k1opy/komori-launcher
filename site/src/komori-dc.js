/* Komori — маленький движок страниц сайта.
 * Понимает разметку макетов: <x-dc> с шаблоном, {{путь}} в тексте и атрибутах,
 * <sc-for list="{{массив}}" as="x">, <sc-if value="{{условие}}">, onClick/onInput="{{функция}}"
 * и класс Component extends DCLogic { renderVals() } из <script type="text/x-dc">.
 * Общие значения шапки (вход, аватар, меню) доступны как {{K.*}}.
 */
(function () {
  'use strict';

  var comp = null, root = null, tpl = null, queued = false;

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch);
    schedule();
  };
  window.DCLogic = DCLogic;

  function schedule() {
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(function () { queued = false; render(); });
  }
  window.KomoriRender = schedule;

  // ---------- значения ----------
  function lookup(path, scopes) {
    var parts = path.trim().split('.');
    for (var i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i] && Object.prototype.hasOwnProperty.call(scopes[i], parts[0])) {
        var v = scopes[i][parts[0]];
        for (var j = 1; j < parts.length; j++) v = v == null ? undefined : v[parts[j]];
        return v;
      }
    }
    return undefined;
  }
  var HOLE = /\{\{\s*([A-Za-z_$][\w$.]*)\s*\}\}/g;
  function interpolate(str, scopes) {
    return str.replace(HOLE, function (_, p) { var v = lookup(p, scopes); return v == null ? '' : String(v); });
  }
  function single(str) { var m = /^\s*\{\{\s*([A-Za-z_$][\w$.]*)\s*\}\}\s*$/.exec(str || ''); return m && m[1]; }

  // ---------- построение DOM ----------
  function build(node, scopes, out) {
    if (node.nodeType === 3) { // текст
      out.push(document.createTextNode(node.nodeValue.indexOf('{{') >= 0 ? interpolate(node.nodeValue, scopes) : node.nodeValue));
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.tagName;
    if (tag === 'TEMPLATE' && node.hasAttribute('data-sc')) {
      var kind = node.getAttribute('data-sc');
      if (kind === 'for') {
        var list = lookup(single(node.getAttribute('list')) || '', scopes) || [];
        var as = node.getAttribute('as') || 'item';
        for (var i = 0; i < list.length; i++) {
          var sc = {}; sc[as] = list[i]; sc[as + 'Index'] = i;
          buildChildren(node.content, scopes.concat([sc]), out);
        }
      } else if (kind === 'if') {
        if (lookup(single(node.getAttribute('value')) || '', scopes)) buildChildren(node.content, scopes, out);
      }
      return;
    }
    var el = node.cloneNode(false);
    var attrs = node.attributes;
    for (var a = attrs.length - 1; a >= 0; a--) {
      var name = attrs[a].name, val = attrs[a].value;
      if (name.indexOf('hint-') === 0) { el.removeAttribute(name); continue; }
      if (/^on[a-z]+$/.test(name)) {
        el.removeAttribute(name);
        var fn = lookup(single(val) || '', scopes);
        if (typeof fn === 'function') el.addEventListener(name.slice(2), fn);
        continue;
      }
      if (val.indexOf('{{') >= 0) {
        var v = interpolate(val, scopes);
        // булевы атрибуты: "false" или пусто — убрать атрибут
        if (/^(checked|disabled|selected|readonly|required|hidden)$/.test(name) && (v === 'false' || v === '')) el.removeAttribute(name);
        else el.setAttribute(name, v);
      }
    }
    var src = tag === 'TEMPLATE' ? node.content : node;
    var kids = [];
    buildChildren(src, scopes, kids);
    for (var k = 0; k < kids.length; k++) el.appendChild(kids[k]);
    if (tag === 'TEXTAREA') el.value = el.textContent;
    if (tag === 'INPUT' && el.hasAttribute('checked')) el.checked = true;
    out.push(el);
  }
  function buildChildren(parent, scopes, out) {
    for (var c = parent.firstChild; c; c = c.nextSibling) build(c, scopes, out);
  }

  // ---------- отрисовка ----------
  function render() {
    if (!comp) return;
    var vals = comp.renderVals ? comp.renderVals() : {};
    var K = window.KomoriBase ? window.KomoriBase() : {};
    var active = document.activeElement, focusId = active && active.id, selS, selE;
    try { selS = active.selectionStart; selE = active.selectionEnd; } catch (e) {}
    var out = [];
    buildChildren(tpl.content, [{ K: K }, vals], out);
    root.replaceChildren.apply(root, out);
    if (focusId) {
      var f = document.getElementById(focusId);
      if (f) { f.focus(); try { if (selS != null) f.setSelectionRange(selS, selE); } catch (e) {} }
    }
  }

  function start() {
    root = document.querySelector('x-dc');
    tpl = document.getElementById('komori-tpl');
    if (!root || !tpl) return;
    var helmet = tpl.content.querySelector('helmet');
    if (helmet) { while (helmet.firstChild) document.head.appendChild(helmet.firstChild); helmet.remove(); }
    root.style.display = 'block';
    var script = document.querySelector('script[data-dc-script]');
    var Component = script ? new Function('DCLogic', script.textContent + '\n;return Component;')(DCLogic) : DCLogic;
    comp = new Component({});
    render();
    if (typeof comp.mounted === 'function') comp.mounted();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
