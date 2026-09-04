// The hundred-arena road: advance as the default mode, level = arena, unlocks
// keyed to arenas with the card at the boundary, the yellow mett as a slow
// hopper, the Sentinel, and the bomb.

import test from "node:test";
import assert from "node:assert/strict";
import { newGame, step, C, T } from "./helpers.mjs";
import { activeArena, clearArena } from "../src/core/world.js";
import { hudView } from "../src/core/select.js";
import { createState } from "../src/core/state.js";

function advanceGame(seed = 3) {
  const s = newGame({ seed });
  step(s, 0, [{ type: "startRun", modeId: "advance" }]);
  s.nextSpawnAt = Infinity;
  s.enemies.length = 0;
  return s;
}

/** Walk the world forward to arena `idx` without fighting, the way a test can. */
function jumpToArena(s, idx, enter = true) {
  while (activeArena(s.world).idx < idx) clearArena(s.world, s.rng);
  const a = activeArena(s.world);
  s.player.col = a.x0 + 1; s.player.row = 1;
  s.cam = a.x0; s.camAnchor = a.x0;
  if (enter) {
    // stepping in arms the arena (and may show a card): consume both so the
    // test starts from a live, entered arena with no wave pending
    step(s, 16, []);
    if (s.mode === "interlevel") step(s, 0, [{ type: "resume" }]);
    s.nextSpawnAt = Infinity;
  }
  return a;
}

function place(s, o) {
  const e = {
    col: o.col, row: o.row === undefined ? 1 : o.row, type: o.type || "mett",
    state: "up", t0: s.clock, riseMs: T.RISE_MS, hp: o.hp === undefined ? 1 : o.hp,
    tier: o.tier || 0, lastHop: s.clock, hopT0: -1e9, wave: -1,
    willAttack: !!o.willAttack, fired: !!o.fired, refireAt: Infinity,
    boltKind: "slow", aimMs: o.aimMs || 600, persistent: !!o.persistent,
  };
  s.enemies.push(e);
  return e;
}

test("the story is the default and only mode; a chosen retired mode is kept", () => {
  assert.equal(C.DEFAULT_MODE, "story");
  assert.deepEqual(C.MODES.map((m) => m.id), ["story"]);
  // a fresh state is the default before any run; a bare startRun keeps it
  // (RETRY retries the mode you were playing, so the default is never re-imposed)
  const s = createState({ seed: 1, width: 800, height: 600 });
  assert.equal(s.modeId, "story");
  step(s, 0, [{ type: "startRun" }]);
  assert.equal(s.modeId, "story");
  const c = createState({ seed: 1, width: 800, height: 600, modeId: "advance" });
  step(c, 0, [{ type: "startRun" }]);
  assert.equal(c.modeId, "advance", "an explicit mode is respected and kept");
});

test("in advance the level is the arena you are in; classic still counts kills", () => {
  const s = advanceGame();
  assert.equal(hudView(s).level, 1);
  jumpToArena(s, 7);
  step(s, 16, []);
  assert.equal(hudView(s).level, 8);
  const c = newGame({ seed: 1 });
  c.deletions = 30;
  assert.equal(hudView(c).level, T.level(30));
});

test("the road ramps for a hundred arenas and is still climbing at the end", () => {
  assert.deepEqual(T.arenaPlan(0), { pool: 4, waveSize: 2 });
  const p50 = T.arenaPlan(50), p99 = T.arenaPlan(99), p100 = T.arenaPlan(100);
  assert.ok(p50.pool > T.arenaPlan(10).pool, "still growing at 50");
  assert.ok(p99.pool >= p50.pool && p100.pool >= p99.pool);
  assert.ok(p100.waveSize > T.arenaPlan(0).waveSize);
  assert.ok(T.arenaPlan(500).waveSize <= 5, "never more than the board can hold");
});

test("unlocks are keyed to arenas, with the card shown as you step in", () => {
  const s = advanceGame();
  // before the guards' arena: no guards in the plan
  jumpToArena(s, T.ADV_UNLOCK.guard - 1, false);
  const a = activeArena(s.world);
  a.entered = false; s.player.col = a.x0 - 1;
  step(s, 16, []);                                     // still on the road
  s.player.col = a.x0;
  let ev = step(s, 16, []);                            // enter arena guard-1: no card
  assert.ok(!ev.some((e) => e.type === "stageGate"));
  assert.equal(s.mode, "playing");

  // the guards' arena: the card, keyed to the arena boundary
  jumpToArena(s, T.ADV_UNLOCK.guard, false);
  const g = activeArena(s.world);
  g.entered = false; s.player.col = g.x0 - 1;
  step(s, 16, []);
  s.player.col = g.x0;
  ev = step(s, 16, []);
  const card = ev.find((e) => e.type === "stageGate");
  assert.ok(card, "stepping into the guards' arena shows the card");
  assert.equal(card.title, "STEEL GUARDS");
  assert.equal(s.mode, "interlevel");
  step(s, 0, [{ type: "resume" }]);
  assert.equal(s.mode, "playing");
});

