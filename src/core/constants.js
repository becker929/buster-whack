/*!
 * Tuning tables, ramp functions and layout math.
 *
 * Pure module: numbers in, numbers out. No DOM, no audio, no randomness,
 * no clock. Everything the game is balanced around lives here so the ramps
 * can be read (and tested) without booting the shell.
 */

// ---------- board ----------

export const ROWS = 3;
export const COLS = 6;
export const PCOLS = 3;          // leftmost columns are the player's half

// ---------- clock ----------

export const START_TIME = 30;
export const TIME_CAP = 45;

// ---------- scoring ----------

export const BONUS = { normal: 1.2, charged: 2.5, guard: 3.0, hopper: 1.8, rare: 8.0 };
export const PTS   = { normal: 100, charged: 300, guard: 400, hopper: 250, rare: 1000 };
export const ALLY_TIME_PENALTY = 3.0;
export const ALLY_PTS_PENALTY = 200;
export const ALLY_SPARE_BONUS = 0.5;

// ---------- timings ----------

export const CHARGE_MS = 700;
export const RISE_MS = 220, SINK_MS = 180, HIT_MS = 280;
export const MOVE_REPEAT_MS = 130;
export const HOP_MS = 550, HOP_GROW_MS = 120;
export const HOPPER_LIFE = 2200, RARE_LIFE = 650;
export const ALLY_RISE_MS = 460;  // progs surface slowly and can't be hit until fully up

// ---------- difficulty ramps ----------

export const upMs  = (del) => Math.max(450, 1150 - del * 55);
export const gapMs = (del) => Math.max(160, 520 - del * 22);
export const level = (del) => 1 + Math.floor(del / 5);
export const maxConcurrent = (del) => (del >= 150 ? 4 : del >= 75 ? 3 : del >= 20 ? 2 : 1);
export const guardChance  = (del) => (del < 8 ? 0 : Math.min(0.35, 0.15 + del * 0.002));
export const hopperChance = (del) => (del < 30 ? 0 : Math.min(0.25, 0.1 + del * 0.001));
export const allyChance   = (del) => (del < 20 ? 0 : Math.min(0.20, 0.08 + del * 0.0004));
export const rareChance   = (del, timeLeft) => (del < 50 ? 0 : 0.04 * (timeLeft < 10 ? 3 : 1));

// counterattack: a virus marks its row, then fires back down it. The mark
// plus the bolt's travel time is the whole dodge window, so both tighten
// with level rather than the attack simply becoming more frequent.
export const ATTACK_START = 12;
export const HIT_TIME_PENALTY = 2.5;
export const HIT_IFRAME_MS = 800;
export const HURT_SHAKE_MS = 260;
export const aimMs = (del) => Math.max(280, 620 - (del - ATTACK_START) * 6);
export const boltPanelMs = (del) => Math.max(95, 190 - (del - ATTACK_START) * 0.8);
export const attackChance = (del) =>
  (del < ATTACK_START ? 0 : Math.min(0.55, 0.22 + (del - ATTACK_START) * 0.004));

// OVERCLOCK: past OC_START deletions, time rewards decay forever (no floor),
// so every run mathematically ends. 0.995 sets the slope; rares decay at
// sqrt of the factor — half the exponential rate — so late-game survival
// becomes rare-hunting rather than a fixed death spiral.
export const OC_START = 60;
export const bonusFactor = (del) => (del < OC_START ? 1 : Math.pow(0.995, del - OC_START));

export const multOf = (chain) => (chain >= 20 ? 4 : chain >= 10 ? 3 : chain >= 5 ? 2 : 1);

// stage gates: each new mechanic pauses the run for a splash + continue/end choice
export const STAGES = [
  { at: 8,   title: "STEEL GUARDS", desc: "armored viruses — charged shots only" },
  { at: 12,  title: "RETALIATION",  desc: "viruses shoot back — a marked row is\nabout to fire; move off it" },
  { at: 20,  title: "PROGS ONLINE", desc: "blue friendlies join — hold fire\ntwo viruses at once" },
  { at: 30,  title: "HOPPERS",      desc: "green hoppers flee — 2 taps or 1 charge" },
  { at: 50,  title: "RARE VIRUS",   desc: "gold jackpot spawns — bust it fast" },
  { at: 60,  title: "OVERCLOCK",    desc: "time rewards decay from here on" },
  { at: 75,  title: "×3 VIRUSES",   desc: "three at once — keep the chain" },
  { at: 150, title: "×4 VIRUSES",   desc: "maximum pressure" },
];
export const STAGE_BONUS = 2.0;

// ---------- fx lifetimes (core owns the data, the renderer only reads it) ----------

export const POPUP_MS = 650;
export const SPARK_MS = 140;
export const RAY_IMPACT_MS = 130;
export const MUZZLE_MS = { normal: 95, charged: 140 };
export const HURT_FLASH_MS = 190;

// ---------- juice ----------
// Everything below is presentation, but it is *data*, so the core can author it
// deterministically and the renderer stays a pure function of the state.

