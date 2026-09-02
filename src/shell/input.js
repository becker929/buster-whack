/*!
 * Input shell: DOM pointer / keyboard / d-pad -> core intents.
 *
 * Nothing here touches game state. Discrete inputs are queued via `dispatch`
 * and drained by the frame loop; the analog ring's held direction is polled
 * each frame through `hold()`.
 *
 * Three rules shape everything below, and all three exist because the game is
 * a *guest* on someone else's page — often inside a sandboxed iframe on a
 * phone:
 *
 *   1. Every press is owned by the source that made it. A finger on the ring
 *      and a finger on FIRE are two independent pointers; releasing one must
 *      not release the other. Same for the keyboard.
 *   2. Touch gestures that start on the game stop at the game. The host page
 *      must never read them as a scroll, a swipe or a pinch.
 *   3. The keyboard is only ours when nobody else has claimed it. A host page's
 *      text field outranks the player.
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

// A second tap inside this window is iOS's double-tap-to-zoom, not a second shot.
const DOUBLE_TAP_MS = 350;

// The keyboard's source id. Pointers use their `pointerId`, which is always a
// number, so a string can never collide with one.
const KEY_SOURCE = "key";

/**
 * The fire button's press/release latch, keyed by *who* is holding it.
 *
 * This is the whole fix for "a held charge auto-fires when you move": a release
 * only counts when it comes from the source that made the press. A d-pad drag,
 * a pause tap, a stray thumb on the footer and a Space keyup all carry a
 * different source, so none of them can spend a charge or hand the `canFire`
 * latch back.
 *
 * Pure and DOM-free on purpose — the state machine is unit-tested directly.
 *
 * @param {(intent: object) => void} dispatch
 */
export function createFireLatch(dispatch) {
  let holder = null;   // null | "key" | pointerId

  // A pointerId of 0 is falsy but perfectly valid; only undefined is "no source".
  const norm = (src) => (src === undefined ? null : src);

  return {
    /** Who holds the button, or null. */
    get holder() { return holder; },

    /**
     * Take the button for `src`. A second source pressing while one already
     * holds it is ignored — which is what the core's `canFire` latch already
     * did, except now the shell and the core agree on *why*.
     * @returns {boolean} true if this press was the one that latched.
     */
    press(src) {
      if (holder !== null) return false;
      const id = norm(src);
      if (id === null) return false;
      holder = id;
      dispatch({ type: "firePressed" });
      return true;
    },

    /**
     * Release, but only for the source that pressed.
     * @returns {boolean} true if this release actually let go.
     */
    release(src) {
      if (holder === null || holder !== norm(src)) return false;
      holder = null;
      dispatch({ type: "fireReleased" });
      return true;
    },

    /**
     * Let go no matter who was holding — for blur, page-hide and teardown,
     * where the press can no longer be completed. The player must never be
     * left unable to fire.
     */
    releaseAny() {
      if (holder === null) return false;
      holder = null;
      dispatch({ type: "fireReleased" });
      return true;
    },
  };
}

/**
 * @param {object} o
 * @param {Window} o.win
 * @param {Element} o.host - the element the game is mounted into (the shadow host)
 * @param {ShadowRoot} o.root - the shadow root holding `els`
 * @param {Record<string, Element>} o.els - refs from dom.createUI
 * @param {(target, type, fn, opts?) => void} o.on - listener registrar that also records teardown
 * @param {(intent: object) => void} o.dispatch - queue an intent for the next step
 * @param {() => void} o.onGesture - user gesture (unlock audio)
 * @param {() => void} o.onMute - toggle sound (shell-side)
 * @returns {{ hold: () => ({dc:number,dr:number}|null), focus: () => void }}
 */
