/*!
 * Saving a run, and loading one back.
 *
 * A save is a manifest and three sections. The manifest carries its own
 * version, so a reader always knows what it is holding:
 *
 *   version 1 — the first shape: run, world and an opaque story section.
 *
 * The rules are deliberately strict, because a wrong guess about an old save
 * is worse than refusing it: a save from a *newer* manifest version is always
 * refused, and an older one is only accepted if MIGRATIONS has a path from it
 * to the current version. Anything unreadable is refused with a reason the UI
 * can show, never thrown.
 *
 * What is saved is a run at rest. Saves are taken on safe ground -- a tower,
 * or an arena just taken -- where there are no enemies in the air, no bolts,
 * no hop in flight and no clock running, so none of that has to be captured
 * or restored. What does have to be captured is everything durable: the road
 * so far, the ledger, what you carry, and the exact position of the random
 * stream, without which a loaded run would draw different waves.
 *
 * The `story` section is opaque here. The core never sees canon text: the
 * shell puts its own snapshot in and takes it back out.
 *
 * Pure module. No DOM, no clock, no randomness.
 */

import { SAVE_VERSION, SAVE_GAME_ID, VERSION } from "./version.js";
import * as C from "./constants.js";
import { newTaskState } from "./tasks.js";
import { syncStash } from "./items.js";

/** Migrations from an older manifest version to the next one up. */
const MIGRATIONS = {
  // 1: the first shape. Nothing to migrate from yet. When version 2 arrives,
  // add `1: (data) => ({ ...data, manifest: { ...data.manifest, version: 2 } })`
  // alongside whatever the new shape needs.
};

/** A segment, reduced to what cannot be derived again. */
function packSeg(seg) {
  if (seg.kind === "tower") return { kind: "tower", x0: seg.x0, roost: seg.roost, entered: !!seg.entered };
  if (seg.kind === "road") return { kind: "road", x0: seg.x0, cols: seg.cols, rows: seg.rows };
  return {
    kind: "arena", x0: seg.x0, idx: seg.idx, owner: seg.owner, entered: !!seg.entered,
    pool: seg.pool, waveSize: seg.waveSize, dealt: seg.dealt,
  };
}

/** …and back. Towers rebuild their people from the route, not from the save. */
function unpackSeg(seg) {
  if (seg.kind === "tower") {
    const spec = C.towerSpec(seg.roost);
    return {
      kind: "tower", x0: seg.x0, cols: C.TOWER_COLS, roost: seg.roost,
      npcs: spec.npcs.map((n) => ({ ...n, col: seg.x0 + n.col })),
      entered: !!seg.entered,
    };
  }
  if (seg.kind === "road") return { kind: "road", x0: seg.x0, cols: seg.cols, rows: seg.rows };
  return {
    kind: "arena", x0: seg.x0, idx: seg.idx, owner: seg.owner, entered: !!seg.entered,
    pool: seg.pool, waveSize: seg.waveSize, dealt: seg.dealt,
  };
}

/** Where this save resumes, for the start screen to show. */
function whereAmI(state) {
  let arena = 0, roost = null;
  for (const seg of state.world.segs) {
    if (seg.kind === "arena") arena = Math.max(arena, seg.idx);
    if (seg.kind === "tower") roost = seg.roost;
  }
  return { arena, roost, score: state.score, level: state.arenasCleared + 1 };
}

/**
 * A run at rest, as a plain object ready for JSON.
 * @param {any} state
 * @param {any} [story] - the shell's own snapshot; opaque here
 */
export function toSave(state, story = null) {
  return {
    manifest: {
      game: SAVE_GAME_ID,
      version: SAVE_VERSION,
      build: VERSION,
      savedAt: Date.now(),
      at: whereAmI(state),
    },
    run: {
      seed: state.seed,
      rng: state.rng && state.rng.save ? state.rng.save() : null,
      modeId: state.modeId,
      tuning: state.tuning.overrides || {},
      score: state.score,
      best: state.best,
      timeLeft: state.timeLeft,
      deletions: state.deletions,
      shots: state.shots,
      whiffs: state.whiffs,
      chain: state.chain,
      bestChain: state.bestChain,
      arenasCleared: state.arenasCleared,
      routeIdx: state.routeIdx,
      stageIdx: state.stageIdx,
      waveIdx: state.waveIdx,
      unlimited: !!state.unlimited,
      player: { col: state.player.col, row: state.player.row },
      stash: state.stash.slice(),
      talks: { ...state.talks },
      tasks: {
        counts: { ...state.tasks.counts },
        active: state.tasks.active ? { ...state.tasks.active } : null,
        done: state.tasks.done.slice(),
        lastNpc: state.tasks.lastNpc,
      },
    },
    world: { segs: state.world.segs.map(packSeg) },
    story,
  };
}

