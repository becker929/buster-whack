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

## v3 — 2026-09-03 — Claude (authoring + engine session)

Strings resealed as `strings.v2` (254 ids, from 136). The vault was opened in this session for the rewrite; nothing from it was echoed to Anthony. Every gated id from v1 keeps its id and gate. New: an intro in four beats, hails (unprompted on arrival, by visit), talk exchanges in three beats with Wren replying, five companion npcs (`npc.side.*`, `npc.sweeper.tidy`), the journal as a READ tile, and every mechanic announced by a person instead of a card. Places re-said as radios on roofs. One forbidden word removed from v1. Decisions are in `vault/04_road_and_people.vault` (id `canon.road`).

Bible: `entities.json` gains the companions, the runner (`ally`) and the verbs; `regions.json` → `strip.route_v3` is the linear route the strip takes until exits exist (no roost repeats in the first eight towers); `string_ids.json` regenerated for `strings.v2`.

Engine: STORY is the only mode; the arcade cards are off in it; unlocks keyed to the towers that announce them.

## v4 — 2026-09-03 — Claude (engine + authoring session)

`strings.v3`, 235 ids. Every line rewritten plain and short after play feedback: the longest string is under half the previous longest (157 vs 315 chars), a conversation is about 30% shorter end to end, and nothing is said in a roundabout way except by one character whose riddling is named in-world as a fault. Conversation ids are now `<npc>.c<N>.<beat>`; the old `hail.*`/`talk.*.[abc]`/`intro.*` ids are gone. All gated ids are unchanged.

Engine: nothing plays on its own any more. TALK opens a conversation, TALK shows the next beat, TALK on the last beat closes it; walking away from the person closes it. Arrival at a tower sets a small place label and says nothing. Towers stand before every tenth arena (was third), and the story's unlocks moved with them (10, 20, 30 ...). The Substation now precedes the Elevator on the route so its keeper can give the crew's warning.

Open for the next author: the Elevator has nobody to warn of the Sweepers' second rank at 70; Tolling's line covers it in advance. Sunsets, carry and the endings still wait on their mechanics.
