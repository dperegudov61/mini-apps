/* bench.js — сцена-бенчмарк для проверки движка и сбора данных о стабильности.
   Куб 16×16×16 сфер; ползунок «объектов» задаёт ТОЧНОЕ число тел (0…4096), поэтому
   зависимость «сколько тел → сколько мс» видна прямо на графике: подвинули ползунок —
   линия времени кадра встала на новую высоту. Ползунок «сфер в секунду» (> 0) заставляет
   сцену расти самой — старый способ смотреть, как движок держит наплыв. */
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
    this.countSet = -1;      // «применить ползунок при следующем обновлении»
  };

  // точное число тел: сразу столько, сколько просят (0…TOTAL)
  BenchScene.prototype.setCount = function (n) {
    var want = Math.max(0, Math.min(TOTAL, Math.round(n || 0)));
    if (this.objects.length > want) this.objects.length = want;
    while (this.objects.length < want) this.objects.push(this.plan[this.objects.length]);
    this.spawned = this.objects.length;
    this.acc = 0;
  };

  // добавить n сфер из заготовки (готовые объекты не меняются — можно класть как есть)
  BenchScene.prototype.spawn = function (n) {
    while (n > 0 && this.spawned < TOTAL) {
      this.objects.push(this.plan[this.spawned]);
      this.spawned += 1;
      n -= 1;
    }
  };

  // кнопка сцены: поставить все 4096 сразу, не ожидая ползунка
  BenchScene.prototype.fillAll = function (settings) {
    this.setCount(TOTAL);
    this.countSet = TOTAL;
    if (settings) settings.count = TOTAL;   // ползунок встаёт на максимум
  };

  BenchScene.prototype.update = function (dt, p) {
    this.time += dt;

    this.env.sunHeight = p.sunHeight;
    this.env.exposure = p.exposure;
    this.env.stars = p.stars;
    this.env.grid = p.grid;
    this.sun = GE.sunFor(p.sunHeight);

    // ползунок «объектов» главнее: подвинули — сразу ровно столько тел
    if (p.count !== this.countSet) {
      this.countSet = p.count;
      this.setCount(p.count);
    } else if (dt > 0 && p.rate > 0 && this.spawned < TOTAL) {
      // иначе сцена растёт сама — старый способ смотреть, как движок держит наплыв
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
    noteFb: 'the exact number of spheres in a 16×16×16 cube — a load and stability test',
    camera: { target: [0, 8, 0], yaw: 0.9, pitch: 0.38, distance: 32 },
    params: [
      GE.SceneParts.count(0, TOTAL),
      GE.SceneParts.rate(0),
      GE.SceneParts.sun(42),
      GE.SceneParts.exposure(1)
    ],
    toggles: [
      GE.SceneParts.stars(0),
      GE.SceneParts.grid(1)
    ],
    actions: [
      { key: 'fill', label: 'game-engine.benchFill', fb: 'fill now',
        run: function (scene, settings) { scene.fillAll(settings); } }
    ],
    create: function () { return new BenchScene(); }
  });

  GE.BENCH_TOTAL = TOTAL;
})(window.GE = window.GE || {});
