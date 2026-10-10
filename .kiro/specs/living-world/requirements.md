# Requirements Document

## Introduction

Tradecraft already has a deterministic Sim that owns every fact, and two places where local models write text live. NPCs speak through the dialogue pipeline (Slice Req 4–6), and the Narrator writes short Flavour around Fact Lines (Slice Req 20). Both are fenced by the Leak Guard (Slice Req 5.2), the Specifics Guard (Slice Req 20.4) and the refusal check (Slice Req 16.3). Everything else the player reads is rendered from templates with no model involved. That covers newspapers, Cables, Dossiers, notices, rumours and the debrief (Slice Req 30.1; ambient-world Req 14–15). The offline Authoring Aid (content-expansion Req 16) exists but has never been run.

The playability audit of 9 October 2026 (`docs/audit-playability-realism-2026-10-09.md`) measured the result. All 38 newspaper editions of one game carried the same text. HQ answers with three stock replies, walk-ins arrive as one-line notices, and the shipped game draws from 3 plots and 4 side threads. The owner's goal for this spec is a game that feels alive and never plays the same way twice, with no mistakes.

This spec delivers that goal in three layers:

1. **Variety at scale (offline).** Local models draft large libraries of plots, side threads, rumours, incidents, names, style sheets and fallback templates through the existing Authoring Aid. A second local model reviews each batch, the repo's gates prove it, and the owner signs it off. A separate scenario turns the plot library, the ambient world and the authored city packs on together.
2. **Living prose (runtime).** Every text surface the player reads can be written live by a local model. The model works from a Fact Sheet, a structured summary of exactly what the player is allowed to know about the thing being written. Before any text is shown, it must pass a mechanical Mistake Gate and a Round-Trip Fact Check, which extracts the text's claims and compares them with the sheet. It must also pass a Quality Gate scored by a second, different model. Text that fails falls back to authored text inside its deadline. Prose is presentation only. It never becomes a fact, a Claim or a state change.
3. **World proposals (runtime).** A model may propose small additions to the world, such as a rumour, an incident, a townsperson, a life event, a side thread or a city event. It may only choose from a closed menu the engine builds. The engine checks each proposal against a Protected Set, the arrest-evidence rules, the difficulty budgets and the ambient Solvability Gate. Only then does it commit the proposal, as a recorded World Input at a day boundary. The model never sees the Plot.

The design principle is that **the engine owns every fact; models write text from facts and propose changes the engine verifies.** Three consequences follow. Factual mistakes are prevented by construction: no model output can change the case, leak a secret or contradict ground truth. Writing quality is enforced by gates and measured by release criteria, and a failure costs only a fallback to authored text. Replays stay exact because every model output that reaches the player or the world is recorded.

### Criteria this spec amends

The spec conventions require meaning changes to be stated here:

- **Slice Req 2.3** is amended. Model outputs may produce utterances, Intents, Claims, Prose and Proposals. A Proposal becomes ground truth only when the Proposal Verifier commits it (Requirement 13 below). Prose never does. Slice Req 2.3's first sentence still holds for every model output: no model output creates, modifies or deletes ground truth directly.
- **Content-expansion Req 16.8** is narrowed. The Authoring Aid is still never called at runtime. Content kinds (templates, archetypes, predicates, cities, style sheets) still come only from committed pack files. At runtime, models may write Prose and propose instances built from those packs, through this spec only.
- **Slice Req 17.4 and ambient-world Req 1.2** are extended. The replay inputs are the seed, the action log and the Living Ledgers (Requirement 11), plus the recorded gateway for dialogue as today.
- **Slice Req 4–6 (the dialogue pipeline) are extended, not replaced.** The voice, Leak Guard, Refusal Guard and extraction stay. Requirement 20 adds a Conversation_Brief to what the voice receives, a visible player line, and optional suggested replies. NPC assertions still become Claims only through extraction.
- **Slice Req 30.1 is unchanged.** Every Document's `body` is still rendered deterministically with no model involvement. Prose is a separate presentation layer (Requirement 2).
- **Ambient-world Req 1.3 is unchanged.** The Ambient_Sim makes no model calls. Accepted Proposals reach it as recorded World Inputs.
- **Slice Req 9.3 is unchanged.** Intercept plaintext and ciphers stay deterministic and model-free.

### Invariants that still hold

The engine owns all ground truth, and truth never crosses into Player View projections (Slice Req 2). Generation is deterministic for a given seed, `generatorVersion` stays `0.7.0`, and existing golden replays stay byte-identical. The one exception is the stream-overlap fix (Requirement 10.9). It changes every generated game, so it lands only with the owner's approval, as its own change with a `GENERATOR_VERSION` bump. Every Plot Stage stays solvable through two independent discovery paths (Slice Req 1.4; ambient-world Req 19). All people and organisations are fictional (content-expansion Req 3). With `living.enabled` absent or false, the game behaves exactly as it does without this spec.

