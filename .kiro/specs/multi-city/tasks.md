# Implementation Plan: Multi-City Regional Posting

## Overview

This plan builds on the completed slice (`.kiro/specs/tradecraft/tasks.md`; all slice tasks done) in TypeScript. The order is:

1. regional content and config;
2. the region state model, streams and generalised Services;
3. the Region Generator and Regional Verifier;
4. the tiered clock with the ambient-world contract;
5. travel and Borders;
6. Services and liaison;
7. cross-border networks, couriers and cross-city Plots;
8. Jurisdiction, notifications and persistence;
9. the Player View and TUI;
10. evals and performance.

Property numbers refer to this spec's design. "Slice Property N" refers to the slice design.

Follow-on spec order: content-expansion → plot-library → ambient-world → campaign-career → multi-city. content-expansion tasks 1–2 (schemas, Content Kind Registry and loader) are a hard prerequisite; every regional kind is registered through the registry.

Dependencies on other follow-on specs, as interface assumptions:

- **ambient-world:** implements `AmbientSimulator` (defined in task 5.1), including every coupling kind and the tier split, and runs the exported contract test suite. Until it does, the `SliceAmbient` fallback is used.
- **content-expansion:** supplies the namespaced `city` kind, the `service` Service Definitions and real city packs (including `city-trieste`). Until then, the fixture pack's synthetic Cities are used, and `region-core`'s playable template needs the Vienna, Berlin and Trieste city packs.
- **plot-library:** authors Plot templates using the canonical Cross-City Stage Hook schema defined in task 1.1, including the optional `fallback`. `region-core` ships one reference cross-city template.
- **campaign-career:** downstream only. It reads Outcome Record schema 2 and ignores the optional region block (task 12.2).

## Tasks

- [ ] 1. Regional content and configuration
  - [ ] 1.1 Define Zod schemas for the regional content kinds
    - Cover region templates, Intercity Route templates, Borders and Border Posts, Travel Document kinds, Service extensions keyed by content-expansion Service Definition ids (Residency, doctrine overrides, naming and liaison agenda pools), Rivalry tables, Regional Presets (every Req 20.2 field) and the canonical Cross-City Stage Hook extension of the Plot template schema (`city`, `handoff`, `cityRoles`, optional `fallback`).
    - Register every regional kind through content-expansion's Content Kind Registry (`LoadOptions.kinds`) with Field Declarations, rather than adding schemas inside `packages/content` (prerequisite: content-expansion task 1.2).
    - Add an `era` range field to every regional kind.
    - Export JSON Schemas.
    - _Requirements: 16.1, 16.5, 20.2, 10.1, 1.5_
  - [ ] 1.2 Extend the pack loader with regional cross-reference checks
    - Resolve region template City slots against namespaced `city` definitions, and check route Terminals, Border Post Services, Jurisdiction keys and hook City roles.
    - Include regional packs in the Content Manifest.
    - Report every failure as a `ContentError`.
    - _Requirements: 16.2, 16.4_
  - [ ] 1.3 Author the fixture pack and the `region-core` pack data
    - The fixture pack has 4 synthetic Cities with Terminals and Sector Lines, routes in all four Travel Modes, Services of every kind, a Rivalry table, and one cross-city Plot template.
    - `region-core` has the `central-1953` region template (Vienna hub, Berlin, Trieste) with era date 1953, inside all three cities' Period Windows (Vienna 1945–1955, Berlin 1948–1961, Trieste 1947–1954), its Service extensions over content-expansion Service Definitions, Borders, document kinds, Regional Presets and one reference cross-city Plot template.
    - _Requirements: 16.3, 16.6_
  - [ ] 1.4 Extend the Slice Property 23 generators with regional kinds and corruptions
    - Cover a dangling City reference, an unknown Terminal, a hook role with no route, and a missing Regional Preset field.
    - **Validates: Requirements 16.1, 16.2, 16.4**
  - [ ] 1.5 Add the `region` section to the scenario config schema
    - Add `template`, `stationModel` and `overrides`.
    - Resolve the Regional Preset by Difficulty Preset id and deep-merge the overrides.
    - Report errors with file and field path.
    - Add example-based tests for representative bad fields.
    - _Requirements: 20.1, 20.3_

