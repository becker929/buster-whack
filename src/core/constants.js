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
export const NARROW_ROAD_CHANCE = 0.5;
export const ARENA_CLEAR_BONUS = 3.0;    // seconds for taking an arena
export const ARENA_CLEAR_PTS = 1500;
export const ARENA_ENTRY_DELAY_MS = 650;  // the beat between stepping in and the wave waking
export const CAM_TAU_MS = 170;            // camera ease: 63% of the way per TAU

// An arena guards the road with a POOL of viruses, dealt in waves. A wave is
// the group that joins the board together; its members stay until deleted,
// and the next wave is dealt only once the whole wave is dead. The road opens
// when the pool is spent. So "enemies on screen" and "enemies guarding the
// road" are different numbers: arena 0 is four viruses in two waves of two.
// Ramps by arena index, independent of the stage-gate syllabus.
export const ARENA_WAVE_GAP_MS = 550;     // the beat between a wave dying and the next dealing
export const REFIRE_MS = 1400;            // a persistent attacker re-aims this long after firing
export function arenaPlan(idx) {
  const pool = Math.min(20, 4 + Math.floor(idx * 0.16));
  const waveSize = Math.min(5, 2 + Math.floor(idx / 25));
  return { pool, waveSize };
}

// ADVANCE progression, by arena index. The classic syllabus is keyed to wave
// counts and had taught its last lesson by about arena 30, which is why the
// road went flat around level 40-50. Here each mechanic has an arena, the
// card shows as you step into it, and past ROAD_END the run is UNLIMITED:
// nothing new is held back and the ramps just keep climbing.
export const ROAD_END = 100;
export const ADV_UNLOCK = {
  guard: 5, retaliate: 9, hopper: 15, sentinel1: 20, ally: 30,
  sentinel2: 40, swarm: 55, sentinel3: 70, unlimited: ROAD_END,
};
export const ADVANCE_STAGES = [
  { arena: ADV_UNLOCK.guard,     title: "STEEL GUARDS" },
  { arena: ADV_UNLOCK.retaliate, title: "RETALIATION" },
  { arena: ADV_UNLOCK.hopper,    title: "HOPPERS" },
  { arena: ADV_UNLOCK.sentinel1, title: "SENTINELS" },
  { arena: ADV_UNLOCK.ally,      title: "PROGS ONLINE" },
  { arena: ADV_UNLOCK.sentinel2, title: "SENTINEL MK II" },
  { arena: ADV_UNLOCK.swarm,     title: "SWARM" },
  { arena: ADV_UNLOCK.sentinel3, title: "SENTINEL MK III" },
  { arena: ADV_UNLOCK.unlimited, title: "UNLIMITED" },
];

// The yellow mett is a low-level hopper now: it does move, but at a third of
// the green one's pace, so its lane is still something you can plan around.
export const MET_HOP_MS = 1500;

// The Sentinel: a turret with an iris. Closed, it is armour; it opens on a
// rhythm, and the open window is both its telegraph and the only time it can
// be hurt. It fires a heavy shell as it closes. Three marks: more hits to
// kill, a shorter window, a quicker cycle. Timing, where the mett asks for
// aim and the hopper asks for a chase.
export const SENTINEL = {
  1: { hp: 1, openMs: 1400, closedMs: 1500 },
  2: { hp: 2, openMs: 1050, closedMs: 1250 },
  3: { hp: 3, openMs: 780,  closedMs: 1050 },
};
export const SENTINEL_CHARGED_DMG = 2;
export const sentinelWaveChance = (idx) => Math.min(0.7, 0.35 + (idx - ADV_UNLOCK.sentinel1) * 0.006);

// The bomb. Thrown BOMB_RANGE columns ahead along your row, it arcs for
// BOMB_ARC_MS and then splashes a 3x3: charged-shot damage to every virus in
// it, and a hit on you if you are standing in it. One per pickup, found on
// roads; single use, and you can carry as many as you find.
export const BOMB_RANGE = 3;
export const BOMB_ARC_MS = 640;
export const BOMB_RADIUS = 1;               // tiles either side of the landing square
export const BOMB_PICKUP_CHANCE = 0.6;      // per road; the first road always has one
export const BOMB_BLAST_MS = 460;

// ---------- towers (story) ----------
// A tower is a roost on the strip: a wide segment of the player's own ground
// with keeper and item tiles, and the guard fight at its far edge is the
// arena that follows it. The strip opens on the first tower; after that a
// tower stands before every TOWER_EVERY-th arena, following STORY_ROUTE
// through the bible's link graph (canon/bible/regions.json) -- act one out to
// the ferry, act two back along the same links. Exits-per-row and sunsets
// come later; for now the route is a line so the story arrives on time.
export const TOWER_COLS = 6;
export const TOWER_EVERY = 10;
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

