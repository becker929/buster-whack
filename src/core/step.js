/*!
 * The simulation.
 *
 *   step(state, dtMs, intents) -> events[]
 *
 * Deterministic and effect-free: no DOM, no audio, no Math.random, no clock
 * reads. Randomness comes from `state.rng`, time only from `dtMs`. Anything
 * the outside world should hear, show or persist leaves as an event; the shell
 * drains the list and performs it.
 *
 * `intents` is either an array of actions or `{ actions, hold }`:
 *   actions - discrete inputs since the last step, applied in order *before*
 *             the clock advances (which is where they landed when the shell
 *             handled DOM events inline).
 *   hold    - a held d-pad direction `{ dc, dr }`, polled after the clock
 *             advances, throttled by MOVE_REPEAT_MS like any other move.
 */

import * as C from "./constants.js";
import { createWorld, activeArena, walkable, clearArena, worldEnd, npcBeside, safeZone, segmentAt } from "./world.js";
import { computeRank } from "./select.js";

const panel = (state, col, row) => C.panelRect(state.G, col, row);

// ---------- entry point ----------

export function step(state, dtMs, intents = {}) {
  const events = [];
  const actions = Array.isArray(intents) ? intents : intents.actions || [];
  const hold = Array.isArray(intents) ? null : intents.hold;

  for (const a of actions) applyIntent(state, a, events);

  // Hit-stop. `adv` is how much of this frame's dt the *simulation* gets: a
  // pending freeze eats the front of it, so animations, bolts, spawn gaps and
  // aim windows all stall together and cannot desync from each other. The run
  // clock below is deliberately not part of it.
  let adv = dtMs;
  if (state.mode === "playing" && !state.paused &&
      state.hitStopMs > 0 && state.clock >= state.hitStopAt) {
    const used = Math.min(state.hitStopMs, adv);
    state.hitStopMs -= used;
    adv -= used;
  }

  if (state.mode === "playing" && !state.paused) {
    state.clock += adv;
    // The run clock is fight pressure: it drains only while the arena you
    // are in is held against you. Towers, roads and taken arenas are safe.
    if (!safeZone(state.world)) state.timeLeft -= dtMs / 1000;
    if (state.timeLeft <= 0) { state.timeLeft = 0; gameOver(state, events); }
    if (state.charge.downAt !== null && !state.charge.full &&
        state.clock - state.charge.downAt >= C.CHARGE_MS) {
      state.charge.full = true;
      events.push({ type: "chargeReady" });
    }
  }

  // A held direction re-asks every frame. Each distinct push (a new direction
  // counts as one) is stamped, so a flick that ends inside the ration still
  // lands its one step, while a push that already stepped does not also queue
  // a second for the lift.
  if (hold && (hold.dc || hold.dr)) {
    const hd = state.holdDir;
    if (!hd || hd.dc !== hold.dc || hd.dr !== hold.dr) {
      state.holdDir = { dc: hold.dc, dr: hold.dr };
      state.holdT0 = state.clock;
    }
    move(state, hold.dc, hold.dr, events, true);
  } else {
    state.holdDir = null;
  }
  updateHop(state, events);
  flushQueuedMove(state, events);
  runPath(state, events);

  updateEnemies(state, events);
  updateBolts(state, adv, events);
  checkStageGate(state, events);
  cullFx(state);

  return events;
}

// ---------- juice authoring ----------
// The core owns the fx *data*; `render.js` only reads it. Every random number
// below comes from `state.rng`, so a seed still reproduces a run frame for
// frame, debris included.

/** Queue a freeze of `ms` that engages once the clock reaches `at`. */
function hitStop(state, at, ms) {
  if (state.hitStopMs <= 0) {
    state.hitStopAt = at;
    state.hitStopMs = Math.min(C.MAX_HITSTOP, ms);
    return;
  }
  state.hitStopAt = Math.min(state.hitStopAt, at);
  state.hitStopMs = Math.min(C.MAX_HITSTOP, state.hitStopMs + ms);
}

