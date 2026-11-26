/* texture.js — процедурная текстура, которую считает процессор.
   texelBytes() — чистая функция: тем же кодом пользуется заливка текстуры,
   поэтому ожидаемое значение всегда можно пересчитать. */
(function (GE) {
  'use strict';

  var SIZE = 256;

  function clamp255(v) {
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  }

  function texelBytes(x, y) {
    var u = x / SIZE;
    var v = y / SIZE;

    var n = Math.sin(u * 21.7 + v * 13.3) * Math.sin(u * 7.1 - v * 17.9);
    var rings = Math.sin(Math.hypot(u - 0.5, v - 0.5) * 48.0);
    var checker = (Math.floor(u * 8) + Math.floor(v * 8)) % 2 === 0 ? 1 : 0;

    var r = 0.5 + 0.5 * Math.sin(n * 3.0 + u * 6.0);
    var g = 0.5 + 0.5 * Math.cos(rings * 2.0 + v * 4.0);
    var b = 0.15 + 0.45 * checker + 0.28 * (0.5 + 0.5 * rings);

    return [clamp255(r), clamp255(g), clamp255(b), 255];
  }

  function makeTextureData(size) {
    var n = size || SIZE;
    var data = new Uint8Array(n * n * 4);
    var i = 0;
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        var t = texelBytes(x, y);
        data[i++] = t[0];
        data[i++] = t[1];
        data[i++] = t[2];
        data[i++] = t[3];
      }
    }
    return data;
  }

  GE.TEX_SIZE = SIZE;
  GE.texelBytes = texelBytes;
  GE.makeTextureData = makeTextureData;
})(window.GE = window.GE || {});