- [ ] 2. Region state model, streams and Services
  - [ ] 2.1 Add the region-mode World State types
    - Add `CityState`, `region`, `locationOf`, `transits`, `handoffs`, `travelDocs`, `stations`, `pendingNotices`, and the `city` field on `SimEvent`.
    - Add the new event kinds with their fixed visibility, and the `liaison` Claim source.
    - Add the branded truth fields (Watch List, document quality, Liaison Reliability, Penetration).
    - Keep the slice types and code path when `region` is unset.
    - _Requirements: 1.6, 12.1, 12.4_
  - [ ] 2.2 Implement the regional PRNG stream layout
    - Add the region stream `derive(seed, 0x70000)` (block `0x70000`–`0x7FFFF` in the slice PRNG stream registry), the per-City core, noise and daily streams, and the saved per-City Spine and Ambient `PrngState`s, as in the design table.
    - Unit-test that the derivation is stable.
    - _Requirements: 1.3_
  - [ ] 2.3 Generalise the slice Hostile Service into `services: Record<ServiceId, ServiceState>`
    - Add Service Kinds, Residencies, per-Service beliefs and Cover Suspicion, and the `RivalryEdge` table.
    - Slice mode maps to a single hostile Service.
    - Slice tests must pass unchanged.
    - _Requirements: 6.1, 6.2, 6.6_

- [ ] 3. Region Generator and Regional Verifier
  - [ ] 3.1 Implement the region-stream generation steps
    - Bind the region template's Cities and era dates.
    - Build the Intercity Routes, Border Posts, Services and Residencies, the Rivalry table and the Jurisdiction map.
    - Choose an eligible Plot template, bind its City roles, and create a Cell per touched City and a Plot leader.
    - _Requirements: 1.1, 1.5, 6.1, 10.1, 15.1_
  - [ ] 3.2 Implement the per-City generation and regional organisations
    - Run the slice worldgen steps scoped per City on the City core streams, enforcing the Principal NPC caps (at most 22 per City and 48 per Region).
    - Build the Regional Station or per-City Stations, the Outstations, mole placement, Courier Lines for Handoffs, and Liaison Service Knowledge Slices.
    - Set Handoff stage deadlines to at least the producer deadline plus the shortest Transit.
    - Extend the Starting Brief with Papers, known Cities, known routes and known Liaison Services.
    - _Requirements: 1.1, 1.4, 4.1, 5.1, 5.2, 5.6, 10.3_
  - [ ] 3.3 Implement the Regional Verifier
    - Add the new node kinds and the travel, Terminal, Carriage, liaison, remote-tasking and Courier Line edges, with Papers satisfiability.
    - Require disjoint paths that share no NPC, Channel or Liaison Service.
    - Check Jurisdiction-permitted success reachability.
    - Retry with derived seeds, and raise a `GeneratorError` at the attempt limit.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 5.6_
  - [ ] 3.4 Run noise per City on the noise streams, then re-verify the full Region
    - Include per-City Noise Traffic.
    - _Requirements: 9.5, 14.4_
  - [ ] 3.5 Write the property test for regional determinism and stream independence
    - **Property 1: Regional determinism and stream independence**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 6.3, 10.1**
  - [ ] 3.6 Write the property test for slice compatibility
    - **Property 2: Slice compatibility**
    - **Validates: Requirements 1.6**
  - [ ] 3.7 Write the property test for regional solvability
    - **Property 6: Regional solvability**
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.5, 4.1**

