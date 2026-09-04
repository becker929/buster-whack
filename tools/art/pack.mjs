// Build an art pack from a folder of cells.
//
//   node tools/art/pack.mjs <dir>
//
// <dir>/cells/<entity>__<state>__<frame>.png   the art (any subset)
// <dir>/pack.json                               optional: { name, smooth, anchors: { "<entity>": { ax, ay } } }
//
// Writes <dir>/atlas.png and <dir>/manifest.json. Every cell is checked
// against the manifest the game derives at the reference panel size: unknown
// entities or states are refused, frames beyond a state's count are refused,
// and a cell whose size differs from the reference is accepted and scaled at
// load (its anchor comes from pack.json or from the reference, scaled). Cells
// a pack does not provide fall back to pack zero in the game, and the report
// says which.
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { manifestFor } from "../../src/shell/painters.js";

/** The panel size packs are authored at: a 900x640 stage's board. */
export const REFERENCE_G = { pw: 96, ph: 59.52 };

/** Shelf-pack cells into one atlas; returns the canvas and the manifest. */
export function packAtlas(cells, { name = "pack", smooth = false } = {}) {
  const PAD = 2;
  const sorted = [...cells].sort((a, b) => b.h - a.h);
  const W = 1024;
  let x = PAD, y = PAD, rowH = 0;
  for (const c of sorted) {
    if (x + c.w + PAD > W) { x = PAD; y += rowH + PAD; rowH = 0; }
    c.x = x; c.y = y; x += c.w + PAD; rowH = Math.max(rowH, c.h);
  }
  const H = y + rowH + PAD;
  const atlas = createCanvas(W, H);
  const ctx = atlas.getContext("2d");
  const entities = {};
  for (const c of sorted) {
    ctx.drawImage(c.canvas, c.x, c.y);
    const ent = (entities[c.id] ||= { states: {} });
    const st = (ent.states[c.st] ||= { ms: c.ms || 0, frames: [] });
    st.frames[c.frame] = { x: c.x, y: c.y, w: c.w, h: c.h, ax: c.ax, ay: c.ay };
  }
  const manifest = { version: 1, name, smooth, atlas: "atlas.png", reference: REFERENCE_G, entities };
  return { atlas, manifest };
}

export function writePack(dir, atlas, manifest) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "atlas.png"), atlas.toBuffer("image/png"));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

async function main(dir) {
  const ref = manifestFor(REFERENCE_G);
  const opts = fs.existsSync(path.join(dir, "pack.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "pack.json"), "utf8")) : {};
  const anchors = opts.anchors || {};
  const files = fs.readdirSync(path.join(dir, "cells")).filter((f) => f.endsWith(".png"));
  const cells = [];
  const problems = [];
  for (const f of files) {
    const m = /^(.+?)__(.+?)__(\d+)\.png$/.exec(f);
    if (!m) { problems.push(`${f}: name is not <entity>__<state>__<frame>.png`); continue; }
    const [, id, st, fs_] = m; const frame = Number(fs_);
    const ent = ref.entities[id];
    if (!ent) { problems.push(`${f}: unknown entity ${id}`); continue; }
    const spec = ent.states[st];
    if (!spec) { problems.push(`${f}: ${id} has no state ${st}`); continue; }
    if (frame >= spec.frames) { problems.push(`${f}: ${id}/${st} has ${spec.frames} frame(s)`); continue; }
    const img = await loadImage(path.join(dir, "cells", f));
    const cv = createCanvas(img.width, img.height);
    cv.getContext("2d").drawImage(img, 0, 0);
    // the anchor: given, or the reference's scaled to this cell's size
    const a = anchors[id] || { ax: ent.cell.ax * (img.width / ent.cell.w), ay: ent.cell.ay * (img.height / ent.cell.h) };
    cells.push({ id, st, frame, w: img.width, h: img.height, ax: a.ax, ay: a.ay, ms: spec.ms, canvas: cv });
  }
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  // what falls back to pack zero
  const have = new Set(cells.map((c) => `${c.id}/${c.st}/${c.frame}`));
  const missing = [];
  for (const [id, ent] of Object.entries(ref.entities)) for (const [st, spec] of Object.entries(ent.states))
    for (let f = 0; f < spec.frames; f++) if (!have.has(`${id}/${st}/${f}`)) missing.push(`${id}/${st}/${f}`);
  const { atlas, manifest } = packAtlas(cells, { name: opts.name || path.basename(dir), smooth: !!opts.smooth });
  writePack(dir, atlas, manifest);
  console.log(`packed ${cells.length} cells into ${dir}/atlas.png (${atlas.width}x${atlas.height}); ${missing.length} fall back to pack zero`);
  if (missing.length && missing.length <= 40) console.log("  " + missing.join("\n  "));
}

if (process.argv[1] && process.argv[1].endsWith("pack.mjs") && process.argv[2]) {
  main(process.argv[2]).catch((e) => { console.error(e); process.exit(1); });
}
