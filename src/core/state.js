/*!
 * The game state object.
 *
 * Plain data plus an injected rng. `step` mutates it in place — at 60fps that
 * is the point — so nothing here is frozen or copied per frame.
 */

import { START_TIME, TIERS, layout, makeImpulse } from "./constants.js";
import { mulberry32 } from "./rng.js";

/**
 * @param {object} [opts]
 * @param {number} [opts.seed=1] - PRNG seed (ignored when `rng` is given).
 * @param {() => number} [opts.rng] - injected uniform [0,1) source.
 * @param {number} [opts.best=0] - persisted best score.
 * @param {number} [opts.width=0] - stage width in CSS px.
 * @param {number} [opts.height=0] - stage height in CSS px.
 */
export function createState(opts = {}) {
  const seed = opts.seed === undefined ? 1 : opts.seed;
  return {
    rng: opts.rng || mulberry32(seed),
    seed,

    mode: "ready",             // ready | playing | interlevel | over
    paused: false,
    clock: 0,                  // game clock, advances only while playing and unpaused
    canFire: true,
    score: 0,
    best: opts.best || 0,
    deletions: 0,
    shots: 0,
    whiffs: 0,
    chain: 0,
    bestChain: 0,
    timeLeft: START_TIME,
    player: { col: 1, row: 1 },
    enemies: [],               // { col,row,type,state,t0,hp, lastHop,hopT0, fx?,tier?, willAttack,fired }
    bolts: [],                 // incoming fire: { row, x, speed, heavy }
    hurtUntil: -1e9,           // i-frames, so one volley can't drain the clock
    nextSpawnAt: 0,
    stageIdx: 0,
    charge: { downAt: null, full: false },
    lastMoveAt: -1e9,
    rank: null,
    G: layout(opts.width || 0, opts.height || 0),
    fx: {
      recoil: makeImpulse(TIERS.normal.recoil),
      muzzleT0: -1e9,
      muzzleTier: "normal",
      ray: { t0: -1e9, row: 0, hitCol: null, x0: 0, x1: 0, dur: 1, tier: "normal" },
      popups: [],
      sparks: [],
      hurtT0: -1e9,
    },
  };
}

/** Recompute the board geometry for a new stage size. Pure numbers in. */
export function setLayout(state, width, height) {
  state.G = layout(width, height);
  return state.G;
}