### Order and dependencies

This spec follows content-expansion, plot-library and ambient-world, which are implemented. It needs no part of setting-generalization or natural-language-commands. It reuses natural-language-commands' closed-menu pattern (natural-language-commands Req 2, 3, 11) for proposals. The audit's plain-sentence renderer for Claims is built here, as task 1.1, because Fact Sheets need it. The other Priority 1 fixes from the audit are recommended first but are not prerequisites. In a multi-city region, Prose works in every city, and Proposals apply only to the Current City at full fidelity (multi-city Req 11).

### Out of scope

The following are out of scope:

- images (web-shell Req 11);
- spoken audio;
- intercept plaintext and cipher puzzles;
- model-invented mechanics, meaning new action, predicate, channel or cipher kinds;
- cloud models;
- fine-tuning;
- Proposals for non-current cities;
- changing calibration bands;
- enabling any part of this spec in the shipped `config/scenario.yaml`.

## Glossary

Terms from the slice (`tradecraft`), content-expansion, plot-library, ambient-world and multi-city keep their meanings. New terms:

- **Living_World**: The feature set this spec defines: Living Prose, World Proposals and the Authoring Factory.
- **Prose**: Model-written player-facing text produced through this spec. Prose is presentation only.
- **Prose_Surface**: A kind of player-facing text that can carry Prose, such as a newspaper article or an HQ Cable (Requirement 4).
- **Prose_Job**: One request to write one piece of Prose for one surface, from one Fact_Sheet.
- **Fact_Sheet**: The structured, player-safe input to a Prose_Job. It holds the facts, the allowed entities and specifics, the context, the style sheet and the constraints.
- **Must_Cover**: The Fact_Sheet facts that a text must convey, for example the Propositions a newspaper article asserts.
- **Record_Text**: The deterministic, template-rendered text of a surface, such as a Document's `body` or a Fact Line. It is always available to the player.
- **Authored_Fallback**: Pack-authored text for a surface, rendered from the same facts (content-expansion Req 8 Template Variants), shown when Prose is not ready or fails.
- **Live_Writer**: The component that runs Prose_Jobs through the `writer` role.
- **Mistake_Gate**: The ordered mechanical checks every Prose text passes before release (Requirement 6).
- **Round_Trip_Check**: Extracting a text's factual claims with the `bookkeeping` role and comparing them with its Fact_Sheet (Requirement 7).
- **Critic**: The `critic` role, a model different from the writer's, which scores Prose against a surface rubric.
- **Quality_Gate**: The Critic's threshold check (Requirement 8).
- **Shown_Text**: Text the player has been shown. Shown_Text is final for that game.
- **Prose_Ledger**: The per-game record of every released text and its provenance.
- **Seen_Text_Index**: The per-game shingle index of released text, used to reject repetition.
- **Texture_Ledger**: The per-game store of descriptive, non-fact details already shown about a Location, person or outlet, kept for continuity.
- **Proposal**: A structured suggestion from the `proposer` role to add an instance to the world, built only from Proposal_Menu entries.
- **Proposal_Kind**: One of the closed set of Proposal kinds (Requirement 12).
- **Proposal_Menu**: The engine-built list of what may be proposed for the next day boundary: templates, bindable ids per slot and parameter ranges.
- **Protected_Set**: Entities, Locations, Channels, items and time windows that Proposals may never touch. These are the Plot and everything a pending Plot Stage or a stored witness path depends on.
- **Proposal_Verifier**: The engine module that validates and commits Proposals.
- **World_Input**: A committed Proposal, recorded with the day boundary it was committed at.
- **Living_Ledgers**: The Prose_Ledger and the World_Input_Ledger together.
- **Pacing_Signal**: A deterministic summary of player-visible pacing, given to the Proposer as context.
- **Authoring_Factory**: The offline batch driver over the Authoring Aid, with two-model review and automated gates.
- **Variety_Report**: The offline measurement of how different games are from each other, and how repetitive a single game is.
- **Model_Playtester**: An offline agent that plays whole games through the Engine API, using only player-visible text and live models.
- **Surface_Release_Gate**: The measured criteria a Prose_Surface must meet before the living scenario lists it by default.
- **Conversation_Brief**: The player-safe, per-scene input to the NPC voice: who this person is to the player, how the last meeting ended, what they have already told the player, their current mood and want, and the topics they may raise.
- **Opening_Beat**: The first thing an NPC says or does when a Talk Scene opens, chosen to fit the situation.
- **Suggested_Reply**: An optional reply the Page offers, each mapped to a closed engine intent.
- **Deadline_Class**: A surface's latency class: `interactive`, `deferred` or `post-game`.

## Requirements

### Requirement 1: Living World Mode and Configuration

