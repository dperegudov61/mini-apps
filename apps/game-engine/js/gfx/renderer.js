/* renderer.js — обвязка WebGPU: пайплайн, буфер значений, буфер примитивов, кадр.
   Про сцену ничего не знает: получает числа и массив примитивов — рисует.
   Масштаб кадра и время GPU — настройки рендера, общие для всех сцен. */
(function (GE) {
  'use strict';

  var PARAMS_FLOATS = 48;   // 48 × f32 = 192 Б, см. shaders/params.wgsl
  var PARAMS_TIME = 3;      // индекс игрового времени в значениях кадра (см. pack.js)
  var PRIM_FLOATS = 12;     // примитив = 3 vec4f = 48 Б, см. shaders/primitives.wgsl
  var MAX_PRIMS = 4096;     // потолок буфера примитивов: 192 КБ, хватает кубу сфер 16³

  function Renderer(gpu, canvas) {
    this.gpu = gpu;
    this.canvas = canvas;
    this.device = gpu.device;
    this.context = gpu.context;
    this.format = gpu.format;

    // один буфер и два вида: float — значения, u32 — счётчики примитивов
    this.buffer = new ArrayBuffer(PARAMS_FLOATS * 4);
    this.params = new Float32Array(this.buffer);
    this.paramsU32 = new Uint32Array(this.buffer);

    this.primData = new Float32Array(MAX_PRIMS * PRIM_FLOATS);
    this.primCount = 0;

    // сверка кадра с прошлым: копия того, что уже ушло на GPU. Совпало — подавать нечего
    this.lastParams = new Float32Array(PARAMS_FLOATS);
    this.lastPrims = new Float32Array(MAX_PRIMS * PRIM_FLOATS);
    this.lastCount = -1;
    this.forced = true;       // нарисовать обязательно: размер кадра, возврат на вкладку

    this.pixelScale = 1;      // 0.01…4 — разрешение кадра, главный рычаг отладки производительности
    this.timing = null;       // запрос времени GPU (если браузер дал timestamp-query)
    this.maxPixelWidth = 3840;

    // CSS-размер канваса: читаем не каждый кадр, а по событию изменения раскладки
    this.cssW = 0;
    this.cssH = 0;
    this.lastDpr = 0;
  }

  Renderer.prototype.init = async function (shaderUrl) {
    var device = this.device;

    var url = shaderUrl || './shaders/scene.wgsl';
    var code = await GE.loadShader(url);
    var name = url.replace(/^.*\//, '');
    var module = device.createShaderModule({ code: code, label: name });
    await GE.assertCompiles(module, name);

    this.pipeline = device.createRenderPipeline({
      label: 'scene',
      layout: 'auto',
      vertex: { module: module, entryPoint: 'vs_main' },
      fragment: { module: module, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' }
    });

    // значения кадра: камера, солнце, счётчики (shaders/params.wgsl)
    this.uniformBuffer = device.createBuffer({
      label: 'params (uniform)',
      size: PARAMS_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    // примитивы сцены: сферы, конусы, кубы (shaders/primitives.wgsl)
    this.primBuffer = device.createBuffer({
      label: 'primitives (storage)',
      size: MAX_PRIMS * PRIM_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    this.bindGroup = device.createBindGroup({
      label: 'scene bindings',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.primBuffer } }
      ]
    });

    this.uploadAll();
    this.initTiming();
    return this;
  };

  // Время прохода на GPU: две метки времени вокруг render pass.
  // Где их можно ставить — зависит от браузера: новые умеют на кодировщике,
  // часть старых — только внутри прохода (и только с экспериментальной фичей).
  // Нет ни того, ни другого — инструмент просто показывает «—».
  Renderer.prototype.initTiming = function () {
    var device = this.device;
    if (!device.features || !device.features.has('timestamp-query')) return;

    var mode = null;
    if (typeof GPUCommandEncoder.prototype.writeTimestamp === 'function') {
      mode = 'encoder';
    } else if (typeof GPURenderPassEncoder.prototype.writeTimestamp === 'function' &&
               device.features.has('chromium-experimental-timestamp-query-inside-passes')) {
      mode = 'pass';
    }
    if (!mode) return;

    this.timing = {
      mode: mode,
      set: device.createQuerySet({ type: 'timestamp', count: 2 }),
      resolve: device.createBuffer({
        label: 'timestamps (resolve)',
        size: 16,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
      }),
      read: device.createBuffer({
        label: 'timestamps (read)',
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      }),
      busy: false,
      ms: null
    };
  };

  // последнее измеренное время прохода, мс (null — измерения нет)
  Renderer.prototype.gpuMs = function () {
    return this.timing ? this.timing.ms : null;
  };

  Renderer.prototype.readTiming = function () {
    var t = this.timing;
    if (!t || t.busy) return;
    t.busy = true;

    t.read.mapAsync(GPUMapMode.READ).then(function () {
      var view = new BigUint64Array(t.read.getMappedRange().slice(0));
      t.read.unmap();
      var ns = Number(view[1] - view[0]);
      if (isFinite(ns) && ns > 0) t.ms = ns / 1e6;   // наносекунды → миллисекунды
      t.busy = false;
    }).catch(function () {
      t.busy = false;
    });
  };

  // CSS-размер канваса читается не каждый кадр, а по событию изменения раскладки:
  // getBoundingClientRect в цикле кадров — лишняя работа на каждом кадре.
  Renderer.prototype.measure = function () {
    var rect = this.canvas.getBoundingClientRect();
    this.cssW = rect.width;
    this.cssH = rect.height;
  };

  Renderer.prototype.watchSize = function () {
    var self = this;
    function refresh() { self.measure(); }
    if (window.ResizeObserver) {
      this.sizeWatcher = new ResizeObserver(refresh);
      this.sizeWatcher.observe(this.canvas);
    }
    window.addEventListener('resize', refresh);
    this.measure();
    return this;
  };

  // подгоняем размер канваса под CSS-размер (с учётом плотности пикселей и масштаба рендера)
  Renderer.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    // плотность могла поменяться (окно перенесли на другой экран) — тогда перемеряем CSS-размер
    if (dpr !== this.lastDpr) {
      this.lastDpr = dpr;
      this.measure();
    }

    var cssW = this.cssW, cssH = this.cssH;
    if (!(cssW > 0)) {
      this.measure();
      cssW = this.cssW;
      cssH = this.cssH;
    }

    var scale = this.pixelScale || 1;
    var w = Math.max(1, Math.round(cssW * dpr * scale));
    var h = Math.max(1, Math.round((cssH || cssW * 0.5625) * dpr * scale));

    // потолок по ширине: пропорции кадра при этом не ломаются (уменьшаем оба размера)
    if (w > this.maxPixelWidth) {
      var k = this.maxPixelWidth / w;
      w = this.maxPixelWidth;
      h = Math.max(1, Math.round(h * k));
    }

    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  };

  // кадр обязательно нарисовать, даже если числа те же: сменился размер полотна
  // или вернулись на вкладку — содержимое экрана могло пропасть
  Renderer.prototype.forceDraw = function () {
    this.forced = true;
  };

  // Сверка кадра с прошлым — на процессоре, до подачи на GPU. Сравниваем ровно то,
  // что уйдёт в буферы: значения кадра и примитивы. Совпало — рисунок будет тот же
  // байт в байт, и кадр можно не подавать вовсе.
  // Игровое время (params[3]) не сравниваем: от него зависят только мерцание звёзд
  // и дизеринг; учитывай мы его — простой не наступал бы никогда.
  Renderer.prototype.frameChanged = function () {
    var i, n, changed = this.forced || this.primCount !== this.lastCount;

    if (!changed) {
      for (i = 0; i < PARAMS_FLOATS; i++) {
        if (i === PARAMS_TIME) continue;
        if (this.params[i] !== this.lastParams[i]) { changed = true; break; }
      }
    }

    if (!changed) {
      n = this.primCount * PRIM_FLOATS;
      for (i = 0; i < n; i++) {
        if (this.primData[i] !== this.lastPrims[i]) { changed = true; break; }
      }
    }

    if (!changed) return false;

    this.forced = false;
    this.lastParams.set(this.params);
    this.lastCount = this.primCount;
    if (this.primCount > 0) this.lastPrims.set(this.primData.subarray(0, this.primCount * PRIM_FLOATS));
    return true;
  };

  // значения и примитивы уходят на GPU вместе: сцена меняется между кадрами
  Renderer.prototype.uploadAll = function () {
    var queue = this.device.queue;
    queue.writeBuffer(this.uniformBuffer, 0, this.params);
    if (this.primCount > 0) {
      queue.writeBuffer(this.primBuffer, 0, this.primData, 0, this.primCount * PRIM_FLOATS);
    }
  };

  // сколько байт буфера примитивов занято — для метрики «cpu → gpu»
  Renderer.prototype.primBytes = function () {
    return this.primCount * PRIM_FLOATS * 4;
  };

  Renderer.prototype.render = function () {
    if (!this.canvas.width || !this.canvas.height) return;

    var timing = this.timing;
    var encoder = this.device.createCommandEncoder({ label: 'frame' });
    var encoderMarks = !!timing && timing.mode === 'encoder';

    if (encoderMarks) encoder.writeTimestamp(timing.set, 0);

    var pass = encoder.beginRenderPass({
      label: 'scene pass',
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.02, g: 0.03, b: 0.04, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });

    var passMarks = !!timing && timing.mode === 'pass';
    if (passMarks) pass.writeTimestamp(timing.set, 0);

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);

    if (passMarks) pass.writeTimestamp(timing.set, 1);
    pass.end();

    if (encoderMarks) encoder.writeTimestamp(timing.set, 1);

    if (timing) {
      encoder.resolveQuerySet(timing.set, 0, 2, timing.resolve, 0);
      encoder.copyBufferToBuffer(timing.resolve, 0, timing.read, 0, 16);
    }

    this.device.queue.submit([encoder.finish()]);

    if (timing) this.readTiming();
  };

  GE.PARAMS_FLOATS = PARAMS_FLOATS;
  GE.MAX_PRIMS = MAX_PRIMS;
  GE.Renderer = Renderer;
})(window.GE = window.GE || {});
