# Implementation Plan

## Overview

This plan builds on the completed vertical slice (`.kiro/specs/tradecraft/tasks.md`, tasks 1–24). It assumes the slice's packages, Content Pack loader, world generator, Outcome Record, Player View, saves and `ReplayGateway` exist and that the slice's Properties 1–32 pass.

The order is:

1. Campaign content and config.
2. The pure campaign core: state, Officer, era, Review Board, Carry-Over, HQ Phase, arcs.
3. The opt-in slice extensions: Posting Context, carry and arc steps, Plot selector, Recogniser hook.
4. Views, persistence, the Campaign API and the TUI.

Property numbers refer to this spec's design. Each property test sits next to the code it checks.

Follow-on spec order: content-expansion → plot-library → ambient-world → campaign-career → multi-city. content-expansion tasks 1–2 (schemas, Content Kind Registry and loader) are a hard prerequisite; task 1.1 here registers through that registry.

## Tasks

- [x] 1. Add campaign content kinds and configuration
  - [x] 1.1 Define the campaign content schemas
    - In `packages/campaign/src/content`, define Zod schemas and JSON Schema export for these kinds, and register them through content-expansion's Content Kind Registry (`LoadOptions.kinds`) with Field Declarations rather than adding schemas inside `packages/content` (prerequisite: content-expansion task 1.2): backgrounds, Rank table, Skills (XP rules, modifier effects with `path`, `op`, `perLevel`, `bounds`), Traits (triggers, effects), Factions, HQ cast templates, Requisitions (closed effect enum), Exfiltration benefits, Campaign Arc templates (closed condition-kind enum, stages, thread refs, resolve rules), Arc Thread templates (Side Thread shape plus `clues` and slots), Epochs, Review weights and campaign text templates.
    - Consume the City Pack interface (`id`, `displayName`, `years`, `languages`, `services` as references to content-expansion Service Definition ids, `covers`) and the Cover Identity `official` flag (default `true`). Define no Service schema: reference content-expansion's `service` kind.
    - _Requirements: 14.1, 17.1, 21.3, 21.4, 22.1, 22.4_
  - [x] 1.2 Extend the pack loader with campaign cross-reference checks
    - Check that arc → archetype, predicate, Trait and thread references resolve, that every modifier `path` names a numeric `DifficultyPreset` or recruitment-weight field, that bounds are ordered, and that Epoch years do not overlap.
    - Report every failure as a slice `ContentError` (pack, file and path).
    - _Requirements: 4.2, 22.2_
  - [x] 1.3 Write the property test for campaign content validation
    - **Property 22: Campaign content validation**
    - **Validates: Requirements 14.1, 22.1, 22.2**
  - [x] 1.4 Author the core pack's campaign content
    - Under `packs/core/campaign/`, write three backgrounds, the Rank table, Skills including two languages, Traits (including "strained"), Factions (including Security), 5–7 HQ cast templates, Requisitions, Exfiltration benefits, and the review weights.
    - Write the Nemesis and Mole Hunt arcs with their thread templates.
    - Write the 1948–1962 Era Pack, with fictional background-event templates only, and the Review Board, Capture, accusation and Personal File text templates.
    - Add a content smoke test that the core pack loads.
    - _Requirements: 15.1, 16.1, 17.1, 17.5, 21.4, 22.3_
  - [x] 1.5 Implement the campaign config
    - Add the `CampaignConfig` Zod schema in `packages/campaign/src/config.ts`, reporting each issue as `<file>: <path>: <message>`.
    - Ship a default `config/campaign.yaml`.
    - Add example-based tests that the default validates and that representative bad fields are reported with their paths.
    - _Requirements: 24.1, 24.2, 24.3_

