/**
 * Property 14: Replay determinism (design, "Correctness Properties"; task 21.3).
 *
 * **Validates: Requirements 17.4.**
 *
 * > For any recorded session, replaying its seed, action log and recorded model
 * > responses reaches a final state deep-equal to the original. (design,
 * > Property 14)
 *
 * Requirement 17.4 is the whole-session reproduction guarantee: regenerating the
 * world from the same `(seed, generatorVersion, ContentManifest,
 * DifficultyPreset)` and applying the recorded action log in `seq` order — with
 * every model call served from the recording so no live model is touched —
 * reproduces an IDENTICAL session: the same {@link WorldState}, the same action
 * log, byte-for-byte.
 *
 * This spec pins the **model-free core** of that guarantee, which is where the
 * determinism actually lives:
 *
 *   - the engine's `generate(seed, inputs)` is deterministic (Property 1), so
 *     two regenerations from the same seed and inputs are deep-equal; and
 *   - the action resolver `resolve(state, action, rng, ctx)` is pure and draws
 *     only from a PRNG whose state is carried on the {@link WorldState}, so
 *     folding the SAME action log over a regenerated world — resuming the PRNG
 *     from the world's own serialised `rng` — is deterministic.
 *
 * Compose those two facts and replay from `(seed + action log)` is deterministic
 * end to end: that is exactly Property 14's model-free half. The LLM
 * `ReplayGateway` half (recorded model responses replay identically, with no
 * live endpoint) is pinned by its sibling property in the `llm` package
 * (`replay-determinism.property.spec.ts`), which this file deliberately does not
 * duplicate — player-view does not depend on `llm`, and the two halves compose:
 * a deterministic resolver fold over a deterministic world, with every model
 * step served identically from the recording, reproduces the whole session.
 *
 * ## The replay harness
 *
 * {@link replaySession} is a tiny, faithful model of the Turn Pipeline's replay
 * path, reduced to what Property 14 is about. It:
 *
 *   1. regenerates the world from `(seed, inputs)` — the determinism key;
 *   2. resumes a single PRNG from the world's own serialised `rng` state
 *      ({@link createPrng}), so every resolver draw across the whole session
 *      comes from one resumable stream, exactly as a save/replay would;
 *   3. folds the action log in order, calling the pure {@link resolve} for each
 *      entry, threading the next {@link WorldState} forward and writing the
 *      PRNG's advanced state back onto `world.rng` so the serialised PRNG state
 *      participates in the final deep-equal (a replay that forgot to persist the
 *      stream would silently diverge on the next draw); and
 *   4. records each applied action into a real player-view {@link ActionLog} at
 *      a deterministically advanced {@link GameTime}, so the reproduced action
 *      log is compared too, not just the world.
 *
 * It is driven over real generated worlds (the core pack, a real Content
 * Manifest and Difficulty Preset) and a generated, bounded action sequence of
 * `wait` and `travel` actions — `wait` always resolves and advances the clock;
 * `travel` exercises the resolver's only PRNG draw (the tail-persistence coin on
 * a countersurveillance route) and its Location/Budget gates, so disallowed
 * entries become deterministic no-ops rather than being skipped. That keeps the
 * fold honest about the resolver's draw-and-gate behaviour while staying model
 * free and bounded for CI.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type PublicText,
} from '@tradecraft/content';
import {
  addPhases,
  createPrng,
  generate,
  resolve,
  ScenarioConfigSchema,
  type Action,
  type GameTime,
  type GenerateInputs,
  type LocId,
  type ResolverContext,
  type TurnId,
  type WorldState,
} from '@tradecraft/engine';

import { ActionLog } from '../api/turn-pipeline.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors the sibling view specs)
// ---------------------------------------------------------------------------

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'content',
  'packs',
  'core',
);

function loadCore(): {
  content: ContentSet;
  cityData: CityData;
  descriptors: DescriptorData;
  publicTexts: readonly PublicText[];
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) throw new Error('core pack failed to load');
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) throw new Error('city.yaml failed to load');
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) throw new Error('descriptors.yaml failed to load');
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) throw new Error('public texts failed to load');
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const { content, cityData, descriptors, publicTexts } = loadCore();

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) return value;
  }
  throw new Error(`no difficulty preset ${id}`);
}

const STANDARD = preset('standard');

function scenario() {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: true,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function inputs(): GenerateInputs {
  return { content, preset: STANDARD, scenario: scenario(), cityData, descriptors, publicTexts };
}

/** The resolver context: the loaded content set (travel/wait need nothing more). */
const CTX: ResolverContext = { content };

// ---------------------------------------------------------------------------
// A generated, replayable action log
// ---------------------------------------------------------------------------

/**
 * One planned action in a replayable session. A `wait` always resolves and
 * advances the clock; a `travel` names a destination by index into the world's
 * Location ids (resolved against the regenerated world, so both runs pick the
 * same Location) and a countersurveillance flag that drives the resolver's only
 * PRNG draw.
 */
type Plan =
  | { readonly kind: 'wait'; readonly phases: 1 | 2 | 3 | 4 }
  | { readonly kind: 'travel'; readonly destIndex: number; readonly countersurveillance: boolean };

/** Turn a {@link Plan} into a concrete {@link Action} against a given world. */
function planToAction(plan: Plan, world: WorldState): Action {
  if (plan.kind === 'wait') {
    return { kind: 'wait', phases: plan.phases };
  }
  const locIds = Object.keys(world.city.locations) as LocId[];
  const to = locIds[plan.destIndex % locIds.length];
  return { kind: 'travel', to, countersurveillance: plan.countersurveillance };
}

