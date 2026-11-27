/* input.js — мышь, палец и клавиши на канвасе → камера.
   Перетаскивание вращает, колесо приближает, клавиши двигают и поворачивают. */
(function (GE) {
  'use strict';

  function isForm(el) {
    var tag = el && el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  GE.attachInput = function (canvas, camera) {
    canvas.style.touchAction = 'none';
    var drag = null;

    canvas.addEventListener('pointerdown', function (e) {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var w = Math.max(canvas.clientWidth, 1);
      var h = Math.max(canvas.clientHeight, 1);
      var dx = (e.clientX - drag.x) / w;
      var dy = (e.clientY - drag.y) / h;
      drag.x = e.clientX;
      drag.y = e.clientY;
      camera.orbit(dx, dy);
    });

    function endDrag(e) {
      if (drag && e && e.pointerId !== drag.id) return;
      drag = null;
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', endDrag);

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      camera.zoom(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    // клавиши слушаем на окне, чтобы работали без щелчка по канвасу
    window.addEventListener('keydown', function (e) {
      if (isForm(e.target)) return;
      camera.keys[e.code] = true;
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown' ||
          e.code === 'ArrowLeft' || e.code === 'ArrowRight' ||
          e.code === 'KeyW' || e.code === 'KeyA' ||
          e.code === 'KeyS' || e.code === 'KeyD') {
        e.preventDefault();   // иначе страница прокручивается вместо вращения
      }
    });

    window.addEventListener('keyup', function (e) {
      delete camera.keys[e.code];
    });

    window.addEventListener('blur', function () {
      camera.keys = {};
      drag = null;
    });
  };
})(window.GE = window.GE || {});
