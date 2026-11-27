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
    return 'fps ' + s.fps.toFixed(0) + ' · ' + s.avg.toFixed(1) + ' ms\n' +
      'p95 ' + s.p95.toFixed(1) + ' · max ' + s.worst.toFixed(1) + '\n' +
      renderer.canvas.width + '×' + renderer.canvas.height + ' · ' +
      renderer.pixelScale.toFixed(2) + '× · ' + counts.total + ' prim\n' +
      'cpu ' + s.cpu.toFixed(2) + ' · gpu ' + gpu;
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

    // авто-масштаб: держим кадр около 60 Гц, меняя разрешение рендера.
    // Шаг множителем, а не прибавлением: от 2× до 0.01× иначе не добраться.
    function adapt(dtSec) {
      if (!(gfx.auto > 0.5)) return;
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
      var rawSec = Math.min(Math.max(rawMs / 1000, 0), 1);   // честный интервал: fps не врёт на тяжёлых кадрах
      var dt = Math.min(rawSec, 0.05);                        // шаг сцены ограничен: без прыжков после паузы
      var t0 = performance.now();

      hud.tick(rawSec);
      renderer.resize();

      // камера живая всегда; на паузе сцена замирает, но ползунки продолжают работать
      camera.update(dt);
      active.inst.update(paused ? 0 : dt, active.settings);

      var counts = GE.writeFrame(renderer, active.inst, camera, gfx);
      renderer.uploadAll();
      renderer.render();

      frames += 1;
      hud.setInfo(renderer.canvas.width, renderer.canvas.height, frames,
        counts.total, renderer.primBytes());

      // статистика: интервал между кадрами, занятость процессора, время GPU.
      // Кадр после возврата на вкладку — сотни миллисекунд — в статистику не берём;
      // а вот медленные кадры слабого устройства берём: иначе на 4× график пустой.
      if (document.visibilityState !== 'hidden') {
        perf.push(rawMs, performance.now() - t0, renderer.gpuMs(),
          counts.total, renderer.canvas.width * renderer.canvas.height);
      }
      perf.draw();
      hud.setPerf(perf.stats, renderer.pixelScale);

      // строка состояния сцены и отладочная строка поверх кадра — пять раз в секунду
      var nowT = performance.now();
      if (nowT - uiAt >= 200) {
        uiAt = nowT;
        if (active.inst.status) panels.setStatus(active.inst.status(active.settings));
        hud.setDebug(gfx.debug > 0.5 ? debugText(counts) : '');
      }

      adapt(rawSec);
    }

    // ошибка в кадре не должна молча убивать цикл: показываем её и останавливаемся
    function frame(now) {
      try {
        step(now);
      } catch (err) {
        console.error(err);
        hud.fail(err);
        return;
      }
      requestAnimationFrame(frame);
    }

    // вернулись на вкладку — начинаем мерить заново
    document.addEventListener('visibilitychange', function () {
      last = performance.now();
      perf.reset();
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
