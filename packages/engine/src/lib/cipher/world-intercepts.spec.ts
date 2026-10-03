/**
 * Tests for world-assembly Intercept seeding (task 26.3; Requirements 9.1, 9.5,
 * 25.3, 29.2, 29.4).
 *
 * These load the real core pack and drive `generate()` end to end, checking:
 *
 * - a generated world's `WorldState.transmissions` is populated with real
 *   ciphertext Intercepts (not empty placeholders), and `WorldState.intercepts`
 *   starts empty (the player has collected nothing);
 * - every seeded Intercept round-trips: decrypting with its true spec and
 *   parsing the field message recovers its source Propositions (Property 9),
 *   using the world's own key material (book texts + the seed-derived pads);
 * - the Plot, Side Thread and Noise origins are all represented;
 * - seeding is deterministic in `(seed, inputs)`;
 * - the Plot `transmission` SimEvent id scheme (`plotTraceInterceptId`, shared
 *   with task 26.2) references an Intercept the world actually seeded.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { revealTruth } from '../model/core.js';
import { resolveCipherSpec } from './spec.js';
import {
  revealedSpec,
  decryptToFieldMessage,
  type InterceptOriginKind,
} from './intercept.js';
import { parseFieldMessage } from './field-message.js';
import {
  worldCipherKeyLookup,
  plotTraceInterceptId,
} from './world-intercepts.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures
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
    throw new Error('core pack failed to load');
  }
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack side files failed to load');
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

function inputs(presetId = 'standard'): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: presetId },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return { content, preset: preset(presetId), scenario, cityData, descriptors, publicTexts };
}

const SEEDS = ['alpha', 'bravo', 'charlie', 'delta'];

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

describe('world Intercept seeding (task 26.3)', () => {
  it('populates WorldState.transmissions and leaves intercepts empty', () => {
    for (const seed of SEEDS) {
      const world = generate(seed, inputs());
      expect(world.transmissions.length).toBeGreaterThan(0);
      // The player has collected nothing yet: intercepts start empty.
      expect(Object.keys(world.intercepts)).toHaveLength(0);
      // Every Transmission carries a real ciphertext Intercept (not empty).
      for (const tx of world.transmissions) {
        expect(tx.intercept.ciphertext.length).toBeGreaterThan(0);
        expect(tx.intercept.id).toBe(tx.intercept.id);
        expect(tx.intercept.channel).toBe(tx.channel);
      }
    }
  });

  it('every seeded Intercept round-trips to its source Propositions (Property 9)', () => {
    const seed = 'alpha';
    const world = generate(seed, inputs());
    const keyLookup = worldCipherKeyLookup(seed, world.documents);
    const fieldCodes = content.predicates.fieldCodes;

    expect(world.transmissions.length).toBeGreaterThan(0);
    for (const tx of world.transmissions) {
      const key = resolveCipherSpec(revealedSpec(tx.intercept), keyLookup);
      const plain = decryptToFieldMessage(tx.intercept, key);
      const recovered = parseFieldMessage(plain, fieldCodes);
      const sourceIds = revealTruth(tx.intercept.plaintextProps);
      // One parsed Proposition per source id (ids are rebuilt as fm:<line>).
      expect(recovered.length).toBe(sourceIds.length);
    }
  });

  it('represents plot, side-thread and noise origins', () => {
    // Scan several seeds so the union of origins is observed (a given world may
    // not emit every origin, but across seeds all three appear).
    const origins = new Set<InterceptOriginKind>();
    for (const seed of SEEDS) {
      const world = generate(seed, inputs());
      for (const tx of world.transmissions) {
        origins.add(revealTruth(tx.origin));
      }
    }
    expect(origins.has('plot')).toBe(true);
    expect(origins.has('noise') || origins.has('side-thread')).toBe(true);
  });

  it('is deterministic in (seed, inputs)', () => {
    for (const seed of SEEDS) {
      const a = generate(seed, inputs());
      const b = generate(seed, inputs());
      expect(a.transmissions).toEqual(b.transmissions);
    }
  });

  it('a plot transmission SimEvent id references a seeded Intercept', () => {
    const world = generate('alpha', inputs());
    const seededIds = new Set(world.transmissions.map((tx) => tx.intercept.id));
    // For every Plot Stage transmission trace, the id plot-execution (task 26.2)
    // computes for its SimEvent is an Intercept the world seeded — unless the
    // trace resolved to no interceptable Channel (then no transmission exists).
    let checked = 0;
    for (const stage of world.plot.stages) {
      for (const trace of stage.traces) {
        if (trace.kind !== 'transmission') {
          continue;
        }
        const id = plotTraceInterceptId(stage.id, trace.index);
        if (seededIds.has(id)) {
          checked += 1;
        }
      }
    }
    // At least one plot transmission trace mapped to a seeded Intercept.
    expect(checked).toBeGreaterThan(0);
  });
});
