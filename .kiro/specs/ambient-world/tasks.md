# Implementation Plan

## Overview

This plan builds on the completed slice (`.kiro/specs/tradecraft/`): every slice task is assumed done, and slice modules are extended in place. The order is content and config first, then ambient state and initialisation, the Solvability Gate, the event system and Location overlays, the hook gateway, and the tick orchestrator. The orchestrator is wired early with identity steps so each later module (life, populace, memory, gossip, news, threads, Cover Duties) slots into a fixed place without orphaned code. Dialogue, narration, Player View and TUI integration follow, and whole-system properties, the benchmark and eval fixtures come last. Property numbers refer to this spec's design. As in the slice, property tests are required tasks.

Follow-on spec order: content-expansion → plot-library → ambient-world → campaign-career → multi-city. content-expansion tasks 1–2 (schemas, Content Kind Registry and loader) are a hard prerequisite; task 1.1 here registers through that registry. Task 17 (multi-city fidelity contract) needs multi-city task 5.1 (the `AmbientSimulator` interface and its contract test suite).

## Tasks

- [ ] 1. Ambient content and configuration
  - [ ] 1.1 Define the ambient content schemas
    - In `engine/ambient/content`, define Zod schemas for Event_Template, Incident template, Life_Event_Template, Story template, Outlet, Notice template, Cover_Duty template, Civic_Org template, holiday definition, City_Metric definition and Recollection template, and export JSON Schemas.
    - Register every ambient kind through content-expansion's Content Kind Registry (`LoadOptions.kinds`) with Field Declarations (text, templates, Tag and Tag Query selector fields, Year Ranges, references), rather than adding schemas inside `packages/content` (prerequisite: content-expansion task 1.2).
    - Define the closed Effect_Op and Ambient_Hook enums, the location/route/NPC selector schemas (Location and District selectors as content-expansion Tag Queries) and the schema for the `ambient.spawn` block (`{ metric, above, tags? }`) that ambient validates inside plot-library's pass-through `ambient` field on Side Thread templates (plot-library Req 15.7).
    - Extend the Difficulty Preset schema with the `ambient` block, the Document kind union with `notice`, and the entity kinds with `evt:`.
    - _Requirements: 5.5, 18.1, 22.1, 23.2_
  - [ ] 1.2 Add ambient loader checks
    - Check cross-references (templates → stories, notices, metrics, incidents, life events; selectors → District and Location Type tags).
    - Reject person slots that can bind to anything other than registry NPCs or `role-title` pools.
    - Reject era-denylist terms, ambient predicates with implication rules, and unknown op or hook kinds. Report each error with pack, file and path.
    - _Requirements: 22.3, 22.4_
  - [ ] 1.3 Author the `ambient` pack
    - Create `packages/content/packs/ambient/` with `pack.yaml` requiring `core`.
    - Define the predicates OCCURS_AT, ATTENDS, HAS_STATUS, RELATED_TO, INVOLVED_WITH and OWES with built-in evaluator kinds and unique field codes.
    - Ship at least 4 Event_Templates per category (labour, festival and holiday, election, police crackdown, weather, border incident, economic, cultural, accident), at least 40 Incident templates, plus Life_Event, Story, Notice, Cover_Duty, Civic_Org, Outlet, holiday, metric, Recollection and Regard-rule content that works with the slice's generated city.
    - _Requirements: 6.1, 6.2, 7.2, 22.2, 22.5_
  - [ ] 1.4 Write the property test for ambient content validation
    - **Property 20: Ambient content validation**
    - **Validates: Requirements 5.5, 22.1, 22.2, 22.3, 22.4**
  - [ ] 1.5 Extend the scenario config and presets
    - Add the `ambient` block (`enabled`, `density`) to the `ScenarioConfig` schema, plus the `recruitment.firstContact.e` and `recruitment.meeting.regard` weights.
    - Add the preset `ambient` values from the design table to `difficulty.yaml`, and update the shipped `config/scenario.yaml`.
    - Add config tests for the shipped files and for representative bad fields with their paths.
    - _Requirements: 2.10, 23.1, 23.2, 23.3_

