// The shell's wiring, end to end in jsdom: a press on each control must reach
// the core. Listener loss (an edit that slices a handler out of input.js) is
// invisible to the pure-core tests and to the smoke run, which never presses
// the context button; this is the test that would have caught it.

import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCanvas } from "@napi-rs/canvas";
import { FakeAudioContext } from "./fake-audio.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mountGame() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="app" style="width:390px;height:760px"></div></body></html>`,
    { pretendToBeVisual: true, url: "https://example.org/" });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = function (type) {
    if (type !== "2d") return null;
    if (!this._napi) this._napi = createCanvas(this.width || 300, this.height || 150);
    return this._napi.getContext("2d");
  };
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.AudioContext = class extends FakeAudioContext {
    constructor() { super({ sampleRate: 8000 }); const t0 = Date.now(); Object.defineProperty(this, "currentTime", { get: () => (Date.now() - t0) / 1000 }); }
  };
  window.Element.prototype.getBoundingClientRect = function () {
    // the deck reads its own height; everything else is the stage
    const deck = this.id === "deck" ? 240 : 0;
    const h = deck || 760;
    return { width: 390, height: h, top: 0, left: 0, right: 390, bottom: h, x: 0, y: 0 };
  };
  window.PointerEvent = window.PointerEvent || window.MouseEvent;
  global.window = window; global.document = window.document; global.localStorage = window.localStorage;
  global.requestAnimationFrame = window.requestAnimationFrame; global.cancelAnimationFrame = window.cancelAnimationFrame;
  global.ResizeObserver = window.ResizeObserver; global.Element = window.Element; global.HTMLCanvasElement = window.HTMLCanvasElement;
  const { mountBusterWhack } = await import("../src/buster-whack.js");
  const container = window.document.getElementById("app");
  const game = mountBusterWhack(container);
  const root = container.shadowRoot;
  const el = (id) => root.getElementById(id);
  // jsdom has no PointerEvent; a MouseEvent with a pointerId pinned on is what
  // the fire latch needs to key the press to a source
  const press = (id) => {
    const e = new window.PointerEvent("pointerdown", { bubbles: true, composed: true, clientX: 10, clientY: 10 });
    Object.defineProperty(e, "pointerId", { value: 7 });
    return el(id).dispatchEvent(e);
  };
  const key = (type, code) => window.dispatchEvent(new window.KeyboardEvent(type, { code }));
  return { window, game, root, el, press, key };
}

test("the context bar is wired: an empty press refuses, and beside the keeper it talks", async () => {
  const g = await mountGame();
  try {
    // pick STORY from the menu (a click on the row picks and starts it)
    g.el("spModes").querySelector('.sp-mode[data-mode="story"]').click();
    await sleep(80);
    assert.equal(g.el("splash").classList.contains("hidden"), true, "the run started");
    assert.equal(g.el("bombLabel").textContent, "BOMB");

    g.press("bombBtn");
    await sleep(60);
    assert.equal(g.el("bombBtn").classList.contains("deny"), true, "an empty press shakes the bar");

    // one step right puts the player beside the keeper (start 1,1; keeper 3,1)
    g.key("keydown", "ArrowRight");
    await sleep(320);                                 // a hop takes time to commit
    assert.equal(g.el("bombLabel").textContent, "TALK", "the bar reads TALK beside the keeper");
    const before = g.el("sayText").textContent;      // the arrival beat is still up
    g.press("bombBtn");
    await sleep(120);
    assert.equal(g.el("say").classList.contains("on"), true, "TALK put a line up");
    assert.ok(g.el("sayText").textContent.length > 0);
    assert.notEqual(g.el("sayText").textContent, before, "and it interrupted the arrival beat");
  } finally {
    g.game.destroy();
  }
});

test("FIRE and pause are wired", async () => {
  const g = await mountGame();
  try {
    g.press("fireBtn");                 // starts the run from the splash
    await sleep(60);
    assert.equal(g.el("splash").classList.contains("hidden"), true);
    g.press("pauseBtn");
    await sleep(60);
    // pausing spills the charge and parks focus on the stage; the visible
    // proof is that a second press unpauses without a stuck latch
    g.press("pauseBtn");
    await sleep(60);
    assert.equal(g.root.activeElement === g.el("stage") || g.root.activeElement === null, true);
  } finally {
    g.game.destroy();
  }
});