**User Story:** As the owner, I want the living world behind clear switches and a separate scenario, so that the shipped game and every existing result stay exactly as they are until I choose otherwise.

#### Acceptance Criteria

1. THE Living_World SHALL be off unless a scenario sets `living.enabled: true`.
2. THE shipped `config/scenario.yaml` SHALL NOT set `living.enabled`, and THE repository SHALL ship `config/scenario-living.yaml` as the scenario that turns it on.
3. WHILE `living.enabled` is absent or false THEN THE Sim, Player View, saves, Outcome Records and golden replays SHALL be byte-identical to a build without this spec, and THE game SHALL make no `writer`, `critic` or `proposer` call.
4. WHERE `living.prose.surfaces` lists Prose_Surfaces THEN only the listed surfaces SHALL use Prose, and every other surface SHALL show its Record_Text or Authored_Fallback.
5. WHERE `living.proposals.enabled` is false THEN THE Sim SHALL request and commit no Proposal.
6. THE new-game options SHALL offer the Living_World as `off`, `prose`, or `prose and proposals`, overriding the scenario in the way the mole and narration options do. THE save SHALL record the choice.
7. IF the `living` block is invalid THEN THE launcher SHALL refuse to start and report each error as `<file>: <field path>: <message>` (Slice Req 41.2).

### Requirement 2: The Fact Boundary

**User Story:** As a player, I want the living text to never change the facts of the case, so that the mystery stays fair however the words come out.

#### Acceptance Criteria

1. THE Sim SHALL NOT create, modify or delete ground truth, Claims, Observations, Notifications, Journal fact entries or any World State from Prose.
2. WHEN the player reads a Document THEN THE Case File SHALL gain exactly the Claims its `asserts` names, whichever text was displayed (extends Slice Req 20.6 and 30.1).
3. THE Sim SHALL keep every Document's `body` as deterministic Record_Text rendered with no model involvement (Slice Req 30.1).
4. THE Sim SHALL commit a Proposal only through the Proposal_Verifier, at a day boundary, inside that boundary's Turn Transaction (Slice Req 42.1).
5. THE Sim SHALL NOT let any `writer`, `critic` or `proposer` output select, alter or influence Plot Stages, deadlines, the Cell, the mole, the Hostile Service's beliefs, Cover Suspicion or arrest evidence.
6. THE Sim SHALL place no player-typed text in any `writer`, `critic` or `proposer` prompt.

### Requirement 3: Fact Sheets

**User Story:** As a player, I want living text to know only what I am allowed to know, so that it never leaks hidden truth or invents details.

#### Acceptance Criteria

1. WHEN a Prose_Job is created THEN THE Player View SHALL build its Fact_Sheet only from Player View data, player-visible events and the Documents and Fact Lines the job is about (Slice Req 2.2, 39.7).
2. WHERE the surface is the post-game case history THEN THE Fact_Sheet MAY also use the revealed truth the Debrief view already exposes (Slice Req 19).
3. THE Fact_Sheet SHALL hold the surface, the facts as plain sentences (each carrying its PropId when it comes from a Proposition), the Must_Cover subset, and the allowed entities with labels and aliases. It SHALL also hold the allowed specifics (names, numbers, dates, places), the context (city, district, weather, phase, date label), the style sheet, the established Texture details, the recent openings to avoid, the era year and the length bounds.
4. THE Fact_Sheet SHALL contain no Truth-branded value and no entity outside the player's known or public set, except as criterion 2 allows.
5. THE Fact_Sheet SHALL be a pure function of the state and the job, and its content hash SHALL identify the job in the Prose_Ledger.
6. THE Player View SHALL render every Proposition as a plain English sentence that uses names or descriptors and no predicate codes or ids. THE same renderer SHALL serve Fact Lines, the Case File, the Journal and Fact_Sheets.

### Requirement 4: Prose Surfaces

**User Story:** As a player, I want the papers, the cables, the gossip and the scenes to be written for my game from what I did, so that the city reacts to me and no two games read alike.

#### Acceptance Criteria

1. THE Living_World SHALL support these Prose_Surfaces:
   - `newspaper-article` and `newspaper-headline`;
   - `hq-cable`, covering the starting brief, replies to traces, reports and funds requests, Directive issue and resolution, and commendations and reprimands;
   - `dossier-narrative`;
   - `rumour-telling`;
   - `scene`, covering Location Flavour, arrivals, and tail and countersurveillance moments;
   - `notice`;
   - `employer-message`;
   - `walk-in-opener`;
   - `case-history`, written after the game.
