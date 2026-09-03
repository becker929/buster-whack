/*!
 * canon.js — the game-facing API. Loads the sealed string table, evaluates
 * reveal gates against player state, and hands the game only what it has
 * earned. Nothing here knows about the board; `src/shell/story.js` is the
 * bridge from core events to this.
 *
 *   const canon = await Canon.load(STRINGS_VAULT, TRIGGERS);
 *   canon.t("roost.01.name")                 // string, or "" while gated
 *   canon.t("ui.sunset.days", { n: 3 })      // template fill
 *   canon.state.inc("talks.ferryman")        // the engine writes, gates read
 *   canon.unlocked("S01")                    // boolean
 *   canon.newlyUnlocked()                    // ids that opened since last asked
 */

import { unseal } from "./unseal.js";

export class PlayerState {
  constructor() { this.kv = new Map(); }
  set(k, v) { this.kv.set(k, v); }
  get(k) { return this.kv.get(k); }
  inc(k, by = 1) { this.kv.set(k, Number(this.kv.get(k) ?? 0) + by); }
  flag(k) { this.kv.set(k, true); }
  has(k) { return this.kv.get(k) === true; }
  snapshot() { return Object.fromEntries(this.kv); }
  restore(s) { this.kv = new Map(Object.entries(s)); }
}

export class Canon {
  /** Use Canon.load(). */
  constructor(strings, triggers, state) {
    this.strings = strings;
    this.triggers = triggers;
    this.state = state;
    this.gateFor = new Map();
    for (const t of triggers) for (const id of t.unlocks) this.gateFor.set(id, t);
    this.seenOpen = new Set();
  }

  /**
   * @param {string} stringsVault - the sealed string table, as text
   * @param {Array} triggers - bible/triggers.json
   * @param {PlayerState} [state]
   */
  static async load(stringsVault, triggers, state = new PlayerState()) {
    const strings = JSON.parse(await unseal(stringsVault));
    return new Canon(strings, triggers, state);
  }

  /** Evaluate a gate predicate against the current player state. */
  eval(p) {
    if ("all" in p) return p.all.every((q) => this.eval(q));
    if ("any" in p) return p.any.some((q) => this.eval(q));
    if ("flag" in p) return p.flag.startsWith("!") ? !this.state.has(p.flag.slice(1)) : this.state.has(p.flag);
    if ("secret" in p) return this.unlocked(p.secret);
    const v = this.state.get(p.key);
    const a = typeof v === "number" ? v : Number(v ?? 0);
    const b = typeof p.value === "number" ? p.value : Number(p.value);
    switch (p.op) {
      case ">=": return a >= b;
      case "<=": return a <= b;
      case ">": return a > b;
      case "<": return a < b;
      case "==": return v === p.value;
      case "!=": return v !== p.value;
      default: throw new Error("canon: unknown op " + p.op);
    }
  }

  /** Is a trigger open? Unknown ids throw, so a typo can never open a secret. */
  unlocked(triggerId) {
    const t = this.triggers.find((x) => x.id === triggerId);
    if (!t) throw new Error("canon: unknown trigger id " + triggerId);
    return this.eval(t.gate);
  }

  /** Is this string id readable right now? Ungated ids always are. */
  open(id) {
    const g = this.gateFor.get(id);
    return !g || this.eval(g.gate);
  }

  /** Get a string. Locked strings return "". Missing ids throw so you notice. */
  t(id, vars) {
    if (!(id in this.strings)) throw new Error("canon: unknown string id " + id);
    if (!this.open(id)) return "";
    let s = this.strings[id];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split("{" + k + "}").join(String(v));
    return s;
  }

  /** Ids only; safe to print in tooling. */
  ids() { return Object.keys(this.strings); }

  /**
   * Gates are evaluated on read, so nothing announces a reveal by itself.
   * This is the announcement: every gated id that is open now and was not
   * the last time this was called. The game asks after each state write and
   * gets the list of things it may now show for the first time.
   */
  newlyUnlocked() {
    const out = [];
    for (const id of this.gateFor.keys()) {
      if (this.seenOpen.has(id)) continue;
      if (this.open(id)) { this.seenOpen.add(id); out.push(id); }
    }
    return out;
  }
}