/** One shake envelope for the whole screen; the loudest live event wins. */
function shake(state, spec, at, scale = 1) {
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
function spawnBits(state, x, y, n, palette, opts = {}) {
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
function ripple(state, col, row, color, at, w = 1) {
  state.fx.ripples.push({ col, row, color, w, t0: at, ms: C.RIPPLE_MS });
  if (state.fx.ripples.length > 12) state.fx.ripples.shift();
}

// ---------- intents ----------

export function applyIntent(state, action, events) {
  switch (action.type) {
    case "firePressed":  firePressed(state, events); break;
    case "fireReleased": fireReleased(state, events); break;
    case "move":         move(state, action.dc, action.dr, events); break;
    case "moveTo":       moveTo(state, action.col, action.row, events); break;
    case "tapAt":        tapAt(state, action.x, action.y, events); break;
    case "resetMoveThrottle": state.lastMoveAt = -1e9; break;
    case "pause":        togglePause(state, events); break;
    case "pauseOnBlur":
      if (state.mode === "playing" && !state.paused) togglePause(state, events);
      break;
    case "startRun":     resetGame(state, events, action.modeId); break;
    case "bomb":         contextAction(state, events); break;
    case "resume":       resumeFromInterlevel(state, events); break;
    case "endRun":       gameOver(state, events); break;
    default: break;      // shell-only intents (mute, …) never reach here
  }
}

function firePressed(state, events) {
  if (!state.canFire) return;
  state.canFire = false;
  if (state.mode === "ready" || state.mode === "over") { resetGame(state, events); return; }
  if (state.mode === "interlevel") { resumeFromInterlevel(state, events); return; }
  if (state.paused) return;
  shoot(state, "normal", events);
  state.charge.downAt = state.clock;
  state.charge.full = false;
}

function fireReleased(state, events) {
  // `canFire` *is* "nothing is holding the button". A release with nothing
  // pressed is not ours — a stray pointerup elsewhere on the page, a keyup for
  // a keydown we never took — and must not spend a charge or re-arm the latch.
  // The shell keys releases to the source that pressed; this is the core
  // refusing to be confused even if some other shell does not.
  if (state.canFire) return;
  state.canFire = true;
  if (state.charge.downAt !== null && state.charge.full &&
      state.mode === "playing" && !state.paused) {
    shoot(state, "charged", events);
  }
  state.charge.downAt = null;
  state.charge.full = false;
}

/** The step ration for this run's mode: one-hand paces steps at half a charge. */
const moveMs = (state) => C.modeById(state.modeId).moveMs || C.MOVE_REPEAT_MS;
const moveReady = (state) => state.clock - state.lastMoveAt >= moveMs(state);
/** Hopping modes hop; the retired ring modes step on the spot. */
const hops = (state) => !!C.modeById(state.modeId).hop;

/**
 * A step asked for during the cooldown is not dropped: in one-hand a thumb
 * that taps twice quickly means "there, then there", and swallowing the second
 * makes the ration feel like lag. The latest ask wins; it is taken the moment
 * the cooldown ends, and only if it is still legal then. The board's stick
 * rides on the same queue: held, it re-asks every frame, so a hold walks at
 * the ration and a flick inside it still lands its one step. Ring and keyboard
 * modes keep their old drop, which is what their repeat-while-held relies on.
 */
function queueMove(state, q) {
  if (!hops(state)) return;
  state.queuedMove = q;
}

/** Take the held step once the ration allows. Called every frame. */
function flushQueuedMove(state, events) {
  const q = state.queuedMove;
  if (!q) return;
  if (state.mode !== "playing" || state.paused) { state.queuedMove = null; return; }
  if (!moveReady(state)) return;
  state.queuedMove = null;
  if (q.kind === "to") moveTo(state, q.col, q.row, events);
  else move(state, q.dc, q.dr, events);
}

/**
 * A step in a direction. Any direction pressed is a new directive: a path
 * being walked is dropped for it.
 */
function move(state, dc, dr, events, fromHold = false) {
  if (state.mode !== "playing" || state.paused) return;
  if (!(dc || dr)) return;
  state.path = null;
  if (!moveReady(state)) {
    // a hold that has already stepped since it began is walking, not asking
    if (!fromHold || state.lastMoveAt < state.holdT0) queueMove(state, { kind: "by", dc, dr });
    return;
  }
  // Touch modes hop one square, never diagonally: the larger axis wins.
  if (hops(state) && dc && dr) { if (Math.abs(dc) >= Math.abs(dr)) dr = 0; else dc = 0; }
  const [col, row] = stepFrom(state, state.player.col, state.player.row, dc, dr);
  go(state, col, row, events);
}

/**
 * Resolve a press into the square it reaches. The world decides where you may
 * stand: your own ground and the road, never an enemy tile, never off the map.
 * Each axis is resolved on its own, one tile at a time, so a diagonal press
 * blocked in one direction still moves in the other -- the ring presses both
 * axes on a diagonal, and a wall should not cancel the half of the input that
 * was fine. In classic this is exactly the old clamp to the player's half.
 *
 * And never a square that has already scrolled off the left edge of the
 * view: the camera only moves right, so that wall only ever advances.
 */
function stepFrom(state, col, row, dc, dr) {
  const world = state.world;
  const wall = Math.floor(state.cam || 0);
  const sc = Math.sign(dc), sr = Math.sign(dr);
  for (let i = 0; i < Math.abs(dc); i++) {
    if (col + sc < wall || !walkable(world, col + sc, row)) break;
    col += sc;
  }
  for (let i = 0; i < Math.abs(dr); i++) {
    const nr = row + sr;
    if (nr < 0 || nr >= C.ROWS || !walkable(world, col, nr)) break;
    row = nr;
  }
  return [col, row];
}

/** Spend the ration on a step to (col,row): a hop in touch modes, a landing otherwise. */
function go(state, col, row, events) {
  state.lastMoveAt = state.clock;
  if (!hops(state)) { land(state, col, row, events); return; }
  // a hop still in the air when the next begins lands first: no square is
  // ever skipped, whatever the frame timing
  const prev = state.hop;
  if (prev && !prev.committed) { prev.committed = true; land(state, prev.toCol, prev.toRow, events); }
  if (col === state.player.col && row === state.player.row) { state.hop = null; return; }
  state.hop = {
    fromCol: state.player.col, fromRow: state.player.row, toCol: col, toRow: row,
    t0: state.clock, committed: false,
  };
  events.push({ type: "hop", fromCol: state.player.col, fromRow: state.player.row, col, row });
}

/**
 * The hop in flight: the square you count as standing on changes at the top
 * of the arc, and the hop is over after the landing settles. Every frame.
 */
function updateHop(state, events) {
  const h = state.hop;
  if (!h) return;
  const t = state.clock - h.t0;
  if (!h.committed && t >= C.HOP_COMMIT_MS) {
    h.committed = true;
    land(state, h.toCol, h.toRow, events);
  }
  if (t >= C.HOP_TOTAL_MS) state.hop = null;
}

/**
 * Go to a square: one-hand's tap. Beside you it is one hop; further away it
 * lays a path and the hops follow it, one per ration, until any new
 * directive replaces it. The square has to be standable, still on screen,
 * and reachable on foot -- a narrow road is a funnel, and a tap on the far
 * bank must not hop the void it exists to make you walk around.
 */
function moveTo(state, col, row, events) {
  if (state.mode !== "playing" || state.paused) return;
  if (col === state.player.col && row === state.player.row) { state.path = null; return; }
  if (!reachable(state, col, row)) return;
  ripple(state, col, row, "#4f8dff", state.clock, 1);
  state.path = { col, row };
  runPath(state, events);
}

/** Take the next step of the path when the ration allows. Every frame. */
function runPath(state, events) {
  const p = state.path;
  if (!p) return;
  if (state.mode !== "playing" || state.paused) { state.path = null; return; }
  if (p.col === state.player.col && p.row === state.player.row) { state.path = null; return; }
  if (!moveReady(state)) return;
  const next = nextStep(state, p.col, p.row);
  if (!next) { state.path = null; return; }     // the way closed: stop where you are
  go(state, next[0], next[1], events);
}

/**
 * The first square of a shortest walk from the player to (col,row), or null
 * if there is none. Four-connected over standable squares on screen, so a
 * path never cuts a corner or hops a gap.
 */
function nextStep(state, col, row) {
  const world = state.world;
  const wall = Math.floor(state.cam || 0);
  if (row < 0 || row >= C.ROWS || col < wall) return null;
  if (!walkable(world, col, row)) return null;
  const end = worldEnd(world);
  const key = (c, r) => c * C.ROWS + r;
  const from = key(state.player.col, state.player.row);
  const parent = new Map([[from, null]]);
  const open = [[state.player.col, state.player.row]];
  let head = 0;
  while (head < open.length) {
    const [c, r] = open[head++];
    if (c === col && r === row) {
      // walk back to the square after the start
      let k = key(c, r);
      while (parent.get(k) !== from) k = parent.get(k);
      return [Math.floor(k / C.ROWS), k % C.ROWS];
    }
    for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]) {
      if (nc < wall || nc >= end || nr < 0 || nr >= C.ROWS) continue;
      const nk = key(nc, nr);
      if (parent.has(nk) || !walkable(world, nc, nr)) continue;
      parent.set(nk, key(c, r));
      open.push([nc, nr]);
    }
  }
  return null;
}

/** Is (col,row) standable and joined to the player by standable squares? */
function reachable(state, col, row) {
  if (col === state.player.col && row === state.player.row) return true;
  return nextStep(state, col, row) !== null;
}

/**
 * A tap on the stage, in CSS pixels, resolved through the camera to a square.
 * The shell hands over raw coordinates and nothing else: the layout and the
 * scroll both live here, so a tap means the same square in a replay.
 */
function tapAt(state, x, y, events) {
  const G = state.G;
  if (!G.pw || !G.ph) return;
  const wx = (x + (state.cam || 0) * G.pw - G.gx) / G.pw;
  const wy = (y - G.gy) / G.ph;
  let row = Math.floor(wy);
  if (row === -1 && wy >= -C.TAP_SLACK) row = 0;
  if (row === C.ROWS && wy < C.ROWS + C.TAP_SLACK) row = C.ROWS - 1;
  const col = Math.floor(wx);
  if (!moveReady(state) && hops(state)) {
    // inside the ration: held, like any other step asked for early
    if (reachable(state, col, row)) queueMove(state, { kind: "to", col, row });
    return;
  }
  moveTo(state, col, row, events);
}

/** Arrive on a square: pickups, the afterimage, and the event. */
function land(state, col, row, events) {
  const moved = col !== state.player.col || row !== state.player.row;
  if (moved) {
    // walking onto a pickup takes it
    for (let i = state.pickups.length - 1; i >= 0; i--) {
      const pk = state.pickups[i];
      if (pk.col !== col || pk.row !== row) continue;
      state.pickups.splice(i, 1);
      if (pk.kind === "bomb") state.bombs++;
      const pp = panel(state, col, row);
      state.fx.popups.push({ x: pp.x + pp.w / 2, y: pp.y - 8, t0: state.clock, text: "+BOMB", color: "#ff9f45" });
      events.push({ type: "pickup", kind: pk.kind, col, row, x: pp.x + pp.w / 2, y: pp.y, bombs: state.bombs });
      events.push({ type: "statsChanged" });
    }
    state.fx.ghost.t0 = state.clock;
    state.fx.ghost.col = state.player.col;
    state.fx.ghost.row = state.player.row;
  }
  state.player.col = col;
  state.player.row = row;
  if (moved) events.push({ type: "playerMoved", col, row });
}

function togglePause(state, events) {
  if (state.mode !== "playing") return;
  state.paused = !state.paused;
  if (state.paused) { state.charge.downAt = null; state.charge.full = false; }
  events.push({ type: state.paused ? "paused" : "unpaused" });
}

