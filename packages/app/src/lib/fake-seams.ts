/**
 * The Fake Seams (`app/fake-seams.ts`) — slice-integration task 12.6; design,
 * "Composition Root" / "Testing Strategy: Fake Seams"; Requirements 18.3, 23.5.
 *
 * The Composition Root builds a playable game behind four injected Turn Pipeline
 * seams (classify, voice, narrate, extraction). For a live session those seams
 * call the LLM Gateway through the dialogue package (`buildLiveSeams`); for a
 * test session they are replaced with these **Fake Seams** — a seeded, offline,
 * fully deterministic bundle that reaches no endpoint and performs no I/O
 * (Req 18.3). `createGame({ seams: buildFakeSeams(...) })` therefore assembles
 * the real game — the real engine, the real Turn Pipeline, the real Player View
 * facade — with only the model-touching steps faked, so a property test or a
 * Scripted Full Game exercises everything *below* the seams for real while
 * staying hermetic (Req 23.5).
 *
 * The bundle this builds is a {@link Partial} of the player-view
 * {@link TurnPipelineConfig}, so the Composition Root hands it straight through
 * as the `seams` override. It populates exactly the four model seams plus the
 * `deflectionLine` the voice default would otherwise use:
 *
 *   - **classify** — a seeded classifier that picks one label from the engine's
 *     fixed {@link INTENTS}. The choice is a pure function of a per-seam PRNG
 *     seeded from the caller's seed and the player's line, so the same line in
 *     the same session always classifies the same way and a `retry` reproduces
 *     it (design "a seeded classifier choosing from `INTENTS`").
 *   - **voice** — returns one or two fuzzed sentences built *only* from the
 *     scene NPC's allowed aliases (the player's known-entity surface forms) and
 *     fixed filler words, so the sentences name no entity outside the known set
 *     and the Leak Guard never trips (design "a voice seam returning fuzzed
 *     sentences built from the scene NPC's allowed aliases"). With no known
 *     entity to name, it falls back to filler-only text.
 *   - **narrate** — fact-only: it returns no Flavour sentences, matching the
 *     design's "fact-only narration". The pipeline shows the Fact Lines
 *     regardless, so a faked narrate seam never changes a committed turn.
 *   - **extraction** — a two-phase runner whose phase-1 result is always
 *     immediately ready and is a **schema-valid fuzzed** {@link ExtractionResult}
 *     derived from the predicate registry's {@link buildExtractionSchema}: it
 *     constructs candidate Claims from the registry's predicates and the known
 *     entities, validates every candidate against the derived schema and keeps
 *     only the ones that parse, so the result is always something the pipeline's
 *     phase-2 `evaluateExtraction` can type (design "an extraction runner
 *     returning schema-valid fuzzed results from `buildExtractionSchema`").
 *
 * Every seam is seeded from one caller seed and draws from its own derived
 * stream, so two runs of the same session (same seed, same lines, same actions)
 * produce byte-identical seam outputs. That determinism is what Properties
 * 38–40, 55 and 57 (tasks 12.7–12.11) and the Scripted Full Games (Req 23) rely
 * on. This module is library code: it imports no vitest and performs no I/O.
 *
 * The seams read the live {@link WorldState} through an injected `getState`
 * (the Composition Root wires it to the facade's current state, swapped in place
 * as each turn commits), exactly as the live seams do, so a seam always sees the
 * current known set and scene.
 */

import type { PredicateRegistry } from '@tradecraft/content';
import {
  createPrng,
  EntityRegistry,
  INTENTS,
  type EntityId,
  type Intent,
  type Prng,
  type WorldState,
} from '@tradecraft/engine';
import { buildExtractionSchema, type ExtractionResult } from '@tradecraft/dialogue';
import type {
  ClassifySeam,
  ExtractionReady,
  ExtractionRunner,
  NarrateSeam,
  QueuedExtraction,
  TurnPipelineConfig,
  VoiceSeam,
} from '@tradecraft/player-view';

/** The persona deflection line the Fake voice seam uses, mirroring the live one. */
export const FAKE_DEFLECTION_LINE = 'The contact looks away and says nothing useful.';

/**
 * The dependencies {@link buildFakeSeams} needs. The caller supplies a seed (so
 * the whole bundle is deterministic), a `getState` that reads the live world
 * (for the known set and the open scene) and the compiled predicate registry
 * (for the extraction schema). These mirror the subset of {@link LiveSeamDeps}
 * the Fake Seams actually use.
 */