export function createInput({ win, host, root, els, on, dispatch, onGesture, onMute, modes, onModeChange }) {
  const doc = (host && host.ownerDocument) || win.document;
  const latch = createFireLatch(dispatch);

  // ---------- mode selection ----------
  // The menu only exists on the start screen, so selection lives here rather
  // than in core state: it is a shell affordance until the moment it seeds a run.
  const modeList = modes && modes.length ? modes : [{ id: "classic" }];
  let modeIdx = 0;
  const modeId = () => modeList[modeIdx].id;
  function setMode(id) {
    const i = modeList.findIndex((m) => m.id === id);
    if (i < 0 || i === modeIdx) return;
    modeIdx = i;
    if (onModeChange) onModeChange(modeId());
  }
  function stepMode(d) {
    setMode(modeList[(modeIdx + d + modeList.length) % modeList.length].id);
  }
  /** True while the start screen is up, so arrows drive the menu, not the buster. */
  const onMenu = () => !els.splash.classList.contains("hidden");

  // ---------- focus ----------
  // The stage carries `tabindex="0"`, so the game is a real focus target. Any
  // interaction with it claims the keyboard; anything else on the page keeps it.

  function focusStage() {
    try { els.stage.focus({ preventScroll: true }); } catch (e) { /* older engines */ }
  }

  /**
   * Does the game plausibly own the keyboard right now?
   *
   * Yes when focus is inside our shadow tree — `document.activeElement` reports
   * the host element for shadow content — and yes when *nothing* on the page has
   * focus at all. That second case is what keeps a bare page like `index.html`
   * playable the instant it loads, with no focus target to hunt for. Anything
   * else — a host page's input, textarea, link or button — outranks us, and we
   * do not so much as `preventDefault`.
   */
  function ownsKeyboard() {
    const a = doc.activeElement;
    if (a === host) return true;
    if (host && a && host.contains(a)) return true;
    if (root && root.activeElement) return true;
    return !a || a === doc.body || a === doc.documentElement;
  }

  // ---------- keyboard ----------

  on(win, "keydown", (e) => {
    // never fight the browser's own chords (⌘←, ctrl-arrow, …)
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!ownsKeyboard()) return;

    const mk = MOVE_KEYS[e.code];
    // While the start screen is up the arrows drive the menu. Vertical only:
    // left/right would fight the muscle memory of moving the buster, and the
    // list is vertical.
    if (mk && onMenu()) {
      if (mk[1]) { e.preventDefault(); stepMode(mk[1]); }
      return;
    }
    if (mk) { e.preventDefault(); dispatch({ type: "move", dc: mk[0], dr: mk[1] }); return; }
    if (e.code === "KeyP" || e.code === "Escape") { e.preventDefault(); dispatch({ type: "pause" }); return; }
    if (e.code === "KeyM") { e.preventDefault(); onMute(); return; }
    // secondary fire: B, or either Shift. A tap, not a hold.
    if (e.code === "KeyB" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
      e.preventDefault();
      if (e.repeat) return;
      onGesture();
      dispatch({ type: "bomb" });
      return;
    }
    if (e.code !== "Space") return;
    e.preventDefault();
    if (e.repeat) return;
    onGesture();
    latch.press(KEY_SOURCE);
  });

  // Deliberately *not* gated on `ownsKeyboard()`: if focus moves while Space is
  // held, this is still the release for a press we took — and the latch's
  // identity check makes it a no-op for a press we never took.
  on(win, "keyup", (e) => {
    if (e.code !== "Space") return;
    latch.release(KEY_SOURCE);
  });

  // ---------- fire ----------

  for (const triggerEl of [els.cv, els.fireBtn]) {
    on(triggerEl, "pointerdown", (e) => {
      e.preventDefault();
      onGesture();
      // Capture so the release comes back to us even when the thumb slides off
      // the button, and so `lostpointercapture` can act as a backstop if the
      // browser takes the pointer away without ever sending a pointerup.
      try { triggerEl.setPointerCapture(e.pointerId); } catch (err) { /* unsupported */ }
      latch.press(e.pointerId);
    });
    on(triggerEl, "lostpointercapture", (e) => latch.release(e.pointerId));
  }

  // the bomb button is a tap: no latch, no capture, nothing to release
  on(els.bombBtn, "pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onGesture();
    dispatch({ type: "bomb" });
  });

  // Window-level, so a release that lands anywhere still reaches us — but only
  // the pointer that actually pressed can act on it.
  on(win, "pointerup", (e) => latch.release(e.pointerId));
  on(win, "pointercancel", (e) => latch.release(e.pointerId));

  on(win, "blur", () => {
    latch.releaseAny();
    dispatch({ type: "pauseOnBlur" });
  });
  // iOS backgrounds a WKWebView without reliably firing `blur`; without this a
  // charge could survive an app switch and the latch could strand.
  on(doc, "visibilitychange", () => {
    if (doc.visibilityState !== "hidden") return;
    latch.releaseAny();
    dispatch({ type: "pauseOnBlur" });
  });

  // ---------- analog ring d-pad ----------

  const pad = els.dpad;
  const arrows = { up: els.aUp, down: els.aDown, left: els.aLeft, right: els.aRight };
  const padState = { id: null, dc: 0, dr: 0 };

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
    if (padState.id !== null) return;   // one thumb drives the ring
    try { pad.setPointerCapture(e.pointerId); } catch (err) {}
    padState.id = e.pointerId;
    pad.classList.add("live");
    padUpdate(e);
  });
  on(pad, "pointermove", (e) => {
    // The ring reads *its own* finger only. Without this the FIRE thumb's moves
    // would steer the player on any engine where pointer capture is missing.
    if (padState.id !== e.pointerId) return;
    e.preventDefault();
    padUpdate(e);
  });
  function padEnd(e) {
    if (e && padState.id !== e.pointerId) return;
    padState.id = null;
    padState.dc = 0; padState.dr = 0;
    pad.classList.remove("live");
    padSetArrows();
  }
  on(pad, "pointerup", padEnd);
  on(pad, "pointercancel", padEnd);
  on(pad, "lostpointercapture", padEnd);
  on(win, "blur", () => padEnd(null));

  // ---------- buttons ----------

  on(els.pauseBtn, "pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: "pause" });
  });

  // A click anywhere on the start screen starts the run, arcade-style — click
  // rather than pointerdown so a drag can still scroll the card on a short
  // stage. The button keeps the game's snappier pointerdown feel.
  // Tapping a mode row picks it *and* starts it: on a cabinet you do not
  // select and then separately confirm. The click handler below would also
  // fire, so picking stops propagation and starts the run itself.
  on(els.spModes, "click", (e) => {
    const row = e.target.closest && e.target.closest(".sp-mode");
    if (!row) return;
    e.stopPropagation();
    onGesture();
    setMode(row.dataset.mode);
    dispatch({ type: "startRun", modeId: modeId() });
  });
  on(els.splash, "click", () => { onGesture(); dispatch({ type: "startRun", modeId: modeId() }); });
  on(els.spStart, "pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onGesture();
    dispatch({ type: "startRun", modeId: modeId() });
  });

  // ---------- gesture containment ----------

  installGestureGuards({ els, on, focusStage });

  return {
    hold: () => (padState.id !== null && (padState.dc || padState.dr)
      ? { dc: padState.dc, dr: padState.dr }
      : null),
    focus: focusStage,
  };
}

