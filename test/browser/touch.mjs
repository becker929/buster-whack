/*!
 * Browser-level regression harness for the touch/pointer/keyboard shell.
 *
 * The bugs this covers only exist in a real event pipeline — pointer identity
 * across two simultaneous fingers, `touch-action`, non-passive `touchmove`
 * cancellation, and keyboard focus ownership — so jsdom cannot see them. It
 * drives a real Chromium over CDP, whose `Input.dispatchTouchEvent` is the only
 * way to script genuine multi-touch.
 *
 * Deliberately NOT part of `npm test`: Playwright and a Chromium build are far
 * too heavy to be dependencies of a dependency-free game. Install them into a
 * scratch directory outside the repo and point this at them:
 *
 *   mkdir -p /tmp/bw-pw && npm --prefix /tmp/bw-pw install playwright
 *   BW_PLAYWRIGHT=/tmp/bw-pw/node_modules/playwright \
 *   BW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *   node test/browser/touch.mjs
 *
 * Instrumentation: the harness intercepts `src/core/state.js` on the wire and
 * inserts one line publishing the live state object as `globalThis.__bwState`.
 * Nothing in `src/` changes, and every assertion below is made against the real
 * shell wiring exactly as it ships.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CHROMIUM = process.env.BW_CHROMIUM || undefined;

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BW_PLAYWRIGHT || "playwright");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- state tap ----------
// One surgical substitution in a file the game loads anyway. `setLayout` runs
// during mount's first `resize()`, so the tap lands before any input happens.

const TAP_FROM = "  const G = layout(width, height, bottomInset);";
const TAP_TO = "  globalThis.__bwState = state;\n  const G = layout(width, height, bottomInset);";

function tapState(src) {
  const hits = src.split(TAP_FROM).length - 1;
  assert.equal(hits, 1, "state.js no longer contains exactly one setLayout body to tap");
  return src.replace(TAP_FROM, TAP_TO);
}

// ---------- host fixtures ----------
// Served as if they sat in the repo root, so `/src/...` resolves normally.
// Both record `defaultPrevented` for every touchmove that reaches the document,
// which is how we prove the game swallows its own gestures (and, after
// `destroy()`, that it has stopped).

const RECORDER = `
  window.__moves = [];
  document.addEventListener("touchmove", (e) => window.__moves.push(e.defaultPrevented), { passive: true });
`;

const TALL_HOST = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tall host</title>
<style>
  html, body { margin: 0; background: #0d1117; color: #ccc; font: 14px sans-serif; }
  .filler { height: 900px; padding: 20px; }
  #game { width: 100%; height: 560px; }
</style></head><body>
<div class="filler">before</div>
<div id="game"></div>
<div class="filler">after</div>
<script>${RECORDER}</script>
<script type="module">
  import { mountBusterWhack } from "/src/buster-whack.js";
  window.__game = mountBusterWhack(document.getElementById("game"));
</script>
</body></html>`;

const INPUT_HOST = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>input host</title>
<style>
  html, body { margin: 0; background: #0d1117; }
  #hostInput { display: block; width: 90%; margin: 8px auto; font-size: 16px; }
  #game { width: 100%; height: 560px; }
</style></head><body>
<input id="hostInput" value="">
<div id="game"></div>
<script>${RECORDER}</script>
<script type="module">
  import { mountBusterWhack } from "/src/buster-whack.js";
  window.__game = mountBusterWhack(document.getElementById("game"));
</script>
</body></html>`;

// ---------- multi-touch over CDP ----------
// Chromium diffs `touchStart`/`touchMove` against the previously active set, but
// `touchEnd` releases exactly the points it is handed — verified empirically, and
// the reason this is a hand-rolled helper rather than Playwright's touchscreen
// API (which only models a single finger).

function makeTouch(cdp) {
  const active = new Map();
  const point = (id) => {
    const p = active.get(id);
    return { x: Math.round(p.x), y: Math.round(p.y), id, radiusX: 10, radiusY: 10, force: 1 };
  };
  const all = () => [...active.keys()].map(point);
  const send = (type, touchPoints) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  return {
    async down(id, x, y) { active.set(id, { x, y }); await send("touchStart", all()); },
    async move(id, x, y) { active.set(id, { x, y }); await send("touchMove", all()); },
    async up(id) { const p = point(id); await send("touchEnd", [p]); active.delete(id); },
    async cancel() { await send("touchCancel", []); active.clear(); },
    async tap(x, y) { await this.down(99, x, y); await wait(40); await this.up(99); },
  };
}

// ---------- page helpers ----------

function makePage(page, hostId = "game") {
  const snap = () => page.evaluate(() => {
    const s = globalThis.__bwState;
    if (!s) return null;
    return {
      mode: s.mode, paused: s.paused, canFire: s.canFire,
      shots: s.shots, deletions: s.deletions,
      chargeHeld: s.charge.downAt !== null, chargeFull: s.charge.full,
      col: s.player.col, row: s.player.row,
      modeId: s.modeId, queued: s.queuedMove, G: s.G,
    };
  });
  const rect = (id) => page.evaluate(([hostId, id]) => {
    const el = document.getElementById(hostId).shadowRoot.getElementById(id);
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, [hostId, id]);
  // Silence the simulation so nothing but our own input can touch the latch:
  // an enemy bolt landing would spill the charge and make this flaky.
  const quiesce = () => page.evaluate(() => {
    const s = globalThis.__bwState;
    s.nextSpawnAt = Infinity;
    s.enemies.length = 0;
    s.bolts.length = 0;
    s.timeLeft = 1e6;
  });
  // The mode menu: a tap on a row picks that mode and starts it. The ring and
  // the board-as-FIRE only exist in ADVANCE; ONE HAND is the default.
  const modeRow = (id) => page.evaluate(([hostId, id]) => {
    const el = document.getElementById(hostId).shadowRoot.querySelector(`.sp-mode[data-mode="${id}"]`);
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, [hostId, id]);
  return { snap, rect, quiesce, modeRow };
}

/** Start a run in `modeId` from the menu with a touch, and silence the sim. */
async function startMode(t, pageApi, modeId) {
  const row = await pageApi.modeRow(modeId);
  await t.tap(row.cx, row.cy);
  await wait(300);
  const s = await pageApi.snap();
  assert.equal(s.mode, "playing", `tapping the ${modeId} row begins the run`);
  assert.equal(s.modeId, modeId, `…in ${modeId}`);
  await pageApi.quiesce();
}

