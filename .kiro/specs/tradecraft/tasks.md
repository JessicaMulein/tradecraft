# Implementation Plan

## Overview

The plan builds the content foundation first, then the deterministic engine (world, noise, time, ciphers, documents, station, actions), then the model-facing layers (gateway, dialogue, narrator), then the systems on top (recruitment, the Hostile Service, endings), and finally persistence, the TUI and the eval harness. Each property test sits next to the code it checks. Property numbers refer to the design's Correctness Properties.

## Tasks

- [x] 1. Set up the monorepo and shared primitives
  - Create a pnpm workspace with packages `engine`, `dialogue`, `llm`, `player-view`, `tui` and `evals`, all in strict TypeScript and ESM.
  - Add Vitest, fast-check and Zod, plus a dependency-cruiser rule that allows `tui` to import only `player-view`.
  - Implement the xoshiro128** PRNG with serializable state and `derive(seed, n)`, with unit tests.
  - _Requirements: 1.1, 2.1, 2.2, 13.5, 17.1_

- [x] 2. Build the content foundation
  - [x] 2.1 Create the `content` package and the content schemas
    - Add `packages/content` and a pinned `yaml` dependency.
    - Extend the dependency-cruiser rules so that `content` imports only `zod` and `yaml`.
    - Define Zod schemas for `pack.yaml` and every content kind in the design's content-kinds table, including the hint trigger enum and the Difficulty Preset fields.
    - Export a JSON Schema for each content kind.
    - _Requirements: 31.1, 34.2_
  - [x] 2.2 Implement the template engine
    - Parse `{slot}`, `{slot.attr}`, `{pick:pool}`, `{when}`, `{place}` and `{?slot}…{/slot}` into an AST.
    - Validate declared slots and pool references at load.
    - Implement a pure `render(ast, bindings, namer, rng)`.
    - Unit-test determinism and the error cases.
    - _Requirements: 20.1, 30.1, 32.3_
  - [x] 2.3 Implement predicate definitions and the compiled predicate registry
    - Cover argument kinds, place and window rules, and the evaluator kind enum (`fact-match`, `fact-match-symmetric`, `alias`, `membership-transitive`).
    - Compile the second-person and third-person renderers.
    - Check that field codes are unique.
    - Include literal object kinds and the optional `implication` rule (`role`, `other`).
    - _Requirements: 32.2, 32.3, 32.4, 40.2_
  - [x] 2.4 Implement the pack loader
    - Discover packs and resolve semver `requires`, then order them topologically with ties broken by id.
    - Merge packs, honouring explicit `overrides`, and check cross-references.
    - Collect every error as a `ContentError` (pack, file and path) rather than stopping at the first.
    - Hash each pack over canonical JSON and build the Content Manifest.
    - _Requirements: 31.2, 31.3, 31.4, 31.5, 31.8_
  - [x] 2.5 Write the property test for content validation
    - **Property 23: Content validation**
    - **Validates: Requirements 31.2, 31.4, 32.2, 32.4**
  - [x] 2.6 Write the property test for content load order independence
    - **Property 24: Content load order independence**
    - **Validates: Requirements 31.3, 31.5**
  - [x] 2.7 Implement the scenario config
    - Add the `ScenarioConfig` Zod schema from the design in `packages/engine/src/lib/config/`.
    - Add a loader that resolves the preset (named preset deep-merged with `overrides`, then re-validated) and reports every issue as file, field path and message.
    - Create the default `config/scenario.yaml` (preset `standard`, pack `core`, starting weights).
    - Write example-based tests: the default file validates, and representative bad fields are reported with their paths.
    - _Requirements: 34.1, 41.1, 41.2, 41.3_

- [x] 3. Author the core content pack
  - [x] 3.1 Write `pack.yaml`, `predicates.yaml`, `glossary.yaml`, `hints.yaml` and `difficulty.yaml`
    - `predicates.yaml` defines the 15 initial predicates, with the implication rules from the design's Arrest Evidence table. `KNOWS` and `SUSPECTS` accept an organisation subject.
    - `difficulty.yaml` defines the easy, standard and hard presets from the design table.
    - _Requirements: 26.5, 26.6, 32.1, 34.1, 34.2_
  - [x] 3.2 Write `city.yaml`, the Location Types, descriptors, persona libraries and Cover Identities for 1950s occupied Vienna
    - `city.yaml` holds Viennese district and street name pools with four-power sector texture (the international Inner City and the Allied and Soviet sectors), and Central European weather tables.
    - Write at least 12 period Location Types, including the Station, tobacconist kiosk, library, bookshop, Kaffeehaus, Danube port, warehouse, safehouse, hotel bar, park, railway station and embassy.
    - Give each Location Type its hours, crowd curves, allowed actions, dead-drop flag, and description and atmosphere pools, with no anachronisms.
    - Descriptors use 1950s clothing. Persona name pools are authentic but fictional combinations for the city's Austrian, Central European and occupying-power cultures. Cover Identities are period-plausible, such as a trade attaché or a wire-service correspondent.
    - _Requirements: 21.1, 21.6, 22.3_
  - [x] 3.3 Write the period archetypes
    - Cover Cell roles, hostile officers, the Chief of Station and staff roles, starting contacts, and at least 8 civilian archetypes drawn from 1950s Vienna life (for example a waiter, a tram conductor, a black-market trader or a refugee clerk).
    - Give each archetype MICE ranges, wariness, schedule templates and descriptor pools. All characters are fictional, and no archetype represents a real historical individual.
    - _Requirements: 1.3, 27.1, 29.1_
  - [x] 3.4 Write the Plot templates, Side Thread templates and Rumour templates in an occupied-Vienna setting
    - Write at least 2 Plot templates, each with stages, trace templates and public-trace article templates.
    - Write at least 2 Side Thread templates (for example penicillin smuggling or a sector-crossing affair) and a set of Rumour distortion templates.
    - Name intelligence organisations fictionally, refer to real officials by office rather than by name, and depict no real atrocities.
    - _Requirements: 29.2, 29.3, 31.7_
  - [x] 3.5 Write the document templates and public-text corpora in 1950s style
    - Write newspaper article templates (fictional Viennese mastheads), Dossier, Cable (period telegraphic style) and seized-material templates.
    - Write original or public-domain corpora for the almanac, anthology and timetable public texts, with a period-appropriate Vienna tram and rail timetable.
    - _Requirements: 30.1, 30.2, 30.3_
  - [x] 3.6 Write the content smoke test
    - Check that the core pack loads cleanly and that every Difficulty Preset validates.
    - _Requirements: 31.7, 34.2_

