/*!
 * Painters: the bodies of things, drawn at the origin.
 *
 * Every character the game shows -- the buster, each virus, the sentinel's
 * marks, the people on the towers, the journal, a bomb on the road -- is a
 * painter here: a pure function of a size and a frame that draws the body
 * with its anchor at (0, 0). Nothing in this file reads the state, the
 * clock, or the DOM. The renderer decides where and how big; an art pack may
 * replace any painter with a raster of the same cell.
 *
 * These are pack zero: the procedural art the game shipped with. `art.js`
 * bakes them into an atlas at the current panel size, and the identity check
 * (tools/art-check.mjs) asserts that a baked cell blitted at an integer
 * origin is byte-for-byte the painter drawn there.
 *
 * Animation is by frame, not by continuous time, so a frame can be a raster:
 * a state names how many frames it has and how long each lasts, and the
 * renderer picks the frame from the clock. Effects that are not a body -- the
 * charge glow, a hit flash, debris, rings, bolts -- stay in the renderer.
 */

import { RING_GAP } from "../core/constants.js";

// ---------- palettes ----------

export const SKINS = {
  mett:   { dome: "#ffd23f", stripe: "#c9992a" },
  guard:  { dome: "#aeb9d6", stripe: "#6c7794" },
  hopper: { dome: "#5ee87c", stripe: "#1f7c3d" },
  ally:   { dome: "#58c7ff", stripe: "#2a7ab8" },
  rare:   { dome: "#fff3c4", stripe: "#e8a020" },
  // the later rot and static: each wears the family's hue, darker and harder
  spreader: { dome: "#ffa23f", stripe: "#a85a12" },
  warden:   { dome: "#c07be0", stripe: "#5f2f7a" },
  darter:   { dome: "#3fd8b0", stripe: "#12705a" },
  // the sentinel is drawn on its own path below; this is for debris and ghosts
  sentinel: { dome: "#b48cff", stripe: "#5a3f9a" },
};
// Sentinel iris colour by mark: violet, magenta, red -- none of them a colour
// any other virus wears, so the mark reads before the shape does.
export const SENTINEL_CORE = { 1: "#c48cff", 2: "#ff6fd8", 3: "#ff4d4d" };

// each person on a tower has their own colours; anyone not listed gets the keeper's
export const KEEPER = { robe: "#c9b6ff", hood: "#7d63c4", face: "#fff3c4", eye: "#2b1f4a" };
export const PEOPLE = {
  "npc.keeper.01":     { robe: "#ffd7e0", hood: "#c45b7a", face: "#fff3c4", eye: "#3a1a26" },
  "npc.keeper.02":     { robe: "#c9f6ff", hood: "#2f8fd6", face: "#fff3c4", eye: "#0f2a44" },
  "npc.keeper.03":     { robe: "#e8dcc0", hood: "#7a5a2e", face: "#fff3c4", eye: "#2b1f0a" },
  "npc.keeper.04":     { robe: "#ffcf9a", hood: "#a54b1e", face: "#fff3c4", eye: "#3a1a06" },
  "npc.keeper.05":     { robe: "#c8ffb0", hood: "#3f9a4a", face: "#fff3c4", eye: "#0f2a12" },
  "npc.side.bean":     { robe: "#e2ffd2", hood: "#6ab86f", face: "#fff3c4", eye: "#0f2a12", small: true },
  "npc.side.tally":    { robe: "#dfe6f2", hood: "#5c6f8f", face: "#fff3c4", eye: "#1a2233" },
  "npc.side.vesper":   { robe: "#d9d2f0", hood: "#4a4470", face: "#fff3c4", eye: "#1a1830", small: true },
  "npc.side.rivet":    { robe: "#ffe0b0", hood: "#c07a2a", face: "#fff3c4", eye: "#3a1a06", small: true },
  "boss.ferryman":     { robe: "#ffffff", hood: "#9fb4c8", face: "#e8f4ff", eye: "#2a3a4a" },
  "npc.sweeper.tidy":  { robe: "#f0f0f0", hood: "#b5b5b5", face: "#ffffff", eye: "#444" },
  "boss.foreman":      { robe: "#f4f4f4", hood: "#8a8a8a", face: "#ffffff", eye: "#444" },
};

// ---------- sizes ----------
// Body sizes in px from the panel size. The renderer and the baker both use
// these, so a cell is always the size the renderer will ask for.