- [ ] 2. Ambient state, streams and initialisation
  - [ ] 2.1 Define ambient state, keyed streams and budgets
    - Add `engine/ambient/state.ts` with `AmbientState` and its sub-types (Truth-branded where hidden), and `WorldState.ambient?`.
    - Add `streams.ts` with `derive(derive(seed, base + day), fnv1a32(key))` for every stream in the design table (offsets in the `0x50000`–`0x5FFFF` block of the slice PRNG stream registry), and `budgets.ts` with the Density-scaled caps and day counters.
    - Register `evt:` ids in the Entity Registry and Leak Guard aliases.
    - _Requirements: 1.1, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.10_
  - [ ] 2.2 Implement ambient initialisation
    - Implement `initAmbient`: Civic_Orgs (including the Cover_Employer), 1–3 Outlets, the Townsfolk pool, NPC_Ties (≤ 8 each), 2–4 Dormant_Locations, Informants at preset density, initial metrics and the calendar start date.
    - Call it after the slice noise step, re-verify, and retry with derived ambient seeds up to 8 times before throwing `GeneratorError`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.1, 10.1, 13.3_
  - [ ] 2.3 Write the property test for additive initialisation
    - **Property 3: Additive initialisation**
    - **Validates: Requirements 1.6, 3.1, 3.3, 3.4**

- [ ] 3. Solvability Gate
  - [ ] 3.1 Extend the discovery-path verifier to return witnesses
    - Return `VerifierResult` with the Solvable_Set and two witness paths per key, without changing the slice verifier's rules or root.
    - Implement `anchorsOf` over meeting edges and pending Plot trace slots.
    - _Requirements: 19.1, 19.5_
  - [ ] 3.2 Implement the gate
    - Implement footprint computation for each Structural_Change kind, the fast path, the slow path (change applied for its full duration, accept iff the Solvable_Set is contained), the daily slow-run cap and fallback handling.
    - Unit-test accept, reject, cap and fallback cases.
    - _Requirements: 2.6, 19.2, 19.3, 19.4_

- [ ] 4. City Metrics, calendar, events and Location overlays
  - [ ] 4.1 Implement City Metrics
    - Implement exogenous and reactive components, clamped totals, decay toward baselines and delta routing by event class and player-caused triggers. Add unit tests.
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ] 4.2 Implement the calendar
    - Map days to dates and seasons from the start date, schedule holidays, and expose date and season to templates, Fact Lines and Documents. Add unit tests.
    - _Requirements: 7.1, 7.2, 7.3_
  - [ ] 4.3 Implement Location and Route overlays
    - Implement `Overlay`, `effectiveLocation` and `effectiveRoutes`, including status kinds, curfew, checkpoints and connectivity-preserving closures that otherwise convert to checkpoints.
    - _Requirements: 8.1, 8.5_
  - [ ] 4.4 Use effective values throughout the engine
    - Make `quote`, `resolve`, `crowdLevel` and `travelCost` take effective Locations and Routes. Add checkpoint detection and cover-risk on traversal.
    - Implement Dormant_Location activation, raids on drop sites with the hidden `drop-raided` event and the `drop-disturbed` event on next service, `lastKnownStatus` updates, and the Flavour cache key with status kind.
    - _Requirements: 8.2, 8.3, 8.4, 8.6, 8.7_
  - [ ] 4.5 Implement the event scheduler and Effect_Ops
    - Implement `selectEvents` with preconditions, cooldown, exclusion, the novelty factor, preset density and caps. Run exogenous selection first over exogenous inputs only, then reactive selection from keyed triggers.
    - Implement stage advancement and every Effect_Op, routing Structural_Changes through the gate and `ambient-hook` ops through the hook gateway, and removing overlays at event end.
    - Implement election results and the weather and border-incident rules, with unit tests per op.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.3, 6.4, 6.5_
  - [ ] 4.6 Implement Local_Incidents
    - Draw incidents per `(loc, phase)` on `ambient-local` within caps, emit hidden `incident` events, and produce Observations and Fact Lines when the player is present or surveilling.
    - _Requirements: 2.3, 5.9, 21.5_
  - [ ] 4.7 Write the property test for exogenous calendar independence
    - **Property 4: Exogenous calendar independence**
    - **Validates: Requirements 4.3, 4.4, 5.1**
  - [ ] 4.8 Write the property test for cooldown and exclusion
    - **Property 7: Cooldown and exclusion**
    - **Validates: Requirements 5.1, 5.7, 6.4**
  - [ ] 4.9 Write the property test for overlay reversibility
    - **Property 8: Overlay reversibility**
    - **Validates: Requirement 5.6**
  - [ ] 4.10 Write the property test for effective location soundness
    - **Property 9: Effective location soundness**
    - **Validates: Requirements 8.1, 8.2, 8.5**

