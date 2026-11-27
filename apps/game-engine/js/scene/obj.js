/* obj.js — чтение полигональных моделей Wavefront OBJ (и материала MTL) в треугольники.
   Здесь только разбор текста: ни WebGPU, ни сцены. Результат понимает js/scene/mesh.js,
   он же собирает из треугольников буфер для шейдера.

   Что читается:
     v  x y z        — вершины
     vn x y z        — нормали (если есть, они и идут в затенение)
     vt              — не нужны (текстур пока нет), пропускаются
     f  ...          — грани: "i", "i/j", "i//k", "i/j/k", отрицательные индексы,
                       многоугольники разбиваются веером на треугольники
     usemtl / mtllib — имя материала и файл материалов (цвет Kd)
   Что игнорируется: o, g, s (группы и сглаживание), любые прочие строки.

   Разбор одного файла на 3 тыс. треугольников занимает единицы миллисекунд;
   на 200 тыс. — сотни, поэтому грузить такую модель долго (см. README). */
(function (GE) {
  'use strict';

  // индекс OBJ: положительный — с единицы, отрицательный — с конца списка
  function idx(tok, count) {
    var i = +tok;
    return i < 0 ? count + i : i - 1;
  }

  var Obj = {
    // текст OBJ -> { v:[x,y,z,...], vn:[x,y,z,...], faces:[a,b,c,na,nb,nc,mtl,...],
    //                matNames:[...], hasNormals:bool, mtllib:'model.mtl' }
    parse: function (text) {
      var v = [];
      var vn = [];
      var faces = [];
      var matNames = [];
      var matId = {};
      var curMat = 0;
      var hasNormals = false;
      var mtllib = '';
      var lines = text.split('\n');

      for (var i = 0; i < lines.length; i++) {
        var s = lines[i];
        if (s.length < 2) continue;

        // --- вершины и нормали: 'v ', 'vn' (vt пропускаем) ---
        if (s.charCodeAt(0) === 118) {       // 'v'
          var c1 = s.charCodeAt(1);
          if (c1 === 32 || c1 === 9) {
            var p = s.slice(2).split(/\s+/);
            v.push(+p[0], +p[1], +p[2]);
            continue;
          }
          if (c1 === 110) {                  // 'vn'
            var q = s.slice(3).split(/\s+/);
            vn.push(+q[0], +q[1], +q[2]);
            continue;
          }
          continue;
        }

        // --- грани ---
        if (s.charCodeAt(0) === 102) {       // 'f'
          var f = s.slice(1).trim().split(/\s+/);
          var nv = v.length / 3;
          var nn = vn.length / 3;
          var vi = [];
          var ni = [];
          for (var k = 0; k < f.length; k++) {
            var t = f[k];
            if (!t) continue;
            var s1 = t.indexOf('/');
            if (s1 < 0) {
              vi.push(idx(t, nv));
              ni.push(-1);
            } else {
              vi.push(idx(t.slice(0, s1), nv));
              var rest = t.slice(s1 + 1);
              var s2 = rest.indexOf('/');
              var ns = s2 < 0 ? '' : rest.slice(s2 + 1);
              if (ns) { ni.push(idx(ns, nn)); hasNormals = true; }
              else ni.push(-1);
            }
          }
          // многоугольник -> веер треугольников
          for (var j = 1; j + 1 < vi.length; j++) {
            faces.push(vi[0], vi[j], vi[j + 1], ni[0], ni[j], ni[j + 1], curMat);
          }
          continue;
        }

        // --- материалы ---
        if (s.indexOf('usemtl') === 0) {
          var name = s.slice(6).trim();
          if (!(name in matId)) { matId[name] = matNames.length; matNames.push(name); }
          curMat = matId[name];
        } else if (s.indexOf('mtllib') === 0) {
          mtllib = s.slice(6).trim().split(/\s+/)[0] || '';
        }
      }

      return {
        v: v, vn: vn, faces: faces,
        matNames: matNames, hasNormals: hasNormals, mtllib: mtllib
      };
    },

    // текст MTL -> { имя материала: [r,g,b] } (читаем только Kd)
    parseMtl: function (text) {
      var out = {};
      var cur = null;
      var lines = text.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var s = lines[i].trim();
        if (!s || s.charCodeAt(0) === 35) continue;          // '#'
        if (s.indexOf('newmtl') === 0) {
          cur = s.slice(6).trim();
          out[cur] = [0.78, 0.78, 0.80];
        } else if (cur && s.indexOf('Kd') === 0) {
          var p = s.slice(2).trim().split(/\s+/);
          var r = +p[0], g = +p[1], b = +p[2];
          if (isFinite(r) && isFinite(g) && isFinite(b)) {
            out[cur] = [Math.min(1, r), Math.min(1, g), Math.min(1, b)];
          }
        }
      }
      return out;
    },

    // загрузка файла по адресу: OBJ + (если указан) его MTL рядом
    load: function (url) {
      return fetch(url, { cache: 'no-cache' }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + url);
        return res.text();
      }).then(function (text) {
        var obj = Obj.parse(text);
        obj.url = url;
        obj.colors = {};
        if (!obj.mtllib) return obj;
        var mtlUrl;
        try { mtlUrl = new URL(obj.mtllib, new URL(url, location.href)).href; }
        catch (e) { return obj; }
        // материала может не быть — это не ошибка модели
        return fetch(mtlUrl, { cache: 'no-cache' })
          .then(function (res) { return res.ok ? res.text() : ''; })
          .then(function (mtlText) {
            if (mtlText) obj.colors = Obj.parseMtl(mtlText);
            return obj;
          }, function () { return obj; });
      });
    },

    // цвет первого материала модели (или заданный по умолчанию)
    colorOf: function (obj, def) {
      var names = obj.matNames || [];
      for (var i = 0; i < names.length; i++) {
        var c = obj.colors && obj.colors[names[i]];
        if (c) return c;
      }
      return def || [0.78, 0.78, 0.80];
    }
  };

  GE.Obj = Obj;
})(window.GE = window.GE || {});