export interface FakeSeamDeps {
  /** The seed every seam's PRNG derives from. */
  readonly seed: string;
  /** Reads the live world state at the moment a seam runs. */
  readonly getState: () => WorldState;
  /** The compiled predicate registry the extraction schema derives from. */
  readonly predicates: PredicateRegistry;
}

/**
 * The subset of {@link TurnPipelineConfig} the Fake Seams populate. Structurally
 * a `Partial<TurnPipelineConfig>`, so the Composition Root passes it straight as
 * the `seams` override.
 */
export type FakeSeamBundle = Pick<
  TurnPipelineConfig,
  'classify' | 'voice' | 'narrate' | 'extraction' | 'deflectionLine'
>;

/**
 * Build an {@link EntityRegistry} from a {@link WorldState}, matching the live
 * seam's registry so a known-entity id maps to a view-safe surface form. Each
 * NPC's canonical name is their persona name, each Location's its display name,
 * each Org's its name — no truth is unwrapped (all three are view-safe labels).
 */
function registryFromWorld(state: WorldState): EntityRegistry {
  const entries = [
    ...Object.values(state.npcs).map((npc) => ({
      id: npc.id as EntityId,
      canonicalName: npc.persona.name,
      aliases: [],
    })),
    ...Object.values(state.city.locations).map((loc) => ({
      id: loc.id as EntityId,
      canonicalName: loc.name,
      aliases: [],
    })),
    ...Object.values(state.orgs).map((org) => ({
      id: org.id as EntityId,
      canonicalName: org.name,
      aliases: [],
    })),
  ].filter((e) => e.canonicalName.trim().length > 0);
  return EntityRegistry.from(entries);
}

/**
 * The player-facing surface forms of the player's known entities — the "allowed
 * aliases" the voice seam may build a sentence from. Reads only `player.known`
 * and the registry's canonical names, so a sentence built from these names no
 * entity outside the known set (the Leak Guard's allowed set), and the guard
 * never trips.
 */
function allowedAliases(state: WorldState): readonly string[] {
  const registry = registryFromWorld(state);
  const names: string[] = [];
  for (const id of state.player.known.entities) {
    const name = registry.canonicalName(id);
    if (name !== undefined && name.trim().length > 0) {
      names.push(name);
    }
  }
  return names;
}

/** Derive a per-seam, per-key PRNG so each seam draws from its own stream. */
function derivePrng(seed: string, ...keys: readonly string[]): Prng {
  return createPrng(`fake-seams:${seed}:${keys.join(':')}`);
}

/** Pick one element of a non-empty array with a PRNG draw. */
function pick<T>(rng: Prng, items: readonly T[]): T {
  return items[rng.int(0, items.length - 1)];
}

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

/**
 * Build the Fake `classify` seam: a seeded classifier that labels the player's
 * line with one of the fixed {@link INTENTS}. The label is a pure function of
 * the caller's seed and the line (a PRNG seeded from both), so the same line in
 * the same session always classifies the same way and a `retry` reproduces it.
 */
export function buildFakeClassifySeam(seed: string): ClassifySeam {
  return (line: string): Promise<Intent> => {
    const rng = derivePrng(seed, 'classify', line);
    return Promise.resolve(pick(rng, INTENTS));
  };
}

// ---------------------------------------------------------------------------
// voice
// ---------------------------------------------------------------------------

/** Fixed filler words a fuzzed sentence is padded with (never an entity name). */
const FILLER = [
  'perhaps',
  'as you say',
  'the matter',
  'in time',
  'quietly',
  'between us',
  'nothing more',
] as const;

/**
 * Build the Fake `voice` seam: one or two fuzzed sentences built only from the
 * scene NPC's allowed aliases (the player's known-entity surface forms) and
 * fixed filler words. Because every word is either an allowed alias or filler,
 * the sentences name no entity outside the known set and the Leak Guard never
 * trips (Req 18.3). With no known entity to name, the seam falls back to
 * filler-only text. The output is deterministic in the seed, the line and the
 * known set.
 */
export function buildFakeVoiceSeam(deps: FakeSeamDeps): VoiceSeam {
  return (line, intent, scene) => {
    const state = deps.getState();
    const rng = derivePrng(deps.seed, 'voice', scene.npc, intent, line);
    const aliases = allowedAliases(state);

    const sentenceCount = rng.int(1, 2);
    const released: string[] = [];
    for (let i = 0; i < sentenceCount; i += 1) {
      const parts: string[] = [];
      // Lead with an allowed alias when the player knows anyone/anywhere, so the
      // reply names only entities the Leak Guard allows; otherwise filler only.
      if (aliases.length > 0) {
        parts.push(pick(rng, aliases));
      }
      parts.push(pick(rng, FILLER));
      if (rng.next() < 0.5) {
        parts.push(pick(rng, FILLER));
      }
      released.push(`${parts.join(', ')}.`);
    }

    return Promise.resolve({ released, speaker: scene.speakerName });
  };
}

