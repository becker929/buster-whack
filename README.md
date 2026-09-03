# Buster Whack

A virus-busting, whack-a-mole arcade minigame. Tap the mole panels before
they sink, chain hits for score multipliers, dodge the fire they send back,
and survive the escalating "overclock" as the run speeds up. Built with plain
Canvas 2D — no build step, no dependencies.

It ships as a single ES module that renders into a Shadow DOM, so it drops
into any page (or any "artifact"/widget host) without its CSS, element IDs,
or keyboard listeners colliding with the rest of the page.

## Quick start (local)

```bash
git clone https://github.com/becker929/buster-whack.git
cd buster-whack
npx serve .   # or: python3 -m http.server
```

Open the printed URL — `index.html` is a minimal demo page. (It must be
served over http(s); opening the file directly with `file://` will block the
ES module import in most browsers.)

## Embedding it elsewhere

Import the `mountBusterWhack` function and hand it a container element that
has a real size:

```html
<div id="game" style="width: 800px; height: 600px;"></div>
<script type="module">
  import { mountBusterWhack } from "https://cdn.jsdelivr.net/gh/becker929/buster-whack@main/src/buster-whack.js";
  const game = mountBusterWhack(document.getElementById("game"));

  // later, if you need to tear it down (e.g. unmounting from a SPA route):
  // game.destroy();
</script>
```

The `cdn.jsdelivr.net/gh/<user>/<repo>@<ref>/<path>` pattern serves any file
straight from a public GitHub repo — no publishing step needed. Pin `@main`
to a tag (e.g. `@v1.0.0`) once you cut a release, so embeds don't break
under you.

Some hosts (sandboxed artifact/widget frames, pages with a strict
`Content-Security-Policy`) block cross-origin module imports at runtime. There
you have to include the module at build time instead — bundle it, or paste
`src/buster-whack.js` inline into a `<script type="module">`. It has no
dependencies, so either works as-is.

If you'd rather install it as a package:

```bash
npm install github:becker929/buster-whack
```

```js
import { mountBusterWhack } from "buster-whack";
```

## API

```ts
mountBusterWhack(container: HTMLElement, options?: {
  storageKey?: string; // localStorage key for the high score, default "bw_best"
}): { destroy(): void }
```

- **`container`** must already have a non-zero size — the game fills it
  completely (`width: 100%; height: 100%`). Size it with your own CSS.
- Calling `destroy()` cancels the render loop, removes all listeners
  (including the `window`-level keyboard/pointer ones added while mounted),
  and clears the container's shadow root.
- You can mount more than one instance on a page; each gets its own shadow
  root, sound state, and score storage.

## Controls

The controls ride on the mode you pick, so the start screen is the one place
you choose them.

**ONE HAND** (the default) is built for a phone held in one hand. The bottom of
the stage is one big rounded FIRE button where a keyboard would sit, the board
rests directly on it so the thumb rolls from squares to trigger, a BOMB bar
sits just above the board, and the board itself is how you move:

- Move: the board is a **floating stick** — touch it anywhere, push in a
  direction and hold to walk that way; flick for a single step; let it centre
  or lift to stop. Or **tap a square** to go straight there. Both are rationed
  at half a charge (350 ms) per step; a step asked for during the ration is
  held and taken the moment it ends, so a quick double-tap means "there, then
  there". A tap has to land on ground you can stand on that you could also walk
  to — a narrow road is still a funnel.
- Fire: hold FIRE to charge — release for the strong shot.
- Bomb: tap BOMB (lit while you carry one).

**ADVANCE** keeps the two-thumb layout: the analog ring on the left, the
quarter-circle FIRE on the right, and a tap anywhere on the board also fires.

On a keyboard, both modes take arrow keys / WASD to move, Space to fire (hold
to charge), `B` or Shift for the bomb, `P` or `Esc` to pause, `M` to mute (a
crossed-speaker badge sits by the pause button while sound is off).

