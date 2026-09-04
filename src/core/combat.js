/*!
 * Combat: the buster shot, bolts in flight, the bomb, damage to viruses and
 * to the player, and the chain.
 */

import * as C from "./constants.js";
import { activeArena, npcBeside } from "./world.js";
import { panel, hitStop, shake, spawnBits, ripple } from "./fx.js";
import { land } from "./movement.js";
import { hopTo, fireBolt, spawnFromSlot } from "./waves.js";
import { enemyDef } from "./enemies.js";
import { bumpTask } from "./tasks-count.js";
import { taskExchange } from "./tasks.js";
import { itemDef, topOf, takeTop, syncStash } from "./items.js";

// dt rather than the clock: bolts move in real time, and the early return
// freezes them for pause and the interlevel card alike.
export function updateBolts(state, dt, events) {
  if (state.mode !== "playing" || state.paused) return;
  const now = state.clock;
  const G = state.G;
  const pr = panel(state, state.player.col, state.player.row);
  const px = pr.x + pr.w / 2;
  const hitR = G.pw * state.tuning.BOLT_HIT_R;
  for (let i = state.bolts.length - 1; i >= 0; i--) {
    const b = state.bolts[i];
    b.x -= b.speed * dt;
    if (b.row === state.player.row && now >= state.hurtUntil && Math.abs(b.x - px) <= hitR) {
      // a cloak: it goes straight through, and nothing is aimed at you either
      if (now < (state.cloakUntil || 0)) continue;
      state.bolts.splice(i, 1);
      // a parry set by the spell shard: this one, and only this one, does not land
      if (state.parry) {
        state.parry = false;
        ripple(state, state.player.col, state.player.row, "#c9f6ff", now, 2);
        state.fx.popups.push({ x: px, y: pr.y - 8, t0: now, text: "PARRIED", color: "#c9f6ff" });
        events.push({ type: "parried", col: state.player.col, row: state.player.row, x: px, y: pr.y });
        events.push({ type: "statsChanged" });
        continue;
      }
      takeHit(state, events);
      continue;
    }
    if (b.x < G.gx + (activeArena(state.world).x0 - 0.5) * G.pw) state.bolts.splice(i, 1);
  }
}

/**
 * Lob a bomb BOMB_RANGE columns ahead along your row. It is ordnance, not a
 * shot: no charge, no hitscan, one per pickup.
 */
/**
 * The context button. Beside a keeper it is TALK; anywhere else it uses the
 * top of the stash -- the last thing you picked up, which is the one the HUD
 * shows on top. The core records the press and who it was to; the shell turns
 * that into a line from the sealed canon, so no text ever lives here.
 */
export function contextAction(state, events) {
  if (state.mode !== "playing" || state.paused) return;
  const n = npcBeside(state.world, state.player.col, state.player.row);
  if (!n) { useTop(state, events); return; }
  state.talks[n.id] = (state.talks[n.id] || 0) + 1;
  const p = panel(state, n.col, n.row);
  ripple(state, n.col, n.row, "#ffd23f", state.clock, 1);
  events.push({ type: "talk", npc: n.id, verb: n.verb || "talk", count: state.talks[n.id], col: n.col, row: n.row,
                x: p.x + p.w / 2, y: p.y });
  // and the task half of the same conversation: paid out, asked for, or none
  taskExchange(state, n.id, events);
}

/**
 * Use the top of the stash. Each item names one effect from the vocabulary
 * in items.js; this is where the vocabulary is spoken.
 */
export function useTop(state, events) {
  if (state.mode !== "playing" || state.paused) return;
  const id = topOf(state.stash);
  // an empty stash is told, so a press that does nothing is never a mystery
  if (!id) { events.push({ type: "bombEmpty" }); return; }
  const def = itemDef(id);
  if (!def) { takeTop(state.stash); syncStash(state); return; }
  if (def.effect === "blast") { throwBomb(state, events); return; }

  takeTop(state.stash);
  syncStash(state);
  const now = state.clock;
  const p = panel(state, state.player.col, state.player.row);
  const pop = (text, color) => state.fx.popups.push({ x: p.x + p.w / 2, y: p.y - 8, t0: now, text, color });

  switch (def.effect) {
    case "parry":
      // the next bolt that would land on you does not
      state.parry = true;
      pop("PARRY SET", "#c9f6ff");
      break;
    case "cloak":
      // nothing aims at you while it holds, and what is already in the air
      // passes straight through
      state.cloakUntil = now + def.arg;
      pop("CLOAK", "#a9defc");
      break;
    case "provoke": {
      // everything armed on the board fires this instant: the board empties
      // its telegraphs at once, and then has to reload
      let n = 0;
      for (const e of state.enemies) {
        if (!e.willAttack || e.fired || e.state !== "up") continue;
        fireBolt(state, e, events);
        e.fired = true;
        e.refireAt = now + state.tuning.REFIRE_MS;
        n++;
      }
      pop("BELL ×" + n, "#ffd23f");
      break;
    }
    case "summon":
      // one more thing to shoot, and one more thing shooting: the shard is
      // worth taking when the clock is the thing hurting you
      summonOne(state, def.arg, events);
      pop("SUMMONED", "#5ee87c");
      break;
    case "echo":
      // your last shot, taken again, for a share of what it was worth
      if (state.lastShotTier) {
        state.echo = { tier: state.lastShotTier, share: def.arg };
        shoot(state, state.lastShotTier, events);
        state.echo = null;
        pop("ECHO", "#45e0e8");
      } else {
        pop("NOTHING TO ECHO", "#8a96b8");
      }
      break;
    default: break;
  }
  events.push({ type: "itemUsed", item: def.id, effect: def.effect, stash: state.stash.slice() });
  events.push({ type: "statsChanged" });
}