// ---------- game flow ----------

function resetGame(state, events, modeId) {
  const cfg = C.modeById(modeId || state.modeId);
  state.modeId = cfg.id;
  state.world = createWorld({ story: !!cfg.story });
  state.talks = {};
  state.routeIdx = 1;
  state.hop = null;
  state.path = null;
  state.arenasCleared = 0;
  state.bombs = 0;
  state.bombsInFlight.length = 0;
  state.pickups.length = 0;
  state.fx.blasts.length = 0;
  state.levelT0 = -1e9;       // announced on arena entry, never at the starting gun
  state.unlimited = false;
  state.cam = 0;
  state.camAnchor = 0;
  state.camClock = state.clock;
  state.mode = "playing";
  state.paused = false;
  state.score = 0;
  state.deletions = 0;
  state.shots = 0; state.whiffs = 0;
  state.chain = 0; state.bestChain = 0;
  state.timeLeft = C.START_TIME;
  state.player.col = 1; state.player.row = 1;
  state.queuedMove = null;
  state.lastMoveAt = -1e9;
  state.holdDir = null;
  state.holdT0 = -1e9;
  state.enemies.length = 0;
  // the opening lull, before wave 0 -- unless the strip opens on a tower, in
  // which case the first arena's guard wakes only when you walk into it
  state.nextSpawnAt = activeArena(state.world).entered ? state.clock + 500 : Infinity;
  state.waveIdx = 0;
  state.waveState = "lull";
  state.wave = null;
  state.stageIdx = 0;
  clearFx(state);
  state.bolts.length = 0;
  state.hurtUntil = -1e9;
  state.rank = null;
  events.push({ type: "runStarted", modeId: cfg.id, story: !!cfg.story });
  // the strip opens on a tower: say where you are
  const first = state.world.segs[0];
  if (first.kind === "tower") events.push({ type: "towerEntered", roost: first.roost, x0: first.x0 });
  events.push({ type: "statsChanged" });
}

function gameOver(state, events) {
  state.mode = "over";
  state.rank = computeRank(state);
  const newBest = state.score > state.best;
  if (newBest) state.best = state.score;
  state.enemies.length = 0;
  state.bolts.length = 0;
  state.wave = null;
  state.waveState = "lull";
  state.charge.downAt = null; state.charge.full = false;
  state.hitStopMs = 0;
  events.push({
    type: "gameOver",
    score: state.score,
    rank: state.rank,
    deletions: state.deletions,
    bestChain: state.bestChain,
    best: state.best,
    newBest,
  });
  events.push({ type: "statsChanged" });
}

/**
 * A gate needs both floors: `wave` waves started AND `at` deletions banked.
 * Checked once per frame rather than only on a kill, so whichever floor lands
 * last opens it — usually the wave floor, which puts the card in a lull rather
 * than in the middle of a formation.
 */
function checkStageGate(state, events) {
  if (state.mode !== "playing" || state.paused) return;
  if (C.modeById(state.modeId).advancing) return;   // advance cards are keyed to arenas, not this syllabus
  const st = C.STAGES[state.stageIdx];
  if (!st) return;
  if (state.waveIdx >= st.wave && state.deletions >= st.at) enterInterlevel(state, events);
}

function enterInterlevel(state, events) {
  const stage = C.STAGES[state.stageIdx];
  const index = state.stageIdx;
  state.stageIdx++;
  state.mode = "interlevel";
  state.charge.downAt = null;
  state.charge.full = false;
  state.bolts.length = 0;   // don't resume the run into a bolt you can't see coming
  state.hitStopMs = 0;      // nor into the tail of a freeze from the kill that opened the gate
  state.timeLeft = Math.min(C.TIME_CAP, state.timeLeft + C.STAGE_BONUS);
  events.push({
    type: "stageGate",
    stage,
    index,
    title: stage.title,
    timeBonus: C.STAGE_BONUS,
  });
  events.push({ type: "statsChanged" });
}

/**
 * Each frame: notice the player stepping into the arena they were walking
 * toward, and ease the camera. Both live in the core so a replay from a seed
 * reproduces the scroll exactly; the renderer only applies `cam`.
 */
function updateWorld(state, events) {
  const now = state.clock;
  const a = activeArena(state.world);

  // Stepping in is the wave boundary: the arena wakes a beat later. Arena 0
  // is born entered, which is how classic and the opening of advance share a
  // single opening lull.
  // Stepping onto a tower is arrival: the shell announces it from the canon.
  for (const seg of state.world.segs) {
    if (seg.kind === "tower" && !seg.entered && state.player.col >= seg.x0) {
      seg.entered = true;
      events.push({ type: "towerEntered", roost: seg.roost, x0: seg.x0 });
    }
  }

  if (!a.entered && state.player.col >= a.x0) {
    a.entered = true;
    state.camAnchor = a.x0;
    state.nextSpawnAt = now + C.ARENA_ENTRY_DELAY_MS;
    state.levelT0 = now;
    events.push({ type: "arenaEntered", index: a.idx, x0: a.x0 });
    if (a.idx >= C.ROAD_END) state.unlimited = true;
    // the chapter card, at the arena boundary -- the one moment a pause is
    // free. Not in the story: there, people say what is coming.
    const st = C.modeById(state.modeId).story ? null : C.ADVANCE_STAGES.find((x) => x.arena === a.idx);
    if (st) showCard(state, events, st, C.ADVANCE_STAGES.indexOf(st));
  }

  // Camera. Fighting in an arena: lock so the arena fills the view exactly as
  // classic's board does. Otherwise follow, never behind the last arena you
  // entered and never past the one you are walking to -- so the view slides
  // out of a taken arena as you cross its right half and settles into the
  // lock position as you arrive, with no jump at either end.
  const fighting = a.entered && a.owner === "enemy";
  // On a tower the view holds the whole tower: people stand at both ends of
  // it and a step forward must not scroll the one behind you off the map.
  const here = segmentAt(state.world, state.player.col);
  const onTower = here && here.kind === "tower";
  const want = fighting ? a.x0 : Math.min(a.x0, onTower ? here.x0 : state.player.col - 1);
  // monotonic: the view slides forward with you and never back, so a square
  // that has left the screen is gone for good
  state.camAnchor = Math.max(state.camAnchor, want);
  const target = state.camAnchor;
  const dt = Math.max(0, now - state.camClock);
  state.camClock = now;
  const d = target - state.cam;
  if (Math.abs(d) < 0.002) state.cam = target;
  else state.cam += d * (1 - Math.exp(-dt / C.CAM_TAU_MS));
}

/** Advance's chapter card: same overlay as a classic gate, keyed to an arena. */
function showCard(state, events, stage, index) {
  state.mode = "interlevel";
  state.charge.downAt = null;
  state.charge.full = false;
  state.bolts.length = 0;
  state.timeLeft = Math.min(C.TIME_CAP, state.timeLeft + C.STAGE_BONUS);
  events.push({ type: "stageGate", stage, index, title: stage.title, timeBonus: C.STAGE_BONUS });
  events.push({ type: "statsChanged" });
}

function resumeFromInterlevel(state, events) {
  if (state.mode !== "interlevel") return;
  state.mode = "playing";
  state.nextSpawnAt = state.clock + 700;
  // A gate can open in the middle of a formation. Give the rest of it the same
  // beat back, so the card is never followed instantly by an arrival.
  if (state.wave) for (const slot of state.wave.queue) slot.at += 700;
  events.push({ type: "resumed" });
}

// ---------- waves ----------
//
// Enemies do not trickle in on a rolling timer any more; they arrive as a
// formation, and the gap between formations is the game's breathing room.
// One wave is live at a time:
//
//   lull   — nothing on the board, `nextSpawnAt` is when the next wave lands
//   active — `wave.queue` holds the arrivals that have not surfaced yet;
//            the wave ends when the queue is empty and nothing of it is left
//
// `nextSpawnAt` keeps its old name and its old meaning ("the next thing
// happens at"), so setting it to Infinity still gives a completely still board.

