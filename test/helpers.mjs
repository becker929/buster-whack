// Shared fixtures for the core unit tests.

import { createState, setLayout } from "../src/core/state.js";
import { step } from "../src/core/step.js";
import * as C from "../src/core/constants.js";

export { step, C, setLayout };

/** A running game on an 800x600 stage with organic spawning switched off. */
export function newGame(opts = {}) {
  const s = createState({
    seed: opts.seed === undefined ? 1 : opts.seed,
    width: opts.width || 800,
    height: opts.height || 600,
    best: opts.best || 0,
  });
  step(s, 0, [{ type: "startRun", modeId: "classic" }]);
  if (opts.spawn !== true) s.nextSpawnAt = Infinity;
  s.enemies.length = 0;
  return s;
}

/** Drop an enemy onto the board in a known state. */
export function addEnemy(s, o = {}) {
  const e = {
    col: o.col === undefined ? 3 : o.col,
    row: o.row === undefined ? 1 : o.row,
    type: o.type || "mett",
    state: o.state || "up",
    t0: o.t0 === undefined ? s.clock : o.t0,
    riseMs: (o.type || "mett") === "ally" ? C.ALLY_RISE_MS : C.RISE_MS,
    hp: o.hp === undefined ? ((o.type || "mett") === "hopper" ? 2 : 1) : o.hp,
    lastHop: s.clock,
    hopT0: -1e9,
    willAttack: !!o.willAttack,
    fired: false,
  };
  s.enemies.push(e);
  return e;
}

/** A full press+release: one normal shot. */
export function fire(s, dt = 0) {
  return step(s, dt, [{ type: "firePressed" }, { type: "fireReleased" }]);
}

/** Release a fully charged buster (as if the button had been held). */
export function fireCharged(s, dt = 0) {
  s.canFire = false;
  s.charge.downAt = s.clock;
  s.charge.full = true;
  return step(s, dt, [{ type: "fireReleased" }]);
}

export const typesOf = (events) => events.map((e) => e.type);
export const find = (events, type) => events.find((e) => e.type === type);
export const count = (events, type) => events.filter((e) => e.type === type).length;

/** Structural snapshot of a state, minus the rng closure. */
export function snapshot(s) {
  return JSON.stringify(s, (k, v) => (k === "rng" ? undefined : v));
}
