# Implementation Plan: Setting Generalization

## Overview

This plan builds on the completed slice and the follow-on specs already implemented (`.kiro/specs/tradecraft/`, `slice-integration/`, and content-expansion tasks 1–2 at least) in TypeScript. It lifts the fixed 1945–1965 setting into an Era Profile with Capabilities, so that the game can be set in 2020 as well. The order is:

1. an audit of Cold War assumptions, and the Extension Registry that this spec and street-ops share;
2. the Era Profile, Capability gating and the Cold War identity guarantee;
3. the Prompt Frame and Terminology Map;
4. Channel Kinds, the Station Link and opaque Intercepts;
5. the instant-action window;
6. the Digital Trace layer;
7. identity, cover, biometrics and the border;
8. surveillance and tracking hooks;
9. content rules and linting;
10. the reference Contemporary content (Era Pack and a Washington, D.C. City Pack);
11. multi-city integration points;
12. evals, performance and documentation.

Property numbers refer to this spec's design. "Slice Property N" refers to the slice design.

**The Cold War Profile must be the identity.** Every golden replay, determinism property and recorded model request in the repository must pass unchanged under it. Task 1.1 (the audit) and the golden checks in tasks 1.3 and 2.6 come first and run on every later change.

Dependencies on other follow-on specs, as interface assumptions:

- **content-expansion:** tasks 1–2 (schemas, Content Kind Registry, loader) are a hard prerequisite, because every new kind is registered through the registry. The shipped `era-cold-war-early` Era Pack and `EraSchema` are extended here.
- **street-ops:** defines the Extension Registry's shape. This plan builds it (task 1.2) because it is needed first, and street-ops consumes it. The `surveillance-method` kind is defined in street-ops. This spec only adds the `requires` field to it when street-ops lands (task 8.4).
- **multi-city:** not yet implemented. Tasks that touch the Border Check, Travel Documents, air travel and Region Templates are written as pure functions with fixture tests here, and are wired in when multi-city lands (group 11).
- **plot-library:** Plot templates gain an optional `requires` field (task 2.3). Capability-aware discovery-path kinds are added to the verifier (task 4.5).

## Tasks

- [ ] 1. Audit and Extension Registry
  - [ ] 1.1 Audit the repository for Cold War assumptions
    - Search `engine`, `dialogue`, `player-view`, `content`, `tui` and the specs for year literals, setting phrases in prompts, fixed Channel kinds, Cipher assumptions, Cable delays and the Core City start date.
    - Record each finding, its file and the intended replacement (Era Profile field, Capability, Prompt Frame or Terminology key) in `.kiro/specs/setting-generalization/audit.md`.
    - Confirm the Cold War Profile's capability list against the code, and correct the design if the audit differs.
    - _Requirements: 1.2, 1.4, 2.2, 2.6, 7.5_
  - [ ] 1.2 Build the Extension Registry in `engine/extension`
    - Implement `ActionExtension`, `StateSliceExtension`, `TruthSliceExtension`, `ObjectiveKindExtension`, `HookExtension` and the `AddOn` bundle as specified in the street-ops design.
    - Add `ExtensionAction` to the `Action` union with a namespaced `kind`, and add a default branch in `quote` and `resolve` that delegates to the registry. An unregistered kind quotes as not allowed.
    - Add an `ext` map to `WorldState` and to the Truth Store, validated per slice, with a migration that initialises missing slices so older saves load.
    - Keep the view-side half of the bundle (enumerators, describers, Phrasebook) in `player-view` so `engine` imports nothing from it.
    - _Requirements: 7.3, 11.3; street-ops 1.1, 1.2_
  - [ ] 1.3 Add sub-phase accounting to the Turn Pipeline
    - Accept a zero-phase quote only from an action that declares `sub-phase` accounting with its required session open, or from a built-in kind and window allowed by the Era Profile.
    - Reject every other zero-phase result as today.
    - Keep `phase-cost-accounting.spec.ts` passing unchanged.
    - _Requirements: 7.3, 7.4; street-ops 4.4, 4.5_
  - [ ] 1.4 Write the golden test that an empty registry changes nothing
    - Run every golden replay and determinism property with the registry present and nothing registered.
    - **Validates: Requirements 1.4, 11.3**

