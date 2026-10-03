# Requirements Document

## Introduction

The vertical-slice spec (`.kiro/specs/tradecraft/`) is complete at component level: every module exists, is unit and property tested, and `pnpm run check` is green. An audit found that the components are not assembled into a playable game. The Turn Pipeline advances the clock without its day-boundary hooks, the Station loop and end detection never run, three action kinds return "not implemented", the facade's `newGame`, saves and `validateFeed` are stubs, the live dialogue seams bypass the Prompt Builder and the real Claim Extractor, there is no TUI application shell, and `config/models.yaml` names out-of-date models.

This spec closes exactly those gaps. It adds no new game mechanics. Every slice requirement and slice Properties 1–33 keep holding. References of the form "Slice Req N.M" point at `.kiro/specs/tradecraft/requirements.md`.

The slice's hard constraints carry over unchanged:

- The deterministic Sim owns all ground truth. Models never create, change or reveal facts.
- The same seed and inputs produce the same World State. Golden replays in `packages/evals/replays/` are re-recorded once, through `packages/evals/scripts/record-golden.ts`, when behaviour changes.
- Dependency boundaries in `.dependency-cruiser.cjs` hold: `tui` imports only `@tradecraft/player-view`, `engine` does not import `player-view`, and `content` imports only `zod` and `yaml`.
- Only spec files import `vitest` (the nx dependency-checks lint rule).

The final checkpoint of this spec is slice task 24, the playtest. The follow-on specs (content-expansion, plot-library, ambient-world, campaign-career, multi-city) depend on this spec, because they extend a game loop that this spec assembles.

## Glossary

- **Sim**: The deterministic engine (`@tradecraft/engine`). It alone reads and writes ground truth (as in the slice glossary).
- **World State**: The engine's immutable game state, including the Truth Store and PRNG state.
- **Turn Pipeline**: The `player-view` driver (`turn-pipeline.ts`) that runs each `act`, `say`, `endScene` and `retry` as one Turn Transaction.
- **Turn Transaction**: The single commit of every state change produced by one player action or dialogue line (Slice Req 42).
- **Draft**: The World State value a Turn Transaction builds before commit. Committing swaps the Draft in; discarding it leaves the pre-turn state.
- **Phase Step**: The per-phase work the Turn Pipeline runs on the Draft for every phase a turn crosses: NPC schedule advancement, meeting-slot resolution, Cable replies, Directive checks, retainer decay, off-screen consequences and end detection.
- **Day Boundary**: The moment the clock enters phase 0 of a new day.
- **Day-Boundary Hooks**: The four hooks the clock runs at a Day Boundary, in `DAY_BOUNDARY_HOOK_ORDER`: Plot execution, schedules and Walk-ins, the Hostile tick, and the newspaper.
- **Hook Application**: The step that applies a hook's state changes (not only its events) to the Draft.
- **Hostile Full Tick**: The Hostile Service's complete daily tick (`dailyTickFull` in `hostile.ts`), covering detection, responses, mole reports, Dangles and Walk-ins, feed ingestion, adaptation, tailing and burn decisions, newspaper plants and comms traffic.
- **Disruption Context**: The predicates Plot execution reads to decide whether a stage is disrupted (`DisruptionContext` in `clock/plot-execution.ts`).
- **Objective Evaluator**: The function the Directive check calls to decide whether a Directive objective is met (`ObjectiveEvaluator` in `station/directives.ts`).
- **End Condition**: A win or loss decided by `detectEnd` or an arrest, written to `WorldState.ended`.
- **Outcome Record**: The versioned end-of-game record (Slice Req 35).
- **Engine API**: The `player-view` facade (`engine-api.ts`), the only surface the TUI uses.
- **Game View**: The value `newGame` and `saves.load` return: the status, the seed, the Difficulty Preset and the Starting Brief Cable.
- **Save Info**: The listing entry for one save: name, seed, Difficulty Preset, day and phase, save time and whether its Content Manifest matches.
- **Feed Error**: One feed validation failure, carrying the item index, the field and the reason.
- **Saves Directory**: The directory where named save files live, beside the Outcome Records directory.
- **Talk Scene**: The open conversation between the player and one NPC, held as `player.scene` in the World State.
- **Prompt Builder**: The dialogue module (`prompt-builder.ts`, `buildPrompt`) that assembles an NPC prompt from the NPC's persona, Agenda, Cover Story, Knowledge Slice, Told List, relationship summary and recent turns.
- **Claim Extractor**: The dialogue module (`dialogue/extract`) that turns an NPC utterance into schema-valid Claims through the `bookkeeping` role.
- **Live Seams**: The classify, voice, narrate and extraction seams that connect the Turn Pipeline to the LLM Gateway through the dialogue package.
- **Fake Seams**: Model-free implementations of the four seams with scripted, deterministic outputs.
- **Composition Root**: The single module that constructs the LLM Gateway, the Live Seams, the Turn Pipeline and the Engine API, and hands the Engine API to a client. It lives outside `tui`.
- **App Shell**: The TUI component that owns screen routing, the key map and the streaming of turn chunks into the screens.
- **Launcher**: The process started by `pnpm play`. It runs config validation and Model Manager startup, then the Composition Root and the App Shell.
- **Model Manager**: The `llm` component that connects to LM Studio, runs the preflight and loads the active profile (Slice Req 43).
- **Load Identifier**: The stable name a model is loaded under in LM Studio. It is also the model string the Gateway sends to the endpoint (Slice Req 43.7).
- **Model Source**: The LM Studio download key of a model build, as distinct from its Load Identifier.
- **Context Length**: The token context the Model Manager loads each model with.
- **Scripted Full Game**: An automated test that plays a complete game from a fixed seed through the real Turn Pipeline and Engine API with Fake Seams.
- **Golden Replay**: A recorded session in `packages/evals/replays/` that CI replays and checks for an identical final state.
- **Playtest**: Slice task 24: full campaigns on three fixed seeds, played by the developer.