- [x] 4. Implement the core data model
  - [x] 4.1 Define the core types
    - Define `EntityId` (including `doc:`, `chan:` and `unk:`), `GameTime`, `Proposition` with optional `place`, and the `Truth<T>` brand.
    - Add Zod schemas and a JSON Schema export for each type.
    - _Requirements: 2.1, 7.2_
  - [x] 4.2 Build the Entity Registry
    - Store canonical names and aliases, with a distinctive/generic flag on each alias.
    - _Requirements: 5.2_
  - [x] 4.3 Implement the Truth Store
    - Add the evaluator-kind registry, `holds` dispatching by predicate, the `identityOf` mapping for Unidentified Subjects, and per-turn transactional writes.
    - _Requirements: 2.1, 2.3, 16.4, 32.3_
  - [x] 4.4 Implement the Case File model in `player-view`
    - Cover all four source kinds, the pure corroboration and conflict computation (alias-aware via held `IS_ALIAS_OF` Claims), Admiralty grading, links, and per-source history.
    - _Requirements: 7.4, 8.1, 8.2_
  - [x] 4.5 Write the property test for corroboration independence
    - **Property 10: Corroboration independence**
    - **Validates: Requirements 7.4**
  - [x] 4.6 Define the top-level state and log types
    - Define `WorldState`, `Literal`, the `SimEvent` union with the fixed per-kind visibility table, `TraceOrigin` and `ActionLogEntry` from the design, as skeleton interfaces that later tasks fill in.
    - _Requirements: 17.1, 17.5, 39.1_
  - [x] 4.7 Implement arrest evidence in `player-view`
    - Implement `aliasClasses`, the `hostileMarks` fixpoint, `implicates` and `evidenceCount`, using only Case File Claims, the Starting Brief view and predicate implication rules.
    - Unit-test each core-pack rule and alias resolution of `unk:` ids.
    - _Requirements: 40.1, 40.2, 40.4_

- [x] 5. Build the world generator (core stream)
  - [x] 5.1 Generate the city
    - Instantiate Districts, Locations and Routes from Location Types.
    - Add pure `crowdLevel` and daily weather on the daily stream.
    - Mark public Locations as known.
    - _Requirements: 21.1, 21.2, 21.6, 21.8_
  - [x] 5.2 Generate organizations and Principal NPCs from archetypes
    - Cover the Cell, hostile officers, the Chief of Station, 2–3 staff and 2–3 starting contacts.
    - Give each NPC an allegiance, MICE profile, money need, persona, descriptor and schedule.
    - _Requirements: 1.1, 1.3, 27.1_
  - [x] 5.3 Instantiate the Plot from a Plot template as a stage DAG
    - Use the preset's stage count and deadline slack, and include `requires`/`produces`, trace templates and `onDisrupted` weights.
    - _Requirements: 1.1, 3.2, 3.3_
  - [x] 5.4 Generate Channels and Dead Drops for the Plot, the Hostile Service and the Station
    - _Requirements: 24.5, 25.1_
  - [x] 5.5 Assign knowledge
    - Assign NPC Knowledge Slices, the Station's Knowledge Slice with HQ false beliefs at the preset rate, Cover Stories and Agendas.
    - Add the internal-mole option.
    - _Requirements: 1.3, 1.5, 26.2_
  - [x] 5.6 Implement the Document model and the Dossier and Cable composers
    - Generate the public texts long enough to key every book cipher, with obtainable Locations.
    - _Requirements: 26.1, 27.4, 30.1, 30.3, 30.5_
  - [x] 5.7 Generate the Cover Identity and the Starting Brief
    - Include the leads from the Station slice, Dossiers, a Channel, a Dead Drop, Directives, the Budget and starting Contact Channels, all delivered as a brief Cable.
    - _Requirements: 26.1, 26.2, 26.4_
  - [x] 5.8 Implement the discovery-path verifier
    - Build the learnability graph rooted at the Starting Brief, check for disjoint human and signal paths per Plot Stage and to the mole's identity, and retry with `derive(seed, attempt)`.
    - _Requirements: 1.4, 26.3, 27.6_
  - [x] 5.9 Implement the `generate()` entry point
    - Add the PRNG stream constants, seed generation and display, and the `GeneratorError` after the attempt limit.
    - _Requirements: 1.2, 1.6_
  - [x] 5.10 Write the property test for seed determinism
    - **Property 1: Seed determinism**
    - **Validates: Requirements 1.1, 1.2**
  - [x] 5.11 Write the property test for Plot solvability
    - **Property 2: Plot solvability**
    - **Validates: Requirements 1.4**
  - [x] 5.12 Write the property test for Starting Brief rootedness
    - **Property 19: Starting Brief rootedness**
    - **Validates: Requirements 1.4, 26.2, 26.3, 27.6**

- [x] 6. Build the noise generator (noise stream)
  - [x] 6.1 Generate Background NPCs from civilian archetypes
    - Give each one a schedule at public Locations and a local-facts Knowledge Slice.
    - _Requirements: 29.1_
  - [x] 6.2 Instantiate Side Threads from templates with no Cell participants
    - Give each Side Thread its own true Propositions, traces and Channels.
    - _Requirements: 29.2_
  - [x] 6.3 Generate Rumours as Background-NPC false beliefs, and Noise Traffic Channel schedules at the preset ratio
    - _Requirements: 29.3, 29.4_
  - [x] 6.4 Wire the noise pipeline into `generate()`
    - Use the separate noise stream, re-verify after noise, and retry with the next noise seed.
    - _Requirements: 29.5, 29.6_
  - [x] 6.5 Write the property test for noise independence and solvability
    - **Property 21: Noise independence and solvability**
    - **Validates: Requirements 29.2, 29.5, 29.6**

