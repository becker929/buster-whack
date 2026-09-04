// The difficulty curve: the clock is the road's pressure, and it has a shape.
//
// The road used to hand out more pulse than it charged, so the bar sat pinned
// at its cap for the first thirty arenas and the game had no tension until
// return fire arrived. These tests pin the two mechanisms that fixed it --
// a drain that rises with distance, and a road economy that does not also
// decay by kill count -- and the arcade behaviour they must not disturb.

import test from "node:test";
import assert from "node:assert/strict";
import { T } from "./helpers.mjs";
import { defaultTuning, resolveTuning } from "../src/core/tuning.js";

test("the drain rises with the road and then levels off", () => {
  assert.equal(T.drainRate(0), T.DRAIN_BASE, "arena zero costs the base rate");
  assert.ok(T.drainRate(20) > T.drainRate(0), "the road breathes harder as it goes");
  assert.ok(T.drainRate(40) > T.drainRate(20));
  assert.equal(T.drainRate(500), T.DRAIN_MAX, "and stops rising, so distance alone never kills");
  assert.equal(T.drainRate(-5), T.DRAIN_BASE, "never below the base");
  // it must saturate somewhere on the road, not past its end
  const saturates = Math.ceil((T.DRAIN_MAX - T.DRAIN_BASE) / T.DRAIN_PER_ARENA);
  assert.ok(saturates > 0 && saturates < T.ROAD_END, "the ceiling is reached on the road, at arena " + saturates);
});

test("the road pays on its own scale, and does not decay twice", () => {
  const deep = T.OC_START + 400;
  assert.equal(T.pulseScale(0, true), T.ROAD_PULSE);
  assert.equal(T.pulseScale(deep, true), T.ROAD_PULSE, "distance is the road's axis, not the kill count");
  assert.ok(T.ROAD_PULSE < 1, "the road pays less per kill than the arcade did");
});

test("the arcade economy is exactly what it shipped with", () => {
  assert.equal(T.pulseScale(0, false), 1);
  assert.equal(T.pulseScale(T.OC_START - 1, false), 1, "nothing decays before overclock");
  assert.equal(T.pulseScale(T.OC_START + 10, false), Math.pow(T.OC_SLOPE, 10));
  assert.equal(T.bonusFactor(T.OC_START + 10), Math.pow(T.OC_SLOPE, 10), "and it still falls away without a floor");
});

test("an arena costs more pulse than the one before it, all else equal", () => {
  // the same fight, ten arenas apart: the later one is dearer
  const fight = 5;                                    // seconds under pressure
  const early = fight * T.drainRate(5), late = fight * T.drainRate(35);
  assert.ok(late > early * 1.15, "a late arena costs at least 15% more to stand in");
});

test("the curve is data: an override moves it and the ramps follow", () => {
  const t = resolveTuning({ DRAIN_BASE: 1.5, DRAIN_PER_ARENA: 0, DRAIN_MAX: 2, ROAD_PULSE: 0.8 });
  assert.equal(t.drainRate(0), 1.5);
  assert.equal(t.drainRate(90), 1.5, "a flat ramp stays flat");
  assert.equal(t.pulseScale(0, true), 0.8);
  assert.notEqual(t.version, "default");
  // and the shipped set is untouched by that
  assert.equal(defaultTuning().drainRate(0), T.DRAIN_BASE);
});
