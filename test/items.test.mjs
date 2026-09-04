// The stash and the five shards: what you can carry, and what spending it does.

import test from "node:test";
import assert from "node:assert/strict";
import { newGame, addEnemy, step, fire, T, C } from "./helpers.mjs";
import { ITEMS, SHARDS, itemDef, slotsUsed, fits, stow, topOf, takeTop, stashView } from "../src/core/items.js";

const use = (s) => step(s, 0, [{ type: "bomb" }]);

test("every item is complete, and the bomb is the first of them", () => {
  assert.equal(Object.keys(ITEMS)[0], "bomb");
  for (const [id, def] of Object.entries(ITEMS)) {
    assert.equal(def.id, id);
    assert.ok(def.name === def.name.toUpperCase(), id + " has a HUD name");
    assert.ok(def.slots >= 1 && def.slots <= 3, id + " costs a sane number of slots");
    assert.ok(def.effect, id + " does something");
    assert.ok(def.canon.startsWith("shard.") || def.canon.startsWith("item."), id + " is in the fiction");
  }
  for (const id of SHARDS) assert.ok(ITEMS[id], id + " is a real item");
  assert.equal(itemDef("nothing"), null);
});

test("the stash holds what fits and no more", () => {
  const st = [];
  assert.equal(slotsUsed(st), 0);
  assert.equal(stow(st, "bomb", 4), true);
  assert.equal(stow(st, "bell", 4), true);     // 1 + 3 = 4
  assert.equal(slotsUsed(st), 4);
  assert.equal(fits(st, "spell", 4), false);
  assert.equal(stow(st, "spell", 4), false, "a full stash takes nothing");
  assert.equal(topOf(st), "bell", "the top is the last thing in");
  assert.equal(takeTop(st), "bell");
  assert.equal(topOf(st), "bomb");
  assert.deepEqual(stashView(st), [{ id: "bomb", name: "BOMB", slots: 1 }]);
});

test("a pickup only leaves the road when there is room for it", () => {
  const s = newGame();
  s.stash.push("bell", "bomb");                 // 3 + 1 = full at four slots
  s.pickups.push({ col: s.player.col + 1, row: s.player.row, kind: "spell" });
  const ev = step(s, 0, [{ type: "move", dc: 1, dr: 0 }]);
  step(s, 400, []);
  assert.equal(s.pickups.length, 1, "it stays where it is");
  assert.ok(ev.some((e) => e.type === "stashFull") || s.pickups.length === 1);
});

test("the context button spends the top of the stash", () => {
  const s = newGame();
  s.stash.push("bomb", "spell");
  use(s);
  assert.equal(s.parry, true, "the spell went, not the bomb");
  assert.deepEqual(s.stash, ["bomb"]);
  use(s);
  assert.equal(s.bombsInFlight.length, 1, "and then the bomb");
  assert.deepEqual(s.stash, []);
  const ev = use(s);
  assert.ok(ev.some((e) => e.type === "bombEmpty"), "an empty stash says so");
});

test("a parry eats exactly one bolt", () => {
  const s = newGame();
  s.stash.push("spell");
  use(s);
  const put = () => s.bolts.push({ row: s.player.row, x: C.panelRect(s.G, s.player.col, s.player.row).x + s.G.pw / 2, speed: 0, kind: "slow", radius: 4 });
  put();
  let ev = step(s, 16, []);
  assert.ok(ev.some((e) => e.type === "parried"), "the first is parried");
  assert.equal(s.parry, false);
  const t = s.timeLeft;
  put();
  step(s, 16, []);
  assert.ok(s.timeLeft < t, "the next one lands");
});

test("a cloak lets fire pass through, and nothing draws a bead while it holds", () => {
  const s = newGame();
  s.stash.push("sock");
  use(s);
  assert.ok(s.cloakUntil > s.clock);
  const t = s.timeLeft;
  s.bolts.push({ row: s.player.row, x: C.panelRect(s.G, s.player.col, s.player.row).x + s.G.pw / 2, speed: 0, kind: "slow", radius: 4 });
  step(s, 16, []);
  assert.equal(s.timeLeft.toFixed(3), (t - 0.016).toFixed(3), "no hit: only the clock ran");
  assert.equal(s.bolts.length, 1, "and the bolt is still travelling");
});

test("the bell makes everything armed fire at once", () => {
  const s = newGame();
  const a = addEnemy(s, { col: 4, row: 0, willAttack: true });
  const b = addEnemy(s, { col: 5, row: 2, willAttack: true });
  addEnemy(s, { col: 4, row: 1 });                    // unarmed: it does nothing
  s.stash.push("bell");
  use(s);
  assert.equal(s.bolts.length, 2);
  assert.equal(a.fired, true);
  assert.equal(b.fired, true);
  assert.ok(a.refireAt > s.clock, "and they have to reload");
});

test("the weather shard puts one more thing in your row", () => {
  const s = newGame();
  const before = s.enemies.length;
  s.stash.push("weather");
  use(s);
  assert.equal(s.enemies.length, before + 1);
  const e = s.enemies[s.enemies.length - 1];
  assert.equal(e.row, s.player.row);
  assert.equal(e.type, "darter");
  assert.ok(e.col > s.player.col, "ahead of you, not on you");
});

test("the footnote takes your last shot again, for half of what it paid", () => {
  const s = newGame();
  addEnemy(s, { col: 3, row: 1 });
  const ev = fire(s);
  const first = ev.find((e) => e.type === "hit");
  assert.ok(first);
  addEnemy(s, { col: 4, row: 1 });
  s.stash.push("footnote");
  const ev2 = use(s);
  const echo = ev2.find((e) => e.type === "hit");
  assert.ok(echo, "the echo shoots");
  assert.equal(echo.points, Math.round(first.points * 0.5 * (echo.mult / first.mult)), "for half the points");
  assert.deepEqual(s.stash, []);
});

test("an echo with nothing to repeat spends the shard and says so", () => {
  const s = newGame();
  s.stash.push("footnote");
  const ev = use(s);
  assert.deepEqual(s.stash, [], "it is still spent");
  assert.ok(ev.some((e) => e.type === "itemUsed" && e.item === "footnote"));
  assert.equal(s.shots, 0, "but nothing was fired");
});

test("a run starts with an empty stash, and starting again clears it", () => {
  const s = newGame();
  assert.deepEqual(s.stash, []);
  s.stash.push("bell");
  step(s, 0, [{ type: "startRun", modeId: "classic" }]);
  assert.deepEqual(s.stash, []);
  assert.equal(s.bombs, 0);
  assert.equal(s.parry, false);
});

test("the bomb count stays equal to the bombs in the stash", () => {
  const s = newGame();
  s.pickups.push({ col: s.player.col + 1, row: s.player.row, kind: "bomb" });
  step(s, 0, [{ type: "move", dc: 1, dr: 0 }]);
  step(s, 400, []);
  assert.equal(s.bombs, 1);
  assert.deepEqual(s.stash, ["bomb"]);
  use(s);
  assert.equal(s.bombs, 0);
  assert.deepEqual(s.stash, []);
});
