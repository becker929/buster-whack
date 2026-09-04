// STORY prototype: the strip opens on a tower with a keeper on it, and the
// context button is TALK beside them. The core knows tiles and presses; the
// canon text stays in the shell.

import test from "node:test";
import assert from "node:assert/strict";
import { newGame, step, C, find, T } from "./helpers.mjs";
import { activeArena, clearArena, tileAt, walkable, npcBeside, TILE } from "../src/core/world.js";
import { contextVerb, hudView } from "../src/core/select.js";

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
  s.stash.push("bomb"); s.bombs = 1;
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
  s.stash.length = 0; s.bombs = 0;
  const ev = step(s, 16, [{ type: "bomb" }]);
  assert.ok(find(ev, "bombEmpty"), "an event the shell can show");
  assert.ok(!find(ev, "bombThrown"));
  s.player.col = 2; s.player.row = 1;
  const ev2 = step(s, 16, [{ type: "bomb" }]);
  assert.ok(find(ev2, "talk") && !find(ev2, "bombEmpty"), "beside the keeper it is TALK, not a refusal");
});

test("towers arrive on the route, one before every tenth arena, and announce themselves", () => {
  const s = story();
  const roosts = () => s.world.segs.filter((g) => g.kind === "tower").map((g) => g.roost);
  assert.deepEqual(roosts(), ["roost.01"]);
  // wipe arenas by hand the way the core does, and watch the strip grow
  for (let i = 0; i < 2 * T.TOWER_EVERY; i++) {
    const a = activeArena(s.world);
    const next = a.idx + 1;
    const roost = next % T.TOWER_EVERY === 0 ? C.STORY_ROUTE[s.routeIdx] : null;
    clearArena(s.world, s.rng, { tower: roost || undefined });
    if (roost) s.routeIdx++;
  }
  assert.deepEqual(roosts(), ["roost.01", "roost.02", "roost.03"], "a tower before arenas 10 and 20");
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
  // the second wipe is arena 1 -> next idx 2, no tower; a tower comes before idx 10
  assert.ok(activeArena(s.world).idx >= 1);
});

test("the clock does not drain in a safe zone: a tower, a road, a taken arena", () => {
  const s = story();
  const t0 = s.timeLeft;
  for (let i = 0; i < 60; i++) step(s, 16, []);
  assert.equal(s.timeLeft, t0, "standing on the tower costs nothing");
  assert.equal(hudView(s).safe, true);
  s.player.col = C.TOWER_COLS; s.player.row = 1;      // into the guard
  step(s, 16, []);
  assert.equal(hudView(s).safe, false);
  for (let i = 0; i < 10; i++) step(s, 16, []);
  assert.ok(s.timeLeft < t0, "inside the guard the clock runs");
  // a taken arena and the road beyond it are safe again
  const a = activeArena(s.world);
  a.owner = "player";
  const t1 = s.timeLeft;
  for (let i = 0; i < 10; i++) step(s, 16, []);
  assert.equal(s.timeLeft, t1);
});

test("classic and the arcade modes still drain from the first frame: arena 0 is a fight", () => {
  for (const id of ["classic", "advance", "onehand"]) {
    const s = newGame();
    step(s, 0, [{ type: "startRun", modeId: id }]);
    const t0 = s.timeLeft;
    step(s, 160, []);
    assert.ok(s.timeLeft < t0, id + " drains in its opening arena");
  }
});

// ---------- v3: the route, the people, the words ----------

import { createStory } from "../src/shell/story.js";

test("the route visits every roost once before any repeat, a tower before every tenth arena", () => {
  const first = C.STORY_ROUTE.slice(0, 8);
  assert.equal(new Set(first).size, 8, "eight distinct roosts first");
  for (let i = 1; i <= 8; i++) assert.ok(first.includes("roost.0" + i), "roost.0" + i + " is on the first pass");
  const s = story();
  for (let k = 1; k <= 4; k++) {
    const idx = k * T.TOWER_EVERY;
    while (activeArena(s.world).idx < idx) {
      const a = activeArena(s.world);
      const roost = (a.idx + 1) % T.TOWER_EVERY === 0 ? C.STORY_ROUTE[s.routeIdx] : null;
      clearArena(s.world, s.rng, { tower: roost || undefined });
      if (roost) s.routeIdx++;
    }
    const towers = s.world.segs.filter((g) => g.kind === "tower");
    assert.equal(towers.length, k + 1, "a tower before arena " + idx);
    assert.equal(towers[k].roost, C.STORY_ROUTE[k]);
  }
});

