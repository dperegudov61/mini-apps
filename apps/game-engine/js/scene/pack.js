/* pack.js — солнце, упаковка сцены в буферы и компиляция CSG-программы.
   Это единственное место, где задан порядок float'ов uniform-буфера (shaders/params.wgsl)
   и раскладка буфера примитивов + CSG-программы (shaders/primitives.wgsl).
   Сцена приходит сюда обычными числами: массив объектов, солнце, окружение.

   Объект сцены (то, что читает packScene):
     { kind, color:[r,g,b], invert:0|1, doubleSided:0|1, matId:0, id?, ops:[{op, ref}] }
   + геометрия вида (см. ниже). Фабрики GE.Prim.* собирают эти поля (js/scene/prims.js).

   ops — булевы зависимости: { op:'union'|'intersect'|'subtract', ref:<id другого объекта> }.
   Объект без ops и без ссылок на него — корень (рисуется). Объект, на который ссылаются, —
   часть; он рисуется только внутри того, кто на него ссылается. */
(function (GE) {
  'use strict';

  var DEG = Math.PI / 180;
  var PRIM_FLOATS = GE.PRIM_FLOATS || 32;

  var KIND = {
    sphere: 1, box: 2, cone: 3, cylinder: 4, plane: 5, rect: 6, mesh: 7
  };

  // коды операций — должны совпадать с shaders/primitives.wgsl
  var OP = { LEAF: 0, UNION: 1, INTER: 2, SUB: 3, ROOT: 4 };

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

  // ---- один примитив в буфер (32 float, см. shaders/primitives.wgsl) ----
  function writePrim(d, o, obj, renderer) {
    d[o] = KIND[obj.kind] || 0;
    d[o + 1] = obj.invert ? 1 : 0;
    d[o + 2] = obj.doubleSided ? 1 : 0;
    d[o + 3] = obj.matId || 0;

    for (var k = 4; k < 28; k++) d[o + k] = 0;
    var c = obj.color || [0.8, 0.8, 0.8];
    d[o + 28] = c[0];
    d[o + 29] = c[1];
    d[o + 30] = c[2];
    d[o + 31] = 0;

    var k = obj.kind;
    if (k === 'sphere') {
      d[o + 4] = obj.x; d[o + 5] = obj.y; d[o + 6] = obj.z; d[o + 7] = obj.r;
    } else if (k === 'box') {
      d[o + 4] = obj.cx; d[o + 5] = obj.cy; d[o + 6] = obj.cz;
      d[o + 8] = obj.hx; d[o + 9] = obj.hy; d[o + 10] = obj.hz;
      var X = obj.X, Y = obj.Y;
      d[o + 12] = X[0]; d[o + 13] = X[1]; d[o + 14] = X[2];
      d[o + 16] = Y[0]; d[o + 17] = Y[1]; d[o + 18] = Y[2];
    } else if (k === 'cone' || k === 'cylinder') {
      d[o + 4] = obj.ax; d[o + 5] = obj.ay; d[o + 6] = obj.az; d[o + 7] = obj.rA;
      d[o + 8] = obj.bx; d[o + 9] = obj.by; d[o + 10] = obj.bz; d[o + 11] = obj.rB;
      d[o + 12] = obj.n1[0]; d[o + 13] = obj.n1[1]; d[o + 14] = obj.n1[2]; d[o + 15] = obj.d1;
      d[o + 16] = obj.n2[0]; d[o + 17] = obj.n2[1]; d[o + 18] = obj.n2[2]; d[o + 19] = obj.d2;
    } else if (k === 'plane') {
      d[o + 4] = obj.px; d[o + 5] = obj.py; d[o + 6] = obj.pz;
      d[o + 8] = obj.nx; d[o + 9] = obj.ny; d[o + 10] = obj.nz;
      d[o + 20] = obj.radius || 0;      // e.x: 0 — бесконечная плоскость
    } else if (k === 'rect') {
      d[o + 4] = obj.cx; d[o + 5] = obj.cy; d[o + 6] = obj.cz;
      var u = obj.u, v = obj.v;
      d[o + 8] = u[0]; d[o + 9] = u[1]; d[o + 10] = u[2];
      d[o + 12] = v[0]; d[o + 13] = v[1]; d[o + 14] = v[2];
      d[o + 16] = obj.hw; d[o + 17] = obj.hh;
    } else if (k === 'mesh') {
      // модель уже лежит своей копией в буфере сеток; здесь только смещение и поворот
      var res = obj.mesh;
      var slot = renderer ? renderer.meshSlot(res) : -1;
      if (!res || slot < 0) { d[o] = 0; return; }   // не поместилась — просто не рисуем
      d[o + 4] = slot + res.triBase;
      d[o + 5] = res.triCount;
      d[o + 6] = slot + res.nodeBase;
      d[o + 7] = res.nodeCount;
      d[o + 8] = res.bboxMin[0]; d[o + 9] = res.bboxMin[1]; d[o + 10] = res.bboxMin[2];
      d[o + 11] = obj.scale || 1;
      d[o + 12] = res.bboxMax[0]; d[o + 13] = res.bboxMax[1]; d[o + 14] = res.bboxMax[2];
      var bx = obj.X || [1, 0, 0], by = obj.Y || [0, 1, 0], bz = obj.Z || [0, 0, 1];
      d[o + 16] = bx[0]; d[o + 17] = bx[1]; d[o + 18] = bx[2]; d[o + 19] = obj.x || 0;
      d[o + 20] = by[0]; d[o + 21] = by[1]; d[o + 22] = by[2]; d[o + 23] = obj.y || 0;
      d[o + 24] = bz[0]; d[o + 25] = bz[1]; d[o + 26] = bz[2]; d[o + 27] = obj.z || 0;
    }
  }

  // ---- постфиксная запись булева выражения объекта (рекурсия по зависимостям) ----
  function emitCSG(index, objects, byId, csg, pos) {
    var obj = objects[index];
    var ops = obj.ops;
    if (!ops || !ops.length) {
      csg[pos++] = OP.LEAF;
      csg[pos++] = index;
      return pos;
    }
    csg[pos++] = OP.LEAF;
    csg[pos++] = index;
    for (var j = 0; j < ops.length; j++) {
      var refIdx = byId[ops[j].ref];
      if (refIdx == null) continue;
      pos = emitCSG(refIdx, objects, byId, csg, pos);
      var code = OP.UNION;
      if (ops[j].op === 'intersect') code = OP.INTER;
      else if (ops[j].op === 'subtract') code = OP.SUB;
      csg[pos++] = code;
      csg[pos++] = 0;
    }
    return pos;
  }

  // ---- объекты сцены → буфер примитивов + CSG-программа ----
  // Возвращает { primCount, csg, total }.
  GE.packScene = function (objects, renderer) {
    var data = renderer.primData;
    var csg = renderer.csgData;
    var limit = data.length;      // float'ов
    var maxCsg = csg.length;      // u32 (по 2 на инструкцию)

    // id → индекс
    var byId = {};
    var ids = [];
    for (var i = 0; i < objects.length; i++) {
      var id = objects[i].id != null ? objects[i].id : 'obj' + i;
      ids[i] = id;
      byId[id] = i;
    }

    // на кого ссылаются — те не корни
    var referenced = {};
    for (i = 0; i < objects.length; i++) {
      var ops = objects[i].ops;
      if (ops) for (var j = 0; j < ops.length; j++) referenced[ops[j].ref] = true;
    }

    // примитивы
    var primCount = 0;
    for (i = 0; i < objects.length && (i + 1) * PRIM_FLOATS <= limit; i++) {
      writePrim(data, i * PRIM_FLOATS, objects[i], renderer);
      primCount = i + 1;
    }

    // CSG-программа: по корням
    var pos = 0;
    for (i = 0; i < objects.length; i++) {
      if (referenced[ids[i]]) continue;
      pos = emitCSG(i, objects, byId, csg, pos);
      if (pos + 2 > maxCsg) break;
      csg[pos++] = OP.ROOT;
      csg[pos++] = 0;
    }
    var csgCount = pos >> 1;

    return { primCount: primCount, csg: csgCount, total: primCount };
  };

  // ---- кадр целиком: примитивы + CSG + значения камеры, солнца и окружения ----
  // scene: {objects, sun, env:{exposure, stars, grid}}, gfx: {shadows}
  GE.writeFrame = function (renderer, scene, camera, gfx) {
    var counts = GE.packScene(scene.objects, renderer);
    renderer.primCount = counts.primCount;
    renderer.csgCount = counts.csg;

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
    cu[32] = counts.primCount;
    cu[33] = counts.csg;
    cu[34] = 0;
    cu[35] = 0;

    out[36] = env.exposure;
    out[37] = gfx.shadows > 0.5 ? 1 : 0;
    out[38] = env.stars > 0.5 ? 1 : 0;
    out[39] = env.grid > 0.5 ? 1 : 0;

    // [40..47] — постоянные кадра: всё, что не зависит от пикселя, считает процессор
    // (см. shaders/params.wgsl → frame и frame2)
    var sunY = sun.dir[1];
    out[40] = Math.tan(camera.fov * 0.5);                  // тот же луч, но без tan() в пикселе
    out[41] = smoothstep(-0.25, 0.20, sunY);               // насколько день
    out[42] = smoothstep(-0.15, 0.05, sunY);               // виден ли диск/ореол солнца
    out[43] = 1 - smoothstep(0.0, 0.35, Math.abs(sunY));   // полоса заката у горизонта
    out[44] = smoothstep(-0.05, 0.15, sunY);               // день для освещения поверхности
    out[45] = sun.color[0] * sun.strength;                 // цвет солнца сразу с силой
    out[46] = sun.color[1] * sun.strength;
    out[47] = sun.color[2] * sun.strength;

    return counts;
  };
})(window.GE = window.GE || {});
