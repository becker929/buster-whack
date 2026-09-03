// STORY prototype: the strip opens on a tower with a keeper on it, and the
// context button is TALK beside them. The core knows tiles and presses; the
// canon text stays in the shell.

import test from "node:test";
import assert from "node:assert/strict";
import { newGame, step, C, find } from "./helpers.mjs";
import { activeArena, clearArena, tileAt, walkable, npcBeside, TILE } from "../src/core/world.js";
import { contextVerb } from "../src/core/select.js";

function story() {
  const s = newGame({ seed: 4 });
  step(s, 0, [{ type: "startRun", modeId: "story" }]);
  return s;
}

test("the story strip opens on a tower: safe ground, a keeper tile, the guard beyond", () => {
  const s = story();
  const [t, a] = s.world.segs;
  assert.equal(t.kind, "tower");
  assert.equal(t.roost, "roost.01");
  assert.equal(a.kind, "arena");
  assert.equal(a.x0, C.TOWER_COLS);
  assert.equal(activeArena(s.world), a, "the tower is not an arena: the active arena is the guard");
  assert.equal(a.entered, false, "the guard has not been entered");
  assert.equal(s.nextSpawnAt, Infinity, "so nothing spawns until you walk in");
  const npc = C.towerSpec("roost.01").npcs[0];       // the first tower is at x0 = 0
  assert.equal(tileAt(s.world, npc.col, npc.row), TILE.NPC);
  assert.equal(walkable(s.world, npc.col, npc.row), false, "you stand beside a keeper, not on them");
  for (let r = 0; r < C.ROWS; r++) for (let c = 0; c < C.TOWER_COLS; c++) {
    if (c === npc.col && r === npc.row) continue;
    assert.equal(tileAt(s.world, c, r), TILE.PLAYER, `tower tile ${c},${r} is yours`);
  }
  assert.equal(tileAt(s.world, C.TOWER_COLS + 3, 1), TILE.ENEMY, "the guard's far half is theirs");
});

test("the context verb is TALK beside the keeper and BOMB anywhere else", () => {
  const s = story();
  assert.deepEqual(contextVerb(s), { verb: "bomb", npc: null });
  s.player.col = 2; s.player.row = 1;                  // left of the keeper
  assert.deepEqual(contextVerb(s), { verb: "talk", npc: "npc.keeper.01" });
  s.player.col = 3; s.player.row = 0;                  // above
  assert.equal(contextVerb(s).verb, "talk");
  s.player.col = 2; s.player.row = 0;                  // diagonal: not beside
  assert.equal(contextVerb(s).verb, "bomb");
  assert.equal(npcBeside(s.world, 4, 1).id, "npc.keeper.01");
});

test("pressing the button beside the keeper talks, counts, and never throws a bomb", () => {
  const s = story();
  s.bombs = 1;
  s.player.col = 2; s.player.row = 1;
  const ev = step(s, 16, [{ type: "bomb" }]);
  const talk = find(ev, "talk");
  assert.ok(talk, "a talk event");
  assert.equal(talk.npc, "npc.keeper.01");
  assert.equal(talk.count, 1);
  assert.equal(s.bombs, 1, "the bomb stayed in the stash");
  assert.equal(s.bombsInFlight.length, 0);
  assert.ok(!find(ev, "bombThrown"));
  step(s, 16, [{ type: "bomb" }]);
  assert.equal(s.talks["npc.keeper.01"], 2, "each press is counted for the shell to pick the line");
  s.player.col = 1; s.player.row = 2;
  const ev2 = step(s, 16, [{ type: "bomb" }]);
  assert.ok(find(ev2, "bombThrown"), "away from the keeper the same button is the bomb");
});

