// ONE HAND: the default mode, built for a phone in one hand. The board is the
// movement surface (a floating stick under the thumb, or a tap on a square),
// steps are rationed at half a charge with the next one held rather than
// dropped, and CLASSIC is retired from the menu but still answers to its name
// for the goldens.

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

// A hop takes time: the square changes at the top of the arc (HOP_COMMIT_MS)
// and the next step is allowed a ration (TAP_MOVE_MS) after the last began.
const commit = (s) => step(s, C.HOP_COMMIT_MS, []);
const ration = (s) => step(s, C.TAP_MOVE_MS, []);

// ---------- the ration ----------

test("a second step inside the ration is held, then taken when it ends", () => {
  const s = oneHand();
  step(s, 16, [{ type: "move", dc: 0, dr: -1 }]);
  assert.ok(s.hop, "the first step is a hop in flight");
  assert.equal(at(s), "1,1", "not there yet");
  commit(s);
  assert.equal(at(s), "1,0", "the square changes at the top of the arc");
  step(s, 16, [{ type: "move", dc: 0, dr: 1 }]);
  assert.equal(at(s), "1,0", "the second step waits");
  assert.deepEqual(s.queuedMove, { kind: "by", dc: 0, dr: 1 });
  step(s, C.TAP_MOVE_MS - C.HOP_COMMIT_MS - 40 - 16, []);
  assert.equal(at(s), "1,0", "still inside the ration");
  assert.equal(s.queuedMove !== null, true);
  step(s, 40, []);
  assert.equal(s.queuedMove, null, "the held step starts the moment the ration ends");
  assert.ok(s.hop && s.hop.toRow === 1);
  commit(s);
  assert.equal(at(s), "1,1");
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
  ration(s); ration(s);
  assert.equal(at(s), "2,1", "only the first step ever landed");
});

test("in advance a step inside the repeat window is dropped, as before, and lands at once", () => {
  const s = newGame();
  step(s, 0, [{ type: "startRun", modeId: "advance" }]);
  s.nextSpawnAt = Infinity; s.enemies.length = 0;
  step(s, 16, [{ type: "move", dc: 0, dr: -1 }]);
  assert.equal(at(s), "1,0", "ring modes step on the spot");
  assert.equal(s.hop, null);
  step(s, 16, [{ type: "move", dc: 0, dr: 1 }]);
  assert.equal(s.queuedMove, null, "no queue outside one-hand");
  step(s, C.MOVE_REPEAT_MS, []);
  assert.equal(at(s), "1,0", "the dropped step never lands");
});

// ---------- taps ----------

test("a tap on the square beside you is one hop, with a ripple", () => {
  const s = oneHand();
  const n0 = s.fx.ripples.length;
  const ev = tap(s, 2, 1, 16);
  assert.ok(find(ev, "hop"));
  assert.equal(s.fx.ripples.length, n0 + 1, "the square acknowledges the tap");
  assert.equal(s.fx.ripples.at(-1).col, 2);
  commit(s);
  assert.equal(at(s), "2,1");
  assert.equal(s.path, null, "arrived: nothing left to walk");
});

test("a tap further away walks there one square at a time, never diagonally", () => {
  const s = oneHand();
  tap(s, 2, 0, 16);                                    // two columns... one column and one row away
  assert.deepEqual(s.path, { col: 2, row: 0 });
  assert.ok(s.hop, "the first hop starts at once");
  const h = s.hop;
  assert.equal(Math.abs(h.toCol - h.fromCol) + Math.abs(h.toRow - h.fromRow), 1, "one square");
  commit(s);
  assert.notEqual(at(s), "2,0", "not there yet");
  ration(s);                                           // the second hop starts at the ration
  commit(s);
  assert.equal(at(s), "2,0", "arrived after two rations");
  assert.equal(s.path, null);
  const s2 = oneHand();
  tap(s2, 0, 0, 16);
  let hops = 1;
  for (let i = 0; i < 6 && s2.path; i++) { ration(s2); if (s2.hop) hops++; }
  assert.equal(at(s2), "0,0");
  assert.equal(hops, 2, "two squares away is two hops");
});

