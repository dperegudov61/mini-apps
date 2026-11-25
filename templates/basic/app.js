/* <id> — Mini Apps. Без библиотек и без сборки. */
(function () {
  'use strict';

  // данные приложения держим под своим префиксом
  var KEY = 'miniapps.<id>.state';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }

  function save(value) {
    try { localStorage.setItem(KEY, JSON.stringify(value)); } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', function () {
    // точка входа
  });
})();