- [ ] 2. Era Profile and Capabilities
  - [ ] 2.1 Define the Capability set, Era Profile and Cold War Profile
    - Add `CAPABILITIES`, `Capability`, `EraProfile`, `hasCapability` and the built-in `COLD_WAR_PROFILE` constant to `engine/era`.
    - Activate exactly the capabilities the audit confirmed (`cable`, `radio-intercept`, `numbers-broadcast`, `courier`, `dead-drop-physical`, `book-cipher`, `paper-papers`, `physical-surveillance`).
    - Add the Contemporary capability list as data in the reference pack (group 10), not in code.
    - _Requirements: 1.1, 1.3, 2.1, 2.6_
  - [ ] 2.2 Add the `era-profile` content kind and profile resolution
    - Register `era-profile` through the Content Kind Registry with Field Declarations, and accept an `eraProfile` id in an Era Pack's `pack.yaml`.
    - Implement `resolveEraProfile`: the named profile, or `COLD_WAR_PROFILE` when none or only the core pack is loaded.
    - Refuse to start when two Era Packs resolve to different profiles, naming the cities.
    - Record `meta.eraProfile` in the World State, migrate saves without it to `cold-war`, and add the profile id to the Content Manifest so a save under another profile is refused.
    - _Requirements: 1.1, 1.5, 1.6, 11.1, 11.2, 11.3_
  - [ ] 2.3 Add `requires` to content kinds and the capability filter
    - Add an optional `requires: Capability[]` to Channel, Location Type, Technology Item, Travel Document kind, Plot template stage and action-related content kinds.
    - Add `capabilityFilter` to `content-set-build` alongside the year filter, and report each exclusion in the Pack Linter's `draft` profile.
    - Re-check Tag Conformance after filtering and refuse to start on a Required Query shortfall, naming the query.
    - _Requirements: 2.3, 2.4, 2.5, 11.4_
  - [ ] 2.4 Move the default start date into the profile
    - Remove `CORE_CITY_DEFAULT_START_DATE` from `setting.ts` and read the default from `profile.startDate.default`.
    - Keep the draw on the Setting Stream with unchanged inputs, so Cold War seeds draw the same dates.
    - _Requirements: 1.2, 1.3_
  - [ ] 2.5 Add a lint rule that bans year comparisons in the engine
    - Fail the build when `engine/` outside `setting` compares the Game Year or a date to a literal year.
    - Add a test over the source tree.
    - _Requirements: 2.2_
  - [ ] 2.6 Write the property test for Cold War identity
    - Wire the existing goldens, determinism and replay suites to run under the resolved Cold War Profile, including the request-hash of every recorded model call.
    - **Property 1: Cold War identity**
    - **Validates: Requirements 1.4, 11.1, 11.2, 11.3**
  - [ ] 2.7 Write the property test for no year comparisons
    - **Property 2: No year comparisons in the engine**
    - **Validates: Requirements 2.2**
  - [ ] 2.8 Write the property test for capability gating of content
    - **Property 3: Capability gating of content**
    - **Validates: Requirements 2.3, 2.4, 2.5**

- [ ] 3. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Prompt Frame and Terminology Map
  - [ ] 4.1 Add the Prompt Frame and thread it through every static prompt
    - Define `PromptFrame { setting, genre, period }` in the profile.
    - Replace the fixed setting phrases in the Intent Classifier, the Narrator (`live-seams.ts`) and the `voice` prompt builders with Frame values.
    - Make the Cold War Frame reproduce the current strings byte for byte, so recorded request hashes stay valid.
    - Add a snapshot of every static prompt under the Cold War Profile.
    - _Requirements: 7.5_
  - [ ] 4.2 Add the Terminology Map
    - Carry `terms` on the profile and expose it as `GameView.terms`.
    - Make the TUI and the Web Shell render action and view names through it, with fallback to the existing English text.
    - Keep action kind ids unchanged.
    - _Requirements: 7.1, 7.2_
  - [ ] 4.3 Write the property test for the Prompt Frame snapshot
    - **Property 14: Prompt frame snapshot**
    - **Validates: Requirements 7.5**

