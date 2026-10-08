# Implementation Plan: Plot Library

## Overview

This plan builds on the completed slice (`.kiro/specs/tradecraft/`). It extends the content schemas first, then the truth layer, the plot generation pipeline (bind, expand, instantiate, select, verify), runtime behaviour (branches, outcomes, Off-map Stages), Side Threads and the debrief. It then builds the Plot Lab and uses it to author and check the `coldwar-plots` Library Pack. Property numbers refer to this spec's design. Template YAML counts as code and data.

Follow-on spec order: content-expansion → plot-library → ambient-world → campaign-career → multi-city. content-expansion tasks 1–2 (schemas, Content Kind Registry and loader) are a hard prerequisite; in particular content-expansion task 1.2 (the Content Kind Registry) must be done before task 1.1 of this plan.

## Workable adaptation

The slice generator (`generatorVersion` 0.7.0) stays on schema-1 `generatePlot` unless a scenario sets `plotSelection.enabled`. Template Schema v2 is recognised inside existing `plots/` and `side-threads/` files (`templateSchema: 2`) and stored in `plotTemplatesV2` / `sideThreadTemplatesV2`, because the Content Kind Registry does not let a later registration shadow `plot-template`. Difficulty knobs are optional on the preset so the pinned core preset comparison stays valid; `libraryPreset()` applies the design defaults. New library templates bind existing core Required Queries plus a city-independent `materiel` facet. Plot Lab waits out a passive run and writes Markdown and CSV. The CI job runs `plot-lab check --seeds 50` against the core city. The oracle reads the truth store, plays the cheapest success condition through `quote` and `resolve`, and reports the fraction of seeds disrupted before the final stage. Debrief coherence checks the timeline, twist propositions and that every plot appears. Thresholds load from the defaults or a YAML file, and a miss exits non-zero naming the template, city, preset and seeds. When `scenario.plotSelection.enabled` is set, selection runs on `derive(seed, 0x31000)`, library plots and lookalikes are stored on the world, and `advanceWorld` resolves their branches, off-map stages and outcomes. The slice `generatePlot` call still runs, so a core-only load keeps the golden replays. Identification is a pure quote gate.

The tasks assume these interfaces from parallel specs:

- From content-expansion: the Content Kind Registry, the Tag Vocabulary (`facet:value` Tags, Tag Queries, Required Queries), the setting step and `CityView`. Until the setting step and real City Packs land, tasks use the test-city fixture from task 3.1.
- From multi-city: the canonical Cross-City Stage Hook schema (`city`, `handoff`, `cityRoles`, optional `fallback`). This spec implements the single-city semantics.
- From ambient-world: callers of the Side Thread API.
- From campaign-career: calls to `select` with a Template History built from Outcome Record schema-2 `plots[]`.

## Audit (7 Oct 2026)

Every box was re-checked against the code. A box stays checked only when the task is done as written, including the property-test convention in the Notes; otherwise it is unchecked with a note saying what is missing. A note on a checked task points at wiring that another task still owes. With `plotSelection.enabled`, `world.plot` is the library Primary, so the clock executes its on-map stages, and the library step still resolves branches, off-map stages and outcomes. Generation consistency-checks the selection, verifies each branch configuration, and reseeds after an unresolvable conflict or an uncoverable stage.

## Tasks

