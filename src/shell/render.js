/*!
 * Canvas renderer.
 *
 * `draw(ctx, state, now)` takes a 2D context, a plain state object (which
 * carries its own geometry in `state.G`) and a time in ms. It touches no DOM:
 * no document, no window, no element lookups, no getBoundingClientRect, no
 * matchMedia — so the same frame can be drawn off-screen against any
 * CanvasRenderingContext2D implementation. It never mutates the state either.
 *
 * Everything it animates is a pure function of `state` and `now`. It owns no
 * randomness: particles, shake envelopes and flourishes are authored in the
 * core (seeded) and merely read here. That is what keeps the golden-frame
 * harness honest.
 *
 * Accessibility: `state.reducedMotion` damps screen shake, full-screen
 * flashing and every strobe. The renderer cannot read a media query itself, so
 * the shell reads it and hands the answer in as data.
 */

import * as C from "../core/constants.js";
import { hudView } from "../core/select.js";

const { EASE, impulseValue, TAU, RING_GAP } = C;

const panel = (G, col, row) => C.panelRect(G, col, row);

const MONO = "px ui-monospace, Menlo, Consolas, monospace";
const font = (weight, size) => weight + " " + size + MONO;

const SKINS = {
  mett:   { dome: "#ffd23f", stripe: "#c9992a" },
  guard:  { dome: "#aeb9d6", stripe: "#6c7794" },
  hopper: { dome: "#5ee87c", stripe: "#1f7c3d" },
  ally:   { dome: "#58c7ff", stripe: "#2a7ab8" },
  rare:   { dome: "#fff3c4", stripe: "#e8a020" },
};

// Panel palettes. Past OC_START the whole field runs hot, not just the HUD.
const PANELS    = { mine: ["#3a2330", "#7c3652"], theirs: ["#1e2c4d", "#35528f"] };
const PANELS_OC = { mine: ["#40252c", "#95483f"], theirs: ["#2b2a35", "#7b5733"] };

/** A ring that stops just short of a full turn — see C.RING_GAP. */
function ring(ctx, x, y, r, squash = 1) {
  ctx.beginPath();
  if (squash === 1) {
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU - RING_GAP);
    return;
  }
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * (TAU - RING_GAP);
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * squash;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
}

// ---------- frame ----------

export function draw(ctx, state, now) {
  const G = state.G;
  const rm = !!state.reducedMotion;
  ctx.clearRect(0, 0, G.w, G.h);

  // One shake envelope for every sender, so a delete and a hit landing in the
  // same frame cannot fight over the transform. Quadratic falloff reads as a
  // punch rather than a wobble.
  const sh = state.fx.shake;
  const st = now - sh.t0;
  let dx = 0, dy = 0;
  if (st >= 0 && st < sh.ms && sh.amp > 0) {
    const k = (1 - st / sh.ms) ** 2 * (rm ? C.RM.shake : 1);
    dx = Math.sin(st / 16.5) * sh.amp * k;
    dy = Math.cos(st / 11.5) * sh.amp * k * 0.62;
  }

  ctx.save();
  if (dx || dy) ctx.translate(dx, dy);

  drawPanels(ctx, state, now);
  drawLane(ctx, state, now);
  drawAim(ctx, state, now);
  drawGhost(ctx, state, now);
  const { rayY, busterX } = drawPlayer(ctx, state, now, rm);
  // A detonation brackets its victim: shockwave and shards behind the sprite so
  // the silhouette stays legible inside the fireball, the white core over it.
  for (const e of state.enemies) drawBlastUnder(ctx, state, now, e);
  for (const e of state.enemies) drawEnemy(ctx, state, now, e);
  for (const e of state.enemies) drawBlastOver(ctx, state, now, e);
  drawBolts(ctx, state, now);
  drawShots(ctx, state, now, rayY, busterX);
  drawBits(ctx, state, now);
  drawSparks(ctx, state, now);
  drawHurtWorld(ctx, state, now, rm);
  drawFlare(ctx, state, now);
  drawPopups(ctx, state, now);
  drawChainBreak(ctx, state, now);
  ctx.restore();

  drawHUD(ctx, state, now, rm);
}

// ---------- board ----------

function drawPanels(ctx, state, now) {
  const G = state.G;
  const oc = state.deletions >= C.OC_START;
  const skin = oc ? PANELS_OC : PANELS;
  for (let r = 0; r < C.ROWS; r++) {
    for (let c = 0; c < C.COLS; c++) {
      const p = panel(G, c, r);
      const mine = c < C.PCOLS;
      const [fill, edge] = mine ? skin.mine : skin.theirs;
      ctx.fillStyle = fill;
      ctx.strokeStyle = edge;
      ctx.lineWidth = 2;
      ctx.fillRect(p.x + 3, p.y + 3, p.w - 6, p.h - 6);
      ctx.strokeRect(p.x + 3, p.y + 3, p.w - 6, p.h - 6);
      if (oc) {
        // a slow orange tide crossing the grid: overclock you can feel without
        // reading the HUD
        ctx.globalAlpha = 0.055 + 0.05 * Math.sin(now / 380 - c * 0.62 - r * 0.24);
        ctx.fillStyle = "#ff9f45";
        ctx.fillRect(p.x + 3, p.y + 3, p.w - 6, p.h - 6);
        ctx.globalAlpha = 1;
      }
      if (mine && c === state.player.col && r === state.player.row) {
        ctx.strokeStyle = "#45e0e8";
        ctx.strokeRect(p.x + 5, p.y + 5, p.w - 10, p.h - 10);
      }
    }
  }
  drawRipples(ctx, state, now);
}

// An impact ring that grows from the middle of a panel to its edge. Cheap
// (one strokeRect each) and it tells you *which square* just took something.
function drawRipples(ctx, state, now) {
  const G = state.G;
  for (const rp of state.fx.ripples) {
    const t = now - rp.t0;
    if (t < 0 || t >= rp.ms) continue;
    const q = EASE.out2(t / rp.ms);
    const p = panel(G, rp.col, rp.row);
    const ix = 4 + p.w * 0.42 * (1 - q);
    const iy = 4 + p.h * 0.42 * (1 - q);
    ctx.globalAlpha = (1 - t / rp.ms) * 0.8;
    ctx.strokeStyle = rp.color;
    ctx.lineWidth = rp.w;
    ctx.strokeRect(p.x + ix, p.y + iy, p.w - ix * 2, p.h - iy * 2);
  }
  ctx.globalAlpha = 1;
}

// The lane the buster just fired down stays lit behind the tracer, so a shot
// reads as a thing that happened to a *row*, not just to one virus.
function drawLane(ctx, state, now) {
  const ray = state.fx.ray;
  const t = now - ray.t0;
  const span = ray.dur + C.LANE_MS;
  if (t < 0 || t >= span) return;
  const G = state.G;
  const y = C.laneY(G, ray.row);
  const head = t <= ray.dur ? ray.x0 + (ray.x1 - ray.x0) * (t / ray.dur) : ray.x1;
  const fade = t <= ray.dur ? 1 : 1 - (t - ray.dur) / C.LANE_MS;
  // A corridor around the firing line rather than the whole row: the shot lit a
  // lane, it did not select a rank of panels.
  const x0 = ray.x0 - G.pw * 0.4;
  const h = G.ph * 0.44;
  ctx.globalAlpha = fade * (ray.hitCol !== null ? 0.2 : 0.1);
  ctx.fillStyle = "#45e0e8";
  ctx.fillRect(x0, y - h / 2, Math.max(0, head - x0), h);
  ctx.globalAlpha = fade * 0.35;
  ctx.fillRect(x0, y - 1.5, Math.max(0, head - x0), 3);
  ctx.globalAlpha = 1;
}

