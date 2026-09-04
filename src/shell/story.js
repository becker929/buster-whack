/*!
 * Story shell: the bridge from core events to the sealed canon and back to
 * the board. The player paces every line: TALK opens, TALK advances, TALK
 * closes; nothing is shown that was not asked for.
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
// Conversations. Each person has a list of them; a conversation is a list of
// beats [whoId, textId]. The player paces every beat: TALK opens the next
// conversation, TALK again shows the next beat, and TALK on the last beat
// closes it. Nothing plays on its own. Gated beats come back "" until earned;
// a conversation whose first beat is gated is skipped, so a list can hold what
// someone will say later without saying it now. Ids only -- text is sealed.
const P = "player.name";
const conv = (id, n, count, who = id + ".name") =>
  Array.from({ length: count }, (_, i) => [i % 2 === 1 ? P : who, id + ".c" + n + "." + i]);
const TALKS = {
  "npc.keeper.01": [conv("npc.keeper.01", 0, 4), conv("npc.keeper.01", 1, 3), conv("npc.keeper.01", 2, 3), conv("npc.keeper.01", 3, 1),
                    [["npc.keeper.01.name", "npc.keeper.01.sunset"]], [["npc.keeper.01.name", "npc.keeper.01.list"]]],
  "npc.keeper.02": [conv("npc.keeper.02", 0, 3), conv("npc.keeper.02", 1, 3),
                    [["npc.keeper.02.name", "npc.keeper.02.c2.0"], ["npc.keeper.02.name", "npc.keeper.02.c2.1"]],
                    conv("npc.keeper.02", 3, 1), [["npc.keeper.02.name", "npc.keeper.02.leave"]]],
  "npc.side.tally": [conv("npc.side.tally", 0, 3), conv("npc.side.tally", 1, 1)],
  "npc.keeper.03": [conv("npc.keeper.03", 0, 1), conv("npc.keeper.03", 1, 3), conv("npc.keeper.03", 2, 3), conv("npc.keeper.03", 3, 1),
                    [["npc.keeper.03.name", "npc.keeper.03.trade"]], [["npc.keeper.03.name", "npc.keeper.03.give"]]],
  "npc.side.vesper": [conv("npc.side.vesper", 0, 3), conv("npc.side.vesper", 1, 1)],
  "npc.keeper.05": [conv("npc.keeper.05", 0, 3), conv("npc.keeper.05", 1, 1), conv("npc.keeper.05", 2, 3), conv("npc.keeper.05", 3, 3),
                    [["npc.keeper.05.name", "npc.keeper.05.fit"]]],
  "npc.side.bean": [[["npc.side.bean.name", "npc.side.bean.c0.0"], ["npc.keeper.05.name", "npc.side.bean.c0.1"]],
                    [["npc.side.bean.name", "npc.side.bean.c1.0"], ["npc.keeper.05.name", "npc.side.bean.c1.1"]]],
  "npc.keeper.04": [conv("npc.keeper.04", 0, 1), conv("npc.keeper.04", 1, 3), conv("npc.keeper.04", 2, 1), conv("npc.keeper.04", 3, 1),
                    [["npc.keeper.04.name", "npc.keeper.04.stay"]]],
  "npc.side.rivet": [conv("npc.side.rivet", 0, 3), conv("npc.side.rivet", 1, 1)],
  "boss.ferryman": [conv("boss.ferryman", 0, 3),
                    [["boss.ferryman.name", "boss.ferryman.c1.0"], ["boss.ferryman.name", "boss.ferryman.c1.1"]],
                    conv("boss.ferryman", 2, 1), conv("boss.ferryman", 3, 1),
                    [["boss.ferryman.name", "boss.ferryman.carried"]], [["boss.ferryman.name", "boss.ferryman.sorry"]]],
  "npc.sweeper.tidy": [conv("npc.sweeper.tidy", 0, 3), conv("npc.sweeper.tidy", 1, 1)],
  "boss.foreman": [conv("boss.foreman", 0, 3), conv("boss.foreman", 1, 1)],
  "item.journal.steward": [[["item.journal.steward.name", "item.journal.steward.read.0"]],
                           [["item.journal.steward.name", "item.journal.steward.read.1"]],
                           [["npc.hidden.02.name", "npc.hidden.02.journal.last"]],
                           [["npc.hidden.02.name", "npc.hidden.02.journal.margin"]]],
  "npc.hidden.01": [[["npc.hidden.01.name", "npc.hidden.01.greet"]], [["npc.hidden.01.name", "npc.hidden.01.nice"]]],
};

/**
 * @param {object} o
 * @param {(who: string, text: string) => void} o.say - show a beat over the board
 * @param {() => void} [o.hush] - take the beat down
 * @param {(text: string) => void} [o.place] - the place label: the roost you are in
 * @param {(e: Error) => void} [o.onError]
 * @param {(vault: string, triggers: Array) => Promise<Canon>} [o.load] - test seam
 */
