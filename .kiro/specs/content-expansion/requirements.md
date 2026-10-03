# Requirements Document

## Introduction

This spec builds on the completed Tradecraft vertical slice (`.kiro/specs/tradecraft/`, "the slice"). The goal is a detailed, immersive and extensive world where the player keeps finding new content. The setting is the early Cold War (late 1940s to mid 1960s) in real cities. All characters are fictional.

The slice already loads Zod-validated YAML Content Packs (slice Req 31–32). It has a loader with dependency ordering, overrides and Content Manifest hashing, and a deterministic template language. This spec adds the following and keeps every slice mechanism as it is:

- **City Packs.** Each one defines a real city in its period: districts, period Locations, Routes, currency, languages, newspapers, local organisations, weather, local Cover Identities, a locale and sources.
- **Era Packs.** Shared period content: a technology catalogue, document styles, public texts, cipher conventions, an anachronism list, a list of real persons whose names must not be used, a style guide and a sensitivity term list.
- **Library Packs.** Large persona, name, archetype and descriptor libraries, organised by Culture Group.
- **The Tag Vocabulary.** Other specs' templates bind to archetypes and Locations through it, and every City Pack conforms to it.
- **Localised Templates.** Template Variants and locale formats per city and era.
- **Quantity targets and quality rules.**
- **Authoring tooling.** A Pack Linter, a Preview CLI, a Coverage Report and an offline, reviewed LLM Authoring Aid.

**Slice invariants preserved.** The Sim alone owns ground truth (slice Req 2). All runtime facts come from deterministic templates over committed static data (slice Req 20.1, 30.1). No language model generates content at game runtime. The determinism contract `(seed, generatorVersion, ContentManifest, DifficultyPreset)` is extended with the setting selection and is not otherwise changed (slice Req 1.2). The loader still refuses to start on any error (slice Req 31.2). Saves with a different Content Manifest are still refused (slice Req 31.6). The Leak Guard and Specifics Guard are unchanged (slice Req 5, 20).

**Boundaries with parallel follow-on specs.** These are interface assumptions only.

- **ambient-world** owns the city event schema, the living-city simulation and the news cycle. This spec provides the Content Kind Registry and the authoring tooling that ambient-world's kinds will use. City Packs author event and news content against ambient-world's schemas once those are registered.
- **plot-library** owns the Plot and Side Thread template format extensions and the template library. Its templates bind roles and places only through the Tag Vocabulary defined here, read the city through the CityView defined here, and run after this spec's setting step.
- **multi-city** owns the runtime semantics of more than one city in one game. This spec guarantees only that City Packs can be loaded side by side without conflict. multi-city extends this spec's Service Definitions with residency, rivalry and liaison fields.
- **campaign-career** owns postings and reputation. It references City ids, Cover Identity ids and Service ids, which this spec keeps stable across pack versions.
- Every follow-on spec registers its content kinds through this spec's Content Kind Registry (Requirement 17). Tasks 1–2 of this spec are the hard prerequisite for the other follow-on specs. The implementation order is content-expansion → plot-library → ambient-world → campaign-career → multi-city.

## Glossary

Terms defined in the slice glossary keep their meanings. Only new terms are defined here.

