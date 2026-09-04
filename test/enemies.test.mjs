// The enemy table and the attack vocabulary: every type is a row, every shot
// pattern is data, and the three later viruses fire what their row says.

import test from "node:test";
import assert from "node:assert/strict";
import { newGame, addEnemy, step, fire, T } from "./helpers.mjs";
import { ENEMIES, ATTACKS, enemyDef, hpOf, riseMsOf, shotsOf, boltKindFor, canRetaliate } from "../src/core/enemies.js";
import { fireBolt } from "../src/core/waves.js";

test("every row of the table is complete and points at real tuning", () => {
  for (const [type, def] of Object.entries(ENEMIES)) {
    assert.ok(def.canon && def.family, type + " names its canon and family");
    for (const key of [def.hpKey, def.riseKey, def.lifeKey, def.hopKey]) {
      if (key) assert.equal(typeof T[key], "number", type + " reads " + key);
    }
    if (def.attack) assert.ok(ATTACKS[def.attack], type + " fires a real attack");
    assert.ok(def.bolt === "slow" || def.bolt === "fast", type + " throws a real bolt kind");
    if (def.scoreKey) {
      assert.equal(typeof T.PTS[def.scoreKey], "number", type + " is worth points");
      assert.equal(typeof T.BONUS[def.scoreKey], "number", type + " is worth pulse");
    }
    assert.ok(def.attack || !def.retaliate, type + " that retaliates has an attack");
  }
});

test("the table answers what the branches used to", () => {
  assert.equal(hpOf(T, "mett"), 1);
  assert.equal(hpOf(T, "hopper"), 2);
  assert.equal(riseMsOf(T, "ally"), T.ALLY_RISE_MS);
  assert.equal(riseMsOf(T, "mett"), T.RISE_MS);
  assert.equal(boltKindFor("hopper"), "fast");
  assert.equal(boltKindFor("mett"), "slow");
  assert.equal(canRetaliate("guard"), false);
  assert.equal(canRetaliate("ally"), false);
  assert.equal(canRetaliate("mett"), true);
  assert.equal(enemyDef("dragon"), ENEMIES.mett, "an unknown type reads as a plain mett");
});

test("a plain virus throws one bolt down its own lane", () => {
  const s = newGame();
  const e = addEnemy(s, { col: 4, row: 1, type: "mett", willAttack: true });
  fireBolt(s, e, []);
  assert.equal(s.bolts.length, 1);
  assert.equal(s.bolts[0].row, 1);
  assert.equal(s.bolts[0].kind, "slow");
});

test("a spreader fires into three lanes at once, and only the lanes that exist", () => {
  const s = newGame();
  const mid = addEnemy(s, { col: 4, row: 1, type: "spreader", willAttack: true });
  fireBolt(s, mid, []);
  assert.deepEqual(s.bolts.map((b) => b.row).sort(), [0, 1, 2]);
  s.bolts.length = 0;
  const top = addEnemy(s, { col: 5, row: 0, type: "spreader", willAttack: true });
  fireBolt(s, top, []);
  assert.deepEqual(s.bolts.map((b) => b.row).sort(), [0, 1], "nothing is fired off the board");
});

test("a darter's volley is two down one lane, the second a beat later", () => {
  const s = newGame();
  const e = addEnemy(s, { col: 4, row: 2, type: "darter", willAttack: true });
  fireBolt(s, e, []);
  assert.equal(s.bolts.length, 1, "the first shot leaves at once");
  assert.equal(e.pending.length, 1, "the second is held on the firer");
  step(s, T.VOLLEY_GAP_MS - 20, []);
  assert.equal(s.bolts.length, 1, "and is still held a frame before its beat");
  step(s, 40, []);
  assert.equal(s.bolts.filter((b) => b.row === 2).length, 2, "then it goes");
  assert.equal(e.pending.length, 0);
});

test("a warden's wall is slower and wider than a plain bolt", () => {
  const s = newGame();
  const plain = addEnemy(s, { col: 4, row: 1, type: "mett", willAttack: true });
  fireBolt(s, plain, []);
  const ref = { speed: s.bolts[0].speed, radius: s.bolts[0].radius };
  s.bolts.length = 0;
  const w = addEnemy(s, { col: 5, row: 1, type: "warden", willAttack: true });
  fireBolt(s, w, []);
  assert.equal(s.bolts.length, 1);
  assert.ok(s.bolts[0].speed < ref.speed, "it crosses the board more slowly");
  assert.ok(s.bolts[0].radius > ref.radius, "and it is fatter");
  assert.equal(s.bolts[0].speed / ref.speed, T.WALL_SPEED_FACTOR);
  assert.equal(s.bolts[0].radius / ref.radius, T.WALL_RADIUS_FACTOR);
});

test("a held shot dies with the thing that held it", () => {
  const s = newGame();
  const e = addEnemy(s, { col: 4, row: 1, type: "darter", willAttack: true });
  fireBolt(s, e, []);
  s.enemies.length = 0;
  s.bolts.length = 0;
  step(s, T.VOLLEY_GAP_MS + 40, []);
  assert.equal(s.bolts.length, 0, "the second shot of a dead darter never lands");
});

test("stamina and armour follow the table: a spreader takes two taps, a warden two", () => {
  for (const type of ["spreader", "warden", "darter"]) {
    const s = newGame();
    const e = addEnemy(s, { col: 3, row: 1, type });
    fire(s);
    assert.equal(e.hp, 1, type + " survives one tap");
    assert.equal(s.deletions, 0);
    e.col = 3; e.row = 1;                 // a darter hops away; chase it down
    s.player.row = 1;
    fire(s);
    assert.equal(s.deletions, 1, type + " goes on the second");
  }
});

test("the later viruses are held back until the road teaches them", () => {
  for (const key of ["spreader", "darter", "warden"]) {
    const at = T.STORY_UNLOCK[key];
    assert.equal(typeof at, "number", key + " has a story unlock");
    assert.equal(at % T.TOWER_EVERY, 0, key + " unlocks at a tower arena");
    assert.equal(typeof T.ADV_UNLOCK[key], "number", key + " has an arcade unlock");
  }
  assert.ok(T.STORY_UNLOCK.spreader < T.STORY_UNLOCK.darter, "the fan comes before the volley");
  assert.ok(T.STORY_UNLOCK.darter < T.STORY_UNLOCK.warden, "and the volley before the wall");
});

test("the shots a type throws are the shots its attack names", () => {
  assert.equal(shotsOf(T, "mett").length, 1);
  assert.equal(shotsOf(T, "spreader").length, 3);
  assert.equal(shotsOf(T, "darter").length, 2);
  assert.equal(shotsOf(T, "guard").length, 0, "a guard has no attack at all");
  assert.equal(shotsOf(T, "ally").length, 0);
  assert.equal(shotsOf(T, "darter")[1].delay, T.VOLLEY_GAP_MS);
  assert.equal(shotsOf(T, "warden")[0].radiusFactor, T.WALL_RADIUS_FACTOR);
});

test("a wave built before the new types are unlocked draws exactly the numbers it always did", () => {
  const runs = [];
  for (let k = 0; k < 2; k++) {
    const s = newGame({ seed: 7, spawn: true });
    for (let i = 0; i < 400; i++) step(s, 16, []);
    runs.push(s.enemies.map((e) => e.type + ":" + e.col + "," + e.row).join("|") + "#" + s.score);
  }
  assert.equal(runs[0], runs[1], "the same seed still walks the same run");
  assert.ok(!/spreader|warden|darter/.test(runs[0]), "and nothing new turns up early");
});