- [x] 2. Build the campaign state core
  - [x] 2.1 Create the `campaign` package and core types
    - Add `packages/campaign` (strict TypeScript, ESM).
    - Extend the dependency-cruiser rules: `campaign` must not import `tui`, and `player-view` may import from `campaign` only through its view-function entry point.
    - Define `CampaignState` with the `view` / `truth: Truth<…>` / `archive` / `rng` / `log` split, plus `CarriedNpc`, `CarriedAsset`, `CarryIn`, `PostingContext`, `PostingResult`, `PlayerCarry`, `PostingStats`, `PlayerHistory`, `CampaignChoice`, `CampaignLogEntry` and `HqStep`.
    - Implement `postingSeed(campaignSeed, k) = derive(campaignSeed, k)` and the campaign stream `derive(campaignSeed, 0xC0000)`.
    - _Requirements: 2.1, 2.2, 7.1_
  - [x] 2.2 Implement the reducer skeleton and Campaign creation
    - Implement pure `quoteChoice` and `step` with the `HqStep` state machine and a step-handler registry. Accepted choices append to the log; rejected ones return an error with the state unchanged.
    - Implement the `create` choice: record the seed (generated when absent), preset, name, background, start year and manifest; apply the background profile; draw the HQ cast and the HQ Mole on the campaign stream into Campaign Truth; assign campaign-stable `cp-` ids.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.3, 2.5, 16.1_

- [x] 3. Implement the Officer, era and Review Board
  - [x] 3.1 Implement Officer modifiers
    - Implement `officerModifiers`, applying Rank, Skills, Traits, tier, era and Requisitions in a fixed order, clamping each effect, and resolving the result through the slice's preset override resolution.
    - Add the language Cold Approach modifier and the Rank-table Budget, arrest authority and staff count.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 3.2 Write the property test for bounded Officer modifiers
    - **Property 10: Bounded Officer modifiers**
    - **Validates: Requirements 4.1, 4.2**
  - [x] 3.3 Implement Skill growth, Traits and Stress
    - Implement `growSkills` from Posting Stats through content XP rules (cap 5), `applyTraitTriggers`, `applyStress` (clamped to 0–100), the strained-Trait rule at ≥ 80 and the forced medical-leave flag at 100.
    - Add unit tests for the trigger, threshold and medical-leave examples.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 3.4 Write the property test for Skill growth
    - **Property 11: Skill growth**
    - **Validates: Requirements 3.2, 10.1**
  - [x] 3.5 Implement the era timeline
    - Implement `epochAt`, `tensionAt` (cached per year in Campaign Truth) and `eraOverrides` (cipher intersection with the weakest-cipher fallback, and a doctrine shift clamped to [0, 1]).
    - _Requirements: 17.2, 17.3, 17.4_
  - [x] 3.6 Write the property test for era gating
    - **Property 19: Era gating**
    - **Validates: Requirements 17.2, 17.3, 17.4**
  - [x] 3.7 Implement the Review Board
    - Implement `careerScore`, `reviewDecision` (promote, hold, demote, reprimand, dismiss), Career Point awards, Career Standing accumulation and the decision Cable rendered from templates.
    - Add unit tests for the score arithmetic and the Cable.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [x] 3.8 Write the property test for review monotonicity
    - **Property 12: Review monotonicity**
    - **Validates: Requirements 8.2, 8.3**

- [x] 4. Build Posting Results and Carry-Over
  - [x] 4.1 Implement `buildPostingResult` in `engine/outcome`
    - Compute Posting Stats from the action log and ActionResults only.
    - Build Player Carry from the final Player View and Case File, including `observedBurns` and opaque `CampaignUnkRef`s for Unidentified Subjects of carry-eligible persons.
    - Build the truth extract: surviving hostile officers, Assets with relationship and access, and arc-clue presence.
    - Build the debrief pair (full and redacted) with the redaction rule and protected set.
    - Read the Outcome Record as schema 2; normalise a schema-1 record to schema 2 with one Primary `plots[]` entry from the Posting's Plot template, ignore the optional `region` block, and copy `plots[]` into the Posting Result.
    - _Requirements: 5.3, 6.5, 7.3, 7.5, 21.6_
  - [x] 4.2 Write the property test for debrief redaction and reveal
    - **Property 6: Debrief redaction and reveal**
    - **Validates: Requirements 7.3, 7.4**
  - [x] 4.3 Implement the Hostile Dossier
    - Implement `mergeHostileMemory` (burned Legends, descriptor, Tradecraft Patterns from city-local drops and channels, Notoriety, clamped doctrine shift), the yearly Notoriety decay, and `dossierCarry` (Cover Suspicion capped at half the burn threshold, tail start, pattern multipliers).
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.7, 18.4_
  - [x] 4.4 Write the property test for Hostile Dossier monotonicity and bounds
    - **Property 16: Hostile Dossier monotonicity and bounds**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.7**
  - [x] 4.5 Implement Carry-Over
    - Implement `carryOver` as the ordered composition: archive, calendar, skills and Traits, Stress, dossier merge, carried persons, arcs (a no-op hook until task 6.1), and review staging.
    - Validate the Posting Result schema first. On failure, return field-path errors and leave the state unchanged.
    - _Requirements: 5.4, 6.1, 6.2, 6.3, 6.4, 12.5_
  - [x] 4.6 Write the property test for Carry-Over purity and validation
    - **Property 3: Carry-Over purity and validation**
    - **Validates: Requirements 5.3, 5.4, 6.1, 6.2, 6.3, 6.4**