- [ ] 5. Channels, Station Link and Intercepts
  - [ ] 5.1 Generalise Channel to `ChannelKind`
    - Add `ChannelKind` (latency, opacity, interceptable, trace source, schedule, `requires`) and a `channel-kind` content kind.
    - Define the four existing kinds as built-in definitions with today's parameters, so Cold War behaviour is unchanged.
    - _Requirements: 3.1, 3.2_
  - [ ] 5.2 Parameterise the Station Link
    - Add `StationLinkParams` to the profile and make the `cable` action read the request and reply delays, trace source and interceptability from it.
    - Keep `cable` and its sub-kinds (`trace`, `funds`, `report`) as the action ids.
    - _Requirements: 3.3, 7.2_
  - [ ] 5.3 Add the metadata Intercept and opaque-channel interception
    - Add the `metadata` Intercept variant (parties, time, size band, place).
    - Make `interceptAtStation` produce content Intercepts as today for non-opaque channels and metadata Intercepts for opaque ones, and nothing for `interceptable: none`.
    - File a metadata Intercept as a Case File observation, and never open the Workbench for it.
    - Leave the Cipher Engine and Workbench unchanged.
    - _Requirements: 3.4, 3.6_
  - [ ] 5.4 Add the `device-read` action and device extraction Documents
    - Register `device-read` through the Extension Registry, gated by `device-inspection`, with a quoted cost and risk, a Trace and a plaintext result.
    - Add a device-extraction Document kind and Style Guide hooks.
    - Add an operator-error event, drawn like the existing noise draws, that sends content over a weak channel as a secondary discovery path.
    - _Requirements: 3.5_
  - [ ] 5.5 Make the discovery-path verifier capability-aware
    - Add path kinds for metadata analysis, endpoint compromise, human source, document and surveillance, each with a `requires`.
    - Verify two independent paths per Plot Stage from the active capabilities only, and refuse an opaque plaintext dependency.
    - Filter Plot templates whose stages need an inactive capability.
    - _Requirements: 3.7, 2.3_
  - [ ] 5.6 Write the property test for opaque channels yielding no plaintext
    - **Property 5: Opaque channels yield no plaintext**
    - **Validates: Requirements 3.4, 3.6**

- [ ] 6. Instant actions
  - [ ] 6.1 Add the instant-action window
    - Add `instant { perPhase, kinds }` to the profile, with zero for the Cold War.
    - Add `ext.instant` state, reset each phase, and make the listed kinds quote zero phases while the allowance lasts and one phase after.
    - Run every zero-phase action through the full Turn Transaction so its Traces are recorded and replay is unchanged.
    - _Requirements: 7.3, 7.4_
  - [ ] 6.2 Write the property test for the instant window
    - **Property 13: Instant window**
    - **Validates: Requirements 7.3, 7.4**

- [ ] 7. Digital Trace layer
  - [ ] 7.1 Add the Trace types, store and content kinds
    - Add `Trace`, `TraceSourceId`, the Trace Store in the Truth `ext` slice, and the content kinds `trace-rule`, `legal-authority`, `practice` and `trace-hint`.
    - Define each Trace Source's retention window in content.
    - Add the `trace` PRNG stream family keyed by `(day, serviceId, targetId)`.
    - _Requirements: 4.1, 4.2, 12.1, 12.2_
  - [ ] 7.2 Emit traces from actions and from sampled NPC movement
    - Add a post-resolve `emitTraces` hook in the Turn Pipeline that evaluates the loaded Trace Rules against the action, the Location tags and the player's Practices.
    - Emit NPC movement traces from the day-boundary hooks only for NPCs a Service is interested in, within the per-turn budget.
    - Drop expired Traces at the day boundary.
    - _Requirements: 4.1, 12.1, 12.4_
  - [ ] 7.3 Add Practices and Anomaly Traces
    - Add the instant `practice-set` action, suppression of matching rules, costs, and Anomaly Traces for gaps and pattern breaks.
    - _Requirements: 4.4_
  - [ ] 7.4 Implement `readTraces` and the Service read hook
    - Implement the pure `readTraces` over retention, authority and suspicion thresholds, with the content-weighted joins (co-location, repeat visits, gaps, camera entries, crossings that contradict cover).
    - Add the day-boundary `serviceReadsTraces` hook that feeds the slice's belief functions (Cover Suspicion, Exposure, Watch List).
    - _Requirements: 4.2, 4.3_
  - [ ] 7.5 Add Trace Exposure, hints and the debrief reveal
    - Keep Trace Exposure in the Truth slice.
    - Add `trace-hint` selection by the player's own Practices and recent actions, and expose it in the Player View as qualitative text only.
    - Reveal each read, its Service and its consequence in the debrief.
    - _Requirements: 4.5, 4.6_
  - [ ] 7.6 Make the layer inert under the Cold War Profile
    - Ensure no Trace Rules, no Trace Sources, no hooks with side effects and no PRNG draws when the Capability set lacks them.
    - _Requirements: 4.7, 12.1_
  - [ ] 7.7 Write the property test for trace isolation
    - **Property 7: Trace isolation**
    - **Validates: Requirements 4.5, 4.6, 12.2, 12.3**
  - [ ] 7.8 Write the property test for trace determinism and stream independence
    - **Property 8: Trace determinism and stream independence**
    - **Validates: Requirements 12.1**
  - [ ] 7.9 Write the property test for retention
    - **Property 9: Retention**
    - **Validates: Requirements 4.1, 4.2**
  - [ ] 7.10 Write the property test for practice monotonicity
    - **Property 10: Practice monotonicity**
    - **Validates: Requirements 4.4**

