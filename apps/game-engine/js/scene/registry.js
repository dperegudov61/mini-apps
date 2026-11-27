/* registry.js — реестр сцен и заготовки их ползунков.
   Сцена — это описание (имя, камера, свой набор ползунков и переключателей)
   плюс фабрика create(): она собирает живой набор объектов.
   Всё, что относится к сцене, живёт здесь и в scene/*.js; настройки рендера — отдельно. */
(function (GE) {
  'use strict';

  var list = [];
  var byId = {};

  // как показывать число рядом с ползунком
  var FMT = {
    deg: function (v) { return v.toFixed(0) + '°'; },
    times: function (v) { return v.toFixed(2) + '×'; },
    plain: function (v) { return v.toFixed(2); },
    rate: function (v) { return v.toFixed(0) + '/s'; }
  };

  function num(v, def) {
    return (typeof v === 'number' && isFinite(v)) ? v : def;
  }

  // заготовки общих ползунков: каждая сцена собирает из них свой набор
  var Parts = {
    sun: function (def) {
      return { key: 'sunHeight', label: 'game-engine.sunHeight', fb: 'sun height',
        min: -90, max: 90, step: 1, def: num(def, 30), fmt: FMT.deg };
    },
    exposure: function (def) {
      return { key: 'exposure', label: 'game-engine.exposure', fb: 'brightness',
        min: 0.35, max: 2.2, step: 0.02, def: num(def, 1), fmt: FMT.plain };
    },
    speed: function (def) {
      return { key: 'speed', label: 'game-engine.speed', fb: 'animation speed',
        min: 0, max: 3, step: 0.02, def: num(def, 1), fmt: FMT.times };
    },
    rate: function (def) {
      // 0 — сцена сама не растёт: число тел задаёт ползунок «объектов» (так видно зависимость)
      return { key: 'rate', label: 'game-engine.benchRate', fb: 'spheres per second',
        min: 0, max: 100, step: 1, def: num(def, 0), fmt: FMT.rate };
    },
    // точное число тел: ползунок даёт прямую зависимость «количество → время кадра»
    count: function (def, max) {
      return { key: 'count', label: 'game-engine.benchCount', fb: 'objects',
        min: 0, max: (typeof max === 'number' ? max : 4096), step: 1, def: num(def, 0),
        fmt: function (v) { return String(Math.round(v)); } };
    },
    stars: function (def) {
      return { key: 'stars', label: 'game-engine.stars', fb: 'stars', def: num(def, 1) };
    },
    grid: function (def) {
      return { key: 'grid', label: 'game-engine.grid', fb: 'floor grid', def: num(def, 1) };
    }
  };

  // значения по умолчанию: из ползунков и переключателей описания сцены
  function defaults(def) {
    var out = {};
    var i;
    var params = def.params || [];
    var toggles = def.toggles || [];
    for (i = 0; i < params.length; i++) out[params[i].key] = params[i].def;
    for (i = 0; i < toggles.length; i++) out[toggles[i].key] = toggles[i].def;
    return out;
  }

  GE.SceneFmt = FMT;
  GE.SceneParts = Parts;

  GE.Scenes = {
    // порядок вызова define() — порядок сцен в списке на странице
    define: function (def) {
      if (!def || !def.id) throw new Error('scene: нужен id');
      if (byId[def.id]) throw new Error('scene: ' + def.id + ' уже объявлена');
      if (typeof def.create !== 'function') throw new Error('scene: ' + def.id + ': нужна create()');
      byId[def.id] = def;
      list.push(def);
      return def;
    },
    get: function (id) { return byId[id] || null; },
    all: function () { return list.slice(); },
    firstId: function () { return list.length ? list[0].id : null; },
    defaults: defaults
  };
})(window.GE = window.GE || {});
