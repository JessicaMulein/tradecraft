# Implementation Plan: Scene Frames

## Overview

The build order is the safety order:

1. Foundations, where nothing reaches a player and the existing hook's defects are fixed.
2. Requests and content, where the truth boundary is proved before any image is made.
3. The prompt, the sanitiser and the providers, proved against fakes.
4. The Inspector, the cache and resolution.
5. Live scheduling and the memory budget.
6. The page.
7. The Darkroom and Frame_Packs.
8. The other kinds (portraits, press, moments) and the living-world bridge.
9. Measurement and release.

Each later group plugs into interfaces an earlier group finished. Every property test is a required task, as in the slice. Property numbers refer to this spec's design.

Dependencies, as interface assumptions:

- web-shell is in place. Its tasks 8.1 and 8.2 are unticked and are absorbed by groups 1 and 6 here. Tick them in the same change.
- content-expansion's Content Kind Registry, Era Pack, City Packs, Anachronism Entries, Real-Person Blocklist, Sensitivity Terms and Provenance gate are in place.
- llm's gateway priority bands exist. If living-world's `CallPriority.Background` is not yet in, task 5.1 adds it in the same form.
- ambient-world and living-world are optional. Tasks 8.4 and 8.7 apply only when they are present.
- No live image model or vision model is needed in CI. Owner runs happen on the Reference Machine.

## Rules for every task

- Frames stay off unless `config/frames.yaml` sets a mode other than `off`. The shipped file says `mode: off`, and nothing here changes `config/scenario.yaml`.
- `generatorVersion` stays `0.7.0`. Existing golden replays stay byte-identical. No existing golden is re-recorded.
- Frames draw nothing from any engine PRNG stream.
- `player-view` never imports `frames`, `llm` or `dialogue`. `engine`, `dialogue`, `living` and `tui` never import `frames`. Only `app` wires `frames` to `web`.
- Image files never enter the main repository history. Frame_Packs and `frame-drafts/` are git-ignored from the start (task 1.5).
- CI uses fakes only. Live providers and vision models are owner runs on the Reference Machine.
- Marked *(asks you first)*: stop and ask the owner before doing it, as `AGENTS.md` requires.

## Tasks

- [ ] 1. Foundations
  - [ ] 1.1 Move the frame types and port into `player-view`
    - Create `player-view/frames` with `FrameKind`, `FrameRequest`, `Frame`, the `SceneFrameProvider` port and the null provider. `web` re-exports them, so its public API and tests do not change.
    - Add the dependency-cruiser rules from the design's Package changes.
    - _Requirements: 20.6_
  - [ ] 1.2 Add `config/frames.yaml` and its loader
    - Ship it with `mode: off`. Validate with strict Zod objects and no default for `mode`. Report `<file>: <path>: <message>`. Reject any provider URL that is not on the loopback interface.
    - Add the per-kind switches, quality, thresholds, attempts, budget, cache and pack list.
    - _Requirements: 1.1, 1.2, 1.3, 1.6_
  - [ ] 1.3 Wire modes into the web shell
    - With `mode: off`, `FrameService` uses the null provider and the route builds no request. With `packs`, no provider ever starts. With `live`, the provider is created by the Composition Root.
    - Frame settings are not saved and not in the Content Manifest. Pictures are served only from the existing access-controlled route, with its security headers.
    - _Requirements: 1.1, 1.4, 1.5, 1.8, 20.4_
  - [ ] 1.4 Write the property test that disabled is inert
    - **Property 14: Disabled is inert**
    - **Validates: Requirements 1.1, 1.3, 1.4**
  - [ ] 1.5 Ignore image directories
    - Add `frame-drafts/`, `frame-packs/*/**/*.webp` and `.cache/frames/` to `.gitignore`. Keep manifests tracked only if the owner decides to track them.
    - _Requirements: 12.6_
  - [ ] 1.6 Write the property test that frames are inert
    - **Property 13: Frames are inert**
    - **Validates: Requirements 1.8, 9.7, 20.3**
  - [ ] 1.7 Checkpoint: foundations hold
    - `pnpm run check` adds no new failures. Every golden replay and the web-shell parity test pass unchanged.

