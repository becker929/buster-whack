#!/usr/bin/env node
/*!
 * npm run visual          — render every scenario frame and compare it with
 *                           the committed golden in test/visual/golden/.
 * npm run visual:update   — overwrite those goldens with what renders now.
 *                           This is the "accept the new look" button; the diff
 *                           it produces is the thing to review in the PR.
 *
 * Flags:
 *   --scenario=<name>     restrict to one scenario (repeatable, or comma-list)
 *   --threshold=<0..1>    pixelmatch colour tolerance; default 0 (exact)
 *   --out=<dir>           where failure artifacts go; default .visual/diff
 *   --list                print the scenarios and exit
 */

import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import { runScenario, scenarios, findScenario, frameId } from "./visual/harness.js";
import { comparePng } from "./visual/compare.js";
import { installHarnessFonts, assertGlyphCoverage, FONT_FILES } from "./visual/fonts.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GOLDEN_DIR = join(ROOT, "test", "visual", "golden");

const argv = process.argv.slice(2);
const flag = (name) => argv.some((a) => a === "--" + name);
const value = (name) => {
  const hits = argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
  return hits.length ? hits : null;
};

const UPDATE = flag("update");
const LIST = flag("list");
const THRESHOLD = Number(value("threshold")?.at(-1) ?? 0);
const OUT_DIR = join(ROOT, value("out")?.at(-1) ?? join(".visual", "diff"));

const only = (value("scenario") || []).flatMap((v) => v.split(",")).filter(Boolean);

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

if (LIST) {
  for (const s of scenarios) {
    console.log(`${bold(s.name.padEnd(18))} ${s.width}x${s.height}  ${s.capture.length} frames  ${dim(s.title)}`);
  }
  process.exit(0);
}

const selected = only.length
  ? only.map((n) => {
      const s = findScenario(n);
      if (!s) {
        console.error(red(`unknown scenario "${n}". Try: npm run visual -- --list`));
        process.exit(2);
      }
      return s;
    })
  : scenarios;

// --- render -----------------------------------------------------------------

// The whole point is that this needs no DOM. If a shim ever gets pulled in by
// an import, the goldens start depending on it — so refuse to run.
for (const name of ["document", "window"]) {
  if (typeof globalThis[name] !== "undefined") {
    console.error(red(`a DOM shim is loaded (globalThis.${name} exists); the harness must stay DOM-free`));
    process.exit(2);
  }
}

const font = installHarnessFonts();
const coverage = assertGlyphCoverage();
console.log(
  dim(
    `fonts: ${font.families.length} families registered from ${FONT_FILES.length} bundled files ` +
      `(system fonts removed); ${coverage.checked} glyphs verified`
  )
);

await mkdir(GOLDEN_DIR, { recursive: true });

const frames = [];
for (const s of selected) frames.push(...runScenario(s));

// --- update -----------------------------------------------------------------

if (UPDATE) {
  let written = 0;
  let changed = 0;
  for (const f of frames) {
    const path = join(GOLDEN_DIR, f.id + ".png");
    const before = existsSync(path) ? await readFile(path) : null;
    if (!before || !before.equals(f.png)) changed++;
    await writeFile(path, f.png);
    written++;
  }

  // Goldens for scenarios or labels that no longer exist are dead weight, and
  // a stale one silently "covering" nothing is worse than none.
  let removed = 0;
  if (!only.length) {
    const keep = new Set(frames.map((f) => f.id + ".png"));
    for (const name of await readdir(GOLDEN_DIR)) {
      if (name.endsWith(".png") && !keep.has(name)) {
        await rm(join(GOLDEN_DIR, name));
        console.log(dim(`  removed stale golden ${name}`));
        removed++;
      }
    }
  }

  console.log(
    green(`updated ${written} goldens`) +
      ` (${changed} changed, ${removed} stale removed) in ${relative(ROOT, GOLDEN_DIR)}/`
  );
  console.log(dim("review the image diff in your PR before you accept it."));
  process.exit(0);
}

// --- compare ----------------------------------------------------------------

const failures = [];
const missing = [];

for (const f of frames) {
  const path = join(GOLDEN_DIR, f.id + ".png");
  if (!existsSync(path)) {
    missing.push(f);
    continue;
  }
  const golden = await readFile(path);
  const res = comparePng(golden, f.png, { threshold: THRESHOLD });
  if (!res.identical) failures.push({ frame: f, res, golden });
}

let extra = [];
if (!only.length && existsSync(GOLDEN_DIR)) {
  const have = new Set(frames.map((f) => f.id + ".png"));
  extra = (await readdir(GOLDEN_DIR)).filter((n) => n.endsWith(".png") && !have.has(n));
}

if (!failures.length && !missing.length && !extra.length) {
  console.log(green(`visual OK`) + ` — ${frames.length} frames across ${selected.length} scenarios match`);
  process.exit(0);
}

// --- report -----------------------------------------------------------------

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

console.error("");
console.error(red(bold("visual regression")));

for (const m of missing) {
  await writeFile(join(OUT_DIR, m.id + ".actual.png"), m.png);
  console.error(
    `\n  ${bold(m.scenario)} / ${m.label} ${dim("(frame " + m.at + ")")}\n` +
      `    no golden yet — wrote ${relative(ROOT, join(OUT_DIR, m.id + ".actual.png"))}`
  );
}

for (const { frame, res, golden } of failures) {
  const scen = findScenario(frame.scenario);
  const base = join(OUT_DIR, frame.id);
  await writeFile(base + ".golden.png", golden);
  await writeFile(base + ".actual.png", frame.png);
  if (res.diffPng) await writeFile(base + ".diff.png", res.diffPng);

  const pct = res.diffRatio === undefined ? "" : ` (${(res.diffRatio * 100).toFixed(3)}% of the frame)`;
  console.error(
    `\n  ${bold(frame.scenario)} / ${frame.label} ${dim("(frame " + frame.at + ", " + frame.width + "x" + frame.height + ")")}\n` +
      `    ${red(res.reason + pct)}\n` +
      `    ${dim(scen.why)}\n` +
      `    golden ${relative(ROOT, base + ".golden.png")}\n` +
      `    actual ${relative(ROOT, base + ".actual.png")}` +
      (res.diffPng ? `\n    diff   ${relative(ROOT, base + ".diff.png")}` : "")
  );
}

for (const name of extra) {
  console.error(`\n  ${bold(name)}\n    golden with no matching scenario frame — run npm run visual:update`);
}

const worst = failures.reduce((m, f) => Math.max(m, f.res.diffPixels || 0), 0);
console.error(
  `\n${red(bold(`${failures.length} changed, ${missing.length} missing, ${extra.length} orphaned`))}` +
    ` of ${frames.length} frames; worst frame ${worst} pixels.\n` +
    `Images in ${relative(ROOT, OUT_DIR)}/.\n` +
    `If the new look is correct, accept it with: ${bold("npm run visual:update")}\n`
);
process.exit(1);