- **Pack Role**: The declared role of a Content Pack: `core`, `era`, `city`, `library` or `extension`.
- **City Pack**: A Content Pack with role `city` that defines exactly one City Definition.
- **City Definition**: The content record for one real city: districts, Locations, Routes, currency, languages, Culture Group weights, newspapers, local organisations, weather tables, Cover Identities, street names, locale, period window and sources.
- **City-Scoped Content**: Content items that belong to one City Definition (Districts, Locations, Routes, newspapers, local organisations, weather tables, local Cover Identities, Template Variants scoped to the city).
- **Core City**: The minimal city shipped in the slice core pack (Vienna). It is used when no City Pack is selected.
- **Era Pack**: A Content Pack with role `era` that defines shared content for a Period Window.
- **Period Window**: An inclusive year range (for example 1945–1965) during which content is valid.
- **Year Range**: An optional inclusive year range on a content item, restricting the game years in which it may appear.
- **Effective Year Range**: The intersection of an item's Year Range, its City Definition's Period Window and its Era Pack's Period Window.
- **Game Year**: The calendar year of the game's start date.
- **Start Date**: The calendar date mapped to game day 0, drawn on the Setting Stream.
- **Setting Stream**: A PRNG stream, derived separately from the slice's core, noise and daily streams, used for setting selection and city instantiation.
- **Library Pack**: A Content Pack with role `library` that provides personas, name pools, archetypes or descriptor fragments for use by any city.
- **Extension Pack**: A Content Pack with role `extension` that contributes content kinds registered by another spec.
- **Culture Group**: A named group of naming conventions, name pools, languages and persona backgrounds (for example "Austrian German" or "Istanbul Greek").
- **Culture Weights**: A City Definition's weights over Culture Groups, used when naming NPCs in that city.
- **Naming Rule**: A Culture Group's rule for composing and rendering a full name from its pools.
- **Name Pool**: The given names (by gender) and family names of one Culture Group.
- **Real-Person Blocklist**: An Era Pack list of full names (and optionally family names) of real historical individuals that no NPC, authored text or generated name may use.
- **Descriptor Fragment**: A piece of a physical descriptor (build, age band, clothing, headwear, distinguishing feature, carried item) with a Year Range and climate tags.
- **Tag**: A vocabulary term of the form `<facet>:<value>` attached to content items.
- **Tag Vocabulary**: The set of Tags, facets and Required Queries defined by the loaded packs.
- **Effective Tags**: A Location's own Tags together with its Location Type's Tags. For other kinds, the item's own Tags.
- **Tag Query**: A set of 1–3 Tags, all of which an item's Effective Tags must contain for the item to bind.
- **Binder**: A content item whose Effective Tags satisfy a Tag Query.
- **Required Query**: A Tag Query that the Tag Vocabulary guarantees, with a minimum static Binder count and a minimum instantiated Binder count.
- **Tag Conformance**: The condition that every Required Query has at least its minimum number of Binders in a City Pack together with its Era Pack and Library Pack dependencies.
- **Instantiated City**: The Districts, Locations and Routes selected from a City Definition for one game.
- **Locale**: A City Definition's or Era Pack's formatting record: date format, currency format, honorifics, address format, local terms and Specifics Guard allowlist additions.
- **Local Term**: A non-English word used for period texture (for example "Kaffeehaus"), with a glossary definition.
- **Template Variant**: A replacement for a base template, scoped to one City Definition or Era Pack.
- **Content Kind Registry**: The loader's table of content kinds and their schemas, field declarations and lint metadata.
- **Field Declaration**: Metadata on a registered content kind naming its text fields, Tag fields, Tag Query fields, Year Range fields and localisable templates.
- **Anachronism Entry**: An Era Pack record of a term, its match pattern, its earliest plausible year and an optional city scope.
- **Style Guide**: Era Pack rules for Fact Line and Document templates, each either mechanically checked or flagged for manual review.
- **Sensitivity Term List**: An Era Pack list of slurs and demeaning terms that content must not contain.
- **Sources List**: A City Pack record of the references used to author its real places and period texture.
- **Place Basis**: A Location's declared basis: `real-landmark`, `real-inspired` or `fictional`.
- **Pack Linter**: The authoring tool that checks a pack set against the loader checks and the lint rules.
- **Lint Rule**: A named check with a rule id, a default severity and a suppressibility flag.
- **Defect Class**: The category of content error that one Lint Rule detects.
- **Lint Finding**: One reported defect: rule id, severity, pack, file, path and message.
- **Lint Profile**: `draft` or `release`. In the `release` profile, quantity and coverage shortfalls are errors.
- **Suppression**: A pack-declared exemption from a suppressible Lint Rule for one path, with a written justification.
- **Baseline Manifest**: The Content Manifest and id list of a previously released pack version, used to check id stability.
- **Preview CLI**: The authoring tool that renders sample content for a pack set, city, seed and preset.
- **Coverage Report**: The authoring tool output that measures how often content is used across generated worlds.
- **Variety Metric**: The mean pairwise Jaccard similarity of Instantiated City Location sets across a sample of seeds.
- **Authoring Aid**: The offline tool that drafts candidate content with a language model, for human review.
- **Draft Area**: The directory where the Authoring Aid writes drafts. The loader never reads it.
- **Provenance Record**: Metadata on content produced with the Authoring Aid: model id, prompt hash, generation time, reviewer and review time.
- **Quantity Targets**: The minimum content counts in Requirement 11.
- **CityView**: The read-only projection of the Instantiated City (or the Core City) and the year-filtered Content Set that binders in other specs use to find Binders of Tag Queries.
- **Service Definition**: A content record for one fictional intelligence or security organisation: id, fictional name, aliases, kind (`own`, `hostile`, `local-security` or `liaison`), country and doctrine base.
- **Core City Path**: The setting step used when the Core City is selected: the Start Date and the slice's world-generation step 1 both run on the Setting Stream.

