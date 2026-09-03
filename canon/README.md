# mesh-canon

Story canon for Buster Whack. Everything narrative is sealed. Everything mechanical is plain.

The game is one strip, one representation: towers (roosts) joined by roads (links), fights at the far edge of a tower, keepers and items on its safe tiles, text as a strip over the board. No overworld, no battle screen. `bible/regions.json` → `strip` says how the graph sits on the strip.

**If you are Anthony:** you may read this file, `bible/`, `../src/canon/canon.js`, `../src/canon/decoder.js`, `../src/shell/story.js`, and `CHANGELOG.md`. Do not open `vault/`, `secrets/`, `../src/canon/unseal.js` (the curtain — it is annotated so you'll know when to stop), or `../src/canon/embed.js` (the sealed table, embedded for the bundle). You will meet everything in `vault/` in the game, in order, when it's earned.

## Layout

```
bible/            plaintext, no meanings
  entities.json     ids, stats, homes, which string patterns each owns
  regions.json      8 roosts, link graph, sunset order, shelf sizes, acts, endings
  triggers.json     reveal gates: which string ids stay blank until which state
  state_keys.json   the PlayerState keys the engine must maintain
  string_ids.json   every string id + length + template vars (for layout)
vault/            sealed prose + sealed string table
secrets/          sealed secrets ledger
../src/canon/     the runtime, plain JS ESM like the rest of the game
  decoder.js        pure decoder
  unseal.js         the curtain (method params, obfuscated, annotated)
  canon.js          Canon.load(...) / canon.t(id) / PlayerState / gates / newlyUnlocked()
  embed.js          GENERATED: the sealed string table + triggers, for the bundle
../src/shell/story.js  the bridge: core events -> PlayerState -> lines on the board
tools/vaultkit.py agents' sealer; not for the player
AGENTS.md         handoff protocol for any model working on this
```

## Wiring it in

```js
import { Canon } from "../src/canon/canon.js";
import { STRINGS_VAULT, TRIGGERS } from "../src/canon/embed.js";   // build-time, never fetched
const canon = await Canon.load(STRINGS_VAULT, TRIGGERS);
canon.t("roost.01.name");                    // display names come from the vault
canon.state.inc("talks.ferryman");           // engine writes state; gates read it
canon.t("ui.sunset.days", { n: 3 });         // "" while locked, text once earned
canon.newlyUnlocked();                       // ids that just opened: show them once
```

After any change under `canon/`, run `npm run canon:embed` (the test suite fails if the embed is stale). `decoder.js` needs `crypto.subtle` and `TextEncoder` (every browser, Node 18+). Nothing here touches canvas.

## What you're allowed to know

Eight roosts, one never sunsets, two are dark at start and one of those reopens. Five keepers, two bosses, three hidden NPCs, three enemy families of three, five starter shards, eight secrets, three endings. A published sunset schedule is the clock; the map contracts as it runs. The central verb is *carry*: moving a keeper off a dying roost means choosing what they keep. Keepers you don't reach in time are lost for the run. That is intended.

One string in `strings.v1` is deliberately empty. Its gate is S08. See `AGENTS.md` for who may fill it.
