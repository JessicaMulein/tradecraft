# Implementation Plan

## Overview

This plan builds on the completed Tradecraft vertical slice (`.kiro/specs/tradecraft/tasks.md`). It assumes the slice's content loader, template engine, world generator, Cipher Engine, Player View projections and test setup (Vitest, fast-check, dependency-cruiser) exist and pass.

The order is:

1. Extend the content model and loader.
2. Add setting selection and authored city generation to the engine.
3. Build the authoring tools.
4. Author the content: core tags, the Era Pack, Library Packs, then the five City Packs.
5. Wire the shipped content into CI.

Property numbers refer to this spec's design. Slice Properties 1–32 must keep passing throughout.

Follow-on spec order: content-expansion → plot-library → ambient-world → campaign-career → multi-city. Tasks 1–2 of this spec (schemas, Content Kind Registry and loader) are the hard prerequisite for the other follow-on specs.

## Tasks

- [x] 1. Extend the content schemas
  - [x] 1.1 Add Pack Roles, `contentSchema` 2 and the file envelope
    - Extend the `pack.yaml` schema with `role` and accept `contentSchema` 1 or 2. Treat a schema-1 pack with no role as `core`.
    - Accept content files as a bare list or as `{ provenance?, items }`, with the `Provenance` schema from the design.
    - _Requirements: 1.1, 1.2, 1.3, 16.2_
  - [x] 1.2 Implement the Content Kind Registry
    - Add `ContentKindRegistration`, `FieldDeclarations` and `LoadOptions.kinds`, and register every slice kind with its Field Declarations.
    - Create `kinds/index.ts` with one stub module for each new kind in this spec, so that tasks 1.3–1.7 each edit only their own module.
    - Refuse files of unregistered kinds.
    - _Requirements: 17.1, 17.2_
  - [x] 1.3 Add the Tag Vocabulary kind and Tag fields on slice kinds
    - Add the facet, Tag and Required Query schemas.
    - Add the required `tags` field to Location Types, archetypes and Cover Identities.
    - _Requirements: 4.1, 4.2, 4.3_
  - [x] 1.4 Add the City kinds
    - Add `CityDefinition`, `District` (with an optional sector), `CityLocation` (Place Basis, Year Range, sources, weight), `CityRoute`, `Newspaper`, `LocalOrg`, `WeatherTables` (twelve months, in the slice weather format), streets and `Source`. Mark them City-Scoped in the registry.
    - Add the `services` list (references to Service Definition ids, task 1.8) and the `instantiation` bounds to `CityDefinition`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2, 3.5_
  - [x] 1.5 Add the Era kinds
    - Add `Era`, `TechnologyItem`, `CipherConventions` (limited to the slice cipher kinds), `AnachronismEntry`, `BlocklistEntry`, `StyleRule`, `SensitivityTerm` and `PublicText` (with provenance).
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 12.1, 12.4, 12.5_
  - [x] 1.6 Add the Library kinds
    - Add `CultureGroup` (with `NamingRule` and gendered `FamilyName`) and `DescriptorFragment`.
    - Change the archetype schedule to `{ weekday, phase, at: TagQuery }` with a `fallback` Tag Query.
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 1.7 Add the Locale and Template Variant kinds and the pure formatters
    - Implement `formatDate`, `formatMoney`, honorific and address formatting with the city-then-era fallback chain.
    - _Requirements: 2.9, 8.1, 8.4_
  - [x] 1.8 Add the Service Definition kind
    - Add `ServiceDefinition` (id, fictional name, aliases, kind `own | hostile | local-security | liaison`, country, doctrine base, optional Year Range and Tags), allowed in Era Packs and (City-Scoped) City Packs, with its Field Declarations.
    - Check that every `CityDefinition.services` entry resolves, and add `services` to the Content Set.
    - _Requirements: 3.5, 19.1, 19.2, 19.4_

