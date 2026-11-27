/* renderer.js — обвязка WebGPU: пайплайн, буфер значений, буфер примитивов, кадр.
   Про сцену ничего не знает: получает числа и массив примитивов — рисует.
   Масштаб кадра и время GPU — настройки рендера, общие для всех сцен.

   Кадры живут в текстурах, а не на экране: экран между кадрами ничего не помнит.
     texDyn  — кадр движения (размер = полотно × масштаб, то есть дёшево);
     texFillA/B — полный кадр, который собирается в статике; две штуки, потому что
                  слияние читает собранное и пишет рядом (одну и ту же текстуру
                  читать и писать нельзя);
     texSmall — проход наполнения: его пиксель — одна точка полного кадра на решётке,
                  поэтому текстура в step раз меньше, и проход стоит свою долю кадра.

   Каждый кадр на экран попадает одним проходом «текстура → экран» (blit). */
(function (GE) {
  'use strict';

  var PARAMS_FLOATS = 52;   // 52 × f32 = 208 Б, см. shaders/params.wgsl
  var PARAMS_TIME = 3;      // индекс игрового времени в значениях кадра (см. pack.js)
  var PARAMS_MASK = 48;     // .x шаг решётки (1 — весь кадр), .y и .z — смещение
  var PRIM_FLOATS = 32;     // примитив = 8 vec4f = 128 Б, см. shaders/primitives.wgsl
  var MAX_PRIMS = 32768;    // потолок буфера примитивов: 4 МБ, куб сфер 32³ (32768)
  var MAX_CSG = 131072;     // потолок CSG-программы: инструкций (2 u32 на инструкцию)
  var CLEAR = { r: 0.02, g: 0.03, b: 0.04, a: 1 };

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
    this.csgData = new Uint32Array(MAX_CSG * 2);
    this.csgCount = 0;

    // сверка кадра с прошлым: копия того, что уже ушло на GPU. Совпало — подавать нечего
    this.lastParams = new Float32Array(PARAMS_FLOATS);
    this.lastPrims = new Float32Array(MAX_PRIMS * PRIM_FLOATS);
    this.lastCsg = new Uint32Array(MAX_CSG * 2);
    this.lastCount = -1;
    this.forced = true;       // нарисовать обязательно: размер кадра, возврат на вкладку

    this.pixelScale = 1;      // 0.01…4 — разрешение кадра движения, главный рычаг отладки
    this.timing = null;       // запрос времени GPU (если браузер дал timestamp-query)
    this.maxPixelWidth = 3840;

    // CSS-размер канваса: читаем не каждый кадр, а по событию изменения раскладки
    this.cssW = 0;
    this.cssH = 0;
    this.lastDpr = 0;

    this.dynW = 1; this.dynH = 1;         // кадр движения
    this.fullW = 1; this.fullH = 1;       // полный кадр
    this.smallW = 1; this.smallH = 1;     // проход наполнения
    this.fillStep = 1;                    // шаг решётки наполнения (1 — весь кадр)

    this.texDyn = null; this.viewDyn = null;
    this.texA = null; this.viewA = null;
    this.texB = null; this.viewB = null;
    this.texSmall = null; this.viewSmall = null;

    this.bgDyn = null; this.bgA = null; this.bgB = null;          // «текстура → экран»
    this.bgFromA = null; this.bgFromB = null;   // слияние прохода

    this.mergeParams = new Float32Array(4);   // шаг решётки и смещение (см. shaders/blit.wgsl)

    this.renderW = 1;        // размер последнего нарисованного кадра (для панели)
    this.renderH = 1;
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

    // проходы «текстура → экран» и слияние наполнения — из одного маленького шейдера
    var blitCode = await GE.loadShader('./shaders/blit.wgsl');
    var blitModule = device.createShaderModule({ code: blitCode, label: 'blit.wgsl' });
    await GE.assertCompiles(blitModule, 'blit.wgsl');

    this.blitPipeline = device.createRenderPipeline({
      label: 'blit',
      layout: 'auto',
      vertex: { module: blitModule, entryPoint: 'vs_main' },
      fragment: { module: blitModule, entryPoint: 'fs_copy', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' }
    });

    this.mergePipeline = device.createRenderPipeline({
      label: 'merge',
      layout: 'auto',
      vertex: { module: blitModule, entryPoint: 'vs_main' },
      fragment: { module: blitModule, entryPoint: 'fs_merge', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' }
    });

    this.sampler = device.createSampler({
      label: 'frame sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });

    this.mergeBuffer = device.createBuffer({
      label: 'merge (uniform)',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    // значения кадра: камера, солнце, счётчики (shaders/params.wgsl)
    this.uniformBuffer = device.createBuffer({
      label: 'params (uniform)',
      size: PARAMS_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    // примитивы сцены: сферы, кубы, торы, конусы, поверхности (shaders/primitives.wgsl)
    this.primBuffer = device.createBuffer({
      label: 'primitives (storage)',
      size: MAX_PRIMS * PRIM_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    // CSG-программа: плоская постфиксная запись булевых операций (shaders/primitives.wgsl)
    this.csgBuffer = device.createBuffer({
      label: 'csg (storage)',
      size: MAX_CSG * 2 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    this.bindGroup = device.createBindGroup({
      label: 'scene bindings',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.primBuffer } },
        { binding: 2, resource: { buffer: this.csgBuffer } }
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

  // Полотно всегда в точности по размеру экрана (CSS × плотность): экран показывает
  // кадр один к одному, а «разрешение кадра движения» задаёт размер его текстуры.
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

    var aspect = (cssH || cssW * 0.5625) / (cssW || 1);

    // полный кадр: потолок по ширине (пропорции не ломаются — уменьшаем оба размера)
    var fullW = Math.max(1, Math.round(cssW * dpr));
    var fullH = Math.max(1, Math.round(fullW * aspect));
    if (fullW > this.maxPixelWidth) {
      var k = this.maxPixelWidth / fullW;
      fullW = this.maxPixelWidth;
      fullH = Math.max(1, Math.round(fullH * k));
    }

    // кадр движения: тот же кадр в масштабе (может быть и больше 1× — проверка слабого устройства)
    var scale = this.pixelScale || 1;
    var dynW = Math.max(1, Math.round(cssW * dpr * scale));
    var dynH = Math.max(1, Math.round((cssH || cssW * 0.5625) * dpr * scale));
    if (dynW > this.maxPixelWidth) {
      var kd = this.maxPixelWidth / dynW;
      dynW = this.maxPixelWidth;
      dynH = Math.max(1, Math.round(dynH * kd));
    }

    var changed = this.canvas.width !== fullW || this.canvas.height !== fullH;
    if (changed) {
      this.canvas.width = fullW;
      this.canvas.height = fullH;
      this.measure();   // размер содержимого канваса мог измениться
    }

    this.fullW = fullW;
    this.fullH = fullH;
    this.dynW = dynW;
    this.dynH = dynH;
    this.ensureTextures();
    return changed;
  };

  function gcd(a, b) {
    while (b) { var t = a % b; a = b; b = t; }
    return a;
  }

  function tex(device, label, w, h, format) {
    return device.createTexture({
      label: label,
      size: [w, h],
      format: format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
  }

  // текстуры кадров: пересоздаются, только когда действительно поменялся размер
  Renderer.prototype.ensureTextures = function () {
    var d = this.device, f = this.format;
    var step = Math.max(1, Math.round(this.fillStep || 1));
    var smallW = Math.max(1, Math.ceil(this.fullW / step));
    var smallH = Math.max(1, Math.ceil(this.fullH / step));

    var dynNew = !this.texDyn || this.texDyn.width !== this.dynW || this.texDyn.height !== this.dynH;
    var fullNew = !this.texA || this.texA.width !== this.fullW || this.texA.height !== this.fullH;
    var smallNew = !this.texSmall || this.texSmall.width !== smallW || this.texSmall.height !== smallH;

    if (dynNew) {
      if (this.texDyn) this.texDyn.destroy();
      this.texDyn = tex(d, 'frame (dynamic)', this.dynW, this.dynH, f);
      this.viewDyn = this.texDyn.createView();
    }

    if (fullNew) {
      if (this.texA) this.texA.destroy();
      if (this.texB) this.texB.destroy();
      this.texA = tex(d, 'frame A (full)', this.fullW, this.fullH, f);
      this.texB = tex(d, 'frame B (full)', this.fullW, this.fullH, f);
      this.viewA = this.texA.createView();
      this.viewB = this.texB.createView();
    }

    if (smallNew) {
      if (this.texSmall) this.texSmall.destroy();
      this.texSmall = tex(d, 'frame (fill step)', smallW, smallH, f);
      this.viewSmall = this.texSmall.createView();
      this.smallW = smallW;
      this.smallH = smallH;
    }

    if (dynNew || fullNew || smallNew) this.rebuildGroups();
  };

  Renderer.prototype.rebuildGroups = function () {
    var d = this.device;
    var blitLayout = this.blitPipeline.getBindGroupLayout(0);
    var mergeLayout = this.mergePipeline.getBindGroupLayout(0);

    function copyGroup(view, sampler) {
      return d.createBindGroup({
        label: 'blit',
        layout: blitLayout,
        entries: [
          { binding: 0, resource: view },
          { binding: 1, resource: sampler }
        ]
      });
    }

    this.bgDyn = copyGroup(this.viewDyn, this.sampler);
    this.bgA = copyGroup(this.viewA, this.sampler);
    this.bgB = copyGroup(this.viewB, this.sampler);
    this.bgSmall = copyGroup(this.viewSmall, this.sampler);

    var self = this;
    function mergeGroup(accView) {
      return d.createBindGroup({
        label: 'merge',
        layout: mergeLayout,
        entries: [
          { binding: 0, resource: self.viewSmall },
          { binding: 1, resource: self.sampler },
          { binding: 2, resource: accView },
          { binding: 3, resource: { buffer: self.mergeBuffer } }
        ]
      });
    }

    this.bgFromA = mergeGroup(this.viewA);
    this.bgFromB = mergeGroup(this.viewB);
  };

  // кадр обязательно нарисовать, даже если числа те же: сменился размер полотна
  // или вернулись на вкладку — содержимое экрана могло пропасть
  Renderer.prototype.forceDraw = function () {
    this.forced = true;
  };

  // Сверка содержимого кадра на процессоре — до подачи на GPU. Смотрим только на то,
  // что меняет игрок и сцена: объекты, положение камеры, солнце, окружение.
  // Разрешение кадра (params[0..1]), игровое время (params[3]) и решётка наполнения
  // (params[48..51]) не в счёт: это меняет сам движок, а не сцена.
  Renderer.prototype.contentChanged = function () {
    var i, n, changed = this.forced || this.primCount !== this.lastCount;

    if (!changed) {
      for (i = 0; i < PARAMS_FLOATS; i++) {
        if (i === PARAMS_TIME) continue;   // время идёт само по себе
        if (i === 0 || i === 1) continue;  // разрешение — не содержимое
        if (i >= PARAMS_MASK) continue;    // решётка наполнения — тоже
        if (this.params[i] !== this.lastParams[i]) { changed = true; break; }
      }
    }

    if (!changed) {
      n = this.primCount * PRIM_FLOATS;
      for (i = 0; i < n; i++) {
        if (this.primData[i] !== this.lastPrims[i]) { changed = true; break; }
      }
    }

    if (!changed) {
      n = this.csgCount * 2;
      for (i = 0; i < n; i++) {
        if (this.csgData[i] !== this.lastCsg[i]) { changed = true; break; }
      }
    }

    if (!changed) return false;

    this.forced = false;
    this.lastParams.set(this.params);
    this.lastCount = this.primCount;
    if (this.primCount > 0) this.lastPrims.set(this.primData.subarray(0, this.primCount * PRIM_FLOATS));
    if (this.csgCount > 0) this.lastCsg.set(this.csgData.subarray(0, this.csgCount * 2));
    return true;
  };

  // значения и примитивы уходят на GPU вместе: сцена меняется между кадрами
  Renderer.prototype.uploadAll = function () {
    var queue = this.device.queue;
    queue.writeBuffer(this.uniformBuffer, 0, this.params);
    if (this.primCount > 0) {
      queue.writeBuffer(this.primBuffer, 0, this.primData, 0, this.primCount * PRIM_FLOATS);
    }
    if (this.csgCount > 0) {
      queue.writeBuffer(this.csgBuffer, 0, this.csgData, 0, this.csgCount * 2);
    }
  };

  // сколько байт буфера примитивов занято — для метрики «cpu → gpu»
  Renderer.prototype.primBytes = function () {
    return this.primCount * PRIM_FLOATS * 4 + this.csgCount * 2 * 4;
  };

  // ---- проходы ------------------------------------------------------------

  // Проход сцены в заданную текстуру. resW/resH — размер кадра, по которому считаются
  // лучи: у прохода наполнения текстура меньше кадра, но точки ложатся в её сетку.
  Renderer.prototype.drawScene = function (encoder, view, w, h, resW, resH, clear, step, ox, oy) {
    this.params[0] = resW;
    this.params[1] = resH;
    this.params[PARAMS_MASK] = step || 1;
    this.params[PARAMS_MASK + 1] = ox || 0;
    this.params[PARAMS_MASK + 2] = oy || 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.params);

    this.renderW = resW;
    this.renderH = resH;

    var timing = this.timing;
    var encoderMarks = !!timing && timing.mode === 'encoder';
    if (encoderMarks) encoder.writeTimestamp(timing.set, 0);

    var pass = encoder.beginRenderPass({
      label: clear ? 'scene' : 'scene (fill)',
      colorAttachments: [{
        view: view,
        clearValue: CLEAR,
        loadOp: clear ? 'clear' : 'load',
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
  };

  // копирование текстуры на экран (или в другую текстуру — при слиянии)
  Renderer.prototype.blit = function (encoder, group, view) {
    var pass = encoder.beginRenderPass({
      label: 'blit',
      colorAttachments: [{
        view: view || this.context.getCurrentTexture().createView(),
        clearValue: CLEAR,
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    pass.setPipeline(this.blitPipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  };

  // слияние: точки своего прохода — из маленькой текстуры, остальное — из собранного
  Renderer.prototype.merge = function (encoder, view, group, step, ox, oy) {
    this.mergeParams[0] = step;
    this.mergeParams[1] = ox;
    this.mergeParams[2] = oy;
    this.mergeParams[3] = 0;
    this.device.queue.writeBuffer(this.mergeBuffer, 0, this.mergeParams);

    var pass = encoder.beginRenderPass({
      label: 'merge',
      colorAttachments: [{ view: view, clearValue: CLEAR, loadOp: 'clear', storeOp: 'store' }]
    });
    pass.setPipeline(this.mergePipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  };

  Renderer.prototype.submit = function (encoder) {
    var t = this.timing;
    if (t) {
      encoder.resolveQuerySet(t.set, 0, 2, t.resolve, 0);
      encoder.copyBufferToBuffer(t.resolve, 0, t.read, 0, 16);
    }
    this.device.queue.submit([encoder.finish()]);
    if (t) this.readTiming();
  };

  // кадр движения: сцена в маленькую текстуру, затем она же растягивается на экран
  Renderer.prototype.render = function () {
    this.ensureTextures();
    var encoder = this.device.createCommandEncoder({ label: 'frame' });
    this.drawScene(encoder, this.viewDyn, this.dynW, this.dynH, this.dynW, this.dynH, true, 1, 0, 0);
    this.blit(encoder, this.bgDyn, null);
    this.submit(encoder);
  };

  // Наполнение статики: шаг решётки step, проход k.
  //
  // Проход 0 — весь кадр сразу крупным пикселем размером в шаг: картинка полная,
  // без дыр и без мутной подложки (дорого не дороже остальных — та же доля 1/step²).
  // Проходы 1…step² — уточнение: каждый кладёт 1/step² точек в полном разрешении.
  // Решётка step = 2 — четыре уточняющих прохода: после двух кадров у кадра вдвое
  // больше точек, чем у одного, после четырёх он собран целиком.
  //
  // Порядок уточнений — не подряд, а с шагом по всей таблице смещений (fillStride):
  // при порядке «подряд» первые проходы добивают верхние строки решётки, и картинка
  // наполняется полосами сверху вниз. С шагом соседние проходы ложатся далеко друг
  // от друга — точки разбрасываются по всему кадру, как на шахматной доске.
  Renderer.prototype.renderFill = function (step, k) {
    this.ensureTextures();
    var s = Math.max(1, Math.round(step || 1));
    var cells = s * s;
    var encoder = this.device.createCommandEncoder({ label: 'fill' });

    if (s === 1) {
      // весь кадр за один проход — решётка не нужна
      this.drawScene(encoder, this.viewA, this.fullW, this.fullH, this.fullW, this.fullH, true, 1, 0, 0);
      this.blit(encoder, this.bgA, null);
      this.submit(encoder);
      return;
    }

    if (k === 0) {
      // первый проход: весь кадр пикселем размером в шаг, затем растяжка на полный
      this.drawScene(encoder, this.viewSmall, this.smallW, this.smallH,
        this.fullW, this.fullH, true, 1, 0, 0);
      this.blit(encoder, this.bgSmall, this.viewA);
      this.blit(encoder, this.bgA, null);
      this.submit(encoder);
      return;
    }

    var i = ((k - 1) * (this.fillStride || 1)) % cells;
    var ox = i % s;
    var oy = Math.floor(i / s);
    var toA = (k % 2) === 0;

    // проход сцены: только своя доля точек, в уменьшенную текстуру
    this.drawScene(encoder, this.viewSmall, this.smallW, this.smallH,
      this.fullW, this.fullH, true, s, ox, oy);

    // слияние: точки ложатся на предыдущий собранный кадр (две текстуры по очереди)
    var acc = (k % 2) === 1 ? this.bgFromA : this.bgFromB;
    this.merge(encoder, toA ? this.viewA : this.viewB, acc, s, ox, oy);

    this.blit(encoder, toA ? this.bgA : this.bgB, null);
    this.submit(encoder);
  };

  // шаг решётки известен заранее: под него пересоздаётся маленькая текстура,
  // и сразу выбирается порядок обхода точек решётки (шаг, взаимно простой с их числом)
  Renderer.prototype.beginFill = function (step) {
    var s = Math.max(1, Math.round(step || 1));
    this.fillStep = s;

    if (s > 1) {
      var cells = s * s;
      var stride = Math.max(1, Math.round(cells * 0.618));
      while (stride < cells && gcd(stride, cells) !== 1) stride += 1;
      this.fillStride = stride < cells ? stride : 1;
    } else {
      this.fillStride = 1;
    }

    this.ensureTextures();
  };

  GE.PARAMS_FLOATS = PARAMS_FLOATS;
  GE.MAX_PRIMS = MAX_PRIMS;
  GE.MAX_CSG = MAX_CSG;
  GE.PRIM_FLOATS = PRIM_FLOATS;
  GE.Renderer = Renderer;
})(window.GE = window.GE || {});