## Requirements

### Requirement 1: Per-Phase Step in the Turn Transaction

**User Story:** As a player, I want the city to keep moving phase by phase while I act, so that people go where their schedules take them, meetings happen, and HQ answers my Cables.

Closes gaps 1 and 2. Completes Slice Req 3.5, 24.2, 24.3, 27.3, 27.4, 27.5, 28.4, 39.3 and 39.5.

#### Acceptance Criteria

1. WHEN a turn's clock advance crosses one or more phases, THE Turn Pipeline SHALL run the Phase Step on the Draft once for each phase entered, in time order.
2. WHEN the Phase Step runs, THE Turn Pipeline SHALL advance NPC schedules from the previous phase to the entered phase with `advanceSchedules` and write the resulting NPC positions to the Draft.
3. WHEN the Phase Step enters the slot of an accepted meeting, THE Turn Pipeline SHALL resolve the meeting with `resolveMeetingAtSlot` and apply the resulting trust change, meeting status and events to the Draft.
4. WHEN `resolveMeetingAtSlot` opens a talk scene, THE Turn Pipeline SHALL end the clock advance at that slot, open the Talk Scene with that NPC at commit, and report the phases actually spent in the turn's result.
5. WHEN the Phase Step runs, THE Turn Pipeline SHALL call `processDueCables` and apply the returned pending Cables, ledger credits, Standing change and Cable Documents to the Draft.
6. WHEN the Phase Step runs, THE Turn Pipeline SHALL call `checkDirectives` with the Objective Evaluator and apply the returned Directives, Standing and events to the Draft.
7. WHEN the Phase Step runs, THE Turn Pipeline SHALL apply retainer decay to every money-motivated Asset whose retainer is overdue past the grace period.
8. WHEN the Phase Step runs, THE Turn Pipeline SHALL raise the player-visible consequence events of hidden events (meeting no-shows, unserviced player Dead Drops, Assets gone silent, retainers falling due) as Slice Req 39.5 specifies.
9. THE Turn Pipeline SHALL include every event produced by the Phase Step in the turn's event list, so that the turn delivers the events as Notifications at commit in event-time order.
10. WHEN a turn costs zero phases, THE Turn Pipeline SHALL run no Phase Step.

### Requirement 2: Day-Boundary Hooks Wired with State Application

**User Story:** As a player, I want the Plot, the Hostile Service and the newspaper to advance every day, so that the hostile operation moves whether or not I act.

Closes gap 1. Completes Slice Req 3.2, 3.3, 3.6, 21.6, 22.7, 30.2 and 12.2.

#### Acceptance Criteria

1. WHEN a turn's clock advance crosses a Day Boundary, THE Turn Pipeline SHALL pass the four Day-Boundary Hooks to `advance` and run them in `DAY_BOUNDARY_HOOK_ORDER`.
2. WHEN a Day-Boundary Hook runs, THE Turn Pipeline SHALL apply the hook's state changes to the Draft through Hook Application before the next hook runs, so that each hook reads the state left by the hooks before it.
3. WHEN the Plot hook runs, THE Turn Pipeline SHALL write the updated Plot state, the emitted trace events, and any Transmissions and Intercepts minted by transmission traces to the Draft.
4. WHEN the schedules hook runs, THE Turn Pipeline SHALL write any Walk-in it produces to the Draft, including the Contact Channel the Walk-in creates with the Station.
5. WHEN the newspaper hook runs, THE Turn Pipeline SHALL publish the day's newspaper edition as a Document in the Draft, obtainable at the Locations the Document Generator names, and SHALL emit the player-visible `newspaper` event.
6. WHEN a Day Boundary is crossed, THE Turn Pipeline SHALL set the new day's weather from the daily stream and the city weather tables, and SHALL carry that weather in the `day-start` event.
7. WHEN a turn crosses more than one Day Boundary, THE Turn Pipeline SHALL run the full hook sequence once per Day Boundary, in day order.
8. THE Phase Step for phase 0 of a day SHALL run after that day's Day-Boundary Hooks.