test("a stick push replaces a path being walked; a hit stops it", () => {
  const s = oneHand();
  s.player.col = 0; s.player.row = 0;
  tap(s, 2, 2, 16);                                    // a long walk: four hops
  assert.ok(s.path);
  ration(s);
  step(s, 16, { actions: [], hold: { dc: 0, dr: 1 } });
  assert.equal(s.path, null, "the stick is a new directive");
  const s2 = oneHand();
  s2.player.col = 0; s2.player.row = 0;
  tap(s2, 2, 2, 16);
  assert.ok(s2.path);
  s2.hurtUntil = -1e9;
  s2.bolts.push({ row: s2.player.row, x: s2.G.gx + s2.G.pw * (s2.player.col + 0.5), speed: 0, heavy: false, kind: "slow" });
  for (let i = 0; i < 6 && s2.path; i++) step(s2, 16, []);
  assert.equal(s2.path, null, "a hit is the world's directive");
});

test("a tap on an enemy square, off the board, or on your own square does nothing", () => {
  const s = oneHand();
  const t = s.lastMoveAt;
  tap(s, 4, 1, 16);
  assert.equal(s.hop, null, "enemy ground is not standable");
  step(s, 0, [{ type: "tapAt", x: -50, y: -50 }]);
  step(s, 0, [{ type: "tapAt", x: s.G.w + 10, y: s.G.gy }]);
  tap(s, 1, 1);
  assert.equal(s.hop, null);
  assert.equal(at(s), "1,1");
  assert.equal(s.lastMoveAt, t, "no ration is spent on a refused tap");
  assert.equal(s.queuedMove, null, "and nothing is queued for it");
  assert.equal(s.path, null);
});

test("a tap just above the top row still lands on the top row", () => {
  const s = oneHand();
  const c = centre(s, 1, 0);
  step(s, 16, [{ type: "tapAt", x: c.x, y: s.G.gy - s.G.ph * (C.TAP_SLACK - 0.05) }]);
  commit(s);
  assert.equal(at(s), "1,0");
  const s2 = oneHand();
  step(s2, 16, [{ type: "tapAt", x: c.x, y: s2.G.gy - s2.G.ph * (C.TAP_SLACK + 0.2) }]);
  commit(s2);
  assert.equal(at(s2), "1,1", "further out than the slack is not a tap on the board");
});

test("a tap inside the ration is held and taken later, pickup included", () => {
  const s = oneHand();
  s.pickups.push({ col: 0, row: 1, kind: "bomb" });
  step(s, 16, [{ type: "move", dc: 1, dr: 0 }]);
  tap(s, 0, 1, 16);
  assert.deepEqual(s.queuedMove, { kind: "to", col: 0, row: 1 });
  ration(s);                                           // the queue lays the path and hops back
  assert.equal(s.queuedMove, null);
  for (let i = 0; i < 4 && (s.path || s.hop); i++) ration(s);
  assert.equal(at(s), "0,1");
  assert.equal(s.bombs, 1, "the walk still takes the pickup");
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
  tap(s, next.x0 + 2, 1, 16);
  commit(s);
  assert.equal(at(s), (next.x0 + 2) + ",1", "the tapped square is the one under the thumb, scrolled");
  ration(s);
  step(s, 0, [{ type: "tapAt", x: s.G.gx - s.G.pw * 1.5, y: s.G.gy + s.G.ph * 1.5 }]);
  assert.equal(s.path, null, "behind the wall is refused");
  assert.equal(s.hop, null);
});

