/*!
 * The game state object.
 *
 * Plain data plus an injected rng. `step` mutates it in place — at 60fps that
 * is the point — so nothing here is frozen or copied per frame.
 */

import { START_TIME, TIERS, layout, makeImpulse, DEFAULT_MODE } from "./constants.js";
import { createWorld } from "./world.js";
import { mulberry32 } from "./rng.js";

/**
 * @param {object} [opts]
 * @param {number} [opts.seed=1] - PRNG seed (ignored when `rng` is given).
 * @param {() => number} [opts.rng] - injected uniform [0,1) source.
 * @param {number} [opts.best=0] - persisted best score.
 * @param {number} [opts.width=0] - stage width in CSS px.
 * @param {number} [opts.height=0] - stage height in CSS px.
 * @param {boolean} [opts.reducedMotion=false] - damp shake and flashing. The
 *   renderer cannot read `matchMedia` (it never touches a DOM), so the shell
 *   reads the media query and hands the answer in as data.
 */
export function createState(opts = {}) {
  const seed = opts.seed === undefined ? 1 : opts.seed;
  return {
    rng: opts.rng || mulberry32(seed),
    seed,

    mode: "ready",             // ready | playing | interlevel | over
    paused: false,
    // Accessibility, not a preference the sim reads: only `render.js` looks at
    // it. Safe default is "full motion"; the shell overwrites it.
    reducedMotion: !!opts.reducedMotion,
    // which mode this run is playing, and the world it plays on. See world.js:
    // classic is one arena that never clears to a road; advance grows.
    modeId: opts.modeId || DEFAULT_MODE,
    world: createWorld(),
    arenasCleared: 0,
    // camera, in world columns: the left edge of the view. The simulation
    // never reads it -- it lives here so it is deterministic and replayable,
    // and the renderer applies it as a translate. Classic keeps it at 0.
    cam: 0,
    // ADVANCE inventory and ordnance. Pickups live on road tiles; a bomb in
    // flight is { fromCol,fromRow,toCol,toRow,t0,dur }; blasts are fx.
    bombs: 0,
    bombsInFlight: [],
    pickups: [],               // { col, row, kind }
    levelT0: -1e9,             // when the level last changed (advance: arena entry)
    unlimited: false,          // past ROAD_END: nothing held back
    camAnchor: 0,              // x0 of the last arena entered: the camera's floor while following
    camClock: 0,               // clock at the last camera ease, so the ease is dt-driven and replayable
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
    // { col,row,type,state,t0,hp, lastHop,hopT0, fx?,tier?, wave,
    //   willAttack,fired, boltKind,aimMs }
    enemies: [],
    // incoming fire: { row, x, speed, kind, radius, heavy }
    bolts: [],
    hurtUntil: -1e9,           // i-frames, so one volley can't drain the clock
    nextSpawnAt: 0,            // clock at which the next wave lands (Infinity = never)
    waveIdx: 0,                // how many waves have started this run
    waveState: "lull",         // lull | active
    wave: null,                // the live formation, see planWave() in step.js
    stageIdx: 0,
    charge: { downAt: null, full: false },
    lastMoveAt: -1e9,
    queuedMove: null,          // one-hand: the step held for the end of the cooldown, { kind:"to",col,row } | { kind:"by",dc,dr }
    holdDir: null,             // the direction a stick/ring is holding this frame, { dc, dr }
    holdT0: -1e9,              // when that push began: a push gets one held step, never two
    talks: {},                 // story: TALK presses per npc id; the shell picks the line
    routeIdx: 1,               // story: the next tower on STORY_ROUTE
    hop: null,                 // touch modes: the step in flight, { fromCol, fromRow, toCol, toRow, t0, committed }
    path: null,                // touch modes: the square a far tap is walking to, { col, row }
    rank: null,
    // hit-stop: freeze the simulation clock for `hitStopMs` once `clock`
    // reaches `hitStopAt` (which is when the tracer actually lands).
    hitStopAt: -1e9,
    hitStopMs: 0,
    G: layout(opts.width || 0, opts.height || 0),
    fx: {
      recoil: makeImpulse(TIERS.normal.recoil),
      muzzleT0: -1e9,
      muzzleTier: "normal",
      ray: { t0: -1e9, row: 0, hitCol: null, x0: 0, x1: 0, dur: 1, tier: "normal" },
      popups: [],
      sparks: [],
      bits: [],                // debris: { x,y,vx,vy,g,t0,ms,size,color }
      ripples: [],             // panel impact rings: { col,row,t0,ms,color,w }
      hurtT0: -1e9,
      shake: { t0: -1e9, ms: 0, amp: 0 },
      flare: { t0: -1e9, mult: 1, x: 0, y: 0 },
      chainBreak: { t0: -1e9, chain: 0, x: 0, y: 0, quiet: false },
      ghost: { t0: -1e9, col: 1, row: 1 },
      blasts: [],              // bomb splashes: { col,row,x,y,t0 }
    },
  };
}

/**
 * Recompute the board geometry for a new stage size. Pure numbers in.
 *
 * Anything already in flight is carried across with it. Bolts, tracers, sparks,
 * popups and debris all store absolute pixel coordinates (and a bolt bakes a
 * speed from the panel width it was fired at), so before this a mid-run resize
 * teleported every one of them — a bolt would jump out of its lane and land
 * nowhere near the panel it was aimed at. Rescaling here keeps the whole board
 * in board space without making every consumer do the arithmetic.
 */
export function setLayout(state, width, height, bottomInset = 0) {
  const old = state.G;
  const G = layout(width, height, bottomInset);
  state.G = G;
  if (old && old.pw > 0 && G.pw > 0 && (old.pw !== G.pw || old.ph !== G.ph ||
      old.gx !== G.gx || old.gy !== G.gy)) {
    remap(state, old, G);
  }
  return G;
}

function remap(state, a, b) {
  const kx = b.pw / a.pw, ky = b.ph / a.ph;
  const mx = (x) => b.gx + (x - a.gx) * kx;
  const my = (y) => b.gy + (y - a.gy) * ky;

  for (const bolt of state.bolts) {
    bolt.x = mx(bolt.x);
    bolt.speed *= kx;
    if (bolt.radius) bolt.radius *= kx;
  }
  for (const pp of state.fx.popups) { pp.x = mx(pp.x); pp.y = my(pp.y); }
  for (const sp of state.fx.sparks) { sp.x = mx(sp.x); sp.y = my(sp.y); }
  for (const bit of state.fx.bits) {
    bit.x = mx(bit.x); bit.y = my(bit.y);
    bit.vx *= kx; bit.vy *= ky; bit.g *= ky;
    bit.size *= Math.min(kx, ky);
  }
  const ray = state.fx.ray;
  ray.x0 = mx(ray.x0);
  ray.x1 = mx(ray.x1);
  const flare = state.fx.flare;
  flare.x = mx(flare.x); flare.y = my(flare.y);
  const cb = state.fx.chainBreak;
  cb.x = mx(cb.x); cb.y = my(cb.y);
}
