// The juice layer is *data*: the core authors it deterministically and the
// renderer only reads it. These are the invariants that keep it that way.

import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { newGame, addEnemy, fire, fireCharged, step, find, C, setLayout, T } from "./helpers.mjs";
import { createState } from "../src/core/state.js";
import { draw } from "../src/shell/render.js";
import { snapshot } from "./helpers.mjs";

// ---------- hit-stop ----------

test("a delete freezes the simulation clock but never the run clock", () => {
  const s = newGame();
  s.timeLeft = 20;
  addEnemy(s, { type: "mett" });
  fire(s);
  step(s, s.fx.ray.dur, []);                 // fly the tracer to the target
  assert.equal(s.hitStopMs, C.HITSTOP.normal, "the freeze is armed for the impact");

  const clock = s.clock;
  const timeLeft = s.timeLeft;
  step(s, 16, []);
  assert.equal(s.clock, clock, "the simulation clock is frozen");
  assert.equal(Number((timeLeft - s.timeLeft).toFixed(6)), 0.016, "the run clock is not");
});

test("hit-stop freezes bolts with everything else, so nothing desyncs", () => {
  const s = newGame();
  s.player.row = 0;                          // out of the bolt's lane
  s.bolts.push({ row: 2, x: 700, speed: 1, heavy: false });
  addEnemy(s, { type: "mett", col: 3, row: 0 });
  fire(s);
  step(s, s.fx.ray.dur, []);
  const x = s.bolts[0].x;
  step(s, 16, []);
  assert.equal(s.bolts[0].x, x, "a frozen frame does not advance a bolt");
  step(s, 16 + C.HITSTOP.normal, []);
  assert.ok(s.bolts[0].x < x, "and it moves again once the freeze is spent");
});

test("the freeze is tiered by what died and is capped", () => {
  const of = (type, charged) => {
    const s = newGame();
    addEnemy(s, { type });
    if (charged) fireCharged(s); else fire(s);
    return s.hitStopMs;
  };
  assert.equal(of("mett"), C.HITSTOP.normal);
  assert.equal(of("mett", true), C.HITSTOP.charged);
  assert.equal(of("rare"), C.HITSTOP.rare);
  assert.ok(of("rare") > of("mett"), "a rare is a bigger event than a mett");

  // ten kills in one frame still cannot stall the game
  const s = newGame();
  s.chain = 0;
  for (let i = 0; i < 10; i++) {
    s.enemies.length = 0;
    addEnemy(s, { type: "rare" });
    fireCharged(s);
    if (s.mode === "interlevel") step(s, 0, [{ type: "resume" }]);
  }
  assert.ok(s.hitStopMs <= C.MAX_HITSTOP, "capped at MAX_HITSTOP, got " + s.hitStopMs);
});

test("a stage gate and a game over both drop a pending freeze", () => {
  const s = newGame();
  s.deletions = C.STAGES[0].at - 1;
  s.waveIdx = C.STAGES[0].wave;
  addEnemy(s, { type: "mett" });
  fire(s);
  assert.equal(s.mode, "interlevel");
  assert.equal(s.hitStopMs, 0);

  const o = newGame();
  addEnemy(o, { type: "mett" });
  fire(o);
  o.timeLeft = 0.001;
  step(o, 20, []);
  assert.equal(o.mode, "over");
  assert.equal(o.hitStopMs, 0);
});

// ---------- particles ----------

test("debris is seeded, capped, and never reaches for Math.random", () => {
  const play = (seed) => {
    const s = newGame({ seed });
    for (let i = 0; i < 24; i++) {
      s.enemies.length = 0;
      addEnemy(s, { type: i % 3 === 0 ? "rare" : "mett" });
      fireCharged(s);
      if (s.mode === "interlevel") step(s, 0, [{ type: "resume" }]);
      step(s, 40, []);
    }
    return s;
  };
  const real = Math.random;
  Math.random = () => { throw new Error("the core reached for Math.random"); };
  let a, b, c;
  try { a = play(5); b = play(5); c = play(6); } finally { Math.random = real; }

  assert.equal(snapshot(a), snapshot(b), "same seed, same debris");
  assert.notEqual(snapshot(a), snapshot(c), "a different seed throws it differently");
  assert.ok(a.fx.bits.length > 0, "there was debris at all");
  assert.ok(a.fx.bits.length <= C.MAX_BITS, "the pool is capped");
});

test("debris and ripples are culled once they expire", () => {
  const s = newGame();
  addEnemy(s, { type: "mett" });
  fire(s);
  step(s, 40, []);
  assert.ok(s.fx.bits.length > 0);
  assert.ok(s.fx.ripples.length > 0);
  step(s, C.BIT_MS + C.MAX_HITSTOP + 200, []);
  assert.equal(s.fx.bits.length, 0);
  assert.equal(s.fx.ripples.length, 0);
});

test("a fresh run starts on a clean board", () => {
  const s = newGame();
  addEnemy(s, { type: "mett" });
  fire(s);
  step(s, 40, []);
  step(s, 0, [{ type: "startRun" }]);
  assert.equal(s.fx.bits.length, 0);
  assert.equal(s.fx.ripples.length, 0);
  assert.equal(s.fx.popups.length, 0);
  assert.equal(s.fx.shake.amp, 0);
  assert.equal(s.hitStopMs, 0);
});

// ---------- chain feedback ----------

