# Implementation Plan

## Overview

This plan assembles the completed vertical slice (`.kiro/specs/tradecraft/tasks.md`) into a playable game. It adds no mechanics. Paths are relative to `packages/` unless they start with `config/`, `.` or the repo root.

The order keeps the build green at every step:

1. Engine: state fields and Observation sources, `resolve` returning `ended`, the `detectEnd` leader check, the `decrypt`, `cable` and `task` actions, feed validation, the dialogue turn, the live Disruption Context, the Hostile Full Tick projection and application, the Phase Step, the Day-Boundary Hooks, and `advanceWorld` with `advance` re-implemented on the same core.
2. Player View: the Session, the claim recorder, the Resolver Context projection, the Objective Evaluator, the action catalogue, the Turn Pipeline rewiring, `newGame`, saves v2 and `validateFeed`.
3. Dialogue: the Live Seams moved out of evals and completed with `buildPrompt`, routing and the real Claim Extractor.
4. `app` and the TUI: the new package, dependency rules, the Composition Root, the fs Save Store and Outcome Sink, the Launcher and `pnpm play`, and the App Shell.
5. Models: `config/models.yaml`, the Model Manager, the reasoning adapters and `models:pull`.
6. Evals and end-to-end checks: `pnpm evals`, the REPL and evals on the Composition Root, the Scripted Full Games, the full-game Golden Replay and the one-time re-recording of the existing Golden Replays.

Property numbers refer to this spec's design (Properties 34–58). Slice Properties 1–33 must keep passing throughout.

## Tasks

- [x] 1. Extend the engine state and thread end results
  - [x] 1.1 Add the new World State fields with generation defaults
    - In `engine/src/lib/model/state.ts`, add `whereabouts`, `told`, `player.scene: TalkScene` (replacing the `SceneState` skeleton), `player.arrests`, `station.reportable`, `hostile.feedLog`, `PlotState.materielSeized`, `Intercept.broken`, `Relationship.lastReport` and `silenceNotified`, and the `'void'` meeting status.
    - Initialise each field in `engine/src/lib/generate.ts` (`whereabouts` from schedules at generation time, everything else empty or false). Leave generated content unchanged apart from these defaults.
    - The new fields change the slice Golden Replay artifacts. Add a `PENDING_RERECORD` list to `evals/src/lib/replays/fixtures.ts` naming the three slice fixtures, and make `golden-replay.spec.ts` skip them with a visible reason. Task 19.1 re-records them once and empties the list.
    - _Requirements: 4.4, 6.3, 8.6, 15.2, 24.1_
  - [x] 1.2 Add `ObservationSource` to Proposition Observations
    - Add the `ObservationSource` union (`surveillance`, `document`, `intercept`, `npc`) to `engine/src/lib/action/types.ts`, matching player-view's `ClaimSource` one to one.
    - Set it in `read`, `surveil`, `follow`, `wait` and `service-drop` (copy mode).
    - _Requirements: 8.4, 10.3_
  - [x] 1.3 Widen `resolve` to return `ended`, and record arrests and seizures
    - Change `resolve` in `engine/src/lib/action/action.ts` to return `{ next, result, ended? }`, passing through the `ended` that `resolveArrest` and `resolveServiceDrop` already compute.
    - In `arrest.ts`, append the entity to `player.arrests` on a granted arrest, and set `plot.materielSeized` when the arrested NPC is carrying the stage's materiel. In `service-drop.ts`, set `plot.materielSeized` in `seize` mode on the stage's delivery.
    - _Requirements: 4.4, 6.3, 7.1, 7.4_
  - [x] 1.4 Add the leader check to `detectEnd`
    - In `engine/src/lib/endings/end-conditions.ts`, treat a Plot leader in Station Custody, or arrested by the Station, as a `leader-arrested` success. Check in priority order: aborted, leader arrested, completed, burned.
    - _Requirements: 7.2, 7.3, 7.4, 7.8_
  - [x] 1.5 Add `TruthDraft`
    - In `engine/src/lib/truth/`, add `TruthDraft.over(store)`. It stages fact, claim-truth and identity writes behind the Truth Store's read interface, and applies them in `commit()`. Discarding the draft drops the staged writes.
    - _Requirements: 5.3, 5.4_
  - [x] 1.6 Write unit tests for end detection and `resolve`
    - Test `detectEnd`'s leader case (custody and Station arrest) and its priority order.
    - Test that `resolve` passes `ended` through for arrest and service-drop, that `player.arrests` is appended, that `materielSeized` is set on both seizure paths, and that `TruthDraft` commit and discard behave as specified.
    - _Requirements: 4.4, 5.4, 7.4, 7.8_

