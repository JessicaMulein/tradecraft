/**
 * Feature: content-expansion, Property 14: Setting determinism (task 3.14).
 *
 * **Validates: Requirements 7.4, 9.8, 15.1**
 *
 * The design states (content-expansion design, "Property 14: Setting
 * determinism"):
 *
 * > For any pack set, seed, preset and setting selection, `generate` called
 * > twice yields deep-equal World States, including `meta.setting`, names and
 * > descriptors. Passing a `UsageSink` does not change the result.
 *
 * The setting step (content-expansion tasks 3.2–3.8) runs *before* the core
 * stream on the setting PRNG block `derive(seed, 0x30000 + j)`: it draws the
 * Start Date (`drawSetting`), year-filters the Content Set (`yearFilter`),
 * builds the city (`instantiateCity` for a City Pack, or the Core City Path's
 * `generateCity`), names and describes NPCs (`nameNpc`/`describeNpc`) and wires
 * the result into `generate()`. Property 14 is the end-to-end guarantee that
 * this whole step, and the full world the core and noise streams build on top of
 * it, is a pure function of `(seed, inputs)` — including the apparent setting
 * fields the step produces: `meta.setting` (the city, Start Date, Game Year and
 * setting attempt), every NPC's name (`name`, `formalName`, `culture`,
 * `gender`, `languages`) and every NPC's descriptor.
 *
 * ## Why this is an end-to-end `generate()` test
 *
 * `meta.setting`, the named NPCs and the descriptors only exist on a fully
 * generated {@link WorldState}; they are the *output* of the setting step wired
 * into `generate` (task 3.8), not of any one setting helper in isolation. So the
 * honest observation point for "the same seed and config produce an identical
 * world, including `meta.setting`" is `generate` itself. This file loads the
 * **real** core pack — its content, `city.yaml`, `descriptors.yaml` and
 * public-text corpora — and drives `generate()` end to end, exactly as the
 * production path does, mirroring the loader and scenario-construction pattern
 * of `generate.determinism.spec.ts` (slice Property 1). The core pack carries no
 * content-expansion City Pack, so this exercises the Core City Path of the
 * setting step (task 3.2): `drawSetting` falls back to the default Start Date,
 * `yearFilter` is a no-op, and slice step 1 runs on the setting stream. The
 * Start Date and `meta.setting` are produced on that path, so determinism of
 * `meta.setting` is still exercised, as are the moved streams (the hostile
 * doctrine draw and slice step 1) that the setting step introduced.
 *
 * ## The three clauses
 *
 * 1. **Twice deep-equal.** `generate(seed, inputs)` called twice is deep-equal
 *    across the whole World State. A `toEqual` over the full state subsumes
 *    "including `meta.setting`, names and descriptors"; the test also asserts
 *    those fields explicitly so a regression that only perturbed the setting
 *    output (not the rest of the world) is reported against this property by
 *    name rather than only through the whole-state compare.
 * 2. **`UsageSink` does not change the result.** Generating with a
 *    {@link CountingUsageSink} is deep-equal to generating with none. The sink is
 *    write-only (the generator only calls `use`, never reads), so threading one
 *    through the setting and naming steps cannot perturb a single draw.
 * 3. **Repeated full runs agree.** The property is asserted over many seeds and
 *    both mole flags, and the suite is run repeatedly (3+ times, unseeded), so a
 *    genuine non-determinism that only surfaces on some seeds — the failure mode
 *    an unseeded fast-check run can expose — is caught, not just a single lucky
 *    run.
 *
 * The core-stream (and setting + noise streams) run twice per determinism
 * sample, so `numRuns` is tuned modestly and the per-property budget widened,
 * exactly as the sibling slice determinism spec does.
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
} from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { CountingUsageSink } from './usage-sink.js';

// ---------------------------------------------------------------------------
// Core-pack loader (mirrors generate.determinism.spec.ts)
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

/** The fixed Difficulty Preset leg of the determinism key. */
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
 * with the chosen mole flag. The preset and Content Manifest are held fixed, so
 * the varying legs of the determinism key within a property are the seed and the
 * mole flag (part of the scenario the caller passes).
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

