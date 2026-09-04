// The art identity check: pack zero is the procedural art, pixel for pixel.
//
//   1. Every cell the manifest names, at several panel sizes: the baked
//      raster blitted at an integer origin equals the painter drawn there.
//   2. Every scenario flagged `artIdentity`: the frame rendered through the
//      pack equals the frame rendered by the painters alone.
//
// Exit 1 on the first difference, naming it. No fonts are involved: bodies
// carry no text.
import { createCanvas } from "@napi-rs/canvas";
import { createArt } from "../src/shell/art.js";
import { manifestFor } from "../src/shell/painters.js";
import { runScenario, scenarios } from "./visual/harness.js";

const SIZES = [
  { pw: 58.5, ph: 36.27 },   // a 390px phone
  { pw: 96, ph: 59.52 },     // the reference pack size
  { pw: 126.67, ph: 78.53 }, // 900x640
  { pw: 120, ph: 74.4 },     // 800x600
];

let checked = 0;
function same(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

for (const G of SIZES) {
  const art = createArt({ makeCanvas: (w, h) => createCanvas(w, h) });
  art.ensure(G, 1);
  const m = manifestFor(G);
  for (const [id, ent] of Object.entries(m.entities)) {
    for (const [st, spec] of Object.entries(ent.states)) {
      for (let f = 0; f < spec.frames; f++) {
        const { w, h, ax, ay } = ent.cell;
        // a: the pack's cell, drawn where the renderer would draw it
        const a = createCanvas(w + 10, h + 10), ac = a.getContext("2d");
        ac.translate(ax + 5, ay + 5);
        if (!art.paint(ac, id, st, f)) throw new Error("no cell for " + id + "/" + st + "/" + f);
        // b: the painter, at the same integer origin
        const b = createCanvas(w + 10, h + 10), bc = b.getContext("2d");
        bc.translate(ax + 5, ay + 5);
        ent.paint(bc, f, st);
        const pa = ac.getImageData(0, 0, w + 10, h + 10).data, pb = bc.getImageData(0, 0, w + 10, h + 10).data;
        if (!same(pa, pb)) {
          let n = 0; for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) n++;
          console.error(`art-check: ${id}/${st}/${f} at pw=${G.pw}: raster differs from painter (${n} bytes)`);
          process.exit(1);
        }
        // c: nothing painted outside the cell (the box is big enough)
        const edge = [];
        for (let x = 0; x < w + 10; x++) for (const y of [0, 1, 2, h + 7, h + 8, h + 9]) edge.push((y * (w + 10) + x) * 4 + 3);
        for (let y = 0; y < h + 10; y++) for (const x of [0, 1, 2, w + 7, w + 8, w + 9]) edge.push((y * (w + 10) + x) * 4 + 3);
        if (edge.some((i) => pb[i] !== 0)) {
          console.error(`art-check: ${id}/${st}/${f} at pw=${G.pw}: the painter draws outside its cell`);
          process.exit(1);
        }
        checked++;
      }
    }
  }
}
console.log(`art-check: ${checked} cells identical to their painters across ${SIZES.length} panel sizes`);

// Scenes. A cell is opaque paint and clear space, so through the pack a body
// lands exactly as the painter would -- except at its antialiased edge, where
// Canvas2D stores a partly covered pixel premultiplied in 8 bits before it is
// composited, and rounds. That is the compositor's arithmetic, not the art's.
// A pixel where two edges meet -- the corner of a stripe, a slot in a visor --
// is covered partly in both axes and rounds hardest, which is where the bound
// below comes from: eight units on a handful of corner pixels. The share is
// the real guard. A moved body, a changed colour or a lost frame moves whole
// regions, not corners, and fails on both counts.
import { PNG } from "pngjs";
const MAX_DELTA = 8, MAX_SHARE = 0.005;
let scenes = 0;
for (const sc of scenarios) {
  if (!sc.artIdentity) continue;
  const withPack = runScenario(sc, { fonts: true });
  const painters = runScenario(sc, { fonts: true, art: null });
  for (let i = 0; i < withPack.length; i++) {
    const a = PNG.sync.read(withPack[i].png).data, b = PNG.sync.read(painters[i].png).data;
    let n = 0, max = 0;
    for (let k = 0; k < a.length; k++) { const d = Math.abs(a[k] - b[k]); if (d) { n++; if (d > max) max = d; } }
    const share = n / a.length;
    if (max > MAX_DELTA || share > MAX_SHARE) {
      console.error(`art-check: scene ${sc.name}/${withPack[i].label}: pack vs painters differ beyond edge rounding (max delta ${max}, ${(share * 100).toFixed(3)}% of bytes)`);
      process.exit(1);
    }
    console.log(`art-check: scene ${sc.name}/${withPack[i].label}: max delta ${max}, ${(share * 100).toFixed(3)}% of bytes (edge rounding only)`);
    scenes++;
  }
}
console.log(`art-check: ${scenes} scene frames agree through the pack and through the painters`);
