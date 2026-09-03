/*!
 * The shell's wiring: shadow root, canvas, rAF loop, and the bridge between
 * the pure core and the effectful world (DOM, audio, storage).
 */

import { createState, setLayout } from "../core/state.js";
import { step } from "../core/step.js";
import { STAGE_BONUS, MODES, DEFAULT_MODE, modeById } from "../core/constants.js";
import { statsView, hudView, interlevelView, gameOverView, contextVerb } from "../core/select.js";
import { createUI, showOverlay, hideOverlay, showSplash, renderStats, renderSound, statRows,
         renderModes, selectMode, renderBombs, renderSay, renderPlace, denyBomb, setControls, deckInset, placeTouchControls } from "./dom.js";
import { createAudio } from "./audio.js";
import { createStory } from "./story.js";
import { createInput } from "./input.js";
import { draw } from "./render.js";

const MAX_DT = 50;   // a backgrounded tab must not teleport the simulation

/**
 * Mount Buster Whack into a container element.
 * @param {HTMLElement} container - element to render into (must have a size).
 * @param {object} [options]
 * @param {string} [options.storageKey="bw_best"] - localStorage key for the best score.
 * @param {number} [options.seed] - PRNG seed; omit for a fresh random run.
 * @returns {{ destroy: () => void }}
 */
