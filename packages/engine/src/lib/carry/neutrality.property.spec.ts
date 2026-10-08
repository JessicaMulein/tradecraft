/**
 * Property 9: generator neutrality.
 *
 * A game with no posting context is the slice game. An empty carry-in does not
 * change the core projection once the plot template and the preset are the
 * same. Noise additions stay the same however the carry-in changes.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type DifficultyPreset,
  type ServiceDefinition,
} from '@tradecraft/content';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import type { WorldState } from '../model/state.js';
import type { ArcThreadSpec, CarriedPerson, CarryIn, PostingContext, RequisitionEffect } from './types.js';

const CORE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'content', 'packs', 'core');

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

const content = loaded.value;
const presets = [...content.difficultyPresets.values()];
const archetypes = [...content.archetypes.values()].map((row) => row.id);
if (presets.length === 0 || archetypes.length === 0) {
  throw new Error('core pack is missing presets or archetypes');
}

function scenario(mole: boolean): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function gameInputs(preset: DifficultyPreset, mole: boolean): GenerateInputs {
  const services = new Map(content.services);
  services.set('svc-east', {
    id: 'svc-east',
    name: 'Directorate East',
    aliases: [],
    kind: 'hostile',
    country: 'East',
    doctrineBase: {},
  } as ServiceDefinition);
  return {
    content: { ...content, services },
    preset,
    scenario: scenario(mole),
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

/** The slice core: principals, plot, comms, station roster and cover, without noise. */
function coreProjection(world: WorldState): unknown {
  const npcs: Record<string, WorldState['npcs'][string]> = {};
  for (const [id, npc] of Object.entries(world.npcs)) {
    if (!id.startsWith('npc:bg-')) {
      npcs[id] = npc;
    }
  }
  const channels: Record<string, WorldState['channels'][string]> = {};
  for (const [id, channel] of Object.entries(world.channels)) {
    if (!id.startsWith('chan:thread/') && !id.startsWith('chan:noise/')) {
      channels[id] = channel;
    }
  }
  return {
    plot: world.plot,
    npcs,
    channels,
    deadDrops: world.deadDrops,
    station: {
      org: world.station.org,
      chief: world.station.chief,
      staff: world.station.staff,
      mole: world.station.mole,
      knowledge: world.station.knowledge,
    },
    cover: world.player.cover,
    known: world.player.known.entities.filter((id) => !id.startsWith('npc:bg-')).slice().sort(),
  };
}

/** Entities the noise stream adds. Arc threads are carry, not noise. */
function noiseAdditions(world: WorldState): unknown {
  const npcs: Record<string, WorldState['npcs'][string]> = {};
  for (const [id, npc] of Object.entries(world.npcs)) {
    if (id.startsWith('npc:bg-')) {
      npcs[id] = npc;
    }
  }
  const channels: Record<string, WorldState['channels'][string]> = {};
  for (const [id, channel] of Object.entries(world.channels)) {
    if (id.startsWith('chan:thread/') || id.startsWith('chan:noise/')) {
      channels[id] = channel;
    }
  }
  return {
    npcs,
    channels,
    threads: world.sideThreads.filter((thread) => !thread.id.startsWith('thread:arc-')),
    libraryThreads: world.libraryThreads,
  };
}

function carried(n: number, archetype: string): CarriedPerson {
  return {
    id: `cp-${n}`,
    archetype,
    name: `cp-${n}`,
    persona: {
      name: `cp-${n}`,
      given: `cp-${n}`,
      family: 'Voss',
      library: 'core',
      culture: 'generic',
      gender: 'female',
      voiceTraits: [],
      mannerisms: [],
      background: 'carried',
      openness: 0.4,
    },
    descriptor: 'a grey coat',
    allegiance: { true: 'svc-east', apparent: 'neutral' },
    mice: { money: 0.2, ideology: 0.6, coercion: 0.1, ego: 0.3 },
    loyalty: 0.5,
    status: 'at-large',
  };
}

