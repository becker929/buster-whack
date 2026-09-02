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
 */

const TEMPLATE = `
<style>
  :host {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 320px;
    --bw-field: #1b2233;
    --bw-panel: #232c42;
    --bw-line: #2f3a57;
    --bw-ink: #aab4ce;
    --bw-ink-dim: #5f6b8c;
    --bw-accent: #45e0e8;
    --bw-mega: #4f8dff;
    --bw-warn: #ff5470;
    --bw-oc: #ff9f45;
  }
  * { box-sizing: border-box; margin: 0; }
  .bw-root {
    height: 100%;
    width: 100%;
    background: var(--bw-field);
    color: var(--bw-ink);
    font: 13px/1.5 ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    -webkit-user-select: none;
    user-select: none;
  }

  main {
    position: relative;
    flex: 1;
    min-height: 0;
    touch-action: manipulation;
    container-type: size;
    container-name: bwstage;
  }
  canvas { display: block; width: 100%; height: 100%; cursor: crosshair; }

  /* Analog ring: whole disc is touchable, no gaps. Center 2/5R is neutral;
     rock the finger outward to move, diagonals press two directions. */
  #dpad {
    position: absolute;
    left: 12px;
    bottom: 12px;
    width: 168px;
    height: 168px;
    border-radius: 50%;
    border: 2px solid var(--bw-mega);
    background: rgba(79, 141, 255, 0.10);
    touch-action: none;
    cursor: pointer;
  }
  #dpad.live { background: rgba(79, 141, 255, 0.20); }
  #dpad .hub {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 40%;   /* neutral zone: radius = 2/5 of ring radius */
    height: 40%;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: 1px dashed rgba(79, 141, 255, 0.45);
    pointer-events: none;
  }
  #dpad .arr {
    position: absolute;
    color: var(--bw-mega);
    font: 700 16px/1 ui-monospace, Menlo, Consolas, monospace;
    opacity: 0.7;
    pointer-events: none;
  }
  #dpad .arr.on { opacity: 1; color: #c9f6ff; text-shadow: 0 0 8px var(--bw-mega); }
  #aUp    { top: 10px;  left: 50%; transform: translateX(-50%); }
  #aDown  { bottom: 10px; left: 50%; transform: translateX(-50%); }
  #aLeft  { left: 12px; top: 50%; transform: translateY(-50%); }
  #aRight { right: 12px; top: 50%; transform: translateY(-50%); }

  #fireBtn {
    position: absolute;
    right: 0;
    bottom: 0;
    width: min(46vw, 200px);
    height: min(46vw, 200px);
    border: none;
    border-top: 2px solid var(--bw-accent);
    border-left: 2px solid var(--bw-accent);
    border-radius: 100% 0 0 0;   /* quarter circle, bleeds off both edges */
    background: rgba(69, 224, 232, 0.10);
    color: var(--bw-accent);
    font: 700 14px/1.3 ui-monospace, Menlo, Consolas, monospace;
    letter-spacing: 0.12em;
    cursor: pointer;
    touch-action: manipulation;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 22% 0 0 22%;   /* bias label toward the visible arc's center */
  }
  #fireBtn:active { background: rgba(69, 224, 232, 0.25); }
  #fireBtn:focus-visible { outline: 2px solid var(--bw-accent); outline-offset: 3px; }

  #pauseBtn {
    position: absolute;
    right: 18px;
    top: 14px;
    width: 40px;
    height: 40px;
    border-radius: 6px;
    border: 1px solid var(--bw-line);
    background: rgba(35, 44, 66, 0.8);
    color: var(--bw-ink-dim);
    font: 700 13px/1 ui-monospace, Menlo, Consolas, monospace;
    cursor: pointer;
    touch-action: manipulation;
  }
  #pauseBtn:focus-visible { outline: 2px solid var(--bw-accent); outline-offset: 2px; }

  footer {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 22px;
    padding: 8px 14px;
    background: var(--bw-panel);
    border-top: 1px solid var(--bw-line);
    font-size: 11px;
    letter-spacing: 0.04em;
  }
  footer .stat b { color: var(--bw-ink); font-weight: 600; }
  footer .stat span { color: var(--bw-ink-dim); }

  /* splash / interlevel / game-over overlay */
  #overlay {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      radial-gradient(ellipse at 50% 38%, rgba(79, 141, 255, 0.12), transparent 62%),
      rgba(27, 34, 51, 0.92);
    touch-action: manipulation;
  }
  #overlay.hidden { display: none; }
  .ov-inner {
    text-align: center;
    padding: 24px;
    max-width: 480px;
    animation: bwOvIn 260ms ease-out;
  }
  @keyframes bwOvIn {
    from { opacity: 0; transform: translateY(12px) scale(0.97); }
    to   { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) { .ov-inner { animation: none; } }
  .ov-eyebrow {
    color: var(--bw-oc);
    font-size: 12px;
    letter-spacing: 0.3em;
    margin-bottom: 10px;
  }
  .ov-title {
    color: var(--bw-accent);
    font-size: 34px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-shadow: 0 0 18px rgba(69, 224, 232, 0.55);
    margin-bottom: 8px;
  }
  .ov-title.rank { font-size: 64px; }
  .ov-sub {
    color: var(--bw-ink);
    font-size: 13px;
    line-height: 1.8;
    margin-bottom: 16px;
    white-space: pre-line;
  }
  .ov-stats {
    display: inline-block;
    text-align: left;
    color: var(--bw-ink-dim);
    font-size: 12px;
    line-height: 1.9;
    margin-bottom: 20px;
  }
  .ov-stats b { color: var(--bw-ink); font-weight: 600; }
  .ov-stats b.big { color: var(--bw-accent); font-size: 20px; }
  .ov-btns { display: flex; gap: 12px; justify-content: center; }
  .ov-btns button {
    font: 700 13px/1 ui-monospace, Menlo, Consolas, monospace;
    letter-spacing: 0.12em;
    padding: 14px 24px;
    border-radius: 8px;
    cursor: pointer;
    border: 2px solid var(--bw-accent);
    background: rgba(69, 224, 232, 0.10);
    color: var(--bw-accent);
    touch-action: manipulation;
  }
  .ov-btns button.dim {
    border-color: var(--bw-line);
    color: var(--bw-ink-dim);
    background: rgba(35, 44, 66, 0.6);
  }
  .ov-btns button:active { background: rgba(69, 224, 232, 0.25); }
  .ov-btns button:focus-visible { outline: 2px solid var(--bw-accent); outline-offset: 2px; }

  /* ---------- attract-mode start screen ---------- */
  /* Arcade title card over a cyberspace grid: perspective floor, CRT
     scanlines, and a Mega Man-style two-tone block logo. Sized in cqw
     against #stage so it scales with the mount, not the viewport. */
  #splash {
    position: absolute;
    inset: 0;
    z-index: 12;
    display: flex;
    overflow: auto;
    background: #080b14;
    touch-action: manipulation;
    cursor: pointer;
  }
  #splash.hidden { display: none; }

  /* cyberspace floor, scrolling toward the viewer */
  .sp-floor {
    position: absolute;
    left: -60%;
    right: -60%;
    bottom: 0;
    height: 62%;
    background-image:
      repeating-linear-gradient(to right, rgba(69, 224, 232, 0.75) 0 1px, transparent 1px 60px),
      repeating-linear-gradient(to bottom, rgba(96, 160, 255, 0.85) 0 1px, transparent 1px 46px);
    transform: perspective(300px) rotateX(64deg);
    transform-origin: 50% 100%;
    -webkit-mask-image: linear-gradient(to bottom,
      transparent 0%, rgba(0, 0, 0, 0.7) 24%, #000 58%, rgba(0, 0, 0, 0.4) 100%);
    mask-image: linear-gradient(to bottom,
      transparent 0%, rgba(0, 0, 0, 0.7) 24%, #000 58%, rgba(0, 0, 0, 0.4) 100%);
    animation: bwFloor 1.5s linear infinite;
    pointer-events: none;
  }
  @keyframes bwFloor { to { background-position: 0 0, 0 46px; } }

  /* horizon glow + fade so the grid dissolves into the dark instead of ending */
  .sp-haze {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(58% 30% at 50% 46%, rgba(79, 141, 255, 0.40), transparent 72%),
      radial-gradient(70% 46% at 50% 42%, rgba(8, 11, 20, 0.86), transparent 72%),
      linear-gradient(to bottom, #080b14 0 34%, rgba(8, 11, 20, 0.5) 44%, rgba(8, 11, 20, 0) 62%);
    pointer-events: none;
  }

  /* CRT: fixed scanlines, a slow bloom sweep, and a vignette */
  .sp-crt {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      repeating-linear-gradient(to bottom, rgba(0, 0, 0, 0.26) 0 1px, transparent 1px 3px),
      radial-gradient(120% 90% at 50% 50%, transparent 52%, rgba(0, 0, 0, 0.62) 100%);
  }
  .sp-crt::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 26%;
    background: linear-gradient(to bottom, transparent, rgba(140, 240, 255, 0.07), transparent);
    animation: bwSweep 7s linear infinite;
  }
  @keyframes bwSweep { from { top: -28%; } to { top: 100%; } }

  .sp-inner {
    position: relative;
    z-index: 1;
    margin: auto;
    width: 100%;
    max-width: 460px;
    padding: 20px 18px 22px;
    text-align: center;
  }

  /* arcade score header */
  .sp-hud {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--bw-ink-dim);
    margin-bottom: 14px;
  }
  .sp-hud b { color: var(--bw-oc); font-weight: 700; }
  .sp-hud .live { color: var(--bw-accent); animation: bwBlink 1s steps(1, end) infinite; }

  .sp-badge {
    display: inline-block;
    font-size: 9px;
    letter-spacing: 0.32em;
    color: var(--bw-accent);
    border: 1px solid rgba(69, 224, 232, 0.35);
    border-radius: 2px;
    padding: 4px 10px 3px;
    margin-bottom: 12px;
    background: rgba(69, 224, 232, 0.06);
  }

  /* two-tone block logo with a hard mid-band split, arcade marquee style */
  .sp-logo {
    font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
    font-weight: 900;
    line-height: 0.94;
    margin: 0 0 12px;
    animation: bwShake 8s ease-in-out infinite;
  }
  .sp-word {
    display: block;
    position: relative;
    letter-spacing: 0.08em;
    color: transparent;
    background-clip: text;
    -webkit-background-clip: text;
  }
  .sp-w1 {
    font-size: clamp(30px, 13cqw, 56px);
    background-image: linear-gradient(180deg, #dffaff 0 44%, #45e0e8 44% 52%, #1878c4 52% 100%);
    filter:
      drop-shadow(0 3px 0 #05080f)
      drop-shadow(0 0 12px rgba(69, 224, 232, 0.65));
  }
  .sp-w2 {
    font-size: clamp(36px, 16cqw, 70px);
    background-image: linear-gradient(180deg, #fff6d8 0 44%, #ffd23f 44% 52%, #e07a10 52% 100%);
    filter:
      drop-shadow(0 3px 0 #05080f)
      drop-shadow(0 0 14px rgba(255, 159, 69, 0.6));
  }
  /* chromatic ghosts, idle at zero and flicked on by the glitch cycle */
  .sp-word::before,
  .sp-word::after {
    content: attr(data-t);
    position: absolute;
    inset: 0;
    background: none;
    opacity: 0;
  }
  .sp-word::before { color: var(--bw-warn); animation: bwGhostA 8s steps(1, end) infinite; }
  .sp-word::after  { color: var(--bw-accent); animation: bwGhostB 8s steps(1, end) infinite; }
  @keyframes bwShake {
    0%, 90%, 100% { transform: none; }
    91% { transform: translateX(-3px) skewX(-1.5deg); }
    93% { transform: translateX(3px); }
    95% { transform: translateX(-1px) skewX(1deg); }
  }
  @keyframes bwGhostA {
    0%, 90%, 96%, 100% { opacity: 0; transform: none; }
    91%, 94% { opacity: 0.55; transform: translate(-4px, 1px); }
  }
  @keyframes bwGhostB {
    0%, 90%, 96%, 100% { opacity: 0; transform: none; }
    92%, 95% { opacity: 0.5; transform: translate(4px, -1px); }
  }

  .sp-rule {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 9px;
    letter-spacing: 0.34em;
    color: var(--bw-ink-dim);
    margin-bottom: 16px;
  }
  .sp-rule::before,
  .sp-rule::after {
    content: "";
    flex: 1;
    height: 1px;
    background: linear-gradient(to right, transparent, var(--bw-line), transparent);
  }

  /* control legend as keycaps */
  .sp-keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 5px 8px;
    font-size: 10px;
    color: var(--bw-ink-dim);
    margin-bottom: 18px;
  }
  .sp-keys span { display: inline-flex; align-items: center; gap: 4px; }
  .sp-keys kbd {
    font: 700 9px/1 ui-monospace, Menlo, Consolas, monospace;
    color: var(--bw-ink);
    background: rgba(35, 44, 66, 0.95);
    border: 1px solid var(--bw-line);
    border-bottom-width: 2px;
    border-radius: 3px;
    padding: 3px 5px;
  }

  .sp-start {
    font: 700 14px/1 ui-monospace, Menlo, Consolas, monospace;
    letter-spacing: 0.24em;
    color: #04181f;
    padding: 14px 30px;
    border: 0;
    border-radius: 4px;
    background: linear-gradient(180deg, #b6f7fb 0 46%, #45e0e8 46% 100%);
    box-shadow:
      0 0 0 2px #05080f,
      0 0 0 4px rgba(69, 224, 232, 0.45),
      0 0 26px rgba(69, 224, 232, 0.45);
    cursor: pointer;
    touch-action: manipulation;
    animation: bwBlink 1.15s steps(1, end) infinite;
  }
  .sp-start:active { transform: translateY(1px); }
  .sp-start:focus-visible { outline: 2px solid #fff; outline-offset: 4px; }
  @keyframes bwBlink { 0%, 62% { opacity: 1; } 63%, 100% { opacity: 0.45; } }

  .sp-coin {
    font-size: 9px;
    letter-spacing: 0.28em;
    color: var(--bw-ink-dim);
    text-shadow: 0 0 6px #080b14, 0 0 12px #080b14;
    margin-top: 14px;
  }

  /* Short mounts shed the card from the bottom up, so PRESS START never
     falls below the fold: first the spacing, then the roster, then the keys. */
  @container bwstage (max-height: 620px) {
    .sp-inner { padding: 12px 16px 14px; }
    .sp-w1 { font-size: clamp(24px, 11cqw, 42px); }
    .sp-w2 { font-size: clamp(28px, 13cqw, 52px); }
    .sp-hud, .sp-badge, .sp-logo { margin-bottom: 9px; }
    .sp-rule { margin-bottom: 11px; }
    .sp-keys { margin-bottom: 13px; }
    .sp-start { padding: 12px 26px; }
    .sp-coin { margin-top: 10px; }
    .sp-floor { height: 48%; opacity: 0.5; }
  }
  @container bwstage (max-height: 430px) {
    .sp-floor { opacity: 0.32; }
  }
  @container bwstage (max-height: 340px) {
    .sp-keys, .sp-badge { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .sp-floor, .sp-crt::after, .sp-logo, .sp-word::before, .sp-word::after,
    .sp-start, .sp-hud .live { animation: none; }
    .sp-word::before, .sp-word::after { opacity: 0; }
  }
</style>

<div class="bw-root">
  <main id="stage">
    <canvas id="cv"></canvas>

    <div id="overlay" class="hidden">
      <div class="ov-inner">
        <div id="ovEyebrow" class="ov-eyebrow"></div>
        <div id="ovTitle" class="ov-title"></div>
        <div id="ovSub" class="ov-sub"></div>
        <div id="ovStats" class="ov-stats"></div>
        <div id="ovBtns" class="ov-btns"></div>
      </div>
    </div>

    <div id="splash" class="hidden" aria-label="Start screen">
      <div class="sp-floor" aria-hidden="true"></div>
      <div class="sp-haze" aria-hidden="true"></div>
      <div class="sp-crt" aria-hidden="true"></div>

      <div class="sp-inner">
        <div class="sp-hud">
          <span>HI-SCORE <b id="spBest">000000</b></span>
          <span class="live">CREDIT 01</span>
        </div>

        <div class="sp-badge">V-BUSTER SYSTEM ONLINE</div>

        <h1 class="sp-logo">
          <span class="sp-word sp-w1" data-t="BUSTER">BUSTER</span>
          <span class="sp-word sp-w2" data-t="WHACK">WHACK</span>
        </h1>

        <div class="sp-rule">CONTROLS</div>


        <div class="sp-keys">
          <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</span>
          <span><kbd>SPACE</kbd> fire &#183; hold to charge</span>
          <span><kbd>P</kbd> pause</span>
          <span><kbd>M</kbd> mute</span>
        </div>

        <button id="spStart" class="sp-start">PRESS START</button>
        <div class="sp-coin">INSERT COIN &#183; CYBERSPACE 2026</div>
      </div>
    </div>

    <div id="dpad" role="application" aria-label="Move (touch ring; arrow keys / WASD also work)">
      <span class="hub"></span>
      <span class="arr" id="aUp">&#9650;</span>
      <span class="arr" id="aLeft">&#9664;</span>
      <span class="arr" id="aRight">&#9654;</span>
      <span class="arr" id="aDown">&#9660;</span>
    </div>

    <button id="pauseBtn" aria-label="Pause">II</button>
    <button id="fireBtn" aria-label="Fire">FIRE<br>&#9679;</button>
  </main>

  <footer>
    <div class="stat"><span>deletions</span> <b id="sDel">0</b></div>
    <div class="stat"><span>best chain</span> <b id="sChain">0</b></div>
    <div class="stat"><span>accuracy</span> <b id="sAcc">—</b></div>
    <div class="stat"><span>best</span> <b id="sBest">0</b></div>
    <div class="stat"><span>sound</span> <b id="sSnd">on</b></div>
  </footer>
</div>
`;

