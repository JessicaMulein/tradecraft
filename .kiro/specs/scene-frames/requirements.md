# Requirements Document

## Introduction

The web shell already has a Still-Frame Hook (web-shell Req 11). A `SceneFrameProvider` interface, a Frame Request builder, a Frame Key, a disk cache, a Frame Batch at new game and an access-controlled frame route are in `packages/web/src/lib/frames` and `packages/web/src/lib/api/routes.ts`. The default provider renders nothing, so no game has ever shown a picture. The page script does not yet display frames. Web-shell Req 11.10 left the model budget for an image model to "a later spec". This is that spec.

A review of the hook for this spec found three defects that would put wrong or unsafe data in front of an image model:

- `buildFrameRequest` copies each visible person's `label` into `descriptor`. For an identified person the label is their persona name, so names reach the model and the cache key, and the person's appearance never does.
- `buildBatchRequest` sends an empty description and no atmosphere for every Location, so a batch frame and a live frame of the same scene are built from different inputs and get different keys.
- The default art direction is the fixed string `1950s Vienna, black-and-white film still, grainy, wide shot`. It is wrong for every City Pack and every year but one.

The owner's goal is a game that looks as alive as it reads, with no mistakes. In practice that means pictures of the places, people and events the player meets that are true to the period, and true to what the player knows, and never wrong about the story. They must not slow the game.

The approach rests on one rule, the same one the living-world spec uses for text: **a picture may show only what the player's text already says.** Five consequences follow.

1. **Requests come from the Player View only.** The Frame Request builder moves into `player-view`, which cannot read truth. A request carries public descriptions, bands and tags. It carries no names, no entity ids and nothing the player typed.
2. **Prompts are composed, not written.** A deterministic Prompt_Composer turns a request into a prompt using reviewed phrase tables from the content packs (Visual_Style). No language model writes an image prompt at runtime.
3. **Every picture is checked before it is shown.** Each picture is re-encoded and checked mechanically. Then a vision-capable model already resident for the game inspects it against a fixed checklist. A picture that fails is never shown, and the scene simply has no picture.
4. **Most pictures are made ahead of time.** The offline Darkroom renders whole cities in advance. Candidates are checked the same way, and the owner reviews them on contact sheets and signs off before they become a Frame_Pack. Live rendering is optional, runs only in idle time inside a measured memory budget, and never delays a turn.
5. **Pictures are inert.** They are not facts, not Claims, not part of the determinism contract, the Content Manifest or the save (web-shell Req 11.8). No gameplay decision depends on them.

### Criteria this spec amends

The spec conventions require meaning changes to be stated here:

- **Web-shell Req 11.1** is extended. The Frame Kind set becomes `scene`, `title`, `portrait`, `press` and `moment`, and the provider interface gains optional capabilities (Requirement 6).
- **Web-shell Req 11.3** is amended. The Frame Request is built in `player-view` (Requirement 2). A `scene` request carries no individual people, only the crowd band. A `portrait` request carries exactly one subject, described by the person's public physical descriptor and identified only by a Subject_Anchor, never by a name or an entity id. The request also carries the season, the public weather tags and the public district tags. The rest of 11.3 still holds: Player View data only, no Truth-branded value, nothing about a person the player cannot see.
- **Web-shell Req 11.9 and the Frame Key glossary entry** are extended. The art direction comes from the Visual_Style of the loaded era and City Packs, with configuration overrides. The cache key covers the whole canonical request, the Frame_Variant, the Prompt_Composer version and the Render_Profile, so a change to any of them re-renders.
- **Web-shell Req 11.10 is decided** by Requirement 9 below.
- **Web-shell Req 11.2, 11.4, 11.5, 11.6, 11.7 and 11.8 are unchanged.**
- **Slice Req 14.5 is unchanged for language models.** The default profiles still keep at most two language models resident. An image model is governed by Requirement 9. It is never resident unless the owner turns on Live_Frames and the Frame_Budget check passes.

### Invariants that still hold

The engine owns all ground truth, and truth never crosses into Player View projections (Slice Req 2). `generatorVersion` stays `0.7.0`, and existing golden replays stay byte-identical. Frames draw nothing from any engine PRNG stream, so the stream registry is unchanged. With `frames.mode` absent or `off`, the game behaves exactly as it does without this spec. The terminal shell shows no pictures. All people and organisations are fictional (content-expansion Req 3).

