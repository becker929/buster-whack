/*!
 * Tuning: every number the game is balanced on, as data.
 *
 * `TUNING_SCHEMA` names each value with its default, its bounds, its unit
 * and what it does. `resolveTuning(overrides)` turns a bag of overrides into
 * the object the simulation reads from `state.tuning`: the scalars, the
 * small tables assembled from them (bolt kinds, sentinel marks, unlock
 * arenas), and the ramp functions bound to them. With no overrides the
 * result is exactly the numbers the game shipped with, so every golden and
 * every determinism test holds.
 *
 * Structural constants (board size, tile kinds, layout math) and presentation
 * data (colours, fx lifetimes, shake) stay in `constants.js`: they are not
 * balance. Content (the route, who stands on which tower) is not tuning
 * either; it will be a document of its own.
 *
 * Pure module. No DOM, no clock, no randomness.
 */

// ---------- the schema ----------
// [group, [[key, default, min, max, step, unit, description], ...]]
/** @typedef {[string, number, number, number, number, string, string]} TuningRow */
/** @type {Array<[string, TuningRow[]]>} */
export const TUNING_SCHEMA = [
  ["clock", [
    ["START_TIME", 30, 5, 120, 1, "s", "Pulse at the start of a run."],
    ["TIME_CAP", 45, 10, 180, 1, "s", "The most pulse you can hold."],
    ["LOW_TIME", 6, 1, 20, 0.5, "s", "Below this the clock is low: alarm, red pips, shorter lulls, more rares."],
    ["HIT_TIME_PENALTY", 2.5, 0, 10, 0.1, "s", "Pulse lost to one hit."],
    ["DRAIN_BASE", 1.0, 0.2, 3, 0.05, "x", "Pulse spent per second in a contested arena, at the start of the road."],
    ["DRAIN_PER_ARENA", 0.02, 0, 0.2, 0.001, "x", "The road breathes harder: drain rises by this per arena."],
    ["DRAIN_MAX", 1.45, 0.5, 4, 0.05, "x", "Drain stops rising here, and the viruses carry the rest."],
    ["HIT_IFRAME_MS", 800, 0, 3000, 50, "ms", "Invulnerable after a hit for this long."],
    ["STAGE_BONUS", 2.0, 0, 10, 0.1, "s", "Pulse for passing a stage card (retired modes)."],
  ]],
  ["scoring", [
    ["PTS_NORMAL", 100, 0, 5000, 10, "pts", "A plain deletion."],
    ["PTS_CHARGED", 300, 0, 5000, 10, "pts", "A charged deletion."],
    ["PTS_GUARD", 400, 0, 5000, 10, "pts", "A steel guard."],
    ["PTS_HOPPER", 250, 0, 5000, 10, "pts", "A hopper."],
    ["PTS_SENTINEL", 500, 0, 5000, 10, "pts", "A sentinel."],
    ["PTS_RARE", 1000, 0, 10000, 50, "pts", "A rare virus (retired modes)."],
    ["PTS_SPREADER", 350, 0, 5000, 10, "pts", "A spreader: the rot that fires across three lanes."],
    ["PTS_WARDEN", 450, 0, 5000, 10, "pts", "A warden: the rot that walls a lane."],
    ["PTS_DARTER", 300, 0, 5000, 10, "pts", "A darter: the static that shoots twice."],
    ["BONUS_NORMAL", 1.2, 0, 10, 0.1, "s", "Pulse for a plain deletion, before overclock decay."],
    ["BONUS_CHARGED", 2.5, 0, 10, 0.1, "s", "Pulse for a charged deletion."],
    ["BONUS_GUARD", 3.0, 0, 10, 0.1, "s", "Pulse for a steel guard."],
    ["BONUS_HOPPER", 1.8, 0, 10, 0.1, "s", "Pulse for a hopper."],
    ["BONUS_SENTINEL", 3.0, 0, 10, 0.1, "s", "Pulse for a sentinel."],
    ["BONUS_RARE", 8.0, 0, 30, 0.5, "s", "Pulse for a rare."],
    ["BONUS_SPREADER", 2.2, 0, 10, 0.1, "s", "Pulse for a spreader."],
    ["BONUS_WARDEN", 2.6, 0, 10, 0.1, "s", "Pulse for a warden."],
    ["BONUS_DARTER", 2.0, 0, 10, 0.1, "s", "Pulse for a darter."],
    ["ALLY_TIME_PENALTY", 3.0, 0, 10, 0.1, "s", "Pulse lost for shooting a runner."],
    ["ALLY_PTS_PENALTY", 200, 0, 5000, 10, "pts", "Points lost for shooting a runner."],
    ["ALLY_SPARE_BONUS", 0.5, 0, 5, 0.1, "s", "Pulse for letting a runner pass."],
    ["ARENA_CLEAR_BONUS", 3.0, 0, 15, 0.1, "s", "Pulse for taking an arena."],
    ["ARENA_CLEAR_PTS", 1500, 0, 10000, 50, "pts", "Points for taking an arena."],
    ["WAVE_CLEAR_PTS", 60, 0, 1000, 5, "pts", "Points per virus for a perfect wave, times the multiplier."],
    ["WAVE_CLEAR_BONUS_BASE", 0.55, 0, 5, 0.05, "s", "Pulse for a perfect wave, plus per-virus below."],
    ["WAVE_CLEAR_BONUS_PER", 0.3, 0, 2, 0.05, "s", "Extra pulse per virus in a perfect wave."],
    ["OC_START", 170, 20, 1000, 5, "kills", "Deletions after which pulse rewards decay (overclock)."],
    ["OC_SLOPE", 0.988, 0.9, 1, 0.001, "x", "Per-deletion decay factor past overclock."],
    ["ROAD_PULSE", 0.4, 0.1, 2, 0.05, "x", "Pulse rewards on the road, where nothing escapes and every kill pays."],
    ["LEVEL_PER_KILLS", 6, 1, 50, 1, "kills", "Kills per level in the retired kill-counted modes."],
  ]],
  ["timings", [
    ["CHARGE_MS", 700, 200, 2000, 10, "ms", "Hold FIRE this long for a charged shot."],
    ["RISE_MS", 220, 50, 1000, 10, "ms", "A virus surfacing."],
    ["SINK_MS", 180, 50, 1000, 10, "ms", "A virus sinking away."],
    ["HIT_MS", 280, 50, 1000, 10, "ms", "A virus's hit reaction."],
    ["MOVE_REPEAT_MS", 130, 30, 500, 10, "ms", "Ring repeat in the retired step-on-the-spot modes."],
    ["TAP_MOVE_MS", 195, 60, 1000, 5, "ms", "The step ration: one hop per this."],
    ["HOP_WINDUP_MS", 30, 0, 300, 5, "ms", "The crouch before a hop."],
    ["HOP_MOVE_MS", 80, 20, 500, 5, "ms", "The hop's arc."],
    ["HOP_SETTLE_MS", 55, 0, 300, 5, "ms", "The landing squash."],
    ["HOP_MS", 550, 100, 2000, 10, "ms", "A hopper's own hop between panels."],
    ["HOP_GROW_MS", 120, 20, 500, 10, "ms", "A hopper regrowing after a hop."],
    ["HOPPER_LIFE", 2200, 500, 10000, 50, "ms", "How long a hopper stays up (arcade)."],
    ["DARTER_HOP_MS", 340, 100, 2000, 10, "ms", "A darter moves half again as often as a hopper."],
    ["RARE_LIFE", 650, 100, 5000, 50, "ms", "How long a rare stays up."],
    ["ALLY_RISE_MS", 460, 100, 2000, 10, "ms", "A runner surfaces slowly and cannot be hit until up."],
    ["MET_HOP_MS", 1500, 300, 5000, 50, "ms", "A persistent mett shuffles a panel this often."],
    ["REFIRE_MS", 1400, 300, 5000, 50, "ms", "A persistent attacker re-aims this long after firing."],
    ["ARENA_ENTRY_DELAY_MS", 650, 0, 3000, 50, "ms", "The beat between stepping into an arena and its wave waking."],
    ["ARENA_WAVE_GAP_MS", 550, 0, 3000, 50, "ms", "The beat between a wave dying and the next dealing."],
    ["CAM_TAU_MS", 170, 30, 1000, 10, "ms", "Camera ease: 63% of the way per this."],
    ["ATTACK_FOLLOW_MS", 300, 0, 2000, 10, "ms", "An attacker outlives its own aim by this."],
    ["WAVE_GRACE_MS", 900, 0, 5000, 50, "ms", "A wave gives up once every member has had its chance plus this."],
    ["LOW_TIME_LULL_MS", 420, 0, 3000, 10, "ms", "A lull never outstays a nearly dead clock by more than this."],
  ]],
  ["world", [
    ["NARROW_ROAD_CHANCE", 0.5, 0, 1, 0.05, "p", "Chance a road is one row instead of three."],
    ["TOWER_EVERY", 10, 1, 50, 1, "arenas", "A tower stands before every N-th arena in the story."],
    ["POOL_BASE", 4, 1, 30, 1, "viruses", "Viruses guarding arena 0."],
    ["POOL_PER_ARENA", 0.16, 0, 2, 0.01, "viruses", "Extra viruses per arena index."],
    ["POOL_MAX", 20, 1, 60, 1, "viruses", "The most viruses one arena guards."],
    ["WAVE_SIZE_BASE", 2, 1, 6, 1, "viruses", "Viruses dealt together in arena 0."],
    ["WAVE_SIZE_PER_ARENAS", 25, 1, 200, 1, "arenas", "One more per wave every this many arenas."],
    ["WAVE_SIZE_MAX", 5, 1, 8, 1, "viruses", "The most dealt together."],
    ["MAX_ALIVE", 6, 1, 12, 1, "viruses", "Hard ceiling on the board: wave plus runner plus rare."],
  ]],
  ["story unlocks", [
    ["UNLOCK_GUARD", 10, 0, 500, 1, "arena", "Steel guards from this arena on."],
    ["UNLOCK_ALLY", 20, 0, 500, 1, "arena", "Runners from this arena on."],
    ["UNLOCK_RETALIATE", 30, 0, 500, 1, "arena", "Viruses fire back from this arena on."],
    ["UNLOCK_HOPPER", 40, 0, 500, 1, "arena", "Hoppers from this arena on."],
    ["UNLOCK_SENTINEL1", 50, 0, 500, 1, "arena", "Sentinels (mark I) from this arena on."],
    ["UNLOCK_SWARM", 60, 0, 500, 1, "arena", "Tighter lulls from this arena on."],
    ["UNLOCK_SPREADER", 60, 0, 500, 1, "arena", "Spreaders from this arena on."],
    ["UNLOCK_DARTER", 80, 0, 500, 1, "arena", "Darters from this arena on."],
    ["UNLOCK_SENTINEL2", 70, 0, 500, 1, "arena", "Sentinel mark II from this arena on."],
    ["UNLOCK_WARDEN", 90, 0, 500, 1, "arena", "Wardens from this arena on."],
    ["UNLOCK_SENTINEL3", 90, 0, 500, 1, "arena", "Sentinel mark III from this arena on."],
    ["ROAD_END", 100, 10, 1000, 1, "arena", "Past this the run is unlimited: nothing new is held back."],
  ]],
  ["arcade unlocks (retired ADVANCE)", [
    ["ADV_GUARD", 5, 0, 500, 1, "arena", ""], ["ADV_RETALIATE", 9, 0, 500, 1, "arena", ""],
    ["ADV_HOPPER", 15, 0, 500, 1, "arena", ""], ["ADV_SENTINEL1", 20, 0, 500, 1, "arena", ""],
    ["ADV_ALLY", 30, 0, 500, 1, "arena", ""], ["ADV_SENTINEL2", 40, 0, 500, 1, "arena", ""],
    ["ADV_SWARM", 55, 0, 500, 1, "arena", ""], ["ADV_SENTINEL3", 70, 0, 500, 1, "arena", ""],
    ["ADV_SPREADER", 35, 0, 500, 1, "arena", ""], ["ADV_DARTER", 45, 0, 500, 1, "arena", ""],
    ["ADV_WARDEN", 60, 0, 500, 1, "arena", ""],
  ]],
  ["waves", [
    ["WAVE_STAGGER_BASE", 420, 50, 2000, 10, "ms", "Gap between arrivals inside a wave, at wave 0."],
    ["WAVE_STAGGER_PER_WAVE", 4, 0, 50, 1, "ms", "The gap shrinks by this per wave."],
    ["WAVE_STAGGER_MIN", 170, 20, 1000, 10, "ms", "The gap never drops below this."],
    ["WAVE_LULL_BASE", 1900, 200, 6000, 50, "ms", "The pause between waves, at wave 0."],
    ["WAVE_LULL_PER_WAVE", 10, 0, 100, 1, "ms", "The pause shrinks by this per wave."],
    ["WAVE_LULL_MIN", 620, 100, 3000, 10, "ms", "The pause never drops below this."],
    ["WAVE_LULL_SWARM_FACTOR", 0.7, 0.2, 1, 0.05, "x", "The pause is multiplied by this once SWARM is unlocked."],
    ["WAVE_CLEAR_LULL", 0.62, 0.1, 1, 0.02, "x", "A perfect clear multiplies the next lull by this."],
    ["UP_MS_BASE", 1250, 300, 5000, 10, "ms", "How long a virus stays up at zero kills (arcade)."],
    ["UP_MS_PER_KILL", 18, 0, 100, 1, "ms", "Stays up this much less per kill."],
    ["UP_MS_MIN", 520, 100, 3000, 10, "ms", "Never less than this."],
    ["GUARD_CHANCE_BASE", 0.4, 0, 1, 0.05, "p", "Chance the anchor slot is a steel guard, once unlocked."],
    ["GUARD_CHANCE_PER", 0.08, 0, 0.5, 0.01, "p", "Plus this per unlock step."],
    ["GUARD_CHANCE_MAX", 0.8, 0, 1, 0.05, "p", ""],
    ["HOPPER_CHANCE_BASE", 0.35, 0, 1, 0.05, "p", "Chance one slot is a hopper, once unlocked."],
    ["HOPPER_CHANCE_PER", 0.08, 0, 0.5, 0.01, "p", ""],
    ["HOPPER_CHANCE_MAX", 0.65, 0, 1, 0.05, "p", ""],
    ["ALLY_CHANCE_BASE", 0.25, 0, 1, 0.05, "p", "Chance a runner tags along, once unlocked."],
    ["ALLY_CHANCE_PER", 0.05, 0, 0.5, 0.01, "p", ""],
    ["ALLY_CHANCE_MAX", 0.45, 0, 1, 0.05, "p", ""],
    ["RARE_CHANCE_BASE", 0.05, 0, 1, 0.01, "p", "Chance a rare leads a wave (retired modes)."],
    ["RARE_CHANCE_PER", 0.01, 0, 0.2, 0.005, "p", ""],
    ["RARE_LOW_TIME_FACTOR", 2.5, 1, 10, 0.5, "x", "Rares are this much likelier when the clock is low."],
    ["SENTINEL_CHANCE_BASE", 0.35, 0, 1, 0.05, "p", "Chance a wave carries a sentinel, once unlocked."],
    ["SENTINEL_CHANCE_PER", 0.006, 0, 0.1, 0.001, "p", "Plus this per arena past the unlock."],
    ["SENTINEL_CHANCE_MAX", 0.7, 0, 1, 0.05, "p", ""],
    ["SPREADER_CHANCE_BASE", 0.3, 0, 1, 0.05, "p", "Chance one slot is a spreader, once unlocked."],
    ["SPREADER_CHANCE_PER", 0.006, 0, 0.1, 0.001, "p", "Plus this per arena past the unlock."],
    ["SPREADER_CHANCE_MAX", 0.55, 0, 1, 0.05, "p", ""],
    ["DARTER_CHANCE_BASE", 0.25, 0, 1, 0.05, "p", "Chance one slot is a darter, once unlocked."],
    ["DARTER_CHANCE_PER", 0.006, 0, 0.1, 0.001, "p", "Plus this per arena past the unlock."],
    ["DARTER_CHANCE_MAX", 0.5, 0, 1, 0.05, "p", ""],
    ["WARDEN_CHANCE_BASE", 0.22, 0, 1, 0.05, "p", "Chance one slot is a warden, once unlocked."],
    ["WARDEN_CHANCE_PER", 0.005, 0, 0.1, 0.001, "p", "Plus this per arena past the unlock."],
    ["WARDEN_CHANCE_MAX", 0.45, 0, 1, 0.05, "p", ""],
  ]],
  ["counterattack", [
    ["ATTACK_START", 12, 0, 500, 1, "kills", "Kill count before anything shoots (arcade); ramps read from here."],
    ["VOLLEY_GAP_MS", 260, 40, 1500, 10, "ms", "The beat between the two shots of a volley."],
    ["WALL_SPEED_FACTOR", 0.55, 0.1, 1, 0.05, "x", "A wall bolt crosses a panel this much faster than a plain one."],
    ["WALL_RADIUS_FACTOR", 1.7, 1, 4, 0.1, "x", "A wall bolt is this much wider."],
    ["BOLT_HIT_R", 0.28, 0.05, 1, 0.01, "panels", "A bolt lands within this fraction of a panel."],
    ["ATTACK_CHANCE_MET_BASE", 0.24, 0, 1, 0.01, "p", "Per-mett chance to retaliate at the attack start."],
    ["ATTACK_CHANCE_MET_PER", 0.004, 0, 0.1, 0.001, "p", "Plus this per kill past the start."],
    ["ATTACK_CHANCE_MET_MAX", 0.55, 0, 1, 0.05, "p", ""],
    ["ATTACK_CHANCE_HOP_BASE", 0.18, 0, 1, 0.01, "p", "Per-hopper chance to retaliate."],
    ["ATTACK_CHANCE_HOP_PER", 0.003, 0, 0.1, 0.001, "p", ""],
    ["ATTACK_CHANCE_HOP_MAX", 0.45, 0, 1, 0.05, "p", ""],
    ["BOLT_SLOW_RADIUS", 0.19, 0.05, 0.5, 0.01, "panels", "The mett's shell, as a fraction of panel width."],
    ["BOLT_SLOW_AIM_BASE", 560, 100, 3000, 10, "ms", "The mett's telegraph at the attack start."],
    ["BOLT_SLOW_AIM_PER_KILL", 0.8, 0, 10, 0.1, "ms", "Shorter by this per kill."],
    ["BOLT_SLOW_AIM_MIN", 340, 50, 3000, 10, "ms", ""],
    ["BOLT_SLOW_PANEL_BASE", 300, 30, 2000, 10, "ms", "The mett's shell crosses one panel in this, at the start."],
    ["BOLT_SLOW_PANEL_PER_KILL", 0.45, 0, 10, 0.05, "ms", ""],
    ["BOLT_SLOW_PANEL_MIN", 175, 20, 2000, 5, "ms", ""],
    ["BOLT_FAST_RADIUS", 0.135, 0.05, 0.5, 0.005, "panels", "The hopper's bolt."],
    ["BOLT_FAST_AIM_BASE", 780, 100, 3000, 10, "ms", "The hopper's telegraph at the start: the longest in the game."],
    ["BOLT_FAST_AIM_PER_KILL", 1.1, 0, 10, 0.1, "ms", ""],
    ["BOLT_FAST_AIM_MIN", 480, 50, 3000, 10, "ms", ""],
    ["BOLT_FAST_PANEL_BASE", 130, 20, 1000, 5, "ms", "The hopper's bolt crosses a panel in this: a blink."],
    ["BOLT_FAST_PANEL_PER_KILL", 0.2, 0, 10, 0.05, "ms", ""],
    ["BOLT_FAST_PANEL_MIN", 72, 10, 1000, 2, "ms", ""],
  ]],
  ["sentinels", [
    ["SENTINEL_1_HP", 1, 1, 10, 1, "hits", "Mark I: hits to delete."],
    ["SENTINEL_1_OPEN_MS", 1400, 200, 5000, 50, "ms", "Mark I: the iris is open (and hittable) this long."],
    ["SENTINEL_1_CLOSED_MS", 1500, 200, 5000, 50, "ms", "Mark I: closed (armour) this long."],
    ["SENTINEL_2_HP", 2, 1, 10, 1, "hits", ""], ["SENTINEL_2_OPEN_MS", 1050, 200, 5000, 50, "ms", ""],
    ["SENTINEL_2_CLOSED_MS", 1250, 200, 5000, 50, "ms", ""],
    ["SENTINEL_3_HP", 3, 1, 10, 1, "hits", ""], ["SENTINEL_3_OPEN_MS", 780, 200, 5000, 50, "ms", ""],
    ["SENTINEL_3_CLOSED_MS", 1050, 200, 5000, 50, "ms", ""],
    ["HOPPER_HP", 2, 1, 8, 1, "hits", "Hits to delete a hopper (a charged shot takes it outright)."],
    ["SPREADER_HP", 2, 1, 8, 1, "hits", "Hits to delete a spreader."],
    ["WARDEN_HP", 2, 1, 8, 1, "hits", "Hits to delete a warden."],
    ["DARTER_HP", 2, 1, 8, 1, "hits", "Hits to delete a darter."],
    ["SENTINEL_CHARGED_DMG", 2, 1, 10, 1, "hits", "A charged shot counts as this many hits on a sentinel."],
  ]],
  ["bomb", [
    ["BOMB_RANGE", 3, 1, 6, 1, "panels", "Thrown this many columns ahead."],
    ["BOMB_ARC_MS", 640, 100, 3000, 10, "ms", "In the air for this long."],
    ["BOMB_RADIUS", 1, 0, 2, 1, "panels", "Splash reaches this many tiles either side."],
    ["BOMB_PICKUP_CHANCE", 0.6, 0, 1, 0.05, "p", "Chance a road carries a bomb (the first always does)."],
    ["BOMB_BLAST_MS", 460, 100, 2000, 10, "ms", "The blast's lifetime on screen."],
  ]],
];

