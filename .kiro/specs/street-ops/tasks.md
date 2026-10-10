# Implementation Plan: Street Ops

## Overview

This plan builds the street-ops add-on in TypeScript on top of the Extension Registry, which is built in setting-generalization task 1.2 and consumed here. The order is:

1. add-on packaging and a golden check that a disabled add-on is identical to an absent one;
2. content kinds and the shipped fixture;
3. the street graph and turn options;
4. state, Truth slices and the `street` PRNG stream;
5. Drive Sessions and vehicles;
6. tails, spotting and evasion;
7. checkpoints through multi-city's Border Check seam;
8. passengers and concealment;
9. the Bluff Engine and Story Ledger;
10. service reactions and hooks;
11. Street Knowledge, the Street Map View and the clients;
12. street-data tooling (fetch, build, overrides, attribution, period fidelity);
13. solvability, integration, calibration, evals and documentation.

Property numbers refer to this spec's design. "Slice Property N" refers to the slice design.

Dependencies on other specs, as interface assumptions:

- **setting-generalization:** task 1.2 (Extension Registry) and task 1.3 (sub-phase accounting) are hard prerequisites. The `requires` field on `surveillance-method` is added when setting-generalization task 8.4 lands.
- **multi-city:** the Border Check Extension Seam (multi-city requirement 3.10) is the only way checkpoints attach to borders. Until multi-city is implemented, checkpoint logic is written as pure functions with fixture tests, and wired at task 8.2.
- **content-expansion:** the Content Kind Registry and Field Declarations are a hard prerequisite for every new kind.

## Tasks

- [x] 1. Add-on packaging and the golden disabled check
  - [x] 1.1 Create the `street-ops` add-on bundle and configuration
    - Add `packages/engine/src/lib/street-ops/` and the `AddOn` bundle that registers actions, slices, objective kinds and hooks through the Extension Registry.
    - Add `addOns.streetOps.enabled` and the tuning keys (`ticksPerPhase`, caps, tail-team sizes) to `config/scenario.yaml`, with zod validation and defaults.
    - A disabled add-on registers nothing, and its content kinds load but are never referenced.
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 1.2 Write the golden test that disabled equals absent
    - Run every golden replay, determinism property and recorded model request with the add-on disabled, and compare with a build that does not contain it.
    - Add the same comparison for enabled-but-unused (no street action taken).
    - **Property 1: Disabled equals absent**
    - **Validates: Requirements 1.4, 13.1**

- [x] 2. Content kinds and the shipped fixture
  - [x] 2.1 Register the street-ops content kinds with Field Declarations
    - Register `street-graph`, `vehicle`, `evasion-maneuver`, `tail-profile`, `surveillance-method`, `checkpoint-kind`, `story-template`, `composure-table` and `map-document` through the Content Kind Registry, in packs of role `extension`.
    - Add cross-reference checks: Service Definitions to tail profiles, maneuvers to graph features, checkpoint kinds to Border Check kinds.
    - _Requirements: 2.1, 2.2, 3.1, 14.1_
  - [x] 2.2 Author the shipped Core City street fixture
    - Hand-author the Inner City and Sector Line mini-graph (original work), six vehicles, eight maneuvers, three tail profiles, the Sector Line checkpoint kinds, ten story templates, a composure table and the folded-city-map Document.
    - Mark the fixture as test and demo content. It is not a copy of any real street map.
    - _Requirements: 14.1, 14.2_
  - [x] 2.3 Add an additional small graph for a second city as a fixture
    - Hand-author a Vienna-style mini-graph of a few dozen junctions, to exercise multi-city lookups. It is a fixture, not period-accurate data (see group 12).
    - _Requirements: 2.5, 17.6_

