import test from "node:test";
import assert from "node:assert/strict";
import { newGame, addEnemy, fire, step, find, count, C, T } from "./helpers.mjs";
import { computeRank } from "../src/core/select.js";

test("stage gates are strictly ascending on both floors", () => {
  for (let i = 1; i < C.STAGES.length; i++) {
    assert.ok(C.STAGES[i].at > C.STAGES[i - 1].at,
      `STAGES[${i}].at must exceed STAGES[${i - 1}].at`);
    assert.ok(C.STAGES[i].wave > C.STAGES[i - 1].wave,
      `STAGES[${i}].wave must exceed STAGES[${i - 1}].wave`);
  }
  // the overclock card and the overclock itself are the same moment
  const oc = C.STAGES.find((st) => st.title === "OVERCLOCK");
  assert.equal(oc.at, T.OC_START);
});

test("stageIdx advances linearly, one gate per crossing, in order", () => {
  // A gate now needs two floors — waves started and deletions banked — so this
  // walks both up together and asserts the gate opens on whichever lands last.
  const s = newGame();
  s.timeLeft = 1e6;
  const gates = [];
  let guard = 0;
  while (s.stageIdx < C.STAGES.length && guard++ < 5000) {
    const expectedIdx = s.stageIdx;
    if (s.mode === "interlevel") { step(s, 0, [{ type: "resume" }]); continue; }
    s.waveIdx = Math.min(C.STAGES[expectedIdx].wave, s.deletions);
    addEnemy(s, { type: "mett", col: 3, row: 1 });
    const ev = fire(s);
    s.enemies.length = 0;
    const gate = find(ev, "stageGate");
    if (gate) {
      assert.equal(gate.index, expectedIdx, "gate fires for the current index");
      assert.equal(s.stageIdx, expectedIdx + 1, "stageIdx advances by exactly one");
      assert.ok(s.deletions >= gate.stage.at, "the deletion floor was met");
      assert.ok(s.waveIdx >= gate.stage.wave, "and so was the wave floor");
      assert.equal(s.mode, "interlevel");
      gates.push(gate.stage.title);
    } else {
      assert.equal(s.stageIdx, expectedIdx, "no silent gate skipping");
    }
  }
  assert.deepEqual(gates, C.STAGES.map((st) => st.title));
  assert.equal(s.stageIdx, C.STAGES.length);
});

test("a gate waits for BOTH floors: waves alone and kills alone are not enough", () => {
  const st = C.STAGES[0];

  const grinder = newGame();            // kills fast, but the waves have not run
  grinder.timeLeft = 1e6;
  grinder.deletions = st.at + 5;
  step(grinder, 16, []);
  assert.equal(grinder.mode, "playing", "a rushed deletion count opens nothing");
  assert.equal(grinder.stageIdx, 0);

  const idler = newGame();              // waves have run, but nothing was killed
  idler.timeLeft = 1e6;
  idler.waveIdx = st.wave + 3;
  step(idler, 16, []);
  assert.equal(idler.mode, "playing", "surviving alone teaches nothing either");
  assert.equal(idler.stageIdx, 0);

  idler.deletions = st.at;
  const ev = step(idler, 16, []);
  assert.equal(find(ev, "stageGate").title, st.title, "both floors: the card opens");
});

test("a stage gate pays a time bonus, drops bolts and parks the run", () => {
  const s = newGame();
  s.deletions = C.STAGES[0].at - 1;
  s.waveIdx = C.STAGES[0].wave;
  s.timeLeft = 10;
  s.bolts.push({ row: 1, x: 400, speed: 0.5, heavy: false });
  s.charge.downAt = s.clock; s.charge.full = true;
  addEnemy(s, { type: "mett" });
  const ev = fire(s);

  const gate = find(ev, "stageGate");
  assert.ok(gate);
  assert.equal(gate.timeBonus, T.STAGE_BONUS);
  assert.equal(s.mode, "interlevel");
  assert.equal(s.bolts.length, 0);
  assert.equal(s.charge.downAt, null);
  assert.equal(s.charge.full, false);
  assert.equal(Number(s.timeLeft.toFixed(4)),
    Number((10 + T.BONUS.normal + T.STAGE_BONUS).toFixed(4)));
});

test("the clock and enemies freeze during an interlevel, and resume restarts them", () => {
  const s = newGame();
  s.deletions = C.STAGES[0].at - 1;
  s.waveIdx = C.STAGES[0].wave;
  addEnemy(s, { type: "mett" });
  fire(s);
  assert.equal(s.mode, "interlevel");

  const clock = s.clock;
  const timeLeft = s.timeLeft;
  step(s, 500, []);
  assert.equal(s.clock, clock, "clock does not advance");
  assert.equal(s.timeLeft, timeLeft, "no time drains");

  const ev = step(s, 16, [{ type: "resume" }]);
  assert.ok(find(ev, "resumed"));
  assert.equal(s.mode, "playing");
  assert.equal(s.nextSpawnAt, clock + 700);
});

