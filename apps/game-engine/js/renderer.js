/* renderer.js — вся обвязка WebGPU: пайплайн, буферы, текстура, отрисовка кадра.
   Про игру ничего не знает: получает Float32Array и рисует. */
(function (GE) {
  'use strict';

  var PARAMS_FLOATS = 16; // 16 × f32 = 64 байта, см. shaders/params.wgsl

  function Renderer(gpu, canvas) {
    this.gpu = gpu;
    this.canvas = canvas;
    this.device = gpu.device;
    this.context = gpu.context;
    this.format = gpu.format;

    this.params = new Float32Array(PARAMS_FLOATS);
    this.maxPixelWidth = 3840;
  }

  Renderer.prototype.init = async function (shaderUrl) {
    var device = this.device;
    var self = this;

    var code = await GE.loadShader(shaderUrl || './shaders/render.wgsl');
    var module = device.createShaderModule({ code: code, label: 'render.wgsl' });
    await GE.assertCompiles(module, 'render.wgsl');

    this.pipeline = device.createRenderPipeline({
      label: 'scene',
      layout: 'auto',
      vertex: { module: module, entryPoint: 'vs_main' },
      fragment: { module: module, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' }
    });

    // значения с процессора
    this.uniformBuffer = device.createBuffer({
      label: 'params (uniform)',
      size: PARAMS_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    // текстура, которую целиком считает процессор
    var size = GE.TEX_SIZE;
    this.texture = device.createTexture({
      label: 'procedural texture (CPU)',
      size: [size, size],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    device.queue.writeTexture(
      { texture: this.texture },
      GE.makeTextureData(size),
      { bytesPerRow: size * 4, rowsPerImage: size },
      { width: size, height: size }
    );
    this.textureView = this.texture.createView();

    this.sampler = device.createSampler({
      label: 'repeat linear',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat'
    });

    this.bindGroup = device.createBindGroup({
      label: 'scene bindings',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.textureView },
        { binding: 2, resource: this.sampler }
      ]
    });

    this.uploadParams();
    return self;
  };

  // подгоняем размер канваса под CSS-размер (с учётом плотности пикселей)
  Renderer.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(1, Math.min(this.maxPixelWidth, Math.floor(rect.width * dpr)));
    var h = Math.max(1, Math.floor((rect.height || rect.width * 0.5625) * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  };

  Renderer.prototype.uploadParams = function () {
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.params);
  };

  Renderer.prototype.render = function () {
    if (!this.canvas.width || !this.canvas.height) return;

    var encoder = this.device.createCommandEncoder({ label: 'frame' });
    var pass = encoder.beginRenderPass({
      label: 'scene pass',
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.02, g: 0.03, b: 0.04, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
  };

  GE.PARAMS_FLOATS = PARAMS_FLOATS;
  GE.Renderer = Renderer;
})(window.GE = window.GE || {});
