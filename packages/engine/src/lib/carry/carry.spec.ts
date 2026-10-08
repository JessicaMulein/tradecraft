/**
 * A posting adds carry-in after the core world is verified. A game with no
 * posting context stays a slice game.
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
import { describe, expect, it } from 'vitest';

import { applyPostingCarry, type CarryCore } from './apply.js';
import { nextCarryDrop, type CarriedPerson, type PostingContext } from './types.js';
import type { DiscoveryResult } from '../city/discovery.js';
import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import { generate, generateGame, type GenerateInputs } from '../generate.js';
import { revealTruth } from '../model/core.js';

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
const preset = [...content.difficultyPresets.values()].find((row) => row.id === 'standard');
if (preset === undefined) {
  throw new Error('missing standard preset');
}

function inputs(): GenerateInputs {
  const scenario: ScenarioConfig = ScenarioConfigSchema.parse({
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
    preset: preset as DifficultyPreset,
    scenario,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

function person(id: string, archetype: string): CarriedPerson {
  return {
    id,
    archetype,
    name: id,
    persona: {
      name: id,
      given: id,
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

function posting(): PostingContext {
  return {
    campaignId: 'camp',
    index: 1,
    seed: 'carry-seed',
    city: 'core',
    service: 'svc-east',
    year: 1948,
    tension: 0.4,
    epoch: 'occupation-years',
    epochFlags: ['courier-heavy'],
    presetOverrides: {},
    scenarioOverrides: {},
    legend: { cover: 'clerk', name: 'Ada Berger', official: true },
    history: { templateHistory: [], context: { year: 1948, skills: {} } },
    carry: {
      placements: [
        { person: person('cp-1', 'emigre-fixer'), as: 'asset', contact: true, optional: false, priority: 1 },
        { person: person('cp-2', 'cell-leader'), as: 'arc', contact: false, optional: false, priority: 2 },
        {
          person: person('cp-9', 'hostile-case-officer'),
          as: 'recogniser',
          contact: false,
          optional: true,
          priority: 0,
        },
      ],
      personalFile: {
        title: 'Personal file',
        body: 'Ada knows a name.',
        asserts: [],
        persons: ['cp-1'],
      },
      arcThreads: [
        {
          arc: 'nemesis',
          template: 'nemesis-thread',
          bindings: { friend: 'cp-1', infiltrator: 'cp-2' },
          clues: [
            {
              id: 'seen',
              prop: { id: 'clue-seen', subject: 'npc:cp-1', predicate: 'KNOWS', object: 'org:hostile' },
            },
          ],
          priority: 1,
        },
      ],
      modifiers: {
        coverSuspicion: 0.9,
        tailed: true,
        doctrineShift: { riskTolerance: 0.1 },
        patternDetection: { warehouse: 1.1 },
      },
      unkPrealloc: [{ ref: 'face-1', person: 'cp-1' }],
      requisitions: [{ kind: 'budget-credit', amount: 40 }],
    },
  };
}

describe('nextCarryDrop', () => {
  it('drops an optional recogniser, then the nemesis, then the lowest arc', () => {
    const carry = posting().carry;
    const withNemesis = {
      ...carry,
      placements: [
        ...carry.placements,
        { person: person('cp-4', 'hostile-resident'), as: 'nemesis' as const, contact: false, optional: true, priority: 3 },
      ],
      arcThreads: [
        ...carry.arcThreads,
        { ...carry.arcThreads[0], arc: 'late', priority: 4 },
      ],
    };
    const dropped = new Set<string>();
    expect(nextCarryDrop(withNemesis, dropped)).toBe('cp-9');
    dropped.add('cp-9');
    expect(nextCarryDrop(withNemesis, dropped)).toBe('cp-4');
    dropped.add('cp-4');
    expect(nextCarryDrop(withNemesis, dropped)).toBe('arc:nemesis');
  });
});

describe('generate posting carry', () => {
  it('leaves a game with no posting context unchanged', () => {
    const plain = generate('carry-plain', inputs());
    expect(plain.carry).toBeUndefined();
    expect(generate('carry-plain', inputs())).toEqual(plain);
  });

  it('names the hostile service and places carry-in without a cell arc slot', () => {
    const plain = generate('carry-post', inputs());
    const result = generateGame('carry-post', inputs(), {}, posting());
    const world = result.world;
    const carry = world.carry === undefined ? undefined : revealTruth(world.carry);
    expect(world.orgs['org:hostile']?.name).toBe('Directorate East');
    expect(world.orgs['org:station']?.name).toBe(plain.orgs['org:station']?.name);
    expect(world.orgs['org:cell']?.name).toBe(plain.orgs['org:cell']?.name);
    expect(world.plot.template).toBe(plain.plot.template);
    expect(world.npcs['npc:cp-1']?.schedule.entries.length).toBeGreaterThan(0);
    expect(world.channels['chan:carry/cp-1']?.owner).toBe('npc:cp-1');
    expect(world.npcs['npc:cp-9']?.org).toBe('org:hostile');
    expect(world.player.known.entities).toContain('npc:cp-1');
    expect(world.documents['doc:dossier/personal-file']?.title).toBe('Personal file');
    expect(world.player.unkIds['npc:cp-1']).toBe('unk:1');
    expect(result.truth.identityOf('unk:1')).toBe('npc:cp-1');
    expect(world.player.coverSuspicion).toBe(Math.min(0.9, (preset as DifficultyPreset).coverSuspicionBurnThreshold / 2));
    expect(world.player.tailed).toBe(true);
    expect(world.player.cover.title).toBe('Ada Berger');
    expect(world.hostile.doctrine.riskTolerance).toBe(
      Math.min(1, plain.hostile.doctrine.riskTolerance + 0.1),
    );
    expect(world.station.ledger.entries.some((entry) => entry.amount === 40)).toBe(true);
    const thread = world.sideThreads.find((row) => row.id === 'thread:arc-nemesis');
    expect(thread?.participants).toContain('npc:cp-1');
    expect(thread?.participants).not.toContain('npc:cp-2');
    expect(carry?.recognisers).toContain('npc:cp-9');
    expect(carry?.patternDetection.warehouse).toBe(1.1);
    expect(carry?.unk['face-1']?.unk).toBe('unk:1');
  });

  it('drops an optional recogniser when verification keeps failing until it is gone', () => {
    const world = generate('carry-drop', inputs());
    const ctx = posting();
    const onlyRecogniser: PostingContext = {
      ...ctx,
      carry: {
        ...ctx.carry,
        placements: ctx.carry.placements.filter((placement) => placement.person.id === 'cp-9'),
        arcThreads: [],
        unkPrealloc: [],
      },
    };
    const refuse: DiscoveryResult = {
      ok: false,
      stages: [],
      single: [],
      root: { entities: new Set(), channels: new Set(), documents: new Set(), leads: new Set() },
    };
    const applied = applyPostingCarry(
      world,
      {
        brief: {
          coverIdentity: world.player.cover,
          chief: world.station.chief,
          knownEntities: world.player.known.entities,
          leads: [],
          dossiers: [],
          channels: [],
          deadDrops: [],
          directives: [],
          budget: world.station.ledger.start,
          contacts: [],
          cable: 'doc:cable/brief',
        },
        plot: world.plot,
        knowledge: { byNpc: {}, station: world.station.knowledge, truthFacts: [] },
        comms: { channels: world.channels },
        city: world.city,
        orgs: { orgs: world.orgs },
        principals: { cell: [], npcs: world.npcs },
      } as unknown as CarryCore,
      onlyRecogniser,
      inputs().content,
      (preset as DifficultyPreset).coverSuspicionBurnThreshold,
      (discovered) =>
        Object.prototype.hasOwnProperty.call(discovered.principals.npcs, 'npc:cp-9')
          ? refuse
          : { ...refuse, ok: true },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok || applied.world.carry === undefined) {
      return;
    }
    const carry = revealTruth(applied.world.carry);
    expect(carry.dropped).toContain('cp-9');
    expect(applied.world.npcs['npc:cp-9']).toBeUndefined();
  });
});
