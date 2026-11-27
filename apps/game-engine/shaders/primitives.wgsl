// primitives.wgsl — непрозрачные примитивы сцены: раскладка буфера, разбор, пересечения.
//
// Из исходного HLSL-шейдера (raymarch.fx) убраны ВСЕ прозрачные оболочки:
// призрачные материалы, аура из отрезков, поглощение exp(-σ·d), цветные тени.
// Остались только непрозрачные тела: свет, поверхность и жёсткая тень.
//
// Раскладка буфера (её заполняет js/scene/pack.js → GE.packObjects): один примитив = 3 vec4 = 48 Б.
//   сфера: a = (центр.xyz, радиус), b = 0,               c = (цвет.rgb, 0)
//   конус: a = (точка A.xyz, rA),  b = (точка B.xyz, rB), c = (цвет.rgb, 0)
//   куб:   a = (min.xyz, 0),       b = (max.xyz, 0),      c = (цвет.rgb, 0)
// Порядок в буфере: все сферы, затем все конусы, затем все кубы (так их и обходит
// scene.wgsl, беря смещения из P.counts). Поворот куба считается на процессоре —
// на GPU приезжает готовый осевой AABB, как и в исходной версии.
// Потолок буфера — 4096 примитивов (192 КБ): его держит сцена-бенчмарк с кубом сфер 16³.

struct Prim {
  a : vec4f,
  b : vec4f,
  c : vec4f,
};

@group(0) @binding(1) var<storage, read> prims : array<Prim>;

// промах: расстояние-заглушка, заведомо больше любой сцены
const T_MISS : f32 = 1e9;

struct Hit {
  t      : f32,     // расстояние вдоль луча (T_MISS — промах)
  normal : vec3f,   // нормаль поверхности, наружу
  albedo : vec3f,   // цвет поверхности
};

fn miss() -> Hit {
  return Hit(T_MISS, vec3f(0.0, 1.0, 0.0), vec3f(0.5, 0.5, 0.55));
}

// Берём попадание, только если оно ближе текущего и грань смотрит на луч.
// Отсюда же отсекаются попадания «изнутри тела».
fn nearer(cur : Hit, t : f32, n : vec3f, albedo : vec3f, rd : vec3f) -> Hit {
  if (t <= 1e-3 || t >= cur.t) { return cur; }
  if (dot(n, rd) >= -1e-4) { return cur; }
  return Hit(t, n, albedo);
}

fn nearest(a : Hit, b : Hit) -> Hit {
  if (b.t < a.t) { return b; }
  return a;
}

// ---------------- сфера ----------------

fn sphereHitAt(ro : vec3f, rd : vec3f, center : vec3f, radius : f32, albedo : vec3f) -> Hit {
  if (radius <= 1e-4) { return miss(); }
  let oc = ro - center;
  let b = dot(oc, rd);
  let c = dot(oc, oc) - radius * radius;
  let disc = b * b - c;
  if (disc < 0.0) { return miss(); }

  let s = sqrt(disc);
  var t = -b - s;
  var inside = false;
  if (t <= 1e-3) {           // камера внутри — берём дальнюю грань и выворачиваем нормаль
    t = -b + s;
    inside = true;
  }
  if (t <= 1e-3) { return miss(); }

  var n = normalize(ro + rd * t - center);
  if (inside) { n = -n; }
  return Hit(t, n, albedo);
}

fn hitSphere(ro : vec3f, rd : vec3f, i : u32) -> Hit {
  let p = prims[i];
  return sphereHitAt(ro, rd, p.a.xyz, p.a.w, p.c.rgb);
}

// ---------------- конус (усечённый: точки A и B, радиусы rA и rB) ----------------

// Нормаль боковой поверхности: радиус меняется линейно вдоль оси,
// поэтому нормаль — радиальное направление с поправкой на наклон образующей.
fn coneNormal(pt : vec3f, a : vec3f, b : vec3f, rA : f32, rB : f32) -> vec3f {
  let ba = b - a;
  let lenBA = max(length(ba), 1e-6);
  let axis = ba / lenBA;
  let h = dot(pt - a, axis);
  let radial = pt - (a + axis * h);
  let lenR = length(radial);
  var radialDir = vec3f(0.0, 1.0, 0.0);
  if (lenR > 1e-5) { radialDir = radial / lenR; }
  let slope = (rB - rA) / lenBA;      // dr/dL
  return normalize(radialDir - axis * slope);
}

