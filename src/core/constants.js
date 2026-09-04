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
export const PCOLS = 3;          // leftmost columns are the player's half by default

// ---------- modes ----------
// A mode is a small bag of rule overrides, not a code path: the simulation
// reads the world's segment list either way, and the one flag that differs
// decides whether wiping a wave appends a road and the next arena.
//
// ADVANCE makes the board unbounded. Wipe the arena's wave and the whole arena
// is yours, a road opens to the right, and the next arena waits at its end;
// its wave only wakes once you step into it. A road is ROAD_COLS long and is
// either full height or a single middle row, so some crossings funnel you.
export const ROAD_COLS = 3;
export const ROAD_MID_ROW = 1;
// NARROW_ROAD_CHANCE, ARENA_CLEAR_BONUS, ARENA_CLEAR_PTS, ARENA_ENTRY_DELAY_MS
// and CAM_TAU_MS are tuning: see tuning.js.

// An arena guards the road with a POOL of viruses, dealt in waves. A wave is
// the group that joins the board together; its members stay until deleted,
// and the next wave is dealt only once the whole wave is dead. The road opens
// when the pool is spent. So "enemies on screen" and "enemies guarding the
// road" are different numbers: arena 0 is four viruses in two waves of two.
// Ramps by arena index, independent of the stage-gate syllabus.
// ARENA_WAVE_GAP_MS, REFIRE_MS and arenaPlan() are tuning: see tuning.js.

// ADVANCE progression, by arena index. The classic syllabus is keyed to wave
// counts and had taught its last lesson by about arena 30, which is why the
// road went flat around level 40-50. Here each mechanic has an arena, the
// card shows as you step into it, and past ROAD_END the run is UNLIMITED:
// nothing new is held back and the ramps just keep climbing.
// ROAD_END and ADV_UNLOCK are tuning (see tuning.js); the retired ADVANCE
// mode's cards are pinned to the shipped arenas.
export const ADVANCE_STAGES = [
  { arena: 5,   title: "STEEL GUARDS" },
  { arena: 9,   title: "RETALIATION" },
  { arena: 15,  title: "HOPPERS" },
  { arena: 20,  title: "SENTINELS" },
  { arena: 30,  title: "PROGS ONLINE" },
  { arena: 40,  title: "SENTINEL MK II" },
  { arena: 55,  title: "SWARM" },
  { arena: 70,  title: "SENTINEL MK III" },
  { arena: 100, title: "UNLIMITED" },
];

// MET_HOP_MS (the yellow mett's shuffle) is tuning: see tuning.js.

// The Sentinel: a turret with an iris. Closed, it is armour; it opens on a
// rhythm, and the open window is both its telegraph and the only time it can
// be hurt. It fires a heavy shell as it closes. Three marks: more hits to
// kill, a shorter window, a quicker cycle. Timing, where the mett asks for
// aim and the hopper asks for a chase.
// The marks' numbers (SENTINEL), SENTINEL_CHARGED_DMG and sentinelWaveChance
// are tuning: see tuning.js.

// The bomb. Thrown BOMB_RANGE columns ahead along your row, it arcs for
// BOMB_ARC_MS and then splashes a 3x3: charged-shot damage to every virus in
// it, and a hit on you if you are standing in it. One per pickup, found on
// roads; single use, and you can carry as many as you find.
// BOMB_RANGE, BOMB_ARC_MS, BOMB_RADIUS, BOMB_PICKUP_CHANCE and BOMB_BLAST_MS
// are tuning: see tuning.js.