- [ ] 5. Hook gateway
  - [ ] 5.1 Implement Ambient_Hooks
    - Implement `applyHook` for the six hook kinds. Delay and reroute call the slice's delay and reroute responses directly with no Abort Pressure. Channel outages do not mark Channels compromised.
    - Enforce the cumulative Plot delay cap and the daily Cover Suspicion caps, and append every hook to `hookLedger`.
    - Make the Hostile `dailyTick` tailing step read hidden `informant-report` events and apply `detection-bonus` to the next detection check.
    - Add a dependency-cruiser rule allowing only `engine/ambient/hooks` to import Plot mutation and Hostile belief writers.
    - _Requirements: 13.4, 13.5, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

- [ ] 6. Ambient Tick orchestration and persistence
  - [ ] 6.1 Wire the Ambient_Tick into the clock and turn pipeline
    - Add `engine/ambient/tick.ts` with the ordered day-boundary and phase steps from the design, called from `Clock.advance` before the Hostile `dailyTick` and newspaper.
    - Add `engine/ambient/turn.ts`, called inside the Turn Transaction draft.
    - Create the life, ties, populace, memory, gossip, news, threads and cover module files with identity steps, which later tasks replace.
    - Skip everything when ambient is disabled. Include `ambient` in `SaveSnapshot` with a version bump, and load saves without ambient state with ambient disabled.
    - Record tick timings to the metrics log.
    - _Requirements: 1.2, 1.4, 1.5, 2.8, 24.1, 24.2_
  - [ ] 6.2 Write the property test for Plot truth confinement
    - **Property 11: Plot truth confinement**
    - **Validates: Requirements 9.5, 9.6, 18.1, 18.2, 18.3, 18.4**
  - [ ] 6.3 Write the property test for the ambient Cover Suspicion cap
    - **Property 12: Ambient Cover Suspicion cap**
    - **Validates: Requirement 18.5**

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. NPC life, ties and populace
  - [ ] 8.1 Implement the life sim
    - Implement `LifeState`, `dailyAgenda` with the priority layers and Anchor_Slot protection, and Life_Event selection and application within caps.
    - Clamp MICE and `moneyNeed` drift, exclude removal, detention or death for Principal NPCs, and assert that protected fields are unchanged.
    - _Requirements: 2.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  - [ ] 8.2 Implement NPC_Ties
    - Implement co-presence affinity updates and decay, tie formation and ending with RELATED_TO, INVOLVED_WITH and OWES Propositions in the Truth Store and Knowledge Slices, and the introduce-task trust bonus.
    - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - [ ] 8.3 Implement Townsfolk, Promotion and Demotion
    - Implement coarse schedules, `promote` from the `townsfolk` stream keyed by id, the daily cap and queue with talk/approach priority, and `demote` keeping Regard and the top 4 Recollections.
    - Trigger promotion from the turn step on talk and approach.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - [ ] 8.4 Write the property test for keyed-stream independence
    - **Property 5: Keyed-stream independence**
    - **Validates: Requirements 1.1, 11.3**
  - [ ] 8.5 Write the property test for life bounds
    - **Property 13: Life bounds**
    - **Validates: Requirements 9.4, 11.5**

