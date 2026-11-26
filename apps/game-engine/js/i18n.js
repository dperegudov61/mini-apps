/* i18n.js — надписи через общий шаблон /ui/ui.js, с запасным английским текстом.
   В разметке: data-i18n="ключ". В коде: GE.t('ключ', 'English fallback', [параметры]).
   Значения подставляются вместо {0}, {1}, … */
(function (GE) {
  'use strict';

  function t(key, fallback, params) {
    var s = null;
    if (window.UI && typeof window.UI.t === 'function') s = window.UI.t(key, fallback);
    else if (typeof window.t === 'function') s = window.t(key, fallback);
    if (s === null || s === undefined || s === '') s = fallback !== undefined ? fallback : key;
    if (params) {
      for (var i = 0; i < params.length; i++) s = s.split('{' + i + '}').join(String(params[i]));
    }
    return s;
  }

  // надпись на элементе: и текст, и ключ (чтобы шаблон перевёл её при смене языка)
  function label(el, key, fallback, params) {
    if (!el) return;
    el.setAttribute('data-i18n', key);
    el.textContent = t(key, fallback, params);
  }

  GE.t = t;
  GE.label = label;
})(window.GE = window.GE || {});