- [x] 7. Build the clock, Plot engine and schedules
  - [x] 7.1 Implement phases, `advance()` and the Sim event bus with day-boundary hooks
    - _Requirements: 3.1_
  - [x] 7.2 Implement Plot Stage execution
    - Turn trace templates into Sim events (meetings, transmissions, drop loads and movements).
    - Handle disruption by delay, reroute or abort.
    - _Requirements: 3.2, 3.3, 3.4_
  - [x] 7.3 Implement deterministic NPC schedule advancement and Walk-in events on the daily stream
    - _Requirements: 3.5, 22.7_
  - [x] 7.4 Implement Plot abort
    - Add `PlotState` abort fields, `abortTolerance`, `leaderAbortThreshold` and the pure `abortCheck`.
    - Count distinct disruption keys, abort on an `abort` draw or `reroute` with no alternative, and set `ended` to success on abort.
    - Expose a hook for belief-driven pressure (wired in 19.6) and materiel seizure (wired in 11.6).
    - _Requirements: 19.4, 38.1, 38.2, 38.4, 38.5, 38.6_
  - [x] 7.5 Write the property test for abort soundness
    - **Property 27: Abort soundness**
    - **Validates: Requirements 19.4, 38.2, 38.3, 38.4, 38.5, 38.6**

- [x] 8. Build the Cipher Engine
  - [x] 8.1 Implement the five ciphers as pure functions
    - Caesar, Vigenère, columnar transposition, book cipher (keyed to an in-game public text) and one-time pad.
    - _Requirements: 9.2, 9.3_
  - [x] 8.2 Implement `encodePropositions` and `parseFieldMessage` using predicate field codes
    - _Requirements: 9.1, 32.3_
  - [x] 8.3 Generate Intercepts from Plot Stages, Side Threads and Noise Traffic
    - Add traffic metadata.
    - Add tradecraft errors (pad reuse, fixed headers) at the preset probability, with cipher kinds weighted by owner.
    - _Requirements: 9.1, 9.4, 29.4_
  - [x] 8.4 Verify submitted keys and plaintexts, and add decrypted Claims to the Case File with source "intercept"
    - _Requirements: 9.5_
  - [x] 8.5 Write the property test for cipher round-trip
    - **Property 8: Cipher round-trip**
    - **Validates: Requirements 9.2, 9.3**
  - [x] 8.6 Write the property test for Intercept fidelity
    - **Property 9: Intercept fidelity**
    - **Validates: Requirements 9.1, 9.5**
  - [x] 8.7 Write the property test for the predicate-derived round-trip
    - **Property 25: Predicate-derived round-trip**
    - **Validates: Requirements 32.3, 7.2**

- [x] 9. Build the newspapers, seized material and reading
  - [x] 9.1 Generate the daily newspaper edition and seized-material Documents
    - The newspaper draws 3–6 articles from city events, public Plot traces, Side Thread traces and Rumours.
    - _Requirements: 30.1, 30.2_
  - [x] 9.2 Implement the read action
    - On the first read, add the Document's asserted Propositions as Claims with source "document". Respect obtainable Locations.
    - _Requirements: 30.3, 30.4_
  - [x] 9.3 Write the property test for Document reading idempotence
    - **Property 22: Document reading idempotence**
    - **Validates: Requirements 30.4**

- [x] 10. Build the Station, Directives and Budget
  - [x] 10.1 Implement the pure Budget ledger and the pay action's ledger effects
    - Cover `balance`, `debit` (rejecting when the balance would go negative) and credits.
    - _Requirements: 28.1, 28.2, 28.3_
  - [x] 10.2 Implement Directives, Standing and Cables
    - Check Directive objectives each phase and adjust Standing.
    - Implement the trace, funds and report Cable requests, with replies after the preset delay.
    - _Requirements: 27.2, 27.3, 27.4, 27.5_
  - [x] 10.3 Write the property test for Budget conservation
    - **Property 20: Budget conservation**
    - **Validates: Requirements 28.1, 28.2, 28.3**

- [x] 11. Build the Action Resolver and player actions
  - [x] 11.1 Implement the action framework and travel
    - Implement the `Action` union with pure `quote` and `resolve`, `ActionResult`, and Fact Line rendering with the player-perspective namer.
    - Add allowed-action and opening-hours checks.
    - Implement travel with the cheapest route and countersurveillance.
    - _Requirements: 13.2, 20.1, 21.3, 21.4, 21.5_
  - [x] 11.2 Implement Unidentified Subjects and identification
    - Allocate or reuse `unk:` ids, record `identityOf` in the Truth Store, list visible persons, and emit `IS_ALIAS_OF` Claims on identification.
    - _Requirements: 21.7, 23.4, 23.5_
  - [x] 11.3 Implement surveil and follow
    - Add observation checks, detection checks, suspicion and Cover Suspicion effects, the "made" Fact Line, and surveillance Claims.
    - _Requirements: 12.5, 23.1, 23.2, 23.3, 23.6, 23.7_
  - [x] 11.4 Implement talk presence checks, Cold Approach with `firstContact`, and Contact Channels
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5_
  - [x] 11.5 Implement arrange meeting
    - Add the slot choice, acceptance, delayed replies, the scene opening at the slot, the missed-meeting penalty, and Exposure.
    - _Requirements: 24.1, 24.2, 24.3, 24.4_
  - [x] 11.6 Implement servicing dead drops
    - For own drops, deliver contents and accept left items.
    - For hostile drops, implement copy and seize, with Plot disruption and detection checks. Seizing the Plot materiel calls the 7.4 abort hook.
    - _Requirements: 24.5, 24.6, 24.7_
  - [x] 11.7 Implement intercept and wait
    - At the Station, collect within the retention window. Implement courier interception.
    - Waiting delivers events, makes passive observations at a reduced rate, and stops at closing.
    - _Requirements: 25.2, 25.3, 25.4, 25.5, 25.6_
  - [x] 11.8 Write the property test for phase and cost accounting
    - **Property 16: Phase and cost accounting**
    - **Validates: Requirements 3.1, 13.2, 21.2, 21.3, 21.5**
  - [x] 11.9 Write the property test for surveillance fidelity
    - **Property 17: Surveillance fidelity**
    - **Validates: Requirements 23.1, 23.2, 23.3, 23.4, 25.5**
  - [x] 11.10 Write the property test for interception completeness
    - **Property 18: Interception completeness**
    - **Validates: Requirements 25.3**