fn hitCone(ro : vec3f, rd : vec3f, i : u32) -> Hit {
  let p = prims[i];
  let a = p.a.xyz;
  let b = p.b.xyz;
  let rA = p.a.w;
  let rB = p.b.w;
  let albedo = p.c.rgb;

  let ba = b - a;
  let baba = dot(ba, ba);
  if (baba < 1e-8) {                 // вырожденный отрезок — просто сфера
    return sphereHitAt(ro, rd, a, max(rA, rB), albedo);
  }

  var cur = miss();

  // --- боковая поверхность: |radial(t)|² = r(t)², одно квадратное уравнение ---
  let oa = ro - a;
  let bard = dot(ba, rd);
  let baoa = dot(ba, oa);
  let rdoa = dot(rd, oa);
  let oaoa = dot(oa, oa);
  let rdd = dot(rd, rd);
  let invBaba = 1.0 / baba;

  let p0p0 = oaoa - baoa * baoa * invBaba;
  let p0p1 = rdoa - baoa * bard * invBaba;
  let p1p1 = rdd - bard * bard * invBaba;
  let h0 = baoa * invBaba;           // проекция на ось: h(t) = h0 + h1·t, внутри [0,1]
  let h1 = bard * invBaba;

  let slope = rB - rA;               // r(h) = rA + slope·h  ->  q0 + q1·t
  let q0 = rA + slope * h0;
  let q1 = slope * h1;

  let A = p1p1 - q1 * q1;
  let B = 2.0 * (p0p1 - q0 * q1);
  let C = p0p0 - q0 * q0;

  if (abs(A) > 1e-8) {
    let disc = B * B - 4.0 * A * C;
    if (disc >= 0.0) {
      let sq = sqrt(disc);
      let inv2A = 0.5 / A;
      let roots = array<f32, 2>((-B - sq) * inv2A, (-B + sq) * inv2A);
      for (var k = 0; k < 2; k = k + 1) {
        let t = roots[k];
        let h = h0 + h1 * t;
        if (t > 1e-3 && h >= 0.0 && h <= 1.0) {
          cur = nearer(cur, t, coneNormal(ro + rd * t, a, b, rA, rB), albedo, rd);
        }
      }
    }
  } else if (abs(B) > 1e-8) {
    let t = -C / B;                  // луч почти касается поверхности — линейный случай
    let h = h0 + h1 * t;
    if (t > 1e-3 && h >= 0.0 && h <= 1.0) {
      cur = nearer(cur, t, coneNormal(ro + rd * t, a, b, rA, rB), albedo, rd);
    }
  }

  // --- торцы: две плоские крышки (иначе конус был бы открытой трубой) ---
  let axis = ba / sqrt(baba);
  let den = dot(rd, axis);
  if (abs(den) > 1e-6) {
    let tA = dot(a - ro, axis) / den;
    let qA = ro + rd * tA - a;
    if (dot(qA, qA) <= rA * rA) {
      cur = nearer(cur, tA, -axis, albedo, rd);
    }
    let tB = dot(b - ro, axis) / den;
    let qB = ro + rd * tB - b;
    if (dot(qB, qB) <= rB * rB) {
      cur = nearer(cur, tB, axis, albedo, rd);
    }
  }

  return cur;
}

// ---------------- куб (готовый осевой AABB) ----------------

fn hitBox(ro : vec3f, rd : vec3f, i : u32) -> Hit {
  let p = prims[i];
  let bmin = p.a.xyz;
  let bmax = p.b.xyz;

  // точные нули направления заменяем малым числом: параллельный слою луч уезжает в ±∞
  let d = vec3f(
    select(1e-8, rd.x, abs(rd.x) > 1e-8),
    select(1e-8, rd.y, abs(rd.y) > 1e-8),
    select(1e-8, rd.z, abs(rd.z) > 1e-8));

  let inv = 1.0 / d;
  let t0 = (bmin - ro) * inv;
  let t1 = (bmax - ro) * inv;
  let tn = min(t0, t1);              // вход по каждой оси
  let tf = max(t0, t1);              // выход по каждой оси

  let tmin = max(max(tn.x, tn.y), tn.z);
  let tmax = min(min(tf.x, tf.y), tf.z);
  if (tmax <= tmin) { return miss(); }

  // нормаль — по той оси, что дала вход; смотрит против луча
  var n = vec3f(0.0, 1.0, 0.0);
  if (tmin == tn.x) {
    n = vec3f(sign(-d.x), 0.0, 0.0);
  } else if (tmin == tn.y) {
    n = vec3f(0.0, sign(-d.y), 0.0);
  } else {
    n = vec3f(0.0, 0.0, sign(-d.z));
  }
  return nearer(miss(), tmin, n, p.c.rgb, rd);
}
