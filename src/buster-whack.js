/*!
 * Buster Whack — a virus-busting, whack-a-mole arcade minigame.
 *
 * Usage:
 *   import { mountBusterWhack } from "./buster-whack.js";
 *   const game = mountBusterWhack(document.getElementById("game-container"));
 *   // ...later, if you need to tear it down:
 *   game.destroy();
 *
 * The container element must have a real, non-zero size (set width/height
 * via CSS on your page) — the game fills it completely. Everything is
 * rendered inside a Shadow DOM root, so the game's styles, element IDs and
 * global key/pointer listeners are self-contained and won't collide with
 * the rest of the host page, and multiple instances can be mounted safely.
 *
 * Layout: `src/core/` is the deterministic simulation (no DOM, no audio, no
 * clock, no Math.random) and `src/shell/` performs its effects. See README.
 */

export { mountBusterWhack } from "./shell/mount.js";
export { default } from "./shell/mount.js";
