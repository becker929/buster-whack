// Proves hard constraint #1: the renderer draws against a bare
// CanvasRenderingContext2D with no jsdom, no document and no window anywhere.
// A later headless golden-frame harness relies on exactly this.

import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { createState, setLayout } from "../src/core/state.js";
import { step } from "../src/core/step.js";
import { draw } from "../src/shell/render.js";
import { snapshot } from "./helpers.mjs";

function playedState(seed = 21, frames = 400) {
  const s = createState({ seed, width: 800, height: 600 });
  step(s, 0, [{ type: "startRun" }]);
  for (let i = 0; i < frames; i++) {
    const actions = [];
    if (i % 6 === 0) actions.push({ type: "firePressed" });
    if (i % 6 === 3) actions.push({ type: "fireReleased" });
    if (i % 17 === 0) actions.push({ type: "move", dc: 0, dr: 1 });
    if (i % 3 === 0) actions.push({ type: "resume" });
    step(s, 16, actions);
  }
  return s;
}

test("no DOM globals exist in this process", () => {
  assert.equal(typeof globalThis.document, "undefined");
  assert.equal(typeof globalThis.window, "undefined");
});

test("draw() renders a frame to a plain 2D context", () => {
  const canvas = createCanvas(800, 600);
  const ctx = canvas.getContext("2d");
  const s = playedState();
  assert.ok(s.enemies.length + s.fx.popups.length > 0, "there is something to draw");
  draw(ctx, s, s.clock);
  const png = canvas.toBuffer("image/png");
  assert.ok(png.length > 1000, "a real frame came out");
});

test("draw() is deterministic and leaves the state alone", () => {
  const s = playedState(33);
  const before = snapshot(s);

  const a = createCanvas(800, 600);
  draw(a.getContext("2d"), s, s.clock);
  const b = createCanvas(800, 600);
  draw(b.getContext("2d"), s, s.clock);

  assert.equal(snapshot(s), before, "rendering must not mutate the state");
  assert.deepEqual(a.toBuffer("image/png"), b.toBuffer("image/png"),
    "the same state and time must produce byte-identical frames");
});

test("geometry comes from plain numbers, not from a measured element", () => {
  const s = playedState(7, 120);
  const G = setLayout(s, 1024, 768);
  assert.equal(G.w, 1024);
  assert.ok(G.pw > 0 && G.ph > 0);
  const canvas = createCanvas(1024, 768);
  draw(canvas.getContext("2d"), s, s.clock);
  assert.ok(canvas.toBuffer("image/png").length > 1000);
});

test("every mode and overlay path draws without a DOM", () => {
  const canvas = createCanvas(800, 600);
  const ctx = canvas.getContext("2d");
  for (const mode of ["ready", "playing", "interlevel", "over"]) {
    const s = playedState(5, 200);
    s.mode = mode;
    draw(ctx, s, s.clock);
  }
  const paused = playedState(5, 200);
  paused.paused = true;
  draw(ctx, paused, paused.clock);

  const hurt = playedState(5, 200);
  hurt.fx.hurtT0 = hurt.clock;              // shake + flash path
  draw(ctx, hurt, hurt.clock);
});