## Requirements

### Requirement 1: Pack Roles and Schema Generation

**User Story:** As the developer, I want every pack to declare its role, so that the loader can enforce how city, era and library content fits together.

#### Acceptance Criteria

1. THE Content Loader SHALL accept a `role` field in `pack.yaml` with one of the values `core`, `era`, `city`, `library` or `extension`.
2. WHEN a pack declares `contentSchema` 1 and no `role` THEN THE Content Loader SHALL treat the pack as role `core`.
3. THE Content Loader SHALL accept packs declaring `contentSchema` 1 or 2, and IF a pack declares any other `contentSchema` THEN THE Content Loader SHALL refuse to start and report the pack (extending slice Req 31.2).
4. IF a City Pack does not declare exactly one Era Pack in `requires` THEN THE Content Loader SHALL refuse to start and report the City Pack.
5. IF any pack redefines or overrides a City-Scoped Content id owned by a different City Pack THEN THE Content Loader SHALL refuse to start, whatever the pack's `overrides` list says.
6. THE Content Loader SHALL apply slice Req 31.2–31.5 (validation, ordering, duplicate ids, Content Manifest) to packs of every role.
7. WHEN only the core pack is loaded THEN THE Content Loader and Sim SHALL satisfy slice Req 31.7, using the Core City.

### Requirement 2: City Pack Format

**User Story:** As a content author, I want one pack format that describes a whole real city, so that adding a city is a data task.

#### Acceptance Criteria

1. THE City Pack SHALL define exactly one City Definition containing a city id, display name, country, Period Window, Start Date range, Districts, Locations, Routes, currency, languages, Culture Weights, newspapers, local organisations, monthly weather tables, local Cover Identities, a street-name pool, a Locale, a Sources List and references to the Service Definitions active in the city (Requirement 19).
2. THE City Definition SHALL give every District a name, aliases, description, atmosphere tags and Tags, and MAY give a District an occupation sector naming the controlling power and the sector's Year Range.
3. THE City Definition SHALL give every Location the fields of slice Req 21.1 plus Tags, a Place Basis and an optional Year Range.
4. THE City Definition SHALL give every Route the fields of slice Req 21.2 plus optional Tags (such as a sector checkpoint) and an optional Year Range.
5. THE City Definition SHALL define its currency with a name, symbol, subunit, display format, rounding unit and Budget scale factor.
6. THE City Definition SHALL define a weather table for each of the twelve months, in the format the slice's daily weather draw consumes (slice Req 21.6).
7. THE City Definition SHALL give every newspaper a masthead name, language, editorial stance description, style register, publication days, cover price and Tag Query for the Locations where it is sold.
8. THE City Definition SHALL give every local organisation a name, aliases, kind, Tags and the archetype Tag Queries of its members.
9. THE City Definition's Locale SHALL define a date format, currency format, honorifics, address format, Local Terms with glossary definitions, and Specifics Guard allowlist additions.

### Requirement 3: Real Places, Fictional People and Respectful Content

**User Story:** As a player, I want the city to feel historically real without the game putting words in real people's mouths or trivialising real suffering, so that the setting is immersive and respectful.

#### Acceptance Criteria