### Requirement 3: Hostile Service Full Tick

**User Story:** As a player, I want the opposition to hunt my network every day, so that careless tradecraft can get my Assets arrested and get me burned.

Closes gap 1. Completes Slice Req 11.2, 11.5, 12.2, 12.3, 12.4, 12.5, 29.4, 37.3, 37.4, 37.5 and 39.5.

#### Acceptance Criteria

1. WHEN the Hostile hook runs, THE Turn Pipeline SHALL run the Hostile Full Tick (`dailyTickFull`) on the Draft instead of the events-only tick.
2. WHEN the Hostile Full Tick decides tailing, THE Turn Pipeline SHALL write `player.tailed` to the Draft.
3. WHEN the Hostile Full Tick changes Cover Suspicion, THE Turn Pipeline SHALL write `player.coverSuspicion` to the Draft.
4. IF Cover Suspicion exceeds the Difficulty Preset's burn threshold after the Hostile Full Tick, THEN THE Turn Pipeline SHALL mark the player burned and write a burned End Condition to the Draft.
5. WHEN the Hostile Full Tick runs, THE Turn Pipeline SHALL supply it with the turned-agent feeds due that day, taken from the recorded `feed-delivered` events, and SHALL write the resulting Hostile Service beliefs, agent credibility and agent suspicion to the Draft.
6. WHERE a mole is enabled, THE Turn Pipeline SHALL supply the Hostile Full Tick with the mole's report input built from the player's Case File summary and Cables, and SHALL write the resulting beliefs to the Draft.
7. WHEN the Hostile Full Tick produces arrests, doublings or Asset feeds of the player's Assets, THE Turn Pipeline SHALL write the changed Asset and Relationship records to the Draft.
8. WHEN the Hostile Full Tick produces newspaper plants, THE Turn Pipeline SHALL make the plants available to the same day's newspaper hook.
9. WHEN the Hostile Full Tick produces comms traffic, THE Turn Pipeline SHALL append the Transmissions and Intercepts to the Draft so that the intercept action can collect them.
10. WHEN the Hostile Full Tick produces off-screen consequences, THE Turn Pipeline SHALL record the hidden events and their player-observable consequences in the Draft, delivering a Notification only for the consequence (Slice Req 39.4, 39.5).
11. WHEN the Hostile Full Tick adopts beliefs, THE Turn Pipeline SHALL apply the belief-driven adaptation rules and Abort Pressure to the Draft's Plot state.

### Requirement 4: Live Disruption Context

**User Story:** As a player, I want my arrests, seizures and blown enemy channels to actually disrupt the Plot, so that disruption is a winnable path.

Closes gap 1. Completes Slice Req 3.4, 3.7, 38.2, 38.3 and 38.4.

#### Acceptance Criteria

1. WHEN the Plot hook runs, THE Turn Pipeline SHALL build the Disruption Context from the Draft's current state.
2. THE Disruption Context SHALL report an NPC as arrested or fled when the Draft records that NPC as arrested by the Station, in Station Custody, or fled.
3. THE Disruption Context SHALL report a Channel as compromised when the Draft's Hostile Service beliefs list it in `compromisedChannels`.
4. THE Disruption Context SHALL report a delivery as seized when the Draft records its materiel as seized from a hostile Dead Drop or from an arrested carrier.
5. WHEN a disruption, a belief adoption or the daily tick changes the Plot state, THE Turn Pipeline SHALL run `abortCheck` on the Draft and, on a trigger, apply the abort and write a success End Condition.

### Requirement 5: Hook Determinism and Atomicity

**User Story:** As the developer, I want day-boundary processing to be deterministic and transactional, so that saves, replays and failure recovery stay exact.

Closes gap 1. Completes Slice Req 1.2, 17.4, 29.5, 42.1 and 42.4.

#### Acceptance Criteria

1. THE Turn Pipeline SHALL draw every random value used by the Phase Step and the Day-Boundary Hooks from a named PRNG stream: the daily stream for that day for weather, newspaper selection and Walk-ins, and the runtime stream carried in the Draft for all other draws.
2. FOR ALL World States and turns, running the same turn twice from the same pre-turn state SHALL produce deep-equal post-turn World States, event lists and Notifications.
3. THE Turn Pipeline SHALL apply every Phase Step and Hook Application change to the Draft only, so that the committed World State changes only at commit.
4. IF a turn fails before commit, THEN THE Turn Pipeline SHALL discard every Phase Step and Hook Application change together with the rest of the Draft, leaving the World State, PRNG state, action log, Journal and Notifications at their pre-turn values.
5. FOR ALL recorded sessions, replaying the seed, action log and recorded model responses SHALL reach a final World State deep-equal to the original, including every Day-Boundary Hook effect.
6. THE Phase Step and the Day-Boundary Hooks SHALL read no wall-clock time, file, environment variable or model output.

