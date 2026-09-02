/*!
 * The simulation.
 *
 *   step(state, dtMs, intents) -> events[]
 *
 * Deterministic and effect-free: no DOM, no audio, no Math.random, no clock
 * reads. Randomness comes from `state.rng`, time only from `dtMs`. Anything
 * the outside world should hear, show or persist leaves as an event; the shell
 * drains the list and performs it.
 *
 * `intents` is either an array of actions or `{ actions, hold }`:
 *   actions - discrete inputs since the last step, applied in order *before*
 *             the clock advances (which is where they landed when the shell
 *             handled DOM events inline).
 *   hold    - a held d-pad direction `{ dc, dr }`, polled after the clock
 *             advances, throttled by MOVE_REPEAT_MS like any other move.
 */

import * as C from "./constants.js";
import { createWorld, activeArena, walkable, clearArena } from "./world.js";
import { computeRank } from "./select.js";

const panel = (state, col, row) => C.panelRect(state.G, col, row);

// ---------- entry point ----------

export function step(state, dtMs, intents = {}) {
  const events = [];
  const actions = Array.isArray(intents) ? intents : intents.actions || [];
  const hold = Array.isArray(intents) ? null : intents.hold;

  for (const a of actions) applyIntent(state, a, events);

  // Hit-stop. `adv` is how much of this frame's dt the *simulation* gets: a
  // pending freeze eats the front of it, so animations, bolts, spawn gaps and
  // aim windows all stall together and cannot desync from each other. The run
  // clock below is deliberately not part of it.
  let adv = dtMs;
  if (state.mode === "playing" && !state.paused &&
      state.hitStopMs > 0 && state.clock >= state.hitStopAt) {
    const used = Math.min(state.hitStopMs, adv);
    state.hitStopMs -= used;
    adv -= used;
  }

  if (state.mode === "playing" && !state.paused) {
    state.clock += adv;
    state.timeLeft -= dtMs / 1000;
    if (state.timeLeft <= 0) { state.timeLeft = 0; gameOver(state, events); }
    if (state.charge.downAt !== null && !state.charge.full &&
        state.clock - state.charge.downAt >= C.CHARGE_MS) {
      state.charge.full = true;
      events.push({ type: "chargeReady" });
    }
  }

  if (hold && (hold.dc || hold.dr)) move(state, hold.dc, hold.dr, events);

  updateEnemies(state, events);
  updateBolts(state, adv, events);
  checkStageGate(state, events);
  cullFx(state);

  return events;
}

// ---------- juice authoring ----------
// The core owns the fx *data*; `render.js` only reads it. Every random number
// below comes from `state.rng`, so a seed still reproduces a run frame for
// frame, debris included.

/** Queue a freeze of `ms` that engages once the clock reaches `at`. */
function hitStop(state, at, ms) {
  if (state.hitStopMs <= 0) {
    state.hitStopAt = at;
    state.hitStopMs = Math.min(C.MAX_HITSTOP, ms);
    return;
  }
  state.hitStopAt = Math.min(state.hitStopAt, at);
  state.hitStopMs = Math.min(C.MAX_HITSTOP, state.hitStopMs + ms);
}

/** One shake envelope for the whole screen; the loudest live event wins. */
function shake(state, spec, at, scale = 1) {
  const sh = state.fx.shake;
  const t = at - sh.t0;
  const remaining = t >= 0 && t < sh.ms ? sh.amp * (1 - t / sh.ms) : 0;
  const amp = spec.amp * scale;
  if (amp < remaining) return;
  sh.t0 = at;
  sh.ms = spec.ms;
  sh.amp = amp;
}

/**
 * Throw debris. Jitter is drawn from `state.rng`, never Math.random, and the
 * pool is hard-capped: the oldest bits fall off the front rather than letting a
 * crowded frame grow without bound.
 */
function spawnBits(state, x, y, n, palette, opts = {}) {
  const bits = state.fx.bits;
  const t0 = opts.at === undefined ? state.clock : opts.at;
  const dir = opts.dir === undefined ? -Math.PI / 2 : opts.dir;
  const spread = opts.spread === undefined ? 1 : opts.spread;
  const speed = opts.speed === undefined ? 0.24 : opts.speed;
  const g = opts.g === undefined ? C.BIT_GRAVITY : opts.g;
  for (let i = 0; i < n; i++) {
    const a = dir + (state.rng() - 0.5) * Math.PI * spread;
    const v = speed * (0.45 + state.rng());
    bits.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g,
      t0, ms: opts.ms || C.BIT_MS,
      size: 3 + state.rng() * 4.6,
      color: palette[Math.floor(state.rng() * palette.length)],
    });
  }
  const over = bits.length - C.MAX_BITS;
  if (over > 0) bits.splice(0, over);
}

/** An impact ring inside one panel. */
function ripple(state, col, row, color, at, w = 1) {
  state.fx.ripples.push({ col, row, color, w, t0: at, ms: C.RIPPLE_MS });
  if (state.fx.ripples.length > 12) state.fx.ripples.shift();
}

// ---------- intents ----------