- [x] 1. Extend the content schemas and loader
  - [x] 1.1 Define the Template Schema v2 Zod schemas
    - Cover params (Tag Query, `exclude`, `group`, `mandatory`, `fallback`), role slots with Tag Queries, stages, Optional Stages, Branch Points with Alternatives and Branch Conditions, Sub-Plot embeds (including `{ $any: <Tag Query> }`), `subOnly`, Cell Specs and Cutouts, Twist, Outcome Conditions, concurrency, per-preset `difficulty`, `minPreset`, `era`, `selection`, `secondary`, Cross-City Hooks in the multi-city schema (`cityRoles`, stage `city`, `handoff`, `fallback`), and the Side Thread `mimics` and `spawn` fields, plus the optional pass-through `ambient.spawn` block (`{ metric, above, tags? }`, shape-checked only and carried unchanged on the loaded template for ambient-world).
    - Register the template and `plot-item` kinds through content-expansion's Content Kind Registry (`LoadOptions.kinds`) with Field Declarations (`tagQueries` for every param, role-slot and `$any` query; `tags` for item pools; text and template fields), instead of adding schemas inside `packages/content`.
    - Gate the v2 fields on `contentSchema: 2` in `pack.yaml`.
    - Export the JSON Schemas.
    - _Requirements: 1.1, 2.1, 3.1, 3.3, 4.1, 5.1, 6.1, 7.1, 10.1, 13.1, 15.1, 15.2, 15.3, 15.7, 16.1, 16.6, 21.1_
  - [x] 1.2 Implement the schema-1 normaliser
    - Map slice templates to v2 with one Cell, all stages required, no branches and the default outcomes.
    - _Requirements: 1.2, 10.2_
  - [x] 1.3 Extend predicate definitions and Proposition
    - Add the optional `cardinality` field and the `instrument` argument kind to predicate definitions, and `Proposition.instrument`.
    - Add the `custody-chain` evaluator kind to the enum.
    - Extend the renderers (`{instrument}`), field-message encoding and parsing, and the derived extractor schema.
    - _Requirements: 9.1, 11.2, 11.4_
  - [x] 1.4 Extend the Difficulty Preset and scenario schemas
    - Add `secondaryPlots`, `twistProbability`, `maxCells` and `lookalikeShare` with the design's defaults.
    - Add the optional `plotSelection` block (`archetypePenalty`, `variantPenalty`, `historyWindow`) to `ScenarioConfig`.
    - _Requirements: 13.3, 14.3_
  - [x] 1.5 Implement the v2 static checks in the loader
    - Implement every row of the design's static-check table except the proper-noun check: Tag Queries (vocabulary Tags, facet applicability, 1–3 Tags, mandatory queries equal to Required Queries, Required-Query fallbacks for non-mandatory params, item queries with an item Binder), hook fields, cycles, cross-branch `requires`, the 32-configuration cap, the `default` Alternative, Sub-Plot recursion, depth and mapping, `subOnly` usage, Cells and Cutouts, a single Twist, facade and every-configuration success references, and Off-map outcome stages.
    - Emit `ContentError`s with pack, file and path.
    - _Requirements: 1.4, 2.2, 2.5, 2.6, 2.7, 3.5, 4.4, 5.3, 5.4, 6.1, 7.1, 10.6, 10.7, 16.1, 16.4_
  - [x] 1.6 Implement the proper-noun check
    - Tokenise literal template text outside slots.
    - Allow sentence-initial tokens, `allowedProperNouns` and the common-word allowlist.
    - _Requirements: 21.2, 21.3_
  - [x] 1.7 Write the property test for v2 content validation
    - **Property 1: v2 content validation**
    - **Validates: Requirements 1.1, 1.4, 2.2, 2.5, 3.5, 4.4, 5.3, 7.1, 10.6, 10.7, 15.1, 16.4**
  - [x] 1.8 Write the property test for the instrument round-trip
    - **Property 14: Instrument round-trip**
    - **Validates: Requirements 11.4**
  - [x] 1.9 Write unit tests for the proper-noun check
    - Test sentence-initial tokens, slot contents, allowlisted institutions and a rejected literal person name.
    - _Requirements: 21.2_

- [x] 2. Extend the truth layer
  - [x] 2.1 Implement the `custody-chain` evaluator
    - Register `custody-chain` in the evaluator registry, with item origins set at instantiation.
    - Record seizures (Slice Req 24.7) as `HANDS_OVER(holder, org:station, item)`.
    - _Requirements: 11.2_
  - [x] 2.2 Write the property test for the custody chain
    - **Property 13: Custody chain**
    - **Validates: Requirements 11.2**
  - [x] 2.3 Implement the Consistency Checker
    - Detect Functional Predicate conflicts and NPCs double-booked in a phase across routines, Plots and Side Threads.
    - Reschedule by precedence (Primary, Secondary by id, Side Threads) within stage deadlines, and report unresolvable conflicts.
    - _Requirements: 9.2, 9.3, 9.4_

