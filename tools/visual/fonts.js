/*!
 * Deterministic text for the headless harness.
 *
 * The renderer asks for `ui-monospace, Menlo, Consolas, monospace`. On a
 * developer's machine that resolves to whatever the OS ships; on a CI runner
 * it resolves to something else; and a golden PNG that depends on the local
 * font set is a golden that goes permanently red the first time it moves.
 *
 * So the harness does not negotiate with the system font set — it deletes it:
 *
 *   1. `GlobalFonts.removeAll()` drops every face @napi-rs/canvas scanned off
 *      the machine. After this the process knows about zero fonts.
 *   2. The two committed JetBrains Mono faces are registered under *every*
 *      family name in the renderer's stack, so whichever name the resolver
 *      reaches for, it lands on the same file.
 *
 * The result is that the harness's font universe is exactly the two `.ttf`
 * files in this directory. There is nothing else on the machine for it to
 * fall back to — not for a family name, and not for an individual glyph —
 * so `fc-cache`, `FONTCONFIG_PATH`, a slimmer CI image or a different distro
 * cannot move a pixel. `tools/visual/font-proof.mjs` demonstrates this.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";

const HERE = dirname(fileURLToPath(import.meta.url));

export const FONT_DIR = join(HERE, "fonts");

/** JetBrains Mono 2.304, SIL Open Font License 1.1 (see fonts/OFL.txt). */
export const FONT_FILES = [
  join(FONT_DIR, "JetBrainsMono-Regular.ttf"),
  join(FONT_DIR, "JetBrainsMono-Bold.ttf"),
];

/**
 * Every family name that appears in a `ctx.font` string in
 * `src/shell/render.js`. All of them are aliased onto the bundled faces.
 */
export const FAMILY_ALIASES = ["ui-monospace", "Menlo", "Consolas", "monospace"];

/**
 * Every character the canvas can be asked to draw, assembled from the literal
 * strings in `render.js` plus the alphabet that number formatting can produce
 * (`padStart`, `toFixed`). Kept here so `assertGlyphCoverage` fails loudly if
 * a future string reaches for a glyph the bundled font does not have.
 */
const TEXT_SOURCES = [
  "0123456789",            // score, level, chain, times
  "+-. s",                 // number formatting and unit suffixes
  "×",                // × multiplication sign  (HUD multiplier, popups)
  "·",                // · middle dot           (HUD chain separator)
  "−",                // − minus sign           (HIT / PROG HIT popups)
  "chain",
  "LV ",
  "OVERCLOCK ",
  "PAUSED",
  "P to resume",
  "GUARD",
  "1 more",
  "chain broken",
  "HIT ",
  "PROG HIT ",
  "spared ",
];

export const GLYPHS = [...new Set(TEXT_SOURCES.join(""))].join("");

let installed = null;

/**
 * Wipe the system font set and register the bundled faces. Idempotent, and
 * safe to call before any drawing happens.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.skip=false] - leave the system fonts in place and
 *   register nothing. Only for the negative control in `font-proof.mjs`;
 *   output produced this way is machine-dependent and must never be used to
 *   write goldens.
 * @returns {{ skipped: boolean, families: string[], files: string[] }}
 */
export function installHarnessFonts(opts = {}) {
  if (opts.skip) {
    return { skipped: true, families: GlobalFonts.families.map((f) => f.family), files: [] };
  }
  if (installed) return installed;

  GlobalFonts.removeAll();
  const remaining = GlobalFonts.families.length;
  if (remaining !== 0) {
    throw new Error(
      `GlobalFonts.removeAll() left ${remaining} families behind; the harness ` +
        `cannot guarantee machine-independent text.`
    );
  }

  for (const alias of FAMILY_ALIASES) {
    for (const file of FONT_FILES) {
      if (!GlobalFonts.registerFromPath(file, alias)) {
        throw new Error(`failed to register ${file} as "${alias}"`);
      }
    }
  }

  const families = GlobalFonts.families.map((f) => f.family);
  for (const alias of FAMILY_ALIASES) {
    if (!families.includes(alias)) throw new Error(`alias "${alias}" did not register`);
  }

  installed = { skipped: false, families, files: FONT_FILES };
  return installed;
}

/** Render one character on a blank tile and return the pixel bytes. */
function tile(ch) {
  const c = createCanvas(64, 64);
  const ctx = c.getContext("2d");
  ctx.font = "700 48px ui-monospace, Menlo, Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = "#000000";
  ctx.fillText(ch, 6, 48);
  return Buffer.from(ctx.getImageData(0, 0, 64, 64).data);
}

/**
 * Prove that every character the renderer can emit has a real glyph in the
 * bundled font, by checking it does not rasterize to the same thing as a
 * codepoint the font certainly lacks (U+10FFFD, an unassigned private-use
 * code point). With the system fonts gone a missing glyph cannot silently
 * borrow a face from elsewhere — it becomes .notdef — so this catches it.
 *
 * @returns {{ checked: number, missing: string[] }}
 */
export function assertGlyphCoverage() {
  installHarnessFonts();
  const notdef = tile("\u{10FFFD}");
  const blank = tile(" ");
  const missing = [];
  let checked = 0;
  for (const ch of GLYPHS) {
    if (ch === " ") continue;              // a space is legitimately blank
    checked++;
    const px = tile(ch);
    if (px.equals(notdef) || px.equals(blank)) missing.push(ch);
  }
  if (missing.length) {
    throw new Error(
      `the bundled font has no glyph for: ${missing
        .map((c) => JSON.stringify(c) + " (U+" + c.codePointAt(0).toString(16).toUpperCase() + ")")
        .join(", ")}`
    );
  }
  return { checked, missing };
}
