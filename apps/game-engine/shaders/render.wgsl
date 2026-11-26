// render.wgsl — шейдер сцены.
// Рисуется одним fullscreen-треугольником: фон + сетка + текстура с процессора
// + мяч, положение которого считает игровая логика на CPU (js/game.js).

//#include params.wgsl

@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var tex : texture_2d<f32>;
@group(0) @binding(2) var samp : sampler;

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

fn hash21(p : vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q = q + dot(q, q + 45.32);
  return fract(q.x * q.y);
}

// палитра «cosine palette» — непрерывно меняет цвет по одному числу
fn palette(t : f32) -> vec3f {
  return 0.5 + 0.5 * cos(6.28318530718 * (vec3f(0.0, 0.33, 0.67) + t));
}

@fragment
fn fs_main(v : VSOut) -> @location(0) vec4f {
  let size = max(P.resolution, vec2f(1.0, 1.0));
  let px = v.uv * size;
  let unit = min(size.x, size.y);
  let c = (px - size * 0.5) / unit;
  let t = P.time;

  // --- 1. фон: плазма из синусов -------------------------------------------
  let w1 = sin(c.x * 9.0 + t * 0.9) * cos(c.y * 7.0 - t * 0.6);
  let w2 = sin(length(c * vec2f(1.0, 1.28)) * 15.0 - t * 1.6);
  var col = vec3f(0.014, 0.021, 0.034);
  col = col + palette(P.hueShift + 0.10 * w1) * (0.070 + 0.055 * w1);
  col = col + palette(P.hueShift + 0.55) * 0.045 * smoothstep(-0.2, 1.0, w2);
  col = col + vec3f(hash21(px * 0.7 + vec2f(t * 21.0, t * 13.0))) * 0.012;

  // --- 2. сетка ------------------------------------------------------------
  let cell = 34.0;
  let dx = min(fract(px.x / cell), 1.0 - fract(px.x / cell));
  let dy = min(fract(px.y / cell), 1.0 - fract(px.y / cell));
  let grid = 1.0 - smoothstep(0.0, 0.035, min(dx, dy));
  col = col + vec3f(0.045, 0.085, 0.115) * grid;

  // --- 3. текстура, сгенерированная на процессоре --------------------------
  let aspect = size.x / size.y;
  let drift = vec2f(t * 0.017, t * 0.011) + (P.mouse / size - vec2f(0.5)) * 0.18;
  let tuv = vec2f(v.uv.x * aspect, v.uv.y) * 0.9 + drift;
  let texCol = textureSample(tex, samp, tuv).rgb;
  let texLum = dot(texCol, vec3f(0.299, 0.587, 0.114));
  col = col + mix(vec3f(texLum), texCol, 0.7) * P.texMix * 0.30;

  // --- 4. след мяча --------------------------------------------------------
  let br = max(P.ball.z, 1.0) / unit;
  var trail = vec3f(0.0);
  for (var i = 1; i <= 7; i = i + 1) {
    let f = f32(i) / 7.0;
    let tp = (P.ball.xy - P.extra.xy * f * 0.075 - size * 0.5) / unit;
    let d = length(c - tp);
    let r = max(br * (1.0 - 0.6 * f), 1e-4);
    trail = trail + palette(P.hueShift + 0.3 + 0.12 * f) * exp(-d * d / (r * r * 0.8)) * (0.30 * (1.0 - f));
  }

  // --- 5. мяч --------------------------------------------------------------
  let bc = (P.ball.xy - size * 0.5) / unit;
  let bd = length(c - bc);
  let core = 1.0 - smoothstep(br * 0.75, br, bd);
  let halo = exp(-(bd * bd) / max(br * br * 3.2, 1e-6)) * 0.65;
  let ph = fract(t * 0.7);
  let rx = (bd - br * (1.5 + ph * 2.6)) / max(br * 0.14, 1e-5);
  let ring = exp(-rx * rx) * (1.0 - ph) * 0.45;
  let hot = palette(P.hueShift + 0.62);
  col = col + hot * (core * 1.5 + halo + ring) + vec3f(core * 0.22);

  // --- 6. прицел мыши (тоже значение с процессора) --------------------------
  let mc = (P.mouse - size * 0.5) / unit;
  let md = length(c - mc);
  let lines = step(abs(c.y - mc.y), 0.0035) * step(abs(c.x - mc.x), 0.055)
            + step(abs(c.x - mc.x), 0.0035) * step(abs(c.y - mc.y), 0.055);
  let mx = (md - 0.05) / 0.004;
  let reticle = exp(-mx * mx);
  col = col + vec3f(0.35, 0.85, 1.0) * (lines * 0.35 + reticle * 0.45) * (0.6 + 0.4 * P.extra.w);

  // --- 7. постобработка ----------------------------------------------------
  col = col * (0.965 + 0.035 * sin(px.y * 2.4));
  let vig = 1.0 - smoothstep(0.42, 1.0, length(v.uv - vec2f(0.5)) * 1.45);
  col = col * mix(0.62, 1.0, vig);
  col = col + vec3f((hash21(px + vec2f(P.frame, P.frame * 1.7)) - 0.5) * 0.014);

  return vec4f(max(col, vec3f(0.0)), 1.0);
}