- [ ] 9. Memory, Regard, gossip and Informants
  - [ ] 9.1 Implement Recollections and Regard
    - Implement notice checks keyed by `(turnId, npcId)` in the turn step, grounded Recollections, descriptor references for unnamed persons, Regard rules per Intent and action, and decay and compaction.
    - Add the Regard terms to `firstContact` and meeting acceptance, and the greeting Fact Lines on arrival.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_
  - [ ] 9.2 Implement gossip and Informants
    - Implement pair selection over ties and co-presence, held-item transfer, distortion into receiver false beliefs, the daily cap, and Informant reports via `informant-report` and `detection-bonus` hooks.
    - _Requirements: 2.5, 13.1, 13.2, 13.4, 13.5_
  - [ ] 9.3 Write the property test for memory grounding
    - **Property 14: Memory grounding**
    - **Validates: Requirement 12.3**
  - [ ] 9.4 Write the property test for gossip and tie containment
    - **Property 15: Gossip and tie containment**
    - **Validates: Requirements 10.3, 13.1, 13.2**

- [ ] 10. News, Notices, Emergent_Threads and Cover_Duties
  - [ ] 10.1 Implement Stories and Outlets
    - Implement Story opening from events, threads, newsworthy incidents and public Plot traces, beats in cause order, the active cap and closure after 3 days.
    - Implement `editionCandidates` ranking and per-Outlet editions through the slice newspaper step, with slant distortion and truth records.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_
  - [ ] 10.2 Implement Notices
    - Create `notice` Documents from `post-notice` ops with `obtainableAt` and expiry, show the arrival Fact Line for unread Notices, and add Claims on first read.
    - _Requirements: 15.1, 15.2, 15.3_
  - [ ] 10.3 Implement Emergent_Threads
    - Implement spawn triggers (ops and `ambient.spawn` thresholds, `midgame` templates only), caps, participant choice that excludes Cell members and promotes Townsfolk within the cap, Noise Traffic and `origin: emergent`.
    - Call `instantiateSideThread(state, { template, at, bindHints }, content, rng)` with participant choices as `bindHints` and the `ambient-exo` stream keyed by template id as `rng`; on `ok: false` drop the spawn with state unchanged and log the reason.
    - Do not run the Solvability Gate on the thread itself (plot-library already re-runs consistency and verification); run it only for any additional Structural_Changes ambient applies.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.6_
  - [ ] 10.4 Implement Cover_Duties
    - Generate 2–4 weekly duties matching the Cover Identity id or tags, with attendee overrides that respect anchors.
    - Add the `attend-duty` action to `quote` and `resolve`, handle misses at slot end, apply standing and Cover Suspicion through hooks, and apply the low-standing multiplier.
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_
  - [ ] 10.5 Write the property test for news continuity
    - **Property 18: News continuity**
    - **Validates: Requirements 14.4, 14.5**
  - [ ] 10.6 Write the property test for emergent thread soundness
    - **Property 19: Emergent thread soundness**
    - **Validates: Requirements 16.2, 16.3, 16.6**
  - [ ] 10.7 Write unit tests for Cover_Duties
    - Test attendance, mandatory misses, Cover_Employer messages, the low-standing multiplier and Notification timing.
    - _Requirements: 17.2, 17.3, 17.4, 17.6_
  - [ ] 10.8 Write the property test for solvability monotonicity and anchor protection
    - **Property 10: Solvability monotonicity and anchor protection**
    - **Validates: Requirements 9.3, 17.5, 19.1, 19.2, 19.3, 19.4**