export const enemyBox = (G) => ({ bw: G.pw * 0.4, bh: G.ph * 1.0 });
export const playerBox = (G) => ({ bw: G.pw * 0.34, bh: G.ph * 1.15 });
export const keeperBox = (G, small) => { const s = small ? 0.72 : 1; return { w: G.pw * 0.3 * s, h: G.ph * 1.0 * s }; };
export const itemBox = (G) => ({ w: G.pw * 0.36, h: G.ph * 0.3 });
export const pickupRadius = (G) => Math.min(G.pw, G.ph) * 0.16;

// ---------- the sentinel's iris, by frame ----------

export const SENTINEL_OPEN_FRAMES = 6;
/** Shutter gap for an open frame: parted wide at first, closing in as the spell is spent. */
export const irisGap = (frame) => 0.18 + 0.5 * (1 - (frame + 0.5) / SENTINEL_OPEN_FRAMES);

/** `fg` over `bg` at alpha `a`, as an opaque hex colour. */
export function blend(fg, bg, a) {
  const f = parseInt(fg.slice(1), 16), b = parseInt(bg.slice(1), 16);
  const ch = (sh) => Math.round(((f >> sh) & 255) * a + ((b >> sh) & 255) * (1 - a));
  return "#" + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, "0")).join("");
}

// ---------- painters ----------
// Each draws with its anchor at (0,0): the foot of a standing thing, the
// centre of a lying one. `size` is the box from the functions above.

/** A virus that is not a sentinel: dome, stripe, and the face its type wears. */
export function paintEnemy(ctx, { bw, bh }, type) {
  const skin = SKINS[type] || SKINS.mett;
  ctx.fillStyle = skin.dome;
  ctx.beginPath();
  ctx.arc(0, -bh * 0.42, bw * 0.55, Math.PI, 0);
  ctx.lineTo(bw * 0.55, -bh * 0.1);
  ctx.lineTo(-bw * 0.55, -bh * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = skin.stripe;
  ctx.fillRect(-bw * 0.08, -bh * 0.98, bw * 0.16, bh * 0.5);

  if (type === "guard") {
    ctx.fillStyle = "#6c7794";
    ctx.fillRect(-bw * 0.55, -bh * 0.34, bw * 1.1, bh * 0.1);
    ctx.fillStyle = "#232c42";
    ctx.fillRect(-bw * 0.42, -bh * 0.24, bw * 0.84, bh * 0.12);
  } else if (type === "ally") {
    // white face plate with a plus mark: friend, don't shoot
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-bw * 0.42, -bh * 0.36, bw * 0.84, bh * 0.26);
    ctx.fillStyle = "#2a7ab8";
    ctx.fillRect(-bw * 0.06, -bh * 0.34, bw * 0.12, bh * 0.22);
    ctx.fillRect(-bw * 0.24, -bh * 0.28, bw * 0.48, bh * 0.1);
  } else if (type === "spreader") {
    // three vents across the visor: it fires into three lanes at once
    ctx.fillStyle = "#232c42";
    ctx.fillRect(-bw * 0.46, -bh * 0.34, bw * 0.92, bh * 0.24);
    ctx.fillStyle = "#ffd7a8";
    for (const dx of [-0.32, -0.06, 0.2]) ctx.fillRect(bw * dx, -bh * 0.3, bw * 0.12, bh * 0.16);
  } else if (type === "warden") {
    // one wide slot: the wall it throws is as broad as the lane
    ctx.fillStyle = "#232c42";
    ctx.fillRect(-bw * 0.5, -bh * 0.34, bw * 1.0, bh * 0.24);
    ctx.fillStyle = "#f0d7ff";
    ctx.fillRect(-bw * 0.38, -bh * 0.29, bw * 0.76, bh * 0.13);
  } else if (type === "darter") {
    // a pair of eyes set close: it shoots twice down one lane
    ctx.fillStyle = "#232c42";
    ctx.fillRect(-bw * 0.42, -bh * 0.34, bw * 0.84, bh * 0.24);
    ctx.fillStyle = "#d8fff4";
    ctx.fillRect(-bw * 0.16, -bh * 0.3, bw * 0.1, bh * 0.14);
    ctx.fillRect(bw * 0.06, -bh * 0.3, bw * 0.1, bh * 0.14);
  } else {
    ctx.fillStyle = "#232c42";
    ctx.fillRect(-bw * 0.42, -bh * 0.34, bw * 0.84, bh * 0.24);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-bw * 0.26, -bh * 0.3, bw * 0.12, bh * 0.14);
    ctx.fillRect(bw * 0.14, -bh * 0.3, bw * 0.12, bh * 0.14);
  }
}

