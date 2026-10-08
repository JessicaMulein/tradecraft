/**
 * Property 3: carry-over is a pure function of the campaign state and the
 * posting result. A valid result grows the archive by one, advances the year
 * by the tour length plus any years lost, and stages each surviving asset
 * once. A single corrupt field is rejected with that field's path, and the
 * state is left unchanged.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asTruth, type NpcId } from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { carryOver } from './carry-over.js';
import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { loadCampaignConfig } from './config.js';
import { step } from './reducer.js';
import type { CampaignChoice, CampaignState, PostingResult } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(loaded.value, campaignSources([CORE], new Set(['core'])).sources);
const config = loadCampaignConfig(join(ROOT, 'config', 'campaign.yaml'));
if (!config.ok) {
  throw new Error(config.issues.map((issue) => issue.message).join('; '));
}

const created = step(undefined, {
  kind: 'choice',
  choice: {
    kind: 'create',
    seed: 'career-seed',
    preset: 'standard',
    officerName: 'Ada',
    background: 'analyst',
    startYear: 1948,
  } satisfies Extract<CampaignChoice, { kind: 'create' }>,
}, content);
if (!created.ok) {
  throw new Error(created.error.kind);
}
const base = created.value;
const manifest = base.manifests[0];
if (manifest === undefined) {
  throw new Error('missing manifest');
}

const CORRUPTIONS = [
  'schema',
  'index',
  'plotTemplate',
  'decrypts',
  'standing',
  'budget',
  'service',
  'debrief',
] as const;

type Capture =
  | undefined
  | { readonly kind: 'death' }
  | { readonly kind: 'exchange' | 'imprisonment'; readonly yearsLost: number; readonly defectionOffer: boolean };

const sampleArb = fc.record({
  year: fc.integer({ min: 1948, max: 1962 }),
  tourYears: fc.constantFrom(1 as const, 2 as const, 3 as const),
  capture: fc.oneof(
    fc.constant(undefined),
    fc.constant({ kind: 'death' as const }),
    fc.record({
      kind: fc.constantFrom('exchange' as const, 'imprisonment' as const),
      yearsLost: fc.integer({ min: 0, max: 5 }),
      defectionOffer: fc.boolean(),
    }),
  ),
  index: fc.integer({ min: 0, max: 4 }),
  outcome: fc.constantFrom('success' as const, 'failure-plot' as const, 'failure-burned' as const),
  standing: fc.double({ min: -20, max: 20, noNaN: true }),
  suspicion: fc.double({ min: 0, max: 1, noNaN: true }),
  knownCover: fc.boolean(),
  assets: fc.uniqueArray(fc.integer({ min: 1, max: 30 }), { maxLength: 4 }),
  corruption: fc.constantFrom(...CORRUPTIONS),
});

function yearsLost(capture: Capture): number {
  if (capture === undefined || capture.kind === 'death') {
    return 0;
  }
  return capture.yearsLost;
}

function campaignState(sample: { year: number; tourYears: 1 | 2 | 3; capture: Capture }): CampaignState {
  const staged =
    sample.capture === undefined
      ? base.view.staged
      : { ...base.view.staged, capture: sample.capture };
  return {
    ...base,
    calendar: { year: sample.year },
    step: { kind: 'posting', ctx: { index: 0, seed: 'posting-seed' } },
    view: {
      ...base.view,
      chosen: 'offer-1',
      offers: [
        {
          id: 'offer-1',
          city: 'core',
          service: 'svc-east',
          year: sample.year,
          tourYears: sample.tourYears,
          tier: 'standard',
          theme: 'surveillance',
          assigned: false,
        },
      ],
      staged,
    },
  };
}

function postingResult(sample: {
  index: number;
  outcome: 'success' | 'failure-plot' | 'failure-burned';
  standing: number;
  suspicion: number;
  knownCover: boolean;
  assets: readonly number[];
}): PostingResult {
  return {
    schema: 1,
    index: sample.index,
    plotTemplate: 'rail-junction',
    plots: [
      {
        templateId: 'rail-junction',
        variantKey: 'rail-junction@1',
        archetype: 'sabotage',
        role: 'primary',
        outcome: 'disrupted',
      },
    ],
    stats: {
      decrypts: 0,
      recruits: 0,
      turned: 0,
      surveilObservations: 0,
      followsCompleted: 0,
      arrestsCorrect: 0,
      arrestsWrongful: 0,
      madeFactLines: 0,
      meetingsHeld: 0,
      dropsServiced: 0,
    },
    carry: {
      identified: [],
      unidentified: [],
      heldClaims: [],
      grades: [],
      notes: [],
      observedBurns: [],
    },
    debrief: {
      full: asTruth({ outcome: sample.outcome, cause: 'ended', sections: [] }),
      redacted: { sections: [] },
    },
    extract: asTruth({
      survivingHostiles: [],
      assets: [],
      arcClues: [],
      service: 'svc-east',
      cityId: 'core',
    }),
    outcome: {
      schema: 1,
      outcome: sample.outcome,
      endedAt: { day: 10, phase: 1 },
      seed: 'posting-seed',
      generatorVersion: '0.7.0',
      content: manifest,
      difficulty: 'standard',
      standing: sample.standing,
      directives: [],
      survivingAssets: sample.assets.map((n) => ({
        npc: `npc:cp-${n}` as NpcId,
        archetype: 'courier',
        persona: { name: `Asset ${n}`, culture: 'de', background: 'clerk' },
        lever: 'ego' as const,
        trust: 0.5,
        exposure: 0.1,
        doubled: false,
      })),
      cover: { identity: 'clerk', blown: sample.knownCover, suspicion: sample.suspicion },
      hostileMemory: {
        knownCover: sample.knownCover,
        suspectedAssets: [],
        compromisedChannels: [],
        compromisedDrops: [],
        doctrineShift: {},
      },
      budgetRemaining: 0,
    },
  };
}

function corrupt(result: PostingResult, which: (typeof CORRUPTIONS)[number]): {
  readonly result: PostingResult;
  readonly path: string;
} {
  if (which === 'schema') {
    return { result: { ...result, schema: 2 } as unknown as PostingResult, path: 'schema' };
  }
  if (which === 'index') {
    return { result: { ...result, index: -1 }, path: 'index' };
  }
  if (which === 'plotTemplate') {
    return { result: { ...result, plotTemplate: 4 } as unknown as PostingResult, path: 'plotTemplate' };
  }
  if (which === 'decrypts') {
    return {
      result: { ...result, stats: { ...result.stats, decrypts: 'x' } } as unknown as PostingResult,
      path: 'stats.decrypts',
    };
  }
  if (which === 'standing') {
    return {
      result: { ...result, outcome: { ...result.outcome, standing: 'no' } } as unknown as PostingResult,
      path: 'outcome.standing',
    };
  }
  if (which === 'budget') {
    return {
      result: { ...result, outcome: { ...result.outcome, budgetRemaining: null } } as unknown as PostingResult,
      path: 'outcome.budgetRemaining',
    };
  }
  if (which === 'service') {
    return {
      result: { ...result, extract: { ...result.extract, service: 1 } } as unknown as PostingResult,
      path: 'extract.service',
    };
  }
  return {
    result: { ...result, debrief: { ...result.debrief, full: { ...result.debrief.full, outcome: 1 } } } as unknown as PostingResult,
    path: 'debrief.full.outcome',
  };
}

describe('carry-over property', () => {
  it('folds a valid result purely and rejects one corrupt field', () => {
    // Feature: campaign-career, Property 3: Carry-Over purity and validation
    fc.assert(
      fc.property(sampleArb, (sample) => {
        const state = campaignState(sample);
        const result = postingResult(sample);
        const stateBefore = JSON.stringify(state);
        const resultBefore = JSON.stringify(result);
        const first = carryOver(state, result, content, config.value);
        const second = carryOver(state, result, content, config.value);
        expect(JSON.stringify(state)).toBe(stateBefore);
        expect(JSON.stringify(result)).toBe(resultBefore);
        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
        if (!first.ok || !second.ok) {
          return;
        }
        expect(second.value).toEqual(first.value);
        expect(first.value.archive.visible).toHaveLength(state.archive.visible.length + 1);
        expect(first.value.truth.archive).toHaveLength(state.truth.archive.length + 1);
        expect(first.value.calendar.year).toBe(sample.year + sample.tourYears + yearsLost(sample.capture));
        const stagedIds = first.value.truth.stagedAssets.map((asset) => asset.person.id);
        expect(stagedIds).toEqual(sample.assets.map((n) => `cp-${n}`));
        expect(new Set(stagedIds).size).toBe(stagedIds.length);

        const broken = corrupt(result, sample.corruption);
        const brokenState = JSON.stringify(state);
        const rejected = carryOver(state, broken.result, content, config.value);
        expect(rejected.ok).toBe(false);
        if (rejected.ok) {
          return;
        }
        expect(rejected.error.paths).toContain(broken.path);
        expect(JSON.stringify(state)).toBe(brokenState);
      }),
      { numRuns: 100 },
    );
  });
});
