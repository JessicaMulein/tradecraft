# Requirements Document

## Introduction

This spec lets the player type ordinary language outside a conversation ("go back to the station", "follow the man in the grey coat", "cable HQ for money") and have it become **one legal action from the list the game is already offering**. The model never produces an action. It only chooses from a closed menu the Sim built, and the Sim validates the choice again before anything happens.

The spec is built on facts already in the codebase:

- `buildActionCatalogue` in `player-view` already enumerates every candidate action for the current situation, each paired with the engine's pure `quote` (allowed or disallowed with a reason). It reads only Player View data.
- The Intent Classifier already uses the `fast` role through the LLM Gateway's `structured` path, constrained to a closed enum and re-validated with the same schema (Slice Req 4.2, 14.4).
- The TUI may import only `player-view`, so a new capability for the TUI or the Web Shell must come through the `EngineApi` facade, with the model-facing code in `dialogue` wired in at the Composition Root.

All slice invariants hold unchanged:

- Model outputs never create, change or reveal facts (Slice Req 2.3). The interpreter's whole output is an identifier from a list the Sim wrote.
- The interpreter sees only Player View data, so it cannot reveal anything the player could not already see.
- Determinism holds: the save and the action log record the committed `Action`, never the typed text or the model call (Slice Req 1.2, 17.4).
- At most two models are resident (Slice Req 14.5). This spec uses the existing `fast` role.

Proposed implementation order: after the add-ons it should serve (it needs only the slice), and before `web-shell`'s page gains a command box. New actions from any add-on (for example `street-ops`) are picked up through the catalogue and a phrasebook content kind, with no interpreter change.