// The story's unlocks, keyed to arenas so that the tower before each one is
// where a person announces it (there are no cards in the story). Towers stand
// before arenas 10, 20, 30, ...: the Tower warns of steel before 10, the
// Annex asks you to spare the runners before 20, and so on.
export const STORY_UNLOCK = {
  guard: 10, ally: 20, retaliate: 30, hopper: 40, sentinel1: 50,
  swarm: 60, sentinel2: 70, sentinel3: 90, unlimited: ROAD_END,
};
export const unlockTable = (mode) => (mode.story ? STORY_UNLOCK : ADV_UNLOCK);

// ---------- the hop (touch modes) ----------
// A step is a hop, one square, never diagonal: a crouch, the arc, a landing
// squash, and the rest of the ration as cooldown. The square you count as
// standing on changes at the top of the arc, so a bolt reads the sprite where
// it is. A tap further than one square away lays a path and the hops follow
// it, one per ration, until any new directive replaces it.
export const HOP_WINDUP_MS = 30;
export const HOP_MOVE_MS = 80;
export const HOP_SETTLE_MS = 55;
export const HOP_TOTAL_MS = HOP_WINDUP_MS + HOP_MOVE_MS + HOP_SETTLE_MS;
export const HOP_COMMIT_MS = HOP_WINDUP_MS + HOP_MOVE_MS / 2;

// ---------- clock ----------

export const START_TIME = 30;
export const TIME_CAP = 45;

// ---------- scoring ----------

export const BONUS = { sentinel: 3.0, normal: 1.2, charged: 2.5, guard: 3.0, hopper: 1.8, rare: 8.0 };
export const PTS   = { sentinel: 500, normal: 100, charged: 300, guard: 400, hopper: 250, rare: 1000 };
export const ALLY_TIME_PENALTY = 3.0;
export const ALLY_PTS_PENALTY = 200;
export const ALLY_SPARE_BONUS = 0.5;

// ---------- timings ----------

export const CHARGE_MS = 700;
export const RISE_MS = 220, SINK_MS = 180, HIT_MS = 280;
export const MOVE_REPEAT_MS = 130;
// One-hand movement: a tap is one step and a held stick is one step per
// ration -- 195ms, a bit over a quarter of a charge -- so a position is a
// commitment rather than a twitch while still reading as quick. A step asked
// for during the cooldown is held and taken the moment it ends.
export const TAP_MOVE_MS = 195;
// A tap this far outside the grid (in panels) still lands on the nearest row:
// the top row's upper half is thin under a thumb.
export const TAP_SLACK = 0.4;

// ---------- modes (see the board section above for what ADVANCE means) ----------
// `controls` is the shell's business -- which surfaces it wires and how it
// lays them out -- but it rides on the mode so the menu is the one place a
// player chooses. `moveMs` is the core's: the step ration for this mode.
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
    controls: "pad", hop: true, tapMove: true, moveMs: TAP_MOVE_MS },
];
// Retired: off the menu, but still resolvable by id. CLASSIC is the fixed
// six-column board every renderer golden was pinned against; ONE HAND and
// ADVANCE are the arcade layouts the story grew out of, kept for their tests
// and goldens. Nothing on the menu starts them.
export const RETIRED_MODES = [
  { id: "onehand", name: "ONE HAND", blurb: "stick · tap · fire", advancing: true,
    controls: "touch", hop: true, tapMove: true, moveMs: TAP_MOVE_MS },
  { id: "advance", name: "ADVANCE", blurb: "ring + fire", advancing: true,
    controls: "pad", moveMs: MOVE_REPEAT_MS },
  { id: "classic", name: "CLASSIC", blurb: "hold the line", advancing: false,
    controls: "pad", moveMs: MOVE_REPEAT_MS },
];
export const DEFAULT_MODE = "story";
export const modeById = (id) =>
  MODES.find((m) => m.id === id) || RETIRED_MODES.find((m) => m.id === id) || MODES[0];
export const HOP_MS = 550, HOP_GROW_MS = 120;
export const HOPPER_LIFE = 2200, RARE_LIFE = 650;
export const ALLY_RISE_MS = 460;  // progs surface slowly and can't be hit until fully up

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

export const upMs  = (del) => Math.max(520, 1250 - del * 18);
export const level = (del) => 1 + Math.floor(del / 6);

// ---------- waves ----------
//
// Enemies arrive as a formation, are cleared (or expire), and are followed by
// a real lull. The lull is the game breathing: it is where you reposition,
// charge, and read the board. It is short enough that the clock never drains
// alarmingly, and it collapses further when the clock is genuinely low.

export const MAX_ALIVE = 6;              // hard ceiling: wave + prog + rare
export const WAVE_SIZE = [2, 2, 3, 3, 3, 4, 4, 4, 5];
/** How many viruses a wave holds, by how many stage cards have been shown. */
export const waveSize = (stageIdx) =>
  WAVE_SIZE[Math.max(0, Math.min(WAVE_SIZE.length - 1, stageIdx))];

