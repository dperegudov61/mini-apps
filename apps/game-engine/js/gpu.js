/* gpu.js — инициализация WebGPU: адаптер, устройство, контекст канваса. */
(function (GE) {
  'use strict';

  GE.initGPU = async function (canvas) {
    if (!navigator.gpu) {
      throw new Error(GE.t('game-engine.errNoWebGPU',
        'This browser has no navigator.gpu — WebGPU is unavailable.'));
    }

    var adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      throw new Error(GE.t('game-engine.errNoAdapter',
        'No GPU adapter: WebGPU may be disabled or there is no suitable driver.'));
    }

    var device = await adapter.requestDevice();
    if (device.addEventListener) {
      device.addEventListener('uncapturederror', function (e) {
        console.error('[webgpu] uncaught:', e.error);
      });
    }

    var context = canvas.getContext('webgpu');
    if (!context) throw new Error('canvas.getContext("webgpu") returned null');

    var format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device: device,
      format: format,
      alphaMode: 'opaque',
      // COPY_SRC нужен проверке: она читает готовый кадр обратно на CPU
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    });

    return { adapter: adapter, device: device, context: context, format: format, info: adapter.info || {} };
  };

  // компиляция шейдера с человеческой диагностикой вместо тишины
  GE.assertCompiles = async function (module, label) {
    if (!module.getCompilationInfo) return;
    var info = await module.getCompilationInfo();
    var errors = [];
    var messages = info.messages || [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var where = label + ':' + m.lineNum + ':' + m.linePos;
      if (m.type === 'error') errors.push(where + ' — ' + m.message);
      else console.warn('[' + where + '] ' + m.type + ': ' + m.message);
    }
    if (errors.length) throw new Error(errors.join('\n'));
  };

  GE.describeAdapter = function (info) {
    if (!info) return 'GPU';
    var parts = [info.vendor, info.architecture, info.device, info.description];
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i] ? String(parts[i]).trim() : '';
      if (s && s !== 'unknown' && out.indexOf(s) < 0) out.push(s);
    }
    return out.length ? out.join(' · ') : 'GPU';
  };
})(window.GE = window.GE || {});
