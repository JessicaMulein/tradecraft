# Requirements Document

## Introduction

This spec extends the completed Tradecraft slice (`.kiro/specs/tradecraft/`, referenced below as "Slice Req N.M") from one city to a **Region** of 2–4 real early Cold War cities (late 1940s–1960s; for example Vienna, Berlin, Trieste, Istanbul, Lisbon) that are all active within one game and one regional posting. All characters are fictional. Services are fictionalised analogues of era services.

The player is physically in one City at a time. The other Cities keep advancing. The Plot, Hostile Service operations, couriers and the player's own network keep running across borders. The player moves by rail, air, road and sea at day-scale cost, crosses Borders with Cover Identity papers and visas, and works with or against several services: two rival Hostile Services, Local Security Services, and Allied Liaison Services whose shared intelligence has its own reliability and agenda and may itself be penetrated.

All slice invariants hold unchanged:

- The deterministic Sim owns all ground truth (Slice Req 2).
- Model outputs never create, change or reveal facts (Slice Req 2.3, 5, 20.6).
- Generation and replay are deterministic (Slice Req 1.2, 17.4).
- Every Plot Stage is solvable through two independent discovery paths (Slice Req 1.4), now across the Region.
- The Reference Machine runs at most two resident models (Slice Req 14.5), with the slice latency targets (Slice Req 15.3).

Content comes from Content Packs (Slice Req 31). This spec defines the regional content kinds and their semantics.

Interface assumptions on the parallel follow-on specs:

- **ambient-world** provides the in-city living simulation and implements this spec's `AmbientSimulator` interface, covering Fidelity Tiers, Ambient Couplings and Arrival Reconciliation (Requirement 11).
- **plot-library** declares Cross-City Stage Hooks in Plot templates using this spec's hook schema, which is canonical and includes an optional local `fallback` stage for single-city play. This spec owns what those hooks mean in region mode (Requirement 10).
- **content-expansion** provides city packs, era packs and `service` Service Definitions with namespaced ids, and the Content Kind Registry. This spec consumes city definitions, extends Service Definitions with residency, rivalry and liaison fields, and registers its region-level kinds through the registry (Requirement 16).
- **campaign-career** consumes the Outcome Record (schema 2). This spec adds an optional region block to schema 2 (Requirement 18) and covers only one posting.

Implementation order: content-expansion → plot-library → ambient-world → campaign-career → multi-city. content-expansion tasks 1–2 are a hard prerequisite.

Out of scope: chained postings, more than four Cities, real historical persons, and maps rendered as graphics.

## Glossary

Terms not listed here are defined in the slice glossary.

