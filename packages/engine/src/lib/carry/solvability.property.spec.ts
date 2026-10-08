/**
 * Property 8: for any posting seed, preset and carry-in, the generated world
 * still solves. Discovery paths hold, every retained arc clue is readable from
 * the starting brief, no cell member sits on an arc thread, starting cover
 * suspicion stays at or under half the burn threshold, and every edge of the
 * core learnability graph is still present after carry and noise.
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

import { CELL_ROLE_IDS } from '../city/principals.js';
import {
  propKey,
  verifyDiscoveryPaths,
  type DiscoveryInputs,
  type DiscoveryResult,
} from '../city/discovery.js';
import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import { generateGame, type GenerateInputs } from '../generate.js';
import { revealTruth, type NpcId } from '../model/core.js';
import type { Npc } from '../city/npc.js';
import type { ArcThreadSpec, CarriedPerson, PostingContext, RequisitionEffect } from './types.js';

const CORE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'content', 'packs', 'core');
const PERSONAL_FILE = 'doc:dossier/personal-file';

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
if (presets.length === 0) {
  throw new Error('no difficulty presets');
}
const archetypes = [...content.archetypes.values()].map((row) => row.id);
if (archetypes.length === 0) {
  throw new Error('no archetypes');
}

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

function gameInputs(preset: DifficultyPreset): GenerateInputs {
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
    scenario,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const personNo = fc.integer({ min: 1, max: 6 });

const carriedPerson: fc.Arbitrary<CarriedPerson> = fc
  .record({
    n: personNo,
    archetype: fc.constantFrom(...archetypes),
    gender: fc.constantFrom('female' as const, 'male' as const),
    status: fc.constantFrom('at-large' as const, 'turned' as const, 'arrested' as const, 'dead' as const),
    loyalty: unit,
  })
  .map((value) => ({
    id: `cp-${value.n}`,
    archetype: value.archetype,
    name: `cp-${value.n}`,
    persona: {
      name: `cp-${value.n}`,
      given: `cp-${value.n}`,
      family: 'Voss',
      library: 'core',
      culture: 'generic',
      gender: value.gender,
      voiceTraits: [],
      mannerisms: [],
      background: 'carried',
      openness: 0.4,
    },
    descriptor: 'a grey coat',
    allegiance: { true: 'svc-east', apparent: 'neutral' },
    mice: { money: 0.2, ideology: 0.6, coercion: 0.1, ego: 0.3 },
    loyalty: value.loyalty,
    status: value.status,
  }));

const requisition: fc.Arbitrary<RequisitionEffect> = fc.oneof(
  fc.record({
    kind: fc.constant('budget-credit' as const),
    amount: fc.integer({ min: 0, max: 80 }),
  }),
  fc.constant({ kind: 'extra-player-drop' as const }),
  fc.constant({ kind: 'trace-priority' as const }),
  fc.constant({ kind: 'cipher-aid' as const }),
  fc.constant({ kind: 'prepared-legend' as const }),
  fc.record({
    kind: fc.constant('language-crash-course' as const),
    skill: fc.constant('german'),
  }),
);

const clueId = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/);

function contextFor(
  seed: string,
  persons: readonly CarriedPerson[],
  threads: readonly ArcThreadSpec[],
  requisitions: readonly RequisitionEffect[],
  coverSuspicion: number,
  tailed: boolean,
): PostingContext {
  return {
    campaignId: 'camp',
    index: 1,
    seed,
    city: 'core',
    service: 'svc-east',
    year: 1948,
    tension: 0.4,
    epoch: 'occupation-years',
    epochFlags: [],
    presetOverrides: {},
    scenarioOverrides: {},
    legend: { cover: 'clerk', name: 'Ada Berger', official: true },
    history: { templateHistory: [], context: { year: 1948, skills: {} } },
    carry: {
      placements: persons.map((person, index) => ({
        person,
        as: index % 2 === 0 ? ('asset' as const) : ('arc' as const),
        contact: person.status === 'at-large',
        optional: index % 3 === 0,
        priority: index,
      })),
      personalFile: { title: 'Personal file', body: 'A name from before.', asserts: [], persons: [] },
      arcThreads: threads,
      modifiers: {
        coverSuspicion,
        tailed,
        doctrineShift: {},
        patternDetection: {},
      },
      unkPrealloc: [],
      requisitions,
    },
  };
}

/** The edges the discovery graph is built from. Carry and noise may only add. */
function learnabilityEdges(inputs: DiscoveryInputs): Set<string> {
  const edges = new Set<string>();
  const brief = inputs.brief;
  for (const id of brief.knownEntities) {
    edges.add(`root:${id}`);
  }
  for (const id of brief.channels) {
    edges.add(`channel:${id}`);
  }
  edges.add(`doc:${brief.cable}`);
  for (const id of brief.dossiers) {
    edges.add(`doc:${id}`);
  }
  for (const lead of brief.leads) {
    edges.add(`lead:${propKey(lead.prop)}`);
  }
  for (const id of brief.contacts) {
    edges.add(`contact:${id}`);
  }
  for (const npc of Object.values(inputs.principals.npcs)) {
    edges.add(`npc:${npc.id}`);
    for (const entry of npc.schedule.entries) {
      edges.add(`sched:${npc.id}:${entry.weekday}:${entry.phase}:${entry.loc}`);
    }
    const known = inputs.knowledge.byNpc[npc.id]?.knowledge.known ?? [];
    for (const fact of known) {
      edges.add(`know:${npc.id}:${propKey(fact)}`);
    }
  }
  for (const channel of Object.values(inputs.comms.channels)) {
    edges.add(`wire:${channel.id}:${channel.kind}:${String(channel.owner)}`);
  }
  for (const loc of Object.values(inputs.city.locations)) {
    edges.add(`loc:${loc.id}:${loc.public === true}`);
  }
  return edges;
}