- [x] 5. Implement the HQ Phase
  - [x] 5.1 Implement Posting Offers
    - Implement `makeOffers`:
      - draw 2–4 offers from City Packs available in the year, falling back to the core city;
      - exclude cities by Notoriety;
      - give each offer a tier from Rank and Tension;
      - draw one assigned offer below the assignment threshold, and two `quiet` offers after medical leave.
    - Use the same function for the 2–3 offers at creation.
    - _Requirements: 1.5, 3.6, 9.1, 9.2, 9.3, 9.4, 9.5_
  - [x] 5.2 Write the property test for offer validity
    - **Property 13: Offer validity**
    - **Validates: Requirements 1.5, 9.1, 9.3, 9.4**
  - [x] 5.3 Implement HQ preparation
    - Implement the handlers for training slots (Rank cap), leave (uses a slot, relieves Stress), Requisitions (Career Point debit, rejected when short), Legend choice (city-allowed Covers minus Legends burned to active services, with a generic refusal reason) and `adopt-manifest`.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 23.6_
  - [x] 5.4 Write the property test for Career Point conservation
    - **Property 14: Career Point conservation**
    - **Validates: Requirements 10.2, 10.3, 11.4**
  - [x] 5.5 Write the property test for Legend eligibility
    - **Property 15: Legend eligibility**
    - **Validates: Requirement 10.5**
  - [x] 5.6 Implement Asset decisions
    - Implement the Assets step: one decision per staged Asset.
      - Handover: Standing bonus and city record.
      - Exfiltrate: Career Point cost and archetype benefit.
      - Bring: only for `mobile` archetypes.
    - Carry `hostileControlled` unchanged in truth.
    - Add unit tests for each decision.
    - _Requirements: 11.1, 11.2, 11.4, 11.5, 11.6_
  - [x] 5.7 Implement Captures and Campaign End
    - Implement the Official Cover expulsion path and `resolveCapture` (exchange, imprisonment with years lost, or death, plus a defection offer).
    - Implement the End Offers step (retirement after ≥ 3 Postings, defection on offer) and `endTrigger` as the only setter of `ended`, including the calendar passing 1962.
    - Implement `archive.reveal` on end.
    - _Requirements: 17.6, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 7.4_
  - [x] 5.8 Write the property test for Campaign End soundness
    - **Property 21: Campaign End soundness**
    - **Validates: Requirements 8.4, 17.6, 19.2, 19.4, 19.5, 19.6, 19.7**

