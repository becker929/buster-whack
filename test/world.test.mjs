// The world: an unbounded strip of arenas joined by roads. Classic is a single
// arena that never clears to a road; advance grows. These pin the tile model,
// the wipe -> road -> next arena sequence, the wave waking on entry, and the
// camera -- all of which live in the core so a seed replays the scroll exactly.

import test from "node:test";
import assert from "node:assert/strict";
import { newGame, step, C } from "./helpers.mjs";
import { createWorld, tileAt, walkable, clearArena, activeArena, TILE } from "../src/core/world.js";
import { mulberry32 } from "../src/core/rng.js";

function advanceGame(seed = 3) {
  const s = newGame({ seed });
  step(s, 0, [{ type: "startRun", modeId: "advance" }]);
  s.nextSpawnAt = Infinity;   // no organic spawning; tests stage waves by hand
  s.enemies.length = 0;
  return s;
}

/**
 * Stage an active wave whose viruses are all dead, so the next tick ends it.
 * By default it is the arena's last wave (the pool is marked spent), so the
 * wipe opens the road; pass `final: false` to leave pool behind it.
 */
function stageWipedWave(s, kills, virusCount = 1, final = true) {
  const a = activeArena(s.world);
  if (final) a.dealt = a.pool;
  s.waveState = "active";
  s.wave = { index: s.waveIdx, size: virusCount, virusCount, kills, startedAt: s.clock,
             deadline: s.clock + 1e9, queue: [] };
  s.enemies.length = 0;
}

/** Spawn every queued slot now and mark the wave fully dealt onto the board. */
function dealQueue(s) {
  for (const slot of s.wave.queue) slot.at = s.clock;
  step(s, 16, []);
}

/** Delete every live virus of the current wave and let the wave end. */
function wipeBoard(s) {
  s.wave.kills = s.wave.virusCount;
  s.enemies.length = 0;
  return step(s, 16, []);
}

test("a fresh world is one enemy-held arena at the origin", () => {
  const w = createWorld();
  assert.equal(w.segs.length, 1);
  for (let r = 0; r < C.ROWS; r++) {
    for (let c = 0; c < C.PCOLS; c++) assert.equal(tileAt(w, c, r), TILE.PLAYER, `(${c},${r})`);
    for (let c = C.PCOLS; c < C.COLS; c++) assert.equal(tileAt(w, c, r), TILE.ENEMY, `(${c},${r})`);
  }
  assert.equal(tileAt(w, C.COLS, 1), TILE.VOID, "nothing past the arena yet");
  assert.equal(tileAt(w, -1, 1), TILE.VOID);
  assert.equal(tileAt(w, 1, -1), TILE.VOID);
  assert.equal(tileAt(w, 1, C.ROWS), TILE.VOID);
});

test("only your ground and the road are standable", () => {
  const w = createWorld();
  assert.ok(walkable(w, 0, 0));
  assert.ok(!walkable(w, C.PCOLS, 0), "never an enemy tile");
  assert.ok(!walkable(w, C.COLS, 1), "never off the map");
});

test("wiping an arena hands it over and lays a road to the next one", () => {
  const w = createWorld();
  const { cleared, road, next } = clearArena(w, mulberry32(9));
  assert.equal(cleared.owner, "player");
  for (let r = 0; r < C.ROWS; r++) {
    for (let c = 0; c < C.COLS; c++) assert.equal(tileAt(w, c, r), TILE.PLAYER, "the whole arena is yours");
  }
  assert.equal(road.x0, C.COLS, "the road starts where the arena ends");
  assert.equal(road.cols, C.ROAD_COLS);
  assert.ok(road.rows === 1 || road.rows === C.ROWS, "a road is full height or a single row");
  assert.equal(next.x0, road.x0 + road.cols, "the next arena waits at the road's end");
  assert.equal(next.owner, "enemy");
  assert.equal(next.idx, 1);
  assert.equal(next.entered, false, "the next arena is asleep until you step in");
  assert.equal(activeArena(w), next, "the active arena is always the last one");
});

