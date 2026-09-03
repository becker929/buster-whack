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
const LINES = {
  "npc.keeper.01": ["npc.keeper.01.greet.0", "npc.keeper.01.greet.1"],
};

/** The roost a tower segment stands for -> the ids shown on arrival. */
const ARRIVAL = (roost) => [roost + ".name", roost + ".place"];

/**
 * @param {object} o
 * @param {(who: string, text: string) => void} o.say - show a line over the board
 * @param {() => void} [o.hush] - take the line down
 * @param {(vault: string, triggers: Array) => Promise<Canon>} [o.load] - test seam
 */
export function createStory({ say, hush, load = Canon.load }) {
  let canon = null;
  let pending = [];   // events that arrived before the vault finished decoding
  let active = false; // is the current run a story run?

  const ready = load(STRINGS_VAULT, TRIGGERS).then((c) => {
    canon = c;
    const q = pending; pending = [];
    for (const ev of q) handle(ev);
    return c;
  }).catch(() => null);

  /** A gated string comes back ""; nothing is shown for a blank. */
  function show(whoId, textId) {
    const text = canon.t(textId);
    if (!text) return false;
    say(whoId ? canon.t(whoId) : "", text);
    return true;
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
        const [name, place] = ARRIVAL(ev.roost);
        show(name, place);
        break;
      }
      case "talk": {
        if (!active) return;
        canon.state.inc("talks." + ev.npc.replace(/^(npc|boss)\./, ""));
        const lines = LINES[ev.npc] || [];
        const id = lines[Math.min(ev.count, lines.length) - 1];
        if (id) show(ev.npc + ".name", id);
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
