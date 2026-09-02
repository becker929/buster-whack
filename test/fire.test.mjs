// The fire button's press/release latch, from both ends.
//
// `createFireLatch` is the shell half: it decides *whose* release counts, which
// is what stops a d-pad drag, a pause tap or a stray thumb from spending a held
// charge. `fireReleased` is the core half: it refuses a release when nothing was
// pressed, so the same confusion cannot be reintroduced by another shell.
//
// The DOM plumbing that connects the two is proved in test/browser/touch.mjs,
// which drives real multi-touch through a real Chromium.

import test from "node:test";
import assert from "node:assert/strict";
import { newGame, addEnemy, step, typesOf, count, C } from "./helpers.mjs";
import { createFireLatch } from "../src/shell/input.js";

/** A latch wired to a recording dispatch. */
function latchOf() {
  const seen = [];
  const latch = createFireLatch((intent) => seen.push(intent.type));
  return { latch, seen, drain: () => seen.splice(0, seen.length) };
}

// ---------- the shell latch ----------

test("a press latches, and only the same source can release it", () => {
  const { latch, drain } = latchOf();

  assert.equal(latch.press(3), true);
  assert.deepEqual(drain(), ["firePressed"]);
  assert.equal(latch.holder, 3);

  // a different pointer lifting anywhere on the page
  assert.equal(latch.release(9), false);
  assert.deepEqual(drain(), []);
  assert.equal(latch.holder, 3, "still held");

  assert.equal(latch.release(3), true);
  assert.deepEqual(drain(), ["fireReleased"]);
  assert.equal(latch.holder, null);
});

test("pointer id 0 is a real pointer, not an absent one", () => {
  const { latch, drain } = latchOf();
  assert.equal(latch.press(0), true);
  assert.equal(latch.holder, 0);
  assert.equal(latch.release(1), false);
  assert.equal(latch.release(0), true);
  assert.deepEqual(drain(), ["firePressed", "fireReleased"]);
});

test("the keyboard and pointers cannot release each other", () => {
  // Space held, then a thumb lifts off the ring
  const a = latchOf();
  a.latch.press("key");
  a.drain();
  assert.equal(a.latch.release(2), false, "a pointer must not release a Space charge");
  assert.deepEqual(a.drain(), []);
  assert.equal(a.latch.release("key"), true);

  // FIRE held with a thumb, then a stray keyup arrives
  const b = latchOf();
  b.latch.press(2);
  b.drain();
  assert.equal(b.latch.release("key"), false, "a keyup must not release a touch charge");
  assert.deepEqual(b.drain(), []);
  assert.equal(b.latch.release(2), true);
});

test("a second source pressing while one holds is ignored, and cannot steal the release", () => {
  const { latch, drain } = latchOf();
  latch.press(1);
  drain();
  assert.equal(latch.press(2), false, "the second finger does not re-press");
  assert.deepEqual(drain(), [], "and dispatches nothing");
  assert.equal(latch.holder, 1);
  assert.equal(latch.release(2), false, "nor can it release");
  assert.equal(latch.release(1), true);
});

test("a release with nothing held is silent", () => {
  const { latch, drain } = latchOf();
  assert.equal(latch.release(1), false);
  assert.equal(latch.release("key"), false);
  assert.equal(latch.releaseAny(), false);
  assert.deepEqual(drain(), [], "no phantom fireReleased reaches the core");
});

test("releaseAny lets go whoever was holding — blur must never strand the player", () => {
  for (const src of [4, "key"]) {
    const { latch, drain } = latchOf();
    latch.press(src);
    drain();
    assert.equal(latch.releaseAny(), true);
    assert.deepEqual(drain(), ["fireReleased"]);
    assert.equal(latch.holder, null, "and the button can be pressed again");
    assert.equal(latch.press(src), true);
  }
});

test("an undefined source can never latch the button", () => {
  // A synthetic event with no pointerId must not wedge the game shut.
  const { latch, drain } = latchOf();
  assert.equal(latch.press(undefined), false);
  assert.equal(latch.holder, null);
  assert.deepEqual(drain(), []);
  assert.equal(latch.press(1), true, "a real pointer still works afterwards");
});

// ---------- the core half ----------

test("a release with nothing pressed is a no-op in the core too", () => {
  // The core cannot know *whose* release this is — that is the shell latch's
  // job — but it does know whether anything is being held. `canFire` is exactly
  // that flag, so a release arriving with the button already up is not ours.
  const s = newGame();
  addEnemy(s, { type: "mett", col: 3, row: 1 });
  assert.equal(s.canFire, true, "nothing is held at the start of a run");

  const cold = step(s, 16, [{ type: "fireReleased" }, { type: "fireReleased" }]);
  assert.equal(count(cold, "shot"), 0, "a release out of nowhere fires nothing");
  assert.equal(s.shots, 0);
  assert.equal(s.canFire, true);
  assert.equal(s.charge.downAt, null);
});

test("extra releases behind the real one cannot double-fire a charge", () => {
  const s = newGame();
  addEnemy(s, { type: "mett", col: 3, row: 1 });

  step(s, 0, [{ type: "firePressed" }]);     // normal shot + charge starts
  step(s, C.CHARGE_MS + 20, []);
  assert.equal(s.charge.full, true);
  assert.equal(s.canFire, false);
  const shots = s.shots;

  const real = step(s, 16, [{ type: "fireReleased" }]);
  assert.equal(count(real, "shot"), 1);
  assert.equal(real.find((e) => e.type === "shot").tier, "charged");
  assert.equal(s.canFire, true);

  // every straggler behind it — a window pointerup, a keyup, a pointercancel
  const extra = step(s, 16, [{ type: "fireReleased" }, { type: "fireReleased" }]);
  assert.equal(count(extra, "shot"), 0, "no second charged shot escapes");
  assert.equal(s.shots, shots + 1);
});

test("the press/charge/release cycle still works, repeatedly", () => {
  const s = newGame();
  for (let i = 0; i < 3; i++) {
    addEnemy(s, { type: "mett", col: 3, row: 1 });
    const down = step(s, 0, [{ type: "firePressed" }]);
    assert.equal(typesOf(down).filter((t) => t === "shot").length, 1, "press fires immediately");
    assert.equal(s.canFire, false);

    const held = step(s, C.CHARGE_MS + 20, []);
    assert.ok(typesOf(held).includes("chargeReady"), "the charge announces itself once");

    const up = step(s, 16, [{ type: "fireReleased" }]);
    const shot = up.find((e) => e.type === "shot");
    assert.ok(shot && shot.tier === "charged", "release spends the charge");
    assert.equal(s.canFire, true);
    s.enemies.length = 0;
  }
});

test("a double press is a no-op while the button is held", () => {
  const s = newGame();
  step(s, 0, [{ type: "firePressed" }]);
  const shots = s.shots;
  const ev = step(s, 16, [{ type: "firePressed" }, { type: "firePressed" }]);
  assert.equal(count(ev, "shot"), 0);
  assert.equal(s.shots, shots);
});

test("blur releases a held charge without leaving the game unfirable", () => {
  const s = newGame();
  step(s, 0, [{ type: "firePressed" }]);
  step(s, C.CHARGE_MS + 20, []);
  assert.equal(s.canFire, false);

  step(s, 16, [{ type: "fireReleased" }, { type: "pauseOnBlur" }]);
  assert.equal(s.canFire, true, "the player can always fire again after a blur");
  assert.equal(s.charge.downAt, null);
  assert.equal(s.paused, true);
});
