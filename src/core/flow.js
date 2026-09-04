/*!
 * Run flow: fire presses, pause, a run's start and end, the arcade's stage
 * gates and cards, and the world watcher that notices you stepping into an
 * arena or onto a tower and eases the camera.
 */

import * as C from "./constants.js";
import { bumpTask } from "./tasks-count.js";
import { createWorld, activeArena, segmentAt } from "./world.js";
import { computeRank } from "./select.js";
import { shoot } from "./combat.js";
import { clearFx } from "./fx.js";

export function firePressed(state, events) {
  if (!state.canFire) return;
  state.canFire = false;
  if (state.mode === "ready" || state.mode === "over") { resetGame(state, events); return; }
  if (state.mode === "interlevel") { resumeFromInterlevel(state, events); return; }
  if (state.paused) return;
  shoot(state, "normal", events);
  state.charge.downAt = state.clock;
  state.charge.full = false;
}

export function fireReleased(state, events) {
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

export function togglePause(state, events) {
  if (state.mode !== "playing") return;
  state.paused = !state.paused;
  if (state.paused) { state.charge.downAt = null; state.charge.full = false; }
  events.push({ type: state.paused ? "paused" : "unpaused" });
}

// ---------- game flow ----------

export function resetGame(state, events, modeId) {
  const cfg = C.modeById(modeId || state.modeId);
  state.modeId = cfg.id;
  state.world = createWorld({ story: !!cfg.story, tuning: state.tuning });
  state.talks = {};
  state.routeIdx = 1;
  state.hop = null;
  state.path = null;
  state.arenasCleared = 0;
  state.bombs = 0;
  state.stash.length = 0;
  state.parry = false;
  state.cloakUntil = -1e9;
  state.lastShotTier = null;
  state.echo = null;
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
  state.timeLeft = state.tuning.START_TIME;
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

export function gameOver(state, events) {
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
export function checkStageGate(state, events) {
  if (state.mode !== "playing" || state.paused) return;
  if (C.modeById(state.modeId).advancing) return;   // advance cards are keyed to arenas, not this syllabus
  const st = C.STAGES[state.stageIdx];
  if (!st) return;
  if (state.waveIdx >= st.wave && state.deletions >= st.at) enterInterlevel(state, events);
}

export function enterInterlevel(state, events) {
  const stage = C.STAGES[state.stageIdx];
  const index = state.stageIdx;
  state.stageIdx++;
  state.mode = "interlevel";
  state.charge.downAt = null;
  state.charge.full = false;
  state.bolts.length = 0;   // don't resume the run into a bolt you can't see coming
  state.hitStopMs = 0;      // nor into the tail of a freeze from the kill that opened the gate
  state.timeLeft = Math.min(state.tuning.TIME_CAP, state.timeLeft + state.tuning.STAGE_BONUS);
  events.push({
    type: "stageGate",
    stage,
    index,
    title: stage.title,
    timeBonus: state.tuning.STAGE_BONUS,
  });
  events.push({ type: "statsChanged" });
}

/**
 * Each frame: notice the player stepping into the arena they were walking
 * toward, and ease the camera. Both live in the core so a replay from a seed
 * reproduces the scroll exactly; the renderer only applies `cam`.
 */
export function updateWorld(state, events) {
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
    state.nextSpawnAt = now + state.tuning.ARENA_ENTRY_DELAY_MS;
    state.levelT0 = now;
    bumpTask(state, "arenaEntered");
    events.push({ type: "arenaEntered", index: a.idx, x0: a.x0 });
    if (a.idx >= state.tuning.ROAD_END) state.unlimited = true;
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
  else state.cam += d * (1 - Math.exp(-dt / state.tuning.CAM_TAU_MS));
}

/** Advance's chapter card: same overlay as a classic gate, keyed to an arena. */
export function showCard(state, events, stage, index) {
  state.mode = "interlevel";
  state.charge.downAt = null;
  state.charge.full = false;
  state.bolts.length = 0;
  state.timeLeft = Math.min(state.tuning.TIME_CAP, state.timeLeft + state.tuning.STAGE_BONUS);
  events.push({ type: "stageGate", stage, index, title: stage.title, timeBonus: state.tuning.STAGE_BONUS });
  events.push({ type: "statsChanged" });
}

export function resumeFromInterlevel(state, events) {
  if (state.mode !== "interlevel") return;
  state.mode = "playing";
  state.nextSpawnAt = state.clock + 700;
  // A gate can open in the middle of a formation. Give the rest of it the same
  // beat back, so the card is never followed instantly by an arrival.
  if (state.wave) for (const slot of state.wave.queue) slot.at += 700;
  events.push({ type: "resumed" });
}
