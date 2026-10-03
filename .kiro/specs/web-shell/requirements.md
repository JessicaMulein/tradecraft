# Requirements Document

## Introduction

This spec adds a **Web Shell**: a small Express server that exposes the existing `player-view` `EngineApi` to a very plain web page, so the game can be played in a browser on the same machine. It is a second client next to the Ink TUI. It adds no game logic and no new view of the world.

The server has two jobs that matter beyond serving pages:

- It must be reachable **only from the local machine**, and
- it must still **refuse any local process that does not hold the session's access token**, because "bound to localhost" alone lets every program and every web page open in the user's browser drive the game.

It also leaves one clearly marked **Still-Frame Hook** so that a later spec can show AI-rendered scene images without changing the server, the page or the engine.

Two assets exist only for the web version and are hosted here: the **soundtrack** (`soundtrack/`, twelve tracks in two takes each, as MP3 and WAV, driven by the rules in `soundtrack/cue-map.md`) and the **box art** (`box_art.jpeg`, 1024×572, and `box_art-1-1.jpeg`, 1024×1024). The cue map's own wording says its title cue "covers the image render batch", so the Still-Frame Hook is designed for a batch prepared during new-game setup as well as for single frames.

One rule from the project's central invariant applies to audio. **Music must not be an oracle.** A cue that changes when a hidden fact changes (for example when an NPC's cover starts to crack, or when a tail is attached) would tell the player something the Player View does not. Every cue trigger is therefore restricted to Player View data (Requirement 15).

All slice invariants hold unchanged:

- The deterministic Sim owns all ground truth (Slice Req 2). The Web Shell reaches the game only through `player-view`, exactly as the TUI does (Slice Req 2.2, 13.5).
- Model outputs never create, change or reveal facts (Slice Req 2.3).
- Generation, turns and replay are deterministic (Slice Req 1.2, 17.4). The Web Shell never changes what a given action log produces.
- The Reference Machine runs at most two resident models (Slice Req 14.5). This spec adds none.

Proposed implementation order: after every other spec. It needs only the completed slice-integration spec, and it picks up the add-ons' views and actions automatically because it renders whatever `EngineApi` offers. `natural-language-commands` adds a text box that this spec's page can host once both exist.

Out of scope: access from other machines, TLS, user accounts, more than one simultaneous game, image generation itself, composing or producing new music, and any visual design beyond a plain, accessible text page with a title screen.

## Glossary

Terms not listed here are defined in the slice glossary.

- **Web Shell**: The new workspace package (`packages/web`) that holds the server, the page assets and the Frame Hook interface.
- **Shell Server**: The Express application and HTTP listener the Web Shell starts.
- **Loopback Address**: `127.0.0.1`.
- **Access Token**: A random secret generated each time the Shell Server starts. It is the only credential.
- **Session Cookie**: The `HttpOnly`, `SameSite=Strict` cookie the Shell Server sets after a valid Access Token exchange.
- **Launch URL**: The URL printed at startup that carries the Access Token once, for the first browser visit.
- **Offered Action**: One entry of `EngineApi.actions()`, with its quote.
- **Action Reference**: The id the Shell Server gives each Offered Action in a response, which the client returns to act on it.
- **Page**: The plain HTML, one small script and one stylesheet the Shell Server serves.
- **Frame Hook**: The `SceneFrameProvider` interface through which the Web Shell may later obtain a still image for a scene.
- **Frame Request**: The data a `SceneFrameProvider` receives. It is built only from Player View data.
- **Frame Key**: The cache key of a Frame Request: kind, Location, phase, crowd band and weather band, mirroring the slice's Location Flavour cache key (Slice Req 21.7).
- **Frame Batch**: The set of Frame Requests prepared together during new-game setup.
- **Cue Director**: The browser module that plays the soundtrack from Cue Inputs and the Cue Map.
- **Cue**: One named piece of music, a stinger or an ambience bed, with its files and loop metadata.
- **Cue Map**: The data form of `soundtrack/cue-map.md`: rules from Cue Inputs to Cues and transitions.
- **Take**: One recording of a Cue. Most shipped Cues have two Takes (for example `Café` and `Café 2`), each as MP3 and WAV. The Cue Director picks a Take at random each time a Cue with several starts.
- **Cue Manifest**: The list of Cues that actually have audio files, so that a rule naming a missing track degrades gracefully.
- **Cue Inputs**: The closed list of Player View values a Cue Map rule may read (Requirement 15.2).
- **Stinger**: A short one-shot cue played over or between music.
- **Ambience Bed**: A continuous background sound that runs under music and keeps running when music stops.

