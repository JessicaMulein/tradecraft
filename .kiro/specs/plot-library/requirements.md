# Requirements Document

## Introduction

This spec extends the Plot and Side Thread template format defined by the slice (`.kiro/specs/tradecraft/`, referred to below as "Slice Req N.M") and ships a large library of templates set in the early Cold War (late 1940s–1960s) in real cities. The goal is a world where the player keeps meeting new operations: different archetypes, different shapes (branches, optional stages, several Cells, nested operations, twists), and more than one hostile operation at a time.

It builds on the completed slice. Every new mechanism keeps the slice's invariants:

- **Truth isolation** (Slice Req 2): branch outcomes, twists, facade flags and secondary-plot state live only in the Truth Store and engine state, and the Player View never shows them before the debrief.
- **Determinism** (Slice Req 1.2, 17): selection, binding, branching and expansion use only seeded PRNG streams and declared inputs.
- **Solvability** (Slice Req 1.4): every stage that can become active has two disjoint discovery paths, one human and one signal.
- **Model outputs never write facts** (Slice Req 2.3): nothing in this spec reads model output.

All characters are fictional. Templates reference persons only through role slots, and operations are fictional ones plausible for the era.

**Dependencies on parallel specs** (interfaces assumed, not defined here):

- **content-expansion** owns the city pack schema, the Tag Vocabulary (`facet:value` Tags, Tag Queries of 1–3 Tags and Required Queries), the `CityView` projection, the setting step that generates the city, the Content Kind Registry, persona and name pools, and the authoring linter CLI. This spec registers its kinds through the Content Kind Registry, binds through Tag Queries over `CityView`, may add Required Queries through its pack (content-expansion Req 4.7), and lets the linter call its template checks.
- **ambient-world** owns the event system and mid-game Side Thread emergence. This spec provides the Side Thread instantiation interface that ambient-world calls.
- **campaign-career** calls this spec's `select` with a Template History built from Outcome Record schema-2 `plots[]` entries, and consumes the Outcome Record plot fields.
- **multi-city** owns the Cross-City Stage Hook schema (`city` role on a stage, `handoff`, `cityRoles`, optional `fallback`) and its semantics. This spec declares hooks in that schema and defines only the single-city fallback.

Implementation order: content-expansion → plot-library → ambient-world → campaign-career → multi-city. content-expansion tasks 1–2 are a hard prerequisite.

Out of scope: city and archetype content, the event system, campaign logic, cross-city play and new UI screens beyond debrief sections.

## Glossary

