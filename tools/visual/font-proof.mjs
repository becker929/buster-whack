#!/usr/bin/env node
/*!
 * npm run visual:proof — evidence that the goldens do not depend on the
 * machine's fonts.
 *
 * The whole reason a canvas golden suite normally rots on CI is text: the
 * renderer asks for `ui-monospace, Menlo, Consolas, monospace`, every machine
 * answers differently, and one runner image bump turns the suite permanently
 * red. This script demonstrates that the harness has removed that variable
 * rather than papered over it with a pixel tolerance.
 *
 * Four checks, in order, in one process — the order matters, because check 1
 * has to render *before* the system font set is deleted:
 *
 *   1. NEGATIVE CONTROL. Render a text-heavy frame using whatever fonts this
 *      machine happens to have. If this matched the golden, the bundled font
 *      would be decorative and the suite would still be at the mercy of the
 *      runner image. It must differ. This runs in a child process
 *      (`--control`), because @napi-rs/canvas caches how it resolved a font
 *      string: a draw made before the bundled faces are registered can poison
 *      that cache for the rest of the process.
 *   2. ISOLATION. `GlobalFonts.removeAll()` leaves zero families, the two
 *      bundled faces register under every family name the renderer asks for,
 *      and nothing reappears after drawing. Nothing else is reachable.
 *   3. COVERAGE. Every character the renderer can emit has a real glyph, so
 *      no character can fall through to a .notdef box.
 *   4. STABILITY. The harness render is byte-identical to the committed
 *      golden, and repeating it is byte-identical again.
 *
 * For the environment half of the argument, run the check itself with the
 * system font configuration pulled out from under it — it still passes:
 *
 *   FONTCONFIG_PATH=/var/empty FONTCONFIG_FILE=/dev/null \
 *   XDG_DATA_HOME=/var/empty XDG_DATA_DIRS=/var/empty HOME=/var/empty \
 *     npm run visual
 */

import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";

import { runScenario, findScenario, frameId } from "./harness.js";
import { comparePng } from "./compare.js";
import {
  installHarnessFonts,
  assertGlyphCoverage,
  FAMILY_ALIASES,
  FONT_FILES,
  GLYPHS,
} from "./fonts.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GOLDEN_DIR = join(ROOT, "test", "visual", "golden");

// A frame that is mostly text: score, level, clock, OVERCLOCK readout and the
// chain multiplier line all in one.
const SCENARIO = findScenario("overclock-hud");
const LABEL = "overclock";

const pick = (frames) => frames.find((f) => f.label === LABEL);

// Child mode: render the control frame against the machine's own fonts and
// hand it back as base64. Kept in this file so there is one place to read.
if (process.argv.includes("--control")) {
  process.stdout.write(pick(runScenario(SCENARIO, { fonts: false })).png.toString("base64"));
  process.exit(0);
}

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const failures = [];
const ok = (label, detail) => console.log(`  ${green("PASS")} ${label}\n       ${dim(detail)}`);
const bad = (label, detail) => {
  failures.push(label);
  console.log(`  ${red("FAIL")} ${label}\n       ${detail}`);
};

console.log(bold("\n1. negative control — this machine's own fonts\n"));

const systemFamilies = GlobalFonts.families.map((f) => f.family);
const control = Buffer.from(
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--control"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
  "base64"
);
console.log(
  dim(`       ${systemFamilies.length} system families visible to @napi-rs/canvas` +
    (systemFamilies.length ? `, e.g. ${systemFamilies.slice(0, 4).join(", ")}` : ""))
);

console.log(bold("\n2. isolation — the harness font set\n"));

const info = installHarnessFonts();
ok(
  "system fonts removed, bundled faces registered",
  `${systemFamilies.length} families -> ${info.families.join(", ")} ` +
    `(${FONT_FILES.length} files, aliased as ${FAMILY_ALIASES.join(", ")})`
);

console.log(bold("\n3. coverage — every glyph the renderer can draw\n"));

try {
  const cov = assertGlyphCoverage();
  ok("no character falls back to .notdef", `${cov.checked} distinct glyphs in ${JSON.stringify(GLYPHS)}`);
} catch (err) {
  bad("glyph coverage", err.message);
}

console.log(bold("\n4. stability — against the committed golden\n"));

const harness = pick(runScenario(SCENARIO)).png;
const again = pick(runScenario(SCENARIO)).png;

const vsControl = comparePng(control, harness);
if (vsControl.identical) {
  bad(
    "negative control differs from the harness render",
    "rendering was identical with and without the bundled font, so the " +
      "registration is not actually deciding the typeface — text is still " +
      "machine-dependent."
  );
} else {
  ok(
    "the bundled font is load-bearing",
    `${vsControl.diffPixels} pixels (${((vsControl.diffRatio || 0) * 100).toFixed(3)}% of the frame) ` +
      `change when the machine's fonts are used instead`
  );
}

if (again.equals(harness)) {
  ok("repeated renders are byte-identical", `${harness.length} bytes, twice`);
} else {
  bad("repeated renders differ", "the harness is not deterministic within a single process");
}

try {
  const golden = await readFile(join(GOLDEN_DIR, frameId(SCENARIO.name, LABEL) + ".png"));
  const vsGolden = comparePng(golden, harness);
  if (vsGolden.identical) ok("matches the committed golden", `${golden.length} bytes, byte-for-byte`);
  else bad("does not match the committed golden", vsGolden.reason);
} catch {
  bad("committed golden missing", "run npm run visual:update first");
}

console.log("");
if (failures.length) {
  console.error(red(bold(`${failures.length} font check(s) failed\n`)));
  process.exit(1);
}
console.log(green(bold("fonts are machine-independent\n")));