- [x] 2. Extend the loader
  - [x] 2.1 Implement the role rules and city-scope checks
    - Enforce exactly one Era Pack per City Pack, and the role-to-kind table.
    - Build `cityScopeOwner`. Refuse cross-city overrides before the slice `overrides` logic runs, and refuse cross-city references.
    - _Requirements: 1.4, 1.5, 1.6, 10.2_
  - [x] 2.2 Implement Template Variant compilation and `resolveTemplate`
    - Refuse a variant whose slot set differs from its base's, listing the missing and extra slots.
    - Resolve city, then era, then base, cached per `(base, city)`.
    - _Requirements: 8.2, 8.3_
  - [x] 2.3 Implement the Tag checks and Tag Conformance
    - Check every `tags` and `tagQueries` Field Declaration against the vocabulary and facet applicability.
    - Compute static Binders per City Pack, including archetypes whose schedule queries bind in the city, and refuse on shortfalls (including Required Queries added by extension packs).
    - _Requirements: 4.3, 4.4, 4.5, 4.7, 4.8_
  - [x] 2.4 Implement the Provenance gate
    - Refuse generated files without `reviewedBy` and `reviewedAt`, and refuse any pack directory under the Draft Area.
    - Add `cities`, `era`, `cultureGroups`, `descriptorFragments`, `tagVocabulary` and `registry` to the Content Set.
    - _Requirements: 16.3, 16.4_
  - [x] 2.5 Write the property test for load-order independence
    - **Property 2: Load-order independence for any conforming subset**
    - **Validates: Requirements 1.6, 10.1**
  - [x] 2.6 Write the property test for Template Variant resolution
    - **Property 11: Template Variant resolution**
    - **Validates: Requirements 8.2, 8.3**
  - [x] 2.7 Write the property test for the Locale date round-trip
    - **Property 12: Locale date round-trip**
    - **Validates: Requirements 8.4**
  - [x] 2.8 Write the property test for the Provenance gate
    - **Property 18: Provenance gate**
    - **Validates: Requirements 16.3, 16.4**

- [x] 3. Add setting selection and authored city generation to the engine
  - [x] 3.1 Add `setting` to the `ScenarioConfig` schema
    - Add the resolver checks for `setting.city` and `setting.startDate`, with field-path errors.
    - Keep the default `config/scenario.yaml` valid (city `core`).
    - _Requirements: 9.1_
  - [x] 3.2 Implement the Setting Stream, `drawSetting` and `yearFilter`
    - Use `derive(seed, 0x30000 + j)` (block `0x30000`–`0x30FFF` in the slice PRNG stream registry) and draw the Start Date within the city and era ranges.
    - On the Core City Path, run the slice's step 1 logic on the setting stream after the Start Date draw, so that the core stream starts at step 2.
    - Filter every year-ranged kind by Effective Year Range.
    - _Requirements: 9.2, 9.3, 9.10_
  - [x] 3.3 Implement `instantiateCity`
    - Follow the seven steps in the design: Required Query Binders first, then the District bounds, adjacency fill, connectivity and weighted fill. Return `'infeasible'` after 16 retries.
    - _Requirements: 4.6, 9.4, 9.9_
  - [x] 3.4 Implement `nameNpc` and the new Npc setting fields
    - Draw the gender, then the Culture Group from the year-filtered weights with no role input, then render with the Naming Rule. Redraw names that are already used or blocklisted, then fall back to deterministic enumeration.
    - Add `culture`, `gender`, `languages` and `formalName` to the slice `Npc`.
    - _Requirements: 3.3, 3.7, 7.1, 7.2, 7.3, 7.4_
  - [x] 3.5 Implement `describeNpc`
    - Filter fragments by gender, climate and year. Redraw collisions, then append `feature` fragments until the descriptor is unique.
    - _Requirements: 6.4, 6.5_
  - [x] 3.6 Wire Locale, Template Variants and currency into rendering
    - Resolve variants in Fact Line, Document, newspaper and Notification rendering, and format dates, money, honorifics and addresses with the Locale.
    - Add the Local Terms to the help glossary and the Locale `allowNames` to the Specifics Guard allowed-name set.
    - Scale Difficulty Preset and scenario money fields by `budgetScale` and `rounding` at preset resolution.
    - _Requirements: 2.7, 8.2, 8.4, 8.5, 8.6, 9.6_
  - [x] 3.7 Apply the Era cipher conventions in the Cipher Engine
    - `makeIntercept` reads owner weights, headers, pad format and numbers format from the Content Set. Tradecraft-error headers come from `headers`.
    - _Requirements: 5.6_
  - [x] 3.8 Wire the setting into `generate()`
    - With a City Pack selected, replace slice step 1 with `instantiateCity`; with the Core City, use the Core City Path from 3.2. Run the setting step before any Plot selection.
    - Take organisations, the Station and Hostile Service names from the city's `services`, newspapers, weather and local Cover Identities from the city, and name and describe NPCs with 3.4 and 3.5.
    - Build the `CityView` from the Instantiated City (or Core City) and the year-filtered Content Set, and expose it to later generation steps and follow-on binders.
    - Retry across core and setting attempts, then raise `GeneratorError { seed, city }`.
    - Add the optional write-only `UsageSink`, store `meta.setting` in World State and saves, and bump `generatorVersion` (the single bump shared with plot-library; re-record the slice golden replays once).
    - _Requirements: 3.5, 9.5, 9.7, 9.8, 9.9, 9.10, 9.11, 10.4, 15.1, 17.6, 19.3_
  - [x] 3.9 Write the property test for bindability
    - **Property 1: Bindability in every conforming city**
    - **Validates: Requirements 4.5, 4.6, 4.7, 9.4, 17.4**
  - [x] 3.10 Write the property test for year filtering
    - **Property 8: Year filtering**
    - **Validates: Requirements 6.4, 9.2, 9.3**
  - [x] 3.11 Write the property test for naming soundness
    - **Property 9: Naming soundness**
    - **Validates: Requirements 3.3, 3.7, 7.1, 7.2, 7.3**
  - [x] 3.12 Write the property test for descriptor uniqueness
    - **Property 10: Descriptor uniqueness**
    - **Validates: Requirements 6.4, 6.5**
  - [x] 3.13 Write the property test for cipher conventions
    - **Property 15: Cipher conventions applied**
    - **Validates: Requirements 5.6**
  - [x] 3.14 Write the property test for setting determinism
    - **Property 14: Setting determinism**
    - **Validates: Requirements 7.4, 9.8, 15.1**
  - [x] 3.15 Write the property test for solvability in every city
    - **Property 13: Solvability for every city**
    - **Validates: Requirements 9.7, 9.9**
  - [x] 3.16 Write the property test for side-by-side projection
    - **Property 3: Side-by-side projection**
    - **Validates: Requirements 9.5, 10.1, 10.3**
  - [x] 3.17 Write unit and smoke tests for the setting wiring
    - Check that the core pack alone still passes the slice content smoke test and the re-recorded golden replays.
    - Cover currency scaling, the `GeneratorError` path with an infeasible city, Specifics Guard acceptance of `allowNames`, and Local Terms in the glossary.
    - _Requirements: 1.7, 8.5, 8.6, 9.6, 9.9_
  - [x] 3.18 Write the property test for setting step isolation
    - **Property 19: Setting step isolation**
    - **Validates: Requirements 9.10, 9.11, 17.6**

