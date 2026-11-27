/* bench.js — сцена-бенчмарк для проверки движка и сбора данных о стабильности.
   Куб сфер: ползунок «сфер по ребру» задаёт размер куба (4…32), то есть сразу и
   нагрузку: 4³ = 64 тела, 32³ = 32768. Куб всегда занимает один и тот же объём
   (16 м), поэтому на экране меняется густота, а не кадрирование — сравнивать честно.
   Ползунок «сфер в секунду» (> 0) заставляет сцену расти самой от нуля до полного
   куба — старый способ смотреть, как движок держит наплыв.
   Сцена стартует ПУСТОЙ: число сфер в кадре не запоминается, чтобы после перезагрузки
   бенчмарк начинался с нуля, а не с прошлой тяжёлой сцены. */
(function (GE) {
  'use strict';

  var EDGE_MIN = 4;           // сфер по ребру: нижняя граница ползунка (4³ = 64)
  var EDGE_MAX = 32;          // верхняя (32³ = 32768) — она же потолок буфера примитивов
  var EDGE_DEF = 8;           // с чего начинается ползунок (8³ = 512)
  var SIZE = 16;              // объём куба, метры: один и тот же при любом числе тел
  var RADIUS = 0.30;          // радиус сферы в долях шага сетки

  // простая палитра без таблиц: t 0…1 → цвет, плавный переход по кругу
  function palette(t) {
    return [
      0.5 + 0.5 * Math.cos(6.2832 * (t + 0.00)),
      0.5 + 0.5 * Math.cos(6.2832 * (t + 0.33)),
      0.5 + 0.5 * Math.cos(6.2832 * (t + 0.66))
    ];
  }

  // куб edge³: снизу вверх, слой за слоем — так виден порядок появления
  function buildPlan(edge) {
    var out = [];
    var step = SIZE / edge;                 // шаг сетки подстраивается под объём куба
    var half = (edge - 1) / 2;
    for (var j = 0; j < edge; j++) {
      for (var i = 0; i < edge; i++) {
        for (var k = 0; k < edge; k++) {
          out.push({
            kind: 'sphere',
            x: (i - half) * step,
            y: 0.5 + j * step,
            z: (k - half) * step,
            r: RADIUS * step,
            color: palette(0.10 + (j / edge) * 0.60 + ((i + k) / (2 * edge)) * 0.28)
          });
        }
      }
    }
    return out;
  }

  function BenchScene() {
    this.edge = EDGE_DEF;
    this.plan = buildPlan(this.edge);
    this.objects = [];
    this.spawned = 0;
    this.acc = 0;
    this.time = 0;
    this.env = { sunHeight: 42, exposure: 1, stars: 0, grid: 1 };
    this.sun = GE.sunFor(42);
    this.reset();
  }

  BenchScene.prototype.total = function () {
    return this.edge * this.edge * this.edge;
  };

  BenchScene.prototype.reset = function () {
    this.objects.length = 0;
    this.spawned = 0;
    this.acc = 0;
    this.time = 0;
    // первый кадр только принимает ползунок как есть: сцена начинается пустой
    this.fresh = true;
    this.edgeSet = -1;
  };

  // заново собрать куб другого размера
  BenchScene.prototype.setEdge = function (n) {
    var edge = Math.max(EDGE_MIN, Math.min(EDGE_MAX, Math.round(n || EDGE_DEF)));
    if (edge === this.edge) return;
    this.edge = edge;
    this.plan = buildPlan(edge);
  };

  // точное число тел: сразу столько, сколько просят (0…edge³)
  BenchScene.prototype.setCount = function (n) {
    var want = Math.max(0, Math.min(this.total(), Math.round(n || 0)));
    if (this.objects.length > want) this.objects.length = want;
    while (this.objects.length < want) this.objects.push(this.plan[this.objects.length]);
    this.spawned = this.objects.length;
    this.acc = 0;
  };

  // добавить n сфер из заготовки (готовые объекты не меняются — можно класть как есть)
  BenchScene.prototype.spawn = function (n) {
    var total = this.total();
    while (n > 0 && this.spawned < total) {
      this.objects.push(this.plan[this.spawned]);
      this.spawned += 1;
      n -= 1;
    }
  };

  // кнопка сцены: поставить весь куб сразу, не ожидая ползунка
  BenchScene.prototype.fillAll = function () {
    this.setCount(this.total());
  };

  BenchScene.prototype.update = function (dt, p) {
    this.time += dt;

    this.env.sunHeight = p.sunHeight;
    this.env.exposure = p.exposure;
    this.env.stars = p.stars;
    this.env.grid = p.grid;
    this.sun = GE.sunFor(p.sunHeight);

    // ползунок «сфер по ребру»: сменили — куб сразу такого размера и полный
    if (this.fresh) {
      // вход в сцену: принимаем сохранённый размер, но начинаем с нуля тел
      this.fresh = false;
      this.setEdge(p.edge);
      this.edgeSet = this.edge;
    } else if (p.edge !== this.edgeSet) {
      // сменили размер куба: меняется только геометрия — число тел остаётся прежним,
      // само по себе ничего не появляется. Массив пересобирается ЦЕЛИКОМ: иначе в нём
      // остаются сферы старой сетки впереди новых, и куб выглядит поломанным
      this.edgeSet = p.edge;
      var keep = this.spawned;
      this.setEdge(p.edge);
      this.objects.length = 0;
      this.setCount(Math.min(keep, this.total()));
    } else if (dt > 0 && p.rate > 0 && this.spawned < this.total()) {
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
    if (this.spawned >= this.total()) {
      return GE.t('game-engine.benchFull', 'the cube is full: {0} spheres', [String(this.spawned)]);
    }
    return GE.t('game-engine.benchStatus', '{0} / {1} spheres · {2}/s',
      [String(this.spawned), String(this.total()), p.rate.toFixed(0)]);
  };

  GE.Scenes.define({
    id: 'bench',
    label: 'game-engine.sceneBench',
    fb: 'sphere cube',
    note: 'game-engine.sceneBenchNote',
    noteFb: 'a cube of spheres: the edge length sets the load — from 4³ to 32³',
    camera: { target: [0, 8.5, 0], yaw: 0.9, pitch: 0.38, distance: 36 },
    params: [
      { key: 'edge', label: 'game-engine.benchEdge', fb: 'spheres per edge',
        min: EDGE_MIN, max: EDGE_MAX, step: 1, def: EDGE_DEF,
        fmt: function (v) { var e = Math.round(v); return e + ' · ' + (e * e * e); } },
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
        run: function (scene) { scene.fillAll(); } }
    ],
    create: function () { return new BenchScene(); }
  });

  GE.BENCH_EDGE = { min: EDGE_MIN, max: EDGE_MAX, def: EDGE_DEF };
})(window.GE = window.GE || {});