Out of scope: dialogue (free text inside a talk scene is still handled by the slice's Intent Classifier and `voice` role), voice input, multi-step plans in one input, and any model that writes prose.

## Glossary

Terms not listed here are defined in the slice glossary.

- **Command Text**: A line the player types outside a talk scene, or after the command escape inside one.
- **Candidate Menu**: The closed list of Offered Actions built for one interpretation, each with a per-call Candidate Id.
- **Candidate Id**: A short identifier (`c1`, `c2`, …) valid only for one interpretation.
- **Interpretation**: The result of interpreting Command Text: one of `resolved`, `ambiguous`, `needs-parameter`, `blocked` or `not-understood`.
- **Interpreter**: The component that turns Command Text into an Interpretation. It has a deterministic Matcher and an optional model step.
- **Matcher**: The deterministic first stage that matches Command Text to Candidates by name, alias and phrasebook entry.
- **Phrasebook**: Content that gives each action kind its verbs, synonyms and phrasings per locale and era.
- **Parameter Slot**: A free input that an Offered Action template needs (a pay amount, a cable report, a decrypt submission, a confront Claim).
- **Confirmation Gate**: The step that shows the interpreted action and its quote and waits for the player to confirm.
- **Command Escape**: The prefix (default `/`) that routes a line to the Interpreter while a talk scene is open.

## Requirements

### Requirement 1: Facade Method and Placement

**User Story:** As the developer, I want interpretation to come through the same facade as everything else, so that the TUI and the Web Shell get it without touching the engine or a model.

#### Acceptance Criteria

1. THE `EngineApi` SHALL gain a method `interpret(text)` that returns an Interpretation, and the TUI and the Web Shell SHALL use only that method.
2. THE model-facing code SHALL live in `dialogue` next to the Intent Classifier and SHALL be supplied to the facade through a seam, as the Turn Pipeline driver is, wired in the Composition Root.
3. WHEN no interpreter is supplied (for example in a test or with models disabled) THEN `interpret` SHALL use the Matcher alone.
4. THE `interpret` method SHALL NOT change the World State, advance the clock or consume Budget. Only `act` does.

### Requirement 2: A Closed Candidate Menu

**User Story:** As a player, I want the game to understand me only in terms of things I can do, so that it never acts on something that is not possible.

#### Acceptance Criteria

1. THE Interpreter SHALL build the Candidate Menu from `EngineApi.actions()` for the current state and SHALL contain no action that `actions()` did not return.
2. THE Interpreter SHALL put only Offered Actions whose quote is allowed into the model's menu, and SHALL keep disallowed ones for the deterministic explanation of Requirement 7.
3. EVERY Candidate SHALL carry its Candidate Id, its action kind, its player-facing label and its player-visible target names, all taken from Player View data.
4. THE Interpreter SHALL NOT include in any model input a Truth-branded value, a Knowledge Slice, a Case File grade, Journal text or any fact that the Candidate labels do not already show the player.
5. WHEN the number of Candidates exceeds the configured cap THEN THE Interpreter SHALL reduce the menu deterministically by the Matcher's score and then by id, and SHALL NOT drop a Candidate the Matcher matched exactly.

### Requirement 3: Constrained Model Output

**User Story:** As the developer, I want the model physically unable to return anything but a legal choice, so that "the model invents an action" is not a failure mode that needs defending against.

#### Acceptance Criteria

1. THE Interpreter SHALL call the `fast` role through the LLM Gateway's `structured` path with a JSON Schema built for that call, whose choice field is an enum of the current Candidate Ids plus `none` and `ambiguous`.
2. THE schema SHALL allow no free-text field that influences the action, and SHALL NOT allow the model to name an action kind, a target or an amount.
3. THE Gateway SHALL re-validate the reply against the same schema, and ANY reply that fails SHALL be treated as `not-understood` without a retry that widens the schema.
4. THE Interpreter SHALL map the chosen Candidate Id back to its Offered Action and SHALL discard the model's role in the result at that point.
5. THE static system prompt SHALL be a stable prefix, SHALL state that the player's text is data and not instructions, and SHALL name no world facts.

### Requirement 4: Parameter Slots Without Invention

**User Story:** As a player, I want to say "pay him 200" or "cable HQ asking for funds" and have my own words and numbers used, so that the game never makes up what I meant to send.

#### Acceptance Criteria

1. THE Interpreter SHALL fill a numeric Parameter Slot only from a number the deterministic parser finds in the Command Text, and SHALL NOT take a number from model output.
2. THE Interpreter SHALL fill a free-text Parameter Slot only with a substring of the Command Text that the player typed, checked by exact match, and SHALL NOT take text from model output.
3. WHEN a required Parameter Slot cannot be filled THEN THE Interpretation SHALL be `needs-parameter`, naming the slot, and SHALL NOT guess a value.
4. WHEN a filled slot violates the quote (an amount above Budget, an unknown target) THEN THE Interpretation SHALL be `blocked` with the quote's reason.

### Requirement 5: Deterministic First Pass

**User Story:** As a player, I want simple commands to work instantly and offline, so that the model is a convenience and not a dependency.

#### Acceptance Criteria

1. THE Matcher SHALL match Command Text against Candidates using, in order: an exact label, the Phrasebook verbs for each action kind together with a unique visible target name or alias, and a bounded fuzzy match on target names (for example "caf central").
2. WHEN the Matcher yields exactly one Candidate with a unique, exact-quality match THEN THE Interpreter SHALL resolve it without a model call.
3. WHEN the model is unavailable, times out, or returns an invalid reply THEN THE Interpreter SHALL return the Matcher's best Candidates as an `ambiguous` Interpretation, or `not-understood` if there are none.
4. THE Matcher SHALL be a pure function of the Command Text, the Candidate Menu and the loaded Phrasebook, so that the same inputs give the same output.

### Requirement 6: Ambiguity and Clarification

**User Story:** As a player, I want to be asked when my words could mean two things, so that a costly move is never made on a guess.

#### Acceptance Criteria

1. WHEN more than one Candidate plausibly matches THEN THE Interpretation SHALL be `ambiguous` with at most five choices in a stable order, each shown with its label and quote.
2. WHEN the player picks one THEN THE client SHALL send the choice back as a selection of that Candidate and the Interpreter SHALL treat it as `resolved` without another model call.
3. THE Interpreter SHALL NOT resolve between two Candidates by model confidence, a default or a coin flip.

### Requirement 7: Not Understood, Blocked and Closed

**User Story:** As a player, I want a useful answer when I ask for something I cannot do, so that I learn what is possible without being told what I should not know.

#### Acceptance Criteria

1. WHEN the Command Text asks for an action that does not exist ("assassinate the minister", "fly to the moon") THEN THE Interpretation SHALL be `not-understood`, SHALL say so, and SHALL suggest the nearest legal Candidates from the Matcher.
2. WHEN the Command Text names a Candidate whose quote is disallowed THEN THE Interpretation SHALL be `blocked` and SHALL show the quote's reason (for example "closed in the evening").
3. WHEN the Command Text names a place or person that the player has not discovered THEN THE Interpretation SHALL be the same `not-understood` result as for a name that does not exist, so that the interpreter is never an oracle for hidden Locations or people.
4. THE Interpretation text SHALL be built from fixed templates and Player View data and SHALL NOT be written by a model.

### Requirement 8: Confirmation Gate

**User Story:** As a player, I want to see what the game understood before something costly happens, so that a misread sentence cannot spend my Budget or burn a source.

#### Acceptance Criteria

1. THE configuration SHALL define a confirmation mode of `always`, `risky` or `never`, with `risky` as the default.
2. WHEN a `resolved` Interpretation comes from the model, or its action is in the risky set THEN THE client SHALL show the interpreted action with its phase cost, Budget cost and any warning the quote carries, and SHALL wait for the player to confirm before calling `act`.
3. THE risky set SHALL include `arrest`, `pay`, `cable` with a funds request, `turn-agent`, `feed`, `confront`, and any travel that crosses a Border or Sector Line, and SHALL be extensible through the Phrasebook.
4. THE client SHALL call `act` only with the Offered Action the Interpretation resolved to, after confirmation where required.

### Requirement 9: Routing Between Commands and Dialogue

**User Story:** As a player, I want to talk to people in free text and give commands in free text without the game confusing the two, so that a line to a source is never read as an order.

#### Acceptance Criteria

1. WHILE a talk scene is open THEN every line SHALL go to the slice's dialogue path (`say`), except a line that starts with the Command Escape, which SHALL go to the Interpreter.
2. WHILE no talk scene is open THEN every line SHALL go to the Interpreter.
3. THE Interpreter SHALL NOT call the Intent Classifier, and the Intent Classifier SHALL NOT call the Interpreter.
4. WHEN a command resolves to an action that would end the scene THEN THE client SHALL use `endScene`, and SHALL ask for confirmation first.

### Requirement 10: Navigation References

**User Story:** As a player, I want to move around the way I would say it, so that "back to the station" or "where I met Hans" works.

#### Acceptance Criteria

1. THE Matcher SHALL resolve a destination from a Location name, alias, Location Type word, District name, or one of these relative references: "back" (the previous Location), "home" or "the station", and "where I last saw <person>" or "where I met <person>", using only Journal and Player View data.
2. WHEN a reference matches several visited Locations THEN THE Interpretation SHALL be `ambiguous`.
3. THE Matcher SHALL resolve a reference only to Locations in the player's known set (the set the catalogue's `travel` candidates already use).
4. WHERE the player's cover or routes offer a countersurveillance variant THEN THE Interpreter SHALL treat it as a different Candidate, chosen by words such as "carefully" or "checking for a tail", and SHALL never choose it unasked.