## Requirements

### Requirement 1: Package and Boundary

**User Story:** As the developer, I want the web client held to the same truth-isolation boundary as the TUI, so that a second client cannot become a way around it.

#### Acceptance Criteria

1. THE Web Shell SHALL be a workspace package `packages/web` that imports only `player-view`, Node built-ins and its own third-party dependencies (Express and its typings).
2. THE dependency rules SHALL gain a rule `web-imports-only-player-view` equivalent to `tui-imports-only-player-view`, and `pnpm dep-cruise` SHALL fail on any import of `engine`, `content`, `dialogue`, `llm` or `app` from `packages/web`.
3. THE Express dependency SHALL be added to `packages/web` only. No other package SHALL gain a dependency on it.
4. THE Shell Server SHALL receive its `EngineApi` instance from the Composition Root (`packages/app`) and SHALL NOT construct an engine, load content or call a model itself.
5. THE Shell Server SHALL hold no game state of its own other than the Access Token, the Session Cookie records, the current Action References and the Frame cache.

### Requirement 2: Loopback-Only Binding

**User Story:** As a player, I want the server reachable only from my own machine, so that nobody on my network can see or drive my game.

#### Acceptance Criteria

1. THE Shell Server SHALL listen on the Loopback Address only.
2. IF the configured host is not the Loopback Address THEN THE Shell Server SHALL refuse to start and SHALL report the configured value. There SHALL be no setting that allows another host.
3. THE Shell Server SHALL accept a configured port, with a default, and the value `0` SHALL select a free port that the launcher then prints.
4. IF the port is in use THEN THE launcher SHALL report which port and exit without starting a game.
5. WHEN a connection arrives whose remote address is not the Loopback Address THEN THE Shell Server SHALL close it without a response, as a second layer behind the binding.

### Requirement 3: Access Control

**User Story:** As a player, I want a credential that other local programs and browser tabs do not have, so that nothing else on my machine can drive the game.

#### Acceptance Criteria

1. WHEN the Shell Server starts THEN THE Shell Server SHALL generate an Access Token of at least 256 bits from the platform's cryptographic random source, and SHALL keep it in memory only.
2. THE launcher SHALL print the Launch URL to the terminal once, and SHALL NOT write the Access Token to any log, save, config or file.
3. WHEN a request to the Launch URL carries a valid Access Token THEN THE Shell Server SHALL set a Session Cookie, redirect to a URL without the token, and SHALL NOT accept that token in a query string on any other route.
4. THE Shell Server SHALL require a valid Session Cookie, or an `Authorization: Bearer` header carrying the Access Token for scripts and evals, on every Page, API and frame route. A missing or invalid credential SHALL return 401 with no detail.
5. THE Shell Server SHALL compare credentials in constant time.
6. THE Shell Server SHALL slow or lock out a client after a configured number of failed credential attempts within a window.
7. A new Access Token SHALL be generated on every start, so that a restart invalidates every earlier Session Cookie.
8. THE Session Cookie SHALL be marked `HttpOnly` and `SameSite=Strict`, SHALL be scoped to the Shell Server's origin and SHALL expire when the Shell Server stops.

### Requirement 4: Request Hardening

**User Story:** As a player, I want a hostile web page in my browser unable to talk to the game through my own browser, so that visiting a website cannot move my agents.

#### Acceptance Criteria