- [x] 3. Build the plot generation pipeline
  - [x] 3.1 Consume content-expansion's `CityView` and add a tagged test-city fixture
    - Import the `CityView` type from content-expansion (content-expansion design, CityView); do not define a separate interface.
    - Keep a fallback adapter that presents the slice's core city with a `facet:value` Tag overlay and the core Required Queries as a `CityView`, used by tests and the Plot Lab until content-expansion's setting step and tagged City Packs are available.
    - _Requirements: 2.3_
  - [x] 3.2 Implement the Binder
    - Bind params in declared order from `cityView.binders(kind, query)`, with candidates sorted by id, `exclude` and distinctness-group filters (access through `access:` Tags), the `fallback` query for non-mandatory params, and draws on the core stream.
    - Implement `bindable()` as a draw-free dry run, and return the unbound parameter and its Tag Query.
    - _Requirements: 2.3, 2.4, 2.7_
  - [x] 3.3 Write the property test for binding soundness
    - **Property 3: Binding soundness**
    - **Validates: Requirements 2.3, 2.4**
  - [x] 3.4 Implement the Expander
    - Expand Sub-Plots depth-first with namespaced ids.
    - Resolve Static Branches and include Optional Stages to the clamped target, applying preset overrides.
    - In single-city mode, bind the Local City Role (first role in `cityRoles`) to the game's city, replace stages of other City roles with their `fallback` or mark them Off-map, and turn `handoff`s between Local City Role stages into `requires` edges.
    - Preserve `cityRoles` and each stage's `city`, `handoff` and `fallback` in the expanded plot.
    - Compute the Variant Key.
    - _Requirements: 3.2, 3.4, 3.6, 5.2, 16.2, 16.5, 16.6_
  - [x] 3.5 Write the property test for expansion well-formedness
    - **Property 4: Expansion well-formedness**
    - **Validates: Requirements 3.2, 3.4, 3.6, 5.2**
  - [x] 3.6 Implement the Instantiator and `PlotStateV2`
    - Create Cell orgs, role holders from archetype tags, compartmented knowledge (with contingent knowledge of Alternatives) and deadlines.
    - Implement the three Twist kinds with the Twist-probability draw, item origins and Secondary metadata.
    - Add `WorldState.plots`, with `plot` aliasing the Primary.
    - Make abort accounting per Plot, skipping facade disruptions.
    - Raise the Principal NPC cap to 22.
    - _Requirements: 3.6, 6.2, 6.3, 6.4, 6.5, 7.2, 7.3, 7.4, 8.3, 13.4_
  - [x] 3.7 Write the property test for schema-1 backward compatibility
    - **Property 2: Schema-1 backward compatibility**
    - **Validates: Requirements 1.2, 1.3, 10.2**
  - [x] 3.8 Write the property test for Cell compartmentation
    - **Property 7: Cell compartmentation**
    - **Validates: Requirements 6.2, 6.3, 6.4**
  - [x] 3.9 Write the property test for Twist instantiation
    - **Property 8: Twist instantiation**
    - **Validates: Requirements 7.2, 7.4, 13.4**

- [x] 4. Integrate selection and generation
  - [x] 4.1 Implement the Selector
    - Check eligibility (`subOnly`, era, `minPreset`, `maxCells`, bindable, excluded).
    - Exclude templates from the last 2 history entries, and apply archetype and Variant Key penalties.
    - Draw the Primary, then concurrency-compatible Secondaries of distinct archetypes, and compute `historyHash`.
    - _Requirements: 5.4, 8.1, 8.2, 13.2, 14.1, 14.2, 14.3, 21.1_
  - [x] 4.2 Rework the World Generator order and streams
    - Run selection after content-expansion's setting step (Setting Stream; with the Core City, its Core City Path generates the city first). Add no `city` stream.
    - Add the `select` stream `derive(seed, 0x31000)` (block `0x31000`–`0x31FFF` in the slice PRNG stream registry), reselection on `derive(thatSeed, k)`, and the new generation order.
    - Run instantiation for Primary then Secondaries, with consistency checks and the retry and reselection loop with logging.
    - Record `meta.selection` (with the optional selection context). Use the single `generatorVersion` bump declared by content-expansion rather than a separate bump, and re-record golden replays.
    - _Requirements: 8.1, 9.4, 12.5, 14.2, 14.4, 14.5_
  - [x] 4.3 Implement Verifier v2
    - Enumerate Branch Configurations, build the learnability graph over the combined world, and add per-configuration trace edges.
    - Check Active Stages, Twist Propositions and the mole, and skip Off-map Stages.
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  - [x] 4.4 Write the property test for selection soundness
    - **Property 17: Selection soundness**
    - **Validates: Requirements 5.4, 8.1, 8.2, 13.2, 14.1, 14.2, 14.3, 21.1**
  - [x] 4.5 Write the property test for city invariance under selection
    - **Property 18: City invariance under selection**
    - **Validates: Requirements 14.4**
  - [x] 4.6 Write the property test for cross-plot consistency
    - **Property 12: Cross-plot consistency**
    - **Validates: Requirements 8.3, 9.2, 9.3, 9.4**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, including the slice's suite and re-recorded golden replays. Ask the user if questions arise.

