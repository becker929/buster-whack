// Tuning as data: the schema is complete and sane, the defaults reproduce the
// shipped game exactly, an override changes what it says it changes, and no
// module still reads a tunable from constants.js behind the schema's back.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TUNING_SCHEMA, TUNING_ENTRIES, TUNING_KEYS, resolveTuning, defaultTuning, defaultValues } from "../src/core/tuning.js";
import { createState } from "../src/core/state.js";
import { step } from "../src/core/step.js";
import { newGame, snapshot, find, T } from "./helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every entry has a key, bounds that contain its default, a step, a unit and a group", () => {
  assert.ok(TUNING_ENTRIES.length > 80, "the schema covers the game (" + TUNING_ENTRIES.length + ")");
  const seen = new Set();
  for (const e of TUNING_ENTRIES) {
    assert.match(e.key, /^[A-Z][A-Z0-9_]+$/, e.key);
    assert.ok(!seen.has(e.key), "duplicate key " + e.key); seen.add(e.key);
    assert.ok(Number.isFinite(e.default) && Number.isFinite(e.min) && Number.isFinite(e.max), e.key + " numbers");
    assert.ok(e.min <= e.default && e.default <= e.max, e.key + " default within bounds");
    assert.ok(e.step > 0 && e.step <= e.max - e.min, e.key + " step");
    assert.equal(typeof e.unit, "string");
    assert.equal(typeof e.desc, "string");
    assert.ok(TUNING_SCHEMA.some(([g]) => g === e.group));
  }
  assert.deepEqual(TUNING_KEYS, TUNING_ENTRIES.map((e) => e.key));
});

test("the default tuning is the shipped game: a long run is byte-identical with and without it", () => {
  const a = newGame({ spawn: true, seed: 11 });
  const b = createState({ seed: 11, width: 800, height: 600, tuning: defaultValues() });
  step(b, 0, [{ type: "startRun", modeId: "classic" }]);
  const acts = (i) => {
    const out = [];
    if (i % 7 === 0) out.push({ type: "firePressed" });
    if (i % 7 === 3) out.push({ type: "fireReleased" });
    if (i % 11 === 0) out.push({ type: "move", dc: 0, dr: i % 22 ? 1 : -1 });
    return out;
  };
  // newGame silences the spawner; give both the same spawner
  a.nextSpawnAt = a.clock + 500; b.nextSpawnAt = b.clock + 500;
  for (let i = 0; i < 1500; i++) { step(a, 16, acts(i)); step(b, 16, acts(i)); }
  assert.equal(snapshot(a), snapshot(b));
  assert.equal(a.tuning.version, "default");
  assert.equal(b.tuning.version, "default", "explicit defaults are still the default version");
});

test("an override changes exactly what it names: a shorter charge is ready sooner", () => {
  const slow = newGame();
  const quick = createState({ seed: 1, width: 800, height: 600, tuning: { CHARGE_MS: 300 } });
  step(quick, 0, [{ type: "startRun", modeId: "classic" }]);
  quick.nextSpawnAt = Infinity; quick.enemies.length = 0;
  for (const s of [slow, quick]) step(s, 16, [{ type: "firePressed" }]);
  const readyAt = (s) => { let t = 16; while (t < 2000) { if (find(step(s, 16, []), "chargeReady")) return t; t += 16; } return Infinity; };
  const tq = readyAt(quick), ts = readyAt(slow);
  assert.ok(tq >= 300 - 16 && tq <= 320, "quick charge ready near 300ms, got " + tq);
  assert.ok(ts >= T.CHARGE_MS - 16 && ts <= T.CHARGE_MS + 16, "the default near " + T.CHARGE_MS + ", got " + ts);
  assert.notEqual(quick.tuning.version, "default");
  assert.deepEqual(quick.tuning.overrides, { CHARGE_MS: 300 });
});

