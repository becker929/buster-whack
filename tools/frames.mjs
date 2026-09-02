#!/usr/bin/env node
/*!
 * npm run frames — look at the game without a browser.
 *
 * Renders scenario frames to PNGs plus a contact sheet you can open in any
 * image viewer. This is the development-feedback half of the visual tooling;
 * the goldens are the regression half.
 *
 *   npm run frames                          every scenario
 *   npm run frames -- --scenario=paused     just one (repeatable / comma-list)
 *   npm run frames -- --list                what's available
 *   npm run frames -- --all-frames          every simulated frame, not just
 *                                           the captured ones — for stepping
 *                                           through an animation
 *   npm run frames -- --out=/tmp/look       somewhere else
 *   npm run frames -- --no-sheet            skip the contact sheet
 *   npm run frames -- --width=520           contact-sheet tile width
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import { runScenario, scenarios, findScenario } from "./visual/harness.js";
import { contactSheet } from "./visual/contact-sheet.js";
import { installHarnessFonts } from "./visual/fonts.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const flag = (name) => argv.some((a) => a === "--" + name);
const value = (name) => {
  const hits = argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
  return hits.length ? hits : null;
};

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

if (flag("list") || flag("help")) {
  console.log(bold("\nscenarios\n"));
  for (const s of scenarios) {
    console.log(`  ${bold(s.name)}  ${dim(`${s.width}x${s.height}, ${s.frames} frames`)}`);
    console.log(`    ${s.title}`);
    console.log(`    ${dim(s.why)}`);
    console.log(
      `    ${dim("captures: " + s.capture.map((c) => `${c.as}@${c.at}`).join(", "))}\n`
    );
  }
  console.log(dim("  npm run frames -- --scenario=<name>\n"));
  process.exit(0);
}

const only = (value("scenario") || []).flatMap((v) => v.split(",")).filter(Boolean);
const selected = only.length
  ? only.map((n) => {
      const s = findScenario(n);
      if (!s) {
        console.error(`unknown scenario "${n}". Try: npm run frames -- --list`);
        process.exit(2);
      }
      return s;
    })
  : scenarios;

const OUT = join(ROOT, value("out")?.at(-1) ?? join(".visual", "frames"));
const TILE = Number(value("width")?.at(-1) ?? 440);
const ALL = flag("all-frames");
const SHEET = !flag("no-sheet");

installHarnessFonts();
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let count = 0;
for (const scenario of selected) {
  // --all-frames just widens the capture list to every simulated frame; the
  // scenario record itself is untouched.
  const s = ALL
    ? {
        ...scenario,
        capture: Array.from({ length: scenario.frames }, (_, i) => ({
          at: i,
          as: "f" + String(i).padStart(3, "0"),
        })),
      }
    : scenario;

  const frames = runScenario(s);
  const dir = join(OUT, scenario.name);
  await mkdir(dir, { recursive: true });
  for (const f of frames) {
    await writeFile(join(dir, `${String(f.at).padStart(3, "0")}-${f.label}.png`), f.png);
    count++;
  }

  if (SHEET && frames.length) {
    const sheet = await contactSheet(frames, {
      title: `${scenario.name} — ${scenario.title}  (${scenario.width}x${scenario.height})`,
      tileWidth: TILE,
    });
    await writeFile(join(OUT, `${scenario.name}.sheet.png`), sheet);
  }

  console.log(
    `  ${bold(scenario.name.padEnd(18))} ${String(frames.length).padStart(3)} frames` +
      (SHEET ? dim(`  -> ${relative(ROOT, join(OUT, scenario.name + ".sheet.png"))}`) : "")
  );
}

console.log(
  `\n${green(`${count} frames`)} in ${bold(relative(ROOT, OUT) + "/")}` +
    (SHEET ? dim("  (open the *.sheet.png files first)") : "") +
    "\n"
);