/**
 * Mount Buster Whack into a container element.
 * @param {HTMLElement} container - element to render into (must have a size).
 * @param {object} [options]
 * @param {string} [options.storageKey="bw_best"] - localStorage key for the best score.
 * @returns {{ destroy: () => void }}
 */
export function mountBusterWhack(container, options = {}) {
  if (!(container instanceof Element)) {
    throw new TypeError("mountBusterWhack: container must be a DOM element");
  }
  const storageKey = options.storageKey || "bw_best";

  const root = container.shadowRoot || container.attachShadow({ mode: "open" });
  root.innerHTML = TEMPLATE;
  const $ = (id) => root.getElementById(id);

  let destroyed = false;
  let rafId = null;
  let resizeObserver = null;
  const cleanupFns = [];
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanupFns.push(() => target.removeEventListener(type, fn, opts));
  }

  // ---------- easing ----------

  const EASE = {
    linear: (p) => p,
    out2:   (p) => 1 - (1 - p) ** 2,
    out3:   (p) => 1 - (1 - p) ** 3,
  };

  // ---------- impulse envelope ----------

  class Impulse {
    constructor(spec) { this.spec = spec; this.t0 = -Infinity; }
    trigger(now) { this.t0 = now; }
    value(now) {
      const sp = this.spec;
      const attack = sp.attackMs || 0;
      const over = sp.overshoot || 0;
      const rebound = sp.reboundMs || sp.releaseMs * 0.9;
      const ease = EASE[sp.ease || "linear"];
      let t = now - this.t0;
      if (t < 0) return 0;
      if (attack > 0 && t < attack) return t / attack;
      t -= attack;
      if (t < sp.releaseMs) return 1 - (1 + over) * ease(t / sp.releaseMs);
      t -= sp.releaseMs;
      if (over > 0 && t < rebound) return -over * (1 - EASE.out2(t / rebound));
      return 0;
    }
  }

  // ---------- hit-feel tiers ----------

  const TIERS = {
    normal: {
      scale:  { peak: 1.7,  attackMs: 0, releaseMs: 100, ease: "out2", overshoot: 0.06, reboundMs: 80 },
      squash: { amt: 0.18,  attackMs: 0, releaseMs: 110, ease: "out2", overshoot: 0.08, reboundMs: 90 },
      kick:   { px: 14,     attackMs: 0, releaseMs: 120, ease: "out3", overshoot: 0.15, reboundMs: 100 },
      recoil: { px: 6,      attackMs: 0, releaseMs: 90,  ease: "out2", overshoot: 0 },
    },
    charged: {
      scale:  { peak: 2.0,  attackMs: 0, releaseMs: 140, ease: "out3", overshoot: 0.12, reboundMs: 120 },
      squash: { amt: 0.30,  attackMs: 0, releaseMs: 150, ease: "out3", overshoot: 0.15, reboundMs: 130 },
      kick:   { px: 26,     attackMs: 0, releaseMs: 160, ease: "out3", overshoot: 0.20, reboundMs: 130 },
      recoil: { px: 12,     attackMs: 0, releaseMs: 130, ease: "out3", overshoot: 0.10 },
    },
  };

  // ---------- sound ----------

  const SND = { on: true, ac: null };
  function audioCtx() {
    if (!SND.ac) {
      try { SND.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    if (SND.ac && SND.ac.state === "suspended") SND.ac.resume();
    return SND.ac;
  }
  function tone(freq, dur, opts) {
    opts = opts || {};
    if (!SND.on) return;
    const c = audioCtx();
    if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = opts.type || "square";
    const t = c.currentTime + (opts.delay || 0);
    o.frequency.setValueAtTime(freq, t);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + opts.slide), t + dur);
    g.gain.setValueAtTime(opts.gain || 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const sfx = {
    shoot:   () => tone(880, 0.05, { slide: -300, gain: 0.03 }),
    charged: () => { tone(220, 0.18, { type: "sawtooth", slide: -120, gain: 0.07 }); tone(440, 0.12, { slide: -200, gain: 0.04 }); },
    hit:     () => { tone(520, 0.07, { slide: -260, gain: 0.05 }); tone(390, 0.08, { delay: 0.03, slide: -200, gain: 0.04 }); },
    guardBreak: () => { tone(160, 0.2, { type: "sawtooth", slide: -80, gain: 0.08 }); tone(640, 0.08, { slide: -400, gain: 0.04 }); },
    plink:   () => tone(1500, 0.03, { type: "triangle", gain: 0.035 }),
    stagger: () => tone(700, 0.05, { type: "triangle", slide: -300, gain: 0.04 }),
    ready:   () => { tone(660, 0.06, { gain: 0.04 }); tone(990, 0.09, { delay: 0.06, gain: 0.04 }); },
    hop:     () => tone(300, 0.04, { type: "triangle", slide: 120, gain: 0.025 }),
    rankup:  () => { tone(523, 0.06, { gain: 0.04 }); tone(659, 0.06, { delay: 0.06, gain: 0.04 }); tone(784, 0.09, { delay: 0.12, gain: 0.04 }); },
    alarm:   () => { tone(440, 0.12, { type: "sawtooth", gain: 0.06 }); tone(440, 0.12, { type: "sawtooth", delay: 0.16, gain: 0.06 }); },
    allyHit: () => { tone(110, 0.3, { type: "sawtooth", gain: 0.09 }); tone(116, 0.3, { type: "sawtooth", gain: 0.09 }); },
    rareSpawn: () => { tone(1047, 0.05, { gain: 0.035 }); tone(1319, 0.05, { delay: 0.05, gain: 0.035 }); tone(1568, 0.08, { delay: 0.1, gain: 0.035 }); },
    rareGet: () => { tone(784, 0.07, { gain: 0.05 }); tone(988, 0.07, { delay: 0.07, gain: 0.05 }); tone(1175, 0.07, { delay: 0.14, gain: 0.05 }); tone(1568, 0.14, { delay: 0.21, gain: 0.05 }); },
    over:    () => { tone(392, 0.12, { gain: 0.05 }); tone(311, 0.12, { delay: 0.13, gain: 0.05 }); tone(233, 0.25, { delay: 0.26, gain: 0.05 }); },
    aim:     () => tone(190, 0.10, { type: "sawtooth", slide: 110, gain: 0.03 }),
    bolt:    () => tone(300, 0.07, { type: "square", slide: -170, gain: 0.035 }),
    hurt:    () => { tone(150, 0.22, { type: "sawtooth", slide: -70, gain: 0.09 }); tone(92, 0.28, { type: "square", delay: 0.02, slide: -40, gain: 0.07 }); },
  };

  // ---------- constants ----------

  const ROWS = 3, COLS = 6, PCOLS = 3;
  const START_TIME = 30, TIME_CAP = 45;
  const BONUS = { normal: 1.2, charged: 2.5, guard: 3.0, hopper: 1.8, rare: 8.0 };
  const PTS   = { normal: 100, charged: 300, guard: 400, hopper: 250, rare: 1000 };
  const ALLY_TIME_PENALTY = 3.0;
  const ALLY_PTS_PENALTY = 200;
  const ALLY_SPARE_BONUS = 0.5;
  const CHARGE_MS = 700;
  const RISE_MS = 220, SINK_MS = 180, HIT_MS = 280;
  const MOVE_REPEAT_MS = 130;
  const HOP_MS = 550, HOP_GROW_MS = 120;
  const HOPPER_LIFE = 2200, RARE_LIFE = 650;

  const upMs  = (del) => Math.max(450, 1150 - del * 55);
  const gapMs = (del) => Math.max(160, 520 - del * 22);
  const level = (del) => 1 + Math.floor(del / 5);
  const maxConcurrent = (del) => (del >= 150 ? 4 : del >= 75 ? 3 : del >= 20 ? 2 : 1);
  const guardChance  = (del) => (del < 8 ? 0 : Math.min(0.35, 0.15 + del * 0.002));
  const hopperChance = (del) => (del < 30 ? 0 : Math.min(0.25, 0.1 + del * 0.001));
  const allyChance   = (del) => (del < 20 ? 0 : Math.min(0.20, 0.08 + del * 0.0004));
  const rareChance   = (del, timeLeft) => (del < 50 ? 0 : 0.04 * (timeLeft < 10 ? 3 : 1));

  // OVERCLOCK: past OC_START deletions, time rewards decay forever (no floor),
  // so every run mathematically ends. 0.995 sets the slope; rares decay at
  // sqrt of the factor — half the exponential rate — so late-game survival
  // becomes rare-hunting rather than a fixed death spiral.
  // counterattack: a virus marks its row, then fires back down it. The mark
  // plus the bolt's travel time is the whole dodge window, so both tighten
  // with level rather than the attack simply becoming more frequent.
  const ATTACK_START = 12;
  const HIT_TIME_PENALTY = 2.5;
  const HIT_IFRAME_MS = 800;
  const HURT_SHAKE_MS = 260;
  const aimMs = (del) => Math.max(280, 620 - (del - ATTACK_START) * 6);
  const boltPanelMs = (del) => Math.max(95, 190 - (del - ATTACK_START) * 0.8);
  const attackChance = (del) =>
    (del < ATTACK_START ? 0 : Math.min(0.55, 0.22 + (del - ATTACK_START) * 0.004));

  const OC_START = 60;
  const bonusFactor = (del) => (del < OC_START ? 1 : Math.pow(0.995, del - OC_START));

  const multOf = (chain) => (chain >= 20 ? 4 : chain >= 10 ? 3 : chain >= 5 ? 2 : 1);

  // stage gates: each new mechanic pauses the run for a splash + continue/end choice
  const STAGES = [
    { at: 8,   title: "STEEL GUARDS", desc: "armored viruses — charged shots only" },
    { at: 12,  title: "RETALIATION",  desc: "viruses shoot back — a marked row is\nabout to fire; move off it" },
    { at: 20,  title: "PROGS ONLINE", desc: "blue friendlies join — hold fire\ntwo viruses at once" },
    { at: 30,  title: "HOPPERS",      desc: "green hoppers flee — 2 taps or 1 charge" },
    { at: 50,  title: "RARE VIRUS",   desc: "gold jackpot spawns — bust it fast" },
    { at: 60,  title: "OVERCLOCK",    desc: "time rewards decay from here on" },
    { at: 75,  title: "\u00d73 VIRUSES",   desc: "three at once — keep the chain" },
    { at: 150, title: "\u00d74 VIRUSES",   desc: "maximum pressure" },
  ];
  const STAGE_BONUS = 2.0;
  const ALLY_RISE_MS = 460;  // progs surface slowly and can't be hit until fully up

  // ---------- state ----------
  // S.clock: game clock, advances only while playing and unpaused.

  const S = {
    mode: "ready",
    paused: false,
    clock: 0,
    canFire: true,
    score: 0, best: 0, deletions: 0,
    shots: 0, whiffs: 0,
    chain: 0, bestChain: 0,
    timeLeft: START_TIME,
    player: { col: 1, row: 1 },
    enemies: [],             // { col,row,type,state,t0,hp, lastHop,hopT0, fx?,tier?, willAttack,fired }
    bolts: [],               // incoming fire: { row, x, speed, heavy }
    hurtUntil: -1e9,         // i-frames, so one volley can't drain the clock
    nextSpawnAt: 0,
    stageIdx: 0,
    charge: { downAt: null, full: false },
    lastMoveAt: -1e9,
    rank: null,
    fx: {
      recoil: new Impulse(TIERS.normal.recoil),
      muzzleT0: -1e9,
      muzzleTier: "normal",
      ray: { t0: -1e9, row: 0, hitCol: null, x0: 0, x1: 0, dur: 1, tier: "normal" },
      popups: [],
      sparks: [],
      hurtT0: -1e9,
    },
    lastFrame: 0,
  };

  try { S.best = Number(localStorage.getItem(storageKey)) || 0; } catch (e) {}

  // ---------- game flow ----------

  function resetGame(now) {
    S.mode = "playing";
    S.paused = false;
    S.score = 0;
    S.deletions = 0;
    S.shots = 0; S.whiffs = 0;
    S.chain = 0; S.bestChain = 0;
    S.timeLeft = START_TIME;
    S.player.col = 1; S.player.row = 1;
    S.enemies.length = 0;
    S.nextSpawnAt = now + 500;
    S.stageIdx = 0;
    S.fx.popups.length = 0;
    S.fx.sparks.length = 0;
    S.fx.hurtT0 = -1e9;
    S.bolts.length = 0;
    S.hurtUntil = -1e9;
    S.rank = null;
    hideOverlay();
    renderStats();
  }

  function computeRank() {
    const acc = S.shots ? 1 - S.whiffs / S.shots : 0;
    if (acc >= 0.75 && S.bestChain >= 20) return "S";
    if (acc >= 0.6 && S.bestChain >= 10) return "A";
    if (acc >= 0.45) return "B";
    if (acc >= 0.3) return "C";
    return "D";
  }

  function gameOver() {
    S.mode = "over";
    S.rank = computeRank();
    if (S.score > S.best) {
      S.best = S.score;
      try { localStorage.setItem(storageKey, String(S.best)); } catch (e) {}
    }
    S.enemies.length = 0;
    S.bolts.length = 0;
    S.charge.downAt = null; S.charge.full = false;
    sfx.over();
    renderStats();
    showOver();
  }

  // ---------- enemy spawning + state machine ----------

  function freePanels(excludeCol, excludeRow) {
    const occ = new Set(S.enemies.map((e) => e.col + "," + e.row));
    const out = [];
    for (let c = PCOLS; c < COLS; c++)
      for (let r = 0; r < ROWS; r++) {
        if (c === excludeCol && r === excludeRow) continue;
        if (!occ.has(c + "," + r)) out.push([c, r]);
      }
    return out;
  }

  function rollType(del) {
    const rare = rareChance(del, S.timeLeft);
    const g = guardChance(del), h = hopperChance(del), a = allyChance(del);
    const r = Math.random();
    if (r < rare) return "rare";
    if (r < rare + a) return "ally";
    if (r < rare + a + g) return "guard";
    if (r < rare + a + g + h) return "hopper";
    return "mett";
  }

  // Only metts and steel guards retaliate: hoppers already pressure you by
  // fleeing, progs are friendly, and a rare's window is too short to chase
  // under fire.
  const canRetaliate = (type) => type === "mett" || type === "guard";

  function lifeOf(e) {
    if (e.type === "hopper") return HOPPER_LIFE;
    if (e.type === "rare") return RARE_LIFE;
    const base = upMs(S.deletions);
    // an attacker sticks around long enough to actually follow through
    return e.willAttack ? Math.max(base, aimMs(S.deletions) + 300) : base;
  }

  function updateEnemies(now) {
    if (S.mode !== "playing" || S.paused) return;

    const mx = maxConcurrent(S.deletions);

    if (S.enemies.length < mx && now >= S.nextSpawnAt) {
      const free = freePanels();
      if (free.length) {
        const [c, r] = free[Math.floor(Math.random() * free.length)];
        const type = rollType(S.deletions);
        S.enemies.push({
          col: c, row: r, type, state: "rising", t0: now,
          riseMs: type === "ally" ? ALLY_RISE_MS : RISE_MS,
          hp: type === "hopper" ? 2 : 1,
          lastHop: now, hopT0: -1e9,
          willAttack: canRetaliate(type) && Math.random() < attackChance(S.deletions),
          fired: false,
        });
        S.nextSpawnAt = now + gapMs(S.deletions) + Math.random() * 200;
        if (type === "rare") sfx.rareSpawn();
      }
    }

    for (let i = S.enemies.length - 1; i >= 0; i--) {
      const e = S.enemies[i];
      const t = now - e.t0;
      switch (e.state) {
        case "rising":
          if (t >= (e.riseMs || RISE_MS)) {
            e.state = "up"; e.t0 = now; e.lastHop = now;
            if (e.willAttack) sfx.aim();
          }
          break;
        case "up": {
          if (e.type === "hopper" && now - e.lastHop >= HOP_MS) {
            const free = freePanels(e.col, e.row);
            if (free.length) {
              const [c, r] = free[Math.floor(Math.random() * free.length)];
              e.col = c; e.row = r;
              e.hopT0 = now;
              sfx.hop();
            }
            e.lastHop = now;
          }
          if (e.willAttack && !e.fired && t >= aimMs(S.deletions)) {
            fireBolt(e, now);
            e.fired = true;
          }
          if (t >= lifeOf(e)) { e.state = "sinking"; e.t0 = now; }
          break;
        }
        case "sinking":
          if (t >= SINK_MS) {
            // an untouched prog reaching cover is worth a little time
            if (e.type === "ally") {
              S.timeLeft = Math.min(TIME_CAP, S.timeLeft + ALLY_SPARE_BONUS);
              const p = panelRect(e.col, e.row);
              S.fx.popups.push({ x: p.x + p.w / 2, y: p.y, t0: now, text: "spared +" + ALLY_SPARE_BONUS.toFixed(1) + "s", color: "#58c7ff" });
            }
            S.enemies.splice(i, 1);
          }
          break;
        case "hit":
          if (t >= HIT_MS) S.enemies.splice(i, 1);
          break;
      }
    }
  }

  // ---------- incoming fire ----------

  function fireBolt(e, now) {
    const p = panelRect(e.col, e.row);
    S.bolts.push({
      row: e.row,
      x: p.x + p.w / 2,
      speed: G.pw / boltPanelMs(S.deletions),   // px per ms, travelling left
      heavy: e.type === "guard",
    });
    sfx.bolt();
  }

  // dt rather than the clock: bolts move in real time, and the early return
  // freezes them for pause and the interlevel card alike.
  function updateBolts(now, dt) {
    if (S.mode !== "playing" || S.paused) return;
    const pr = panelRect(S.player.col, S.player.row);
    const px = pr.x + pr.w / 2;
    const hitR = G.pw * 0.3;
    for (let i = S.bolts.length - 1; i >= 0; i--) {
      const b = S.bolts[i];
      b.x -= b.speed * dt;
      if (b.row === S.player.row && now >= S.hurtUntil && Math.abs(b.x - px) <= hitR) {
        S.bolts.splice(i, 1);
        takeHit(now);
        continue;
      }
      if (b.x < G.gx - G.pw * 0.5) S.bolts.splice(i, 1);
    }
  }

  function takeHit(now) {
    S.hurtUntil = now + HIT_IFRAME_MS;
    S.fx.hurtT0 = now;
    S.timeLeft = Math.max(0, S.timeLeft - HIT_TIME_PENALTY);
    S.chain = 0;
    S.charge.downAt = null; S.charge.full = false;   // a hit spills your charge
    const p = panelRect(S.player.col, S.player.row);
    S.fx.popups.push({
      x: p.x + p.w / 2, y: p.y - 8, t0: now,
      text: "HIT −" + HIT_TIME_PENALTY.toFixed(1) + "s", color: "#ff5470",
    });
    S.fx.sparks.push({ x: p.x + p.w / 2, y: p.y + p.h * 0.3, t0: now });
    sfx.hurt();
    renderStats();
    // the clock running out is the frame loop's call, same as any other drain
  }

  // ---------- shooting ----------

  const isVisible = (e) => e.state === "rising" || e.state === "up" || e.state === "sinking";

  function shoot(tierName, now) {
    const tier = TIERS[tierName];
    S.fx.recoil = new Impulse(tier.recoil);
    S.fx.recoil.trigger(now);
    S.fx.muzzleT0 = now;
    S.fx.muzzleTier = tierName;
    S.shots++;
    (tierName === "charged" ? sfx.charged : sfx.shoot)();

    const row = S.player.row;
    let target = null;
    for (const e of S.enemies) {
      if (!isVisible(e) || e.row !== row) continue;
      // progs are safe while rising or sinking — shots pass through them
      if (e.type === "ally" && e.state !== "up") continue;
      if (!target || e.col < target.col) target = e;
    }

    // bullet path: from the buster's muzzle to the first target (or the right edge)
    const pr = panelRect(S.player.col, row);
    const bwP = G.pw * 0.34;
    const x0 = pr.x + pr.w / 2 + bwP / 2 + bwP * 0.55;
    const x1 = target ? panelRect(target.col, row).x + G.pw / 2 : G.gx + G.pw * COLS;
    // hitscan logic stays instant; the tracer just travels fast (~5 px/ms)
    const dur = Math.max(40, Math.min(95, (x1 - x0) / 5));
    S.fx.ray = { t0: now, row, hitCol: target ? target.col : null, x0, x1, dur, tier: tierName };

    if (!target) {
      S.whiffs++;
      if (S.chain >= 5) {
        const pp = panelRect(S.player.col, S.player.row);
        S.fx.popups.push({ x: pp.x + pp.w / 2, y: pp.y - 14, t0: now, text: "chain broken", color: "#5f6b8c" });
      }
      S.chain = 0;
      renderStats();
      return;
    }

    const p = panelRect(target.col, target.row);

    // friendly prog: hitting it hurts — the anti-spam tax
    if (target.type === "ally") {
      target.state = "hit"; target.t0 = now;
      target.tier = tier;
      target.fx = {
        scale:  new Impulse(tier.scale),
        squash: new Impulse(tier.squash),
        kick:   new Impulse(tier.kick),
      };
      for (const imp of Object.values(target.fx)) imp.trigger(now);
      S.whiffs++;                        // accuracy and rank take the hit too
      S.chain = 0;
      S.timeLeft = Math.max(0, S.timeLeft - ALLY_TIME_PENALTY);
      S.score = Math.max(0, S.score - ALLY_PTS_PENALTY);
      S.fx.popups.push({ x: p.x + p.w / 2, y: p.y - 8, t0: now, text: "PROG HIT −" + ALLY_TIME_PENALTY.toFixed(1) + "s", color: "#ff5470" });
      sfx.allyHit();
      renderStats();
      return;
    }

    if (target.type === "guard" && tierName === "normal") {
      S.fx.sparks.push({ x: p.x + p.w * 0.28, y: p.y + p.h * 0.2, t0: now });
      S.fx.popups.push({ x: p.x + p.w / 2, y: p.y - 8, t0: now, text: "GUARD", color: "#8a96b8" });
      sfx.plink();
      return;
    }

    // hopper stamina: a tap staggers it and it flees; charged shots kill outright
    if (target.type === "hopper" && tierName === "normal" && target.hp > 1) {
      target.hp--;
      S.fx.sparks.push({ x: p.x + p.w / 2, y: p.y + p.h * 0.2, t0: now });
      S.fx.popups.push({ x: p.x + p.w / 2, y: p.y - 8, t0: now, text: "1 more", color: "#5ee87c" });
      sfx.stagger();
      const free = freePanels(target.col, target.row);
      if (free.length) {
        const [c, r] = free[Math.floor(Math.random() * free.length)];
        target.col = c; target.row = r;
        target.hopT0 = now;
        sfx.hop();
      }
      target.lastHop = now;
      return;                            // contact: chain neither breaks nor grows
    }

    // deletion
    target.state = "hit"; target.t0 = now;
    target.tier = tier;
    target.fx = {
      scale:  new Impulse(tier.scale),
      squash: new Impulse(tier.squash),
      kick:   new Impulse(tier.kick),
    };
    for (const imp of Object.values(target.fx)) imp.trigger(now);
    (target.type === "rare" ? sfx.rareGet : target.type === "guard" ? sfx.guardBreak : sfx.hit)();

    const multBefore = multOf(S.chain);
    S.chain++;
    if (S.chain > S.bestChain) S.bestChain = S.chain;
    const mult = multOf(S.chain);
    if (mult > multBefore) sfx.rankup();

    const baseKey =
      target.type === "guard" ? "guard" :
      target.type === "hopper" ? "hopper" :
      target.type === "rare" ? "rare" : tierName;
    const pts = PTS[baseKey] * mult;
    S.score += pts;
    S.deletions++;

    const bf = bonusFactor(S.deletions);
    const factor = baseKey === "rare" ? Math.sqrt(bf) : bf;
    S.timeLeft = Math.min(TIME_CAP, S.timeLeft + BONUS[baseKey] * factor);

    S.fx.popups.push({
      x: p.x + p.w / 2, y: p.y - 8, t0: now,
      text: "+" + pts + (mult > 1 ? " ×" + mult : ""),
      color: baseKey === "rare" ? "#ffe08a" : baseKey === "guard" || mult > 1 ? "#45e0e8" : "#aab4ce",
    });
    S.fx.popups.push({
      x: p.x + p.w / 2, y: p.y + 12, t0: now + 60,
      text: "+" + (BONUS[baseKey] * factor).toFixed(1) + "s",
      color: factor < 1 ? "#ff9f45" : "#ffd23f",
    });

    renderStats();

    if (S.stageIdx < STAGES.length && S.deletions >= STAGES[S.stageIdx].at) {
      enterInterlevel(now);
    }
  }

  // ---------- input ----------

  function firePressed(now) {
    audioCtx();
    if (!S.canFire) return;
    S.canFire = false;
    if (S.mode === "ready" || S.mode === "over") { resetGame(now); return; }
    if (S.mode === "interlevel") { resumeFromInterlevel(); return; }
    if (S.paused) return;
    shoot("normal", now);
    S.charge.downAt = now;
    S.charge.full = false;
  }

  function fireReleased(now) {
    S.canFire = true;
    if (S.charge.downAt !== null && S.charge.full && S.mode === "playing" && !S.paused) {
      shoot("charged", now);
    }
    S.charge.downAt = null;
    S.charge.full = false;
  }

  function move(dc, dr, now) {
    if (S.mode !== "playing" || S.paused) return;
    if (now - S.lastMoveAt < MOVE_REPEAT_MS) return;
    S.lastMoveAt = now;
    S.player.col = Math.max(0, Math.min(PCOLS - 1, S.player.col + dc));
    S.player.row = Math.max(0, Math.min(ROWS - 1, S.player.row + dr));
  }

  function togglePause() {
    if (S.mode !== "playing") return;
    S.paused = !S.paused;
    if (S.paused) { S.charge.downAt = null; S.charge.full = false; }
    if (root.activeElement) root.activeElement.blur();
  }

  const MOVE_KEYS = {
    ArrowUp: [0, -1], KeyW: [0, -1],
    ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0],
    ArrowRight: [1, 0], KeyD: [1, 0],
  };

  on(window, "keydown", (e) => {
    const mk = MOVE_KEYS[e.code];
    if (mk) { e.preventDefault(); return move(mk[0], mk[1], S.clock); }
    if (e.code === "KeyP" || e.code === "Escape") { e.preventDefault(); return togglePause(); }
    if (e.code === "KeyM") {
      SND.on = !SND.on;
      $("sSnd").textContent = SND.on ? "on" : "off";
      return;
    }
    if (e.code !== "Space") return;
    e.preventDefault();
    if (e.repeat) return;
    firePressed(S.clock);
  });
  on(window, "keyup", (e) => {
    if (e.code !== "Space") return;
    fireReleased(S.clock);
  });

  const cv = $("cv");
  const fireBtn = $("fireBtn");
  for (const triggerEl of [cv, fireBtn]) {
    on(triggerEl, "pointerdown", (e) => { e.preventDefault(); firePressed(S.clock); });
  }
  on(window, "pointerup", () => fireReleased(S.clock));
  on(window, "pointercancel", () => fireReleased(S.clock));
  on(window, "blur", () => {
    fireReleased(S.clock);
    if (S.mode === "playing" && !S.paused) togglePause();
  });

  // ---------- analog ring d-pad ----------
  // Neutral hub radius = 2/5 of ring radius. Outside it, per-axis thresholds
  // resolve to one direction (cardinal) or two (diagonal). Held/rocked input
  // repeats via move()'s own MOVE_REPEAT_MS throttle, polled each frame.

  const pad = $("dpad");
  const padArrows = {
    up: $("aUp"),
    down: $("aDown"),
    left: $("aLeft"),
    right: $("aRight"),
  };
  const padState = { active: false, dc: 0, dr: 0 };
  const PAD_NEUTRAL = 0.4;   // 2/5 of ring radius
  const PAD_AXIS = 0.42;     // sin/cos threshold; the 45° band presses both axes

  function padSetArrows() {
    padArrows.up.classList.toggle("on", padState.dr < 0);
    padArrows.down.classList.toggle("on", padState.dr > 0);
    padArrows.left.classList.toggle("on", padState.dc < 0);
    padArrows.right.classList.toggle("on", padState.dc > 0);
  }

  function padUpdate(e) {
    const r = pad.getBoundingClientRect();
    const R = r.width / 2;
    const dx = e.clientX - (r.left + R);
    const dy = e.clientY - (r.top + R);
    const d = Math.hypot(dx, dy);
    let dc = 0, dr = 0;
    if (d >= R * PAD_NEUTRAL && d > 0) {
      if (dx / d > PAD_AXIS) dc = 1; else if (dx / d < -PAD_AXIS) dc = -1;
      if (dy / d > PAD_AXIS) dr = 1; else if (dy / d < -PAD_AXIS) dr = -1;
    }
    if ((dc !== padState.dc || dr !== padState.dr) && (dc || dr)) {
      S.lastMoveAt = -1e9;   // direction change (rocking) responds immediately
    }
    padState.dc = dc; padState.dr = dr;
    padSetArrows();
  }

  on(pad, "pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { pad.setPointerCapture(e.pointerId); } catch (err) {}
    padState.active = true;
    pad.classList.add("live");
    padUpdate(e);
  });
  on(pad, "pointermove", (e) => {
    if (!padState.active) return;
    e.preventDefault();
    padUpdate(e);
  });
  function padEnd() {
    padState.active = false;
    padState.dc = 0; padState.dr = 0;
    pad.classList.remove("live");
    padSetArrows();
  }
  on(pad, "pointerup", padEnd);
  on(pad, "pointercancel", padEnd);
  on(pad, "lostpointercapture", padEnd);
  on($("pauseBtn"), "pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    togglePause();
  });

  // ---------- geometry ----------

  const stageEl = $("stage");
  const ctx = cv.getContext("2d");
  const G = { w: 0, h: 0, gx: 0, gy: 0, pw: 0, ph: 0 };

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = stageEl.getBoundingClientRect();
    G.w = r.width; G.h = r.height;
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const gw = Math.min(G.w * 0.9, 760);
    G.pw = gw / COLS;
    G.ph = Math.min(G.pw * 0.62, (G.h - 180) / ROWS);
    G.gx = (G.w - G.pw * COLS) / 2;
    G.gy = G.h * 0.52 - (G.ph * ROWS) / 2;
  }
  resize();
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(stageEl);
  } else {
    on(window, "resize", resize);
  }

  function panelRect(col, row) {
    return { x: G.gx + col * G.pw, y: G.gy + row * G.ph, w: G.pw, h: G.ph };
  }

  // ---------- drawing ----------

  function drawPanels() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = panelRect(c, r);
        const mine = c < PCOLS;
        ctx.fillStyle = mine ? "#3a2330" : "#1e2c4d";
        ctx.strokeStyle = mine ? "#7c3652" : "#35528f";
        ctx.lineWidth = 2;
        ctx.fillRect(p.x + 3, p.y + 3, p.w - 6, p.h - 6);
        ctx.strokeRect(p.x + 3, p.y + 3, p.w - 6, p.h - 6);
        if (mine && c === S.player.col && r === S.player.row) {
          ctx.strokeStyle = "#45e0e8";
          ctx.strokeRect(p.x + 5, p.y + 5, p.w - 10, p.h - 10);
        }
      }
    }
  }

  // shared firing line for both sides, so a bolt visibly occupies the lane
  // the player's own tracer runs down
  const laneY = (row) => panelRect(0, row).y + G.ph * 0.78 - G.ph * 1.15 * 0.42;

  // The telegraph is the whole fairness budget: the lane the shot will sweep
  // fills toward the player as the aim completes, and a chevron marks the row
  // at the player's edge so the threat is readable without looking away.
  function drawAim(now) {
    if (S.mode !== "playing") return;
    const am = aimMs(S.deletions);
    for (const e of S.enemies) {
      if (!e.willAttack || e.fired || e.state !== "up") continue;
      const q = Math.min(1, (now - e.t0) / am);
      const p = panelRect(e.col, e.row);
      const x1 = p.x + p.w / 2;
      const y = laneY(e.row);
      const pulse = 0.55 + 0.45 * Math.sin(now / 42);

      ctx.save();
      ctx.fillStyle = "#ff5470";
      ctx.globalAlpha = 0.05 + 0.13 * q;
      ctx.fillRect(G.gx + 3, p.y + 3, x1 - G.gx - 3, p.h - 6);

      ctx.globalAlpha = (0.2 + 0.4 * q) * pulse;
      ctx.strokeStyle = "#ff5470";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      ctx.moveTo(G.gx + 6, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.globalAlpha = pulse;
      ctx.fillStyle = q > 0.75 ? "#ffd23f" : "#ff5470";
      ctx.beginPath();
      ctx.moveTo(G.gx + 4, y);
      ctx.lineTo(G.gx + 15, y - 7);
      ctx.lineTo(G.gx + 15, y + 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBolts(now) {
    for (const b of S.bolts) {
      const y = laneY(b.row);
      const r = b.heavy ? 11 : 8;
      const grad = ctx.createLinearGradient(b.x + r * 6, 0, b.x, 0);
      grad.addColorStop(0, "rgba(255,84,112,0)");
      grad.addColorStop(1, b.heavy ? "#ff9f45" : "#ff5470");
      ctx.strokeStyle = grad;
      ctx.lineWidth = r * 0.8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(b.x + r * 6, y);
      ctx.lineTo(b.x, y);
      ctx.stroke();
      ctx.lineCap = "butt";

      ctx.fillStyle = b.heavy ? "#ffd23f" : "#ff8ba0";
      ctx.beginPath();
      ctx.moveTo(b.x - r, y);
      ctx.lineTo(b.x, y - r * 0.8);
      ctx.lineTo(b.x + r * 0.7, y);
      ctx.lineTo(b.x, y + r * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(b.x - r * 0.3, y - 2, r * 0.5, 4);
    }
  }

  function drawPlayer(now) {
    const p = panelRect(S.player.col, S.player.row);
    const eRecoil = S.fx.recoil.value(now);
    const rx = -S.fx.recoil.spec.px * eRecoil;

    const bw = G.pw * 0.34, bh = G.ph * 1.15;
    const cx = p.x + p.w / 2 + rx;
    const baseY = p.y + p.h * 0.78;

    const flicker = now < S.hurtUntil && Math.floor(now / 70) % 2 === 0;
    if (flicker) ctx.globalAlpha = 0.35;

    ctx.fillStyle = "#4f8dff";
    ctx.fillRect(cx - bw / 2, baseY - bh, bw, bh);
    ctx.fillStyle = "#2f5fc4";
    ctx.fillRect(cx - bw / 2, baseY - bh, bw, bh * 0.28);
    ctx.fillStyle = "#c9f6ff";
    ctx.fillRect(cx - bw * 0.28, baseY - bh * 0.62, bw * 0.56, bh * 0.14);
    const rayY = baseY - bh * 0.42;
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(cx + bw / 2 - 2, rayY - 5, bw * 0.55, 10);
    ctx.globalAlpha = 1;

    const cdn = S.charge.downAt;
    if (cdn !== null && S.mode === "playing") {
      const held = now - cdn;
      if (held > 120) {
        const prog = Math.min(1, held / CHARGE_MS);
        ctx.beginPath();
        ctx.arc(cx, baseY - bh * 0.5, bw * 0.95, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
        ctx.strokeStyle = S.charge.full
          ? (Math.sin(now / 55) > 0 ? "#45e0e8" : "#c9f6ff")
          : "rgba(69,224,232,0.5)";
        ctx.lineWidth = S.charge.full ? 4 : 2;
        ctx.stroke();
      }
    }
    return { rayY, busterX: cx + bw / 2 + bw * 0.55 };
  }

  const SKINS = {
    mett:   { dome: "#ffd23f", stripe: "#c9992a" },
    guard:  { dome: "#aeb9d6", stripe: "#6c7794" },
    hopper: { dome: "#5ee87c", stripe: "#1f7c3d" },
    ally:   { dome: "#58c7ff", stripe: "#2a7ab8" },
    rare:   { dome: "#fff3c4", stripe: "#e8a020" },
  };

  function drawEnemy(now, e) {
    const p = panelRect(e.col, e.row);
    const t = now - e.t0;
    const bw = G.pw * 0.4, bh = G.ph * 1.0;
    let cx = p.x + p.w / 2;
    const baseY = p.y + p.h * 0.78;

    let grow = 1, sx = 1, sy = 1, flash = 0;

    if (e.state === "rising") grow = EASE.out2(Math.min(1, t / (e.riseMs || RISE_MS)));
    else if (e.state === "sinking") grow = 1 - EASE.out2(t / SINK_MS);
    else if (e.state === "hit") {
      const tier = e.tier;
      const uniform = 1 + (tier.scale.peak - 1) * e.fx.scale.value(now);
      const sqy = 1 + tier.squash.amt * e.fx.squash.value(now);
      sx = uniform / sqy;
      sy = uniform * sqy;
      cx += tier.kick.px * e.fx.kick.value(now);
      flash = Math.max(0, 1 - t / 70);
      grow = 1 - Math.max(0, (t - HIT_MS * 0.55) / (HIT_MS * 0.45));
    }

    const ht = now - e.hopT0;
    if (e.state === "up" && ht < HOP_GROW_MS) grow *= EASE.out2(ht / HOP_GROW_MS);

    if (grow <= 0) return;

    const skin = SKINS[e.type];

    ctx.save();
    ctx.translate(cx, baseY);
    ctx.scale(sx, sy * grow);
    ctx.globalAlpha = e.state === "hit" ? grow : 1;

    ctx.fillStyle = skin.dome;
    ctx.beginPath();
    ctx.arc(0, -bh * 0.42, bw * 0.55, Math.PI, 0);
    ctx.lineTo(bw * 0.55, -bh * 0.1);
    ctx.lineTo(-bw * 0.55, -bh * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = skin.stripe;
    ctx.fillRect(-bw * 0.08, -bh * 0.98, bw * 0.16, bh * 0.5);

    if (e.type === "guard") {
      ctx.fillStyle = "#6c7794";
      ctx.fillRect(-bw * 0.55, -bh * 0.34, bw * 1.1, bh * 0.1);
      ctx.fillStyle = "#232c42";
      ctx.fillRect(-bw * 0.42, -bh * 0.24, bw * 0.84, bh * 0.12);
    } else if (e.type === "ally") {
      // white face plate with a plus mark: friend, don't shoot
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-bw * 0.42, -bh * 0.36, bw * 0.84, bh * 0.26);
      ctx.fillStyle = "#2a7ab8";
      ctx.fillRect(-bw * 0.06, -bh * 0.34, bw * 0.12, bh * 0.22);
      ctx.fillRect(-bw * 0.24, -bh * 0.28, bw * 0.48, bh * 0.1);
    } else {
      ctx.fillStyle = "#232c42";
      ctx.fillRect(-bw * 0.42, -bh * 0.34, bw * 0.84, bh * 0.24);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-bw * 0.26, -bh * 0.3, bw * 0.12, bh * 0.14);
      ctx.fillRect(bw * 0.14, -bh * 0.3, bw * 0.12, bh * 0.14);
    }

    if (e.type === "rare") {
      // shimmer outline
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 70);
      ctx.strokeStyle = "#ffe08a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -bh * 0.42, bw * 0.62, Math.PI, 0);
      ctx.lineTo(bw * 0.62, -bh * 0.04);
      ctx.lineTo(-bw * 0.62, -bh * 0.04);
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = e.state === "hit" ? grow : 1;
    }

    if (flash > 0) {
      ctx.globalAlpha = flash;
      ctx.fillStyle = e.type === "ally" ? "#ff5470" : "#ffffff";
      ctx.fillRect(-bw * 0.6, -bh * 1.05, bw * 1.2, bh * 1.05);
    }
    ctx.restore();
  }

  function drawShots(now, rayY, busterX) {
    const ray = S.fx.ray;
    const rt = now - ray.t0;
    const charged = ray.tier === "charged";

    if (S.mode === "playing" && rt >= 0 && rt < ray.dur + 130) {
      const rp = panelRect(0, ray.row);
      const y = rp.y + rp.h * 0.78 - G.ph * 1.15 * 0.42;

      if (rt <= ray.dur) {
        // traveling tracer: bright head, tapering trail
        const head = ray.x0 + (ray.x1 - ray.x0) * (rt / ray.dur);
        const trail = Math.max(ray.x0, head - (charged ? 150 : 90));
        if (head > trail) {
          const grad = ctx.createLinearGradient(trail, 0, head, 0);
          grad.addColorStop(0, "rgba(69,224,232,0)");
          grad.addColorStop(1, charged ? "#c9f6ff" : "#45e0e8");
          ctx.strokeStyle = grad;
          ctx.lineWidth = charged ? 6 : 3;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(trail, y);
          ctx.lineTo(head, y);
          ctx.stroke();
          ctx.lineCap = "butt";
        }
        if (charged) {
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = "#45e0e8";
          ctx.beginPath();
          ctx.arc(head, y, 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(head, y, charged ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (ray.hitCol !== null) {
        // impact: expanding ring where the tracer landed
        const q = (rt - ray.dur) / 130;
        ctx.globalAlpha = 1 - q;
        ctx.strokeStyle = charged ? "#c9f6ff" : "#45e0e8";
        ctx.lineWidth = charged ? 4 : 2;
        ctx.beginPath();
        ctx.arc(ray.x1, y, (charged ? 10 : 6) + (charged ? 26 : 16) * EASE.out2(q), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // muzzle flash: glow + radiating spikes + white core, at the live muzzle
    const mdur = S.fx.muzzleTier === "charged" ? 140 : 95;
    const mt = now - S.fx.muzzleT0;
    if (mt >= 0 && mt < mdur && S.mode === "playing") {
      const q = mt / mdur;
      const a = 1 - q;
      const s = S.fx.muzzleTier === "charged" ? 1.6 : 1;

      ctx.save();
      ctx.translate(busterX + 2, rayY);

      ctx.globalAlpha = a * 0.85;
      const rad = (10 + 15 * EASE.out2(q)) * s;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
      g.addColorStop(0, "rgba(255,240,180,0.95)");
      g.addColorStop(1, "rgba(255,159,69,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#ffd23f";
      ctx.lineWidth = 2.5 * s;
      ctx.lineCap = "round";
      for (const ang of [-0.55, -0.18, 0.18, 0.55]) {
        const len = (7 + 15 * EASE.out3(q)) * s;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * 4, Math.sin(ang) * 4);
        ctx.lineTo(Math.cos(ang) * (4 + len), Math.sin(ang) * (4 + len));
        ctx.stroke();
      }
      ctx.lineCap = "butt";

      ctx.globalAlpha = a;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(2, 0, Math.max(0.5, (4.5 - 3 * q) * s), 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  function drawSparks(now) {
    S.fx.sparks = S.fx.sparks.filter((s) => now - s.t0 < 140);
    for (const s of S.fx.sparks) {
      const p = (now - s.t0) / 140;
      const d = 4 + 10 * EASE.out2(p);
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = "#c9d2e8";
      ctx.fillRect(s.x - d, s.y - 2, 5, 3);
      ctx.fillRect(s.x + d - 4, s.y - 2, 5, 3);
      ctx.fillRect(s.x - 2, s.y - d, 3, 5);
      ctx.fillRect(s.x - 2, s.y + d - 4, 3, 5);
    }
    ctx.globalAlpha = 1;
  }

  function drawPopups(now) {
    ctx.textAlign = "center";
    ctx.font = "700 15px ui-monospace, Menlo, Consolas, monospace";
    S.fx.popups = S.fx.popups.filter((pp) => now - pp.t0 < 650);
    for (const pp of S.fx.popups) {
      const t = now - pp.t0;
      if (t < 0) continue;
      const p = t / 650;
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = pp.color;
      ctx.fillText(pp.text, pp.x, pp.y - 30 * EASE.out2(p));
    }
    ctx.globalAlpha = 1;
  }

  function drawHUD(now) {
    ctx.textAlign = "left";
    ctx.fillStyle = "#aab4ce";
    ctx.font = "700 22px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillText(String(S.score).padStart(6, "0"), 18, 36);

    if (S.chain >= 2) {
      ctx.font = "700 13px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillStyle = "#45e0e8";
      ctx.fillText("×" + multOf(S.chain) + " · " + S.chain + " chain", 18, 92);
    }

    ctx.textAlign = "right";
    ctx.font = "700 13px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillStyle = "#5f6b8c";
    ctx.fillText("LV " + level(S.deletions), G.w - 70, 34);

    const oc = S.deletions >= OC_START;
    const barX = 18, barY = 48, barW = G.w - 36, barH = 8;
    ctx.fillStyle = "#2f3a57";
    ctx.fillRect(barX, barY, barW, barH);
    const frac = Math.max(0, Math.min(1, S.timeLeft / TIME_CAP));
    ctx.fillStyle = S.timeLeft < 6 ? "#ff5470" : oc ? "#ff9f45" : "#45e0e8";
    ctx.fillRect(barX, barY, barW * frac, barH);
    ctx.textAlign = "left";
    ctx.font = "600 11px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillStyle = "#5f6b8c";
    ctx.fillText(S.timeLeft.toFixed(1) + "s", barX, barY + 24);
    if (oc && S.mode === "playing") {
      ctx.fillStyle = "#ff9f45";
      ctx.fillText("OVERCLOCK ×" + bonusFactor(S.deletions).toFixed(2), barX + 60, barY + 24);
    }

    const ht = now - S.fx.hurtT0;
    if (S.mode === "playing" && ht >= 0 && ht < 190) {
      ctx.fillStyle = "rgba(255,84,112," + (0.18 * (1 - ht / 190)).toFixed(3) + ")";
      ctx.fillRect(0, 0, G.w, G.h);
    }

    if (S.mode === "playing" && S.paused) {
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(27,34,51,0.75)";
      ctx.fillRect(0, 0, G.w, G.h);
      ctx.fillStyle = "#aab4ce";
      ctx.font = "700 24px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillText("PAUSED", G.w / 2, G.h / 2 - 8);
      ctx.font = "600 13px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillStyle = "#5f6b8c";
      ctx.fillText("P to resume", G.w / 2, G.h / 2 + 20);
    }
  }

  // ---------- frame ----------

  function frame(nowRaf) {
    const dt = Math.min(50, nowRaf - S.lastFrame);
    S.lastFrame = nowRaf;

    if (S.mode === "playing" && !S.paused) {
      S.clock += dt;
      S.timeLeft -= dt / 1000;
      if (S.timeLeft <= 0) { S.timeLeft = 0; gameOver(); }
      if (S.charge.downAt !== null && !S.charge.full && S.clock - S.charge.downAt >= CHARGE_MS) {
        S.charge.full = true;
        sfx.ready();
      }
    }
    if (padState.active && (padState.dc || padState.dr)) {
      move(padState.dc, padState.dr, S.clock);
    }
    updateEnemies(S.clock);
    updateBolts(S.clock, dt);

    const now = S.clock;
    ctx.clearRect(0, 0, G.w, G.h);

    const ht = now - S.fx.hurtT0;
    const shake = ht >= 0 && ht < HURT_SHAKE_MS ? (1 - ht / HURT_SHAKE_MS) * 7 : 0;
    ctx.save();
    if (shake) ctx.translate(Math.sin(ht / 18) * shake, Math.cos(ht / 13) * shake * 0.6);

    drawPanels();
    drawAim(now);
    const { rayY, busterX } = drawPlayer(now);
    for (const e of S.enemies) drawEnemy(now, e);
    drawBolts(now);
    drawShots(now, rayY, busterX);
    drawSparks(now);
    drawPopups(now);
    ctx.restore();

    drawHUD(now);

    rafId = requestAnimationFrame(frame);
  }

  // ---------- stats footer ----------

  function renderStats() {
    $("sDel").textContent = String(S.deletions);
    $("sChain").textContent = String(S.bestChain);
    $("sAcc").textContent = S.shots ? Math.round((1 - S.whiffs / S.shots) * 100) + "%" : "—";
    $("sBest").textContent = String(S.best);
  }

  // ---------- splash / interlevel / game-over overlay ----------

  const overlay = $("overlay");

  function showOverlay(o) {
    $("ovEyebrow").textContent = o.eyebrow || "";
    const tt = $("ovTitle");
    tt.textContent = o.title;
    tt.classList.toggle("rank", !!o.rank);
    $("ovSub").textContent = o.sub || "";
    $("ovStats").innerHTML = o.stats || "";
    const bb = $("ovBtns");
    bb.innerHTML = "";
    for (const b of o.buttons) {
      const btn = document.createElement("button");
      btn.textContent = b.label;
      if (b.dim) btn.className = "dim";
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.fn();
      });
      bb.appendChild(btn);
    }
    overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
    splash.classList.add("hidden");
  }

  function statRows(rows) {
    return rows
      .map((r) => "<div>" + r[0] + " <b" + (r[2] ? ' class="' + r[2] + '"' : "") + ">" + r[1] + "</b></div>")
      .join("");
  }

  const accStr = () => (S.shots ? Math.round((1 - S.whiffs / S.shots) * 100) + "%" : "—");

  const splash = $("splash");

  function startRun() {
    audioCtx();
    resetGame(S.clock);
  }

  // The start screen is static markup in TEMPLATE, so showing it is just a
  // high-score refresh. A click anywhere on it starts the run, arcade-style —
  // click rather than pointerdown so a drag can still scroll the card on a
  // short stage. The button keeps the game's snappier pointerdown feel.
  on(splash, "click", () => startRun());
  on($("spStart"), "pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); startRun(); });

  function showSplash() {
    $("spBest").textContent = String(S.best).padStart(6, "0");
    hideOverlay();
    splash.classList.remove("hidden");
  }

  function enterInterlevel(now) {
    const st = STAGES[S.stageIdx];
    S.stageIdx++;
    S.mode = "interlevel";
    S.charge.downAt = null;
    S.charge.full = false;
    S.bolts.length = 0;   // don't resume the run into a bolt you can't see coming
    S.timeLeft = Math.min(TIME_CAP, S.timeLeft + STAGE_BONUS);
    sfx.rankup();
    renderStats();
    showOverlay({
      eyebrow: "new challenge",
      title: st.title,
      sub: st.desc,
      stats: statRows([
        ["score", String(S.score).padStart(6, "0"), "big"],
        ["deletions", S.deletions],
        ["best chain", S.bestChain],
        ["accuracy", accStr()],
        ["stage bonus", "+" + STAGE_BONUS.toFixed(1) + "s"],
        ["time left", S.timeLeft.toFixed(1) + "s"],
      ]),
      buttons: [
        { label: "CONTINUE", fn: resumeFromInterlevel },
        { label: "END RUN", dim: true, fn: () => gameOver() },
      ],
    });
  }

  function resumeFromInterlevel() {
    if (S.mode !== "interlevel") return;
    S.mode = "playing";
    S.nextSpawnAt = S.clock + 700;
    hideOverlay();
  }

  function showOver() {
    showOverlay({
      eyebrow: "run complete",
      title: S.rank,
      rank: true,
      sub: S.deletions >= OC_START ? "overclock reached \u00d7" + bonusFactor(S.deletions).toFixed(2) : "",
      stats: statRows([
        ["score", S.score + " pts", "big"],
        ["deletions", S.deletions],
        ["accuracy", accStr()],
        ["best chain", S.bestChain],
        ["best score", S.best],
      ]),
      buttons: [{ label: "RETRY", fn: () => { audioCtx(); resetGame(S.clock); } }],
    });
  }

  // ---------- boot ----------

  renderStats();
  showSplash();
  S.lastFrame = performance.now();
  rafId = requestAnimationFrame(frame);

  // ---------- teardown ----------

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (resizeObserver) resizeObserver.disconnect();
    for (const fn of cleanupFns) fn();
    try { if (SND.ac) SND.ac.close(); } catch (e) {}
    root.innerHTML = "";
  }

  return { destroy };
}

export default mountBusterWhack;
