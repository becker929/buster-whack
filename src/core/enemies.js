/*!
 * The enemy table: every virus as data, and the attacks they use.
 *
 * One entry per type says what the thing *is* — how many hits it takes, how
 * long it stays up, whether it moves, whether it shoots and with what, what
 * armour it wears and what it is worth. The numbers behind those answers are
 * tuning (see tuning.js); this table names which of them each type reads, so
 * a new virus is a row here plus its numbers there, not a new branch in five
 * files.
 *
 * Attacks are their own vocabulary. An attack is a list of shots, each with a
 * row offset and a delay, and optional factors on the bolt's speed and size.
 * That is enough for every pattern the game fires: a single bolt, a fan across
 * three lanes, a two-shot volley down one, or a slow fat wall.
 *
 * Pure module. No DOM, no clock, no randomness.
 */

import * as C from "./constants.js";

/**
 * @typedef {object} Shot
 * @property {number} dRow    lanes above (-) or below (+) the firer
 * @property {string|null} delayKey  tuning key for the wait before this shot
 * @property {string|null} speedKey  tuning key for a factor on the bolt's speed
 * @property {string|null} radiusKey tuning key for a factor on the bolt's size
 */

/** @type {Record<string, { shots: Shot[] }>} */
export const ATTACKS = {
  // one bolt down the firer's own lane: the game's original shot
  bolt: { shots: [{ dRow: 0, delayKey: null, speedKey: null, radiusKey: null }] },
  // a fan: the firer's lane and both neighbours at once. Standing still is
  // the wrong answer to it; so is stepping one lane.
  spread: { shots: [
    { dRow: -1, delayKey: null, speedKey: null, radiusKey: null },
    { dRow: 0, delayKey: null, speedKey: null, radiusKey: null },
    { dRow: 1, delayKey: null, speedKey: null, radiusKey: null },
  ] },
  // two down one lane, the second a beat behind: dodging back too early is
  // the mistake it punishes
  volley: { shots: [
    { dRow: 0, delayKey: null, speedKey: null, radiusKey: null },
    { dRow: 0, delayKey: "VOLLEY_GAP_MS", speedKey: null, radiusKey: null },
  ] },
  // a slow fat one that owns the lane while it crosses: leave, or be hit
  wall: { shots: [
    { dRow: 0, delayKey: null, speedKey: "WALL_SPEED_FACTOR", radiusKey: "WALL_RADIUS_FACTOR" },
  ] },
};

/**
 * @typedef {object} EnemyDef
 * @property {string} canon      the bible id this type plays in the fiction
 * @property {string} family     rot / static / sweeper / prog
 * @property {boolean} friendly  a prog: shooting it costs, sparing it pays
 * @property {string|null} hpKey tuning key for how many hits it takes (null: one)
 * @property {string} riseKey    tuning key for how long it takes to surface
 * @property {string|null} lifeKey  tuning key for how long it stays up (null: the ramp)
 * @property {string|null} hopKey   tuning key for its own hop interval (null: it stands)
 * @property {boolean} hopWhenHeld  only hop while it holds a road (the mett's shuffle)
 * @property {boolean} retaliate    can it be armed at all
 * @property {string|null} attack   which entry of ATTACKS it fires
 * @property {string} bolt          which bolt kind that attack throws
 * @property {string|null} armor    steel (a plink) or shutter (armoured until open)
 * @property {boolean} stagger      a plain shot can take a hit off it
 * @property {string|null} scoreKey the PTS/BONUS key (null: the shot's own tier)
 */