function freePanels(state, excludeCol, excludeRow) {
  const occ = new Set(state.enemies.map((e) => e.col + "," + e.row));
  const out = [];
  const a = activeArena(state.world);
  if (a.owner !== "enemy") return out;
  for (let c = a.x0 + C.PCOLS; c < a.x0 + a.cols; c++)
    for (let r = 0; r < C.ROWS; r++) {
      if (c === excludeCol && r === excludeRow) continue;
      if (!occ.has(c + "," + r)) out.push([c, r]);
    }
  return out;
}

/** A free panel that no live enemy and no pending arrival is using. */
function freeSlot(state, planned) {
  const taken = new Set(planned.map((s) => s.col + "," + s.row));
  const free = freePanels(state).filter(([c, r]) => !taken.has(c + "," + r));
  if (!free.length) return null;
  const [col, row] = free[Math.floor(state.rng() * free.length)];
  return { col, row };
}

// Metts and hoppers retaliate. A steel guard does not: it is the anchor of a
// formation and already demands the one thing that pins you in place (a held
// charge), so making it shoot as well would punish the exact behaviour it
// exists to teach. Progs are friendly, and a rare's window is too short to
// chase under fire.
const canRetaliate = (type) => type === "mett" || type === "hopper" || type === "sentinel";

/**
 * Is a mechanic available yet? Classic answers from the stage syllabus (wave
 * and deletion floors); advance answers from the arena you are in, so a
 * hundred-arena road can hand things out on its own schedule.
 */
function unlocked(state, key) {
  const mode = C.modeById(state.modeId);
  if (mode.advancing) {
    const at = C.unlockTable(mode)[key];
    return at !== undefined && activeArena(state.world).idx >= at;
  }
  return state.stageIdx >= (C.UNLOCK[key] === undefined ? Infinity : C.UNLOCK[key]);
}

/** Highest Sentinel mark the current arena has unlocked, or 0. */
function sentinelMark(state) {
  if (unlocked(state, "sentinel3")) return 3;
  if (unlocked(state, "sentinel2")) return 2;
  if (unlocked(state, "sentinel1")) return 1;
  return 0;
}

/**
 * Author one formation. Rows are rotated by the rng so six shapes read as many
 * more, and the arrival order is the formation's own — a wave lands, it does
 * not blink into existence.
 */
function planWave(state) {
  const now = state.clock;
  const idx = state.waveIdx;
  const stage = state.stageIdx;
  let size = C.waveSize(stage);
  const form = C.FORMATIONS[Math.floor(state.rng() * C.FORMATIONS.length)];
  const rot = Math.floor(state.rng() * C.ROWS);
  const stagger = C.waveStaggerMs(idx);

  // formations are authored against the origin arena; shift them to this one
  const arena = activeArena(state.world);
  const ax0 = arena.x0;
  const advancing = C.modeById(state.modeId).advancing;
  if (advancing) {
    // deal from the pool: as many as join at once, never more than remain
    size = Math.min(arena.waveSize, arena.pool - arena.dealt, C.MAX_ALIVE);
    arena.dealt += size;
  }
  // The composition chances below were written against the classic syllabus,
  // where `stage` climbs 0..8 over a run. In advance stageIdx never moves, so
  // fed straight in it would keep hoppers at ~3% forever. Map the road onto the
  // same 0..8 scale instead: eight arenas per classic stage.
  const chanceStage = advancing ? Math.min(C.STAGES.length, Math.floor(arena.idx / 8)) : stage;
  const slots = [];
  for (let i = 0; i < size; i++) {
    const [col, row] = form.slots[i];
    slots.push({ col: col + ax0, row: (row + rot) % C.ROWS, type: "mett", at: now + i * stagger,
                 persistent: advancing });
  }

  // the heavy: one armored anchor the wave forms around
  if (unlocked(state, "guard") && form.anchor < slots.length &&
      state.rng() < C.guardWaveChance(chanceStage)) {
    slots[form.anchor].type = "guard";
  }

  // hoppers: one, or two once formations are big
  if (unlocked(state, "hopper")) {
    const wanted = size >= 4 && state.rng() < 0.35 ? 2 : 1;
    for (let k = 0; k < wanted; k++) {
      if (state.rng() >= C.hopperWaveChance(chanceStage)) continue;
      const plain = slots.filter((s) => s.type === "mett");
      if (!plain.length) break;
      plain[Math.floor(state.rng() * plain.length)].type = "hopper";
    }
  }

  // a prog tags along as an extra body: the wave is still clearable without
  // shooting it, which is the whole point of the hold-fire test
  // the sentinel: one per wave once unlocked, at the arena's mark -- with a
  // lower mark now and then so the older ones stay in the mix
  const mark = advancing ? sentinelMark(state) : 0;
  if (mark && state.rng() < C.sentinelWaveChance(arena.idx)) {
    const plain = slots.filter((s) => s.type === "mett");
    if (plain.length) {
      const pick = plain[Math.floor(state.rng() * plain.length)];
      pick.type = "sentinel";
      pick.tier = mark > 1 && state.rng() < 0.35 ? mark - 1 : mark;
    }
  }

  if (unlocked(state, "ally") && state.rng() < C.allyWaveChance(chanceStage)) {
    const spot = freeSlot(state, slots);
    if (spot) slots.push({ ...spot, type: "ally", at: now + slots.length * stagger });
  }

  // the jackpot leads the wave in, alone on the first beat, because it is only
  // up for RARE_LIFE and has to be seen the instant it arrives
  if (!advancing && unlocked(state, "rare") && state.rng() < C.rareWaveChance(stage, state.timeLeft)) {
    const spot = freeSlot(state, slots);
    if (spot) {
      for (const s of slots) s.at += C.RARE_LIFE * 0.5;
      slots.unshift({ ...spot, type: "rare", at: now });
    }
  }

  const virusCount = slots.reduce((n, s) => n + (s.type === "ally" ? 0 : 1), 0);
  return {
    index: idx,
    formation: form.name,
    size: slots.length,
    virusCount,
    kills: 0,
    startedAt: now,
    // only ever used to stop a jammed queue from stalling the run
    deadline: now + slots.length * stagger + C.HOPPER_LIFE + C.WAVE_GRACE_MS,
    queue: slots,
  };
}

function startWave(state, events) {
  const wave = planWave(state);
  state.waveIdx++;
  state.wave = wave;
  state.waveState = "active";
  events.push({
    type: "waveStart", index: wave.index, size: wave.size,
    virusCount: wave.virusCount, formation: wave.formation,
  });
}

function spawnFromSlot(state, slot, events) {
  const now = state.clock;
  const type = slot.type;
  const boltKind = C.boltKindFor(type);
  const armed = unlocked(state, "retaliate") && canRetaliate(type);
  const tier = slot.tier || 0;
  // a sentinel's open window is its telegraph; the closed spell is its reload
  const sent = type === "sentinel" ? C.SENTINEL[tier] || C.SENTINEL[1] : null;
  // a persistent virus that never shot would be a target dummy: once
  // retaliation is unlocked, every pool virus that can shoot, does
  const willAttack = slot.persistent ? armed : armed && state.rng() < C.attackChance(state.deletions, type);
  state.enemies.push({
    col: slot.col, row: slot.row, type, state: "rising", t0: now,
    persistent: !!slot.persistent,
    refireAt: Infinity,
    riseMs: type === "ally" ? C.ALLY_RISE_MS : C.RISE_MS,
    hp: sent ? sent.hp : type === "hopper" ? 2 : 1,
    tier,
    lastHop: now, hopT0: -1e9,
    wave: state.wave ? state.wave.index : -1,
    willAttack,
    // baked at spawn so the telegraph a virus is drawing cannot change length
    // underneath it when the deletion count ticks over mid-aim
    boltKind,
    aimMs: sent ? sent.openMs : C.aimMs(state.deletions, boltKind),
    fired: false,
  });
  const p = panel(state, slot.col, slot.row);
  events.push({
    type: "enemySpawned", enemyType: type, col: slot.col, row: slot.row, willAttack,
    boltKind: willAttack ? boltKind : null,
    x: p.x + p.w / 2, y: p.y,
  });
}

