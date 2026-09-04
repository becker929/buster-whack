// Play a real session in a real browser: mount the game, drive it with key and
// pointer input the way a player would, and screenshot what happens.
//
//   BW_PLAYWRIGHT=<path to playwright> BW_CHROMIUM=<path to chrome> \
//   node tools/play.mjs                       # shots land in /tmp/bw-play
//
// This is not a test and CI does not run it. It is for sitting down with the
// game and seeing what a run actually does -- which is how the crash in the
// context button's label was found, at a beat no unit test reached.
//
// The bot is crude on purpose: shoot what is in the lane, charge for the
// armoured ones, step out of a lane a bolt is crossing, talk to whoever is
// standing there, and walk right. It paces itself to the game's own step
// ration, because pressing faster than that only queues moves.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.BW_SHOTS || "/tmp/bw-play";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BW_PLAYWRIGHT || "playwright");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });
const PORT = 8931;
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: ROOT, stdio: "ignore" });
await wait(700);

const browser = await chromium.launch({ executablePath: process.env.BW_CHROMIUM });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });

// publish the live state so the player below can see the board, exactly as the
// browser tests do -- one line inserted on the wire, nothing in src/ changed
await page.route("**/src/core/state.js", async (route) => {
  const res = await route.fetch();
  const body = (await res.text()).replace(
    "  const G = layout(width, height, bottomInset);",
    "  globalThis.__bwState = state;\n  const G = layout(width, height, bottomInset);");
  await route.fulfill({ response: res, body, headers: { ...res.headers(), "content-type": "application/javascript" } });
});

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "load" });
await wait(600);

const shot = (name) => page.screenshot({ path: path.join(OUT, name + ".png") });
const el = (id) => page.evaluate((i) => {
  const e = document.getElementById("game").shadowRoot.getElementById(i);
  const r = e.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}, id);
const look = () => page.evaluate(() => {
  const s = globalThis.__bwState;
  if (!s) return null;
  const seg = s.world.segs[s.world.segs.length - 1];
  return {
    mode: s.mode, score: s.score, timeLeft: s.timeLeft, deletions: s.deletions,
    col: s.player.col, row: s.player.row, chain: s.chain, bestChain: s.bestChain,
    arenas: s.arenasCleared, stash: s.stash.slice(), bombs: s.bombs,
    enemies: s.enemies.map((e) => ({ t: e.type, c: e.col, r: e.row, st: e.state, aim: !!e.willAttack && !e.fired })),
    bolts: s.bolts.map((b) => ({ r: b.row, x: Math.round(b.x) })),
    segKind: seg.kind, segX0: seg.x0, segCols: seg.cols, owner: seg.owner,
    gx: s.G.gx, pw: s.G.pw, gy: s.G.gy, ph: s.G.ph,
    npc: (function () {
      for (const g of s.world.segs) if (g.kind === "tower") for (const n of g.npcs || [])
        if (Math.abs(n.col - s.player.col) <= 1 && n.row === s.player.row) return n.id;
      return null;
    })(),
  };
});

await shot("01-start");
console.log("start screen up");

// press start
const st = await el("spStart");
await page.mouse.click(st.cx, st.cy);
await wait(500);
console.log("began:", JSON.stringify(await look()).slice(0, 160));
await shot("02-first-tower");

// --- play ---
const key = (k) => page.keyboard.press(k);
const fire = async (hold = 0) => { await page.keyboard.down("Space"); await wait(hold || 30); await page.keyboard.up("Space"); };
const context = () => key("KeyB", 50);

// The board is a tap surface in story mode: tapping a square walks there,
// routing round whoever is standing in the way. That is how a person plays it.
const cv = await el("cv");
const tapSquare = async (col, row) => {
  const s = await look();
  await page.mouse.click(cv.x + s.gx + (col + 0.5) * s.pw, cv.y + s.gy + (row + 0.5) * s.ph);
};

let best = null, shots = 0, talks = 0;
let stuckAt = null, stuckFor = 0;
const PCOLS = 3;

for (let step = 0; step < 520; step++) {
  const s = await look();
  if (!s) break;
  if (s.mode !== "playing") { console.log("run ended at step", step, "mode", s.mode); break; }
  best = s;

  // a bolt about to arrive in this lane: leave it
  const px = s.gx + (s.col + 0.5) * s.pw;
  if (s.bolts.some((b) => b.r === s.row && b.x > px && b.x - px < s.pw * 2.4)) {
    await key(s.row > 0 ? "ArrowUp" : "ArrowDown", 40);
    await wait(230);          // the step ration: pressing faster only queues
    continue;
  }

  const live = s.enemies.filter((e) => e.t !== "ally" && e.st === "up");
  if (live.length) {
    const inLane = live.filter((e) => e.r === s.row && e.c > s.col);
    if (inLane.length) {
      const tough = inLane.some((e) => e.t === "guard" || e.t === "sentinel" || e.t === "hopper");
      await fire(tough ? 760 : 0);
      shots++;
      await wait(tough ? 160 : 110);
    } else {
      await key(live[0].r > s.row ? "ArrowDown" : "ArrowUp", 40);
      await wait(230);
    }
    continue;
  }

  // safe ground and someone to talk to: hear them out
  if (s.npc && talks < 30) { await context(); talks++; await wait(160); continue; }

  // walk right. On a tower the people stand in the middle row, so drop a lane
  // first and walk past them; in an arena stay inside the player's columns.
  const limit = s.segKind === "arena" ? s.segX0 + PCOLS - 1 : s.segX0 + s.segCols - 1;
  if (s.col >= limit) {
    // at the edge of what we may stand on: if it is a road or a taken arena,
    // the next segment is further right, so tap past it
    await tapSquare(Math.min(s.col + 3, limit + 4), s.row);
    await wait(300);
    continue;
  }
  // walk right; if something is standing in the way, change lane and try again
  // A press that is blocked still spends the step ration, so a lane change
  // has to be its own paced action rather than a second press in the same
  // beat. Notice being stuck, then step aside on the next one.
  const here = s.col + "," + s.row;
  if (here === stuckAt) stuckFor++; else { stuckAt = here; stuckFor = 0; }
  if (stuckFor >= 2) {
    await key(s.row === 2 ? "ArrowUp" : "ArrowDown", 40);
    await wait(300);
    stuckFor = 0;
    continue;
  }
  await key("ArrowRight", 40);
  await wait(300);
  if (step % 40 === 0) {
    console.log("t", step, "seg", s.segKind, "x0", s.segX0, "limit", limit, "at", s.col + "," + s.row,
                "npc", s.npc, "enemies", s.enemies.length, "clock", s.timeLeft.toFixed(1));
  }
  if (step % 150 === 0) await shot("03-playing-" + String(step).padStart(4, "0"));
}

const end = await look();
console.log("FINAL", JSON.stringify(end && {
  mode: end.mode, score: end.score, arenas: end.arenas, deletions: end.deletions,
  timeLeft: Number(end.timeLeft.toFixed(1)), bestChain: end.bestChain, stash: end.stash,
}));
console.log("shots fired:", shots, "conversations advanced:", talks);
await shot("04-end");

await browser.close();
server.kill();