1. WHEN a Location's Place Basis is `real-landmark` THEN THE City Definition SHALL name the landmark by its period name, SHALL describe it consistently with its Effective Year Range, and SHALL cite at least one Sources List entry.
2. WHEN a Location's Place Basis is `real-landmark` and the landmark is a private business THEN THE City Definition SHALL give the Location a Year Range within which a cited source shows the business operating.
3. THE Content Set SHALL represent every NPC, quoted speaker and named individual in templates as a fictional person.
4. THE Document and Fact Line templates SHALL refer to real public offices by title (for example "the Soviet High Commissioner") and SHALL name no real individual.
5. THE Content Set SHALL give every intelligence organisation a fictional name.
6. THE Content Set SHALL limit references to real wartime atrocities to aftermath texture defined in the Style Guide (such as rubble, rationing and displaced persons), and SHALL contain no event, trace, Rumour, article or persona background that depicts such an atrocity.
7. THE World Generator SHALL draw each NPC's Culture Group from the city's Culture Weights using the same weights for every NPC role, so that no Culture Group is tied to the Cell, the Hostile Service or any other role.
8. THE Content Set SHALL contain no entry of the Sensitivity Term List in any text field.

### Requirement 4: Tag Vocabulary

**User Story:** As a template author in another spec, I want a guaranteed vocabulary of tags, so that any library template can bind its roles and places in any city.

#### Acceptance Criteria

1. THE core pack SHALL define the Tag Vocabulary as a content kind in which every Tag has an id of the form `<facet>:<value>`, a facet, a description and the content kinds it applies to.
2. THE Tag Vocabulary SHALL define Required Queries, each with 1–3 Tags, a minimum static Binder count and a minimum instantiated Binder count.
3. THE Content Loader SHALL require every Location, Location Type, District, archetype, local organisation and Cover Identity to carry at least one Tag.
4. IF a content item carries a Tag, or a Tag Query names a Tag, that is not in the Tag Vocabulary or does not apply to the item's kind THEN THE Content Loader SHALL refuse to start and report the item's pack, file and path.
5. WHEN a City Pack is loaded THEN THE Content Loader SHALL check Tag Conformance for that City Pack together with its Era Pack and Library Pack dependencies, and IF any Required Query has fewer Binders than its minimum THEN SHALL refuse to start and report the city, the query and the shortfall.
6. WHEN the World Generator instantiates a city THEN THE World Generator SHALL include at least each Required Query's minimum instantiated Binder count among the selected Locations.
7. WHERE a pack other than the core pack adds Required Queries THEN THE Content Loader SHALL check Tag Conformance of every loaded City Pack against them.
8. THE Content Loader SHALL validate the Tag Query fields of every content kind in the Content Kind Registry against the Tag Vocabulary.

### Requirement 5: Era Packs

**User Story:** As a content author, I want shared period content in one place, so that every city of the period feels consistent.

#### Acceptance Criteria

1. THE Era Pack SHALL define a Period Window, a technology catalogue, document styles, public texts, cipher conventions, Anachronism Entries, the Real-Person Blocklist, the Style Guide and the Sensitivity Term List.
2. THE Era Pack SHALL give every technology catalogue item a name, category, year of introduction and Tags.
3. THE Era Pack SHALL provide document styles as template fragments for the slice Document kinds (newspaper, public text, Dossier, Cable and seized material, slice Req 30.1).
4. THE Era Pack SHALL provide public texts whose provenance is marked `original` or `public-domain` with a cited source, and each public text SHALL be long enough to key the book ciphers of slice Req 30.3.
5. THE Era Pack's cipher conventions SHALL use only the cipher kinds of slice Req 9.2, and SHALL define per-owner-kind weights, message header formats, pad formats and numbers-broadcast formats.
6. WHEN the Cipher Engine generates an Intercept THEN THE Cipher Engine SHALL apply the loaded Era Pack's cipher conventions for formats and owner weights.

### Requirement 6: Persona, Archetype and Descriptor Libraries

**User Story:** As a player, I want the people I meet to vary widely and fit the period, so that every game introduces new faces.

#### Acceptance Criteria

