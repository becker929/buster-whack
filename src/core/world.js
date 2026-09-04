/*!
 * The world: an unbounded horizontal strip of segments.
 *
 *   [arena][road][arena][road][arena] ...
 *
 * An arena is COLS wide. While it is held by the enemy its left PCOLS columns
 * are the player's footing and the rest is theirs; once its wave is wiped the
 * whole arena is the player's, a road opens off its right edge, and the next
 * arena waits at the far end of the road. A road is ROAD_COLS long and either
 * full height or a single middle row, so some crossings funnel the player.
 *
 * Classic is the degenerate case: one arena at x0 = 0 that never clears to a
 * road. Everything below reads the segment list, so there is no classic branch
 * in the simulation -- only a mode flag that decides whether a wipe appends.
 *
 * Coordinates are world columns, unbounded to the right. The simulation works
 * in world pixels (gx + wx * pw) throughout; the camera exists only in the
 * renderer, as a translate. Deterministic: road heights come from state.rng.
 */

import { COLS, PCOLS, ROWS, ROAD_COLS, ROAD_MID_ROW, TOWER_COLS, STORY_ROUTE, towerSpec } from "./constants.js";
import { defaultTuning } from "./tuning.js";

export const TILE = {
  PLAYER: "player",
  ENEMY: "enemy",
  ROAD: "road",
  NPC: "npc",       // a keeper or item on a tower: not standable, talked to from beside
  VOID: "void",
};

/**
 * A fresh world: one enemy-held arena at the origin -- or, in the story, a
 * tower at the origin with the first arena as its guard beyond it.
 */
export function createWorld(opts = {}) {
  const t = opts.tuning || defaultTuning();
  if (!opts.story) return { segs: [arena(0, 0, true, t)] };
  return { segs: [tower(0, STORY_ROUTE[0], true), arena(TOWER_COLS, 0, false, t)] };
}

/** A roost on the strip: the player's own ground, with people on it. */
function tower(x0, roost, entered = false) {
  const spec = towerSpec(roost);
  return {
    kind: "tower", x0, cols: TOWER_COLS, roost,
    npcs: spec.npcs.map((n) => ({ ...n, col: x0 + n.col })),
    entered,
  };
}

function arena(x0, idx, entered = idx === 0, t = defaultTuning()) {
  const plan = t.arenaPlan(idx);
  return {
    kind: "arena", x0, cols: COLS, idx, owner: "enemy", entered,
    // the guard: how many viruses hold this road, how many join at once, and
    // how many have been dealt so far. Only advance reads these.
    pool: plan.pool, waveSize: plan.waveSize, dealt: 0,
  };
}

/** The arena the player is fighting in or walking toward: always the last one. */
export function activeArena(world) {
  for (let i = world.segs.length - 1; i >= 0; i--) {
    if (world.segs[i].kind === "arena") return world.segs[i];
  }
  return world.segs[0];
}

/**
 * Nowhere a virus holds: on a tower, a road, a taken arena, or before a guard
 * wakes. The run clock only drains outside a safe zone.
 */
export function safeZone(world) {
  const a = activeArena(world);
  return !(a.entered && a.owner === "enemy");
}

/** Right edge (exclusive) of the last segment: where the world currently ends. */
export function worldEnd(world) {
  const s = world.segs[world.segs.length - 1];
  return s.x0 + s.cols;
}

/** Which segment covers world column `wx`, or null past the end / before 0. */
export function segmentAt(world, wx) {
  if (wx < 0) return null;
  // few segments, small numbers: a scan beats a map here and keeps the state
  // structured-clonable for headless replay
  for (const s of world.segs) {
    if (wx >= s.x0 && wx < s.x0 + s.cols) return s;
  }
  return null;
}

/** The kind of tile at (wx, row). Anything unmapped is void. */
export function tileAt(world, wx, row) {
  if (row < 0 || row >= ROWS) return TILE.VOID;
  const s = segmentAt(world, wx);
  if (!s) return TILE.VOID;
  if (s.kind === "road") {
    return s.rows === ROWS || row === ROAD_MID_ROW ? TILE.ROAD : TILE.VOID;
  }
  if (s.kind === "tower") {
    return s.npcs.some((n) => n.col === wx && n.row === row) ? TILE.NPC : TILE.PLAYER;
  }
  if (s.owner === "player") return TILE.PLAYER;
  return wx - s.x0 < PCOLS ? TILE.PLAYER : TILE.ENEMY;
}

/** Can the player stand here? Their own ground and the road; never enemy tiles. */
export function walkable(world, wx, row) {
  const t = tileAt(world, wx, row);
  return t === TILE.PLAYER || t === TILE.ROAD;
}

/** The npc on a tower tile, or null. */
export function npcAt(world, wx, row) {
  const s = segmentAt(world, wx);
  if (!s || s.kind !== "tower") return null;
  return s.npcs.find((n) => n.col === wx && n.row === row) || null;
}

/** The npc beside (4-neighbour of) a square, or null: who TALK would address. */
export function npcBeside(world, wx, row) {
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = npcAt(world, wx + dc, row + dr);
    if (n) return n;
  }
  return null;
}

/** Is world column `wx` inside arena `a`? */
export const inArena = (a, wx) => wx >= a.x0 && wx < a.x0 + a.cols;

/**
 * The wave was wiped: the arena becomes the player's, a road is laid off its
 * right edge, and the next arena is placed at the road's end. Returns the road
 * and the new arena so the caller can announce them.
 */
export function clearArena(world, rng, opts = {}) {
  const tun = opts.tuning || defaultTuning();
  const a = activeArena(world);
  a.owner = "player";
  const narrow = rng() < tun.NARROW_ROAD_CHANCE;
  const road = {
    kind: "road",
    x0: a.x0 + a.cols,
    cols: ROAD_COLS,
    rows: narrow ? 1 : ROWS,
  };
  world.segs.push(road);
  let x = road.x0 + road.cols;
  // in the story a tower may stand at the road's end, before the next guard
  let t = null;
  if (opts.tower) {
    t = tower(x, opts.tower);
    world.segs.push(t);
    x += t.cols;
  }
  const next = arena(x, a.idx + 1, false, tun);
  world.segs.push(next);
  return { cleared: a, road, tower: t, next };
}
