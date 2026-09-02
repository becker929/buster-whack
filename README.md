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

- Move: on-screen analog ring, arrow keys, or WASD
- Fire: tap / click / Space — hold to charge a stronger shot
- Dodge: from 12 deletions on, viruses shoot back. A virus about to fire
  marks its row with a dashed line and a chevron at your edge of the field —
  move off that row. A hit costs 2.5s off the clock and breaks your chain.
- `P` or `Esc`: pause · `M`: mute

## Development

```bash
npm install
npm test          # unit tests + the jsdom smoke test
npm run test:unit # node:test suites over src/core
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
    select.js      pure selectors (HUD, footer, overlay view models)
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
```

`step()` mutates the state in place (it runs at 60fps) and returns the list of
things that happened: `shot`, `hit`, `whiff`, `guardBlocked`, `hopperStagger`,
`hopperHop`, `progHit`, `playerHit`, `playerMoved`, `chainBroken`,
`multiplierUp`, `chargeReady`, `enemySpawned`, `enemyAim`, `enemyFired`,
`enemyEscaped`, `allySpared`, `stageGate`, `runStarted`, `resumed`, `paused`,
`unpaused`, `gameOver`, `statsChanged`. The shell drains that list: `audio.js`
turns events into sounds, `mount.js` turns them into DOM updates and storage
writes. New audio or visual juice hangs off these events rather than off the
simulation.

`render.js` takes a `CanvasRenderingContext2D`, a plain state object (which
carries its own geometry in `state.G`, computed from width/height/dpr) and a
time — so frames can be drawn headlessly against `@napi-rs/canvas` with no DOM
at all. `test/render.test.mjs` does exactly that.

## License

MIT — see [LICENSE](./LICENSE).