- [x] 2. Implement the remaining actions and feed validation
  - [x] 2.1 Implement `decrypt` in `engine/src/lib/action/decrypt.ts`
    - Quote: allowed with 1 phase and no money when `intercepts[id]` exists and the Location allows Workbench work. Otherwise disallowed with "you have not collected that intercept".
    - Resolve: on a broken Intercept, return the "already broken" Fact Line and no Observations. Otherwise call `verifySubmission`. On `ok`, set `broken` and return one Observation per recovered Proposition with an `intercept` source. On a reject, return the fixed "The key does not produce readable text." Fact Line.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [x] 2.2 Implement `cable` in `engine/src/lib/action/cable.ts`
    - Quote: 1 phase, no money, at the Station. A trace Cable is disallowed unless `target` is in `player.known.entities`.
    - Resolve: `submitCable(body, time, { delayPhases: preset.traceRequestDelayPhases })`, appended to `station.pendingCables`.
    - _Requirements: 9.1, 9.2, 9.3_
  - [x] 2.3 Implement `task` in `engine/src/lib/action/task.ts`
    - Quote: allowed with 1 phase and no money when `relationships[asset]` is a recruited Asset with `channel`. Otherwise disallowed with "that person is not your Asset" or "you have no way to reach them", decided only from Relationship flags.
    - Resolve through `runAssetTask`, with candidates taken from Truth Store facts since `rel.lastReport` and filtered by access. `collect` returns Observations with an `npc` source and sets `lastReport`. `introduce` creates the target's Contact Channel at `inheritedTrust`. `service` applies the collected and left items. `plant` schedules a hidden `belief-plant`.
    - Add the `TASKING_EXPOSURE` engine constant to `engine/src/lib/recruit/tasking.ts`: half the Exposure that a meeting at a risk-0.5 Location adds under the default weights. Every task adds it to the Asset's Exposure.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_
  - [x] 2.4 Make `quoteKind` and `resolve` exhaustive
    - Wire `decrypt`, `cable` and `task` into `engine/src/lib/action/action.ts`, with a `never` check in each `default`.
    - Delete `notImplementedQuote` and `OWNED_BY`.
    - _Requirements: 11.1, 11.2, 11.3_
  - [x] 2.5 Implement shared feed validation in `engine/src/lib/action/feed-validation.ts`
    - `validateFeedItems(items, view, content)` returns `Result<Proposition[], FeedError[]>`. It checks 1–3 items, known-set entities, `unk:` ids resolved through held `IS_ALIAS_OF` Claims, the derived per-predicate schema, and windows within the next 7 days. `FeedView` holds only the known set and held Claims. A count error is reported as `index: -1, field: 'items'`.
    - Change `quoteFeed` in `feed.ts` to return disallowed with the first error's reason exactly when validation fails.
    - _Requirements: 14.1, 14.2, 14.3, 14.4_
  - [x] 2.6 Write unit tests for the new actions
    - Cover the allowed and disallowed quotes for `decrypt`, `cable` and `task`, the effect of each task kind, and the `TASKING_EXPOSURE` increase.
    - Check that no action kind's quote reason contains "not yet implemented", and that every feed error code is produced.
    - _Requirements: 8.1, 8.2, 9.1, 9.2, 10.1, 10.2, 10.7, 11.2, 14.2_

- [x] 3. Move the dialogue turn into the engine
  - [x] 3.1 Move the Intent vocabulary and `applyIntent` to `engine/src/lib/recruit/intent.ts`
    - Move `INTENTS`, `Intent`, `INTENT_DELTAS`, `applyIntent` and `SceneKind`. `applyIntent` now takes and returns a full `Relationship`.
    - Re-export all of them unchanged from `dialogue/src/index.ts`, and import `SceneKind` from the engine in `dialogue/src/lib/routing/`.
    - _Requirements: 15.5_
  - [x] 3.2 Implement `applyDialogueTurn` in `engine/src/lib/recruit/dialogue-turn.ts`
    - Apply `applyIntent`. For a `pitch-*` Intent, call `resolvePitch` on the runtime PRNG.
    - A `pitch-money` offer debits the ledger by the offered amount (reason `pay`) whether or not the pitch lands.
    - On acceptance, set `recruited` and mint the Asset profile with `assetProfileFor`. On a refusal, add `suspicionDelta`. When the NPC reports the approach, add them to `hostile.beliefs.suspectedApproaches` and raise Cover Suspicion by the slice increment.
    - Append the player's line to `scene.recent`.
    - _Requirements: 15.5, 15.6, 15.7, 15.8_
  - [x] 3.3 Write unit tests for the dialogue turn
    - Cover each Intent's deltas, the money debit on both pitch outcomes, Asset minting on acceptance, the report path, and the `recent` append.
    - _Requirements: 15.5, 15.6, 15.7, 15.8_

- [x] 4. Build the world simulation pieces
  - [x] 4.1 Implement `liveDisruption` in `engine/src/lib/clock/disruption.ts`
    - `isArrested` is true for an NPC who is arrested, fled or in Station Custody (`inStationCustody`). `isChannelCompromised` reads `hostile.beliefs.compromisedChannels`. `isMaterielSeized` reads `plot.materielSeized`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 4.2 Implement the Hostile Full Tick projection and application in `engine/src/lib/hostile/project.ts`
    - `projectFullTick(draft, day, scratch, deps)` builds every `FullTickInputs` field from the design's input table. Due `feed-delivered` events are removed from `scheduled`. The mole report is built from `station.reportable`.
    - `applyFullTick(draft, result, scratch)` writes every `FullTickResult` field from the design's output table: Hostile Service state, arrests and custody, doublings, Plot adaptation and Abort Pressure, voided meetings and drops, newspaper plants and arrest articles to `scratch`, tailing and Cover Suspicion, `player.burned`, comms traffic through `makeIntercept`, and `feedLog`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_
  - [x] 4.3 Write unit tests for the Full Tick projection and application
    - Write one example per row of the design's input and output tables, including a burn and a mole report.
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_
  - [x] 4.4 Implement `phaseStep` in `engine/src/lib/clock/phase-step.ts`
    - Run the seven sub-steps in this order:
      1. Advance schedules and write `whereabouts`, pinning arrested, fled and custodial NPCs.
      2. Resolve meetings with `resolveMeetingAtSlot`, returning the first `openScene` and raising `meeting-no-show` for a voided meeting.
      3. Process due Cables with `processDueCables`, writing Cable Documents (a Dossier for a trace).
      4. Check Directives with `checkDirectives` and `deps.objectives(draft)`, delivering each result as a Cable Document.
      5. Apply retainer decay and raise `retainer-due` once.
      6. Raise `asset-silent` once per silence and `drop-unserviced`.
      7. Release Station Custody (`custody-released`).
    - Append events in sub-step order.
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 6.4_
  - [x] 4.5 Write unit tests for the Phase Step
    - Write one example per effect: meeting kept, missed and no-show; each Cable kind; Directive met and failed; retainer decay; each consequence event; custody release.
    - _Requirements: 1.2, 1.3, 1.5, 1.6, 1.7, 1.8_
  - [x] 4.6 Implement `buildWorldHooks` in `engine/src/lib/clock/world-hooks.ts`
    - `plot`: build `liveDisruption` from the Draft. Run Plot execution on the runtime stream, and mint Transmissions and Intercepts for `transmission` traces.
    - `schedules`: boundary moves and `whereabouts`. A Walk-in gets its events and Contact Channel on the daily stream. Store the day's events in `scratch.dayEvents`.
    - `hostileTick`: `applyFullTick(dailyTickFull(projectFullTick(…), ctx.rng))`.
    - `newspaper`: compose the edition from `dailyMaterial(day)` plus the scratch plants and arrest articles, and write the Document, its Propositions, `newspapers[day]` and its obtainable Locations. Emit the `newspaper` event.
    - Run `abortCheck` after the Plot and Hostile hooks, and `applyAbort` on a trigger.
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 3.1, 3.8, 4.1, 4.5, 5.1_
  - [x] 4.7 Write unit tests for the hooks
    - Write one example per hook effect, including a Walk-in Contact Channel, a minted Intercept, a published newspaper with a plant, and an abort triggered by a seizure.
    - _Requirements: 2.3, 2.4, 2.5, 4.5_