const carryArb: fc.Arbitrary<CarryIn> = fc
  .record({
    count: fc.integer({ min: 0, max: 3 }),
    archetype: fc.constantFrom(...archetypes),
    clues: fc.array(fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/), { maxLength: 2 }),
    requisition: fc.constantFrom(
      { kind: 'budget-credit' as const, amount: 40 },
      { kind: 'extra-player-drop' as const },
      { kind: 'cipher-aid' as const },
    ),
    withRequisition: fc.boolean(),
    suspicion: fc.double({ min: 0, max: 1, noNaN: true }),
    tailed: fc.boolean(),
  })
  .map((value): CarryIn => {
    const persons = Array.from({ length: value.count }, (_, index) => carried(index + 1, value.archetype));
    const threads: ArcThreadSpec[] = value.clues.map((id, index) => ({
      arc: `arc-${index}`,
      template: 'thread',
      bindings: { friend: persons[0]?.id ?? 'cp-1' },
      clues: [{ id }],
      priority: index,
    }));
    const requisitions: RequisitionEffect[] = value.withRequisition ? [value.requisition] : [];
    return {
      placements: persons.map((person, index) => ({
        person,
        as: index === 0 ? ('asset' as const) : ('recogniser' as const),
        contact: index === 0,
        optional: true,
        priority: index,
      })),
      personalFile: { title: 'Personal file', body: 'A name from before.', asserts: [], persons: [] },
      arcThreads: threads,
      modifiers: {
        coverSuspicion: value.suspicion,
        tailed: value.tailed,
        doctrineShift: {},
        patternDetection: {},
      },
      unkPrealloc: [],
      requisitions,
    };
  });

function posting(seed: string, service: string, carry: CarryIn, legend: { cover: string; name: string }): PostingContext {
  return {
    campaignId: 'camp',
    index: 0,
    seed,
    city: 'core',
    service,
    year: 1948,
    tension: 0.4,
    epoch: 'occupation-years',
    epochFlags: [],
    presetOverrides: {},
    scenarioOverrides: {},
    legend: { ...legend, official: true },
    history: { templateHistory: [], context: { year: 1948, skills: {} } },
    carry,
  };
}

const emptyCarry: CarryIn = {
  placements: [],
  personalFile: { title: 'Personal file', body: 'Empty.', asserts: [], persons: [] },
  arcThreads: [],
  modifiers: { coverSuspicion: 0, tailed: false, doctrineShift: {}, patternDetection: {} },
  unkPrealloc: [],
  requisitions: [],
};

describe('generator neutrality', () => {
  it('keeps slice generation, the core projection and the noise stream independent of carry-in', () => {
    // Feature: campaign-career, Property 9: Generator neutrality
    const seedArb = fc.string({ minLength: 1, maxLength: 12 });
    const presetArb = fc.constantFrom(...presets);

    fc.assert(
      fc.property(seedArb, presetArb, fc.boolean(), (seed, preset, mole) => {
        const inputs = gameInputs(preset, mole);
        const first = generate(seed, inputs);
        const second = generate(seed, inputs, {});
        expect(second).toEqual(first);
        expect(first.carry).toBeUndefined();
      }),
      { numRuns: 100 },
    );

    fc.assert(
      fc.property(seedArb, presetArb, (seed, preset) => {
        const inputs = gameInputs(preset, false);
        const plain = generate(seed, inputs);
        const posted = generate(
          seed,
          inputs,
          {},
          posting(seed, 'not-a-service', emptyCarry, {
            cover: plain.player.cover.id,
            name: plain.player.cover.title,
          }),
        );
        expect(posted.plot.template).toBe(plain.plot.template);
        expect(coreProjection(posted)).toEqual(coreProjection(plain));
      }),
      { numRuns: 100 },
    );

    fc.assert(
      fc.property(seedArb, presetArb, carryArb, carryArb, (seed, preset, left, right) => {
        const inputs = gameInputs(preset, false);
        const legend = { cover: 'clerk', name: 'Ada Berger' };
        const one = generate(seed, inputs, {}, posting(seed, 'svc-east', left, legend));
        const other = generate(seed, inputs, {}, posting(seed, 'svc-east', right, legend));
        expect(noiseAdditions(one)).toEqual(noiseAdditions(other));
      }),
      { numRuns: 100 },
    );
  });
});