### Order and dependencies

This spec builds on web-shell (the hook, the frame route, the cache directory, the page) and content-expansion (the Content Kind Registry, the Era Pack, City Packs, the Anachronism Entries, the Real-Person Blocklist, the Sensitivity Terms and the Provenance gate). It does not need living-world, plot-library, ambient-world or multi-city. When ambient-world is on, Press_Photos can illustrate its Stories. When living-world is on, Requirement 18 applies. In a multi-city region, frames follow the Current City's Visual_Style.

### Out of scope

The following are out of scope:

- pictures in the terminal shell;
- video, animation and sound;
- cloud image services (every provider runs on the local machine);
- training or fine-tuning image models, including LoRAs trained on real people;
- pictures that depict an outcome, an arrest, an injury or a death;
- pictures of documents, Intercepts or cipher material;
- portraits of people the player has not seen and has no description of;
- changing calibration bands;
- enabling any part of this spec in the shipped `config/scenario.yaml` or turning frames on in the shipped `config/frames.yaml`.

## Glossary

Terms from the slice (`tradecraft`), content-expansion, web-shell and living-world keep their meanings. Web-shell defines Frame Hook, Frame Request, Frame Batch and Frame Key. Living-world defines Texture_Ledger. New terms:

- **Frames_Mode**: The scene-frames setting: `off`, `packs` (show only Frame_Pack pictures) or `live` (also render new pictures on this machine).
- **Frame_Kind**: One of `scene`, `title`, `portrait`, `press` or `moment`.
- **Frame_Subject**: The one person a `portrait` request shows, given as a public physical descriptor and a Subject_Anchor.
- **Subject_Anchor**: An opaque value that stands for one person *as the player knows them*. It is derived only from the handle the player holds for that person, so two handles the player has not linked never share an anchor.
- **Visual_Style**: Pack content that says how pictures of an era and city should look. It holds the art direction, the negative terms and the phrase tables for Location Types, atmosphere tags, weather tags, phases, seasons and districts.
- **Depiction_Rules**: The closed, per-kind rules for what a picture may and may not show (Requirement 3).
- **Prompt_Composer**: The deterministic function that turns a Frame Request and a Visual_Style into a Frame_Prompt.
- **Frame_Prompt**: The positive prompt, the negative prompt and the size, seed and step settings sent to an Image_Provider.
- **Image_Provider**: A `SceneFrameProvider` implementation that talks to a local image program, such as Draw Things, ComfyUI, Ollama or mflux.
- **Render_Profile**: The provider, model identity, size, steps and sampler settings that together decide how a Frame_Prompt becomes pixels.
- **Sanitiser**: The step that decodes a provider's output, checks it and re-encodes it as a clean image with no metadata.
- **Mechanical_Checks**: The Sanitiser's measurable checks, such as size, blankness and monochrome conformance (Requirement 7).
- **Inspector**: The `inspector` model role. A vision-capable model checks a picture against the Inspection_Checklist.
- **Inspection_Checklist**: The fixed, per-kind list of questions the Inspector answers about a picture, as structured output.
- **Frame_Budget**: The memory an image model may use, measured on this machine, compared against what is free after the language models are resident.
- **Idle_Window**: A period when no language-model call for the player is running or queued.
- **Setup_Window**: The period during new-game setup while the title Cue plays (web-shell Req 11.5).
- **Frame_Resolution**: The ordered search that finds the picture for a request: Shown_Frame, cache, Frame_Pack, live render, or none.
- **Shown_Frame**: A picture the player has been shown for a request key in a game. It stays that key's picture for the rest of the game.
- **Frame_Variant**: Which of several alternative pictures of the same request a game uses, chosen from the game's seed and the request.
- **Frame_Cache**: The on-disk store of sanitised pictures, outside the save and the World State.
- **Frame_Pack**: A reviewed, signed-off set of pictures with a manifest, made by the Darkroom.
- **Frame_Provenance**: The record each pack picture carries: model, model licence, provider, Render_Profile, prompt hash, seed, generation time, Inspector verdict and the reviewer's sign-off.
- **Model_Licence_Registry**: The committed list of image models with their licence and whether pictures they make may ship in a Frame_Pack.
- **Darkroom**: The offline tool that renders, checks and presents pictures for owner review, and promotes approved ones into Frame_Packs.
- **Contact_Sheet**: A local HTML page that shows Darkroom candidates side by side for review.
- **Base_Plate**: The reference picture of a place, used to derive its other times of day and weather by image editing, so the place stays the same place.
- **Derived_Variant**: A picture made from a Base_Plate by image editing.
- **Frame_Notes**: Short, reviewed, plain-text notes describing what a pack picture shows, written in the Darkroom.
- **Press_Photo**: A `press` frame illustrating a published newspaper story about a public event.
- **Moment**: A `moment` frame, a still life that marks an action the player has just taken, built from a Moment_Motif.
- **Moment_Motif**: Pack content that names the objects and setting a Moment shows for one action kind, such as a loose stone in an old wall for servicing a dead drop.
- **Frame_Report**: A player's "hide this picture" report, which blocks that picture on this machine.
- **Frame_Release_Gate**: The measured criteria a Frame_Kind must meet before `config/frames.yaml` may list it as enabled.