- [ ] 4. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Region clock and Fidelity Tiers
  - [ ] 5.1 Define the ambient-world contract
    - Define the `AmbientSimulator` interface and the `AmbientCoupling` union, including the six ambient-world hook kinds (delay-stage, reroute-location, channel-outage, cover-suspicion-delta, informant-report, detection-bonus) alongside location-closed, crowd-modifier and route-delay.
    - Implement `applyCouplings` for every kind, with ambient-world's caps.
    - Implement the `SliceAmbient` fallback adapter.
    - Export an ambient contract test suite (coupling tier independence for every kind, tier-independent player-concerning memory, gossip and Informant state, disclosure preservation, no Spine writes outside couplings).
    - Add a path-dependent reference simulator for tests.
    - _Requirements: 11.3, 11.4, 11.6, 11.8_
  - [ ] 5.2 Implement the Region Clock
    - Run `spineTick` per City in index order on the Spine streams.
    - The tier manager sets the Current City to full and everything else (and everything during Transit) to coarse.
    - Apply couplings at both tiers.
    - Run the day-boundary Service ticks in Service id and City order.
    - Run Arrival Reconciliation with Disclosed Facts before the arrival Fact Lines.
    - Add the debug-build `AmbientContractError` check.
    - _Requirements: 6.3, 11.1, 11.2, 11.5, 11.7_
  - [ ] 5.3 Write the property test for Spine tier equivalence
    - **Property 3: Spine tier equivalence**
    - **Validates: Requirements 11.2, 11.4, 3.8**
  - [ ] 5.4 Write the property test for bounded Ambient divergence on arrival
    - Use the path-dependent reference simulator.
    - **Property 4: Bounded Ambient divergence on arrival**
    - **Validates: Requirements 11.5, 11.6**

- [ ] 6. Travel, Borders and Papers
  - [ ] 6.1 Implement intercity travel
    - Implement `quote` and `resolve` for `depart`.
    - Implement Transits, Carriage Locations with traveller lists, and talk, approach, surveil and wait in the Carriage.
    - Handle weather and Service cancellations with refunds.
    - Move NPCs only by Departures in `spineTick`, with `locationOf` updates.
    - Produce Terminal surveillance Observations.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 12.1, 12.3_
  - [ ] 6.2 Implement the pure `borderCheck`
    - Check document validity, compute the suspicion score, draw a single outcome, and run the item search.
    - Derive the Watch List from the Controlling Service's beliefs.
    - Add fixed Fact Line templates per outcome.
    - Cover Sector Line checks, and NPC checks on the departure City's Spine stream.
    - Implement the detention, seizure and Cable effects.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_
  - [ ] 6.3 Implement Travel Documents
    - Implement the `request-papers` Cable (delay, cost, quality by Standing), `apply-visa` at consulates, and documents for Assets.
    - Track document validity windows.
    - Add a Player View projection of held Papers without quality.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [ ] 6.4 Write the property test for cross-City truth consistency
    - **Property 5: Cross-City truth consistency**
    - **Validates: Requirements 2.5, 2.6, 12.1, 12.2, 12.3, 12.4**
  - [ ] 6.5 Write the property test for Border Check determinism and monotonicity
    - **Property 9: Border Check determinism and monotonicity**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.9**
  - [ ] 6.6 Write the property test for intercity travel accounting
    - **Property 10: Intercity travel accounting**
    - **Validates: Requirements 2.2, 2.3, 2.4**
  - [ ] 6.7 Write unit tests for visas, the contraband search, Sector Line checks and detention
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 4.3_

- [ ] 7. Services, Rivalry and Liaison
  - [ ] 7.1 Implement the per-Service daily ticks
    - Run the ticks per Residency, with Local Security Service detection and public arrests.
    - Deliver `share`-edge beliefs after their delay.
    - Implement rival competition and exposure.
    - Implement per-Service Cover Suspicion, the burn rule for Hostile Services, and Persona Non Grata with forced expulsion and the all-countries game end.
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_
  - [ ] 7.2 Implement the Liaison Exchange
    - Implement `liaison-request` through `liaisonAnswer` (Knowledge Slice, agenda, reliability, trust cap), delivering Claims with source `liaison` and `ClaimTruthRecord`s.
    - Implement `liaison-share` with trust changes and Penetration relay through `ingestFeed`.
    - Implement trust decay and border crossing records.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [ ] 7.3 Write the property test for liaison truth isolation
    - **Property 7: Liaison truth isolation**
    - **Validates: Requirements 4.5, 7.1, 7.2, 7.6**
  - [ ] 7.4 Write the property test for the shared-intelligence leakage bound
    - **Property 8: Shared-intelligence leakage bound**
    - **Validates: Requirements 5.6, 6.2, 6.4, 7.4**
  - [ ] 7.5 Write unit tests for Persona Non Grata expulsion, rival exposure arrests and liaison trust changes
    - _Requirements: 6.5, 6.8, 6.9, 7.5_

