/*!
 * Scenario runner: a scenario record in, PNG frames out.
 *
 * Nothing here touches a DOM. `src/shell/render.js` never needed one — it
 * takes a bare CanvasRenderingContext2D, a plain state object carrying its own
 * geometry, and a time — so the whole harness is the pure core plus
 * `@napi-rs/canvas`. No jsdom, no browser, no headless Chromium.
 */

import { clearArena } from "../../src/core/world.js";
import { createCanvas } from "@napi-rs/canvas";
import { createState, setLayout } from "../../src/core/state.js";
import { step } from "../../src/core/step.js";
import * as C from "../../src/core/constants.js";
import { draw } from "../../src/shell/render.js";
import { installHarnessFonts } from "./fonts.js";
import { DT, scenarios, findScenario } from "./scenarios.js";

export { DT, scenarios, findScenario };

/** `test/visual/golden/<scenario>__<label>.png` */
export const frameId = (scenario, label) => `${scenario}__${label}`;

/** Set a dotted path on a plain object: set(s, "player.row", 0). */
function setPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]];
    if (cur === undefined) throw new Error(`no such state path: ${path}`);
  }
  if (!(parts.at(-1) in cur)) throw new Error(`no such state field: ${path}`);
  cur[parts.at(-1)] = value;
}

/** Same shape as `addEnemy` in test/helpers.mjs, so the core sees nothing odd. */
function placeEnemy(state, o) {
  const type = o.type || "mett";
  state.enemies.push({
    col: o.col,
    row: o.row,
    type,
    state: o.state || "up",
    t0: o.t0 === undefined ? state.clock : o.t0,
    riseMs: type === "ally" ? C.ALLY_RISE_MS : C.RISE_MS,
    hp: o.hp === undefined ? (type === "hopper" ? 2 : 1) : o.hp,
    lastHop: state.clock,
    hopT0: -1e9,
    willAttack: !!o.willAttack,
    fired: !!o.fired,
    // the newer per-virus fields, passed through when a scenario names them
    // (defaults match what the spawner would give a plain mett)
    tier: o.tier || 0,
    aimMs: o.aimMs === undefined ? 600 : o.aimMs,
    persistent: !!o.persistent,
    boltKind: o.boltKind || "slow",
    refireAt: Infinity,
    wave: -1,
  });
}

/**
 * Incoming fire from a panel, using the core's own speed for the difficulty.
 *
 * `kind`, `radius` and `speed` are passed through when a scenario names them,
 * so a golden can pin how the renderer draws a bolt that carries the newer
 * per-kind fields as well as one that only has the original `heavy` flag.
 */
function placeBolt(state, o) {
  const p = C.panelRect(state.G, o.col === undefined ? C.COLS - 1 : o.col, o.row);
  const bolt = {
    row: o.row,
    x: p.x + p.w / 2,
    speed: o.speed === undefined ? state.G.pw / C.boltPanelMs(state.deletions) : o.speed,
    heavy: !!o.heavy,
  };
  if (o.kind !== undefined) bolt.kind = o.kind;
  if (o.radius !== undefined) bolt.radius = o.radius;
  state.bolts.push(bolt);
}

function applyCue(state, cue) {
  if (cue.clearArenas) {
    // Take N arenas exactly as a wipe does, then stand the player where the
    // scenario says. Uses the same rng-driven road heights as the game.
    for (let k = 0; k < cue.clearArenas; k++) clearArena(state.world, state.rng);
    state.arenasCleared += cue.clearArenas;
    state.nextSpawnAt = Infinity;
  }
  if (cue.cam !== undefined) {
    // pin the camera for a still frame; the sim eases it every step otherwise
    state.cam = cue.cam;
    state.camAnchor = cue.cam;
  }
  if (cue.spawning !== undefined) {
    state.nextSpawnAt = cue.spawning ? state.clock : Infinity;
  }
  if (cue.set) {
    for (const [k, v] of Object.entries(cue.set)) setPath(state, k, v);
    // A run that has reached N deletions has already been through every stage
    // gate at or below N. Deriving it means a scenario that fast-forwards the
    // deletion count can't accidentally arm a gate that fires on its next
    // kill and freezes the run on the interlevel card.
    if ("deletions" in cue.set && !("stageIdx" in cue.set)) {
      state.stageIdx = C.STAGES.filter((s) => s.at <= state.deletions).length;
    }
  }
  if (cue.place) for (const e of cue.place) placeEnemy(state, e);
  if (cue.bolt) for (const b of [cue.bolt].flat()) placeBolt(state, b);
  if (cue.charge === "full") {
    state.canFire = false;
    state.charge.downAt = state.clock;
    state.charge.full = true;
  } else if (cue.charge === "clear") {
    state.charge.downAt = null;
    state.charge.full = false;
  }
}