## Requirements

### Requirement 1: Frames Mode and Configuration

**User Story:** As the owner, I want pictures to be fully off unless I turn them on, and to choose packs-only or live per machine, so that the shipped game is unchanged and I control what my machine does.

#### Acceptance Criteria

1. THE game SHALL read frame settings from `config/frames.yaml`. WHEN the file is absent or `frames.mode` is `off` THEN THE Shell Server SHALL use the null provider, build no Frame Requests and behave exactly as it does without this spec.
2. THE shipped `config/frames.yaml` SHALL set `mode: off`. Nothing in this spec SHALL change `config/scenario.yaml`.
3. THE configuration SHALL let each Frame_Kind be enabled separately. WHEN a kind is disabled THEN no request of that kind SHALL be built.
4. WHERE `frames.mode` is `packs` THE game SHALL show only Frame_Pack pictures and SHALL never start an Image_Provider.
5. WHERE `frames.mode` is `live` THE game SHALL also render missing pictures on this machine, subject to Requirement 9.
6. THE launcher SHALL validate `config/frames.yaml` and SHALL report every problem as `<file>: <path>: <message>` before the game starts. An Image_Provider URL that is not on the loopback interface SHALL be rejected.
7. THE Page SHALL offer a "Pictures" setting with the choices off, packs only and live. The player SHALL be able to lower the setting below the configured mode, but not raise it above it. Changing it SHALL take effect from the next scene without a restart.
8. THE frame settings SHALL NOT be part of the save, the Content Manifest or the determinism contract.

### Requirement 2: Frame Requests From the Player View Only

**User Story:** As a player, I want pictures to show only what I already know, so that a picture never gives away a secret or contradicts my notes.

#### Acceptance Criteria

1. THE Frame Request builder SHALL live in `player-view` and SHALL read only Player View data. It SHALL be a pure function of the Player View, the Frame_Kind and the Visual_Style selection.
2. A Frame Request SHALL contain no Truth-branded value, no entity id, no persona name, no alias, no Claim content, no Cable or Dossier text, and no text the player typed.
3. A `scene` request SHALL contain: the Location's public name, Location Type, public description and atmosphere tags; the public district tags; the phase; the season; the public weather tags; the crowd band; and the Visual_Style selection. It SHALL contain no individual people.
4. A `portrait` request SHALL contain exactly one Frame_Subject: the person's public physical descriptor and a Subject_Anchor. It SHALL be built only for a person who is visible in the player's current scene or listed in the People view.
5. THE Subject_Anchor SHALL be derived only from the handle the player holds for the person (an `unk:` id or a known `npc:` id). WHEN the player holds two handles they have not linked THEN their anchors SHALL differ. WHEN an unidentified person has no `unk:` id yet THEN no portrait request SHALL be built for them.
6. A Frame Batch request for a Location SHALL be built from the same fields as a live request for that Location at the same phase, weather and crowd. Both SHALL have the same Frame Key.
7. THE Visual_Style selection SHALL follow the Current City and the Game Year as the Player View shows them. It SHALL NOT be a fixed city or year.
8. THE builder SHALL take a person's descriptor only from the view-safe field the scene panel already shows for an unidentified person. It SHALL never take a person's appearance from a Dossier, a Cable or a Claim.
9. Building the same request twice from the same Player View SHALL yield the same request and the same Frame Key.

