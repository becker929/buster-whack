/*!
 * PNG comparison for the golden check.
 *
 * The goldens are expected to be byte-identical, not merely similar: the
 * simulation is deterministic, the renderer is a pure function of state, and
 * `fonts.js` removes the machine's font set from the equation. So the fast
 * path is a buffer compare, and pixelmatch only runs when that fails — to
 * explain *what* moved and to write a diff a human can look at.
 */

import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

/**
 * @param {Buffer} goldenPng
 * @param {Buffer} actualPng
 * @param {object} [opts]
 * @param {number} [opts.threshold=0] - pixelmatch colour-distance tolerance.
 * @returns {{ identical: boolean, reason?: string, diffPixels?: number,
 *             diffRatio?: number, diffPng?: Buffer,
 *             golden?: {width:number,height:number},
 *             actual?: {width:number,height:number} }}
 */
export function comparePng(goldenPng, actualPng, opts = {}) {
  if (goldenPng.equals(actualPng)) return { identical: true, diffPixels: 0, diffRatio: 0 };

  const a = PNG.sync.read(goldenPng);
  const b = PNG.sync.read(actualPng);
  const size = { golden: { width: a.width, height: a.height }, actual: { width: b.width, height: b.height } };

  if (a.width !== b.width || a.height !== b.height) {
    return {
      identical: false,
      reason: `canvas size changed: ${a.width}x${a.height} -> ${b.width}x${b.height}`,
      ...size,
    };
  }

  const diff = new PNG({ width: a.width, height: a.height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: opts.threshold === undefined ? 0 : opts.threshold,
    includeAA: true,
    diffColor: [255, 0, 128],
    alpha: 0.35,
  });

  return {
    identical: false,
    reason: diffPixels
      ? `${diffPixels} pixels differ`
      : "pixels match but the encoded PNG differs (encoder or metadata change)",
    diffPixels,
    diffRatio: diffPixels / (a.width * a.height),
    diffPng: PNG.sync.write(diff),
    ...size,
  };
}