2. WHEN a newspaper edition is composed THEN THE Sim SHALL create one `newspaper-article` Prose_Job per article, whose Must_Cover facts are the Propositions that article asserts, and SHALL leave the edition's `asserts` unchanged.
3. WHERE an outlet has a slant THEN its Prose SHALL be written in that outlet's style sheet (ambient-world Req 14).
4. WHEN HQ sends a Cable THEN its Prose SHALL be in period cable form: a routing header, numbered paragraphs and pack cryptonyms. It SHALL state the engine's decision (approved, refused, trace result, Directive terms) unchanged.
5. WHEN a Walk-in occurs AND `walk-in-opener` is enabled THEN THE Sim SHALL open a Talk Scene with the walk-in NPC on the player's next visit to the Station. Whether the walk-in is genuine or a Dangle SHALL remain engine truth (Slice Req 11.2, 22.7, 39.3).
6. WHEN the game ends AND `case-history` is enabled THEN THE Sim SHALL write a case history of the operation and the player's decisive actions from the Debrief view.
7. THE `scene` surface SHALL keep Slice Req 20 behaviour: Fact Lines first, Flavour after, and Location Flavour cached per phase and crowd band.
8. EACH Prose_Surface SHALL declare a Deadline_Class. `scene` and `walk-in-opener` are `interactive`. `case-history` is `post-game`. Every other surface is `deferred`.

### Requirement 5: Live Writer and Scheduling

**User Story:** As a player, I want living text to appear without waiting, so that the game always feels responsive.

#### Acceptance Criteria

1. THE Live_Writer SHALL run every Prose_Job through the `writer` role, except `scene`, which keeps the `narrator` role (Slice Req 14.6).
2. WHEN the engine has decided a deferred surface's content (an edition composed, a Cable queued, a Dossier delivered, a rumour circulating) THEN THE Live_Writer SHALL start its Prose_Job in the background.
3. THE LLM Gateway SHALL run Living_World calls in a `background` priority band below every interactive band, as preemptible jobs. WHEN an interactive call is waiting THEN THE scheduler SHALL preempt the running background call and re-queue it.
4. WHEN a Prose_Job's Fact_Sheet hash already has a Prose_Ledger entry THEN THE Live_Writer SHALL reuse that text without a model call.
5. WHEN the player opens a surface whose Prose is not ready THEN THE Player View SHALL show its Authored_Fallback at once, and SHALL NOT replace it later in that game.
6. THE Player View SHALL never change Shown_Text, including across save and load.
7. WHEN the session closes THEN THE Live_Writer SHALL cancel its pending jobs. THE save SHALL store only finished, released text.

### Requirement 6: Mistake Gate

**User Story:** As the owner, I want every piece of living text checked mechanically before anyone sees it, so that no invented name, number, date, anachronism or real person ever reaches the screen.

#### Acceptance Criteria

1. THE Mistake_Gate SHALL reject a text that names any registered entity outside its Fact_Sheet's allowed entities (Slice Req 5.2).
2. THE Mistake_Gate SHALL reject a text containing a numeral, number word, day name, date, clock time or proper name absent from its Fact_Sheet's allowed specifics (Slice Req 20.4).
3. THE Mistake_Gate SHALL reject a text containing an Anachronism Entry for the game's year and city, a Real-Person Blocklist match or a Sensitivity Term (content-expansion Req 12). These checks SHALL NOT be suppressible.
4. THE Mistake_Gate SHALL reject a refusal or an out-of-character meta response (Slice Req 16.3).
5. THE Mistake_Gate SHALL reject a text that breaks a mechanical Style Guide rule for its surface: length bounds, terminal stop, no exclamation, cable upper case, headline length and first person.
6. THE Mistake_Gate SHALL reject a text containing words outside English and the era and city Locale allowlist.
7. THE Sim SHALL never show a rejected text, in whole or in part. Streaming surfaces SHALL release text one sentence at a time, only after that sentence passes (Slice Req 5.2).
8. THE Sim SHALL log every rejection with its class, surface, model id and Fact_Sheet hash.

### Requirement 7: Round-Trip Fact Check

**User Story:** As a player, I want to be sure a newspaper or cable says what really happened and nothing more, so that I can trust what I read as much as the record.

#### Acceptance Criteria

1. WHEN a text with Must_Cover facts passes the Mistake_Gate THEN THE `bookkeeping` role SHALL extract its factual claims with the existing extraction schema (Slice Req 14.4).
2. IF an extracted claim is not entailed by a Fact_Sheet fact (same predicate, and the same subject, object and place after alias resolution) THEN THE Round_Trip_Check SHALL reject the text as an invented fact.
3. IF a Must_Cover fact has no matching extracted claim THEN THE Round_Trip_Check SHALL reject the text as a missing fact.
4. IF extraction fails or times out THEN THE Round_Trip_Check SHALL reject the text.
5. WHERE a text has no Must_Cover facts (`scene` Flavour) THEN THE Round_Trip_Check SHALL not run, and the Specifics Guard SHALL still apply (Slice Req 20.4).
6. THE Sim SHALL NOT add Round_Trip_Check claims to the Case File or the Journal.