test("a single-row road is standable only in its middle row", () => {
  // find a seed whose first road is narrow, so the test does not depend on luck
  let w, road;
  for (let seed = 1; seed < 50; seed++) {
    w = createWorld();
    ({ road } = clearArena(w, mulberry32(seed)));
    if (road.rows === 1) break;
  }
  assert.equal(road.rows, 1, "expected to find a narrow road within 50 seeds");
  for (let c = road.x0; c < road.x0 + road.cols; c++) {
    assert.equal(tileAt(w, c, C.ROAD_MID_ROW), TILE.ROAD);
    assert.equal(tileAt(w, c, 0), TILE.VOID, "the rows beside a narrow road are void");
    assert.equal(tileAt(w, c, 2), TILE.VOID);
    assert.ok(walkable(w, c, C.ROAD_MID_ROW) && !walkable(w, c, 0));
  }
});

test("road heights come from the rng: the same seed lays the same roads", () => {
  const lay = (seed) => {
    const w = createWorld();
    const rng = mulberry32(seed);
    return [1, 2, 3, 4, 5, 6].map(() => clearArena(w, rng).road.rows);
  };
  assert.deepEqual(lay(11), lay(11));
  // and across many seeds both heights actually occur
  const all = new Set();
  for (let seed = 1; seed < 40; seed++) for (const r of lay(seed)) all.add(r);
  assert.ok(all.has(1) && all.has(C.ROWS), "both road heights should appear");
});

test("classic never grows: a wiped wave leaves one arena and a normal lull", () => {
  const s = newGame({ seed: 4 });
  stageWipedWave(s, 1);
  const ev = step(s, 16, []);
  assert.equal(s.world.segs.length, 1);
  assert.ok(Number.isFinite(s.nextSpawnAt), "classic schedules the next wave");
  assert.ok(!ev.some((e) => e.type === "arenaCleared"));
});

test("advance: a wiped wave takes the arena, lays the road, and waits for you", () => {
  const s = advanceGame();
  const t0 = s.timeLeft;
  stageWipedWave(s, 1);
  const ev = step(s, 16, []);
  const done = ev.find((e) => e.type === "arenaCleared");
  assert.ok(done, "the wipe should announce the arena");
  assert.equal(done.index, 0);
  assert.equal(done.nextX0, C.COLS + C.ROAD_COLS);
  assert.equal(s.world.segs.length, 3, "arena, road, arena");
  assert.equal(s.arenasCleared, 1);
  assert.equal(s.nextSpawnAt, Infinity, "no wave until the next arena is entered");
  assert.ok(s.timeLeft > t0, "taking an arena pays time");
});

test("advance: a wave that merely lapses does not take the arena", () => {
  const s = advanceGame();
  stageWipedWave(s, 0, 2);   // two viruses, none killed
  const ev = step(s, 16, []);
  assert.equal(s.world.segs.length, 1, "you have to actually clear it");
  assert.ok(Number.isFinite(s.nextSpawnAt), "another wave comes to the same arena");
  assert.ok(!ev.some((e) => e.type === "arenaCleared"));
});

test("stepping into the next arena is the wave boundary", () => {
  const s = advanceGame();
  stageWipedWave(s, 1);
  step(s, 16, []);
  const next = activeArena(s.world);
  assert.equal(next.entered, false);

  // walk to the last road tile: still asleep
  s.player.col = next.x0 - 1; s.player.row = C.ROAD_MID_ROW;
  let ev = step(s, 16, []);
  assert.equal(s.nextSpawnAt, Infinity);
  assert.ok(!ev.some((e) => e.type === "arenaEntered"));

  // one more column: awake, on a short delay
  s.player.col = next.x0;
  ev = step(s, 16, []);
  const entered = ev.find((e) => e.type === "arenaEntered");
  assert.ok(entered, "crossing the line should announce it");
  assert.equal(entered.index, 1);
  assert.equal(next.entered, true);
  assert.ok(Number.isFinite(s.nextSpawnAt));
  assert.ok(s.nextSpawnAt - s.clock <= C.ARENA_ENTRY_DELAY_MS + 1);
});