/** Put one virus of a named type into the player's row, if there is room. */
function summonOne(state, type, events) {
  if (state.enemies.length >= state.tuning.MAX_ALIVE) return;
  const a = activeArena(state.world);
  if (a.owner !== "enemy") return;
  for (let col = a.x0 + a.cols - 1; col > state.player.col; col--) {
    if (state.enemies.some((e) => e.col === col && e.row === state.player.row)) continue;
    spawnFromSlot(state, { col, row: state.player.row, type, persistent: true, tier: 0 }, events);
    return;
  }
}

export function throwBomb(state, events) {
  if (state.mode !== "playing" || state.paused) return;
  if (state.bombs <= 0) { events.push({ type: "bombEmpty" }); return; }
  const now = state.clock;
  const a = activeArena(state.world);
  const toCol = Math.min(state.player.col + state.tuning.BOMB_RANGE, a.x0 + a.cols - 1);
  // the bomb leaves the stash from wherever it is: the top, if that is a bomb
  const at = state.stash.lastIndexOf("bomb");
  if (at >= 0) state.stash.splice(at, 1);
  syncStash(state);
  state.bombsInFlight.push({
    fromCol: state.player.col, fromRow: state.player.row,
    toCol, toRow: state.player.row, t0: now, dur: state.tuning.BOMB_ARC_MS,
  });
  const p = panel(state, state.player.col, state.player.row);
  events.push({ type: "bombThrown", col: state.player.col, row: state.player.row,
                toCol, x: p.x + p.w / 2, y: p.y, bombs: state.bombs });
  events.push({ type: "statsChanged" });
}

/** Bombs in the air land; a landed bomb splashes a 3x3 and hurts whoever is in it. */
export function updateBombs(state, events) {
  const now = state.clock;
  for (let i = state.bombsInFlight.length - 1; i >= 0; i--) {
    const b = state.bombsInFlight[i];
    if (now < b.t0 + b.dur) continue;
    state.bombsInFlight.splice(i, 1);
    detonate(state, b.toCol, b.toRow, events);
  }
  const bl = state.fx.blasts;
  for (let i = bl.length - 1; i >= 0; i--) if (now - bl[i].t0 > state.tuning.BOMB_BLAST_MS) bl.splice(i, 1);
}

export function detonate(state, col, row, events) {
  const now = state.clock;
  const R = state.tuning.BOMB_RADIUS;
  const p = panel(state, col, row);
  const cx = p.x + p.w / 2, cy = p.y + p.h * 0.5;
  let kills = 0;
  for (const e of state.enemies.slice()) {
    if (Math.abs(e.col - col) > R || Math.abs(e.row - row) > R) continue;
    if (!(e.state === "rising" || e.state === "up" || e.state === "sinking")) continue;
    if (e.type === "ally") {
      e.state = "hit"; e.t0 = now;
      hitFx(e, C.TIERS.charged, now);
      state.whiffs++;
      breakChain(state, events, "prog");
      state.timeLeft = Math.max(0, state.timeLeft - state.tuning.ALLY_TIME_PENALTY);
      state.score = Math.max(0, state.score - state.tuning.ALLY_PTS_PENALTY);
      const ep = panel(state, e.col, e.row);
      state.fx.popups.push({ x: ep.x + ep.w / 2, y: ep.y - 8, t0: now,
        text: "PROG HIT \u2212" + state.tuning.ALLY_TIME_PENALTY.toFixed(1) + "s", color: "#ff5470" });
      events.push({ type: "progHit", tier: "charged", col: e.col, row: e.row,
        x: ep.x + ep.w / 2, y: ep.y, timePenalty: state.tuning.ALLY_TIME_PENALTY, pointsPenalty: state.tuning.ALLY_PTS_PENALTY });
      continue;
    }
    if (e.type === "sentinel") {
      const open = e.willAttack ? !e.fired : true;
      if (!open) continue;
      if (e.hp > state.tuning.SENTINEL_CHARGED_DMG) {
        e.hp -= state.tuning.SENTINEL_CHARGED_DMG;
        const ep = panel(state, e.col, e.row);
        events.push({ type: "sentinelHit", col: e.col, row: e.row, x: ep.x + ep.w / 2, y: ep.y, hp: e.hp });
        continue;
      }
    }
    deleteEnemy(state, e, "charged", now, events);
    kills++;
  }
  if (Math.abs(state.player.col - col) <= R && Math.abs(state.player.row - row) <= R &&
      now >= state.hurtUntil) {
    takeHit(state, events);
  }
  for (let dc = -R; dc <= R; dc++) for (let dr = -R; dr <= R; dr++) {
    const r = row + dr;
    if (r < 0 || r >= C.ROWS) continue;
    ripple(state, col + dc, r, "#ff9f45", now, dc === 0 && dr === 0 ? 4 : 2);
  }
  spawnBits(state, cx, cy, 28, C.DEBRIS.rare, { at: now, speed: 0.42, spread: 2.2, ms: 620 });
  shake(state, C.SHAKE.rare || C.SHAKE.normal, now, 1.3);
  hitStop(state, now, C.HITSTOP.rare || C.HITSTOP.normal);
  state.fx.blasts.push({ col, row, x: cx, y: cy, t0: now });
  events.push({ type: "bombBlast", col, row, x: cx, y: cy, kills });
}