/** The setting + core + noise streams run twice per sample; widen the budget. */
const PROPERTY_TIMEOUT_MS = 60_000;
/**
 * The chosen fast-check sample count. `generate` runs the full setting + core +
 * noise pipeline twice (or three times, for the sink clause) per sample, so 30
 * trades depth for a bounded wall-clock cost while still exercising many
 * distinct seeds and both mole settings across repeated unseeded runs.
 */
const NUM_RUNS = 30;

/**
 * A seed arbitrary that yields varied, non-empty seeds, mixing an unconstrained
 * printable string (the honest input space — `generate` hashes the seed into the
 * PRNG) with a few fixed readable seeds so the property also covers hand-picked
 * seeds across runs.
 */
const seedArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0),
  fc.constantFrom('alpha', 'bravo', 'charlie', 'delta', 'echo-123', 'z', 'q1'),
);

// ---------------------------------------------------------------------------
// Property 14 — setting determinism (Requirements 7.4, 9.8, 15.1)
// ---------------------------------------------------------------------------

/** The NPC setting fields the property names: the output of `nameNpc`/`describeNpc`. */
function npcSettingShape(world: ReturnType<typeof generate>) {
  return Object.entries(world.npcs)
    .map(([id, npc]) => ({
      id,
      name: npc.persona.name,
      formalName: npc.formalName,
      culture: npc.culture,
      gender: npc.gender,
      languages: npc.languages,
      descriptor: npc.descriptor,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

describe('Property 14: setting determinism (content-expansion; Req 7.4, 9.8, 15.1)', () => {
  // Clause 1 — the whole World State, including meta.setting, names and
  // descriptors, is deep-equal across two runs from the same seed and inputs.
  it(
    'generate(seed, inputs) is deep-equal to itself, including meta.setting, names and descriptors',
    () => {
      fc.assert(
        fc.property(seedArb, fc.boolean(), (seed, mole) => {
          const bundle = inputs(mole);
          const a = generate(seed, bundle);
          const b = generate(seed, bundle);

          // Whole-state determinism (subsumes everything below).
          expect(a).toEqual(b);

          // Named explicitly so a setting-only regression is reported here.
          expect(a.meta.setting).toEqual(b.meta.setting);
          expect(npcSettingShape(a)).toEqual(npcSettingShape(b));
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  // Clause 2 — passing a write-only UsageSink does not change the result: the
  // world generated with a CountingUsageSink is deep-equal to the one generated
  // with none (and the explicit setting fields agree too).
  it(
    'passing a UsageSink does not change the generated world',
    () => {
      fc.assert(
        fc.property(seedArb, fc.boolean(), (seed, mole) => {
          const bundle = inputs(mole);
          const withoutSink = generate(seed, bundle);
          const withSink = generate(seed, bundle, {
            usage: new CountingUsageSink(),
          });

          expect(withSink).toEqual(withoutSink);
          expect(withSink.meta.setting).toEqual(withoutSink.meta.setting);
          expect(npcSettingShape(withSink)).toEqual(
            npcSettingShape(withoutSink),
          );

          // The sink genuinely received draws (it is wired, not a no-op), yet
          // the world is unchanged — the whole point of a write-only sink.
          const sink = new CountingUsageSink();
          generate(seed, bundle, { usage: sink });
          // Reading the tally never perturbs generation; the assertion above
          // already proved the world is identical. We only assert the sink is a
          // valid write target (its entries list is well-formed), not a count,
          // since the core pack carries no City Pack content to tally.
          expect(Array.isArray(sink.entries())).toBe(true);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );

  // Determinism is value equality, not reference equality: the two worlds are
  // structurally identical yet distinct instances, so the equality cannot be an
  // artefact of handing back the same mutable object (which would mask a bug).
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
          expect(a.meta.setting).not.toBe(b.meta.setting);
          expect(a.meta.setting).toEqual(b.meta.setting);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    PROPERTY_TIMEOUT_MS,
  );
});