### Requirement 8: Quality Gate

**User Story:** As the owner, I want living text to read like good period writing, not like a model, so that the world feels real.

#### Acceptance Criteria

1. WHEN a text passes the Mistake_Gate and the Round_Trip_Check THEN THE Critic SHALL score it with structured output against its surface rubric. The rubric covers period voice, the register of the outlet, desk or persona, clarity, concreteness within the allowed facts, freshness, consistency with Texture details, and restraint (aftermath restraint and offices by title).
2. THE Quality_Gate SHALL pass a text only if every criterion meets the configured threshold: 4 of 5 under `quality: strict`, 3 of 5 under `quality: standard`.
3. THE `critic` role SHALL use a different model from the `writer` role. IF they are the same model THEN THE launcher SHALL refuse to start under `strict` and warn under `standard`.
4. WHEN a text fails the Quality_Gate or any check THEN THE Live_Writer SHALL regenerate it with the failure notes, up to `living.prose.retries` attempts (default 2).
5. THE Sim SHALL never show Critic notes or scores to the player.
6. WHERE the surface is `scene` THEN THE Quality_Gate SHALL run after release on cached Location Flavour only, and a failing cache entry SHALL be regenerated for the next visit, never replaced in front of the player.

### Requirement 9: Fallback and Resilience

**User Story:** As a player, I want the game to keep going smoothly when a model is slow, wrong or offline, so that living text is a bonus and never a risk.

#### Acceptance Criteria

1. EACH Prose_Surface SHALL have an Authored_Fallback, rendered from the same facts with pack Template Variants, or else its Record_Text.
2. IF the writer, critic or extraction model is unreachable, slow or failing THEN THE surface SHALL show its fallback within its Deadline_Class, and THE game SHALL NOT pause for Prose.
3. THE Sim SHALL apply no partial result of a failed Living_World call to any state (Slice Req 16.4).
4. WHEN a surface has failed `living.prose.breakerFailures` consecutive times (default 5) THEN THE Live_Writer SHALL stop requesting that surface for `living.prose.breakerMinutes` (default 10). THE metrics log SHALL record the break.
5. THE Prose_Ledger SHALL mark every released text as `live`, `authored` or `record`.

### Requirement 10: Freshness and Continuity

**User Story:** As a player, I want the living text never to repeat itself and never to contradict what it said before, so that the city feels like one consistent place.

#### Acceptance Criteria

1. THE Player View SHALL index every released text in the Seen_Text_Index by 5-word shingles, excluding fixed formulae (mastheads and cable routing headers).
2. IF a candidate text shares more than `living.prose.maxOverlap` (default 0.15) of its shingles with any earlier released text in the same game THEN THE Mistake_Gate SHALL reject it as a repetition.
3. THE Fact_Sheet SHALL include the last 12 opening sentences released on its surface as openings to avoid.
4. WHEN a text is released THEN THE `bookkeeping` role SHALL extract up to 6 descriptive details per Location, person or outlet it describes into the Texture_Ledger. Later Fact_Sheets SHALL include those details, and the Critic SHALL score consistency with them.
5. THE Sim SHALL NOT treat Texture details as facts. They SHALL never enter the Case File or the Journal's fact log.
6. Each outlet, HQ desk and persona SHALL have a style sheet from the content packs.
7. THE Living_World SHALL draw every variation choice (style variant, opening, register) from a living PRNG stream family keyed by Fact_Sheet hash, and SHALL draw nothing from the slice, noise, daily, runtime or ambient streams.
8. THE engine SHALL give every PRNG stream family its own block in the PRNG stream registry, and no two families SHALL derive the same seed. A registry test SHALL enforce this. Until the fix in criterion 9 lands, the existing overlap of the setting stream and the cipher stream at `0x30000` SHALL be the only permitted exception, and the test SHALL report it by name.
9. WHERE the owner has approved the stream-overlap fix, THE cipher stream SHALL move to its own registry block, in a separate change that bumps `GENERATOR_VERSION`, re-records the affected golden replays and re-vets the featured seeds. From that change on, Requirement 1.3 and the invariants above SHALL compare against the fixed build.

### Requirement 11: Ledgers, Saves and Replay

**User Story:** As the developer, I want every model output that reaches the player or the world recorded, so that saves, replays and bug reports stay exact.

#### Acceptance Criteria

