// Saving a run and loading it back: the manifest, its version rules, and what
// survives the round trip.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newGame, addEnemy, step, T, C } from "./helpers.mjs";
import { createState } from "../src/core/state.js";
import { toSave, readSave, applySave } from "../src/core/save.js";
import { VERSION, SAVE_VERSION, SAVE_GAME_ID } from "../src/core/version.js";
import { clearArena, activeArena } from "../src/core/world.js";

/** A story run walked a few arenas down the road, with things to remember. */
function walked(n = 3) {
  const s = createState({ seed: 9, width: 900, height: 640, modeId: "story" });
  step(s, 0, [{ type: "startRun", modeId: "story" }]);
  for (let i = 0; i < n; i++) clearArena(s.world, s.rng, { tuning: s.tuning });
  s.arenasCleared = n;
  s.score = 4200;
  s.deletions = 31;
  s.timeLeft = 22.5;
  s.bestChain = 7;
  s.stash.push("bomb", "spell");
  s.bombs = 1;
  s.tasks.counts.guards = 4;
  s.tasks.active = { id: "steel", base: 0 };
  s.tasks.done = ["sweep"];
  s.talks["npc.keeper.01"] = 2;
  s.player.col = activeArena(s.world).x0 + 1;
  return s;
}

test("the version the game reports is the version it ships as", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version, "src/core/version.js and package.json must agree");
  assert.ok(Number.isInteger(SAVE_VERSION) && SAVE_VERSION >= 1);
});

test("a save carries a manifest that says what it is", () => {
  const save = toSave(walked(), null);
  const m = save.manifest;
  assert.equal(m.game, SAVE_GAME_ID);
  assert.equal(m.version, SAVE_VERSION);
  assert.equal(m.build, VERSION);
  assert.ok(m.savedAt > 0);
  assert.equal(m.at.arena, 3, "and where it resumes, for the start screen");
  assert.equal(m.at.score, 4200);
});

test("a save is plain JSON: it survives a round trip through text", () => {
  const save = toSave(walked(), { kv: { day: 2 }, done: {}, seen: [] });
  const back = JSON.parse(JSON.stringify(save));
  assert.deepEqual(back, JSON.parse(JSON.stringify(save)));
  assert.equal(readSave(back).ok, true);
});

test("the run comes back as it was left", () => {
  const src = walked(4);
  const raw = JSON.parse(JSON.stringify(toSave(src, null)));
  const read = readSave(raw);
  assert.equal(read.ok, true, read.reason);

  const dst = createState({ seed: 1, width: 900, height: 640, modeId: "story" });
  step(dst, 0, [{ type: "startRun", modeId: "story" }]);
  applySave(dst, read.data, []);

  assert.equal(dst.score, src.score);
  assert.equal(dst.deletions, src.deletions);
  assert.equal(dst.timeLeft, src.timeLeft);
  assert.equal(dst.bestChain, src.bestChain);
  assert.equal(dst.arenasCleared, src.arenasCleared);
  assert.equal(dst.routeIdx, src.routeIdx);
  assert.equal(dst.player.col, src.player.col);
  assert.deepEqual(dst.stash, ["bomb", "spell"]);
  assert.equal(dst.bombs, 1, "and the bomb count is rebuilt from the stash");
  assert.deepEqual(dst.tasks.done, ["sweep"]);
  assert.deepEqual(dst.tasks.active, { id: "steel", base: 0 });
  assert.equal(dst.tasks.counts.guards, 4);
  assert.deepEqual(dst.talks, src.talks);
  assert.equal(activeArena(dst.world).idx, activeArena(src.world).idx, "the same arena is live");
  assert.equal(dst.world.segs.length, src.world.segs.length, "the road so far is the same length");
});

test("a tower comes back with its people, rebuilt rather than stored", () => {
  const s = createState({ seed: 3, width: 900, height: 640, modeId: "story" });
  step(s, 0, [{ type: "startRun", modeId: "story" }]);
  const tower = s.world.segs.find((g) => g.kind === "tower");
  assert.ok(tower && tower.npcs.length, "the run opens on a tower with people");
  const raw = JSON.parse(JSON.stringify(toSave(s, null)));
  assert.equal(raw.world.segs[0].npcs, undefined, "the save does not carry them");
  const dst = createState({ seed: 1, width: 900, height: 640, modeId: "story" });
  step(dst, 0, [{ type: "startRun", modeId: "story" }]);
  applySave(dst, readSave(raw).data, []);
  const back = dst.world.segs.find((g) => g.kind === "tower");
  assert.deepEqual(back.npcs, tower.npcs, "but they come back all the same");
});

