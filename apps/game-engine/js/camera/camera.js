/* camera.js — орбитальная камера вокруг цели.
   Считает ровно то, что ждёт шейдер: позицию и три вектора базиса (вперёд, вправо, вверх).
   Вращение тянется за мышью с мягким сглаживанием, клавиши двигают цель.
   Начальное положение приходит из сцены (scene/*.js → camera). */
(function (GE) {
  'use strict';

  var DEG = Math.PI / 180;

  var DEFAULTS = {
    target: [0, 1.5, 0],
    yaw: 0.75,        // радианы, поворот вокруг вертикали
    pitch: 0.32,      // радианы, подъём над целью
    distance: 12.5,   // метров от цели
    fov: 52 * DEG     // вертикальный угол обзора
  };

  var PITCH_MIN = 0.02;    // ниже цели камера не уходит — не ныряем под землю
  var PITCH_MAX = 1.40;
  var DIST_MIN = 4;
  var DIST_MAX = 60;
  var MOVE_SPEED = 7;      // метров в секунду при движении клавишами

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function num(v, def) {
    return (typeof v === 'number' && isFinite(v)) ? v : def;
  }

  function normalize(v) {
    var len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  function Camera() {
    this.keys = {};          // что нажато сейчас (см. input/input.js)
    this.reset();
  }

  // сцена задаёт своё положение камеры: {target, yaw, pitch, distance, fov}
  Camera.prototype.apply = function (view) {
    var v = view || {};
    var d = DEFAULTS;

    this.target = (v.target || d.target).slice();
    this.yaw = num(v.yaw, d.yaw);
    this.pitch = clamp(num(v.pitch, d.pitch), PITCH_MIN, PITCH_MAX);
    this.distance = clamp(num(v.distance, d.distance), DIST_MIN, DIST_MAX);
    this.fov = num(v.fov, d.fov);

    // сглаженные значения сразу равны целям: переключение сцены без «полёта»
    this.sYaw = this.yaw;
    this.sPitch = this.pitch;
    this.sDist = this.distance;
    this.sTarget = this.target.slice();

    this.position = [0, 0, 0];
    this.forward = [0, 0, -1];
    this.right = [1, 0, 0];
    this.up = [0, 1, 0];

    this.computeBasis();
  };

  Camera.prototype.reset = function (view) {
    this.apply(view);
  };

  // перетаскивание: dx, dy — доля ширины/высоты кадра
  Camera.prototype.orbit = function (dx, dy) {
    this.yaw -= dx * 2.8;
    this.pitch = clamp(this.pitch + dy * 2.2, PITCH_MIN, PITCH_MAX);
  };

  // колесо: шаг > 0 — отдаляемся
  Camera.prototype.zoom = function (steps) {
    this.distance = clamp(this.distance * Math.pow(1.12, steps), DIST_MIN, DIST_MAX);
  };

  Camera.prototype.update = function (dt) {
    var k = this.keys;

    // стрелки вращают, WASD двигает цель, Q/E поднимают и опускают её
    if (k.ArrowLeft) this.yaw += dt * 1.6;
    if (k.ArrowRight) this.yaw -= dt * 1.6;
    if (k.ArrowUp) this.pitch = clamp(this.pitch + dt * 1.1, PITCH_MIN, PITCH_MAX);
    if (k.ArrowDown) this.pitch = clamp(this.pitch - dt * 1.1, PITCH_MIN, PITCH_MAX);

    var step = MOVE_SPEED * dt;
    if (step > 0) {
      var flatF = normalize([this.forward[0], 0, this.forward[2]]);
      var flatR = normalize([this.right[0], 0, this.right[2]]);
      if (k.KeyW) this.shiftTarget(flatF, step);
      if (k.KeyS) this.shiftTarget(flatF, -step);
      if (k.KeyD) this.shiftTarget(flatR, step);
      if (k.KeyA) this.shiftTarget(flatR, -step);
      if (k.KeyE) this.target[1] += step;
      if (k.KeyQ) this.target[1] -= step;
      this.target[1] = clamp(this.target[1], 0.3, 24);
    }

    // сглаживание: чем больше шаг, тем ближе к цели
    var a = dt > 0 ? Math.min(1, dt * 12) : 1;
    this.sYaw += (this.yaw - this.sYaw) * a;
    this.sPitch += (this.pitch - this.sPitch) * a;
    this.sDist += (this.distance - this.sDist) * a;
    for (var i = 0; i < 3; i++) this.sTarget[i] += (this.target[i] - this.sTarget[i]) * a;

    this.computeBasis();
  };

  Camera.prototype.shiftTarget = function (dir, step) {
    this.target[0] += dir[0] * step;
    this.target[1] += dir[1] * step;
    this.target[2] += dir[2] * step;
  };

  // позиция вокруг цели + правый базис (мировое «вверх» — ось Y)
  Camera.prototype.computeBasis = function () {
    var cp = Math.cos(this.sPitch);
    var sp = Math.sin(this.sPitch);
    var t = this.sTarget;
    var d = this.sDist;

    var pos = [
      t[0] + d * cp * Math.sin(this.sYaw),
      t[1] + d * sp,
      t[2] + d * cp * Math.cos(this.sYaw)
    ];

    var fwd = normalize([t[0] - pos[0], t[1] - pos[1], t[2] - pos[2]]);
    var right = normalize(cross(fwd, [0, 1, 0]));
    var up = cross(right, fwd);

    this.position = pos;
    this.forward = fwd;
    this.right = right;
    this.up = up;
  };

  GE.Camera = Camera;
  GE.CAMERA_DEFAULTS = DEFAULTS;
})(window.GE = window.GE || {});
