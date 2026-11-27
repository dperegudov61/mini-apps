/* poly.js — сцена полигональных моделей: треугольная сетка из файла OBJ.
   Модель читает js/scene/obj.js, дерево и буфер собирает js/scene/mesh.js,
   а шейдер обходит это дерево (shaders/primitives.wgsl → meshLeaf).

   Модель грузится асинхронно: пока файла нет, в сцене только подставка,
   в строке состояния — «загружаю». Пришла — появляется сама собой.

   Что здесь можно менять ползунками: поворот модели, высота солнца, яркость.
   Модель крутится без пересылки буфера: поворот применяется к лучу в шейдере,
   поэтому вращение не стоит кадра (в отличие от пересборки вершин). */
(function (GE) {
  'use strict';

  var DEG = Math.PI / 180;

  // какие файлы показывать. Пути считаются от папки приложения (index.html).
  // Новая модель — просто строка в этом списке; формат — Wavefront OBJ (см. README).
  var MODELS = ['3d_objects/model.obj'];

  var SIZE = 2.2;        // длинная сторона модели в метрах
  var LIFT = 1.05;       // высота центра модели над подставкой

  function PolyScene() {
    this.objects = [];
    this.time = 0;
    this.env = { sunHeight: 36, exposure: 1, stars: 0, grid: 1 };
    this.sun = GE.sunFor(36);
    this.models = [];
    this.loading = true;
    this.error = '';
    this.angle = 0;
    this.reset();
  }

  PolyScene.prototype.reset = function () {
    this.time = 0;
    this.angle = 0;
    this.build();
    this.load();
  };

  // объекты сцены: подставка и (когда пришла) модель
  PolyScene.prototype.build = function () {
    var o = this.objects;
    o.length = 0;

    // круглая плита: пол под моделью. Бесконечную плоскость сюда ставить нельзя —
    // она закроет всё небо, как только камера опустится ниже (см. README)
    o.push(GE.Prim.plane([0, 0, 0], [0, 1, 0], [0.12, 0.13, 0.16], { radius: 2.6 }));

    if (this.models.length) {
      for (var i = 0; i < this.models.length; i++) {
        var m = this.models[i];
        var p = GE.Prim.mesh(m, [0, LIFT + i * 0.1, 0], m.color, {
          rot: [0, this.angle, 0]
        });
        if (i === 0) this.model = p;
        o.push(p);
      }
    }
  };

  PolyScene.prototype.load = function () {
    if (this.promise) return this.promise;
    var self = this;
    this.promise = GE.Mesh.load(MODELS, { size: SIZE })
      .then(function (meshes) {
        self.models = meshes;
        self.loading = false;
        self.build();
      }, function (err) {
        self.loading = false;
        self.error = (err && err.message) ? err.message : String(err);
      });
    return this.promise;
  };

  PolyScene.prototype.update = function (dt, p) {
    this.time += dt * p.speed;

    this.env.sunHeight = p.sunHeight;
    this.env.exposure = p.exposure;
    this.env.stars = p.stars;
    this.env.grid = p.grid;
    this.sun = GE.sunFor(p.sunHeight);

    // поворот: ползунок + медленное вращение
    this.angle = (p.turn || 0) * DEG + this.time * 0.55;
    if (this.model) {
      var b = GE.Prim.eulerBasis(0, this.angle, 0);
      this.model.X = b.X;
      this.model.Y = b.Y;
      this.model.Z = b.Z;
    }
  };

  PolyScene.prototype.status = function () {
    if (this.loading) {
      return GE.t('game-engine.polyLoading', 'loading model…');
    }
    if (this.error) {
      return GE.t('game-engine.polyError', 'model failed to load: {0}', [this.error]);
    }
    var tris = 0, nodes = 0, bytes = 0;
    for (var i = 0; i < this.models.length; i++) {
      tris += this.models[i].tris;
      nodes += this.models[i].nodes;
      bytes += this.models[i].bytes;
    }
    return GE.t('game-engine.polyStatus',
      '{0} triangles · {1} BVH nodes · {2} KB',
      [String(tris), String(nodes), String(Math.round(bytes / 1024))]);
  };

  GE.Scenes.define({
    id: 'poly',
    label: 'game-engine.scenePoly',
    fb: 'polygonal model',
    note: 'game-engine.scenePolyNote',
    noteFb: 'a triangle mesh from an OBJ file, traced through a bounding-volume tree',
    camera: { target: [0, 1.05, 0], yaw: 0.5, pitch: 0.17, distance: 4.6 },
    params: [
      GE.SceneParts.sun(36),
      GE.SceneParts.speed(1),
      GE.SceneParts.exposure(1),
      { key: 'turn', label: 'game-engine.polyTurn', fb: 'model rotation',
        min: -180, max: 180, step: 1, def: 0, fmt: GE.SceneFmt.deg }
    ],
    toggles: [
      GE.SceneParts.stars(0),
      GE.SceneParts.grid(1)
    ],
    actions: [],
    create: function () { return new PolyScene(); }
  });
})(window.GE = window.GE || {});