- [x] 6. Implement runtime behaviour
  - [x] 6.1 Implement Runtime Branch resolution in `Clock.advance`
    - Evaluate the condition kinds (with `negate`), using a shared `weighted` draw on the runtime stream.
    - Schedule the chosen Alternative and emit a hidden `branch-resolved` event.
    - _Requirements: 4.2, 4.3, 4.6_
  - [x] 6.2 Integrate reroute with Alternatives
    - On a `reroute` draw, switch to an unused sibling Alternative before the slice's reroute rules.
    - _Requirements: 4.5_
  - [x] 6.3 Write the property test for runtime branch determinism
    - **Property 5: Runtime branch determinism**
    - **Validates: Requirements 4.2, 4.3**
  - [x] 6.4 Write the property test for reroute through Alternatives
    - **Property 6: Reroute through Alternatives**
    - **Validates: Requirements 4.5**
  - [x] 6.5 Implement the Outcome Evaluator
    - Evaluate every Outcome Condition kind per Plot inside the Turn Transaction, success first.
    - When the Primary resolves, set `ended`. When a Secondary resolves, apply the Standing change and, on Hostile success, deliver a damage-report Cable from the template's document template.
    - _Requirements: 7.3, 8.4, 8.5, 8.6, 10.2, 10.3_
  - [x] 6.6 Implement identification report Cables
    - Add the `report.identify` request, a `quote` gate from `evidenceCount`, and truth-side resolution.
    - Apply the wrongful-arrest penalty for a wrong report, with an identical acknowledgement Cable either way.
    - _Requirements: 10.4, 10.5_
  - [x] 6.7 Implement Off-map Stage execution
    - Execute Off-map Stages at their deadline as a hidden `stage-executed` event with no traces, satisfying successors and any `handoff` whose `from` stage is Off-map.
    - _Requirements: 16.3, 16.5_
  - [x] 6.8 Write the property test for outcome and abort accounting
    - **Property 10: Outcome and abort accounting**
    - **Validates: Requirements 7.3, 8.4, 8.5, 8.6, 10.3**
  - [x] 6.9 Write the property test for truth-blind identification
    - **Property 11: Identification is truth-blind**
    - **Validates: Requirements 10.4, 10.5**
  - [x] 6.10 Write the property test for the Off-map fallback
    - **Property 16: Off-map fallback**
    - **Validates: Requirements 12.4, 16.2, 16.3**
  - [x] 6.11 Write the property test for Twist and branch isolation
    - **Property 9: Twist and branch isolation**
    - **Validates: Requirements 7.5**

- [x] 7. Extend Side Threads
  - [x] 7.1 Implement the Side Thread Instantiation API and the Noise Generator integration
    - Implement `instantiateSideThread` with spawn-mode checks, participant exclusion of Cell members, consistency and verification, and an unchanged state on failure.
    - Have the Noise Generator fill the Lookalike share first through the same API, using per-archetype trace pools.
    - _Requirements: 15.2, 15.4, 15.5, 15.6_
  - [x] 7.2 Write the property test for Side Thread spawning
    - **Property 19: Side Thread spawning**
    - **Validates: Requirements 15.2, 15.4, 15.5, 15.6**