### Requirement 3: Depiction Rules

**User Story:** As the owner, I want a fixed list of what each kind of picture may show, so that no picture shows something false, cruel, anachronistic or unfair.

#### Acceptance Criteria

1. Each Frame_Kind SHALL have Depiction_Rules that name what it may show and what it must not show. The rules SHALL be data, versioned with the Prompt_Composer.
2. A picture SHALL NOT show anything that the request's text fields do not support. In particular it SHALL NOT show a specific person in a `scene`, `press` or `moment` frame, a recognisable face in a `scene` frame, or an event outcome.
3. No picture SHALL show legible writing, except in a Frame_Pack picture whose writing the owner approved in review.
4. No picture SHALL show violence, injury, a dead body, nudity, a weapon pointed at anyone, or a national flag, emblem or insignia in legible detail.
5. No picture SHALL be a likeness of a real person. No Frame_Prompt SHALL contain a name from the Real-Person Blocklist or any persona name the Player View holds.
6. Every picture SHALL be consistent with the era and city Visual_Style. It SHALL show no object, vehicle, building, clothing or technology from after the Game Year.
7. A `portrait` SHALL show one person, head and shoulders, as a candid long-lens surveillance photograph.
8. A `moment` SHALL be a still life of objects and setting. It SHALL show no face and at most part of a hand or a figure from behind.

### Requirement 4: Visual Style Content

**User Story:** As the owner, I want the look of each era and city to be reviewed content in the packs, so that period accuracy is checked like any other content and new cities bring their own look.

#### Acceptance Criteria

1. THE content packs SHALL gain a `visual-style` content kind, registered through the Content Kind Registry with Field Declarations.
2. A Visual_Style SHALL hold: the art direction, the negative terms, and phrase tables keyed by Location Type, atmosphere tag, weather tag, phase, season and district tag. It SHALL also hold portrait framing phrases and the image sizes for each Frame_Kind.
3. THE Era Pack SHALL supply the era Visual_Style. Each City Pack MAY supply a city Visual_Style that refines it. The core pack SHALL supply a fallback Visual_Style that is complete on its own.
4. THE content lint SHALL apply the Anachronism Entries, the Real-Person Blocklist and the Sensitivity Terms to every Visual_Style phrase. Those rules SHALL NOT be suppressible for this kind.
5. THE content lint SHALL report any Location Type, atmosphere tag, weather tag or district tag in the loaded packs that has no phrase in the effective Visual_Style.
6. A model-drafted Visual_Style SHALL carry a Provenance Record and SHALL load only after review, as for other kinds (content-expansion Req 16).
7. THE configuration MAY override the art direction for one machine. The override SHALL be part of the Frame Key.

### Requirement 5: Prompt Composer

**User Story:** As the developer, I want image prompts built by a deterministic function from reviewed phrases, so that every prompt is reproducible, testable and free of invented details.

#### Acceptance Criteria

1. THE Prompt_Composer SHALL be a pure function from a Frame Request, a Visual_Style and a Render_Profile to a Frame_Prompt. It SHALL make no model call.
2. Every phrase in a Frame_Prompt SHALL come from the Visual_Style, the request's public text fields or the kind's Depiction_Rules.
3. THE negative prompt SHALL include the Visual_Style's negative terms and the kind's forbidden content (Requirement 3).
4. THE Prompt_Composer SHALL fit the prompt to the Render_Profile's token limit by dropping lower-priority phrases in a fixed order. It SHALL never cut a phrase in the middle.
5. THE seed SHALL be derived from the Frame Key, the Frame_Variant and the attempt number. Frames SHALL draw nothing from any engine PRNG stream.
6. Before a Frame_Prompt is sent, THE Prompt_Composer SHALL check that it contains no blocked term (criterion 3.5) and no Sensitivity Term. A prompt that fails SHALL NOT be sent.
7. THE Prompt_Composer SHALL have a version. The version SHALL be part of the cache key.

### Requirement 6: Image Providers

**User Story:** As the owner, I want to use whichever local image program runs best on my Mac, so that I am not tied to one tool and can change models without code changes.

#### Acceptance Criteria