/** Every entry, flat: { key, default, min, max, step, unit, desc, group }. */
export const TUNING_ENTRIES = TUNING_SCHEMA.flatMap(([group, rows]) =>
  rows.map(([key, def, min, max, step, unit, desc]) => ({ key, default: def, min, max, step, unit, desc, group })));

const BY_KEY = new Map(TUNING_ENTRIES.map((e) => [e.key, e]));
export const TUNING_KEYS = TUNING_ENTRIES.map((e) => e.key);

/** The scalars the game shipped with. */
export function defaultValues() {
  const v = {};
  for (const e of TUNING_ENTRIES) v[e.key] = e.default;
  return v;
}

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Resolve overrides against the schema: unknown keys are dropped, values are
 * coerced to numbers and clamped to their bounds, and the result carries the
 * assembled tables and bound ramps the simulation reads. `version` names
 * the override set ("default" when there is none) so a replay or a bug
 * report can say which numbers it ran under.
 */
export function resolveTuning(overrides) {
  const v = defaultValues();
  const applied = {};
  if (overrides && typeof overrides === "object") {
    for (const [k, raw] of Object.entries(overrides)) {
      const e = BY_KEY.get(k);
      if (!e) continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      const clamped = Math.min(e.max, Math.max(e.min, num));
      if (clamped === e.default) continue;
      v[k] = clamped;
      applied[k] = clamped;
    }
  }
  const keys = Object.keys(applied).sort();
  const version = keys.length ? fnv1a(JSON.stringify(keys.map((k) => [k, applied[k]]))) : "default";
  return Object.freeze(assemble(v, applied, version));
}

