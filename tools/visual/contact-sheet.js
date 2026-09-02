/*!
 * Contact sheet: a scenario's captured frames tiled into one labelled PNG, so
 * you can see a whole beat of the game at a glance without a browser.
 *
 * Drawn with the same @napi-rs/canvas the frames came from — no image tooling,
 * no extra dependency.
 */

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { installHarnessFonts } from "./fonts.js";

const PAD = 14;
const LABEL_H = 26;
const HEADER_H = 40;
const BG = "#14161f";
const FG = "#e6ebf5";
const DIM = "#8b95ad";

/**
 * @param {Array<{label:string, at:number, png:Buffer, width:number, height:number}>} frames
 * @param {object} [opts]
 * @param {string} [opts.title]
 * @param {number} [opts.columns] - defaults to a roughly square grid.
 * @param {number} [opts.tileWidth=440] - each frame is scaled to this width.
 * @returns {Promise<Buffer>}
 */
export async function contactSheet(frames, opts = {}) {
  installHarnessFonts();
  if (!frames.length) throw new Error("contactSheet: no frames");

  const cols = opts.columns || Math.min(3, Math.ceil(Math.sqrt(frames.length)));
  const rows = Math.ceil(frames.length / cols);
  const tw = opts.tileWidth || 440;
  const scale = tw / frames[0].width;
  const th = Math.round(frames[0].height * scale);

  const W = PAD + cols * (tw + PAD);
  const H = HEADER_H + PAD + rows * (th + LABEL_H + PAD);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  if (opts.title) {
    ctx.fillStyle = FG;
    ctx.font = "700 16px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText(opts.title, PAD, HEADER_H - 14);
  }

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const x = PAD + (i % cols) * (tw + PAD);
    const y = HEADER_H + PAD + Math.floor(i / cols) * (th + LABEL_H + PAD);
    const img = await loadImage(f.png);

    ctx.fillStyle = "#000000";
    ctx.fillRect(x, y, tw, th);
    ctx.drawImage(img, x, y, tw, th);
    ctx.strokeStyle = "#2a3044";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1);

    ctx.textAlign = "left";
    ctx.font = "700 12px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillStyle = FG;
    ctx.fillText(f.label, x, y + th + 16);
    ctx.font = "400 12px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillStyle = DIM;
    ctx.textAlign = "right";
    ctx.fillText(`frame ${f.at}`, x + tw, y + th + 16);
  }

  return canvas.toBuffer("image/png");
}
