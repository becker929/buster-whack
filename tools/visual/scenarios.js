/*!
 * Visual-regression scenarios — data, read by `harness.js`.
 *
 * A scenario is a record, not a script. It names a seed, a canvas size, a
 * number of fixed-dt frames to simulate, a list of *cues* keyed by frame
 * index, and the frames to capture. The harness owns all the machinery; every
 * scenario below is declarative so they stay comparable and easy to extend.
 *
 * Cue vocabulary (all optional, applied in this order at the start of frame
 * `at`, before that frame's `step()`):
 *
 *   spawning: boolean        organic spawning on/off (`state.nextSpawnAt`)
 *   set:      object         dotted-path assignments onto the core state,
 *                            e.g. { deletions: 64, "player.row": 0 }
 *   place:    enemy[]        drop enemies onto the board, exactly the way
 *                            `test/helpers.mjs` does
 *   bolt:     bolt | bolt[]  inject incoming fire, using the core's own speed
 *                            formula for the current difficulty
 *   charge:   "full"|"clear" arm or spill a fully-charged buster
 *   actions:  intent[]       core intents for this frame
 *   hold:     {dc,dr}|null   held d-pad direction for this frame
 *
 * Forcing state directly is deliberate. Waiting for the RNG to produce a
 * charged kill on a guard while a heavy bolt is in flight would make the
 * goldens hostage to unrelated tuning changes; setting the board up is both
 * faster and more precise about what each frame is meant to prove.
 *
 * Board geometry: columns 0-2 are the player's half, 3-5 are the enemies',
 * rows 0-2 top to bottom. The player starts at column 1, row 1.
 */

/** Fixed step. 60fps in exact IEEE-754 doubles, identical on every machine. */
export const DT = 1000 / 60;

/** The default stage size — 900x640, matching the demo page's aspect. */
const W = 900;
const H = 640;

