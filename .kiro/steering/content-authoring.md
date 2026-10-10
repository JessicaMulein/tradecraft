---
inclusion: fileMatch
fileMatchPattern: ["packages/content/packs/**", "content-drafts/**", "packages/content-tools/**", "config/authoring.yaml"]
---

# Content and setting authoring

The owner writes a brief and approves results. Agents author everything else and prove it with the content tools that already exist. This file is the process. It adds no new mechanism: it strings together the Content Pack system, `pnpm content`, Plot Lab and the playability probe from the content-expansion spec.

Read `AGENTS.md` first for how to work with the owner.

## What already exists (use it, do not rebuild it)

| Piece | Where | Spec |
| --- | --- | --- |
| Content Packs (`pack.yaml`: `id`, `version`, `contentSchema`, `role`, `requires`, `overrides`). Roles: `core`, `era`, `city`, `library`, `extension` | `packages/content/packs/<id>/` | content-expansion Req 1–2 |
| Content Kind Registry, Zod schemas, loader, Provenance gate | `packages/content/src/` | Req 16–17 |
| Pack Linter (`--profile draft\|release`) | `pnpm content lint` | Req 12–13 |
| Preview CLI (`city`, `locations`, `npcs`, `newspaper`, `documents`, `dossiers`, `cables`, `fact-lines`, `intercepts`) | `pnpm content preview` | Req 14 |
| Coverage Report | `pnpm content coverage` | Req 15 |
| Authoring Aid (local model drafts) and promotion | `pnpm content author`, `pnpm content promote` | Req 16 |
| Plot template checks | `pnpm plot-lab check\|sidethreads` | plot-library |
| Playability probe and calibration bands | `packages/app/src/lib/playability-probe.ts`, `playability.calibration.spec.ts` | README "Balance" |

Reference packs to copy the structure of (not the content): `era-cold-war-early`, `city-vienna`, `lib-central-europe`, `lib-descriptors`, `coldwar-plots`. Every pack file starts with a header comment saying what it is and which task or requirement it serves. Keep doing that.

## What a "setting" is in this repo

A setting is a set of packs, not new code:

- **Era Pack** (`role: era`, exactly one per city): the `era` record and Period Window, technology, cipher conventions, Style Guide (`style-guide/document-styles.yaml`, `quality-rules.yaml`), anachronisms, Real-Person Blocklist, sensitivity terms, era Locale, shared Service Definitions, public texts.
- **Library Packs** (`role: library`): culture groups with name pools, archetypes, persona backgrounds, descriptor fragments.
- **City Packs** (`role: city`): `city.yaml`, districts, locations, location types, routes, streets, weather, sources, newspapers, local orgs, services, cover identities, locale, rumours, template variants, articles, `lint.yaml`.
- **Plot packs** (template schema v2, like `coldwar-plots`) and the `ambient` pack, if the setting needs its own.

**Era limit.** Anything outside 1945–1965 depends on the setting-generalization spec (Era Profiles, Capabilities, terminology, the Prompt Frame), which is **not started**. The 1945–1965 window is still a constant in code (for example `packages/content/src/lib/plot-v2.ts`). Do not fake a modern or earlier setting with content alone. Do the setting-generalization tasks first, or tell the owner that is the blocker.

## Hard rules (enforced by the loader and linter; never work around them)

- People and organisations are fictional. A real place uses `basis: real-landmark` and cites `sources/sources.yaml`.
- The Real-Person Blocklist, Sensitivity Term, schema, dangling-reference and Provenance lint rules **cannot be suppressed**. Other suppressions need a written justification in the pack's `lint.yaml`.
- Follow the Style Guide's manual rules too (for example aftermath restraint, and naming officials by office rather than by personal name). The linter lists them but cannot check them, so the reviewer must.
- Model-written files carry a Provenance Record (`provenance: { generated: true, model, promptHash, generatedAt }`). The loader refuses them until `reviewedBy` and `reviewedAt` are set, and it never reads `content-drafts/`.
- Do not remove or rename ids in a released pack without a major version bump (checked with `--baseline`).
- New content kinds go through the Content Kind Registry as a spec task. Never drop in a file of an unregistered kind.
- The shipped `config/scenario.yaml` loads `core` and `coldwar-plots`, with plot selection on. Ambient, street ops, and authored cities stay out of that file. Try other new content with a separate scenario file, as `config/scenario-region.yaml` does.
- Changes that alter generated worlds for existing seeds need a `GENERATOR_VERSION` bump and a golden re-record. Avoid them, and stop and ask the owner if one is unavoidable.

## The pipeline

### 1. Brief to plan

Turn the owner's brief into a short authoring plan: which packs and kinds, how many items against the Quantity Targets (content-expansion Req 11), which real places need sources, and any code or spec prerequisites. Ask the owner only if the brief leaves intent or taste open. Ask it as one choice with your recommendation.

### 2. Draft into the Draft Area

All model-written content goes to `content-drafts/<pack>/<kind>/<UTC stamp>.yaml` in the envelope form `{ provenance, items }`, never straight into a pack. There are two routes, and both are fine:

- **Local Authoring Aid:** `pnpm content author --pack <id> --kind <kind> --count <n> --brief "<text>"`. Its prompt already includes the kind's JSON Schema, the Style Guide, in-period anachronisms, the blocklist, sensitivity terms and samples of existing items. It needs `config/authoring.yaml` (schema in `packages/content-tools/src/author/config.ts`, local endpoint only), which is not in the repo yet; create it from that schema if you use this route. Invalid output lands in a `.rejected.json` sidecar. Read it and re-draft.
- **The agent itself (Kiro or Cursor):** write the same envelope with `generated: true`, your model id, a `promptHash` (a sha256 of the brief plus the instructions you worked from) and `generatedAt`. Before writing, read the kind's Zod schema in `packages/content/src/kinds/` and the same Style Guide, anachronism, blocklist and sensitivity files the Authoring Aid uses.

