/**
 * Property 18: Unidentified Subject continuity.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadCityData,
  loadDescriptorData,
  loadPublicTexts,
  type DifficultyPreset,
} from '@tradecraft/content';
import {
  applyRecogniserPass,
  createPrng,
  asTruth,
  generateGame,
  revealTruth,
  ScenarioConfigSchema,
  type GameTime,
  type GenerateInputs,
  type LocId,
  type NpcId,
} from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { loadCampaignConfig } from './config.js';
import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import type { RecruitmentWeights } from './officer.js';
import { buildPostingContext } from './posting.js';
import { step } from './reducer.js';
import type {
  CampaignChoice,
  CampaignPersonId,
  CampaignState,
  CarriedAsset,
  PostingOffer,
} from './state.js';

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
const sources = { config: config.value, weights };
const scenario = ScenarioConfigSchema.parse({
  difficulty: { preset: 'standard' },
  mole: false,
  recruitment: weights,
});

const AT: GameTime = { day: 4, phase: 1 };
const LOC = 'loc:cafe' as LocId;
const OFFER_CITY = 'vienna';

interface Sighting {
  readonly city: string;
  readonly year: number;
}

interface Face {
  readonly id: CampaignPersonId;
  readonly ref: string;
  readonly placed: boolean;
  readonly observed: boolean;
  readonly sightings: readonly Sighting[];
}

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

function created(seed: string): CampaignState {
  const choice: Extract<CampaignChoice, { kind: 'create' }> = {
    kind: 'create',
    seed,
    preset: 'standard',
    officerName: 'Ada',
    background: 'analyst',
    startYear: 1948,
  };
  const result = step(undefined, { kind: 'choice', choice }, content);
  if (!result.ok) {
    throw new Error(result.error.kind);
  }
  return result.value;
}

function carried(id: CampaignPersonId): CarriedAsset {
  return {
    person: {
      id,
      archetype: 'cafe-waiter',
      name: 'Bruno',
      aliases: [],
      persona: {
        name: 'Bruno',
        given: 'Bruno',
        family: 'Bruno',
        library: '',
        culture: 'de',
        gender: 'male',
        voiceTraits: [],
        mannerisms: [],
        background: 'clerk',
        openness: 0.5,
      },
      descriptor: 'Bruno',
      allegiance: { true: '', apparent: '' },
      mice: asTruth({ money: 0, ideology: 0, coercion: 0, ego: 1 }),
      loyalty: 0,
      status: 'at-large',
      seen: [{ posting: 0, city: OFFER_CITY }],
    },
    trust: 0.5,
    exposure: 0.2,
    reliability: 0.5,
    hostileControlled: false,
    turned: false,
    lever: 'ego',
    city: OFFER_CITY,
    leftYear: 1950,
  };
}

function withFaces(seed: string, faces: readonly Face[]): CampaignState {
  const state = created(seed);
  const unkMap: Record<string, CampaignPersonId> = {};
  const unk: Record<string, { descriptor: string; sightings: readonly Sighting[] }> = {};
  for (const face of faces) {
    if (!face.observed) {
      continue;
    }
    unkMap[face.ref] = face.id;
    unk[face.ref] = { descriptor: 'a grey coat', sightings: face.sightings };
  }
  const handedOver = faces.filter((face) => face.placed).map((face) => carried(face.id));
  return {
    ...state,
    view: {
      ...state.view,
      unk,
      officer: {
        ...state.view.officer,
        legends: [
          {
            id: 'lg-1',
            cover: 'clerk',
            name: 'Helen',
            official: true,
            posting: state.postings,
            observedBurnedBy: [],
          },
        ],
      },
    },
    truth: asTruthFaces(state, unkMap, handedOver),
  };
}

function asTruthFaces(
  state: CampaignState,
  unkMap: Record<string, CampaignPersonId>,
  handedOver: readonly CarriedAsset[],
): CampaignState['truth'] {
  return {
    ...state.truth,
    cities: { ...state.truth.cities, [OFFER_CITY]: { handedOver } },
    unkMap,
  } as CampaignState['truth'];
}

function offer(): PostingOffer {
  return {
    id: 'offer-1',
    city: OFFER_CITY,
    service: 'svc-east',
    year: 1952,
    tourYears: 2,
    tier: 'standard',
    theme: 'surveillance',
    assigned: false,
  };
}

function npcOf(id: CampaignPersonId): NpcId {
  return `npc:${id}` as NpcId;
}

function faceLine(sightings: readonly Sighting[]): string {
  const text = [...sightings]
    .sort((left, right) => left.year - right.year || left.city.localeCompare(right.city))
    .map((row) => `${row.city}, ${row.year}`)
    .join('; ');
  return `You have seen this face before: ${text}.`;
}

describe('unidentified subject continuity', () => {
  it('reuses a pre-allocated face on the first sighting and leaves a stranger unmarked', () => {
    // Feature: campaign-career, Property 18: Unidentified Subject continuity
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9]{1,8}$/),
        fc.array(
          fc.record({
            placed: fc.boolean(),
            observed: fc.boolean(),
            sightings: fc.array(
              fc.record({
                city: fc.stringMatching(/^[A-Z][a-z]{2,6}$/),
                year: fc.integer({ min: 1948, max: 1962 }),
              }),
              { minLength: 1, maxLength: 3 },
            ),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        (seed, rows) => {
          const faces: Face[] = rows.map((row, index) => ({
            id: `cp-${60 + index}`,
            ref: `face-${index}`,
            placed: row.placed,
            observed: row.observed,
            sightings: row.sightings,
          }));
          const state = withFaces(seed, faces);
          const built = buildPostingContext(state, offer(), content, sources);
          expect(built.ok).toBe(true);
          if (!built.ok) {
            return;
          }
          const prealloc = built.value.carry.unkPrealloc;
          const seen = faces.filter((face) => face.observed && face.placed);
          const strangers = faces.filter((face) => face.placed && !face.observed);
          const dormant = faces.filter((face) => face.observed && !face.placed);
          expect(prealloc.map((entry) => entry.person).sort()).toEqual(seen.map((face) => face.id).sort());
          for (const face of dormant) {
            expect(prealloc.some((entry) => entry.ref === face.ref)).toBe(false);
          }
          for (const face of seen) {
            const entry = prealloc.find((row) => row.person === face.id);
            expect(entry?.sightings).toEqual(face.sightings);
          }

          const generated = generateGame(built.value.seed, gameInputs(), {}, built.value);
          const stored = generated.world.carry;
          expect(stored).toBeDefined();
          if (stored === undefined) {
            return;
          }
          const carry = revealTruth(stored);
          for (const face of strangers) {
            const npc = npcOf(face.id);
            expect(Object.values(carry.unk).some((row) => row.npc === npc)).toBe(false);
            expect(generated.world.player.unkIds[npc]).toBeUndefined();
            const pass = applyRecogniserPass(generated.world, createPrng(seed), 0, [], [npc], AT, LOC);
            expect(pass.seenBefore).toEqual([]);
            expect(pass.next.player.unkIds[npc]).toBeUndefined();
          }
          const sighted = seen.map((face) => npcOf(face.id));
          const first = applyRecogniserPass(generated.world, createPrng(seed), 0, [], sighted, AT, LOC);
          expect(first.seenBefore).toEqual(seen.map((face) => faceLine(face.sightings)));
          for (const face of seen) {
            const npc = npcOf(face.id);
            const allocated = carry.unk[face.ref];
            expect(allocated).toBeDefined();
            if (allocated === undefined) {
              return;
            }
            expect(allocated.npc).toBe(npc);
            expect(generated.world.player.unkIds[npc]).toBe(allocated.unk);
            expect(generated.truth.identityOf(allocated.unk)).toBe(npc);
            expect(first.next.player.unkIds[npc]).toBe(allocated.unk);
          }
          const second = applyRecogniserPass(first.next, createPrng(`${seed}-again`), 0, [], sighted, AT, LOC);
          expect(second.seenBefore).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
