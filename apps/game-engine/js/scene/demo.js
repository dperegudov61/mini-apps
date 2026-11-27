/* demo.js — сцена-стенд: пьедестал со сферой, ступени, обелиски, парящий куб
   и сферы на орбитах над землёй-сеткой. Вся раскладка и движение — здесь, на процессоре.
   Шейдер о ней ничего не знает: он получает готовые примитивы. */
(function (GE) {
  'use strict';

  function sphere(x, y, z, r, color) {
    return { kind: 'sphere', x: x, y: y, z: z, r: r, color: color };
  }

  function cone(a, rA, b, rB, color) {
    return { kind: 'cone', a: a, rA: rA, b: b, rB: rB, color: color };
  }

  function box(min, max, color) {
    return { kind: 'box', min: min, max: max, color: color };
  }

  var FLOAT_SIZE = 0.44;

  function DemoScene() {
    this.objects = [];
    this.orbiters = [];
    this.time = 0;
    this.env = { sunHeight: 30, exposure: 1, stars: 1, grid: 1 };
    this.sun = GE.sunFor(30);
    this.reset();
  }

  DemoScene.prototype.reset = function () {
    this.time = 0;
    this.build();
  };

  // ---- раскладка: пьедестал со сферой, три ступени, три обелиска,
  //      парящий куб и три сферы на орбитах -------------------------------
  DemoScene.prototype.build = function () {
    var o = this.objects;
    var ob = this.orbiters;
    o.length = 0;
    ob.length = 0;

    // пьедестал и сфера на нём — центр композиции
    o.push(box([-1.5, 0, -1.5], [1.5, 1.0, 1.5], [0.40, 0.42, 0.48]));
    o.push(sphere(0, 2.15, 0, 1.15, [0.93, 0.66, 0.32]));

    // три ступени, уходящие вправо
    o.push(box([1.9, 0, -1.1], [3.1, 0.45, 1.1], [0.34, 0.36, 0.42]));
    o.push(box([3.3, 0, -1.1], [4.5, 0.90, 1.1], [0.30, 0.32, 0.38]));
    o.push(box([4.7, 0, -1.1], [5.9, 1.35, 1.1], [0.26, 0.28, 0.34]));

    // парящий куб: его границы пересобираются каждый кадр
    this.floatBox = box([0, 0, 0], [0, 0, 0], [0.86, 0.74, 0.36]);
    o.push(this.floatBox);

    // обелиски-конусы по краям
    o.push(cone([0, 0, -6.2], 0.95, [0, 3.4, -6.2], 0.06, [0.22, 0.55, 0.40]));
    o.push(cone([-5.8, 0, 3.2], 0.80, [-5.8, 2.6, 3.2], 0.05, [0.58, 0.38, 0.24]));
    o.push(cone([5.8, 0, 3.2], 0.80, [5.8, 3.0, 3.2], 0.05, [0.44, 0.44, 0.58]));

    // сферы на орбитах вокруг центра
    var orbits = [
      { r: 3.6, height: 0.78, speed: 0.55, phase: 0.0, size: 0.62, color: [0.28, 0.60, 0.95] },
      { r: 4.8, height: 1.35, speed: -0.42, phase: 2.1, size: 0.50, color: [0.30, 0.85, 0.72] },
      { r: 2.8, height: 2.55, speed: 0.90, phase: 4.0, size: 0.42, color: [0.95, 0.42, 0.55] }
    ];
    for (var i = 0; i < orbits.length; i++) {
      var s = orbits[i];
      var obj = sphere(0, s.height, 0, s.size, s.color);
      o.push(obj);
      ob.push({ obj: obj, radius: s.r, height: s.height, speed: s.speed, phase: s.phase });
    }

    this.placeFloatBox(4.35);
  };

  DemoScene.prototype.placeFloatBox = function (lift) {
    var b = this.floatBox;
    var s = FLOAT_SIZE;
    b.min = [-s, lift, -s];
    b.max = [s, lift + s * 2, s];
  };

  // ---- каждый кадр: время, орбиты, парящий куб, солнце -------------------
  DemoScene.prototype.update = function (dt, p) {
    this.time += dt * (0.1 + p.speed * 0.9);

    this.env.sunHeight = p.sunHeight;
    this.env.exposure = p.exposure;
    this.env.stars = p.stars;
    this.env.grid = p.grid;
    this.sun = GE.sunFor(p.sunHeight);

    var t = this.time;

    for (var i = 0; i < this.orbiters.length; i++) {
      var o = this.orbiters[i];
      var ang = t * o.speed + o.phase;
      o.obj.x = Math.cos(ang) * o.radius;
      o.obj.z = Math.sin(ang) * o.radius;
      o.obj.y = o.height + o.obj.r + Math.sin(t * 1.3 + o.phase) * 0.22;
    }

    this.placeFloatBox(4.35 + Math.sin(t * 0.9 + 1.2) * 0.38);
  };

  DemoScene.prototype.status = function () {
    return '';
  };

  GE.Scenes.define({
    id: 'demo',
    label: 'game-engine.sceneDemo',
    fb: 'test bench',
    note: 'game-engine.sceneDemoNote',
    noteFb: 'pedestal, steps, obelisks and orbiting spheres over a grid floor',
    camera: { target: [0, 1.5, 0], yaw: 0.75, pitch: 0.32, distance: 12.5 },
    params: [
      GE.SceneParts.sun(30),
      GE.SceneParts.speed(1),
      GE.SceneParts.exposure(1)
    ],
    toggles: [
      GE.SceneParts.stars(1),
      GE.SceneParts.grid(1)
    ],
    actions: [],
    create: function () { return new DemoScene(); }
  });
})(window.GE = window.GE || {});