export const TAU = Math.PI * 2;
// @napi-rs/canvas draws an exact-2*PI arc() as nothing where a browser closes
// the circle. Every ring in the renderer sweeps TAU - RING_GAP instead, so the
// same shape is visible in the golden harness and in the browser.
export const RING_GAP = 0.09;

export const BIT_MS = 520;           // debris lifetime
export const MAX_BITS = 96;          // hard cap; this many fillRects every frame
export const BIT_GRAVITY = 0.0016;   // px per ms^2
export const RIPPLE_MS = 300;        // panel impact ring
export const FLARE_MS = 520;         // chain-milestone flourish
export const CHAIN_BREAK_MS = 620;   // and what a broken chain looks like
export const GHOST_MS = 170;         // player afterimage on a move
export const LANE_MS = 240;          // the row stays lit behind a landed shot
export const LOW_TIME = 6;           // seconds; the urgency frame comes on here

// Hit-stop: a few frozen milliseconds at the moment the tracer lands, scaled by
// what died. It freezes the *simulation* clock (animations, bolts, spawn and
// aim timers) but deliberately not `timeLeft` — juice must never hand the
// player a slower run clock, or a kill spammer would farm it.
export const HITSTOP = {
  normal: 26, charged: 52, guard: 46, hopper: 30, rare: 96,
  block: 12, stagger: 18, prog: 34, hurt: 70, chain: 26,
};
export const MAX_HITSTOP = 150;      // never freeze longer than this at once

// Screen shake, as { amp: px, ms }. One envelope, many senders, so two events
// in the same frame cannot fight over the transform.
export const SHAKE = {
  normal:  { amp: 3.5, ms: 120 },
  charged: { amp: 8,   ms: 210 },
  guard:   { amp: 7,   ms: 190 },
  hopper:  { amp: 4.5, ms: 150 },
  rare:    { amp: 13,  ms: 380 },
  prog:    { amp: 6,   ms: 220 },
  hurt:    { amp: 9,   ms: HURT_SHAKE_MS },
  chain:   { amp: 6,   ms: 260 },
};

// Debris tints per skin: a deletion sprays the colour of the thing deleted.
export const DEBRIS = {
  mett:   ["#ffd23f", "#ffe89a", "#fff0c0"],
  guard:  ["#dfe7fb", "#aeb9d6", "#c9f6ff"],
  hopper: ["#5ee87c", "#a6f5bb", "#c8ffd8"],
  ally:   ["#58c7ff", "#a9defc", "#e2f4ff"],
  rare:   ["#fff3c4", "#ffc95a", "#ffd23f"],
  player: ["#ff5470", "#ff9f45", "#ffd7de"],
};

// How many bits a deletion throws. Capped so a crowded late-game frame is
// still bounded by MAX_BITS.
export const BIT_COUNT = {
  normal: 9, charged: 14, guard: 13, hopper: 11, rare: 22,
  block: 4, stagger: 5, prog: 8, hurt: 12,
};

// reducedMotion damping. Shake nearly vanishes, full-screen flashes lose most
// of their punch, and anything that strobes goes steady (0 = no strobe).
export const RM = { shake: 0.12, flash: 0.35, strobe: 0 };

// ---------- easing ----------

export const EASE = {
  linear: (p) => p,
  out2:   (p) => 1 - (1 - p) ** 2,
  out3:   (p) => 1 - (1 - p) ** 3,
};

// ---------- impulse envelope ----------
// Plain data ({ spec, t0 }) rather than a class, so a whole state object stays
// structured-clonable and a headless renderer can be handed one verbatim.

export function makeImpulse(spec, t0 = -Infinity) {
  return { spec, t0 };
}

export function impulseValue(imp, now) {
  const sp = imp.spec;
  const attack = sp.attackMs || 0;
  const over = sp.overshoot || 0;
  const rebound = sp.reboundMs || sp.releaseMs * 0.9;
  const ease = EASE[sp.ease || "linear"];
  let t = now - imp.t0;
  if (t < 0) return 0;
  if (attack > 0 && t < attack) return t / attack;
  t -= attack;
  if (t < sp.releaseMs) return 1 - (1 + over) * ease(t / sp.releaseMs);
  t -= sp.releaseMs;
  if (over > 0 && t < rebound) return -over * (1 - EASE.out2(t / rebound));
  return 0;
}

// ---------- hit-feel tiers ----------

export const TIERS = {
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

// ---------- layout ----------
// Geometry is a pure function of the stage's CSS pixel size. Nothing here
// measures an element, so the same numbers can be produced off-screen.

export function layout(w, h) {
  const gw = Math.min(w * 0.9, 760);
  const pw = gw / COLS;
  const ph = Math.min(pw * 0.62, (h - 180) / ROWS);
  return {
    w, h, pw, ph,
    gx: (w - pw * COLS) / 2,
    gy: h * 0.52 - (ph * ROWS) / 2,
  };
}

export function panelRect(G, col, row) {
  return { x: G.gx + col * G.pw, y: G.gy + row * G.ph, w: G.pw, h: G.ph };
}

// shared firing line for both sides, so a bolt visibly occupies the lane
// the player's own tracer runs down
export function laneY(G, row) {
  return panelRect(G, 0, row).y + G.ph * 0.78 - G.ph * 1.15 * 0.42;
}
