# Implementation Plan: Natural Language Commands

## Overview

This plan adds `EngineApi.interpret`, which maps free text onto the existing legal action list. A deterministic Matcher and Phrasebook run first. A model chooser (fast role) is consulted only when they cannot decide, and it can only pick an id from a closed Candidate Menu. The order is:

1. facade types, the action describer and normalisation;
2. the Phrasebook, Matcher, references, menu and parameter filler;
3. orchestration, confirmation, blocked explanations and routing;
4. the model chooser in `dialogue`;
5. wiring, configuration and the debug log;
6. TUI integration and help;
7. the Phrasebook content kind (needs content-expansion's registry);
8. evals, including the zero-illegal-output gate.

Property numbers refer to this spec's design.

Dependencies on other specs, as interface assumptions:

- **content-expansion:** the Content Kind Registry is needed only for the `phrasebook` kind (group 7). Groups 1 to 6 use built-in phrasebook data.
- **street-ops and other add-ons:** contribute describers and Phrasebook entries through the Extension Registry (setting-generalization task 1.2). This plan defines the view-side half of that bundle's contract and works with an empty registry.
- **web-shell:** the web command box is specified in web-shell. This plan delivers the facade and TUI only (task 6.2 defers the web box).

## Tasks

- [ ] 1. Facade types, describer and normalisation
  - [ ] 1.1 Add the `interpret` facade types to `player-view/api/types.ts`
    - Add `Interpretation` (resolved, ambiguous, needs-parameter, blocked, not-understood), `InterpretOptions`, `Selection` and `EngineApi.interpret(text, selection?)`.
    - Add the optional `modelChooser` to `PlayerViewEngineDeps`. Absent chooser means deterministic-only.
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [ ] 1.2 Implement the Action describer
    - Implement `command/describe.ts`: for each catalogue entry produce a stable id, a verb, noun slots, display text and Phrasebook keys. Make unregistered add-on kinds describe as nothing and so never appear in the menu.
    - _Requirements: 2.1, 2.2, 2.3_
  - [ ] 1.3 Implement text normalisation
    - Implement `command/normalize.ts`: case, punctuation, whitespace, simple plurals and articles, with no stemming that depends on setting vocabulary.
    - _Requirements: 5.1_

- [ ] 2. Phrasebook, matcher, references, menu and parameters
  - [ ] 2.1 Implement the built-in Phrasebook
    - Implement `command/phrasebook.ts`: verb synonyms and noun patterns per action kind (go, talk, ask, wait, hand over, read, etc.), as data keyed by Terminology keys so a setting can override them.
    - _Requirements: 5.2, 5.3_
  - [ ] 2.2 Implement the deterministic Matcher
    - Implement `command/matcher.ts` as a pure function of normalised text, the menu and the Phrasebook. Return resolved, ambiguous or no match.
    - An exact unique match resolves without a model. Two equally good candidates are ambiguous; never break ties by score.
    - **Property 4: Matcher determinism and purity**
    - **Validates: Requirements 5.2, 5.3, 5.4**
    - _Requirements: 5.2, 5.3, 5.4_
  - [ ] 2.3 Prove exact unique matches resolve without a model
    - Use a chooser that throws if called.
    - **Property 5: Exact unique resolves without a model**
    - **Validates: Requirements 5.2, 6.1**
    - _Requirements: 5.2_
  - [ ] 2.4 Prove ambiguity is never broken by confidence
    - Generate menus with tied candidates and assert the result is always `ambiguous` with every tied candidate listed.
    - **Property 9: No tie-breaking by confidence**
    - **Validates: Requirements 6.1, 6.2, 6.3**
    - _Requirements: 6.1, 6.2, 6.3_
  - [ ] 2.5 Implement navigation references
    - Implement `command/references.ts`: ordinals ("the second one"), "back", "there" and the current Selection, resolved against the visible lists only.
    - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - [ ] 2.6 Implement the Candidate Menu builder
    - Implement `command/menu.ts` from `buildActionCatalogue`: filter by `commands.menuCap`, rank by matcher score for display only, and never include actions the Quote disallows.
    - **Property 2: Schema equals menu**
    - **Validates: Requirements 2.4, 3.2**
    - _Requirements: 2.4, 2.5_
  - [ ] 2.7 Implement the parameter filler
    - Implement `command/params.ts`: fill slots only by deterministic parse or exact substring of the user's text against names the player has discovered. A model never supplies a parameter.
    - Return `needs-parameter` with prompts when a slot is open.
    - **Property 3: No model-sourced parameters**
    - **Validates: Requirements 4.1, 4.2, 4.3**
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ] 2.8 Prove no oracle for hidden names
    - Assert that typing the name of an undiscovered person, place or document gives the same result as typing nonsense.
    - **Property 6: No oracle for hidden names**
    - **Validates: Requirements 4.4, 11.2**
    - _Requirements: 4.4, 11.2_