test("END RUN from the interlevel card ends the run", () => {
  const s = newGame();
  s.deletions = C.STAGES[0].at - 1;
  s.waveIdx = C.STAGES[0].wave;
  addEnemy(s, { type: "mett" });
  fire(s);
  const ev = step(s, 0, [{ type: "endRun" }]);
  assert.equal(s.mode, "over");
  assert.ok(find(ev, "gameOver"));
});

test("the clock drains in real time and ends the run at zero", () => {
  const s = newGame();
  s.timeLeft = 0.05;
  const ev = step(s, 100, []);
  assert.equal(s.timeLeft, 0);
  assert.equal(s.mode, "over");
  const over = find(ev, "gameOver");
  assert.ok(over);
  assert.equal(over.score, 0);
});

test("game over clears the field, the bolts and the charge", () => {
  const s = newGame();
  addEnemy(s, { type: "mett" });
  s.bolts.push({ row: 0, x: 300, speed: 0.4, heavy: true });
  s.charge.downAt = s.clock; s.charge.full = true;
  s.timeLeft = 0.01;
  step(s, 50, []);
  assert.equal(s.mode, "over");
  assert.equal(s.enemies.length, 0);
  assert.equal(s.bolts.length, 0);
  assert.equal(s.charge.downAt, null);
});

test("game over reports a new best exactly once, then keeps it", () => {
  const s = newGame();
  s.score = 4200;
  s.timeLeft = 0.001;
  const ev = step(s, 20, []);
  const over = find(ev, "gameOver");
  assert.equal(over.newBest, true);
  assert.equal(over.best, 4200);
  assert.equal(s.best, 4200);

  step(s, 0, [{ type: "startRun" }]);
  s.score = 100;
  s.timeLeft = 0.001;
  const ev2 = step(s, 20, []);
  assert.equal(find(ev2, "gameOver").newBest, false);
  assert.equal(s.best, 4200);
});

test("nothing simulates while the run is over", () => {
  const s = newGame();
  s.timeLeft = 0.001;
  step(s, 20, []);
  const clock = s.clock;
  const ev = step(s, 500, [{ type: "move", dc: 1, dr: 0 }]);
  assert.equal(s.clock, clock);
  assert.equal(count(ev, "gameOver"), 0);
});

test("ranks follow accuracy and best chain", () => {
  const mk = (shots, whiffs, bestChain) => ({ shots, whiffs, bestChain });
  assert.equal(computeRank(mk(100, 20, 20)), "S");
  assert.equal(computeRank(mk(100, 20, 19)), "A");
  assert.equal(computeRank(mk(100, 45, 30)), "B");
  assert.equal(computeRank(mk(100, 60, 30)), "C");
  assert.equal(computeRank(mk(100, 80, 30)), "D");
  assert.equal(computeRank(mk(0, 0, 0)), "D");
});

test("overclock decays the time reward past OC_START, rares at half rate", () => {
  assert.equal(T.bonusFactor(T.OC_START), 1);
  assert.equal(T.bonusFactor(T.OC_START - 1), 1);
  assert.ok(T.bonusFactor(T.OC_START + 1) < 1);
  assert.ok(T.bonusFactor(200) < T.bonusFactor(100));
  assert.ok(T.bonusFactor(1000) > 0, "decay has no floor but never flips sign");

  const s = newGame();
  s.deletions = T.OC_START + 39;      // the deletion below takes it to +40
  s.timeLeft = 10;
  addEnemy(s, { type: "mett" });
  const ev = fire(s);
  const expected = T.BONUS.normal * T.bonusFactor(T.OC_START + 40);
  assert.equal(find(ev, "hit").timeBonus, expected);
  assert.ok(expected < T.BONUS.normal);

  const r = newGame();
  r.deletions = T.OC_START + 39;
  r.timeLeft = 10;
  addEnemy(r, { type: "rare" });
  const rev = fire(r);
  assert.equal(find(rev, "hit").timeBonus,
    T.BONUS.rare * Math.sqrt(T.bonusFactor(T.OC_START + 40)));
});

