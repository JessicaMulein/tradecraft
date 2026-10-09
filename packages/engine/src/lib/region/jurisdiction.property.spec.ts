/**
 * Property 13 — jurisdiction gate independence (multi-city task 10.2).
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
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

import { quoteArrest } from '../action/arrest.js';
import type { ResolverContext } from '../action/result.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { asTruth, type NpcId, type Proposition } from '../model/core.js';
import type { CityId, ServiceId } from '../fidelity/types.js';
import { emptyHostileBeliefs } from '../hostile/beliefs.js';
import type { WorldState } from '../model/state.js';
import { TruthStore } from '../truth/truth.js';
import { servicePermitsArrest } from './jurisdiction.js';
import type { ServiceKind, ServiceState } from './services.js';

const CORE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'content', 'packs', 'core');
const CITY = 'city:north' as CityId;
const SERVICE = 'service:local' as ServiceId;

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

function inputs(): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
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
  return { content, preset: preset('standard'), scenario, cityData, descriptors, publicTexts };
}

const base = generate('jurisdiction', inputs());
const npc = Object.keys(base.npcs)[0] as NpcId;
const seen: Proposition = {
  id: 'prop:seen',
  subject: npc,
  predicate: 'LOCATED_AT',
  place: base.player.loc,
  object: base.player.loc,
};

function service(kind: ServiceKind, trust: number): ServiceState {
  return {
    id: SERVICE,
    kind,
    doctrine: { riskTolerance: 0.2, securityConsciousness: 0.2, deceptionAppetite: 0.2 },
    residencies: {},
    beliefs: { ...emptyHostileBeliefs(), coverSuspicion: 0, watch: asTruth({ persons: [], descriptors: [] }) },
    knowledge: { known: [], falseBeliefs: [], knownEntities: [] },
    ...(kind === 'liaison'
      ? { liaison: { reliability: asTruth(1), agenda: { conceal: [], promote: [], obtain: [] }, trust, delayPhases: 1 } }
      : {}),
  };
}

function staged(
  evidence: number,
  kind: ServiceKind,
  trust: number,
  liaisonTrustThreshold: number,
  mapped: boolean,
  truth: TruthStore,
): { state: WorldState; ctx: ResolverContext } {
  const state: WorldState = {
    ...base,
    player: { ...base.player, arrestAuthority: 3, city: CITY },
    services: { [SERVICE]: service(kind, trust) },
    region: {
      template: 'central',
      cities: {},
      order: [CITY],
      intercity: {},
      borderPosts: {},
      jurisdiction: mapped ? { [CITY]: SERVICE } : {},
      latency: {},
      rules: {
        detentionPhases: 1,
        contrabandCashThreshold: 40,
        papersDelay: 1,
        papersCost: 10,
        watchListSensitivity: 0.5,
        liaisonTrustThreshold,
      },
    },
  };
  const ctx: ResolverContext = {
    content,
    truth,
    arrestEvidence: { [npc]: evidence },
    claims: { 'claim:seen': seen },
  };
  return { state, ctx };
}

describe('Property 13: jurisdiction gate independence', () => {
  it('grants an arrest only when the slice gate and jurisdiction both allow it', () => {
    // Feature: multi-city, Property 13: Jurisdiction gate independence
    const evidenceGate = base.meta.preset.arrest.threshold;
    const quiet = TruthStore.create({ get: () => undefined });
    const noisy = TruthStore.create({ get: () => undefined });
    noisy.addFact({
      id: 'prop:hidden',
      subject: npc,
      predicate: 'KNOWS',
      object: { kind: 'text', value: 'a secret' },
    });
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: evidenceGate + 2 }),
        fc.constantFrom<ServiceKind>('own', 'liaison', 'hostile', 'local-security'),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom(0.3, 0.5, 0.7, 1),
        fc.boolean(),
        (evidence, kind, trust, liaisonTrustThreshold, mapped) => {
          const first = staged(evidence, kind, trust, liaisonTrustThreshold, mapped, quiet);
          const second = staged(evidence, kind, trust, liaisonTrustThreshold, mapped, noisy);
          const quote = quoteArrest(first.state, { kind: 'arrest', npc }, first.ctx);
          const again = quoteArrest(second.state, { kind: 'arrest', npc }, second.ctx);
          const sliceAllows = evidence >= evidenceGate;
          const permits = mapped && servicePermitsArrest(first.state.services?.[SERVICE], liaisonTrustThreshold);
          expect(quote.allowed).toBe(sliceAllows && permits);
          expect(again).toEqual(quote);
          if (sliceAllows && !permits) {
            expect(quote.reason).toContain('jurisdiction forbids');
            expect(quote.reason).toContain(CITY);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('lets a district entry override the city, and lists every observed city', () => {
    const district = 'district:sector' as const;
    const loc = base.player.loc;
    const place = base.city.locations[loc];
    const own = service('own', 0);
    const hostile = service('hostile', 0);
    const state: WorldState = {
      ...base,
      player: { ...base.player, arrestAuthority: 3, city: CITY, loc },
      services: { [SERVICE]: own, 'service:other': { ...hostile, id: 'service:other' } },
      city: {
        ...base.city,
        locations: { ...base.city.locations, [loc]: { ...place, district } },
      },
      region: {
        template: 'central',
        cities: {},
        order: [CITY],
        intercity: {},
        borderPosts: {},
        jurisdiction: { [CITY]: 'service:other', [district]: SERVICE },
        latency: {},
        rules: {
          detentionPhases: 1,
          contrabandCashThreshold: 40,
          papersDelay: 1,
          papersCost: 10,
          watchListSensitivity: 0.5,
          liaisonTrustThreshold: 0.5,
        },
      },
    };
    const ctx: ResolverContext = {
      content,
      arrestEvidence: { [npc]: base.meta.preset.arrest.threshold },
      claims: {
        'claim:here': seen,
        'claim:away': {
          id: 'prop:away',
          subject: npc,
          predicate: 'LOCATED_AT',
          object: { kind: 'text', value: 'city:east' },
        },
      },
    };
    const quote = quoteArrest(state, { kind: 'arrest', npc }, ctx);
    expect(quote.allowed).toBe(true);

    const blocked: WorldState = {
      ...state,
      region: state.region === undefined
        ? undefined
        : { ...state.region, jurisdiction: { [CITY]: SERVICE, [district]: 'service:other' } },
    };
    const refused = quoteArrest(blocked, { kind: 'arrest', npc }, ctx);
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toContain('jurisdiction forbids');
    expect(refused.reason).toContain(CITY);
    expect(refused.reason).toContain('city:east');
  });
});