export function applyIntent(state, action, events) {
  switch (action.type) {
    case "firePressed":  firePressed(state, events); break;
    case "fireReleased": fireReleased(state, events); break;
    case "move":         move(state, action.dc, action.dr, events); break;
    case "resetMoveThrottle": state.lastMoveAt = -1e9; break;
    case "pause":        togglePause(state, events); break;
    case "pauseOnBlur":
      if (state.mode === "playing" && !state.paused) togglePause(state, events);
      break;
    case "startRun":     resetGame(state, events, action.modeId); break;
    case "resume":       resumeFromInterlevel(state, events); break;
    case "endRun":       gameOver(state, events); break;
    default: break;      // shell-only intents (mute, …) never reach here
  }
}

function firePressed(state, events) {
  if (!state.canFire) return;
  state.canFire = false;
  if (state.mode === "ready" || state.mode === "over") { resetGame(state, events); return; }
  if (state.mode === "interlevel") { resumeFromInterlevel(state, events); return; }
  if (state.paused) return;
  shoot(state, "normal", events);
  state.charge.downAt = state.clock;
  state.charge.full = false;
}

function fireReleased(state, events) {
  // `canFire` *is* "nothing is holding the button". A release with nothing
  // pressed is not ours — a stray pointerup elsewhere on the page, a keyup for
  // a keydown we never took — and must not spend a charge or re-arm the latch.
  // The shell keys releases to the source that pressed; this is the core
  // refusing to be confused even if some other shell does not.
  if (state.canFire) return;
  state.canFire = true;
  if (state.charge.downAt !== null && state.charge.full &&
      state.mode === "playing" && !state.paused) {
    shoot(state, "charged", events);
  }
  state.charge.downAt = null;
  state.charge.full = false;
}

function move(state, dc, dr, events) {
  if (state.mode !== "playing" || state.paused) return;
  if (state.clock - state.lastMoveAt < C.MOVE_REPEAT_MS) return;
  state.lastMoveAt = state.clock;
  // The world decides where you may stand: your own ground and the road,
  // never an enemy tile, never off the map. Each axis is resolved on its own,
  // one tile at a time, so a diagonal press blocked in one direction still
  // moves in the other -- the ring presses both axes on a diagonal, and a
  // wall should not cancel the half of the input that was fine. In classic
  // this is exactly the old clamp to the player's half.
  const world = state.world;
  let col = state.player.col, row = state.player.row;
  const sc = Math.sign(dc), sr = Math.sign(dr);
  for (let i = 0; i < Math.abs(dc); i++) {
    if (col + sc < 0 || !walkable(world, col + sc, row)) break;
    col += sc;
  }
  for (let i = 0; i < Math.abs(dr); i++) {
    const nr = row + sr;
    if (nr < 0 || nr >= C.ROWS || !walkable(world, col, nr)) break;
    row = nr;
  }
  const moved = col !== state.player.col || row !== state.player.row;
  if (moved) {
    state.fx.ghost.t0 = state.clock;
    state.fx.ghost.col = state.player.col;
    state.fx.ghost.row = state.player.row;
  }
  state.player.col = col;
  state.player.row = row;
  if (moved) events.push({ type: "playerMoved", col, row });
}

function togglePause(state, events) {
  if (state.mode !== "playing") return;
  state.paused = !state.paused;
  if (state.paused) { state.charge.downAt = null; state.charge.full = false; }
  events.push({ type: state.paused ? "paused" : "unpaused" });
}

// ---------- game flow ----------

function resetGame(state, events, modeId) {
  const cfg = C.modeById(modeId || state.modeId);
  state.modeId = cfg.id;
  state.world = createWorld();
  state.arenasCleared = 0;
  state.cam = 0;
  state.camAnchor = 0;
  state.camClock = state.clock;
  state.mode = "playing";
  state.paused = false;
  state.score = 0;
  state.deletions = 0;
  state.shots = 0; state.whiffs = 0;
  state.chain = 0; state.bestChain = 0;
  state.timeLeft = C.START_TIME;
  state.player.col = 1; state.player.row = 1;
  state.enemies.length = 0;
  state.nextSpawnAt = state.clock + 500;   // the opening lull, before wave 0
  state.waveIdx = 0;
  state.waveState = "lull";
  state.wave = null;
  state.stageIdx = 0;
  clearFx(state);
  state.bolts.length = 0;
  state.hurtUntil = -1e9;
  state.rank = null;
  events.push({ type: "runStarted", modeId: cfg.id });
  events.push({ type: "statsChanged" });
}

function gameOver(state, events) {
  state.mode = "over";
  state.rank = computeRank(state);
  const newBest = state.score > state.best;
  if (newBest) state.best = state.score;
  state.enemies.length = 0;
  state.bolts.length = 0;
  state.wave = null;
  state.waveState = "lull";
  state.charge.downAt = null; state.charge.full = false;
  state.hitStopMs = 0;
  events.push({
    type: "gameOver",
    score: state.score,
    rank: state.rank,
    deletions: state.deletions,
    bestChain: state.bestChain,
    best: state.best,
    newBest,
  });
  events.push({ type: "statsChanged" });
}

/**
 * A gate needs both floors: `wave` waves started AND `at` deletions banked.
 * Checked once per frame rather than only on a kill, so whichever floor lands
 * last opens it — usually the wave floor, which puts the card in a lull rather
 * than in the middle of a formation.
 */
