# Requirements Document

## Introduction

This spec lifts the game's fixed 1945–1965 setting so that it can be set in **America in 2020**, including a Region that spans several cities around the world in that year through `multi-city`. Changing the year is the easy part. The hard part is that several mechanics quietly assume a Cold War world, and a modern setting changes how spies communicate, are tracked and are identified.

What the current specs and code show:

- **The era limit is mostly data, not code.** Era Packs already declare a Period Window and Year Ranges filter content (content-expansion Req 5, 9). In code the only hard-coded date found is the Core City default start of 1 January 1950. The limit is otherwise in how specs are written ("early Cold War"), in the era-specific content, and in mechanics that assume it.
- **Communications are a closed set.** Channels are radio, numbers broadcast, courier and dead drop (Slice Req 25); the Cipher Engine supports Caesar, Vigenère, columnar transposition, book cipher and one-time pad (Slice Req 9.2); the Station talks by Cable; the player breaks traffic on a Workbench. Modern strong encryption is not breakable by hand, so the Intercept and Workbench loop cannot simply be re-skinned.
- **Surveillance is physical.** Watchers sit at places. Modern tracking is mostly data: phone location, cameras, plate readers, payment records and online footprints.
- **Cover is paper.** A Cover Identity and Papers hold up under a border officer. In 2020 a legend that has no online history or fails a biometric check is a legend that fails.
- **Prompts name the era.** For example the Intent Classifier's system prompt begins "a Cold War spy game".
- **Time is coarse.** Every action costs one or more phases (Slice Req 3.1), which does not fit instant messaging.

The approach is an **Era Profile**: a data-declared set of **Capabilities** and terminology that selects which mechanics are active. The existing 1945–1965 setting becomes the **Cold War Profile** and must behave exactly as it does today. A **Contemporary Profile** adds the 2020 mechanics. Mechanics check for a Capability, never for a year.

All slice invariants hold unchanged:

- The deterministic Sim owns all ground truth (Slice Req 2), including every Digital Trace and who can see it.
- Model outputs never create, change or reveal facts (Slice Req 2.3, 5, 20.6).
- Generation and replay are deterministic (Slice Req 1.2, 17.4), and the Cold War Profile reproduces existing results exactly.
- Every Plot Stage stays solvable through two independent paths (Slice Req 1.4) with only the Capabilities the loaded profile has.
- All characters, organisations, brands and platforms are fictional. Real places are allowed. No real person, living or dead, appears.

Proposed implementation order: after content-expansion tasks 1–2 and before multi-city's content for 2020. The code seams this spec adds (Capabilities, Channel kinds, Era-profiled terminology) should land before multi-city and street-ops are built, so that they do not have to be retrofitted.

