/* theme.js — УСТАРЕЛО. Тема, язык и шапка страниц переехали в ОБЩИЙ ШАБЛОН:
 *
 *     site\ui\ui.js  →  https://dperegudov61.github.io/ui/ui.js
 *
 * Весь код теперь лежит там в одном экземпляре, поэтому кнопки на всех страницах
 * одинаковые, а правка шаблона меняет сразу весь сайт. Новым страницам этот файл
 * НЕ НУЖЕН — они подключают /ui/ui.js сами.
 *
 * Файл оставлен только ради страниц, которые ещё лежат в кэше браузера: он
 * подключает шаблон и передаёт ему настройки своего тега <script>.
 */
(function () {
  'use strict';
  var cs = document.currentScript;
  var s = document.createElement('script');
  s.src = '/ui/ui.js';
  if (cs && cs.getAttribute) {
    var attrs = ['data-i18n', 'data-home', 'data-account', 'data-home-href',
                 'data-account-href', 'data-signin-href', 'data-logo'];
    for (var i = 0; i < attrs.length; i++) {
      var v = cs.getAttribute(attrs[i]);
      if (v) s.setAttribute(attrs[i], v);
    }
  }
  (document.head || document.getElementsByTagName('head')[0]).appendChild(s);
})();