- **Template Schema v2**: The extended Plot and Side Thread template format, used by packs that declare `contentSchema: 2`.
- **Template Parameter**: A named slot in a template (target, venue, materiel, decoy organisation, defector and so on) bound at instantiation to an entity selected by a Tag Query.
- **Tag Vocabulary**: content-expansion's set of `facet:value` Tags, facets and Required Queries, defined by the loaded packs.
- **Tag Query**: A set of 1–3 Tags, all of which an entity's Effective Tags must contain for the entity to bind (content-expansion glossary).
- **Required Query**: A Tag Query that content-expansion's Tag Conformance guarantees Binders for in every conforming city.
- **CityView**: content-expansion's read-only projection of the generated city and Content Set, used by the Binder.
- **Mandatory Parameter**: A Template Parameter or role slot whose binding the template cannot do without. Its Tag Query must be a Required Query.
- **Binding**: The assignment of every Template Parameter and role slot to an entity of the generated world.
- **Stage Graph**: A template's stages and their `requires` edges, forming a directed acyclic graph.
- **Optional Stage**: A stage included or left out at instantiation to meet the preset's stage target.
- **Branch Point**: A point in the Stage Graph with two or more Alternatives, exactly one of which becomes active.
- **Alternative**: One of a Branch Point's mutually exclusive sub-sequences of stages.
- **Static Branch**: A Branch Point resolved at instantiation.
- **Runtime Branch**: A Branch Point resolved during play when its predecessors complete, from Branch Conditions.
- **Branch Condition**: A test from a fixed set of kinds evaluated on Sim state to choose an Alternative.
- **Branch Configuration**: One combination of Alternatives, one for every Runtime Branch.
- **Active Stage**: A stage that belongs to the instantiated Plot under the current or a possible Branch Configuration.
- **Sub-Plot**: A template, marked `subOnly` or a full Plot template, embedded as a stage group inside another template.
- **Cell Spec**: A template's declaration of one Cell with its roles and compartmentation.
- **Cutout**: A role that links two Cells and is the only member who knows members of both.
- **Twist**: A template-declared hidden structure: `false-flag`, `facade` or `inside-man`.
- **Facade Stages**: In a `facade` Twist, the stages that are the deception. The Real Stages carry the real objective.
- **Decoy Organisation**: In a `false-flag` Twist, the organisation that the traces wrongly implicate.
- **Twist Proposition**: A Proposition whose discovery reveals the Twist.
- **Primary Plot**: The Plot whose resolution ends the game, as in Slice Req 19.3–19.5 and 38.6.
- **Secondary Plot**: An additional hostile operation running at the same time, whose resolution changes Standing but does not end the game.
- **Outcome Condition**: A template-declared condition from a fixed set of kinds that decides a Plot's success or failure.
- **Functional Predicate**: A predicate whose definition declares `cardinality: functional`, so that at most one object holds for a subject at a time.
- **Custody Chain**: The ordered handovers of an item between holders.
- **Variant Key**: A canonical string identifying a template instance's template id, Static Branch choices, included Optional Stages and Twist.
- **Template History**: An optional, ordered list of past instances (template id, Variant Key, archetype, outcome) supplied by campaign-career.
- **Selection Model**: The deterministic weighted choice of Primary and Secondary Plot templates.
- **Lookalike Side Thread**: A Side Thread template declaring the Plot archetype whose traces it imitates.
- **Cross-City Hook**: A Cross-City Stage Hook in the multi-city schema: a stage's `city` role, an optional `handoff`, the template's `cityRoles`, and an optional local `fallback` stage.
- **Local City Role**: In single-city play, the first City role declared in the template's `cityRoles`, bound to the game's city.
- **Off-map Stage**: In single-city play, a hooked stage with no local fallback. It executes at its deadline as a hidden event.
- **Plot Lab**: The authoring harness that instantiates templates over many seeds and reports solvability, reachability, winnability and debrief coherence.
- **Oracle Player**: A Plot Lab agent that reads the Truth Store to play a disruption line. It exists only in the Plot Lab.
- **Library Pack**: The `coldwar-plots` Content Pack holding the template library.

## Requirements

### Requirement 1: Template Format Versioning

**User Story:** As a content author, I want the extended template format to sit alongside the slice's format, so that existing packs keep working.

#### Acceptance Criteria

1. THE Content Loader SHALL accept packs that declare `contentSchema` 1 or 2, and SHALL accept Template Schema v2 fields only in packs that declare 2.
2. WHEN a schema-1 Plot or Side Thread template is loaded THEN the Content Loader SHALL treat it as a Template Schema v2 template with one Cell, no Branch Points, no Optional Stages, no Sub-Plots, no Twist and the slice's Outcome Conditions (Slice Req 19.3–19.5, 38.6).
3. WHEN the same template, seed and PRNG streams are used THEN the instantiator SHALL produce, for a schema-1 template, a Plot deep-equal to the slice instantiator's output.
4. IF a Template Schema v2 file fails schema validation or a cross-reference check THEN the Content Loader SHALL refuse to start and report the pack, file and path of each error (Slice Req 31.2).

### Requirement 2: Template Parameters and City Binding

**User Story:** As a content author, I want templates to name their targets and venues by tags, so that one template works in any conforming city pack.

#### Acceptance Criteria

1. THE Template Schema v2 SHALL let a template declare Template Parameters, each with an entity kind (npc, loc, org or item), a Tag Query, optional excluded Tags, an optional distinctness group and a `mandatory` flag (default true), and SHALL express public or private access only through the `access:public` and `access:private` Tags.
2. THE Template Schema v2 SHALL let role slots and Template Parameters reference archetypes, Location Types, Locations and organisations only through Tag Queries over the Tag Vocabulary, and SHALL reject literal city-specific ids in library templates.
3. WHEN a template is instantiated THEN the Binder SHALL choose, for each Template Parameter, one entity from the CityView whose Effective Tags contain every Tag of the parameter's Tag Query and no excluded Tag, with distinct entities within each distinctness group, using the core PRNG stream over candidates sorted by id.
4. IF a Template Parameter has no candidate in the generated world THEN the Binder SHALL report the template as ineligible for that world with the parameter name and its Tag Query.
5. THE Content Loader SHALL reject a template that uses a Tag absent from the Tag Vocabulary, a Tag whose facet does not apply to the slot's kind, or a Tag Query with fewer than 1 or more than 3 Tags.
6. THE Content Loader SHALL reject a template whose Mandatory Parameter (npc, loc or org) or role slot has a Tag Query that is not the query of a Required Query in the loaded Tag Vocabulary, and the Library Pack MAY add Required Queries for this purpose (content-expansion Req 4.7).
7. WHERE a Template Parameter is not mandatory and its Tag Query has no Binder THEN the Binder SHALL bind it through its declared `fallback` Tag Query, which SHALL be the query of a Required Query.

