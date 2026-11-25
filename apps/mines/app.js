/* Minesweeper (Сапёр) — Mini Apps. Без библиотек и без сборки. */
(function () {
  'use strict';

  var LEVELS = {
    easy:   { n: 9,  m: 10 },
    normal: { n: 12, m: 20 },
    hard:   { n: 14, m: 35 }
  };

  var level = 'easy';
  var n = 0, mineCount = 0;
  var cells = [];          // {mine, open, flag, near}
  var buttons = [];        // кнопки поля
  var started = false, dead = false, done = false;
  var flags = 0;
  var t0 = 0, tick = null, elapsed = 0;

  var gridEl, leftEl, timeEl, ovEl, ovTitle, ovText, diffsEl;

  function t(k, en) { return (window.UI && window.UI.t) ? window.UI.t(k, en) : en; }

  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function idx(r, c) { return r * n + c; }

  function neighbours(i) {
    var r = Math.floor(i / n), c = i % n, out = [], dr, dc, rr, cc;
    for (dr = -1; dr <= 1; dr++) {
      for (dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        rr = r + dr; cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(idx(rr, cc));
      }
    }
    return out;
  }

  /* ── партия ── */

  function build() {
    var conf = LEVELS[level];
    n = conf.n; mineCount = conf.m;
    cells = [];
    buttons = [];
    for (var i = 0; i < n * n; i++) cells.push({ mine: false, open: false, flag: false, near: 0 });

    started = false; dead = false; done = false;
    flags = 0; elapsed = 0;
    clearInterval(tick); tick = null;

    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = 'repeat(' + n + ',1fr)';
    gridEl.style.gridTemplateRows = 'repeat(' + n + ',1fr)';

    for (i = 0; i < n * n; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'c';
      b.dataset.i = String(i);
      b.setAttribute('role', 'gridcell');
      b.setAttribute('aria-label', '');
      gridEl.appendChild(b);
      buttons.push(b);
    }

    leftEl.textContent = String(mineCount);
    timeEl.textContent = '0:00';
    hideOverlay();
    fit();
  }

  // мины ставим после первого щелчка — первая клетка и её соседи всегда пустые
  function placeMines(safe) {
    var safeSet = {};
    safeSet[safe] = true;
    var nb = neighbours(safe), i;
    for (i = 0; i < nb.length; i++) safeSet[nb[i]] = true;

    var free = [];
    for (i = 0; i < cells.length; i++) if (!safeSet[i]) free.push(i);

    // если клеток слишком мало — разрешаем и соседей
    if (free.length < mineCount) {
      free = [];
      for (i = 0; i < cells.length; i++) if (i !== safe) free.push(i);
    }

    for (i = 0; i < mineCount && free.length; i++) {
      var k = Math.floor(Math.random() * free.length);
      cells[free[k]].mine = true;
      free.splice(k, 1);
    }

    for (i = 0; i < cells.length; i++) {
      if (cells[i].mine) continue;
      var around = neighbours(i), cnt = 0;
      for (var j = 0; j < around.length; j++) if (cells[around[j]].mine) cnt++;
      cells[i].near = cnt;
    }
    started = true;
    startClock();
  }

  function paint(i) {
    var c = cells[i], b = buttons[i];
    var cls = 'c';
    if (c.open) cls += ' open' + (c.near ? ' n' + c.near : '');
    if (c.flag && !c.open) cls += ' flag';
    if (dead && c.mine && !c.flag) cls += ' mine';
    if (dead && c.flag && !c.mine) cls += ' wrong';
    b.className = cls;
    b.textContent = c.open ? (c.near ? String(c.near) : '') : (c.flag ? '🚩' : (dead && c.mine ? '💣' : ''));
  }

  function paintAll() { for (var i = 0; i < cells.length; i++) paint(i); }

  function openCell(i) {
    if (dead || done) return;
    var c = cells[i];
    if (c.open || c.flag) return;

    if (!started) placeMines(i);

    if (c.mine) { boom(); return; }

    // разлив от пустых клеток
    var stack = [i];
    while (stack.length) {
      var p = stack.pop();
      var cc = cells[p];
      if (cc.open || cc.flag) continue;
      if (cc.mine) continue;
      cc.open = true;
      paint(p);
      if (!cc.near) {
        var nb = neighbours(p);
        for (var k = 0; k < nb.length; k++) if (!cells[nb[k]].open) stack.push(nb[k]);
      }
    }
    checkWin();
  }

  function toggleFlag(i) {
    if (dead || done) return;
    var c = cells[i];
    if (c.open) return;
    c.flag = !c.flag;
    flags += c.flag ? 1 : -1;
    leftEl.textContent = String(Math.max(0, mineCount - flags));
    paint(i);
  }

  function checkWin() {
    var i;
    for (i = 0; i < cells.length; i++) if (!cells[i].mine && !cells[i].open) return;
    done = true;
    stopClock();
    // оставшиеся мины помечаем флажками
    for (i = 0; i < cells.length; i++) {
      if (cells[i].mine && !cells[i].flag) { cells[i].flag = true; flags++; }
    }
    leftEl.textContent = '0';
    paintAll();
    var key = 'miniapps.mines.best.' + level;
    var best = null;
    try { best = parseInt(localStorage.getItem(key) || '0', 10) || 0; } catch (e) { best = 0; }
    var isBest = !best || elapsed < best;
    if (isBest) { try { localStorage.setItem(key, String(elapsed)); } catch (e) {} }
    ovTitle.textContent = t('mines.win', 'You win!');
    ovText.innerHTML = t('mines.winText', 'Time: ') + fmt(elapsed) +
      (isBest ? '<br><b>' + t('mines.record', 'New record!') + '</b>'
              : (best ? '<br>' + t('mines.best', 'Best') + ': ' + fmt(best) : ''));
    ovEl.classList.remove('hidden');
  }

  function boom() {
    dead = true;
    stopClock();
    paintAll();
    ovTitle.textContent = t('mines.over', 'Boom!');
    ovText.textContent = t('mines.overText', 'A mine went off. Try again.');
    ovEl.classList.remove('hidden');
  }

  /* ── часы ── */

  function startClock() {
    t0 = Date.now();
    clearInterval(tick);
    tick = setInterval(function () {
      elapsed = Math.floor((Date.now() - t0) / 1000);
      timeEl.textContent = fmt(elapsed);
    }, 250);
  }

  function stopClock() {
    clearInterval(tick); tick = null;
    elapsed = Math.floor((Date.now() - t0) / 1000);
    timeEl.textContent = fmt(elapsed);
  }

  function hideOverlay() { ovEl.classList.add('hidden'); }

  function fit() {
    var w = gridEl.clientWidth || 320;
    var cell = w / n;
    gridEl.style.fontSize = Math.max(11, Math.round(cell * 0.48)) + 'px';
  }

  /* ── управление ── */

  function boot() {
    var pressTimer = null, pressAt = -1, suppressClick = false;

    gridEl = document.getElementById('grid');
    leftEl = document.getElementById('left');
    timeEl = document.getElementById('time');
    ovEl = document.getElementById('ov');
    ovTitle = document.getElementById('ovTitle');
    ovText = document.getElementById('ovText');
    diffsEl = document.getElementById('diffs');

    // щелчок — открыть
    gridEl.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.c') : null;
      if (!b) return;
      if (suppressClick) { suppressClick = false; return; }
      openCell(Number(b.dataset.i));
    });

    // правая кнопка — флажок
    gridEl.addEventListener('contextmenu', function (e) {
      var b = e.target.closest ? e.target.closest('.c') : null;
      if (!b) return;
      e.preventDefault();
      toggleFlag(Number(b.dataset.i));
    });

    // долгое нажатие на телефоне — тоже флажок
    gridEl.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      var b = e.target.closest ? e.target.closest('.c') : null;
      if (!b) return;
      pressAt = Number(b.dataset.i);
      clearTimeout(pressTimer);
      pressTimer = setTimeout(function () {
        pressTimer = null;
        suppressClick = true;
        toggleFlag(pressAt);
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) {} }
      }, 420);
    });

    function clearPress() { clearTimeout(pressTimer); pressTimer = null; }
    gridEl.addEventListener('pointerup', clearPress);
    gridEl.addEventListener('pointercancel', clearPress);
    gridEl.addEventListener('pointerleave', clearPress);

    diffsEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-level]') : null;
      if (!btn) return;
      level = btn.dataset.level;
      var all = diffsEl.querySelectorAll('button');
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('on', all[i] === btn);
      build();
    });

    document.getElementById('newGame').addEventListener('click', build);
    document.getElementById('ovBtn').addEventListener('click', build);

    window.addEventListener('resize', fit);
    if (window.UI) UI.onChange = function () { fit(); };

    build();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
