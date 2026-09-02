// The event vocabulary is the contract between the core and every shell that
// hangs behaviour off it (audio, DOM, juice). Lock the names down.

import test from "node:test";
import assert from "node:assert/strict";
import { newGame, addEnemy, fire, fireCharged, step, typesOf, find, C } from "./helpers.mjs";
import { statsView, hudView, accuracyText, interlevelView, gameOverView } from "../src/core/select.js";

const VOCABULARY = new Set([
  "runStarted", "statsChanged", "paused", "unpaused", "resumed", "stageGate", "gameOver",
  "chargeReady", "shot", "whiff", "hit", "guardBlocked", "hopperStagger", "hopperHop",
  "progHit", "chainBroken", "multiplierUp", "playerHit", "playerMoved",
  "enemySpawned", "enemyAim", "enemyFired", "enemyEscaped", "allySpared",
  "waveStart", "waveEnded",
  "arenaEntered", "arenaCleared",
]);

test("a long random run only ever emits known event types", () => {
  const s = newGame({ spawn: true, seed: 5 });
  const seen = new Set();
  for (let i = 0; i < 4000; i++) {
    const actions = [];
    if (i % 5 === 0) actions.push({ type: "firePressed" });
    if (i % 5 === 2) actions.push({ type: "fireReleased" });
    if (i % 9 === 0) actions.push({ type: "move", dc: 0, dr: i % 18 === 0 ? 1 : -1 });
    if (i % 3 === 0) actions.push({ type: "resume" });
    if (s.mode === "over") actions.push({ type: "startRun" });
    for (const t of typesOf(step(s, 16, actions))) {
      assert.ok(VOCABULARY.has(t), "unknown event type: " + t);
      seen.add(t);
    }
  }
  // the run is long enough to exercise most of the vocabulary
  for (const t of ["shot", "hit", "whiff", "enemySpawned", "enemyEscaped", "statsChanged",
                   "waveStart", "waveEnded", "chainBroken"]) {
    assert.ok(seen.has(t), "expected a " + t + " event somewhere in the run");
  }
});

test("every audible moment has an event", () => {
  // shot / charged
  let s = newGame();
  assert.equal(find(fire(s), "shot").tier, "normal");
  s = newGame();
  assert.equal(find(fireCharged(s), "shot").tier, "charged");

  // hit variants
  for (const type of ["mett", "guard", "rare", "hopper"]) {
    const g = newGame();
    addEnemy(g, { type });
    const ev = fireCharged(g);
    const hit = find(ev, "hit");
    assert.equal(hit.enemyType, type);
    assert.ok(typeof hit.x === "number" && typeof hit.y === "number", "hits carry a position");
  }

  // guard plink, hopper stagger + hop
  const g = newGame();
  addEnemy(g, { type: "guard" });
  assert.ok(find(fire(g), "guardBlocked"));
  const h = newGame();
  addEnemy(h, { type: "hopper" });
  const hev = fire(h);
  assert.ok(find(hev, "hopperStagger"));
  assert.ok(find(hev, "hopperHop"));

  // charge ready
  const c = newGame();
  step(c, 0, [{ type: "firePressed" }]);
  assert.ok(find(step(c, C.CHARGE_MS, []), "chargeReady"));

  // aim / bolt / hurt, for both bolts
  for (const [type, kind] of [["mett", "slow"], ["hopper", "fast"]]) {
    const a = newGame();
    a.deletions = C.ATTACK_START + 4;
    addEnemy(a, { type, state: "rising", t0: a.clock, willAttack: true });
    assert.ok(find(step(a, C.RISE_MS, []), "enemyAim"), type);
    let fired = null;
    for (let i = 0; i < 120 && !fired; i++) fired = find(step(a, 16, []), "enemyFired");
    assert.ok(fired, type + " fired");
    assert.equal(fired.kind, kind);
    a.bolts[0].row = a.player.row;
    a.bolts[0].x = C.panelRect(a.G, a.player.col, a.player.row).x + a.G.pw / 2;
    assert.ok(find(step(a, 16, []), "playerHit"), type + " connected");
  }

  // rare spawn is announced as it leads a wave in
  const r = newGame({ spawn: true, seed: 4 });
  r.stageIdx = C.UNLOCK.rare;                // the jackpot card has been shown
  r.deletions = 130;
  r.timeLeft = 5;                            // desperation raises the odds
  let sawRare = false;
  for (let i = 0; i < 6000 && !sawRare; i++) {
    for (const ev of step(r, 16, [])) {
      if (ev.type === "enemySpawned" && ev.enemyType === "rare") sawRare = true;
    }
    r.timeLeft = 5;
    r.enemies.length = 0;
  }
  assert.ok(sawRare, "rares spawn and announce themselves");

  // prog hit, stage gate, game over
  const p = newGame();
  addEnemy(p, { type: "ally" });
  assert.ok(find(fire(p), "progHit"));
  const st = newGame();
  st.deletions = C.STAGES[0].at - 1;
  st.waveIdx = C.STAGES[0].wave;
  addEnemy(st, { type: "mett" });
  assert.ok(find(fire(st), "stageGate"));
  const o = newGame();
  o.timeLeft = 0.001;
  assert.ok(find(step(o, 20, []), "gameOver"));
});

test("selectors describe the state without touching it", () => {
  const s = newGame();
  s.score = 1234; s.deletions = 9; s.bestChain = 6; s.shots = 10; s.whiffs = 2;
  s.chain = 12; s.timeLeft = 12.34; s.best = 9000;

  assert.deepEqual(statsView(s), {
    deletions: "9", bestChain: "6", accuracy: "80%", best: "9000",
  });
  assert.equal(accuracyText({ shots: 0, whiffs: 0 }), "—");

  const hud = hudView(s);
  assert.equal(hud.score, "001234");
  assert.equal(hud.mult, 3);
  assert.equal(hud.level, C.level(9));
  assert.equal(hud.overclock, false);
  assert.equal(hud.timeFrac, 12.34 / C.TIME_CAP);

  const il = interlevelView(s, C.STAGES[0], C.STAGE_BONUS);
  assert.equal(il.title, C.STAGES[0].title);
  assert.ok(il.rows.some((r) => r[0] === "stage bonus" && r[1] === "+2.0s"));

  s.rank = "A";
  const go = gameOverView(s);
  assert.equal(go.title, "A");
  assert.ok(go.rows.some((r) => r[0] === "best score" && r[1] === 9000));

  assert.equal(s.score, 1234, "selectors are read-only");
});
