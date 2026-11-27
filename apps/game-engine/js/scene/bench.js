/* bench.js — сцена-бенчмарк для проверки движка и сбора данных о стабильности.
   Куб 16×16×16 сфер появляется по одной снизу вверх; скорость появления задаёт ползунок
   (1…100 сфер в секунду). Число примитивов растёт от 0 до 4096 — по графику времени кадра
   видно, как движок держит нагрузку: ровная линия, ступеньки, рывки. */
(function (GE) {
  'use strict';

  var N = 16;                 // сфер по ребру куба
  var TOTAL = N * N * N;      // 4096
  var SPACING = 1;            // шаг сетки, метры
  var RADIUS = 0.30;          // радиус сферы, метры

  // простая палитра без таблиц: t 0…1 → цвет, плавный переход по кругу
  function palette(t) {
    return [
      0.5 + 0.5 * Math.cos(6.2832 * (t + 0.00)),
      0.5 + 0.5 * Math.cos(6.2832 * (t + 0.33)),
      0.5 + 0.5 * Math.cos(6.2832 * (t + 0.66))
    ];
  }

  // порядок появления: слой за слоем снизу вверх, чтобы рост был виден глазом
  function buildPlan() {
    var out = [];
    var half = (N - 1) / 2;
    for (var j = 0; j < N; j++) {
      for (var i = 0; i < N; i++) {
        for (var k = 0; k < N; k++) {
          out.push({
            kind: 'sphere',
            x: (i - half) * SPACING,
            y: 0.5 + j * SPACING,
            z: (k - half) * SPACING,
            r: RADIUS,
            color: palette(0.10 + (j / N) * 0.60 + ((i + k) / (2 * N)) * 0.28)
          });
        }
      }
    }
    return out;
  }

  function BenchScene() {
    this.objects = [];
    this.plan = buildPlan();
    this.spawned = 0;
    this.acc = 0;
    this.time = 0;
    this.env = { sunHeight: 42, exposure: 1, stars: 0, grid: 1 };
    this.sun = GE.sunFor(42);
    this.reset();
  }

  BenchScene.prototype.reset = function () {
    this.objects.length = 0;
    this.spawned = 0;
    this.acc = 0;
    this.time = 0;
  };

  // добавить n сфер из заготовки (готовые объекты не меняются — можно класть как есть)
  BenchScene.prototype.spawn = function (n) {
    while (n > 0 && this.spawned < TOTAL) {
      this.objects.push(this.plan[this.spawned]);
      this.spawned += 1;
      n -= 1;
    }
  };

  // кнопка сцены: поставить все 4096 сразу, не ожидая ползунка скорости
  BenchScene.prototype.fillAll = function () {
    this.spawn(TOTAL - this.spawned);
    this.acc = 0;
  };

  BenchScene.prototype.update = function (dt, p) {
    this.time += dt;

    this.env.sunHeight = p.sunHeight;
    this.env.exposure = p.exposure;
    this.env.stars = p.stars;
    this.env.grid = p.grid;
    this.sun = GE.sunFor(p.sunHeight);

    // на паузе dt = 0: ни одной сферы, но солнце и ползунки продолжают работать
    if (dt > 0 && this.spawned < TOTAL) {
      this.acc += p.rate * dt;
      var n = Math.floor(this.acc);
      if (n > 0) {
        this.acc -= n;
        this.spawn(n);
      }
    }
  };

  BenchScene.prototype.status = function (p) {
    if (this.spawned >= TOTAL) {
      return GE.t('game-engine.benchFull', 'the cube is full: {0} spheres', [String(TOTAL)]);
    }
    return GE.t('game-engine.benchStatus', '{0} / {1} spheres · {2}/s',
      [String(this.spawned), String(TOTAL), p.rate.toFixed(0)]);
  };

  GE.Scenes.define({
    id: 'bench',
    label: 'game-engine.sceneBench',
    fb: 'sphere cube 16×16×16',
    note: 'game-engine.sceneBenchNote',
    noteFb: 'spheres appear one by one in a 16×16×16 cube: a load and stability test',
    camera: { target: [0, 8, 0], yaw: 0.9, pitch: 0.38, distance: 32 },
    params: [
      GE.SceneParts.rate(20),
      GE.SceneParts.sun(42),
      GE.SceneParts.exposure(1)
    ],
    toggles: [
      GE.SceneParts.stars(0),
      GE.SceneParts.grid(1)
    ],
    actions: [
      { key: 'fill', label: 'game-engine.benchFill', fb: 'fill now',
        run: function (scene) { scene.fillAll(); } }
    ],
    create: function () { return new BenchScene(); }
  });

  GE.BENCH_TOTAL = TOTAL;
})(window.GE = window.GE || {});
