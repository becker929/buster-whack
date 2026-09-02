/*!
 * Canvas renderer.
 *
 * `draw(ctx, state, now)` takes a 2D context, a plain state object (which
 * carries its own geometry in `state.G`) and a time in ms. It touches no DOM:
 * no document, no window, no element lookups, no getBoundingClientRect — so
 * the same frame can be drawn off-screen against any CanvasRenderingContext2D
 * implementation. It never mutates the state either.
 */

import * as C from "../core/constants.js";
import { hudView } from "../core/select.js";

const { EASE, impulseValue } = C;

const panel = (G, col, row) => C.panelRect(G, col, row);

const SKINS = {
  mett:   { dome: "#ffd23f", stripe: "#c9992a" },
  guard:  { dome: "#aeb9d6", stripe: "#6c7794" },
  hopper: { dome: "#5ee87c", stripe: "#1f7c3d" },
  ally:   { dome: "#58c7ff", stripe: "#2a7ab8" },
  rare:   { dome: "#fff3c4", stripe: "#e8a020" },
};

// ---------- frame ----------

export function draw(ctx, state, now) {
  const G = state.G;
  ctx.clearRect(0, 0, G.w, G.h);

  const ht = now - state.fx.hurtT0;
  const shake = ht >= 0 && ht < C.HURT_SHAKE_MS ? (1 - ht / C.HURT_SHAKE_MS) * 7 : 0;
  ctx.save();
  if (shake) ctx.translate(Math.sin(ht / 18) * shake, Math.cos(ht / 13) * shake * 0.6);

  drawPanels(ctx, state);
  drawAim(ctx, state, now);
  const { rayY, busterX } = drawPlayer(ctx, state, now);
  for (const e of state.enemies) drawEnemy(ctx, state, now, e);
  drawBolts(ctx, state);
  drawShots(ctx, state, now, rayY, busterX);
  drawSparks(ctx, state, now);
  drawPopups(ctx, state, now);
  ctx.restore();

  drawHUD(ctx, state, now);
}

// ---------- board ----------