// ---------- runner ----------

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const cases = [];
const test = (name, fn) => cases.push({ name, fn });

// ============================================================================
// 1. A held charge survives everything except its own release.
// ============================================================================

test("a full ring drag never fires the charge held on FIRE", async (ctx) => {
  const page = await ctx.open("/");
  const api = makePage(page);
  const { snap, rect } = api;
  const t = makeTouch(await ctx.cdp(page));
  await startMode(t, api, "advance");

  const fire = await rect("fireBtn");
  const pad = await rect("dpad");

  // thumb down on FIRE: one normal shot leaves the buster immediately, and the
  // charge starts building
  const before = await snap();
  await t.down(1, fire.x + fire.w * 0.72, fire.y + fire.h * 0.72);
  await wait(120);
  const pressed = await snap();
  assert.equal(pressed.shots, before.shots + 1, "pressing FIRE fires a normal shot");
  assert.equal(pressed.canFire, false, "FIRE is latched down");
  assert.ok(pressed.chargeHeld, "the charge is building");

  await wait(900);   // CHARGE_MS is 700
  const charged = await snap();
  assert.equal(charged.chargeFull, true, "the charge reaches full while FIRE is held");

  // ...and now the *other* thumb rocks all the way around the ring and lifts
  await t.down(2, pad.cx, pad.cy);
  await wait(60);
  await t.move(2, pad.cx, pad.y + 10);                 // up
  await wait(200);
  await t.move(2, pad.x + pad.w - 10, pad.cy);         // right
  await wait(200);
  await t.move(2, pad.cx, pad.y + pad.h - 10);         // down
  await wait(200);
  await t.move(2, pad.x + 10, pad.cy);                 // left
  await wait(200);
  await t.up(2);
  await wait(150);

  const afterRing = await snap();
  assert.notEqual(afterRing.col + "," + afterRing.row, charged.col + "," + charged.row,
    "the ring actually moved the player (otherwise this test proves nothing)");
  assert.equal(afterRing.shots, pressed.shots,
    "*** lifting off the ring must not fire the held charge ***");
  assert.equal(afterRing.chargeFull, true, "the charge is still held after the ring drag");
  assert.equal(afterRing.chargeHeld, true, "the charge is still held after the ring drag");
  assert.equal(afterRing.canFire, false, "the ring drag did not clear the fire latch");

  // releasing FIRE — and only that — spends the charge
  await t.up(1);
  await wait(150);
  const afterFire = await snap();
  assert.equal(afterFire.shots, pressed.shots + 1, "releasing FIRE fires the charged shot");
  assert.equal(afterFire.canFire, true, "the latch clears on the real release");
  assert.equal(afterFire.chargeFull, false);
  assert.equal(afterFire.chargeHeld, false);
});