### Requirement 6: Directive Objective Evaluator

**User Story:** As a player, I want my Chief's Directives to be judged on what I have actually achieved, so that Standing rewards my real work without revealing hidden truth.

Closes gap 2. Completes Slice Req 27.2 and 27.3.

#### Acceptance Criteria

1. THE Turn Pipeline SHALL supply `checkDirectives` with an Objective Evaluator for every Directive objective kind in the fixed objective enum.
2. THE Objective Evaluator SHALL decide `identify` and other knowledge objectives only from Case File and Player View data.
3. THE Objective Evaluator SHALL decide `recruit`, `arrest` and `intercept` objectives from the Sim's record of the player's own completed actions (recruited Assets, granted arrests, collected Intercepts).
4. WHEN a Directive is met or its deadline passes, THE Turn Pipeline SHALL apply the Standing change and deliver the resulting Cable as a Notification in the same Turn Transaction.
5. FOR ALL Case Files and World States, modifying the Truth Store without changing the player's recorded actions SHALL leave the Objective Evaluator's result for knowledge objectives unchanged.

### Requirement 7: End Detection and Outcome Record

**User Story:** As a player, I want the game to end when the Plot completes, when I disrupt it, or when I am burned, so that every campaign reaches an outcome and a debrief.

Closes gap 3. Completes Slice Req 13.7, 19.3, 19.4, 19.5, 35.1, 35.2, 35.3 and 38.6.

#### Acceptance Criteria

1. WHEN a turn's simulation finishes, THE Turn Pipeline SHALL call `detectEnd` on the Draft before commit and, on a result, write the End Condition to `WorldState.ended`.
2. WHEN the Plot completes its final stage, THE Turn Pipeline SHALL write a failure End Condition with the Plot-completion cause.
3. WHEN the player is burned, THE Turn Pipeline SHALL write a failure End Condition with the burned cause.
4. WHEN the Plot aborts or the Cell leader is arrested, THE Turn Pipeline SHALL write a success End Condition naming the cause.
5. WHEN an End Condition is written within a multi-phase turn, THE Turn Pipeline SHALL stop the clock advance at the phase where the End Condition arose.
6. WHEN a turn commits a new End Condition, THE Turn Pipeline SHALL build the Outcome Record with `buildOutcomeRecord`, write the Outcome Record with `writeOutcomeRecord` exactly once for that game, and stream an `ended` chunk.
7. WHILE `WorldState.ended` is set, THE Engine API SHALL report every action as disallowed with an ended reason and SHALL accept no dialogue line.
8. FOR ALL World States, `detectEnd` SHALL report an End Condition if and only if the Plot is completed, the Plot is aborted, the Cell leader has been arrested, or the player is burned.

### Requirement 8: Decrypt Action

**User Story:** As a player, I want to submit a key or plaintext on the Workbench and have broken traffic land in my Case File, so that signals work leads to evidence.

Closes gap 4. Completes Slice Req 9.5.

#### Acceptance Criteria

1. WHEN the player quotes `decrypt` for a collected Intercept, THE Sim SHALL return an allowed quote with the decrypt phase and money cost.
2. IF the player quotes `decrypt` for an Intercept the player has not collected, THEN THE Sim SHALL return a disallowed quote with a reason.
3. WHEN the player resolves `decrypt`, THE Sim SHALL verify the submission with `verifySubmission`.
4. WHEN verification succeeds, THE Turn Pipeline SHALL add each recovered Proposition to the Case File as a Claim with source "intercept" through the intercept-claims module, and SHALL mark the Intercept broken.
5. IF verification fails, THEN THE Sim SHALL return a failure Fact Line that reveals nothing about the correct key or plaintext, and SHALL add no Claim.
6. WHEN the player resolves `decrypt` again on a broken Intercept, THE Turn Pipeline SHALL leave the Case File unchanged.

### Requirement 9: Cable Action

**User Story:** As a player, I want to send trace, funds and report Cables to HQ, so that the Station supports my investigation.

Closes gap 4. Completes Slice Req 27.4 and 27.5.

#### Acceptance Criteria

1. WHEN the player quotes `cable` with a trace, funds or report request, THE Sim SHALL return an allowed quote with the Cable's phase and money cost.
2. IF the player quotes a trace Cable about an entity outside the player's known set, THEN THE Sim SHALL return a disallowed quote with a reason.
3. WHEN the player resolves `cable`, THE Sim SHALL submit the request with `submitCable` and add the resulting pending Cable to the Draft.
4. WHEN the pending Cable's reply falls due, THE Phase Step SHALL deliver the reply as specified in Requirement 1.5.

### Requirement 10: Task Action

**User Story:** As a player, I want to task my Assets to collect, introduce, service drops and plant information, so that I can run a network rather than doing everything myself.

Closes gap 4. Completes Slice Req 10.3, 10.4, 10.6, 22.6 and 24.6.