/**
 * Replay a session: regenerate the world from `(seed, inputs)`, resume one PRNG
 * from the world's serialised `rng`, and fold the plan in order through the pure
 * {@link resolve}, recording each applied action into a real {@link ActionLog}
 * at a deterministically advanced {@link GameTime}. The PRNG's advanced state is
 * written back onto each next world so the serialised PRNG state is part of the
 * reproduced session. Returns the final world and the recorded action log — the
 * two things Property 14 asserts are reproduced identically.
 */
function replaySession(seed: string, plan: readonly Plan[]): {
  readonly world: WorldState;
  readonly log: ReturnType<ActionLog['all']>;
} {
  let world = generate(seed, inputs());
  const rng = createPrng(world.rng);
  const log = new ActionLog();
  let at: GameTime = world.time;

  plan.forEach((step, i) => {
    const action = planToAction(step, world);
    const { next } = resolve(world, action, rng, CTX);
    // Persist the advanced PRNG stream onto the world, exactly as a replay
    // through the pipeline would, so the serialised rng participates in equality.
    world = { ...next, rng: rng.state() };
    at = addPhases(at, step.kind === 'wait' ? step.phases : 1);
    log.append({ kind: 'action', turn: `turn:${i}` as TurnId, at, action });
  });

  return { world, log: log.all() };
}

// ---------------------------------------------------------------------------
// Input-space arbitraries (bounded for CI)
// ---------------------------------------------------------------------------

/** A varied, non-empty seed set to sweep the generator over. */
const SEEDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo-123',
  'z',
  'q1',
  'w2',
  'seed-99',
  'fox-trot',
];

const seedArb = fc.constantFrom(...SEEDS);

/** One planned action: a bounded wait or a travel to a world Location by index. */
const planStepArb: fc.Arbitrary<Plan> = fc.oneof(
  fc.record({
    kind: fc.constant('wait' as const),
    phases: fc.constantFrom<1 | 2 | 3 | 4>(1, 2, 3, 4),
  }),
  fc.record({
    kind: fc.constant('travel' as const),
    destIndex: fc.nat({ max: 64 }),
    countersurveillance: fc.boolean(),
  }),
);

/** A bounded action log: 1..8 planned actions, enough to exercise the fold. */
const planArb: fc.Arbitrary<readonly Plan[]> = fc.array(planStepArb, {
  minLength: 1,
  maxLength: 8,
});

/**
 * `generate` runs the full core stream and the fold then resolves up to eight
 * actions, all twice per sample, so the sample count is tuned to keep each
 * property comfortably inside its widened budget while still sweeping many
 * seeds and plans.
 */
const NUM_RUNS = 30;
const PROPERTY_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Property 14 — replay determinism (Requirement 17.4)
// ---------------------------------------------------------------------------

describe('Property 14: replay determinism (Req 17.4)', () => {
  // Core: two replays of the same seed and action log reach a deep-equal final
  // WorldState and a deep-equal action log. This is Property 1 (deterministic
  // generate) composed with the pure resolver fold (same draws, same gates).
  it(
    'replaying the same seed and action log reproduces an identical session (world + action log)',
    () => {
      fc.assert(
        fc.property(seedArb, planArb, (seed, plan) => {
          const first = replaySession(seed, plan);
          const second = replaySession(seed, plan);

          // The reproduced world is byte-for-byte identical (including the
          // serialised PRNG state), and so is the recorded action log.
          expect(second.world).toEqual(first.world);
          expect(second.log).toEqual(first.log);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  // Determinism is value equality, not reference equality: a fresh replay builds
  // a distinct object graph that is nonetheless deep-equal. This guards against
  // a "replay" that only matched because it handed back the same mutable world.
  it(
    'the two reproduced worlds are deep-equal but distinct object instances',
    () => {
      fc.assert(
        fc.property(seedArb, planArb, (seed, plan) => {
          const first = replaySession(seed, plan);
          const second = replaySession(seed, plan);
          expect(second.world).not.toBe(first.world);
          expect(second.world).toEqual(first.world);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  // The reproduced action log carries the applied actions in `seq` order at the
  // deterministically advanced times — the ordered action log Req 17.5/17.4 is
  // replayed from.
  it(
    'the reproduced action log is in seq order with one entry per planned action',
    () => {
      fc.assert(
        fc.property(seedArb, planArb, (seed, plan) => {
          const { log } = replaySession(seed, plan);
          expect(log).toHaveLength(plan.length);
          log.forEach((entry, i) => {
            expect(entry.seq).toBe(i);
            expect(entry.kind).toBe('action');
          });
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  // Sanity (divergence): distinct seeds generally reach distinct sessions, so
  // the equality above is pinning determinism rather than collapsing every
  // input to one world. Phrased over distinct seeds with the same plan; a
  // collision would itself be a determinism/entropy bug worth surfacing.
  it(
    'distinct seeds with the same action log generally diverge',
    () => {
      fc.assert(
        fc.property(seedArb, seedArb, planArb, (s1, s2, plan) => {
          fc.pre(s1 !== s2);
          const a = replaySession(s1, plan);
          const b = replaySession(s2, plan);
          expect(b.world).not.toEqual(a.world);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});
