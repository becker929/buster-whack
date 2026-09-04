import test from "node:test";
import assert from "node:assert/strict";
import { newGame, addEnemy, fire, fireCharged, step, find, count, C, T } from "./helpers.mjs";

test("a normal shot deletes a mett for 100 points and 1.2s", () => {
  const s = newGame();
  s.timeLeft = 20;
  addEnemy(s, { type: "mett", col: 3, row: 1 });
  const ev = fire(s);

  assert.equal(s.score, 100);
  assert.equal(s.deletions, 1);
  assert.equal(s.chain, 1);
  assert.equal(s.bestChain, 1);
  assert.equal(s.shots, 1);
  assert.equal(s.whiffs, 0);
  assert.equal(Number(s.timeLeft.toFixed(4)), 21.2);

  const hit = find(ev, "hit");
  assert.equal(hit.enemyType, "mett");
  assert.equal(hit.points, 100);
  assert.equal(hit.mult, 1);
  assert.equal(hit.tier, "normal");
  assert.equal(s.enemies[0].state, "hit");
});

test("a charged shot scores the charged tier", () => {
  const s = newGame();
  addEnemy(s, { type: "mett" });
  fireCharged(s);
  assert.equal(s.score, T.PTS.charged);
});

test("chain multipliers step at 5, 10 and 20 and are announced once", () => {
  const s = newGame();
  const seen = [];
  let ups = 0;
  for (let i = 0; i < 21; i++) {
    addEnemy(s, { type: "mett", col: 3, row: 1 });
    const ev = fire(s);
    seen.push(find(ev, "hit").mult);
    ups += count(ev, "multiplierUp");
    s.enemies.length = 0;
    if (s.mode === "interlevel") step(s, 0, [{ type: "resume" }]);   // clear stage gates
  }
  assert.deepEqual(seen.slice(0, 4), [1, 1, 1, 1]);
  assert.equal(seen[4], 2);    // 5th hit
  assert.equal(seen[9], 3);    // 10th
  assert.equal(seen[19], 4);   // 20th
  assert.equal(ups, 3);
  assert.equal(C.multOf(0), 1);
  assert.equal(C.multOf(19), 3);
});

test("points are the base value times the live multiplier", () => {
  const s = newGame();
  s.chain = 9;                       // the next hit lands the x3 tier
  addEnemy(s, { type: "guard" });
  const ev = fireCharged(s);
  const hit = find(ev, "hit");
  assert.equal(hit.mult, 3);
  assert.equal(hit.points, T.PTS.guard * 3);
  assert.equal(s.score, T.PTS.guard * 3);
});

test("a rare pays its own base and time bonus", () => {
  const s = newGame();
  s.timeLeft = 10;
  addEnemy(s, { type: "rare" });
  const ev = fire(s);
  const hit = find(ev, "hit");
  assert.equal(hit.points, T.PTS.rare);
  assert.equal(Number(s.timeLeft.toFixed(4)), 10 + T.BONUS.rare);
});

test("the time reward is capped at TIME_CAP", () => {
  const s = newGame();
  s.timeLeft = T.TIME_CAP - 0.4;
  addEnemy(s, { type: "mett" });
  fire(s);
  assert.equal(s.timeLeft, T.TIME_CAP);
});

test("a whiff costs accuracy and breaks a chain", () => {
  const s = newGame();
  s.chain = 7;
  s.bestChain = 7;
  const ev = fire(s);
  assert.equal(s.whiffs, 1);
  assert.equal(s.chain, 0);
  assert.equal(s.bestChain, 7);
  const broken = find(ev, "chainBroken");
  assert.equal(broken.chain, 7);
  assert.equal(broken.cause, "whiff");
  assert.equal(count(ev, "whiff"), 1);
});

test("a whiff with no chain reports no break", () => {
  const s = newGame();
  const ev = fire(s);
  assert.equal(count(ev, "chainBroken"), 0);
});

