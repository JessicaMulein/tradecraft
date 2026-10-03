# Implementation Plan: Web Shell

## Overview

This plan builds `packages/web`, an Express 5 server over the `player-view` API that listens on loopback only, with a plain HTML page, compiled ES modules and a Cue Director for the soundtrack. The order is:

1. package scaffolding, the dependency rule, configuration and the small `player-view` addition;
2. security (binding, token, session, request hardening, lockout);
3. the API (Action References, read routes, turn gate, SSE streaming, errors);
4. the launcher;
5. the page, title screen and box art;
6. the soundtrack (Cue Map, Cue Director, Manifest, routes, player, take metadata, encoder);
7. the still-frame hook;
8. app-level integration tests and documentation.

Property numbers refer to this spec's design.

Dependencies on other specs, as interface assumptions:

- **player-view:** one additive change (task 1.3): `type`, `tags` and `district` on `HereView.location` and `SceneView.location`.
- **natural-language-commands:** the web command box calls `api.interpret` once that spec lands (task 6.3). Until then the page offers actions only.
- **street-ops:** the SVG map panel (street-ops task 12.5) is built on this page's client modules.
- **Soundtrack assets:** `soundtrack/` holds twelve stems with two takes each (Tradecraft has one). Missing cues degrade to silence or a crossfade and are never an error.

## Tasks

- [ ] 1. Package, boundary, configuration and player-view addition
  - [ ] 1.1 Scaffold `packages/web` and the dependency rule
    - Create the package with Express 5, zod and typings. Add `web-imports-only-player-view` to `.dependency-cruiser.cjs`, a copy of the TUI rule, and forbid imports from `packages/app`.
    - Add `play:web` and `soundtrack:encode` scripts.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [ ] 1.2 Add `config/web.yaml` and its zod schema
    - Add port, session lifetime, lockout, frame cache and audio settings, with defaults and validation. Reject any non-loopback host value.
    - _Requirements: 2.4, 12.2, 12.3_
  - [ ] 1.3 Add the additive `player-view` location fields
    - Add `type`, `tags` (public only) and `district` (id and name) to `HereView.location` and `SceneView.location`, with schema and tests that no truth field is added.
    - **Property 5: Truth isolation at the boundary**
    - **Validates: Requirements 10.1, 10.2**
    - _Requirements: 10.1, 15.8_

- [ ] 2. Security
  - [ ] 2.1 Implement loopback-only binding
    - Bind explicitly to `127.0.0.1`, and verify the actual bound address after listen. Refuse to start if it differs.
    - **Property 1: Loopback only**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - _Requirements: 2.1, 2.2, 2.3, 2.5_
  - [ ] 2.2 Implement the per-start token, session cookie and /launch
    - Generate a 256-bit token per start. `/launch?token=` exchanges it once for a `tc_session` cookie (HttpOnly, SameSite=Strict) and redirects by meta refresh so the token leaves the URL.
    - Compare tokens in constant time.
    - **Property 2: Credential required**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [ ] 2.3 Implement request hardening
    - Implement Host, Origin, `Sec-Fetch-Site` and CSP guards, body size limits and content-type checks, in the middleware order from the design.
    - **Property 3: Cross-origin state change refused**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [ ] 2.4 Implement lockout
    - Lock the token exchange after repeated failures within the configured window, with backoff, and log the event.
    - _Requirements: 3.6, 3.7, 3.8_

- [ ] 3. API, turn gate and streaming
  - [ ] 3.1 Implement Action References
    - Implement the table of `ref -> Action` bound to `stateVersion`. The client never sends an Action object. A stale or unknown ref is rejected.
    - **Property 4: Offered actions only**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [ ] 3.2 Implement the read routes
    - Implement the Player View, catalogue, notifications and scene routes. Every response passes through the view schemas.
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [ ] 3.3 Implement the Turn Gate
    - Allow one turn at a time per game. A second request while one is running returns 409 and does not queue.
    - **Property 8: One turn at a time**
    - **Validates: Requirements 5.1, 5.2, 5.3**
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [ ] 3.4 Implement the turn recorder and SSE streaming
    - Stream `POST /turn` as SSE. The Turn recorder buffers the turn to completion so a client disconnect never leaves a half-applied turn.
    - Provide an EventSource channel for notifications.
    - **Property 7: Turn atomicity under disconnect**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [ ] 3.5 Implement errors and logging
    - Map errors to stable codes and plain messages with no stack traces or truth. Log requests without tokens or cookies.
    - _Requirements: 13.1, 13.2, 13.3_

- [ ] 4. Launcher
  - [ ] 4.1 Implement `scripts/play-web.ts` and `web-launcher.ts` in `app`
    - Build the game through `createGame`, start the server, print the launch URL with the token, and open the browser only when configured.
    - Shut down cleanly on SIGINT.
    - _Requirements: 12.1, 12.4, 12.5_

- [ ] 5. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Page, title screen and box art
  - [ ] 6.1 Build the plain HTML page and tsc-compiled client modules
    - Add the page, styles and ES modules compiled by `tsc` with no bundler. Render only Player View data, using `textContent` and no HTML injection.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  - [ ] 6.2 Implement the title screen and box art
    - Serve `box_art.jpeg` (wide) and `box_art-1-1.jpeg` (square) by media query. Show the title screen with New Game and Continue before any session starts, and cue `title` music on first user gesture.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_
  - [ ] 6.3 Add the command box
    - Add a command box that calls `api.interpret` once natural-language-commands lands, and shows each Interpretation variant. Deferred until then.
    - _Requirements: 9.6_