// ---------- towers (story) ----------
// A tower is a roost on the strip: a wide segment of the player's own ground
// with keeper and item tiles, and the guard fight at its far edge is the
// arena that follows it. The strip opens on the first tower; after that a
// tower stands before every TOWER_EVERY-th arena, following STORY_ROUTE
// through the bible's link graph (canon/bible/regions.json) -- act one out to
// the ferry, act two back along the same links. Exits-per-row and sunsets
// come later; for now the route is a line so the story arrives on time.
export const TOWER_COLS = 6;
// TOWER_EVERY is tuning: see tuning.js.
// Every roost once before any repeats (bible: regions.json strip.route_v3),
// then the sunset-order returns. The Substation comes before the Elevator so
// the person there can warn of the crew's numbers.
export const STORY_ROUTE = [
  "roost.01", "roost.02", "roost.03", "roost.05", "roost.06", "roost.04", "roost.07", "roost.08",
  "roost.05", "roost.03", "roost.02", "roost.04", "roost.01",
];
// Who stands on each tower: the keeper mid-floor, a companion off to the
// side, so there is always a lane past them. `verb` is what the context
// button reads beside them.
export const TOWER_SPECS = {
  "roost.01": { npcs: [{ id: "npc.keeper.01", col: 3, row: 1, verb: "talk" }] },
  "roost.02": { npcs: [{ id: "npc.keeper.02", col: 3, row: 1, verb: "talk" }, { id: "npc.side.tally", col: 4, row: 2, verb: "talk" }] },
  "roost.03": { npcs: [{ id: "npc.keeper.03", col: 3, row: 1, verb: "talk" }, { id: "npc.side.vesper", col: 4, row: 0, verb: "talk" }] },
  "roost.04": { npcs: [{ id: "npc.keeper.04", col: 3, row: 1, verb: "talk" }, { id: "npc.side.rivet", col: 4, row: 2, verb: "talk" }] },
  "roost.05": { npcs: [{ id: "npc.keeper.05", col: 3, row: 1, verb: "talk" }, { id: "npc.side.bean", col: 4, row: 0, verb: "talk" }] },
  "roost.06": { npcs: [{ id: "boss.ferryman", col: 3, row: 1, verb: "talk" }, { id: "npc.sweeper.tidy", col: 4, row: 2, verb: "talk" }] },
  "roost.07": { npcs: [{ id: "boss.foreman", col: 3, row: 1, verb: "talk" }] },
  "roost.08": { npcs: [{ id: "item.journal.steward", col: 3, row: 1, verb: "read" }] },
};
export const towerSpec = (roost) => TOWER_SPECS[roost] || { npcs: [] };

// STORY_UNLOCK and unlockTable() are tuning: see tuning.js.

// The hop's phases (HOP_WINDUP_MS, HOP_MOVE_MS, HOP_SETTLE_MS, HOP_TOTAL_MS,
// HOP_COMMIT_MS) are tuning: see tuning.js.

// ---------- clock ----------

// START_TIME and TIME_CAP are tuning: see tuning.js.

// ---------- scoring ----------

// BONUS, PTS and the ALLY_* penalties are tuning: see tuning.js.

// ---------- timings ----------

// CHARGE_MS, RISE_MS, SINK_MS, HIT_MS and MOVE_REPEAT_MS are tuning: see tuning.js.
// TAP_MOVE_MS (the step ration) is tuning: see tuning.js.
// A tap this far outside the grid (in panels) still lands on the nearest row:
// the top row's upper half is thin under a thumb.
export const TAP_SLACK = 0.4;

// ---------- modes (see the board section above for what ADVANCE means) ----------
// `controls` is the shell's business -- which surfaces it wires and how it
// lays them out -- but it rides on the mode so the menu is the one place a
// player chooses. The step ration is tuning: `hop` picks which one applies.
//
// ONE HAND is built for a phone held in one hand: the bottom of the stage is a
// two-button deck (FIRE left, BOMB right) where a keyboard would sit, and the
// board itself is the movement surface -- a floating stick under the thumb,
// or a tap on a square to go there. ADVANCE keeps the ring and the
// quarter-circle FIRE for two thumbs.
export const MODES = [
  // The game: the Rookery's story on one strip. Two-thumb controls -- the
  // ring and the quarter-circle FIRE -- with the board taking taps to walk
  // there, and every step a hop.
  { id: "story", name: "STORY", blurb: "the Rookery", advancing: true, story: true,
    controls: "pad", hop: true, tapMove: true },
];
// Retired: off the menu, but still resolvable by id. CLASSIC is the fixed
// six-column board every renderer golden was pinned against; ONE HAND and
// ADVANCE are the arcade layouts the story grew out of, kept for their tests
// and goldens. Nothing on the menu starts them.
export const RETIRED_MODES = [
  { id: "onehand", name: "ONE HAND", blurb: "stick · tap · fire", advancing: true,
    controls: "touch", hop: true, tapMove: true },
  { id: "advance", name: "ADVANCE", blurb: "ring + fire", advancing: true,
    controls: "pad" },
  { id: "classic", name: "CLASSIC", blurb: "hold the line", advancing: false,
    controls: "pad" },
];
export const DEFAULT_MODE = "story";
export const modeById = (id) =>
  MODES.find((m) => m.id === id) || RETIRED_MODES.find((m) => m.id === id) || MODES[0];
