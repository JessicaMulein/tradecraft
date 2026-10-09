# Tradecraft

![./box_art.jpeg](./box_art.jpeg)

A text espionage game set in occupied Vienna, 1952. You run agents for a Western intelligence Station, work out who is lying to you, and try to stop a hostile Plot before it completes. Every playthrough is generated from a seed.

A deterministic simulation owns all ground truth: who works for whom, where people go, what was said and what really happened. Local language models only voice characters and describe scenes. They never create, change or reveal facts, so the mystery stays fair and every game can be replayed exactly.

## How it plays

- **Human sources.** Approach people, build trust, pitch them on money, ideology, coercion or ego, task them, and judge whether what they tell you is true.
- **Signals.** The Station's antenna hears radio and numbers traffic on the air, and the Cell talks more as its operation advances. Break it by hand on the Workbench (Caesar, Vigenère, columnar, book and one-time-pad ciphers, with tradecraft errors to exploit; a one-time pad only falls when its operator reused it).
- **The Case File.** Every Claim you collect is graded on the Admiralty scale (A–F / 1–6), linked, and checked for corroboration and conflict. A Claim is corroborated only by an independent source about the same moment: HQ's Cables and Dossiers are one voice, so they point you at suspects but cannot confirm them. An arrest needs a strong enough case: each fact confirmed in the field adds to it, intent (what someone plans and targets) counts most, and HQ's word alone counts for nothing.
- **Counterintelligence.** A Hostile Service watches you. Its watchers sit at risky places, so walking straight into them, careless approaches, meetings and drops raise hidden Cover Suspicion; it can tail you and eventually burn you. Countersurveillance routes cost time and avoid the watchers. It also runs dangles, plants stories in the papers, and may have a mole in your own Station.
- **Deception.** NPCs keep cover stories and lie consistently. You can turn agents and feed the Hostile Service chickenfeed and deception through them.
- **Noise.** Side Threads and Rumours look like leads. The debrief at the end shows what was real.

## Status

The vertical slice is playable end to end through `pnpm play`: the Turn Pipeline runs the day-boundary hooks (Plot, schedules, the Hostile Service, newspapers, Directives, Cable replies, end detection), every action is dispatched, the App Shell drives the game, and new games, saves and debriefs work.

Follow-on specs that were on the roadmap are in the repo and **off by default**. `content-expansion`, `plot-library`, `ambient-world` and `campaign-career` are implemented. Shipped `config/scenario.yaml` still loads only the `core` pack. Plot library and ambient city stay off unless a scenario sets `plotSelection.enabled` or `ambient.enabled`. Campaign is a separate career loop, not the default `pnpm play` path. `generatorVersion` stays `0.7.0`.

`pnpm run check` still fails before the test suite: engine typecheck has a handful of pre-existing errors, and dependency-cruiser still reports four content-tools lint-rule cycles (unchanged since the initial commit). The tests themselves pass, including the golden replays and the release lint.

The developer playtest (slice-integration task 20) is still to do: full campaigns through `pnpm play` with live models, and an evals run to set the active model profile.

Plot library and ambient both hold the CI bands on the 30/15 sample, including hard ambient (87%) and both-on (83%). Do not turn either flag on in `config/scenario.yaml`. Multi-city tasks 1–15 are done. Single-city play stays the shipped path. A regional posting is `pnpm play --scenario config/scenario-region.yaml` (Vienna, Berlin, and Trieste, 1953).

## Requirements

