/*!
 * Movement: the step ration, the hop, paths, taps, and landing on a square.
 * The world decides where you may stand; this decides when and how you get
 * there.
 */

import * as C from "./constants.js";
import { walkable, worldEnd } from "./world.js";
import { panel, ripple } from "./fx.js";

/** The step ration for this run's mode: one-hand paces steps at half a charge. */
export const moveMs = (state) => (C.modeById(state.modeId).hop ? state.tuning.TAP_MOVE_MS : state.tuning.MOVE_REPEAT_MS);
export const moveReady = (state) => state.clock - state.lastMoveAt >= moveMs(state);
/** Hopping modes hop; the retired ring modes step on the spot. */
export const hops = (state) => !!C.modeById(state.modeId).hop;

/**
 * A step asked for during the cooldown is not dropped: in one-hand a thumb
 * that taps twice quickly means "there, then there", and swallowing the second
 * makes the ration feel like lag. The latest ask wins; it is taken the moment
 * the cooldown ends, and only if it is still legal then. The board's stick
 * rides on the same queue: held, it re-asks every frame, so a hold walks at
 * the ration and a flick inside it still lands its one step. Ring and keyboard
 * modes keep their old drop, which is what their repeat-while-held relies on.
 */
export function queueMove(state, q) {
  if (!hops(state)) return;
  state.queuedMove = q;
}

/** Take the held step once the ration allows. Called every frame. */
export function flushQueuedMove(state, events) {
  const q = state.queuedMove;
  if (!q) return;
  if (state.mode !== "playing" || state.paused) { state.queuedMove = null; return; }
  if (!moveReady(state)) return;
  state.queuedMove = null;
  if (q.kind === "to") moveTo(state, q.col, q.row, events);
  else move(state, q.dc, q.dr, events);
}

/**
 * A step in a direction. Any direction pressed is a new directive: a path
 * being walked is dropped for it.
 */
export function move(state, dc, dr, events, fromHold = false) {
  if (state.mode !== "playing" || state.paused) return;
  if (!(dc || dr)) return;
  state.path = null;
  if (!moveReady(state)) {
    // a hold that has already stepped since it began is walking, not asking
    if (!fromHold || state.lastMoveAt < state.holdT0) queueMove(state, { kind: "by", dc, dr });
    return;
  }
  // Touch modes hop one square, never diagonally: the larger axis wins.
  if (hops(state) && dc && dr) { if (Math.abs(dc) >= Math.abs(dr)) dr = 0; else dc = 0; }
  const [col, row] = stepFrom(state, state.player.col, state.player.row, dc, dr);
  go(state, col, row, events);
}

/**
 * Resolve a press into the square it reaches. The world decides where you may
 * stand: your own ground and the road, never an enemy tile, never off the map.
 * Each axis is resolved on its own, one tile at a time, so a diagonal press
 * blocked in one direction still moves in the other -- the ring presses both
 * axes on a diagonal, and a wall should not cancel the half of the input that
 * was fine. In classic this is exactly the old clamp to the player's half.
 *
 * And never a square that has already scrolled off the left edge of the
 * view: the camera only moves right, so that wall only ever advances.
 */
export function stepFrom(state, col, row, dc, dr) {
  const world = state.world;
  const wall = Math.floor(state.cam || 0);
  const sc = Math.sign(dc), sr = Math.sign(dr);
  for (let i = 0; i < Math.abs(dc); i++) {
    if (col + sc < wall || !walkable(world, col + sc, row)) break;
    col += sc;
  }
  for (let i = 0; i < Math.abs(dr); i++) {
    const nr = row + sr;
    if (nr < 0 || nr >= C.ROWS || !walkable(world, col, nr)) break;
    row = nr;
  }
  return [col, row];
}

/** Spend the ration on a step to (col,row): a hop in touch modes, a landing otherwise. */
export function go(state, col, row, events) {
  state.lastMoveAt = state.clock;
  if (!hops(state)) { land(state, col, row, events); return; }
  // a hop still in the air when the next begins lands first: no square is
  // ever skipped, whatever the frame timing
  const prev = state.hop;
  if (prev && !prev.committed) { prev.committed = true; land(state, prev.toCol, prev.toRow, events); }
  if (col === state.player.col && row === state.player.row) { state.hop = null; return; }
  state.hop = {
    fromCol: state.player.col, fromRow: state.player.row, toCol: col, toRow: row,
    t0: state.clock, committed: false,
  };
  events.push({ type: "hop", fromCol: state.player.col, fromRow: state.player.row, col, row });
}

/**
 * The hop in flight: the square you count as standing on changes at the top
 * of the arc, and the hop is over after the landing settles. Every frame.
 */
export function updateHop(state, events) {
  const h = state.hop;
  if (!h) return;
  const t = state.clock - h.t0;
  if (!h.committed && t >= state.tuning.HOP_COMMIT_MS) {
    h.committed = true;
    land(state, h.toCol, h.toRow, events);
  }
  if (t >= state.tuning.HOP_TOTAL_MS) state.hop = null;
}

