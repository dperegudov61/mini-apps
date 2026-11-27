/* hud.js — метрики кадра, статистика производительности и сообщение об ошибке.
   Ползунки сцен и настройки рендера строит ui/panels.js; здесь только вывод чисел. */
(function (GE) {
  'use strict';

  function HUD() {
    var $ = function (id) { return document.getElementById(id); };

    this.el = {
      gpuInfo: $('gpu-info'),
      frameSize: $('frame-size'),
      frameScene: $('frame-scene'),
      dbg: $('dbg-overlay'),
      overlay: $('overlay'),
      fps: $('m-fps'),
      frame: $('m-frame'),
      res: $('m-res'),
      up: $('m-up'),
      pFps: $('p-fps'),
      pAvg: $('p-avg'),
      pBest: $('p-best'),
      pP95: $('p-p95'),
      pWorst: $('p-worst'),
      pCpu: $('p-cpu'),
      pGpu: $('p-gpu'),
      pScale: $('p-scale'),
      pPrims: $('p-prims'),
      pOcc: $('p-occ'),
      pMpx: $('p-mpx'),
      btnPause: $('btn-pause'),
      btnReset: $('btn-reset')
    };

    this._acc = 0;
    this._frames = 0;
    this._paused = false;
    this._onPause = null;
    this._onReset = null;

    var self = this;
    this.el.btnPause.addEventListener('click', function () { self.togglePause(); });
    this.el.btnReset.addEventListener('click', function () {
      if (self._onReset) self._onReset();
    });
  }

  HUD.prototype.setGpuStatus = function (text) {
    if (this.el.gpuInfo) this.el.gpuInfo.textContent = 'GPU: ' + text;
  };

  // в шапке рамки — имя открытой сцены
  HUD.prototype.setScene = function (def) {
    if (!this.el.frameScene || !def) return;
    GE.label(this.el.frameScene, def.label, def.fb || def.id);
  };

  // отладочная строка поверх кадра: пустая строка — спрятать
  HUD.prototype.setDebug = function (text) {
    var el = this.el.dbg;
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    if (el.textContent !== text) el.textContent = text;
  };

  HUD.prototype.onPause = function (cb) { this._onPause = cb; };
  HUD.prototype.onReset = function (cb) { this._onReset = cb; };

  // ---- метрики ------------------------------------------------------------

  HUD.prototype.setInfo = function (w, h, frame, primCount, primBytes) {
    this.el.res.textContent = w + '×' + h;
    this.el.frameSize.textContent = w + '×' + h;
    this.el.frame.textContent = String(frame);
    if (primCount !== undefined) {
      this.el.up.textContent = GE.t('game-engine.prims', '{0} prim · {1} B',
        [String(primCount), String(primBytes)]);
    }
  };

  // цифры инструментов производительности
  HUD.prototype.setPerf = function (s, scale) {
    var e = this.el;
    if (!e.pAvg) return;
    e.pAvg.textContent = s.avg.toFixed(1);
    e.pBest.textContent = s.best.toFixed(1);
    e.pP95.textContent = s.p95.toFixed(1);
    e.pWorst.textContent = s.worst.toFixed(1);
    e.pCpu.textContent = s.cpu.toFixed(2);
    e.pScale.textContent = (scale || 1).toFixed(2) + '×';
    if (e.pFps) e.pFps.textContent = s.fps.toFixed(0);
    // сколько тел в сцене и во что обходится мегапиксель кадра — одной меркой на любое устройство;
    // при упоре в частоту экрана (60 Гц) время кадра ничего не говорит о цене — показываем «—»
    if (e.pPrims) e.pPrims.textContent = String(s.prims || 0);
    if (e.pOcc) {
      // в простое кадры не рисуются — занятость честный ноль, а не «нет данных»
      if (s.idle >= 50) e.pOcc.textContent = '0';
      else e.pOcc.textContent = s.occ > 0 ? String(Math.round(s.occ)) : '—';
      var occCell = e.pOcc.parentNode;
      if (occCell) {
        occCell.title = s.idle >= 50
          ? GE.t('game-engine.pfOccIdle', 'the picture is not changing: frames are not drawn, the GPU core is idle')
          : GE.t('game-engine.pfOccHint',
            'share of time the GPU core is busy: 100% — the queue never empties, 50% — the core is half idle');
      }
    }
    if (e.pMpx) {
      var capped = s.avg > 0 && s.avg < 17.5;
      e.pMpx.textContent = capped ? '—' : (s.msPerMpx || 0).toFixed(1);
      var mpxCell = e.pMpx.parentNode;
      if (mpxCell) {
        mpxCell.title = GE.t('game-engine.pfMpxHint',
          'frame time per megapixel: grows with the number of bodies and the render scale');
      }
    }

    if (e.pGpu) {
      var hasGpu = (s.gpu !== null && s.gpu !== undefined);
      e.pGpu.textContent = hasGpu ? s.gpu.toFixed(2) : '—';
      var holder = e.pGpu.parentNode;
      if (holder) {
        holder.title = hasGpu
          ? GE.t('game-engine.pfGpuOn', 'time of the render pass, measured on the GPU')
          : GE.t('game-engine.pfGpuOff', 'this browser does not let the page measure GPU time');
      }
    }
  };

  HUD.prototype.tick = function (dt) {
    this._acc += dt;
    this._frames += 1;
    if (this._acc >= 0.35) {
      this.el.fps.textContent = String(Math.round(this._frames / this._acc));
      this._acc = 0;
      this._frames = 0;
    }
  };

  HUD.prototype.togglePause = function () {
    this._paused = !this._paused;
    GE.label(this.el.btnPause, this._paused ? 'game-engine.resume' : 'game-engine.pause',
      this._paused ? 'Resume' : 'Pause');
    this.el.btnPause.classList.toggle('on', this._paused);
    if (this._onPause) this._onPause(this._paused);
  };

  HUD.prototype.fail = function (err) {
    var overlay = this.el.overlay;
    overlay.hidden = false;
    overlay.textContent = '';

    var title = document.createElement('h3');
    title.textContent = GE.t('game-engine.failTitle', 'the engine did not start');

    var msg = document.createElement('div');
    msg.textContent = String((err && err.message) || err);

    var list = document.createElement('ul');
    var hints = [
      ['game-engine.fail1', 'Open the app by its web address: from a local disk the browser does not let it read the shader files.'],
      ['game-engine.fail2', 'A browser with WebGPU is required (Chrome or Edge 113+).'],
      ['game-engine.fail3', 'No adapter? Check WebGPU in the browser settings and update the graphics driver.']
    ];
    if (err && err.noFetch) {
      hints = [hints[0], hints[1]];
    }
    hints.forEach(function (h) {
      var li = document.createElement('li');
      li.textContent = GE.t(h[0], h[1]);
      list.appendChild(li);
    });

    overlay.appendChild(title);
    overlay.appendChild(msg);
    overlay.appendChild(list);
    this.setGpuStatus('—');
  };

  GE.HUD = HUD;
})(window.GE = window.GE || {});
