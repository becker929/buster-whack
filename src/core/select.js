/*!
 * Pure selectors — the view model the renderer, the HUD and the overlays read.
 * Never mutates state.
 */

import { OC_START, bonusFactor, level, multOf, TIME_CAP, modeById } from "./constants.js";
import { activeArena } from "./world.js";

/** Hit accuracy as a 0..1 fraction (0 when nothing has been fired). */
export function accuracy(state) {
  return state.shots ? 1 - state.whiffs / state.shots : 0;
}

/** Accuracy formatted the way the footer and the overlays show it. */
export function accuracyText(state) {
  return state.shots ? Math.round(accuracy(state) * 100) + "%" : "—";
}

/** End-of-run letter grade. */
export function computeRank(state) {
  const acc = accuracy(state);
  if (acc >= 0.75 && state.bestChain >= 20) return "S";
  if (acc >= 0.6 && state.bestChain >= 10) return "A";
  if (acc >= 0.45) return "B";
  if (acc >= 0.3) return "C";
  return "D";
}

/** The five numbers in the footer. */
export function statsView(state) {
  return {
    deletions: String(state.deletions),
    bestChain: String(state.bestChain),
    accuracy: accuracyText(state),
    best: String(state.best),
  };
}

/** Everything the canvas HUD draws. */
export function hudView(state) {
  const oc = state.deletions >= OC_START;
  return {
    score: String(state.score).padStart(6, "0"),
    chain: state.chain,
    mult: multOf(state.chain),
    // advance counts arenas: the level is where you are on the road
    level: modeById(state.modeId).advancing ? activeArena(state.world).idx + 1 : level(state.deletions),
    unlimited: !!state.unlimited,
    bombs: state.bombs || 0,
    timeLeft: state.timeLeft,
    timeFrac: Math.max(0, Math.min(1, state.timeLeft / TIME_CAP)),
    overclock: oc,
    overclockFactor: bonusFactor(state.deletions),
    paused: state.paused,
    mode: state.mode,
  };
}

/** Stat rows for the interlevel card. */
export function interlevelView(state, stage, stageBonus) {
  return {
    eyebrow: "",
    title: stage.title,
    sub: "",
    rows: [
      ["score", String(state.score).padStart(6, "0"), "big"],
      ["deletions", state.deletions],
      ["best chain", state.bestChain],
      ["accuracy", accuracyText(state)],
      ["stage bonus", "+" + stageBonus.toFixed(1) + "s"],
      ["time left", state.timeLeft.toFixed(1) + "s"],
    ],
  };
}

/** Stat rows for the game-over card. */
export function gameOverView(state) {
  return {
    eyebrow: "run complete",
    title: state.rank,
    rank: true,
    sub: state.deletions >= OC_START
      ? "overclock reached ×" + bonusFactor(state.deletions).toFixed(2)
      : "",
    rows: [
      ["score", state.score + " pts", "big"],
      ["deletions", state.deletions],
      ["accuracy", accuracyText(state)],
      ["best chain", state.bestChain],
      ["best score", state.best],
    ],
  };
}
