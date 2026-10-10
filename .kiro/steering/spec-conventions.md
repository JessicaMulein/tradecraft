---
inclusion: fileMatch
fileMatchPattern: [".kiro/specs/**"]
---

# Spec conventions in this repo

Every spec lives in `.kiro/specs/<name>/` as `requirements.md`, `design.md` and `tasks.md`. `tasks.meta.json`, where it exists, is Kiro's own execution record. Never edit it by hand.

Read `AGENTS.md` first. The owner approves intent; the spec text itself is the agent's job.

## requirements.md

- `# Requirements Document`, then `## Introduction`. The introduction states what the current specs and code already do (with Req references), the approach, the slice invariants that still hold, the implementation order relative to other specs, and what is **out of scope**.
- `## Glossary` lists only terms not already defined in the slice glossary or an earlier spec, and says where the others are defined.
- `## Requirements`. Each one is `### Requirement N: Title`, then `**User Story:** As a …, I want …, so that …`, then `#### Acceptance Criteria` as a numbered list in EARS form (`THE … SHALL`, `WHEN … THEN … SHALL`, `IF … THEN … SHALL`, `WHERE … THEN … SHALL`, `WHILE … SHALL`).
- Cite other specs precisely: "Slice Req 3.1" for the `tradecraft` spec, "content-expansion Req 16.4", "multi-city requirement 3.10".
- Numbering is stable. Other specs and tasks cite these numbers. Add new criteria at the end of a requirement and new requirements at the end of the list. If a criterion's meaning has to change, say so in the Introduction rather than silently renumbering.

## design.md

Sections, in order: `## Overview` (with a short list of key decisions), `## Architecture`, `## Components and Interfaces` (TypeScript interfaces per package, named by path such as `web/frames`), `## Data Models` (including any new `config/*.yaml` shape), `## Correctness Properties`, `## Error Handling`, `## Testing Strategy`.

Correctness Properties are numbered: `### Property N: Name`, a universally quantified statement ("For any …"), and the requirements it validates. Each one becomes a fast-check property test.

## tasks.md

- `# Implementation Plan: <Spec Name>`, then `## Overview` with the build order and the cross-spec **dependencies as interface assumptions** ("task 1.2 of setting-generalization is a hard prerequisite").
- `## Tasks`: numbered groups with checkbox sub-tasks:

```markdown
- [ ] 3. Group title
  - [ ] 3.1 Imperative sub-task title
    - What to build, where, and what it must not change.
    - _Requirements: 2.3, 2.4_
  - [ ] 3.2 Write the property test for <thing>
    - **Property 3: Legal moves only**
    - **Validates: Requirements 3.2, 4.1**
```

- Every sub-task cites requirements. Every Correctness Property has exactly one test task. Groups end with a checkpoint task when a milestone needs a full run.
- Tick `[x]` only when the code is in, the task's own tests pass and `pnpm run check` adds no new failures. Tick a group only when all its sub-tasks are ticked.

## Project-wide rules every spec keeps

- New features are **off by default** behind a flag or a separate scenario file. The shipped `config/scenario.yaml` stays core-only.
- `generatorVersion` stays `0.7.0` and golden replays stay byte-identical unless the spec explicitly says otherwise. A disabled or absent feature must reproduce existing results exactly, proved by a golden test.
- New randomness draws from its own PRNG stream family derived from the seed.
- New truth lives in the Truth Store, and the truth-isolation tests are extended to cover it.
- New content kinds register through the Content Kind Registry with Field Declarations.
- Package boundaries are enforced by `.dependency-cruiser.cjs`. A spec that needs a new import path says so in its design.

## When a spec changes state

Update the **Status**, **Roadmap** and **Specs** sections of `README.md` in the same change, in the same plain style: what works, what is off by default, and what is still open.
