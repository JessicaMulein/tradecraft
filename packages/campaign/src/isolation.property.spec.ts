/**
 * Property 4: Campaign truth isolation.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asTruth, type NpcId } from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { carryOver } from './carry-over.js';
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
  CarriedNpc,
  PostingOffer,
  PostingResult,
} from './state.js';
import { archiveView, campaignView, knownEnemiesView, officerView } from './view.js';

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

/** A person id that exists only in a Hostile Dossier. */
const DOSSIER_ONLY = 'cp-900';
/** A name that exists only on a carried hostile in Campaign Truth. */
const HOSTILE_NAME = 'Qzxqmol9';
/** Full-debrief text. The archive view before reveal must not show it. */
const SEALED = 'sealed-briefing';

const FORBIDDEN_KEYS = new Set([
  'hostileControlled',
  'doubled',
  'hqMole',
  'dossiers',
  'burnedLegends',
  'notoriety',
  'suspectedAssets',
  'descriptorKnown',
  'doctrineShift',
  'bindings',
  'access',
  'truth',
]);

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

function ensureLegend(state: CampaignState): CampaignState {
  if (state.view.officer.legends.some((legend) => legend.posting === state.postings)) {
    return state;
  }
  const id: `lg-${number}` = `lg-${state.view.officer.legends.length + 1}`;
  const officer = state.view.officer;
  return {
    ...state,
    view: {
      ...state.view,
      officer: {
        ...officer,
        legends: [
          ...officer.legends,
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

function hostile(id: CampaignPersonId, name: string): CarriedNpc {
  return {
    id,
    archetype: 'hostile-case-officer',
    name,
    aliases: [],
    persona: {
      name,
      given: name,
      family: name,
      library: '',
      culture: 'de',
      gender: 'male',
      voiceTraits: [],
      mannerisms: [],
      background: 'officer',
      openness: 0.5,
    },
    descriptor: name,
    allegiance: { true: 'svc-east', apparent: 'svc-east' },
    mice: asTruth({ money: 0, ideology: 1, coercion: 0, ego: 0 }),
    loyalty: 0.4,
    service: 'svc-east',
    status: 'at-large',
    seen: [{ posting: 0, city: 'vienna' }],
  };
}

function offer(): PostingOffer {
  return {
    id: 'offer-1',
    city: 'vienna',
    service: 'svc-east',
    year: 1952,
    tourYears: 2,
    tier: 'standard',
    theme: 'surveillance',
    assigned: false,
  };
}

function symbolsOf(value: unknown, found: symbol[] = []): symbol[] {
  if (value === null || typeof value !== 'object') {
    return found;
  }
  found.push(...Object.getOwnPropertySymbols(value));
  for (const child of Object.values(value)) {
    symbolsOf(child, found);
  }
  return found;
}

function keysOf(value: unknown, found: string[] = []): string[] {
  if (value === null || typeof value !== 'object') {
    return found;
  }
  for (const symbol of Object.getOwnPropertySymbols(value)) {
    found.push(symbol.description ?? 'symbol');
  }
  for (const [key, child] of Object.entries(value)) {
    found.push(key);
    keysOf(child, found);
  }
  return found;
}

interface Fold {
  readonly outcome: 'success' | 'failure-plot' | 'failure-burned';
  readonly blown: boolean;
  readonly knownCover: boolean;
  readonly observed: boolean;
  readonly doubled: boolean;
  readonly identified: boolean;
  readonly unidentified: boolean;
}

function postingResult(state: CampaignState, fold: Fold, n: number): PostingResult {
  const manifest = state.manifests[0];
  if (manifest === undefined) {
    throw new Error('missing manifest');
  }
  const legend = state.view.officer.legends.find((row) => row.posting === state.postings);
  const identified = fold.identified
    ? [{ person: `cp-${50 + n}` as CampaignPersonId, name: 'Bruno', aliases: [] as string[] }]
    : [];
  const unidentified = fold.unidentified
    ? [{ person: `face-${n}`, descriptor: 'a grey coat', sightings: [{ city: 'lisbon', year: 1947 }] }]
    : [];
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
      identified,
      unidentified,
      heldClaims: [],
      grades: [],
      notes: [],
      observedBurns: fold.observed && legend !== undefined ? [legend.id] : [],
    },
    debrief: {
      full: asTruth({
        outcome: fold.outcome,
        cause: 'ended',
        sections: [{ id: 'plot', text: SEALED }],
      }),
      redacted: { sections: [{ id: 'plot', items: [{ kind: 'redacted', ref: 'redact:1' }] }] },
    },
    extract: asTruth({
      survivingHostiles: [hostile(`cp-${70 + n}`, HOSTILE_NAME)],
      assets: [],
      arcClues: [],
      service: 'svc-east',
      cityId: 'vienna',
    }),
    outcome: {
      schema: 1,
      outcome: fold.outcome,
      endedAt: { day: 10, phase: 1 },
      seed: 'posting-seed',
      generatorVersion: '0.7.0',
      content: manifest,
      difficulty: 'standard',
      standing: 1,
      directives: [],
      survivingAssets: [
        {
          npc: `npc:cp-${40 + n}` as NpcId,
          archetype: 'courier',
          persona: { name: 'Bruno', culture: 'de', background: 'clerk' },
          lever: 'ego',
          trust: 0.5,
          exposure: 0.1,
          doubled: fold.doubled,
        },
      ],
      cover: { identity: 'clerk', blown: fold.blown, suspicion: 0.2 },
      hostileMemory: {
        knownCover: fold.knownCover,
        suspectedAssets: [`npc:${DOSSIER_ONLY}` as NpcId],
        compromisedChannels: [],
        compromisedDrops: [],
        doctrineShift: {},
      },
      budgetRemaining: 0,
    },
  };
}

describe('campaign truth isolation', () => {
  it('keeps dossiers, the mole, and unobserved burns out of the player projections', () => {
    // Feature: campaign-career, Property 4: Campaign truth isolation
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9]{1,8}$/),
        fc.array(
          fc.record({
            outcome: fc.constantFrom('success' as const, 'failure-plot' as const, 'failure-burned' as const),
            blown: fc.boolean(),
            knownCover: fc.boolean(),
            observed: fc.boolean(),
            doubled: fc.boolean(),
            identified: fc.boolean(),
            unidentified: fc.boolean(),
          }),
          { maxLength: 2 },
        ),
        (seed, folds) => {
          let state = created(seed);
          for (const [n, fold] of folds.entries()) {
            state = ensureLegend(state);
            const folded = carryOver(state, postingResult(state, fold, n), content, config.value);
            expect(folded.ok).toBe(true);
            if (!folded.ok) {
              return;
            }
            state = folded.value;
          }
          expect(state.archive.reveal).toBeUndefined();
          state = ensureLegend(state);
          const built = buildPostingContext(state, offer(), content, sources);
          expect(built.ok).toBe(true);
          if (!built.ok) {
            return;
          }

          const carried = new Set<string>();
          const observedBurns = new Set<string>();
          for (const entry of state.archive.visible) {
            for (const person of entry.carry.identified) {
              carried.add(person.person);
            }
            for (const person of entry.carry.unidentified) {
              carried.add(person.person);
            }
            for (const legend of entry.carry.observedBurns) {
              observedBurns.add(legend);
            }
          }
          const projections = [
            campaignView(state),
            archiveView(state),
            knownEnemiesView(state),
            officerView({ officer: state.view.officer, carries: state.archive.visible.map((entry) => entry.carry) }),
            built.value.history,
          ];
          for (const projection of projections) {
            expect(symbolsOf(projection)).toEqual([]);
            for (const key of keysOf(projection)) {
              expect(FORBIDDEN_KEYS.has(key)).toBe(false);
            }
            const text = JSON.stringify(projection);
            expect(text).not.toContain(DOSSIER_ONLY);
            expect(text).not.toContain(HOSTILE_NAME);
            expect(text).not.toContain(SEALED);
          }
          expect(JSON.stringify(built.value.history)).not.toContain(state.truth.hqMole);
          expect(archiveView(state).revealed).toBe(false);
          for (const enemy of knownEnemiesView(state)) {
            expect(carried.has(enemy.person)).toBe(true);
          }
          const shown = officerView({
            officer: state.view.officer,
            carries: state.archive.visible.map((entry) => entry.carry),
          });
          for (const legend of shown.legends) {
            if (legend.burned) {
              expect(observedBurns.has(legend.id)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
