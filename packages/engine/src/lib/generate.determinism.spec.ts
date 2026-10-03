/**
 * Property test for seed determinism (design "Properties", Property 1; task
 * 5.10).
 *
 * **Property 1: Seed determinism.** For any seed and fixed
 * `(generatorVersion, ContentManifest, DifficultyPreset)`, `generate()`
 * produces an IDENTICAL {@link WorldState}. Equivalently: generating twice from
 * the same seed and inputs yields deep-equal World States, and distinct seeds
 * yield different worlds with overwhelming probability.
 *
 * **Validates: Requirements 1.1, 1.2**
 *
 * This file is deliberately separate from `generate.spec.ts` (which another
 * task may touch concurrently): it owns a distinct filename and reuses that
 * spec's loader + inputs + scenario-construction pattern so the two never
 * collide. It loads the *real* core pack — its content, `city.yaml`,
 * `descriptors.yaml` and public-text corpora — and drives `generate()` end to
 * end, exactly as the production path does.
 *
 * `generate` runs the full core stream (steps 1–9) twice per determinism check,
 * so the fast-check `numRuns` is tuned to 40: enough samples to exercise varied
 * seeds and both mole settings while keeping each property well under its
 * timeout. The per-property budget is widened via the vitest `timeout`
 * argument to leave head-room on a cold machine.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

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
  ScenarioConfigSchema,
  type ScenarioConfig,
} from './config/scenario-config.js';
import {
  GENERATOR_VERSION,
  generate,
  type GenerateInputs,
} from './generate.js';

// ---------------------------------------------------------------------------
// Core-pack loader (mirrors generate.spec.ts / discovery.spec.ts)
// ---------------------------------------------------------------------------

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
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
  if (!content.ok) {
    throw new Error(
      `core pack failed to load:\n${content.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) {
    throw new Error('city.yaml failed to load');
  }
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) {
    throw new Error('descriptors.yaml failed to load');
  }
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) {
    throw new Error('public texts failed to load');
  }
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
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

/** The fixed Difficulty Preset leg of the determinism key (Req 1.2). */
const STANDARD = preset('standard');

/** A minimal valid scenario config, with the mole flag the caller chooses. */
function scenario(mole: boolean): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: {
        trust: 1,
        riskAversion: 1,
        scheduleConflict: 1,
        agendaInterest: 1,
      },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

/**
 * The {@link GenerateInputs} bundle: the real core pack's content and pack data
 * with the chosen mole flag. The preset and the Content Manifest are held fixed
 * across the whole file, so the only varying leg of the determinism key within
 * a property is the seed (plus the mole flag, which is part of the scenario the
 * caller passes).
 */
function inputs(mole = false): GenerateInputs {
  return {
    content,
    preset: STANDARD,
    scenario: scenario(mole),
    cityData,
    descriptors,
    publicTexts,
  };
}

/** The core-stream runs twice per sample, so widen the per-property budget. */
const PROPERTY_TIMEOUT_MS = 60_000;
/**
 * The chosen fast-check sample count. `generate` runs the full core stream
 * twice per determinism sample, so 40 trades depth for a bounded wall-clock
 * cost while still exercising many distinct seeds and both mole settings.
 */
const NUM_RUNS = 40;

/**
 * A seed arbitrary that yields varied, non-empty seeds. `generate` takes an
 * arbitrary string seed (it is hashed into the PRNG), so an unconstrained
 * printable string is the honest input space; `map` keeps it non-empty and
 * `fc.pre`-free so every sample is a usable seed. A few fixed, readable seeds
 * are mixed in via `oneof` so the property also covers the hand-picked seeds
 * the sibling spec uses.
 */
const seedArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .string({ minLength: 1, maxLength: 24 })
    .filter((s) => s.trim().length > 0),
  fc.constantFrom('alpha', 'bravo', 'charlie', 'delta', 'echo-123', 'z', 'q1'),
);

// ---------------------------------------------------------------------------
// Property 1 — seed determinism (Requirements 1.1, 1.2)
// ---------------------------------------------------------------------------

describe('Property 1: seed determinism (Req 1.1, 1.2)', () => {
  // Core property: generating twice from the same seed + inputs is deep-equal.
  // Both mole settings are in the input space, since the mole flag is part of
  // the scenario leg of the determinism key.
  it(
    'generate(seed, inputs) deep-equals generate(seed, inputs) for any seed and mole flag',
    () => {
      fc.assert(
        fc.property(seedArb, fc.boolean(), (seed, mole) => {
          const bundle = inputs(mole);
          const a = generate(seed, bundle);
          const b = generate(seed, bundle);
          expect(a).toEqual(b);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  // Distinctness: two *different* seeds produce worlds that are not deep-equal.
  // Overwhelming probability, not a certainty, so this is phrased over pairs of
  // distinct seeds drawn from the same arbitrary; a collision would be a real
  // determinism/entropy bug worth surfacing rather than a flaky test.
  it(
    'distinct seeds produce worlds that are not deep-equal',
    () => {
      fc.assert(
        fc.property(seedArb, seedArb, fc.boolean(), (s1, s2, mole) => {
          fc.pre(s1 !== s2);
          const bundle = inputs(mole);
          const a = generate(s1, bundle);
          const b = generate(s2, bundle);
          expect(a).not.toEqual(b);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  // Determinism is value equality, not reference equality: the two worlds are
  // structurally identical yet are distinct object instances (generate builds a
  // fresh WorldState each call). This guards against a bug where equality only
  // "holds" because the same mutable object was handed back twice.
  it(
    'the two deterministic worlds are deep-equal but not the same reference',
    () => {
      fc.assert(
        fc.property(seedArb, fc.boolean(), (seed, mole) => {
          const bundle = inputs(mole);
          const a = generate(seed, bundle);
          const b = generate(seed, bundle);
          expect(a).not.toBe(b);
          expect(a).toEqual(b);
          // A nested sub-structure is likewise a fresh instance, not shared.
          expect(a.city).not.toBe(b.city);
          expect(a.city).toEqual(b.city);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  // The determinism contract pieces generate records (Req 1.2): the display
  // seed, the generator version and the Content Manifest are stable across the
  // two runs and carry the expected values.
  it(
    'records the seed, generator version and content manifest consistently',
    () => {
      fc.assert(
        fc.property(seedArb, fc.boolean(), (seed, mole) => {
          const bundle = inputs(mole);
          const a = generate(seed, bundle);
          const b = generate(seed, bundle);
          expect(a.meta.seed).toBe(seed);
          expect(b.meta.seed).toBe(seed);
          expect(a.meta.generatorVersion).toBe(GENERATOR_VERSION);
          expect(b.meta.generatorVersion).toBe(GENERATOR_VERSION);
          expect(a.meta.content).toBe(content.manifest);
          expect(b.meta.content).toBe(a.meta.content);
          expect(a.meta.preset).toBe(STANDARD);
          expect(a.meta.scenario.mole).toBe(mole);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});