- [ ] 8. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Cross-border networks, Courier Lines and cross-City Plots
  - [ ] 9.1 Implement remote Asset operations
    - Implement remote tasking through Contact Channels with Communication Latency, and result delivery by reporting Channel.
    - Implement Asset travel tasks with Border Checks and per-City access profiles.
    - Track per-Service Exposure and detection.
    - Implement `exfiltrate`, with detention handled by Controlling Service doctrine.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [ ] 9.2 Implement Courier Lines and reception
    - Run courier Channels on Departures, with courier Border Checks and seizure as a delivery seizure.
    - Implement courier intercepts in Carriages and at Terminals with detection.
    - Add radio reception sets and region-wide numbers broadcasts.
    - Restrict Outstation intercepts to their City's reception.
    - _Requirements: 5.3, 9.1, 9.2, 9.3, 9.4_
  - [ ] 9.3 Implement Handoffs and Cross-City Stage Hook semantics
    - Create Handoff entities and move carriers on Departures.
    - A requirement is satisfied only on Handoff arrival.
    - Count disruptions under the key `handoff:<id>`.
    - Follow the reroute order, falling through to `no-reroute`.
    - Emit traces in the origin City, Carriages and the destination City.
    - Apply the end conditions for the Cell leader and Plot leader.
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6_
  - [ ] 9.4 Write the property test for Handoff semantics
    - **Property 11: Handoff semantics**
    - **Validates: Requirements 9.2, 10.2, 10.3, 10.4**
  - [ ] 9.5 Extend the Slice Property 17 and 18 generators with Terminals, Carriages and reception sets
    - **Validates: Requirements 2.7, 5.3, 9.4**

- [ ] 10. Jurisdiction and arrests
  - [ ] 10.1 Add the Jurisdiction condition to `quote({ kind: 'arrest' })`
    - Use the published Jurisdiction map and the player-side liaison trust band.
    - Give a reason that lists the Cities where the target was observed.
    - _Requirements: 15.1, 15.2, 15.3, 15.4_
  - [ ] 10.2 Write the property test for Jurisdiction gate independence
    - **Property 13: Jurisdiction gate independence**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4**

- [ ] 11. Regional notifications, Cables and Stations
  - [ ] 11.1 Implement the latency queue
    - Add the latency queue before `notify`, with Transit hold except for Carriage events.
    - Add the new Notification kinds and templates.
    - Publish per-City newspapers, with other Cities' editions available a day later.
    - Add Communication Latency to Cable delays.
    - Allow Directive objectives that name a City.
    - _Requirements: 5.4, 5.5, 13.1, 13.2, 13.3, 13.4, 13.5_
  - [ ] 11.2 Write the property test for regional latency and notification soundness
    - **Property 12: Regional latency and notification soundness**
    - **Validates: Requirements 5.4, 8.1, 8.2, 13.1, 13.3, 13.5**

- [ ] 12. Persistence and Outcome Record
  - [ ] 12.1 Bump the save snapshot version for regional state
    - Save and load every City, Stream, tier, Transit, Service belief and pending Handoff.
    - Slice saves still load in slice mode.
    - Replay applies the per-City streams.
    - _Requirements: 18.1, 18.2, 18.3_
  - [ ] 12.2 Add the optional region block to Outcome Record schema 2
    - Extend plot-library's schema 2 with an optional `region` block; do not change schema 1 or add a schema number.
    - Include the region template, Cities, per-Service Cover Suspicion, Persona Non Grata countries, liaison trust and the surviving Assets' Cities.
    - Validate against the Outcome Record schema.
    - _Requirements: 18.4_
  - [ ] 12.3 Write the property test for regional save, replay and outcome
    - **Property 14: Regional save, replay and outcome**
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.4**