/** Gap between arrivals inside one wave: a formation lands, it does not blink in. */
export const waveStaggerMs = (w) => Math.max(170, 420 - w * 4);
/**
 * The pause between waves. It tightens slowly as the run goes on, and takes a
 * real step down at the SWARM card — which is the card that promises exactly
 * that, so the promise is kept in the numbers and not just in the copy.
 */
export const LULL_TIGHTEN_STAGE = 7;     // stageIdx once the SWARM card is shown
export const waveLullMs = (w, stage = 0) =>
  Math.max(620, (1900 - w * 10) * (stage >= LULL_TIGHTEN_STAGE ? 0.7 : 1));
/** Clearing every virus in a wave cuts the lull — pressure is a reward. */
export const WAVE_CLEAR_LULL = 0.62;
/** …but a lull never outstays a nearly-dead clock. */
export const LOW_TIME_LULL_MS = 420;
/** Time paid for a perfect clear, before overclock decay. */
export const waveClearBonus = (n) => 0.55 + 0.3 * n;
/** Points paid for a perfect clear, per virus, times the live multiplier. */
export const WAVE_CLEAR_PTS = 60;
/** A wave gives up and starts its lull once every member has had its chance. */
export const WAVE_GRACE_MS = 900;

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

/** Per-wave chance the anchor slot is a steel guard. */
export const guardWaveChance  = (stage) => Math.min(0.8, 0.4 + (stage - UNLOCK.guard) * 0.08);
/** Per-wave chance one non-anchor slot is a hopper (two once waves are big). */
export const hopperWaveChance = (stage) => Math.min(0.65, 0.35 + (stage - UNLOCK.hopper) * 0.08);
/** Per-wave chance a prog tags along as an extra body. */
export const allyWaveChance   = (stage) => Math.min(0.45, 0.25 + (stage - UNLOCK.ally) * 0.05);
/** Per-wave chance a rare leads the wave in. Desperation raises it. */
export const rareWaveChance   = (stage, timeLeft) =>
  (0.05 + (stage - UNLOCK.rare) * 0.01) * (timeLeft < LOW_TIME * 2 ? 2.5 : 1);

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

export const ATTACK_START = 12;          // deletions; the earliest anything shoots
export const HIT_TIME_PENALTY = 2.5;
export const HIT_IFRAME_MS = 800;
export const HURT_SHAKE_MS = 260;
export const BOLT_HIT_R = 0.28;          // fraction of panel width
export const ATTACK_FOLLOW_MS = 300;     // an attacker outlives its own aim by this

export const BOLT = {
  slow: {
    radiusFrac: 0.19,
    aimMs:   (del) => Math.max(340, 560 - Math.max(0, del - ATTACK_START) * 0.8),
    panelMs: (del) => Math.max(175, 300 - Math.max(0, del - ATTACK_START) * 0.45),
  },
  fast: {
    radiusFrac: 0.135,
    aimMs:   (del) => Math.max(480, 780 - Math.max(0, del - ATTACK_START) * 1.1),
    panelMs: (del) => Math.max(72, 130 - Math.max(0, del - ATTACK_START) * 0.2),
  },
};

/**
 * The whole dodge window for one bolt, in ms: the telegraph plus the time the
 * bolt spends crossing `panels` panels to reach the player. This is the number
 * the fairness of the counterattack lives or dies by, so it is one function
 * rather than something each caller re-derives.
 */
export const dodgeWindowMs = (del, kind, panels = 3) =>
  BOLT[kind].aimMs(del) + Math.max(0, panels - BOLT_HIT_R) * BOLT[kind].panelMs(del);

/** Which bolt a skin fires. Guards are anchors and never shoot. */
export const boltKindFor = (type) => (type === "hopper" ? "fast" : "slow");
export const aimMs = (del, kind = "slow") => BOLT[kind].aimMs(del);
export const boltPanelMs = (del, kind = "slow") => BOLT[kind].panelMs(del);

/** Per-enemy chance it will retaliate at all. Hoppers snipe less often. */
export const attackChance = (del, type = "mett") => {
  if (del < ATTACK_START) return 0;
  const t = Math.max(0, del - ATTACK_START);
  return type === "hopper"
    ? Math.min(0.45, 0.18 + t * 0.003)
    : Math.min(0.55, 0.24 + t * 0.004);
};

// OVERCLOCK: past OC_START deletions, time rewards decay forever (no floor),
// so every run mathematically ends. OC_SLOPE sets the slope; rares decay at
// sqrt of the factor — half the exponential rate — so late-game survival
// becomes rare-hunting rather than a fixed death spiral.
//
// OC_START is also the deletion floor on the OVERCLOCK gate, so the decay and
// the card that announces it are the same moment by construction.
export const OC_START = 170;
export const OC_SLOPE = 0.988;
export const bonusFactor = (del) => (del < OC_START ? 1 : Math.pow(OC_SLOPE, del - OC_START));

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
  { wave: 76,  at: OC_START, title: "OVERCLOCK" },
  { wave: 90,  at: 195,      title: "SWARM" },
  { wave: 106, at: 235,      title: "MAXIMUM LOAD" },
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
