/*!
 * Items: what you can be carrying, and what it does when you use it.
 *
 * The stash is one list with a capacity in slots. The bomb is the first item
 * and the five shards are the rest, named and costed by the bible; each row
 * here names an effect from the vocabulary below, and the core applies it.
 * The context button uses the top of the stash -- the last thing you picked
 * up -- so what a press will do is always the thing the HUD shows on top.
 *
 * Effects, as a small closed vocabulary:
 *
 *   blast        the bomb: an arc onto a panel ahead, splashing a 3x3
 *   parry        the next bolt that would land on you does not
 *   cloak        nothing aims at you for a while
 *   provoke      everything armed on the board fires this instant
 *   summon       one virus of a named type arrives in your row
 *   echo         your last shot is taken again, for a share of its worth
 *
 * Pure module. No DOM, no clock, no randomness.
 */

/**
 * @typedef {object} Item
 * @property {string} id
 * @property {string} name    what the HUD calls it
 * @property {number} slots   how much of the stash it takes up
 * @property {string} effect  which entry of the vocabulary above
 * @property {any} [arg]      that effect's one parameter, when it needs one
 * @property {string} canon   the bible id it is in the fiction
 */

/** @type {Record<string, Item>} */
export const ITEMS = {
  bomb: { id: "bomb", name: "BOMB", slots: 1, effect: "blast", canon: "item.bomb" },
  // the five shards, with the bible's own costs
  spell: { id: "spell", name: "SPELL", slots: 1, effect: "parry", canon: "shard.spell" },
  footnote: { id: "footnote", name: "FOOTNOTE", slots: 1, effect: "echo", arg: 0.5, canon: "shard.footnote" },
  sock: { id: "sock", name: "SOCK", slots: 2, effect: "cloak", arg: 1400, canon: "shard.sock" },
  weather: { id: "weather", name: "WEATHER", slots: 2, effect: "summon", arg: "darter", canon: "shard.weather" },
  bell: { id: "bell", name: "BELL", slots: 3, effect: "provoke", canon: "shard.bell" },
};

/** The shards, in the order the road hands them out: cheapest first. */
export const SHARDS = ["spell", "footnote", "sock", "weather", "bell"];

export const itemDef = (id) => ITEMS[id] || null;

/** How many slots a stash is using. */
export function slotsUsed(stash) {
  let n = 0;
  for (const id of stash) n += (ITEMS[id] ? ITEMS[id].slots : 1);
  return n;
}

/** Is there room for this item? */
export function fits(stash, id, cap) {
  const def = ITEMS[id];
  if (!def) return false;
  return slotsUsed(stash) + def.slots <= cap;
}

/** Put one in, if it fits. Returns whether it went in. */
export function stow(stash, id, cap) {
  if (!fits(stash, id, cap)) return false;
  stash.push(id);
  return true;
}

/** What the context button would use: the last thing picked up. */
export const topOf = (stash) => (stash.length ? stash[stash.length - 1] : null);

/** Take the top item off. Returns its id, or null. */
export const takeTop = (stash) => (stash.length ? stash.pop() : null);

/** The stash as the HUD wants it: top first, with names and slot costs. */
export function stashView(stash) {
  const out = [];
  for (let i = stash.length - 1; i >= 0; i--) {
    const def = ITEMS[stash[i]];
    if (def) out.push({ id: def.id, name: def.name, slots: def.slots });
  }
  return out;
}

/**
 * Keep `state.bombs` -- the number the HUD and the older tests read -- equal
 * to what the stash actually holds. One writer, called after every change,
 * so the count can never drift from the list.
 */
export function syncStash(state) {
  let n = 0;
  for (const id of state.stash) if (id === "bomb") n++;
  state.bombs = n;
}