// ---------------------------------------------------------------------------
// narrate
// ---------------------------------------------------------------------------

/**
 * Build the Fake `narrate` seam: fact-only. It returns no Flavour sentences, so
 * a committed turn shows its Fact Lines and nothing else — the design's
 * "fact-only narration". A faked narrate seam never changes a committed turn.
 */
export function buildFakeNarrateSeam(): NarrateSeam {
  return (): Promise<readonly string[]> => Promise.resolve([]);
}

// ---------------------------------------------------------------------------
// extraction
// ---------------------------------------------------------------------------

/** The most Claims a single fuzzed extraction result carries (below the schema max). */
export const MAX_FUZZ_CLAIMS = 4;

/**
 * One candidate extracted Claim, before schema validation. The entity ids are
 * drawn from the known set (or the `unk:`/`unknown` sentinels) and the literals
 * from fixed pools, so a candidate is plausible; the schema then rejects any
 * candidate whose shape a predicate does not allow.
 */
interface CandidateClaim {
  readonly predicate: string;
  readonly subject: string;
  readonly object: string | { readonly kind: string; readonly value: unknown };
  readonly place?: string;
  readonly when?: { readonly from: unknown; readonly to?: unknown };
  readonly hedged: boolean;
}

/** An entity id to use as a Claim argument: a known entity, or a sentinel. */
function argEntity(rng: Prng, known: readonly string[]): string {
  const pool = [...known, 'unknown', 'unk:0', 'npc:fuzz'];
  return pick(rng, pool);
}

/** A literal object value for a fuzzed Claim: text, amount or a game time. */
function argLiteral(rng: Prng): { readonly kind: string; readonly value: unknown } {
  const kind = pick(rng, ['text', 'amount', 'time'] as const);
  switch (kind) {
    case 'text':
      return { kind: 'text', value: pick(rng, ['a note', 'a word', 'nothing']) };
    case 'amount':
      return { kind: 'amount', value: rng.int(0, 1000) };
    case 'time':
      return { kind: 'time', value: { day: rng.int(0, 10), phase: rng.int(0, 3) } };
  }
}

/** A `when` window for a fuzzed Claim. */
function argWindow(rng: Prng): { readonly from: unknown; readonly to?: unknown } {
  const from = { day: rng.int(0, 10), phase: rng.int(0, 3) };
  if (rng.next() < 0.5) {
    return { from };
  }
  return { from, to: { day: rng.int(0, 10), phase: rng.int(0, 3) } };
}

/** A `place` for a fuzzed Claim: a known Location id, or a plausible fuzz id. */
function argPlace(rng: Prng, knownLocations: readonly string[]): string {
  const pool = knownLocations.length > 0 ? [...knownLocations, 'loc:fuzz'] : ['loc:fuzz'];
  return pick(rng, pool);
}

/**
 * Build a candidate Claim for one predicate from the registry, drawing each
 * argument from the known set and the fuzz pools. The subject and object kinds
 * follow the predicate's declaration (a literal-object predicate gets a literal
 * object; an entity-object predicate gets an entity id); `place`/`when` are
 * included when the predicate allows them. The schema then re-checks the shape,
 * so a candidate that does not fit is simply dropped — the point is to produce
 * plausible candidates, not to re-implement the schema here.
 */
function candidateFor(
  rng: Prng,
  predicate: PredicateRegistry['predicates'][number],
  known: readonly string[],
  knownLocations: readonly string[],
): CandidateClaim {
  const def = predicate.definition;
  const object =
    'literal' in def.object ? argLiteral(rng) : argEntity(rng, known);

  const candidate: CandidateClaim = {
    predicate: def.id,
    subject: argEntity(rng, known),
    object,
    hedged: rng.next() < 0.5,
  };

  const withPlace =
    def.place === 'none'
      ? candidate
      : def.place === 'required' || rng.next() < 0.5
        ? { ...candidate, place: argPlace(rng, knownLocations) }
        : candidate;

  const withWindow =
    def.window === 'none'
      ? withPlace
      : def.window === 'required' || rng.next() < 0.5
        ? { ...withPlace, when: argWindow(rng) }
        : withPlace;

  return withWindow;
}

/** The known Location ids from the player's known set (for a Claim's `place`). */
function knownLocationIds(state: WorldState): readonly string[] {
  return state.player.known.entities.filter((id) => id.startsWith('loc:'));
}