- Dodge: once the RETALIATION card has been shown, viruses shoot back. A virus
  about to fire marks its row with a dashed line and a chevron at your edge of
  the field — move off that row. A hit costs 2.5s off the clock and breaks your
  chain. There are two bolts and the difference is the mechanic: a **mett**
  fires a huge slow shell you can still dodge after it launches; a **hopper**
  plants itself, telegraphs for much longer, then fires a bolt that crosses the
  board in a blink — that one has to be dodged during the telegraph. A steel
  guard never fires; it is the anchor of a formation.

## Modes

Pick one on the start screen (arrow keys move the selection; a tap on a row
picks it and starts). Both play the same game: the world is an unbounded strip
of arenas joined by roads. Wipe an arena's wave and the whole arena becomes
yours, a road opens off its right edge, and the next arena waits at the road's
end — its wave wakes only once you step in, so the walk is a real breather.
Roads are three columns long and either full height or a single middle row, so
some crossings funnel you. The view scrolls with you and locks onto each arena
when the fight starts.

- **ONE HAND** — stick · tap · fire. The one-thumb layout above.
- **ADVANCE** — ring + fire. The same road with the two-thumb layout.
- **STORY** — a prototype of where the game is going. The strip opens on a
  *tower*: your own ground with a keeper standing on it. Beside the keeper the
  BOMB button becomes TALK, and what they say is a line laid over the board.
  Walk off the tower's right edge and the guard arena wakes. One
  representation throughout: no overworld, no dialogue screen.

## Story

The narrative lives in `canon/`, sealed. Everything mechanical about it is
plain: `canon/bible/` names the roosts, keepers, enemies, items, string ids
and reveal gates, and `canon/bible/regions.json` → `strip` says how the roost
graph sits on this game's single strip (towers, roads as exits per row, time
counted in tower visits). `canon/README.md` and `canon/AGENTS.md` are the
rules of the house — in short, the person who commissioned the game has asked
not to read the story before the game shows it, so nothing in `canon/vault/`
or `canon/secrets/` is opened outside an authoring session, and the runtime
never logs a decoded string.

The runtime is `src/canon/` (plain JS, dependency-free); the bridge from core
events to canon state and lines on the board is `src/shell/story.js`. The
sealed string table is embedded for the bundle by `npm run canon:embed`, and
the test suite fails if that embed is stale.

CLASSIC (one fixed arena, hold the line) is retired from the menu. Its rule set
is still in the code under its old id, because every renderer golden is pinned
against its fixed six-column board.

## Development

```bash
npm install
npm test          # unit tests + the jsdom smoke test
npm run test:unit # node:test suites over src/core
npm run visual    # canvas golden frames (see "Visual regression" below)
npm run frames    # render scenario PNGs to look at
npm run build     # -> dist/buster-whack.js (single-file ESM bundle, gitignored)
npm start         # serve the repo; open index.html
```

### Layout

The game is a pure core plus an effectful shell. The core is deterministic —
no DOM, no Web Audio, no `Math.random`, no `Date.now`/`performance.now` — so it
can be unit-tested and replayed frame-for-frame from a seed.

```
src/
  core/            deterministic simulation, zero side effects
    constants.js   tuning tables, difficulty ramps, easing/impulse math, layout
    rng.js         mulberry32; the core only ever draws from state.rng
    state.js       createState({ seed, best }) -> state; setLayout(state, w, h)
    step.js        step(state, dtMs, intents) -> events[]
    select.js      pure selectors (HUD and overlay view models, the context verb)
  shell/           everything with a side effect
    audio.js       Web Audio sfx bank, driven by core events
    render.js      draw(ctx, state, now) — canvas only, never touches the DOM
    input.js       pointer / keyboard / analog-ring -> intents
    dom.js         TEMPLATE (styles + markup), shadow root, overlays, splash
    mount.js       mountBusterWhack: owns the rAF loop and wires it together
  buster-whack.js  public entry, re-exports mountBusterWhack (named + default)
test/
  *.test.mjs       node:test unit tests over src/core (+ a headless render test)
  smoke.mjs        mounts the whole module in jsdom + @napi-rs/canvas
  visual/golden/   committed golden frames (see "Visual regression")
tools/
  frames.mjs       render scenarios to PNGs + contact sheets, for looking at
  visual-check.mjs the golden check and the "accept the new look" button
  visual/
    scenarios.js   the scenario records: seed, size, cues, frames to capture
    harness.js     scenario -> PNG frames (core + render.js + @napi-rs/canvas)
    fonts.js       pins the typeface so goldens don't depend on the machine
    font-proof.mjs evidence that the pinning works
    compare.js     golden vs actual, and the diff image
    contact-sheet.js  a scenario's frames tiled into one labelled PNG
    fonts/         JetBrains Mono (OFL-1.1), the only font the harness can use
```