1. THE Prose_Ledger SHALL record every released text with its Fact_Sheet hash, surface, subject id, provenance, model ids, Critic scores, attempts and timings.
2. THE World_Input_Ledger SHALL record every committed Proposal with the day boundary it was committed at.
3. WHEN the Living_World is on THEN THE save SHALL include the Living_Ledgers, the Seen_Text_Index and the Texture_Ledger, and SHALL be written as save version 5. WHEN it is off THEN THE save SHALL be written exactly as version 4 is today. Version 3 and 4 saves SHALL still load, with the Living_World disabled.
4. WHEN a save is loaded THEN every text the player was shown SHALL display identically.
5. WHEN a session is replayed from its seed, action log and Living_Ledgers, with the recorded gateway for dialogue, THEN THE Sim SHALL reach an identical final state and identical displayed text with no model reachable.
6. THE recording gateway SHALL record `writer`, `critic` and `proposer` calls as it records dialogue (Slice Req 17.3).
7. THE Outcome Record SHALL gain only an optional, versioned `living` summary block of counts.

### Requirement 12: World Proposals

**User Story:** As a player, I want the city to surprise me with new people, rumours and happenings that fit what is going on, so that each game grows in its own direction.

#### Acceptance Criteria

1. WHERE proposals are enabled THEN THE Proposer SHALL be asked once per day, in the background, for Proposals for the next day boundary.
2. THE Proposal_Kinds SHALL be the closed set below. Each kind SHALL map to an existing deterministic mechanism:
   - `rumour` (Slice Req 29);
   - `local-incident` (ambient-world Req 5.9);
   - `life-event` for a non-principal NPC (ambient-world Req 9);
   - `townsfolk-introduction` (ambient-world Req 11);
   - `emergent-side-thread` (ambient-world Req 16);
   - `city-event` (ambient-world Req 5).
3. THE engine SHALL build the Proposal_Menu, listing per kind the allowed templates, the bindable ids per slot and the parameter ranges.
4. THE Proposal_Menu and the Proposer prompt SHALL contain no Protected_Set member and no Plot, Cell, mole, Hostile Service or Truth-branded data.
5. THE Proposer SHALL return schema-constrained output (Slice Req 14.4). THE Proposal_Verifier SHALL treat any id or value outside the Proposal_Menu as invalid.
6. A Proposal MAY carry a short pitch. THE Sim SHALL use the pitch only as writing material for later Prose, never as a fact.
7. THE Proposer prompt SHALL include the Pacing_Signal. That is a deterministic summary of days since the last notable public event, the player's recent public actions, open news stories and the city metrics the player can observe.
8. WHERE `ambient.enabled` is false THEN THE Proposal_Menu SHALL offer only the `rumour` kind.
9. THE Proposal_Menu SHALL exclude every template whose effects include an Ambient_Hook (ambient-world Req 18) or an Effect_Op that could target a Protected_Set member.

### Requirement 13: Proposal Verification and Commit

**User Story:** As a player, I want new happenings to never break the case or make it unwinnable, so that surprises stay fair.

#### Acceptance Criteria

1. WHEN a day boundary is processed AND Proposals are ready THEN THE Proposal_Verifier SHALL validate each one against the state at that boundary. It SHALL check the schema, Proposal_Menu membership, Protected_Set exclusion, the absence of any implicating predicate (Slice Req 40), the daily budget, and the difficulty preset's noise bounds (Slice Req 34).
2. IF a Proposal is a Structural_Change THEN THE Proposal_Verifier SHALL pass it through the ambient Solvability Gate, and SHALL accept it only if the Solvable_Set is preserved (ambient-world Req 19).
3. THE Sim SHALL apply each accepted Proposal through its existing deterministic mechanism as a World_Input, inside the boundary's Turn Transaction. THE Ambient_Sim SHALL stay model-free (ambient-world Req 1.3).
4. THE Proposal_Verifier SHALL drop a rejected Proposal without trace in the World State, and SHALL log the reason.
5. IF no Proposal is ready at a day boundary THEN THE boundary SHALL proceed exactly as it would with proposals disabled, without waiting.
6. THE Proposal_Verifier SHALL accept at most the daily budget for `living.proposals.rate`: 1 at `low`, 3 at `standard` and 5 at `high`.
7. Accepted Proposals SHALL reach the player only through existing visibility rules (Slice Req 39).
8. WHERE proposals run at `standard` with the deterministic fake proposer THEN THE calibration bands in `playability.calibration.spec.ts` SHALL hold on the CI sample. THE README Balance section SHALL record the measurement.

### Requirement 14: Model Roles, Resources and Latency

**User Story:** As the owner, I want the living world to run on my Mac with the models I already have resident, so that it costs no extra memory and stays quick.

#### Acceptance Criteria

1. `config/models.yaml` profiles SHALL accept the roles `writer`, `critic` and `proposer`.
2. IF a profile omits a new role THEN THE config loader SHALL derive it: `writer` and `proposer` from the profile's `narrator` model, and `critic` from its `voice` model.
3. THE derived defaults SHALL keep the resident model set unchanged (Slice Req 14.5; Slice Req 43).
4. THE Sim SHALL meet these targets on the Reference Machine:
   - first released `scene` sentence ≤ 2 s (Slice Req 15.3);
   - median `deferred` Prose end to end, including all gates, ≤ 25 s;
   - Proposals ready before the day boundary they target.