test("a stray touch outside the controls leaves the charge alone", async (ctx) => {
  const page = await ctx.open("/");
  const api = makePage(page);
  const { snap, rect } = api;
  const t = makeTouch(await ctx.cdp(page));
  await startMode(t, api, "advance");

  const fire = await rect("fireBtn");
  await t.down(1, fire.x + fire.w * 0.72, fire.y + fire.h * 0.72);
  await wait(900);
  const charged = await snap();
  assert.equal(charged.chargeFull, true);

  // a stray thumb on the empty top-left of the stage, away from every control
  // (in ADVANCE the board itself is a FIRE surface, so aim above it)
  const stage = await rect("stage");
  await t.tap(stage.x + 30, stage.y + stage.h * 0.16);
  await wait(150);

  const after = await snap();
  assert.equal(after.shots, charged.shots, "a stray tap must not fire the charge");
  assert.equal(after.canFire, false, "a stray tap must not clear the fire latch");
  assert.equal(after.chargeFull, true, "a stray tap must not spill the charge");
  await t.up(1);
});

test("a pause tap does not clear the fire latch", async (ctx) => {
  const page = await ctx.open("/");
  const api = makePage(page);
  const { snap, rect } = api;
  const t = makeTouch(await ctx.cdp(page));
  await startMode(t, api, "advance");

  const fire = await rect("fireBtn");
  await t.down(1, fire.x + fire.w * 0.72, fire.y + fire.h * 0.72);
  await wait(200);
  const pressed = await snap();
  assert.equal(pressed.canFire, false);

  const pause = await rect("pauseBtn");
  await t.tap(pause.cx, pause.cy);
  await wait(150);
  const paused = await snap();
  assert.equal(paused.paused, true, "the pause tap paused the game");
  assert.equal(paused.canFire, false, "the pause tap must not hand the latch back");
  assert.equal(paused.shots, pressed.shots, "the pause tap must not fire anything");

  await t.tap(pause.cx, pause.cy);   // unpause
  await wait(150);
  assert.equal((await snap()).canFire, false, "still latched — FIRE was never lifted");

  await t.up(1);
  await wait(150);
  assert.equal((await snap()).canFire, true, "lifting FIRE hands the latch back");
});

test("a cancelled pointer can never strand the latch", async (ctx) => {
  const page = await ctx.open("/");
  const api = makePage(page);
  const { snap, rect } = api;
  const t = makeTouch(await ctx.cdp(page));
  await startMode(t, api, "advance");

  const fire = await rect("fireBtn");
  await t.down(1, fire.x + fire.w * 0.72, fire.y + fire.h * 0.72);
  await wait(200);
  assert.equal((await snap()).canFire, false);

  await t.cancel();   // the browser steals the pointer
  await wait(150);
  assert.equal((await snap()).canFire, true, "a cancelled pointer must release the latch");
  assert.equal((await snap()).chargeHeld, false, "and must not leave a charge hanging");
});

// ============================================================================
// 2. Touch gestures stay inside the game.
// ============================================================================

async function drag(t, from, dy = -220, steps = 10) {
  await t.down(7, from.cx, from.cy);
  for (let i = 1; i <= steps; i++) {
    await t.move(7, from.cx, from.cy + (dy * i) / steps);
    await wait(16);
  }
  await t.up(7);
  await wait(120);
}

// The tall host stacks 900px of filler above and below a 560px game in an 860px
// viewport. Park the scroll so the whole game is on screen and there is room to
// scroll in both directions — then never move it again, so any change is a leak.
const HOST_SCROLL = 700;
async function parkTallHost(page) {
  await page.evaluate((y) => window.scrollTo(0, y), HOST_SCROLL);
  await wait(120);
  assert.equal(await page.evaluate(() => window.scrollY), HOST_SCROLL, "host page parked");
}

/** Get past the start card, which is the one surface allowed to scroll itself. */
async function beginRun(ctx, page, rect, modeId = "advance") {
  const t = makeTouch(await ctx.cdp(page));
  await startMode(t, makePage(page), modeId);
  return t;
}

test("dragging the ring cancels its touchmoves and never scrolls the host page", async (ctx) => {
  const page = await ctx.open("/__tall.html");
  const { rect, snap } = makePage(page);
  await parkTallHost(page);
  const t = await beginRun(ctx, page, rect);
  assert.equal((await snap()).mode, "playing");

  const scroll0 = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => { window.__moves.length = 0; });

  await drag(t, await rect("dpad"));

  const moves = await page.evaluate(() => window.__moves.slice());
  const scroll1 = await page.evaluate(() => window.scrollY);
  assert.ok(moves.length > 0, "the drag produced touchmove events");
  assert.ok(moves.every(Boolean),
    `every touchmove on the ring must be defaultPrevented (got ${moves.filter((m) => !m).length} that were not)`);
  assert.equal(scroll1, scroll0, "the host page must not scroll under a ring drag");
});