/**
 * Produce a schema-valid fuzzed {@link ExtractionResult} for one queued job
 * (Req 18.3, 23.5). It builds up to {@link MAX_FUZZ_CLAIMS} candidate Claims
 * from random registry predicates and the job's known set, validates each
 * candidate against the predicate-derived {@link buildExtractionSchema}, and
 * keeps only the ones that parse — so the result is always a value the
 * pipeline's phase-2 `evaluateExtraction` can type. An empty registry (no fact
 * vocabulary) yields the empty claim list, which the schema also accepts.
 */
export function buildFuzzedExtraction(
  deps: FakeSeamDeps,
  job: QueuedExtraction,
): ExtractionResult {
  const schema = buildExtractionSchema(deps.predicates);
  const predicates = deps.predicates.predicates;
  if (predicates.length === 0) {
    // No fact vocabulary: the only schema-valid result is the empty list.
    return { claims: [] };
  }

  const rng = derivePrng(deps.seed, 'extract', job.turnId, job.speaker, job.utterance);
  const state = deps.getState();
  const known = [...state.player.known.entities];
  const knownLocations = knownLocationIds(state);

  const count = rng.int(0, MAX_FUZZ_CLAIMS);
  const claims: CandidateClaim[] = [];
  for (let i = 0; i < count; i += 1) {
    const predicate = pick(rng, predicates);
    const candidate = candidateFor(rng, predicate, known, knownLocations);
    // Keep only candidates the derived schema accepts, so the result is always
    // schema-valid without re-implementing the schema's shape rules here.
    const single = schema.safeParse({ claims: [candidate] });
    if (single.success) {
      claims.push(candidate);
    }
  }

  // The whole list re-validates (it is a subset of accepted singletons, capped
  // below the schema's max), so this parse always succeeds; it is the final
  // guard that the returned value is exactly what the schema produces.
  const parsed = schema.safeParse({ claims });
  return parsed.success ? parsed.data : { claims: [] };
}

/**
 * Build the Fake `extraction` runner: a two-phase runner whose phase-1 result
 * is always immediately ready and is a schema-valid fuzzed
 * {@link ExtractionResult} for the job (Req 18.3). `start` computes and caches
 * the result for the job's `turnId`; `ready` returns it as a `parsed` result.
 * Because `start` is synchronous and total (no model call, no I/O), a job is
 * ready at the very next boundary, so the pipeline's phase-2 commit runs for
 * every dialogue turn in a deterministic test — which is what Property 57
 * (extraction commit atomicity) and the determinism properties exercise.
 */
export function buildFakeExtractionRunner(deps: FakeSeamDeps): ExtractionRunner {
  const results = new Map<string, ExtractionResult>();
  return {
    start: (job: QueuedExtraction): void => {
      results.set(job.turnId, buildFuzzedExtraction(deps, job));
    },
    ready: (job: QueuedExtraction): ExtractionReady => {
      const result = results.get(job.turnId);
      if (result === undefined) {
        // A job whose `start` was never called: nothing to commit yet. (The
        // pipeline always calls `start` before `ready`, so this is a guard.)
        return 'pending';
      }
      return { kind: 'parsed', result };
    },
  };
}

// ---------------------------------------------------------------------------
// The bundle
// ---------------------------------------------------------------------------

/**
 * Assemble the Fake Seams bundle (Req 18.3, 23.5). The result is a
 * {@link Partial} of the player-view {@link TurnPipelineConfig} the Composition
 * Root passes as the `seams` override: a seeded classifier over {@link INTENTS},
 * a voice seam returning fuzzed sentences from the allowed aliases, a fact-only
 * narrate seam, and an extraction runner returning schema-valid fuzzed results
 * from the predicate-derived schema. Every seam is seeded from `deps.seed`, so
 * two runs of the same session produce identical seam outputs — the determinism
 * the property tests and Scripted Full Games depend on.
 *
 * The phase-2 evaluator (`evaluateExtraction`) is intentionally *not* part of
 * this bundle: it is the pure dialogue function the caller wires on the pipeline
 * config, so a test that drives extraction supplies the real `evaluateExtraction`
 * alongside these seams. The Fake bundle fakes only the four model-touching
 * steps.
 */
export function buildFakeSeams(deps: FakeSeamDeps): FakeSeamBundle {
  return {
    classify: buildFakeClassifySeam(deps.seed),
    voice: buildFakeVoiceSeam(deps),
    narrate: buildFakeNarrateSeam(),
    extraction: buildFakeExtractionRunner(deps),
    deflectionLine: FAKE_DEFLECTION_LINE,
  };
}
