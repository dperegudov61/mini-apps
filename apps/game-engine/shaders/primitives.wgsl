// primitives.wgsl — примитивы сцены: раскладка буфера, пересечения, нормали,
// булевы операции (CSG) над твёрдыми телами и поверхности (плоскость, прямоугольник,
// треугольник) как отдельные листы.
//
// Раскладка буфера (заполняет js/scene/pack.js → GE.packScene): один примитив = 8 vec4 = 32 float = 128 Б.
//   m : vec4f   x = вид (1 сфера, 2 куб, 3 тор, 4 конус, 5 цилиндр, 6 плоскость, 7 прямоугольник, 8 треугольник),
//               y = вывернуть (0/1), z = двусторонний (0/1), w = matId (задел под карту нормалей, 0 — нет)
//   a..f : vec4f — геометрия вида (см. ниже)
//   g : vec4f   rgb = цвет, a = зарезервировано
//
// Геометрия по видам:
//   сфера:    a = (центр.xyz, r)
//   куб:      a = (центр.xyz, 0), b = (полуразмеры.xyz, 0), c = базис X, d = базис Y (Z = X × Y)
//   тор:      a = (центр.xyz, 0), b = (R, r, 0, 0),        c = нормаль плоскости кольца
//   конус:    a = (A.xyz, rA), b = (B.xyz, rB), c = (n1.xyz, d1), d = (n2.xyz, d2)  — две наклонные режущие плоскости
//   цилиндр:  то же, что конус (rA = rB = r)
//   плоскость:a = (точка.xyz, 0), b = (нормаль.xyz, 0)
//   прямоуг.: a = (центр.xyz, 0), b = (базис U.xyz, 0), c = (базис V.xyz, 0), d = (полуW, полуH, 0, 0)
//   треугол.: a = (v0.xyz, 0), b = (v1.xyz, 0), c = (v2.xyz, 0)
//
// Плоскости конуса/цилиндра заданы уравнением dot(n, x) + d <= 0 (внутри тела).
// Правило видимости: грань видна, только если нормаль смотрит на луч (dot(n, rd) < 0);
// глядя изнутри тело прозрачно. Флаг «вывернуть» разворачивает нормали (видим изнутри).

@group(0) @binding(1) var<storage, read> prims : array<Prim>;
@group(0) @binding(2) var<storage, read> csg : array<u32>;

struct Prim {
  m : vec4f,
  a : vec4f,
  b : vec4f,
  c : vec4f,
  d : vec4f,
  e : vec4f,
  f : vec4f,
  g : vec4f,
};

// промах: расстояние-заглушка, заведомо больше любой сцены
const T_MISS : f32 = 1e9;
const T_EPS : f32 = 1e-3;
const PI : f32 = 3.141592653589793;

// виды примитивов (в m.x)
const K_SPHERE : f32 = 1.0;
const K_BOX    : f32 = 2.0;
const K_TORUS  : f32 = 3.0;
const K_CONE   : f32 = 4.0;
const K_CYL    : f32 = 5.0;
const K_PLANE  : f32 = 6.0;
const K_RECT   : f32 = 7.0;
const K_TRI    : f32 = 8.0;

// коды операций CSG-программы (в буфере csg, два u32 на инструкцию: код, операнд)
const OP_LEAF : u32 = 0u;
const OP_UNION : u32 = 1u;
const OP_INTER : u32 = 2u;
const OP_SUB   : u32 = 3u;
const OP_ROOT  : u32 = 4u;

struct Hit {
  t      : f32,     // расстояние вдоль луча (T_MISS — промах)
  normal : vec3f,   // нормаль поверхности, наружу (с учётом «вывернуть»)
  albedo : vec3f,   // цвет поверхности
};

fn miss() -> Hit {
  return Hit(T_MISS, vec3f(0.0, 1.0, 0.0), vec3f(0.5, 0.5, 0.55));
}

// ------------------------------------------------------------
// ИНТЕРВАЛЫ: твёрдое тело вдоль луча — набор отрезков [t0, t1] (внутри тела).
// Для каждого отрезка храним нормали входа (t0) и выхода (t1) и цвет (albedo.w — двусторонность).
// Поверхности (плоскость, прямоугольник, треугольник) — вырожденный отрезок [t, t].
// ------------------------------------------------------------