1. THE `frames` package SHALL provide Image_Providers for Draw Things (its HTTP API), ComfyUI (its HTTP API and a checked-in workflow template), Ollama (its image generation API) and mflux (its command-line tool).
2. Each Image_Provider SHALL declare its capabilities: text-to-image, image editing from a reference picture, interruption of a running job, release of its model's memory, and whether it reports the model it is using.
3. An Image_Provider SHALL connect only to the loopback interface. It SHALL send nothing but the Frame_Prompt and, for editing, a sanitised reference picture.
4. An Image_Provider SHALL run at most one job at a time and SHALL honour an abort signal. WHEN aborted THEN it SHALL interrupt the job if it can, and otherwise discard the result.
5. Every provider call SHALL have a timeout from configuration. A timeout, refusal, malformed response or missing program SHALL be reported as a typed error and SHALL never throw past the frame service.
6. WHEN the game starts in `live` mode THEN THE launcher SHALL probe the configured provider once and SHALL report a missing program, a wrong port or an unreported model as a clear setup message. Play SHALL continue in `packs` mode.
7. Each Image_Provider SHALL pass the same contract test suite against a fake server, and against recorded responses captured on the Reference Machine.

### Requirement 7: Sanitiser and Mechanical Checks

**User Story:** As the developer, I want every picture decoded, checked and re-encoded before it is stored or shown, so that a provider's output can never carry anything but pixels.

#### Acceptance Criteria

1. THE Sanitiser SHALL decode every provider output with a pixel limit, SHALL re-encode it at the kind's size in one configured format, and SHALL strip all metadata.
2. THE Sanitiser SHALL reject an output that does not decode, whose dimensions or aspect ratio differ from the Render_Profile's beyond a tolerance, or whose decoded size exceeds the limit.
3. THE Mechanical_Checks SHALL reject a picture that is near-uniform, nearly all black or all white for its phase, or (when the Visual_Style is monochrome) carries colour above a threshold.
4. THE Mechanical_Checks SHALL reject a picture that is a near-duplicate, by perceptual hash, of a picture already accepted for a different request key in the same Frame_Pack or cache.
5. Only sanitised pictures SHALL be cached, packed or served. The served media type SHALL match the encoded format, with `nosniff` set.
6. THE Sanitiser and the Mechanical_Checks SHALL be pure functions of the input bytes and the Render_Profile.

### Requirement 8: Inspector

**User Story:** As the owner, I want a vision model to look at every picture before a player sees it, so that wrong, anachronistic or unsafe pictures are caught by more than a pixel count.

#### Acceptance Criteria

1. THE model configuration SHALL gain an optional `inspector` role. WHEN it is absent THEN it SHALL default to the profile's `judge` model if LM Studio reports that model accepts images, and otherwise to no Inspector.
2. THE Inspector SHALL answer the kind's Inspection_Checklist as schema-constrained output. The checklist SHALL cover at least: legible writing, faces and how prominent they are, number of people, violence, nudity, weapons, flags or insignia, anachronisms, time of day, weather, place type, and technical quality.
3. A picture SHALL pass only if no hard check fails and its quality score meets the kind's threshold. The thresholds SHALL come from configuration.
4. WHEN a picture fails THEN THE frame service SHALL try again with the next seed, up to a configured number of attempts, and SHALL then give up for that request in this session.
5. WHERE `frames.quality` is `strict` (the default) THEN no live picture SHALL be shown without an Inspector pass. WHERE it is `standard` THEN a live picture that passes the Mechanical_Checks MAY be shown without an Inspector, and the Page SHALL mark it as unchecked.
6. Inspector calls SHALL run in the language-model gateway's background band and SHALL never delay a call for the player (Requirement 9).
7. THE Inspector SHALL receive only the picture, the kind and the checklist. It SHALL NOT receive the Frame_Prompt, so it cannot be steered by it.

### Requirement 9: Memory Budget and Scheduling

**User Story:** As the owner, I want live pictures only when my machine has room, made only while I am reading, so that the game never stutters, swaps or waits for a picture.

#### Acceptance Criteria

