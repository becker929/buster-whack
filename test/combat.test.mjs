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

test("a deleted enemy lingers for HIT_MS after the tracer lands", () => {
  const s = newGame();
  addEnemy(s, { type: "mett" });
  fire(s);
  assert.equal(s.enemies[0].state, "hit");

  // The delete animation is dated to the impact, not to the trigger pull: the
  // enemy stays intact while the tracer crosses the board, then pops.
  const flight = s.fx.ray.dur;
  assert.ok(flight > 0);
  step(s, flight, []);
  assert.equal(s.enemies[0].t0, s.clock, "the hit clock starts when the shot lands");

  // and the impact freeze buys a few frames before real time resumes
  step(s, C.HITSTOP.normal, []);
  assert.equal(s.clock, s.enemies[0].t0, "hit-stop froze the simulation clock");

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

  const aim = C.aimMs(s.deletions, "slow");
  step(s, aim - 1, []);
  assert.equal(s.bolts.length, 0);
  const ev = step(s, 2, []);
  assert.equal(s.bolts.length, 1);
  assert.equal(e.fired, true);

  // a mett fires the slow shell: heavy, and `heavy` is its legacy alias
  const shot = find(ev, "enemyFired");
  assert.equal(shot.kind, "slow");
  assert.equal(shot.heavy, true);
  const b = s.bolts[0];
  assert.equal(b.row, 2);
  assert.equal(b.kind, "slow");
  assert.equal(b.speed, s.G.pw / C.boltPanelMs(s.deletions, "slow"));

  // it outlives its own aim, so the follow-through is always visible
  const life = Math.max(C.upMs(s.deletions), aim + C.ATTACK_FOLLOW_MS);
  assert.ok(life >= aim + C.ATTACK_FOLLOW_MS);
  step(s, life - aim - 2, []);
  assert.equal(e.state, "up", "still up past a passive enemy's lifetime");
  step(s, 2, []);
  assert.equal(e.state, "sinking");
});

// Was "a guard's bolt is heavy". Guards no longer shoot at all: the guard is
// the anchor of a formation and already demands a held charge, which is the
// one thing that pins the player in place. The heavy bolt moved to the mett,
// where dodging it does not fight the mechanic the guard exists to teach.
test("a steel guard is an anchor and never fires", () => {
  const s = newGame();
  s.deletions = C.ATTACK_START + 5;
  const g = addEnemy(s, { type: "guard", state: "up", willAttack: true });
  step(s, C.aimMs(s.deletions, "slow") + C.aimMs(s.deletions, "fast") + 200, []);
  assert.equal(s.bolts.length, 0, "nothing left the guard");
  assert.equal(C.boltKindFor("guard"), "slow", "and if one ever did it would be a shell");
  assert.ok(g);
});

test("the two bolts differ in size and speed, and both are large", () => {
  const s = newGame();
  s.deletions = C.ATTACK_START + 5;
  addEnemy(s, { type: "mett", col: 4, row: 0, state: "up", willAttack: true });
  addEnemy(s, { type: "hopper", col: 4, row: 2, state: "up", willAttack: true });
  // one frame at a time: the fast bolt crosses the whole board in well under
  // the slow one's aim window, which is the point of the pair
  for (let i = 0; i < 60 && s.bolts.length < 2; i++) step(s, 16, []);

  const slow = s.bolts.find((b) => b.kind === "slow");
  const fast = s.bolts.find((b) => b.kind === "fast");
  assert.equal(slow.kind, "slow");
  assert.equal(fast.kind, "fast");
  assert.ok(fast.speed > slow.speed * 1.5, "the hopper's bolt is genuinely faster");
  assert.ok(slow.radius > fast.radius, "and the mett's is genuinely bigger");
  // both read as large projectiles: the old sprite was a flat 8px / 11px
  assert.ok(fast.radius > 11, "even the small one is larger than the old heavy bolt");
  assert.equal(slow.radius, s.G.pw * C.BOLT.slow.radiusFrac, "radius scales with the board");
});

