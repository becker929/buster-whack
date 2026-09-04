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

Two thumbs: the analog **ring** on the left, the quarter-circle **FIRE** on the
right, and the round context button above FIRE. The board takes taps.

- Move: every step is a **hop**, one square, never diagonal — a crouch, the
  arc, a landing, and the rest of the ration as cooldown (195 ms a step). The
  square you count as standing on changes at the top of the arc. Hold the
  ring to walk; flick it for one hop. Or **tap a square**: beside you it is
  one hop; further away it lays a path and the hops follow it, one per
  ration, until the ring, another tap, or a hit gives a new directive. A tap
  has to land on ground you can stand on that you could also walk to — a
  narrow road is still a funnel. A drag on the board itself also works as a
  stick.
- Safe zones: the clock — your pulse — only drains inside an arena that is
  held against you. Towers, roads and arenas you have taken are safe, so a
  walk is a real rest.
- Fire: hold FIRE to charge — release for the strong shot.
- Context button: BOMB when you carry one; **TALK** beside a person on a
  tower; **READ** beside something written. Lines appear as a strip over the
  board, never a screen of their own, and you set the pace: TALK opens a
  conversation, NEXT shows the next line, DONE closes it. Nothing plays on its
  own, and walking away from the person closes the box.
- Dodge: viruses shoot back once the people on the road have warned you they
  will. A virus about to fire marks its row with a dashed line and a chevron
  at your edge of the field — move off that row. A hit costs 2.5s of pulse
  and breaks your chain. A **mett** fires a huge slow shell you can still
  dodge after it launches; a **hopper** plants itself, telegraphs for much
  longer, then fires a bolt that crosses the board in a blink — that one has
  to be dodged during the telegraph. A steel guard never fires; it is the
  anchor of a formation.
- Keyboard: arrow keys / WASD move, Space fires (hold to charge), `B` or Shift
  for the context button, `P` or `Esc` pauses, `M` mutes.

## The game

One strip, one representation. The strip opens on a *tower* — a roost of the
Rookery, your own ground with people on it — and every tenth arena after that
another tower stands on the road, following the route through the bible's
roosts: every roost once before any repeats. A small label under LEVEL names
the roost you are standing in. Between towers the road is held
against you: wipe an arena's wave and the whole arena becomes yours, a road
opens off its right edge, and the next arena wakes only when you step in. Roads
are three columns long and either full height or a single middle row, so some
crossings funnel you. The view scrolls with you and locks onto each arena when
the fight starts.

There are no cards. What is coming next on the road — steel, runners to spare,
fire coming back, the fast ones, the ones that open on a beat — is said by the
people at the tower before it, in plain words, when you ask.

### The enemy table

Every virus is a row in `src/core/enemies.js`: how many hits it takes, how
long it stays up, whether it moves, whether it shoots, what armour it wears
and what it is worth. The row names *which* tuning value answers each of
those, so a new virus is a row here plus its numbers in `tuning.js` — not a
new branch in five files.

What a virus throws is its **attack**, and attacks are their own vocabulary:
a list of shots, each with a lane offset, a delay, and optional factors on
the bolt's speed and size. Four shapes cover the game today.

| attack | shape | who fires it |
| --- | --- | --- |
| `bolt` | one, down its own lane | mett, hopper, sentinel |
| `spread` | three at once, its lane and both neighbours | spreader |
| `volley` | two down one lane, a beat apart | darter |
| `wall` | one slow fat shot that owns the lane while it crosses | warden |

A shot with a delay is held on the firer, so a volley dies with the thing
that started it. A shot aimed off the board is never fired.