/**
 * Is this readable, and at what version? Returns `{ ok, data, reason }`;
 * `data` is migrated to the current manifest version when `ok`.
 */
export function readSave(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not a save" };
  const m = raw.manifest;
  if (!m || typeof m !== "object") return { ok: false, reason: "no manifest" };
  if (m.game !== SAVE_GAME_ID) return { ok: false, reason: "not a Buster Whack save" };
  const v = Number(m.version);
  if (!Number.isInteger(v) || v < 1) return { ok: false, reason: "no manifest version" };
  if (v > SAVE_VERSION) return { ok: false, reason: "saved by a newer version of the game" };
  let data = raw;
  for (let at = v; at < SAVE_VERSION; at++) {
    const step = MIGRATIONS[at];
    if (!step) return { ok: false, reason: "saved by version " + v + ", too old to read" };
    data = step(data);
  }
  if (!data.run || !data.world || !Array.isArray(data.world.segs) || !data.world.segs.length) {
    return { ok: false, reason: "the save is incomplete" };
  }
  // modeById falls back to the default rather than returning nothing, so ask
  // the tables directly: a save naming a mode this build does not have is a
  // save this build cannot honour.
  const known = C.MODES.some((m) => m.id === data.run.modeId) ||
                C.RETIRED_MODES.some((m) => m.id === data.run.modeId);
  if (!known) return { ok: false, reason: "unknown mode " + data.run.modeId };
  return { ok: true, data };
}

/**
 * Put a read save back into a state. The caller has already checked it with
 * readSave; this trusts what it is given and returns the story section for
 * the shell to restore.
 */
export function applySave(state, data, events) {
  const run = data.run;
  state.modeId = run.modeId;
  if (state.rng && state.rng.restore && run.rng !== null && run.rng !== undefined) state.rng.restore(run.rng);
  state.world = { segs: data.world.segs.map(unpackSeg) };
  state.score = run.score;
  state.best = Math.max(state.best || 0, run.best || 0);
  state.timeLeft = run.timeLeft;
  state.deletions = run.deletions;
  state.shots = run.shots;
  state.whiffs = run.whiffs;
  state.chain = run.chain;
  state.bestChain = run.bestChain;
  state.arenasCleared = run.arenasCleared;
  state.routeIdx = run.routeIdx;
  state.stageIdx = run.stageIdx;
  state.waveIdx = run.waveIdx;
  state.unlimited = !!run.unlimited;
  state.player.col = run.player.col;
  state.player.row = run.player.row;
  state.stash.length = 0;
  for (const id of run.stash || []) state.stash.push(id);
  syncStash(state);
  state.talks = { ...(run.talks || {}) };
  const t = newTaskState();
  if (run.tasks) {
    Object.assign(t.counts, run.tasks.counts || {});
    t.active = run.tasks.active || null;
    t.done = (run.tasks.done || []).slice();
    t.lastNpc = run.tasks.lastNpc || null;
  }
  state.tasks = t;

  // a run at rest: nothing in the air, nothing aiming, no clock owed
  state.enemies.length = 0;
  state.bolts.length = 0;
  state.bombsInFlight.length = 0;
  state.pickups.length = 0;
  state.wave = null;
  state.waveState = "lull";
  state.nextSpawnAt = Infinity;
  state.hop = null;
  state.path = null;
  state.queuedMove = null;
  state.holdDir = null;
  state.holdT0 = -1e9;
  state.lastMoveAt = -1e9;
  state.hurtUntil = -1e9;
  state.parry = false;
  state.cloakUntil = -1e9;
  state.lastShotTier = null;
  state.echo = null;
  state.rank = null;
  state.paused = false;
  state.mode = "playing";
  // the camera starts where the player is standing, not back at the gate
  const seg = state.world.segs[state.world.segs.length - 1];
  state.camAnchor = seg ? seg.x0 : 0;
  state.cam = Math.max(0, state.player.col - 1);
  state.camClock = state.clock;
  state.levelT0 = -1e9;

  if (events) {
    events.push({ type: "runLoaded", modeId: run.modeId, story: !!C.modeById(run.modeId).story,
                  at: data.manifest.at });
    events.push({ type: "statsChanged" });
  }
  return data.story || null;
}
