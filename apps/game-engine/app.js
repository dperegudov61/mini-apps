/* app.js — точка входа мини-приложения «game engine».
   Здесь только запуск, переключение сцен и цикл кадров: GPU → рендерер → сцена → камера.
   Сами сцены — в js/scene/, настройки рендера — в js/ui/panels.js. */
(function (GE) {
  'use strict';

  var canvas = document.getElementById('gpu-canvas');
  var hud = new GE.HUD();
  var panels = new GE.Panels();

  var renderer = null;
  var camera = null;
  var perf = null;
  var gfx = null;            // настройки рендера, общие для всех сцен
  var active = null;         // { def, settings, inst } — открытая сцена
  var paused = false;
  var frames = 0;
  var uiAt = 0;              // когда последний раз обновляли строку состояния и отладку

  var SCALE_MIN = 0.01;      // предел авто-масштаба: кадр в единицы пикселей
  var SCALE_MAX = 4;         // верхний предел: 4× — проверка за старое слабое устройство

  // какие старые ползунки переехали в сцену-стенд при миграции
  var LEGACY_SCENE_KEYS = ['sunHeight', 'speed', 'exposure', 'stars', 'grid'];

  function clampScale(v) {
    return Math.min(SCALE_MAX, Math.max(SCALE_MIN, isFinite(v) ? v : 1));
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  // ---- старые настройки одной кучей → две рамки: сцена отдельно, рендер отдельно ----
  function migrate() {
    var raw = GE.Store.raw('settings');
    if (!raw) return;

    var old = null;
    try { old = JSON.parse(raw); } catch (e) { return; }
    if (!old || typeof old !== 'object') return;

    if (!GE.Store.raw('gfx')) {
      var g = panels.readGfx();
      if (isNum(old.scale)) g.scale = clampScale(old.scale);
      if (isNum(old.auto)) g.auto = old.auto > 0.5 ? 1 : 0;
      if (isNum(old.shadows)) g.shadows = old.shadows > 0.5 ? 1 : 0;
      panels.saveGfx(g);
    }

    var demo = GE.Scenes.get('demo');
    if (demo && !GE.Store.raw('scene.demo')) {
      var s = GE.Scenes.defaults(demo);
      for (var i = 0; i < LEGACY_SCENE_KEYS.length; i++) {
        var k = LEGACY_SCENE_KEYS[i];
        if (isNum(old[k]) && (k in s)) s[k] = old[k];
      }
      panels.saveScene(demo, s);
    }

    GE.Store.drop('settings');
  }

  // ---- настройки рендера поменялись: масштаб кадра и замеры заново ----
  function applyGfx() {
    renderer.pixelScale = clampScale(gfx.scale);
    renderer.resize();
    perf.reset();
  }

  // отладочная строка поверх кадра: коротко и латиницей, чтобы не мешать переводу
  function debugText(counts) {
    var s = perf.stats;
    var gpu = (s.gpu === null || s.gpu === undefined) ? '—' : s.gpu.toFixed(2);
    var occ = s.occ > 0 ? Math.round(s.occ) + '%' : '—';
    var idle = s.idle > 50 ? ' · idle' : '';
    return 'fps ' + s.fps.toFixed(0) + ' · ' + s.avg.toFixed(1) + ' ms\n' +
      'p95 ' + s.p95.toFixed(1) + ' · max ' + s.worst.toFixed(1) + '\n' +
      renderer.canvas.width + '×' + renderer.canvas.height + ' · ' +
      renderer.pixelScale.toFixed(2) + '× · ' + counts.total + ' prim\n' +
      'cpu ' + s.cpu.toFixed(2) + ' · gpu ' + gpu + ' · core ' + occ + idle;
  }

  // ---- открыть сцену: свой набор объектов, своё окружение, своё положение камеры ----
  function switchScene(id) {
    var def = GE.Scenes.get(id) || GE.Scenes.all()[0];
    var settings = panels.readScene(def);
    var inst = def.create();

    active = { def: def, settings: settings, inst: inst };
    GE.Store.setText('activeScene', def.id);
    hud.setScene(def);

    camera.reset(def.camera);
    perf.reset();
    frames = 0;
    uiAt = 0;

    panels.buildScene(def, settings, inst, null);
    renderer.resize();

    // первое обновление: окружение (солнце, яркость) приходит из сохранённых ползунков
    inst.update(0, settings);
    panels.setStatus(inst.status ? inst.status(settings) : '');
  }

  // «Сброс»: ползунки этой сцены и камера — к значениям по умолчанию, замеры заново
  function resetScene() {
    if (!active) return;

    var def = active.def;
    var fresh = GE.Scenes.defaults(def);
    for (var k in fresh) active.settings[k] = fresh[k];
    panels.saveScene(def, active.settings);
    panels.syncScene(def, active.settings);

    active.inst.reset();
    active.inst.update(0, active.settings);
    camera.reset(def.camera);

    perf.reset();
    frames = 0;
    uiAt = 0;
    panels.setStatus(active.inst.status ? active.inst.status(active.settings) : '');
    renderer.resize();
  }

  async function boot() {
    hud.setGpuStatus(GE.t('game-engine.gpuAsking', 'asking for an adapter…'));

    var gpu = await GE.initGPU(canvas);
    hud.setGpuStatus(GE.describeAdapter(gpu.info) + ' · ' + gpu.format);

    renderer = new GE.Renderer(gpu, canvas);
    await renderer.init('./shaders/scene.wgsl');
    renderer.watchSize();

    perf = new GE.Perf(document.getElementById('perf-graph'));
    camera = new GE.Camera();
    GE.attachInput(canvas, camera);

    migrate();
    gfx = panels.readGfx();

    var defs = GE.Scenes.all();
    if (!defs.length) throw new Error('no scenes registered');

    var saved = GE.Store.text('activeScene', '');
    var startId = GE.Scenes.get(saved) ? saved : defs[0].id;

    panels.buildGfx(gfx, applyGfx);
    panels.buildSceneList(defs, startId, switchScene);

    switchScene(startId);
    applyGfx();

    hud.onPause(function (value) { paused = value; });
    hud.onReset(resetScene);

    var last = performance.now();
    var adaptAcc = 0;
    var lastBusy = 0;      // сколько последний кадр занимал видеоядро, мс
    var idleRun = 0;       // сколько кадров подряд не рисовали (в простое)

    // авто-масштаб: держим кадр около 60 Гц, меняя разрешение рендера.
    // Шаг множителем, а не прибавлением: от 2× до 0.01× иначе не добраться.
    // В простое не трогаем ничего: там кадров нет, и по «быстрому» интервалу
    // он бы улетел на 4×, а вернувшись к движению мы получили бы тяжёлый кадр.
    function adapt(dtSec, drew) {
      if (!(gfx.auto > 0.5)) return;
      if (!drew) { adaptAcc = 0; return; }

      adaptAcc += dtSec;
      if (adaptAcc < 0.5) return;
      adaptAcc = 0;

      var avg = perf.stats.avg;
      var before = renderer.pixelScale;
      if (avg > 21 && before > SCALE_MIN) renderer.pixelScale = Math.max(SCALE_MIN, before * 0.7);
      else if (avg < 13.5 && before < SCALE_MAX) renderer.pixelScale = Math.min(SCALE_MAX, before * 1.2);
      if (renderer.pixelScale !== before) renderer.resize();
    }

    function step(now) {
      var rawMs = now - last;
      last = now;
      // честный интервал: fps не врёт на тяжёлых кадрах
      var rawSec = Math.min(Math.max(rawMs / 1000, 0), 2);
      // шаг сцены — реальное время кадра, без обрезки: если кадр рисуется 140 мс,
      // сцена за эти 140 мс и сдвинется, иначе движение замедляется вместе с fps.
      // Потолок в 2 с — только страховка от возврата на вкладку и от сна машины
      var dt = rawSec;
      var t0 = performance.now();

      hud.tick(rawSec);

      var resized = renderer.resize();
      if (resized) renderer.forceDraw();   // после смены размера текстур старое содержимое не годится

      // камера живая всегда; на паузе сцена замирает, но ползунки продолжают работать
      camera.update(dt);
      active.inst.update(paused ? 0 : dt, active.settings);

      var counts = GE.writeFrame(renderer, active.inst, camera, gfx);

      // Сверка с прошлым кадром на процессоре: если на GPU ушли бы те же числа, рисунок
      // не изменится — кадр не подаём вовсе. В простое картинка стоит, ядро не работает.
      var drew = renderer.frameChanged();

      if (drew) {
        // вернулись из простоя — меряем заново: в окне остались быстрые «пустые» кадры,
        // и авто-масштаб счёл бы, что всé дёшево
        if (idleRun > 20) perf.reset();
        idleRun = 0;

        renderer.uploadAll();
        renderer.render();
        frames += 1;
      } else {
        idleRun += 1;
      }

      // статистика: интервал между кадрами, занятость процессора, время GPU.
      // Кадр после возврата на вкладку — сотни миллисекунд — в статистику не берём;
      // а вот медленные кадры слабого устройства берём: иначе на 4× график пустой.
      // Пустой кадр (ничего не изменилось) идёт с нулевой занятостью ядра.
      if (document.visibilityState !== 'hidden') {
        perf.push(rawMs, performance.now() - t0, drew ? renderer.gpuMs() : null,
          counts.total, renderer.canvas.width * renderer.canvas.height,
          drew ? lastBusy : 0, drew ? 1 : 0);
      }
      perf.draw();

      // строки состояния и цифры обновляем пять раз в секунду: в простое это вся работа
      var nowT = performance.now();
      if (nowT - uiAt >= 200) {
        uiAt = nowT;
        hud.setInfo(renderer.canvas.width, renderer.canvas.height, frames,
          counts.total, renderer.primBytes());
        hud.setPerf(perf.stats, renderer.pixelScale);
        if (active.inst.status) panels.setStatus(active.inst.status(active.settings));
        hud.setDebug(gfx.debug > 0.5 ? debugText(counts) : '');
      }

      adapt(rawSec, drew);
      return drew;
    }

    // ---- подача кадра: один кадр в полёте на видеокарте ----
    // Подавать кадр каждый тик экрана нельзя: при кадре в 140 мс цикл на 60 Гц набирал
    // бы минуты отложенной работы в очереди, видеоядро занято на 100% и вместе с ним
    // встаёт весь компьютер и интерфейс телефона. Поэтому процессор ждёт, пока поданный
    // кадр выполнится, — очередь не растёт, а камера, ползунки и меню остаются живыми.
    var busy = false;   // кадр подан, но ещё не выполнен

    // Простой после кадра: настройка «core limit» разрешает шейдеру занимать ядро
    // не всё время. Внутри кадра работа не дробится — прервать шейдер нельзя, но между
    // кадрами железо отдыхает, и вместе с ним дышат композитор, меню и вся система.
    // 50% — кадр и простой равны, занятость ядра падает вдвое.
    function idleFor(busyMs, duty) {
      var d = (typeof duty === 'number' && duty > 0 && duty < 1) ? duty : 1;
      if (d >= 1) return 0;
      return busyMs * (1 / d - 1);
    }

    function nextFrame() {
      requestAnimationFrame(frame);
    }

    // ошибка в кадре не должна молча убивать цикл: показываем её и останавливаемся
    function frame(now) {
      if (busy) { nextFrame(); return; }

      var drew = false;
      try {
        drew = step(now);
      } catch (err) {
        console.error(err);
        hud.fail(err);
        return;
      }

      // ничего не подавали — ждать нечего: сразу к следующей проверке
      if (!drew) { lastBusy = 0; nextFrame(); return; }

      // ждём именно этот кадр: onSubmittedWorkDone срабатывает, когда очередь опустела
      var queue = gpu.device.queue;
      if (typeof queue.onSubmittedWorkDone !== 'function') {
        nextFrame();
        return;
      }

      busy = true;
      var sentAt = performance.now();

      function done() {
        busy = false;
        lastBusy = performance.now() - sentAt;   // столько кадр занимал видеоядро
        var wait = idleFor(lastBusy, gfx.duty);
        if (wait > 1) setTimeout(nextFrame, wait);   // простой: ядро свободно для других
        else nextFrame();
      }

      // устройство потеряно или ждать нечего — цикл всё равно продолжаем
      queue.onSubmittedWorkDone().then(done, done);
    }

    // вернулись на вкладку — начинаем мерить заново и перерисовываем
    document.addEventListener('visibilitychange', function () {
      last = performance.now();
      perf.reset();
      renderer.forceDraw();
    });

    requestAnimationFrame(frame);

    if (gpu.device.lost && gpu.device.lost.then) {
      gpu.device.lost.then(function (info) {
        hud.fail(new Error(GE.t('game-engine.errLost', 'GPU device lost') + ': ' +
          ((info && (info.message || info.reason)) || '?')));
      });
    }
  }

  boot().catch(function (err) {
    console.error(err);
    hud.fail(err);
  });
})(window.GE = window.GE || {});
