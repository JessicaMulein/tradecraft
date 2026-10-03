# Requirements Document

## Introduction

The ambient world turns the slice's city (spec `tradecraft`, referred to here as "the slice") into a living place that keeps changing around and between the Plot. Background and Principal NPCs live daily lives, form ties with each other and remember the player. A deterministic event system produces city-wide happenings such as strikes, festivals, elections, police crackdowns, weather events and border incidents. A rolling news cycle follows those happenings across days. Locations close, open, get raided and reopen. New Side Threads start mid-game. The player's Cover Identity makes demands on their time.

The setting is the early Cold War (late 1940s to 1960s) in real cities such as Vienna, Berlin, Istanbul, Lisbon, Helsinki and Trieste. Every character is fictional. Technology, documents and tradecraft are period-accurate.

This spec builds on the completed slice and keeps every slice invariant:

- The Sim owns all ground truth. The ambient simulation is part of the Sim, is deterministic code and makes no language model calls.
- Determinism holds from `(seed, generatorVersion, ContentManifest, DifficultyPreset)` plus the action log (slice Req 1.2, 17.4).
- Truth isolation holds: the Player View and Case File contain no ambient ground truth (slice Req 2).
- Model outputs never write facts (slice Req 2.3).
- Every Plot Stage stays solvable (slice Req 1.4).

Owned by other follow-on specs, and treated here as interfaces: city pack schema, city-specific content, the Tag Vocabulary and the Content Kind Registry through which this spec registers its content kinds (content-expansion), Plot and Side Thread template formats (plot-library), chained postings and the Outcome Record consumer (campaign-career), and several cities in one game, including the `AmbientSimulator` interface that this spec implements in multi-city mode (multi-city). This spec adds nothing to the Outcome Record.

Implementation order: content-expansion → plot-library → ambient-world → campaign-career → multi-city. content-expansion tasks 1–2 are a hard prerequisite.

## Glossary

Slice glossary terms keep their meaning. New terms:

- **Ambient_Sim**: The engine module that runs the city between and around the Plot. It covers City Metrics, City Events, Location Status, NPC life, memory, gossip, the news cycle, Emergent Threads and Cover Duties.
- **Ambient_Tick**: The Ambient_Sim's deterministic step. It runs once per phase and once per day boundary inside the slice clock's `advance`.
- **Ambient_Stream**: The PRNG stream family the Ambient_Sim uses. Each draw comes from a sub-stream keyed by day and by a stable key, so draws do not depend on processing order.
- **City_Metric**: One of a fixed set of city-wide numbers in [0, 1]: unrest, police pressure, shortage, East–West tension and festivity.
- **Exogenous_Metric**: The part of a City_Metric driven only by Exogenous Events.
- **City_Event**: A city-wide or district-wide happening instantiated from an Event_Template. It has stages, a duration, Effect_Ops and an `evt:` entity id.
- **Event_Template**: A content definition of a City_Event: category, preconditions, weight, cooldown, exclusion tags, stages and Effect_Ops.
- **Exogenous_Event**: A City_Event whose scheduling reads only the seed, the day, the Content Set, the preset and Exogenous_Metrics.
- **Reactive_Event**: A City_Event triggered by Sim state that player actions can influence, such as a crackdown after a public arrest.
- **Effect_Op**: An operation from the closed, code-defined set that a City_Event may apply to the world.
- **Local_Incident**: A small happening at one Location in one phase, such as a quarrel, a delivery or a pickpocketing.
- **Location_Status**: A time-bounded overlay on a Location that changes its effective hours, risk, crowd, allowed actions or availability. Kinds are open, closed-temporarily, raided, requisitioned, under-renovation, closed-permanently and newly-opened.
- **Dormant_Location**: A Location generated at world generation but inactive until an Effect_Op opens it.
- **Structural_Change**: An ambient change that can affect discovery paths: a Location_Status other than open, a route closure, a schedule deviation for a Principal NPC, an NPC departure or detention, or a Channel outage.
- **Solvable_Set**: The set of pending Plot Stage key Propositions (and the mole's identity, when a mole is enabled) that have two disjoint discovery paths under the slice verifier's rules.
- **Anchor_Slot**: A schedule entry `(npc, weekday, phase, loc)` that a current witness path or a pending Plot trace depends on.
- **Life_Tier**: An NPC's simulation fidelity. `full` NPCs have life state, ties, memory and agendas. `coarse` NPCs (Townsfolk) have a schedule template and a small memory.
- **Townsfolk**: Coarse-tier civilian NPCs drawn from civilian archetypes, generated in a pool at world generation.
- **Promotion**: Moving a Townsfolk NPC to the full Life_Tier. **Demotion** moves it back.
- **Life_Event**: A change in a full-tier NPC's life from a Life_Event_Template, such as job loss, illness, debt, romance, promotion at work or a family visit.
- **NPC_Tie**: A directed relationship between two NPCs with a kind (kin, friend, colleague, romantic, rival, creditor) and an affinity.
- **Recollection**: An NPC's memory entry about the player, with a kind, time, Location, salience and grounding source.
- **Regard**: An NPC's hidden opinion of the player: warmth, wariness and familiarity, each in [0, 1].
- **Gossip_Item**: A Proposition or Recollection passed from one NPC to another.
- **Informant**: An NPC who reports Gossip_Items about the player to the host-country police or the Hostile Service.
- **Civic_Org**: A host-country organisation generated by the Ambient_Sim: police, press outlets, unions, parties, employers and the Cover Employer.
- **Outlet**: A newspaper with a name, a slant and a coverage profile.
- **Story**: A news topic tied to a City_Event, Side Thread, Rumour or public Plot trace, with ordered developments covered across editions.
- **Notice**: A public posted Document at a Location, such as a curfew order, a festival programme or a wanted poster.
- **Emergent_Thread**: A Side Thread instantiated mid-game by the Ambient_Sim.
- **Cover_Duty**: An obligation of the player's Cover Identity with a Location, a slot, a phase cost and an effect on Cover_Standing.
- **Cover_Standing**: The Cover Employer's satisfaction with the player's cover work, in [0, 1].
- **Cover_Employer**: The Civic_Org that employs the player's Cover Identity.
- **Ambient_Hook**: A declared, closed-set operation by which the Ambient_Sim may affect the Plot, the Hostile Service or Cover Suspicion. In multi-city mode every Ambient_Hook kind is also an AmbientCoupling kind of the same name.
- **AmbientSimulator**: multi-city's per-City interface (`advanceFull`, `advanceCoarse`, `reconcile`, `couplings`) that the Ambient_Sim implements in multi-city mode.
- **AmbientCoupling**: multi-city's closed set of effects through which Ambient state reaches the Spine, computed identically at both Fidelity Tiers.
- **Fidelity Tier**: multi-city's per-City simulation level: full for the Current City, coarse for every other City.
- **Player-Concerning Processing**: Recollections and Regard about the player, gossip transfers of player-related items and Informant reports about the player.
- **Ambient_Pack**: The Content Pack `ambient`, which depends on `core` and ships the ambient content kinds and default content.
- **Density**: The scenario setting `sparse`, `standard` or `rich` that scales ambient generation within the hard caps.

## Requirements

### Requirement 1: Ambient Simulation Determinism

**User Story:** As the developer, I want the living city to be fully deterministic, so that saves, replays and bug reports stay exact.

#### Acceptance Criteria

1. THE Ambient_Sim SHALL draw all randomness from the Ambient_Stream, keyed by day and by a stable key (event id, NPC id, Location id or turn id).
2. WHEN the same seed, generator version, Content Manifest, Difficulty Preset, scenario config and action log are used THEN the Ambient_Sim SHALL produce identical ambient state.
3. THE Ambient_Sim SHALL make no language model calls.
4. THE Ambient_Sim SHALL run every state change caused by a player action inside that action's Turn Transaction (slice Req 42.1).
5. WHILE ambient simulation is disabled in the scenario config THEN the Sim SHALL behave exactly as the slice.
6. THE Ambient_Sim SHALL draw nothing from the slice's core, noise, daily and runtime streams.

### Requirement 2: Simulation Budgets

**User Story:** As a player on the Reference Machine, I want a rich city that still runs quickly, so that the world feels alive without slowing play.

#### Acceptance Criteria

1. THE Ambient_Sim SHALL simulate at most 48 NPCs at the full Life_Tier and at most 160 Townsfolk per city.
2. THE Ambient_Sim SHALL start at most 2 City_Events per day and hold at most 6 active City_Events.
3. THE Ambient_Sim SHALL generate at most 12 Local_Incidents per day and at most 2 per Location per phase.
4. THE Ambient_Sim SHALL apply at most 6 Life_Events per day, and at most 1 per NPC per 7 days.
5. THE Ambient_Sim SHALL transfer at most 40 Gossip_Items per day.
6. THE Ambient_Sim SHALL run the solvability gate at most 6 times per day, and IF a Structural_Change would exceed that limit THEN SHALL drop the change.
7. THE Ambient_Sim SHALL enforce every cap by deterministic truncation in priority order, and SHALL NOT use wall-clock time in any decision.
8. THE Ambient_Sim SHALL target a day-boundary Ambient_Tick of ≤ 50 ms and a phase Ambient_Tick of ≤ 10 ms at the 95th percentile on the Reference Machine, and SHALL record actual timings to the metrics log.
9. THE Ambient_Sim SHALL keep ambient save data growth to ≤ 64 KB per game day and total ambient state to ≤ 4 MB.
10. WHERE Density is `sparse` or `standard` THEN THE Ambient_Sim SHALL scale the caps in criteria 2–5 by 0.5 or 0.75 respectively, rounded down with a minimum of 1.

### Requirement 3: Ambient World Initialisation

**User Story:** As a player, I want the city populated with institutions and ordinary people from the start, so that there is always more to find.

#### Acceptance Criteria

1. WHEN a new game is generated THEN the Ambient_Sim SHALL initialise after the slice's noise step, adding Civic_Orgs, Outlets, Townsfolk, NPC_Ties, Dormant_Locations and initial City_Metrics.
2. THE Ambient_Sim SHALL generate between 1 and 3 Outlets and between 2 and 4 Dormant_Locations per city.
3. THE Ambient_Sim SHALL only add entities and ties during initialisation, and SHALL leave every core and noise entity unchanged apart from appending to known-entity lists.
4. WHEN initialisation completes THEN the Sim SHALL re-run discovery-path verification, and IF it fails THEN SHALL re-initialise from the next derived ambient seed, up to 8 attempts, and then throw a `GeneratorError` naming the seed.
5. THE Ambient_Sim SHALL create a Cover_Employer for the player's Cover Identity.

### Requirement 4: City Metrics

**User Story:** As a player, I want the city's mood to shift over time, so that events follow from each other instead of appearing at random.

#### Acceptance Criteria

1. THE Ambient_Sim SHALL track each City_Metric as the clamped sum of an Exogenous_Metric and a reactive component.
2. WHEN each day ends THEN the Ambient_Sim SHALL decay each component toward its content-defined baseline at its content-defined rate.
3. WHEN a City_Event stage applies a metric delta THEN the Ambient_Sim SHALL add the delta to the Exogenous_Metric for an Exogenous_Event and to the reactive component for a Reactive_Event.
4. WHEN a public consequence of a player action occurs (a public arrest by the Station, a detected surveillance incident or a seized hostile Dead Drop) THEN the Ambient_Sim SHALL apply the content-defined reactive delta.

### Requirement 5: City Event System

**User Story:** As a player, I want city-wide events to unfold across days, so that the world keeps producing new situations.

#### Acceptance Criteria

1. WHEN each day starts THEN the Ambient_Sim SHALL select Exogenous_Events by weighted draw over Event_Templates whose preconditions hold against the calendar, the Exogenous_Metrics and the active Exogenous_Events.
2. WHEN each day starts THEN the Ambient_Sim SHALL select Reactive_Events from triggers queued during the previous day, evaluated against total City_Metrics and Sim state.
3. THE Ambient_Sim SHALL instantiate each City_Event with an `evt:` entity id registered in the Entity Registry, a start day, a duration of 1–14 days and 1–7 stages with day offsets.
4. WHEN a stage's day arrives THEN the Ambient_Sim SHALL apply that stage's Effect_Ops.
5. THE Ambient_Sim SHALL apply only Effect_Ops from this closed set: location-status, crowd-modifier, observation-modifier, detection-modifier, route-checkpoint, route-closure, curfew, npc-schedule-override, metric-delta, spawn-thread, news-development, post-notice, detain-npc and ambient-hook.
6. WHEN a City_Event ends THEN the Ambient_Sim SHALL remove every temporary overlay that the City_Event applied.
7. IF an Event_Template's cooldown has not elapsed since its last instance, or an active City_Event shares one of its exclusion tags, THEN THE Ambient_Sim SHALL exclude that Event_Template from selection.
8. WHERE an Event_Template has not yet occurred in the current game THEN THE Ambient_Sim SHALL multiply its selection weight by the content-defined novelty factor (default 2).
9. WHEN each phase starts THEN the Ambient_Sim SHALL generate Local_Incidents at Locations from Incident templates whose preconditions hold for the Location Type, the phase, the crowd level and the active City_Events.

### Requirement 6: Event Coverage

**User Story:** As a player, I want period-appropriate events of many kinds, so that the city feels like a real Cold War posting.

#### Acceptance Criteria

1. THE Ambient_Pack SHALL ship Event_Templates in each of these categories: labour (strikes, lockouts), festival and holiday, election, police crackdown, weather event, border incident, economic (shortages, price rises), cultural and accident.
2. THE Ambient_Pack SHALL ship at least 4 Event_Templates per category and at least 40 Incident templates.
3. WHEN an election City_Event reaches its result stage THEN the Ambient_Sim SHALL draw the result deterministically and apply the result's metric deltas.
4. WHEN a weather City_Event is selected THEN the Ambient_Sim SHALL require that the slice's daily weather and the season satisfy the template's weather precondition.
5. WHEN a border incident targets a District tagged as a border or sector boundary THEN the Ambient_Sim SHALL apply route-checkpoint or route-closure Effect_Ops to that District's Routes.

### Requirement 7: Calendar and Seasons

**User Story:** As a player, I want dates, seasons and holidays to matter, so that the city has a rhythm.

#### Acceptance Criteria

1. THE Ambient_Sim SHALL map each game day to a calendar date from the start date supplied by the city content, with season derived from the date.
2. THE Ambient_Sim SHALL schedule holidays from content-defined holiday definitions as Exogenous_Events on their dates.
3. THE Ambient_Sim SHALL expose the current date and season to Fact Lines, Documents and Event_Template preconditions.

### Requirement 8: Location State Changes

**User Story:** As a player, I want places to close, open and get raided, so that the map I learned keeps changing.

#### Acceptance Criteria

1. THE Ambient_Sim SHALL compute each Location's effective hours, risk, crowd, allowed actions and availability as its base values modified by its active Location_Status overlays.
2. THE Sim SHALL use effective Location values in `quote`, `resolve`, `crowdLevel` and `travelCost` (slice Req 21).
3. WHEN an Effect_Op opens a Dormant_Location THEN the Ambient_Sim SHALL activate the Location, and IF the Location is public THEN SHALL add it to the player's known set when a Document, Notice or Observation announces it.
4. WHEN a Location with a Dead Drop is raided THEN the Ambient_Sim SHALL mark the drop site unavailable for the raid's duration, seize any player items in it, and raise a player-visible event when the player next services the drop.
5. THE Ambient_Sim SHALL keep the effective Route graph connected, and IF a route-closure would disconnect it THEN SHALL apply a route-checkpoint instead.
6. THE Map view SHALL show each Location's status as last observed by the player or announced in a Document or Notice the player has read.
7. THE Sim SHALL key the Location Flavour cache (slice Req 20.7) by Location, phase, crowd band and Location_Status kind.

### Requirement 9: NPC Life Simulation

**User Story:** As a player, I want NPCs to have lives that change over time, so that the people I cultivate feel real and their circumstances create openings.

#### Acceptance Criteria

1. THE Ambient_Sim SHALL give every full-tier NPC a life state with needs (money, social, work), a mood, a work status and a set of NPC_Ties.
2. WHEN each day starts THEN the Ambient_Sim SHALL build each full-tier NPC's daily agenda from the base schedule with deviations, in this priority order: Plot traces, Station and Cover obligations, City_Event schedule overrides, Life_Event deviations, base schedule.
3. THE Ambient_Sim SHALL leave every Anchor_Slot unchanged when applying deviations.
4. WHEN a Life_Event applies THEN the Ambient_Sim SHALL update the NPC's life state and Knowledge Slice, and MAY change its MICE profile and money need by at most 0.15 per lever per 7 days.
5. THE Ambient_Sim SHALL leave every NPC's allegiances, organisation memberships in the Station, Hostile Service and Cell, and Plot roles unchanged.
6. WHILE an NPC is a Principal NPC THEN THE Ambient_Sim SHALL exclude Life_Events that remove the NPC from the city, detain the NPC or end the NPC's life.

### Requirement 10: NPC Ties

**User Story:** As a player, I want NPCs to know, like and owe each other, so that I can work through social networks.

#### Acceptance Criteria

1. THE Ambient_Sim SHALL generate NPC_Ties at initialisation from archetype and Location co-presence rules, with at most 8 ties per full-tier NPC.
2. WHEN two full-tier NPCs share a Location in a phase THEN the Ambient_Sim SHALL update their tie affinity by the content-defined co-presence rule.
3. WHEN a tie forms or ends THEN the Ambient_Sim SHALL add or retract the matching Proposition (RELATED_TO, INVOLVED_WITH or OWES) in the Truth Store and the participants' Knowledge Slices.
4. WHEN an introduce task (slice Req 22.6) involves NPCs with an NPC_Tie THEN the Sim SHALL add the tie's affinity to the derived starting trust, capped at 0.2.

### Requirement 11: Townsfolk and Promotion

**User Story:** As a player, I want to be able to talk to the waiter, the porter or the kiosk seller and find a real person, so that the city is deep wherever I look.

#### Acceptance Criteria

1. THE Ambient_Sim SHALL simulate Townsfolk with a schedule template, a descriptor, an archetype and at most 4 Recollections.
2. WHEN the player opens a talk or Cold Approach with a Townsfolk NPC, or an Effect_Op or Emergent_Thread needs one as a participant, THEN the Ambient_Sim SHALL promote the NPC to the full Life_Tier.
3. THE Ambient_Sim SHALL generate a promoted NPC's full profile from a sub-stream keyed only by the seed and the Townsfolk id, so that the profile is the same whenever promotion occurs.
4. THE Ambient_Sim SHALL promote at most 3 NPCs per day.
5. IF promotion would exceed the full-tier cap THEN THE Ambient_Sim SHALL demote the promoted NPC with the oldest last interaction, keeping its Regard and its 4 most salient Recollections.

### Requirement 12: NPC Memory and Regard

**User Story:** As a player, I want people to remember what I did and form opinions of me, so that my cover life has consequences.

#### Acceptance Criteria

1. WHEN the player takes an action at a Location THEN the Ambient_Sim SHALL run a notice check for each NPC present and SHALL record a Recollection for each NPC that passes.
2. WHEN the player talks to, pays, threatens or is introduced to an NPC THEN the Ambient_Sim SHALL record a Recollection for that NPC and update its Regard by the content-defined rule for the Intent or action.
3. THE Ambient_Sim SHALL ground every Recollection in an event the NPC participated in, an event at a Location where the NPC was present, or a Gossip_Item from an NPC that held it.
4. WHEN each day ends THEN the Ambient_Sim SHALL decay each Recollection's salience, drop Recollections below the salience floor, and keep at most 16 Recollections per full-tier NPC.
5. WHEN an NPC records a Recollection involving a person it cannot name THEN the Ambient_Sim SHALL refer to that person by descriptor.
6. WHEN the first-contact check (slice Req 22.3) or meeting acceptance (slice Req 24.1) runs THEN the Sim SHALL include the NPC's Regard warmth and wariness as additional weighted terms.
7. WHEN the player arrives at a Location THEN the Sim MAY show a Regard-driven Fact Line for a present NPC with high familiarity (for example, being greeted by name).

### Requirement 13: Gossip and Informants

**User Story:** As a player, I want word to get around, so that careless behaviour in public can come back to me and patient listening can pay off.

#### Acceptance Criteria

1. WHEN each day ends THEN the Ambient_Sim SHALL transfer Gossip_Items only between NPCs with an NPC_Tie or NPCs present at the same Location in the same phase that day.
2. THE Ambient_Sim SHALL transfer only Gossip_Items the source NPC holds, and SHALL apply Rumour distortion operators (slice Req 29.3) at the content-defined rate, recording the distorted Proposition as a false belief of the receiver.
3. THE Ambient_Sim SHALL designate Informants at initialisation at the preset Informant density, and SHALL store Informant status only in the Truth Store.
4. WHEN an Informant holds a Recollection or Gossip_Item about the player THEN the Ambient_Sim SHALL report it through an Ambient_Hook to the host-country police or the Hostile Service according to the Informant's handler.
5. WHEN an Informant reports that the player was seen with an NPC THEN the Ambient_Sim SHALL add the preset detection bonus to that NPC's next Hostile Service detection check (slice Req 12.2).

### Requirement 14: Rolling News Cycle

**User Story:** As a player, I want the papers to follow stories from day to day, so that reading the news is a way to track the city.

#### Acceptance Criteria

1. THE Ambient_Sim SHALL open a Story for each City_Event, Emergent_Thread, newsworthy Local_Incident and public Plot trace selected by the news rules, with at most 12 active Stories.
2. WHEN a Story has a new development THEN the Ambient_Sim SHALL offer it as a candidate article for the next edition of each Outlet whose coverage profile matches.
3. WHEN the slice selects a day's articles (slice Req 30.2) THEN the Sim SHALL rank candidates so that new developments of active Stories precede first reports, and first reports precede filler.
4. THE Sim SHALL render follow-up articles with a reference to the Story's previous development and SHALL never print a development before its cause.
5. WHERE an Outlet has a slant THEN THE Sim SHALL select and distort articles by the slant's rules and record every distorted asserted Proposition's truth in the Truth Store.
6. WHEN a Story has had no development for 3 days THEN the Ambient_Sim SHALL close it.
7. THE Player View SHALL let the player browse past editions and list the articles of a Story the player has read.

### Requirement 15: Notices

**User Story:** As a player, I want posters and public notices on the walls, so that I learn about the city by walking it.

#### Acceptance Criteria

1. WHEN a post-notice Effect_Op applies THEN the Ambient_Sim SHALL create a Notice Document obtainable at the target Locations for the notice's duration.
2. WHEN the player arrives at a Location with a Notice they have not read THEN the Sim SHALL show a Fact Line naming the Notice.
3. WHEN the player reads a Notice THEN the Sim SHALL add its asserted Propositions as Claims with source "document" (slice Req 30.4).

### Requirement 16: Emergent Side Threads

**User Story:** As a player, I want new side stories to start during the game, so that the city keeps offering leads and red herrings.

#### Acceptance Criteria

1. WHEN a spawn-thread Effect_Op applies, or a City_Metric crosses a Side Thread template's spawn threshold, THEN the Ambient_Sim SHALL instantiate an Emergent_Thread from a matching Side Thread template.
2. THE Ambient_Sim SHALL spawn at most 1 Emergent_Thread per 3 days and hold at most 3 active Emergent_Threads.
3. THE Ambient_Sim SHALL draw Emergent_Thread participants only from Background NPCs, Townsfolk and non-Cell Principal NPCs, and SHALL exclude every Cell member.
4. THE Ambient_Sim SHALL give each Emergent_Thread true Propositions, traces and Noise Traffic as for a slice Side Thread (slice Req 29.2, 29.4).
5. WHEN the game ends THEN the debrief SHALL list Emergent_Threads among the Side Threads (slice Req 19.6).
6. IF plot-library's Side Thread instantiation interface rejects a spawn, THEN THE Ambient_Sim SHALL drop that spawn and leave the World State unchanged (plot-library Req 15.5).

### Requirement 17: Cover Job Demands

**User Story:** As a player, I want my cover job to take real time, so that keeping my legend intact competes with running my network.

#### Acceptance Criteria

1. WHEN each game week starts THEN the Ambient_Sim SHALL generate 2–4 Cover_Duties from Cover_Duty templates matching the player's Cover Identity, each with a Location, a slot, a phase cost and a mandatory flag.
2. WHEN the player attends a Cover_Duty THEN the Sim SHALL charge its phase cost, raise Cover_Standing, lower Cover Suspicion by the duty's amount, and open a scene listing the persons present.
3. IF the player misses a mandatory Cover_Duty THEN the Sim SHALL lower Cover_Standing, raise Cover Suspicion by the duty's amount, and deliver a Cover_Employer message.
4. WHILE Cover_Standing is below 0.3 THEN THE Sim SHALL multiply Cover Suspicion increases from high-risk Location visits by 1.5.
5. WHEN a Cover_Duty is generated THEN the Ambient_Sim SHALL schedule attendees that MAY include Principal NPCs whose cover employment fits the duty.
6. THE Sim SHALL deliver a Notification one phase before each Cover_Duty and on each missed mandatory duty.

### Requirement 18: Plot and Counterintelligence Hooks

**User Story:** As a player, I want city events to touch the Plot only in explainable ways, so that the mystery stays fair.

#### Acceptance Criteria

1. THE Ambient_Sim SHALL affect the Plot, the Hostile Service and Cover Suspicion only through Ambient_Hooks from this closed set: delay-stage, reroute-location, channel-outage, cover-suspicion-delta, informant-report and detection-bonus.
2. WHEN a delay-stage or reroute-location hook applies THEN the Sim SHALL apply the slice's delay or reroute response (slice Req 3.4) without adding Abort Pressure.
3. THE Ambient_Sim SHALL keep the cumulative ambient delay on the Plot at or below the preset maximum.
4. THE Ambient_Sim SHALL leave Abort Pressure, Plot completion, Plot abort, Hostile Service beliefs about the Station and every NPC's allegiance unchanged.
5. THE Ambient_Sim SHALL keep ambient Cover Suspicion increases at or below the preset daily maximum.
6. THE Sim SHALL record every applied Ambient_Hook in the Truth Store, and WHEN the game ends THEN the debrief SHALL list the hooks that affected the Plot.

### Requirement 19: Solvability Preservation

**User Story:** As a player, I want the living city never to make the Plot impossible to crack, so that change adds texture and not dead ends.

#### Acceptance Criteria

1. THE Sim SHALL compute the Solvable_Set and the Anchor_Slots at world generation and after each accepted Structural_Change.
2. WHEN a Structural_Change touches no Anchor_Slot and no node on a witness path THEN the Ambient_Sim SHALL accept it without running the verifier.
3. WHEN a Structural_Change touches an Anchor_Slot or a witness-path node THEN the Ambient_Sim SHALL run the verifier on the world with the change applied for its full duration, and SHALL accept the change only IF the resulting Solvable_Set contains the current Solvable_Set.
4. IF a Structural_Change is rejected THEN THE Ambient_Sim SHALL apply the template's fallback Effect_Op when one is declared, and otherwise drop the change.
5. THE verifier SHALL use the Starting Brief as its root (slice Req 26.3).

### Requirement 20: Visibility and Truth Isolation

**User Story:** As a player, I want to learn about the city the way a resident would, so that the living world never hands me hidden truth.

#### Acceptance Criteria

1. THE Sim SHALL mark every ambient Sim event kind as player-visible or hidden (slice Req 39.1).
2. THE Sim SHALL deliver Notifications for public announcements reaching the Station (curfews, closures announced by authorities, election results), upcoming and missed Cover_Duties, Cover_Employer messages and disturbed player Dead Drops.
3. THE Sim SHALL deliver no Notification for Life_Events, gossip transfers, Informant reports, Ambient_Hooks, Regard changes or unannounced Location_Status changes.
4. THE Player View SHALL show a City view listing only the City_Events the player has learned of from Documents, Notices, Observations, Notifications or Claims.
5. THE Player View and Case File SHALL exclude Regard, Recollections, Informant status, NPC_Ties not asserted in Claims, the hook record and Emergent_Thread origins.

### Requirement 21: Dialogue and Narration Integration

**User Story:** As a player, I want NPCs to talk about the city and remember me, and descriptions to reflect what is happening, so that conversation and narration feel current.

#### Acceptance Criteria

1. WHEN the Knowledge Slicer builds an NPC prompt THEN the Sim SHALL add up to 8 ambient Propositions the NPC holds, chosen by salience, and the NPC's Recollections of the player rendered from templates.
2. THE Sim SHALL keep the ambient additions to an NPC prompt within 400 tokens, and SHALL refresh the ambient Propositions in prompt block 3 only at day boundaries.
3. THE Sim SHALL add the entities in an NPC's ambient Propositions and Recollections to that NPC's known-entity set only when the NPC holds them.
4. WHEN the Narrator builds a scene descriptor THEN the Sim SHALL add the active public City_Event labels, the Location_Status kind and the phase's Local_Incident Fact Lines, and SHALL add those labels to the Specifics Guard's allowed-name set.
5. THE Sim SHALL render Local_Incidents as Fact Lines from deterministic templates.

### Requirement 22: Ambient Content

**User Story:** As the developer, I want all ambient content to come from validated packs, so that city packs and later specs can extend the living world without code changes.

#### Acceptance Criteria

1. THE Ambient_Pack SHALL define the content kinds Event_Template, Incident template, Life_Event_Template, Story template, Outlet, Notice template, Cover_Duty template, Civic_Org template, holiday definition, City_Metric definition and Recollection template, each with a Zod schema.
2. THE Ambient_Pack SHALL define the predicates OCCURS_AT, ATTENDS, HAS_STATUS, RELATED_TO, INVOLVED_WITH and OWES using only the slice's built-in evaluator kinds and with no implication rule.
3. WHEN the Ambient_Pack or a dependent pack is loaded THEN the loader SHALL validate every ambient file and cross-reference (slice Req 31.2), including that every Effect_Op and Ambient_Hook kind belongs to its closed set.
4. IF a template slot of person kind can bind to anything other than a generated NPC or a generic role title THEN the loader SHALL refuse to start.
5. THE Ambient_Pack SHALL ship generic city content that works with the slice's generated city, and city-specific content SHALL come from city packs that depend on the Ambient_Pack.

### Requirement 23: Configuration and Difficulty

**User Story:** As a player, I want to tune how busy the city is and how harsh it is, so that I can match it to my taste and my machine.

#### Acceptance Criteria

1. THE scenario config SHALL accept an `ambient` block with an enabled flag (default true) and a Density (default `standard`), validated as in slice Req 41.2.
2. EVERY Difficulty Preset SHALL define an `ambient` block with: event density multiplier, police pressure baseline, Informant density, gossip distortion rate, informant detection bonus, maximum ambient Plot delay in days and maximum ambient Cover Suspicion per day.
3. IF the `ambient` block is invalid THEN THE Sim SHALL refuse to start and report each error with its file and field path.

### Requirement 24: Persistence, Replay and Evaluation

**User Story:** As the developer, I want ambient state saved, replayed and measured, so that the living world is as testable as the slice.

#### Acceptance Criteria

1. THE Sim SHALL include the ambient state in the save snapshot (slice Req 17.1), and WHEN a save is loaded THEN SHALL restore identical ambient state.
2. WHEN a save without ambient state is loaded THEN the Sim SHALL run that game with ambient simulation disabled.
3. WHEN a recorded session is replayed THEN the Sim SHALL reach identical ambient state (slice Req 17.4).
4. THE eval harness SHALL include fixtures for a gossiping Background NPC conversation and the narration of an arrival during an active City_Event, measuring Leak Guard trips, Specifics Guard trips and references to Recollections the NPC does not hold.

### Requirement 25: Multi-City Fidelity Contract

**User Story:** As the developer of the multi-city spec, I want the living city to run in every City of a Region at two fidelity levels without changing the mystery, so that coarse simulation stays exact where it matters.

#### Acceptance Criteria

1. WHERE multi-city mode is enabled THEN THE Ambient_Sim SHALL implement multi-city's `AmbientSimulator` interface (`advanceFull`, `advanceCoarse`, `reconcile` and `couplings`) for each City, keeping one Ambient state per City.
2. WHERE multi-city mode is enabled THEN THE Ambient_Sim SHALL deliver every Ambient_Hook as the AmbientCoupling of the same kind, and SHALL change Spine state through no other path.
3. WHERE multi-city mode is enabled THEN THE Ambient_Sim SHALL compute every AmbientCoupling identically at the full and coarse Fidelity Tiers for the same City, time, Spine history and Ambient streams.
4. WHERE multi-city mode is enabled THEN THE Ambient_Sim SHALL compute City_Event selection, stages and Effect_Ops at both Fidelity Tiers, only from exogenous and reactive inputs available at both tiers.
5. WHERE multi-city mode is enabled THEN THE Ambient_Sim SHALL run Player-Concerning Processing at both Fidelity Tiers from tier-independent inputs, and MAY run agendas, Life_Events, tie drift, Local_Incidents, Townsfolk schedules and news texture coarsely at the coarse tier.
6. WHEN `reconcile` runs for a City THEN THE Ambient_Sim SHALL keep every Disclosed Fact about that City true.
7. THE ambient-world test suite SHALL run multi-city's exported ambient contract test suite against the Ambient_Sim's `AmbientSimulator` implementation.
8. WHILE multi-city mode is disabled THEN THE Ambient_Sim SHALL behave as specified in Requirements 1–24.