`step()` mutates the state in place (it runs at 60fps) and returns the list of
things that happened: `shot`, `hit`, `whiff`, `guardBlocked`, `hopperStagger`,
`hopperHop`, `progHit`, `playerHit`, `playerMoved`, `chainBroken`,
`multiplierUp`, `chargeReady`, `enemySpawned`, `enemyAim`, `enemyFired`,
`enemyEscaped`, `allySpared`, `waveStart`, `waveEnded`, `stageGate`,
`runStarted`, `resumed`, `paused`, `unpaused`, `gameOver`, `statsChanged`. The shell drains that list: `audio.js`
turns events into sounds, `mount.js` turns them into DOM updates and storage
writes. New audio or visual juice hangs off these events rather than off the
simulation.

`render.js` takes a `CanvasRenderingContext2D`, a plain state object (which
carries its own geometry in `state.G`, computed from width/height/dpr) and a
time — so frames can be drawn headlessly against `@napi-rs/canvas` with no DOM
at all. `test/render.test.mjs` does exactly that.

### Pacing: waves, lulls and stage gates

Enemies arrive as **waves**, not on a rolling timer. One formation lands (a
column, a rank, a diagonal, a pincer — rows rotated by the rng, arrivals
staggered), you clear it or it expires, and then there is a real **lull** with
nothing on the board. That lull is where the game breathes: it is when you
reposition and charge. Clearing every virus in a wave cuts the next lull to
`WAVE_CLEAR_LULL` of its length and pays time and points, so pressure is
something you earn back. A lull never outstays a nearly-dead clock — under
`LOW_TIME` seconds it collapses to `LOW_TIME_LULL_MS`.

Three counters drive the ramp, deliberately kept apart:

| counter | governs |
| --- | --- |
| `deletions` | how hard an individual enemy is: up-time, aim window, bolt speed |
| `stageIdx` | what may appear at all: wave size, and every skin's unlock |
| `waveIdx` | the rhythm only: arrival stagger and lull length |

A **stage gate** needs two floors — `STAGES[i].wave` waves started *and*
`STAGES[i].at` deletions banked. The wave floor stops a strong player being
handed the whole syllabus in the first minute; the deletion floor stops a
struggling one being taught a mechanic they have not earned. Composition keys
on `stageIdx`, so a mechanic can never appear before the card that explains it,
and the OVERCLOCK card stamps `state.ocFrom` with the live deletion count — the
decay and its announcement are the same moment.

### Visual regression

Because the core is deterministic and `render.js` is a pure function of state,
a frame can be reproduced exactly from a seed and a frame number. The visual
harness leans on that: it replays scripted scenarios at a fixed 60fps step,
rasterizes chosen frames with `@napi-rs/canvas`, and compares them byte-for-byte
with goldens committed in `test/visual/golden/`. No browser, no jsdom, no
Playwright — just the core, the renderer and a canvas.

#### Looking at the game without a browser

```bash
npm run frames -- --list                # what scenarios exist and why
npm run frames                          # every scenario
npm run frames -- --scenario=player-hit # just one (comma-separated for several)
npm run frames -- --scenario=charged-shot --all-frames   # every simulated frame
```

Output lands in `.visual/frames/` (gitignored). Each scenario gets a directory
of numbered PNGs *and* a `<scenario>.sheet.png` contact sheet with every
captured frame tiled and labelled — open that one first.

#### Checking and updating the goldens