// HOP_MS, HOP_GROW_MS, HOPPER_LIFE, RARE_LIFE and ALLY_RISE_MS are tuning: see tuning.js.

// ---------- difficulty ramps ----------
//
// Two clocks drive difficulty, deliberately:
//
//   `deletions` — how much the player has actually killed. Everything about
//                 how *hard* an individual enemy is (how long it stays up, how
//                 fast its bolt travels, how long it aims) reads from here, so
//                 a player who is not killing anything is not being punished
//                 with a faster game.
//   `stageIdx`  — how much the player has been *taught*. Every composition
//                 decision (which skins can appear, how big a wave is) reads
//                 from here, so a mechanic can never appear before the card
//                 that explains it.
//
// Waves add a third, `waveIdx`, but it only tightens the rhythm (stagger and
// lull), never the content.

// upMs() and level() are tuning: see tuning.js.

// ---------- waves ----------
//
// Enemies arrive as a formation, are cleared (or expire), and are followed by
// a real lull. The lull is the game breathing: it is where you reposition,
// charge, and read the board. It is short enough that the clock never drains
// alarmingly, and it collapses further when the clock is genuinely low.

// MAX_ALIVE is tuning: see tuning.js.
export const WAVE_SIZE = [2, 2, 3, 3, 3, 4, 4, 4, 5];
/** How many viruses a wave holds, by how many stage cards have been shown. */
export const waveSize = (stageIdx) =>
  WAVE_SIZE[Math.max(0, Math.min(WAVE_SIZE.length - 1, stageIdx))];

// The rhythm numbers -- waveStaggerMs(), waveLullMs(), WAVE_CLEAR_LULL,
// LOW_TIME_LULL_MS, waveClearBonus(), WAVE_CLEAR_PTS, WAVE_GRACE_MS -- are
// tuning: see tuning.js. The lull takes its step down once the SWARM card
// has been shown, in the retired card modes:
export const LULL_TIGHTEN_STAGE = 7;     // stageIdx once the SWARM card is shown

// Formations. Each is five slots in *arrival order*, so a small wave is the
// head of the same shape and a big one completes it. `anchor` names the slot
// that becomes the heavy (a steel guard) once guards are unlocked. Rows are
// rotated by the rng at spawn time, so the same six shapes read differently
// every time without becoming a random scatter.
export const FORMATIONS = [
  { name: "spine",   anchor: 0, slots: [[4, 1], [4, 0], [4, 2], [3, 1], [5, 1]] },
  { name: "rank",    anchor: 2, slots: [[5, 1], [4, 1], [3, 1], [5, 0], [5, 2]] },
  { name: "stagger", anchor: 4, slots: [[3, 0], [4, 1], [5, 2], [5, 0], [3, 2]] },
  { name: "pincer",  anchor: 2, slots: [[3, 0], [3, 2], [4, 1], [5, 0], [5, 2]] },
  { name: "wall",    anchor: 1, slots: [[5, 0], [5, 1], [5, 2], [4, 0], [4, 2]] },
  { name: "wedge",   anchor: 0, slots: [[5, 1], [4, 0], [4, 2], [3, 1], [3, 0]] },
];

// ---------- composition ----------
//
// Which skins a wave may contain is keyed on `stageIdx`: the index of the next
// card the player has *not* seen. UNLOCK.guard === 1 means "guards may appear
// once one card has been shown", and STAGES[0] is the guard card. So the card
// always comes first.

export const UNLOCK = { guard: 1, retaliate: 2, ally: 3, hopper: 4, rare: 5 };

// The per-wave composition chances (guard, hopper, ally, rare) are tuning:
// see tuning.js. They take "steps past the unlock", which the caller computes
// from UNLOCK above.

// ---------- counterattack ----------
//
// A virus marks its row, then fires back down it. The mark plus the bolt's
// travel is the whole dodge window, so both tighten with level rather than the
// attack simply becoming more frequent.
//
// There are two bolts and they are a real mechanic, not a sprite swap:
//
//   slow — the mett's. Huge, heavy, lumbering. Its travel is long enough that
//          you can still leave the row after it launches.
//   fast — the hopper's. Smaller but still large, and it crosses the board in
//          a blink, so it must be dodged during the telegraph. It pays for
//          that with the longest aim in the game.
//
// `radiusFrac` is a fraction of panel width, so the head scales with the board
// and the renderer never has to know the difficulty.