- [ ] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Dialogue and narration integration
  - [ ] 12.1 Extend the Knowledge Slicer and Prompt Builder
    - Add the day-refreshed ambient sub-block to block 3 (≤ 8 held Propositions by salience) and rendered Recollections to block 4.
    - Enforce the 400-token ambient cap, trim Recollections with Told List detail, and extend the NPC known-entity set with held ambient entities.
    - _Requirements: 21.1, 21.2, 21.3_
  - [ ] 12.2 Extend the Narrator scene descriptor
    - Add active public City_Event labels, Location_Status kind and incident Fact Lines to `SceneDescriptor`, and add event labels to the Specifics Guard allowed-name set.
    - _Requirements: 21.4, 21.5_
  - [ ] 12.3 Write the property test for ambient prompt containment and budget
    - **Property 16: Ambient prompt containment and budget**
    - **Validates: Requirements 12.5, 21.1, 21.2, 21.3**

- [ ] 13. Player View, Notifications and debrief
  - [ ] 13.1 Add ambient event visibility and Notifications
    - Add the visibility table entries for every ambient event kind, the player-visible Notification kinds (`public-announcement`, `cover-duty-due`, `cover-duty-missed`, `cover-employer-message`, `drop-disturbed`) and their content templates in `notify`.
    - _Requirements: 17.6, 20.1, 20.2, 20.3_
  - [ ] 13.2 Add City, Stories and Duties views and the debrief section
    - Add `knownEvents` tracking from Documents, Notices, Observations, Notifications and Claims, the City, Stories and Duties views, Map status from `lastKnownStatus`, and the EngineApi view methods.
    - Add the debrief section "The city and the case", listing applied hooks and Emergent_Threads.
    - _Requirements: 8.6, 14.7, 16.5, 18.6, 20.4, 20.5_
  - [ ] 13.3 Write the property test for ambient truth isolation and notification soundness
    - **Property 17: Ambient truth isolation and notification soundness**
    - **Validates: Requirements 8.6, 13.3, 20.2, 20.3, 20.4, 20.5**

- [ ] 14. TUI
  - [ ] 14.1 Add the ambient screens
    - Add the City, Stories and Duties panes, Location status on the Map and Here panes, Notice Fact Lines, the `attend-duty` action and the status-bar duty alert.
    - _Requirements: 14.7, 17.6, 20.4_
  - [ ] 14.2 Write TUI snapshot tests
    - Snapshot the City, Stories and Duties views, Notice Fact Lines and the duty alert.
    - _Requirements: 14.7, 20.4_

- [ ] 15. Whole-system properties, benchmark and evals
  - [ ] 15.1 Write the property test for ambient determinism, save and replay
    - **Property 1: Ambient determinism, save and replay**
    - **Validates: Requirements 1.2, 1.3, 2.7, 24.1, 24.3**
  - [ ] 15.2 Write the property test for ambient-off equivalence
    - **Property 2: Ambient-off equivalence**
    - **Validates: Requirements 1.5, 24.2**
  - [ ] 15.3 Write the property test for budget caps
    - **Property 6: Budget caps**
    - **Validates: Requirements 2.1–2.6, 2.10, 5.3, 10.1, 11.1, 11.4, 12.4, 14.1, 16.2, 17.1**
  - [ ] 15.4 Write the property test for ambient turn atomicity
    - **Property 21: Ambient turn atomicity**
    - **Validates: Requirement 1.4**
  - [ ] 15.5 Extend slice property generators with ambient state
    - Make the generators for slice Properties 3, 13, 14, 15, 16, 28 and 29 produce ambient-enabled worlds and runs.
    - _Requirements: 1.2, 20.5, 21.4, 24.1_
  - [ ] 15.6 Add the ambient benchmark
    - Add `pnpm bench:ambient`, which runs 30 days at Density `rich` on three fixed seeds and reports p95 day and phase tick times and save growth per day.
    - _Requirements: 2.8, 2.9_
  - [ ] 15.7 Add eval fixtures and a golden replay
    - Add the `gossiping-waiter` and `festival-arrival` fixtures, measuring Leak Guard trips, Specifics Guard trips and references to unheld Recollections.
    - Record a 7-day ambient-enabled golden replay into `evals/replays/`.
    - _Requirements: 24.3, 24.4_

