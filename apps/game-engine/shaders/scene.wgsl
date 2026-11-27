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
// ------------------------------------------------------------

fn starField(rd : vec3f, ro : vec3f, dayFactor : f32, cosSun : f32) -> vec3f {
  let sd = normalize(rd + ro * 0.0008);

  let cellF = sd * 90.0;
  let cell = floor(cellF);
  let fcell = fract(cellF);

  let seed = hash21(vec2f(cell.x, cell.y) + vec2f(cell.z * 17.0));

  let present = step(0.80, hash11(seed + 0.37));
  if (present < 0.5) { return vec3f(0.0, 0.0, 0.0); }

  let starPos = vec3f(hash11(seed + 1.11), hash11(seed + 2.27), hash11(seed + 3.73));
  let d3 = fcell - starPos;
  let starRadius = mix(0.22, 0.60, hash11(seed + 5.17));

  let dist = length(d3);
  let shape = 1.0 - smoothstep(starRadius * 0.15, starRadius, dist);

  // яркость: совсем тусклых нет — иначе на малом кадре звёзды не видно совсем
  let brightness = 0.60 + pow(hash11(seed + 7.91), 2.0) * 1.4;
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
// 3. НЕБО И СОЛНЦЕ. Цвет и сила солнца приходят с процессора
//    (зависят от высоты над горизонтом), поэтому закат/ночь — это ползунок.
// ------------------------------------------------------------

fn skyColor(rd : vec3f, sunDir : vec3f) -> vec3f {
  let sunHeight = sunDir.y;
  let dayFactor = smoothstep(-0.25, 0.20, sunHeight);
  let cosSun = saturate(dot(rd, sunDir));

  let dayNear = vec3f(0.55, 0.75, 1.00);
  let dayFar = vec3f(0.05, 0.12, 0.35);
  let dayCol = mix(dayFar, dayNear, pow(cosSun, 1.6));
  let nightCol = vec3f(0.01, 0.02, 0.05);
  var col = mix(nightCol, dayCol, dayFactor);

  // закатная полоса у горизонта
  let horizon = 1.0 - saturate(abs(rd.y) * 2.5);
  let dusk = 1.0 - smoothstep(0.0, 0.35, abs(sunHeight));
  col = mix(col, vec3f(1.0, 0.55, 0.20), horizon * dusk * pow(cosSun, 2.0) * 0.55);

  // диск, ореол и широкое рассеяние вокруг солнца
  let sunVis = smoothstep(-0.15, 0.05, sunHeight);
  let disk = smoothstep(0.9995, 0.9998, cosSun);
  let halo = pow(cosSun, 200.0);
  let scatter = pow(cosSun, 6.0);
  let sun = P.sunColor.rgb * P.sunColor.w;

  col = col + sun * (disk * 4.0 + halo * 0.8 + scatter * 0.15) * sunVis;
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
  // клетка 2 метра; расстояние до ближайшей линии сетки в метрах
  let cell = 2.0;
  let f = fract(p.xz / cell);
  let dline = min(f, vec2f(1.0, 1.0) - f) * cell;
  let d = min(dline.x, dline.y);

  let width = 0.010 + dist * 0.0006;            // вдали линии толще — иначе мерцают
  let raw = 1.0 - smoothstep(width, width * 2.6, d);
  let fade = 1.0 - smoothstep(28.0, 110.0, dist);   // к горизонту сетка успокаивается
  let line = raw * fade * P.extra.w;               // P.extra.w = 0 — пол без разметки

  let parity = f32((i32(floor(p.x / cell)) + i32(floor(p.z / cell))) & 1);
  var col = mix(vec3f(0.048, 0.054, 0.066), vec3f(0.078, 0.086, 0.102), parity * 0.85);
  col = mix(col, vec3f(0.15, 0.34, 0.40), line);
  return col;
}

// ------------------------------------------------------------
// 5. ОБЪЕКТЫ СЦЕНЫ: ближайшее непрозрачное тело из буфера примитивов
// ------------------------------------------------------------

fn traceObjects(ro : vec3f, rd : vec3f) -> Hit {
  var best = miss();
  let coneOffset = P.counts.x;
  let boxOffset = P.counts.x + P.counts.y;

  for (var i = 0u; i < P.counts.x; i = i + 1u) {
    best = nearest(best, hitSphere(ro, rd, i));
  }
  for (var j = 0u; j < P.counts.y; j = j + 1u) {
    best = nearest(best, hitCone(ro, rd, coneOffset + j));
  }
  for (var k = 0u; k < P.counts.z; k = k + 1u) {
    best = nearest(best, hitBox(ro, rd, boxOffset + k));
  }
  return best;
}

// Жёсткая тень: 0 — между точкой и солнцем есть тело, 1 — свет проходит.
// Проверяются все примитивы буфера (прозрачных из них нет).
fn shadowRay(origin : vec3f, sunDir : vec3f) -> f32 {
  let o = origin + sunDir * 1e-3;          // чуть отодвинулись от своей же поверхности
  let coneOffset = P.counts.x;
  let boxOffset = P.counts.x + P.counts.y;

  for (var i = 0u; i < P.counts.x; i = i + 1u) {
    if (hitSphere(o, sunDir, i).t < T_MISS) { return 0.0; }
  }
  for (var j = 0u; j < P.counts.y; j = j + 1u) {
    if (hitCone(o, sunDir, coneOffset + j).t < T_MISS) { return 0.0; }
  }
  for (var k = 0u; k < P.counts.z; k = k + 1u) {
    if (hitBox(o, sunDir, boxOffset + k).t < T_MISS) { return 0.0; }
  }
  return 1.0;
}

// ------------------------------------------------------------
// 6. ОСВЕЩЕНИЕ ПОВЕРХНОСТИ
//    скайбокс-свет всегда + прямое солнце с жёсткой тенью + слабый блик.
// ------------------------------------------------------------

fn shadeSurface(n : vec3f, albedo : vec3f, rd : vec3f, shadow : f32) -> vec3f {
  let sunDir = normalize(P.sunDir.xyz);
  let sun = P.sunColor.rgb * P.sunColor.w;

  let ambient = P.skyAmbient.rgb * (0.5 + 0.5 * n.y);
  let ndl = saturate(dot(n, sunDir));
  let day = smoothstep(-0.05, 0.15, sunDir.y);   // солнце светит только над горизонтом
  let lit = shadow * day;

  let halfV = normalize(sunDir - rd);
  let spec = pow(saturate(dot(n, halfV)), 40.0) * lit;
  let rim = pow(1.0 - saturate(dot(n, -rd)), 4.0);

  var col = albedo * (ambient + sun * ndl * lit);
  col = col + sun * spec * 0.35;
  col = col + P.skyAmbient.rgb * rim * 0.18;
  return col;
}

// ------------------------------------------------------------
// 7. КАДР
// ------------------------------------------------------------

@fragment
fn fs_main(v : VSOut) -> @location(0) vec4f {
  let size = max(P.resolution, vec2f(1.0, 1.0));
  let px = v.uv * size;
  let aspect = size.x / size.y;

  // пиксель → луч (как в исходной версии: базис и угол обзора приходят с процессора)
  let ndc = vec2f(v.uv.x * 2.0 - 1.0, 1.0 - v.uv.y * 2.0);
  let tanHalf = tan(P.fov * 0.5);
  let ro = P.camPos.xyz;
  let rd = normalize(P.camForward.xyz
    + P.camRight.xyz * (ndc.x * tanHalf * aspect)
    + P.camUp.xyz * (ndc.y * tanHalf));

  let sunDir = normalize(P.sunDir.xyz);
  let dayFactor = smoothstep(-0.25, 0.20, sunDir.y);
  let cosSun = saturate(dot(rd, sunDir));

  // небо: градиент + диск солнца + звёзды (ночью, если включены)
  var col = skyColor(rd, sunDir);
  if (P.extra.z > 0.5) {
    col = col + starField(rd, ro, dayFactor, cosSun);
  }

  // ближайшая поверхность: примитив или земля
  var hit = traceObjects(ro, rd);
  let tg = groundHit(ro, rd);
  if (tg > 0.0 && tg < hit.t) {
    hit = Hit(tg, vec3f(0.0, 1.0, 0.0), groundColor(ro + rd * tg, tg));
  }

  if (hit.t < T_MISS) {
    let pos = ro + rd * hit.t;
    // P.extra.y = 0 — тени выключены (лучи к солнцу не пускаем: экономим самое дорогое)
    var shadow = 1.0;
    if (P.extra.y > 0.5) {
      shadow = shadowRay(pos, sunDir);
    }
    let surface = shadeSurface(hit.normal, hit.albedo, rd, shadow);

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