- [x] 6. Implement Campaign Arcs and the Mole Hunt
  - [x] 6.1 Implement the arc engine
    - Implement the condition-kind evaluators, arc initialisation at creation (bindings on the campaign stream), `advanceArcs` (`clue-held` from player-held Claims; `clue-present` and `person-status` from truth), and active-stage Arc Thread specs, as a standalone module.
    - _Requirements: 14.1, 14.2, 14.5_
  - [x] 6.2 Implement the Nemesis arc rules
    - Implement Nemesis selection (a surviving carried hostile, else generated), placement as Principal NPC and Recogniser, growth on survival with caps, resolution on arrest, turning or death, and the pitch (a Walk-in or drop letter) registering a defection offer.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_
  - [x] 6.3 Implement the Mole Hunt rules
    - Implement between-Posting leaks (Legend and Directive access) into the Hostile Dossier, and Mole Hunt thread specs whose clues use existing predicates over HQ figures.
    - Implement `moleEvidence` with the slice's `evidenceCount` over the union of player-held Claims.
    - Implement the accusation handler: a correct accusation resolves the arc and adds Standing and Security reputation; a wrong one adds a reprimand, lowers Security reputation and uses the fixed Cable.
    - _Requirements: 16.2, 16.3, 16.4, 16.5, 16.6_
  - [x] 6.4 Wire the HQ Phase handlers into the reducer
    - Register the Debrief, Review, Capture, Assets, Arcs, End Offers, Offers and Prepare handlers and the accusation choice in the step-handler registry from task 2.2.
    - Replace the Carry-Over arc hook from task 4.5 with `advanceArcs`, and call arc initialisation from the `create` handler.
    - _Requirements: 2.5, 5.1, 8.1, 11.1, 16.4_
  - [x] 6.5 Write unit tests for arcs, the Nemesis and the Mole Hunt
    - Cover stage advancement, Nemesis growth caps and resolution, the leak effect on starting Cover Suspicion, and both accusation outcomes.
    - _Requirements: 14.5, 15.3, 15.4, 16.2, 16.5, 16.6_

- [x] 7. Checkpoint: campaign core
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Extend the slice for Postings
  - [x] 8.1 Add the Plot selection call
    - In `engine/plot-select`, implement `toTemplateHistory` (plot-library `TemplateHistoryEntry[]` from archived schema-2 `plots[]`) and `selectPlot`: when plot-library is installed, call its `select(SelectionInput)` with `history: templateHistory` and the selection context (year, Tension, Epoch flags, Rank, scaling); otherwise use `fallbackSelect` (uniform over templates whose ids are not in `templateHistory`, else all).
    - Make world-generation step 4 use `selectPlot` only when a Posting Context is present.
    - _Requirements: 21.1, 21.2, 21.6_
  - [x] 8.2 Write the property test for fallback Plot selection
    - **Property 20: Fallback Plot selection**
    - **Validates: Requirements 21.1, 21.2, 21.6**
  - [x] 8.3 Implement the Personal File renderer
    - Implement pure `personalFile(carries, content)`: identified carry-eligible persons, most recent first, capped at `personalFileMax`, with carried `MEMBER_OF`, `WORKS_FOR` and `IS_ALIAS_OF` Claims rendered through third-person templates, and the Epoch's background-event section.
    - _Requirements: 7.6, 13.1, 17.5_
  - [x] 8.4 Write the property test for Personal File provenance
    - **Property 7: Personal File provenance**
    - **Validates: Requirements 7.6, 13.1**
  - [x] 8.5 Implement the generator's carry and arc steps
    - Add the optional `PostingContext` parameter to `generate`. The Hostile Service org is named from the Service Definition `ctx.service`.
    - Implement the carry step on `derive(postingSeed, 0x60000)` (block `0x60000`–`0x6FFFF` in the slice PRNG stream registry):
      - placements with stable `npc:cp-<n>` ids, schedules and Contact Channels;
      - Recognisers;
      - the Personal File added to the Starting Brief, with its persons registered as known;
      - Unidentified Subject pre-allocation;
      - bounded modifiers and Requisition effects.
    - Implement the arc step on `derive(postingSeed, 0x61000)`, with no Cell members in slots.
    - Re-verify Plot paths and Arc Clue paths, retry up to 8 times, then drop optional placements in fixed order.
    - Add `WorldState.carry` as truth-branded state.
    - _Requirements: 4.5, 5.2, 11.3, 11.5, 12.4, 13.1, 14.3, 14.4, 14.6, 18.1, 18.2, 18.3, 18.4_
  - [x] 8.6 Implement the Posting Context builder
    - Implement `buildPostingContext(state, offer, content)`:
      - Officer and era overrides, plus dossier carry modifiers;
      - placements for brought Assets, handed-over Assets in the same city (with trust decay), Recognisers, the Nemesis and HQ visitors;
      - Arc Thread specs, Unidentified Subject pre-allocations and the Personal File spec;
      - the Player History (`templateHistory` from archived schema-2 `plots[]`, plus selection context) built from view and Archive data only;
      - year, Tension and Epoch flags.
    - _Requirements: 4.1, 5.1, 5.2, 11.3, 11.5, 12.4, 12.5, 15.2, 16.3, 17.5, 21.1, 21.5_
  - [x] 8.7 Implement the Recogniser hook and the "seen before" Fact Line
    - In the slice's detection checks (surveil, follow, meeting, travel arrival), run each present Recogniser with `security = 1`. On a hit, add `recogniserSuspicion` to Cover Suspicion and emit a hidden `officer-recognised` event; the player sees only the normal "made" line.
    - On the first sighting of a pre-allocated Unidentified Subject, append the "seen before" Fact Line.
    - Add unit tests that the hook adds no Notification.
    - _Requirements: 12.6, 13.3, 13.4_
  - [x] 8.8 Write the property test for Posting solvability under Carry-In
    - **Property 8: Posting solvability under Carry-In**
    - **Validates: Requirements 12.4, 14.4, 14.6, 18.1, 18.2, 18.3, 18.4**
  - [x] 8.9 Write the property test for generator neutrality
    - **Property 9: Generator neutrality**
    - **Validates: Requirements 4.5, 14.3, 18.5**
  - [x] 8.10 Write the property test for Posting seed independence
    - **Property 2: Posting seed independence**
    - **Validates: Requirements 2.1, 2.2**
  - [x] 8.11 Write the property test for Asset continuity
    - **Property 17: Asset continuity**
    - **Validates: Requirements 11.2, 11.3, 11.5, 11.6**
  - [x] 8.12 Write the property test for Unidentified Subject continuity
    - **Property 18: Unidentified Subject continuity**
    - **Validates: Requirements 13.3, 13.4**