export function mountBusterWhack(container, options = {}) {
  const doc = container && container.ownerDocument;
  const win = (doc && doc.defaultView) || (typeof window !== "undefined" ? window : null);
  if (!win || !(container instanceof win.Element)) {
    throw new TypeError("mountBusterWhack: container must be a DOM element");
  }
  const storageKey = options.storageKey || "bw_best";

  const { root, els } = createUI(container);
  const ctx = els.cv.getContext("2d");
  const audio = createAudio(win);

  let destroyed = false;
  let rafId = null;
  let resizeObserver = null;
  const cleanupFns = [];
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanupFns.push(() => target.removeEventListener(type, fn, opts));
  }

  // ---------- persistence ----------

  function storage() {
    try { return win.localStorage; } catch (e) { return null; }
  }
  let best = 0;
  try { best = Number(storage().getItem(storageKey)) || 0; } catch (e) {}

  // ---------- state ----------

  const seed = options.seed !== undefined
    ? options.seed
    : ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
  // The renderer never touches a DOM, so the media query is read here and
  // handed to the core as data. Guarded: matchMedia is absent in jsdom.
  const motionQuery = win.matchMedia
    ? win.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  const state = createState({ seed, best, reducedMotion: !!(motionQuery && motionQuery.matches) });
  // Honour the OS toggle flipping mid-run. addEventListener is the modern API;
  // Safari before 14 only has addListener, hence the fallback.
  if (motionQuery) {
    const onMotion = (e) => { state.reducedMotion = e.matches; };
    if (motionQuery.addEventListener) on(motionQuery, "change", onMotion);
    else if (motionQuery.addListener) {
      motionQuery.addListener(onMotion);
      cleanupFns.push(() => motionQuery.removeListener(onMotion));
    }
  }

  // ---------- geometry ----------
  // The only place an element is measured. The core and the renderer see
  // plain numbers.

  function resize() {
    const dpr = win.devicePixelRatio || 1;
    const r = els.stage.getBoundingClientRect();
    els.cv.width = Math.round(r.width * dpr);
    els.cv.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the one-hand deck is opaque, so the board is laid out above it, and
    // BOMB is then placed from the board the layout produced
    setLayout(state, r.width, r.height, deckInset(els));
    placeTouchControls(els, state.G);
  }
  setControls(els, modeById(state.modeId).controls);
  resize();

  const RO = win.ResizeObserver || (typeof ResizeObserver !== "undefined" ? ResizeObserver : null);
  if (RO) {
    resizeObserver = new RO(() => resize());
    resizeObserver.observe(els.stage);
  } else {
    on(win, "resize", resize);
  }

  // ---------- input ----------

  const queue = [];
  const dispatch = (intent) => queue.push(intent);

  function toggleMute() {
    const muted = audio.toggleMute();
    renderSound(els, !muted);
  }

  renderModes(els, MODES, DEFAULT_MODE);
  const input = createInput({
    win, host: container, root, els, on, dispatch,
    onGesture: () => audio.resume(),
    onMute: toggleMute,
    modes: MODES,
    onModeChange: (id) => selectMode(els, id),
  });

  // ---------- core events -> DOM ----------

  let verb = "bomb";
  function refreshStats() {
    renderStats(els, statsView(state));
    renderBombs(els, state.bombs || 0, verb);
  }

  // ---------- story ----------
  // Lines are a strip over the board. Nothing here has a timer: the box
  // opens, advances and closes on the context button only.

  const story = createStory({
    say: (who, text) => renderSay(els, who, text),
    hush: () => renderSay(els, "", ""),
    place: (text) => renderPlace(els, text),
    // never the text; only that it could not be opened, and why
    onError: (e) => { try { win.console.warn("buster-whack: canon unavailable:", e && e.message); } catch (err) {} },
  });

  function showInterlevel(ev) {
    const v = interlevelView(state, ev.stage, ev.timeBonus === undefined ? STAGE_BONUS : ev.timeBonus);
    showOverlay(doc, els, {
      eyebrow: v.eyebrow,
      title: v.title,
      sub: v.sub,
      stats: statRows(v.rows),
      buttons: [
        { label: "CONTINUE", fn: () => dispatch({ type: "resume" }) },
        { label: "END RUN", dim: true, fn: () => dispatch({ type: "endRun" }) },
      ],
    });
  }

  function showOver() {
    const v = gameOverView(state);
    showOverlay(doc, els, {
      eyebrow: v.eyebrow,
      title: v.title,
      rank: v.rank,
      sub: v.sub,
      stats: statRows(v.rows),
      // retry the mode you were playing, not whatever the menu last had lit
      buttons: [{ label: "RETRY", fn: () => { audio.resume(); dispatch({ type: "startRun", modeId: state.modeId }); } }],
    });
  }

  /** The control scheme rides on the mode: lay the shell out for the run that just began. */
  function applyControls(modeId) {
    const mode = modeById(modeId);
    setControls(els, mode.controls);
    input.setControls(mode.controls, { tapMove: !!mode.tapMove });
    resize();
  }

  function handleEvent(ev) {
    switch (ev.type) {
      case "statsChanged": refreshStats(); break;
      case "runStarted":   hideOverlay(els); applyControls(ev.modeId); break;
      case "resumed":      hideOverlay(els); break;
      case "bombEmpty":    denyBomb(els); break;
      case "talk": {
        const ctxv = contextVerb(state);
        verb = (ctxv.npc && story.label(ctxv.npc)) || ctxv.verb;
        refreshStats();
        break;
      }
      case "stageGate":    showInterlevel(ev); break;
      case "gameOver":
        if (ev.newBest) {
          try { storage().setItem(storageKey, String(ev.best)); } catch (e) {}
        }
        showOver();
        break;
      case "paused":
      case "unpaused":
        // Drop focus off the pause button so Space doesn't re-trigger it, but
        // park it back on the stage — that is what keeps the keyboard ours.
        if (root.activeElement && root.activeElement !== els.stage) root.activeElement.blur();
        input.focus();
        break;
      default: break;
    }
  }

  // ---------- frame ----------

  const raf = win.requestAnimationFrame
    ? win.requestAnimationFrame.bind(win)
    : requestAnimationFrame;
  const caf = win.cancelAnimationFrame
    ? win.cancelAnimationFrame.bind(win)
    : cancelAnimationFrame;

  let lastFrame = 0;

  function frame(nowRaf) {
    const dt = Math.min(MAX_DT, nowRaf - lastFrame);
    lastFrame = nowRaf;

    const actions = queue.splice(0, queue.length);
    const events = step(state, dt, { actions, hold: input.hold() });

    audio.handleAll(events);
    story.handleAll(events);
    for (const ev of events) handleEvent(ev);

    // the context button reads from where you stand, and from the state of
    // the conversation with the person there; walking off closes their box
    const ctxv = contextVerb(state);
    if (story.open && (ctxv.verb === "bomb" || story.label(ctxv.npc) === null)) story.leave();
    const cv = (ctxv.npc && story.label(ctxv.npc)) || ctxv.verb;
    if (cv !== verb) { verb = cv; refreshStats(); }

    // Continuous audio (music transport, the charge sweep, the low-time alarm)
    // is derived from the same view model the HUD draws, rather than from
    // events, so no transition can be missed and nothing can be left ringing.
    audio.observe(hudView(state), state.charge.downAt !== null, state.charge.full);

    draw(ctx, state, state.clock);

    rafId = raf(frame);
  }

  // ---------- boot ----------

  refreshStats();
  showSplash(els, state.best);
  lastFrame = (win.performance || performance).now();
  rafId = raf(frame);

  // ---------- teardown ----------

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (rafId !== null) caf(rafId);
    if (resizeObserver) resizeObserver.disconnect();
    for (const fn of cleanupFns) fn();
    audio.close();
    root.innerHTML = "";
  }

  return { destroy };
}

export default mountBusterWhack;