// The telegraph is the whole fairness budget: the lane the shot will sweep
// fills toward the player as the aim completes, and a chevron marks the row
// at the player's edge so the threat is readable without looking away.
function drawAim(ctx, state, now) {
  if (state.mode !== "playing") return;
  const G = state.G;
  const fallbackAim = C.aimMs(state.deletions);
  for (const e of state.enemies) {
    if (!e.willAttack || e.fired || e.state !== "up") continue;
    // Each enemy bakes its own aim window at spawn: a hopper telegraphs far
    // longer than a mett. Using one global value here saturated the hopper's
    // chevron ~35% early, so the telegraph misreported the dodge window.
    const q = Math.min(1, (now - e.t0) / (e.aimMs || fallbackAim));
    const p = panel(G, e.col, e.row);
    const x1 = p.x + p.w / 2;
    const y = C.laneY(G, e.row);
    const pulse = 0.55 + 0.45 * Math.sin(now / 42);

    ctx.save();
    ctx.fillStyle = "#ff5470";
    ctx.globalAlpha = 0.05 + 0.13 * q;
    ctx.fillRect(G.gx + 3, p.y + 3, x1 - G.gx - 3, p.h - 6);

    ctx.globalAlpha = (0.2 + 0.4 * q) * pulse;
    ctx.strokeStyle = "#ff5470";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(G.gx + 6, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = pulse;
    ctx.fillStyle = q > 0.75 ? "#ffd23f" : "#ff5470";
    ctx.beginPath();
    ctx.moveTo(G.gx + 4, y);
    ctx.lineTo(G.gx + 15, y - 7);
    ctx.lineTo(G.gx + 15, y + 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// Incoming fire comes in two flavours and they must never be confused at a
// glance: a fast needle you have to already be moving away from, and a slow
// heavy orb you can still walk around. So speed is drawn, not implied — the
// streak behind a bolt is its own travel time made visible (`speed` is px/ms,
// so `speed * TRAIL_MS` is literally where it was that many ms ago), the fast
// one is a hard dart with a white-hot core, and the slow one is a big pulsing
// sphere with a corona and no streak worth the name.
//
// Fields read off a bolt, all defensively defaulted: `kind` ("fast" | "heavy",
// falling back to the older `heavy` boolean), `radius` (falls back to a size
// per kind), `speed` (px/ms, falls back to a nominal 0.7) and `row`/`x`, which
// have always been there.
const BOLT_TRAIL_MS = 120;

function boltView(b, G) {
  const kind = b.kind || (b.heavy ? "heavy" : "fast");
  const heavy = kind === "heavy" || kind === "slow" || kind === "mett";
  const r = b.radius || (heavy ? G.ph * 0.17 : G.ph * 0.115);
  const speed = b.speed > 0 ? b.speed : 0.7;
  return { heavy, r: Math.max(5, r), speed };
}

function drawBolts(ctx, state, now) {
  const G = state.G;
  for (const b of state.bolts) {
    const y = C.laneY(G, b.row);
    const { heavy, r, speed } = boltView(b, G);
    // where this bolt was BOLT_TRAIL_MS ago, clamped so a stationary or absurd
    // speed cannot draw a screen-wide smear or a stub
    const trail = Math.min(G.pw * 3.4, Math.max(r * 1.6, speed * BOLT_TRAIL_MS));

    const grad = ctx.createLinearGradient(b.x + trail, 0, b.x, 0);
    grad.addColorStop(0, "rgba(255,84,112,0)");
    grad.addColorStop(1, heavy ? "#ff9f45" : "#ff5470");
    ctx.strokeStyle = grad;
    ctx.lineWidth = heavy ? r * 1.5 : r * 0.7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(b.x + trail, y);
    ctx.lineTo(b.x, y);
    ctx.stroke();
    ctx.lineCap = "butt";

    if (heavy) {
      // a slow, heavy sphere: corona, banded shell, and a rolling highlight
      ctx.globalAlpha = 0.3 + 0.12 * Math.sin(now / 130);
      ctx.fillStyle = "#ff9f45";
      ctx.beginPath();
      ctx.arc(b.x, y, r * 1.85, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ff9f45";
      ctx.beginPath();
      ctx.arc(b.x, y, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "#ffd23f";
      ctx.lineWidth = 2;
      ring(ctx, b.x, y, r * 1.32, 0.9);
      ctx.stroke();
      ctx.fillStyle = "#fff3c4";
      ctx.beginPath();
      ctx.arc(b.x - r * 0.22, y - r * 0.24, r * 0.42, 0, TAU);
      ctx.fill();
    } else {
      // a fast dart: two afterimages strung out along the streak, then a hard
      // arrowhead with a white core
      ctx.fillStyle = "#ff8ba0";
      let a = 0.34;
      for (const f of [0.38, 0.7]) {
        ctx.globalAlpha = a;
        const off = trail * f, rr = r * (1 - f * 0.55);
        ctx.beginPath();
        ctx.moveTo(b.x + off - rr, y);
        ctx.lineTo(b.x + off, y - rr * 0.8);
        ctx.lineTo(b.x + off + rr * 0.7, y);
        ctx.lineTo(b.x + off, y + rr * 0.8);
        ctx.closePath();
        ctx.fill();
        a *= 0.5;
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ff5470";
      ctx.beginPath();
      ctx.moveTo(b.x - r * 1.5, y);
      ctx.lineTo(b.x + r * 0.5, y - r * 0.85);
      ctx.lineTo(b.x + r * 1.2, y);
      ctx.lineTo(b.x + r * 0.5, y + r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(b.x - r * 0.9, y);
      ctx.lineTo(b.x + r * 0.35, y - r * 0.34);
      ctx.lineTo(b.x + r * 0.35, y + r * 0.34);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// ---------- actors ----------

// Where the player just was, catching up to where they are.
function drawGhost(ctx, state, now) {
  const g = state.fx.ghost;
  const t = now - g.t0;
  if (t < 0 || t >= C.GHOST_MS) return;
  const G = state.G;
  const p = panel(G, g.col, g.row);
  const bw = G.pw * 0.34, bh = G.ph * 1.15;
  const k = 1 - t / C.GHOST_MS;
  // Narrow and dim on purpose: a streak, not a second player standing there.
  const w = bw * 0.62;
  ctx.globalAlpha = 0.34 * k * k;
  ctx.fillStyle = "#45e0e8";
  ctx.fillRect(p.x + p.w / 2 - w / 2, p.y + p.h * 0.78 - bh * k, w, bh * k);
  ctx.globalAlpha = 1;
}

function drawPlayer(ctx, state, now, rm) {
  const G = state.G;
  const p = panel(G, state.player.col, state.player.row);
  const eRecoil = impulseValue(state.fx.recoil, now);
  const rx = -state.fx.recoil.spec.px * eRecoil;

  const bw = G.pw * 0.34, bh = G.ph * 1.15;
  const cx = p.x + p.w / 2 + rx;
  const baseY = p.y + p.h * 0.78;
  const coreY = baseY - bh * 0.5;

  const cdn = state.charge.downAt;
  const charging = cdn !== null && state.mode === "playing";
  const held = charging ? now - cdn : 0;
  const prog = charging ? Math.min(1, held / C.CHARGE_MS) : 0;

  // The charge should look like it is *loading*, not just counting: a glow
  // that swells behind the sprite, brightest the instant before release.
  if (prog > 0.12) {
    ctx.globalAlpha = 0.08 + 0.26 * prog * prog;
    ctx.fillStyle = state.charge.full ? "#c9f6ff" : "#45e0e8";
    const gw = bw * (1.5 + prog * 0.9), gh = bh * (0.78 + prog * 0.34);
    ctx.fillRect(cx - gw / 2, coreY - gh / 2, gw, gh);
    ctx.globalAlpha = 1;
  }

  // Invulnerability: a strobe normally, a steady dim under reduced motion.
  const hurtNow = now < state.hurtUntil;
  const flicker = hurtNow && (rm || Math.floor(now / 70) % 2 === 0);
  if (flicker) ctx.globalAlpha = rm ? 0.68 : 0.35;

  ctx.fillStyle = "#4f8dff";
  ctx.fillRect(cx - bw / 2, baseY - bh, bw, bh);
  ctx.fillStyle = "#2f5fc4";
  ctx.fillRect(cx - bw / 2, baseY - bh, bw, bh * 0.28);
  ctx.fillStyle = "#c9f6ff";
  ctx.fillRect(cx - bw * 0.28, baseY - bh * 0.62, bw * 0.56, bh * 0.14);
  const rayY = baseY - bh * 0.42;
  ctx.fillStyle = state.charge.full ? "#fff3c4" : "#ffd23f";
  ctx.fillRect(cx + bw / 2 - 2, rayY - 5, bw * 0.55, 10);
  ctx.globalAlpha = 1;

  if (charging && held > 120) {
    // motes spiralling in as the charge fills
    for (let i = 0; i < 3; i++) {
      const f = ((now / 300) + i / 3) % 1;
      const a = i * (TAU / 3) + f * 2.4 + now / 900;
      const r = bw * (2.4 - 1.45 * f);
      const sz = 2 + 2.5 * f;
      ctx.globalAlpha = Math.min(1, prog * 1.2) * f * 0.9;
      ctx.fillStyle = state.charge.full ? "#c9f6ff" : "#45e0e8";
      ctx.fillRect(cx + Math.cos(a) * r - sz / 2, coreY + Math.sin(a) * r * 0.75 - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;

    // The sweep stops RING_GAP short of a full turn, so a brimming ring and a
    // full one are never the same path — and no ring here is an exact 2*PI arc.
    ctx.strokeStyle = state.charge.full
      ? (rm ? "#8fe9ef" : (Math.sin(now / 55) > 0 ? "#45e0e8" : "#c9f6ff"))
      : "rgba(69,224,232,0.5)";
    ctx.lineWidth = state.charge.full ? 4 : 2 + 2 * prog;
    ctx.beginPath();
    ctx.arc(cx, coreY, bw * 0.95, -Math.PI / 2, -Math.PI / 2 + prog * (TAU - RING_GAP));
    ctx.stroke();

    if (state.charge.full) {
      const pulse = rm ? 0.5 : 0.5 + 0.5 * Math.sin(now / 90);
      ctx.globalAlpha = 0.3 + 0.4 * pulse;
      ctx.lineWidth = 2;
      ring(ctx, cx, coreY, bw * (1.16 + 0.12 * pulse), 0.85);
      ctx.stroke();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = "#c9f6ff";
      for (let i = 0; i < 4; i++) {
        const a = i * (TAU / 4) + now / 260;
        const r0 = bw * 1.02, r1 = bw * (1.34 + 0.22 * Math.sin(now / 70 + i));
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, coreY + Math.sin(a) * r0 * 0.85);
        ctx.lineTo(cx + Math.cos(a) * r1, coreY + Math.sin(a) * r1 * 0.85);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
  return { rayY, busterX: cx + bw / 2 + bw * 0.55 };
}

function drawEnemy(ctx, state, now, e) {
  const G = state.G;
  const p = panel(G, e.col, e.row);
  const t = now - e.t0;
  const bw = G.pw * 0.4, bh = G.ph * 1.0;
  let cx = p.x + p.w / 2;
  const baseY = p.y + p.h * 0.78;

  let grow = 1, sx = 1, sy = 1, flash = 0;

  if (e.state === "rising") grow = EASE.out2(Math.min(1, t / (e.riseMs || C.RISE_MS)));
  else if (e.state === "sinking") grow = 1 - EASE.out2(t / C.SINK_MS);
  else if (e.state === "hit") {
    const tier = e.tier;
    const uniform = 1 + (tier.scale.peak - 1) * impulseValue(e.fx.scale, now);
    const sqy = 1 + tier.squash.amt * impulseValue(e.fx.squash, now);
    sx = uniform / sqy;
    sy = uniform * sqy;
    cx += tier.kick.px * impulseValue(e.fx.kick, now);
    // The hit clock starts when the tracer *lands*, so `t` is negative for the
    // whole flight: the victim must look untouched until the shot gets there.
    flash = t < 0 ? 0 : Math.max(0, 1 - t / 70);
    grow = Math.min(1, 1 - Math.max(0, (t - C.HIT_MS * 0.55) / (C.HIT_MS * 0.45)));
  }

  const ht = now - e.hopT0;
  if (e.state === "up" && ht < C.HOP_GROW_MS) grow *= EASE.out2(ht / C.HOP_GROW_MS);

  if (grow <= 0) return;

  const skin = SKINS[e.type];

  // hopper afterimage: the arc it just took, still hanging in the air
  if (e.state === "up" && e.hopFromCol !== undefined && ht >= 0 && ht < C.HOP_GROW_MS * 2) {
    const from = panel(G, e.hopFromCol, e.hopFromRow);
    const k = 1 - ht / (C.HOP_GROW_MS * 2);
    ctx.fillStyle = skin.dome;
    for (let i = 1; i <= 2; i++) {
      const f = i / 3;
      const gx = from.x + (p.x - from.x) * (1 - f) + p.w / 2;
      const gy = from.y + (p.y - from.y) * (1 - f) + p.h * 0.78;
      ctx.globalAlpha = 0.26 * k * (1 - f * 0.4);
      ctx.fillRect(gx - bw * 0.42, gy - bh * 0.72, bw * 0.84, bh * 0.62);
    }
    ctx.globalAlpha = 1;
  }

  ctx.save();
  ctx.translate(cx, baseY);
  ctx.scale(sx, sy * grow);
  ctx.globalAlpha = e.state === "hit" ? grow : 1;

  ctx.fillStyle = skin.dome;
  ctx.beginPath();
  ctx.arc(0, -bh * 0.42, bw * 0.55, Math.PI, 0);
  ctx.lineTo(bw * 0.55, -bh * 0.1);
  ctx.lineTo(-bw * 0.55, -bh * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = skin.stripe;
  ctx.fillRect(-bw * 0.08, -bh * 0.98, bw * 0.16, bh * 0.5);

  if (e.type === "guard") {
    ctx.fillStyle = "#6c7794";
    ctx.fillRect(-bw * 0.55, -bh * 0.34, bw * 1.1, bh * 0.1);
    ctx.fillStyle = "#232c42";
    ctx.fillRect(-bw * 0.42, -bh * 0.24, bw * 0.84, bh * 0.12);
  } else if (e.type === "ally") {
    // white face plate with a plus mark: friend, don't shoot
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-bw * 0.42, -bh * 0.36, bw * 0.84, bh * 0.26);
    ctx.fillStyle = "#2a7ab8";
    ctx.fillRect(-bw * 0.06, -bh * 0.34, bw * 0.12, bh * 0.22);
    ctx.fillRect(-bw * 0.24, -bh * 0.28, bw * 0.48, bh * 0.1);
  } else {
    ctx.fillStyle = "#232c42";
    ctx.fillRect(-bw * 0.42, -bh * 0.34, bw * 0.84, bh * 0.24);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-bw * 0.26, -bh * 0.3, bw * 0.12, bh * 0.14);
    ctx.fillRect(bw * 0.14, -bh * 0.3, bw * 0.12, bh * 0.14);
  }

  if (e.type === "rare") {
    // shimmer outline
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 70);
    ctx.strokeStyle = "#ffe08a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -bh * 0.42, bw * 0.62, Math.PI, 0);
    ctx.lineTo(bw * 0.62, -bh * 0.04);
    ctx.lineTo(-bw * 0.62, -bh * 0.04);
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = e.state === "hit" ? grow : 1;
  }

  if (flash > 0) {
    // A silhouette, not a bounding box. The delete pop scales the sprite up to
    // 2x, and with hit-stop holding that peak for ~90ms a filled rectangle read
    // as a blank slab hanging over the board.
    ctx.globalAlpha = flash;
    ctx.fillStyle = e.type === "ally" ? "#ff5470" : e.type === "rare" ? "#fff3c4" : "#ffffff";
    ctx.beginPath();
    ctx.arc(0, -bh * 0.42, bw * 0.6, Math.PI, 0);
    ctx.lineTo(bw * 0.6, -bh * 0.06);
    ctx.lineTo(-bw * 0.6, -bh * 0.06);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---------- shots ----------

function drawShots(ctx, state, now, rayY, busterX) {
  const G = state.G;
  const ray = state.fx.ray;
  const rt = now - ray.t0;
  const charged = ray.tier === "charged";

  // NB: deliberately not gated on mode. A stage gate or a run ending used to
  // delete a tracer out of mid-air on the frame it opened.
  if (rt >= 0 && rt < ray.dur + C.RAY_IMPACT_MS) {
    const y = C.laneY(G, ray.row);

    if (rt <= ray.dur) {
      // traveling tracer: bright head, tapering trail
      const head = ray.x0 + (ray.x1 - ray.x0) * (rt / ray.dur);
      const trail = Math.max(ray.x0, head - (charged ? 150 : 90));
      if (head > trail) {
        const grad = ctx.createLinearGradient(trail, 0, head, 0);
        grad.addColorStop(0, "rgba(69,224,232,0)");
        grad.addColorStop(1, charged ? "#c9f6ff" : "#45e0e8");
        ctx.strokeStyle = grad;
        ctx.lineWidth = charged ? 6 : 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(trail, y);
        ctx.lineTo(head, y);
        ctx.stroke();
        ctx.lineCap = "butt";
      }
      if (charged) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = "#45e0e8";
        ctx.beginPath();
        ctx.arc(head, y, 11, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(head, y, charged ? 5 : 3, 0, TAU);
      ctx.fill();
    } else if (ray.hitCol !== null) {
      // impact: two expanding rings where the tracer landed
      const q = (rt - ray.dur) / C.RAY_IMPACT_MS;
      const e = EASE.out2(q);
      ctx.globalAlpha = 1 - q;
      ctx.strokeStyle = charged ? "#c9f6ff" : "#45e0e8";
      ctx.lineWidth = charged ? 4 : 2;
      ring(ctx, ray.x1, y, (charged ? 10 : 6) + (charged ? 26 : 16) * e);
      ctx.stroke();
      ctx.globalAlpha = (1 - q) * 0.5;
      ctx.lineWidth = 1.5;
      ring(ctx, ray.x1, y, (charged ? 4 : 3) + (charged ? 44 : 27) * e, 0.62);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // muzzle flash: shockwave + glow + radiating spikes + white core
  const mdur = C.MUZZLE_MS[state.fx.muzzleTier] || C.MUZZLE_MS.normal;
  const mt = now - state.fx.muzzleT0;
  if (mt >= 0 && mt < mdur) {
    const q = mt / mdur;
    const a = 1 - q;
    const s = state.fx.muzzleTier === "charged" ? 1.6 : 1;

    ctx.save();
    ctx.translate(busterX + 2, rayY);

    ctx.globalAlpha = a * 0.85;
    const rad = (10 + 15 * EASE.out2(q)) * s;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    g.addColorStop(0, "rgba(255,240,180,0.95)");
    g.addColorStop(1, "rgba(255,159,69,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, TAU);
    ctx.fill();

    // the release: a small shockwave leaving the muzzle
    ctx.globalAlpha = a * a * 0.75;
    ctx.strokeStyle = "#ffd23f";
    ctx.lineWidth = 2 * s;
    ring(ctx, 0, 0, (6 + 18 * EASE.out3(q)) * s, 0.8);
    ctx.stroke();

    ctx.lineWidth = 2.5 * s;
    ctx.lineCap = "round";
    for (const ang of [-0.55, -0.18, 0.18, 0.55]) {
      const len = (7 + 15 * EASE.out3(q)) * s;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * 4, Math.sin(ang) * 4);
      ctx.lineTo(Math.cos(ang) * (4 + len), Math.sin(ang) * (4 + len));
      ctx.stroke();
    }
    ctx.lineCap = "butt";

    ctx.globalAlpha = a;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(2, 0, Math.max(0.5, (4.5 - 3 * q) * s), 0, TAU);
    ctx.fill();

    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// ---------- fx ----------

// Debris. One fillRect each, position integrated from the seeded velocity the
// core stored, so this stays a pure read and the pool is capped at MAX_BITS.
function drawBits(ctx, state, now) {
  for (const b of state.fx.bits) {
    const t = now - b.t0;
    if (t < 0 || t >= b.ms) continue;
    const q = t / b.ms;
    const s = b.size * (1 - q * 0.45);
    ctx.globalAlpha = 1 - q * q * q;
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x + b.vx * t - s / 2, b.y + b.vy * t + 0.5 * b.g * t * t - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}

function drawSparks(ctx, state, now) {
  for (const s of state.fx.sparks) {
    const p = (now - s.t0) / C.SPARK_MS;
    if (p < 0 || p >= 1) continue;
    const d = 4 + 10 * EASE.out2(p);
    ctx.globalAlpha = 1 - p;
    ctx.fillStyle = "#c9d2e8";
    ctx.fillRect(s.x - d, s.y - 2, 5, 3);
    ctx.fillRect(s.x + d - 4, s.y - 2, 5, 3);
    ctx.fillRect(s.x - 2, s.y - d, 3, 5);
    ctx.fillRect(s.x - 2, s.y + d - 4, 3, 5);
  }
  ctx.globalAlpha = 1;
}

// The multiplier flourish: a hexagonal shockwave in the struck panel plus the
// new multiplier punching out of it. Hexagons rather than circles — cyberspace,
// and no exact-2*PI arc for the harness to swallow.
function drawFlare(ctx, state, now) {
  const f = state.fx.flare;
  const t = now - f.t0;
  if (t < 0 || t >= C.FLARE_MS) return;
  const G = state.G;
  const q = t / C.FLARE_MS;
  const e = EASE.out3(q);
  const col = f.mult >= 4 ? "#ff9f45" : f.mult >= 3 ? "#ffd23f" : "#45e0e8";
  const r = G.pw * (0.22 + 0.9 * e);
  const spin = q * 0.7;

  ctx.save();
  ctx.strokeStyle = col;
  ctx.globalAlpha = (1 - q) ** 1.6 * 0.95;
  ctx.lineWidth = 2 + 3 * (1 - q);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * (TAU / 6) + spin;
    const x = f.x + Math.cos(a) * r, y = f.y + Math.sin(a) * r * 0.8;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.globalAlpha = (1 - q) ** 1.6 * 0.5;
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * (TAU / 6) + spin;
    ctx.beginPath();
    ctx.moveTo(f.x + Math.cos(a) * r * 0.5, f.y + Math.sin(a) * r * 0.4);
    ctx.lineTo(f.x + Math.cos(a) * r * 0.94, f.y + Math.sin(a) * r * 0.75);
    ctx.stroke();
  }

  const pop = 1 + 0.9 * EASE.out3(Math.min(1, q * 3.2));
  ctx.globalAlpha = Math.max(0, 1 - q * 1.35);
  ctx.textAlign = "center";
  ctx.fillStyle = col;
  ctx.font = font(700, Math.round(19 * pop));
  ctx.fillText("×" + f.mult, f.x, f.y - G.ph * 0.86 - 22 * e);
  ctx.restore();
  ctx.globalAlpha = 1;
}

// …and what losing one looks like: the count drops out of the board and the
// links fall apart under it.
function drawChainBreak(ctx, state, now) {
  const cb = state.fx.chainBreak;
  const t = now - cb.t0;
  // A hurt-break says nothing here: the panel it would draw on is the one the
  // player most needs to read, and the HIT popup, the flash and the HUD's
  // struck-through chain line are already carrying the news.
  if (cb.quiet || t < 0 || t >= C.CHAIN_BREAK_MS) return;
  const q = t / C.CHAIN_BREAK_MS;

  ctx.save();
  ctx.textAlign = "center";
  ctx.font = font(700, 17);
  ctx.globalAlpha = Math.max(0, 1 - q * 1.2);
  ctx.fillStyle = "#ff5470";
  ctx.fillText("×" + cb.chain + " CHAIN LOST", cb.x, cb.y - 16 - 22 * EASE.out2(q));

  // the links themselves coming apart under it
  ctx.fillStyle = "#8a96b8";
  for (let i = 0; i < 5; i++) {
    const k = i - 2;
    ctx.globalAlpha = (1 - q) * 0.8;
    const sz = 8 - 4 * q;
    ctx.fillRect(cb.x + k * 13 + k * 34 * q - sz / 2, cb.y - 6 + 130 * q * q - sz / 2, sz, sz);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawPopups(ctx, state, now) {
  ctx.textAlign = "center";
  ctx.font = font(700, 15);
  for (const pp of state.fx.popups) {
    const t = now - pp.t0;
    if (t < 0 || t >= C.POPUP_MS) continue;
    const p = t / C.POPUP_MS;
    ctx.globalAlpha = 1 - p;
    ctx.fillStyle = pp.color;
    ctx.fillText(pp.text, pp.x, pp.y - 30 * EASE.out2(p));
  }
  ctx.globalAlpha = 1;
}

// ---------- detonations ----------
//
// A deletion used to be debris plus a one-frame silhouette. It is now an
// explosion: a white core that blows out, one to three shockwave rings, a
// star of shards and a soot ring that lingers over the debris. Everything is
// dated to `e.t0` — the moment the tracer *lands*, the same clock the squash,
// the kick and the hit-stop already run on — so the freeze holds the fireball
// at its brightest instead of fighting it, and the shake moves it with the
// board because it is drawn inside the same transform.

const BLASTS = {
  normal:  { ms: 210, r: 1.7, rings: 1, shards: 7,  wash: 0.05, hot: "#ffffff", warm: "#ffd23f", soot: "#c9992a" },
  charged: { ms: 250, r: 2.4, rings: 2, shards: 10, wash: 0.10, hot: "#ffffff", warm: "#c9f6ff", soot: "#45e0e8" },
  guard:   { ms: 240, r: 2.1, rings: 2, shards: 9,  wash: 0.08, hot: "#ffffff", warm: "#dfe7fb", soot: "#6c7794" },
  hopper:  { ms: 215, r: 1.8, rings: 1, shards: 8,  wash: 0.05, hot: "#ffffff", warm: "#a6f5bb", soot: "#1f7c3d" },
  rare:    { ms: 275, r: 3.2, rings: 3, shards: 14, wash: 0.16, hot: "#ffffff", warm: "#ffe08a", soot: "#e8a020" },
  prog:    { ms: 205, r: 1.5, rings: 1, shards: 6,  wash: 0.04, hot: "#ffd7de", warm: "#ff5470", soot: "#2a7ab8" },
};

/** Deterministic angle scatter: a hash of the shard index, never an rng. */
const spray = (i) => Math.sin(i * 127.1) * 0.5;

/** Which detonation a dying enemy earns. `e.tier` is the core's hit-feel spec. */
function blastOf(e) {
  if (e.type === "ally") return BLASTS.prog;
  if (e.type === "rare") return BLASTS.rare;
  if (e.type === "guard") return BLASTS.guard;
  if (e.type === "hopper") return BLASTS.hopper;
  return e.tier && e.tier.scale && e.tier.scale.peak >= 1.9 ? BLASTS.charged : BLASTS.normal;
}

/** 0..1 through the blast, or -1 when this enemy is not exploding. */
function blastPhase(state, now, e) {
  if (e.state !== "hit") return -1;
  const t = now - e.t0;
  if (t < 0) return -1;                       // the tracer has not arrived yet
  const b = blastOf(e);
  return t >= b.ms ? -1 : t / b.ms;
}

function blastCenter(G, e) {
  const p = panel(G, e.col, e.row);
  return { x: p.x + p.w / 2, y: p.y + p.h * 0.78 - G.ph * 1.0 * 0.42, u: G.pw * 0.4 };
}

/** Rings and shards, under the sprite so the silhouette stays inside them. */
function drawBlastUnder(ctx, state, now, e) {
  const q = blastPhase(state, now, e);
  if (q < 0) return;
  const b = blastOf(e);
  const G = state.G;
  const { x, y, u } = blastCenter(G, e);

  for (let r = 0; r < b.rings; r++) {
    const rq = (q - r * 0.14) / (1 - r * 0.14);
    if (rq <= 0) continue;
    const e3 = EASE.out3(rq);
    ctx.globalAlpha = (1 - rq) ** 1.2 * (r ? 0.55 : 0.95);
    ctx.strokeStyle = r ? b.soot : b.warm;
    // wide and bright on the first frames, thinning as it outruns the debris
    ctx.lineWidth = (r ? 3 : 7) * (1 - rq * 0.72);
    ring(ctx, x, y, u * (0.55 + b.r * e3 * (1 + r * 0.35)), 0.82);
    ctx.stroke();
  }

  // the star: shards thrown out along fixed bearings, tapering as they go
  ctx.lineCap = "round";
  ctx.strokeStyle = b.warm;
  for (let i = 0; i < b.shards; i++) {
    const a = (i / b.shards) * TAU + spray(i) * 0.42;
    const reach = 1 + spray(i + 7) * 0.5;
    const e3 = EASE.out3(Math.min(1, q * 1.25));
    const r0 = u * 0.25 * e3, r1 = u * b.r * 1.15 * reach * e3;
    ctx.globalAlpha = (1 - q) ** 1.4;
    ctx.lineWidth = Math.max(1.5, 6.5 * (1 - q) * (b.r / 2));
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.85);
    ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1 * 0.85);
    ctx.stroke();
  }
  ctx.lineCap = "butt";
  ctx.globalAlpha = 1;
}

/** The core flash, over the sprite: the frame where it stops being a virus. */
function drawBlastOver(ctx, state, now, e) {
  const q = blastPhase(state, now, e);
  if (q < 0) return;
  const b = blastOf(e);
  const G = state.G;
  const { x, y, u } = blastCenter(G, e);

  const cq = Math.min(1, q / 0.5);
  if (cq < 1) {
    // opens at nearly full width on the first frame: a detonation, not a bloom
    const rad = u * (0.95 + b.r * 0.72 * EASE.out2(cq));
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, "rgba(255,255,255," + ((1 - cq) * 0.95).toFixed(3) + ")");
    g.addColorStop(0.45, "rgba(255,210,63," + ((1 - cq) * 0.4).toFixed(3) + ")");
    g.addColorStop(1, "rgba(255,159,69,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, TAU);
    ctx.fill();
  }

  // soot: a dark ring left hanging where the thing was
  ctx.globalAlpha = (1 - q) * 0.4;
  ctx.strokeStyle = b.soot;
  ctx.lineWidth = 6 * (1 - q * 0.5);
  ring(ctx, x, y, u * (0.6 + b.r * 0.5 * EASE.out2(q)), 0.8);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * The room-lighting half of a big detonation: one short full-screen wash,
 * outside the shake transform so it cannot be dragged off an edge. Damped by
 * reducedMotion like every other flash.
 */
function drawBlastWash(ctx, state, now, rm) {
  let a = 0;
  for (const e of state.enemies) {
    const q = blastPhase(state, now, e);
    if (q < 0 || q > 0.3) continue;
    const b = blastOf(e);
    a = Math.max(a, b.wash * (1 - q / 0.3));
  }
  if (a <= 0.002) return;
  const G = state.G;
  ctx.fillStyle = "rgba(255,243,196," + (a * (rm ? C.RM.flash : 1)).toFixed(3) + ")";
  ctx.fillRect(0, 0, G.w, G.h);
}

// ---------- taking one ----------

const HURT_BURST_MS = 300;
const HURT_TEAR_MS = 120;
const HURT_VIGNETTE_MS = 440;

/**
 * The in-world half of a hit: a two-ring blowout on the player's panel, a
 * cross of impact spikes, and — for the whole i-frame window — a shrinking
 * shield arc that shows exactly how long the mercy lasts. The old version had
 * the flicker say "you are invulnerable" and nothing say "…for this long".
 */
function drawHurtWorld(ctx, state, now, rm) {
  const G = state.G;
  const p = panel(G, state.player.col, state.player.row);
  const cx = p.x + p.w / 2;
  const bh = G.ph * 1.15;
  const cy = p.y + p.h * 0.78 - bh * 0.5;
  const u = G.pw * 0.34;

  const t = now - state.fx.hurtT0;
  if (t >= 0 && t < HURT_BURST_MS) {
    const q = t / HURT_BURST_MS;
    const e3 = EASE.out3(q);
    ctx.globalAlpha = (1 - q) ** 1.5;
    ctx.strokeStyle = "#ff5470";
    ctx.lineWidth = 5 * (1 - q * 0.7);
    ring(ctx, cx, cy, u * (0.7 + 2.6 * e3), 0.85);
    ctx.stroke();
    ctx.globalAlpha = (1 - q) ** 2 * 0.8;
    ctx.strokeStyle = "#ffd7de";
    ctx.lineWidth = 2;
    ring(ctx, cx, cy, u * (0.4 + 1.6 * EASE.out2(q)), 0.7);
    ctx.stroke();

    // four spikes on the diagonals: a hit reads as a *strike*, not a bloom
    ctx.lineCap = "round";
    ctx.strokeStyle = "#ff5470";
    ctx.globalAlpha = (1 - q) ** 1.4;
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * (TAU / 4);
      const r0 = u * 0.5, r1 = u * (1.1 + 2.2 * e3);
      ctx.lineWidth = 5 * (1 - q);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.85);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.85);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    ctx.globalAlpha = 1;
  }

  // i-frames, as a clock: the arc unwinds and the last stretch turns cyan, so
  // the moment you are mortal again is a thing you saw happen.
  const left = state.hurtUntil - now;
  if (left > 0 && left <= C.HIT_IFRAME_MS && state.mode === "playing") {
    const k = left / C.HIT_IFRAME_MS;
    const ending = k < 0.28;
    ctx.globalAlpha = (ending ? 0.85 : 0.45) * (rm ? 0.75 : 1);
    ctx.strokeStyle = ending ? "#45e0e8" : "#ff8ba0";
    ctx.lineWidth = ending ? 3 : 2;
    ctx.beginPath();
    ctx.arc(cx, cy, u * 1.3, -Math.PI / 2, -Math.PI / 2 + k * (TAU - RING_GAP));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/**
 * The screen half: the red wash (harder and shorter than it was), a vignette
 * that slams in and recedes so recovery has a shape, and a two-frame signal
 * tear. reducedMotion keeps the wash and the vignette, damped, and drops the
 * tear entirely — it is the one element that is pure strobe.
 */
function drawHurtScreen(ctx, state, now, rm, hud) {
  if (hud.mode !== "playing") return;
  const G = state.G;
  const t = now - state.fx.hurtT0;
  if (t < 0) return;

  if (t < C.HURT_FLASH_MS) {
    // front-loaded: it has to sting on the frame it lands and get out of the
    // way fast, because the next bolt is already in the air
    const a = 0.34 * (1 - t / C.HURT_FLASH_MS) ** 2 * (rm ? C.RM.flash : 1);
    ctx.fillStyle = "rgba(255,84,112," + a.toFixed(3) + ")";
    ctx.fillRect(0, 0, G.w, G.h);
  }

  if (t < HURT_TEAR_MS && !rm) {
    // three slabs shoved sideways: a signal that just took a hit
    const q = t / HURT_TEAR_MS;
    for (let i = 0; i < 3; i++) {
      const ph = Math.sin(state.fx.hurtT0 * 0.013 + i * 2.399);
      const y = G.h * (0.18 + 0.3 * i + 0.08 * ph);
      const h = G.h * (0.035 + 0.02 * Math.abs(ph));
      const dx = (28 + 46 * Math.abs(ph)) * (1 - q) * (i % 2 ? -1 : 1);
      ctx.globalAlpha = (1 - q) * 0.4;
      ctx.fillStyle = "#ff5470";
      ctx.fillRect(dx, y, G.w, h);
      ctx.globalAlpha = (1 - q) * 0.22;
      ctx.fillStyle = "#45e0e8";
      ctx.fillRect(-dx * 0.6, y + h * 0.55, G.w, h * 0.5);
    }
    ctx.globalAlpha = 1;
  }

  if (t < HURT_VIGNETTE_MS) {
    // a red frame slammed against the bezel, retreating as the i-frames run
    const q = t / HURT_VIGNETTE_MS;
    const w = 36 * (1 - EASE.out2(q));
    ctx.globalAlpha = (1 - q) ** 1.5 * 0.45 * (rm ? C.RM.flash + 0.3 : 1);
    ctx.strokeStyle = "#ff5470";
    ctx.lineWidth = w;
    ctx.strokeRect(w / 2, w / 2, G.w - w, G.h - w);
    ctx.globalAlpha = 1;
  }
}

// ---------- HUD ----------
//
// The in-play HUD is three things and nothing else: the level (a chapter
// marker), the time bar (the only resource in the game) and the multiplier
// when there is one. The live score, the footer metrics and the "OVERCLOCK
// x0.94" readout were numbers a player cannot act on mid-fight; score and
// stats live on the interlevel and game-over cards, where reading is the
// activity. What survives here is either a shape or a number the hands use.

const PAD = 18;                    // HUD margin
const LEVEL_POP_MS = 680;          // the level announcement, start to settled
const PIP_Y = 66, PIP_H = 12;      // time bar
const PIP_GAP = 2;                 // between pips
const PIP_SECTION = 6;             // pips per subsection
const PIP_SECTION_GAP = 5;         // extra gap between subsections
const PIP_MIN_W = 5;               // narrower than this and a pip stops reading
// Seconds per pip, finest first. 1.25s divides TIME_CAP into 36 pips (six
// subsections of six) *and* HIT_TIME_PENALTY into exactly two, which is the
// whole point: a hit costs two pips, a mett kill hands one back.
const PIP_LADDER = [1.25, 2.5, 5];
const PIP_LOSS_MS = 520;           // how long the pips a hit cost hang around
const PIP_GAIN_MS = 260;           // …and how long the ones a kill returned flash

const CHAIN_TIERS = [5, 10, 20];   // multiplier steps, for the progress sliver

/**
 * When the last deletion landed, and how much clock it paid back.
 *
 * The core does not timestamp deletions for the renderer, but it does author a
 * "+N.Ns" time-bonus popup for every one of them, at `land + 60`. That popup is
 * the only "+…s" string in the game (the ally bonus reads "spared +0.5s"), so
 * reading it back is exact rather than a guess — and it keeps this a pure read
 * of core state instead of a new field the renderer would have to own.
 *
 * @returns {{ at: number, secs: number }|null}
 */
function lastDeletion(state) {
  const ps = state.fx.popups;
  for (let i = ps.length - 1; i >= 0; i--) {
    const txt = ps[i].text;
    if (txt.charCodeAt(0) === 43 && txt.charCodeAt(txt.length - 1) === 115) {
      const secs = parseFloat(txt);
      if (secs > 0) return { at: ps[i].t0 - 60, secs };
    }
  }
  return null;
}

/**
 * When the level last ticked over, or -Infinity.
 *
 * `level()` steps exactly when the deletion count crosses a multiple of five,
 * so the kill that did it is the most recent one — which `lastDeletion` dates.
 * The window is bounded by POPUP_MS, which is why LEVEL_POP_MS is shorter.
 */
function levelUpAt(state) {
  const del = state.deletions;
  if (del <= 0 || C.level(del) === C.level(del - 1)) return -Infinity;
  const d = lastDeletion(state);
  return d ? d.at : -Infinity;
}

// ---------- the time bar, as pips ----------

/**
 * How many pips fit, and how wide. One continuous bar made a 2.5s hit an
 * imperceptible slide; discrete cells make the cost countable. On a narrow
 * stage the ladder steps to coarser pips rather than shaving them below
 * PIP_MIN_W, because six unreadable slivers are worse than three fat ones.
 */
function pipLayout(G) {
  const w = G.w - PAD * 2;
  let L = null;
  for (let i = 0; i < PIP_LADDER.length; i++) {
    const secs = PIP_LADDER[i];
    const n = Math.max(1, Math.round(C.TIME_CAP / secs));
    const sections = Math.ceil(n / PIP_SECTION);
    const pw = (w - (n - 1) * PIP_GAP - (sections - 1) * PIP_SECTION_GAP) / n;
    L = { x: PAD, w, n, secs, pw };
    if (pw >= PIP_MIN_W) break;
  }
  return L;
}

const pipX = (L, i) =>
  L.x + i * (L.pw + PIP_GAP) + Math.floor(i / PIP_SECTION) * PIP_SECTION_GAP;

/** Walk the pips overlapping the span [a, b) in pips, partial cells included. */
function eachPip(L, a, b, fn) {
  const from = Math.max(0, a), to = Math.min(L.n, b);
  if (to <= from) return;
  for (let i = Math.floor(from); i < Math.ceil(to); i++) {
    const lo = Math.min(1, Math.max(0, from - i));
    const hi = Math.min(1, Math.max(0, to - i));
    if (hi <= lo) continue;
    fn(pipX(L, i) + lo * L.pw, Math.max(1, (hi - lo) * L.pw), i);
  }
}

function drawTimePips(ctx, state, now, hud, rm) {
  const L = pipLayout(state.G);
  const y = PIP_Y, h = PIP_H;
  const playing = hud.mode === "playing";
  const low = hud.timeLeft < C.LOW_TIME && playing;
  const col = low ? "#ff5470" : hud.overclock ? "#ff9f45" : "#45e0e8";
  const filled = Math.max(0, Math.min(L.n, hud.timeLeft / L.secs));

  ctx.fillStyle = "#232c42";
  for (let i = 0; i < L.n; i++) ctx.fillRect(pipX(L, i), y, L.pw, h);

  // A foot under each subsection, so the eye counts in sixes instead of
  // measuring a length.
  ctx.fillStyle = "#2f3a57";
  for (let i0 = 0; i0 < L.n; i0 += PIP_SECTION) {
    const i1 = Math.min(L.n, i0 + PIP_SECTION) - 1;
    ctx.fillRect(pipX(L, i0), y + h + 3, pipX(L, i1) + L.pw - pipX(L, i0), 2);
  }

  if (low) ctx.globalAlpha = rm ? 0.9 : 0.74 + 0.26 * Math.sin(now / 105);
  ctx.fillStyle = col;
  eachPip(L, 0, filled, (x, w) => ctx.fillRect(x, y, w, h));
  ctx.globalAlpha = 1;

  // The pips a kill just handed back, flashing white before they cool into the
  // bar: a rare returning six of them is unmistakable.
  const del = lastDeletion(state);
  if (del && playing) {
    const gt = now - del.at;
    if (gt >= 0 && gt < PIP_GAIN_MS) {
      const q = gt / PIP_GAIN_MS;
      ctx.globalAlpha = (1 - q) * 0.95;
      ctx.fillStyle = "#ffffff";
      const grow = 3 * (1 - q);
      eachPip(L, filled - del.secs / L.secs, filled,
        (x, w) => ctx.fillRect(x, y - grow, w, h + grow * 2));
      ctx.globalAlpha = 1;
    }
  }

  // …and the ones a hit cost, lifting off the bar where they used to be. This
  // is the whole argument for pips: the damage has a countable size.
  const ht = now - state.fx.hurtT0;
  if (ht >= 0 && ht < PIP_LOSS_MS && playing) {
    const q = ht / PIP_LOSS_MS;
    const lift = rm ? 0 : 11 * EASE.out2(q);
    const lost = C.HIT_TIME_PENALTY / L.secs;
    ctx.globalAlpha = (1 - q) * (rm ? 0.75 : 1);
    ctx.fillStyle = "#ff5470";
    eachPip(L, filled, filled + lost, (x, w) =>
      ctx.fillRect(x, y - lift, w, h * (1 - 0.45 * q)));
    ctx.fillStyle = "#ffd7de";
    eachPip(L, filled, filled + lost, (x, w) =>
      ctx.fillRect(x, y - lift, w, 2));
    ctx.globalAlpha = 1;
  }

  // Overclock, without the "x0.94" readout: a dashed outline past the head
  // showing what the *next* mett kill will actually pay back. At the start of
  // overclock it is a pip wide; deep in, it is a sliver against a full pip —
  // the same number, as a shape you can compare.
  if (hud.overclock && playing) {
    ctx.strokeStyle = "#ff9f45";
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    eachPip(L, filled, filled + (C.BONUS.normal * hud.overclockFactor) / L.secs,
      (x, w) => ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), h - 1));
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // the burning edge
  if (filled > 0 && filled < L.n) {
    const i = Math.min(L.n - 1, Math.floor(filled));
    const hx = pipX(L, i) + (filled - i) * L.pw;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(hx - 2, y - 2, 2, h + 4);
    ctx.globalAlpha = 1;
  }
}

// ---------- the level, as a chapter marker ----------

function drawLevel(ctx, state, now, hud, rm) {
  const G = state.G;
  const t = now - levelUpAt(state);
  const restSize = 34;
  const restX = PAD + 11, restY = 56;
  const col = hud.overclock ? "#ff9f45" : "#45e0e8";
  const num = String(hud.level).padStart(2, "0");

  // The announcement plays in the empty band between the time bar and the top
  // of the board — never over the playfield, and never over the bar either: it
  // hands off to the corner marker with a cross-fade rather than flying through
  // the pips. On a stage squat enough to have no band (700x360 leaves about
  // nine pixels) it degrades to a flash on the marker itself.
  const band0 = PIP_Y + PIP_H + 12;
  const bandH = Math.max(0, G.gy - 6 - band0);
  const room = bandH >= 46;
  const announcing = t >= 0 && t < LEVEL_POP_MS && hud.mode === "playing";
  const q = announcing ? t / LEVEL_POP_MS : 1;
  const hand = EASE.out2(Math.min(1, Math.max(0, (q - 0.55) / 0.45)));  // 0 big, 1 settled
  const flash = announcing ? Math.max(0, 1 - q * 1.7) : 0;

  ctx.save();
  ctx.textAlign = "left";

  if (announcing && room) {
    const size = Math.round(Math.max(restSize, Math.min(bandH * 0.72, 92)));
    const y = band0 + bandH / 2 + size * 0.34;
    ctx.font = font(700, size);
    const x = G.w / 2 - ctx.measureText(num).width / 2;
    const a = 1 - hand;

    if (!rm) {
      // a rule tearing across the band behind it
      ctx.globalAlpha = a * (1 - q) * 0.6;
      ctx.fillStyle = col;
      const rw = G.w * EASE.out3(Math.min(1, q * 2.4));
      ctx.fillRect(G.w / 2 - rw / 2, y - size * 0.36, rw, 2);
      ctx.fillRect(G.w / 2 - rw / 2, y + size * 0.16, rw, 1);
    }

    ctx.globalAlpha = a * 0.8;
    ctx.font = font(700, Math.round(size * 0.19));
    ctx.fillStyle = "#5f6b8c";
    ctx.fillText("LEVEL", x, y - size * 0.82);

    ctx.font = font(700, size);
    if (flash > 0) {
      ctx.globalAlpha = a * flash * 0.5;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(num, x - 3, y - 3);
    }
    ctx.globalAlpha = a;
    ctx.fillStyle = flash > 0.5 ? "#ffffff" : col;
    ctx.fillText(num, x, y);
  }

  // the settled marker: an accent stripe, a small label and a big numeral,
  // arriving as the announcement lets go of it
  const settle = announcing && room ? hand : 1;
  const pop = announcing ? Math.max(0, 1 - q * 1.2) : 0;
  ctx.globalAlpha = 0.9 * settle;
  ctx.fillStyle = col;
  ctx.fillRect(PAD, 16, 3, 42);
  ctx.globalAlpha = 0.75 * settle;
  ctx.font = font(700, 10);
  ctx.fillStyle = pop > 0.4 ? "#ffffff" : "#5f6b8c";
  ctx.fillText("LEVEL", restX, 26);
  ctx.globalAlpha = settle;
  ctx.font = font(700, restSize);
  ctx.fillStyle = pop > 0.4 && !room ? "#ffffff" : col;
  ctx.fillText(num, restX, restY);
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ---------- the multiplier, when there is one ----------

function drawChain(ctx, state, now, hud) {
  const G = state.G;
  const x = G.w - 70;
  const cb = state.fx.chainBreak;
  const cbt = now - cb.t0;

  ctx.textAlign = "right";
  if (hud.chain >= 2) {
    const ft = now - state.fx.flare.t0;
    const pop = ft >= 0 && ft < 280 ? 1 - ft / 280 : 0;
    const col = hud.mult >= 4 ? "#ff9f45" : hud.mult >= 3 ? "#ffd23f" : "#45e0e8";
    ctx.fillStyle = col;
    // "×1" is not a multiplier, it is a decoration — below the first step the
    // block is just the sliver filling toward it.
    if (hud.mult >= 2) {
      ctx.font = font(700, Math.round(21 + 9 * pop));
      ctx.fillText("×" + hud.mult, x, 40 + pop * 2);
    }

    // how far this chain is toward the next multiplier step, as a sliver
    const lo = CHAIN_TIERS.filter((c) => c <= hud.chain).at(-1) || 0;
    const hi = CHAIN_TIERS.find((c) => c > hud.chain);
    const frac = hi ? (hud.chain - lo) / (hi - lo) : 1;
    const bw = 54;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x - bw, 48, bw, 3);
    ctx.globalAlpha = 1;
    ctx.fillRect(x - bw, 48, bw * frac, 3);
  } else if (C.multOf(cb.chain) >= 2 && cbt >= 0 && cbt < C.CHAIN_BREAK_MS) {
    // the multiplier that just died, struck through where it lived
    const q = cbt / C.CHAIN_BREAK_MS;
    const label = "×" + C.multOf(cb.chain);
    ctx.globalAlpha = (1 - q) * 0.9;
    ctx.font = font(700, 21);
    ctx.fillStyle = "#5f6b8c";
    ctx.fillText(label, x, 40 + 6 * EASE.out2(q));
    const w = ctx.measureText(label).width;
    ctx.strokeStyle = "#ff5470";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - w, 33 + 6 * EASE.out2(q));
    ctx.lineTo(x - w + w * Math.min(1, q * 3), 33 + 6 * EASE.out2(q));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "left";
}

function drawHUD(ctx, state, now, rm) {
  const G = state.G;
  const hud = hudView(state);

  drawBlastWash(ctx, state, now, rm);
  drawLevel(ctx, state, now, hud, rm);
  drawChain(ctx, state, now, hud);
  drawTimePips(ctx, state, now, hud, rm);

  // Low-time urgency: a red frame closing in on the board. Two strokeRects, so
  // it costs nothing, and it holds steady instead of pulsing under reduced
  // motion.
  const low = hud.timeLeft < C.LOW_TIME;
  if (hud.mode === "playing" && !hud.paused && low) {
    const urg = 1 - Math.max(0, hud.timeLeft) / C.LOW_TIME;
    const pulse = rm ? 0.5 : 0.5 + 0.5 * Math.sin(now / 105);
    const a = (0.08 + 0.2 * urg) * (0.45 + 0.55 * pulse);
    ctx.strokeStyle = "#ff5470";
    ctx.globalAlpha = a;
    ctx.lineWidth = 24;
    ctx.strokeRect(12, 12, G.w - 24, G.h - 24);
    ctx.globalAlpha = Math.min(1, a * 2);
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, G.w - 3, G.h - 3);
    ctx.globalAlpha = 1;
  }

  drawHurtScreen(ctx, state, now, rm, hud);

  if (hud.mode === "playing" && hud.paused) {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(27,34,51,0.75)";
    ctx.fillRect(0, 0, G.w, G.h);
    // "PAUSED" stays — a stopped game with no word for it reads as a hang —
    // but "P to resume" goes with the rest of the keycaps: the pause button is
    // its own affordance, and the key that got you here is the key that leaves.
    ctx.fillStyle = "#aab4ce";
    ctx.font = font(700, 24);
    ctx.fillText("PAUSED", G.w / 2, G.h / 2 - 8);
    ctx.fillStyle = "#45e0e8";
    ctx.globalAlpha = rm ? 0.8 : 0.55 + 0.45 * Math.sin(now / 320);
    ctx.fillRect(G.w / 2 - 11, G.h / 2 + 16, 7, 22);
    ctx.fillRect(G.w / 2 + 4, G.h / 2 + 16, 7, 22);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }
}
