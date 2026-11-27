/* app.js — точка входа мини-приложения «game engine».
   Здесь только запуск, переключение сцен и цикл кадров: GPU → рендерер → сцена → камера.
   Сами сцены — в js/scene/, настройки рендера — в js/ui/panels.js. */
(function (GE) {
  'use strict';

  var canvas = document.getElementById('gpu-canvas');
  var hud = new GE.HUD();
  var panels = new GE.Panels();

  var renderer = null;
  var camera = null;
  var perf = null;
  var gfx = null;            // настройки рендера, общие для всех сцен
  var active = null;         // { def, settings, inst } — открытая сцена
  var paused = false;
  var frames = 0;
  var uiAt = 0;              // когда последний раз обновляли строку состояния и отладку

  // Ход кадра. dynamic — содержимое меняется: работает авто-масштаб (в движении разрешение
  // сбрасывается, чтобы держать частоту); fill — содержимое застыло и полный кадр
  // дорисовывается по частям (своя доля точек за проход); static — кадр собран целиком,
  // рисовать больше нечего.
  var mode = 'dynamic';
  var dynScale = 1;          // рабочий масштаб движения: к нему возвращаемся из статики
  var warm = 0;              // сколько кадров после смены состояния не идёт в счёт авто-масштаба
  var lastWork = 0;          // цена последнего кадра, мс: что дороже — процессор или видеоядро
  var probeScale = 0;        // масштаб, к которому вернёмся, если проба не влезла (0 — пробы нет)
  var fillSteps = 1;         // шаг решётки наполнения (проходов — fillSteps²)
  var fillK = 0;             // какой проход наполнения рисуем сейчас
  var fullCost = 0;          // во сколько обходится полный кадр, мс (замер наполнения)
  var fillFixed = false;     // план наполнения уже поправлен по первому проходу
  var primsPrev = 0;         // сколько тел было в прошлом кадре

  var SCALE_MIN = 0.01;      // предел авто-масштаба: кадр в единицы пикселей
  var SCALE_MAX = 4;         // верхний предел: 4× — проверка за старое слабое устройство

  // какие старые ползунки переехали в сцену-стенд при миграции
  var LEGACY_SCENE_KEYS = ['sunHeight', 'speed', 'exposure', 'stars', 'grid'];

  function clampScale(v) {
    return Math.min(SCALE_MAX, Math.max(SCALE_MIN, isFinite(v) ? v : 1));
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  // ---- старые настройки одной кучей → две рамки: сцена отдельно, рендер отдельно ----
  function migrate() {
    // авто-масштаб стал включённым по умолчанию: у набора настроек старой версии поля v
    // нет — включаем его один раз, дальше уважаем выбор человека
    var rawGfx = GE.Store.raw('gfx');
    var saved = null;
    try { saved = rawGfx ? JSON.parse(rawGfx) : null; } catch (e) { saved = null; }
    if (!saved || saved.v !== 2) {
      var cur = panels.readGfx();
      cur.auto = 1;
      cur.v = 2;
      panels.saveGfx(cur);
    }

    var raw = GE.Store.raw('settings');
    if (!raw) return;

    var old = null;
    try { old = JSON.parse(raw); } catch (e) { return; }
    if (!old || typeof old !== 'object') return;

    if (!GE.Store.raw('gfx')) {
      var g = panels.readGfx();
      if (isNum(old.scale)) g.scale = clampScale(old.scale);
      if (isNum(old.auto)) g.auto = old.auto > 0.5 ? 1 : 0;
      if (isNum(old.shadows)) g.shadows = old.shadows > 0.5 ? 1 : 0;
      panels.saveGfx(g);
    }

    var demo = GE.Scenes.get('demo');
    if (demo && !GE.Store.raw('scene.demo')) {
      var s = GE.Scenes.defaults(demo);
      for (var i = 0; i < LEGACY_SCENE_KEYS.length; i++) {
        var k = LEGACY_SCENE_KEYS[i];
        if (isNum(old[k]) && (k in s)) s[k] = old[k];
      }
      panels.saveScene(demo, s);
    }

    GE.Store.drop('settings');
  }

  // ---- настройки рендера поменялись: масштаб кадра и замеры заново ----
  function applyGfx() {
    renderer.pixelScale = clampScale(gfx.scale);
    renderer.resize();
    perf.reset();

    // любая смена настроек — снова работаем как обычно и обязательно перерисовываем:
    // размер кадра мог измениться, а разрешение в сверку содержимого не входит
    mode = 'dynamic';
    dynScale = renderer.pixelScale;
    warm = 2;
    fullCost = 0;   // цена полного кадра неизвестна — узнаем в ближайшей статике
    renderer.forceDraw();
  }

  // отладочная строка поверх кадра: коротко и латиницей, чтобы не мешать переводу
  function debugText(counts) {
    var s = perf.stats;
    var gpu = (s.gpu === null || s.gpu === undefined) ? '—' : s.gpu.toFixed(2);
    var occ = s.occ > 0 ? Math.round(s.occ) + '%' : '—';
    var state = mode === 'static' ? ' · idle'
      : (mode === 'fill' ? ' · fill ' + fillK + '/' + (fillSteps * fillSteps) : '');
    var shown = mode === 'dynamic' ? renderer.pixelScale : 1;
    return 'fps ' + s.fps.toFixed(0) + ' · ' + s.avg.toFixed(1) + ' ms\n' +
      'p95 ' + s.p95.toFixed(1) + ' · max ' + s.worst.toFixed(1) + '\n' +
      renderer.renderW + '×' + renderer.renderH + ' · ' +
      shown.toFixed(2) + '× · ' + counts.total + ' prim\n' +
      'cpu ' + s.cpu.toFixed(2) + ' · gpu ' + gpu + ' · core ' + occ + state +
      '\nwork ' + lastWork.toFixed(1) + ' ms · auto ' + (gfx.auto > 0.5 ? 'on' : 'off') +
      (mode !== 'dynamic' ? ' · move back to ' + dynScale.toFixed(2) + '×' : '') +
      (probeScale > 0 ? ' · probe back to ' + probeScale.toFixed(2) + '×' : '');
  }

  // ---- открыть сцену: свой набор объектов, своё окружение, своё положение камеры ----
  function switchScene(id) {
    var def = GE.Scenes.get(id) || GE.Scenes.all()[0];
    var settings = panels.readScene(def);
    var inst = def.create();

    active = { def: def, settings: settings, inst: inst };
    GE.Store.setText('activeScene', def.id);
    hud.setScene(def);

    camera.reset(def.camera);
    perf.reset();
    frames = 0;
    uiAt = 0;

    // новая сцена — снова динамика с выбранного масштаба
    mode = 'dynamic';
    dynScale = clampScale(gfx ? gfx.scale : 1);
    warm = 2;
    fullCost = 0;   // у новой сцены своя цена кадра
    renderer.forceDraw();

    panels.buildScene(def, settings, inst, null);
    renderer.resize();

    // первое обновление: окружение (солнце, яркость) приходит из сохранённых ползунков
    inst.update(0, settings);
    panels.setStatus(inst.status ? inst.status(settings) : '');
  }

  // «Сброс»: ползунки этой сцены и камера — к значениям по умолчанию, замеры заново
  function resetScene() {
    if (!active) return;

    var def = active.def;
    var fresh = GE.Scenes.defaults(def);
    for (var k in fresh) active.settings[k] = fresh[k];
    panels.saveScene(def, active.settings);
    panels.syncScene(def, active.settings);

    active.inst.reset();
    active.inst.update(0, active.settings);
    camera.reset(def.camera);

    perf.reset();
    frames = 0;
    uiAt = 0;
    mode = 'dynamic';
    dynScale = clampScale(gfx ? gfx.scale : 1);
    warm = 2;
    fullCost = 0;
    renderer.forceDraw();
    panels.setStatus(active.inst.status ? active.inst.status(active.settings) : '');
    renderer.resize();
  }

  async function boot() {
    hud.setGpuStatus(GE.t('game-engine.gpuAsking', 'asking for an adapter…'));

    var gpu = await GE.initGPU(canvas);
    hud.setGpuStatus(GE.describeAdapter(gpu.info) + ' · ' + gpu.format);

    renderer = new GE.Renderer(gpu, canvas);
    await renderer.init('./shaders/scene.wgsl');
    renderer.watchSize();

    perf = new GE.Perf(document.getElementById('perf-graph'));
    camera = new GE.Camera();
    GE.attachInput(canvas, camera);

    migrate();
    gfx = panels.readGfx();

    var defs = GE.Scenes.all();
    if (!defs.length) throw new Error('no scenes registered');

    var saved = GE.Store.text('activeScene', '');
    var startId = GE.Scenes.get(saved) ? saved : defs[0].id;

    panels.buildGfx(gfx, applyGfx);
    panels.buildSceneList(defs, startId, switchScene);

    switchScene(startId);
    applyGfx();

    hud.onPause(function (value) { paused = value; });
    hud.onReset(resetScene);

    var last = performance.now();
    var lastBusy = 0;      // сколько последний кадр занимал видеоядро, мс (для панели)
    var lastInt = 16.7;    // интервал прошлого нарисованного кадра, мс
    var intScale = 1;      // на каком масштабе он был измерен

    // Какой шаг решётки нужен, чтобы полный кадр собрался без зависания.
    // Цена кадра движения измерена, полный кадр дороже по площади в 1/масштаб² раз.
    function planFill() {
      var s = Math.max(renderer.pixelScale, SCALE_MIN);
      var cost = Math.max(lastBusy, lastInt) / (s * s);   // цена полного кадра, мс
      // проход берёт 1/step² точек кадра: во сколько раз полный кадр дороже бюджета,
      // во столько раз мельче решётка (шаг 2 — четверти, шаг 3 — девятые и т.д.)
      var step = Math.ceil(Math.sqrt(cost / WORK_PASS));
      return Math.min(FILL_SIDE_MAX, Math.max(1, step));
    }

    // Авто-масштаб решает по интервалу между кадрами — и только по нему.
    //
    // Почему не по времени ядра: очередь сообщает о готовности кадра синхронно с показом,
    // и любое измерение «от подачи до готовности» получает пол в один период экрана.
    // На быстрой видеокарте лёгкий и средний кадр дают одно и то же число, по нему
    // разрешение опускалось до предела (та самая история с 0.17×), а подъём — когда
    // порог стоял ниже этого пола — не срабатывал никогда.
    //
    // Интервал же ограничен снизу обновлением экрана: уложился в него — интервал ровно
    // один период, не уложился — сразу два. Эта ступенька и есть настоящий сигнал «влезает».
    // Поэтому шаг вверх — ПРОБА: подняли масштаб, посмотрели следующий интервал; если
    // промахнулись — возвращаемся и запоминаем, что выше этого масштаба лучше не лезть,
    // пока не изменится нагрузка.
    var dynT = 0, dynSum = 0, dynN = 0;
    var vsyncMs = 16.7;   // период обновления экрана: меньшее из виденных значений
    var WORK_PASS = 100;     // мс: сколько может стоить один проход наполнения
    var FILL_SIDE_MAX = 12;  // потолок шага решётки: 12·12 = 144 прохода, мельче незачем
    var probeAt = 0;      // масштаб до пробы (0 — пробы нет)
    var blocked = 0;      // на этом масштабе уже не влезало: снова не пробуем
    var blockedPrims = -1;
    var downFrom = 0;     // масштаб до последнего шага вниз
    var downAvg = 0;      // какой интервал заставил этот шаг сделать
    var downBlocked = false;   // снижение больше не помогает — вниз не идём

    function adapt(intervalMs, dynamic, prims) {
      if (!(gfx.auto > 0.5) || !dynamic || !(intervalMs > 0)) {
        dynT = 0; dynSum = 0; dynN = 0;
        return;
      }

      // самый короткий интервал и есть период экрана; ниже 6 мс не опускаемся —
      // туда попадают совпавшие метки времени, а не настоящие кадры
      if (intervalMs < vsyncMs && intervalMs > 5) vsyncMs = intervalMs;

      // первые кадры после смены состояния (возврат из статики, смена масштаба)
      // длиннее обычных: новый размер полотна, новая текстура — их не считаем
      if (warm > 0) { warm -= 1; return; }

      // нагрузка сменилась — старый предел больше не указ
      if (prims !== blockedPrims) {
        blocked = 0; blockedPrims = prims;
        downFrom = 0; downBlocked = false;
      }

      dynT += intervalMs / 1000;
      dynSum += intervalMs;
      dynN += 1;
      if (dynT < 0.4) return;

      var avg = dynSum / dynN;
      dynT = 0; dynSum = 0; dynN = 0;

      var slow = vsyncMs * 1.2;   // кадр уже не помещается в обновление экрана
      var fast = vsyncMs * 1.03;  // кадр уложился в обновление с запасом
      // выше выбранного масштаба авто-масштаб не поднимается: ползунок — это потолок
      // качества, а не только стартовая точка
      var ceil = gfx.auto > 0.5 ? Math.max(1, clampScale(gfx.scale)) : renderer.pixelScale;
      var before = renderer.pixelScale;

      if (avg > slow) {
        if (probeAt > 0) {
          // проба не влезла: назад, и выше этого масштаба не лезем
          blocked = before;
          blockedPrims = prims;
          renderer.pixelScale = probeAt;
          probeAt = 0;
        } else if (before > SCALE_MIN && !downBlocked) {
          if (downFrom > 0 && avg > downAvg * 0.85) {
            // прошлый шаг вниз на 30% не дал даже 15% выигрыша — значит дело не в
            // разрешении (столько стоит сам кадр). Возвращаем картинку покрупнее
            // и вниз больше не идём, пока не сменится нагрузка
            renderer.pixelScale = downFrom;
            downFrom = 0;
            downBlocked = true;
          } else {
            // просто тяжело: снижаем сразу настолько, насколько перегружены — цена
            // кадра растёт как площадь, поэтому √(цель/сейчас) и есть нужное отношение.
            // Шаг не более ×0.4 за раз: иначе случайный тяжёлый кадр уронит картинку.
            // Но перегруз вчетверо и больше — это уже не случайность: сразу туда, где влезает
            var fit = Math.sqrt(vsyncMs / avg) * 0.9;
            var floor = avg > vsyncMs * 4 ? 0.05 : 0.4;
            downFrom = before;
            downAvg = avg;
            renderer.pixelScale = Math.max(SCALE_MIN, before * Math.max(fit, floor));
            blocked = 0;
          }
        }
      } else if (avg <= fast && before < ceil - 0.001) {
        var next = Math.min(ceil, before * 1.25);
        if (!(blocked > 0 && next >= blocked * 0.98)) {
          probeAt = before;   // вернёмся сюда, если не влезет
          renderer.pixelScale = next;
        }
      } else {
        downFrom = 0;   // влезло — история шага вниз больше не нужна
      }

      if (renderer.pixelScale !== before) {
        dynScale = renderer.pixelScale;
        probeScale = probeAt;
        renderer.resize();
        warm = 2;   // кадр с новым размером текстуры в счёт не идёт
      }
    }

    function step(now) {
      var rawMs = now - last;
      last = now;
      // честный интервал: fps не врёт на тяжёлых кадрах
      var rawSec = Math.min(Math.max(rawMs / 1000, 0), 2);
      // шаг сцены — реальное время кадра, без обрезки: если кадр рисуется 140 мс,
      // сцена за эти 140 мс и сдвинется, иначе движение замедляется вместе с fps.
      // Потолок в 2 с — только страховка от возврата на вкладку и от сна машины
      var dt = rawSec;
      var t0 = performance.now();

      hud.tick(rawSec);

      // размер полотна мог измениться (окно, поворот экрана): подгоняем буфер кадра,
      // и если он действительно поменялся — старую картинку надо перерисовать
      if (renderer.resize()) renderer.forceDraw();

      // камера живая всегда; на паузе сцена замирает, но ползунки продолжают работать
      camera.update(dt);
      active.inst.update(paused ? 0 : dt, active.settings);

      var counts = GE.writeFrame(renderer, active.inst, camera, gfx);

      // ---- что рисуем в этом кадре -----------------------------------------------
      // Сверка содержимого на процессоре: объекты, камера, солнце, окружение.
      // Разрешение и игровое время в неё не входят — они меняются сами по себе.
      var changed = renderer.contentChanged();
      var draw = changed;

      if (changed) {
        if (mode !== 'dynamic') {
          // содержимое снова меняется: назад к рабочему масштабу движения — МГНОВЕННО,
          // одним кадром и без ступеней: движение не должно догонять разрешение.
          // Но если полный кадр не влезает в обновление экрана, начинать с него нельзя:
          // первые кадры движения стоили бы секунды. Тогда стартуем с того масштаба,
          // который в обновление влезает (цена кадра растёт как площадь).
          if (fullCost > 0) {
            var fit = Math.sqrt(vsyncMs / fullCost);
            if (fit < dynScale) dynScale = clampScale(fit);
          }
          mode = 'dynamic';
          warm = 2;
          perf.reset();   // замеры заново, без промежуточных и статичных кадров
          if (renderer.pixelScale !== dynScale) { renderer.pixelScale = dynScale; renderer.resize(); }
        }

        // Резко прибавилось тел (нажали «заполнить сразу», сдвинули куб, сменили сцену):
        // цена кадра растёт как число тел × площадь, поэтому в прежнем разрешении
        // один такой кадр мог бы подвесить телефон на секунды. Опускаем разрешение
        // по числу тел (не ниже десятой доли) — авто-масштаб потом поднимет обратно.
        if (counts.total > primsPrev * 2 && counts.total > 256) {
          var keep = Math.max(0.1, Math.sqrt(primsPrev / counts.total));
          var fitPrims = clampScale(renderer.pixelScale * keep);
          if (fitPrims < dynScale) dynScale = fitPrims;
          if (renderer.pixelScale > fitPrims) { renderer.pixelScale = fitPrims; renderer.resize(); }
        }
      } else if (mode === 'dynamic') {
        // содержимое застыло: запоминаем рабочий масштаб движения и начинаем наполнение
        dynScale = renderer.pixelScale;
        fillSteps = planFill();
        fillK = 0;
        fillFixed = false;
        mode = 'fill';
        renderer.beginFill(fillSteps);
      }

      // Наполнение статики: полотно уже полного размера, но кадр в нём собран ещё не
      // весь. Каждый проход кладёт свою долю точек (каждую fillSteps-ю — в шахматном
      // порядке), остальные добираются следующими проходами: два прохода — вдвое больше
      // точек, чем в одном кадре, и так до целого кадра. Никаких видимых полос: доли
      // не складываются в ленту, а перемешиваются по всей площади сразу.
      if (mode === 'fill') {
        // Цена прошлого прохода × число проходов = цена целого кадра.
        // Первый проход — ещё и проверка плана: у малого масштаба замер упирается
        // в частоту экрана и завышает цену, а на слабом устройстве может наоборот
        // оказаться тяжёлым. Не сошлось — пересчитываем решётку и начинаем заново.
        if (fillK > 0 && lastBusy > 0) {
          var full = lastBusy * fillSteps * fillSteps;
          if (fillK === 1 && !fillFixed) {
            fillFixed = true;   // одна поправка на одно застывание
            var want = Math.min(FILL_SIDE_MAX,
              Math.max(1, Math.ceil(Math.sqrt(full / WORK_PASS))));
            if (want !== fillSteps) {
              fillSteps = want;
              fillK = 0;
              renderer.beginFill(fillSteps);
            }
          }
          fullCost = full;
        }
        // значения и примитивы не меняются — их уже послали в кадре застывания,
        // а решётку прохода рендерер пишет сам: лишние 1.5 МБ на проход ни к чему
        renderer.renderFill(fillSteps, fillK);
        fillK += 1;
        draw = true;
        if (fillK >= fillSteps * fillSteps) mode = 'static';   // кадр собран целиком
      } else if (draw) {
        renderer.uploadAll();
        renderer.render();
      }

      if (draw) frames += 1;

      // статистика: интервал между кадрами, занятость процессора, время GPU.
      // Не рисовали — пишем нулевую занятость ядра, чтобы это было видно в панели.
      var cpuMs = performance.now() - t0;
      lastWork = Math.max(cpuMs, lastBusy);
      if (draw) { lastInt = rawMs; intScale = renderer.pixelScale; }
      if (document.visibilityState !== 'hidden') {
        perf.push(rawMs, cpuMs, draw ? renderer.gpuMs() : null,
          counts.total, renderer.renderW * renderer.renderH,
          draw ? lastBusy : 0, draw ? 1 : 0);
      }
      perf.draw();

      // строки состояния и цифры обновляем пять раз в секунду: в статике это вся работа
      var nowT = performance.now();
      if (nowT - uiAt >= 200) {
        uiAt = nowT;
        hud.setInfo(renderer.renderW, renderer.renderH, frames,
          counts.total, renderer.primBytes());
        hud.setPerf(perf.stats, mode === 'dynamic' ? renderer.pixelScale : 1);
        if (active.inst.status) panels.setStatus(active.inst.status(active.settings));
        hud.setDebug(gfx.debug > 0.5 ? debugText(counts) : '');
      }

      primsPrev = counts.total;
      adapt(rawMs, changed, counts.total);
      return draw;
    }

    // ---- подача кадра: один кадр в полёте на видеокарте ----
    // Подавать кадр каждый тик экрана нельзя: при кадре в 140 мс цикл на 60 Гц набирал
    // бы минуты отложенной работы в очереди, видеоядро занято на 100% и вместе с ним
    // встаёт весь компьютер и интерфейс телефона. Поэтому процессор ждёт, пока поданный
    // кадр выполнится, — очередь не растёт, а камера, ползунки и меню остаются живыми.
    var busy = false;   // кадр подан, но ещё не выполнен

    // Простой после кадра: настройка «core limit» разрешает шейдеру занимать ядро
    // не всё время. Внутри кадра работа не дробится — прервать шейдер нельзя, но между
    // кадрами железо отдыхает, и вместе с ним дышат композитор, меню и вся система.
    // 50% — кадр и простой равны, занятость ядра падает вдвое.
    function idleFor(busyMs, duty) {
      var d = (typeof duty === 'number' && duty > 0 && duty < 1) ? duty : 1;
      if (d >= 1) return 0;
      return busyMs * (1 / d - 1);
    }

    function nextFrame() {
      requestAnimationFrame(frame);
    }

    // ошибка в кадре не должна молча убивать цикл: показываем её и останавливаемся
    function frame(now) {
      if (busy) { nextFrame(); return; }

      var drew = false;
      try {
        drew = step(now);
      } catch (err) {
        console.error(err);
        hud.fail(err);
        return;
      }

      // ничего не подавали — ждать нечего: сразу к следующей проверке
      if (!drew) { lastBusy = 0; nextFrame(); return; }

      // ждём именно этот кадр: onSubmittedWorkDone срабатывает, когда очередь опустела
      var queue = gpu.device.queue;
      if (typeof queue.onSubmittedWorkDone !== 'function') {
        nextFrame();
        return;
      }

      busy = true;
      var sentAt = performance.now();

      function done() {
        busy = false;
        lastBusy = performance.now() - sentAt;   // столько кадр занимал видеоядро
        var wait = idleFor(lastBusy, gfx.duty);
        if (wait > 1) setTimeout(nextFrame, wait);   // простой: ядро свободно для других
        else nextFrame();
      }

      // устройство потеряно или ждать нечего — цикл всё равно продолжаем
      queue.onSubmittedWorkDone().then(done, done);
    }

    // вернулись на вкладку — начинаем мерить заново и перерисовываем
    document.addEventListener('visibilitychange', function () {
      last = performance.now();
      perf.reset();
      renderer.forceDraw();
    });

    requestAnimationFrame(frame);

    if (gpu.device.lost && gpu.device.lost.then) {
      gpu.device.lost.then(function (info) {
        hud.fail(new Error(GE.t('game-engine.errLost', 'GPU device lost') + ': ' +
          ((info && (info.message || info.reason)) || '?')));
      });
    }
  }

  boot().catch(function (err) {
    console.error(err);
    hud.fail(err);
  });
})(window.GE = window.GE || {});