- **Region**: The 2–4 Cities active in one game, with their Intercity Routes, Borders and services.
- **City**: One member of the Region, with its own Districts, Locations, Routes (Slice Req 21) and City Streams. Exactly one City is the Hub City.
- **Hub City**: The City that holds the Regional Station and in which the player starts.
- **Current City**: The City the player is in. While the player is in Transit, there is no Current City.
- **Region Generator**: The engine component that generates the Region from a seed. It extends the slice World Generator.
- **City Stream**: The PRNG streams derived per City (core, noise, daily, Spine and Ambient) so that Cities cannot perturb each other.
- **Intercity Route**: A connection between Terminals in two Cities with a Travel Mode, a timetable, a duration in phases, a fare, and zero or more Borders crossed.
- **Travel Mode**: One of rail, air, road or sea.
- **Terminal**: A Location (railway station, airfield, port, road checkpoint) where Intercity Routes depart and arrive.
- **Departure**: One scheduled run of an Intercity Route at a given day and phase.
- **Transit**: The period between a Departure and its arrival, during which a traveller is on the Intercity Route and in no City.
- **Carriage**: The temporary Location that represents one Departure while it is in Transit. Travellers on the same Departure are present in the Carriage.
- **Border**: A controlled boundary crossed by an Intercity Route, or a Sector Line between Districts of one City (for example the occupation sectors of Vienna or Berlin).
- **Sector Line**: A Border between Districts of the same City.
- **Border Post**: The control point where an Intercity Route or Route crosses a Border. A Border Post is operated by one Controlling Service and has a strictness value.
- **Controlling Service**: The service that operates a Border Post or holds Jurisdiction in a City or District.
- **Travel Document**: A paper the traveller carries, such as a passport, visa, transit permit, interzonal pass or press accreditation. Each Travel Document has a kind, a holder identity, a validity window, an issuing authority and a quality value.
- **Papers**: The set of Travel Documents a traveller carries.
- **Border Check**: The deterministic inspection of a traveller, their Papers and carried items at a Border Post.
- **Border Outcome**: The result of a Border Check: pass, secondary inspection, item seizure, entry refused, or detention.
- **Watch List**: The persons and descriptors a Controlling Service is looking for at its Border Posts. A Watch List is derived from that service's beliefs.
- **Regional Station**: The player's own service in the Region: a Chief of Station in the Hub City plus Outstations.
- **Outstation**: A small Station presence in a non-Hub City, with one officer, limited intercept capability and its own Cable delay.
- **Service**: Any intelligence or security organisation that the Sim models with doctrine, beliefs and per-City presence. Its identity, name, kind, country and doctrine base come from a content-expansion Service Definition. The slice Hostile Service becomes one Service.
- **Service Kind**: One of own, hostile, local-security or liaison.
- **Local Security Service**: A Service of the country that governs a City or District. A Local Security Service controls arrests and Border Posts there, and Cover Suspicion and arrests can come from it.
- **Liaison Service**: An allied Service that exchanges intelligence with the Station.
- **Liaison Report**: A Claim delivered by a Liaison Service, drawn from that Service's Knowledge Slice.
- **Liaison Agenda**: What a Liaison Service is trying to conceal, promote or obtain in an exchange.
- **Liaison Reliability**: A Liaison Service's hidden reporting accuracy.
- **Penetration**: A hostile agent inside a Liaison Service or Station who reports shared material to a Hostile Service.
- **Rivalry**: A directed relation between two Services that sets whether they share beliefs, compete for Assets or expose each other's agents.
- **Residency**: A Service's presence in a City: officers, Channels, Dead Drops and detection capacity.
- **Jurisdiction**: The right to request an arrest or run a Border Check in a City or District. Each City or District grants Jurisdiction to one Controlling Service.
- **Courier Line**: A Channel of kind courier whose route crosses Cities by Intercity Routes.
- **Cross-City Stage Hook**: A Plot template declaration that binds a Plot Stage to a City role, or that requires a Proposition or item produced in one City to be delivered to another. Its schema (`city`, `handoff`, `cityRoles`, optional `fallback`) is owned by this spec.
- **Handoff**: The courier movement that satisfies a Cross-City Stage Hook.
- **Exfiltration**: Moving an Asset across a Border to safety in another City.
- **Spine**: The Sim state and events that drive the mystery: Principal NPCs, the Plot, Cells, Services, Channels, Transmissions, Dead Drops, Assets, Meetings, Documents and Transits.
- **Ambient**: All Sim state outside the Spine. Ambient state is owned by the ambient-world spec.
- **Ambient Coupling**: A declared, closed-set effect by which Ambient state reaches the Spine, computed identically at both Fidelity Tiers.
- **Fidelity Tier**: The simulation level of a City: full (the Current City) or coarse (every other City).
- **Arrival Reconciliation**: The step that brings a coarse City to full fidelity when the player arrives.
- **Disclosed Fact**: An Ambient Proposition already present in the Case File or Journal.
- **Arrival Projection**: What the player can observe in a City on arrival: Spine-derived Observations, Documents and visible persons, plus Ambient Disclosed Facts.
- **Communication Latency**: The minimum delay, in phases, before an event in one City can reach the player in another City.
- **Regional Verifier**: The discovery-path verifier extended to the Region graph.
- **Regional Preset**: A content-defined set of regional tuning values that is keyed to a Difficulty Preset.
- **Persona Non Grata**: The status of a player whom a country's Local Security Service has barred from its Cities.

## Requirements

### Requirement 1: Region Generation

**User Story:** As a player, I want a regional posting across several real cities generated from a seed, so that each game is a fresh, reproducible web of agents spread across borders.

#### Acceptance Criteria