test("entering arena 100 flips the run to UNLIMITED", () => {
  const s = advanceGame();
  jumpToArena(s, T.ROAD_END, false);
  const a = activeArena(s.world);
  a.entered = false; s.player.col = a.x0 - 1;
  step(s, 16, []);
  assert.equal(s.unlimited, false);
  s.player.col = a.x0;
  const ev = step(s, 16, []);
  assert.equal(s.unlimited, true);
  assert.equal(hudView(s).unlimited, true);
  assert.equal(ev.find((e) => e.type === "stageGate").title, "UNLIMITED");
  assert.equal(hudView(s).level, T.ROAD_END + 1);
});

test("the yellow mett hops, at a third of the green hopper's pace, and only while it holds a road", () => {
  const s = advanceGame(4);
  const mett = place(s, { col: 4, row: 0, type: "mett", persistent: true });
  const hop = place(s, { col: 5, row: 2, type: "hopper", hp: 2, persistent: true });
  const c = newGame({ seed: 4 });
  const classicMett = place(c, { col: 4, row: 0, type: "mett" });   // classic: no persistence
  c.nextSpawnAt = Infinity;
  const hops = { mett: 0, hop: 0, classic: 0 };
  const m0 = [mett.col, mett.row], h0 = [hop.col, hop.row], c0 = [classicMett.col, classicMett.row];
  for (let i = 0; i < 4000 / 16; i++) {
    for (const ev of step(s, 16, [])) if (ev.type === "hopperHop") {
      if (ev.col === mett.col && ev.row === mett.row) hops.mett++; else hops.hop++;
    }
    for (const ev of step(c, 16, [])) if (ev.type === "hopperHop") hops.classic++;
    // keep the classic mett alive for the comparison: it would sink on its own
    classicMett.t0 = c.clock;
  }
  assert.ok(hops.hop > hops.mett * 2, `green ${hops.hop} should hop far more than yellow ${hops.mett}`);
  assert.ok(hops.mett >= 2, "the yellow mett does move");
  assert.equal(hops.classic, 0, "classic metts stay put");
  assert.ok(T.MET_HOP_MS >= T.HOP_MS * 2.5);
});

test("a Sentinel is armour while closed and a health bar while open, by mark", () => {
  for (const mark of [1, 2, 3]) {
    const s = advanceGame(2);
    const cfg = T.SENTINEL[mark];
    const v = place(s, { col: 4, row: 1, type: "sentinel", tier: mark, hp: cfg.hp,
                         willAttack: true, fired: true, aimMs: cfg.openMs });
    s.player.row = 1;
    // closed: a shot plinks and does nothing
    let ev = step(s, 0, [{ type: "firePressed" }, { type: "fireReleased" }]);
    step(s, 200, []);                                          // let the tracer land
    assert.equal(v.hp, cfg.hp, `mark ${mark}: no damage while closed`);
    assert.ok(ev.some((e) => e.type === "guardBlocked"), "closed reads as armour");

    // open: each tap takes one, a charged shot takes two, and it dies at zero
    v.fired = false; v.t0 = s.clock;
    let taps = 0;
    while (s.enemies.includes(v) && v.state !== "hit" && taps < 10) {
      s.canFire = true;
      step(s, 0, [{ type: "firePressed" }, { type: "fireReleased" }]);
      step(s, 200, []);
      v.fired = false; v.t0 = s.clock;                        // hold the window open
      taps++;
    }
    assert.equal(taps, cfg.hp, `mark ${mark} takes exactly ${cfg.hp} taps while open`);
  }
});