1. THE Library Pack SHALL define Culture Groups, each with a Naming Rule, Name Pools, languages, voice traits, mannerisms and persona backgrounds, where each background carries a Year Range and Tags.
2. THE Library Pack SHALL define archetypes in the slice archetype format (slice design, content kinds) with Tags, and SHALL express archetype schedule templates as Tag Queries over Locations instead of Location Type ids.
3. THE Library Pack SHALL define Descriptor Fragments by slot (build, age band, clothing, headwear, distinguishing feature, carried item), each with a Year Range and climate Tags.
4. WHEN the World Generator composes an NPC descriptor THEN THE World Generator SHALL use only Descriptor Fragments whose Year Range contains the Game Year and whose climate Tags match the city.
5. THE World Generator SHALL assign distinct descriptors to all NPCs in a world.

### Requirement 7: Name Generation

**User Story:** As a player, I want authentic but fictional names, so that the city sounds right without naming real people.

#### Acceptance Criteria

1. WHEN the World Generator names an NPC THEN THE World Generator SHALL draw the Culture Group from the city's Culture Weights, draw the names from that group's Name Pools, and render the full name by the group's Naming Rule.
2. THE World Generator SHALL give every NPC in a world a distinct full name.
3. IF a generated full name matches a Real-Person Blocklist entry THEN THE World Generator SHALL redraw the name.
4. THE World Generator SHALL generate names deterministically from the seed and the Content Set.

### Requirement 8: Localised Templates

**User Story:** As a player, I want newspapers, cables and observations to read in the voice of the city, so that Vienna and Lisbon feel different.

#### Acceptance Criteria

1. THE Content Set SHALL support Template Variants, each naming a base template id, a scope (one City Definition or one Era Pack) and a replacement template.
2. WHEN the Sim renders a template THEN THE Sim SHALL use the Template Variant scoped to the selected city if one exists, otherwise the variant scoped to the loaded Era Pack if one exists, otherwise the base template.
3. IF a Template Variant does not declare exactly the slot set of its base template THEN THE Content Loader SHALL refuse to start and report the variant.
4. WHEN the Sim renders a date, currency amount, honorific or address THEN THE Sim SHALL format it with the selected city's Locale, falling back to the Era Pack's Locale.
5. THE help glossary (slice Req 26.5) SHALL include the Local Terms of the selected city's Locale.
6. THE Specifics Guard (slice Req 20.4) SHALL include the selected city's Locale allowlist additions in its allowed-name set.

### Requirement 9: Setting Selection and City Instantiation

**User Story:** As a player, I want each game to place me in a chosen real city at a plausible date, with a fresh set of places, so that the world feels new every time.

#### Acceptance Criteria

1. THE scenario config (slice Req 41.1) SHALL accept a setting selection naming a city id and optionally a Start Date, and SHALL default to the Core City.
2. WHEN a game starts without a configured Start Date THEN THE World Generator SHALL draw the Start Date on the Setting Stream from the City Definition's Start Date range, restricted to the Era Pack's Period Window.
3. THE World Generator SHALL exclude every content item whose Effective Year Range does not contain the Game Year.
4. WHEN a game starts THEN THE World Generator SHALL select an Instantiated City from the City Definition on the Setting Stream, with the District and Location counts of slice design step 1 and with Routes that connect the selected Districts.
5. THE World Generator SHALL take the game's Locations, local organisations, newspapers, weather tables and local Cover Identities from the selected City Definition, and then run the slice's core and noise generation over the Instantiated City.
6. THE Sim SHALL keep the Budget in the selected city's currency, setting the starting balance to the Difficulty Preset's starting Budget multiplied by the city's Budget scale factor and rounded to the city's rounding unit (preserving slice Req 28.1).
7. FOR ALL City Packs, Difficulty Presets and seeds, THE generated world SHALL pass the slice's discovery-path verification (slice Req 1.4, 26.3, 29.6).
8. WHEN the same seed, generator version, Content Manifest, Difficulty Preset and setting selection are used THEN THE World Generator SHALL produce an identical World State (extending slice Req 1.2).
9. IF city instantiation or discovery-path verification fails after the configured attempt limit THEN THE World Generator SHALL raise a generator error naming the city and seed.
10. WHERE the Core City is selected THEN THE World Generator SHALL run the slice's world-generation step 1 (City) on the Setting Stream (the Core City Path) instead of the core stream.
11. THE World Generator SHALL complete the setting step (Start Date and Instantiated City, or the Core City Path) before any Plot template selection, and the setting step's output SHALL depend only on the seed, the Content Set and the setting selection.