- [x] 12. Checkpoint: engine inspection
  - Add a debug CLI, `pnpm world --seed <s> --preset <p> --reveal`, that dumps the full truth (core and noise) and the Starting Brief.
  - Add `pnpm sim --seed <s> --script <actions.json>`, which runs scripted actions with no model and prints the Fact Lines and Case File.
  - Ensure all tests pass, and ask the user if questions arise.

- [x] 13. Build the LLM Gateway
  - [x] 13.1 Write the OpenAI-compatible client, the `models.yaml` profile loader and the startup model check
    - Implement the `ModelsConfig` Zod schema, reporting each issue with file and field path.
    - Create the default `config/models.yaml` with the two profiles from the design, including the `narrator` role in both.
    - _Requirements: 14.1, 14.2, 14.3, 14.5, 14.6, 41.2, 41.3_
  - [x] 13.2 Implement `stream()` and `structured()`
    - `structured()` sends `response_format` with a JSON Schema and re-validates the response with Zod.
    - _Requirements: 14.4_
  - [x] 13.3 Write reasoning adapters for the Gemma and Qwen families
    - Verify each family's reasoning-control mechanism against its current model card.
    - _Requirements: 14.2, 15.4_
  - [x] 13.4 Add timeouts, retries, fallback and the priority queue
    - Retry once, then fall back to `fast` (the Narrator does not fall back).
    - Order the queue intent → voice → narrator → extraction, and cancel a narrator call if it has not produced a first sentence.
    - _Requirements: 16.1, 16.2_
  - [x] 13.5 Implement `RecordingGateway` (JSONL) and `ReplayGateway` keyed by request hash
    - _Requirements: 17.3_
  - [x] 13.6 Record play metrics
    - Append a record for every call to the metrics log at `scenario.metrics.path`: role, model, purpose, time to first released sentence (via `CallHandle.markReleased()`), duration, completion tokens, tokens per second and outcome.
    - Make writes asynchronous and best effort, and use the record format the eval harness reads.
    - _Requirements: 15.3, 15.6_

- [x] 14. Build the dialogue pipeline
  - [x] 14.1 Write the Knowledge Slicer
    - _Requirements: 4.1, 5.1_
  - [x] 14.2 Write the Prompt Builder
    - Order blocks static to dynamic, render the Told List with predicate templates, and trim deterministically to the token budget.
    - Include the in-character and known-entities-only instructions in the global frame.
    - _Requirements: 4.5, 6.2, 15.1, 15.2_
  - [x] 14.3 Write the property test for knowledge containment
    - **Property 5: Knowledge containment**
    - **Validates: Requirements 4.1, 5.1**
  - [x] 14.4 Write the property test for prefix stability and budget
    - **Property 7: Prefix stability and budget**
    - **Validates: Requirements 15.1, 15.2**
  - [x] 14.5 Build the Intent Classifier (`fast`, structured) and the pure `applyIntent`
    - _Requirements: 4.2, 4.3_
  - [x] 14.6 Route turns to `voice` or `fast` by scene stakes
    - _Requirements: 4.4_
  - [x] 14.7 Build the Leak Guard with a configurable allowed set
    - Gate the stream sentence by sentence, regenerate on a hit up to the retry limit, then use a deflection line.
    - _Requirements: 5.2, 5.3, 5.4, 5.5_
  - [x] 14.8 Write the property test for Leak Guard soundness
    - **Property 6: Leak Guard soundness**
    - **Validates: Requirements 5.2**
  - [x] 14.9 Add refusal and meta-response detection, with retry under a reinforced fiction frame
    - _Requirements: 16.3_
  - [x] 14.10 Build the asynchronous Claim Extractor
    - Derive its schema from the predicate definitions.
    - Evaluate truth, update the Told List, and log chance leaks and consistency violations.
    - _Requirements: 5.6, 6.1, 6.5, 7.1, 7.2, 7.3, 7.5_
  - [x] 14.11 Write the property test for model outputs not writing facts
    - **Property 4: Model outputs cannot write facts**
    - **Validates: Requirements 2.3, 2.4**

- [x] 15. Build the Narrator
  - [x] 15.1 Implement the pure Specifics Guard
    - Detect numerals and number words, weekdays and months, clock patterns, contradicting time-of-day words, and unlisted capitalized names.
    - Apply the verbatim-token allowance, and unit-test each token class.
    - _Requirements: 20.4_
  - [x] 15.2 Build the Narrator prompt builder and the scene-descriptor projection from the Player View
    - _Requirements: 15.1, 20.2_
  - [x] 15.3 Implement narration streaming
    - Show Fact Lines first, then stream Flavour through the Leak Guard (player known set) and the Specifics Guard.
    - Regenerate once, then fall back to fact-only.
    - Support the `full`, `brief` and `off` modes.
    - _Requirements: 15.5, 16.5, 20.3, 20.5, 20.6, 20.8_
  - [x] 15.4 Implement the Location Flavour cache keyed by Location, phase and crowd band
    - _Requirements: 20.7_
  - [x] 15.5 Write the property test for Narrator containment
    - **Property 15: Narrator containment**
    - **Validates: Requirements 20.2, 20.3, 20.4, 20.6**