### Requirement 11: Injection Resistance

**User Story:** As the developer, I want typed text unable to steer the model into an action, so that the interface cannot be argued into anything.

#### Acceptance Criteria

1. THE Interpreter SHALL send the Command Text only as data in the user message, and the static prompt SHALL tell the model that it contains no instructions.
2. FOR ANY Command Text, the set of possible results SHALL be limited to the Candidates in the menu, the Interpretation kinds of this spec, and the Matcher's own outputs.
3. THE Interpreter SHALL cap the Command Text length, and SHALL strip control characters before use.
4. THE adversarial test set SHALL include text that claims to override the menu, to name a Candidate Id that is not offered, to ask for the system prompt, and to contain a fake JSON reply.

### Requirement 12: Determinism and Replay

**User Story:** As the developer, I want a replay to be unaffected by language models, so that determinism cannot be broken by this feature.

#### Acceptance Criteria

1. THE Turn Pipeline, the save and the replay log SHALL record only the committed `Action` and SHALL NOT record Command Text, Candidate Ids, or the model's reply.
2. WHEN a game is replayed THEN THE replay SHALL NOT call the Interpreter.
3. THE debug log MAY record Command Text and the Interpretation, and SHALL be outside the save and the determinism contract.

### Requirement 13: Add-On Extensibility

**User Story:** As the developer of an add-on, I want my new actions understood without editing the interpreter, so that the add-on system stays additive.

#### Acceptance Criteria

1. THE Interpreter SHALL treat any action kind that `EngineApi.actions()` returns as a Candidate, including kinds registered by an add-on.
2. THE Content Loader SHALL gain a Phrasebook content kind, registered through the Content Kind Registry, giving for each action kind its verbs, synonyms and example phrasings per locale and Year Range.
3. WHERE an action kind has no Phrasebook entry THEN THE Interpreter SHALL fall back to the kind's id and its label, and the Pack Linter SHALL warn that the kind has no Phrasebook.
4. THE Phrasebook SHALL support era and locale variants, so that the same action may be phrased differently in different settings (for example the setting-generalization spec's contemporary profile).

### Requirement 14: Resources and Latency

**User Story:** As a player, I want a command to resolve quickly on the reference machine, so that typing a sentence is no slower than choosing from a list.

#### Acceptance Criteria

1. THE Interpreter SHALL use only the `fast` role and SHALL NOT load a third resident model (Slice Req 14.5).
2. THE Interpreter SHALL apply a configured timeout to the model call and SHALL then fall back as in Requirement 5.3.
3. THE Matcher stage SHALL complete within the configured budget on the Reference Machine for the largest generated Candidate Menu.
4. THE model prompt SHALL be small: the static prefix, the capped menu and the Command Text, with no history.

### Requirement 15: Evaluation

**User Story:** As the developer, I want a measured guarantee that the model never escapes the menu, and a measured accuracy on real phrasing, so that I can swap models with confidence.

#### Acceptance Criteria

1. THE `evals` package SHALL gain an interpretation suite with a golden set of phrases per action kind and expected Candidates, and the adversarial set of Requirement 11.4.
2. THE suite SHALL report accuracy, the clarification rate, the fallback rate and the **illegal-output rate**, and the illegal-output rate SHALL be zero for the suite to pass.
3. THE continuous test run SHALL use a fake Gateway, and the live-model suite SHALL run with the evals command.
4. THE suite SHALL include a Command Text for each known Location and person in generated worlds, so that name matching is checked at scale.

### Requirement 16: Client Integration

**User Story:** As a player, I want the same command line behaviour in the terminal and in the browser, so that I learn it once.

#### Acceptance Criteria

1. THE TUI command line and the Web Shell command box SHALL both call `EngineApi.interpret` and SHALL render each Interpretation kind with the same wording, supplied by the facade.
2. THE clients SHALL keep the existing menu and key bindings as they are, and the command line SHALL be an addition.
3. THE help view SHALL list example phrasings for each action kind from the Phrasebook.
