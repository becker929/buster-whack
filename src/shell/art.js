/*!
 * Art: the pack the renderer draws bodies from.
 *
 * A pack is a set of cells, one per entity, state and frame, each a raster
 * with an anchor. Pack zero is baked here from the painters at the current
 * panel size and device scale, so the game needs no image to run; a loaded
 * pack (an atlas PNG and a manifest) replaces any cell it names, and the
 * painter stays the fallback for every cell it does not.
 *
 * The renderer never reads the DOM, so it is handed an `art` object built
 * by the shell with a canvas factory; the headless harness builds one with
 * @napi-rs/canvas the same way. `paint(ctx, id, state, frame)` draws the
 * cell with its anchor at the current origin -- the caller has already
 * translated to an integer position, so a cell and its painter land on the
 * same pixels. That is the identity the pack tool asserts.
 */

import { manifestFor, frameAt } from "./painters.js";

/**
 * @param {object} o
 * @param {(w: number, h: number) => any} o.makeCanvas - a blank canvas of that size
 */
export function createArt({ makeCanvas }) {
  let manifest = null;    // for the current G
  let key = "";           // pw|ph|dpr the cells were baked for
  let dpr = 1;
  let cells = new Map();  // "id/state/frame" -> { canvas, w, h, ax, ay }
  let external = null;    // a loaded pack: { manifest, image } or null
  let externalCells = new Map();

  const cellKey = (id, st, frame) => id + "/" + st + "/" + frame;

  /** Bake pack zero for this panel size and device scale (memoised). */
  function ensure(G, deviceScale = 1) {
    const k = G.pw + "|" + G.ph + "|" + deviceScale;
    if (k === key) return;
    key = k; dpr = deviceScale;
    manifest = manifestFor(G);
    cells = new Map();
    for (const [id, ent] of Object.entries(manifest.entities)) {
      for (const [st, spec] of Object.entries(ent.states)) {
        for (let f = 0; f < spec.frames; f++) {
          const { w, h, ax, ay } = ent.cell;
          const cv = makeCanvas(Math.ceil(w * dpr), Math.ceil(h * dpr));
          const c = cv.getContext("2d");
          c.setTransform(dpr, 0, 0, dpr, 0, 0);
          c.translate(ax, ay);
          ent.paint(c, f, st);
          // the context's own canvas: in a browser it is the element, and
          // under a test double that backs elements with another canvas
          // library it is the object drawImage actually accepts
          cells.set(cellKey(id, st, f), { canvas: c.canvas || cv, w, h, ax, ay });
        }
      }
    }
    if (external) cutExternal();
  }

  /** Cut a loaded atlas into cells, scaled to the current manifest's cell sizes. */
  function cutExternal() {
    externalCells = new Map();
    if (!external || !manifest) return;
    const { manifest: m, image } = external;
    for (const [id, ent] of Object.entries(m.entities || {})) {
      const local = manifest.entities[id];
      if (!local) continue;
      for (const [st, spec] of Object.entries(ent.states || {})) {
        if (!local.states[st]) continue;
        for (let f = 0; f < spec.frames.length; f++) {
          const src = spec.frames[f];               // { x, y, w, h, ax, ay } in the atlas
          const { w, h, ax, ay } = local.cell;
          const cv = makeCanvas(Math.ceil(w * dpr), Math.ceil(h * dpr));
          const c = cv.getContext("2d");
          c.setTransform(dpr, 0, 0, dpr, 0, 0);
          // scale the pack's cell onto ours, keeping the anchor where ours is
          const sx = w / src.w, sy = h / src.h;
          c.imageSmoothingEnabled = !!m.smooth;
          c.drawImage(image, src.x, src.y, src.w, src.h, ax - src.ax * sx, ay - src.ay * sy, src.w * sx, src.h * sy);
          externalCells.set(cellKey(id, st, f), { canvas: c.canvas || cv, w, h, ax, ay });
        }
      }
    }
  }

  return {
    ensure,
    get manifest() { return manifest; },
    get pack() { return external ? external.manifest.name || "external" : "procedural"; },
    /** Use a loaded pack: { manifest, image }. Cells it lacks keep pack zero. */
    applyPack(pack) { external = pack; cutExternal(); },
    /** Back to pack zero. */
    clearPack() { external = null; externalCells = new Map(); },
    /** The frame to show for a state at `now`, from the manifest's timing. */
    frame(id, st, now) {
      const ent = manifest && manifest.entities[id];
      return frameAt(ent && ent.states[st], now);
    },
    /**
     * Draw a cell with its anchor at the current origin. Falls back to the
     * painter when the pack has no such cell, drawing the same pixels.
     */
    paint(ctx, id, st, frame = 0) {
      const k = cellKey(id, st, frame);
      const cell = externalCells.get(k) || cells.get(k);
      if (cell) { ctx.drawImage(cell.canvas, -cell.ax, -cell.ay, cell.w, cell.h); return true; }
      const ent = manifest && manifest.entities[id];
      if (ent) { ent.paint(ctx, frame, st); return true; }
      return false;
    },
    /** For tooling: the baked cells, by key. Never needed to draw. */
    get cells() { return cells; },
  };
}

/**
 * Load an external pack: `<url>/manifest.json` and the atlas it names.
 * Resolves to `{ manifest, image }` or null if anything is missing, so a
 * caller can fall back to pack zero without a branch.
 * @param {object} o
 * @param {(url: string) => Promise<any>} o.fetchJson
 * @param {(url: string) => Promise<any>} o.loadImage
 */
export async function loadArtPack(baseUrl, { fetchJson, loadImage }) {
  try {
    const base = baseUrl.replace(/\/?$/, "/");
    const manifest = await fetchJson(base + "manifest.json");
    if (!manifest || !manifest.entities) return null;
    const image = await loadImage(base + (manifest.atlas || "atlas.png"));
    return image ? { manifest, image } : null;
  } catch (e) {
    return null;
  }
}
