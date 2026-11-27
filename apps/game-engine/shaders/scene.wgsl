// scene.wgsl — сцена мини-приложения «Game engine».
//
// Адаптировано из HLSL-шейдера raymarch.fx: камера, хеш-функции, звёздное небо,
// солнце и градиент неба, освещение поверхности (скайбокс-свет + прямое солнце),
// примитивы сцены (сферы, усечённые конусы, кубы).
//
// Что вырезано: всё, что относилось к полупрозрачным объектам, — призрачные
// материалы, аура из отрезков со слиянием по стыкам, поглощение exp(-σ·d),
// цветные тени сквозь оболочки. Остались непрозрачные тела и жёсткие тени.
//
// Перенесено на CPU (так дешевле): 4D-срез, поворот кубов (в буфер едет готовый
// осевой AABB), цвет и сила солнца, цвет скайбокс-света, положение камеры.
//
// === Про цену пикселя ===
// Кадр здесь стоит «пиксели × (небо + земля + тела + лучи к солнцу)», поэтому дорогое
// считается реже:
//   * всё, что зависит только от солнца и камеры, считается на процессоре один раз за кадр
//     и приезжает в P.frame / P.frame2 (день, закат, видимость солнца, tan(угол/2),
//     цвет солнца с силой) — раньше это повторялось в каждом пикселе;
//   * степени с целым показателем (2, 4, 6, 40, 200) — умножениями, а не pow();
//   * ветви, результат которых точно ноль, не выполняются вовсе: звёзды днём, у горизонта
//     и рядом с солнцем; ореол и рассеяние — только в стороне солнца; блик — только там,
//     где на точку падает свет; разметка пола — только когда сетка включена; лучи к солнцу —
//     только когда солнце над горизонтом.
// Ни одна из этих ветвей не меняет картинку: они повторяют те же формулы в точках,
// где формула даёт ноль.

//#include params.wgsl
//#include primitives.wgsl

@group(0) @binding(0) var<uniform> P : Params;

struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VSOut {
  var tri = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let xy = tri[vi];
  var res : VSOut;
  res.clip = vec4f(xy, 0.0, 1.0);
  res.uv = vec2f(xy.x * 0.5 + 0.5, 0.5 - xy.y * 0.5);
  return res;
}

// ------------------------------------------------------------
// 0. СТЕПЕНИ С ЦЕЛЫМ ПОКАЗАТЕЛЕМ
//    pow() на слабых GPU (особенно на телефонах) — одна из самых дорогих операций,
//    а здесь их было до семи на пиксель. Умножения дают тот же результат.
// ------------------------------------------------------------

fn pow2(x : f32) -> f32 { return x * x; }

fn pow4(x : f32) -> f32 {
  let x2 = x * x;
  return x2 * x2;
}

fn pow6(x : f32) -> f32 {
  let x2 = x * x;
  return x2 * x2 * x2;
}

// x^40 = x^32 · x^8
fn pow40(x : f32) -> f32 {
  let x2 = x * x;
  let x4 = x2 * x2;
  let x8 = x4 * x4;
  let x16 = x8 * x8;
  let x32 = x16 * x16;
  return x32 * x8;
}

// x^200 = x^128 · x^64 · x^8
fn pow200(x : f32) -> f32 {
  let x2 = x * x;
  let x4 = x2 * x2;
  let x8 = x4 * x4;
  let x16 = x8 * x8;
  let x32 = x16 * x16;
  let x64 = x32 * x32;
  let x128 = x64 * x64;
  return x128 * x64 * x8;
}

// ------------------------------------------------------------
// 1. ХЕШИ (звёзды, шум дизеринга)
// ------------------------------------------------------------

fn hash11(p0 : f32) -> f32 {
  var p = fract(p0 * 0.1031);
  p = p * (p + 33.33);
  p = p * (p + p);
  return fract(p);
}