struct Interval {
  t0 : f32,
  t1 : f32,
  n0 : vec3f,   // внешняя нормаль в t0 (с учётом «вывернуть»)
  n1 : vec3f,   // внешняя нормаль в t1
  albedo : vec4f, // rgb — цвет, w — двусторонность (0/1)
};

const INT_MAX = 4;     // интервалов в одном списке (тор — 2, вычитание может удвоить)
const STACK_MAX = 4;   // глубина стека CSG
const CAP = 16;        // INT_MAX * STACK_MAX

var<private> s_t0 : array<f32, CAP>;
var<private> s_t1 : array<f32, CAP>;
var<private> s_n0 : array<vec3f, CAP>;
var<private> s_n1 : array<vec3f, CAP>;
var<private> s_al : array<vec4f, CAP>;
var<private> s_cnt : array<i32, STACK_MAX>;
var<private> s_top : i32;

// рабочие массивы решателя квартики
var<private> q_roots : array<f32, 4>;
var<private> q_tmp : array<f32, 4>;
var<private> q_n : i32;

fn setIv(base : i32, k : i32, t0 : f32, t1 : f32, n0 : vec3f, n1 : vec3f, albedo : vec4f) {
  let i = base + k;
  s_t0[i] = t0;
  s_t1[i] = t1;
  s_n0[i] = n0;
  s_n1[i] = n1;
  s_al[i] = albedo;
}

// ---------------- сфера ----------------

fn sphereIntervals(pid : u32, ro : vec3f, rd : vec3f, base : i32) -> i32 {
  let p = prims[pid];
  let c = p.a.xyz;
  let r = p.a.w;
  let inv = p.m.y;
  let alb = vec4f(p.g.rgb, p.m.z);
  if (r <= 1e-5) { return 0; }

  let oc = ro - c;
  let b = dot(oc, rd);
  let cc = dot(oc, oc) - r * r;
  let disc = b * b - cc;
  if (disc < 0.0) { return 0; }
  let s = sqrt(disc);
  let t0 = -b - s;
  let t1 = -b + s;

  var n0 = normalize(ro + rd * t0 - c);
  var n1 = normalize(ro + rd * t1 - c);
  if (inv > 0.5) { n0 = -n0; n1 = -n1; }
  setIv(base, 0, t0, t1, n0, n1, alb);
  return 1;
}

// ---------------- куб (ориентированный: центр + полуразмеры + базис) ----------------

fn boxIntervals(pid : u32, ro : vec3f, rd : vec3f, base : i32) -> i32 {
  let p = prims[pid];
  let c = p.a.xyz;
  let h = p.b.xyz;
  let X = p.c.xyz;
  let Y = p.d.xyz;
  let Z = cross(X, Y);
  let inv = p.m.y;
  let alb = vec4f(p.g.rgb, p.m.z);

  let o = ro - c;
  let ol = vec3f(dot(o, X), dot(o, Y), dot(o, Z));
  let dl = vec3f(dot(rd, X), dot(rd, Y), dot(rd, Z));

  let d = vec3f(
    select(1e-8, dl.x, abs(dl.x) > 1e-8),
    select(1e-8, dl.y, abs(dl.y) > 1e-8),
    select(1e-8, dl.z, abs(dl.z) > 1e-8));
  let invd = 1.0 / d;
  let lo = (-h - ol) * invd;
  let hi = (h - ol) * invd;
  let tn = min(lo, hi);
  let tf = max(lo, hi);
  let tmin = max(max(tn.x, tn.y), tn.z);
  let tmax = min(min(tf.x, tf.y), tf.z);
  if (tmax <= tmin) { return 0; }

  var n0l = vec3f(0.0, 0.0, 0.0);
  var n1l = vec3f(0.0, 0.0, 0.0);
  if (tn.x >= tn.y && tn.x >= tn.z) { n0l = vec3f(-sign(dl.x), 0.0, 0.0); }
  else if (tn.y >= tn.z) { n0l = vec3f(0.0, -sign(dl.y), 0.0); }
  else { n0l = vec3f(0.0, 0.0, -sign(dl.z)); }
  if (tf.x <= tf.y && tf.x <= tf.z) { n1l = vec3f(sign(dl.x), 0.0, 0.0); }
  else if (tf.y <= tf.z) { n1l = vec3f(0.0, sign(dl.y), 0.0); }
  else { n1l = vec3f(0.0, 0.0, sign(dl.z)); }

  var n0 = X * n0l.x + Y * n0l.y + Z * n0l.z;
  var n1 = X * n1l.x + Y * n1l.y + Z * n1l.z;
  if (inv > 0.5) { n0 = -n0; n1 = -n1; }
  setIv(base, 0, tmin, tmax, n0, n1, alb);
  return 1;
}

