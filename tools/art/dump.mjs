// Dump pack zero: bake the painters at the reference panel size and write an
// art pack an artist can start from -- every cell as its own PNG, the atlas,
// and the manifest that ties them together.
//
//   node tools/art/dump.mjs [outDir]        default art/procedural
//
// Cell files are named <entity>__<state>__<frame>.png. Replace any of them,
// keep the size and the anchor, and `node tools/art/pack.mjs <dir>` builds a
// pack the game can load with mountBusterWhack(el, { artUrl }).
import fs from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { manifestFor } from "../../src/shell/painters.js";
import { REFERENCE_G, packAtlas, writePack } from "./pack.mjs";

const out = process.argv[2] || "art/procedural";
const m = manifestFor(REFERENCE_G);
const cells = [];
for (const [id, ent] of Object.entries(m.entities)) {
  for (const [st, spec] of Object.entries(ent.states)) {
    for (let f = 0; f < spec.frames; f++) {
      const { w, h, ax, ay } = ent.cell;
      const cv = createCanvas(w, h);
      const c = cv.getContext("2d");
      c.translate(ax, ay);
      ent.paint(c, f, st);
      cells.push({ id, st, frame: f, w, h, ax, ay, ms: spec.ms, canvas: cv });
    }
  }
}
fs.mkdirSync(path.join(out, "cells"), { recursive: true });
for (const c of cells) {
  fs.writeFileSync(path.join(out, "cells", `${c.id}__${c.st}__${c.frame}.png`), c.canvas.toBuffer("image/png"));
}
const { atlas, manifest } = packAtlas(cells, { name: "procedural", smooth: false });
writePack(out, atlas, manifest);
console.log(`dumped ${cells.length} cells to ${out}/cells, atlas ${atlas.width}x${atlas.height}`);