export function takeHit(state, events) {
  const now = state.clock;
  state.hurtUntil = now + state.tuning.HIT_IFRAME_MS;
  state.fx.hurtT0 = now;
  state.timeLeft = Math.max(0, state.timeLeft - state.tuning.HIT_TIME_PENALTY);
  breakChain(state, events, "hurt");
  state.charge.downAt = null; state.charge.full = false;   // a hit spills your charge
  state.path = null;                                        // and stops an auto-walk: the world spoke
  const p = panel(state, state.player.col, state.player.row);
  state.fx.popups.push({
    x: p.x + p.w / 2, y: p.y - 8, t0: now,
    text: "HIT −" + state.tuning.HIT_TIME_PENALTY.toFixed(1) + "s", color: "#ff5470",
  });
  state.fx.sparks.push({ x: p.x + p.w / 2, y: p.y + p.h * 0.3, t0: now });
  spawnBits(state, p.x + p.w / 2, p.y + p.h * 0.4, C.BIT_COUNT.hurt, C.DEBRIS.player,
    { speed: 0.26, spread: 1.4, at: now });
  ripple(state, state.player.col, state.player.row, "#ff5470", now, 3);
  shake(state, C.SHAKE.hurt, now);
  hitStop(state, now, C.HITSTOP.hurt);
  bumpTask(state, "hurt");
  events.push({
    type: "playerHit", col: state.player.col, row: state.player.row,
    x: p.x + p.w / 2, y: p.y, timePenalty: state.tuning.HIT_TIME_PENALTY,
  });
  events.push({ type: "statsChanged" });
  // the clock running out is the frame loop's call, same as any other drain
}

