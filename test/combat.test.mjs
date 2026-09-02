import test from "node:test";
import assert from "node:assert/strict";
import { newGame, addEnemy, fire, step, find, count, C } from "./helpers.mjs";

const px = (s) => {
  const p = C.panelRect(s.G, s.player.col, s.player.row);
  return p.x + p.w / 2;
};

test("an enemy walks rising -> up -> sinking -> gone", () => {
  const s = newGame();
  const e = addEnemy(s, { type: "mett", state: "rising", t0: s.clock });

  step(s, C.RISE_MS - 1, []);
  assert.equal(e.state, "rising");
  const ev = step(s, 2, []);
  assert.equal(e.state, "up");
  assert.equal(count(ev, "enemyAim"), 0, "a passive enemy never telegraphs");

  step(s, C.upMs(s.deletions) - 1, []);
  assert.equal(e.state, "up");
  step(s, 2, []);
  assert.equal(e.state, "sinking");

  step(s, C.SINK_MS - 1, []);
  assert.equal(s.enemies.length, 1);
  const ev2 = step(s, 2, []);
  assert.equal(s.enemies.length, 0);
  assert.equal(find(ev2, "enemyEscaped").enemyType, "mett");
});

test("a deleted enemy lingers for HIT_MS then leaves without escaping", () => {
  const s = newGame();
  addEnemy(s, { type: "mett" });
  fire(s);
  assert.equal(s.enemies[0].state, "hit");
  step(s, C.HIT_MS - 1, []);
  assert.equal(s.enemies.length, 1);
  const ev = step(s, 2, []);
  assert.equal(s.enemies.length, 0);
  assert.equal(count(ev, "enemyEscaped"), 0);
});

test("progs rise slower than viruses", () => {
  const s = newGame();
  const a = addEnemy(s, { type: "ally", state: "rising", t0: s.clock });
  step(s, C.RISE_MS + 1, []);
  assert.equal(a.state, "rising");
  step(s, C.ALLY_RISE_MS - C.RISE_MS, []);
  assert.equal(a.state, "up");
});

test("an attacker telegraphs on surfacing, fires after aimMs, then sticks around", () => {
  const s = newGame();
  s.deletions = C.ATTACK_START + 10;
  const e = addEnemy(s, { type: "mett", col: 4, row: 2, state: "rising", t0: s.clock, willAttack: true });

  const rise = step(s, C.RISE_MS, []);
  assert.ok(find(rise, "enemyAim"));
  assert.equal(e.state, "up");

  const aim = C.aimMs(s.deletions);
  step(s, aim - 1, []);
  assert.equal(s.bolts.length, 0);
  const ev = step(s, 2, []);
  assert.equal(s.bolts.length, 1);
  assert.equal(e.fired, true);

  const shot = find(ev, "enemyFired");
  assert.equal(shot.heavy, false);
  const b = s.bolts[0];
  assert.equal(b.row, 2);
  assert.equal(b.speed, s.G.pw / C.boltPanelMs(s.deletions));

  // it outlives a plain enemy so the follow-through is visible
  const life = Math.max(C.upMs(s.deletions), aim + 300);
  assert.ok(life > C.upMs(s.deletions));
  step(s, life - aim - 2, []);
  assert.equal(e.state, "up", "still up past a passive enemy's lifetime");
  step(s, 2, []);
  assert.equal(e.state, "sinking");
});

test("a guard's bolt is heavy", () => {
  const s = newGame();
  s.deletions = C.ATTACK_START + 5;
  addEnemy(s, { type: "guard", state: "up", willAttack: true });
  const ev = step(s, C.aimMs(s.deletions) + 1, []);
  assert.equal(find(ev, "enemyFired").heavy, true);
  assert.equal(s.bolts[0].heavy, true);
});

test("only metts and guards retaliate", () => {
  const s = newGame({ spawn: true, seed: 7 });
  s.deletions = 200;                       // attackChance is maxed here
  for (let i = 0; i < 400; i++) step(s, 16, []);
  for (const e of s.enemies) {
    if (e.willAttack) assert.ok(e.type === "mett" || e.type === "guard", e.type);
  }
});