function endWave(state, events) {
  const wave = state.wave;
  const now = state.clock;
  const cleared = wave.virusCount > 0 && wave.kills >= wave.virusCount;

  let lull = C.waveLullMs(wave.index, state.stageIdx);
  if (cleared) lull *= C.WAVE_CLEAR_LULL;      // clearing it buys pressure back
  // a lull must never be the thing that kills you: with the clock this low the
  // player needs targets, not air
  if (state.timeLeft < C.LOW_TIME) lull = Math.min(lull, C.LOW_TIME_LULL_MS);
  lull = Math.round(lull);

  let timeBonus = 0, points = 0;
  if (cleared) {
    timeBonus = C.waveClearBonus(wave.virusCount) * C.bonusFactor(state.deletions);
    state.timeLeft = Math.min(C.TIME_CAP, state.timeLeft + timeBonus);
    points = C.WAVE_CLEAR_PTS * wave.virusCount * C.multOf(state.chain);
    state.score += points;
    const p = panel(state, state.player.col, state.player.row);
    state.fx.popups.push({
      x: p.x + p.w / 2, y: p.y - 22, t0: now,
      text: "WAVE CLEAR +" + timeBonus.toFixed(1) + "s", color: "#45e0e8",
    });
  }

  state.waveState = "lull";
  state.nextSpawnAt = now + lull;
  state.wave = null;
  if (cleared && C.modeById(state.modeId).advancing) {
    const guard = activeArena(state.world);
    if (guard.dealt < guard.pool) {
      // the pool is not spent: the next wave joins after a beat
      state.nextSpawnAt = now + C.ARENA_WAVE_GAP_MS;
      events.push({
        type: "waveEnded", index: wave.index, size: wave.size,
        virusCount: wave.virusCount, kills: wave.kills, cleared,
        timeBonus: 0, points: 0, lullMs: C.ARENA_WAVE_GAP_MS,
      });
      return;
    }
    // The arena is yours. The next one wakes only when you step into it, so
    // the walk is a true lull -- the road is the breath between fights.
    // in the story a tower stands before every TOWER_EVERY-th arena, the next
    // roost on the route, so the people arrive on a schedule you can feel
    const story = !!C.modeById(state.modeId).story;
    const roost = story && (guard.idx + 1) % C.TOWER_EVERY === 0 ? C.STORY_ROUTE[state.routeIdx] : null;
    const { cleared: a, road, tower, next } = clearArena(state.world, state.rng, { tower: roost || undefined });
    if (tower) state.routeIdx++;
    state.arenasCleared++;
    // a bomb on the road: always on the first one so it is found, often after
    if (a.idx === 0 || state.rng() < C.BOMB_PICKUP_CHANCE) {
      const pc = road.x0 + Math.floor(state.rng() * road.cols);
      const pr = road.rows === 1 ? C.ROAD_MID_ROW : Math.floor(state.rng() * C.ROWS);
      state.pickups.push({ col: pc, row: pr, kind: "bomb" });
      const pp = panel(state, pc, pr);
      events.push({ type: "pickupSpawned", kind: "bomb", col: pc, row: pr, x: pp.x + pp.w / 2, y: pp.y });
    }
    state.timeLeft = Math.min(C.TIME_CAP, state.timeLeft + C.ARENA_CLEAR_BONUS);
    state.score += C.ARENA_CLEAR_PTS;
    state.nextSpawnAt = Infinity;
    events.push({
      type: "arenaCleared", index: a.idx, x0: a.x0,
      roadRows: road.rows, nextX0: next.x0,
      timeBonus: C.ARENA_CLEAR_BONUS, points: C.ARENA_CLEAR_PTS,
    });
  }

  events.push({
    type: "waveEnded", index: wave.index, size: wave.size,
    virusCount: wave.virusCount, kills: wave.kills, cleared,
    timeBonus, points, lullMs: lull,
  });
  if (cleared) events.push({ type: "statsChanged" });
}

function updateWave(state, events) {
  const now = state.clock;
  updateWorld(state, events);
  updateBombs(state, events);
  if (state.waveState !== "active" || !state.wave) {
    if (now < state.nextSpawnAt) return;
    startWave(state, events);
  }
  const wave = state.wave;

  const queue = wave.queue;
  for (let i = 0; i < queue.length; ) {
    const slot = queue[i];
    if (slot.at > now) { i++; continue; }
    let busy = false;
    for (const e of state.enemies) {
      if (e.col === slot.col && e.row === slot.row) { busy = true; break; }
    }
    if (busy || state.enemies.length >= C.MAX_ALIVE) {
      // the panel is still busy dying; take the next beat instead of dropping
      // the member, unless the whole wave has run out of patience
      if (now >= wave.deadline) { queue.splice(i, 1); continue; }
      slot.at = now + 90;
      i++;
      continue;
    }
    queue.splice(i, 1);
    spawnFromSlot(state, slot, events);
  }

  if (queue.length) return;
  // plain loop, not .some(): this runs on every frame of every wave
  for (const e of state.enemies) {
    if (e.wave === wave.index && e.state !== "hit") return;
  }
  endWave(state, events);
}

// ---------- enemy state machine ----------

function lifeOf(state, e) {
  if (e.persistent) return Infinity;   // stays until deleted; the road depends on it
  if (e.type === "rare") return C.RARE_LIFE;
  const base = e.type === "hopper" ? C.HOPPER_LIFE : C.upMs(state.deletions);
  if (!e.willAttack) return base;
  // an attacker sticks around long enough to actually follow through
  return Math.max(base, aimOf(state, e) + C.ATTACK_FOLLOW_MS);
}

const aimOf = (state, e) =>
  e.aimMs === undefined
    ? C.aimMs(state.deletions, e.boltKind || C.boltKindFor(e.type))
    : e.aimMs;

function updateEnemies(state, events) {
  if (state.mode !== "playing" || state.paused) return;
  const now = state.clock;

  updateWave(state, events);

  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    const t = now - e.t0;
    switch (e.state) {
      case "rising":
        if (t >= (e.riseMs || C.RISE_MS)) {
          e.state = "up"; e.t0 = now; e.lastHop = now;
          if (e.willAttack) {
            const p = panel(state, e.col, e.row);
            events.push({
              type: "enemyAim", enemyType: e.type, col: e.col, row: e.row,
              x: p.x + p.w / 2, y: p.y,
            });
          }
        }
        break;
      case "up": {
        // A hopper about to shoot plants itself: the telegraph would be
        // unreadable if the lane moved under it, and a stationary hopper is
        // the window you get in exchange for the speed of its bolt.
        // a persistent attacker is not a one-shot: after a cooldown it draws
        // a fresh telegraph, so a wave that stays on the board keeps pressing.
        // `break` here, because `t` was measured against the old t0 and would
        // otherwise fire the new telegraph on this very frame.
        if ((e.persistent || e.type === "sentinel") && e.fired && now >= e.refireAt) {
          e.fired = false;
          e.t0 = now;
          events.push({ type: "enemyAim", col: e.col, row: e.row, boltKind: e.boltKind });
          break;
        }
        const aiming = e.willAttack && !e.fired;
        // the green hopper hops; the yellow mett, as a low-level hopper, hops
        // too but at a third of the pace -- and only while it holds a road,
        // so classic's metts are untouched
        const hopEvery = e.type === "hopper" ? C.HOP_MS
          : e.type === "mett" && e.persistent ? C.MET_HOP_MS : Infinity;
        if (!aiming && now - e.lastHop >= hopEvery) {
          hopTo(state, e, events);
          e.lastHop = now;
        }
        if (aiming && t >= aimOf(state, e)) {
          fireBolt(state, e, events);
          e.fired = true;
          e.refireAt = now + (e.type === "sentinel"
            ? (C.SENTINEL[e.tier] || C.SENTINEL[1]).closedMs : C.REFIRE_MS);
          // the hop clock is deliberately NOT reset here: shoot, then scoot.
          // A reset starved the mett -- its hop interval is longer than its
          // reload, so an armed mett could never accumulate the idle time.
        }
        if (t >= lifeOf(state, e)) { e.state = "sinking"; e.t0 = now; }
        break;
      }
      case "sinking":
        if (t >= C.SINK_MS) {
          // an untouched prog reaching cover is worth a little time
          if (e.type === "ally") {
            state.timeLeft = Math.min(C.TIME_CAP, state.timeLeft + C.ALLY_SPARE_BONUS);
            const p = panel(state, e.col, e.row);
            state.fx.popups.push({
              x: p.x + p.w / 2, y: p.y, t0: now,
              text: "spared +" + C.ALLY_SPARE_BONUS.toFixed(1) + "s", color: "#58c7ff",
            });
            events.push({
              type: "allySpared", col: e.col, row: e.row,
              x: p.x + p.w / 2, y: p.y, timeBonus: C.ALLY_SPARE_BONUS,
            });
          }
          events.push({ type: "enemyEscaped", enemyType: e.type, col: e.col, row: e.row });
          state.enemies.splice(i, 1);
        }
        break;
      case "hit":
        if (t >= C.HIT_MS) state.enemies.splice(i, 1);
        break;
    }
  }
}

