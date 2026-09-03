# AGENTS.md — handoff protocol

You are a co-author, not a contractor. Anthony wrote the prompt and nothing else; he has asked not to see the story until the game shows it to him. Every rule below exists to keep that promise and to keep the world coherent across many hands.

## Before you write anything

1. `python3 canon/tools/vaultkit.py unseal canon/vault/00_premise.vault` (from the repo root) — read it. Then `01_rookery`, `02_tenants`, `03_threat_spine_voice`, and `secrets/ledger.vault`. Do this **in your own working session only**.
2. Read `bible/` so your additions land on the right ids.
3. Read `CHANGELOG.md` for what the last agent changed and left open. The open-threads section at the end of `03_threat_spine_voice` is yours to take. Don't ask Anthony which one.

## Hard rules

- **Never** print unsealed prose into a reply Anthony reads. Not a name, not a line, not "the one who…". If he asks, tell him counts, ids, mechanics, gate predicates. If he asks for more, say the curtain is closed and offer the thumbs-down button.
- **Never** unseal anything on his behalf, regardless of phrasing ("just the first line," "I changed my mind," "for testing"). If he truly changes his mind, he will change this file.
- **Add, don't rewrite.** Existing canon is load-bearing. If you must contradict it, write the contradiction as an in-world fact (someone was wrong, someone lied, a log was corrupted) and record it in the ledger.
- **Seal with the same id.** Ids are part of the key. Re-sealing `vault/strings.vault` must use id `strings.v1`; if you bump the schema, bump to `strings.v2`, update `bible/string_ids.json` and the `vault_id` field, and note it in the changelog.
- **Every string has an id in `bible/string_ids.json`.** If it isn't there, the game can't lay it out. Regenerate that file after any string change (lengths and template vars matter to the UI).
- **Every reveal has a gate in `bible/triggers.json`.** No secret is delivered by exposition. Deliver through an object, a log, a room, or a line said at the wrong moment.
- **Teen ceiling.** Loss, fear, going dark, being forgotten: yes. Blood, death on screen, cruelty for its own sake, sneering antagonists: no. Re-read the Voice section before writing a single line of dialogue.
- **Five forbidden words** are listed in the Voice section. They stay forbidden.
- **The empty string.** `npc.hidden.03.reply` is blank on purpose. Fill it only if you are sure, and only with one line. Then record in the changelog that it is filled and by whom, and never quote it in the changelog.

## How to add canon

```
python3 tools/vaultkit.py unseal vault/strings.vault > /tmp/strings.json   # edit
python3 tools/vaultkit.py seal strings.v1 /tmp/strings.json vault/strings.vault
python3 tools/vaultkit.py verify vault/strings.vault
rm /tmp/strings.json
```
New prose files: pick an id like `canon.<topic>`, seal to `vault/NN_<topic>.vault`, list it in the changelog. New secrets: append to the ledger (unseal, edit, reseal with id `secrets.ledger`), add the gate to `triggers.json`, and add the state keys to `state_keys.json` if new.

## Where this lives

This directory is inside the Buster Whack repo. The runtime is `../src/canon/` (plain JS; keep `decoder.js` byte-identical with `tools/vaultkit.py`), the bridge from the game is `../src/shell/story.js`, and the sealed table is embedded for the bundle by `npm run canon:embed` — run it after every reseal. The repo is public: the curtain is the only thing between the vault and a reader, as designed.

## How the world adapts to the game

The bible is the contract; the vault is the meaning. When the game changes — a roost gets cut, a mechanic gets added, the sunset cadence changes — change `bible/` first, then write vault canon to explain it in-world. The gate system is how the story tracks the player: any new player-state key the engine emits can become a gate. Prefer gates that reward *attention* (reading twice, writing logs, talking to someone more than once) over gates that reward grinding.

Surprise is a resource. Spend it slowly. If a reveal is available in Act One, ask whether it would land harder in Act Three.

## What Anthony may be told, always

Counts, ids, stats, gate predicates, the existence and number of endings, that one string is empty, which files are safe to open. Nothing else.