### 3. Independent review

Use a reviewer that did not write the draft: a separate agent session, or a different model from the author. It checks the draft against the Style Guide (including manual rules), anachronisms, the blocklist and sensitivity terms, stereotyping of real national or ethnic groups, period plausibility, sources for real places, and duplicates of existing items. Write its findings next to the draft as `<stamp>.review.md`. The author revises until the review is clean.

### 4. Staging run (proves the content works in play)

The loader cannot read drafts, so test them in a scratch copy under `tmp/` (git-ignored). `pnpm content` and `pnpm plot-lab` run inside their own package directory, so a relative path can resolve there instead of at the repo root. From the repo root, always pass absolute paths:

```sh
STAGE="$PWD/tmp/content-staging/packs"
mkdir -p "$STAGE" && cp -R packages/content/packs/. "$STAGE/"
pnpm content promote "$PWD/content-drafts/<pack>/<kind>/<stamp>.yaml" --into "$STAGE/<pack>/<file>" --reviewer staging --dirs "$STAGE"
```

The staging promote uses the default `draft` lint profile, so a pack that is still short of its Quantity Targets can be tested. The `release` profile is the gate below.

Then run every gate with `--dirs "$STAGE"`:

- **Lint:** `pnpm content lint --dirs "$STAGE" --packs <ids> --profile release` with no errors.
- **Preview:** `pnpm content preview --dirs "$STAGE" --packs <ids> --city <id> --seed <s> --kind <kind>` for every kind you touched, on at least three seeds. Read the output yourself; it is exactly what a player will see.
- **Coverage:** `pnpm content coverage --dirs "$STAGE" --packs <ids> --cities <id> --presets easy,standard,hard --seeds 50 --out "$PWD/tmp/coverage/<id>"`. There must be no unused items you meant to ship, and every Required-Query margin must be positive.
- **Plots:** `pnpm plot-lab check` and `pnpm plot-lab sidethreads` with `--seeds 50 --preset standard --out "$PWD/tmp/plot-lab"`. Plot Lab reads the real `packages/content/packs` (not `--dirs`) and currently binds only the `core` city. Plot Lab coverage for staged content or a new city is a code task: say so rather than skipping it silently.
- **Balance**, for a new city or anything that touches plots, difficulty, services or routes: run `probeSeed` with `scenario` overrides (packs and city) on the CI sample sizes (30 expert / 15 idle / 15 reckless per preset) and compare with the README bands. There is no CLI for this yet. A throwaway script under `tmp/` is fine.
- **Repo checks:** `pnpm run check`. The README lists the failures that already exist. Add no new ones.

### 5. Owner sign-off

Write `content-drafts/<setting-or-pack>/SIGN-OFF.md`. It is the only thing she needs to read. Keep it short and in plain language:

- what was added, as a player would notice it;
- a handful of real samples copied from the preview output (a few people, places, a newspaper edition, a document);
- one line per gate (lint, coverage, plots, balance) saying passed or what failed;
- choices that need her, each with your recommendation;
- anything that changes existing games, or "nothing".

She answers in plain words. Turn that into edits, re-run the gates, and update the sign-off note.

### 6. Promote

Only after she approves, promote each draft into the real pack, with her as the reviewer of record:

```sh
pnpm content promote "$PWD/content-drafts/<pack>/<kind>/<stamp>.yaml" --into "$PWD/packages/content/packs/<pack>/<file>" --reviewer "Jessica Mulein" --dirs "$PWD/packages/content/packs" --profile release
```

Promotion re-runs the linter on the merged set and refuses if it finds errors. Then bump the pack's `version` (minor for additions), and update the README tables if pack status changed.

## Turning feedback into changes

| She says | Usually means |
| --- | --- |
| "Feels too modern" | Add Anachronism Entries or a Style Guide rule for what slipped through, then re-draft. Fix the list, not just the item. |
| "Too dark" or "too gloomy" | Revisit aftermath restraint, rumour and article tone, and weather and atmosphere words. |
| "Everyone sounds the same" | Widen persona backgrounds and descriptor fragments, check Coverage underuse, and look at template variants. |
| "X should feel more dangerous" | Usually tuning, not text: service strictness, sector or route tags, difficulty values. Validate with the probe. |
| "Too easy" or "too hard" | Difficulty preset values. Validate against the calibration bands, and update the README Balance table and `pnpm seeds:vet` together. Never loosen the CI bands to make a change pass. |

## Scene images (planned, not built)

The Still-Frame Hook is web-shell task 8, which is not done. Its Frame Request is built only from Player View data, and its art direction is currently a single `frames.artDirection` string in `config/web.yaml` (web-shell design, "Frame service"). For settings in other eras, art direction belongs to the era: propose it as part of setting-generalization's Prompt Frame, with the config value as an override. Do that as a spec change; do not add a pack kind for it.

When authoring a setting today, put a proposed one-paragraph art direction in the sign-off note so it is ready when the hook lands. Image rules that will apply then: images use public data only, contain no lettering (text is drawn in code), and get checked against the era's anachronism list.

## Music

The soundtrack is shared by every setting (`soundtrack/cue-map.yaml`). A new setting needs no new cues unless the owner asks for them.