function checkStageGate(state, events) {
  if (state.mode !== "playing" || state.paused) return;
  const st = C.STAGES[state.stageIdx];
  if (!st) return;
  if (state.waveIdx >= st.wave && state.deletions >= st.at) enterInterlevel(state, events);
}

function enterInterlevel(state, events) {
  const stage = C.STAGES[state.stageIdx];
  const index = state.stageIdx;
  state.stageIdx++;
  state.mode = "interlevel";
  state.charge.downAt = null;
  state.charge.full = false;
  state.bolts.length = 0;   // don't resume the run into a bolt you can't see coming
  state.hitStopMs = 0;      // nor into the tail of a freeze from the kill that opened the gate
  state.timeLeft = Math.min(C.TIME_CAP, state.timeLeft + C.STAGE_BONUS);
  events.push({
    type: "stageGate",
    stage,
    index,
    title: stage.title,
    timeBonus: C.STAGE_BONUS,
  });
  events.push({ type: "statsChanged" });
}

/**
 * Each frame: notice the player stepping into the arena they were walking
 * toward, and ease the camera. Both live in the core so a replay from a seed
 * reproduces the scroll exactly; the renderer only applies `cam`.
 */
function updateWorld(state, events) {
  const now = state.clock;
  const a = activeArena(state.world);

  // Stepping in is the wave boundary: the arena wakes a beat later. Arena 0
  // is born entered, which is how classic and the opening of advance share a
  // single opening lull.
  if (!a.entered && state.player.col >= a.x0) {
    a.entered = true;
    state.camAnchor = a.x0;
    state.nextSpawnAt = now + C.ARENA_ENTRY_DELAY_MS;
    events.push({ type: "arenaEntered", index: a.idx, x0: a.x0 });
  }

  // Camera. Fighting in an arena: lock so the arena fills the view exactly as
  // classic's board does. Otherwise follow, never behind the last arena you
  // entered and never past the one you are walking to -- so the view slides
  // out of a taken arena as you cross its right half and settles into the
  // lock position as you arrive, with no jump at either end.
  const fighting = a.entered && a.owner === "enemy";
  const target = fighting
    ? a.x0
    : Math.max(state.camAnchor, Math.min(a.x0, state.player.col - 1));
  const dt = Math.max(0, now - state.camClock);
  state.camClock = now;
  const d = target - state.cam;
  if (Math.abs(d) < 0.002) state.cam = target;
  else state.cam += d * (1 - Math.exp(-dt / C.CAM_TAU_MS));
}

function resumeFromInterlevel(state, events) {
  if (state.mode !== "interlevel") return;
  state.mode = "playing";
  state.nextSpawnAt = state.clock + 700;
  // A gate can open in the middle of a formation. Give the rest of it the same
  // beat back, so the card is never followed instantly by an arrival.
  if (state.wave) for (const slot of state.wave.queue) slot.at += 700;
  events.push({ type: "resumed" });
}

// ---------- waves ----------
//
// Enemies do not trickle in on a rolling timer any more; they arrive as a
// formation, and the gap between formations is the game's breathing room.
// One wave is live at a time:
//
//   lull   — nothing on the board, `nextSpawnAt` is when the next wave lands
//   active — `wave.queue` holds the arrivals that have not surfaced yet;
//            the wave ends when the queue is empty and nothing of it is left
//
// `nextSpawnAt` keeps its old name and its old meaning ("the next thing
// happens at"), so setting it to Infinity still gives a completely still board.

function freePanels(state, excludeCol, excludeRow) {
  const occ = new Set(state.enemies.map((e) => e.col + "," + e.row));
  const out = [];
  const a = activeArena(state.world);
  if (a.owner !== "enemy") return out;
  for (let c = a.x0 + C.PCOLS; c < a.x0 + a.cols; c++)
    for (let r = 0; r < C.ROWS; r++) {
      if (c === excludeCol && r === excludeRow) continue;
      if (!occ.has(c + "," + r)) out.push([c, r]);
    }
  return out;
}

/** A free panel that no live enemy and no pending arrival is using. */
function freeSlot(state, planned) {
  const taken = new Set(planned.map((s) => s.col + "," + s.row));
  const free = freePanels(state).filter(([c, r]) => !taken.has(c + "," + r));
  if (!free.length) return null;
  const [col, row] = free[Math.floor(state.rng() * free.length)];
  return { col, row };
}

// Metts and hoppers retaliate. A steel guard does not: it is the anchor of a
// formation and already demands the one thing that pins you in place (a held
// charge), so making it shoot as well would punish the exact behaviour it
// exists to teach. Progs are friendly, and a rare's window is too short to
// chase under fire.
const canRetaliate = (type) => type === "mett" || type === "hopper";

/**
 * Author one formation. Rows are rotated by the rng so six shapes read as many
 * more, and the arrival order is the formation's own — a wave lands, it does
 * not blink into existence.
 */