1. THE Shell Server SHALL reject any request whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` for the bound port (protection against DNS rebinding).
2. WHEN a request changes state (every non-GET request) THEN THE Shell Server SHALL require an `Origin` header that matches the Shell Server's own origin, and SHALL also reject any request whose `Sec-Fetch-Site` header is present and not `same-origin`.
3. THE Shell Server SHALL send no CORS headers and SHALL answer cross-origin preflight requests with 403.
4. THE Shell Server SHALL require `Content-Type: application/json` on every request with a body, and SHALL enforce a maximum body size.
5. THE Shell Server SHALL send a `Content-Security-Policy` that allows scripts and styles only from its own origin and forbids framing, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` on every response.
6. THE Shell Server SHALL set `Cache-Control: no-store` on every API response.

### Requirement 5: One Game, One Turn at a Time

**User Story:** As a player, I want the browser to behave like the single-player terminal, so that two tabs or a double click cannot corrupt a turn.

#### Acceptance Criteria

1. THE Shell Server SHALL drive exactly one game session, the one the Composition Root supplied.
2. WHILE a turn is in flight THEN THE Shell Server SHALL reject any further state-changing request with 409 and a typed body, matching the shell input lock of the TUI.
3. WHEN the client disconnects during a turn THEN THE Shell Server SHALL let the turn finish and commit as the Turn Pipeline defines (Slice-Integration turn atomicity), and SHALL NOT abort it.
4. WHEN a client reconnects THEN THE Shell Server SHALL answer from current Player View state, so a reload shows the committed result of a turn that finished while the page was closed.
5. IF a turn pauses because a model endpoint is down THEN THE Shell Server SHALL expose the paused state and a retry operation that calls `EngineApi.retry()`.

### Requirement 6: Read API

**User Story:** As a player, I want every panel of the terminal game in the browser, so that I lose nothing by switching clients.

#### Acceptance Criteria

1. THE Shell Server SHALL expose read endpoints for `status`, `actions`, `quote`, every member of `views` (scene, here, journal, map, people, documents, one document, intercepts, workbench, help, debrief), the Case File list, notifications and saves.
2. EVERY read response SHALL be a JSON serialisation of a value that `EngineApi` returned, with a response `schemaVersion`.
3. THE Shell Server SHALL NOT add, derive or enrich any field from any source other than `EngineApi`.
4. THE Shell Server SHALL validate every request parameter against a schema and SHALL return a typed 400 for any invalid one.

### Requirement 7: Acting Only Through Offered Actions

**User Story:** As a player, I want the browser to offer only what the game offers, so that a crafted request cannot do anything the interface could not.

#### Acceptance Criteria

1. WHEN the Shell Server returns `actions` THEN THE Shell Server SHALL give each Offered Action an Action Reference that is valid only for the state in which it was issued.
2. WHEN the client acts THEN THE client SHALL send an Action Reference and, for an Offered Action that is a template (decrypt submission, pay amount, cable report, feed items, confront Claim), the completing parameters, validated against a schema.
3. THE Shell Server SHALL reject an unknown or stale Action Reference with a typed error and SHALL NOT accept an arbitrary `Action` object from the client.
4. THE Shell Server SHALL call `EngineApi.act`, which re-quotes the action. An action the engine rejects SHALL return the quote's reason.
5. THE Shell Server SHALL expose `say`, `endScene`, `caseFile` grade/link/unlink, `notes.add`, notification dismiss and save/load as operations that call the matching `EngineApi` method.

### Requirement 8: Turn Streaming

**User Story:** As a player, I want to see a turn's text arrive as it streams, so that dialogue and narration feel live like in the terminal.

#### Acceptance Criteria

1. THE Shell Server SHALL relay a `TurnStream` as server-sent events, one event per `TurnChunk`, preserving order, with a typed terminal event.
2. THE Shell Server SHALL send a periodic heartbeat comment on an open stream.
3. THE Shell Server SHALL relay notifications through a separate server-sent-event stream fed by `EngineApi.notifications.subscribe`, and SHALL unsubscribe when the client closes it.
4. THE Shell Server SHALL end every stream with a terminal event even when the turn fails, carrying a typed error.

### Requirement 9: Plain Page

**User Story:** As a player, I want a simple, readable page, so that the web version is the same game as the terminal and nothing more.

#### Acceptance Criteria

