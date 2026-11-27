/* mesh.js — полигональная модель в виде, который понимает шейдер: плоский буфер
   треугольников плюс дерево ограничивающих коробок (BVH) над ними.

   Зачем дерево. Луч в шейдере проверяется против всех треугольников модели, если
   перебирать их подряд: модель на 2 тыс. треугольников — это 2 тыс. проверок на
   каждый пиксель кадра (и на каждый луч к солнцу). Дерево отсекает сразу целые
   пачки: на путь луча остаётся 2–3 десятка проверок. Для моделей на десятки тысяч
   треугольников это разница между «секунда на кадр» и «миллисекунды».

   Раскладка буфера (float'ы, всё в пространстве модели):
     узлы BVH: 8 float на узел, узел 0 — корень
       A = (bmin.xyz, left или -(triStart+1))     left < 0 — это лист
       B = (bmax.xyz, right или triCount)
     треугольники: 24 float на штуку
       v0, e1 = v1 - v0, e2 = v2 - v0, n0, n1, n2 (нормали в вершинах)
   Тот же порядок читает shaders/primitives.wgsl (meshLeaf).
   Смещения задаёт рендерер: он складывает модели в один буфер подряд. */
(function (GE) {
  'use strict';

  var LEAF = 4;          // треугольников в листе дерева
  var NODE_FLOATS = 8;   // узел: два vec4
  var TRI_FLOATS = 24;   // треугольник: шесть vec4

  var nextUid = 1;

  function put3(d, o, x, y, z) { d[o] = x; d[o + 1] = y; d[o + 2] = z; }

  function putNorm(d, o, x, y, z) {
    var l = Math.sqrt(x * x + y * y + z * z);
    if (!(l > 1e-20)) { d[o] = 0; d[o + 1] = 1; d[o + 2] = 0; return; }
    d[o] = x / l; d[o + 1] = y / l; d[o + 2] = z / l;
  }

  GE.Mesh = {
    LEAF: LEAF,

    // Разобранный OBJ (js/scene/obj.js → GE.Obj.parse) -> ресурс для рендерера.
    // opts: { size: 2, smooth: true, color: [r,g,b] }
    fromObj: function (obj, opts) {
      var o = opts || {};
      var size = o.size > 0 ? o.size : 2;      // длинная сторона модели в метрах
      var smooth = o.smooth !== false;
      var v = obj.v;
      var faces = obj.faces;
      var nTri = (faces.length / 7) | 0;
      if (!nTri) throw new Error('в модели нет граней');
      var nv = (v.length / 3) | 0;

      // ---- габариты: модель ставим центром в ноль, длинную сторону вписываем в size ----
      var bmin = [Infinity, Infinity, Infinity];
      var bmax = [-Infinity, -Infinity, -Infinity];
      for (var i = 0; i < nv; i++) {
        for (var a = 0; a < 3; a++) {
          var q = v[i * 3 + a];
          if (q < bmin[a]) bmin[a] = q;
          if (q > bmax[a]) bmax[a] = q;
        }
      }
      var cx = (bmin[0] + bmax[0]) * 0.5;
      var cy = (bmin[1] + bmax[1]) * 0.5;
      var cz = (bmin[2] + bmax[2]) * 0.5;
      var ext = Math.max(bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]);
      var k = size / (ext > 1e-9 ? ext : 1);

      var pos = new Float32Array(nv * 3);
      for (i = 0; i < nv; i++) {
        pos[i * 3] = (v[i * 3] - cx) * k;
        pos[i * 3 + 1] = (v[i * 3 + 1] - cy) * k;
        pos[i * 3 + 2] = (v[i * 3 + 2] - cz) * k;
      }

      // ---- сглаженные нормали по вершинам: среднее нормалей граней с весом по площади ----
      var vnrm = null;
      if (smooth && !obj.hasNormals) {
        vnrm = new Float32Array(nv * 3);
        for (i = 0; i < nTri; i++) {
          var f = i * 7;
          var ia = faces[f], ib = faces[f + 1], ic = faces[f + 2];
          var ax = pos[ia * 3], ay = pos[ia * 3 + 1], az = pos[ia * 3 + 2];
          var e1x = pos[ib * 3] - ax, e1y = pos[ib * 3 + 1] - ay, e1z = pos[ib * 3 + 2] - az;
          var e2x = pos[ic * 3] - ax, e2y = pos[ic * 3 + 1] - ay, e2z = pos[ic * 3 + 2] - az;
          // векторное произведение — длина пропорциональна площади грани
          var nx = e1y * e2z - e1z * e2y;
          var ny = e1z * e2x - e1x * e2z;
          var nz = e1x * e2y - e1y * e2x;
          vnrm[ia * 3] += nx; vnrm[ia * 3 + 1] += ny; vnrm[ia * 3 + 2] += nz;
          vnrm[ib * 3] += nx; vnrm[ib * 3 + 1] += ny; vnrm[ib * 3 + 2] += nz;
          vnrm[ic * 3] += nx; vnrm[ic * 3 + 1] += ny; vnrm[ic * 3 + 2] += nz;
        }
      }

      // ---- треугольники и их коробки ----
      var tris = new Float32Array(nTri * TRI_FLOATS);
      var tmin = new Float32Array(nTri * 3);
      var tmax = new Float32Array(nTri * 3);
      var cen = new Float32Array(nTri * 3);
      var usesFileNormals = smooth && obj.hasNormals && obj.vn.length >= 3;

      for (i = 0; i < nTri; i++) {
        var ff = i * 7;
        var A = faces[ff], B = faces[ff + 1], C = faces[ff + 2];
        var o2 = i * TRI_FLOATS;
        var p0x = pos[A * 3], p0y = pos[A * 3 + 1], p0z = pos[A * 3 + 2];
        var e1x2 = pos[B * 3] - p0x, e1y2 = pos[B * 3 + 1] - p0y, e1z2 = pos[B * 3 + 2] - p0z;
        var e2x2 = pos[C * 3] - p0x, e2y2 = pos[C * 3 + 1] - p0y, e2z2 = pos[C * 3 + 2] - p0z;

        put3(tris, o2, p0x, p0y, p0z);
        put3(tris, o2 + 4, e1x2, e1y2, e1z2);
        put3(tris, o2 + 8, e2x2, e2y2, e2z2);

        if (usesFileNormals) {
          var na = faces[ff + 3], nb = faces[ff + 4], nc = faces[ff + 5];
          if (na >= 0 && nb >= 0 && nc >= 0) {
            putNorm(tris, o2 + 12, obj.vn[na * 3], obj.vn[na * 3 + 1], obj.vn[na * 3 + 2]);
            putNorm(tris, o2 + 16, obj.vn[nb * 3], obj.vn[nb * 3 + 1], obj.vn[nb * 3 + 2]);
            putNorm(tris, o2 + 20, obj.vn[nc * 3], obj.vn[nc * 3 + 1], obj.vn[nc * 3 + 2]);
          } else {
            var gnx = e1y2 * e2z2 - e1z2 * e2y2;
            var gny = e1z2 * e2x2 - e1x2 * e2z2;
            var gnz = e1x2 * e2y2 - e1y2 * e2x2;
            for (var c2 = 0; c2 < 3; c2++) putNorm(tris, o2 + 12 + c2 * 4, gnx, gny, gnz);
          }
        } else if (vnrm) {
          putNorm(tris, o2 + 12, vnrm[A * 3], vnrm[A * 3 + 1], vnrm[A * 3 + 2]);
          putNorm(tris, o2 + 16, vnrm[B * 3], vnrm[B * 3 + 1], vnrm[B * 3 + 2]);
          putNorm(tris, o2 + 20, vnrm[C * 3], vnrm[C * 3 + 1], vnrm[C * 3 + 2]);
        } else {
          var fx = e1y2 * e2z2 - e1z2 * e2y2;
          var fy = e1z2 * e2x2 - e1x2 * e2z2;
          var fz = e1x2 * e2y2 - e1y2 * e2x2;
          for (var c3 = 0; c3 < 3; c3++) putNorm(tris, o2 + 12 + c3 * 4, fx, fy, fz);
        }

        // коробка треугольника: вершины v0, v0+e1, v0+e2
        var x0 = p0x, y0 = p0y, z0 = p0z;
        var x1 = p0x + e1x2, y1 = p0y + e1y2, z1 = p0z + e1z2;
        var x2 = p0x + e2x2, y2 = p0y + e2y2, z2 = p0z + e2z2;
        tmin[i * 3] = Math.min(x0, x1, x2);
        tmin[i * 3 + 1] = Math.min(y0, y1, y2);
        tmin[i * 3 + 2] = Math.min(z0, z1, z2);
        tmax[i * 3] = Math.max(x0, x1, x2);
        tmax[i * 3 + 1] = Math.max(y0, y1, y2);
        tmax[i * 3 + 2] = Math.max(z0, z1, z2);
        cen[i * 3] = (tmin[i * 3] + tmax[i * 3]) * 0.5;
        cen[i * 3 + 1] = (tmin[i * 3 + 1] + tmax[i * 3 + 1]) * 0.5;
        cen[i * 3 + 2] = (tmin[i * 3 + 2] + tmax[i * 3 + 2]) * 0.5;
      }

      // ---- дерево: делим пополам по самой длинной оси центров ----
      var order = new Int32Array(nTri);
      for (i = 0; i < nTri; i++) order[i] = i;

      var nodes = [];            // плоский список по 8 float
      var maxDepth = 0;

      function sortRange(lo, hi, axis) {
        var tmp = [];
        for (var t = lo; t < hi; t++) tmp.push(order[t]);
        tmp.sort(function (p, q) { return cen[p * 3 + axis] - cen[q * 3 + axis]; });
        for (var u = 0; u < tmp.length; u++) order[lo + u] = tmp[u];
      }

      function build(lo, hi, depth) {
        var ni = nodes.length;         // = индекс * 8
        nodes.length += NODE_FLOATS;

        var mnx = Infinity, mny = Infinity, mnz = Infinity;
        var mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
        for (var t = lo; t < hi; t++) {
          var ti = order[t];
          if (tmin[ti * 3] < mnx) mnx = tmin[ti * 3];
          if (tmin[ti * 3 + 1] < mny) mny = tmin[ti * 3 + 1];
          if (tmin[ti * 3 + 2] < mnz) mnz = tmin[ti * 3 + 2];
          if (tmax[ti * 3] > mxx) mxx = tmax[ti * 3];
          if (tmax[ti * 3 + 1] > mxy) mxy = tmax[ti * 3 + 1];
          if (tmax[ti * 3 + 2] > mxz) mxz = tmax[ti * 3 + 2];
        }
        nodes[ni] = mnx; nodes[ni + 1] = mny; nodes[ni + 2] = mnz;
        nodes[ni + 4] = mxx; nodes[ni + 5] = mxy; nodes[ni + 6] = mxz;

        if (hi - lo <= LEAF) {
          nodes[ni + 3] = -(lo + 1);   // отрицательный — это лист, начало треугольников
          nodes[ni + 7] = hi - lo;
          if (depth > maxDepth) maxDepth = depth;
          return;
        }

        // ось деления — самая длинная по центрам треугольников
        var emx = -Infinity, emy = -Infinity, emz = -Infinity;
        var lx = Infinity, ly = Infinity, lz = Infinity;
        var hx = -Infinity, hy = -Infinity, hz = -Infinity;
        for (t = lo; t < hi; t++) {
          var ci = order[t] * 3;
          if (cen[ci] < lx) lx = cen[ci];
          if (cen[ci] > hx) hx = cen[ci];
          if (cen[ci + 1] < ly) ly = cen[ci + 1];
          if (cen[ci + 1] > hy) hy = cen[ci + 1];
          if (cen[ci + 2] < lz) lz = cen[ci + 2];
          if (cen[ci + 2] > hz) hz = cen[ci + 2];
        }
        emx = hx - lx; emy = hy - ly; emz = hz - lz;
        var axis = (emx >= emy && emx >= emz) ? 0 : (emy >= emz ? 1 : 2);
        if (emx <= 0 && emy <= 0 && emz <= 0) {
          // все центры совпали (вырожденная пачка) — дальше не делим
          nodes[ni + 3] = -(lo + 1);
          nodes[ni + 7] = hi - lo;
          if (depth > maxDepth) maxDepth = depth;
          return;
        }

        sortRange(lo, hi, axis);
        var mid = (lo + hi) >> 1;
        build(lo, mid, depth + 1);
        var right = nodes.length / NODE_FLOATS;   // правый потомок идёт за левым поддеревом
        build(mid, hi, depth + 1);
        nodes[ni + 3] = ni / NODE_FLOATS + 1;     // левый потомок — сразу следующий узел
        nodes[ni + 7] = right;
      }

      build(0, nTri, 1);

      // ---- один буфер: узлы, затем треугольники в порядке дерева ----
      var nodeFloats = nodes.length;
      var data = new Float32Array(nodeFloats + nTri * TRI_FLOATS);
      for (i = 0; i < nodeFloats; i++) data[i] = nodes[i];
      for (i = 0; i < nTri; i++) {
        var src = order[i] * TRI_FLOATS;
        var dst = nodeFloats + i * TRI_FLOATS;
        for (var z = 0; z < TRI_FLOATS; z++) data[dst + z] = tris[src + z];
      }

      var rootMin = [data[0], data[1], data[2]];
      var rootMax = [data[4], data[5], data[6]];

      return {
        uid: nextUid++,
        data: data,
        triBase: nodeFloats,          // смещение треугольников внутри буфера модели
        triCount: nTri,
        nodeBase: 0,
        nodeCount: nodeFloats / NODE_FLOATS,
        bboxMin: rootMin,
        bboxMax: rootMax,
        tris: nTri,
        nodes: nodeFloats / NODE_FLOATS,
        depth: maxDepth,
        bytes: data.length * 4,
        color: GE.Obj.colorOf(obj, o.color)
      };
    },

    // Загрузка одной или нескольких моделей: GE.Mesh.load(['3d_objects/model.obj'], {size:2})
    // Готовая модель запоминается: возврат в сцену не читает файл заново и не занимает
    // в буфере новое место (иначе каждый заход в сцену добавлял бы свою копию).
    load: function (urls, opts) {
      var list = [].concat(urls || []);
      var o = opts || {};
      var jobs = [];
      for (var i = 0; i < list.length; i++) {
        jobs.push(loadOne(list[i], o));
      }
      return Promise.all(jobs);
    }
  };

  var cache = {};

  function loadOne(url, opts) {
    var key = url + '|' + (opts.size || 2) + '|' + (opts.smooth === false ? 'flat' : 'smooth');
    if (cache[key]) return cache[key];
    var job = GE.Obj.load(url).then(function (obj) {
      return GE.Mesh.fromObj(obj, opts);
    });
    // неудачу не запоминаем: следующий заход попробует ещё раз
    job.catch(function () { delete cache[key]; });
    cache[key] = job;
    return job;
  }
})(window.GE = window.GE || {});
