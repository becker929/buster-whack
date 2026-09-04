/*!
 * Juice authoring. The core owns the fx *data*; `render.js` only reads it.
 * Every random number here comes from `state.rng`, so a seed still
 * reproduces a run frame for frame, debris included.
 */

import * as C from "./constants.js";

export const panel = (state, col, row) => C.panelRect(state.G, col, row);

// ---------- juice authoring ----------
// The core owns the fx *data*; `render.js` only reads it. Every random number
// below comes from `state.rng`, so a seed still reproduces a run frame for
// frame, debris included.

/** Queue a freeze of `ms` that engages once the clock reaches `at`. */
export function hitStop(state, at, ms) {
  if (state.hitStopMs <= 0) {
    state.hitStopAt = at;
    state.hitStopMs = Math.min(C.MAX_HITSTOP, ms);
    return;
  }
  state.hitStopAt = Math.min(state.hitStopAt, at);
  state.hitStopMs = Math.min(C.MAX_HITSTOP, state.hitStopMs + ms);
}

/** One shake envelope for the whole screen; the loudest live event wins. */
export function shake(state, spec, at, scale = 1) {
  const sh = state.fx.shake;
  const t = at - sh.t0;
  const remaining = t >= 0 && t < sh.ms ? sh.amp * (1 - t / sh.ms) : 0;
  const amp = spec.amp * scale;
  if (amp < remaining) return;
  sh.t0 = at;
  sh.ms = spec.ms;
  sh.amp = amp;
}

/**
 * Throw debris. Jitter is drawn from `state.rng`, never Math.random, and the
 * pool is hard-capped: the oldest bits fall off the front rather than letting a
 * crowded frame grow without bound.
 */
export function spawnBits(state, x, y, n, palette, opts = {}) {
  const bits = state.fx.bits;
  const t0 = opts.at === undefined ? state.clock : opts.at;
  const dir = opts.dir === undefined ? -Math.PI / 2 : opts.dir;
  const spread = opts.spread === undefined ? 1 : opts.spread;
  const speed = opts.speed === undefined ? 0.24 : opts.speed;
  const g = opts.g === undefined ? C.BIT_GRAVITY : opts.g;
  for (let i = 0; i < n; i++) {
    const a = dir + (state.rng() - 0.5) * Math.PI * spread;
    const v = speed * (0.45 + state.rng());
    bits.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g,
      t0, ms: opts.ms || C.BIT_MS,
      size: 3 + state.rng() * 4.6,
      color: palette[Math.floor(state.rng() * palette.length)],
    });
  }
  const over = bits.length - C.MAX_BITS;
  if (over > 0) bits.splice(0, over);
}

/** An impact ring inside one panel. */
export function ripple(state, col, row, color, at, w = 1) {
  state.fx.ripples.push({ col, row, color, w, t0: at, ms: C.RIPPLE_MS });
  if (state.fx.ripples.length > 12) state.fx.ripples.shift();
}

// ---------- fx bookkeeping ----------
// Expiring popups and sparks used to happen inside the draw calls; it belongs
// to the simulation so a renderer can be a pure function of the state.

export function cullFx(state) {
  const now = state.clock;
  const popups = state.fx.popups;
  for (let i = popups.length - 1; i >= 0; i--) {
    if (now - popups[i].t0 >= C.POPUP_MS) popups.splice(i, 1);
  }
  const sparks = state.fx.sparks;
  for (let i = sparks.length - 1; i >= 0; i--) {
    if (now - sparks[i].t0 >= C.SPARK_MS) sparks.splice(i, 1);
  }
  const bits = state.fx.bits;
  for (let i = bits.length - 1; i >= 0; i--) {
    if (now - bits[i].t0 >= bits[i].ms) bits.splice(i, 1);
  }
  const ripples = state.fx.ripples;
  for (let i = ripples.length - 1; i >= 0; i--) {
    if (now - ripples[i].t0 >= ripples[i].ms) ripples.splice(i, 1);
  }
}

/** Wipe every transient effect — a new run starts on a clean board. */
export function clearFx(state) {
  const fx = state.fx;
  fx.popups.length = 0;
  fx.sparks.length = 0;
  fx.bits.length = 0;
  fx.ripples.length = 0;
  fx.hurtT0 = -1e9;
  fx.shake.t0 = -1e9; fx.shake.amp = 0; fx.shake.ms = 0;
  fx.flare.t0 = -1e9;
  fx.chainBreak.t0 = -1e9;
  fx.ghost.t0 = -1e9;
  fx.ray.t0 = -1e9;
  fx.muzzleT0 = -1e9;
  state.hitStopAt = -1e9;
  state.hitStopMs = 0;
}