test("a tap across a narrow road's void is refused: the funnel must be walked", () => {
  const s = oneHand();
  clearArena(s.world, () => 0.1);                       // < NARROW_ROAD_CHANCE: one-row road
  const road = s.world.segs[1];
  assert.equal(road.rows, 1);
  s.player.col = 5; s.player.row = 1;
  tap(s, road.x0 + 1, 0, 16);
  assert.equal(s.hop, null, "void is not standable");
  tap(s, road.x0 + 1, 1, C.TAP_MOVE_MS);
  assert.deepEqual(s.path, { col: road.x0 + 1, row: 1 }, "the road's own row is");
});

// ---------- the board as a stick ----------

test("a held stick walks at the ration, not the ring's repeat rate", () => {
  const s = oneHand();
  s.player.col = 0; s.player.row = 1;
  s.lastMoveAt = -1e9;
  const hold = { dc: 1, dr: 0 };
  step(s, 16, { actions: [], hold });
  assert.ok(s.hop && s.hop.toCol === 1, "the first hop starts at once");
  commit(s);
  assert.equal(at(s), "1,1");
  step(s, C.MOVE_REPEAT_MS, { actions: [], hold });
  assert.equal(at(s), "1,1", "past the ring's repeat window nothing more happens");
  step(s, C.TAP_MOVE_MS, { actions: [], hold });
  commit(s);
  assert.equal(at(s), "2,1", "the second hop lands a ration later");
  // a flick: held for one frame inside the ration still lands its one step
  step(s, 16, { actions: [], hold: { dc: 0, dr: -1 } });
  assert.equal(at(s), "2,1");
  ration(s); commit(s);
  assert.equal(at(s), "2,0", "the flick's step lands when the ration ends");
  ration(s); ration(s);
  assert.equal(at(s), "2,0", "and a centred stick walks nowhere");
});

test("a flick with the ration ready is one step, not one now and one later", () => {
  const s = oneHand();
  s.player.col = 0; s.player.row = 1;
  s.lastMoveAt = -1e9;
  const hold = { dc: 1, dr: 0 };
  for (let i = 0; i < 4; i++) step(s, 16, { actions: [], hold });   // a 64ms flick
  assert.ok(s.hop, "the flick hopped once, immediately");
  assert.equal(s.queuedMove, null, "and did not also queue a second for the lift");
  ration(s); ration(s);
  assert.equal(at(s), "1,1");
  // rocking to a new direction inside the ration is a new push: its step is held
  step(s, 16, { actions: [], hold: { dc: 1, dr: 0 } });
  step(s, 16, { actions: [], hold: { dc: 0, dr: -1 } });
  ration(s); ration(s); ration(s);
  assert.equal(at(s), "2,0", "the first push stepped at once; the rocked direction landed after the ration");
});

test("a diagonal press hops along one axis only", () => {
  const s = oneHand();
  step(s, 16, [{ type: "move", dc: 1, dr: -1 }]);
  const h = s.hop;
  assert.ok(h);
  assert.equal(Math.abs(h.toCol - h.fromCol) + Math.abs(h.toRow - h.fromRow), 1);
});

// ---------- the shell's stick / tap tracker ----------

test("pushing the stick holds one direction until it centres or lifts", () => {
  const m = createTouchMove(() => { throw new Error("no intent expected"); });
  assert.equal(m.hold(), null);
  assert.equal(m.down(7, 100, 100), true);
  m.move(7, 110, 104);                                  // inside the dead zone
  assert.equal(m.hold(), null);
  m.move(7, 140, 104);                                  // pushed right
  assert.deepEqual(m.hold(), { dc: 1, dr: 0 });
  m.move(7, 200, 104);                                  // further out: still just right
  assert.deepEqual(m.hold(), { dc: 1, dr: 0 });
  m.move(7, 130, 135);                                  // a diagonal push reads the larger axis
  assert.deepEqual(m.hold(), { dc: 0, dr: 1 });
  m.move(7, 100, 60);                                   // up
  assert.deepEqual(m.hold(), { dc: 0, dr: -1 });
  m.move(7, 105, 98);                                   // back to centre
  assert.equal(m.hold(), null, "centring releases the direction");
  m.move(7, 100, 160);
  assert.deepEqual(m.hold(), { dc: 0, dr: 1 });
  assert.equal(m.up(7, 100, 160), false, "a lift after a push is not a tap");
  assert.equal(m.hold(), null);
  assert.equal(m.pointer, null);
});