1. THE Page SHALL be plain HTML with one stylesheet and one small script, SHALL need no build step and no bundler, and SHALL load nothing from another origin.
2. THE Page SHALL offer the screens of the TUI: scene, here and actions with their quotes, journal, map, people, documents and workbench, Case File, notifications, help, save/load and debrief.
3. THE Page SHALL show the current day, phase, Location, Budget, Standing and alerts at all times, and the phase and Budget cost of each Offered Action before it is taken (Slice Req 26.2).
4. THE Page SHALL render Fact and Flavour in visibly different styles, as the TUI does (Slice design, Fact and Flavour).
5. THE Page SHALL be operable by keyboard alone, SHALL use semantic HTML landmarks and labelled controls, and SHALL not rely on colour alone to carry meaning.
6. WHEN a model-dependent feature is unavailable THEN THE Page SHALL show the fact-only result and the paused state, as the TUI does (Slice Req 14).

### Requirement 10: Truth Isolation and Client Parity

**User Story:** As the developer, I want proof that the web client cannot leak ground truth, so that the project's central invariant holds for both clients.

#### Acceptance Criteria

1. FOR ALL generated worlds in the test corpus, EVERY Shell Server response body SHALL contain no value that is `Truth`-branded in the engine and no identifier that appears only in the Truth Store.
2. WHEN the same action log is driven through the Shell Server and directly through `EngineApi` THEN THE final world state hash SHALL be identical.
3. EVERY capability the Page offers SHALL exist as an `EngineApi` method, so that the TUI could offer it too.
4. THE Shell Server SHALL return the debrief only when `EngineApi.views.debrief()` returns one.

### Requirement 11: Still-Frame Hook

**User Story:** As a future developer, I want a defined place for AI-rendered scene images, so that adding them later changes neither the engine nor the page's structure, and so that the images can be prepared while the title music plays.

#### Acceptance Criteria

1. THE Web Shell SHALL define a `SceneFrameProvider` interface with an operation that takes a Frame Request and returns a promise of a frame (bytes and media type) or of nothing, and an operation that takes a Frame Batch and reports progress.
2. THE default provider SHALL be a no-op that returns nothing, and with it THE Page SHALL show its scene normally with no broken image and no reserved empty space.
3. THE Frame Request SHALL have a kind (`scene`, `portrait` or `title`) and SHALL be built only from Player View data: the Location's public name, type, description and atmosphere tags, the phase, the crowd band, the weather band, the visible NPC descriptors at the Location, and the era's art direction. It SHALL contain no Truth-branded value and no data about a person the player cannot see.
4. THE Shell Server SHALL request a frame without blocking the scene text: the Page SHALL show the scene first and SHALL add a frame when one arrives.
5. THE Shell Server SHALL be able to prepare a Frame Batch for the Locations the player knows at new-game setup, while the title Cue plays, and the Page SHALL show progress and SHALL let the player start without waiting.
6. THE Shell Server SHALL serve a frame only from an access-controlled route, SHALL cache it by Frame Key, and SHALL keep the cache outside the save and outside the World State.
7. A provider error, timeout or absence SHALL never delay, fail or change a turn.
8. A frame SHALL NOT be part of the determinism contract, the Content Manifest or the save, and no gameplay decision SHALL depend on it.
9. THE art direction (style, palette, period) SHALL come from configuration and from the Era Profile when setting-generalization is present, and SHALL be part of the Frame Key so that a change re-renders.
10. THE Frame Hook SHALL state in its documentation that a provider which runs a model must fit the Reference Machine's model budget (Slice Req 14.5), which a later spec must decide.

### Requirement 12: Launcher and Configuration

**User Story:** As a player, I want one command to start the web version, so that setup is the same as for the terminal.

#### Acceptance Criteria