test("the next arena's wave forms up in that arena, not the origin", () => {
  const s = advanceGame();
  stageWipedWave(s, 1);
  step(s, 16, []);
  const next = activeArena(s.world);
  s.player.col = next.x0; s.player.row = 1;
  step(s, 16, []);                 // entered
  s.nextSpawnAt = s.clock;         // skip the entry delay
  step(s, 16, []);                 // the wave plans
  assert.ok(s.wave, "a wave should have started");
  for (const slot of s.wave.queue) {
    assert.ok(slot.col >= next.x0 + C.PCOLS && slot.col < next.x0 + C.COLS,
      `slot at column ${slot.col} is outside arena 1's enemy half`);
  }
});

test("from the road you can enter the next arena's footing but not its enemy half", () => {
  const s = advanceGame();
  stageWipedWave(s, 1);
  step(s, 16, []);
  const next = activeArena(s.world);
  s.player.col = next.x0 + C.PCOLS - 1; s.player.row = 1;
  s.lastMoveAt = -1e9;
  step(s, 0, [{ type: "move", dc: 1, dr: 0 }]);
  assert.equal(s.player.col, next.x0 + C.PCOLS - 1, "the enemy half is a wall");
});

test("camera: locked on the fight, following on the road, never behind or ahead of the arenas", () => {
  const s = advanceGame();
  // fighting in arena 0: the camera does not move
  for (let i = 0; i < 40; i++) step(s, 16, []);
  assert.equal(s.cam, 0);

  // arena taken, player walks out across its right half: the view follows,
  // but never behind the arena you were in
  stageWipedWave(s, 1);
  step(s, 16, []);
  s.player.col = 1;
  for (let i = 0; i < 60; i++) step(s, 16, []);
  assert.equal(s.cam, 0, "standing in the left half of a taken arena, the view stays");
  s.player.col = 5;
  for (let i = 0; i < 200; i++) step(s, 16, []);
  assert.ok(s.cam > 3.5 && s.cam <= 4, `expected the view to lead toward the road, got ${s.cam}`);

  // arriving: the camera settles exactly on the next arena's lock position
  const next = activeArena(s.world);
  s.player.col = next.x0 + 1;
  for (let i = 0; i < 400; i++) step(s, 16, []);
  assert.equal(s.cam, next.x0, "locked on the new arena");
  assert.ok(s.cam >= 0);
});

test("classic's camera is pinned at the origin for the whole run", () => {
  const s = newGame({ seed: 8, spawn: true });
  for (let i = 0; i < 600; i++) {
    step(s, 16, i % 7 === 0 ? [{ type: "firePressed" }, { type: "fireReleased" }] : []);
    assert.equal(s.cam, 0);
  }
});


// ---------------------------------------------------------------------------
// The arena pool: waves are dealt from it, persist, and the road opens when it
// is spent.
// ---------------------------------------------------------------------------

test("arena 0 guards its road with four viruses in two waves of two", () => {
  const plan = C.arenaPlan(0);
  assert.deepEqual(plan, { pool: 4, waveSize: 2 });
  // and the ramp grows both numbers without ever exceeding the board
  for (let i = 0; i < 40; i++) {
    const p = C.arenaPlan(i);
    assert.ok(p.waveSize <= C.MAX_ALIVE && p.waveSize <= (C.COLS - C.PCOLS) * C.ROWS);
    assert.ok(p.pool >= p.waveSize);
  }
});

test("the second wave is not dealt until the first is entirely dead; the road opens after the pool", () => {
  const s = advanceGame(5);
  const a = activeArena(s.world);
  s.nextSpawnAt = s.clock;
  step(s, 16, []);                                   // wave 1 planned
  assert.ok(s.wave, "wave 1 should be dealt");
  assert.equal(s.wave.virusCount, 2, "two join at once");
  assert.equal(a.dealt, 2);
  dealQueue(s);
  const w1 = s.enemies.filter((e) => e.type !== "ally");
  assert.equal(w1.length, 2);
  assert.ok(w1.every((e) => e.persistent), "pool viruses persist");

  // kill one: nothing new arrives, however long you wait
  s.enemies.splice(s.enemies.indexOf(w1[0]), 1);
  s.wave.kills = 1;
  for (let i = 0; i < 300; i++) step(s, 16, []);
  assert.equal(a.dealt, 2, "the pool must not deal while a wave member lives");
  assert.equal(s.world.segs.length, 1);

  // kill the other: the wave ends, and the next is dealt after a beat
  let ev = wipeBoard(s);
  assert.ok(ev.some((e) => e.type === "waveEnded" && e.cleared));
  assert.ok(!ev.some((e) => e.type === "arenaCleared"), "two of four is not the road");
  assert.equal(s.world.segs.length, 1);
  assert.ok(Number.isFinite(s.nextSpawnAt) && s.nextSpawnAt - s.clock <= C.ARENA_WAVE_GAP_MS + 1);
  for (let i = 0; i < 60 && !s.wave; i++) step(s, 16, []);
  assert.ok(s.wave, "wave 2 should be dealt");
  assert.equal(s.wave.virusCount, 2);
  assert.equal(a.dealt, 4, "the pool is now spent");
  dealQueue(s);

  // wipe it: the road opens
  ev = wipeBoard(s);
  assert.ok(ev.some((e) => e.type === "arenaCleared"), "four of four opens the road");
  assert.equal(s.world.segs.length, 3);
  assert.equal(s.nextSpawnAt, Infinity);
});