Out of scope: a full set of American or world city packs and a full 2020 content library (this spec ships one reference Era Pack and one minimal City Pack to prove the mechanics, and the rest is authored under content-expansion's process), mixed-era Regions (all cities in one game share one Game Year), real events, real organisations and real brands.

## Glossary

Terms not listed here are defined in the slice glossary or in content-expansion.

- **Era Profile**: A data record, declared by an Era Pack, naming the Capabilities that are active, the default Start Date range, the terminology map, the prompt frame and the content-rule set for a setting.
- **Cold War Profile**: The Era Profile that reproduces the current game exactly.
- **Contemporary Profile**: The Era Profile for the modern setting, with the Capabilities of 2020.
- **Capability**: A named, closed-set feature of an era (for example `radio-intercept`, `secure-messaging`, `mobile-phone`, `cctv`, `alpr`, `biometric-borders`, `payment-trace`). Code defines the set. Era Profiles activate members of it.
- **Capability Requirement**: A declaration on a content item or an action that it needs a Capability.
- **Station Link**: The player's channel to the Station. A Cable in the Cold War Profile and a secure link in the Contemporary Profile.
- **Channel Kind**: A type of communications path, with latency, interceptability, traceability and a content-opacity flag.
- **Digital Trace**: A record that an action leaves in a Trace Source.
- **Trace Source**: A system that records traces: mobile network, payment, camera, plate reader, border system, travel booking, online account.
- **Legal Authority**: The power a Service has to read a Trace Source, and the Retention Window it may read back.
- **Retention Window**: How long a Trace Source keeps a trace, in days.
- **Trace Exposure**: The player's hidden accumulated risk from traces.
- **Operational Security Practice**: A player behaviour that reduces Digital Traces (paying cash, leaving the phone, a burner, a clean device) at a cost.
- **Backstop**: The digital history that supports a Cover Identity, with a level.
- **Instant Action**: An action that costs no phase, limited per phase by the Era Profile.
- **Terminology Map**: The Era Profile's player-facing names for action kinds and views.
- **Prompt Frame**: The Era Profile's static setting description used in model prompts.

## Requirements

### Requirement 1: Era Profiles

**User Story:** As the developer, I want the era to be a declared profile, so that a new setting is a new profile and pack set and not a change to engine code.

#### Acceptance Criteria

1. THE Content Loader SHALL accept an `eraProfile` field in an Era Pack's `pack.yaml` naming a profile id, and SHALL default it to the Cold War Profile when absent.
2. THE Era Pack's Period Window SHALL be bounded only by a configured sanity range, and no 1945–1965 constant SHALL remain in schemas or code.
3. THE core Start Date default (1 January 1950) SHALL become the Cold War Profile's default Start Date, and each Era Profile SHALL declare its own default Start Date range.
4. THE Cold War Profile SHALL reproduce, for every golden seed in the repository, an identical World State, identical action results and identical replay hashes to those produced before this spec.
5. WHEN more than one Era Pack is loaded THEN every City in the game SHALL resolve to the same Era Profile, and IF it does not THEN THE Content Loader SHALL refuse to start and name the cities.
6. THE Content Manifest SHALL include the Era Profile id, and a save made under a different Era Profile SHALL be refused (Slice Req 31.6).

### Requirement 2: Capabilities

**User Story:** As the developer, I want mechanics gated by what the era has, so that no mechanic is guarded by a year check that someone must remember to update.

#### Acceptance Criteria

1. THE engine SHALL define the Capability set in code as a closed enumeration, and the Era Profile SHALL activate a subset by name.
2. EVERY engine mechanism that depends on an era feature SHALL test for the Capability and SHALL NOT test a year.
3. THE Content Loader SHALL accept a Capability Requirement on any Channel, action kind, Surveillance Method, Travel Document kind, Location Type and technology catalogue item.
4. WHEN the loaded Era Profile lacks a required Capability THEN the Content Loader SHALL exclude that content item from the Content Set, and the Pack Linter SHALL report the exclusion.
5. IF a mandatory Required Query of the Tag Vocabulary would then have fewer Binders than its minimum THEN THE Content Loader SHALL refuse to start and report the shortfall (content-expansion Req 4.5).
6. THE Cold War Profile SHALL activate exactly the Capabilities that the slice and the earlier follow-on specs assume.

### Requirement 3: Communications

**User Story:** As a player, I want modern communication to behave like modern communication, so that a secure message is not a Cable with a new name.

#### Acceptance Criteria

1. THE Sim SHALL generalise Channel (Slice Req 25) to a Channel Kind with latency, interceptability, traceability and a content-opacity flag, and SHALL keep radio, numbers broadcast, courier and dead drop as Channel Kinds with their present parameters.
2. THE Contemporary Profile SHALL add Channel Kinds for secure messaging, phone call, email and digital dead drop.
3. THE Station Link SHALL be a Cable in the Cold War Profile, with the present delay and cost, and a secure link in the Contemporary Profile, with a short delay and a Trace Source entry.
4. THE Sim SHALL treat content of a strong-encryption Channel Kind as opaque: an Intercept of it SHALL yield metadata (parties, time, size, location) and SHALL NOT yield a plaintext for the Workbench.
5. THE Sim SHALL provide, instead, paths to content through endpoint compromise (a seized or cloned device), a human source, and operator error, each resolved deterministically and each leaving a Trace.
6. THE Cipher Engine and the Workbench SHALL be unchanged for the Cold War Profile, and SHALL be active in the Contemporary Profile only for Channel Kinds that are not opaque (for example a hand-enciphered paper note or an old-fashioned book code).
7. THE Plot generator SHALL give every Plot Stage two independent discovery paths that use only Capabilities of the loaded profile, and SHALL NOT make a stage depend on breaking opaque content.

### Requirement 4: Digital Traces

**User Story:** As a player, I want my phone, cards and face to matter, so that moving unseen in 2020 means managing data and not only watchers.

#### Acceptance Criteria

1. WHERE the Capability for a Trace Source is active THEN every relevant action (travel, purchase, call, message, entering a camera-covered Location, crossing a Border) SHALL leave a Digital Trace in that Source, with the actor, the Location, the time and the Retention Window.
2. THE Sim SHALL let a Service read a Trace Source only within its Legal Authority and Retention Window, as content defines for each Service Definition.
3. WHEN a Service reads a Trace Source THEN THE Sim SHALL update that Service's beliefs, Cover Suspicion and Watch List deterministically from the traces it read.
4. THE Sim SHALL let the player use Operational Security Practices, each with a cost in money, time or access, and each suppressing named Trace Sources.
5. THE Sim SHALL accumulate Trace Exposure as a hidden value, and THE Player View SHALL show only qualitative hints (for example "your phone has been with you all day") and SHALL NOT show Trace Exposure or what a Service has read.
6. THE debrief SHALL reveal which traces were read, by whom, and what they led to.
7. THE Trace mechanism SHALL be inactive, and add no randomness, under the Cold War Profile.

### Requirement 5: Identity, Cover and Papers

**User Story:** As a player, I want my cover to be tested the way it would be in 2020, so that a legend is a history and not just a passport.

#### Acceptance Criteria

1. THE Cover Identity SHALL gain a Backstop level, applying only where the Capability `internet-open-source` is active.
2. WHEN a Service runs an open-source check on a Cover Identity THEN THE Sim SHALL resolve it deterministically from the Backstop level, the Cover Identity's age and the Service's reach, and SHALL raise Cover Suspicion if the history is thin or contradicts the Papers.
3. THE Travel Document kinds of multi-city SHALL gain electronic variants (e-passport, electronic travel authorisation, electronic visa) through content, with Capability Requirements.
4. WHERE the Capability `biometric-borders` is active THEN every Border Check SHALL include a biometric match of the traveller against the identity on the Papers, and a mismatch SHALL return secondary inspection or detention.
5. WHERE the Capability is active THEN the Border Check SHALL also include a device inspection at the Controlling Service's strictness, which MAY expose messages and traces.
6. THE Cold War Profile's Border Check SHALL be unchanged.

### Requirement 6: Surveillance and Tracking

**User Story:** As a player, I want modern surveillance to be a pressure I can read and counter, so that being followed means more than a man in a grey coat.

#### Acceptance Criteria

1. THE Surveillance Method content kind (defined with `street-ops`) SHALL carry a Capability Requirement, so that physical, radio-car, GPS-tracker, plate-reader and camera methods each exist only in profiles that have them.
2. THE Location content SHALL gain a camera-coverage Tag where the Capability `cctv` is active, and the Sim SHALL leave a Digital Trace for a person entering a covered Location.
3. WHERE the Capability `alpr` is active THEN a Vehicle on a covered Segment SHALL leave a Digital Trace, and a Vehicle's registration on a Watch List SHALL raise an alert for the Controlling Service.
4. WHERE the Capability `geolocation-tracking` is active THEN the Sim SHALL let a Service place a tracker on a Vehicle or track a phone, resolved from Legal Authority and the player's Operational Security Practices.
5. THE player SHALL be able to find a tracker only through an explicit sweep action with a quoted cost, and SHALL never be told by the Player View that one is present.

### Requirement 7: Actions, Terminology and Time

**User Story:** As a player, I want the game to speak in the terms of the setting, so that a 2020 game says "message" and not "Cable".

#### Acceptance Criteria

1. THE Era Profile SHALL carry a Terminology Map from action kinds and view names to player-facing terms, and the clients SHALL render terms through it.
2. THE existing action kind ids SHALL remain, so that saves, logs and the Phrasebook of natural-language-commands are unaffected.
3. THE Era Profile MAY declare an allowance of Instant Actions per phase (for example a short message exchange), with default zero. For a profile that declares one, Slice Req 3.1 SHALL be amended so that an Instant Action costs no phase and counts against the allowance, and the Cold War Profile SHALL declare zero.
4. EVERY Instant Action SHALL still run through the Turn Pipeline and leave its Digital Trace.
5. THE Era Profile SHALL carry the Prompt Frame, and every static model prompt that names the setting (including the Intent Classifier, Narrator and `voice` prompts) SHALL take the setting description from the Prompt Frame instead of a fixed phrase.

### Requirement 8: Content Rules, Locale and Anachronism

**User Story:** As a content author, I want the checks that keep content on the right side of its era to follow the profile, so that a 2020 pack is linted as strictly as a 1950s one.

#### Acceptance Criteria

1. THE Anachronism Entries of content-expansion SHALL be grouped by Era Profile, and THE Pack Linter SHALL flag modern terms in Cold War content and period terms in Contemporary content.
2. THE Contemporary Profile SHALL provide a US Locale: date format, currency, honorifics, address format, local terms and Specifics Guard allowlist additions.
3. THE Real-Person Blocklist of the Contemporary Profile SHALL block by category: no real living or dead person SHALL be named, and the Pack Linter SHALL flag a name that matches a maintained list of public figures.
4. THE Contemporary Profile's content rules SHALL forbid real brands, real platforms, real parties and candidates, and real organisations as characters or institutions. Content SHALL use fictional equivalents.
5. THE Sensitivity Term List SHALL be extended for the contemporary setting.
6. THE Style Guide of the Contemporary Profile SHALL define Fact Line and Document templates for messages, email, call records and device extractions.

### Requirement 9: Reference Contemporary Content

**User Story:** As the developer, I want a playable proof that the generalisation works, so that the mechanics are tested end to end before content is authored at scale.

#### Acceptance Criteria

1. THE spec SHALL ship one Contemporary Era Pack (Period Window the year 2020) with the Contemporary Profile, technology catalogue, document styles, Locale and cipher conventions.
2. THE spec SHALL ship one minimal US City Pack that meets Tag Conformance, with fictional Service Definitions for a domestic counterintelligence service, a local police service and one foreign Hostile Service.
3. THE reference content SHALL generate worlds that pass discovery-path verification over the preset and seed corpus (Slice Req 1.4, 26.3, 29.6).
4. THE reference content SHALL use no real person, brand or organisation, and SHALL pass the Pack Linter's release profile.
5. WHERE content-expansion's quantity targets would require a full library THEN THE release profile SHALL accept the reference pack's declared lower targets for a Contemporary proof pack, and SHALL name them.

### Requirement 10: Multi-City Integration

**User Story:** As a player, I want to travel between several cities around the world in 2020, so that a global posting works with modern borders and records.

#### Acceptance Criteria

1. WHEN a Region Template names the Contemporary Profile THEN THE Region Generator SHALL give every City the same Game Year and SHALL use only Content Set entries valid for it (multi-city Req 1.5).
2. THE multi-city Travel Mode `air` SHALL be usable with modern airports, booking records and electronic Travel Documents, with the Digital Traces of Requirement 4.
3. THE multi-city Border Check SHALL apply Requirement 5 where the Capabilities are active.
4. THE multi-city Cable and Courier Line mechanics SHALL use the Station Link and Channel Kinds of Requirement 3.
5. THE Sector Line concept SHALL remain available in the Contemporary Profile but SHALL NOT be required by it.
6. THE Region Generator SHALL keep the multi-city limits (2–4 Cities, 22 Principal NPCs per City) unchanged.

### Requirement 11: Compatibility and Migration

**User Story:** As the developer, I want existing content and saves to keep working, so that the generalisation does not strand earlier work.

#### Acceptance Criteria

1. THE Content Loader SHALL treat every existing pack, with no `eraProfile`, as the Cold War Profile.
2. THE existing `contentSchema` 1 and 2 packs SHALL load without modification.
3. THE saves made before this spec SHALL load under the Cold War Profile, and the Content Manifest check SHALL behave as today.
4. THE schema changes of this spec (Capability Requirement, Channel Kind, Backstop, camera-coverage Tag) SHALL be optional fields with Cold War defaults.

### Requirement 12: Determinism, Isolation and Performance

**User Story:** As the developer, I want the new mechanics bound by the project's guarantees, so that a modern setting is as testable as the old one.

#### Acceptance Criteria

1. THE Digital Trace mechanism SHALL draw randomness only from its own PRNG stream family, derived from the seed, so that enabling it cannot perturb any existing stream.
2. THE Truth Store SHALL hold every Digital Trace, Trace Exposure and Backstop truth, and the isolation tests (Slice Req 2) SHALL include them.
3. THE Player View projection of each new mechanic SHALL be truth-safe, and the Leak Guard and Specifics Guard SHALL apply unchanged.
4. THE added per-turn work (trace writes and reads) SHALL stay within the slice's per-turn budget on the Reference Machine.

### Requirement 13: Tests

**User Story:** As the developer, I want properties that prove the generalisation, so that I can trust both settings.

#### Acceptance Criteria

1. THE test suite SHALL verify that under the Cold War Profile every golden replay and determinism property is unchanged.
2. THE test suite SHALL verify capability gating: no content item or mechanic whose Capability is inactive is reachable in a generated world.
3. THE test suite SHALL verify that no loaded Cold War item matches a Contemporary Anachronism Entry and the reverse, over the shipped packs.
4. THE test suite SHALL verify discovery-path verification over the Contemporary reference content.
5. THE test suite SHALL verify that a strong-encryption Intercept yields metadata only and that no Plot Stage requires an opaque plaintext.
6. THE test suite SHALL verify that the Player View of a Contemporary game contains no Trace Source truth.
