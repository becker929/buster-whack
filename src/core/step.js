/*!
 * The simulation.
 *
 *   step(state, dtMs, intents) -> events[]
 *
 * Deterministic and effect-free: no DOM, no audio, no Math.random, no clock
 * reads. Randomness comes from `state.rng`, time only from `dtMs`. Anything
 * the outside world should hear, show or persist leaves as an event; the shell
 * drains the list and performs it.
 *
 * `intents` is either an array of actions or `{ actions, hold }`:
 *   actions - discrete inputs since the last step, applied in order *before*
 *             the clock advances (which is where they landed when the shell
 *             handled DOM events inline).
 *   hold    - a held d-pad direction `{ dc, dr }`, polled after the clock
 *             advances, throttled by MOVE_REPEAT_MS like any other move.
 */

import * as C from "./constants.js";
import { safeZone } from "./world.js";
import { updateBolts, contextAction } from "./combat.js";
import { firePressed, fireReleased, togglePause, resetGame, gameOver, checkStageGate, resumeFromInterlevel } from "./flow.js";
import { cullFx } from "./fx.js";
import { flushQueuedMove, move, updateHop, moveTo, runPath, tapAt } from "./movement.js";
import { updateEnemies } from "./waves.js";

// ---------- entry point ----------

export function step(state, dtMs, intents = {}) {
  const events = [];
  const actions = Array.isArray(intents) ? intents : intents.actions || [];
  const hold = Array.isArray(intents) ? null : intents.hold;

  for (const a of actions) applyIntent(state, a, events);

  // Hit-stop. `adv` is how much of this frame's dt the *simulation* gets: a
  // pending freeze eats the front of it, so animations, bolts, spawn gaps and
  // aim windows all stall together and cannot desync from each other. The run
  // clock below is deliberately not part of it.
  let adv = dtMs;
  if (state.mode === "playing" && !state.paused &&
      state.hitStopMs > 0 && state.clock >= state.hitStopAt) {
    const used = Math.min(state.hitStopMs, adv);
    state.hitStopMs -= used;
    adv -= used;
  }

  if (state.mode === "playing" && !state.paused) {
    state.clock += adv;
    // The run clock is fight pressure: it drains only while the arena you
    // are in is held against you. Towers, roads and taken arenas are safe.
    if (!safeZone(state.world)) state.timeLeft -= dtMs / 1000;
    if (state.timeLeft <= 0) { state.timeLeft = 0; gameOver(state, events); }
    if (state.charge.downAt !== null && !state.charge.full &&
        state.clock - state.charge.downAt >= state.tuning.CHARGE_MS) {
      state.charge.full = true;
      events.push({ type: "chargeReady" });
    }
  }

  // A held direction re-asks every frame. Each distinct push (a new direction
  // counts as one) is stamped, so a flick that ends inside the ration still
  // lands its one step, while a push that already stepped does not also queue
  // a second for the lift.
  if (hold && (hold.dc || hold.dr)) {
    const hd = state.holdDir;
    if (!hd || hd.dc !== hold.dc || hd.dr !== hold.dr) {
      state.holdDir = { dc: hold.dc, dr: hold.dr };
      state.holdT0 = state.clock;
    }
    move(state, hold.dc, hold.dr, events, true);
  } else {
    state.holdDir = null;
  }
  updateHop(state, events);
  flushQueuedMove(state, events);
  runPath(state, events);

  updateEnemies(state, events);
  updateBolts(state, adv, events);
  checkStageGate(state, events);
  cullFx(state);

  return events;
}

// ---------- intents ----------

export function applyIntent(state, action, events) {
  switch (action.type) {
    case "firePressed":  firePressed(state, events); break;
    case "fireReleased": fireReleased(state, events); break;
    case "move":         move(state, action.dc, action.dr, events); break;
    case "moveTo":       moveTo(state, action.col, action.row, events); break;
    case "tapAt":        tapAt(state, action.x, action.y, events); break;
    case "resetMoveThrottle": state.lastMoveAt = -1e9; break;
    case "pause":        togglePause(state, events); break;
    case "pauseOnBlur":
      if (state.mode === "playing" && !state.paused) togglePause(state, events);
      break;
    case "startRun":     resetGame(state, events, action.modeId); break;
    case "bomb":         contextAction(state, events); break;
    case "resume":       resumeFromInterlevel(state, events); break;
    case "endRun":       gameOver(state, events); break;
    default: break;      // shell-only intents (mute, …) never reach here
  }
}