1. THE `frames doctor` command SHALL measure the configured image model's peak memory on this machine with one test render, and SHALL write the figure to the machine's frame settings.
2. WHEN the game starts in `live` mode THEN THE Frame_Budget check SHALL compare the measured peak plus a configured headroom with the memory available after the language-model profile is resident. WHEN it does not fit, or no measurement exists, THEN live rendering SHALL be off for the session and THE Page SHALL say why in its settings panel.
3. A live render SHALL start only in an Idle_Window or the Setup_Window. WHEN a call for the player is submitted during a render THEN the render SHALL be interrupted if the provider can, and otherwise the next render SHALL wait until the current one ends.
4. THE frame service SHALL run at most one render at a time, and SHALL order its queue: the scene the player is in, then the Locations the player can travel to next, then everything else.
5. WHERE the provider can release memory AND the configuration says so THEN THE frame service SHALL release the model after the Frame Batch, and SHALL load it again only when it has a job.
6. THE frame service SHALL stop live rendering for the session if the operating system reports memory pressure or swapping, and SHALL resume only after a restart.
7. No frame work SHALL ever delay, fail or change a turn (web-shell Req 11.7).

### Requirement 10: Frame Resolution, Fallback and Consistency

**User Story:** As a player, I want the same place to look the same within a game and different across games, and I want a missing picture to leave no hole, so that pictures add to the game and never get in the way.

#### Acceptance Criteria

1. Frame_Resolution SHALL try, in order: the Shown_Frame for the request key in this game; the Frame_Cache; an exact Frame_Pack match; a Frame_Pack match by the pack's fallback rules; a live render if allowed; and otherwise no picture.
2. WHEN no picture is found THEN THE Page SHALL show the scene with no broken image and no reserved space (web-shell Req 11.2).
3. THE Page SHALL show the scene text first and SHALL add the picture when it arrives (web-shell Req 11.4). WHEN the picture arrives after the player has left that scene THEN it SHALL be cached and not shown.
4. THE Frame_Variant SHALL be derived from the game's seed (which the Player View already shows) and the request, choosing among `frames.variantsPerScene` alternatives. Two games with different seeds SHALL usually see different variants, and one game SHALL always see the same one.
5. Once a picture is shown for a request key in a game, THE frame service SHALL show the same picture for that key for the rest of the game, including after a reload. The record of Shown_Frames SHALL be kept with the Frame_Cache, outside the save.
6. Frame_Resolution SHALL be a deterministic function of the request, the Frame_Variant, the installed Frame_Packs, the Frame_Cache and the Frame_Reports.

### Requirement 11: Frame Cache

**User Story:** As the owner, I want a cache that is safe, bounded and easy to clear, so that pictures load instantly without filling my disk or touching my saves.

#### Acceptance Criteria

1. THE Frame_Cache SHALL key each picture by the Frame Key, the Frame_Variant, the Prompt_Composer version and the Render_Profile identity.
2. Each cache entry SHALL record the sha256 of its bytes. An entry whose bytes do not match SHALL be discarded and treated as missing.
3. THE Frame_Cache SHALL stay under `frames.cache.maxBytes`, evicting the least recently shown entries first. It SHALL never evict a Shown_Frame of a game saved in the last 30 days.
4. THE Frame_Cache SHALL live outside the save, the World State and the repository's tracked files. Deleting it SHALL lose nothing but pictures.
5. Cache writes SHALL be atomic, so that a crash never leaves a partial picture under a valid key.

### Requirement 12: Frame Packs

**User Story:** As the owner, I want to ship reviewed pictures for whole cities, so that most players never need an image model at all.

#### Acceptance Criteria

1. A Frame_Pack SHALL have a manifest that lists, for each picture, its request match (Frame_Kind, Location or Location Type, phase, weather tags, season, crowd band and variant), its file, its sha256, its Frame_Provenance and its Frame_Notes.
2. THE Frame_Pack loader SHALL refuse any picture whose sha256 does not match, whose Frame_Provenance lacks `reviewedBy` and `reviewedAt`, or whose model the Model_Licence_Registry does not mark as shippable.
3. THE Model_Licence_Registry SHALL be committed, SHALL name each model's licence, and SHALL mark a model shippable only if its licence permits redistributing its outputs in a commercial game.
4. A Frame_Pack SHALL declare which era and City Packs it was made for. WHEN those packs are not loaded THEN it SHALL not match.
5. THE Frame_Pack fallback rules SHALL be declared in the manifest and SHALL only widen the match from a Location to its Location Type in the same city, and from a weather to a listed similar weather. They SHALL never cross cities or eras.
6. Frame_Packs SHALL NOT be part of the Content Manifest or the determinism contract. Their image files SHALL NOT be committed to the main repository history. How they are distributed is the owner's decision.