- [ ] 2. Requests, anchors and visual style
  - [ ] 2.1 Build the request builder
    - In `player-view/frames`, add `buildSceneRequest`, `buildTitleRequest`, `buildBatch` and `frameKey` as in the design. They take a read-only `FramePlayerView` and a `FrameStyleRef` and nothing else.
    - The style ref follows the Current City and the Game Year, and never a fixed city or year.
    - Delete the old builders in `web/lib/frames/request.ts` and update the routes. This also removes the label-as-descriptor defect and the empty batch description.
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.7, 2.9_
  - [ ] 2.2 Write the property test for request truth isolation
    - **Property 1: Request truth isolation**
    - **Validates: Requirements 2.1, 2.2, 20.1, 20.2**
  - [ ] 2.3 Write the property test for request determinism and key agreement
    - **Property 2: Request determinism and key agreement**
    - **Validates: Requirements 2.6, 2.9**
  - [ ] 2.4 Write the property test that scenes hold no individuals
    - **Property 3: Scenes hold no individuals**
    - **Validates: Requirements 2.3, 3.2**
  - [ ] 2.5 Add the Subject_Anchor and the portrait builder
    - Add `SubjectAnchor.derive` from the game seed and the first handle the player held. Add `buildPortraitRequest`, which reads the descriptor only from the field the scene panel uses for an unidentified person, and builds nothing when no `unk:` id exists yet.
    - _Requirements: 2.4, 2.5, 2.8, 15.1, 15.3, 15.5_
  - [ ] 2.6 Write the property test for portrait descriptors
    - **Property 4: Portrait descriptor only**
    - **Validates: Requirements 2.4, 2.8, 15.1, 15.3**
  - [ ] 2.7 Write the property test for anchor separation
    - **Property 5: Subject_Anchor separation**
    - **Validates: Requirements 2.5, 15.3, 15.5**
  - [ ] 2.8 Register the `visual-style` and `moment-motif` kinds
    - Add the Zod schemas, Field Declarations and merge order (core, era, city). Author the core fallback style and an era style for `era-cold-war-early` and a city style for `city-vienna`. Default art direction is 1950s documentary black-and-white photography. Mark drafts with Provenance Records.
    - _Requirements: 4.1, 4.2, 4.3, 4.6_
  - [ ] 2.9 Add the visual-style lint rules
    - Run Anachronism, Real-Person Blocklist and Sensitivity rules on every phrase, unsuppressible for this kind. Add the phrase-coverage rule.
    - _Requirements: 4.4, 4.5_
  - [ ] 2.10 Write the property test for visual style coverage
    - **Property 28: Visual style coverage**
    - **Validates: Requirements 4.4, 4.5**
  - [ ] 2.11 Support the configuration art override
    - The override is part of the request's style ref and so of the key.
    - _Requirements: 4.7_
  - [ ] 2.12 Checkpoint: requests are safe
    - Truth-isolation tests extended to the request builder pass. No golden changes.