1. WHEN a new game starts with a region template and seed THEN the Region Generator SHALL generate 2–4 Cities, their Intercity Routes, Borders, Border Posts, Services and Residencies, the Regional Station and Outstations, one Plot, one Cell per City that the Plot touches, and per-City Principal and Background NPCs, using only the seeded PRNG streams and the loaded Content Set.
2. WHEN the same seed, generator version, Content Manifest, Difficulty Preset and Regional Preset are used THEN the Region Generator SHALL produce an identical World State.
3. THE Region Generator SHALL derive each City's core, noise and daily streams and a Spine stream and an Ambient stream for each City from the seed and the City's index in the region template.
4. THE Region Generator SHALL keep the total Principal NPC count at or below 22 per City and 48 per Region.
5. THE Region Generator SHALL set every City's era date from the region template, and SHALL use only Content Set entries whose declared era range contains that date.
6. WHERE multi-city mode is disabled THEN the Sim SHALL generate and run exactly as the slice.

### Requirement 2: Intercity Travel

**User Story:** As a player, I want to travel between cities by train, plane, car or ship on real timetables, so that moving across the Region is a costly decision.

#### Acceptance Criteria

1. THE Sim SHALL give every Intercity Route a Travel Mode, an origin Terminal, a destination Terminal, a timetable of Departures by weekday and phase, a duration of 1–8 phases, a fare, and the ordered Borders it crosses.
2. WHEN the player books a Departure THEN the Sim SHALL quote the wait until Departure, the Transit duration, the fare and each Border to be crossed before the player confirms.
3. WHEN the player departs THEN the Sim SHALL debit the fare, move the player into Transit, advance the clock by the quoted Transit duration and place the player at the destination Terminal.
4. IF weather or a Service action cancels a Departure THEN the Sim SHALL refund the fare, leave the player at the origin Terminal and send a Notification.
5. WHILE the player is in Transit THEN the Sim SHALL present the Carriage as the player's Location, list every traveller on the same Departure, and allow talk, approach, observe and wait.
6. THE Sim SHALL move NPCs between Cities only by Departures, and every NPC in Transit SHALL be present in that Departure's Carriage.
7. WHEN the player surveils a Terminal THEN the Sim SHALL produce Observations of arriving and departing travellers under the slice observation check (Slice Req 23.1).

### Requirement 3: Borders and Border Checks

**User Story:** As a player, I want border crossings to test my papers and nerve, so that crossing a frontier carrying secrets is tense.

#### Acceptance Criteria

1. WHEN a traveller reaches a Border Post THEN the Sim SHALL run a Border Check from the Papers, the Cover Identity or NPC identity, the carried items, the Border Post's strictness, the Controlling Service's Watch List, the Regional Preset and the runtime PRNG.
2. THE Border Check SHALL return exactly one Border Outcome.
3. IF the Papers lack a Travel Document that the Border requires, or a Travel Document is outside its validity window, THEN the Border Check SHALL return entry refused or detention.
4. WHEN the Border Outcome is secondary inspection THEN the Sim SHALL add 1 phase to the Transit and run a carried-item search.
5. WHEN a carried-item search finds a contraband item (seized material, a radio set, a cipher pad, or cash above the Regional Preset threshold) THEN the Sim SHALL seize that item and raise Cover Suspicion with the Controlling Service.
6. WHEN the Border Outcome is detention THEN the Sim SHALL hold the player for the phases set by the Regional Preset, raise Cover Suspicion with the Controlling Service, and send a Cable to the Regional Station.
7. THE Sim SHALL apply Border Checks to Sector Line crossings within a City, with the strictness set for that Sector Line.
8. WHEN an NPC crosses a Border THEN the Sim SHALL run the same Border Check for that NPC.
9. THE Sim SHALL show each Border Outcome to the player as a Fact Line from a fixed template per Border Outcome.
10. THE Border Check SHALL provide a Border Check Extension Seam: WHEN a traveller's context names an extension that applies (for example an add-on's vehicle check) THEN THE Sim SHALL delegate the check to that extension, SHALL accept from it one Border Outcome of the fixed set (an extension's richer results SHALL map onto that set plus the extension's own typed detail), and SHALL apply the outcome, Cover Suspicion and Cable rules of this Requirement unchanged. WHERE no extension is registered THEN the Border Check SHALL run exactly as without the seam.

### Requirement 4: Travel Documents and Papers

**User Story:** As a player, I want to obtain, forge and manage papers, so that preparing a crossing is part of the craft.

#### Acceptance Criteria