function planWave(state) {
  const now = state.clock;
  const idx = state.waveIdx;
  const stage = state.stageIdx;
  const size = C.waveSize(stage);
  const form = C.FORMATIONS[Math.floor(state.rng() * C.FORMATIONS.length)];
  const rot = Math.floor(state.rng() * C.ROWS);
  const stagger = C.waveStaggerMs(idx);

  // formations are authored against the origin arena; shift them to this one
  const ax0 = activeArena(state.world).x0;
  const slots = [];
  for (let i = 0; i < size; i++) {
    const [col, row] = form.slots[i];
    slots.push({ col: col + ax0, row: (row + rot) % C.ROWS, type: "mett", at: now + i * stagger });
  }

  // the heavy: one armored anchor the wave forms around
  if (stage >= C.UNLOCK.guard && form.anchor < slots.length &&
      state.rng() < C.guardWaveChance(stage)) {
    slots[form.anchor].type = "guard";
  }

  // hoppers: one, or two once formations are big
  if (stage >= C.UNLOCK.hopper) {
    const wanted = size >= 4 && state.rng() < 0.35 ? 2 : 1;
    for (let k = 0; k < wanted; k++) {
      if (state.rng() >= C.hopperWaveChance(stage)) continue;
      const plain = slots.filter((s) => s.type === "mett");
      if (!plain.length) break;
      plain[Math.floor(state.rng() * plain.length)].type = "hopper";
    }
  }

  // a prog tags along as an extra body: the wave is still clearable without
  // shooting it, which is the whole point of the hold-fire test
  if (stage >= C.UNLOCK.ally && state.rng() < C.allyWaveChance(stage)) {
    const spot = freeSlot(state, slots);
    if (spot) slots.push({ ...spot, type: "ally", at: now + slots.length * stagger });
  }

  // the jackpot leads the wave in, alone on the first beat, because it is only
  // up for RARE_LIFE and has to be seen the instant it arrives
  if (stage >= C.UNLOCK.rare && state.rng() < C.rareWaveChance(stage, state.timeLeft)) {
    const spot = freeSlot(state, slots);
    if (spot) {
      for (const s of slots) s.at += C.RARE_LIFE * 0.5;
      slots.unshift({ ...spot, type: "rare", at: now });
    }
  }

  const virusCount = slots.reduce((n, s) => n + (s.type === "ally" ? 0 : 1), 0);
  return {
    index: idx,
    formation: form.name,
    size: slots.length,
    virusCount,
    kills: 0,
    startedAt: now,
    // only ever used to stop a jammed queue from stalling the run
    deadline: now + slots.length * stagger + C.HOPPER_LIFE + C.WAVE_GRACE_MS,
    queue: slots,
  };
}

function startWave(state, events) {
  const wave = planWave(state);
  state.waveIdx++;
  state.wave = wave;
  state.waveState = "active";
  events.push({
    type: "waveStart", index: wave.index, size: wave.size,
    virusCount: wave.virusCount, formation: wave.formation,
  });
}

function spawnFromSlot(state, slot, events) {
  const now = state.clock;
  const type = slot.type;
  const boltKind = C.boltKindFor(type);
  const armed = state.stageIdx >= C.UNLOCK.retaliate && canRetaliate(type);
  const willAttack = armed && state.rng() < C.attackChance(state.deletions, type);
  state.enemies.push({
    col: slot.col, row: slot.row, type, state: "rising", t0: now,
    riseMs: type === "ally" ? C.ALLY_RISE_MS : C.RISE_MS,
    hp: type === "hopper" ? 2 : 1,
    lastHop: now, hopT0: -1e9,
    wave: state.wave ? state.wave.index : -1,
    willAttack,
    // baked at spawn so the telegraph a virus is drawing cannot change length
    // underneath it when the deletion count ticks over mid-aim
    boltKind,
    aimMs: C.aimMs(state.deletions, boltKind),
    fired: false,
  });
  const p = panel(state, slot.col, slot.row);
  events.push({
    type: "enemySpawned", enemyType: type, col: slot.col, row: slot.row, willAttack,
    boltKind: willAttack ? boltKind : null,
    x: p.x + p.w / 2, y: p.y,
  });
}

function endWave(state, events) {
  const wave = state.wave;
  const now = state.clock;
  const cleared = wave.virusCount > 0 && wave.kills >= wave.virusCount;

  let lull = C.waveLullMs(wave.index, state.stageIdx);
  if (cleared) lull *= C.WAVE_CLEAR_LULL;      // clearing it buys pressure back
  // a lull must never be the thing that kills you: with the clock this low the
  // player needs targets, not air
  if (state.timeLeft < C.LOW_TIME) lull = Math.min(lull, C.LOW_TIME_LULL_MS);
  lull = Math.round(lull);

  let timeBonus = 0, points = 0;
  if (cleared) {
    timeBonus = C.waveClearBonus(wave.virusCount) * C.bonusFactor(state.deletions);
    state.timeLeft = Math.min(C.TIME_CAP, state.timeLeft + timeBonus);
    points = C.WAVE_CLEAR_PTS * wave.virusCount * C.multOf(state.chain);
    state.score += points;
    const p = panel(state, state.player.col, state.player.row);
    state.fx.popups.push({
      x: p.x + p.w / 2, y: p.y - 22, t0: now,
      text: "WAVE CLEAR +" + timeBonus.toFixed(1) + "s", color: "#45e0e8",
    });
  }

  state.waveState = "lull";
  state.nextSpawnAt = now + lull;
  state.wave = null;
  if (cleared && C.modeById(state.modeId).advancing) {
    // The arena is yours. The next one wakes only when you step into it, so
    // the walk is a true lull -- the road is the breath between fights.
    const { cleared: a, road, next } = clearArena(state.world, state.rng);
    state.arenasCleared++;
    state.timeLeft = Math.min(C.TIME_CAP, state.timeLeft + C.ARENA_CLEAR_BONUS);
    state.score += C.ARENA_CLEAR_PTS;
    state.nextSpawnAt = Infinity;
    events.push({
      type: "arenaCleared", index: a.idx, x0: a.x0,
      roadRows: road.rows, nextX0: next.x0,
      timeBonus: C.ARENA_CLEAR_BONUS, points: C.ARENA_CLEAR_PTS,
    });
  }

  events.push({
    type: "waveEnded", index: wave.index, size: wave.size,
    virusCount: wave.virusCount, kills: wave.kills, cleared,
    timeBonus, points, lullMs: lull,
  });
  if (cleared) events.push({ type: "statsChanged" });
}