#### Acceptance Criteria

1. WHEN the player quotes `task` for a recruited Asset with a Contact Channel, THE Sim SHALL return an allowed quote with the task's phase and money cost.
2. IF the player quotes `task` for an NPC who is not the player's Asset or has no Contact Channel, THEN THE Sim SHALL return a disallowed quote with a reason that does not depend on the Truth Store.
3. WHEN the player resolves a `collect` task, THE Sim SHALL run `runAssetTask`, and THE Turn Pipeline SHALL add the reported Propositions to the Case File as Claims with source "npc" naming the Asset.
4. WHEN the player resolves an `introduce` task, THE Sim SHALL create a Contact Channel to the target with the starting trust `runAssetTask` returns.
5. WHEN the player resolves a `service` task, THE Sim SHALL apply the drop's lifted and left items to the Draft as the Asset's servicing.
6. WHEN the player resolves a `plant` task, THE Sim SHALL apply the planted Proposition to the Draft as `runAssetTask` returns.
7. WHEN the player resolves any task, THE Sim SHALL increase the Asset's Exposure by the tasking risk.

### Requirement 11: Every Action Kind Resolvable

**User Story:** As a player, I want every action the interface offers to actually work, so that no option ends in "not implemented".

Closes gap 4. Completes Slice Req 13.1 and 13.2.

#### Acceptance Criteria

1. THE Sim SHALL implement `quote` and `resolve` for every action kind in the `Action` union.
2. THE Sim SHALL remove `notImplementedQuote` and `OWNED_BY` once no action kind uses them.
3. FOR ALL World States and actions, `quote` SHALL return an `ActionQuote` without throwing, and a disallowed quote SHALL carry a reason.
4. FOR ALL World States and allowed actions, `resolve` SHALL return a result without throwing and SHALL apply exactly the quoted phase and money cost (slice Property 16).

### Requirement 12: New Game Through the Facade

**User Story:** As a player, I want to start a new game from the start screen, so that I can choose a seed, difficulty, mole setting and narration mode and receive my Starting Brief.

Closes gap 5. Completes Slice Req 1.1, 1.6, 26.1, 26.4, 34.3 and 41.1.

#### Acceptance Criteria

1. WHEN the player calls `newGame` with a seed, preset, mole setting and narration mode, THE Engine API SHALL generate the world from the loaded Content Set and validated scenario config and return a Game View containing the Starting Brief Cable.
2. WHEN the player calls `newGame` without a seed, THE Engine API SHALL generate a seed and include it in the returned Game View.
3. WHEN `newGame` completes, THE Engine API SHALL reset the Case File, Journal, Notifications, action log, extraction queue and paused-turn state to those of the new game.
4. WHEN `newGame` completes, THE Engine API SHALL seed the Case File with the Starting Brief's lead Claims.
5. FOR ALL seeds and presets, calling `newGame` twice with the same inputs SHALL produce deep-equal World States.

### Requirement 13: Saves Through the Facade

**User Story:** As a player, I want to save and load named games, so that I can stop and resume a campaign.

Closes gap 5. Completes Slice Req 13.9, 17.1, 17.2 and 31.6.

#### Acceptance Criteria

1. WHEN the player calls `saves.save(name)`, THE Engine API SHALL build a snapshot with `saveSnapshot` and write it as one file in the Saves Directory, returning its Save Info.
2. WHEN the player calls `saves.list()`, THE Engine API SHALL return the Save Info of every save file in the Saves Directory, with `manifestMatches` computed against the loaded Content Manifest.
3. WHEN the player calls `saves.load(name)` for a save whose Content Manifest matches, THE Engine API SHALL restore the World State, Case File, Journal, Notifications, action log and extraction queue with `parseAndLoad`.
4. IF the selected save's Content Manifest differs from the loaded one, THEN THE Engine API SHALL return a `manifest-mismatch` error naming the differing packs and versions from `diffManifests` and leave the current game unchanged.
5. IF a save file is unreadable, malformed or of an unsupported version, THEN THE Engine API SHALL return a `corrupt` or `version` error and leave the current game unchanged.
6. IF the save name contains a path separator, a parent-directory segment or a character outside the allowed save-name set, THEN THE Engine API SHALL reject the save with an error and write nothing.
7. THE Engine API SHALL write a save file atomically, so that an interrupted save leaves any earlier file of the same name intact.
8. FOR ALL reachable game states, saving through the Engine API and then loading the save SHALL restore a game whose World State, Case File, Journal, Notifications and action log deep-equal those at the save.
9. FOR ALL reachable game states, continuing play after a load SHALL produce the same subsequent states as continuing play without the save and load.

### Requirement 14: Feed Validation Through the Facade

**User Story:** As a player, I want the feed composer to tell me exactly what is wrong with a feed, so that I can fix it before sending it through a turned agent.

Closes gap 5. Completes Slice Req 37.1 and 37.2.