export function breakChain(state, events, cause, at = state.clock) {
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

export const isVisible = (e) => e.state === "rising" || e.state === "up" || e.state === "sinking";

export function hitFx(target, tier, now) {
  target.tier = tier;
  target.fx = {
    scale:  C.makeImpulse(tier.scale, now),
    squash: C.makeImpulse(tier.squash, now),
    kick:   C.makeImpulse(tier.kick, now),
  };
}

/**
 * A virus dies. Shared by the buster and the bomb, so both pay the same score,
 * time, chain and fx -- the bomb is simply a charged-tier delete on up to nine
 * squares at once.
 */
export function deleteEnemy(state, target, tierName, land, events) {
  const now = state.clock;
  const tier = C.TIERS[tierName];
  const p = panel(state, target.col, target.row);
  // the same origin shoot() has always used, so a bomb kill and a buster kill
  // burst from the identical point -- and classic's frames do not move
  const cx = p.x + p.w / 2, cy = p.y + p.h * 0.34;
  // deletion
  target.state = "hit"; target.t0 = land;
  hitFx(target, tier, land);

  const multBefore = C.multOf(state.chain);
  state.chain++;
  if (state.chain > state.bestChain) state.bestChain = state.chain;
  const mult = C.multOf(state.chain);
  bumpTask(state, "kill", { type: target.type, tier: tierName, chain: state.chain });
  // a wave is "cleared" only when every virus in it was actually deleted
  if (state.wave && target.wave === state.wave.index) state.wave.kills++;

  // What a delete is worth: the type's own key when it has one (the enemy
  // table's `scoreKey`), otherwise the shot's tier -- a mett pays for the
  // shot you spent on it, a guard pays for being a guard.
  const baseKey = enemyDef(target.type).scoreKey || tierName;
  const share = state.echo ? state.echo.share : 1;
  const pts = Math.round((state.tuning.PTS[baseKey] === undefined ? state.tuning.PTS[tierName] : state.tuning.PTS[baseKey]) * mult * share);
  state.score += pts;
  state.deletions++;

  const bf = state.tuning.pulseScale(state.deletions, C.modeById(state.modeId).advancing);
  const factor = baseKey === "rare" ? Math.sqrt(bf) : bf;
  const timeBonus = (state.tuning.BONUS[baseKey] === undefined ? state.tuning.BONUS[tierName] : state.tuning.BONUS[baseKey]) * factor * share;
  state.timeLeft = Math.min(state.tuning.TIME_CAP, state.timeLeft + timeBonus);

  // The felt half of a delete: debris in the skin's own colours, a ring in the
  // struck panel, a kick on the whole screen and a freeze — all sized by what
  // died, so a rare is unmistakably an event and a mett is a satisfying tap.
  spawnBits(state, cx, cy, (C.BIT_COUNT[baseKey] || C.BIT_COUNT.guard), (C.DEBRIS[target.type] || C.DEBRIS.guard), {
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

export function shoot(state, tierName, events) {
  const now = state.clock;
  const G = state.G;
  const tier = C.TIERS[tierName];
  state.fx.recoil = C.makeImpulse(tier.recoil, now);
  state.fx.muzzleT0 = now;
  state.fx.muzzleTier = tierName;
  state.shots++;
  // what a footnote shard would take again, if you spend one
  if (!state.echo) state.lastShotTier = tierName;

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
    state.timeLeft = Math.max(0, state.timeLeft - state.tuning.ALLY_TIME_PENALTY);
    state.score = Math.max(0, state.score - state.tuning.ALLY_PTS_PENALTY);
    state.fx.popups.push({
      x: cx, y: p.y - 8, t0: land,
      text: "PROG HIT −" + state.tuning.ALLY_TIME_PENALTY.toFixed(1) + "s", color: "#ff5470",
    });
    spawnBits(state, cx, cy, C.BIT_COUNT.prog, C.DEBRIS.ally, { at: land, speed: 0.18 });
    ripple(state, target.col, target.row, "#ff5470", land, 3);
    shake(state, C.SHAKE.prog, land);
    hitStop(state, land, C.HITSTOP.prog);
    events.push({
      type: "progHit", tier: tierName, col: target.col, row: target.row, x: cx, y: p.y,
      timePenalty: state.tuning.ALLY_TIME_PENALTY, pointsPenalty: state.tuning.ALLY_PTS_PENALTY,
    });
    events.push({ type: "statsChanged" });
    return;
  }

  // steel: a plain shot plinks off it, a charged one goes through
  if (enemyDef(target.type).armor === "steel" && tierName === "normal") {
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

  // a shutter: armoured while closed, a health bar while open
  if (enemyDef(target.type).armor === "shutter") {
    const open = target.willAttack ? !target.fired : true;
    if (!open) {
      state.fx.sparks.push({ x: p.x + p.w * 0.28, y: p.y + p.h * 0.2, t0: land });
      state.fx.popups.push({ x: cx, y: p.y - 8, t0: land, text: "CLOSED", color: "#b48cff" });
      spawnBits(state, p.x + p.w * 0.28, cy, C.BIT_COUNT.block, C.DEBRIS.guard,
        { at: land, speed: 0.14, ms: 260 });
      ripple(state, target.col, target.row, "#b48cff", land, 2);
      events.push({ type: "guardBlocked", col: target.col, row: target.row, x: cx, y: p.y });
      return;
    }
    const dmg = tierName === "charged" ? state.tuning.SENTINEL_CHARGED_DMG : 1;
    if (target.hp > dmg) {
      target.hp -= dmg;
      state.fx.sparks.push({ x: cx, y: p.y + p.h * 0.2, t0: land });
      state.fx.popups.push({ x: cx, y: p.y - 8, t0: land, text: target.hp + " more", color: "#c48cff" });
      spawnBits(state, cx, cy, C.BIT_COUNT.stagger, C.DEBRIS.guard, { at: land, speed: 0.17, ms: 340 });
      ripple(state, target.col, target.row, "#c48cff", land, 2);
      hitStop(state, land, C.HITSTOP.stagger);
      events.push({ type: "sentinelHit", col: target.col, row: target.row, x: cx, y: p.y, hp: target.hp });
      return;
    }
  }

  // stamina: a tap staggers what the table says has stamina and it stays up;
  // charged shots take it outright
  if (enemyDef(target.type).stagger && tierName === "normal" && target.hp > 1) {
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

  deleteEnemy(state, target, tierName, land, events);
}
