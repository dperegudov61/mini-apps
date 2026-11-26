/* input.js — мышь и палец на канвасе → координаты в пикселях кадра. */
(function (GE) {
  'use strict';

  function toCanvasPixels(canvas, e) {
    var rect = canvas.getBoundingClientRect();
    var sx = canvas.width / Math.max(rect.width, 1);
    var sy = canvas.height / Math.max(rect.height, 1);
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy
    };
  }

  GE.attachInput = function (canvas, game) {
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointermove', function (e) {
      var p = toCanvasPixels(canvas, e);
      game.setMouse(p.x, p.y, true);
    });

    canvas.addEventListener('pointerleave', function () {
      game.setMouse(game.mouse.x, game.mouse.y, false);
    });

    canvas.addEventListener('pointerdown', function (e) {
      var p = toCanvasPixels(canvas, e);
      game.setMouse(p.x, p.y, true);
      game.kick();
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    });
  };
})(window.GE = window.GE || {});