function hasPersonalFile(inputs: DiscoveryInputs): boolean {
  return inputs.brief.dossiers.some((id) => id === PERSONAL_FILE);
}

function cellArchetype(id: string): boolean {
  for (const row of content.archetypes.values()) {
    if (row.id !== id && !row.id.endsWith(`/${id}`) && !id.endsWith(`/${row.id}`)) {
      continue;
    }
    const local = row.id.includes('/') ? row.id.slice(row.id.lastIndexOf('/') + 1) : row.id;
    return row.role === 'cell' || local === 'cell' || (CELL_ROLE_IDS as readonly string[]).includes(local);
  }
  return false;
}

function cellMember(npc: Npc, cellIds: ReadonlySet<string>): boolean {
  if (cellIds.has(npc.id) || npc.role === 'cell') {
    return true;
  }
  const local = npc.archetype.includes('/')
    ? npc.archetype.slice(npc.archetype.lastIndexOf('/') + 1)
    : npc.archetype;
  return local === 'cell' || (CELL_ROLE_IDS as readonly string[]).includes(local);
}

describe('posting solvability under carry-in', () => {
  it('keeps every generated posting solvable', () => {
    // Feature: campaign-career, Property 8: Posting solvability under Carry-In
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.constantFrom(...presets),
        fc.uniqueArray(carriedPerson, {
          minLength: 0,
          maxLength: 4,
          selector: (person) => person.id,
        }),
        fc.array(clueId, { maxLength: 2 }),
        fc.array(requisition, { maxLength: 2 }),
        fc.double({ min: 0, max: 1.5, noNaN: true }),
        fc.boolean(),
        (seed, preset, persons, clueIds, requisitions, coverSuspicion, tailed) => {
          const ids = persons.map((person) => person.id);
          const bound = ids[0] ?? 'cp-1';
          const cellBound = persons.find((person) => cellArchetype(person.archetype))?.id;
          const threads: ArcThreadSpec[] = clueIds.map((id, index) => ({
            arc: `arc-${index}`,
            template: 'thread',
            bindings: {
              friend: bound,
              ...(cellBound === undefined ? {} : { infiltrator: cellBound }),
            },
            clues: [{ id, prop: { id: `prop:${id}`, subject: `npc:${bound}` as NpcId, predicate: 'KNOWS', object: 'org:hostile' } }],
            priority: index,
          }));
          const accepted: DiscoveryInputs[] = [];
          const verify = (inputs: DiscoveryInputs): DiscoveryResult => {
            const result = verifyDiscoveryPaths(inputs);
            if (result.ok) {
              accepted.push(inputs);
            }
            return result;
          };
          const result = generateGame(
            seed,
            gameInputs(preset),
            { verifier: verify, noiseVerifier: verify },
            contextFor(seed, persons, threads, requisitions, coverSuspicion, tailed),
          );
          const world = result.world;
          const core = accepted.find((inputs) => !hasPersonalFile(inputs));
          const carried = [...accepted].reverse().find((inputs) => hasPersonalFile(inputs));
          const finalInputs = [...accepted].reverse().find((inputs) => !hasPersonalFile(inputs));
          expect(core).toBeDefined();
          expect(carried).toBeDefined();
          expect(finalInputs).toBeDefined();
          if (core === undefined || carried === undefined || finalInputs === undefined) {
            return;
          }
          expect(verifyDiscoveryPaths(finalInputs).ok).toBe(true);
          const half = preset.coverSuspicionBurnThreshold / 2;
          expect(revealTruth(world.player.coverSuspicion)).toBeLessThanOrEqual(half);
          const coreEdges = learnabilityEdges(core);
          const finalEdges = learnabilityEdges(finalInputs);
          const missing = [...coreEdges].filter((edge) => !finalEdges.has(edge));
          expect(missing).toEqual([]);

          const cellIds = new Set<string>(core.principals.cell);
          const briefDocs = new Set<string>([carried.brief.cable, ...carried.brief.dossiers]);
          const leadIds = new Set(carried.brief.leads.map((lead) => lead.prop.id));
          for (const thread of world.sideThreads) {
            if (!thread.id.startsWith('thread:arc-')) {
              continue;
            }
            for (const participant of thread.participants) {
              const npc = world.npcs[participant];
              expect(npc === undefined || !cellMember(npc, cellIds)).toBe(true);
            }
            for (const prop of thread.propositions) {
              const onFile = Object.values(world.documents).some(
                (doc) => briefDocs.has(doc.id) && doc.asserts.includes(prop.id),
              );
              expect(leadIds.has(prop.id) || onFile).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
