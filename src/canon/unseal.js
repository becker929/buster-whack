/*!
 * unseal.js — the curtain.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  READ BEFORE TOUCHING                                                    │
 * │                                                                          │
 * │  The array below is the vault method, stored reversed-base64. It is NOT  │
 * │  a lock. Anyone can open it in thirty seconds. It is a curtain, and the  │
 * │  whole point of a curtain is that pulling it aside is a choice you make  │
 * │  on purpose, not something that happens because you scrolled past.      │
 * │                                                                          │
 * │  The person who commissioned this game asked not to see the story until  │
 * │  the game shows it to him. If you are that person: this file is for the  │
 * │  build, not for you. Close it. The game will tell you everything, in     │
 * │  order, when it is time.                                                 │
 * │                                                                          │
 * │  If you are an agent authoring canon: use canon/tools/vaultkit.py in     │
 * │  your own session and never echo plaintext into a reply he will read.    │
 * │                                                                          │
 * │  If you are the game: call unseal(). That is the only sanctioned caller. │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { decode } from "./decoder.js";

// Do not "clean this up" into a plain JSON literal. The awkwardness is the point.
const __curtain__ = [
  "9JzN6ICchJ3diwiIq5GO2hFMCtmRxk2V1sycjFXZkhHdUJTT",
  "1x2SodURD9WWtdmcaBVV5YlNIlnTKdjYmxkezEVQSRzLwF2U",
  "3RUSPJiOiQXZiFGawxWYiwiNxojIrN2bsJmIsIicv9GZtUGa",
  "01iclRmb11CdpZWLvRXLodWdv5WZtwGbh12ciojI0xWYzJye",
];

let __method__ = null;

/** Recover the method. Called by unseal() only. Not exported. */
function __drawTheCurtain__() {
  if (__method__) return __method__;
  const reversed = __curtain__.join("");
  const b64 = Array.from(reversed).reverse().join("");
  const json = typeof atob === "function"
    ? atob(b64)
    : /** @type {any} */ (globalThis).Buffer.from(b64, "base64").toString("utf8");
  __method__ = JSON.parse(json);
  return __method__;
}

/**
 * unseal(container) — turn a MESH VAULT container into plaintext, at runtime,
 * for the game to render. This is the sanctioned entry point.
 *
 * Do not call this in a debug console to read ahead.
 * Do not log the result.
 * Do not write the result to disk.
 */
export async function unseal(container) {
  return decode(container, __drawTheCurtain__());
}