- [x] 4. Checkpoint: engine on generated cities
  - Ensure all tests pass, including slice Properties 1–32, and ask the user if questions arise.

- [x] 5. Build the authoring tools (`content-tools`)
  - [x] 5.1 Create the `content-tools` package and the `pnpm content` CLI entry
    - Add the dependency-cruiser rule that no runtime package (`engine`, `dialogue`, `llm`, `player-view`, `tui`) imports `content-tools`.
    - _Requirements: 16.1_
  - [x] 5.2 Implement the linter framework
    - Implement `LintRule`, `LintFinding`, `LintContext` and `lint()`.
    - Map every loader `ContentError` to its rule, and run rules over the parsed files even when loading fails.
    - Add the `draft` and `release` profiles, Suppressions from `lint.yaml` (rejecting non-suppressible rules), deterministic sorting, text and JSON output, and the exit code.
    - Apply the generic rules to registered kinds through their Field Declarations.
    - _Requirements: 13.1, 13.3, 13.4, 13.5, 13.6, 13.8_
  - [x] 5.3 Implement the reference, identity and text-safety Lint Rules
    - CE-SCHEMA, CE-REF, CE-DUPID, CE-SLOT, CE-TAG, CE-CONFORM, CE-DUPTEXT, CE-NEARDUP (exact 3-shingle Jaccard), CE-NAMEDUP, CE-REALPERSON, CE-SENSITIVE, CE-SOURCE, CE-PROVENANCE and CE-VARIANT.
    - Tokenise with diacritic and case folding, and skip template slots.
    - _Requirements: 3.1, 3.4, 3.8, 13.2_
  - [x] 5.4 Implement the period, style, quantity and stability Lint Rules
    - CE-ANACH (text, plus technology items against `introduced`), CE-PERIOD, CE-STYLE (mechanical rules; list `manual` rules as reminders), CE-ALLOWLIST, CE-QUANTITY (the Req 11 target table), CE-FEASIBLE (`instantiateCity` over 256 fixed seeds at each Period Window boundary year) and CE-IDSTABLE (`--baseline`).
    - _Requirements: 11.8, 12.2, 12.3, 12.6, 13.2, 13.7_
  - [x] 5.5 Write the property test for defect detection
    - **Property 4: Linter detects every seeded defect**
    - **Validates: Requirements 1.3, 1.4, 1.5, 3.1, 3.4, 3.8, 4.3, 4.4, 4.8, 10.2, 11.8, 12.6, 13.1, 13.2, 13.3, 13.4, 13.8, 17.2**
  - [x] 5.6 Write the property test for suppression semantics
    - **Property 5: Suppression semantics**
    - **Validates: Requirements 13.5, 13.6**
  - [x] 5.7 Write the property test for the anachronism rule
    - **Property 6: Anachronism rule is exact**
    - **Validates: Requirements 12.2, 12.3**
  - [x] 5.8 Write the property test for id stability
    - **Property 7: Id stability against a baseline**
    - **Validates: Requirements 13.7, 17.5**
  - [x] 5.9 Implement the Preview CLI
    - Support the kinds `city`, `locations`, `npcs`, `newspaper`, `documents`, `dossiers`, `cables`, `fact-lines` and `intercepts`, using `generate` and the `player-view` projections.
    - Add `--reveal` (with a warning header), `--count` and `--out`. Write byte-stable UTF-8 output, and report loader errors with a non-zero exit.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_
  - [x] 5.10 Write the property test for preview determinism and gating
    - **Property 16: Preview determinism and gating**
    - **Validates: Requirements 14.3, 14.5**
  - [x] 5.11 Implement the Coverage Report
    - Collect usage through `UsageSink`, compute expected and underuse values, Required Query margins and the Variety Metric, and write `coverage.md` and `coverage.csv`.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_
  - [x] 5.12 Write the property test for coverage accounting
    - **Property 17: Coverage accounting**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.5**
  - [x] 5.13 Implement the Authoring Aid and promotion
    - Add the `config/authoring.yaml` schema with the local-endpoint check (`allowRemote` plus `--remote`).
    - Build prompts from the kind's JSON Schema, the Style Guide, the in-period Anachronism Entries, the Real-Person Blocklist, the Sensitivity Term List and samples of existing items.
    - Write drafts with provenance to `content-drafts/`, and write invalid output to `.rejected.json` sidecars.
    - Implement `promote`: lint with the draft merged, then write with the reviewer and review time and delete the draft, or leave everything unchanged.
    - _Requirements: 16.2, 16.5, 16.6, 16.7, 16.8_
  - [x] 5.14 Write unit tests for the Authoring Aid with a mocked client
    - Cover draft writing, rejected sidecars, prompt contents, the remote-endpoint refusal table, and promote success and failure.
    - _Requirements: 16.2, 16.5, 16.6, 16.7_

