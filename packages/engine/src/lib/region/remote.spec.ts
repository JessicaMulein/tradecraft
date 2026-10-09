/**
 * Remote assets (multi-city task 9.1).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { asTruth, revealTruth, type NpcId } from '../model/core.js';
import type { CityId, ServiceId } from '../fidelity/types.js';
import { emptyHostileBeliefs } from '../hostile/beliefs.js';
import { createPrng } from '../prng/prng.js';
import { quote, resolve } from '../action/action.js';
import type { ResolverContext } from '../action/result.js';
import type { WorldState } from '../model/state.js';
import type { ServiceState } from './services.js';
import {
  channelDelay,
  communicationLatency,
  exposureByService,
  resultReadyAt,
} from './remote.js';
import type { TravelDocument } from './world.js';

const CORE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'content', 'packs', 'core');

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

const CTX: ResolverContext = { content };
const NORTH = 'city:north' as CityId;
const EAST = 'city:east' as CityId;

function service(appetite: number): ServiceState {
  return {
    id: 'service:border' as ServiceId,
    kind: 'local-security',
    country: 'Eastland',
    doctrine: { riskTolerance: 0, securityConsciousness: 0, deceptionAppetite: appetite },
    residencies: { [EAST]: { officers: [], channels: [], drops: [], capacity: 1 } },
    beliefs: { ...emptyHostileBeliefs(), coverSuspicion: 0, watch: asTruth({ persons: [], descriptors: [] }) },
    knowledge: { known: [], falseBeliefs: [], knownEntities: [] },
  };
}

function regional(base: WorldState, npc: NpcId, appetite: number, documents: readonly string[]): WorldState {
  const rel = base.relationships[npc];
  const paper: TravelDocument = {
    id: 'paper:pass',
    kind: 'passport',
    holder: npc,
    quality: asTruth(0),
    issuedBy: { kind: 'service', id: 'service:border' },
  };
  return {
    ...base,
    player: { ...base.player, city: NORTH },
    relationships: {
      ...base.relationships,
      [npc]: {
        ...rel,
        recruited: true,
        channel: true,
        exposure: 0.4,
        asset: {
          access: asTruth({ locs: [], orgs: [], npcs: [] }),
          reliability: asTruth(1),
          turned: false,
          hostileControlled: asTruth(false),
        },
      },
    },
    services: { 'service:border': service(appetite) },
    travelDocs: { 'paper:pass': paper },
    locationOf: {
      player: { city: NORTH, loc: base.player.loc },
      [npc]: { city: NORTH, loc: base.player.loc },
    },
    region: {
      template: 'central',
      order: [NORTH, EAST],
      jurisdiction: {},
      latency: { sameCountry: 1, crossBorder: 2, acrossCurtain: 3 },
      cities: {
        [NORTH]: {
          id: NORTH,
          tier: 'full',
          country: 'Northland',
          districts: {},
          locations: {},
          routes: [],
          weather: { condition: 'clear', label: 'clear', season: 'summer' },
          sectorLines: [],
        },
        [EAST]: {
          id: EAST,
          tier: 'coarse',
          country: 'Eastland',
          districts: {},
          locations: {},
          routes: [],
          weather: { condition: 'clear', label: 'clear', season: 'summer' },
          sectorLines: [],
        },
      },
      borderPosts: {
        'post:gate': { id: 'post:gate', service: 'service:border', strictness: documents.length === 0 ? 0 : 1, documents },
      },
      intercity: {
        'route:east': {
          id: 'route:east',
          mode: 'rail',
          from: base.player.loc,
          to: 'loc:east-halt' as WorldState['player']['loc'],
          fromCity: NORTH,
          toCity: EAST,
          duration: 2,
          fare: 0,
          borders: ['post:gate'],
        },
      },
    },
  };
}

describe('remote assets', () => {
  it('charges latency by country and holds a report for the channel', () => {
    const latency = { sameCountry: 1, crossBorder: 2, acrossCurtain: 4 };
    expect(communicationLatency(latency, NORTH, NORTH, 'Northland', 'Northland')).toBe(0);
    expect(communicationLatency(latency, NORTH, EAST, 'Northland', 'Northland')).toBe(1);
    expect(communicationLatency(latency, NORTH, EAST, 'Northland', 'Eastland')).toBe(2);
    expect(channelDelay('radio', 5)).toBe(0);
    expect(channelDelay('dead-drop', 5)).toBe(1);
    expect(channelDelay('courier', 5)).toBe(5);
    expect(resultReadyAt({ day: 0, phase: 0 }, 2, 'courier', 3)).toEqual({ day: 1, phase: 1 });
  });

  it('drops exposure once an asset is resettled', () => {
    const rows = exposureByService('npc:a' as NpcId, EAST, 0.4, { 'service:border': service(0) }, false);
    expect(rows).toEqual([{ service: 'service:border', exposure: 0.4 }]);
    expect(exposureByService('npc:a' as NpcId, EAST, 0.4, { 'service:border': service(0) }, true)).toEqual([]);
  });

  it('refuses exfiltration when the game has no region', () => {
    const state = generate('remote-slice', inputs());
    const npc = Object.keys(state.relationships)[0] as NpcId;
    const action = {
      kind: 'exfiltrate' as const,
      asset: npc,
      route: 'route:east' as const,
      at: state.time,
      papers: [] as const,
    };
    expect(quote(state, action, CTX).allowed).toBe(false);
    expect(resolve(state, action, createPrng('remote'), CTX).next).toBe(state);
  });

  it('resettles an asset who clears the border and detains one the service arrests', () => {
    const state = generate('remote-region', inputs());
    const npc = Object.keys(state.relationships)[0] as NpcId;
    const open = regional(state, npc, 0, []);
    const passed = resolve(
      open,
      { kind: 'exfiltrate', asset: npc, route: 'route:east', at: open.time, papers: [] },
      createPrng('pass'),
      CTX,
    );
    expect(passed.next.relationships[npc]?.resettled).toBe(true);
    expect(passed.next.relationships[npc]?.exposure).toBe(0);
    const access = passed.next.relationships[npc]?.asset?.access;
    expect(access === undefined ? [] : revealTruth(access).locs).toContain('loc:east-halt');

    const held = regional(state, npc, 0, ['passport']);
    const detained = resolve(
      held,
      { kind: 'exfiltrate', asset: npc, route: 'route:east', at: held.time, papers: ['paper:pass'] },
      createPrng('hold'),
      CTX,
    );
    expect(detained.next.relationships[npc]?.custody?.by).toBe('hostile');
    expect(detained.next.relationships[npc]?.resettled).toBeUndefined();

    const released = regional(state, npc, 1, ['passport']);
    const freed = resolve(
      released,
      { kind: 'exfiltrate', asset: npc, route: 'route:east', at: released.time, papers: ['paper:pass'] },
      createPrng('free'),
      CTX,
    );
    expect(freed.next.relationships[npc]?.custody).toBeUndefined();
    expect(freed.next.relationships[npc]?.resettled).toBeUndefined();
  });
});