function hopTo(state, e, events) {
  const free = freePanels(state, e.col, e.row);
  if (!free.length) return;
  const [c, r] = free[Math.floor(state.rng() * free.length)];
  e.hopFromCol = e.col; e.hopFromRow = e.row;
  e.col = c; e.row = r;
  e.hopT0 = state.clock;
  const p = panel(state, c, r);
  events.push({ type: "hopperHop", col: c, row: r, x: p.x + p.w / 2, y: p.y });
}

// ---------- incoming fire ----------

/**
 * Incoming fire. Two kinds, and the difference is the mechanic:
 *
 *   slow — the mett's siege shell. Huge and lumbering; you can still leave the
 *          row after it launches.
 *   fast — the hopper's. Crosses the board in a blink, so it has to be dodged
 *          during the telegraph — which is why the hopper's aim is the longest
 *          window in the game.
 *
 * The bolt carries everything the renderer needs as data: `kind` for the look,
 * `radius` in px (already scaled to the board) for the size, `speed` in px/ms.
 * `heavy` is kept as a legacy alias for the slow bolt so an older shell (and
 * the audio bank, which keys its bass layer off it) still reads correctly.
 */
function fireBolt(state, e, events) {
  const p = panel(state, e.col, e.row);
  const kind = e.boltKind || C.boltKindFor(e.type);
  state.bolts.push({
    row: e.row,
    x: p.x + p.w / 2,
    speed: state.G.pw / C.boltPanelMs(state.deletions, kind),  // px per ms, travelling left
    kind,
    radius: state.G.pw * C.BOLT[kind].radiusFrac,
    heavy: kind === "slow",
  });
  events.push({
    type: "enemyFired", enemyType: e.type, col: e.col, row: e.row,
    kind, heavy: kind === "slow", x: p.x + p.w / 2, y: p.y,
  });
}

// dt rather than the clock: bolts move in real time, and the early return
// freezes them for pause and the interlevel card alike.
function updateBolts(state, dt, events) {
  if (state.mode !== "playing" || state.paused) return;
  const now = state.clock;
  const G = state.G;
  const pr = panel(state, state.player.col, state.player.row);
  const px = pr.x + pr.w / 2;
  const hitR = G.pw * C.BOLT_HIT_R;
  for (let i = state.bolts.length - 1; i >= 0; i--) {
    const b = state.bolts[i];
    b.x -= b.speed * dt;
    if (b.row === state.player.row && now >= state.hurtUntil && Math.abs(b.x - px) <= hitR) {
      state.bolts.splice(i, 1);
      takeHit(state, events);
      continue;
    }
    if (b.x < G.gx + (activeArena(state.world).x0 - 0.5) * G.pw) state.bolts.splice(i, 1);
  }
}

/**
 * Lob a bomb BOMB_RANGE columns ahead along your row. It is ordnance, not a
 * shot: no charge, no hitscan, one per pickup.
 */
/**
 * The context button. Beside a keeper it is TALK; anywhere else it is the
 * bomb. The core records the press and who it was to; the shell turns that
 * into a line from the sealed canon, so no text ever lives here.
 */
function contextAction(state, events) {
  if (state.mode !== "playing" || state.paused) return;
  const n = npcBeside(state.world, state.player.col, state.player.row);
  if (!n) { throwBomb(state, events); return; }
  state.talks[n.id] = (state.talks[n.id] || 0) + 1;
  const p = panel(state, n.col, n.row);
  ripple(state, n.col, n.row, "#ffd23f", state.clock, 1);
  events.push({ type: "talk", npc: n.id, verb: n.verb || "talk", count: state.talks[n.id], col: n.col, row: n.row,
                x: p.x + p.w / 2, y: p.y });
}

function throwBomb(state, events) {
  if (state.mode !== "playing" || state.paused) return;
  // an empty stash is told, so a press that does nothing is never a mystery
  if (state.bombs <= 0) { events.push({ type: "bombEmpty" }); return; }
  const now = state.clock;
  const a = activeArena(state.world);
  const toCol = Math.min(state.player.col + C.BOMB_RANGE, a.x0 + a.cols - 1);
  state.bombs--;
  state.bombsInFlight.push({
    fromCol: state.player.col, fromRow: state.player.row,
    toCol, toRow: state.player.row, t0: now, dur: C.BOMB_ARC_MS,
  });
  const p = panel(state, state.player.col, state.player.row);
  events.push({ type: "bombThrown", col: state.player.col, row: state.player.row,
                toCol, x: p.x + p.w / 2, y: p.y, bombs: state.bombs });
  events.push({ type: "statsChanged" });
}

/** Bombs in the air land; a landed bomb splashes a 3x3 and hurts whoever is in it. */
function updateBombs(state, events) {
  const now = state.clock;
  for (let i = state.bombsInFlight.length - 1; i >= 0; i--) {
    const b = state.bombsInFlight[i];
    if (now < b.t0 + b.dur) continue;
    state.bombsInFlight.splice(i, 1);
    detonate(state, b.toCol, b.toRow, events);
  }
  const bl = state.fx.blasts;
  for (let i = bl.length - 1; i >= 0; i--) if (now - bl[i].t0 > C.BOMB_BLAST_MS) bl.splice(i, 1);
}

