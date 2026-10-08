/**
 * The posting context carries the officer, the dossier, and the people the
 * career still has, and its plot history comes from the visible archive.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asTruth } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import { broughtPlacement } from './assets.js';
import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { loadCampaignConfig } from './config.js';
import { dossierCarry } from './dossier.js';
import { epochAt, eraOverrides } from './era.js';
import { officerModifiers, type RecruitmentWeights } from './officer.js';
import { buildPostingContext } from './posting.js';
import { step } from './reducer.js';
import { postingSeed } from './seed.js';
import type {
  CampaignChoice,
  CampaignPersonId,
  CampaignState,
  CarriedAsset,
  CarriedNpc,
  PlayerCarry,
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
const preset = loaded.value.difficultyPresets.get('core/standard');
if (preset === undefined) {
  throw new Error('core/standard preset missing');
}

const weights: RecruitmentWeights = {
  pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
  firstContact: { a: 1.5, b: 1, c: 1, d: 1 },
  meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
  exposure: { k1: 1, k2: 1, k3: 1 },
  turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
};

const sources = { config: config.value, weights };

const offer: PostingOffer = {
  id: 'offer-1',
  city: 'core',
  service: 'svc-east',
  year: 1948,
  tourYears: 2,
  tier: 'standard',
  theme: 'surveillance',
  assigned: false,
};

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

function emptyCarry(identified: PlayerCarry['identified'] = []): PlayerCarry {
  return {
    identified,
    unidentified: [],
    heldClaims: [],
    grades: [],
    notes: [],
    observedBurns: [],
  };
}

function person(
  id: CampaignPersonId,
  status: CarriedNpc['status'],
  service?: string,
  archetype = 'hostile-case-officer',
): CarriedNpc {
  return {
    id,
    archetype,
    name: id,
    aliases: [],
    persona: {
      name: id,
      given: 'Ada',
      family: id,
      library: '',
      culture: '',
      gender: 'female',
      voiceTraits: [],
      mannerisms: [],
      background: 'officer',
      openness: 0.5,
    },
    descriptor: id,
    allegiance: { true: service ?? '', apparent: service ?? '' },
    mice: asTruth({ money: 0, ideology: 0, coercion: 0, ego: 0 }),
    loyalty: 0.5,
    ...(service === undefined ? {} : { service }),
    status,
    seen: [{ posting: 0, city: 'core' }],
  };
}

function asset(
  id: CampaignPersonId,
  city: string,
  trust: number,
  status: CarriedNpc['status'] = 'at-large',
): CarriedAsset {
  return {
    person: person(id, status, undefined, 'emigre-fixer'),
    trust,
    exposure: 0,
    reliability: 0.5,
    hostileControlled: id === 'cp-30',
    turned: false,
    lever: 'money',
    city,
    leftYear: 1946,
  };
}

function cityLanguages(cityId: string): string[] {
  for (const [id, bundle] of Object.entries(content.set.cities)) {
    if (id === cityId || id.endsWith(`/${cityId}`) || bundle.def.id === cityId) {
      return bundle.def.languages.map((language) => language.id);
    }
  }
  return [];
}

function ready(): CampaignState {
  const state = created();
  const nemesis = person('cp-20', 'at-large', 'svc-east');
  return {
    ...state,
    view: {
      ...state.view,
      pendingRequisitions: ['budget-credit', 'extra-drop'],
      unk: {
        'face-1': {
          descriptor: 'a man in a grey coat',
          sightings: [{ city: 'lisbon', year: 1947 }],
        },
      },
      officer: {
        ...state.view.officer,
        rank: 'senior-case-officer',
        legends: [
          {
            id: 'lg-1',
            cover: 'clerk',
            name: 'Helen',
            official: true,
            posting: 0,
            observedBurnedBy: [],
          },
        ],
      },
    },
    truth: asTruth({
      ...state.truth,
      tensionByYear: { 1948: 0.42 },
      nemesis: 'cp-20',
      arcs: {
        ...state.truth.arcs,
        nemesis: {
          bindings: { ...(state.truth.arcs.nemesis?.bindings ?? {}), nemesis: 'cp-20' },
          stage: state.truth.arcs.nemesis?.stage ?? 'shadow',
          clues: state.truth.arcs.nemesis?.clues ?? {},
        },
      },
      carriedHostiles: [
        nemesis,
        person('cp-21', 'at-large', 'svc-east'),
        person('cp-22', 'at-large', 'svc-other'),
        person('cp-23', 'dead', 'svc-east'),
        person('cp-24', 'at-large', 'svc-east', 'cell'),
      ],
      brought: [asset('cp-30', 'lisbon', 0.8)],
      cities: {
        core: { handedOver: [asset('cp-31', 'core', 0.5), asset('cp-32', 'core', 0.4, 'arrested')] },
        lisbon: { handedOver: [asset('cp-33', 'lisbon', 0.9)] },
      },
      dossiers: {
        'svc-east': {
          service: 'svc-east',
          notoriety: 1,
          descriptorKnown: true,
          burnedLegends: [],
          patterns: [{ locType: 'pattern-marker', uses: 1 }],
          channelKinds: [],
          suspectedAssets: [],
          doctrineShift: { riskTolerance: 0.1 },
        },
      },
      unkMap: { 'face-1': 'cp-21', 'face-absent': 'cp-99' },
    }),
    archive: {
      visible: [
        {
          index: 0,
          city: 'core',
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
          carry: emptyCarry([
            { person: 'cp-40', name: 'Ilse', aliases: [] },
          ]),
          caseFileRef: 'case-0',
          plotTemplate: 'quiet-street',
          plots: [
            {
              templateId: 'quiet-street',
              variantKey: 'a',
              archetype: 'clerk',
              role: 'primary',
              outcome: 'succeeded',
            },
          ],
        },
      ],
    },
  };
}

describe('buildPostingContext', () => {
  it('refuses a posting that has no legend and does not change the campaign', () => {
    const state = created();
    const before = JSON.stringify(state);
    const result = buildPostingContext(state, offer, content, sources);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Choose a legend before the posting starts.');
    }
    expect(JSON.stringify(state)).toBe(before);
  });

  it('uses the cached tension and builds history only from the visible archive', () => {
    const state = ready();
    const before = JSON.stringify(state);
    const built = buildPostingContext(state, offer, content, sources);
    const again = buildPostingContext(state, offer, content, sources);
    expect(JSON.stringify(state)).toBe(before);
    expect(built.ok).toBe(true);
    expect(again.ok).toBe(true);
    if (!built.ok || !again.ok) {
      return;
    }
    expect(again.value).toEqual(built.value);
    expect(built.value.tension).toBe(0.42);
    expect(built.value.seed).toBe(postingSeed(state.seed, 0));
    expect(built.value.index).toBe(0);
    expect(built.value.legend).toEqual({ cover: 'clerk', name: 'Helen', official: true });
    expect(built.value.history.templateHistory).toEqual([
      {
        templateId: 'quiet-street',
        variantKey: 'a',
        archetype: 'clerk',
        outcome: 'succeeded',
      },
    ]);
    expect(JSON.stringify(built.value.history)).not.toContain('pattern-marker');
    expect(built.value.history.context.rank).toBe('senior-case-officer');
    expect(built.value.history.context.skills.cryptanalysis).toBe(
      state.view.officer.skills.cryptanalysis?.level,
    );
    expect(built.value.carry.personalFile.persons).toContain('cp-40');
    expect(built.value.carry.personalFile.body).toContain('Ilse');
    expect(built.value.carry.personalFile.persons).not.toContain('cp-21');
  });

  it('places brought assets, decayed city assets, recognisers and the mole visitor', () => {
    const state = ready();
    const epoch = epochAt(1948, content.epochs);
    const officer = officerModifiers(
      state.view.officer,
      {
        tier: offer.tier,
        cityLanguages: cityLanguages(offer.city),
        requisitions: state.view.pendingRequisitions,
        era: { tension: 0.42, doctrineScale: config.value.eraDoctrineScale },
      },
      content,
      { preset, weights },
    );
    if (!epoch.ok || !officer.ok) {
      throw new Error('fixture epoch or officer failed');
    }
    const built = buildPostingContext(state, offer, content, sources);
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const ctx = built.value;
    const era = eraOverrides(epoch.value, 0.42, preset, config.value.eraDoctrineScale);
    expect(ctx.presetOverrides).toEqual({
      ...officer.value.preset,
      allowedCiphers: era.allowedCiphers,
    });
    expect(ctx.scenarioOverrides).toEqual(officer.value.weights);
    expect(ctx.epochFlags).toEqual(epoch.value.flags);
    expect(ctx.carry.modifiers).toEqual(
      dossierCarry(
        state.truth.dossiers['svc-east'] ?? {
          service: 'svc-east',
          notoriety: 0,
          descriptorKnown: false,
          burnedLegends: [],
          patterns: [],
          channelKinds: [],
          suspectedAssets: [],
          doctrineShift: {},
        },
        officer.value.resolvedPreset,
        config.value.carry,
      ),
    );
    expect(ctx.carry.modifiers.patternDetection['pattern-marker']).toBeGreaterThan(1);
    expect(ctx.carry.requisitions.map((effect) => effect.kind)).toEqual(['extra-player-drop']);
    expect(ctx.history.context.scaling).toBe(
      content.ranks.find(
        (row) => row.id === 'senior-case-officer' || row.id.endsWith('/senior-case-officer'),
      )?.budgetScale,
    );

    const roles = ctx.carry.placements.map((placement) => [placement.person.id, placement.as]);
    expect(roles).toContainEqual(['cp-30', 'asset']);
    expect(roles).toContainEqual(['cp-31', 'handed-over']);
    expect(roles).not.toContainEqual(['cp-32', 'handed-over']);
    expect(roles).not.toContainEqual(['cp-33', 'handed-over']);
    expect(roles).toContainEqual(['cp-21', 'recogniser']);
    expect(roles).not.toContainEqual(['cp-22', 'recogniser']);
    expect(roles).not.toContainEqual(['cp-23', 'recogniser']);
    expect(roles).not.toContainEqual(['cp-24', 'recogniser']);
    expect(roles.some((row) => row[1] === 'nemesis')).toBe(false);
    expect(roles).toContainEqual([state.truth.hqMole, 'hq-visitor']);

    const carried = state.truth.brought[0];
    const brought = ctx.carry.placements.find((placement) => placement.person.id === 'cp-30');
    expect(carried).toBeDefined();
    if (carried !== undefined) {
      expect(brought).toEqual(broughtPlacement(carried));
    }
    const handed = ctx.carry.placements.find((placement) => placement.person.id === 'cp-31');
    const decay = config.value.carry.assetTrustDecay;
    expect(handed?.trust).toBeCloseTo(0.5 * (1 - decay) ** 2);
    expect(handed?.contact).toBe(true);
    expect(handed?.hostileControlled).toBe(false);
    const recogniser = ctx.carry.placements.find((placement) => placement.person.id === 'cp-21');
    expect(recogniser?.optional).toBe(true);

    const mole = ctx.carry.arcThreads.find((thread) => thread.template === 'mole-rumour');
    expect(mole?.clues[0]?.prop?.subject).toBe(`npc:${state.truth.hqMole}`);
    expect(mole?.clues[0]?.prop?.object).toBe('org:svc-east');
    expect(ctx.carry.unkPrealloc).toEqual([
      {
        ref: 'face-1',
        person: 'cp-21',
        sightings: [{ city: 'lisbon', year: 1947 }],
      },
    ]);
    expect(ctx.carry.recogniserSuspicion).toBe(config.value.carry.recogniserSuspicion);
    expect(JSON.stringify(ctx.history)).not.toContain(state.truth.hqMole);
  });

  it('places the nemesis when the stage conditions hold for this service', () => {
    const state = ready();
    const later = {
      ...state,
      postings: 1,
      view: {
        ...state.view,
        officer: {
          ...state.view.officer,
          legends: state.view.officer.legends.map((row) => ({ ...row, posting: 1 })),
        },
      },
    };
    const built = buildPostingContext(later, offer, content, sources);
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const roles = built.value.carry.placements
      .filter((placement) => placement.person.id === 'cp-20')
      .map((placement) => placement.as);
    expect(roles).toEqual(['nemesis', 'recogniser']);
  });
});