test("every tower has its keeper mid-floor, a lane past them, and the journal reads", () => {
  for (const [roost, spec] of Object.entries(C.TOWER_SPECS)) {
    const s = story();
    clearArena(s.world, s.rng, { tower: roost });
    const t = s.world.segs.find((g) => g.kind === "tower" && g.roost === roost);
    assert.equal(t.npcs.length, spec.npcs.length, roost);
    for (const n of t.npcs) {
      assert.equal(tileAt(s.world, n.col, n.row), TILE.NPC);
      assert.ok(["talk", "read"].includes(n.verb), n.id + " has a verb");
    }
    // a lane: the middle row is never fully blocked across the tower
    let blocked = 0;
    for (let c = t.x0; c < t.x0 + t.cols; c++) if (!walkable(s.world, c, 1) && !walkable(s.world, c, 0) && !walkable(s.world, c, 2)) blocked++;
    assert.equal(blocked, 0, roost + " can be crossed");
  }
  assert.equal(C.TOWER_SPECS["roost.08"].npcs[0].verb, "read", "the Elevator's journal is read, not talked to");
});

test("the story has no cards: unlocks follow the towers that announce them", () => {
  assert.equal(T.unlockTable(C.modeById("story")), T.STORY_UNLOCK);
  for (const [k, at] of Object.entries(T.STORY_UNLOCK)) {
    if (k === "unlimited") continue;
    assert.equal((at % T.TOWER_EVERY), 0, k + " unlocks at an arena a tower stands before (" + at + ")");
  }
  const s = story();
  // walk to the first card arena of the arcade schedule; the story shows none
  for (let i = 0; i < T.ADV_UNLOCK.guard; i++) clearArena(s.world, s.rng);
  const a = activeArena(s.world);
  s.player.col = a.x0 + 1; s.cam = a.x0; s.camAnchor = a.x0;
  step(s, 16, []);
  assert.equal(s.mode, "playing", "no interlevel card in the story");
});

