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
  for (const e of state.enemies) drawEnemy(ctx, state, now, e);
  drawBolts(ctx, state);
  drawShots(ctx, state, now, rayY, busterX);
  drawBits(ctx, state, now);
  drawSparks(ctx, state, now);
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
  const am = C.aimMs(state.deletions);
  for (const e of state.enemies) {
    if (!e.willAttack || e.fired || e.state !== "up") continue;
    const q = Math.min(1, (now - e.t0) / am);
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

function drawBolts(ctx, state) {
  const G = state.G;
  for (const b of state.bolts) {
    const y = C.laneY(G, b.row);
    const r = b.heavy ? 11 : 8;
    const grad = ctx.createLinearGradient(b.x + r * 6, 0, b.x, 0);
    grad.addColorStop(0, "rgba(255,84,112,0)");
    grad.addColorStop(1, b.heavy ? "#ff9f45" : "#ff5470");
    ctx.strokeStyle = grad;
    ctx.lineWidth = r * 0.8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(b.x + r * 6, y);
    ctx.lineTo(b.x, y);
    ctx.stroke();
    ctx.lineCap = "butt";

    // afterimages: two ghost heads strung out behind the live one
    ctx.fillStyle = b.heavy ? "#ffd23f" : "#ff8ba0";
    let a = 0.3;
    for (const off of [r * 2.0, r * 3.6]) {
      ctx.globalAlpha = a;
      const rr = r * (off > r * 3 ? 0.5 : 0.7);
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

    ctx.beginPath();
    ctx.moveTo(b.x - r, y);
    ctx.lineTo(b.x, y - r * 0.8);
    ctx.lineTo(b.x + r * 0.7, y);
    ctx.lineTo(b.x, y + r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(b.x - r * 0.3, y - 2, r * 0.5, 4);
  }
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

// ---------- HUD ----------

function drawHUD(ctx, state, now, rm) {
  const G = state.G;
  const hud = hudView(state);

  ctx.textAlign = "left";
  ctx.fillStyle = "#aab4ce";
  ctx.font = font(700, 22);
  ctx.fillText(hud.score, 18, 36);

  const cb = state.fx.chainBreak;
  const cbt = now - cb.t0;
  if (hud.chain >= 2) {
    // the chain line swells for a moment on every multiplier step
    const ft = now - state.fx.flare.t0;
    const pop = ft >= 0 && ft < 280 ? 1 - ft / 280 : 0;
    ctx.font = font(700, Math.round(13 + 7 * pop));
    ctx.fillStyle = hud.mult >= 4 ? "#ff9f45" : hud.mult >= 3 ? "#ffd23f" : "#45e0e8";
    ctx.fillText("×" + hud.mult + " · " + hud.chain + " chain", 18, 92 + pop * 2);
  } else if (cbt >= 0 && cbt < C.CHAIN_BREAK_MS) {
    // …and when it goes, it goes struck through, where it used to live
    const q = cbt / C.CHAIN_BREAK_MS;
    const label = "×" + C.multOf(cb.chain) + " · " + cb.chain + " chain";
    ctx.globalAlpha = (1 - q) * 0.9;
    ctx.font = font(700, 13);
    ctx.fillStyle = "#5f6b8c";
    ctx.fillText(label, 18, 92);
    const w = ctx.measureText(label).width;
    ctx.strokeStyle = "#ff5470";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(18, 88);
    ctx.lineTo(18 + w * Math.min(1, q * 3), 88);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.textAlign = "right";
  ctx.font = font(700, 13);
  ctx.fillStyle = "#5f6b8c";
  ctx.fillText("LV " + hud.level, G.w - 70, 34);

  const oc = hud.overclock;
  const low = hud.timeLeft < C.LOW_TIME;
  const barX = 18, barY = 48, barW = G.w - 36, barH = 8;
  ctx.fillStyle = "#2f3a57";
  ctx.fillRect(barX, barY, barW, barH);
  if (low && hud.mode === "playing") {
    // the last seconds beat
    ctx.globalAlpha = rm ? 0.85 : 0.72 + 0.28 * Math.sin(now / 105);
  }
  ctx.fillStyle = low ? "#ff5470" : oc ? "#ff9f45" : "#45e0e8";
  ctx.fillRect(barX, barY, barW * hud.timeFrac, barH);
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
  ctx.font = font(600, 11);
  ctx.fillStyle = "#5f6b8c";
  ctx.fillText(hud.timeLeft.toFixed(1) + "s", barX, barY + 24);
  if (oc && hud.mode === "playing") {
    ctx.fillStyle = "#ff9f45";
    ctx.fillText("OVERCLOCK ×" + hud.overclockFactor.toFixed(2), barX + 60, barY + 24);
  }

  // Low-time urgency: a red frame closing in on the board. Two strokeRects, so
  // it costs nothing, and it holds steady instead of pulsing under reduced
  // motion.
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

  const ht = now - state.fx.hurtT0;
  if (hud.mode === "playing" && ht >= 0 && ht < C.HURT_FLASH_MS) {
    const a = 0.18 * (1 - ht / C.HURT_FLASH_MS) * (rm ? C.RM.flash : 1);
    ctx.fillStyle = "rgba(255,84,112," + a.toFixed(3) + ")";
    ctx.fillRect(0, 0, G.w, G.h);
  }

  if (hud.mode === "playing" && hud.paused) {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(27,34,51,0.75)";
    ctx.fillRect(0, 0, G.w, G.h);
    ctx.fillStyle = "#aab4ce";
    ctx.font = font(700, 24);
    ctx.fillText("PAUSED", G.w / 2, G.h / 2 - 8);
    ctx.font = font(600, 13);
    ctx.fillStyle = "#5f6b8c";
    ctx.fillText("P to resume", G.w / 2, G.h / 2 + 20);
  }
}
