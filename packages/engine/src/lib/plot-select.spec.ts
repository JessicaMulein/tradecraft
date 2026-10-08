/**
 * Posting plot selection: history rows, the uniform fallback, and step 4
 * leaving an ordinary game on the slice draw.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type DifficultyPreset,
} from '@tradecraft/content';
import { describe, expect, it } from 'vitest';

import { ScenarioConfigSchema, type ScenarioConfig } from './config/scenario-config.js';
import { generate, type GenerateInputs } from './generate.js';
import { createPrng } from './prng/prng.js';
import {
  fallbackSelect,
  selectPlot,
  toTemplateHistory,
  type PlotSelectHistory,
} from './plot-select.js';
import type { SelectionInput } from './plotgen/select.js';

const CORE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'packs', 'core');

function history(templateIds: readonly string[], year = 1948): PlotSelectHistory {
  return {
    templateHistory: templateIds.map((templateId) => ({
      templateId,
      variantKey: 'v',
      archetype: 'sabotage',
      outcome: 'success',
    })),
    context: { year },
  };
}

describe('toTemplateHistory', () => {
  it('emits one row per schema-2 plot, in posting order', () => {
    const rows = toTemplateHistory([
      {
        plots: [
          { templateId: 'rail-junction', variantKey: 'a', archetype: 'sabotage', outcome: 'success' },
          { templateId: 'side', variantKey: 'b', archetype: 'smuggling', outcome: 'failure' },
        ],
      },
      {},
      {
        plots: [
          { templateId: 'cipher-clerk', variantKey: 'c', archetype: 'mole', outcome: 'success' },
        ],
      },
    ]);
    expect(rows.map((row) => row.templateId)).toEqual(['rail-junction', 'side', 'cipher-clerk']);
  });
});

describe('fallbackSelect', () => {
  const candidates = [{ id: 'core/alpha' }, { id: 'beta' }, { id: 'core/gamma' }];

  it('skips templates already in the history, and uses all of them once every one has been used', () => {
    const fresh = fallbackSelect(candidates, [{ templateId: 'alpha' }], createPrng('fresh'));
    expect(fresh).not.toBe('core/alpha');
    expect(fallbackSelect(candidates, [{ templateId: 'alpha' }], createPrng('fresh'))).toBe(fresh);

    const any = fallbackSelect(
      candidates,
      [{ templateId: 'alpha' }, { templateId: 'core/beta' }, { templateId: 'gamma' }],
      createPrng('all'),
    );
    expect(['core/alpha', 'beta', 'core/gamma']).toContain(any);
  });
});

describe('selectPlot', () => {
  it('uses the fallback when plot-library has nothing eligible', () => {
    const candidates = [{ id: 'core/alpha' }, { id: 'beta' }];
    const played = history(['core/alpha']);
    const input = {
      templates: [],
      city: { binders: () => [], archetypesWithTags: () => [] },
      preset: { id: 'standard', plot: { stageCount: 4, deadlineSlackDays: 2 } },
      year: 1949,
      excluded: [],
    } as unknown as Omit<SelectionInput, 'history' | 'context'>;
    expect(selectPlot(played, null, candidates, createPrng('fall'))).toBe(
      fallbackSelect(candidates, played.templateHistory, createPrng('fall')),
    );
    expect(selectPlot(played, input, candidates, createPrng('fall'))).toBe('beta');
  });
});

describe('generate step 4', () => {
  const loaded = loadContent([CORE], ['core']);
  if (!loaded.ok) {
    throw new Error(loaded.errors.map((error) => error.message).join('; '));
  }
  const cityData = loadCityData(CORE);
  const descriptors = loadDescriptorData(CORE);
  const publicTexts = loadPublicTexts(CORE);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack data failed to load');
  }
  const city = cityData.value;
  const descriptorData = descriptors.value;
  const texts = publicTexts.value;
  const content = loaded.value;
  const preset = [...content.difficultyPresets.values()].find((row) => row.id === 'standard');
  if (preset === undefined) {
    throw new Error('missing standard preset');
  }

  function inputs(): GenerateInputs {
    const scenario: ScenarioConfig = ScenarioConfigSchema.parse({
      difficulty: { preset: 'standard' },
      mole: false,
      recruitment: {
        pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
        firstContact: { a: 1, b: 1, c: 1, d: 1 },
        meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
        exposure: { k1: 1, k2: 1, k3: 1 },
        turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
      },
    });
    return {
      content,
      preset: preset as DifficultyPreset,
      scenario,
      cityData: city,
      descriptors: descriptorData,
      publicTexts: texts,
    };
  }

  it('matches a game with no posting when the history is empty', () => {
    const plain = generate('posting-plot', inputs());
    const posted = generate('posting-plot', inputs(), {
      posting: { history: history([]), selection: null },
    });
    expect(posted).toEqual(plain);
  });

  it('will not repeat a template the history already holds', () => {
    const templates = [...content.plotTemplates.values()];
    const keep = templates[0];
    if (keep === undefined) {
      throw new Error('no plot templates');
    }
    const used = templates.slice(1).map((template) => template.id);
    const world = generate('posting-plot', inputs(), {
      posting: { history: history(used), selection: null },
    });
    expect(world.plot.template).toBe(keep.id);
  });
});