/**
 * Keep touch gestures that begin on the game from reaching the host page.
 *
 * `touch-action` in the template does most of the work, but it cannot do all of
 * it: it does not stop scroll chaining, it does not exist for iOS's `gesture*`
 * pinch events, and an engine that has already committed to a pan will not
 * honour it retroactively. So the CSS is backed here by non-passive `touchmove`
 * cancellation on the game's own surface — `addEventListener` defaults touch
 * listeners to passive on most browsers, hence the explicit `{ passive: false }`.
 *
 * Every listener hangs off the game's root element *inside* the shadow tree —
 * never the document, never the window — so a gesture starting anywhere else on
 * the host page behaves completely normally, and `destroy()` removes the lot.
 *
 * The deliberate exception is the start card, which is `overflow: auto` and
 * genuinely scrollable on a short mount — a drag there has to be able to reach
 * PRESS START. It keeps `touch-action: pan-y`, and the drag is cancelled only
 * once the card has nothing left to scroll, which is where a chained gesture
 * would otherwise escape into the host page.
 */
function installGestureGuards({ els, on, focusStage }) {
  const surface = els.bwRoot;
  const nonPassive = { passive: false };

  const onSplash = (target) =>
    !els.splash.classList.contains("hidden") && els.splash.contains(target);

  /**
   * Should this drag be allowed to scroll the start card?
   *
   * Only while the card still has somewhere to go in that direction. At either
   * end the scroll would chain out to the host page — which is the whole bug —
   * so we cancel it instead. This is `overscroll-behavior: contain` done by
   * hand, because the CSS property is unevenly supported in older WKWebView and,
   * on a desktop, would also swallow the mouse wheel over the card.
   */
  let dragFromY = 0;
  function splashCanScroll(e) {
    if (!onSplash(e.target)) return false;
    const sp = els.splash;
    const max = sp.scrollHeight - sp.clientHeight;
    if (max <= 0) return false;                       // nothing to scroll at all
    const dy = (e.touches[0] ? e.touches[0].clientY : dragFromY) - dragFromY;
    if (dy > 0 && sp.scrollTop <= 0) return false;    // already at the top
    if (dy < 0 && sp.scrollTop >= max - 1) return false;   // already at the bottom
    return true;
  }

  // Touching the game is what claims the keyboard. Capture phase, so it still
  // runs for the controls that stop propagation in their own pointerdown.
  on(surface, "pointerdown", () => focusStage(), true);

  // Two fingers on the game is the fire-plus-ring grip, never a pinch.
  on(surface, "touchstart", (e) => {
    if (e.touches[0]) dragFromY = e.touches[0].clientY;
    if (e.touches.length > 1 && e.cancelable && !onSplash(e.target)) e.preventDefault();
  }, nonPassive);

  // The main event: a drag on the ring, the canvas or a button belongs to the
  // game, and the host must not read it as a scroll, swipe or dismiss.
  on(surface, "touchmove", (e) => {
    if (!e.cancelable) return;                       // the pan already won; nothing to cancel
    if (e.touches.length > 1) { e.preventDefault(); return; }
    if (splashCanScroll(e)) return;                  // let the start card scroll itself
    e.preventDefault();
  }, nonPassive);

  // Double-tap-to-zoom, for engines that honour `touch-action` less than they
  // should. Skipped on the start card, whose PRESS START is a real click.
  let lastTapAt = 0;
  on(surface, "touchend", (e) => {
    const now = Date.now();
    if (!onSplash(e.target) && e.cancelable && now - lastTapAt < DOUBLE_TAP_MS) e.preventDefault();
    lastTapAt = now;
  }, nonPassive);

  // iOS Safari / WKWebView pinch-zoom, which is not a touch event at all.
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    on(surface, type, (e) => { if (e.cancelable !== false) e.preventDefault(); }, nonPassive);
  }

  // Long-press callout, drag-out of the canvas, and selection on a rocked thumb.
  on(surface, "contextmenu", (e) => e.preventDefault());
  on(surface, "dragstart", (e) => e.preventDefault());
  on(surface, "selectstart", (e) => e.preventDefault());
}
