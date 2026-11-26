/* game.js — игровая логика. Живёт на процессоре и отдаёт шейдеру готовые числа. */
(function (GE) {
  'use strict';

  function Game() {
    this.time = 0;
    this.frame = 0;
    this.wave = 0;
    this.energy = 0;
    this.ball = { x: 0, y: 0, vx: 0, vy: 0, r: 24 };
    this.mouse = { x: 0, y: 0, inside: false };
    this.width = 1;
    this.height = 1;
  }

  Game.prototype.reset = function (w, h) {
    this.width = Math.max(w, 1);
    this.height = Math.max(h, 1);
    this.ball.x = this.width * 0.34;
    this.ball.y = this.height * 0.42;
    this.ball.vx = this.width * 0.34;
    this.ball.vy = this.height * 0.26;
    this.mouse.x = this.width * 0.5;
    this.mouse.y = this.height * 0.5;
  };

  Game.prototype.setMouse = function (x, y, inside) {
    this.mouse.x = x;
    this.mouse.y = y;
    this.mouse.inside = inside;
  };

  // щелчок по полю — толчок мяча
  Game.prototype.kick = function () {
    this.ball.vx *= 1.7;
    this.ball.vy *= 1.7;
  };

  Game.prototype.update = function (dt, w, h, settings) {
    this.width = Math.max(w, 1);
    this.height = Math.max(h, 1);

    var b = this.ball;
    var speed = settings.speed;
    var unit = Math.min(this.width, this.height);

    b.r = Math.max(6, unit * 0.055);

    this.time += dt * (0.35 + speed * 0.65);
    this.frame += 1;
    this.wave = Math.sin(this.time * 1.7) * 0.6 + Math.sin(this.time * 0.53) * 0.4;

    // притяжение к курсору меняет направление, а не модуль скорости
    if (this.mouse.inside && settings.mouseForce > 0) {
      var dx = this.mouse.x - b.x;
      var dy = this.mouse.y - b.y;
      var dist = Math.hypot(dx, dy) || 1;
      var pull = settings.mouseForce * 2600 * dt * Math.min(1, 300 / dist);
      b.vx += (dx / dist) * pull;
      b.vy += (dy / dist) * pull;
    }

    // держим скорость около целевой
    var v = Math.hypot(b.vx, b.vy) || 1;
    var target = unit * (0.26 + 0.24 * speed);
    var blend = 1 + (target / v - 1) * Math.min(1, dt * 2.2);
    b.vx *= blend;
    b.vy *= blend;

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    var pad = unit * 0.02;
    if (b.x < b.r + pad) {
      b.x = b.r + pad;
      b.vx = Math.abs(b.vx);
    } else if (b.x > this.width - b.r - pad) {
      b.x = this.width - b.r - pad;
      b.vx = -Math.abs(b.vx);
    }
    if (b.y < b.r + pad) {
      b.y = b.r + pad;
      b.vy = Math.abs(b.vy);
    } else if (b.y > this.height - b.r - pad) {
      b.y = this.height - b.r - pad;
      b.vy = -Math.abs(b.vy);
    }

    this.energy = Math.max(0, Math.min(1, v / (unit * 0.7)));
  };

  // единственное место, где задаётся порядок float'ов для shaders/params.wgsl
  Game.prototype.writeParams = function (out, w, h, settings) {
    out[0] = w;
    out[1] = h;
    out[2] = this.mouse.x;
    out[3] = this.mouse.y;
    out[4] = this.ball.x;
    out[5] = this.ball.y;
    out[6] = this.ball.r;
    out[7] = this.time;
    out[8] = (settings.hue + this.time * 0.02) % 1;
    out[9] = settings.texMix;
    out[10] = this.wave;
    out[11] = this.frame;
    out[12] = this.ball.vx;
    out[13] = this.ball.vy;
    out[14] = w / Math.max(h, 1);
    out[15] = this.energy;
  };

  GE.Game = Game;
})(window.GE = window.GE || {});