function updateWave(state, events) {
  const now = state.clock;
  updateWorld(state, events);
  if (state.waveState !== "active" || !state.wave) {
    if (now < state.nextSpawnAt) return;
    startWave(state, events);
  }
  const wave = state.wave;

  const queue = wave.queue;
  for (let i = 0; i < queue.length; ) {
    const slot = queue[i];
    if (slot.at > now) { i++; continue; }
    let busy = false;
    for (const e of state.enemies) {
      if (e.col === slot.col && e.row === slot.row) { busy = true; break; }
    }
    if (busy || state.enemies.length >= C.MAX_ALIVE) {
      // the panel is still busy dying; take the next beat instead of dropping
      // the member, unless the whole wave has run out of patience
      if (now >= wave.deadline) { queue.splice(i, 1); continue; }
      slot.at = now + 90;
      i++;
      continue;
    }
    queue.splice(i, 1);
    spawnFromSlot(state, slot, events);
  }

  if (queue.length) return;
  // plain loop, not .some(): this runs on every frame of every wave
  for (const e of state.enemies) {
    if (e.wave === wave.index && e.state !== "hit") return;
  }
  endWave(state, events);
}

// ---------- enemy state machine ----------

function lifeOf(state, e) {
  if (e.type === "rare") return C.RARE_LIFE;
  const base = e.type === "hopper" ? C.HOPPER_LIFE : C.upMs(state.deletions);
  if (!e.willAttack) return base;
  // an attacker sticks around long enough to actually follow through
  return Math.max(base, aimOf(state, e) + C.ATTACK_FOLLOW_MS);
}

const aimOf = (state, e) =>
  e.aimMs === undefined
    ? C.aimMs(state.deletions, e.boltKind || C.boltKindFor(e.type))
    : e.aimMs;

function updateEnemies(state, events) {
  if (state.mode !== "playing" || state.paused) return;
  const now = state.clock;

  updateWave(state, events);

  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    const t = now - e.t0;
    switch (e.state) {
      case "rising":
        if (t >= (e.riseMs || C.RISE_MS)) {
          e.state = "up"; e.t0 = now; e.lastHop = now;
          if (e.willAttack) {
            const p = panel(state, e.col, e.row);
            events.push({
              type: "enemyAim", enemyType: e.type, col: e.col, row: e.row,
              x: p.x + p.w / 2, y: p.y,
            });
          }
        }
        break;
      case "up": {
        // A hopper about to shoot plants itself: the telegraph would be
        // unreadable if the lane moved under it, and a stationary hopper is
        // the window you get in exchange for the speed of its bolt.
        const aiming = e.willAttack && !e.fired;
        if (e.type === "hopper" && !aiming && now - e.lastHop >= C.HOP_MS) {
          hopTo(state, e, events);
          e.lastHop = now;
        }
        if (aiming && t >= aimOf(state, e)) {
          fireBolt(state, e, events);
          e.fired = true;
          e.lastHop = now;                 // and it does not bolt the same frame
        }
        if (t >= lifeOf(state, e)) { e.state = "sinking"; e.t0 = now; }
        break;
      }
      case "sinking":
        if (t >= C.SINK_MS) {
          // an untouched prog reaching cover is worth a little time
          if (e.type === "ally") {
            state.timeLeft = Math.min(C.TIME_CAP, state.timeLeft + C.ALLY_SPARE_BONUS);
            const p = panel(state, e.col, e.row);
            state.fx.popups.push({
              x: p.x + p.w / 2, y: p.y, t0: now,
              text: "spared +" + C.ALLY_SPARE_BONUS.toFixed(1) + "s", color: "#58c7ff",
            });
            events.push({
              type: "allySpared", col: e.col, row: e.row,
              x: p.x + p.w / 2, y: p.y, timeBonus: C.ALLY_SPARE_BONUS,
            });
          }
          events.push({ type: "enemyEscaped", enemyType: e.type, col: e.col, row: e.row });
          state.enemies.splice(i, 1);
        }
        break;
      case "hit":
        if (t >= C.HIT_MS) state.enemies.splice(i, 1);
        break;
    }
  }
}