/**
 * The Sentinel: a hexagonal housing with an iris. Closed (frame null) it is a
 * steel slab with a seam; open, the shutters part and the core shows in the
 * mark's colour, the gap closing frame by frame as the spell runs out.
 */
export function paintSentinel(ctx, { bw, bh }, tier, openFrame) {
  const open = openFrame !== null && openFrame !== undefined;
  const core = SENTINEL_CORE[tier] || SENTINEL_CORE[1];
  const R = bw * 0.62, cy = -bh * 0.44;
  // housing
  ctx.fillStyle = "#3a3452";
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const x = Math.cos(a) * R, y = cy + Math.sin(a) * R * 0.92;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#6a5f8f";
  ctx.lineWidth = 2;
  ctx.stroke();
  // pedestal
  ctx.fillStyle = "#2a2540";
  ctx.fillRect(-bw * 0.34, -bh * 0.12, bw * 0.68, bh * 0.1);
  // iris. The core is drawn opaque in a pre-blended colour (open: nearly the
  // mark's colour; closed: the mark dimmed into the housing) rather than with
  // globalAlpha: a body painter never composites, so a cell is opaque paint
  // and clear space and lands the same on any background.
  const gap = open ? irisGap(openFrame) : 0.04;
  const half = R * 0.62;
  ctx.fillStyle = blend(core, "#3a3452", open ? 0.92 : 0.25);
  ctx.beginPath();
  ctx.arc(0, cy, half * 0.62, 0, Math.PI * 2 - RING_GAP);
  ctx.fill();
  ctx.fillStyle = "#1a1728";
  ctx.fillRect(-half, cy - half, half * 2, half * (1 - gap));            // upper shutter
  ctx.fillRect(-half, cy + half * gap, half * 2, half * (1 - gap));      // lower shutter
  // mark pips on the housing
  ctx.fillStyle = core;
  for (let i = 0; i < (tier || 1); i++) ctx.fillRect(-bw * 0.26 + i * bw * 0.16, cy + R * 0.7, bw * 0.1, 3);
}

/** The buster: a blue column with a visor and the barrel out to the right. */
export function paintPlayer(ctx, { bw, bh }, full) {
  ctx.fillStyle = "#4f8dff";
  ctx.fillRect(-bw / 2, -bh, bw, bh);
  ctx.fillStyle = "#2f5fc4";
  ctx.fillRect(-bw / 2, -bh, bw, bh * 0.28);
  ctx.fillStyle = "#c9f6ff";
  ctx.fillRect(-bw * 0.28, -bh * 0.62, bw * 0.56, bh * 0.14);
  const rayY = -bh * 0.42;
  ctx.fillStyle = full ? "#fff3c4" : "#ffd23f";
  ctx.fillRect(bw / 2 - 2, rayY - 5, bw * 0.55, 10);
}

/** A person on a tower: a hooded figure. Frame 1 is the breath: one pixel lower. */
export function paintKeeper(ctx, { w, h }, look, frame = 0) {
  const dy = frame ? 1 : 0;
  ctx.fillStyle = look.robe;
  ctx.fillRect(-w / 2, -h + dy, w, h - dy);
  ctx.fillStyle = look.hood;
  ctx.fillRect(-w * 0.6, -h - h * 0.12 + dy, w * 1.2, h * 0.42);
  ctx.fillStyle = look.face;
  ctx.fillRect(-w * 0.32, -h + h * 0.06 + dy, w * 0.64, h * 0.2);
  ctx.fillStyle = look.eye;
  ctx.fillRect(-w * 0.2, -h + h * 0.12 + dy, 3, 3);
  ctx.fillRect(w * 0.2 - 3, -h + h * 0.12 + dy, 3, 3);
}

/** A thing to read: a book, scorched, on what was a shelf. Anchored at its centre. */
export function paintItem(ctx, { w, h }) {
  ctx.fillStyle = "#2a2226";
  ctx.fillRect(-w * 0.6, h * 0.5, w * 1.2, 4);
  ctx.fillStyle = "#6b4a3a";
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = "#c9b18f";
  ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6);
  ctx.fillStyle = "#3a2a22";
  ctx.fillRect(-w / 2 + 6, -1, w * 0.5, 2);
  ctx.fillRect(-w / 2 + 6, 4, w * 0.35, 2);
}

