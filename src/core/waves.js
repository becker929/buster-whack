/*!
 * Waves and viruses: composing a wave, dealing an arena's pool, spawning,
 * the up-state (aim, hop, re-arm), and the wave ending into a lull or a
 * taken arena.
 */

import * as C from "./constants.js";
import { activeArena, clearArena } from "./world.js";
import { panel } from "./fx.js";
import { updateBombs } from "./combat.js";
import { updateWorld } from "./flow.js";
import { enemyDef, hpOf, riseMsOf, shotsOf, inBoard, canRetaliate } from "./enemies.js";
import { bumpTask } from "./tasks-count.js";

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

/** Is this run walking a road? The road has its own pulse economy. */
export const advancingMode = (state) => !!C.modeById(state.modeId).advancing;

export function freePanels(state, excludeCol, excludeRow) {
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
export function freeSlot(state, planned) {
  const taken = new Set(planned.map((s) => s.col + "," + s.row));
  const free = freePanels(state).filter(([c, r]) => !taken.has(c + "," + r));
  if (!free.length) return null;
  const [col, row] = free[Math.floor(state.rng() * free.length)];
  return { col, row };
}

// Which types can be armed at all is a column of the enemy table now: see
// enemies.js, where each row says why.
export { canRetaliate };

/**
 * Is a mechanic available yet? Classic answers from the stage syllabus (wave
 * and deletion floors); advance answers from the arena you are in, so a
 * hundred-arena road can hand things out on its own schedule.
 */
export function unlocked(state, key) {
  const mode = C.modeById(state.modeId);
  if (mode.advancing) {
    const at = state.tuning.unlockTable(mode)[key];
    return at !== undefined && activeArena(state.world).idx >= at;
  }
  return state.stageIdx >= (C.UNLOCK[key] === undefined ? Infinity : C.UNLOCK[key]);
}

/** Highest Sentinel mark the current arena has unlocked, or 0. */
export function sentinelMark(state) {
  if (unlocked(state, "sentinel3")) return 3;
  if (unlocked(state, "sentinel2")) return 2;
  if (unlocked(state, "sentinel1")) return 1;
  return 0;
}

/**
 * Author one formation. Rows are rotated by the rng so six shapes read as many
 * more, and the arrival order is the formation's own — a wave lands, it does
 * not blink into existence.
 */
export function planWave(state) {
  const now = state.clock;
  const idx = state.waveIdx;
  const stage = state.stageIdx;
  let size = C.waveSize(stage);
  const form = C.FORMATIONS[Math.floor(state.rng() * C.FORMATIONS.length)];
  const rot = Math.floor(state.rng() * C.ROWS);
  const stagger = state.tuning.waveStaggerMs(idx);

  // formations are authored against the origin arena; shift them to this one
  const arena = activeArena(state.world);
  const ax0 = arena.x0;
  const advancing = C.modeById(state.modeId).advancing;
  if (advancing) {
    // deal from the pool: as many as join at once, never more than remain
    size = Math.min(arena.waveSize, arena.pool - arena.dealt, state.tuning.MAX_ALIVE);
    arena.dealt += size;
  }
  // The composition chances below were written against the classic syllabus,
  // where `stage` climbs 0..8 over a run. In advance stageIdx never moves, so
  // fed straight in it would keep hoppers at ~3% forever. Map the road onto the
  // same 0..8 scale instead: eight arenas per classic stage.
  const chanceStage = advancing ? Math.min(C.STAGES.length, Math.floor(arena.idx / 8)) : stage;
  const slots = [];
  for (let i = 0; i < size; i++) {
    const [col, row] = form.slots[i];
    slots.push({ col: col + ax0, row: (row + rot) % C.ROWS, type: "mett", at: now + i * stagger,
                 persistent: advancing, tier: 0 });
  }

  // the heavy: one armored anchor the wave forms around
  if (unlocked(state, "guard") && form.anchor < slots.length &&
      state.rng() < state.tuning.guardWaveChance(chanceStage - C.UNLOCK.guard)) {
    slots[form.anchor].type = "guard";
  }

  // hoppers: one, or two once formations are big
  if (unlocked(state, "hopper")) {
    const wanted = size >= 4 && state.rng() < 0.35 ? 2 : 1;
    for (let k = 0; k < wanted; k++) {
      if (state.rng() >= state.tuning.hopperWaveChance(chanceStage - C.UNLOCK.hopper)) continue;
      const plain = slots.filter((s) => s.type === "mett");
      if (!plain.length) break;
      plain[Math.floor(state.rng() * plain.length)].type = "hopper";
    }
  }

  // a prog tags along as an extra body: the wave is still clearable without
  // shooting it, which is the whole point of the hold-fire test
  // the sentinel: one per wave once unlocked, at the arena's mark -- with a
  // lower mark now and then so the older ones stay in the mix
  const mark = advancing ? sentinelMark(state) : 0;
  if (mark && state.rng() < state.tuning.sentinelWaveChance(arena.idx - state.tuning.ADV_UNLOCK.sentinel1)) {
    const plain = slots.filter((s) => s.type === "mett");
    if (plain.length) {
      const pick = plain[Math.floor(state.rng() * plain.length)];
      pick.type = "sentinel";
      pick.tier = mark > 1 && state.rng() < 0.35 ? mark - 1 : mark;
    }
  }

  // The later rot and static: each replaces one plain slot, in the order the
  // road teaches them. `unlocked` short-circuits before the roll, so a run
  // that has not reached them draws exactly the numbers it always did.
  for (const [key, chance] of [
    ["spreader", "spreaderWaveChance"],
    ["darter", "darterWaveChance"],
    ["warden", "wardenWaveChance"],
  ]) {
    if (!unlocked(state, key)) continue;
    const at = state.tuning.unlockTable(C.modeById(state.modeId))[key];
    if (state.rng() >= state.tuning[chance](arena.idx - at)) continue;
    const plain = slots.filter((sl) => sl.type === "mett");
    if (!plain.length) continue;
    plain[Math.floor(state.rng() * plain.length)].type = key;
  }

  if (unlocked(state, "ally") && state.rng() < state.tuning.allyWaveChance(chanceStage - C.UNLOCK.ally)) {
    const spot = freeSlot(state, slots);
    if (spot) slots.push({ ...spot, type: "ally", at: now + slots.length * stagger });
  }

  // the jackpot leads the wave in, alone on the first beat, because it is only
  // up for RARE_LIFE and has to be seen the instant it arrives
  if (!advancing && unlocked(state, "rare") && state.rng() < state.tuning.rareWaveChance(stage - C.UNLOCK.rare, state.timeLeft)) {
    const spot = freeSlot(state, slots);
    if (spot) {
      for (const s of slots) s.at += state.tuning.RARE_LIFE * 0.5;
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
    deadline: now + slots.length * stagger + state.tuning.HOPPER_LIFE + state.tuning.WAVE_GRACE_MS,
    queue: slots,
  };
}

export function startWave(state, events) {
  const wave = planWave(state);
  state.waveIdx++;
  state.wave = wave;
  state.waveState = "active";
  events.push({
    type: "waveStart", index: wave.index, size: wave.size,
    virusCount: wave.virusCount, formation: wave.formation,
  });
}

export function spawnFromSlot(state, slot, events) {
  const now = state.clock;
  const type = slot.type;
  const boltKind = C.boltKindFor(type);
  const armed = unlocked(state, "retaliate") && canRetaliate(type);
  const tier = slot.tier || 0;
  // a sentinel's open window is its telegraph; the closed spell is its reload
  const sent = type === "sentinel" ? state.tuning.SENTINEL[tier] || state.tuning.SENTINEL[1] : null;
  // a persistent virus that never shot would be a target dummy: once
  // retaliation is unlocked, every pool virus that can shoot, does
  const willAttack = slot.persistent ? armed : armed && state.rng() < state.tuning.attackChance(state.deletions, type);
  state.enemies.push({
    col: slot.col, row: slot.row, type, state: "rising", t0: now,
    persistent: !!slot.persistent,
    refireAt: Infinity,
    riseMs: riseMsOf(state.tuning, type),
    hp: sent ? sent.hp : hpOf(state.tuning, type),
    tier,
    lastHop: now, hopT0: -1e9,
    wave: state.wave ? state.wave.index : -1,
    willAttack,
    // baked at spawn so the telegraph a virus is drawing cannot change length
    // underneath it when the deletion count ticks over mid-aim
    boltKind,
    aimMs: sent ? sent.openMs : state.tuning.aimMs(state.deletions, boltKind),
    fired: false,
  });
  const p = panel(state, slot.col, slot.row);
  events.push({
    type: "enemySpawned", enemyType: type, col: slot.col, row: slot.row, willAttack,
    boltKind: willAttack ? boltKind : null,
    x: p.x + p.w / 2, y: p.y,
  });
}

export function endWave(state, events) {
  const wave = state.wave;
  const now = state.clock;
  const cleared = wave.virusCount > 0 && wave.kills >= wave.virusCount;

  let lull = state.tuning.waveLullMs(wave.index, state.stageIdx >= C.LULL_TIGHTEN_STAGE);
  if (cleared) lull *= state.tuning.WAVE_CLEAR_LULL;      // clearing it buys pressure back
  // a lull must never be the thing that kills you: with the clock this low the
  // player needs targets, not air
  if (state.timeLeft < state.tuning.LOW_TIME) lull = Math.min(lull, state.tuning.LOW_TIME_LULL_MS);
  lull = Math.round(lull);

  let timeBonus = 0, points = 0;
  if (cleared) bumpTask(state, "waveCleared");
  if (cleared) {
    timeBonus = state.tuning.waveClearBonus(wave.virusCount) * state.tuning.pulseScale(state.deletions, advancingMode(state));
    state.timeLeft = Math.min(state.tuning.TIME_CAP, state.timeLeft + timeBonus);
    points = state.tuning.WAVE_CLEAR_PTS * wave.virusCount * C.multOf(state.chain);
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
    const guard = activeArena(state.world);
    if (guard.dealt < guard.pool) {
      // the pool is not spent: the next wave joins after a beat
      state.nextSpawnAt = now + state.tuning.ARENA_WAVE_GAP_MS;
      events.push({
        type: "waveEnded", index: wave.index, size: wave.size,
        virusCount: wave.virusCount, kills: wave.kills, cleared,
        timeBonus: 0, points: 0, lullMs: state.tuning.ARENA_WAVE_GAP_MS,
      });
      return;
    }
    // The arena is yours. The next one wakes only when you step into it, so
    // the walk is a true lull -- the road is the breath between fights.
    // in the story a tower stands before every TOWER_EVERY-th arena, the next
    // roost on the route, so the people arrive on a schedule you can feel
    const story = !!C.modeById(state.modeId).story;
    const roost = story && (guard.idx + 1) % state.tuning.TOWER_EVERY === 0 ? C.STORY_ROUTE[state.routeIdx] : null;
    const { cleared: a, road, tower, next } = clearArena(state.world, state.rng, { tower: roost || undefined, tuning: state.tuning });
    if (tower) state.routeIdx++;
    state.arenasCleared++;
    bumpTask(state, "arenaTaken");
    // a bomb on the road: always on the first one so it is found, often after
    if (a.idx === 0 || state.rng() < state.tuning.BOMB_PICKUP_CHANCE) {
      const pc = road.x0 + Math.floor(state.rng() * road.cols);
      const pr = road.rows === 1 ? C.ROAD_MID_ROW : Math.floor(state.rng() * C.ROWS);
      state.pickups.push({ col: pc, row: pr, kind: "bomb" });
      const pp = panel(state, pc, pr);
      events.push({ type: "pickupSpawned", kind: "bomb", col: pc, row: pr, x: pp.x + pp.w / 2, y: pp.y });
    }
 // Taking an arena pays like everything else pays: through the overclock.
    // Undecayed it was the road's whole income, and the pulse bar sat pinned
    // at its cap for the first thirty arenas -- a clock that is always full
    // is not a clock.
    const arenaBonus = state.tuning.ARENA_CLEAR_BONUS * state.tuning.pulseScale(state.deletions, advancingMode(state));
    state.timeLeft = Math.min(state.tuning.TIME_CAP, state.timeLeft + arenaBonus);
    state.score += state.tuning.ARENA_CLEAR_PTS;
    state.nextSpawnAt = Infinity;
    events.push({
      type: "arenaCleared", index: a.idx, x0: a.x0,
      roadRows: road.rows, nextX0: next.x0,
      timeBonus: arenaBonus, points: state.tuning.ARENA_CLEAR_PTS,
    });
  }

  events.push({
    type: "waveEnded", index: wave.index, size: wave.size,
    virusCount: wave.virusCount, kills: wave.kills, cleared,
    timeBonus, points, lullMs: lull,
  });
  if (cleared) events.push({ type: "statsChanged" });
}

export function updateWave(state, events) {
  const now = state.clock;
  updateWorld(state, events);
  updateBombs(state, events);
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
    if (busy || state.enemies.length >= state.tuning.MAX_ALIVE) {
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

export function lifeOf(state, e) {
  if (e.persistent) return Infinity;   // stays until deleted; the road depends on it
  const lifeKey = enemyDef(e.type).lifeKey;
  const base = lifeKey ? state.tuning[lifeKey] : state.tuning.upMs(state.deletions);
  if (e.type === "rare") return base;
  if (!e.willAttack) return base;
  // an attacker sticks around long enough to actually follow through
  return Math.max(base, aimOf(state, e) + state.tuning.ATTACK_FOLLOW_MS);
}

export const aimOf = (state, e) =>
  e.aimMs === undefined
    ? state.tuning.aimMs(state.deletions, e.boltKind || C.boltKindFor(e.type))
    : e.aimMs;

export function updateEnemies(state, events) {
  if (state.mode !== "playing" || state.paused) return;
  const now = state.clock;

  updateWave(state, events);

  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    const t = now - e.t0;
    if (e.pending) updatePending(state, e, events);
    switch (e.state) {
      case "rising":
        if (t >= (e.riseMs || state.tuning.RISE_MS)) {
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
        // a persistent attacker is not a one-shot: after a cooldown it draws
        // a fresh telegraph, so a wave that stays on the board keeps pressing.
        // `break` here, because `t` was measured against the old t0 and would
        // otherwise fire the new telegraph on this very frame.
        if ((e.persistent || e.type === "sentinel") && e.fired && now >= e.refireAt) {
          e.fired = false;
          e.t0 = now;
          events.push({ type: "enemyAim", col: e.col, row: e.row, boltKind: e.boltKind });
          break;
        }
        const aiming = e.willAttack && !e.fired;
        // the green hopper hops; the yellow mett, as a low-level hopper, hops
        // too but at a third of the pace -- and only while it holds a road,
        // so classic's metts are untouched
        const def = enemyDef(e.type);
        const hopEvery = !def.hopKey || (def.hopWhenHeld && !e.persistent)
          ? Infinity : state.tuning[def.hopKey];
        if (!aiming && now - e.lastHop >= hopEvery) {
          hopTo(state, e, events);
          e.lastHop = now;
        }
        if (aiming && t >= aimOf(state, e)) {
          fireBolt(state, e, events);
          e.fired = true;
          e.refireAt = now + (e.type === "sentinel"
            ? (state.tuning.SENTINEL[e.tier] || state.tuning.SENTINEL[1]).closedMs : state.tuning.REFIRE_MS);
          // the hop clock is deliberately NOT reset here: shoot, then scoot.
          // A reset starved the mett -- its hop interval is longer than its
          // reload, so an armed mett could never accumulate the idle time.
        }
        if (t >= lifeOf(state, e)) { e.state = "sinking"; e.t0 = now; }
        break;
      }
      case "sinking":
        if (t >= state.tuning.SINK_MS) {
          // an untouched prog reaching cover is worth a little time
          if (e.type === "ally") {
            state.timeLeft = Math.min(state.tuning.TIME_CAP, state.timeLeft + state.tuning.ALLY_SPARE_BONUS);
            const p = panel(state, e.col, e.row);
            state.fx.popups.push({
              x: p.x + p.w / 2, y: p.y, t0: now,
              text: "spared +" + state.tuning.ALLY_SPARE_BONUS.toFixed(1) + "s", color: "#58c7ff",
            });
            bumpTask(state, "spared");
            events.push({
              type: "allySpared", col: e.col, row: e.row,
              x: p.x + p.w / 2, y: p.y, timeBonus: state.tuning.ALLY_SPARE_BONUS,
            });
          }
          events.push({ type: "enemyEscaped", enemyType: e.type, col: e.col, row: e.row });
          state.enemies.splice(i, 1);
        }
        break;
      case "hit":
        if (t >= state.tuning.HIT_MS) state.enemies.splice(i, 1);
        break;
    }
  }
}

export function hopTo(state, e, events) {
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
 * Incoming fire. Two bolt kinds, and the difference is the mechanic:
 *
 *   slow — the mett's siege shell. Huge and lumbering; you can still leave the
 *          row after it launches.
 *   fast — the hopper's. Crosses the board in a blink, so it has to be dodged
 *          during the telegraph — which is why the hopper's aim is the longest
 *          window in the game.
 *
 * What a virus throws with them is its attack (see enemies.js): one bolt down
 * its own lane, a fan across three, a two-shot volley, or a slow fat wall. A
 * shot with a delay is held on the firer and released later, so a volley dies
 * with the thing that started it.
 *
 * The bolt carries everything the renderer needs as data: `kind` for the look,
 * `radius` in px (already scaled to the board) for the size, `speed` in px/ms.
 * `heavy` is kept as a legacy alias for the slow bolt so an older shell (and
 * the audio bank, which keys its bass layer off it) still reads correctly.
 */
export function launchBolt(state, e, shot, events) {
  const row = e.row + shot.dRow;
  if (!inBoard(row)) return;
  const p = panel(state, e.col, row);
  const kind = e.boltKind || C.boltKindFor(e.type);
  state.bolts.push({
    row,
    x: p.x + p.w / 2,
    // px per ms, travelling left
    speed: (state.G.pw / state.tuning.boltPanelMs(state.deletions, kind)) * shot.speedFactor,
    kind,
    radius: state.G.pw * state.tuning.BOLT[kind].radiusFrac * shot.radiusFactor,
    heavy: kind === "slow",
  });
  events.push({
    type: "enemyFired", enemyType: e.type, col: e.col, row,
    kind, heavy: kind === "slow", x: p.x + p.w / 2, y: p.y,
  });
}

/** Fire a virus's whole attack: the shots due now, the rest held on it. */
export function fireBolt(state, e, events) {
  const shots = shotsOf(state.tuning, e.type);
  const now = state.clock;
  for (const shot of shots) {
    if (shot.delay > 0) (e.pending || (e.pending = [])).push({ at: now + shot.delay, shot });
    else launchBolt(state, e, shot, events);
  }
}

/** Release the held shots of a volley whose beat has come. */
export function updatePending(state, e, events) {
  const q = e.pending;
  if (!q || !q.length) return;
  const now = state.clock;
  for (let i = 0; i < q.length; ) {
    if (q[i].at > now) { i++; continue; }
    launchBolt(state, e, q[i].shot, events);
    q.splice(i, 1);
  }
}