test("the whole game surface swallows drags, not just the ring", async (ctx) => {
  const page = await ctx.open("/__tall.html");
  const { rect } = makePage(page);
  await parkTallHost(page);
  const t = await beginRun(ctx, page, rect);
  const scroll0 = await page.evaluate(() => window.scrollY);

  for (const id of ["cv", "fireBtn", "pauseBtn", "bwRoot"]) {
    const r = await rect(id);
    const from = id === "bwRoot" ? { cx: r.cx, cy: r.y + r.h - 14 } : r;   // the footer strip
    await page.evaluate(() => { window.__moves.length = 0; });
    await drag(t, from, -160, 8);
    const moves = await page.evaluate(() => window.__moves.slice());
    assert.ok(moves.length > 0, `#${id}: the drag produced touchmove events`);
    assert.ok(moves.every(Boolean), `#${id}: every touchmove must be defaultPrevented`);
  }
  assert.equal(await page.evaluate(() => window.scrollY), scroll0,
    "no drag anywhere on the game scrolled the host page");
});

test("the start card scrolls itself without dragging the host page along", async (ctx) => {
  // #splash is deliberately the one scrollable surface (a short mount can push
  // PRESS START below the fold), so its touchmoves are *not* cancelled — but
  // `overscroll-behavior: contain` must still keep the scroll from chaining out.
  const page = await ctx.open("/__tall.html");
  const { rect } = makePage(page);
  const t = makeTouch(await ctx.cdp(page));
  await parkTallHost(page);
  const scroll0 = await page.evaluate(() => window.scrollY);

  const splash = await rect("splash");
  await drag(t, { cx: splash.cx, cy: splash.cy }, -400, 12);
  await drag(t, { cx: splash.cx, cy: splash.cy }, 400, 12);   // and back, past the top

  assert.equal(await page.evaluate(() => window.scrollY), scroll0,
    "scrolling the start card must not chain into the host page");
});

test("destroy() hands the page back: gestures scroll again", async (ctx) => {
  const page = await ctx.open("/__tall.html");
  const { rect } = makePage(page);
  await parkTallHost(page);
  const t = await beginRun(ctx, page, rect);
  const pad = await rect("dpad");

  // sanity: while mounted, this exact drag is swallowed
  await page.evaluate(() => { window.__moves.length = 0; });
  await drag(t, pad);
  assert.ok((await page.evaluate(() => window.__moves.slice())).every(Boolean),
    "precondition: the mounted game swallows this drag");

  await page.evaluate(() => window.__game.destroy());
  await wait(80);
  assert.equal(await page.evaluate(() => document.getElementById("game").shadowRoot.childElementCount), 0,
    "destroy() empties the shadow root");

  const scroll0 = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => { window.__moves.length = 0; });
  await drag(t, pad);

  const moves = await page.evaluate(() => window.__moves.slice());
  const scroll1 = await page.evaluate(() => window.scrollY);
  assert.ok(moves.length > 0, "the drag still produced touchmove events");
  assert.ok(moves.every((m) => !m), "after destroy() no touchmove may be cancelled any more");
  assert.ok(scroll1 !== scroll0, `after destroy() the same drag scrolls the page (${scroll0} -> ${scroll1})`);
});

// ============================================================================
// 3. The keyboard: works on index.html with no clicks, invisible elsewhere.
// ============================================================================

test("index.html plays from the keyboard with no clicks at all", async (ctx) => {
  const page = await ctx.open("/");
  const { snap, quiesce } = makePage(page);

  assert.equal((await snap()).mode, "ready");
  await page.keyboard.press("Space");
  await wait(200);
  assert.equal((await snap()).mode, "playing", "Space starts the run with nothing focused");
  await quiesce();

  const before = await snap();
  await page.keyboard.press("ArrowRight");
  await wait(200);
  assert.notEqual((await snap()).col, before.col, "ArrowRight moves the player");

  await page.keyboard.press("ArrowDown");
  await wait(600);                       // inside the hop ration: held, then hopped, then committed
  assert.notEqual((await snap()).row, before.row, "ArrowDown moves the player");

  // and Space still charges + fires
  const s0 = await snap();
  await page.keyboard.down("Space");
  await wait(900);
  assert.equal((await snap()).chargeFull, true, "holding Space charges");
  await page.keyboard.up("Space");
  await wait(150);
  assert.equal((await snap()).shots, s0.shots + 2, "Space fired a normal and then a charged shot");
});