#### Acceptance Criteria

1. WHEN the player calls `validateFeed`, THE Engine API SHALL validate the items with the engine feed rules (1–3 items, known-set entities, `unk:` ids resolved through held IS_ALIAS_OF Claims, the derived per-predicate schema, and windows within the next 7 days).
2. IF any item fails validation, THEN THE Engine API SHALL return one Feed Error per failure carrying the item index, the field and the reason.
3. THE Engine API SHALL decide feed validity only from Player View and Case File data.
4. FOR ALL feed item lists, `validateFeed` SHALL return ok if and only if `quote` for the matching `feed` action is not disallowed on feed-content grounds.

### Requirement 15: Talk Scene State and Dialogue Turn Effects

**User Story:** As a player, I want what I say to the person in front of me to change how they treat me, so that rapport, pitches and pressure are real.

Closes gap 6. Completes Slice Req 4.1, 4.3, 4.4, 10.2, 10.3, 10.5, 22.4, 24.2 and 28.5.

#### Acceptance Criteria

1. WHEN an action result carries an `openScene` request, THE Turn Pipeline SHALL set the Talk Scene in the Draft to that NPC at commit.
2. THE Talk Scene SHALL hold the NPC id, the scene's stakes, and the recent turns of the conversation.
3. WHEN the player calls `endScene`, THE Turn Pipeline SHALL clear the Talk Scene at commit.
4. IF the player calls `say` with no open Talk Scene, THEN THE Engine API SHALL reject the line without a model call or a state change.
5. WHEN a dialogue line is classified, THE Turn Pipeline SHALL apply `applyIntent` to the player's Relationship with the scene's NPC in the Draft before the reply streams.
6. WHEN the classified Intent is a pitch, THE Turn Pipeline SHALL resolve recruitment with `resolvePitch` on the Draft's runtime PRNG, and on success SHALL make the NPC an Asset.
7. WHERE the player attaches an offered amount to a money pitch, THE Turn Pipeline SHALL scale the pitch by that amount and debit the Budget by that amount.
8. IF a pitch fails badly, THEN THE Turn Pipeline SHALL raise the NPC's suspicion and apply the Hostile Service report the pitch rules specify.
9. WHEN the scene is high-stakes (interrogation, recruitment pitch, or confronting a suspected Double Agent), THE Turn Pipeline SHALL route the reply to the `voice` role, and otherwise to the `fast` role.
10. THE `speech` chunks of a dialogue turn SHALL name the scene's NPC by the player-facing name the namer gives (name if known, descriptor otherwise).
11. WHEN a dialogue turn commits, THE Turn Pipeline SHALL enqueue the extraction job with the scene NPC's id as the speaker.

### Requirement 16: Prompt Builder in Live Dialogue

**User Story:** As a player, I want NPCs to answer in character from what they actually know, so that conversations are believable and secrets stay contained.

Closes gap 6. Completes Slice Req 4.1, 4.5, 5.1, 6.2, 6.3, 15.1 and 15.2.

#### Acceptance Criteria

1. THE dialogue package SHALL export `buildPrompt` from its public index.
2. WHEN the voice seam runs, THE Live Seams SHALL build the NPC prompt with `buildPrompt` from the scene NPC's persona, Agenda, Cover Story, Knowledge Slice, Told List, relationship summary and the Talk Scene's recent turns.
3. THE Live Seams SHALL place the player's line in the user role only.
4. THE Live Seams SHALL check the reply with the Leak Guard against the scene NPC's known-entity set, retry with a stricter instruction up to the configured limit, and substitute a persona deflection line when retries are exhausted.
5. THE Live Seams SHALL keep each NPC prompt within the scenario's token budget.
6. FOR ALL NPCs and states, every Proposition rendered into the live voice prompt SHALL belong to the union of the NPC's known Propositions, false beliefs, Cover Story, Told List and Agenda promote list (slice Property 5).

### Requirement 17: Real Claim Extraction

**User Story:** As a player, I want what NPCs tell me to appear in my Case File as precise Claims, so that I can grade and cross-reference sources.

Closes gap 6. Completes Slice Req 5.6, 6.1, 6.5, 7.1, 7.2, 7.3 and 7.5.

#### Acceptance Criteria

1. THE Live Seams SHALL run extraction jobs with the dialogue Claim Extractor on the `bookkeeping` role, replacing the simplified extraction runner.
2. WHEN an extraction result commits, THE Turn Pipeline SHALL write the Claim truth records to the Truth Store, update the speaker's Told List, and add the Claims to the Case File without truth values, as one transaction at the turn boundary.
3. IF extraction output fails schema validation after the configured retry, THEN THE Turn Pipeline SHALL attach the raw utterance to the Case File as an unparsed note.
4. WHEN an extracted Claim matches a concealed Proposition the speaker does not know, THE Turn Pipeline SHALL log a chance leak for evaluation.
5. WHEN extracted Claims contradict the speaker's Told List without a cover-state change, THE Turn Pipeline SHALL log a consistency violation for evaluation.
6. WHILE the extraction endpoint is unreachable, THE Turn Pipeline SHALL keep the job queued and continue accepting player input.

