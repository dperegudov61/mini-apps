/* app.js — точка входа мини-приложения «game engine».
   Шейдеры лежат в shaders/*.wgsl, обвязка — в js/*.js; здесь только запуск и цикл кадров. */
(function (GE) {
  'use strict';

  var canvas = document.getElementById('gpu-canvas');
  var hud = new GE.HUD();
  var busy = false;   // во время проверки кадры не рисуем, чтобы данные на GPU не менялись
  var paused = false;

  async function boot() {
    hud.setGpuStatus(GE.t('game-engine.gpuAsking', 'asking for an adapter…'));

    var gpu = await GE.initGPU(canvas);
    hud.setGpuStatus(GE.describeAdapter(gpu.info) + ' · ' + gpu.format);

    var renderer = new GE.Renderer(gpu, canvas);
    await renderer.init('./shaders/render.wgsl');

    var settings = hud.buildControls();

    var game = new GE.Game();
    renderer.resize();
    game.reset(canvas.width, canvas.height);
    GE.attachInput(canvas, game);

    hud.onPause(function (value) { paused = value; });
    hud.onReset(function () { game.reset(canvas.width, canvas.height); });

    var tester = new GE.SelfTest(gpu, renderer);
    await tester.init();

    async function runCheck() {
      if (busy) return;
      busy = true;
      hud.setTesting(true);
      try {
        renderer.uploadParams();
        hud.setTests(await tester.run());
      } catch (err) {
        console.error(err);
        hud.setTests([{
          name: GE.t('game-engine.check', 'Shader launch check'),
          ok: false,
          detail: String((err && err.message) || err)
        }]);
      } finally {
        hud.setTesting(false);
        busy = false;
      }
    }
    hud.onTest(runCheck);

    var last = performance.now();

    function step(now) {
      var dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
      last = now;
      hud.tick(dt);

      if (!busy) {
        renderer.resize();
        var w = canvas.width;
        var h = canvas.height;
        if (!paused) game.update(dt, w, h, settings);
        game.writeParams(renderer.params, w, h, settings);
        renderer.uploadParams();
        renderer.render();
        hud.setInfo(w, h, game.frame);
      }
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
    requestAnimationFrame(frame);

    // первый прогон проверки — когда кадр уже нарисован
    await new Promise(function (resolve) { setTimeout(resolve, 400); });
    await runCheck();

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