/** The default tuning, shared: what a state gets when none is given. */
let DEFAULT = null;
export function defaultTuning() {
  if (!DEFAULT) DEFAULT = resolveTuning(null);
  return DEFAULT;
}

/**
 * Scalars in, the object the core reads out: the scalars themselves, the
 * tables, and the ramps as functions of the scalars.
 */
function assemble(v, applied, version) {
  const t = { ...v, values: v, overrides: applied, version };

  // ----- tables -----
  t.PTS = { normal: v.PTS_NORMAL, charged: v.PTS_CHARGED, guard: v.PTS_GUARD, hopper: v.PTS_HOPPER,
            sentinel: v.PTS_SENTINEL, rare: v.PTS_RARE, spreader: v.PTS_SPREADER,
            warden: v.PTS_WARDEN, darter: v.PTS_DARTER };
  t.BONUS = { normal: v.BONUS_NORMAL, charged: v.BONUS_CHARGED, guard: v.BONUS_GUARD, hopper: v.BONUS_HOPPER,
              sentinel: v.BONUS_SENTINEL, rare: v.BONUS_RARE, spreader: v.BONUS_SPREADER,
              warden: v.BONUS_WARDEN, darter: v.BONUS_DARTER };
  t.SENTINEL = {
    1: { hp: v.SENTINEL_1_HP, openMs: v.SENTINEL_1_OPEN_MS, closedMs: v.SENTINEL_1_CLOSED_MS },
    2: { hp: v.SENTINEL_2_HP, openMs: v.SENTINEL_2_OPEN_MS, closedMs: v.SENTINEL_2_CLOSED_MS },
    3: { hp: v.SENTINEL_3_HP, openMs: v.SENTINEL_3_OPEN_MS, closedMs: v.SENTINEL_3_CLOSED_MS },
  };
  t.STORY_UNLOCK = {
    guard: v.UNLOCK_GUARD, ally: v.UNLOCK_ALLY, retaliate: v.UNLOCK_RETALIATE, hopper: v.UNLOCK_HOPPER,
    sentinel1: v.UNLOCK_SENTINEL1, swarm: v.UNLOCK_SWARM, sentinel2: v.UNLOCK_SENTINEL2,
    sentinel3: v.UNLOCK_SENTINEL3, unlimited: v.ROAD_END,
    spreader: v.UNLOCK_SPREADER, darter: v.UNLOCK_DARTER, warden: v.UNLOCK_WARDEN,
  };
  t.ADV_UNLOCK = {
    guard: v.ADV_GUARD, retaliate: v.ADV_RETALIATE, hopper: v.ADV_HOPPER, sentinel1: v.ADV_SENTINEL1,
    ally: v.ADV_ALLY, sentinel2: v.ADV_SENTINEL2, swarm: v.ADV_SWARM, sentinel3: v.ADV_SENTINEL3,
    unlimited: v.ROAD_END,
    spreader: v.ADV_SPREADER, darter: v.ADV_DARTER, warden: v.ADV_WARDEN,
  };
  t.unlockTable = (mode) => (mode.story ? t.STORY_UNLOCK : t.ADV_UNLOCK);
  t.HOP_TOTAL_MS = v.HOP_WINDUP_MS + v.HOP_MOVE_MS + v.HOP_SETTLE_MS;
  t.HOP_COMMIT_MS = v.HOP_WINDUP_MS + v.HOP_MOVE_MS / 2;

  // ----- ramps -----
  const past = (del) => Math.max(0, del - v.ATTACK_START);
  t.BOLT = {
    slow: {
      radiusFrac: v.BOLT_SLOW_RADIUS,
      aimMs: (del) => Math.max(v.BOLT_SLOW_AIM_MIN, v.BOLT_SLOW_AIM_BASE - past(del) * v.BOLT_SLOW_AIM_PER_KILL),
      panelMs: (del) => Math.max(v.BOLT_SLOW_PANEL_MIN, v.BOLT_SLOW_PANEL_BASE - past(del) * v.BOLT_SLOW_PANEL_PER_KILL),
    },
    fast: {
      radiusFrac: v.BOLT_FAST_RADIUS,
      aimMs: (del) => Math.max(v.BOLT_FAST_AIM_MIN, v.BOLT_FAST_AIM_BASE - past(del) * v.BOLT_FAST_AIM_PER_KILL),
      panelMs: (del) => Math.max(v.BOLT_FAST_PANEL_MIN, v.BOLT_FAST_PANEL_BASE - past(del) * v.BOLT_FAST_PANEL_PER_KILL),
    },
  };
  t.aimMs = (del, kind = "slow") => t.BOLT[kind].aimMs(del);
  t.boltPanelMs = (del, kind = "slow") => t.BOLT[kind].panelMs(del);
  t.dodgeWindowMs = (del, kind, panels = 3) =>
    t.BOLT[kind].aimMs(del) + Math.max(0, panels - v.BOLT_HIT_R) * t.BOLT[kind].panelMs(del);
  t.attackChance = (del, type = "mett") => {
    if (del < v.ATTACK_START) return 0;
    const k = past(del);
    return type === "hopper"
      ? Math.min(v.ATTACK_CHANCE_HOP_MAX, v.ATTACK_CHANCE_HOP_BASE + k * v.ATTACK_CHANCE_HOP_PER)
      : Math.min(v.ATTACK_CHANCE_MET_MAX, v.ATTACK_CHANCE_MET_BASE + k * v.ATTACK_CHANCE_MET_PER);
  };
  // One ramp shape for the three later viruses: a base chance at the unlock,
  // creeping up per arena past it, to a ceiling.
  const perArena = (base, per, max) => (k) => Math.min(max, base + Math.max(0, k) * per);
  t.spreaderWaveChance = perArena(v.SPREADER_CHANCE_BASE, v.SPREADER_CHANCE_PER, v.SPREADER_CHANCE_MAX);
  t.darterWaveChance = perArena(v.DARTER_CHANCE_BASE, v.DARTER_CHANCE_PER, v.DARTER_CHANCE_MAX);
  t.wardenWaveChance = perArena(v.WARDEN_CHANCE_BASE, v.WARDEN_CHANCE_PER, v.WARDEN_CHANCE_MAX);
  // The clock is the road's own pressure, and it rises with distance: an
  // arena late on the road costs more pulse to stand in than arena zero did.
  // It saturates well before the far road, where what is on the board is the
  // difficulty and the clock would only pile on.
  t.drainRate = (idx) => Math.min(v.DRAIN_MAX, v.DRAIN_BASE + Math.max(0, idx) * v.DRAIN_PER_ARENA);
  t.upMs = (del) => Math.max(v.UP_MS_MIN, v.UP_MS_BASE - del * v.UP_MS_PER_KILL);
  t.level = (del) => 1 + Math.floor(del / v.LEVEL_PER_KILLS);
  t.bonusFactor = (del) => (del < v.OC_START ? 1 : Math.pow(v.OC_SLOPE, del - v.OC_START));
  // The road's own economy. The arcade numbers were tuned for a board where a
  // virus you miss sinks away and pays nothing; on the road every virus is
  // persistent, so every one of them is eventually collected and the pulse bar
  // sat pinned at its cap for the first thirty arenas. The road scales its
  // pulse income to the length of the fight it actually asks for -- and it
  // does not also decay by kill count, because the road already has an axis
  // for depth: the drain rises with the arena you are standing in. Stacking
  // both halved the income twice and made arena forty a wall. Points are
  // untouched by either.
  t.pulseScale = (del, advancing) => (advancing ? v.ROAD_PULSE : t.bonusFactor(del));
  t.arenaPlan = (idx) => ({
    pool: Math.min(v.POOL_MAX, v.POOL_BASE + Math.floor(idx * v.POOL_PER_ARENA)),
    waveSize: Math.min(v.WAVE_SIZE_MAX, v.WAVE_SIZE_BASE + Math.floor(idx / v.WAVE_SIZE_PER_ARENAS)),
  });
  t.waveStaggerMs = (w) => Math.max(v.WAVE_STAGGER_MIN, v.WAVE_STAGGER_BASE - w * v.WAVE_STAGGER_PER_WAVE);
  // `tight` is "SWARM is unlocked" -- the caller decides that from its mode
  t.waveLullMs = (w, tight = false) =>
    Math.max(v.WAVE_LULL_MIN, (v.WAVE_LULL_BASE - w * v.WAVE_LULL_PER_WAVE) * (tight ? v.WAVE_LULL_SWARM_FACTOR : 1));
  t.waveClearBonus = (n) => v.WAVE_CLEAR_BONUS_BASE + v.WAVE_CLEAR_BONUS_PER * n;
  // composition chances take "steps past the unlock" (0 at the unlock)
  t.guardWaveChance = (k) => Math.min(v.GUARD_CHANCE_MAX, v.GUARD_CHANCE_BASE + k * v.GUARD_CHANCE_PER);
  t.hopperWaveChance = (k) => Math.min(v.HOPPER_CHANCE_MAX, v.HOPPER_CHANCE_BASE + k * v.HOPPER_CHANCE_PER);
  t.allyWaveChance = (k) => Math.min(v.ALLY_CHANCE_MAX, v.ALLY_CHANCE_BASE + k * v.ALLY_CHANCE_PER);
  t.rareWaveChance = (k, timeLeft) =>
    (v.RARE_CHANCE_BASE + k * v.RARE_CHANCE_PER) * (timeLeft < v.LOW_TIME * 2 ? v.RARE_LOW_TIME_FACTOR : 1);
  // arenas past the sentinel unlock (0 at the unlock), like the others
  t.sentinelWaveChance = (k) => Math.min(v.SENTINEL_CHANCE_MAX, v.SENTINEL_CHANCE_BASE + k * v.SENTINEL_CHANCE_PER);
  return t;
}
