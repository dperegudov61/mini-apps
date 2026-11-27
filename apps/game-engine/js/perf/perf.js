/* perf.js — инструменты отладки производительности.
   Собирает время кадра (интервал между кадрами), время работы процессора и (если браузер
   дал timestamp-query) время прохода на GPU. Рисует график и считает статистику.
   Ничего не знает про сцену и рендерер: получает числа от app.js. */
(function (GE) {
  'use strict';

  var CAP = 180;   // сколько кадров помним: ≈3 с при 60 fps

  function Perf(graphCanvas) {
    this.canvas = graphCanvas || null;
    this.ctx = this.canvas && this.canvas.getContext ? this.canvas.getContext('2d') : null;

    this.interval = new Float32Array(CAP);   // интервал между кадрами, мс
    this.cpu = new Float32Array(CAP);        // сколько процессор потратил, мс
    this.gpu = new Float32Array(CAP);        // время прохода на GPU, мс (-1 = нет данных)
    this.prims = new Float32Array(CAP);      // тел в сцене: вторая кривая графика
    this.pixels = new Float32Array(CAP);     // пикселей в кадре
    this.busy = new Float32Array(CAP);       // сколько кадр занимал видеоядро, мс
    this.drawn = new Uint8Array(CAP);        // 1 — кадр рисовали, 0 — картинка не изменилась
    this.head = 0;
    this.count = 0;
    this.skip = 3;   // сколько первых кадров не считать (компиляция шейдера и т.п.)

    this.stats = { fps: 0, avg: 0, best: 0, worst: 0, p95: 0, cpu: 0, gpu: null,
      prims: 0, maxPrims: 0, mpx: 0, msPerMpx: 0, occ: 0, idle: 0 };

    this._colors = null;
    this._colorsAt = 0;
    this._lastDraw = 0;
  }

  // intervalMs — честный интервал между кадрами, cpuMs — занятость JS в кадре,
  // gpuMs — измеренное время прохода (null, если измерение недоступно),
  // prims — тел в сцене, pixels — пикселей в кадре (для «мс на мегапиксель»),
  // busyMs — сколько кадр занимал видеоядро по часам (от подачи до готовности),
  // drawn — 1, если кадр действительно рисовали (0 — картинка не изменилась)
  Perf.prototype.push = function (intervalMs, cpuMs, gpuMs, prims, pixels, busyMs, drawn) {
    // первые кадры после сброса — компиляция шейдера и первый показ кадра; они
    // в сотни раз длиннее обычных и испортили бы среднее и p95
    if (this.skip > 0) {
      this.skip -= 1;
      return;
    }

    // меньше 4 мс — это не кадр, а совпавшие метки времени: такой замер пропускаем,
    // иначе «лучший кадр» и среднее врут
    if (!(intervalMs >= 4)) return;

    var i = this.head;
    this.interval[i] = intervalMs;
    this.cpu[i] = cpuMs > 0 ? cpuMs : 0;
    this.gpu[i] = (typeof gpuMs === 'number' && gpuMs > 0) ? gpuMs : -1;
    this.prims[i] = prims > 0 ? prims : 0;
    this.pixels[i] = pixels > 0 ? pixels : 0;
    this.busy[i] = (typeof busyMs === 'number' && busyMs > 0) ? Math.min(busyMs, intervalMs) : 0;
    this.drawn[i] = (drawn === undefined || drawn > 0) ? 1 : 0;
    this.lastPrims = this.prims[i];

    this.head = (i + 1) % CAP;
    if (this.count < CAP) this.count += 1;
    this.recalc();
  };

  Perf.prototype.reset = function () {
    this.head = 0;
    this.count = 0;
    this.skip = 3;   // после сброса пропускаем первый медленный кадр компиляции
    this.stats = { fps: 0, avg: 0, best: 0, worst: 0, p95: 0, cpu: 0, gpu: null,
      prims: 0, maxPrims: 0, mpx: 0, msPerMpx: 0, occ: 0, idle: 0 };
  };

  // первый индекс кольца (самый старый из запомненных кадров)
  Perf.prototype.oldest = function () {
    return (this.head - this.count + CAP * 2) % CAP;
  };

  Perf.prototype.recalc = function () {
    var n = this.count;
    if (!n) return;

    var sum = 0, cpuSum = 0, gpuSum = 0, gpuN = 0, primSum = 0, maxPrims = 0, lastPixels = 0;
    var busySum = 0;
    var drawnSum = 0;
    var best = 1e9, worst = 0;
    var vals = new Array(n);

    for (var k = 0; k < n; k++) {
      var i = (this.oldest() + k) % CAP;
      var v = this.interval[i];
      vals[k] = v;
      sum += v;
      cpuSum += this.cpu[i];
      busySum += this.busy[i];
      drawnSum += this.drawn[i];
      primSum += this.prims[i];
      if (this.prims[i] > maxPrims) maxPrims = this.prims[i];
      if (v < best) best = v;
      if (v > worst) worst = v;
      if (this.gpu[i] > 0) { gpuSum += this.gpu[i]; gpuN += 1; }
      if (this.pixels[i] > 0) lastPixels = this.pixels[i];
    }

    vals.sort(function (a, b) { return a - b; });
    var p95 = vals[Math.min(n - 1, Math.floor(n * 0.95))];
    var avg = sum / n;
    var mpx = lastPixels / 1e6;

    this.stats = {
      fps: avg > 0 ? 1000 / avg : 0,
      avg: avg,
      best: best,
      worst: worst,
      p95: p95,
      cpu: cpuSum / n,
      gpu: gpuN ? gpuSum / gpuN : null,
      prims: Math.max(0, this.lastPrims || 0),   // сколько тел сейчас, а не среднее за окно
      maxPrims: maxPrims,
      mpx: mpx,
      // мс на мегапиксель: одна мерка для любой карты и любого масштаба
      msPerMpx: mpx > 0 ? avg / mpx : 0,
      // занятость видео ядра: работа кадра / время от кадра до кадра. 100% — ядро
      // занято всё время, 50% — половину времени оно свободно для всего остального
      occ: avg > 0 ? Math.min(100, (busySum / n) / avg * 100) : 0,
      // доля кадров, на которых ничего не рисовали: 100% — простой, картинка стоит
      idle: (n - drawnSum) / n * 100
    };
  };

  // цвета берём из палитры темы, чтобы работали обе темы
  Perf.prototype.colors = function () {
    var now = Date.now();
    if (!this._colors || now - this._colorsAt > 1000) {
      var cs = getComputedStyle(document.documentElement);
      function pick(name, fallback) {
        var v = cs.getPropertyValue(name).trim();
        return v || fallback;
      }
      this._colors = {
        bg: pick('--panel2', '#101722'),
        line: pick('--line', '#1f2836'),
        cyan: pick('--cyan', '#4de2ff'),
        amber: pick('--amber', '#ffb347'),
        dim: pick('--dim', '#78879a')
      };
      this._colorsAt = now;
    }
    return this._colors;
  };

  // график: по горизонтали кадры, по вертикали миллисекунды
  Perf.prototype.draw = function (force) {
    if (!this.ctx) return;

    var now = performance.now();
    if (!force && now - this._lastDraw < 140) return;   // ≈7 раз в секунду хватает
    this._lastDraw = now;

    var canvas = this.canvas;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var wantW = Math.max(160, Math.round((canvas.clientWidth || 640) * dpr));
    var wantH = Math.max(60, Math.round((canvas.clientHeight || 96) * dpr));
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW;
      canvas.height = wantH;
    }

    var g = this.ctx;
    var W = canvas.width;
    var H = canvas.height;
    var pad = 2 * dpr;
    var c = this.colors();

    g.fillStyle = c.bg;
    g.fillRect(0, 0, W, H);

    // верх шкалы: не меньше 20 мс и не меньше худшего кадра — на 4× кадр бывает
    // в полсекунды, и без такого запаса график был бы прижат к нулю
    var top = Math.max(20, Math.min(4000, this.stats.worst * 1.15));
    function yOf(ms) {
      return H - pad - Math.min(1, ms / top) * (H - pad * 2);
    }

    g.lineWidth = 1 * dpr;
    g.strokeStyle = c.line;
    g.beginPath();
    g.moveTo(0, yOf(16.7));
    g.lineTo(W, yOf(16.7));
    g.stroke();

    g.strokeStyle = c.amber;
    g.setLineDash([4 * dpr, 4 * dpr]);
    g.beginPath();
    g.moveTo(0, yOf(33.3));
    g.lineTo(W, yOf(33.3));
    g.stroke();
    g.setLineDash([]);

    // вторая кривая — число тел в сцене, по своей шкале (видно, как время кадра идёт за количеством)
    if (this.count > 1 && this.stats.maxPrims > 0) {
      var primTop = this.stats.maxPrims;
      g.strokeStyle = c.dim;
      g.lineWidth = 1 * dpr;
      g.beginPath();
      for (var k2 = 0; k2 < this.count; k2++) {
        var i2 = (this.oldest() + k2) % CAP;
        var x2 = (k2 / (CAP - 1)) * W;
        var y2 = H - pad - (this.prims[i2] / primTop) * (H - pad * 2);
        if (k2 === 0) g.moveTo(x2, y2); else g.lineTo(x2, y2);
      }
      g.stroke();
    }

    if (this.count > 1) {
      g.strokeStyle = c.cyan;
      g.lineWidth = 1.5 * dpr;
      g.beginPath();
      for (var k = 0; k < this.count; k++) {
        var i = (this.oldest() + k) % CAP;
        var x = (k / (CAP - 1)) * W;
        var y = yOf(this.interval[i]);
        if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }

    g.fillStyle = c.dim;
    g.font = Math.round(10 * dpr) + 'px ui-monospace, monospace';
    g.fillText('60', 3 * dpr, yOf(16.7) - 2 * dpr);
    g.fillText('30', 3 * dpr, yOf(33.3) - 2 * dpr);
    g.fillText(Math.round(top) + ' ms', W - 44 * dpr, 11 * dpr);
    // справа внизу — верх второй шкалы (число тел)
    if (this.stats.maxPrims > 0) {
      g.fillText(this.stats.maxPrims + ' prim', W - 56 * dpr, H - 3 * dpr);
    }
  };

  GE.Perf = Perf;
  GE.PERF_CAP = CAP;
})(window.GE = window.GE || {});