- [ ] 3. Prompt composer, sanitiser and providers
  - [ ] 3.1 Create the `packages/frames` package
    - Scaffold with `compose/`, `providers/`, `sanitise/`, `inspect/`, `cache/`, `resolve/`, `packs/`, `live/`, `darkroom/`, `kinds/`, `living/`.
    - _Requirements: 20.6_
  - [ ] 3.2 Write the Depiction_Rules tables
    - One table per kind: may show, must not show, negative terms, checklist keys. Add a test that each rule maps to a requirement criterion.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8_
  - [ ] 3.3 Build the Prompt_Composer
    - Pure function with fixed phrase priority, token-limit fitting and the seed rule. Version it.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7_
  - [ ] 3.4 Add the blocked-term check
    - Refuse any prompt containing a Real-Person Blocklist term, a Sensitivity Term or a persona name the builder could hold.
    - _Requirements: 3.5, 5.6_
  - [ ] 3.5 Write the property test for composer purity and phrase provenance
    - **Property 6: Composer purity and phrase provenance**
    - **Validates: Requirements 5.1, 5.2, 5.5**
  - [ ] 3.6 Write the property test that blocked terms never reach a provider
    - **Property 7: Blocked terms never reach a provider**
    - **Validates: Requirements 3.5, 5.6**
  - [ ] 3.7 Write the property test that prompts fit the model
    - **Property 8: Prompts fit the model**
    - **Validates: Requirements 5.4**
  - [ ] 3.8 Build the Sanitiser
    - Decode with a pixel limit, re-encode to the profile size and format, strip metadata, reject bad dimensions.
    - _Requirements: 7.1, 7.2, 7.5, 7.6_
  - [ ] 3.9 Write the property test for the Sanitiser
    - **Property 9: Sanitiser output is clean**
    - **Validates: Requirements 7.1, 7.2, 7.5, 20.3**
  - [ ] 3.10 Build the Mechanical_Checks
    - Variance, black and white fraction, monochrome saturation and perceptual-hash duplicate check.
    - _Requirements: 7.3, 7.4_
  - [ ] 3.11 Write the property test for Mechanical_Checks
    - **Property 10: Mechanical checks**
    - **Validates: Requirements 7.3, 7.4, 7.6**
  - [ ] 3.12 Define the `ImageProvider` interface and the contract suite
    - Capabilities, typed results, one job at a time, abort, timeouts. Write the fake server and the shared contract tests.
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.7_
  - [ ] 3.13 Implement the Draw Things provider
    - `POST /sdapi/v1/txt2img`, base64 images in the response, dimensions as multiples of 64, model supplied by configuration because the API cannot report it. Verify the response shape on the Reference Machine and record fixtures.
    - _Requirements: 6.1, 6.7_
  - [ ] 3.14 Implement the ComfyUI provider
    - Checked-in workflow templates for text-to-image and for editing, `POST /prompt`, progress, `GET /history` and `/view`, `/interrupt`, `/free`.
    - _Requirements: 6.1, 6.7_
  - [ ] 3.15 Implement the Ollama provider
    - `POST /api/generate` for the image models, isolated behind recorded fixtures because the API is experimental.
    - _Requirements: 6.1, 6.7_
  - [ ] 3.16 Implement the mflux provider
    - Subprocess runner with a safe argument array, timeout, kill on abort and temp-file cleanup.
    - _Requirements: 6.1, 6.7_
  - [ ] 3.17 Write the property test for provider containment
    - **Property 23: Provider containment**
    - **Validates: Requirements 6.3, 6.5, 20.5**
  - [ ] 3.18 Add the startup probe and `frames doctor`
    - Probe once at game start in live mode and report a clear setup message. `frames doctor` renders one test picture, records the model and peak memory in `machine.json`, and tests the Inspector model with a sample image.
    - _Requirements: 6.6, 9.1_
  - [ ] 3.19 Checkpoint: pipeline stages hold
    - Everything runs on fakes, no golden changes.

- [ ] 4. Inspector, cache and resolution
  - [ ] 4.1 Add the `inspector` role
    - Optional role in `models.yaml`, defaulting to the `judge` model when LM Studio reports it accepts images, otherwise none. Keep `requiredModels` de-duplicating, so no shipped profile loads another model.
    - _Requirements: 8.1_
  - [ ] 4.2 Build the Inspector
    - Schema-constrained checklist per kind through an `ImageChatPort` that the Composition Root wires to the gateway. It sends the picture, the kind and the schema only. Compare answers with the request and the thresholds.
    - _Requirements: 8.2, 8.3, 8.6, 8.7_
  - [ ] 4.3 Write the property test for Inspector blindness
    - **Property 12: Inspector blindness**
    - **Validates: Requirements 8.7**
  - [ ] 4.4 Build the attempt loop
    - Retry on failure with the next seed up to the configured limit, then give up for the request. Strict mode shows nothing unchecked. Standard mode marks unchecked pictures.
    - _Requirements: 8.4, 8.5_
  - [ ] 4.5 Write the property test for no unchecked picture in strict mode
    - **Property 11: No unchecked picture in strict mode**
    - **Validates: Requirements 8.3, 8.4, 8.5**
  - [ ] 4.6 Build the Frame_Cache
    - Atomic writes, sha256 per entry, discard on mismatch, eviction rules and the cache id.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - [ ] 4.7 Write the property test for cache integrity
    - **Property 17: Cache integrity**
    - **Validates: Requirements 11.1, 11.2, 11.5**
  - [ ] 4.8 Write the property test for the cache bound and protection
    - **Property 18: Cache bound and protection**
    - **Validates: Requirements 11.3**
  - [ ] 4.9 Write the property test that the key covers its inputs
    - **Property 19: Key covers inputs**
    - **Validates: Requirements 4.7, 5.7, 11.1**
  - [ ] 4.10 Build resolution, Frame_Variant and Shown_Frames
    - Ordered lookup, deterministic variant choice from the game's seed, and the per-game Shown_Frame record that survives restarts.
    - _Requirements: 10.1, 10.4, 10.5, 10.6_
  - [ ] 4.11 Write the property test for resolution
    - **Property 15: Resolution order and determinism**
    - **Validates: Requirements 10.1, 10.6**
  - [ ] 4.12 Write the property test that shown frames are final
    - **Property 16: Shown frames are final**
    - **Validates: Requirements 10.4, 10.5**
  - [ ] 4.13 Add the no-picture and late-picture behaviour
    - A miss leaves no hole. A picture that arrives after the player has left the scene is cached and not shown.
    - _Requirements: 10.2, 10.3_
  - [ ] 4.14 Checkpoint: pictures can be made, checked and found
    - Run the pipeline on fakes end to end, no golden changes.