test("a bolt travelling into the player's panel costs time and the chain", () => {
  const s = newGame();
  s.timeLeft = 20;
  s.chain = 8;
  s.charge.downAt = s.clock; s.charge.full = true;
  s.bolts.push({ row: s.player.row, x: px(s) + 100, speed: 1, heavy: false });

  const ev = step(s, 70, []);
  assert.equal(s.bolts.length, 0, "the bolt is consumed");
  const hit = find(ev, "playerHit");
  assert.ok(hit);
  assert.equal(hit.timePenalty, C.HIT_TIME_PENALTY);
  assert.equal(Number(s.timeLeft.toFixed(4)), Number((20 - 0.07 - C.HIT_TIME_PENALTY).toFixed(4)));
  assert.equal(s.chain, 0);
  assert.equal(find(ev, "chainBroken").cause, "hurt");
  assert.equal(s.charge.downAt, null, "a hit spills the charge");
  assert.equal(s.hurtUntil, s.clock + C.HIT_IFRAME_MS);
});

test("a bolt in another row misses and eventually leaves the board", () => {
  const s = newGame();
  s.player.row = 1;
  s.bolts.push({ row: 0, x: px(s) + 50, speed: 1, heavy: false });
  const ev = step(s, 100, []);
  assert.equal(count(ev, "playerHit"), 0);
  assert.equal(s.bolts.length, 1);
  step(s, 2000, []);
  assert.equal(s.bolts.length, 0, "despawned past the left edge");
});

test("i-frames swallow a second hit inside HIT_IFRAME_MS", () => {
  const s = newGame();
  s.timeLeft = 30;
  s.bolts.push({ row: s.player.row, x: px(s) + 60, speed: 1, heavy: false });
  step(s, 70, []);
  assert.equal(s.timeLeft.toFixed(2), (30 - 0.07 - C.HIT_TIME_PENALTY).toFixed(2));
  const after = s.timeLeft;

  s.bolts.push({ row: s.player.row, x: px(s) + 20, speed: 1, heavy: false });
  const ev = step(s, 30, []);
  assert.equal(count(ev, "playerHit"), 0, "still invulnerable");
  assert.equal(s.timeLeft.toFixed(4), (after - 0.03).toFixed(4));
  assert.equal(s.bolts.length, 1, "the bolt passes straight through");

  // once the window closes, the next bolt lands again
  step(s, C.HIT_IFRAME_MS, []);
  s.bolts.length = 0;
  s.timeLeft = 30;
  s.bolts.push({ row: s.player.row, x: px(s) + 60, speed: 1, heavy: false });
  const ev2 = step(s, 70, []);
  assert.equal(count(ev2, "playerHit"), 1);
});

test("bolts freeze while paused", () => {
  const s = newGame();
  s.bolts.push({ row: 0, x: 500, speed: 1, heavy: false });
  step(s, 0, [{ type: "pause" }]);
  step(s, 200, []);
  assert.equal(s.bolts[0].x, 500);
});

test("hoppers flee on the hop timer while they are up", () => {
  const s = newGame();
  const h = addEnemy(s, { type: "hopper", col: 3, row: 0 });
  const before = h.col + "," + h.row;
  step(s, C.HOP_MS - 1, []);
  assert.equal(h.col + "," + h.row, before);
  const ev = step(s, 2, []);
  assert.ok(find(ev, "hopperHop"));
  assert.notEqual(h.col + "," + h.row, before);
  assert.ok(h.col >= C.PCOLS, "never onto the player's half");
});

test("spawning respects the concurrency ramp and the spawn gap", () => {
  const s = newGame({ spawn: true, seed: 3 });
  assert.equal(C.maxConcurrent(0), 1);
  for (let i = 0; i < 200; i++) {
    step(s, 16, []);
    assert.ok(s.enemies.length <= C.maxConcurrent(s.deletions));
  }
  assert.ok(s.enemies.length >= 1, "something did spawn");

  const s2 = newGame({ spawn: true, seed: 3 });
  s2.deletions = 160;
  for (let i = 0; i < 400; i++) {
    step(s2, 16, []);
    assert.ok(s2.enemies.length <= 4);
  }
  assert.ok(s2.enemies.length > 1, "the late game stacks enemies");
});

test("enemies only ever occupy the far half, one per panel", () => {
  const s = newGame({ spawn: true, seed: 11 });
  s.deletions = 160;
  for (let i = 0; i < 600; i++) {
    step(s, 16, []);
    const seen = new Set();
    for (const e of s.enemies) {
      assert.ok(e.col >= C.PCOLS && e.col < C.COLS, "column " + e.col);
      assert.ok(e.row >= 0 && e.row < C.ROWS);
      const key = e.col + "," + e.row;
      assert.ok(!seen.has(key), "two enemies on panel " + key);
      seen.add(key);
    }
  }
});
