# Requirements Document

## Introduction

This add-on spec puts the player behind the wheel. It adds **driving** through a city's streets with turn-by-turn text commands, **spotting and losing tails**, **checkpoints** that stop vehicles, **smuggling people** past those checkpoints and Borders, and **bluffing**: the player's own deliberate deceptions told to guards and interrogators. It builds on `multi-city`'s Borders, Border Posts, Border Checks and Travel Documents.

Findings from the current specs and code that shape this spec:

- **Cities have no street map.** A City Definition has Districts, Locations and Routes with a cost in phases (Slice Req 21; content-expansion Req 2). Driving needs a street graph, so this spec adds one as a new content kind that a city may or may not have.
- **The player needs to see the map too.** A graph the Sim holds is not a map the player can read. This spec therefore also defines how the player learns streets, a plain-text local map for the terminal, and a drawn street map for the web version, and how a street graph is authored for a real city (Requirements 2.7, 16 and 17).
- **Tails already exist abstractly.** The slice has a Hostile Service with watchers, hidden Cover Suspicion and a `travel` action with a countersurveillance route. This spec makes the player's side of that interactive and keeps the same hidden-truth model.
- **Player-side deception does not exist yet.** The slice models NPC lies, Told Lists, Chickenfeed and Dangles (Slice Req 6, 11), and Cover Identity affects cold approaches. The player has no way to lie on purpose and be held to it. This spec adds that as a general **Bluff Engine**, with checkpoints as its first user.
- **The action set is closed.** `Action` is a fixed union in the engine, enumerated by the Player View catalogue. An add-on that adds action kinds therefore needs a small **Action Extension Registry**, defined here, which changes nothing for existing kinds.

All slice invariants hold unchanged:

- The deterministic Sim owns all ground truth, including who is following whom, what is in the car and what the guard believes (Slice Req 2). The Player View never contains Tail truth.
- Model outputs never create, change or reveal facts (Slice Req 2.3). A model may voice a guard or transcribe what the player said. It never decides an outcome.
- Generation and replay are deterministic (Slice Req 1.2, 17.4).
- Every Plot Stage stays solvable through two independent paths (Slice Req 1.4), and no Plot Stage may require driving or smuggling. This add-on is optional content on top.
- At most two models are resident (Slice Req 14.5).

Interface assumptions:

- **multi-city** provides Borders, Border Posts, the Border Check and Border Outcome vocabulary, Sector Lines, Watch Lists, Travel Documents and the road Travel Mode. This spec needs one addition there: a **Border Check Extension Seam** through which an add-on may replace the check for a traveller in a Vehicle. multi-city's requirements should be amended to expose it (see Requirement 8.1).
- **ambient-world** provides City Events (for example police crackdowns) and the police-pressure City Metric. This spec lets those events place Checkpoints.
- **content-expansion** provides the Content Kind Registry, `extension` packs, Tag Queries, Locale, and the Pack Linter. This spec registers its kinds there.
- **natural-language-commands** picks up this spec's actions through the catalogue and a Phrasebook.
- **setting-generalization** supplies the contemporary surveillance methods (licence-plate readers, GPS trackers, cameras). This spec defines the content kind and ships the 1945–1965 methods only.

Proposed implementation order: after multi-city.