// ATTACK_START, HIT_TIME_PENALTY, HIT_IFRAME_MS, BOLT_HIT_R, ATTACK_FOLLOW_MS,
// the BOLT kinds and aimMs()/boltPanelMs()/dodgeWindowMs() are tuning: see
// tuning.js.
export const HURT_SHAKE_MS = 260;

/** Which bolt a skin fires. Guards are anchors and never shoot. */
// Which bolt a type throws is a column of the enemy table; re-exported here
// because the shell has always asked constants for it.
export { boltKindFor } from "./enemies.js";

// attackChance(), OC_START, OC_SLOPE and bonusFactor() are tuning: see tuning.js.

export const multOf = (chain) => (chain >= 20 ? 4 : chain >= 10 ? 3 : chain >= 5 ? 2 : 1);

// Stage gates: each new mechanic pauses the run for a splash + continue/end
// choice. A gate needs BOTH floors — `wave` waves must have started AND `at`
// deletions must be on the board — so a strong player cannot rush the whole
// syllabus in the first minute (waves arrive at their own pace) and a weak one
// is never handed a mechanic they have not earned. Both sequences ascend, so
// the gates stay strictly ordered.
export const STAGES = [
  { wave: 16,  at: 26,       title: "STEEL GUARDS" },
  { wave: 28,  at: 52,       title: "RETALIATION" },
  { wave: 40,  at: 78,       title: "PROGS ONLINE" },
  { wave: 52,  at: 105,      title: "HOPPERS" },
  { wave: 64,  at: 130,      title: "RARE VIRUS" },
  { wave: 76,  at: 170,      title: "OVERCLOCK" },   // the shipped OC_START
  { wave: 90,  at: 195,      title: "SWARM" },
  { wave: 106, at: 235,      title: "MAXIMUM LOAD" },
];
// STAGE_BONUS is tuning: see tuning.js.


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
// LOW_TIME is tuning: see tuning.js.

// Hit-stop: a few frozen milliseconds at the moment the tracer lands, scaled by
// what died. It freezes the *simulation* clock (animations, bolts, spawn and
// aim timers) but deliberately not `timeLeft` — juice must never hand the
// player a slower run clock, or a kill spammer would farm it.
export const HITSTOP = {
  normal: 26, charged: 52, guard: 46, hopper: 30, rare: 96,
  spreader: 38, warden: 44, darter: 32,
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
  spreader: { amp: 6,   ms: 175 },
  warden:   { amp: 7.5, ms: 200 },
  darter:   { amp: 5,   ms: 160 },
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
  spreader: ["#ffa23f", "#ffd0a0", "#ffe8d0"],
  warden:   ["#c07be0", "#e0bcf0", "#f0dcff"],
  darter:   ["#3fd8b0", "#a0f0dc", "#d8fff4"],
  player: ["#ff5470", "#ff9f45", "#ffd7de"],
};

// How many bits a deletion throws. Capped so a crowded late-game frame is
// still bounded by MAX_BITS.
export const BIT_COUNT = {
  normal: 9, charged: 14, guard: 13, hopper: 11, rare: 22,
  spreader: 12, warden: 13, darter: 11,
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

//
// `bottomInset` is the height the shell has given to an opaque control deck
// along the bottom edge (one-hand's two buttons). The board is laid out in
// what is left above it; with no deck the numbers are exactly what they were,
// so every golden pinned before the deck existed still holds.
export function layout(w, h, bottomInset = 0) {
  const gw = Math.min(w * 0.9, 760);
  const pw = gw / COLS;
  const hh = h - bottomInset;
  // the reserve keeps the board clear of the HUD above and the controls below;
  // with a deck the controls are already outside `hh`, and what is left above
  // the board is the HUD plus the BOMB bar the shell places there
  const reserve = 180;
  const ph = Math.min(pw * 0.62, (hh - reserve) / ROWS);
  return {
    w, h, pw, ph,
    gx: (w - pw * COLS) / 2,
    // above a deck the board rests on it: the squares are the tap targets and
    // FIRE is under the same thumb, so the two should touch
    gy: bottomInset > 0 ? hh - ph * ROWS : h * 0.52 - (ph * ROWS) / 2,
    bottomInset,
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
