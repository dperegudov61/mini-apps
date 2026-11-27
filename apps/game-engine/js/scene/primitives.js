/* primitives.js — сцена-витрина примитивов, поверхностей и булевых операций.
   Здесь собраны все виды тел: сфера, повёрнутый куб, тор, конус и цилиндр с наклонными
   срезами, бесконечная плоскость, прямоугольник, треугольник — и два примера CSG:
   «сфера минус цилиндр» (сквозное отверстие) и «объединение двух сфер» (гантель).

   Объекты собираются фабриками GE.Prim.* (js/scene/prims.js); зависимости между
   объектами задаются через ops с указанной операцией. */
(function (GE) {
  'use strict';

  var P = GE.Prim;
  var DEG = Math.PI / 180;

  function PrimitivesScene() {
    this.objects = [];
    this.time = 0;
    this.env = { sunHeight: 34, exposure: 1, stars: 0, grid: 1 };
    this.sun = GE.sunFor(34);
    this.reset();
  }

  PrimitivesScene.prototype.reset = function () {
    this.time = 0;
    this.build();
  };

  PrimitivesScene.prototype.build = function () {
    var o = this.objects;
    o.length = 0;

    // ---- твёрдые примитивы (ряд слева направо) ----

    // куб: центр, ширина/высота/глубина и поворот (ползунок «поворот»)
    this.box = P.box(-9, 1.3, 0, 2.0, 2.0, 2.0, [0, 0, 0], [0.62, 0.55, 0.90]);
    o.push(this.box);

    // сфера — как была: центр и радиус
    o.push(P.sphere(-6, 1.2, 0, 1.15, [0.93, 0.66, 0.32]));

    // тор: два радиуса, центр, наклон (ползунок «наклон тора»)
    this.torus = P.torus(-3, 1.35, 0, 1.05, 0.42, 0, [0.36, 0.72, 0.55]);
    o.push(this.torus);

    // конус, усечённый двумя наклонными плоскостями
    o.push(P.cone(
      [0, 0, 0], 1.0, [0, 3.0, 0], 0.35,
      { p: [0, 0.25, 0], n: [0.0, -1.0, 0.45] },     // нижняя плоскость, наклон вперёд
      { p: [0, 2.75, 0], n: [0.0, 1.0, 0.30] },      // верхняя плоскость, наклон назад
      [0.85, 0.45, 0.35]));

    // цилиндр, усечённый двумя наклонными плоскостями
    o.push(P.cylinder(
      [3, 0, 0], 0.85, [3, 3.0, 0],
      { p: [3, 0.25, 0], n: [0.0, -1.0, 0.40] },
      { p: [3, 2.75, 0], n: [0.0, 1.0, 0.35] },
      [0.45, 0.60, 0.90]));

    // ---- CSG: сфера минус цилиндр (сквозное отверстие) ----
    // 'plugHole' — деталь, на которую ссылается 'plug'; сама она не рисуется.
    o.push(P.sphere(6, 1.35, 0, 1.15, [0.90, 0.55, 0.40],
      { id: 'plug', ops: [{ op: 'subtract', ref: 'plugHole' }] }));
    o.push(P.cylinder(
      [6, 1.35, -2], 0.45, [6, 1.35, 2],
      { p: [6, 1.35, -2], n: [0, 0, -1] },
      { p: [6, 1.35, 2], n: [0, 0, 1] },
      [0.30, 0.32, 0.38], { id: 'plugHole' }));

    // ---- CSG: объединение двух сфер (гантель) ----
    o.push(P.sphere(9, 1.25, -0.6, 0.75, [0.45, 0.75, 0.45],
      { id: 'dumbA', ops: [{ op: 'union', ref: 'dumbB' }] }));
    o.push(P.sphere(9, 1.25, 0.6, 0.75, [0.45, 0.75, 0.45], { id: 'dumbB' }));

    // ---- поверхности ----

    // плоскость с ограничением радиуса: круглая плита слева над рядом.
    // Бесконечную сюда ставить нельзя: она закрывает собой всё небо,
    // как только камера опустится ниже неё (и раньше выглядела чёрной,
    // потому что света неба на поверхности с нормалью вниз нет).
    o.push(P.plane([-13, 3.4, -1], [0, -1, 0], [0.40, 0.44, 0.56], { radius: 4.2 }));

    // прямоугольник заданного размера — «вывеска» к камере
    o.push(P.rect([-4.5, 3.4, -3.5], [0, 0.2, 1], [3.2, 1.1], [0.85, 0.80, 0.30]));

    // треугольник (полигональная графика)
    o.push(P.triangle(
      [10.5, 2.0, -2.0], [12.2, 2.0, -1.0], [11.0, 3.6, -1.6],
      [0.90, 0.40, 0.60]));
  };

  PrimitivesScene.prototype.update = function (dt, p) {
    this.time += dt * p.speed;

    this.env.sunHeight = p.sunHeight;
    this.env.exposure = p.exposure;
    this.env.stars = p.stars;
    this.env.grid = p.grid;
    this.sun = GE.sunFor(p.sunHeight);

    // поворот куба: ползунок + лёгкое покачивание
    var turn = (p.turn || 0) * DEG + Math.sin(this.time * 0.5) * 0.08;
    var bb = GE.Prim.eulerBasis(0, turn, 0);
    this.box.X = bb.X;
    this.box.Y = bb.Y;

    // наклон тора: ползунок + покачивание
    var tilt = (p.tilt || 0) * DEG + Math.sin(this.time * 0.4) * 0.06;
    this.torus.n = [0, Math.cos(tilt), Math.sin(tilt)];
  };

  PrimitivesScene.prototype.status = function () {
    return GE.t('game-engine.primsStatus',
      '{0} primitives · boolean ops: subtract and union', [String(this.objects.length)]);
  };

  GE.Scenes.define({
    id: 'primitives',
    label: 'game-engine.scenePrims',
    fb: 'primitives & surfaces',
    note: 'game-engine.scenePrimsNote',
    noteFb: 'every primitive and surface, plus boolean ops: a drilled sphere and a dumbbell',
    camera: { target: [0, 1.6, 0], yaw: 0.0, pitch: 0.30, distance: 26 },
    params: [
      GE.SceneParts.sun(34),
      GE.SceneParts.speed(1),
      GE.SceneParts.exposure(1),
      { key: 'turn', label: 'game-engine.primsTurn', fb: 'box rotation',
        min: -180, max: 180, step: 1, def: 24, fmt: GE.SceneFmt.deg },
      { key: 'tilt', label: 'game-engine.primsTilt', fb: 'torus tilt',
        min: -80, max: 80, step: 1, def: 34, fmt: GE.SceneFmt.deg }
    ],
    toggles: [
      GE.SceneParts.stars(0),
      GE.SceneParts.grid(1)
    ],
    actions: [],
    create: function () { return new PrimitivesScene(); }
  });
})(window.GE = window.GE || {});