- [x] 3. Street graph engine and turn options
  - [x] 3.1 Implement the street graph model and validator
    - Implement junctions, segments, frontages, one-way and speed attributes, and checkpoint sites in `street-ops/graph`.
    - Validate connectivity, that every frontage resolves to a Location, and that checkpoint sites lie on a border or sector line.
    - Cache the compiled graph by Content Manifest hash.
    - _Requirements: 2.3, 2.4, 2.6, 2.7_
  - [x] 3.2 Implement turn options by relative bearing
    - Compute the legal moves at a junction as relative bearings (ahead, left, right, back where allowed), honouring one-ways and closures.
    - Return a stable order so the same state always lists the same options.
    - **Property 3: Legal moves only**
    - **Validates: Requirements 3.2, 4.1**
    - _Requirements: 4.1, 4.2_
  - [x] 3.3 Write a random valid street-graph generator for property tests
    - Add a fast-check arbitrary that builds connected graphs with frontages and one-ways, used by later properties.

- [x] 4. State, Truth slices and the street PRNG stream
  - [x] 4.1 Define the `street` state and Truth slices
    - Add `ext.street` slices: the player's position and heading, the open Drive Session, Tail Teams (Truth), Street Knowledge (state) and the Story Ledger.
    - Add migrations so older saves load with empty slices.
    - _Requirements: 1.2, 13.2_
  - [x] 4.2 Add the `street` PRNG stream with keyed sub-streams
    - Derive keyed sub-streams (`tail`, `spot`, `checkpoint`, `bluff`) so that adding a draw in one does not move another.
    - Record the stream keys in the Replay log header.
    - **Property 2: Determinism and stream independence**
    - **Validates: Requirements 13.1, 13.2**
    - _Requirements: 13.1, 13.2_

- [x] 5. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Drive Sessions and vehicles
  - [x] 6.1 Implement the Drive Session and the street clock
    - Implement `street-ops.drive.begin`, `.turn` and `.end` actions. A session charges at least one phase in total, and individual steps are zero-phase under the sub-phase accounting of setting-generalization task 1.3.
    - Convert ticks to phases using `ticksPerPhase`, and round the session's total up exactly once, at the end.
    - **Property 4: Time accounting**
    - **Validates: Requirements 4.2, 4.3, 4.4**
    - _Requirements: 4.2, 4.3, 4.4, 4.5_
  - [x] 6.2 Implement vehicles and `vehicle` selection
    - Implement ownership, availability and the vehicle's `spots` (how easily it is recognised).
    - Make fuel, conspicuousness and top speed pure data.
    - _Requirements: 3.2, 3.3, 3.4_
  - [x] 6.3 Gate drive actions through the capability filter and the action catalogue
    - Offer drive actions only when a vehicle is available and the era allows it.
    - Add `describeAction` entries and Phrasebook entries (view-side) for every street action.
    - _Requirements: 3.5, 12.2_

- [x] 7. Tails, spotting and evasion
  - [x] 7.1 Implement Tail Teams and trail-following
    - Implement tail assignment from Service Definitions' tail profiles, trail-following with lag, the hold check, statuses (`on`, `lost-briefly`, `lost`, `handed-off`) and hand-off between teams.
    - Keep `player.tailed` in the slice as the single decision, with Tail Teams as supporting Truth.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 7.2 Implement spotting and Observations
    - Generate Observations (a car that has appeared twice, a pedestrian who mirrors a stop) from true Tail Team state with noise that never creates a false positive.
    - Observations carry no identity and no certainty beyond what the player could see.
    - **Property 6: Observations are true**
    - **Validates: Requirements 6.1, 6.2, 6.4**
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - [x] 7.3 Implement the no-oracle rule for the tail
    - Prove that no Player View field, Phrasebook text, menu ordering or catalogue availability changes depending on whether a tail exists.
    - **Property 7: No oracle for the tail**
    - **Validates: Requirements 6.5, 12.3**
    - _Requirements: 6.5, 12.3_
  - [x] 7.4 Implement evasion maneuvers and surveillance-detection runs
    - Implement maneuvers with `requires` predicates over graph features, their probability of shaking a tail, and the exposure cost when it fails.
    - Implement the SDR as a composed sequence of maneuvers with a final Observation summary.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 7.5 Implement tail hooks into the service reaction pipeline
    - On a lost tail, raise Alert or Search by the Service Definition's escalation rule, through the existing hostile-service hook.
    - _Requirements: 7.6, 7.7, 11.1_

