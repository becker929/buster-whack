// ONE HAND: the default mode, built for a phone in one hand. The board is the
// movement surface (swipe a step, tap a square), steps are rationed at half a
// charge with the next one held rather than dropped, and CLASSIC is retired
// from the menu but still answers to its name for the goldens.

import test from "node:test";
import assert from "node:assert/strict";
import { newGame, step, C, find, count } from "./helpers.mjs";
import { createState } from "../src/core/state.js";
import { clearArena, activeArena } from "../src/core/world.js";
import { createTouchMove } from "../src/shell/input.js";

function oneHand(seed = 1) {
  const s = newGame({ seed });
  step(s, 0, [{ type: "startRun", modeId: "onehand" }]);
  s.nextSpawnAt = Infinity;
  s.enemies.length = 0;
  return s;
}

/** Stage coordinates of the centre of world square (col,row) under the camera. */
function centre(s, col, row) {
  const G = s.G;
  return { x: G.gx + (col - s.cam) * G.pw + G.pw / 2, y: G.gy + row * G.ph + G.ph / 2 };
}
const tap = (s, col, row, dt = 0) => step(s, dt, [{ type: "tapAt", ...centre(s, col, row) }]);
const at = (s) => s.player.col + "," + s.player.row;

// ---------- the menu ----------

test("classic is retired: off the menu, still resolvable by name", () => {
  assert.ok(!C.MODES.some((m) => m.id === "classic"), "classic is not offered");
  assert.ok(C.RETIRED_MODES.some((m) => m.id === "classic"));
  const c = C.modeById("classic");
  assert.equal(c.id, "classic");
  assert.equal(c.advancing, false, "the retired rule set is intact for the goldens");
  assert.equal(C.modeById("no-such-mode").id, C.DEFAULT_MODE, "an unknown id falls back to the default");
  for (const m of C.MODES) {
    assert.ok(m.controls === "touch" || m.controls === "pad", m.id + " names a control scheme");
    assert.ok(m.moveMs > 0, m.id + " names a step ration");
  }
  assert.equal(C.modeById("onehand").controls, "touch");
  assert.equal(C.modeById("advance").controls, "pad");
});

test("the one-hand step ration is about half a charge", () => {
  const r = C.modeById("onehand").moveMs / C.CHARGE_MS;
  assert.ok(r >= 0.45 && r <= 0.55, "ration/charge = " + r);
  assert.equal(C.modeById("advance").moveMs, C.MOVE_REPEAT_MS, "the ring keeps its repeat rate");
});

// ---------- the ration ----------

test("a second step inside the ration is held, then taken when it ends", () => {
  const s = oneHand();
  step(s, 16, [{ type: "move", dc: 0, dr: -1 }]);
  assert.equal(at(s), "1,0");
  step(s, 16, [{ type: "move", dc: 0, dr: 1 }]);
  assert.equal(at(s), "1,0", "the second step waits");
  assert.deepEqual(s.queuedMove, { kind: "by", dc: 0, dr: 1 });
  step(s, C.TAP_MOVE_MS - 40, []);
  assert.equal(at(s), "1,0", "still inside the ration");
  const ev = step(s, 40, []);
  assert.equal(at(s), "1,1", "the held step lands the moment the ration ends");
  assert.equal(s.queuedMove, null);
  assert.ok(find(ev, "playerMoved"));
});

test("the latest ask wins, and a pause drops the held step", () => {
  const s = oneHand();
  step(s, 16, [{ type: "move", dc: 1, dr: 0 }]);
  step(s, 16, [{ type: "move", dc: 0, dr: -1 }, { type: "move", dc: 0, dr: 1 }]);
  assert.deepEqual(s.queuedMove, { kind: "by", dc: 0, dr: 1 });
  step(s, 0, [{ type: "pause" }]);
  step(s, 16, []);
  assert.equal(s.queuedMove, null, "a pause clears the queue");
  step(s, 0, [{ type: "pause" }]);
  step(s, C.TAP_MOVE_MS, []);
  assert.equal(at(s), "2,1", "nothing lands after the pause");
});

test("in advance a step inside the repeat window is dropped, as before", () => {
  const s = newGame();
  step(s, 0, [{ type: "startRun", modeId: "advance" }]);
  s.nextSpawnAt = Infinity; s.enemies.length = 0;
  step(s, 16, [{ type: "move", dc: 0, dr: -1 }]);
  step(s, 16, [{ type: "move", dc: 0, dr: 1 }]);
  assert.equal(s.queuedMove, null, "no queue outside one-hand");
  step(s, C.MOVE_REPEAT_MS, []);
  assert.equal(at(s), "1,0", "the dropped step never lands");
});

// ---------- taps ----------

test("a tap on a standable square goes there in one step, with a ripple", () => {
  const s = oneHand();
  const n0 = s.fx.ripples.length;
  const ev = tap(s, 2, 0, 16);
  assert.equal(at(s), "2,0", "two columns and a row away, in one step");
  assert.equal(count(ev, "playerMoved"), 1);
  assert.equal(s.fx.ripples.length, n0 + 1, "the square acknowledges the tap");
  assert.equal(s.fx.ripples.at(-1).col, 2);
});

test("a tap on an enemy square, off the board, or on your own square does nothing", () => {
  const s = oneHand();
  const t = s.lastMoveAt;
  tap(s, 4, 1, 16);
  assert.equal(at(s), "1,1", "enemy ground is not standable");
  step(s, 0, [{ type: "tapAt", x: -50, y: -50 }]);
  step(s, 0, [{ type: "tapAt", x: s.G.w + 10, y: s.G.gy }]);
  assert.equal(at(s), "1,1");
  tap(s, 1, 1);
  assert.equal(at(s), "1,1");
  assert.equal(s.lastMoveAt, t, "no ration is spent on a refused tap");
  assert.equal(s.queuedMove, null, "and nothing is queued for it");
});