- [x] 16. Build the Player View and player aids
  - [x] 16.1 Implement the engine API facade and projections
    - Implement the `EngineApi` interface from the design, including the `TurnChunk` stream type and `LoadError`.
    - Cover the scene, the "here" panel, the Documents list and reader, and the Case File.
    - _Requirements: 2.2, 13.5_
  - [x] 16.2 Implement the Journal fact log and notes
    - _Requirements: 33.1, 33.2_
  - [x] 16.3 Implement the Map and People views
    - _Requirements: 33.3, 33.4, 33.5_
  - [x] 16.4 Implement the help command (quotes plus glossary) and content-driven hints with view-side seen flags
    - _Requirements: 26.5, 26.6_
  - [x] 16.5 Write the property test for truth isolation
    - **Property 3: Truth isolation**
    - **Validates: Requirements 2.1, 2.2, 7.3**
  - [x] 16.6 Implement Notifications
    - Implement the `Notification` union and the pure `notify()` over player-visible events, with content templates and the player-perspective namer.
    - Write Fact Lines to the Journal under each event's own day and phase, and expose undismissed Notifications as status-bar alerts.
    - Raise the derived `meeting-no-show`, `drop-unserviced`, `asset-silent` and `retainer-due` events at phase boundaries from player-side expectations.
    - _Requirements: 39.2, 39.3, 39.5, 39.6, 39.7_
  - [x] 16.7 Write the property test for notification soundness
    - **Property 28: Notification soundness**
    - **Validates: Requirements 39.2, 39.4, 39.5, 39.7**
  - [x] 16.8 Wire the Turn Pipeline
    - Implement `act`, `say`, `endScene` and `retry` as Turn Transactions in the order given in the design: boundary extraction commits, classify, simulate on a draft, stream through the guards, commit (state, action log, Journal, Notifications), narrate post-commit, enqueue extraction.
    - Discard the draft on any pre-commit failure, emit `interrupted` and `paused` chunks, and re-run from the pre-turn state on `retry`.
    - Commit extraction results as separate transactions in turn order and log `extraction-commit` positions.
    - _Requirements: 7.1, 15.5, 16.1, 16.4, 16.5, 17.5, 42.1, 42.2, 42.3, 42.4, 42.5, 42.6_
  - [x] 16.9 Write the property test for turn atomicity
    - **Property 29: Turn atomicity**
    - **Validates: Requirements 16.4, 42.1, 42.4**

- [x] 17. Checkpoint: first live session
  - Build a minimal REPL on the Turn Pipeline (16.8) with recording on. It should start from the brief Cable, run the in-person briefing, travel, surveil with narration, and talk to one NPC through LM Studio end to end.
  - Inspect the Case File, Journal and truth records for the session.
  - Ensure all tests pass, and ask the user if questions arise.

- [x] 18. Build recruitment and relationships
  - [x] 18.1 Implement `resolvePitch`, Asset status and tasking
    - `resolvePitch` scales money pitches by the offered amount.
    - Tasks are collect, introduce (Contact Channel plus inherited trust), service dead drop and plant. Results are filtered by the `AssetProfile` access and reliability as the design's Asset reporting rules describe.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 22.6, 28.5_
  - [x] 18.2 Implement retainers, pay effects and trust decay for unpaid money-motivated Assets
    - _Requirements: 28.2, 28.4_
  - [x] 18.3 Implement the confront-with-Claim action, `pressureCheck` and cover-state transitions that change the Agenda
    - _Requirements: 6.3, 6.4_
  - [x] 18.4 Write the property test for recruitment and pressure determinism
    - **Property 11: Recruitment and pressure determinism**
    - **Validates: Requirements 6.4, 10.2**
  - [x] 18.5 Implement the turn-agent action
    - Add `turn-agent` to the `Action` union, with player-side `turnEligibility` (custody, observed crack, or evidence via 4.7) used by `quote`.
    - Implement the pure `resolveTurn`, its effects on allegiance, Asset status and Agenda, the identical refusal Fact Line, Station Custody duration and the release suspicion penalty.
    - _Requirements: 11.3, 36.1, 36.2, 36.3, 36.4, 36.5, 36.6, 36.7_
  - [x] 18.6 Implement the feed action and validation
    - Add `feed` to the `Action` union and implement `validateFeed` (Claim or composed items, known-set entities, alias-resolved `unk:` ids, the derived predicate schema, 1–3 items, 7-day windows).
    - Schedule the hidden `feed-delivered` event at the agent's next handler contact, and store the optional label as a Journal note only.
    - _Requirements: 37.1, 37.2, 37.6_
  - [x] 18.7 Write the property test for turning soundness
    - **Property 31: Turning soundness**
    - **Validates: Requirements 36.1, 36.2, 36.3, 36.4, 36.5, 36.6**
  - [x] 18.8 Write the property test for Asset report filtering
    - **Property 32: Asset report filtering**
    - **Validates: Requirements 10.4, 10.6**

- [x] 19. Build the Hostile Service
  - [x] 19.1 Implement doctrine from preset ranges, beliefs, Exposure tracking, and daily detection with responses (arrest, double, feed)
    - _Requirements: 12.1, 12.2, 12.3_
  - [x] 19.2 Implement Dangles and Walk-in handling, doubling the player's Assets, Chickenfeed, and belief-driven Plot adaptation
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 22.7_
  - [x] 19.3 Implement mole reporting, Cover Suspicion with tailing of the player, and the burn threshold
    - _Requirements: 12.4, 12.5, 21.4_
  - [x] 19.4 Implement Hostile Service newspaper plants and the daily comms traffic hooks for the Cipher Engine
    - _Requirements: 29.4, 30.2_
  - [x] 19.5 Implement the off-screen consequences of hidden events
    - When the Hostile Service arrests an Asset, make the Asset miss later meetings and drops so that 16.6 raises its derived Notifications.
    - Print public arrest articles with p = `1 − deceptionAppetite`, and keep doubling free of any direct signal.
    - _Requirements: 39.4, 39.5_
  - [x] 19.6 Implement feed ingestion and belief-driven adaptation
    - Implement the pure `ingestFeed` (classification, confirm, refute, adopt) and the adaptation rules table in `dailyTick` step 5.
    - Call the 7.4 hook to add Abort Pressure for beliefs about the target or Cell members, and add belief-compromised Channels as disruptions.
    - _Requirements: 11.4, 37.3, 37.4, 37.5, 38.3_
  - [x] 19.7 Write the property test for feed ingestion
    - **Property 30: Feed ingestion**
    - **Validates: Requirements 37.3, 37.4**

- [x] 20. Implement arrests, end conditions, the debrief and the Outcome Record
  - [x] 20.1 Implement the arrest gate, the penalties for a wrongful arrest, and win/lose detection
    - The gate uses `evidenceCount` from 4.7. A Station arrest starts Station Custody. Win detection includes a Plot abort from 7.4.
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 40.4_
  - [x] 20.2 Build the debrief
    - Reveal allegiances, the actual timeline, lies, which leads were Side Threads or Rumours, fed Propositions with their classification, and the abort or burn cause.
    - Show Directive results and score grading accuracy.
    - _Requirements: 8.3, 19.6_
  - [x] 20.3 Implement `buildOutcomeRecord`, its Zod schema, and writing it to `saves/outcomes/`
    - _Requirements: 35.1, 35.2, 35.3_
  - [x] 20.4 Write the property test for the arrest gate
    - **Property 12: Arrest gate**
    - **Validates: Requirements 19.1**
  - [x] 20.5 Write the property test for Outcome Record derivation
    - **Property 26: Outcome Record derivation**
    - **Validates: Requirements 35.2, 35.3**