- [x] 6. Checkpoint: tools on a fixture city
  - Run lint, preview and coverage on a small fixture City Pack under `packages/content-tools/test/fixtures/`.
  - Ensure all tests pass, and ask the user if questions arise.

- [x] 7. Author the core and Era content
  - [x] 7.1 Add the core Tag Vocabulary
    - Write `tags.yaml` in the core pack with the facets, Tags and Required Queries from the design, adding one Required Query per slice archetype role and per Location function the generator needs.
    - Tag every slice core Location Type, archetype and Cover Identity. Move the core pack to `contentSchema` 2 with role `core`, and leave the Core City's content unchanged (only its stream moves, task 3.2).
    - _Requirements: 1.7, 4.1, 4.2, 4.3_
  - [x] 7.2 Write the Era Pack `era-cold-war-early` (1945–1965): era, technology, ciphers and styles
    - Write `era.yaml`, at least 60 technology items with years of introduction, cipher conventions (period header, pad and numbers-broadcast formats, owner weights), document styles for every slice Document kind, and the era Locale.
    - Write the shared `service` definitions (the Station's own service, the hostile services and the allied liaison services) with fictional names, countries and doctrine bases.
    - _Requirements: 3.5, 5.1, 5.2, 5.3, 5.5, 11.7, 18.1, 19.1_
  - [x] 7.3 Write the Era Pack quality lists
    - Write at least 200 Anachronism Entries (with city-scoped entries such as later Berlin border terms), the Real-Person Blocklist of notable period individuals, the Style Guide (mechanical and manual rules, including aftermath restraint and offices-by-title), and the Sensitivity Term List.
    - _Requirements: 3.4, 3.6, 3.8, 11.7, 12.1, 12.4, 12.5_
  - [x] 7.4 Write at least 6 public texts
    - Include an almanac, a railway timetable, a verse anthology, a directory, a manual and a guide. Each must be original or verified public-domain text, long enough for the slice book-cipher scheme.
    - _Requirements: 5.4, 11.7_

- [x] 8. Author the Library Packs
  - [x] 8.1 Write `lib-central-europe` and `lib-russian`
    - Culture Groups: Austrian German, German (Berlin), Czech, Hungarian, Polish and Russian. Give each at least 100 given and 100 family names (at least 300 total, with gendered family forms where the language has them), a Naming Rule, voice traits, mannerisms and Year-ranged persona backgrounds.
    - _Requirements: 6.1, 7.1, 11.4, 11.6_
  - [x] 8.2 Write `lib-western`, `lib-eastern-mediterranean` and `lib-iberian`
    - Culture Groups: American English, British English, French, Turkish, Istanbul Greek, Armenian, Sephardic (Ladino-speaking), Levantine, Portuguese and Spanish, to the same targets as 8.1. With 8.1, this brings the persona backgrounds to at least 200.
    - _Requirements: 6.1, 7.1, 11.4, 11.6_
  - [x] 8.3 Write `lib-archetypes`
    - Write at least 40 civilian archetypes (for example dockworker, tram conductor, café waiter, émigré bookseller, wire-service stringer, hotel concierge, ministry clerk, black-market trader, student and night porter), plus period variants of the slice role archetypes. Give each Tags, MICE ranges, wariness and Tag Query schedules.
    - _Requirements: 6.2, 11.5_
  - [x] 8.4 Write `lib-descriptors`
    - Write at least 150 Descriptor Fragments across all slots, with period clothing, gender and climate Tags and Year Ranges.
    - _Requirements: 6.3, 11.6_

- [x] 9. Author the City Packs
  - [x] 9.1 Write the `city-vienna` geography (1945–1955)
    - Write `city.yaml` (Schilling currency and Culture Weights), at least 6 Districts with four-power sectors (the Innere Stadt as the international sector), at least 25 Locations with Place Basis and sources, Routes with sector-checkpoint Tags, city Location Types, at least 60 streets, the monthly weather and `sources.yaml`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 11.2, 18.2_
  - [x] 9.2 Write the `city-vienna` institutions and voice
    - Write at least 3 fictional newspapers, at least 4 local organisations, the city's local-security `service` definition and `services` references, at least 6 local Cover Identities, the Locale (Local Terms and `allowNames`), at least 30 Template Variants, at least 20 article and Rumour templates, and `lint.yaml`.
    - _Requirements: 2.7, 2.8, 2.9, 3.5, 8.1, 11.2, 11.3, 18.5, 19.1, 19.2_
  - [x] 9.3 Write the `city-berlin` geography (1948–1961)
    - Cover the four sectors, U-Bahn and S-Bahn transit hubs, and sector-crossing Routes with Year Ranges, to the same targets as 9.1.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 11.2, 18.2_
  - [x] 9.4 Write the `city-berlin` institutions and voice, to the same targets as 9.2
    - _Requirements: 2.7, 2.8, 2.9, 3.5, 8.1, 11.2, 11.3_
  - [x] 9.5 Write the `city-istanbul` geography (1950–1965)
    - Cover Beyoğlu, Galata, Sirkeci, Kadıköy, ferry Routes across the Bosphorus and Golden Horn, bazaars and consulates, to the same targets as 9.1.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 11.2, 18.2_
  - [x] 9.6 Write the `city-istanbul` institutions and voice, to the same targets as 9.2
    - _Requirements: 2.7, 2.8, 2.9, 3.5, 8.1, 11.2, 11.3_
  - [x] 9.7 Write the `city-lisbon` geography (1945–1965)
    - Cover the Baixa, Chiado, Alfama, Cais do Sodré, trams and funiculars, the port and airport, and émigré hotels, to the same targets as 9.1.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 11.2, 18.2_
  - [x] 9.8 Write the `city-lisbon` institutions and voice, to the same targets as 9.2
    - _Requirements: 2.7, 2.8, 2.9, 3.5, 8.1, 11.2, 11.3_
  - [x] 9.9 Write the `city-trieste` geography (1947–1954)
    - Cover the Free Territory of Trieste: Zone A (the city under Allied military government) and Zone B (under Yugoslav military government), with each District's `sector` naming its zone and zone-line checkpoint Routes with Year Ranges. Include Borgo Teresiano, Città Vecchia, Piazza Unità, the port and Molo Audace, the railway station and the Opicina tram, to the same targets as 9.1.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 11.1, 11.2, 18.2_
  - [x] 9.10 Write the `city-trieste` institutions and voice, to the same targets as 9.2
    - Include the zone military-government offices by title, a local-security `service` definition and `services` references.
    - _Requirements: 2.7, 2.8, 2.9, 3.5, 8.1, 11.2, 11.3, 19.1, 19.2_

- [x] 10. Integrate the shipped content
  - [x] 10.1 Add the CI gates
    - Run `pnpm content lint --profile release` on the shipped set, which must pass.
    - Run the Coverage Report on the shipped set (50 seeds, `standard`) as an artifact, failing if a city's Variety Metric exceeds 0.6.
    - _Requirements: 11.1, 11.8, 15.4, 18.4_
  - [x] 10.2 Write the shipped-city generation tests
    - Generate one world per shipped city (including Trieste) and preset. Check that `setting.city` set to Vienna uses `city-vienna` instead of the Core City.
    - Run Property 13 over the shipped City Packs with random seeds.
    - _Requirements: 9.7, 18.2, 18.3, 18.5_
  - [x] 10.3 Record golden previews
    - Record `city`, `npcs`, `newspaper` and `fact-lines` previews for each shipped city at fixed seeds into `packages/content-tools/test/golden/`, and assert them in CI.
    - _Requirements: 14.1, 14.2, 14.3_

- [x] 11. Final checkpoint: expanded world
  - Run the shipped set through lint (release), coverage and the golden previews, and generate and inspect one revealed world per city.
  - Ensure all tests pass, and ask the user if questions arise.

## Notes

- Property-based test sub-tasks are required (not optional), following the slice's convention, because they carry the conformance, solvability and determinism guarantees.
- Content-authoring tasks (7–9) may use the Authoring Aid (5.13). Every authored file is reviewed and promoted through the linter. No content is generated at game runtime.
- Historical accuracy of real landmarks and period texture is checked against each City Pack's `sources.yaml` during review. All people and organisations named in the packs are fictional.
- Follow-on specs (ambient-world, plot-library, multi-city, campaign-career) depend on the Content Kind Registry (1.2), the Tag Vocabulary and Required Queries (1.3, 2.3, 7.1), City-Scoped Content ownership (2.1), Service Definitions (1.8), the `CityView` and setting step (3.8) and id stability (5.4). Task 1.2 is the hard prerequisite: every follow-on spec registers its kinds through `LoadOptions.kinds`.
- `city-trieste` (9.9, 9.10) is required by multi-city's `region-core` template (Vienna, Berlin, Trieste, era date 1953).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5", "1.7"] },
    { "id": 2, "tasks": ["1.6", "1.8", "2.1"] },
    { "id": 3, "tasks": ["2.2", "3.1", "5.1"] },
    { "id": 4, "tasks": ["2.3", "2.7", "3.2"] },
    { "id": 5, "tasks": ["2.4", "2.6", "3.3", "5.2"] },
    { "id": 6, "tasks": ["2.5", "2.8", "3.4", "5.3", "7.1"] },
    { "id": 7, "tasks": ["3.5", "5.4", "7.2"] },
    { "id": 8, "tasks": ["3.6", "5.5", "5.6", "5.7", "5.8", "7.3", "8.1"] },
    { "id": 9, "tasks": ["3.7", "5.13", "7.4", "8.2"] },
    { "id": 10, "tasks": ["3.8", "5.14", "8.3"] },
    { "id": 11, "tasks": ["3.9", "3.10", "3.11", "3.12", "3.13", "3.14", "3.15", "3.16", "3.17", "3.18", "5.9", "5.11", "8.4"] },
    { "id": 12, "tasks": ["5.10", "5.12", "9.1", "9.3", "9.5", "9.7", "9.9"] },
    { "id": 13, "tasks": ["9.2", "9.4", "9.6", "9.8", "9.10"] },
    { "id": 14, "tasks": ["10.1", "10.2", "10.3"] }
  ]
}
```