5. THE metrics log SHALL record, for every Living_World call: role, model, time to first token, duration, tokens per second, attempt number and gate outcome (Slice Req 15.6).
6. Living_World prompts SHALL order content from most static to most dynamic for prefix caching (Slice Req 15.1), and SHALL fit within `contextLength`.
7. THE Living_World SHALL send requests only to a local endpoint, unless the config sets `allowRemote: true` and the launcher receives `--remote` (content-expansion Req 16.7).

### Requirement 15: Variety at Scale

**User Story:** As the owner, I want my local models to grow the game's libraries far beyond what was hand-written, safely, so that the structure of every game differs and not just the words.

#### Acceptance Criteria

1. THE Authoring_Factory SHALL drive the Authoring Aid in batches from brief files under `content-briefs/`, for any kind in the Content Kind Registry.
2. WHEN a batch is drafted THEN THE Authoring_Factory SHALL have it reviewed by a different local model from its author. The reviewer SHALL write `<stamp>.review.md` beside the draft, and the author model SHALL revise the batch until the review is clean, or for at most 3 rounds.
3. WHEN a batch is clean THEN THE Authoring_Factory SHALL run, in a staging copy:
   - the release lint;
   - previews on at least 3 seeds;
   - coverage;
   - Plot Lab for plot and side-thread kinds (plot-library Req 18);
   - the balance probe for anything touching plots, difficulty, services or routes.
   It SHALL then write a `SIGN-OFF.md` digest.
4. THE Authoring_Factory SHALL promote nothing without the owner's sign-off and a `reviewedBy` (content-expansion Req 16.4, 16.5).
5. THE Authoring_Factory SHALL live in `content-tools` and make no runtime calls (content-expansion Req 16.1).
6. THE `living` lint profile SHALL enforce these Variety Targets for the packs `config/scenario-living.yaml` loads:
   - at least 40 plot templates that bind in every loaded city;
   - 60 side-thread templates;
   - 150 rumour templates;
   - 120 incident templates;
   - 12 outlet style sheets;
   - 6 HQ desk style sheets;
   - 300 names per Culture Group (content-expansion Req 11.4);
   - 200 persona backgrounds and 150 Descriptor Fragments (content-expansion Req 11.6);
   - an Authored_Fallback for every Prose_Surface.
7. `config/scenario-living.yaml` SHALL load the plot library, the ambient pack, the era pack and the authored city packs, with `plotSelection.enabled` and `ambient.enabled` set.
8. WHERE the Living_World is enabled THEN descriptor composition SHALL draw at most one fragment per slot, and SHALL reject fragment combinations that the fragments' tags mark as exclusive.

### Requirement 16: Measuring Variety

**User Story:** As the owner, I want "never the same game twice" measured, so that I know it is true and know when it slips.

#### Acceptance Criteria

1. `pnpm living:variety --scenario <file> --seeds <n>` SHALL run with no model, using recorded or fake prose. It SHALL report structural variety, cross-game text overlap, within-game repetition and unrelated shared surnames.
2. THE Variety_Report SHALL measure, over the seed sample:
   - the probability that two seeds share both plot template and city;
   - the mean pairwise overlap of cast archetypes;
   - the mean cross-game 5-word-shingle overlap of displayed Prose;
   - the within-game repeated-sentence rate;
   - the count of unrelated NPCs who share a surname.
3. THE CI SHALL hold Variety bands in `living.variety.bands.ts`. The initial bands are a shared plot-and-city probability ≤ 0.05, cross-game Prose overlap ≤ 0.03, within-game repeated sentences ≤ 0.5%, and a median of at most 1 unrelated shared surname per game.
4. Changing the Variety bands SHALL require the owner's approval, as changing the calibration bands does.

### Requirement 17: Release Gates and Evaluation

**User Story:** As the owner, I want proof that each kind of living text is good before it is switched on by default, so that I am never surprised by bad writing.

#### Acceptance Criteria

1. THE evals package SHALL provide a Living suite. For each surface, it SHALL build at least 200 Fact_Sheets from at least 20 seeds, run them through the writer and every gate, and report pass rates by gate, attempts, fallback rate, Critic scores and latency percentiles.
2. A surface SHALL be listed in `config/scenario-living.yaml`'s default surfaces only when it meets its Surface_Release_Gate:
   - no released text fails a Mistake_Gate or Round_Trip_Check criterion;
   - first-attempt acceptance ≥ 85%;
   - live acceptance before fallback ≥ 97%;
   - Critic mean ≥ 4.0, with no criterion mean below 3.5;
   - p95 latency within its Deadline_Class;
   - the owner has approved 20 random samples.
