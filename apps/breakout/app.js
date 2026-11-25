/* Breakout (Арканоид) — Mini Apps. Без библиотек и без сборки. */
(function () {
  'use strict';

  var BEST = 'miniapps.breakout.best';
  var ROWS = 5, COLS = 8;

  var cv, ctx, W = 300, H = 380;
  var bricks = [];              // {col,row,alive}
  var alive = 0;
  var pad = { x: 0, w: 0, h: 8, y: 0 };
  var ball = { x: 0, y: 0, r: 6, vx: 0, vy: 0 };
  var score = 0, lives = 3, level = 1;
  var state = 'ready';          // ready | play | pause | over
  var best = readBest();
  var frame = 0, last = 0, raf = null;
  var holdLeft = false, holdRight = false;

  var scoreEl, bestEl, livesEl, levelEl, ovEl, ovTitle, ovText, ovBtn, launchEl;

  function t(k, en) { return (window.UI && window.UI.t) ? window.UI.t(k, en) : en; }

  function readBest() {
    try { return parseInt(localStorage.getItem(BEST) || '0', 10) || 0; } catch (e) { return 0; }
  }
  function writeBest(v) { try { localStorage.setItem(BEST, String(v)); } catch (e) {} }

  function css(name, fallback) {
    var v = window.getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  /* ── раскладка ── */

  function layout() {
    var rect = cv.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    W = Math.max(240, Math.round(rect.width));
    H = Math.round(rect.height || W * 1.35);

    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    pad.w = Math.round(W * 0.22);
    pad.h = Math.max(8, Math.round(H * 0.018));
    pad.y = H - pad.h - Math.round(H * 0.05);
    if (!pad.x) pad.x = W / 2;
    pad.x = clamp(pad.x, pad.w / 2, W - pad.w / 2);

    ball.r = Math.max(4.5, W * 0.017);
    if (state === 'ready') parkBall();
    else {
      ball.x = clamp(ball.x, ball.r, W - ball.r);
      ball.y = clamp(ball.y, ball.r, H - ball.r);
    }
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ── кирпичи ── */

  function brickRect(b) {
    var gap = Math.max(3, W * 0.012);
    var top = H * 0.10;
    var bh = Math.max(10, H * 0.042);
    var bw = (W - gap * (COLS + 1)) / COLS;
    return {
      x: gap + b.col * (bw + gap),
      y: top + b.row * (bh + gap),
      w: bw,
      h: bh
    };
  }

  function buildLevel() {
    bricks = [];
    alive = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        bricks.push({ col: c, row: r, alive: true });
        alive++;
      }
    }
  }

  function speed() {
    // скорость растёт с уровнем, но с потолком
    var base = H * 0.72;
    return Math.min(base * (1 + 0.12 * (level - 1)), H * 1.9);
  }

  function parkBall() {
    ball.x = pad.x;
    ball.y = pad.y - ball.r - 1;
    ball.vx = 0;
    ball.vy = 0;
  }

  function launch() {
    if (state !== 'ready') return;
    state = 'play';
    last = 0;
    var sp = speed();
    var ang = Math.random() * 0.7 - 0.35;          // вверх, отклонение ±20° от вертикали
    ball.vx = Math.sin(ang) * sp;
    ball.vy = -Math.cos(ang) * sp;
    launchEl.hidden = true;
    hideOverlay();
  }

  /* ── ход игры ── */

  function resetGame() {
    score = 0; lives = 3; level = 1;
    buildLevel();
    state = 'ready';
    pad.x = W / 2;
    parkBall();
    paintHud();
    launchEl.hidden = false;
    hideOverlay();
  }

  function nextLevel() {
    level++;
    buildLevel();
    state = 'ready';
    parkBall();
    paintHud();
    launchEl.hidden = false;
  }

  function loseLife() {
    lives--;
    paintHud();
    if (lives <= 0) { state = 'over'; gameOver(); return; }
    state = 'ready';
    parkBall();
    launchEl.hidden = false;
  }

  function gameOver() {
    if (score > best) { best = score; writeBest(best); paintHud(); }
    ovTitle.textContent = t('breakout.over', 'Game over');
    ovText.textContent = t('breakout.overText', 'Score: ') + score + ' · ' + t('breakout.best', 'Best') + ': ' + best;
    ovBtn.textContent = t('breakout.again', 'Once more');
    ovEl.classList.remove('hidden');
    launchEl.hidden = true;
  }

  function step(ts) {
    raf = requestAnimationFrame(step);
    frame++;

    if (state !== 'play') {
      draw();
      return;
    }

    if (!last) last = ts;
    var dt = Math.min(0.034, (ts - last) / 1000);
    last = ts;
    if (dt <= 0) { draw(); return; }

    // весло: клавиши и указатель
    if (holdLeft) pad.x -= W * 1.35 * dt;
    if (holdRight) pad.x += W * 1.35 * dt;
    pad.x = clamp(pad.x, pad.w / 2, W - pad.w / 2);

    moveBall(dt);
    draw();
  }

  function moveBall(dt) {
    var sp = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    var dist = sp * dt;
    var steps = Math.max(1, Math.ceil(dist / (ball.r * 1.3)));
    var sdt = dt / steps;

    for (var s = 0; s < steps; s++) {
      ball.x += ball.vx * sdt;
      ball.y += ball.vy * sdt;

      // стены
      if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); }
      if (ball.x + ball.r > W) { ball.x = W - ball.r; ball.vx = -Math.abs(ball.vx); }
      if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); }

      // низ — потеря мяча
      if (ball.y - ball.r > H) { loseLife(); return; }

      // весло
      if (ball.vy > 0 &&
          ball.y + ball.r >= pad.y &&
          ball.y - ball.r <= pad.y + pad.h &&
          ball.x >= pad.x - pad.w / 2 - ball.r &&
          ball.x <= pad.x + pad.w / 2 + ball.r) {
        ball.y = pad.y - ball.r;
        var off = clamp((ball.x - pad.x) / (pad.w / 2), -1, 1);
        var ang = off * (Math.PI / 3);
        var spd = Math.max(sp, speed());
        ball.vx = Math.sin(ang) * spd;
        ball.vy = -Math.cos(ang) * spd;
        if (Math.abs(ball.vy) < spd * 0.35) ball.vy = -spd * 0.35;
      }

      if (hitBricks()) {
        if (score > best) { best = score; writeBest(best); }
        paintHud();
        if (!alive) { nextLevel(); return; }
      }
    }
  }

  function hitBricks() {
    var i, r, dx, dy, ovx, ovy;
    for (i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      if (!b.alive) continue;
      r = brickRect(b);
      if (ball.x + ball.r < r.x || ball.x - ball.r > r.x + r.w) continue;
      if (ball.y + ball.r < r.y || ball.y - ball.r > r.y + r.h) continue;

      dx = ball.x - (r.x + r.w / 2);
      dy = ball.y - (r.y + r.h / 2);
      ovx = (r.w / 2 + ball.r) - Math.abs(dx);
      ovy = (r.h / 2 + ball.r) - Math.abs(dy);

      if (ovx < ovy) {
        ball.vx = -ball.vx;
        ball.x += dx > 0 ? ovx : -ovx;
      } else {
        ball.vy = -ball.vy;
        ball.y += dy > 0 ? ovy : -ovy;
      }

      b.alive = false;
      alive--;
      score += 10 * level;
      return true;
    }
    return false;
  }

  /* ── показ ── */

  function paintHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    levelEl.textContent = String(level);
    livesEl.textContent = lives > 0 ? new Array(lives + 1).join('♥') : '—';
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // рамка поля
    ctx.strokeStyle = css('--line', 'rgba(120,170,255,.18)');
    ctx.lineWidth = 1;
    roundRect(0.5, 0.5, W - 1, H - 1, 14);
    ctx.stroke();

    // кирпичи
    var colors = [css('--b1', '#57d1ff'), css('--b2', '#6fe3b0'), css('--b3', '#ffd166'),
                  css('--b4', '#ff9f7a'), css('--b5', '#c4a2ff')];
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      if (!b.alive) continue;
      var r = brickRect(b);
      ctx.fillStyle = colors[b.row % colors.length];
      ctx.globalAlpha = 0.92;
      roundRect(r.x, r.y, r.w, r.h, Math.min(5, r.h / 2));
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // весло
    ctx.fillStyle = css('--pad', '#e8eefc');
    roundRect(pad.x - pad.w / 2, pad.y, pad.w, pad.h, pad.h / 2);
    ctx.fill();

    // мяч
    ctx.fillStyle = css('--ball', '#ffffff');
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r * 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* ── управление ── */

  function hideOverlay() { ovEl.classList.add('hidden'); }

  function showPause() {
    state = 'pause';
    ovTitle.textContent = t('breakout.pause', 'Paused');
    ovText.textContent = t('breakout.pauseHint', 'Space — continue.');
    ovBtn.textContent = t('breakout.cont', 'Continue');
    ovEl.classList.remove('hidden');
  }

  function onKey(e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'ф' || k === 'Ф') { holdLeft = true; e.preventDefault(); return; }
    if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'в' || k === 'В') { holdRight = true; e.preventDefault(); return; }
    if (k === ' ' || k === 'Spacebar') {
      e.preventDefault();
      if (state === 'ready') launch();
      else if (state === 'play') showPause();
      else if (state === 'pause') { hideOverlay(); state = 'play'; last = 0; }
      return;
    }
    if (k === 'p' || k === 'P' || k === 'з' || k === 'З') {
      e.preventDefault();
      if (state === 'play') showPause();
      else if (state === 'pause') { hideOverlay(); state = 'play'; last = 0; }
    }
  }

  function boot() {
    cv = document.getElementById('c');
    ctx = cv.getContext('2d');
    scoreEl = document.getElementById('score');
    bestEl = document.getElementById('best');
    livesEl = document.getElementById('lives');
    levelEl = document.getElementById('level');
    ovEl = document.getElementById('ov');
    ovTitle = document.getElementById('ovTitle');
    ovText = document.getElementById('ovText');
    ovBtn = document.getElementById('ovBtn');
    launchEl = document.getElementById('launch');

    layout();
    resetGame();

    // указатель ведёт весло
    function pointTo(e) {
      var rect = cv.getBoundingClientRect();
      pad.x = clamp(e.clientX - rect.left, pad.w / 2, W - pad.w / 2);
      if (state === 'ready') parkBall();
    }

    cv.addEventListener('pointerdown', function (e) {
      pointTo(e);
      if (state === 'ready') launch();
    });
    cv.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'mouse' || e.buttons) pointTo(e);
    });
    cv.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

    ovBtn.addEventListener('click', function () {
      if (state === 'over') { resetGame(); launch(); return; }
      if (state === 'ready') { launch(); return; }
      hideOverlay();
      state = 'play';
      last = 0;
    });

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'ф' || k === 'Ф') holdLeft = false;
      if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'в' || k === 'В') holdRight = false;
    });
    window.addEventListener('blur', function () { if (state === 'play') showPause(); });
    window.addEventListener('resize', function () { layout(); draw(); });

    if (window.UI) UI.onChange = function () { draw(); };

    // стартовое окно: правила и кнопка «Играть»
    ovTitle.textContent = t('breakout.name', 'Breakout');
    ovText.textContent = t('breakout.startHint', 'Move the paddle, keep the ball in play and break every brick.');
    ovBtn.textContent = t('breakout.play', 'Play');
    ovEl.classList.remove('hidden');

    raf = requestAnimationFrame(step);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