- [x] 21. Implement save, load and replay
  - [x] 21.1 Implement the versioned `SaveSnapshot` with save and load
    - Include the Content Manifest, Difficulty Preset, ledger, Journal, Notifications, Flavour cache, action log and extraction queue.
    - Refuse to load a save whose Content Manifest differs.
    - _Requirements: 17.1, 17.2, 31.6, 34.3_
  - [x] 21.2 Write the property test for save/load round-trip
    - **Property 13: Save/load round-trip**
    - **Validates: Requirements 17.1, 17.2**
  - [x] 21.3 Write the property test for replay determinism
    - **Property 14: Replay determinism**
    - **Validates: Requirements 17.4**
  - [x] 21.4 Check golden replay sessions into `evals/replays/` and run them in CI through `ReplayGateway`
    - _Requirements: 17.4_

- [x] 22. Build the TUI client
  - [x] 22.1 Build the start screen and the brief Cable display
    - The start screen covers seed entry or display, Difficulty Preset, mole toggle and narration mode.
    - _Requirements: 1.6, 26.4, 34.3_
  - [x] 22.2 Build the Scene pane and the status bar
    - The Scene pane shows Fact Lines in plain style, then streams Flavour and dialogue sentence by sentence in a distinct style.
    - The status bar shows day, phase, Location, Budget, Standing, Directives and the highlighted action's cost.
    - _Requirements: 13.2, 13.4, 13.6_
  - [x] 22.3 Build the "here" pane and the action menu
    - The "here" pane shows visible persons, crowd and weather.
    - The action menu covers every action in Req 13.1 and shows its quote, and disallowed actions show their reason.
    - _Requirements: 13.1, 21.5, 21.7_
  - [x] 22.4 Build the Case File browser with filters for entity, source and grade, plus grading and linking
    - _Requirements: 8.1, 13.3_
  - [x] 22.5 Build the intercept Workbench
    - Show metadata, frequency counts and shift preview, and accept key or plaintext submissions.
    - _Requirements: 9.5, 9.6, 25.3_
  - [x] 22.6 Build the Document reader for newspapers, public texts, Dossiers, Cables and seized material
    - _Requirements: 30.4_
  - [x] 22.7 Build the Journal, Map and People views
    - _Requirements: 33.1, 33.2, 33.3, 33.4_
  - [x] 22.8 Build the help overlay and hint toasts
    - _Requirements: 26.5, 26.6_
  - [x] 22.9 Write `ink-testing-library` snapshot tests
    - Cover the fact and flavour styles, the status bar, and each view.
    - _Requirements: 13.2, 13.6_
  - [x] 22.10 Build the game-over screen
    - Show it on an `ended` chunk, with the outcome, end day and phase, the cause, and options to open the debrief, save or quit.
    - _Requirements: 13.7_
  - [x] 22.11 Build the debrief screen rendering `views.debrief()` from 20.2, section by section
    - _Requirements: 13.8, 19.6_
  - [x] 22.12 Build the save/load screen
    - List saves with name, seed, preset, day and phase. Mark mismatched manifests, and show the `manifest-mismatch` pack list without changing the current game.
    - _Requirements: 13.9, 31.6_
  - [x] 22.13 Build the endpoint-unreachable error screen
    - Show it on a `paused` chunk, naming the endpoint, with retry (`retry()`) and save-and-quit.
    - _Requirements: 13.10, 16.1_
  - [x] 22.14 Build the feed composer
    - Pick Claims or compose Propositions from known entities, and show `validateFeed` errors inline.
    - _Requirements: 13.1, 37.1, 37.2_
  - [x] 22.15 Write `ink-testing-library` snapshot tests for the game-over, debrief, save/load, endpoint error and feed composer screens
    - _Requirements: 13.7, 13.8, 13.9, 13.10_

- [x] 23. Build the model evaluation harness
  - [x] 23.1 Define the fixture format and write the five required fixtures
    - A fixture is a seed plus scripted player lines or actions.
    - The fixtures are mole interrogation, recruitment pitch, Dangle debrief, confrontation with contradicting evidence, and surveillance narration.
    - _Requirements: 18.1, 18.5_
  - [x] 23.2 Collect the mechanical metrics
    - Leak Guard trips, Specifics Guard trips, chance leaks, Told List contradictions, refusal rate, time to first sentence per role, and tokens per second.
    - _Requirements: 15.3, 18.2_
  - [x] 23.3 Add judge scoring with a fixed rubric (dialogue and narration), record the judge's identity, and warn when the judge is the same model as `voice`
    - _Requirements: 18.3_
  - [x] 23.4 Write the Markdown and CSV comparison reports, and run both profiles from `models.yaml`
    - _Requirements: 18.4_

- [~] 24. Final checkpoint: vertical slice playtest
  - Play one full campaign on each of three fixed seeds. Win once through human sources and once through Intercepts, confirm that reckless contact patterns can get the player burned, and recognise at least one Side Thread as noise in the debrief.
  - Run the eval harness on both profiles and set `active` from the results.
  - Ensure all tests pass, and ask the user if questions arise.

