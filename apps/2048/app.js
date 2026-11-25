/* 2048 — Mini Apps. Без библиотек и без сборки. */
(function () {
  'use strict';

  var N = 4;                       // поле 4×4
  var BEST = 'miniapps.2048.best'; // личный рекорд (без входа)

  var board = [];                  // 16 чисел, 0 — пусто
  var score = 0, best = readBest();
  var prev = null;                 // одна отмена хода: {b, s}
  var over = false, won = false, busy = false;

  var gridEl, tilesEl, scoreEl, bestEl, ovEl, ovTitle, ovText, ovBtn, ovBtn2, undoBtn;

  function t(k, en) { return (window.UI && window.UI.t) ? window.UI.t(k, en) : en; }

  function readBest() {
    try { return parseInt(localStorage.getItem(BEST) || '0', 10) || 0; } catch (e) { return 0; }
  }
  function writeBest(v) { try { localStorage.setItem(BEST, String(v)); } catch (e) {} }

  /* ── поле ── */

  function fresh() {
    board = [];
    for (var i = 0; i < N * N; i++) board.push(0);
    score = 0; prev = null; over = false; won = false; busy = false;
    var a = addTile(), b = addTile();
    hideOverlay();
    render({ add: [a, b], merge: [] });
  }

  function freeSpots() {
    var out = [];
    for (var i = 0; i < board.length; i++) if (!board[i]) out.push(i);
    return out;
  }

  function addTile() {
    var free = freeSpots();
    if (!free.length) return -1;
    var at = free[Math.floor(Math.random() * free.length)];
    board[at] = Math.random() < 0.9 ? 2 : 4;
    return at;
  }

  // сжатие одной линии к началу + слияние пар
  function compact(vals) {
    var src = [], i;
    for (i = 0; i < vals.length; i++) if (vals[i]) src.push(vals[i]);
    var v = [], m = [];
    i = 0;
    while (i < src.length) {
      if (i + 1 < src.length && src[i] === src[i + 1]) { v.push(src[i] * 2); m.push(true); i += 2; }
      else { v.push(src[i]); m.push(false); i += 1; }
    }
    while (v.length < N) { v.push(0); m.push(false); }
    return { v: v, m: m };
  }

  function movesLeft() {
    var i, r, c;
    for (i = 0; i < board.length; i++) if (!board[i]) return true;
    for (r = 0; r < N; r++) {
      for (c = 0; c < N; c++) {
        var v = board[r * N + c];
        if (c + 1 < N && board[r * N + c + 1] === v) return true;
        if (r + 1 < N && board[(r + 1) * N + c] === v) return true;
      }
    }
    return false;
  }

  function run(dir) {
    if (busy || over) return;
    var before = board.slice(), scoreBefore = score;
    var add = [], merge = [], k, p, i, idxs, vals, res;

    for (k = 0; k < N; k++) {
      idxs = [];
      for (p = 0; p < N; p++) {
        if (dir === 'left') idxs.push(k * N + p);
        else if (dir === 'right') idxs.push(k * N + (N - 1 - p));
        else if (dir === 'up') idxs.push(p * N + k);
        else idxs.push((N - 1 - p) * N + k);
      }
      vals = [];
      for (i = 0; i < N; i++) vals.push(board[idxs[i]]);
      res = compact(vals);
      for (i = 0; i < N; i++) {
        board[idxs[i]] = res.v[i];
        if (res.m[i]) { merge.push(idxs[i]); score += res.v[i]; }
      }
    }

    var changed = false;
    for (i = 0; i < board.length; i++) if (board[i] !== before[i]) { changed = true; break; }
    if (!changed) { board = before; score = scoreBefore; return; }   // ход не изменил поле

    prev = { b: before, s: scoreBefore };
    var at = addTile();
    if (at >= 0) add.push(at);
    if (score > best) { best = score; writeBest(best); }

    render({ add: add, merge: merge });

    if (board.indexOf(2048) >= 0 && !won) { won = true; showWin(); return; }
    if (!movesLeft()) { over = true; showOver(); }
  }

  /* ── показ ── */

  function render(anim) {
    var i, v, d, txt;
    var w = tilesEl.clientWidth || 300;
    var cs = window.getComputedStyle(tilesEl);
    var gap = parseFloat(cs.columnGap || cs.gap) || 10;
    var cell = (w - gap * (N - 1)) / N;

    tilesEl.innerHTML = '';
    for (i = 0; i < board.length; i++) {
      v = board[i];
      if (!v) continue;
      d = document.createElement('div');
      d.className = 'tile v' + (v > 2048 ? 'sup' : v);
      if (anim && anim.add && anim.add.indexOf(i) >= 0) d.className += ' new';
      if (anim && anim.merge && anim.merge.indexOf(i) >= 0) d.className += ' merged';
      d.style.gridRow = String(Math.floor(i / N) + 1);
      d.style.gridColumn = String((i % N) + 1);
      txt = String(v);
      d.style.fontSize = Math.round(cell * (txt.length <= 2 ? 0.42 : txt.length === 3 ? 0.33 : 0.26)) + 'px';
      d.textContent = txt;
      tilesEl.appendChild(d);
    }
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    if (undoBtn) undoBtn.disabled = !prev;
  }

  function showWin() {
    ovTitle.textContent = t('g2048.win', 'You win!');
    ovText.textContent = t('g2048.winText', 'You reached 2048. Score: ') + score;
    ovBtn.textContent = t('g2048.cont', 'Continue');
    ovBtn2.textContent = t('g2048.new', 'New game');
    ovBtn2.hidden = false;
    ovEl.classList.remove('hidden');
  }

  function showOver() {
    ovTitle.textContent = t('g2048.over', 'Game over');
    ovText.textContent = t('g2048.overText', 'No moves left. Score: ') + score;
    ovBtn.textContent = t('g2048.new', 'New game');
    ovBtn2.textContent = t('g2048.undo', 'Undo');
    ovBtn2.hidden = !prev;
    ovEl.classList.remove('hidden');
  }

  function hideOverlay() { ovEl.classList.add('hidden'); }

  function undo() {
    if (!prev) return;
    board = prev.b.slice();
    score = prev.s;
    prev = null;
    over = false; busy = false;
    hideOverlay();
    render(null);
  }

  /* ── управление ── */

  var keys = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down',
    'ф': 'left', 'в': 'right', 'ц': 'up', 'ы': 'down'   // те же WASD в русской раскладке
  };

  function onKey(e) {
    var k = keys[e.key] || keys[String(e.key || '').toLowerCase()];
    if (k) { e.preventDefault(); run(k); return; }
    if (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я') { e.preventDefault(); undo(); return; }
    if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') { e.preventDefault(); fresh(); }
  }

  function onSwipe() {
    var x0 = 0, y0 = 0, on = false, stage = document.getElementById('stage');

    stage.addEventListener('pointerdown', function (e) {
      on = true; x0 = e.clientX; y0 = e.clientY;
      if (stage.setPointerCapture) { try { stage.setPointerCapture(e.pointerId); } catch (err) {} }
    });

    stage.addEventListener('pointerup', function (e) {
      if (!on) return;
      on = false;
      var dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) run(dx > 0 ? 'right' : 'left');
      else run(dy > 0 ? 'down' : 'up');
    });

    stage.addEventListener('pointercancel', function () { on = false; });
  }

  /* ── старт ── */

  function boot() {
    gridEl = document.getElementById('grid');
    tilesEl = document.getElementById('tiles');
    scoreEl = document.getElementById('score');
    bestEl = document.getElementById('best');
    ovEl = document.getElementById('ov');
    ovTitle = document.getElementById('ovTitle');
    ovText = document.getElementById('ovText');
    ovBtn = document.getElementById('ovBtn');
    ovBtn2 = document.getElementById('ovBtn2');
    undoBtn = document.getElementById('undo');

    var i, cell;
    for (i = 0; i < N * N; i++) {
      cell = document.createElement('div');
      cell.className = 'cell';
      gridEl.appendChild(cell);
    }

    document.getElementById('newGame').addEventListener('click', fresh);
    undoBtn.addEventListener('click', undo);
    ovBtn.addEventListener('click', function () {
      if (over) { fresh(); return; }
      hideOverlay();          // «Продолжить» после победы
    });
    ovBtn2.addEventListener('click', function () {
      if (prev && over) { undo(); return; }
      fresh();
    });

    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', function () { render(null); });

    if (window.UI) UI.onChange = function () { render(null); };

    onSwipe();
    fresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