- [x] 5. Implement `advanceWorld`
  - [x] 5.1 Implement the stepping core in `engine/src/lib/clock/advance-world.ts`
    - For each phase: at a Day Boundary, set the weather from the daily stream with `weatherForDay`, emit `day-start`, create a fresh `DayScratch`, and run `deps.hooks` in `DAY_BOUNDARY_HOOK_ORDER`, each reading the previous hook's state. Then run `phaseStep`, then `detectEnd`. Stop on an End Condition or an `openScene`, and report `phasesSpent`.
    - Re-id events as `evt:<day>:<phase>:<seq>`.
    - Re-implement `advance()` in `clock.ts` on the same core with `S = void`, keeping its signature. Mark the four events-only adapters `@deprecated`.
    - _Requirements: 1.1, 1.4, 1.9, 1.10, 2.1, 2.6, 2.7, 2.8, 7.1, 7.5_
  - [x] 5.2 Add the purity lint rule
    - Scope `no-restricted-globals` and `no-restricted-imports` (`Date`, `process`, `node:fs`) to `engine/src/lib/clock/` and `engine/src/lib/hostile/` in `engine/eslint.config.mjs`.
    - _Requirements: 5.6_
  - [x] 5.3 Write the property test for clock coverage
    - Add an engine-level walk arbitrary (a test helper imported only by spec files). It plays random `resolve` + `advanceWorld` turns over a pool of generated worlds. Also add instrumented `AdvanceWorldDeps` that record hook and Phase Step calls.
    - **Property 34: Clock coverage**
    - **Validates: Requirements 1.1, 1.9, 1.10, 2.1, 2.5, 2.6, 2.7, 2.8**
  - [x] 5.4 Write the property test for early stop
    - **Property 35: Early stop**
    - **Validates: Requirements 1.4, 7.5**
  - [x] 5.5 Write the property test for hook outputs persisting
    - **Property 36: Hook outputs persist**
    - **Validates: Requirements 1.2, 2.3, 3.5, 3.9**
  - [x] 5.6 Write the property test for daily stream independence
    - **Property 37: Daily stream independence**
    - **Validates: Requirements 5.1**
  - [x] 5.7 Write the property test for end detection soundness
    - **Property 41: End detection soundness**
    - **Validates: Requirements 3.4, 4.5, 7.2, 7.3, 7.4, 7.8**
  - [x] 5.8 Write the property test for every action kind being resolvable
    - **Property 44: Every action kind resolvable**
    - **Validates: Requirements 11.1, 11.3, 11.4**
  - [x] 5.9 Write the property test for the Cable round trip
    - **Property 46: Cable round trip**
    - **Validates: Requirements 1.5, 9.3, 9.4**
  - [x] 5.10 Write the property test for the Disruption Context
    - **Property 50: Disruption context agrees with state**
    - **Validates: Requirements 4.2, 4.3, 4.4**

- [x] 6. Checkpoint: engine assembled
  - Ensure all tests pass, including slice Properties 1–33, and ask the user if questions arise.

