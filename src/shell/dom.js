/*!
 * DOM shell: the shadow-root template, and the overlays/footer that hang off it.
 * Everything here is markup and element plumbing — no game logic.
 */

export const TEMPLATE = `
<style>
  :host {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 320px;
    /* Gestures that start on the game stay on the game. 'pan-y' (not 'none')
       so the one genuinely scrollable thing inside — the start card — can still
       scroll; every actual play surface narrows it to 'none' below. Setting
       'none' here would win the ancestor intersection and freeze that card. */
    touch-action: pan-y;
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
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
    touch-action: pan-y;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }

  main {
    position: relative;
    flex: 1;
    min-height: 0;
    touch-action: pan-y;   /* narrowed to 'none' by every child but #splash */
    container-type: size;
    container-name: bwstage;
    /* The stage is the game's focus holder, but it is tabindex="-1" — script
       focuses it, the Tab key never does — so it needs no focus ring of its own.
       Keyboard users land on FIRE / PAUSE / PRESS START, which have theirs. */
    outline: none;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: crosshair;
    touch-action: none;
  }
  #overlay, #dpad, #fireBtn, #bombBtn, #pauseBtn { touch-action: none; }

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
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 22% 0 0 22%;   /* bias label toward the visible arc's center */
  }
  #fireBtn:active { background: rgba(69, 224, 232, 0.25); }

  /* secondary fire: the bomb. A round button riding above the FIRE arc, lit
     while you carry one and greyed to an outline when you don't. */
  #bombBtn {
    position: absolute;
    right: 16px;
    bottom: calc(min(46vw, 200px) + 14px);
    width: 66px;
    height: 66px;
    border-radius: 50%;
    border: 2px solid var(--bw-oc);
    background: rgba(255, 159, 69, 0.14);
    color: var(--bw-oc);
    font: 700 10px/1.15 ui-monospace, Menlo, Consolas, monospace;
    letter-spacing: 0.1em;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }
  #bombBtn b { font-size: 16px; }
  #bombBtn.empty { border-color: var(--bw-line); color: var(--bw-ink-dim); background: rgba(35, 44, 66, 0.5); }
  #bombBtn:active { background: rgba(255, 159, 69, 0.3); }
  #bombBtn:focus-visible { outline: 2px solid var(--bw-oc); outline-offset: 3px; }
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
  }
  #pauseBtn:focus-visible { outline: 2px solid var(--bw-accent); outline-offset: 2px; }

  /* Muted, as a state of the machine rather than a line of stats: a crossed
     speaker next to the pause button, shown only while sound is off. It is the
     one thing the deleted footer was carrying that the player still needs. */
  #muteFlag {
    position: absolute;
    right: 66px;
    top: 14px;
    width: 40px;
    height: 40px;
    display: none;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    border: 1px solid var(--bw-warn);
    background: rgba(255, 84, 112, 0.12);
    color: var(--bw-warn);
    pointer-events: none;
  }
  #muteFlag.on { display: flex; animation: bwMutePop 220ms ease-out; }
  #muteFlag svg { width: 22px; height: 22px; display: block; }
  @keyframes bwMutePop {
    from { transform: scale(0.6); opacity: 0; }
    to   { transform: none; opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) { #muteFlag.on { animation: none; } }

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
    touch-action: none;
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
    /* The only surface allowed to scroll: on a short mount the card overflows
       and a drag should still reach PRESS START. */
    touch-action: pan-y;
    cursor: pointer;
  }
  /* Keep that scroll — including its momentum fling, which no touchmove
     handler can reach — from chaining out into the host page. Scoped to touch
     devices: on a desktop 'overscroll-behavior' would also stop the wheel from
     scrolling the host page whenever the cursor happened to be over the card,
     and Chromium applies it even when the card is not overflowing at all. */
  @media (hover: none) and (pointer: coarse) {
    #splash { overscroll-behavior: contain; }
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

  /* mode menu: one row per mode, the selected one lit like a cabinet's
     illuminated button. Arrow keys move the selection, a tap picks and starts. */
  .sp-modes {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }
  .sp-mode {
    display: flex;
    align-items: baseline;
    gap: 10px;
    width: 100%;
    padding: 9px 12px;
    border: 1px solid var(--bw-line);
    border-left: 3px solid var(--bw-line);
    border-radius: 3px;
    background: rgba(27, 34, 51, 0.72);
    color: var(--bw-ink-dim);
    font: 700 12px/1 ui-monospace, Menlo, Consolas, monospace;
    letter-spacing: 0.16em;
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
  }
  .sp-mode .blurb {
    margin-left: auto;
    font-weight: 400;
    font-size: 10px;
    letter-spacing: 0.06em;
    color: var(--bw-ink-dim);
  }
  .sp-mode[aria-checked="true"] {
    border-color: var(--bw-accent);
    border-left-color: var(--bw-accent);
    background: rgba(69, 224, 232, 0.12);
    color: #d9fbff;
    box-shadow: 0 0 18px rgba(69, 224, 232, 0.22);
  }
  .sp-mode[aria-checked="true"] .blurb { color: var(--bw-accent); }
  .sp-mode:focus-visible { outline: 2px solid var(--bw-accent); outline-offset: 2px; }

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
     falls below the fold: first the spacing, then the badge. */
  @container bwstage (max-height: 620px) {
    .sp-inner { padding: 12px 16px 14px; }
    .sp-w1 { font-size: clamp(24px, 11cqw, 42px); }
    .sp-w2 { font-size: clamp(28px, 13cqw, 52px); }
    .sp-hud, .sp-badge, .sp-logo { margin-bottom: 9px; }
    .sp-rule { margin-bottom: 14px; }
    .sp-modes { gap: 4px; margin-bottom: 12px; }
    .sp-mode { padding: 7px 10px; }
    .sp-start { padding: 12px 26px; }
    .sp-coin { margin-top: 10px; }
    .sp-floor { height: 48%; opacity: 0.5; }
  }
  @container bwstage (max-height: 430px) {
    .sp-floor { opacity: 0.32; }
  }
  @container bwstage (max-height: 340px) {
    .sp-badge { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .sp-floor, .sp-crt::after, .sp-logo, .sp-word::before, .sp-word::after,
    .sp-start, .sp-hud .live { animation: none; }
    .sp-word::before, .sp-word::after { opacity: 0; }
  }
</style>

<div class="bw-root" id="bwRoot">
  <!-- tabindex="-1": focusable by script but not by Tab. Touching or clicking
       the game parks focus here, which is how keyboard input stays scoped to
       "the player is actually looking at the game" instead of the whole page.
       Tab still walks the real controls below, and focusing any of them puts
       focus inside this shadow tree, which counts just the same. -->
  <main id="stage" tabindex="-1">
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

        <div class="sp-rule">SELECT MODE</div>

        <div id="spModes" class="sp-modes" role="radiogroup" aria-label="Game mode"></div>

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

    <div id="muteFlag" role="status" aria-label="Sound off" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="none" />
        <path d="M16 9l5 6M21 9l-5 6" />
      </svg>
    </div>

    <button id="pauseBtn" aria-label="Pause">II</button>
    <button id="bombBtn" class="empty" aria-label="Throw bomb">BOMB<b id="bombCount">0</b></button>
    <button id="fireBtn" aria-label="Fire">FIRE<br>&#9679;</button>
  </main>

</div>
`;