function detonate(state, col, row, events) {
  const now = state.clock;
  const R = C.BOMB_RADIUS;
  const p = panel(state, col, row);
  const cx = p.x + p.w / 2, cy = p.y + p.h * 0.5;
  let kills = 0;
  for (const e of state.enemies.slice()) {
    if (Math.abs(e.col - col) > R || Math.abs(e.row - row) > R) continue;
    if (!(e.state === "rising" || e.state === "up" || e.state === "sinking")) continue;
    if (e.type === "ally") {
      e.state = "hit"; e.t0 = now;
      hitFx(e, C.TIERS.charged, now);
      state.whiffs++;
      breakChain(state, events, "prog");
      state.timeLeft = Math.max(0, state.timeLeft - C.ALLY_TIME_PENALTY);
      state.score = Math.max(0, state.score - C.ALLY_PTS_PENALTY);
      const ep = panel(state, e.col, e.row);
      state.fx.popups.push({ x: ep.x + ep.w / 2, y: ep.y - 8, t0: now,
        text: "PROG HIT \u2212" + C.ALLY_TIME_PENALTY.toFixed(1) + "s", color: "#ff5470" });
      events.push({ type: "progHit", tier: "charged", col: e.col, row: e.row,
        x: ep.x + ep.w / 2, y: ep.y, timePenalty: C.ALLY_TIME_PENALTY, pointsPenalty: C.ALLY_PTS_PENALTY });
      continue;
    }
    if (e.type === "sentinel") {
      const open = e.willAttack ? !e.fired : true;
      if (!open) continue;
      if (e.hp > C.SENTINEL_CHARGED_DMG) {
        e.hp -= C.SENTINEL_CHARGED_DMG;
        const ep = panel(state, e.col, e.row);
        events.push({ type: "sentinelHit", col: e.col, row: e.row, x: ep.x + ep.w / 2, y: ep.y, hp: e.hp });
        continue;
      }
    }
    deleteEnemy(state, e, "charged", now, events);
    kills++;
  }
  if (Math.abs(state.player.col - col) <= R && Math.abs(state.player.row - row) <= R &&
      now >= state.hurtUntil) {
    takeHit(state, events);
  }
  for (let dc = -R; dc <= R; dc++) for (let dr = -R; dr <= R; dr++) {
    const r = row + dr;
    if (r < 0 || r >= C.ROWS) continue;
    ripple(state, col + dc, r, "#ff9f45", now, dc === 0 && dr === 0 ? 4 : 2);
  }
  spawnBits(state, cx, cy, 28, C.DEBRIS.rare, { at: now, speed: 0.42, spread: 2.2, ms: 620 });
  shake(state, C.SHAKE.rare || C.SHAKE.normal, now, 1.3);
  hitStop(state, now, C.HITSTOP.rare || C.HITSTOP.normal);
  state.fx.blasts.push({ col, row, x: cx, y: cy, t0: now });
  events.push({ type: "bombBlast", col, row, x: cx, y: cy, kills });
}

function takeHit(state, events) {
  const now = state.clock;
  state.hurtUntil = now + C.HIT_IFRAME_MS;
  state.fx.hurtT0 = now;
  state.timeLeft = Math.max(0, state.timeLeft - C.HIT_TIME_PENALTY);
  breakChain(state, events, "hurt");
  state.charge.downAt = null; state.charge.full = false;   // a hit spills your charge
  state.path = null;                                        // and stops an auto-walk: the world spoke
  const p = panel(state, state.player.col, state.player.row);
  state.fx.popups.push({
    x: p.x + p.w / 2, y: p.y - 8, t0: now,
    text: "HIT −" + C.HIT_TIME_PENALTY.toFixed(1) + "s", color: "#ff5470",
  });
  state.fx.sparks.push({ x: p.x + p.w / 2, y: p.y + p.h * 0.3, t0: now });
  spawnBits(state, p.x + p.w / 2, p.y + p.h * 0.4, C.BIT_COUNT.hurt, C.DEBRIS.player,
    { speed: 0.26, spread: 1.4, at: now });
  ripple(state, state.player.col, state.player.row, "#ff5470", now, 3);
  shake(state, C.SHAKE.hurt, now);
  hitStop(state, now, C.HITSTOP.hurt);
  events.push({
    type: "playerHit", col: state.player.col, row: state.player.row,
    x: p.x + p.w / 2, y: p.y, timePenalty: C.HIT_TIME_PENALTY,
  });
  events.push({ type: "statsChanged" });
  // the clock running out is the frame loop's call, same as any other drain
}

function breakChain(state, events, cause, at = state.clock) {
  const chain = state.chain;
  state.chain = 0;
  if (chain <= 0) return;
  // Two or more is a chain worth mourning; one is just a hit.
  if (chain >= 2) {
    const p = panel(state, state.player.col, state.player.row);
    // Taking a bolt already shouts; a second banner over the same panel just
    // fights the HIT popup, so a hurt-break shows only its falling links.
    const quiet = cause === "hurt";
    state.fx.chainBreak = { t0: at, chain, x: p.x + p.w / 2, y: p.y - 6, quiet };
    if (!quiet) ripple(state, state.player.col, state.player.row, "#8a96b8", at, 2);
  }
  events.push({ type: "chainBroken", chain, cause });
}

// ---------- shooting ----------

const isVisible = (e) => e.state === "rising" || e.state === "up" || e.state === "sinking";

function hitFx(target, tier, now) {
  target.tier = tier;
  target.fx = {
    scale:  C.makeImpulse(tier.scale, now),
    squash: C.makeImpulse(tier.squash, now),
    kick:   C.makeImpulse(tier.kick, now),
  };
}

/**
 * A virus dies. Shared by the buster and the bomb, so both pay the same score,
 * time, chain and fx -- the bomb is simply a charged-tier delete on up to nine
 * squares at once.
 */
function deleteEnemy(state, target, tierName, land, events) {
  const now = state.clock;
  const tier = C.TIERS[tierName];
  const p = panel(state, target.col, target.row);
  // the same origin shoot() has always used, so a bomb kill and a buster kill
  // burst from the identical point -- and classic's frames do not move
  const cx = p.x + p.w / 2, cy = p.y + p.h * 0.34;
  // deletion
  target.state = "hit"; target.t0 = land;
  hitFx(target, tier, land);

  const multBefore = C.multOf(state.chain);
  state.chain++;
  if (state.chain > state.bestChain) state.bestChain = state.chain;
  const mult = C.multOf(state.chain);
  // a wave is "cleared" only when every virus in it was actually deleted
  if (state.wave && target.wave === state.wave.index) state.wave.kills++;

  const baseKey =
    target.type === "guard" ? "guard" :
    target.type === "hopper" ? "hopper" :
    target.type === "rare" ? "rare" :
    target.type === "sentinel" ? "sentinel" : tierName;
  const pts = (C.PTS[baseKey] === undefined ? C.PTS[tierName] : C.PTS[baseKey]) * mult;
  state.score += pts;
  state.deletions++;

  const bf = C.bonusFactor(state.deletions);
  const factor = baseKey === "rare" ? Math.sqrt(bf) : bf;
  const timeBonus = (C.BONUS[baseKey] === undefined ? C.BONUS[tierName] : C.BONUS[baseKey]) * factor;
  state.timeLeft = Math.min(C.TIME_CAP, state.timeLeft + timeBonus);

  // The felt half of a delete: debris in the skin's own colours, a ring in the
  // struck panel, a kick on the whole screen and a freeze — all sized by what
  // died, so a rare is unmistakably an event and a mett is a satisfying tap.
  spawnBits(state, cx, cy, (C.BIT_COUNT[baseKey] || C.BIT_COUNT.guard), (C.DEBRIS[target.type] || C.DEBRIS.guard), {
    at: land,
    speed: baseKey === "rare" ? 0.4 : baseKey === "charged" ? 0.34 : 0.28,
    spread: 1.25,
  });
  ripple(state, target.col, target.row,
    baseKey === "rare" ? "#ffd23f" : baseKey === "guard" ? "#c9f6ff" : "#45e0e8",
    land, baseKey === "rare" ? 4 : 3);
  // the player's own panel answers a landed shot
  ripple(state, state.player.col, state.player.row, "#45e0e8", land, 1);
  shake(state, C.SHAKE[baseKey] || C.SHAKE.normal, land);
  hitStop(state, land, C.HITSTOP[baseKey] || C.HITSTOP.normal);

  events.push({
    type: "hit", tier: tierName, enemyType: target.type, baseKey,
    col: target.col, row: target.row, x: cx, y: p.y,
    points: pts, mult, chain: state.chain, timeBonus,
  });
  if (mult > multBefore) {
    events.push({ type: "multiplierUp", mult, chain: state.chain });
    // a real flourish at every multiplier step, not just a bigger number
    state.fx.flare = { t0: land, mult, x: cx, y: cy };
    shake(state, C.SHAKE.chain, land, mult / 2);
    hitStop(state, land, C.HITSTOP.chain);
    spawnBits(state, cx, cy, 6 + mult * 2, C.DEBRIS.rare,
      { at: land, speed: 0.34, spread: 2, ms: 640 });
  }

  state.fx.popups.push({
    x: cx, y: p.y - 8, t0: land,
    text: "+" + pts + (mult > 1 ? " ×" + mult : ""),
    color: baseKey === "rare" ? "#ffe08a" : baseKey === "guard" || mult > 1 ? "#45e0e8" : "#aab4ce",
  });
  state.fx.popups.push({
    x: cx, y: p.y + 12, t0: land + 60,
    text: "+" + timeBonus.toFixed(1) + "s",
    color: factor < 1 ? "#ff9f45" : "#ffd23f",
  });

  events.push({ type: "statsChanged" });
  // the stage gate is checked once per frame at the end of step(), not here:
  // a gate now needs a wave floor as well as a deletion floor, and either can
  // be the one that lands last.
}