fn hash21(p : vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, vec3f(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash31(p : f32) -> vec3f {
  var p3 = fract(vec3f(p, p, p) * vec3f(0.1031, 0.1030, 0.0973));
  p3 = p3 + dot(p3, vec3f(p3.y, p3.z, p3.x) + 33.33);
  let sum = vec3f(p3.x, p3.x, p3.y) + vec3f(p3.y, p3.z, p3.z);
  return fract(sum * vec3f(p3.z, p3.y, p3.x));
}

// ------------------------------------------------------------
// 2. ЗВЁЗДЫ — сетка ячеек по направлению луча, в каждой ячейке своя звезда
//    Дорогое (цвет, яркость, мерцание) считается только там, где звезда
//    действительно накрыла пиксель; остальные случаи — те же нули, но сразу.
// ------------------------------------------------------------

fn starField(rd : vec3f, ro : vec3f, dayFactor : f32, cosSun : f32) -> vec3f {
  let zero = vec3f(0.0, 0.0, 0.0);

  // условия, при которых вклад всё равно ноль (см. vis ниже)
  if (dayFactor >= 1.0) { return zero; }        // день: (1 - day) = 0
  if (cosSun > 0.985) { return zero; }          // рядом с солнцем: засветка
  if (rd.y <= -0.02) { return zero; }           // ниже горизонта: купол = 0

  let sd = normalize(rd + ro * 0.0008);

  let cellF = sd * 90.0;
  let cell = floor(cellF);
  let fcell = fract(cellF);

  let seed = hash21(vec2f(cell.x, cell.y) + vec2f(cell.z * 17.0));

  if (hash11(seed + 0.37) < 0.80) { return zero; }   // step(0.80, …): в ячейке нет звезды
  let starPos = vec3f(hash11(seed + 1.11), hash11(seed + 2.27), hash11(seed + 3.73));
  let starRadius = mix(0.22, 0.60, hash11(seed + 5.17));

  let d3 = fcell - starPos;
  let dist = sqrt(dot(d3, d3));
  if (dist >= starRadius) { return zero; }           // звезда не накрыла этот пиксель

  let shape = 1.0 - smoothstep(starRadius * 0.15, starRadius, dist);

  // яркость: совсем тусклых нет — иначе на малом кадре звёзды не видно совсем
  let b = hash11(seed + 7.91);
  let brightness = 0.60 + pow2(b) * 1.4;
  let tintMix = hash31(seed + 5.23).r;
  let tint = mix(vec3f(0.75, 0.85, 1.0), vec3f(1.0, 0.85, 0.7), tintMix);

  let twinkle = 0.8 + 0.2 * sin(P.time * 2.0 + hash11(seed + 9.1) * 40.0);

  let sunOcclusion = 1.0 - smoothstep(0.92, 0.985, cosSun);   // рядом с солнцем звёзд нет
  // у самого горизонта звёзды гасим, но быстро: рамка кадра низкая, иначе их не видно совсем
  let dome = smoothstep(-0.02, 0.25, rd.y);
  let vis = (1.0 - dayFactor) * sunOcclusion * dome;

  return tint * (shape * brightness * twinkle * vis);
}

// ------------------------------------------------------------
// 3. НЕБО И СОЛНЦЕ. Цвет и сила солнца, день и закат приходят с процессора
//    (зависят от высоты над горизонтом), поэтому закат/ночь — это ползунок.
// ------------------------------------------------------------

fn skyColor(rd : vec3f, sun : vec3f, cosSun : f32, dayFactor : f32,
            sunVis : f32, dusk : f32) -> vec3f {
  let dayNear = vec3f(0.55, 0.75, 1.00);
  let dayFar = vec3f(0.05, 0.12, 0.35);
  let nightCol = vec3f(0.01, 0.02, 0.05);

  let dayCol = mix(dayFar, dayNear, pow(cosSun, 1.6));
  var col = mix(nightCol, dayCol, dayFactor);

  // в стороне от солнца ни одна из этих добавок не даёт ничего: экономим три степени
  if (cosSun > 0.0) {
    // закатная полоса у горизонта
    let horizon = 1.0 - saturate(abs(rd.y) * 2.5);
    col = mix(col, vec3f(1.0, 0.55, 0.20), horizon * dusk * pow2(cosSun) * 0.55);

    // диск и широкое рассеяние вокруг солнца
    let disk = smoothstep(0.9995, 0.9998, cosSun);
    let scatter = pow6(cosSun);
    var glow = disk * 4.0 + scatter * 0.15;

    // ореол виден только вплотную к солнцу (pow(0.5, 200) ≈ 0) — остальным он не нужен
    if (cosSun > 0.5) {
      glow = glow + pow200(cosSun) * 0.8;
    }

    col = col + sun * glow * sunVis;
  }

  return col;
}

// ------------------------------------------------------------
// 4. ЗЕМЛЯ — бесконечная плоскость y = 0 с процедурной сеткой
//    (в исходной версии земля была отдельным прямоугольником в буфере;
//    здесь она аналитическая — сетка не зависит от размера площадки).
// ------------------------------------------------------------

fn groundHit(ro : vec3f, rd : vec3f) -> f32 {
  if (abs(rd.y) < 1e-5) { return -1.0; }
  let t = -ro.y / rd.y;
  if (t <= 1e-4) { return -1.0; }
  return t;
}

fn groundColor(p : vec3f, dist : f32) -> vec3f {
  // клетка 2 метра
  let cell = 2.0;
  let f = fract(p.xz / cell);

  let parity = f32((i32(floor(p.x / cell)) + i32(floor(p.z / cell))) & 1);
  var col = mix(vec3f(0.048, 0.054, 0.066), vec3f(0.078, 0.086, 0.102), parity * 0.85);

  // разметка пола: при выключенной сетке она умножалась на ноль — теперь не считается
  if (P.extra.w > 0.5) {
    let dline = min(f, vec2f(1.0, 1.0) - f) * cell;
    let d = min(dline.x, dline.y);

    let width = 0.010 + dist * 0.0006;            // вдали линии толще — иначе мерцают
    let raw = 1.0 - smoothstep(width, width * 2.6, d);
    let fade = 1.0 - smoothstep(28.0, 110.0, dist);   // к горизонту сетка успокаивается
    col = mix(col, vec3f(0.15, 0.34, 0.40), raw * fade);
  }

  return col;
}

// ------------------------------------------------------------
// 5. ОБЪЕКТЫ СЦЕНЫ: ближайшая видимая поверхность и тень.
//    Всё считает CSG-интерпретатор из primitives.wgsl (traceScene / shadowScene):
//    сцена упакована в буфер примитивов и плоскую CSG-программу, корни программы
//    и есть объекты; булевы операции объединяют тела в один корень.
// ------------------------------------------------------------

// ------------------------------------------------------------
// 6. ОСВЕЩЕНИЕ ПОВЕРХНОСТИ
//    скайбокс-свет всегда + прямое солнце с жёсткой тенью + слабый блик.
// ------------------------------------------------------------

fn shadeSurface(n : vec3f, albedo : vec3f, rd : vec3f, sun : vec3f,
                ndl0 : f32, spec0 : f32, shadow : f32) -> vec3f {
  // скайбокс-свет: сверху — небо, снизу — его отскок от земли.
  // Без нижнего света поверхность с нормалью вниз (потолок, низ куба) получала
  // ровно ноль и выглядела чёрной, будто провал в небе.
  let ambK = max(0.5 + 0.5 * n.y, 0.30 * (0.5 - 0.5 * n.y));
  let ambient = P.skyAmbient.rgb * ambK;
  let lit = shadow * P.frame2.x;                // «день для поверхности» с процессора

  var col = albedo * (ambient + sun * saturate(ndl0) * lit);

  // блик уже умножен на lit: в тени и ночью его нет — не считаем степень
  if (lit > 0.0) {
    col = col + sun * (pow40(saturate(spec0)) * lit) * 0.35;
  }

  let rim = 1.0 - saturate(dot(n, -rd));
  col = col + P.skyAmbient.rgb * pow4(rim) * 0.18;
  return col;
}

// ------------------------------------------------------------
// 7. КАДР
// ------------------------------------------------------------

@fragment
fn fs_main(v : VSOut) -> @location(0) vec4f {
  // Наполнение статики: сцена рисуется в УМЕНЬШЕННУЮ текстуру, где каждый её пиксель —
  // это одна точка полного кадра на решётке mask.x × mask.x со смещением (mask.y, mask.z).
  // За кадр считается только своя доля пикселей — поэтому проход и стоит свою долю;
  // два прохода дают вдвое больше точек, весь квадрат решётки — целый кадр.
  // (Так, точками по всему кадру с discard не выйдет: драйвер выполняет шейдер
  // для всех пикселей, откладывая discard, — проверено замером, 1/64 кадра стоила столько же.)
  let size = max(P.resolution, vec2f(1.0, 1.0));
  let steps = max(P.mask.x, 1.0);
  var pix = v.uv * size;                     // обычный кадр — пиксель как есть
  if (steps > 1.5) {
    pix = vec2f(vec2u(v.clip.xy)) * steps + P.mask.yz + vec2f(0.5, 0.5);
  }
  let uv = pix / size;
  let px = pix;
  let aspect = size.x / size.y;

  // пиксель → луч (как в исходной версии: базис и угол обзора приходят с процессора)
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let tanHalf = P.frame.x;
  let ro = P.camPos.xyz;
  let rd = normalize(P.camForward.xyz
    + P.camRight.xyz * (ndc.x * tanHalf * aspect)
    + P.camUp.xyz * (ndc.y * tanHalf));

  let sunDir = P.sunDir.xyz;        // единичный: нормирован на процессоре
  let sun = P.frame2.yzw;           // цвет солнца, уже умноженный на силу
  let dayFactor = P.frame.y;
  let cosSun = saturate(dot(rd, sunDir));

  // небо: градиент + диск солнца, звёзды — если включены и ночь
  var col = skyColor(rd, sun, cosSun, dayFactor, P.frame.z, P.frame.w);
  if (P.extra.z > 0.5) {
    col = col + starField(rd, ro, dayFactor, cosSun);
  }

  // ближайшая поверхность: примитив или земля
  var hit = traceScene(ro, rd);
  let tg = groundHit(ro, rd);
  if (tg > 0.0 && tg < hit.t) {
    hit = Hit(tg, vec3f(0.0, 1.0, 0.0), groundColor(ro + rd * tg, tg));
  }

  if (hit.t < T_MISS) {
    let pos = ro + rd * hit.t;

    // скалярные произведения считаем один раз: они нужны и для проверки,
    // нужна ли вообще тень, и для самого освещения
    let ndl0 = dot(hit.normal, sunDir);
    let halfV = normalize(sunDir - rd);
    let spec0 = dot(hit.normal, halfV);

    // луч к солнцу пускаем, только если от солнца на точку хоть что-то попадает:
    // P.extra.y = 0 — тени выключены; P.frame2.x = 0 — солнце под горизонтом;
    // а если ни диффуза, ни блика не будет (поверхность отвернута от солнца) — тоже незачем
    var shadow = 1.0;
    if (P.extra.y > 0.5 && P.frame2.x > 0.0 && (ndl0 > 0.0 || spec0 > 0.0)) {
      shadow = shadowScene(pos, sunDir);
    }
    let surface = shadeSurface(hit.normal, hit.albedo, rd, sun, ndl0, spec0, shadow);

    // дымка: далёкое уходит в цвет неба
    let fog = clamp(1.0 - exp(-hit.t * 0.011), 0.0, 0.94);
    col = mix(surface, col, fog);
  }

  // яркость с процессора + дизеринг против полос на градиентах
  col = col * max(P.extra.x, 0.05);
  let dither = (hash21(px + vec2f(P.time * 37.0, 11.0)) - 0.5) * (1.0 / 255.0);
  col = col + vec3f(dither, dither, dither);

  return vec4f(clamp(col, vec3f(0.0, 0.0, 0.0), vec3f(1.0, 1.0, 1.0)), 1.0);
}