function hopTo(state, e, events) {
  const free = freePanels(state, e.col, e.row);
  if (!free.length) return;
  const [c, r] = free[Math.floor(state.rng() * free.length)];
  e.hopFromCol = e.col; e.hopFromRow = e.row;
  e.col = c; e.row = r;
  e.hopT0 = state.clock;
  const p = panel(state, c, r);
  events.push({ type: "hopperHop", col: c, row: r, x: p.x + p.w / 2, y: p.y });
}

// ---------- incoming fire ----------

/**
 * Incoming fire. Two kinds, and the difference is the mechanic:
 *
 *   slow — the mett's siege shell. Huge and lumbering; you can still leave the
 *          row after it launches.
 *   fast — the hopper's. Crosses the board in a blink, so it has to be dodged
 *          during the telegraph — which is why the hopper's aim is the longest
 *          window in the game.
 *
 * The bolt carries everything the renderer needs as data: `kind` for the look,
 * `radius` in px (already scaled to the board) for the size, `speed` in px/ms.
 * `heavy` is kept as a legacy alias for the slow bolt so an older shell (and
 * the audio bank, which keys its bass layer off it) still reads correctly.
 */
function fireBolt(state, e, events) {
  const p = panel(state, e.col, e.row);
  const kind = e.boltKind || C.boltKindFor(e.type);
  state.bolts.push({
    row: e.row,
    x: p.x + p.w / 2,
    speed: state.G.pw / C.boltPanelMs(state.deletions, kind),  // px per ms, travelling left
    kind,
    radius: state.G.pw * C.BOLT[kind].radiusFrac,
    heavy: kind === "slow",
  });
  events.push({
    type: "enemyFired", enemyType: e.type, col: e.col, row: e.row,
    kind, heavy: kind === "slow", x: p.x + p.w / 2, y: p.y,
  });
}

// dt rather than the clock: bolts move in real time, and the early return
// freezes them for pause and the interlevel card alike.
function updateBolts(state, dt, events) {
  if (state.mode !== "playing" || state.paused) return;
  const now = state.clock;
  const G = state.G;
  const pr = panel(state, state.player.col, state.player.row);
  const px = pr.x + pr.w / 2;
  const hitR = G.pw * C.BOLT_HIT_R;
  for (let i = state.bolts.length - 1; i >= 0; i--) {
    const b = state.bolts[i];
    b.x -= b.speed * dt;
    if (b.row === state.player.row && now >= state.hurtUntil && Math.abs(b.x - px) <= hitR) {
      state.bolts.splice(i, 1);
      takeHit(state, events);
      continue;
    }
    if (b.x < G.gx + (activeArena(state.world).x0 - 0.5) * G.pw) state.bolts.splice(i, 1);
  }
}

function takeHit(state, events) {
  const now = state.clock;
  state.hurtUntil = now + C.HIT_IFRAME_MS;
  state.fx.hurtT0 = now;
  state.timeLeft = Math.max(0, state.timeLeft - C.HIT_TIME_PENALTY);
  breakChain(state, events, "hurt");
  state.charge.downAt = null; state.charge.full = false;   // a hit spills your charge
  const p = panel(state, state.player.col, state.player.row);
  state.fx.popups.push({
    x: p.x + p.w / 2, y: p.y - 8, t0: now,
    text: "HIT −" + C.HIT_TIME_PENALTY.toFixed(1) + "s", color: "#ff5470",
  });
  state.fx.sparks.push({ x: p.x + p.w / 2, y: p.y + p.h * 0.3, t0: now });
  spawnBits(state, p.x + p.w / 2, p.y + p.h * 0.4, C.BIT_COUNT.hurt, C.DEBRIS.player,
    { speed: 0.26, spread: 1.4, at: now });
  ripple(state, state.player.col, state.player.row, "#ff5470", now, 3);
  shake(state, C.SHAKE.hurt, now);
  hitStop(state, now, C.HITSTOP.hurt);
  events.push({
    type: "playerHit", col: state.player.col, row: state.player.row,
    x: p.x + p.w / 2, y: p.y, timePenalty: C.HIT_TIME_PENALTY,
  });
  events.push({ type: "statsChanged" });
  // the clock running out is the frame loop's call, same as any other drain
}

function breakChain(state, events, cause, at = state.clock) {
  const chain = state.chain;
  state.chain = 0;
  if (chain <= 0) return;
  // Two or more is a chain worth mourning; one is just a hit.
  if (chain >= 2) {
    const p = panel(state, state.player.col, state.player.row);
    // Taking a bolt already shouts; a second banner over the same panel just
    // fights the HIT popup, so a hurt-break shows only its falling links.
    const quiet = cause === "hurt";
    state.fx.chainBreak = { t0: at, chain, x: p.x + p.w / 2, y: p.y - 6, quiet };
    if (!quiet) ripple(state, state.player.col, state.player.row, "#8a96b8", at, 2);
  }
  events.push({ type: "chainBroken", chain, cause });
}

// ---------- shooting ----------

const isVisible = (e) => e.state === "rising" || e.state === "up" || e.state === "sinking";

function hitFx(target, tier, now) {
  target.tier = tier;
  target.fx = {
    scale:  C.makeImpulse(tier.scale, now),
    squash: C.makeImpulse(tier.squash, now),
    kick:   C.makeImpulse(tier.kick, now),
  };
}