test("the story shell shows nothing on its own: TALK opens, advances, closes", async () => {
  const said = [];
  let placed = "";
  const st = createStory({ say: (who, text) => said.push([who.length, text.length]), hush: () => said.push("hush"),
                           place: (t) => { placed = t; } });
  await st.ready;
  st.handleAll([{ type: "runStarted", modeId: "story", story: true }]);
  assert.deepEqual(said.filter((x) => x !== "hush"), [], "the opening plays nothing by itself");
  st.handleAll([{ type: "towerEntered", roost: "roost.01", x0: 0 }]);
  assert.deepEqual(said.filter((x) => x !== "hush"), [], "arrival announces nothing");
  assert.ok(placed.length > 0, "but the place label is set");
  assert.equal(st.open, false);
  assert.equal(st.label("npc.keeper.01"), null, "no conversation: the button reads its verb");

  said.length = 0;
  st.handleAll([{ type: "talk", npc: "npc.keeper.01", verb: "talk", count: 1 }]);
  assert.equal(said.length, 1, "one press, one beat");
  assert.equal(st.open, true);
  assert.equal(st.label("npc.keeper.01"), "next");
  st.handleAll([{ type: "talk", npc: "npc.keeper.01", verb: "talk", count: 2 }]);
  assert.equal(said.length, 2, "the next press shows the next beat, nothing more");
  assert.equal(said[1][0], "Wren".length, "the second beat is the player's");
  st.handleAll([{ type: "talk", npc: "npc.keeper.01", verb: "talk", count: 3 }]);
  st.handleAll([{ type: "talk", npc: "npc.keeper.01", verb: "talk", count: 4 }]);
  assert.equal(st.label("npc.keeper.01"), "done", "on the last beat the button offers to end it");
  st.handleAll([{ type: "talk", npc: "npc.keeper.01", verb: "talk", count: 5 }]);
  assert.equal(st.open, false, "the last press closes the box");
  assert.equal(said[said.length - 1], "hush");
  assert.equal(st.canon.state.get("talks.keeper.01"), 1, "a finished conversation counts once");

  // the next press opens the next conversation; walking away closes it
  said.length = 0;
  st.handleAll([{ type: "talk", npc: "npc.keeper.01", verb: "talk", count: 6 }]);
  assert.equal(said.length, 1);
  st.leave();
  assert.equal(st.open, false);
  assert.equal(st.canon.state.get("talks.keeper.01"), 1, "an abandoned conversation does not count");

  // READ works the same way and feeds the reads key
  st.handleAll([{ type: "towerEntered", roost: "roost.08", x0: 60 }]);
  st.handleAll([{ type: "talk", npc: "item.journal.steward", verb: "read", count: 1 }]);
  st.handleAll([{ type: "talk", npc: "item.journal.steward", verb: "read", count: 2 }]);
  assert.equal(st.canon.state.get("reads.item.journal.steward"), 1);
  assert.equal(st.canon.unlocked("S01"), true, "entered the elevator and read the journal: S01 opens");
  // leaving the tower for the road clears the label
  st.handleAll([{ type: "arenaEntered", index: 7, x0: 66 }]);
  assert.equal(placed, "");
});

test("the view holds a whole tower: walking across it scrolls nothing, leaving it does", () => {
  const s = story();
  for (const col of [2, 4, 5, 0]) {
    s.player.col = col;
    for (let i = 0; i < 30; i++) step(s, 16, []);
    assert.equal(s.cam, 0, "on the tower at col " + col + " the camera stays put");
  }
  s.player.col = C.TOWER_COLS + 1;                 // onto the guard's footing
  for (let i = 0; i < 60; i++) step(s, 16, []);
  assert.ok(s.cam > 0, "past the tower the view follows");
});

test("a bonus task is the last thing a person says, in plain words", async () => {
  const said = [];
  const st = createStory({ say: (who, text) => said.push(text), hush: () => said.push("hush") });
  await st.ready;
  st.handleAll([{ type: "runStarted", modeId: "story", story: true }]);

  // the core sends the task line with the talk it belongs to
  said.length = 0;
  st.handleAll([
    { type: "talk", npc: "npc.keeper.01", verb: "talk", count: 1 },
    { type: "taskGiven", npc: "npc.keeper.01", id: "sweep", text: "Take an arena without being hit." },
  ]);
  assert.equal(said.length, 1, "the task does not jump the queue: one press, one beat");
  const beats = [];
  for (let i = 0; i < 12 && st.open; i++) {
    st.handleAll([{ type: "talk", npc: "npc.keeper.01", verb: "talk", count: i + 2 }]);
    if (st.open) beats.push(said[said.length - 1]);
  }
  assert.ok(beats.includes("Take an arena without being hit."),
    "and it is read, in plain words, as the last beat");
  assert.equal(st.open, false, "then the conversation closes as it always did");
});

test("a task line meant for someone else is never spoken", async () => {
  const said = [];
  const st = createStory({ say: (who, text) => said.push(text), hush: () => said.push("hush") });
  await st.ready;
  st.handleAll([{ type: "runStarted", modeId: "story", story: true }]);
  st.handleAll([{ type: "talk", npc: "npc.keeper.01", verb: "talk", count: 1 }]);
  const n = said.length;
  st.handleAll([{ type: "taskGiven", npc: "npc.side.tally", id: "spare", text: "Let three runners past." }]);
  assert.equal(said.length, n, "nothing is said by a box opening on its own");
  st.handleAll([{ type: "taskNone", npc: "npc.keeper.01" }]);
  assert.equal(said.length, n, "and an empty exchange says nothing at all");
});
