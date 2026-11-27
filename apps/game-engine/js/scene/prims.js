/* prims.js — фабрики объектов сцены: удобные конструкторы примитивов и поверхностей.
   Каждая фабрика собирает канонический объект, который понимает js/scene/pack.js.
   Сцены используют эти фабрики вместо ручной раскладки float'ов. */
(function (GE) {
  'use strict';

  function vec(x, y, z) { return [x, y, z]; }

  function len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; }
  function norm(a) { var l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  // матрица 3×3: умножение
  function mmul(A, B) {
    var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) {
      for (var j = 0; j < 3; j++) {
        C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
      }
    }
    return C;
  }

  function rotX(a) { var c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; }
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; }
  function rotZ(a) { var c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; }

  // поворот по трём углам Эйлера [rx, ry, rz] (радианы), R = Rx·Ry·Rz
  // возвращает базис {X, Y, Z} — столбцы матрицы (локальные оси в мировых координатах)
  GE.Prim = {
    eulerBasis: function (rx, ry, rz) {
      var R = mmul(mmul(rotX(rx), rotY(ry)), rotZ(rz));
      return {
        X: [R[0][0], R[1][0], R[2][0]],
        Y: [R[0][1], R[1][1], R[2][1]],
        Z: [R[0][2], R[1][2], R[2][2]]
      };
    },

    // ортонормированный базис плоскости с нормалью n (u, v, n)
    planeBasis: function (n) {
      var nn = norm(n);
      var w = Math.abs(nn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      var u = norm(cross(w, nn));
      var v = cross(nn, u);
      return { u: u, v: v, n: nn };
    },

    // ---- общие опции (invert, doubleSided, matId, id, ops) ----
    _opts: function (o, opts) {
      var p = opts || {};
      o.invert = p.invert ? 1 : 0;
      o.doubleSided = p.doubleSided ? 1 : 0;
      o.matId = p.matId || 0;
      if (p.id != null) o.id = p.id;
      if (p.ops) o.ops = p.ops;
      return o;
    },

    // ---- примитивы ----

    sphere: function (x, y, z, r, color, opts) {
      return this._opts({ kind: 'sphere', x: x, y: y, z: z, r: r, color: color }, opts);
    },

    // куб: центр (x,y,z), размеры (w,h,d), поворот rot=[rx,ry,rz] (или готовый базис {X,Y})
    box: function (x, y, z, w, h, d, rot, color, opts) {
      var b;
      if (rot && rot.X) {
        b = rot;
      } else {
        var r = rot || [0, 0, 0];
        b = this.eulerBasis(r[0], r[1], r[2]);
      }
      return this._opts({
        kind: 'box',
        cx: x, cy: y, cz: z,
        hx: w / 2, hy: h / 2, hz: d / 2,
        X: b.X, Y: b.Y,
        color: color
      }, opts);
    },

    // тор: центр, большой радиус R, радиус трубки r, наклон angle (радиан, вокруг X)
    torus: function (x, y, z, R, r, angle, color, opts) {
      var a = angle || 0;
      var n = [0, Math.cos(a), Math.sin(a)];
      var p = opts || {};
      if (p.normal) n = norm(p.normal);
      return this._opts({
        kind: 'torus', cx: x, cy: y, cz: z, R: R, r: r, n: n, color: color
      }, opts);
    },

    // конус с двумя наклонными режущими плоскостями: capA и capB = {p:[x,y,z], n:[nx,ny,nz]}
    // нормали плоскостей смотрят наружу тела.
    cone: function (A, rA, B, rB, capA, capB, color, opts) {
      return this._opts({
        kind: 'cone',
        ax: A[0], ay: A[1], az: A[2], rA: rA,
        bx: B[0], by: B[1], bz: B[2], rB: rB,
        n1: norm(capA.n), d1: -dot(norm(capA.n), capA.p),
        n2: norm(capB.n), d2: -dot(norm(capB.n), capB.p),
        color: color
      }, opts);
    },

    // цилиндр с двумя наклонными режущими плоскостями (то же тело, что конус с rA = rB)
    cylinder: function (A, r, B, capA, capB, color, opts) {
      return this._opts({
        kind: 'cylinder',
        ax: A[0], ay: A[1], az: A[2], rA: r,
        bx: B[0], by: B[1], bz: B[2], rB: r,
        n1: norm(capA.n), d1: -dot(norm(capA.n), capA.p),
        n2: norm(capB.n), d2: -dot(norm(capB.n), capB.p),
        color: color
      }, opts);
    },

    // бесконечная плоскость через точку p с нормалью n (видна только со стороны n)
    plane: function (p, n, color, opts) {
      return this._opts({
        kind: 'plane', px: p[0], py: p[1], pz: p[2],
        nx: n[0], ny: n[1], nz: n[2], color: color
      }, opts);
    },

    // прямоугольник: центр, нормаль, размер [w, h] (или готовый базис {u, v} + полуразмеры)
    rect: function (center, n, size, color, opts) {
      var basis = this.planeBasis(n);
      var u = basis.u, v = basis.v;
      var hw = size[0] / 2, hh = size[1] / 2;
      return this._opts({
        kind: 'rect',
        cx: center[0], cy: center[1], cz: center[2],
        u: u, v: v, hw: hw, hh: hh, color: color
      }, opts);
    },

    // треугольник (для полигональной графики)
    triangle: function (v0, v1, v2, color, opts) {
      return this._opts({
        kind: 'triangle', v0: v0, v1: v1, v2: v2, color: color
      }, opts);
    }
  };
})(window.GE = window.GE || {});