- [x] 8. Checkpoints
  - [x] 8.1 Implement checkpoint kinds and the vehicle check as a pure function
    - Implement search kinds, thoroughness, hours and doctrine flags as data. Implement `vehicleCheck(vehicle, passengers, concealment, kind, draw)` as a pure function.
    - Make detection monotonic in thoroughness and in concealment weakness.
    - **Property 8: Checkpoint monotonicity**
    - **Validates: Requirements 8.2, 8.3, 8.4**
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [x] 8.2 Attach checkpoints through the multi-city Border Check Extension Seam
    - Implement the `BorderExtension` interface from multi-city so a vehicle crossing runs `vehicleCheck`. Until multi-city lands, wire it behind a fixture border and mark the wiring as deferred.
    - Support sector-line checkpoints inside a single city without the seam.
    - _Requirements: 8.5, 8.6, 8.7, 8.8_

- [x] 9. Passengers and concealment
  - [x] 9.1 Implement passengers, concealment and endurance
    - Implement concealment spots from the vehicle's data, passenger endurance (heat, air, time) and the cost of exceeding it.
    - A passenger who exceeds endurance is found or lost, deterministically.
    - **Property 10: Endurance**
    - **Validates: Requirements 9.3, 9.4**
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [x] 9.2 Implement search reach
    - Bound each search by its kind's reach, so that a spot a kind cannot examine is never found by it.
    - **Property 9: Search reach**
    - **Validates: Requirements 9.5, 9.6**
    - _Requirements: 9.5, 9.6, 9.7, 9.8_

- [x] 10. Bluff Engine and Story Ledger
  - [x] 10.1 Implement story templates and the Story Ledger
    - Implement slots, fits and follow-ups, and a ledger that records every claim the player makes, typed (who, where, why, when).
    - Add bookkeeping extraction so a typed answer is filed from free text without the model choosing outcomes.
    - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - [x] 10.2 Implement the bluff resolution
    - Resolve a bluff from the ledger, the composure table, the archetype tags and a `bluff` stream draw. A model may phrase the interrogator's lines. It may not decide the outcome.
    - Make resolution identical whichever phrasing the model returns.
    - **Property 11: Bluff independence**
    - **Validates: Requirements 10.5, 10.6, 10.7**
    - _Requirements: 10.5, 10.6, 10.7_
  - [x] 10.3 Implement ledger consistency checks
    - Flag a contradiction deterministically when a new claim conflicts with a recorded one, and carry it into the next resolution.
    - **Property 12: Ledger consistency**
    - **Validates: Requirements 10.8, 10.9, 10.10**
    - _Requirements: 10.8, 10.9, 10.10_

- [x] 11. Service reactions and hooks
  - [x] 11.1 Implement reaction hooks and notifications
    - Register the hooks that turn exposure from street events into Alert, Search and Notification entries.
    - Make all notifications describe what the player could observe, never the cause.
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 12. Street Knowledge, maps and clients
  - [x] 12.1 Implement Street Knowledge
    - Track which segments and junctions the player has learned (by driving, by Document, by briefing).
    - _Requirements: 16.1, 16.2, 16.3_
  - [x] 12.2 Implement the Street Map View and Player View additions
    - Add `StreetMapView` and the Local Map to `player-view`, projected only from Street Knowledge.
    - Add Player View fields for the open Drive Session and the current junction's options.
    - **Property 15: Map view is a projection**
    - **Validates: Requirements 16.4, 16.5, 16.6, 16.7**
    - _Requirements: 12.1, 16.4, 16.5, 16.6, 16.7_
  - [x] 12.3 Implement the `map-document` kind's effects
    - Reading a map Document reveals its listed segments, subject to Year Range and its declared errors (a map can be wrong).
    - _Requirements: 16.8, 16.9, 16.10_
  - [x] 12.4 Add the TUI Local Map and street commands
    - Render the text Local Map and drive options in the TUI from the Player View only.
    - _Requirements: 12.4_
  - [x] 12.5 Add the web SVG map and drive panel
    - Render the SVG map in the web client. This task is deferred until the web-shell client exists (web-shell group 5), and is written here so the data contract is fixed.
    - _Requirements: 12.5, 16.4_

