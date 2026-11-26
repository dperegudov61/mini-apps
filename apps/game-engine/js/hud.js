/* hud.js — работа с DOM: слайдеры, метрики, вывод проверок, сообщение об ошибке.
   Настройки слайдеров запоминаются в localStorage под префиксом приложения. */
(function (GE) {
  'use strict';

  var SETTINGS_KEY = 'miniapps.game-engine.settings';

  var DEFAULTS = { speed: 1, mouseForce: 0.35, texMix: 0.5, hue: 0.55 };

  var SLIDERS = [
    { key: 'speed', label: 'game-engine.speed', fb: 'logic speed', min: 0, max: 3, step: 0.02, fmt: function (v) { return v.toFixed(2) + '×'; } },
    { key: 'mouseForce', label: 'game-engine.mouse', fb: 'mouse pull', min: 0, max: 1, step: 0.01, fmt: function (v) { return v.toFixed(2); } },
    { key: 'texMix', label: 'game-engine.texmix', fb: 'texture mix', min: 0, max: 1.5, step: 0.01, fmt: function (v) { return v.toFixed(2); } },
    { key: 'hue', label: 'game-engine.hue', fb: 'palette shift', min: 0, max: 1, step: 0.005, fmt: function (v) { return v.toFixed(3); } }
  ];

  function readSettings() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { saved = null; }
    var out = {};
    for (var k in DEFAULTS) {
      out[k] = (saved && typeof saved[k] === 'number' && isFinite(saved[k])) ? saved[k] : DEFAULTS[k];
    }
    return out;
  }

  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* приватный режим */ }
  }

  function HUD() {
    var $ = function (id) { return document.getElementById(id); };

    this.el = {
      gpuInfo: $('gpu-info'),
      frameSize: $('frame-size'),
      overlay: $('overlay'),
      fps: $('m-fps'),
      frame: $('m-frame'),
      res: $('m-res'),
      up: $('m-up'),
      controls: $('controls'),
      tests: $('tests'),
      btnTest: $('btn-test'),
      btnPause: $('btn-pause'),
      btnReset: $('btn-reset'),
      note: $('note')
    };

    this.settings = readSettings();
    this.sliders = [];
    this._acc = 0;
    this._frames = 0;
    this._paused = false;
    this._onTest = null;
    this._onPause = null;
    this._onReset = null;

    var self = this;

    this.el.btnTest.addEventListener('click', function () { if (self._onTest) self._onTest(); });
    this.el.btnPause.addEventListener('click', function () { self.togglePause(); });
    this.el.btnReset.addEventListener('click', function () { self.resetAll(); });

    this.el.up.textContent = '16 float · 64 B';
    this.setEmpty(GE.t('game-engine.empty', 'the check has not run yet'));
  }

  HUD.prototype.setGpuStatus = function (text) {
    if (this.el.gpuInfo) this.el.gpuInfo.textContent = 'GPU: ' + text;
  };

  HUD.prototype.onTest = function (cb) { this._onTest = cb; };
  HUD.prototype.onPause = function (cb) { this._onPause = cb; };
  HUD.prototype.onReset = function (cb) { this._onReset = cb; };

  HUD.prototype.buildControls = function () {
    var host = this.el.controls;
    var self = this;
    host.textContent = '';
    this.sliders = [];

    SLIDERS.forEach(function (def) {
      var row = document.createElement('label');
      row.className = 'ctrl';

      var top = document.createElement('div');
      top.className = 'ctrl-top';

      var name = document.createElement('span');
      name.setAttribute('data-i18n', def.label);
      name.textContent = GE.t(def.label, def.fb);

      var val = document.createElement('span');
      val.className = 'ctrl-val';
      val.textContent = def.fmt(self.settings[def.key]);

      top.appendChild(name);
      top.appendChild(val);

      var input = document.createElement('input');
      input.type = 'range';
      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step);
      input.value = String(self.settings[def.key]);
      input.addEventListener('input', function () {
        var v = parseFloat(input.value);
        self.settings[def.key] = v;
        val.textContent = def.fmt(v);
        saveSettings(self.settings);
      });

      row.appendChild(top);
      row.appendChild(input);
      host.appendChild(row);

      self.sliders.push({ def: def, input: input, val: val });
    });

    return this.settings;
  };

  HUD.prototype.syncControls = function () {
    var self = this;
    this.sliders.forEach(function (s) {
      var v = self.settings[s.def.key];
      s.input.value = String(v);
      s.val.textContent = s.def.fmt(v);
    });
  };

  HUD.prototype.resetAll = function () {
    for (var k in DEFAULTS) this.settings[k] = DEFAULTS[k];
    saveSettings(this.settings);
    this.syncControls();
    if (this._onReset) this._onReset();
  };

  HUD.prototype.togglePause = function () {
    this._paused = !this._paused;
    GE.label(this.el.btnPause, this._paused ? 'game-engine.resume' : 'game-engine.pause',
      this._paused ? 'Resume' : 'Pause');
    this.el.btnPause.classList.toggle('on', this._paused);
    if (this._onPause) this._onPause(this._paused);
  };

  HUD.prototype.setTesting = function (on) {
    this.el.btnTest.disabled = on;
    GE.label(this.el.btnTest, on ? 'game-engine.checking' : 'game-engine.run', on ? 'Checking…' : 'Run check');
  };

  HUD.prototype.setEmpty = function (text) {
    var host = this.el.tests;
    host.textContent = '';
    var row = document.createElement('div');
    row.className = 'test-row empty';
    row.textContent = text;
    host.appendChild(row);
  };

  HUD.prototype.setTests = function (results) {
    var host = this.el.tests;
    host.textContent = '';
    var allOk = true;

    results.forEach(function (r) {
      if (!r.ok) allOk = false;

      var row = document.createElement('div');
      row.className = 'test-row ' + (r.ok ? 'ok' : 'bad');

      var mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = r.ok ? '✓' : '✕';

      var body = document.createElement('div');
      body.className = 'test-body';

      var name = document.createElement('div');
      name.className = 'test-name';
      name.textContent = r.name;

      var detail = document.createElement('div');
      detail.className = 'test-detail';
      detail.textContent = r.detail || '';

      body.appendChild(name);
      body.appendChild(detail);
      row.appendChild(mark);
      row.appendChild(body);
      host.appendChild(row);
    });

    var sum = document.createElement('div');
    sum.className = 'test-sum ' + (allOk ? 'ok' : 'bad');
    sum.textContent = allOk
      ? GE.t('game-engine.sumOk', 'shaders launched, the frame is drawn')
      : GE.t('game-engine.sumBad', 'a shader did not launch — see the rows above');
    host.appendChild(sum);
  };

  HUD.prototype.setInfo = function (w, h, frame) {
    this.el.res.textContent = w + '×' + h;
    this.el.frameSize.textContent = w + '×' + h;
    this.el.frame.textContent = String(frame);
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
  GE.HUD_DEFAULTS = DEFAULTS;
})(window.GE = window.GE || {});