1. THE repository SHALL provide `pnpm play:web`, which composes the game as `pnpm play` does and starts the Shell Server.
2. THE configuration SHALL live in `config/` as a Zod-validated file with port, lockout limits, body size limit, an `openBrowser` flag, the soundtrack directory, the audio format preference and the art direction, with documented defaults.
3. WHERE `openBrowser` is set THEN THE launcher SHALL open the Launch URL in the default browser, and otherwise SHALL only print it.
4. WHEN the process receives an interrupt THEN THE Shell Server SHALL stop accepting requests, let an in-flight turn commit, close open streams and exit.
5. THE README SHALL document the command, the access model and the loopback-only guarantee.

### Requirement 13: Errors and Logging

**User Story:** As the developer, I want errors that help me and tell an attacker nothing, so that debugging is easy and the surface stays small.

#### Acceptance Criteria

1. THE Shell Server SHALL map `LoadError`, `FeedError` and every `Result` error to typed JSON errors with a stable code.
2. THE Shell Server SHALL never send a stack trace, file path or internal id to the client.
3. THE Shell Server SHALL log method, route, status and duration, and SHALL NOT log the Access Token, the Session Cookie or request bodies.

### Requirement 14: Tests

**User Story:** As the developer, I want the security properties checked by tests, so that a later change cannot weaken them silently.

#### Acceptance Criteria

1. THE test suite SHALL start the Shell Server on an ephemeral port and SHALL verify: loopback-only binding, rejection of a bad `Host`, of a missing or wrong credential, of a cross-origin state change, and of a request with an arbitrary `Action` body.
2. THE test suite SHALL verify turn serialisation (409 on a second request), disconnect safety and stream termination.
3. THE test suite SHALL include the truth-isolation property of Requirement 10.1 and the log equivalence of Requirement 10.2.
4. THE test suite SHALL verify that the no-op Frame Hook leaves every response and the world state unchanged.
5. THE test suite SHALL run without a live model, using the fake seams of the Composition Root.
6. THE test suite SHALL verify the Cue Director's decisions (Requirement 15) in a browser-free harness, including the non-oracle property of 15.3.
7. THE test suite SHALL verify that audio and art routes are access-controlled and that a missing file is a typed 404 and not a crash.

### Requirement 15: Soundtrack and Cue Director

**User Story:** As a player, I want the music to follow the game, so that the web version has the mood of the soundtrack without the music ever giving the plot away.

#### Acceptance Criteria

