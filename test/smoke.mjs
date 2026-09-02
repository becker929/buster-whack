import { JSDOM } from "jsdom";
import { createCanvas } from "@napi-rs/canvas";

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
window.AudioContext = class {
  constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
  createOscillator() { return { type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  resume() {}
  close() {}
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

console.log("post-play OK");
game.destroy();
console.log("destroy OK, shadow children after destroy:", container.shadowRoot.children.length);
console.log("SMOKE TEST PASSED");