- [ ] 3. Checkpoint - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Orchestration, confirmation and routing
  - [ ] 4.1 Implement the interpreter orchestration
    - Implement `command/interpreter.ts`: normalise, references, matcher, then the chooser only when needed, then the parameter filler, then confirmation. Apply `commands.timeoutMs` and fall back to `not-understood` on a chooser failure.
    - _Requirements: 1.2, 3.1, 14.1, 14.2_
  - [ ] 4.2 Implement blocked explanations
    - When text names an action that the Quote disallows, return `blocked` with the Quote's reason template. The chooser is never asked to choose it.
    - **Property 8: Disallowed is explained, never chosen**
    - **Validates: Requirements 7.2, 7.3**
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [ ] 4.3 Implement the confirmation gate
    - Implement `needsConfirmation` under modes `always`, `risky` and `never`, where risky is decided by the catalogue's flags (irreversible, burn-risk, violent).
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [ ] 4.4 Implement client-side routing and the escape
    - Implement `command/router.ts`: inside a talk scene, text goes to dialogue unless it starts with the escape (`/` by default), which routes it to `interpret`.
    - **Property 11: Escape routing**
    - **Validates: Requirements 9.1, 9.2, 9.3**
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [ ] 5. Model chooser in `dialogue`
  - [ ] 5.1 Implement the `command-chooser` and its prompt
    - Implement `dialogue/command-chooser/chooser.ts` and `prompt.ts` on the Gateway's `structured` path, fast role, with a per-call zod enum of candidate ids plus `none` and `ambiguous`.
    - Import nothing from `player-view`. The port shape is declared structurally on both sides and checked at the Composition Root.
    - **Property 1: Closed output**
    - **Validates: Requirements 3.1, 3.2, 3.3**
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [ ] 5.2 Prove the model sees no world input
    - Use a recording chooser to assert the request contains only the user's text and the menu's display strings.
    - **Property 7: No world input to the model**
    - **Validates: Requirements 11.1, 11.3**
    - _Requirements: 11.1, 11.3, 11.4_
  - [ ] 5.3 Prove action-only persistence
    - Compare replay logs of a game played by typed text and by direct actions: they must be identical.
    - **Property 10: Action-only persistence**
    - **Validates: Requirements 12.1, 12.2**
    - _Requirements: 12.1, 12.2, 12.3_

- [ ] 6. Wiring, configuration and clients
  - [ ] 6.1 Wire the chooser and add configuration
    - Build the chooser from the Gateway in `composition-root.ts` and pass it to `PlayerViewEngine`.
    - Add `commands.confirm`, `commands.menuCap`, `commands.timeoutMs` and `commands.escape` to `config/scenario.yaml` with validation.
    - Add the optional debug log of interpretations, off by default.
    - _Requirements: 14.3, 14.4, 16.1_
  - [ ] 6.2 Add the TUI command line and help
    - Add the command line component, the rendering of each Interpretation variant and a `help` listing built from the live menu.
    - The web command box is specified in web-shell and is deferred.
    - _Requirements: 16.2, 16.3_
  - [ ] 6.3 Add add-on describer integration tests
    - Register a fixture add-on action and assert it appears in the menu with a describer and not without one.
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [ ] 7. Phrasebook content kind
  - [ ] 7.1 Register the `phrasebook` kind
    - Register a `phrasebook` content kind through the Content Kind Registry, so packs and add-ons can add verbs and nouns.
    - Validate that entries reference known Terminology keys and action kinds.
    - _Requirements: 13.2, 13.3_

- [ ] 8. Evaluation
  - [ ] 8.1 Build the interpretation eval suite
    - Add `evals` cases: paraphrases, typos, ambiguous phrases, injection attempts and requests for illegal actions, with expected Interpretation kinds.
    - _Requirements: 15.1, 15.2, 15.3_
  - [ ] 8.2 Add the zero-illegal-output gate
    - Run a large generated suite with a recorded real model and assert that no result ever carries an action the Quote disallows.
    - **Property 12: Illegal-output rate is zero**
    - **Validates: Requirements 15.4, 3.5**
    - _Requirements: 15.4_
  - [ ] 8.3 Write documentation
    - Add `docs/commands.md`: how interpretation works, configuration, the escape and how add-ons contribute describers and Phrasebook entries.
    - _Requirements: 14.4, 16.3_

- [ ] 9. Final checkpoint - Ensure all tests pass, ask the user if questions arise.

## Notes

- Property tests are required sub-tasks. Tag each with `// Feature: natural-language-commands, Property N: <title>`.
- The model never creates, edits or reveals an action or a parameter. Task 8.2 is the gate for that.
- Replays store the resulting Action only (task 5.3), so recorded Cold War model requests stay byte-identical.
- The web command box and the Phrasebook content kind depend on other specs and are noted at tasks 6.2 and 7.1.
- No source code has been written in this plan.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["2.1"] },
    { "id": 4, "tasks": ["2.2", "7.1"] },
    { "id": 5, "tasks": ["2.3"] },
    { "id": 6, "tasks": ["2.4"] },
    { "id": 7, "tasks": ["2.5"] },
    { "id": 8, "tasks": ["2.6"] },
    { "id": 9, "tasks": ["2.7", "5.1"] },
    { "id": 10, "tasks": ["2.8", "4.1", "5.2"] },
    { "id": 11, "tasks": ["4.2", "5.3", "6.1"] },
    { "id": 12, "tasks": ["4.3", "6.2", "8.1"] },
    { "id": 13, "tasks": ["4.4", "6.3", "8.2"] },
    { "id": 14, "tasks": ["8.3"] }
  ]
}
```
