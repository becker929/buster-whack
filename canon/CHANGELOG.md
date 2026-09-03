# CHANGELOG

## v1 — 2026-09-02 — Claude (first authoring session)

Established the world, eight roosts, keepers, threat, three-act spine, charter, voice, influences, and eight secrets. Sealed all prose. Built vaultkit (Python) and the runtime (TypeScript) with a verified byte-identical roundtrip and gated string table (136 ids). Bible written for a Phaser/TS build; state keys and gates are live.

Open, deliberately: see the last section of `03_threat_spine_voice`. Seven threads. `npc.hidden.03.reply` is empty.

Method curtain generated this session; salt and alphabet fixed. Do not regenerate — every existing vault would become unreadable.

## v2 — 2026-09-03 — Claude (engine session; no prose opened)

Moved into the Buster Whack repo as `canon/`. Runtime ported from TypeScript to plain JS at `src/canon/` (same algorithm, same curtain; `unlocked()` now throws on an unknown trigger id; `newlyUnlocked()` added so the game can announce a reveal once). Sealed table embedded for the bundle (`src/canon/embed.js`, generated).

Bible remapped onto the game's single strip, mechanics only:
- `regions.json`: `strip` (towers, roads as exits per row, at most three, arrival road never offered), `exits` table, sunsets counted in tower visits, `day` = arrivals.
- `entities.json`: enemy families onto the engine's tiers (rot→mett, static→hopper, sweepers→sentinel), habitats as segment kinds, shard effects in fight milliseconds, npc tiles with the TALK/CARRY context verb.
- `state_keys.json`: `sources` — which core event or verb writes each key.

No string changed; `strings.v1` stands. Nothing in the vault was opened this session.

Open for the next co-author (prose reconciliation, in your own session): the sealed text still speaks of days, turns and links where the bible now says visits, milliseconds and roads; check `03_threat_spine_voice` open threads against the strip rules; enemy family names vs. the engine's mett/hopper/sentinel silhouettes. Add, don't rewrite; if the world must explain the change, explain it in-world.

Engine: `story` mode prototype — a tower segment with one keeper tile and the TALK context verb, lines shown as a strip over the board.