### Requirement 10: Side-by-Side City Packs

**User Story:** As the developer of the multi-city spec, I want city packs to load together without conflict, so that one game can later span several cities.

#### Acceptance Criteria

1. WHEN several conforming City Packs are loaded together THEN THE Content Loader SHALL load them without error.
2. IF City-Scoped Content in one City Pack references City-Scoped Content of a different City Pack THEN THE Content Loader SHALL refuse to start and report the reference.
3. FOR ALL sets of conforming City Packs, THE Content Set's projection onto one City Pack and its dependencies SHALL equal the Content Set from loading that City Pack and its dependencies alone.
4. THE World Generator SHALL instantiate exactly one city per game in this spec, and the multi-city spec SHALL define the runtime semantics of more than one.

### Requirement 11: Quantity Targets

**User Story:** As a player, I want enough content that repeat games keep surprising me, so that the world feels extensive.

#### Acceptance Criteria

1. THE shipped content SHALL include at least five City Packs: Vienna, Berlin, Istanbul, Lisbon and Trieste.
2. THE City Definition SHALL contain at least 25 Locations, 6 Districts, 3 newspapers, 4 local organisations, 6 local Cover Identities, 3 Culture Groups in its Culture Weights and 60 street names.
3. THE City Pack SHALL contain at least 30 Template Variants and at least 20 city-specific article or Rumour templates.
4. THE Culture Group SHALL have at least 300 distinct names, with at least 100 given names and at least 100 family names.
5. THE shipped Library Packs SHALL define at least 40 civilian archetypes, and every City Pack SHALL have at least 12 civilian archetypes whose schedule Tag Queries bind in that city.
6. THE shipped Library Packs SHALL define at least 200 persona backgrounds and at least 150 Descriptor Fragments across all slots.
7. THE shipped Era Pack SHALL define at least 60 technology items, 200 Anachronism Entries and 6 public texts.
8. WHERE the Pack Linter runs in the `release` profile THEN THE Pack Linter SHALL report every Quantity Target shortfall as an error naming the target, the required count and the actual count.

### Requirement 12: Anachronism and Style Rules

**User Story:** As a content author, I want period mistakes and style drift caught mechanically, so that quality holds as content grows.

#### Acceptance Criteria

1. THE Era Pack SHALL give every Anachronism Entry a term, a case-insensitive whole-word match pattern, an earliest plausible year, an optional city scope and a note.
2. WHEN a text field of a content item matches an Anachronism Entry whose earliest year is later than the start of the item's Effective Year Range, within the entry's city scope if one is set, THEN THE Pack Linter SHALL report an anachronism finding.
3. WHEN a content item names a technology catalogue item introduced after the start of the item's Effective Year Range THEN THE Pack Linter SHALL report an anachronism finding.
4. THE Style Guide SHALL define rules for Fact Line templates: at most 35 words per sentence, a terminal full stop, no exclamation marks, no first-person pronouns, no terms from the Style Guide's hedging list, and British spelling as checked against the Style Guide's spelling list.
5. THE Style Guide SHALL define rules for each Document kind's register, including upper-case telegraphic bodies for Cables and headlines of at most 12 words for newspapers.
6. WHEN a template breaks a mechanically checked Style Guide rule THEN THE Pack Linter SHALL report a style finding naming the rule.

### Requirement 13: Pack Linter

**User Story:** As a content author, I want one command that finds every defect in my packs, so that I can fix content before it ships.

#### Acceptance Criteria