- [x] 13. Street-data tooling
  - [x] 13.1 Define `config/street-sources.yaml` and the fetch command
    - Define the named-source format (name, URL pattern, licence, attribution text, bounding box). Ship one entry, OpenStreetMap through the Overpass API (ODbL).
    - Implement `street-data fetch <source> --accept-licence` in `content-tools`. The command refuses without the flag, prints the licence, and writes to the git-ignored `packs/street-ops-local/`.
    - _Requirements: 17.1, 17.2, 17.9, 17.10, 17.11_
  - [x] 13.2 Implement the graph builder
    - Convert a fetched extract into a `street-graph` file with simplified junctions, one-ways and frontages bound to Locations by an overrides file.
    - Write the attribution file and record source hashes in the Content Manifest.
    - _Requirements: 17.3, 17.4, 17.5, 17.12, 17.13_
  - [x] 13.3 Implement Period Fidelity checks
    - Warn when a built graph's source year is outside the scenario's Year Range, and support an override file that removes or closes post-period features.
    - Document that modern maps of old cities, such as Vienna, need hand overrides.
    - _Requirements: 17.6, 17.7, 17.8_
  - [x] 13.4 Implement Period Name Sources and the `street-graph period` command
    - Add Period Name Source entries to `config/street-sources.yaml`, starting with the Wien Geschichte Wiki (MediaWiki API, `Topografisches Objekt` records). Fetch only names, dates, predecessor links and coordinates, under the licence-acceptance rule.
    - Resolve each named Segment for a given year by following `Frühere Bezeichnung` links. Write cited overrides, mark streets not yet built, and write a Period Report of unresolved items (no record, overlaps, gaps).
    - Test against recorded fixtures (for example the Universitätsring chain, which overlaps in 1934–1956 and must be reported, not guessed).
    - _Requirements: 17.14, 17.15, 17.16_
  - [x] 13.5 Extend the overrides file
    - Support `rename`, `remove`, `add`, `close`, `reclassify` and `replace-area`, each with a cited source and a confidence (`certain`, `likely`, `inferred`).
    - Apply overrides deterministically, in file order, and reject an override whose target does not exist (except `add`).
    - _Requirements: 17.5, 17.17_
  - [x] 13.6 Add the Verified Area and Period Report coverage
    - Load Segments outside the Verified Area as `unmapped`: no drive choices and nothing drawn on the map.
    - Report confirmed, changed and unchecked shares, and allow `period-checked` only when nothing inside the Verified Area is unchecked.
    - _Requirements: 17.18, 17.19_
  - [x] 13.7 Add Period Imagery Sources and the review-sheet generator
    - Add the City of Vienna OGD layers (war-damage plan about 1946, aerial photo plans 1956 and 1938, general city plan 1912) to `config/street-sources.yaml` with CC BY 4.0 attribution, fetched under the licence-acceptance rule.
    - Implement `street-graph review-sheets`: tile the Verified Area, and write per-tile sheets with modern Segments drawn over each period layer at the same extent.
    - _Requirements: 17.20, 17.21_
  - [x] 13.8 Run the Vienna period pass
    - Fetch OpenStreetMap, the Wien Geschichte Wiki records and the imagery for the Inner City, the Ring, the Danube Canal bridges and the sector-line crossings.
    - Run the name pass, then review every sheet and write cited overrides. Record unreadable differences as open items and resolve them from the records where possible.
    - Build the graph and confirm the Period Report shows no unchecked Segments inside the Verified Area.
    - _Requirements: 17.6, 17.16, 17.18, 17.21_

