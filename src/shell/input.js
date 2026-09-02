/*!
 * Input shell: DOM pointer / keyboard / d-pad -> core intents.
 *
 * Nothing here touches game state. Discrete inputs are queued via `dispatch`
 * and drained by the frame loop; the analog ring's held direction is polled
 * each frame through `hold()`.
 */

const MOVE_KEYS = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};

// Neutral hub radius = 2/5 of ring radius. Outside it, per-axis thresholds
// resolve to one direction (cardinal) or two (diagonal). Held/rocked input
// repeats via the core's own MOVE_REPEAT_MS throttle, polled each frame.
const PAD_NEUTRAL = 0.4;   // 2/5 of ring radius
const PAD_AXIS = 0.42;     // sin/cos threshold; the 45° band presses both axes

/**
 * @param {object} o
 * @param {Window} o.win
 * @param {Record<string, Element>} o.els - refs from dom.createUI
 * @param {(target, type, fn, opts?) => void} o.on - listener registrar that also records teardown
 * @param {(intent: object) => void} o.dispatch - queue an intent for the next step
 * @param {() => void} o.onGesture - user gesture (unlock audio)
 * @param {() => void} o.onMute - toggle sound (shell-side)
 * @returns {{ hold: () => ({dc:number,dr:number}|null) }}
 */
export function createInput({ win, els, on, dispatch, onGesture, onMute }) {
  // ---------- keyboard ----------

  on(win, "keydown", (e) => {
    const mk = MOVE_KEYS[e.code];
    if (mk) { e.preventDefault(); dispatch({ type: "move", dc: mk[0], dr: mk[1] }); return; }
    if (e.code === "KeyP" || e.code === "Escape") { e.preventDefault(); dispatch({ type: "pause" }); return; }
    if (e.code === "KeyM") { onMute(); return; }
    if (e.code !== "Space") return;
    e.preventDefault();
    if (e.repeat) return;
    onGesture();
    dispatch({ type: "firePressed" });
  });

  on(win, "keyup", (e) => {
    if (e.code !== "Space") return;
    dispatch({ type: "fireReleased" });
  });

  // ---------- fire ----------

  for (const triggerEl of [els.cv, els.fireBtn]) {
    on(triggerEl, "pointerdown", (e) => {
      e.preventDefault();
      onGesture();
      dispatch({ type: "firePressed" });
    });
  }
  on(win, "pointerup", () => dispatch({ type: "fireReleased" }));
  on(win, "pointercancel", () => dispatch({ type: "fireReleased" }));
  on(win, "blur", () => {
    dispatch({ type: "fireReleased" });
    dispatch({ type: "pauseOnBlur" });
  });

  // ---------- analog ring d-pad ----------

  const pad = els.dpad;
  const arrows = { up: els.aUp, down: els.aDown, left: els.aLeft, right: els.aRight };
  const padState = { active: false, dc: 0, dr: 0 };

  function padSetArrows() {
    arrows.up.classList.toggle("on", padState.dr < 0);
    arrows.down.classList.toggle("on", padState.dr > 0);
    arrows.left.classList.toggle("on", padState.dc < 0);
    arrows.right.classList.toggle("on", padState.dc > 0);
  }

  function padUpdate(e) {
    const r = pad.getBoundingClientRect();
    const R = r.width / 2;
    const dx = e.clientX - (r.left + R);
    const dy = e.clientY - (r.top + R);
    const d = Math.hypot(dx, dy);
    let dc = 0, dr = 0;
    if (d >= R * PAD_NEUTRAL && d > 0) {
      if (dx / d > PAD_AXIS) dc = 1; else if (dx / d < -PAD_AXIS) dc = -1;
      if (dy / d > PAD_AXIS) dr = 1; else if (dy / d < -PAD_AXIS) dr = -1;
    }
    if ((dc !== padState.dc || dr !== padState.dr) && (dc || dr)) {
      dispatch({ type: "resetMoveThrottle" });   // direction change (rocking) responds immediately
    }
    padState.dc = dc; padState.dr = dr;
    padSetArrows();
  }

  on(pad, "pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { pad.setPointerCapture(e.pointerId); } catch (err) {}
    padState.active = true;
    pad.classList.add("live");
    padUpdate(e);
  });
  on(pad, "pointermove", (e) => {
    if (!padState.active) return;
    e.preventDefault();
    padUpdate(e);
  });
  function padEnd() {
    padState.active = false;
    padState.dc = 0; padState.dr = 0;
    pad.classList.remove("live");
    padSetArrows();
  }
  on(pad, "pointerup", padEnd);
  on(pad, "pointercancel", padEnd);
  on(pad, "lostpointercapture", padEnd);

  // ---------- buttons ----------

  on(els.pauseBtn, "pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: "pause" });
  });

  // A click anywhere on the start screen starts the run, arcade-style — click
  // rather than pointerdown so a drag can still scroll the card on a short
  // stage. The button keeps the game's snappier pointerdown feel.
  on(els.splash, "click", () => { onGesture(); dispatch({ type: "startRun" }); });
  on(els.spStart, "pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onGesture();
    dispatch({ type: "startRun" });
  });

  return {
    hold: () => (padState.active && (padState.dc || padState.dr)
      ? { dc: padState.dc, dr: padState.dr }
      : null),
  };
}