// ---------- the layout above the deck ----------

test("a bottom inset rests the board on the deck and changes nothing without one", () => {
  const a = C.layout(800, 600), b = C.layout(800, 600, 0);
  for (const k of ["pw", "ph", "gx", "gy"]) assert.equal(a[k], b[k]);
  const c = C.layout(390, 700, 240);
  assert.equal(c.gy + c.ph * C.ROWS, 700 - 240, "the board's foot is exactly the deck's top edge");
  assert.ok(c.gy >= 80 + 54 + 12, "and there is room for the HUD and the BOMB bar above it");
  assert.equal(c.bottomInset, 240);
});

test("a press and lift without a push is a tap, in stage coordinates", () => {
  const seen = [];
  const m = createTouchMove((i) => seen.push(i));
  m.down(3, 40, 60);
  m.move(3, 45, 58);
  m.up(3, 45, 58);
  assert.deepEqual(seen, [{ type: "tapAt", x: 45, y: 58 }]);
});

test("a finger planted off the board (on FIRE) steers but never taps a square", () => {
  const seen = [];
  const m = createTouchMove((i) => seen.push(i));
  m.down(9, 200, 700, false);            // landed on FIRE, mid-charge
  m.move(9, 200, 640);                   // push up
  assert.deepEqual(m.hold(), { dc: 0, dr: -1 }, "the stick works from FIRE");
  m.up(9, 200, 640);
  assert.deepEqual(seen, [], "a lift after a push is not a tap");
  m.down(9, 200, 700, false);
  assert.equal(m.up(9, 202, 701), false, "a plain lift on FIRE is FIRE's release, not a tap");
  assert.deepEqual(seen, []);
});

test("a board finger takes the stick from a thumb resting on FIRE, never from one pushing", () => {
  const seen = [];
  const m = createTouchMove((i) => seen.push(i));
  m.down(1, 200, 700, false);            // thumb on FIRE, idle
  assert.equal(m.down(2, 100, 300), true, "the board finger takes over");
  m.move(1, 200, 600);
  assert.equal(m.hold(), null, "the FIRE thumb no longer steers");
  m.move(2, 160, 300);
  assert.deepEqual(m.hold(), { dc: 1, dr: 0 });
  m.up(2, 160, 300);
  m.down(2, 100, 300); m.up(2, 100, 300);
  assert.deepEqual(seen, [{ type: "tapAt", x: 100, y: 300 }], "and its taps land");
  m.down(1, 200, 700, false);
  m.move(1, 200, 600);                   // now the FIRE thumb is pushing
  assert.equal(m.down(3, 100, 300), false, "a pushing stick is not taken");
  assert.deepEqual(m.hold(), { dc: 0, dr: -1 });
  m.up(1, 200, 600);
  m.down(4, 100, 300);                   // board first
  assert.equal(m.down(5, 200, 700, false), false, "FIRE never takes the stick from the board");
});

test("the board reads one finger only, and a cancelled one never taps", () => {
  const seen = [];
  const m = createTouchMove((i) => seen.push(i));
  m.down(1, 0, 0);
  assert.equal(m.down(2, 0, 0), false, "a second finger is ignored");
  m.move(2, 300, 0);
  assert.equal(m.hold(), null, "the second finger cannot push the stick");
  m.up(2, 300, 0);
  assert.deepEqual(seen, [], "nor tap");
  m.move(1, 300, 0);
  assert.deepEqual(m.hold(), { dc: 1, dr: 0 });
  m.cancel(1);
  assert.equal(m.hold(), null, "a cancel centres the stick");
  assert.equal(m.pointer, null);
  m.up(1, 0, 0);
  assert.deepEqual(seen, [], "no tap for a finger the browser took away");
});
