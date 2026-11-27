/* pack.js — солнце и упаковка сцены в буферы.
   Это единственное место, где задан порядок float'ов uniform-буфера (shaders/params.wgsl)
   и раскладка буфера примитивов (shaders/primitives.wgsl).
   Сцена приходит сюда обычными числами: массив объектов, солнце, окружение. */
(function (GE) {
  'use strict';

  var DEG = Math.PI / 180;

  // азимут солнца зафиксирован: сцена смотрит так, что тени идут к камере
  var SUN_AZIMUTH = 215 * DEG;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function mix3(a, b, k) {
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }

  // ---- солнце: цвет и сила света зависят от высоты над горизонтом (-90°..+90°) ----
  GE.sunFor = function (heightDeg) {
    var el = clamp(heightDeg, -90, 90) * DEG;
    var az = SUN_AZIMUTH;
    var dir = [
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az)
    ];
    var y = dir[1];

    var color = mix3([1.00, 0.42, 0.16], [1.00, 0.97, 0.90], smoothstep(0.0, 0.50, y));
    var strength = 1.65 * smoothstep(-0.10, 0.10, y);

    var ambient = mix3([0.045, 0.060, 0.110], [0.230, 0.165, 0.200], smoothstep(-0.32, 0.02, y));
    ambient = mix3(ambient, [0.460, 0.560, 0.780], smoothstep(0.02, 0.38, y));

    return { dir: dir, color: color, strength: strength, ambient: ambient };
  };

  GE.SUN_AZIMUTH = SUN_AZIMUTH;

  // ---- объекты сцены → буфер примитивов (сначала сферы, затем конусы, затем кубы) ----
  // objects: {kind:'sphere', x,y,z,r, color}, {kind:'cone', a, rA, b, rB, color},
  //          {kind:'box', min, max, color}
  // Возвращает, сколько чего уехало на GPU: буфер не резиновый, лишнее не пишется.
  GE.packObjects = function (objects, data) {
    var limit = data.length;
    var o = 0;
    var counts = { spheres: 0, cones: 0, boxes: 0, total: 0 };
    var i, p, c;

    function done() {
      counts.total = counts.spheres + counts.cones + counts.boxes;
      return counts;
    }

    function room() { return o + 12 <= limit; }

    for (i = 0; i < objects.length; i++) {
      p = objects[i];
      if (p.kind !== 'sphere') continue;
      if (!room()) return done();
      data[o] = p.x; data[o + 1] = p.y; data[o + 2] = p.z; data[o + 3] = p.r;
      data[o + 4] = 0; data[o + 5] = 0; data[o + 6] = 0; data[o + 7] = 0;
      c = p.color;
      data[o + 8] = c[0]; data[o + 9] = c[1]; data[o + 10] = c[2]; data[o + 11] = 0;
      o += 12;
      counts.spheres += 1;
    }

    for (i = 0; i < objects.length; i++) {
      p = objects[i];
      if (p.kind !== 'cone') continue;
      if (!room()) return done();
      data[o] = p.a[0]; data[o + 1] = p.a[1]; data[o + 2] = p.a[2]; data[o + 3] = p.rA;
      data[o + 4] = p.b[0]; data[o + 5] = p.b[1]; data[o + 6] = p.b[2]; data[o + 7] = p.rB;
      c = p.color;
      data[o + 8] = c[0]; data[o + 9] = c[1]; data[o + 10] = c[2]; data[o + 11] = 0;
      o += 12;
      counts.cones += 1;
    }

    for (i = 0; i < objects.length; i++) {
      p = objects[i];
      if (p.kind !== 'box') continue;
      if (!room()) return done();
      data[o] = p.min[0]; data[o + 1] = p.min[1]; data[o + 2] = p.min[2]; data[o + 3] = 0;
      data[o + 4] = p.max[0]; data[o + 5] = p.max[1]; data[o + 6] = p.max[2]; data[o + 7] = 0;
      c = p.color;
      data[o + 8] = c[0]; data[o + 9] = c[1]; data[o + 10] = c[2]; data[o + 11] = 0;
      o += 12;
      counts.boxes += 1;
    }

    return done();
  };

  // ---- кадр целиком: примитивы + значения камеры, солнца и окружения ----
  // scene: {objects, sun, env:{exposure, stars, grid}}, gfx: {shadows}
  GE.writeFrame = function (renderer, scene, camera, gfx) {
    var counts = GE.packObjects(scene.objects, renderer.primData);
    renderer.primCount = counts.total;

    var out = renderer.params;
    var cu = renderer.paramsU32;
    var w = renderer.canvas.width || 1;
    var h = renderer.canvas.height || 1;
    var sun = scene.sun;
    var env = scene.env;

    out[0] = w;
    out[1] = h;
    out[2] = camera.fov;
    out[3] = scene.time;

    out[4] = camera.position[0];
    out[5] = camera.position[1];
    out[6] = camera.position[2];
    out[7] = 0;

    out[8] = camera.forward[0];
    out[9] = camera.forward[1];
    out[10] = camera.forward[2];
    out[11] = 0;

    out[12] = camera.right[0];
    out[13] = camera.right[1];
    out[14] = camera.right[2];
    out[15] = 0;

    out[16] = camera.up[0];
    out[17] = camera.up[1];
    out[18] = camera.up[2];
    out[19] = 0;

    out[20] = sun.dir[0];
    out[21] = sun.dir[1];
    out[22] = sun.dir[2];
    out[23] = 0;

    out[24] = sun.color[0];
    out[25] = sun.color[1];
    out[26] = sun.color[2];
    out[27] = sun.strength;

    out[28] = sun.ambient[0];
    out[29] = sun.ambient[1];
    out[30] = sun.ambient[2];
    out[31] = 0;

    // [32..35] — те же байты, что и counts: пишем только через u32-вид
    cu[32] = counts.spheres;
    cu[33] = counts.cones;
    cu[34] = counts.boxes;
    cu[35] = 0;

    out[36] = env.exposure;
    out[37] = gfx.shadows > 0.5 ? 1 : 0;
    out[38] = env.stars > 0.5 ? 1 : 0;
    out[39] = env.grid > 0.5 ? 1 : 0;

    return counts;
  };
})(window.GE = window.GE || {});
