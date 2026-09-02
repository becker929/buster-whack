import { JSDOM } from "jsdom";
import { createCanvas } from "@napi-rs/canvas";
import { FakeAudioContext } from "./fake-audio.mjs";

const audioContexts = [];

const dom = new JSDOM(`<!doctype html><html><body><div id="app" style="width:800px;height:600px"></div></body></html>`, {
  pretendToBeVisual: true,
  url: "https://example.org/",
});
const { window } = dom;

// Patch canvas support: jsdom has no real 2D context, so back it with @napi-rs/canvas.
window.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type !== "2d") return null;
  if (!this._napiCanvas) {
    this._napiCanvas = createCanvas(this.width || 300, this.height || 150);
  }
  return this._napiCanvas.getContext("2d");
};

// Minimal shims jsdom doesn't provide.
window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.ResizeObserver = class { observe() {} disconnect() {} };
// The recording fake from the audio tests, so the smoke run exercises the real
// audio shell end to end — including the music scheduler's timer.
window.AudioContext = class extends FakeAudioContext {
  constructor() {
    super({ sampleRate: 8000 });
    audioContexts.push(this);
    // the game reads currentTime to place notes; let it advance with the clock
    const t0 = Date.now();
    Object.defineProperty(this, "currentTime", { get: () => (Date.now() - t0) / 1000 });
  }
};
window.Element.prototype.getBoundingClientRect = function () {
  return { width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 };
};

global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
global.requestAnimationFrame = window.requestAnimationFrame;
global.cancelAnimationFrame = window.cancelAnimationFrame;
global.ResizeObserver = window.ResizeObserver;
global.Element = window.Element;
global.HTMLCanvasElement = window.HTMLCanvasElement;

const { mountBusterWhack } = await import("../src/buster-whack.js");

const container = window.document.getElementById("app");
const game = mountBusterWhack(container);
console.log("mounted OK, shadow children:", container.shadowRoot.children.length);

// Simulate: press fire to start the run, wait a few frames, move, fire again.
const root = container.shadowRoot;
const fireBtn = root.getElementById("fireBtn");
const dispatchPointerDown = (el) => el.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));

dispatchPointerDown(fireBtn); // starts game from splash
await new Promise((r) => setTimeout(r, 100));
dispatchPointerDown(fireBtn); // fires a shot
await new Promise((r) => setTimeout(r, 200));

window.dispatchEvent(new window.KeyboardEvent("keydown", { code: "ArrowRight" }));
await new Promise((r) => setTimeout(r, 100));

// Actually start a run so the audio shell is exercised: the music transport,
// a held charge, mute, and the interlevel/game-over transitions all hang off it.
const key = (type, code) => window.dispatchEvent(new window.KeyboardEvent(type, { code }));
key("keydown", "Space");                              // starts the run from the splash
await new Promise((r) => setTimeout(r, 60));
key("keyup", "Space");
key("keydown", "Space");                              // hold to charge
await new Promise((r) => setTimeout(r, 900));
key("keyup", "Space");                                // charged release
key("keydown", "KeyM"); key("keyup", "KeyM");         // mute
await new Promise((r) => setTimeout(r, 120));
key("keydown", "KeyM"); key("keyup", "KeyM");         // and back
key("keydown", "KeyP"); key("keyup", "KeyP");         // pause
await new Promise((r) => setTimeout(r, 120));
key("keydown", "KeyP"); key("keyup", "KeyP");
await new Promise((r) => setTimeout(r, 300));
console.log("run OK");

console.log("post-play OK");
const ac = audioContexts[0];
if (!ac) throw new Error("the run never created an AudioContext");
console.log("audio OK, nodes built:", ac.nodes.length, "sources:", ac.sources.length);

game.destroy();
console.log("destroy OK, shadow children after destroy:", container.shadowRoot.children.length);

// destroy() must leave nothing running: no live source, no open context. If a
// scheduler timer survived, node would not exit either.
if (!ac.closed) throw new Error("destroy() left the AudioContext open");
const stuck = ac.sources.filter((s) => s.started !== null && s.stopped === null);
if (stuck.length) throw new Error(`destroy() left ${stuck.length} source(s) running`);
console.log("audio teardown OK");

console.log("SMOKE TEST PASSED");