- [ ] 8. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Identity, cover and the border
  - [ ] 9.1 Add Backstop and the open-source check
    - Add `CoverIdentity.backstop` (0 to 3, optional) and `biometric` (`enrolled`, `real`, `none`) fields with Cold War defaults.
    - Implement the pure, monotone `osintCheck` and run it when a Service first meets a new identity.
    - Add Backstop and biometric-enrolment requests to the Station request set, with delay and cost, and show the Backstop as a band in the Player View.
    - _Requirements: 5.1, 5.2, 11.4_
  - [ ] 9.2 Add biometric and device-inspection checks as pure functions
    - Implement `biometricCheck` and `deviceInspection` with strictness thresholds and the secondary-inspection and detention outcomes.
    - Add electronic Travel Document kinds with Capability Requirements as content.
    - Test them standalone with fixtures. They are wired into multi-city's `borderCheck` in group 11.
    - _Requirements: 5.3, 5.4, 5.5, 5.6_
  - [ ] 9.3 Write the property test for Backstop monotonicity
    - **Property 11: Backstop monotonicity**
    - **Validates: Requirements 5.1, 5.2**
  - [ ] 9.4 Write the property test for the biometric match
    - **Property 12: Biometric match**
    - **Validates: Requirements 5.4**

- [ ] 10. Surveillance and tracking hooks
  - [ ] 10.1 Add camera coverage and camera traces
    - Add the `surveillance:cctv` Tag to the Tag Vocabulary and a Trace Rule for entering a covered Location.
    - _Requirements: 6.2_
  - [ ] 10.2 Add trackers and the sweep action
    - Add a Service's tracker placement from Legal Authority and Practices, and the player's `sweep` action with a quoted cost.
    - Make a sweep that finds nothing say "nothing found" and never "none present".
    - _Requirements: 6.4, 6.5_
  - [ ] 10.3 Add plate-reader hooks
    - Define the optional `alpr` flag and the plate-reader Trace and Watch List alert as functions over a Segment, to be wired when street-ops lands.
    - _Requirements: 6.3_
  - [ ] 10.4 Add the `requires` field to Surveillance Methods
    - Add `requires` to the `surveillance-method` kind when street-ops registers it, with physical and radio-car methods for the Cold War and GPS, plate-reader and camera methods for the Contemporary Profile.
    - Until street-ops lands, record this as a pending change in the street-ops task list (task 2.1).
    - _Requirements: 6.1_

- [ ] 11. Content rules and linting
  - [ ] 11.1 Add `until` to Technology Items and the two-way anachronism check
    - Add `until` to the Technology Item schema and group Anachronism Entries by Era Profile.
    - Add the Pack Linter rule that flags a document naming an item after `until` unless the context is marked historical, alongside the existing `introduced` rule.
    - _Requirements: 8.1_
  - [ ] 11.2 Add the real-brand list, public-figure check and contemporary sensitivity terms
    - Make the Contemporary Real-Person Blocklist category-level and check names against a maintained list of public figures.
    - Add the `real-brand` list for trademarks, platforms, parties, candidates and agencies.
    - Extend the Sensitivity Term List for contemporary terms.
    - _Requirements: 8.3, 8.4, 8.5_
  - [ ] 11.3 Add the US Locale and the contemporary Style Guide templates
    - Add the US Locale (date, currency, honorifics, address, local terms, Specifics Guard allowlist additions).
    - Add Fact Line and Document templates for messages, email, call records and device extractions.
    - _Requirements: 8.2, 8.6_
  - [ ] 11.4 Write the content test for anachronism in both directions
    - **Property 15: Anachronism both ways**
    - **Validates: Requirements 8.1**

