# Requirements Document

## Introduction

This spec turns the single-game vertical slice (`.kiro/specs/tradecraft/`, "the slice") into a career. A Campaign is a chain of Postings. Each Posting is one slice game in one real city, set somewhere on an early Cold War timeline (1948–1962). All characters and events are fictional. Between Postings the Officer returns to HQ, where the last Posting's Outcome Record (slice Req 35) is turned into consequences: promotion or reprimand, skills learned, Legends burned, Assets handed over or brought along, and a growing Hostile Dossier on the Officer. Enemies remember the Officer. A nemesis hostile officer, a years-long mole hunt inside HQ and the advancing era tie the Postings together.

Every slice invariant still holds, at Campaign scope:

- **Truth isolation** (slice Req 2): campaign-level truth (an Asset's true allegiance, the HQ mole's identity, what a Hostile Service really knows) stays on the truth side. The player sees only what they learned.
- **Determinism** (slice Req 1.2, 17.4): the Campaign seed, the Content Manifests, the Campaign Choice Log and the recorded model responses reproduce the whole Campaign.
- **Solvability** (slice Req 1.4): every Posting keeps two independent discovery paths per Plot Stage, whatever is carried in.
- **Model outputs never write facts** (slice Req 2.3): nothing in this spec gives a model a new write path.

This spec builds on the completed slice. It depends on these follow-on specs only through the interfaces stated in Requirement 21:

- **plot-library**: provides Plot selection (`select(SelectionInput)`) and the canonical Template History type. This spec supplies a Template History built from Outcome Record schema-2 `plots[]` entries, plus optional selection context.
- **content-expansion**: supplies City Packs, Era Packs, `service` Service Definitions and the Content Kind Registry through which this spec registers its content kinds.
- **ambient-world**: receives the era year and Tension.

Implementation order: content-expansion → plot-library → ambient-world → campaign-career → multi-city. content-expansion tasks 1–2 are a hard prerequisite.

A Posting is always one city. Multi-city Postings belong to the multi-city spec.

## Glossary