3. THE Model_Playtester SHALL play whole games through the Engine API, using only player-visible text and live models, and SHALL record transcripts and metrics. It SHALL also score immersion, repetition and coherence with the `judge` role. Each release candidate SHALL get at least 5 games per enabled mode.
4. THE adversarial suite SHALL drive a fake writer that emits each mistake class at least 50 times:
   - unknown entities;
   - invented numbers, dates and names;
   - anachronisms;
   - real names;
   - sensitivity terms;
   - refusals and meta text;
   - repetition;
   - overlong text;
   - contradicted facts;
   - injected instructions.
   THE gates SHALL block 100% of them.
5. THE README SHALL record the latest Living suite and Variety_Report results, beside the Balance table.

### Requirement 18: Player Experience and Transparency

**User Story:** As a player, I want living text to feel seamless, with the plain record always available, so that I can trust the game.

#### Acceptance Criteria

1. THE Sim SHALL never make the player wait for Prose beyond its Deadline_Class. Only the `post-game` case history MAY show a progress indicator.
2. Every Document view SHALL offer its Record_Text as "the file copy".
3. WHERE the developer flag `--provenance` is set THEN both shells SHALL mark each text as live, authored or record. The flag SHALL be off by default.
4. THE terminal and web shells SHALL show the same Prose for the same game (web-shell Req 10).
5. WHERE narration is `off` THEN THE Sim SHALL show Record_Text and Fact Lines only, and WHERE narration is `brief` THEN THE Sim SHALL cap Prose length at the surface's brief bound (Slice Req 20.8).

### Requirement 19: Injection Resistance

**User Story:** As the owner, I want the living world safe against text that tries to steer the models, so that nothing a player or a document says can make a model break the rules.

#### Acceptance Criteria

1. THE Sim SHALL place Fact_Sheet content in the user role as delimited data, and SHALL keep instructions only in system content (Slice Req 5.5).
2. THE Sim SHALL treat Writer output only as text to check and display, and SHALL never execute it or read it as instructions.
3. THE Sim SHALL use Proposer output only as schema-validated data.
4. THE adversarial suite SHALL include Fact_Sheets whose strings contain instruction-like text, and the gates SHALL block every attempt to echo or obey them.

### Requirement 20: Conversations

**User Story:** As a player, I want a conversation to read like two people talking, with them reacting to what I said, remembering what happened before, and sometimes steering it, so that talking to someone is never the same twice and never a monologue.

#### Acceptance Criteria

1. WHEN the player says a line in a Talk Scene THEN THE Shell and the Page SHALL show that line in the feed, attributed to the player, before the NPC's reply. This SHALL hold whether or not the Living_World is on, and SHALL not depend on any model.
2. A shown player line SHALL be exactly the text the player entered, trimmed, and SHALL be part of the action log's existing `line` record. It SHALL NOT be rewritten, summarised or paraphrased.
3. WHILE `living.enabled` is on THE voice SHALL receive a Conversation_Brief built only from Player View data: the person's name or descriptor, the Regard and relationship the player can see, the outcome of the last meeting as the player knows it, the lines the NPC has already told the player (from the Prose_Ledger and recorded Claims), the persona's register, and the place, phase and weather.
4. THE Conversation_Brief SHALL include a mood and a want for this scene, chosen by the engine from the persona and the player-visible situation. The NPC MAY ask the player a question, push back, deflect, change the subject or end the talk, but SHALL NOT assert a fact outside the person's Knowledge Slice.
5. THE Opening_Beat SHALL differ by situation: first meeting, repeat meeting, walk-in, meeting after a refusal, and meeting after a favour. It SHALL be gated by the Mistake_Gate and SHALL NOT repeat any of that NPC's last 12 opening lines.
6. THE NPC's reply length SHALL follow the persona's register (terse, ordinary, talkative) within the existing token budget. An NPC SHALL NOT produce more than three consecutive replies of the same length class.
7. A reply SHALL not repeat, by shingle overlap above `living.prose.maxOverlap`, any earlier reply from the same NPC in this game (Requirement 10.2).
8. THE Page SHALL be able to offer up to four Suggested_Replies. Each SHALL map to one closed engine intent already in the catalogue (for example ask about a place, ask about a person, make a pitch, offer money, end the talk), and SHALL be built from the Player View only. Choosing one SHALL send the same line the player could have typed. The player SHALL always be able to type freely instead.
9. THE existing Leak Guard, Refusal Guard and extraction SHALL apply unchanged to every reply. WHEN the Living_World is off THEN the Conversation_Brief and Suggested_Replies SHALL not exist, and the voice SHALL behave as today.
10. A conversation SHALL end at the player's request, at the NPC's decision (criterion 4) or when the scene's phase budget is used. An NPC ending the talk SHALL leave a one-line outcome in the feed.
