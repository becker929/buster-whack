// The HUD's presentation contract, asserted against real pixels.
//
// The in-play HUD lost its live score, its footer strip and its overclock
// readout; what is left has to carry the same information as shape. These
// tests read the frame back out of the canvas rather than trusting the
// drawing code: how many pips the bar has, how many a hit costs, that the
// level announcement is a real transient, and that the new detonation and
// damage effects stay deterministic and respect `reducedMotion`.

import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { draw } from "../src/shell/render.js";
import * as C from "../src/core/constants.js";
import { newGame, addEnemy, fire, fireCharged, step, setLayout } from "./helpers.mjs";

const BAR_Y = 72;   // the middle of the pip bar, in CSS px from the top

function frame(state, w = 900, h = 640, now = state.clock) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  draw(ctx, state, now);
  return { canvas, ctx };
}

/**
 * Runs of "filled pip" pixels along the bar's centre line.
 *
 * Only fully opaque pixels count. The canvas is transparent where nothing has
 * been drawn — the CSS field colour shows through in the browser — so an
 * unpainted gap between two pips reports the colour of whatever full-screen
 * wash was laid over it, and would otherwise read as a pip of its own.
 */
function pipRuns(ctx, w, match) {
  const px = ctx.getImageData(0, BAR_Y, w, 1).data;
  let runs = 0, inRun = false;
  for (let x = 0; x < w; x++) {
    const i = x * 4;
    const on = px[i + 3] === 255 && match(px[i], px[i + 1], px[i + 2]);
    if (on && !inRun) runs++;
    inRun = on;
  }
  return runs;
}

const cyan = (r, g, b) => r < 130 && g > 180 && b > 180;
const red = (r, g, b) => r > 190 && g < 130 && b > 70 && b < 160;

function playing(opts = {}) {
  const s = newGame({ seed: 5, width: opts.width || 900, height: opts.height || 640 });
  setLayout(s, opts.width || 900, opts.height || 640);
  s.timeLeft = opts.timeLeft === undefined ? C.TIME_CAP : opts.timeLeft;
  return s;
}

test("the time bar is drawn as discrete pips, one per 1.25s of the cap", () => {
  const s = playing();
  const { ctx } = frame(s);
  assert.equal(pipRuns(ctx, 900, cyan), Math.round(C.TIME_CAP / 1.25),
    "a full clock fills every pip, and each one is its own run of pixels");
});

test("a hit costs a countable number of pips", () => {
  const before = playing({ timeLeft: 30 });
  const after = playing({ timeLeft: 30 - C.HIT_TIME_PENALTY });
  const a = pipRuns(frame(before).ctx, 900, cyan);
  const b = pipRuns(frame(after).ctx, 900, cyan);
  assert.equal(a - b, 2, "HIT_TIME_PENALTY is exactly two pips wide");
});

test("the pips a hit cost are shown where they used to be, then let go", () => {
  const hurt = playing({ timeLeft: 27.5 });
  hurt.fx.hurtT0 = hurt.clock;
  const fresh = pipRuns(frame(hurt).ctx, 900, red);
  assert.equal(fresh, 2, "two red ghosts sit past the head of the bar");

  const later = frame(hurt, 900, 640, hurt.clock + 900);
  assert.equal(pipRuns(later.ctx, 900, red), 0, "and they are gone half a second later");
});

test("pips coarsen rather than shrink below legibility on a narrow stage", () => {
  const wide = playing();
  const narrow = playing({ width: 300, height: 560 });
  assert.equal(pipRuns(frame(wide).ctx, 900, cyan), 36);
  assert.equal(pipRuns(frame(narrow, 300, 560).ctx, 300, cyan), 18,
    "300px steps to the 2.5s rung: half as many pips, still countable");
});

test("the level announces itself on the frame it changes, and not later", () => {
  const s = newGame({ seed: 9 });
  setLayout(s, 900, 640);
  s.deletions = 9;                       // the next deletion crosses into level 3
  addEnemy(s, { col: 4, row: 1 });
  fire(s, 16);
  for (let i = 0; i < 12; i++) step(s, 16, []);
  assert.equal(s.deletions, 10, "the kill landed");

  const announcing = frame(s).canvas.toBuffer("image/png");
  // …and the same state a second later, with the announcement expired
  const settled = frame(s, 900, 640, s.clock + 1000).canvas.toBuffer("image/png");
  assert.notDeepEqual(announcing, settled,
    "the level marker is a transient, not a static label");
});

test("a detonation is deterministic and damped by reducedMotion", () => {
  const s = newGame({ seed: 13 });
  setLayout(s, 900, 640);
  addEnemy(s, { col: 5, row: 1, type: "rare" });
  fireCharged(s, 16);
  for (let i = 0; i < 9; i++) step(s, 16, []);
  assert.ok(s.enemies.some((e) => e.state === "hit"), "something is exploding");

  const a = frame(s).canvas.toBuffer("image/png");
  const b = frame(s).canvas.toBuffer("image/png");
  assert.deepEqual(a, b, "the same state and time draw byte-identically");

  s.reducedMotion = true;
  const damped = frame(s).canvas.toBuffer("image/png");
  assert.notDeepEqual(a, damped, "reducedMotion changes the full-screen wash");
});

test("taking a hit reads differently under reducedMotion", () => {
  const s = playing({ timeLeft: 20 });
  s.fx.hurtT0 = s.clock;
  s.hurtUntil = s.clock + C.HIT_IFRAME_MS;
  const full = frame(s).canvas.toBuffer("image/png");
  s.reducedMotion = true;
  const damped = frame(s).canvas.toBuffer("image/png");
  assert.notDeepEqual(full, damped, "the tear and the wash are damped");
});

test("bolts draw from the newer per-kind fields and from none at all", () => {
  const s = playing({ timeLeft: 20 });
  const lane = (row) => C.panelRect(s.G, 4, row).x;
  s.bolts.push(
    { row: 0, x: lane(0), speed: 1.4, kind: "fast", radius: 9 },
    { row: 1, x: lane(1) },                                   // nothing but row+x
    { row: 2, x: lane(2), speed: 0.4, kind: "heavy", radius: 15 }
  );
  const a = frame(s).canvas.toBuffer("image/png");
  const b = frame(s).canvas.toBuffer("image/png");
  assert.ok(a.length > 1000, "a frame came out");
  assert.deepEqual(a, b, "still deterministic with the new fields present");

  // the two kinds must not draw the same thing in the same place
  const fastOnly = playing({ timeLeft: 20 });
  fastOnly.bolts.push({ row: 1, x: lane(1), speed: 1.4, kind: "fast", radius: 9 });
  const heavyOnly = playing({ timeLeft: 20 });
  heavyOnly.bolts.push({ row: 1, x: lane(1), speed: 0.4, kind: "heavy", radius: 15 });
  assert.notDeepEqual(
    frame(fastOnly).canvas.toBuffer("image/png"),
    frame(heavyOnly).canvas.toBuffer("image/png"),
    "a fast needle and a slow orb are not the same sprite"
  );
});

test("the renderer's source names no DOM at all", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/shell/render.js", import.meta.url)), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [
    "document", "window", "matchMedia", "getElementById", "querySelector",
    "getBoundingClientRect", "localStorage", "devicePixelRatio", "requestAnimationFrame",
  ]) {
    assert.ok(!code.includes(forbidden), `render.js must not mention ${forbidden}`);
  }
  assert.ok(!code.includes("Math.random"), "jitter comes from the core's seeded rng, never here");
});