### Requirement 13: Darkroom

**User Story:** As the owner, I want an offline studio that renders a whole city, filters the bad pictures and shows me the rest to approve, so that I can make a Frame_Pack in an evening of review.

#### Acceptance Criteria

1. THE Darkroom SHALL enumerate every request a Frame_Pack needs for a set of era and City Packs, using the same builder and Prompt_Composer as the game.
2. THE Darkroom SHALL render a configured number of candidates per request with different seeds, and SHALL run the Sanitiser, the Mechanical_Checks and the Inspector on each.
3. THE Darkroom SHALL write candidates only to `frame-drafts/`, never into a Frame_Pack, with a Frame_Provenance that has no reviewer.
4. THE Darkroom SHALL produce a Contact_Sheet per city that groups candidates by request, shows the Inspector's verdict, and lets the owner choose a picture, reject all, and write or edit its Frame_Notes.
5. THE `frames promote` command SHALL copy only the owner's chosen pictures into a Frame_Pack, stamp `reviewedBy` and `reviewedAt`, and update the manifest.
6. THE Darkroom SHALL refuse to render for a Frame_Pack with a model that the Model_Licence_Registry does not mark shippable, or with a provider that does not report the model it is using.
7. THE Darkroom SHALL be resumable: an interrupted run SHALL continue from the last finished request.
8. THE Darkroom SHALL never run in the game process.

### Requirement 14: Scenes and Titles

**User Story:** As a player, I want to see where I am, at the right time of day and in the right weather, so that the city feels like a real place I am walking through.

#### Acceptance Criteria

1. A `scene` frame SHALL show the Location as a wide establishing photograph, with the crowd shown as anonymous figures at the crowd band's density.
2. WHERE the Render_Profile can edit THEN each Location SHALL have one Base_Plate per variant, and its other phases, seasons and weathers SHALL be Derived_Variants of that Base_Plate. WHERE it cannot THEN each is rendered from text with the same seed.
3. A `title` frame SHALL show the Current City at the game's start date. It SHALL be requested once per game in the Setup_Window and shown on the new-game briefing.
4. THE Frame Batch at new game SHALL request the title frame, the starting scene and the scenes of every Location the player knows, in the order of Requirement 9.4.
5. THE Inspector checklist for scenes SHALL check that no face is prominent, and that the time of day, the weather and the place type match the request.

### Requirement 15: Portraits

**User Story:** As a player, I want to put a face to the people I have watched, without the pictures telling me who is secretly who.

#### Acceptance Criteria

1. A portrait SHALL be built only from the public physical descriptor of a person the player has seen (criterion 2.4). THE portrait card SHALL show that descriptor as its caption, so the picture never says more than its text.
2. Each Subject_Anchor SHALL have at most one portrait per game. Later pictures of the same Subject_Anchor SHALL reuse it, or, where the Render_Profile can edit, be derived from it.
3. THE Subject_Anchor of a person SHALL be the first handle the player held for them: their `unk:` id if one was ever allocated, otherwise their known `npc:` id. WHEN the player identifies an `unk:` person THEN their portrait SHALL carry over unchanged and SHALL NOT be re-rendered.
4. A Dossier on a person SHALL show a portrait only after the player has identified that person as someone they have seen. Until then THE Page SHALL show "no photograph on file".
5. Portrait seeds and Frame_Variants SHALL be derived from the Subject_Anchor, so that two unlinked handles never get related seeds.
6. THE Inspector checklist for portraits SHALL check that the picture shows exactly one person and is consistent with the descriptor's stated sex, age band, build and clothing.

### Requirement 16: Press Photos and Moments

**User Story:** As a player, I want the morning paper to carry photographs, and my own quiet acts of tradecraft to leave an image, so that the city's news and my work feel tangible.

#### Acceptance Criteria

1. A `press` frame SHALL illustrate one published newspaper story about a public event (a City_Event or a Local_Incident when ambient-world is on, or a slice story). It SHALL be built only from the story's public fields: its event kind, Location, date, phase and weather.
2. A Press_Photo SHALL show the place and the public scene of the event. It SHALL show no identifiable person, no victim and no outcome that the story's text does not state.
3. THE Page SHALL caption a Press_Photo with the story's headline as already rendered. The caption SHALL never be model-written by this spec.
4. A `moment` frame SHALL be built from a Moment_Motif for the action kind the player just took, the Location, the phase and the weather. It SHALL be built only after the turn has committed, and only from the action kind, never from its outcome.
5. Moment_Motifs SHALL be pack content, registered through the Content Kind Registry and linted like Visual_Style phrases.
6. THE Page SHALL show a Moment beside the turn's Fact Lines. A Moment SHALL never replace a Fact Line.