The road teaches them in order: steel at 10, runners at 20, return fire at
30, hoppers at 40, the first sentinel mark at 50, the spreader at 60, marks
II and III at 70 and 90, the darter at 80 and the warden at 90. (The
distribution across towers is the difficulty curve's to redraw.)

The arcade layouts this grew out of (CLASSIC, ADVANCE, ONE HAND) are retired:
off the menu, kept in the code under their ids for their tests and goldens.

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

## Art packs

Every body the game draws — the buster, each virus and sentinel mark, the
people on the towers, the journal, a bomb on the road — is a *cell* in an art
pack: a raster with an anchor, one per entity, state and frame. Pack zero is
baked at runtime from the procedural painters in `src/shell/painters.js`, so
the game needs no image to run, and `npm run art:check` asserts that every
baked cell is its painter byte for byte and that the flagged scenes render
identically through the pack and through the painters.

To make a pack: `npm run art:dump` writes pack zero to `art/procedural/` as
one PNG per cell (`<entity>__<state>__<frame>.png`), plus the atlas and the
manifest. Copy that folder, replace any cells (keep each cell's size and
anchor, or name new anchors in `pack.json`), and `npm run art:pack -- <dir>`
builds `atlas.png` and `manifest.json`. Host the folder and mount with
`mountBusterWhack(el, { artUrl: "https://…/my-pack" })`; cells the pack does
not provide keep pack zero. Animation is by frame, at the timing the manifest
gives each state, so a pack never has to know the clock.

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

### New game, continue, and the save manifest

The start screen names the build in the corner, and offers **CONTINUE** when
there is a run to come back to — with **NEW GAME** underneath it, quieter, so
the button that throws a run away is never the easy one to hit. A bare tap on
the card continues rather than restarts for the same reason. With no save
there is one button and it still reads PRESS START.

A run is written at its checkpoints: a tower reached, an arena taken. Those
are exactly the moments when nothing is in the air and the clock is not
running, so a loaded run resumes at rest and none of the in-flight state has
to be captured. Starting a new run drops the save; so does dying.

A save is a **manifest** and three sections (`src/core/save.js`):

```
manifest  { game, version, build, savedAt, at: { arena, roost, score } }
run       seed, the rng's exact position, score, clock, ledger, stash, tasks
world     the road so far, as segments; towers rebuild their people from the route
story     opaque here — the shell's own gate state. Ids and counters, never text
```

`manifest.version` is the shape of the save, and it is the gate. A save from a
**newer** manifest version is always refused rather than guessed at; an older
one is accepted only if `MIGRATIONS` has a path to the current version.
Anything unreadable comes back as `{ ok: false, reason }` for the UI to show —
nothing throws. `manifest.build` is the game version that wrote it, which is
what the corner of the start screen shows.

Two versions, two jobs: `VERSION` in `src/core/version.js` is the game's, kept
equal to `package.json` by a test; `SAVE_VERSION` is the manifest's, and only
moves when the saved shape does.

### The stash, and the five shards

What you carry is one list with a capacity in slots (`STASH_SLOTS`). The bomb
is the first item and costs one slot; the five shards the bible names cost
one to three. A pickup only leaves the road when there is room for it, and
the context button spends the **top** of the stash — the last thing you
picked up, which is the name the HUD shows first — so what a press will do is
always visible before you press it.

Each item names one effect from a closed vocabulary in `src/core/items.js`:

| item | slots | what it does |
| --- | --- | --- |
| BOMB | 1 | the arc onto a panel ahead, splashing a 3×3 |
| SPELL | 1 | the next bolt that would land on you does not |
| FOOTNOTE | 1 | your last shot is taken again, for half its worth |
| SOCK | 2 | nothing aims at you for a beat, and fire in the air passes through |
| WEATHER | 2 | one more virus arrives in your row — a target, and a shooter |
| BELL | 3 | everything armed on the board fires this instant, then reloads |

Shards start turning up on the road at `SHARD_UNLOCK`, cheapest first, and the
range of what can drop widens the further out you go.

### Bonus tasks

The people on the towers ask for things. A task is a row in
`src/core/tasks.js`: an id, the plain sentence the player reads, the counter
it watches, how much of it is wanted, and what it pays — pulse, points or a
bomb. Progress is counted from the moment the task was taken, so nothing can
be claimed by walking up with it already done, and one is open at a time.

The core keeps the counters (`src/core/tasks-count.js` is fed from the places
where the thing being counted happens) and owns the ledger. Delivery is part
of a conversation: talking to someone pays out what you have finished, or
asks for the next thing, or says nothing — once per person, however long you
talk. The line arrives as the last beat of their conversation, so it is read
by pressing TALK like everything else, and no box ever opens on its own.

Task text is deliberately not canon. What the game asks you to *do* is
instructions, and instructions are plain: "Take an arena without being hit."

### The difficulty curve, and how it was measured

`node tools/curve.mjs` plays the road headlessly and prints what each arena
actually felt like: how long the fight lasted, how much pulse it cost, how
much it paid back, how far the bar fell, what was on the board. A bot drives
the core — it shoots the nearest thing in its lane, charges when the target
needs it, spares runners, steps out of a lane a bolt is crossing, and walks
right when the arena is taken — so the numbers are repeatable. `--skill N`
is its reaction time in frames, `--tune KEY=VAL,...` measures a candidate set
without editing anything, `--json` for a machine.

It was written because the road had no curve. Measured, the first thirty
arenas came back identical: pulse pinned within a second of its cap, no hits
taken, perfect accuracy — then a cliff when hoppers arrived. The road paid
about four times what a fight cost it, and the cap hid the surplus.

Two mechanisms fix it, both tunable:

- **The drain rises with distance.** A second in a contested arena costs
  `DRAIN_BASE` at the start of the road and climbs by `DRAIN_PER_ARENA` to
  `DRAIN_MAX`, which it reaches well before the road's end — past that the
  viruses are the difficulty and the clock stops piling on. Safe ground still
  costs nothing at all.
- **The road pays on its own scale.** `ROAD_PULSE` scales every pulse reward
  on the road, where nothing escapes and every kill is eventually collected.
  It replaces the arcade's overclock decay there rather than stacking with
  it: counting the same squeeze twice, once by kill count and once by
  distance, is what made arena forty a wall. Points are untouched by either.

The shape that came out: a first arena that costs you something, a bank
built through the teens, the squeeze starting in the twenties, return fire
at thirty and hoppers at forty landing on a bar that is already moving.

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
