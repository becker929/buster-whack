/*!
 * Story shell: the bridge from core events to the sealed canon and back to
 * the board.
 *
 * The core knows tiles and presses ("you pressed TALK beside npc.keeper.01
 * for the second time"). This module owns the canon's PlayerState, writes the
 * keys the bible names (canon/bible/state_keys.json, `sources`), picks the
 * string id a press earns, and hands the shell text to show as a strip over
 * the board. No scene change, no dialogue screen: one representation.
 *
 * Text never reaches the core, so a replay from a seed is text-free and the
 * goldens never carry prose.
 */

import { Canon } from "../canon/canon.js";
import { STRINGS_VAULT, TRIGGERS } from "../canon/embed.js";

// Which string a TALK press earns from each npc, by press count (1-based);
// past the end the last one repeats. Ids only -- the text is in the vault.
// Gated ids come back "" until earned and are skipped, so a keeper's line
// list can hold what they will say later without saying it now.
const LINES = {
  "npc.keeper.01": ["npc.keeper.01.greet.0", "npc.keeper.01.greet.1", "npc.keeper.01.sunset", "npc.keeper.01.list"],
  "npc.keeper.02": ["npc.keeper.02.greet.0", "npc.keeper.02.schedule", "npc.keeper.02.thin", "npc.keeper.02.leave"],
  "npc.keeper.03": ["npc.keeper.03.greet.0", "npc.keeper.03.trade", "npc.keeper.03.clause", "npc.keeper.03.carry", "npc.keeper.03.give"],
  "npc.keeper.04": ["npc.keeper.04.greet.0", "npc.keeper.04.forge", "npc.keeper.04.stay"],
  "npc.keeper.05": ["npc.keeper.05.greet.0", "npc.keeper.05.hurt", "npc.keeper.05.fit"],
  "boss.ferryman": ["boss.ferryman.offer", "boss.ferryman.honest", "boss.ferryman.carried", "boss.ferryman.sorry"],
  "npc.hidden.01": ["npc.hidden.01.greet", "npc.hidden.01.nice"],
};

/** Arrival at a tower: its name over its place, then its description. */
const ARRIVAL = (roost) => [[roost + ".name", roost + ".place"], ["", roost + ".desc"]];

/**
 * @param {object} o
 * @param {(who: string, text: string, now?: boolean) => void} o.say - show a line over the board (`now`: interrupt)
 * @param {() => void} [o.hush] - take the line down
 * @param {(vault: string, triggers: Array) => Promise<Canon>} [o.load] - test seam
 */
export function createStory({ say, hush, onError, load = Canon.load }) {
  let canon = null;
  let pending = [];   // events that arrived before the vault finished decoding
  let active = false; // is the current run a story run?

  const ready = load(STRINGS_VAULT, TRIGGERS).then((c) => {
    canon = c;
    const q = pending; pending = [];
    for (const ev of q) handle(ev);
    return c;
  }).catch((e) => { if (onError) onError(e); return null; });

  /**
   * A gated string comes back ""; nothing is shown for a blank. `now` is for
   * a line the player asked for: it interrupts whatever beat is showing
   * rather than waiting its turn behind it.
   */
  function show(whoId, textId, now = false) {
    const text = canon.t(textId);
    if (!text) return false;
    say(whoId ? canon.t(whoId) : "", text, now);
    return true;
  }

  /** The n-th line (1-based) among those open right now; past the end, the last open one. */
  function nthOpen(ids, n) {
    const open = ids.filter((id) => canon.t(id) !== "");
    if (!open.length) return null;
    return open[Math.min(n, open.length) - 1];
  }

  function handle(ev) {
    switch (ev.type) {
      case "runStarted": {
        active = !!ev.story;
        if (hush) hush();
        if (!active) return;
        canon.state.restore({});
        canon.seenOpen.clear();
        break;
      }
      case "towerEntered": {
        if (!active) return;
        canon.state.inc("day");
        canon.state.flag("entered." + ev.roost);
        for (const [who, what] of ARRIVAL(ev.roost)) show(who, what);
        break;
      }
      case "talk": {
        if (!active) return;
        canon.state.inc("talks." + ev.npc.replace(/^(npc|boss)\./, ""));
        const id = nthOpen(LINES[ev.npc] || [], ev.count);
        if (id) show(ev.npc + ".name", id, true);
        break;
      }
      default: break;
    }
  }

  return {
    ready,
    /** Feed every core event; the module ignores what is not its business. */
    handleAll(events) {
      for (const ev of events) {
        if (ev.type !== "runStarted" && ev.type !== "towerEntered" && ev.type !== "talk") continue;
        if (!canon) pending.push(ev); else handle(ev);
      }
    },
    /** The canon, once decoded (null before). For tooling; never log its strings. */
    get canon() { return canon; },
    get active() { return active; },
  };
}
