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
 *   tap:      [col,row]      a one-hand tap on the centre of that square (world
 *                            column), resolved to stage px through the layout
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
    name: "advance-world",
    title: "ADVANCE: a taken arena, the road, the next arena",
    why: "The mode is an unbounded strip: arena, road, arena. After a wipe the whole arena turns to the player's ground and a road runs off its right edge to the next fight. The camera is a translate over world pixels, so this pins the scroll itself: the taken arena sliding out of view, a full-height road, and the camera locked on the next arena with the player on its footing. The lit seam sits between the player's last tile and the enemy's first. Classic never moves the camera, which every other scenario pins.",
    seed: 61,
    width: W,
    height: H,
    frames: 12,
    modes: ["playing"],
    capture: [
      { at: 2, as: "taken-arena" },
      { at: 6, as: "on-the-road" },
      { at: 10, as: "next-arena" },
    ],
    cues: [
      // arena 0 wiped; seed 61's first road is full height
      { at: 0, set: { modeId: "advance", "player.col": 4, "player.row": 1 }, clearArenas: 1, cam: 1.5 },
      { at: 4, set: { "player.col": 7, "player.row": 1 }, cam: 5 },
      { at: 8, set: { "player.col": 10, "player.row": 1 }, cam: 9 },
    ],
  },

  {
    name: "advance-narrow-road",
    title: "ADVANCE: a single-row road",
    why: "Half the roads are one row tall: the void rows beside it are simply not drawn, and the player is funnelled to the middle row to cross. This pins the void, the dash, and the player standing in the funnel. Seed chosen so the first road is narrow.",
    seed: 7,
    width: W,
    height: H,
    frames: 4,
    modes: ["playing"],
    capture: [
      { at: 2, as: "funnel" },
    ],
    cues: [
      { at: 0, set: { modeId: "advance", "player.col": 7, "player.row": 1 }, clearArenas: 1, cam: 4.5 },
    ],
  },

  {
    name: "sentinel-marks",
    title: "The Sentinel: three marks, closed and open",
    why: "A turret with an iris, in none of the colours the other viruses wear: violet, magenta, red for marks I, II, III, with mark pips on the housing. Top row closed (a steel slab with a seam, the core dim); bottom row open (shutters parted, the core lit and pulsing). The later frame catches the open irises part-way through their spell, shutters closing in. Closed is armour, open is the only time it can be hurt -- the golden pins both states at every mark.",
    seed: 71,
    width: W,
    height: H,
    frames: 34,
    capture: [
      { at: 3, as: "irises" },
      { at: 30, as: "spell-running" },
    ],
    cues: [
      {
        at: 0,
        set: { modeId: "advance" },
        place: [
          { col: 3, row: 0, type: "sentinel", tier: 1, hp: 1, willAttack: true, fired: true, aimMs: 1400 },
          { col: 4, row: 0, type: "sentinel", tier: 2, hp: 2, willAttack: true, fired: true, aimMs: 1050 },
          { col: 5, row: 0, type: "sentinel", tier: 3, hp: 3, willAttack: true, fired: true, aimMs: 780 },
          { col: 3, row: 2, type: "sentinel", tier: 1, hp: 1, willAttack: true, fired: false, aimMs: 1400 },
          { col: 4, row: 2, type: "sentinel", tier: 2, hp: 2, willAttack: true, fired: false, aimMs: 1050 },
          { col: 5, row: 2, type: "sentinel", tier: 3, hp: 3, willAttack: true, fired: false, aimMs: 780 },
        ],
      },
    ],
  },

  {
    name: "bomb-splash",
    title: "The bomb: pickup, arc, splash",
    why: "Secondary fire. A bomb waits on a tile as a dark sphere with a lit fuse; thrown, it arcs three columns along your row with a ground shadow that shrinks as it climbs; on landing every square of the 3x3 lights and a fireball rings out, and everything standing in it takes a charged-tier delete -- here three metts and a steel guard. Pins the pickup, the mid-arc frame, the splash on the landing frame, and the aftermath with the popups still up.",
    seed: 72,
    width: W,
    height: H,
    frames: 56,
    capture: [
      { at: 2, as: "pickup-and-launch" },
      { at: 20, as: "mid-arc" },
      { at: 41, as: "splash" },
      { at: 52, as: "aftermath" },
    ],
    cues: [
      {
        at: 0,
        set: { modeId: "advance", bombs: 1, "player.col": 1, "player.row": 1,
               pickups: [{ col: 2, row: 0, kind: "bomb" }] },
        place: [
          { col: 3, row: 0 },
          { col: 4, row: 1 },
          { col: 5, row: 2 },
          { col: 4, row: 2, type: "guard" },
        ],
      },
      { at: 1, actions: [{ type: "bomb" }] },
    ],
  },

  {
    name: "onehand-deck",
    title: "ONE HAND: the board above the deck, a tap, the held step",
    why: "The default mode on a phone: the shell gives the bottom of the stage to the FIRE deck and hands its height to the layout as an inset, so this pins the board resting on the deck's top edge on a portrait stage, with room above for the HUD and the BOMB bar the shell places there. A tap steps to a square in one move and ripples it; a second tap inside the half-charge ration is held, drawn as a dashed outline on the wanted square while the ration bar refills at the player's feet, and lands on its own when the ration ends. The deck itself is DOM and is not in the frame.",
    seed: 9,
    width: 390,
    height: 760,
    frames: 30,
    modes: ["playing"],
    capture: [
      { at: 1, as: "tapped" },
      { at: 4, as: "held-step" },
      { at: 26, as: "landed" },
    ],
    cues: [
      { at: 0, set: { modeId: "onehand" }, inset: 258,
        place: [{ col: 4, row: 0 }, { col: 5, row: 2 }] },
      // the tap lands on (2,0): stage coordinates through the layout the inset made
      { at: 0, tap: [2, 0] },
      // a second tap two frames later is inside the ration: held, then taken
      { at: 3, tap: [0, 2] },
    ],
  },

  {
    name: "story-tower",
    title: "STORY: the tower, the keeper, the TALK prompt",
    why: "The story strip opens on a tower: the player's own ground in the tower skin, a keeper on a tile you stand beside rather than on, and the guard arena waiting past the tower's edge with its wave asleep. Standing beside the keeper lights the TALK prompt over them; a press ripples their tile (the line itself is DOM, from the sealed canon, and never in a frame).",
    seed: 4,
    width: 390,
    height: 760,
    frames: 8,
    modes: ["playing"],
    capture: [
      { at: 1, as: "arrival" },
      { at: 5, as: "beside" },
    ],
    cues: [
      { at: 0, actions: [{ type: "startRun", modeId: "story" }], inset: 243 },
      { at: 3, set: { "player.col": 2, "player.row": 1 } },
      { at: 4, actions: [{ type: "bomb" }] },
    ],
  },

  {
    name: "art-bodies",
    title: "Art: every virus body at rest, and the buster",
    why: "Pack zero is the procedural art baked to cells. This frame holds every virus body at rest -- mett, guard, runner, hopper, rare, and the three sentinel marks open and closed -- with the buster idle, so the art identity check can render it through the pack and through the painters and demand the same bytes. Nothing here is mid-rise, mid-hit or mid-hop: those scale the cell, and a scaled raster is not the painter.",
    seed: 3,
    width: W,
    height: H,
    frames: 3,
    modes: ["playing"],
    artIdentity: true,
    capture: [{ at: 1, as: "rest" }],
    cues: [
      {
        at: 0,
        place: [
          { col: 3, row: 0, type: "mett" },
          { col: 4, row: 0, type: "guard" },
          { col: 5, row: 0, type: "ally" },
          { col: 3, row: 1, type: "hopper" },
          { col: 4, row: 1, type: "rare" },
          { col: 5, row: 1, type: "sentinel", tier: 1, fired: false, aimMs: 1400 },
          { col: 3, row: 2, type: "sentinel", tier: 2, fired: true, aimMs: 1050 },
          { col: 4, row: 2, type: "sentinel", tier: 3, fired: false, aimMs: 780 },
        ],
      },
    ],
  },

  {
    name: "art-people",
    title: "Art: everyone who stands on a tower, and the journal",
    why: "The other half of pack zero: the keepers and their companions in their own colours, the journal, and a bomb on the ground, all at rest on the first tower. Rendered through the pack and through the painters by the identity check.",
    seed: 3,
    width: W,
    height: H,
    frames: 3,
    modes: ["playing"],
    artIdentity: true,
    capture: [{ at: 1, as: "rest" }],
    cues: [
      {
        at: 0,
        actions: [{ type: "startRun", modeId: "story" }],
      },
      {
        at: 1,
        set: {
          "player.col": 0, "player.row": 1,
          "world.segs.0.npcs": [
            { id: "npc.keeper.01", col: 1, row: 0, verb: "talk" }, { id: "npc.keeper.02", col: 2, row: 0, verb: "talk" },
            { id: "npc.keeper.03", col: 3, row: 0, verb: "talk" }, { id: "npc.keeper.04", col: 4, row: 0, verb: "talk" },
            { id: "npc.keeper.05", col: 5, row: 0, verb: "talk" }, { id: "npc.side.tally", col: 1, row: 1, verb: "talk" },
            { id: "npc.side.bean", col: 2, row: 1, verb: "talk" }, { id: "npc.side.vesper", col: 3, row: 1, verb: "talk" },
            { id: "npc.side.rivet", col: 4, row: 1, verb: "talk" }, { id: "boss.ferryman", col: 5, row: 1, verb: "talk" },
            { id: "npc.sweeper.tidy", col: 1, row: 2, verb: "talk" }, { id: "boss.foreman", col: 2, row: 2, verb: "talk" },
            { id: "item.journal.steward", col: 3, row: 2, verb: "read" }, { id: "npc.nobody", col: 4, row: 2, verb: "talk" },
          ],
          pickups: [{ col: 5, row: 2, kind: "bomb" }],
        },
      },
    ],
  },

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
    frames: 60,
    // the bolt lands on frame 30 (the slow shell crosses the board at its own
    // pace now): shake peaks there, the spark lives 140ms and the flash 190ms,
    // and the i-frame flicker outlasts both by half a second
    capture: [
      { at: 30, as: "impact" },
      { at: 35, as: "shake" },
      { at: 41, as: "flash-out" },
      { at: 56, as: "iframes" },
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
    why: "The charge arc appears after 120ms of hold and sweeps clockwise, thickening and dragging converging motes in as it fills; at full it gains an outer pulse ring and four crackle spikes. The sweep tops out at 2*PI - RING_GAP rather than a closed circle, so a full ring is never an exact-2*PI arc — a shape some canvas backends drop entirely. An empty field keeps it unobstructed.",
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
    why: "Past OC_START deletions the HUD gains the OVERCLOCK readout and the time bar turns orange; under 6 seconds it turns red instead. Both branches of the same colour expression.",
    seed: 43,
    width: W,
    height: H,
    frames: 24,
    capture: [
      { at: 2, as: "overclock" },
      { at: 22, as: "overclock-lowtime" },
    ],
    cues: [
      { at: 0, set: { deletions: 190, score: 250800, chain: 3, bestChain: 18, timeLeft: 12.4 } },
      { at: 20, set: { timeLeft: 4.2 } },
    ],
  },

  {
    name: "hit-stop",
    title: "Hit-stop: the frame freezes on a rare deletion",
    why: "A rare is the loudest thing in the game, so it buys the longest freeze (HITSTOP.rare). The delete animation is dated to the *impact*, not the trigger pull, so `inbound` still shows an intact virus with the tracer crossing toward it. `freeze-in` and `freeze-hold` are captured four frames apart and differ only in the HUD time bar: the simulation clock is frozen but the run clock deliberately is not, so juice can never hand a kill-spammer a slower countdown.",
    seed: 61,
    width: W,
    height: H,
    frames: 24,
    capture: [
      { at: 6, as: "inbound" },
      { at: 8, as: "freeze-in" },
      { at: 12, as: "freeze-hold" },
      { at: 20, as: "resumed" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 52, score: 174300, chain: 6, bestChain: 12, timeLeft: 19.5 },
        place: [{ col: 5, row: 1, type: "rare", state: "up" }],
      },
      { at: 2, charge: "full", actions: [{ type: "fireReleased" }] },
    ],
  },

  {
    name: "deletion-debris",
    title: "Deletion debris, tinted per skin",
    why: "A charged delete throws BIT_COUNT.charged bits in the victim's own colours, under gravity, plus an impact ripple in the struck panel and an answering one under the player. Catches the spawn burst, the arc and the fade — and the cap, since every bit is authored from the seeded rng in the core.",
    seed: 67,
    width: W,
    height: H,
    frames: 40,
    capture: [
      { at: 8, as: "burst" },
      { at: 16, as: "arc" },
      { at: 30, as: "settling" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 34, score: 96400, chain: 3, bestChain: 11, timeLeft: 23.2 },
        place: [{ col: 4, row: 1, type: "guard", state: "up" }],
      },
      { at: 2, charge: "full", actions: [{ type: "fireReleased" }] },
    ],
  },

  {
    name: "chain-flourish",
    title: "Multiplier flourish at x2 and x4",
    why: "Every multiplier step gets a hexagonal shockwave, spokes and the new multiplier punching out of the panel, colour-coded cyan / gold / orange by tier — plus a swell on the HUD chain line. Two kills in one run so both the low and the top tier are pinned; the second is the one that has to read as an event.",
    seed: 71,
    width: W,
    height: H,
    frames: 40,
    capture: [
      { at: 6, as: "x2-burst" },
      { at: 12, as: "x2-spread" },
      { at: 28, as: "x4-burst" },
      { at: 34, as: "x4-spread" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 40, score: 118200, chain: 4, bestChain: 9, timeLeft: 22.8 },
        place: [{ col: 3, row: 1, type: "mett", state: "up" }],
      },
      { at: 2, actions: [{ type: "firePressed" }, { type: "fireReleased" }] },
      {
        at: 22,
        set: { chain: 19 },
        place: [{ col: 3, row: 1, type: "mett", state: "up" }],
      },
      { at: 24, actions: [{ type: "firePressed" }, { type: "fireReleased" }] },
    ],
  },

  {
    name: "chain-loss",
    title: "Losing a chain",
    why: "The counterweight to the flourish: a whiff at nine dumps the count out of the board in warn red and drops the links out from under it. Dated to the tracer reaching the far wall, so the loss lands when the miss is visible rather than on the trigger pull.",
    seed: 73,
    width: W,
    height: H,
    frames: 44,
    capture: [
      { at: 10, as: "snap" },
      { at: 22, as: "falling" },
      { at: 38, as: "gone" },
    ],
    cues: [
      { at: 0, set: { deletions: 26, score: 71500, chain: 9, bestChain: 14, timeLeft: 17.3 } },
      { at: 2, actions: [{ type: "firePressed" }, { type: "fireReleased" }] },
    ],
  },

  {
    name: "overclock-field",
    title: "Overclock: the whole field runs hot",
    why: "Past OC_START the panels themselves shift to the overclock palette and a slow orange tide crosses the grid. The two captures are far enough apart that the tide has visibly moved, which is the only way a regression in its phase would show up.",
    seed: 79,
    width: W,
    height: H,
    frames: 46,
    capture: [
      { at: 4, as: "hot" },
      { at: 44, as: "tide" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 190, score: 402100, chain: 7, bestChain: 24, timeLeft: 16.8 },
        place: [
          { col: 3, row: 0, type: "mett", state: "up" },
          { col: 5, row: 1, type: "guard", state: "up" },
          { col: 4, row: 2, type: "hopper", state: "up" },
        ],
      },
    ],
  },

  {
    name: "reduced-motion",
    title: "reducedMotion: the damped path",
    why: "The accessibility contract. Same beat as `player-hit` — a bolt lands on the player — but with `state.reducedMotion` set: screen shake is damped to RM.shake, the full-screen hurt flash to RM.flash, the i-frame strobe becomes a steady dim, and the low-time frame holds instead of pulsing. Diff this against `player-hit` and `overclock-hud` to see exactly what the flag buys.",
    seed: 83,
    width: W,
    height: H,
    frames: 60,
    capture: [
      { at: 30, as: "impact" },
      { at: 35, as: "damped-shake" },
      { at: 56, as: "steady-iframes" },
    ],
    cues: [
      {
        at: 0,
        set: {
          reducedMotion: true,
          deletions: 20, score: 30100, chain: 6, bestChain: 6, timeLeft: 5.2,
        },
        bolt: [{ col: 3, row: 1, heavy: false }],
      },
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
        set: { deletions: 190, score: 190400, chain: 6, bestChain: 21, timeLeft: 9.3 },
        place: [
          { col: 3, row: 0, type: "rare", state: "up" },
          { col: 5, row: 1, type: "mett", state: "up", willAttack: true },
          { col: 4, row: 2, type: "hopper", state: "up" },
        ],
        bolt: [{ col: 5, row: 0, heavy: true }],
      },
    ],
  },

  // ---------- HUD: level marker, pips, and the punch on both ends ----------

  {
    name: "level-up",
    title: "The level ticking over",
    why: "LV 3 in grey 13px was a corner label; the level is now a chapter marker that announces itself. The kill on frame 4 takes the count from 9 to 10, so `level()` steps: the numeral opens huge in the band between the time bar and the board, with a rule tearing across it, and then hands off to the corner marker with a cross-fade rather than flying through the pips. Captured on the way in, holding, mid-handoff and settled — the middle frames are the only ones that would catch a regression in the easing.",
    seed: 101,
    width: W,
    height: H,
    frames: 46,
    capture: [
      { at: 6, as: "announce" },
      { at: 14, as: "holding" },
      { at: 26, as: "handoff" },
      { at: 44, as: "settled" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 9, score: 14200, chain: 4, bestChain: 6, timeLeft: 26.4 },
        place: [{ col: 4, row: 1, type: "mett", state: "up" }],
      },
      { at: 2, actions: [{ type: "firePressed" }, { type: "fireReleased" }] },
    ],
  },

  {
    name: "deletion-explosion",
    title: "Detonations, sized by tier",
    why: "A deletion is an explosion now, not debris plus a one-frame silhouette: a white core blowing out, one to three shockwave rings, a star of shards on fixed bearings and a soot ring left hanging. Everything is dated to the tracer landing — the same clock the squash, the kick and the hit-stop run on — so the freeze holds the fireball at its peak instead of fighting it. A tapped mett first (the smallest tier), then a charged rare (the largest), so the two ends of the scale are pinned in one sheet along with the full-screen wash the big one throws.",
    seed: 103,
    width: W,
    height: H,
    frames: 40,
    capture: [
      { at: 6, as: "mett-ignite" },
      { at: 9, as: "mett-bloom" },
      { at: 30, as: "rare-ignite" },
      { at: 34, as: "rare-bloom" },
      { at: 38, as: "rare-fading" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 51, score: 168400, chain: 6, bestChain: 12, timeLeft: 21.8 },
        place: [{ col: 4, row: 1, type: "mett", state: "up" }],
      },
      { at: 2, actions: [{ type: "firePressed" }, { type: "fireReleased" }] },
      { at: 18, place: [{ col: 5, row: 1, type: "rare", state: "up" }] },
      { at: 20, charge: "full", actions: [{ type: "fireReleased" }] },
    ],
  },

  {
    name: "damage-punch",
    title: "Taking a hit, and coming back from it",
    why: "The other end of the same escalation. A bolt lands on the player: a two-ring blowout with four impact spikes on its panel, a front-loaded red wash, three slabs of signal tear shoved sideways, a vignette slammed against the bezel — and then the recovery, which is the part that used to say nothing. The i-frame arc unwinds around the player and turns cyan for its last quarter, and the two pips the hit cost lift off the time bar where they used to be. Captured through the tear, the burst, the vignette receding and the last of the i-frames.",
    seed: 107,
    width: W,
    height: H,
    frames: 54,
    capture: [
      { at: 18, as: "tear" },
      { at: 21, as: "burst" },
      { at: 26, as: "pips-lost" },
      { at: 34, as: "receding" },
      { at: 50, as: "iframes-out" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 24, score: 44600, chain: 8, bestChain: 11, timeLeft: 22.5 },
        bolt: [{ col: 3, row: 1, heavy: true }],
      },
    ],
  },

  {
    name: "pip-bar",
    title: "The time bar, as pips, from full to nearly out",
    why: "The clock is the only resource, so it is spent in countable cells: 36 pips of 1.25s in six subsections of six, which makes a 2.5s hit exactly two pips and a mett kill about one. This walks the same bar from nearly full through half to the last few seconds, where the fill turns red and beats. The subsection feet are what let the eye count in sixes instead of measuring a length.",
    seed: 109,
    width: W,
    height: H,
    frames: 40,
    capture: [
      { at: 4, as: "brimming" },
      { at: 16, as: "half" },
      { at: 28, as: "thin" },
      { at: 38, as: "critical" },
    ],
    cues: [
      { at: 0, set: { deletions: 17, score: 26900, chain: 3, bestChain: 7, timeLeft: 43.6 } },
      { at: 14, set: { timeLeft: 22.5 } },
      { at: 26, set: { timeLeft: 9.4 } },
      { at: 36, set: { timeLeft: 2.6 } },
    ],
  },

  {
    name: "pip-narrow",
    title: "Pips on a 300x560 stage: the coarse rung of the ladder",
    why: "Pips have to stay pips. Below PIP_MIN_W the layout steps to a coarser rung rather than shaving 36 cells into slivers, so this stage draws 18 pips of 2.5s (three subsections) instead — a hit still costs a countable amount, one pip instead of two. Also the narrowest layout the HUD has to survive: the level block, the multiplier and the bar all inside 300px.",
    seed: 113,
    width: 300,
    height: 560,
    frames: 26,
    capture: [
      { at: 6, as: "coarse" },
      { at: 24, as: "hit" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 26, score: 58300, chain: 11, bestChain: 13, timeLeft: 17.9 },
        place: [{ col: 4, row: 0, type: "mett", state: "up" }],
      },
      { at: 14, bolt: [{ col: 5, row: 1, heavy: false }] },
    ],
  },

  {
    name: "pip-overclock",
    title: "Pips under overclock, on a squat stage",
    why: "Overclock lost its \"OVERCLOCK x0.94\" readout, so the decay has to be visible instead: past the fill head sits a dashed outline exactly as wide as the clock the next mett kill will actually pay back — a pip's worth at the start of overclock, a sliver deep into it. Squat 700x360 because that is where the HUD has the least room above the board, and the low-time capture puts the red fill, the beat and the refund ghost on screen together.",
    seed: 127,
    width: 700,
    height: 360,
    frames: 30,
    capture: [
      { at: 4, as: "hot" },
      { at: 28, as: "hot-low" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 96, score: 431200, chain: 12, bestChain: 22, timeLeft: 14.2 },
        place: [{ col: 5, row: 1, type: "guard", state: "up" }],
      },
      { at: 26, set: { timeLeft: 3.4 } },
    ],
  },

  {
    name: "bolt-kinds",
    title: "Two kinds of incoming fire",
    why: "Virus bolts come in two flavours and must never be confused at a glance: a fast needle you have to already be moving away from, and a slow heavy orb you can still walk around. Speed is drawn rather than implied — the streak behind a bolt is where it was BOLT_TRAIL_MS ago, so the fast one smears and the slow one barely does. This pins both, using the per-bolt `kind` / `radius` / `speed` fields as well as a bolt that carries none of them (the middle lane), which must still render from the defaults.",
    seed: 131,
    width: W,
    height: H,
    frames: 22,
    capture: [
      { at: 6, as: "launched" },
      { at: 18, as: "closing" },
    ],
    cues: [
      {
        at: 0,
        set: { deletions: 34, score: 91500, chain: 5, bestChain: 9, timeLeft: 19.1 },
        bolt: [
          { col: 5, row: 0, kind: "fast", radius: 9, speed: 1.35 },
          { col: 5, row: 1 },
          { col: 5, row: 2, kind: "heavy", radius: 15, speed: 0.42 },
        ],
      },
    ],
  },
];

/** @returns {object|undefined} */
export const findScenario = (name) => scenarios.find((s) => s.name === name);