- [ ] 12. Reference Contemporary content
  - [ ] 12.1 Author the `era-contemporary-2020` Era Pack
    - Add the `era`, `era-profile`, technology catalogue with fictional brands, document styles, cipher conventions for non-opaque channels, Channel Kinds, Trace Rules, Trace Sources, Practices, Legal Authorities, Trace hints, terminology, lists and public texts.
    - Use only fictional brands, platforms and agencies.
    - _Requirements: 9.1, 9.4_
  - [ ] 12.2 Author the minimal Washington, D.C. City Pack
    - Add districts, Locations, Routes, local organisations and Cover Identities for a small Washington, D.C. proof city, meeting Tag Conformance.
    - Add fictional Service Definitions: a domestic counterintelligence service, a metropolitan police service and a foreign Hostile Service.
    - Use real landmarks and neighbourhoods only. No real office-holder, agency, party or political event.
    - _Requirements: 9.2, 9.4_
  - [ ] 12.3 Teach the release lint profile to accept the proof pack's declared targets
    - Accept the pack's declared lower quantity targets, and name them in the Coverage Report.
    - _Requirements: 9.5_
  - [ ] 12.4 Verify the Contemporary reference world
    - Generate worlds over the preset and seed corpus and run discovery-path verification.
    - Add a scripted Contemporary game covering a message, a trace read and a biometric mismatch, with a replay.
    - _Requirements: 9.3, 12.3_
  - [ ] 12.5 Write the property test for capability gating of mechanics
    - **Property 4: Capability gating of mechanics**
    - **Validates: Requirements 2.1, 2.2, 4.7, 12.1**
  - [ ] 12.6 Write the property test for solvability under the profile
    - **Property 6: Solvability under the profile**
    - **Validates: Requirements 3.7, 9.3**

- [ ] 13. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. multi-city integration points
  - [ ] 14.1 Record the Era Profile hooks in multi-city's tasks and design
    - Add to multi-city's task list: the Region Template names the Era Profile and every City shares one Game Year; air travel emits booking Traces and uses electronic Travel Documents; `borderCheck` calls the biometric and device checks and the Border Check Extension Seam; Cable and Courier Lines use the Station Link and Channel Kinds.
    - Add the matching notes to multi-city's design.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
  - [ ] 14.2 Wire the integration when multi-city lands
    - When multi-city's Region Generator and Border Check exist, implement the hooks recorded in task 14.1 and add a Contemporary region fixture (two Cities, one flight) to its test suite.
    - Mark this task deferred until multi-city's tasks 3 and 6 are complete.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6_

- [ ] 15. Evals, performance and documentation
  - [ ] 15.1 Add prompt-frame evals
    - Run the Intent Classifier and Narrator with the Contemporary Prompt Frame on a small phrase set and check that nothing in the output assumes the Cold War.
    - _Requirements: 7.5_
  - [ ] 15.2 Benchmark the per-turn trace budget
    - Measure trace emission and the day-boundary read on the largest generated Contemporary world, and confirm the slice's per-turn budget.
    - _Requirements: 12.4_
  - [ ] 15.3 Update the README and add an authoring guide for new eras
    - Document Era Profiles, Capabilities, Channel Kinds, Trace Rules and Practices, how to add an era, and the real-world content rules.
    - Record in the README that the setting is selectable, and which profiles ship.
    - _Requirements: 1.1, 2.1, 8.3, 8.4_

- [ ] 16. Final checkpoint - Ensure all tests pass, ask the user if questions arise.

## Notes

- Property-based test sub-tasks are required (not optional), matching the slice's convention.
- Every task references requirements in this spec, or names the other spec. "Slice Property N" refers to `.kiro/specs/tradecraft/design.md`.
- Property tests use fast-check with `numRuns ≥ 100` and the tag `// Feature: setting-generalization, Property N: <title>`.
- Group 1's golden check and task 2.6 are the guard for the whole spec. Run them after every group.
- Task 14.2 is deferred until multi-city is implemented. Everything else can be completed and tested with the Cold War content and the Contemporary reference pack.
- No code was written when this plan was authored. The audit (task 1.1) may change the capability list and the design.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["1.4"] },
    { "id": 4, "tasks": ["2.1"] },
    { "id": 5, "tasks": ["2.2"] },
    { "id": 6, "tasks": ["2.3", "4.1", "6.1"] },
    { "id": 7, "tasks": ["2.4", "2.8", "4.2", "5.1", "6.2", "7.1", "9.1", "11.1"] },
    { "id": 8, "tasks": ["2.5", "2.6", "4.3", "5.2", "7.2", "9.2", "11.2"] },
    { "id": 9, "tasks": ["2.7", "5.3", "7.3", "9.3", "10.1", "11.3"] },
    { "id": 10, "tasks": ["5.4", "7.4", "9.4", "10.2", "11.4", "12.1"] },
    { "id": 11, "tasks": ["5.5", "7.5", "10.3", "12.2", "15.1"] },
    { "id": 12, "tasks": ["5.6", "7.6", "10.4", "12.3"] },
    { "id": 13, "tasks": ["7.7", "12.4"] },
    { "id": 14, "tasks": ["7.8", "12.5", "14.1", "15.2", "15.3"] },
    { "id": 15, "tasks": ["7.9", "12.6", "14.2"] },
    { "id": 16, "tasks": ["7.10"] }
  ]
}
```