### Requirement 17: Page Presentation and Player Controls

**User Story:** As a player, I want pictures that fit the page, respect my settings and can be hidden, so that they help and never annoy.

#### Acceptance Criteria

1. THE Page SHALL show a frame above the scene text and fade it in. WHERE the player prefers reduced motion THEN it SHALL appear without a fade.
2. Scene, title and moment frames SHALL be marked decorative (empty `alt`), because the text beside them describes the same thing. Portraits SHALL carry the label the player knows, and Press_Photos their caption, as `alt`.
3. THE Page SHALL offer "Hide this picture" on every frame. A Frame_Report SHALL block that picture on this machine and SHALL resolve the request again without it.
4. THE Page SHALL offer a credits panel listing the models and licences of every picture shown in this game.
5. Portraits SHALL appear in the People view and the Dossier view. Press_Photos SHALL appear in the newspaper view.
6. A frame SHALL never cover, shift or delay the action list or the input box.

### Requirement 18: Living-World Integration

**User Story:** As a player of the living world, I want the pictures and the prose to agree, so that the café the paper describes is the café I see.

#### Acceptance Criteria

1. WHERE living-world is on AND a Frame_Pack picture is the Shown_Frame for a Location THEN its Frame_Notes SHALL be offered to that Location's Fact_Sheets as Texture details, marked with source `frame`.
2. WHERE living-world is on AND no Frame_Pack picture exists for a Location THEN a live `scene` request MAY include up to 4 Texture_Ledger details already released for that Location, and those details SHALL be part of the Frame Key.
3. A live picture SHALL never add anything to the Texture_Ledger.
4. Frame_Notes SHALL be reviewed content and SHALL pass the same lints as Visual_Style phrases.

### Requirement 19: Measurement and Release Gates

**User Story:** As the owner, I want each kind of picture proven on my machine before it is listed as enabled, so that "no mistakes" is measured, not hoped.

#### Acceptance Criteria

1. THE `frames eval` command SHALL report, per Frame_Kind and city: the Mechanical_Checks failure rate, the Inspector rejection rate, the median and 95th-percentile live render time, and the attempts per accepted picture.
2. THE owner review SHALL be a blind sample of at least 100 accepted pictures per kind per city, each marked keep, period error, wrong scene or unsafe.
3. A Frame_Kind SHALL pass its Frame_Release_Gate only if: no reviewed picture is marked unsafe; period errors are at most 2%; wrong-scene marks are at most 3%; keeps are at least 80%; and the Inspector agrees with the owner's rejections at least 90% of the time.
4. FOR `live` mode, a scripted two-hour session on the Reference Machine with live frames on SHALL show no swap-outs. Its 95th-percentile time to first released sentence on each role SHALL be no more than 10% above the same session with frames off (Slice Req 15.3).
5. THE results SHALL be written to `docs/frames-eval-<date>.md`. `config/frames.yaml` SHALL list a kind as enabled only after its gate passes, and only with the owner's approval.

### Requirement 20: Security and Injection Resistance

**User Story:** As the owner, I want the picture pipeline to be impossible to steer from outside, so that pictures cannot leak data, run code or be turned against the player.

#### Acceptance Criteria

1. No text the player typed (spoken lines, commands, save names) SHALL reach a Frame Request, a Frame_Prompt, the Inspector or a Frame_Report file.
2. Every text field in a Frame Request SHALL come from loaded, reviewed pack content or from fixed enumerations.
3. Provider output SHALL be treated as untrusted bytes. It SHALL never be parsed as anything but an image by the Sanitiser, never executed and never interpreted as a path.
4. Frames SHALL be served only from the existing access-controlled route, by cache key, with the security headers the web shell already sets (web-shell Req 11.6).
5. THE frames feature SHALL make no network connection beyond the loopback interface.
6. THE `frames` package SHALL never be imported by `engine`, `player-view`, `dialogue`, `living` or `tui`, and `player-view` SHALL never import `frames`.