Out of scope: real-time or arcade driving, vehicle physics, graphics, firearms and chases with violence, boats and aircraft, driving along Intercity Routes (multi-city's timetable abstraction stands; only the Border Post crossing is modelled here), and foot surveillance (already in the slice).

## Glossary

Terms not listed here are defined in the slice glossary or in multi-city.

- **Street Graph**: A City's map for driving: Junctions joined by Street Segments.
- **Junction**: A node of the Street Graph where the player may choose a Turn Option.
- **Street Segment**: An edge between two Junctions, with a street name, length, speed class, one-way flag, traffic level per phase and a bearing at each end.
- **Street Knowledge**: The set of Segments and Junctions the player knows, with the source of each (driven, seen, map Document, local knowledge, navigation aid).
- **Street Map View**: The Player View projection of the Street Graph limited to Street Knowledge.
- **Local Map**: A small text diagram of the current Junction and the Segments leaving it.
- **Map Document**: A Document (a folded city map, a street guide) that adds Segments to Street Knowledge.
- **Navigation Aid**: A Capability-gated source (a phone map application in a contemporary profile) that adds the whole graph to Street Knowledge and leaves a Digital Trace.
- **Street Source**: The record of where a Street Graph's data came from, with its licence.
- **Frontage**: The Junction or Segment from which a Location is entered.
- **Heading**: The direction the Vehicle is travelling along a Segment.
- **Turn Option**: One legal movement at a Junction (left, right, straight, U-turn, or a named exit), derived from the Heading and the Street Graph.
- **Vehicle Definition**: Content describing a kind of vehicle: name, Year Range, speed class, seats, conspicuousness and Concealment Spots.
- **Vehicle**: An instance the player (or an Asset) uses, with a registration tied to an identity.
- **Concealment Spot**: A place in a Vehicle where a person or item can be hidden, with capacity, search difficulty and Endurance.
- **Endurance**: The number of Drive Ticks a Concealed Passenger can remain hidden before they must be released or are found.
- **Drive Session**: The state in which the player is driving. It begins at a Frontage and ends at parking, arrival or interruption.
- **Drive Tick**: The time unit of a Drive Session. A configured number of Drive Ticks make one phase.
- **Drive Step**: One decision in a Drive Session, committed as one Action.
- **Tail**: Hostile or Local Security surveillance of the player's Vehicle. Truth lives in the Truth Store.
- **Tail Team**: The Vehicles and watchers assigned to one Tail.
- **Tail Profile**: Content-defined skill, number of Vehicles, discipline, hand-off pattern and radio net of a Service's tails.
- **Tail Status**: One of attached, lost, handed-off or burned, held in the Truth Store.
- **Innocent Traffic**: Vehicles that look like a Tail but are not.
- **Surveillance Method**: Content describing one way of following or tracking a Vehicle, with a Year Range.
- **Evasion Maneuver**: Content describing a manoeuvre (for example a one-way contraflow, a dead-end turn, a parking structure) with preconditions on the Street Graph.
- **Checkpoint**: A control point on a Segment that stops Vehicles: a fixed Border Post or Sector Line crossing, a roadblock from a City Event, or a random stop.
- **Checkpoint Check**: The deterministic inspection of a Vehicle, its occupants and its contents at a Checkpoint.
- **Passenger**: A person in the Vehicle other than the driver, declared or Concealed.
- **Concealed Passenger**: A Passenger hidden in a Concealment Spot.
- **Bluff Engine**: The component that resolves a deliberate false statement by the player against what the Sim knows.
- **Cover Story**: A structured set of claims the player makes to a controller: identity, purpose, origin, destination, declared passengers and declared cargo.
- **Story Ledger**: The per-Service record of every Cover Story the player has told that Service or a Service that shares records with it.
- **Follow-Up Question**: A question the controller asks, generated from the controller's Knowledge Slice.

## Requirements

### Requirement 1: Add-On Packaging and the Action Extension Registry

**User Story:** As the developer, I want street-ops to be a removable add-on, so that the slice and the other specs are unaffected when it is off.

#### Acceptance Criteria

1. THE engine SHALL provide an Action Extension Registry through which an add-on registers an action kind with: a Zod schema, a quote function, a resolver, a catalogue enumerator for `player-view`, Phrasebook entries and Fact Line templates.
2. THE registry SHALL NOT change the behaviour, ids or quote of any existing action kind.
3. THE configuration SHALL have `streetOps.enabled`. WHEN it is false THEN no street-ops action SHALL appear in the catalogue, no street-ops content kind SHALL be required, and the game SHALL be identical to a game built without this spec.
4. WHEN street-ops is disabled THEN the golden replays of the slice and of every earlier follow-on spec SHALL produce identical results.
5. THE add-on SHALL register its content kinds through the Content Kind Registry in packs of role `extension`.
6. THE Content Manifest SHALL include the add-on's packs and version, so that saves made with and without it are not mixed (Slice Req 31.6).

### Requirement 2: Street Graph Content

**User Story:** As a player, I want a real map of the city's streets to drive on, so that "turn left" means something.

#### Acceptance Criteria

1. THE add-on SHALL register a `street-graph` content kind, scoped to one City, listing Junctions, Street Segments, Frontages and the Districts they lie in.
2. EVERY Street Segment SHALL have a street name from the City's street-name pool or from its own list, a length, a speed class, a one-way flag, a traffic level per phase, and a bearing at each end from which left and right are computed.
3. THE Pack Linter SHALL check that the graph is strongly connected for two-way streets, that one-way flags are consistent, that every Location with a Frontage is reachable from the Hub Location, and that every Sector Line crossing lies on a Segment.
4. WHERE a City has no Street Graph THEN `drive` SHALL be disallowed in that City with the reason "no usable street map", and the rest of the game SHALL be unaffected.
5. THE Player View SHALL show a Street Segment as named only after the player has driven it, seen it from a Junction, or read a Document that shows it. Other Segments SHALL be shown as unknown streets.
6. THE add-on SHALL ship a small, hand-authored, original Street Graph for the Core City (Vienna), covering the Inner City and the Sector Line crossings, for tests and for a playable demonstration. THE repository SHALL contain no third-party street data. Full graphs SHALL be built on the user's machine from a named source the user pulls themselves (Requirement 17), and a City SHALL need none.
7. EVERY Street Graph built from third-party data SHALL carry a Street Source list naming each dataset, its licence and its retrieval date, and the Content Loader SHALL refuse to load a built graph that lacks one.

### Requirement 3: Vehicles

**User Story:** As a player, I want a car that fits my cover and can carry what I need, so that choosing and risking a vehicle is part of the craft.

#### Acceptance Criteria

1. THE add-on SHALL register a `vehicle` content kind with a Year Range, a speed class, seats, a conspicuousness value and zero or more Concealment Spots with capacity, search difficulty and Endurance.
2. THE Sim SHALL give the player a Vehicle from the Station's pool at the start, consistent with the Cover Identity (a trade attaché does not arrive in a lorry).
3. THE Sim SHALL let the player hire, borrow from an Asset or return a Vehicle at a Location that offers it, at a quoted cost.
4. EVERY Vehicle SHALL have a registration that is tied to an identity, and SHALL be visible to a controller who reads it.
5. WHEN a Service records the Vehicle's registration in a Tail or a Checkpoint Check THEN THE Vehicle SHALL become **known** to that Service, and the Sim SHALL let the player swap Vehicles or plates at a cost to shed that.
6. THE Player View SHALL list the player's Vehicles and which are known to be burned. It SHALL exclude conspicuousness, search difficulty and hidden-spot quality.

### Requirement 4: Drive Sessions

**User Story:** As a player, I want to drive by choosing turns, so that the streets of the city are a place I move through and not a menu item.

#### Acceptance Criteria

1. THE add-on SHALL register a `drive` action kind that starts a Drive Session at the player's Location's Frontage in a chosen Vehicle.
2. AT every Junction THE Sim SHALL offer exactly the legal Turn Options for the Heading and the Street Graph, labelled by relative direction ("left", "right", "straight", "U-turn") and street name, plus speed (slow, normal, fast), stop, park and (at a Frontage) exit.
3. THE Sim SHALL NOT offer a Turn Option that is illegal in the Street Graph (a one-way against its direction, a barred turn).
4. EACH Drive Step SHALL be committed as one Action through the Turn Pipeline, so that save, load and replay work step by step, and the Drive Session state SHALL live in the World State.
5. THE Sim SHALL advance the clock by Drive Ticks. WHEN the ticks reach a phase boundary THEN THE Sim SHALL advance the phase and run the slice's boundary hooks, including the day boundary. Drive Steps SHALL cost no phase of their own, and a Drive Session SHALL cost at least one phase in total (Slice Req 3.1).
6. THE Sim SHALL show each Junction as a short Fact Line block: the street and Heading, the Turn Options, the Landmarks and Locations on the Segment, the traffic, and any visible Checkpoint.
7. WHEN the player parks at a Frontage THEN THE Drive Session SHALL end and the player SHALL be at that Location as for the slice `travel` action.
8. WHERE a Drive Session is open and the game is saved THEN a load SHALL resume at the same Junction and Heading.

### Requirement 5: Tails

**User Story:** As a player, I want to be followed by people who are good at it, so that going to a meeting without first making sure you are clean has a price.

#### Acceptance Criteria

1. THE Sim SHALL assign a Tail to the player from the Hostile Service's or a Local Security Service's beliefs, Cover Suspicion and doctrine (Slice Req 12), and not from a script.
2. EACH Tail SHALL have a Tail Team with a Tail Profile from the Service Definition and one or more Surveillance Methods whose Year Range contains the Game Year.
3. THE Sim SHALL compute each Tail Vehicle's position at every Drive Step as a deterministic function of the Street Graph, the player's path, the Tail Profile, and a `street` PRNG stream derived from the seed, the Drive Session's key and the step.
4. THE Truth Store SHALL hold the Tail Status, the Tail Team and every Tail Vehicle's position. THE Player View SHALL contain none of them before the debrief.
5. WHEN the player arrives at a Location with a Tail attached THEN THE Sim SHALL let the Hostile Service learn that Location and the people the player meets there, through the slice's Hostile Memory, and SHALL raise the Exposure of an Asset the player meets, as the slice does for watchers.

### Requirement 6: Spotting

**User Story:** As a player, I want to notice a car that keeps reappearing, so that spotting a tail is a skill of attention and not a die roll.

#### Acceptance Criteria

1. AT each Drive Step THE Sim SHALL run the slice observation check (Slice Req 23.1) over the Vehicles near the player and SHALL produce Observations of Vehicles with a descriptor (colour, kind, part of a registration) and the Segment.
2. THE Observations SHALL include Tail Vehicles and Innocent Traffic, and the Sim SHALL NOT mark which is which.
3. THE chance that a Tail Vehicle is observed SHALL depend deterministically on the Tail Profile's discipline, the Vehicle's conspicuousness, the Segment's traffic, whether the player used `look-around` or `check-mirror` (each a one-Tick action), and the PRNG.
4. THE Sim SHALL record each Observation as a Fact Line in the Journal. An Observation SHALL be true as a statement that the Vehicle was there, and SHALL carry no claim that it is a Tail.
5. THE Sim SHALL be able to produce a missed Tail (a true Tail not observed) and a false alarm (Innocent Traffic that repeats), at rates set by the Difficulty Preset.
6. THE Player View SHALL offer the player no oracle that says whether a Tail is attached.

### Requirement 7: Losing a Tail

**User Story:** As a player, I want to shake a tail by driving well, so that streets, timing and nerve matter.

#### Acceptance Criteria

1. THE add-on SHALL register an `evasion-maneuver` content kind with preconditions on the Street Graph (a one-way contraflow, a dead-end turn, a parking structure, a tram crossing, a Checkpoint), a quality, a tick cost and Year Range.
2. THE Sim SHALL offer an Evasion Maneuver as a Turn Option only where its preconditions hold at the current Junction.
3. WHEN the player performs one THEN THE Sim SHALL resolve the Tail's response deterministically from the maneuver quality, the Tail Profile, the number of Tail Vehicles, the Segment's traffic and the PRNG, and SHALL set the Tail Status to attached, lost, handed-off or burned.
4. WHEN a Tail is lost by an obvious maneuver THEN THE Sim SHALL raise Cover Suspicion with that Service by the content-defined amount for obvious evasion, and WHEN lost without the tail noticing it was shaken THEN THE Sim SHALL NOT.
5. THE player SHALL learn that a Tail is gone only from the absence of further Observations, and SHALL never be told.
6. THE Sim SHALL support a hand-off: the Tail Team replaces a Vehicle without a break, and the player SHALL see only new Observations.
7. WHEN the player completes a route the Sim classes as a Surveillance Detection Route THEN THE Sim SHALL summarise the Observations made on it, and SHALL give no verdict.

### Requirement 8: Checkpoints

**User Story:** As a player, I want checkpoints to be places I see coming and have to decide about, so that a road becomes a risk.

#### Acceptance Criteria

1. THE add-on SHALL implement the Checkpoint Check through multi-city's Border Check Extension Seam for a traveller in a Vehicle, and SHALL reuse multi-city's Border Outcome vocabulary (pass, secondary inspection, item seizure, entry refused, detention) plus vehicle seizure and turn-back.
2. A Checkpoint SHALL be a fixed Border Post or Sector Line crossing, a roadblock placed by an ambient-world City Event (for example a police crackdown) for its duration, or a random stop drawn from the police-pressure City Metric.
3. THE Checkpoint Check SHALL take as input the Controlling Service, the strictness, the Watch List (persons and Vehicle registrations), the Papers of every occupant, the Vehicle's registration, the declared Cover Story, the Checkpoint's search thoroughness and the PRNG.
4. THE search SHALL be one of: visual, interior, boot, or undercarriage, as the content-defined Checkpoint kind and the Game Year allow.
5. THE Sim SHALL show a Checkpoint to the player from a configured distance along the Segment, so that the player may slow, turn back or choose another route.
6. WHEN the player turns back at the sight of a Checkpoint THEN THE controllers MAY note it, and the Sim SHALL raise Cover Suspicion by the content-defined amount only where the Checkpoint's doctrine watches for avoidance.
7. FOR ANY other inputs held equal, A higher strictness or search thoroughness SHALL never lower the probability of detecting contraband or a Concealed Passenger.
8. THE Checkpoint's delay SHALL cost Drive Ticks, and a Tail Vehicle MAY be held at the Checkpoint, changing the Tail Status through Requirement 7.3.

### Requirement 9: Passengers and Smuggling

**User Story:** As a player, I want to carry a person across a line they cannot cross, so that an exfiltration is a plan that can fail.

#### Acceptance Criteria

1. THE Sim SHALL let the player pick up and drop off a Passenger, who must be an NPC able to be at that Location (an Asset, a defector or a person named by a Directive), at a quoted time cost.
2. THE Sim SHALL let the player declare a Passenger openly or place them in a Concealment Spot of the Vehicle, up to its capacity.
3. EACH Concealed Passenger SHALL have an Endurance in Drive Ticks. WHEN the Endurance is exhausted THEN THE Passenger SHALL be released or found, per the Sim's rules.
4. THE Concealed Passenger's composure SHALL be derived from the NPC's archetype Tags and persona, and SHALL affect the detection check at a Checkpoint.
5. THE detection check SHALL combine the Concealment Spot's search difficulty, the search thoroughness, the Passenger's composure, the ticks already concealed and the PRNG.
6. WHEN a Passenger is found THEN THE Sim SHALL apply the Border Outcome (detention of the occupants, Vehicle seizure, Cable to the Regional Station) and SHALL raise Cover Suspicion and the Passenger's Exposure.
7. WHEN a Passenger is delivered across a Border or Sector Line to the intended Location THEN THE Sim SHALL record the delivery for the Objective Evaluator.
8. THE add-on SHALL register a `smuggle` Directive objective kind through the Objective Evaluator, which Plot and Side Thread templates MAY use through Tag Queries and which no Plot Stage SHALL require.

### Requirement 10: Bluffing

**User Story:** As a player, I want to lie to a guard and be held to what I said, so that deception is something I plan and not a menu option.

#### Acceptance Criteria

1. THE add-on SHALL provide a Bluff Engine usable by any action, and street-ops Checkpoints SHALL be its first user.
2. THE player SHALL build a Cover Story from content-defined Story Templates that are consistent with the Cover Identity and the Papers, choosing identity, purpose, origin, destination, declared Passengers and declared cargo.
3. THE Bluff Engine SHALL resolve a Cover Story deterministically by comparing each claim with the Truth Store (the Vehicle's contents, the real origin and destination, the Papers), with the controller's Knowledge Slice and the Watch List, and with the Story Ledger.
4. THE controller SHALL ask Follow-Up Questions drawn from the controller's Knowledge Slice, and the player SHALL answer by selecting an option or by typing.
5. WHEN the player types an answer THEN the `bookkeeping` role SHALL transcribe it into Propositions as for NPC speech (Slice Req 7), and the Sim SHALL compare those Propositions with the Cover Story and the Story Ledger. A model SHALL NOT decide the outcome, and an answer selected from options SHALL involve no model at all.
6. THE controller's spoken lines MAY be voiced by the `voice` or `fast` role under the Leak Guard, and the Sim SHALL decide every outcome before the line is spoken.
7. THE Story Ledger SHALL record every Cover Story told to a Service and to each Service that shares records with it, including through liaison channels (multi-city Requirement 7).
8. WHEN a Cover Story or answer contradicts the Story Ledger, the Papers or the Vehicle's contents THEN THE Sim SHALL record a Bluff failure and SHALL raise Cover Suspicion by the content-defined amount.
9. THE Truth Store SHALL record each player statement as a deliberate lie or a true statement. THE Player View SHALL show the player their own Cover Stories as a told list, and SHALL show which were lies only in the debrief.
10. THE Bluff Engine SHALL have no player statistic. A bluff's chance SHALL come only from preparation the player controls: consistent Papers, Cover Identity fit, a consistent Story Ledger, and what is in the Vehicle.

### Requirement 11: Service Reactions and Notifications

**User Story:** As a player, I want my Station and the opposition to react to what happened on the road, so that the story continues after the drive.

#### Acceptance Criteria

1. THE Hostile and Local Security Services SHALL update their beliefs deterministically from Tail outcomes, Checkpoint outcomes, known Vehicles and Bluff results, through the slice's belief mechanism.
2. A Service MAY add a Vehicle registration to its Watch List, and multi-city's Watch List SHALL then apply to it at its Border Posts.
3. THE Regional Station SHALL send a Cable after a detention or Vehicle seizure, as multi-city defines for Border detentions.
4. EVERY Notification SHALL be built only from player-visible events (Slice Req 39.7).

### Requirement 12: Player View, Catalogue and Clients

**User Story:** As a player, I want driving to work in the terminal and the browser and be understood in plain words, so that it needs no special interface.

#### Acceptance Criteria

1. THE `player-view` catalogue SHALL enumerate the add-on's actions through the Action Extension Registry's enumerators, each paired with its quote.
2. THE Player View SHALL provide a `DriveView` (Junction, Turn Options, Observations, visible Checkpoint, Vehicle state, time), a Vehicles view and a told-stories view, and none SHALL contain Truth-branded values.
3. THE TUI and the Web Shell SHALL render these views as text with no graphics.
4. THE Narrator SHALL describe streets only from Street Graph facts, and the Street Graph's street and Landmark names SHALL be added to the Specifics Guard's allowed names.
5. THE add-on SHALL provide Phrasebook entries for each of its action kinds, for natural-language-commands.

### Requirement 13: Determinism, Isolation and Solvability

**User Story:** As the developer, I want this add-on unable to break the project's core guarantees, so that it can be developed and shipped as optional.

#### Acceptance Criteria

1. THE add-on SHALL draw randomness only from the `street` stream family, keyed by the Drive Session, so that it cannot perturb any other stream.
2. FOR ALL seeds, the same action log SHALL produce the same World State with the add-on enabled.
3. THE add-on SHALL add no Plot Stage dependency, and the discovery-path verification (Slice Req 1.4) SHALL pass with the add-on enabled or disabled.
4. THE Truth Store SHALL hold every Tail, Vehicle-content and bluff truth, and the isolation tests of Slice Req 2 SHALL include them.

### Requirement 14: Shipped Content and Performance

**User Story:** As a player, I want driving to work in the shipped city, so that the add-on is playable when it is enabled.

#### Acceptance Criteria

1. THE add-on SHALL ship, for the Core City: a Street Graph, at least six Vehicle Definitions, at least eight Evasion Maneuvers, at least three Tail Profiles, the Checkpoint kinds of each Sector Line, and at least ten Story Templates.
2. THE Pack Linter SHALL lint every new kind by Field Declarations, and the release profile SHALL enforce the quantities of 14.1.
3. EACH Drive Step SHALL complete within the configured budget on the Reference Machine when no model call is involved.
4. A Checkpoint Check with a typed Follow-Up Answer SHALL meet the slice latency targets (Slice Req 15.3).

### Requirement 15: Tests

**User Story:** As the developer, I want properties that pin the new mechanics, so that later changes do not quietly weaken them.

#### Acceptance Criteria

1. THE test suite SHALL verify that no Turn Option offered violates the Street Graph, over every Junction and Heading of every shipped graph.
2. THE test suite SHALL verify the monotonicity of Requirement 8.7 and the Endurance rule of Requirement 9.3.
3. THE test suite SHALL verify that the Player View of a Drive Session contains no Tail truth, over generated worlds.
4. THE test suite SHALL verify that a Bluff outcome reached through selected answers is independent of any model output, by running the same Cover Story with different fake model replies, and that a typed answer's outcome is a function of the extracted Propositions alone.
5. THE test suite SHALL verify that disabling the add-on reproduces the golden replays (Requirement 1.4).
6. THE test suite SHALL verify replay equality of a recorded Drive Session.

### Requirement 16: Street Knowledge and Street Maps

**User Story:** As a player, I want a map of the streets I know, so that I can plan a route and "turn left" is a decision and not a guess.

#### Acceptance Criteria

1. THE Sim SHALL keep Street Knowledge in the Player View state (not the Truth Store) with the source of each Segment and Junction: driven, seen from a Junction, read on a Map Document, local knowledge from the Cover Identity's residence or posting, or Navigation Aid.
2. THE Player View SHALL provide a Street Map View containing only Segments and Junctions in Street Knowledge, the player's Vehicle position and Heading, known Locations on their Frontages, visible Checkpoints, and the Sector Lines the player knows. It SHALL contain no Tail, no Vehicle other than the player's, no search thoroughness and no unseen Checkpoint.
3. THE Street Map View SHALL mark a Segment the player drove through as driven, and SHALL mark a Segment that is known but not driven as known, so that the player can tell experience from hearsay.
4. THE Sim SHALL provide a Local Map for each Junction as plain text: the street the player is on, the Heading, each Turn Option with its street name and relative direction, and the next Landmark on each Segment where known.
5. THE TUI SHALL render the Local Map and a text overview of the known network (streets and their junctions, by District), and SHALL need no graphics.
6. THE Web Shell SHALL render the Street Map View as a drawn map in plain SVG from the same view data, with the player's position and Heading, known Locations and Checkpoints, and SHALL add no information the view does not contain.
7. THE Sim SHALL let the player obtain a Map Document at a Location that sells or holds one, at a quoted cost, and reading it SHALL add the Segments it shows to Street Knowledge. A Map Document SHALL have a Year Range and MAY be out of date, omitting or misnaming streets that the Street Graph changed, as content defines.
8. WHERE the Capability `navigation-aid` is active (setting-generalization) THEN the Sim SHALL let the player use a Navigation Aid that adds the whole Street Graph and current traffic to Street Knowledge, and SHALL leave a Digital Trace for each use.
9. THE Street Map View SHALL show a Segment a Map Document got wrong as the Document shows it until the player drives or sees the true Segment, and SHALL then correct it with a Fact Line.
10. THE `drive` action SHALL be allowed from a Location with no Street Knowledge, because every Junction offers its legal Turn Options regardless, but the Street Map View SHALL then show only what the player has seen.

### Requirement 17: Street Graph Authoring

**User Story:** As a content author, I want a way to make a drivable street graph for a real city, so that adding a city does not mean placing every junction by hand.

#### Acceptance Criteria

1. THE `content-tools` package SHALL provide a Street Graph builder that takes a street dataset the user has fetched for a city, a bounding area and a list of Locations with their coordinates, and produces a `street-graph` file on the user's machine.
2. THE builder SHALL simplify the dataset: merge minor Segments, keep named streets, choose Junctions, compute bearings, one-way flags and speed classes, attach each Location to a Frontage, and place the City's known Sector Line crossings and fixed Checkpoints on named Segments.
3. THE builder SHALL write the Street Source list, with each dataset's name, licence, attribution text and retrieval date, and SHALL refuse to run on a dataset that carries no recorded licence acceptance (Requirement 17.9).
4. THE builder SHALL be deterministic: the same input files SHALL produce the same graph, byte for byte.
5. THE builder SHALL support a hand-edited overrides file (renamed streets, closed bridges, one-way changes for the Period Window) so that a modern dataset can be adjusted to a historical layout, and each override SHALL name its source or reason.
6. EVERY Street Graph SHALL declare a Period Fidelity of `modern-base` (modern data with no period review), `period-checked` (modern geometry with period overrides for known differences) or `period-authored` (drawn from period sources). WHERE the Era Pack's Period Window predates the dataset THEN THE Pack Linter SHALL warn on `modern-base` and SHALL report the share of Segments covered by overrides, and the shipped Core City graph SHALL be `period-authored`.
7. THE builder's output SHALL pass the checks of Requirement 2.3, and the Coverage Report SHALL list each City's Street Graph size and the share of Locations with a Frontage.
8. THE builder SHALL NOT download data itself, during a game or at load. Data SHALL be fetched only by the explicit command of Requirement 17.9.
9. THE `content-tools` package SHALL provide a command that fetches street data from a **named source** that the user chooses. `config/street-sources.yaml` SHALL list each supported source with its name, its retrieval method, the licence it states and the attribution it requires, and SHALL be the only place sources are named.
10. THE fetch command SHALL show the source's stated licence and attribution, SHALL require the user to accept it explicitly (an `--accept-licence` flag naming the source), and SHALL record the acceptance, the source, the area and the date beside the downloaded data.
11. THE fetched data and every graph built from it SHALL be written to git-ignored directories under the user's checkout, and the repository SHALL NOT commit them.
12. THE builder SHALL write an attribution file next to each built graph, and the title and credits screens SHALL show the attributions of every loaded built graph.
13. THE builder's output pack SHALL be an ordinary extension pack, so that the Content Manifest includes its version and hash, and a save made with one graph SHALL be refused by a build that has a different one (Slice Req 31.6).
14. THE period pass SHALL be automatable end to end, with no hand tracing of maps. `config/street-sources.yaml` SHALL also list **Period Name Sources**: per-city sources of dated street names (for Vienna, the Wien Geschichte Wiki's `Topografisches Objekt` records, read through its MediaWiki API). THE fetch command of Requirement 17.9 SHALL download them under the same licence-acceptance rule, and SHALL store only facts (names, dates, predecessor links, coordinates), never text or images.
15. A `street-graph period` command SHALL, for a given year, resolve every named Segment's name through the Period Name Source: it SHALL follow predecessor links (`Frühere Bezeichnung` for Vienna) and pick the name whose date range contains the year. It SHALL write the results as overrides that cite the record, and SHALL mark a street as `not-yet-built` WHEN its earliest recorded name starts after the year and it has no predecessor.
16. THE period command SHALL be deterministic over its inputs, and SHALL write a Period Report listing every street it could not resolve with certainty (no record, overlapping date ranges, gaps). Each reported item SHALL be resolvable by an agent or author through an override with a stated source and reason, and the graph SHALL be `period-checked` only when the report has no open items.
17. THE overrides file SHALL support the operations `rename`, `remove` (a Segment or Junction that did not exist), `add` (a Segment with geometry, name and endpoints that no longer exists today), `close` (existed but impassable, such as rubble or a destroyed bridge), `reclassify` (road class, one-way, surface) and `replace-area` (discard every modern Segment inside a polygon and substitute hand-drawn ones). EVERY override SHALL cite its source (a record, or an imagery layer and tile) and SHALL carry a confidence of `certain`, `likely` or `inferred`.
18. THE Period Report SHALL include coverage: the share of Segments confirmed by a dated record or by imagery review, the share changed by overrides, and the share unchecked. A graph SHALL be `period-checked` only WHEN the unchecked share inside its Verified Area is zero.
19. EVERY built Street Graph SHALL declare a **Verified Area** (one or more polygons). Segments outside it SHALL be loaded as `unmapped`: the Sim SHALL NOT offer them as drive choices, and the Street Map View SHALL NOT draw them, so unverified modern streets never reach play.
20. `config/street-sources.yaml` SHALL also list **Period Imagery Sources**: georeferenced period maps and aerial photographs with a stated licence. For Vienna these SHALL be the City of Vienna's Open Government Data layers (CC BY 4.0, attribution "Datenquelle: Stadt Wien – data.wien.gv.at"): the war-damage plan of about 1946 (WMS layer `BOMBENSCHADENOGD`), the 1956 and 1938 aerial photo plans (WMTS layers `lb1956`, `lb1938`) and the 1912 general city plan (WMS `GENLPLAN1912OGD`). They SHALL be fetched under the licence-acceptance rule into git-ignored directories.
21. A `street-graph review-sheets` command SHALL cut the Verified Area into tiles and, for each tile, write a review sheet that places the modern Segments (drawn over each period layer) beside the period layers at the same extent. An agent or author SHALL review each sheet and record, per tile, the overrides found and that the tile was reviewed. A difference that cannot be read with confidence from the imagery SHALL be recorded as an open Period Report item, not guessed.