```bash
npm run visual            # compare against the committed goldens
npm run visual -- --scenario=paused     # just one
npm run visual:update     # ACCEPT the current rendering as the new goldens
```

`npm run visual` fails with the scenario, the frame, the pixel count and the
reason each scenario exists, and writes `golden` / `actual` / `diff` PNGs for
every changed frame into `.visual/diff/` (gitignored). CI uploads that directory
as a workflow artifact on failure, so a reviewer can see what moved.

**`npm run visual:update` is the "accept the new look" button.** It overwrites
the goldens with whatever renders now and deletes goldens no scenario produces
any more. Run it deliberately, after you have looked at the diff images, and let
the golden changes show up in the pull request as the visual part of the review.

#### Scenarios

Scenarios are records in `tools/visual/scenarios.js`, not scripts: each names a
seed, a canvas size, a timeline of cues keyed by frame index, and the frames to
capture. A cue can push intents, but it can also place enemies, inject incoming
fire, arm a full charge or set core fields directly — because waiting for the
RNG to produce a charged kill on a steel guard while a heavy bolt is in flight
would make the goldens hostage to unrelated tuning changes. Adding a scenario
means adding a record; the harness needs no new code.

The scenarios cover an empty board, mid-combat with every enemy type, the
counterattack telegraph mid-charge, bolts in flight (both kinds), the player-hit
punch and its recovery, the charged shot's muzzle flash / tracer / impact ring,
the charge ring filling, popups and sparks, shooting a friendly prog, the pause
overlay, the high-chain multiplier HUD, a deletion detonating at the smallest
and largest tiers, the level marker announcing itself, the time bar's pips from
full to critical and under overclock, and four off-aspect stages (420x740,
700x360 and 300x560 alongside the default 900x640) that exercise both branches
of the layout clamp and the pip ladder's coarse rung.

#### Fonts

Text is the usual reason a canvas golden suite rots: `render.js` asks for
`ui-monospace, Menlo, Consolas, monospace`, every machine answers differently,
and one runner-image bump turns the suite permanently red. So the harness does
not negotiate with the system font set — it deletes it. `GlobalFonts.removeAll()`
drops every face the machine has, and the two [JetBrains Mono][jbm] faces in
`tools/visual/fonts/` (OFL-1.1) are registered under *every* family name in the
renderer's stack. After that the process knows about exactly two font files;
there is nothing else to fall back to, for a family name or for a single glyph.

`npm run visual:proof` demonstrates it, and CI runs it too: it renders the same
frame against the machine's own fonts in a child process and shows the result
differs (so the bundled font really is deciding the typeface), asserts that zero
system families survive registration, and checks that every character the
renderer can emit has a real glyph rather than a `.notdef` box.

There is deliberately **no pixel tolerance**: the comparison is byte-exact.

#### What the goldens do not cover

- **Only the playfield and the HUD.** The start screen, the interlevel card and
  the game-over card are HTML and CSS in the shadow DOM, not canvas drawing.
  Nothing here can see them; that would need a real browser.
- **Not what a browser draws.** The goldens are how `@napi-rs/canvas` rasterizes
  these frames, which is not pixel-for-pixel what Chrome or Safari produce, and
  is not meant to be. They catch *changes* to the drawing code, not
  cross-browser fidelity. The two engines genuinely disagree in places — the
  `charge-telegraph/full` golden is one: a 100% charge sweeps exactly 2π, which
  browsers draw as a closed ring and `@napi-rs/canvas` draws as nothing at all.
- **Not layout in a real page**, DPR scaling, input handling, audio, or
  `localStorage`. Those live in the shell around `render.js`.
- **Not a substitute for playing it.** The goldens pin a few dozen moments. The
  feel of the ramp between them is still yours to judge.

[jbm]: https://github.com/JetBrains/JetBrainsMono

## License

MIT — see [LICENSE](./LICENSE).

The two JetBrains Mono font files under `tools/visual/fonts/` are used only by
the visual-test harness and are licensed separately under the SIL Open Font
License 1.1 — see [tools/visual/fonts/OFL.txt](./tools/visual/fonts/OFL.txt).
They are not part of the published package.
