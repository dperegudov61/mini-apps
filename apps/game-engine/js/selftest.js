/* selftest.js — проверка запуска шейдеров.
   Ничего не сравнивает с расчётной моделью, только отвечает на вопрос
   «шейдер запустился и что-то нарисовал?»:
     1) рендер-шейдер: WGSL скомпилировался, пайплайн создан, кадр отправлен,
        из готового кадра читается полоса пикселей обратно на CPU;
     2) compute-шейдер: workgroup запускается и оставляет в буфере метку.
   Глубокая сверка значений CPU ↔ GPU — следующий этап. */
(function (GE) {
  'use strict';

  var MARK = 0x43505057; // то же число в shaders/verify.wgsl

  function hex8(v) {
    return (v >>> 0).toString(16).padStart(8, '0');
  }

  function SelfTest(gpu, renderer) {
    this.device = gpu.device;
    this.context = gpu.context;
    this.format = gpu.format;
    this.renderer = renderer;
    this.runs = 0;
  }

  SelfTest.prototype.init = async function () {
    var device = this.device;

    var code = await GE.loadShader('./shaders/verify.wgsl');
    var module = device.createShaderModule({ code: code, label: 'verify.wgsl' });
    await GE.assertCompiles(module, 'verify.wgsl');

    this.smokePipeline = device.createComputePipeline({
      label: 'smoke',
      layout: 'auto',
      compute: { module: module, entryPoint: 'smoke' }
    });

    this.words = device.createBuffer({
      label: 'smoke words',
      size: 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    this.wordsRead = device.createBuffer({
      label: 'smoke words read',
      size: 64,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });

    this.smokeBindGroup = device.createBindGroup({
      label: 'smoke bindings',
      layout: this.smokePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.words } }]
    });
  };

  SelfTest.prototype.run = async function () {
    this.runs += 1;
    var device = this.device;
    var results = [];

    // --- 1. рендер-шейдер: кадр нарисован и из него читаются пиксели --------
    device.pushErrorScope('validation');
    var frame = null;
    try {
      this.renderer.render();
      frame = await this.readFramePixels();
    } catch (err) {
      frame = { error: err };
    }
    var renderError = await device.popErrorScope();

    if (renderError || frame.error) {
      results.push({
        name: GE.t('game-engine.renderShader', 'render shader'),
        ok: false,
        detail: GE.t('game-engine.gpuError', 'GPU error: {0}', [
          (renderError && renderError.message) || (frame.error && frame.error.message) || '?'
        ])
      });
    } else {
      var ok = frame.distinct >= 3;
      results.push({
        name: GE.t('game-engine.renderShader', 'render shader'),
        ok: ok,
        detail: ok
          ? GE.t('game-engine.frameInfo', 'frame {0}×{1}, pixel #{2}, shades in row: {3}',
            [frame.width, frame.height, frame.hex, frame.distinct])
          : GE.t('game-engine.frameEmpty', 'frame {0}×{1} — the shader drew nothing',
            [frame.width, frame.height])
      });
    }

    // --- 2. compute-шейдер: запустился и оставил метку -----------------------
    device.pushErrorScope('validation');
    var words = null;
    var computeError = null;
    try {
      words = new Uint32Array(await this.runSmoke());
    } catch (err) {
      computeError = err;
    }
    computeError = computeError || (await device.popErrorScope());

    if (computeError || !words) {
      results.push({
        name: GE.t('game-engine.computeShader', 'compute shader'),
        ok: false,
        detail: (computeError && computeError.message) || GE.t('game-engine.computeFail', 'the compute shader did not start')
      });
    } else {
      var marker = words[0] === MARK && words[5] === 0x5a5a0005;
      results.push({
        name: GE.t('game-engine.computeShader', 'compute shader'),
        ok: marker,
        detail: marker
          ? GE.t('game-engine.markerOk', 'marker 0x{0}, workgroup 1×1×1 done', [hex8(words[0])])
          : GE.t('game-engine.markerBad', 'no marker, first word 0x{0}', [hex8(words[0])])
      });
    }

    console.info('[game-engine] check #' + this.runs, results);
    return results;
  };

  // читает полосу пикселей из только что нарисованного кадра
  SelfTest.prototype.readFramePixels = async function () {
    var device = this.device;
    var w = this.renderer.canvas.width;
    var h = this.renderer.canvas.height;
    var columns = Math.min(w, 64);
    var bytesPerRow = 256; // требование WebGPU: кратно 256

    var buffer = device.createBuffer({
      label: 'frame read',
      size: bytesPerRow,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    var encoder = device.createCommandEncoder({ label: 'read frame' });
    encoder.copyTextureToBuffer(
      { texture: this.context.getCurrentTexture() },
      { buffer: buffer, bytesPerRow: bytesPerRow, rowsPerImage: 1 },
      { width: columns, height: 1, origin: { x: 0, y: Math.floor(h / 2) } }
    );
    device.queue.submit([encoder.finish()]);

    await buffer.mapAsync(GPUMapMode.READ);
    var data = new Uint8Array(buffer.getMappedRange(0, bytesPerRow).slice(0));
    buffer.unmap();
    buffer.destroy();

    var bgra = String(this.format).indexOf('bgra') === 0;
    var colors = {};
    var distinct = 0;
    for (var i = 0; i < columns; i++) {
      var key = data[i * 4] + ',' + data[i * 4 + 1] + ',' + data[i * 4 + 2];
      if (!colors[key]) { colors[key] = 1; distinct += 1; }
    }

    var r = bgra ? data[2] : data[0];
    var g = data[1];
    var b = bgra ? data[0] : data[2];
    var hex = [r, g, b].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');

    return { width: w, height: h, distinct: distinct, hex: hex, error: null };
  };

  SelfTest.prototype.runSmoke = async function () {
    var encoder = this.device.createCommandEncoder({ label: 'smoke' });
    var pass = encoder.beginComputePass({ label: 'smoke pass' });
    pass.setPipeline(this.smokePipeline);
    pass.setBindGroup(0, this.smokeBindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(this.words, 0, this.wordsRead, 0, 64);
    this.device.queue.submit([encoder.finish()]);

    await this.wordsRead.mapAsync(GPUMapMode.READ);
    var copy = this.wordsRead.getMappedRange(0, 64).slice(0);
    this.wordsRead.unmap();
    return copy;
  };

  GE.SelfTest = SelfTest;
})(window.GE = window.GE || {});
