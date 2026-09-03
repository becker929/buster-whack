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
// What a TALK press earns: exchanges of up to three beats (the person, Wren,
// the person again), cycling by press count. Gated ids come back "" until
// earned and are skipped, so a list can hold what someone will say later
// without saying it now. Ids only -- the text is in the vault.
const X = (id, n) => [[id + ".name", id + ".talk." + n + ".a"], ["player.name", id + ".talk." + n + ".b"], [id + ".name", id + ".talk." + n + ".c"]];
const TALKS = {
  "npc.keeper.01": [X("npc.keeper.01", 0), X("npc.keeper.01", 1), X("npc.keeper.01", 2),
                    [["npc.keeper.01.name", "npc.keeper.01.sunset"]], [["npc.keeper.01.name", "npc.keeper.01.list"]]],
  "npc.keeper.02": [X("npc.keeper.02", 0), X("npc.keeper.02", 1), X("npc.keeper.02", 2),
                    [["npc.keeper.02.name", "npc.keeper.02.schedule"]], [["npc.keeper.02.name", "npc.keeper.02.leave"]]],
  "npc.side.tally": [X("npc.side.tally", 0), X("npc.side.tally", 1)],
  "npc.keeper.03": [X("npc.keeper.03", 0), X("npc.keeper.03", 1), X("npc.keeper.03", 2),
                    [["npc.keeper.03.name", "npc.keeper.03.trade"]], [["npc.keeper.03.name", "npc.keeper.03.give"]]],
  "npc.side.vesper": [X("npc.side.vesper", 0), [["npc.side.vesper.name", "npc.side.vesper.talk.1.a"]]],
  "npc.keeper.05": [X("npc.keeper.05", 0), X("npc.keeper.05", 1), X("npc.keeper.05", 2),
                    [["npc.keeper.05.name", "npc.keeper.05.fit"]]],
  "npc.side.bean": [X("npc.side.bean", 0), [["npc.side.bean.name", "npc.side.bean.talk.1.a"], ["npc.keeper.05.name", "npc.side.bean.talk.1.b"]]],
  "npc.keeper.04": [X("npc.keeper.04", 0), X("npc.keeper.04", 1), X("npc.keeper.04", 2),
                    [["npc.keeper.04.name", "npc.keeper.04.stay"]]],
  "npc.side.rivet": [X("npc.side.rivet", 0), [["npc.side.rivet.name", "npc.side.rivet.talk.1.a"]]],
  "boss.ferryman": [X("boss.ferryman", 0), X("boss.ferryman", 1), X("boss.ferryman", 2),
                    [["boss.ferryman.name", "boss.ferryman.carried"]], [["boss.ferryman.name", "boss.ferryman.sorry"]]],
  "npc.sweeper.tidy": [X("npc.sweeper.tidy", 0), [["npc.sweeper.tidy.name", "npc.sweeper.tidy.talk.1.a"]]],
  "boss.foreman": [X("boss.foreman", 0), [["boss.foreman.name", "boss.foreman.talk.1.a"]]],
  "item.journal.steward": [[["item.journal.steward.name", "item.journal.steward.read.0"]],
                           [["item.journal.steward.name", "item.journal.steward.read.1"]],
                           [["npc.hidden.02.name", "npc.hidden.02.journal.last"]],
                           [["npc.hidden.02.name", "npc.hidden.02.journal.margin"]]],
  "npc.hidden.01": [[["npc.hidden.01.name", "npc.hidden.01.greet"]], [["npc.hidden.01.name", "npc.hidden.01.nice"]]],
};

/** Who speaks first on arrival, unprompted, by visit (1-based) -- the keeper of the roost. */
const HAILS = {
  "roost.01": "npc.keeper.01", "roost.02": "npc.keeper.02", "roost.03": "npc.keeper.03",
  "roost.04": "npc.keeper.04", "roost.05": "npc.keeper.05", "roost.06": "boss.ferryman",
  "roost.07": "boss.foreman", "roost.08": null,
};

/** The opening, before anyone speaks: four beats of where you are. */
const INTRO = [["", "intro.0"], ["", "intro.1"], ["", "intro.2"], ["", "intro.3"], ["player.name", "player.bark.wake"]];

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

  /** Play an exchange: the first beat interrupts, the rest queue behind it. */
  function exchange(beats, now) {
    let first = true;
    for (const [who, what] of beats) {
      if (show(who, what, now && first)) first = false;
    }
    return !first;
  }

  /** The n-th exchange (1-based) among those with an open first beat; past the end, the last. */
  function nthOpen(list, n) {
    const open = list.filter((beats) => canon.t(beats[0][1]) !== "");
    if (!open.length) return null;
    return open[Math.min(n, open.length) - 1];
  }

  const visits = {};   // roost -> arrivals this run

  function handle(ev) {
    switch (ev.type) {
      case "runStarted": {
        active = !!ev.story;
        if (hush) hush();
        if (!active) return;
        canon.state.restore({});
        canon.seenOpen.clear();
        for (const k of Object.keys(visits)) delete visits[k];
        exchange(INTRO, false);
        break;
      }
      case "towerEntered": {
        if (!active) return;
        canon.state.inc("day");
        canon.state.flag("entered." + ev.roost);
        visits[ev.roost] = (visits[ev.roost] || 0) + 1;
        exchange(ARRIVAL(ev.roost), false);
        // the keeper speaks first, unprompted: the news of this visit
        const who = HAILS[ev.roost];
        if (who) {
          const n = visits[ev.roost] - 1;
          const id = who + ".hail." + n;
          if (id in canon.strings) show(who + ".name", id, false);
          else if ((who + ".hail.0") in canon.strings) show(who + ".name", who + ".hail.0", false);
        }
        break;
      }
      case "talk": {
        if (!active) return;
        const key = ev.npc.replace(/^(npc|boss|item)\./, "");
        canon.state.inc((ev.verb === "read" ? "reads." : "talks.") + key);
        if (ev.verb === "read") canon.state.inc("reads." + ev.npc);
        const beats = nthOpen(TALKS[ev.npc] || [], ev.count);
        if (beats) exchange(beats, true);
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
