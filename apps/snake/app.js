/*
 * Змейка — Mini Apps
 * Без библиотек и без сборки. Ключ рекорда: miniapps.snake.best
 */
(function () {
  'use strict';

  /* ─────────── настройки ─────────── */
  var N         = 18;    // клеток по стороне
  var START_MS  = 165;   // длительность шага в начале, мс
  var MIN_MS    = 62;    // самый быстрый шаг
  var SPEEDUP   = 4;     // на сколько мс быстрее за каждое яблоко
  var BEST_KEY  = 'miniapps.snake.best';
  var SWIPE_MIN = 20;    // порог свайпа, px

  /* ─────────── разметка ─────────── */
  var canvas   = document.getElementById('c');
  var ctx      = canvas.getContext('2d');
  var stage    = document.getElementById('stage');
  var elScore  = document.getElementById('score');
  var elBest   = document.getElementById('best');
  var ov       = document.getElementById('ov');
  var ovTitle  = document.getElementById('ovTitle');
  var ovText   = document.getElementById('ovText');
  var btn      = document.getElementById('btn');
  var pad      = document.getElementById('pad');

  /* ─────────── состояние ─────────── */
  var dpr   = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  var cell  = 16;          // размер клетки, CSS px
  var state = 'idle';      // idle | playing | paused | over
  var snake, dir, queue, food;
  var score = 0, best = 0, stepMs = START_MS;
  var acc = 0, last = 0, anim = 0, dead = false;

  try { best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch (e) { best = 0; }
  elBest.textContent = String(best);

  /* ─────────── утилиты ─────────── */
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  function rand(n) { return Math.floor(Math.random() * n); }

  /* ─────────── размер поля ─────────── */
  function resize() {
    var w = stage.clientWidth || 320;
    var h = stage.clientHeight || w;
    var side = Math.max(160, Math.min(w, h));
    cell = side / N;
    canvas.width  = Math.round(side * dpr);
    canvas.height = Math.round(side * dpr);
    canvas.style.width  = '100%';
    canvas.style.height = '100%';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  /* ─────────── новая партия ─────────── */
  function reset() {
    var mid = Math.floor(N / 2);
    snake = [{ x: mid, y: mid }, { x: mid - 1, y: mid }, { x: mid - 2, y: mid }];
    dir   = { x: 1, y: 0 };
    queue = [];
    score = 0;
    stepMs = START_MS;
    acc = 0;
    last = 0;
    dead = false;
    elScore.textContent = '0';
    food = spawn();
  }

  function spawn() {
    var free = [], x, y, i, taken;
    for (y = 0; y < N; y++) {
      for (x = 0; x < N; x++) {
        taken = false;
        for (i = 0; i < snake.length; i++) {
          if (snake[i].x === x && snake[i].y === y) { taken = true; break; }
        }
        if (!taken) free.push({ x: x, y: y });
      }
    }
    if (!free.length) return null;
    return free[rand(free.length)];
  }

  /* ─────────── шаг игры ─────────── */
  function step() {
    // отбрасываем развороты «на 180°» в очереди
    while (queue.length && queue[0].x === -dir.x && queue[0].y === -dir.y) queue.shift();
    if (queue.length) dir = queue.shift();

    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // стены
    if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N) return gameOver();

    var eat = !!(food && head.x === food.x && head.y === food.y);

    // хвост сместится в этом же шаге, если не едим — его не считаем
    var upto = eat ? snake.length : snake.length - 1;
    for (var i = 0; i < upto; i++) {
      if (snake[i].x === head.x && snake[i].y === head.y) return gameOver();
    }

    snake.unshift(head);

    if (eat) {
      score += 1;
      elScore.textContent = String(score);
      if (score > best) {
        best = score;
        elBest.textContent = String(best);
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {}
      }
      stepMs = Math.max(MIN_MS, START_MS - score * SPEEDUP);
      food = spawn();
      if (!food) return win();
    } else {
      snake.pop();
    }
  }

  /* ─────────── состояния ─────────── */
  function start() {
    reset();
    state = 'playing';
    hideOverlay();
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      showOverlay('Пауза', 'Пробел — продолжить, R — заново.', 'Продолжить');
    } else if (state === 'paused') {
      state = 'playing';
      last = 0;
      acc = 0;
      hideOverlay();
    }
  }

  function gameOver() {
    state = 'over';
    dead = true;
    showOverlay('Игра окончена', 'Очки: ' + score + '. Рекорд: ' + best + '.', 'Ещё раз');
  }

  function win() {
    state = 'over';
    showOverlay('Победа!', 'Поле заполнено. Очки: ' + score + '.', 'Заново');
  }

  function showOverlay(title, text, buttonText) {
    ovTitle.textContent = title;
    ovText.innerHTML = text;
    btn.textContent = buttonText;
    ov.classList.remove('hidden');
  }

  function hideOverlay() {
    ov.classList.add('hidden');
  }

  /* ─────────── управление ─────────── */
  function setDir(x, y) {
    if (state === 'idle' || state === 'over') { start(); }
    if (state !== 'playing') {
      if (queue.length < 2) queue.push({ x: x, y: y });
      return;
    }
    var cur = queue.length ? queue[queue.length - 1] : dir;
    if (cur.x === x && cur.y === y) return;        // уже так идём
    if (cur.x === -x && cur.y === -y) return;      // разворот запрещён
    if (queue.length < 2) queue.push({ x: x, y: y });
  }

  var KEYS = {
    arrowleft: [-1, 0], a: [-1, 0], ф: [-1, 0],
    arrowright: [1, 0], d: [1, 0],  в: [1, 0],
    arrowup: [0, -1],   w: [0, -1], ц: [0, -1],
    arrowdown: [0, 1],  s: [0, 1],  ы: [0, 1]
  };

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var key = (e.key || '').toLowerCase();

    if (KEYS[key]) {
      e.preventDefault();
      setDir(KEYS[key][0], KEYS[key][1]);
      return;
    }
    if (key === ' ' || key === 'spacebar' || key === 'space') {
      e.preventDefault();
      if (state === 'idle' || state === 'over') start(); else togglePause();
      return;
    }
    if (key === 'enter') {
      e.preventDefault();
      if (state !== 'playing') start();
      return;
    }
    if (key === 'r' || key === 'к') {
      e.preventDefault();
      start();
    }
  });

  btn.addEventListener('click', function () {
    if (state === 'paused') togglePause(); else start();
  });

  // экранные стрелки
  pad.addEventListener('pointerdown', function (e) {
    var b = e.target.closest ? e.target.closest('[data-dir]') : null;
    if (!b) return;
    e.preventDefault();
    var d = b.getAttribute('data-dir');
    if (d === 'up')    setDir(0, -1);
    if (d === 'down')  setDir(0, 1);
    if (d === 'left')  setDir(-1, 0);
    if (d === 'right') setDir(1, 0);
  }, { passive: false });

  // свайпы
  var sx = 0, sy = 0, moved = false;
  stage.addEventListener('pointerdown', function (e) {
    sx = e.clientX; sy = e.clientY; moved = false;
  }, { passive: true });

  stage.addEventListener('pointerup', function (e) {
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) {
      if (state === 'idle' || state === 'over') start(); else togglePause();
      return;
    }
    moved = true;
    if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : -1, 0);
    else                             setDir(0, dy > 0 ? 1 : -1);
  }, { passive: true });

  stage.addEventListener('touchmove', function (e) {
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'playing') togglePause();
  });

  /* ─────────── рисование ─────────── */
  function draw() {
    var side = cell * N;
    if (!side) return;

    ctx.clearRect(0, 0, side, side);

    // фон поля
    var bg = ctx.createLinearGradient(0, 0, side, side);
    bg.addColorStop(0, '#111d33');
    bg.addColorStop(1, '#0a1120');
    roundRect(0, 0, side, side, Math.min(20, cell * 1.2));
    ctx.fillStyle = bg;
    ctx.fill();

    // сетка
    if (cell >= 12) {
      ctx.strokeStyle = 'rgba(120,170,255,.055)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var i = 1; i < N; i++) {
        var p = Math.round(i * cell) + 0.5;
        ctx.moveTo(p, 0);      ctx.lineTo(p, side);
        ctx.moveTo(0, p);      ctx.lineTo(side, p);
      }
      ctx.stroke();
    }

    // рамка поля
    ctx.strokeStyle = 'rgba(120,170,255,.14)';
    ctx.lineWidth = 2;
    roundRect(1, 1, side - 2, side - 2, Math.min(20, cell * 1.2));
    ctx.stroke();

    // яблоко
    if (food) {
      var pulse = 0.5 + 0.5 * Math.sin(anim / 280);
      var cx = food.x * cell + cell / 2;
      var cy = food.y * cell + cell / 2;
      var r  = cell * (0.31 + 0.04 * pulse);

      ctx.save();
      ctx.shadowColor = 'rgba(255,80,90,.75)';
      ctx.shadowBlur = cell * 0.9;
      var fg = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r);
      fg.addColorStop(0, '#ff8f8f');
      fg.addColorStop(0.55, '#ef3b47');
      fg.addColorStop(1, '#b3131f');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // блик и листик
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.3, cy - r * 0.35, r * 0.22, r * 0.15, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2fbf62';
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.18, cy - r * 0.92, r * 0.3, r * 0.14, -0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    // змейка: от хвоста к голове, голова сверху
    var pad = cell * 0.09;
    for (var k = snake.length - 1; k >= 0; k--) {
      var s = snake[k];
      var t = snake.length > 1 ? k / (snake.length - 1) : 0;
      var x = s.x * cell + pad;
      var y = s.y * cell + pad;
      var sz = cell - pad * 2;

      if (dead) {
        ctx.fillStyle = 'hsl(' + Math.round(348 - 12 * t) + ',58%,' + Math.round(46 - 10 * t) + '%)';
      } else {
        var hue = Math.round(152 - 26 * t);
        var light = k === 0 ? 60 : 44 + 2 * (1 - t);
        ctx.fillStyle = 'hsl(' + hue + ',72%,' + Math.round(light) + '%)';
      }

      if (k === 0 && !dead) {
        ctx.save();
        ctx.shadowColor = 'rgba(55,214,122,.55)';
        ctx.shadowBlur = cell * 0.8;
        roundRect(x, y, sz, sz, cell * 0.3);
        ctx.fill();
        ctx.restore();
      } else {
        roundRect(x, y, sz, sz, cell * (k === 0 ? 0.3 : 0.26));
        ctx.fill();
      }

      // глаза смотрят туда, куда идёт голова
      if (k === 0) {
        var ex = cell * 0.19, ey = cell * 0.19;
        var ox = dir.x * cell * 0.10, oy = dir.y * cell * 0.10;
        var hx = x + sz / 2 + ox;
        var hy = y + sz / 2 + oy;
        var px = dir.y !== 0 ? ex : 0;
        var py = dir.x !== 0 ? ey : 0;

        ctx.fillStyle = '#f4fbff';
        ctx.beginPath();
        ctx.arc(hx - (dir.x !== 0 ? 0 : px), hy - (dir.y !== 0 ? 0 : py), cell * 0.125, 0, Math.PI * 2);
        ctx.arc(hx + (dir.x !== 0 ? 0 : px), hy + (dir.y !== 0 ? 0 : py), cell * 0.125, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#08131f';
        ctx.beginPath();
        ctx.arc(hx - (dir.x !== 0 ? 0 : px) + dir.x * cell * 0.03, hy - (dir.y !== 0 ? 0 : py) + dir.y * cell * 0.03, cell * 0.06, 0, Math.PI * 2);
        ctx.arc(hx + (dir.x !== 0 ? 0 : px) + dir.x * cell * 0.03, hy + (dir.y !== 0 ? 0 : py) + dir.y * cell * 0.03, cell * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /* ─────────── главный цикл ─────────── */
  function loop(t) {
    requestAnimationFrame(loop);
    anim = t;

    if (state === 'playing') {
      if (!last) last = t;
      var dt = Math.min(250, t - last);
      last = t;
      acc += dt;
      var guard = 0;
      while (acc >= stepMs && state === 'playing' && guard++ < 6) {
        acc -= stepMs;
        step();
      }
      if (state !== 'playing') acc = 0;
    } else {
      last = t;
    }

    draw();
  }

  /* ─────────── старт ─────────── */
  reset();
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });
  showOverlay('Змейка', 'Стрелки или WASD — движение.<br>Пробел — пауза, R — заново.', 'Играть');
  requestAnimationFrame(loop);
})();