- [x] 9. Build the Campaign View
  - [x] 9.1 Implement the Campaign View projections
    - In `campaign/view`, implement `campaignView`, `officerView` (Legend burn status only from `observedBurns`), `archiveView` (redacted debriefs and read-only Case Files until reveal), `knownEnemiesView` (persons in Player Carry only) and `hqStepView`.
    - _Requirements: 7.2, 13.5, 20.1, 20.2, 20.3, 20.4, 20.5_
  - [x] 9.2 Write the property test for campaign truth isolation
    - **Property 4: Campaign truth isolation**
    - **Validates: Requirements 7.1, 7.2, 11.6, 16.1, 20.3, 20.5**
  - [x] 9.3 Write the property test for player-side derivations
    - **Property 5: Player-side derivations ignore truth**
    - **Validates: Requirements 6.5, 7.5, 16.4, 16.6, 21.1**

- [x] 10. Implement campaign persistence and replay
  - [x] 10.1 Implement the Campaign Save
    - Write the directory layout (`campaign.json`, `postings/<k>/…`, `current-posting.json`): archive files first, then `campaign.json` via temp file, fsync and rename, with SHA-256 file hashes.
    - On load, verify hashes and refuse to resume an in-progress Posting on a manifest mismatch.
    - Add unit tests that inject a failure at each write step.
    - _Requirements: 5.5, 23.1, 23.2, 23.5, 23.7_
  - [x] 10.2 Implement the migration runner
    - Implement `migrate` with a per-version `{ from, to, up }` table (empty at schema 1), validating before and after each step, and refuse newer versions or failed steps with no state change.
    - _Requirements: 23.3, 23.4_
  - [x] 10.3 Implement campaign replay
    - Implement `replayCampaign`: fold the log, replay each Posting through the slice's `ReplayGateway` to rebuild its Posting Result, and check `resultHash`.
    - _Requirements: 2.3, 2.4_
  - [x] 10.4 Write the property test for the Campaign Save round-trip
    - **Property 23: Campaign save round-trip**
    - **Validates: Requirements 5.5, 23.1, 23.2**
  - [x] 10.5 Write the property test for migration
    - **Property 24: Migration**
    - **Validates: Requirements 23.3, 23.4**
  - [x] 10.6 Write the property test for Campaign determinism
    - **Property 1: Campaign determinism**
    - **Validates: Requirements 1.4, 2.3, 2.4, 2.5, 10.6**