test("a tap just above the top row still lands on the top row", () => {
  const s = oneHand();
  const c = centre(s, 1, 0);
  step(s, 16, [{ type: "tapAt", x: c.x, y: s.G.gy - s.G.ph * (C.TAP_SLACK - 0.05) }]);
  assert.equal(at(s), "1,0");
  const s2 = oneHand();
  step(s2, 16, [{ type: "tapAt", x: c.x, y: s2.G.gy - s2.G.ph * (C.TAP_SLACK + 0.2) }]);
  assert.equal(at(s2), "1,1", "further out than the slack is not a tap on the board");
});

test("a tap inside the ration is held and taken later, pickup included", () => {
  const s = oneHand();
  s.pickups.push({ col: 0, row: 0, kind: "bomb" });
  step(s, 16, [{ type: "move", dc: 1, dr: 0 }]);
  tap(s, 0, 0, 16);
  assert.equal(at(s), "2,1");
  assert.deepEqual(s.queuedMove, { kind: "to", col: 0, row: 0 });
  const ev = step(s, C.TAP_MOVE_MS, []);
  assert.equal(at(s), "0,0");
  assert.equal(s.bombs, 1, "the held step still walks onto the pickup");
  assert.ok(find(ev, "pickup"));
});

test("taps resolve through the camera, and never behind the left wall", () => {
  const s = oneHand();
  clearArena(s.world, s.rng);
  const next = activeArena(s.world);
  s.player.col = next.x0 + 1; s.player.row = 1;
  s.cam = next.x0; s.camAnchor = next.x0;
  step(s, 16, []);                                     // entering arms the arena
  if (s.mode === "interlevel") step(s, 0, [{ type: "resume" }]);
  s.nextSpawnAt = Infinity;
  tap(s, next.x0 + 2, 0, 16);
  assert.equal(at(s), (next.x0 + 2) + ",0", "the tapped square is the one under the thumb, scrolled");
  // a square that has scrolled off the left edge: standable ground, but gone
  step(s, C.TAP_MOVE_MS, []);
  step(s, 0, [{ type: "tapAt", x: s.G.gx - s.G.pw * 1.5, y: s.G.gy + s.G.ph * 0.5 }]);
  assert.equal(at(s), (next.x0 + 2) + ",0", "behind the wall is refused");
});

test("a tap across a narrow road's void is refused: the funnel must be walked", () => {
  const s = oneHand();
  clearArena(s.world, () => 0.1);                       // < NARROW_ROAD_CHANCE: one-row road
  const road = s.world.segs[1];
  assert.equal(road.rows, 1);
  s.player.col = 5; s.player.row = 0;
  tap(s, road.x0 + 1, 0, 16);
  assert.equal(at(s), "5,0", "void is not standable");
  tap(s, road.x0 + 1, 1, C.TAP_MOVE_MS);
  assert.equal(at(s), (road.x0 + 1) + ",1", "the road's own row is");
});

// ---------- the layout above the deck ----------

test("a bottom inset lifts the board clear of the deck and changes nothing without one", () => {
  const a = C.layout(800, 600), b = C.layout(800, 600, 0);
  for (const k of ["pw", "ph", "gx", "gy"]) assert.equal(a[k], b[k]);
  const c = C.layout(390, 700, 240);
  assert.ok(c.gy + c.ph * C.ROWS <= 700 - 240, "the board's foot is above the deck");
  assert.ok(c.gy >= 80, "and below the HUD");
  assert.equal(c.bottomInset, 240);
});

// ---------- the shell's swipe / tap tracker ----------

test("a drag steps in its dominant direction and keeps stepping as it goes", () => {
  const seen = [];
  const m = createTouchMove((i) => seen.push(i));
  assert.equal(m.down(7, 100, 100), true);
  m.move(7, 110, 104);                                  // under the swipe threshold
  assert.deepEqual(seen, []);
  m.move(7, 140, 104);                                  // right
  assert.deepEqual(seen, [{ type: "move", dc: 1, dr: 0 }]);
  m.move(7, 150, 150);                                  // down, from the new anchor
  assert.deepEqual(seen.at(-1), { type: "move", dc: 0, dr: 1 });
  m.up(7, 150, 150);
  assert.equal(seen.length, 2, "lifting after a swipe is not a tap");
  assert.equal(m.pointer, null);
});

test("a press and lift without a swipe is a tap, in stage coordinates", () => {
  const seen = [];
  const m = createTouchMove((i) => seen.push(i));
  m.down(3, 40, 60);
  m.move(3, 45, 58);
  m.up(3, 45, 58);
  assert.deepEqual(seen, [{ type: "tapAt", x: 45, y: 58 }]);
});

test("the board reads one finger only, and a cancelled one never taps", () => {
  const seen = [];
  const m = createTouchMove((i) => seen.push(i));
  m.down(1, 0, 0);
  assert.equal(m.down(2, 0, 0), false, "a second finger is ignored");
  m.move(2, 300, 0);
  m.up(2, 300, 0);
  assert.deepEqual(seen, [], "the second finger neither swiped nor tapped");
  m.cancel(1);
  assert.equal(m.pointer, null);
  m.up(1, 0, 0);
  assert.deepEqual(seen, [], "no tap for a finger the browser took away");
});