// ---------------- тор (решатель квартики) ----------------

fn cbrt(x : f32) -> f32 {
  return sign(x) * pow(abs(x), 1.0 / 3.0);
}

fn cubicRoots(a : f32, b : f32, c : f32, d : f32) -> i32 {
  if (abs(a) < 1e-12) {
    if (abs(b) < 1e-12) {
      if (abs(c) < 1e-12) { return 0; }
      q_tmp[0] = -d / c;
      return 1;
    }
    let disc = c * c - 4.0 * b * d;
    if (disc < 0.0) { return 0; }
    let s = sqrt(disc);
    q_tmp[0] = (-c + s) / (2.0 * b);
    if (disc > 1e-12) { q_tmp[1] = (-c - s) / (2.0 * b); return 2; }
    return 1;
  }
  let p = (3.0 * a * c - b * b) / (3.0 * a * a);
  let q = (2.0 * b * b * b - 9.0 * a * b * c + 27.0 * a * a * d) / (27.0 * a * a * a);
  let disc = q * q / 4.0 + p * p * p / 27.0;
  let shift = -b / (3.0 * a);
  if (disc >= 0.0) {
    let s = sqrt(max(disc, 0.0));
    q_tmp[0] = cbrt(-q / 2.0 + s) + cbrt(-q / 2.0 - s) + shift;
    return 1;
  }
  let rr = 2.0 * sqrt(-p / 3.0);
  let phi = acos(clamp((3.0 * q) / (2.0 * p) * sqrt(-3.0 / p), -1.0, 1.0));
  q_tmp[0] = rr * cos(phi / 3.0) + shift;
  q_tmp[1] = rr * cos((phi + 2.0 * PI) / 3.0) + shift;
  q_tmp[2] = rr * cos((phi + 4.0 * PI) / 3.0) + shift;
  return 3;
}

fn addQuadRoots(b1 : f32, c1 : f32, shift : f32) {
  let disc = b1 * b1 - 4.0 * c1;
  if (disc < 0.0) { return; }
  let s = sqrt(disc);
  q_roots[q_n] = (-b1 + s) * 0.5 + shift;
  q_n = q_n + 1;
  if (disc > 1e-12) {
    q_roots[q_n] = (-b1 - s) * 0.5 + shift;
    q_n = q_n + 1;
  }
}

fn sort4(n : i32) {
  for (var i = 1; i < n; i = i + 1) {
    let key = q_roots[i];
    var j = i - 1;
    while (j >= 0 && q_roots[j] > key) {
      q_roots[j + 1] = q_roots[j];
      j = j - 1;
    }
    q_roots[j + 1] = key;
  }
}

// a x^4 + b x^3 + c x^2 + d x + e = 0 → q_roots (по возрастанию), возвращает число корней
fn solveQuartic(a : f32, b : f32, c : f32, d : f32, e : f32) -> i32 {
  q_n = 0;
  if (abs(a) < 1e-12) {
    let n = cubicRoots(b, c, d, e);
    for (var i = 0; i < n; i = i + 1) { q_roots[i] = q_tmp[i]; }
    sort4(n);
    return n;
  }
  let B = b / a;
  let C = c / a;
  let D = d / a;
  let E = e / a;
  let p = C - 3.0 * B * B / 8.0;
  let q = B * B * B / 8.0 - B * C / 2.0 + D;
  let r = -3.0 * B * B * B * B / 256.0 + C * B * B / 16.0 - B * D / 4.0 + E;

  // резольвента: 2 m^3 - p m^2 - 2 r m + (p r - q^2/4) = 0
  let rn = cubicRoots(2.0, -p, -2.0 * r, p * r - q * q / 4.0);
  for (var i = 0; i < rn; i = i + 1) {
    let m = q_tmp[i];
    let a2 = 2.0 * m - p;
    if (a2 <= 1e-9) { continue; }
    let Aq = sqrt(a2);
    let Bm = -q / (2.0 * Aq);
    let shift = -B / 4.0;
    addQuadRoots(Aq, m + Bm, shift);
    addQuadRoots(-Aq, m - Bm, shift);
    break;
  }
  sort4(q_n);
  return q_n;
}

