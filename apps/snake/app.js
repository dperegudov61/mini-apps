/*
 * Змейка — Mini Apps
 *
 * Сложность меняет скорость и цену яблока (×1 / ×2 / ×3).
 * Личный рекорд хранится всегда — в localStorage под ключом miniapps.snake.best.<сложность>.
 * Таблица рекордов и места — только для вошедших в аккаунт: сервер отдаёт их
 * по адресу /mini-apps/snake/records (там же лежат и сами рекорды, в папке человека).
 */
(function () {
  'use strict';

  /* ─────────── настройки ─────────── */
  var N = 18;              // клеток по стороне
  var SPEEDUP = 4;         // на сколько мс быстрее за каждое яблоко
  var SWIPE_MIN = 20;      // порог свайпа, px
  var BEST_KEY = 'miniapps.snake.best';   // .easy / .normal / .hard
  var OLD_BEST = 'miniapps.snake.best';   // старый общий рекорд — считаем как «Обычно»
  var DIFF_KEY = 'miniapps.snake.diff';
  var SHOW = 20;           // сколько строк таблицы показывать

  var DIFFS = {
    easy:   { name: t("snake.easy", "Easy"),  mult: 1, start: 200, min: 95 },
    normal: { name: t("snake.normal", "Normal"), mult: 2, start: 165, min: 70 },
    hard:   { name: t("snake.hard", "Hard"), mult: 3, start: 130, min: 55 }
  };
  var ORDER = ['easy', 'normal', 'hard'];

  /* ─────────── разметка ─────────── */
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('c');
  var ctx = canvas.getContext('2d');
  var stage = $('stage');
  var elScore = $('score');
  var ov = $('ov'), ovTitle = $('ovTitle'), ovText = $('ovText'), btn = $('btn');
  var pad = $('pad'), diffs = $('diffs');
  var recMine = $('recMine'), recMineVal = $('recMineVal'), recMinePos = $('recMinePos');
  var recGlob = $('recGlob'), recGlobVal = $('recGlobVal'), recGlobName = $('recGlobName');
  var hintAuth = $('hintAuth');
  var board = $('board'), boardRows = $('boardRows'), boardNote = $('boardNote');
  var boardDiff = $('boardDiff'), boardClose = $('boardClose');

  /* ─────────── состояние игры ─────────── */
  var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  var cell = 16;
  var diff = 'normal';
  var bests = { easy: 0, normal: 0, hard: 0 };
  var state = 'idle';      // idle | playing | paused | over
  var snake, dir, queue, food;
  var score = 0, apples = 0, stepMs = 165;
  var acc = 0, last = 0, anim = 0, dead = false;

  /* ─────────── состояние сервера ─────────── */
  var srv = { url: '', token: '', authed: false, myId: '', myName: '', place: 0, players: 0, top: [], best: 0 };

  /* ─────────── мелочи ─────────── */
  function ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lss(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
  function lsi(k, def) {
    try { var v = parseInt(localStorage.getItem(k) || '', 10); return isFinite(v) ? v : def; }
    catch (e) { return def; }
  }
  function fmt(n) { return String(n == null ? 0 : n); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function placeClass(p) { return p === 1 ? 'p1' : p === 2 ? 'p2' : p === 3 ? 'p3' : 'pn'; }
  function rand(n) { return Math.floor(Math.random() * n); }

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

  /* ─────────── личные рекорды ─────────── */
  function loadBests() {
    var i, d;
    for (i = 0; i < ORDER.length; i++) {
      d = ORDER[i];
      bests[d] = Math.max(0, lsi(BEST_KEY + '.' + d, 0));
    }
    // рекорд, набранный до появления сложностей, считаем как «Обычно»
    var old = Math.max(0, lsi(OLD_BEST, 0));
    if (old > bests.normal) { bests.normal = old; lss(BEST_KEY + '.normal', old); }
  }
  function setBest(d, v) {
    if (v <= bests[d]) return false;
    bests[d] = v;
    lss(BEST_KEY + '.' + d, v);
    return true;
  }

  /* ─────────── сеть ─────────── */
  function timeout(ms) {
    var ctl = new AbortController();
    var t = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, ms);
    return { signal: ctl.signal, done: function () { clearTimeout(t); } };
  }

  function fetchJSON(url, opt, ms) {
    var tm = timeout(ms || 8000);
    var o = opt || {};
    o.signal = tm.signal;
    if (o.cache === undefined) o.cache = 'no-store';
    return fetch(url, o).then(function (r) {
      tm.done();
      return r.text().then(function (txt) {
        var j = {};
        try { j = JSON.parse(txt || '{}'); } catch (e) {}
        return { status: r.status, ok: r.ok, json: j };
      });
    }).catch(function () { tm.done(); return { status: 0, ok: false, json: {} }; });
  }

  var REPO = 'dperegudov61/dperegudov61.github.io';
  var STATUS_API = 'https://api.github.com/repos/' + REPO + '/contents/status.json';
  var STATUS_RAW = 'https://raw.githubusercontent.com/' + REPO + '/main/status.json';
  var STATUS_LOCAL = (location.protocol === 'http:' || location.protocol === 'https:')
    ? location.origin + '/status.json' : '';

  function b64ToText(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var n = bin.length, bytes = new Uint8Array(n), i;
    for (i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    if (window.TextDecoder) return new TextDecoder('utf-8').decode(bytes);
    var s = '';
    for (i = 0; i < n; i++) s += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(s));
  }
  function statusFrom(r) {
    if (!r || !r.ok) return null;
    var j = r.json || {};
    if (typeof j.content === 'string' && j.encoding === 'base64') {
      try { j = JSON.parse(b64ToText(j.content)); } catch (e) { return null; }
    }
    return (j && (typeof j.url === 'string' || j.connections)) ? j : null;
  }
  function connsOf(j) {
    var out = [], arr = j && j.connections, i;
    if (Object.prototype.toString.call(arr) === '[object Array]') {
      for (i = 0; i < arr.length; i++) {
        var c = arr[i] || {};
        if (typeof c.url !== 'string' || !c.url) continue;
        out.push({ url: c.url.replace(/\/+$/, ''), updated: Date.parse(c.created || '') || 0 });
      }
    }
    if (!out.length && j && typeof j.url === 'string' && j.url)
      out.push({ url: j.url.replace(/\/+$/, ''), updated: Date.parse(j.updated || '') || 0 });
    return out;
  }
  function statusList() {
    var bust = '?v=' + Date.now();
    var reqs = [fetchJSON(STATUS_API, { headers: { Accept: 'application/vnd.github+json' } }, 8000)];
    if (STATUS_LOCAL) reqs.push(fetchJSON(STATUS_LOCAL + bust, null, 6000));
    reqs.push(fetchJSON(STATUS_RAW + bust, null, 8000));
    return Promise.all(reqs).then(function (res) {
      var seen = {}, out = [], i, k;
      for (i = 0; i < res.length; i++) {
        var list = connsOf(statusFrom(res[i]));
        for (k = 0; k < list.length; k++) {
          var u = list[k].url;
          if (seen[u]) { if (list[k].updated > seen[u].updated) seen[u].updated = list[k].updated; continue; }
          seen[u] = list[k];
        }
      }
      for (var key in seen) if (Object.prototype.hasOwnProperty.call(seen, key)) out.push(seen[key]);
      var mem = ls('door.url');
      if (mem && !seen[mem]) out.push({ url: mem, updated: 0 });
      out.sort(function (a, b) { return b.updated - a.updated; });
      var urls = [], j;
      for (j = 0; j < out.length; j++) urls.push(out[j].url);
      return urls;
    });
  }
  function ping(base) {
    if (!base) return Promise.resolve(false);
    return fetchJSON(base + '/__door/hi', null, 6000).then(function (r) {
      return !!(r.ok && r.json && r.json.ok === true);
    });
  }
  function firstLive(urls) {
    return new Promise(function (resolve) {
      if (!urls.length) { resolve(''); return; }
      var left = urls.length, done = false;
      urls.forEach(function (u) {
        ping(u).then(function (alive) {
          left--;
          if (alive && !done) { done = true; resolve(u); }
          else if (left === 0 && !done) { done = true; resolve(''); }
        });
      });
    });
  }
  // адрес живого сервера: помним последний, иначе смотрим список мостов
  function findServer() {
    var mem = ls('door.url');
    var fast = mem ? ping(mem).then(function (ok) { return ok ? mem : ''; }) : Promise.resolve('');
    return fast.then(function (u) {
      if (u) return u;
      return statusList().then(function (list) { return firstLive(list); });
    });
  }

  function api(path, body) {
    var opt = { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + srv.token } };
    if (body) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    return fetchJSON(srv.url + path, opt, 10000).then(function (r) {
      if (r.status === 401) { var e = new Error(t("snake.need.login", "Sign in needed")); e.noauth = true; throw e; }
      if (!r.ok || !r.json || r.json.ok !== true) throw new Error(t('snake.server', 'server:') + ' ' + r.status);
      return r.json;
    });
  }

  function offlineMode() {
    srv.authed = false;
    srv.top = [];
    srv.place = 0;
    srv.players = 0;
    srv.best = 0;
    renderRecs();
    if (!board.hidden) renderBoard();
  }

  function applyRecords(j) {
    // ответ мог прийти уже после смены сложности — тогда он не наш
    if (j && j.difficulty && j.difficulty !== diff) return;
    srv.authed = true;
    srv.myId = (j.me && j.me.id) || '';
    srv.myName = (j.me && j.me.name) || '';
    srv.place = (j.me && j.me.place) || 0;
    srv.players = j.players || 0;
    srv.top = j.top || [];
    srv.best = (j.me && j.me.score) || 0;
    if (srv.best > bests[diff]) setBest(diff, srv.best);   // рекорд с другого устройства
    renderRecs();
    if (!board.hidden) renderBoard();
  }

  function loadRecords() {
    srv.token = srv.token || ls('door.token');
    if (!srv.token || !window.fetch) { offlineMode(); return Promise.resolve(); }

    var step = srv.url
      ? ping(srv.url).then(function (ok) { return ok ? srv.url : ''; })
      : Promise.resolve('');

    return step.then(function (u) {
      if (u) return u;
      return findServer();
    }).then(function (u) {
      if (!u) throw new Error(t("snake.no.server", "server not found"));
      srv.url = u;
      lss('door.url', u);
      return api('/mini-apps/snake/records?difficulty=' + diff);
    }).then(applyRecords).catch(function () {
      // нет сети, нет сервера или не вошёл — остаётся старый интерфейс: только личный рекорд
      offlineMode();
    });
  }

  function submit(score) {
    if (!srv.authed) return Promise.resolve();
    if (score <= srv.best) return Promise.resolve();
    return api('/mini-apps/snake/records', { difficulty: diff, score: score })
      .then(applyRecords)
      .catch(function (e) { if (e && e.noauth) offlineMode(); });
  }

  /* ─────────── значки рекордов ─────────── */
  function renderRecs() {
    recMineVal.textContent = fmt(bests[diff]);
    if (srv.authed && srv.place > 0) {
      recMinePos.textContent = t('snake.place', 'place') + ' ' + srv.place;
      recMinePos.className = 'pos ' + placeClass(srv.place);
    } else {
      recMinePos.textContent = '';
      recMinePos.className = 'pos pn';
    }
    if (srv.authed && srv.top.length) {
      recGlobVal.textContent = fmt(srv.top[0].score);
      recGlobName.textContent = srv.top[0].name;
      recGlob.hidden = false;
      recGlob.title = t('snake.global.rec', 'Overall record:') + ' ' + srv.top[0].name + ' — ' + srv.top[0].score + t("snake.open.board", ". Open the table");
    } else {
      recGlob.hidden = true;
    }
    hintAuth.hidden = !srv.authed;
  }

  function renderBoard() {
    boardDiff.textContent = DIFFS[diff].name;
    var rows = srv.top || [], html = [], i, e, cls, mine = false;
    for (i = 0; i < rows.length; i++) {
      e = rows[i];
      if (srv.myId && e.id === srv.myId) mine = true;
      cls = (srv.myId && e.id === srv.myId) ? ' class="me"' : '';
      html.push('<tr' + cls + '>' +
        '<td class="' + placeClass(e.place) + '">' + esc(e.place) + '</td>' +
        '<td>' + esc(e.name) + '</td>' +
        '<td class="id">' + esc(e.id) + '</td>' +
        '<td class="sc">' + esc(fmt(e.score)) + '</td></tr>');
    }
    boardRows.innerHTML = html.length
      ? html.join('')
      : '<tr><td colspan="4" class="empty">Пока никто не играл на этой сложности — будь первым.</td></tr>';

    if (srv.place > 0 && !mine) {
      boardNote.textContent = t('snake.your.place', 'Your place:') + ' ' + srv.place + t('snake.of', ' of ') + srv.players + ' ' + t('snake.rec.bit', '· record') + ' ' + fmt(bests[diff]);
    } else if (srv.players > 0) {
      boardNote.textContent = t('snake.players', 'Players:') + ' ' + srv.players + t('snake.rows2', ' · total rows: ') + ' ' + Math.min(SHOW, rows.length);
    } else {
      boardNote.textContent = '';
    }
  }

  function openBoard() {
    if (!srv.authed) return;
    if (state === 'playing') togglePause();
    renderBoard();
    board.hidden = false;
    document.body.style.overflow = 'hidden';
    boardClose.focus();
    loadRecords();
  }
  function closeBoard() {
    board.hidden = true;
    document.body.style.overflow = '';
  }

  /* ─────────── сложность ─────────── */
  function markDiffs() {
    var btns = diffs.querySelectorAll('button[data-diff]');
    for (var i = 0; i < btns.length; i++)
      btns[i].className = btns[i].getAttribute('data-diff') === diff ? 'on' : '';
  }

  function setDiff(id) {
    if (!DIFFS[id] || id === diff) return;
    var wasPlaying = (state === 'playing' || state === 'paused');
    diff = id;
    lss(DIFF_KEY, id);
    markDiffs();
    srv.top = [];
    srv.place = 0;
    srv.players = 0;
    srv.best = 0;
    reset();
    if (wasPlaying) { state = 'playing'; hideOverlay(); }
    else { state = 'idle'; showOverlay(t("snake.name", "Snake"), intro(), t("snake.play", "Play")); }
    renderRecs();
    loadRecords();
  }

  function intro() {
    return t("snake.apple", "Apple: ×") + DIFFS[diff].mult + ' (' + DIFFS[diff].name + ').<br>' +
           t("snake.hint2", "Arrows or WASD to move, space — pause.");
  }

  /* ─────────── размер поля ─────────── */
  function resize() {
    var w = stage.clientWidth || 320;
    var h = stage.clientHeight || w;
    var side = Math.max(160, Math.min(w, h));
    cell = side / N;
    canvas.width = Math.round(side * dpr);
    canvas.height = Math.round(side * dpr);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  /* ─────────── партия ─────────── */
  function reset() {
    var mid = Math.floor(N / 2);
    snake = [{ x: mid, y: mid }, { x: mid - 1, y: mid }, { x: mid - 2, y: mid }];
    dir = { x: 1, y: 0 };
    queue = [];
    score = 0;
    apples = 0;
    stepMs = DIFFS[diff].start;
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

  function step() {
    while (queue.length && queue[0].x === -dir.x && queue[0].y === -dir.y) queue.shift();
    if (queue.length) dir = queue.shift();

    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N) return gameOver();

    var eat = !!(food && head.x === food.x && head.y === food.y);
    var upto = eat ? snake.length : snake.length - 1;
    for (var i = 0; i < upto; i++) {
      if (snake[i].x === head.x && snake[i].y === head.y) return gameOver();
    }

    snake.unshift(head);

    if (eat) {
      var d = DIFFS[diff];
      apples += 1;
      score += d.mult;
      elScore.textContent = String(score);
      if (setBest(diff, score)) renderRecs();
      stepMs = Math.max(d.min, d.start - apples * SPEEDUP);
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
      showOverlay(t("snake.pause", "Paused"), t("snake.pause.hint", "Space — continue, R — restart."), t("snake.resume", "Continue"));
    } else if (state === 'paused') {
      state = 'playing';
      last = 0;
      acc = 0;
      hideOverlay();
    }
  }

  function overText() {
    var s = t('snake.score.pfx', 'Score:') + ' ' + fmt(score) + t('snake.rec.bit2', ' · record: ') + ' ' + fmt(bests[diff]) + '.';
    if (srv.authed) {
      if (srv.place > 0) s += t('snake.br.place', '<br>Place:') + ' ' + srv.place + t('snake.of', ' of ') + srv.players + '.';
      else s += t("snake.br.notop", "<br>The record did not make the table.");
    }
    return s;
  }

  function gameOver() {
    state = 'over';
    dead = true;
    var isNew = score > bests[diff];
    setBest(diff, score);
    renderRecs();
    showOverlay(isNew && score > 0 ? t("snake.new.rec", "New record!") : t("snake.over", "Game over"), overText(), t("snake.again", "Once more"));
    submit(score).then(function () { if (state === 'over') ovText.innerHTML = overText(); });
  }

  function win() {
    state = 'over';
    setBest(diff, score);
    renderRecs();
    showOverlay(t("snake.win", "Victory!"), t('snake.field.full', 'Field filled. Score:') + ' ' + fmt(score) + '.', t("snake.restart", "Restart"));
    submit(score);
  }

  function showOverlay(title, text, buttonText) {
    ovTitle.textContent = title;
    ovText.innerHTML = text;
    btn.textContent = buttonText;
    ov.classList.remove('hidden');
  }
  function hideOverlay() { ov.classList.add('hidden'); }

  /* ─────────── управление ─────────── */
  function setDir(x, y) {
    if (state === 'idle' || state === 'over') start();
    if (state !== 'playing') {
      if (queue.length < 2) queue.push({ x: x, y: y });
      return;
    }
    var cur = queue.length ? queue[queue.length - 1] : dir;
    if (cur.x === x && cur.y === y) return;
    if (cur.x === -x && cur.y === -y) return;
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

    if (!board.hidden) {
      if (key === 'escape') { e.preventDefault(); closeBoard(); }
      return;
    }
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
    if (key === 'r' || key === t('snake.to', 'to')) {
      e.preventDefault();
      start();
    }
  });

  btn.addEventListener('click', function () {
    if (state === 'paused') togglePause(); else start();
  });

  diffs.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-diff]') : null;
    if (!b) return;
    setDiff(b.getAttribute('data-diff'));
  });

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

  var sx = 0, sy = 0;
  stage.addEventListener('pointerdown', function (e) {
    sx = e.clientX; sy = e.clientY;
  }, { passive: true });

  stage.addEventListener('pointerup', function (e) {
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) {
      if (state === 'idle' || state === 'over') start(); else togglePause();
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : -1, 0);
    else                             setDir(0, dy > 0 ? 1 : -1);
  }, { passive: true });

  stage.addEventListener('touchmove', function (e) {
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'playing') togglePause();
  });

  recGlob.addEventListener('click', openBoard);
  boardClose.addEventListener('click', closeBoard);
  board.addEventListener('click', function (e) { if (e.target === board) closeBoard(); });

  /* ─────────── рисование ─────────── */
  // цвета поля берём из переменных страницы: тема переключается — поле перекрашивается
  var pal = null;
  function palette() {
    var th = document.documentElement.getAttribute('data-theme') || 'dark';
    if (pal && pal.th === th) return pal;
    var st = window.getComputedStyle ? getComputedStyle(document.documentElement) : null;
    function v(n, d) { var s = st ? st.getPropertyValue(n).trim() : ''; return s || d; }
    pal = { th: th,
      bg0: v('--board0', '#16233c'), bg1: v('--board1', '#0b1322'),
      grid: v('--grid', 'rgba(120,170,255,.075)'), grid2: v('--grid2', 'rgba(120,170,255,.14)') };
    return pal;
  }

  function draw() {
    var side = cell * N;
    if (!side) return;

    ctx.clearRect(0, 0, side, side);

    var pl = palette();
    var bg = ctx.createLinearGradient(0, 0, side, side);
    bg.addColorStop(0, pl.bg0);
    bg.addColorStop(1, pl.bg1);
    roundRect(0, 0, side, side, Math.min(20, cell * 1.2));
    ctx.fillStyle = bg;
    ctx.fill();

    if (cell >= 12) {
      ctx.strokeStyle = pl.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var i = 1; i < N; i++) {
        var p = Math.round(i * cell) + 0.5;
        ctx.moveTo(p, 0); ctx.lineTo(p, side);
        ctx.moveTo(0, p); ctx.lineTo(side, p);
      }
      ctx.stroke();
    }

    // рамка поля
    ctx.strokeStyle = pl.grid2;
    ctx.lineWidth = 2;
    roundRect(1, 1, side - 2, side - 2, Math.min(20, cell * 1.2));
    ctx.stroke();

    if (food) {
      var pulse = 0.5 + 0.5 * Math.sin(anim / 280);
      var cx = food.x * cell + cell / 2;
      var cy = food.y * cell + cell / 2;
      var r = cell * (0.31 + 0.04 * pulse);

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

      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.3, cy - r * 0.35, r * 0.22, r * 0.15, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2fbf62';
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.18, cy - r * 0.92, r * 0.3, r * 0.14, -0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    var pad2 = cell * 0.09;
    for (var k = snake.length - 1; k >= 0; k--) {
      var s = snake[k];
      var t = snake.length > 1 ? k / (snake.length - 1) : 0;
      var x = s.x * cell + pad2;
      var y = s.y * cell + pad2;
      var sz = cell - pad2 * 2;

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

  // тема поменялась — поле перерисовать
  if (window.UI) UI.onChange = function () { pal = null; try { draw(); } catch (e) {} };

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
  loadBests();
  var saved = ls(DIFF_KEY);
  diff = DIFFS[saved] ? saved : 'normal';
  markDiffs();

  reset();
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });
  showOverlay(t("snake.name", "Snake"), intro(), t("snake.play", "Play"));
  renderRecs();
  loadRecords();
  requestAnimationFrame(loop);
})();
