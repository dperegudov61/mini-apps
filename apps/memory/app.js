/* Memory (Память) — Mini Apps. Без библиотек и без сборки. */
(function () {
  'use strict';

  var SIZES = {
    easy:   { c: 4, r: 4 },
    normal: { c: 5, r: 4 },
    hard:   { c: 6, r: 6 }
  };

  // 24 картинки — хватает на самое большое поле (6×6 = 18 пар)
  var SETS = ['🍎', '🍌', '🍇', '🍓', '🍒', '🍑', '🥝', '🍍',
              '🥑', '🍋', '🍉', '🥕', '🌽', '🍄', '🌻', '🌵',
              '🐳', '🦊', '🐼', '🦉', '🐸', '🦋', '⭐', '🍩'];

  var size = 'easy';
  var first = null, second = null, lock = false;
  var moves = 0, found = 0, pairs = 0;
  var started = false, t0 = 0, tick = null, elapsed = 0;

  var boardEl, pairsEl, movesEl, timeEl, ovEl, ovText, bestHint, diffsEl;

  function t(k, en) { return (window.UI && window.UI.t) ? window.UI.t(k, en) : en; }

  function bestKey() { return 'miniapps.memory.best.' + size; }

  function readBest() {
    try { return JSON.parse(localStorage.getItem(bestKey()) || 'null'); } catch (e) { return null; }
  }

  function writeBest(v) {
    try { localStorage.setItem(bestKey(), JSON.stringify(v)); } catch (e) {}
  }

  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ── поле ── */

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function build() {
    var conf = SIZES[size];
    pairs = (conf.c * conf.r) / 2;
    var deck = [];
    for (var i = 0; i < pairs; i++) { deck.push(SETS[i % SETS.length]); deck.push(SETS[i % SETS.length]); }
    shuffle(deck);

    boardEl.innerHTML = '';
    boardEl.style.gridTemplateColumns = 'repeat(' + conf.c + ',1fr)';
    boardEl.className = 'board c' + conf.c;

    for (var k = 0; k < deck.length; k++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'card';
      b.dataset.e = deck[k];
      b.setAttribute('aria-label', t('memory.card', 'Card'));
      b.innerHTML = '<span class="in"><span class="face back"></span>' +
                    '<span class="face front">' + deck[k] + '</span></span>';
      boardEl.appendChild(b);
    }

    first = second = null; lock = false;
    moves = 0; found = 0; elapsed = 0; started = false;
    clearInterval(tick); tick = null;
    movesEl.textContent = '0';
    pairsEl.textContent = '0/' + pairs;
    timeEl.textContent = '0:00';

    hideOverlay();
    fitFonts();
    showBest();
  }

  function fitFonts() {
    var cards = boardEl.children;
    if (!cards.length) return;
    var w = cards[0].clientWidth || boardEl.clientWidth / SIZES[size].c;
    var fs = Math.max(14, Math.round(w * 0.48));
    for (var i = 0; i < cards.length; i++) {
      var front = cards[i].querySelector('.front');
      if (front) front.style.fontSize = fs + 'px';
    }
  }

  /* ── время ── */

  function startClock() {
    started = true;
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

  /* ── ходы ── */

  function flip(card) {
    if (lock || !card || card.classList.contains('open') || card.classList.contains('done')) return;

    card.classList.add('open');
    if (!started) startClock();

    if (!first) { first = card; return; }
    if (first === card) return;

    second = card;
    moves++;
    movesEl.textContent = String(moves);

    if (first.dataset.e === second.dataset.e) {
      first.classList.add('done');
      second.classList.add('done');
      first = second = null;
      found++;
      pairsEl.textContent = found + '/' + pairs;
      if (found === pairs) win();
      return;
    }

    // не совпали — закрыть через мгновение
    lock = true;
    var a = first, b = second;
    first = second = null;
    setTimeout(function () {
      a.classList.remove('open');
      b.classList.remove('open');
      lock = false;
    }, 650);
  }

  function win() {
    stopClock();
    var best = readBest();
    var better = !best || moves < best.moves || (moves === best.moves && elapsed < best.time);
    if (better) { best = { moves: moves, time: elapsed }; writeBest(best); }

    ovText.innerHTML = t('memory.result', 'Moves: ') + moves +
      ' · ' + t('memory.time', 'Time') + ' ' + fmt(elapsed) +
      (better ? '<br><b>' + t('memory.record', 'New record!') + '</b>' : '');
    ovEl.classList.remove('hidden');
    showBest();
  }

  function showBest() {
    var best = readBest();
    bestHint.textContent = best
      ? t('memory.best', 'Best') + ': ' + best.moves + ' ' + t('memory.mvShort', 'moves') + ' · ' + fmt(best.time)
      : '';
  }

  function hideOverlay() { ovEl.classList.add('hidden'); }

  /* ── старт ── */

  function boot() {
    boardEl = document.getElementById('board');
    pairsEl = document.getElementById('pairs');
    movesEl = document.getElementById('moves');
    timeEl = document.getElementById('time');
    ovEl = document.getElementById('ov');
    ovText = document.getElementById('ovText');
    bestHint = document.getElementById('bestHint');
    diffsEl = document.getElementById('diffs');

    boardEl.addEventListener('click', function (e) {
      var card = e.target.closest ? e.target.closest('.card') : null;
      if (card) flip(card);
    });

    diffsEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-size]') : null;
      if (!btn) return;
      size = btn.dataset.size;
      var all = diffsEl.querySelectorAll('button');
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('on', all[i] === btn);
      build();
    });

    document.getElementById('newGame').addEventListener('click', build);
    document.getElementById('ovBtn').addEventListener('click', build);

    window.addEventListener('resize', fitFonts);
    if (window.UI) UI.onChange = function () { fitFonts(); };

    build();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