### Requirement 3: Optional Stages and Branch Points

**User Story:** As a player, I want the same kind of operation to unfold differently each time, so that knowing an archetype does not tell me the answer.

#### Acceptance Criteria

1. THE Template Schema v2 SHALL let a template mark stages as optional, with an inclusion weight, and declare a minimum and maximum active stage count.
2. WHEN a template is instantiated THEN the instantiator SHALL include Optional Stages, by weighted draw on the core stream, until the active stage count reaches the preset's stage target clamped to the template's minimum and maximum.
3. THE Template Schema v2 SHALL let a template declare Branch Points, each with two or more Alternatives and a resolution time of `static` or `runtime`.
4. WHEN a template is instantiated THEN the instantiator SHALL resolve every Static Branch by weighted draw on the core stream and drop the stages of the unchosen Alternatives.
5. THE Content Loader SHALL reject a template whose Stage Graph has a cycle, a `requires` reference to a stage outside every Alternative that can precede it, or more than 32 Branch Configurations.
6. THE instantiator SHALL record the chosen Alternatives and included Optional Stages in the Truth Store and compute the Variant Key from them.

### Requirement 4: Runtime Branch Resolution

**User Story:** As a player, I want the Hostile Service to change course when its operation is threatened, so that my interference visibly matters.

#### Acceptance Criteria

1. THE Template Schema v2 SHALL let each Alternative of a Runtime Branch declare Branch Conditions from this fixed set: `belief-adopted` (Proposition pattern), `stage-disrupted` (stage reference), `participant-status` (role and status), `alertness-at-least` (number), `weighted` (weight) and `default`.
2. WHEN all predecessors of a Runtime Branch have executed or been disrupted THEN the Sim SHALL select the first Alternative, in declared order, whose conditions all hold, evaluating `weighted` conditions with one draw on the runtime stream.
3. THE Sim SHALL evaluate Branch Conditions only from World State, the Truth Store and Hostile Service beliefs, and the result SHALL depend only on that state and the runtime PRNG state.
4. THE Content Loader SHALL require every Runtime Branch to have exactly one Alternative with a `default` condition, declared last.
5. WHEN a stage draws `reroute` from its `onDisrupted` weights (Slice Req 3.4) and its Branch Point has an unresolved Alternative that does not require the disrupted stage THEN the Sim SHALL switch to that Alternative before trying other reroutes.
6. WHEN a Runtime Branch resolves THEN the Sim SHALL emit a hidden `branch-resolved` event naming the Alternative and the deciding condition.

### Requirement 5: Sub-Plots

**User Story:** As a content author, I want to reuse operation fragments like a border crossing or a honey trap inside larger operations, so that the library grows without duplicating stages.

#### Acceptance Criteria

1. THE Template Schema v2 SHALL let a stage group embed a Sub-Plot by template id, with a mapping from the parent's roles and Template Parameters to the Sub-Plot's slots.
2. WHEN a template with Sub-Plots is instantiated THEN the instantiator SHALL expand each Sub-Plot into the parent Stage Graph, prefix the expanded stage ids with the embedding path, and connect the Sub-Plot's entry and exit stages to the parent's declared predecessors and successors.
3. THE Content Loader SHALL reject a Sub-Plot embedding that is recursive, exceeds a nesting depth of 2, or leaves a Sub-Plot slot unmapped and unbound.
4. THE Content Loader SHALL let templates marked `subOnly` be used only as Sub-Plots, and the Selection Model SHALL exclude them.

### Requirement 6: Multi-Cell Plots

**User Story:** As a player, I want larger operations run by several compartmented cells, so that rolling up one cell does not hand me the whole network.