test("shots only reach the player's own row, nearest column first", () => {
  const s = newGame();
  addEnemy(s, { type: "mett", col: 5, row: 1 });
  addEnemy(s, { type: "mett", col: 3, row: 1 });
  addEnemy(s, { type: "mett", col: 4, row: 0 });
  const ev = fire(s);
  assert.equal(find(ev, "hit").col, 3);

  s.player.row = 2;
  const ev2 = fire(s);
  assert.equal(count(ev2, "hit"), 0);
  assert.equal(count(ev2, "whiff"), 1);
});

test("hitting a prog costs time, points and the chain", () => {
  const s = newGame();
  s.score = 500;
  s.timeLeft = 20;
  s.chain = 6;
  addEnemy(s, { type: "ally", state: "up" });
  const ev = fire(s);

  assert.equal(s.score, 500 - T.ALLY_PTS_PENALTY);
  assert.equal(Number(s.timeLeft.toFixed(4)), 20 - T.ALLY_TIME_PENALTY);
  assert.equal(s.chain, 0);
  assert.equal(s.whiffs, 1);
  assert.equal(s.deletions, 0);
  assert.equal(find(ev, "chainBroken").cause, "prog");
  assert.ok(find(ev, "progHit"));
});

test("the prog penalty cannot push score or clock below zero", () => {
  const s = newGame();
  s.score = 50;
  s.timeLeft = 1;
  addEnemy(s, { type: "ally", state: "up" });
  fire(s);
  assert.equal(s.score, 0);
  assert.equal(s.timeLeft, 0);
});

test("a rising or sinking prog is not a target — shots pass through", () => {
  for (const st of ["rising", "sinking"]) {
    const s = newGame();
    addEnemy(s, { type: "ally", state: st });
    const ev = fire(s);
    assert.equal(count(ev, "progHit"), 0, st);
    assert.equal(count(ev, "whiff"), 1, st);
  }
});

test("an untouched prog that reaches cover pays a little time back", () => {
  const s = newGame();
  s.timeLeft = 10;
  addEnemy(s, { type: "ally", state: "sinking", t0: s.clock });
  const ev = step(s, T.SINK_MS + 1, []);
  assert.equal(Number(s.timeLeft.toFixed(4)),
    Number((10 - (T.SINK_MS + 1) / 1000 + T.ALLY_SPARE_BONUS).toFixed(4)));
  assert.ok(find(ev, "allySpared"));
  assert.equal(s.enemies.length, 0);
});

test("a normal shot bounces off a guard: no chain, no score, no deletion", () => {
  const s = newGame();
  s.chain = 4;
  addEnemy(s, { type: "guard" });
  const ev = fire(s);
  assert.equal(s.score, 0);
  assert.equal(s.deletions, 0);
  assert.equal(s.chain, 4);             // contact keeps the chain alive
  assert.equal(s.whiffs, 0);
  assert.ok(find(ev, "guardBlocked"));
  assert.equal(s.enemies[0].state, "up");
});

test("hopper stamina: a tap staggers and moves it, a second tap deletes it", () => {
  const s = newGame();
  s.chain = 3;
  const hop = addEnemy(s, { type: "hopper", col: 3, row: 1 });
  const ev = fire(s);
  assert.equal(hop.hp, 1);
  assert.equal(s.deletions, 0);
  assert.equal(s.chain, 3);             // contact: neither breaks nor grows
  assert.ok(find(ev, "hopperStagger"));
  assert.ok(find(ev, "hopperHop"));
  assert.ok(hop.col !== 3 || hop.row !== 1);

  hop.col = 3; hop.row = 1;             // chase it down
  s.player.row = 1;
  const ev2 = fire(s);
  assert.equal(s.deletions, 1);
  assert.equal(find(ev2, "hit").points, T.PTS.hopper * C.multOf(4));
});

test("a charged shot deletes a full-stamina hopper outright", () => {
  const s = newGame();
  addEnemy(s, { type: "hopper" });
  const ev = fireCharged(s);
  assert.equal(s.deletions, 1);
  assert.equal(find(ev, "hit").points, T.PTS.hopper);
});