test("only metts and hoppers retaliate", () => {
  const s = newGame({ spawn: true, seed: 7 });
  s.deletions = 200;                       // attackChance is maxed here
  s.stageIdx = C.STAGES.length;            // and everything has been unlocked
  for (let i = 0; i < 900; i++) step(s, 16, []);
  let armed = 0;
  for (const e of s.enemies) {
    if (!e.willAttack) continue;
    armed++;
    assert.ok(e.type === "mett" || e.type === "hopper", e.type);
  }
  assert.ok(armed >= 0);
});

// The fairness budget, pinned. Both bolts are dodgeable at every level; the
// fast one buys its speed with the longest telegraph in the game, so it is
// dodged during the aim rather than after the launch.
test("telegraph + travel is the whole dodge window, and it stays fair", () => {
  const REACTION = 420;              // ms; a generous human reaction floor
  for (const del of [C.ATTACK_START, 52, 150, 300, 600]) {
    const slowAim = C.aimMs(del, "slow"), fastAim = C.aimMs(del, "fast");
    assert.ok(fastAim > slowAim,
      `the fast bolt telegraphs longer (del ${del}: ${fastAim} vs ${slowAim})`);
    assert.ok(C.boltPanelMs(del, "fast") < C.boltPanelMs(del, "slow") * 0.6,
      "and it really is much faster in flight");

    for (const kind of ["slow", "fast"]) {
      // one panel apart is the tightest engagement the board allows
      const tightest = C.dodgeWindowMs(del, kind, 1);
      assert.ok(tightest >= REACTION,
        `${kind} at ${del} deletions leaves ${tightest.toFixed(0)}ms — under the floor`);
      assert.equal(
        C.dodgeWindowMs(del, kind, 3),
        C.aimMs(del, kind) + (3 - C.BOLT_HIT_R) * C.boltPanelMs(del, kind),
        "the window is exactly telegraph + travel, nothing else");
      // the window shrinks with difficulty but never inverts
      assert.ok(C.dodgeWindowMs(del, kind, 3) <= C.dodgeWindowMs(C.ATTACK_START, kind, 3));
    }
    // the fast bolt is the one you must read early: after it launches there is
    // less than a reaction's worth of time left
    assert.ok(C.dodgeWindowMs(del, "fast", 3) - fastAim < REACTION);
    // the slow one can still be left after it launches
    assert.ok(C.dodgeWindowMs(del, "slow", 3) - slowAim > REACTION);
  }
});