- [x] 8. Extend the debrief and the Outcome Record
  - [x] 8.1 Build the debrief plot sections, Outcome Record schema 2 and the save version bump
    - Build `PlotDebrief` per Plot (timeline, branches with causes, Sub-Plots, Cells, Twist with `heldInCaseFile`) and Lookalike `mimics`.
    - Add the Outcome Record `plots[]` and `selection.historyHash`.
    - Accept both Outcome Record schemas when reading.
    - _Requirements: 7.6, 14.5, 17.1, 17.2, 17.3_
  - [x] 8.2 Write the property test for debrief coherence and the Outcome Record
    - **Property 20: Debrief coherence and Outcome Record**
    - **Validates: Requirements 17.1, 17.3, 18.5**
  - [x] 8.3 Render the new debrief sections in the TUI
    - Add the per-Plot sections and Lookalike labels to the existing debrief screen, with `ink-testing-library` snapshot tests.
    - _Requirements: 7.6, 17.1, 17.2_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Build the Plot Lab
  - [x] 10.1 Create the `plot-lab` package and CLI
    - Add the `check` and `sidethreads` commands with forced selection, seeds `plot-lab:<id>:<i>`, the preset and city matrix, and Markdown and CSV report writers.
    - Add the dependency-cruiser rule that bans imports from `tui` and `player-view`.
    - _Requirements: 18.1, 18.2, 18.6, 18.7_
  - [x] 10.2 Implement passive runs and reachability
    - Run `wait` until resolution or `maxDays`, recording per-stage and per-Alternative execution rates, and list stages and Alternatives that never executed.
    - _Requirements: 18.3_
  - [x] 10.3 Implement the Oracle Player
    - Choose a truth-guided target from the cheapest success condition, then act only through `quote`/`resolve`: surveil, follow, intercept, decrypt, seize, identify and arrest.
    - Add a reroute-exercise mode that disrupts each Alternative's first stage.
    - _Requirements: 18.4_
  - [x] 10.4 Implement coherence checks, thresholds and the exit status
    - Check debrief coherence.
    - Load thresholds from defaults or a file, and exit non-zero with failing templates, cities, presets and seeds.
    - _Requirements: 18.5, 18.6_
  - [x] 10.5 Export `checkTemplate` for the content-expansion linter
    - _Requirements: 18.1_
  - [x] 10.6 Write Plot Lab determinism and boundary tests
    - Run twice on one template with 5 seeds and compare reports byte for byte.
    - Check that dependency-cruiser rejects a `player-view` import of `plot-lab`.
    - _Requirements: 18.6, 18.7_