#### Acceptance Criteria

1. THE Template Schema v2 SHALL let a Plot template declare 1–3 Cell Specs, each with roles, and declare Cutout roles that link pairs of Cells.
2. WHEN a multi-cell template is instantiated THEN the Sim SHALL create one Cell organisation per Cell Spec, each linked to the Hostile Service, in place of the single Cell of Slice Req 1.1.
3. THE Sim SHALL give each Cell member knowledge of the members of their own Cell, and SHALL give knowledge of another Cell's members only to Cutouts linking the two Cells.
4. THE Sim SHALL track Cell security per Cell, and adaptation effects that the slice applies to "the Cell" (Slice design, belief-driven adaptation rules) SHALL apply to the Cell of the affected member.
5. WHEN Plot and template roles exceed the slice's Principal NPC range THEN the World Generator SHALL generate up to 22 Principal NPCs.

### Requirement 7: Twists

**User Story:** As a player, I want some operations to be something other than what they seem, so that I must question the obvious reading of the evidence.

#### Acceptance Criteria

1. THE Template Schema v2 SHALL let a Plot template declare at most one Twist of kind `false-flag`, `facade` or `inside-man`, with one or more Twist Propositions.
2. WHERE a template declares a `false-flag` Twist THEN the Sim SHALL bind a Decoy Organisation that is not the Hostile Service, and SHALL give Cell members Cover Stories, planted Documents and Rumours that assert membership of the Decoy Organisation.
3. WHERE a template declares a `facade` Twist THEN the Sim SHALL mark the Facade Stages in the Truth Store, generate Facade Stage traces at the template's facade trace rate, and treat disruption of a Facade Stage as adding no Abort Pressure.
4. WHERE a template declares an `inside-man` Twist THEN the Sim SHALL fill the declared Cell role with a starting contact or Station staff NPC whose apparent allegiance remains the Station.
5. THE Sim SHALL keep the Twist kind, Facade Stage marks and Decoy bindings out of the Player View and Case File until the game ends.
6. WHEN the game ends THEN the debrief SHALL state each Twist, its Twist Propositions and whether the Case File held a Claim matching each one.

### Requirement 8: Concurrent Operations

**User Story:** As a player, I want the opposition to run more than one operation at once, so that I must choose where to spend my time.

#### Acceptance Criteria

1. WHEN a game starts THEN the Sim SHALL instantiate one Primary Plot and the number of Secondary Plots set by the Difficulty Preset (0–2).
2. THE Template Schema v2 SHALL let a template declare concurrency tags, and the Selection Model SHALL pair a Primary Plot only with Secondary Plots whose tags the templates mutually allow.
3. THE Sim SHALL give each Plot its own Cells, Abort Pressure and Outcome Conditions, and SHALL let Plots share only Hostile Service officers and roles that both templates declare shareable.
4. WHEN a Secondary Plot succeeds THEN the Sim SHALL apply the template's Standing penalty and deliver an HQ damage-report Cable, and SHALL NOT end the game.
5. WHEN a Secondary Plot is disrupted or aborted THEN the Sim SHALL apply the template's Standing reward.
6. WHEN the Primary Plot resolves THEN the game SHALL end per Slice Req 19.3–19.5 and 38.6, and the debrief SHALL include every Plot.

### Requirement 9: Truth Consistency Across Plots

**User Story:** As a player, I want overlapping operations to describe one coherent world, so that contradictions I find are real deceptions, not generator bugs.

#### Acceptance Criteria

1. THE predicate definition schema (Slice Req 32.2) SHALL accept an optional `cardinality` of `functional` or `multi`, defaulting to `multi`.
2. THE Sim SHALL keep the Truth Store free of two facts with the same Functional Predicate and subject, different objects and overlapping windows.
3. THE Sim SHALL schedule every NPC at no more than one Location per phase across all Plots, Side Threads and routines.
4. IF instantiation of a Secondary Plot or Side Thread would violate criterion 2 or 3 THEN the instantiator SHALL reschedule the later instance by declared precedence (Primary, then Secondary by template id, then Side Threads) and, if rescheduling fails, SHALL regenerate from the next derived seed.

### Requirement 10: Outcome Conditions

**User Story:** As a player, I want each kind of operation to have a fitting way to win, so that protecting a defector or exposing a dangle counts as success.