- [ ] 7. Soundtrack and Cue Director
  - [ ] 7.1 Implement the Cue Map schema and loader
    - Parse `soundtrack/cue-map.yaml` with the tiny predicate language, validate rule references and cue ids, and report errors with line numbers.
    - **Property 12: Cue Map validity**
    - **Validates: Requirements 15.1, 15.2, 15.3**
    - _Requirements: 15.1, 15.2, 15.3_
  - [ ] 7.2 Implement the pure `decide` function
    - Implement `decide(CueMap, manifest, state, CueInputs)` as a pure function of Player View data, using the rule order: game over, title and opening, intercept, workbench, burned-asset hold, checkpoint, pursuit, interrogation, café or hotel, exploration (Soviet-Sector music in the Soviet sector, City elsewhere).
    - Use only player-visible signals, so the music never reveals hidden state.
    - **Property 9: Cue sequence is a function of Player View alone**
    - **Validates: Requirements 15.4, 15.5, 15.6, 15.7**
    - _Requirements: 15.4, 15.5, 15.6, 15.7, 15.8_
  - [ ] 7.3 Implement Cue Manifest and Take discovery
    - Discover tracks by filename (`X` and `X 2`), mapping filenames to cues as defined in the design. Cache the manifest and rescan on start.
    - Support Derived Cues (`burned-plot` as the first section of `Burned` take 1, 0–68 s, 3 s fade; write `soundtrack/take-meta.yaml` with that section) from `take-meta.yaml`.
    - _Requirements: 15.9, 15.10, 15.11_
  - [ ] 7.4 Implement random Take choice
    - Choose between two takes at random per cue entry, using a client-side random that is not seeded from game state. Tradecraft has one take.
    - **Property 10: Take choice independence**
    - **Validates: Requirements 15.12, 15.13**
    - _Requirements: 15.12, 15.13_
  - [ ] 7.5 Implement audio and art routes
    - Serve audio with range requests and the art files, behind the same session guard, with cache headers and no directory listing.
    - _Requirements: 15.14, 15.15_
  - [ ] 7.6 Implement the Web Audio player
    - Implement the player: crossfade between cues, loop points and named sections from `take-meta.yaml`, and graceful silence when a cue or take is missing.
    - _Requirements: 15.16, 15.17_
  - [ ] 7.7 Add the Opus encode script
    - Add `soundtrack:encode` to produce Opus from the WAV stems, writing outside git. Document moving WAVs out of the repository (743 MB today).
    - _Requirements: 15.18, 15.19_

- [ ] 8. Still-frame hook
  - [ ] 8.1 Implement the SceneFrameProvider hook and Frame Key cache
    - Define the provider interface, the Frame Key (a hash of public scene inputs only) and a disk cache. With no provider configured the page shows no frames and behaves identically.
    - _Requirements: 11.1, 11.2, 11.3, 11.4_
  - [ ] 8.2 Implement the Frame Batch at new game
    - Optionally pre-generate frames for the opening scenes, with a time budget. Provider output is inert: never parsed or executed.
    - **Property 11: Frames are inert**
    - **Validates: Requirements 11.5, 11.6, 11.7, 11.8**
    - _Requirements: 11.5, 11.6, 11.7, 11.8, 11.9, 11.10_

- [ ] 9. Integration tests and documentation
  - [ ] 9.1 Add the Truth fingerprint test
    - In `app`, build a Truth fingerprint from the engine's Truth Store over generated worlds and assert no response body contains any fingerprint value.
    - **Property 5: Truth isolation at the boundary**
    - **Validates: Requirements 10.1, 10.3**
    - _Requirements: 10.1, 10.3, 14.1_
  - [ ] 9.2 Add the client parity test
    - Play scripted games through the web API and through `EngineApi` directly, and assert identical state and Player Views.
    - **Property 6: Client parity with the engine**
    - **Validates: Requirements 10.4, 14.2**
    - _Requirements: 10.4, 14.2, 14.3_
  - [ ] 9.3 Add end-to-end security tests
    - Run a real server on an ephemeral port. Check refused external Host, missing cookie, cross-origin POST and lockout.
    - _Requirements: 14.4, 14.5, 14.6, 14.7_
  - [ ] 9.4 Write documentation
    - Add `docs/web-shell.md`: running it, the access model, the Cue Map format, the soundtrack file naming and the frame hook. Update the README.
    - _Requirements: 12.1_

- [ ] 10. Final checkpoint - Ensure all tests pass, ask the user if questions arise.

## Notes

- Property tests are required sub-tasks. Tag each with `// Feature: web-shell, Property N: <title>`.
- Task 6.3 (command box) is deferred until natural-language-commands lands.
- Open item: whether to move the WAV stems out of git.
- No source code has been written in this plan.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["2.3"] },
    { "id": 5, "tasks": ["2.4", "3.1", "7.1"] },
    { "id": 6, "tasks": ["3.2", "7.2"] },
    { "id": 7, "tasks": ["3.3", "7.3", "8.1"] },
    { "id": 8, "tasks": ["3.4", "7.4", "8.2"] },
    { "id": 9, "tasks": ["3.5", "6.1", "7.5"] },
    { "id": 10, "tasks": ["4.1", "6.2", "7.6"] },
    { "id": 11, "tasks": ["6.3", "7.7", "9.1"] },
    { "id": 12, "tasks": ["9.2"] },
    { "id": 13, "tasks": ["9.3"] },
    { "id": 14, "tasks": ["9.4"] }
  ]
}
```
