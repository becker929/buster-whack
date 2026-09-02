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
import { computeRank } from "./select.js";

const panel = (state, col, row) => C.panelRect(state.G, col, row);

// ---------- entry point ----------

export function step(state, dtMs, intents = {}) {
  const events = [];
  const actions = Array.isArray(intents) ? intents : intents.actions || [];
  const hold = Array.isArray(intents) ? null : intents.hold;

  for (const a of actions) applyIntent(state, a, events);

  if (state.mode === "playing" && !state.paused) {
    state.clock += dtMs;
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
  updateBolts(state, dtMs, events);
  cullFx(state);

  return events;
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
    case "startRun":     resetGame(state, events); break;
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
  const col = Math.max(0, Math.min(C.PCOLS - 1, state.player.col + dc));
  const row = Math.max(0, Math.min(C.ROWS - 1, state.player.row + dr));
  const moved = col !== state.player.col || row !== state.player.row;
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

function resetGame(state, events) {
  state.mode = "playing";
  state.paused = false;
  state.score = 0;
  state.deletions = 0;
  state.shots = 0; state.whiffs = 0;
  state.chain = 0; state.bestChain = 0;
  state.timeLeft = C.START_TIME;
  state.player.col = 1; state.player.row = 1;
  state.enemies.length = 0;
  state.nextSpawnAt = state.clock + 500;
  state.stageIdx = 0;
  state.fx.popups.length = 0;
  state.fx.sparks.length = 0;
  state.fx.hurtT0 = -1e9;
  state.bolts.length = 0;
  state.hurtUntil = -1e9;
  state.rank = null;
  events.push({ type: "runStarted" });
  events.push({ type: "statsChanged" });
}

function gameOver(state, events) {
  state.mode = "over";
  state.rank = computeRank(state);
  const newBest = state.score > state.best;
  if (newBest) state.best = state.score;
  state.enemies.length = 0;
  state.bolts.length = 0;
  state.charge.downAt = null; state.charge.full = false;
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

function enterInterlevel(state, events) {
  const stage = C.STAGES[state.stageIdx];
  const index = state.stageIdx;
  state.stageIdx++;
  state.mode = "interlevel";
  state.charge.downAt = null;
  state.charge.full = false;
  state.bolts.length = 0;   // don't resume the run into a bolt you can't see coming
  state.timeLeft = Math.min(C.TIME_CAP, state.timeLeft + C.STAGE_BONUS);
  events.push({
    type: "stageGate",
    stage,
    index,
    title: stage.title,
    desc: stage.desc,
    timeBonus: C.STAGE_BONUS,
  });
  events.push({ type: "statsChanged" });
}

function resumeFromInterlevel(state, events) {
  if (state.mode !== "interlevel") return;
  state.mode = "playing";
  state.nextSpawnAt = state.clock + 700;
  events.push({ type: "resumed" });
}

// ---------- enemy spawning + state machine ----------

function freePanels(state, excludeCol, excludeRow) {
  const occ = new Set(state.enemies.map((e) => e.col + "," + e.row));
  const out = [];
  for (let c = C.PCOLS; c < C.COLS; c++)
    for (let r = 0; r < C.ROWS; r++) {
      if (c === excludeCol && r === excludeRow) continue;
      if (!occ.has(c + "," + r)) out.push([c, r]);
    }
  return out;
}

function rollType(state, del) {
  const rare = C.rareChance(del, state.timeLeft);
  const g = C.guardChance(del), h = C.hopperChance(del), a = C.allyChance(del);
  const r = state.rng();
  if (r < rare) return "rare";
  if (r < rare + a) return "ally";
  if (r < rare + a + g) return "guard";
  if (r < rare + a + g + h) return "hopper";
  return "mett";
}

// Only metts and steel guards retaliate: hoppers already pressure you by
// fleeing, progs are friendly, and a rare's window is too short to chase
// under fire.
const canRetaliate = (type) => type === "mett" || type === "guard";

function lifeOf(state, e) {
  if (e.type === "hopper") return C.HOPPER_LIFE;
  if (e.type === "rare") return C.RARE_LIFE;
  const base = C.upMs(state.deletions);
  // an attacker sticks around long enough to actually follow through
  return e.willAttack ? Math.max(base, C.aimMs(state.deletions) + 300) : base;
}

function updateEnemies(state, events) {
  if (state.mode !== "playing" || state.paused) return;
  const now = state.clock;
  const mx = C.maxConcurrent(state.deletions);

  if (state.enemies.length < mx && now >= state.nextSpawnAt) {
    const free = freePanels(state);
    if (free.length) {
      const [c, r] = free[Math.floor(state.rng() * free.length)];
      const type = rollType(state, state.deletions);
      const willAttack = canRetaliate(type) && state.rng() < C.attackChance(state.deletions);
      state.enemies.push({
        col: c, row: r, type, state: "rising", t0: now,
        riseMs: type === "ally" ? C.ALLY_RISE_MS : C.RISE_MS,
        hp: type === "hopper" ? 2 : 1,
        lastHop: now, hopT0: -1e9,
        willAttack,
        fired: false,
      });
      state.nextSpawnAt = now + C.gapMs(state.deletions) + state.rng() * 200;
      const p = panel(state, c, r);
      events.push({
        type: "enemySpawned", enemyType: type, col: c, row: r, willAttack,
        x: p.x + p.w / 2, y: p.y,
      });
    }
  }

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
        if (e.type === "hopper" && now - e.lastHop >= C.HOP_MS) {
          hopTo(state, e, events);
          e.lastHop = now;
        }
        if (e.willAttack && !e.fired && t >= C.aimMs(state.deletions)) {
          fireBolt(state, e, events);
          e.fired = true;
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
  e.col = c; e.row = r;
  e.hopT0 = state.clock;
  const p = panel(state, c, r);
  events.push({ type: "hopperHop", col: c, row: r, x: p.x + p.w / 2, y: p.y });
}

// ---------- incoming fire ----------

function fireBolt(state, e, events) {
  const p = panel(state, e.col, e.row);
  state.bolts.push({
    row: e.row,
    x: p.x + p.w / 2,
    speed: state.G.pw / C.boltPanelMs(state.deletions),   // px per ms, travelling left
    heavy: e.type === "guard",
  });
  events.push({
    type: "enemyFired", enemyType: e.type, col: e.col, row: e.row,
    heavy: e.type === "guard", x: p.x + p.w / 2, y: p.y,
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
  const hitR = G.pw * 0.3;
  for (let i = state.bolts.length - 1; i >= 0; i--) {
    const b = state.bolts[i];
    b.x -= b.speed * dt;
    if (b.row === state.player.row && now >= state.hurtUntil && Math.abs(b.x - px) <= hitR) {
      state.bolts.splice(i, 1);
      takeHit(state, events);
      continue;
    }
    if (b.x < G.gx - G.pw * 0.5) state.bolts.splice(i, 1);
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
  events.push({
    type: "playerHit", col: state.player.col, row: state.player.row,
    x: p.x + p.w / 2, y: p.y, timePenalty: C.HIT_TIME_PENALTY,
  });
  events.push({ type: "statsChanged" });
  // the clock running out is the frame loop's call, same as any other drain
}

function breakChain(state, events, cause) {
  const chain = state.chain;
  state.chain = 0;
  if (chain > 0) events.push({ type: "chainBroken", chain, cause });
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
    if (!target || e.col < target.col) target = e;
  }

  // bullet path: from the buster's muzzle to the first target (or the right edge)
  const pr = panel(state, state.player.col, row);
  const bwP = G.pw * 0.34;
  const x0 = pr.x + pr.w / 2 + bwP / 2 + bwP * 0.55;
  const x1 = target ? panel(state, target.col, row).x + G.pw / 2 : G.gx + G.pw * C.COLS;
  // hitscan logic stays instant; the tracer just travels fast (~5 px/ms)
  const dur = Math.max(40, Math.min(95, (x1 - x0) / 5));
  state.fx.ray = { t0: now, row, hitCol: target ? target.col : null, x0, x1, dur, tier: tierName };

  events.push({
    type: "shot", tier: tierName, row, x: x0, y: C.laneY(G, row),
    hit: !!target, targetType: target ? target.type : null,
  });

  if (!target) {
    state.whiffs++;
    if (state.chain >= 5) {
      const pp = panel(state, state.player.col, state.player.row);
      state.fx.popups.push({
        x: pp.x + pp.w / 2, y: pp.y - 14, t0: now, text: "chain broken", color: "#5f6b8c",
      });
    }
    events.push({ type: "whiff", tier: tierName, row, x: x1, y: C.laneY(G, row) });
    breakChain(state, events, "whiff");
    events.push({ type: "statsChanged" });
    return;
  }

  const p = panel(state, target.col, target.row);
  const cx = p.x + p.w / 2;

  // friendly prog: hitting it hurts — the anti-spam tax
  if (target.type === "ally") {
    target.state = "hit"; target.t0 = now;
    hitFx(target, tier, now);
    state.whiffs++;                        // accuracy and rank take the hit too
    breakChain(state, events, "prog");
    state.timeLeft = Math.max(0, state.timeLeft - C.ALLY_TIME_PENALTY);
    state.score = Math.max(0, state.score - C.ALLY_PTS_PENALTY);
    state.fx.popups.push({
      x: cx, y: p.y - 8, t0: now,
      text: "PROG HIT −" + C.ALLY_TIME_PENALTY.toFixed(1) + "s", color: "#ff5470",
    });
    events.push({
      type: "progHit", tier: tierName, col: target.col, row: target.row, x: cx, y: p.y,
      timePenalty: C.ALLY_TIME_PENALTY, pointsPenalty: C.ALLY_PTS_PENALTY,
    });
    events.push({ type: "statsChanged" });
    return;
  }

  if (target.type === "guard" && tierName === "normal") {
    state.fx.sparks.push({ x: p.x + p.w * 0.28, y: p.y + p.h * 0.2, t0: now });
    state.fx.popups.push({ x: cx, y: p.y - 8, t0: now, text: "GUARD", color: "#8a96b8" });
    events.push({ type: "guardBlocked", col: target.col, row: target.row, x: cx, y: p.y });
    return;
  }

  // hopper stamina: a tap staggers it and it flees; charged shots kill outright
  if (target.type === "hopper" && tierName === "normal" && target.hp > 1) {
    target.hp--;
    state.fx.sparks.push({ x: cx, y: p.y + p.h * 0.2, t0: now });
    state.fx.popups.push({ x: cx, y: p.y - 8, t0: now, text: "1 more", color: "#5ee87c" });
    events.push({
      type: "hopperStagger", col: target.col, row: target.row, x: cx, y: p.y, hp: target.hp,
    });
    hopTo(state, target, events);
    target.lastHop = now;
    return;                            // contact: chain neither breaks nor grows
  }

  // deletion
  target.state = "hit"; target.t0 = now;
  hitFx(target, tier, now);

  const multBefore = C.multOf(state.chain);
  state.chain++;
  if (state.chain > state.bestChain) state.bestChain = state.chain;
  const mult = C.multOf(state.chain);

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

  events.push({
    type: "hit", tier: tierName, enemyType: target.type, baseKey,
    col: target.col, row: target.row, x: cx, y: p.y,
    points: pts, mult, chain: state.chain, timeBonus,
  });
  if (mult > multBefore) events.push({ type: "multiplierUp", mult, chain: state.chain });

  state.fx.popups.push({
    x: cx, y: p.y - 8, t0: now,
    text: "+" + pts + (mult > 1 ? " ×" + mult : ""),
    color: baseKey === "rare" ? "#ffe08a" : baseKey === "guard" || mult > 1 ? "#45e0e8" : "#aab4ce",
  });
  state.fx.popups.push({
    x: cx, y: p.y + 12, t0: now + 60,
    text: "+" + timeBonus.toFixed(1) + "s",
    color: factor < 1 ? "#ff9f45" : "#ffd23f",
  });

  events.push({ type: "statsChanged" });

  if (state.stageIdx < C.STAGES.length && state.deletions >= C.STAGES[state.stageIdx].at) {
    enterInterlevel(state, events);
  }
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
}