test("overrides are clamped to their bounds, coerced, and unknown keys are dropped", () => {
  const t = resolveTuning({ CHARGE_MS: "99999", TIME_CAP: -5, NOT_A_KEY: 12, START_TIME: "abc" });
  assert.equal(t.CHARGE_MS, 2000);
  assert.equal(t.TIME_CAP, 10);
  assert.equal(t.START_TIME, 30, "an unparseable value keeps the default");
  assert.equal("NOT_A_KEY" in t.values, false);
  assert.deepEqual(Object.keys(t.overrides).sort(), ["CHARGE_MS", "TIME_CAP"]);
  assert.ok(Object.isFrozen(t));
  // the same overrides give the same version, in any order
  assert.equal(resolveTuning({ TIME_CAP: -5, CHARGE_MS: 99999 }).version, t.version);
  assert.notEqual(resolveTuning({ CHARGE_MS: 1000 }).version, t.version);
});

test("tables and ramps are assembled from the scalars", () => {
  const t = resolveTuning({ SENTINEL_2_HP: 5, BOLT_SLOW_AIM_BASE: 1000, UNLOCK_GUARD: 3, POOL_BASE: 9 });
  assert.equal(t.SENTINEL[2].hp, 5);
  assert.equal(t.SENTINEL[1].hp, defaultTuning().SENTINEL[1].hp);
  assert.equal(t.BOLT.slow.aimMs(0), 1000);
  assert.equal(t.aimMs(0, "slow"), 1000);
  assert.equal(t.STORY_UNLOCK.guard, 3);
  assert.equal(t.arenaPlan(0).pool, 9);
  assert.equal(t.HOP_TOTAL_MS, t.HOP_WINDUP_MS + t.HOP_MOVE_MS + t.HOP_SETTLE_MS);
  // the shipped ramps, spot-checked against the numbers they replaced
  const d = defaultTuning();
  assert.equal(d.upMs(0), 1250); assert.equal(d.upMs(100), 520);
  assert.equal(d.level(12), 3);
  assert.equal(d.bonusFactor(169), 1); assert.ok(d.bonusFactor(200) < 1);
  assert.equal(d.waveLullMs(0, false), 1900); assert.equal(d.waveLullMs(0, true), 1330);
  assert.equal(d.guardWaveChance(0), 0.4);
  assert.equal(d.attackChance(0), 0); assert.equal(d.attackChance(12), 0.24);
  assert.equal(d.dodgeWindowMs(12, "slow"), 560 + (3 - 0.28) * 300);
});

test("no module reads a tunable from constants.js behind the schema's back", () => {
  const names = [...TUNING_KEYS, "PTS", "BONUS", "SENTINEL", "STORY_UNLOCK", "ADV_UNLOCK", "unlockTable",
                 "HOP_TOTAL_MS", "HOP_COMMIT_MS", "BOLT", "aimMs", "boltPanelMs", "dodgeWindowMs", "attackChance",
                 "upMs", "bonusFactor", "arenaPlan", "waveStaggerMs", "waveLullMs", "waveClearBonus",
                 "guardWaveChance", "hopperWaveChance", "allyWaveChance", "rareWaveChance", "sentinelWaveChance"];
  const re = new RegExp("\\bC\\.(" + names.join("|") + ")\\b");
  const imp = new RegExp("import \\{[^}]*\\b(" + names.join("|") + ")\\b[^}]*\\} from \"[./]*constants\\.js\"");
  const files = [];
  for (const dir of ["src/core", "src/shell", "tools/visual"]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith(".js")) files.push(path.join(dir, f));
  }
  for (const f of files) {
    if (f.endsWith("tuning.js") || f.endsWith("constants.js")) continue;
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    const m = src.match(re);
    assert.equal(m, null, f + " reads C." + (m && m[1]) + " -- read it from state.tuning");
    const n = src.match(imp);
    assert.equal(n, null, f + " imports " + (n && n[1]) + " from constants.js -- it is tuning");
  }
  // and constants.js no longer defines them
  const cs = fs.readFileSync(path.join(ROOT, "src/core/constants.js"), "utf8");
  for (const n of names) {
    if (n === "level") continue;
    assert.equal(new RegExp("^export (const|function) " + n + "\\b", "m").test(cs), false, "constants.js still defines " + n);
  }
});