- [x] 25. Build the Model Manager
  - [x] 25.1 Implement the SDK connection and the download check
    - Connect through `@lmstudio/sdk`; start the LM Studio server with `lms server start` and retry when it is not running.
    - Compare the active profile's models against the SDK's downloaded set; a missing model prints the exact `lms get` command and fails the preflight — never download silently.
    - _Requirements: 43.1, 43.2_
  - [x] 25.2 Implement the memory-estimate preflight
    - Use the SDK's estimate-only path (accounting for the configured context length) to size the active profile's resident set; refuse to load and report the shortfall when it will not fit.
    - Compose the connection, download and estimate checks into `preflight(profile)` returning the `PreflightResult`, and fail game startup on a failed preflight with the cause (consistent with Req 41.2).
    - _Requirements: 43.3, 43.8_
  - [x] 25.3 Implement explicit profile load/unload with identifiers and context length
    - Load each profile model through `client.llm.load()` with a stable identifier (the `models.yaml` model string) and the configured context length; load a model that serves two roles only once; disable auto-evict / idle-unload while the game runs.
    - After loading, verify GPU residency via the SDK's loaded-model listing and warn by identifier on any partially-resident model.
    - Implement `unloadProfile`/`loadProfile` so the eval harness can switch profiles between runs.
    - _Requirements: 43.4, 43.5, 43.6, 43.7_
  - [x] 25.4 Add the `pnpm models:pull` script and wire the preflight into startup
    - Add a `models:pull` script that runs the `lms get` downloads for the active profile's missing models (the only path that downloads).
    - Run `preflight` before the first model call in the startup path; on failure refuse to start and report the cause.
    - _Requirements: 43.2, 43.8_
  - [x] 25.5 Write the Model Manager tests
    - Against a faked SDK client: preflight reports missing downloads without pulling, refuses an over-budget profile with the shortfall, loads a shared-role model once, warns on partial GPU residency, and switches profiles via unload/load. Assert inference is never routed through the SDK.
    - _Requirements: 43.1, 43.2, 43.3, 43.4, 43.5, 43.6, 43.7_

- [x] 26. Close the world-coherence gaps and deepen the core pack
  - [x] 26.1 Give Plot and Side Thread traces structure
    - Replace the string `traceTemplates` in the content schema with the design's `TraceTemplate` (kind, roles, place, channel, materiel, evidences, text), and validate every role, target, materiel and Location Type reference at load.
    - Rewrite every trace in `plots.yaml` and `side-threads.yaml` in the new form, keeping the current prose as `text`.
    - Carry the structured traces through Plot and Side Thread instantiation, resolving roles, places, Channels and materiel to bound world entities.
    - _Requirements: 3.3, 3.6, 31.2_
  - [x] 26.2 Execute traces as bound Sim events and scope disruption to each stage
    - Emit each executed trace as exactly the event its template declares, with the bound participants, place, Channel and materiel, replacing the index-modulo picks in `plot-execution.ts` and the Side Thread equivalent.
    - Check disruption against the stage's own participants, Channels and deliveries, and make `seize` disrupt only the stage that collects the seized delivery instead of every pending stage.
    - _Requirements: 3.3, 3.4, 3.6, 3.7, 24.7, 29.2_
  - [x] 26.3 Mint real Intercepts for Plot, Side Thread and Noise Traffic
    - Have transmission traces call the Cipher Engine with the stage's Propositions as plaintext, have Noise Traffic Channels mint noise Intercepts on their schedules, and append each Transmission and Intercept to the World State.
    - Make the intercept action collect from `WorldState.transmissions` instead of deriving empty placeholder Intercepts from Channel schedules, keeping the retention window, metadata and at-most-once delivery.
    - _Requirements: 9.1, 9.5, 25.3, 29.2, 29.4_
  - [x] 26.4 Apply the mole and seed the Truth Store at generation
    - In `generate()`, apply the `MoleAssignment`: rewrite the mole's true allegiance to the Hostile Service, keep its apparent allegiance as the Station, set `station.mole`, and add its facts.
    - Seed the Truth Store with every core and noise ground-truth Proposition when the World State is assembled, and test that `holds` answers the mole's `REPORTS_TO` and each Plot Stage's key Propositions.
    - _Requirements: 1.5, 2.1, 27.6_
  - [x] 26.5 Derive apparent allegiance from cover
    - Assign apparent allegiance from the NPC's public post and Cover Story as the design's world-generation step 3 describes, and keep it engine-side as part of the `Truth` allegiance pair.
    - Render a Dossier's allegiance line only from the Station slice's beliefs about its subject.
    - _Requirements: 1.3, 1.8, 2.2, 11.1, 30.5, 33.4_
  - [x] 26.6 Make surveillance observe Sim events
    - Replace the co-schedule MEETS_AT generation in `surveil.ts` with the design's rule: enumerate the Sim events at the Location in the window and pass each through the observation check `base × crowdFactor × weatherFactor × (1 − participant.tradecraft)`.
    - Report co-presence as sightings, never as meetings, and apply the same rule to follow and to the reduced-rate observations during a wait.
    - _Requirements: 23.1, 23.2, 23.3, 25.5_
  - [x] 26.7 Tighten the discovery-path verifier
    - Take each stage's key Propositions from its traces' `evidences` instead of the round-robin mapping, and require a disjoint human path and signal path for every one, including PLANS and TARGETS.
    - Treat a Channel as reachable only once the Starting Brief, a learned USES_CHANNEL or an observed transmission reveals it, and update the Property 19 tests.
    - _Requirements: 1.4, 26.3, 27.6, 29.6_
  - [x] 26.8 Make people coherent and distinguishable
    - Add a Descriptor library content kind with a Zod schema and `fits` tags, define every pool the archetypes reference, and make the loader reject unknown descriptor and persona pool references.
    - Split persona name pools by gender and give every persona a gender. Draw only fitting descriptor entries, redraw until every two Principals' descriptors differ in at least two elements, and redraw names until the uniqueness rules hold.
    - _Requirements: 1.3, 1.7, 21.7, 23.4, 31.1, 31.2_
  - [x] 26.9 Add a third Plot template and more Side Threads and Rumours
    - Author a third fictional Plot template with structured traces, plausible for 1952 Vienna (for example, the abduction of an émigré across the sector line).
    - Add two Side Thread templates (for example, a currency black-market ring and a forged-papers racket) and four Rumour templates.
    - Check that each new template loads and passes the discovery-path verifier across a seed sweep.
    - _Requirements: 29.2, 29.3, 31.7_
  - [x] 26.10 Deepen the city
    - Add at least three Location Types (for example, a Heuriger, a cinema and a market) with hours, crowd curves, weather modifiers and actions, give every Location Type at least six descriptions, and generate 5–7 Districts and 16–22 Locations.
    - Raise the presets' Background NPC counts to 10 (easy), 16 (standard) and 20 (hard), and extend the name pools so the uniqueness rules hold at those counts.
    - _Requirements: 21.1, 21.9, 29.1, 34.2_
  - [x] 26.11 Write the property test for world coherence
    - **Property 33: World coherence**
    - **Validates: Requirements 1.3, 1.5, 1.7, 1.8, 3.6, 30.5**
  - [x] 26.12 Make Background NPC names unique across the roster
    - The 26.11 world-coherence property surfaced a real gap: `generateBackgroundNpcs` (`noise/background.ts`) draws persona names with no uniqueness check, and the raised preset counts (26.10) let two Background NPCs share a full name (e.g. seed `w2`, easy: two "Johann Hofbauer"), violating Req 1.7/1.8's "no two NPCs share a full name".
    - Redraw a Background NPC's persona name until its full name is unique against the Principals and the Background NPCs already stamped, with a bounded redraw cap. Preserve the count-independent `npc:bg-i` id scheme and determinism (the superset invariant `generate.noise-independence.spec.ts` and `background.spec.ts` pin).
    - Pass the Principal full names into the noise step so Background names avoid them too. Then flip the `[known gap]` test in `world-coherence.property.spec.ts` to assert zero full-name collisions and tighten Property 33 clause (4) to cover every NPC.
    - _Requirements: 1.7, 1.8, 29.1_