1. THE Sim SHALL give the player starting Papers that match the Cover Identity and the Borders reachable from the Hub City, as listed in the Starting Brief.
2. WHEN the player sends a papers-request Cable THEN the Regional Station SHALL issue the requested Travel Document after the Regional Preset delay, at a quality and money cost set by the document kind and Standing.
3. WHEN the player applies for a visa at a consulate Location THEN the Sim SHALL resolve the application deterministically from the Cover Identity, the issuing country's Local Security Service suspicion of the player and the runtime PRNG, and SHALL deliver the result after the content-defined processing time.
4. WHEN the player requests documents for an Asset THEN the Sim SHALL issue the Travel Document to that Asset at the quoted cost.
5. THE Player View SHALL list every Travel Document the player holds with kind, holder identity, issuing authority, validity window and the Borders it satisfies. The Player View SHALL exclude Travel Document quality.

### Requirement 5: Regional Station and Outstations

**User Story:** As a player, I want a regional chief and outstations in other cities, so that I am running a regional network rather than a single desk.

#### Acceptance Criteria

1. THE Region Generator SHALL generate the Regional Station with a Chief of Station in the Hub City and one Outstation in each other City, each Outstation with one staff officer who is a Principal NPC.
2. WHERE the region template selects per-City Stations THEN the Region Generator SHALL generate a Station in every City with its own Chief, under one shared Standing and Budget.
3. WHEN the player intercepts at an Outstation THEN the Sim SHALL deliver only transmissions on known Channels that are receivable in that Outstation's City.
4. WHEN the player sends a Cable from a City THEN the Sim SHALL deliver the Cable's reply after the slice delay plus the Communication Latency between that City and the Hub City.
5. THE Chief of Station SHALL issue Directives whose objectives may name any City of the Region.
6. WHERE a mole is enabled THEN the Region Generator SHALL place the mole in the Regional Station or an Outstation, and the mole's reports SHALL cover only the Cables and Case File summaries that the mole's posting can see.

### Requirement 6: Multiple Services and Rivalry

**User Story:** As a player, I want rival hostile services and local security forces with their own goals, so that the Region feels crowded and politically real.

#### Acceptance Criteria

1. THE Region Generator SHALL generate 1–2 Hostile Services, one Local Security Service for each country in the Region, and 0–2 Liaison Services, each with a Service Kind, doctrine values from the Regional Preset ranges, and a Residency in each City where it operates.
2. THE Sim SHALL maintain separate beliefs per Service, and SHALL update a Service's beliefs only from that Service's own detections, its belief-sharing relations, or a Penetration.
3. THE Sim SHALL run each Service's daily tick (Slice design `dailyTick`) per City of Residency in a fixed order of Service id and City index.
4. WHEN two Services have a sharing Rivalry relation THEN the Sim SHALL copy each adopted belief from the sending Service to the receiving Service after the relation's delay.
5. WHERE two Hostile Services are rivals THEN each SHALL compete for the same Assets and MAY expose a rival's agent to a Local Security Service, as set by doctrine.
6. THE Sim SHALL track Cover Suspicion per Service.
7. IF a Hostile Service's Cover Suspicion of the player exceeds the burn threshold THEN the player SHALL be burned (Slice Req 12.5).
8. IF a Local Security Service's Cover Suspicion of the player exceeds the burn threshold THEN the Sim SHALL declare the player Persona Non Grata in that country, expel the player to the nearest City outside it, and bar entry to its Cities.
9. IF the player is Persona Non Grata in every country of the Region THEN the game SHALL end in failure with outcome burned.

### Requirement 7: Allied Liaison

**User Story:** As a player, I want to trade intelligence with allied services, so that I gain reach while risking their bias and their leaks.

#### Acceptance Criteria

1. WHEN the player sends a liaison request about a known entity THEN the Liaison Service SHALL return Liaison Reports after its delay, drawn only from that Service's Knowledge Slice and filtered by its Liaison Agenda and Liaison Reliability.
2. THE Sim SHALL add each Liaison Report to the Case File as a Claim with source "liaison", and SHALL record its truth value only in the Truth Store.
3. WHEN the player shares Case File Claims with a Liaison Service THEN the Sim SHALL add the shared Propositions to that Service's beliefs and raise the Service's liaison trust in the Station.
4. WHERE a Liaison Service holds a Penetration THEN the penetrating Hostile Service SHALL receive exactly the Propositions shared with that Liaison Service after the Penetration's delay.
5. THE Liaison Service SHALL return results in proportion to its liaison trust, which SHALL fall when the Station withholds requested material or arrests a Liaison Service's agent.
6. THE Sim SHALL decide every Liaison Report and liaison trust change only from Service state, and the Player View SHALL exclude Liaison Reliability, the Liaison Agenda and Penetrations.
7. WHERE a Liaison Service is also the Local Security Service of a City THEN the Sim SHALL let the player request border crossing records from that Service, returned as Claims about the Border Checks at its Border Posts.

