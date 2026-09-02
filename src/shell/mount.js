/*!
 * The shell's wiring: shadow root, canvas, rAF loop, and the bridge between
 * the pure core and the effectful world (DOM, audio, storage).
 */

import { createState, setLayout } from "../core/state.js";
import { step } from "../core/step.js";
import { STAGE_BONUS } from "../core/constants.js";
import { statsView, interlevelView, gameOverView } from "../core/select.js";
import { createUI, showOverlay, hideOverlay, showSplash, renderStats, renderSound, statRows } from "./dom.js";
import { createAudio } from "./audio.js";
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
  const state = createState({ seed, best });

  // ---------- geometry ----------
  // The only place an element is measured. The core and the renderer see
  // plain numbers.

  function resize() {
    const dpr = win.devicePixelRatio || 1;
    const r = els.stage.getBoundingClientRect();
    els.cv.width = Math.round(r.width * dpr);
    els.cv.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    setLayout(state, r.width, r.height);
  }
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

  const input = createInput({
    win, els, on, dispatch,
    onGesture: () => audio.resume(),
    onMute: toggleMute,
  });

  // ---------- core events -> DOM ----------

  function refreshStats() {
    renderStats(els, statsView(state));
  }

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
      buttons: [{ label: "RETRY", fn: () => { audio.resume(); dispatch({ type: "startRun" }); } }],
    });
  }

  function handleEvent(ev) {
    switch (ev.type) {
      case "statsChanged": refreshStats(); break;
      case "runStarted":   hideOverlay(els); break;
      case "resumed":      hideOverlay(els); break;
      case "stageGate":    showInterlevel(ev); break;
      case "gameOver":
        if (ev.newBest) {
          try { storage().setItem(storageKey, String(ev.best)); } catch (e) {}
        }
        showOver();
        break;
      case "paused":
      case "unpaused":
        if (root.activeElement) root.activeElement.blur();
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
    for (const ev of events) handleEvent(ev);

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