## Notes

- Property-based test sub-tasks are kept required (not optional), as in the previous revision, because they carry the truth-containment and determinism guarantees.
- Property 4 previously had no task; it is now 14.11.
- The LLM Gateway (task 13) has no engine dependency, so the dependency graph schedules it early even though it is listed after the engine.
- New sub-tasks from the gap audit are appended within their groups (2.7, 4.6–4.7, 7.4–7.5, 13.6, 16.6–16.9, 18.5–18.8, 19.5–19.7, 22.10–22.15) and map to Requirements 36–42, the new criteria 10.6, 13.7–13.10, 15.6 and 17.5, and Properties 27–32.
- Group 26 comes from the world review after group 11. It fixes generation and simulation gaps that undercut the mystery (an unapplied mole, role-derived apparent allegiance, prose-only traces, empty Intercepts, schedule-based surveillance, over-broad disruption, a weak verifier, incoherent descriptors and repeated names) and adds a small content bump. It is scheduled ahead of 11.9, 11.10 and 16.1, which build on the fixed behaviour.
- **Follow-on spec order.** content-expansion → plot-library → ambient-world → campaign-career → multi-city. content-expansion tasks 1–2 (schemas, Content Kind Registry and loader) are the hard prerequisite for every other follow-on spec. PRNG offsets for follow-on specs are allocated in the design's PRNG stream registry.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1", "4.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "4.2", "4.6", "13.1"] },
    { "id": 2, "tasks": ["2.4", "4.3", "4.4", "13.2", "15.1"] },
    { "id": 3, "tasks": ["2.5", "2.6", "2.7", "3.1", "3.2", "3.3", "4.5", "4.7", "13.3"] },
    { "id": 4, "tasks": ["3.4", "3.5", "8.1", "10.1", "13.4"] },
    { "id": 5, "tasks": ["3.6", "5.1", "8.5", "10.3", "13.5"] },
    { "id": 6, "tasks": ["5.2", "8.2", "13.6"] },
    { "id": 7, "tasks": ["5.3", "8.7"] },
    { "id": 8, "tasks": ["5.4"] },
    { "id": 9, "tasks": ["5.5"] },
    { "id": 10, "tasks": ["5.6"] },
    { "id": 11, "tasks": ["5.7"] },
    { "id": 12, "tasks": ["5.8"] },
    { "id": 13, "tasks": ["5.9"] },
    { "id": 14, "tasks": ["5.10", "5.11", "5.12", "6.1", "7.1"] },
    { "id": 15, "tasks": ["6.2", "7.2", "8.3"] },
    { "id": 16, "tasks": ["6.3", "7.3", "7.4", "8.4"] },
    { "id": 17, "tasks": ["6.4", "7.5", "8.6", "9.1"] },
    { "id": 18, "tasks": ["6.5", "11.1"] },
    { "id": 19, "tasks": ["9.2", "10.2", "11.2"] },
    { "id": 20, "tasks": ["9.3", "11.3", "11.4"] },
    { "id": 21, "tasks": ["11.5", "11.6", "11.7"] },
    { "id": 22, "tasks": ["11.8", "14.1", "26.1", "26.4"] },
    { "id": 23, "tasks": ["14.2", "14.5", "14.7", "26.2", "26.8"] },
    { "id": 24, "tasks": ["14.3", "14.4", "14.6", "14.8", "26.3"] },
    { "id": 25, "tasks": ["14.9", "14.10", "26.5", "26.6"] },
    { "id": 26, "tasks": ["11.10", "14.11", "16.1", "26.7"] },
    { "id": 27, "tasks": ["11.9", "16.2", "16.4", "26.9"] },
    { "id": 28, "tasks": ["15.2", "16.3", "16.6", "26.10"] },
    { "id": 29, "tasks": ["15.3", "16.7", "26.11"] },
    { "id": 30, "tasks": ["15.4", "16.5", "26.12"] },
    { "id": 31, "tasks": ["15.5", "16.8", "18.1"] },
    { "id": 32, "tasks": ["16.9", "18.2", "18.3"] },
    { "id": 33, "tasks": ["18.4", "18.5", "18.8", "19.1"] },
    { "id": 34, "tasks": ["18.6", "18.7", "19.2"] },
    { "id": 35, "tasks": ["19.3", "19.5"] },
    { "id": 36, "tasks": ["19.4", "20.1"] },
    { "id": 37, "tasks": ["19.6", "20.4"] },
    { "id": 38, "tasks": ["19.7", "20.2"] },
    { "id": 39, "tasks": ["20.3"] },
    { "id": 40, "tasks": ["20.5", "21.1"] },
    { "id": 41, "tasks": ["21.2", "21.3", "22.1"] },
    { "id": 42, "tasks": ["21.4", "22.2"] },
    { "id": 43, "tasks": ["22.3", "22.4", "22.5", "22.6"] },
    { "id": 44, "tasks": ["22.7", "22.8", "22.10", "22.11", "22.12", "22.13", "22.14", "23.1"] },
    { "id": 45, "tasks": ["22.9", "22.15", "23.2"] },
    { "id": 46, "tasks": ["23.3"] },
    { "id": 47, "tasks": ["23.4"] },
    { "id": 48, "tasks": ["25.1"] },
    { "id": 49, "tasks": ["25.2", "25.3"] },
    { "id": 50, "tasks": ["25.4", "25.5"] }
  ]
}
```