### Requirement 8: Cross-Border Asset Networks

**User Story:** As a player, I want to run Assets in cities where I am not, so that my network spans the Region.

#### Acceptance Criteria

1. THE Sim SHALL allow remote tasking of an Asset in another City only through a Contact Channel. The tasking SHALL be delivered after the Communication Latency between the two Cities.
2. WHEN a remote Asset completes a task THEN the Sim SHALL deliver the result by the Asset's reporting Channel (radio, Courier Line or Dead Drop), and the result SHALL reach the Case File when that Channel's delivery completes.
3. WHEN the player tasks an Asset to travel THEN the Asset SHALL take a Departure, pass the Border Checks on that Departure's route, and arrive in the destination City with an access profile for that City.
4. THE Sim SHALL track each Asset's Exposure against each Service with a Residency in the Asset's City, and SHALL run each Service's detection checks on the Assets in its Cities.
5. WHEN the player orders the Exfiltration of an Asset THEN the Sim SHALL move the Asset by a chosen Departure using Papers that the player provides, run each Border Check, and on arrival set the Asset to resettled with no further Exposure.
6. IF an Exfiltration Border Check returns detention THEN the Controlling Service SHALL hold the Asset under its doctrine (arrest, double or release).

### Requirement 9: Courier Lines and Regional Channels

**User Story:** As a player, I want to intercept traffic that crosses borders, so that signals work spans the Region.

#### Acceptance Criteria

1. THE Sim SHALL model Courier Lines as courier Channels whose schedules name Departures, with the courier an NPC who travels on them.
2. WHEN a courier on a Courier Line reaches a Border Post THEN the Sim SHALL run the courier's Border Check, and a seizure SHALL count as a seized delivery under Slice Req 24.7.
3. WHEN the player intercepts a Courier Line in a Carriage or at a Terminal during a scheduled Departure THEN the Sim SHALL produce an Intercept and run a detection check (Slice Req 25.4).
4. THE Sim SHALL give every radio Channel a reception set of Cities, and numbers broadcasts SHALL be receivable in every City of the Region.
5. THE Cipher Engine SHALL generate Noise Traffic per City at the ratio set by the Difficulty Preset (Slice Req 29.4).

### Requirement 10: Cross-City Plots

**User Story:** As a player, I want plots whose stages unfold in different cities, so that solving the case means connecting events across the Region.

#### Acceptance Criteria

1. WHEN a Plot template declares a Cross-City Stage Hook that binds a stage to a City role THEN the Region Generator SHALL bind that role to one generated City.
2. WHEN a stage in one City requires a Proposition or item produced in another City THEN the Sim SHALL satisfy the requirement only by a Handoff along a Courier Line or by a Cell member's Departure.
3. THE Region Generator SHALL set the deadline of every stage with a Handoff at or after the producing stage's deadline plus the shortest Transit duration between the two Cities.
4. IF a Handoff is seized, its courier is arrested, or its Courier Line is believed compromised THEN the Sim SHALL count a stage disruption (Slice Req 38.2), and a reroute SHALL choose an alternative Intercity Route or Travel Mode before choosing an alternative City.
5. WHEN a Plot stage executes in a City THEN the Sim SHALL emit its traces in that City and in any City on the Handoff route.
6. THE Sim SHALL apply the slice end conditions (Slice Req 19.3, 19.4, 38) to the regional Plot, and arresting the leader of any one Cell SHALL count as disruption, while arresting the Plot leader SHALL end the game in success.

### Requirement 11: Simulation Fidelity Tiers

**User Story:** As a player, I want the cities I am not in to keep living, so that returning to a city shows consequences, without the game slowing down.

#### Acceptance Criteria