test("a multiplier step arms the flourish and a break arms its opposite", () => {
  const s = newGame();
  s.chain = 4;
  addEnemy(s, { type: "mett" });
  const ev = fire(s);
  assert.equal(find(ev, "multiplierUp").mult, 2);
  assert.equal(s.fx.flare.mult, 2);
  assert.ok(s.fx.flare.t0 > s.clock, "dated to the impact, not the trigger pull");

  s.chain = 9;
  s.enemies.length = 0;
  fire(s);                                   // a whiff
  assert.equal(s.fx.chainBreak.chain, 9);
  assert.equal(s.fx.chainBreak.quiet, false);

  // taking a bolt breaks it quietly — the HIT popup is already shouting
  const h = newGame();
  h.chain = 6;
  h.bolts.push({ row: h.player.row, x: C.panelRect(h.G, h.player.col, h.player.row).x + h.G.pw / 2 + 40, speed: 1, kind: "slow" });
  step(h, 60, []);
  assert.equal(h.fx.chainBreak.chain, 6);
  assert.equal(h.fx.chainBreak.quiet, true);
});

test("a single-hit chain is not mourned", () => {
  const s = newGame();
  s.chain = 1;
  const ev = fire(s);
  assert.ok(find(ev, "chainBroken"));
  assert.equal(s.fx.chainBreak.t0, -1e9, "no banner for a chain of one");
});

// ---------- reduced motion ----------

test("reducedMotion defaults off, is plain data, and changes only the frame", () => {
  assert.equal(createState({ width: 800, height: 600 }).reducedMotion, false);
  assert.equal(createState({ width: 800, height: 600, reducedMotion: true }).reducedMotion, true);

  const mk = () => {
    const s = newGame({ seed: 9 });
    s.chain = 5;
    addEnemy(s, { type: "mett" });
    fireCharged(s);
    step(s, 120, []);
    s.fx.hurtT0 = s.clock;                   // hurt flash + shake
    s.timeLeft = 3.5;                        // low-time urgency
    return s;
  };
  const full = mk();
  const damped = mk();
  damped.reducedMotion = true;

  const a = createCanvas(800, 600);
  const b = createCanvas(800, 600);
  draw(a.getContext("2d"), full, full.clock);
  draw(b.getContext("2d"), damped, damped.clock);
  assert.notDeepEqual(a.toBuffer("image/png"), b.toBuffer("image/png"),
    "the flag has to actually do something");

  // and it is a render-time concern only: the simulation is untouched by it
  const play = (rm) => {
    const s = newGame({ seed: 3, spawn: true });
    s.reducedMotion = rm;
    for (let i = 0; i < 300; i++) step(s, 16, i % 7 === 0 ? [{ type: "firePressed" }] : []);
    return snapshot(s).replace(/"reducedMotion":(true|false)/, "");
  };
  assert.equal(play(true), play(false));
});

// ---------- geometry ----------

test("a mid-run resize carries everything in flight with it", () => {
  const s = newGame({ width: 800, height: 600 });
  addEnemy(s, { type: "mett", col: 4, row: 1 });
  fire(s);
  step(s, 40, []);
  s.bolts.push({
    row: 0, x: C.panelRect(s.G, 5, 0).x + s.G.pw / 2, speed: s.G.pw / 150,
    kind: "slow", radius: s.G.pw * T.BOLT.slow.radiusFrac, heavy: true,
  });

  const before = s.G;
  const boltPanels = (s.bolts[0].x - before.gx) / before.pw;
  const bitPanels = (s.fx.bits[0].x - before.gx) / before.pw;

  const G = setLayout(s, 1200, 900);
  assert.notEqual(G.pw, before.pw, "the resize actually changed the geometry");
  assert.ok(Math.abs((s.bolts[0].x - G.gx) / G.pw - boltPanels) < 1e-9,
    "a bolt keeps its place on the board, not its pixel");
  assert.ok(Math.abs((s.fx.bits[0].x - G.gx) / G.pw - bitPanels) < 1e-9, "and so does debris");
  assert.equal(Number((s.bolts[0].speed / G.pw).toFixed(12)),
    Number((s.G.pw / 150 / G.pw).toFixed(12)), "and it still crosses a panel in the same time");
  assert.equal(Number((s.bolts[0].radius / G.pw).toFixed(12)),
    Number(T.BOLT.slow.radiusFrac.toFixed(12)),
    "and the head stays the same fraction of a panel — the renderer reads px");
});

test("setLayout leaves a same-size call alone", () => {
  const s = newGame({ width: 800, height: 600 });
  addEnemy(s, { type: "mett" });
  fire(s);
  step(s, 40, []);
  const before = snapshot(s);
  setLayout(s, 800, 600);
  assert.equal(snapshot(s), before);
});

// ---------- the tracer is not gated on mode ----------

test("a tracer in flight survives the stage gate that its own kill opened", () => {
  const s = newGame();
  s.deletions = C.STAGES[0].at - 1;
  s.waveIdx = C.STAGES[0].wave;
  addEnemy(s, { type: "mett", col: 5 });
  fire(s);
  assert.equal(s.mode, "interlevel", "the kill opened a gate");
  const rt = s.clock - s.fx.ray.t0;
  assert.ok(rt < s.fx.ray.dur, "and the tracer is still mid-flight");

  // the renderer must still draw it: same frame with and without the gate
  const gated = createCanvas(800, 600);
  draw(gated.getContext("2d"), s, s.clock);
  s.mode = "playing";
  const plain = createCanvas(800, 600);
  draw(plain.getContext("2d"), s, s.clock);
  assert.deepEqual(gated.toBuffer("image/png"), plain.toBuffer("image/png"));
});