function shoot(state, tierName, events) {
  const now = state.clock;
  const G = state.G;
  const tier = C.TIERS[tierName];
  state.fx.recoil = C.makeImpulse(tier.recoil, now);
  state.fx.muzzleT0 = now;
  state.fx.muzzleTier = tierName;
  state.shots++;

  const row = state.player.row;
  let target = null;
  for (const e of state.enemies) {
    if (!isVisible(e) || e.row !== row) continue;
    // progs are safe while rising or sinking — shots pass through them
    if (e.type === "ally" && e.state !== "up") continue;
    if (e.col <= state.player.col) continue;   // the buster only fires forward
    if (!target || e.col < target.col) target = e;
  }

  // bullet path: from the buster's muzzle to the first target (or the right edge)
  const pr = panel(state, state.player.col, row);
  const bwP = G.pw * 0.34;
  const x0 = pr.x + pr.w / 2 + bwP / 2 + bwP * 0.55;
  const ax0 = activeArena(state.world).x0;
  const x1 = target ? panel(state, target.col, row).x + G.pw / 2 : G.gx + G.pw * (ax0 + C.COLS);
  // hitscan logic stays instant; the tracer just travels fast (~5 px/ms)
  const dur = Math.max(40, Math.min(95, (x1 - x0) / 5));
  state.fx.ray = { t0: now, row, hitCol: target ? target.col : null, x0, x1, dur, tier: tierName };

  // `land` is when the tracer arrives. Scoring stays instant — the hitscan is
  // the rule and the tests pin it — but every *visible* consequence is dated to
  // the impact, so the enemy no longer pops half a board before the shot gets
  // there. The delete animation, the debris, the freeze and the popups all
  // start together at `land`.
  const land = now + dur;

  events.push({
    type: "shot", tier: tierName, row, x: x0, y: C.laneY(G, row),
    hit: !!target, targetType: target ? target.type : null,
  });

  if (!target) {
    state.whiffs++;
    events.push({ type: "whiff", tier: tierName, row, x: x1, y: C.laneY(G, row) });
    breakChain(state, events, "whiff", land);
    events.push({ type: "statsChanged" });
    return;
  }

  const p = panel(state, target.col, target.row);
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h * 0.34;

  // friendly prog: hitting it hurts — the anti-spam tax
  if (target.type === "ally") {
    target.state = "hit"; target.t0 = land;
    hitFx(target, tier, land);
    state.whiffs++;                        // accuracy and rank take the hit too
    breakChain(state, events, "prog", land);
    state.timeLeft = Math.max(0, state.timeLeft - C.ALLY_TIME_PENALTY);
    state.score = Math.max(0, state.score - C.ALLY_PTS_PENALTY);
    state.fx.popups.push({
      x: cx, y: p.y - 8, t0: land,
      text: "PROG HIT −" + C.ALLY_TIME_PENALTY.toFixed(1) + "s", color: "#ff5470",
    });
    spawnBits(state, cx, cy, C.BIT_COUNT.prog, C.DEBRIS.ally, { at: land, speed: 0.18 });
    ripple(state, target.col, target.row, "#ff5470", land, 3);
    shake(state, C.SHAKE.prog, land);
    hitStop(state, land, C.HITSTOP.prog);
    events.push({
      type: "progHit", tier: tierName, col: target.col, row: target.row, x: cx, y: p.y,
      timePenalty: C.ALLY_TIME_PENALTY, pointsPenalty: C.ALLY_PTS_PENALTY,
    });
    events.push({ type: "statsChanged" });
    return;
  }

  if (target.type === "guard" && tierName === "normal") {
    state.fx.sparks.push({ x: p.x + p.w * 0.28, y: p.y + p.h * 0.2, t0: land });
    state.fx.popups.push({ x: cx, y: p.y - 8, t0: land, text: "GUARD", color: "#8a96b8" });
    // a plink sprays back toward the player, not outward
    spawnBits(state, p.x + p.w * 0.28, cy, C.BIT_COUNT.block, C.DEBRIS.guard,
      { at: land, dir: Math.PI, spread: 0.7, speed: 0.16, ms: 320 });
    ripple(state, target.col, target.row, "#aeb9d6", land, 2);
    hitStop(state, land, C.HITSTOP.block);
    events.push({ type: "guardBlocked", col: target.col, row: target.row, x: cx, y: p.y });
    return;
  }

  // the sentinel: armour while closed, a health bar while open
  if (target.type === "sentinel") {
    const open = target.willAttack ? !target.fired : true;
    if (!open) {
      state.fx.sparks.push({ x: p.x + p.w * 0.28, y: p.y + p.h * 0.2, t0: land });
      state.fx.popups.push({ x: cx, y: p.y - 8, t0: land, text: "CLOSED", color: "#b48cff" });
      spawnBits(state, p.x + p.w * 0.28, cy, C.BIT_COUNT.block, C.DEBRIS.guard,
        { at: land, speed: 0.14, ms: 260 });
      ripple(state, target.col, target.row, "#b48cff", land, 2);
      events.push({ type: "guardBlocked", col: target.col, row: target.row, x: cx, y: p.y });
      return;
    }
    const dmg = tierName === "charged" ? C.SENTINEL_CHARGED_DMG : 1;
    if (target.hp > dmg) {
      target.hp -= dmg;
      state.fx.sparks.push({ x: cx, y: p.y + p.h * 0.2, t0: land });
      state.fx.popups.push({ x: cx, y: p.y - 8, t0: land, text: target.hp + " more", color: "#c48cff" });
      spawnBits(state, cx, cy, C.BIT_COUNT.stagger, C.DEBRIS.guard, { at: land, speed: 0.17, ms: 340 });
      ripple(state, target.col, target.row, "#c48cff", land, 2);
      hitStop(state, land, C.HITSTOP.stagger);
      events.push({ type: "sentinelHit", col: target.col, row: target.row, x: cx, y: p.y, hp: target.hp });
      return;
    }
  }

  // hopper stamina: a tap staggers it and it flees; charged shots kill outright
  if (target.type === "hopper" && tierName === "normal" && target.hp > 1) {
    target.hp--;
    state.fx.sparks.push({ x: cx, y: p.y + p.h * 0.2, t0: land });
    state.fx.popups.push({ x: cx, y: p.y - 8, t0: land, text: "1 more", color: "#5ee87c" });
    spawnBits(state, cx, cy, C.BIT_COUNT.stagger, C.DEBRIS.hopper,
      { at: land, speed: 0.17, ms: 340 });
    ripple(state, target.col, target.row, "#5ee87c", land, 2);
    hitStop(state, land, C.HITSTOP.stagger);
    events.push({
      type: "hopperStagger", col: target.col, row: target.row, x: cx, y: p.y, hp: target.hp,
    });
    hopTo(state, target, events);
    target.lastHop = now;
    return;                            // contact: chain neither breaks nor grows
  }

  deleteEnemy(state, target, tierName, land, events);
}

// ---------- fx bookkeeping ----------
// Expiring popups and sparks used to happen inside the draw calls; it belongs
// to the simulation so a renderer can be a pure function of the state.

function cullFx(state) {
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
function clearFx(state) {
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