// The OVERCLOCK card and the decay are the same moment by construction: the
// gate's deletion floor IS OC_START, so the run cannot start decaying before
// the card that explains it.
test("the overclock card fires on the deletion the decay starts at", () => {
  const oc = C.STAGES.findIndex((st) => st.title === "OVERCLOCK");
  assert.equal(C.STAGES[oc].at, T.OC_START);
  const g = newGame();
  g.timeLeft = 1e6;
  g.stageIdx = oc;
  g.waveIdx = C.STAGES[oc].wave;
  g.deletions = T.OC_START - 1;
  assert.equal(T.bonusFactor(g.deletions), 1, "nothing has decayed yet");
  step(g, 16, []);
  assert.equal(g.mode, "playing", "and the card has not fired yet either");
  g.deletions = T.OC_START;
  assert.equal(find(step(g, 16, []), "stageGate").title, "OVERCLOCK");
});

test("pause freezes the simulation and spills the charge", () => {
  const s = newGame();
  addEnemy(s, { type: "mett", state: "rising", t0: s.clock });
  s.charge.downAt = s.clock; s.charge.full = true;
  const ev = step(s, 0, [{ type: "pause" }]);
  assert.ok(find(ev, "paused"));
  assert.equal(s.charge.downAt, null);

  const clock = s.clock;
  step(s, 400, []);
  assert.equal(s.clock, clock);
  assert.equal(s.enemies[0].state, "rising");

  const ev2 = step(s, 16, [{ type: "pause" }]);
  assert.ok(find(ev2, "unpaused"));
  assert.equal(s.clock, clock + 16);
});

test("blur pauses a live run but never unpauses a paused one", () => {
  const s = newGame();
  step(s, 0, [{ type: "pauseOnBlur" }]);
  assert.equal(s.paused, true);
  step(s, 0, [{ type: "pauseOnBlur" }]);
  assert.equal(s.paused, true);
});

test("moving is clamped to the player's half and throttled", () => {
  const s = newGame();
  assert.deepEqual([s.player.col, s.player.row], [1, 1]);
  step(s, 0, [{ type: "move", dc: -1, dr: 0 }]);
  assert.equal(s.player.col, 0);
  step(s, 0, [{ type: "move", dc: -1, dr: 0 }]);
  assert.equal(s.player.col, 0, "throttled, and clamped at the left wall");

  // intents land before the frame's own dt, so the throttle opens a frame later
  step(s, T.MOVE_REPEAT_MS, []);
  step(s, 0, [{ type: "move", dc: 0, dr: -1 }]);
  assert.equal(s.player.row, 0);
  step(s, T.MOVE_REPEAT_MS, []);
  step(s, 0, [{ type: "move", dc: 0, dr: -1 }]);
  assert.equal(s.player.row, 0, "clamped at the top wall");
  step(s, T.MOVE_REPEAT_MS, []);
  step(s, 0, [{ type: "move", dc: 3, dr: 3 }]);
  assert.equal(s.player.col, C.PCOLS - 1);
  assert.equal(s.player.row, C.ROWS - 1);
});

test("a held d-pad direction repeats on the move throttle", () => {
  const s = newGame();
  s.player.col = 0;
  const hold = { dc: 1, dr: 0 };
  step(s, 16, { actions: [], hold });
  assert.equal(s.player.col, 1);
  step(s, 16, { actions: [], hold });
  assert.equal(s.player.col, 1, "still inside the repeat window");
  step(s, T.MOVE_REPEAT_MS, { actions: [], hold });
  assert.equal(s.player.col, 2);
  step(s, T.MOVE_REPEAT_MS, { actions: [{ type: "resetMoveThrottle" }], hold: { dc: -1, dr: 0 } });
  assert.equal(s.player.col, 1, "rocking the ring responds immediately");
});

test("a fresh run resets the scoreboard but keeps the best", () => {
  const s = newGame();
  s.score = 900; s.deletions = 7; s.chain = 4; s.bestChain = 9;
  s.shots = 20; s.whiffs = 3; s.stageIdx = 2; s.best = 5000;
  s.waveIdx = 9; s.waveState = "active"; s.wave = { index: 8, queue: [] };
  s.bolts.push({ row: 0, x: 10, speed: 1, kind: "slow", radius: 20, heavy: true });
  addEnemy(s, { type: "mett" });
  const ev = step(s, 0, [{ type: "startRun" }]);

  assert.ok(find(ev, "runStarted"));
  assert.equal(s.score, 0);
  assert.equal(s.deletions, 0);
  assert.equal(s.chain, 0);
  assert.equal(s.bestChain, 0);
  assert.equal(s.shots, 0);
  assert.equal(s.whiffs, 0);
  assert.equal(s.stageIdx, 0);
  assert.equal(s.waveIdx, 0, "and the wave counter starts over");
  assert.equal(s.waveState, "lull");
  assert.equal(s.wave, null);
  assert.equal(s.timeLeft, T.START_TIME);
  assert.equal(s.enemies.length, 0);
  assert.equal(s.bolts.length, 0);
  assert.equal(s.best, 5000);
  assert.deepEqual([s.player.col, s.player.row], [1, 1]);
});