1. THE Web Shell SHALL play the soundtrack in the browser through a Cue Director that is driven entirely by Cue Inputs and a Cue Map, and the Sim and `player-view` SHALL contain no audio logic.
2. THE Cue Inputs SHALL be limited to: the screen (title, city, talk scene, workbench, intercept, game over), the Location's public Tags and District, the phase, the player's own last action kind, the player's own last Intent in a talk scene, Notifications and Fact Line kinds the player has been shown, the status bar alerts, the Border Outcome Fact Lines shown, and the game-over kind. A Cue Map rule SHALL NOT read any other value.
3. FOR ANY two games that give the player an identical sequence of Player View values THE Cue Director SHALL produce an identical sequence of Cues, whatever the Truth Store holds. The choice of Take is excluded from this property because it is random (15.13). A test SHALL check this by running worlds that differ only in hidden truth.
4. THE Cue Map SHALL be a data file validated at start, derived from `soundtrack/cue-map.md`, and the existing rules SHALL be preserved: only one music Cue plays at a time except during a crossfade, Ambience Beds run continuously and survive music dropping out, and silence is a deliberate state a rule may choose.
5. THE rule "switch to the cracking variant when the NPC's cover state becomes cracking" SHALL be replaced by a rule on a player-visible signal (the player's own pitch or confront Intent, or a Fact Line the player was shown), because the cover state is truth.
6. A Pursuit Cue SHALL be triggered only by player-visible driving signals (the player's own choice of high speed or an Evasion Maneuver, a Checkpoint the player turned back from), and never by a Tail's existence.
7. THE Cue Director SHALL support: crossfades of 2–3 seconds at a phrase boundary where the Cue carries loop and phrase metadata and otherwise at the nearest safe point; gapless loops of a named section (the title theme's middle section); one-shot Stingers followed by a defined quiet period; ducking of the music while NPC dialogue streams; and a drop to the Ambience Bed after a configured exploration time.
8. THE Cue Manifest SHALL list the Cues whose files exist, with each Cue's Takes. WHEN a rule names a Cue with no audio THEN THE Cue Director SHALL play the rule's fallback Cue or silence, and the Pack Linter-style check SHALL report the missing Cue at start without failing.
9. THE Shell Server SHALL serve audio from the configured soundtrack directory over an access-controlled route with range requests, SHALL serve the formats in a configured preference order (default: Ogg Opus when present, then MP3) and SHALL serve WAV only when configured, and SHALL NOT copy audio into the package.
10. THE Page SHALL start audio only after a player gesture on the title screen, because browsers block autoplay, and SHALL provide a mute control, a volume control and a music-off setting that work from the keyboard.
11. THE Page SHALL keep audio settings in the browser and SHALL NOT put them in the save or the World State.
12. THE Cue Director SHALL never block, delay or change a turn, and a failure to load or decode audio SHALL fall back to silence with one visible notice.
13. WHEN a Cue starts THEN THE Cue Director SHALL choose one of the Cue's Takes at random, for variety, and WHEN a Cue has two or more Takes THEN THE Cue Director SHALL NOT choose the Take that played last for that Cue. A Cue with one Take SHALL simply play it.
14. THE Take choice SHALL use the browser's own randomness and SHALL NOT use the Sim's PRNG, the seed or any Player View value, so that audio can never affect or reveal the simulation and a replay of the same game may sound different.
15. THE Cue Manifest SHALL discover Takes by file naming (`<Cue>` and `<Cue> 2`, with `.mp3` and `.wav`), and a Cue with only one Take present SHALL be reported but SHALL still play.
16. A crossfade, a gapless loop or a Stinger SHALL stay within one Take, and a loop SHALL NOT switch Take until the Cue ends.
17. THE Cue Map SHALL allow a **Derived Cue**: a Cue defined as a time slice of a Take of another Cue (start and end, or a named section from the Take's metadata, with fades), so that a missing track can be stood in for by part of an existing one. A Derived Cue SHALL be played like any other Cue and SHALL be replaced by a real file when one is added to the Cue Manifest under the same Cue id. WHEN the plot completes before the player stops it THEN the Cue Director SHALL play the first section of the `Burned` Cue as a stand-in until a dedicated track exists.
18. THE shipped soundtrack SHALL be mapped one-to-one to Cues by file stem: `Title` to the title Cue, `Opening` to the opening Cue, `City` to exploration, `Soviet-Sector`, `Café`, `Interrogation`, `Checkpoint`, `Cipher Workbench`, `Numbers Station`, `Pursuit`, `Success` and `Burned` to the Cues of the same names. Where the cue map names a stinger, an ambience bed or a variant for which no file exists (asset burned, sector cleared or detained, cipher solved, night, cracking, hotel-bar), THE Cue Director SHALL use a crossfade or a deliberate silence in its place.
19. THE Cue Map's exploration music SHALL be `Soviet-Sector` while the current Location is in the Soviet sector and `City` otherwise, and the more specific scene Cues (game over, title and opening, intercept, workbench, checkpoint, pursuit, interrogation, café or hotel) SHALL take precedence over exploration music wherever the player is.

### Requirement 16: Title Screen and Box Art

**User Story:** As a player, I want the web version to open on the box art with the title music, so that it feels like a finished game.

#### Acceptance Criteria

1. THE Page SHALL show a title screen with the box art, the new-game and load options, and the audio gesture of Requirement 15.10.
2. THE Shell Server SHALL serve `box_art.jpeg` for wide layouts and `box_art-1-1.jpeg` for square and narrow layouts, from an access-controlled route, using the files in the repository root as the single source.
3. THE title screen SHALL play the title Cue (`Title`, two Takes themed for the game) and SHALL cover the Frame Batch preparation (Requirement 11.5). WHEN the player starts a new game THEN the Cue Director SHALL play the opening Cue (`Opening`) over the opening of the game.
4. THE game-over screen SHALL play the Cue for its game-over kind and SHALL then fall silent.
5. THE title screen SHALL have alternative text and SHALL not carry meaning in the image alone.