- [x] 11. Checkpoint: Postings and persistence
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Wire the Campaign API
  - [x] 12.1 Implement the Campaign API in `player-view/campaign`
    - Implement `newCampaign`, `view`, `hq` (step, options, quote, choose), `posting()` (the slice `EngineApi` started from the Posting Context), `archive`, `officer`, `enemies` and `saves`.
    - On a slice `ended` chunk: build the Posting Result, call `step`, save, and switch to the redacted Debrief step in place of the slice debrief.
    - _Requirements: 5.1, 5.3, 7.3, 20.6_
  - [x] 12.2 Write the integration test for the Posting lifecycle
    - Create a Campaign, play a scripted first Posting through `ReplayGateway` to an end, step through the HQ Phase with a Handover and a Requisition, and start the second Posting.
    - Assert that the Personal File is in the Starting Brief, that reading it adds its Claims with source "document", that the handed-over Asset is absent (different city), and that the save and load round-trip holds.
    - _Requirements: 5.1, 5.3, 11.2, 13.1, 13.2, 23.2_

- [x] 13. Build the campaign TUI
  - [x] 13.1 Implement the creation and HQ Phase screens
    - Creation: seed, preset, name, background and start year.
    - HQ Phase: debrief, Review Board Cable, Capture outcome, Asset decisions, arc events, Posting Offers, training, Requisitions, leave, Legend choice, accusation, and End Offers. Each option shows its quote.
    - _Requirements: 1.1, 1.2, 20.4_
  - [x] 13.2 Implement the Archive, Officer, Known Enemies and Campaign End screens
    - Archive: career timeline, redacted debriefs and read-only Case Files.
    - Officer: Rank, Skills and XP, Traits, Stress, Legends with observed burns, and Standing and reputation bands.
    - Known Enemies.
    - Campaign End: end type, final Rank, timeline and full reveal.
    - Show the campaign load errors (`campaign-version`, `migration-failed`, `hash-mismatch`, `manifest-mismatch`).
    - _Requirements: 19.8, 20.1, 20.2, 20.3, 20.5, 23.4, 23.5_
  - [x] 13.3 Write TUI snapshot tests
    - Snapshot each campaign screen with `ink-testing-library`.
    - _Requirements: 19.8, 20.1, 20.2, 20.3, 20.4_

- [x] 14. Add the golden campaign replay
  - [x] 14.1 Record and check in a two-Posting campaign fixture
    - Record a Campaign with one Handover, one carried Recogniser and one Mole Hunt clue into `evals/replays/campaign/`.
    - Add a CI test that `replayCampaign` reaches an identical final Campaign state.
    - _Requirements: 2.4, 12.5, 16.3_

- [x] 15. Final checkpoint: campaign playtest readiness
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- This spec builds on the completed slice and changes slice code only through the opt-in extension points in tasks 8.1, 8.5 and 8.7. With no Posting Context, slice behaviour is unchanged (Property 9).
- Test sub-tasks are not marked optional, following the slice's plan, because the determinism, isolation and solvability properties guard slice invariants.
- City Packs, Plot templates and ambient events come from content-expansion, plot-library and ambient-world through the interfaces in the design. The core pack's single city, Plot templates and Era Pack are enough to run every task.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.5"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "2.2", "3.1", "3.3", "3.5", "3.7", "4.1", "4.3", "8.1"] },
    { "id": 3, "tasks": ["3.2", "3.4", "3.6", "3.8", "4.2", "4.4", "4.5", "5.1", "5.3", "5.7", "6.1", "8.2", "8.3"] },
    { "id": 4, "tasks": ["4.6", "5.2", "5.4", "5.5", "5.6", "5.8", "6.2", "6.3", "8.4", "8.5"] },
    { "id": 5, "tasks": ["6.4", "8.6", "8.7"] },
    { "id": 6, "tasks": ["6.5", "8.8", "8.9", "8.10", "8.11", "8.12", "9.1", "10.1", "10.2", "10.3"] },
    { "id": 7, "tasks": ["9.2", "9.3", "10.4", "10.5", "10.6", "12.1"] },
    { "id": 8, "tasks": ["12.2", "13.1", "13.2"] },
    { "id": 9, "tasks": ["13.3", "14.1"] }
  ]
}
```
