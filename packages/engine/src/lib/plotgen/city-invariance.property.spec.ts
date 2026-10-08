/**
 * Property 18: City invariance under selection (plot-library Req 14.4).
 *
 * The setting step produces Districts, Locations and Routes before plot
 * selection. Two generations that share a seed, preset, setting selection and
 * setting attempt must deep-equal on that geography even when their Template
 * Histories differ, and selection must not rewrite the city it was given.
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
  PlotTemplateV2Schema,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type PlotTemplateV2,
  type PublicText,
} from '@tradecraft/content';

import { isContentSetV2 } from '../setting/content-set-v2.js';

import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import {
  settingGeography,
  type GenerateInputs,
  type SettingGeography,
} from '../generate.js';
import { createPrng } from '../prng/prng.js';
import type { BindCity } from './bind.js';
import { buildLibrarySession, LibrarySelectionError } from './library.js';
import type { TemplateHistory, TemplateHistoryEntry } from './select.js';

const PACKS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'content', 'packs');
const CORE_DIR = join(PACKS, 'core');
const VIENNA_SELECT = [
  'core',
  'era-cold-war-early',
  'lib-central-europe',
  'lib-russian',
  'city-vienna',
] as const;

function loadMerged(): ContentSet {
  const result = loadContent(
    VIENNA_SELECT.map((id) => join(PACKS, id)),
    [...VIENNA_SELECT],
  );
  if (!result.ok) {
    throw new Error(
      `content failed to load:\n${result.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  if (!isContentSetV2(result.value)) {
    throw new Error('merged set is not a content-expansion ContentSetV2');
  }
  return result.value;
}

function loadCoreFiles(): {
  cityData: CityData;
  descriptors: DescriptorData;
  publicTexts: readonly PublicText[];
} {
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core city data, descriptors, or public texts failed to load');
  }
  return {
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const content = loadMerged();
const { cityData, descriptors, publicTexts } = loadCoreFiles();

function presetOf(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

function scenario(city: string): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    setting: { city },
    mole: false,
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

function inputsFor(city: string, preset: DifficultyPreset): GenerateInputs {
  return {
    content,
    preset,
    scenario: scenario(city),
    cityData,
    descriptors,
    publicTexts,
  };
}

function stage(id: string, requires: string[] = []) {
  return {
    id,
    requires,
    deadline: { min: 2, max: 4 },
    traces: [
      {
        kind: 'meeting' as const,
        roles: ['leader'],
        evidences: ['LOCATED_AT'],
        text: 'A watcher keeps a quiet note of who comes and goes.',
      },
      {
        kind: 'transmission' as const,
        roles: ['leader'],
        channel: 'radio' as const,
        evidences: ['LOCATED_AT'],
        text: 'A short signal leaves the set.',
      },
    ],
  };
}

function plot(id: string, archetype: string, allowWith: string[]): PlotTemplateV2 {
  return PlotTemplateV2Schema.parse({
    id,
    templateSchema: 2,
    kind: 'plot',
    displayName: id,
    archetype,
    era: { from: 1900, to: 2100 },
    concurrency: { tags: [archetype], allowWith },
    params: { venue: { kind: 'loc', query: ['function:cafe'], group: 'venues' } },
    roleSlots: { leader: { query: ['role:cell'] } },
    cells: [{ id: 'action', roles: ['leader'] }],
    stages: [stage('open'), stage('close', ['open'])],
    stageCount: { min: 1, max: 4 },
    outcomes: {
      success: [{ kind: 'arrest-role', role: 'leader' }],
      failure: [{ kind: 'stage-completed', stage: 'close' }],
    },
  });
}

const TEMPLATES = [
  plot('alpha', 'sabotage', ['kompromat']),
  plot('beta', 'kompromat', ['sabotage']),
];

const WORLD = {
  hostileOrg: 'org:hostile',
  contacts: ['npc:contact'],
  stationStaff: ['npc:staff'],
  orgsForQuery: () => ['org:decoy'],
  npcsForQuery: () => ['npc:a', 'npc:b'],
};

/**
 * Location queries stay on the setting-step city. Role archetypes fall back
 * only when the setting step has not placed NPCs yet, which it never does:
 * principals are a later core-stream step.
 */
function selectionCity(bind: BindCity): BindCity {
  return {
    binders(kind, query) {
      const found = bind.binders(kind, query);
      if (kind === 'loc') {
        return found;
      }
      return found.length > 0 ? found : ['npc:a', 'npc:b'];
    },
    archetypesWithTags(query) {
      const found = bind.archetypesWithTags?.(query) ?? [];
      return found.length > 0 ? found : ['core/cell-leader'];
    },
    tags: (id) => bind.tags?.(id) ?? [],
  };
}

function geographyOf(geo: SettingGeography) {
  return {
    city: geo.city,
    attempt: geo.attempt,
    districts: geo.districts,
    locations: geo.locations,
    routes: geo.routes,
  };
}

function selectionCompletes(
  geo: SettingGeography,
  history: TemplateHistory,
  preset: DifficultyPreset,
  seed: string,
): boolean {
  try {
    const session = buildLibrarySession(
      {
        templates: TEMPLATES,
        city: selectionCity(geo.bind),
        preset: { id: preset.id, plot: preset.plot, twistProbability: 0 },
        year: geo.year,
        history,
        seed,
        world: WORLD,
      },
      createPrng(seed),
    );
    return session !== undefined;
  } catch (error) {
    if (error instanceof LibrarySelectionError) {
      return false;
    }
    throw error;
  }
}

const historyArb = fc.array(
  fc.record<TemplateHistoryEntry>({
    templateId: fc.constantFrom('alpha', 'beta', 'other'),
    variantKey: fc.constantFrom('1', '2'),
    archetype: fc.constantFrom('sabotage', 'kompromat'),
    outcome: fc.constantFrom('success', 'failure'),
  }),
  { minLength: 0, maxLength: 3 },
);

describe('Property 18: City invariance under selection', () => {
  it('keeps districts, locations and routes fixed across template histories', () => {
    // Feature: plot-library, Property 18: City invariance under selection
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.constantFrom('easy', 'standard', 'hard'),
        fc.constantFrom('core', 'city-vienna/vienna'),
        fc.integer({ min: 0, max: 2 }),
        historyArb,
        historyArb,
        (seed, presetId, cityId, attempt, leftHistory, rightHistory) => {
          fc.pre(JSON.stringify(leftHistory) !== JSON.stringify(rightHistory));
          const preset = presetOf(presetId);
          const inputs = inputsFor(cityId, preset);
          const left = settingGeography(seed, inputs, attempt);
          const right = settingGeography(seed, inputs, attempt);
          fc.pre(left !== undefined && right !== undefined);
          fc.pre(left.attempt === attempt && right.attempt === attempt);
          fc.pre(left.city === cityId && right.city === cityId);
          const before = geographyOf(left);
          expect(Object.keys(before.districts).length).toBeGreaterThan(0);
          expect(Object.keys(before.locations).length).toBeGreaterThan(0);
          expect(before.routes.length).toBeGreaterThan(0);
          expect(geographyOf(right)).toEqual(before);
          fc.pre(
            selectionCompletes(left, leftHistory, preset, seed) &&
              selectionCompletes(right, rightHistory, preset, seed),
          );
          expect(geographyOf(left)).toEqual(before);
          expect(geographyOf(right)).toEqual(before);
        },
      ),
      { numRuns: 100 },
    );
  });
});
