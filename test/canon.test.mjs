// The canon runtime: sealed strings in, gated strings out. Every assertion
// here is on counts, ids and lengths -- never on text -- so a failing test can
// never print prose into a log the player reads.

import test from "node:test";
import assert from "node:assert/strict";
import { Canon, PlayerState } from "../src/canon/canon.js";
import { STRINGS_VAULT, TRIGGERS } from "../src/canon/embed.js";
import { parseContainer, sha256hexSync } from "../src/canon/decoder.js";
import ids from "../canon/bible/string_ids.json" with { type: "json" };

const load = () => Canon.load(STRINGS_VAULT, TRIGGERS);

test("the embedded vault decodes and carries every id the bible lays out", async () => {
  const c = await load();
  assert.equal(c.ids().length, ids.count);
  assert.deepEqual(new Set(c.ids()), new Set(Object.keys(ids.ids)));
  assert.equal(parseContainer(STRINGS_VAULT).meta.id, ids.vault_id);
});

test("string lengths match the layout table (template vars counted as written)", async () => {
  const c = await load();
  c.state.flag("entered.roost.08");     // open a few to compare more than the ungated
  for (const [id, meta] of Object.entries(ids.ids)) {
    if (!c.open(id)) continue;
    assert.equal(c.t(id).length, meta.chars, "length of " + id);
  }
});

test("gates: blank until earned, and a reveal is announced exactly once", async () => {
  const c = await load();
  const gated = new Set(TRIGGERS.flatMap((t) => t.unlocks));
  const blank = () => c.ids().filter((id) => c.t(id) === "").length;
  assert.equal(blank(), gated.size, "every gated id is blank at a fresh state");
  assert.deepEqual(c.newlyUnlocked(), [], "nothing to announce yet");
  c.state.flag("entered.roost.08");
  const opened = c.newlyUnlocked();
  assert.equal(opened.length, 9, "the CHARTER gate opens its nine");
  assert.deepEqual(c.newlyUnlocked(), [], "and is announced only once");
  c.state.set("reads.item.journal.steward", 1);
  assert.deepEqual(c.newlyUnlocked(), ["npc.hidden.02.journal.last"], "S01 needs both halves");
  assert.equal(blank(), gated.size - 10);
});

test("predicates: any/all, negated flags, secret references, comparisons", async () => {
  const c = await load();
  assert.equal(c.unlocked("S05"), false);
  c.state.set("day", 8);
  assert.equal(c.unlocked("S05"), true, "day >= 8 and keeper.03 not carried");
  c.state.flag("carried.npc.keeper.03");
  assert.equal(c.unlocked("S05"), false, "the negated flag closes it again");
  c.state.inc("ferried.count");
  assert.equal(c.unlocked("S05"), true, "the other branch of the any");
  assert.equal(c.unlocked("S07"), false, "S07 references S01 as a secret");
  c.state.flag("entered.roost.08");
  c.state.set("reads.item.journal.steward", 2);
  assert.equal(c.unlocked("S07"), true);
});

test("an unknown trigger or string id throws rather than opening or blanking", async () => {
  const c = await load();
  assert.throws(() => c.unlocked("S99"), /unknown trigger/);
  assert.throws(() => c.t("no.such.id"), /unknown string id/);
});

test("templates fill and player state round-trips", async () => {
  const c = await load();
  const filled = c.t("ui.sunset.days", { n: 12 });
  assert.equal(filled.length, ids.ids["ui.sunset.days"].chars - "{n}".length + 2);
  assert.ok(filled.includes("12"));
  const s = new PlayerState();
  s.inc("day"); s.inc("day"); s.flag("forge.hot");
  const snap = s.snapshot();
  const t = new PlayerState(); t.restore(JSON.parse(JSON.stringify(snap)));
  assert.equal(t.get("day"), 2);
  assert.equal(t.has("forge.hot"), true);
});

test("the plain-JS SHA-256 matches crypto.subtle, so an insecure context still opens the vault", async () => {
  const cases = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "b".repeat(1000), STRINGS_VAULT];
  for (const c of cases) {
    const bytes = new TextEncoder().encode(c);
    const ref = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((b) => b.toString(16).padStart(2, "0")).join("");
    assert.equal(sha256hexSync(bytes), ref, "sha of " + c.length + " bytes");
  }
  assert.equal(sha256hexSync(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
