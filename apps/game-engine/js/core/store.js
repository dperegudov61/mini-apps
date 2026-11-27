/* store.js — память настроек: localStorage под общим префиксом приложения.
   Здесь только чтение и запись; что именно хранить, решают панели и сцены.
   Ключи: gfx — настройки рендера (общие), scene.<id> — ползунки сцены,
   activeScene — какая сцена открыта. */
(function (GE) {
  'use strict';

  var PREFIX = 'miniapps.game-engine.';

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  GE.Store = {
    key: function (name) { return PREFIX + name; },

    // объект чисел: всё, чего нет в памяти или что не число, берётся из defaults
    read: function (name, defaults) {
      var saved = null;
      try { saved = JSON.parse(localStorage.getItem(PREFIX + name) || 'null'); } catch (e) { saved = null; }
      var out = {};
      for (var k in defaults) {
        var v = saved ? saved[k] : undefined;
        out[k] = isNum(v) ? v : defaults[k];
      }
      return out;
    },

    write: function (name, obj) {
      try { localStorage.setItem(PREFIX + name, JSON.stringify(obj)); } catch (e) { /* приватный режим */ }
    },

    text: function (name, fallback) {
      try {
        var v = localStorage.getItem(PREFIX + name);
        return v === null ? fallback : v;
      } catch (e) { return fallback; }
    },

    setText: function (name, value) {
      try { localStorage.setItem(PREFIX + name, String(value)); } catch (e) { /* приватный режим */ }
    },

    // сырое значение как есть: нужно разовой миграции старых ключей
    raw: function (name) {
      try { return localStorage.getItem(PREFIX + name); } catch (e) { return null; }
    },

    drop: function (name) {
      try { localStorage.removeItem(PREFIX + name); } catch (e) { /* приватный режим */ }
    }
  };
})(window.GE = window.GE || {});