function shoot(state, tierName, events) {
  const now = state.clock;
  const G = state.G;
  const tier = C.TIERS[tierName];
  state.fx.recoil = C.makeImpulse(tier.recoil, now);
  state.fx.muzzleT0 = now;
  state.fx.muzzleTier = tierName;
  state.shots++;

  const row = state.player.row;
  let target = null;
  for (const e of state.enemies) {
    if (!isVisible(e) || e.row !== row) continue;
    // progs are safe while rising or sinking — shots pass through them
    if (e.type === "ally" && e.state !== "up") continue;
    if (e.col <= state.player.col) continue;   // the buster only fires forward
    if (!target || e.col < target.col) target = e;
  }

  // bullet path: from the buster's muzzle to the first target (or the right edge)
  const pr = panel(state, state.player.col, row);
  const bwP = G.pw * 0.34;
  const x0 = pr.x + pr.w / 2 + bwP / 2 + bwP * 0.55;
  const ax0 = activeArena(state.world).x0;
  const x1 = target ? panel(state, target.col, row).x + G.pw / 2 : G.gx + G.pw * (ax0 + C.COLS);
  // hitscan logic stays instant; the tracer just travels fast (~5 px/ms)
  const dur = Math.max(40, Math.min(95, (x1 - x0) / 5));
  state.fx.ray = { t0: now, row, hitCol: target ? target.col : null, x0, x1, dur, tier: tierName };

  // `land` is when the tracer arrives. Scoring stays instant — the hitscan is
  // the rule and the tests pin it — but every *visible* consequence is dated to
  // the impact, so the enemy no longer pops half a board before the shot gets
  // there. The delete animation, the debris, the freeze and the popups all
  // start together at `land`.
  const land = now + dur;

  events.push({
    type: "shot", tier: tierName, row, x: x0, y: C.laneY(G, row),
    hit: !!target, targetType: target ? target.type : null,
  });

  if (!target) {
    state.whiffs++;
    events.push({ type: "whiff", tier: tierName, row, x: x1, y: C.laneY(G, row) });
    breakChain(state, events, "whiff", land);
    events.push({ type: "statsChanged" });
    return;
  }

  const p = panel(state, target.col, target.row);
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h * 0.34;

  // friendly prog: hitting it hurts — the anti-spam tax
  if (target.type === "ally") {
    target.state = "hit"; target.t0 = land;
    hitFx(target, tier, land);
    state.whiffs++;                        // accuracy and rank take the hit too
    breakChain(state, events, "prog", land);
    state.timeLeft = Math.max(0, state.timeLeft - C.ALLY_TIME_PENALTY);
    state.score = Math.max(0, state.score - C.ALLY_PTS_PENALTY);
    state.fx.popups.push({
      x: cx, y: p.y - 8, t0: land,
      text: "PROG HIT −" + C.ALLY_TIME_PENALTY.toFixed(1) + "s", color: "#ff5470",
    });
    spawnBits(state, cx, cy, C.BIT_COUNT.prog, C.DEBRIS.ally, { at: land, speed: 0.18 });
    ripple(state, target.col, target.row, "#ff5470", land, 3);
    shake(state, C.SHAKE.prog, land);
    hitStop(state, land, C.HITSTOP.prog);
    events.push({
      type: "progHit", tier: tierName, col: target.col, row: target.row, x: cx, y: p.y,
      timePenalty: C.ALLY_TIME_PENALTY, pointsPenalty: C.ALLY_PTS_PENALTY,
    });
    events.push({ type: "statsChanged" });
    return;
  }

  if (target.type === "guard" && tierName === "normal") {
    state.fx.sparks.push({ x: p.x + p.w * 0.28, y: p.y + p.h * 0.2, t0: land });
    state.fx.popups.push({ x: cx, y: p.y - 8, t0: land, text: "GUARD", color: "#8a96b8" });
    // a plink sprays back toward the player, not outward
    spawnBits(state, p.x + p.w * 0.28, cy, C.BIT_COUNT.block, C.DEBRIS.guard,
      { at: land, dir: Math.PI, spread: 0.7, speed: 0.16, ms: 320 });
    ripple(state, target.col, target.row, "#aeb9d6", land, 2);
    hitStop(state, land, C.HITSTOP.block);
    events.push({ type: "guardBlocked", col: target.col, row: target.row, x: cx, y: p.y });
    return;
  }

  // hopper stamina: a tap staggers it and it flees; charged shots kill outright
  if (target.type === "hopper" && tierName === "normal" && target.hp > 1) {
    target.hp--;
    state.fx.sparks.push({ x: cx, y: p.y + p.h * 0.2, t0: land });
    state.fx.popups.push({ x: cx, y: p.y - 8, t0: land, text: "1 more", color: "#5ee87c" });
    spawnBits(state, cx, cy, C.BIT_COUNT.stagger, C.DEBRIS.hopper,
      { at: land, speed: 0.17, ms: 340 });
    ripple(state, target.col, target.row, "#5ee87c", land, 2);
    hitStop(state, land, C.HITSTOP.stagger);
    events.push({
      type: "hopperStagger", col: target.col, row: target.row, x: cx, y: p.y, hp: target.hp,
    });
    hopTo(state, target, events);
    target.lastHop = now;
    return;                            // contact: chain neither breaks nor grows
  }

  // deletion
  target.state = "hit"; target.t0 = land;
  hitFx(target, tier, land);

  const multBefore = C.multOf(state.chain);
  state.chain++;
  if (state.chain > state.bestChain) state.bestChain = state.chain;
  const mult = C.multOf(state.chain);
  // a wave is "cleared" only when every virus in it was actually deleted
  if (state.wave && target.wave === state.wave.index) state.wave.kills++;

  const baseKey =
    target.type === "guard" ? "guard" :
    target.type === "hopper" ? "hopper" :
    target.type === "rare" ? "rare" : tierName;
  const pts = C.PTS[baseKey] * mult;
  state.score += pts;
  state.deletions++;

  const bf = C.bonusFactor(state.deletions);
  const factor = baseKey === "rare" ? Math.sqrt(bf) : bf;
  const timeBonus = C.BONUS[baseKey] * factor;
  state.timeLeft = Math.min(C.TIME_CAP, state.timeLeft + timeBonus);

  // The felt half of a delete: debris in the skin's own colours, a ring in the
  // struck panel, a kick on the whole screen and a freeze — all sized by what
  // died, so a rare is unmistakably an event and a mett is a satisfying tap.
  spawnBits(state, cx, cy, C.BIT_COUNT[baseKey], C.DEBRIS[target.type], {
    at: land,
    speed: baseKey === "rare" ? 0.4 : baseKey === "charged" ? 0.34 : 0.28,
    spread: 1.25,
  });
  ripple(state, target.col, target.row,
    baseKey === "rare" ? "#ffd23f" : baseKey === "guard" ? "#c9f6ff" : "#45e0e8",
    land, baseKey === "rare" ? 4 : 3);
  // the player's own panel answers a landed shot
  ripple(state, state.player.col, state.player.row, "#45e0e8", land, 1);
  shake(state, C.SHAKE[baseKey] || C.SHAKE.normal, land);
  hitStop(state, land, C.HITSTOP[baseKey] || C.HITSTOP.normal);

  events.push({
    type: "hit", tier: tierName, enemyType: target.type, baseKey,
    col: target.col, row: target.row, x: cx, y: p.y,
    points: pts, mult, chain: state.chain, timeBonus,
  });
  if (mult > multBefore) {
    events.push({ type: "multiplierUp", mult, chain: state.chain });
    // a real flourish at every multiplier step, not just a bigger number
    state.fx.flare = { t0: land, mult, x: cx, y: cy };
    shake(state, C.SHAKE.chain, land, mult / 2);
    hitStop(state, land, C.HITSTOP.chain);
    spawnBits(state, cx, cy, 6 + mult * 2, C.DEBRIS.rare,
      { at: land, speed: 0.34, spread: 2, ms: 640 });
  }

  state.fx.popups.push({
    x: cx, y: p.y - 8, t0: land,
    text: "+" + pts + (mult > 1 ? " ×" + mult : ""),
    color: baseKey === "rare" ? "#ffe08a" : baseKey === "guard" || mult > 1 ? "#45e0e8" : "#aab4ce",
  });
  state.fx.popups.push({
    x: cx, y: p.y + 12, t0: land + 60,
    text: "+" + timeBonus.toFixed(1) + "s",
    color: factor < 1 ? "#ff9f45" : "#ffd23f",
  });

  events.push({ type: "statsChanged" });
  // the stage gate is checked once per frame at the end of step(), not here:
  // a gate now needs a wave floor as well as a deletion floor, and either can
  // be the one that lands last.
}

