/* shaders.js — загрузка WGSL отдельными файлами, с поддержкой "//#include name.wgsl".
   Директива стоит отдельной строкой, путь считается от файла, где она написана. */
(function (GE) {
  'use strict';

  var cache = {};
  var INCLUDE_RE = /^[ \t]*\/\/#include[ \t]+["']?([^"'\s]+)["']?[ \t]*$/gm;

  function fetchText(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + url);
      return res.text();
    }, function () {
      // fetch падает, когда страница открыта как file://
      var err = new Error(GE.t('game-engine.errNoFetch',
        'Could not load shader files. Open the app by its web address: a browser does not read side files from a local disk.'));
      err.noFetch = true;
      throw err;
    });
  }

  function resolveIncludes(url, stack) {
    if (stack.indexOf(url) >= 0) {
      throw new Error('cyclic #include: ' + stack.concat(url).join(' -> '));
    }
    var next = stack.concat(url);
    return fetchText(url).then(function (raw) {
      var parts = [];
      var last = 0;
      var m;
      INCLUDE_RE.lastIndex = 0;
      var chain = Promise.resolve();
      while ((m = INCLUDE_RE.exec(raw)) !== null) {
        (function (match) {
          parts.push(raw.slice(last, match.index));
          var child = new URL(match[1], url).href;
          chain = chain.then(function () {
            return resolveIncludes(child, next);
          }).then(function (text) {
            parts.push('// ---- ' + match[1] + ' ----\n' + text);
          });
          last = match.index + match[0].length;
        })(m);
      }
      return chain.then(function () {
        parts.push(raw.slice(last));
        return parts.join('\n');
      });
    });
  }

  GE.loadShader = function (url) {
    var key = new URL(url, location.href).href;
    if (cache[key]) return Promise.resolve(cache[key]);
    return resolveIncludes(key, []).then(function (code) {
      cache[key] = code;
      return code;
    });
  };
})(window.GE = window.GE || {});