- **Campaign**: A chain of Postings played by one Officer, from creation to a Campaign End.
- **Campaign Engine**: The deterministic component that owns Campaign state, runs the HQ Phase, and builds each Posting's inputs. It is truth-side, like the Sim.
- **Campaign Truth**: Campaign-level ground truth (carried true allegiances, the HQ mole's identity, Hostile Dossier contents, arc state). It is stored only by the Campaign Engine.
- **Campaign View**: The player-visible projection of Campaign state. It is a strict subset that excludes Campaign Truth.
- **Campaign Seed**: The seed from which every Posting seed and the campaign PRNG stream are derived.
- **Campaign Choice Log**: The ordered log of every campaign-level player choice, plus a reference to each Posting's action log (slice Req 17.5).
- **Posting**: One slice game in one city, at one point on the Era Timeline.
- **Posting Context**: The inputs the Campaign Engine supplies to a Posting: seed, city, year, Tension, preset overrides, Carry-In and Player History.
- **Posting Result**: The archived end of a Posting: its Outcome Record, its Posting Stats, its redacted debrief and its Player Carry.
- **Posting Stats**: Counts derived from a Posting's action log and Player View (for example Intercepts broken or Assets recruited). They are used for skill growth.
- **Player Carry**: The view-safe extract of what the player knew at the end of a Posting: identified persons and aliases, Unidentified Subjects seen, their own grades and notes.
- **Carry-Over**: The pure function that folds a Posting Result into Campaign state.
- **Carry-In**: The set of carried entities, beliefs and modifiers that the Campaign Engine injects into a new Posting.
- **Officer**: The player character across the Campaign.
- **Rank**: The Officer's grade on a fixed ladder: Case Officer, Senior Case Officer, Deputy Chief of Station, Chief of Station, Controller.
- **Skill**: A trained Officer ability with a level from 0 to 5 (tradecraft, surveillance, handling, cryptanalysis, cover, and one per language).
- **Trait**: A content-defined Officer quality gained or lost through events (for example "Steady Hand" or "Known Face in Vienna").
- **Stress**: An Officer value from 0 to 100, raised by burns, captures and Asset losses and lowered by leave.
- **Legend**: A Cover Identity instance used by the Officer in a Posting, with its name and the Hostile Services that hold it as burned.
- **Official Cover**: A Legend with diplomatic status. If it is burned, the Officer is expelled.
- **Non-official Cover**: A Legend without diplomatic status. If it is burned, the Officer is captured.
- **Career Standing**: The Officer's long-run reputation with HQ, accumulated from Posting Standing (slice Req 27).
- **Faction**: A content-defined group whose opinion of the Officer matters (HQ directorates, allied liaison services, Hostile Services).
- **Faction Reputation**: The Officer's standing with one Faction, from −10 to +10.
- **Notoriety**: How well a Hostile Service knows the Officer, from 0 to 1.
- **HQ Phase**: The between-Posting sequence: debrief, Review Board, consequences, arc events, offers, training, requisitions, leave, and Legend choice.
- **Review Board**: The HQ Phase step that decides promotion, demotion, reprimand or dismissal.
- **Posting Offer**: A candidate next Posting (city, year, tour length, difficulty tier, Directive theme).
- **Requisition**: A starting resource bought with Career Points for the next Posting.
- **Career Points**: An HQ Phase currency earned from Posting results and spent on Requisitions.
- **Handover**: Leaving an Asset in its city under a successor. The Asset can be re-contacted if the Officer returns.
- **Exfiltration**: Removing an Asset from its city to safety. The Asset leaves play and gives a one-off benefit.
- **Travelling Asset**: An Asset whose archetype is mobile and who can follow the Officer to the next Posting.
- **Hostile Dossier**: A Hostile Service's accumulated knowledge of the Officer: burned Legends, descriptor, Tradecraft Patterns, suspected Assets and Notoriety. It is Campaign Truth.
- **Tradecraft Pattern**: A city-independent habit the Hostile Service has learned, such as the Location Types the Officer uses for drops or meetings.
- **Recogniser**: A carried hostile NPC who can identify the Officer on sight.
- **Personal File**: A Document generated at the start of a Posting from Player Carry. It delivers the player's carried knowledge as Claims with source "document".
- **Campaign Arc**: A content-defined storyline whose stages span Postings.
- **Arc Thread**: The part of a Campaign Arc injected into one Posting: entities, Propositions and traces.
- **Arc Clue**: A Proposition in an Arc Thread that advances the player's knowledge of the arc.
- **Nemesis**: A hostile officer, chosen by the Nemesis arc, who recurs across Postings.
- **HQ Mole**: A fictional HQ figure, secretly working for a Hostile Service, chosen by the Mole Hunt arc.
- **Mole Hunt**: The Campaign Arc in which the player gathers Arc Clues and may accuse an HQ figure.
- **Era Timeline**: The calendar from 1948 to 1962, divided into Epochs.
- **Epoch**: A span of years with its own available ciphers, technology flags, Tension range and fictional background events.
- **Tension**: The era-level hostility value, from 0 to 1, for a given year.
- **Capture**: The outcome of a burn under Non-official Cover, resolved in the HQ Phase as exchange, imprisonment or death.
- **Campaign End**: One of retirement, death, disgrace or defection.
- **Archive**: The Campaign View's history: career timeline, Posting Results, and redacted debriefs that are revealed fully at Campaign End.
- **Player History**: The view-safe summary of past Postings that the Campaign Engine supplies to Plot selection: a `templateHistory` (plot-library Template History entries built from Outcome Record schema-2 `plots[]`) plus optional selection context (year, Tension, Epoch flags, Rank and a scaling hint).
- **Template History**: plot-library's ordered list of past Plot instances (template id, Variant Key, archetype, outcome).
- **City Pack**: A Content Pack (content-expansion) that defines one real city for Postings.
- **Era Pack**: A Content Pack (content-expansion or core) that defines Epochs.
- **Campaign Save**: The versioned campaign-level save file.
- **Migration**: A pure function that converts a Campaign Save from one schema version to the next.

## Requirements

### Requirement 1: Campaign Creation

**User Story:** As a player, I want to create an Officer and start a career, so that my choices carry from one city to the next.

#### Acceptance Criteria

1. WHEN the player starts a new Campaign THEN the Campaign Engine SHALL record a Campaign Seed, a Difficulty Preset (slice Req 34), an Officer name, a background chosen from the Content Set, a start year between 1948 and 1950, and the Content Manifest.
2. WHEN the player does not supply a Campaign Seed THEN the Campaign Engine SHALL generate one and display it.
3. WHEN a background is chosen THEN the Campaign Engine SHALL set the Officer's starting Rank, Skills, languages, Traits and Faction Reputation from that background's content definition.
4. WHEN the Campaign is created THEN the Campaign Engine SHALL generate the HQ cast (Faction figures and HQ Mole candidates) and the Campaign Arcs from the campaign PRNG stream.
5. WHEN the Campaign is created THEN the Campaign Engine SHALL present 2–3 Posting Offers for the first Posting.

### Requirement 2: Campaign Determinism

**User Story:** As the developer, I want a Campaign to be fully reproducible, so that career bugs and long playthroughs can be replayed exactly.

#### Acceptance Criteria

1. THE Campaign Engine SHALL derive the seed of Posting *k* only from the Campaign Seed and *k*.
2. THE Campaign Engine SHALL draw all campaign-level randomness from a campaign PRNG stream derived from the Campaign Seed and kept separate from every Posting stream.
3. THE Campaign Engine SHALL append every campaign-level player choice to the Campaign Choice Log, with a reference to each Posting's action log and model recording.
4. WHEN a Campaign is replayed from its Campaign Seed, Content Manifests, Campaign Choice Log and recorded model responses THEN the Campaign Engine SHALL reach a Campaign state identical to the original.
5. THE Campaign Engine SHALL derive every Campaign state change from the previous Campaign state, a Posting Result or a logged choice, and the campaign PRNG stream.

### Requirement 3: The Officer

**User Story:** As a player, I want an Officer who grows, scars and gets a reputation, so that the career feels like one life.

#### Acceptance Criteria

1. THE Campaign Engine SHALL keep for the Officer a name, Rank, Skill levels, Traits, Stress, the list of used Legends with their burned status per Hostile Service, Career Standing, Faction Reputation and Notoriety per Hostile Service.
2. WHEN a Posting Result is folded THEN the Campaign Engine SHALL grant Skill experience from the Posting Stats, and SHALL raise a Skill by one level when its experience reaches the content-defined threshold, up to level 5.
3. WHEN a trait trigger defined in the Content Set occurs THEN the Campaign Engine SHALL add or remove the matching Trait.
4. WHEN a Posting ends with the Officer burned, an Asset arrested or a Capture THEN the Campaign Engine SHALL raise Stress by the content-defined amount.
5. WHILE Stress is at or above 80 THEN the Campaign Engine SHALL apply the "strained" Trait penalties in the next Posting.
6. IF Stress reaches 100 THEN the Campaign Engine SHALL force medical leave for the next HQ Phase, which consumes that HQ Phase's training and offers the player only a reduced set of Posting Offers.

### Requirement 4: Officer Effects on a Posting

**User Story:** As a player, I want my skills and rank to change how a Posting plays, so that experience is earned and felt.

#### Acceptance Criteria

1. WHEN a Posting starts THEN the Campaign Engine SHALL convert the Officer's Rank, Skills and Traits into Difficulty Preset overrides and scenario weight modifiers (slice Req 34, 41) through content-defined mappings.
2. THE Campaign Engine SHALL clamp every Officer-derived modifier to the bounds declared in its content mapping, and SHALL keep every resulting preset field within the Difficulty Preset schema.
3. WHEN the Posting is in a city whose language the Officer speaks at level 2 or higher THEN the Campaign Engine SHALL apply the language's Cold Approach modifier (slice Req 22.3).
4. THE Campaign Engine SHALL set the Posting's starting Budget, arrest authority and Station staff count from the Officer's Rank through the Rank table in the Content Set.
5. THE Campaign Engine SHALL apply Officer modifiers only through Posting Context inputs and SHALL NOT change slice formulas.

### Requirement 5: Posting Lifecycle

**User Story:** As a player, I want each Posting to start from the career I have built and to end in a record that HQ will judge, so that the chain stays connected.

#### Acceptance Criteria

1. WHEN the player accepts a Posting Offer THEN the Campaign Engine SHALL build a Posting Context and start a slice game with it.
2. THE Posting Context SHALL contain the Posting seed, City Pack id, year, Tension, preset overrides, scenario modifiers, Legend, Carry-In and Player History.
3. WHEN a Posting ends (slice Req 19.3–19.5, 38.6) THEN the Campaign Engine SHALL build a Posting Result from the Outcome Record, the final Truth Store, the action log and the final Player View, and SHALL append it to the Archive.
4. WHEN a Posting Result is archived THEN the Campaign Engine SHALL advance the Campaign calendar by the Posting Offer's tour length of 1 to 3 years.
5. WHILE a Posting is in progress THEN the Campaign Engine SHALL allow slice saves and loads (slice Req 17) inside the Campaign Save.

### Requirement 6: Carry-Over

**User Story:** As the developer, I want consequences derived purely from the record of a Posting, so that the career layer is testable and reproducible.

#### Acceptance Criteria

1. THE Campaign Engine SHALL compute Carry-Over as a pure function of the Campaign state, the Posting Result and the campaign PRNG state.
2. THE Campaign Engine SHALL fold into Campaign state: the Outcome Record's outcome, Standing, Directive results, surviving Assets, Cover status, Cover Suspicion, Hostile Memory and remaining Budget (slice Req 35.2).
3. THE Campaign Engine SHALL validate every Posting Result against its versioned schema before it applies Carry-Over.
4. IF a Posting Result fails validation THEN the Campaign Engine SHALL leave Campaign state unchanged and report the field paths that failed.
5. THE Campaign Engine SHALL compute Posting Stats only from the Posting's action log and Player View.

### Requirement 7: Truth Isolation Across Postings

**User Story:** As a player, I want the career layer to tell me only what I actually learned, so that the mystery survives from one Posting to the next.

#### Acceptance Criteria

1. THE Campaign Engine SHALL store carried true allegiances, hostile-controlled flags, the HQ Mole's identity, Hostile Dossier contents and arc state only in Campaign Truth.
2. THE UI SHALL read only from the Campaign View, the Player View and the Case File.
3. WHILE a Campaign is active THEN the Campaign Engine SHALL redact from each archived and displayed debrief (slice Req 19.6) every truth item that concerns a carried Asset, a Recogniser, the Nemesis or the HQ Mole, unless the player's own Case File already established that item.
4. WHEN the Campaign ends THEN the Archive SHALL reveal every redacted debrief item and the Campaign Truth behind each Campaign Arc.
5. THE Campaign Engine SHALL build Player Carry only from the final Player View and Case File of the Posting.
6. THE Campaign Engine SHALL build the Personal File only from Player Carry, so that every carried Claim is one the player held.

### Requirement 8: Review Board

**User Story:** As a player, I want HQ to judge my record, so that success and failure shape my career.

#### Acceptance Criteria

1. WHEN an HQ Phase begins THEN the Review Board SHALL compute a career score from Posting outcome, Posting Standing, Directive results, wrongful arrests, Assets lost and Faction Reputation, using content-defined weights.
2. WHEN the career score is at or above the promotion threshold for the Officer's Rank THEN the Review Board SHALL promote the Officer one Rank, up to Controller.
3. WHEN the career score is below the demotion threshold THEN the Review Board SHALL demote the Officer one Rank, and IF the Officer is already a Case Officer THEN SHALL issue a reprimand.
4. IF the Officer holds three reprimands or Career Standing falls below the dismissal floor THEN the Review Board SHALL dismiss the Officer, which ends the Campaign in disgrace.
5. THE Review Board SHALL award Career Points from the career score.
6. THE Review Board SHALL deliver its decision as a Cable Document whose text is rendered from content templates.

### Requirement 9: Posting Offers and Assignment

**User Story:** As a player, I want to choose where I go next, or be sent somewhere when HQ is displeased, so that the career has direction.

#### Acceptance Criteria

1. WHEN the Review Board finishes THEN the Campaign Engine SHALL generate 2–4 Posting Offers from City Packs whose availability range contains the current year.
2. THE Campaign Engine SHALL give each Posting Offer a city, a year, a tour length, a difficulty tier and a Directive theme.
3. WHILE Career Standing is below the assignment threshold THEN the Campaign Engine SHALL present one assigned Posting instead of a choice.
4. THE Campaign Engine SHALL exclude a city from Posting Offers when a Hostile Service active in that city holds the Officer's descriptor and its Notoriety for the Officer is at or above 0.9.
5. WHEN only the core pack's city is available THEN the Campaign Engine SHALL offer it, with a different Posting seed for each Posting.

### Requirement 10: Training, Requisitions, Leave and Legends

**User Story:** As a player, I want to prepare between Postings, so that I can shape the Officer for what comes next.

#### Acceptance Criteria

1. WHEN the HQ Phase reaches preparation THEN the Campaign Engine SHALL offer two training slots, each raising one Skill or language by one level up to the training cap set by Rank.
2. WHEN the player buys a Requisition THEN the Campaign Engine SHALL debit its Career Point cost and add its effect to the next Posting Context.
3. IF a Requisition costs more Career Points than the Officer holds THEN the Campaign Engine SHALL reject the purchase and leave state unchanged.
4. WHEN the player takes leave THEN the Campaign Engine SHALL lower Stress by the content-defined amount, and leave SHALL consume one training slot.
5. WHEN the player chooses a Legend for the next Posting THEN the Campaign Engine SHALL offer only Cover Identities that are allowed in the chosen city and not burned to any Hostile Service active there.
6. THE Campaign Engine SHALL record every training, Requisition, leave and Legend choice in the Campaign Choice Log.

### Requirement 11: Asset Continuity

**User Story:** As a player, I want to decide the fate of the network I leave behind, so that the people I recruited still matter.

#### Acceptance Criteria

1. WHEN an HQ Phase begins THEN the Campaign Engine SHALL list every surviving Asset from the Outcome Record and require one decision per Asset: Handover, Exfiltration, or, for a Travelling Asset, bring along.
2. WHEN an Asset is handed over THEN the Campaign Engine SHALL add Career Standing from the Asset's trust and SHALL keep the Asset in that city's record for later Postings.
3. WHEN a later Posting is in a city with handed-over Assets THEN the Campaign Engine SHALL inject each one as a Principal NPC with a Contact Channel and with trust reduced by the content-defined decay per year away.
4. WHEN an Asset is exfiltrated THEN the Campaign Engine SHALL debit its Career Point cost, remove the Asset from play, and grant its archetype's one-off benefit.
5. WHEN a Travelling Asset is brought along THEN the Campaign Engine SHALL inject it into the next Posting as a Principal NPC and starting contact.
6. THE Campaign Engine SHALL carry each Asset's hostile-controlled status (slice Outcome Record `doubled`) unchanged in Campaign Truth, and WHILE a hostile-controlled Asset is in play THEN its reports SHALL follow slice Req 10.6 and 11.5.

### Requirement 12: Hostile Memory and Recognisers

**User Story:** As a player, I want enemy services to remember me, so that being careless in one city follows me to the next.

#### Acceptance Criteria

1. WHEN a Posting Result is folded THEN the Campaign Engine SHALL merge the Outcome Record's Hostile Memory into the Hostile Dossier of that Posting's Hostile Service.
2. THE Campaign Engine SHALL translate city-local Hostile Memory into city-independent Tradecraft Patterns (the Location Types and Channel kinds of compromised drops and channels).
3. THE Campaign Engine SHALL keep the set of burned Legends in a Hostile Dossier from shrinking.
4. WHEN a Posting starts THEN the Campaign Engine SHALL convert the active Hostile Service's Dossier into Carry-In: starting Cover Suspicion, starting tail state, doctrine shift and detection modifiers for matching Tradecraft Patterns, each clamped to content-defined bounds.
5. WHEN a hostile NPC from an earlier Posting survives at large THEN the Campaign Engine SHALL keep the NPC as a carried hostile NPC, and MAY place them in a later Posting of the same Hostile Service as a Recogniser.
6. WHEN a Recogniser observes the Officer at a Location (using slice detection rules, Req 23.6) THEN the Sim SHALL raise Cover Suspicion by the Recogniser amount and emit a hidden event.
7. WHILE a Hostile Service's Notoriety for the Officer is above zero THEN the Campaign Engine SHALL reduce it between Postings by the content-defined decay per year.

### Requirement 13: Carried Knowledge

**User Story:** As a player, I want to recognise faces and names from earlier Postings, so that my experience is worth something.

#### Acceptance Criteria

1. WHEN a Posting starts THEN the Sim SHALL deliver a Personal File Document in the Starting Brief (slice Req 26.1), listing carried persons the player identified and their carried aliases.
2. WHEN the player reads the Personal File THEN the Sim SHALL add its asserted Propositions as Claims with source "document" (slice Req 30.4).
3. WHEN a carried person that the player saw only as an Unidentified Subject is observed in a later Posting THEN the Sim SHALL reuse the campaign-level Unidentified Subject and SHALL show a Fact Line naming the earlier city and year of the sighting.
4. WHEN a carried person the player never observed appears in a later Posting THEN the Sim SHALL treat the person as an ordinary unknown NPC.
5. THE Archive SHALL keep every past Case File read-only.

### Requirement 14: Campaign Arcs

**User Story:** As a player, I want storylines that run across years and cities, so that the career has a shape beyond any single Posting.

#### Acceptance Criteria

1. THE Campaign Engine SHALL load Campaign Arc templates from the Content Set, each with stages, stage conditions on Campaign state, Arc Thread templates and resolution rules.
2. WHEN a Posting Context is built THEN the Campaign Engine SHALL add an Arc Thread for every active arc stage whose conditions hold.
3. WHEN an Arc Thread is injected THEN the Sim SHALL add its entities and Propositions after core world generation verification and before noise, on a stream derived separately from the core and noise streams.
4. THE Sim SHALL verify that every Arc Clue in an injected Arc Thread has at least one discovery path from the Starting Brief.
5. WHEN a Posting Result is folded THEN the Campaign Engine SHALL advance each arc from the Arc Clues the player obtained (from the Case File) and from Outcome Record truth.
6. THE Campaign Engine SHALL include no Cell member as an Arc Thread participant.

### Requirement 15: Nemesis

**User Story:** As a player, I want a rival who grows with me, so that my opponent has a face.

#### Acceptance Criteria

1. WHEN the Nemesis arc activates THEN the Campaign Engine SHALL choose a surviving hostile officer from an earlier Posting, or generate one, as the Nemesis.
2. WHEN a Posting's Hostile Service is the Nemesis's service and the arc stage requires it THEN the Campaign Engine SHALL place the Nemesis as a Principal NPC of that Hostile Service and as a Recogniser.
3. WHEN the Nemesis survives a Posting THEN the Campaign Engine SHALL raise the Nemesis's rank and doctrine skill by the content-defined step.
4. WHEN the Nemesis is arrested, turned (slice Req 36) or dies THEN the Campaign Engine SHALL resolve the Nemesis arc.
5. WHERE the arc stage allows a pitch THEN the Nemesis SHALL be able to offer the Officer defection through a Walk-in or a dead-drop letter Document.

### Requirement 16: HQ Mole Hunt

**User Story:** As a player, I want to hunt a traitor inside my own service over years, so that loyalty is never certain.

#### Acceptance Criteria

1. WHEN the Campaign is created THEN the Campaign Engine SHALL choose the HQ Mole from the HQ Mole candidates and record the choice only in Campaign Truth.
2. WHILE the HQ Mole is active THEN the Campaign Engine SHALL raise the Hostile Dossier's knowledge of the Officer between Postings from the Cables and Directives the HQ Mole can access.
3. WHEN a Posting Context is built THEN the Campaign Engine SHALL add Mole Hunt Arc Threads whose Arc Clues concern the HQ Mole.
4. WHEN the player accuses an HQ figure in the HQ Phase THEN the Campaign Engine SHALL allow the accusation only if the Archive holds at least the content-defined number of corroborated Arc Clues implicating that figure, counted only from player-held Claims.
5. WHEN an allowed accusation names the HQ Mole THEN the Campaign Engine SHALL resolve the Mole Hunt arc, and SHALL raise Career Standing and Security Faction Reputation.
6. IF an allowed accusation names anyone else THEN the Campaign Engine SHALL issue a reprimand and lower Security Faction Reputation, and the outcome SHALL use the same Cable template whatever the true identity.

### Requirement 17: Era Timeline

**User Story:** As a player, I want the world to change as the years pass, so that 1949 and 1961 feel different.

#### Acceptance Criteria

1. THE Campaign Engine SHALL load Epochs from Era Packs, each with a year range, allowed cipher kinds, technology flags, a Tension range and background event templates.
2. WHEN a Posting Context is built THEN the Campaign Engine SHALL set the Posting's allowed ciphers to the intersection of the Epoch's ciphers and the Difficulty Preset's ciphers.
3. IF the intersection of the Epoch's ciphers and the Difficulty Preset's ciphers is empty THEN the Campaign Engine SHALL use the Epoch's weakest allowed cipher.
4. WHEN a Posting Context is built THEN the Campaign Engine SHALL derive Tension for the year deterministically from the Epoch range and the campaign PRNG stream, and SHALL shift Hostile Service doctrine ranges by Tension within the preset bounds.
5. THE Campaign Engine SHALL render background events only from fictional event templates, and SHALL pass the year and Tension to the ambient-world interface.
6. WHEN the calendar passes 1962 THEN the Campaign SHALL end in retirement.

### Requirement 18: Posting Solvability Under Carry-In

**User Story:** As a player, I want every Posting to be winnable however my past went, so that a bad career is hard but never hopeless.

#### Acceptance Criteria

1. THE Sim SHALL apply Carry-In only by adding entities, Contact Channels, Claims, Documents and bounded modifiers, and SHALL NOT remove any edge from the slice's learnability graph (slice design, Discovery paths).
2. WHEN Carry-In has been applied THEN the Sim SHALL re-run discovery-path verification (slice Req 1.4), and IF it fails THEN SHALL retry Carry-In placement from the next derived carry seed.
3. IF every carry placement attempt fails verification THEN the Sim SHALL drop optional carried placements (Recognisers, then Arc Threads) in a fixed order until verification passes.
4. THE Campaign Engine SHALL cap starting Cover Suspicion from Carry-In at half the Posting's burn threshold.
5. WHEN no Carry-In is supplied THEN the Sim SHALL generate a World State identical to slice generation from the same seed and inputs.

### Requirement 19: Burns, Captures and Campaign End

**User Story:** As a player, I want the career to end in a way that follows from how I played, so that the stakes are real.

#### Acceptance Criteria

1. WHEN a Posting ends with the Officer burned under Official Cover THEN the Campaign Engine SHALL record an expulsion, mark the Legend burned to that Hostile Service, and continue to the HQ Phase.
2. WHEN a Posting ends with the Officer burned under Non-official Cover THEN the Campaign Engine SHALL resolve a Capture as exchange, imprisonment or death, deterministically from Career Standing, Tension, Traits and the campaign PRNG stream.
3. WHEN a Capture resolves as exchange or imprisonment THEN the Campaign Engine SHALL advance the calendar by the content-defined years lost and raise Stress.
4. THE Campaign SHALL end in death only when a Capture resolves as death.
5. THE Campaign SHALL end in disgrace when the Review Board dismisses the Officer (Requirement 8.4).
6. WHEN the Officer has completed at least three Postings, or a Capture offers it, or the Nemesis offers defection, THEN the Campaign Engine SHALL offer the player retirement or defection respectively, and an accepted offer SHALL end the Campaign.
7. THE Campaign SHALL end only on a trigger listed in this requirement or in Requirement 17.6.
8. WHEN the Campaign ends THEN the UI SHALL show the end type, the final Rank, the career timeline and the full Archive reveal.

### Requirement 20: Archives and Campaign UI

**User Story:** As a player, I want to look back over my career, so that the history I made is visible and rewarding.

#### Acceptance Criteria

1. THE UI SHALL provide an Archive view with the career timeline (Postings, Ranks, Legends, end of each Posting), each Posting's redacted debrief, and its read-only Case File.
2. THE UI SHALL provide an Officer view with Rank, Skills and experience, Traits, Stress, Legends and their known burn status, Career Standing and Faction Reputation bands.
3. THE UI SHALL provide a Known Enemies view listing carried hostile persons the player identified or observed, by name or descriptor, with the cities and years of contact.
4. THE UI SHALL provide an HQ Phase screen that steps through the debrief, Review Board Cable, Asset decisions, arc events, Posting Offers, training, Requisitions, leave, Legend choice and accusation.
5. THE UI SHALL show the Officer's burn status of a Legend only where the player observed the burn (a burned Posting, an expulsion, or a "made" Fact Line).
6. THE engine SHALL expose a Campaign API in the player-view package, so that the TUI imports nothing outside player-view (slice Req 13.5).

### Requirement 21: Interfaces to Other Specs

**User Story:** As the developer, I want the campaign layer to depend on other specs only through stated interfaces, so that the follow-on specs can be built in parallel.

#### Acceptance Criteria

1. THE Campaign Engine SHALL supply Plot selection with a Player History containing a `templateHistory` of plot-library Template History entries built from the archived Outcome Records' schema-2 `plots[]` entries, and, as optional selection context, the year, Tension, Epoch flags, Rank and a difficulty scaling hint, all built only from Campaign View data.
2. WHERE plot-library is installed THEN the Sim SHALL select Plots by calling plot-library's `select(SelectionInput)` with the Player History's `templateHistory` and selection context, and otherwise SHALL select a Plot template uniformly from those whose ids are not in `templateHistory`, falling back to all templates when every template has been used.
3. THE Campaign Engine SHALL read City Packs through the City Pack interface (city id, display name, availability years, languages, the city's services as references to content-expansion Service Definition ids, allowed Cover Identities, District and Location content), and SHALL reference services only by Service Definition id.
4. THE Campaign Engine SHALL read Epochs through the Era Pack interface, and the core pack SHALL ship one Era Pack covering 1948–1962.
5. THE Campaign Engine SHALL pass the year, Tension and active Epoch flags to the Posting through the Posting Context so that ambient-world can read them.
6. THE Campaign Engine SHALL read Outcome Records of schema 2 (plot-library), SHALL accept schema 1 by normalising it to schema 2 with one Primary `plots[]` entry built from the Posting's Plot template, and SHALL ignore the optional multi-city `region` block.

### Requirement 22: Campaign Content

**User Story:** As the developer, I want backgrounds, traits, arcs and HQ content defined as data, so that the career can grow without code changes.

#### Acceptance Criteria

1. THE Content Set SHALL define these campaign content kinds: backgrounds, the Rank table, Skill and Trait definitions with their modifier mappings, Factions, HQ cast templates, Requisitions, Exfiltration benefits, Campaign Arc templates, Epochs, Review Board weights and campaign text templates.
2. WHEN campaign content is loaded THEN the loader SHALL validate it with the slice's loader rules (slice Req 31.2–31.4), including cross-references from arcs to archetypes, predicates and Trait ids.
3. THE core pack SHALL ship at least three backgrounds, the Nemesis arc, the Mole Hunt arc, one Era Pack and the Rank table.
4. THE campaign content kinds SHALL be registered through content-expansion's Content Kind Registry (`LoadOptions.kinds`) with Field Declarations.

### Requirement 23: Campaign Save, Load and Migration

**User Story:** As a player, I want my career saved safely and still loadable after updates, so that years of play are never lost.

#### Acceptance Criteria

1. THE Campaign Engine SHALL save Campaign state, Campaign Truth, the campaign PRNG state, the Archive, the Campaign Choice Log and any in-progress Posting snapshot (slice Req 17.1) as one versioned Campaign Save.
2. WHEN a Campaign Save is loaded THEN the Campaign Engine SHALL restore an identical Campaign state.
3. WHEN a Campaign Save has an older schema version THEN the Campaign Engine SHALL apply each Migration in order up to the current version and validate the result.
4. IF a Campaign Save has a newer schema version than supported, or a Migration fails validation, THEN the Campaign Engine SHALL refuse to load it, report the reason, and leave the current game unchanged.
5. WHEN a Campaign Save's in-progress Posting has a Content Manifest that differs from the loaded one THEN the Campaign Engine SHALL refuse to resume that Posting and name the differing packs (slice Req 31.6).
6. WHEN the player adopts a new Content Manifest during an HQ Phase THEN the Campaign Engine SHALL record it in the Campaign Choice Log and use it for later Postings only.
7. THE Campaign Engine SHALL write the Campaign Save atomically, so that an interrupted write leaves the previous save intact.

### Requirement 24: Campaign Configuration

**User Story:** As the developer, I want campaign tuning in a validated config file, so that balance changes need no code.

#### Acceptance Criteria

1. WHEN a Campaign starts or loads THEN the Campaign Engine SHALL read `config/campaign.yaml` and validate it against a schema covering the Campaign Save path, Review Board thresholds, carry clamps, Notoriety decay, Stress amounts and the archive reveal mode.
2. IF `config/campaign.yaml` fails validation THEN the Campaign Engine SHALL refuse to start and report each error with its file and field path (slice Req 41.2).
3. THE spec SHALL ship a default `config/campaign.yaml` that passes validation.