const IDS = [
  "bwRoot", "cv", "stage", "overlay", "ovEyebrow", "ovTitle", "ovSub", "ovStats", "ovBtns",
  "splash", "spBest", "spStart", "spModes", "dpad", "aUp", "aDown", "aLeft", "aRight",
  "pauseBtn", "fireBtn", "bombBtn", "bombCount", "muteFlag",
];

/**
 * Attach (or reuse) the shadow root, stamp the template and collect refs.
 * @param {Element} container
 * @returns {{ root: ShadowRoot, els: Record<string, Element> }}
 */
export function createUI(container) {
  const root = container.shadowRoot || container.attachShadow({ mode: "open" });
  root.innerHTML = TEMPLATE;
  const els = {};
  for (const id of IDS) els[id] = root.getElementById(id);
  return { root, els };
}

/**
 * Live stats have no home in the shell any more: the footer strip (deletions /
 * best chain / accuracy / best / sound) is gone, and those numbers are shown
 * on the interlevel and game-over cards, which is where a player reads rather
 * than fights. Kept as a no-op so the mount can keep announcing `statsChanged`
 * without knowing whether anything is listening.
 *
 * @param {Record<string, Element>} _els
 * @param {ReturnType<import("../core/select.js").statsView>} _stats
 */
export function renderStats(_els, _stats) {}

/** Sound state, as an icon rather than the word "off". */
export function renderSound(els, on) {
  els.muteFlag.classList.toggle("on", !on);
  els.muteFlag.setAttribute("aria-hidden", on ? "true" : "false");
}

export function statRows(rows) {
  return rows
    .map((r) => "<div>" + r[0] + " <b" + (r[2] ? ' class="' + r[2] + '"' : "") + ">" + r[1] + "</b></div>")
    .join("");
}

/**
 * Fill and show the interlevel / game-over card.
 * `o.buttons` are `{ label, dim?, fn }`; their listeners die with the markup.
 */
export function showOverlay(doc, els, o) {
  els.ovEyebrow.textContent = o.eyebrow || "";
  els.ovTitle.textContent = o.title;
  els.ovTitle.classList.toggle("rank", !!o.rank);
  els.ovSub.textContent = o.sub || "";
  els.ovStats.innerHTML = o.stats || "";
  els.ovBtns.innerHTML = "";
  for (const b of o.buttons) {
    const btn = doc.createElement("button");
    btn.textContent = b.label;
    if (b.dim) btn.className = "dim";
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.fn();
    });
    els.ovBtns.appendChild(btn);
  }
  els.overlay.classList.remove("hidden");
}

export function hideOverlay(els) {
  els.overlay.classList.add("hidden");
  els.splash.classList.add("hidden");
}

/**
 * The start screen is static markup in TEMPLATE, so showing it is just a
 * high-score refresh.
 */
export function showSplash(els, best) {
  els.spBest.textContent = String(best).padStart(6, "0");
  hideOverlay(els);
  els.splash.classList.remove("hidden");
}

/**
 * Render the mode menu from the mode table, so adding a mode is a data change
 * and never a markup one. Returns the buttons in order.
 */
export function renderModes(els, modes, selectedId) {
  const doc = els.splash.ownerDocument;
  els.spModes.textContent = "";
  for (const m of modes) {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "sp-mode";
    b.dataset.mode = m.id;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(m.id === selectedId));
    const name = doc.createElement("span");
    name.textContent = m.name;
    const blurb = doc.createElement("span");
    blurb.className = "blurb";
    blurb.textContent = m.blurb;
    b.appendChild(name);
    b.appendChild(blurb);
    els.spModes.appendChild(b);
  }
  return Array.from(els.spModes.children);
}

/** Move the lit row without rebuilding the menu. */
export function selectMode(els, id) {
  for (const b of els.spModes.children) {
    b.setAttribute("aria-checked", String(b.dataset.mode === id));
  }
}

/** The bomb button carries the count; empty, it greys to an outline. */
export function renderBombs(els, n) {
  els.bombCount.textContent = String(n);
  els.bombBtn.classList.toggle("empty", n <= 0);
}
