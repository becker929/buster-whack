/*!
 * The counters the bonus tasks watch. One function, called from the places
 * where the thing being counted actually happens, so no module has to learn
 * the task table to keep it fed.
 *
 * Pure module. No DOM, no clock, no randomness.
 */

import { enemyDef } from "./enemies.js";

/** The chain length a "chain" task counts as one. */
const CHAIN_RUN = 8;

/**
 * Record something that happened.
 * @param {any} state
 * @param {"kill"|"spared"|"hurt"|"waveCleared"|"arenaTaken"|"arenaEntered"} what
 * @param {any} [info]
 */
export function bumpTask(state, what, info = {}) {
  const t = state.tasks;
  if (!t) return;
  const c = t.counts;
  switch (what) {
    case "kill": {
      const def = enemyDef(info.type);
      if (def.armor === "steel") c.guards++;
      if (def.armor === "shutter") c.sentinels++;
      if (info.tier === "charged") c.charged++;
      // a run of CHAIN_RUN counts once, and again every CHAIN_RUN after it
      if (info.chain > 0 && info.chain % CHAIN_RUN === 0) c.chain8++;
      break;
    }
    case "spared": c.spared++; break;
    case "hurt": t.hitThisArena = true; break;
    case "waveCleared": c.perfectWaves++; break;
    case "arenaEntered": t.hitThisArena = false; break;
    case "arenaTaken":
      c.arenas++;
      if (!t.hitThisArena) c.cleanArenas++;
      break;
    default: break;
  }
}