fn torusNormal(pt : vec3f, G : f32, R2 : f32, u : vec3f, v : vec3f, n : vec3f, inv : f32) -> vec3f {
  let S = dot(pt, pt);
  let gl = vec3f(
    4.0 * pt.x * (S + G - 2.0 * R2),
    4.0 * pt.y * (S + G - 2.0 * R2),
    4.0 * pt.z * (S + G));
  let len = length(gl);
  var gw = vec3f(0.0, 1.0, 0.0);
  if (len > 1e-6) { gw = gl / len; }
  let w = u * gw.x + v * gw.y + n * gw.z;
  return select(w, -w, inv > 0.5);
}

fn torusIntervals(pid : u32, ro : vec3f, rd : vec3f, base : i32) -> i32 {
  let p = prims[pid];
  let c = p.a.xyz;
  let R = p.b.x;
  let r = p.b.y;
  let n = p.c.xyz;
  let inv = p.m.y;
  let alb = vec4f(p.g.rgb, p.m.z);

  var w = vec3f(0.0, 1.0, 0.0);
  if (abs(n.y) > 0.9) { w = vec3f(1.0, 0.0, 0.0); }
  let u = normalize(cross(w, n));
  let v = cross(n, u);

  let o = ro - c;
  let ol = vec3f(dot(o, u), dot(o, v), dot(o, n));
  let dl = vec3f(dot(rd, u), dot(rd, v), dot(rd, n));

  let G = R * R - r * r;
  let R2 = R * R;
  let oo = dot(ol, ol);
  let od = dot(ol, dl);
  let dd = dot(dl, dl);
  let A = oo + G;
  let B = 2.0 * od;
  let C = dd;
  let Q0 = ol.x * ol.x + ol.y * ol.y;
  let Q1 = 2.0 * (ol.x * dl.x + ol.y * dl.y);
  let Q2 = dl.x * dl.x + dl.y * dl.y;

  let a4 = C * C;
  let a3 = 2.0 * B * C;
  let a2 = B * B + 2.0 * A * C - 4.0 * R2 * Q2;
  let a1 = 2.0 * A * B - 4.0 * R2 * Q1;
  let a0 = A * A - 4.0 * R2 * Q0;

  let cnt = solveQuartic(a4, a3, a2, a1, a0);
  var m = 0;
  var k = 0;
  while (k + 1 < cnt && m < INT_MAX) {
    let t0 = q_roots[k];
    let t1 = q_roots[k + 1];
    let n0 = torusNormal(ol + dl * t0, G, R2, u, v, n, inv);
    let n1 = torusNormal(ol + dl * t1, G, R2, u, v, n, inv);
    setIv(base, m, t0, t1, n0, n1, alb);
    m = m + 1;
    k = k + 2;
  }
  return m;
}

// ---------------- конус / цилиндр, усечённые двумя наклонными плоскостями ----------------

fn coneLatNormal(pt : vec3f, A : vec3f, axis : vec3f, slope : f32) -> vec3f {
  let radial = pt - (A + axis * dot(pt - A, axis));
  let lenR = length(radial);
  var radialDir = vec3f(0.0, 1.0, 0.0);
  if (lenR > 1e-6) { radialDir = radial / lenR; }
  return normalize(radialDir - axis * slope);
}