#### Acceptance Criteria

1. THE Template Schema v2 SHALL let a Plot template declare success and failure Outcome Conditions from this fixed set: `arrest-role`, `seize-item`, `abort`, `protect-until` (entity and deadline), `identify-role` (role and report Cable), `stage-completed` and `entity-status` (role and status).
2. WHEN no Outcome Conditions are declared THEN the Sim SHALL apply the slice's conditions: success on arresting the Cell leader, seizing the materiel or abort, and failure on final-stage completion.
3. WHEN a declared success condition holds THEN the Sim SHALL resolve the Plot as disrupted, and WHEN a declared failure condition holds THEN the Sim SHALL resolve the Plot as succeeded for the Hostile Service.
4. WHEN the player sends an identification report Cable naming an entity for a role THEN the Sim SHALL accept it only if the Case File evidence count for that entity (Slice Req 40.4) meets the arrest threshold, deciding acceptance from Player View and Case File data only.
5. WHEN an accepted identification report names the entity that fills the role in the Truth Store THEN the `identify-role` condition SHALL hold, and IF it names any other entity THEN the Sim SHALL apply the wrongful-arrest penalty (Slice Req 19.2) and show the same acknowledgement Cable as for a correct report.
6. WHERE a `facade` Twist is declared THEN the Content Loader SHALL require every success condition to reference a Real Stage, a Real role or the real materiel.
7. THE Content Loader SHALL reject a template whose success conditions reference no stage, role or item that exists in every Branch Configuration.

### Requirement 11: Plot-Driven Predicates and Evaluators

**User Story:** As a content author, I want predicates for handovers, forgery, border crossings and compromise, so that the new archetypes produce facts the player can trace.

#### Acceptance Criteria

1. THE Library Pack SHALL define the predicates HANDS_OVER, HOLDS, FORGES, CROSSES, COMPROMISES, PHOTOGRAPHS, SHELTERS and CUTOUT_FOR, each with templates, field code, extractor description and implication rule where relevant (Slice Req 32.2, 40.3).
2. THE Sim SHALL add one built-in evaluator kind, `custody-chain`, under which HOLDS(holder, item) is true at time t exactly when the latest HANDS_OVER of the item at or before t names that holder as recipient, or the holder is the item's origin and no handover precedes t.
3. THE Library Pack SHALL declare HOLDS and LOCATED_AT as Functional Predicates.
4. WHEN the Library Pack is loaded THEN the Sim SHALL derive renderers, extractor schema branches, field codes and truth evaluation for the new predicates with no code change other than the `custody-chain` evaluator (Slice Req 32.3).

### Requirement 12: Solvability Verification for Extended Templates

**User Story:** As a player, I want every operation, however it branches, to be discoverable, so that a twist or a reroute never makes the game unwinnable.

#### Acceptance Criteria

1. WHEN a Plot is instantiated THEN the discovery-path verifier (Slice Req 1.4) SHALL check, for every Branch Configuration, that every Active Stage's key Proposition has two disjoint discovery paths, one human and one signal.
2. WHERE a Twist is declared THEN the verifier SHALL check that every Twist Proposition has two disjoint discovery paths.
3. THE verifier SHALL check every Secondary Plot with the same rules and run once over the combined world.
4. THE verifier SHALL exclude Off-map Stages from path requirements.
5. IF verification fails after the slice's retry limit THEN the World Generator SHALL drop the failing template from this game's selection, select again, and log the template id and seed.

### Requirement 13: Difficulty Scaling per Template

**User Story:** As a player, I want harder settings to produce harder operations, not only tighter deadlines.

#### Acceptance Criteria

1. THE Template Schema v2 SHALL let a template declare per-preset overrides for Optional Stage weights, Branch weights, facade trace rate, participant tradecraft and Twist eligibility.
2. THE template SHALL declare a minimum Difficulty Preset, and the Selection Model SHALL exclude a template below that preset.
3. THE Difficulty Preset schema (Slice Req 34.2) SHALL accept these additional fields with defaults: Secondary Plot count, Twist probability, maximum Cells and Lookalike Side Thread share.
4. WHERE the active preset's Twist probability draw fails THEN the instantiator SHALL instantiate the template without its Twist, unless the template declares the Twist mandatory.

### Requirement 14: Template Selection Model