### Requirement 18: Composition Root

**User Story:** As the developer, I want one place that assembles the gateway, dialogue and player-view into a running game, so that the real game, the REPL and the evals all run the same wiring.

Closes gap 6. Completes Slice Req 13.5 and 17.3.

#### Acceptance Criteria

1. THE Composition Root SHALL construct the LLM Gateway, the Live Seams, the Turn Pipeline and the Engine API from validated `config/models.yaml` and `config/scenario.yaml`.
2. THE Composition Root SHALL live in a package other than `tui`, and THE `tui` package SHALL continue to import only `@tradecraft/player-view`.
3. THE Composition Root SHALL accept injected seams, so that a caller can supply Fake Seams or replay-mode seams in place of the Live Seams.
4. WHERE the Gateway runs in record mode or replay mode, THE Composition Root SHALL construct the Live Seams over that Gateway.
5. THE `pnpm repl` command and the evaluation harness SHALL obtain their Engine API and seams from the Composition Root.
6. THE `.dependency-cruiser.cjs` rules SHALL admit the Composition Root's package and its imports while keeping every existing boundary rule.

### Requirement 19: TUI App Shell

**User Story:** As a player, I want a terminal application that moves between the start screen, the scene, the Case File and the other views, so that I can play the whole game from the keyboard.

Closes gap 7. Completes Slice Req 13.2, 13.3, 13.4, 13.6, 13.7, 13.8, 13.9, 13.10, 26.4, 26.5, 26.6 and 33.1–33.4.

#### Acceptance Criteria

1. THE App Shell SHALL take an Engine API as its only game dependency.
2. WHEN the App Shell starts, THE App Shell SHALL show the start screen, and WHEN the player confirms, THE App Shell SHALL call `newGame` and show the Starting Brief Cable followed by the offer of an in-person briefing with the Chief of Station.
3. THE App Shell SHALL route between the scene, Here and action menu, Case File, Documents, Workbench, Journal, Map, People, help overlay, feed composer and save/load screens through a documented key map.
4. WHEN a turn streams, THE App Shell SHALL render each `fact`, `flavour` and `speech` chunk in the scene as it arrives, with Fact Lines and Flavour in their distinct styles.
5. WHEN an `interrupted` chunk arrives, THE App Shell SHALL remove the Flavour and speech shown for the interrupted attempt.
6. WHEN a `paused` chunk arrives, THE App Shell SHALL show the endpoint error screen and offer retry and save-and-quit.
7. WHEN an `ended` chunk arrives, THE App Shell SHALL show the game-over screen, and WHEN the player opens the debrief, THE App Shell SHALL show the debrief screen.
8. WHILE a Talk Scene is open, THE App Shell SHALL send typed lines to `say` and offer an end-scene key.
9. WHEN a `notification` chunk arrives, THE App Shell SHALL add the Notification to the status bar alerts.
10. WHERE hints are enabled, THE App Shell SHALL show each hint the first time its trigger occurs.
11. THE App Shell SHALL accept no input that starts a new turn while a turn is streaming.

### Requirement 20: Playable Launcher

**User Story:** As a player, I want to type `pnpm play` and get a running game, so that I do not have to assemble anything by hand.

Closes gap 7. Completes Slice Req 14.3, 41.2, 43.1, 43.2 and 43.8.

#### Acceptance Criteria

1. THE repository SHALL provide a `pnpm play` script that starts the Launcher.
2. WHEN the Launcher starts, THE Launcher SHALL validate `config/scenario.yaml` and `config/models.yaml`, and IF either fails validation, THEN THE Launcher SHALL print each error with file and field path and exit with a non-zero status.
3. WHEN config validation passes, THE Launcher SHALL run `startModelManager` (connect, preflight, load the active profile) before the first model call.
4. IF Model Manager startup fails, THEN THE Launcher SHALL print each issue (server unreachable, missing models with their `lms get` commands, or insufficient memory) and exit with a non-zero status without starting the game.
5. WHEN Model Manager startup succeeds, THE Launcher SHALL build the Engine API through the Composition Root and render the App Shell.
6. WHERE the player passes a seed option to `pnpm play`, THE Launcher SHALL pass the seed to the start screen.

### Requirement 21: Model Configuration Update

**User Story:** As the developer, I want `config/models.yaml` to describe the models I actually run, so that the Model Manager loads the right builds under stable names.

Closes gap 8. Completes Slice Req 14.2, 14.5, 14.6, 18.3, 43.4 and 43.7.

#### Acceptance Criteria