1. WHEN the Pack Linter runs on a pack set THEN THE Pack Linter SHALL run every Content Loader check and every Lint Rule, and SHALL report every Lint Finding rather than stopping at the first.
2. THE Pack Linter SHALL implement Lint Rules for at least these Defect Classes: schema violation, dangling reference, duplicate id, undeclared template slot, unknown Tag, Tag Conformance shortfall, instantiation infeasibility, anachronism, out-of-period Year Range, exact duplicate text, near-duplicate text, duplicate name within a Name Pool, Real-Person Blocklist match, Sensitivity Term match, Quantity Target shortfall, Template Variant slot mismatch, Locale allowlist collision with a distinctive entity alias, missing Sources List citation, missing or incomplete Provenance Record, style violation, and id removal against a Baseline Manifest.
3. THE Pack Linter SHALL report each Lint Finding with its rule id, severity, pack, file, path and message, in a deterministic order, as text and as JSON.
4. THE Pack Linter SHALL exit with status 0 when no Lint Finding has error severity, and with a non-zero status otherwise.
5. WHERE a pack declares a Suppression for a suppressible Lint Rule with a non-empty justification THEN THE Pack Linter SHALL downgrade the matching finding to informational and list the Suppression in its output.
6. IF a Suppression names the schema, dangling reference, Real-Person Blocklist, Sensitivity Term or Provenance Lint Rules THEN THE Pack Linter SHALL ignore the Suppression and report an error.
7. WHERE a Baseline Manifest is supplied THEN THE Pack Linter SHALL report every content id present in the baseline and missing from the current pack version as an error, unless the pack's major version increased.
8. THE Pack Linter SHALL apply the text, Tag, Year Range, duplicate and localisation Lint Rules to every content kind in the Content Kind Registry according to its Field Declarations.

### Requirement 14: Preview CLI

**User Story:** As a content author, I want to see what my content looks like in play, so that I can judge it without playing a full game.

#### Acceptance Criteria

1. WHEN the Preview CLI runs with a pack set, city, seed, Difficulty Preset and content kind THEN THE Preview CLI SHALL render samples of that kind: Instantiated City Locations, NPCs (name, descriptor, archetype and persona), newspaper editions, Documents, Dossiers, Cables, Fact Lines for sample Observations, or Intercept plaintexts.
2. THE Preview CLI SHALL render with the same World Generator, template engine, Template Variant resolution and Locale formatting as the game.
3. WHEN the Preview CLI runs twice with the same inputs THEN THE Preview CLI SHALL produce byte-identical output.
4. THE Preview CLI SHALL make no language model calls.
5. WHERE the `--reveal` flag is given THEN THE Preview CLI SHALL include truth fields, and otherwise SHALL render only Player View content.
6. IF the pack set fails loading THEN THE Preview CLI SHALL report the Content Loader errors and exit with a non-zero status.

### Requirement 15: Coverage Report

**User Story:** As a content author, I want to know which content never appears in play, so that I can fix tags and weights or cut dead content.

#### Acceptance Criteria

1. WHEN the Coverage Report runs with a pack set, a seed count (default 50) and a list of cities and presets THEN THE Coverage Report SHALL generate one world per seed, city and preset, and count the uses of every archetype, persona background, Descriptor Fragment, Tag, Location, template, Template Variant and Name Pool entry.
2. THE Coverage Report SHALL report the static Binder count and the margin over minimum for every Required Query in every city.
3. THE Coverage Report SHALL flag every item never used, and every item used less than the configured fraction (default 0.25) of its uniform expected use.
4. THE Coverage Report SHALL report the Variety Metric for each city.
5. THE Coverage Report SHALL write Markdown and CSV output, deterministically for the same inputs.

### Requirement 16: Offline Authoring Aid

**User Story:** As a content author, I want a model to draft candidate content that I then review, so that I can build large libraries faster without letting a model invent facts in play.

#### Acceptance Criteria