test("typing into a host input neither moves the player nor eats the keys", async (ctx) => {
  const page = await ctx.open("/__input.html");
  const { snap, quiesce } = makePage(page);

  await page.keyboard.press("Space");   // nobody focused: the game still takes it
  await wait(200);
  assert.equal((await snap()).mode, "playing");
  await quiesce();

  await page.focus("#hostInput");
  const before = await snap();
  await page.keyboard.type("was d");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await wait(200);

  assert.equal(await page.inputValue("#hostInput"), "was d",
    "the host input received every character, including the space");
  const after = await snap();
  assert.equal(after.col, before.col, "typing must not move the player");
  assert.equal(after.row, before.row, "typing must not move the player");
  assert.equal(after.shots, before.shots, "typing a space must not fire");
  assert.equal(after.paused, before.paused, "typing must not pause");
});

test("interacting with the game takes the keyboard back", async (ctx) => {
  const page = await ctx.open("/__input.html");
  const { snap, rect, quiesce } = makePage(page);

  await page.keyboard.press("Space");
  await wait(200);
  await quiesce();
  // park the player against the left wall so a single ArrowRight is unambiguous
  await page.evaluate(() => { globalThis.__bwState.player.col = 0; });

  await page.focus("#hostInput");
  await page.keyboard.press("ArrowRight");
  await wait(200);
  assert.equal((await snap()).col, 0, "with the input focused, arrows do nothing to the game");

  // one tap on the game's own surface -- the empty stage above the board, so
  // it is neither a square to move to nor a control -- then the keys are the
  // game's again
  const stage = await rect("stage");
  const t = makeTouch(await ctx.cdp(page));
  await t.tap(stage.x + 30, stage.y + stage.h * 0.16);
  await wait(150);
  assert.equal((await snap()).col, 0, "the tap itself moved nothing");

  await page.keyboard.press("ArrowRight");
  await wait(200);
  assert.equal((await snap()).col, 1, "after touching the game, arrows move the player again");
  assert.equal(await page.inputValue("#hostInput"), "", "the arrow keys never reached the input");
});

test("tabbing into the game's controls also hands it the keyboard", async (ctx) => {
  // The stage itself is tabindex="-1" (script-focusable only, so it needs no
  // focus ring); Tab walks the real controls inside the shadow tree instead, and
  // focus landing on any of them counts as the game holding the keyboard.
  const page = await ctx.open("/__input.html");
  const { snap, quiesce } = makePage(page);

  await page.keyboard.press("Space");
  await wait(200);
  await quiesce();
  await page.evaluate(() => { globalThis.__bwState.player.col = 0; });

  await page.focus("#hostInput");
  await page.keyboard.press("ArrowRight");
  await wait(200);
  assert.equal((await snap()).col, 0, "the input still holds the keyboard");

  await page.keyboard.press("Tab");   // out of the input, into the game
  await wait(150);
  assert.equal(await page.evaluate(() => document.activeElement.id), "game",
    "focus moved inside the game's shadow tree");

  await page.keyboard.press("ArrowRight");
  await wait(200);
  assert.equal((await snap()).col, 1, "and the arrows are the game's again");
});

// ============================================================================
// 4. Desktop mouse and trackpad are not collateral damage.
// ============================================================================

test("a mouse held on FIRE charges, and only its own mouseup spends it", async (ctx) => {
  const page = await ctx.open("/", { desktop: true });
  const { snap, rect, quiesce, modeRow } = makePage(page);

  const row = await modeRow("advance");   // the ring only exists in ADVANCE
  await page.mouse.click(row.cx, row.cy);
  await wait(300);
  assert.equal((await snap()).mode, "playing");
  assert.equal((await snap()).modeId, "advance");
  await quiesce();

  const fire = await rect("fireBtn");
  const pad = await rect("dpad");
  const before = await snap();

  await page.mouse.move(fire.x + fire.w * 0.72, fire.y + fire.h * 0.72);
  await page.mouse.down();
  await wait(900);
  const charged = await snap();
  assert.equal(charged.shots, before.shots + 1, "mousedown fires a normal shot");
  assert.equal(charged.chargeFull, true, "holding the button charges");

  // drag the held button clean across the ring and back — pointer capture means
  // the ring never sees it, and nothing releases the charge
  await page.mouse.move(pad.cx, pad.cy, { steps: 10 });
  await wait(150);
  assert.equal((await snap()).shots, charged.shots, "dragging over the ring fires nothing");
  assert.equal((await snap()).chargeFull, true, "and does not spill the charge");

  await page.mouse.up();
  await wait(150);
  const after = await snap();
  assert.equal(after.shots, charged.shots + 1, "mouseup spends the charge");
  assert.equal(after.canFire, true);
});