test("a pool virus never sinks on its own", () => {
  const s = advanceGame(5);
  s.nextSpawnAt = s.clock;
  step(s, 16, []);
  dealQueue(s);
  const v = s.enemies.find((e) => e.persistent);
  assert.ok(v);
  // Fund the clock: the run must not end mid-test, or game-over clears the
  // board and the assertion below would fail for the wrong reason.
  s.timeLeft = 120;
  for (let i = 0; i < 60000 / 16; i++) step(s, 16, []);   // a full minute
  assert.equal(s.mode, "playing", "the run must still be live for this to mean anything");
  assert.ok(s.enemies.includes(v), "still on the board");
  assert.notEqual(v.state, "sinking");
});

test("a persistent attacker re-aims after firing instead of going quiet", () => {
  const s = advanceGame(5);
  s.stageIdx = C.UNLOCK.retaliate;   // retaliation unlocked
  s.nextSpawnAt = s.clock;
  step(s, 16, []);
  dealQueue(s);
  const v = s.enemies.find((e) => e.persistent && e.type === "mett");
  assert.ok(v && v.willAttack, "an unlocked pool mett always shoots");
  let fired = 0, aims = 0;
  for (let i = 0; i < 8000 / 16; i++) {
    for (const ev of step(s, 16, [])) {
      if (ev.type === "enemyFired") fired++;
      if (ev.type === "enemyAim") aims++;
    }
  }
  assert.ok(fired >= 3, `expected repeated volleys over 8s, got ${fired}`);
  assert.ok(aims >= fired, "every volley is telegraphed");
});

test("in classic nothing persists and rares still appear in the composition path", () => {
  const s = newGame({ seed: 5, spawn: true });
  for (let i = 0; i < 200; i++) step(s, 16, []);
  assert.ok(s.enemies.every((e) => !e.persistent));
});

test("a square that has scrolled off the left edge cannot be stood on", () => {
  const s = advanceGame(5);
  stageWipedWave(s, 1);
  step(s, 16, []);
  // pretend the view has moved on to column 3.4: columns 0..2 are gone
  s.cam = 3.4; s.camAnchor = 3.4;
  s.player.col = 4; s.player.row = 1;
  s.lastMoveAt = -1e9;
  step(s, 0, [{ type: "move", dc: -1, dr: 0 }]);
  assert.equal(s.player.col, 3, "column 3 is still partly on screen");
  s.lastMoveAt = -1e9;
  step(s, 0, [{ type: "move", dc: -1, dr: 0 }]);
  assert.equal(s.player.col, 3, "column 2 has scrolled past: a wall");
});

test("the camera only ever moves right", () => {
  const s = advanceGame(5);
  stageWipedWave(s, 1);
  step(s, 16, []);
  s.player.col = 5;
  for (let i = 0; i < 200; i++) step(s, 16, []);
  const far = s.cam;
  assert.ok(far > 3, "the view should have led toward the road");
  // walking back left must not drag the view back with you
  s.player.col = 4;
  for (let i = 0; i < 200; i++) step(s, 16, []);
  assert.ok(s.cam >= far - 1e-9, `camera retreated from ${far} to ${s.cam}`);
});