1. THE Sim SHALL run the Current City at full Fidelity Tier and every other City at coarse Fidelity Tier.
2. THE Sim SHALL advance the Spine identically at both Fidelity Tiers, using each City's Spine stream, so that Spine state does not depend on Fidelity Tier.
3. THE ambient-world interface SHALL provide a full advance, a coarse advance, and Arrival Reconciliation for one City, each taking the City's Ambient stream and read-only Spine state.
4. THE ambient-world interface SHALL change Spine state only through declared Ambient Couplings from the closed set in the design (Location closures, crowd modifiers, route delays, and every ambient-world Ambient_Hook kind: delay-stage, reroute-location, channel-outage, cover-suspicion-delta, informant-report and detection-bonus), and each Ambient Coupling SHALL be computed identically at both Fidelity Tiers.
5. WHEN the player arrives in a City THEN the Sim SHALL run Arrival Reconciliation before producing the arrival Fact Lines.
6. WHEN Arrival Reconciliation runs THEN every Disclosed Fact about that City SHALL remain true, and every Ambient fact that differs from a full-tier run SHALL be absent from Spine state.
7. WHILE the player is in Transit THEN the Sim SHALL run every City at coarse Fidelity Tier.
8. THE ambient-world interface SHALL compute City Events and their Effect_Ops only from exogenous and reactive inputs available at both Fidelity Tiers, and SHALL run NPC memory, gossip and Informant processing concerning the player at both Fidelity Tiers, while other Ambient detail MAY differ between tiers.

### Requirement 12: Cross-City Truth Consistency

**User Story:** As a player, I want people and things to be in one place at a time, so that alibis and movements across the Region can be reasoned about.

#### Acceptance Criteria

1. THE Sim SHALL place every NPC and every item in exactly one City or exactly one Transit at every game time.
2. THE Sim SHALL record a Proposition with a place in a City only when every participant is located in that City throughout its window.
3. THE Sim SHALL keep the interval between two placements of an NPC in different Cities at or above the duration of the Departures that the NPC took.
4. THE Truth Store SHALL hold one regional fact set, and `holds` (Slice design Truth Store) SHALL evaluate Propositions from any City against it.

### Requirement 13: Regional Notifications and Cables

**User Story:** As a player, I want news from other cities to arrive the way it would in 1953, so that I am informed late and partially.

#### Acceptance Criteria

1. WHEN a player-visible event occurs in a City other than the player's THEN the Sim SHALL deliver its Notification no earlier than the Communication Latency between the two Cities.
2. THE Sim SHALL deliver Notifications for Departures cancelled, Border Outcomes, papers issued, visa decisions, Liaison Reports, Outstation reports, Courier Line deliveries and Asset arrivals.
3. THE Sim SHALL deliver no Notification for hidden events in any City, as in Slice Req 39.4, and SHALL apply Slice Req 39.5 to observable consequences in every City.
4. WHEN each day starts THEN the Sim SHALL publish a newspaper edition in every City, and the editions of other Cities SHALL be obtainable at the Current City's kiosks one day later.
5. WHILE the player is in Transit THEN the Sim SHALL hold every Notification other than Carriage events until arrival.

### Requirement 14: Regional Solvability

**User Story:** As a player, I want every regional plot to be solvable, so that the larger world never turns unfair.

#### Acceptance Criteria

1. THE Regional Verifier SHALL extend the slice learnability graph with travel edges (to a City reachable with Papers the player holds or can obtain), Terminal surveillance edges, Carriage meeting edges, liaison request edges, remote Asset tasking edges and Courier Line intercept edges.
2. THE Regional Verifier SHALL confirm that every Plot Stage's key Proposition has two paths that share no intermediate NPC, Channel or Liaison Service, one human and one signal (Slice Req 1.4).
3. THE Regional Verifier SHALL confirm that at least one success condition of Slice Req 19.4 or 38.4 is reachable by an action that Jurisdiction permits.
4. IF verification fails THEN the Region Generator SHALL regenerate from the next derived seed, and after the content-defined attempt limit SHALL raise a generator error naming the seed.
5. THE Regional Verifier SHALL use exactly the Starting Brief's known entities, Claims, Channels, Documents and Papers as the root.

### Requirement 15: Jurisdiction and Arrests

**User Story:** As a player, I want arrests to depend on whose city I am in, so that politics shapes how I can end the plot.

#### Acceptance Criteria

1. THE Sim SHALL assign Jurisdiction for every City or District to one Controlling Service.
2. WHEN the player requests an arrest THEN the Sim SHALL apply the slice arrest gate (Slice Req 19.1, 40) and SHALL grant the arrest only where the Controlling Service is the Station's own Service or a Liaison Service with liaison trust at or above the Regional Preset threshold.
3. IF Jurisdiction forbids an arrest THEN the quote SHALL state that Jurisdiction forbids it, and SHALL list the Cities where the target has been observed.
4. THE Sim SHALL decide Jurisdiction eligibility only from Player View, Case File and published Jurisdiction data.

