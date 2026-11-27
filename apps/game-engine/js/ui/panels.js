/* panels.js — панель настроек: выбор сцены, её ползунки, кнопки сцены
   и общие настройки рендера (масштаб кадра, авто-масштаб, тени).
   Сцены знают только свои значения; рендер — только свои. */
(function (GE) {
  'use strict';

  // настройки рендера: одни на все сцены (debug — отладочная строка поверх кадра)
  var GFX_DEFAULTS = { scale: 1, auto: 0, shadows: 1, debug: 1 };

  // масштаб кадра: 0.01 — предел, на котором видно только счётчик работы;
  // 3× и 4× — не для красоты: так проверяют движок за старое слабое устройство
  var SCALES = [
    { value: 0.01, text: '0.01×' },
    { value: 0.05, text: '0.05×' },
    { value: 0.1, text: '0.1×' },
    { value: 0.25, text: '0.25×' },
    { value: 0.5, text: '0.5×' },
    { value: 0.75, text: '0.75×' },
    { value: 1, text: '1×' },
    { value: 1.25, text: '1.25×' },
    { value: 1.5, text: '1.5×' },
    { value: 2, text: '2×' },
    { value: 2.5, text: '2.5×' },
    { value: 3, text: '3×' },
    { value: 4, text: '4×' }
  ];

  var GFX_TOGGLES = [
    { key: 'auto', label: 'game-engine.autoScale', fb: 'auto scale' },
    { key: 'shadows', label: 'game-engine.shadows', fb: 'shadows' },
    { key: 'debug', label: 'game-engine.debug', fb: 'debug overlay' }
  ];

  function Panels() {
    var $ = function (id) { return document.getElementById(id); };

    this.el = {
      bar: $('scene-bar'),
      note: $('scene-note'),
      controls: $('scene-controls'),
      actions: $('scene-actions'),
      status: $('scene-status'),
      gfx: $('gfx-opts')
    };

    this.sliders = [];
    this.toggles = [];
    this.sceneSelect = null;
    this.gfxSelect = null;
    this.gfxBoxes = [];
  }

  // ---- настройки рендера --------------------------------------------------

  Panels.prototype.readGfx = function () {
    return GE.Store.read('gfx', GFX_DEFAULTS);
  };

  Panels.prototype.saveGfx = function (gfx) {
    GE.Store.write('gfx', gfx);
  };

  Panels.prototype.buildGfx = function (gfx, onChange) {
    var host = this.el.gfx;
    if (!host) return;
    var self = this;
    host.textContent = '';
    this.gfxBoxes = [];

    // масштаб рендера: самый быстрый способ разгрузить GPU
    var row = document.createElement('div');
    row.className = 'ctrl ctrl-row';

    var name = document.createElement('span');
    name.setAttribute('data-i18n', 'game-engine.scale');
    name.textContent = GE.t('game-engine.scale', 'render scale');

    var sel = document.createElement('select');
    SCALES.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = String(s.value);
      opt.textContent = s.text;
      sel.appendChild(opt);
    });
    sel.value = String(gfx.scale);
    sel.addEventListener('change', function () {
      gfx.scale = parseFloat(sel.value);
      self.saveGfx(gfx);
      if (onChange) onChange(gfx);
    });
    this.gfxSelect = sel;

    row.appendChild(name);
    row.appendChild(sel);
    host.appendChild(row);

    // переключатели цены кадра
    var tools = document.createElement('div');
    tools.className = 'toggles';

    GFX_TOGGLES.forEach(function (def) {
      var lab = document.createElement('label');
      lab.className = 'toggle';

      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = gfx[def.key] > 0.5;
      box.addEventListener('change', function () {
        gfx[def.key] = box.checked ? 1 : 0;
        self.saveGfx(gfx);
        if (onChange) onChange(gfx);
      });

      var text = document.createElement('span');
      text.setAttribute('data-i18n', def.label);
      text.textContent = GE.t(def.label, def.fb);

      lab.appendChild(box);
      lab.appendChild(text);
      tools.appendChild(lab);

      self.gfxBoxes.push({ key: def.key, box: box });
    });

    host.appendChild(tools);
  };

  Panels.prototype.syncGfx = function (gfx) {
    if (this.gfxSelect) this.gfxSelect.value = String(gfx.scale);
    this.gfxBoxes.forEach(function (t) { t.box.checked = gfx[t.key] > 0.5; });
  };

  // ---- сцены --------------------------------------------------------------

  // список сцен: подпись и выбор; надпись выбранной сцены — под ним
  Panels.prototype.buildSceneList = function (defs, activeId, onChange) {
    var row = this.el.bar;
    row.textContent = '';

    var name = document.createElement('span');
    name.setAttribute('data-i18n', 'game-engine.scene');
    name.textContent = GE.t('game-engine.scene', 'scene');

    var sel = document.createElement('select');
    defs.forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = d.id;
      opt.setAttribute('data-i18n', d.label);
      opt.textContent = GE.t(d.label, d.fb || d.id);
      sel.appendChild(opt);
    });
    sel.value = activeId;
    sel.addEventListener('change', function () { onChange(sel.value); });

    row.appendChild(name);
    row.appendChild(sel);
    this.sceneSelect = sel;
  };

  // настройки сцены из памяти: недостающее — из значений по умолчанию сцены
  Panels.prototype.readScene = function (def) {
    return GE.Store.read('scene.' + def.id, GE.Scenes.defaults(def));
  };

  Panels.prototype.saveScene = function (def, settings) {
    GE.Store.write('scene.' + def.id, settings);
  };

  // ползунки и переключатели этой сцены; actions — её собственные кнопки
  Panels.prototype.buildScene = function (def, settings, inst, onChange) {
    var self = this;
    var host = this.el.controls;
    var i;

    host.textContent = '';
    this.sliders = [];
    this.toggles = [];

    if (this.sceneSelect) this.sceneSelect.value = def.id;
    if (this.el.note) {
      GE.label(this.el.note, def.note, def.noteFb || def.id);
      this.el.note.hidden = !def.note;
    }

    var params = def.params || [];
    for (i = 0; i < params.length; i++) {
      (function (p) {
        var row = document.createElement('label');
        row.className = 'ctrl';

        var top = document.createElement('div');
        top.className = 'ctrl-top';

        var nameEl = document.createElement('span');
        nameEl.setAttribute('data-i18n', p.label);
        nameEl.textContent = GE.t(p.label, p.fb || p.key);

        var val = document.createElement('span');
        val.className = 'ctrl-val';
        val.textContent = p.fmt(settings[p.key]);

        top.appendChild(nameEl);
        top.appendChild(val);

        var input = document.createElement('input');
        input.type = 'range';
        input.min = String(p.min);
        input.max = String(p.max);
        input.step = String(p.step);
        input.value = String(settings[p.key]);
        input.addEventListener('input', function () {
          var v = parseFloat(input.value);
          settings[p.key] = v;
          val.textContent = p.fmt(v);
          self.saveScene(def, settings);
          if (onChange) onChange(def, settings);
        });

        row.appendChild(top);
        row.appendChild(input);
        host.appendChild(row);

        self.sliders.push({ def: p, input: input, val: val });
      })(params[i]);
    }

    var toggles = def.toggles || [];
    if (toggles.length) {
      var tools = document.createElement('div');
      tools.className = 'toggles';

      toggles.forEach(function (t) {
        var lab = document.createElement('label');
        lab.className = 'toggle';

        var box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = settings[t.key] > 0.5;
        box.addEventListener('change', function () {
          settings[t.key] = box.checked ? 1 : 0;
          self.saveScene(def, settings);
          if (onChange) onChange(def, settings);
        });

        var text = document.createElement('span');
        text.setAttribute('data-i18n', t.label);
        text.textContent = GE.t(t.label, t.fb || t.key);

        lab.appendChild(box);
        lab.appendChild(text);
        tools.appendChild(lab);

        self.toggles.push({ key: t.key, box: box });
      });

      host.appendChild(tools);
    }

    // свои кнопки сцены (например, «заполнить сразу» у бенчмарка)
    var hostA = this.el.actions;
    if (hostA) {
      hostA.textContent = '';
      (def.actions || []).forEach(function (a) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ghost';
        btn.setAttribute('data-i18n', a.label);
        btn.textContent = GE.t(a.label, a.fb || a.key);
        btn.addEventListener('click', function () {
          if (typeof a.run === 'function') a.run(inst, settings);
          // действие могло само передвинуть ползунки (например, «заполнить сразу»)
          self.syncScene(def, settings);
          if (self.el.status && inst && inst.status) self.setStatus(inst.status(settings));
        });
        hostA.appendChild(btn);
      });
      hostA.hidden = !(def.actions && def.actions.length);
    }
  };

  // вернуть ползунки к значениям по умолчанию (после «Сброса»)
  Panels.prototype.syncScene = function (def, settings) {
    this.sliders.forEach(function (s) {
      var v = settings[s.def.key];
      s.input.value = String(v);
      s.val.textContent = s.def.fmt(v);
    });
    this.toggles.forEach(function (t) {
      t.box.checked = settings[t.key] > 0.5;
    });
  };

  // состояние сцены одной строкой (сколько сфер, какая скорость…)
  Panels.prototype.setStatus = function (text) {
    if (!this.el.status) return;
    this.el.status.textContent = text || '';
    this.el.status.hidden = !text;
  };

  GE.Panels = Panels;
  GE.GFX_DEFAULTS = GFX_DEFAULTS;
})(window.GE = window.GE || {});
