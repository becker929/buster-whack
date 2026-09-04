// The curve probe: play the road headlessly and report what it felt like.
//
//   node tools/curve.mjs [--arenas 60] [--runs 8] [--skill 1] [--json]
//
// A bot drives the core through the story road at a fixed skill, and every
// arena it finishes is one row of measurement: how long it took, how far the
// pulse fell, how much fire it walked into, what it was shooting at. Balance
// arguments are then about numbers instead of memories.
//
// The bot is deliberately simple and deterministic: it shoots the nearest
// thing in its lane, charges when the target needs it, spares runners, steps
// out of a lane a bolt is crossing, and walks right when the arena is taken.
// `skill` is its reaction time in frames, so the same road can be measured as
// a good player and as a poor one.
//
// Nothing here runs in the game or in CI's gate; it is a measuring tool.

import { createState } from "../src/core/state.js";
import { step } from "../src/core/step.js";
import * as C from "../src/core/constants.js";
import { activeArena, safeZone, walkable } from "../src/core/world.js";
import { moveTo } from "../src/core/movement.js";
import { enemyDef } from "../src/core/enemies.js";

const DT = 16;
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i === -1 ? dflt : Number(args[i + 1]);
};
const ARENAS = opt("arenas", 60), RUNS = opt("runs", 8), SKILL = opt("skill", 1);
const JSON_OUT = args.includes("--json");
// --tune KEY=VAL[,KEY=VAL...]: measure a candidate set without editing tuning.js
const tuneArg = args.indexOf("--tune");
const OVERRIDES = {};
if (tuneArg !== -1 && args[tuneArg + 1]) {
  for (const pair of args[tuneArg + 1].split(",")) {
    const [k, v] = pair.split("=");
    OVERRIDES[k.trim()] = Number(v);
  }
}

/** Is this thing worth a shot, and does it need a charged one? */
function threat(e) {
  const def = enemyDef(e.type);
  if (def.friendly) return null;
  if (e.state !== "up" && e.state !== "rising") return null;
  return { charged: def.armor === "steel" || (e.hp || 1) > 1, def };
}

/** The bot's one decision per frame, as the intents a player would send. */
function decide(s, react) {
  const acts = [];
  const arena = activeArena(s.world);
  const me = s.player;

  // 1. a bolt crossing my lane and close enough to matter: leave the lane
  const danger = s.bolts.some((b) => {
    if (b.row !== me.row) return false;
    const p = C.panelRect(s.G, me.col, me.row);
    const gap = b.x - (p.x + p.w / 2);
    return gap > 0 && gap < s.G.pw * (1.2 + react);
  });
  if (danger) {
    const dr = me.row > 0 ? -1 : 1;
    acts.push({ type: "move", dc: 0, dr });
    return acts;
  }

  // 2. anything shootable ahead in my lane: fire, charging first if it needs it
  let inLane = null;
  for (const e of s.enemies) {
    if (e.row !== me.row || e.col <= me.col) continue;
    if (!threat(e)) continue;
    if (!inLane || e.col < inLane.col) inLane = e;
  }
  if (inLane) {
    const t = threat(inLane);
    if (t.charged && !s.charge.full) {
      if (s.charge.downAt === null) acts.push({ type: "firePressed" });
      return acts;                                  // hold it until it is ready
    }
    if (s.charge.downAt === null) acts.push({ type: "firePressed" });
    acts.push({ type: "fireReleased" });
    return acts;
  }
  if (s.charge.downAt !== null && !s.charge.full) return acts;  // keep charging

  // 3. nothing in this lane: step toward the lane that has the nearest target
  let want = null;
  for (const e of s.enemies) {
    if (e.col <= me.col || !threat(e)) continue;
    if (!want || e.col < want.col) want = e;
  }
  if (want && want.row !== me.row) {
    acts.push({ type: "move", dc: 0, dr: want.row > me.row ? 1 : -1 });
    return acts;
  }

  // 4. nothing to shoot: walk right. A tap, not a push -- towers have people
  // standing on them and a straight line walks into one; the game's own
  // pathfinder is what a player would use to get round. Aim at the furthest
  // square that is actually standable, trying the near rows first.
  if (!s.path) {
    for (let c = me.col + 8; c > me.col; c--) {
      let placed = false;
      for (const r of [me.row, me.row + 1, me.row - 1, me.row + 2, me.row - 2]) {
        if (r < 0 || r >= C.ROWS || !walkable(s.world, c, r)) continue;
        moveTo(s, c, r, []);
        if (s.path) { placed = true; break; }
      }
      if (placed) break;
    }
  }
  return acts;
}

