/**
 * Property 17: Asset continuity.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asTruth } from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { carryOver } from './carry-over.js';
import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { loadCampaignConfig } from './config.js';
import { type RecruitmentWeights } from './officer.js';
import { buildPostingContext } from './posting.js';
import { step } from './reducer.js';
import type {
  CampaignChoice,
  CampaignPersonId,
  CampaignState,
  CarriedAsset,
  PostingOffer,
  PostingResult,
} from './state.js';

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

const weights: RecruitmentWeights = {
  pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
  firstContact: { a: 1, b: 1, c: 1, d: 1 },
  meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
  exposure: { k1: 1, k2: 1, k3: 1 },
  turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
};
const sources = { config: config.value, weights };
const decay = config.value.carry.assetTrustDecay;

const ARCHETYPES = ['emigre-fixer', 'cafe-waiter', 'friendly-journalist'] as const;
const CITIES = ['vienna', 'lisbon'] as const;
type Decision = 'handover' | 'exfiltrate' | 'bring';

function created(): CampaignState {
  const choice: Extract<CampaignChoice, { kind: 'create' }> = {
    kind: 'create',
    seed: 'career-seed',
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

function person(id: CampaignPersonId, archetype: string, city: string): CarriedAsset['person'] {
  return {
    id,
    archetype,
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
    seen: [{ posting: 0, city }],
  };
}

function assetOf(
  id: CampaignPersonId,
  archetype: string,
  city: string,
  trust: number,
  leftYear: number,
  hostileControlled: boolean,
): CarriedAsset {
  return {
    person: person(id, archetype, city),
    trust,
    exposure: 0.2,
    reliability: 0.5,
    hostileControlled,
    turned: false,
    lever: 'ego',
    city,
    leftYear,
  };
}

function withAssets(rows: readonly CarriedAsset[]): CampaignState {
  const state = created();
  return {
    ...state,
    step: { kind: 'assets' },
    view: {
      ...state.view,
      officer: { ...state.view.officer, careerPoints: 20 },
      staged: {
        ...state.view.staged,
        assets: rows.map((row) => ({
          id: row.person.id,
          name: row.person.name,
          rapport: 'trusted' as const,
          history: 'recruited',
        })),
      },
    },
    truth: asTruth({ ...state.truth, stagedAssets: rows }),
  };
}

function decide(state: CampaignState, id: CampaignPersonId, decision: Decision): CampaignState {
  const result = step(
    state,
    { kind: 'choice', choice: { kind: 'asset-decision', asset: id, decision } },
    content,
  );
  return result.ok ? result.value : state;
}

function ensureLegend(state: CampaignState): CampaignState {
  if (state.view.officer.legends.some((legend) => legend.posting === state.postings)) {
    return state;
  }
  const id: `lg-${number}` = `lg-${state.postings + 1}`;
  return {
    ...state,
    view: {
      ...state.view,
      officer: {
        ...state.view.officer,
        legends: [
          ...state.view.officer.legends,
          {
            id,
            cover: 'clerk',
            name: 'Helen',
            official: true,
            posting: state.postings,
            observedBurnedBy: [],
          },
        ],
      },
    },
  };
}

function offerFor(city: string, year: number): PostingOffer {
  return {
    id: 'offer-1',
    city,
    service: 'svc-east',
    year,
    tourYears: 2,
    tier: 'standard',
    theme: 'surveillance',
    assigned: false,
  };
}

function quietResult(state: CampaignState): PostingResult {
  const manifest = state.manifests[0];
  if (manifest === undefined) {
    throw new Error('missing manifest');
  }
  return {
    schema: 1,
    index: state.postings,
    plotTemplate: 'rail-junction',
    plots: [
      {
        templateId: 'rail-junction',
        variantKey: 'rail-junction@1',
        archetype: 'sabotage',
        role: 'primary',
        outcome: 'succeeded',
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
      full: asTruth({
        outcome: 'success',
        cause: 'plot',
        sections: [{ id: 'plot', text: 'The posting ended.' }],
      }),
      redacted: {
        sections: [{ id: 'plot', items: [{ kind: 'shown', item: { text: 'The posting ended.' } }] }],
      },
    },
    extract: asTruth({
      survivingHostiles: [],
      assets: [],
      arcClues: [],
      service: 'svc-east',
      cityId: 'vienna',
    }),
    outcome: {
      schema: 1,
      outcome: 'success',
      endedAt: { day: 30, phase: 2 },
      seed: 'posting-seed',
      generatorVersion: '0.7.0',
      content: manifest,
      difficulty: 'standard',
      standing: 1,
      directives: [],
      survivingAssets: [],
      cover: { identity: 'clerk', blown: false, suspicion: 0 },
      hostileMemory: {
        knownCover: false,
        suspectedAssets: [],
        compromisedChannels: [],
        compromisedDrops: [],
        doctrineShift: {},
      },
      budgetRemaining: 12,
    },
  };
}

function truthAssets(state: CampaignState): readonly CarriedAsset[] {
  return [
    ...state.truth.stagedAssets,
    ...state.truth.brought,
    ...Object.values(state.truth.cities).flatMap((city) => [...city.handedOver]),
  ];
}

function decayedTrust(trust: number, leftYear: number, year: number): number {
  const years = Math.max(0, year - leftYear);
  return trust * (1 - decay) ** years;
}

describe('asset continuity', () => {
  it('keeps handed, brought, and exfiltrated assets on their own paths', () => {
    // Feature: campaign-career, Property 17: Asset continuity
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            archetype: fc.constantFrom(...ARCHETYPES),
            city: fc.constantFrom(...CITIES),
            trust: fc.double({ min: 0, max: 1, noNaN: true }),
            leftYear: fc.integer({ min: 1948, max: 1962 }),
            hostileControlled: fc.boolean(),
            decision: fc.constantFrom('handover', 'exfiltrate', 'bring'),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        fc.array(
          fc.record({
            city: fc.constantFrom(...CITIES),
            year: fc.integer({ min: 1948, max: 1962 }),
          }),
          { minLength: 2, maxLength: 3 },
        ),
        (rows, postings) => {
          const assets = rows.map((row, index) =>
            assetOf(
              `cp-${50 + index}`,
              row.archetype,
              row.city,
              row.trust,
              row.leftYear,
              row.hostileControlled,
            ),
          );
          const flags = new Map(assets.map((asset) => [asset.person.id, asset.hostileControlled]));
          let state = withAssets(assets);
          for (const [index, row] of rows.entries()) {
            const id = assets[index]?.person.id;
            if (id === undefined) {
              continue;
            }
            state = decide(state, id, row.decision);
          }
          const brought = new Set(state.truth.brought.map((asset) => asset.person.id));
          const handed = new Map(
            Object.values(state.truth.cities).flatMap((city) =>
              city.handedOver.map((asset) => [asset.person.id, asset] as const),
            ),
          );
          const exfiltrated = assets
            .map((asset) => asset.person.id)
            .filter((id) => !truthAssets(state).some((asset) => asset.person.id === id));

          const placed: { city: string; year: number; id: string; as: string; trust?: number; flag?: boolean }[][] =
            [];
          for (const posting of postings) {
            state = ensureLegend(state);
            const built = buildPostingContext(state, offerFor(posting.city, posting.year), content, sources);
            expect(built.ok).toBe(true);
            if (!built.ok) {
              return;
            }
            placed.push(
              built.value.carry.placements
                .filter((row) => flags.has(row.person.id))
                .map((row) => ({
                  city: posting.city,
                  year: posting.year,
                  id: row.person.id,
                  as: row.as,
                  trust: row.trust,
                  flag: row.hostileControlled,
                })),
            );
            const folded = carryOver(state, quietResult(state), content, config.value);
            expect(folded.ok).toBe(true);
            if (!folded.ok) {
              return;
            }
            state = folded.value;
            for (const asset of truthAssets(state)) {
              expect(asset.hostileControlled).toBe(flags.get(asset.person.id));
            }
          }

          for (const id of exfiltrated) {
            expect(placed.every((batch) => batch.every((row) => row.id !== id))).toBe(true);
          }
          for (const id of brought) {
            const batches = placed.map((batch) => batch.filter((row) => row.id === id));
            const original = assets.find((asset) => asset.person.id === id);
            expect(batches[0]?.map((row) => row.as)).toEqual(['asset']);
            expect(batches[0]?.[0]?.trust).toBeCloseTo(original?.trust ?? 0);
            expect(batches[0]?.[0]?.flag).toBe(flags.get(id));
            for (const later of batches.slice(1)) {
              expect(later).toEqual([]);
            }
          }
          for (const [id, asset] of handed) {
            for (const [index, posting] of postings.entries()) {
              const rowsHere = placed[index]?.filter((row) => row.id === id) ?? [];
              if (posting.city !== asset.city) {
                expect(rowsHere).toEqual([]);
                continue;
              }
              expect(rowsHere.map((row) => row.as)).toEqual(['handed-over']);
              expect(rowsHere[0]?.trust).toBeCloseTo(decayedTrust(asset.trust, asset.leftYear, posting.year));
              expect(rowsHere[0]?.flag).toBe(flags.get(id));
            }
          }
          expect(state.truth.brought).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