/**
 * Go to a square: one-hand's tap. Beside you it is one hop; further away it
 * lays a path and the hops follow it, one per ration, until any new
 * directive replaces it. The square has to be standable, still on screen,
 * and reachable on foot -- a narrow road is a funnel, and a tap on the far
 * bank must not hop the void it exists to make you walk around.
 */
export function moveTo(state, col, row, events) {
  if (state.mode !== "playing" || state.paused) return;
  if (col === state.player.col && row === state.player.row) { state.path = null; return; }
  if (!reachable(state, col, row)) return;
  ripple(state, col, row, "#4f8dff", state.clock, 1);
  state.path = { col, row };
  runPath(state, events);
}

/** Take the next step of the path when the ration allows. Every frame. */
export function runPath(state, events) {
  const p = state.path;
  if (!p) return;
  if (state.mode !== "playing" || state.paused) { state.path = null; return; }
  if (p.col === state.player.col && p.row === state.player.row) { state.path = null; return; }
  if (!moveReady(state)) return;
  const next = nextStep(state, p.col, p.row);
  if (!next) { state.path = null; return; }     // the way closed: stop where you are
  go(state, next[0], next[1], events);
}

/**
 * The first square of a shortest walk from the player to (col,row), or null
 * if there is none. Four-connected over standable squares on screen, so a
 * path never cuts a corner or hops a gap.
 */
export function nextStep(state, col, row) {
  const world = state.world;
  const wall = Math.floor(state.cam || 0);
  if (row < 0 || row >= C.ROWS || col < wall) return null;
  if (!walkable(world, col, row)) return null;
  const end = worldEnd(world);
  const key = (c, r) => c * C.ROWS + r;
  const from = key(state.player.col, state.player.row);
  const parent = new Map([[from, null]]);
  const open = [[state.player.col, state.player.row]];
  let head = 0;
  while (head < open.length) {
    const [c, r] = open[head++];
    if (c === col && r === row) {
      // walk back to the square after the start
      let k = key(c, r);
      while (parent.get(k) !== from) k = parent.get(k);
      return [Math.floor(k / C.ROWS), k % C.ROWS];
    }
    for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]) {
      if (nc < wall || nc >= end || nr < 0 || nr >= C.ROWS) continue;
      const nk = key(nc, nr);
      if (parent.has(nk) || !walkable(world, nc, nr)) continue;
      parent.set(nk, key(c, r));
      open.push([nc, nr]);
    }
  }
  return null;
}

/** Is (col,row) standable and joined to the player by standable squares? */
export function reachable(state, col, row) {
  if (col === state.player.col && row === state.player.row) return true;
  return nextStep(state, col, row) !== null;
}

/**
 * A tap on the stage, in CSS pixels, resolved through the camera to a square.
 * The shell hands over raw coordinates and nothing else: the layout and the
 * scroll both live here, so a tap means the same square in a replay.
 */
export function tapAt(state, x, y, events) {
  const G = state.G;
  if (!G.pw || !G.ph) return;
  const wx = (x + (state.cam || 0) * G.pw - G.gx) / G.pw;
  const wy = (y - G.gy) / G.ph;
  let row = Math.floor(wy);
  if (row === -1 && wy >= -C.TAP_SLACK) row = 0;
  if (row === C.ROWS && wy < C.ROWS + C.TAP_SLACK) row = C.ROWS - 1;
  const col = Math.floor(wx);
  if (!moveReady(state) && hops(state)) {
    // inside the ration: held, like any other step asked for early
    if (reachable(state, col, row)) queueMove(state, { kind: "to", col, row });
    return;
  }
  moveTo(state, col, row, events);
}

/** Arrive on a square: pickups, the afterimage, and the event. */
export function land(state, col, row, events) {
  const moved = col !== state.player.col || row !== state.player.row;
  if (moved) {
    // walking onto a pickup takes it
    for (let i = state.pickups.length - 1; i >= 0; i--) {
      const pk = state.pickups[i];
      if (pk.col !== col || pk.row !== row) continue;
      state.pickups.splice(i, 1);
      if (pk.kind === "bomb") state.bombs++;
      const pp = panel(state, col, row);
      state.fx.popups.push({ x: pp.x + pp.w / 2, y: pp.y - 8, t0: state.clock, text: "+BOMB", color: "#ff9f45" });
      events.push({ type: "pickup", kind: pk.kind, col, row, x: pp.x + pp.w / 2, y: pp.y, bombs: state.bombs });
      events.push({ type: "statsChanged" });
    }
    state.fx.ghost.t0 = state.clock;
    state.fx.ghost.col = state.player.col;
    state.fx.ghost.row = state.player.row;
  }
  state.player.col = col;
  state.player.row = row;
  if (moved) events.push({ type: "playerMoved", col, row });
}
