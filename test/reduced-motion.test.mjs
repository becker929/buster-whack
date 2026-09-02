// The renderer cannot read matchMedia (it never touches a DOM), so the shell
// must read it and hand the answer to the core as data. Without this wiring
// `state.reducedMotion` silently stays false and the accessibility damping is
// dead code — which is exactly what happened before this test existed.

import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCanvas } from "@napi-rs/canvas";
import { FakeAudioContext } from "./fake-audio.mjs";
import { mountBusterWhack } from "../src/buster-whack.js";

function mountWith(matches) {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="app" style="width:800px;height:600px"></div></body></html>`,
    { pretendToBeVisual: true, url: "https://example.org/" },
  );
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = function (type) {
    if (type !== "2d") return null;
    if (!this._c) this._c = createCanvas(this.width || 300, this.height || 150);
    return this._c.getContext("2d");
  };
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.AudioContext = FakeAudioContext;
  window.Element.prototype.getBoundingClientRect = () => ({
    width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600,
  });

  const asked = [];
  const listeners = [];
  window.matchMedia = (q) => {
    asked.push(q);
    return {
      matches: matches && /prefers-reduced-motion/.test(q),
      media: q,
      addEventListener: (t, fn) => listeners.push(fn),
      removeEventListener: (t, fn) => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
    };
  };
  const el = window.document.getElementById("app");
  const game = mountBusterWhack(el, { seed: 7 });
  return { game, el, asked, listeners, window };
}

test("the shell asks the platform about reduced motion", () => {
  const { game, asked } = mountWith(false);
  // destroy() in a finally: a mounted game keeps jsdom's rAF timers alive, so
  // an assertion escaping here would hang the whole test process, not just fail.
  try {
    assert.ok(
      asked.some((q) => q.includes("prefers-reduced-motion")),
      "mount never consulted matchMedia, so the damping can never switch on",
    );
  } finally {
    game.destroy();
  }
});

test("the mid-run OS toggle is subscribed to, and unsubscribed on destroy", () => {
  const { game, listeners } = mountWith(false);
  try {
    assert.equal(listeners.length, 1, "expected one change listener while mounted");
  } finally {
    game.destroy();
  }
  assert.equal(listeners.length, 0, "destroy() must remove the media-query listener");
});
