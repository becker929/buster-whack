# Buster Whack

A virus-busting, whack-a-mole arcade minigame. Tap the mole panels before
they sink, chain hits for score multipliers, and survive the escalating
"overclock" as the run speeds up. Built with plain Canvas 2D — no build step,
no dependencies.

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
- `P` or `Esc`: pause · `M`: mute

## Development

`test/smoke.mjs` mounts the module in a headless DOM (jsdom + `@napi-rs/canvas`)
and drives a few frames of input to catch regressions before you push:

```bash
npm install
npm test
```

## License

MIT — see [LICENSE](./LICENSE).