**User Story:** As a returning player, I want each posting to bring an operation I have not just played, so that the library keeps feeling new.

#### Acceptance Criteria

1. WHEN a game starts THEN the Selection Model SHALL choose the Primary Plot and Secondary Plot templates from eligible templates (bindable in the world, era-compatible, at or below the active preset, not `subOnly`) by weighted draw on a dedicated selection stream derived from the seed.
2. THE Selection Model SHALL accept an optional Template History input and an optional selection context (year, Tension, Epoch flags, Rank and a scaling hint, supplied by campaign-career), and its choice SHALL be a deterministic function of the seed, Content Manifest, Difficulty Preset, generated city, Template History and selection context.
3. WHERE a Template History is supplied THEN the Selection Model SHALL exclude templates used in the last 2 history entries whenever another eligible template exists, and SHALL multiply weights by the configured penalty for repeated archetypes and seen Variant Keys.
4. THE Selection Model SHALL run after content-expansion's setting step (the Start Date and Instantiated City on the Setting Stream, or, with the Core City, the slice's city step on the Setting Stream's Core City Path), so that the city is identical for any Template History.
5. THE Sim SHALL record the Template History hash and selection result in saves and the Outcome Record.

### Requirement 15: Side Thread Template Extensions

**User Story:** As a player, I want red herrings that look like real operations, so that telling signal from noise is a deduction.

#### Acceptance Criteria

1. THE Template Schema v2 SHALL give Side Thread templates Template Parameters, Optional Stages, Static and Runtime Branches and Sub-Plots, with no Cell roles and no Outcome Conditions.
2. THE Template Schema v2 SHALL let a Side Thread template declare `mimics` with a Plot archetype, and the Noise Generator SHALL fill the preset's Lookalike Side Thread share from such templates.
3. THE Template Schema v2 SHALL let a Side Thread template declare spawn modes `worldgen`, `midgame` or both.
4. THE Sim SHALL expose a Side Thread instantiation interface that ambient-world can call mid-game with a template, the World State and a PRNG stream, and that adds only new entities, Propositions, schedules and traces.
5. WHEN a Side Thread is instantiated mid-game THEN the Sim SHALL re-run discovery-path verification and the consistency checks of Requirement 9, and IF either fails THEN SHALL discard the instance and leave state unchanged.
6. THE Sim SHALL assign no Cell member of any Plot as a Side Thread participant (Slice Req 29.2).
7. WHERE a Side Thread template declares an optional `ambient.spawn` block (City_Metric id, threshold and tags owned by ambient-world), THE Template Schema v2 SHALL accept the block, and THE Sim SHALL carry the block unchanged on the loaded template for ambient-world without interpreting the block.

### Requirement 16: Cross-City Hooks

**User Story:** As the developer, I want templates to mark stages that happen elsewhere, so that the multi-city spec can connect them later without rewriting templates.

#### Acceptance Criteria

1. THE Template Schema v2 SHALL let a template declare Cross-City Hooks in the multi-city Cross-City Stage Hook schema: `cityRoles` on the template, and a `city` role, an optional `handoff` and an optional local `fallback` stage on each stage.
2. WHILE the game runs in single-city mode THEN the instantiator SHALL bind the Local City Role to the game's city and SHALL replace each stage bound to any other City role with its local `fallback` stage, or otherwise mark the stage Off-map.
3. WHEN an Off-map Stage reaches its deadline THEN the Sim SHALL execute it as a hidden event with no traces in the city.
4. THE Content Loader SHALL reject a template whose Outcome Conditions reference an Off-map-capable stage that has no local `fallback`.
5. WHILE the game runs in single-city mode THEN the Sim SHALL treat a `handoff` between two stages of the Local City Role as an ordinary `requires` edge, and SHALL satisfy a `handoff` from an Off-map Stage when that stage executes.
6. THE Instantiator SHALL preserve every hook's `city`, `handoff`, `cityRoles` and `fallback` declarations in the Plot state, so that multi-city can apply its own semantics.

### Requirement 17: Debrief and Outcome Record Extensions

**User Story:** As a player, I want the debrief to show how the operation actually unfolded, including the paths it did not take, so that I can learn from it.

#### Acceptance Criteria