- [ ] 13. Player View, Engine API and TUI
  - [ ] 13.1 Add the regional Player View projections and Engine API methods
    - Projections: region map, departures, Papers, the People view's last known City, and the Case File City filter.
    - API methods: `depart`, `request-papers`, `apply-visa`, `liaison-request`, `liaison-share` and `exfiltrate`.
    - Status shows the City or Transit.
    - _Requirements: 4.5, 17.1, 17.2, 17.3, 17.4_
  - [ ] 13.2 Add the City name and city style sheet to the Narrator scene descriptor
    - Add known City names to the Specifics Guard allowed-name set.
    - _Requirements: 17.5_
  - [ ] 13.3 Build the TUI screens
    - Region map, departures board, papers panel, Carriage scene, and the status bar in Transit.
    - _Requirements: 17.1, 17.3_
  - [ ] 13.4 Write the TUI snapshot tests for the regional screens
    - _Requirements: 17.1, 17.3_

- [ ] 14. Metrics, benchmarks and evals
  - [ ] 14.1 Record regional timings in the metrics log
    - Record generation time, coarse and full advance per City, and reconciliation time.
    - _Requirements: 19.7_
  - [ ] 14.2 Add the `bench` suite in `evals`
    - Measure four-City generation, coarse advance (median and 99th percentile), reconciliation, the 8-phase travel action, heap and 30-day save size against the Req 19 budgets.
    - Scale thresholds by a machine factor in CI.
    - Assert that prompts stay within the token budget.
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6_
  - [ ] 14.3 Add regional eval fixtures and golden replays
    - Fixtures: border secondary inspection, a liaison meeting, and a Carriage conversation.
    - Add one regional golden replay per starter region.
    - Keep the slice golden replays passing.
    - _Requirements: 18.3, 1.6_

- [ ] 15. Final checkpoint - Ensure all tests pass, ask the user if questions arise.

## Notes

- Property-based test sub-tasks are required (not optional), matching the slice's convention.
- Every task references requirements in this spec. "Slice Property N" refers to `.kiro/specs/tradecraft/design.md`.
- Property tests use fast-check with `numRuns ≥ 100` and the tag `// Feature: multi-city, Property N: <title>`.
- Real-city content for `region-core`'s playable template depends on content-expansion. All tests use the fixture pack.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.5", "2.2", "2.3"] },
    { "id": 2, "tasks": ["1.3", "5.1"] },
    { "id": 3, "tasks": ["1.4", "3.1"] },
    { "id": 4, "tasks": ["3.2"] },
    { "id": 5, "tasks": ["3.3"] },
    { "id": 6, "tasks": ["3.4", "6.2"] },
    { "id": 7, "tasks": ["3.5", "3.6", "3.7", "5.2"] },
    { "id": 8, "tasks": ["5.3", "5.4", "6.1"] },
    { "id": 9, "tasks": ["6.3", "6.4", "6.5", "7.1"] },
    { "id": 10, "tasks": ["6.6", "6.7", "7.2"] },
    { "id": 11, "tasks": ["7.3", "7.4", "7.5", "9.1", "10.1"] },
    { "id": 12, "tasks": ["9.2", "10.2", "11.1"] },
    { "id": 13, "tasks": ["9.3", "11.2"] },
    { "id": 14, "tasks": ["9.4", "9.5", "12.1"] },
    { "id": 15, "tasks": ["12.2", "13.1"] },
    { "id": 16, "tasks": ["12.3", "13.2", "14.1"] },
    { "id": 17, "tasks": ["13.3", "14.2"] },
    { "id": 18, "tasks": ["13.4", "14.3"] }
  ]
}
```