fn coneIntervals(pid : u32, ro : vec3f, rd : vec3f, base : i32) -> i32 {
  let p = prims[pid];
  let A = p.a.xyz;
  let rA = p.a.w;
  let B = p.b.xyz;
  let rB = p.b.w;
  let n1 = p.c.xyz;
  let d1 = p.c.w;
  let n2 = p.d.xyz;
  let d2 = p.d.w;
  let inv = p.m.y;
  let alb = vec4f(p.g.rgb, p.m.z);

  let ba = B - A;
  let baba = dot(ba, ba);
  if (baba < 1e-9) { return 0; }
  let L = sqrt(baba);
  let axis = ba / L;
  let slope = (rB - rA) / L;

  var ct : array<f32, 4>;
  var cn : array<vec3f, 4>;
  var cc : i32 = 0;

  // --- боковая поверхность: |radial| = r(t) ---
  let oa = ro - A;
  let bard = dot(ba, rd);
  let baoa = dot(ba, oa);
  let rdoa = dot(rd, oa);
  let oaoa = dot(oa, oa);
  let rdd = dot(rd, rd);
  let invBaba = 1.0 / baba;

  let p0p0 = oaoa - baoa * baoa * invBaba;
  let p0p1 = rdoa - baoa * bard * invBaba;
  let p1p1 = rdd - bard * bard * invBaba;
  let h0 = baoa * invBaba;
  let h1 = bard * invBaba;

  let sH = rB - rA;
  let q0 = rA + sH * h0;
  let q1 = sH * h1;

  let Aq = p1p1 - q1 * q1;
  let Bq = 2.0 * (p0p1 - q0 * q1);
  let Cq = p0p0 - q0 * q0;

  if (abs(Aq) > 1e-8) {
    let disc = Bq * Bq - 4.0 * Aq * Cq;
    if (disc >= 0.0) {
      let sq = sqrt(disc);
      let inv2A = 0.5 / Aq;
      let roots = array<f32, 2>((-Bq - sq) * inv2A, (-Bq + sq) * inv2A);
      for (var k = 0; k < 2; k = k + 1) {
        let t = roots[k];
        let pt = ro + rd * t;
        if (cc < 4 && dot(n1, pt) + d1 <= 1e-4 && dot(n2, pt) + d2 <= 1e-4) {
          ct[cc] = t;
          cn[cc] = coneLatNormal(pt, A, axis, slope);
          cc = cc + 1;
        }
      }
    }
  } else if (abs(Bq) > 1e-8) {
    let t = -Cq / Bq;
    let pt = ro + rd * t;
    if (cc < 4 && dot(n1, pt) + d1 <= 1e-4 && dot(n2, pt) + d2 <= 1e-4) {
      ct[cc] = t;
      cn[cc] = coneLatNormal(pt, A, axis, slope);
      cc = cc + 1;
    }
  }

  // --- крышки: пересечение луча с каждой наклонной плоскостью, в пределах радиуса ---
  let den1 = dot(rd, n1);
  if (abs(den1) > 1e-7 && cc < 4) {
    let t = -(dot(n1, ro) + d1) / den1;
    let pt = ro + rd * t;
    let along = dot(pt - A, axis);
    let radial = pt - (A + axis * along);
    let rr = rA + (rB - rA) * (along / L);
    if (dot(radial, radial) <= rr * rr + 1e-4 && dot(n2, pt) + d2 <= 1e-4) {
      ct[cc] = t;
      cn[cc] = n1;
      cc = cc + 1;
    }
  }
  let den2 = dot(rd, n2);
  if (abs(den2) > 1e-7 && cc < 4) {
    let t = -(dot(n2, ro) + d2) / den2;
    let pt = ro + rd * t;
    let along = dot(pt - A, axis);
    let radial = pt - (A + axis * along);
    let rr = rA + (rB - rA) * (along / L);
    if (dot(radial, radial) <= rr * rr + 1e-4 && dot(n1, pt) + d1 <= 1e-4) {
      ct[cc] = t;
      cn[cc] = n2;
      cc = cc + 1;
    }
  }

  if (cc < 2) { return 0; }
  var tmin = ct[0];
  var nmin = cn[0];
  var tmax = ct[0];
  var nmax = cn[0];
  for (var k = 1; k < cc; k = k + 1) {
    if (ct[k] < tmin) { tmin = ct[k]; nmin = cn[k]; }
    if (ct[k] > tmax) { tmax = ct[k]; nmax = cn[k]; }
  }
  if (inv > 0.5) { nmin = -nmin; nmax = -nmax; }
  setIv(base, 0, tmin, tmax, nmin, nmax, alb);
  return 1;
}

// ---------------- поверхности ----------------