// ---------- fx bookkeeping ----------
// Expiring popups and sparks used to happen inside the draw calls; it belongs
// to the simulation so a renderer can be a pure function of the state.

function cullFx(state) {
  const now = state.clock;
  const popups = state.fx.popups;
  for (let i = popups.length - 1; i >= 0; i--) {
    if (now - popups[i].t0 >= C.POPUP_MS) popups.splice(i, 1);
  }
  const sparks = state.fx.sparks;
  for (let i = sparks.length - 1; i >= 0; i--) {
    if (now - sparks[i].t0 >= C.SPARK_MS) sparks.splice(i, 1);
  }
  const bits = state.fx.bits;
  for (let i = bits.length - 1; i >= 0; i--) {
    if (now - bits[i].t0 >= bits[i].ms) bits.splice(i, 1);
  }
  const ripples = state.fx.ripples;
  for (let i = ripples.length - 1; i >= 0; i--) {
    if (now - ripples[i].t0 >= ripples[i].ms) ripples.splice(i, 1);
  }
}

/** Wipe every transient effect — a new run starts on a clean board. */
function clearFx(state) {
  const fx = state.fx;
  fx.popups.length = 0;
  fx.sparks.length = 0;
  fx.bits.length = 0;
  fx.ripples.length = 0;
  fx.hurtT0 = -1e9;
  fx.shake.t0 = -1e9; fx.shake.amp = 0; fx.shake.ms = 0;
  fx.flare.t0 = -1e9;
  fx.chainBreak.t0 = -1e9;
  fx.ghost.t0 = -1e9;
  fx.ray.t0 = -1e9;
  fx.muzzleT0 = -1e9;
  state.hitStopAt = -1e9;
  state.hitStopMs = 0;
}