function playOne(seed, arenas) {
  const s = createState({ seed, width: 900, height: 640, modeId: "story", tuning: OVERRIDES });
  step(s, 0, [{ type: "startRun", modeId: "story" }]);
  const rows = [];
  let idx = activeArena(s.world).idx, t0 = 0, lowPulse = s.timeLeft, hits = 0, shots = 0, kills = 0;
  let contested = 0, spent = 0, gained = 0, prevPulse = s.timeLeft;
  const seen = new Set();
  let frames = 0;
  const cap = arenas * 4000;                     // a hard stop, in frames
  while (frames < cap && s.mode !== "over" && rows.length < arenas) {
    const before = s.timeLeft;
    const events = step(s, DT, decide(s, SKILL));
    frames++;
    if (!safeZone(s.world)) contested += DT;
    const d = s.timeLeft - before;
    if (d < 0) spent -= d; else gained += d;
    prevPulse = s.timeLeft;
    for (const ev of events) {
      if (ev.type === "shot") shots++;
      if (ev.type === "playerHit") hits++;
      if (ev.type === "hit") kills++;
      if (ev.type === "enemySpawned") seen.add(ev.enemyType);
    }
    if (s.timeLeft < lowPulse) lowPulse = s.timeLeft;
    const now = activeArena(s.world).idx;
    if (now !== idx) {
      rows.push({
        arena: idx,
        seconds: +(((frames * DT) - t0) / 1000).toFixed(2),
        contested: +(contested / 1000).toFixed(2),
        spent: +spent.toFixed(2),
        gained: +gained.toFixed(2),
        lowPulse: +lowPulse.toFixed(2),
        endPulse: +s.timeLeft.toFixed(2),
        hits, shots, kills,
        types: [...seen].sort().join("+") || "-",
      });
      idx = now; t0 = frames * DT; lowPulse = s.timeLeft;
      hits = 0; shots = 0; kills = 0; contested = 0; spent = 0; gained = 0; seen.clear();
    }
  }
  return { rows, died: s.mode === "over", atArena: idx, score: s.score };
}

const runs = [];
for (let r = 0; r < RUNS; r++) runs.push(playOne(100 + r, ARENAS));

// fold the runs into one row per arena
const byArena = new Map();
for (const run of runs) for (const row of run.rows) {
  const acc = byArena.get(row.arena) || { arena: row.arena, n: 0, seconds: 0, contested: 0, spent: 0, gained: 0, lowPulse: 0, hits: 0, shots: 0, kills: 0, types: new Set() };
  acc.n++; acc.seconds += row.seconds; acc.lowPulse += row.lowPulse;
  acc.contested += row.contested; acc.spent += row.spent; acc.gained += row.gained;
  acc.hits += row.hits; acc.shots += row.shots; acc.kills += row.kills;
  for (const t of row.types.split("+")) if (t !== "-") acc.types.add(t);
  byArena.set(row.arena, acc);
}
const table = [...byArena.values()].sort((a, b) => a.arena - b.arena).map((a) => ({
  arena: a.arena,
  seconds: +(a.seconds / a.n).toFixed(2),
  contested: +(a.contested / a.n).toFixed(2),
  spent: +(a.spent / a.n).toFixed(2),
  gained: +(a.gained / a.n).toFixed(2),
  lowPulse: +(a.lowPulse / a.n).toFixed(2),
  hitsPerArena: +(a.hits / a.n).toFixed(2),
  killsPerArena: +(a.kills / a.n).toFixed(2),
  accuracy: a.shots ? +(a.kills / a.shots).toFixed(2) : 0,
  types: [...a.types].sort().join("+"),
}));
const deaths = runs.filter((r) => r.died).length;

if (JSON_OUT) {
  console.log(JSON.stringify({ runs: RUNS, skill: SKILL, deaths, table }, null, 2));
} else {
  const names = Object.keys(OVERRIDES);
  console.log(`curve: ${RUNS} runs, skill ${SKILL}, ${deaths} died` + (names.length ? `, tuned ${names.map((k) => k + "=" + OVERRIDES[k]).join(" ")}` : ""));
  console.log("arena  secs  fight  spent  gained  lowPulse  hits  kills  acc   what is on the road");
  for (const r of table) {
    console.log(
      String(r.arena).padStart(5) +
      String(r.seconds).padStart(6) +
      String(r.contested).padStart(7) +
      String(r.spent).padStart(7) +
      String(r.gained).padStart(8) +
      String(r.lowPulse).padStart(10) +
      String(r.hitsPerArena).padStart(6) +
      String(r.killsPerArena).padStart(7) +
      String(r.accuracy).padStart(6) + "   " + r.types);
  }
}