fn planeInterval(pid : u32, ro : vec3f, rd : vec3f, base : i32) -> i32 {
  let p = prims[pid];
  let p0 = p.a.xyz;
  let n = p.b.xyz;
  let inv = p.m.y;
  let alb = vec4f(p.g.rgb, p.m.z);
  let den = dot(rd, n);
  if (abs(den) < 1e-7) { return 0; }
  let t = dot(p0 - ro, n) / den;
  if (t <= 0.0) { return 0; }
  var nn = n;
  if (inv > 0.5) { nn = -nn; }
  setIv(base, 0, t, t, nn, nn, alb);
  return 1;
}

fn rectInterval(pid : u32, ro : vec3f, rd : vec3f, base : i32) -> i32 {
  let p = prims[pid];
  let c = p.a.xyz;
  let U = p.b.xyz;
  let V = p.c.xyz;
  let hw = p.d.x;
  let hh = p.d.y;
  let inv = p.m.y;
  let alb = vec4f(p.g.rgb, p.m.z);
  let n = cross(U, V);
  let den = dot(rd, n);
  if (abs(den) < 1e-7) { return 0; }
  let t = dot(c - ro, n) / den;
  if (t <= 0.0) { return 0; }
  let pt = ro + rd * t;
  let loc = pt - c;
  let du = dot(loc, U);
  let dv = dot(loc, V);
  if (abs(du) <= hw && abs(dv) <= hh) {
    var nn = n;
    if (inv > 0.5) { nn = -nn; }
    setIv(base, 0, t, t, nn, nn, alb);
    return 1;
  }
  return 0;
}

fn triInterval(pid : u32, ro : vec3f, rd : vec3f, base : i32) -> i32 {
  let p = prims[pid];
  let v0 = p.a.xyz;
  let v1 = p.b.xyz;
  let v2 = p.c.xyz;
  let inv = p.m.y;
  let alb = vec4f(p.g.rgb, p.m.z);
  let e1 = v1 - v0;
  let e2 = v2 - v0;
  let h = cross(rd, e2);
  let a = dot(e1, h);
  if (abs(a) < 1e-8) { return 0; }
  let f = 1.0 / a;
  let s = ro - v0;
  let u = f * dot(s, h);
  if (u < -1e-5 || u > 1.0 + 1e-5) { return 0; }
  let q = cross(s, e1);
  let v = f * dot(rd, q);
  if (v < -1e-5 || u + v > 1.0 + 1e-5) { return 0; }
  let t = f * dot(e2, q);
  if (t <= 0.0) { return 0; }
  let n = normalize(cross(e1, e2));
  var nn = n;
  if (inv > 0.5) { nn = -nn; }
  setIv(base, 0, t, t, nn, nn, alb);
  return 1;
}

// ------------------------------------------------------------
// CSG-ИНТЕРПРЕТАТОР
// Программа — постфиксная запись дерева: LEAF i (положить лист), бинарные операции
// (снять два, положить результат), ROOT (снять результат и внести в ответ).
// ------------------------------------------------------------

fn csgReset() {
  s_top = 0;
  for (var i = 0; i < STACK_MAX; i = i + 1) { s_cnt[i] = 0; }
}

fn csgPushLeaf(pid : u32, ro : vec3f, rd : vec3f) {
  let base = s_top * INT_MAX;
  let kind = u32(prims[pid].m.x);
  var n : i32 = 0;
  if (kind == 1u) { n = sphereIntervals(pid, ro, rd, base); }
  else if (kind == 2u) { n = boxIntervals(pid, ro, rd, base); }
  else if (kind == 3u) { n = torusIntervals(pid, ro, rd, base); }
  else if (kind == 4u || kind == 5u) { n = coneIntervals(pid, ro, rd, base); }
  else if (kind == 6u) { n = planeInterval(pid, ro, rd, base); }
  else if (kind == 7u) { n = rectInterval(pid, ro, rd, base); }
  else if (kind == 8u) { n = triInterval(pid, ro, rd, base); }
  s_cnt[s_top] = n;
  s_top = s_top + 1;
}