- [x] 11. Author the `coldwar-plots` Library Pack
  - [x] 11.1 Scaffold the pack
    - Add `pack.yaml` (`contentSchema: 2`, requires `core`) and `predicates.yaml` with HANDS_OVER, HOLDS, FORGES, CROSSES, COMPROMISES, PHOTOGRAPHS, SHELTERS and CUTOUT_FOR, plus the functional LOCATED_AT override.
    - Add `plot-item` pools (materiel, documents, plates, devices) tagged with the pack's `materiel` facet, per-archetype trace pools and article templates, damage-report Cable templates, `allowedProperNouns` and preset overrides.
    - Add the pack's `tags.yaml` contributions: the `materiel` facet, any new Tags, and the Required Queries for mandatory slots not covered by the core pack (content-expansion Req 4.7), so that every conforming City Pack must satisfy them.
    - _Requirements: 2.6, 9.1, 11.1, 11.3, 13.3, 21.2, 21.4_
  - [x] 11.2 Author the Sub-Plot templates
    - Write `sub/border-crossing`, `sub/honey-trap`, `sub/courier-relay`, `sub/safehouse-setup` and `sub/forged-papers`.
    - _Requirements: 5.4, 19.4_
  - [x] 11.3 Author Plot templates, batch A, and pass the Plot Lab
    - Write `cw/nightingale`, `cw/burnt-illegal`, `cw/rail-junction` and `cw/dockside-fire`.
    - _Requirements: 19.1, 19.2, 19.3, 19.5, 21.1, 21.3_
  - [x] 11.4 Author Plot templates, batch B, and pass the Plot Lab
    - Write `cw/emigre-congress`, `cw/quiet-physicist`, `cw/ministry-photographs` and `cw/cipher-clerk`.
    - _Requirements: 19.1, 19.2, 19.3, 19.5, 21.1, 21.3_
  - [x] 11.5 Author Plot templates, batch C, and pass the Plot Lab
    - Write `cw/gift-horse`, `cw/hall-of-mirrors`, `cw/fox-in-the-attic` and `cw/counterfeit-tide`.
    - _Requirements: 19.1, 19.2, 19.3, 19.5, 21.1, 21.3_
  - [x] 11.6 Author Plot templates, batch D, and pass the Plot Lab
    - Write `cw/green-border`, `cw/machine-tools`, `cw/refugee-train` and `cw/trusted-friend`.
    - _Requirements: 19.1, 19.2, 19.3, 19.5, 21.1, 21.3_
  - [x] 11.7 Author Side Thread templates, batch 1 (12 templates)
    - Write the first 12 rows of the design's Side Thread catalogue, with `mimics` and `spawn` as listed, and pass `plot-lab sidethreads`.
    - _Requirements: 15.1, 15.2, 15.3, 20.1, 20.2, 20.3, 20.4_
  - [x] 11.8 Author Side Thread templates, batch 2 (12 templates)
    - Write the remaining 12 rows of the catalogue and pass `plot-lab sidethreads`.
    - _Requirements: 15.1, 15.2, 15.3, 20.1, 20.2, 20.3, 20.4_
  - [x] 11.9 Write the Library Pack smoke tests
    - Check that the pack loads with core and that the counts and coverage meet Req 19.1–19.4 and 20.1–20.3.
    - Check that only slice Channel and cipher kinds are used.
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 20.1, 20.2, 20.3, 21.4_
  - [x] 11.10 Write the property test for library solvability
    - **Property 15: Library solvability**
    - **Validates: Requirements 12.1, 12.2, 12.3, 19.5**
  - [x] 11.11 Add the Plot Lab CI job
    - Run `plot-lab check --seeds 50` over the core city on changes to `packs/coldwar-plots`.
    - Fix any template below the thresholds.
    - _Requirements: 19.5, 20.4_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests and the Plot Lab job pass, ask the user if questions arise.

## Notes

- Property-based test sub-tasks are required (not optional), matching the slice's convention.
- This plan requires the completed slice and content-expansion tasks 1–2. It bumps the save version and introduces Outcome Record schema 2, and it shares content-expansion's single `generatorVersion` bump, so golden replays are re-recorded once in task 4.2.
- Full 200-seed Plot Lab runs over every content-expansion reference city pack are run by authors before release (Req 19.5). CI uses 50 seeds over the core city.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "1.4"] },
    { "id": 1, "tasks": ["1.2", "1.5", "2.1", "3.1"] },
    { "id": 2, "tasks": ["1.6", "1.8", "2.2", "2.3", "3.2"] },
    { "id": 3, "tasks": ["1.7", "1.9", "3.3", "3.4"] },
    { "id": 4, "tasks": ["3.5", "3.6"] },
    { "id": 5, "tasks": ["3.7", "3.8", "3.9", "4.1"] },
    { "id": 6, "tasks": ["4.2", "4.4"] },
    { "id": 7, "tasks": ["4.3", "4.5"] },
    { "id": 8, "tasks": ["4.6", "6.1", "6.5", "11.1"] },
    { "id": 9, "tasks": ["6.2", "6.3", "6.6"] },
    { "id": 10, "tasks": ["6.4", "6.7", "6.8", "7.1"] },
    { "id": 11, "tasks": ["6.9", "6.10", "6.11", "7.2", "8.1"] },
    { "id": 12, "tasks": ["8.2", "8.3", "10.1"] },
    { "id": 13, "tasks": ["10.2", "10.5", "11.2"] },
    { "id": 14, "tasks": ["10.3"] },
    { "id": 15, "tasks": ["10.4"] },
    { "id": 16, "tasks": ["10.6", "11.3", "11.4", "11.5", "11.6", "11.7", "11.8"] },
    { "id": 17, "tasks": ["11.9", "11.10"] },
    { "id": 18, "tasks": ["11.11"] }
  ]
}
```
