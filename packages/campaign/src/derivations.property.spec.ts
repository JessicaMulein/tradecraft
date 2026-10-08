/**
 * Property 5: player-side derivations ignore truth.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  asTruth,
  buildPostingResult,
  type ActionLogEntry,
  type ActionResult,
  type OutcomeRecord,
} from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { loadCampaignConfig } from './config.js';
import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { quoteArcs } from './hq.js';
import { applyAccusation } from './molehunt.js';
import type { RecruitmentWeights } from './officer.js';
import { buildPostingContext } from './posting.js';
import { step } from './reducer.js';
import type {
  ArchiveVisibleEntry,
  CampaignChoice,
  CampaignPersonId,
  CampaignState,
  CarryClaim,
  HostileDossier,
  PostingOffer,
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
const moleArc = content.arcs.find((arc) => arc.id === 'mole-hunt' || arc.id.endsWith('/mole-hunt'));
if (moleArc === undefined) {
  throw new Error('missing mole-hunt arc');
}

const weights: RecruitmentWeights = {
  pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
  firstContact: { a: 1, b: 1, c: 1, d: 1 },
  meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
  exposure: { k1: 1, k2: 1, k3: 1 },
  turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
};
const sources = { config: config.value, weights };

const outcome = {
  schema: 1 as const,
  outcome: 'success' as const,
  endedAt: { day: 3, phase: 1 as const },
  seed: 'seed',
  generatorVersion: '0.7.0',
  content: { schema: 1, packs: [{ id: 'core', version: '1.0.0', hash: 'abc' }] },
  difficulty: 'standard',
  standing: 4,
  directives: [],
  survivingAssets: [],
  cover: { identity: 'clerk', blown: false, suspicion: 0.1 },
  hostileMemory: {
    knownCover: false,
    suspectedAssets: [],
    compromisedChannels: [],
    compromisedDrops: [],
    doctrineShift: {},
  },
  budgetRemaining: 10,
} as OutcomeRecord;

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
            id: `lg-${officer.legends.length + 1}`,
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

function dossier(notoriety: number): HostileDossier {
  return {
    service: 'svc-east',
    notoriety,
    descriptorKnown: true,
    burnedLegends: ['lg-9'],
    patterns: [{ locType: 'warehouse', uses: 4 }],
    channelKinds: [{ kind: 'radio', uses: 2 }],
    suspectedAssets: ['cp-900'],
    doctrineShift: { riskTolerance: 0.4 },
  };
}

function claim(id: string, figure: CampaignPersonId, place: string, corroborated: boolean): CarryClaim {
  return {
    id,
    prop: {
      id: `prop:${id}`,
      subject: `npc:${figure}`,
      predicate: 'KNOWS',
      object: 'org:svc-east',
      place: `loc:${place}`,
    },
    text: id,
    relation: corroborated ? 'corroborated' : 'none',
  };
}

function archiveWith(claims: readonly CarryClaim[]): ArchiveVisibleEntry {
  return {
    index: 0,
    city: 'vienna',
    year: 1948,
    legend: 'lg-1',
    rankAtStart: 'case-officer',
    outcome: 'success',
    redacted: { sections: [] },
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
      heldClaims: claims,
      grades: [],
      notes: [],
      observedBurns: [],
    },
    caseFileRef: 'case-file:0',
    plotTemplate: 'rail-junction',
    plots: [],
  };
}

function action(kind: string): ActionLogEntry {
  return {
    seq: 1,
    turn: 'turn:1',
    at: { day: 0, phase: 0 },
    kind: 'action',
    action: { kind },
  } as ActionLogEntry;
}

function actionResult(hit: boolean): ActionResult {
  return {
    observations: hit
      ? [
          {
            kind: 'proposition',
            prop: {
              id: 'p1',
              subject: 'npc:courier',
              predicate: 'KNOWS',
              object: 'org:station',
            },
            at: { day: 0, phase: 0 },
            source: { kind: 'intercept', id: 'int:1' },
          },
        ]
      : [],
    factLines: [],
    scene: { loc: 'loc:desk', description: '', atmosphere: [], risk: 0, visible: [] },
    events: [],
    claimsAdded: [],
  } as ActionResult;
}

describe('player-side derivations', () => {
  it('keeps stats, carry, history, the accusation gate, and a wrong cable off truth', () => {
    // Feature: campaign-career, Property 5: Player-side derivations ignore truth
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9]{1,8}$/),
        fc.boolean(),
        fc.boolean(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.stringMatching(/^[a-z]{3,6}$/),
        (seed, decryptHit, corroborated, notoriety, identityNpc) => {
          const log = [action('decrypt')];
          const results = [actionResult(decryptHit)];
          const view = {
            persons: [
              {
                id: 'face-1',
                carryEligible: true,
                identified: false,
                name: '',
                aliases: [],
                descriptor: 'a grey coat',
                sightings: [{ city: 'lisbon', year: 1947 }],
              },
            ],
            observedBurns: ['lg-1'],
          };
          const caseFile = { claims: [], grades: [], notes: [] };
          const shared = {
            index: 1,
            plotTemplate: 'rail-junction',
            outcome,
            log,
            results,
            view,
            caseFile,
            debrief: { outcome: 'success', cause: 'done', sections: [] },
            protectedIds: new Set<string>(),
            service: 'svc-east',
            cityId: 'vienna',
          };
          const plain = buildPostingResult({
            ...shared,
            identities: { 'face-1': 'npc:cp-1' },
            hostiles: [],
            assets: [],
            arcClues: [],
          });
          const altered = buildPostingResult({
            ...shared,
            identities: { 'face-1': `npc:${identityNpc}` },
            hostiles: [{ id: 'cp-70', status: 'at-large' }],
            assets: [{ person: 'cp-40', npc: 'npc:cp-40', rel: { access: ['files'] } }],
            arcClues: [{ clue: 'mole-access', present: true }],
          });
          expect(altered.stats).toEqual(plain.stats);
          expect(altered.carry).toEqual(plain.carry);
          expect(altered.extract).not.toEqual(plain.extract);

          const state = ensureLegend(created(seed));
          const accused = state.view.hqCast[0];
          const moleA = state.view.hqCast[1];
          const moleB = state.view.hqCast[2];
          expect(accused).toBeDefined();
          expect(moleA).toBeDefined();
          expect(moleB).toBeDefined();
          if (accused === undefined || moleA === undefined || moleB === undefined) {
            return;
          }
          const claims = [
            claim('a', accused.id, 'cafe', corroborated),
            claim('b', accused.id, 'bar', corroborated),
            claim('c', accused.id, 'park', corroborated),
          ];
          const hearing: CampaignState = {
            ...state,
            step: { kind: 'arcs' },
            archive: { visible: [archiveWith(claims)] },
          };
          const choice: Extract<CampaignChoice, { kind: 'accuse' }> = { kind: 'accuse', figure: accused.id };
          const gate = quoteArcs(hearing, choice);
          const rewritten: CampaignState = {
            ...hearing,
            truth: asTruth({
              ...hearing.truth,
              hqMole: moleB.id,
              dossiers: { 'svc-east': dossier(notoriety) },
              tensionByYear: { 1952: 0.13 },
              unkMap: { 'face-x': 'cp-99' },
            }),
          };
          expect(quoteArcs(rewritten, choice)).toEqual(gate);

          const posted = buildPostingContext(hearing, offer(), content, sources);
          const reposted = buildPostingContext(rewritten, offer(), content, sources);
          expect(posted.ok).toBe(true);
          expect(reposted.ok).toBe(true);
          if (!posted.ok || !reposted.ok) {
            return;
          }
          expect(reposted.value.history).toEqual(posted.value.history);
          expect(reposted.value.tension).toBe(0.13);
          expect(reposted.value.history.context.tension).toBe(posted.value.history.context.tension);

          const accusation = {
            officer: state.view.officer,
            figure: accused.id,
            figureName: accused.name,
            hqFigures: state.truth.hqFigures,
            hqCast: state.view.hqCast,
            arcs: state.truth.arcs,
            moleArc,
            claims,
            threshold: 3,
            texts: content.texts,
          };
          const wrongA = applyAccusation({ ...accusation, mole: moleA.id });
          const wrongB = applyAccusation({ ...accusation, mole: moleB.id });
          expect(wrongB).toEqual(wrongA);
          if (wrongA.ok) {
            expect(wrongA.value.correct).toBe(false);
            expect(wrongA.value.cable.body).toContain(accused.name);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
