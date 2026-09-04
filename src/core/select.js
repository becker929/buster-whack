/*!
 * Pure selectors — the view model the renderer, the HUD and the overlays read.
 * Never mutates state.
 */

import { multOf, modeById } from "./constants.js";
import * as C from "./constants.js";
import { activeArena, npcBeside, safeZone } from "./world.js";

/**
 * Where the player's sprite is, mid-hop: fractional column and row, the lift
 * of the arc, and the squash of crouch and landing. Pure, so the renderer and
 * a test see the same curve. Standing still, it is the square itself.
 */
export function hopPose(state, now) {
  const h = state.hop;
  const still = { col: state.player.col, row: state.player.row, lift: 0, sx: 1, sy: 1, phase: "still" };
  if (!h) return still;
  const t = now - h.t0;
  if (t < 0 || t >= state.tuning.HOP_TOTAL_MS) return still;
  if (t < state.tuning.HOP_WINDUP_MS) {
    const k = t / state.tuning.HOP_WINDUP_MS;
    return { col: h.fromCol, row: h.fromRow, lift: 0, sx: 1 + 0.12 * k, sy: 1 - 0.14 * k, phase: "windup" };
  }
  const m = t - state.tuning.HOP_WINDUP_MS;
  if (m < state.tuning.HOP_MOVE_MS) {
    const k = m / state.tuning.HOP_MOVE_MS;
    const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);   // ease in-out
    return {
      col: h.fromCol + (h.toCol - h.fromCol) * e,
      row: h.fromRow + (h.toRow - h.fromRow) * e,
      lift: Math.sin(Math.PI * k),
      sx: 1 - 0.08 * Math.sin(Math.PI * k), sy: 1 + 0.12 * Math.sin(Math.PI * k),
      phase: "move",
    };
  }
  const st = (m - state.tuning.HOP_MOVE_MS) / state.tuning.HOP_SETTLE_MS;
  const d = Math.sin(Math.PI * st) * (1 - st);
  return { col: h.toCol, row: h.toRow, lift: 0, sx: 1 + 0.16 * d, sy: 1 - 0.2 * d, phase: "settle" };
}

/**
 * What the context button does right now: TALK beside a keeper, BOMB
 * otherwise. One button, read from where you stand.
 */
export function contextVerb(state) {
  const n = npcBeside(state.world, state.player.col, state.player.row);
  return n ? { verb: n.verb || "talk", npc: n.id } : { verb: "bomb", npc: null };
}

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
  const oc = state.deletions >= state.tuning.OC_START;
  return {
    score: String(state.score).padStart(6, "0"),
    chain: state.chain,
    mult: multOf(state.chain),
    // advance counts arenas: the level is where you are on the road
    level: modeById(state.modeId).advancing ? activeArena(state.world).idx + 1 : state.tuning.level(state.deletions),
    unlimited: !!state.unlimited,
    bombs: state.bombs || 0,
    timeLeft: state.timeLeft,
    timeFrac: Math.max(0, Math.min(1, state.timeLeft / state.tuning.TIME_CAP)),
    // the clock is paused: nothing here is held against you
    safe: safeZone(state.world),
    overclock: oc,
    overclockFactor: state.tuning.bonusFactor(state.deletions),
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
    sub: state.deletions >= state.tuning.OC_START
      ? "overclock reached ×" + state.tuning.bonusFactor(state.deletions).toFixed(2)
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