### Requirement 16: Regional Content

**User Story:** As the developer, I want regions defined as data on top of city packs, so that new regions can be added without code.

#### Acceptance Criteria

1. THE Sim SHALL load region templates, Intercity Route templates, Border and Border Post definitions, Travel Document kinds, Service extensions (Residency, Rivalry and liaison fields keyed by content-expansion Service Definition ids), Rivalry tables, Regional Presets and Cross-City Stage Hook schemas from Content Packs.
2. WHEN a region template references a City THEN the loader SHALL resolve the reference against a namespaced city definition from the Content Set, and IF the reference fails THEN SHALL refuse to start (Slice Req 31.2).
3. THE spec SHALL ship a `region-core` pack with one playable region template, and a test fixture pack with synthetic Cities.
4. THE loader SHALL include every regional pack in the Content Manifest.
5. THE regional content kinds SHALL be registered through content-expansion's Content Kind Registry with Field Declarations.
6. THE `region-core` region template SHALL set an era date that lies within the Period Window of every City it references.

### Requirement 17: Regional Player Aids and Interface

**User Story:** As a player, I want a regional map and itinerary tools, so that I can plan across cities.

#### Acceptance Criteria

1. THE Map view SHALL show the Region's Cities, the Intercity Routes with modes, durations, fares and Borders, the next Departures, the player's Papers, and the known Locations of each City.
2. THE People view SHALL show each person's last known City.
3. THE UI SHALL show the Current City, or Transit with the destination and arrival time, in the status bar.
4. THE Case File SHALL be filterable by City.
5. THE Narrator scene descriptor SHALL include the City name and the city style sheet, and the Specifics Guard SHALL treat known City names as allowed names.

### Requirement 18: Regional Persistence and Outcome

**User Story:** As the developer, I want regional games to save, replay and record outcomes exactly, so that bugs reproduce and a career layer can read the result.

#### Acceptance Criteria

1. THE Sim SHALL save every City's state, every City Stream state, Fidelity Tiers, Transits, per-Service beliefs and pending Handoffs in the save snapshot, under a new snapshot version.
2. WHEN a regional save is loaded THEN the Sim SHALL restore an identical state.
3. WHEN a regional session is replayed from its seed and action log THEN the Sim SHALL reach an identical final state.
4. THE Outcome Record SHALL add an optional region block to Outcome Record schema 2 (plot-library), with the region template id, Cities, per-Service Cover Suspicion, Persona Non Grata countries, liaison trust per Liaison Service, and surviving Assets' Cities.

### Requirement 19: Regional Performance Budgets

**User Story:** As a player on the Reference Machine, I want a four-city game to stay responsive, so that a larger world does not cost play speed.

#### Acceptance Criteria

1. THE Region Generator SHALL generate and verify a four-City Region on the standard preset within 8 s on the Reference Machine.
2. THE Sim SHALL advance one coarse City by one phase within 5 ms median and 20 ms at the 99th percentile on the Reference Machine.
3. THE Sim SHALL complete Arrival Reconciliation within 300 ms on the Reference Machine.
4. THE Sim SHALL resolve an intercity travel action of 8 phases, including every City advance, within 1 s on the Reference Machine.
5. THE Sim SHALL keep engine heap use within 1 GB and a 30-day four-City save within 15 MB.
6. THE regional features SHALL use no additional resident model, and SHALL keep NPC and Narrator prompts within the slice token budget (Slice Req 15.2).
7. THE Sim SHALL record generation time, coarse and full advance times, and reconciliation time in the metrics log (Slice Req 15.6).

### Requirement 20: Regional Configuration

**User Story:** As the developer, I want regional settings validated at startup, so that tuning a region needs no code change.

#### Acceptance Criteria

1. THE scenario config SHALL accept a `region` section with the region template id, the station model (regional or per-City), and Regional Preset overrides, validated at startup (Slice Req 41).
2. EVERY Regional Preset SHALL define: City count range, Border strictness range, Watch List sensitivity, detention phases, contraband cash threshold, papers delay and cost, Communication Latency per City pair class, liaison reliability range, liaison trust threshold for arrests, Penetration probability, Rivalry intensity and the verifier attempt limit.
3. IF the `region` section fails validation THEN the Sim SHALL refuse to start and report each error with its file and field path.