- [ ] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Multi-city fidelity contract
  - [ ] 17.1 Implement the `AmbientSimulator` adapter
    - In `engine/ambient/fidelity`, implement multi-city's `AmbientSimulator` (`advanceFull`, `advanceCoarse`, `reconcile`, `couplings`) over one `AmbientState` per City, with keyed streams seeded from each City's ambient seed.
    - `advanceFull` runs the existing tick order. `advanceCoarse` runs the tier-independent steps from the design's tier-split table in full and the rest coarsely. `reconcile` re-derives coarse detail and keeps every Disclosed Fact.
    - Leave single-city mode unchanged.
    - _Requirements: 25.1, 25.5, 25.6, 25.8_
  - [ ] 17.2 Emit couplings and enforce the tier split
    - Emit every Ambient_Hook as the AmbientCoupling of the same kind, and map Location status, curfew, crowd and intercity route effects to `location-closed`, `crowd-modifier` and `route-delay`. Make the tick call no Spine writer directly in multi-city mode.
    - Compute City_Events and Effect_Ops only from exogenous and reactive inputs, and run Player-Concerning Processing at both tiers using base-schedule and Spine-placement co-presence.
    - Restrict `npc-schedule-override`, `detain-npc` and Cover_Duty attendee overrides to non-Principal NPCs in multi-city mode, and run the Solvability Gate against the Regional Verifier.
    - _Requirements: 25.2, 25.3, 25.4, 25.5_
  - [ ] 17.3 Write the property test for tier-independent couplings
    - **Property 22: Tier-independent couplings**
    - **Validates: Requirements 25.2, 25.3, 25.4, 25.5, 25.6, 25.8**
  - [ ] 17.4 Run multi-city's ambient contract test suite
    - Wire multi-city's exported contract test suite (from `engine/fidelity`) against the `AmbientSimulator` implementation in CI.
    - _Requirements: 25.7_

## Notes

- The plan assumes the slice is complete. Tasks extend slice modules in place and add `engine/ambient`.
- Interfaces owned by other specs (city packs, plot-library Side Thread instantiation, campaign-career, multi-city) are used as stated in the design's dependency table. Generic ambient content keeps this spec testable without them.
- Property tests are required, matching the slice's convention. Each is tagged `// Feature: ambient-world, Property N: <title>` and runs at least 100 times.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.5", "2.1"] },
    { "id": 2, "tasks": ["1.4", "2.2", "3.2", "4.1", "4.2", "4.3", "5.1"] },
    { "id": 3, "tasks": ["2.3", "4.4", "4.5", "4.6"] },
    { "id": 4, "tasks": ["4.8", "4.9", "4.10", "6.1"] },
    { "id": 5, "tasks": ["4.7", "6.2", "6.3", "8.1", "8.2", "8.3"] },
    { "id": 6, "tasks": ["8.4", "8.5", "9.1", "9.2"] },
    { "id": 7, "tasks": ["9.3", "9.4", "10.1", "10.3", "10.4"] },
    { "id": 8, "tasks": ["10.2", "10.5", "10.6", "10.7", "12.1", "12.2"] },
    { "id": 9, "tasks": ["10.8", "12.3", "13.1"] },
    { "id": 10, "tasks": ["13.2"] },
    { "id": 11, "tasks": ["13.3", "14.1"] },
    { "id": 12, "tasks": ["14.2", "15.1", "15.2", "15.3", "15.4", "15.5", "15.6", "15.7"] },
    { "id": 13, "tasks": ["17.1"] },
    { "id": 14, "tasks": ["17.2"] },
    { "id": 15, "tasks": ["17.3", "17.4"] }
  ]
}
```
