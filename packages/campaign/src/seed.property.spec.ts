/**
 * Property 2: for any campaign seed and any two choice logs, posting k gets
 * the same seed, `derive(campaignSeed, k)`. Generating that posting does not
 * read or advance the campaign stream.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadCityData,
  loadDescriptorData,
  loadPublicTexts,
  type DifficultyPreset,
} from '@tradecraft/content';
import { createPrng, generate, ScenarioConfigSchema, type GenerateInputs } from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { loadCampaignConfig } from './config.js';
import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import type { RecruitmentWeights } from './officer.js';
import { legendCity, quotePreparation } from './prepare.js';
import { buildPostingContext } from './posting.js';
import { step } from './reducer.js';
import { campaignStream, postingSeed } from './seed.js';
import type { CampaignChoice, CampaignState } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const cityData = loadCityData(CORE);
const descriptors = loadDescriptorData(CORE);
const publicTexts = loadPublicTexts(CORE);
if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
  throw new Error('core pack data failed to load');
}
const contentSet = loaded.value;
const city = cityData.value;
const descriptorData = descriptors.value;
const texts = publicTexts.value;
const content = campaignContent(contentSet, campaignSources([CORE], new Set(['core'])).sources);
const config = loadCampaignConfig(join(ROOT, 'config', 'campaign.yaml'));
if (!config.ok) {
  throw new Error(config.issues.map((issue) => issue.message).join('; '));
}
const preset = [...contentSet.difficultyPresets.values()].find(
  (row) => row.id === 'standard' || row.id.endsWith('/standard'),
);
if (preset === undefined) {
  throw new Error('standard preset missing');
}

const weights: RecruitmentWeights = {
  pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
  firstContact: { a: 1, b: 1, c: 1, d: 1 },
  meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
  exposure: { k1: 1, k2: 1, k3: 1 },
  turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
};

const scenario = ScenarioConfigSchema.parse({
  difficulty: { preset: 'standard' },
  mole: false,
  recruitment: weights,
});

function gameInputs(): GenerateInputs {
  return {
    content: contentSet,
    preset: preset as DifficultyPreset,
    scenario,
    cityData: city,
    descriptors: descriptorData,
    publicTexts: texts,
  };
}

function create(seed: string): Extract<CampaignChoice, { kind: 'create' }> {
  return {
    kind: 'create',
    seed,
    preset: 'standard',
    officerName: 'Ada',
    background: 'analyst',
    startYear: 1948,
  };
}

function mustStep(state: CampaignState | undefined, choice: CampaignChoice): CampaignState {
  const result = step(state, { kind: 'choice', choice }, content);
  if (!result.ok) {
    throw new Error(result.error.reason);
  }
  return result.value;
}

function drawCampaign(state: CampaignState, times: number): CampaignState {
  if (times === 0) {
    return state;
  }
  const rng = createPrng(state.rng);
  for (let i = 0; i < times; i += 1) {
    rng.next();
  }
  return { ...state, rng: rng.state() };
}

/**
 * Accept the first offer, optionally train or take leave, choose a legend,
 * and depart. `k` is the posting index already completed. The legend name and
 * the campaign-stream position differ between logs; the posting seed must not.
 */
function depart(seed: string, name: string, draws: number, k: number, train: boolean): CampaignState {
  let state = mustStep(undefined, create(seed));
  state = drawCampaign(state, draws);
  const offer = state.view.offers[0];
  if (offer === undefined) {
    throw new Error('no offer');
  }
  state = mustStep(state, { kind: 'accept-offer', offer: offer.id });
  if (k !== 0) {
    state = { ...state, postings: k };
  }
  const optional: CampaignChoice = train
    ? { kind: 'train', skill: content.skills[0]?.id ?? 'surveillance' }
    : { kind: 'leave' };
  if (quotePreparation(state, optional, content).allowed) {
    state = mustStep(state, optional);
  }
  state = mustStep(state, {
    kind: 'adopt-manifest',
    manifest: { schema: name.length, packs: [] },
  });
  const cover = legendCity(state, content).covers[0];
  if (cover !== undefined) {
    state = mustStep(state, { kind: 'legend', cover, name });
  } else {
    state = {
      ...state,
      view: {
        ...state.view,
        officer: {
          ...state.view.officer,
          legends: [
            ...state.view.officer.legends,
            {
              id: 'lg-1',
              cover: 'clerk',
              name,
              official: true,
              posting: state.postings,
              observedBurnedBy: [],
            },
          ],
        },
      },
    };
  }
  return mustStep(state, { kind: 'advance' });
}

function postingStep(state: CampaignState): { index: number; seed: string } {
  if (state.step.kind !== 'posting') {
    throw new Error(state.step.kind);
  }
  return state.step.ctx;
}

describe('posting seed independence', () => {
  it('gives posting k the same seed for any two logs, and generation leaves the campaign stream', () => {
    // Feature: campaign-career, Property 2: Posting seed independence
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        fc.stringMatching(/^[A-Z][a-z]{2,6}$/),
        fc.stringMatching(/^[A-Z][a-z]{2,6}$/),
        fc.boolean(),
        (seed, k, draws, leftName, rightName, train) => {
          const left = depart(seed, leftName, draws, k, train);
          const right = depart(seed, `${rightName}x`, draws + 1, k, !train);
          const leftSeed = postingStep(left).seed;
          const rightSeed = postingStep(right).seed;
          expect(leftSeed).toBe(postingSeed(seed, k));
          expect(rightSeed).toBe(leftSeed);
          expect(postingStep(left).index).toBe(k);
          expect(postingStep(right).index).toBe(k);
          expect(leftSeed).not.toBe(campaignStream(seed));
          expect(left.log).not.toEqual(right.log);
          expect(left.rng).not.toEqual(right.rng);

          const offer = left.view.offers.find((row) => row.id === left.view.chosen);
          if (offer === undefined) {
            throw new Error('missing chosen offer');
          }
          const rngBefore = left.rng;
          const stream = createPrng(campaignStream(seed));
          const streamBefore = stream.state();
          const built = buildPostingContext(left, offer, content, { config: config.value, weights });
          if (!built.ok) {
            throw new Error(built.error);
          }
          expect(built.value.seed).toBe(leftSeed);
          const world = generate(built.value.seed, gameInputs(), {}, built.value);
          expect(left.rng).toEqual(rngBefore);
          expect(stream.state()).toEqual(streamBefore);
          expect(world.meta.seed).toBe(postingSeed(seed, k));
          expect(world.meta.seed).not.toBe(campaignStream(seed));
        },
      ),
      { numRuns: 100 },
    );
  });
});