fn csgCombine(op : u32) {
  let sB = s_top - 1;
  let sA = s_top - 2;
  let baseA = sA * INT_MAX;
  let baseB = sB * INT_MAX;
  let cntA = s_cnt[sA];
  let cntB = s_cnt[sB];

  var aT0 : array<f32, INT_MAX>;
  var aT1 : array<f32, INT_MAX>;
  var aN0 : array<vec3f, INT_MAX>;
  var aN1 : array<vec3f, INT_MAX>;
  var aAl : array<vec4f, INT_MAX>;
  var bT0 : array<f32, INT_MAX>;
  var bT1 : array<f32, INT_MAX>;
  var bN0 : array<vec3f, INT_MAX>;
  var bN1 : array<vec3f, INT_MAX>;
  var bAl : array<vec4f, INT_MAX>;
  var rT0 : array<f32, INT_MAX>;
  var rT1 : array<f32, INT_MAX>;
  var rN0 : array<vec3f, INT_MAX>;
  var rN1 : array<vec3f, INT_MAX>;
  var rAl : array<vec4f, INT_MAX>;
  var rn : i32 = 0;

  var k : i32;
  for (k = 0; k < cntA; k = k + 1) {
    let i = baseA + k;
    aT0[k] = s_t0[i]; aT1[k] = s_t1[i];
    aN0[k] = s_n0[i]; aN1[k] = s_n1[i]; aAl[k] = s_al[i];
  }
  for (k = 0; k < cntB; k = k + 1) {
    let i = baseB + k;
    bT0[k] = s_t0[i]; bT1[k] = s_t1[i];
    bN0[k] = s_n0[i]; bN1[k] = s_n1[i]; bAl[k] = s_al[i];
  }

  if (op == OP_UNION) {
    // слияние отсортированных списков с объединением перекрытий
    var gT0 : array<f32, 8>;
    var gT1 : array<f32, 8>;
    var gN0 : array<vec3f, 8>;
    var gN1 : array<vec3f, 8>;
    var gAl : array<vec4f, 8>;
    var gn : i32 = 0;
    var i = 0;
    var j = 0;
    while (i < cntA || j < cntB) {
      if (j >= cntB || (i < cntA && aT0[i] <= bT0[j])) {
        gT0[gn] = aT0[i]; gT1[gn] = aT1[i];
        gN0[gn] = aN0[i]; gN1[gn] = aN1[i]; gAl[gn] = aAl[i];
        i = i + 1;
      } else {
        gT0[gn] = bT0[j]; gT1[gn] = bT1[j];
        gN0[gn] = bN0[j]; gN1[gn] = bN1[j]; gAl[gn] = bAl[j];
        j = j + 1;
      }
      gn = gn + 1;
    }
    var k2 = 0;
    while (k2 < gn && rn < INT_MAX) {
      let t0 = gT0[k2];
      var t1 = gT1[k2];
      let n0 = gN0[k2];
      var n1 = gN1[k2];
      let al = gAl[k2];
      var kk = k2 + 1;
      while (kk < gn && gT0[kk] <= t1 + 1e-6) {
        if (gT1[kk] > t1) { t1 = gT1[kk]; n1 = gN1[kk]; }
        kk = kk + 1;
      }
      rT0[rn] = t0; rT1[rn] = t1; rN0[rn] = n0; rN1[rn] = n1; rAl[rn] = al;
      rn = rn + 1;
      k2 = kk;
    }
  } else if (op == OP_INTER) {
    for (var i = 0; i < cntA && rn < INT_MAX; i = i + 1) {
      for (var j = 0; j < cntB && rn < INT_MAX; j = j + 1) {
        let t0 = max(aT0[i], bT0[j]);
        let t1 = min(aT1[i], bT1[j]);
        if (t0 < t1 - 1e-6) {
          var n0 = bN0[j];
          var al = bAl[j];
          if (aT0[i] >= bT0[j]) { n0 = aN0[i]; al = aAl[i]; }
          var n1 = bN1[j];
          if (aT1[i] <= bT1[j]) { n1 = aN1[i]; }
          rT0[rn] = t0; rT1[rn] = t1; rN0[rn] = n0; rN1[rn] = n1; rAl[rn] = al;
          rn = rn + 1;
        }
      }
    }
  } else {
    // вычитание A − B
    for (var i = 0; i < cntA && rn < INT_MAX; i = i + 1) {
      var seg0 = aT0[i];
      let seg1 = aT1[i];
      var n0 = aN0[i];
      let n1 = aN1[i];
      var al = aAl[i];
      for (var j = 0; j < cntB; j = j + 1) {
        let b0 = bT0[j];
        let b1 = bT1[j];
        if (b1 <= seg0 + 1e-6) { continue; }
        if (b0 >= seg1 - 1e-6) { break; }
        if (b0 > seg0 + 1e-6) {
          if (rn < INT_MAX) {
            rT0[rn] = seg0; rT1[rn] = b0; rN0[rn] = n0; rN1[rn] = -bN0[j]; rAl[rn] = al;
            rn = rn + 1;
          }
        }
        if (b1 < seg1 - 1e-6) {
          seg0 = b1;
          n0 = -bN1[j];
          al = bAl[j];
        } else {
          seg0 = seg1;
          break;
        }
      }
      if (seg1 > seg0 + 1e-6 && rn < INT_MAX) {
        rT0[rn] = seg0; rT1[rn] = seg1; rN0[rn] = n0; rN1[rn] = n1; rAl[rn] = al;
        rn = rn + 1;
      }
    }
  }

  for (k = 0; k < rn; k = k + 1) {
    let i = baseA + k;
    s_t0[i] = rT0[k]; s_t1[i] = rT1[k];
    s_n0[i] = rN0[k]; s_n1[i] = rN1[k]; s_al[i] = rAl[k];
  }
  s_cnt[sA] = rn;
  s_top = sA + 1;
}