/** @type {Record<string, EnemyDef>} */
export const ENEMIES = {
  mett: {
    canon: "enemy.rot.01", family: "rot", friendly: false,
    hpKey: null, riseKey: "RISE_MS", lifeKey: null,
    hopKey: "MET_HOP_MS", hopWhenHeld: true,
    retaliate: true, attack: "bolt", bolt: "slow",
    armor: null, stagger: false, scoreKey: null,
  },
  guard: {
    canon: "enemy.sweeper.01", family: "sweeper", friendly: false,
    hpKey: null, riseKey: "RISE_MS", lifeKey: null,
    hopKey: null, hopWhenHeld: false,
    // The anchor of a formation already demands the one thing that pins you
    // in place (a held charge); making it shoot too would punish the exact
    // behaviour it exists to teach.
    retaliate: false, attack: null, bolt: "slow",
    armor: "steel", stagger: false, scoreKey: "guard",
  },
  hopper: {
    canon: "enemy.static.01", family: "static", friendly: false,
    hpKey: "HOPPER_HP", riseKey: "RISE_MS", lifeKey: "HOPPER_LIFE",
    hopKey: "HOP_MS", hopWhenHeld: false,
    retaliate: true, attack: "bolt", bolt: "fast",
    armor: null, stagger: true, scoreKey: "hopper",
  },
  ally: {
    canon: "ally", family: "prog", friendly: true,
    hpKey: null, riseKey: "ALLY_RISE_MS", lifeKey: null,
    hopKey: null, hopWhenHeld: false,
    retaliate: false, attack: null, bolt: "slow",
    armor: null, stagger: false, scoreKey: null,
  },
  rare: {
    canon: "enemy.rot.01", family: "rot", friendly: false,
    hpKey: null, riseKey: "RISE_MS", lifeKey: "RARE_LIFE",
    hopKey: null, hopWhenHeld: false,
    retaliate: false, attack: null, bolt: "slow",
    armor: null, stagger: false, scoreKey: "rare",
  },
  sentinel: {
    canon: "enemy.sweeper.01", family: "sweeper", friendly: false,
    hpKey: null, riseKey: "RISE_MS", lifeKey: null,   // hp and timings come from the mark
    hopKey: null, hopWhenHeld: false,
    retaliate: true, attack: "bolt", bolt: "slow",
    armor: "shutter", stagger: true, scoreKey: "sentinel",
  },

  // ---- the rot that learned to fan out, to clog a lane, and the static
  // that learned to shoot twice. Each is one row here and one attack above.
  spreader: {
    canon: "enemy.rot.02", family: "rot", friendly: false,
    hpKey: "SPREADER_HP", riseKey: "RISE_MS", lifeKey: null,
    hopKey: null, hopWhenHeld: false,
    retaliate: true, attack: "spread", bolt: "slow",
    armor: null, stagger: true, scoreKey: "spreader",
  },
  warden: {
    canon: "enemy.rot.03", family: "rot", friendly: false,
    hpKey: "WARDEN_HP", riseKey: "RISE_MS", lifeKey: null,
    hopKey: null, hopWhenHeld: false,
    retaliate: true, attack: "wall", bolt: "slow",
    armor: null, stagger: true, scoreKey: "warden",
  },
  darter: {
    canon: "enemy.static.02", family: "static", friendly: false,
    hpKey: "DARTER_HP", riseKey: "RISE_MS", lifeKey: "HOPPER_LIFE",
    hopKey: "DARTER_HOP_MS", hopWhenHeld: false,
    retaliate: true, attack: "volley", bolt: "fast",
    armor: null, stagger: true, scoreKey: "darter",
  },
};

/** The types a wave can be composed of, in the order they were introduced. */
export const ENEMY_TYPES = Object.keys(ENEMIES);

/** The rows above where a virus can appear: the ones a spread would reach. */
export const inBoard = (row) => row >= 0 && row < C.ROWS;

const DEF_FALLBACK = ENEMIES.mett;
/** @returns {EnemyDef} */
export const enemyDef = (type) => ENEMIES[type] || DEF_FALLBACK;

/** Which bolt kind a type throws. Kept as a function: the shell asks too. */
export const boltKindFor = (type) => enemyDef(type).bolt;

/** Can this type ever be armed? */
export const canRetaliate = (type) => enemyDef(type).retaliate;

/** How many hits it takes, before a sentinel's mark overrides it. */
export function hpOf(tuning, type) {
  const key = enemyDef(type).hpKey;
  return key ? tuning[key] : 1;
}

/** How long it takes to surface. */
export function riseMsOf(tuning, type) {
  return tuning[enemyDef(type).riseKey];
}

/** The shots one attack throws, resolved against the tuning. */
export function shotsOf(tuning, type) {
  const def = enemyDef(type);
  const atk = def.attack ? ATTACKS[def.attack] : null;
  if (!atk) return [];
  return atk.shots.map((s) => ({
    dRow: s.dRow,
    delay: s.delayKey ? tuning[s.delayKey] : 0,
    speedFactor: s.speedKey ? tuning[s.speedKey] : 1,
    radiusFactor: s.radiusKey ? tuning[s.radiusKey] : 1,
  }));
}