test("a bomb arcs three columns, splashes a 3x3 at charged strength, and can hit you", () => {
  const s = advanceGame(6);
  s.player.col = 1; s.player.row = 1;
  // no bomb, no throw
  step(s, 0, [{ type: "bomb" }]);
  assert.equal(s.bombsInFlight.length, 0);

  s.bombs = 1;
  const inside = [place(s, { col: 3, row: 0 }), place(s, { col: 4, row: 1 }), place(s, { col: 5, row: 2 })];
  const guard = place(s, { col: 4, row: 2, type: "guard" });     // a charged delete kills a guard
  place(s, { col: 5, row: 0 });                                   // corner of the 3x3 around col 4
  const del0 = s.deletions;
  let ev = step(s, 0, [{ type: "bomb" }]);
  assert.equal(s.bombs, 0, "single use");
  assert.equal(s.bombsInFlight.length, 1);
  assert.equal(s.bombsInFlight[0].toCol, 4, "lands three columns ahead");
  assert.ok(ev.some((e) => e.type === "bombThrown"));

  // in the air: nothing has happened yet
  step(s, T.BOMB_ARC_MS / 2, []);
  assert.equal(s.deletions, del0);

  // it lands: everything in the nine squares around (4,1) is deleted
  ev = step(s, T.BOMB_ARC_MS, []);
  const blast = ev.find((e) => e.type === "bombBlast");
  assert.ok(blast, "the landing announces itself");
  assert.equal(blast.col, 4);
  assert.equal(blast.kills, 5, "five viruses stood in the 3x3, including the guard");
  assert.equal(s.deletions, del0 + 5);
  assert.ok(!s.enemies.some((e) => e === guard && e.state !== "hit"), "charged strength cracks a guard");

  // stand in the splash and it hurts you too
  const s2 = advanceGame(6);
  s2.bombs = 1; s2.player.col = 2; s2.player.row = 1;
  step(s2, 0, [{ type: "bomb" }]);                   // lands at col 5
  s2.player.col = 4;                                 // walk into range before it lands
  const t0 = s2.timeLeft;
  step(s2, T.BOMB_ARC_MS + 20, []);
  assert.ok(s2.timeLeft < t0 - T.HIT_TIME_PENALTY + 0.2, "your own bomb costs you the hit penalty");
});

test("a bomb is laid on the first road and picked up by walking onto it", () => {
  const s = advanceGame(8);
  const a = activeArena(s.world);
  a.dealt = a.pool;
  s.waveState = "active";
  s.wave = { index: 0, size: 1, virusCount: 1, kills: 1, startedAt: s.clock, deadline: s.clock + 1e9, queue: [] };
  const ev = step(s, 16, []);
  const laid = ev.find((e) => e.type === "pickupSpawned");
  assert.ok(laid, "the first road always carries a bomb");
  const pk = s.pickups[0];
  const road = s.world.segs[1];
  assert.ok(pk.col >= road.x0 && pk.col < road.x0 + road.cols, "on the road");
  assert.equal(s.bombs, 0);
  // walk onto it
  s.player.col = pk.col - 1; s.player.row = pk.row;
  s.lastMoveAt = -1e9;
  const got = step(s, 0, [{ type: "move", dc: 1, dr: 0 }]);
  assert.equal(s.bombs, 1);
  assert.equal(s.pickups.length, 0);
  assert.ok(got.some((e) => e.type === "pickup"));
});

test("classic is untouched: no sentinels, no pickups, no bombs, kill-based level", () => {
  const s = newGame({ seed: 9, spawn: true });
  for (let i = 0; i < 600; i++) step(s, 16, []);
  assert.ok(s.enemies.every((e) => e.type !== "sentinel"));
  assert.equal(s.pickups.length, 0);
  assert.equal(s.bombs, 0);
  assert.equal(s.unlimited, false);
});

test("the spawner actually deals Sentinels at their arena, with fields from the table", () => {
  const s = advanceGame(12);
  jumpToArena(s, T.ADV_UNLOCK.sentinel2 + 2);
  const a = activeArena(s.world);
  const tiers = {}; let sentinels = 0, hoppers = 0, waves = 0;
  for (let k = 0; k < 80; k++) {
    // re-roll a fresh wave each time
    s.wave = null; s.waveState = "lull"; s.enemies.length = 0; a.dealt = 0;
    s.nextSpawnAt = s.clock;
    step(s, 16, []);
    waves++;
    for (const slot of s.wave.queue) {
      if (slot.type === "sentinel") { sentinels++; tiers[slot.tier] = (tiers[slot.tier] || 0) + 1; }
      if (slot.type === "hopper") hoppers++;
    }
  }
  assert.ok(sentinels >= 15, `expected sentinels in a good share of ${waves} waves, got ${sentinels}`);
  assert.ok(tiers[2] > 0, "the arena's own mark appears");
  assert.ok(!tiers[3], "a mark not yet unlocked never appears");
  assert.ok(hoppers >= 8, `hoppers must roll off the road's own scale, got ${hoppers} in ${waves} waves`);

  // and a dealt sentinel carries the table's numbers
  s.wave = null; s.waveState = "lull"; s.enemies.length = 0; a.dealt = 0; s.nextSpawnAt = s.clock;
  let e = null;
  for (let k = 0; k < 40 && !e; k++) {
    step(s, 16, []);
    for (const slot of s.wave.queue) slot.at = s.clock;
    step(s, 16, []);
    e = s.enemies.find((x) => x.type === "sentinel");
    if (!e) { s.wave = null; s.waveState = "lull"; s.enemies.length = 0; a.dealt = 0; s.nextSpawnAt = s.clock; }
  }
  assert.ok(e, "a sentinel should have been dealt");
  const cfg = T.SENTINEL[e.tier];
  assert.equal(e.hp, cfg.hp);
  assert.equal(e.aimMs, cfg.openMs, "its open window is its telegraph");
  assert.ok(e.willAttack, "retaliation is long unlocked by then");
});