1. WHEN the game ends THEN the debrief SHALL show, for every Plot, the template's display name, archetype, the Alternatives taken with the deciding conditions, the executed and disrupted stages in time order, the Sub-Plots, the Cells with their members and Cutouts, and the outcome.
2. WHEN the game ends THEN the debrief SHALL list which Side Threads were Lookalikes and the archetype each imitated.
3. THE Outcome Record SHALL include, for every Plot, the template id, Variant Key, archetype, role (Primary or Secondary) and outcome in `plots[]`, and the Template History hash in `selection.historyHash`, under Outcome Record schema 2 (Slice Req 35.3), the single successor of slice schema 1.

### Requirement 18: Plot Lab Harness

**User Story:** As a content author, I want to check a template across many seeds before shipping it, so that broken or unwinnable operations never reach players.

#### Acceptance Criteria

1. THE Plot Lab SHALL instantiate a selected template, or every library template, over N seeds (default 200) for each Difficulty Preset and each selected city pack.
2. THE Plot Lab SHALL report, per template, the binding eligibility rate, first-attempt verification pass rate, final verification pass rate and the failing seeds.
3. THE Plot Lab SHALL run a passive simulation with no player action and report, per stage and per Alternative, the fraction of seeds in which the stage executed, and SHALL flag any stage or Alternative that executed in no seed.
4. THE Plot Lab SHALL run the Oracle Player against each instance and report the fraction of seeds that end in Primary Plot disruption before the final stage.
5. THE Plot Lab SHALL check debrief coherence: every debrief timeline entry references an executed or disrupted stage, every Twist has Twist Propositions, and every Plot appears in the debrief.
6. THE Plot Lab SHALL write a Markdown and CSV report, exit with a non-zero status WHEN any template falls below the configured thresholds (defaults: final verification 1.0, Oracle Player win rate 0.95, passive completion 0.9), and produce identical reports for identical inputs.
7. THE Plot Lab SHALL be the only component outside the engine with Truth Store access, and the import-boundary rule SHALL forbid `tui` and `player-view` from importing it.

### Requirement 19: Plot Template Library

**User Story:** As a player, I want a large, varied set of era operations, so that I keep finding new content.

#### Acceptance Criteria

1. THE Library Pack SHALL ship at least 16 Plot templates, excluding `subOnly` templates.
2. THE Library Pack SHALL cover each of these archetypes with at least one Plot template: defector abduction or exfiltration, sabotage, assassination, materiel smuggling, people smuggling, scientist recruitment, kompromat against an official, document theft, dangle against the Station, mole hunt, currency forgery and border-crossing network.
3. THE Library Pack SHALL include at least 4 templates with Runtime Branches, 3 with multiple Cells, 3 with Sub-Plots, 4 with a Twist (covering all three Twist kinds) and 6 that declare concurrency tags allowing them as Secondary Plots.
4. THE Library Pack SHALL ship at least 4 `subOnly` templates.
5. WHEN the Plot Lab runs over the slice's core city and every reference city pack provided by content-expansion THEN every Plot template SHALL meet the default thresholds of Requirement 18.6.

### Requirement 20: Side Thread Template Library

**User Story:** As a player, I want the city full of era-appropriate private dramas and petty crime, so that the background feels lived in.

#### Acceptance Criteria

1. THE Library Pack SHALL ship at least 24 Side Thread templates.
2. THE Library Pack SHALL include at least 8 Lookalike Side Thread templates, together imitating at least 6 different Plot archetypes.
3. THE Library Pack SHALL include at least 10 Side Thread templates with spawn mode `midgame`.
4. WHEN the Plot Lab runs Side Thread checks THEN every Side Thread template SHALL bind and pass verification in the slice's core city.

### Requirement 21: Era and Fiction Constraints

**User Story:** As a player, I want the operations to feel true to the early Cold War without featuring real people, so that the setting is immersive and fictional.

#### Acceptance Criteria

1. THE Template Schema v2 SHALL require each template to declare an era range of years, and the Selection Model SHALL exclude templates whose range excludes the city pack's year.
2. THE Template Schema v2 SHALL let a pack declare an allowed proper-noun list, and the Content Loader SHALL reject library template literal text that contains a capitalised non-sentence-initial token outside slots, the allowed list and the common-word allowlist.
3. THE Library Pack SHALL reference persons only through role slots and Template Parameters.
4. THE Library Pack SHALL use only the slice's Channel kinds and cipher kinds (Slice Req 9.2, 25.1).