- [x] 7. Build the Player View Session and projections
  - [x] 7.1 Implement the Session in `player-view/src/lib/api/session.ts`
    - `PlayerViewEngine` (`engine-api.ts`) holds one `Session` reference, and every view and Case File operation reads through it.
    - Change `turn-pipeline.ts` to read the action log, extraction queue and other stores from the Session instead of holding private copies.
    - _Requirements: 12.3, 13.4, 13.5_
  - [x] 7.2 Implement the claim recorder in `player-view/src/lib/api/claim-recorder.ts`
    - Map `ObservationSource` to `ClaimSource`. Call `addDocumentClaims`, `addSurveillanceClaims`, `addInterceptClaims`, and a new `addNpcClaims` in `player-view/src/lib/casefile/`.
    - _Requirements: 8.4, 10.3_
  - [x] 7.3 Implement the Resolver Context projection in `player-view/src/lib/api/resolver-projection.ts`
    - Build `claims` from the Case File, `arrestEvidence` and `turnEvidence` from `evidenceCount`, plus `cipherKeys`, and `truth` as the turn's `TruthDraft`.
    - _Requirements: 5.3, 6.2_
  - [x] 7.4 Implement the Objective Evaluator in `player-view/src/lib/api/objective-evaluator.ts`
    - Switch exhaustively over `DIRECTIVE_OBJECTIVE_KINDS`:
      - `identify`: the entity is in the known set by name, or an `unk:` id resolves to it through a held `IS_ALIAS_OF` Claim.
      - `recruit`: the count of recruited Relationships.
      - `arrest`: the entity is in `player.arrests`.
      - `intercept`: a collected Intercept is on the Channel.
    - Read no Truth Store.
    - _Requirements: 6.1, 6.2, 6.3, 6.5_
  - [x] 7.5 Write the property test for the Objective Evaluator
    - **Property 49: Objective Evaluator truth independence**
    - **Validates: Requirements 6.2, 6.3, 6.5**
  - [x] 7.6 Implement the action catalogue in `player-view/src/lib/api/action-catalogue.ts`
    - Enumerate the candidate actions from the design list, each paired with its `quote`. List free-input actions (decrypt submissions, feed items, confront Claims, offers) as templates.
    - Back `actions()` in `engine-api.ts` with it.
    - _Requirements: 11.1, 19.3_