export const scenarios = [
  {
    name: "empty-field",
    title: "Empty field",
    why: "Board panels, the player sprite, the player's panel highlight and the resting HUD. The baseline every other scenario is a delta from.",
    seed: 42,
    width: W,
    height: H,
    frames: 32,
    capture: [
      { at: 0, as: "boot" },
      { at: 30, as: "idle" },
    ],
    cues: [],
  },

  {
    name: "combat-crowd",
    title: "Mid-combat, every enemy type on the board",
    why: "All five skins at once (mett, steel guard, hopper, prog, rare) plus the rising / up / sinking states and the rare's shimmer outline.",
    seed: 7,
    width: W,
    height: H,
    frames: 26,
    capture: [
      { at: 6, as: "crowd" },
      { at: 24, as: "crowd-late" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 40, score: 62300, chain: 3, bestChain: 9, timeLeft: 21.4 },
        place: [
          { col: 3, row: 0, type: "mett", state: "up" },
          { col: 4, row: 1, type: "guard", state: "up" },
          { col: 5, row: 2, type: "hopper", state: "up" },
          { col: 3, row: 2, type: "ally", state: "rising" },
          { col: 5, row: 0, type: "rare", state: "up" },
          { col: 4, row: 2, type: "mett", state: "sinking" },
        ],
      },
    ],
  },

  {
    name: "aim-telegraph",
    title: "Counterattack telegraph mid-charge",
    why: "The dashed lane, the filling threat wash and the edge chevron — which flips from red to yellow past 75% of the aim window. The whole fairness budget of the retaliation mechanic.",
    seed: 11,
    width: W,
    height: H,
    frames: 32,
    capture: [
      { at: 10, as: "early" },
      { at: 20, as: "mid" },
      { at: 30, as: "imminent" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 20, score: 30100, timeLeft: 18.6 },
        place: [
          { col: 5, row: 1, type: "mett", state: "up", willAttack: true },
          { col: 4, row: 0, type: "guard", state: "up", willAttack: true },
        ],
      },
    ],
  },

  {
    name: "bolt-in-flight",
    title: "Incoming fire crossing the field",
    why: "The light and heavy bolt sprites and their motion-trail gradients, deliberately on rows the player is not standing on so nothing resolves.",
    seed: 13,
    width: W,
    height: H,
    frames: 36,
    capture: [
      { at: 8, as: "launched" },
      { at: 20, as: "midfield" },
      { at: 34, as: "closing" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 20, score: 30100, timeLeft: 18.6 },
        place: [
          { col: 5, row: 0, type: "mett", state: "up" },
          { col: 5, row: 2, type: "guard", state: "up" },
        ],
        bolt: [
          { col: 5, row: 0, heavy: false },
          { col: 5, row: 2, heavy: true },
        ],
      },
    ],
  },

  {
    name: "player-hit",
    title: "Taking a hit: flash, shake and i-frames",
    why: "The screen shake translate, the red full-screen flash, the HIT popup, the impact spark and the player's invulnerability flicker. Four distinct fx on different clocks.",
    seed: 17,
    width: W,
    height: H,
    frames: 46,
    // the bolt lands on frame 18: shake peaks there, the spark lives 140ms and
    // the flash 190ms, and the i-frame flicker outlasts both by half a second
    capture: [
      { at: 18, as: "impact" },
      { at: 23, as: "shake" },
      { at: 29, as: "flash-out" },
      { at: 44, as: "iframes" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 20, score: 30100, chain: 6, bestChain: 6, timeLeft: 18.6 },
        bolt: [{ col: 3, row: 1, heavy: false }],
      },
    ],
  },

  {
    name: "charged-shot",
    title: "Charged buster: muzzle flash, tracer, impact ring",
    why: "The three phases of the charged tier, which have separate timings from the normal tier, plus the enemy's squash-and-stretch hit animation and the score/time popups it spawns.",
    seed: 19,
    width: W,
    height: H,
    frames: 20,
    capture: [
      { at: 5, as: "muzzle" },
      { at: 7, as: "tracer" },
      { at: 10, as: "impact" },
      { at: 16, as: "aftermath" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 5, score: 4200, chain: 4, bestChain: 4, timeLeft: 24.1 },
        place: [{ col: 5, row: 1, type: "mett", state: "up" }],
      },
      { at: 4, charge: "full", actions: [{ type: "fireReleased" }] },
    ],
  },

  {
    name: "charge-telegraph",
    title: "Holding fire: the charge ring filling",
    why: "The charge arc only appears after 120ms of hold and sweeps clockwise. An empty field keeps the ring unobstructed. NB the `full` frame shows no ring at all: at 100% the sweep is exactly 2*PI, which @napi-rs/canvas renders as an empty path where a browser draws a closed circle. That is a genuine harness-vs-browser divergence, and pinning it means a change to it gets noticed.",
    seed: 23,
    width: W,
    height: H,
    frames: 52,
    capture: [
      { at: 12, as: "winding" },
      { at: 30, as: "half" },
      { at: 42, as: "brimming" },
      { at: 50, as: "full" },
    ],
    cues: [{ at: 2, actions: [{ type: "firePressed" }] }],
  },

  {
    name: "popups-sparks",
    title: "Guard block, deletion popups and sparks",
    why: "Sparks (140ms) and popups (650ms) live on very different clocks, so this catches both the burst and the long fade. Also the GUARD block path and the paired score / time-bonus popups.",
    seed: 29,
    width: W,
    height: H,
    frames: 34,
    capture: [
      { at: 3, as: "spark" },
      { at: 12, as: "popups" },
      { at: 22, as: "drifting" },
      { at: 32, as: "fading" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 9, score: 11800, chain: 4, bestChain: 4, timeLeft: 22.9 },
        place: [
          { col: 4, row: 1, type: "guard", state: "up" },
          { col: 3, row: 0, type: "mett", state: "up" },
        ],
      },
      { at: 2, actions: [{ type: "firePressed" }, { type: "fireReleased" }] },
      { at: 6, actions: [{ type: "move", dc: 0, dr: -1 }] },
      { at: 8, actions: [{ type: "firePressed" }, { type: "fireReleased" }] },
    ],
  },

  {
    name: "prog-hit",
    title: "Shooting a friendly prog",
    why: "The prog's white face plate, the red hit flash that replaces the usual white one, and the PROG HIT penalty popup with its minus sign.",
    seed: 31,
    width: W,
    height: H,
    frames: 20,
    capture: [
      { at: 3, as: "flash" },
      { at: 14, as: "penalty" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 22, score: 41500, chain: 7, bestChain: 7, timeLeft: 16.2 },
        place: [{ col: 3, row: 1, type: "ally", state: "up" }],
      },
      { at: 2, actions: [{ type: "firePressed" }, { type: "fireReleased" }] },
    ],
  },

  {
    name: "paused",
    title: "Pause overlay",
    why: "The dimming scrim and the two centred strings, drawn over a live board so a change to either layer shows up.",
    seed: 37,
    width: W,
    height: H,
    frames: 14,
    capture: [{ at: 12, as: "paused" }],
    cues: [
      {
        at: 0,
        set: { deletions: 33, score: 88600, chain: 11, bestChain: 14, timeLeft: 19.8 },
        place: [
          { col: 4, row: 0, type: "mett", state: "up" },
          { col: 5, row: 1, type: "hopper", state: "up" },
        ],
      },
      { at: 10, actions: [{ type: "pause" }] },
    ],
  },

  {
    name: "chain-hud",
    title: "High-chain HUD multiplier",
    why: "The multiplier line only draws from a chain of 2, and steps at 5 / 10 / 20. This captures the top tier and a middle tier, which is where the text width changes.",
    seed: 41,
    width: W,
    height: H,
    frames: 24,
    capture: [
      { at: 2, as: "x4" },
      { at: 22, as: "x2" },
    ],
    cues: [
      { at: 0, set: { deletions: 45, score: 128400, chain: 23, bestChain: 23, timeLeft: 27.5 } },
      { at: 20, set: { chain: 7 } },
    ],
  },

  {
    name: "overclock-hud",
    title: "Overclock HUD and the low-time bar",
    why: "Past 60 deletions the HUD gains the OVERCLOCK readout and the time bar turns orange; under 6 seconds it turns red instead. Both branches of the same colour expression.",
    seed: 43,
    width: W,
    height: H,
    frames: 24,
    capture: [
      { at: 2, as: "overclock" },
      { at: 22, as: "overclock-lowtime" },
    ],
    cues: [
      { at: 0, set: { deletions: 64, score: 250800, chain: 3, bestChain: 18, timeLeft: 12.4 } },
      { at: 20, set: { timeLeft: 4.2 } },
    ],
  },

  {
    name: "tall-canvas",
    title: "Tall 420x740 stage (portrait, panel-width limited)",
    why: "Layout regressions. At this aspect the panel height is capped by panel *width*, the grid is narrow, and the HUD strings crowd the top edge.",
    seed: 47,
    width: 420,
    height: 740,
    frames: 20,
    capture: [
      { at: 6, as: "board" },
      { at: 18, as: "combat" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 24, score: 51200, chain: 12, bestChain: 12, timeLeft: 14.7 },
        place: [
          { col: 4, row: 1, type: "mett", state: "up", willAttack: true },
          { col: 5, row: 2, type: "guard", state: "up" },
        ],
      },
      { at: 10, actions: [{ type: "firePressed" }, { type: "fireReleased" }] },
    ],
  },

  {
    name: "squat-canvas",
    title: "Squat 700x360 stage (height-limited layout)",
    why: "The other branch of the layout clamp: here the panel height is capped by the *stage height*, not the panel width, so the grid goes wide and flat and the board sits high.",
    seed: 53,
    width: 700,
    height: 360,
    frames: 24,
    capture: [
      { at: 8, as: "board" },
      { at: 22, as: "under-fire" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 64, score: 190400, chain: 6, bestChain: 21, timeLeft: 9.3 },
        place: [
          { col: 3, row: 0, type: "rare", state: "up" },
          { col: 5, row: 1, type: "mett", state: "up", willAttack: true },
          { col: 4, row: 2, type: "hopper", state: "up" },
        ],
        bolt: [{ col: 5, row: 0, heavy: true }],
      },
    ],
  },
];

/** @returns {object|undefined} */
export const findScenario = (name) => scenarios.find((s) => s.name === name);