- [x] 14. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Solvability, integration, calibration and docs
  - [x] 15.1 Verify solvability is unaffected
    - Run the Plot Stage verifier with street-ops enabled and disabled. Both must find two independent paths for every stage.
    - **Property 14: Solvability unaffected**
    - **Validates: Requirements 13.3, 13.4**
    - _Requirements: 13.3, 13.4_
  - [x] 15.2 Prove truth isolation and replay equality
    - Add Truth Fingerprint checks for the street slices at the player-view boundary.
    - Record a full drive, a checkpoint and a bluff, and replay them byte-for-byte.
    - **Property 5: Tail truth never reaches the view**
    - **Validates: Requirements 12.3, 13.1**
    - _Requirements: 12.3, 13.1, 13.2_
  - [x] 15.3 Add replay equality property
    - Replay a generated street session from its Action log and assert identical state.
    - **Property 13: Replay equality**
    - **Validates: Requirements 13.1, 13.2**
    - _Requirements: 13.1, 13.2_
  - [x] 15.4 Calibrate and add performance checks
    - Calibrate tail lag, spotting noise and checkpoint thoroughness against target detection rates, and record them in `docs/street-ops.md`.
    - Assert a Drive Session step completes within the budget on the shipped graph.
    - _Requirements: 14.2, 14.3, 14.4_
  - [x] 15.5 Add evals
    - Add an eval suite for bluff phrasing: the outcome must not change with phrasing, and the model must not leak the tail's presence.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_
  - [x] 15.6 Write documentation
    - Add `docs/street-ops.md`: how to enable it, the content kinds, the street-data fetch workflow and licence prompts, and the period-fidelity caveat.
    - Update the README with an add-ons section.
    - _Requirements: 14.1, 17.8_

- [x] 16. Final checkpoint - Ensure all tests pass, ask the user if questions arise.

## Notes

- Property tests are required sub-tasks. Tag each with `// Feature: street-ops, Property N: <title>`.
- The add-on defaults to disabled. Nothing in the base game, golden replays or recorded model requests may change when it is off (task 1.2 runs on every later change).
- Task 8.2 and task 12.5 are written against interfaces that are not yet implemented (multi-city's Border Check seam and the web client). Their wiring is deferred, and their pure parts are tested here.
- Street data is never committed. It is fetched from named sources with licence acceptance (task 13.1), and outputs are git-ignored. Task 13.8 is the agent-run Vienna period pass: Claude reviews the imagery sheets and writes the overrides.
- No source code has been written in this plan. Task 1.1 depends on setting-generalization tasks 1.2 and 1.3.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["2.3", "3.2", "4.1", "13.1"] },
    { "id": 4, "tasks": ["3.3", "4.2", "12.1", "13.2"] },
    { "id": 5, "tasks": ["6.1", "10.1", "12.2", "13.3"] },
    { "id": 6, "tasks": ["6.2", "7.1", "10.2", "12.3", "13.4"] },
    { "id": 7, "tasks": ["6.3", "7.2", "8.1", "10.3", "12.4", "13.5"] },
    { "id": 8, "tasks": ["7.3", "8.2", "9.1", "11.1", "12.5", "13.6"] },
    { "id": 9, "tasks": ["7.4", "9.2", "13.7"] },
    { "id": 10, "tasks": ["7.5", "13.8"] },
    { "id": 11, "tasks": ["15.1"] },
    { "id": 12, "tasks": ["15.2"] },
    { "id": 13, "tasks": ["15.3"] },
    { "id": 14, "tasks": ["15.4"] },
    { "id": 15, "tasks": ["15.5"] },
    { "id": 16, "tasks": ["15.6"] }
  ]
}
```
