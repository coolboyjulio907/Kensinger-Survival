/* =========================================================
   Input — keyboard (WASD + Arrows), mouse, gamepad.
   - Esc / P toggles pause during a run.
   - F / E are forwarded to the wave-break screens
     (F = reroll, E = lock) via hotkey handlers.
   - Mouse position drives Manual Aim / Mouse Only settings;
     gamepad left stick drives movement when enabled.
   ========================================================= */
window.KS = window.KS || {};

KS.Input = (() => {
  const down = new Set();
  const MAP = {
    KeyW: 'up',    ArrowUp: 'up',
    KeyS: 'down',  ArrowDown: 'down',
    KeyA: 'left',  ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
  };
  let onPause = null;
  const hotkeys = {};                 // { KeyF: fn, KeyE: fn }
  const mouse = { x: 0, y: 0, inside: false, down: false };

  window.addEventListener('keydown', (e) => {
    if (KS.DevMode && KS.DevMode.isOpen()) return;  // console owns the keyboard
    const dir = MAP[e.code];
    if (dir) { down.add(dir); e.preventDefault(); } // stop page scrolling
    if ((e.code === 'Escape' || e.code === 'KeyP') && onPause) {
      onPause();
      e.preventDefault();
      return;
    }
    if (!e.repeat && hotkeys[e.code]) { hotkeys[e.code](); e.preventDefault(); }
  });

  window.addEventListener('keyup', (e) => {
    const dir = MAP[e.code];
    if (dir) down.delete(dir);
  });

  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true;
  });
  window.addEventListener('mousedown', (e) => { if (e.button === 0) mouse.down = true; });
  window.addEventListener('mouseup',   (e) => { if (e.button === 0) mouse.down = false; });
  window.addEventListener('mouseleave', () => { mouse.inside = false; mouse.down = false; });

  window.addEventListener('blur', () => { down.clear(); mouse.down = false; });

  /* gamepad left-stick / d-pad movement */
  function gamepadAxis() {
    if (!KS.Settings.get().gamepadMove) return { x: 0, y: 0 };
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      let x = 0, y = 0;
      const [lx, ly] = [pad.axes[0] || 0, pad.axes[1] || 0];
      if (Math.abs(lx) > 0.22) x += lx;
      if (Math.abs(ly) > 0.22) y += ly;
      const b = pad.buttons;
      if (b[12] && b[12].pressed) y -= 1;   // d-pad up
      if (b[13] && b[13].pressed) y += 1;
      if (b[14] && b[14].pressed) x -= 1;
      if (b[15] && b[15].pressed) x += 1;
      if (x !== 0 || y !== 0) {
        const d = Math.hypot(x, y);
        if (d > 1) { x /= d; y /= d; }
        return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }

  return {
    setPauseHandler(fn) { onPause = fn; },
    setHotkey(code, fn) { if (fn) hotkeys[code] = fn; else delete hotkeys[code]; },
    clearHotkeys() { for (const k of Object.keys(hotkeys)) delete hotkeys[k]; },
    mouse,
    gamepadAxis,
    axis() {
      let x = 0, y = 0;
      if (down.has('left'))  x -= 1;
      if (down.has('right')) x += 1;
      if (down.has('up'))    y -= 1;
      if (down.has('down'))  y += 1;
      if (x === 0 && y === 0) {
        const g = gamepadAxis();
        x = g.x; y = g.y;
      }
      /* Mouse Only: keyboard disabled, walk toward the cursor */
      if (KS.Settings.get().mouseOnly) return { x: 0, y: 0, mouseOnly: true };
      if (x !== 0 && y !== 0) { const k = Math.SQRT1_2; x *= k; y *= k; }
      return { x, y };
    },
  };
})();
