// verify.wgsl — дымовой тест вычислительного пайплайна.
// Ничего не сверяет, только доказывает, что compute-шейдер реально запустился:
// пишет в storage-буфер несколько слов, которые CPU читает обратно.

@group(0) @binding(0) var<storage, read_write> words : array<u32, 16>;

@compute @workgroup_size(1)
fn smoke() {
  for (var i = 0u; i < 16u; i = i + 1u) {
    words[i] = 0x5A5A0000u + i;
  }
  words[0] = 0x43505057u; // метка запуска, см. MARK в js/selftest.js
}
