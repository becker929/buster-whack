import test from "node:test";
import assert from "node:assert/strict";
import { createState } from "../src/core/state.js";
import { step } from "../src/core/step.js";
import { mulberry32 } from "../src/core/rng.js";
import { snapshot } from "./helpers.mjs";

// A scripted run: fixed dt, fixed inputs, nothing from the outside world.
function play(seed, frames = 900) {
  const s = createState({ seed, width: 800, height: 600 });
  step(s, 0, [{ type: "startRun", modeId: "classic" }]);
  for (let i = 0; i < frames; i++) {
    const actions = [];
    if (i % 7 === 0) actions.push({ type: "firePressed" });
    if (i % 7 === 2) actions.push({ type: "fireReleased" });
    if (i % 11 === 0) actions.push({ type: "move", dc: i % 22 === 0 ? 1 : -1, dr: 0 });
    if (i % 13 === 0) actions.push({ type: "move", dc: 0, dr: i % 26 === 0 ? 1 : -1 });
    if (i % 137 === 0) actions.push({ type: "resume" });
    step(s, 16, { actions, hold: i % 5 === 0 ? { dc: 0, dr: 1 } : null });
  }
  return s;
}

test("mulberry32 is a pure function of its seed", () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const seqA = Array.from({ length: 20 }, a);
  const seqB = Array.from({ length: 20 }, b);
  const seqC = Array.from({ length: 20 }, c);
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of seqA) {
    assert.ok(v >= 0 && v < 1, "in [0,1): " + v);
  }
});

test("the same seed, dts and intents produce the same state", () => {
  const a = play(1234);
  const b = play(1234);
  assert.equal(snapshot(a), snapshot(b));
  assert.ok(a.shots > 50, "the script actually played a run");
});

test("a different seed produces a different run", () => {
  assert.notEqual(snapshot(play(1)), snapshot(play(2)));
});

test("an injected rng is used in place of the seeded one", () => {
  const calls = [];
  const rng = () => { calls.push(1); return 0.5; };
  const s = createState({ rng, width: 800, height: 600 });
  step(s, 0, [{ type: "startRun", modeId: "classic" }]);
  // enemies come in waves now, so a fixed frame count can land in a lull:
  // what matters is that the injected rng authored the field at all
  let spawned = 0;
  for (let i = 0; i < 200; i++) {
    for (const ev of step(s, 16, [])) if (ev.type === "enemySpawned") spawned++;
  }
  assert.ok(calls.length > 0, "the core drew from the injected rng");
  assert.ok(spawned > 0);
});

test("the core touches no ambient randomness or clock", () => {
  const realRandom = Math.random;
  const realNow = Date.now;
  const realPerf = globalThis.performance ? globalThis.performance.now : null;
  const boom = (what) => () => { throw new Error("core reached for " + what); };
  Math.random = boom("Math.random");
  Date.now = boom("Date.now");
  if (realPerf) globalThis.performance.now = boom("performance.now");
  try {
    play(99, 600);
  } finally {
    Math.random = realRandom;
    Date.now = realNow;
    if (realPerf) globalThis.performance.now = realPerf;
  }
});

test("replaying from a snapshot of the intents reproduces the score exactly", () => {
  const a = play(777, 1200);
  const b = play(777, 1200);
  assert.equal(a.score, b.score);
  assert.equal(a.deletions, b.deletions);
  assert.equal(a.timeLeft, b.timeLeft);
  assert.equal(a.mode, b.mode);
});