/** A bomb on the road: a dark sphere with a fuse. Frame 1 is the fuse's other blink. */
export function paintPickup(ctx, r, frame = 0) {
  ctx.fillStyle = "#1a1f33";
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2 - RING_GAP); ctx.fill();
  ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(r * 0.4, -r * 0.8); ctx.lineTo(r * 1.1, -r * 1.6); ctx.stroke();
  ctx.fillStyle = frame ? "#ffffff" : "#ff5470";
  ctx.fillRect(r * 1.0, -r * 1.8, 3, 3);
}

// ---------- the manifest ----------
// What a pack must contain. Cells are sized from the panel so a pack baked
// for one stage size fits that stage exactly; the same function gives an
// external pack its reference size.

const ceil = Math.ceil;

/**
 * Every entity, its states, and the cell each frame occupies at panel size G.
 * A cell is { w, h, ax, ay }: integer size and the anchor's position in it.
 * `paint(ctx, frame)` draws that entity's frame at the origin.
 */
export function manifestFor(G) {
  const ents = {};
  const eb = enemyBox(G), pb = playerBox(G), ib = itemBox(G), pr = pickupRadius(G);

  const bodyCell = (halfW, up, down) => ({ w: 2 * ceil(halfW) + 4, h: ceil(up) + ceil(down) + 4, ax: ceil(halfW) + 2, ay: ceil(up) + 2 });

  for (const type of ["mett", "guard", "hopper", "ally", "rare", "spreader", "warden", "darter"]) {
    ents["enemy." + type] = {
      cell: bodyCell(eb.bw * 0.62, eb.bh * 1.0, 0),
      states: { up: { frames: 1, ms: 0 } },
      paint: (ctx) => paintEnemy(ctx, eb, type),
    };
  }
  for (const tier of [1, 2, 3]) {
    ents["sentinel." + tier] = {
      cell: bodyCell(eb.bw * 0.7, eb.bh * 0.44 + eb.bw * 0.62 + 2, 0),
      // the open frames follow the spell, not the clock: the renderer picks one
      states: { closed: { frames: 1, ms: 0 }, open: { frames: SENTINEL_OPEN_FRAMES, ms: 0, byPhase: true } },
      paint: (ctx, frame, st) => paintSentinel(ctx, eb, tier, st === "open" ? frame : null),
    };
  }
  ents.player = {
    cell: { w: ceil(pb.bw / 2) + ceil(pb.bw / 2 + pb.bw * 0.55) + 4, h: ceil(pb.bh) + 4, ax: ceil(pb.bw / 2) + 2, ay: ceil(pb.bh) + 2 },
    states: { idle: { frames: 1, ms: 0 }, charged: { frames: 1, ms: 0 } },
    paint: (ctx, frame, st) => paintPlayer(ctx, pb, st === "charged"),
  };
  const people = { default: KEEPER, ...PEOPLE };
  for (const [id, look] of Object.entries(people)) {
    const kb = keeperBox(G, look.small);
    ents["keeper." + id] = {
      cell: bodyCell(kb.w * 0.6, kb.h * 1.12, 1),
      states: { idle: { frames: 2, ms: 700 } },
      paint: (ctx, frame) => paintKeeper(ctx, kb, look, frame),
    };
  }
  ents["item.journal"] = {
    cell: { w: 2 * ceil(ib.w * 0.6) + 4, h: ceil(ib.h / 2) + ceil(ib.h * 0.5 + 4) + 4, ax: ceil(ib.w * 0.6) + 2, ay: ceil(ib.h / 2) + 2 },
    states: { idle: { frames: 1, ms: 0 } },
    paint: (ctx) => paintItem(ctx, ib),
  };
  ents["pickup.bomb"] = {
    cell: { w: 2 * ceil(pr * 1.3) + 6, h: ceil(pr * 1.9) + ceil(pr) + 6, ax: ceil(pr * 1.3) + 3, ay: ceil(pr * 1.9) + 3 },
    states: { idle: { frames: 2, ms: 120 } },
    paint: (ctx, frame) => paintPickup(ctx, pr, frame),
  };
  return { pw: G.pw, ph: G.ph, entities: ents };
}

/** The frame a looping state shows at `now`: quantized, so it can be a raster. */
export function frameAt(spec, now) {
  if (!spec || spec.frames <= 1 || !spec.ms) return 0;
  return Math.floor(now / spec.ms) % spec.frames;
}