test("the wheel still scrolls a host page with the cursor over the game", async (ctx) => {
  // `overscroll-behavior` is the obvious tool for touch scroll chaining and the
  // wrong one here: Chromium applies it to the wheel too, even on a box with
  // nothing to scroll, which would trap a host page's scroll under the cursor.
  const page = await ctx.open("/__tall.html", { desktop: true });

  for (const label of ["start card", "in game"]) {
    await page.evaluate(() => window.scrollTo(0, 700));
    await wait(150);
    const y0 = await page.evaluate(() => window.scrollY);
    const c = await page.evaluate(() => {
      const r = document.getElementById("game").getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(c.x, c.y);
    await page.mouse.wheel(0, 300);
    await wait(300);
    assert.ok(await page.evaluate(() => window.scrollY) > y0,
      `the wheel over the game (${label}) must still scroll the host page`);

    if (label === "start card") {
      const r = await makePage(page).rect("spStart");
      await page.mouse.click(r.cx, r.cy);
      await wait(300);
    }
  }
});

// ============================================================================
// 4. ONE HAND: the board moves you, the deck fires, and the two never mix.
// ============================================================================

/** Stage-relative centre of world square (col,row), through the core's layout. */
function squareAt(stage, G, col, row) {
  return { x: stage.x + G.gx + col * G.pw + G.pw / 2, y: stage.y + G.gy + row * G.ph + G.ph / 2 };
}

test("one-hand is the default: PRESS START gives the deck, not the ring", async (ctx) => {
  const page = await ctx.open("/");
  const api = makePage(page);
  const { snap, rect } = api;
  const t = makeTouch(await ctx.cdp(page));
  const start = await rect("spStart");
  await t.tap(start.cx, start.cy);
  await wait(300);
  const s = await snap();
  assert.equal(s.mode, "playing");
  assert.equal(s.modeId, "onehand", "PRESS START launches the default mode");

  const shown = await page.evaluate(() => {
    const root = document.getElementById("game").shadowRoot;
    const css = (id) => getComputedStyle(root.getElementById(id));
    return { dpad: css("dpad").display, deck: css("deck").display, fireRadius: css("fireBtn").borderTopLeftRadius };
  });
  assert.equal(shown.dpad, "none", "no ring in one-hand");
  assert.equal(shown.deck, "block", "the deck is up");
  const stage = await rect("stage"), deck = await rect("deck"), fire = await rect("fireBtn"), bomb = await rect("bombBtn");
  assert.ok(deck.h > 100 && deck.h < stage.h * 0.5, "the deck is the keyboard band, not the whole stage");
  assert.ok(fire.y >= deck.y && fire.h > deck.h * 0.8, "FIRE fills the deck's height");
  assert.ok(fire.w > stage.w * 0.9, "FIRE spans the deck");
  assert.ok(parseFloat(shown.fireRadius) > 10 && parseFloat(shown.fireRadius) < fire.h / 2, "rounded rectangle, not a disc or an arc");
  // the board rests on the deck, and BOMB is a bar just above the board
  const boardTop = stage.y + s.G.gy, boardFoot = boardTop + s.G.ph * 3;
  assert.ok(Math.abs(boardFoot - deck.y) < 1, `the board's foot (${boardFoot}) touches the deck (top ${deck.y})`);
  assert.ok(bomb.y + bomb.h <= boardTop && bomb.y + bomb.h > boardTop - 24, "BOMB sits just above the board");
  assert.ok(Math.abs(bomb.x - (stage.x + s.G.gx)) < 1 && Math.abs(bomb.w - s.G.pw * 6) < 1, "BOMB is as wide as the board");
});

test("one-hand: a tap on a square hops there and never fires; the stick walks", async (ctx) => {
  const page = await ctx.open("/");
  const api = makePage(page);
  const { snap, rect } = api;
  const t = makeTouch(await ctx.cdp(page));
  const start = await rect("spStart");
  await t.tap(start.cx, start.cy);
  await wait(300);
  await api.quiesce();
  const s0 = await snap();
  const stage = await rect("stage");

  // beside you: one hop, committed at the top of the arc
  const p = squareAt(stage, s0.G, 2, 1);
  await t.tap(p.x, p.y);
  await wait(60);
  const mid = await snap();
  assert.equal(mid.col + "," + mid.row, "1,1", "a hop takes time: not there yet");
  await wait(110);                                      // past the commit, still inside the ration
  const s1 = await snap();
  assert.equal(s1.col + "," + s1.row, "2,1", "the tapped square is where you land");
  assert.equal(s1.shots, s0.shots, "the board is not a FIRE surface in one-hand");
  assert.equal(s1.canFire, true, "and it never touched the latch");

  // a second tap inside the ration is held, then taken
  const q = squareAt(stage, s0.G, 2, 2);
  await t.tap(q.x, q.y);
  await wait(30);
  const s2 = await snap();
  assert.equal(s2.col + "," + s2.row, "2,1", "inside the ration nothing moves yet");
  assert.deepEqual(s2.queued, { kind: "to", col: 2, row: 2 }, "the step is held");
  await wait(600);
  const s3 = await snap();
  assert.equal(s3.col + "," + s3.row, "2,2", "the held step lands when the ration ends");

  // further away: a path, one hop per ration, never a teleport
  const far = squareAt(stage, s0.G, 0, 0);
  await t.tap(far.x, far.y);
  await wait(200);
  const walking = await snap();
  assert.notEqual(walking.col + "," + walking.row, "0,0", "two rations in, not there yet");
  assert.ok(walking.col + walking.row < 4, "but under way");
  await wait(1600);
  const arrived = await snap();
  assert.equal(arrived.col + "," + arrived.row, "0,0", "the path walked itself there");

  // the stick: a flick is one step; a hold walks at the ration
  const from = squareAt(stage, s0.G, 0, 0);
  await t.down(4, from.x, from.y);
  await wait(30);
  await t.move(4, from.x + 60, from.y + 6);
  await wait(30);
  await t.up(4);
  await wait(500);
  const s4 = await snap();
  assert.equal(s4.col + "," + s4.row, "1,0", "a flick right is one step right");
  assert.equal(s4.shots, s0.shots, "the stick never fires");

  await t.down(5, from.x, from.y);
  await wait(30);
  await t.move(5, from.x, from.y + 70);                 // push down and hold
  await wait(220);
  const s5 = await snap();
  assert.equal(s5.col + "," + s5.row, "1,1", "the first hop of a hold commits");
  await wait(520);
  const s6 = await snap();
  assert.equal(s6.col + "," + s6.row, "1,2", "a hold walks a hop per ration");
  await t.up(5);
  await wait(500);
  assert.equal((await snap()).col + "," + (await snap()).row, "1,2", "lifting stops the walk at the wall");
});

test("one-hand: a charge held on FIRE survives the stick and a tap on the board", async (ctx) => {
  const page = await ctx.open("/");
  const api = makePage(page);
  const { snap, rect } = api;
  const t = makeTouch(await ctx.cdp(page));
  const start = await rect("spStart");
  await t.tap(start.cx, start.cy);
  await wait(300);
  await api.quiesce();
  const s0 = await snap();
  const stage = await rect("stage");
  const fire = await rect("fireBtn");

  await t.down(1, fire.cx, fire.cy);
  await wait(900);
  const charged = await snap();
  assert.equal(charged.shots, s0.shots + 1, "pressing FIRE fires a normal shot");
  assert.equal(charged.chargeFull, true);

  const a = squareAt(stage, s0.G, 1, 1);
  await t.down(2, a.x, a.y);
  await wait(30);
  await t.move(2, a.x, a.y - 60);          // push the stick up
  await wait(30);
  await t.up(2);
  await wait(100);
  const b = squareAt(stage, s0.G, 0, 0);
  await t.tap(b.x, b.y);
  await wait(500);

  const moved = await snap();
  assert.notEqual(moved.col + "," + moved.row, charged.col + "," + charged.row, "the board thumb moved the player");
  assert.equal(moved.shots, charged.shots, "*** neither the stick nor the tap fired the held charge ***");
  assert.equal(moved.chargeFull, true);
  assert.equal(moved.canFire, false, "the latch is still FIRE's");

  await t.up(1);
  await wait(150);
  const after = await snap();
  assert.equal(after.shots, charged.shots + 1, "releasing FIRE fires the charged shot");
  assert.equal(after.canFire, true);
});

test("one-hand: the FIRE thumb itself can walk while it holds the charge", async (ctx) => {
  const page = await ctx.open("/");
  const api = makePage(page);
  const { snap, rect } = api;
  const t = makeTouch(await ctx.cdp(page));
  const start = await rect("spStart");
  await t.tap(start.cx, start.cy);
  await wait(300);
  await api.quiesce();
  await page.evaluate(() => { globalThis.__bwState.player.col = 1; globalThis.__bwState.player.row = 1; });
  const fire = await rect("fireBtn");

  await t.down(1, fire.cx, fire.cy);
  await wait(900);
  const charged = await snap();
  assert.equal(charged.chargeFull, true, "the charge is held on FIRE");

  await t.move(1, fire.cx, fire.cy - 70);        // push the stick up, without lifting
  await wait(150);
  const up = await snap();
  assert.equal(up.col + "," + up.row, "1,0", "the FIRE thumb steered the player up");
  assert.equal(up.chargeFull, true, "and the charge is still held");
  assert.equal(up.canFire, false, "and the latch is still FIRE's");
  assert.equal(up.shots, charged.shots, "nothing fired");

  await t.move(1, fire.cx + 70, fire.cy - 70);   // rock to the right
  await wait(500);
  const right = await snap();
  assert.equal(right.col + "," + right.row, "2,0", "rocking steps at the ration");

  await t.up(1);
  await wait(150);
  const after = await snap();
  assert.equal(after.shots, charged.shots + 1, "lifting FIRE fires the charged shot");
  assert.equal(after.canFire, true);
  assert.equal(after.col + "," + after.row, "2,0", "a lift on FIRE is never a tap on a square");
});

test("the bar above the board works: TALK beside the keeper, a refusal with no bomb", async (ctx) => {
  const page = await ctx.open("/");
  const api = makePage(page);
  const { snap, rect } = api;
  const t = makeTouch(await ctx.cdp(page));
  await startMode(t, api, "story");
  const s0 = await snap();
  const stage = await rect("stage");
  const say = () => page.evaluate(() => {
    const r = document.getElementById("game").shadowRoot;
    return { on: r.getElementById("say").classList.contains("on"), len: r.getElementById("sayText").textContent.length };
  });
  const label = () => page.evaluate(() => document.getElementById("game").shadowRoot.getElementById("bombLabel").textContent);

  // an empty stash: the press is refused, visibly
  const bomb = await rect("bombBtn");
  assert.equal(await label(), "BOMB");
  await t.tap(bomb.cx, bomb.cy);
  await wait(60);
  assert.equal(await page.evaluate(() => document.getElementById("game").shadowRoot.getElementById("bombBtn").classList.contains("deny")), true,
    "the bar shakes on an empty press");

  // beside the keeper the same bar is TALK, and a press puts a line up at
  // once, interrupting the arrival beats still showing
  const p = squareAt(stage, s0.G, 2, 1);
  await t.tap(p.x, p.y);
  await wait(300);
  assert.equal((await snap()).col, 2);
  assert.equal(await label(), "TALK");
  const before = await page.evaluate(() => document.getElementById("game").shadowRoot.getElementById("sayText").textContent);
  await t.tap(bomb.cx, bomb.cy);
  await wait(250);
  const line = await say();
  assert.equal(line.on, true, "TALK put a line over the board");
  assert.ok(line.len > 0);
  const after = await page.evaluate(() => document.getElementById("game").shadowRoot.getElementById("sayText").textContent);
  assert.notEqual(after, before, "the keeper's line replaced the arrival beat");
  assert.equal((await snap()).shots, s0.shots, "the bar never fires the buster");
});

// ---------- driver ----------

async function freePort() {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

async function main() {
  const port = await freePort();
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
    cwd: ROOT, stdio: "ignore",
  });
  const origin = `http://127.0.0.1:${port}`;
  await wait(700);

  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const open = [];
  const sessions = new Map();

  const ctx = {
    async open(pathname, o = {}) {
      const context = await browser.newContext(o.desktop
        ? { hasTouch: false, viewport: { width: 900, height: 800 } }
        : { hasTouch: true, isMobile: false, viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      open.push(context);
      await page.route("**/src/core/state.js", async (route) => {
        const res = await route.fetch();
        await route.fulfill({ body: tapState(await res.text()), contentType: "text/javascript" });
      });
      await page.route("**/__tall.html", (route) =>
        route.fulfill({ body: TALL_HOST, contentType: "text/html" }));
      await page.route("**/__input.html", (route) =>
        route.fulfill({ body: INPUT_HOST, contentType: "text/html" }));
      page.on("pageerror", (e) => { throw e; });
      await page.goto(origin + pathname, { waitUntil: "load" });
      await page.waitForFunction(() => !!globalThis.__bwState, null, { timeout: 5000 });
      await page.bringToFront();
      return page;
    },
    async cdp(page) {
      if (!sessions.has(page)) sessions.set(page, await page.context().newCDPSession(page));
      return sessions.get(page);
    },
  };

  let failed = 0;
  for (const c of cases) {
    if (only.length && !only.some((o) => c.name.includes(o))) continue;
    try {
      await c.fn(ctx);
      console.log(`  ok   ${c.name}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${c.name}`);
      console.log("       " + String(e.message).split("\n").join("\n       "));
    }
    while (open.length) await open.pop().close().catch(() => {});
    sessions.clear();
  }

  await browser.close();
  server.kill();

  const ran = cases.filter((c) => !only.length || only.some((o) => c.name.includes(o))).length;
  console.log(`\n${ran - failed}/${ran} browser checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