- [ ] 5. Live scheduling and budget
  - [ ] 5.1 Add the background priority band if absent
    - Reuse living-world's `CallPriority.Background = 4`. If it is not in, add it in the same form. Inspector calls submit as preemptible background jobs.
    - _Requirements: 8.6_
  - [ ] 5.2 Build the Frame_Budget check
    - Read `machine.json` and the Model Manager's estimate. Refuse live mode when there is no measurement or it does not fit. Report why on the settings panel.
    - _Requirements: 9.1, 9.2_
  - [ ] 5.3 Build the scheduler
    - One render at a time, three priority tiers, idle windows, abort on player calls, optional model release after the batch, and stop on memory pressure through a `MemoryProbe` port.
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7_
  - [ ] 5.4 Write the property test that the scheduler never blocks the player
    - **Property 21: Scheduler never blocks the player**
    - **Validates: Requirements 9.3, 9.4, 9.7**
  - [ ] 5.5 Write the property test for the budget gate
    - **Property 22: Budget gate**
    - **Validates: Requirements 9.2, 9.6**
  - [ ] 5.6 Implement the Frame Batch at new game
    - Title, starting scene and known Locations in priority order, with progress and a start-without-waiting option, within the Setup_Window.
    - _Requirements: 14.3, 14.4_
  - [ ] 5.7 Checkpoint: live mode is safe
    - Scripted session with a slow fake provider shows no change in turn timing against the null provider.

- [ ] 6. The page
  - [ ] 6.1 Show scene and title frames
    - Fade in above the scene text, or appear without a fade under reduced motion. Empty `alt` for decorative frames. No reserved space when absent. Never shift the action list or input.
    - _Requirements: 10.2, 14.1, 17.1, 17.2, 17.6_
  - [ ] 6.2 Add the Pictures setting
    - Off, packs only, live. The player can lower but not raise above the configured mode. Applies from the next scene.
    - _Requirements: 1.7_
  - [ ] 6.3 Add hide-this-picture and Frame_Reports
    - `POST /api/frames/:key/report`, stored beside the cache, and resolved around thereafter.
    - _Requirements: 17.3_
  - [ ] 6.4 Write the property test that hidden pictures stay hidden
    - **Property 27: Hidden pictures stay hidden**
    - **Validates: Requirements 17.3**
  - [ ] 6.5 Add the credits panel
    - `GET /api/frames/credits` lists models and licences of pictures shown this game.
    - _Requirements: 17.4_
  - [ ] 6.6 Add scene-specific Inspector checks and scene composer snapshots
    - Face prominence, time of day, weather and place type for scenes. Snapshot the composed prompt per shipped style.
    - _Requirements: 14.5, 3.1_
  - [ ] 6.7 Checkpoint: the page is complete for scenes
    - Page tests pass. Web-shell tasks 8.1 and 8.2 ticked.