export function createStory({ say, hush, place, onError, load = Canon.load }) {
  let canon = null;
  let pending = [];   // events that arrived before the vault finished decoding
  let active = false; // is the current run a story run?
  let done = {};      // npc -> conversations completed this run
  let convo = null;   // { npc, beats, i } while a conversation is open

  const ready = load(STRINGS_VAULT, TRIGGERS).then((c) => {
    canon = c;
    const q = pending; pending = [];
    for (const ev of q) handle(ev);
    return c;
  }).catch((e) => { if (onError) onError(e); return null; });

  /**
   * A beat's words. Canon beats name a sealed id; a task beat carries its own
   * plain sentence, because what the game asks you to *do* is instructions,
   * not story, and the player has to be able to read it straight.
   */
  function beatText(what) {
    return what && typeof what === "object" && what.plain !== undefined ? what.plain : canon.t(what);
  }

  /** The n-th conversation (0-based) among those whose first beat is open; past the end, the last. */
  function nthOpen(list, n) {
    const open = list.filter((beats) => beatText(beats[0][1]) !== "");
    if (!open.length) return null;
    return open[Math.min(n, open.length - 1)];
  }

  function showBeat() {
    const [who, what] = convo.beats[convo.i];
    say(who ? canon.t(who) : "", beatText(what));
  }

  /** TALK: open, advance, or close. The only thing that changes the box. */
  function press(npc, verb) {
    if (convo && convo.npc === npc) {
      convo.i++;
      if (convo.i < convo.beats.length && beatText(convo.beats[convo.i][1]) !== "") { showBeat(); return; }
      // the last beat was read: the conversation counts, and the box closes
      done[npc] = (done[npc] || 0) + 1;
      const key = npc.replace(/^(npc|boss|item)\./, "");
      canon.state.inc((verb === "read" ? "reads." : "talks.") + key);
      if (verb === "read") canon.state.inc("reads." + npc);
      close();
      return;
    }
    const beats = nthOpen(TALKS[npc] || [], done[npc] || 0);
    if (!beats) return;
    convo = { npc, beats: beats.slice(), i: 0 };
    showBeat();
  }

  function close() {
    convo = null;
    if (hush) hush();
  }

  function handle(ev) {
    switch (ev.type) {
      case "runLoaded": {
        // a loaded run says where it is; the shell restores the rest itself
        active = !!ev.story;
        close();
        if (place) place("");
        break;
      }
      case "runStarted": {
        active = !!ev.story;
        close();
        done = {};
        if (place) place("");
        if (!active) return;
        canon.state.restore({});
        canon.seenOpen.clear();
        break;
      }
      case "towerEntered": {
        if (!active) return;
        canon.state.inc("day");
        canon.state.flag("entered." + ev.roost);
        // no announcement plays; the place label says where you are
        if (place) place(canon.t(ev.roost + ".name"));
        break;
      }
      case "arenaEntered": {
        if (active && place) place("");
        break;
      }
      case "talk": {
        if (!active) return;
        press(ev.npc, ev.verb);
        break;
      }
      // The bonus task is the last thing this person says: what they are
      // asking for, how far along it is, or what they are paying out. It
      // arrives with the talk it belongs to, so it lands as one more press
      // of TALK rather than a box that appears on its own.
      case "taskGiven":
      case "taskProgress":
      case "taskDone": {
        if (!active || !ev.text) return;
        if (!convo || convo.npc !== ev.npc) return;
        convo.beats.push([convo.beats[0][0], { plain: ev.text }]);
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
        if (!["runStarted", "runLoaded", "towerEntered", "arenaEntered", "talk",
              "taskGiven", "taskProgress", "taskDone"].includes(ev.type)) continue;
        if (!canon) pending.push(ev); else handle(ev);
      }
    },
    /**
     * What the context button should read beside `npc`: "next" while their
     * conversation is open and more beats remain, "done" on its last beat,
     * or null when no conversation is open (the verb itself applies).
     */
    label(npc) {
      if (!convo || convo.npc !== npc) return null;
      // beatText, not canon.t: the next beat may be a task line, which carries
      // its own plain sentence rather than a sealed id. Asking the canon for
      // an object throws, and this runs on the frame that draws the button.
      const more = convo.i + 1 < convo.beats.length && beatText(convo.beats[convo.i + 1][1]) !== "";
      return more ? "next" : "done";
    },
    /** Walking away from the person closes the box; it is theirs, not the road's. */
    leave() { if (convo) close(); },
    /**
     * The story half of a saved run: the gate state and how many times each
     * conversation has been finished. Sealed ids and counters only -- never a
     * line of canon, so a save file is as mute as the repository is.
     */
    snapshot() {
      if (!canon) return null;
      return { kv: canon.state.snapshot(), done: { ...done }, seen: [...canon.seenOpen] };
    },
    /** …and back, when a run is loaded. */
    restore(snap) {
      if (!canon || !snap) return false;
      close();
      canon.state.restore(snap.kv || {});
      done = { ...(snap.done || {}) };
      canon.seenOpen = new Set(snap.seen || []);
      return true;
    },
    get open() { return !!convo; },
    /** The canon, once decoded (null before). For tooling; never log its strings. */
    get canon() { return canon; },
    get active() { return active; },
  };
}