/** Normalize `capture` entries to `{ at, as }`. */
function captureList(scenario) {
  return (scenario.capture || []).map((c) =>
    typeof c === "number" ? { at: c, as: "f" + String(c).padStart(3, "0") } : c
  );
}

/**
 * Simulate a scenario and rasterize its captured frames.
 *
 * @param {object} scenario
 * @param {object} [opts]
 * @param {boolean} [opts.fonts=true] - install the bundled fonts first. Only
 *   `font-proof.mjs` passes false, to render a negative control against the
 *   machine's own fonts; goldens are never written from such a render.
 * @returns {Array<{ scenario: string, label: string, at: number, id: string,
 *                   width: number, height: number, png: Buffer }>}
 */
export function runScenario(scenario, opts = {}) {
  if (opts.fonts !== false) installHarnessFonts();

  const { width, height } = scenario;
  const state = createState({ seed: scenario.seed, best: scenario.best || 0, width, height });
  setLayout(state, width, height);

  // Every scenario opens on a live run with organic spawning off, so the only
  // things on the board are the ones the scenario put there. Scenarios that
  // want the spawner can turn it back on with a `spawning: true` cue.
  if (scenario.start !== false) {
    step(state, 0, [{ type: "startRun", modeId: "classic" }]);
    if (!scenario.spawn) {
      state.nextSpawnAt = Infinity;
      state.enemies.length = 0;
    }
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const wanted = new Map();
  for (const c of captureList(scenario)) {
    if (c.at >= scenario.frames) {
      throw new Error(`${scenario.name}: capture at frame ${c.at} but only ${scenario.frames} frames run`);
    }
    if (!wanted.has(c.at)) wanted.set(c.at, []);
    wanted.get(c.at).push(c.as);
  }

  const out = [];
  for (let i = 0; i < scenario.frames; i++) {
    const cues = (scenario.cues || []).filter((c) => c.at === i);
    let actions = [];
    let hold = null;
    for (const cue of cues) {
      applyCue(state, cue);
      if (cue.actions) actions = actions.concat(cue.actions);
      if (cue.hold !== undefined) hold = cue.hold;
    }
    step(state, DT, { actions, hold });

    // The canvas only draws the playfield and HUD; `interlevel` and `over` are
    // HTML cards in the shadow DOM, and both of them stop the game clock. A
    // scenario that wanders into one is almost always an accident (a forced
    // deletion count that armed a stage gate, or a run that timed out), and it
    // silently freezes every later frame — so say so instead of shipping it.
    const allowed = scenario.modes || ["playing"];
    if (!allowed.includes(state.mode)) {
      throw new Error(
        `${scenario.name}: the run entered "${state.mode}" mode at frame ${i}. ` +
          `The canvas does not draw that state and the clock is stopped. ` +
          `Set \`modes: ["playing", "${state.mode}"]\` on the scenario if this is deliberate.`
      );
    }

    for (const label of wanted.get(i) || []) {
      draw(ctx, state, state.clock);
      out.push({
        scenario: scenario.name,
        label,
        at: i,
        id: frameId(scenario.name, label),
        width,
        height,
        png: canvas.toBuffer("image/png"),
      });
    }
  }
  return out;
}
