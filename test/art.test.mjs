// The art pack: the manifest is integer and complete, pack zero is the
// painters exactly, an external pack overlays it cell by cell and falls back
// where it is silent, and loading a pack never throws.

import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { manifestFor, frameAt, PEOPLE } from "../src/shell/painters.js";
import { createArt, loadArtPack } from "../src/shell/art.js";
import { layout } from "../src/core/constants.js";

const G = layout(900, 640);
const mk = (w, h) => createCanvas(w, h);
const pixels = (cv) => cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;

test("the manifest names every body with an integer cell and an anchor inside it", () => {
  const m = manifestFor(G);
  const ids = Object.keys(m.entities);
  for (const need of ["player", "enemy.mett", "enemy.guard", "enemy.hopper", "enemy.ally", "enemy.rare",
                      "sentinel.1", "sentinel.2", "sentinel.3", "keeper.default", "item.journal", "pickup.bomb"]) {
    assert.ok(ids.includes(need), need);
  }
  for (const id of Object.keys(PEOPLE)) assert.ok(ids.includes("keeper." + id), "keeper." + id);
  for (const [id, ent] of Object.entries(m.entities)) {
    const { w, h, ax, ay } = ent.cell;
    for (const v of [w, h, ax, ay]) assert.ok(Number.isInteger(v) && v >= 0, id + " cell is integer");
    assert.ok(ax <= w && ay <= h, id + " anchor inside the cell");
    assert.ok(Object.keys(ent.states).length >= 1);
    for (const [st, spec] of Object.entries(ent.states)) {
      assert.ok(spec.frames >= 1, id + "/" + st);
      assert.ok(spec.frames === 1 || spec.ms > 0 || spec.byPhase, id + "/" + st + " animates by time or by a phase the renderer picks");
    }
    assert.equal(typeof ent.paint, "function");
  }
  assert.equal(manifestFor(G).entities["sentinel.1"].states.open.frames, 6);
});

test("frames quantize by the state's timing", () => {
  assert.equal(frameAt({ frames: 1, ms: 0 }, 12345), 0);
  assert.equal(frameAt({ frames: 2, ms: 700 }, 0), 0);
  assert.equal(frameAt({ frames: 2, ms: 700 }, 700), 1);
  assert.equal(frameAt({ frames: 2, ms: 700 }, 1400), 0);
  assert.equal(frameAt({ frames: 4, ms: 100 }, 350), 3);
  assert.equal(frameAt(undefined, 99), 0);
});

test("pack zero is the painters, byte for byte, and bakes once per layout", () => {
  const art = createArt({ makeCanvas: mk });
  art.ensure(G, 1);
  const before = art.cells;
  art.ensure(G, 1);
  assert.equal(art.cells, before, "the same layout does not re-bake");
  art.ensure(G, 2);
  assert.notEqual(art.cells, before, "a new device scale does");
  art.ensure(G, 1);
  const m = art.manifest;
  for (const id of ["enemy.hopper", "player", "keeper.npc.keeper.03", "sentinel.2"]) {
    const ent = m.entities[id];
    const st = Object.keys(ent.states)[0];
    const { w, h, ax, ay } = ent.cell;
    const a = mk(w + 8, h + 8), b = mk(w + 8, h + 8);
    const ac = a.getContext("2d"), bc = b.getContext("2d");
    ac.translate(ax + 4, ay + 4); bc.translate(ax + 4, ay + 4);
    assert.equal(art.paint(ac, id, st, 0), true);
    ent.paint(bc, 0, st);
    assert.deepEqual(Buffer.from(pixels(a)), Buffer.from(pixels(b)), id + " raster equals painter");
    assert.ok(pixels(a).some((v) => v !== 0), id + " actually drew something");
  }
  assert.equal(art.paint(mk(4, 4).getContext("2d"), "enemy.dragon", "up", 0), false, "an unknown body is not drawn");
  assert.equal(art.pack, "procedural");
});

test("an external pack overlays the cells it names and leaves the rest to pack zero", () => {
  const art = createArt({ makeCanvas: mk });
  art.ensure(G, 1);
  const ent = art.manifest.entities["enemy.mett"];
  const { w, h, ax, ay } = ent.cell;
  // a pack with one cell: a solid magenta square the size of the mett's cell
  const atlas = mk(w + 20, h + 20);
  const c = atlas.getContext("2d");
  c.fillStyle = "#ff00ff"; c.fillRect(10, 10, w, h);
  art.applyPack({ manifest: { name: "test", smooth: false, entities: { "enemy.mett": { states: { up: { ms: 0, frames: [{ x: 10, y: 10, w, h, ax, ay }] } } } } }, image: atlas });
  assert.equal(art.pack, "test");
  const out = mk(w + 8, h + 8), oc = out.getContext("2d");
  oc.translate(ax + 4, ay + 4);
  art.paint(oc, "enemy.mett", "up", 0);
  const px = pixels(out);
  // the centre of the cell is magenta now
  const i = ((ay + 4 - Math.floor(h / 2)) * (w + 8) + (ax + 4)) * 4;
  assert.deepEqual([px[i], px[i + 1], px[i + 2]], [255, 0, 255]);
  // a body the pack did not name still comes from pack zero
  const g = mk(w + 8, h + 8), gc = g.getContext("2d");
  gc.translate(ax + 4, ay + 4);
  art.paint(gc, "enemy.guard", "up", 0);
  const ref = mk(w + 8, h + 8), rc = ref.getContext("2d");
  rc.translate(ax + 4, ay + 4);
  art.manifest.entities["enemy.guard"].paint(rc, 0, "up");
  assert.deepEqual(Buffer.from(pixels(g)), Buffer.from(pixels(ref)));
  art.clearPack();
  assert.equal(art.pack, "procedural");
});

test("loading a pack resolves to null on any failure and to the pair on success", async () => {
  assert.equal(await loadArtPack("https://x/pack", { fetchJson: async () => { throw new Error("nope"); }, loadImage: async () => null }), null);
  assert.equal(await loadArtPack("https://x/pack", { fetchJson: async () => ({}), loadImage: async () => ({}) }), null);
  assert.equal(await loadArtPack("https://x/pack", { fetchJson: async () => ({ entities: {} }), loadImage: async () => null }), null);
  const urls = [];
  const p = await loadArtPack("https://x/pack", {
    fetchJson: async (u) => { urls.push(u); return { entities: {}, atlas: "sheet.png" }; },
    loadImage: async (u) => { urls.push(u); return { width: 1 }; },
  });
  assert.ok(p && p.manifest && p.image);
  assert.deepEqual(urls, ["https://x/pack/manifest.json", "https://x/pack/sheet.png"]);
});