1. THE Authoring Aid SHALL live in an authoring tools package that no runtime package (`engine`, `dialogue`, `llm`, `player-view`, `tui`) imports, enforced by a dependency rule in CI.
2. THE Authoring Aid SHALL write model output only to the Draft Area, as schema-validated content files carrying a Provenance Record with `generated: true`, the model id, the prompt hash and the generation time.
3. THE Content Loader SHALL load no file from the Draft Area.
4. IF a pack file carries `generated: true` without a reviewer and review time THEN THE Content Loader SHALL refuse to start and report the file.
5. WHEN an author promotes a draft THEN THE Authoring Aid SHALL run the Pack Linter on the pack set with the draft included, and SHALL copy the draft into the pack with the reviewer and review time only if the linter reports no errors.
6. THE Authoring Aid SHALL include the Style Guide, the Anachronism Entries, the Real-Person Blocklist and the Sensitivity Term List in its prompts.
7. IF the configured authoring endpoint is not on the local machine THEN THE Authoring Aid SHALL refuse to send any request unless the author passes an explicit remote-endpoint flag.
8. THE Sim SHALL make no Authoring Aid calls at game runtime, and all runtime content SHALL come from committed pack files.

### Requirement 17: Interfaces with Follow-on Specs

**User Story:** As a developer of a parallel follow-on spec, I want stable extension points, so that my content kinds and templates fit the expanded world without changes here.

#### Acceptance Criteria

1. THE Content Loader SHALL provide a Content Kind Registry through which a package registers a content kind with a Zod schema, a directory name, the Pack Roles that may contain it and Field Declarations.
2. WHEN a pack contains a file of an unregistered content kind THEN THE Content Loader SHALL refuse to start (preserving slice Req 31.8's existing-kinds rule).
3. WHERE the ambient-world spec registers event and news content kinds THEN THE City Pack SHALL be able to contain instances of those kinds, and THE Pack Linter SHALL lint them by their Field Declarations.
4. WHERE the plot-library spec registers template kinds THEN THE Content Loader SHALL resolve their role and place slots only through Tag Queries, and the plot-library spec SHALL use Required Queries for every mandatory slot.
5. THE City Pack SHALL keep City ids and Cover Identity ids stable across minor and patch versions, so that the campaign-career spec can reference them.
6. THE World Generator SHALL expose a CityView of the Instantiated City (or the Core City) and the year-filtered Content Set, giving for each Location, District, local organisation and registered tagged kind its id and Effective Tags, the Binders of any Tag Query sorted by id, and the archetypes and Location Types whose Tags satisfy a Tag Query.
7. WHERE the ambient-world, plot-library, campaign-career or multi-city spec adds content kinds THEN that spec SHALL register them through the Content Kind Registry (`LoadOptions.kinds`) with Field Declarations.

### Requirement 18: Shipped Content

**User Story:** As a player, I want the expanded world to ship ready to play, so that I can pick a city and start.

#### Acceptance Criteria

1. THE shipped content SHALL include an Era Pack for the early Cold War with a Period Window of 1945–1965.
2. THE shipped content SHALL include City Packs for Vienna (Period Window 1945–1955, four-power occupation), Berlin (1948–1961), Istanbul (1950–1965), Lisbon (1945–1965) and Trieste (1947–1954, the Free Territory of Trieste with Zone A and Zone B).
3. THE shipped content SHALL include Library Packs whose Culture Groups cover every Culture Group named in the shipped City Packs' Culture Weights.
4. WHEN CI runs THEN THE Pack Linter SHALL pass on the shipped pack set in the `release` profile.
5. WHERE the setting selection names Vienna THEN THE World Generator SHALL use the Vienna City Pack's City Definition in place of the Core City.

### Requirement 19: Service Definitions

**User Story:** As a content author, I want every intelligence and security organisation defined once as content, so that cities, regions and campaigns refer to the same fictional services.

#### Acceptance Criteria

1. THE Content Set SHALL define a `service` content kind, allowed in Era Packs and City Packs, in which every Service Definition has an id, a fictional name, aliases, a kind (`own`, `hostile`, `local-security` or `liaison`), a country and a doctrine base.
2. THE City Definition SHALL list the services active in the city as references to Service Definition ids, and IF a reference does not resolve THEN THE Content Loader SHALL refuse to start and report the city and the id.
3. WHEN a game starts THEN THE World Generator SHALL name the Station and the Hostile Service from the Service Definitions referenced by the selected city.
4. THE Content Set SHALL keep Service Definition ids stable across minor and patch versions, so that the campaign-career and multi-city specs can reference them.