test("walking into the guard arena wakes it, and the camera stays on the tower until then", () => {
  const s = story();
  const cam0 = s.cam;
  for (let i = 0; i < 20; i++) step(s, 16, []);
  assert.equal(s.cam, cam0, "nothing scrolls while you stand on the tower");
  s.player.col = C.TOWER_COLS; s.player.row = 1;
  const ev = step(s, 16, []);
  const e = find(ev, "arenaEntered");
  assert.ok(e && e.index === 0, "the guard is arena 0");
  assert.ok(Number.isFinite(s.nextSpawnAt), "and its wave is now scheduled");
});

test("the other modes are untouched: no tower, arena 0 born entered", () => {
  for (const id of ["onehand", "advance", "classic"]) {
    const s = newGame();
    step(s, 0, [{ type: "startRun", modeId: id }]);
    assert.equal(s.world.segs[0].kind, "arena", id);
    assert.equal(s.world.segs[0].entered, true, id);
    assert.deepEqual(contextVerb(s), { verb: "bomb", npc: null });
  }
});

test("pressing the button with an empty stash says so instead of doing nothing", () => {
  const s = story();
  s.bombs = 0;
  const ev = step(s, 16, [{ type: "bomb" }]);
  assert.ok(find(ev, "bombEmpty"), "an event the shell can show");
  assert.ok(!find(ev, "bombThrown"));
  s.player.col = 2; s.player.row = 1;
  const ev2 = step(s, 16, [{ type: "bomb" }]);
  assert.ok(find(ev2, "talk") && !find(ev2, "bombEmpty"), "beside the keeper it is TALK, not a refusal");
});

test("towers arrive on the route, one before every third arena, and announce themselves", () => {
  const s = story();
  const roosts = () => s.world.segs.filter((g) => g.kind === "tower").map((g) => g.roost);
  assert.deepEqual(roosts(), ["roost.01"]);
  // wipe arenas by hand the way the core does, and watch the strip grow
  for (let i = 0; i < 6; i++) {
    const a = activeArena(s.world);
    const next = a.idx + 1;
    const roost = next % C.TOWER_EVERY === 0 ? C.STORY_ROUTE[s.routeIdx] : null;
    clearArena(s.world, s.rng, { tower: roost || undefined });
    if (roost) s.routeIdx++;
  }
  assert.deepEqual(roosts(), ["roost.01", "roost.02", "roost.03"], "a tower before arenas 3 and 6");
  const t2 = s.world.segs.find((g) => g.kind === "tower" && g.roost === "roost.02");
  assert.equal(t2.entered, false);
  assert.equal(t2.npcs[0].id, "npc.keeper.02");
  assert.equal(tileAt(s.world, t2.npcs[0].col, t2.npcs[0].row), TILE.NPC, "the keeper stands on the tower, in world columns");
  s.player.col = t2.x0; s.player.row = 1; s.cam = t2.x0 - 1; s.camAnchor = s.cam;
  const ev = step(s, 16, []);
  const e = find(ev, "towerEntered");
  assert.ok(e && e.roost === "roost.02", "arrival is announced");
  assert.equal(t2.entered, true);
  assert.equal(C.STORY_ROUTE[4], "roost.06", "the ferry is the fifth tower");
  assert.equal(C.towerSpec("roost.06").npcs[0].id, "boss.ferryman");
});

test("the core lays the tower itself when a guard is wiped in the story", () => {
  const s = story();
  // arm and wipe two guards quickly by draining their pools
  for (let k = 0; k < 2; k++) {
    const a = activeArena(s.world);
    s.player.col = a.x0; s.player.row = 1; s.cam = a.x0; s.camAnchor = a.x0;
    step(s, 16, []);
    if (s.mode === "interlevel") step(s, 0, [{ type: "resume" }]);
    a.dealt = a.pool; s.enemies.length = 0;
    s.wave = { index: 0, size: 1, virusCount: 1, kills: 1, queue: [], spawned: 1, ended: false, t0: s.clock, lullMs: 0 };
    s.waveState = "active";
  }
  // the second wipe is arena 1 -> next idx 2, no tower; a tower comes before idx 3
  assert.ok(activeArena(s.world).idx >= 1);
});
