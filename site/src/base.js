/* Общие значения для шапки и подвала всех страниц ({{K.*}}).
 * window.KOMORI приходит от сервера: { me, page, cfg: { discord, launcher, map }, flash }. */
(function () {
  'use strict';
  var NAV = [
    { id: 'main', label: 'Главная', href: '/' },
    { id: 'rules', label: 'Правила', href: '/rules' },
    { id: 'wiki', label: 'Вики', href: '/wiki' },
    { id: 'map', label: 'Карта', href: '/map' }
  ];
  window.KomoriBase = function () {
    var k = window.KOMORI || {}, me = k.me, cfg = k.cfg || {};
    return {
      loggedIn: !!me, loggedOut: !me,
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