- macOS or Linux, Node.js 22, pnpm 11 (via Corepack)
- [LM Studio](https://lmstudio.ai) with the `lms` CLI, for anything that talks to a model
- The reference machine is an Apple M4 Max with 64 GB. The default profiles keep two 4-bit models resident. Smaller machines need smaller models in `config/models.yaml`.

Everything runs locally. No cloud models are used.

## Setup

```sh
corepack enable
pnpm install
pnpm run check          # typecheck, lint, dependency rules, tests
```

To use live models:

```sh
# Edit config/models.yaml so the model ids match what LM Studio lists, then:
pnpm models:pull        # downloads missing models for the active profile (the only command that downloads)
pnpm repl --seed vienna-alpha   # scripted first live session, recorded to packages/evals/replays/
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm play [--seed <s>] [--profile <name>] [--scenario <file>]` | Launch the game: validate the configs, start the Model Manager (connect, preflight, load the active profile), then open the App Shell. `--seed` pre-fills the start screen; `--profile` overrides the active profile in `config/models.yaml`. `--scenario` is a file under the repo root; the default is `config/scenario.yaml`. `config/scenario-region.yaml` starts the 1953 region. |
| `pnpm play:web [--profile <name>]` | Same startup as `pnpm play`, then serve the game to your browser on 127.0.0.1 only, with the soundtrack. See `docs/web-shell.md` |
| `pnpm evals [--profile <name>] [--out <dir>]` | Run the model evaluation harness and write a Markdown + CSV comparison report (default `logs/evals/`). With `--profile <name>` it runs that one profile; with none it compares every profile, unloading each before loading the next |
| `pnpm run check` | Typecheck, lint, dependency-cruiser boundary rules and all tests |
| `pnpm world --seed <s> [--preset easy\|standard\|hard] [--reveal]` | Generate a world and print the Starting Brief; `--reveal` adds the hidden truth (allegiances, mole, Plot, noise) |
| `pnpm sim --seed <s> --script <actions.json>` | Run scripted actions through the engine with no model and print the Fact Lines and Case File (example: `packages/evals/scripts/example-actions.json`) |
| `pnpm repl [--seed <s>]` | One scripted live session through LM Studio with recording on, then a Case File, Journal and truth dump |
| `pnpm models:pull` | Download the active profile's missing models with `lms get` |
| `pnpm seeds:vet` | Rebuild `config/featured-seeds.json`: play candidate seeds with the expert playability probe (offline, about a second each) and keep those won mid-way through the operation. A seedless new game starts on one of them |

### Saves Directory

Saves and outcome records live under `saves/` at the repo root (gitignored). Each save is one `saves/<name>.save.json` file, written atomically so an interrupted write never corrupts the previous save. Outcome Records from finished games are written beside them under `saves/outcomes/`.

### App Shell key map

The App Shell owns these global keys on every screen (shown in the in-game help overlay, `?`):

| Key | Screen / action |
| --- | --- |
| `c` | Case File |
| `d` | Documents |
| `w` | Workbench |
| `j` | Journal |
| `m` | Map |
| `p` | People |
| `f` | Feed composer for the selected turned Asset |
| `s` | Save |
| `l` | Load |
| `?` | Toggle the help overlay |
| `q` | Quit (confirms first) |

Within a scene, `Enter` opens the action menu or submits a typed line and `Esc` goes back (ending a Talk Scene).

## Balance

Every preset is calibrated against three scripted player models that play whole games offline through the real engine (`packages/app/src/lib/playability-probe.ts`, `scripted-games.ts`):

| Model | Plays | Expected |
| --- | --- | --- |
| Expert | Works the leads, the Station's traffic and informants placed where the operation shows itself, and arrests as soon as the case allows | Usually wins, with the win landing mid-way through the operation rather than in its opening days or on its last |
| Reckless | Takes direct routes into risky places and cold-approaches strangers | Burned by the Hostile Service on `standard` and `hard` |
| Idle | Only waits | Always loses when the operation completes |

Measured on 100 seeds per preset when the arrest thresholds were last set:

| Preset | Arrest threshold | Expert wins | Median win (share of the operation's timeline) | Reckless burned |
| --- | --- | --- | --- | --- |
| easy | 6 | 100% | 41% | n/a |
| standard | 7 | 90% | 53% | 87% |
| hard | 7 | 91% | 63% | 97% |

The expert reads ground truth to decide where to look and stands in for perfect cryptanalysis, so these are upper bounds; a human player finds the evidence more slowly. `packages/app/src/lib/playability.calibration.spec.ts` holds the bands in CI on a fixed **core-only** sample. When a deliberate change moves them, re-measure, update the bands and this table together, and re-run `pnpm seeds:vet`.

### Feature-on re-measure (8 Oct 2026, after the deadline fix)

Same seed prefix as CI (`calibration-N`, `calibration-idle-N`, `calibration-reckless-N`). Sample: 30 expert / 15 idle / 15 reckless seeds per preset — the CI sample size. Bands unchanged: expert win ≥ 80%, median win fraction in [0.35, 0.75], very-early wins ≤ 15%, expert burned ≤ 10%; idle always `failure-plot`; reckless burned ≥ 60% on `standard` and ≥ 75% on `hard`.

| Mode | easy expert | standard expert | hard expert | idle | reckless std / hard |
| --- | --- | --- | --- | --- | --- |
| core (shipped) | 100% · median 44% · holds | 100% · 48% · holds | 90% · 58% · holds | 15/15 plot | 93% / 100% · holds |
| ambient on | 100% · 50% · holds | 93% · 46% · holds | 87% · 59% · holds | 15/15 plot | 100% / 100% · holds |
| plot library on | 100% · 52% · ~53d · holds | 97% · 56% · ~50d · holds | 83% · 57% · ~46d · holds | 15/15 plot | 100% / 100% · holds |
| both on | 100% · 55% · holds | 93% · 56% · holds | 83% · 57% · holds | 15/15 plot | 100% / 100% · holds |

Core still holds after the expert probe started sweeping the Station every day, inside the two-day intercept retention. Ambient holds on easy, standard, and hard (100% / 93% / 87%, medians 50% / 46% / 59%). Outlet editions are sold at the kiosk with the city paper and come off the rack the next day, and a cover shift can be kept a phase late at a place that cover fits. A missed shift still drops standing with the employer; the suspicion from the miss stays small enough that skipping the day job does not, by itself, put a tail on a player who never takes to the street. The plot library holds every band. Meetings evidence a real contact, a confirm stage carries a second signal before the finale, and a subplot's confirm waits on its own opening instead of firing in the first week. With both flags on, the same bands hold (100% / 93% / 83%, medians 55% / 56% / 57%) on the library clock, about 46–53 days. CI still measures core only. Bands were not retuned. Do not enable either flag in the shipped scenario.

Library deadlines accumulate the way slice `buildStages` does: `max(predecessor days) + draw(min, max) + slack`, with sibling alternatives sharing the branch point. Opening `coldwar-plots` stages are 12–20 days, the confirm beat is 6–10, and the finale is 14–22. Side threads stay shorter. `attend-duty` is in the action catalogue. Trace lines are no longer the two recycled sentences.

## Architecture

A pnpm + Nx monorepo of twelve TypeScript packages:

| Package | Role |
| --- | --- |
| `content` | Zod schemas and the Content Pack loader. Imports only `zod` and `yaml`. |
| `engine` | The deterministic simulation: seeded PRNG streams, world generation, actions, clock, Plot, Hostile Service, ciphers, endings, opt-in ambient city and plot library. Owns all truth. |
| `llm` | OpenAI-compatible Gateway (routing by Model Role, retries, recording and replay) and the LM Studio Model Manager (preflight, load/unload). |
| `dialogue` | Knowledge slicing, prompt building, intent classification, Leak/Specifics/Refusal guards, the Narrator and Claim extraction. |
| `player-view` | The truth boundary: Case File, Journal, view projections, the Turn Pipeline, saves and debrief. May import campaign only through `packages/campaign/src/view.ts`. |
| `tui` | Ink terminal screens. May import only `player-view`. |
| `app` | The Composition Root (`createGame`), the `pnpm play` launcher, file-backed saves and Outcome Records, the Fake Seams, and the playability probe and featured seeds. Nothing but `evals` may import it. |
| `evals` | Golden replays, the model evaluation harness and the debug CLIs. |
| `campaign` | Career loop: HQ, postings, Review Board, carry-over, arcs. Campaign Truth does not cross the public API. |
| `content-tools` | Authoring lint (period, CE-PLOTBIND, pack cross-refs). |
| `plot-lab` | Bind, reachability and oracle CLI for plot-library templates. |
| `web` | Localhost web shell over the same `player-view` facade (`pnpm play:web`). |

Boundaries are enforced by `.dependency-cruiser.cjs`. Ground-truth values are branded `Truth<T>` in the engine and never cross into `player-view` projections.

Configuration lives in `config/models.yaml` (role → model, two profiles), `config/scenario.yaml` and `config/featured-seeds.json` (written by `pnpm seeds:vet`). Content lives under `packages/content/packs/`. The shipped scenario loads `core` only.

### Content Packs

Content is data, versioned in packs (`pack.yaml` with `id`, `version`, `contentSchema`, `requires`, `overrides`). An extension pack can add new archetypes, personas, Location Types, Plots, Side Threads, Rumours and documents under its own namespace, reference other packs' content by namespaced id, and override listed ids. Saves record a Content Manifest and refuse to load against different packs.

Packs cannot add new mechanics (action kinds, channel kinds, cipher kinds). Those are code.

Packs on disk, beyond `core`:

| Pack | Role | Loaded by shipped play? |
| --- | --- | --- |
| `core` | Predicates, the core city, archetypes, difficulty presets, slice plots | Yes |
| `ambient` | Civic orgs, cover duties, events, incidents, life, outlets, regard | No on the shipped scenario. `config/scenario-region.yaml` loads it and sets `ambient.enabled`. Regional content loading registers those kinds. Do not add the pack to `config/scenario.yaml`. |
| `coldwar-plots` | Template-schema-v2 plots and side threads | No. Loaded only when a scenario lists it and sets `plotSelection.enabled`. |
| `era-cold-war-early` | Era profile | No |
| `lib-western`, `lib-russian`, `lib-iberian`, `lib-eastern-mediterranean`, `lib-central-europe`, `lib-descriptors`, `lib-archetypes` | Shared name and flavour libraries | No |
| `city-vienna`, `city-berlin`, `city-istanbul`, `city-lisbon`, `city-trieste` | Authored cities | No. `generate()` can take a city bundle. The launcher resolves `setting.city` when that pack is loaded. |

A Plot or Side Thread stage's traces bind to Locations by **function tag** (a Tag Query like `[function:cafe]`), not by a specific Location Type id. A city satisfies a plot's observable events by tagging *some* public Location for each function the plot needs; the lint's CE-PLOTBIND rule fails a release build whose city cannot, rather than letting it fall over at generation. One upshot: the shipped cities still carry a few Location-Type ids kept from an earlier id-matched binding (e.g. a café typed `core/kaffeehaus`). These are harmless — tag-binding resolves them correctly — so they are left as-is; if you revisit those packs, you can rename them to local-flavor ids in the same pass (it needs a `GENERATOR_VERSION` bump and a golden re-record, so it is not worth doing on its own).

## Roadmap

Follow-on order: content-expansion → plot-library → ambient-world → campaign-career → multi-city. Single-city mode stays unchanged. Debrief stays at eight sections.

1. **slice-integration** — assembled the slice into a playable game. Remaining: the developer playtest (task 20 / slice task 24).
2. **content-expansion** — done. Content Kind Registry, Era and Library packs, five authored city packs, authoring tools. Shipped play still loads `core` only. The launcher resolves a loaded `setting.city`; a city that was not loaded still fails.
3. **plot-library** — done, opt-in (`plotSelection.enabled`). Template schema v2, `coldwar-plots`, Plot Lab. The 30/15 sample holds (expert 100% / 97% / 83%). Leave it off in the shipped scenario.
4. **ambient-world** — done, opt-in (`ambient.enabled`). Living city, duties, gossip, news, couplings. Catalogue reads the `ambient` pack from disk. `attend-duty` is in the action catalogue. The 30/15 sample holds (expert 100% / 93% / 87%), and both-on holds with it (100% / 93% / 83%). Leave it off in the shipped scenario.
5. **campaign-career** — done. HQ, postings, Review Board, carry-over and arcs. Separate from the default slice loop.
6. **multi-city** — done. Tasks 1–15 are done: regional content loads, the region world types and streams are in place, `generateRegion` builds a verified region from a template, the region clock advances every city's spine before applying tiered ambient couplings, departures, border checks and travel papers resolve inside a region, services share beliefs, expel a persona non grata, and answer liaison requests, remote tasking, courier reception and handoffs run only when a region is set, an arrest quote in a region also requires jurisdiction, notices from another city wait out the communication latency, save version 4 round-trips the regional world (version 3 still loads in slice mode), and outcome schema 2 carries an optional region block. The player view shows the region map, departures, papers and each person's last known city, the case file filters by city, and the status bar names the city or the transit. The narrator scene descriptor carries the city name and style sheet, and the TUI has a region map, departures board, papers panel and carriage scene. Generation, coarse and full advance, and reconciliation are written to the metrics log. The evals bench measures the fixture four-city region against the Req 19 budgets, with thresholds scaled in CI. Regional eval fixtures cover a border inspection, a liaison meeting and a carriage conversation, and one golden replay is checked in per fixture starter region. The suite passed at the final checkpoint. `pnpm play --scenario config/scenario-region.yaml` starts that region. The turn clock draws each city's spine, runs the service day, and holds remote notices. When that scenario sets `ambient.enabled`, the player's city takes one ambient phase per turn and the other cities take a coarse step. The opening cable names a cell member and a meeting. A note at the meeting and orders elsewhere confirm the leader and the plan; the cable alone does not. People keep a weekly schedule. The note at the meeting names where the orders are, so the case file points at the next city. `pnpm player:train` records the slice plus a short ambient game and a short regional game, and `pnpm player:play --scenario slice|ambient|region` plays saved weights on that game. Slice `generate` is unchanged when `region` is unset. Leave ambient and plot selection off in the shipped scenario. `generatorVersion` stays `0.7.0`.

Later specs that already have `requirements.md` / `design.md` / `tasks.md` (none of these are started):

- **web-shell** — localhost browser client over `player-view`. `pnpm play:web` exists; the spec tasks are unchecked.
- **street-ops** — street graph, drive sessions, tails, checkpoints, concealment.
- **setting-generalization** — era profiles, terminology maps, capabilities beyond the early Cold War.
- **natural-language-commands** — phrasebook matcher and typed-line orchestration.

## Specs

Specs live in `.kiro/specs/<name>/` as `requirements.md`, `design.md` and `tasks.md`:

| Spec | Status |
| --- | --- |
| `tradecraft` | The slice. Done. |
| `slice-integration` | Assembled. Playtest (task 20) still open. |
| `content-expansion` | Implemented. Shipped play path still core-only. |
| `plot-library` | Implemented, opt-in. 30/15 sample holds. |
| `ambient-world` | Implemented, opt-in. 30/15 sample holds, including hard. |
| `campaign-career` | Implemented. |
| `multi-city` | Implemented. Shipped play stays single-city. `config/scenario-region.yaml` starts central-1953. |
| `web-shell` | Spec only (launcher command exists). |
| `street-ops` | Spec only. |
| `setting-generalization` | Spec only. |
| `natural-language-commands` | Spec only. |