- [ ] 7. Darkroom and Frame_Packs
  - [ ] 7.1 Add the Model_Licence_Registry
    - Commit `config/image-model-licences.yaml` with each model's licence and a shippable flag. Start with FLUX.2 klein 4B and Z-Image-Turbo marked as Apache 2.0, and have the owner confirm each entry. Mark FLUX.2 klein 9B and FLUX.2 dev as not shippable. *(asks you first before marking any model shippable)*
    - _Requirements: 12.3_
  - [ ] 7.2 Define the pack manifest and loader
    - Verify hashes, reviewer stamps, licences, `forPacks` and fallback rules.
    - _Requirements: 12.1, 12.2, 12.4, 12.5_
  - [ ] 7.3 Write the property test for pack loader refusals
    - **Property 20: Pack loader refusals**
    - **Validates: Requirements 12.2, 12.3, 12.4, 12.5**
  - [ ] 7.4 Build `frames plan` and `frames render`
    - Enumerate requests with the game's own builder and composer. Render candidates with different seeds through the live path. Write only to `frame-drafts/`. Resumable. Refuse unshippable or unreported models.
    - _Requirements: 13.1, 13.2, 13.3, 13.6, 13.7, 13.8_
  - [ ] 7.5 Write the property test that the Darkroom never promotes unreviewed pictures
    - **Property 24: Darkroom never promotes unreviewed pictures**
    - **Validates: Requirements 13.3, 13.5, 13.6**
  - [ ] 7.6 Write the property test that the Darkroom resumes
    - **Property 25: Darkroom resumes**
    - **Validates: Requirements 13.7**
  - [ ] 7.7 Build `frames sheet` and `frames promote`
    - A local Contact_Sheet per city for choosing, rejecting and writing notes. Promotion copies only chosen pictures and stamps the reviewer. Run Frame_Notes through the visual-style lints.
    - _Requirements: 13.4, 13.5, 18.4_
  - [ ] 7.8 Add Base_Plate and Derived_Variant rendering
    - Where a provider can edit, derive other phases, seasons and weathers from the Base_Plate. Otherwise render from text with the same seed.
    - _Requirements: 14.2_
  - [ ] 7.9 Make the first pack for Vienna *(asks you first: the owner reviews and signs off every picture)*
    - Run `plan`, `render`, `sheet`, `promote` on the Reference Machine. Do not commit image files.
    - _Requirements: 12.1, 13.5_
  - [ ] 7.10 Checkpoint: packs work end to end
    - A fake-provider Darkroom run produces a pack that the game loads and shows.

- [ ] 8. Portraits, press, moments and the living-world bridge
  - [ ] 8.1 Show portraits
    - In the People view and the Dossier view. The caption is the descriptor. After identification the portrait carries over unchanged. A Dossier shows "no photograph on file" until then.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 17.2, 17.5_
  - [ ] 8.2 Add the portrait Inspector checklist
    - Exactly one person, consistent with the descriptor.
    - _Requirements: 15.6_
  - [ ] 8.3 Build Press_Photos
    - `buildPressRequest` from a story's public fields, headline as caption, shown in the newspaper view.
    - _Requirements: 16.1, 16.2, 16.3, 17.5_
  - [ ] 8.4 Build Moments
    - `buildMomentRequest` from the action kind on a committed turn, never the outcome. Register Moment_Motifs and lint them. Show beside Fact Lines, never in place of one.
    - _Requirements: 16.4, 16.5, 16.6_
  - [ ] 8.5 Write the property test for press and moment inputs
    - **Property 26: Press and Moment inputs are public**
    - **Validates: Requirements 16.1, 16.2, 16.4**
  - [ ] 8.6 Add the living-world bridge
    - Offer a pack picture's Frame_Notes to living-world as Texture details with source `frame`. Allow up to 4 released Texture details into a live scene request. Never write to the Texture_Ledger.
    - _Requirements: 18.1, 18.2, 18.3_
  - [ ] 8.7 Write the property test for texture isolation
    - **Property 29: Texture isolation**
    - **Validates: Requirements 18.2, 18.3**
  - [ ] 8.8 Checkpoint: all kinds work on fakes

- [ ] 9. Measurement and release
  - [ ] 9.1 Build `frames eval`
    - Report failure rates, rejection rates, render times and attempts per kind and city. Write the blind-review sample as a Contact_Sheet.
    - _Requirements: 19.1, 19.2_
  - [ ] 9.2 Add the release-gate checker
    - Encode the gate thresholds. Refuse to list a kind as enabled unless its report passes.
    - _Requirements: 19.3, 19.5_
  - [ ] 9.3 Run the two-hour live session test *(asks you first: it needs the Reference Machine)*
    - Compare swap, and the 95th-percentile time to first released sentence, with frames on and off.
    - _Requirements: 19.4_
  - [ ] 9.4 Write the documentation
    - `docs/frames.md`: setup per provider, `frames doctor`, the Darkroom, licences, privacy and the controls. Update `docs/web-shell.md` and the README.
    - _Requirements: 20.5_
  - [ ] 9.5 Enable a kind *(asks you first: enabling any kind in shipped config needs the owner)*
    - Only after its report passes and the owner approves.
    - _Requirements: 19.5, 1.2_
  - [ ] 9.6 Final checkpoint
    - `pnpm run check` adds no new failures. Every golden replay, the calibration sample and the web-shell parity test pass unchanged.