// ближайшая видимая грань среди интервалов верхнего списка (для цвета)
fn csgFoldHit(best : Hit, ro : vec3f, rd : vec3f) -> Hit {
  var b = best;
  let s = s_top - 1;
  if (s >= 0) {
    let base = s * INT_MAX;
    let cnt = s_cnt[s];
    for (var k = 0; k < cnt; k = k + 1) {
      let i = base + k;
      let al = s_al[i];
      let ds = al.w;
      let t0 = s_t0[i];
      if (t0 > T_EPS && t0 < b.t && (ds > 0.5 || dot(s_n0[i], rd) < -1e-4)) {
        b = Hit(t0, s_n0[i], al.rgb);
      }
      let t1 = s_t1[i];
      if (t1 > T_EPS && t1 < b.t && (ds > 0.5 || dot(s_n1[i], rd) < -1e-4)) {
        b = Hit(t1, s_n1[i], al.rgb);
      }
    }
  }
  s_top = s_top - 1;
  return b;
}

// есть ли тело на пути к солнцу (для тени)
fn csgBlocked(rd : vec3f) -> bool {
  var blocked = false;
  let s = s_top - 1;
  if (s >= 0) {
    let base = s * INT_MAX;
    let cnt = s_cnt[s];
    for (var k = 0; k < cnt; k = k + 1) {
      let i = base + k;
      let t0 = s_t0[i];
      let t1 = s_t1[i];
      if (t1 - t0 > 1e-5) {
        if (t1 > T_EPS) { blocked = true; }
      } else if (t0 > T_EPS && (s_al[i].w > 0.5 || dot(s_n0[i], rd) < -1e-4)) {
        blocked = true;
      }
    }
  }
  s_top = s_top - 1;
  return blocked;
}

// ------------------------------------------------------------
// ТРАССИРОВКА СЦЕНЫ: ближайшая видимая поверхность по всем корням
// ------------------------------------------------------------

fn traceScene(ro : vec3f, rd : vec3f) -> Hit {
  var best = miss();
  csgReset();
  let n = P.counts.y;
  for (var ip = 0u; ip < n; ip = ip + 1u) {
    let op = csg[ip * 2u];
    let arg = csg[ip * 2u + 1u];
    if (op == OP_LEAF) {
      csgPushLeaf(arg, ro, rd);
    } else if (op == OP_ROOT) {
      best = csgFoldHit(best, ro, rd);
    } else {
      csgCombine(op);
    }
  }
  return best;
}

// жёсткая тень: 0 — между точкой и солнцем есть тело, 1 — свет проходит
fn shadowScene(ro : vec3f, rd : vec3f) -> f32 {
  csgReset();
  let o = ro + rd * 1e-3;   // чуть отодвинулись от своей же поверхности
  let n = P.counts.y;
  for (var ip = 0u; ip < n; ip = ip + 1u) {
    let op = csg[ip * 2u];
    let arg = csg[ip * 2u + 1u];
    if (op == OP_LEAF) {
      csgPushLeaf(arg, o, rd);
    } else if (op == OP_ROOT) {
      if (csgBlocked(rd)) { return 0.0; }
    } else {
      csgCombine(op);
    }
  }
  return 1.0;
}