- [x] 8. Rewire the Turn Pipeline
  - [x] 8.1 Rewire the action turn in `player-view/src/lib/api/turn-pipeline.ts`
    - Add `TurnPipelineConfig` with `outcomes: OutcomeSink` and `advance: AdvanceWorldDeps`, and define `OutcomeSink` and `EvalLog` in `player-view/src/lib/api/types.ts`.
    - Run the design's ten steps:
      1. Commit at the boundary.
      2. Apply the ended gate.
      3. Create `rng` and the `TruthDraft`.
      4. Run `projectResolverContext`.
      5. Call `resolve` and stage the resulting Claims.
      6. Call `advanceWorld`, with objectives over the Case File plus the staged Claims, and merge its `ended` with `resolve`'s.
      7. Set `player.scene` from `openScene`.
      8. Commit: the state, the `TruthDraft`, the Claims, the `action` log entry with `phasesSpent`, the Journal, the Notifications, and `station.reportable`.
      9. Write the Outcome Record once and set `outcomeWritten`.
      10. Stream the chunks.
    - If a hook or the Phase Step throws, discard the Draft, stream "The turn could not be completed", and log the error. If the Outcome Record write fails, keep `outcomeWritten` false and add a status-bar notice.
    - _Requirements: 1.4, 2.1, 3.6, 5.3, 5.4, 6.4, 7.1, 7.5, 7.6, 7.7, 15.1_
  - [x] 8.2 Rewire the dialogue turn
    - If no scene is open, `say` streams "You are not talking to anyone." and `done`, with no model call and no commit. Add `say(line, { offer })` to `EngineApi`, and reject an offer the Budget cannot cover before classification.
    - Classify, run `applyDialogueTurn` on the Draft, then call `voice` with `VoiceRequest` (`intent`, `sceneKind`, `speakerName` from the namer). Append the reply to `scene.recent`, capped at `RECENT_TURNS = 6`. Log the `line` entry and one `model` entry per call. Tag `speech` chunks with `speakerName`. Enqueue extraction with `speaker: scene.npc` and the speaker's knowledge.
    - `endScene` clears `player.scene` at commit.
    - _Requirements: 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.10, 15.11_
  - [x] 8.3 Implement the two-phase extraction boundary
    - Widen `ExtractionRunner` to `start`/`ready`. At each boundary, drain ready jobs in `turnId` order. In one commit per job, apply `evaluateExtraction` over the `TruthDraft`, `told[speaker]`, the Draft's `unk:` allocator and deterministic claim ids. Write the truth records, `told`, the `unk:` ids and the `npc` Claims, and append an `extraction-commit` entry.
    - Add an unparsed note to the Case File for an `unparsed` result. Send chance leaks and consistency violations to `EvalLog`. Keep an `unreachable` job queued and add one status-bar notice.
    - _Requirements: 17.2, 17.3, 17.4, 17.5, 17.6_
  - [x] 8.4 Fire hints from Player View facts
    - In `player-view/src/lib/aids/hints.ts`, implement the view-side trigger definitions from the design, including the redefined `cover-suspicion-high` (the "you may have been made" Fact Line) and `plot-deadline-near` (a brief lead's stated deadline within one day).
    - Add the `{ kind: 'hint'; text }` TurnChunk and stream each hint once, the first time its trigger occurs.
    - _Requirements: 19.10_
  - [x] 8.5 Write the property test for the Outcome Record being written once
    - Add an action-only walk arbitrary over `PlayerViewEngine` with no model seams, as a spec-only helper.
    - **Property 42: Outcome Record written once**
    - **Validates: Requirements 7.6**
  - [x] 8.6 Write the property test for turn gates
    - **Property 43: Turn gates**
    - **Validates: Requirements 7.7, 15.4**
  - [x] 8.7 Write the property test for decrypt soundness
    - **Property 45: Decrypt soundness**
    - **Validates: Requirements 8.3, 8.4, 8.5, 8.6**
  - [x] 8.8 Write unit tests for the pipeline paths
    - Cover each hint trigger, the hook-throw path, the Outcome-write failure path, extraction `unreachable` and `unparsed`, the over-Budget offer, and `endScene`.
    - _Requirements: 7.6, 15.3, 15.7, 17.3, 17.6, 19.10_

- [x] 9. Implement `newGame`, saves and `validateFeed` in the facade
  - [x] 9.1 Implement `newGame` with a `GameFactory`
    - Add the `GameFactory` interface to `player-view/src/lib/api/types.ts`.
    - `newGame({ seed?, preset, mole, narration })` takes a random seed only when none is given, then resolves the preset, overrides `mole` and `narration`, and calls `generateGame`. It builds the BriefView and implication rules from the predicate registry, builds a fresh Session, seeds the Case File with the Starting Brief's lead Claims, swaps the Session in, and returns `GameView`.
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  - [x] 9.2 Write the property test for new game determinism
    - **Property 51: New game determinism**
    - **Validates: Requirements 12.4, 12.5**
  - [x] 9.3 Implement `SaveSnapshot` version 2 in `player-view/src/lib/save/save.ts`
    - Set `SAVE_VERSION = 2`. Add `caseFile` (new `CaseFile.snapshot()`/`fromSnapshot`), `truth` (Maps stored as sorted entry arrays), `viewState`, `pipeline` and `world.told`, with `savedAt` in the header only. Refuse version-1 saves with `version`.
    - Update the slice save and replay-determinism specs in `save/` for version 2.
    - _Requirements: 13.3, 13.5, 13.8_
  - [x] 9.4 Implement the saves facade
    - Add the `SaveStore` interface and `SAVE_NAME`, plus an in-memory `SaveStore` for tests.
    - `saves.save` rejects invalid names before writing, then writes `saveSnapshot` as canonical JSON. `saves.list` reads headers and sets `manifestMatches` with `diffManifests`. `saves.load` maps errors to `corrupt`, `version` or `manifest-mismatch`, and on success rebuilds and swaps the Session.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_
  - [x] 9.5 Write the property test for the save/load round trip
    - **Property 52: Save/load round trip through the facade**
    - **Validates: Requirements 13.3, 13.8, 13.9**
  - [x] 9.6 Write the property test for load refusal
    - **Property 53: Load refusal leaves the game unchanged**
    - **Validates: Requirements 13.4, 13.5**
  - [x] 9.7 Write the property test for save name safety
    - **Property 54: Save name safety**
    - **Validates: Requirements 13.6**
  - [x] 9.8 Implement `validateFeed` in the facade
    - Change `FeedError` in `api/types.ts` to `{ index, field, reason }`.
    - `validateFeed(items)` calls `validateFeedItems(items, feedView(session), content)`.
    - _Requirements: 14.1, 14.2, 14.3_
  - [x] 9.9 Write the property test for truth-independent player-side quotes
    - **Property 47: Player-side quotes are truth-independent**
    - **Validates: Requirements 10.2, 14.3**
  - [x] 9.10 Write the property test for feed validation agreement
    - **Property 48: Feed validation agreement**
    - **Validates: Requirements 14.1, 14.2, 14.4**

- [x] 10. Checkpoint: Player View and Turn Pipeline assembled
  - Ensure all tests pass, including slice Properties 1–33, and ask the user if questions arise.

- [x] 11. Complete the Live Seams in dialogue
  - [x] 11.1 Move `buildLiveSeams` to `dialogue/src/lib/live/live-seams.ts`
    - Move it from `evals/src/lib/repl/seams.ts`, re-declaring the player-view seam types structurally so that dialogue has no player-view import. Keep a re-export in evals during the move.
    - _Requirements: 18.3_
  - [x] 11.2 Build the voice seam on `buildPrompt`
    - Export `buildPrompt` and its input types from `dialogue/src/index.ts`.
    - Choose the role with `routeTurnRole({ sceneKind, intent })`. Build the prompt from the persona, Cover Story, Agenda, Knowledge Slice, `told[npc]`, the rapport band and `scene.recent`. Put the player's line only in a `user` message.
    - Run the reply through the Refusal Guard and then `guardStream`, with `allowed = knownEntities`, `scenario.retries.leakGuard` and the persona deflection line. `buildPrompt` enforces `scenario.tokenBudget`.
    - _Requirements: 15.9, 16.1, 16.2, 16.3, 16.4, 16.5_
  - [x] 11.3 Replace the simplified extraction runner with the Claim Extractor
    - `start` runs `extractClaims` on `bookkeeping` and stores the outcome. `ready` reports `parsed`, `unparsed`, `pending` or `unreachable`. Delete the simplified runner.
    - _Requirements: 17.1, 17.3, 17.6_
  - [x] 11.4 Write the property test for live prompt containment
    - **Property 56: Live prompt containment**
    - **Validates: Requirements 16.3, 16.5, 16.6**
  - [x] 11.5 Write unit tests for the Live Seams with a fake Gateway
    - Cover routing (`voice` for pitch, confront and the high-stakes kinds, `fast` otherwise), the Leak Guard retry and deflection, extraction `start`/`ready`, and the unparsed fallback.
    - _Requirements: 15.9, 16.4, 17.1, 17.3_

- [x] 12. Create the `app` package and the Composition Root
  - [x] 12.1 Scaffold `packages/app` (`@tradecraft/app`)
    - Add `package.json` declaring `content`, `engine`, `llm`, `dialogue`, `player-view`, `tui`, `ink`, `react` and `zod`, plus the nx project, `tsconfig` and `eslint.config.mjs` (including the vitest-import rule). Register the package in the root TypeScript references.
    - _Requirements: 18.2, 24.4_
  - [x] 12.2 Add the dependency-cruiser rules
    - Add `engine-no-player-view`, `app-is-a-leaf` (only `evals` may import `app`) and `player-view-no-models` to `.dependency-cruiser.cjs`, keeping every existing rule.
    - _Requirements: 18.2, 18.6_
  - [x] 12.3 Implement the fs Save Store and Outcome Sink
    - `app/src/lib/fs-save-store.ts` stores saves as `saves/<name>.save.json`. It writes to a temp file, `fsync`s and renames; checks that the resolved path is inside the directory; ignores stale temp files in `list`; and removes them on the next successful write.
    - `app/src/lib/fs-outcome-sink.ts` writes to `saves/outcomes/`. Add `saves/` to `.gitignore`.
    - _Requirements: 7.6, 13.1, 13.6, 13.7_
  - [x] 12.4 Write unit tests for the fs stores
    - Cover atomic writes with a failure injected between the temp write and the rename, path containment, corrupt-header listing and stale temp cleanup.
    - _Requirements: 13.2, 13.6, 13.7_
  - [x] 12.5 Implement `createGame` in `app/src/lib/composition-root.ts`
    - Load the Content Set from `scenario.packs`. Build the Gateway (`live`, `record`, `replay` or one passed in), the Live Seams unless `seams` overrides them, `AdvanceWorldDeps` (`buildWorldHooks()`, `objectiveEvaluator`, cipher keys from public texts), the `GameFactory`, the Turn Pipeline and `PlayerViewEngine`, with the default fs stores and sinks.
    - _Requirements: 18.1, 18.3, 18.4_
  - [x] 12.6 Implement the Fake Seams and the shared reachable-state walk
    - `app/src/lib/fake-seams.ts` provides a seeded classifier over `INTENTS`, a voice seam that returns fuzzed sentences built from allowed aliases, fact-only narration, and an extraction runner that returns fuzzed results from `buildExtractionSchema`.
    - Add the reachable-state walk through `createGame` (0–30 turns, including `say` and `endScene`) as a spec-only helper.
    - _Requirements: 18.3, 23.5_
  - [x] 12.7 Write the property test for turn determinism
    - **Property 38: Turn determinism**
    - **Validates: Requirements 5.2, 15.6**
  - [x] 12.8 Write the property test for turn atomicity with hooks
    - **Property 39: Turn atomicity with hooks**
    - **Validates: Requirements 5.3, 5.4**
  - [x] 12.9 Write the property test for replay determinism through the pipeline
    - **Property 40: Replay determinism through the pipeline**
    - **Validates: Requirements 5.5, 17.2**
  - [x] 12.10 Write the property test for dialogue effects preceding the reply
    - **Property 55: Dialogue effects precede the reply**
    - **Validates: Requirements 15.5, 15.7, 15.10**
  - [x] 12.11 Write the property test for extraction commit atomicity
    - **Property 57: Extraction commit atomicity**
    - **Validates: Requirements 17.2**

- [x] 13. Build the TUI App Shell
  - [x] 13.1 Implement the shell reducer and key map in `tui/src/lib/shell/`
    - Add `Screen`, `ShellState`, `ShellEvent` and a pure `reduceShell`, plus the exported key map constant from the design.
    - Handle `fact`, `flavour` and `speech` through `reduceTranscript`, `interrupted`, `paused` (to `endpoint-error`), `ended` (to `game-over`), `notification` (status-bar alerts) and `hint` (a toast). While `streaming` is true, ignore every key that would start a turn.
    - _Requirements: 19.3, 19.4, 19.5, 19.6, 19.7, 19.9, 19.10, 19.11_
  - [x] 13.2 Implement the `AppShell` component
    - `AppShell({ api, defaults })` takes only an `EngineApi`. The flow is start, then `newGame`, then the brief with the Cable and the "Meet the Chief of Station in person? (y/n)" offer (yes acts `talk`, no goes to the scene).
    - Route to the existing screens. Consume turn streams with `for await`. In a Talk Scene, send typed lines to `say` and `Esc` to `endScene`. The endpoint-error screen offers retry and save-and-quit, and the game-over screen offers the debrief.
    - _Requirements: 19.1, 19.2, 19.3, 19.6, 19.7, 19.8_
  - [x] 13.3 Show Feed Error index and field in the feed composer
    - Update `tui/src/lib/feed/` to render each `FeedError` with its item index and field.
    - _Requirements: 14.2_
  - [x] 13.4 Write the property test for the shell input lock
    - **Property 58: Shell input lock**
    - **Validates: Requirements 19.11**
  - [x] 13.5 Write unit and snapshot tests for the shell
    - Write one `reduceShell` example per chunk kind and per key, and `ink-testing-library` snapshots of the shell frame, the brief and briefing offer, and the screen transitions.
    - _Requirements: 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9_

- [x] 14. Build the Launcher and `pnpm play`
  - [x] 14.1 Implement `runLauncher` in `app/src/lib/launcher.ts`
    - Parse `--seed` and `--profile`. Validate `config/scenario.yaml` and `config/models.yaml`, and print each issue as `<file>: <path>: <message>`, returning 1.
    - Call `startModelManager`. Print "LM Studio server unreachable", the missing models with their `lms get` commands, or the memory shortfall, and return 1. Then print partial-GPU warnings, call `createGame({ gateway: 'live' })` and render `AppShell` with the seed default.
    - Until task 16.6, pass the context length that `startModelManager` currently takes.
    - Add `app/scripts/play.ts` and the root `"play"` script.
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6_
  - [x] 14.2 Write offline Launcher tests with the fake LM Studio client
    - Cover a bad config, an unreachable server, missing models, insufficient memory, and the success path with a seed.
    - _Requirements: 20.2, 20.3, 20.4, 20.5, 20.6_

- [x] 15. Checkpoint: playable through `app` and the TUI
  - Ensure all tests pass, including slice Properties 1–33, and ask the user if questions arise.

- [x] 16. Update the models config and the Model Manager
  - [x] 16.1 Extend the models config schema in `llm/src/lib/config/models-config.ts`
    - Add `contextLength` (a positive integer) and `models` as a record from Load Identifier (`^[a-z0-9][a-z0-9-]*$`) to `{ family, sources }`, where `sources` is an MLX-then-GGUF tuple of `{ format, get, key }`.
    - Add a refinement that reports `profiles.<p>.<role>.model` when it is not a key of `models`.
    - _Requirements: 21.6, 21.9, 22.1, 22.3_
  - [x] 16.2 Rewrite `config/models.yaml` and pin it with a config test
    - Use `contextLength: 8192`, the `gemma-31b`, `qwen-moe`, `qwen-27b` and `gemma-moe` entries, profile `gemma-voice` (voice `gemma-31b`; fast, narrator, bookkeeping and judge `qwen-moe`), profile `qwen-voice` (voice `qwen-27b`; the rest `gemma-moe`), and `active: gemma-voice`.
    - Confirm every `get` and `key` value against `lms get` and the SDK's downloaded list.
    - Add a config test that pins the shipped values and checks that the file validates, every role uses a Load Identifier its profile loads, the judge differs from voice in both profiles, and `contextLength` is 8192.
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.8, 21.9, 22.1_
  - [x] 16.3 Resolve Model Sources in the Model Manager
    - Add `resolveSource(entry, downloaded)` (MLX if downloaded, else GGUF, else `missing` with the preferred `lms get` command). `requiredModels` returns distinct Load Identifiers.
    - Route `checkDownloads`, `preflight`, `loadProfile` (`loadModel(source.key, { identifier, contextLength, keepResident })`), `unloadProfile` and `startModelManager` through it, reading `config.contextLength`. Remove the `contextLength` option from their public signatures.
    - _Requirements: 21.7, 22.2_
  - [x] 16.4 Update `models:pull`
    - In `llm/src/lib/model-manager/models-pull.ts` and `llm/scripts/models-pull.ts`, pull the preferred source for each missing Load Identifier, read the context length from config, and remove any context-length argument.
    - _Requirements: 21.7, 22.4_
  - [x] 16.5 Select reasoning adapters by family
    - In `llm/src/lib/gateway/`, choose the adapter from the model entry's `family` instead of substring matching, and add a `gemma4` adapter that sets `enable_thinking`. Unknown families keep the "no control" warning.
    - _Requirements: 21.4, 21.9_
  - [x] 16.6 Read the Context Length from config in the entry points
    - Remove the interim context-length argument from `app/src/lib/launcher.ts` and `evals/scripts/repl.ts`.
    - _Requirements: 22.2, 22.4_
  - [x] 16.7 Write unit tests for the Model Manager changes
    - Cover source resolution (MLX downloaded, GGUF only, neither), loading under the Load Identifier, `models:pull` pulling the preferred source, adapter selection including `gemma4`, and bad fields (an unknown Load Identifier, a zero Context Length, a one-element `sources`) reporting their paths.
    - _Requirements: 21.7, 21.9, 22.1, 22.3_

- [x] 17. Move the REPL and evals onto the Composition Root
  - [x] 17.1 Move the REPL onto `createGame`
    - `evals/scripts/repl.ts` and `runSession` obtain the Engine API and seams from `createGame`. Remove the evals re-export of the Live Seams.
    - _Requirements: 18.5, 22.4_
  - [x] 17.2 Implement `pnpm evals --profile <name>`
    - `evals/scripts/evals.ts` loads the configs, calls `startModelManager` for the named profile, runs the five fixtures through `createGame` with live seams, scores with the judge, and writes the Markdown and CSV reports with the judge identity and the warning when the judge equals voice.
    - With no `--profile`, it runs every profile and calls `unloadProfile(prev)` before `loadProfile(next)`. Add the root `"evals"` script.
    - _Requirements: 18.5, 22.4, 25.1, 25.2, 25.3_
  - [x] 17.3 Move the golden replay runner and `record-golden.ts` onto `createGame`
    - `replayGoldenSession` drives `api.newGame` and `api.act` through `createGame({ gateway: { replay }, seams: replay })`, and `record-golden.ts` records through the same path.
    - _Requirements: 5.5, 18.5, 23.6_
  - [x] 17.4 Write unit tests for the evals CLI with the fake client
    - Cover the unload-before-load order when switching profiles, the judge identity in the report, and the judge-equals-voice warning.
    - _Requirements: 25.2, 25.3_

- [x] 18. Write the Scripted Full Games in `app/src/lib/scripted-games.spec.ts`
  - [x] 18.1 Script the win by arrest
    - Add the shared harness: `createGame` with Fake Seams, an in-memory Save Store and a recording Outcome Sink, with no endpoint and no network. Scripts choose actions only from `actions()` and the Player View.
    - The script runs on a fixed seed on `easy`: read the brief, surveil the leads, break one Intercept with its true key, gather corroborated Claims against the Cell leader, and arrest. Expect `success` / `leader-arrested`.
    - Check the `ended` chunk, every `views.debrief()` section, and exactly one Outcome Record.
    - _Requirements: 23.1, 23.4, 23.5_
  - [x] 18.2 Script the Plot-completion failure
    - On a fixed seed, wait until the final stage executes. Expect `failure` / `plot-completed`, with the same end checks.
    - _Requirements: 23.2, 23.4, 23.5_
  - [x] 18.3 Script the burn
    - On a fixed seed on `hard`, travel tailed through high-risk Locations and repeat cold approaches until Cover Suspicion passes the threshold. Expect `failure` / `burned`, with the same end checks.
    - Pin each seed after a sweep confirms that its script reaches its ending.
    - _Requirements: 23.3, 23.4, 23.5_

- [x] 19. Record the Golden Replays and update the README
  - [x] 19.1 Re-record the three slice Golden Replays
    - Re-record `01-wait-only`, `02-travel-and-wait` and `03-travel-countersurveillance` once through `record-golden.ts` against the integrated pipeline, and empty `PENDING_RERECORD`.
    - _Requirements: 24.1_
  - [x] 19.2 Record the `04-full-game` Golden Replay
    - Record the win-by-arrest script end to end into `evals/replays/04-full-game/`. Check that CI replays all four fixtures through `ReplayGateway` and requires a deep-equal final state and state hash.
    - _Requirements: 23.6_
  - [x] 19.3 Update the README
    - Document `pnpm play`, `pnpm evals --profile <name>`, the Saves Directory and the App Shell key map in Commands. Name the `slice-integration` spec in Roadmap step 1.
    - _Requirements: 19.3, 25.4, 25.5_

- [~] 20. Final checkpoint: vertical slice playtest (slice task 24)
  - Play one full campaign through `pnpm play` on each of three fixed seeds. Win once through human sources and once through Intercepts, confirm that reckless contact patterns can get the player burned, and recognise at least one Side Thread as noise in the debrief.
  - Run `pnpm evals --profile <name>` on both profiles and set `active` in `config/models.yaml` from the results.
  - Ensure all tests pass (`pnpm run check`, including slice Properties 1–33), and ask the user if questions arise.
  - _Requirements: 24.2, 24.3, 25.1_

## Notes

- Property-based test sub-tasks are required (not optional), following the slice convention. Each is one fast-check test with at least 100 runs, tagged `// Feature: slice-integration, Property N: <title>`.
- Slice Properties 1–33 must keep passing at every checkpoint. Slice Properties 14 (replay) and 29 (turn atomicity) are also exercised against the integrated pipeline through Properties 40 and 39.
- Generators:
  - The engine properties (34–37, 41, 44, 46, 50) run over the engine-level walk from 5.3, so that errors are caught next to the code.
  - The action-only facade properties (42, 43, 45, 47–49, 51–54) run over the action-only walk from 8.5.
  - The properties that need dialogue turns or recording (38–40, 55, 57) use the Composition Root walk with Fake Seams from 12.6, as the design specifies.
  - All three walks drive the same engine and `PlayerViewEngine` code.
- The new World State fields (1.1) and the runtime-stream moves (4.6) change the slice Golden Replay artifacts. To keep the build green, those three fixtures are skipped by name from 1.1 until 19.1 re-records them once (Req 24.1).
- Decisions approved in the design:
  - The Model Source `get`/`key` values are confirmed during 16.2 and pinned by the config test.
  - `TASKING_EXPOSURE` is an engine constant (2.3), not a preset field.
  - The hint triggers are redefined from Player View facts (8.4).
  - If the playtest shows memory growth on MLX, the fix is a config-only edit that lists GGUF first, with no code change.
  - The Hostile doctrine stream offset (`derive(seed, 0x30000)`) is not changed here. It moves with content-expansion's `generatorVersion` bump.
- The follow-on specs (content-expansion, plot-library, ambient-world, campaign-career, multi-city) now depend on this spec. They extend `advanceWorld`'s hook list (5.1, 4.6), the Composition Root (12.5) and the App Shell (13.2). ambient-world's tick orchestrator and campaign-career's Outcome Record reader assume the hook-application contract and the one-time Outcome Record write (8.1).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.5", "3.1"] },
    { "id": 1, "tasks": ["1.1"] },
    { "id": 2, "tasks": ["1.2", "1.4"] },
    { "id": 3, "tasks": ["1.3", "2.1", "2.2", "2.3", "2.5", "3.2", "4.1"] },
    { "id": 4, "tasks": ["1.6", "2.4", "3.3", "4.2", "4.4"] },
    { "id": 5, "tasks": ["2.6", "4.3", "4.5", "4.6"] },
    { "id": 6, "tasks": ["4.7", "5.1"] },
    { "id": 7, "tasks": ["5.2", "5.3"] },
    { "id": 8, "tasks": ["5.4", "5.5", "5.6", "5.7", "5.8", "5.9", "5.10", "7.1", "7.2", "7.3", "7.4"] },
    { "id": 9, "tasks": ["7.5", "7.6", "8.1"] },
    { "id": 10, "tasks": ["8.2"] },
    { "id": 11, "tasks": ["8.3"] },
    { "id": 12, "tasks": ["8.4"] },
    { "id": 13, "tasks": ["8.5", "9.1", "9.3"] },
    { "id": 14, "tasks": ["8.6", "8.7", "8.8", "9.2", "9.4"] },
    { "id": 15, "tasks": ["9.5", "9.6", "9.7", "9.8"] },
    { "id": 16, "tasks": ["9.9", "9.10", "11.1"] },
    { "id": 17, "tasks": ["11.2"] },
    { "id": 18, "tasks": ["11.3", "12.1"] },
    { "id": 19, "tasks": ["11.4", "11.5", "12.2", "12.3"] },
    { "id": 20, "tasks": ["12.4", "12.5"] },
    { "id": 21, "tasks": ["12.6", "13.1"] },
    { "id": 22, "tasks": ["12.7", "12.8", "12.9", "12.10", "12.11", "13.2", "13.3"] },
    { "id": 23, "tasks": ["13.4", "13.5", "14.1"] },
    { "id": 24, "tasks": ["14.2", "16.1"] },
    { "id": 25, "tasks": ["16.2", "16.3", "16.5"] },
    { "id": 26, "tasks": ["16.4", "16.6"] },
    { "id": 27, "tasks": ["16.7", "17.1"] },
    { "id": 28, "tasks": ["17.2", "17.3"] },
    { "id": 29, "tasks": ["17.4", "18.1"] },
    { "id": 30, "tasks": ["18.2"] },
    { "id": 31, "tasks": ["18.3"] },
    { "id": 32, "tasks": ["19.1"] },
    { "id": 33, "tasks": ["19.2", "19.3"] }
  ]
}
```