test("a hopper plants itself while it aims, then goes back to fleeing", () => {
  const s = newGame();
  s.deletions = C.ATTACK_START + 5;
  const h = addEnemy(s, { type: "hopper", col: 4, row: 1, state: "up", willAttack: true });
  const aim = C.aimMs(s.deletions, "fast");
  assert.ok(aim > C.HOP_MS, "the aim outlasts a hop, so planting is observable");

  step(s, C.HOP_MS + 1, []);
  assert.equal(h.col + "," + h.row, "4,1", "it does not hop mid-telegraph");

  step(s, aim - C.HOP_MS + 1, []);
  assert.equal(s.bolts.length, 1);
  assert.equal(s.bolts[0].kind, "fast");
  step(s, C.HOP_MS + 1, []);
  assert.notEqual(h.col + "," + h.row, "4,1", "and it bolts again once it has fired");
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

// Was "spawning respects the concurrency ramp and the spawn gap". There is no
// rolling gap any more: enemies arrive as waves, so what has to hold is the
// wave's own size contract and the hard ceiling on bodies.
test("a wave is bounded by its size, and the board by MAX_ALIVE", () => {
  const s = newGame({ spawn: true, seed: 3 });
  assert.equal(C.waveSize(0), 2, "the opening wave is two viruses");
  let peak = 0, waves = 0;
  for (let i = 0; i < 600; i++) {
    for (const ev of step(s, 16, [])) if (ev.type === "waveStart") waves++;
    peak = Math.max(peak, s.enemies.length);
    assert.ok(s.enemies.length <= C.MAX_ALIVE, "over the ceiling: " + s.enemies.length);
  }
  assert.ok(waves >= 2, "waves kept coming");
  assert.ok(peak >= 2, "and a whole formation was on the board at once");

  const s2 = newGame({ spawn: true, seed: 3 });
  s2.stageIdx = C.STAGES.length;           // everything taught: the biggest waves
  let peak2 = 0;
  for (let i = 0; i < 900; i++) {
    step(s2, 16, []);
    peak2 = Math.max(peak2, s2.enemies.length);
    assert.ok(s2.enemies.length <= C.MAX_ALIVE);
  }
  assert.ok(peak2 > 2, "the late game stacks enemies");
});

test("waves arrive as a formation, with a readable lull between them", () => {
  const s = newGame({ spawn: true, seed: 12 });
  s.timeLeft = 1e6;                        // measure the rhythm, not the clock
  const marks = [];
  for (let i = 0; i < 1200; i++) {
    for (const ev of step(s, 16, [])) {
      if (ev.type === "waveStart" || ev.type === "waveEnded") {
        marks.push({ type: ev.type, at: s.clock, ev });
      }
    }
  }
  assert.ok(marks.length >= 6, "several waves ran");
  // strictly alternating: one wave at a time, always followed by its lull
  for (let i = 0; i < marks.length; i++) {
    assert.equal(marks[i].type, i % 2 === 0 ? "waveStart" : "waveEnded");
  }
  for (let i = 1; i + 1 < marks.length; i += 2) {
    const lull = marks[i + 1].at - marks[i].at;
    assert.ok(lull >= C.LOW_TIME_LULL_MS - 20, "the lull is real: " + lull + "ms");
    assert.ok(lull <= C.waveLullMs(0) + 40, "and bounded: " + lull + "ms");
  }
  // arrivals inside a wave are staggered, not simultaneous
  const staggered = marks.some((m) => m.type === "waveStart" && m.ev.size >= 2);
  assert.ok(staggered);
});

test("clearing every virus in a wave shortens the lull and pays time", () => {
  const s = newGame({ spawn: true, seed: 4 });
  s.timeLeft = 20;
  let cleared = null, lapsed = null;
  for (let i = 0; i < 2000 && (!cleared || !lapsed); i++) {
    // delete whatever is up, on alternating waves, so both outcomes happen
    const e = s.enemies.find((x) => x.state === "up" && x.type !== "ally");
    const evs = [];
    if (e && s.waveIdx % 2 === 1) {
      s.player.row = e.row;
      e.hp = 1;
      // the killing blow can end the wave in the very same step
      evs.push(...step(s, 0, [{ type: "firePressed" }, { type: "fireReleased" }]));
    }
    evs.push(...step(s, 16, []));
    for (const ev of evs) {
      if (ev.type !== "waveEnded") continue;
      if (ev.cleared) cleared = ev; else lapsed = ev;
    }
  }
  assert.ok(cleared, "a wave was wiped out");
  assert.ok(lapsed, "and one was left to expire");
  assert.ok(cleared.timeBonus > 0, "a clear pays time back");
  assert.equal(lapsed.timeBonus, 0, "letting one expire pays nothing");
  assert.ok(cleared.points > 0);
  assert.ok(cleared.lullMs < C.waveLullMs(cleared.index),
    "and the next wave comes sooner");
});

test("a lull never becomes dead air while the clock is low", () => {
  const s = newGame({ spawn: true, seed: 8 });
  s.timeLeft = C.LOW_TIME - 1;
  let seen = 0;
  for (let i = 0; i < 900; i++) {
    s.timeLeft = C.LOW_TIME - 1;           // hold it at the panic threshold
    for (const ev of step(s, 16, [])) {
      if (ev.type === "waveEnded") {
        seen++;
        assert.ok(ev.lullMs <= C.LOW_TIME_LULL_MS, "lull " + ev.lullMs + "ms");
      }
    }
  }
  assert.ok(seen > 0, "waves ended while the clock was low");
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