1. THE default `config/models.yaml` SHALL define profile `gemma-voice` with Gemma 4 31B (dense) on `voice` and Qwen3.6 35B A3B (MoE) on `fast`, `narrator` and `bookkeeping`.
2. THE default `config/models.yaml` SHALL define profile `qwen-voice` with Qwen3.8 27B (dense) on `voice` and Gemma 4 26B A4B (MoE) on `fast`, `narrator` and `bookkeeping`.
3. THE default `config/models.yaml` SHALL set `active` to `gemma-voice`.
4. THE `gemma-voice` profile SHALL use the Load Identifiers `gemma-31b` for Gemma 4 31B and `qwen-moe` for Qwen3.6 35B A3B.
5. THE `qwen-voice` profile SHALL use one stable Load Identifier for Qwen3.8 27B and one for Gemma 4 26B A4B, each distinct from the `gemma-voice` identifiers.
6. THE models config SHALL record for each Load Identifier its Model Source, listing an MLX 4-bit build as preferred and a GGUF Q4_K_M build as fallback.
7. WHEN the Model Manager checks downloads, pulls or loads a model, THE Model Manager SHALL use the preferred Model Source when it is downloaded, the fallback otherwise, and SHALL load the model under its Load Identifier.
8. THE default `config/models.yaml` SHALL map the `judge` role of each profile to a model already resident in that profile that is not the profile's `voice` model.
9. THE default `config/models.yaml` SHALL pass validation, and every role's model string SHALL equal a Load Identifier the profile loads.

### Requirement 22: Context Length as Configuration

**User Story:** As the developer, I want the model context length set in config, so that preflight, loading and startup agree on it without ad-hoc arguments.

Closes gap 8. Completes Slice Req 43.3 and 43.4.

#### Acceptance Criteria

1. THE models config schema SHALL include a Context Length field, validated as a positive integer, with the default config setting 8192.
2. WHEN the Model Manager runs preflight, loads a profile or runs startup, THE Model Manager SHALL use the configured Context Length.
3. IF the Context Length field is invalid, THEN config validation SHALL report the field path and THE Launcher SHALL refuse to start.
4. THE `pnpm models:pull`, `pnpm repl`, `pnpm play` and evaluation harness entry points SHALL read the Context Length from config and take no separate context-length argument.

### Requirement 23: Scripted Full-Game Tests

**User Story:** As the developer, I want automated full games that reach every ending, so that I know the assembled loop works without a model or a human.

Closes gap 9. Completes Slice Req 17.4, 19.3, 19.4 and 19.5.

#### Acceptance Criteria

1. THE test suite SHALL include a Scripted Full Game that plays from a fixed seed through the Composition Root, the real Turn Pipeline and the Engine API with Fake Seams, and reaches a success ending by arresting the Cell leader.
2. THE test suite SHALL include a Scripted Full Game that reaches a failure ending by Plot completion.
3. THE test suite SHALL include a Scripted Full Game that reaches a failure ending by the player being burned.
4. WHEN a Scripted Full Game ends, THE test SHALL check that the `ended` chunk carries the expected outcome, that `views.debrief()` returns every debrief section, and that exactly one Outcome Record was written.
5. THE Scripted Full Games SHALL run in `pnpm run check` with no model endpoint and no network access.
6. THE repository SHALL include a Golden Replay of one full game from start to an ending, and CI SHALL replay the Golden Replay and check for a deep-equal final state.

### Requirement 24: Golden Replays and Checks After Integration

**User Story:** As the developer, I want the existing replays and checks to stay meaningful after wiring, so that integration does not silently change recorded behaviour.

Completes Slice Req 17.3, 17.4 and 31.5.

#### Acceptance Criteria

1. WHEN integration changes the final state a Golden Replay reaches, THE repository SHALL contain that Golden Replay re-recorded once through `packages/evals/scripts/record-golden.ts` against the integrated Turn Pipeline.
2. THE `pnpm run check` command SHALL pass typecheck, lint, the dependency-cruiser rules and all tests after integration.
3. FOR ALL slice Properties 1–33, THE property tests SHALL continue to pass after integration.
4. THE non-spec source files of every package SHALL import no `vitest` module.

### Requirement 25: Playtest Readiness

**User Story:** As the developer, I want everything slice task 24 needs to be in place, so that I can run the final playtest and choose the active profile from evidence.

Closes gap 9. Completes Slice Req 18.1, 18.3, 18.4 and 43.6.

#### Acceptance Criteria

1. THE repository SHALL provide a `pnpm evals --profile <name>` command that loads the named profile through the Model Manager, runs the evaluation harness fixtures, and writes the Markdown and CSV comparison report.
2. WHEN the evaluation harness runs a profile, THE harness SHALL report the judge model's identity, and THE harness SHALL warn when the judge model equals the voice model.
3. WHEN the evaluation harness switches between profiles, THE Model Manager SHALL unload the previous profile before loading the next.
4. THE README SHALL document `pnpm play`, `pnpm evals --profile <name>` and the saves location in its Commands section.
5. THE README Roadmap step 1 SHALL name the `slice-integration` spec.
