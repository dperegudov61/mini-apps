// blit.wgsl — всё, что попадает на экран, и слияние кадра при наполнении статики.
//
// Экран между кадрами ничего не хранит, поэтому кадр живёт в текстуре
// (см. js/gfx/renderer.js): её можно наполнять по частям, а на экран — целиком.
//
// fs_copy  — текстура кадра на экран (с растяжкой: кадр движения меньше экрана).
// fs_merge — слияние «своего» прохода с уже собранным кадром: точки решётки
//            берутся из маленькой текстуры (её пиксель — это точка полного кадра,
//            поэтому никакого сглаживания), остальные пиксели — из собранного.
//            Два прохода с разными смещениями дают вдвое больше точек, весь
//            квадрат решётки — целый кадр без единой растянутой точки.

struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) uv : vec2f,
};

@group(0) @binding(0) var src : texture_2d<f32>;   // маленький кадр прохода
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var acc : texture_2d<f32>;   // уже собранный кадр

// решётка: шаг и смещение первой точки
struct Merge {
  step : f32,
  ox   : f32,
  oy   : f32,
  pad  : f32,
};
@group(0) @binding(3) var<uniform> M : Merge;

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VSOut {
  var tri = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let xy = tri[vi];
  var o : VSOut;
  o.clip = vec4f(xy, 0.0, 1.0);
  o.uv = vec2f(xy.x * 0.5 + 0.5, 0.5 - xy.y * 0.5);
  return o;
}

@fragment
fn fs_copy(v : VSOut) -> @location(0) vec4f {
  return textureSample(src, samp, v.uv);
}

@fragment
fn fs_merge(v : VSOut) -> @location(0) vec4f {
  let p = vec2i(vec2u(v.clip.xy));
  let s = max(i32(M.step), 1);

  // Оба значения берём всегда, а выбираем без ветвления: textureSample нельзя
  // звать под условием (выборка должна быть в едином потоке управления).
  // Точка этого прохода: пиксель маленькой текстуры — ровно эта точка кадра.
  let own = textureLoad(src, vec2i(p.x / s, p.y / s), 0);
  // Остальное — из собранного кадра (для первого прохода — растянутый кадр движения).
  let accCol = textureSample(acc, samp, v.uv);

  let mine = (p.x % s == i32(M.ox)) && (p.y % s == i32(M.oy));
  return select(accCol, own, mine);
}