test("a loaded run draws the numbers the saved one would have drawn", () => {
  const src = walked(2);
  for (let i = 0; i < 25; i++) src.rng();            // some way into the stream
  const raw = JSON.parse(JSON.stringify(toSave(src, null)));
  const expect = [src.rng(), src.rng(), src.rng()];

  const dst = createState({ seed: 12345, width: 900, height: 640, modeId: "story" });
  step(dst, 0, [{ type: "startRun", modeId: "story" }]);
  applySave(dst, readSave(raw).data, []);
  assert.deepEqual([dst.rng(), dst.rng(), dst.rng()], expect, "the stream resumes, it does not rewind");
});

test("a loaded run is at rest: nothing in the air, nothing aiming", () => {
  const src = walked(2);
  addEnemy(src, { col: 5, row: 1, willAttack: true });
  src.bolts.push({ row: 1, x: 10, speed: 1, kind: "slow", radius: 4 });
  src.parry = true;
  const raw = JSON.parse(JSON.stringify(toSave(src, null)));
  const dst = newGame();
  const ev = [];
  applySave(dst, readSave(raw).data, ev);
  assert.deepEqual(dst.enemies, []);
  assert.deepEqual(dst.bolts, []);
  assert.deepEqual(dst.pickups, []);
  assert.equal(dst.wave, null);
  assert.equal(dst.nextSpawnAt, Infinity);
  assert.equal(dst.hop, null);
  assert.equal(dst.parry, false);
  assert.equal(dst.mode, "playing");
  assert.ok(ev.some((e) => e.type === "runLoaded"));
});

test("the manifest version is the gate: newer is refused, unknown older is refused", () => {
  const good = JSON.parse(JSON.stringify(toSave(walked(), null)));
  assert.equal(readSave(good).ok, true);

  const newer = JSON.parse(JSON.stringify(good));
  newer.manifest.version = SAVE_VERSION + 1;
  const r1 = readSave(newer);
  assert.equal(r1.ok, false);
  assert.match(r1.reason, /newer version/);

  const older = JSON.parse(JSON.stringify(good));
  older.manifest.version = 0;
  assert.equal(readSave(older).ok, false, "version zero is not a version");

  const alien = JSON.parse(JSON.stringify(good));
  alien.manifest.game = "some-other-game";
  const r2 = readSave(alien);
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /not a Buster Whack save/);
});

test("rubbish is refused with a reason, never thrown", () => {
  for (const bad of [null, undefined, 0, "", "not json", [], {}, { manifest: {} }]) {
    const r = readSave(bad);
    assert.equal(r.ok, false);
    assert.ok(typeof r.reason === "string" && r.reason.length, "a reason for " + JSON.stringify(bad));
  }
  const truncated = JSON.parse(JSON.stringify(toSave(walked(), null)));
  delete truncated.world;
  assert.match(readSave(truncated).reason, /incomplete/);

  const wrongMode = JSON.parse(JSON.stringify(toSave(walked(), null)));
  wrongMode.run.modeId = "no-such-mode";
  assert.match(readSave(wrongMode).reason, /unknown mode/);
});

test("the story section is carried through untouched, and never read here", () => {
  const story = { kv: { day: 4, "talks.keeper.01": 2 }, done: { "npc.keeper.01": 1 }, seen: ["x"] };
  const raw = JSON.parse(JSON.stringify(toSave(walked(), story)));
  const dst = newGame();
  const back = applySave(dst, readSave(raw).data, []);
  assert.deepEqual(back, story);
});

test("a save is mute: no canon text anywhere in it", () => {
  const raw = JSON.stringify(toSave(walked(), { kv: { day: 1 }, done: {}, seen: [] }));
  // ids and counters only. Nothing in a save should read as a sentence.
  assert.ok(!/[a-z]{3,} [a-z]{3,} [a-z]{3,}/.test(raw.replace(/"[^"]*":/g, "")),
    "no prose in a save file");
});