function drawPanels(ctx, state) {
  const G = state.G;
  for (let r = 0; r < C.ROWS; r++) {
    for (let c = 0; c < C.COLS; c++) {
      const p = panel(G, c, r);
      const mine = c < C.PCOLS;
      ctx.fillStyle = mine ? "#3a2330" : "#1e2c4d";
      ctx.strokeStyle = mine ? "#7c3652" : "#35528f";
      ctx.lineWidth = 2;
      ctx.fillRect(p.x + 3, p.y + 3, p.w - 6, p.h - 6);
      ctx.strokeRect(p.x + 3, p.y + 3, p.w - 6, p.h - 6);
      if (mine && c === state.player.col && r === state.player.row) {
        ctx.strokeStyle = "#45e0e8";
        ctx.strokeRect(p.x + 5, p.y + 5, p.w - 10, p.h - 10);
      }
    }
  }
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

    ctx.fillStyle = b.heavy ? "#ffd23f" : "#ff8ba0";
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

function drawPlayer(ctx, state, now) {
  const G = state.G;
  const p = panel(G, state.player.col, state.player.row);
  const eRecoil = impulseValue(state.fx.recoil, now);
  const rx = -state.fx.recoil.spec.px * eRecoil;

  const bw = G.pw * 0.34, bh = G.ph * 1.15;
  const cx = p.x + p.w / 2 + rx;
  const baseY = p.y + p.h * 0.78;

  const flicker = now < state.hurtUntil && Math.floor(now / 70) % 2 === 0;
  if (flicker) ctx.globalAlpha = 0.35;

  ctx.fillStyle = "#4f8dff";
  ctx.fillRect(cx - bw / 2, baseY - bh, bw, bh);
  ctx.fillStyle = "#2f5fc4";
  ctx.fillRect(cx - bw / 2, baseY - bh, bw, bh * 0.28);
  ctx.fillStyle = "#c9f6ff";
  ctx.fillRect(cx - bw * 0.28, baseY - bh * 0.62, bw * 0.56, bh * 0.14);
  const rayY = baseY - bh * 0.42;
  ctx.fillStyle = "#ffd23f";
  ctx.fillRect(cx + bw / 2 - 2, rayY - 5, bw * 0.55, 10);
  ctx.globalAlpha = 1;

  const cdn = state.charge.downAt;
  if (cdn !== null && state.mode === "playing") {
    const held = now - cdn;
    if (held > 120) {
      const prog = Math.min(1, held / C.CHARGE_MS);
      ctx.beginPath();
      ctx.arc(cx, baseY - bh * 0.5, bw * 0.95, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
      ctx.strokeStyle = state.charge.full
        ? (Math.sin(now / 55) > 0 ? "#45e0e8" : "#c9f6ff")
        : "rgba(69,224,232,0.5)";
      ctx.lineWidth = state.charge.full ? 4 : 2;
      ctx.stroke();
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
    flash = Math.max(0, 1 - t / 70);
    grow = 1 - Math.max(0, (t - C.HIT_MS * 0.55) / (C.HIT_MS * 0.45));
  }

  const ht = now - e.hopT0;
  if (e.state === "up" && ht < C.HOP_GROW_MS) grow *= EASE.out2(ht / C.HOP_GROW_MS);

  if (grow <= 0) return;

  const skin = SKINS[e.type];

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
    ctx.globalAlpha = flash;
    ctx.fillStyle = e.type === "ally" ? "#ff5470" : "#ffffff";
    ctx.fillRect(-bw * 0.6, -bh * 1.05, bw * 1.2, bh * 1.05);
  }
  ctx.restore();
}

// ---------- shots ----------

function drawShots(ctx, state, now, rayY, busterX) {
  const G = state.G;
  const ray = state.fx.ray;
  const rt = now - ray.t0;
  const charged = ray.tier === "charged";

  if (state.mode === "playing" && rt >= 0 && rt < ray.dur + C.RAY_IMPACT_MS) {
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
        ctx.arc(head, y, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(head, y, charged ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (ray.hitCol !== null) {
      // impact: expanding ring where the tracer landed
      const q = (rt - ray.dur) / C.RAY_IMPACT_MS;
      ctx.globalAlpha = 1 - q;
      ctx.strokeStyle = charged ? "#c9f6ff" : "#45e0e8";
      ctx.lineWidth = charged ? 4 : 2;
      ctx.beginPath();
      ctx.arc(ray.x1, y, (charged ? 10 : 6) + (charged ? 26 : 16) * EASE.out2(q), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // muzzle flash: glow + radiating spikes + white core, at the live muzzle
  const mdur = C.MUZZLE_MS[state.fx.muzzleTier] || C.MUZZLE_MS.normal;
  const mt = now - state.fx.muzzleT0;
  if (mt >= 0 && mt < mdur && state.mode === "playing") {
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
    ctx.arc(0, 0, rad, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#ffd23f";
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
    ctx.arc(2, 0, Math.max(0.5, (4.5 - 3 * q) * s), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// ---------- fx ----------

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

function drawPopups(ctx, state, now) {
  ctx.textAlign = "center";
  ctx.font = "700 15px ui-monospace, Menlo, Consolas, monospace";
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

function drawHUD(ctx, state, now) {
  const G = state.G;
  const hud = hudView(state);

  ctx.textAlign = "left";
  ctx.fillStyle = "#aab4ce";
  ctx.font = "700 22px ui-monospace, Menlo, Consolas, monospace";
  ctx.fillText(hud.score, 18, 36);

  if (hud.chain >= 2) {
    ctx.font = "700 13px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillStyle = "#45e0e8";
    ctx.fillText("×" + hud.mult + " · " + hud.chain + " chain", 18, 92);
  }

  ctx.textAlign = "right";
  ctx.font = "700 13px ui-monospace, Menlo, Consolas, monospace";
  ctx.fillStyle = "#5f6b8c";
  ctx.fillText("LV " + hud.level, G.w - 70, 34);

  const oc = hud.overclock;
  const barX = 18, barY = 48, barW = G.w - 36, barH = 8;
  ctx.fillStyle = "#2f3a57";
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = hud.timeLeft < 6 ? "#ff5470" : oc ? "#ff9f45" : "#45e0e8";
  ctx.fillRect(barX, barY, barW * hud.timeFrac, barH);
  ctx.textAlign = "left";
  ctx.font = "600 11px ui-monospace, Menlo, Consolas, monospace";
  ctx.fillStyle = "#5f6b8c";
  ctx.fillText(hud.timeLeft.toFixed(1) + "s", barX, barY + 24);
  if (oc && hud.mode === "playing") {
    ctx.fillStyle = "#ff9f45";
    ctx.fillText("OVERCLOCK ×" + hud.overclockFactor.toFixed(2), barX + 60, barY + 24);
  }

  const ht = now - state.fx.hurtT0;
  if (hud.mode === "playing" && ht >= 0 && ht < C.HURT_FLASH_MS) {
    ctx.fillStyle = "rgba(255,84,112," + (0.18 * (1 - ht / C.HURT_FLASH_MS)).toFixed(3) + ")";
    ctx.fillRect(0, 0, G.w, G.h);
  }

  if (hud.mode === "playing" && hud.paused) {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(27,34,51,0.75)";
    ctx.fillRect(0, 0, G.w, G.h);
    ctx.fillStyle = "#aab4ce";
    ctx.font = "700 24px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillText("PAUSED", G.w / 2, G.h / 2 - 8);
    ctx.font = "600 13px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillStyle = "#5f6b8c";
    ctx.fillText("P to resume", G.w / 2, G.h / 2 + 20);
  }
}
